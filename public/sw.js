/* WhenLast service worker template. scripts/build-sw.mjs rewrites the markers below into dist/sw.js. */
const SW_VERSION = 'whenlast-v1';
const PRECACHE = /*__PRECACHE__*/;

const CACHE_PREFIX = 'whenlast-';
const CACHE_NAME = CACHE_PREFIX + SW_VERSION;
const INDEX_URL = new URL('./index.html', self.registration.scope).href;
const OFFLINE_RESPONSE = new Response('Offline', {
  status: 503,
  statusText: 'Offline',
  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
});

function isCacheable(response) {
  return Boolean(response) && response.ok && response.type === 'basic';
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const index = (await cache.match(INDEX_URL)) || (await cache.match('./index.html'));
    if (index) return index;
    return OFFLINE_RESPONSE.clone();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request)
      .then((response) => {
        if (isCacheable(response)) {
          return cache.put(request, response.clone());
        }
        return undefined;
      })
      .catch(() => undefined);
    return cached;
  }
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const fallback = await cache.match(request, { ignoreSearch: true });
    if (fallback) return fallback;
    return OFFLINE_RESPONSE.clone();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});