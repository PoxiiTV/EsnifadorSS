mod filter;
mod fsops;
mod scan;
mod suspects;
mod tree;

use filter::Filter;
use scan::Progress;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tree::{Tree, ViewOpts};

struct Session {
    root: PathBuf,
    tree: Option<Tree>,
    progress: Arc<Progress>,
    filter_src: String,
    marks: Option<Vec<u8>>,
    watcher: Option<notify::RecommendedWatcher>,
}

#[derive(Default)]
struct AppState {
    sessions: Mutex<HashMap<u32, Session>>,
    next_id: AtomicU32,
}

impl AppState {
    /// Ejecuta `f` sobre el arbol de una sesion ya escaneada.
    fn with_tree<T>(&self, id: u32, f: impl FnOnce(&Session, &Tree) -> T) -> Result<T, String> {
        let g = self.sessions.lock().unwrap();
        let s = g.get(&id).ok_or("Sesion desconocida")?;
        let t = s.tree.as_ref().ok_or("El escaneo aun no ha terminado")?;
        Ok(f(s, t))
    }
}

// ---------------------------------------------------------------- unidades

#[derive(Serialize)]
struct Drive {
    name: String,
    mount: String,
    total: u64,
    free: u64,
    kind: String,
    fs: String,
    removable: bool,
}

#[tauri::command]
fn list_drives() -> Vec<Drive> {
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();
    let mut v: Vec<Drive> = disks
        .list()
        .iter()
        .map(|d| Drive {
            name: d.name().to_string_lossy().into_owned(),
            mount: d.mount_point().to_string_lossy().into_owned(),
            total: d.total_space(),
            free: d.available_space(),
            kind: format!("{:?}", d.kind()),
            fs: d.file_system().to_string_lossy().into_owned(),
            removable: d.is_removable(),
        })
        .collect();
    v.sort_by(|a, b| a.mount.cmp(&b.mount));
    v.dedup_by(|a, b| a.mount == b.mount);
    v
}

// ---------------------------------------------------------------- escaneo

#[derive(Serialize, Clone)]
struct ProgressPayload {
    session: u32,
    files: u64,
    dirs: u64,
    bytes: u64,
    /// Bytes que se esperan en total, o 0 si no se puede saber.
    expected: u64,
    /// Milisegundos desde que arranco el analisis.
    elapsed: u64,
    current: String,
}

#[derive(Serialize, Clone)]
struct DonePayload {
    session: u32,
    root: String,
    name: String,
    size: u64,
    files: u32,
    dirs: u32,
    nodes: usize,
    ms: u64,
    denied: u32,
    volume_total: u64,
    volume_free: u64,
    cancelled: bool,
}

#[tauri::command]
fn start_scan(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    session: Option<u32>,
) -> Result<u32, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("No es una carpeta accesible: {path}"));
    }

    let sid = match session {
        Some(s) => s,
        None => state.next_id.fetch_add(1, Ordering::Relaxed),
    };
    let progress = Arc::new(Progress::default());

    {
        let mut g = state.sessions.lock().unwrap();
        if let Some(old) = g.get(&sid) {
            old.progress.cancel.store(true, Ordering::Relaxed);
        }
        g.insert(
            sid,
            Session {
                root: root.clone(),
                tree: None,
                progress: progress.clone(),
                filter_src: String::new(),
                marks: None,
                watcher: None,
            },
        );
    }

    // Hilo de avisos: manda el avance a la interfaz mientras se escanea.
    let pr = progress.clone();
    let app2 = app.clone();
    let t0 = std::time::Instant::now();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(110));
            if pr.done.load(Ordering::Relaxed) || pr.cancelled() {
                break;
            }
            let cur = pr.current.lock().map(|g| g.clone()).unwrap_or_default();
            let _ = app2.emit(
                "scan:progress",
                ProgressPayload {
                    session: sid,
                    files: pr.files.load(Ordering::Relaxed),
                    dirs: pr.dirs.load(Ordering::Relaxed),
                    bytes: pr.bytes.load(Ordering::Relaxed),
                    expected: pr.expected.load(Ordering::Relaxed),
                    elapsed: t0.elapsed().as_millis() as u64,
                    current: cur,
                },
            );
        }
    });

    std::thread::spawn(move || {
        let t = scan::scan(&root, &progress);
        progress.done.store(true, Ordering::Relaxed);
        let state = app.state::<AppState>();
        let payload = DonePayload {
            session: sid,
            root: t.root_path.to_string_lossy().into_owned(),
            name: t.nodes[0].name.to_string(),
            size: t.nodes[0].size,
            files: t.nodes[0].files,
            dirs: t.nodes[0].dirs,
            nodes: t.nodes.len(),
            ms: t.scan_ms,
            denied: t.denied,
            volume_total: t.volume_total,
            volume_free: t.volume_free,
            cancelled: progress.cancelled(),
        };
        {
            let mut g = state.sessions.lock().unwrap();
            if let Some(s) = g.get_mut(&sid) {
                s.tree = Some(t);
                s.marks = None;
                s.filter_src.clear();
            }
        }
        watch_session(&app, sid);
        let _ = app.emit("scan:done", payload);
    });

    Ok(sid)
}

#[tauri::command]
fn cancel_scan(state: State<AppState>, session: u32) {
    if let Some(s) = state.sessions.lock().unwrap().get(&session) {
        s.progress.cancel.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
fn close_session(state: State<AppState>, session: u32) {
    if let Some(s) = state.sessions.lock().unwrap().remove(&session) {
        s.progress.cancel.store(true, Ordering::Relaxed);
    }
}

/// Vigila la carpeta escaneada y avisa a la interfaz cuando algo cambia por
/// fuera. No toca el arbol: solo enciende el aviso de "vuelve a escanear".
fn watch_session(app: &AppHandle, sid: u32) {
    use notify::{RecursiveMode, Watcher};
    let state = app.state::<AppState>();
    let root = match state.sessions.lock().unwrap().get(&sid) {
        Some(s) => s.root.clone(),
        None => return,
    };

    let app2 = app.clone();
    let last = AtomicU64::new(0);
    let start = std::time::Instant::now();
    let handler = move |res: notify::Result<notify::Event>| {
        if res.is_err() {
            return;
        }
        // Un disco vivo genera miles de eventos: como mucho un aviso cada 3 s.
        let now = start.elapsed().as_secs();
        if last.load(Ordering::Relaxed) + 3 > now {
            return;
        }
        last.store(now, Ordering::Relaxed);
        let _ = app2.emit("fs:changed", sid);
    };

    if let Ok(mut w) = notify::recommended_watcher(handler) {
        if w.watch(&root, RecursiveMode::Recursive).is_ok() {
            if let Some(s) = state.sessions.lock().unwrap().get_mut(&sid) {
                s.watcher = Some(w);
            }
        }
    }
}

// ---------------------------------------------------------------- consultas

#[derive(Serialize)]
struct Crumb {
    i: u32,
    n: String,
}

#[tauri::command]
fn breadcrumb(state: State<AppState>, session: u32, node: u32) -> Result<Vec<Crumb>, String> {
    state.with_tree(session, |_, t| {
        t.ancestry(node)
            .into_iter()
            .map(|i| Crumb {
                i,
                n: t.nodes[i as usize].name.to_string(),
            })
            .collect()
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn get_view(
    state: State<AppState>,
    session: u32,
    node: u32,
    max_depth: u32,
    min_ratio: f64,
    show_files: bool,
    max_nodes: usize,
) -> Result<tree::ViewNode, String> {
    state.with_tree(session, |s, t| {
        let node = if (node as usize) < t.nodes.len() { node } else { 0 };
        // El frontend manda la fraccion del total por debajo de la cual un
        // bloque no llegaria ni a un pixel; aqui se traduce a bytes.
        let min_bytes = (t.nodes[node as usize].size as f64 * min_ratio.clamp(0.0, 1.0)) as u64;
        let o = ViewOpts {
            max_depth: max_depth.clamp(1, 24),
            min_bytes,
            show_files,
            max_nodes: max_nodes.clamp(256, 400_000),
        };
        t.build_view(node, &o, s.marks.as_deref())
    })
}

#[derive(Serialize)]
struct FilterResult {
    ok: bool,
    matches: u64,
    bytes: u64,
}

#[tauri::command]
fn set_filter(state: State<AppState>, session: u32, expr: String) -> Result<FilterResult, String> {
    let mut g = state.sessions.lock().unwrap();
    let s = g.get_mut(&session).ok_or("Sesion desconocida")?;
    let t = s.tree.as_ref().ok_or("El escaneo aun no ha terminado")?;
    s.filter_src = expr.clone();
    match Filter::parse(&expr) {
        None => {
            s.marks = None;
            Ok(FilterResult { ok: true, matches: 0, bytes: 0 })
        }
        Some(f) => {
            let marks = t.compute_matches(&f);
            let mut n = 0u64;
            let mut b = 0u64;
            for (i, m) in marks.iter().enumerate() {
                if m & 1 != 0 {
                    n += 1;
                    b += t.nodes[i].size;
                }
            }
            s.marks = Some(marks);
            Ok(FilterResult { ok: true, matches: n, bytes: b })
        }
    }
}

#[derive(Serialize)]
struct NodeInfo {
    path: String,
    name: String,
    size: u64,
    mtime: i64,
    files: u32,
    dirs: u32,
    is_dir: bool,
    flags: u8,
    attrs: u32,
    parent_size: u64,
    root_size: u64,
    depth: u32,
}

#[tauri::command]
fn node_info(state: State<AppState>, session: u32, node: u32) -> Result<NodeInfo, String> {
    state.with_tree(session, |_, t| {
        let n = &t.nodes[node as usize];
        NodeInfo {
            path: t.path(node).to_string_lossy().into_owned(),
            name: n.name.to_string(),
            size: n.size,
            mtime: n.mtime,
            files: n.files,
            dirs: n.dirs,
            is_dir: n.is_dir(),
            flags: n.flags,
            attrs: n.attrs,
            parent_size: t.nodes[n.parent as usize].size,
            root_size: t.nodes[0].size,
            depth: t.ancestry(node).len() as u32 - 1,
        }
    })
}

#[tauri::command]
fn top_items(
    state: State<AppState>,
    session: u32,
    node: u32,
    dirs: bool,
    limit: usize,
) -> Result<Vec<tree::TopItem>, String> {
    state.with_tree(session, |_, t| t.top_items(node, dirs, limit.clamp(1, 500)))
}

#[tauri::command]
fn by_extension(
    state: State<AppState>,
    session: u32,
    node: u32,
    limit: usize,
) -> Result<Vec<tree::ExtStat>, String> {
    state.with_tree(session, |_, t| t.by_extension(node, limit.clamp(1, 200)))
}

// ---------------------------------------------------------------- acciones

fn paths_of(state: &AppState, session: u32, nodes: &[u32]) -> Result<Vec<PathBuf>, String> {
    state.with_tree(session, |_, t| {
        nodes
            .iter()
            .filter(|&&i| (i as usize) < t.nodes.len() && !t.nodes[i as usize].is_pseudo())
            .map(|&i| t.path(i))
            .collect()
    })
}

#[tauri::command]
fn open_item(state: State<AppState>, session: u32, node: u32) -> Result<(), String> {
    let p = paths_of(&state, session, &[node])?;
    fsops::open_path(p.first().ok_or("Elemento no valido")?)
}

#[tauri::command]
fn reveal_item(state: State<AppState>, session: u32, node: u32) -> Result<(), String> {
    let p = paths_of(&state, session, &[node])?;
    fsops::reveal(p.first().ok_or("Elemento no valido")?)
}

#[tauri::command]
fn properties_item(state: State<AppState>, session: u32, node: u32) -> Result<(), String> {
    let p = paths_of(&state, session, &[node])?;
    fsops::properties(p.first().ok_or("Elemento no valido")?)
}

#[derive(Serialize)]
struct DeleteResult {
    deleted: u32,
    freed: u64,
    errors: Vec<String>,
}

#[tauri::command]
fn delete_items(
    state: State<AppState>,
    session: u32,
    nodes: Vec<u32>,
    permanent: bool,
) -> Result<DeleteResult, String> {
    let paths = paths_of(&state, session, &nodes)?;
    let fails = fsops::delete(&paths, permanent);
    let failed: std::collections::HashSet<String> =
        fails.iter().map(|(p, _)| p.clone()).collect();

    // El arbol se corrige en memoria en vez de volver a escanear el disco:
    // se resta el tamano del nodo a todos sus ancestros y se marca como ido.
    let mut g = state.sessions.lock().unwrap();
    let s = g.get_mut(&session).ok_or("Sesion desconocida")?;
    let t = s.tree.as_mut().ok_or("El escaneo aun no ha terminado")?;
    let mut freed = 0u64;
    let mut deleted = 0u32;
    for id in nodes {
        let i = id as usize;
        if i >= t.nodes.len() || t.nodes[i].flags & tree::F_DELETED != 0 {
            continue;
        }
        if failed.contains(&t.path(id).to_string_lossy().into_owned()) {
            continue;
        }
        let size = t.nodes[i].size;
        // Un archivo resta 1 al contador de archivos de sus ancestros; una
        // carpeta resta los archivos que contenia y una carpeta mas (ella).
        let (files, dirs) = if t.nodes[i].is_dir() {
            (t.nodes[i].files, t.nodes[i].dirs + 1)
        } else {
            (1, 0)
        };
        t.nodes[i].flags |= tree::F_DELETED;
        t.nodes[i].size = 0;
        freed += size;
        deleted += 1;
        let mut cur = id;
        while cur != 0 {
            cur = t.nodes[cur as usize].parent;
            let a = &mut t.nodes[cur as usize];
            a.size = a.size.saturating_sub(size);
            a.files = a.files.saturating_sub(files);
            a.dirs = a.dirs.saturating_sub(dirs);
        }
    }

    Ok(DeleteResult {
        deleted,
        freed,
        errors: fails.into_iter().map(|(p, e)| format!("{p}: {e}")).collect(),
    })
}

#[tauri::command]
fn suspects(
    state: State<AppState>,
    session: u32,
    node: u32,
    limit: usize,
) -> Result<Vec<suspects::Suspect>, String> {
    state.with_tree(session, |_, t| t.suspects(node, limit.clamp(1, 500)))
}

#[derive(Serialize)]
struct DeniedFolder {
    i: u32,
    path: String,
}

/// Carpetas que no se pudieron leer. Se sacan del propio arbol: al escanear
/// se marcan con F_DENIED, asi que no hace falta guardar nada aparte.
#[tauri::command]
fn denied_folders(
    state: State<AppState>,
    session: u32,
    limit: usize,
) -> Result<Vec<DeniedFolder>, String> {
    state.with_tree(session, |_, t| {
        t.nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.flags & tree::F_DENIED != 0)
            .take(limit.clamp(1, 5000))
            .map(|(i, _)| DeniedFolder {
                i: i as u32,
                path: t.path(i as u32).to_string_lossy().into_owned(),
            })
            .collect()
    })
}

/// La direccion es fija a proposito: la interfaz no puede pedir que se abra
/// una cualquiera.
#[tauri::command]
fn open_author_page() -> Result<(), String> {
    fsops::open_url("https://github.com/PoxiiTV")
}

#[tauri::command]
fn export_report(
    state: State<AppState>,
    session: u32,
    node: u32,
    depth: u32,
    dest: String,
) -> Result<String, String> {
    let text = state.with_tree(session, |_, t| t.report(node, depth.clamp(1, 24)))?;
    std::fs::write(&dest, text).map_err(|e| format!("No se pudo guardar: {e}"))?;
    Ok(dest)
}

// ---------------------------------------------------------------- ventana

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Recuerda tamano, posicion y si estaba maximizada. El plugin oficial
        // ya resuelve el caso feo: que la ventana no reaparezca fuera de
        // pantalla si cambia la configuracion de monitores.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_drives,
            start_scan,
            cancel_scan,
            close_session,
            breadcrumb,
            get_view,
            set_filter,
            node_info,
            top_items,
            by_extension,
            open_item,
            reveal_item,
            properties_item,
            delete_items,
            export_report,
            open_author_page,
            suspects,
            denied_folders,
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar EsnifadorSS");
}
