// MULTIPEPPINS — strumenti della fase 2: PDF/A, PowerPoint in PDF, Workflow
import { convertPdfA } from './pdfa.js';
import { OCR_LANGS } from './ocr.js';
import { pdfOut, outName } from './helpers.js';
import { savePdf, openPdfJs } from './core.js';
import { el, icon, toast, renderOptions } from './ui.js';
import { TOOLS } from './tools.js';
import { pptxToPdf } from './pptx.js';

export const PDFA_TOOL = {
  id: 'pdf-in-pdfa', cat: 'da', icon: 'pdfa', name: 'PDF in PDF/A', isNew: true,
  desc: 'Converti il PDF in PDF/A, il formato per l\'archiviazione a lungo termine richiesto da enti e conservazione digitale.',
  keywords: 'pdfa pdf/a archivio conservazione sostitutiva iso 19005 pa pec tribunale',
  multiple: true, action: 'Converti in PDF/A', working: 'Conversione in PDF/A',
  options: [
    { key: 'part', type: 'seg', label: 'Versione', default: 2, options: [{ value: 1, label: 'PDF/A-1b' }, { value: 2, label: 'PDF/A-2b' }, { value: 3, label: 'PDF/A-3b' }],
      help: 'PDF/A-2b va bene quasi sempre. Scegli PDF/A-1b solo se te lo chiedono espressamente.' },
    { key: 'mode', type: 'radio', label: 'Metodo', default: 'auto', options: [
      { value: 'auto', label: 'Automatico (consigliato)', desc: 'Mantiene il documento com\'è; se contiene elementi non ammessi (es. caratteri non incorporati) ridisegna le pagine' },
      { value: 'image', label: 'Ridisegna sempre le pagine', desc: 'Massima compatibilità: aspetto identico e testo ricercabile, ma file più pesante' },
    ] },
    { key: 'dpi', type: 'seg', label: 'Qualità delle pagine ridisegnate', default: 200, options: [{ value: 150, label: 'Normale' }, { value: 200, label: 'Alta' }, { value: 300, label: 'Massima' }] },
    { key: 'ocr', type: 'checkbox', label: 'Riconosci il testo delle pagine scansionate (OCR)', default: false },
    { key: 'lang', type: 'select', label: 'Lingua del documento', default: 'ita', options: OCR_LANGS, showIf: (v) => v.ocr },
    { type: 'note', tone: 'info', text: 'Script, allegati e azioni automatiche vengono tolti perché il PDF/A non li ammette.' },
  ],
  async run({ files, opts, progress }) {
    const outputs = [];
    const lines = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const sub = (a, b) => (frac, t) => progress(frac == null ? null : (i + frac) / files.length, (files.length > 1 ? f.name + ': ' : '') + (t || ''));
      const r = await convertPdfA(f, { part: +opts.part, mode: opts.mode, dpi: +opts.dpi, ocr: !!opts.ocr, lang: opts.lang, progress: sub() });
      outputs.push(pdfOut(outName(f, `PDFA-${opts.part}b`), r.bytes));
      if (r.rebuilt && opts.mode === 'auto') lines.push(`${files.length > 1 ? f.name + ': ' : ''}pagine ridisegnate per: ${r.issues.join(', ')}`);
      if (r.notes.length) lines.push(`${files.length > 1 ? f.name + ': ' : ''}${r.notes.join(', ')}`);
      if (r.ocrPages) lines.push(`${r.ocrPages} ${r.ocrPages === 1 ? 'pagina riconosciuta' : 'pagine riconosciute'} con l'OCR`);
    }
    return { outputs, zipName: 'pdfa.zip', title: outputs.length > 1 ? 'I tuoi PDF/A sono pronti!' : 'Il tuo PDF/A è pronto!', stats: [`PDF/A-${opts.part}b`, ...lines].join(' · ') };
  },
};

export const PPTX_TOOL = {
  id: 'powerpoint-in-pdf', cat: 'in', icon: 'ppt', name: 'PowerPoint in PDF', isNew: true,
  desc: 'Converti presentazioni PowerPoint (PPTX) in PDF, una slide per pagina.',
  keywords: 'pptx ppt slide presentazione powerpoint converti',
  accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation', multiple: true,
  pickLabel: 'Seleziona le presentazioni', action: 'Converti in PDF', working: 'Conversione delle slide',
  options: [
    { key: 'hidden', type: 'checkbox', label: 'Includi le slide nascoste', default: false },
    { type: 'note', text: 'Testi, elenchi, forme, immagini e tabelle vengono convertiti; animazioni, grafici ed effetti speciali possono risultare semplificati. I vecchi file .ppt vanno prima salvati come .pptx.' },
  ],
  async run({ files, opts, progress }) {
    const outputs = [];
    const warn = [];
    let total = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const r = await pptxToPdf(f.bytes, { hidden: !!opts.hidden, progress: (fr, t) => progress((i + fr) / files.length, (files.length > 1 ? f.name + ': ' : '') + t) });
      total += r.slides;
      outputs.push(pdfOut(outName(f, ''), await savePdf(r.pdf)));
      if (r.notes.charts) warn.push(`${r.notes.charts} ${r.notes.charts === 1 ? 'grafico o SmartArt' : 'grafici o SmartArt'} senza anteprima`);
      if (r.notes.images) warn.push(`${r.notes.images} ${r.notes.images === 1 ? 'immagine in formato non supportato' : 'immagini in formato non supportato'}`);
      if (r.notes.hiddenSkipped) warn.push(`${r.notes.hiddenSkipped} ${r.notes.hiddenSkipped === 1 ? 'slide nascosta esclusa' : 'slide nascoste escluse'}`);
    }
    return { outputs, zipName: 'powerpoint_in_pdf.zip', stats: [`${total} ${total === 1 ? 'slide' : 'slide'}`, ...warn].join(' · ') };
  },
};


/* ======================================================================
   WORKFLOW: più strumenti in sequenza sugli stessi file
   ====================================================================== */
const WF_KEY = 'multipeppins_workflows';
const WF_EXCLUDE = ['workflow', 'confronta-pdf'];
const PRESETS = [
  { name: 'Unisci, numera e comprimi', steps: [{ id: 'unisci-pdf' }, { id: 'numeri-pagina' }, { id: 'comprimi-pdf' }] },
  { name: 'Scansioni: OCR e PDF/A', steps: [{ id: 'ocr-pdf' }, { id: 'pdf-in-pdfa' }] },
  { name: 'Filigrana e protezione', steps: [{ id: 'filigrana' }, { id: 'proteggi-pdf' }] },
];
function wfTools() {
  return TOOLS.filter((t) => !t.stage && !t.noFiles && !WF_EXCLUDE.includes(t.id) && !t.maxFiles && (!t.accept || /pdf/.test(t.accept)));
}
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(WF_KEY) || '[]'); } catch { return []; }
}
function storeSaved(list) {
  try { localStorage.setItem(WF_KEY, JSON.stringify(list)); return true; } catch { return false; }
}
function schemaFor(tool, files) {
  const ctx = { files: files || [], opts: {}, tool };
  try { return typeof tool.options === 'function' ? tool.options(ctx) : tool.options || []; } catch { return []; }
}
function fillDefaults(schema, opts) {
  for (const f of schema) if (f.key && opts[f.key] === undefined && f.default !== undefined) opts[f.key] = typeof f.default === 'function' ? f.default() : f.default;
  return opts;
}
// passaggi senza dati sensibili da salvare (niente password)
const storable = (steps) => steps.map((s) => ({ id: s.id, opts: Object.fromEntries(Object.entries(s.opts || {}).filter(([k, v]) => !/password|pw/i.test(k) && typeof v !== 'object')) }));

function workflowBuilder(ctx, values, set) {
  if (!values.steps) values.steps = [];
  const box = el('div', { class: 'wf' });
  const tools = wfTools();
  const draw = () => {
    box.innerHTML = '';
    // workflow salvati e pronti
    const saved = loadSaved();
    const load = el('select', { class: 'sel' },
      el('option', { value: '' }, 'Carica un workflow…'),
      el('optgroup', { label: 'Pronti all\'uso' }, PRESETS.map((p, i) => el('option', { value: 'p' + i }, p.name))),
      saved.length ? el('optgroup', { label: 'I tuoi workflow' }, saved.map((p, i) => el('option', { value: 's' + i }, p.name))) : null,
    );
    load.addEventListener('change', () => {
      const v = load.value;
      if (!v) return;
      const src = v[0] === 'p' ? PRESETS[+v.slice(1)] : saved[+v.slice(1)];
      values.steps = src.steps.filter((s) => tools.some((t) => t.id === s.id)).map((s) => ({ id: s.id, opts: { ...(s.opts || {}) } }));
      set('steps', values.steps);
      draw();
    });
    box.append(el('div', { class: 'field' }, load));
    if (!values.steps.length) box.append(el('div', { class: 'note info' }, 'Aggiungi i passaggi nell\'ordine in cui vuoi applicarli. Il risultato di ogni passaggio passa al successivo.'));
    values.steps.forEach((step, i) => {
      const tool = tools.find((t) => t.id === step.id);
      if (!tool) return;
      const optBox = el('div', { class: 'wf-opts' + (step.open ? '' : ' hidden') });
      const head = el('div', { class: 'wf-head' },
        el('span', { class: 'wf-num' }, String(i + 1)),
        el('b', {}, tool.name),
        el('span', { class: 'spacer' }),
        el('button', { class: 'mini', type: 'button', title: 'Opzioni', onclick: () => { step.open = !step.open; optBox.classList.toggle('hidden', !step.open); } }, icon('edit')),
        el('button', { class: 'mini', type: 'button', title: 'Su', disabled: i === 0, onclick: () => { [values.steps[i - 1], values.steps[i]] = [values.steps[i], values.steps[i - 1]]; draw(); } }, icon('up')),
        el('button', { class: 'mini', type: 'button', title: 'Rimuovi', onclick: () => { values.steps.splice(i, 1); set('steps', values.steps); draw(); } }, icon('close')),
      );
      step.opts = step.opts || {};
      const schema = schemaFor(tool, ctx.files);
      renderOptions(optBox, schema, step.opts);
      fillDefaults(schema, step.opts);
      box.append(el('div', { class: 'wf-step' }, head, optBox));
    });
    // aggiungi passaggio
    const add = el('select', { class: 'sel' }, el('option', { value: '' }, '+ Aggiungi un passaggio…'), tools.map((t) => el('option', { value: t.id }, t.name)));
    add.addEventListener('change', () => {
      if (!add.value) return;
      values.steps.push({ id: add.value, opts: {}, open: false });
      set('steps', values.steps);
      draw();
    });
    box.append(el('div', { class: 'field' }, add));
    if (values.steps.length) {
      const name = el('input', { class: 'inp', placeholder: 'Nome del workflow', value: values.wfName || '' });
      name.addEventListener('input', () => { values.wfName = name.value; });
      box.append(el('div', { class: 'field wf-save' }, name, el('button', { class: 'btn-sec', type: 'button', onclick: () => {
        const n = (name.value || '').trim();
        if (!n) { toast('Dai un nome al workflow', true); return; }
        const list = loadSaved().filter((w) => w.name !== n);
        list.push({ name: n, steps: storable(values.steps) });
        const ok = storeSaved(list);
        toast(ok ? `Workflow "${n}" salvato su questo dispositivo` : 'Impossibile salvare su questo browser', !ok);
        draw();
      } }, icon('download', 16), 'Salva')));
      if (saved.length) box.append(el('button', { class: 'chip', type: 'button', onclick: () => { const n = (name.value || '').trim(); const list = loadSaved().filter((w) => w.name !== n); storeSaved(list); toast(n ? `"${n}" eliminato` : 'Scrivi il nome del workflow da eliminare'); draw(); } }, icon('trash', 14), 'Elimina workflow salvato con questo nome'));
    }
  };
  draw();
  return box;
}

async function toEntries(outputs) {
  const list = [];
  for (const o of outputs) {
    const bytes = o.data instanceof Blob ? new Uint8Array(await o.data.arrayBuffer()) : o.data;
    const e = { id: Math.random(), name: o.name, size: bytes.length, type: o.mime, bytes, isPdf: /\.pdf$/i.test(o.name), file: new File([bytes], o.name, { type: o.mime }) };
    if (e.isPdf) { e.pdf = await openPdfJs(bytes); e.pages = e.pdf.numPages; }
    list.push(e);
  }
  return list;
}

export const WORKFLOW_TOOL = {
  id: 'workflow', cat: 'altro', icon: 'flow', name: 'Workflow', isNew: true,
  desc: 'Metti in fila più strumenti e applicali in un colpo solo (es. unisci → numeri di pagina → comprimi). Puoi salvarli e riusarli.',
  keywords: 'automazione sequenza catena batch flusso ripeti',
  multiple: true, orderMatters: true, action: 'Avvia il workflow', working: 'Workflow in corso',
  options: (ctx) => [{ key: 'steps', type: 'custom', render: (v, set) => workflowBuilder(ctx, v, set) }],
  validate: (o) => (!o.steps || !o.steps.length ? 'Aggiungi almeno un passaggio.' : null),
  async run({ files, opts, progress }) {
    let cur = files;
    let last = null;
    const names = [];
    const steps = opts.steps;
    for (let i = 0; i < steps.length; i++) {
      const tool = TOOLS.find((t) => t.id === steps[i].id);
      names.push(tool.name);
      const sOpts = fillDefaults(schemaFor(tool, cur), { ...steps[i].opts });
      const nonPdf = cur.filter((f) => !f.isPdf);
      if (nonPdf.length) throw new Error(`Il passaggio ${i} produce file non PDF (${nonPdf[0].name}): mettilo come ultimo passaggio.`);
      const sub = (fr, t) => progress(fr == null ? null : (i + Math.max(0, Math.min(1, fr))) / steps.length, `Passaggio ${i + 1} di ${steps.length} · ${tool.name}${t ? ': ' + t : ''}`);
      sub(0);
      if (tool.minFiles && cur.length < tool.minFiles) throw new Error(`"${tool.name}" ha bisogno di almeno ${tool.minFiles} file: ne arrivano ${cur.length}.`);
      // gli strumenti a file singolo vengono applicati a ogni file
      const groups = tool.multiple ? [cur] : cur.map((f) => [f]);
      const outputs = [];
      for (let g = 0; g < groups.length; g++) {
        const msg = tool.validate ? tool.validate(sOpts, groups[g], null) : null;
        if (msg) throw new Error(`${tool.name}: ${msg}`);
        const r = await tool.run({ files: groups[g], opts: sOpts, stageCtl: null, progress: (fr, t) => sub(fr == null ? null : (g + (fr || 0)) / groups.length, t) });
        outputs.push(...((r && r.outputs) || []));
        last = r;
      }
      if (!outputs.length) throw new Error(`"${tool.name}" non ha prodotto nessun file.`);
      for (const f of cur) if (f.pdf && !files.includes(f)) try { f.pdf.destroy(); } catch {}
      if (i < steps.length - 1) cur = await toEntries(outputs);
      else last = { ...last, outputs };
    }
    return { outputs: last.outputs, zipName: 'workflow.zip', stats: names.join(' → '), title: last.outputs.length > 1 ? 'I tuoi file sono pronti!' : 'Il tuo file è pronto!' };
  },
};

export const PHASE2_TOOLS = [PDFA_TOOL, PPTX_TOOL, WORKFLOW_TOOL];
