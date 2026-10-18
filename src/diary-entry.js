// @ts-check
// Writing diary entries: the lines Emacs's diary-insert-* commands make for each `calendar-date-style`, and where
// `diary-make-entry` puts them in the file.

/** @typedef {'date' | 'weekly' | 'monthly' | 'yearly' | 'anniversary' | 'cyclic' | 'block'} EntryKind */

export const ENTRY_KINDS = /** @type {{ kind: EntryKind, label: string }[]} */ ([
  { kind: 'date', label: 'Date' },
  { kind: 'weekly', label: 'Weekly' },
  { kind: 'monthly', label: 'Monthly' },
  { kind: 'yearly', label: 'Yearly' },
  { kind: 'anniversary', label: 'Anniversary' },
  { kind: 'cyclic', label: 'Cyclic' },
  { kind: 'block', label: 'Block' },
]);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** @param {string | undefined} style @returns {'american' | 'european' | 'iso'} */
function styleOf(style) {
  return style === 'european' || style === 'iso' ? style : 'american';
}

/** The numbers of a date in the order of the style, as the sexp entries write them: "12 25 2026", "25 12 2026", "2026 12 25".
 * @param {Date} d @param {string} [style] */
export function sexpDate(d, style) {
  const [m, day, y] = [d.getMonth() + 1, d.getDate(), d.getFullYear()];
  const s = styleOf(style);
  return s === 'european' ? `${day} ${m} ${y}` : s === 'iso' ? `${y} ${m} ${day}` : `${m} ${day} ${y}`;
}

/** The date the way a dated line starts (`calendar-date-string` with abbreviations): "Dec 25, 2026", "25 Dec 2026", "2026-12-25".
 * @param {Date} d @param {string} [style] */
export function dateText(d, style) {
  const [m, day, y] = [MON[d.getMonth()], d.getDate(), d.getFullYear()];
  const s = styleOf(style);
  return s === 'european' ? `${day} ${m} ${y}` : s === 'iso' ? `${y}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : `${m} ${day}, ${y}`;
}

/**
 * The start of the line for a kind of entry, as Emacs writes it for the date shown (the text and the space that follows it come after).
 * @param {EntryKind} kind
 * @param {{ date: Date, endDate?: Date, interval?: number }} at
 * @param {{ dateStyle?: string, sexpSymbol?: string }} [options]
 * @returns {string}
 */
export function entryHead(kind, at, options = {}) {
  const { date } = at;
  const style = styleOf(options.dateStyle);
  const sexp = options.sexpSymbol ?? '%%';
  const [m, day] = [MON[date.getMonth()], date.getDate()];
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  switch (kind) {
    case 'weekly':
      return DAYS[date.getDay()];
    case 'monthly':
      return style === 'european' ? `${day} * ` : style === 'iso' ? `*-*-${String(day).padStart(2, '0')}` : `* ${day}`;
    case 'yearly':
      return style === 'european' ? `${day} ${m}` : style === 'iso' ? `*-${mm}-${String(day).padStart(2, '0')}` : `${m} ${day}`;
    case 'anniversary':
      return `${sexp}(diary-anniversary ${sexpDate(date, style)})`;
    case 'cyclic':
      return `${sexp}(diary-cyclic ${Math.max(1, Math.floor(at.interval || 1))} ${sexpDate(date, style)})`;
    case 'block': {
      const end = at.endDate || date;
      const [a, b] = end < date ? [end, date] : [date, end];
      return `${sexp}(diary-block ${sexpDate(a, style)} ${sexpDate(b, style)})`;
    }
    default:
      return dateText(date, style);
  }
}

/**
 * The whole line to add.
 * @param {EntryKind} kind
 * @param {{ date: Date, endDate?: Date, interval?: number, time?: string, text: string, nonmarking?: boolean }} fields
 * @param {{ dateStyle?: string, sexpSymbol?: string, nonmarkingSymbol?: string }} [options]
 * @returns {string}
 */
export function entryLine(kind, fields, options = {}) {
  const mark = fields.nonmarking ? (options.nonmarkingSymbol ?? '&') : '';
  const body = [fields.time?.trim(), fields.text.trim()].filter(Boolean).join(' ');
  return `${mark}${entryHead(kind, fields, options)} ${body}`;
}

/**
 * Adds `line` to the diary as `diary-make-entry` does: at the end of the file, on a line of its own, and above a "Local Variables:"
 * block when the last 3000 characters hold one.
 * @param {string} text
 * @param {string} line
 * @returns {{ text: string, line: number }}  the new text and the 1-based number of the line added
 */
export function appendDiaryEntry(text, line) {
  const window = Math.max(text.length - 3000, 0);
  const at = text.toLowerCase().lastIndexOf('local variables:');
  if (at >= window && at !== -1) {
    const start = text.lastIndexOf('\n', at - 1) + 1;
    return { text: `${text.slice(0, start)}${line}\n${text.slice(start)}`, line: text.slice(0, start).split('\n').length };
  }
  const body = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  return { text: `${body}${line}\n`, line: body.split('\n').length };
}

/**
 * Finds a diary entry again in the text it was read from: where it was seen if that line is still the same, else the nearest line
 * with the same text. The entry runs on through the indented lines that follow.
 * @param {string} text
 * @param {{ startLine: number, lineText: string }} where  the line the entry started on when the Agenda read it, and that line's text
 * @returns {{ startLine: number, endLine: number } | null}
 */
export function locateDiaryEntry(text, where) {
  const lines = text.split('\n');
  let at = -1;
  if (lines[where.startLine - 1]?.trim() === where.lineText) at = where.startLine - 1;
  else {
    let best = Infinity;
    lines.forEach((l, i) => {
      if (l.trim() === where.lineText && Math.abs(i + 1 - where.startLine) < best) {
        best = Math.abs(i + 1 - where.startLine);
        at = i;
      }
    });
  }
  if (at === -1 || where.lineText === '') return null;
  let end = at;
  while (/^[ \t]/.test(lines[end + 1] ?? '') && lines[end + 1].trim() !== '') end++;
  return { startLine: at + 1, endLine: end + 1 };
}

/** What to type for a date in the order of the style, as a hint: "month/day/year".
 * @param {string} [style] */
export function dateOrderHint(style) {
  const s = styleOf(style);
  return s === 'european' ? 'day/month/year' : s === 'iso' ? 'year-month-day' : 'month/day/year';
}

/** The date typed in the order of the style ("12/25/2026", "25/12/2026", "2026-12-25"); a year written first is always read as the year.
 * A year of two digits is read as 20xx. Null when it is not a real date.
 * @param {string} text @param {string} [style]
 * @returns {Date | null} */
export function parseEntryDate(text, style) {
  const parts = text.trim().split(/[-/.\s]+/).filter(Boolean);
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  let y, m, d;
  if (parts[0].length === 4) [y, m, d] = n;
  else if (styleOf(style) === 'european') [d, m, y] = n;
  else [m, d, y] = n;
  if (y < 100) y += 2000;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

/** A date as typed in the fields of the Add entry sheet, in the order of the style.
 * @param {Date} d @param {string} [style] */
export function formatEntryDate(d, style) {
  const [m, day, y] = [d.getMonth() + 1, d.getDate(), d.getFullYear()];
  const s = styleOf(style);
  return s === 'european' ? `${day}/${m}/${y}` : s === 'iso' ? `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}` : `${m}/${day}/${y}`;
}
