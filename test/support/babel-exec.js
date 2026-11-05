// What the app's C-c C-c leaves in the text of an emacs-lisp block: shared by the Babel oracle test and the babel-elisp.org example test.
import { createHash } from 'node:crypto';
import { parseOrg, serializeOrg } from '../../src/org-parser.js';
import { collectDocumentBlocks } from '../../src/babel-blocks.js';
import { expandNoweb, nowebAllows } from '../../src/noweb.js';
import { runElisp, formatElispResult } from '../../src/babel-elisp.js';
import { parseBody } from '../../src/body-parser.js';
import { evalAllowed, existingResultsHash, formatError, parseResultsSpec, placeResults, resolveVars } from '../../src/babel.js';
import { referenceLookup } from '../../src/babel-ref.js';
import { cacheInput } from '../../src/babel-cache.js';

/** What the app's C-c C-c on the INDEXth block leaves in the text: the pipeline of src-browser/babel-flow.js (header arguments, :var,
 * Noweb, run, format, place) without the dialogs and the cache.  @param {string} text @param {number} index */
export function executed(text, index) {
  const doc = /** @type {any} */ (parseOrg(text));
  const all = collectDocumentBlocks(doc);
  const info = all[index];
  const heading = info.heading;
  const args = info.args;
  const spec = parseResultsSpec(args.results);
  if (spec.unsupported) return 'ERROR unsupported results';
  if (args.post !== undefined) return 'ERROR :post is not supported'; // Emacs runs the named block on the result; with none found it stops with an error and writes nothing
  if (!evalAllowed(args)) return text;
  const block = { lineIndex: info.beginIndex, lineCount: info.endIndex - info.beginIndex + 1 };
  /** @type {string | null} */ let hash = null;
  const place = (/** @type {string[]} */ lines, handling = 'replace') => {
    const { start, removeCount, insert } = placeResults(heading.bodyLines, block, lines, { hash, handling, name: info.name || '' });
    const bodyLines = heading.bodyLines.slice();
    bodyLines.splice(start, removeCount, ...insert);
    const changed = { ...heading, bodyLines, body: parseBody(bodyLines) };
    const swap = (/** @type {any[]} */ list) => list.map((h) => (h === heading ? changed : { ...h, children: swap(h.children || []) }));
    return serializeOrg({ ...doc, children: swap(doc.children) });
  };
  let vars;
  try {
    vars = resolveVars(args.var, referenceLookup(doc, all), { colnames: args.colnames, rownames: args.rownames, hlines: args.hlines });
  } catch (err) {
    return 'ERROR ' + /** @type {Error} */ (err).message; // Emacs stops with the error and writes nothing
  }
  let code = info.rawLines.map((/** @type {string} */ l) => l.replace(/^(\s*),(?=\*|#\+)/, '$1')).join('\n');
  if (nowebAllows(args, 'eval')) {
    try {
      code = expandNoweb(doc, all, info);
    } catch (err) {
      return place(formatError(/** @type {Error} */ (err).message));
    }
  }
  if (args.cache === 'yes') {
    const body = nowebAllows(args, 'eval') ? code : info.emacsBody;
    hash = createHash('sha1').update(cacheInput({ lang: info.lang, args, vars, code: body })).digest('hex');
    if (existingResultsHash(heading.bodyLines, block) === hash) return text;
  }
  const outcome = runElisp({ code, vars, spec, lexical: args.lexical });
  if (!outcome.ok) return 'ERROR ' + outcome.message; // Emacs stops with the error and writes nothing
  const lines = formatElispResult(/** @type {any} */ (outcome.value), spec, { wrap: args.wrap === undefined ? null : args.wrap, file: args.file === undefined ? null : args.file });
  if (spec.silent) return text;
  return place(lines, spec.handling);
}
