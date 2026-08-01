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

import { walkHeadings, parseRepeater, isContactsAnniversariesTrigger, parseContactEvent, delayToDays } from './agenda.js';
import { parseOrgTimestamp, findTimestamps, parseDelay } from './org-timestamp.js';
import { isArchived } from './archive-model.js';
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
function repeaterToRRule(repeaterRaw) {
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
function foldLine(line) {
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
function generateUid(documentId, heading, kind, index, date) {
  const base =
    heading.properties && heading.properties.ID
      ? heading.properties.ID
      : `${documentId || 'doc'}-${heading.title}-${kind}-${index}-${formatIcsDate(date)}`;
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '-');
  return `${safe}@org-pwa`;
}

// ---- VEVENT building -----------------------------------------------------

function buildVevent({ uid, summary, description, date, hasTime, rrule, alarmDaysBefore, stamp }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDateTimeUtc(stamp)}`,
    hasTime ? `DTSTART:${formatIcsDateTime(date)}` : `DTSTART;VALUE=DATE:${formatIcsDate(date)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
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

/**
 * Exports every dated item across `docs` (an array of `{ documentId,
 * doc }` pairs, matching agenda.js's own buildAgendaItems input shape)
 * to a complete .ics file string. `opts.today` controls DTSTAMP's
 * "generated at" timestamp (defaults to now) -- exposed for
 * deterministic testing, the same convention buildAgendaItems itself
 * already uses for its own `today` option.
 */
export function exportToIcalendar(docs, opts = {}) {
  const { today = new Date(), birthdayProperty = 'BIRTHDAY', scope = null } = opts;
  const events = [];

  // When scoped to a single heading, walk just that heading's own
  // subtree (itself and its descendants) -- a lightweight, doc-shaped
  // wrapper around just the scope heading, reusing walkHeadings exactly
  // as-is rather than a separate, parallel traversal implementation.
  const walkScope = (doc, visit) => walkHeadings(scope ? { children: [scope] } : doc, visit);

  // org-contacts-anniversaries is active for this export if the trigger
  // line is present ANYWHERE across all docs -- checked upfront, once,
  // matching buildAgendaItems' own identical upfront scan exactly.
  let contactsAnniversariesActive = false;
  for (const { doc } of docs) {
    walkScope(doc, (heading) => {
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
    const { doneKeywords } = resolveTodoSequence(doc);
    walkScope(doc, (heading) => {
      if (isArchived(heading)) return;
      if (isCommentedHeading(heading)) return;
      if (doneKeywords.includes(heading.todo)) return; // matches the agenda/TODO views' own default exclusion of completed items

      let hasPlanning = false;
      for (const kind of ['scheduled', 'deadline']) {
        const raw = heading.planning && heading.planning[kind];
        if (!raw) continue;
        const parsed = parseOrgTimestamp(raw);
        if (!parsed) continue;
        hasPlanning = true;
        const delay = kind === 'deadline' && parsed.delay ? parseDelay(parsed.delay) : null;
        events.push(
          buildVevent({
            uid: generateUid(documentId, heading, kind, 0, parsed.date),
            summary: heading.title,
            description: kind === 'deadline' ? 'Deadline' : 'Scheduled',
            date: parsed.date,
            hasTime: parsed.hasTime,
            rrule: parsed.repeater ? repeaterToRRule(parsed.repeater) : null,
            alarmDaysBefore: delay ? delayToDays(delay) : 0,
            stamp: today,
          })
        );
      }

      // Plain timestamps written directly in the heading title -- same
      // source and scoping (title only, active timestamps only, skipped
      // when the heading already has its own SCHEDULED/DEADLINE) as
      // buildAgendaItems uses for this in agenda.js, so the two can
      // never disagree about what counts.
      if (!hasPlanning) {
        findTimestamps(heading.title).forEach((parsed, index) => {
          if (!parsed.active) return;
          events.push(
            buildVevent({
              uid: generateUid(documentId, heading, 'timestamp', index, parsed.date),
              summary: heading.title,
              description: null,
              date: parsed.date,
              hasTime: parsed.hasTime,
              rrule: parsed.repeater ? repeaterToRRule(parsed.repeater) : null,
              alarmDaysBefore: 0,
              stamp: today,
            })
          );
        });
      }

      if (contactsAnniversariesActive) {
        const foundKey = (heading.propertyOrder || []).find((k) => k.toLowerCase() === birthdayProperty.toLowerCase());
        const rawEvent = foundKey ? heading.properties[foundKey] : undefined;
        const event = rawEvent ? parseContactEvent(rawEvent) : null;
        if (event) {
          // A real, recurring RRULE needs some starting DTSTART year --
          // the known birth/event year if there is one, else the
          // current year, since only the month/day actually matter for
          // a yearly-recurring anniversary going forward from here.
          const anchorYear = event.year != null ? event.year : today.getFullYear();
          const anchorDate = new Date(anchorYear, event.month - 1, event.day);
          events.push(
            buildVevent({
              uid: generateUid(documentId, heading, 'anniversary', 0, anchorDate),
              summary: `${heading.title}: ${event.description}`,
              description: null,
              date: anchorDate,
              hasTime: false,
              rrule: 'FREQ=YEARLY',
              alarmDaysBefore: 0,
              stamp: today,
            })
          );
        }
      }
    });
  }

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//org-pwa//org-pwa//EN', 'CALSCALE:GREGORIAN', ...events.flat(), 'END:VCALENDAR'];
  return lines.join('\r\n') + '\r\n';
}
