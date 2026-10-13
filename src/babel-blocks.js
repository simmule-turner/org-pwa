// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * Finding the source blocks of a document, in document order, with what Noweb and Tangle need to know about each:
 * its language, header text, name, normalised body, the headings above it, and its position among its heading's blocks.
 */
import { isCommentedHeading } from './comment-model.js';
import { effectiveHeaderArgs } from './babel-args.js';

const BEGIN_SRC_RE = /^(\s*)#\+begin_src(?:\s+(\S+))?(?:[ \t]+(.*))?$/i;
const BEGIN_OTHER_RE = /^\s*#\+begin_(\w+)/i;
const AFFILIATED_RE = /^\s*#\+(NAME|HEADERS?|CAPTION|ATTR_\w+|PLOT)\s*:\s*(.*)$/i;

/**
 * `,*` and `,#+` at the start of a line are Org's escapes for a line that would otherwise look like markup.
 * @param {string} line
 */
const unescapeLine = (line) => line.replace(/^(\s*),(?=\*|#\+)/, '$1');

/**
 * Removes the indentation all non-blank lines share, as Org does for a block's body.
 * @param {string[]} lines
 */
export function removeIndentation(lines) {
  let min = Infinity;
  for (const l of lines) {
    if (!l.trim()) continue;
    min = Math.min(min, (/^[ \t]*/.exec(l) || [''])[0].length);
  }
  if (!Number.isFinite(min) || min === 0) return lines.slice();
  return lines.map((/** @type {any} */ l) => (l.trim() ? l.slice(min) : ''));
}

/**
 * A block's body as Org uses it: comma escapes undone, shared indentation removed, trailing whitespace trimmed.
 * @param {string[]} rawLines
 */
export function normalizedBody(rawLines) {
  return removeIndentation(rawLines.map(unescapeLine)).join('\n').replace(/\s+$/, '');
}

/** The source blocks in `lines` (a heading's body, or the lines before the first heading):
 * @param {string[]} lines
 *  [{ beginIndex, endIndex, lang, params, name, headers, rawLines, indent }]. Blocks inside other blocks are skipped. */
export function scanSourceBlocks(lines) {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const other = BEGIN_OTHER_RE.exec(lines[i]);
    if (other && other[1].toLowerCase() !== 'src') {
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
    found.push({ beginIndex: i, endIndex: j, lang: (m[2] || '').toLowerCase(), params: m[3] || '', name, headers, rawLines: lines.slice(i + 1, j), indent: m[1] });
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
  const keywords = (doc.keywords || []).filter((/** @type {any} */ k) => /^(NAME|HEADERS?)$/i.test(k.key));
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
