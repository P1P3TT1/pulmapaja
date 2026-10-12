"use strict";

/* Service worker: makes Pulmapaja installable and lets it work offline.

   The app's own files are fetched network first, so an online visit always
   gets the latest version and every page load uses files of one version.
   Each successful response refreshes the cached copy, which is what an
   offline visit gets. Google Fonts are cached as they are first used.

   Bump VERSION when SHELL changes (a file added, renamed or removed), so the
   new list is cached and the old cache is dropped. */

const VERSION = "v1";
const CACHE = "pulmapaja-" + VERSION;
const FONTS = "pulmapaja-fonts";

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "styles/styles.css",
  "scripts/generators.js",
  "scripts/codec.js",
  "scripts/vendor/qrcode.js",
  "scripts/script.js",
  "scripts/store.js",
  "scripts/play.js",
  "scripts/pwa.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL.map(p => new Request(p, {cache: "reload"}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith("pulmapaja-") && k !== CACHE && k !== FONTS)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, url));
  } else if (url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(req));
  } else if (url.hostname === "fonts.googleapis.com") {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function networkFirst(req, url) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, {ignoreSearch: true});
    if (hit) return hit;
    /* a link with a puzzle code may carry a query string; the app itself is
       always the cached start page */
    const scope = new URL(self.registration.scope);
    if (req.mode === "navigate" && (url.pathname === scope.pathname || url.pathname === scope.pathname + "index.html")) {
      const start = await cache.match("./");
      if (start) return start;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(res => {
    if (res.ok || res.type === "opaque") cache.put(req, res.clone());
    return res;
  });
  if (hit) {
    fresh.catch(() => {});
    return hit;
  }
  return fresh;
}
