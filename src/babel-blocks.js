// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * Finding the source blocks of a document, in document order, with what Noweb and Tangle need to know about each:
 * its language, header text, name, normalised body, the headings above it, and its position among its heading's blocks.
 */
import { isCommentedHeading } from './comment-model.js';
import { removeColumns } from './code-lines.js';
import { effectiveHeaderArgs } from './babel-args.js';

const BEGIN_SRC_RE = /^(\s*)#\+begin_src(?:\s+(\S+))?(?:[ \t]+(.*))?$/i;
const BEGIN_OTHER_RE = /^\s*#\+begin_(\w+)/i;
const AFFILIATED_RE = /^\s*#\+(NAME|HEADERS?|CAPTION|ATTR_\w+|PLOT)\s*:\s*(.*)$/i;

/**
 * `,*` and `,#+` at the start of a line are Org's escapes for a line that would otherwise look like markup.
 * @param {string} line
 */
const unescapeLine = (line) => line.replace(/^(\s*),(?=\*|#\+|,[ \t]*(?:\*|#\+))/, '$1');

/**
 * Removes the indentation all non-blank lines share, as Org does for a block's body.
 * @param {string[]} lines
 */
export function removeIndentation(lines) {
  return removeColumns(lines).map((l) => (l.trim() ? l : ''));
}

/**
 * A block's body as Org uses it: comma escapes undone, shared indentation removed, trailing whitespace trimmed.
 * @param {string[]} rawLines
 */
export function normalizedBody(rawLines) {
  return removeIndentation(rawLines.map(unescapeLine)).join('\n').replace(/\s+$/, '');
}

/** A block's body exactly as Emacs hands it to Babel: comma escapes undone, the common indentation removed (a blank line
 * loses up to as much), trailing whitespace and blank lines kept.
 * @param {string[]} rawLines */
function emacsBodyOf(rawLines) {
  const lines = rawLines.map(unescapeLine);
  const width = (/** @type {string} */ ws) => [...ws].reduce((col, ch) => (ch === '\t' ? col + 8 - (col % 8) : col + 1), 0);
  // Emacs never removes more columns than the body has characters plus one (a quirk visible with tab-only indentation).
  const cut = Math.min(lines.join('\n').length + 1, ...lines.filter((l) => l.trim()).map((l) => width((/^[ \t]*/.exec(l) || [''])[0])));
  const out = removeColumns(lines);
  // Emacs re-indents each remaining line with `indent-line-to`, which writes tabs for every full 8 columns.
  const reindent = (/** @type {string} */ l) => {
    const rest = l.replace(/^[ \t]*/, '');
    const left = width((/^[ \t]*/.exec(l) || [''])[0]) - cut;
    return '\t'.repeat(Math.floor(left / 8)) + ' '.repeat(left % 8) + rest;
  };
  const tabbed = lines.some((l) => l.trim() && /^[ \t]*\t/.test(l));
  return out.map((l, n) => (lines[n].trim() ? (tabbed ? reindent(lines[n]) : l) : lines[n].slice(Math.min(lines[n].length, cut)))).join('\n');
}

/** The source blocks in `lines` (a heading's body, or the lines before the first heading):
 * @param {string[]} lines
 *  [{ beginIndex, endIndex, lang, params, name, headers, rawLines, indent }]. Blocks inside other blocks are skipped. */
export function scanSourceBlocks(lines) {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const other = BEGIN_OTHER_RE.exec(lines[i]);
    // Only blocks whose contents are raw text hide a source block; a quote, center or special block holds elements.
    if (other && /^(example|export|comment|verse)$/i.test(other[1])) {
      const end = new RegExp('^\\s*#\\+end_' + other[1] + '\\s*$', 'i');
      let j = i + 1;
      while (j < lines.length && !end.test(lines[j])) j++;
      i = j;
      continue;
    }
    const m = BEGIN_SRC_RE.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !/^\s*#\+end_src\s*$/i.test(lines[j])) j++;
    if (j >= lines.length) break; // never closed: not a block
    /** @type {string | null} */
    let name = null;
    const headers = [];
    for (let k = i - 1; k >= 0; k--) {
      const a = AFFILIATED_RE.exec(lines[k]);
      if (!a) break;
      const key = a[1].toUpperCase();
      if (key === 'NAME' && name === null) name = a[2].trim();
      else if (key === 'HEADER' || key === 'HEADERS') headers.unshift(a[2].trim());
    }
    found.push({ beginIndex: i, endIndex: j, lang: (m[2] || '').toLowerCase(), langText: m[2] || '', params: m[3] || '', name, headers, rawLines: lines.slice(i + 1, j), beginLineText: lines[i], emacsBody: emacsBodyOf(lines.slice(i + 1, j)), indent: m[1] });
    i = j;
  }
  return found;
}

const isArchived = (/** @type {any} */ heading) => (heading.tags || []).some((/** @type {any} */ t) => String(t).toUpperCase() === 'ARCHIVE');
/** @param {Heading} heading */
const isComment = (heading) => isCommentedHeading(heading);

/** The lines before the first heading with the `#+KEY: value` lines the parser pulled out put back where they were,
 * @param {Doc} doc
 *  so that a `#+NAME:` or `#+HEADER:` above the first block is seen. */
export function preambleLines(doc) {
  const lines = (doc.bodyLines || []).slice();
  /** @param {any} [k] */
  const keywords = (doc.keywords || []).filter((k) => /^(NAME|HEADERS?|RESULTS)$/i.test(k.key));
  for (const k of keywords.slice().reverse()) lines.splice(Math.min(k.bodyLineIndex || 0, lines.length), 0, `#+${k.key}:${k.value ? ' ' + k.value : ''}`);
  return lines;
}

/** The lines before the first heading with every `#+KEY: value` line put back (preambleLines puts back only NAME and HEADER).
 * @param {Doc} doc */
export function fullPreambleLines(doc) {
  const lines = (doc.bodyLines || []).slice();
  const keywords = (doc.keywords || []).filter((k) => !k.virtual);
  for (const k of keywords.slice().reverse()) lines.splice(Math.min(k.bodyLineIndex || 0, lines.length), 0, `#+${k.key}: ${k.value}`);
  return lines;
}

/**
 * Every source block of the document in order: preamble first, then each heading depth first.
 * Each entry: { heading (null before the first heading), ancestors (outermost first, ending with `heading`),
 * counter (1-based among that heading's blocks), commented, archived, lang, params, name, headers, body, indent,
 * beginIndex, endIndex, args (the effective header arguments) }.
 * @param {Doc} doc
 */
export function collectDocumentBlocks(doc) {
  /** @type {any[]} */ const blocks = [];
  /**
   * @param {Heading | null} heading
   * @param {any} ancestors
   * @param {string[]} lines
   * @param {any} [commented]
   * @param {any} [archived]
   */
  const add = (heading, ancestors, lines, commented, archived) => {
    scanSourceBlocks(lines).forEach((b, n) => {
      blocks.push({
        ...b,
        heading,
        ancestors,
        counter: n + 1,
        commented,
        archived,
        body: normalizedBody(b.rawLines),
        args: effectiveHeaderArgs(doc, ancestors, b),
      });
    });
  };
  add(null, [], preambleLines(doc), false, false);
  /**
   * @param {Heading} heading
   * @param {any} [parents]
   * @param {any} [commented]
   * @param {any} [archived]
   */
  const walk = (heading, parents, commented, archived) => {
    const here = [...parents, heading];
    const c = commented || isComment(heading);
    const a = archived || isArchived(heading);
    add(heading, here, heading.bodyLines || [], c, a);
    for (const child of heading.children || []) walk(child, here, c, a);
  };
  for (const h of doc.children || []) walk(h, [], false, false);
  return blocks;
}

/**
 * The heading's text as Org puts it in a search link: statistics cookies removed, spaces collapsed.
 * @param {string} title
 */
export function headingSearchText(title) {
  return String(title || '')
    .replace(/\[\d*\/\d*\]|\[\d*%\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
