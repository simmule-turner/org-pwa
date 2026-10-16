// @ts-check
// The remembered ID -> file table (src/id-locations.js), kept in the key-value store. Only GitHub and WebDAV files are recorded:
// a link can reopen those by path, where a local file needs the file picker.
import { recordIds } from '../src/id-locations.js';
import { kv } from './singletons.js';

const KEY = 'id-locations';
/** @type {{ table: import('../src/id-locations.js').IdTable | null }} */
const loaded = { table: null };

/** @returns {Promise<import('../src/id-locations.js').IdTable>} */
async function table() {
  if (loaded.table) return loaded.table;
  /** @type {import('../src/id-locations.js').IdTable} */ let found = {};
  try {
    const saved = await kv.get(KEY);
    const parsed = saved && typeof saved.value === 'string' ? JSON.parse(saved.value) : null;
    if (parsed && typeof parsed === 'object') found = parsed;
  } catch {
    // an unreadable table is just an empty one; it refills as files are opened
  }
  loaded.table = found;
  return found;
}

/** @param {string | null | undefined} kind */
function linkScheme(kind) {
  return kind === 'github' || kind === 'webdav' ? kind : null;
}

/** Notes where a file's IDs are. Safe to call often; it writes only when something changed.
 * @param {import('../src/types.js').Doc} doc
 * @param {string | null | undefined} storageKind
 * @param {string} documentId */
export async function rememberIds(doc, storageKind, documentId) {
  const scheme = linkScheme(storageKind);
  if (!scheme || !doc) return;
  try {
    const t = await table();
    if (recordIds(t, doc, scheme, documentId)) await kv.set(KEY, JSON.stringify(t));
  } catch (err) {
    console.error('Failed to remember IDs:', err);
  }
}

/** @param {string} id
 * @returns {Promise<import('../src/id-locations.js').IdLocation | null>} */
export async function lookupIdLocation(id) {
  return (await table())[id.toLowerCase()] || null;
}

/** @param {string} id */
export async function forgetIdLocation(id) {
  const t = await table();
  if (delete t[id.toLowerCase()]) await kv.set(KEY, JSON.stringify(t)).catch(() => {});
}
