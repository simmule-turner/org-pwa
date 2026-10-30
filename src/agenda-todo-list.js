// @ts-check
// Which TODO entries the Emacs global TODO list leaves out for the dates they carry (org-agenda-todo-ignore-scheduled,
// -deadlines, -timestamp, -with-date) and whether it goes below a listed entry (org-agenda-todo-list-sublevels): a port of
// org-agenda-check-for-timestamp-as-reason-to-ignore-todo-item and its helpers (org-agenda.el), checked against Emacs 29.3 in
// test/oracle-agenda.test.js.
import { dayNumber } from './habit.js';
import { getWdays } from './agenda-emacs-days.js';

/** @typedef {null | true | number | string} IgnoreSetting nil, t, a number of days or a symbol such as 'future */
/** @typedef {{ withDate: boolean, scheduled: IgnoreSetting, deadlines: IgnoreSetting, timestamp: IgnoreSetting, sublevels: boolean }} TodoListSettings */

/** @param {string | undefined} raw @returns {IgnoreSetting} */
function lispSetting(raw) {
  if (raw === undefined) return null;
  const v = String(raw).trim().replace(/^'/, '');
  if (v === '' || v === 'nil') return null;
  if (v === 't') return true;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

/** The TODO list settings of a file's variables, Emacs's defaults where unset. @param {Record<string, string> | undefined} vars @returns {TodoListSettings} */
export function readTodoListSettings(vars) {
  const v = vars || {};
  return {
    withDate: lispSetting(v['org-agenda-todo-ignore-with-date']) !== null,
    scheduled: lispSetting(v['org-agenda-todo-ignore-scheduled']),
    deadlines: lispSetting(v['org-agenda-todo-ignore-deadlines']),
    timestamp: lispSetting(v['org-agenda-todo-ignore-timestamp']),
    sublevels: lispSetting(v['org-agenda-todo-list-sublevels']) !== null || v['org-agenda-todo-list-sublevels'] === undefined,
  };
}

/** Days from today to the day a time stamp's text names (org-time-stamp-to-now). @param {string} stamp @param {number} today */
function toNow(stamp, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(stamp);
  return m ? dayNumber(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) - today : 0;
}

/** org-agenda-todo-custom-ignore-p. @param {string} stamp @param {number} n @param {number} today */
const customIgnore = (stamp, n, today) => (n >= 0 ? toNow(stamp, today) >= n : toNow(stamp, today) <= n);

/**
 * Whether a TODO entry's dates make the TODO list leave it out.
 * @param {string} text the entry, from its heading line to the next heading: title, planning line, drawers and body
 * @param {TodoListSettings} s
 * @param {number} today a day number
 * @param {number} warningDays org-deadline-warning-days
 */
export function ignoredForDates(text, s, today, warningDays) {
  if (!s.withDate && !s.scheduled && !s.deadlines && !s.timestamp) return false;
  let pos = 0; // Emacs searches on from where the last search found something
  /** @param {RegExp} re @returns {RegExpExecArray | null} */
  const find = (re) => {
    const g = new RegExp(re.source, 'g');
    g.lastIndex = pos;
    const m = g.exec(text);
    if (m) pos = m.index + m[0].length;
    return m;
  };
  if (s.withDate && find(/<(\d{4}-\d{2}-\d{2}[^\r\n>]*?)>/)) return true;
  if (s.scheduled) {
    const m = find(/\bSCHEDULED: *<([^>]+)>/);
    if (m) {
      const k = s.scheduled;
      if (k === 'future') return toNow(m[1], today) > 0;
      if (k === 'past') return toNow(m[1], today) <= 0;
      if (typeof k === 'number') return customIgnore(m[1], k, today);
      return true;
    }
  }
  if (s.deadlines) {
    const m = find(/\bDEADLINE: *<([^>]+)>/);
    if (m) {
      const k = s.deadlines;
      const close = () => toNow(m[1], today) <= getWdays(m[1], { warningDays, delayDays: 0 });
      if (k === 'all') return true;
      if (k === 'far') return !close();
      if (k === 'future') return toNow(m[1], today) > 0;
      if (k === 'past') return toNow(m[1], today) <= 0;
      if (typeof k === 'number') return customIgnore(m[1], k, today);
      return close();
    }
  }
  if (s.timestamp) {
    const rest = text.slice(pos).replace(/\bSCHEDULED: *<([^>]+)>/g, '').replace(/\bDEADLINE: *<([^>]+)>/g, '');
    const m = /<(\d{4}-\d{2}-\d{2}[^\r\n>]*?)>/.exec(rest);
    if (m) {
      const k = s.timestamp;
      if (k === 'future') return toNow(m[1], today) > 0;
      if (k === 'past') return toNow(m[1], today) <= 0;
      if (typeof k === 'number') return customIgnore(m[1], k, today);
      return true;
    }
  }
  return false;
}
