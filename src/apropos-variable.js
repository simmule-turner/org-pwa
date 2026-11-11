// @ts-check
/**
 * apropos-variable: the variables whose names match a word, a list of words or a regexp, listed as an Org document with one heading per
 * variable (its description, its value now, and a link to the setting), so the app's search, filter and fold work on the result. The
 * pattern follows `apropos`: one word matches as a substring, a list of words matches the names that hold at least two of them, and a
 * pattern with regexp characters is an Emacs regexp. Case does not matter.
 */
import { compileFind } from './file-ops.js';

/** @typedef {import('./variable-index.js').VariableEntry} VariableEntry */
export { printedValue } from './variable-index.js';

const REGEXP_CHARS = /[\\^$*+?.[\]]/;

/** A name test for `pattern`; null when it is a regexp Emacs would refuse.
 * @param {string} pattern @returns {((name: string) => boolean) | null} */
function matcher(pattern) {
  if (REGEXP_CHARS.test(pattern)) {
    const compiled = compileFind(pattern);
    return 'error' in compiled ? null : compiled.test;
  }
  const words = [...new Set(pattern.toLowerCase().split(/\s+/).filter(Boolean))];
  if (words.length <= 1) return (name) => words.length === 1 && name.toLowerCase().includes(words[0]);
  return (name) => words.filter((w) => name.toLowerCase().includes(w)).length >= 2;
}

/** One line of text: newlines and runs of blanks become one space. @param {string} text */
const oneLine = (text) => text.replace(/\s+/g, ' ').trim();

/** The Org text of one variable: a heading, its description and value, and the link that opens its setting.
 * @param {VariableEntry} e */
export function entryText(e) {
  const link = e.control === 'field' ? 'Open in Settings' : 'Set in Global Variables';
  return `* ${e.name}\nUser option: ${oneLine(e.doc) || '(not documented)'}\nValue: ${oneLine(e.value)}\n[[elisp:(customize-variable '${e.name})][${link}]]\n`;
}

/**
 * The Org text of the *Apropos* buffer for `pattern`, or the message Emacs gives when no variable matches.
 * @param {string} pattern @param {VariableEntry[]} entries
 * @returns {{ ok: true, text: string } | { ok: false, message: string }}
 */
export function aproposVariable(pattern, entries) {
  const test = matcher(pattern.trim());
  if (!test) return { ok: false, message: `Invalid regexp: ${pattern}` };
  const found = entries.filter((e) => test(e.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (!found.length) return { ok: false, message: `No apropos matches for \`${pattern}'` };
  return { ok: true, text: `${found.map(entryText).join('')}\n# Local Variables:\n# buffer-read-only: t\n# End:\n` };
}
