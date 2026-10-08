// The one place the app asks "what can the platform I run on do, and how?". Everything here has a web default, which
// is what the PWA uses. A native shell (a Capacitor app, say) supplies its own implementations of the same shapes, either
// by setting `window.orgPwaPlatform` before the app loads or by calling installPlatform(); the rest of the app only ever
// calls `platform.something`, never the browser API behind it. The tests do the same with a fake platform.
//
//   name               'web' by default; a shell says what it is
//   localFiles         files on the device: the person picks one to open, or names a new one to save, and the app
//                      keeps a way back to it. supported() -- whether this platform can do that at all;
//                      pickOpen(kv) / pickNew(kv, suggestedName) -- ask the person, remember the choice in `kv`, and
//                      return the document id; adapter -- { read, write, exists, access } for those files
//   saveFile           saveFile(name, content, mimeType): hand a file to the person (a download, in a browser). May return a
//                      promise: resolving { where } says where it went (a shell may put it straight into a folder), or null
//                      if the person backed out; rejecting says why it failed. See save-out.js.
//   viewFile           viewFile(blob, name): show a file in whatever the platform views it with; may return a promise,
//                      which rejects with the reason if nothing can show it
//   clipboard          { readText(), writeText(text) }
//   usesServiceWorker  whether the app registers its service worker; a shell that bundles the app has no use for it
//   versionInfo        versionInfo(): the version being run, as text, for a platform that has no service worker to ask
//   pickFile           (optional) pickFile(): resolves { name, type, base64 } for a file the person picks or captures, for an
//                      attachment; a shell uses it to put the camera beside the files, as a browser's own chooser does. null
//                      means use the browser's file input. An AbortError means they backed out.
//   attachments        the org-pwa folder, which a browser has none of: where a LOCAL document's attachments go, and where
//                      `local:` files are found by name. supported(); folder() -- the folder chosen, { name }, or null;
//                      pickFolder() -- ask the person, resolving { name } (an AbortError if they back out); adapter --
//                      { readBinary(path) -> { base64 } or null, writeBinary(path, base64), delete(path), exists(path) }
//                      on paths relative to that folder
//   captureShortcuts   the launcher's own shortcuts for Capture: supported() -- whether there are any here; set(list) --
//                      publish one per capture template, `list` being [{ key, label }]; canPin() / pin({ key, label }) --
//                      put an icon for one on the home screen ('' as the key is the template list); info() -- what the
//                      launcher reports (its limit, what is published), for diagnosing, or null
//
//   notifications     system notifications, for agenda reminders (appt-flow.js). supported() -- whether there are any here;
//                      permission() -- 'granted' | 'denied' | 'default' (not asked yet), as a promise; request() -- ask, resolving
//                      the new permission; show({ id, title, body, day }) -- notify now, `day` being the start of the appointment's
//                      day in ms; scheduled -- true if the platform can hold notifications for later (a shell, which then
//                      announces appointments even while the app is closed); schedule(list) -- replace everything held with
//                      `list` ([{ id, at (Date), title, body, day }]); cancelAll() -- drop everything held; onTap(handler) --
//                      call handler(day) when the person taps a notification
//
// Share-in is not here: a shell hands the app a share through `window.orgPwaLaunch({ title, text, url })`, queueing on
// `window.orgPwaLaunchQueue` until the app has started (see acceptNativeLaunches in launch-params.js).
import { createFileSystemAccessAdapter, isFileSystemAccessSupported, pickAndRegisterFile, pickAndRegisterNewFile } from './filesystem-adapter.js';
import { downloadFile } from './input-file-adapter.js';
import { kv } from './singletons.js';

export const platform = {
  name: 'web',
  localFiles: {
    supported: isFileSystemAccessSupported,
    pickOpen: pickAndRegisterFile,
    pickNew: pickAndRegisterNewFile,
    adapter: createFileSystemAccessAdapter(kv),
  },
  saveFile: downloadFile,
  viewFile(blob) {
    window.open(URL.createObjectURL(blob), '_blank');
  },
  clipboard: {
    readText: () => navigator.clipboard.readText(),
    writeText: (text) => navigator.clipboard.writeText(text),
  },
  usesServiceWorker: true,
  versionInfo: async () => null,
  pickFile: null,
  attachments: {
    supported: () => false,
    folder: async () => null,
    pickFolder: async () => {
      throw new Error('no folder can be chosen here');
    },
    adapter: null,
  },
  // A browser has no launcher shortcuts to publish here; the installed PWA gets its one Capture shortcut from the manifest.
  captureShortcuts: {
    supported: () => false,
    set: async () => {},
    canPin: async () => false,
    pin: async () => false,
    info: async () => null,
  },
  // A browser can show a notification while the app is open; it cannot hold one for later, so the app announces them itself.
  notifications: {
    supported: () => typeof Notification !== 'undefined',
    permission: async () => (typeof Notification === 'undefined' ? 'denied' : Notification.permission),
    request: async () => (typeof Notification === 'undefined' ? 'denied' : Notification.requestPermission()),
    scheduled: false,
    async show({ id, title, body, day }) {
      const options = { body, tag: `appt-${id}`, data: { day }, requireInteraction: true, renotify: true }; // the tag makes a repeat replace the one before; requireInteraction keeps it until answered (where the browser honours that)
      const registration = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (registration && registration.showNotification) await registration.showNotification(title, options);
      else new Notification(title, options);
    },
    schedule: async () => {},
    cancelAll: async () => {},
    onTap: (handler) => {
      // the service worker tells an open app which day was tapped (see sw.js, notificationclick)
      if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (event) => event.data && event.data.type === 'appt-open' && handler(event.data.day));
    },
  },
};

/** Replaces any part of the platform. A group (localFiles, clipboard) is merged, so a shell can override just the
 *  pieces it needs; anything else is replaced as a whole. */
export function installPlatform(overrides) {
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value && typeof value === 'object' && platform[key] && typeof platform[key] === 'object') Object.assign(platform[key], value);
    else platform[key] = value;
  }
  return platform;
}

// A shell injects its platform before the app starts, so it is in place from the first line that uses it.
if (typeof globalThis !== 'undefined' && globalThis.orgPwaPlatform) installPlatform(globalThis.orgPwaPlatform);
