// @ts-check
// Fetches the files named by #+SETUPFILE: so the parser (which is synchronous) can use them. A relative name is read from the
// same place as the document (GitHub, WebDAV, the local folder); http(s) URLs are fetched directly. Whatever is fetched is
// kept in memory for the session (as Emacs keeps a fetched URL), not across sessions.
import { cacheSetupFile, missingSetupFiles, refreshSetupKeywords, setupFilePaths } from '../src/setupfile.js';
import { resolveImagePath } from '../src/link-resolve.js';
import { diskAdapterFor } from './external-sync.js';
import { mayFetchRemote } from './remote-gate.js';
import { setStatus } from './editing.js';
import { fetchWithTimeout, readLimited } from './limited-fetch.js';
import { SizeLimitError, getSizeLimits } from '../src/size-limits.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

/** The text of a file the document refers to: from where the document lives, or a URL; null when it cannot be read.
 * A web address is fetched only when the person has allowed that address (the first time, they are asked).
 * A file over the size limit for its `kind` is not loaded (the person is told).
 * @param {string} path @param {string} documentId @param {string | null} storageKind @param {string} [what] @param {'setupfile' | 'bibliography'} [kind]
 * @returns {Promise<string | null>} */
export async function fetchOne(path, documentId, storageKind, what = 'a setup file', kind = /** @type {'setupfile' | 'bibliography'} */ ('setupfile')) {
  try {
    if (/^https?:\/\//i.test(path)) {
      if (!(await mayFetchRemote(path, what))) {
        setStatus(`Not loaded: ${path} (not allowed to fetch it)`);
        return null;
      }
      const res = await fetchWithTimeout(path);
      if (res.ok) {
        const bytes = await readLimited(res, { maxBytes: getSizeLimits()[kind].max, kind, name: path });
        return new TextDecoder().decode(bytes);
      }
    } else {
      const entry = await diskAdapterFor(storageKind).read(resolveImagePath(path, documentId), { sizeKind: kind });
      if (entry && typeof entry.content === 'string') return entry.content;
    }
  } catch (error) {
    if (error instanceof SizeLimitError) setStatus(`Not loaded: ${error.message}`);
  }
  return null;
}

/** Fetches every setup file a document names (and the ones they name). When new text arrived, the document is parsed again so
 * that a #+TODO: or the like from a setup file applies to its headings; that document is returned (the same one otherwise).
 * Safe to call often.
 * @param {import('../src/types.js').Doc} doc @param {string} documentId @param {string | null} storageKind
 * @returns {Promise<import('../src/types.js').Doc>} */
export async function prefetchSetupFiles(doc, documentId, storageKind) {
  const linesOf = () => doc.keywords.filter((k) => !k.virtual).map((k) => `#+${k.key}: ${k.value}`);
  if (!doc || !setupFilePaths(linesOf()).length) return doc;
  let fetched = false;
  for (let round = 0; round < 6; round++) {
    const missing = missingSetupFiles(linesOf());
    if (!missing.length) break;
    let got = 0;
    for (const path of missing) {
      const text = await fetchOne(path, documentId, storageKind);
      if (text == null) continue;
      cacheSetupFile(path, text);
      got++;
    }
    if (!got) break;
    fetched = true;
  }
  return fetched || refreshSetupKeywords(doc) ? parseOrg(serializeOrg(doc)) : doc;
}

/** Export tries again for the #+SETUPFILE: files not loaded yet. Like Emacs (org-file-contents with NOERROR, as ox.el's
 * keyword reader calls it) a file that cannot be had does not stop the export; the person is told, with Emacs's words.
 * @param {import('../src/types.js').Doc} doc @param {string} documentId @param {string | null} storageKind */
export async function noteMissingSetupFiles(doc, documentId, storageKind) {
  const lines = doc.keywords.filter((k) => !k.virtual).map((k) => `#+${k.key}: ${k.value}`);
  if (!setupFilePaths(lines).length) return;
  await prefetchSetupFiles(doc, documentId, storageKind);
  const [path] = missingSetupFiles(lines);
  if (path !== undefined) setStatus(/^https?:\/\//i.test(path) ? `Unable to fetch file from ${JSON.stringify(path)}` : `Unable to read file ${JSON.stringify(path)}`);
}
