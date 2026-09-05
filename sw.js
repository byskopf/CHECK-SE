/* Service Worker for CHECK-SE
   PWA 1.1.0
   - Usa o escopo atual para montar as URLs do app shell
   - Mantém o cache do CHECK-SE isolado de outros PWAs no mesmo domínio
   - Cacheia cada navegação pela própria URL, sem sobrescrever o index.html
   - Permite atualização assistida pelo portal
*/

var CACHE_PREFIX = 'check-se-launcher-';
var CACHE_NAME = CACHE_PREFIX + 'pwa-1.2.0-20260905';

var scopeBase;
try {
  var scopeHref = (self.registration && self.registration.scope) ? self.registration.scope : self.location.href;
  scopeBase = new URL('.', scopeHref).href;
} catch (e) {
  scopeBase = self.location.origin + '/';
}

var APP_SHELL = [
  new URL('index.html', scopeBase).href,
  new URL('offline-app.html', scopeBase).href,
  new URL('styles.css', scopeBase).href,
  new URL('app.js', scopeBase).href,
  new URL('manifest.json', scopeBase).href,
  new URL('favicon.svg', scopeBase).href,
  new URL('icon-192.png', scopeBase).href,
  new URL('icon-512.png', scopeBase).href,
  new URL('icon-maskable-192.png', scopeBase).href,
  new URL('icon-maskable-512.png', scopeBase).href,
  new URL('apple-touch-icon.png', scopeBase).href,
  new URL('offline.html', scopeBase).href
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        return Promise.allSettled(APP_SHELL.map(function (url) {
          return fetch(url, { cache: 'no-cache' }).then(function (resp) {
            if (!resp || !resp.ok) return Promise.reject(new Error('Failed to fetch: ' + url));
            return cache.put(url, resp.clone());
          }).catch(function (err) {
            console.warn('SW: failed to cache', url, err && err.message);
            return Promise.resolve();
          });
        }));
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          if (key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        }));
      })
      .then(function () {
        if (self.registration && self.registration.navigationPreload) {
          return self.registration.navigationPreload.enable().catch(function () {
            // ignore
          });
        }
        return Promise.resolve();
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  var indexUrl = new URL('index.html', scopeBase).href;
  var offlineUrl = new URL('offline.html', scopeBase).href;

  if (request.mode === 'navigate') {
    event.respondWith(
      Promise.resolve(event.preloadResponse)
        .then(function (preloadedResponse) {
          return preloadedResponse || fetch(request);
        })
        .then(function (response) {
          if (!response || !response.ok) return response;
          var copy = response.clone();
          return caches.open(CACHE_NAME)
            .then(function (cache) {
              return cache.put(request.url, copy);
            })
            .catch(function () {
              // fail silently
            })
            .then(function () {
              return response;
            });
        })
        .catch(function () {
          return caches.match(request.url).then(function (cachedRequest) {
            if (cachedRequest) return cachedRequest;
            return caches.match(indexUrl).then(function (cachedIndex) {
              return cachedIndex || caches.match(offlineUrl);
            });
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request.url).then(function (cached) {
      if (cached) return cached;

      return fetch(request).then(function (response) {
        if (!response || response.status !== 200) return response;

        var copy = response.clone();
        return caches.open(CACHE_NAME)
          .then(function (cache) {
            return cache.put(request.url, copy);
          })
          .catch(function () {
            // ignore cache failures
          })
          .then(function () {
            return response;
          });
      }).catch(function () {
        return caches.match(request.url);
      });
    })
  );
});
