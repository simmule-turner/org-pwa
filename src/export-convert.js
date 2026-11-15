// @ts-check
/**
 * The converters of Org tables and lists as functions of the Lisp interpreter, with the names and arguments they have in Emacs:
 * `org-table-to-lisp`, `org-table-collapse-header`, `orgtbl-to-generic` (and `-csv`, `-tsv`, `-latex`, `-html`, `-orgtbl`,
 * `-unicode`), `org-list-to-lisp`, `org-list-to-generic` (and `-org`, `-html`, `-latex`, `-subtree`), `org-combine-plists` and
 * `org-quote-csv-field`. `#+ORGTBL: SEND` (src/orgtbl-send.js) and the table export command call the same functions.
 */
import { Buffer, Cons, NIL, T, intern, isStr, list, signal, unbox } from './elisp-data.js';
import { defun, state } from './elisp-core.js';
import { collapseHeader, tableTextToLisp, tableToGeneric } from './export-convert-table.js';
import { listToGeneric, listToLisp, listToOrg, listToSubtree } from './export-convert-list.js';
import { combine, pget, plistOf, text } from './export-convert-lisp.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */

/** The current buffer of the interpreter. */
const current = () => state.buffer ?? (state.buffer = new Buffer('*scratch*'));

/** @param {LObj} string */
const str = (string) => String(unbox(string));

defun('org-combine-plists', 0, -1, (plists) => plistOf(combine(plists)));
defun('org-quote-csv-field', 1, 1, ([s]) => {
  const t = text(s);
  return /[",]/.test(t) ? '"' + t.split('"').join('""') + '"' : t;
});

defun('org-table-collapse-header', 1, 3, ([table, separator = NIL, max = NIL]) => collapseHeader(table, separator, max));

/** The text of the table around point, from its first line. */
function tableAtPoint() {
  const b = current();
  const upTo = b.text.slice(0, b.pt - 1);
  const lines = b.text.split('\n');
  let at = upTo.split('\n').length - 1;
  if (!/^[ \t]*\|/.test(lines[at])) return '';
  while (at > 0 && /^[ \t]*\|/.test(lines[at - 1])) at--;
  return lines.slice(at).join('\n');
}

defun('org-table-to-lisp', 0, 1, ([txt = NIL]) => tableTextToLisp(txt === NIL ? tableAtPoint() : str(txt)));

/** @param {string} name @param {(params: LObj) => LObj} adjust  the parameters the converter adds before the caller's */
function converter(name, adjust) {
  defun(name, 2, 2, ([table, params]) => tableToGeneric(table, adjust(params)));
}

/** @param {[string, LObj][]} items */
const plist = (items) => plistOf(items.map(([k, v]) => [intern(k), v]));
const sym = intern;

defun('orgtbl-to-generic', 2, 2, ([table, params]) => tableToGeneric(table, params));
converter('orgtbl-to-tsv', (params) => plistOf(combine([plist([[':sep', '\t']]), params])));
converter('orgtbl-to-csv', (params) => plistOf(combine([plist([[':sep', ','], [':fmt', sym('org-quote-csv-field')]]), params])));
converter('orgtbl-to-latex', (params) =>
  plistOf(combine([
    plist([
      [':backend', sym('latex')], [':latex-default-table-mode', sym('table')], [':latex-tables-centered', NIL],
      [':latex-tables-booktabs', pget(params, ':booktabs')], [':latex-table-scientific-notation', NIL],
      [':latex-default-table-environment', pget(params, ':environment') === NIL ? 'tabular' : pget(params, ':environment')],
    ]),
    params,
  ])));
converter('orgtbl-to-html', (params) =>
  plistOf(combine([
    plist([[':backend', sym('html')], [':html-table-use-header-tags-for-first-column', NIL], [':html-table-align-individual-fields', T]]),
    params,
  ])));
converter('orgtbl-to-orgtbl', (params) => plistOf(combine([params, plist([[':backend', sym('org')]])])));
converter('orgtbl-to-unicode', (params) =>
  plistOf(combine([
    plist([
      [':backend', sym('ascii')], [':ascii-charset', sym('utf-8')],
      [':ascii-table-widen-columns', pget(params, ':narrow') === NIL ? T : NIL], [':ascii-table-use-ascii-art', pget(params, ':ascii-art')],
    ]),
    params,
  ])));

/** The line of the buffer point is on, and the buffer's text. */
function pointLine() {
  const b = current();
  return { b, line: b.text.slice(0, b.pt - 1).split('\n').length - 1 };
}

defun('org-list-to-lisp', 0, 1, ([del = NIL]) => {
  const { b, line } = pointLine();
  const found = listToLisp(b.text, line);
  if (!found) throw signal('error', ['Not in a list']);
  const lines = b.text.split('\n');
  const offsetOf = (/** @type {number} */ n) => lines.slice(0, n).reduce((a, l) => a + l.length + 1, 0);
  const top = offsetOf(found.start);
  if (del !== NIL) {
    b.text = b.text.slice(0, top) + b.text.slice(Math.min(offsetOf(found.end), b.text.length));
    b.zv = b.text.length + 1;
  }
  b.pt = top + 1;
  return found.value;
});

defun('org-list-to-generic', 2, 2, ([l, params]) => listToGeneric(l, params));
defun('org-list-to-org', 1, 2, ([l, params = NIL]) => listToOrg(l, params));
defun('org-list-to-html', 1, 2, ([l, params = NIL]) => listToGeneric(l, plistOf(combine([plist([[':backend', sym('html')]]), params]))));
defun('org-list-to-latex', 1, 2, ([l, params = NIL]) => listToGeneric(l, plistOf(combine([plist([[':backend', sym('latex')]]), params]))));
defun('org-list-to-subtree', 1, 3, ([l, level = NIL, params = NIL]) => {
  const odd = intern('org-odd-levels-only').value;
  const b = current();
  // org-blank-before-new-entry's `heading' (auto): a blank line when the line before the previous heading is blank (or there is none)
  const lines = b.text.slice(0, b.pt - 1).split('\n');
  let h = lines.length - 1;
  while (h >= 0 && !/^\*+ /.test(lines[h])) h--;
  const blank = h <= 0 ? true : lines[h - 1].trim() === '';
  return listToSubtree(l, level, params, blank, odd !== undefined && odd !== NIL);
});

export { Cons, isStr, list };
