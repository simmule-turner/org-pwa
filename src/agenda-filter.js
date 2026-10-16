// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
// The filter row shared by the Agenda and the TODO view (tag, TODO state, category), and the date the TODO view shows on a
// row. Pure functions: the views in src-browser/ draw them.
import { startOfDay } from './agenda.js';
import { parseOrgTimestamp } from './org-timestamp.js';

/**
 * @typedef {{ tags: string[], todos: string[], categories: string[] }} ViewFilter
 * @typedef {{ kind: 'scheduled' | 'deadline', date: Date, hasTime: boolean, days: number }} TaskDateInfo
 */

/** @returns {ViewFilter} */
export function emptyViewFilter() {
  return { tags: [], todos: [], categories: [] };
}

/** @param {ViewFilter | null | undefined} filter */
export function viewFilterActive(filter) {
  return !!filter && (filter.tags.length > 0 || filter.todos.length > 0 || filter.categories.length > 0);
}

/**
 * Keeps the items that match every field that has a choice made; inside one field, any of the choices matches. An item with
 * no heading behind it (sunrise lines, extension lines) is never filtered out, as with the effort view.
 * @param {any[]} items  agenda items or task-list items: { heading?, tags?, todo?, category? }
 * @param {ViewFilter | null | undefined} filter
 */
export function applyViewFilter(items, filter) {
  if (!viewFilterActive(filter)) return items;
  const f = /** @type {ViewFilter} */ (filter);
  return items.filter((item) => {
    if (!item.heading) return true;
    if (f.tags.length > 0 && !(item.filterTags || item.tags || []).some((/** @type {string} */ t) => f.tags.includes(t))) return false;
    if (f.todos.length > 0 && !f.todos.includes(item.todo || '')) return false;
    if (f.categories.length > 0 && !f.categories.includes(item.category || '')) return false;
    return true;
  });
}

/**
 * What the filter chips can offer: every tag, TODO state and category in `items`, with how many items carry each.
 * @param {any[]} items
 * @returns {{ tags: [string, number][], todos: [string, number][], categories: [string, number][] }}
 */
export function viewFilterChoices(items) {
  /** @type {Map<string, number>} */ const tags = new Map();
  /** @type {Map<string, number>} */ const todos = new Map();
  /** @type {Map<string, number>} */ const categories = new Map();
  const bump = (/** @type {Map<string, number>} */ map, /** @type {string} */ key) => map.set(key, (map.get(key) || 0) + 1);
  for (const item of items) {
    if (!item.heading) continue;
    for (const t of item.filterTags || item.tags || []) bump(tags, t);
    if (item.todo) bump(todos, item.todo);
    if (item.category) bump(categories, item.category);
  }
  const sorted = (/** @type {Map<string, number>} */ map) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { tags: sorted(tags), todos: sorted(todos), categories: sorted(categories) };
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
