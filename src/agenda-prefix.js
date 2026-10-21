/**
 * org-agenda-prefix-format: the text before each agenda row, built from a format string.
 *   %c category   %t time of day   %s scheduling label ("Scheduled:")   %e effort   %l one space per outline level
 *   %b the parents' titles with "->" after each   (%i, the category icon, is empty)
 * `%-12c` pads on the right to 12 characters, `%12c` on the left, `%.5c` cuts to 5 (4 for a category, as Emacs does). A character from
 * ` .;,:!?=|/<>` right after the width ("%-12:c", "% s") is added after the text when there is any.
 * `%?` ("%?-12t") leaves the whole part out when the text is empty. A `%(function)` form prints nothing.
 */

/** @typedef {{ category?: string, time?: string, scheduling?: string, effort?: string, level?: string, breadcrumbs?: string }} PrefixFields */

const PART_RE = /%(\??)([-+]?[0-9]*(?:\.[0-9]+)?)([ .;,:!?=|/<>]?)([cltseib]|\(.+?\))/g;

/**
 * @param {string} format
 * @param {PrefixFields} fields
 * @returns {string}
 */
export function formatAgendaPrefix(format, fields) {
  /** @type {Record<string, string>} */
  const values = { c: fields.category || '', t: fields.time || '', s: fields.scheduling || '', e: fields.effort || '', l: fields.level || '', b: fields.breadcrumbs || '' };
  return format.replace(PART_RE, (_all, optional, width, sep, letter) => {
    let text = values[letter] ?? '';
    if (optional && !text) return '';
    const precision = /\.(\d+)$/.exec(width);
    if (precision) text = text.slice(0, Math.max(0, Number(precision[1]) - (letter === 'c' ? 1 : 0))); // Emacs keeps one character fewer for a category
    if (text && sep) text += sep;
    const size = Math.abs(parseInt(width, 10) || 0);
    return width.startsWith('-') ? text.padEnd(size) : text.padStart(size);
  });
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
  if (!text.startsWith('(')) return text.replace(/^"([\s\S]*)"$/, '$1');
  const m = new RegExp('\\(\\s*' + view + '\\s*\\.\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*\\)').exec(text);
  return m ? m[1].replace(/\\(.)/g, '$1') : null;
}
