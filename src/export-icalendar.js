/**
 * Exports every dated item across a set of documents (SCHEDULED,
 * DEADLINE, a plain active timestamp in a heading's title, and
 * org-contacts-anniversaries) as a standard iCalendar (RFC 5545) .ics
 * file -- one VEVENT per source item, with an RRULE for recurrence
 * (repeaters, and org-contacts-anniversaries' own yearly recurrence)
 * rather than pre-expanded individual occurrences the way the agenda
 * view itself produces for display. That distinction matters here:
 * RRULE-based recurrence is what every real calendar app actually
 * expects and expands on its own, and exporting dozens of separate
 * VEVENTs for a single weekly-repeating item would be both wrong and
 * bloated. Deliberately reuses agenda.js's own timestamp-parsing and
 * exclusion logic (walkHeadings, parseRepeater, org-contacts-anniversaries
 * detection, parseOrgTimestamp) rather than re-deriving any of it, so
 * this and the agenda view can never quietly disagree about which
 * items count or how a repeater/date is interpreted.
 *
 * Everything becomes a VEVENT, not a VTODO -- deliberately: VTODO
 * support varies a lot across real calendar apps (some don't display
 * it at all), while every calendar app displays VEVENT, and most
 * people reaching for this want to see their org deadlines/schedules
 * alongside everything else on their actual calendar, not filed into a
 * separate "tasks" UI that may not even exist in whatever app they're
 * importing into.
 *
 * Matches the agenda view's own default exclusions (archived headings,
 * commented headings, completed items) for consistency -- an export
 * that silently disagreed with what the agenda itself shows would be
 * more confusing than useful.
 */

import { walkHeadings, parseRepeater, parseContactsAnniversariesTrigger, contactEventFor, contactSpouse, formatContactEventTitle, defaultEventDescription, delayToDays } from './agenda.js';
import { parseOrgTimestamp, findTimestamps, parseDelay } from './org-timestamp.js';
import { isArchived, getProperty } from './archive-model.js';
import { isCommentedHeading } from './comment-model.js';
import { resolveTodoSequence } from './todo-cycle.js';

// ---- RRULE ----------------------------------------------------------------

const UNIT_TO_FREQ = { h: 'HOURLY', d: 'DAILY', w: 'WEEKLY', m: 'MONTHLY', y: 'YEARLY' };

/** Converts an org repeater string ("+1w", "++3d", ".+1m") into an
 *  RFC 5545 RRULE value. All three repeater marks (+, ++, .+) expand
 *  identically here, matching this app's own agenda.js -- see that
 *  module's own expandRepeats docs for why: a static, one-time export
 *  has no notion of "when this was last actually marked done" to drive
 *  the marks' differing real catch-up semantics, the same reasoning
 *  the live agenda view itself already applies. */
export function repeaterToRRule(repeaterRaw) {
  const r = parseRepeater(repeaterRaw);
  if (!r) return null;
  const freq = UNIT_TO_FREQ[r.unit];
  if (!freq) return null; // shouldn't happen given parseRepeater's own validation, but never emit a malformed RRULE
  return `FREQ=${freq};INTERVAL=${r.amount}`;
}

// ---- date/time formatting ---------------------------------------------

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatIcsDate(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

/** Floating local time (no trailing "Z", no TZID) -- deliberately: org
 *  timestamps themselves carry no explicit timezone, they're wall-clock
 *  times in whatever zone the file's author was in, so floating time is
 *  the most faithful mapping available rather than guessing at a zone
 *  that was never actually recorded. */
function formatIcsDateTime(date) {
  return `${formatIcsDate(date)}T${pad2(date.getHours())}${pad2(date.getMinutes())}00`;
}

/** DTSTAMP specifically must always be real UTC per RFC 5545 -- unlike
 *  DTSTART's floating-time treatment above, this field has no "local"
 *  form; it records when the file was actually generated, not a wall-clock
 *  appointment time. */
function formatIcsDateTimeUtc(date) {
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
  );
}

// ---- text escaping (RFC 5545 3.3.11) -----------------------------------

function escapeIcsText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** RFC 5545 3.1 requires content lines folded at 75 octets, each
 *  continuation line starting with a single space -- an unfolded long
 *  line is technically non-conformant, and some real calendar clients
 *  (Outlook among them) are known to reject or mis-parse one. */
export function foldLine(line) {
  if (line.length <= 75) return line;
  const parts = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = ' ' + rest.slice(75);
  }
  parts.push(rest);
  return parts.join('\r\n');
}

/** A deterministic UID (not random/counter-based), so re-exporting the
 *  same file later produces the SAME uid for the same underlying item
 *  -- letting a calendar app recognize "this is an update to the event
 *  I already have" on re-import rather than creating a duplicate every
 *  time. Uses the heading's own :ID: property if it has one (matching
 *  real org's own ox-icalendar.el preference), else a stable string
 *  built from the document, heading title, and item kind/index --
 *  sanitized to a safe character set, since a UID must not contain
 *  control characters, semicolons, or line breaks. */
export function generateUid(documentId, heading, kind, index, date) {
  const existingId = getProperty(heading, 'ID');
  const base = existingId ? existingId : `${documentId || 'doc'}-${heading.title}-${kind}-${index}-${formatIcsDate(date)}`;
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '-');
  return `${safe}@org-pwa`;
}

// ---- VEVENT building -----------------------------------------------------

export function buildVevent({ uid, summary, description, date, hasTime, rrule, alarmDaysBefore, stamp, endDate = null, categories = null, location = null }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDateTimeUtc(stamp)}`,
    hasTime ? `DTSTART:${formatIcsDateTime(date)}` : `DTSTART;VALUE=DATE:${formatIcsDate(date)}`,
  ];
  if (endDate && hasTime && endDate > date) lines.push(`DTEND:${formatIcsDateTime(endDate)}`); // a time range (09:00-10:00) ends when it says
  lines.push(`SUMMARY:${escapeIcsText(summary)}`);
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
  if (categories && categories.length) lines.push(`CATEGORIES:${categories.map(escapeIcsText).join(',')}`);
  if (rrule) lines.push(`RRULE:${rrule}`);
  if (alarmDaysBefore) {
    // A DEADLINE's own delay/warning-period suffix (real org syntax,
    // e.g. "-3d") becomes a VALARM here -- preserving the actual intent
    // behind that syntax (an early reminder) rather than silently
    // dropping it just because .ics has no direct "warning period on a
    // date" concept of its own the way org's DEADLINE does.
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(summary)}`,
      `TRIGGER:-P${alarmDaysBefore}D`,
      'END:VALARM'
    );
  }
  lines.push('END:VEVENT');
  return lines.map(foldLine);
}

const BODY_LIMIT = 400;

/** What a heading adds to its event beyond the title and the time: its :LOCATION: property, its tags (as categories), and the start
 *  of its body text (at most 400 characters, ended with an ellipsis if cut, and without diary-sexp lines, which are not text for
 *  a person to read). */
export function eventDetails(heading) {
  const locationKey = (heading.propertyOrder || []).find((k) => k.toLowerCase() === 'location');
  const location = locationKey ? String(heading.properties[locationKey] || '').trim() : '';
  let body = (heading.bodyLines || []).filter((line) => !line.trim().startsWith('%%(')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (body.length > BODY_LIMIT) body = body.slice(0, BODY_LIMIT - 1).trimEnd() + '\u2026';
  return { location: location || null, categories: (heading.tags || []).filter(Boolean), body: body || null };
}

/** `heading.title` without the active timestamps written in it ("Dentist <2026-10-20 Tue 09:00>" -> "Dentist"): the event's own
 *  start already says when. Falls back to the whole title if nothing else is left. */
export function titleWithoutTimestamps(title) {
  let text = title;
  for (const ts of findTimestamps(title)) text = text.replace(ts.raw, '');
  text = text.replace(/\s+/g, ' ').trim();
  return text || title;
}

/**
 * Exports every dated item across `docs` (an array of `{ documentId,
 * doc }` pairs, matching agenda.js's own buildAgendaItems input shape)
 * to a complete .ics file string. `opts.today` controls DTSTAMP's
 * "generated at" timestamp (defaults to now) -- exposed for
 * deterministic testing, the same convention buildAgendaItems itself
 * already uses for its own `today` option.
 */
export function exportToIcalendar(docs, opts = {}) {
  const events = collectCalendarEvents(docs, opts);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//org-pwa//org-pwa//EN', 'CALSCALE:GREGORIAN', ...events.flatMap((e) => e.lines), 'END:VCALENDAR'];
  return lines.join('\r\n') + '\r\n';
}

/**
 * The dated items of `docs` as separate events, `[{ uid, documentId, lines }]` (`lines` is one folded VEVENT, and
 * `documentId` is the file it came from). The .ics export
 * above joins them into one file; the CalDAV mirror (calendar-mirror.js) needs them one by one, because a calendar
 * server stores one object per event. Options beyond the export's own:
 *   includeDone -- keep completed items (the export leaves them out, as the agenda does)
 *   window      -- `{ start, end }`: a one-off item is kept only if its date falls inside it. A repeating item has no
 *                  end, so it is kept whenever it has started by `window.end`. Birthdays are always kept.
 * A heading with an :ID: property would give its SCHEDULED and its DEADLINE the same UID, one overwriting the other
 * in any store that keys by UID; the first keeps the plain id (so earlier exports still match) and later ones get a
 * suffix.
 */
export function collectCalendarEvents(docs, opts = {}) {
  const { today = new Date(), birthdayProperty = 'BIRTHDAY', scope = null, includeDone = false, window = null, contactsDocs = null } = opts;
  const events = [];
  const usedUids = new Set();
  const uniqueUid = (documentId, heading, kind, index, date) => {
    let uid = generateUid(documentId, heading, kind, index, date);
    if (usedUids.has(uid)) uid = uid.replace(/@org-pwa$/, `-${kind}${index}@org-pwa`);
    usedUids.add(uid);
    return uid;
  };
  const dayNumber = (d) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
  const keep = (parsed) => {
    if (!window) return true;
    if (parsed.repeater) return dayNumber(parsed.date) <= dayNumber(window.end);
    return dayNumber(parsed.date) >= dayNumber(window.start) && dayNumber(parsed.date) <= dayNumber(window.end);
  };

  // When scoped to a single heading, walk just that heading's own
  // subtree (itself and its descendants) -- a lightweight, doc-shaped
  // wrapper around just the scope heading, reusing walkHeadings exactly
  // as-is rather than a separate, parallel traversal implementation.
  const walkScope = (doc, visit) => walkHeadings(scope ? { children: [scope] } : doc, visit);

  // The org-contacts-anniversaries lines found across the docs (within the scope, when there is one): one scan for each distinct
  // line, so a birthday line and an "ANNIVERSARY" line give both, and the same line twice gives it once.
  const contactsTriggers = [];
  const seenTriggers = new Set();
  for (const { doc } of docs) {
    walkScope(doc, (heading) => {
      for (const line of heading.bodyLines || []) {
        const trigger = parseContactsAnniversariesTrigger(line);
        if (!trigger) continue;
        const key = `${trigger.field || ''}\u0000${trigger.format || ''}`;
        if (!seenTriggers.has(key)) {
          seenTriggers.add(key);
          contactsTriggers.push(trigger);
        }
      }
    });
  }

  // One contact's yearly events. Each repeats every year as ONE event, which cannot carry an age, so the title leaves it out
  // ("Birthday: Jane Doe") and the date goes in the description.
  const pushAnniversaries = (documentId, heading) => {
    for (const trigger of contactsTriggers) {
      const field = trigger.field || birthdayProperty;
      const event = contactEventFor(heading, field, birthdayProperty);
      if (!event) continue;
      const anchorYear = event.year != null ? event.year : today.getFullYear(); // only month and day matter going forward
      const anchorDate = new Date(anchorYear, event.month - 1, event.day);
      const uid = uniqueUid(documentId, heading, `anniversary-${field.toLowerCase()}`, 0, anchorDate);
      const summary = formatContactEventTitle({ format: trigger.format, field, birthdayProperty, description: event.description, name: heading.title, spouse: contactSpouse(heading), omitAge: true });
      const label = event.description || defaultEventDescription(field);
      events.push({
        uid,
        documentId,
        lines: buildVevent({
          uid,
          summary,
          description: event.year != null ? `${label}: ${event.year}-${pad2(event.month)}-${pad2(event.day)}` : null,
          date: anchorDate,
          hasTime: false,
          rrule: 'FREQ=YEARLY',
          alarmDaysBefore: 0,
          stamp: today,
        }),
      });
    }
  };
  // Contacts are the headings of `contactsDocs` (org-contacts-files) when the caller has them, else of the docs themselves.
  if (contactsTriggers.length && contactsDocs) {
    for (const { documentId, doc } of contactsDocs) {
      walkHeadings(doc, (heading) => {
        if (isArchived(heading) || isCommentedHeading(heading)) return;
        pushAnniversaries(documentId, heading);
      });
    }
  }

  for (const { documentId, doc } of docs) {
    const { doneKeywords } = resolveTodoSequence(doc);
    walkScope(doc, (heading) => {
      if (isArchived(heading)) return;
      if (isCommentedHeading(heading)) return;
      const isDone = doneKeywords.includes(heading.todo);
      if (isDone && !includeDone) return; // matches the agenda/TODO views' own default exclusion of completed items
      const doneNote = isDone ? ` (${heading.todo})` : '';

      let hasPlanning = false;
      for (const kind of ['scheduled', 'deadline']) {
        const raw = heading.planning && heading.planning[kind];
        if (!raw) continue;
        const parsed = parseOrgTimestamp(raw);
        if (!parsed) continue;
        hasPlanning = true;
        if (!keep(parsed)) continue;
        const delay = kind === 'deadline' && parsed.delay ? parseDelay(parsed.delay) : null;
        const uid = uniqueUid(documentId, heading, kind, 0, parsed.date);
        const details = eventDetails(heading);
        events.push({
          uid,
          documentId,
          lines: buildVevent({
            uid,
            summary: heading.title,
            description: [(kind === 'deadline' ? 'Deadline' : 'Scheduled') + doneNote, details.body].filter(Boolean).join('\n'),
            date: parsed.date,
            endDate: parsed.endDate,
            hasTime: parsed.hasTime,
            rrule: parsed.repeater ? repeaterToRRule(parsed.repeater) : null,
            alarmDaysBefore: delay ? delayToDays(delay) : 0,
            categories: details.categories,
            location: details.location,
            stamp: today,
          }),
        });
      }

      // Plain timestamps written directly in the heading title -- same
      // source and scoping (title only, active timestamps only, skipped
      // when the heading already has its own SCHEDULED/DEADLINE) as
      // buildAgendaItems uses for this in agenda.js, so the two can
      // never disagree about what counts.
      if (!hasPlanning) {
        findTimestamps(heading.title).forEach((parsed, index) => {
          if (!parsed.active) return;
          if (!keep(parsed)) return;
          const uid = uniqueUid(documentId, heading, 'timestamp', index, parsed.date);
          const details = eventDetails(heading);
          events.push({
            uid,
            documentId,
            lines: buildVevent({
              uid,
              summary: titleWithoutTimestamps(heading.title),
              description: [doneNote ? doneNote.trim() : null, details.body].filter(Boolean).join('\n') || null,
              date: parsed.date,
              endDate: parsed.endDate,
              hasTime: parsed.hasTime,
              rrule: parsed.repeater ? repeaterToRRule(parsed.repeater) : null,
              alarmDaysBefore: 0,
              categories: details.categories,
              location: details.location,
              stamp: today,
            }),
          });
        });
      }

      if (contactsTriggers.length && !contactsDocs) pushAnniversaries(documentId, heading);
    });
  }

  return events;
}
