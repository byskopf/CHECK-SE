/* Service Worker for CHECK-SE — improved to derive scope and build absolute cache URLs
   - Builds APP_SHELL using the worker scope (or falls back to location.origin)
   - Uses Promise.allSettled in install to avoid failing the whole install when a single asset 404s
   - Normalizes cache keys to use absolute URL strings
*/

var CACHE_NAME = 'check-se-launcher-v6-20260904';

// Derive a base URL from the service worker registration scope if available, else fall back to the worker location
var scopeBase;
try {
  var scopeHref = (self.registration && self.registration.scope) ? self.registration.scope : self.location.href;
  scopeBase = new URL('.', scopeHref).href; // ensures trailing slash
} catch (e) {
  scopeBase = self.location.origin + '/';
}

// Build absolute URLs for the app shell relative to the derived scope base
var APP_SHELL = [
  new URL('index.html', scopeBase).href,
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
        // Fetch and cache each resource individually. Use allSettled so a single failure doesn't reject the whole install.
        return Promise.allSettled(APP_SHELL.map(function (url) {
          return fetch(url, { cache: 'no-cache' }).then(function (resp) {
            if (!resp || !resp.ok) return Promise.reject(new Error('Failed to fetch: ' + url));
            return cache.put(url, resp.clone());
          }).catch(function (err) {
            // Log the missing asset but don't fail installation entirely
            console.warn('SW: failed to cache', url, err && err.message);
            return Promise.resolve();
          });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          if (key !== CACHE_NAME) return caches.delete(key);
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
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // Derive the index URL for navigations (absolute)
  var indexUrl = new URL('index.html', scopeBase).href;

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
            .then(function (cache) { return cache.put(indexUrl, copy); })
            .catch(function () {
              // fail silently
            })
            .then(function () { return response; });
        })
        .catch(function () {
          return caches.match(indexUrl).then(function (cached) {
            return cached || caches.match(new URL('offline.html', scopeBase).href);
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
        // For cross-origin responses response.type may be 'opaque' — still store if desired, but be explicit
        var copy = response.clone();
        return caches.open(CACHE_NAME)
          .then(function (cache) { return cache.put(request.url, copy); })
          .catch(function () {
            // ignore cache failures
          })
          .then(function () { return response; });
      }).catch(function () {
        // network failed — try cache fallback
        return caches.match(request.url);
      });
    })
  );
});
