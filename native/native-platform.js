// Runs before the app does (scripts/sync.mjs puts a <script> for it ahead of app.js). It tells the app it is inside the
// native shell. For now that is all: the app gets a name, and it does not register its service worker, because the shell
// bundles the app and there is nothing to cache. Every other capability stays the browser default until a native
// implementation of it is added here. See src-browser/platform.js in the app for the shapes.
(function () {
  var capacitor = window.Capacitor;
  var kind = capacitor && typeof capacitor.getPlatform === 'function' ? capacitor.getPlatform() : null;
  window.orgPwaPlatform = {
    name: kind ? 'capacitor-' + kind : 'capacitor',
    usesServiceWorker: false,
  };
})();
