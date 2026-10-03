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
//   saveFile           saveFile(name, content, mimeType): hand a file to the person (a download, in a browser)
//   viewFile           viewFile(blob, name): show a file in whatever the platform views it with
//   clipboard          { readText(), writeText(text) }
//   usesServiceWorker  whether the app registers its service worker; a shell that bundles the app has no use for it
//
// Launch and share-in are not here: a launch is handed straight to runLaunch() in launch-params.js, which a shell calls
// with `{ capture, shared }` exactly as the share target and the launch URL do.
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
