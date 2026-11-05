// MULTIPEPPINS — archivio dei timbri aziendali (salvati sul dispositivo, in IndexedDB)
import { el, icon, toast, modal } from './ui.js';
import { saveFile } from './core.js';

const KEY = 'stamps';
let cache = null;

function db() {
  return (db.p ||= new Promise((res, rej) => {
    try {
      const r = indexedDB.open('multipeppins', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  }));
}
async function idbGet(k) {
  try {
    const d = await db();
    return await new Promise((res) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
  } catch {
    try { return JSON.parse(localStorage.getItem('mp_' + k)); } catch { return undefined; }
  }
}
async function idbSet(k, v) {
  try {
    const d = await db();
    await new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); });
    return true;
  } catch {
    try { localStorage.setItem('mp_' + k, JSON.stringify(v)); return true; } catch { return false; }
  }
}

export async function getStamps() {
  if (!cache) { const v = await idbGet(KEY); cache = Array.isArray(v) ? v : []; }
  return cache;
}
async function persist() {
  if (!(await idbSet(KEY, cache))) toast('Impossibile salvare i timbri su questo dispositivo', true);
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const sorted = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }));

// Ricorda la larghezza (in punti PDF) dopo un ridimensionamento
export async function rememberStampSize(id, wPt) {
  const list = await getStamps();
  const s = list.find((x) => x.id === id);
  if (s && wPt > 5) { s.wPt = Math.round(wPt); persist(); }
}

// Prepara il timbro da posizionare nell'editor: { url, bytes, mime, w, h, stampId, wPt }
async function toPending(s) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = s.url; });
  const bytes = Uint8Array.from(atob(s.url.split(',')[1]), (c) => c.charCodeAt(0));
  return { url: s.url, bytes, mime: 'png', w: img.naturalWidth, h: img.naturalHeight, stampId: s.id, wPt: s.wPt };
}

function trim(c) {
  const g = c.getContext('2d');
  const { width: w, height: h } = c;
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < x0) return c;
  const pad = 4, o = document.createElement('canvas');
  o.width = x1 - x0 + 1 + pad * 2; o.height = y1 - y0 + 1 + pad * 2;
  o.getContext('2d').drawImage(c, x0 - pad, y0 - pad, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}
function processImage(bmp, removeBg) {
  const c = document.createElement('canvas');
  const k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, c.width, c.height);
  if (removeBg) {
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const l = (p[i] + p[i + 1] + p[i + 2]) / 3; if (l > 215) p[i + 3] = Math.max(0, Math.round(255 - ((l - 215) * 255) / 40)); }
    g.putImageData(d, 0, 0);
  }
  return trim(c).toDataURL('image/png');
}

function addStampDialog(onSaved) {
  const name = el('input', { class: 'inp', placeholder: 'es. Santa Chiara – Ufficio Personale' });
  const file = el('input', { type: 'file', accept: 'image/*' });
  const rm = el('input', { type: 'checkbox', checked: true });
  const prev = el('div', { class: 'stamp-prev' });
  let bmp = null, url = null;
  const refresh = () => { if (!bmp) return; url = processImage(bmp, rm.checked); prev.innerHTML = ''; prev.append(el('img', { src: url, alt: '' })); };
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try { bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); } catch { toast('Immagine non leggibile', true); return; }
    if (!name.value.trim()) name.value = f.name.replace(/\.[^.]+$/, '');
    refresh();
  });
  rm.addEventListener('change', refresh);
  modal({
    title: 'Aggiungi un timbro',
    body: el('div', {},
      el('label', { class: 'lbl' }, 'Nome del timbro'), name,
      el('label', { class: 'lbl', style: { marginTop: '12px' } }, 'Foto o scansione del timbro'), file,
      el('div', { class: 'help' }, 'Timbra un foglio bianco e fotografalo dall\'alto, con buona luce. Il bianco intorno viene tolto in automatico.'),
      el('label', { class: 'check' }, rm, 'Rendi trasparente lo sfondo bianco'),
      prev,
    ),
    buttons: [{ label: 'Salva timbro', primary: true, onClick: async (close) => {
      const n = name.value.trim();
      if (!url) { toast('Scegli l\'immagine del timbro', true); return; }
      if (!n) { toast('Dai un nome al timbro', true); return; }
      const list = await getStamps();
      const s = { id: newId(), name: n.slice(0, 80), url };
      list.push(s);
      await persist();
      close();
      toast(`Timbro "${s.name}" salvato nell'archivio`);
      onSaved(s);
    } }],
  });
}

// Finestra "Timbri": scegli, aggiungi, rinomina, elimina, esporta, importa
export async function stampsDialog(onPick) {
  const list = await getStamps();
  const body = el('div');
  let m;
  const pick = async (s) => { m.close(); onPick(await toPending(s)); };
  const render = () => {
    body.innerHTML = '';
    const search = list.length > 5 ? el('input', { class: 'inp', placeholder: 'Cerca timbro per nome…', style: { marginBottom: '10px' } }) : null;
    const rows = el('div', { class: 'stamp-list' });
    const draw = (q = '') => {
      rows.innerHTML = '';
      const items = sorted(list).filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
      if (!items.length) rows.append(el('div', { class: 'help' }, list.length ? 'Nessun timbro con questo nome.' : 'L\'archivio è vuoto: aggiungi il primo timbro.'));
      for (const s of items) {
        rows.append(el('div', { class: 'stamp-row' },
          el('button', { class: 'stamp-pick', type: 'button', title: 'Apponi questo timbro', onclick: () => pick(s) }, el('img', { src: s.url, alt: '' }), el('b', {}, s.name)),
          el('button', { class: 'mini', type: 'button', title: 'Rinomina', onclick: () => {
            const inp = el('input', { class: 'inp', value: s.name });
            const r = modal({ title: 'Rinomina timbro', body: inp, buttons: [{ label: 'Salva', primary: true, onClick: (close) => { const n = inp.value.trim(); if (!n) return; s.name = n.slice(0, 80); persist(); close(); render(); } }] });
            setTimeout(() => { inp.focus(); inp.select(); }, 30);
            return r;
          } }, icon('edit')),
          el('button', { class: 'mini', type: 'button', title: 'Elimina', onclick: () => {
            modal({ title: 'Eliminare il timbro?', body: el('p', {}, `"${s.name}" verrà tolto dall'archivio di questo dispositivo.`), buttons: [
              { label: 'Annulla', onClick: (close) => close() },
              { label: 'Elimina', primary: true, onClick: (close) => { list.splice(list.indexOf(s), 1); persist(); close(); render(); } },
            ] });
          } }, icon('trash')),
        ));
      }
    };
    if (search) search.addEventListener('input', () => draw(search.value.trim()));
    draw();
    body.append(
      search || '',
      rows,
      el('button', { class: 'btn-sec', type: 'button', style: { width: '100%', justifyContent: 'center', marginTop: '10px' }, onclick: () => { m.close(); addStampDialog(async (s) => onPick(await toPending(s))); } }, icon('plus', 16), 'Aggiungi un timbro all\'archivio'),
      el('div', { class: 'stamp-io' },
        list.length ? el('button', { class: 'chip', type: 'button', onclick: exportStamps }, icon('download', 14), 'Esporta timbri') : null,
        el('button', { class: 'chip', type: 'button', onclick: () => importStamps(render) }, icon('plus', 14), 'Importa timbri'),
      ),
      el('div', { class: 'help' }, 'I timbri restano salvati su questo dispositivo. Con "Esporta" crei un file da dare ai colleghi, che lo caricano con "Importa". Se ridimensioni un timbro sulla pagina, la volta dopo compare già di quella misura.'),
    );
  };
  render();
  m = modal({ title: 'Timbri aziendali', body });
}

async function exportStamps() {
  const list = await getStamps();
  const data = JSON.stringify({ app: 'MULTIPEPPINS', tipo: 'timbri', versione: 1, timbri: list.map(({ name, url, wPt }) => ({ name, img: url, wPt })) });
  try { await saveFile('timbri_multipeppins.json', new Blob([data], { type: 'application/json' }), 'application/json'); }
  catch (e) { toast(e.message, true); }
}
async function importStamps(after) {
  const inp = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  document.body.append(inp);
  const f = await new Promise((r) => { inp.addEventListener('change', () => r(inp.files[0])); inp.click(); });
  inp.remove();
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const incoming = Array.isArray(data && data.timbri) ? data.timbri : [];
    const list = await getStamps();
    let k = 0;
    for (const t of incoming) {
      if (!t || typeof t.name !== 'string' || typeof t.img !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(t.img)) continue;
      if (list.some((x) => x.url === t.img)) continue;
      list.push({ id: newId(), name: t.name.slice(0, 80), url: t.img, wPt: typeof t.wPt === 'number' ? t.wPt : undefined });
      k++;
    }
    await persist();
    toast(k === 1 ? 'Importato 1 timbro' : k ? `Importati ${k} timbri` : 'Nessun timbro nuovo da importare');
    after && after();
  } catch { toast('File non valido: usa un file esportato da MULTIPEPPINS', true); }
}

