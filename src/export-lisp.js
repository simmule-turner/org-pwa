// @ts-check
// Lisp the HTML export calls: a function given as `org-html-preamble`. It gets the export options as Emacs does, a property list
// (`:title`, `:subtitle`, `:author` and `:date` as lists of strings, `:email`, `:language`, `:creator`), and `org-export-data` turns
// such a list into text.
import { run, defun } from './elisp.js';
import { toArray } from './elisp-data.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */

/** `org-export-data` of a secondary string: the text of its strings (what the export already turned into HTML). @param {LObj} data @returns {string} */
function exportData(data) {
  if (data instanceof String || typeof data === 'string') return String(data.valueOf());
  if (data !== null && typeof data === 'object' && 'car' in data) return toArray(data).map(exportData).join('');
  return '';
}
defun('org-export-data', 1, 2, ([data]) => exportData(data));

/** A Lisp string literal. @param {string} s */
const lisp = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/** A truth value, a number or a symbol as Lisp text: true is t, false or nothing nil. @param {unknown} v */
const atom = (v) => (v === true ? 't' : v === false || v === null || v === undefined ? 'nil' : String(v));
/** A list of strings as Lisp text. @param {string[]} items */
const strings = (items) => `(${items.map(lisp).join(' ')})`;

/**
 * The export options of the file as the entries of Emacs's property list (`org-export-options-alist`): what `#+OPTIONS:`, the export variables and
 * the keywords make of them. `o` is what parseHtmlOptions read.
 * @param {Record<string, any>} o
 * @param {{ select: string[], exclude: string[], description: string, keywords: string }} keywords
 * @returns {string} the entries, ready to go in a property list
 */
export function optionsPlist(o, keywords) {
  const drawers = o.drawers.all ? 't' : o.drawers.exclude ? `(not ${o.drawers.exclude.map(lisp).join(' ')})` : o.drawers.include && o.drawers.include.length ? strings(o.drawers.include) : 'nil';
  const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? strings(v) : atom(v));
  const entries = [
    [':description', keywords.description ? lisp(keywords.description) : 'nil'],
    [':keywords', keywords.keywords ? lisp(keywords.keywords) : 'nil'],
    [':select-tags', strings(keywords.select)],
    [':exclude-tags', strings(keywords.exclude)],
    [':headline-levels', atom(o.H)],
    [':preserve-breaks', atom(o.brk)],
    [':section-numbers', atom(o.num)],
    [':time-stamp-file', atom(o.timestamp)],
    [':with-archived-trees', atom(o.arch)],
    [':with-author', atom(o.author)],
    [':with-broken-links', atom(o.broken)],
    [':with-clocks', atom(o.clocks)],
    [':with-creator', atom(o.creator)],
    [':with-date', atom(o.date)],
    [':with-drawers', drawers],
    [':with-email', atom(o.email)],
    [':with-emphasize', atom(o.emph)],
    [':with-entities', atom(o.entities)],
    [':with-fixed-width', atom(o.fixed)],
    [':with-footnotes', atom(o.footnotes)],
    [':with-inlinetasks', atom(o.inline)],
    [':with-latex', atom(o.tex)],
    [':with-planning', atom(o.planning)],
    [':with-priority', atom(o.pri)],
    [':with-properties', list(o.properties)],
    [':with-smart-quotes', atom(o.smart)],
    [':with-special-strings', atom(o.special)],
    [':with-statistics-cookies', atom(o.stat)],
    [':with-sub-superscripts', 'nil'], // Emacs 29.3 reports nil here whatever ^: says
    [':with-tables', atom(o.tables)],
    [':with-tags', atom(o.tags)],
    [':with-tasks', list(o.tasks)],
    [':with-timestamps', atom(o.stamps)],
    [':with-title', atom(o.title)],
    [':with-toc', atom(o.toc)],
    [':with-todo-keywords', atom(o.todo)],
  ];
  return entries.map(([k, v]) => `${k} ${v}`).join(' ');
}

/**
 * Calls the function `fn` (a symbol's name or a `(lambda ...)` form, as text) with the export options, and returns its string.
 * Anything but a string means nothing is inserted (Emacs checks the result with `org-string-nw-p`). A Lisp error is thrown as an Error
 * with Emacs's message.
 * @param {string} fn
 * @param {{ title: string, subtitle: string, author: string, date: string, email: string, language: string, creator: string, options?: string }} info
 * @returns {string | null}
 */
export function callExportFunction(fn, info) {
  const secondary = (/** @type {string} */ s) => (s ? `(${lisp(s)})` : 'nil');
  const plist = `(:title ${secondary(info.title)} :subtitle ${secondary(info.subtitle)} :author ${secondary(info.author)} :date ${secondary(info.date)} :email ${lisp(info.email)} :language ${lisp(info.language)} :creator ${lisp(info.creator)} ${info.options ?? ''})`;
  const result = run(`(funcall (quote ${fn}) (quote ${plist}))`);
  if (!result.ok) throw new Error(result.error);
  return typeof result.value === 'string' ? result.value : null;
}
