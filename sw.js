const CACHE_NAME = 'org-pwa-shell-v40';

const SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './src/archive-model.js',
  './src/checkbox-cookie.js',
  './src/search.js',
  './src/document-store.js',
  './src/fold-state.js',
  './src/outbox.js',
  './src/org-parser.js',
  './src/agenda.js',
  './src/local-variables.js',
  './src/comment-model.js',
  './src/outline-view-model.js',
  './src/org-timestamp.js',
  './src/inline-markup.js',
  './src/sync-engine.js',
  './src/kv-adapter.js',
  './src/body-parser.js',
  './src/todo-cycle.js',
  './src/heading-edit.js',
  './src/body-edit.js',
  './src/link-resolve.js',
  './src/startup-config.js',
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
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
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
