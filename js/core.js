// MULTIPEPPINS — funzioni di base condivise da tutti gli strumenti
const loaded = {};
const VENDOR = new URL('../vendor/', import.meta.url).href;
const PDFJS_VER = '6.2.108';
const CDN = {
  pdfjs: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/pdf.min.mjs`,
  pdfjsWorker: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/pdf.worker.min.mjs`,
  pdfLib: ['https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js', 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'],
  docx: ['https://cdn.jsdelivr.net/npm/docx@9.8.1/dist/index.iife.js', 'https://unpkg.com/docx@9.8.1/dist/index.iife.js'],
  pptx: ['https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js', 'https://unpkg.com/pptxgenjs@4.0.1/dist/pptxgen.bundle.js'],
};
export const LIB_URLS = { docx: [VENDOR + 'docx.iife.js', ...CDN.docx], pptx: [VENDOR + 'pptxgen.bundle.js', ...CDN.pptx] };

// Le librerie si caricano dalla cartella vendor; se manca (es. pagina pubblicata) si usano le CDN
let LOCAL_PDFJS = true;
let pdfjsLib;
try {
  pdfjsLib = await import('../vendor/pdf.min.mjs');
} catch {
  LOCAL_PDFJS = false;
  pdfjsLib = await import(CDN.pdfjs);
}
if (LOCAL_PDFJS) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.mjs';
} else {
  try {
    const blobUrl = URL.createObjectURL(new Blob([`import "${CDN.pdfjsWorker}";`], { type: 'text/javascript' }));
    pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(blobUrl, { type: 'module' });
  } catch {
    pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfjsWorker;
  }
}
await loadScript([VENDOR + 'pdf-lib.min.js', ...CDN.pdfLib], 'PDFLib');

export const PDFLib = window.PDFLib;
export { pdfjsLib };

/* ---------------- File e byte ---------------- */
export async function readBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}
export function baseName(name) {
  return (name || 'documento').replace(/\.[^.]+$/, '');
}
export function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1).replace('.', ',') + ' KB';
  return (n / 1048576).toFixed(2).replace('.', ',') + ' MB';
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const tick = () => new Promise((r) => setTimeout(r, 0));

/* ---------------- pdf.js ---------------- */
export async function openPdfJs(bytes, password) {
  const task = pdfjsLib.getDocument({
    data: bytes.slice(),
    password: password || undefined,
    ...(LOCAL_PDFJS ? {
      cMapUrl: VENDOR + 'pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: VENDOR + 'pdfjs/standard_fonts/',
      wasmUrl: VENDOR + 'pdfjs/wasm/',
      iccUrl: VENDOR + 'pdfjs/iccs/',
    } : { useSystemFonts: true }),
    isEvalSupported: false,
    enableXfa: false,
  });
  return task.promise;
}

// Disegna una pagina su canvas. scale = pixel per punto PDF (1 = 72 dpi)
export async function renderPage(pdf, pageNum, scale, opts = {}) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale, rotation: (page.rotate + (opts.extraRotation || 0)) % 360 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d', { willReadFrequently: !!opts.readback });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport, annotationMode: opts.annotationMode ?? pdfjsLib.AnnotationMode.ENABLE }).promise;
  return { canvas, viewport, page };
}

export function canvasToBytes(canvas, type = 'image/jpeg', quality = 0.85) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (b) => {
      if (!b) return reject(new Error('Impossibile creare l\'immagine'));
      resolve(new Uint8Array(await b.arrayBuffer()));
    }, type, quality);
  });
}

// Limita la dimensione del canvas per non esaurire la memoria del telefono
export function safeScale(viewportW, viewportH, wanted, maxPixels = 16e6) {
  const px = viewportW * viewportH * wanted * wanted;
  if (px <= maxPixels) return wanted;
  return Math.sqrt(maxPixels / (viewportW * viewportH));
}

/* ---------------- pdf-lib ---------------- */
export async function loadPdfLib(bytes, opts = {}) {
  try {
    return await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: !!opts.ignoreEncryption, updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    if (/encrypt/i.test(e.message || '')) {
      const err = new Error('Questo PDF è protetto da password. Usa prima "Sblocca PDF".');
      err.code = 'encrypted';
      throw err;
    }
    throw new Error('Il file non sembra un PDF valido (' + (e.message || e) + '). Prova "Ripara PDF".');
  }
}

export async function savePdf(doc, opts = {}) {
  return doc.save({ useObjectStreams: opts.objectStreams !== false, addDefaultPage: false, updateFieldAppearances: opts.updateFieldAppearances ?? true });
}

// Costruisce un PDF fatto di immagini (una per pagina)
export async function imagesToPdf(pages) {
  // pages: [{bytes, type:'jpg'|'png', widthPt, heightPt}]
  const out = await PDFLib.PDFDocument.create();
  for (const p of pages) {
    const img = p.type === 'png' ? await out.embedPng(p.bytes) : await out.embedJpg(p.bytes);
    const page = out.addPage([p.widthPt, p.heightPt]);
    page.drawImage(img, { x: 0, y: 0, width: p.widthPt, height: p.heightPt });
  }
  return out;
}

/* ---------------- Intervalli di pagine ---------------- */
// "1-3, 5, 8-" → [1,2,3,5,8,...,total]
export function parseRanges(text, total, { allowEmpty = false } = {}) {
  const res = [];
  const s = String(text || '').replace(/\s+/g, '');
  if (!s) {
    if (allowEmpty) return [];
    throw new Error('Indica le pagine, ad esempio: 1-3, 5');
  }
  for (const part of s.split(/[,;]/)) {
    if (!part) continue;
    const m = part.match(/^(\d*)-(\d*)$/);
    let a, b;
    if (m) {
      a = m[1] ? +m[1] : 1;
      b = m[2] ? +m[2] : total;
    } else if (/^\d+$/.test(part)) {
      a = b = +part;
    } else {
      throw new Error('Intervallo non valido: "' + part + '". Usa un formato come 1-3, 5, 8-10');
    }
    if (a < 1 || b < 1 || a > total || b > total) throw new Error('La pagina ' + Math.max(a, b) + ' non esiste: il documento ha ' + total + ' pagine.');
    if (a <= b) for (let i = a; i <= b; i++) res.push(i);
    else for (let i = a; i >= b; i--) res.push(i);
  }
  return res;
}
export function parseRangeGroups(text, total) {
  return String(text || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean).map((g) => ({ label: g, pages: parseRanges(g, total) }));
}

/* ---------------- Testo e font standard ---------------- */
// I font standard dei PDF supportano solo WinAnsi: sostituiamo i caratteri non coperti
const WIN_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function toWinAnsi(str) {
  return String(str)
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, (c) => c)
    .replace(/ /g, ' ')
    .replace(/\t/g, '    ')
    .split('')
    .map((c) => {
      const code = c.charCodeAt(0);
      if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_EXTRA.includes(c) || c === '\n') return c;
      const n = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (n && n.charCodeAt(0) < 256 && n !== c) return n;
      return '?';
    })
    .join('');
}

export function hexToRgb(hex) {
  const m = String(hex).replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return PDFLib.rgb(0, 0, 0);
  return PDFLib.rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

/* ---------------- ZIP (senza compressione, sufficiente per PDF/immagini) ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function makeZip(files) {
  // files: [{name, bytes}]
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const used = new Set();
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    let name = f.name;
    let i = 2;
    while (used.has(name)) name = f.name.replace(/(\.[^.]+)?$/, ` (${i++})$1`);
    used.add(name);
    const nameBytes = enc.encode(name);
    const data = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8
    lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), nameBytes, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

/* ---------------- Download ---------------- */
let downloadsNs; // undefined = non ancora cercato
async function getDownloads() {
  if (downloadsNs !== undefined) return downloadsNs;
  if (!window.claude || typeof window.claude.use !== 'function') return (downloadsNs = null);
  try {
    downloadsNs = await Promise.race([window.claude.use('downloads'), sleep(10000).then(() => null)]);
  } catch {
    downloadsNs = null;
  }
  return downloadsNs;
}
// Avvia subito la ricerca, così al primo clic è già pronta
setTimeout(getDownloads, 0);

export async function saveFile(name, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
  const dl = await getDownloads();
  if (dl) {
    try {
      await dl.save({ filename: name, data: blob });
      return 'saved';
    } catch (e) {
      if (e && e.code === 'declined') return 'declined';
      if (e && e.code === 'rate_limited') throw new Error('C\'è già una richiesta di download aperta: confermala o chiudila e riprova.');
      if (e && !['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(e.code)) throw new Error('Download non riuscito: ' + (e.message || e.code));
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'saved';
}

/* ---------------- Librerie esterne caricate solo quando servono ---------------- */
export function loadScript(urls, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (loaded[globalName]) return loaded[globalName];
  const list = Array.isArray(urls) ? urls : [urls];
  loaded[globalName] = (async () => {
    let lastErr;
    for (const src of list) {
      try {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = src;
          s.async = true;
          s.onload = res;
          s.onerror = () => rej(new Error('impossibile caricare ' + src));
          document.head.appendChild(s);
        });
        if (window[globalName]) return window[globalName];
      } catch (e) {
        lastErr = e;
      }
    }
    delete loaded[globalName];
    throw new Error('Componente aggiuntivo non disponibile (serve la connessione a internet). ' + (lastErr ? lastErr.message : ''));
  })();
  return loaded[globalName];
}
export const VENDOR_URL = VENDOR;
