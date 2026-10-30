// MULTIPEPPINS — editor visuale delle pagine: testo, immagini, forme, disegno, firme, censura
import { PDFLib, renderPage, toWinAnsi, hexToRgb, loadPdfLib, savePdf, canvasToBytes, readBytes } from './core.js';
import { el, icon, toast, modal } from './ui.js';

const { degrees, StandardFonts, rgb } = PDFLib;
const FONT_CSS = { Helvetica: 'Helvetica, Arial, sans-serif', Times: '"Times New Roman", Times, serif', Courier: '"Courier New", Courier, monospace' };
const FONT_STD = {
  Helvetica: ['Helvetica', 'HelveticaBold'],
  Times: ['TimesRoman', 'TimesRomanBold'],
  Courier: ['Courier', 'CourierBold'],
};
let SIGNATURES = []; // firme create in questa sessione: [{url, bytes}]

export function createEditor(ctx, { mode = 'edit' } = {}) {
  const file = ctx.files[0];
  const pdf = file.pdf;
  const pages = []; // {num, vp1, rot, node, layer, svg, items:[]}
  const undo = [];
  let tool = mode === 'redact' ? 'redact' : 'select';
  let selected = null;
  let pending = null; // immagine/firma da posizionare
  const defaults = { textSize: 14, textColor: '#1d1b2c', font: 'Helvetica', bold: false, rectColor: '#3b5bdb', rectOpacity: 0.35, drawColor: '#1c39bb', drawWidth: 2, hlColor: '#ffe066' };

  /* ---------- Barra strumenti ---------- */
  const toolsBar = el('div', { class: 'ed-tools' });
  const props = el('div', { class: 'ed-props' });
  const toolBtns = {};
  const addTool = (id, label, ic, onPick) => {
    const b = el('button', { class: 'ed-tool', type: 'button' }, icon(ic), label);
    b.addEventListener('click', () => (onPick ? onPick() : setTool(id)));
    toolBtns[id] = b;
    toolsBar.append(b);
  };
  const imgInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  imgInput.addEventListener('change', async () => {
    const f = imgInput.files[0];
    imgInput.value = '';
    if (!f) return;
    const prepared = await prepareImage(f);
    pending = { kind: 'image', ...prepared };
    setTool('place');
    toast('Tocca la pagina dove vuoi inserire l\'immagine');
  });

  if (mode === 'edit') {
    addTool('select', 'Seleziona', 'cursor');
    addTool('text', 'Testo', 'text');
    addTool('image', 'Immagine', 'image', () => imgInput.click());
    addTool('rect', 'Forma', 'square');
    addTool('whiteout', 'Bianchetto', 'square');
    addTool('hl', 'Evidenzia', 'hl');
    addTool('draw', 'Disegna', 'pen');
  } else if (mode === 'sign') {
    addTool('select', 'Seleziona', 'cursor');
    addTool('signature', 'Firma', 'sign', () => signatureDialog((sig) => { pending = { kind: 'image', ...sig, isSig: true }; setTool('place'); toast('Tocca la pagina dove vuoi la firma'); }));
    addTool('initials', 'Iniziali', 'sign', () => signatureDialog((sig) => { pending = { kind: 'image', ...sig, isSig: true, small: true }; setTool('place'); toast('Tocca la pagina dove vuoi le iniziali'); }, true));
    addTool('date', 'Data', 'calendar', () => { pending = { kind: 'text', text: new Date().toLocaleDateString('it-IT') }; setTool('place'); toast('Tocca dove inserire la data'); });
    addTool('text', 'Testo', 'text');
    addTool('image', 'Timbro/immagine', 'image', () => imgInput.click());
  } else {
    addTool('select', 'Seleziona', 'cursor');
    addTool('redact', 'Area da oscurare', 'redact');
  }
  const undoBtn = el('button', { class: 'ed-tool', type: 'button', onclick: () => doUndo() }, icon('rotl'), 'Annulla');
  toolsBar.append(undoBtn, imgInput);

  function setTool(t) {
    tool = t;
    Object.entries(toolBtns).forEach(([k, b]) => b.classList.toggle('on', k === t || (t === 'place' && pending && ((pending.isSig && k === 'signature') || (!pending.isSig && pending.kind === 'image' && k === 'image')))));
    pages.forEach((p) => { p.node.className = 'ed-page mode-' + (t === 'whiteout' ? 'rect' : t); });
    if (t !== 'select') select(null);
    renderProps();
  }

  /* ---------- Proprietà ---------- */
  function renderProps() {
    props.innerHTML = '';
    const it = selected;
    const kind = it ? it.type : { text: 'text', rect: 'rect', whiteout: 'rect', hl: 'hl', draw: 'draw' }[tool];
    if (!kind) { props.append(el('span', { style: { color: 'var(--ink-3)' } }, hintFor())); return; }
    const target = it || defaults;
    const num = (label, key, min, max, step = 1) => {
      const i = el('input', { class: 'inp', type: 'number', min, max, step, value: target[key] });
      i.addEventListener('input', () => { target[key] = +i.value || min; if (it) refreshItem(it); });
      props.append(el('label', {}, label + ' '), i);
    };
    const color = (label, key) => {
      const i = el('input', { type: 'color', value: target[key] });
      i.addEventListener('input', () => { target[key] = i.value; if (it) refreshItem(it); });
      props.append(el('label', {}, label + ' '), i);
    };
    if (kind === 'text') {
      const f = el('select', { class: 'sel' }, Object.keys(FONT_CSS).map((k) => el('option', { value: k, selected: target.font === k }, k)));
      f.addEventListener('change', () => { target.font = f.value; if (it) refreshItem(it); });
      props.append(f);
      num('Dim.', it ? 'size' : 'textSize', 4, 200);
      color('Colore', it ? 'color' : 'textColor');
      const b = el('input', { type: 'checkbox', checked: !!target.bold });
      b.addEventListener('change', () => { target.bold = b.checked; if (it) refreshItem(it); });
      props.append(el('label', { class: 'check', style: { margin: 0 } }, b, 'Grassetto'));
    } else if (kind === 'rect') {
      color('Colore', it ? 'color' : 'rectColor');
      if (!it || it.type === 'rect') {
        const r = el('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: it ? it.opacity : defaults.rectOpacity, style: { width: '110px' } });
        r.addEventListener('input', () => { if (it) { it.opacity = +r.value; refreshItem(it); } else defaults.rectOpacity = +r.value; });
        props.append(el('label', {}, 'Opacità '), r);
      }
    } else if (kind === 'hl') {
      color('Colore', it ? 'color' : 'hlColor');
    } else if (kind === 'draw') {
      color('Colore', it ? 'color' : 'drawColor');
      num('Spessore', it ? 'width' : 'drawWidth', 0.5, 20, 0.5);
    } else if (kind === 'image') {
      props.append(el('span', { style: { color: 'var(--ink-3)' } }, 'Trascina per spostare, usa il pallino per ridimensionare.'));
    } else if (kind === 'redact') {
      props.append(el('span', { style: { color: 'var(--ink-3)' } }, 'Trascina sulla pagina per coprire ciò che vuoi nascondere.'));
    }
    if (it) props.append(el('button', { class: 'btn-sec', style: { padding: '6px 10px' }, onclick: () => removeItem(it) }, icon('trash', 14), 'Elimina'));
  }
  function hintFor() {
    if (mode === 'sign') return 'Crea la tua firma con "Firma", poi tocca il punto del documento dove inserirla.';
    if (mode === 'redact') return 'Trascina sulle pagine per oscurare, oppure cerca un testo a destra.';
    return 'Scegli uno strumento e tocca la pagina. Tocca un elemento per modificarlo.';
  }

  /* ---------- Pagine ---------- */
  const pagesWrap = el('div', { class: 'ed-pages' });
  const wrap = el('div', { class: 'ed-wrap' }, toolsBar, props, pagesWrap);
  ctx.stage.append(wrap);
  const io = new IntersectionObserver((ens) => ens.forEach((en) => { if (en.isIntersecting) { const p = en.target.__p; io.unobserve(en.target); paintPage(p); } }), { rootMargin: '600px' });

  const displayWidth = () => Math.min(900, Math.max(260, ctx.stage.clientWidth - 30));
  (async () => {
    for (let n = 1; n <= pdf.numPages; n++) {
      const pg = await pdf.getPage(n);
      const vp1 = pg.getViewport({ scale: 1 });
      const p = { num: n, vp1, rot: pg.rotate, items: [] };
      const layer = el('div', { class: 'ed-layer' });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `0 0 ${vp1.width} ${vp1.height}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      const node = el('div', { class: 'ed-page mode-' + tool }, el('span', { class: 'lbl' }, `Pagina ${n}`), svg, layer);
      p.node = node; p.layer = layer; p.svg = svg;
      node.__p = p;
      sizePage(p);
      pagesWrap.append(node);
      pages.push(p);
      wireLayer(p);
      io.observe(node);
    }
    setTool(tool);
  })();
  function sizePage(p) {
    const w = displayWidth();
    p.node.style.width = w + 'px';
    p.node.style.height = (w * p.vp1.height) / p.vp1.width + 'px';
    p.pxPerPt = w / p.vp1.width;
  }
  async function paintPage(p) {
    const scale = Math.min(3, (displayWidth() * (window.devicePixelRatio || 1)) / p.vp1.width);
    const { canvas } = await renderPage(pdf, p.num, scale);
    canvas.className = 'bg';
    p.node.insertBefore(canvas, p.node.firstChild.nextSibling);
  }
  const onResize = () => { pages.forEach((p) => { sizePage(p); p.items.forEach(refreshItem); }); };
  window.addEventListener('resize', onResize);

  /* ---------- Interazione sulla pagina ---------- */
  function rel(p, e) {
    const r = p.layer.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }
  function wireLayer(p) {
    p.layer.addEventListener('pointerdown', (e) => {
      if (e.target !== p.layer) return;
      const pt = rel(p, e);
      if (tool === 'select') { select(null); return; }
      if (tool === 'text') {
        const it = addItem(p, { type: 'text', x: pt.x, y: pt.y, text: 'Testo', size: defaults.textSize, color: defaults.textColor, font: defaults.font, bold: defaults.bold });
        setTool('select');
        select(it);
        startEditing(it, true);
        return;
      }
      if (tool === 'place' && pending) {
        if (pending.kind === 'text') {
          const it = addItem(p, { type: 'text', x: pt.x, y: pt.y, text: pending.text, size: defaults.textSize, color: defaults.textColor, font: defaults.font, bold: false });
          pending = null; setTool('select'); select(it); return;
        }
        const wPt = Math.min(p.vp1.width * 0.6, pending.small ? 70 : pending.isSig ? 170 : 200);
        const wF = wPt / p.vp1.width;
        const hF = (wPt * (pending.h / pending.w)) / p.vp1.height;
        const it = addItem(p, { type: 'image', x: Math.max(0, pt.x - wF / 2), y: Math.max(0, pt.y - hF / 2), w: wF, h: hF, url: pending.url, bytes: pending.bytes, mime: pending.mime, ratio: pending.h / pending.w });
        pending = null; setTool('select'); select(it); return;
      }
      if (['rect', 'whiteout', 'hl', 'redact'].includes(tool)) {
        e.preventDefault();
        p.layer.setPointerCapture(e.pointerId);
        const type = tool === 'hl' ? 'hl' : tool === 'redact' ? 'redact' : 'rect';
        const it = addItem(p, { type, x: pt.x, y: pt.y, w: 0.001, h: 0.001, color: tool === 'whiteout' ? '#ffffff' : tool === 'hl' ? defaults.hlColor : defaults.rectColor, opacity: tool === 'rect' ? defaults.rectOpacity : 1 });
        if (tool === 'rect' && defaults.rectColor === '#ffffff' && defaults.rectOpacity === 1) { it.border = true; }
        const start = pt;
        const mv = (ev) => { const q = rel(p, ev); it.x = Math.min(start.x, q.x); it.y = Math.min(start.y, q.y); it.w = Math.abs(q.x - start.x); it.h = Math.abs(q.y - start.y); refreshItem(it); };
        const up = () => {
          p.layer.removeEventListener('pointermove', mv);
          p.layer.removeEventListener('pointerup', up);
          p.layer.removeEventListener('pointercancel', up);
          if (it.w < 0.005 || it.h < 0.003) removeItem(it, true);
        };
        p.layer.addEventListener('pointermove', mv);
        p.layer.addEventListener('pointerup', up);
        p.layer.addEventListener('pointercancel', up);
        return;
      }
      if (tool === 'draw') {
        e.preventDefault();
        p.layer.setPointerCapture(e.pointerId);
        const it = addItem(p, { type: 'draw', points: [[pt.x, pt.y]], color: defaults.drawColor, width: defaults.drawWidth });
        const mv = (ev) => { const q = rel(p, ev); it.points.push([q.x, q.y]); refreshItem(it); };
        const up = () => {
          p.layer.removeEventListener('pointermove', mv);
          p.layer.removeEventListener('pointerup', up);
          p.layer.removeEventListener('pointercancel', up);
          if (it.points.length < 2) it.points.push([pt.x + 0.002, pt.y]);
          refreshItem(it);
        };
        p.layer.addEventListener('pointermove', mv);
        p.layer.addEventListener('pointerup', up);
        p.layer.addEventListener('pointercancel', up);
      }
    });
  }

  /* ---------- Elementi ---------- */
  function addItem(p, it, silent) {
    it.page = p;
    p.items.push(it);
    if (!silent) undo.push(it);
    buildItem(it);
    return it;
  }
  function removeItem(it, silent) {
    const p = it.page;
    p.items = p.items.filter((x) => x !== it);
    it.node && it.node.remove();
    it.path && it.path.remove();
    if (selected === it) select(null);
    if (!silent) { const i = undo.indexOf(it); if (i >= 0) undo.splice(i, 1); }
  }
  function doUndo() {
    const it = undo.pop();
    if (it) removeItem(it, true);
    else toast('Niente da annullare');
  }
  function select(it) {
    if (selected && selected.node) { selected.node.classList.remove('sel'); stopEditing(selected); }
    selected = it;
    if (it && it.node) it.node.classList.add('sel');
    renderProps();
  }
  function buildItem(it) {
    const p = it.page;
    if (it.type === 'draw') {
      const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      pl.setAttribute('fill', 'none');
      pl.setAttribute('stroke-linecap', 'round');
      pl.setAttribute('stroke-linejoin', 'round');
      p.svg.append(pl);
      it.path = pl;
      refreshItem(it);
      return;
    }
    const node = el('div', { class: 'ed-item ' + (it.type === 'text' ? 't' : it.type === 'image' ? 'i' : 'r') });
    if (it.type === 'text') {
      const ed = el('div', { contenteditable: 'false', spellcheck: 'false' });
      ed.textContent = it.text;
      ed.addEventListener('input', () => { it.text = ed.innerText.replace(/\n$/, ''); });
      ed.addEventListener('dblclick', () => startEditing(it, false));
      node.append(ed);
      it.ed = ed;
    } else if (it.type === 'image') {
      node.append(el('img', { src: it.url, alt: '' }));
    }
    const x = el('button', { class: 'x', type: 'button', onclick: (e) => { e.stopPropagation(); removeItem(it); } }, '×');
    const h = el('span', { class: 'h' });
    node.append(x);
    if (it.type !== 'text') node.append(h);
    p.layer.append(node);
    it.node = node;
    // trascinamento
    node.addEventListener('pointerdown', (e) => {
      if (e.target === x) return;
      if (it.editing) return;
      e.stopPropagation();
      e.preventDefault();
      if (selected === it && it.type === 'text' && e.detail >= 2) { startEditing(it, false); return; }
      select(it);
      const resizing = e.target === h;
      const start = rel(p, e);
      const orig = { x: it.x, y: it.y, w: it.w, h: it.h };
      let moved = false;
      node.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const q = rel(p, ev);
        const dx = q.x - start.x, dy = q.y - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.003) moved = true;
        if (resizing) {
          it.w = Math.max(0.01, orig.w + dx);
          it.h = it.type === 'image' ? (it.w * p.vp1.width * it.ratio) / p.vp1.height : Math.max(0.005, orig.h + dy);
        } else {
          it.x = Math.min(1 - 0.01, Math.max(-0.5, orig.x + dx));
          it.y = Math.min(1 - 0.01, Math.max(-0.5, orig.y + dy));
        }
        refreshItem(it);
      };
      const up = () => {
        node.removeEventListener('pointermove', mv);
        node.removeEventListener('pointerup', up);
        node.removeEventListener('pointercancel', up);
        if (!moved && it.type === 'text' && it.wasSelected) startEditing(it, false);
        it.wasSelected = true;
      };
      node.addEventListener('pointermove', mv);
      node.addEventListener('pointerup', up);
      node.addEventListener('pointercancel', up);
    });
    refreshItem(it);
  }
  function startEditing(it, selectAll) {
    if (it.type !== 'text') return;
    it.editing = true;
    it.node.classList.add('editing');
    it.ed.setAttribute('contenteditable', 'true');
    it.ed.focus();
    if (selectAll) {
      const r = document.createRange();
      r.selectNodeContents(it.ed);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  }
  function stopEditing(it) {
    if (!it.editing) return;
    it.editing = false;
    it.wasSelected = false;
    it.node.classList.remove('editing');
    it.ed.setAttribute('contenteditable', 'false');
    it.text = it.ed.innerText.replace(/\n$/, '');
    if (!it.text.trim()) removeItem(it);
  }
  function refreshItem(it) {
    const p = it.page;
    if (it.type === 'draw') {
      it.path.setAttribute('points', it.points.map(([x, y]) => `${x * p.vp1.width},${y * p.vp1.height}`).join(' '));
      it.path.setAttribute('stroke', it.color);
      it.path.setAttribute('stroke-width', it.width);
      return;
    }
    const n = it.node;
    n.style.left = it.x * 100 + '%';
    n.style.top = it.y * 100 + '%';
    if (it.type === 'text') {
      Object.assign(it.ed.style, { fontSize: it.size * p.pxPerPt + 'px', color: it.color, fontFamily: FONT_CSS[it.font], fontWeight: it.bold ? '700' : '400' });
      n.style.width = n.style.height = '';
      return;
    }
    n.style.width = it.w * 100 + '%';
    n.style.height = it.h * 100 + '%';
    if (it.type === 'rect') { n.style.background = it.color; n.style.opacity = it.opacity; n.style.outline = it.border ? '1px solid #999' : ''; }
    if (it.type === 'hl') { n.style.background = it.color; n.style.opacity = 0.45; n.style.mixBlendMode = 'multiply'; }
    if (it.type === 'redact') { n.style.background = '#000'; }
  }

  /* ---------- Firma ---------- */
  function signatureDialog(onReady, initials) {
    const tabs = el('div', { class: 'seg', style: { marginBottom: '12px' } });
    const body = el('div');
    let current = 'draw';
    let color = '#1c2b8f';
    let produce = null;
    const colors = el('div', { style: { display: 'flex', gap: '8px', margin: '10px 0' } });
    for (const c of ['#1c2b8f', '#111111', '#c92a2a']) {
      const b = el('button', { type: 'button', style: { width: '30px', height: '30px', borderRadius: '50%', border: '3px solid #fff', boxShadow: '0 0 0 2px ' + (c === color ? 'var(--brand)' : 'var(--line)'), background: c } });
      b.addEventListener('click', () => { color = c; [...colors.children].forEach((x) => (x.style.boxShadow = '0 0 0 2px var(--line)')); b.style.boxShadow = '0 0 0 2px var(--brand)'; show(current); });
      colors.append(b);
    }
    const show = (t) => {
      current = t;
      [...tabs.children].forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      body.innerHTML = '';
      if (t === 'draw') {
        const c = el('canvas', { class: 'sigpad' });
        body.append(c, colors, el('button', { class: 'btn-sec', type: 'button', onclick: () => show('draw') }, 'Cancella'));
        requestAnimationFrame(() => {
          const r = c.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          c.width = r.width * dpr; c.height = r.height * dpr;
          const g = c.getContext('2d');
          g.scale(dpr, dpr);
          g.lineCap = g.lineJoin = 'round';
          g.strokeStyle = color;
          g.lineWidth = 2.6;
          let drawing = false, last = null, any = false;
          c.addEventListener('pointerdown', (e) => { drawing = true; any = true; c.setPointerCapture(e.pointerId); const rr = c.getBoundingClientRect(); last = [e.clientX - rr.left, e.clientY - rr.top]; g.beginPath(); g.arc(last[0], last[1], 1.2, 0, Math.PI * 2); g.fillStyle = color; g.fill(); });
          c.addEventListener('pointermove', (e) => { if (!drawing) return; const rr = c.getBoundingClientRect(); const pt = [e.clientX - rr.left, e.clientY - rr.top]; g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(pt[0], pt[1]); g.stroke(); last = pt; });
          const end = () => { drawing = false; };
          c.addEventListener('pointerup', end);
          c.addEventListener('pointercancel', end);
          produce = () => (any ? trimCanvas(c) : null);
        });
      } else if (t === 'type') {
        const inp = el('input', { class: 'inp', placeholder: initials ? 'Le tue iniziali' : 'Nome e cognome', value: '' });
        const styleSel = el('div', { class: 'opts', style: { marginTop: '10px' } });
        const fontsList = ['"Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive', '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive', 'Georgia, "Times New Roman", serif'];
        let fi = 0;
        const renderStyles = () => {
          styleSel.innerHTML = '';
          fontsList.forEach((ff, i) => {
            const b = el('label', { class: 'opt' + (i === fi ? ' on' : ''), style: { fontFamily: ff, fontSize: '26px', color, fontStyle: i === 2 ? 'italic' : 'normal' } }, inp.value || (initials ? 'G.R.' : 'Giuseppe Rossi'));
            b.addEventListener('click', () => { fi = i; renderStyles(); });
            styleSel.append(b);
          });
        };
        inp.addEventListener('input', renderStyles);
        renderStyles();
        body.append(inp, colors, styleSel);
        produce = () => {
          const txt = inp.value.trim();
          if (!txt) return null;
          const c = document.createElement('canvas');
          const g = c.getContext('2d');
          const font = `${fi === 2 ? 'italic ' : ''}96px ${fontsList[fi]}`;
          g.font = font;
          const w = Math.ceil(g.measureText(txt).width) + 40;
          c.width = w; c.height = 150;
          g.font = font;
          g.fillStyle = color;
          g.textBaseline = 'middle';
          g.fillText(txt, 20, 78);
          return trimCanvas(c);
        };
        setTimeout(() => inp.focus(), 50);
      } else {
        const up = el('input', { type: 'file', accept: 'image/*' });
        const rm = el('input', { type: 'checkbox', checked: true });
        const prev = el('div', { style: { marginTop: '10px' } });
        let img = null;
        up.addEventListener('change', async () => {
          const f = up.files[0];
          if (!f) return;
          img = await createImageBitmap(f);
          prev.innerHTML = '';
          prev.append(el('div', { class: 'help' }, 'Immagine caricata.'));
        });
        body.append(up, el('label', { class: 'check' }, rm, 'Rendi trasparente lo sfondo bianco'), prev);
        produce = () => {
          if (!img) return null;
          const c = document.createElement('canvas');
          const sc = Math.min(1, 1200 / img.width);
          c.width = img.width * sc; c.height = img.height * sc;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0, c.width, c.height);
          if (rm.checked) {
            const d = g.getImageData(0, 0, c.width, c.height);
            for (let i = 0; i < d.data.length; i += 4) {
              const lum = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
              if (lum > 200) d.data[i + 3] = Math.max(0, Math.round(255 * (1 - (lum - 200) / 40)));
            }
            g.putImageData(d, 0, 0);
          }
          return trimCanvas(c);
        };
      }
    };
    for (const [t, lab] of [['draw', 'Disegna'], ['type', 'Scrivi'], ['upload', 'Carica']]) {
      const b = el('button', { type: 'button', 'data-t': t }, lab);
      b.addEventListener('click', () => show(t));
      tabs.append(b);
    }
    const saved = el('div');
    if (SIGNATURES.length) {
      saved.append(el('div', { class: 'help', style: { marginTop: '14px' } }, 'Firme già create (tocca per usarla):'));
      const list = el('div', { class: 'sig-list' });
      SIGNATURES.forEach((s) => list.append(el('img', { src: s.url, onclick: () => { m.close(); onReady(s); } })));
      saved.append(list);
    }
    const m = modal({
      title: initials ? 'Le tue iniziali' : 'La tua firma',
      body: el('div', {}, tabs, body, saved),
      buttons: [{ label: 'Usa questa firma', primary: true, onClick: async (close) => {
        const c = produce && produce();
        if (!c) { toast('Crea prima la firma', true); return; }
        const bytes = await canvasToBytes(c, 'image/png');
        const sig = { url: c.toDataURL('image/png'), bytes, mime: 'png', w: c.width, h: c.height };
        SIGNATURES.unshift(sig);
        SIGNATURES = SIGNATURES.slice(0, 6);
        close();
        onReady(sig);
      } }],
    });
    show('draw');
  }

  /* ---------- Censura: ricerca testo ---------- */
  async function redactSearch(query, opts = {}) {
    const q = String(query || '').trim();
    if (!q) return 0;
    let count = 0;
    const needle = opts.caseSensitive ? q : q.toLowerCase();
    for (const p of pages) {
      const pg = await pdf.getPage(p.num);
      const vp = pg.getViewport({ scale: 1 });
      const tc = await pg.getTextContent();
      for (const item of tc.items) {
        const str = item.str || '';
        const hay = opts.caseSensitive ? str : str.toLowerCase();
        let idx = hay.indexOf(needle);
        while (idx >= 0) {
          // rettangolo del frammento di testo nelle coordinate della vista (y verso il basso)
          const m = multiply(vp.transform, item.transform);
          const fontH = Math.hypot(m[2], m[3]) || 10;
          const len = Math.hypot(m[0], m[1]) || 1;
          const dx = m[0] / len, dy = m[1] / len; // direzione del testo
          const ux = dy, uy = -dx; // verso l'alto del testo
          const totalW = item.width * vp.scale;
          const f0 = str.length ? idx / str.length : 0;
          const f1 = str.length ? (idx + q.length) / str.length : 1;
          const p0 = [m[4] + dx * totalW * f0, m[5] + dy * totalW * f0];
          const p1 = [m[4] + dx * totalW * f1, m[5] + dy * totalW * f1];
          const pts = [p0, p1].flatMap(([x, y]) => [[x + ux * fontH * 0.95, y + uy * fontH * 0.95], [x - ux * fontH * 0.25, y - uy * fontH * 0.25]]);
          const xs = pts.map((t) => t[0]), ys = pts.map((t) => t[1]);
          const pad = 1;
          const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
          addItem(p, { type: 'redact', x: minX / vp.width, y: minY / vp.height, w: (maxX - minX) / vp.width, h: (maxY - minY) / vp.height });
          count++;
          idx = hay.indexOf(needle, idx + needle.length);
        }
      }
    }
    return count;
  }

  /* ---------- Applicazione al PDF ---------- */
  async function apply(bytes, options = {}, progress) {
    const all = pages.flatMap((p) => p.items);
    if (selected) select(null);
    if (!all.length) throw new Error(mode === 'redact' ? 'Non hai indicato nessuna area da oscurare.' : mode === 'sign' ? 'Non hai inserito nessuna firma.' : 'Non hai fatto nessuna modifica.');
    if (mode === 'redact') return applyRedact(bytes, progress);
    const doc = await loadPdfLib(bytes);
    const docPages = doc.getPages();
    const fontCache = {};
    const getFont = async (fam, bold) => {
      const k = fam + bold;
      if (!fontCache[k]) fontCache[k] = await doc.embedFont(StandardFonts[FONT_STD[fam][bold ? 1 : 0]]);
      return fontCache[k];
    };
    const imgCache = new Map();
    const targets = (p) => (options.allPages ? pages : [p]);
    for (const p of pages) {
      for (const it of p.items) {
        for (const tp of targets(p)) {
          const page = docPages[tp.num - 1];
          const vp = tp.vp1;
          const toPdf = (fx, fy) => vp.convertToPdfPoint(fx * vp.width, fy * vp.height);
          const rot = degrees(tp.rot % 360);
          if (it.type === 'text') {
            const font = await getFont(it.font, it.bold);
            const text = toWinAnsi(it.text);
            const lineH = it.size * 1.2;
            const [ox, oy] = toPdf(it.x, it.y + (it.size * 0.1 + it.size * 0.86) / vp.height);
            page.drawText(text, { x: ox, y: oy, size: it.size, font, color: hexToRgb(it.color), lineHeight: lineH, rotate: rot });
          } else if (it.type === 'image') {
            let img = imgCache.get(it.url);
            if (!img) { img = it.mime === 'png' ? await doc.embedPng(it.bytes) : await doc.embedJpg(it.bytes); imgCache.set(it.url, img); }
            const [ox, oy] = toPdf(it.x, it.y + it.h);
            page.drawImage(img, { x: ox, y: oy, width: it.w * vp.width, height: it.h * vp.height, rotate: rot });
          } else if (it.type === 'rect' || it.type === 'hl') {
            const [ax, ay] = toPdf(it.x, it.y);
            const [bx, by] = toPdf(it.x + it.w, it.y + it.h);
            page.drawRectangle({ x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay), color: hexToRgb(it.color), opacity: it.type === 'hl' ? 0.4 : it.opacity, blendMode: it.type === 'hl' ? PDFLib.BlendMode.Multiply : undefined, borderColor: it.border ? rgb(0.6, 0.6, 0.6) : undefined, borderWidth: it.border ? 0.8 : 0 });
          } else if (it.type === 'draw') {
            const pts = it.points.map(([x, y]) => toPdf(x, y));
            for (let i = 1; i < pts.length; i++) {
              page.drawLine({ start: { x: pts[i - 1][0], y: pts[i - 1][1] }, end: { x: pts[i][0], y: pts[i][1] }, thickness: it.width, color: hexToRgb(it.color), lineCap: PDFLib.LineCapStyle.Round });
            }
          }
        }
      }
    }
    return savePdf(doc);
  }

  async function applyRedact(bytes, progress) {
    const src = await loadPdfLib(bytes);
    const out = await PDFLib.PDFDocument.create();
    const n = src.getPageCount();
    for (let i = 0; i < n; i++) {
      progress && progress(i / n, `Pagina ${i + 1} di ${n}`);
      const p = pages[i];
      if (!p || !p.items.length) {
        const [cp] = await out.copyPages(src, [i]);
        out.addPage(cp);
        continue;
      }
      // pagina con aree oscurate: la trasformiamo in immagine così il testo sotto sparisce davvero
      const scale = 200 / 72;
      const { canvas } = await renderPage(pdf, i + 1, scale, { annotationMode: 0 });
      const g = canvas.getContext('2d');
      g.fillStyle = '#000';
      for (const it of p.items) g.fillRect(it.x * canvas.width, it.y * canvas.height, it.w * canvas.width, it.h * canvas.height);
      const jpg = await canvasToBytes(canvas, 'image/jpeg', 0.9);
      const img = await out.embedJpg(jpg);
      const page = out.addPage([p.vp1.width, p.vp1.height]);
      page.drawImage(img, { x: 0, y: 0, width: p.vp1.width, height: p.vp1.height });
    }
    return out.save({ useObjectStreams: true });
  }

  return {
    apply,
    redactSearch,
    hasItems: () => pages.some((p) => p.items.length),
    destroy: () => { io.disconnect(); window.removeEventListener('resize', onResize); },
  };
}

function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

function trimCanvas(c) {
  const g = c.getContext('2d');
  const { width, height } = c;
  const d = g.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (d[(y * width + x) * 4 + 3] > 10) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return null;
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// Prepara un'immagine (corregge l'orientamento delle foto e la riduce se enorme)
export async function prepareImage(file, maxSide = 2400) {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * sc);
  c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const isPng = /png|gif|webp|svg/i.test(file.type);
  const bytes = await canvasToBytes(c, isPng ? 'image/png' : 'image/jpeg', 0.92);
  return { url: c.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.92), bytes, mime: isPng ? 'png' : 'jpg', w: c.width, h: c.height };
}
