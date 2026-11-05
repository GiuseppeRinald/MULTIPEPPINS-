// MULTIPEPPINS — funziona anche offline una volta installata.
// Codice dell'app: prima la rete (così gli aggiornamenti arrivano subito), poi la copia salvata.
// Librerie in vendor/: prima la copia salvata (sono grandi e non cambiano).
const CACHE = 'multipeppins-v1';
const CORE = ['./', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js','js/core.js','js/crypto.js','js/editor.js','js/fonts.js','js/helpers.js','js/layout.js','js/ocr-worker.js','js/ocr.js','js/pages.js','js/pdfa.js','js/pptx.js','js/stamps.js','js/tools.js','js/tools2.js','js/tools3.js','js/ui.js',
  'vendor/pdf-lib.min.js', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const store = (res) => { if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return res; };
  if (url.origin === location.origin && url.pathname.includes('/vendor/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(store)));
    return;
  }
  e.respondWith(fetch(req).then(store).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined))));
});
