// Where an attachment can be kept for the open document. GitHub and WebDAV can always take one. A local document cannot in a
// browser: access to one file is not access to the folder around it, and a new file needs a fresh picker gesture. A native
// shell can do better. It asks the person for the org-pwa folder once and keeps permission to it (platform.attachments, see
// platform.js), and attachments then go under data/ there, exactly as on GitHub or WebDAV. That same folder is where
// `local:` files are found by name (local-folder.js). One folder serves every local document, since an attachment's path
// comes from its heading's :ID:, not from where the document is.
import { S } from './app-state.js';
import { setStatus } from './editing.js';
import { platform } from './platform.js';
import { imageDataUrlCache } from './singletons.js';

const isRemote = () => S.state.storageKind === 'github' || S.state.storageKind === 'webdav';
const isLocalWithFolders = () => S.state.storageKind === 'filesystem' && platform.attachments.supported();

/** Whether an attachment can be read, written or deleted for the open document right now. */
export function attachmentsAvailable() {
  return isRemote() || (isLocalWithFolders() && !!S.attachmentsFolder);
}

/** When attachmentsAvailable() is false only because no folder has been chosen yet, what to tell the person; otherwise
 *  null, and the caller's own explanation applies. */
export function attachmentsFolderMissingMessage() {
  return isLocalWithFolders() && !S.attachmentsFolder ? 'Choose the org-pwa folder first (the command \u201cChoose the org-pwa folder\u201d).' : null;
}

/** Learns which folder was chosen earlier, if the platform has one. Called at startup. */
export async function loadAttachmentsFolder() {
  if (!platform.attachments.supported()) return;
  try {
    const folder = await platform.attachments.folder();
    S.attachmentsFolder = folder && folder.name ? folder.name : null;
  } catch {
    S.attachmentsFolder = null;
  }
}

/** Asks the person for the org-pwa folder. Returns its name, or null if they backed out or it could not be used. */
export async function chooseAttachmentsFolder() {
  if (!platform.attachments.supported()) {
    setStatus('Choosing the org-pwa folder is available in the Android app.');
    return null;
  }
  try {
    const folder = await platform.attachments.pickFolder();
    S.attachmentsFolder = folder.name;
    // images already read from a local document's attachments came from the old folder
    for (const key of [...imageDataUrlCache.keys()]) if (key.startsWith('filesystem:')) imageDataUrlCache.delete(key);
    setStatus(`The org-pwa folder is \u201c${folder.name}\u201d: attachments and local: files go there.`);
    return folder.name;
  } catch (error) {
    if (!(error && error.name === 'AbortError')) setStatus(`Couldn't use that folder: ${error && error.message ? error.message : error}`);
    return null;
  }
}

/** For anything about to write an attachment: 'ok'; 'cancelled' (the person backed out of choosing a folder); or
 *  'unavailable' (nothing here can hold attachments). Asks for the folder if that is all that is missing. */
export async function ensureAttachmentsStorage() {
  if (attachmentsAvailable()) return 'ok';
  if (!isLocalWithFolders()) return 'unavailable';
  return (await chooseAttachmentsFolder()) ? 'ok' : 'cancelled';
}
