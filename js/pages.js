// MULTIPEPPINS — griglia di miniature delle pagine (selezione e riordino)
import { renderPage, parseRanges } from './core.js';
import { el, icon, toast } from './ui.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Miniature con caricamento pigro
function thumbLoader(root) {
  const queue = [];
  let busy = false;
  const pump = async () => {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const job = queue.shift();
      try { await job(); } catch {}
    }
    busy = false;
  };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting && en.target.__job) {
        queue.push(en.target.__job);
        en.target.__job = null;
        io.unobserve(en.target);
      }
    }
    pump();
  }, { root: null, rootMargin: '400px' }) : null;
  return {
    add(node, job) {
      if (io) { node.__job = job; io.observe(node); }
      else { queue.push(job); pump(); }
    },
    destroy() { io && io.disconnect(); queue.length = 0; },
  };
}

async function drawThumb(file, pageNum, holder, maxSide = 150) {
  const page = await file.pdf.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  const scale = Math.min(2, (maxSide * (window.devicePixelRatio > 1 ? 1.6 : 1)) / Math.max(vp.width, vp.height));
  const { canvas } = await renderPage(file.pdf, pageNum, scale);
  canvas.style.maxWidth = '100%';
  canvas.style.maxHeight = '100%';
  holder.innerHTML = '';
  holder.append(canvas);
  return canvas;
}

/* ---------- Modalità selezione ---------- */
export function selectGrid(ctx, { initial = 'none', hint, onChange } = {}) {
  const file = ctx.files[0];
  const total = file.pages;
  const sel = new Set(initial === 'all' ? Array.from({ length: total }, (_, i) => i + 1) : []);
  const loader = thumbLoader();
  const rangeInp = el('input', { class: 'inp', placeholder: 'es. 1-3, 7, 10-12', style: { maxWidth: '240px' } });
  const count = el('span', { style: { fontSize: '13px', color: 'var(--ink-3)', fontWeight: 600 } });
  const cards = [];
  const sync = (fromInput) => {
    cards.forEach((c, i) => c.classList.toggle('sel', sel.has(i + 1)));
    count.textContent = `${sel.size} di ${total} selezionate`;
    if (!fromInput) rangeInp.value = toRanges([...sel].sort((a, b) => a - b));
    onChange && onChange(sel);
  };
  const setAll = (fn) => { sel.clear(); for (let i = 1; i <= total; i++) if (fn(i)) sel.add(i); sync(); };
  rangeInp.addEventListener('change', () => {
    try {
      const pages = parseRanges(rangeInp.value, total, { allowEmpty: true });
      sel.clear();
      pages.forEach((p) => sel.add(p));
      sync(true);
    } catch (e) { toast(e.message, true); }
  });
  const bar = el('div', { class: 'pages-toolbar' },
    el('button', { class: 'chip', onclick: () => setAll(() => true) }, 'Tutte'),
    el('button', { class: 'chip', onclick: () => setAll(() => false) }, 'Nessuna'),
    el('button', { class: 'chip', onclick: () => setAll((i) => !sel.has(i)) }, 'Inverti'),
    el('button', { class: 'chip', onclick: () => setAll((i) => i % 2 === 1) }, 'Dispari'),
    el('button', { class: 'chip', onclick: () => setAll((i) => i % 2 === 0) }, 'Pari'),
    rangeInp,
    count,
  );
  const grid = el('div', { class: 'pgrid' });
  for (let i = 1; i <= total; i++) {
    const th = el('div', { class: 'pthumb' }, el('div', { class: 'blank' }));
    const card = el('div', { class: 'pcard' }, th, el('div', { class: 'pnum' }, String(i)));
    card.addEventListener('click', () => { sel.has(i) ? sel.delete(i) : sel.add(i); sync(); });
    cards.push(card);
    grid.append(card);
    loader.add(card, () => drawThumb(file, i, th));
  }
  ctx.stage.append(hint ? el('div', { class: 'note info', style: { marginTop: 0 } }, hint) : '', bar, grid);
  sync();
  return {
    getSelection: () => [...sel].sort((a, b) => a - b),
    destroy: () => loader.destroy(),
  };
}

export function toRanges(nums) {
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}-${nums[j]}` : String(nums[i]));
    i = j;
  }
  return out.join(', ');
}

/* ---------- Modalità riordino (Organizza) ---------- */
export function arrangeGrid(ctx, { allowBlank = true } = {}) {
  const loader = thumbLoader();
  // items: {key, src (indice file), page, rot, blank}
  let items = [];
  let key = 0;
  const build = () => {
    items = [];
    ctx.files.forEach((f, fi) => { for (let p = 1; p <= f.pages; p++) items.push({ key: ++key, src: fi, page: p, rot: 0 }); });
  };
  build();
  const thumbs = new Map(); // "src:page" -> dataURL
  const grid = el('div', { class: 'pgrid' });
  const info = el('span', { style: { fontSize: '13px', color: 'var(--ink-3)', fontWeight: 600 } });

  const draw = () => {
    grid.innerHTML = '';
    loader.destroy();
    items.forEach((it, idx) => {
      const th = el('div', { class: 'pthumb' });
      const inner = it.blank ? el('div', { class: 'blank' }) : el('div', { class: 'blank' });
      th.append(inner);
      const setRot = (node) => { node.style.transform = `rotate(${it.rot}deg)`; };
      const card = el('div', { class: 'pcard', draggable: 'true' }, th,
        ctx.files.length > 1 && !it.blank ? el('span', { class: 'src-tag' }, LETTERS[it.src] || '?') : null,
        el('div', { class: 'pnum' }, it.blank ? 'Vuota' : (ctx.files.length > 1 ? `${LETTERS[it.src]}${it.page}` : String(it.page))),
        el('div', { class: 'pbtns' },
          el('button', { class: 'mini', title: 'Sposta a sinistra', onclick: (e) => { e.stopPropagation(); move(idx, -1); } }, icon('left')),
          el('button', { class: 'mini', title: 'Ruota', onclick: (e) => { e.stopPropagation(); it.rot = (it.rot + 90) % 360; setRot(th.firstChild); } }, icon('rotr')),
          el('button', { class: 'mini', title: 'Elimina', onclick: (e) => { e.stopPropagation(); items.splice(idx, 1); draw(); } }, icon('trash')),
          el('button', { class: 'mini', title: 'Sposta a destra', onclick: (e) => { e.stopPropagation(); move(idx, 1); } }, icon('right')),
        ),
      );
      setRot(inner);
      card.addEventListener('dragstart', (e) => { card.classList.add('dragging'); e.dataTransfer.setData('text/x-page', String(it.key)); e.dataTransfer.effectAllowed = 'move'; });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-page')) { e.preventDefault(); card.classList.add('drop-before'); } });
      card.addEventListener('dragleave', () => card.classList.remove('drop-before'));
      card.addEventListener('drop', (e) => {
        const k = +e.dataTransfer.getData('text/x-page');
        if (!k) return;
        e.preventDefault();
        const from = items.findIndex((x) => x.key === k);
        const moving = items.splice(from, 1)[0];
        const to = items.findIndex((x) => x.key === it.key);
        items.splice(to, 0, moving);
        draw();
      });
      grid.append(card);
      if (!it.blank) {
        const id = it.src + ':' + it.page;
        const paint = (url) => { const img = el('img', { src: url, alt: '', style: { maxWidth: '100%', maxHeight: '100%', boxShadow: '0 1px 4px rgba(0,0,0,.18)', background: '#fff', transition: 'transform .2s' } }); th.innerHTML = ''; th.append(img); setRot(img); };
        if (thumbs.has(id)) paint(thumbs.get(id));
        else loader.add(card, async () => {
          const c = await drawThumb(ctx.files[it.src], it.page, el('div'));
          const url = c.toDataURL('image/jpeg', 0.75);
          thumbs.set(id, url);
          paint(url);
        });
      }
    });
    info.textContent = `${items.length} pagine`;
  };
  const move = (idx, d) => {
    const j = idx + d;
    if (j < 0 || j >= items.length) return;
    [items[idx], items[j]] = [items[j], items[idx]];
    draw();
  };
  const bar = el('div', { class: 'pages-toolbar' },
    allowBlank ? el('button', { class: 'chip', onclick: () => { items.push({ key: ++key, blank: true, rot: 0 }); draw(); } }, icon('plus', 14), 'Pagina vuota') : null,
    el('button', { class: 'chip', onclick: () => { items.reverse(); draw(); } }, 'Inverti ordine'),
    el('button', { class: 'chip', onclick: () => { items.forEach((x) => (x.rot = (x.rot + 90) % 360)); draw(); } }, icon('rotr', 14), 'Ruota tutte'),
    el('button', { class: 'chip', onclick: () => { build(); draw(); } }, 'Ripristina'),
    el('button', { class: 'chip', onclick: ctx.addMore }, icon('plus', 14), 'Aggiungi PDF'),
    info,
  );
  ctx.stage.append(el('div', { class: 'note info', style: { marginTop: 0 } }, 'Trascina le pagine (o usa le frecce) per riordinarle. Puoi ruotarle, eliminarle e aggiungere pagine vuote.'), bar, grid);
  draw();
  return {
    getItems: () => items.map((x) => ({ ...x })),
    destroy: () => loader.destroy(),
  };
}
