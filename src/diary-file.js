// @ts-check
// The Emacs diary file: which of its lines apply to a day, and what the Agenda shows for them.
//
// This follows diary-lib.el's `diary-list-entries-2` step by step: for every date form, a regexp is built for the day
// (^&?<form>) and searched through the whole file. The same regexps are used (through emacsRegexToJs) so that the small
// rules in them -- "the date must not be followed by another digit", "a year may be written with two digits" -- come out
// as they do in Emacs without being rewritten here.
import { emacsRegexToJs } from './emacs-regex.js';
import { holidaysOn } from './holidays.js';
import { parseSexpr } from './sexp-eval.js';
import {
  getCalendarDateStyle,
  getDiaryAbbreviatedYearFlag,
  getDiaryListEntriesHook,
  getDiaryMergeRows,
  getDiaryShowHolidaysFlag,
  getDiarySymbol,
} from './local-variables.js';

/** @typedef {(string | { backup: boolean })[]} DateForm  The parts of one `diary-date-forms` element: the symbols month, day, year, monthname, dayname, or a regexp string; a leading `backup`. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The three lists of `diary-date-forms` Emacs 29 ships, by `calendar-date-style` (`backup` is the form's first element in Emacs). */
export const DIARY_DATE_FORMS = {
  american: [
    ['month', '/', 'day', '[^/0-9]'],
    ['month', '/', 'day', '/', 'year', '[^0-9]'],
    ['monthname', ' *', 'day', '[^,0-9]'],
    ['monthname', ' *', 'day', ', *', 'year', '[^0-9]'],
    ['dayname', '\\W'],
  ],
  european: [
    ['day', '/', 'month', '[^/0-9]'],
    ['day', '/', 'month', '/', 'year', '[^0-9]'],
    [{ backup: true }, 'day', ' *', 'monthname', '\\W+\\<\\([^*0-9]\\|\\([0-9]+[:aApP]\\)\\)'],
    ['day', ' *', 'monthname', ' *', 'year', '[^0-9:aApP]'],
    ['dayname', '\\W'],
  ],
  iso: [
    ['month', '[-/]', 'day', '[^-/0-9]'],
    ['year', '[-/]', 'month', '[-/]', 'day', '[^0-9]'],
    ['monthname', ' *', 'day', '[^-0-9]'],
    ['year', ' *', 'monthname', ' *', 'day', '[^0-9]'],
    ['dayname', '\\W'],
  ],
};

/**
 * @typedef {object} DiaryOptions
 * @property {string} [dateStyle]  `calendar-date-style`: american (default), european or iso
 * @property {DateForm[] | null} [dateForms]  `diary-date-forms` when it is set; replaces the list of the style
 * @property {boolean} [abbreviatedYear]  `diary-abbreviated-year-flag` (default true): a year may be written with two digits
 * @property {string} [nonmarkingSymbol]  `diary-nonmarking-symbol` (default "&")
 * @property {string} [sexpSymbol]  `diary-sexp-entry-symbol` (default "%%")
 * @property {string} [includeString]  `diary-include-string` (default "#include")
 * @property {boolean} [showHolidays]  `diary-show-holidays-flag` (default true)
 * @property {string[]} [hooks]  the names in `diary-list-entries-hook`: diary-include-other-diary-files, diary-sort-entries
 * @property {boolean} [mergeRows]  `org-xx-diary-merge-rows`: show the day as Org does, untimed entries joined into the row before
 */

/** @param {string} s */
function regexpQuote(s) {
  return s.replace(/[[*.\\?+^$]/g, '\\$&');
}

/** The date form that applies: `diary-date-forms` when set, else the list of the style.
 * @param {DiaryOptions} options
 * @returns {DateForm[]} */
export function dateFormsFor(options) {
  return options.dateForms || DIARY_DATE_FORMS[/** @type {keyof typeof DIARY_DATE_FORMS} */ (options.dateStyle || 'american')] || DIARY_DATE_FORMS.american;
}

/** A date form in words, for "this line matched the month/day form": month, day, year, month name and weekday in order, with the
 *  plain separators between them; the patterns that only decide where the date ends are left out.
 * @param {DateForm} form
 * @returns {string} */
export function describeDateForm(form) {
  const names = { month: 'month', day: 'day', year: 'year', monthname: 'month name', dayname: 'weekday' };
  let out = '';
  for (const part of form) {
    if (typeof part !== 'string') continue;
    if (part in names) out += names[/** @type {keyof typeof names} */ (part)];
    else if (/^[-/]$/.test(part)) out += part;
    else if (part === '[-/]') out += '-';
    else if (/^ ?\*$|^,? ?\*$|^ \*$/.test(part)) out += part.startsWith(',') ? ', ' : ' ';
  }
  return out;
}

/** The regexp (Emacs syntax) for one date form on one day, as diary-list-entries-2 builds it.
 * @param {DateForm} form
 * @param {Date} date
 * @param {{ mark: string, abbreviatedYear: boolean }} opts */
function formRegexp(form, date, opts) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  const dayName = DAYS[date.getDay()];
  const values = {
    dayname: `${dayName}\\|${dayName.slice(0, 3)}\\.?`,
    monthname: `\\*\\|${MONTHS[month - 1]}\\|${MONTHS[month - 1].slice(0, 3)}\\.?`,
    month: `\\*\\|0*${month}`,
    day: `\\*\\|0*${day}`,
    year: `\\*\\|0*${year}${opts.abbreviatedYear ? `\\|${String(year % 100).padStart(2, '0')}` : ''}`,
  };
  const parts = form.filter((p) => typeof p === 'string').map((p) => (p in values ? values[/** @type {keyof typeof values} */ (p)] : p));
  return `^${regexpQuote(opts.mark)}?\\(${parts.join('\\)\\(?:')}\\)`;
}

/** Emacs reads the diary with `*` and `:` as word characters (diary-syntax-table), which `\W` and `\<` in the date forms follow. */
const WORD = '\\p{L}\\p{N}*:';

/** The regexp (JS) for a date form in the Emacs syntax: `\W` and `\<` follow the diary's idea of a word.
 * @param {string} emacsSource */
function compileForm(emacsSource) {
  const base = emacsRegexToJs(emacsSource, 'gim').source;
  return new RegExp(base.replaceAll('\\b(?=\\w)', `(?<![${WORD}])(?=[${WORD}])`).replaceAll('\\W', `[^${WORD}]`), 'gimu');
}

/** The start of the word that ends at or just before `pos` (Emacs's `(re-search-backward "\\<" nil t)`: a match at `pos` itself
 *  does not count).
 * @param {string} text
 * @param {number} pos */
function backToWordStart(text, pos) {
  const isWord = (/** @type {number} */ i) => i >= 0 && i < text.length && new RegExp(`[${WORD}]`, 'u').test(text[i]);
  for (let i = pos - 1; i >= 0; i--) if (isWord(i) && !isWord(i - 1)) return i;
  return pos;
}

/**
 * The entries of the file that apply to `date` through a date form, in Emacs's order: form by form, each in file order.
 * An entry is the text after the date and the indented lines that follow it; a date alone on a line is not an entry.
 * @param {string} text  the diary file
 * @param {Date} date
 * @param {DiaryOptions} [options]
 * @returns {string[][]}  each entry as its lines (the first without the date)
 */
export function datedEntries(text, date, options = {}) {
  return datedEntriesAt(text, date, options).map((e) => e.lines);
}

/** @typedef {{ lines: string[], startLine: number, endLine: number, formIndex: number, lineText: string }} LocatedEntry  an entry's lines and the 1-based lines of the file it occupies, the date's line included */

/** The 1-based line number of the character at `offset`.
 * @param {string} text @param {number} offset */
function lineAt(text, offset) {
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** The text of the line holding `offset`, trimmed.
 * @param {string} text @param {number} offset */
function lineTextAt(text, offset) {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const nl = text.indexOf('\n', offset);
  return text.slice(start, nl === -1 ? text.length : nl).trim();
}

/** datedEntries with the place of each entry in the file.
 * @param {string} text @param {Date} date @param {DiaryOptions} [options]
 * @returns {LocatedEntry[]} */
export function datedEntriesAt(text, date, options = {}) {
  const forms = dateFormsFor(options);
  const mark = options.nonmarkingSymbol ?? '&';
  const abbreviatedYear = options.abbreviatedYear !== false;
  /** @type {LocatedEntry[]} */
  const found = [];
  for (const [formIndex, form] of forms.entries()) {
    const backup = typeof form[0] === 'object';
    let regexp;
    try {
      regexp = compileForm(formRegexp(form, date, { mark, abbreviatedYear }));
    } catch {
      continue; // a form of diary-date-forms that is not a valid pattern matches nothing
    }
    let match;
    while ((match = regexp.exec(text))) {
      let point = match.index + match[0].length;
      if (backup) point = backToWordStart(text, point);
      const atLineStart = point === 0 || text[point - 1] === '\n';
      if (atLineStart && !/[ \t]/.test(text[point] ?? '')) {
        regexp.lastIndex = Math.max(point - 1, match.index + 1); // the date is the whole entry
        continue;
      }
      let entryStart = point;
      const lineEnd = text.indexOf('\n', point);
      const rest = lineEnd === -1 ? text.slice(point) : text.slice(point, lineEnd);
      if (lineEnd !== -1 && /^[ \t]*$/.test(rest) && /[ \t]/.test(text[lineEnd + 1] ?? '')) entryStart = lineEnd + 1; // the entry starts on the next line
      let end = text.indexOf('\n', entryStart);
      while (end !== -1 && /[ \t]/.test(text[end + 1] ?? '')) end = text.indexOf('\n', end + 1); // continuation lines
      if (end === -1) end = text.length;
      found.push({ lines: text.slice(entryStart, end).split('\n'), startLine: lineAt(text, match.index), endLine: lineAt(text, Math.max(end - 1, match.index)), formIndex, lineText: lineTextAt(text, match.index) });
      regexp.lastIndex = Math.max(end, match.index + 1);
    }
  }
  return found;
}

/** The lines of the file that are sexp entries (`%%(…) text`, with their indented continuation lines), as text without the
 *  leading nonmarking symbol.
 * @param {string} text
 * @param {DiaryOptions} [options]
 * @returns {string[]} */
export function sexpEntryLines(text, options = {}) {
  return sexpEntriesAt(text, options).map((e) => e.text);
}

/** sexpEntryLines with the lines each entry occupies.
 * @param {string} text @param {DiaryOptions} [options]
 * @returns {{ text: string, startLine: number, endLine: number, lineText: string }[]} */
export function sexpEntriesAt(text, options = {}) {
  const mark = options.nonmarkingSymbol ?? '&';
  const symbol = options.sexpSymbol ?? '%%';
  const start = new RegExp(`^${regexpQuote(mark)}?${regexpQuote(symbol)}\\(`);
  const lines = text.split('\n');
  /** @type {{ text: string, startLine: number, endLine: number, lineText: string }[]} */ const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!start.test(lines[i])) continue;
    const startLine = i + 1;
    let entry = lines[i].replace(new RegExp(`^${regexpQuote(mark)}`), '');
    while (/^[ \t]/.test(lines[i + 1] ?? '')) {
      i++;
      entry += `; ${lines[i].trim()}`;
    }
    out.push({ text: entry.replace(new RegExp(`^${regexpQuote(symbol)}`), '%%'), startLine, endLine: i + 1, lineText: lines[startLine - 1].trim() });
  }
  return out;
}

/** The files a diary names with `#include "file"` (Emacs follows them only when `diary-include-other-diary-files` is in
 *  `diary-list-entries-hook`).
 * @param {string} text
 * @param {DiaryOptions} [options]
 * @returns {string[]} */
export function includedFiles(text, options = {}) {
  const includeString = options.includeString ?? '#include';
  const re = new RegExp(`^${regexpQuote(includeString)}\\s+"([^"\\n]+)"`, 'gm');
  return [...text.matchAll(re)].map((m) => m[1]);
}

/** The time at the start of an entry as Emacs sorts by it (`diary-entry-time`): hhmm, or -9999 when there is none.
 * @param {string} s */
export function diaryEntryTime(s) {
  let m = /^[ \t\n]*([0-9]?[0-9])[:.]?([0-9][0-9])(?:\b|[^ap])/.exec(s);
  if (m) return Number(m[1]) * 100 + Number(m[2]);
  m = /^[ \t\n]*([0-9]?[0-9])([ap])m\b/.exec(s);
  if (m) return (Number(m[1]) % 12) * 100 + (m[2] === 'a' ? 0 : 1200);
  m = /^[ \t\n]*([0-9]?[0-9])[:.]([0-9][0-9])([ap])m\b/.exec(s);
  if (m) return (Number(m[1]) % 12) * 100 + Number(m[2]) + (m[3] === 'a' ? 0 : 1200);
  return -9999;
}

/** The time of day Org reads from an entry (`org-get-time-of-day`): the first "9:30", "9:30pm" or "9pm" in it, or null.
 * @param {string} s
 * @returns {{ hour: number, minute: number } | null} */
export function orgTimeOfDay(s) {
  const m = /\b([012]?[0-9])(?::([0-5][0-9])([AaPp][Mm])?|([AaPp][Mm]))\b/.exec(s);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridian = (m[3] || m[4] || '').toLowerCase();
  if (meridian === 'pm' && hour < 12) hour += 12;
  if (meridian === 'am' && hour === 12) hour = 0;
  return hour > 23 ? null : { hour, minute };
}

/** Whether Org starts a new row for a diary line: it begins with a time (diary-time-regexp anchored).
 * @param {string} s */
function startsWithTime(s) {
  return /^(?:[0-9]?[0-9](?:[AaPp][mM]|(?:[Hh](?:[0-9][0-9])?|[:.][0-9][0-9])(?:[AaPp][Mm])?))/.test(s);
}

/**
 * What the Diary shows for one day, as rows of text in the order Emacs lists them: the holidays, then the entries (every
 * sexp entries evaluated by `sexpTitle`, then every date form in file order), then the entries of the included files.
 * @param {{ text: string, included?: { text: string }[] }} diary  the main file and the files it includes
 * @param {Date} date
 * @param {DiaryOptions} options
 * @param {(line: string) => string | null} [sexpTitle]  the title of a `%%(…) text` line on `date`, or null when it does not apply
 * @returns {string[]}
 */
export function diaryRowsForDay(diary, date, options, sexpTitle) {
  return diaryRowsLocated(diary, date, options, sexpTitle).map((r) => r.text);
}

/** @typedef {{ text: string, file: number, startLine: number, endLine: number, lineText: string }} DiaryRow  a row and where it is written: `file` 0 is the diary, 1 and up the included files in order, -1 a holiday (which is written nowhere) */

/**
 * diaryRowsForDay with the place of each row: the file and the lines of the entry it starts from.
 * @param {{ text: string, included?: { text: string }[] }} diary
 * @param {Date} date
 * @param {DiaryOptions} options
 * @param {(line: string) => string | null} [sexpTitle]
 * @returns {DiaryRow[]}
 */
export function diaryRowsLocated(diary, date, options, sexpTitle) {
  const hooks = options.hooks || [];
  const files = [diary.text, ...(hooks.includes('diary-include-other-diary-files') ? (diary.included || []).map((f) => f.text) : [])];
  /** @type {{ lines: string[], file: number, startLine: number, endLine: number, lineText: string }[]} */ let entries = [];
  files.forEach((text, file) => {
    if (sexpTitle) {
      for (const sexp of sexpEntriesAt(text, options)) {
        const title = sexpTitle(sexp.text);
        if (title !== null) entries.push({ lines: [title], file, startLine: sexp.startLine, endLine: sexp.endLine, lineText: sexp.lineText });
      }
    }
    for (const e of datedEntriesAt(text, date, options)) entries.push({ ...e, file });
  });
  if (hooks.includes('diary-sort-entries')) {
    const key = (/** @type {{ lines: string[] }} */ e) => e.lines.join('\n');
    entries = entries
      .map((e, i) => ({ e, i }))
      .sort((a, b) => diaryEntryTime(key(a.e)) - diaryEntryTime(key(b.e)) || (key(a.e) < key(b.e) ? -1 : key(a.e) > key(b.e) ? 1 : 0) || a.i - b.i)
      .map((x) => x.e);
  }
  /** @type {DiaryRow[]} */
  const holidays = (options.showHolidays === false ? [] : holidaysOn(date)).filter(Boolean).map((text) => ({ text, file: -1, startLine: 0, endLine: 0, lineText: '' }));
  if (!options.mergeRows) {
    /** @type {DiaryRow[]} */ const rows = [...holidays];
    for (const e of entries) {
      const text = e.lines.map((l) => l.trim()).filter(Boolean).join('; ');
      if (text) rows.push({ text, file: e.file, startLine: e.startLine, endLine: e.endLine, lineText: e.lineText });
    }
    return rows;
  }
  // Org reads the day from the "fancy" diary buffer. There the holidays and the text of a sexp entry start at the left edge, while
  // an entry written after its date keeps the space that followed the date and a continuation line keeps its indent; every
  // indented line that does not start with a time is joined into the line before it.
  /** @type {DiaryRow[]} */ const rows = [...holidays];
  for (const piece of entries) {
    for (const line of piece.lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const last = rows[rows.length - 1];
      if (last && /^[ \t]/.test(line) && !startsWithTime(trimmed)) {
        last.text += `; ${trimmed}`;
        if (last.file >= 0 && last.file === piece.file) last.endLine = Math.max(last.endLine, piece.endLine);
      } else rows.push({ text: trimmed, file: piece.file, startLine: piece.startLine, endLine: piece.endLine, lineText: piece.lineText });
    }
  }
  return rows;
}

/**
 * `diary-date-forms` written as in Emacs, for example `((month "/" day "[^/0-9]") (dayname "\\\\W"))`: lists of the symbols month, day,
 * year, monthname and dayname and of regexp strings, a list starting with `backup` for the form that backs up to a word. Null when
 * it is not set or holds anything else (the app does not evaluate Lisp there).
 * @param {unknown} raw
 * @returns {DateForm[] | null}
 */
export function parseDiaryDateForms(raw) {
  const text = String(raw ?? '').trim().replace(/^'/, '');
  if (!text || text === 'nil') return null;
  let tree;
  try {
    tree = parseSexpr(text);
  } catch {
    return null;
  }
  if (!Array.isArray(tree) || tree.length === 0) return null;
  /** @type {DateForm[]} */ const forms = [];
  for (const node of tree) {
    if (!Array.isArray(node) || node.length === 0) return null;
    /** @type {DateForm} */ const form = [];
    for (const part of node) {
      if (part && part.type === 'string') form.push(part.value);
      else if (part && part.type === 'symbol' && part.value === 'backup' && form.length === 0) form.push({ backup: true });
      else if (part && part.type === 'symbol' && ['month', 'day', 'year', 'monthname', 'dayname'].includes(part.value)) form.push(part.value);
      else return null;
    }
    forms.push(form);
  }
  return forms;
}

/** Everything the diary reads from the variables.
 * @param {Record<string, string>} vars
 * @returns {DiaryOptions} */
export function diaryOptionsFromVars(vars) {
  return {
    dateStyle: getCalendarDateStyle(vars),
    dateForms: parseDiaryDateForms((vars || {})['diary-date-forms']),
    abbreviatedYear: getDiaryAbbreviatedYearFlag(vars),
    nonmarkingSymbol: getDiarySymbol(vars, 'diary-nonmarking-symbol'),
    sexpSymbol: getDiarySymbol(vars, 'diary-sexp-entry-symbol'),
    includeString: getDiarySymbol(vars, 'diary-include-string'),
    showHolidays: getDiaryShowHolidaysFlag(vars),
    hooks: getDiaryListEntriesHook(vars),
    mergeRows: getDiaryMergeRows(vars),
  };
}
