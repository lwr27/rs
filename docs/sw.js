// Service worker for rs.3kt.live: caches map tiles only.
//
// Tiles never change once published, so they are served cache-first and
// stored on first sight. Everything else (index.html, latest.json,
// snapshots, route data) is left completely alone and always goes to
// the network, so nothing on the site can go stale because of this.
//
// The cache is capped: once it holds more than MAX_TILES entries the
// oldest are evicted, so it stays around 100MB at most rather than
// slowly accumulating the entire map.

const TILE_CACHE = "rs-map-tiles-v1";
const MAX_TILES = 4000;
const TRIM_EVERY = 50;
const TILE_HOSTS = ["lwr27.github.io", "map.3kt.live"];

let putsSinceTrim = 0;

function isTileRequest(url) {
  return TILE_HOSTS.includes(url.hostname) && url.pathname.includes("/tiles/") && url.pathname.endsWith(".png");
}

// Retry attempts append ?retry=n; strip the query so all attempts share
// one cache entry.
function cacheKeyFor(url) {
  return url.origin + url.pathname;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Drop caches from older versions of this worker, if any.
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== TILE_CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !isTileRequest(url)) return; // not ours

  event.respondWith((async () => {
    const cache = await caches.open(TILE_CACHE);
    const key = cacheKeyFor(url);
    const hit = await cache.match(key);
    if (hit) return hit;

    const response = await fetch(event.request);
    // Tiles arrive as plain (no-cors) image requests, which means their
    // status code is hidden from us ("opaque"). Those are cached too;
    // the page drops any entry whose image fails to decode (see
    // evictTileFromCache in index.html), so a cached 404 or error page
    // can't stick around.
    if (response.ok || response.type === "opaque") {
      event.waitUntil((async () => {
        await cache.put(key, response.clone());
        if (++putsSinceTrim >= TRIM_EVERY) {
          putsSinceTrim = 0;
          await trimCache(cache);
        }
      })());
    }
    return response;
  })());
});

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_TILES;
  if (excess <= 0) return;
  // cache.keys() returns entries in insertion order, so the front of the
  // list is the oldest.
  await Promise.all(keys.slice(0, excess).map(k => cache.delete(k)));
}
