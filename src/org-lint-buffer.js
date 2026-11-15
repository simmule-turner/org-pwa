// @ts-check
// The *Org Lint* buffer's own commands (org-lint.el's `org-lint--report-mode`, a tabulated-list-mode buffer): `h` hides the reports of
// the checker at point (org-lint--hide-checker), `i` also ignores that checker in later refreshes (org-lint--ignore-checker), `S`
// sorts by the column at point (tabulated-list-sort), `g` makes the reports again (org-lint--refresh-reports), and the prefix
// argument of `org-lint` selects checkers by category or by name. The buffer is a plain object: its entries (one per report), the
// checkers its reports are made with and the sort key. formatReports (org-lint.js) gives its text.
import { CHECKERS, formatReports } from './org-lint.js';

/** @typedef {import('./org-lint.js').Report} Report */
/** @typedef {{ line: number, trust: 'nil' | 'low', message: string, checker: string }} Entry */
/** @typedef {{ names: string[], entries: Entry[], sortKey: { column: number, descending: boolean } | null }} LintBuffer */

export const LINT_COLUMNS = ['Line', 'Trust', 'Warning'];
/** Where each column of a report row starts in its text (the line is padded to 6, the trust to 5, one space between). */
const COLUMN_STARTS = [0, 7, 13];
/** The first lines of the *Org Lint* text, before the first report: the heading of the columns, which Emacs keeps in the header line. */
export const LINT_HEADER_LINES = 2;

/** The categories `assoc-string` finds in a checker's `:categories`. org-lint.el declares duplicate-name with '(babel 'link), whose
 * second element is the list (quote link), which matches "quote" and not "link". @param {import('./org-lint.js').CheckerInfo} c */
const categoriesOf = (c) => (c.name === 'duplicate-name' ? ['babel', 'quote'] : c.categories);

/** org-lint--checkers: the last declared first. */
const checkersInEmacsOrder = () => [...CHECKERS].reverse();

/** The names `completing-read` offers for "Checker category: ": the first category of each checker, `nil` for a checker with none.
 * @returns {string[]} */
export function lintCategoryChoices() {
  return [...new Set(checkersInEmacsOrder().map((c) => c.categories[0] ?? 'nil'))];
}

/** The names `completing-read` offers for "Checker name: ". @returns {string[]} */
export const lintCheckerChoices = () => checkersInEmacsOrder().map((c) => c.name);

/** The names of the checkers of a category (`C-u M-x org-lint`); none for an unknown one, as `assoc-string` finds none.
 * @param {string} category @returns {string[]} */
export const checkersOfCategory = (category) => CHECKERS.filter((c) => categoriesOf(c).includes(category)).map((c) => c.name);

/**
 * A report buffer for the checkers `names` and the reports they gave.
 * @param {string[]} names @param {Report[]} reports @returns {LintBuffer}
 */
export function openLintBuffer(names, reports) {
  return { names: [...names], entries: toEntries(reports), sortKey: null };
}

/** @param {Report[]} reports @returns {Entry[]} */
const toEntries = (reports) => reports.map((r) => ({ line: r.line, trust: r.trust, message: r.message, checker: r.checker }));

/** The order tabulated-list-print gives the entries: sorted by the sort key, if any (a stable sort, the Line column by number).
 * @param {LintBuffer} buffer */
function print(buffer) {
  const key = buffer.sortKey;
  if (!key) return;
  /** @param {Entry} e */
  const cell = (e) => [String(e.line), e.trust, e.message][key.column];
  const before = (/** @type {Entry} */ a, /** @type {Entry} */ b) => (key.column === 0 ? a.line < b.line : compareCodePoints(cell(a), cell(b)) < 0);
  // Emacs's sort takes the predicate (reversed for a descending key) as "a goes before b"
  const goes = key.descending ? (/** @type {Entry} */ a, /** @type {Entry} */ b) => before(b, a) : before;
  buffer.entries.sort((a, b) => (goes(a, b) ? -1 : goes(b, a) ? 1 : 0));
}

/** string< compares character codes. @param {string} a @param {string} b */
function compareCodePoints(a, b) {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = /** @type {number} */ (x[i].codePointAt(0)) - /** @type {number} */ (y[i].codePointAt(0));
    if (d) return d;
  }
  return x.length - y.length;
}

/**
 * `h` (org-lint--hide-checker): removes every report of the checker of the report at `index`.
 * @param {LintBuffer} buffer @param {number} index the 0-based report
 */
export function hideChecker(buffer, index) {
  const checker = buffer.entries[index].checker;
  buffer.entries = buffer.entries.filter((e) => e.checker !== checker);
  print(buffer);
}

/**
 * `i` (org-lint--ignore-checker): hides the checker of the report at `index` and leaves it out of the next refresh.
 * @param {LintBuffer} buffer @param {number} index
 */
export function ignoreChecker(buffer, index) {
  const checker = buffer.entries[index].checker;
  buffer.names = buffer.names.filter((n) => n !== checker);
  hideChecker(buffer, index);
}

/**
 * `S` (tabulated-list-sort): sorts by a column (0 Line, 1 Trust, 2 Warning); the same column again reverses the order.
 * @param {LintBuffer} buffer @param {number} column
 */
export function sortByColumn(buffer, column) {
  const key = buffer.sortKey;
  buffer.sortKey = key && key.column === column ? { column, descending: !key.descending } : { column, descending: false };
  print(buffer);
}

/**
 * `g` (org-lint--refresh-reports): the entries again, from the reports of the checkers still in use; the sort key holds.
 * @param {LintBuffer} buffer @param {Report[]} reports
 */
export function refreshReports(buffer, reports) {
  buffer.entries = toEntries(reports);
  print(buffer);
}

/**
 * The column a position of a report row is in (the text properties of tabulated-list-print-entry), or null at the end of the row.
 * @param {number} offset the character offset in the row @param {number} rowLength
 * @returns {number | null}
 */
export function columnAtOffset(offset, rowLength) {
  if (offset < 0 || offset >= rowLength) return null;
  return COLUMN_STARTS.filter((s) => s <= offset).length - 1;
}

/** The text of the *Org Lint* buffer for the entries of `buffer`. @param {LintBuffer} buffer */
export const lintBufferText = (buffer) => formatReports(buffer.entries.map((e) => ({ ...e, pos: 0 })));

/**
 * The report row the caret is on in the text of the *Org Lint* buffer: its index among the reports, the caret's offset in its line
 * and the line's length; null on the heading lines or past the last report.
 * @param {string} text @param {number} caret @param {number} reports how many reports the buffer has
 * @returns {{ index: number, offset: number, length: number, start: number } | null}
 */
export function lintRowAtCaret(text, caret, reports) {
  const start = text.lastIndexOf('\n', caret - 1) + 1;
  const index = text.slice(0, start).split('\n').length - 1 - LINT_HEADER_LINES;
  if (index < 0 || index >= reports) return null;
  const end = text.indexOf('\n', start);
  return { index, offset: caret - start, length: (end < 0 ? text.length : end) - start, start };
}
