// @ts-check
// Emacs's own agenda variables, read as the starting point of the Agenda's and TODO view's session settings:
// org-agenda-sorting-strategy (the effort-up / effort-down keys), org-agenda-max-effort, and the four filter presets
// (org-agenda-tag-filter-preset, -category-, -regexp-, -effort-). Pure functions on the raw variable text.
import { parseLispTagList } from './tag-inheritance.js';
import { parseOrgDuration } from './org-duration.js';
import { emptyViewFilter } from './agenda-filter.js';

/** @typedef {import('./agenda-filter.js').ViewFilter} ViewFilter */

/**
 * The effort key of one view's entry in org-agenda-sorting-strategy, e.g. `((agenda habit-down effort-up) (todo priority-down))`.
 * The other keys are not read: the app orders rows its own way.
 * @param {string | null | undefined} raw
 * @param {'agenda' | 'todo'} type
 * @returns {'up' | 'down' | null}
 */
export function sortingStrategyEffort(raw, type) {
  if (!raw) return null;
  const group = new RegExp(`\\(\\s*${type}\\b([^()]*)\\)`).exec(String(raw));
  if (!group) return null;
  for (const word of group[1].trim().split(/\s+/)) {
    if (word === 'effort-up') return 'up';
    if (word === 'effort-down') return 'down';
  }
  return null;
}

/**
 * org-agenda-max-effort: nil, a number of minutes, or an alist of view types with minutes (`((agenda . 240) (todo . 120))`).
 * @param {string | null | undefined} raw
 * @param {'agenda' | 'todo'} type
 * @returns {number | null}
 */
export function maxEffortMinutes(raw, type) {
  const text = String(raw ?? '').trim().replace(/^'/, '');
  if (/^\d+$/.test(text)) return Number(text);
  const entry = new RegExp(`\\(\\s*${type}\\s*\\.\\s*(\\d+)\\s*\\)`).exec(text);
  return entry ? Number(entry[1]) : null;
}

/**
 * A filter preset: a list of strings, each a single value after a `+` or `-` (no sign counts as `+`).
 * @param {string | null | undefined} raw
 * @returns {{ include: string[], exclude: string[] }}
 */
export function parseFilterPreset(raw) {
  const out = { include: /** @type {string[]} */ ([]), exclude: /** @type {string[]} */ ([]) };
  for (const word of (raw ? parseLispTagList(String(raw).trim()) : null) || []) {
    if (word.startsWith('-')) out.exclude.push(word.slice(1));
    else out.include.push(word.replace(/^\+/, ''));
  }
  return out;
}

/**
 * org-agenda-effort-filter-preset: the first entry, such as `+<2:00`, as the ⏱ panel's filter.
 * @param {string | null | undefined} raw
 * @returns {{ op: string, minutes: number, text: string } | null}
 */
export function effortFilterPreset(raw) {
  const first = ((raw && parseLispTagList(String(raw).trim())) || [])[0];
  const m = first ? /^[+-]?([<>=])\s*(.+)$/.exec(first) : null;
  const minutes = m ? parseOrgDuration(m[2]) : null;
  return m && minutes !== null ? { op: m[1], minutes, text: m[2] } : null;
}

/**
 * The chips the presets start with. Several `+` tags must all be present, as in Emacs; the `+` regexps must all match.
 * @param {Record<string, string> | null | undefined} vars
 * @returns {ViewFilter}
 */
export function presetViewFilter(vars) {
  const v = vars || {};
  const filter = emptyViewFilter();
  const tags = parseFilterPreset(v['org-agenda-tag-filter-preset']);
  filter.tags = tags.include;
  filter.notTags = tags.exclude;
  filter.tagsAll = tags.include.length > 1;
  const cats = parseFilterPreset(v['org-agenda-category-filter-preset']);
  filter.categories = cats.include;
  filter.notCategories = cats.exclude;
  const regexps = parseFilterPreset(v['org-agenda-regexp-filter-preset']);
  filter.regexps = regexps.include;
  filter.notRegexps = regexps.exclude;
  return filter;
}
