// Utilidades compartidas: formato, DOM y ayudas varias.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

export function bytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${nf0.format(n)} B`;
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  return `${(n < 10 ? nf2 : nf1).format(n)} ${UNITS[i]}`;
}

export function count(n) {
  return nf0.format(Number(n) || 0);
}

export function pct(part, whole) {
  if (!whole) return '0 %';
  return `${nf1.format((part / whole) * 100)} %`;
}

export function when(unix) {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1900) return '—';
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function duration(ms) {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${nf1.format(ms / 1000)} s`;
  const m = Math.floor(ms / 60000);
  return `${m} min ${Math.round((ms % 60000) / 1000)} s`;
}

/** Atributos de archivo de Windows en texto legible. */
const ATTR_NAMES = [
  [0x1, 'solo lectura'],
  [0x2, 'oculto'],
  [0x4, 'sistema'],
  [0x20, 'archivo'],
  [0x100, 'temporal'],
  [0x400, 'enlace'],
  [0x800, 'comprimido'],
  [0x2000, 'no indexado'],
  [0x4000, 'cifrado'],
];

export function attrList(a) {
  const v = ATTR_NAMES.filter(([bit]) => a & bit).map(([, n]) => n);
  return v.length ? v.join(', ') : '—';
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) {
    if (k === null || k === undefined || k === false) continue;
    n.append(k.nodeType ? k : document.createTextNode(k));
  }
  return n;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Curva de salida fuerte: arranca rapido y frena suave. */
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Recorta un texto al ancho disponible del lienzo, con puntos suspensivos. */
export function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + '…' : '';
}
