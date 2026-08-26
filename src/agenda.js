
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

import { isArchived } from './archive-model.js';
import { isCommentedHeading } from './comment-model.js';
import { parseOrgTimestamp, findTimestamps, parseDelay, dateKey, isSameDay } from './org-timestamp.js';
import { parseLogbookEntries } from './logbook.js';
import { findSexpTimestamps, evaluateSexpTimestamp, isTruthy } from './sexp-eval.js';
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
  isDiarySunriseLine,
  formatSunriseLine,
  isDiarySunsetLine,
  formatSunsetLine,
  isDiaryCivilDawnLine,
  formatCivilDawnLine,
  isDiaryCivilDuskLine,
  formatCivilDuskLine,
  isDiaryNauticalDawnLine,
  formatNauticalDawnLine,
  isDiaryNauticalDuskLine,
  formatNauticalDuskLine,
  isDiaryAstronomicalDawnLine,
  formatAstronomicalDawnLine,
  isDiaryAstronomicalDuskLine,
  formatAstronomicalDuskLine,
  isDiaryDayLengthLine,
  formatDayLengthLine,
  enumerateDays,
} from './diary-sexp.js';
import { isOrgWeatherLine, formatWeatherLine } from './org-weather.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const REPEATER_RE = /^([.+]{1,2})(\d+)([hdwmy])$/;

/** Parses a repeater string (e.g. "+1w", "++3d", ".+1m") into
 *  { mark, amount, unit }. `mark` is kept but not currently acted on —
 *  see expandRepeats' docs for why all three marks expand the same way
 *  here. Returns null for anything that doesn't match. */
function parseRepeater(raw) {
  if (!raw) return null;
  const m = REPEATER_RE.exec(raw);
  if (!m) return null;
  return { mark: m[1], amount: Number(m[2]), unit: m[3] };
}

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
    current = addInterval(current, amount, unit);
    iterations++;
  }
  return occurrences;
}

/** Converts a parsed delay ({amount, unit}) to an approximate day count,
 *  for the early-warning window calculation. Exact for h/d/w; m/y use a
 *  30/365-day approximation, an acceptable simplification since a delay
 *  is inherently a short-term "warn me ahead of time" concept in
 *  practice (a few days or weeks), not something that needs
 *  calendar-precise month lengths the way a repeater's actual occurrence
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
 * Every day in the item's "active display window", intersected with
 * [rangeStart, rangeEnd] — the window is [itemDate - earlyWarningDays,
 * max(itemDate, today)]:
 *   - the end covers "carry forward": real org keeps an incomplete
 *     SCHEDULED/DEADLINE on the agenda every day it's been overdue,
 *     right up through today (never past today, since we can't know
 *     whether it'll still be undone on a day that hasn't happened yet).
 *   - the start covers the delay/warning-period suffix (e.g. DEADLINE:
 *     <2026-01-10 Sat -3d>): real org starts showing it `earlyWarningDays`
 *     before the literal date, not just on the date itself. Defaults to
 *     0 (no early warning), so a plain SCHEDULED/DEADLINE with no delay
 *     behaves exactly as before.
 *
 * If `itemDate` is in the future relative to `today` and there's no
 * early-warning window reaching back to today yet, this just returns
 * that one day, same as a normal single occurrence.
 *
 * Intersecting with the caller's range (rather than generating the full
 * window and filtering afterward) is what keeps this cheap regardless of
 * how long something's been overdue: a task overdue for two years,
 * viewed in a single day's agenda, produces one date, not 730.
 */
function carryForwardOccurrences(itemDate, today, rangeStart, rangeEnd, earlyWarningDays = 0) {
  const itemDay = startOfDay(itemDate);
  const todayDay = startOfDay(today);
  const carryEnd = itemDay <= todayDay ? todayDay : itemDay;
  const earlyStart = new Date(itemDay.getFullYear(), itemDay.getMonth(), itemDay.getDate() - earlyWarningDays);

  let windowStart = earlyStart;
  let windowEnd = carryEnd;
  if (rangeStart) {
    const rangeStartDay = startOfDay(rangeStart);
    if (rangeStartDay > windowStart) windowStart = rangeStartDay;
  }
  if (rangeEnd) {
    const rangeEndDay = startOfDay(rangeEnd);
    if (rangeEndDay < windowEnd) windowEnd = rangeEndDay;
  }
  if (windowStart > windowEnd) return [];

  const days = [];
  let current = new Date(windowStart);
  const MAX_DAYS = 10000; // safety valve, matching expandRepeats' precedent
  let count = 0;
  while (current <= windowEnd && count < MAX_DAYS) {
    days.push(new Date(current));
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
    count++;
  }
  return days;
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
const CONTACTS_TRIGGER_RE = /^%%\(org-contacts-anniversaries\)\s*$/;
const EVENT_PROPERTY_RE = /^(\d{4}|nil)-(\d{2})-(\d{2})\s+(.+)$/;

/** True if `line` is the %%(org-contacts-anniversaries) trigger,
 *  activating the whole scan below. The line's own content beyond this
 *  is not itself read as an event — it's a switch, not a contact. */
function isContactsAnniversariesTrigger(line) {
  return CONTACTS_TRIGGER_RE.test(line.trim());
}

/** Parses a birthday/anniversary property value: "YYYY-MM-DD
 *  description text", or "nil-MM-DD description text" when the year is
 *  genuinely unknown (age then can't be computed — see
 *  contactEventAge below). Returns { year, month, day, description } or
 *  null if the value doesn't match: an out-of-range month/day, or no
 *  description text at all (a bare date with nothing to label it isn't
 *  something this can build a sensible "Name: ___ (age)" line from). */
function parseContactEvent(value) {
  const m = EVENT_PROPERTY_RE.exec(String(value).trim());
  if (!m) return null;
  const year = m[1] === 'nil' ? null : Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day, description: m[4].trim() };
}

/** Elapsed years as of `occurrenceDate` for an event whose stored year
 *  is `year`. null when `year` is null (unknown) — formatted as "(??)"
 *  by formatContactEventLine below, per what was actually asked for,
 *  rather than a numeric sentinel a caller could accidentally display
 *  as a real age. */
function contactEventAge(year, occurrenceDate) {
  if (year === null) return null;
  return occurrenceDate.getFullYear() - year;
}

/** "Name: Description (36)", or "Name: Description (??)" when the age
 *  is unknown — the fixed display format this feature produces, not
 *  something the file author writes text for (unlike the deprecated
 *  org-anniversary sexp's own arbitrary-text-with-%d approach). */
function formatContactEventLine(headingTitle, description, age) {
  return `${headingTitle}: ${description} (${age === null ? '??' : age})`;
}

/** Matches formatContactEventLine's own style: a short, readable
 *  one-line summary of a single LOGBOOK entry for agenda display. A
 *  state-change entry shows the transition itself ("from X" only when
 *  there was a previous state, matching how the LOGBOOK line itself
 *  omits it too); a bare note (not tied to any state change) is
 *  labeled plainly, since there's no "->" transition to describe. */
function formatLogbookEntryLine(headingTitle, entry) {
  if (entry.type === 'state') {
    const from = entry.oldState ? `${entry.oldState} \u2192 ` : '';
    return `${headingTitle}: ${from}${entry.newState}`;
  }
  return `${headingTitle}: note`;
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
 */
function walkHeadings(doc, visit) {
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
function buildAgendaItems(docs, opts = {}) {
  const {
    includeArchived = false,
    includeCommented = false,
    includeLogbook = false,
    todoFilter = null,
    tagFilter = null,
    rangeStart = null,
    rangeEnd = null,
    isDone = null,
    today = new Date(),
    birthdayProperty = 'BIRTHDAY',
    deadlineWarningDays = 14,
    scheduledDelayDays = 0,
    calendarLatitude = 35.994,
    calendarLongitude = -78.8986,
    solarAmpm = false,
    solarHideLabel = false,
    weatherData = null,
    orgWeatherFormat = 'Weather: %desc, %tcur(%tmin-%tmax)%tu, %p%pu, %h%hu, %s%su',
    orgWeatherTemperatureUnit = '\u00b0F',
    orgWeatherSpeedUnit = 'mph',
  } = opts;
  const items = [];

  function addItem(documentId, heading, kind, parsed, headingIsDone) {
    const base = {
      documentId,
      heading,
      kind,
      hasTime: parsed.hasTime,
      repeater: parsed.repeater,
      todo: heading.todo,
      priority: heading.priority,
      tags: heading.tags,
      title: heading.title,
    };
    const repeater = parsed.repeater ? parseRepeater(parsed.repeater) : null;

    if (repeater && rangeStart && rangeEnd) {
      for (const occurrenceDate of expandRepeats(parsed.date, repeater, rangeStart, rangeEnd)) {
        items.push({ ...base, date: occurrenceDate, daysOverdue: 0 });
      }
      return;
    }

    const carryForwardEligible =
      !repeater && isDone !== null && !headingIsDone && (kind === 'scheduled' || kind === 'deadline');
    if (carryForwardEligible && rangeStart && rangeEnd) {
      const delay = parsed.delay ? parseDelay(parsed.delay) : null;
      const delayDays = delay ? delayToDays(delay) : 0;
      // DEADLINE's own "-Nd" is an early warning (shows N days BEFORE
      // its date); SCHEDULED's own "-Nd" is the opposite -- a delay
      // (shows N days AFTER its date, not at all before then) --
      // confirmed directly against the Org manual's own wording ("the
      // task is still scheduled on the 25th but will appear two days
      // later"). Implemented as two different inputs to the very same
      // carry-forward window function: DEADLINE subtracts from the
      // window's own start; SCHEDULED shifts the effective "item
      // date" itself forward, with no separate early-warning offset
      // on top of that. Each side falls back to its own file-wide
      // default (deadlineWarningDays / scheduledDelayDays -- see
      // local-variables.js's own getDeadlineWarningDays/
      // getScheduledDelayDays) only when the heading itself has no
      // explicit "-Nd" cookie of its own; an explicit per-heading
      // cookie always wins over either default.
      const earlyWarningDays = kind === 'deadline' ? (delay ? delayDays : deadlineWarningDays) : 0;
      const effectiveScheduledDelayDays = kind === 'scheduled' ? (delay ? delayDays : scheduledDelayDays) : 0;
      const effectiveDate = kind === 'scheduled' ? addDays(parsed.date, effectiveScheduledDelayDays) : parsed.date;
      for (const occurrenceDate of carryForwardOccurrences(effectiveDate, today, rangeStart, rangeEnd, earlyWarningDays)) {
        const daysOverdue = Math.round((startOfDay(occurrenceDate) - startOfDay(parsed.date)) / MS_PER_DAY);
        items.push({ ...base, date: occurrenceDate, daysOverdue });
      }
      return;
    }

    if (rangeStart && rangeEnd) {
      // No repeater, no carry-forward (a plain timestamp, a done
      // heading, or carry-forward wasn't requested via isDone): a single
      // literal-date occurrence, filtered by range if one was given.
      // This used to be unconditional — every non-repeating item was
      // added regardless of what range was actually requested, relying
      // entirely on dayView/weekView/monthView's own later re-filtering
      // to correct it before anything reached the screen. That's
      // backwards: a function called with a range should itself honor
      // the range it was given.
      if (parsed.date >= rangeStart && parsed.date <= rangeEnd) {
        items.push({ ...base, date: parsed.date, daysOverdue: 0 });
      }
    } else {
      items.push({ ...base, date: parsed.date, daysOverdue: 0 });
    }
  }

  // org-contacts-anniversaries is active for this call if the trigger
  // line is present ANYWHERE across all docs, not scoped to any one
  // heading or file — checked upfront, once, rather than re-scanning
  // per heading in the main loop below.
  let contactsAnniversariesActive = false;
  for (const { doc } of docs) {
    walkHeadings(doc, (heading) => {
      if (contactsAnniversariesActive) return;
      for (const line of heading.bodyLines || []) {
        if (isContactsAnniversariesTrigger(line)) {
          contactsAnniversariesActive = true;
          break;
        }
      }
    });
  }

  for (const { documentId, doc } of docs) {
    walkHeadings(doc, (heading) => {
      if (!includeArchived && isArchived(heading)) return;
      if (!includeCommented && isCommentedHeading(heading)) return;
      if (tagFilter && !tagFilter(heading.tags)) return;

      // LOGBOOK items are deliberately NOT gated by todoFilter -- Log
      // mode's whole purpose is showing a heading's history even when
      // it's now DONE, which is exactly what the main agenda call
      // site's own todoFilter (excluding done-state headings from the
      // normal, non-log view) would otherwise wrongly suppress here too.
      if (includeLogbook && heading.logbookLines && heading.logbookLines.length) {
        for (const entry of parseLogbookEntries(heading.logbookLines)) {
          if (entry.type !== 'state' && entry.type !== 'note') continue; // CLOCK entries excluded -- clocking isn't built yet, and a start/end range doesn't fit this "one item, one date" model
          const parsed = parseOrgTimestamp(entry.timestamp);
          if (!parsed) continue;
          if (rangeStart && rangeEnd && (parsed.date < rangeStart || parsed.date > rangeEnd)) continue;
          items.push({
            documentId,
            heading,
            kind: 'logbook',
            hasTime: parsed.hasTime,
            repeater: null,
            todo: heading.todo,
            priority: heading.priority,
            tags: heading.tags,
            title: formatLogbookEntryLine(heading.title, entry),
            logNote: entry.note || null,
            date: parsed.date,
            daysOverdue: 0,
          });
        }
      }

      if (todoFilter && !todoFilter(heading.todo)) return;

      const headingIsDone = isDone ? isDone(heading.todo) : false;

      let hasPlanning = false;
      for (const kind of ['scheduled', 'deadline']) {
        const raw = heading.planning && heading.planning[kind];
        if (!raw) continue;
        const parsed = parseOrgTimestamp(raw);
        if (!parsed) continue;
        hasPlanning = true;
        addItem(documentId, heading, kind, parsed, headingIsDone);
      }

      // Plain timestamps written directly in the heading title — a
      // separate, genuine org convention distinct from SCHEDULED/DEADLINE
      // (the standard way to track something like a recurring birthday
      // right on its own heading line: "Jennifer <1989-11-02 Thu +1y>").
      // Scoped deliberately to the title only, not body text — scanning
      // body text too would risk pulling in unrelated dates mentioned in
      // ordinary prose elsewhere in a journal-heavy file, which titles
      // don't really have the same risk of. Only *active* timestamps
      // count, matching real org's own rule that an inactive [timestamp]
      // is deliberately excluded from the agenda (a dated record, not a
      // reminder). Skipped when the heading already has its own
      // SCHEDULED/DEADLINE, so one heading doesn't produce a confusing
      // double entry for what would usually be the same underlying date.
      // Never carries forward, unlike SCHEDULED/DEADLINE above — a plain
      // timestamp is explicitly NOT an "intend to do this" marker.
      if (!hasPlanning) {
        for (const parsed of findTimestamps(heading.title)) {
          if (!parsed.active) continue;
          addItem(documentId, heading, 'timestamp', parsed, true); // headingIsDone: true short-circuits carry-forward
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
          for (const day of enumerateDays(rangeStart, rangeEnd)) {
            const result = evaluateSexpTimestamp(sexpTs.expr, {
              candidateDate: day,
              today,
              calendarLatitude,
              calendarLongitude,
              solarAmpm,
              solarHideLabel,
              weatherData,
              orgWeatherFormat,
              orgWeatherTemperatureUnit,
              orgWeatherSpeedUnit,
            });
            if (!isTruthy(result)) continue;
            const displayTitle =
              typeof result === 'string' ? (cleanTitle ? `${cleanTitle}: ${result}` : result) : cleanTitle || '(untitled)';
            items.push({
              documentId,
              heading,
              kind: 'sexp-timestamp',
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
        }
      }

      // org-contacts-anniversaries: only checked at all when the
      // trigger was found somewhere (see contactsAnniversariesActive
      // above) — a heading carrying the configured property means
      // nothing on its own otherwise, since the property might simply
      // be there for other purposes (vCard export, contact lookup) with
      // no intention of it appearing in the agenda.
      if (contactsAnniversariesActive) {
        const foundKey = (heading.propertyOrder || []).find(
          (k) => k.toLowerCase() === birthdayProperty.toLowerCase()
        );
        const rawEvent = foundKey ? heading.properties[foundKey] : undefined;
        const event = rawEvent ? parseContactEvent(rawEvent) : null;
        if (event) {
          const occurrences = expandContactEventOccurrences(event.month, event.day, rangeStart, rangeEnd, today);
          for (const occurrenceDate of occurrences) {
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
              title: formatContactEventLine(heading.title, event.description, age),
              age,
              date: occurrenceDate,
              daysOverdue: 0,
            });
          }
        }
      }

      // The fourteen diary-sexp forms below (org-anniversary, org-cyclic,
      // org-block, diary-float, diary-sunrise, diary-sunset,
      // diary-civil-dawn, diary-civil-dusk, diary-nautical-dawn,
      // diary-nautical-dusk, diary-astronomical-dawn, diary-astronomical-dusk,
      // diary-day-length, org-weather) are each self-contained, per-line
      // sexps -- every line in this heading's own body is checked against
      // each pattern directly.
      if (rangeStart && rangeEnd) {
        for (const line of heading.bodyLines || []) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('%%(')) continue; // fast skip -- every one of these five forms starts this way

          const pushDiarySexpItem = (occurrenceDate, title) => {
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
            });
          };

          const anniv = parseOrgAnniversaryLine(trimmed);
          if (anniv) {
            for (const occ of expandOrgAnniversaryOccurrences(anniv.month, anniv.day, rangeStart, rangeEnd)) {
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

          if (isDiarySunriseLine(trimmed)) {
            for (const day of enumerateDays(rangeStart, rangeEnd)) {
              items.push({
                documentId,
                heading,
                kind: 'sunrise',
                hasTime: false,
                repeater: null,
                todo: heading.todo,
                priority: heading.priority,
                tags: heading.tags,
                title: formatSunriseLine(day, calendarLatitude, calendarLongitude, undefined, solarAmpm, solarHideLabel),
                date: day,
                daysOverdue: 0,
              });
            }
          }

          if (isDiarySunsetLine(trimmed)) {
            for (const day of enumerateDays(rangeStart, rangeEnd)) {
              items.push({
                documentId,
                heading,
                kind: 'sunset',
                hasTime: false,
                repeater: null,
                todo: heading.todo,
                priority: heading.priority,
                tags: heading.tags,
                title: formatSunsetLine(day, calendarLatitude, calendarLongitude, undefined, solarAmpm, solarHideLabel),
                date: day,
                daysOverdue: 0,
              });
            }
          }

          if (isDiaryCivilDawnLine(trimmed)) {
            for (const day of enumerateDays(rangeStart, rangeEnd)) {
              items.push({
                documentId,
                heading,
                kind: 'civil-dawn',
                hasTime: false,
                repeater: null,
                todo: heading.todo,
                priority: heading.priority,
                tags: heading.tags,
                title: formatCivilDawnLine(day, calendarLatitude, calendarLongitude, undefined, solarAmpm, solarHideLabel),
                date: day,
                daysOverdue: 0,
              });
            }
          }

          if (isDiaryCivilDuskLine(trimmed)) {
            for (const day of enumerateDays(rangeStart, rangeEnd)) {
              items.push({
                documentId,
                heading,
                kind: 'civil-dusk',
                hasTime: false,
                repeater: null,
                todo: heading.todo,
                priority: heading.priority,
                tags: heading.tags,
                title: formatCivilDuskLine(day, calendarLatitude, calendarLongitude, undefined, solarAmpm, solarHideLabel),
                date: day,
                daysOverdue: 0,
              });
            }
          }

          if (isDiaryNauticalDawnLine(trimmed)) {
            for (const day of enumerateDays(rangeStart, rangeEnd)) {
              items.push({
                documentId,
                heading,
                kind: 'nautical-dawn',
                hasTime: false,
                repeater: null,
                todo: heading.todo,
                priority: heading.priority,
                tags: heading.tags,
                title: formatNauticalDawnLine(day, calendarLatitude, calendarLongitude, undefined, solarAmpm, solarHideLabel),
                date: day,
                daysOverdue: 0,
              });
            }
          }

          if (isDiaryNauticalDuskLine(trimmed)) {
            for (const day of enumerateDays(rangeStart, rangeEnd)) {
              items.push({
                documentId,
                heading,
                kind: 'nautical-dusk',
                hasTime: false,
                repeater: null,
                todo: heading.todo,
                priority: heading.priority,
                tags: heading.tags,
                title: formatNauticalDuskLine(day, calendarLatitude, calendarLongitude, undefined, solarAmpm, solarHideLabel),
                date: day,
                daysOverdue: 0,
              });
            }
          }

          if (isDiaryAstronomicalDawnLine(trimmed)) {
            for (const day of enumerateDays(rangeStart, rangeEnd)) {
              items.push({
                documentId,
                heading,
                kind: 'astronomical-dawn',
                hasTime: false,
                repeater: null,
                todo: heading.todo,
                priority: heading.priority,
                tags: heading.tags,
                title: formatAstronomicalDawnLine(day, calendarLatitude, calendarLongitude, undefined, solarAmpm, solarHideLabel),
                date: day,
                daysOverdue: 0,
              });
            }
          }

          if (isDiaryAstronomicalDuskLine(trimmed)) {
            for (const day of enumerateDays(rangeStart, rangeEnd)) {
              items.push({
                documentId,
                heading,
                kind: 'astronomical-dusk',
                hasTime: false,
                repeater: null,
                todo: heading.todo,
                priority: heading.priority,
                tags: heading.tags,
                title: formatAstronomicalDuskLine(day, calendarLatitude, calendarLongitude, undefined, solarAmpm, solarHideLabel),
                date: day,
                daysOverdue: 0,
              });
            }
          }

          if (isDiaryDayLengthLine(trimmed)) {
            for (const day of enumerateDays(rangeStart, rangeEnd)) {
              items.push({
                documentId,
                heading,
                kind: 'day-length',
                hasTime: false,
                repeater: null,
                todo: heading.todo,
                priority: heading.priority,
                tags: heading.tags,
                title: formatDayLengthLine(day, calendarLatitude, calendarLongitude, solarHideLabel),
                date: day,
                daysOverdue: 0,
              });
            }
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
              title: formatWeatherLine(orgWeatherFormat, weatherData, orgWeatherTemperatureUnit, orgWeatherSpeedUnit),
              date: today,
              daysOverdue: 0,
            });
          }
        }
      }
    });
  }

  items.sort((a, b) => a.date - b.date);
  return items;
}

/** Items falling on the same calendar day as `date` (default: today). */
function itemsForDate(items, date = new Date()) {
  return items.filter((item) => isSameDay(item.date, date));
}

/** Items within [start, end], inclusive of the days start/end fall on. */
function itemsInRange(items, start, end) {
  const startKey = dateKey(start);
  const endKey = dateKey(end);
  return items.filter((item) => {
    const k = dateKey(item.date);
    return k >= startKey && k <= endKey;
  });
}

/** Groups items by calendar day, returning entries sorted chronologically:
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
 *  can treat uniformly regardless of which view is active. */
function dayView(items, date = new Date()) {
  return groupByDay(itemsForDate(items, date));
}

/** Midnight (00:00:00.000) of `date`'s calendar day. */
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** `date` shifted forward (or backward, for a negative `days`) by
 *  `days` whole calendar days -- month/year boundaries handled
 *  correctly by JS's own Date arithmetic (setting a day-of-month
 *  value past the end of its month rolls over into the next one). */
function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

/** The last instant (23:59:59.999) of `date`'s calendar day. */
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
 */
function weekView(items, anchorDate = new Date(), startOnWeekday = 1) {
  const start = startOfWeek(anchorDate, startOnWeekday);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return groupByDay(itemsInRange(items, start, end));
}

/** A month view: every day in `date`'s calendar month, from the 1st
 *  through the actual last day of that month (28-31, handled correctly
 *  regardless of month length or leap years via the "day 0 of next
 *  month" trick). */
function monthView(items, date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return groupByDay(itemsInRange(items, start, end));
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
 */
function buildTaskList(docs, opts = {}) {
  const { includeArchived = false, includeCommented = false, tagFilter = null, isDone = null } = opts;
  const items = [];

  for (const { documentId, doc } of docs) {
    walkHeadings(doc, (heading) => {
      if (!includeArchived && isArchived(heading)) return;
      if (!includeCommented && isCommentedHeading(heading)) return;
      if (tagFilter && !tagFilter(heading.tags)) return;
      if (!heading.todo) return; // no TODO state at all -- not a task
      if (isDone && isDone(heading.todo)) return;
      items.push({
        documentId,
        heading,
        todo: heading.todo,
        priority: heading.priority,
        tags: heading.tags,
        title: heading.title,
      });
    });
  }

  return items;
}

export {
  walkHeadings,
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
  carryForwardOccurrences,
  delayToDays,
  startOfDay,
  endOfDay,
  startOfWeek,
  isContactsAnniversariesTrigger,
  parseContactEvent,
  contactEventAge,
  formatContactEventLine,
  expandContactEventOccurrences,
};
