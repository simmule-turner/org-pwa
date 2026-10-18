// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
// The filter row shared by the Agenda and the TODO view (tag, TODO state, category), and the date the TODO view shows on a
// row. Pure functions: the views in src-browser/ draw them.
import { startOfDay } from './agenda.js';
import { emacsRegexToJs } from './emacs-regex.js';
import { parseOrgTimestamp } from './org-timestamp.js';

/**
 * The chips' choices. The plain lists keep the items that carry any of them (all of the tags when `tagsAll`); the `not` lists
 * drop items that carry any; every regexp must match the row's text; `tops` keep the items under those top-level headings.
 * @typedef {{ tags: string[], todos: string[], categories: string[], notTags?: string[], notTodos?: string[], notCategories?: string[],
 *   tagsAll?: boolean, regexps?: string[], notRegexps?: string[], tops?: string[] }} ViewFilter
 * @typedef {{ kind: 'scheduled' | 'deadline', date: Date, hasTime: boolean, days: number }} TaskDateInfo
 */

/** @returns {ViewFilter} */
export function emptyViewFilter() {
  return { tags: [], todos: [], categories: [], notTags: [], notTodos: [], notCategories: [], tagsAll: false, regexps: [], notRegexps: [], tops: [] };
}

/** @param {ViewFilter | null | undefined} filter */
export function viewFilterActive(filter) {
  if (!filter) return false;
  return [filter.tags, filter.todos, filter.categories, filter.notTags, filter.notTodos, filter.notCategories, filter.regexps, filter.notRegexps, filter.tops].some((l) => !!l && l.length > 0);
}

/** The text a regexp filter sees: the row as Emacs shows it (keyword, title, tags).
 * @param {{ todo?: string, title?: string, heading?: { tags?: string[] } }} item */
function rowText(item) {
  const tags = item.heading && item.heading.tags && item.heading.tags.length ? ` :${item.heading.tags.join(':')}:` : '';
  return `${item.todo ? item.todo + ' ' : ''}${item.title || ''}${tags}`;
}

/** A regexp from a filter, written in Emacs's syntax and case-insensitive as its default; null when it is not valid.
 * @param {string} source */
export function filterRegexp(source) {
  try {
    return emacsRegexToJs(source, 'i');
  } catch {
    return null;
  }
}

/**
 * Keeps the items that pass every part of the filter (Emacs combines its filters with `and`). An item with no heading behind it
 * (sunrise lines, extension lines) is never filtered out, as with the effort view.
 * @param {any[]} items  agenda items or task-list items: { heading?, tags?, todo?, category? }
 * @param {ViewFilter | null | undefined} filter
 */
export function applyViewFilter(items, filter) {
  if (!viewFilterActive(filter)) return items;
  const f = /** @type {ViewFilter} */ (filter);
  const notTags = f.notTags || [];
  const notTodos = f.notTodos || [];
  const notCategories = f.notCategories || [];
  const regexps = (f.regexps || []).map(filterRegexp).filter((r) => r !== null);
  const notRegexps = (f.notRegexps || []).map(filterRegexp).filter((r) => r !== null);
  const tops = f.tops || [];
  return items.filter((item) => {
    if (!item.heading) return true;
    const tags = /** @type {string[]} */ (item.filterTags || item.tags || []);
    if (f.tags.length > 0 && !(f.tagsAll ? f.tags.every((t) => tags.includes(t)) : tags.some((t) => f.tags.includes(t)))) return false;
    if (notTags.length > 0 && tags.some((t) => notTags.includes(t))) return false;
    if (f.todos.length > 0 && !f.todos.includes(item.todo || '')) return false;
    if (notTodos.length > 0 && notTodos.includes(item.todo || '')) return false;
    if (f.categories.length > 0 && !f.categories.includes(item.category || '')) return false;
    if (notCategories.length > 0 && notCategories.includes(item.category || '')) return false;
    if (tops.length > 0 && !tops.includes(item.topTitle || '')) return false;
    if (regexps.length > 0 || notRegexps.length > 0) {
      const text = rowText(item);
      if (regexps.some((r) => !(/** @type {RegExp} */ (r)).test(text))) return false;
      if (notRegexps.some((r) => (/** @type {RegExp} */ (r)).test(text))) return false;
    }
    return true;
  });
}

/**
 * What the filter chips can offer: every tag, TODO state and category in `items`, with how many items carry each.
 * @param {any[]} items
 * @returns {{ tags: [string, number][], todos: [string, number][], categories: [string, number][], tops: [string, number][] }}
 */
export function viewFilterChoices(items) {
  /** @type {Map<string, number>} */ const tags = new Map();
  /** @type {Map<string, number>} */ const todos = new Map();
  /** @type {Map<string, number>} */ const categories = new Map();
  /** @type {Map<string, number>} */ const tops = new Map();
  const bump = (/** @type {Map<string, number>} */ map, /** @type {string} */ key) => map.set(key, (map.get(key) || 0) + 1);
  for (const item of items) {
    if (!item.heading) continue;
    for (const t of item.filterTags || item.tags || []) bump(tags, t);
    if (item.todo) bump(todos, item.todo);
    if (item.category) bump(categories, item.category);
    if (item.topTitle) bump(tops, item.topTitle);
  }
  const sorted = (/** @type {Map<string, number>} */ map) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { tags: sorted(tags), todos: sorted(todos), categories: sorted(categories), tops: sorted(tops) };
}

/**
 * The date a TODO row shows: the earlier of its SCHEDULED and DEADLINE (an inactive one is no reminder, as in the Agenda), and
 * how many days it is past (positive), or ahead (negative). A repeating one counts from the date written, as the Agenda does.
 * @param {Heading} heading
 * @param {Date} today
 * @returns {TaskDateInfo | null}
 */
export function taskDateInfo(heading, today) {
  /** @type {TaskDateInfo | null} */ let best = null;
  for (const kind of /** @type {const} */ (['scheduled', 'deadline'])) {
    const raw = heading.planning && heading.planning[kind];
    const parsed = raw ? parseOrgTimestamp(raw) : null;
    if (!parsed || !parsed.active) continue;
    const days = Math.round((startOfDay(today).getTime() - startOfDay(parsed.date).getTime()) / 86400000);
    if (!best || parsed.date < best.date) best = { kind, date: parsed.date, hasTime: !!parsed.hasTime, days };
  }
  return best;
}

/**
 * The words under a TODO row's title, in the Agenda's own wording.
 * @param {TaskDateInfo} info
 * @returns {{ text: string, overdue: boolean }}
 */
export function describeTaskDate(info) {
  const label = info.kind === 'scheduled' ? 'Scheduled' : 'Deadline';
  const day = info.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const d = info.days;
  if (d > 0) return { text: `${label} ${day} · ${d === 1 ? '1 day' : d + ' days'} overdue`, overdue: true };
  if (d === 0) return { text: `${label} today`, overdue: false };
  return { text: `${label} ${day} · ${d === -1 ? 'due tomorrow' : 'due in ' + -d + ' days'}`, overdue: false };
}

/**
 * Task-list items in date order, soonest (or most overdue) first, those with no date last; items with the same date keep
 * their document order.
 * @param {any[]} items  task-list items with `heading`
 * @param {Date} today
 */
export function sortTasksByDate(items, today) {
  const keyed = items.map((item, index) => {
    const info = taskDateInfo(item.heading, today);
    return { item, index, time: info ? info.date.getTime() : Infinity };
  });
  keyed.sort((a, b) => a.time - b.time || a.index - b.index);
  return keyed.map((k) => k.item);
}
