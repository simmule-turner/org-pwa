// @ts-check
// The Info manuals kept on this device: one record per manual under "info:manual:<name>" in the app's key-value store.
import { groupFiles, recordOf } from '../src/info-store.js';
import { kv } from './singletons.js';

/** @typedef {import('../src/info-store.js').ManualRecord} ManualRecord */

const PREFIX = 'info:manual:';

/** The name of the app's own manual, org-pwa.info: it ships with the app and cannot be removed. */
export const BUILTIN_MANUAL = 'org-pwa';

/** The app's own manual once read: it ships with the app and does not change while it runs. @type {Map<string, Promise<ManualRecord>>} */
const builtin = new Map();

/** The app's own manual, read once from the file that ships with the app. @returns {Promise<ManualRecord>} */
function builtinRecord() {
  const known = builtin.get(BUILTIN_MANUAL);
  if (known) return known;
  const reading = (async () => {
    const response = await fetch('./org-pwa.info');
    if (!response.ok) throw new Error('The manual org-pwa.info did not load (HTTP ' + response.status + ')');
    const text = await response.text();
    const [group] = groupFiles([{ name: 'org-pwa.info', text, encoding: 'utf-8', size: new TextEncoder().encode(text).length }]);
    if (group.status !== 'ready') throw new Error('org-pwa.info is not a whole Info file: ' + group.note);
    return recordOf(group, 0);
  })();
  builtin.set(BUILTIN_MANUAL, reading);
  reading.catch(() => builtin.delete(BUILTIN_MANUAL));
  return reading;
}

/** The app's own manual and every stored one, by name. @returns {Promise<ManualRecord[]>} */
export async function loadRecords() {
  const { keys } = await kv.list(PREFIX);
  /** @type {ManualRecord[]} */
  const records = [await builtinRecord()];
  for (const key of keys) {
    const entry = await kv.get(key);
    if (!entry) continue;
    const record = JSON.parse(String(entry.value));
    if (record.name !== BUILTIN_MANUAL) records.push(record);
  }
  return records.sort((a, b) => a.name.localeCompare(b.name));
}

/** @param {ManualRecord} record */
export async function saveRecord(record) {
  await kv.set(PREFIX + record.name, JSON.stringify(record));
}

/** @param {string} name */
export async function removeRecord(name) {
  await kv.delete(PREFIX + name);
}

const IMAGE_PREFIX = 'info:image:';

/** Keeps an image a manual names, as a data URL, under its file name (the name a manual gives it is looked up without a directory). @param {string} name @param {string} dataUrl */
export async function saveImage(name, dataUrl) {
  await kv.set(IMAGE_PREFIX + name.replace(/^.*\//, ''), dataUrl);
}

/** The data URL of an image kept on this device, or null. @param {string} src */
export async function loadImage(src) {
  const entry = await kv.get(IMAGE_PREFIX + src.replace(/^.*\//, ''));
  return entry ? String(entry.value) : null;
}

const BOOKMARKS = 'info:bookmarks';

/** @typedef {{ file: string, node: string, point: number }} InfoBookmark a node kept to return to (Info-bookmark-make-record: the manual, the node and where point was) */

/** The bookmarks on nodes, in the order they were made. @returns {Promise<InfoBookmark[]>} */
export async function loadBookmarks() {
  const entry = await kv.get(BOOKMARKS);
  if (!entry) return [];
  try {
    const list = JSON.parse(String(entry.value));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** @param {InfoBookmark[]} list */
export async function saveBookmarks(list) {
  await kv.set(BOOKMARKS, JSON.stringify(list));
}
