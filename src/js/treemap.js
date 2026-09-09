// Mapa de arbol con teselado squarified y sombreado de cojin, el mismo
// lenguaje visual que usa SpaceSniffer.
//
// El dibujo se hace en dos lienzos: uno de base con todo el mapa (solo se
// repinta cuando cambian los datos o el tamano) y el visible, donde se pega
// la base y encima se anaden resaltados. Asi mover el raton no cuesta nada
// aunque haya veinte mil rectangulos.

import { categoryOf, rampColor } from './themes.js';
import { bytes, count, clamp, easeOut, fitText, reducedMotion } from './util.js';

const F_DIR = 1;
const F_UNKNOWN = 4;
const F_DENIED = 8;

const PAD = 4; // margen interior de una carpeta
const GAP = 2; // aire entre bloques hermanos
const HEAD = 18; // alto de la banda con el nombre de la carpeta
const RADIUS = 3; // esquinas redondeadas cuando el bloque da de si
const MIN_BOX = 3; // por debajo de esto no se dibuja nada
const LABEL_W = 34;
const LABEL_H = 13;

const FONT_UI = '"Inter", system-ui, "Segoe UI", sans-serif';
const FONT_NUM = '"JetBrains Mono", ui-monospace, Consolas, monospace';

/** Camino rectangular, redondeado si hay sitio. */
function boxPath(c, x, y, w, h, r) {
  c.beginPath();
  if (r > 0 && c.roundRect) c.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  else c.rect(x, y, w, h);
}

/** Trama diagonal para el espacio no identificado y el bloque "resto". */
function hatch(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const x = c.getContext('2d');
  x.strokeStyle = color;
  x.lineWidth = 1.4;
  x.beginPath();
  x.moveTo(-2, 10);
  x.lineTo(10, -2);
  x.moveTo(2, 14);
  x.lineTo(14, 2);
  x.stroke();
  return x.createPattern(c, 'repeat');
}

/**
 * Teselado squarified (Bruls, Huizing y van Wijk). Coloca los elementos ya
 * ordenados de mayor a menor buscando que cada uno quede lo mas cuadrado
 * posible, que es lo que hace legible el mapa.
 */
function squarify(items, x, y, w, h, place) {
  let i = 0;
  let total = 0;
  for (const it of items) total += it.v;
  if (total <= 0) return;

  while (i < items.length && w >= 0.5 && h >= 0.5) {
    let rest = 0;
    for (let k = i; k < items.length; k++) rest += items[k].v;
    if (rest <= 0) return;

    const scale = (w * h) / rest;
    const short = Math.min(w, h);
    const row = [];
    let sum = 0;
    let worst = Infinity;

    for (let k = i; k < items.length; k++) {
      const area = items[k].v * scale;
      const next = sum + area;
      const cand = worstRatio(row, area, next, short);
      if (row.length && cand > worst) break;
      row.push(area);
      sum = next;
      worst = cand;
    }
    if (!row.length) return;

    const thick = sum / short;
    if (w >= h) {
      let cy = y;
      for (let k = 0; k < row.length; k++) {
        const hh = row[k] / thick;
        place(items[i + k], x, cy, thick, hh);
        cy += hh;
      }
      x += thick;
      w -= thick;
    } else {
      let cx = x;
      for (let k = 0; k < row.length; k++) {
        const ww = row[k] / thick;
        place(items[i + k], cx, y, ww, thick);
        cx += ww;
      }
      y += thick;
      h -= thick;
    }
    i += row.length;
  }
}

function worstRatio(row, add, sum, short) {
  let mx = add;
  let mn = add;
  for (const r of row) {
    if (r > mx) mx = r;
    if (r < mn) mn = r;
  }
  if (mn <= 0 || sum <= 0) return Infinity;
  const s2 = short * short;
  const sum2 = sum * sum;
  return Math.max((s2 * mx) / sum2, sum2 / (s2 * mn));
}

export class Treemap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.baseCtx = this.base.getContext('2d');
    this.prev = document.createElement('canvas');
    this.prevCtx = this.prev.getContext('2d');

    this.rects = [];
    this.root = null;
    this.palette = null;
    this.opts = { colorBy: 'tipo', labels: true, detail: 4 };
    this.hover = null;
    this.selected = null;
    this.anim = null;
    this.dpr = 1;
    this.W = 0;
    this.H = 0;
  }

  setPalette(p) {
    this.palette = p;
    this.hatchLight = hatch(p.dark ? 'rgba(255,255,255,0.10)' : 'rgba(30,40,70,0.10)');
  }

  setOptions(o) {
    Object.assign(this.opts, o);
  }

  /** Devuelve true solo si el tamaño ha cambiado de verdad. */
  resize() {
    // Se mide el contenedor, nunca el propio lienzo: su ancho en px lo fija
    // esta misma funcion, asi que medirlo seria preguntarse a si mismo.
    const r = (this.canvas.parentElement || this.canvas).getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(r.width));
    const H = Math.max(1, Math.round(r.height));
    if (W === this.W && H === this.H && dpr === this.dpr) return false;
    this.dpr = dpr;
    this.W = W;
    this.H = H;
    for (const c of [this.canvas, this.base, this.prev]) {
      c.width = Math.round(this.W * this.dpr);
      c.height = Math.round(this.H * this.dpr);
    }
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    for (const c of [this.ctx, this.baseCtx, this.prevCtx]) {
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    return true;
  }

  /** Guarda el fotograma actual para poder animar la transicion. */
  snapshot() {
    this.prevCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.prevCtx.clearRect(0, 0, this.prev.width, this.prev.height);
    this.prevCtx.drawImage(this.base, 0, 0);
    this.prevCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setData(root) {
    this.root = root;
    this.hover = null;
    this.layout();
    this.paintBase();
  }

  // ------------------------------------------------------------- geometria

  layout() {
    this.rects = [];
    if (!this.root || !this.W) return;
    this.ageRange = this.opts.colorBy === 'antiguedad' ? ageRange(this.root) : null;
    this.walk(this.root, 0, 0, this.W, this.H, 0);
  }

  walk(node, x, y, w, h, depth) {
    const rect = { node, x, y, w, h, depth, leaf: true };
    this.rects.push(rect);
    const kids = node.c;
    const hidden = node.hs || 0;
    if ((!kids || !kids.length) && !hidden) return;

    const pad = depth === 0 ? 0 : PAD;
    const head = depth > 0 && h > HEAD + 22 && w > 58 ? HEAD : 0;
    const ix = x + pad;
    const iy = y + pad + head;
    const iw = w - pad * 2;
    const ih = h - pad * 2 - head;
    if (iw < MIN_BOX || ih < MIN_BOX) return;
    rect.leaf = false;
    rect.head = head;

    const items = [];
    for (const k of kids || []) if (k.s > 0) items.push({ v: k.s, node: k });
    if (hidden > 0) {
      items.push({ v: hidden, node: { i: -1, n: `${count(node.hn || 0)} elementos`, s: hidden, d: 0, rest: true } });
    }
    items.sort((a, b) => b.v - a.v);

    squarify(items, ix, iy, iw, ih, (it, cx, cy, cw, ch) => {
      // El aire entre hermanos se roba del propio bloque, no del reparto:
      // asi las areas siguen siendo proporcionales al tamano real.
      const bw = cw - GAP;
      const bh = ch - GAP;
      if (bw < MIN_BOX || bh < MIN_BOX) return;
      if (it.node.rest) {
        this.rects.push({ node: it.node, x: cx, y: cy, w: bw, h: bh, depth: depth + 1, leaf: true, rest: true });
      } else {
        this.walk(it.node, cx, cy, bw, bh, depth + 1);
      }
    });
  }

  colorFor(node, depth) {
    const p = this.palette;
    if (node.d & F_UNKNOWN) return p.unknown;
    if (node.rest) return p.folder(depth);
    if (node.d & F_DIR) return p.folder(depth);
    switch (this.opts.colorBy) {
      case 'antiguedad': {
        const [lo, hi] = this.ageRange || [0, 1];
        const t = hi > lo ? 1 - (node.m - lo) / (hi - lo) : 0.5;
        return rampColor(t, p);
      }
      case 'tamano': {
        // Escala logaritmica: si no, todo salvo el archivo mayor sale igual.
        const t = clamp(Math.log10(Math.max(node.s, 1)) / 10, 0, 1);
        return rampColor(t, p);
      }
      default:
        return p.cat[categoryOf(node.n)];
    }
  }

  // --------------------------------------------------------------- pintado

  paintBase() {
    const c = this.baseCtx;
    const p = this.palette;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    c.fillStyle = p.bg;
    c.fillRect(0, 0, this.W, this.H);
    if (!this.rects.length) return;

    const filtering = this.root && this.root.filtering;

    for (const r of this.rects) {
      if (r.depth === 0) continue;
      const { x, y, w, h, node } = r;
      const round = w > 8 && h > 8 ? RADIUS : 0;
      c.fillStyle = this.colorFor(node, r.depth);
      boxPath(c, x, y, w, h, round);
      c.fill();

      if (node.d & F_UNKNOWN || node.rest) {
        c.save();
        c.clip();
        c.fillStyle = this.hatchLight;
        c.translate(x, y);
        c.fillRect(0, 0, w, h);
        c.restore();
      }

      // Las carpetas llevan un filo tenue que marca donde acaba el contenedor.
      if (!r.leaf && w > 5 && h > 5) {
        c.strokeStyle = p.edge;
        c.lineWidth = 1;
        boxPath(c, x + 0.5, y + 0.5, w - 1, h - 1, round);
        c.stroke();
      }
      if (node.d & F_DENIED) {
        c.strokeStyle = p.accent2;
        c.lineWidth = 1.5;
        c.setLineDash([3, 3]);
        c.strokeRect(x + 1, y + 1, w - 2, h - 2);
        c.setLineDash([]);
      }

      if (filtering && r.leaf) {
        if (node.f & 1) {
          c.strokeStyle = p.accent;
          c.lineWidth = 2;
          c.strokeRect(x + 1, y + 1, w - 2, h - 2);
        } else if (!(node.f & 2)) {
          // Lo que no coincide se apaga contra el fondo, no se borra.
          c.fillStyle = p.dark ? 'rgba(6,9,18,0.66)' : 'rgba(245,247,252,0.7)';
          c.fillRect(x, y, w, h);
        }
      }
    }

    if (this.opts.labels) this.paintLabels(c);
  }

  paintLabels(c) {
    const p = this.palette;
    const family = document.documentElement.dataset.mono === '1' ? FONT_NUM : FONT_UI;
    c.textBaseline = 'middle';

    for (const r of this.rects) {
      if (r.depth === 0) continue;
      const { x, y, w, h, node } = r;

      if (!r.leaf && r.head) {
        // Banda de la carpeta: nombre a la izquierda, tamano a la derecha.
        // El tamano manda, asi que se le reserva sitio antes de recortar.
        c.font = `600 11.5px ${FONT_NUM}`;
        const size = bytes(node.s);
        const sw = c.measureText(size).width;
        const avail = w - PAD * 2 - 8;
        c.font = `700 12px ${family}`;
        const name = fitText(c, node.n, Math.max(0, avail - sw - 10));
        const cy = y + PAD + r.head / 2;

        // Placa oscura detras del texto: sin ella el nombre se pierde sobre
        // los bloques claros de los hijos.
        c.fillStyle = p.dark ? 'rgba(0,0,0,0.34)' : 'rgba(255,255,255,0.42)';
        c.fillRect(x + PAD, y + PAD, w - PAD * 2, r.head);

        c.shadowColor = p.labelShadow;
        c.shadowBlur = 3;
        c.fillStyle = p.label;
        if (name) c.fillText(name, x + PAD + 4, cy);
        if (avail > sw + 12) {
          c.font = `600 11.5px ${FONT_NUM}`;
          c.fillText(size, x + w - PAD - 4 - sw, cy);
        }
        c.shadowBlur = 0;
      } else if (r.leaf && w > LABEL_W && h > LABEL_H) {
        c.shadowColor = p.labelShadow;
        c.shadowBlur = 3;
        c.fillStyle = p.label;
        const twoLines = h > 26 && w > 58;
        c.font = `${twoLines ? 600 : 400} 11.5px ${family}`;
        const name = fitText(c, node.n, w - 8);
        if (twoLines) {
          if (name) c.fillText(name, x + 4, y + h / 2 - 7);
          c.font = `500 10.5px ${FONT_NUM}`;
          c.globalAlpha = 0.88;
          c.fillText(fitText(c, bytes(node.s), w - 8), x + 4, y + h / 2 + 7);
          c.globalAlpha = 1;
        } else if (h > 17 && w > 46) {
          // Una sola linea y sitio justo: pesa mas saber cuanto ocupa.
          c.font = `500 10.5px ${FONT_NUM}`;
          const size = bytes(node.s);
          const sw = c.measureText(size).width;
          c.font = `400 11.5px ${family}`;
          const short = fitText(c, node.n, w - 10 - sw);
          if (short) c.fillText(short, x + 4, y + h / 2);
          c.font = `500 10.5px ${FONT_NUM}`;
          c.globalAlpha = 0.85;
          c.fillText(size, x + w - 4 - sw, y + h / 2);
          c.globalAlpha = 1;
        } else if (name) {
          c.fillText(name, x + 4, y + h / 2);
        }
        c.shadowBlur = 0;
      }
    }
  }

  /** Pega la base y anade lo que cambia con el raton. */
  draw() {
    if (this.anim) return;
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.base, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawMarks(c);
  }

  drawMarks(c) {
    const p = this.palette;
    if (this.selected) {
      const r = this.selected;
      c.strokeStyle = p.accent2;
      c.lineWidth = 2;
      c.setLineDash([5, 3]);
      c.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      c.setLineDash([]);
    }
    if (this.hover) {
      const r = this.hover;
      c.save();
      c.fillStyle = p.dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.42)';
      c.fillRect(r.x, r.y, r.w, r.h);
      c.strokeStyle = p.accent;
      c.lineWidth = 2;
      c.shadowColor = p.accent;
      c.shadowBlur = 10;
      c.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      c.restore();

      // Cadena de carpetas que contienen al elemento senalado.
      c.strokeStyle = p.accent;
      c.globalAlpha = 0.32;
      c.lineWidth = 1;
      for (const a of this.ancestorsOf(r)) {
        c.strokeRect(a.x + 0.5, a.y + 0.5, a.w - 1, a.h - 1);
      }
      c.globalAlpha = 1;
    }
  }

  ancestorsOf(rect) {
    const out = [];
    for (const r of this.rects) {
      if (r === rect || r.leaf) continue;
      if (rect.x >= r.x && rect.y >= r.y && rect.x + rect.w <= r.x + r.w && rect.y + rect.h <= r.y + r.h) {
        out.push(r);
      }
    }
    return out;
  }

  // ------------------------------------------------------------ interaccion

  hitTest(px, py) {
    // Los hijos se anaden despues que sus padres, asi que recorriendo del
    // final al principio el primero que contenga el punto es el mas profundo.
    for (let i = this.rects.length - 1; i >= 0; i--) {
      const r = this.rects[i];
      if (r.depth === 0) continue;
      if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return r;
    }
    return null;
  }

  setHover(r) {
    if (this.hover === r) return false;
    this.hover = r;
    return true;
  }

  selectNode(id) {
    this.selected = id === null ? null : this.rects.find((r) => r.node.i === id) || null;
  }

  /** Rectangulo actual de un nodo, para animar hacia o desde el. */
  rectOf(id) {
    return this.rects.find((r) => r.node.i === id) || null;
  }

  /**
   * Transicion de zoom. `rect` es el hueco que ocupa el contenido pequeno
   * dentro del mapa grande; `dir` dice cual de los dos lienzos es el pequeno.
   */
  transition(rect, dir) {
    if (!rect) {
      this.draw();
      return;
    }
    // El zoom no es adorno: explica a donde ha ido el usuario. Con el
    // movimiento reducido activado se conserva, pero sin desplazamiento:
    // solo un fundido corto entre los dos mapas.
    const soft = reducedMotion();
    const full = { x: 0, y: 0, w: this.W, h: this.H };
    const dur = soft ? 130 : 300;
    const t0 = performance.now();
    const c = this.ctx;
    // En 'in' el mapa nuevo nace dentro de rect; en 'out' el viejo se encoge
    // hasta rect. En ambos casos basta con interpolar un rectangulo destino.
    const grow = dir === 'in';
    const a = grow ? rect : full;
    const b = grow ? full : rect;
    const growing = grow ? this.base : this.prev;
    const shrinking = grow ? this.prev : this.base;

    const step = (now) => {
      const e = easeOut(clamp((now - t0) / dur, 0, 1));
      const T = soft
        ? full
        : {
            x: a.x + (b.x - a.x) * e,
            y: a.y + (b.y - a.y) * e,
            w: a.w + (b.w - a.w) * e,
            h: a.h + (b.h - a.h) * e,
          };
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.fillStyle = this.palette.bg;
      c.fillRect(0, 0, this.W, this.H);

      // El que se aleja: su sub-rectangulo `rect` se mantiene encajado en T.
      const sx = soft ? 1 : T.w / rect.w;
      const sy = soft ? 1 : T.h / rect.h;
      c.save();
      c.globalAlpha = grow ? 1 - e : e;
      c.setTransform(
        this.dpr * sx,
        0,
        0,
        this.dpr * sy,
        this.dpr * (soft ? 0 : T.x - rect.x * sx),
        this.dpr * (soft ? 0 : T.y - rect.y * sy)
      );
      c.drawImage(shrinking, 0, 0, this.W, this.H);
      c.restore();

      // El que llega: se dibuja entero dentro de T.
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.globalAlpha = grow ? e : 1 - e;
      c.drawImage(growing, T.x, T.y, T.w, T.h);
      c.globalAlpha = 1;

      if (e < 1) {
        this.anim = requestAnimationFrame(step);
      } else {
        this.anim = null;
        this.draw();
      }
    };
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = requestAnimationFrame(step);
  }
}

function ageRange(root) {
  let lo = Infinity;
  let hi = -Infinity;
  const walk = (n) => {
    if (!(n.d & F_DIR) && n.m) {
      if (n.m < lo) lo = n.m;
      if (n.m > hi) hi = n.m;
    }
    for (const k of n.c || []) walk(k);
  };
  walk(root);
  return Number.isFinite(lo) ? [lo, hi] : [0, 1];
}
