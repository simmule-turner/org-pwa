/**
 * The events a calendar should hold, taken from what View > Agenda shows: the same items, the same titles, the same times, the same
 * contacts (org-contacts-anniversaries, with its FIELD and FORMAT, from org-contacts-files), the same exclusions (completed items,
 * archived and commented headings). The aim is that what reaches the calendar is what the agenda displays.
 *
 * The agenda is a VIEW, so three things in its items are not data and are dropped or reshaped here:
 *   - carried-forward items (an unfinished SCHEDULED or DEADLINE shown on every day up to today) and the early days of a deadline's
 *     warning period: one overdue item is 11 agenda items. Only an item on its own date is a real date (those carry no overdue count).
 *   - a repeating item is one agenda item per occurrence (a daily one is 209 in this window). A calendar wants ONE event with a
 *     repeat rule, so the occurrences are folded back into one, starting at the timestamp itself.
 *   - things that are not events at all: sunrise and weather lines, logbook entries. Only dated items are kept.
 * An item with no repeat rule becomes one event. Entries a repeat rule cannot describe (diary sexps, and birthdays and anniversaries,
 * whose title carries a different age each year) become one event per occurrence in the window, so each year's reads right.
 *
 * Ids are the ones the exporter makes (generateUid) wherever the kind is the same, so events a server already holds are updated
 * in place rather than replaced.
 */

import { buildAgendaItems, endOfDay, startOfDay } from './agenda.js';
import { buildVevent, eventDetails, generateUid, repeaterToRRule, titleWithoutTimestamps } from './export-icalendar.js';
import { delayToDays } from './agenda.js';
import { findTimestamps, parseDelay, parseOrgTimestamp } from './org-timestamp.js';
import { resolveTodoSequence } from './todo-cycle.js';

// What a calendar can hold. The agenda's other kinds (sunrise, weather, logbook ...) are not events.
const CALENDAR_KINDS = new Set(['scheduled', 'deadline', 'timestamp', 'sexp-timestamp', 'diary-sexp', 'anniversary']);
const REPEATING_KINDS = new Set(['scheduled', 'deadline', 'timestamp']);
const PER_OCCURRENCE_KINDS = new Set(['sexp-timestamp', 'diary-sexp', 'anniversary']);

/** How far the calendar reaches: a month back to six months ahead. The CalDAV mirror and the agenda export use the same window. */
export const DEFAULT_DAYS_BEFORE = 30;
export const DEFAULT_DAYS_AFTER = 180;

/** `{ start, end }` for the window around `today`. */
export function agendaWindow(today, daysBefore = DEFAULT_DAYS_BEFORE, daysAfter = DEFAULT_DAYS_AFTER) {
  return {
    start: startOfDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBefore)),
    end: endOfDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysAfter)),
  };
}

const sameMoment = (a, b) => a.getTime() === b.getTime();

/** The timestamp in the heading (a planning line, or one written in the title) that an agenda item came from, with its index among
 *  the title's timestamps (the exporter's own id includes it). null if it cannot be found. */
function sourceOf(item) {
  const { heading, kind } = item;
  if (kind === 'scheduled' || kind === 'deadline') {
    const raw = heading.planning && heading.planning[kind];
    const parsed = raw ? parseOrgTimestamp(raw) : null;
    return parsed ? { parsed, index: 0 } : null;
  }
  const stamps = findTimestamps(heading.title);
  const wanted = (t) => t.active && (item.repeater ? t.repeater === item.repeater && t.hasTime === item.hasTime : sameMoment(t.date, item.date));
  const index = stamps.findIndex(wanted);
  return index >= 0 ? { parsed: stamps[index], index } : null;
}

/**
 * @param {{ documentId: string, doc: object }[]} docs the open document and the loaded agenda files
 * @param {object} opts
 *   window        { start, end } the days to cover (required)
 *   today         the date to measure ages and "today" against
 *   birthdayProperty, contactsDocs   as for buildAgendaItems
 * @returns {{ uid: string, documentId: string, lines: string[] }[]}
 */
export function collectAgendaCalendarEvents(docs, opts = {}) {
  const { today = new Date(), window, birthdayProperty = 'BIRTHDAY', contactsDocs = null } = opts;
  const doneKeywords = new Set();
  for (const { doc } of docs) for (const keyword of resolveTodoSequence(doc).doneKeywords) doneKeywords.add(keyword);

  const items = buildAgendaItems(docs, {
    today,
    rangeStart: window.start,
    rangeEnd: window.end,
    birthdayProperty,
    contactsDocs,
    deadlineWarningDays: 0,
    todoFilter: (todo) => !doneKeywords.has(todo), // completed items are not on the agenda, so not in the calendar
    isDone: (todo) => doneKeywords.has(todo),
  });
  const real = items.filter((item) => CALENDAR_KINDS.has(item.kind) && !item.daysOverdue);
  real.sort((a, b) => a.date - b.date || String(a.title).localeCompare(String(b.title)));

  const events = [];
  const usedUids = new Set();
  const uniqueUid = (documentId, heading, kind, index, date) => {
    let uid = generateUid(documentId, heading, kind, index, date);
    for (let n = 2; usedUids.has(uid); n++) uid = generateUid(documentId, heading, kind, index, date).replace(/@org-pwa$/, `-${n}@org-pwa`);
    usedUids.add(uid);
    return uid;
  };
  const headingIds = new Map();
  const idOf = (heading) => {
    if (!headingIds.has(heading)) headingIds.set(heading, headingIds.size);
    return headingIds.get(heading);
  };

  const seenSeries = new Set();
  const perOccurrenceSeen = new Map();
  for (const item of real) {
    const { documentId, heading, kind } = item;

    if (PER_OCCURRENCE_KINDS.has(kind)) {
      const slot = `${documentId}\u0000${idOf(heading)}\u0000${kind}\u0000${item.field || ''}\u0000${item.date.toDateString()}`;
      const index = perOccurrenceSeen.get(slot) || 0;
      perOccurrenceSeen.set(slot, index + 1);
      // the stand-in heading keeps an :ID: out of it, so the id includes the day and the occurrence, never only the heading
      const uid = generateUid(documentId, { title: heading.title }, kind === 'anniversary' ? `anniversary-${String(item.field).toLowerCase()}` : kind, index, item.date);
      events.push({ uid, documentId, lines: buildVevent({ uid, summary: item.title, description: kind === 'anniversary' ? null : 'Diary', date: item.date, hasTime: false, rrule: null, alarmDaysBefore: 0, stamp: today }) });
      continue;
    }

    const source = sourceOf(item);
    const repeating = REPEATING_KINDS.has(kind) && item.repeater;
    if (repeating) {
      const key = `${documentId}\u0000${idOf(heading)}\u0000${kind}\u0000${item.repeater}\u0000${item.hasTime ? `${item.date.getHours()}:${item.date.getMinutes()}` : 'day'}`;
      if (seenSeries.has(key)) continue; // the later occurrences are the same event
      seenSeries.add(key);
    }
    const parsed = source ? source.parsed : { date: item.date, endDate: item.endDate, hasTime: item.hasTime, repeater: item.repeater, delay: null };
    const uid = uniqueUid(documentId, heading, kind, source ? source.index : 0, parsed.date);
    const details = eventDetails(heading);
    const delay = kind === 'deadline' && parsed.delay ? parseDelay(parsed.delay) : null;
    const label = kind === 'deadline' ? 'Deadline' : kind === 'scheduled' ? 'Scheduled' : null;
    events.push({
      uid,
      documentId,
      lines: buildVevent({
        uid,
        summary: kind === 'timestamp' ? titleWithoutTimestamps(heading.title) : heading.title,
        description: [label, details.body].filter(Boolean).join('\n') || null,
        date: parsed.date,
        endDate: parsed.endDate,
        hasTime: parsed.hasTime,
        rrule: repeating ? repeaterToRRule(item.repeater) : null,
        alarmDaysBefore: delay ? delayToDays(delay) : 0,
        categories: details.categories,
        location: details.location,
        stamp: today,
      }),
    });
  }
  return events;
}

/** The agenda as one .ics file, for Export > Calendar (.ics) > Agenda (as displayed): the same events the CalDAV mirror sends, in
 *  the same window. (The file and heading scopes of that export are a different job: every dated item, with no window.) */
export function exportAgendaToIcalendar(docs, opts = {}) {
  const today = opts.today || new Date();
  const events = collectAgendaCalendarEvents(docs, { ...opts, today, window: opts.window || agendaWindow(today) });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//org-pwa//org-pwa//EN', 'CALSCALE:GREGORIAN', ...events.flatMap((e) => e.lines), 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
