// @ts-check
// Fetches the files named by #+SETUPFILE: so the parser (which is synchronous) can use them. A relative name is read from the
// same place as the document (GitHub, WebDAV, the local folder); http(s) URLs are fetched directly. Whatever is fetched is
// kept in the key-value store, so the keywords are still there offline.
import { cacheSetupFile, missingSetupFiles, refreshSetupKeywords, setupFilePaths } from '../src/setupfile.js';
import { resolveImagePath } from '../src/link-resolve.js';
import { diskAdapterFor } from './external-sync.js';
import { kv } from './singletons.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

const kvKey = (/** @type {string} */ path) => 'setupfile:' + path;

/** The text of a file the document refers to: from where the document lives, or a URL; the copy kept last time when that fails.
 * @param {string} path @param {string} documentId @param {string | null} storageKind @param {(path: string) => string} [keptAs]
 * @returns {Promise<string | null>} */
export async function fetchOne(path, documentId, storageKind, keptAs = kvKey) {
  try {
    if (/^https?:\/\//i.test(path)) {
      const res = await fetch(path);
      if (res.ok) return await res.text();
    } else {
      const entry = await diskAdapterFor(storageKind).read(resolveImagePath(path, documentId));
      if (entry && typeof entry.content === 'string') return entry.content;
    }
  } catch {
    // unreachable right now: fall back to the copy kept from last time
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
