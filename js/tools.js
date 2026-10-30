// MULTIPEPPINS — elenco degli strumenti (parte 1: organizza, ottimizza, sicurezza)
import { PDFLib, loadPdfLib, savePdf, renderPage, canvasToBytes, parseRanges, parseRangeGroups, fmtSize, openPdfJs, imagesToPdf, safeScale } from './core.js';
import { encryptPdf, decryptPdf } from './crypto.js';
import { selectGrid, arrangeGrid } from './pages.js';
import { createEditor } from './editor.js';
import { el, icon, toast } from './ui.js';
import { pdfOut, outName, pagesOption, pickPages, inflate, unpredict, fmtPct, ascii85 } from './helpers.js';
import { CONVERT_TOOLS, EDIT_TOOLS, OTHER_TOOLS } from './tools2.js';
import { PHASE2_TOOLS } from './tools3.js';

const { PDFDocument, PDFName, PDFRawStream, PDFNumber, PDFArray, PDFDict, degrees, PDFBool } = PDFLib;

export const CATS = [
  { id: 'organizza', label: 'Organizza', color: 'var(--c-organizza)' },
  { id: 'ottimizza', label: 'Ottimizza', color: 'var(--c-ottimizza)' },
  { id: 'in', label: 'Converti in PDF', color: 'var(--c-in)' },
  { id: 'da', label: 'Converti da PDF', color: 'var(--c-da)' },
  { id: 'modifica', label: 'Modifica', color: 'var(--c-modifica)' },
  { id: 'sicurezza', label: 'Sicurezza', color: 'var(--c-sicurezza)' },
  { id: 'altro', label: 'Altro', color: 'var(--c-altro)' },
];

/* =================== ORGANIZZA =================== */
const ORGANIZE = [
  {
    id: 'unisci-pdf', cat: 'organizza', icon: 'merge', name: 'Unisci PDF',
    desc: 'Combina più PDF nell\'ordine che vuoi, in un solo documento.',
    keywords: 'merge combina unire',
    multiple: true, orderMatters: true, minFiles: 2, minFilesMsg: 'Aggiungi almeno 2 PDF da unire.',
    action: 'Unisci PDF', working: 'Unione dei PDF',
    sideIntro: 'Trascina i file (o usa le frecce) per decidere l\'ordine.',
    options: [
      { key: 'blankOdd', type: 'checkbox', label: 'Aggiungi una pagina vuota dopo i file con pagine dispari (utile per la stampa fronte-retro)', default: false },
    ],
    async run({ files, opts, progress }) {
      const out = await PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        progress(i / files.length, files[i].name);
        const src = await loadPdfLib(files[i].bytes);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
        if (opts.blankOdd && pages.length % 2 === 1 && i < files.length - 1) {
          const last = pages[pages.length - 1].getSize();
          out.addPage([last.width, last.height]);
        }
      }
      progress(0.95, 'Salvataggio…');
      return { outputs: [pdfOut('multipeppins_unito.pdf', await savePdf(out))], stats: `${files.length} file uniti · ${out.getPageCount()} pagine` };
    },
  },
  {
    id: 'dividi-pdf', cat: 'organizza', icon: 'split', name: 'Dividi PDF',
    desc: 'Separa un PDF in più file: per intervalli, ogni N pagine o pagina per pagina.',
    keywords: 'split separa estrai',
    action: 'Dividi PDF', working: 'Divisione del PDF',
    options: (ctx) => [
      { key: 'mode', type: 'radio', label: 'Come vuoi dividere?', default: 'ranges', options: [
        { value: 'ranges', label: 'Per intervalli', desc: 'Scegli tu i gruppi di pagine' },
        { value: 'fixed', label: 'Ogni N pagine', desc: 'Blocchi della stessa lunghezza' },
        { value: 'each', label: 'Una pagina per file', desc: 'Ogni pagina diventa un PDF' },
        { value: 'half', label: 'A metà', desc: 'Due file con metà delle pagine' },
      ] },
      { key: 'ranges', type: 'text', label: 'Intervalli', default: ctx.files[0] && ctx.files[0].pages > 1 ? `1-${Math.ceil(ctx.files[0].pages / 2)}, ${Math.ceil(ctx.files[0].pages / 2) + 1}-${ctx.files[0].pages}` : '1', help: `Ogni intervallo diventa un file. Il documento ha ${ctx.files[0] ? ctx.files[0].pages : '?'} pagine.`, showIf: (v) => v.mode === 'ranges' },
      { key: 'mergeRanges', type: 'checkbox', label: 'Unisci tutti gli intervalli in un unico PDF', default: false, showIf: (v) => v.mode === 'ranges' },
      { key: 'every', type: 'number', label: 'Pagine per file', default: 2, min: 1, showIf: (v) => v.mode === 'fixed' },
    ],
    async run({ files, opts, progress }) {
      const f = files[0];
      const src = await loadPdfLib(f.bytes);
      const total = src.getPageCount();
      let groups = [];
      if (opts.mode === 'ranges') groups = parseRangeGroups(opts.ranges, total).map((g) => ({ label: g.label.replace(/\s/g, ''), pages: g.pages }));
      else if (opts.mode === 'fixed') {
        const n = Math.max(1, Math.floor(+opts.every || 1));
        for (let i = 1; i <= total; i += n) groups.push({ label: `${i}-${Math.min(total, i + n - 1)}`, pages: Array.from({ length: Math.min(n, total - i + 1) }, (_, k) => i + k) });
      } else if (opts.mode === 'half') {
        const h = Math.ceil(total / 2);
        groups = [{ label: `1-${h}`, pages: Array.from({ length: h }, (_, k) => k + 1) }];
        if (total > h) groups.push({ label: `${h + 1}-${total}`, pages: Array.from({ length: total - h }, (_, k) => h + 1 + k) });
      } else for (let i = 1; i <= total; i++) groups.push({ label: String(i), pages: [i] });
      if (!groups.length) throw new Error('Nessun intervallo indicato.');
      if (opts.mode === 'ranges' && opts.mergeRanges) groups = [{ label: 'selezione', pages: groups.flatMap((g) => g.pages) }];
      const outputs = [];
      for (let i = 0; i < groups.length; i++) {
        progress(i / groups.length, `File ${i + 1} di ${groups.length}`);
        const out = await PDFDocument.create();
        const pages = await out.copyPages(src, groups[i].pages.map((p) => p - 1));
        pages.forEach((p) => out.addPage(p));
        outputs.push(pdfOut(outName(f, groups[i].pages.length === 1 ? `pagina_${groups[i].label}` : `pagine_${groups[i].label}`), await savePdf(out)));
      }
      return { outputs, zipName: outName(f, 'diviso', 'zip'), stats: `${outputs.length} ${outputs.length === 1 ? 'file creato' : 'file creati'}` };
    },
  },
  {
    id: 'rimuovi-pagine', cat: 'organizza', icon: 'remove', name: 'Rimuovi pagine',
    desc: 'Elimina le pagine che non ti servono, scegliendole dalle miniature.',
    keywords: 'elimina cancella delete',
    action: 'Rimuovi pagine', working: 'Rimozione pagine',
    stage: (ctx) => selectGrid(ctx, { hint: 'Tocca le pagine da eliminare.' }),
    validate: (o, files, s) => { const n = s.getSelection().length; if (!n) return 'Seleziona almeno una pagina da eliminare.'; if (n >= files[0].pages) return 'Non puoi eliminare tutte le pagine.'; },
    async run({ files, stageCtl }) {
      const f = files[0];
      const doc = await loadPdfLib(f.bytes);
      const sel = stageCtl.getSelection();
      [...sel].sort((a, b) => b - a).forEach((p) => doc.removePage(p - 1));
      return { outputs: [pdfOut(outName(f, 'modificato'), await savePdf(doc))], stats: `${sel.length} ${sel.length === 1 ? 'pagina eliminata' : 'pagine eliminate'} · ne restano ${doc.getPageCount()}` };
    },
  },
  {
    id: 'estrai-pagine', cat: 'organizza', icon: 'extract', name: 'Estrai pagine',
    desc: 'Crea un nuovo PDF solo con le pagine che scegli.',
    keywords: 'extract seleziona copia',
    action: 'Estrai pagine', working: 'Estrazione pagine',
    stage: (ctx) => selectGrid(ctx, { hint: 'Tocca le pagine da estrarre.' }),
    options: [{ key: 'separate', type: 'radio', default: 'one', options: [{ value: 'one', label: 'Un unico PDF', desc: 'Tutte le pagine scelte insieme' }, { value: 'each', label: 'Un PDF per pagina', desc: 'Ogni pagina scelta in un file' }] }],
    validate: (o, f, s) => (s.getSelection().length ? null : 'Seleziona almeno una pagina.'),
    async run({ files, opts, stageCtl }) {
      const f = files[0];
      const src = await loadPdfLib(f.bytes);
      const sel = stageCtl.getSelection();
      const make = async (list) => { const out = await PDFDocument.create(); (await out.copyPages(src, list.map((p) => p - 1))).forEach((p) => out.addPage(p)); return savePdf(out); };
      if (opts.separate === 'each') {
        const outputs = [];
        for (const p of sel) outputs.push(pdfOut(outName(f, `pagina_${p}`), await make([p])));
        return { outputs, zipName: outName(f, 'pagine', 'zip') };
      }
      return { outputs: [pdfOut(outName(f, 'estratto'), await make(sel))], stats: `${sel.length} ${sel.length === 1 ? 'pagina estratta' : 'pagine estratte'}` };
    },
  },
  {
    id: 'organizza-pdf', cat: 'organizza', icon: 'organize', name: 'Organizza PDF',
    desc: 'Riordina, ruota, elimina e aggiungi pagine. Puoi anche mescolare pagine di più PDF.',
    keywords: 'riordina ordine sposta pagine vuote',
    multiple: true,
    action: 'Salva le modifiche', working: 'Riorganizzazione',
    stage: (ctx) => arrangeGrid(ctx),
    validate: (o, f, s) => (s.getItems().length ? null : 'Non ci sono pagine.'),
    async run({ files, stageCtl, progress }) {
      const items = stageCtl.getItems();
      const out = await PDFDocument.create();
      const srcs = [];
      for (const f of files) srcs.push(await loadPdfLib(f.bytes));
      let lastSize = [595.28, 841.89];
      for (let i = 0; i < items.length; i++) {
        progress(i / items.length);
        const it = items[i];
        if (it.blank) { const p = out.addPage(lastSize); if (it.rot) p.setRotation(degrees(it.rot)); continue; }
        const [p] = await out.copyPages(srcs[it.src], [it.page - 1]);
        const base = p.getRotation().angle || 0;
        if (it.rot) p.setRotation(degrees((base + it.rot) % 360));
        out.addPage(p);
        const s = p.getSize();
        lastSize = [s.width, s.height];
      }
      return { outputs: [pdfOut(files.length > 1 ? 'multipeppins_organizzato.pdf' : outName(files[0], 'organizzato'), await savePdf(out))], stats: `${out.getPageCount()} pagine` };
    },
  },
  {
    id: 'ruota-pdf', cat: 'organizza', icon: 'rotate', name: 'Ruota PDF',
    desc: 'Ruota tutte le pagine o solo alcune. Puoi ruotare più PDF insieme.',
    keywords: 'rotate gira orientamento',
    multiple: true,
    action: 'Ruota PDF', working: 'Rotazione',
    options: [
      { key: 'angle', type: 'seg', label: 'Rotazione', default: 90, options: [{ value: 90, label: '↻ 90° destra' }, { value: 180, label: '180°' }, { value: 270, label: '↺ 90° sinistra' }] },
      ...pagesOption('Quali pagine'),
    ],
    async run({ files, opts, progress }) {
      const outputs = [];
      for (let i = 0; i < files.length; i++) {
        progress(i / files.length, files[i].name);
        const doc = await loadPdfLib(files[i].bytes);
        const pages = doc.getPages();
        for (const n of pickPages(opts, pages.length)) {
          const p = pages[n - 1];
          p.setRotation(degrees(((p.getRotation().angle || 0) + opts.angle) % 360));
        }
        outputs.push(pdfOut(outName(files[i], 'ruotato'), await savePdf(doc)));
      }
      return { outputs, zipName: 'pdf_ruotati.zip' };
    },
  },
];

/* =================== OTTIMIZZA =================== */
// Ricomprime le immagini dentro il PDF mantenendo testo e grafica vettoriale
async function recompressImages(doc, { maxDim, quality }, progress) {
  const ctx = doc.context;
  const objs = ctx.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'));
  let changed = 0, saved = 0;
  for (let i = 0; i < objs.length; i++) {
    const [, obj] = objs[i];
    progress && progress(0.1 + 0.8 * (i / Math.max(1, objs.length)), `Immagine ${i + 1} di ${objs.length}`);
    try {
      const d = obj.dict;
      if (d.lookup(PDFName.of('ImageMask')) === PDFBool.True || d.get(PDFName.of('Decode'))) continue;
      const bpc = d.lookup(PDFName.of('BitsPerComponent'));
      const w = d.lookup(PDFName.of('Width')).asNumber();
      const h = d.lookup(PDFName.of('Height')).asNumber();
      if (obj.contents.length < 12000 || w * h < 40000) continue;
      let filter = d.lookup(PDFName.of('Filter'));
      let data = obj.contents;
      if (filter instanceof PDFArray) {
        const names = filter.asArray().map((x) => x.asString());
        if (names.length === 2 && (names[0] === '/ASCII85Decode' || names[0] === '/A85')) { data = ascii85(data); filter = PDFName.of(names[1].slice(1)); }
        else if (names.length === 1) filter = filter.lookup(0);
        else continue;
      }
      const fname = filter ? filter.asString() : '';
      // spazio colore
      let cs = d.lookup(PDFName.of('ColorSpace'));
      let comps = 0;
      if (cs === PDFName.of('DeviceRGB') || cs === PDFName.of('CalRGB')) comps = 3;
      else if (cs === PDFName.of('DeviceGray') || cs === PDFName.of('CalGray')) comps = 1;
      else if (cs instanceof PDFArray && cs.lookup(0) === PDFName.of('ICCBased')) {
        const icc = cs.lookup(1);
        const n = icc && icc.dict ? icc.dict.lookup(PDFName.of('N')) : null;
        comps = n ? n.asNumber() : 0;
        if (comps !== 1 && comps !== 3) continue;
      } else if (cs instanceof PDFArray && (cs.lookup(0) === PDFName.of('CalRGB') || cs.lookup(0) === PDFName.of('CalGray'))) {
        comps = cs.lookup(0) === PDFName.of('CalRGB') ? 3 : 1;
      } else continue;
      let canvas;
      if (fname === '/DCTDecode') {
        const bmp = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
        canvas = scaledCanvas(bmp, bmp.width, bmp.height, maxDim);
        bmp.close && bmp.close();
      } else if (fname === '/FlateDecode') {
        if (!bpc || bpc.asNumber() !== 8) continue;
        let raw = await inflate(data);
        let parms = d.lookup(PDFName.of('DecodeParms'));
        if (parms instanceof PDFArray) parms = parms.lookup(parms.size() - 1);
        if (parms instanceof PDFDict) {
          const pred = parms.lookup(PDFName.of('Predictor'));
          if (pred && pred.asNumber() >= 10) raw = unpredict(raw, w, comps, 8, pred.asNumber());
          else if (pred && pred.asNumber() === 2) continue;
        }
        if (raw.length < w * h * comps) continue;
        const id = new ImageData(w, h);
        for (let p = 0, q = 0; p < w * h; p++, q += comps) {
          const o = p * 4;
          if (comps === 3) { id.data[o] = raw[q]; id.data[o + 1] = raw[q + 1]; id.data[o + 2] = raw[q + 2]; }
          else { id.data[o] = id.data[o + 1] = id.data[o + 2] = raw[q]; }
          id.data[o + 3] = 255;
        }
        const full = document.createElement('canvas');
        full.width = w; full.height = h;
        full.getContext('2d').putImageData(id, 0, 0);
        canvas = scaledCanvas(full, w, h, maxDim);
      } else continue;
      const jpg = await canvasToBytes(canvas, 'image/jpeg', quality);
      if (jpg.length >= obj.contents.length * 0.92) continue;
      saved += obj.contents.length - jpg.length;
      obj.contents = jpg;
      d.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
      d.delete(PDFName.of('DecodeParms'));
      d.set(PDFName.of('Width'), PDFNumber.of(canvas.width));
      d.set(PDFName.of('Height'), PDFNumber.of(canvas.height));
      d.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
      d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
      changed++;
    } catch (e) { /* immagine non gestibile: la lasciamo com'è */ }
  }
  return { changed, saved, total: objs.length };
}
function scaledCanvas(src, w, h, maxDim) {
  const s = Math.min(1, maxDim / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// Ricostruisce il PDF come immagini (per compressione estrema / scala di grigi)
async function rasterizePdf(pdf, { dpi, quality, gray, progress }) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    progress && progress((n - 1) / pdf.numPages, `Pagina ${n} di ${pdf.numPages}`);
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1, rotation: page.rotate });
    const scale = safeScale(vp.width, vp.height, dpi / 72);
    const { canvas } = await renderPage(pdf, n, scale);
    if (gray) toGray(canvas);
    pages.push({ bytes: await canvasToBytes(canvas, 'image/jpeg', quality), type: 'jpg', widthPt: vp.width, heightPt: vp.height });
    canvas.width = canvas.height = 1;
  }
  const doc = await imagesToPdf(pages);
  return doc.save({ useObjectStreams: true });
}
function toGray(canvas) {
  const g = canvas.getContext('2d');
  const d = g.getImageData(0, 0, canvas.width, canvas.height);
  const a = d.data;
  for (let i = 0; i < a.length; i += 4) { const y = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]; a[i] = a[i + 1] = a[i + 2] = y; }
  g.putImageData(d, 0, 0);
}

const OPTIMIZE = [
  {
    id: 'comprimi-pdf', cat: 'ottimizza', icon: 'compress', name: 'Comprimi PDF',
    desc: 'Riduci il peso del PDF mantenendo la migliore qualità possibile.',
    keywords: 'compress riduci dimensione peso leggero',
    multiple: true, action: 'Comprimi PDF', working: 'Compressione',
    options: [
      { key: 'level', type: 'radio', label: 'Livello di compressione', default: 'rec', options: [
        { value: 'extreme', label: 'Estrema', desc: 'File più leggero, qualità più bassa' },
        { value: 'rec', label: 'Consigliata', desc: 'Buona qualità, buona compressione' },
        { value: 'low', label: 'Leggera', desc: 'Qualità massima, compressione minore' },
      ] },
      { key: 'rasterize', type: 'checkbox', label: 'Trasforma le pagine in immagini (per PDF molto pesanti e "ostinati"; il testo non sarà più selezionabile)', default: false, showIf: (v) => v.level === 'extreme' },
    ],
    async run({ files, opts, progress }) {
      const outputs = [];
      let before = 0, after = 0;
      const params = { extreme: { maxDim: 1100, quality: 0.5 }, rec: { maxDim: 1700, quality: 0.68 }, low: { maxDim: 2600, quality: 0.85 } }[opts.level];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const sub = (x, t) => progress((i + x) / files.length, (files.length > 1 ? `${f.name}: ` : '') + (t || ''));
        let bytes;
        if (opts.level === 'extreme' && opts.rasterize) {
          bytes = await rasterizePdf(f.pdf, { dpi: 110, quality: 0.5, progress: (x, t) => sub(x * 0.95, t) });
        } else {
          const doc = await loadPdfLib(f.bytes);
          sub(0.05, 'Analisi del documento…');
          if (opts.level !== 'low' || true) await recompressImages(doc, params, (x, t) => sub(x, t));
          sub(0.92, 'Salvataggio…');
          bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
        }
        const final = bytes.length < f.bytes.length ? bytes : f.bytes;
        before += f.bytes.length;
        after += final.length;
        outputs.push(pdfOut(outName(f, 'compresso'), final));
      }
      const pct = fmtPct(before, after);
      return {
        outputs,
        zipName: 'pdf_compressi.zip',
        title: pct > 0 ? 'I tuoi PDF sono stati compressi!' : 'Il PDF era già ottimizzato',
        stats: pct > 0 ? `Peso ridotto del ${pct}% · da ${fmtSize(before)} a ${fmtSize(after)}` : `Non è stato possibile ridurlo ulteriormente (${fmtSize(before)}). ${opts.level !== 'extreme' ? 'Prova la compressione "Estrema".' : ''}`,
      };
    },
  },
  {
    id: 'ripara-pdf', cat: 'ottimizza', icon: 'repair', name: 'Ripara PDF',
    desc: 'Prova a recuperare un PDF danneggiato o che non si apre bene.',
    keywords: 'repair recupera danneggiato corrotto',
    multiple: true, action: 'Ripara PDF', working: 'Riparazione',
    async run({ files, progress }) {
      const outputs = [];
      const notes = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        progress(i / files.length, f.name);
        try {
          const doc = await PDFDocument.load(f.bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
          if (!doc.getPageCount()) throw new Error('vuoto');
          outputs.push(pdfOut(outName(f, 'riparato'), await doc.save({ useObjectStreams: true, updateFieldAppearances: false })));
        } catch {
          // ricostruzione dalle immagini delle pagine
          const pdf = f.pdf || (await openPdfJs(f.bytes));
          outputs.push(pdfOut(outName(f, 'riparato'), await rasterizePdf(pdf, { dpi: 150, quality: 0.85 })));
          notes.push(f.name);
        }
      }
      return { outputs, zipName: 'pdf_riparati.zip', stats: notes.length ? 'Alcune pagine sono state ricostruite come immagini.' : 'Struttura del PDF ricostruita.' };
    },
  },
  {
    id: 'scala-di-grigi', cat: 'ottimizza', icon: 'gray', name: 'PDF in bianco e nero',
    desc: 'Converti il PDF in scala di grigi, ideale per stampare risparmiando inchiostro.',
    keywords: 'grigio grayscale bianco nero stampa',
    multiple: true, action: 'Converti in grigio', working: 'Conversione in scala di grigi',
    options: [
      { key: 'dpi', type: 'seg', label: 'Qualità', default: 150, options: [{ value: 110, label: 'Normale' }, { value: 150, label: 'Buona' }, { value: 220, label: 'Alta' }] },
      { type: 'note', text: 'Le pagine vengono trasformate in immagini: il testo non sarà più selezionabile.' },
    ],
    async run({ files, opts, progress }) {
      const outputs = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        outputs.push(pdfOut(outName(f, 'bianco_nero'), await rasterizePdf(f.pdf, { dpi: opts.dpi, quality: 0.8, gray: true, progress: (x, t) => progress((i + x) / files.length, t) })));
      }
      return { outputs, zipName: 'pdf_bianco_nero.zip' };
    },
  },
];

/* =================== SICUREZZA =================== */
const SECURITY = [
  {
    id: 'proteggi-pdf', cat: 'sicurezza', icon: 'lock', name: 'Proteggi PDF',
    desc: 'Metti una password al PDF per impedire che altri lo aprano.',
    keywords: 'password cripta protezione lock',
    multiple: true, action: 'Proteggi PDF', working: 'Protezione',
    options: [
      { key: 'pw', type: 'password', label: 'Password', placeholder: 'Scegli una password' },
      { key: 'pw2', type: 'password', label: 'Ripeti la password', placeholder: 'Ripeti la password' },
      { key: 'advanced', type: 'checkbox', label: 'Limita anche stampa, copia e modifica', default: false },
      { key: 'allowPrint', type: 'checkbox', label: 'Consenti la stampa', default: true, showIf: (v) => v.advanced },
      { key: 'allowCopy', type: 'checkbox', label: 'Consenti di copiare il testo', default: false, showIf: (v) => v.advanced },
      { key: 'allowModify', type: 'checkbox', label: 'Consenti le modifiche', default: false, showIf: (v) => v.advanced },
      { key: 'ownerPw', type: 'password', label: 'Password del proprietario (facoltativa)', help: 'Serve a togliere i limiti. Se la lasci vuota ne viene creata una casuale.', showIf: (v) => v.advanced },
      { type: 'note', tone: 'info', text: 'Protezione AES 128 bit, compatibile con tutti i lettori PDF. Non dimenticare la password: non si può recuperare.' },
    ],
    validate: (o) => (!o.pw ? 'Inserisci una password.' : o.pw !== o.pw2 ? 'Le due password non coincidono.' : null),
    async run({ files, opts, progress }) {
      const outputs = [];
      for (let i = 0; i < files.length; i++) {
        progress(i / files.length, files[i].name);
        const perms = opts.advanced ? { print: opts.allowPrint, copy: opts.allowCopy, modify: opts.allowModify, annotate: opts.allowModify, fill: true, assemble: opts.allowModify } : {};
        outputs.push(pdfOut(outName(files[i], 'protetto'), await encryptPdf(files[i].bytes, opts.pw, opts.advanced ? opts.ownerPw : '', perms)));
      }
      return { outputs, zipName: 'pdf_protetti.zip', stats: 'Per aprirli servirà la password che hai scelto.' };
    },
  },
  {
    id: 'sblocca-pdf', cat: 'sicurezza', icon: 'unlock', name: 'Sblocca PDF',
    desc: 'Togli la password e le restrizioni da un PDF di cui conosci la password.',
    keywords: 'unlock rimuovi password sproteggi',
    multiple: true, rawInput: true, action: 'Sblocca PDF', working: 'Sblocco',
    options: [
      { key: 'pw', type: 'password', label: 'Password del PDF', placeholder: 'Password', help: 'Lasciala vuota se il PDF si apre senza password ma non permette di stampare o modificare.' },
    ],
    async run({ files, opts, progress }) {
      const outputs = [];
      let notEnc = 0;
      for (let i = 0; i < files.length; i++) {
        progress(i / files.length, files[i].name);
        let r;
        try {
          r = await decryptPdf(files[i].bytes, opts.pw || '');
        } catch (e) {
          if (e.code === 'password') throw new Error(`"${files[i].name}": ${opts.pw ? 'password errata' : 'serve la password per aprirlo'}.`);
          throw e;
        }
        if (!r.wasEncrypted) notEnc++;
        outputs.push(pdfOut(outName(files[i], 'sbloccato'), r.bytes));
      }
      return { outputs, zipName: 'pdf_sbloccati.zip', stats: notEnc === files.length ? 'Il PDF non era protetto.' : 'Password e restrizioni rimosse.' };
    },
  },
  {
    id: 'censura-pdf', cat: 'sicurezza', icon: 'redact', name: 'Censura PDF',
    desc: 'Oscura in modo definitivo testi e dati sensibili (nomi, codici fiscali, IBAN…).',
    keywords: 'redact oscura nascondi privacy gdpr',
    action: 'Applica la censura', working: 'Censura in corso',
    stage: (ctx) => createEditor(ctx, { mode: 'redact' }),
    options: (ctx) => [
      { key: 'query', type: 'custom', label: 'Cerca e oscura un testo', render: (v) => {
        const inp = el('input', { class: 'inp', placeholder: 'es. Mario Rossi' });
        const cs = el('input', { type: 'checkbox' });
        const btn = el('button', { class: 'btn-sec', style: { marginTop: '8px' } }, icon('search', 16), 'Trova e oscura');
        btn.addEventListener('click', async () => {
          const ed = ctx.stageCtlRef && ctx.stageCtlRef();
          if (!ed) return;
          const n = await ed.redactSearch(inp.value, { caseSensitive: cs.checked });
          toast(n ? `Oscurate ${n} occorrenze` : 'Nessuna occorrenza trovata', !n);
        });
        return el('div', {}, inp, el('label', { class: 'check' }, cs, 'Distingui maiuscole/minuscole'), btn);
      } },
      { type: 'note', text: 'Le pagine con parti oscurate vengono trasformate in immagini, così il testo nascosto non si può recuperare.' },
    ],
    async run({ files, stageCtl, progress }) {
      const f = files[0];
      return { outputs: [pdfOut(outName(f, 'censurato'), await stageCtl.apply(f.bytes, {}, progress))] };
    },
  },
  {
    id: 'appiattisci-pdf', cat: 'sicurezza', icon: 'flatten', name: 'Appiattisci PDF',
    desc: 'Rendi definitivi moduli compilati, annotazioni e firme, così nessuno può modificarli.',
    keywords: 'flatten moduli fissa',
    multiple: true, action: 'Appiattisci PDF', working: 'Appiattimento',
    options: [
      { key: 'mode', type: 'radio', default: 'forms', options: [
        { value: 'forms', label: 'Solo i moduli', desc: 'I campi compilati diventano testo fisso. Il resto resta modificabile.' },
        { value: 'raster', label: 'Tutto', desc: 'Ogni pagina diventa un\'immagine: niente sarà più modificabile o selezionabile.' },
      ] },
    ],
    async run({ files, opts, progress }) {
      const outputs = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        progress(i / files.length, f.name);
        if (opts.mode === 'raster') {
          outputs.push(pdfOut(outName(f, 'appiattito'), await rasterizePdf(f.pdf, { dpi: 170, quality: 0.85, progress: (x, t) => progress((i + x) / files.length, t) })));
          continue;
        }
        const doc = await loadPdfLib(f.bytes);
        try {
          const form = doc.getForm();
          try { form.updateFieldAppearances(); } catch {}
          form.flatten({ updateFieldAppearances: false });
        } catch {}
        outputs.push(pdfOut(outName(f, 'appiattito'), await savePdf(doc, { updateFieldAppearances: false })));
      }
      return { outputs, zipName: 'pdf_appiattiti.zip' };
    },
  },
];

export const TOOLS = [...ORGANIZE, ...OPTIMIZE, ...CONVERT_TOOLS, ...PHASE2_TOOLS, ...EDIT_TOOLS, ...SECURITY, ...OTHER_TOOLS];
export { rasterizePdf, toGray };
