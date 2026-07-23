
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
import { parseOrgTimestamp, findTimestamps, dateKey, isSameDay } from './org-timestamp.js';

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

/**
 * Every day from `itemDate` through `today` (inclusive), intersected
 * with [rangeStart, rangeEnd] — the actual "carry forward" window for an
 * incomplete SCHEDULED/DEADLINE item: real org keeps it on the agenda
 * every day it's been overdue, right up through today (never past today,
 * since we can't know whether it'll still be undone on a day that
 * hasn't happened yet). If `itemDate` is in the future relative to
 * `today`, there's nothing to carry forward yet — it just returns that
 * one day, same as a normal single occurrence.
 *
 * Intersecting with the caller's range (rather than generating the full
 * carry-forward window and filtering afterward) is what keeps this cheap
 * regardless of how long something's been overdue: a task overdue for
 * two years, viewed in a single day's agenda, produces one date, not 730.
 */
function carryForwardOccurrences(itemDate, today, rangeStart, rangeEnd) {
  const itemDay = startOfDay(itemDate);
  const todayDay = startOfDay(today);
  const carryEnd = itemDay <= todayDay ? todayDay : itemDay;

  let windowStart = itemDay;
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
 */
function buildAgendaItems(docs, opts = {}) {
  const {
    includeArchived = false,
    todoFilter = null,
    tagFilter = null,
    rangeStart = null,
    rangeEnd = null,
    isDone = null,
    today = new Date(),
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
      for (const occurrenceDate of carryForwardOccurrences(parsed.date, today, rangeStart, rangeEnd)) {
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

  for (const { documentId, doc } of docs) {
    walkHeadings(doc, (heading) => {
      if (!includeArchived && isArchived(heading)) return;
      if (todoFilter && !todoFilter(heading.todo)) return;
      if (tagFilter && !tagFilter(heading.tags)) return;

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

export {
  walkHeadings,
  buildAgendaItems,
  itemsForDate,
  itemsInRange,
  groupByDay,
  dayView,
  weekView,
  monthView,
  parseRepeater,
  expandRepeats,
  carryForwardOccurrences,
  startOfDay,
  endOfDay,
  startOfWeek,
};
