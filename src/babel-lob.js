// @ts-check
/**
 * The Library of Babel (`org-babel-library-of-babel`): the named source blocks of the documents ingested with `lobIngest`
 * (`org-babel-lob-ingest`), which a `#+CALL:` line or `call_name()` finds when the document being run has no block of that name.
 * Like Emacs's variable it lives in memory only: it is empty again when the app starts.
 */
import { collectDocumentBlocks } from './babel-blocks.js';
import { expandNoweb, nowebAllows } from './noweb.js';

/** @typedef {{ lang: string, langText: string, body: string, args: Record<string, any>, name: string }} LobEntry */

/** @type {Map<string, LobEntry>} */
export const babelLibrary = new Map();

/**
 * Adds every named source block of `doc` to the library (a later block of the same name replaces an earlier one, as in Emacs); the
 * body is Noweb-expanded when the block's `:noweb` says so. Returns how many blocks were added.
 * @param {import('./types.js').Doc} doc
 * @param {Map<string, LobEntry>} [library]
 */
export function lobIngest(doc, library = babelLibrary) {
  const blocks = collectDocumentBlocks(doc);
  let count = 0;
  for (const block of blocks) {
    if (!block.name) continue;
    const body = nowebAllows(block.args, 'eval') ? expandNoweb(doc, blocks, block) : block.emacsBody;
    library.delete(block.name);
    library.set(block.name, { lang: block.lang, langText: block.langText, body, args: block.args, name: block.name });
    count++;
  }
  return count;
}

/** The message `org-babel-lob-ingest` shows. @param {number} count */
export const lobIngestMessage = (count) => `${count} source block${count > 1 ? 's' : ''} added to Library of Babel`;
