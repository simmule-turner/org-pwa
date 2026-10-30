// @ts-check
/**
 * One entry of the agenda: a dated heading line, or a calendar line with no heading behind it (sunrise, anniversaries).
 * @typedef {{
 *   documentId: string, heading?: Heading, kind?: string, hasTime?: boolean, endDate?: Date | null, rangeDay?: number | null,
 *   rangeDays?: number | null, inactive?: boolean, scheduledAge?: number, emacsOrder?: number, tsDate?: number | null, repeater?: string | null, todo?: string | null, priority?: string | null, tags?: string[],
 *   title: string, date: Date, daysOverdue?: number, habit?: any, age?: number | null, field?: string, spouse?: string | null,
 *   weather?: boolean, samePriority?: boolean, category?: string, logNote?: string | null, clockStart?: Date | null, clockEnd?: Date | null, clockIssue?: string | null, logType?: 'closed' | 'clock' | 'state', logLabel?: string, fixedPriority?: number, timeOfDay?: number | null, diaryAt?: { file: number, startLine: number, endLine: number, lineText: string } | null,
 * }} AgendaItem
 * @typedef {{
 *   includeArchived?: boolean, includeCommented?: boolean, includeLogbook?: boolean, logSettings?: import('./agenda-log.js').LogSettings | null, skipEntry?: ((kind: string, documentId: string, heading: Heading) => boolean) | null, todoKeywords?: string[], todoFilter?: ((todo: string) => boolean) | null,
 *   tagFilter?: ((tags: string[]) => boolean) | null, rangeStart?: Date | null, rangeEnd?: Date | null, isDone?: ((todo: string) => boolean) | null,
 *   today?: Date, birthdayProperty?: string, contactsDocs?: { documentId: string, doc: Doc }[] | null, deadlineWarningDays?: number,
 *   scheduledDelayDays?: number, calendarLatitude?: number, calendarLongitude?: number, calendarLocationName?: string | null, calendarDateStyle?: string, diaryHebrewSabbathCandlesMinutes?: number, calendarTimeDisplayForm?: string,
 *   weatherData?: Record<string, any> | null, orgWeatherFormat?: string, orgWeatherTemperatureUnit?: string, orgWeatherSpeedUnit?: string,
 *   habits?: { enabled: boolean, onlyForToday: boolean, showAllToday: boolean, precedingDays: number, followingDays: number, doneAlwaysGreen?: boolean, scheduledPastDays?: number | null } | null,
 *   diary?: import('./agenda-diary.js').DiarySource | null, keywords?: string | null, daySettings?: import('./agenda-emacs-days.js').DaySettings | null, todoListSettings?: import('./agenda-todo-list.js').TodoListSettings | null,
 * }} AgendaOptions
 */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */

/**
 * Agenda view: aggregates SCHEDULED/DEADLINE items across a set of open
 * documents (§10 of the requirements — multi-file was decided as a v1
 * requirement specifically so this would be useful for more than one
 * file). Pure functions over already-parsed ASTs; this module doesn't
 * open files or know about storage — callers hand it the output of
 * document-store.js's openAllDocuments().
 *
 * "Today's agenda" here means "compute from whatever `docs` you're given,
 * right now" — this module has no timers or background refresh of its
 * own. That's deliberate: the requirements explicitly ruled out relying on
 * a background process, so refresh is the caller's job (on app open, on
 * visibility change, on manual pull-to-refresh), not this module's.
 */

import { ignoredForDates, readTodoListSettings } from './agenda-todo-list.js';
import { defaultDaySettings, dayNumberOf, dateOfDay, planningOnDay, timestampOnDay, blockTimeOnDay, headlineTime } from './agenda-emacs-days.js';
import { isArchived } from './archive-model.js';
import { parseOrgDuration } from './org-duration.js';
import { isCommentedHeading } from './comment-model.js';
import { parseOrgTimestamp, findTimestamps, dateKey, isSameDay } from './org-timestamp.js';
import { allLogLines } from './logbook.js';
import { logRows, readLogSettings } from './agenda-log.js';
import { resolveTodoSequence } from './todo-cycle.js';
import { habitSpec, buildHabitGraph } from './habit.js';
import { canonicalDiaryLine, findSexpTimestamps, evaluateSexpWithError, parseGeneralBodyLine, isTruthy } from './sexp-eval.js';
import {
  parseOrgAnniversaryLine,
  expandOrgAnniversaryOccurrences,
  formatOrgAnniversaryTitle,
  parseOrgCyclicLine,
  expandOrgCyclicOccurrences,
  parseOrgBlockLine,
  expandOrgBlockOccurrences,
  parseDiaryFloatLine,
  expandDiaryFloatOccurrences,
  enumerateDays,
  unquoteDiaryFloatMonthList,
} from './diary-sexp.js';
import { isOrgWeatherLine, formatWeatherLine, DEFAULT_ORG_WEATHER_FORMAT } from './org-weather.js';
import { buildDiaryItems } from './agenda-diary.js';

const UNSAVED_DOCUMENT_ID = '\u0000unsaved-new-document';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const REPEATER_RE = /^([.+]{1,2})(\d+)([hdwmy])(?:\/(\d+)([hdwmy]))?$/;

/** Parses a repeater string (e.g. "+1w", "++3d", ".+1m", or org-habit's ".+2d/4d") into
 *  { mark, amount, unit, range }, where `range` is the "/4d" part ({ amount, unit }) or null. `mark` is kept but not currently acted on —
 *  see expandRepeats' docs for why all three marks expand the same way
 * @param {string} raw
 *  here. Returns null for anything that doesn't match. */
function parseRepeater(raw) {
  if (!raw) return null;
  const m = REPEATER_RE.exec(raw);
  if (!m) return null;
  return { mark: m[1], amount: Number(m[2]), unit: m[3], range: m[4] ? { amount: Number(m[4]), unit: m[5] } : null };
}

/**
 * @param {Date} date
 * @param {number} amount
 * @param {string} unit
 */
function addInterval(date, amount, unit) {
  const d = new Date(date.getTime());
  if (unit === 'h') d.setHours(d.getHours() + amount);
  else if (unit === 'd') d.setDate(d.getDate() + amount);
  else if (unit === 'w') d.setDate(d.getDate() + amount * 7);
  else if (unit === 'm') d.setMonth(d.getMonth() + amount);
  else if (unit === 'y') d.setFullYear(d.getFullYear() + amount);
  return d;
}

/**
 * Expands a repeating timestamp into every occurrence that falls within
 * [rangeStart, rangeEnd] (inclusive) — this is the actual "future
 * occurrences" support that org-timestamp.js explicitly deferred to here.
 *
 * All three repeater marks (`+`, `++`, `.+`) expand identically: this
 * module has no notion of "when was this marked done" (that's a stateful,
 * interactive org-mode concept tied to editing a TODO, not something a
 * read-only agenda display needs), so the distinction between "standard"
 * (+), "catch-up" (++), and "restart from completion" (.+) repeaters
 * doesn't change how they're displayed — all three just recur at the
 * stated interval from their base date.
 *
 * For day/week/hour units, this skips ahead mathematically to get close
 * to `rangeStart` rather than iterating one interval at a time — without
 * that, a daily repeater whose base date is years in the past would
 * require thousands of iterations to reach a "this week" agenda range.
 * Month/year units iterate directly (bounded to a small, reasonable
 * count even over decades, since calendar month/year lengths vary and
 * aren't worth the extra complexity of an approximate skip-ahead).
 * @param {Date} baseDate
 * @param {{ amount: number, unit: string } | null} repeater
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 */
function expandRepeats(baseDate, repeater, rangeStart, rangeEnd) {
  if (!repeater || !repeater.amount || repeater.amount <= 0) return [];
  const { amount, unit } = repeater;

  let current = new Date(baseDate.getTime());

  if ((unit === 'h' || unit === 'd' || unit === 'w') && current < rangeStart) {
    const msPerInterval = (unit === 'h' ? 60 * 60 * 1000 : unit === 'd' ? MS_PER_DAY : MS_PER_DAY * 7) * amount;
    const intervalsToSkip = Math.floor((rangeStart.getTime() - current.getTime()) / msPerInterval);
    if (intervalsToSkip > 0) current = addInterval(current, amount * intervalsToSkip, unit);
  }

  const occurrences = [];
  const MAX_ITERATIONS = 10000; // safety valve against a pathological repeater/range combination
  let iterations = 0;
  while (current <= rangeEnd && iterations < MAX_ITERATIONS) {
    if (current >= rangeStart) occurrences.push(new Date(current.getTime()));
    iterations++;
    // Months and years count from the original date, not from the previous occurrence, as the Emacs agenda does: a
    // monthly repeat from the 31st keeps asking for a 31st (a month without one spills into the next).
    current = unit === 'm' || unit === 'y' ? addInterval(baseDate, amount * iterations, unit) : addInterval(current, amount, unit);
  }
  return occurrences;
}

/** Converts a parsed delay ({amount, unit}) to an approximate day count,
 *  for the early-warning window calculation. Exact for h/d/w; m/y use a
 *  30/365-day approximation, an acceptable simplification since a delay
 *  is inherently a short-term "warn me ahead of time" concept in
 *  practice (a few days or weeks), not something that needs
 *  calendar-precise month lengths the way a repeater's actual occurrence
 * @param {any} [delay]
 *  dates do. */
function delayToDays(delay) {
  if (!delay) return 0;
  switch (delay.unit) {
    case 'h':
      return delay.amount / 24;
    case 'd':
      return delay.amount;
    case 'w':
      return delay.amount * 7;
    case 'm':
      return delay.amount * 30;
    case 'y':
      return delay.amount * 365;
    default:
      return 0;
  }
}

/**
 * Where a SCHEDULED or DEADLINE that does not repeat shows in the agenda, as the Emacs agenda does it:
 *   - on its own date (a SCHEDULED with a delay does not show there: it is "still scheduled on that day but will
 *     appear N days later"),
 *   - and on today, once, when it is overdue (`daysOverdue` > 0: "3 days overdue"), when a delayed SCHEDULED's delay
 *     has passed, or when a DEADLINE is inside its warning period (`daysOverdue` < 0: "due in 3 days").
 * Never on the other days between: Emacs lists an overdue or upcoming item only on today. Each date is kept to
 * [rangeStart, rangeEnd].
 * @param {string} kind
 * @param {Date} itemDate
 * @param {Date} today
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 */
function emacsAgendaOccurrences(kind, itemDate, today, rangeStart, rangeEnd, warningDays = 0, scheduledDelayDays = 0) {
  const itemDay = startOfDay(itemDate);
  const todayDay = startOfDay(today);
  const first = startOfDay(rangeStart);
  const last = startOfDay(rangeEnd);
  /** @param {any} [day] */
  const at = (day) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), itemDate.getHours(), itemDate.getMinutes());
  /**
   * @param {any} [a]
   * @param {any} [b]
   */
  const dayDiff = (a, b) => Math.round((a - b) / MS_PER_DAY);
  const out = [];
  const ownDateShows = !(kind === 'scheduled' && scheduledDelayDays > 0);
  if (ownDateShows && itemDay >= first && itemDay <= last) out.push({ date: at(itemDay), daysOverdue: 0 });
  if (todayDay >= first && todayDay <= last && itemDay.getTime() !== todayDay.getTime()) {
    const diff = dayDiff(todayDay, itemDay); // > 0: overdue
    const carried = kind === 'scheduled' ? diff > 0 && diff >= scheduledDelayDays : diff > 0 || -diff <= warningDays;
    if (carried) out.push({ date: at(todayDay), daysOverdue: diff });
  }
  return out;
}

// ---- org-contacts-anniversaries (property-based birthdays/anniversaries) ----

// A heading's birthday/anniversary date+description lives in a single
// property (key configurable via org-contacts-birthday-property, see
// local-variables.js — default "EVENT"), not duplicated into a separate
// sexp line too: :EVENT: 1990-05-15 Birthday. The trigger line
// %%(org-contacts-anniversaries), placed anywhere in the document(s)
// being searched, activates a scan of every heading for that property —
// its own position doesn't matter beyond "present somewhere"; it isn't
// itself an event, just a switch. Matches real org-contacts' actual
// mechanism (org-contacts-anniversaries loops through every heading
// carrying the configured property, confirmed directly against the
// org-contacts.el source — "Default FIELD value is BIRTHDAY", scanning
// every heading with that property) rather than the standalone
// %%(org-anniversary YEAR MONTH DAY) sexp this replaces, which required
// writing the date twice — once in a property, once again as literal
// text in a sexp line — for anyone who also wanted it recorded as a
// property for other purposes. Deliberately does NOT reproduce real
// org-contacts' own additional requirement of an :EMAIL: property to
// count as a "valid contact" — that wasn't part of what was asked for,
// and adding it back would silently exclude anyone whose birthday is
// tracked without an email on file.
const CONTACTS_TRIGGER_RE = /^%%\(org-contacts-anniversaries((?:\s+(?:nil|"(?:[^"\\]|\\.)*"))*)\s*\)\s*$/;
const EVENT_PROPERTY_RE = /^(\d{4}|nil)-(\d{2})-(\d{2})(?:\s+(.+))?$/;

/** The trigger as { field, format }, or null if `line` is not one. Real org-contacts takes two optional arguments,
 *  %%(org-contacts-anniversaries FIELD FORMAT): the property to read (default the birthday property) and how each entry reads
 *  (default "Birthday: %l (%Y)"). Each is a double-quoted string, or nil for "the default"; the line may carry none, one or both.
 * @param {string} line
 *  Each distinct trigger is its own scan, so one line for birthdays and another with "ANNIVERSARY" give both. */
function parseContactsAnniversariesTrigger(line) {
  const m = CONTACTS_TRIGGER_RE.exec(line.trim());
  if (!m) return null;
  const args = [...m[1].matchAll(/\s+(nil|"((?:[^"\\]|\\.)*)")/g)].map((a) => (a[1] === 'nil' ? null : a[2].replace(/\\(.)/g, '$1')));
  if (args.length > 2) return null;
  return { field: args[0] || null, format: args[1] || null };
}

/** True if `line` is a %%(org-contacts-anniversaries ...) trigger, activating a scan. The line's own content is
 * @param {string} line
 *  not itself read as an event — it's a switch, not a contact. */
function isContactsAnniversariesTrigger(line) {
  return parseContactsAnniversariesTrigger(line) !== null;
}

/**
 * Every distinct trigger across `docs` (the same line twice is one scan, so nothing shows twice).
 * @param {{ documentId: string, doc: Doc }[]} docs
 */
function collectContactsTriggers(docs) {
  const found = new Map();
  /** @param {string} line */
  const note = (line) => {
    const trigger = parseContactsAnniversariesTrigger(line);
    if (trigger) found.set(`${trigger.field || ''}\u0000${trigger.format || ''}`, trigger);
  };
  for (const { doc } of docs) {
    for (const line of doc.bodyLines || []) note(line); // a trigger above the first heading belongs to the document itself
    walkHeadings(doc, (/** @type {any} */ heading) => {
      for (const line of heading.bodyLines || []) note(line);
    });
  }
  return [...found.values()];
}

/** Parses a birthday/anniversary property value: "YYYY-MM-DD
 *  description text", or "nil-MM-DD description text" when the year is
 *  genuinely unknown (age then can't be computed — see
 *  contactEventAge below). The description is optional -- a bare
 *  "YYYY-MM-DD" with nothing after it is also accepted, description
 *  null in that case (the caller supplies a sensible default; see
 *  buildAgendaItems' own contacts-anniversaries block below). This
 *  matters in practice: vCard import writes exactly this bare form
 *  into :BIRTHDAY: (the same property this reads by default), and an
 *  earlier version of this function rejected it outright, confirmed
 *  directly to mean a vCard-imported contact's own birthday matched
 *  zero agenda items no matter what range was searched. Returns
 *  { year, month, day, description } or null only for a genuinely
 * @param {string} value
 *  malformed value now: an out-of-range month/day, or no date at all. */
function parseContactEvent(value) {
  const m = EVENT_PROPERTY_RE.exec(String(value).trim());
  if (!m) return null;
  const year = m[1] === 'nil' ? null : Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day, description: m[4] ? m[4].trim() : null };
}

/** Elapsed years as of `occurrenceDate` for an event whose stored year
 *  is `year`. null when `year` is null (unknown) — formatted as "(??)"
 *  by formatContactEventLine below, per what was actually asked for,
 *  rather than a numeric sentinel a caller could accidentally display
 * @param {number | null} year
 * @param {Date} occurrenceDate
 *  as a real age. */
function contactEventAge(year, occurrenceDate) {
  if (year === null) return null;
  return occurrenceDate.getFullYear() - year;
}

/** The description used for a bare date (event.description null --
 *  see parseContactEvent's own doc comment): the configured property
 *  name itself, lower-cased then re-capitalized ("BIRTHDAY" ->
 *  "Birthday", "ANNIVERSARY" -> "Anniversary") -- a reasonable label
 *  derived from whatever org-contacts-birthday-property is actually
 *  set to, rather than a single hardcoded word that would be wrong
 * @param {any} [propertyName]
 *  for anyone using this for a different kind of event. */
function defaultEventDescription(propertyName) {
  const lower = String(propertyName).toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Case-insensitive property lookup, matching how every other
 *  property read in this file already handles case (org property
 * @param {Heading} heading
 * @param {string} key
 *  keys are conventionally upper-case, but not enforced). */
function getPropertyCaseInsensitive(heading, key) {
  /** @param {any} [k] */
  const foundKey = (heading.propertyOrder || []).find((k) => k.toLowerCase() === key.toLowerCase());
  return foundKey ? heading.properties[foundKey] : undefined;
}

/** The EFFORT property of an agenda item's heading, trimmed, or null
 *  (also null for an item with no heading behind it -- a sunrise line,
 * @param {AgendaItem | null | undefined} item
 *  an anniversary). */
function itemEffortText(item) {
  const raw = item && item.heading ? getPropertyCaseInsensitive(item.heading, 'EFFORT') : undefined;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/** That effort in minutes, or null when there is none or it isn't a
 * @param {AgendaItem | null | undefined} item
 *  valid org duration. */
function itemEffortMinutes(item) {
  const text = itemEffortText(item);
  return text === null ? null : parseOrgDuration(text);
}

// The kinds that are things to do or attend, as opposed to a logged past
// event, a diary line, or an astronomical time.
const EFFORT_PLANNING_KINDS = new Set(['scheduled', 'deadline', 'timestamp']);

/**
 * Planned effort for one day's agenda items, for a "how much have I taken
 * on today" total:
 *
 *   { minutes, estimated, unestimated }
 *
 * `minutes` sums the effort of every scheduled / deadline / timestamped
 * heading that has a valid one, counting each heading once per day even if
 * it appears twice (say, both SCHEDULED and DEADLINE that day). An item
 * carried forward from an earlier date counts on the day it is shown --
 * that's when the time is needed. `unestimated` counts only headings with
 * a TODO keyword and no usable estimate: an appointment without an effort
 * isn't a gap in the estimates, so it isn't counted as one.
 * @param {AgendaItem[]} items
 */
function summarizeDayEffort(items) {
  const seen = new Set();
  let minutes = 0;
  let estimated = 0;
  let unestimated = 0;
  for (const item of items) {
    if (!item.heading || !EFFORT_PLANNING_KINDS.has(/** @type {string} */ (item.kind))) continue;
    if (seen.has(item.heading)) continue;
    seen.add(item.heading);
    const effort = itemEffortMinutes(item);
    if (effort !== null) {
      minutes += effort;
      estimated++;
    } else if (item.todo) {
      unestimated++;
    }
  }
  return { minutes, estimated, unestimated };
}

// ---- sorting, filtering and limiting by effort ---------------------------------
//
// Real org's agenda offers all three: the `effort-up` / `effort-down` sorting
// strategies, the `_` filter (org-agenda-filter-by-effort) and
// org-agenda-max-effort. They follow org-agenda.el's own rules, including two
// that surprise people:
//   - the filter's < and > are INCLUSIVE (+<1:00 keeps a task of exactly 1:00);
//   - the limit keeps a PREFIX of the sorted day: once the running total passes
//     the maximum, everything after it is dropped, even a task small enough to
//     have fitted.
// An item with no effort counts as very high effort (org-agenda-sort-noeffort-
// is-high, default t): last when sorting up, excluded by < and =, kept by >,
// and -- since its "effort" is unbounded -- the end of the line for a limit.
// Items with no heading behind them (sunrise, anniversaries) are not tasks, so
// they are never filtered or counted.

/** Minutes for sorting/filtering/limiting an item: its effort, else the
 * @param {AgendaItem} item
 *  no-effort stand-in. */
function effortSortValue(item, noEffortIsHigh = true) {
  const minutes = itemEffortMinutes(item);
  if (minutes !== null) return minutes;
  return noEffortIsHigh ? Infinity : -1;
}

/**
 * A stably sorted copy: 'up' = least effort first, 'down' = most first.
 * @param {AgendaItem[]} items
 */
function sortItemsByEffort(items, direction = 'up', noEffortIsHigh = true) {
  const sign = direction === 'down' ? -1 : 1;
  return items
    .map((item, /** @type {number} */ index) => ({ item, index, value: effortSortValue(item, noEffortIsHigh) }))
    .sort((a, b) => (a.value === b.value ? a.index - b.index : sign * (a.value < b.value ? -1 : 1)))
    .map((entry) => entry.item);
}

/** Keeps items whose effort satisfies `{ op, minutes }` -- op '<' (at most),
 * @param {AgendaItem[]} items
 * @param {{ op: string, minutes: number | null } | null | undefined} filter
 *  '>' (at least) or '=' (exactly). Non-task items are always kept. */
function filterItemsByEffort(items, filter, noEffortIsHigh = true) {
  if (!filter) return items;
  const test = /** @type {Record<string, (v: number) => boolean>} */ ({ '<': (v) => v <= /** @type {number} */ (filter.minutes), '>': (v) => v >= /** @type {number} */ (filter.minutes), '=': (v) => v === filter.minutes })[filter.op];
  if (!test) return items;
  return items.filter((item) => !item.heading || test(effortSortValue(item, noEffortIsHigh)));
}

/** org-agenda-max-effort for one day's (already sorted) items: keeps items
 * @param {AgendaItem[]} items
 * @param {number | null | undefined} maxMinutes
 *  while the running total stays within `maxMinutes`. */
function limitItemsByEffort(items, maxMinutes, noEffortIsHigh = true) {
  if (maxMinutes === null || maxMinutes === undefined) return items;
  let running = 0;
  const kept = [];
  for (const item of items) {
    if (!item.heading) {
      kept.push(item);
      continue;
    }
    running += effortSortValue(item, noEffortIsHigh);
    if (running <= maxMinutes) kept.push(item);
  }
  return kept;
}

/** All three, in the order Emacs applies them: sort, then limit (both while
 *  the day's entries are assembled), then the filter (which only hides).
 * @param {any[]} items
 * @param {{ sort?: string | null, filter?: any, maxMinutes?: number | null, noEffortIsHigh?: boolean }} [view] */
function applyAgendaEffortView(items, { sort = null, filter = null, maxMinutes = null, noEffortIsHigh = true } = {}) {
  let result = items;
  if (sort) result = sortItemsByEffort(result, sort, noEffortIsHigh);
  result = limitItemsByEffort(result, maxMinutes, noEffortIsHigh);
  return filterItemsByEffort(result, filter, noEffortIsHigh);
}

/** Searches `heading`'s own descendants, at any depth (a tree-style vCard contact's own fields can sit directly under the contact
 *  or grouped under an intermediate heading first -- see export-vcard.js's buildVcardFromTreeContact for the same reasoning, and
 *  import-vcard.js's buildTreeOrgFromContact for what actually produces this shape), for one whose own :FIELDTYPE: is `fieldType`
 * @param {Heading} heading
 * @param {any} [fieldType]
 *  ("birthday", "anniversary", "spouse") -- returning its own title (the value, as tree style writes it) or null. */
function findTreeStyleFieldValue(heading, fieldType) {
  for (const child of heading.children || []) {
    if (child.type !== 'heading') continue;
    const type = getPropertyCaseInsensitive(child, 'FIELDTYPE');
    if (String(type || '').toLowerCase() === fieldType) return child.title;
    /** @type {any} */ const nested = findTreeStyleFieldValue(child, fieldType);
    if (nested) return nested;
  }
  return null;
}

/** The { year, month, day, description } `field` holds for this contact, or null: a property, or for a tree-style contact
 *  (:KIND: individual, the marker export-vcard.js requires) a descendant heading of that field type. Only a heading that is itself
 *  a tree-style contact is searched -- without that gate an intermediate grouping heading above a birthday descendant produced a
 * @param {Heading} heading
 * @param {string} field
 * @param {string} birthdayProperty
 *  spurious item of its own. */
function contactEventFor(heading, field, birthdayProperty) {
  const raw = getPropertyCaseInsensitive(heading, field);
  let event = raw ? parseContactEvent(raw) : null;
  if (!event && String(getPropertyCaseInsensitive(heading, 'KIND') || '').toLowerCase() === 'individual') {
    const fieldType = field.toLowerCase() === birthdayProperty.toLowerCase() ? 'birthday' : field.toLowerCase();
    const treeValue = findTreeStyleFieldValue(heading, fieldType);
    if (treeValue) event = parseContactEvent(treeValue);
  }
  return event;
}

/**
 * The spouse's name for a contact (a :SPOUSE: property, or a tree-style spouse field), or null.
 * @param {Heading} heading
 */
function contactSpouse(heading) {
  const prop = getPropertyCaseInsensitive(heading, 'SPOUSE');
  if (typeof prop === 'string' && prop.trim()) return prop.trim();
  if (String(getPropertyCaseInsensitive(heading, 'KIND') || '').toLowerCase() === 'individual') {
    const tree = findTreeStyleFieldValue(heading, 'spouse');
    if (tree && tree.trim()) return tree.trim();
  }
  return null;
}

/**
 * 1 -> "1st", 12 -> "12th", 22 -> "22nd": Emacs's diary-ordinal-suffix, for %Y.
 * @param {number} n
 */
function ordinalYears(n) {
  const tens = Math.abs(n) % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[Math.abs(n) % 10] || 'th'}`;
}

/** The text of one contact entry, the way org-contacts-anniversaries' FORMAT reads: %h heading name, %l the heading (a link in
 *  Emacs, its name here), %y years, %Y years as an ordinal ("36th"), %% a percent sign. Two more for the spouse, which Emacs has
 *  no spec for: %s the spouse's name (empty if none) and %n the name, with " & spouse" when there is one. Years unknown reads "??".
 *  With no FORMAT: "<Label>: %l (%Y)" for the birthday property (Emacs's own default, "Birthday: Jane Doe (36th)"), and
 *  "<Label>: %n (%Y)" for any other field ("Anniversary: Jane Doe & John Doe (27th)"). The label is the field name capitalized, or
 *  the text after the date in the property if there is some (":BIRTHDAY: 1990-01-08 Nameday"). */
function formatContactEventTitle(/** @type {any} */ { format = null, field = null, birthdayProperty = 'BIRTHDAY', description = /** @type {string | null} */ (null), name, spouse = null, age = /** @type {number | null} */ (null), omitAge = false }) {
  const fieldName = field || birthdayProperty;
  const label = description || defaultEventDescription(fieldName);
  const chosen = format || (fieldName.toLowerCase() === birthdayProperty.toLowerCase() ? `${label}: %l (%Y)` : `${label}: %n (%Y)`);
  const template = omitAge ? stripAgeFromFormat(chosen) : chosen; // omitAge: ONE event that repeats every year has no age to show
  return template.replace(/%([hlnsyY%])/g, (/** @type {any} */ match, /** @type {string} */ spec) => {
    switch (spec) {
      case 'h':
      case 'l':
        return name;
      case 'n':
        return spouse ? `${name} & ${spouse}` : name;
      case 's':
        return spouse || '';
      case 'y':
        return age === null ? '??' : String(age);
      case 'Y':
        return age === null ? '??' : ordinalYears(age);
      default:
        return '%';
    }
  });
}

/** `format` with its age removed -- for an entry that repeats every year as ONE event (a calendar export of a file), which cannot
 * @param {string} format
 *  carry an age: "Birthday: %l (%Y)" -> "Birthday: %l". */
function stripAgeFromFormat(format) {
  return format.replace(/\s*\(\s*%[yY]\s*\)/g, '').replace(/%[yY]/g, '').replace(/\s+$/, '');
}

/**
 * Every (month, day) occurrence within [rangeStart, rangeEnd], one per
 * calendar year the range spans — a birthday/anniversary recurs every
 * year regardless of its own stored YEAR, which only feeds the age
 * calculation above, not which years it appears in. Without a range,
 * returns just the single occurrence in `today`'s year, matching how
 * other agenda sources fall back to "the literal/current occurrence"
 * when no range was requested.
 *
 * A (month, day) that doesn't exist in a given year — February 29 in a
 * non-leap year — rolls over to March 1 via plain JS Date arithmetic
 * rather than being specially skipped; a known simplification, not a
 * faithful reproduction of Emacs calendar.el's own leap-year handling
 * for this edge case, stated rather than silently different.
 * @param {number} month
 * @param {number | undefined} day
 * @param {Date | null} rangeStart
 * @param {Date | null} rangeEnd
 * @param {Date} today
 */
function expandContactEventOccurrences(month, day, rangeStart, rangeEnd, today) {
  if (!rangeStart || !rangeEnd) {
    return [new Date(today.getFullYear(), month - 1, day)];
  }
  const rangeStartDay = startOfDay(rangeStart);
  const rangeEndDay = endOfDay(rangeEnd);
  const dates = [];
  for (let year = rangeStart.getFullYear(); year <= rangeEnd.getFullYear(); year++) {
    const occurrence = new Date(year, month - 1, day);
    if (occurrence >= rangeStartDay && occurrence <= rangeEndDay) dates.push(occurrence);
  }
  return dates;
}

/**
 * Walks every heading in `doc`, calling `visit(heading, ancestors)` for
 * each. Small and local rather than imported — matches the existing
 * pattern of each module owning its own tree walk (see fold-state.js,
 * archive-model.js) rather than forcing a shared traversal abstraction
 * before one's actually needed.
 * @param {Doc} doc
 * @param {any} [visit]
 */
function walkHeadings(doc, visit) {
  /**
   * @param {any} [node]
   * @param {any} [ancestors]
   */
  function walk(node, ancestors) {
    for (const child of node.children || []) {
      if (child.type !== 'heading') continue;
      visit(child, ancestors);
      walk(child, [...ancestors, child]);
    }
  }
  walk(doc, []);
}

/**
 * Builds the flat list of agenda items across `docs` — an array of
 * { documentId, doc }, e.g. straight from document-store's
 * openAllDocuments(). Three sources per heading, each producing an item
 * (or, for a repeating timestamp with a range given, multiple items —
 * see rangeStart/rangeEnd below):
 *   - a SCHEDULED: timestamp (kind: 'scheduled')
 *   - a DEADLINE: timestamp (kind: 'deadline')
 *   - a plain *active* timestamp written directly in the heading title,
 *     when the heading has no SCHEDULED/DEADLINE of its own (kind:
 *     'timestamp') — the standard org convention for tracking a
 *     recurring date like a birthday right on its own heading line
 *     ("Jennifer <1989-11-02 Thu +1y>"), a genuinely different, older
 *     agenda source than SCHEDULED/DEADLINE, not a fallback for them.
 *
 * These three sources are NOT interchangeable in one important way, a
 * real distinction in org itself, not an app-specific choice: a plain
 * timestamp shows up only on its specific day and never again, no matter
 * what — "if you didn't go to your doctor's appointment yesterday, that
 * doesn't mean you still have one today". A SCHEDULED or DEADLINE
 * timestamp is different: if the heading isn't done yet, it keeps
 * reappearing on every day from its date through today (see `isDone`
 * below) — that's the actual point of the distinction between "when do I
 * intend to do this" and "just a dated record", and it's what makes an
 * overdue task actually visible as overdue instead of silently vanishing
 * off the agenda the moment its original date passes.
 *
 * Options:
 *   includeArchived (default false) — include archived subtrees/items
 *   includeCommented (default false) — include "commented" headings —
 *     ones whose title itself starts with "# " (or is just "#"), real
 *     org's own definition of a comment line applied to a heading title
 *     (see comment-model.js). Mirrors includeArchived exactly, matching
 *     real org's own default of skipping both commented and archived
 *     trees in agenda views (org-agenda-skip-comment-trees and
 *     org-agenda-skip-archived-trees, both t by default).
 *   todoFilter(keyword) -> boolean — keep only headings whose todo passes
 *   tagFilter(tags) -> boolean — keep only headings whose tags pass
 *   rangeStart, rangeEnd (both optional, both required together) — when
 *     given: a timestamp with a repeater expands into every occurrence
 *     within [rangeStart, rangeEnd] instead of just its literal stored
 *     date; a timestamp WITHOUT a repeater is only included if its
 *     literal date actually falls within that same range (or, for an
 *     undone SCHEDULED/DEADLINE, if ANY of its carried-forward days
 *     fall within that range — see isDone/today below). Without a
 *     range, every item is included at its literal date regardless
 *     (unbounded expansion has no natural stopping point either way) —
 *     existing callers that don't pass a range are unaffected.
 *   isDone(todo) -> boolean, today (default: now) — together, these turn
 *     on SCHEDULED/DEADLINE carry-forward: for a heading where
 *     isDone(heading.todo) is false, an otherwise-single-occurrence
 *     SCHEDULED/DEADLINE instead produces one item per day from its own
 *     date through `today` (intersected with rangeStart/rangeEnd, so
 *     this stays cheap regardless of how long something's been overdue).
 *     Carried-forward items (every day after the literal one) carry
 *     `daysOverdue` > 0. Not passing `isDone` leaves the old
 *     single-occurrence-only behavior exactly as it was — this is
 *     opt-in, not a default that could surprise an existing caller.
 *     Deliberately does NOT apply to repeating SCHEDULED/DEADLINE items
 *     (real org's interaction between a repeater and being marked done —
 *     the timestamp auto-advancing on completion — is genuinely more
 *     involved than this read-only agenda needs to model) or to plain
 *     title timestamps (which never carry forward, by definition above).
 *   birthdayProperty (default 'BIRTHDAY') — which property key
 *     org-contacts-anniversaries (see above) reads for a heading's
 *     birthday/anniversary date+description, matching whatever
 *     org-contacts-birthday-property is set to via Local Variables.
 */
/** A title as an Agenda row shows it with the timestamps taken out: every active <...> (a range's two ends and the dash
 * @param {string} title
 *  between them too), and the spaces they leave. A title that is nothing but timestamps keeps its text. Inactive [...] stay. */
export function stripTitleStamps(title) {
  const cleaned = title
    .replace(/<\d{4}-\d{2}-\d{2}[^>\n]*>(?:--<\d{4}-\d{2}-\d{2}[^>\n]*>)?/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || title;
}

const RANGE_RE = /(<\d{4}-\d{2}-\d{2}[^>\n]*>)--(<\d{4}-\d{2}-\d{2}[^>\n]*>)/g;
const NO_STAMP_BLOCKS = new Set(['SRC', 'EXAMPLE', 'EXPORT', 'COMMENT']);

/** Everything of a heading's own entry as Emacs searches it for dates: the title, the planning line, the property values, the log and the body. @param {Heading} heading */
function entryText(heading) {
  const lines = [heading.title];
  const planning = heading.planning || { scheduled: null, deadline: null };
  const stamps = (planning.order || ['scheduled', 'deadline']).filter((/** @type {string} */ k) => (k === 'scheduled' || k === 'deadline') && planning[k]);
  if (stamps.length) lines.push(stamps.map((/** @type {'scheduled' | 'deadline'} */ k) => `${k.toUpperCase()}: ${planning[k]}`).join(' '));
  for (const value of Object.values(heading.properties || {})) lines.push(String(value));
  lines.push(...allLogLines(heading), ...(heading.bodyLines || []));
  return lines.join('\n');
}

/**
 * The text of one heading's entry that Emacs searches for timestamps: the
 * title, the property values, the drawer lines and the body, less the lines
 * and blocks Emacs passes over -- #+BEGIN_SRC/EXAMPLE/EXPORT/COMMENT blocks
 * (one with no #+END is not a block), "# " comment lines and #+KEYWORD lines.
 * The SCHEDULED/DEADLINE line is not part of it: the parser holds that apart.
 * @param {Heading} heading
 * @returns {string}
 */
function entryTimestampText(heading) {
  const lines = [heading.title];
  for (const value of Object.values(heading.properties || {})) lines.push(String(value));
  lines.push(...allLogLines(heading));
  const body = heading.bodyLines || [];
  for (let i = 0; i < body.length; i++) {
    const begin = /^\s*#\+BEGIN_(\w+)/i.exec(body[i]);
    if (begin && NO_STAMP_BLOCKS.has(begin[1].toUpperCase())) {
      const end = new RegExp(`^\\s*#\\+END_${begin[1]}\\b`, 'i');
      let j = i + 1;
      while (j < body.length && !end.test(body[j])) j++;
      if (j < body.length) {
        i = j;
        continue;
      }
    }
    if (/^\s*#(\s|$|\+)/.test(body[i])) continue;
    lines.push(body[i]);
  }
  return lines.join('\n');
}

/** The category label shown as a prefix before each agenda item --
 *  real org's own #+CATEGORY: keyword if the file sets one, otherwise
 *  the file's own basename (no directory path, no .org extension),
 *  matching real org's own actual default behavior exactly. Keyword
 *  lookup is case-insensitive, matching how every other #+KEYWORD:
 * @param {Doc} doc
 * @param {string} documentId
 *  line here already treats case as not meaningful. */
function getCategoryForDocument(doc, documentId) {
  /** @param {any} [kw] */
  const categoryKw = (doc.keywords || []).find((kw) => kw.key.toUpperCase() === 'CATEGORY');
  if (categoryKw && categoryKw.value.trim()) return categoryKw.value.trim();
  if (!documentId || documentId.startsWith(UNSAVED_DOCUMENT_ID)) return 'Untitled'; // an unsaved, in-memory-only document has no filename to derive a category from
  const base = (String(documentId).split('/').pop() || '').replace(/\.org$/i, '');
  return base || documentId;
}

/**
 * The time of day an entry that has none of its own gets from its headline (org-agenda-search-headline-for-time, on by default): the
 * `timeOfDay` the sort keys use (HHMM, whatever the hours), and the day with the time when it is a real clock time.
 * @param {Heading} heading @param {Date} day
 * @returns {{ timeOfDay: number, date: Date | null, endDate: Date | null } | null}
 */
function headlineClock(heading, day) {
  const t = headlineTime(heading.title || '');
  if (!t) return null;
  const real = (/** @type {{ hour: number, minute: number }} */ c) => c.hour < 24 && c.minute < 60;
  const at = (/** @type {{ hour: number, minute: number }} */ c) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), c.hour, c.minute);
  return { timeOfDay: t.hour * 100 + t.minute, date: real(t) ? at(t) : null, endDate: t.end && real(t.end) ? at(t.end) : null };
}

/** @param {{ documentId: string, doc: Doc }[]} docs */
function buildAgendaItems(docs, opts = /** @type {AgendaOptions} */ ({})) {
  const {
    includeArchived = false,
    includeCommented = false,
    includeLogbook = false,
    skipEntry = null, // org-agenda-skip-function (agenda-skip.js): says whether an entry the agenda is about to list is skipped
    logSettings: givenLogSettings = null, // log mode (agenda-log.js); includeLogbook: true is the default log mode
    todoFilter = null,
    tagFilter = null,
    rangeStart = null,
    rangeEnd = null,
    isDone = null,
    today = new Date(),
    birthdayProperty = 'BIRTHDAY',
    contactsDocs = null,
    deadlineWarningDays = 14,
    scheduledDelayDays = 0,
    daySettings: givenDaySettings = null, // the other org-agenda-skip-* / org-deadline-past-days ... settings (readDaySettings); Emacs's defaults when null
    calendarLatitude = 35.994,
    calendarLongitude = -78.8986,
    calendarLocationName = null,
    calendarDateStyle = 'american',
    diaryHebrewSabbathCandlesMinutes = 18,
    calendarTimeDisplayForm,
    weatherData = null,
    orgWeatherFormat = DEFAULT_ORG_WEATHER_FORMAT,
    orgWeatherTemperatureUnit = '\u00b0F',
    orgWeatherSpeedUnit = 'mph',
    diary = null, // the diary file (org-agenda-include-diary), already read; null leaves it out
    habits = null, // { enabled, onlyForToday, showAllToday, precedingDays, followingDays }: org-habit's agenda behaviour; null leaves habits as ordinary repeating tasks
  } = opts;
  /** @type {any[]} */ const items = [];
  const logSettings = givenLogSettings ?? (includeLogbook ? readLogSettings(undefined, true) : null);
  const logOnly = !!logSettings && (logSettings.mode === 'only' || logSettings.mode === 'clockcheck');
  const daySettings = { ...(givenDaySettings || defaultDaySettings()), warningDays: deadlineWarningDays, delayDays: scheduledDelayDays };
  /** @type {Map<any, Set<number>>} */ const stampDays = new Map();

  /**
   * @param {string} documentId
   * @param {Heading} heading
   * @param {string} kind
   * @param {any} parsed
   * @param {boolean} headingIsDone
   * @param {boolean} [doneState] the entry is completed (for org-agenda-skip-*-if-done)
   */
  function addItem(documentId, heading, kind, parsed, headingIsDone, doneState = false) {
    if (skipEntry && skipEntry(kind === 'timestamp' && parsed.isBlock ? 'block' : kind, documentId, heading)) return;
    // Emacs repeats a plain time stamp only when its repeater is the last thing before `>` (org-repeat-re): `<… +1d -2d>` and
    // `<… +1w/2w>` stay on their own date.  SCHEDULED and DEADLINE read their repeaters properly.
    if (kind !== 'scheduled' && kind !== 'deadline' && parsed.repeater && parsed.raw && !/ [.+]?\+\d+[hdwmy]>$/.test(parsed.raw)) parsed = { ...parsed, repeater: null };
    const base = {
      documentId,
      heading,
      kind,
      hasTime: parsed.hasTime,
      endDate: parsed.endDate || null,
      rangeDay: parsed.rangeDay || null,
      rangeDays: parsed.rangeDays || null,
      repeater: parsed.repeater,
      ...(parsed.inactive ? { inactive: true } : {}),
      todo: heading.todo,
      priority: heading.priority,
      tags: heading.tags,
      title: heading.title,
    };

    // The days of the view a SCHEDULED, DEADLINE or plain time stamp shows on, and how, are Emacs's (src/agenda-emacs-days.js).
    if (rangeStart && rangeEnd && isDone !== null) {
      const todayN = dayNumberOf(today);
      const first = dayNumberOf(rangeStart);
      const last = dayNumberOf(rangeEnd);
      const own = dayNumberOf(parsed.date);
      /** @type {number[]} */ let days;
      if (!parsed.repeater) days = [own, todayN];
      else {
        days = [own, todayN];
        for (let n = Math.max(first, own); n <= last; n++) days.push(n);
      }
      const state = heading.todo || null;
      const planned = (/** @type {'scheduled' | 'deadline'} */ k) => {
        const text = heading.planning && heading.planning[k];
        const p = text ? parseOrgTimestamp(text) : null;
        return p && p.active ? p : null;
      };
      const otherPlanned = kind === 'scheduled' ? planned('deadline') : kind === 'deadline' ? planned('scheduled') : null;
      const deadlinePlanned = planned('deadline');
      const deadlineShownOn = (/** @type {number} */ n) => !!deadlinePlanned && !headingIsDone && !!planningOnDay('deadline', deadlinePlanned, n, todayN, daySettings, { other: planned('scheduled'), state });
      for (const n of new Set(days)) {
        if (n < first || n > last) continue;
        const day = dateOfDay(n);
        if (kind === 'timestamp') {
          if (doneState && daySettings.skipTimestampIfDone) continue;
          if (!timestampOnDay(parsed, n, todayN, daySettings, state)) continue;
          if (daySettings.skipTimestampIfDeadlineIsShown && !parsed.isBlock && deadlineShownOn(n)) continue;
          if (daySettings.skipAdditionalTimestampsSameEntry && !parsed.isBlock) {
            const key = n;
            const shownDays = stampDays.get(heading) || new Set();
            if (shownDays.has(key)) continue;
            shownDays.add(key);
            stampDays.set(heading, shownDays);
          }
          const fromTitle = !parsed.hasTime ? headlineClock(heading, day) : null;
          items.push({
            ...base,
            emacsOrder: parsed.isBlock ? 2 : 3,
            tsDate: parsed.isBlock ? null : parsed.repeater ? own : n,
            date: fromTitle && fromTitle.date ? fromTitle.date : new Date(day.getFullYear(), day.getMonth(), day.getDate(), parsed.date.getHours(), parsed.date.getMinutes()),
            ...(fromTitle ? { hasTime: !!fromTitle.date, endDate: fromTitle.endDate, timeOfDay: fromTitle.timeOfDay } : {}),
            daysOverdue: 0,
          });
          continue;
        }
        // org-habit: a habit is listed as any scheduled entry is (with org-habit-scheduled-past-days for how long it stays), or on all of today with
        // org-habit-show-all-today; only today unless org-habit-show-habits-only-for-today is off, and not at all when habits are hidden
        const habit = kind === 'scheduled' && habits ? habitSpec(heading) : null;
        if (habit && habits && (!habits.enabled || (n !== todayN && habits.onlyForToday))) continue;
        const shows =
          habit && habits && habits.showAllToday && n === todayN
            ? { daysOverdue: own < todayN ? n - own : 0, showTime: n === own && parsed.hasTime, ownDay: n === own, pastScheduled: own < todayN, day: own }
            : planningOnDay(kind === 'deadline' ? 'deadline' : 'scheduled', parsed, n, todayN, habit && habits && habits.scheduledPastDays != null ? { ...daySettings, scheduledPastDays: habits.scheduledPastDays } : daySettings, { other: otherPlanned, state, deadlineShown: !habit && kind === 'scheduled' && deadlineShownOn(n) });
        if (!shows) continue;
        // a completed entry is listed only on its own date, and not at all with org-agenda-skip-scheduled/deadline-if-done; never a habit
        if (doneState && (habit || (kind === 'deadline' ? daySettings.skipDeadlineIfDone : daySettings.skipScheduledIfDone) || shows.day !== n)) continue;
        const fromTitle = !shows.showTime && shows.ownDay ? headlineClock(heading, day) : null; // a reminder has no time of day; an entry with no time of its own takes the one in its headline
        items.push({
          ...base,
          ...(habit && habits ? { habit: buildHabitGraph(heading, isDone, today, habits) } : {}),
          hasTime: shows.showTime || !!(fromTitle && fromTitle.date),
          ...(fromTitle ? { timeOfDay: fromTitle.timeOfDay, endDate: fromTitle.endDate } : {}),
          date: fromTitle && fromTitle.date ? fromTitle.date : new Date(day.getFullYear(), day.getMonth(), day.getDate(), shows.showTime ? parsed.date.getHours() : 0, shows.showTime ? parsed.date.getMinutes() : 0),
          daysOverdue: habit ? 0 : shows.daysOverdue, // Emacs leaves the "Sched. 3x:" leader off a habit's row
          emacsOrder: kind === 'deadline' ? 0 : 1,
          tsDate: shows.day,
          ...(kind === 'scheduled' ? { scheduledAge: n - shows.day } : {}),
        });
      }
      return;
    }

    // Without isDone nothing is carried forward and a repeating stamp is listed on every repeat in the range (the appointment scan
    // and the calendar's dots want every occurrence, whatever today is)
    const repeater = parsed.repeater ? parseRepeater(parsed.repeater) : null;
    if (repeater && rangeStart && rangeEnd) {
      for (const occurrenceDate of expandRepeats(parsed.date, repeater, rangeStart, rangeEnd)) items.push({ ...base, date: occurrenceDate, daysOverdue: 0 });
    } else if (rangeStart && rangeEnd) {
      if (parsed.date >= rangeStart && parsed.date <= rangeEnd) items.push({ ...base, date: parsed.date, daysOverdue: 0 });
    } else {
      items.push({ ...base, date: parsed.date, daysOverdue: 0 });
    }
  }

  // org-contacts-anniversaries is active for this call if the trigger
  // line is present ANYWHERE across all docs, not scoped to any one
  // heading or file — checked upfront, once, rather than re-scanning
  // per heading in the main loop below.
  const contactsTriggers = collectContactsTriggers(docs);

  // One contact's entries, for each trigger. The contacts are the headings of `contactsDocs` (the files of org-contacts-files, as
  // in Emacs) when the caller has them, and otherwise of the same documents the triggers were found in.
  /**
   * @param {string} documentId
   * @param {Heading} heading
   */
  function pushContactItems(documentId, heading) {
    for (const trigger of contactsTriggers) {
      const field = trigger.field || birthdayProperty;
      const event = contactEventFor(heading, field, birthdayProperty);
      if (!event) continue;
      const spouse = contactSpouse(heading);
      for (const occurrenceDate of expandContactEventOccurrences(event.month, event.day, rangeStart, rangeEnd, today)) {
        const age = contactEventAge(event.year, occurrenceDate);
        items.push({
          documentId,
          heading,
          kind: 'anniversary',
          hasTime: false,
          repeater: null,
          todo: heading.todo,
          priority: heading.priority,
          tags: heading.tags,
          title: formatContactEventTitle({ format: trigger.format, field, birthdayProperty, description: event.description, name: heading.title, spouse, age }),
          age,
          field,
          spouse,
          date: occurrenceDate,
          daysOverdue: 0,
        });
      }
    }
  }
  if (contactsTriggers.length && contactsDocs && !logOnly) {
    for (const { documentId, doc } of contactsDocs) {
      walkHeadings(doc, (/** @type {any} */ heading) => {
        if (!includeArchived && isArchived(heading)) return;
        if (!includeCommented && isCommentedHeading(heading)) return;
        if (tagFilter && !tagFilter(heading.tags)) return;
        pushContactItems(documentId, heading);
      });
    }
  }

  /** @type {Map<any, string>} */ const categoryByHeading = new Map();
  for (const { documentId, doc } of docs) {
    walkHeadings(doc, (/** @type {any} */ heading, /** @type {any[]} */ ancestors) => {
      const ownCategory = [heading, ...[...ancestors].reverse()].map((h) => getPropertyCaseInsensitive(h, 'CATEGORY')).find((v) => typeof v === 'string' && v.trim());
      if (ownCategory) categoryByHeading.set(heading, ownCategory.trim()); // a CATEGORY property, its own or an ancestor's, names the category of the entry
      if (!includeArchived && [...ancestors, heading].some(isArchived)) return; // a subtree of an archived or commented heading is skipped whole
      if (!includeCommented && [...ancestors, heading].some(isCommentedHeading)) return;
      if (tagFilter && !tagFilter(heading.tags)) return;

      // Log mode (org-agenda-get-progress): the closed, clock and state lines of the entry on a day of the view. Not gated by todoFilter:
      // a completed entry is what log mode is for.
      if (logSettings && logSettings.mode) {
        const first = rangeStart ? dayNumberOf(rangeStart) : -Infinity;
        const last = rangeEnd ? dayNumberOf(rangeEnd) : Infinity;
        const keywords = opts.todoKeywords || (() => { const seq = resolveTodoSequence(doc); return [...seq.todoKeywords, ...seq.doneKeywords]; })();
        const rows = logRows(heading, logSettings, keywords, first, last);
        for (const row of skipEntry && rows.length && skipEntry('progress', documentId, heading) ? [] : rows) {
          const at = dateOfDay(row.day);
          const timed = row.hour !== null && row.minute !== null;
          items.push({
            documentId,
            heading,
            kind: 'logbook',
            logType: row.type,
            logLabel: row.label,
            fixedPriority: 100000, // Emacs gives a log line this priority, above every other
            emacsOrder: -1,
            hasTime: timed,
            repeater: null,
            todo: heading.todo,
            priority: heading.priority,
            tags: heading.tags,
            title: row.note ? `${heading.title} - ${row.note}` : heading.title,
            logNote: null,
            date: timed ? new Date(at.getFullYear(), at.getMonth(), at.getDate(), /** @type {number} */ (row.hour), /** @type {number} */ (row.minute)) : at,
            endDate: timed && row.endHour !== null && row.endMinute !== null ? new Date(at.getFullYear(), at.getMonth(), at.getDate(), row.endHour, row.endMinute) : null,
            clockStart: row.clockStart,
            clockEnd: row.clockEnd,
            daysOverdue: 0,
          });
        }
        if (logOnly) return;
      }

      if (todoFilter && !todoFilter(heading.todo)) return;

      const headingIsDone = isDone ? isDone(heading.todo) : false;

      let hasPlanning = false;
      for (const kind of ['scheduled', 'deadline']) {
        const raw = heading.planning && heading.planning[kind];
        if (!raw) continue;
        const parsed = parseOrgTimestamp(raw);
        if (!parsed || !parsed.active) continue; // as in Emacs, only an active date is a reminder
        hasPlanning = true;
        addItem(documentId, heading, kind, parsed, headingIsDone, headingIsDone);
      }

      // Plain active timestamps anywhere in the heading's own entry: its
      // title, its body, its property values and its drawers (not its
      // children, which are entries of their own). This is what Emacs's
      // agenda does, checked against Emacs 29.3 in test/fixtures/agenda/b1.org:
      // a heading with SCHEDULED/DEADLINE still lists its other timestamps,
      // and source, example, export and comment blocks, comment lines and
      // keyword lines are skipped. Inactive [timestamps] never count. A plain
      // timestamp never carries forward, unlike SCHEDULED/DEADLINE above.
      {
        // <start>--<end> is every day from one to the other, as in Emacs.
        let rest = entryTimestampText(heading);
        for (const m of rest.matchAll(RANGE_RE)) {
          const from = parseOrgTimestamp(m[1]);
          const to = parseOrgTimestamp(m[2]);
          if (!from || !to || !from.active || !to.active || startOfDay(to.date) < startOfDay(from.date)) continue;
          rest = rest.replace(m[0], ' ');
          const rangeDays = Math.round((startOfDay(to.date).getTime() - startOfDay(from.date).getTime()) / 86400000) + 1;
          const lo = rangeStart ? Math.max(dayNumberOf(from.date), dayNumberOf(rangeStart)) : dayNumberOf(from.date);
          const hi = rangeEnd ? Math.min(dayNumberOf(to.date), dayNumberOf(rangeEnd)) : dayNumberOf(to.date);
          for (let n = lo; n <= hi; n++) {
            const rangeDay = n - dayNumberOf(from.date) + 1;
            const withTime = blockTimeOnDay(from, to, n);
            const date = withTime ?? dateOfDay(n);
            addItem(documentId, heading, 'timestamp', { ...from, isBlock: true, repeater: null, date, hasTime: !!withTime, endDate: null, rangeDay: rangeDays > 1 ? rangeDay : null, rangeDays: rangeDays > 1 ? rangeDays : null }, true, headingIsDone);
          }
        }
        const inactiveToo = daySettings.includeInactiveTimestamps;
        if (inactiveToo) rest = rest.split('\n').filter((line) => !/^\s*CLOCK:/.test(line)).join('\n').replace(/\[\d{4}-\d{2}-\d{2}[^\]\n]*\]--\[\d{4}-\d{2}-\d{2}[^\]\n]*\]/g, ' '); // a clock line and an inactive date range are left out
        for (const parsed of findTimestamps(rest)) {
          if (!parsed.active && !(inactiveToo && !parsed.repeater)) continue;
          addItem(documentId, heading, 'timestamp', parsed.active ? parsed : { ...parsed, inactive: true }, true, headingIsDone); // headingIsDone: true short-circuits carry-forward
        }
      }

      // Real org's own <%%(sexp)> timestamp form -- a genuinely
      // different mechanism from the plain <timestamp> case just
      // above: rather than one literal date, the expression is
      // evaluated once for every day being considered, and each day
      // it evaluates truthy becomes its own agenda occurrence. Same
      // "skip if this heading already has SCHEDULED/DEADLINE" guard,
      // same "never carries forward" reasoning as the plain-timestamp
      // case -- a sexp timestamp is a dynamic matcher, not a
      // stateful "intend to do this" marker either.
      if (!hasPlanning && rangeStart && rangeEnd) {
        for (const sexpTs of findSexpTimestamps(heading.title)) {
          const cleanTitle = heading.title.replace(sexpTs.raw, '').trim();
          /** @type {Map<string, Date>} */
          const failures = new Map(); // each distinct error once, on the first day it happened
          for (const day of enumerateDays(rangeStart, rangeEnd)) {
            const { result, error } = evaluateSexpWithError(sexpTs.expr, {
              candidateDate: day,
              entryText: cleanTitle,
              today,
              calendarLatitude,
              calendarLongitude,
              calendarLocationName,
              calendarDateStyle,
              diaryHebrewSabbathCandlesMinutes,
              calendarTimeDisplayForm,
              weatherData,
              orgWeatherFormat,
              orgWeatherTemperatureUnit,
              orgWeatherSpeedUnit,
            });
            if (error !== undefined && !failures.has(error)) failures.set(error, day);
            if (!isTruthy(result)) continue;
            const displayTitle =
              typeof result === 'string' ? (cleanTitle ? `${cleanTitle}: ${result}` : result) : cleanTitle || '(untitled)';
            items.push({
              documentId,
              heading,
              kind: 'sexp-timestamp',
              weather: /\borg-weather\b/.test(sexpTs.raw), // so a calendar can say how fresh the forecast is
              hasTime: false,
              repeater: null,
              todo: heading.todo,
              priority: heading.priority,
              tags: heading.tags,
              title: displayTitle,
              date: day,
              daysOverdue: 0,
            });
          }
          for (const [message, day] of failures) {
            items.push({
              documentId,
              heading,
              kind: 'sexp-timestamp',
              hasTime: false,
              repeater: null,
              todo: heading.todo,
              priority: heading.priority,
              tags: heading.tags,
              title: `${cleanTitle ? cleanTitle + ': ' : ''}${message}`,
              date: day,
              daysOverdue: 0,
              error: message,
            });
          }
        }
      }

      // org-contacts-anniversaries: only checked at all when the
      // trigger was found somewhere (see contactsAnniversariesActive
      // above) — a heading carrying the configured property means
      // nothing on its own otherwise, since the property might simply
      // be there for other purposes (vCard export, contact lookup) with
      // no intention of it appearing in the agenda.
      if (contactsTriggers.length && !contactsDocs) pushContactItems(documentId, heading);

      // The diary-sexp forms below (org-anniversary, org-cyclic,
      // org-block, diary-float, org-weather) are each self-contained, per-line
      // sexps -- every line in this heading's own body is checked against
      // each pattern directly.
      if (rangeStart && rangeEnd) {
        for (const line of heading.bodyLines || []) {
          const trimmed = canonicalDiaryLine(unquoteDiaryFloatMonthList(line.trim()), calendarDateStyle);
          if (!trimmed.startsWith('%%(')) continue; // fast skip -- every one of these five forms starts this way

          /**
           * @param {any} occurrenceDate
           * @param {string} title
           * @param {string} [error]  the message, for a program that failed
           */
          const pushDiarySexpItem = (occurrenceDate, title, error) => {
            items.push({
              documentId,
              heading,
              kind: 'diary-sexp',
              hasTime: false,
              repeater: null,
              todo: heading.todo,
              priority: heading.priority,
              tags: heading.tags,
              title,
              date: occurrenceDate,
              daysOverdue: 0,
              ...(error === undefined ? {} : { error }),
            });
          };

          // A line built from and / or / not / when / org-class / org-date /
          // diary-date has no dedicated form of its own: it goes through the
          // same evaluator as a <%%(...)> timestamp, once per day.
          const general = parseGeneralBodyLine(trimmed);
          if (general) {
            /** @type {Map<string, Date>} */
            const failures = new Map();
            for (const day of enumerateDays(rangeStart, rangeEnd)) {
              const { result, error } = evaluateSexpWithError(general.expr, {
                candidateDate: day,
                entryText: general.text || heading.title || '',
                today,
                calendarLatitude,
                calendarLongitude,
                calendarLocationName,
                calendarTimeDisplayForm,
                calendarDateStyle,
                diaryHebrewSabbathCandlesMinutes,
                weatherData,
                orgWeatherFormat,
                orgWeatherTemperatureUnit,
                orgWeatherSpeedUnit,
              });
              if (error !== undefined && !failures.has(error)) failures.set(error, day);
              if (!isTruthy(result)) continue;
              pushDiarySexpItem(day, typeof result === 'string' ? result : general.text || heading.title || '(untitled)');
            }
            for (const [message, day] of failures) pushDiarySexpItem(day, `${general.text ? general.text + ': ' : ''}${message}`, message);
            continue;
          }

          const anniv = parseOrgAnniversaryLine(trimmed);
          if (anniv) {
            for (const occ of expandOrgAnniversaryOccurrences(anniv.month, anniv.day, rangeStart, rangeEnd, anniv.year)) {
              pushDiarySexpItem(occ, formatOrgAnniversaryTitle(anniv.template, occ.getFullYear() - anniv.year));
            }
            continue;
          }

          const cyclic = parseOrgCyclicLine(trimmed);
          if (cyclic) {
            const baseline = new Date(cyclic.year, cyclic.month - 1, cyclic.day);
            for (const occ of expandOrgCyclicOccurrences(cyclic.n, baseline, rangeStart, rangeEnd)) {
              pushDiarySexpItem(occ, cyclic.title);
            }
            continue;
          }

          const block = parseOrgBlockLine(trimmed);
          if (block) {
            for (const occ of expandOrgBlockOccurrences(block.dateA, block.dateB, rangeStart, rangeEnd)) {
              pushDiarySexpItem(occ, block.title);
            }
            continue;
          }

          const float = parseDiaryFloatLine(trimmed);
          if (float) {
            const occs = expandDiaryFloatOccurrences(
              float.monthSpec,
              float.dayname,
              float.n,
              float.day,
              float.year,
              rangeStart,
              rangeEnd
            );
            for (const occ of occs) pushDiarySexpItem(occ, float.title);
            continue;
          }

          if (isOrgWeatherLine(trimmed) && weatherData && enumerateDays(rangeStart, rangeEnd).some((d) => startOfDay(d).getTime() === startOfDay(today).getTime())) {
            items.push({
              documentId,
              heading,
              kind: 'weather',
              hasTime: false,
              repeater: null,
              todo: heading.todo,
              priority: heading.priority,
              tags: heading.tags,
              title: formatWeatherLine(orgWeatherFormat, weatherData, orgWeatherTemperatureUnit, orgWeatherSpeedUnit, today),
              date: today,
              daysOverdue: 0,
            });
          }
        }
      }
    });
  }

  const categoryByDocument = new Map();
  for (const { documentId, doc } of docs) {
    if (!categoryByDocument.has(documentId)) categoryByDocument.set(documentId, getCategoryForDocument(doc, documentId));
  }
  for (const item of items) {
    item.category = (item.heading && categoryByHeading.get(item.heading)) || categoryByDocument.get(item.documentId) || item.documentId;
  }
  if (diary && rangeStart && rangeEnd && !logOnly) items.push(...buildDiaryItems(diary, rangeStart, rangeEnd, opts, buildAgendaItems));

  // By day, and on a day as Emacs lists them, file by file: every deadline, then every scheduled item, the date ranges, the time
  // stamps and the sexps (its sort is stable, so the order stays when sort keys tie).
  const fileIndex = new Map(docs.map((d, i) => [d.documentId, i]));
  return items
    .map((item, at) => ({ item, at, day: startOfDay(item.date).getTime() }))
    .sort((a, b) => a.day - b.day || (fileIndex.get(a.item.documentId) ?? 0) - (fileIndex.get(b.item.documentId) ?? 0) || (a.item.emacsOrder ?? 4) - (b.item.emacsOrder ?? 4) || a.at - b.at)
    .map((e) => e.item);
}

/**
 * Items falling on the same calendar day as `date` (default: today).
 * @param {AgendaItem[]} items
 */
function itemsForDate(items, date = new Date()) {
  return items.filter((item) => isSameDay(item.date, date));
}

/**
 * Items within [start, end], inclusive of the days start/end fall on.
 * @param {AgendaItem[]} items
 * @param {Date} start
 * @param {Date} end
 */
function itemsInRange(items, start, end) {
  const startKey = dateKey(start);
  const endKey = dateKey(end);
  return items.filter((item) => {
    const k = dateKey(item.date);
    return k >= startKey && k <= endKey;
  });
}

/** Groups items by calendar day, returning entries sorted chronologically:
 * @param {AgendaItem[]} items
 *  [{ date: 'YYYY-MM-DD', items: [...] }, ...] */
function groupByDay(items) {
  const map = new Map();
  for (const item of items) {
    const key = dateKey(item.date);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([date, dayItems]) => ({
    date,
    items: dayItems,
  }));
}

/** A single day's items, grouped the same shape as the other *View
 *  functions (a one-entry array) for a consistent return shape callers
 * @param {AgendaItem[]} items
 *  can treat uniformly regardless of which view is active. */
function dayView(items, date = new Date()) {
  const grouped = groupByDay(itemsForDate(items, date));
  if (grouped.length > 0) return grouped;
  return [{ date: dateKey(date), items: [] }];
}

/**
 * Midnight (00:00:00.000) of `date`'s calendar day.
 * @param {Date} date
 */
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * The last instant (23:59:59.999) of `date`'s calendar day.
 * @param {Date} date
 */
function endOfDay(date) {
  const d = startOfDay(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * The first day of the calendar week containing `date`, per
 * `startOnWeekday` (0=Sunday, 1=Monday — real org's own default via
 * org-agenda-start-on-weekday, see local-variables.js — 2=Tuesday, ...
 * 6=Saturday). This is what makes a week view actually a week: given any
 * date inside a week, it finds that week's real starting day, rather
 * than treating whatever date it's handed as the literal first day (see
 * weekView below, which used to do exactly that — a real bug, not just
 * an unconfigurable default).
 * @param {Date} date
 */
function startOfWeek(date, startOnWeekday = 1) {
  const d = startOfDay(date);
  const currentWeekday = d.getDay(); // 0-6, Sun-Sat
  const diff = (currentWeekday - startOnWeekday + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

/**
 * A week view: the 7 days of the calendar week containing `anchorDate`,
 * starting on `startOnWeekday`. This used to just start FROM whatever
 * date was passed in, treating it as day 1 of the week regardless of
 * which weekday it actually fell on — meaning "this week" depended on
 * which day you happened to open the agenda on, not on any consistent
 * notion of a week. Now it always resolves to the same 7-day window
 * (e.g. Monday-Sunday) no matter which day within that window you pass.
 * @param {AgendaItem[]} items
 */
function weekView(items, anchorDate = new Date(), startOnWeekday = 1) {
  const start = startOfWeek(anchorDate, startOnWeekday);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const grouped = groupByDay(itemsInRange(items, start, end));
  const byKey = new Map(grouped.map((d) => [d.date, d]));
  const allDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = dateKey(d);
    allDays.push(byKey.get(key) || { date: key, items: [] });
  }
  return allDays;
}

/** A month view: every day in `date`'s calendar month, from the 1st
 *  through the actual last day of that month (28-31, handled correctly
 *  regardless of month length or leap years via the "day 0 of next
 * @param {AgendaItem[]} items
 *  month" trick). */
function monthView(items, date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const grouped = groupByDay(itemsInRange(items, start, end));
  const byKey = new Map(grouped.map((d) => [d.date, d]));
  const allDays = [];
  let current = new Date(start);
  while (current <= end) {
    const key = dateKey(current);
    allDays.push(byKey.get(key) || { date: key, items: [] });
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
  }
  return allDays;
}

/**
 * The days of a span (see agenda-span.js) as the day groups of a view: `ndays` days from `start`, the days without items included.
 * @param {AgendaItem[]} items
 * @param {Date} start
 * @param {number} ndays
 */
function rangeView(items, start, ndays) {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + ndays - 1);
  const byKey = new Map(groupByDay(itemsInRange(items, start, end)).map((d) => [d.date, d]));
  const allDays = [];
  for (let i = 0; i < ndays; i++) {
    const key = dateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    allDays.push(byKey.get(key) || { date: key, items: [] });
  }
  return allDays;
}

/**
 * Builds the flat list of "active" TODO-state headings across `docs` —
 * completely independent of any date or timestamp, matching real org's
 * own global TODO list (the 't' dispatcher option, distinct from 'a'
 * agenda, which only ever shows dated items — a TODO with no date never
 * appears there, by design, not by omission). A heading qualifies when
 * its TODO state is set and isn't one of the sequence's done keywords.
 *
 * Options mirror buildAgendaItems' equivalents where they overlap:
 *   includeArchived (default false), includeCommented (default false),
 *   tagFilter(tags) -> boolean, isDone(todo) -> boolean — required to
 *     get any results at all, since without it every heading with ANY
 *     todo state (done or not) would be considered "active". This is
 *     deliberately not defaulted to some hardcoded "DONE" check, for the
 *     same reason buildAgendaItems isn't — the file's own #+TODO:
 *     sequence decides what counts as done, not this module.
 * @param {{ documentId: string, doc: Doc }[]} docs
 */
function buildTaskList(docs, opts = /** @type {AgendaOptions} */ ({})) {
  const { includeArchived = false, includeCommented = false, tagFilter = null, isDone = null, keywords = null, today = new Date(), deadlineWarningDays = 14, todoListSettings = null, skipEntry = null } = opts;
  // a keyword list (`WAITING|NEXT`, or `*` for every state) as org-todo-list takes it; without one, the states that are not done
  const wanted = keywords && /\S/.test(keywords) && keywords.trim() !== '*' ? new Set(keywords.split('|').map((/** @type {string} */ k) => k.trim()).filter(Boolean)) : null;
  const every = !!keywords && keywords.trim() === '*';
  const settings = todoListSettings || readTodoListSettings({});
  const todayN = dayNumberOf(today);
  /** @type {any[]} */ const items = [];
  /** @type {Set<any>} */ const belowSkipped = new Set(); // headings whose subtree the list does not enter

  for (const { documentId, doc } of docs) {
    const docCategory = getCategoryForDocument(doc, documentId);
    walkHeadings(doc, (/** @type {any} */ heading, /** @type {Doc['children']} */ ancestors) => {
      // a whole archived or commented tree is skipped, not only its top heading
      if (!includeArchived && [...ancestors, heading].some(isArchived)) return;
      if (!includeCommented && [...ancestors, heading].some(isCommentedHeading)) return;
      if (ancestors.some((a) => belowSkipped.has(a))) return;
      if (tagFilter && !tagFilter(heading.tags)) return;
      if (!heading.todo) return; // no TODO state at all -- not a task
      if (wanted ? !wanted.has(heading.todo) : !every && isDone && isDone(heading.todo)) return;
      if (skipEntry && skipEntry('todo', documentId, heading)) return; // org-agenda-skip-function
      if (!settings.sublevels) belowSkipped.add(heading); // org-agenda-todo-list-sublevels nil: one listed (or ignored) entry stands for its whole subtree
      if (ignoredForDates(entryText(heading), settings, todayN, deadlineWarningDays)) return;
      const own = [heading, ...[...ancestors].reverse()].map((h) => getPropertyCaseInsensitive(h, 'CATEGORY')).find((v) => typeof v === 'string' && v.trim());
      items.push({
        documentId,
        heading,
        todo: heading.todo,
        priority: heading.priority,
        tags: heading.tags,
        title: heading.title,
        ...(headlineTime(heading.title || '') ? { timeOfDay: /** @type {number} */ (headlineClock(heading, today)?.timeOfDay) } : {}), // the time sort key takes a time written in the headline
        category: own ? own.trim() : docCategory,
      });
    });
  }

  return items;
}

export {
  UNSAVED_DOCUMENT_ID,
  rangeView,
  itemEffortText,
  itemEffortMinutes,
  summarizeDayEffort,
  sortItemsByEffort,
  effortSortValue,
  filterItemsByEffort,
  limitItemsByEffort,
  applyAgendaEffortView,
  walkHeadings,
  entryTimestampText,
  getCategoryForDocument,
  buildAgendaItems,
  buildTaskList,
  itemsForDate,
  itemsInRange,
  groupByDay,
  dayView,
  weekView,
  monthView,
  parseRepeater,
  addInterval,
  expandRepeats,
  emacsAgendaOccurrences,
  delayToDays,
  startOfDay,
  endOfDay,
  startOfWeek,
  isContactsAnniversariesTrigger,
  parseContactsAnniversariesTrigger,
  collectContactsTriggers,
  contactEventFor,
  contactSpouse,
  formatContactEventTitle,
  defaultEventDescription,
  stripAgeFromFormat,
  ordinalYears,
  parseContactEvent,
  contactEventAge,
  expandContactEventOccurrences,
};
