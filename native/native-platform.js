// Runs before the app does (scripts/sync.mjs puts a <script> for it ahead of app.js). It tells the app it is inside the
// native shell, and connects the shell's native pieces to it. Everything not set here stays the browser default until a
// native implementation is added. See src-browser/platform.js in the app for the shapes.
(function () {
  var capacitor = window.Capacitor;
  var kind = capacitor && typeof capacitor.getPlatform === 'function' ? capacitor.getPlatform() : null;

  // The platform: it has a name, and it does not register the service worker, because the shell bundles the app.
  window.orgPwaPlatform = {
    name: kind ? 'capacitor-' + kind : 'capacitor',
    usesServiceWorker: false,
  };

  // Shares from other apps. The app is not running yet, so shares are queued, and orgPwaLaunch is where the shell sends
  // one; the app replaces it with the real thing once it has started, and runs whatever was queued (acceptNativeLaunches
  // in src-browser/launch-params.js). A payload is { title, text, url }.
  var queue = (window.orgPwaLaunchQueue = []);
  window.orgPwaLaunch = function (payload) {
    queue.push(payload);
  };

  // ShareTargetPlugin (native/android/.../ShareTargetPlugin.java) raises "shareReceived" for text shared to the app. A
  // share that started the app was retained natively, so it arrives as soon as this listener is registered.
  if (capacitor && typeof capacitor.registerPlugin === 'function') {
    try {
      var shareTarget = capacitor.registerPlugin('ShareTarget');
      var listening = shareTarget.addListener('shareReceived', function (share) {
        window.orgPwaLaunch(share); // looked up on each call, so it reaches the app's own function once that exists
      });
      if (listening && typeof listening.catch === 'function') {
        listening.catch(function (error) {
          console.warn('org-pwa: sharing into the app is unavailable:', error && error.message ? error.message : error);
        });
      }
    } catch (error) {
      console.warn('org-pwa: sharing into the app is unavailable:', error && error.message ? error.message : error);
    }
  }
})();
