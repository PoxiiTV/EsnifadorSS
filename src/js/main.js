// Orquestacion de la aplicacion: pestanas, navegacion, filtro, panel lateral
// y todo lo que conecta el lienzo con el backend.

import { Treemap } from './treemap.js';
import { applyTheme, savedTheme, THEMES, THEME_IDS, categoryOf } from './themes.js';
import { $, $$, el, bytes, count, pct, when, duration, attrList, debounce, clamp } from './util.js';

const T = window.__TAURI__;
const invoke = T.core.invoke;
const listen = T.event.listen;
const appWindow = T.window.getCurrentWindow();

const F_DIR = 1;
const F_UNKNOWN = 4;

// -------------------------------------------------------------------- estado

const ui = {
  detail: 4,
  showFiles: true,
  colorBy: 'tamano',
  labels: true,
  suspects: false,
  aside: true,
  pane: 'detalles',
  theme: savedTheme(),
};

/** Una pestana = una sesion de escaneo en el backend. */
const tabs = [];
/** El selector de unidades se puede pedir aunque ya haya pestanas abiertas. */
let launcherOpen = false;
let active = null;
let selected = null; // nodo seleccionado en la pestana activa

const map = new Treemap($('#map'));

// --------------------------------------------------------------- preferencias

const PREFS = 'esnifadorss.prefs.v2';
function loadPrefs() {
  try {
    Object.assign(ui, JSON.parse(localStorage.getItem(PREFS) || '{}'), { theme: savedTheme() });
  } catch {
    /* preferencias corruptas o sin acceso: se usan las de fabrica */
  }
}
const savePrefs = debounce(() => {
  try {
    localStorage.setItem(PREFS, JSON.stringify(ui));
  } catch {
    /* ignorado */
  }
}, 300);

// ------------------------------------------------------------------ arranque

// Un fallo silencioso en el frontend se ve igual que un boton que no
// responde. Mejor que se vea el error.
let errShown = 0;
function reportError(msg) {
  console.error(msg);
  if (errShown++ > 2) return;
  const bar = el('div', { class: 'errbar' }, el('span', { text: String(msg).slice(0, 300) }));
  const x = el('button', { class: 'btn' }, '✕');
  x.onclick = () => bar.remove();
  bar.append(x);
  document.body.append(bar);
}
window.addEventListener('error', (e) => reportError(`${e.message} (${e.filename || '?'}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

loadPrefs();
map.setPalette(applyTheme(ui.theme));
map.setOptions(ui);
syncToolbar();
renderAside();
bindWindow();
bindToolbar();
bindCanvas();
bindKeyboard();
bindBackend();
loadDrives();

// El lienzo mide el texto al pintar. Si se pinta antes de que Inter y
// JetBrains Mono esten listas, los recortes salen calculados con la fuente
// de reserva y quedan mal.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    if (map.root) {
      map.paintBase();
      map.draw();
    }
  });
}

new ResizeObserver(() => {
  if (!map.resize()) return; // el observador dispara tambien sin cambio real
  if (active && active.view) {
    // Al cambiar el tamano cambia cuanto detalle cabe: se recarga la vista.
    loadView(active, active.node, null);
  } else {
    map.paintBase();
    map.draw();
  }
}).observe($('.stage'));

// ------------------------------------------------------------------- ventana

function bindWindow() {
  $('#credit').onclick = () =>
    invoke('open_author_page').catch((e) => alertBox('No se pudo abrir el enlace', String(e)));

  // WebView2 trae su propio menu contextual (Actualizar, Imprimir,
  // Inspeccionar...) que no pinta nada en una aplicacion de escritorio.
  // En los campos de texto si se deja, para poder pegar.
  document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
  });

  $('#win-min').onclick = () => appWindow.minimize();
  $('#win-max').onclick = () => appWindow.toggleMaximize();
  $('#win-close').onclick = () => appWindow.close();
}

// ------------------------------------------------------------------ unidades

async function loadDrives() {
  const box = $('#drives');
  const list = await invoke('list_drives').catch(() => []);
  box.replaceChildren(
    ...list.map((d, i) => {
      const used = d.total - d.free;
      const ratio = d.total ? used / d.total : 0;
      const node = el(
        'button',
        { class: 'drive', style: `animation-delay:${i * 45}ms`, title: `Analizar ${d.mount}` },
        el(
          'div',
          { class: 'top' },
          el('span', { class: 'letter', text: d.mount.replace(/\\$/, '') || d.name }),
          el('span', { class: 'kind', text: `${d.removable ? 'extraíble' : d.kind} · ${d.fs}` })
        ),
        el('div', { class: 'meter' }, el('i', { class: ratio > 0.9 ? 'warn' : '', style: `width:${(ratio * 100).toFixed(1)}%` })),
        el(
          'div',
          { class: 'figures' },
          el('span', { text: `${bytes(used)} usados` }),
          el('span', { text: `${bytes(d.free)} libres` })
        )
      );
      node.onclick = () => startScan(d.mount);
      return node;
    })
  );
  if (!list.length) {
    box.replaceChildren(el('div', { class: 'empty', text: 'No se ha detectado ninguna unidad.' }));
  }
}

// ------------------------------------------------------------------ pestanas

function newTab(path, sessionId) {
  const t = {
    id: sessionId,
    path,
    title: prettyName(path),
    node: 0,
    view: null,
    stats: null,
    scanning: true,
    progress: null,
    history: [0],
    hIndex: 0,
    filter: '',
    hits: null,
    dirty: false,
  };
  tabs.push(t);
  active = t;
  renderTabs();
  return t;
}

function prettyName(p) {
  const clean = p.replace(/[\\/]+$/, '');
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1] || clean || p;
}

function renderTabs() {
  $('#tabs').replaceChildren(
    ...tabs.map((t) => {
      const node = el(
        'button',
        { class: 'tab', 'aria-selected': String(t === active), title: t.path },
        t.scanning ? el('span', { class: 'dot' }) : null,
        el('span', { class: 'name', text: t.title }),
        el('span', { class: 'x', title: 'Cerrar (Ctrl+W)', text: '✕' })
      );
      node.onclick = (e) => {
        if (e.target.classList.contains('x')) closeTab(t);
        else selectTab(t);
      };
      node.onauxclick = (e) => {
        if (e.button === 1) closeTab(t);
      };
      return node;
    })
  );
  $('.launcher').hidden = tabs.length > 0 && !launcherOpen;
  $('#launcher-cancel').hidden = !tabs.length;
}

/** Muestra la portada con las unidades, por encima del mapa que haya. */
function showLauncher() {
  launcherOpen = true;
  loadDrives();
  renderTabs();
}

function hideLauncher() {
  if (!launcherOpen) return;
  launcherOpen = false;
  renderTabs();
}

function selectTab(t) {
  hideLauncher();
  if (active === t) return;
  active = t;
  selected = null;
  renderTabs();
  $('#filter').value = t.filter;
  if (t.view) {
    map.setData(t.view);
    map.draw();
  }
  refreshChrome();
}

async function closeTab(t) {
  const i = tabs.indexOf(t);
  if (i < 0) return;
  await invoke('close_session', { session: t.id }).catch(() => {});
  tabs.splice(i, 1);
  if (active === t) {
    active = tabs[Math.min(i, tabs.length - 1)] || null;
    selected = null;
    if (active && active.view) map.setData(active.view);
  }
  renderTabs();
  refreshChrome();
  if (!tabs.length) {
    map.rects = [];
    map.root = null;
    map.paintBase();
    map.draw();
    loadDrives();
  }
}

// ------------------------------------------------------------------- escaneo

async function startScan(path, tab) {
  try {
    const id = await invoke('start_scan', { path, session: tab ? tab.id : null });
    const t = tab || newTab(path, id);
    launcherOpen = false;
    t.id = id;
    t.scanning = true;
    t.dirty = false;
    t.node = 0;
    t.history = [0];
    t.hIndex = 0;
    active = t;
    t.view = null;
    map.root = null;
    map.rects = [];
    map.paintBase();
    map.draw();
    renderTabs();
    refreshChrome();
  } catch (e) {
    alertBox('No se pudo iniciar el análisis', String(e));
  }
}

/**
 * Porcentaje y tiempo restante. Solo se conoce el total esperado al analizar
 * una unidad entera; en una subcarpeta no hay forma de saberlo de antemano y
 * entonces la barra se queda oculta.
 */
function showProgress(t, p) {
  const bar = $('#work-bar');
  if (!p.expected || !p.bytes) {
    bar.hidden = true;
    $('#work-eta').textContent = p.expected ? '' : 'Midiendo…';
    return;
  }
  const frac = clamp(p.bytes / p.expected, 0, 0.999);
  bar.hidden = false;
  $('#work-fill').style.width = (frac * 100).toFixed(1) + '%';

  // El ritmo de lectura da tumbos: carpetas con miles de archivos diminutos
  // frente a un video de 8 GB. Por eso la estimacion se suaviza; en crudo el
  // numero salta de 10 s a 3 min y no sirve para nada.
  const crudo = (p.elapsed / frac) * (1 - frac);
  t.eta = t.eta ? t.eta * 0.75 + crudo * 0.25 : crudo;
  $('#work-eta').textContent =
    (frac * 100).toFixed(0) + ' % · quedan ' + duration(Math.round(t.eta));
}

function bindBackend() {
  listen('scan:progress', ({ payload }) => {
    const t = tabs.find((x) => x.id === payload.session);
    if (!t) return;
    t.progress = payload;
    if (t === active) {
      $('#st-main').innerHTML = `Analizando… <b>${count(payload.files)}</b> archivos · <b>${bytes(payload.bytes)}</b>`;
      $('#st-path').textContent = payload.current;
      $('#work-files').textContent = count(payload.files);
      $('#work-bytes').textContent = bytes(payload.bytes);
      $('#work-dirs').textContent = count(payload.dirs);
      $('#work-path').textContent = payload.current;
      showProgress(t, payload);
    }
  });

  listen('scan:done', async ({ payload }) => {
    const t = tabs.find((x) => x.id === payload.session);
    if (!t) return;
    t.scanning = false;
    t.eta = 0;
    t.stats = payload;
    if (payload.cancelled && !payload.nodes) return;
    t.title = prettyName(payload.root);
    renderTabs();
    if (t === active) {
      $('#scanbar').hidden = true;
      $('#st-path').textContent = '';
      await loadView(t, 0, null);
    }
  });

  listen('fs:changed', ({ payload }) => {
    const t = tabs.find((x) => x.id === payload);
    if (!t || t.scanning || t.dirty) return;
    t.dirty = true;
    if (t === active) showToast('El disco ha cambiado desde el análisis.', 'Volver a analizar', () => startScan(t.path, t));
  });
}

// ---------------------------------------------------------------- navegacion

/**
 * Pide al backend la porcion del arbol que cabe en pantalla y la dibuja.
 * `anim` indica si hay que animar la transicion y en que sentido.
 */
async function loadView(t, node, anim) {
  if (!t || t.scanning) return;
  const area = Math.max(1, map.W * map.H);
  try {
    const view = await invoke('get_view', {
      session: t.id,
      node,
      maxDepth: ui.detail,
      // Un bloque por debajo de ~4 px² no aporta nada: se agrupa en el resto.
      minRatio: 4 / area,
      showFiles: ui.showFiles,
      maxNodes: 60000,
    });
    view.filtering = !!t.hits;
    t.view = view;
    t.node = node;

    if (anim) map.snapshot();
    map.setData(view);
    if (anim) map.transition(anim.rect, anim.dir);
    else map.draw();

    selected = null;
    map.selectNode(null);
    await refreshChrome();
  } catch (e) {
    console.error(e);
  }
}

function pushHistory(t, node) {
  t.history = t.history.slice(0, t.hIndex + 1);
  t.history.push(node);
  t.hIndex = t.history.length - 1;
}

async function enter(t, node, rect) {
  if (node === t.node) return;
  pushHistory(t, node);
  await loadView(t, node, rect ? { rect, dir: 'in' } : null);
}

async function goUp() {
  const t = active;
  if (!t || !t.view || t.node === 0) return;
  const crumbs = await invoke('breadcrumb', { session: t.id, node: t.node }).catch(() => []);
  if (crumbs.length < 2) return;
  const parent = crumbs[crumbs.length - 2].i;
  const child = t.node;
  pushHistory(t, parent);
  map.snapshot(); // guarda la vista hija antes de repintar
  await loadView(t, parent, null);
  // Ya con el mapa del padre montado sabemos donde estaba el hijo.
  const rect = map.rectOf(child);
  if (rect) map.transition(rect, 'out');
}

async function goHistory(delta) {
  const t = active;
  if (!t) return;
  const i = t.hIndex + delta;
  if (i < 0 || i >= t.history.length) return;
  t.hIndex = i;
  await loadView(t, t.history[i], null);
}

// ------------------------------------------------------------------- toolbar

function bindToolbar() {
  $('#act-scan').onclick = () => showLauncher();
  $('#tab-add').onclick = () => showLauncher();
  $('#pick-folder').onclick = () => pickFolder();
  $('#show-help').onclick = () => helpDialog();
  $('#launcher-cancel').onclick = () => hideLauncher();

  $('#act-stop').onclick = () => {
    if (active) invoke('cancel_scan', { session: active.id });
  };
  $('#act-refresh').onclick = () => active && startScan(active.path, active);
  $('#nav-up').onclick = () => goUp();
  $('#nav-back').onclick = () => goHistory(-1);
  $('#nav-fwd').onclick = () => goHistory(1);
  $('#nav-home').onclick = () => active && enter(active, 0, null);

  $('#detail-up').onclick = () => setDetail(ui.detail + 1);
  $('#detail-down').onclick = () => setDetail(ui.detail - 1);

  $('#act-aside').onclick = () => {
    ui.aside = !ui.aside;
    syncToolbar();
    savePrefs();
    requestAnimationFrame(() => map.resize());
  };
  $('#act-theme').onclick = (e) => themeMenu(e.currentTarget);
  $('#act-view').onclick = (e) => viewMenu(e.currentTarget);

  $('#filter').oninput = debounce((e) => applyFilter(e.target.value), 220);
  $('#filter-clear').onclick = () => {
    $('#filter').value = '';
    applyFilter('');
  };

  $$('#aside-tabs button').forEach((b) => {
    b.onclick = () => {
      ui.pane = b.dataset.pane;
      $$('#aside-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      savePrefs();
      renderAside();
    };
  });

  // Soltar una carpeta sobre la ventana la analiza.
  appWindow.onDragDropEvent((ev) => {
    if (ev.payload.type === 'drop' && ev.payload.paths?.length) startScan(ev.payload.paths[0]);
  });
}

async function pickFolder() {
  const dir = await T.dialog.open({ directory: true, multiple: false, title: 'Elige la carpeta o unidad a analizar' });
  if (dir) startScan(Array.isArray(dir) ? dir[0] : dir);
}

const reloadSoon = debounce(() => {
  if (active) loadView(active, active.node, null);
}, 90);

function setDetail(v) {
  const next = clamp(v, 1, 12);
  if (next === ui.detail) return;
  ui.detail = next;
  syncToolbar();
  savePrefs();
  reloadSoon();
}

function syncToolbar() {
  $('#detail-label').textContent = ui.detail;
  // La pestana de limpieza solo existe si se activa en el menu de vista.
  const clean = $$('#aside-tabs button').find((b) => b.dataset.pane === 'prescindibles');
  if (clean) clean.hidden = !ui.suspects;
  if (!ui.suspects && ui.pane === 'prescindibles') ui.pane = 'detalles';
  $('#act-aside').setAttribute('aria-pressed', String(ui.aside));
  $('#aside').hidden = !ui.aside;
  $$('#aside-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.pane === ui.pane)));
  map.setOptions(ui);
}

async function refreshChrome() {
  const t = active;
  const scanning = !!t && t.scanning;
  $('#act-stop').hidden = !scanning;
  $('#scanbar').hidden = !scanning;
  $('#working').hidden = !scanning;
  $('#work-title').textContent = t ? t.path : '';
  $('#act-refresh').disabled = !t || scanning;
  $('#nav-up').disabled = !t || scanning || t.node === 0;
  $('#nav-home').disabled = !t || scanning || t.node === 0;
  $('#nav-back').disabled = !t || t.hIndex <= 0;
  $('#nav-fwd').disabled = !t || !t.history || t.hIndex >= t.history.length - 1;

  if (!t) {
    $('#crumbs').replaceChildren();
    $('#st-main').textContent = 'Listo';
    $('#st-right').textContent = '';
    $('#st-path').textContent = '';
    renderAside();
    return;
  }
  if (!scanning && t.stats) {
    const s = t.stats;
    $('#st-main').innerHTML = `<b>${bytes(t.view ? t.view.s : s.size)}</b> · <b>${count(s.files)}</b> archivos · <b>${count(s.dirs)}</b> carpetas`;
    $('#st-right').innerHTML =
      `${count(s.nodes)} nodos · ${duration(s.ms)}` +
      (s.denied ? ` · <button class="linky" id="denied-btn">${count(s.denied)} sin acceso</button>` : '') +
      (s.cancelled ? ' · <span style="color:var(--danger)">incompleto</span>' : '');
  }
  const dbtn = $('#denied-btn');
  if (dbtn) dbtn.onclick = deniedDialog;
  await renderCrumbs();
  renderAside();
}

/**
 * Lista de carpetas que no se pudieron leer. Va en un dialogo para no robarle
 * sitio permanente a la interfaz.
 */
async function deniedDialog() {
  const t = active;
  if (!t) return;
  const list = await invoke('denied_folders', { session: t.id, limit: 3000 }).catch(() => []);
  const box = el('div', { class: 'list' });
  for (const d of list) box.append(el('div', { text: d.path }));
  if (!list.length) box.append(el('div', { text: 'Ninguna.' }));
  modal(
    el(
      'div',
      {},
      el('h2', { text: `${count(list.length)} carpetas sin acceso` }),
      el('p', {
        text:
          'Windows reserva algunas carpetas al usuario SYSTEM y ni siquiera un administrador ' +
          'puede leerlas. Lo que ocupan aparece en el mapa agrupado como «espacio no identificado».',
      }),
      box
    ),
    [{ label: 'Cerrar', primary: true, run: () => {} }]
  );
}

async function renderCrumbs() {
  const t = active;
  const box = $('#crumbs');
  if (!t || t.scanning) {
    box.replaceChildren();
    return;
  }
  const crumbs = await invoke('breadcrumb', { session: t.id, node: t.node }).catch(() => []);
  const kids = [];
  crumbs.forEach((c, i) => {
    if (i) kids.push(el('span', { class: 'crumb-sep', text: '›' }));
    const b = el('button', { class: 'crumb', text: c.n, title: c.n });
    b.onclick = () => enter(t, c.i, null);
    kids.push(b);
  });
  box.replaceChildren(...kids);
  box.scrollLeft = box.scrollWidth;
}

// -------------------------------------------------------------------- filtro

async function applyFilter(expr) {
  const t = active;
  $('#filter-clear').hidden = !expr;
  if (!t || t.scanning) return;
  t.filter = expr;
  try {
    const r = await invoke('set_filter', { session: t.id, expr });
    t.hits = expr.trim() ? r : null;
    $('#filter-hits').textContent = t.hits ? `${count(r.matches)} · ${bytes(r.bytes)}` : '';
    await loadView(t, t.node, null);
  } catch (e) {
    $('#filter-hits').textContent = '';
    console.error(e);
  }
}

// ------------------------------------------------------------------- lienzo

function bindCanvas() {
  const c = $('#map');
  let tipTimer = null;
  let tipOpen = false;

  const hideTip = () => {
    clearTimeout(tipTimer);
    $('#tip').dataset.hidden = '1';
    tipOpen = false;
  };

  c.addEventListener('mousemove', (e) => {
    if (!active || active.scanning) return;
    const r = c.getBoundingClientRect();
    const hit = map.hitTest(e.clientX - r.left, e.clientY - r.top);
    if (map.setHover(hit)) map.draw();

    if (!hit || hit.node.rest) {
      hideTip();
      $('#st-path').textContent = '';
      return;
    }
    $('#st-path').textContent = `${hit.node.n} — ${bytes(hit.node.s)}`;
    // La primera vez se hace esperar; luego el tooltip sigue al raton al vuelo.
    clearTimeout(tipTimer);
    const show = () => {
      tipOpen = true;
      showTip(hit, e.clientX, e.clientY);
    };
    if (tipOpen) show();
    else tipTimer = setTimeout(show, 380);
  });

  c.addEventListener('mouseleave', () => {
    hideTip();
    if (map.setHover(null)) map.draw();
    $('#st-path').textContent = '';
  });

  c.addEventListener('click', (e) => {
    const r = c.getBoundingClientRect();
    const hit = map.hitTest(e.clientX - r.left, e.clientY - r.top);
    selected = hit && !hit.node.rest ? hit.node : null;
    map.selectNode(selected ? selected.i : null);
    map.draw();
    renderAside();
  });

  c.addEventListener('dblclick', (e) => {
    if (!active) return;
    const r = c.getBoundingClientRect();
    const hit = map.hitTest(e.clientX - r.left, e.clientY - r.top);
    if (!hit || hit.node.rest) return;
    hideTip();
    if (hit.node.d & F_DIR) enter(active, hit.node.i, { x: hit.x, y: hit.y, w: hit.w, h: hit.h });
    else invoke('open_item', { session: active.id, node: hit.node.i }).catch((err) => alertBox('No se pudo abrir', String(err)));
  });

  c.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!active || active.scanning) return;
    const r = c.getBoundingClientRect();
    const hit = map.hitTest(e.clientX - r.left, e.clientY - r.top);
    hideTip();
    if (!hit || hit.node.rest) {
      goUp();
      return;
    }
    selected = hit.node;
    map.selectNode(selected.i);
    map.draw();
    renderAside();
    itemMenu(hit, e.clientX, e.clientY);
  });

  // La rueda cambia el nivel de detalle: es el gesto que ya espera cualquiera.
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    setDetail(ui.detail + (e.deltaY < 0 ? 1 : -1));
  }, { passive: false });
}

function showTip(hit, mx, my) {
  const n = hit.node;
  const tip = $('#tip');
  const parent = map.rects.find((r) => r.depth === 0);
  const rows = [el('div', { class: 't', text: n.n })];
  const kind = n.d & F_UNKNOWN ? 'No identificado' : n.d & F_DIR ? 'Carpeta' : categoryOf(n.n);
  rows.push(
    el('div', { class: 's', text: `${bytes(n.s)} · ${pct(n.s, parent ? parent.node.s : n.s)} · ${kind}` })
  );
  if (n.d & F_DIR) rows.push(el('div', { class: 's', text: `${count(n.fc)} archivos · ${count(n.dc)} carpetas` }));
  if (n.m) rows.push(el('div', { class: 's', text: `Modificado: ${when(n.m)}` }));
  tip.replaceChildren(...rows);
  tip.dataset.hidden = '0';

  // Se coloca junto al cursor sin salirse de la ventana.
  const r = tip.getBoundingClientRect();
  const x = Math.min(mx + 16, window.innerWidth - r.width - 8);
  const y = my + r.height + 26 > window.innerHeight ? my - r.height - 12 : my + 20;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

// ------------------------------------------------------------------- menus

function popup(x, y, items, origin = 'top left') {
  closePop();
  const p = el('div', { class: 'pop', style: `--origin:${origin}` });
  for (const it of items) {
    if (it === '-') {
      p.append(el('hr'));
      continue;
    }
    if (it.head) {
      p.append(el('div', { class: 'head', text: it.head }));
      continue;
    }
    const b = el(
      'button',
      { class: it.danger ? 'danger' : '', disabled: it.disabled || false },
      el('span', { class: 'ico', text: it.ico || '' }),
      el('span', { text: it.label }),
      it.key ? el('span', { class: 'key', text: it.key }) : null,
      it.checked ? el('span', { class: 'check', text: '✓' }) : null,
      it.chips || null
    );
    if (!it.disabled) {
      b.onclick = () => {
        closePop();
        it.run();
      };
    }
    p.append(b);
  }
  const back = el('div', { class: 'pop-back' });
  back.onmousedown = (e) => {
    e.preventDefault();
    closePop();
  };
  back.oncontextmenu = (e) => {
    e.preventDefault();
    closePop();
  };
  document.body.append(back, p);
  const r = p.getBoundingClientRect();
  p.style.left = `${clamp(x, 6, window.innerWidth - r.width - 6)}px`;
  p.style.top = `${clamp(y, 6, window.innerHeight - r.height - 6)}px`;
  return p;
}

function closePop() {
  $$('.pop, .pop-back').forEach((p) => p.remove());
}

function anchor(btn) {
  const r = btn.getBoundingClientRect();
  return [r.left, r.bottom + 6];
}

function themeMenu(btn) {
  const [x, y] = anchor(btn);
  popup(
    x,
    y,
    [
      { head: 'Tema' },
      ...THEME_IDS.map((id) => {
        const t = THEMES[id];
        const chips = el(
          'span',
          { class: 'chips' },
          el('i', { style: `background:${t.ui.accent}` }),
          el('i', { style: `background:${t.ui.accent2}` }),
          el('i', { style: `background:${t.ui.panelSolid};box-shadow:inset 0 0 0 1px ${t.ui.stroke}` })
        );
        return {
          label: t.label,
          checked: id === ui.theme,
          chips,
          run: () => setTheme(id),
        };
      }),
    ],
    'top right'
  ).querySelectorAll('button').forEach((b) => b.classList.add('theme-row'));
}

function setTheme(id) {
  ui.theme = id;
  map.setPalette(applyTheme(id));
  map.paintBase();
  map.draw();
  savePrefs();
  renderAside();
}

function viewMenu(btn) {
  const [x, y] = anchor(btn);
  const toggle = (k) => () => {
    ui[k] = !ui[k];
    map.setOptions(ui);
    savePrefs();
    if (k === 'showFiles' && active) loadView(active, active.node, null);
    else {
      map.paintBase();
      map.draw();
    }
  };
  const color = (v) => () => {
    ui.colorBy = v;
    map.setOptions(ui);
    savePrefs();
    map.paintBase();
    map.draw();
    renderAside();
  };
  popup(
    x,
    y,
    [
      { head: 'Colorear por' },
      { label: 'Tipo de archivo', ico: '◆', checked: ui.colorBy === 'tipo', run: color('tipo') },
      { label: 'Antigüedad', ico: '◷', checked: ui.colorBy === 'antiguedad', run: color('antiguedad') },
      { label: 'Tamaño', ico: '▤', checked: ui.colorBy === 'tamano', run: color('tamano') },
      '-',
      { head: 'Mostrar' },
      { label: 'Archivos', ico: '▪', checked: ui.showFiles, run: toggle('showFiles') },
      { label: 'Nombres', ico: 'A', checked: ui.labels, run: toggle('labels') },
      '-',
      { head: 'Avanzado' },
      {
        label: 'Buscar carpetas prescindibles',
        ico: '✦',
        checked: ui.suspects,
        run: () => {
          ui.suspects = !ui.suspects;
          if (ui.suspects) ui.pane = 'prescindibles';
          else if (ui.pane === 'prescindibles') ui.pane = 'detalles';
          savePrefs();
          syncToolbar();
          renderAside();
        },
      },
      '-',
      { label: 'Exportar informe…', ico: '⇩', disabled: !active || active.scanning, run: exportReport },
      { label: 'Ayuda de filtros', ico: '?', key: 'F1', run: helpDialog },
    ],
    'top right'
  );
}

function itemMenu(hit, x, y) {
  const t = active;
  const n = hit.node;
  const pseudo = !!(n.d & F_UNKNOWN);
  const isDir = !!(n.d & F_DIR);
  popup(x, y, [
    { label: 'Abrir', ico: '▷', disabled: pseudo, run: () => act('open_item', n) },
    { label: 'Mostrar en el Explorador', ico: '⌸', disabled: pseudo, run: () => act('reveal_item', n) },
    { label: 'Propiedades', ico: '☰', disabled: pseudo, run: () => act('properties_item', n) },
    '-',
    { label: 'Entrar aquí', ico: '⤢', disabled: !isDir, key: 'Doble clic', run: () => enter(t, n.i, hit) },
    { label: 'Subir un nivel', ico: '↑', disabled: t.node === 0, key: 'Retroceso', run: goUp },
    '-',
    { label: 'Copiar ruta', ico: '⧉', disabled: pseudo, run: () => copyPath(n) },
    '-',
    { label: 'Enviar a la papelera', ico: '🗑', danger: true, disabled: pseudo, key: 'Supr', run: () => confirmDelete(n, false) },
    { label: 'Eliminar permanentemente', ico: '⨯', danger: true, disabled: pseudo, key: 'May+Supr', run: () => confirmDelete(n, true) },
  ]);
}

function act(cmd, n) {
  invoke(cmd, { session: active.id, node: n.i }).catch((e) => alertBox('No se pudo completar', String(e)));
}

async function copyPath(n) {
  const info = await invoke('node_info', { session: active.id, node: n.i }).catch(() => null);
  if (info) {
    await navigator.clipboard.writeText(info.path).catch(() => {});
    flashStatus('Ruta copiada al portapapeles');
  }
}

// -------------------------------------------------------------------- borrado

function confirmDelete(n, permanent) {
  const t = active;
  const isDir = !!(n.d & F_DIR);
  const body = el(
    'div',
    {},
    el('h2', { text: permanent ? 'Eliminar permanentemente' : 'Enviar a la papelera' }),
    el('p', {
      html: permanent
        ? `Se va a borrar <b>${escapeHtml(n.n)}</b> (${bytes(n.s)})${isDir ? ' y todo su contenido' : ''}. <b>Esta acción no se puede deshacer</b> y el archivo no pasará por la papelera.`
        : `Se enviará <b>${escapeHtml(n.n)}</b> (${bytes(n.s)})${isDir ? ' y todo su contenido' : ''} a la papelera de reciclaje. Podrás recuperarlo desde allí.`,
    })
  );
  modal(body, [
    { label: 'Cancelar', run: () => {} },
    {
      label: permanent ? 'Eliminar para siempre' : 'Enviar a la papelera',
      danger: true,
      primary: true,
      run: async () => {
        try {
          const r = await invoke('delete_items', { session: t.id, nodes: [n.i], permanent });
          if (r.errors.length) alertBox('Algunos elementos no se pudieron borrar', r.errors.join('\n'));
          else flashStatus(`Liberados ${bytes(r.freed)}`);
          await loadView(t, t.node, null);
        } catch (e) {
          alertBox('No se pudo borrar', String(e));
        }
      },
    },
  ]);
}

async function exportReport() {
  const t = active;
  const dest = await T.dialog.save({
    title: 'Guardar informe',
    defaultPath: `informe-${t.title.replace(/[^\w.-]+/g, '_')}.txt`,
    filters: [{ name: 'Texto', extensions: ['txt'] }],
  });
  if (!dest) return;
  try {
    await invoke('export_report', { session: t.id, node: t.node, depth: Math.max(ui.detail, 6), dest });
    flashStatus('Informe guardado');
  } catch (e) {
    alertBox('No se pudo guardar el informe', String(e));
  }
}

// -------------------------------------------------------------- panel lateral

function renderAside() {
  const body = $('#aside-body');
  const t = active;
  if (!t || t.scanning || !t.view) {
    body.replaceChildren(
      el('div', {
        class: 'empty',
        text: t && t.scanning ? 'Analizando el disco…' : 'Elige una unidad o carpeta para empezar.',
      })
    );
    return;
  }
  if (ui.pane === 'mayores') return renderTop(body, t);
  if (ui.pane === 'tipos') return renderTypes(body, t);
  if (ui.pane === 'prescindibles') return renderSuspects(body, t);
  renderDetails(body, t);
}

async function renderDetails(body, t) {
  const target = selected ? selected.i : t.node;
  const info = await invoke('node_info', { session: t.id, node: target }).catch(() => null);
  if (!info) return;
  const cards = [
    el(
      'div',
      { class: 'card' },
      el('h3', { text: selected ? 'Elemento seleccionado' : 'Carpeta actual' }),
      el('div', { class: 'pathline', text: info.path }),
      el(
        'dl',
        { class: 'kv' },
        el('dt', { text: 'Tamaño' }),
        el('dd', { html: `<b>${bytes(info.size)}</b>` }),
        el('dt', { text: 'Del padre' }),
        el('dd', { text: pct(info.size, info.parent_size) }),
        el('dt', { text: 'Del total' }),
        el('dd', { text: pct(info.size, info.root_size) }),
        el('dt', { text: 'Tipo' }),
        el('dd', { text: info.is_dir ? 'Carpeta' : categoryOf(info.name) }),
        ...(info.is_dir
          ? [
              el('dt', { text: 'Contiene' }),
              el('dd', { text: `${count(info.files)} archivos · ${count(info.dirs)} carpetas` }),
            ]
          : []),
        el('dt', { text: 'Modificado' }),
        el('dd', { text: when(info.mtime) }),
        el('dt', { text: 'Atributos' }),
        el('dd', { text: attrList(info.attrs) }),
        el('dt', { text: 'Profundidad' }),
        el('dd', { text: String(info.depth) })
      )
    ),
  ];

  if (t.stats && t.stats.volume_total) {
    const s = t.stats;
    const used = s.volume_total - s.volume_free;
    cards.push(
      el(
        'div',
        { class: 'card' },
        el('h3', { text: 'Volumen' }),
        el('div', { class: 'meter' }, el('i', { class: used / s.volume_total > 0.9 ? 'warn' : '', style: `width:${((used / s.volume_total) * 100).toFixed(1)}%` })),
        el(
          'dl',
          { class: 'kv' },
          el('dt', { text: 'Capacidad' }),
          el('dd', { text: bytes(s.volume_total) }),
          el('dt', { text: 'Usado' }),
          el('dd', { text: `${bytes(used)} · ${pct(used, s.volume_total)}` }),
          el('dt', { text: 'Libre' }),
          el('dd', { text: bytes(s.volume_free) }),
          el('dt', { text: 'Analizado en' }),
          el('dd', { text: duration(s.ms) })
        )
      )
    );
  }

  if (selected) {
    const row = el('div', { class: 'card' }, el('h3', { text: 'Acciones' }));
    const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:6px' });
    const mk = (label, fn, cls = 'btn solid') => {
      const b = el('button', { class: cls, style: 'justify-content:center' }, label);
      b.onclick = fn;
      return b;
    };
    const pseudo = !!(selected.d & F_UNKNOWN);
    if (!pseudo) {
      grid.append(
        mk('Abrir', () => act('open_item', selected)),
        mk('Explorador', () => act('reveal_item', selected)),
        mk('Copiar ruta', () => copyPath(selected)),
        mk('Papelera', () => confirmDelete(selected, false), 'btn solid danger')
      );
    }
    row.append(grid);
    if (!pseudo) cards.push(row);
  }

  body.replaceChildren(...cards);
}

async function renderTop(body, t) {
  const [files, dirs] = await Promise.all([
    invoke('top_items', { session: t.id, node: t.node, dirs: false, limit: 20 }),
    invoke('top_items', { session: t.id, node: t.node, dirs: true, limit: 20 }),
  ]).catch(() => [[], []]);

  const list = (title, items) => {
    const max = items.length ? items[0].s : 1;
    const card = el('div', { class: 'card' }, el('h3', { text: title }));
    const rank = el('div', { class: 'rank' });
    if (!items.length) rank.append(el('div', { class: 'empty', text: 'Nada que mostrar' }));
    for (const it of items) {
      const b = el(
        'button',
        { title: it.path },
        el('span', { class: 'nm', text: it.n }),
        el('span', { class: 'sz', text: bytes(it.s) }),
        el('div', { class: 'bar' }, el('i', { style: `width:${((it.s / max) * 100).toFixed(1)}%` }))
      );
      b.onclick = () => {
        if (it.d & F_DIR) enter(t, it.i, null);
        else {
          selected = { i: it.i, n: it.n, s: it.s, d: it.d };
          map.selectNode(it.i);
          map.draw();
          ui.pane = 'detalles';
          syncToolbar();
          renderAside();
        }
      };
      rank.append(b);
    }
    card.append(rank);
    return card;
  };

  body.replaceChildren(list('20 archivos más grandes', files), list('20 carpetas más grandes', dirs));
}

async function renderSuspects(body, t) {
  const list = await invoke('suspects', { session: t.id, node: t.node, limit: 200 }).catch(() => []);
  if (!list.length) {
    body.replaceChildren(
      el('div', {
        class: 'empty',
        text: 'Nada prescindible por aquí. Prueba desde la raíz del disco.',
      })
    );
    return;
  }
  const seguro = list.filter((x) => x.risk === 'safe');
  const total = seguro.reduce((a, b) => a + b.size, 0);

  const fila = (x) => {
    const row = el(
      'div',
      { class: 'suspect', title: x.path },
      el('span', { class: 'nm', text: x.name }),
      el('span', { class: 'sz', text: bytes(x.size) }),
      el('span', { class: `badge ${x.risk}`, text: x.risk === 'safe' ? 'se regenera' : 'revisa' }),
      el('span', { class: 'why', text: x.label })
    );
    const go = el('button', { class: 'go', title: 'Ver en el mapa' }, '⤢');
    go.onclick = () => enter(t, x.i, null);
    const del = el('button', { class: 'del', title: 'Enviar a la papelera' }, '✕');
    del.onclick = () => confirmDelete({ i: x.i, n: x.name, s: x.size, d: 1 }, false);
    row.append(go, del);
    return row;
  };

  const grupo = (titulo, items) => {
    if (!items.length) return null;
    const card = el('div', { class: 'card' }, el('h3', { text: titulo }));
    for (const x of items) card.append(fila(x));
    return card;
  };

  body.replaceChildren(
    el(
      'div',
      { class: 'card' },
      el('h3', { text: 'Recuperable sin riesgo' }),
      el(
        'div',
        { class: 'total-line' },
        el('b', { text: bytes(total) }),
        el('span', {
          style: 'color:var(--fg-dim);font-size:12px',
          text: `${count(seguro.length)} carpetas`,
        })
      ),
      el('div', {
        class: 'why',
        style: 'color:var(--fg-mute);font-size:11px;line-height:1.5',
        text:
          'Solo se listan carpetas que las propias herramientas vuelven a crear. ' +
          'Nada que pueda guardar trabajo tuyo.',
      })
    ),
    grupo('Se regeneran solas', seguro),
    grupo('Revisa antes de borrar', list.filter((x) => x.risk === 'review'))
  );
}

async function renderTypes(body, t) {
  const stats = await invoke('by_extension', { session: t.id, node: t.node, limit: 24 }).catch(() => []);
  const total = stats.reduce((a, b) => a + b.size, 0) || 1;
  const pal = map.palette;
  const card = el('div', { class: 'card' }, el('h3', { text: 'Reparto por extensión' }));
  const box = el('div', { class: 'swatches' });
  for (const s of stats) {
    const color = pal.cat[categoryOf(`x.${s.ext}`)] || pal.cat.otro;
    box.append(
      el(
        'div',
        { class: 'swatch', title: `${count(s.count)} archivos` },
        el('i', { style: `background:${color}` }),
        el('b', { text: s.ext }),
        el('span', { text: `${bytes(s.size)} · ${pct(s.size, total)}` })
      )
    );
  }
  if (!stats.length) box.append(el('div', { class: 'empty', text: 'Sin archivos en esta carpeta' }));
  card.append(box);

  // Leyenda de familias: explica los colores del mapa.
  const legend = el('div', { class: 'card' }, el('h3', { text: 'Familias de archivo' }));
  const lbox = el('div', { class: 'swatches' });
  for (const [k, v] of Object.entries(pal.cat)) {
    lbox.append(el('div', { class: 'swatch' }, el('i', { style: `background:${v}` }), el('b', { text: k }), el('span', { text: '' })));
  }
  lbox.append(
    el('div', { class: 'swatch' }, el('i', { style: `background:${pal.unknown}` }), el('b', { text: 'no identificado' }), el('span', {}))
  );
  legend.append(lbox);
  body.replaceChildren(card, legend);
}

// -------------------------------------------------------------------- teclado

function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    const typing = e.target.tagName === 'INPUT';
    if (e.key === 'Escape') {
      closePop();
      $$('.scrim').forEach((s) => s.remove());
      hideLauncher();
      if (typing) {
        e.target.value = '';
        applyFilter('');
        e.target.blur();
      }
      return;
    }
    if (e.key === 'F1') {
      e.preventDefault();
      helpDialog();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('#filter').focus();
      $('#filter').select();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      showLauncher();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      if (active) closeTab(active);
      return;
    }
    // Atajos del navegador: recargar perderia el analisis entero.
    if (e.ctrlKey && 'rpsuj'.includes(e.key.toLowerCase())) {
      e.preventDefault();
      if (e.key.toLowerCase() === 'r' && active && !active.scanning) startScan(active.path, active);
      return;
    }
    if (e.key === 'F5') {
      e.preventDefault();
      if (active && !active.scanning) startScan(active.path, active);
      return;
    }
    if (typing) return;

    switch (e.key) {
      case 'Backspace':
        e.preventDefault();
        goUp();
        break;
      case 'Home':
        if (active) enter(active, 0, null);
        break;
      case 'ArrowLeft':
        if (e.altKey) goHistory(-1);
        break;
      case 'ArrowRight':
        if (e.altKey) goHistory(1);
        break;
      case '+':
      case '=':
        setDetail(ui.detail + 1);
        break;
      case '-':
        setDetail(ui.detail - 1);
        break;
      case 'Delete':
        if (selected && active) confirmDelete(selected, e.shiftKey);
        break;
      default:
        break;
    }
  });
}

// -------------------------------------------------------------------- dialogos

function modal(content, buttons) {
  const scrim = el('div', { class: 'scrim' });
  const box = el('div', { class: 'modal' }, content);
  const row = el('div', { class: 'row' });
  for (const b of buttons) {
    const btn = el('button', { class: `btn wide ${b.primary ? 'primary' : 'solid'} ${b.danger ? 'danger' : ''}` }, b.label);
    btn.onclick = () => {
      scrim.remove();
      b.run();
    };
    row.append(btn);
  }
  box.append(row);
  scrim.append(box);
  scrim.onmousedown = (e) => {
    if (e.target === scrim) scrim.remove();
  };
  document.body.append(scrim);
  const first = row.querySelector('.btn.primary') || row.querySelector('.btn');
  first?.focus();
  return scrim;
}

function alertBox(title, text) {
  modal(el('div', {}, el('h2', { text: title }), el('div', { class: 'list', text })), [
    { label: 'Entendido', primary: true, run: () => {} },
  ]);
}

const FILTER_HELP = [
  ['*.mp4|*.mkv', 'Varias alternativas separadas por |'],
  ['>500mb', 'Más grande que (b, kb, mb, gb, tb)'],
  ['<1mb', 'Más pequeño que'],
  ['>2024/01/31', 'Modificado después de esa fecha'],
  ['<2023-12-01', 'Modificado antes de esa fecha'],
  [':oculto', 'Atributo: oculto, sistema, sololectura, comprimido, cifrado, temporal'],
  [':carpeta', 'Solo carpetas (o :fichero para solo archivos)'],
  ['informe', 'Texto suelto: el nombre lo contiene'],
  ['*.log >1mb', 'Varias condiciones juntas se cumplen a la vez'],
  ['*.*;*.tmp', 'Lo que va tras el ; se excluye'],
];

function helpDialog() {
  const table = el('table');
  for (const [ex, desc] of FILTER_HELP) {
    table.append(el('tr', {}, el('td', {}, el('code', { text: ex })), el('td', { text: desc })));
  }
  modal(
    el(
      'div',
      {},
      el('h2', { text: 'Sintaxis del filtro' }),
      el('p', { text: 'Los elementos que coinciden se resaltan en el mapa; el resto se atenúa.' }),
      table,
      el('h2', { text: 'Atajos', style: 'margin-top:18px' }),
      (() => {
        const t2 = el('table');
        for (const [k, d] of [
          ['Doble clic', 'Entrar en la carpeta'],
          ['Clic derecho en el fondo', 'Subir un nivel'],
          ['Retroceso', 'Subir un nivel'],
          ['Rueda del ratón', 'Más o menos detalle'],
          ['Alt + ← / →', 'Atrás y adelante'],
          ['F5 o Ctrl + R', 'Volver a analizar'],
          ['Ctrl + F', 'Ir al filtro'],
          ['Ctrl + T / Ctrl + W', 'Nueva pestaña / cerrar'],
          ['Supr', 'Enviar a la papelera'],
          ['May + Supr', 'Eliminar permanentemente'],
        ]) {
          t2.append(el('tr', {}, el('td', {}, el('code', { text: k })), el('td', { text: d })));
        }
        return t2;
      })()
    ),
    [{ label: 'Cerrar', primary: true, run: () => {} }]
  );
}

let toastEl = null;
function showToast(text, actionLabel, run) {
  toastEl?.remove();
  const btn = el('button', { class: 'btn solid' }, actionLabel);
  btn.onclick = () => {
    toastEl?.remove();
    toastEl = null;
    run();
  };
  const x = el('button', { class: 'btn' }, '✕');
  x.onclick = () => dismissToast();
  toastEl = el('div', { class: 'toast' }, el('span', { text }), btn, x);
  document.body.append(toastEl);
}

function dismissToast() {
  if (!toastEl) return;
  const t = toastEl;
  toastEl = null;
  t.dataset.out = '1';
  setTimeout(() => t.remove(), 240);
}

let flashTimer = null;
function flashStatus(text) {
  const node = $('#st-main');
  const prev = node.innerHTML;
  node.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    node.innerHTML = prev;
    refreshChrome();
  }, 2200);
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
