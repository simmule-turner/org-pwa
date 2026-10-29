// @ts-check
/**
 * Effort_ALL: the list of allowed effort values Emacs offers when setting
 * an effort (org-set-effort completes against it) and when filtering the
 * agenda by effort. Where Org looks for it, most specific first:
 *
 *   1. an `Effort_ALL` property on the heading itself, or the nearest
 *      ancestor that has one (it's inherited);
 *   2. the file's `#+PROPERTY: Effort_ALL 0 0:10 0:30 1:00 ...` line;
 *   3. the global setting -- here `org-global-properties`, a line such as
 *      `Effort_ALL: 0 0:10 0:30 1:00 2:00; OTHER: x` (semicolon-separated
 *      NAME: VALUE entries; only Effort_ALL is used).
 *
 * The first of those that yields at least one usable value wins. Values
 * are whitespace-separated and each must be a valid org duration (see
 * org-duration.js) -- anything else is skipped, so every value offered is
 * one the effort prompt would accept.
 *
 * When nothing defines it there is simply no list, and the effort prompt
 * stays plain free text; the agenda's effort filter falls back on the
 * default set org-agenda-filter-by-effort itself uses.
 */

import { getProperty, findAncestorPath } from './archive-model.js';
import { parseOrgDuration } from './org-duration.js';

const PROPERTY_NAME = 'Effort_ALL';
const PLUS_NAME = 'Effort_ALL+';

/** org-agenda-filter-by-effort's own fallback when Effort_ALL isn't set. */
const DEFAULT_EFFORT_FILTER_VALUES = ['0', '0:10', '0:30', '1:00', '2:00', '3:00', '4:00', '5:00', '6:00', '7:00'];

/**
 * The valid, de-duplicated values in `text`, in order.
 * @param {string} text
 */
function parseEffortValues(text) {
  const seen = new Set();
  const values = [];
  for (const token of String(text == null ? '' : text).split(/\s+/)) {
    if (token === '' || seen.has(token) || parseOrgDuration(token) === null) continue;
    seen.add(token);
    values.push(token);
  }
  return values;
}

/**
 * The words of an Effort_ALL value the way Emacs reads them (org-property-get-allowed-values calls `read` on the text wrapped in
 * parentheses): whitespace separates words, a double-quoted string is one word without its quotes, a number is printed back in
 * Lisp form ("+2" is 2, "1e2" is 100.0), and anything else is a symbol, kept as written. Nothing is validated or de-duplicated.
 * @param {string} text
 */
function readLispWords(text) {
  /** @type {string[]} */ const words = [];
  const source = String(text == null ? '' : text);
  const re = /"((?:[^"\\]|\\[\s\S])*)"|[^\s"]+/g;
  let m;
  while ((m = re.exec(source))) {
    if (m[1] !== undefined) {
      words.push(m[1].replace(/\\([\s\S])/g, '$1'));
    } else if (/^[+-]?\d+\.?$/.test(m[0])) {
      words.push(String(Number.parseInt(m[0], 10)));
    } else if (/^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:e[+-]?\d+)?$/i.test(m[0])) {
      const n = Number(m[0]);
      words.push(Number.isInteger(n) ? n.toFixed(1) : String(n));
    } else {
      words.push(m[0]);
    }
  }
  return words;
}

/**
 * `org-global-properties` text -> { lowercased name: value string }.
 * @param {string} text
 */
function parseGlobalProperties(text) {
  const result = {};
  for (const entry of String(text == null ? '' : text).split(';')) {
    const colon = entry.indexOf(':');
    if (colon === -1) continue;
    const name = entry.slice(0, colon).trim().toLowerCase();
    if (name && !(name in result)) /** @type {any} */ (result)[name] = entry.slice(colon + 1).trim();
  }
  return result;
}

/**
 * The allowed effort values that apply to `heading` (which may be null,
 * for the file-wide list). `globalProperties` is the raw
 * org-global-properties text.
 * @param {{ doc?: any, heading?: any, globalProperties?: string }} [options]
 */
function getAllowedEffortValues({ doc, heading = null, globalProperties = '' } = {}) {
  // Walk outward from the heading. A level with Effort_ALL starts the list (the nearest one wins; what lies outside it is dropped); a
  // level's Effort_ALL+ is appended after it, outer levels first. The file's #+PROPERTY lines are one level, and the global setting
  // is the base only when the file says nothing about Effort_ALL at all, as Emacs's org-property-get-allowed-values does.
  /** @type {string[][]} */
  const appended = [];
  /** @param {string | null | undefined} plain @param {string | null | undefined} plus @returns {string[] | null} */
  const level = (plain, plus) => {
    if (plain != null && plain.trim() === '') throw new Error('Wrong type argument: listp, ""'); // an Effort_ALL with no value is an error in Emacs
    if (plus) appended.unshift(readLispWords(plus));
    return plain != null ? readLispWords(plain) : null;
  };
  /** @type {string[] | null} */
  let base = null;
  if (doc && heading) {
    const ancestors = findAncestorPath(doc, heading) || [];
    for (const node of [heading, ...[...ancestors].reverse()]) {
      base = level(getProperty(node, PROPERTY_NAME), getProperty(node, PLUS_NAME));
      if (base) break;
    }
  }
  if (!base && doc) {
    let filePlain = null;
    let filePlus = '';
    let fileMentions = false;
    for (const keyword of doc.keywords || []) {
      if (String(keyword.key).toUpperCase() !== 'PROPERTY') continue;
      const m = /^\s*(\S+)\s+([\s\S]*)$/.exec(String(keyword.value == null ? '' : keyword.value));
      if (!m) continue;
      const name = m[1].toLowerCase();
      if (name === PROPERTY_NAME.toLowerCase()) {
        fileMentions = true;
        if (filePlain === null && m[2].trim() !== '') filePlain = m[2];
      } else if (name === PLUS_NAME.toLowerCase()) {
        fileMentions = true;
        filePlus += ' ' + m[2];
      }
    }
    base = level(filePlain, filePlus.trim() || null);
    if (!base && !fileMentions) base = level(/** @type {any} */ (parseGlobalProperties(globalProperties))[PROPERTY_NAME.toLowerCase()], null);
  }
  return [...(base || []), ...appended.flat()];
}

export { PROPERTY_NAME, PLUS_NAME, DEFAULT_EFFORT_FILTER_VALUES, parseEffortValues, readLispWords, parseGlobalProperties, getAllowedEffortValues };
