// Minimal service worker for the app shell (HTML, JS, CSS, icon). Model
// weights fetched from the Hugging Face CDN are cross-origin and are left
// alone here: transformers.js caches those itself via the Cache Storage API
// with its own range-request handling, and this worker would only risk
// breaking that. No analytics, no telemetry, nothing sent anywhere.

const CACHE_NAME = "lenslocal-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);

      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => undefined);

      // Stale-while-revalidate: answer from cache instantly when we have it
      // and refresh quietly in the background, otherwise wait on the network.
      if (cached) {
        networkFetch.catch(() => {});
        return cached;
      }
      const fresh = await networkFetch;
      if (fresh) return fresh;
      throw new Error("lenslocal sw: no cache entry and network request failed");
    })(),
  );
});
