// @ts-check
// Log mode of the Emacs 29.3 agenda (org-agenda-get-progress, org-agenda.el): the lines of an entry that say when something was done
// on a day of the view -- its CLOSED stamp, a CLOCK line, a `- State "DONE" ...` line of the log -- as rows "Closed:", "Clocked: (0:45)"
// and "State: (DONE)". Which kinds are listed is `org-agenda-log-mode-items` (closed and clock), or the list a `org-agenda-show-log` of
// that kind names; `org-agenda-log-mode-add-notes` adds the note that follows the line. A line counts on the day its first stamp is on.
import { dayNumberOf, lispValue } from './agenda-emacs-days.js';
import { allLogLines } from './logbook.js';
import { datum, listItems, readLisp, stringValue, symbolName } from './lisp-read.js';
import { parseOrgDuration } from './org-duration.js';

/** @typedef {'closed' | 'clock' | 'state'} LogKind */
/** @typedef {{ mode: boolean | 'only' | 'clockcheck', kinds: LogKind[], addNotes: boolean }} LogSettings */
/** @typedef {{ type: LogKind, day: number, hour: number | null, minute: number | null, endHour: number | null, endMinute: number | null, label: string, note: string | null, line: number, clockStart: Date | null, clockEnd: Date | null }} LogRow */

const KINDS = /** @type {LogKind[]} */ (['closed', 'clock', 'state']);

/**
 * `org-agenda-show-log` (the log mode a view starts in), `org-agenda-start-with-log-mode`, `org-agenda-log-mode-items` and
 * `org-agenda-log-mode-add-notes`. `org-agenda-show-log` names the kinds itself when it is a list.
 * @param {Record<string, string> | undefined} vars @param {boolean | 'only' | 'clockcheck' | LogKind[] | null} [view] the mode a person chose in the view (the `l` key)
 * @returns {LogSettings}
 */
export function readLogSettings(vars, view = null) {
  const v = vars || {};
  const raw = view !== null && view !== undefined ? view : lispValue(v['org-agenda-start-with-log-mode']);
  const items = lispValue(v['org-agenda-log-mode-items']);
  const configured = Array.isArray(items) ? items.filter((k) => KINDS.includes(/** @type {LogKind} */ (k))) : v['org-agenda-log-mode-items'] === undefined ? ['closed', 'clock'] : [];
  const notes = v['org-agenda-log-mode-add-notes'] === undefined ? true : lispValue(v['org-agenda-log-mode-add-notes']) !== null;
  if (Array.isArray(raw)) return { mode: true, kinds: /** @type {LogKind[]} */ (raw.filter((k) => KINDS.includes(/** @type {LogKind} */ (k)))), addNotes: notes };
  if (raw === 'clockcheck') return { mode: 'clockcheck', kinds: ['clock'], addNotes: notes };
  if (raw === 'only') return { mode: 'only', kinds: /** @type {LogKind[]} */ (configured), addNotes: notes };
  return { mode: raw !== null && raw !== false, kinds: /** @type {LogKind[]} */ (configured), addNotes: notes };
}

/** @param {string[]} words */
const alternatives = (words) => words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

/**
 * The lines of an entry as Emacs searches them in the buffer, in file order: the heading line, the planning line, the log and the body
 * (the lines of a comment or a src block are left out, as org-agenda-skip leaves them).
 * @param {import('./types.js').Heading} heading
 * @returns {string[]}
 */
export function entryLines(heading) {
  const tags = heading.tags && heading.tags.length ? ` :${heading.tags.join(':')}:` : '';
  const head = `${'*'.repeat(heading.level || 1)} ${[heading.todo, heading.priority ? `[#${heading.priority}]` : '', heading.title].filter(Boolean).join(' ')}${tags}`;
  const planning = heading.planning || { scheduled: null, deadline: null };
  const parts = [];
  if (planning.closed) parts.push(`CLOSED: ${planning.closed}`);
  for (const k of /** @type {('scheduled' | 'deadline')[]} */ (planning.order || ['scheduled', 'deadline'])) if ((k === 'scheduled' || k === 'deadline') && planning[k]) parts.push(`${k.toUpperCase()}: ${planning[k]}`);
  const lines = [head];
  if (parts.length) lines.push(parts.join(' '));
  const properties = Object.entries(heading.properties || {});
  if (properties.length) lines.push(':PROPERTIES:', ...properties.map(([k, v]) => `:${k}: ${v}`), ':END:');
  lines.push(...allLogLines(heading), ...(heading.bodyLines || []));
  return lines;
}

/** Lines that are inside a src block or are comment lines. @param {string[]} lines @returns {boolean[]} */
function skippedLines(lines) {
  const skipped = lines.map(() => false);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#(\s|$)/.test(lines[i])) skipped[i] = true;
    const begin = /^\s*#\+BEGIN_SRC\b/i.exec(lines[i]);
    if (begin) {
      let j = i + 1;
      while (j < lines.length && !/^\s*#\+END_SRC\b/i.test(lines[j])) j++;
      if (j < lines.length) {
        for (let k = i + 1; k < j; k++) skipped[k] = true;
        i = j;
      }
    }
  }
  return skipped;
}

/**
 * The log rows of one entry that fall on days `first` to `last` (day numbers), in the order of the lines.
 * @param {import('./types.js').Heading} heading
 * @param {LogSettings} settings
 * @param {string[]} keywords every TODO keyword of the file (org-todo-regexp)
 * @param {number} first @param {number} last
 * @returns {LogRow[]}
 */
export function logRows(heading, settings, keywords, first, last) {
  if (!settings.kinds.length) return [];
  const lines = entryLines(heading);
  const skip = skippedLines(lines);
  const parts = [];
  if (settings.kinds.includes('closed')) parts.push('\\bCLOSED:');
  if (settings.kinds.includes('clock')) parts.push('\\bCLOCK:');
  if (settings.kinds.includes('state') && keywords.length) parts.push(`- +State "(${alternatives([...keywords].sort((a, b) => b.length - a.length))}).*?`);
  if (!parts.length) return [];
  const re = new RegExp(`(${parts.join('|')}) *\\[(\\d{4})-(\\d{2})-(\\d{2})`);
  /** @type {LogRow[]} */ const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (skip[i]) continue;
    const m = re.exec(lines[i]);
    if (!m) continue;
    const day = dayNumberOf(new Date(Number(m[m.length - 3]), Number(m[m.length - 2]) - 1, Number(m[m.length - 1])));
    if (day < first || day > last) continue;
    const closed = m[1] === 'CLOSED:';
    const state = m[1][0] === '-';
    const rest0 = lines[i].slice(m.index);
    const close = rest0.indexOf(']');
    let stamp = close >= 0 ? rest0.slice(0, close + 1) : rest0;
    const rest = close >= 0 ? rest0.slice(close + 1) : '';
    let clocked = '-';
    if (close >= 0 && !closed && !state) {
      const r = /(\d{1,2}:\d{2})\].*?(\d{1,2}:\d{2})/.exec(rest);
      if (r) {
        stamp = `${stamp.slice(0, -1)}-${r[1]}]`;
        clocked = r[2];
      }
    }
    const time = /(\d{1,2}):(\d{2})(?:-(\d{1,2}):(\d{2}))?\]$/.exec(stamp);
    /** @type {string | null} */ let note = null;
    if (settings.addNotes) {
      if (state) {
        const n = /\\\s*$/.test(lines[i]) && i + 1 < lines.length ? /^[ \t]*([^-\n \t].*?)[ \t]*$/.exec(lines[i + 1]) : null;
        note = n ? n[1] : null;
      } else if (!closed) {
        const n = i + 1 < lines.length ? /^[ \t]*-[ \t]+([^-\n \t].*?)[ \t]*$/.exec(lines[i + 1]) : null;
        note = n ? n[1] : null;
      }
    }
    const type = closed ? 'closed' : state ? 'state' : 'clock';
    rows.push({
      type,
      day,
      hour: time ? Number(time[1]) : null,
      minute: time ? Number(time[2]) : null,
      endHour: time && time[3] !== undefined ? Number(time[3]) : null,
      endMinute: time && time[4] !== undefined ? Number(time[4]) : null,
      label: closed ? 'Closed:' : state ? `State:     (${m[2]})` : `Clocked:   (${clocked})`,
      note,
      line: i,
      ...clockTimes(lines[i], type),
    });
  }
  return rows;
}

/** @param {string} stamp `[2026-10-11 Sun 10:00]` @returns {Date | null} */
function stampTime(stamp) {
  const m = /^\[(\d{4})-(\d{2})-(\d{2})(?:[^\]\d]*?(\d{1,2}):(\d{2}))?/.exec(stamp);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)) : null;
}

/** The two stamps of a CLOCK line (org-agenda-show-clocking-issues reads a line that starts with CLOCK:). @param {string} line @param {LogKind} type */
function clockTimes(line, type) {
  const m = type === 'clock' ? /^[ \t]*CLOCK:[ \t]+(\[.*?\])(-{1,3}(\[.*?\]))?/.exec(line) : null;
  return { clockStart: m ? stampTime(m[1]) : null, clockEnd: m && m[3] ? stampTime(m[3]) : null };
}

const DEFAULT_CHECKS = '(:max-duration "10:00" :min-duration 0 :max-gap "0:05" :gap-ok-around ("4:00"))';

/** @typedef {{ maxDuration: number, minDuration: number, maxGap: number, gapOk: number[] }} ClockChecks minutes */

/**
 * `org-agenda-clock-consistency-checks`: a plist whose missing keys fall back to 24:00, 0 and 30:00 (never complain); Emacs's own default
 * when the variable is unset.
 * @param {Record<string, string> | undefined} vars @returns {ClockChecks}
 */
export function readClockChecks(vars) {
  const raw = (vars || {})['org-agenda-clock-consistency-checks'];
  const minutes = (/** @type {import('./lisp-read.js').Lisp | undefined} */ f, /** @type {string | number} */ fallback) => {
    if (f && f.k === 'num') return f.v;
    const text = f ? stringValue(f) : null;
    const v = parseOrgDuration(text ?? String(fallback));
    return v ?? 0;
  };
  /** @type {import('./lisp-read.js').Lisp[]} */ let plist;
  const text = raw === undefined ? DEFAULT_CHECKS : String(raw);
  const form = readLisp(text)[0];
  plist = (form && listItems(datum(form) || form)) || [];
  /** @param {string} key */
  const get = (key) => {
    for (let i = 0; i + 1 < plist.length; i += 2) if (symbolName(plist[i]) === key) return plist[i + 1];
    return undefined;
  };
  const ok = listItems(get(':gap-ok-around')) || [];
  return {
    maxDuration: minutes(get(':max-duration'), '24:00'),
    minDuration: minutes(get(':min-duration'), 0),
    maxGap: minutes(get(':max-gap'), '30:00'),
    gapOk: ok.map((x) => minutes(x, 0)),
  };
}

/** org-duration-from-minutes in Emacs's default form: days when there is a whole one, then h:mm. @param {number} m */
const hmm = (m) => {
  const a = Math.abs(m);
  const days = Math.floor(a / 1440);
  const rest = a % 1440;
  return `${m < 0 ? '-' : ''}${days ? `${days}d ` : ''}${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')}`;
};

/** org-agenda-check-clock-gap: does the gap from `t1` to `t2` (ms) hold one of the OK times of day? @param {number} t1 @param {number} t2 @param {number[]} ok */
function gapIsOk(t1, t2, ok) {
  if (!ok.length) return false;
  if ((t2 - t1) / 1000 / 36000 > 24) return true; // Emacs divides by 36000, not 3600
  const a = new Date(t1);
  const b = new Date(t2);
  const min1 = a.getMinutes() + 60 * a.getHours();
  let min2 = b.getMinutes() + 60 * b.getHours();
  if (min2 < min1) min2 += 1440;
  return ok.some((x) => {
    const t = x < min1 ? x + 1440 : x;
    return min1 <= t && min2 >= t;
  });
}

/**
 * The clocking issues org-agenda-show-clocking-issues marks, for the Clocked rows of a view in the order they are shown.
 * @param {{ clockStart: Date | null, clockEnd: Date | null }[]} clocks @param {ClockChecks} checks @param {Date} now
 * @returns {(string | null)[]}
 */
export function clockIssues(clocks, checks, now) {
  let tlend = 0;
  return clocks.map((c) => {
    if (!c.clockStart) return null;
    const ts = c.clockStart.getTime() / 1000;
    if (!c.clockEnd) return `No end time: (${hmm(Math.floor((now.getTime() / 1000 - ts) / 60))})`;
    const te = c.clockEnd.getTime() / 1000;
    const dt = te - ts;
    /** @type {string | null} */ let issue = null;
    if (dt > 60 * checks.maxDuration) issue = `Clocking interval is very long: ${hmm(Math.floor(dt / 60))}`;
    else if (dt < 60 * checks.minDuration) issue = `Clocking interval is very short: ${hmm(Math.floor(dt / 60))}`;
    else if (tlend > 0 && ts < tlend) issue = `Clocking overlap: ${Math.trunc((tlend - ts) / 60)} minutes`;
    else if (tlend > 0 && ts > tlend + 60 * checks.maxGap && !gapIsOk(tlend * 1000, ts * 1000, checks.gapOk)) issue = `Clocking gap: ${Math.trunc((ts - tlend) / 60)} minutes`;
    tlend = te;
    return issue;
  });
}
