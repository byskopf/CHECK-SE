const PREFIX = 'check-se-offline-test-';
const CACHE = PREFIX + 'v1';
const ROOT = new URL('./', self.location.href);
const FILES = ['index.html', 'styles.css', 'app.js', 'db.js', 'offline-api.js', 'sync.js', 'manifest.json', 'icon-192.png', 'icon-512.png'].map(path => new URL(path, ROOT).href);
self.addEventListener('install', event => {
  // Fail installation unless the entire offline interface is available.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  const navigation = event.request.mode === 'navigate';
  if (navigation && ![ROOT.pathname, new URL('index.html', ROOT).pathname].includes(url.pathname)) return;
  const target = navigation ? FILES[0] : url.href;
  if (!FILES.includes(target)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(target)) || fetch(event.request)));
});
