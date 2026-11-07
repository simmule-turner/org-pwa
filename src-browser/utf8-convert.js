// @ts-check
// Convert to UTF-8…: a file that was not valid UTF-8 is open read-only (see src/utf8.js). This asks which encoding it is in, decodes the
// original bytes again with it, and makes the buffer editable. The next save writes UTF-8.
import { ENCODING_CHOICES, decodeNonUtf8, isNonUtf8, markConverted } from '../src/utf8.js';
import { pushSnapshot } from '../src/undo-history.js';
import { S } from './app-state.js';
import { confirmDialog, openButtonChoiceModal, promptText } from './dialogs.js';
import { restoreFromHistory, setStatus } from './editing.js';
import { render } from './render.js';

/** @returns {Promise<string | null>} the TextDecoder label chosen, or null if the person backed out */
function chooseEncoding() {
  return new Promise((resolve) => {
    let asking = false; // the "Other" question is still open
    const overlay = openButtonChoiceModal({
      label: 'This file is not UTF-8. Which encoding is it in?',
      buttons: [
        ...ENCODING_CHOICES.map(({ label, text }) => ({ text, onClick: () => resolve(label) })),
        {
          text: 'Other\u2026',
          onClick: async () => {
            asking = true;
            resolve(await promptText('Encoding name (for example koi8-r, gb18030, euc-kr):', '', { okLabel: 'Use' }));
          },
        },
        { text: 'Cancel', onClick: () => resolve(null) },
      ],
    });
    // closing the modal with Escape or a tap outside runs no button
    new MutationObserver((_records, observer) => {
      if (!overlay.isConnected && !asking) {
        observer.disconnect();
        resolve(null);
      }
    }).observe(document.body, { childList: true });
  });
}

export async function convertToUtf8() {
  const documentId = S.state.documentId;
  if (!documentId || !isNonUtf8(documentId)) {
    setStatus('This file is already UTF-8.');
    return;
  }
  const label = await chooseEncoding();
  if (!label || !label.trim()) return;
  let text;
  try {
    text = decodeNonUtf8(documentId, label);
  } catch (err) {
    setStatus(/** @type {Error} */ (err).message);
    return;
  }
  const ok = await confirmDialog(
    `Read "${documentId}" as ${label.trim()} and make it editable? The next save writes the file as UTF-8, replacing its current ${label.trim()} bytes.`,
    { confirmLabel: 'Convert', danger: true }
  );
  if (!ok || S.state.documentId !== documentId) return;
  markConverted(documentId);
  S.isBufferReadOnly = false;
  S.history = pushSnapshot(S.history, text, `Converted from ${label.trim()} to UTF-8`);
  restoreFromHistory();
  S.isDirty = true;
  render();
  setStatus(`Converted from ${label.trim()}: the next save writes UTF-8.`);
}
