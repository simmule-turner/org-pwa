
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
 * timestamp found) across `docs` — an array of { documentId, doc }, e.g.
 * straight from document-store's openAllDocuments().
 *
 * Options:
 *   includeArchived (default false) — include archived subtrees/items
 *   todoFilter(keyword) -> boolean — keep only headings whose todo passes
 *   tagFilter(tags) -> boolean — keep only headings whose tags pass
 */
function buildAgendaItems(docs, opts = {}) {
  const { includeArchived = false, todoFilter = null, tagFilter = null } = opts;
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

        items.push({
          documentId,
          heading,
          kind,
          date: parsed.date,
          hasTime: parsed.hasTime,
          repeater: parsed.repeater,
          todo: heading.todo,
          priority: heading.priority,
          tags: heading.tags,
          title: heading.title,
        });
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

/** A week view starting from `start`'s calendar day, 7 days inclusive. */
function weekView(items, start = new Date()) {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return groupByDay(itemsInRange(items, start, end));
}

export {
  walkHeadings,
  buildAgendaItems,
  itemsForDate,
  itemsInRange,
  groupByDay,
  weekView,
};
