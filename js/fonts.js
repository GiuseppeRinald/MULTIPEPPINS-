// MULTIPEPPINS — caratteri: i 3 standard del PDF + caratteri liberi incorporati (equivalenti di Arial, Times New Roman, Calibri…)
import { PDFLib, toWinAnsi } from './core.js';

const { StandardFonts, PDFFont, CustomFontEmbedder, PDFHexString, PDFString } = PDFLib;
const BASE = new URL('../vendor/fonts/', import.meta.url).href;

// key → etichetta, file (se incorporato), famiglia CSS per l'anteprima
export const FONTS = [
  { key: 'Helvetica', label: 'Helvetica', std: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'], css: 'Helvetica, Arial, sans-serif' },
  { key: 'Times', label: 'Times', std: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'], css: 'Times, "Times New Roman", serif' },
  { key: 'Courier', label: 'Courier', std: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'], css: 'Courier, "Courier New", monospace' },
  { key: 'arial', label: 'Arial', css: 'sans-serif' },
  { key: 'times-new-roman', label: 'Times New Roman', css: 'serif' },
  { key: 'courier-new', label: 'Courier New', css: 'monospace' },
  { key: 'calibri', label: 'Calibri', css: 'sans-serif' },
  { key: 'cambria', label: 'Cambria', css: 'serif' },
  { key: 'dejavu-sans', label: 'DejaVu Sans', css: 'sans-serif' },
  { key: 'dejavu-serif', label: 'DejaVu Serif', css: 'serif' },
  { key: 'poppins', label: 'Poppins', css: 'sans-serif' },
];
export const FONT_OPTIONS = FONTS.map((f) => ({ value: f.key, label: f.label }));
const byKey = (k) => FONTS.find((f) => f.key === k) || FONTS[0];
const variantIdx = (bold, italic) => (bold ? 1 : 0) + (italic ? 2 : 0);

/* ---------------- Anteprima nel browser ---------------- */
const faces = new Map();
// famiglia CSS da usare nell'anteprima (carica il carattere se serve)
export function fontCss(key, bold, italic) {
  const f = byKey(key);
  if (f.std) return f.css;
  const fam = `mp-${f.key}-${variantIdx(bold, italic)}`;
  if (!faces.has(fam) && typeof FontFace !== 'undefined') {
    const face = new FontFace(fam, `url(${BASE}${f.key}-${variantIdx(bold, italic)}.ttf)`);
    faces.set(fam, face.load().then((ff) => { document.fonts.add(ff); return ff; }).catch(() => null));
  }
  return `"${fam}", ${f.css}`;
}
export function fontReady(key, bold, italic) {
  fontCss(key, bold, italic);
  return faces.get(`mp-${byKey(key).key}-${variantIdx(bold, italic)}`) || Promise.resolve();
}

/* ---------------- Incorporazione nel PDF ---------------- */
let metaP = null;
const fileCache = new Map();
async function meta() {
  if (!metaP) metaP = fetch(BASE + 'fonts.json').then((r) => { if (!r.ok) throw new Error(); return r.json(); }).catch(() => { metaP = null; throw new Error('Non riesco a caricare i caratteri. Controlla la connessione e riprova.'); });
  return metaP;
}
async function fileBytes(name) {
  if (!fileCache.has(name)) fileCache.set(name, fetch(BASE + name).then(async (r) => { if (!r.ok) throw new Error('Carattere non trovato: ' + name); return new Uint8Array(await r.arrayBuffer()); }));
  return fileCache.get(name);
}

// TrueType incorporato come CIDFontType2 / Identity-H (supporta accenti, €, lettere dell'Europa dell'Est…)
function makeEmbedder(m, bytes, baseName) {
  const cmap = new Map(m.cmap);
  const used = new Map(); // gid → testo
  const fallback = cmap.get(0x3f) || 0;
  const emb = Object.create(CustomFontEmbedder.prototype);
  Object.assign(emb, {
    fontName: baseName,
    customName: undefined,
    font: { characterSet: m.cmap.map((c) => c[0]) },
    encoding: { supportedCodePoints: m.cmap.map((c) => c[0]) },
    gids(text) {
      const out = [];
      for (const ch of String(text)) {
        const cp = ch.codePointAt(0);
        let g = cmap.get(cp);
        if (g == null) {
          const alt = toWinAnsi(ch);
          g = cmap.get(alt.codePointAt(0)) ?? fallback;
        }
        if (!used.has(g)) used.set(g, ch);
        out.push(g);
      }
      return out;
    },
    encodeText(text) {
      return PDFHexString.of(this.gids(text).map((g) => g.toString(16).padStart(4, '0')).join(''));
    },
    widthOfTextAtSize(text, size) {
      let w = 0;
      for (const g of this.gids(text)) w += m.w[g] || 0;
      return (w * size) / 1000;
    },
    heightOfFontAtSize(size, opts = {}) {
      const desc = opts.descender === false ? 0 : m.desc;
      return ((m.asc - desc) * size) / 1000;
    },
    sizeOfFontAtHeight(h) {
      return (1000 * h) / (m.asc - m.desc);
    },
    async embedIntoContext(context, ref) {
      const file = context.register(context.flateStream(bytes, { Length1: bytes.length }));
      const flags = (m.fixed ? 1 : 0) | (m.serif ? 2 : 0) | 32 | (m.ital ? 64 : 0);
      const desc = context.register(context.obj({
        Type: 'FontDescriptor', FontName: baseName, Flags: flags, FontBBox: m.bbox, ItalicAngle: m.ital,
        Ascent: m.asc, Descent: m.desc, CapHeight: m.cap, StemV: 80, FontFile2: file,
      }));
      const gids = [...used.keys()].sort((a, b) => a - b);
      const W = [];
      for (const g of gids) W.push(g, [m.w[g] || 0]);
      const cid = context.register(context.obj({
        Type: 'Font', Subtype: 'CIDFontType2', BaseFont: baseName,
        CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
        FontDescriptor: desc, W, DW: 1000, CIDToGIDMap: 'Identity',
      }));
      // ToUnicode: il testo resta copiabile e ricercabile
      const hex = (s) => [...s].map((c) => { const cp = c.codePointAt(0); return cp > 0xffff ? String.fromCharCode(...[0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)]).split('').map((u) => u.charCodeAt(0).toString(16).padStart(4, '0')).join('') : cp.toString(16).padStart(4, '0'); }).join('');
      let body = '';
      for (let i = 0; i < gids.length; i += 100) {
        const part = gids.slice(i, i + 100);
        body += `${part.length} beginbfchar\n${part.map((g) => `<${g.toString(16).padStart(4, '0')}> <${hex(used.get(g))}>`).join('\n')}\nendbfchar\n`;
      }
      const cmapTxt = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${body}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
      const toUni = context.register(context.flateStream(new TextEncoder().encode(cmapTxt)));
      context.assign(ref, context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: baseName, Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: toUni }));
    },
  });
  return emb;
}

const docFonts = new WeakMap();
// Restituisce un PDFFont utilizzabile con page.drawText
export async function embedFont(doc, key, bold = false, italic = false) {
  let cache = docFonts.get(doc);
  if (!cache) { cache = new Map(); docFonts.set(doc, cache); }
  const f = byKey(key);
  const k = `${f.key}-${variantIdx(bold, italic)}`;
  if (cache.has(k)) return cache.get(k);
  let p;
  if (f.std) p = doc.embedFont(StandardFonts[f.std[variantIdx(bold, italic)]]);
  else {
    p = (async () => {
      const all = await meta();
      const name = `${k}.ttf`;
      const m = all[name];
      const bytes = await fileBytes(name);
      // nome con prefisso di sottoinsieme, come richiesto per i caratteri parziali
      const tag = Array.from({ length: 6 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
      const base = `${tag}+${(m.ps || f.label).replace(/[^A-Za-z0-9-]/g, '')}`;
      const ref = doc.context.nextRef();
      const font = PDFFont.of(ref, doc, makeEmbedder(m, bytes, base));
      doc.fonts.push(font);
      return font;
    })();
  }
  cache.set(k, p);
  return p;
}

// Testo pronto per il carattere: i caratteri standard accettano solo l'alfabeto WinAnsi
export function textFor(font, text) {
  return font && font.embedder instanceof CustomFontEmbedder && font.embedder.gids ? String(text) : toWinAnsi(String(text));
}
export const isEmbeddedFont = (key) => !byKey(key).std;
