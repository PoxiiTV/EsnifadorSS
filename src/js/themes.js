// Sistema de temas. Todo el color de la aplicacion sale de aqui: las
// variables CSS de la interfaz y tambien los colores que pinta el lienzo.
// Un tema define su paleta base y los colores de archivo se derivan de ella,
// asi cada tema queda coherente sin tener que elegir 13 colores a mano.

/** Tono base de cada familia de archivos, en grados HSL. */
const CAT_HUE = {
  video: 276,
  imagen: 194,
  audio: 322,
  comprimido: 38,
  documento: 212,
  codigo: 152,
  ejecutable: 6,
  datos: 258,
  disco: 22,
  fuente: 96,
  temporal: 52,
  sistema: 232,
  otro: 220,
};

/** Extensiones conocidas por familia. Lo que no este aqui cae en "otro". */
const CAT_EXT = {
  video: 'mp4 mkv avi mov wmv flv webm m4v mpg mpeg ts m2ts vob rmvb 3gp',
  imagen: 'jpg jpeg png gif bmp webp tiff tif svg ico heic raw cr2 nef dng psd ai',
  audio: 'mp3 wav flac aac ogg wma m4a opus aiff mid midi',
  comprimido: 'zip rar 7z tar gz bz2 xz zst cab arj lz4 tgz pkg',
  documento: 'pdf doc docx xls xlsx ppt pptx odt ods odp rtf txt md epub mobi djvu csv',
  codigo: 'js ts jsx tsx py rs go java c h cpp hpp cs rb php swift kt lua sh ps1 bat html css scss json xml yaml yml toml sql ipynb',
  ejecutable: 'exe msi dll com scr appx msix efi sys ocx',
  datos: 'db sqlite sqlite3 mdb accdb dat bin idx pak sav bak',
  disco: 'iso img vhd vhdx vmdk qcow2 dmg wim esd',
  fuente: 'ttf otf woff woff2 eot fon',
  temporal: 'tmp temp log cache crdownload part partial old chk',
  sistema: 'pagefile swapfile hiberfil ini reg inf cat manifest mui pdb pnf evtx etl',
};

const EXT_INDEX = (() => {
  const m = new Map();
  for (const [cat, list] of Object.entries(CAT_EXT)) {
    for (const e of list.split(' ')) m.set(e, cat);
  }
  return m;
})();

export function categoryOf(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0) return 'otro';
  return EXT_INDEX.get(name.slice(i + 1).toLowerCase()) || 'otro';
}

/**
 * Temas. `ui` son variables CSS literales; `paint` describe como se derivan
 * los colores del mapa (rotacion de tono, saturacion y luminosidad).
 */
export const THEMES = {
  'deep-space': {
    label: 'Deep Space',
    dark: true,
    ui: {
      bg: '#070b18',
      bg2: '#040711',
      grid: '#0d1428',
      panel: 'rgba(19, 27, 50, 0.66)',
      panelSolid: '#131b32',
      raise: 'rgba(255,255,255,0.05)',
      stroke: 'rgba(120, 160, 235, 0.16)',
      strokeSoft: 'rgba(120, 160, 235, 0.09)',
      fg: '#e8edfb',
      fgDim: '#9fb0d4',
      fgMute: '#6478a4',
      accent: '#4fd1ff',
      accent2: '#a06bff',
      accentFg: '#04121d',
      danger: '#ff5f7e',
      ok: '#4ade9e',
      glow: 'rgba(79, 209, 255, 0.34)',
    },
    paint: { rot: 0, sat: 58, light: 50, folderSat: 16, folderLight: 20, canvasBg: '#05080f' },
  },
  'midnight-glass': {
    label: 'Midnight Glass',
    dark: true,
    ui: {
      bg: '#060608',
      bg2: '#000000',
      grid: '#111116',
      panel: 'rgba(24, 24, 32, 0.7)',
      panelSolid: '#18181f',
      raise: 'rgba(255,255,255,0.055)',
      stroke: 'rgba(255, 255, 255, 0.13)',
      strokeSoft: 'rgba(255, 255, 255, 0.07)',
      fg: '#f2f2f7',
      fgDim: '#a8a8b8',
      fgMute: '#6a6a7a',
      accent: '#ff6ec7',
      accent2: '#6ea8ff',
      accentFg: '#1a0413',
      danger: '#ff5f5f',
      ok: '#5ee2a0',
      glow: 'rgba(255, 110, 199, 0.3)',
    },
    paint: { rot: 14, sat: 52, light: 48, folderSat: 5, folderLight: 17, canvasBg: '#050506' },
  },
  'nordic-light': {
    label: 'Nordic Light',
    dark: false,
    ui: {
      bg: '#eef1f7',
      bg2: '#e2e7f0',
      grid: '#dde3ee',
      panel: 'rgba(255, 255, 255, 0.72)',
      panelSolid: '#ffffff',
      raise: 'rgba(15, 25, 55, 0.045)',
      stroke: 'rgba(30, 50, 95, 0.14)',
      strokeSoft: 'rgba(30, 50, 95, 0.07)',
      fg: '#131a2b',
      fgDim: '#4c5a76',
      fgMute: '#8492ad',
      accent: '#2f6bff',
      accent2: '#7d3bff',
      accentFg: '#ffffff',
      danger: '#d92c52',
      ok: '#12a06a',
      glow: 'rgba(47, 107, 255, 0.22)',
    },
    paint: { rot: 0, sat: 62, light: 66, folderSat: 14, folderLight: 88, canvasBg: '#f4f6fb', lightMap: true },
  },
  solar: {
    label: 'Solar Flare',
    dark: true,
    ui: {
      bg: '#150d06',
      bg2: '#0d0803',
      grid: '#20140a',
      panel: 'rgba(45, 27, 14, 0.66)',
      panelSolid: '#2d1b0e',
      raise: 'rgba(255, 200, 140, 0.06)',
      stroke: 'rgba(255, 178, 102, 0.18)',
      strokeSoft: 'rgba(255, 178, 102, 0.09)',
      fg: '#fdeede',
      fgDim: '#d0ab88',
      fgMute: '#8f7256',
      accent: '#ffb454',
      accent2: '#ff6a3d',
      accentFg: '#241102',
      danger: '#ff5252',
      ok: '#a3d977',
      glow: 'rgba(255, 180, 84, 0.32)',
    },
    paint: { rot: 26, sat: 60, light: 48, folderSat: 22, folderLight: 19, canvasBg: '#100904' },
  },
  emerald: {
    label: 'Emerald Deep',
    dark: true,
    ui: {
      bg: '#04140f',
      bg2: '#020c08',
      grid: '#0a2119',
      panel: 'rgba(10, 40, 31, 0.66)',
      panelSolid: '#0a281f',
      raise: 'rgba(140, 255, 210, 0.055)',
      stroke: 'rgba(80, 220, 175, 0.17)',
      strokeSoft: 'rgba(80, 220, 175, 0.08)',
      fg: '#e2f7ee',
      fgDim: '#8fc3b0',
      fgMute: '#5a8878',
      accent: '#34e0a1',
      accent2: '#4fd1ff',
      accentFg: '#032018',
      danger: '#ff6b81',
      ok: '#7ef2b5',
      glow: 'rgba(52, 224, 161, 0.3)',
    },
    paint: { rot: 340, sat: 55, light: 46, folderSat: 20, folderLight: 18, canvasBg: '#031009' },
  },
  'neon-terminal': {
    label: 'Neon Terminal',
    dark: true,
    mono: true,
    ui: {
      bg: '#000000',
      bg2: '#000000',
      grid: '#0a1a0e',
      panel: 'rgba(4, 20, 9, 0.8)',
      panelSolid: '#041409',
      raise: 'rgba(57, 255, 139, 0.07)',
      stroke: 'rgba(57, 255, 139, 0.28)',
      strokeSoft: 'rgba(57, 255, 139, 0.12)',
      fg: '#c9ffdb',
      fgDim: '#4fd07c',
      fgMute: '#2c7a49',
      accent: '#39ff8b',
      accent2: '#ffd23f',
      accentFg: '#001a08',
      danger: '#ff3b5c',
      ok: '#39ff8b',
      glow: 'rgba(57, 255, 139, 0.35)',
    },
    paint: { rot: 100, sat: 70, light: 42, folderSat: 45, folderLight: 12, canvasBg: '#000000' },
  },
  candy: {
    label: 'Candy Pop',
    dark: false,
    ui: {
      bg: '#fdf5ff',
      bg2: '#f6e9fb',
      grid: '#f0e0f7',
      panel: 'rgba(255, 255, 255, 0.75)',
      panelSolid: '#ffffff',
      raise: 'rgba(120, 40, 150, 0.05)',
      stroke: 'rgba(150, 70, 190, 0.16)',
      strokeSoft: 'rgba(150, 70, 190, 0.08)',
      fg: '#2b1436',
      fgDim: '#6b4780',
      fgMute: '#a284b3',
      accent: '#c65cff',
      accent2: '#ff7ab8',
      accentFg: '#ffffff',
      danger: '#e0245e',
      ok: '#17a97a',
      glow: 'rgba(198, 92, 255, 0.24)',
    },
    paint: { rot: 20, sat: 70, light: 70, folderSat: 30, folderLight: 90, canvasBg: '#fbf3fe', lightMap: true },
  },
  'slate-pro': {
    label: 'Slate Pro',
    dark: true,
    ui: {
      bg: '#101216',
      bg2: '#0a0c0f',
      grid: '#181b21',
      panel: 'rgba(30, 34, 42, 0.7)',
      panelSolid: '#1e222a',
      raise: 'rgba(255,255,255,0.05)',
      stroke: 'rgba(160, 180, 210, 0.15)',
      strokeSoft: 'rgba(160, 180, 210, 0.08)',
      fg: '#e6eaf0',
      fgDim: '#98a2b3',
      fgMute: '#667085',
      accent: '#7dd3fc',
      accent2: '#c4b5fd',
      accentFg: '#062230',
      danger: '#f87171',
      ok: '#4ade80',
      glow: 'rgba(125, 211, 252, 0.26)',
    },
    paint: { rot: 0, sat: 40, light: 52, folderSat: 8, folderLight: 22, canvasBg: '#0c0e12' },
  },
};

export const THEME_IDS = Object.keys(THEMES);

/** Colores derivados que consume el lienzo. Se recalculan al cambiar de tema. */
export function paintPalette(id) {
  const t = THEMES[id] || THEMES['deep-space'];
  const p = t.paint;
  const cat = {};
  for (const [k, hue] of Object.entries(CAT_HUE)) {
    cat[k] = hsl((hue + p.rot) % 360, p.sat, p.light);
  }
  return {
    dark: t.dark,
    lightMap: !!p.lightMap,
    cat,
    bg: p.canvasBg,
    // Las carpetas se aclaran (u oscurecen) segun la profundidad para que se
    // vea el anidamiento sin necesidad de bordes gruesos.
    folder: (depth) => {
      const step = p.lightMap ? -4.5 : 4.5;
      const l = clamp(p.folderLight + depth * step, 6, 96);
      return hsl((214 + p.rot) % 360, p.folderSat, l);
    },
    unknown: hsl((0 + p.rot) % 360, p.lightMap ? 14 : 8, p.lightMap ? 78 : 30),
    edge: t.dark ? 'rgba(255,255,255,0.08)' : 'rgba(20,30,60,0.10)',
    accent: t.ui.accent,
    accent2: t.ui.accent2,
    label: t.dark ? 'rgba(255,255,255,0.94)' : 'rgba(15,20,35,0.92)',
    labelShadow: t.dark ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.8)',
  };
}

/** Rampa para colorear por antiguedad o por tamano. */
export function rampColor(t, palette) {
  // t en [0,1]: 0 = reciente/pequeno (verde-cian), 1 = antiguo/grande (rojo).
  const hue = 168 - 168 * clamp(t, 0, 1);
  return hsl(hue, palette.lightMap ? 62 : 56, palette.lightMap ? 68 : 48);
}

function hsl(h, s, l) {
  return `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`;
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

const STORE_KEY = 'esnifadorss.theme';

export function applyTheme(id) {
  const t = THEMES[id] || THEMES['deep-space'];
  const r = document.documentElement;
  const map = {
    bg: '--bg',
    bg2: '--bg2',
    grid: '--grid',
    panel: '--panel',
    panelSolid: '--panel-solid',
    raise: '--raise',
    stroke: '--stroke',
    strokeSoft: '--stroke-soft',
    fg: '--fg',
    fgDim: '--fg-dim',
    fgMute: '--fg-mute',
    accent: '--accent',
    accent2: '--accent-2',
    accentFg: '--accent-fg',
    danger: '--danger',
    ok: '--ok',
    glow: '--glow',
  };
  for (const [k, cssVar] of Object.entries(map)) r.style.setProperty(cssVar, t.ui[k]);
  r.dataset.theme = id;
  r.dataset.mono = t.mono ? '1' : '0';
  r.style.colorScheme = t.dark ? 'dark' : 'light';
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    /* modo privado: el tema simplemente no se recuerda */
  }
  return paintPalette(id);
}

export function savedTheme() {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v && THEMES[v]) return v;
  } catch {
    /* ignorado */
  }
  return 'deep-space';
}
