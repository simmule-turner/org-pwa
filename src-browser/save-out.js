// @ts-check
// Hands a file to the person (an export, a backup, an attachment saved out) through the platform, and says where it went. A
// browser downloads it and the person already sees that, so it says nothing; a native shell may put it straight into a folder
// (Downloads, on Android) with no screen in between, so what it reports is the only way to know. A failure is reported rather
// than lost. See saveFile in platform.js.
import { setStatus } from './editing.js';
import { platform } from './platform.js';

/**
 * @param {string} name
 * @param {BlobPart} content
 * @param {string | undefined} [mimeType]
 * @param {{ share?: boolean }} [options] share: offer the file to the system share sheet (on iOS that has Save to Files; a
 *   downloaded .ics there goes straight to Calendar), and download it when the device cannot share files
 */
export async function saveOut(name, content, mimeType, options = {}) {
  try {
    if (options.share && (await shareFile(name, content, mimeType))) return;
    const result = await platform.saveFile(name, content, mimeType);
    if (result && result.where) setStatus(`Saved “${name}” to ${result.where}.`);
  } catch (error) {
    setStatus(`Couldn't save “${name}”: ${error && error.message ? error.message : error}`);
  }
}

/** True when the share sheet took the file (or the person closed it); false when this device cannot share files.
 * @param {string} name @param {BlobPart} content @param {string | undefined} mimeType */
async function shareFile(name, content, mimeType) {
  const nav = /** @type {any} */ (typeof navigator === 'undefined' ? null : navigator);
  if (!nav || typeof nav.share !== 'function' || typeof File === 'undefined') return false;
  const file = new File([content], name, { type: mimeType || 'text/plain' });
  if (typeof nav.canShare === 'function' && !nav.canShare({ files: [file] })) return false;
  try {
    await nav.share({ files: [file], title: name });
  } catch (error) {
    if (!(error && error.name === 'AbortError')) throw error; // closing the sheet is not a failure
  }
  return true;
}
