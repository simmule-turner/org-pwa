// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * What an export shows of a source block, as Org's export does with `org-export-use-babel` on but never running
 * anything: `:exports code` (the default) shows the block only, `results` only the stored `#+RESULTS:`, `both` both and
 * `none` neither; `:noweb yes` shows the block with its references expanded, `strip-export` with them removed.
 * Works on the document before it goes to an exporter and returns a new document; the original is untouched.
 * Checked against Emacs 29.3 (ox-ascii with `:eval no`).
 */
import { collectDocumentBlocks, preambleLines } from './babel-blocks.js';
import { RESULTS_LINE_RE, resultsEnd } from './babel.js';
import { parseBody } from './body-parser.js';
import { expandNoweb, nowebAllows, stripReferences } from './noweb.js';

/** Index of the `#+RESULTS:` line that belongs to the block ending at `endIndex`, or -1. An unnamed `#+RESULTS:`
 * @param {string[]} lines
 * @param {number} endIndex
 * @param {string} name
 *  belongs to the block right before it (blank lines allowed between); `#+RESULTS: name` to the block named `name`. */
function findResults(lines, endIndex, name) {
  if (name) {
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s*#\+RESULTS(?:\[[^\]]*\])?:\s*(.*)$/i.exec(lines[i]);
      if (m && m[1].trim() === name) return i;
    }
    return -1;
  }
  let j = endIndex + 1;
  while (j < lines.length && lines[j].trim() === '') j++;
  if (j < lines.length && RESULTS_LINE_RE.test(lines[j]) && !/^\s*#\+RESULTS(?:\[[^\]]*\])?:\s*\S/i.test(lines[j])) return j;
  return -1;
}

/** Whether only blank lines lie between line `from` and line `to`.
 * @param {string[]} lines
 * @param {number} from
 * @param {number} to */
const blankBetween = (lines, from, to) => to > from && lines.slice(from + 1, to).every((l) => l.trim() === '');

/**
 * @param {Doc} doc
 * @param {any[]} blocks
 * @param {Heading | null} heading
 * @param {string[]} lines
 * @param {Set<number>} [extraDrop] lines to drop that blocks in other sections own
 */
function rewriteLines(doc, blocks, heading, lines, extraDrop = new Set()) {
  const mine = blocks.filter((b) => b.heading === heading);
  if (!mine.length && !lines.some((l) => RESULTS_LINE_RE.test(l))) return null;
  const drop = new Set(extraDrop);
  const replace = new Map();
  for (const b of mine) {
    const exports = String(b.args.exports || 'code').split(/\s+/);
    if (!exports.every((w) => ['code', 'results', 'both', 'none'].includes(w))) continue; // Emacs leaves a block with an unknown :exports value as it is
    const showCode = exports.includes('code') || exports.includes('both');
    const showResults = exports.includes('results') || exports.includes('both');
    const at = findResults(lines, b.endIndex, b.name);
    if (at >= 0 && !showResults) {
      for (let k = at; k < resultsEnd(lines, at); k++) drop.add(k);
      // the blank lines between the block and the results it owned go with them
      if (blankBetween(lines, b.endIndex, at)) for (let k = b.endIndex + 1; k < at; k++) drop.add(k);
    }
    else if (at >= 0) drop.add(at); // the keyword line itself is never shown
    if (!showCode) {
      for (let k = b.endIndex + 1; k < lines.length && lines[k].trim() === ''; k++) drop.add(k); // the blank lines after a dropped block go with it
      for (let k = b.beginIndex; k <= b.endIndex; k++) drop.add(k);
      for (let k = b.beginIndex - 1; k >= 0 && /^\s*#\+(NAME|HEADERS?|CAPTION|ATTR_\w+)\s*:/i.test(lines[k]); k--) drop.add(k);
      continue;
    }
    const noweb = String(b.args.noweb || '').split(/\s+/);
    /** @type {string | null} */
    let text = null;
    if (nowebAllows(b.args, 'export')) text = expandNoweb(doc, blocks, b);
    else if (noweb.includes('strip-export')) text = stripReferences(b.body);
    if (text !== null) {
      const head = lines[b.beginIndex];
      const indent = b.indent || '';
      replace.set(b.beginIndex, [head, ...text.split('\n').map((l) => (l === '' ? l : indent + l.replace(/^(\*|#\+)/, ',$1')))]);
      for (let k = b.beginIndex + 1; k < b.endIndex; k++) drop.add(k);
    }
  }
  /** @type {string[]} */ const out = [];
  lines.forEach((l, /** @type {number} */ i) => {
    if (replace.has(i)) out.push(...replace.get(i));
    else if (!drop.has(i) && !RESULTS_LINE_RE.test(l)) out.push(l); // a #+RESULTS: line is never shown
  });
  return out;
}

/**
 * The document as an exporter should see it. Returns `doc` itself when it has no source block.
 * @param {Doc} doc
 */
export function prepareBabelExport(doc) {
  const blocks = collectDocumentBlocks(doc);
  if (!blocks.length) return doc;
  // `#+RESULTS: name` belongs to the block of that name wherever in the file it stands; those in other sections are dropped here
  /** @type {Map<Heading | null, string[]>} */ const sections = new Map([[null, preambleLines(doc)]]);
  /** @param {Heading[]} list */
  const collect = (list) => list.forEach((h) => (sections.set(h, h.bodyLines || []), collect(h.children || [])));
  collect(doc.children || []);
  /** @type {Map<Heading | null, Set<number>>} */ const foreign = new Map();
  for (const b of blocks) {
    if (!b.name) continue;
    const ex = String(b.args.exports || 'code').split(/\s+/);
    if (!ex.every((w) => ['code', 'results', 'both', 'none'].includes(w)) || ex.includes('results') || ex.includes('both')) continue;
    for (const [section, lines] of sections) {
      if (section === b.heading) continue;
      const at = findResults(lines, -2, b.name);
      if (at < 0) continue;
      if (!foreign.has(section)) foreign.set(section, new Set());
      for (let k = at; k < resultsEnd(lines, at); k++) /** @type {Set<number>} */ (foreign.get(section)).add(k);
    }
  }
  /** @param {Heading} h @returns {Heading} */
  const walk = (h) => {
    const bodyLines = rewriteLines(doc, blocks, h, h.bodyLines || [], foreign.get(h)) || h.bodyLines || [];
    return { ...h, bodyLines, body: parseBody(bodyLines), children: (h.children || []).map(walk) };
  };
  let result = doc;
  if (blocks.some((b) => b.heading === null)) {
    // The parser takes #+NAME: and #+HEADER: lines out of the preamble; put them back for the rewrite and drop them from the keywords.
    const lines = preambleLines(doc);
    const bodyLines = rewriteLines(doc, blocks, null, lines, foreign.get(null)) || lines;
    result = { ...doc, bodyLines, body: parseBody(bodyLines), keywords: (doc.keywords || []).filter((k) => !/^(NAME|HEADERS?|RESULTS)$/i.test(k.key)) };
  }
  return { ...result, children: (doc.children || []).map(walk) };
}
