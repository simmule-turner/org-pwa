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

/**
 * Calls the function `fn` (a symbol's name or a `(lambda ...)` form, as text) with the export options, and returns its string.
 * Anything but a string means nothing is inserted (Emacs checks the result with `org-string-nw-p`). A Lisp error is thrown as an Error
 * with Emacs's message.
 * @param {string} fn
 * @param {{ title: string, subtitle: string, author: string, date: string, email: string, language: string, creator: string }} info
 * @returns {string | null}
 */
export function callExportFunction(fn, info) {
  const secondary = (/** @type {string} */ s) => (s ? `(${lisp(s)})` : 'nil');
  const plist = `(:title ${secondary(info.title)} :subtitle ${secondary(info.subtitle)} :author ${secondary(info.author)} :date ${secondary(info.date)} :email ${lisp(info.email)} :language ${lisp(info.language)} :creator ${lisp(info.creator)})`;
  const result = run(`(funcall (quote ${fn}) (quote ${plist}))`);
  if (!result.ok) throw new Error(result.error);
  return typeof result.value === 'string' ? result.value : null;
}
