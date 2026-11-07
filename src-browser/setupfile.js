// @ts-check
// Fetches the files named by #+SETUPFILE: so the parser (which is synchronous) can use them. A relative name is read from the
// same place as the document (GitHub, WebDAV, the local folder); http(s) URLs are fetched directly. Whatever is fetched is
// kept in the key-value store, so the keywords are still there offline.
import { cacheSetupFile, missingSetupFiles, refreshSetupKeywords, setupFilePaths } from '../src/setupfile.js';
import { resolveImagePath } from '../src/link-resolve.js';
import { diskAdapterFor } from './external-sync.js';
import { kv } from './singletons.js';
import { mayFetchRemote } from './remote-gate.js';
import { setStatus } from './editing.js';
import { fetchWithTimeout, readLimited } from './limited-fetch.js';
import { SizeLimitError, getSizeLimits } from '../src/size-limits.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

const kvKey = (/** @type {string} */ path) => 'setupfile:' + path;

/** The text of a file the document refers to: from where the document lives, or a URL; the copy kept last time when that fails.
 * A web address is fetched only when the person has allowed that address (the first time, they are asked).
 * A file over the size limit for its `kind` is not loaded (the person is told), and the copy kept last time is used.
 * @param {string} path @param {string} documentId @param {string | null} storageKind @param {(path: string) => string} [keptAs] @param {string} [what] @param {'setupfile' | 'bibliography'} [kind]
 * @returns {Promise<string | null>} */
export async function fetchOne(path, documentId, storageKind, keptAs = kvKey, what = 'a setup file', kind = /** @type {'setupfile' | 'bibliography'} */ ('setupfile')) {
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
    // otherwise unreachable right now: fall back to the copy kept from last time
  }
  try {
    const saved = await kv.get(keptAs(path));
    return saved && typeof saved.value === 'string' ? saved.value : null;
  } catch {
    return null;
  }
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
      try {
        await kv.set(kvKey(path), text);
      } catch {
        // not kept for offline; still used now
      }
    }
    if (!got) break;
    fetched = true;
  }
  return fetched || refreshSetupKeywords(doc) ? parseOrg(serializeOrg(doc)) : doc;
}
