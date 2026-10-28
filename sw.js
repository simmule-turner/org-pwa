const CACHE_NAME = 'org-pwa-shell-v641';

const SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './sandbox-frame.html',
  './README.org',
  './src/archive-model.js',
  './src/babel.js',
  './src/babel-args.js',
  './src/babel-blocks.js',
  './src/babel-cache.js',
  './src/babel-export.js',
  './src/noweb.js',
  './src/tangle.js',
  './src/extension-edit.js',
  './src/extension-net.js',
  './src/extensions.js',
  './src/attach.js',
  './src/calendar-grid.js',
  './src/checkbox-cookie.js',
  './src/search.js',
  './src/tags-match.js',
  './src/document-store.js',
  './src/fold-state.js',
  './src/outbox.js',
  './src/narrow-state.js',
  './src/org-parser.js',
  './src/affiliated.js',
  './src/agenda-diary.js',
  './src/agenda.js',
  './src/appt.js',
  './src/diary-file.js',
  './src/diary-entry.js',
  './src/plain-file.js',
  './src/text-edit.js',
  './src/text-syntax.js',
  './src/diary-sexp.js',
  './src/diary-hebrew.js',
  './src/solar-emacs.js',
  './src/sexp-eval.js',
  './src/diary-lisp.js',
  './src/org-lisp.js',
  './src/agenda-lisp.js',
  './src/calendar-lisp.js',
  './src/babel-elisp.js',
  './src/lisp-init.js',
  './src/elisp.js',
  './src/elisp-data.js',
  './src/elisp-read.js',
  './src/elisp-core.js',
  './src/elisp-lib.js',
  './src/elisp-regex.js',
  './src/repeater-shift.js',
  './src/list-edit.js',
  './src/log-settings.js',
  './src/todo-transition.js',
  './src/reschedule.js',
  './src/archive-refile-details.js',
  './src-browser/archive-refile-panel.js',
  './src-browser/containers.js',
  './src-browser/settings-theme.js',
  './src-browser/settings-quick.js',
  './src-browser/file-screen.js',
  './src/file-screen-model.js',
  './src/agenda-filter.js',
  './src/agenda-variables.js',
  './src/agenda-prefix.js',
  './src/agenda-sort.js',
  './src/agenda-search.js',
  './src/agenda-queries.js',
  './src/agenda-commands.js',
  './src/priorities.js',
  './src/holidays.js',
  './src/calendar-conv.js',
  './src/calendar-chinese.js',
  './src/calendar-holidays.js',
  './src/solar-holidays.js',
  './src/html-doctype.js',
  './src/inline-tasks.js',
  './src/lisp-load.js',
  './src/diary-nongregorian.js',
  './src/diary-calendar.js',
  './src-browser/local-file-add.js',
  './src-browser/agenda-seed.js',
  './src/caldav-client.js',
  './src/calendar-from-agenda.js',
  './src/calendar-mirror.js',
  './src/contacts-mirror.js',
  './src/capture-shared.js',
  './src/capture-lisp.js',
  './src/capture-template.js',
  './src/format-time.js',
  './src/js-inspect.js',
  './src/line-endings.js',
  './src/local-variables.js',
  './src/refile.js',
  './src/clock.js',
  './src/org-duration.js',
  './src/effort-values.js',
  './src/broken-links.js',
  './src/clock-reminder.js',
  './src/code-lines.js',
  './src/line-numbers.js',
  './src/completion.js',
  './src/merge3.js',
  './src/command-palette.js',
  './src/history-store.js',
  './src/query-replace.js',
  './src/emacs-regex.js',
  './src/export-org.js',
  './src/org-interpret.js',
  './src/ox-icalendar.js',
  './src/org-table-layout.js',
  './src/org-plot.js',
  './src/clocktable.js',
  './src/extra-menu.js',
  './src/menu-alias.js',
  './src/multi-entry-format.js',
  './src/text-normalize.js',
  './src/hex-alpha.js',
  './src/org-weather.js',
  './src/god-mode-hints.js',
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
  './src/vendor/mathjs/mathjs-custom.min.js',
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
  './src/smart-quotes.js',
  './src/link-abbrev.js',
  './src/link-resolve.js',
  './src/link-string.js',
  './src/id-locations.js',
  './src/tag-inheritance.js',
  './src/targets.js',
  './src/setupfile.js',
  './src/cite.js',
  './src/footnotes.js',
  './src-browser/bibliography.js',
  './src-browser/footnotes-ui.js',
  './src-browser/setupfile.js',
  './src/export-links.js',
  './src/export-odt.js',
  './src/ox-odt.js',
  './src/odt-assets.js',
  './src/zip-writer.js',
  './src/ascii-fill.js',
  './src/lisp-read.js',
  './src/latex-config.js',
  './src/export-ascii.js',
  './src/entities.js',
  './src/org-elements.js',
  './src/syntax-highlight.js',
  './src/export-html.js',
  './src/export-beamer.js',
  './src/export-latex.js',
  './src/export-slides.js',
  './src/macro-eval.js',
  './src/export-latex-zip.js',
  './src/latex-cite.js',
  './src/latex-table.js',
  './src/table-model.js',
  './src/table-number.js',
  './src/entities-latex.js',
  './src/export-options.js',
  './src/export-include.js',
  './src/export-icalendar.js',
  './src/export-vcard.js',
  './src/import-icalendar.js',
  './src/import-vcard.js',
  './src/undo-history.js',
  './src/secret-box.js',
  './src/connection-secrets.js',
  './src/settings-history.js',
  './src/text-diff.js',
  './src/startup-config.js',
  './src/webm-track-detect.js',
  './src/scroll-util.js',
  './src/table-formula.js',
  './src/types.js',
  './src/settings-layout.js',
  './src/export-defaults.js',
  './src/habit.js',
  './src-browser/habit-history.js',
  './src-browser/agenda-settings.js',
  './src/calc-complex.js',
  './src/calc-symbolic.js',
  './src/calc-simplify.js',
  './src/calc-solve.js',
  './src/calc-deriv.js',
  './src/calc-prfac.js',
  './src/calc-vector.js',
  './src-browser/contacts-sync.js',
  './src-browser/mirror-sync.js',
  './src-browser/ui-widgets.js',
  './src-browser/app-state.js',
  './src-browser/dom.js',
  './src-browser/adapters.js',
  './src-browser/agenda-files.js',
  './src-browser/agenda-actions.js',
  './src-browser/agenda-row-focus.js',
  './src-browser/holiday-list.js',
  './src-browser/bottom-sheet.js',
  './src-browser/view-filter-ui.js',
  './src-browser/agenda-view.js',
  './src-browser/agenda-query-view.js',
  './src-browser/search-chooser.js',
  './src-browser/find-in-view.js',
  './src-browser/diary-file-load.js',
  './src-browser/lisp-init-load.js',
  './src-browser/lisp-settings.js',
  './src-browser/diary-flow.js',
  './src-browser/diary-sheets.js',
  './src-browser/text-view.js',
  './src-browser/archive-flow.js',
  './src-browser/attachments-flow.js',
  './src-browser/attach-preview.js',
  './src-browser/attach-folder-panel.js',
  './src-browser/clock-watch.js',
  './src-browser/line-marks.js',
  './src-browser/heading-pick.js',
  './src-browser/camera-capture.js',
  './src-browser/attachments-store.js',
  './src-browser/audio-recording.js',
  './src-browser/calendar-panel.js',
  './src-browser/capture-templates.js',
  './src-browser/capture-ui.js',
  './src-browser/chrome.js',
  './src-browser/clock-flow.js',
  './src-browser/dialogs.js',
  './src-browser/documents-io.js',
  './src-browser/editing.js',
  './src-browser/export-import.js',
  './src-browser/export-images.js',
  './src-browser/external-sync.js',
  './src-browser/file-menu.js',
  './src-browser/general-editor.js',
  './src-browser/gestures-structure.js',
  './src-browser/god-mode-palette.js',
  './src-browser/calendar-sync.js',
  './src-browser/capture-shortcuts.js',
  './src-browser/launch-params.js',
  './src-browser/local-folder.js',
  './src-browser/platform.js',
  './src-browser/line-endings-adapter.js',
  './src-browser/floating-keyboard.js',
  './src-browser/god-mode-hints.js',
  './src-browser/heading-commands.js',
  './src-browser/inline-render.js',
  './src-browser/keyboard-focus.js',
  './src-browser/menus.js',
  './src-browser/navigation.js',
  './src-browser/refile-flow.js',
  './src-browser/render.js',
  './src-browser/babel-flow.js',
  './src-browser/extension-events.js',
  './src-browser/extension-flow.js',
  './src-browser/extension-file.js',
  './src-browser/extension-links.js',
  './src-browser/tangle-flow.js',
  './src-browser/extension-services.js',
  './src-browser/extension-run.js',
  './src-browser/babel-run.js',
  './src-browser/heading-drag.js',
  './src-browser/row-render.js',
  './src-browser/save-out.js',
  './src-browser/search-ui.js',
  './src-browser/settings-view.js',
  './src-browser/settings-shell.js',
  './src-browser/version.js',
  './src-browser/buffer-rename.js',
  './src-browser/buffers.js',
  './src-browser/id-links.js',
  './src-browser/id-locations.js',
  './src-browser/tag-display.js',
  './src-browser/minibuffer-prompt.js',
  './src-browser/settings-export.js',
  './src-browser/table-recalc.js',
  './src-browser/tabs.js',
  './src-browser/todo-workflow.js',
  './src-browser/views.js',
  './src-browser/weather-flow.js',
  './src-browser/appt-flow.js',
  './src-browser/field-groups.js',
  './src-browser/agenda-format.js',
  './src-browser/appearance.js',
  './src-browser/settings-fields.js',
  './src-browser/singletons.js',
  './src-browser/constants.js',
  './src-browser/doc-helpers.js',
  './src-browser/display-info.js',
  './src-browser/key-log.js',
  './src-browser/update-log.js',
  './src-browser/sync-helpers.js',
  './src-browser/render-helpers.js',
  './src-browser/indexeddb-adapter.js',
  './src-browser/filesystem-adapter.js',
  './src-browser/github-adapter.js',
  './src-browser/webdav-adapter.js',
  './src-browser/input-file-adapter.js',
  './src-browser/settings.js',
  './src-browser/settings-history.js',
  './src-browser/connection-vault.js',
  './src-browser/connection-protection.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Tells open pages what this worker is doing, for the update log (palette: Copy update and startup log). Best effort.
function tellPages(what, detail) {
  try {
    self.clients
      .matchAll({ includeUncontrolled: true })
      .then((list) => list.forEach((c) => c.postMessage({ type: 'SW_LOG', what, detail })))
      .catch(() => {});
  } catch {
    // no clients to tell
  }
}

self.addEventListener('install', (event) => {
  const installStart = Date.now();
  tellPages(CACHE_NAME + ' installing');
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
      // cache: 'reload' skips the browser's own HTTP cache, so this version's cache holds this version's files and never
      // copies an older response the browser still had saved for the same address.
      const results = await Promise.allSettled(SHELL_FILES.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
      const failed = results.map((r, i) => (r.status === 'rejected' ? SHELL_FILES[i] : null)).filter(Boolean);
      tellPages(CACHE_NAME + ' files fetched', { ms: Date.now() - installStart, files: SHELL_FILES.length, failed: failed.length, first: failed.slice(0, 3) });
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          console.warn('[sw] failed to cache', SHELL_FILES[i], result.reason);
        }
      });
      // The code carries its own version (src-browser/version.js). If the copy just cached names a different version, the files
      // came from somewhere stale: fail this install so the previous version keeps running and the next check tries again,
      // rather than label old code with this version.
      const stamp = await cache.match('./src-browser/version.js');
      const text = stamp ? await stamp.text() : '';
      if (!text.includes("'" + CACHE_NAME + "'")) {
        await caches.delete(CACHE_NAME);
        tellPages(CACHE_NAME + ' refused: files from another version');
        throw new Error('[sw] ' + CACHE_NAME + ' was given files from another version; not installing');
      }
      tellPages(CACHE_NAME + ' installed', { ms: Date.now() - installStart });
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
    tellPages(CACHE_NAME + ' got the take-over request');
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

// Tapping an agenda reminder opens that day: an open window is told which day, and a closed app is launched with it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const day = event.notification.data && event.notification.data.day;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows[0];
      if (open) {
        open.postMessage({ type: 'appt-open', day });
        return open.focus();
      }
      return self.clients.openWindow('./?appt-day=' + encodeURIComponent(day));
    })
  );
});

self.addEventListener('activate', (event) => {
  const activateStart = Date.now();
  tellPages(CACHE_NAME + ' activate event began');
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => {
        tellPages(CACHE_NAME + ' old caches deleted', { ms: Date.now() - activateStart });
        return self.clients.claim();
      })
      .then(() => tellPages(CACHE_NAME + ' active', { ms: Date.now() - activateStart }))
  );
});

// Cache-first for app-shell files, network fallback for anything else.
// Deliberately does NOT intercept File System Access API calls (those
// aren't network requests, so there's nothing to catch here) — offline
// support covers "the app loads and renders", not "disk sync works
// offline", which is what the outbox/sync-engine split already handles at
// the data layer.
self.addEventListener('fetch', (event) => {
  // Only the app's own files (a GET to this address) are answered here. Everything else -- a sync to a WebDAV, CalDAV or CardDAV
  // server, GitHub, the weather -- goes straight to the network. Passing those through this worker would keep this worker busy for
  // as long as the server takes to answer, and a new version cannot take over from a worker that still has requests open, so
  // an unreachable server delayed an update by minutes.
  const request = event.request;
  if (request.method && request.method !== 'GET') return;
  if (self.location && self.location.origin && new URL(request.url).origin !== self.location.origin) return;
  // A launch from the share sheet or an icon shortcut is a navigation to index.html?capture=... . The cache holds
  // index.html without a query string, so match navigations ignoring it, or such a launch would need the network.
  const options = event.request.mode === 'navigate' ? { ignoreSearch: true } : undefined;
  event.respondWith(
    caches.match(event.request, options).then((cached) => cached || fetch(event.request))
  );
});
