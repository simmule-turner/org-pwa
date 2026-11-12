// @ts-check
// The recently opened list in the app: what records a file in it, and the saved copies the closed entries keep for viewing
// without a connection (the text the app already caches under "doc:<path>"; src/recent-files.js has the list rules).
import { hasPendingChange } from '../src/outbox.js';
import { recentMaxOf } from '../src/recent-files.js';
import { S } from './app-state.js';
import { setStatus } from './editing.js';
import { recordRecentFile } from './settings.js';
import { kv } from './singletons.js';
import { VariableValueError } from '../src/variable-error.js';

/** @typedef {import('../src/recent-files.js').RecentFile} RecentFile */

/** recentf-max-saved-items from the global variables (null keeps the whole list); undefined when its value cannot be used (said in the status line, as for any variable). */
function recentLimit() {
  try {
    return recentMaxOf(S.globalVariables);
  } catch (err) {
    if (!(err instanceof VariableValueError)) throw err;
    setStatus(err.message);
    return undefined;
  }
}

/** The tab a file is open in, if any. @param {{ documentId: string, storageKind: string }} f @returns {{ tabId: number } | undefined} */
export function openTabOf(f) {
  return S.documentSessions.find((/** @type {import('../src/types.js').TabSession} */ s) => {
    const st = s.tabId === S.activeTabId ? S.state : s.state;
    return st && st.documentId === f.documentId && st.storageKind === f.storageKind;
  });
}

/** Whether the app holds a saved copy of the text of a file, to view when its server cannot be reached. @param {string} documentId */
export async function hasSavedCopy(documentId) {
  const cached = await kv.get('doc:' + documentId);
  const text = cached && typeof cached === 'object' && 'value' in cached ? cached.value : cached;
  return typeof text === 'string';
}

/**
 * Takes the saved copy of files that left the list, unless the file is open or holds changes not yet saved to the server.
 * @param {RecentFile[]} dropped
 */
export async function dropSavedCopies(dropped) {
  for (const f of dropped) {
    if (openTabOf(f) || (await hasPendingChange(kv, f.documentId))) continue;
    await kv.delete('doc:' + f.documentId);
  }
}

/**
 * A file was opened or saved: it goes to the front of the list.
 * @param {string} documentId
 * @param {string | null | undefined} storageKind
 * @param {boolean} [freshText] true when the saved text matches the file now (opened from it, saved to it); false for viewing its saved copy
 */
export async function trackRecent(documentId, storageKind, freshText = true) {
  if (storageKind === 'help') return; // Help is not a file
  const max = recentLimit();
  if (max === undefined) return;
  await dropSavedCopies(await recordRecentFile(kv, documentId, storageKind, max, freshText));
}

