// Service worker: keeps every Mars tile the browser downloads in Cache Storage, so tiles you have
// seen once load instantly next time, even after closing the browser, with or without serve.mjs.
// Cache-first: tiles at a given z/y/x never change on Trek.
const CACHE = "mars-tiles-v1";

const isTile = (url) =>
  (url.hostname === "trek.nasa.gov" && url.pathname.startsWith("/tiles/")) ||
  (url.origin === self.location.origin && url.pathname.startsWith("/trek/"));

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!isTile(url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req.url);
      if (hit) return hit;
      const res = await fetch(req);
      // Only keep real images (Trek returns HTML for 404s). Opaque responses are skipped too.
      const type = res.headers.get("content-type") || "";
      if (res.ok && type.startsWith("image/")) {
        cache.put(req.url, res.clone()).catch(() => {});
      }
      return res;
    })(),
  );
});
