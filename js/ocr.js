// MULTIPEPPINS — OCR: rende ricercabili e copiabili i PDF scansionati e le foto di documenti
import { PDFLib, renderPage, canvasToBytes, toWinAnsi, savePdf, loadPdfLib } from './core.js';
import { pdfOut, outName, pageFrame, decodeToCanvas } from './helpers.js';
import { baseName } from './core.js';

const { PDFDocument, StandardFonts, degrees, pushGraphicsState, popGraphicsState, setTextRenderingMode, setCharacterSqueeze, TextRenderingMode } = PDFLib;

const VENDOR = new URL('../vendor/', import.meta.url).href;
const CORE_VER = '7.0.0';
const DATA_CDN = (l) => `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`;

export const OCR_LANGS = [
  { value: 'ita', label: 'Italiano' },
  { value: 'ita+eng', label: 'Italiano + Inglese' },
  { value: 'eng', label: 'Inglese' },
  { value: 'fra', label: 'Francese' },
  { value: 'deu', label: 'Tedesco' },
  { value: 'spa', label: 'Spagnolo' },
];

function simdSupported() {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch { return false; }
}

const langCache = {};
async function fetchLang(l) {
  if (langCache[l]) return langCache[l];
  let data = null;
  try {
    const r = await fetch(VENDOR + `tessdata/${l}.traineddata`);
    if (r.ok) data = await r.arrayBuffer();
  } catch {}
  if (!data) {
    try {
      const r = await fetch(DATA_CDN(l));
      if (!r.ok) throw new Error();
      const stream = r.body.pipeThrough(new DecompressionStream('gzip'));
      data = await new Response(stream).arrayBuffer();
    } catch {
      throw new Error('Non riesco a scaricare i dati della lingua per l\'OCR. Serve una connessione a internet, e in questa anteprima l\'OCR non è disponibile: usa la versione online dell\'app.');
    }
  }
  langCache[l] = data;
  return data;
}

// Avvia il motore OCR in un worker
export async function createOcr(langStr, progress) {
  const langs = {};
  const list = langStr.split('+');
  for (let i = 0; i < list.length; i++) {
    progress && progress(`Scaricamento lingua (${list[i]})…`);
    langs[list[i]] = (await fetchLang(list[i])).slice(0);
  }
  progress && progress('Avvio del motore OCR…');
  const file = simdSupported() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js';
  const coreUrls = [VENDOR + 'tesseract/' + file, `https://cdn.jsdelivr.net/npm/tesseract.js-core@${CORE_VER}/${file}`];
  const worker = new Worker(new URL('./ocr-worker.js', import.meta.url));
  let seq = 0;
  const pending = new Map();
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error('Errore del motore OCR: ' + (e.message || ''))); pending.clear(); };
  const call = (msg, transfer) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer || []);
  });
  await call({ type: 'init', coreUrls, langs, langStr }, Object.values(langs));
  return {
    recognize: (pngBytes) => call({ type: 'recognize', image: pngBytes.buffer }, [pngBytes.buffer]),
    end: () => { try { worker.postMessage({ type: 'end' }); } catch {} setTimeout(() => worker.terminate(), 500); },
  };
}

function parseTsv(tsv) {
  const words = [];
  for (const line of String(tsv || '').split('\n')) {
    const c = line.split('\t');
    if (c.length < 12 || c[0] !== '5') continue;
    const text = c.slice(11).join('\t').trim();
    const conf = +c[10];
    if (!text || conf < 0) continue;
    words.push({ line: `${c[2]}-${c[3]}-${c[4]}`, x: +c[6], y: +c[7], w: +c[8], h: +c[9], text, conf });
  }
  return words;
}

// Scrive il testo riconosciuto come livello invisibile sopra la pagina
function addTextLayer(page, font, words, pxToPt, frame) {
  if (!words.length) return;
  // altezza di riga comune per parole sulla stessa riga (più uniforme)
  const lineH = {};
  for (const w of words) lineH[w.line] = Math.max(lineH[w.line] || 0, w.h);
  page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
  for (const w of words) {
    const text = toWinAnsi(w.text);
    if (!text.trim()) continue;
    const hPt = lineH[w.line] * pxToPt;
    const size = Math.max(1, hPt * 0.95);
    const natural = font.widthOfTextAtSize(text, size) || 1;
    const wPt = w.w * pxToPt;
    const vx = w.x * pxToPt;
    const vyBottom = frame.h - (w.y + w.h) * pxToPt;
    const o = frame.map(vx, vyBottom + size * 0.18);
    page.pushOperators(setCharacterSqueeze(Math.max(10, Math.min(500, (100 * wPt) / natural))));
    page.drawText(text, { x: o.x, y: o.y, size, font, rotate: degrees(frame.rot) });
  }
  page.pushOperators(setCharacterSqueeze(100), popGraphicsState());
}

export async function runOcr({ files, opts, progress }) {
  const engine = await createOcr(opts.lang, (t) => progress(0.02, t));
  const outputs = [];
  let ocrPages = 0, skipped = 0, wordsTotal = 0;
  try {
    const isPdf = files[0].isPdf;
    if (isPdf) {
      for (const f of files) {
        const src = await loadPdfLib(f.bytes);
        const out = await PDFDocument.create();
        const font = await out.embedFont(StandardFonts.Helvetica);
        const copied = await out.copyPages(src, src.getPageIndices());
        let allText = '';
        for (let n = 1; n <= f.pages; n++) {
          progress(0.05 + 0.9 * ((n - 1) / f.pages), `${files.length > 1 ? f.name + ': ' : ''}pagina ${n} di ${f.pages}`);
          const page = out.addPage(copied[n - 1]);
          const pg = await f.pdf.getPage(n);
          if (opts.skipText) {
            const tc = await pg.getTextContent();
            const existing = tc.items.map((i) => i.str).join(' ');
            if (existing.replace(/\s/g, '').length > 30) { skipped++; allText += existing + '\n\n'; continue; }
          }
          const vp = pg.getViewport({ scale: 1, rotation: pg.rotate });
          const scale = Math.min(300 / 72, Math.sqrt(14e6 / (vp.width * vp.height)));
          const { canvas } = await renderPage(f.pdf, n, scale);
          const png = await canvasToBytes(canvas, 'image/png');
          canvas.width = canvas.height = 1;
          const res = await engine.recognize(png);
          const words = parseTsv(res.tsv);
          wordsTotal += words.length;
          addTextLayer(page, font, words, 1 / scale, pageFrame(page));
          allText += res.text + '\n';
          ocrPages++;
        }
        if (opts.output !== 'txt') outputs.push(pdfOut(outName(f, 'OCR'), await savePdf(out)));
        if (opts.output !== 'pdf') outputs.push({ name: outName(f, 'OCR', 'txt'), data: new TextEncoder().encode(allText.trim() + '\n'), mime: 'text/plain' });
      }
    } else {
      // immagini → un PDF ricercabile
      const out = await PDFDocument.create();
      const font = await out.embedFont(StandardFonts.Helvetica);
      let allText = '';
      for (let i = 0; i < files.length; i++) {
        progress(0.05 + 0.9 * (i / files.length), `Immagine ${i + 1} di ${files.length}`);
        const canvas = await decodeToCanvas(files[i].file, 3500);
        const png = await canvasToBytes(canvas, 'image/png');
        const jpg = await canvasToBytes(canvas, 'image/jpeg', 0.85);
        const s = Math.min(1, 842 / Math.max(canvas.width, canvas.height) * 1.0);
        const pxToPt = Math.max(s, 0.24);
        const wPt = canvas.width * pxToPt, hPt = canvas.height * pxToPt;
        canvas.width = canvas.height = 1;
        const page = out.addPage([wPt, hPt]);
        page.drawImage(await out.embedJpg(jpg), { x: 0, y: 0, width: wPt, height: hPt });
        const res = await engine.recognize(png);
        const words = parseTsv(res.tsv);
        wordsTotal += words.length;
        addTextLayer(page, font, words, pxToPt, pageFrame(page));
        allText += res.text + '\n';
        ocrPages++;
      }
      const name = files.length === 1 ? baseName(files[0].name) + '_OCR' : 'scansioni_OCR';
      if (opts.output !== 'txt') outputs.push(pdfOut(name + '.pdf', await savePdf(out)));
      if (opts.output !== 'pdf') outputs.push({ name: name + '.txt', data: new TextEncoder().encode(allText.trim() + '\n'), mime: 'text/plain' });
    }
  } finally {
    engine.end();
  }
  return {
    outputs,
    zipName: 'ocr.zip',
    title: wordsTotal || skipped ? 'Testo riconosciuto!' : 'Nessun testo trovato',
    stats: `${ocrPages} ${ocrPages === 1 ? 'pagina analizzata' : 'pagine analizzate'} · ${wordsTotal} parole riconosciute${skipped ? ` · ${skipped} ${skipped === 1 ? 'pagina aveva' : 'pagine avevano'} già il testo` : ''}`,
  };
}
