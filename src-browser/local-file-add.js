// @ts-check
// "Add a local file": the person picks a file once, and its handle is kept on this device (IndexedDB, through the file-picker
// adapter), so it can be named `local:NAME` in org-agenda-files and the like without opening it as a document first.
import { platform } from './platform.js';
import { kv } from './singletons.js';
import { refreshAgendaFiles } from './agenda-files.js';
import { setStatus } from './editing.js';

/** Asks for a file and remembers it under its own name. Needs a tap (the picker is a user-gesture API). */
export async function addLocalFile() {
  try {
    const name = await platform.localFiles.pickOpen(kv);
    setStatus(`Added \u201c${name}\u201d. Name it local:${name} in org-agenda-files; the browser asks for permission again when this device restarts.`);
    refreshAgendaFiles();
  } catch (error) {
    const e = /** @type {Error} */ (error);
    if (e && e.name !== 'AbortError') setStatus(`Couldn't add that file: ${e.message || e}`);
  }
}
