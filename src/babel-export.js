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

function rewriteLines(doc, blocks, heading, lines) {
  const mine = blocks.filter((b) => b.heading === heading);
  if (!mine.length && !lines.some((l) => RESULTS_LINE_RE.test(l))) return null;
  const drop = new Set();
  const replace = new Map();
  for (const b of mine) {
    const exports = String(b.args.exports || 'code').split(/\s+/);
    const showCode = exports.includes('code') || exports.includes('both');
    const showResults = exports.includes('results') || exports.includes('both');
    const at = findResults(lines, b.endIndex, b.name);
    if (at >= 0 && !showResults) for (let k = at; k < resultsEnd(lines, at); k++) drop.add(k);
    else if (at >= 0) drop.add(at); // the keyword line itself is never shown
    if (!showCode) {
      for (let k = b.beginIndex; k <= b.endIndex; k++) drop.add(k);
      for (let k = b.beginIndex - 1; k >= 0 && /^\s*#\+(NAME|HEADERS?|CAPTION|ATTR_\w+)\s*:/i.test(lines[k]); k--) drop.add(k);
      continue;
    }
    const noweb = String(b.args.noweb || '').split(/\s+/);
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
  const out = [];
  lines.forEach((l, i) => {
    if (replace.has(i)) out.push(...replace.get(i));
    else if (!drop.has(i) && !RESULTS_LINE_RE.test(l)) out.push(l); // a #+RESULTS: line is never shown
  });
  return out;
}

/** The document as an exporter should see it. Returns `doc` itself when it has no source block. */
export function prepareBabelExport(doc) {
  const blocks = collectDocumentBlocks(doc);
  if (!blocks.length) return doc;
  const walk = (h) => {
    const bodyLines = rewriteLines(doc, blocks, h, h.bodyLines || []) || h.bodyLines || [];
    return { ...h, bodyLines, body: parseBody(bodyLines), children: (h.children || []).map(walk) };
  };
  let result = doc;
  if (blocks.some((b) => b.heading === null)) {
    // The parser takes #+NAME: and #+HEADER: lines out of the preamble; put them back for the rewrite and drop them from the keywords.
    const lines = preambleLines(doc);
    const bodyLines = rewriteLines(doc, blocks, null, lines) || lines;
    result = { ...doc, bodyLines, body: parseBody(bodyLines), keywords: (doc.keywords || []).filter((k) => !/^(NAME|HEADERS?)$/i.test(k.key)) };
  }
  return { ...result, children: (doc.children || []).map(walk) };
}
