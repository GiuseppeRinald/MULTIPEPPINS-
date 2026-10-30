// MULTIPEPPINS — guscio dell'applicazione: home, pagina strumento, risultati
import { openPdfJs, renderPage, readBytes, fmtSize, saveFile, makeZip, baseName } from './core.js';
import { decryptPdf } from './crypto.js';
import { el, icon, toast, modal, askPassword, progressOverlay, renderOptions } from './ui.js';
import { TOOLS, CATS } from './tools.js';

const app = document.getElementById('app');
const state = { tool: null, files: [], opts: {}, stageCtl: null, cat: 'all', query: '' };
let fileSeq = 0;

/* ================= Navigazione ================= */
function route() {
  const id = decodeURIComponent(location.hash.slice(1));
  const tool = TOOLS.find((t) => t.id === id);
  if (tool) openTool(tool);
  else renderHome();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
function go(id) {
  if (location.hash.slice(1) === id) route();
  else location.hash = id;
}
function goHome() {
  if (location.hash) {
    try { history.pushState(null, '', location.pathname + location.search); } catch { location.hash = ''; }
  }
  state.tool = null;
  renderHome();
  window.scrollTo(0, 0);
}

function topbar(withSearch) {
  const bar = el('header', { class: 'topbar' },
    el('button', { class: 'logo', onclick: goHome, 'aria-label': 'Home' }, el('span', { class: 'logo-mark' }, 'M'), el('span', {}, 'MULTI', el('b', {}, 'PEPPINS'))),
    el('div', { class: 'spacer' }),
  );
  if (withSearch) {
    const inp = el('input', { placeholder: 'Cerca uno strumento…', value: state.query });
    inp.addEventListener('input', () => { state.query = inp.value; renderGrid(); });
    bar.append(el('div', { class: 'top-search' }, icon('search', 16), inp));
  }
  return bar;
}

/* ================= Home ================= */
let gridEl;
function renderHome() {
  state.tool = null;
  cleanupFiles();
  app.innerHTML = '';
  const mobileInp = el('input', { placeholder: 'Cerca uno strumento…', value: state.query });
  mobileInp.addEventListener('input', () => { state.query = mobileInp.value; renderGrid(); });
  const cats = el('div', { class: 'cats' });
  const mkCat = (id, label) => {
    const b = el('button', { class: 'cat-btn' + (state.cat === id ? ' active' : '') }, label);
    b.addEventListener('click', () => { state.cat = id; cats.querySelectorAll('.cat-btn').forEach((x) => x.classList.remove('active')); b.classList.add('active'); renderGrid(); });
    return b;
  };
  cats.append(mkCat('all', 'Tutti'));
  for (const c of CATS) cats.append(mkCat(c.id, c.label));
  gridEl = el('div', { class: 'grid' });
  app.append(
    topbar(true),
    el('section', { class: 'hero' },
      el('h1', {}, 'Tutti gli strumenti PDF ', el('span', {}, 'in un posto solo')),
      el('p', {}, 'Unisci, dividi, comprimi, converti, firma, proteggi e modifica i tuoi PDF. Gratis e senza registrazione.'),
      el('div', { class: 'privacy-pill' }, icon('shield', 16), 'I file restano sul tuo dispositivo: niente viene caricato su server'),
    ),
    el('div', { class: 'mobile-search' }, mobileInp),
    cats,
    gridEl,
    el('footer', {}, 'MULTIPEPPINS · fatto per gli amici di Giuseppe'),
  );
  renderGrid();
}
function renderGrid() {
  if (!gridEl) return;
  gridEl.innerHTML = '';
  const q = state.query.trim().toLowerCase();
  const list = TOOLS.filter((t) => (state.cat === 'all' || t.cat === state.cat) && (!q || (t.name + ' ' + t.desc + ' ' + (t.keywords || '')).toLowerCase().includes(q)));
  if (!list.length) { gridEl.append(el('div', { class: 'empty-search' }, 'Nessuno strumento trovato.')); return; }
  const showTitles = state.cat === 'all' && !q;
  for (const c of CATS) {
    const items = list.filter((t) => t.cat === c.id);
    if (!items.length) continue;
    if (showTitles) gridEl.append(el('div', { class: 'cat-title' }, c.label));
    for (const t of items) gridEl.append(toolCard(t));
  }
}
function toolCard(t) {
  const cat = CATS.find((c) => c.id === t.cat);
  return el('button', { class: 'tool-card', onclick: () => go(t.id) },
    el('div', { class: 'ticon', style: { background: cat.color } }, icon(t.icon)),
    el('h3', {}, t.name, t.isNew ? el('span', { class: 'tag-new' }, 'NUOVO') : null),
    el('p', {}, t.desc),
  );
}

/* ================= Pagina strumento ================= */
function openTool(tool, preset) {
  cleanupFiles();
  state.tool = tool;
  state.files = [];
  state.opts = {};
  state.stageCtl = null;
  if (preset && preset.length) {
    addFiles(preset);
    return;
  }
  if (tool.noFiles) { renderWorkspace(); return; }
  renderPicker();
}

function fileInput(multiple, onFiles) {
  const tool = state.tool;
  const inp = el('input', { type: 'file', accept: tool.accept || 'application/pdf,.pdf', multiple: multiple ? true : null, style: { display: 'none' } });
  if (tool.capture) inp.setAttribute('capture', 'environment');
  inp.addEventListener('change', () => { if (inp.files.length) onFiles([...inp.files]); inp.value = ''; });
  document.body.append(inp);
  setTimeout(() => inp.remove(), 120000);
  return inp;
}

function renderPicker() {
  const tool = state.tool;
  app.innerHTML = '';
  const pickLabel = tool.pickLabel || (tool.accept && !/pdf/.test(tool.accept) ? 'Seleziona i file' : (tool.multiple ? 'Seleziona i file PDF' : 'Seleziona il file PDF'));
  const inner = el('div', { class: 'drop-inner' },
    el('button', { class: 'btn-pick', onclick: () => fileInput(tool.multiple, addFiles).click() }, pickLabel),
    el('div', { class: 'drop-hint' }, 'oppure trascina qui i file'),
    tool.capture ? el('div', { style: { marginTop: '14px' } }, el('button', { class: 'btn-sec', onclick: () => { const i = fileInput(true, addFiles); i.setAttribute('capture', 'environment'); i.click(); } }, icon('scan', 16), 'Scatta una foto')) : null,
  );
  wireDrop(inner, addFiles);
  app.append(
    topbar(false),
    el('div', { style: { padding: '10px 12px 0' } }, el('button', { class: 'back-link', onclick: goHome }, icon('back', 16), 'Tutti gli strumenti')),
    el('div', { class: 'tool-head' }, el('h1', {}, tool.name), el('p', {}, tool.longDesc || tool.desc)),
    el('div', { class: 'dropzone' }, inner),
  );
}

function wireDrop(node, cb) {
  node.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); node.classList.add('over'); } });
  node.addEventListener('dragleave', () => node.classList.remove('over'));
  node.addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    node.classList.remove('over');
    cb([...e.dataTransfer.files]);
  });
}

function acceptsFile(tool, f) {
  const acc = (tool.accept || 'application/pdf,.pdf').split(',').map((s) => s.trim().toLowerCase());
  const name = f.name.toLowerCase();
  const type = (f.type || '').toLowerCase();
  return acc.some((a) => (a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a));
}

async function addFiles(list) {
  const tool = state.tool;
  const ok = list.filter((f) => acceptsFile(tool, f));
  if (ok.length < list.length) toast(list.length - ok.length === 1 ? 'Un file non è del tipo giusto ed è stato ignorato.' : `${list.length - ok.length} file non sono del tipo giusto e sono stati ignorati.`, true);
  if (!ok.length) return;
  let toAdd = tool.multiple ? ok : ok.slice(0, 1);
  if (tool.maxFiles) toAdd = toAdd.slice(0, Math.max(0, tool.maxFiles - state.files.length));
  if (!tool.multiple) { cleanupFiles(); state.files = []; }
  const prog = toAdd.length > 2 ? progressOverlay('Caricamento file') : null;
  try {
    let i = 0;
    for (const f of toAdd) {
      prog && prog.set(i / toAdd.length, f.name);
      const entry = { id: ++fileSeq, file: f, name: f.name, size: f.size, type: f.type, bytes: await readBytes(f), isPdf: /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name) };
      if (entry.isPdf) {
        const okEntry = await preparePdf(entry);
        if (!okEntry) continue;
      }
      state.files.push(entry);
      i++;
    }
  } catch (e) {
    toast(e.message || String(e), true);
  } finally {
    prog && prog.close();
  }
  if (!state.files.length) { renderPicker(); return; }
  renderWorkspace();
}

// Apre il PDF con pdf.js; se è protetto chiede la password e lo sblocca
async function preparePdf(entry) {
  try {
    entry.pdf = await openPdfJs(entry.bytes);
    entry.pages = entry.pdf.numPages;
    return true;
  } catch (e) {
    if (e && e.name === 'PasswordException') {
      if (state.tool.rawInput) {
        entry.locked = true;
        entry.pages = null;
        return true;
      }
      let msg = `"${entry.name}" è protetto da password. Inseriscila per continuare.`;
      for (;;) {
        const pw = await askPassword(msg);
        if (pw == null) return false;
        try {
          const r = await decryptPdf(entry.bytes, pw);
          entry.bytes = r.bytes;
          entry.pdf = await openPdfJs(entry.bytes);
          entry.pages = entry.pdf.numPages;
          entry.unlocked = true;
          toast('PDF sbloccato');
          return true;
        } catch (err) {
          if (err.code === 'password') { msg = 'Password errata. Riprova.'; continue; }
          toast('Impossibile sbloccare: ' + err.message, true);
          return false;
        }
      }
    }
    toast(`"${entry.name}" non si apre: ${e.message || e}`, true);
    return false;
  }
}

function cleanupFiles() {
  for (const f of state.files || []) { try { f.pdf && f.pdf.destroy(); } catch {} }
  if (state.stageCtl && state.stageCtl.destroy) try { state.stageCtl.destroy(); } catch {}
}

function renderWorkspace() {
  const tool = state.tool;
  app.innerHTML = '';
  const stage = el('div', { class: 'stage' });
  const sideBody = el('div', { class: 'side-body' });
  const btn = el('button', { class: 'btn-main' }, tool.action || tool.name, icon('right', 18));
  btn.addEventListener('click', () => run());
  const side = el('aside', { class: 'side' },
    el('div', { class: 'side-head' }, el('h2', {}, tool.name)),
    sideBody,
    el('div', { class: 'side-foot' }, btn),
  );
  app.append(topbar(false), el('div', { class: 'workspace' }, stage, side));
  wireDrop(stage, (fs) => addFiles(fs));

  const ctx = makeCtx(stage, sideBody, btn);
  if (tool.stage) state.stageCtl = tool.stage(ctx) || null;
  else renderFileCards(ctx);
  const schema = typeof tool.options === 'function' ? tool.options(ctx) : tool.options || [];
  if (tool.sideIntro) sideBody.append(el('div', { class: 'note info' }, tool.sideIntro));
  const optBox = el('div');
  sideBody.append(optBox);
  renderOptions(optBox, schema, state.opts, (k, v) => { state.stageCtl && state.stageCtl.onOption && state.stageCtl.onOption(k, v); });
  if (tool.minFiles && state.files.length < tool.minFiles) {
    sideBody.prepend(el('div', { class: 'note' }, tool.minFilesMsg || `Aggiungi almeno ${tool.minFiles} file.`));
  }
}

function makeCtx(stage, sideBody, btn) {
  return {
    tool: state.tool,
    get files() { return state.files; },
    opts: state.opts,
    stage,
    sideBody,
    actionButton: btn,
    stageCtlRef: () => state.stageCtl,
    addMore: () => fileInput(state.tool.multiple, addFiles).click(),
    rerender: renderWorkspace,
    removeFile: (id) => { state.files = state.files.filter((f) => f.id !== id); state.files.length || state.tool.noFiles ? renderWorkspace() : renderPicker(); },
  };
}

function renderFileCards(ctx) {
  const tool = state.tool;
  const wrap = el('div', { class: 'files' });
  const many = state.files.length > 1 && tool.multiple;
  if (tool.orderMatters && many) {
    const sortBar = el('div', { class: 'pages-toolbar', style: { width: '100%' } },
      el('span', { style: { fontSize: '13px', color: 'var(--ink-3)', fontWeight: 600 } }, 'Ordine:'),
      el('button', { class: 'chip', onclick: () => { state.files.sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true })); renderWorkspace(); } }, 'A → Z'),
      el('button', { class: 'chip', onclick: () => { state.files.sort((a, b) => b.name.localeCompare(a.name, 'it', { numeric: true })); renderWorkspace(); } }, 'Z → A'),
      el('button', { class: 'chip', onclick: () => { state.files.reverse(); renderWorkspace(); } }, 'Inverti'),
    );
    ctx.stage.append(sortBar);
  }
  state.files.forEach((f, idx) => {
    const thumb = el('div', { class: 'thumb' });
    const card = el('div', { class: 'fcard', draggable: tool.orderMatters ? 'true' : null, 'data-id': f.id },
      thumb,
      el('div', { class: 'fname', title: f.name }, f.name),
      el('div', { class: 'fmeta' }, fmtSize(f.size) + (f.pages ? ` · ${f.pages} ${f.pages === 1 ? 'pagina' : 'pagine'}` : '') + (f.locked ? ' · protetto' : '')),
      el('div', { class: 'fbtns' }, el('button', { class: 'mini', title: 'Rimuovi', onclick: () => ctx.removeFile(f.id) }, icon('close'))),
    );
    if (tool.orderMatters && many) {
      card.append(el('div', { class: 'order' }, String(idx + 1)));
      card.append(el('div', { class: 'movebar' },
        el('button', { class: 'mini', title: 'Sposta a sinistra', disabled: idx === 0, onclick: () => moveFile(idx, -1) }, icon('left')),
        el('button', { class: 'mini', title: 'Sposta a destra', disabled: idx === state.files.length - 1, onclick: () => moveFile(idx, 1) }, icon('right')),
      ));
      card.addEventListener('dragstart', (e) => { card.classList.add('dragging'); e.dataTransfer.setData('text/x-file', String(f.id)); e.dataTransfer.effectAllowed = 'move'; });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-file')) { e.preventDefault(); card.classList.add('drop-before'); } });
      card.addEventListener('dragleave', () => card.classList.remove('drop-before'));
      card.addEventListener('drop', (e) => {
        const from = +e.dataTransfer.getData('text/x-file');
        if (!from) return;
        e.preventDefault();
        e.stopPropagation();
        const a = state.files.findIndex((x) => x.id === from);
        const item = state.files.splice(a, 1)[0];
        const b = state.files.findIndex((x) => x.id === f.id);
        state.files.splice(b, 0, item);
        renderWorkspace();
      });
    }
    wrap.append(card);
    makeThumb(f, thumb);
  });
  if (tool.multiple && (!tool.maxFiles || state.files.length < tool.maxFiles)) {
    wrap.append(el('button', { class: 'add-more', onclick: ctx.addMore }, icon('plus', 28), 'Aggiungi file'));
  }
  ctx.stage.append(wrap);
}
function moveFile(idx, d) {
  const j = idx + d;
  if (j < 0 || j >= state.files.length) return;
  [state.files[idx], state.files[j]] = [state.files[j], state.files[idx]];
  renderWorkspace();
}

async function makeThumb(f, holder) {
  try {
    if (f.thumbUrl) { holder.append(el('img', { src: f.thumbUrl, alt: '' })); return; }
    if (f.isPdf && f.pdf) {
      const first = await f.pdf.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      const { canvas } = await renderPage(f.pdf, 1, Math.min(2, 300 / Math.max(vp.width, vp.height)));
      f.thumbUrl = canvas.toDataURL('image/jpeg', 0.8);
    } else if (/^image\//.test(f.type) || /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name)) {
      f.thumbUrl = URL.createObjectURL(f.file);
    } else {
      holder.append(el('div', { style: { color: 'var(--ink-3)', textAlign: 'center', fontWeight: 800 } }, icon('page', 46), el('div', {}, (f.name.split('.').pop() || '').toUpperCase())));
      return;
    }
    holder.append(el('img', { src: f.thumbUrl, alt: '' }));
  } catch {
    holder.append(icon(f.locked ? 'lock' : 'page', 40));
  }
}

/* ================= Esecuzione ================= */
async function run() {
  const tool = state.tool;
  if (tool.minFiles && state.files.length < tool.minFiles) { toast(tool.minFilesMsg || `Aggiungi almeno ${tool.minFiles} file.`, true); return; }
  if (!tool.noFiles && !state.files.length) { toast('Aggiungi almeno un file.', true); return; }
  if (tool.validate) {
    const msg = tool.validate(state.opts, state.files, state.stageCtl);
    if (msg) { toast(msg, true); return; }
  }
  const prog = progressOverlay(tool.working || 'Elaborazione in corso');
  const ctx = {
    files: state.files,
    opts: state.opts,
    stageCtl: state.stageCtl,
    progress: (f, t) => prog.set(f, t),
  };
  let result;
  try {
    result = await runWithUnlock(tool, ctx);
  } catch (e) {
    prog.close();
    console.error(e);
    toast(e.message || String(e), true);
    return;
  }
  prog.close();
  if (!result) return;
  renderResult(result);
}

async function runWithUnlock(tool, ctx) {
  try {
    return await tool.run(ctx);
  } catch (e) {
    if (e.code !== 'encrypted' || tool.rawInput) throw e;
    // PDF con sola password del proprietario: lo sblocchiamo in automatico
    for (const f of state.files) {
      if (!f.isPdf) continue;
      try {
        const r = await decryptPdf(f.bytes, '');
        if (r.wasEncrypted) { f.bytes = r.bytes; f.unlocked = true; }
      } catch (err) {
        if (err.code === 'password') throw new Error(`"${f.name}" è protetto da password: usa "Sblocca PDF".`);
        throw err;
      }
    }
    return tool.run(ctx);
  }
}

function renderResult(result) {
  const tool = state.tool;
  app.innerHTML = '';
  const outs = result.outputs || [];
  const box = el('div', { class: 'result' });
  box.append(el('div', { class: 'done-ic' }, icon('check', 34)));
  box.append(el('h1', {}, result.title || doneTitle(tool, outs)));
  if (result.stats) box.append(el('div', { class: 'stats' }, result.stats));
  if (result.view) box.append(result.view);

  const dlOne = async (o) => {
    try {
      const st = await saveFile(o.name, o.data, o.mime);
      if (st === 'declined') toast('Download annullato');
    } catch (e) { toast(e.message, true); }
  };
  const dlAll = async () => {
    try {
      const zip = makeZip(await Promise.all(outs.map(async (o) => ({ name: o.name, bytes: o.data instanceof Blob ? new Uint8Array(await o.data.arrayBuffer()) : o.data }))));
      const st = await saveFile(baseName(result.zipName || tool.zipName || 'multipeppins') + '.zip', zip, 'application/zip');
      if (st === 'declined') toast('Download annullato');
    } catch (e) { toast(e.message, true); }
  };
  if (outs.length === 1) {
    box.append(el('button', { class: 'big-dl', onclick: () => dlOne(outs[0]) }, icon('download', 22), 'Scarica ' + extLabel(outs[0].name)));
  } else if (outs.length > 1) {
    box.append(el('button', { class: 'big-dl', onclick: dlAll }, icon('zip', 22), `Scarica tutto (${outs.length} file, ZIP)`));
  }
  if (outs.length) {
    const list = el('div', { class: 'out-list' });
    for (const o of outs) {
      const size = o.data instanceof Blob ? o.data.size : o.data.length;
      list.append(el('div', { class: 'out-item' },
        el('div', { class: 'ticon', style: { width: '36px', height: '36px', background: 'var(--brand-soft)', color: 'var(--brand)' } }, icon(/\.pdf$/i.test(o.name) ? 'page' : /\.(jpe?g|png)$/i.test(o.name) ? 'image' : 'page')),
        el('div', { class: 'n' }, el('b', {}, o.name), el('small', {}, fmtSize(size))),
        el('button', { class: 'btn-sec', onclick: () => dlOne(o) }, icon('download', 16), 'Scarica'),
      ));
    }
    box.append(list);
  }
  box.append(el('div', { class: 'after' },
    el('button', { class: 'btn-sec', onclick: () => openTool(tool) }, icon('rotl', 16), 'Ricomincia'),
    el('button', { class: 'btn-sec', onclick: goHome }, icon('organize', 16), 'Tutti gli strumenti'),
  ));
  const pdfOuts = outs.filter((o) => /\.pdf$/i.test(o.name));
  if (pdfOuts.length) {
    const chips = el('div', { class: 'chips' });
    const next = TOOLS.filter((t) => t.id !== tool.id && !t.noFiles && (!t.accept || /pdf/.test(t.accept)) && (t.multiple || pdfOuts.length === 1)).slice(0, 40);
    const preferred = ['comprimi-pdf', 'unisci-pdf', 'proteggi-pdf', 'firma-pdf', 'numeri-pagina', 'filigrana', 'organizza-pdf', 'ruota-pdf', 'dividi-pdf', 'pdf-in-jpg', 'modifica-pdf'];
    next.sort((a, b) => (preferred.indexOf(a.id) + 1 || 99) - (preferred.indexOf(b.id) + 1 || 99));
    for (const t of next.slice(0, 8)) {
      chips.append(el('button', { class: 'chip', onclick: () => continueWith(t, pdfOuts) }, icon(t.icon, 14), t.name));
    }
    box.append(el('div', { class: 'continue' }, el('h3', {}, 'Continua con…'), chips));
  }
  app.append(topbar(false), box);
  window.scrollTo(0, 0);
}
function extLabel(name) {
  const ext = (name.split('.').pop() || '').toUpperCase();
  return ext === 'ZIP' ? 'ZIP' : ext || 'file';
}
function doneTitle(tool, outs) {
  return tool.doneTitle || (outs.length > 1 ? 'I tuoi file sono pronti!' : 'Il tuo file è pronto!');
}
function continueWith(t, outs) {
  const files = outs.map((o) => new File([o.data], o.name, { type: 'application/pdf' }));
  try { history.pushState(null, '', '#' + t.id); } catch {}
  openTool(t, files);
}

route();
