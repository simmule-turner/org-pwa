const CACHE_NAME = 'org-pwa-shell-v191';

const SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './README.org',
  './src/archive-model.js',
  './src/attach.js',
  './src/calendar-grid.js',
  './src/checkbox-cookie.js',
  './src/search.js',
  './src/document-store.js',
  './src/fold-state.js',
  './src/outbox.js',
  './src/org-parser.js',
  './src/agenda.js',
  './src/diary-sexp.js',
  './src/sexp-eval.js',
  './src/repeater-shift.js',
  './src/capture-template.js',
  './src/local-variables.js',
  './src/refile.js',
  './src/clock.js',
  './src/clocktable.js',
  './src/extra-menu.js',
  './src/menu-alias.js',
  './src/text-normalize.js',
  './src/hex-alpha.js',
  './src/org-weather.js',
  './src/god-mode.js',
  './src/math-render.js',
  './src/katex-export-css.js',
  // KaTeX -- LaTeX math fragment rendering (see src/math-render.js).
  // Vendored locally, woff2-only (no legacy woff/ttf fallback -- every
  // modern browser this PWA already requires supports woff2 directly).
  './src/vendor/katex/fonts/KaTeX_AMS-Regular.woff2',
  './src/vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2',
  './src/vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2',
  './src/vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2',
  './src/vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2',
  './src/vendor/katex/fonts/KaTeX_Main-Bold.woff2',
  './src/vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2',
  './src/vendor/katex/fonts/KaTeX_Main-Italic.woff2',
  './src/vendor/katex/fonts/KaTeX_Main-Regular.woff2',
  './src/vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2',
  './src/vendor/katex/fonts/KaTeX_Math-Italic.woff2',
  './src/vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2',
  './src/vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2',
  './src/vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2',
  './src/vendor/katex/fonts/KaTeX_Script-Regular.woff2',
  './src/vendor/katex/fonts/KaTeX_Size1-Regular.woff2',
  './src/vendor/katex/fonts/KaTeX_Size2-Regular.woff2',
  './src/vendor/katex/fonts/KaTeX_Size3-Regular.woff2',
  './src/vendor/katex/fonts/KaTeX_Size4-Regular.woff2',
  './src/vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2',
  './src/vendor/katex/katex.min.css',
  './src/vendor/katex/katex.min.js',
  './src/global-variables.js',
  './src/comment-model.js',
  './src/outline-view-model.js',
  './src/org-timestamp.js',
  './src/inline-markup.js',
  './src/table-cookies.js',
  './src/sync-engine.js',
  './src/kv-adapter.js',
  './src/body-parser.js',
  './src/todo-cycle.js',
  './src/progress-logging.js',
  './src/logbook.js',
  './src/heading-edit.js',
  './src/body-edit.js',
  './src/link-resolve.js',
  './src/export-markdown.js',
  './src/export-odt.js',
  './src/export-docx.js',
  './src/zip-writer.js',
  './src/export-ascii.js',
  './src/export-html.js',
  './src/export-options.js',
  './src/export-include.js',
  './src/export-icalendar.js',
  './src/undo-history.js',
  './src/text-diff.js',
  './src/startup-config.js',
  './src/webm-track-detect.js',
  './src/scroll-util.js',
  './src/table-formula.js',
  './src-browser/indexeddb-adapter.js',
  './src-browser/filesystem-adapter.js',
  './src-browser/github-adapter.js',
  './src-browser/webdav-adapter.js',
  './src-browser/input-file-adapter.js',
  './src-browser/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Individually, not cache.addAll(SHELL_FILES) -- addAll fails
      // ATOMICALLY (any single failed request rejects the whole call),
      // which meant one missing/unreachable file could prevent the
      // service worker from ever installing at all, breaking the
      // entire app rather than just that one file. A failure here is
      // logged (visible in the browser's own service worker console)
      // rather than silently swallowed, so a real deployment gap is
      // still discoverable -- just not fatal to everything else.
      const results = await Promise.allSettled(SHELL_FILES.map((url) => cache.add(url)));
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          console.warn('[sw] failed to cache', SHELL_FILES[i], result.reason);
        }
      });
    })
  );
  // Deliberately no self.skipWaiting() here. Calling it unconditionally
  // meant a new service worker silently took over control of already-open
  // tabs the moment it finished installing — the cache was updated, but
  // the tab's already-loaded JS kept running from memory regardless, so
  // nothing visibly changed and there was no prompt telling you a new
  // version existed. Without skipWaiting, the new worker parks in the
  // 'waiting' state until app.js explicitly tells it to take over (see
  // the 'message' listener below), which is what makes the update-banner
  // flow in app.js possible.
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for app-shell files, network fallback for anything else.
// Deliberately does NOT intercept File System Access API calls (those
// aren't network requests, so there's nothing to catch here) — offline
// support covers "the app loads and renders", not "disk sync works
// offline", which is what the outbox/sync-engine split already handles at
// the data layer.
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
