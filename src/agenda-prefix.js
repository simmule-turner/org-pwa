/**
 * org-agenda-prefix-format: the text before each agenda row, built from a format string.
 *   %c category   %t time of day   %s scheduling label ("Scheduled:")   %e effort   %l one space per outline level
 *   %b the parents' titles with "->" after each   (%i, the category icon, is empty)
 * `%-12c` pads on the right to 12 characters, `%12c` on the left, `%.5c` cuts to 5 (4 for a category, as Emacs does). A character from
 * ` .;,:!?=|/<>` right after the width ("%-12:c", "% s") is added after the text when there is any.
 * `%?` ("%?-12t") leaves the whole part out when the text is empty. A `%(form)` is evaluated as Lisp (`(my-function)`, `(concat ...)`), and shows the text it gives; a failing one stops the Agenda with Emacs's error text (`PrefixFormError`).
 */

import { Reader } from './elisp-read.js';

/** @typedef {{ category?: string, time?: string, scheduling?: string, effort?: string, level?: string, breadcrumbs?: string }} PrefixFields */

const HEAD_RE = /%(\??)([-+]?[0-9]*(?:\.[0-9]+)?)([ .;,:!?=|/<>]?)(?:([cltseib])|(?=\())/y;

/** The text `%t` shows for a time of day: Emacs pads a one-digit hour of the start with a space (" 9:00......", " 9:00-10:30"). @param {Date} start @param {Date | null} [end] */
export function agendaClockText(start, end = null) {
  const clock = (/** @type {Date} */ d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return end ? clock(start).padStart(5) + '-' + clock(end) : clock(start).padStart(5) + '......';
}

/**
 * @param {string} format
 * @param {PrefixFields} fields
 * @param {(form: string) => string} [evaluate]  gives the text of a `%(form)`; without it the form prints nothing
 * @returns {string}
 */
export function formatAgendaPrefix(format, fields, evaluate) {
  /** @type {Record<string, string>} */
  const values = { c: fields.category || '', t: fields.time || '', s: fields.scheduling || '', e: fields.effort || '', l: fields.level || '', b: fields.breadcrumbs || '' };
  let out = '';
  let i = 0;
  while (i < format.length) {
    HEAD_RE.lastIndex = i;
    const m = format[i] === '%' ? HEAD_RE.exec(format) : null;
    if (!m) {
      out += format[i++];
      continue;
    }
    const [head, optional, width, sep, letter] = m;
    /** @type {string} */
    let text;
    let next = i + head.length;
    if (letter) text = values[letter] ?? '';
    else {
      const reader = new Reader(format, next);
      try {
        reader.read();
      } catch {
        out += format[i++];
        continue;
      }
      text = evaluate ? evaluate(format.slice(next, reader.pos)) : '';
      next = reader.pos;
    }
    i = next;
    if (optional && !text) continue;
    const precision = /\.(\d+)$/.exec(width);
    if (precision) text = text.slice(0, Math.max(0, Number(precision[1]) - (letter === 'c' ? 1 : 0))); // Emacs keeps one character fewer for a category
    if (text && sep) text += sep;
    const size = Math.abs(parseInt(width, 10) || 0);
    out += width.startsWith('-') ? text.padEnd(size) : text.padStart(size);
  }
  return out;
}

/**
 * The format for one view: a string applies to every view; an alist such as
 * `((agenda . "  %-12:c%?-12t% s") (todo . " %i %-12:c"))` is looked up by `view`.
 * @param {string | undefined} raw  the variable's value
 * @param {string} view  agenda, todo, tags or search
 * @returns {string | null}
 */
export function agendaPrefixFormat(raw, view) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (!text.startsWith('(')) return lispString(text) ?? text;
  const m = new RegExp('\\(\\s*' + view + '\\s*\\.\\s*("(?:[^"\\\\]|\\\\.)*")\\s*\\)').exec(text);
  return m ? lispString(m[1]) : null;
}

/** The string a Lisp string literal reads as (`\"`, `\\`, `\n` and the rest unescaped); null when the text is not one. @param {string} source @returns {string | null} */
function lispString(source) {
  if (!source.startsWith('"')) return null;
  try {
    const reader = new Reader(source);
    const value = reader.read();
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}
