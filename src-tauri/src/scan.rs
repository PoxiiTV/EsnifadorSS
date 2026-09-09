//! Recorrido paralelo del sistema de archivos.
//!
//! En Windows `DirEntry::metadata()` devuelve los datos que ya trajo la
//! enumeracion del directorio, sin un stat extra por archivo. Por eso el
//! recorrido plano con `read_dir` + rayon sale mas barato que cualquier
//! libreria generica de walking.

use crate::tree::{Node, Tree, F_DENIED, F_DIR, F_UNKNOWN};
use rayon::prelude::*;
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

/// Los enlaces simbolicos y las uniones se cuentan pero no se siguen: evitan
/// bucles infinitos y contar dos veces los mismos bytes.
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const MAX_DEPTH: u32 = 512;

#[derive(Default)]
pub struct Progress {
    pub files: AtomicU64,
    pub dirs: AtomicU64,
    pub bytes: AtomicU64,
    pub denied: AtomicU32,
    pub cancel: AtomicBool,
    pub done: AtomicBool,
    /// Bytes que se espera medir en total. Es lo que Windows dice que ocupa
    /// el volumen; sirve para dar un porcentaje real en vez de un giro
    /// indeterminado. Vale 0 cuando se analiza una subcarpeta, porque
    /// entonces no hay forma de saber el total de antemano.
    pub expected: AtomicU64,
    pub current: Mutex<String>,
}

impl Progress {
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
    fn note(&self, p: &Path) {
        // try_lock: si otro hilo esta escribiendo, este se salta el aviso.
        if let Ok(mut g) = self.current.try_lock() {
            g.clear();
            g.push_str(&p.to_string_lossy());
        }
    }
}

struct Raw {
    name: Box<str>,
    size: u64,
    mtime: i64,
    attrs: u32,
    flags: u8,
    files: u32,
    dirs: u32,
    children: Vec<Raw>,
}

#[cfg(windows)]
fn meta_bits(md: &fs::Metadata) -> (u64, i64, u32) {
    use std::os::windows::fs::MetadataExt;
    let ft = md.last_write_time();
    let unix = (ft / 10_000_000) as i64 - 11_644_473_600;
    (md.file_size(), unix, md.file_attributes())
}

#[cfg(not(windows))]
fn meta_bits(md: &fs::Metadata) -> (u64, i64, u32) {
    use std::time::UNIX_EPOCH;
    let unix = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    (md.len(), unix, if md.is_dir() { 0x10 } else { 0x20 })
}

fn walk(path: &Path, name: Box<str>, mtime: i64, attrs: u32, depth: u32, pr: &Progress) -> Raw {
    let mut out = Raw {
        name,
        size: 0,
        mtime,
        attrs,
        flags: F_DIR,
        files: 0,
        dirs: 0,
        children: Vec::new(),
    };
    if pr.cancelled() || depth >= MAX_DEPTH {
        return out;
    }
    pr.note(path);

    let rd = match fs::read_dir(path) {
        Ok(rd) => rd,
        Err(_) => {
            pr.denied.fetch_add(1, Ordering::Relaxed);
            out.flags |= F_DENIED;
            return out;
        }
    };

    let mut subdirs: Vec<(PathBuf, Box<str>, i64, u32)> = Vec::new();
    let mut nfiles = 0u32;
    let mut nbytes = 0u64;

    for e in rd.flatten() {
        let md = match e.metadata() {
            Ok(md) => md,
            Err(_) => continue,
        };
        let (size, m, a) = meta_bits(&md);
        let ename: Box<str> = e.file_name().to_string_lossy().into_owned().into_boxed_str();
        let is_link = a & FILE_ATTRIBUTE_REPARSE_POINT != 0;

        if md.is_dir() && !is_link {
            subdirs.push((e.path(), ename, m, a));
        } else {
            nfiles += 1;
            nbytes += size;
            out.children.push(Raw {
                name: ename,
                size,
                mtime: m,
                attrs: a,
                flags: 0,
                files: 0,
                dirs: 0,
                children: Vec::new(),
            });
        }
    }

    pr.files.fetch_add(nfiles as u64, Ordering::Relaxed);
    pr.bytes.fetch_add(nbytes, Ordering::Relaxed);
    pr.dirs.fetch_add(subdirs.len() as u64, Ordering::Relaxed);
    out.files = nfiles;
    out.dirs = subdirs.len() as u32;
    out.size = nbytes;

    let done: Vec<Raw> = subdirs
        .into_par_iter()
        .map(|(p, n, m, a)| walk(&p, n, m, a, depth + 1, pr))
        .collect();

    for d in &done {
        out.size += d.size;
        out.files += d.files;
        out.dirs += d.dirs;
    }
    out.children.extend(done);
    out.children.sort_unstable_by(|a, b| b.size.cmp(&a.size));
    out
}

/// Aplana el arbol recursivo en el arena en orden BFS.
fn flatten(root: Raw, root_path: PathBuf) -> Tree {
    let mut nodes: Vec<Node> = Vec::with_capacity(root.files as usize + root.dirs as usize + 3);
    let mut queue: VecDeque<(u32, Vec<Raw>)> = VecDeque::new();

    let Raw { name, size, mtime, attrs, flags, files, dirs, children } = root;
    nodes.push(Node {
        name,
        size,
        mtime,
        attrs,
        parent: 0,
        first_child: 0,
        child_count: 0,
        files,
        dirs,
        flags,
    });
    queue.push_back((0, children));

    while let Some((pid, kids)) = queue.pop_front() {
        if kids.is_empty() {
            continue;
        }
        let first = nodes.len() as u32;
        nodes[pid as usize].first_child = first;
        nodes[pid as usize].child_count = kids.len() as u32;
        let mut pending = Vec::new();
        for (idx, k) in kids.into_iter().enumerate() {
            let Raw { name, size, mtime, attrs, flags, files, dirs, children } = k;
            nodes.push(Node {
                name,
                size,
                mtime,
                attrs,
                parent: pid,
                first_child: 0,
                child_count: 0,
                files,
                dirs,
                flags,
            });
            if !children.is_empty() {
                pending.push((first + idx as u32, children));
            }
        }
        queue.extend(pending);
    }

    Tree {
        nodes,
        root_path,
        volume_total: 0,
        volume_free: 0,
        scan_ms: 0,
        denied: 0,
    }
}

/// Capacidad, espacio libre y tipo del volumen que contiene `path`.
pub fn volume_info(path: &Path) -> (u64, u64, sysinfo::DiskKind) {
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();
    let mut best: Option<(usize, u64, u64, sysinfo::DiskKind)> = None;
    for d in disks.list() {
        let mp = d.mount_point();
        if path.starts_with(mp) {
            let len = mp.as_os_str().len();
            // Nos quedamos con el punto de montaje mas especifico.
            if best.map_or(true, |(l, _, _, _)| len > l) {
                best = Some((len, d.total_space(), d.available_space(), d.kind()));
            }
        }
    }
    best.map(|(_, t, f, k)| (t, f, k))
        .unwrap_or((0, 0, sysinfo::DiskKind::Unknown(-1)))
}

/// Cuantos hilos conviene lanzar contra este disco.
///
/// En un SSD cuantas mas peticiones en vuelo, mejor. En un disco mecanico es
/// justo al reves: cada hilo manda el cabezal a otra zona del plato y el
/// tiempo se va en desplazamientos, no en leer.
fn threads_for(kind: &sysinfo::DiskKind) -> usize {
    let cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    match kind {
        sysinfo::DiskKind::HDD => 2,
        _ => cpus.clamp(2, 16),
    }
}

pub fn scan(root_path: &Path, pr: &Progress) -> Tree {
    let t0 = Instant::now();
    let md = fs::metadata(root_path).ok();
    let (mtime, attrs) = md
        .as_ref()
        .map(|m| {
            let (_, t, a) = meta_bits(m);
            (t, a)
        })
        .unwrap_or((0, 0x10));

    let (total, free, kind) = volume_info(root_path);

    // Solo se conoce el total por adelantado si se analiza la unidad entera.
    if root_path.parent().is_none() {
        pr.expected.store(total.saturating_sub(free), Ordering::Relaxed);
    }

    let label: Box<str> = root_path.to_string_lossy().into_owned().into_boxed_str();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads_for(&kind))
        .build();
    let mut raw = match pool {
        Ok(p) => p.install(|| walk(root_path, label, mtime, attrs, 0, pr)),
        Err(_) => walk(root_path, label, mtime, attrs, 0, pr),
    };

    // El mapa solo muestra lo que OCUPA el disco, asi que no se dibuja el
    // espacio libre. Si se anade un bloque: el hueco entre lo que Windows dice
    // que esta usado y lo que se ha podido medir (carpetas sin permiso,
    // System Volume Information...), porque esos bytes si estan ocupados.
    if root_path.parent().is_none() && total > 0 && !pr.cancelled() {
        let unknown = total.saturating_sub(free).saturating_sub(raw.size);
        if unknown > total / 1000 {
            raw.size += unknown;
            raw.children.push(Raw {
                name: "<espacio no identificado>".into(),
                size: unknown,
                mtime: 0,
                attrs: 0,
                flags: F_UNKNOWN,
                files: 0,
                dirs: 0,
                children: Vec::new(),
            });
            raw.children.sort_unstable_by(|a, b| b.size.cmp(&a.size));
        }
    }

    let mut tree = flatten(raw, root_path.to_path_buf());
    tree.scan_ms = t0.elapsed().as_millis() as u64;
    tree.denied = pr.denied.load(Ordering::Relaxed);
    tree.volume_total = total;
    tree.volume_free = free;
    tree
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Escribe un archivo y CIERRA el descriptor. Importa: mientras un archivo
    /// sigue abierto, NTFS no refresca su tamano en la entrada de directorio y
    /// la enumeracion lo ve a cero.
    fn escribe(p: &Path, n: usize) {
        let mut f = fs::File::create(p).unwrap();
        f.write_all(&vec![0u8; n]).unwrap();
        f.flush().unwrap();
    }

    /// Comprueba lo unico que no es obvio del escaneo: que los tamanos suben
    /// bien por el arbol y que el arena queda coherente tras aplanar.
    #[test]
    fn escaneo_suma_y_arena_coherente() {
        let base = std::env::temp_dir().join(format!("ess_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("a/b")).unwrap();
        fs::create_dir_all(base.join("c")).unwrap();
        escribe(&base.join("a/b/uno.txt"), 1000);
        escribe(&base.join("a/dos.bin"), 500);
        escribe(&base.join("c/tres.log"), 250);

        let pr = Progress::default();
        let t = scan(&base, &pr);

        assert_eq!(t.nodes[0].size, 1750, "el total debe sumar los tres archivos");
        assert_eq!(t.nodes[0].files, 3);
        assert_eq!(t.nodes[0].dirs, 3, "a, a/b y c");

        // Cada hijo apunta a su padre y los rangos no se solapan.
        for (i, n) in t.nodes.iter().enumerate() {
            for c in n.first_child..n.first_child + n.child_count {
                assert_eq!(t.nodes[c as usize].parent, i as u32);
            }
        }
        // Las rutas reconstruidas existen de verdad.
        for i in 1..t.nodes.len() as u32 {
            assert!(t.path(i).exists(), "ruta invalida: {:?}", t.path(i));
        }
        let _ = fs::remove_dir_all(&base);
    }
}
