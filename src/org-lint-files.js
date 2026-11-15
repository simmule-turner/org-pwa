// @ts-check
// org-lint's checks of files (links to local files, SETUPFILE, INCLUDE, bibliographies) in the app's file model. Emacs asks the
// file system; the app knows only the storage of the document (a GitHub repository, a WebDAV folder, the chosen device folder),
// where a folder can be listed. A file is reported as non-existent only when the folder it should be in has been listed and the
// name is not there. A file whose place the app cannot tell (an absolute or `~` path, a path out of the storage, a folder that
// cannot be listed, an attachment, whose directory depends on the heading) counts as existing.
import { resolveImagePath } from './link-resolve.js';
import { orgLint } from './org-lint.js';

/** What `attachmentFile` gives for an attachment link: its directory is not known here, so the file counts as existing. */
export const ATTACHMENT_MARK = '\u0000attachment:';

/**
 * The path of a file name in the storage of the document, or null when the app cannot tell where it is.
 * @param {string} file @param {string} documentId
 */
export function storagePathOf(file, documentId) {
  if (file.startsWith(ATTACHMENT_MARK) || /^[/~\\]/.test(file) || /^[A-Za-z]:[/\\]/.test(file)) return null;
  const path = resolveImagePath(file, documentId);
  return path === '' ? null : path;
}

/**
 * The files among `files` that are not where the document's storage says: the ones whose folder could be listed without them.
 * @param {string[]} files
 * @param {string} documentId
 * @param {(folder: string) => Promise<string[] | null>} listFolder the names in a folder of the storage, or null when it cannot be listed
 * @returns {Promise<Set<string>>}
 */
export async function missingFiles(files, documentId, listFolder) {
  /** @type {Set<string>} */
  const missing = new Set();
  /** @type {Map<string, string[] | null>} */
  const listed = new Map();
  for (const file of files) {
    const path = storagePathOf(file, documentId);
    if (path === null) continue;
    const slash = path.lastIndexOf('/');
    const folder = slash < 0 ? '' : path.slice(0, slash);
    const name = path.slice(slash + 1);
    if (name === '') continue; // a folder name
    if (!listed.has(folder)) listed.set(folder, await listFolder(folder).catch(() => null));
    const names = listed.get(folder);
    if (names && !names.includes(name)) missing.add(file);
  }
  return missing;
}

/**
 * orgLint with the file checks answered from the storage: the files the checks ask about are collected, the missing ones found, and
 * the checks run again with those (and only those) as non-existent.
 * @param {string} text @param {string[] | null} names the checkers to run
 * @param {import('./org-lint.js').LintOptions} options
 * @param {string} documentId
 * @param {(folder: string) => Promise<string[] | null>} listFolder
 */
export async function orgLintInStorage(text, names, options, documentId, listFolder) {
  /** @type {Set<string>} */
  const asked = new Set();
  const known = { ...options, attachmentFile: (/** @type {string} */ f) => ATTACHMENT_MARK + f };
  orgLint(text, names, { ...known, fileExists: (f) => (f.startsWith(ATTACHMENT_MARK) ? true : (asked.add(f), true)) });
  const missing = await missingFiles([...asked], documentId, listFolder);
  return orgLint(text, names, { ...known, fileExists: (f) => !missing.has(f) });
}
