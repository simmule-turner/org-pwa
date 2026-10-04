// The org-pwa folder as a place for local files BY NAME. On Android the person chooses one folder, once (it starts at
// Documents/org-pwa), and the app keeps permission to it (platform.attachments, see platform.js). A local file the person has
// opened through the file picker is found by its name, as before; any other name, in `local:contacts.org` in
// org-agenda-files, org-contacts-files or org-refile-targets, in a capture template's file, in a link or in #+INCLUDE, is looked
// up in this folder. adapters.js falls back to it, so everything that reads or writes a local file gets this at once.
import { S } from './app-state.js';
import { platform } from './platform.js';

/** Whether the platform keeps such a folder and one has been chosen. */
export function folderAvailable() {
  return platform.attachments.supported() && !!S.attachmentsFolder;
}

// The folder service moves bytes, as base64; an org file is UTF-8 text.
function textToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToText(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/** `{ content, hash }` for the file at `path` in the folder, or null if it is not there. (The adapter wrapper in adapters.js
 *  derives the real hash and normalizes line endings, so the hash is left empty here.) */
export async function readFolderText(path) {
  const result = await platform.attachments.adapter.readBinary(path);
  return result ? { content: base64ToText(result.base64), hash: '' } : null;
}

/** Writes `content` to `path` in the folder, creating it (and its folders) if needed. */
export async function writeFolderText(path, content) {
  await platform.attachments.adapter.writeBinary(path, textToBase64(content));
  return { hash: '' };
}

export async function folderFileExists(path) {
  const adapter = platform.attachments.adapter;
  return adapter.exists ? !!(await adapter.exists(path)) : !!(await adapter.readBinary(path));
}
