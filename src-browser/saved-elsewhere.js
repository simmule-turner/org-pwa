// @ts-check
// Another window of the app saved a file. If it is the one open here: with no unsaved edits it is reloaded quietly; with unsaved
// edits the "changed elsewhere" banner (Reload / Merge / Dismiss) is shown, the same as for a change made by another program.
import { savedElsewhere } from '../src/save-lock.js';
import { diskAdapterFor, reloadCurrentDocumentFromDisk, showExternalChangeBanner } from './external-sync.js';
import { savedChannel } from './adapters.js';
import { S } from './app-state.js';
import { setStatus } from './editing.js';

/** @param {unknown} message */
export async function handleSavedElsewhere(message) {
  const documentId = S.state.documentId;
  if (!documentId || !S.state.storageKind) return;
  const verdict = savedElsewhere(message, {
    backend: diskAdapterFor(S.state.storageKind).backend,
    id: documentId,
    dirty: S.isDirty,
    knownHash: null,
  });
  if (verdict === 'ignore') return;
  const hash = /** @type {{ hash?: string | null }} */ (message).hash ?? null;
  if (verdict === 'conflict') {
    showExternalChangeBanner(hash);
    return;
  }
  try {
    await reloadCurrentDocumentFromDisk();
    setStatus(`"${documentId}" was saved in another window — reloaded.`);
  } catch (err) {
    setStatus('Reload failed: ' + /** @type {Error} */ (err).message);
  }
}

export function listenForSavedElsewhere() {
  if (savedChannel) savedChannel.onmessage = (event) => void handleSavedElsewhere(event.data);
}
