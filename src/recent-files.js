// @ts-check
/**
 * The recently opened list, as Emacs's recentf keeps it: a file you open or save goes to the front, once (a name already
 * there moves), and the list is cut to `recentf-max-saved-items` (20 unless set). Files that are open are listed too.
 * Closing a file leaves the list alone, as in recentf (its kill-buffer hook only drops a file that is no longer readable);
 * opening a file that is already open just switches to it. `nil`, 0 or a negative number keeps the whole list (recentf-dump-variable
 * cuts only for a positive limit).
 */

import { VariableValueError } from './variable-error.js';

/** Emacs's default for recentf-max-saved-items. */
export const RECENTF_MAX_SAVED_ITEMS = 20;

/** @typedef {{ documentId: string, storageKind: string, openedAt: number, textAt?: number }} RecentFile `textAt` is when the saved copy of the text was last known to match the file (opened from it or saved to it). */

/**
 * The value of `recentf-max-saved-items` in a variables map: a whole number (a number, or a string holding one), or `nil`; 20,
 * Emacs's default, when unset. null means the whole list is kept (`nil`, 0 and negative numbers, as in Emacs).
 * @param {Record<string, unknown> | null | undefined} vars
 * @returns {number | null}
 */
export function recentMaxOf(vars) {
  const raw = vars ? vars['recentf-max-saved-items'] : undefined;
  if (raw === undefined || raw === null || raw === '') return RECENTF_MAX_SAVED_ITEMS;
  const text = String(raw).trim();
  if (/^nil$/i.test(text)) return null;
  if (!/^-?\d+$/.test(text)) throw new VariableValueError('recentf-max-saved-items', text, 'a whole number or nil');
  const n = Number(text);
  return n > 0 ? n : null;
}

/** @param {{ documentId: string, storageKind: string | null | undefined }} f */
export function recentKey(f) {
  return `${f.storageKind}\u0000${f.documentId}`;
}

/**
 * `recentf-add-file`: the file goes to the front and any earlier entry for it goes; the list keeps `max` entries.
 * @param {RecentFile[]} list
 * @param {{ documentId: string, storageKind: string }} file
 * @param {number | null} max null keeps the whole list
 * @param {number} [now]
 * @param {boolean} [freshText] this is a moment the saved text matches the file (an open from it, a save); false (closing, viewing a saved copy) keeps the time the entry had
 * @returns {RecentFile[]}
 */
export function pushRecent(list, file, max, now = Date.now(), freshText = true) {
  const key = recentKey(file);
  const before = list.find((f) => recentKey(f) === key);
  const next = list.filter((f) => recentKey(f) !== key);
  const textAt = freshText ? now : before ? before.textAt ?? before.openedAt : now;
  next.unshift({ documentId: file.documentId, storageKind: file.storageKind, openedAt: now, textAt });
  return max === null ? next : next.slice(0, max);
}

/**
 * The entries a change of the list took out (cut off by the limit, removed, cleared).
 * @param {RecentFile[]} before @param {RecentFile[]} after
 */
export function droppedRecent(before, after) {
  const kept = new Set(after.map(recentKey));
  return before.filter((f) => !kept.has(recentKey(f)));
}

/**
 * When a saved copy dates from, in words for a prompt: the time for today, the day and time for another day.
 * @param {number} at @param {number} now @param {string} [locale]
 */
export function savedCopyTime(at, now, locale) {
  const d = new Date(at);
  const today = new Date(now);
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay
    ? d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * @param {RecentFile[]} list
 * @param {{ documentId: string, storageKind: string }} file
 * @returns {RecentFile[]}
 */
export function removeRecent(list, file) {
  const key = recentKey(file);
  return list.filter((f) => recentKey(f) !== key);
}

/**
 * The rows of the File menu: each entry with where it stands. A file you are looking at is "current", another open one is
 * "open", and one that is closed is "closed" (it can be viewed from its saved copy when the server cannot be reached).
 * @param {RecentFile[]} list
 * @param {Set<string>} openKeys recentKey of every open file
 * @param {string | null} currentKey recentKey of the file in view
 * @returns {(RecentFile & { state: 'current' | 'open' | 'closed' })[]}
 */
export function recentRows(list, openKeys, currentKey) {
  return list.map((f) => {
    const key = recentKey(f);
    return { ...f, state: key === currentKey ? 'current' : openKeys.has(key) ? 'open' : 'closed' };
  });
}
