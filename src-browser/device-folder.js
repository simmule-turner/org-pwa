// @ts-check
// A real folder of this device in a browser that can open one (Chrome and Edge on desktop and ChromeOS, via the File System
// Access API's folder picker): the person chooses it once, the browser keeps the choice, and the Files view lists and manages it
// like GitHub or WebDAV. The browser asks again for access in each new session, which only a tap can answer.
//
// A file opened from this folder is registered under its path with the same single-file mechanism that "Choose a file" uses
// (filesystem-adapter.js), so opening, saving and the "changed elsewhere" checks need nothing new; the paths are remembered here
// so the Files view knows which open tabs live in the folder.
import { createDirIo, splitPath } from './dir-io.js';
import { folderAvailable } from './local-folder.js';
import { platform } from './platform.js';
import { kv as typedKv } from './singletons.js';

const kv = /** @type {import('../src/types.js').KvAdapter} */ (/** @type {unknown} */ (typedKv));

const ROOT_KEY = 'devicefolder:root';
const PATHS_KEY = 'devicefolder:paths';
const MAX_PATHS = 500;

/** The parts of a folder handle used here (queryPermission and requestPermission are not in every TypeScript library). @typedef {{ name: string, queryPermission: (o: { mode: string }) => Promise<string>, requestPermission: (o: { mode: string }) => Promise<string> }} FolderHandle */

/** Whether this browser can open a folder of the device (and the app has no folder of its own to list). */
export function dirPickerSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window && !folderAvailable();
}

/** @type {Set<string>} */
const known = new Set();
const loadState = { done: false };

/** Loads the paths of the files opened from the folder. */
export async function loadKnownPaths() {
  if (loadState.done) return;
  try {
    const stored = await kv.get(PATHS_KEY);
    known.clear();
    for (const path of Array.isArray(stored && stored.value) ? stored.value : []) known.add(path);
  } catch {
    known.clear();
  }
  loadState.done = true;
}

/** Whether the file at `path` was opened from the chosen folder. @param {string} path */
export function isFolderPath(path) {
  return known.has(path.replace(/^\/+/, ''));
}

/** @param {string} path */
async function remember(path) {
  known.delete(path);
  known.add(path);
  while (known.size > MAX_PATHS) known.delete(/** @type {string} */ (known.values().next().value));
  try {
    await kv.set(PATHS_KEY, [...known]);
  } catch {
    /* kept in memory for this session */
  }
}

/** @returns {Promise<(FolderHandle & Record<string, any>) | null>} the folder handle the person chose, or null */
async function rootHandle() {
  try {
    const stored = await kv.get(ROOT_KEY);
    return stored ? stored.value : null;
  } catch {
    return null;
  }
}

/** What the browser allows for the chosen folder now, without asking: its name and 'granted', 'prompt' or 'none' (no folder chosen).
 * @returns {Promise<{ name: string, access: 'granted' | 'prompt' | 'none' }>} */
export async function deviceFolderState() {
  const handle = await rootHandle();
  if (!handle) return { name: '', access: 'none' };
  try {
    return { name: handle.name, access: (await handle.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'granted' : 'prompt' };
  } catch {
    return { name: handle.name, access: 'prompt' };
  }
}

/** Asks the person for a folder (needs a tap) and keeps it. @returns {Promise<string>} its name */
export async function chooseDeviceFolder() {
  const handle = await /** @type {Window & { showDirectoryPicker: (o: object) => Promise<FolderHandle> }} */ (/** @type {unknown} */ (window)).showDirectoryPicker({ mode: 'readwrite', id: 'org-pwa-files' });
  await kv.set(ROOT_KEY, handle);
  known.clear();
  loadState.done = true;
  await kv.set(PATHS_KEY, []);
  return handle.name;
}

/** Asks the browser to allow the chosen folder again (needs a tap). @returns {Promise<boolean>} */
export async function allowDeviceFolder() {
  const handle = await rootHandle();
  if (!handle) return false;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Lists, reads, writes and deletes in the chosen folder; paths are relative to it. */
export const dirIo = createDirIo(rootHandle);

/** What lists and manages the files of "this device": the app's own folder where it keeps one, else the chosen folder. */
export function deviceIo() {
  return folderAvailable() ? /** @type {typeof dirIo} */ (/** @type {unknown} */ (platform.attachments.adapter)) : dirIo;
}

/** Makes the file at `path` of the chosen folder open and savable like any picked file: registers its handle under the path, creating an empty file when `create`.
 * @param {string} path @param {boolean} [create] */
export async function registerFolderFile(path, create = false) {
  const clean = path.replace(/^\/+/, '');
  const [folder, name] = splitPath(clean);
  const handle = await (await dirIo.dirAt(folder, create)).getFileHandle(name, { create });
  await kv.set('filehandle:' + clean, handle);
  await remember(clean);
}
