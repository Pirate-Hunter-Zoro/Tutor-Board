/* ==========================================================================
   sw.js -- service worker.

   Its only job is to make the app shell open instantly and survive a dropped
   connection: HTML, CSS, JS, icons, and the KaTeX fonts are cached, so the
   board opens on the iPad even before the Tailscale link has come back up.

   It deliberately does NOT touch anything live. The SSE stream, the board
   payload, uploads, slate saves, and compiled figures all go straight to the
   network -- a cached lesson is a stale lesson, which is worse than none.
   ========================================================================== */

var VERSION = "board-shell-v21";

var SHELL = [
  "/",
  "/board",
  "/slate",
  "/static/home.css",
  "/static/home.js",
  "/static/typeface.css",
  "/static/typeface.js",
  "/static/board.css",
  "/static/board.js",
  "/static/macros.js",
  "/static/slate.css",
  "/static/slate-core.js",
  "/static/slate.js",
  "/static/katex/katex.min.css",
  "/static/katex/katex.min.js",
  "/static/katex/auto-render.min.js",
  "/manifest.webmanifest",
  "/icon-180.png",
  "/icon-192.png",
  "/icon-512.png",
];

/* KaTeX pulls its fonts lazily; they are cached on first use rather than
   listed here, because which faces a lesson needs depends on the mathematics. */
var RUNTIME = /\/static\/(katex\/fonts|fonts)\//;

/* Never intercepted. Live data, or a stream that must not be buffered. */
var LIVE = /^\/(events|board\.json|courses\.json|switch|say|upload|slate\/(save|state)|figure\/|uploads\/|slate\/page-)/;

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      /* One failure must not abort the whole install. */
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: "reload" })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; })
                             .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  if (LIVE.test(url.pathname)) return;

  if (RUNTIME.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
          return res;
        });
      })
    );
    return;
  }

  /* Shell: network first so a redeployed board is picked up on the next open,
     cache as the fallback when the node is unreachable. */
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match("/");
      });
    })
  );
});
