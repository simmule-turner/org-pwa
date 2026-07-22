
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
import { parseOrgTimestamp, dateKey, isSameDay } from './org-timestamp.js';

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
 * Builds the flat list of agenda items (one per SCHEDULED/DEADLINE
 * timestamp found, or one per occurrence for a repeating timestamp when
 * a range is given — see below) across `docs` — an array of
 * { documentId, doc }, e.g. straight from document-store's
 * openAllDocuments().
 *
 * Options:
 *   includeArchived (default false) — include archived subtrees/items
 *   todoFilter(keyword) -> boolean — keep only headings whose todo passes
 *   tagFilter(tags) -> boolean — keep only headings whose tags pass
 *   rangeStart, rangeEnd (both optional, both required together) — when
 *     given, a timestamp with a repeater expands into every occurrence
 *     within [rangeStart, rangeEnd] instead of just its literal stored
 *     date. Without a range, a repeating timestamp still only produces
 *     its single literal-date item (unbounded expansion has no natural
 *     stopping point), matching the original pre-repeater-support
 *     behavior exactly — existing callers that don't pass a range are
 *     unaffected.
 */
function buildAgendaItems(docs, opts = {}) {
  const { includeArchived = false, todoFilter = null, tagFilter = null, rangeStart = null, rangeEnd = null } = opts;
  const items = [];

  for (const { documentId, doc } of docs) {
    walkHeadings(doc, (heading) => {
      if (!includeArchived && isArchived(heading)) return;
      if (todoFilter && !todoFilter(heading.todo)) return;
      if (tagFilter && !tagFilter(heading.tags)) return;

      for (const kind of ['scheduled', 'deadline']) {
        const raw = heading.planning && heading.planning[kind];
        if (!raw) continue;
        const parsed = parseOrgTimestamp(raw);
        if (!parsed) continue;

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
            items.push({ ...base, date: occurrenceDate });
          }
        } else {
          items.push({ ...base, date: parsed.date });
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

/** A week view starting from `start`'s calendar day, 7 days inclusive. */
function weekView(items, start = new Date()) {
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
};
