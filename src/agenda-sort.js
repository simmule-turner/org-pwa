// @ts-check
// org-agenda-sorting-strategy: the keys that order an agenda view's rows. Emacs sorts with `(or key1 key2 ...)`: each key says
// before (-1), after (1) or nothing (nil); the first key with an opinion decides. `category-keep` returns 1 when the categories
// differ (leave them as they are) and nothing when they match. Pure functions over agenda items.
import { effortSortValue, entryTimestampText } from './agenda.js';
import { findTimestamps, parseOrgTimestamp } from './org-timestamp.js';
import { dayNumber } from './habit.js';
import { priorityRank, readPriorityRange } from './priorities.js';

/** @typedef {import('./agenda.js').AgendaItem} AgendaItem */
/** @typedef {'agenda' | 'todo' | 'tags' | 'search'} StrategyView */

/** The default strategy of each view (the value of org-agenda-sorting-strategy in Emacs). */
export const DEFAULT_STRATEGY = Object.freeze({
  agenda: ['habit-down', 'time-up', 'priority-down', 'category-keep'],
  todo: ['priority-down', 'category-keep'],
  tags: ['priority-down', 'category-keep'],
  search: ['category-keep'],
});

const KEY_RE = /^(timestamp|scheduled|deadline|tsia|ts|time|priority|effort|category|tag|todo-state|habit|alpha|user-defined)-(up|down)$/;

/**
 * The key list of one view from the variable's text, e.g. `((agenda habit-down time-up) (todo priority-down))`; null when the
 * variable is unset or has no entry for the view (so the caller keeps its own order). Unknown words are dropped.
 * @param {string | null | undefined} raw
 * @param {StrategyView} view
 * @returns {string[] | null}
 */
export function parseSortingStrategy(raw, view) {
  if (!raw || !String(raw).trim()) return null;
  // a list of just keys, as a custom command gives it, is the strategy of every view (its first item is a symbol, not a (view keys) group)
  const flat = /^\s*'?\(\s*[a-z]/.exec(String(raw));
  if (flat) {
    return String(raw)
      .replace(/^\s*'?\(|\)\s*$/g, '')
      .trim()
      .split(/\s+/)
      .filter((word) => word === 'category-keep' || KEY_RE.test(word));
  }
  const group = new RegExp(`\\(\\s*${view}\\b([^()]*)\\)`).exec(String(raw));
  if (!group) return null;
  return group[1]
    .trim()
    .split(/\s+/)
    .filter((word) => word === 'category-keep' || KEY_RE.test(word));
}

/**
 * The date a TODO-list (or Match, Search) row sorts by (org-agenda-entry-get-agenda-timestamp): of the first of these the strategy
 * names, scheduled, deadline, ts, tsia, timestamp: the entry's SCHEDULED, its DEADLINE, its first active time stamp, its first
 * inactive one, or (timestamp) the first of SCHEDULED, DEADLINE, active, inactive that it has. Only a key of that kind compares it.
 * @param {AgendaItem} item @param {string[]} keys @param {string} type '' for any, scheduled, deadline, timestamp, timestamp_ia
 * @returns {number | null}
 */
function entryStampDay(item, keys, type) {
  const named = (/** @type {string} */ n) => keys.some((k) => k === `${n}-up` || k === `${n}-down`);
  const selected = named('scheduled') ? 'scheduled' : named('deadline') ? 'deadline' : named('ts') ? 'timestamp' : named('tsia') ? 'timestamp_ia' : '';
  if (!`todo ${selected}`.includes(type)) return null;
  const planning = (item.heading && item.heading.planning) || { scheduled: null, deadline: null };
  const stamps = item.heading ? findTimestamps(entryTimestampText(item.heading)) : [];
  const active = stamps.find((t) => t.active);
  const inactive = stamps.find((t) => !t.active);
  /** @param {string | null | undefined} raw */
  const dayOf = (raw) => {
    const ts = raw ? parseOrgTimestamp(raw) : null;
    return ts ? dayNumber(ts.date) : null;
  };
  if (selected === 'scheduled') return dayOf(planning.scheduled);
  if (selected === 'deadline') return dayOf(planning.deadline);
  if (selected === 'timestamp') return active ? dayNumber(active.date) : null;
  if (selected === 'timestamp_ia') return inactive ? dayNumber(inactive.date) : null;
  return dayOf(planning.scheduled) ?? dayOf(planning.deadline) ?? (active ? dayNumber(active.date) : null) ?? (inactive ? dayNumber(inactive.date) : null);
}

/** @param {AgendaItem} item @param {string} type  '' for any, else scheduled / deadline / timestamp
 * @param {string[]} keys the keys of the strategy
 * @returns {number | null} the day number of its timestamp of that type */
function timestampDay(item, type, keys) {
  const kind = item.kind === 'scheduled' || item.kind === 'deadline' ? item.kind : item.heading ? 'timestamp' : '';
  if (!item.kind && item.heading && !item.date) return entryStampDay(item, keys, type); // a TODO-list row has no date of its own
  if (item.tsDate !== undefined) return !type || kind === type ? item.tsDate : null; // Emacs's ts-date: the date written in the stamp, not the day listed (none on a date range)
  if (!item.date || (type && kind !== type)) return null;
  return dayNumber(item.date);
}

/** @param {number | string} a @param {number | string} b @returns {-1 | 1 | null} */
function three(a, b) {
  return a < b ? -1 : a > b ? 1 : null;
}

/**
 * The keys of one view: those the variable names, or Emacs's own default when the variable is not set. A variable that is set
 * but has no entry for the view leaves the rows as they are (null), as Emacs does.
 * @param {string | null | undefined} raw
 * @param {StrategyView} view
 * @returns {string[] | null}
 */
export function strategyFor(raw, view) {
  if (!raw || !String(raw).trim() || String(raw).trim().toLowerCase() === 'nil') return [...DEFAULT_STRATEGY[view]];
  return parseSortingStrategy(raw, view);
}

/**
 * A comparator for the keys. `context` carries what some keys need: the priority range, and the TODO keywords with the done ones.
 * @param {string[]} keys
 * @param {{ localVariables?: Record<string, string>, todoKeywords?: string[], doneKeywords?: string[], lisp?: import('./agenda-lisp.js').AgendaLisp | null }} [context]  `lisp` has the settings that name a function
 * @returns {(a: AgendaItem, b: AgendaItem) => number}
 */
export function agendaComparator(keys, context = {}) {
  const range = readPriorityRange(context.localVariables);
  // org-todo-keywords-1: the keywords to do, then the done ones
  const todoKeywords = [...new Set([...(context.todoKeywords || []), ...(context.doneKeywords || [])])];
  const done = new Set(context.doneKeywords || []);
  const lateDay = 99999999;

  /** @param {string} key @param {AgendaItem} a @param {AgendaItem} b @returns {-1 | 1 | null} */
  const compareKey = (key, a, b) => {
    if (key === 'category-keep') return three(a.category || '', b.category || '') ? 1 : null;
    const [, name, direction] = KEY_RE.exec(key) || [];
    /** @type {-1 | 1 | null} */ let up;
    if (name === 'time') {
      const minutes = (/** @type {AgendaItem} */ i) => i.timeOfDay ?? (i.hasTime ? i.date.getHours() * 100 + i.date.getMinutes() : 9901);
      up = three(minutes(a), minutes(b));
    } else if (name === 'priority') {
      // Emacs adds to a scheduled row 99 plus the days since its date (scheduledAge, also on a repeat), and to a deadline row the days left (negative) or overdue
      const rank = (/** @type {AgendaItem} */ i) => {
        if (i.fixedPriority !== undefined) return i.fixedPriority; // a log line
        if ((!i.heading && !i.priority) || i.samePriority) return 0; // a Search row has the same priority whatever its cookie says
        if (i.habit && typeof i.habit.priority === 'number') return i.habit.priority; // org-habit-get-priority
        const days = i.daysOverdue || 0;
        const bonus = i.kind === 'scheduled' ? 99 + (i.scheduledAge ?? Math.max(0, days)) : i.kind === 'deadline' ? days : 0;
        const own = context.lisp?.priorityOf ? context.lisp.priorityOf(i) : null;
        return (own ?? priorityRank(i.priority, range)) + bonus;
      };
      up = three(rank(a), rank(b));
    } else if (name === 'effort') {
      up = three(effortSortValue(a), effortSortValue(b));
    } else if (name === 'category') {
      up = three(a.category || '', b.category || '');
    } else if (name === 'tag') {
      const first = (/** @type {AgendaItem} */ i) => (i.tags && i.tags.length ? i.tags[0] : null);
      const ta = first(a);
      const tb = first(b);
      up = ta === null && tb === null ? null : ta === null ? 1 : tb === null ? -1 : three(ta, tb);
    } else if (name === 'todo-state') {
      const ta = a.todo || '';
      const tb = b.todo || '';
      if (done.has(ta) && !done.has(tb)) up = -1;
      else if (!done.has(ta) && done.has(tb)) up = 1;
      else {
        const place = (/** @type {string} */ t) => (todoKeywords.includes(t) ? todoKeywords.length - todoKeywords.indexOf(t) : 0);
        up = three(-place(ta), -place(tb));
      }
    } else if (name === 'habit') {
      up = a.habit && !b.habit ? -1 : !a.habit && b.habit ? 1 : null;
    } else if (name === 'alpha') {
      // Emacs strips the TODO keyword but its pattern for the priority cookie misses `[#A]`, so the cookie sorts with the title
      const title = (/** @type {AgendaItem} */ i) => (i.heading ? ((i.priority ? `[#${i.priority}] ` : '') + String(i.title || '')).toLowerCase() : null);
      const ta = title(a);
      const tb = title(b);
      up = ta === null && tb === null ? null : ta === null ? 1 : tb === null ? -1 : three(ta, tb);
    } else if (name === 'ts' || name === 'timestamp' || name === 'scheduled' || name === 'deadline' || name === 'tsia') {
      const type = name === 'timestamp' ? '' : name === 'ts' ? 'timestamp' : name === 'tsia' ? 'timestamp_ia' : name; // timestamp-up compares the stamps of every type, ts-up those of plain time stamps
      const da = timestampDay(a, type, keys) ?? lateDay;
      const db = timestampDay(b, type, keys) ?? lateDay;
      up = three(da, db);
    } else if (name === 'user-defined') {
      up = context.lisp?.userCompare ? context.lisp.userCompare(a, b) : null; // org-agenda-cmp-user-defined nil: no opinion
    } else return null;
    if (up === null) return null;
    return direction === 'down' ? /** @type {-1 | 1} */ (-up) : up;
  };

  return (a, b) => {
    for (const key of keys) {
      const ab = compareKey(key, a, b);
      if (ab === null) continue;
      if (ab === -1) return -1;
      // a is not less than b: b may still be less than a
      for (const k of keys) {
        const ba = compareKey(k, b, a);
        if (ba === null) continue;
        return ba === -1 ? 1 : 0;
      }
      return 0;
    }
    return 0;
  };
}

/** A stably sorted copy. Emacs sorts the rows in the order it collected them (file by file, deadlines, then scheduled, then time
 * stamps), which `category-keep` and ties show, so the rows are put in that order first.
 * @param {AgendaItem[]} items
 * @param {string[]} keys
 * @param {Parameters<typeof agendaComparator>[1] & { documentOrder?: string[] }} [context] */
export function sortAgendaItems(items, keys, context = {}) {
  if (!keys.length) return items;
  const files = context.documentOrder || [];
  const file = (/** @type {AgendaItem} */ i) => {
    const at = files.indexOf(i.documentId);
    return at < 0 ? files.length : at;
  };
  const type = (/** @type {AgendaItem} */ i) => i.emacsOrder ?? (i.kind === 'deadline' ? 0 : i.kind === 'scheduled' ? 1 : 4);
  return [...items].sort((a, b) => file(a) - file(b) || type(a) - type(b)).sort(agendaComparator(keys, context));
}
