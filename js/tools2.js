// MULTIPEPPINS — elenco degli strumenti (parte 2: converti, modifica, confronta)
import { PDFLib, loadPdfLib, savePdf, renderPage, canvasToBytes, parseRanges, toWinAnsi, hexToRgb, readBytes, baseName, makeZip, loadScript, safeScale, imagesToPdf, LIB_URLS } from './core.js';
import { createEditor, prepareImage } from './editor.js';
import { htmlToPdf, PAGE_SIZES } from './layout.js';
import { runOcr, OCR_LANGS } from './ocr.js';
import { el, icon, toast } from './ui.js';
import { pdfOut, outName, pagesOption, pickPages, pageFrame, drawPageFit, decodeToCanvas, pageLines, linesToParagraphs, escapeXml } from './helpers.js';

const { PDFDocument, StandardFonts, degrees, rgb, PDFName, PDFBool, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } = PDFLib;

const SIZE_OPTS = [
  { value: 'A4', label: 'A4' },
  { value: 'Letter', label: 'Lettera (US)' },
  { value: 'A3', label: 'A3' },
  { value: 'A5', label: 'A5' },
  { value: 'Legal', label: 'Legal (US)' },
];
const MM = 72 / 25.4;

/* ======================================================================
   CONVERTI IN PDF
   ====================================================================== */

// Filtri per le foto dei documenti (Scansiona in PDF)
function scanFilter(canvas, mode) {
  if (mode === 'orig') return canvas;
  const w = canvas.width, h = canvas.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, w, h);
  const a = img.data;
  // stima dello sfondo (illuminazione) con una versione molto ridotta e sfocata
  const sw = 48, sh = Math.max(1, Math.round((48 * h) / w));
  const small = document.createElement('canvas');
  small.width = sw; small.height = sh;
  const sg = small.getContext('2d', { willReadFrequently: true });
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(canvas, 0, 0, sw, sh);
  // "massimo locale" per stimare la carta bianca anche dove c'è testo
  const sd = sg.getImageData(0, 0, sw, sh).data;
  const bgm = new Float32Array(sw * sh * 3);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let r = 0, gg = 0, b = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(sw - 1, Math.max(0, x + dx)), yy = Math.min(sh - 1, Math.max(0, y + dy));
      const o = (yy * sw + xx) * 4;
      r = Math.max(r, sd[o]); gg = Math.max(gg, sd[o + 1]); b = Math.max(b, sd[o + 2]);
    }
    const o = (y * sw + x) * 3;
    bgm[o] = r; bgm[o + 1] = gg; bgm[o + 2] = b;
  }
  const bgAt = (x, y, c) => {
    // interpolazione bilineare
    const fx = (x / w) * sw - 0.5, fy = (y / h) * sh - 0.5;
    const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
    const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    const v = (xx, yy) => bgm[(yy * sw + xx) * 3 + c];
    return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (mode === 'color') {
        for (let c = 0; c < 3; c++) {
          const bg = Math.max(40, bgAt(x, y, c));
          a[o + c] = Math.max(0, Math.min(255, (a[o + c] / bg) * 255 * 1.04));
        }
      } else {
        const gray = 0.299 * a[o] + 0.587 * a[o + 1] + 0.114 * a[o + 2];
        const bg = Math.max(40, 0.299 * bgAt(x, y, 0) + 0.587 * bgAt(x, y, 1) + 0.114 * bgAt(x, y, 2));
        let r = gray / bg;
        let v;
        if (mode === 'doc') v = 255 * Math.max(0, Math.min(1, (r - 0.55) / 0.33));
        else v = 255 * Math.max(0, Math.min(1, r * 1.05));
        a[o] = a[o + 1] = a[o + 2] = v;
      }
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

async function imagesToPdfTool(files, opts, progress, filterMode) {
  const pagesIn = [];
  for (let i = 0; i < files.length; i++) {
    progress(i / files.length, files[i].name);
    let canvas;
    try {
      canvas = await decodeToCanvas(files[i].file, filterMode ? 3000 : 4000);
    } catch {
      throw new Error(`"${files[i].name}" non è un'immagine leggibile da questo browser (i file HEIC dell'iPhone vanno prima convertiti in JPG).`);
    }
    if (filterMode) scanFilter(canvas, filterMode);
    const isPng = /png|gif|webp|bmp/i.test(files[i].type) && !filterMode;
    const bytes = await canvasToBytes(canvas, isPng ? 'image/png' : 'image/jpeg', filterMode === 'doc' ? 0.8 : 0.9);
    pagesIn.push({ bytes, type: isPng ? 'png' : 'jpg', w: canvas.width, h: canvas.height, name: files[i].name });
    canvas.width = canvas.height = 1;
  }
  const margin = { none: 0, small: 20, big: 50 }[opts.margin || 'none'];
  const build = async (list) => {
    const doc = await PDFDocument.create();
    for (const p of list) {
      const img = p.type === 'png' ? await doc.embedPng(p.bytes) : await doc.embedJpg(p.bytes);
      let pw, ph;
      if (opts.size === 'fit') {
        const s = Math.min(0.75, 1200 / Math.max(p.w, p.h));
        pw = p.w * s + margin * 2; ph = p.h * s + margin * 2;
      } else {
        [pw, ph] = PAGE_SIZES[opts.size] || PAGE_SIZES.A4;
        const land = opts.orient === 'landscape' || (opts.orient === 'auto' && p.w > p.h);
        if (land) [pw, ph] = [ph, pw];
      }
      const page = doc.addPage([pw, ph]);
      const bw = pw - margin * 2, bh = ph - margin * 2;
      const s = Math.min(bw / p.w, bh / p.h);
      const dw = p.w * s, dh = p.h * s;
      page.drawImage(img, { x: margin + (bw - dw) / 2, y: margin + (bh - dh) / 2, width: dw, height: dh });
    }
    return savePdf(doc);
  };
  if (opts.merge === false && pagesIn.length > 1) {
    const outputs = [];
    for (const p of pagesIn) outputs.push(pdfOut(baseName(p.name) + '.pdf', await build([p])));
    return { outputs, zipName: 'immagini_pdf.zip' };
  }
  return { outputs: [pdfOut(pagesIn.length === 1 ? baseName(pagesIn[0].name) + '.pdf' : (filterMode ? 'scansione.pdf' : 'immagini.pdf'), await build(pagesIn))], stats: `${pagesIn.length} ${pagesIn.length === 1 ? 'pagina' : 'pagine'}` };
}

const pageLayoutOpts = (withFit) => [
  { key: 'size', type: 'select', label: 'Formato pagina', default: withFit ? 'A4' : 'A4', options: withFit ? [...SIZE_OPTS, { value: 'fit', label: 'Uguale all\'immagine' }] : SIZE_OPTS },
  { key: 'orient', type: 'seg', label: 'Orientamento', default: 'auto', options: [{ value: 'auto', label: 'Automatico' }, { value: 'portrait', label: 'Verticale' }, { value: 'landscape', label: 'Orizzontale' }], showIf: (v) => v.size !== 'fit' },
  { key: 'margin', type: 'seg', label: 'Margini', default: 'none', options: [{ value: 'none', label: 'Nessuno' }, { value: 'small', label: 'Piccoli' }, { value: 'big', label: 'Grandi' }] },
];

function textImportField(accept, label) {
  return (v, set) => {
    const inp = el('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', async () => {
      const f = inp.files[0];
      if (!f) return;
      const txt = await f.text();
      set('text', txt);
      set('title', baseName(f.name));
      const ta = inp.closest('.side-body').querySelector('textarea');
      if (ta) ta.value = txt;
      toast(`Caricato "${f.name}"`);
    });
    return el('div', {}, inp, el('button', { class: 'btn-sec', type: 'button', onclick: () => inp.click() }, icon('plus', 16), label));
  };
}

const CONVERT_IN = [
  {
    id: 'immagini-in-pdf', cat: 'in', icon: 'jpg', name: 'Immagini in PDF',
    desc: 'Trasforma foto JPG, PNG e altre immagini in un PDF.',
    keywords: 'jpg png foto immagine converti',
    accept: 'image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp', multiple: true, orderMatters: true,
    pickLabel: 'Seleziona le immagini', action: 'Converti in PDF', working: 'Creazione del PDF',
    options: [...pageLayoutOpts(true), { key: 'merge', type: 'checkbox', label: 'Unisci tutte le immagini in un solo PDF', default: true }],
    run: ({ files, opts, progress }) => imagesToPdfTool(files, opts, progress, null),
  },
  {
    id: 'scansiona-in-pdf', cat: 'in', icon: 'scan', name: 'Scansiona in PDF', isNew: true,
    desc: 'Fotografa i documenti col telefono: sfondo bianco e testo nitido, come uno scanner.',
    keywords: 'scanner fotocamera foto documento camera',
    accept: 'image/*,.jpg,.jpeg,.png,.webp', multiple: true, orderMatters: true, capture: true,
    pickLabel: 'Scegli le foto', action: 'Crea il PDF', working: 'Pulizia delle scansioni',
    options: [
      { key: 'filter', type: 'radio', label: 'Effetto', default: 'doc', options: [
        { value: 'doc', label: 'Documento', desc: 'Bianco e nero nitido, ideale per testi' },
        { value: 'gray', label: 'Scala di grigi', desc: 'Sfondo pulito, sfumature conservate' },
        { value: 'color', label: 'Colori migliorati', desc: 'Sfondo bianco, colori mantenuti' },
        { value: 'orig', label: 'Originale', desc: 'Nessuna modifica' },
      ] },
      { key: 'size', type: 'select', label: 'Formato pagina', default: 'A4', options: [...SIZE_OPTS, { value: 'fit', label: 'Uguale alla foto' }] },
    ],
    run: ({ files, opts, progress }) => imagesToPdfTool(files, { ...opts, orient: 'auto', margin: 'none', merge: true }, progress, opts.filter),
  },
  {
    id: 'word-in-pdf', cat: 'in', icon: 'word', name: 'Word in PDF',
    desc: 'Converti documenti Word (DOCX) in PDF.',
    keywords: 'docx doc word converti',
    accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', multiple: true,
    pickLabel: 'Seleziona i file Word', action: 'Converti in PDF', working: 'Conversione da Word',
    options: [
      { key: 'size', type: 'select', label: 'Formato pagina', default: 'A4', options: SIZE_OPTS },
      { key: 'font', type: 'seg', label: 'Carattere', default: 'Helvetica', options: [{ value: 'Helvetica', label: 'Sans' }, { value: 'Times', label: 'Serif' }] },
      { type: 'note', text: 'Testo, titoli, elenchi, tabelle e immagini vengono convertiti; impaginazioni molto elaborate possono risultare semplificate. I vecchi file .doc vanno prima salvati come .docx.' },
    ],
    async run({ files, opts, progress }) {
      progress(0.05, 'Caricamento del convertitore…');
      const mammoth = await loadScript([
        'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js',
        'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
        'https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js',
      ], 'mammoth');
      const outputs = [];
      for (let i = 0; i < files.length; i++) {
        progress(0.1 + (0.9 * i) / files.length, files[i].name);
        const res = await mammoth.convertToHtml({ arrayBuffer: files[i].bytes.buffer.slice(files[i].bytes.byteOffset, files[i].bytes.byteOffset + files[i].bytes.byteLength) });
        const root = new DOMParser().parseFromString(`<body>${res.value}</body>`, 'text/html').body;
        const doc = await htmlToPdf(root, { pageSize: PAGE_SIZES[opts.size], font: opts.font, fontSize: 11, margin: 60 });
        outputs.push(pdfOut(outName(files[i], ''), await savePdf(doc)));
      }
      return { outputs, zipName: 'word_in_pdf.zip' };
    },
  },
  {
    id: 'excel-in-pdf', cat: 'in', icon: 'excel', name: 'Excel in PDF',
    desc: 'Converti fogli Excel o CSV in PDF con tabelle ben impaginate.',
    keywords: 'xlsx xls csv foglio calcolo tabella',
    accept: '.xlsx,.xls,.ods,.csv,text/csv', multiple: true,
    pickLabel: 'Seleziona i file Excel', action: 'Converti in PDF', working: 'Conversione da Excel',
    options: [
      { key: 'orient', type: 'seg', label: 'Orientamento', default: 'landscape', options: [{ value: 'landscape', label: 'Orizzontale' }, { value: 'portrait', label: 'Verticale' }] },
      { key: 'size', type: 'select', label: 'Formato pagina', default: 'A4', options: SIZE_OPTS },
      { key: 'allSheets', type: 'checkbox', label: 'Includi tutti i fogli', default: true },
    ],
    async run({ files, opts, progress }) {
      const outputs = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        progress(i / files.length, f.name);
        let sheets = [];
        if (/\.csv$/i.test(f.name)) {
          sheets = [{ name: baseName(f.name), rows: parseCsv(new TextDecoder().decode(f.bytes)) }];
        } else {
          const XLSX = await loadScript([
            'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
            'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
            'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js',
          ], 'XLSX');
          const wb = XLSX.read(f.bytes, { type: 'array', cellDates: true });
          const names = opts.allSheets ? wb.SheetNames : wb.SheetNames.slice(0, 1);
          for (const n of names) sheets.push({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '', blankrows: false }) });
        }
        const html = sheets.map((s) => `${sheets.length > 1 ? `<h3>${escapeXml(s.name)}</h3>` : ''}<table>${trimRows(s.rows).map((r, ri) => `<tr>${r.map((c) => `<${ri === 0 ? 'th' : 'td'}${/^-?[\d.,]+%?$/.test(String(c).trim()) ? ' align="right"' : ''}>${escapeXml(c ?? '')}</${ri === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table><div style="page-break-before:always"></div>`).join('');
        const root = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
        root.lastElementChild && root.lastElementChild.remove();
        const doc = await htmlToPdf(root, { pageSize: PAGE_SIZES[opts.size], landscape: opts.orient === 'landscape', fontSize: 9, margin: 30 });
        outputs.push(pdfOut(outName(f, ''), await savePdf(doc)));
      }
      return { outputs, zipName: 'excel_in_pdf.zip' };
    },
  },
  {
    id: 'testo-in-pdf', cat: 'in', icon: 'text', name: 'Testo in PDF',
    desc: 'Scrivi o incolla un testo (o carica un file .txt) e ottieni un PDF.',
    keywords: 'txt testo scrivi lettera',
    noFiles: true, action: 'Crea il PDF', working: 'Creazione del PDF',
    stage: (ctx) => { ctx.stage.append(el('div', { class: 'tool-head', style: { borderRadius: '20px' } }, el('h1', {}, 'Testo in PDF'), el('p', {}, 'Scrivi o incolla il testo nel riquadro, scegli carattere e formato e premi "Crea il PDF".'))); },
    options: [
      { key: 'import', type: 'custom', render: textImportField('.txt,.md,.csv,.log,text/plain', 'Carica un file di testo') },
      { key: 'text', type: 'textarea', label: 'Testo', placeholder: 'Scrivi o incolla qui il tuo testo…' },
      { key: 'title', type: 'text', label: 'Nome del file', default: 'documento' },
      { key: 'font', type: 'seg', label: 'Carattere', default: 'Helvetica', options: [{ value: 'Helvetica', label: 'Sans' }, { value: 'Times', label: 'Serif' }, { value: 'Courier', label: 'Mono' }] },
      { key: 'fontSize', type: 'number', label: 'Dimensione', default: 11, min: 6, max: 40 },
      { key: 'size', type: 'select', label: 'Formato pagina', default: 'A4', options: SIZE_OPTS },
    ],
    validate: (o) => (o.text && o.text.trim() ? null : 'Scrivi o carica un testo.'),
    async run({ opts }) {
      const root = document.createElement('div');
      for (const block of opts.text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
        const p = document.createElement('p');
        block.split('\n').forEach((line, i) => { if (i) p.append(document.createElement('br')); p.append(document.createTextNode(line)); });
        root.append(p);
      }
      const doc = await htmlToPdf(root, { pageSize: PAGE_SIZES[opts.size], font: opts.font, fontSize: +opts.fontSize || 11, margin: 56 });
      return { outputs: [pdfOut((opts.title || 'documento').replace(/[\\/:*?"<>|]/g, '_') + '.pdf', await savePdf(doc))] };
    },
  },
  {
    id: 'html-in-pdf', cat: 'in', icon: 'html', name: 'HTML in PDF',
    desc: 'Converti codice o file HTML in un documento PDF.',
    keywords: 'html web pagina codice',
    noFiles: true, action: 'Crea il PDF', working: 'Creazione del PDF',
    stage: (ctx) => { ctx.stage.append(el('div', { class: 'tool-head', style: { borderRadius: '20px' } }, el('h1', {}, 'HTML in PDF'), el('p', {}, 'Incolla il codice HTML o carica un file .html. Vengono convertiti testi, titoli, elenchi, tabelle e immagini incorporate.'))); },
    options: [
      { key: 'import', type: 'custom', render: textImportField('.html,.htm,text/html', 'Carica un file HTML') },
      { key: 'text', type: 'textarea', label: 'Codice HTML', placeholder: '<h1>Titolo</h1>\n<p>Il mio testo…</p>' },
      { key: 'title', type: 'text', label: 'Nome del file', default: 'pagina' },
      { key: 'size', type: 'select', label: 'Formato pagina', default: 'A4', options: SIZE_OPTS },
      { key: 'orient', type: 'seg', label: 'Orientamento', default: 'portrait', options: [{ value: 'portrait', label: 'Verticale' }, { value: 'landscape', label: 'Orizzontale' }] },
    ],
    validate: (o) => (o.text && o.text.trim() ? null : 'Incolla o carica il codice HTML.'),
    async run({ opts }) {
      const root = new DOMParser().parseFromString(opts.text, 'text/html').body;
      const doc = await htmlToPdf(root, { pageSize: PAGE_SIZES[opts.size], landscape: opts.orient === 'landscape', fontSize: 11, margin: 50 });
      return { outputs: [pdfOut((opts.title || 'pagina').replace(/[\\/:*?"<>|]/g, '_') + '.pdf', await savePdf(doc))] };
    },
  },
];

function parseCsv(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function trimRows(rows) {
  let maxCol = 0;
  for (const r of rows) for (let i = r.length - 1; i >= 0; i--) if (String(r[i] ?? '').trim()) { maxCol = Math.max(maxCol, i + 1); break; }
  return rows.filter((r) => r.some((c) => String(c ?? '').trim())).map((r) => { const x = r.slice(0, maxCol); while (x.length < maxCol) x.push(''); return x; });
}

/* ======================================================================
   CONVERTI DA PDF
   ====================================================================== */
async function pageImage(pdf, n, dpi, type = 'image/jpeg', q = 0.88) {
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale: 1, rotation: page.rotate });
  const { canvas } = await renderPage(pdf, n, safeScale(vp.width, vp.height, dpi / 72));
  const bytes = await canvasToBytes(canvas, type, q);
  const res = { bytes, w: canvas.width, h: canvas.height, wPt: vp.width, hPt: vp.height };
  canvas.width = canvas.height = 1;
  return res;
}
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Foglio Excel minimale (senza librerie esterne)
function colName(i) { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function buildXlsx(sheets) {
  const enc = new TextEncoder();
  const files = [];
  const used = new Set();
  const names = sheets.map((s, i) => {
    let n = String(s.name || `Foglio${i + 1}`).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31) || `Foglio${i + 1}`;
    while (used.has(n.toLowerCase())) n = n.slice(0, 28) + '_' + i;
    used.add(n.toLowerCase());
    return n;
  });
  files.push({ name: '[Content_Types].xml', bytes: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) });
  files.push({ name: '_rels/.rels', bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') });
  files.push({ name: 'xl/workbook.xml', bytes: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) });
  files.push({ name: 'xl/_rels/workbook.xml.rels', bytes: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) });
  files.push({ name: 'xl/styles.xml', bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>') });
  sheets.forEach((s, si) => {
    const widths = [];
    const rowsXml = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
      if (c == null || c === '') return '';
      const ref = colName(ci) + (ri + 1);
      widths[ci] = Math.max(widths[ci] || 8, Math.min(60, String(c).length + 2));
      const num = toNumber(c);
      if (num != null) return `<c r="${ref}"><v>${num}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${s.boldFirst && ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${escapeXml(c)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w || 8}" customWidth="1"/>`).join('')}</cols>` : '';
    files.push({ name: `xl/worksheets/sheet${si + 1}.xml`, bytes: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rowsXml}</sheetData></worksheet>`) });
  });
  return makeZip(files);
}
function toNumber(v) {
  const s = String(v).trim();
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d+$/.test(s)) return +s.replace(/\./g, '').replace(',', '.');
  if (/^-?\d+(\.\d+)?$/.test(s) && !/^0\d/.test(s) && s.length < 15) return +s;
  return null;
}

// Righe → celle → colonne allineate
async function pageTable(pdf, n) {
  const { lines } = await pageLines(pdf, n);
  const rows = lines.map((l) => {
    const cells = [];
    let cur = null;
    for (const it of l.items) {
      if (cur && it.x - (cur.x + cur.w) < it.h * 0.9) { cur.text += (it.x - (cur.x + cur.w) > it.h * 0.15 ? ' ' : '') + it.str; cur.w = it.x + it.w - cur.x; }
      else { cur = { x: it.x, w: it.w, text: it.str, h: it.h }; cells.push(cur); }
    }
    return cells;
  });
  const xs = rows.flat().map((c) => c.x).sort((a, b) => a - b);
  const avgH = rows.flat().reduce((s, c) => s + c.h, 0) / Math.max(1, rows.flat().length) || 10;
  const cols = [];
  for (const x of xs) if (!cols.length || x - cols[cols.length - 1] > avgH * 1.5) cols.push(x);
  return rows.map((cells) => {
    const r = new Array(cols.length).fill('');
    for (const c of cells) {
      let ci = 0;
      for (let k = 0; k < cols.length; k++) if (cols[k] <= c.x + avgH * 0.75) ci = k;
      r[ci] = r[ci] ? r[ci] + ' ' + c.text.trim() : c.text.trim();
    }
    return r;
  });
}

const CONVERT_FROM = [
  {
    id: 'pdf-in-jpg', cat: 'da', icon: 'jpg', name: 'PDF in JPG',
    desc: 'Trasforma ogni pagina del PDF in un\'immagine JPG o PNG.',
    keywords: 'immagine png jpeg foto',
    multiple: true, action: 'Converti in immagini', working: 'Creazione delle immagini',
    options: [
      { key: 'fmt', type: 'seg', label: 'Formato', default: 'jpg', options: [{ value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }] },
      { key: 'dpi', type: 'seg', label: 'Qualità', default: 150, options: [{ value: 100, label: 'Normale' }, { value: 150, label: 'Alta' }, { value: 300, label: 'Massima' }] },
      ...pagesOption('Pagine da convertire'),
    ],
    async run({ files, opts, progress }) {
      const outputs = [];
      for (const f of files) {
        const list = pickPages(opts, f.pages);
        for (let i = 0; i < list.length; i++) {
          progress(i / list.length, `${f.name}: pagina ${list[i]}`);
          const img = await pageImage(f.pdf, list[i], opts.dpi, opts.fmt === 'png' ? 'image/png' : 'image/jpeg', 0.9);
          outputs.push({ name: `${baseName(f.name)}_pagina_${list[i]}.${opts.fmt}`, data: img.bytes, mime: opts.fmt === 'png' ? 'image/png' : 'image/jpeg' });
        }
      }
      return { outputs, zipName: outName(files[0], 'immagini', 'zip'), stats: `${outputs.length} ${outputs.length === 1 ? 'immagine' : 'immagini'}` };
    },
  },
  {
    id: 'pdf-in-word', cat: 'da', icon: 'word', name: 'PDF in Word',
    desc: 'Converti il PDF in un documento Word (DOCX) da modificare.',
    keywords: 'docx word modificabile',
    action: 'Converti in Word', working: 'Conversione in Word',
    options: [
      { key: 'mode', type: 'radio', default: 'auto', options: [
        { value: 'auto', label: 'Testo modificabile', desc: 'Il testo diventa modificabile; le pagine scansionate restano come immagini' },
        { value: 'image', label: 'Aspetto identico', desc: 'Ogni pagina come immagine: identica ma non modificabile' },
      ] },
    ],
    async run({ files, opts, progress }) {
      const f = files[0];
      progress(0.02, 'Caricamento del convertitore…');
      const D = await loadScript(LIB_URLS.docx, 'docx');
      const first = await f.pdf.getPage(1);
      const vp = first.getViewport({ scale: 1, rotation: first.rotate });
      const tw = (pt) => Math.round(pt * 20);
      const margin = 50;
      const contentPx = ((vp.width - margin * 2) * 96) / 72;
      const children = [];
      for (let n = 1; n <= f.pages; n++) {
        progress((n - 1) / f.pages, `Pagina ${n} di ${f.pages}`);
        const brk = n > 1;
        let addImage = opts.mode === 'image';
        if (!addImage) {
          const { lines } = await pageLines(f.pdf, n);
          const text = lines.map((l) => l.text).join('');
          if (text.replace(/\s/g, '').length < 15) addImage = true;
          else {
            const { paras, median } = linesToParagraphs(lines);
            paras.forEach((p, pi) => {
              const size = Math.max(7, Math.min(40, p.size * 0.92));
              children.push(new D.Paragraph({
                pageBreakBefore: brk && pi === 0,
                spacing: { after: 120 },
                children: [new D.TextRun({ text: p.text, size: Math.round(size * 2), bold: p.size > median * 1.25, font: 'Calibri' })],
              }));
            });
          }
        }
        if (addImage) {
          const img = await pageImage(f.pdf, n, 150, 'image/jpeg', 0.85);
          const wPx = contentPx;
          const hPx = (wPx * img.h) / img.w;
          children.push(new D.Paragraph({ pageBreakBefore: brk, children: [new D.ImageRun({ type: 'jpg', data: img.bytes, transformation: { width: Math.round(wPx), height: Math.round(Math.min(hPx, ((vp.height - margin * 2) * 96) / 72)) } })] }));
        }
      }
      const doc = new D.Document({
        creator: 'MULTIPEPPINS',
        sections: [{ properties: { page: { size: { width: tw(vp.width), height: tw(vp.height) }, margin: { top: tw(margin), bottom: tw(margin), left: tw(margin), right: tw(margin) } } }, children }],
      });
      const blob = await D.Packer.toBlob(doc);
      return { outputs: [{ name: outName(f, '', 'docx'), data: blob, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }] };
    },
  },
  {
    id: 'pdf-in-powerpoint', cat: 'da', icon: 'ppt', name: 'PDF in PowerPoint',
    desc: 'Trasforma ogni pagina del PDF in una slide di PowerPoint (PPTX).',
    keywords: 'pptx slide presentazione',
    action: 'Converti in PowerPoint', working: 'Creazione della presentazione',
    options: [
      { key: 'notes', type: 'checkbox', label: 'Metti il testo di ogni pagina nelle note della slide', default: true },
      { key: 'dpi', type: 'seg', label: 'Qualità', default: 150, options: [{ value: 110, label: 'Normale' }, { value: 150, label: 'Alta' }, { value: 220, label: 'Massima' }] },
    ],
    async run({ files, opts, progress }) {
      const f = files[0];
      progress(0.02, 'Caricamento del convertitore…');
      const P = await loadScript(LIB_URLS.pptx, 'PptxGenJS');
      const pptx = new P();
      const first = await f.pdf.getPage(1);
      const vp = first.getViewport({ scale: 1, rotation: first.rotate });
      const W = 10, H = +(10 * (vp.height / vp.width)).toFixed(3);
      pptx.defineLayout({ name: 'PDF', width: W, height: H });
      pptx.layout = 'PDF';
      pptx.author = 'MULTIPEPPINS';
      for (let n = 1; n <= f.pages; n++) {
        progress((n - 1) / f.pages, `Pagina ${n} di ${f.pages}`);
        const img = await pageImage(f.pdf, n, opts.dpi, 'image/jpeg', 0.88);
        const slide = pptx.addSlide();
        const s = Math.min(W / img.wPt, H / img.hPt);
        const w = img.wPt * s, h = img.hPt * s;
        slide.addImage({ data: 'data:image/jpeg;base64,' + b64(img.bytes), x: (W - w) / 2, y: (H - h) / 2, w, h });
        if (opts.notes) {
          const { lines } = await pageLines(f.pdf, n);
          const t = lines.map((l) => l.text).join('\n').trim();
          if (t) slide.addNotes(t);
        }
      }
      const data = await pptx.write({ outputType: 'uint8array' });
      return { outputs: [{ name: outName(f, '', 'pptx'), data, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }] };
    },
  },
  {
    id: 'pdf-in-excel', cat: 'da', icon: 'excel', name: 'PDF in Excel',
    desc: 'Estrai tabelle e dati del PDF in un foglio Excel (XLSX).',
    keywords: 'xlsx tabella dati foglio',
    action: 'Converti in Excel', working: 'Estrazione delle tabelle',
    options: [
      { key: 'layout', type: 'radio', default: 'perPage', options: [{ value: 'perPage', label: 'Un foglio per pagina' }, { value: 'single', label: 'Tutto in un foglio' }] },
      { type: 'note', tone: 'info', text: 'Funziona con i PDF che contengono testo vero (non con le scansioni). Le colonne vengono ricostruite in base alla posizione del testo.' },
    ],
    async run({ files, opts, progress }) {
      const f = files[0];
      const sheets = [];
      let all = [];
      for (let n = 1; n <= f.pages; n++) {
        progress((n - 1) / f.pages, `Pagina ${n} di ${f.pages}`);
        const rows = await pageTable(f.pdf, n);
        if (opts.layout === 'single') { if (all.length && rows.length) all.push([]); all = all.concat(rows); }
        else sheets.push({ name: `Pagina ${n}`, rows });
      }
      if (opts.layout === 'single') sheets.push({ name: baseName(f.name).slice(0, 31) || 'Dati', rows: all });
      if (!sheets.some((s) => s.rows.length)) throw new Error('Non ho trovato testo nel PDF: probabilmente è una scansione.');
      const blob = buildXlsx(sheets);
      return { outputs: [{ name: outName(f, '', 'xlsx'), data: blob, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }] };
    },
  },
  {
    id: 'pdf-in-testo', cat: 'da', icon: 'text', name: 'PDF in testo',
    desc: 'Estrai tutto il testo del PDF in un file .txt.',
    keywords: 'txt estrai copia testo',
    multiple: true, action: 'Estrai il testo', working: 'Estrazione del testo',
    options: [{ key: 'sep', type: 'checkbox', label: 'Segna l\'inizio di ogni pagina', default: true }],
    async run({ files, opts, progress }) {
      const outputs = [];
      let empty = 0;
      for (const f of files) {
        let out = '';
        for (let n = 1; n <= f.pages; n++) {
          progress((n - 1) / f.pages, `${f.name}: pagina ${n}`);
          const { lines } = await pageLines(f.pdf, n);
          if (opts.sep) out += `${n > 1 ? '\n' : ''}----- Pagina ${n} -----\n`;
          out += lines.map((l) => l.text).join('\n') + '\n';
        }
        if (!out.replace(/-+ Pagina \d+ -+/g, '').trim()) empty++;
        outputs.push({ name: outName(f, '', 'txt'), data: new TextEncoder().encode(out), mime: 'text/plain' });
      }
      return { outputs, zipName: 'testi.zip', stats: empty ? 'Attenzione: in alcuni file non c\'è testo (probabilmente sono scansioni).' : null };
    },
  },
];

/* ======================================================================
   MODIFICA
   ====================================================================== */
function anchorFor(pos, W, H, w, h, margin) {
  const col = pos[1], row = pos[0];
  const x = col === 'l' ? margin : col === 'r' ? W - margin - w : (W - w) / 2;
  const y = row === 't' ? H - margin - h : row === 'b' ? margin : (H - h) / 2;
  return { x, y };
}
function drawTextVisual(page, text, { font, size, color, opacity, rotateDeg = 0, cx, cy, frame }) {
  // disegna un testo centrato in (cx, cy) nel sistema visivo, ruotato di rotateDeg
  const w = font.widthOfTextAtSize(text, size);
  const h = size * 0.7;
  const a = (rotateDeg * Math.PI) / 180;
  const ox = cx - (Math.cos(a) * w) / 2 + (Math.sin(a) * h) / 2;
  const oy = cy - (Math.sin(a) * w) / 2 - (Math.cos(a) * h) / 2;
  const p = frame.map(ox, oy);
  page.drawText(text, { x: p.x, y: p.y, size, font, color, opacity, rotate: degrees(frame.rot + rotateDeg) });
}
function drawImageVisual(page, img, { x, y, w, h, opacity, rotateDeg = 0, frame }) {
  const cx = x + w / 2, cy = y + h / 2;
  const a = (rotateDeg * Math.PI) / 180;
  const ox = cx - (Math.cos(a) * w) / 2 + (Math.sin(a) * h) / 2;
  const oy = cy - (Math.sin(a) * w) / 2 - (Math.cos(a) * h) / 2;
  const p = frame.map(ox, oy);
  page.drawImage(img, { x: p.x, y: p.y, width: w, height: h, opacity, rotate: degrees(frame.rot + rotateDeg) });
}

const FONT_OPTS = [{ value: 'Helvetica', label: 'Sans' }, { value: 'Times', label: 'Serif' }, { value: 'Courier', label: 'Mono' }];
const FONT_STD = { Helvetica: ['Helvetica', 'HelveticaBold'], Times: ['TimesRoman', 'TimesRomanBold'], Courier: ['Courier', 'CourierBold'] };

function imagePickField(key) {
  return (v, set) => {
    const inp = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    const info = el('div', { class: 'help' }, v[key] ? 'Immagine scelta' : 'Nessuna immagine scelta');
    const prev = el('div');
    inp.addEventListener('change', async () => {
      const f = inp.files[0];
      if (!f) return;
      const img = await prepareImage(f, 1600);
      set(key, img);
      info.textContent = f.name;
      prev.innerHTML = '';
      prev.append(el('img', { src: img.url, style: { maxWidth: '100%', maxHeight: '90px', marginTop: '8px', border: '1px solid var(--line)', borderRadius: '8px' } }));
    });
    return el('div', {}, inp, el('button', { class: 'btn-sec', type: 'button', onclick: () => inp.click() }, icon('image', 16), 'Scegli immagine'), info, prev);
  };
}

const EDIT = [
  {
    id: 'modifica-pdf', cat: 'modifica', icon: 'edit', name: 'Modifica PDF',
    desc: 'Aggiungi testo, immagini, forme, evidenziazioni e disegni al tuo PDF.',
    keywords: 'edit scrivi aggiungi testo annota evidenzia',
    action: 'Salva le modifiche', working: 'Applicazione delle modifiche',
    stage: (ctx) => createEditor(ctx, { mode: 'edit' }),
    sideIntro: 'Scegli uno strumento in alto e tocca la pagina. Il "Bianchetto" copre le parti da nascondere con un rettangolo bianco.',
    async run({ files, stageCtl }) {
      return { outputs: [pdfOut(outName(files[0], 'modificato'), await stageCtl.apply(files[0].bytes))] };
    },
  },
  {
    id: 'firma-pdf', cat: 'modifica', icon: 'sign', name: 'Firma PDF',
    desc: 'Firma il documento: disegna la firma col dito, scrivila o carica una foto.',
    keywords: 'firma sign autografa iniziali',
    action: 'Firma il PDF', working: 'Inserimento della firma',
    stage: (ctx) => createEditor(ctx, { mode: 'sign' }),
    sideIntro: 'Tocca "Firma" in alto per crearla, poi tocca il punto del documento dove inserirla. Puoi spostarla e ridimensionarla.',
    options: [{ key: 'allPages', type: 'checkbox', label: 'Ripeti firme e testi nella stessa posizione su tutte le pagine', default: false }],
    async run({ files, opts, stageCtl }) {
      return { outputs: [pdfOut(outName(files[0], 'firmato'), await stageCtl.apply(files[0].bytes, { allPages: opts.allPages }))] };
    },
  },
  {
    id: 'filigrana', cat: 'modifica', icon: 'watermark', name: 'Filigrana',
    desc: 'Aggiungi un testo (es. "BOZZA", "RISERVATO") o un logo su tutte le pagine.',
    keywords: 'watermark timbro logo bozza riservato',
    multiple: true, action: 'Aggiungi filigrana', working: 'Inserimento filigrana',
    options: [
      { key: 'kind', type: 'seg', label: 'Tipo', default: 'text', options: [{ value: 'text', label: 'Testo' }, { value: 'image', label: 'Immagine' }] },
      { key: 'text', type: 'text', label: 'Testo', default: 'RISERVATO', showIf: (v) => v.kind === 'text' },
      { key: 'font', type: 'seg', label: 'Carattere', default: 'Helvetica', options: FONT_OPTS, showIf: (v) => v.kind === 'text' },
      { key: 'bold', type: 'checkbox', label: 'Grassetto', default: true, showIf: (v) => v.kind === 'text' },
      { key: 'fontSize', type: 'number', label: 'Dimensione', default: 60, min: 6, max: 300, showIf: (v) => v.kind === 'text' },
      { key: 'color', type: 'color', label: 'Colore', default: '#e03131', showIf: (v) => v.kind === 'text' },
      { key: 'image', type: 'custom', label: 'Immagine', render: imagePickField('image'), showIf: (v) => v.kind === 'image' },
      { key: 'imgScale', type: 'range', label: 'Grandezza immagine', default: 40, min: 5, max: 100, format: (v) => v + '% della pagina', showIf: (v) => v.kind === 'image' },
      { key: 'opacity', type: 'range', label: 'Trasparenza', default: 30, min: 5, max: 100, format: (v) => `Opacità ${v}%` },
      { key: 'rotation', type: 'seg', label: 'Inclinazione', default: 45, options: [{ value: 0, label: '0°' }, { value: 45, label: '45°' }, { value: -45, label: '−45°' }, { value: 90, label: '90°' }] },
      { key: 'mosaic', type: 'checkbox', label: 'Ripeti a mosaico su tutta la pagina', default: false },
      { key: 'pos', type: 'position', label: 'Posizione', default: 'mc', showIf: (v) => !v.mosaic },
      ...pagesOption('Pagine'),
    ],
    validate: (o) => (o.kind === 'text' && !String(o.text || '').trim() ? 'Scrivi il testo della filigrana.' : o.kind === 'image' && !o.image ? 'Scegli un\'immagine.' : null),
    async run({ files, opts, progress }) {
      const outputs = [];
      for (let fi = 0; fi < files.length; fi++) {
        progress(fi / files.length, files[fi].name);
        const doc = await loadPdfLib(files[fi].bytes);
        const font = await doc.embedFont(StandardFonts[FONT_STD[opts.font][opts.bold ? 1 : 0]]);
        const img = opts.kind === 'image' ? (opts.image.mime === 'png' ? await doc.embedPng(opts.image.bytes) : await doc.embedJpg(opts.image.bytes)) : null;
        const pages = doc.getPages();
        const text = toWinAnsi(opts.text || '');
        const op = opts.opacity / 100;
        for (const n of pickPages(opts, pages.length)) {
          const page = pages[n - 1];
          const fr = pageFrame(page);
          let w, h, size = +opts.fontSize || 60;
          if (img) { w = (fr.w * opts.imgScale) / 100; h = (w * img.height) / img.width; }
          else {
            w = font.widthOfTextAtSize(text, size);
            // non uscire dalla pagina
            const maxW = (Math.abs(opts.rotation) === 45 ? Math.min(fr.w, fr.h) * 1.25 : opts.rotation === 90 ? fr.h : fr.w) * 0.92;
            if (w > maxW && !opts.mosaic) { size *= maxW / w; w = maxW; }
            h = size * 0.7;
          }
          const centers = [];
          if (opts.mosaic) {
            const stepX = Math.max(w * 0.9, 120) + 60, stepY = Math.max(img ? h : size * 2.2, 80) + 50;
            for (let y = stepY / 2, r = 0; y < fr.h + stepY; y += stepY, r++) for (let x = (r % 2 ? stepX / 2 : 0); x < fr.w + stepX; x += stepX) centers.push([x, y]);
          } else {
            const ext = Math.abs(opts.rotation) === 90 ? { w: h, h: w } : Math.abs(opts.rotation) === 45 ? { w: (w + h) * 0.71, h: (w + h) * 0.71 } : { w, h };
            const a = anchorFor(opts.pos, fr.w, fr.h, ext.w, ext.h, 24);
            centers.push([a.x + ext.w / 2, a.y + ext.h / 2]);
          }
          for (const [cx, cy] of centers) {
            if (img) drawImageVisual(page, img, { x: cx - w / 2, y: cy - h / 2, w, h, opacity: op, rotateDeg: opts.rotation, frame: fr });
            else drawTextVisual(page, text, { font, size, color: hexToRgb(opts.color), opacity: op, rotateDeg: opts.rotation, cx, cy, frame: fr });
          }
        }
        outputs.push(pdfOut(outName(files[fi], 'filigrana'), await savePdf(doc)));
      }
      return { outputs, zipName: 'pdf_filigrana.zip' };
    },
  },
  {
    id: 'numeri-pagina', cat: 'modifica', icon: 'numbers', name: 'Numeri di pagina',
    desc: 'Numera le pagine scegliendo posizione, formato e carattere.',
    keywords: 'numerazione pagina numero piè di pagina intestazione',
    multiple: true, action: 'Aggiungi i numeri', working: 'Numerazione',
    options: [
      { key: 'pos', type: 'position', label: 'Posizione', default: 'bc', only: ['tl', 'tc', 'tr', 'bl', 'bc', 'br'] },
      { key: 'facing', type: 'checkbox', label: 'Pagine affiancate (libro): alterna destra/sinistra', default: false, showIf: (v) => v.pos[1] !== 'c' },
      { key: 'format', type: 'select', label: 'Formato', default: '{n}', options: [
        { value: '{n}', label: '1' }, { value: 'Pagina {n}', label: 'Pagina 1' }, { value: 'Pagina {n} di {t}', label: 'Pagina 1 di 10' }, { value: '{n} / {t}', label: '1 / 10' }, { value: '- {n} -', label: '- 1 -' }, { value: 'custom', label: 'Personalizzato…' },
      ] },
      { key: 'custom', type: 'text', label: 'Testo personalizzato', default: 'Rossi Srl – pag. {n}', help: '{n} = numero della pagina, {t} = totale pagine', showIf: (v) => v.format === 'custom' },
      { key: 'start', type: 'number', label: 'Primo numero', default: 1, min: 0 },
      { key: 'skipFirst', type: 'checkbox', label: 'Non numerare la prima pagina (copertina)', default: false },
      { key: 'margin', type: 'seg', label: 'Margine', default: 'm', options: [{ value: 's', label: 'Piccolo' }, { value: 'm', label: 'Medio' }, { value: 'l', label: 'Grande' }] },
      { key: 'font', type: 'seg', label: 'Carattere', default: 'Helvetica', options: FONT_OPTS },
      { key: 'fontSize', type: 'number', label: 'Dimensione', default: 11, min: 5, max: 72 },
      { key: 'color', type: 'color', label: 'Colore', default: '#333333' },
    ],
    async run({ files, opts, progress }) {
      const outputs = [];
      const margin = { s: 18, m: 30, l: 48 }[opts.margin];
      for (let fi = 0; fi < files.length; fi++) {
        progress(fi / files.length, files[fi].name);
        const doc = await loadPdfLib(files[fi].bytes);
        const font = await doc.embedFont(StandardFonts[FONT_STD[opts.font][0]]);
        const pages = doc.getPages();
        const first = opts.skipFirst ? 2 : 1;
        const total = pages.length - (opts.skipFirst ? 1 : 0) + (+opts.start || 1) - 1;
        const fmt = opts.format === 'custom' ? opts.custom || '{n}' : opts.format;
        for (let i = first; i <= pages.length; i++) {
          const page = pages[i - 1];
          const fr = pageFrame(page);
          const num = i - first + (+opts.start || 1);
          const text = toWinAnsi(fmt.replace(/\{n\}/g, num).replace(/\{t\}/g, total));
          const size = +opts.fontSize || 11;
          const w = font.widthOfTextAtSize(text, size);
          let pos = opts.pos;
          if (opts.facing && pos[1] !== 'c' && i % 2 === 0) pos = pos[0] + (pos[1] === 'l' ? 'r' : 'l');
          const a = anchorFor(pos, fr.w, fr.h, w, size * 0.7, margin);
          drawTextVisual(page, text, { font, size, color: hexToRgb(opts.color), opacity: 1, cx: a.x + w / 2, cy: a.y + size * 0.35, frame: fr });
        }
        outputs.push(pdfOut(outName(files[fi], 'numerato'), await savePdf(doc)));
      }
      return { outputs, zipName: 'pdf_numerati.zip' };
    },
  },
  {
    id: 'ritaglia-pdf', cat: 'modifica', icon: 'crop', name: 'Ritaglia PDF',
    desc: 'Taglia i margini delle pagine, in automatico o della misura che vuoi.',
    keywords: 'crop margini taglia bordi',
    multiple: true, action: 'Ritaglia PDF', working: 'Ritaglio',
    options: [
      { key: 'mode', type: 'radio', default: 'auto', options: [
        { value: 'auto', label: 'Automatico', desc: 'Toglie i margini bianchi attorno al contenuto' },
        { value: 'manual', label: 'Su misura', desc: 'Indichi tu quanti millimetri tagliare' },
      ] },
      { key: 'pad', type: 'number', label: 'Margine da lasciare (mm)', default: 5, min: 0, max: 50, showIf: (v) => v.mode === 'auto' },
      { key: 'm', type: 'margins', label: 'Millimetri da tagliare', default: () => ({ top: 10, bottom: 10, left: 10, right: 10 }), showIf: (v) => v.mode === 'manual' },
      ...pagesOption('Pagine'),
    ],
    async run({ files, opts, progress }) {
      const outputs = [];
      for (let fi = 0; fi < files.length; fi++) {
        const f = files[fi];
        const doc = await loadPdfLib(f.bytes);
        const pages = doc.getPages();
        const list = pickPages(opts, pages.length);
        for (let k = 0; k < list.length; k++) {
          const n = list[k];
          progress((fi + k / list.length) / files.length, `${f.name}: pagina ${n}`);
          const page = pages[n - 1];
          const box = page.getCropBox();
          let x0 = box.x, y0 = box.y, x1 = box.x + box.width, y1 = box.y + box.height;
          if (opts.mode === 'manual') {
            // margini visivi → lati del riquadro PDF secondo la rotazione
            const m = opts.m, rot = pageFrame(page).rot;
            const side = { 0: { top: 't', bottom: 'b', left: 'l', right: 'r' }, 90: { top: 'l', bottom: 'r', left: 'b', right: 't' }, 180: { top: 'b', bottom: 't', left: 'r', right: 'l' }, 270: { top: 'r', bottom: 'l', left: 't', right: 'b' } }[rot];
            const cut = { t: 0, b: 0, l: 0, r: 0 };
            for (const k2 of ['top', 'bottom', 'left', 'right']) cut[side[k2]] = (m[k2] || 0) * MM;
            x0 += cut.l; x1 -= cut.r; y0 += cut.b; y1 -= cut.t;
          } else {
            const pg = await f.pdf.getPage(n);
            const vp = pg.getViewport({ scale: 1 });
            const sc = Math.min(1.5, 1400 / Math.max(vp.width, vp.height));
            const { canvas, viewport } = await renderPage(f.pdf, n, sc, { readback: true });
            const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
            for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
              const o = (y * canvas.width + x) * 4;
              if (d[o] < 240 || d[o + 1] < 240 || d[o + 2] < 240) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
            }
            if (maxX < 0) continue; // pagina vuota
            const pad = (+opts.pad || 0) * MM * sc;
            const [ax, ay] = viewport.convertToPdfPoint(Math.max(0, minX - pad), Math.max(0, minY - pad));
            const [bx, by] = viewport.convertToPdfPoint(Math.min(canvas.width, maxX + 1 + pad), Math.min(canvas.height, maxY + 1 + pad));
            x0 = Math.max(x0, Math.min(ax, bx)); x1 = Math.min(x1, Math.max(ax, bx));
            y0 = Math.max(y0, Math.min(ay, by)); y1 = Math.min(y1, Math.max(ay, by));
          }
          if (x1 - x0 < 20 || y1 - y0 < 20) throw new Error(`Il ritaglio della pagina ${n} è troppo grande: la pagina sparirebbe.`);
          page.setMediaBox(x0, y0, x1 - x0, y1 - y0);
          page.setCropBox(x0, y0, x1 - x0, y1 - y0);
        }
        outputs.push(pdfOut(outName(f, 'ritagliato'), await savePdf(doc)));
      }
      return { outputs, zipName: 'pdf_ritagliati.zip' };
    },
  },
  {
    id: 'ridimensiona-pdf', cat: 'modifica', icon: 'resize', name: 'Ridimensiona pagine',
    desc: 'Porta tutte le pagine allo stesso formato (A4, A3, Lettera…).',
    keywords: 'formato a4 a3 scala dimensione pagina',
    multiple: true, action: 'Ridimensiona', working: 'Ridimensionamento',
    options: [
      { key: 'size', type: 'select', label: 'Nuovo formato', default: 'A4', options: SIZE_OPTS },
      { key: 'orient', type: 'seg', label: 'Orientamento', default: 'auto', options: [{ value: 'auto', label: 'Come l\'originale' }, { value: 'portrait', label: 'Verticale' }, { value: 'landscape', label: 'Orizzontale' }] },
      { key: 'margin', type: 'number', label: 'Margine (mm)', default: 0, min: 0, max: 40 },
    ],
    async run({ files, opts, progress }) {
      const outputs = [];
      for (let fi = 0; fi < files.length; fi++) {
        progress(fi / files.length, files[fi].name);
        const src = await loadPdfLib(files[fi].bytes);
        const out = await PDFDocument.create();
        const srcPages = src.getPages();
        const emb = await out.embedPages(srcPages);
        srcPages.forEach((sp, i) => {
          const fr = pageFrame(sp);
          let [W, H] = PAGE_SIZES[opts.size];
          const land = opts.orient === 'landscape' || (opts.orient === 'auto' && fr.w > fr.h);
          if (land) [W, H] = [H, W];
          const m = (+opts.margin || 0) * MM;
          const page = out.addPage([W, H]);
          drawPageFit(page, emb[i], fr.rot, { x: m, y: m, w: W - 2 * m, h: H - 2 * m });
        });
        outputs.push(pdfOut(outName(files[fi], opts.size), await savePdf(out)));
      }
      return { outputs, zipName: 'pdf_ridimensionati.zip' };
    },
  },
  {
    id: 'pagine-per-foglio', cat: 'modifica', icon: 'nup', name: 'Più pagine per foglio',
    desc: 'Metti 2, 4, 6, 9 o 16 pagine su ogni foglio per stampare risparmiando carta.',
    keywords: 'n-up stampa risparmio carta 2 4 pagine foglio',
    action: 'Crea il PDF', working: 'Impaginazione',
    options: [
      { key: 'n', type: 'seg', label: 'Pagine per foglio', default: 2, options: [{ value: 2, label: '2' }, { value: 4, label: '4' }, { value: 6, label: '6' }, { value: 9, label: '9' }, { value: 16, label: '16' }] },
      { key: 'size', type: 'select', label: 'Formato del foglio', default: 'A4', options: SIZE_OPTS },
      { key: 'order', type: 'seg', label: 'Ordine', default: 'h', options: [{ value: 'h', label: 'Per righe' }, { value: 'v', label: 'Per colonne' }] },
      { key: 'border', type: 'checkbox', label: 'Bordo attorno a ogni pagina', default: true },
      { key: 'margin', type: 'number', label: 'Margine (mm)', default: 8, min: 0, max: 30 },
    ],
    async run({ files, opts, progress }) {
      const f = files[0];
      const src = await loadPdfLib(f.bytes);
      const out = await PDFDocument.create();
      const srcPages = src.getPages();
      const emb = await out.embedPages(srcPages);
      const grid = { 2: [2, 1], 4: [2, 2], 6: [3, 2], 9: [3, 3], 16: [4, 4] }[opts.n];
      const first = pageFrame(srcPages[0]);
      const portraitSrc = first.h >= first.w;
      // orientamento del foglio che sfrutta meglio lo spazio
      let [W, H] = PAGE_SIZES[opts.size];
      let [cols, rows] = grid;
      const landscapeSheet = (opts.n === 2 || opts.n === 6) ? portraitSrc : !portraitSrc;
      if (landscapeSheet) [W, H] = [H, W];
      if (!portraitSrc && (opts.n === 2 || opts.n === 6)) [cols, rows] = [rows, cols];
      const m = (+opts.margin || 0) * MM;
      const gap = 6;
      const cw = (W - 2 * m - gap * (cols - 1)) / cols, ch = (H - 2 * m - gap * (rows - 1)) / rows;
      let page;
      for (let i = 0; i < srcPages.length; i++) {
        progress(i / srcPages.length);
        const k = i % opts.n;
        if (k === 0) page = out.addPage([W, H]);
        const c = opts.order === 'h' ? k % cols : Math.floor(k / rows);
        const r = opts.order === 'h' ? Math.floor(k / cols) : k % rows;
        const box = { x: m + c * (cw + gap), y: H - m - (r + 1) * ch - r * gap, w: cw, h: ch };
        const drawn = drawPageFit(page, emb[i], pageFrame(srcPages[i]).rot, box);
        if (opts.border) page.drawRectangle({ x: drawn.x, y: drawn.y, width: drawn.w, height: drawn.h, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.6 });
      }
      return { outputs: [pdfOut(outName(f, `${opts.n}_per_foglio`), await savePdf(out))], stats: `${srcPages.length} pagine su ${out.getPageCount()} ${out.getPageCount() === 1 ? 'foglio' : 'fogli'}` };
    },
  },
  {
    id: 'compila-modulo', cat: 'modifica', icon: 'form', name: 'Compila moduli PDF',
    desc: 'Compila i campi dei moduli PDF (caselle di testo, spunte, menu) e salvali.',
    keywords: 'form modulo campi compila acroform',
    action: 'Salva il modulo', working: 'Salvataggio del modulo',
    stage: (ctx) => {
      const f = ctx.files[0];
      const box = el('div', { style: { maxWidth: '720px', margin: '0 auto' } }, el('p', { style: { color: 'var(--ink-3)' } }, 'Lettura dei campi…'));
      ctx.stage.append(box);
      const values = new Map();
      const ctl = { values, count: 0 };
      (async () => {
        try {
          const doc = await loadPdfLib(f.bytes);
          const fields = doc.getForm().getFields();
          box.innerHTML = '';
          ctl.count = fields.length;
          if (!fields.length) {
            box.append(el('div', { class: 'note' }, 'Questo PDF non contiene campi compilabili. Per scriverci sopra usa "Modifica PDF".'));
            return;
          }
          box.append(el('div', { class: 'note info', style: { marginTop: 0 } }, `Trovati ${fields.length} campi. Compilali qui sotto e premi "Salva il modulo".`));
          for (const fld of fields) {
            const name = fld.getName();
            const label = name.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
            let input;
            try {
              if (fld instanceof PDFTextField) {
                const multi = fld.isMultiline();
                input = el(multi ? 'textarea' : 'input', { class: 'inp', style: multi ? { minHeight: '80px', fontFamily: 'inherit' } : null });
                input.value = fld.getText() || '';
                input.addEventListener('input', () => values.set(name, input.value));
              } else if (fld instanceof PDFCheckBox) {
                const cb = el('input', { type: 'checkbox', checked: fld.isChecked() });
                cb.addEventListener('change', () => values.set(name, cb.checked));
                input = el('label', { class: 'check' }, cb, 'Selezionato');
              } else if (fld instanceof PDFDropdown || fld instanceof PDFOptionList) {
                const cur = fld.getSelected()[0];
                input = el('select', { class: 'sel' }, el('option', { value: '' }, '—'), fld.getOptions().map((o) => el('option', { value: o, selected: o === cur }, o)));
                input.addEventListener('change', () => values.set(name, input.value));
              } else if (fld instanceof PDFRadioGroup) {
                const cur = fld.getSelected();
                input = el('select', { class: 'sel' }, el('option', { value: '' }, '—'), fld.getOptions().map((o) => el('option', { value: o, selected: o === cur }, o)));
                input.addEventListener('change', () => values.set(name, input.value));
              } else continue;
            } catch { continue; }
            if (fld.isReadOnly && fld.isReadOnly()) input.setAttribute('disabled', '');
            box.append(el('div', { class: 'field', style: { background: '#fff', padding: '12px', borderRadius: '12px', border: '1px solid var(--line)' } }, el('span', { class: 'lbl' }, label), input));
          }
        } catch (e) {
          box.innerHTML = '';
          box.append(el('div', { class: 'note err' }, 'Impossibile leggere il modulo: ' + e.message));
        }
      })();
      return ctl;
    },
    options: [{ key: 'flatten', type: 'checkbox', label: 'Rendi definitivo (i campi non saranno più modificabili)', default: false }],
    validate: (o, f, s) => (!s.count ? 'Questo PDF non ha campi da compilare.' : null),
    async run({ files, opts, stageCtl }) {
      const doc = await loadPdfLib(files[0].bytes);
      const form = doc.getForm();
      for (const [name, v] of stageCtl.values) {
        const fld = form.getFieldMaybe(name);
        if (!fld) continue;
        try {
          if (fld instanceof PDFTextField) fld.setText(v);
          else if (fld instanceof PDFCheckBox) (v ? fld.check() : fld.uncheck());
          else if (fld instanceof PDFDropdown || fld instanceof PDFOptionList) (v ? fld.select(v) : fld.clear());
          else if (fld instanceof PDFRadioGroup) (v ? fld.select(v) : fld.clear());
        } catch {}
      }
      let bytes;
      try {
        if (opts.flatten) form.flatten();
        bytes = await doc.save({ useObjectStreams: true });
      } catch {
        // caratteri speciali non supportati dai font del modulo: lasciamo che sia il lettore a disegnarli
        form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
        bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
      }
      return { outputs: [pdfOut(outName(files[0], 'compilato'), bytes)] };
    },
  },
  {
    id: 'metadati-pdf', cat: 'modifica', icon: 'info', name: 'Proprietà del PDF',
    desc: 'Cambia o cancella titolo, autore, oggetto e parole chiave del documento.',
    keywords: 'metadati titolo autore proprietà privacy',
    action: 'Salva le proprietà', working: 'Salvataggio',
    stage: (ctx) => {
      const f = ctx.files[0];
      const vals = {};
      const box = el('div', { style: { maxWidth: '640px', margin: '0 auto' } });
      ctx.stage.append(box);
      (async () => {
        const doc = await loadPdfLib(f.bytes);
        const fields = [['title', 'Titolo', doc.getTitle()], ['author', 'Autore', doc.getAuthor()], ['subject', 'Oggetto', doc.getSubject()], ['keywords', 'Parole chiave', doc.getKeywords()], ['creator', 'Applicazione', doc.getCreator()], ['producer', 'Prodotto con', doc.getProducer()]];
        box.append(el('div', { class: 'note info', style: { marginTop: 0 } }, 'Modifica le proprietà nascoste del documento. Lascia vuoto un campo per cancellarlo.'));
        for (const [k, lab, v] of fields) {
          const inp = el('input', { class: 'inp', value: v || '' });
          vals[k] = v || '';
          inp.addEventListener('input', () => (vals[k] = inp.value));
          box.append(el('div', { class: 'field', style: { background: '#fff', padding: '12px', borderRadius: '12px', border: '1px solid var(--line)' } }, el('span', { class: 'lbl' }, lab), inp));
        }
        const cd = doc.getCreationDate(), md = doc.getModificationDate();
        box.append(el('div', { class: 'help' }, `Creato: ${cd ? cd.toLocaleString('it-IT') : '—'} · Modificato: ${md ? md.toLocaleString('it-IT') : '—'}`));
      })();
      return { vals };
    },
    options: [{ key: 'wipe', type: 'checkbox', label: 'Cancella tutte le proprietà (privacy)', default: false }],
    async run({ files, opts, stageCtl }) {
      const doc = await PDFDocument.load(files[0].bytes, { updateMetadata: false, throwOnInvalidObject: false });
      const v = opts.wipe ? {} : stageCtl.vals;
      const info = doc.getInfoDict();
      for (const [k, key] of [['title', 'Title'], ['author', 'Author'], ['subject', 'Subject'], ['keywords', 'Keywords'], ['creator', 'Creator'], ['producer', 'Producer']]) {
        const val = (v[k] || '').trim();
        if (val) {
          if (k === 'keywords') doc.setKeywords(val.split(/\s*[,;]\s*/));
          else doc['set' + k[0].toUpperCase() + k.slice(1)](val);
        } else info.delete(PDFName.of(key));
      }
      if (opts.wipe) {
        info.delete(PDFName.of('CreationDate'));
        info.delete(PDFName.of('ModDate'));
        doc.catalog.delete(PDFName.of('Metadata'));
      } else doc.setModificationDate(new Date());
      return { outputs: [pdfOut(outName(files[0], ''), await doc.save({ useObjectStreams: true }))] };
    },
  },
];

/* ======================================================================
   ALTRO: CONFRONTA
   ====================================================================== */
function diffWords(a, b) {
  // LCS sulle parole; per testi molto lunghi si confrontano le righe
  const n = a.length, m = b.length;
  if (n * m > 6e6) return null;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push(['=', a[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['-', a[i]]); i++; }
    else { ops.push(['+', b[j]]); j++; }
  }
  while (i < n) ops.push(['-', a[i++]]);
  while (j < m) ops.push(['+', b[j++]]);
  return ops;
}
async function docText(pdf) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) { const { lines } = await pageLines(pdf, n); pages.push(lines.map((l) => l.text).join('\n')); }
  return pages;
}

const OTHER = [
  {
    id: 'ocr-pdf', cat: 'ottimizza', icon: 'scan', name: 'OCR PDF', isNew: true,
    desc: 'Riconosce il testo di PDF scansionati e foto: diventa ricercabile e copiabile.',
    keywords: 'ocr riconoscimento testo scansione ricercabile copia estrai',
    accept: 'application/pdf,.pdf,image/*,.jpg,.jpeg,.png,.webp', multiple: true, orderMatters: true,
    pickLabel: 'Seleziona PDF o immagini', action: 'Avvia OCR', working: 'Riconoscimento del testo',
    sideIntro: 'Funziona con PDF scansionati e foto di documenti. La prima volta il motore impiega qualche secondo ad avviarsi.',
    options: [
      { key: 'lang', type: 'select', label: 'Lingua del documento', default: 'ita', options: OCR_LANGS },
      { key: 'output', type: 'radio', label: 'Cosa vuoi ottenere?', default: 'pdf', options: [
        { value: 'pdf', label: 'PDF ricercabile', desc: 'Aspetto identico, ma puoi cercare e copiare il testo' },
        { value: 'txt', label: 'Solo il testo (.txt)', desc: 'Il testo riconosciuto in un file di testo' },
        { value: 'both', label: 'Entrambi', desc: 'PDF ricercabile + file di testo' },
      ] },
      { key: 'skipText', type: 'checkbox', label: 'Salta le pagine che hanno già del testo', default: true },
    ],
    validate: (o, files) => (files.some((f) => f.isPdf) && files.some((f) => !f.isPdf) ? 'Usa solo PDF oppure solo immagini, non insieme.' : null),
    run: (ctx) => runOcr(ctx),
  },
  {
    id: 'confronta-pdf', cat: 'altro', icon: 'compare', name: 'Confronta PDF', isNew: true,
    desc: 'Trova le differenze tra due versioni di un documento, nel testo o nell\'aspetto.',
    keywords: 'differenze compare versioni contratto',
    multiple: true, maxFiles: 2, minFiles: 2, orderMatters: true, minFilesMsg: 'Aggiungi i 2 PDF da confrontare.',
    action: 'Confronta', working: 'Confronto in corso',
    sideIntro: 'Il primo file è la versione originale, il secondo quella nuova.',
    options: [{ key: 'mode', type: 'radio', default: 'text', options: [
      { value: 'text', label: 'Confronto del testo', desc: 'Parole aggiunte (verde) e tolte (rosso)' },
      { value: 'visual', label: 'Confronto visivo', desc: 'Evidenzia in rosso le zone delle pagine che cambiano' },
    ] }],
    async run({ files, opts, progress }) {
      const [A, B] = files;
      const view = el('div', { style: { textAlign: 'left', marginTop: '10px' } });
      if (opts.mode === 'text') {
        progress(0.1, 'Lettura del primo documento…');
        const ta = await docText(A.pdf);
        progress(0.4, 'Lettura del secondo documento…');
        const tb = await docText(B.pdf);
        const left = el('div', { class: 'cmp-col' }, el('h4', {}, A.name));
        const right = el('div', { class: 'cmp-col' }, el('h4', {}, B.name));
        let added = 0, removed = 0;
        const np = Math.max(ta.length, tb.length);
        for (let p = 0; p < np; p++) {
          progress(0.5 + (0.5 * p) / np, `Pagina ${p + 1}`);
          const wa = (ta[p] || '').split(/(\s+)/).filter(Boolean);
          const wb = (tb[p] || '').split(/(\s+)/).filter(Boolean);
          let ops = diffWords(wa, wb);
          if (!ops) ops = diffWords((ta[p] || '').split('\n'), (tb[p] || '').split('\n')) || [['-', ta[p] || ''], ['+', tb[p] || '']];
          left.append(el('span', { class: 'cmp-pg' }, `Pagina ${p + 1}`));
          right.append(el('span', { class: 'cmp-pg' }, `Pagina ${p + 1}`));
          for (const [op, w] of ops) {
            if (op === '=') { left.append(w); right.append(w); }
            else if (op === '-') { left.append(el('del', {}, w)); if (w.trim()) removed++; }
            else { right.append(el('ins', {}, w)); if (w.trim()) added++; }
          }
        }
        view.append(el('div', { class: 'cmp' }, left, right));
        return { title: added || removed ? 'Ecco le differenze' : 'I testi sono identici', stats: `${removed} parole tolte · ${added} parole aggiunte`, view, outputs: [] };
      }
      const np = Math.min(A.pages, B.pages, 40);
      const wrap = el('div', { class: 'vis-cmp' });
      let diffPages = 0;
      for (let p = 1; p <= np; p++) {
        progress(p / np, `Pagina ${p}`);
        const pa = await A.pdf.getPage(p);
        const s = 900 / pa.getViewport({ scale: 1 }).width;
        const ra = (await renderPage(A.pdf, p, s, { readback: true })).canvas;
        const rb = (await renderPage(B.pdf, p, s, { readback: true })).canvas;
        const w = Math.min(ra.width, rb.width), h = Math.min(ra.height, rb.height);
        const da = ra.getContext('2d').getImageData(0, 0, w, h).data;
        const gb = rb.getContext('2d');
        const db = gb.getImageData(0, 0, w, h);
        let changed = 0;
        for (let i = 0; i < db.data.length; i += 4) {
          const d = Math.abs(da[i] - db.data[i]) + Math.abs(da[i + 1] - db.data[i + 1]) + Math.abs(da[i + 2] - db.data[i + 2]);
          const y = 0.299 * db.data[i] + 0.587 * db.data[i + 1] + 0.114 * db.data[i + 2];
          if (d > 60) { db.data[i] = 235; db.data[i + 1] = 40; db.data[i + 2] = 60; changed++; }
          else { const v = 255 - (255 - y) * 0.35; db.data[i] = db.data[i + 1] = db.data[i + 2] = v; }
        }
        gb.putImageData(db, 0, 0);
        if (changed > 30) diffPages++;
        wrap.append(el('div', { style: { fontWeight: 700, color: changed > 30 ? 'var(--err)' : 'var(--ok)' } }, `Pagina ${p}: ${changed > 30 ? 'ci sono differenze' : 'identica'}`), rb);
      }
      view.append(wrap);
      const extra = A.pages !== B.pages ? ` I documenti hanno un numero di pagine diverso (${A.pages} e ${B.pages}).` : '';
      return { title: diffPages ? `Differenze in ${diffPages} ${diffPages === 1 ? 'pagina' : 'pagine'}` : 'Nessuna differenza visibile', stats: 'In rosso le zone cambiate nella seconda versione.' + extra + (Math.min(A.pages, B.pages) > 40 ? ' Mostrate le prime 40 pagine.' : ''), view, outputs: [] };
    },
  },
];

export const CONVERT_TOOLS = [...CONVERT_IN, ...CONVERT_FROM];
export const EDIT_TOOLS = EDIT;
export const OTHER_TOOLS = OTHER;
