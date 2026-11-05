// Minimal service worker for Green Loop Collector.
// Exists to make the app installable (beforeinstallprompt requires a SW)
// and to provide a network-first fetch strategy that falls back to cache
// for a few core assets so the app can open briefly without connectivity.
//
// We intentionally do NOT aggressively cache JS/CSS bundles, because Vite
// hashes them per build; the browser's HTTP cache + Netlify's edge cache
// already handle that. Keeping this lightweight avoids stale-version bugs.

const CACHE_NAME = 'green-loop-shell-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/logo.jpg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests. Everything else (POST to Netlify functions etc.)
  // passes straight through to the network.
  if (request.method !== 'GET') return;

  // Never cache Netlify function calls — they're dynamic.
  if (request.url.includes('/.netlify/functions/')) return;

  // Navigation requests: try network, fall back to cached index.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Other GETs: network first, fall back to cache.
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Opportunistically cache successful shell responses
        if (response.ok && SHELL_ASSETS.some((asset) => request.url.endsWith(asset))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
