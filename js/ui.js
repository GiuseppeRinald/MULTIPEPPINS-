// MULTIPEPPINS — piccoli componenti di interfaccia
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

/* ---------- Icone (SVG a tratto) ---------- */
const P = {
  merge: '<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="M12 7v10M8 12h8"/>',
  split: '<path d="M4 4h6v16H4zM14 4h6v16h-6z"/><path d="M12 2v20" stroke-dasharray="2 2"/>',
  remove: '<path d="M6 3h9l5 5v13H6z"/><path d="M9.5 12.5l5 5M14.5 12.5l-5 5"/>',
  extract: '<path d="M6 3h9l5 5v13H6z"/><path d="M13 11v7M10 15l3 3 3-3"/>',
  organize: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  compress: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  repair: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  gray: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  word: '<path d="M6 3h9l5 5v13H6z"/><path d="M8.5 11l1.5 6 2-4.5 2 4.5 1.5-6"/>',
  excel: '<path d="M6 3h9l5 5v13H6z"/><path d="M9 11l6 7M15 11l-6 7"/>',
  ppt: '<path d="M6 3h9l5 5v13H6z"/><path d="M10 18v-7h2.5a2 2 0 0 1 0 4H10"/>',
  text: '<path d="M4 6V4h16v2M12 4v16M9 20h6"/>',
  html: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
  jpg: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 16l3-4 2 2.5 2-2.5 3 4z"/><circle cx="15.5" cy="8" r="1.5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  sign: '<path d="M3 17c3-3 4-8 6-8s0 7 2 7 2-3 4-3 1 3 3 3"/><path d="M3 21h18"/>',
  watermark: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  numbers: '<path d="M4 6h3v12M4 18h6M14 6h4a2 2 0 0 1 0 4h-3 3a2 2 0 0 1 0 4h-4"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  resize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  nup: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/>',
  form: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h4M7 14h10M14 9h3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  redact: '<path d="M6 3h9l5 5v13H6z"/><rect x="8.5" y="11" width="9" height="3" fill="currentColor"/><rect x="8.5" y="16" width="6" height="2" fill="currentColor"/>',
  flatten: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 16l9 5 9-5"/>',
  compare: '<path d="M4 4h6v16H4zM14 4h6v16h-6z"/><path d="M6 9h2M6 12h2M16 9h2M16 13h2"/>',
  page: '<path d="M6 3h9l5 5v13H6z"/><path d="M15 3v5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  rotl: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  rotr: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  zip: '<path d="M6 3h12v18H6z"/><path d="M12 3v2M12 7v2M12 11v2M11 15h2v3h-2z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  pen: '<path d="M3 21c4-1 6-4 9-7l5-5-3-3-5 5c-3 3-6 5-6 10z"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="1"/>',
  hl: '<path d="M9 11l-6 6v4h4l6-6M14 6l4 4M12 8l4 4-6 6-4-4z"/>',
  cursor: '<path d="M5 3l14 8-6 2-2 6z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
};
export function icon(name, size) {
  const s = el('span');
  s.innerHTML = `<svg viewBox="0 0 24 24" ${size ? `width="${size}" height="${size}"` : ''} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.page}</svg>`;
  return s.firstChild;
}

/* ---------- Toast ---------- */
let toastTimer;
export function toast(msg, isErr) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = el('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), isErr ? 6000 : 3000);
}

/* ---------- Modal ---------- */
export function modal({ title, body, buttons = [], onClose, wide }) {
  const bg = el('div', { class: 'modal-bg' });
  const box = el('div', { class: 'modal', style: wide ? { width: 'min(760px, 100%)' } : null });
  const close = () => { bg.remove(); onClose && onClose(); };
  box.append(
    el('div', { class: 'modal-h' }, el('h3', {}, title), el('button', { class: 'mini', onclick: close, 'aria-label': 'Chiudi' }, icon('close'))),
    el('div', { class: 'modal-b' }, body),
  );
  if (buttons.length) {
    const f = el('div', { class: 'modal-f' });
    for (const b of buttons) {
      f.append(el('button', { class: b.primary ? 'btn-main' : 'btn-sec', style: b.primary ? { width: 'auto', padding: '10px 18px', fontSize: '15px' } : null, onclick: () => b.onClick(close) }, b.label));
    }
    box.append(f);
  }
  bg.append(box);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.body.append(bg);
  return { close, box };
}

export function askPassword(message) {
  return new Promise((resolve) => {
    const inp = el('input', { class: 'inp', type: 'password', placeholder: 'Password', autocomplete: 'off' });
    let done = false;
    const m = modal({
      title: 'PDF protetto',
      body: el('div', {}, el('p', { style: { marginTop: 0 } }, message), inp),
      buttons: [
        { label: 'Annulla', onClick: (c) => { done = true; c(); resolve(null); } },
        { label: 'Sblocca', primary: true, onClick: (c) => { done = true; c(); resolve(inp.value); } },
      ],
      onClose: () => { if (!done) resolve(null); },
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; m.close(); resolve(inp.value); } });
    setTimeout(() => inp.focus(), 50);
  });
}

/* ---------- Avanzamento ---------- */
export function progressOverlay(title) {
  const bar = el('div');
  const txt = el('p', {}, 'Preparazione…');
  const o = el('div', { class: 'overlay' }, el('div', { class: 'prog-box' }, el('div', { class: 'spinner' }), el('h2', {}, title), txt, el('div', { class: 'bar' }, bar)));
  document.body.append(o);
  return {
    set(frac, text) {
      if (frac != null) bar.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
      if (text) txt.textContent = text;
    },
    close() { o.remove(); },
  };
}

/* ---------- Opzioni dichiarative ---------- */
// schema: [{key,type,label,help,options:[{value,label,desc}],default,min,max,step,showIf:(v)=>bool,placeholder}]
export function renderOptions(container, schema, values, onChange) {
  container.innerHTML = '';
  const fields = [];
  for (const f of schema) {
    if (values[f.key] === undefined && f.default !== undefined) values[f.key] = typeof f.default === 'function' ? f.default() : f.default;
  }
  const refresh = () => fields.forEach(({ f, node }) => node.classList.toggle('hidden', !!(f.showIf && !f.showIf(values))));
  const set = (k, v) => { values[k] = v; refresh(); onChange && onChange(k, v); };
  for (const f of schema) {
    const wrap = el('div', { class: 'field' });
    if (f.label && f.type !== 'checkbox') wrap.append(el('span', { class: 'lbl' }, f.label));
    let ctl;
    switch (f.type) {
      case 'radio': {
        ctl = el('div', { class: 'opts' });
        const name = 'r' + Math.random().toString(36).slice(2);
        for (const o of f.options) {
          const input = el('input', { type: 'radio', name, value: o.value, checked: values[f.key] === o.value });
          const lab = el('label', { class: 'opt' + (values[f.key] === o.value ? ' on' : '') }, input, el('div', {}, el('b', {}, o.label), o.desc ? el('small', {}, o.desc) : null));
          input.addEventListener('change', () => {
            ctl.querySelectorAll('.opt').forEach((x) => x.classList.remove('on'));
            lab.classList.add('on');
            set(f.key, o.value);
          });
          ctl.append(lab);
        }
        break;
      }
      case 'seg': {
        ctl = el('div', { class: 'seg' });
        for (const o of f.options) {
          const b = el('button', { type: 'button', class: values[f.key] === o.value ? 'on' : '' }, o.label);
          b.addEventListener('click', () => { ctl.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); set(f.key, o.value); });
          ctl.append(b);
        }
        break;
      }
      case 'select': {
        ctl = el('select', { class: 'sel' }, f.options.map((o) => el('option', { value: o.value, selected: values[f.key] === o.value }, o.label)));
        ctl.addEventListener('change', () => set(f.key, ctl.value));
        break;
      }
      case 'checkbox': {
        const input = el('input', { type: 'checkbox', checked: !!values[f.key] });
        input.addEventListener('change', () => set(f.key, input.checked));
        ctl = el('label', { class: 'check' }, input, f.label);
        break;
      }
      case 'range': {
        const out = el('b', {}, fmtRange(f, values[f.key]));
        const input = el('input', { type: 'range', min: f.min, max: f.max, step: f.step || 1, value: values[f.key] });
        input.addEventListener('input', () => { out.textContent = fmtRange(f, +input.value); set(f.key, +input.value); });
        ctl = el('div', {}, input, el('div', { class: 'help' }, out));
        break;
      }
      case 'number': {
        ctl = el('input', { class: 'inp', type: 'number', min: f.min, max: f.max, step: f.step || 1, value: values[f.key], inputmode: 'decimal' });
        ctl.addEventListener('input', () => set(f.key, ctl.value === '' ? '' : +ctl.value));
        break;
      }
      case 'color': {
        ctl = el('input', { type: 'color', value: values[f.key] });
        ctl.addEventListener('input', () => set(f.key, ctl.value));
        break;
      }
      case 'textarea': {
        ctl = el('textarea', { class: 'inp', placeholder: f.placeholder || '' });
        ctl.value = values[f.key] || '';
        ctl.addEventListener('input', () => set(f.key, ctl.value));
        break;
      }
      case 'position': {
        ctl = el('div', { class: 'posgrid' });
        for (const v of ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']) {
          if (f.only && !f.only.includes(v)) { ctl.append(el('span')); continue; }
          const b = el('button', { type: 'button', class: values[f.key] === v ? 'on' : '', 'aria-label': v });
          b.addEventListener('click', () => { ctl.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); set(f.key, v); });
          ctl.append(b);
        }
        break;
      }
      case 'margins': {
        ctl = el('div', { class: 'row4' });
        const v = values[f.key];
        for (const [k, lab] of [['top', 'Sopra'], ['bottom', 'Sotto'], ['left', 'Sinistra'], ['right', 'Destra']]) {
          const input = el('input', { class: 'inp', type: 'number', min: 0, step: 1, value: v[k], inputmode: 'decimal' });
          input.addEventListener('input', () => { v[k] = +input.value || 0; set(f.key, v); });
          ctl.append(el('div', {}, el('label', {}, lab), input));
        }
        break;
      }
      case 'custom': {
        ctl = f.render(values, set);
        break;
      }
      case 'note': {
        ctl = el('div', { class: 'note ' + (f.tone || '') }, f.text);
        break;
      }
      default: {
        ctl = el('input', { class: 'inp', type: f.type === 'password' ? 'password' : 'text', placeholder: f.placeholder || '', value: values[f.key] ?? '', autocomplete: f.type === 'password' ? 'new-password' : 'off' });
        ctl.addEventListener('input', () => set(f.key, ctl.value));
      }
    }
    wrap.append(ctl);
    if (f.help) wrap.append(el('div', { class: 'help' }, f.help));
    container.append(wrap);
    fields.push({ f, node: wrap });
  }
  refresh();
  return { refresh };
}
function fmtRange(f, v) {
  return f.format ? f.format(v) : String(v);
}
