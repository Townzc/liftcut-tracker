/*
 * LiftCut service worker. It caches only the static app shell: content-hashed
 * build assets, the icon and a static offline page. Pages, API responses and
 * anything user-specific are never cached; workout data offline stays in the
 * IndexedDB outbox.
 */
const SHELL = "liftcut-shell-v1";
const OFFLINE = "/offline.html";
const MAX_ENTRIES = 300;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll([OFFLINE, "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("liftcut-") && key !== SHELL).map((key) => caches.delete(key)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = (await cache.keys()).filter((request) => new URL(request.url).pathname.startsWith("/_next/static/"));
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map((request) => cache.delete(request)));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    // Always from the network; only a failed load shows the static offline page.
    event.respondWith((async () => {
      try { return (await event.preloadResponse) || (await fetch(request)); }
      catch { return (await caches.match(OFFLINE)) || Response.error(); }
    })());
    return;
  }
  // Everything else except immutable, content-hashed build assets goes straight to the network.
  if (!url.pathname.startsWith("/_next/static/")) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok && response.type === "basic") event.waitUntil(cache.put(request, response.clone()).then(() => trim(cache)));
    return response;
  })());
});
