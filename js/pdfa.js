// MULTIPEPPINS — conversione in PDF/A (1b, 2b, 3b) per l'archiviazione a lungo termine
import { PDFLib, loadPdfLib, savePdf, renderPage, canvasToBytes, safeScale } from './core.js';
import { pageLines } from './helpers.js';
import { lazyOcr, ocrPdfPage } from './ocr.js';

const {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFStream, PDFRawStream, PDFNumber, PDFHexString, PDFString,
  decodePDFRawStream, pushGraphicsState, popGraphicsState, setTextRenderingMode,
  setCharacterSqueeze, TextRenderingMode, beginText, endText, setFontAndSize, setTextMatrix, showText,
} = PDFLib;

/* Carattere "senza glifi" (come quello di Tesseract): rende il testo ricercabile senza disegnarlo.
   È incorporato nel file, quindi rispetta le regole del PDF/A. */
const GLYPHLESS_TTF = 'AAEAAAAKAIAAAwAgT1MvMkT8Q7AAAAEoAAAAYGNtYXAADABzAAABkAAAADRnbHlmAAAAAAAAAcwAAAABaGVhZC0pzHAAAACsAAAANmhoZWEDIgEuAAAA5AAAACRobXR4AfQAAAAAAYgAAAAGbG9jYQAAAAAAAAHEAAAABm1heHAAAwACAAABCAAAACBuYW1lGZ8ZNAAAAdAAAABycG9zdJ5/ds8AAAJEAAAALQABAAAAAQAARsVZaV8PPPUAAwPoAAAAAOcJxcgAAAAA5wnFyAAAAAAAAAAAAAAAAwACAAAAAAAAAAEAAAMg/zgAAAH0AAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAEAAAACAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwH0AZAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAPz8/PwAAACAAIAMg/zgAAAMgAMgAAAAAAAAAAAAAAAAAAAAgAAAB9AAAAAAAAAAAAAIAAAADAAAAFAADAAEAAAAUAAQAIAAAAAQABAABAAAAIP//AAAAIP///+EAAQAAAAAAAAAAAAAAAAAAAAAAAAAEADYAAQAAAAAAAQANAAAAAQAAAAAAAgAHAA0AAwABBAkAAQAaABQAAwABBAkAAgAOAC5HbHlwaExlc3NGb250UmVndWxhcgBHAGwAeQBwAGgATABlAHMAcwBGAG8AbgB0AFIAZQBnAHUAbABhAHIAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAECBmdseXBoMQAAAA==';
function embedGlyphless(doc) {
  const ctx = doc.context;
  const ttf = Uint8Array.from(atob(GLYPHLESS_TTF), (c) => c.charCodeAt(0));
  const file = ctx.register(ctx.flateStream(ttf, { Length1: ttf.length }));
  const desc = ctx.register(ctx.obj({ Type: 'FontDescriptor', FontName: 'GlyphLessFont', Flags: 4, FontBBox: [0, -200, 500, 800], ItalicAngle: 0, Ascent: 800, Descent: -200, CapHeight: 800, StemV: 80, FontFile2: file }));
  const map = new Uint8Array(65536 * 2);
  for (let i = 1; i < map.length; i += 2) map[i] = 1; // ogni carattere → glifo 1 (vuoto)
  const cidToGid = ctx.register(ctx.flateStream(map));
  const cid = ctx.register(ctx.obj({
    Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'GlyphLessFont',
    CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
    FontDescriptor: desc, DW: 500, CIDToGIDMap: cidToGid,
  }));
  const ranges = [];
  for (let hi = 0; hi < 256; hi++) { const h = hi.toString(16).padStart(2, '0').toUpperCase(); ranges.push(`<${h}00> <${h}FF> <${h}00>`); }
  let blocks = '';
  for (let i = 0; i < ranges.length; i += 100) { const part = ranges.slice(i, i + 100); blocks += `${part.length} beginbfrange\n${part.join('\n')}\nendbfrange\n`; }
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${blocks}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
  const toUni = ctx.register(ctx.flateStream(new TextEncoder().encode(cmap)));
  return ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'GlyphLessFont', Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: toUni }));
}
function utf16hex(str) {
  let h = '';
  for (let i = 0; i < str.length; i++) h += str.charCodeAt(i).toString(16).padStart(4, '0');
  return h;
}
// Scrive parole invisibili {str,x,y(base, dall'alto),w,h} su una pagina alta pageH
function drawInvisibleText(page, fontRef, items, pageH) {
  const fname = page.node.newFontDictionary('GlyphLess', fontRef);
  const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  let count = 0;
  for (const it of items) {
    const text = String(it.str).replace(/\s+$/, '').replace(/^\s+/, '');
    if (!text) continue;
    const size = Math.max(1, Math.min(300, it.h));
    const natural = text.length * 0.5 * size;
    ops.push(setFontAndSize(fname, size), setCharacterSqueeze(Math.max(10, Math.min(500, (100 * Math.max(1, it.w)) / natural))), setTextMatrix(1, 0, 0, 1, it.x, pageH - it.y), showText(PDFHexString.of(utf16hex(text))));
    count++;
  }
  ops.push(endText(), popGraphicsState());
  if (count) page.pushOperators(...ops);
}

const ICC_URL = new URL('../vendor/srgb.icc', import.meta.url).href;
let iccCache = null;
async function srgbProfile() {
  if (!iccCache) {
    const r = await fetch(ICC_URL);
    if (!r.ok) throw new Error('Profilo colore sRGB non trovato');
    iccCache = new Uint8Array(await r.arrayBuffer());
  }
  return iccCache;
}

const N = (n) => PDFName.of(n);
const look = (dict, key) => (dict instanceof PDFDict ? dict.lookup(N(key)) : undefined);
const nameOf = (o) => (o instanceof PDFName ? o.asString().slice(1) : null);
const num = (o) => (o instanceof PDFNumber ? o.asNumber() : null);

function textOf(o) {
  try { return o && (o instanceof PDFString || o instanceof PDFHexString) ? o.decodeText() : null; } catch { return null; }
}
function xmlEsc(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}
function pdfDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
function xmpDate(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function randomHex(n = 16) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------- Analisi: cosa impedisce di mantenere il PDF così com'è ---------------- */
function decoded(stream) {
  try {
    if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
    if (stream.getContents) return stream.getContents();
  } catch {}
  return null;
}

function hasCMYK(ctx, o, depth = 0) {
  if (depth > 4 || o == null) return false;
  if (o instanceof PDFRef) o = ctx.lookup(o);
  if (o instanceof PDFName) return ['DeviceCMYK', 'CMYK'].includes(nameOf(o));
  if (o instanceof PDFArray) {
    const first = nameOf(ctx.lookup(o.get(0)));
    if (first === 'ICCBased' || first === 'Pattern' && o.size() === 1) return false;
    return o.asArray().some((x) => hasCMYK(ctx, x, depth + 1));
  }
  return false;
}

function analyze(doc, part) {
  const issues = new Set();
  const ctx = doc.context;
  const latin = new TextDecoder('latin1');
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
    if (!dict) continue;
    const type = nameOf(dict.lookup(N('Type')));
    const sub = nameOf(dict.lookup(N('Subtype')));
    // filtri vietati
    const filters = dict.lookup(N('Filter'));
    const fl = filters instanceof PDFArray ? filters.asArray().map(nameOf) : [nameOf(filters)];
    if (fl.includes('LZWDecode')) issues.add('compressione LZW');
    if (part === 1 && fl.includes('JPXDecode')) issues.add('immagini JPEG 2000');
    // font non incorporati
    if (type === 'Font' && sub && sub !== 'Type3' && sub !== 'Type0') {
      const fd = look(dict, 'FontDescriptor');
      const embedded = fd instanceof PDFDict && (fd.has(N('FontFile')) || fd.has(N('FontFile2')) || fd.has(N('FontFile3')));
      if (!embedded) issues.add('caratteri non incorporati');
    }
    if (type === 'Font' && sub === 'Type0') {
      const desc = look(dict, 'DescendantFonts');
      const d0 = desc instanceof PDFArray ? desc.lookup(0) : null;
      const fd = look(d0, 'FontDescriptor');
      const embedded = fd instanceof PDFDict && (fd.has(N('FontFile')) || fd.has(N('FontFile2')) || fd.has(N('FontFile3')));
      if (!embedded) issues.add('caratteri non incorporati');
    }
    // colori CMYK senza profilo (il profilo di uscita è RGB)
    const cs = dict.lookup(N('ColorSpace'));
    if (cs instanceof PDFDict) { for (const [, v] of cs.entries()) if (hasCMYK(ctx, v)) issues.add('colori CMYK'); }
    else if (hasCMYK(ctx, cs)) issues.add('colori CMYK');
    // oggetti PostScript e trasferimenti
    if (sub === 'PS' || (type === 'XObject' && dict.has(N('PS')))) issues.add('codice PostScript');
    if (type === 'ExtGState') {
      if (dict.has(N('TR'))) issues.add('funzioni di trasferimento');
      const tr2 = dict.lookup(N('TR2'));
      if (tr2 && nameOf(tr2) !== 'Default') issues.add('funzioni di trasferimento');
      if (part === 1) {
        const smask = dict.lookup(N('SMask'));
        if (smask && nameOf(smask) !== 'None') issues.add('trasparenze');
        const ca = num(dict.lookup(N('CA'))), ca2 = num(dict.lookup(N('ca')));
        if ((ca != null && ca < 1) || (ca2 != null && ca2 < 1)) issues.add('trasparenze');
        const bm = nameOf(dict.lookup(N('BM')));
        if (bm && bm !== 'Normal' && bm !== 'Compatible') issues.add('trasparenze');
      }
    }
    if (part === 1 && sub === 'Image' && dict.has(N('SMask'))) issues.add('trasparenze');
    if (part === 1 && dict.has(N('Group')) && type !== 'Catalog') {
      const g = look(dict, 'Group');
      if (nameOf(look(g, 'S')) === 'Transparency') issues.add('trasparenze');
    }
    // annotazioni senza aspetto grafico
    if (type === 'Annot' || dict.has(N('Rect')) && dict.has(N('Subtype')) && ['Link', 'Widget', 'Text', 'FreeText', 'Square', 'Circle', 'Line', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Stamp', 'Ink', 'Popup', 'FileAttachment', 'Polygon', 'PolyLine', 'Caret'].includes(sub)) {
      if (sub !== 'Link' && sub !== 'Popup') {
        const rect = look(dict, 'Rect');
        const zero = rect instanceof PDFArray && rect.size() === 4 && Math.abs(num(rect.lookup(2)) - num(rect.lookup(0))) < 0.01 && Math.abs(num(rect.lookup(3)) - num(rect.lookup(1))) < 0.01;
        const ap = look(dict, 'AP');
        if (!zero && !(ap instanceof PDFDict && ap.has(N('N')))) issues.add('campi o annotazioni senza aspetto');
      }
    }
  }
  // colori CMYK impostati direttamente nel contenuto delle pagine
  if (!issues.has('colori CMYK')) {
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFStream)) continue;
      const d = obj.dict;
      const isContent = !d.has(N('Subtype')) && !d.has(N('Type')) && !d.has(N('N')) && !d.has(N('Length1')) && !d.has(N('Length2'));
      const isForm = nameOf(d.lookup(N('Subtype'))) === 'Form';
      if (!isContent && !isForm) continue;
      const bytes = decoded(obj);
      if (!bytes || bytes.length > 8e6) continue;
      const s = latin.decode(bytes);
      if (/(^|[\s\]])(-?[\d.]+\s+){4}[kK](?=[\s\n\r]|$)/.test(s) || /\/DeviceCMYK\s+(cs|CS)\b/.test(s)) { issues.add('colori CMYK'); break; }
    }
  }
  const cat = doc.catalog;
  if (part === 1 && cat.has(N('OCProperties'))) issues.add('livelli');
  const af = look(cat, 'AcroForm');
  if (af instanceof PDFDict && af.has(N('XFA'))) issues.add('moduli XFA');
  return [...issues];
}

/* ---------------- Pulizia delle parti vietate ---------------- */
function cleanup(doc, part) {
  const ctx = doc.context;
  const cat = doc.catalog;
  const notes = new Set();
  // JavaScript e azioni automatiche
  const names = look(cat, 'Names');
  if (names instanceof PDFDict) {
    if (names.has(N('JavaScript'))) { names.delete(N('JavaScript')); notes.add('script rimossi'); }
    if (names.has(N('EmbeddedFiles'))) { names.delete(N('EmbeddedFiles')); notes.add('allegati rimossi'); }
  }
  for (const k of ['AA', 'Perms', 'Requirements', 'Collection', 'NeedsRendering']) cat.delete(N(k));
  if (part === 1) cat.delete(N('OCProperties'));
  cat.delete(N('Version'));
  cat.delete(N('OpenAction'));
  const af = look(cat, 'AcroForm');
  if (af instanceof PDFDict) { af.delete(N('XFA')); af.delete(N('NeedAppearances')); }
  const forbiddenActions = ['Launch', 'Sound', 'Movie', 'ResetForm', 'ImportData', 'JavaScript', 'Hide', 'SetOCGState', 'Rendition', 'Trans', 'GoTo3DView'];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
    if (!dict) continue;
    const type = nameOf(dict.lookup(N('Type')));
    const sub = nameOf(dict.lookup(N('Subtype')));
    if (type === 'Page') { dict.delete(N('AA')); if (part === 1) { dict.delete(N('Tabs')); dict.delete(N('Group')); } }
    if (sub === 'Image') {
      dict.delete(N('Interpolate'));
      dict.delete(N('Alternates'));
      dict.delete(N('OPI'));
    }
    if (sub === 'Form') { dict.delete(N('OPI')); dict.delete(N('Ref')); }
    if (type === 'Action' || (dict.has(N('S')) && forbiddenActions.includes(nameOf(dict.lookup(N('S')))))) {
      if (forbiddenActions.includes(nameOf(dict.lookup(N('S'))))) { dict.set(N('S'), N('GoTo')); dict.set(N('D'), ctx.obj([doc.getPage(0).ref, N('Fit')])); dict.delete(N('JS')); }
    }
    if (dict.has(N('Rect')) && dict.has(N('Subtype')) && (type === 'Annot' || dict.has(N('P')) || dict.has(N('AP')) || ['Link', 'Widget', 'Popup'].includes(sub))) {
      dict.delete(N('AA'));
      if (['FileAttachment', 'Sound', 'Movie', 'Screen', '3D', 'RichMedia'].includes(sub)) { dict.set(N('F'), PDFNumber.of(4)); continue; }
      // stampa attiva, niente annotazioni nascoste
      let f = num(dict.lookup(N('F'))) || 0;
      f = (f | 4) & ~(1 | 2 | 32 | 256);
      dict.set(N('F'), PDFNumber.of(f));
      if (dict.has(N('CA')) && part === 1) dict.delete(N('CA'));
    }
  }
  // annotazioni non ammesse tolte dalle pagine
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const keep = annots.asArray().filter((r) => {
      const a = ctx.lookup(r);
      return !(a instanceof PDFDict && ['FileAttachment', 'Sound', 'Movie', 'Screen', '3D', 'RichMedia'].includes(nameOf(a.lookup(N('Subtype')))));
    });
    if (keep.length !== annots.size()) { notes.add('allegati e contenuti multimediali rimossi'); page.node.set(N('Annots'), ctx.obj(keep)); }
  }
  return [...notes];
}

/* ---------------- Metadati XMP, profilo colore, identificativo ---------------- */
async function finalize(doc, part, srcInfo, titleFallback) {
  const ctx = doc.context;
  const now = new Date();
  const created = srcInfo.created || now;
  const info = {
    Title: srcInfo.Title || titleFallback,
    Author: srcInfo.Author,
    Subject: srcInfo.Subject,
    Keywords: srcInfo.Keywords,
    Creator: srcInfo.Creator || 'MULTIPEPPINS',
    Producer: 'MULTIPEPPINS (pdf-lib)',
  };
  const infoDict = ctx.obj({});
  for (const [k, v] of Object.entries(info)) if (v) infoDict.set(N(k), PDFHexString.fromText(v));
  infoDict.set(N('CreationDate'), PDFString.of(pdfDate(created)));
  infoDict.set(N('ModDate'), PDFString.of(pdfDate(now)));
  ctx.trailerInfo.Info = ctx.register(infoDict);

  const li = (v) => `<rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(v)}</rdf:li></rdf:Alt>`;
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdfaid:part>${part}</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
   <dc:format>application/pdf</dc:format>
${info.Title ? `   <dc:title>${li(info.Title)}</dc:title>\n` : ''}${info.Author ? `   <dc:creator><rdf:Seq><rdf:li>${xmlEsc(info.Author)}</rdf:li></rdf:Seq></dc:creator>\n` : ''}${info.Subject ? `   <dc:description>${li(info.Subject)}</dc:description>\n` : ''}${info.Keywords ? `   <pdf:Keywords>${xmlEsc(info.Keywords)}</pdf:Keywords>\n` : ''}   <xmp:CreatorTool>${xmlEsc(info.Creator)}</xmp:CreatorTool>
   <xmp:CreateDate>${xmpDate(created)}</xmp:CreateDate>
   <xmp:ModifyDate>${xmpDate(now)}</xmp:ModifyDate>
   <xmp:MetadataDate>${xmpDate(now)}</xmp:MetadataDate>
   <pdf:Producer>${xmlEsc(info.Producer)}</pdf:Producer>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const meta = ctx.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(N('Metadata'), ctx.register(meta));

  const icc = ctx.flateStream(await srgbProfile(), { N: 3 });
  const intent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    RegistryName: PDFString.of('http://www.color.org'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: ctx.register(icc),
  });
  doc.catalog.set(N('OutputIntents'), ctx.obj([ctx.register(intent)]));
  const id = randomHex();
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id), PDFHexString.of(id)]);
}

function readInfo(doc) {
  const out = {};
  try {
    const ref = doc.context.trailerInfo.Info;
    const info = ref ? doc.context.lookup(ref) : null;
    if (info instanceof PDFDict) {
      for (const k of ['Title', 'Author', 'Subject', 'Keywords', 'Creator']) {
        const t = textOf(info.lookup(N(k)));
        if (t && t.trim()) out[k] = t.trim();
      }
      const cd = textOf(info.lookup(N('CreationDate')));
      const m = cd && cd.match(/D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
      if (m) {
        const d = new Date(Date.UTC(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0));
        if (!isNaN(d) && d.getUTCFullYear() > 1980 && d <= new Date()) out.created = d;
      }
    }
  } catch {}
  return out;
}

/* ---------------- Modalità "immagine": pagine ridisegnate, testo invisibile ricercabile ---------------- */
async function rebuildAsImages(file, { dpi, ocrMode, lang, progress }) {
  const out = await PDFDocument.create({ updateMetadata: false });
  const fontRef = embedGlyphless(out);
  const ocr = ocrMode ? lazyOcr(lang, (t) => progress(null, t)) : null;
  let ocrPages = 0;
  try {
    for (let n = 1; n <= file.pages; n++) {
      progress(0.05 + 0.85 * ((n - 1) / file.pages), `Pagina ${n} di ${file.pages}`);
      const pg = await file.pdf.getPage(n);
      const vp = pg.getViewport({ scale: 1, rotation: pg.rotate });
      const { canvas } = await renderPage(file.pdf, n, safeScale(vp.width, vp.height, dpi / 72));
      const jpg = await canvasToBytes(canvas, 'image/jpeg', 0.88);
      canvas.width = canvas.height = 1;
      const page = out.addPage([vp.width, vp.height]);
      page.drawImage(await out.embedJpg(jpg), { x: 0, y: 0, width: vp.width, height: vp.height });
      let { lines } = await pageLines(file.pdf, n);
      if (ocr && lines.map((l) => l.text).join('').replace(/\s/g, '').length < 15) {
        progress(null, `Pagina ${n}: riconoscimento del testo (OCR)…`);
        lines = (await ocrPdfPage(await ocr.get(), file.pdf, n)).lines;
        ocrPages++;
      }
      // testo invisibile sopra l'immagine: il PDF resta ricercabile e copiabile
      drawInvisibleText(page, fontRef, lines.flatMap((l) => l.items), vp.height);
    }
  } finally { ocr && ocr.end(); }
  return { doc: out, ocrPages };
}

export async function convertPdfA(file, { part = 2, mode = 'auto', dpi = 200, ocr = false, lang = 'ita', progress }) {
  progress(0.02, 'Analisi del documento…');
  const src = await loadPdfLib(file.bytes);
  const srcInfo = readInfo(src);
  const title = file.name.replace(/\.pdf$/i, '');
  let issues = analyze(src, part);
  let useImages = mode === 'image' || (mode === 'auto' && issues.length > 0);
  let doc, notes = [], ocrPages = 0;
  if (useImages) {
    const r = await rebuildAsImages(file, { dpi, ocrMode: ocr, lang, progress });
    doc = r.doc;
    ocrPages = r.ocrPages;
  } else {
    doc = src;
    notes = cleanup(doc, part);
  }
  progress(0.93, 'Metadati e profilo colore…');
  await finalize(doc, part, srcInfo, title);
  const bytes = await savePdf(doc, { objectStreams: part !== 1, updateFieldAppearances: false });
  // pdf-lib scrive sempre %PDF-1.7: per PDF/A-1 l'intestazione deve dire 1.4 (stessa lunghezza, offset invariati)
  if (part === 1 && bytes[5] === 0x31 && bytes[6] === 0x2e) bytes[7] = 0x34;
  return { bytes, rebuilt: useImages, issues, notes, ocrPages };
}
