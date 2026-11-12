// @ts-check
// The *Org Agenda* text of a custom command: what Emacs puts in the buffer for a composite command (each block under its own heading,
// the blocks apart by a line of "="), for stuck projects, and for a command carrying settings of its own. A block's settings go over the
// global settings of its command, which go over the variables: org-agenda-overriding-header replaces the heading, org-agenda-files names
// other files, the filter presets hide rows, and an `agenda` block lists its days with the span, start day and the rest it reads.
import { buildAgendaItems, applyAgendaEffortView, itemsForDate } from './agenda.js';
import { applyViewFilter, viewFilterActive } from './agenda-filter.js';
import { agendaClockText, agendaPrefixFormat, formatAgendaPrefix } from './agenda-prefix.js';
import { effortFilterPreset, presetViewFilter, maxEffortMinutes } from './agenda-variables.js';
import { agendaLisp, prefixEvaluator } from './agenda-lisp.js';
import { sortAgendaItems, strategyFor } from './agenda-sort.js';
import { agendaSkipper } from './agenda-skip.js';
import { readDaySettings } from './agenda-emacs-days.js';
import { readLogSettings } from './agenda-log.js';
import { readAgendaSpan, readAgendaStartDay, readStartOnWeekday, spanName, spanRange } from './agenda-span.js';
import { getAgendaShowAllDates, getAgendaSkipArchivedTrees, getAgendaSkipCommentTrees, getAgendaUseTagInheritance, getDeadlineWarningDays, getHabitOptions, getScheduledDelayDays, getShowInheritedTagsAgenda, getUseTagInheritance } from './local-variables.js';
import { buildAncestorIndex, buildFileTagsIndex, inheritedOnly, knowsInheritedTags, showsInheritedTags } from './tag-inheritance.js';
import { commandItems, headerOverride, layeredVariables } from './agenda-commands.js';

/** @typedef {import('./agenda-commands.js').CustomCommand} CustomCommand */
/** @typedef {{ documentId: string, doc: import('./types.js').Doc }[]} Docs */
/** @typedef {{ todoKeywords: string[], doneKeywords: string[] }} Keywords */

export const BLOCK_SEPARATOR = '='.repeat(79);

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The ISO week number. @param {Date} date */
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}

/** Emacs's day heading: "Monday     15 March 2027", and " W11" on a Monday. @param {Date} day */
export function dayHeading(day) {
  const week = day.getDay() === 1 ? ` W${String(isoWeek(day)).padStart(2, '0')}` : '';
  return `${DAY_NAMES[day.getDay()].padEnd(10)} ${String(day.getDate()).padStart(2)} ${MONTH_NAMES[day.getMonth()]} ${day.getFullYear()}${week}`;
}

/** The leader Emacs puts before a scheduled or deadline row (org-agenda-scheduled-leaders, org-agenda-deadline-leaders). @param {import('./agenda.js').AgendaItem} item */
function leader(item) {
  if (item.logLabel) return item.logLabel;
  const n = item.daysOverdue ?? 0;
  if (item.kind === 'scheduled') return n > 0 ? `Sched.${String(n).padStart(2)}x: ` : 'Scheduled: ';
  if (item.kind === 'deadline') return n < 0 ? `In ${String(-n).padStart(3)} d.: ` : n > 0 ? `${String(n).padStart(2)} d. ago: ` : 'Deadline:  ';
  return '';
}

/**
 * The default format of a view, or the one org-agenda-prefix-format gives it.
 * @param {Record<string, string>} vars @param {'agenda' | 'todo' | 'tags' | 'search'} view
 */
function prefixFormatOf(vars, view) {
  return agendaPrefixFormat((vars['org-agenda-prefix-format'] || '').replace(/^'/, ''), view) ?? (view === 'agenda' ? '  %-12:c%?-12t% s' : view === 'todo' ? '  %-12:c' : '  %-12:c');
}

/** @typedef {'agenda' | 'todo' | 'tags' | 'search'} View */

/** @typedef {{ ancestors: WeakMap<import('./types.js').Heading, import('./types.js').Heading[]>, fileTags: WeakMap<import('./types.js').Heading, string[]> }} TagContext */
/** @type {WeakMap<object, TagContext>} */
const tagContexts = new WeakMap();
/** The ancestors and file tags of the headings of these documents, worked out once per list. @param {Docs} docs */
function tagContext(docs) {
  const known = tagContexts.get(docs);
  if (known) return known;
  const list = docs.map((d) => d.doc);
  /** @type {TagContext} */ const ctx = { ancestors: buildAncestorIndex(list), fileTags: buildFileTagsIndex(list) };
  tagContexts.set(docs, ctx);
  return ctx;
}

/** The tags a heading inherits (none when inheritance is off). @param {import('./types.js').Heading} heading @param {Record<string, string>} vars @param {Docs} docs */
function inheritedTags(heading, vars, docs) {
  const { ancestors, fileTags } = tagContext(docs);
  const chain = ancestors.get(heading);
  return chain ? inheritedOnly(heading, chain, getUseTagInheritance(vars), fileTags.get(chain[0] || heading) || []) : [];
}

/** The agenda view whose tag settings a view follows. @param {View} view @returns {'agenda' | 'todo' | 'search'} */
const tagView = (view) => (view === 'agenda' || view === 'search' ? view : 'todo');

/**
 * The headline of a row as Emacs's agenda shows it: keyword, priority, title and the tags after one space; the tags the heading inherits
 * come first and are followed by "::" ahead of its own (":work::home:"), as org-agenda-show-inherited-tags has them.
 * @param {import('./agenda.js').AgendaItem} item @param {Record<string, string>} vars @param {Docs} docs @param {View} view
 */
function headlineText(item, vars, docs, view) {
  const own = item.tags || [];
  const inherited = item.heading && showsInheritedTags(tagView(view), getShowInheritedTagsAgenda(vars), getAgendaUseTagInheritance(vars)) ? inheritedTags(item.heading, vars, docs).filter((t) => !own.includes(t)) : [];
  const tags = inherited.length ? `:${inherited.join(':')}:${own.length ? `:${own.join(':')}:` : ':'}` : own.length ? `:${own.join(':')}:` : '';
  return [item.todo, item.priority ? `[#${item.priority}]` : '', item.title.replace(/\s*<\d{4}-\d\d-\d\d[^>]*>/g, '')].filter(Boolean).join(' ') + (tags ? ` ${tags}` : '');
}

/**
 * One row: the prefix (category, time, leader) and the headline.
 * @param {import('./agenda.js').AgendaItem} item @param {Record<string, string>} vars @param {View} view
 * @param {Docs} docs @param {Keywords} keywords
 */
function rowText(item, vars, view, docs, keywords) {
  const format = prefixFormatOf(vars, view);
  const time = view === 'agenda' && item.hasTime ? agendaClockText(item.date, item.endDate ?? null) : '';
  const scheduling = view === 'agenda' ? leader(item) : '';
  const effort = item.heading ? (item.heading.properties?.Effort ?? '') : '';
  const fields = { category: item.category ?? '', time, scheduling, effort, level: ' ', breadcrumbs: '' };
  const evaluate = format.includes('%(') ? prefixEvaluator(item, docs, { category: fields.category, time, extra: scheduling, level: fields.level, effort, tag: (item.tags || []).join(':'), breadcrumbs: '', 'category-icon': '' }, keywords) : undefined;
  return formatAgendaPrefix(format, fields, evaluate) + headlineText(item, vars, docs, view);
}

/**
 * The rows the filter presets leave: org-agenda-{tag,category,regexp,effort}-filter-preset (a tag sees the inherited tags too).
 * @param {(import('./agenda.js').AgendaItem & { filterTags?: string[] })[]} items @param {Record<string, string>} vars @param {Docs} docs @param {View} view
 */
export function applyPresets(items, vars, docs, view) {
  const filter = presetViewFilter(vars);
  let rows = items;
  if (viewFilterActive(filter)) {
    const inherits = knowsInheritedTags(tagView(view), getShowInheritedTagsAgenda(vars), getAgendaUseTagInheritance(vars));
    for (const item of rows) if (item.heading) item.filterTags = [...(item.heading.tags || []), ...(inherits ? inheritedTags(item.heading, vars, docs) : [])];
    rows = applyViewFilter(rows, filter);
  }
  const effort = effortFilterPreset(vars['org-agenda-effort-filter-preset']);
  return effort && view !== 'agenda' ? applyAgendaEffortView(rows, { filter: effort }) : rows;
}

/** The effort preset (org-agenda-effort-filter-preset) and org-agenda-max-effort as the effort view of an Agenda. @param {Record<string, string>} vars */
function effortView(vars) {
  const filter = effortFilterPreset(vars['org-agenda-effort-filter-preset']);
  const max = maxEffortMinutes(vars['org-agenda-max-effort'], 'agenda');
  return filter || max !== null ? { filter, maxMinutes: max } : null;
}

/** The heading of an agenda: "Week-agenda (W41-W42):". @param {import('./agenda-span.js').AgendaSpan} span @param {{ start: Date, end: Date }} range */
function agendaHeading(span, range) {
  const kind = typeof span === 'string' ? span : '';
  if (kind === 'year') return 'Year-agenda:';
  const a = isoWeek(range.start);
  const b = isoWeek(range.end);
  const weeks = a === b ? `W${String(a).padStart(2, '0')}` : `W${String(a).padStart(2, '0')}-W${String(b).padStart(2, '0')}`;
  return `${spanName(span)}-agenda (${weeks}):`;
}

/**
 * The lines of an `agenda` block: the heading, then each day with its rows.
 * @param {Record<string, string>} vars @param {Record<string, string>} presets  the variables the filter presets are read from @param {Docs} docs @param {Keywords} keywords @param {Date} now
 */
function agendaLines(vars, presets, docs, keywords, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDay = readAgendaStartDay(vars, now) ?? today;
  const span = readAgendaSpan(vars);
  const range = spanRange(span, startDay, readStartOnWeekday(vars));
  const first = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate());
  const last = new Date(first.getFullYear(), first.getMonth(), first.getDate() + range.ndays - 1, 23, 59);
  const logSettings = readLogSettings(vars);
  const items = buildAgendaItems(docs, {
    habits: { enabled: vars['org-habit-show-habits'] !== 'nil', ...getHabitOptions(vars) },
    today: now,
    rangeStart: first,
    rangeEnd: last,
    isDone: (/** @type {string} */ todo) => keywords.doneKeywords.includes(todo),
    daySettings: readDaySettings(vars),
    skipEntry: agendaSkipper(vars, docs, keywords),
    logSettings,
    includeCommented: !getAgendaSkipCommentTrees(vars),
    includeArchived: !getAgendaSkipArchivedTrees(vars),
    deadlineWarningDays: getDeadlineWarningDays(vars),
    scheduledDelayDays: getScheduledDelayDays(vars),
  });
  const keys = strategyFor(vars['org-agenda-sorting-strategy'], 'agenda') ?? [];
  const effort = effortView(presets);
  const showAll = getAgendaShowAllDates(vars);
  const lisp = agendaLisp(vars, docs, keywords);
  const filtered = applyPresets(items, presets, docs, 'agenda');
  const override = headerOverride(vars);
  /** @type {string[]} */ const lines = [];
  const heading = override ?? agendaHeading(span, { start: first, end: new Date(first.getFullYear(), first.getMonth(), first.getDate() + range.ndays - 1) });
  if (heading !== '') lines.push(heading);
  for (let i = 0; i < range.ndays; i++) {
    const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
    let rows = sortAgendaItems(itemsForDate(filtered, day), keys, { documentOrder: docs.map((d) => d.documentId), ...keywords, localVariables: vars, lisp });
    if (effort) rows = applyAgendaEffortView(rows, effort);
    if (!showAll && rows.length === 0) continue;
    lines.push(dayHeading(day));
    for (const item of rows) lines.push(rowText(item, vars, 'agenda', docs, keywords));
  }
  return lines;
}

/** The heading Emacs gives a block of this type. @param {CustomCommand} block */
function headingOf(block) {
  if (block.type === 'tags' || block.type === 'tags-todo') return `Headlines with TAGS match: ${block.query}`;
  if (block.type === 'search') return `Search words: ${block.query}`;
  if (block.type === 'todo') return `Global list of TODO items of type: ${block.query || 'ALL'}`;
  if (block.type === 'alltodo') return 'Global list of TODO items of type: ALL';
  if (block.type === 'stuck') return 'List of stuck projects: ';
  return '';
}

/** The "Press ..." line Emacs puts under the heading of a single command, how to search again; empty for a command without one. @param {CustomCommand} block @param {string[]} keywords  every TODO keyword, in the order the files declare them */
function hintOf(block, keywords) {
  if (block.type === 'tags' || block.type === 'tags-todo') return "Press `C-u r' to search again";
  if (block.type === 'search') return "Press `[', `]' to add/sub word, `{', `}' to add/sub regexp, `C-u r' for a fresh search";
  if (block.type === 'todo' || block.type === 'alltodo') return `Press \`N r' (e.g. \`0 r') to search again: (0)[ALL] ${[...keywords].reverse().map((k, i) => `(${i + 1})${k}`).join(' ')}`;
  return '';
}

/** @typedef {{ agenda: true, vars: Record<string, string>, presets: Record<string, string>, docs: Docs, keywords: Keywords }} AgendaPlan */
/** @typedef {{ agenda: false, heading: string, hint: string, view: Exclude<View, 'agenda'>, items: import('./agenda.js').AgendaItem[], vars: Record<string, string>, docs: Docs, keywords: Keywords }} RowsPlan */

/**
 * What one block of a command shows: for an `agenda` block the settings it runs under; for the others the heading, the hint under it
 * (a single command only), and the rows the filter presets leave. Both the *Org Agenda* text and the live screen are made from this.
 * @param {CustomCommand} block @param {Record<string, string>} inherited  the settings of the composite command around it
 * @param {boolean} single  the command is not a composite one: its own settings hold the filter presets
 * @param {{ docs: Docs, searchDocs: Docs, options: import('./agenda-queries.js').QueryOptions & { now?: Date }, filesDocs?: (names: string) => Docs | null }} ctx
 * @returns {AgendaPlan | RowsPlan}
 */
export function blockPlan(block, inherited, single, ctx) {
  const options = ctx.options;
  const vars = layeredVariables(options.localVariables, inherited, block.settings);
  const named = layeredVariables(undefined, inherited, block.settings)['org-agenda-files']; // from the command, not from the document's own settings
  const files = named !== undefined && ctx.filesDocs ? ctx.filesDocs(named) : null;
  const docs = files ?? ctx.docs;
  const searchDocs = files ?? ctx.searchDocs;
  const keywords = { todoKeywords: options.todoKeywords || [], doneKeywords: options.doneKeywords || [] };
  // Emacs applies the presets when the buffer is done, under the settings of the whole command: a block's own are no longer set
  const presets = single ? vars : layeredVariables(options.localVariables, inherited, undefined);
  if (block.type === 'agenda') return { agenda: true, vars, presets, docs, keywords };
  const override = headerOverride(vars);
  const view = /** @type {Exclude<View, 'agenda'>} */ (block.type === 'search' ? 'search' : block.type === 'todo' || block.type === 'alltodo' ? 'todo' : 'tags');
  const items = applyPresets(commandItems(block, docs, searchDocs, options, inherited), presets, docs, view);
  return { agenda: false, heading: override ?? headingOf(block), hint: single && override === null ? hintOf(block, [...keywords.todoKeywords, ...keywords.doneKeywords]) : '', view, items, vars, docs, keywords };
}

/** The lines of one block of a command: see blockPlan. @param {Parameters<typeof blockPlan>} args */
function blockLines(...args) {
  const plan = blockPlan(...args);
  if (plan.agenda) return agendaLines(plan.vars, plan.presets, plan.docs, plan.keywords, args[3].options.now ?? new Date());
  return [...(plan.heading !== '' ? [plan.heading] : []), ...plan.items.map((item) => rowText(item, plan.vars, plan.view, plan.docs, plan.keywords))];
}

/**
 * The text of the *Org Agenda* buffer for a command: the heading of each block, its rows, and a line of "=" between blocks.
 * @param {CustomCommand} command
 * @param {{ docs: Docs, searchDocs: Docs, options: import('./agenda-queries.js').QueryOptions & { now?: Date }, filesDocs?: (names: string) => Docs | null }} ctx
 * @returns {string}
 */
export function commandBufferText(command, ctx) {
  const blocks = command.type === 'block' ? command.blocks || [] : [command];
  const inherited = command.type === 'block' ? command.settings || {} : {};
  const lines = blocks.map((block) => blockLines(block, inherited, command.type !== 'block', ctx));
  return lines.map((l) => l.join('\n')).join('\n\n' + BLOCK_SEPARATOR + '\n') + '\n';
}
