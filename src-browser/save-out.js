// Hands a file to the person (an export, a backup, an attachment saved out) through the platform, and says where it went. A
// browser downloads it and the person already sees that, so it says nothing; a native shell may put it straight into a folder
// (Downloads, on Android) with no screen in between, so what it reports is the only way to know. A failure is reported rather
// than lost. See saveFile in platform.js.
import { setStatus } from './editing.js';
import { platform } from './platform.js';

export async function saveOut(name, content, mimeType) {
  try {
    const result = await platform.saveFile(name, content, mimeType);
    if (result && result.where) setStatus(`Saved \u201c${name}\u201d to ${result.where}.`);
  } catch (error) {
    setStatus(`Couldn't save \u201c${name}\u201d: ${error && error.message ? error.message : error}`);
  }
}
