// @ts-check
// Sparse trees (C-c /): `org-occur` and the checks built on it, as a scan of the buffer text.
import { emacsRegexToJs } from './elisp-regex.js';

/** @typedef {{ start: number, end: number, line: number }} OccurMatch */

/**
 * `org-occur`: every match of the Emacs regexp in the text. `accept` is the callback of org-occur: it gets the match (with its groups)
 * and its line, and a match it refuses is not counted.
 * @param {string[]} lines @param {string} regexp
 * @param {{ foldCase: boolean, accept?: (match: RegExpExecArray, line: number, lines: string[]) => boolean }} options
 * @returns {OccurMatch[]}
 */
export function occur(lines, regexp, { foldCase, accept }) {
  if (regexp === '') throw new Error('Regexp cannot be empty');
  const text = lines.join('\n');
  const re = emacsRegexToJs(regexp, foldCase ? 'gi' : 'g');
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineOf = (/** @type {number} */ at) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  /** @type {OccurMatch[]} */
  const found = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] === '') re.lastIndex++;
    const line = lineOf(m.index);
    if (accept && !accept(m, line, lines)) continue;
    found.push({ start: m.index, end: m.index + m[0].length, line });
  }
  return found;
}

/** `org-occur-case-fold-search`: t, nil or smart (no capital in the regexp). @param {string | undefined} raw @param {string} regexp */
export function occurFoldCase(raw, regexp) {
  const v = (raw ?? 't').trim().replace(/^'/, '');
  return v === 'nil' ? false : v === 'smart' ? !/[A-Z]/.test(regexp.replace(/\\./g, '')) : true;
}

/** `org-at-planning-p`: a line of planning keywords right below a heading. @param {string[]} lines @param {number} line */
export function atPlanningLine(lines, line) {
  return line > 0 && /^\*+ /.test(lines[line - 1]) && /^\s*(?:(?:DEADLINE|SCHEDULED|CLOSED):[^\n]*)$/.test(lines[line]);
}

/**
 * `org-re-timestamp`, as an Emacs regexp; nil is deadline or scheduled.
 * @param {string} type all, active, inactive, scheduled, deadline, closed or ''
 */
export function timestampRegexp(type) {
  const date = '[0-9]\\{4\\}-[0-9]\\{2\\}-[0-9]\\{2\\}';
  switch (type) {
    case 'all':
      return `[<[]\\(${date}[^]>]*\\)[]>]`;
    case 'active':
      return `<\\(${date}[^>]*\\)>`;
    case 'inactive':
      return `\\[\\(${date}[^]]*\\)\\]`;
    case 'scheduled':
      return '\\<SCHEDULED: *<\\([^>]+\\)>';
    case 'deadline':
      return '\\<DEADLINE: *<\\([^>]+\\)>';
    case 'closed':
      return '\\<CLOSED: *\\[\\([^]]+\\)\\]';
    default:
      return '\\<\\(?:DEADLINE:\\|SCHEDULED:\\) *<\\([^>]+\\)>';
  }
}

/** `org-time-string-to-time` at the precision the checks need. @param {string} stamp */
export function stampTime(stamp) {
  const m = /(\d{4})-(\d{2})-(\d{2})(?:[^0-9]+(\d{1,2}):(\d{2}))?/.exec(stamp);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)).getTime() : NaN;
}

/** `org-time-stamp-to-now`: days from today to the stamp's day. @param {string} stamp @param {Date} now */
export function stampDaysFromNow(stamp, now) {
  const at = new Date(stampTime(stamp));
  const day = (/** @type {Date} */ d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
  return day(at) - day(now);
}

/** @typedef {{ regexp: string, foldCase: boolean, accept?: (match: RegExpExecArray, line: number, lines: string[]) => boolean }} OccurQuery */

/** C-c / r. @param {string} regexp @param {string | undefined} caseFoldSetting `org-occur-case-fold-search` @returns {OccurQuery} */
export function regexpQuery(regexp, caseFoldSetting) {
  return { regexp, foldCase: occurFoldCase(caseFoldSetting, regexp) };
}

/** C-c / t (no keyword: every TODO keyword that is not done) and T (`KWD1|KWD2`). @param {string[]} todoKeywords @param {string | null} chosen @returns {OccurQuery} */
export function todoQuery(todoKeywords, chosen) {
  const keywords = chosen === null ? `\\(?:${todoKeywords.join('\\|')}\\)\\>\\s-` : `\\(${chosen.split('|').join('\\|')}\\)\\>`;
  return { regexp: `^\\*+  *${keywords}`, foldCase: false };
}

/** C-c / d: `org-check-deadlines`. @param {number} warnDays @param {Date} now @param {(line: number) => boolean} doneAt @returns {OccurQuery} */
export function deadlineQuery(warnDays, now, doneAt) {
  return {
    regexp: '\\<DEADLINE: *<\\([^>]+\\)>',
    foldCase: false,
    accept: (m, line) => stampDaysFromNow(m[1], now) <= warnDays && !doneAt(line),
  };
}

/** C-c / b, a and D. @param {'before' | 'after' | 'between'} kind @param {string} type org-ts-type @param {number} from @param {number} to @returns {OccurQuery} */
export function dateQuery(kind, type, from, to) {
  return {
    regexp: timestampRegexp(type),
    foldCase: false,
    accept: (m, line, lines) => {
      // a timestamp counts as such in text, not in a planning line, where Org reads it as part of the planning
      if (['all', 'active', 'inactive'].includes(type) === atPlanningLine(lines, line)) return false;
      const at = stampTime(m[1]);
      return kind === 'before' ? at < from : kind === 'after' ? !(at < from) : !(at < from) && at < to;
    },
  };
}
