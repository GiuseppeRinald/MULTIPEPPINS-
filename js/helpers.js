// MULTIPEPPINS — funzioni di supporto comuni agli strumenti
import { PDFLib, baseName, parseRanges, canvasToBytes } from './core.js';

const { degrees } = PDFLib;

export const pdfOut = (name, data) => ({ name, data, mime: 'application/pdf' });
export const outName = (file, suffix, ext = 'pdf') => `${baseName(file.name)}${suffix ? '_' + suffix : ''}.${ext}`;

// Opzioni standard "a quali pagine applicare"
export function pagesOption(label = 'Pagine') {
  return [
    { key: 'pagesMode', type: 'seg', label, default: 'all', options: [{ value: 'all', label: 'Tutte' }, { value: 'odd', label: 'Dispari' }, { value: 'even', label: 'Pari' }, { value: 'custom', label: 'Scegli' }] },
    { key: 'pagesRange', type: 'text', placeholder: 'es. 1-3, 5, 8-', help: 'Numeri o intervalli separati da virgola. "8-" significa dalla 8 alla fine.', showIf: (v) => v.pagesMode === 'custom' },
  ];
}
export function pickPages(opts, total) {
  const all = Array.from({ length: total }, (_, i) => i + 1);
  switch (opts.pagesMode) {
    case 'odd': return all.filter((p) => p % 2 === 1);
    case 'even': return all.filter((p) => p % 2 === 0);
    case 'custom': return [...new Set(parseRanges(opts.pagesRange, total))].sort((a, b) => a - b);
    default: return all;
  }
}

// Sistema di riferimento "visivo" di una pagina (tiene conto di /Rotate)
export function pageFrame(page) {
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const box = page.getMediaBox();
  const crop = page.getCropBox ? page.getCropBox() : box;
  const b = crop && crop.width > 0 ? crop : box;
  const W = b.width, H = b.height, x0 = b.x, y0 = b.y;
  const vw = rot % 180 ? H : W;
  const vh = rot % 180 ? W : H;
  // da coordinate visive (origine in basso a sinistra, y verso l'alto) a coordinate PDF
  const map = (vx, vy) => {
    switch (rot) {
      case 90: return { x: x0 + W - vy, y: y0 + vx };
      case 180: return { x: x0 + W - vx, y: y0 + H - vy };
      case 270: return { x: x0 + vy, y: y0 + H - vx };
      default: return { x: x0 + vx, y: y0 + vy };
    }
  };
  return { w: vw, h: vh, rot, map, rotate: degrees(rot) };
}

// Disegna una pagina incorporata "dritta" dentro un riquadro, centrata e in scala
export function drawPageFit(target, embedded, srcRot, box, { allowUpscale = true } = {}) {
  const ew = embedded.width, eh = embedded.height;
  const rot = ((srcRot % 360) + 360) % 360;
  const vw = rot % 180 ? eh : ew;
  const vh = rot % 180 ? ew : eh;
  let s = Math.min(box.w / vw, box.h / vh);
  if (!allowUpscale) s = Math.min(1, s);
  const dw = vw * s, dh = vh * s;
  const bx = box.x + (box.w - dw) / 2;
  const by = box.y + (box.h - dh) / 2;
  let x = bx, y = by, r = 0;
  if (rot === 90) { x = bx; y = by + dh; r = -90; }
  else if (rot === 180) { x = bx + dw; y = by + dh; r = 180; }
  else if (rot === 270) { x = bx + dw; y = by; r = 90; }
  target.drawPage(embedded, { x, y, xScale: s, yScale: s, rotate: degrees(r) });
  return { x: bx, y: by, w: dw, h: dh };
}

// Decodifica un'immagine (Blob/bytes) e la restituisce come canvas
export async function decodeToCanvas(blob, maxSide = 0) {
  const bmp = await createImageBitmap(blob);
  let w = bmp.width, h = bmp.height;
  if (maxSide && Math.max(w, h) > maxSide) { const s = maxSide / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  return c;
}

export async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Toglie i predittori PNG (Predictor >= 10) dai dati Flate
export function unpredict(data, columns, colors, bpc, predictor) {
  if (!predictor || predictor < 10) return data;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((columns * colors * bpc) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (rowLen + 1)];
    const src = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
    const cur = out.subarray(r * rowLen, (r + 1) * rowLen);
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      switch (ft) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; break; }
        default: break;
      }
      cur[i] = v & 0xff;
    }
    prev = cur;
  }
  return out;
}

export async function canvasJpeg(canvas, q = 0.85) {
  return canvasToBytes(canvas, 'image/jpeg', q);
}

// Testo delle pagine con pdf.js, raggruppato in righe
export async function pageLines(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) { if (it.hasEOL && items.length) items[items.length - 1].eol = true; continue; }
    const m = mul(vp.transform, it.transform);
    const h = Math.hypot(m[2], m[3]) || 10;
    items.push({ str: it.str, x: m[4], y: m[5], w: it.width * vp.scale, h, eol: it.hasEOL });
  }
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.min(l.h, it.h) * 0.5);
    if (line) { line.items.push(it); line.h = Math.max(line.h, it.h); }
    else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  lines.sort((a, b) => a.y - b.y);
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let text = '';
    let lastEnd = null;
    for (const it of l.items) {
      if (lastEnd != null) {
        const gap = it.x - lastEnd;
        if (gap > it.h * 0.15 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += gap > it.h * 2 ? '   ' : ' ';
      }
      text += it.str;
      lastEnd = it.x + it.w;
    }
    l.text = text.replace(/\s+$/, '');
    l.x = l.items[0].x;
  }
  return { lines, width: vp.width, height: vp.height };
}
function mul(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

// Raggruppa le righe in paragrafi
export function linesToParagraphs(lines) {
  const paras = [];
  let cur = null;
  const sizes = lines.map((l) => l.h).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 11;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const prev = lines[i - 1];
    const gap = prev ? l.y - prev.y : 0;
    const big = l.h > median * 1.25;
    const newPara = !cur || gap > Math.max(l.h, prev.h) * 1.6 || big !== cur.big || Math.abs(l.h - cur.size) > median * 0.25 || /^[•\-–·*]\s|^\d+[.)]\s/.test(l.text);
    if (newPara) {
      cur = { text: l.text, size: l.h, big, x: l.x };
      paras.push(cur);
    } else {
      cur.text = /-$/.test(cur.text) && /^[a-zàèéìòù]/.test(l.text) ? cur.text.slice(0, -1) + l.text : cur.text + ' ' + l.text;
    }
  }
  return { paras, median };
}

export function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export function fmtPct(a, b) {
  return Math.round((1 - b / a) * 100);
}

// Decodifica ASCII85 (usato da alcuni PDF per le immagini)
export function ascii85(bytes) {
  const out = [];
  let tuple = 0, count = 0;
  let i = 0;
  const n = bytes.length;
  if (bytes[0] === 60 && bytes[1] === 126) i = 2; // "<~"
  for (; i < n; i++) {
    const c = bytes[i];
    if (c === 126) break; // "~>"
    if (c <= 32) continue;
    if (c === 122 && count === 0) { out.push(0, 0, 0, 0); continue; } // "z"
    if (c < 33 || c > 117) throw new Error('ASCII85 non valido');
    tuple = tuple * 85 + (c - 33);
    count++;
    if (count === 5) { out.push((tuple >>> 24) & 255, (tuple >>> 16) & 255, (tuple >>> 8) & 255, tuple & 255); tuple = 0; count = 0; }
  }
  if (count > 1) {
    for (let k = count; k < 5; k++) tuple = tuple * 85 + 84;
    const b = [(tuple >>> 24) & 255, (tuple >>> 16) & 255, (tuple >>> 8) & 255, tuple & 255];
    for (let k = 0; k < count - 1; k++) out.push(b[k]);
  }
  return new Uint8Array(out);
}
