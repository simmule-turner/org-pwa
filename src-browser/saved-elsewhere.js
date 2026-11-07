// @ts-check
// Another window of the app saved a file. If it is the one open here: with no unsaved edits it is reloaded quietly; with unsaved
// edits the "changed elsewhere" banner (Reload / Merge / Dismiss) is shown, the same as for a change made by another program.
import { savedElsewhere } from '../src/save-lock.js';
import { diskAdapterFor, reloadCurrentDocumentFromDisk, showExternalChangeBanner } from './external-sync.js';
import { savedChannel } from './adapters.js';
import { S } from './app-state.js';
import { setStatus } from './editing.js';
import { openButtonChoiceModal } from './dialogs.js';

/** @param {unknown} message */
export async function handleSavedElsewhere(message) {
  markOtherTabs(message);
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
    S.savedElsewherePending = true;
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

/** The same file open in another tab here, with edits of its own: a save there must ask too.
 * @param {unknown} message */
function markOtherTabs(message) {
  for (const session of S.documentSessions) {
    if (session.tabId === S.activeTabId || !session.state || !session.state.documentId || !session.state.storageKind) continue;
    const verdict = savedElsewhere(message, {
      backend: diskAdapterFor(session.state.storageKind).backend,
      id: session.state.documentId,
      dirty: !!session.isDirty,
      knownHash: null,
    });
    if (verdict === 'conflict') session.savedElsewherePending = true;
  }
}

/** Asks what a save should do about a save made in another window: Merge, Overwrite or Cancel (Escape cancels).
 * @param {string} documentId
 * @returns {Promise<'merge' | 'overwrite' | 'cancel'>} */
export function askSavedElsewhereChoice(documentId) {
  return new Promise((resolve) => {
    let answered = false;
    /** @param {'merge' | 'overwrite' | 'cancel'} answer */
    const answer = (answer) => {
      if (answered) return;
      answered = true;
      watch.disconnect();
      resolve(answer);
    };
    const overlay = openButtonChoiceModal({
      label: `"${documentId}" was saved in another window. Saving now would replace that save with this window's version.`,
      buttons: [
        { text: 'Merge', onClick: () => answer('merge') },
        { text: 'Overwrite', onClick: () => answer('overwrite') },
        { text: 'Cancel', onClick: () => answer('cancel') },
      ],
    });
    // Escape closes the dialog without pressing a button: that is a Cancel
    const watch = new MutationObserver(() => {
      if (!overlay.isConnected) setTimeout(() => answer('cancel'), 0);
    });
    watch.observe(document.body, { childList: true });
  });
}
