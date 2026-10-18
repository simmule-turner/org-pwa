// @ts-check
// Which files are Org and which are plain text. A plain text file (a diary, a notes.txt, a README.md) opens in the Text view only:
// it has no headings, and a "#+" line or a Local Variables block in it means nothing.

/** The last part of a document id: the path of a file, or the name a new buffer was given (after a "|"). @param {string} documentId */
export function documentName(documentId) {
  const id = String(documentId || '');
  const afterBar = id.includes('|') ? id.slice(id.indexOf('|') + 1) : id;
  return afterBar.split('/').pop() || '';
}

/** Whether a file name is an Org file or an Org archive. @param {string} name */
export function isOrgFileName(name) {
  return /\.org$|_archive$/i.test(name);
}

/** Whether a document is a plain text file: one that came from a file (GitHub, WebDAV or a local file) and is not named like an Org file.
 *  A buffer with no file yet, and the Help, are Org.
 * @param {string} documentId
 * @param {string | null | undefined} storageKind */
export function isPlainTextFile(documentId, storageKind) {
  if (storageKind !== 'github' && storageKind !== 'webdav' && storageKind !== 'filesystem' && storageKind !== 'input') return false;
  return !isOrgFileName(documentName(documentId));
}
