// @ts-check
// Saves from two windows of the app must not interleave: each save reads the file, compares it with what the window last saw, and writes. The
// Web Locks API makes those steps one at a time across windows, and a BroadcastChannel tells the other windows what was written.

export const SAVED_CHANNEL = 'org-pwa-saved';

/** @typedef {{ backend: string, id: string, hash: string | null }} SavedMessage */
/** @typedef {{ request: (name: string, options: { mode: string }, callback: () => Promise<unknown>) => Promise<unknown> }} LockManager */

/** @param {string} backend @param {string} id */
export function saveLockName(backend, id) {
  return `org-pwa-save:${backend}:${id}`;
}

/** Runs `work` while holding the exclusive lock for this file, where there are Web Locks; directly otherwise.
 * @template T
 * @param {string} backend
 * @param {string} id
 * @param {() => Promise<T>} work
 * @param {LockManager | null | undefined} [locks] */
export async function withSaveLock(backend, id, work, locks = typeof navigator === 'undefined' ? null : /** @type {{ locks?: LockManager }} */ (navigator).locks) {
  if (!locks || typeof locks.request !== 'function') return work();
  return /** @type {Promise<T>} */ (locks.request(saveLockName(backend, id), { mode: 'exclusive' }, work));
}

/** @param {unknown} value @returns {value is SavedMessage} */
export function isSavedMessage(value) {
  if (!value || typeof value !== 'object') return false;
  const m = /** @type {Record<string, unknown>} */ (value);
  return typeof m.backend === 'string' && typeof m.id === 'string' && (m.hash === null || typeof m.hash === 'string');
}

/** What a window does when another window saved a file: nothing (not the file open here, or already this version), a silent
 * reload (nothing unsaved here), or the usual "changed elsewhere" banner (unsaved edits here would be lost).
 * @param {unknown} message
 * @param {{ backend: string | null, id: string | null, dirty: boolean, knownHash: string | null }} open
 * @returns {'ignore' | 'reload' | 'conflict'} */
export function savedElsewhere(message, open) {
  if (!isSavedMessage(message) || !open.id || message.backend !== open.backend || message.id !== open.id) return 'ignore';
  if (message.hash !== null && message.hash === open.knownHash) return 'ignore';
  return open.dirty ? 'conflict' : 'reload';
}

/** Whether a save must first ask: another window of the app saved this file while this one has edits of its own that the other
 *  save does not contain, and the person has not yet merged, reloaded or chosen to overwrite. Like Emacs asking before it saves a
 *  file that changed on disk.
 * @param {{ pending: boolean, dirty: boolean }} tab */
export function needsSaveChoice(tab) {
  return tab.pending && tab.dirty;
}

/** @typedef {{ postMessage: (m: unknown) => void, close: () => void, onmessage: ((e: { data: unknown }) => void) | null }} Channel */

/** @param {(name: string) => Channel} [make] */
export function openSavedChannel(make = (name) => /** @type {Channel} */ (new BroadcastChannel(name))) {
  try {
    return make(SAVED_CHANNEL);
  } catch {
    return null;
  }
}

/** Tells the other windows that a file was written. Never throws: a window that misses it finds out at its next check.
 * @param {Channel | null} channel @param {SavedMessage} message */
export function announceSaved(channel, message) {
  try {
    channel?.postMessage(message);
  } catch {
    // closed channel or an unsupported environment
  }
}
