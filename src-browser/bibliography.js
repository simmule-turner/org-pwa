// @ts-check
// Bibliography files for org-cite: the files a document names with #+BIBLIOGRAPHY: (and org-cite-global-bibliography) are
// fetched from the same place as the document, or from an http(s) URL, and kept in the key-value store for offline use. The
// citation code (src/cite.js) reads them synchronously from its cache.
import { bibliographyFiles, cacheBibliography, citeDefaults, citeEntry, citeExportSetting, createCiteExport, hasBibliography, missingBibliographyFiles, segmentsText } from '../src/cite.js';
import { getCiteGlobalBibliography, getCiteSeparator, getCiteSortingField } from '../src/local-variables.js';
import { S } from './app-state.js';
import { fetchOne } from './setupfile.js';
import { kv } from './singletons.js';

const kvKey = (/** @type {string} */ path) => 'bibliography:' + path;
/** @type {Set<string>} files already asked for in this document, so a missing one is not fetched again on every redraw */
const tried = new Set();

/** The citation settings, read from the current local variables (which include the global ones). */
export function syncCiteDefaults() {
  const vars = S.state ? S.state.localVariables : null;
  citeDefaults.globalFiles = getCiteGlobalBibliography(vars || {});
  citeDefaults.sortingField = getCiteSortingField(vars || {});
  citeDefaults.separator = getCiteSeparator(vars || {});
}

/** Fetches the bibliography files `doc` needs and does not have yet. Resolves true when any arrived.
 * @param {import('../src/types.js').Doc} doc @param {string} documentId @param {string | null} storageKind
 * @param {{ again?: boolean }} [opts]  again: ask for files that were asked for before */
export async function prefetchBibliography(doc, documentId, storageKind, { again = false } = {}) {
  syncCiteDefaults();
  let got = false;
  for (const path of missingBibliographyFiles(doc, citeDefaults.globalFiles)) {
    const id = documentId + '\n' + path;
    if (!again && tried.has(id)) continue;
    tried.add(id);
    const text = await fetchOne(path, documentId, storageKind, kvKey);
    if (text == null) continue;
    cacheBibliography(path, text);
    got = true;
    try {
      await kv.set(kvKey(path), text);
    } catch {
      // not kept for offline; still used now
    }
  }
  return got;
}

/** Called after each redraw: fetch what the open document is missing, and redraw once if something came. */
export function scheduleBibliography() {
  const state = S.state;
  if (!state || !state.doc) return;
  syncCiteDefaults();
  if (!missingBibliographyFiles(state.doc, citeDefaults.globalFiles).some((p) => !tried.has(state.documentId + '\n' + p))) return;
  const { doc, documentId, storageKind } = state;
  void prefetchBibliography(doc, documentId, storageKind).then(async (got) => {
    if (!got || S.state !== state) return;
    const { render } = await import('./render.js');
    render();
  });
}

/** What a citation key stands for, as the bibliography prints it (org-cite-follow, which opens the entry in Emacs).
 * @param {string} key @returns {string} */
export function describeCiteKey(key) {
  syncCiteDefaults();
  const doc = S.state && S.state.doc;
  const files = doc ? bibliographyFiles(doc, citeDefaults.globalFiles) : citeDefaults.globalFiles;
  if (!files.length) return `No bibliography: add #+BIBLIOGRAPHY: file.bib to find @${key}.`;
  if (!files.some((f) => hasBibliography(f))) return `The bibliography file is not loaded, so @${key} can't be looked up.`;
  if (!citeEntry(files, key)) return `No entry for @${key} in ${files.join(', ')}.`;
  const setting = doc ? citeExportSetting(doc) : { bibStyle: null, citeStyle: null };
  const made = createCiteExport({
    files,
    bibStyle: setting.bibStyle,
    citeStyle: null,
    citations: [{ type: 'citation', style: null, prefix: '', suffix: '', refs: [{ key, prefix: '', suffix: '' }], blanks: 0, raw: '' }],
    options: { sortingField: citeDefaults.sortingField, separator: citeDefaults.separator },
  });
  return segmentsText(made.bibliography()[0] || [key]);
}
