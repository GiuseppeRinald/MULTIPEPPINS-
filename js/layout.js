// MULTIPEPPINS — impaginatore semplice: da HTML a PDF con i font standard
import { PDFLib, toWinAnsi } from './core.js';

const { PDFDocument, StandardFonts, rgb } = PDFLib;

// Larghezza senza crenatura: pdf-lib la applica nella misura ma non nel disegno
const cwCache = new WeakMap();
function textWidth(font, text, size) {
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

export const PAGE_SIZES = {
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
};

const FAMILIES = {
  Helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  Times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  Courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
};

function parseColor(c) {
  if (!c) return null;
  c = c.trim().toLowerCase();
  let m = c.match(/^#([0-9a-f]{6})$/);
  if (m) return rgb(parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255);
  m = c.match(/^#([0-9a-f]{3})$/);
  if (m) return rgb(parseInt(m[1][0] + m[1][0], 16) / 255, parseInt(m[1][1] + m[1][1], 16) / 255, parseInt(m[1][2] + m[1][2], 16) / 255);
  m = c.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return rgb(+m[1] / 255, +m[2] / 255, +m[3] / 255);
  const named = { red: [0.85, 0.1, 0.1], blue: [0.1, 0.25, 0.8], green: [0.1, 0.55, 0.2], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5], black: [0, 0, 0], white: [1, 1, 1], orange: [0.95, 0.55, 0.1], purple: [0.5, 0.2, 0.6] };
  return named[c] ? rgb(...named[c]) : null;
}

/* ---------- Dal DOM a una lista di blocchi ---------- */
const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'ADDRESS', 'DT', 'DD', 'CENTER', 'FORM', 'FIELDSET', 'BODY', 'HTML']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'SVG', 'BUTTON', 'SELECT', 'INPUT', 'TEXTAREA', 'META', 'LINK', 'TITLE']);
const HEAD_SCALE = { H1: 2, H2: 1.6, H3: 1.3, H4: 1.15, H5: 1.0, H6: 0.9 };

function collectBlocks(root, base) {
  const blocks = [];
  let cur = null;
  const newPara = (bs) => { cur = { type: 'p', runs: [], ...bs }; };
  const flush = () => {
    if (cur && cur.runs.some((r) => r.text.trim() || r.br)) blocks.push(cur);
    cur = null;
  };
  const ensure = (bs) => { if (!cur) newPara(bs); };

  const walk = (node, inl, bs) => {
    if (node.nodeType === 3) {
      let t = node.nodeValue;
      if (!bs.pre) t = t.replace(/[\s ]+/g, ' ');
      if (!t) return;
      if (!bs.pre && (!cur || !cur.runs.length || /\s$/.test(cur.runs[cur.runs.length - 1].text)) && /^\s/.test(t)) t = t.replace(/^\s+/, '');
      if (!t) return;
      ensure(bs);
      cur.runs.push({ text: t, ...inl });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    const st = node.getAttribute && node.getAttribute('style') || '';
    if (/display\s*:\s*none/i.test(st)) return;
    const ni = { ...inl };
    if (tag === 'B' || tag === 'STRONG' || tag === 'TH' || /font-weight\s*:\s*(bold|[6-9]00)/i.test(st)) ni.bold = true;
    if (tag === 'I' || tag === 'EM' || tag === 'CITE' || /font-style\s*:\s*italic/i.test(st)) ni.italic = true;
    if (tag === 'U' || tag === 'INS' || /text-decoration[^;]*underline/i.test(st)) ni.underline = true;
    if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE' || /line-through/i.test(st)) ni.strike = true;
    if (tag === 'A' && node.getAttribute('href')) { ni.color = rgb(0.1, 0.3, 0.8); ni.underline = true; }
    if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') ni.mono = true;
    if (tag === 'SMALL') ni.scale = (ni.scale || 1) * 0.85;
    const colAttr = node.getAttribute && (node.getAttribute('color') || (st.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i) || [])[1]);
    const col = parseColor(colAttr);
    if (col) ni.color = col;

    if (tag === 'BR') { ensure(bs); cur.runs.push({ text: '', br: true }); return; }
    if (tag === 'HR') { flush(); blocks.push({ type: 'hr' }); return; }
    if (tag === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (/^data:image\//i.test(src)) {
        flush();
        blocks.push({ type: 'img', src, w: +node.getAttribute('width') || null, h: +node.getAttribute('height') || null, indent: bs.indent || 0 });
      }
      return;
    }
    if (tag === 'TABLE') { flush(); blocks.push(tableBlock(node, ni)); return; }
    if (tag === 'UL' || tag === 'OL') {
      flush();
      let n = +(node.getAttribute('start') || 1);
      for (const li of node.children) {
        if (li.tagName.toUpperCase() !== 'LI') { walk(li, ni, bs); continue; }
        const marker = tag === 'OL' ? `${n++}.` : (bs.listLevel || 0) % 2 ? '–' : '•';
        const lbs = { ...bs, indent: (bs.indent || 0) + 18, listLevel: (bs.listLevel || 0) + 1, marker, spaceAfter: 2, spaceBefore: 0 };
        newPara(lbs);
        for (const c of li.childNodes) {
          const ct = c.nodeType === 1 ? c.tagName.toUpperCase() : '';
          if (ct === 'UL' || ct === 'OL') { flush(); walk(c, ni, { ...lbs, marker: null }); }
          else if (BLOCK.has(ct) && ct !== 'LI') { walk(c, ni, { ...lbs }); }
          else walk(c, ni, lbs);
        }
        flush();
      }
      return;
    }
    if (BLOCK.has(tag) || tag === 'TR') {
      flush();
      const nbs = { ...bs, marker: null };
      if (HEAD_SCALE[tag]) { nbs.scale = HEAD_SCALE[tag]; ni.bold = true; nbs.spaceBefore = 10; nbs.spaceAfter = 6; nbs.keepWithNext = true; }
      else { nbs.spaceBefore = bs.listLevel ? 0 : 0; nbs.spaceAfter = tag === 'P' ? 6 : 2; nbs.scale = bs.scale; }
      if (tag === 'BLOCKQUOTE') { nbs.indent = (bs.indent || 0) + 20; ni.italic = true; }
      if (tag === 'PRE') { nbs.pre = true; ni.mono = true; }
      if (tag === 'CENTER') nbs.align = 'center';
      const al = (st.match(/text-align\s*:\s*(left|center|right|justify)/i) || [])[1] || node.getAttribute('align');
      if (al) nbs.align = al.toLowerCase() === 'justify' ? 'left' : al.toLowerCase();
      if (/page-break-before\s*:\s*always|break-before\s*:\s*page/i.test(st)) blocks.push({ type: 'pagebreak' });
      if (bs.marker && tag !== 'LI') nbs.marker = bs.marker;
      newPara(nbs);
      for (const c of node.childNodes) walk(c, ni, nbs);
      flush();
      return;
    }
    for (const c of node.childNodes) walk(c, ni, bs);
  };

  const tableBlock = (tbl, inl) => {
    const rows = [];
    for (const tr of tbl.querySelectorAll('tr')) {
      if (tr.closest('table') !== tbl) continue;
      const cells = [];
      for (const td of tr.children) {
        const tg = td.tagName.toUpperCase();
        if (tg !== 'TD' && tg !== 'TH') continue;
        const sub = collectBlocks(td, base);
        const runs = [];
        sub.forEach((b, i) => {
          if (b.type !== 'p') return;
          if (i && runs.length) runs.push({ text: '', br: true });
          b.runs.forEach((r) => runs.push({ ...r, bold: r.bold || tg === 'TH' || inl.bold }));
        });
        const al = (td.getAttribute('style') || '').match(/text-align\s*:\s*(left|center|right)/i);
        cells.push({ runs, head: tg === 'TH', span: Math.max(1, +td.getAttribute('colspan') || 1), align: al ? al[1].toLowerCase() : (td.getAttribute('align') || null) });
      }
      if (cells.length) rows.push(cells);
    }
    return { type: 'table', rows };
  };

  newPara({});
  walk(root, {}, {});
  flush();
  return blocks;
}

/* ---------- Impaginazione ---------- */
export async function htmlToPdf(root, options = {}) {
  const size = options.pageSize || PAGE_SIZES.A4;
  const [PW, PH] = options.landscape ? [size[1], size[0]] : size;
  const M = options.margin ?? 50;
  const baseSize = options.fontSize || 11;
  const doc = options.doc || (await PDFDocument.create());
  const fam = FAMILIES[options.font || 'Helvetica'];
  const fonts = {};
  const famFonts = async (names) => Promise.all(names.map((n) => doc.embedFont(StandardFonts[n])));
  const [reg, bold, ital, boldItal] = await famFonts(fam);
  const [mreg, mbold, mital, mboldItal] = await famFonts(FAMILIES.Courier);
  fonts.n = { reg, bold, ital, boldItal };
  fonts.m = { reg: mreg, bold: mbold, ital: mital, boldItal: mboldItal };
  const fontOf = (r) => { const f = r.mono ? fonts.m : fonts.n; return r.bold && r.italic ? f.boldItal : r.bold ? f.bold : r.italic ? f.ital : f.reg; };

  const blocks = collectBlocks(root, {});
  const contentW = PW - 2 * M;
  let page = null;
  let y = 0;
  const newPage = () => { page = doc.addPage([PW, PH]); y = PH - M; };
  newPage();
  let pageHasContent = false;
  const need = (h) => { if (y - h < M && pageHasContent) { newPage(); pageHasContent = false; } };

  // Spezza i "run" in righe dentro una larghezza
  const layoutRuns = (runs, width, scale, mono) => {
    const lines = [];
    let line = { items: [], w: 0, h: 0 };
    const pushLine = () => { lines.push(line); line = { items: [], w: 0, h: 0 }; };
    for (const r of runs) {
      if (r.br) { if (!line.h) line.h = baseSize * (scale || 1) * 1.3; pushLine(); continue; }
      const sz = baseSize * (scale || 1) * (r.scale || 1);
      const font = fontOf({ ...r, mono: r.mono || mono });
      const text = toWinAnsi(r.text);
      const parts = r.pre ? [text] : text.split(/(\s+)/);
      for (let part of parts) {
        if (!part) continue;
        const sub = part.split('\n');
        sub.forEach((piece, pi) => {
          if (pi > 0) { if (!line.h) line.h = sz * 1.3; pushLine(); }
          if (!piece) return;
          let w = textWidth(font, piece, sz);
          const isSpace = /^\s+$/.test(piece);
          if (isSpace && !line.items.length) return;
          if (line.w + w > width && line.items.length && !isSpace) {
            // togli lo spazio finale
            const last = line.items[line.items.length - 1];
            if (last && /^\s+$/.test(last.text)) { line.w -= last.w; line.items.pop(); }
            pushLine();
          }
          // parola più lunga della riga: spezzala
          while (w > width && piece.length > 1) {
            let n = piece.length;
            while (n > 1 && textWidth(font, piece.slice(0, n), sz) > width - line.w) n--;
            if (n < 1) n = 1;
            const head = piece.slice(0, n);
            line.items.push({ text: head, font, size: sz, run: r, w: textWidth(font, head, sz) });
            line.h = Math.max(line.h, sz * 1.3);
            pushLine();
            piece = piece.slice(n);
            w = textWidth(font, piece, sz);
          }
          if (isSpace && !line.items.length) return;
          line.items.push({ text: isSpace ? ' ' : piece, font, size: sz, run: r, w: isSpace ? textWidth(font, ' ', sz) : w });
          line.w += isSpace ? textWidth(font, ' ', sz) : w;
          line.h = Math.max(line.h, sz * 1.3);
        });
      }
    }
    if (line.items.length) pushLine();
    for (const l of lines) {
      const last = l.items[l.items.length - 1];
      if (last && last.text === ' ') { l.w -= last.w; l.items.pop(); }
      if (!l.h) l.h = baseSize * (scale || 1) * 1.3;
    }
    return lines;
  };

  const drawLine = (l, x0, yTop, width, align) => {
    let x = x0 + (align === 'center' ? (width - l.w) / 2 : align === 'right' ? width - l.w : 0);
    const base = yTop - l.h * 0.78;
    for (const it of l.items) {
      if (it.text !== ' ') {
        page.drawText(it.text, { x, y: base, size: it.size, font: it.font, color: it.run.color || rgb(0.1, 0.1, 0.12) });
      }
      if (it.run.underline) page.drawLine({ start: { x, y: base - 1.5 }, end: { x: x + it.w, y: base - 1.5 }, thickness: 0.6, color: it.run.color || rgb(0.1, 0.1, 0.12) });
      if (it.run.strike) page.drawLine({ start: { x, y: base + it.size * 0.3 }, end: { x: x + it.w, y: base + it.size * 0.3 }, thickness: 0.6, color: it.run.color || rgb(0.1, 0.1, 0.12) });
      x += it.w;
    }
  };

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (b.type === 'pagebreak') { if (pageHasContent) { newPage(); pageHasContent = false; } continue; }
    if (b.type === 'hr') {
      need(14);
      y -= 7;
      page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.8, color: rgb(0.75, 0.75, 0.8) });
      y -= 7;
      pageHasContent = true;
      continue;
    }
    if (b.type === 'img') {
      try {
        const img = await embedDataUrl(doc, b.src);
        // pixel CSS → punti PDF (96 dpi → 72 dpi)
        let w = (b.w || img.width) * 0.75;
        let h = b.w && b.h ? b.h * 0.75 : w * (img.height / img.width);
        const maxW = contentW - (b.indent || 0);
        if (w > maxW) { h *= maxW / w; w = maxW; }
        const maxH = PH - 2 * M;
        if (h > maxH) { w *= maxH / h; h = maxH; }
        need(h + 6);
        page.drawImage(img, { x: M + (b.indent || 0), y: y - h, width: w, height: h });
        y -= h + 6;
        pageHasContent = true;
      } catch {}
      continue;
    }
    if (b.type === 'table') { drawTable(b); continue; }
    // Paragrafo
    const indent = b.indent || 0;
    const markerW = b.marker ? 14 : 0;
    const width = contentW - indent;
    const lines = layoutRuns(b.runs, width, b.scale, b.pre);
    if (!lines.length) continue;
    if (b.spaceBefore && pageHasContent) y -= b.spaceBefore;
    // tieni il titolo insieme alla riga successiva
    if (b.keepWithNext) need(lines[0].h + baseSize * 2.6);
    lines.forEach((l, li) => {
      need(l.h);
      if (li === 0 && b.marker) {
        const mf = fonts.n.reg;
        const ms = baseSize * (b.scale || 1);
        page.drawText(toWinAnsi(b.marker), { x: M + indent - markerW, y: y - l.h * 0.78, size: ms, font: mf, color: rgb(0.1, 0.1, 0.12) });
      }
      drawLine(l, M + indent, y, width, b.align);
      y -= l.h;
      pageHasContent = true;
    });
    y -= b.spaceAfter ?? 4;
  }

  function drawTable(t) {
    if (!t.rows.length) return;
    const nCols = Math.max(...t.rows.map((r) => r.reduce((s, c) => s + c.span, 0)));
    const pad = 4;
    let tScale = options.tableScale || 1;
    // larghezze in base al contenuto
    const textLen = (c) => c.runs.map((r) => r.text).join('').length;
    const est = new Array(nCols).fill(3);
    for (const r of t.rows) {
      let ci = 0;
      for (const c of r) {
        if (c.span === 1) est[ci] = Math.max(est[ci], Math.min(60, textLen(c) + 2));
        ci += c.span;
      }
    }
    const totalEst = est.reduce((a, b) => a + b, 0);
    const minColW = 18;
    let colW = est.map((e) => Math.max(minColW, (e / totalEst) * contentW));
    const sumW = colW.reduce((a, b) => a + b, 0);
    colW = colW.map((w) => (w * contentW) / sumW);
    // riduci il carattere se le colonne sono troppo strette
    if (contentW / nCols < 40) tScale = Math.max(0.55, tScale * ((contentW / nCols) / 40));
    for (const r of t.rows) {
      let ci = 0;
      const cellLayouts = r.map((c) => {
        const w = colW.slice(ci, ci + c.span).reduce((a, b) => a + b, 0);
        const x = M + colW.slice(0, ci).reduce((a, b) => a + b, 0);
        ci += c.span;
        const lines = layoutRuns(c.runs.length ? c.runs : [{ text: ' ' }], w - pad * 2, tScale, false);
        const h = lines.reduce((s, l) => s + l.h, 0) + pad * 2;
        return { c, w, x, lines, h };
      });
      const rowH = Math.max(baseSize * tScale * 1.3 + pad * 2, ...cellLayouts.map((x) => x.h));
      need(Math.min(rowH, PH - 2 * M));
      for (const cl of cellLayouts) {
        if (cl.c.head) page.drawRectangle({ x: cl.x, y: y - rowH, width: cl.w, height: rowH, color: rgb(0.94, 0.93, 0.98) });
        page.drawRectangle({ x: cl.x, y: y - rowH, width: cl.w, height: rowH, borderColor: rgb(0.72, 0.71, 0.78), borderWidth: 0.5 });
        let yy = y - pad;
        for (const l of cl.lines) {
          if (yy - l.h < M - 2) break;
          drawLine(l, cl.x + pad, yy, cl.w - pad * 2, cl.c.align || 'left');
          yy -= l.h;
        }
      }
      y -= rowH;
      pageHasContent = true;
    }
    y -= 8;
  }

  return doc;
}

async function embedDataUrl(doc, src) {
  const m = src.match(/^data:image\/([a-z+]+);base64,(.*)$/i);
  if (!m) throw new Error('img');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const kind = m[1].toLowerCase();
  if (kind === 'jpeg' || kind === 'jpg') return doc.embedJpg(bytes);
  if (kind === 'png') return doc.embedPng(bytes);
  // altri formati: convertili in PNG col canvas
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/' + kind }));
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  const png = await new Promise((r) => c.toBlob(r, 'image/png'));
  return doc.embedPng(new Uint8Array(await png.arrayBuffer()));
}
