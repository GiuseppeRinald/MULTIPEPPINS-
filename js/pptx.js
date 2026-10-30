// MULTIPEPPINS — PowerPoint (PPTX) in PDF: legge le slide e le ridisegna con pdf-lib
import { PDFLib, toWinAnsi, canvasToBytes } from './core.js';

const { PDFDocument, StandardFonts, rgb, LineCapStyle, setCharacterSqueeze } = PDFLib;
const EMU = 12700; // EMU per punto

/* ---------------- ZIP ---------------- */
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Il file non è una presentazione PowerPoint valida (.pptx).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    entries.set(name, { method, csize, off });
    p += 46 + nlen + xlen + clen;
  }
  const cache = new Map();
  return {
    has: (n) => entries.has(n),
    async bytes(name) {
      const e = entries.get(name);
      if (!e) return null;
      const lh = e.off;
      const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
      const raw = bytes.subarray(start, start + e.csize);
      return e.method === 0 ? raw : inflateRaw(raw);
    },
    async xml(name) {
      if (cache.has(name)) return cache.get(name);
      const b = await this.bytes(name);
      const doc = b ? new DOMParser().parseFromString(new TextDecoder().decode(b), 'application/xml') : null;
      cache.set(name, doc);
      return doc;
    },
  };
}

/* ---------------- XML ---------------- */
const kids = (e, n) => (e ? [...e.children].filter((c) => c.localName === n) : []);
const kid = (e, n) => (e ? [...e.children].find((c) => c.localName === n) || null : null);
const path = (e, ...ns) => ns.reduce((x, n) => kid(x, n), e);
const desc = (e, n) => (e ? e.getElementsByTagNameNS('*', n)[0] || null : null);
const attr = (e, a) => (e ? e.getAttribute(a) : null);
const rId = (e, a) => (e ? e.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', a) || e.getAttribute('r:' + a) : null);
const intA = (e, a, d = null) => { const v = attr(e, a); return v == null || v === '' ? d : +v; };

function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
async function rels(zip, part) {
  const dir = part.split('/').slice(0, -1).join('/');
  const file = part.split('/').pop();
  const doc = await zip.xml(`${dir}/_rels/${file}.rels`);
  const map = {};
  if (doc) for (const r of doc.documentElement.children) map[r.getAttribute('Id')] = { type: (r.getAttribute('Type') || '').split('/').pop(), target: r.getAttribute('TargetMode') === 'External' ? null : resolvePath(part, r.getAttribute('Target')) };
  return map;
}
const relOfType = (map, type) => Object.values(map).find((r) => r.type === type);

/* ---------------- Colori ---------------- */
// tinte e ombre di Office lavorano in RGB lineare
const toLin = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const fromLin = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
function hexRgb(h) { const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb([h, s, l]) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
const PRESET = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500', darkBlue: '00008B', lightGray: 'D3D3D3' };

class Theme {
  constructor(themeDoc, clrMap) {
    this.scheme = {};
    const cs = desc(themeDoc, 'clrScheme');
    if (cs) for (const c of cs.children) {
      const s = kid(c, 'srgbClr'), sys = kid(c, 'sysClr');
      this.scheme[c.localName] = s ? attr(s, 'val') : sys ? attr(sys, 'lastClr') || (attr(sys, 'val') === 'window' ? 'FFFFFF' : '000000') : '000000';
    }
    this.map = clrMap || { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
    const fs = desc(themeDoc, 'fontScheme');
    this.major = attr(path(fs, 'majorFont', 'latin'), 'typeface') || '';
    this.minor = attr(path(fs, 'minorFont', 'latin'), 'typeface') || '';
  }
  scheme_(name, phClr) {
    if (name === 'phClr' && phClr) return phClr;
    const mapped = this.map[name] || name;
    return hexRgb(this.scheme[mapped] || this.scheme[name] || '000000');
  }
  // Legge un elemento colore (srgbClr, schemeClr, …) con le sue modifiche → {c:[r,g,b], a}
  color(e, phClr) {
    if (!e) return null;
    let base;
    switch (e.localName) {
      case 'srgbClr': base = hexRgb(attr(e, 'val') || '000000'); break;
      case 'schemeClr': base = this.scheme_(attr(e, 'val'), phClr && phClr.c); break;
      case 'sysClr': base = hexRgb(attr(e, 'lastClr') || '000000'); break;
      case 'prstClr': base = hexRgb(PRESET[attr(e, 'val')] || '000000'); break;
      case 'scrgbClr': base = ['r', 'g', 'b'].map((k) => Math.round(Math.max(0, Math.min(1, intA(e, k, 0) / 100000)) ** (1 / 2.2) * 255)); break;
      case 'hslClr': base = hslToRgb([intA(e, 'hue', 0) / 21600000, intA(e, 'sat', 0) / 100000, intA(e, 'lum', 0) / 100000]); break;
      default: return null;
    }
    let c = [...base], a = 1;
    for (const m of e.children) {
      const v = intA(m, 'val', 0) / 100000;
      switch (m.localName) {
        case 'lumMod': { const h = rgbToHsl(c); h[2] *= v; c = hslToRgb(h); break; }
        case 'lumOff': { const h = rgbToHsl(c); h[2] = Math.min(1, h[2] + v); c = hslToRgb(h); break; }
        case 'satMod': { const h = rgbToHsl(c); h[1] = Math.min(1, h[1] * v); c = hslToRgb(h); break; }
        case 'tint': c = c.map((x) => fromLin(toLin(x) * v + (1 - v))); break;
        case 'shade': c = c.map((x) => fromLin(toLin(x) * v)); break;
        case 'alpha': a = v; break;
        default:
      }
    }
    return { c: c.map((x) => Math.max(0, Math.min(255, x))), a };
  }
  // primo figlio colore di un elemento (es. solidFill)
  colorIn(parent, phClr) {
    if (!parent) return null;
    for (const c of parent.children) { const r = this.color(c, phClr); if (r) return r; }
    return null;
  }
}
const toRgb = (col) => rgb(col.c[0] / 255, col.c[1] / 255, col.c[2] / 255);

// Riempimento di spPr/bgPr: {type:'solid'|'none'|'image', color, rid}
function readFill(spPr, theme, phClr) {
  if (!spPr) return null;
  for (const c of spPr.children) {
    switch (c.localName) {
      case 'noFill': return { type: 'none' };
      case 'solidFill': { const col = theme.colorIn(c, phClr); return col ? { type: 'solid', color: col } : null; }
      case 'gradFill': {
        const stops = kids(kid(c, 'gsLst'), 'gs').map((g) => theme.colorIn(g, phClr)).filter(Boolean);
        if (!stops.length) return null;
        // media dei colori: approssimazione del gradiente
        const avg = stops[0].c.map((_, i) => stops.reduce((s, x) => s + x.c[i], 0) / stops.length);
        return { type: 'solid', color: { c: avg, a: stops[0].a } };
      }
      case 'blipFill': return { type: 'image', rid: rId(kid(c, 'blip'), 'embed'), src: kid(c, 'srcRect') };
      case 'pattFill': { const col = theme.colorIn(kid(c, 'fgClr')); return col ? { type: 'solid', color: col } : null; }
      default:
    }
  }
  return null;
}

/* ---------------- Caratteri ---------------- */
async function loadFonts(pdf) {
  const F = StandardFonts;
  const pick = async (n) => pdf.embedFont(n);
  return {
    sans: [await pick(F.Helvetica), await pick(F.HelveticaBold), await pick(F.HelveticaOblique), await pick(F.HelveticaBoldOblique)],
    serif: [await pick(F.TimesRoman), await pick(F.TimesRomanBold), await pick(F.TimesRomanItalic), await pick(F.TimesRomanBoldItalic)],
    mono: [await pick(F.Courier), await pick(F.CourierBold), await pick(F.CourierOblique), await pick(F.CourierBoldOblique)],
  };
}
function familyOf(face) {
  if (/times|georgia|garamond|cambria|book|serif|palatino|constantia/i.test(face || '') && !/sans/i.test(face)) return 'serif';
  if (/courier|consol|mono|lucida console/i.test(face || '')) return 'mono';
  return 'sans';
}
function safeText(s) {
  return toWinAnsi(String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ /g, ' ').replace(/[-]/g, '•'));
}


/* ---------------- Geometrie ---------------- */
const K = 0.5523; // approssimazione di Bézier per i quarti di ellisse
function ellipseSegs(x, y, w, h) {
  const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
  return [
    { op: 'M', pts: [[cx + rx, cy]] },
    { op: 'C', pts: [[cx + rx, cy + ry * K], [cx + rx * K, cy + ry], [cx, cy + ry]] },
    { op: 'C', pts: [[cx - rx * K, cy + ry], [cx - rx, cy + ry * K], [cx - rx, cy]] },
    { op: 'C', pts: [[cx - rx, cy - ry * K], [cx - rx * K, cy - ry], [cx, cy - ry]] },
    { op: 'C', pts: [[cx + rx * K, cy - ry], [cx + rx, cy - ry * K], [cx + rx, cy]] },
    { op: 'Z' },
  ];
}
const poly = (pts) => [{ op: 'M', pts: [pts[0]] }, ...pts.slice(1).map((p) => ({ op: 'L', pts: [p] })), { op: 'Z' }];
function presetPath(geom, w, h) {
  const m = Math.min(w, h);
  let segs;
  switch (geom) {
    case 'ellipse': case 'flowChartConnector': segs = ellipseSegs(0, 0, w, h); break;
    case 'roundRect': case 'flowChartAlternateProcess': {
      const r = m * 0.1667, k = r * (1 - K);
      segs = [{ op: 'M', pts: [[r, 0]] }, { op: 'L', pts: [[w - r, 0]] }, { op: 'C', pts: [[w - k, 0], [w, k], [w, r]] }, { op: 'L', pts: [[w, h - r]] }, { op: 'C', pts: [[w, h - k], [w - k, h], [w - r, h]] }, { op: 'L', pts: [[r, h]] }, { op: 'C', pts: [[k, h], [0, h - k], [0, h - r]] }, { op: 'L', pts: [[0, r]] }, { op: 'C', pts: [[0, k], [k, 0], [r, 0]] }, { op: 'Z' }];
      break;
    }
    case 'triangle': case 'flowChartExtract': segs = poly([[w / 2, 0], [w, h], [0, h]]); break;
    case 'rtTriangle': segs = poly([[0, 0], [w, h], [0, h]]); break;
    case 'diamond': case 'flowChartDecision': segs = poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]); break;
    case 'parallelogram': case 'flowChartInputOutput': segs = poly([[w * 0.25, 0], [w, 0], [w * 0.75, h], [0, h]]); break;
    case 'trapezoid': segs = poly([[m * 0.25, 0], [w - m * 0.25, 0], [w, h], [0, h]]); break;
    case 'pentagon': segs = poly([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]]); break;
    case 'hexagon': segs = poly([[m * 0.25, 0], [w - m * 0.25, 0], [w, h / 2], [w - m * 0.25, h], [m * 0.25, h], [0, h / 2]]); break;
    case 'octagon': { const o = m * 0.29; segs = poly([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]); break; }
    case 'homePlate': segs = poly([[0, 0], [w - m / 2, 0], [w, h / 2], [w - m / 2, h], [0, h]]); break;
    case 'chevron': segs = poly([[0, 0], [w - m / 2, 0], [w, h / 2], [w - m / 2, h], [0, h], [m / 2, h / 2]]); break;
    case 'rightArrow': segs = poly([[0, h * 0.25], [w - m / 2, h * 0.25], [w - m / 2, 0], [w, h / 2], [w - m / 2, h], [w - m / 2, h * 0.75], [0, h * 0.75]]); break;
    case 'leftArrow': segs = poly([[w, h * 0.25], [m / 2, h * 0.25], [m / 2, 0], [0, h / 2], [m / 2, h], [m / 2, h * 0.75], [w, h * 0.75]]); break;
    case 'upArrow': segs = poly([[w * 0.25, h], [w * 0.25, m / 2], [0, m / 2], [w / 2, 0], [w, m / 2], [w * 0.75, m / 2], [w * 0.75, h]]); break;
    case 'downArrow': segs = poly([[w * 0.25, 0], [w * 0.75, 0], [w * 0.75, h - m / 2], [w, h - m / 2], [w / 2, h], [0, h - m / 2], [w * 0.25, h - m / 2]]); break;
    case 'star5': {
      const pts = [];
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.38 : 1; pts.push([w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)]); }
      segs = poly(pts); break;
    }
    case 'plus': case 'mathPlus': { const t = m * 0.25; segs = poly([[t, 0], [w - t, 0], [w - t, t], [w, t], [w, h - t], [w - t, h - t], [w - t, h], [t, h], [t, h - t], [0, h - t], [0, t], [t, t]].map(([x, y]) => [x, y])); break; }
    default: segs = poly([[0, 0], [w, 0], [w, h], [0, h]]);
  }
  return { segs, fill: true, stroke: true };
}
// Geometria personalizzata (a:custGeom): percorsi in coordinate proprie, scalati sulla forma
function custPaths(cg, W, H) {
  const out = [];
  for (const p of kids(kid(cg, 'pathLst'), 'path')) {
    const pw = intA(p, 'w', 0), ph = intA(p, 'h', 0);
    const sx = pw ? W / pw : 1 / EMU, sy = ph ? H / ph : 1 / EMU;
    const P = (pt) => [intA(pt, 'x', 0) * sx, intA(pt, 'y', 0) * sy];
    const segs = [];
    let cur = [0, 0];
    for (const c of p.children) {
      const pts = kids(c, 'pt');
      switch (c.localName) {
        case 'moveTo': cur = P(pts[0]); segs.push({ op: 'M', pts: [cur] }); break;
        case 'lnTo': cur = P(pts[0]); segs.push({ op: 'L', pts: [cur] }); break;
        case 'cubicBezTo': { const q = pts.map(P); segs.push({ op: 'C', pts: q }); cur = q[2]; break; }
        case 'quadBezTo': {
          const [c1, e] = pts.map(P);
          segs.push({ op: 'C', pts: [[cur[0] + (2 / 3) * (c1[0] - cur[0]), cur[1] + (2 / 3) * (c1[1] - cur[1])], [e[0] + (2 / 3) * (c1[0] - e[0]), e[1] + (2 / 3) * (c1[1] - e[1])], e] });
          cur = e; break;
        }
        case 'arcTo': {
          const wr = intA(c, 'wR', 0) * sx, hr = intA(c, 'hR', 0) * sy;
          const st = (intA(c, 'stAng', 0) / 60000) * Math.PI / 180, sw = (intA(c, 'swAng', 0) / 60000) * Math.PI / 180;
          const cx = cur[0] - wr * Math.cos(st), cy = cur[1] - hr * Math.sin(st);
          const n = Math.max(2, Math.ceil(Math.abs(sw) / (Math.PI / 24)));
          for (let i = 1; i <= n; i++) { const a = st + (sw * i) / n; cur = [cx + wr * Math.cos(a), cy + hr * Math.sin(a)]; segs.push({ op: 'L', pts: [cur] }); }
          break;
        }
        case 'close': segs.push({ op: 'Z' }); break;
        default:
      }
    }
    out.push({ segs, fill: attr(p, 'fill') !== 'none', stroke: attr(p, 'stroke') !== '0' && attr(p, 'stroke') !== 'false' });
  }
  return out;
}

/* ---------------- Contesto di una slide ---------------- */
async function partInfo(zip, part) {
  const doc = await zip.xml(part);
  return { part, doc, rels: await rels(zip, part), root: doc && doc.documentElement };
}
function phOf(node) {
  const nv = kid(node, 'nvSpPr') || kid(node, 'nvPicPr') || kid(node, 'nvGraphicFramePr') || kid(node, 'nvCxnSpPr');
  const ph = path(nv, 'nvPr', 'ph');
  if (!ph) return null;
  return { type: attr(ph, 'type') || 'body', idx: attr(ph, 'idx') };
}
const normType = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t);
function findPh(info, ph) {
  if (!info || !info.root) return null;
  const all = [...info.root.getElementsByTagNameNS('*', 'ph')];
  let hit = ph.idx != null ? all.find((p) => attr(p, 'idx') === ph.idx) : null;
  if (!hit) hit = all.find((p) => normType(attr(p, 'type') || 'body') === normType(ph.type));
  if (!hit) return null;
  let n = hit;
  while (n && !['sp', 'pic', 'graphicFrame'].includes(n.localName)) n = n.parentElement;
  return n;
}

function xfrmOf(node) {
  const spPr = kid(node, 'spPr') || kid(node, 'grpSpPr');
  const x = kid(spPr, 'xfrm') || kid(node, 'xfrm');
  if (!x) return null;
  const off = kid(x, 'off'), ext = kid(x, 'ext');
  if (!off || !ext) return null;
  return { x: intA(off, 'x', 0), y: intA(off, 'y', 0), w: intA(ext, 'cx', 0), h: intA(ext, 'cy', 0), rot: intA(x, 'rot', 0) / 60000, flipH: attr(x, 'flipH') === '1', flipV: attr(x, 'flipV') === '1', x2: x };
}

/* ---------------- Disegno ---------------- */
class SlideRenderer {
  constructor(pdf, zip, fonts, W, H, notes) {
    Object.assign(this, { pdf, zip, fonts, W, H, notes });
    this.imgCache = new Map();
  }

  async render(slidePart, defaultTextStyle) {
    const zip = this.zip;
    const slide = await partInfo(zip, slidePart);
    const layoutRel = relOfType(slide.rels, 'slideLayout');
    const layout = layoutRel ? await partInfo(zip, layoutRel.target) : null;
    const masterRel = layout && relOfType(layout.rels, 'slideMaster');
    const master = masterRel ? await partInfo(zip, masterRel.target) : null;
    const themeRel = master && relOfType(master.rels, 'theme');
    const themeDoc = themeRel ? await zip.xml(themeRel.target) : null;
    const cm = path(master && master.root, 'clrMap');
    const clrMap = {};
    if (cm) for (const a of cm.attributes) clrMap[a.name] = a.value;
    const ovr = path(slide.root, 'clrMapOvr', 'overrideClrMapping');
    if (ovr) for (const a of ovr.attributes) clrMap[a.name] = a.value;
    const theme = new Theme(themeDoc, clrMap);
    this.ctx = { slide, layout, master, theme, defaultTextStyle };
    const page = this.pdf.addPage([this.W, this.H]);
    this.page = page;

    // sfondo
    let bg = null;
    for (const info of [slide, layout, master]) {
      const b = path(info && info.root, 'cSld', 'bg');
      if (!b) continue;
      const bgPr = kid(b, 'bgPr');
      if (bgPr) bg = { fill: readFill(bgPr, theme), info };
      else {
        const ref = kid(b, 'bgRef');
        if (ref) {
          const col = theme.colorIn(ref);
          const idx = intA(ref, 'idx', 0);
          const lst = desc(themeDoc, 'bgFillStyleLst');
          const style = idx >= 1001 && lst ? lst.children[idx - 1001] : null;
          bg = { fill: style ? readFill({ children: [style] }, theme, col) || { type: 'solid', color: col } : col ? { type: 'solid', color: col } : null, info };
        }
      }
      if (bg && bg.fill) break;
    }
    if (bg && bg.fill && bg.fill.type === 'solid') page.drawRectangle({ x: 0, y: 0, width: this.W, height: this.H, color: toRgb(bg.fill.color), opacity: bg.fill.color.a });
    else if (bg && bg.fill && bg.fill.type === 'image') await this.drawImage(bg.info, bg.fill.rid, { x: 0, y: 0, w: this.W, h: this.H }, bg.fill.src);

    const showMaster = (info) => attr(info && info.root, 'showMasterSp') !== '0';
    if (master && showMaster(slide) && showMaster(layout)) await this.tree(master, path(master.root, 'cSld', 'spTree'), null, true);
    if (layout && showMaster(slide)) await this.tree(layout, path(layout.root, 'cSld', 'spTree'), null, true);
    await this.tree(slide, path(slide.root, 'cSld', 'spTree'), null, false);
  }

  // trasformazione EMU → punti, con i gruppi annidati
  box(xf, grp) {
    let { x, y, w, h } = xf;
    if (grp) {
      const sx = grp.chW ? grp.w / grp.chW : 1, sy = grp.chH ? grp.h / grp.chH : 1;
      x = grp.x + (x - grp.chX) * sx; y = grp.y + (y - grp.chY) * sy; w *= sx; h *= sy;
    }
    return { x, y, w, h };
  }
  pt(b) { return { x: b.x / EMU, y: this.H - (b.y + b.h) / EMU, w: b.w / EMU, h: b.h / EMU, top: this.H - b.y / EMU }; }

  async tree(info, spTree, grp, skipPlaceholders) {
    if (!spTree) return;
    for (let node of spTree.children) {
      if (node.localName === 'AlternateContent') node = kid(node, 'Choice') && kid(node, 'Choice').firstElementChild || kid(node, 'Fallback') && kid(node, 'Fallback').firstElementChild;
      if (!node) continue;
      try {
        if (skipPlaceholders && phOf(node)) continue;
        switch (node.localName) {
          case 'sp': await this.shape(info, node, grp); break;
          case 'pic': await this.picture(info, node, grp); break;
          case 'cxnSp': this.connector(node, grp); break;
          case 'graphicFrame': await this.frame(info, node, grp); break;
          case 'grpSp': {
            const xf = xfrmOf(node);
            if (!xf) break;
            const ch = kid(xf.x2, 'chOff'), che = kid(xf.x2, 'chExt');
            const b = this.box(xf, grp);
            await this.tree(info, node, { x: b.x, y: b.y, w: b.w, h: b.h, chX: intA(ch, 'x', 0), chY: intA(ch, 'y', 0), chW: intA(che, 'cx', 0), chH: intA(che, 'cy', 0) }, skipPlaceholders);
            break;
          }
          default:
        }
      } catch (e) {
        console.warn('Elemento della slide non convertito', e);
        this.notes.errors++;
      }
    }
  }

  // catena di placeholder (slide → layout → master) per ereditare posizione e stili
  phChain(info, node) {
    const ph = phOf(node);
    const chain = [node];
    if (!ph) return { ph, chain };
    const { layout, master } = this.ctx;
    if (info === this.ctx.slide) { const l = findPh(layout, ph); if (l) chain.push(l); }
    if (info !== this.ctx.master) { const m = findPh(master, ph); if (m) chain.push(m); }
    return { ph, chain };
  }

  async shape(info, node, grp) {
    const { theme } = this.ctx;
    const { ph, chain } = this.phChain(info, node);
    const xf = chain.map(xfrmOf).find(Boolean);
    if (!xf) return;
    const b = this.pt(this.box(xf, grp));
    const spPr = kid(node, 'spPr');
    const style = kid(node, 'style');
    let fill = readFill(spPr, theme);
    if (!fill && style) { const fr = kid(style, 'fillRef'); if (fr && intA(fr, 'idx', 0) > 0) { const col = theme.colorIn(fr); if (col) fill = { type: 'solid', color: col }; } }
    if (!fill && ph) for (const n of chain.slice(1)) { fill = readFill(kid(n, 'spPr'), theme); if (fill) break; }
    const line = this.readLine(spPr, style);
    const geom = attr(path(spPr, 'prstGeom'), 'prst') || 'rect';
    const cust = path(spPr, 'custGeom');
    if (fill && fill.type === 'image') await this.drawImage(info, fill.rid, b, fill.src);
    else this.drawGeom(geom, b, fill && fill.type === 'solid' ? fill.color : null, line, xf, cust);
    const tx = kid(node, 'txBody');
    // nelle ellissi il testo sta nel rettangolo inscritto
    const tb = geom === 'ellipse' ? { ...b, x: b.x + b.w * 0.1464, y: b.y + b.h * 0.1464, w: b.w * 0.7071, h: b.h * 0.7071 } : b;
    if (tx) this.text(tx, tb, chain, ph, style, {});
  }

  readLine(spPr, style) {
    const { theme } = this.ctx;
    const ln = kid(spPr, 'ln');
    if (ln && kid(ln, 'noFill')) return null;
    let color = ln ? theme.colorIn(kid(ln, 'solidFill')) : null;
    let w = ln ? intA(ln, 'w', null) : null;
    if (!color && style) { const lr = kid(style, 'lnRef'); if (lr && intA(lr, 'idx', 0) > 0) { color = theme.colorIn(lr); w = w || 9525 * intA(lr, 'idx', 1); } }
    if (!color) return null;
    return { color, w: (w || 9525) / EMU };
  }

  drawGeom(geom, b, fillCol, line, xf, custGeom) {
    if (!fillCol && !line) return;
    if (b.w <= 0 && b.h <= 0) return;
    if (geom === 'line' || geom === 'straightConnector1') { this.connector(null, null, b, line, xf); return; }
    const { w, h } = b;
    const paths = custGeom ? custPaths(custGeom, w, h) : [presetPath(geom, w, h)];
    // coordinate locali (origine in alto a sinistra) → pagina, con capovolgimenti e rotazione
    const cx = w / 2, cy = h / 2;
    const rot = ((xf && xf.rot) || 0) * Math.PI / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const top = this.H - (b.y + b.h);
    const T = ([x, y]) => {
      if (xf && xf.flipH) x = w - x;
      if (xf && xf.flipV) y = h - y;
      const dx = x - cx, dy = y - cy;
      return [b.x + cx + dx * cos - dy * sin, top + cy + dx * sin + dy * cos];
    };
    const f = (n) => (Math.round(n * 100) / 100).toString();
    for (const pth of paths) {
      let d = '';
      for (const seg of pth.segs) {
        if (seg.op === 'Z') { d += 'Z '; continue; }
        d += seg.op + ' ' + seg.pts.map((pt) => T(pt).map(f).join(' ')).join(' ') + ' ';
      }
      if (!d.trim()) continue;
      const o = {};
      if (fillCol && pth.fill) { o.color = toRgb(fillCol); o.opacity = fillCol.a; }
      if (line && pth.stroke) { o.borderColor = toRgb(line.color); o.borderWidth = line.w; o.borderOpacity = line.color.a; }
      if (!o.color && !o.borderColor) continue;
      this.page.drawSvgPath(d, { x: 0, y: this.H, ...o });
    }
  }

  connector(node, grp, bIn, lineIn, xfIn) {
    const xf = xfIn || xfrmOf(node);
    if (!xf) return;
    const b = bIn || this.pt(this.box(xf, grp));
    const line = lineIn || this.readLine(kid(node, 'spPr'), kid(node, 'style'));
    if (!line) return;
    let x1 = b.x, y1 = b.y + b.h, x2 = b.x + b.w, y2 = b.y;
    if (xf.flipH) [x1, x2] = [x2, x1];
    if (xf.flipV) [y1, y2] = [y2, y1];
    this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: Math.max(0.25, line.w), color: toRgb(line.color), opacity: line.color.a, lineCap: LineCapStyle.Round });
  }

  async picture(info, node, grp) {
    const { chain } = this.phChain(info, node);
    const xf = chain.map(xfrmOf).find(Boolean);
    if (!xf) return;
    const b = this.pt(this.box(xf, grp));
    const blipFill = kid(node, 'blipFill');
    const blip = kid(blipFill, 'blip');
    await this.drawImage(info, rId(blip, 'embed'), b, kid(blipFill, 'srcRect'));
    const line = this.readLine(kid(node, 'spPr'), kid(node, 'style'));
    if (line) this.page.drawRectangle({ x: b.x, y: b.y, width: b.w, height: b.h, borderColor: toRgb(line.color), borderWidth: line.w });
  }

  async loadImage(target) {
    if (this.imgCache.has(target)) return this.imgCache.get(target);
    const p = (async () => {
      const bytes = await this.zip.bytes(target);
      if (!bytes) return null;
      const ext = (target.split('.').pop() || '').toLowerCase();
      if (['emf', 'wmf', 'emz', 'wmz'].includes(ext)) { this.notes.images++; return null; }
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
      try {
        if (isPng) return { img: await this.pdf.embedPng(bytes), bytes, type: 'image/png' };
        if (isJpg) return { img: await this.pdf.embedJpg(bytes), bytes, type: 'image/jpeg' };
      } catch {}
      // altri formati (GIF, BMP, WEBP, SVG, TIFF…): passano dal canvas del browser
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : ext === 'webp' ? 'image/webp' : isJpg ? 'image/jpeg' : 'image/png';
      const canvas = await blobToCanvas(new Blob([bytes], { type: mime }));
      if (!canvas) { this.notes.images++; return null; }
      const png = await canvasToBytes(canvas, 'image/png');
      return { img: await this.pdf.embedPng(png), bytes: png, type: 'image/png' };
    })();
    this.imgCache.set(target, p);
    return p;
  }

  async drawImage(info, rid, b, srcRect) {
    const rel = rid && info.rels[rid];
    if (!rel || !rel.target) return;
    const loaded = await this.loadImage(rel.target);
    if (!loaded) return;
    let img = loaded.img;
    const l = intA(srcRect, 'l', 0) / 100000, t = intA(srcRect, 't', 0) / 100000, r = intA(srcRect, 'r', 0) / 100000, bt = intA(srcRect, 'b', 0) / 100000;
    if (l || t || r || bt) {
      // ritaglio dell'immagine
      const canvas = await blobToCanvas(new Blob([loaded.bytes], { type: loaded.type }));
      if (canvas) {
        const W = canvas.width, H = canvas.height;
        const sx = Math.max(0, l * W), sy = Math.max(0, t * H), sw = Math.max(1, W * (1 - l - r)), sh = Math.max(1, H * (1 - t - bt));
        const c2 = document.createElement('canvas');
        c2.width = Math.round(Math.min(sw, W)); c2.height = Math.round(Math.min(sh, H));
        c2.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, c2.width, c2.height);
        img = loaded.type === 'image/jpeg' ? await this.pdf.embedJpg(await canvasToBytes(c2, 'image/jpeg', 0.9)) : await this.pdf.embedPng(await canvasToBytes(c2, 'image/png'));
      }
    }
    this.page.drawImage(img, { x: b.x, y: b.y, width: b.w, height: b.h });
  }

  async frame(info, node, grp) {
    const xf = xfrmOf(node) || this.phChain(info, node).chain.map(xfrmOf).find(Boolean);
    if (!xf) return;
    const b = this.pt(this.box(xf, grp));
    const tbl = desc(node, 'tbl');
    if (tbl) { this.table(tbl, b); return; }
    if (desc(node, 'chart') || desc(node, 'relIds')) this.notes.charts++;
    // grafici e SmartArt: se c'è un'immagine di riserva la usiamo
    const fb = desc(node, 'Fallback');
    const blip = fb && desc(fb, 'blip');
    if (blip) await this.drawImage(info, rId(blip, 'embed'), b);
  }

  table(tbl, b) {
    const { theme } = this.ctx;
    const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => intA(c, 'w', 0) / EMU);
    const rows = kids(tbl, 'tr');
    const tblPr = kid(tbl, 'tblPr');
    const firstRow = attr(tblPr, 'firstRow') === '1', bandRow = attr(tblPr, 'bandRow') === '1';
    const styled = !!(tblPr && (kid(tblPr, 'tableStyleId') || firstRow || bandRow));
    const accent = theme.color({ localName: 'schemeClr', getAttribute: () => 'accent1', children: [] }) || { c: [68, 114, 196], a: 1 };
    const tintOf = (t) => ({ c: accent.c.map((x) => fromLin(toLin(x) * t + (1 - t))), a: 1 });
    let y = b.top;
    rows.forEach((tr, ri) => {
      const cells = kids(tr, 'tc');
      // altezza della riga: quella dichiarata o quella che serve al testo
      let rh = intA(tr, 'h', 0) / EMU;
      let x = b.x;
      const layouts = [];
      cells.forEach((tc, ci) => {
        const span = intA(tc, 'gridSpan', 1);
        const w = cols.slice(ci, ci + span).reduce((s, v) => s + v, 0) || cols[ci] || 50;
        if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') { layouts.push(null); return; }
        const header = firstRow && ri === 0;
        const tx = kid(tc, 'txBody');
        const lay = tx ? this.layoutText(tx, { x: 0, y: 0, w, h: rh }, [tc], null, null, { insets: tcInsets(kid(tc, 'tcPr')), defColor: header && styled ? { c: [255, 255, 255], a: 1 } : null, defBold: header && styled, defSize: 18 }) : null;
        if (lay) rh = Math.max(rh, lay.height + lay.ins.t + lay.ins.b);
        layouts.push({ tc, w, lay, header });
      });
      x = b.x;
      let ci = 0;
      for (const L of layouts) {
        const w = L ? L.w : cols[ci] || 0;
        if (L) {
          const tcPr = kid(L.tc, 'tcPr');
          let fill = readFill(tcPr, theme);
          if (!fill && styled) fill = { type: 'solid', color: L.header ? accent : bandRow && (ri - (firstRow ? 1 : 0)) % 2 === 0 ? tintOf(0.4) : tintOf(0.2) };
          if (fill && fill.type === 'solid') this.page.drawRectangle({ x, y: y - rh, width: w, height: rh, color: toRgb(fill.color), opacity: fill.color.a });
          if (styled) this.page.drawRectangle({ x, y: y - rh, width: w, height: rh, borderColor: rgb(1, 1, 1), borderWidth: 1 });
          else this.page.drawRectangle({ x, y: y - rh, width: w, height: rh, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
          if (L.lay) this.drawLayout(L.lay, { x, y: y - rh, w, h: rh, top: y });
        }
        x += w;
        ci += L ? intA(L.tc, 'gridSpan', 1) : 1;
      }
      y -= rh;
    });
  }

  /* ---------- Testo ---------- */
  // proprietà di livello (lvlNpPr) dalla catena di stili, dal più specifico al più generale
  levelProps(chain, ph, lvl, tx) {
    const { master, defaultTextStyle } = this.ctx;
    const tag = `lvl${lvl + 1}pPr`;
    const out = [];
    const add = (lst) => { const p = kid(lst, tag); if (p) out.push(p); };
    add(kid(tx, 'lstStyle'));
    for (const n of chain.slice(1)) add(kid(kid(n, 'txBody'), 'lstStyle'));
    const ts = path(master && master.root, 'txStyles');
    if (ph) {
      const t = normType(ph.type);
      add(kid(ts, t === 'title' ? 'titleStyle' : ['body'].includes(t) ? 'bodyStyle' : 'otherStyle'));
    } else add(kid(ts, 'otherStyle'));
    add(defaultTextStyle);
    return out;
  }

  layoutText(tx, b, chain, ph, style, extra = {}) {
    const { theme } = this.ctx;
    // proprietà del riquadro di testo (ereditate dai placeholder)
    const bodyPrs = [kid(tx, 'bodyPr'), ...chain.slice(1).map((n) => kid(kid(n, 'txBody'), 'bodyPr'))].filter(Boolean);
    const bp = (a, d) => { for (const p of bodyPrs) { const v = attr(p, a); if (v != null) return v; } return d; };
    const ins = extra.insets || { l: +bp('lIns', 91440) / EMU, r: +bp('rIns', 91440) / EMU, t: +bp('tIns', 45720) / EMU, b: +bp('bIns', 45720) / EMU };
    const anchor = bp('anchor', 't');
    const wrap = bp('wrap', 'square') !== 'none';
    const autofit = bodyPrs.map((p) => kid(p, 'normAutofit')).find(Boolean);
    const fontScale = autofit ? intA(autofit, 'fontScale', 100000) / 100000 : 1;
    const lnRed = autofit ? intA(autofit, 'lnSpcReduction', 0) / 100000 : 0;
    const fontRefCol = style ? theme.colorIn(kid(style, 'fontRef')) : null;
    const maxW = Math.max(4, b.w - ins.l - ins.r);
    const lines = [];
    let autoNum = {};
    for (const p of kids(tx, 'p')) {
      const pPr = kid(p, 'pPr');
      const lvl = intA(pPr, 'lvl', 0);
      const lv = [pPr, ...this.levelProps(chain, ph, lvl, tx)].filter(Boolean);
      const ownLvl = kid(kid(tx, 'lstStyle'), `lvl${lvl + 1}pPr`);
      const pa = (a, d) => { for (const x of lv) { const v = attr(x, a); if (v != null) return v; } return d; };
      const pk = (n) => { for (const x of lv) { const v = kid(x, n); if (v) return v; } return null; };
      const defRPrs = lv.map((x) => kid(x, 'defRPr')).filter(Boolean);
      const specific = [kid(pPr, 'defRPr'), kid(ownLvl, 'defRPr')].filter(Boolean);
      const algn = attr(pPr, 'algn') || attr(ownLvl, 'algn') || extra.defAlgn || pa('algn', 'l');
      const marL = +pa('marL', 0) / EMU, indent = +pa('indent', 0) / EMU;
      const spcPct = pk('lnSpc') ? intA(kid(pk('lnSpc'), 'spcPct'), 'val', 100000) / 100000 : 1;
      const spcBef = pk('spcBef') ? (kid(pk('spcBef'), 'spcPts') ? intA(kid(pk('spcBef'), 'spcPts'), 'val', 0) / 100 : null) : 0;
      const spcAft = pk('spcAft') && kid(pk('spcAft'), 'spcPts') ? intA(kid(pk('spcAft'), 'spcPts'), 'val', 0) / 100 : 0;
      const runStyle = (rPr) => {
        const rs = [rPr, ...defRPrs].filter(Boolean);
        const ra = (a, d) => { for (const x of rs) { const v = attr(x, a); if (v != null) return v; } return d; };
        const rk = (n) => { for (const x of rs) { const v = kid(x, n); if (v) return v; } return null; };
        const size = (+ra('sz', extra.defSize ? extra.defSize * 100 : 1800) / 100) * fontScale;
        const bold = ra('b', extra.defBold ? '1' : '0') === '1';
        const ital = ra('i', '0') === '1';
        const face = attr(rk('latin'), 'typeface') || '';
        const fam = familyOf(face.startsWith('+mj') ? theme.major : face.startsWith('+mn') || !face ? (ph && normType(ph.type) === 'title' ? theme.major : theme.minor) : face);
        // colore: run e paragrafo → stile della forma (fontRef) → stili ereditati
        let color = null;
        for (const x of [rPr, ...specific]) { const sf = kid(x, 'solidFill'); if (sf) { color = theme.colorIn(sf); break; } }
        if (!color) color = extra.defColor || fontRefCol || (rk('solidFill') ? theme.colorIn(rk('solidFill')) : null) || theme.color({ localName: 'schemeClr', getAttribute: () => 'tx1', children: [] });
        if (rk('noFill')) color = null;
        const realFace = face.startsWith('+mj') ? theme.major : face.startsWith('+mn') || !face ? (ph && normType(ph.type) === 'title' ? theme.major : theme.minor) : face;
        const sq = /calibri|carlito|segoe|open sans|narrow|condensed|helvetica neue|candara|corbel|aptos|tahoma/i.test(realFace) ? 0.9 : 1;
        return { size, sq, font: squeezed(this.fonts[fam][(bold ? 1 : 0) + (ital ? 2 : 0)], sq), color, u: ra('u', 'none') !== 'none', strike: ra('strike', 'noStrike') !== 'noStrike' };
      };
      // pezzi di testo del paragrafo
      const pieces = [];
      for (const r of p.children) {
        if (r.localName === 'r' || r.localName === 'fld') pieces.push({ text: (kid(r, 't') && kid(r, 't').textContent) || '', st: runStyle(kid(r, 'rPr')) });
        else if (r.localName === 'br') pieces.push({ br: true, st: runStyle(kid(r, 'rPr')) });
      }
      const endSt = runStyle(kid(p, 'endParaRPr'));
      const hasText = pieces.some((x) => x.text && x.text.trim());
      // punto elenco
      let bullet = null;
      if (hasText) {
        const buNoneIdx = lv.findIndex((x) => kid(x, 'buNone'));
        const buCharIdx = lv.findIndex((x) => kid(x, 'buChar'));
        const buAutoIdx = lv.findIndex((x) => kid(x, 'buAutoNum'));
        const first = [buNoneIdx, buCharIdx, buAutoIdx].filter((i) => i >= 0).sort((a, c) => a - c)[0];
        const st0 = pieces.find((x) => x.text) ? pieces.find((x) => x.text).st : endSt;
        const buSz = pk('buSzPct') ? intA(pk('buSzPct'), 'val', 100000) / 100000 : 1;
        const buCol = pk('buClr') ? theme.colorIn(pk('buClr')) : null;
        if (first !== undefined && first === buCharIdx) {
          let ch = attr(kid(lv[buCharIdx], 'buChar'), 'char') || '•';
          if (!safeText(ch).trim() || /[-]/.test(ch) || /[§ØüÜv]/.test(ch) && /wingdings|symbol/i.test(attr(pk('buFont'), 'typeface') || '')) ch = '•';
          bullet = { text: safeText(ch) || '•', st: { ...st0, size: st0.size * buSz, color: buCol || st0.color } };
        } else if (first !== undefined && first === buAutoIdx) {
          const sch = attr(kid(lv[buAutoIdx], 'buAutoNum'), 'type') || 'arabicPeriod';
          autoNum[lvl] = (autoNum[lvl] || intA(kid(lv[buAutoIdx], 'buAutoNum'), 'startAt', 1) - 1) + 1;
          const n = autoNum[lvl];
          const label = /alphaLc/.test(sch) ? String.fromCharCode(96 + ((n - 1) % 26) + 1) : /alphaUc/.test(sch) ? String.fromCharCode(64 + ((n - 1) % 26) + 1) : /romanLc/.test(sch) ? roman(n).toLowerCase() : /romanUc/.test(sch) ? roman(n) : String(n);
          bullet = { text: label + (/Paren(R|Both)/.test(sch) ? ')' : '.'), st: { ...st0, color: buCol || st0.color } };
        }
      }
      if (!bullet) for (const k in autoNum) if (+k >= lvl) delete autoNum[k];
      // impaginazione a parole
      const words = [];
      for (const pc of pieces) {
        if (pc.br) { words.push({ br: true, st: pc.st }); continue; }
        const t = safeText(pc.text);
        for (const tok of t.split(/(?<=\s)/)) if (tok) words.push({ text: tok, st: pc.st });
      }
      const firstX = marL + indent, restX = marL;
      let cur = { items: [], width: 0, x0: bullet ? marL : firstX, size: 0 };
      const pLines = [];
      const push = () => { if (!cur.size) cur.size = endSt.size; pLines.push(cur); cur = { items: [], width: 0, x0: restX, size: 0 }; };
      for (const w of words) {
        if (w.br) { cur.size = cur.size || w.st.size; push(); continue; }
        const ww = measure(w.st.font, w.text, w.st.size);
        const avail = maxW - cur.x0;
        if (wrap && cur.items.length && cur.width + ww - trailingSpace(w) > avail) {
          push();
          if (!w.text.trim()) continue;
        }
        // parola più lunga della riga: spezzata a caratteri
        if (wrap && ww > avail && w.text.length > 1) {
          let chunk = '';
          for (const ch of w.text) {
            if (cur.width + measure(w.st.font, chunk + ch, w.st.size) > avail && chunk) {
              cur.items.push({ text: chunk, st: w.st, w: measure(w.st.font, chunk, w.st.size) });
              cur.width += cur.items[cur.items.length - 1].w; cur.size = Math.max(cur.size, w.st.size); push(); chunk = '';
            }
            chunk += ch;
          }
          if (chunk) { const cw = measure(w.st.font, chunk, w.st.size); cur.items.push({ text: chunk, st: w.st, w: cw }); cur.width += cw; cur.size = Math.max(cur.size, w.st.size); }
          continue;
        }
        cur.items.push({ text: w.text, st: w.st, w: ww });
        cur.width += ww;
        cur.size = Math.max(cur.size, w.st.size);
      }
      push();
      pLines.forEach((l, i) => {
        l.algn = algn;
        l.lh = l.size * 1.2 * Math.max(0.5, spcPct - lnRed);
        l.before = i === 0 ? (spcBef == null ? l.size * 0.2 : spcBef) * (lines.length ? 1 : 0) : 0;
        l.after = i === pLines.length - 1 ? spcAft : 0;
        l.maxW = maxW - l.x0;
        if (i === 0 && bullet) l.bullet = { ...bullet, x: marL + indent };
        if (i === 0 && bullet) { l.x0 = marL; }
        lines.push(l);
      });
    }
    // rimuove gli spazi finali dalla misura delle righe
    for (const l of lines) {
      const last = l.items[l.items.length - 1];
      if (last) { const tr = last.text.replace(/\s+$/, ''); if (tr !== last.text) { const d = last.w - measure(last.st.font, tr, last.st.size); l.width -= d; last.text = tr; last.w -= d; } }
    }
    const height = lines.reduce((s, l) => s + l.before + l.lh + l.after, 0);
    return { lines, height, ins, anchor, w: b.w };
  }

  text(tx, b, chain, ph, style, extra) {
    const lay = this.layoutText(tx, b, chain, ph, style, extra);
    if (!lay.lines.some((l) => l.items.length)) return;
    this.drawLayout(lay, b);
  }

  drawLayout(lay, b) {
    const { ins } = lay;
    const innerH = b.h - ins.t - ins.b;
    let y = b.y + b.h - ins.t;
    if (lay.anchor === 'ctr') y -= Math.max(-ins.t, (innerH - lay.height) / 2);
    else if (lay.anchor === 'b') y -= Math.max(-ins.t, innerH - lay.height);
    const page = this.page;
    for (const l of lay.lines) {
      y -= l.before;
      const base = y - l.size * 0.95 - (l.lh - l.size * 1.2) * 0.5;
      let x = b.x + ins.l + l.x0;
      if (l.algn === 'ctr') x += Math.max(0, (l.maxW - l.width) / 2);
      else if (l.algn === 'r') x += Math.max(0, l.maxW - l.width);
      const draw = (text, px, st) => {
        const f = st.font.real || st.font;
        if (st.font.sq) page.pushOperators(setCharacterSqueeze(st.font.sq * 100));
        page.drawText(text, { x: px, y: base, size: st.size, font: f, color: toRgb(st.color), opacity: st.color.a });
        if (st.font.sq) page.pushOperators(setCharacterSqueeze(100));
      };
      if (l.bullet && l.bullet.st.color) {
        const bx = b.x + ins.l + Math.min(l.bullet.x, l.x0 - measure(l.bullet.st.font, l.bullet.text, l.bullet.st.size) - 2);
        draw(l.bullet.text, Math.max(b.x + ins.l, bx), l.bullet.st);
      }
      for (const it of l.items) {
        if (it.text && it.st.color) {
          draw(it.text, x, it.st);
          if (it.st.u) page.drawLine({ start: { x, y: base - it.st.size * 0.12 }, end: { x: x + it.w, y: base - it.st.size * 0.12 }, thickness: Math.max(0.5, it.st.size / 18), color: toRgb(it.st.color) });
          if (it.st.strike) page.drawLine({ start: { x, y: base + it.st.size * 0.3 }, end: { x: x + it.w, y: base + it.st.size * 0.3 }, thickness: Math.max(0.5, it.st.size / 18), color: toRgb(it.st.color) });
        }
        x += it.w;
      }
      y -= l.lh + l.after;
    }
  }
}

// font "stretto": misure ridotte e disegno con scala orizzontale (Tz)
const sqCache = new WeakMap();
function squeezed(font, sq) {
  if (sq === 1) return font;
  let m = sqCache.get(font);
  if (!m) { m = {}; sqCache.set(font, m); }
  if (!m[sq]) m[sq] = { real: font, sq, widthOfTextAtSize: (t, s) => textW(font, t, s) * sq };
  return m[sq];
}
// larghezza senza crenatura (pdf-lib la usa nel calcolo ma non nel disegno)
const cwCache = new WeakMap();
function textW(font, text, size) {
  let m = cwCache.get(font);
  if (!m) { m = new Map(); cwCache.set(font, m); }
  let w = 0;
  for (const ch of text) {
    let c = m.get(ch);
    if (c == null) { c = font.widthOfTextAtSize(ch, 1000); m.set(ch, c); }
    w += c;
  }
  return (w * size) / 1000;
}
const measure = (font, text, size) => (font.real ? font.widthOfTextAtSize(text, size) : textW(font, text, size));
function trailingSpace(w) {
  const m = w.text.match(/\s+$/);
  return m ? measure(w.st.font, m[0], w.st.size) : 0;
}
function tcInsets(tcPr) {
  return { l: intA(tcPr, 'marL', 91440) / EMU, r: intA(tcPr, 'marR', 91440) / EMU, t: intA(tcPr, 'marT', 45720) / EMU, b: intA(tcPr, 'marB', 45720) / EMU };
}
function roman(n) {
  const m = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of m) while (n >= v) { s += r; n -= v; }
  return s;
}
async function blobToCanvas(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    let w = img.naturalWidth || 800, h = img.naturalHeight || 600;
    const s = Math.min(1, 3000 / Math.max(w, h));
    w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

/* ---------------- Ingresso ---------------- */
export async function pptxToPdf(bytes, { hidden = false, progress } = {}) {
  const zip = readZip(bytes);
  const presPart = 'ppt/presentation.xml';
  const pres = await zip.xml(presPart);
  if (!pres) throw new Error('Il file non è una presentazione PowerPoint (.pptx). I vecchi file .ppt vanno prima salvati come .pptx.');
  const pr = await rels(zip, presPart);
  const sz = desc(pres, 'sldSz');
  const W = intA(sz, 'cx', 9144000) / EMU, H = intA(sz, 'cy', 6858000) / EMU;
  const slides = kids(desc(pres, 'sldIdLst'), 'sldId').map((s) => pr[rId(s, 'id')]).filter((r) => r && r.target);
  const pdf = await PDFDocument.create();
  pdf.setProducer('MULTIPEPPINS');
  pdf.setCreator('MULTIPEPPINS');
  const fonts = await loadFonts(pdf);
  const notes = { images: 0, charts: 0, errors: 0, hiddenSkipped: 0 };
  const r = new SlideRenderer(pdf, zip, fonts, W, H, notes);
  const defaultTextStyle = desc(pres, 'defaultTextStyle');
  for (let i = 0; i < slides.length; i++) {
    progress && progress(i / slides.length, `Slide ${i + 1} di ${slides.length}`);
    const sd = await zip.xml(slides[i].target);
    if (!hidden && sd && attr(sd.documentElement, 'show') === '0') { notes.hiddenSkipped++; continue; }
    await r.render(slides[i].target, defaultTextStyle);
  }
  if (!pdf.getPageCount()) throw new Error('La presentazione non contiene slide da convertire.');
  return { pdf, notes, slides: pdf.getPageCount() };
}
