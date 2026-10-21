// @ts-check
// The Agenda's and TODO view's session settings (filter chips, effort sort, filter and limit) start from Emacs's own variables:
// org-agenda-{tag,category,regexp,effort}-filter-preset, org-agenda-sorting-strategy and org-agenda-max-effort. They are read
// again only when one of those values changes (a different file, or an edit), so what you have chosen since stays.
import { parseSortingStrategy } from '../src/agenda-sort.js';
import { effortFilterPreset, maxEffortMinutes, presetViewFilter, sortingStrategyEffort } from '../src/agenda-variables.js';
import { S } from './app-state.js';

const KEYS = [
  'org-agenda-tag-filter-preset',
  'org-agenda-category-filter-preset',
  'org-agenda-regexp-filter-preset',
  'org-agenda-effort-filter-preset',
  'org-agenda-sorting-strategy',
  'org-agenda-max-effort',
];

/** @param {number} minutes */
function hoursMinutes(minutes) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

export function seedAgendaDefaults() {
  const vars = S.state.localVariables || {};
  const signature = JSON.stringify(KEYS.map((k) => vars[k] ?? null));
  if (S.agendaSeedSignature === signature) return;
  const firstTime = S.agendaSeedSignature === undefined;
  S.agendaSeedSignature = signature;
  if (firstTime && KEYS.every((k) => vars[k] === undefined)) return; // nothing set: leave the empty defaults alone
  S.viewFilter = presetViewFilter(vars);
  S.agendaEffortFilter = effortFilterPreset(vars['org-agenda-effort-filter-preset']);
  // The effort chip mirrors the strategy only when effort is its one real key; with others the strategy's own order is applied.
  const alone = (/** @type {'agenda' | 'todo'} */ view) => (parseSortingStrategy(vars['org-agenda-sorting-strategy'], view) || []).filter((k) => k !== 'category-keep').length === 1;
  S.agendaEffortSort = alone('agenda') ? sortingStrategyEffort(vars['org-agenda-sorting-strategy'], 'agenda') : null;
  const max = maxEffortMinutes(vars['org-agenda-max-effort'], 'agenda');
  S.agendaEffortMax = max === null ? null : { minutes: max, text: hoursMinutes(max) };
  const todoSort = alone('todo') ? sortingStrategyEffort(vars['org-agenda-sorting-strategy'], 'todo') : null;
  if (todoSort) S.taskSort = todoSort === 'up' ? 'effort-up' : 'effort-down';
}
