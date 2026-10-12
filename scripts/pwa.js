"use strict";

/* Registers the service worker (sw.js), which makes the app installable and
   lets it work offline. Skipped where it cannot work: a file:/// page, a
   browser without service workers, and the single-file artifact preview
   (tools/build-preview.mjs), which has no sw.js beside it. */

(() => {
  if (window.PULMAPAJA_PREVIEW) return;
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
})();
