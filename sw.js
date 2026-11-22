/* Offline support. Network first, so an online visitor always gets the current version. */
const CACHE = 'qwn-v12';
const FILES = ['./', 'index.html', 'about.html', 'privacy.html', 'contact.html', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'manifest.webmanifest', 'assets/app.css', 'assets/page.css', 'assets/app.js', 'assets/i18n.js',
  'assets/vendor/marked.esm.js', 'assets/vendor/purify.es.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || Response.error()))
  );
});
