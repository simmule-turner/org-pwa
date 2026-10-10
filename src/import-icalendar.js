/**
 * Turns iCalendar text (.ics: the calendar export of Google, Apple, Outlook, Nextcloud, this app's own Export > Calendar) into
 * org headings. The reverse of export-icalendar.js, and modelled on import-vcard.js: pure, with the same kind of callbacks for
 * what could not be carried over, so the caller can say so.
 *
 *   VEVENT   becomes a heading titled by SUMMARY, with the event's time as an active timestamp IN THE TITLE. That is where the
 *            agenda and Export > Calendar look for a plain timestamp (one on a body line is not shown), and it needs no TODO
 *            state or planning line, which would keep a past event on the agenda as overdue:
 *              * Dentist <2026-10-05 Mon 09:00-10:30>          a time range, in the day
 *              * Holiday <2026-10-05 Mon>                      an all-day event
 *              * Trip <2026-10-05 Mon>--<2026-10-07 Wed>       several days (org's own form; the agenda shows its first and last day)
 *              * Review <2026-10-05 Mon 09:00 +1w>             a simple recurrence, as a repeater
 *            LOCATION, URL and UID become properties, CATEGORIES become tags, DESCRIPTION becomes the body (indented, so no
 *            line of it can be mistaken for a heading).
 *   VTODO    becomes a TODO (or DONE) heading: DTSTART as SCHEDULED, DUE as DEADLINE, COMPLETED as CLOSED, PRIORITY as [#A-C].
 *
 * TIMES are converted to the zone the person is in (or `options.zone`, an IANA name, which is what the tests use), as Emacs's
 * own icalendar-import-file does: a time in UTC (a trailing Z) or in a named zone (TZID=...) is shown as the wall-clock time
 * it is HERE. A time with neither (a "floating" time) is kept as written. A zone name this runtime does not know (Outlook's
 * "W. Europe Standard Time") is kept as written too, and reported through onUnknownTimeZone.
 *
 * RECURRENCE becomes a repeater only when the repeater says the same thing: FREQ with an INTERVAL, and BYDAY / BYMONTHDAY /
 * BYMONTH only where they repeat what DTSTART already says. Anything else (an end date or COUNT, several weekdays, "the
 * second Tuesday") would be imported as a repeater that never ends or runs on the wrong days, so the event is imported once,
 * at its first occurrence, with the original rule kept in an :RRULE: property, and reported through onRecurrenceKept.
 *
 * Properties that are not carried over (ATTENDEE, ORGANIZER, ATTACH, EXDATE, ...) are reported through onUnmappedProperty;
 * bookkeeping ones (DTSTAMP, SEQUENCE, X-... and the like) and VALARM blocks are skipped silently.
 */
import { formatOrgTimestamp } from './org-timestamp.js';

const SILENT = new Set(['DTSTAMP', 'CREATED', 'LAST-MODIFIED', 'SEQUENCE', 'TRANSP', 'CLASS', 'PRODID', 'VERSION', 'CALSCALE', 'METHOD', 'COLOR', 'PERCENT-COMPLETE', 'PRIORITY']);
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ---- reading the text -------------------------------------------------------------------------------

/** The lines of `text` with folded continuation lines (CRLF or LF, then a space or tab) joined back on. */
function unfold(text) {
  return String(text || '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

/** `NAME;PARAM=a;PARAM="b:c":value` as { name, params, value }, or null if the line has no colon. Quotes may hold ':' and ';'. */
function parseProperty(line) {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (line[i] === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = [];
  let current = '';
  inQuote = false;
  for (const ch of left) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === ';' && !inQuote) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  const params = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].trim().toUpperCase(), params, value };
}

/** iCalendar text escapes: \n and \N newline, \, \; \\ . */
function unescapeText(value) {
  return String(value).replace(/\\([nN,;\\])/g, (match, ch) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}

/** The VEVENT and VTODO components, each as { type, props: [{ name, params, value }] }. VALARM and other nested blocks are skipped. */
function collectComponents(text) {
  const found = [];
  const stack = [];
  for (const line of unfold(text)) {
    if (!line.trim()) continue;
    const begin = /^BEGIN:(.+)$/i.exec(line.trim());
    if (begin) {
      stack.push({ type: begin[1].trim().toUpperCase(), props: [] });
      continue;
    }
    const end = /^END:(.+)$/i.exec(line.trim());
    if (end) {
      const top = stack.pop();
      if (top && (top.type === 'VEVENT' || top.type === 'VTODO') && !stack.some((c) => c.type === 'VEVENT' || c.type === 'VTODO')) found.push(top);
      continue;
    }
    const top = stack[stack.length - 1];
    if (!top || (top.type !== 'VEVENT' && top.type !== 'VTODO')) continue;
    if (stack.length >= 2 && stack[stack.length - 2].type !== 'VCALENDAR' && stack[stack.length - 2].type !== 'VEVENT' && stack[stack.length - 2].type !== 'VTODO') continue;
    const prop = parseProperty(line);
    if (prop) top.props.push(prop);
  }
  return found;
}

// ---- dates and times ---------------------------------------------------------------------------------
//
// Every date or time is carried as `wall`: milliseconds as if its wall-clock fields were UTC. That makes adding a duration,
// comparing and formatting plain arithmetic, and a daylight-saving change never lands inside it.

const pad = (n) => String(n).padStart(2, '0');

function wallParts(wall) {
  const d = new Date(wall);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}

/** The wall-clock fields `instantMs` shows in `zone` (an IANA name), or in the device's own zone when `zone` is null. */
function instantToWall(instantMs, zone) {
  if (!zone) {
    const d = new Date(instantMs);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  }
  const parts = zoneFields(instantMs, zone);
  return Date.UTC(parts.y, parts.m - 1, parts.d, parts.h, parts.mi, parts.s);
}

function zoneFields(instantMs, zone) {
  const out = {};
  for (const part of new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(instantMs))) out[part.type] = Number(part.value);
  return { y: out.year, m: out.month, d: out.day, h: out.hour === 24 ? 0 : out.hour, mi: out.minute, s: out.second };
}

/** The instant a wall-clock time is, in the IANA zone `zone` (two passes settle the offset around a daylight-saving change). */
function zonedWallToInstant(wall, zone) {
  let instant = wall;
  for (let i = 0; i < 2; i++) {
    const shown = zoneFields(instant, zone);
    const asWall = Date.UTC(shown.y, shown.m - 1, shown.d, shown.h, shown.mi, shown.s);
    instant -= asWall - wall;
  }
  return instant;
}

/** One DTSTART / DTEND / DUE / COMPLETED value as { wall, allDay }, or null if it is not a date. */
function parseDateValue(prop, zone, onUnknownTimeZone) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/i.exec(prop.value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { wall: Date.UTC(+y, +mo - 1, +d), allDay: true };
  const asWritten = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0));
  if (z) return { wall: instantToWall(asWritten, zone), allDay: false };
  const tzid = prop.params.TZID;
  if (tzid) {
    try {
      return { wall: instantToWall(zonedWallToInstant(asWritten, tzid), zone), allDay: false };
    } catch {
      if (onUnknownTimeZone) onUnknownTimeZone(tzid);
    }
  }
  return { wall: asWritten, allDay: false }; // floating, or a zone this runtime does not know: as written
}

/** An iCalendar DURATION (P1DT2H30M, PT45M, P2W, -PT15M) in milliseconds, or null. */
function parseDuration(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!m) return null;
  const ms = ((+(m[2] || 0)) * 7 * 86400 + (+(m[3] || 0)) * 86400 + (+(m[4] || 0)) * 3600 + (+(m[5] || 0)) * 60 + (+(m[6] || 0))) * 1000;
  return m[1] === '-' ? -ms : ms;
}

// ---- recurrence --------------------------------------------------------------------------------------

/** The repeater ('+1w') an RRULE says, or null if no repeater says the same thing (see the header). */
function repeaterFor(rruleText, startWall) {
  const rule = {};
  for (const piece of rruleText.split(';')) {
    const eq = piece.indexOf('=');
    if (eq > 0) rule[piece.slice(0, eq).toUpperCase()] = piece.slice(eq + 1).toUpperCase();
  }
  const unit = { DAILY: 'd', WEEKLY: 'w', MONTHLY: 'm', YEARLY: 'y' }[rule.FREQ];
  if (!unit) return null;
  const interval = rule.INTERVAL === undefined ? 1 : Number(rule.INTERVAL);
  if (!Number.isInteger(interval) || interval < 1) return null;
  const start = wallParts(startWall);
  const weekday = DAY_CODES[new Date(startWall).getUTCDay()];
  for (const key of Object.keys(rule)) {
    if (key === 'FREQ' || key === 'INTERVAL' || key === 'WKST') continue;
    if (key === 'BYDAY' && unit === 'w' && rule.BYDAY === weekday) continue;
    if (key === 'BYMONTHDAY' && (unit === 'm' || unit === 'y') && Number(rule.BYMONTHDAY) === start.d) continue;
    if (key === 'BYMONTH' && unit === 'y' && Number(rule.BYMONTH) === start.m) continue;
    return null; // COUNT, UNTIL, several weekdays, ordinals, BYSETPOS, ...
  }
  return `+${interval}${unit}`;
}

// ---- building headings -------------------------------------------------------------------------------

const textOf = (props, name) => {
  const prop = props.find((p) => p.name === name);
  return prop ? unescapeText(prop.value).trim() : '';
};

function tagsFrom(props) {
  const tags = [];
  for (const prop of props.filter((p) => p.name === 'CATEGORIES')) {
    for (const raw of prop.value.split(/(?<!\\),/)) {
      const tag = unescapeText(raw).trim().replace(/[^A-Za-z0-9_@#%]+/g, '_').replace(/^_+|_+$/g, '');
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  }
  return tags;
}

const stamp = (wall, allDay, extra = {}) => {
  const p = wallParts(wall);
  return formatOrgTimestamp({ date: new Date(p.y, p.m - 1, p.d), time: allDay ? null : `${pad(p.h)}:${pad(p.mi)}`, ...extra });
};

/** The org timestamp text for an event's time: a range in the day, a day, several days, or a day with a repeater. */
function eventTimestamp(start, end, repeater) {
  const repeat = repeater ? { repeaterMark: '+', repeaterValue: repeater.slice(1) } : {};
  const first = wallParts(start.wall);
  if (!end || end.wall <= start.wall) return stamp(start.wall, start.allDay, repeat);
  const last = wallParts(end.wall);
  const sameDay = first.y === last.y && first.m === last.m && first.d === last.d;
  if (start.allDay) {
    const lastDay = end.wall - 86400000; // an all-day DTEND is the day AFTER the last
    if (lastDay <= start.wall) return stamp(start.wall, true, repeat);
    return `${stamp(start.wall, true, repeat)}--${stamp(lastDay, true)}`;
  }
  if (sameDay) {
    const range = `${pad(first.h)}:${pad(first.mi)}-${pad(last.h)}:${pad(last.mi)}`;
    return formatOrgTimestamp({ date: new Date(first.y, first.m - 1, first.d), time: range, ...repeat });
  }
  return `${stamp(start.wall, false, repeat)}--${stamp(end.wall, false)}`;
}

function headingFor(component, options) {
  const { zone, onUnmappedProperty, onRecurrenceKept, onUnknownTimeZone } = options;
  const props = component.props;
  const isTodo = component.type === 'VTODO';
  const summary = textOf(props, 'SUMMARY').replace(/\s*\n\s*/g, ' ') || '(no title)';
  const dateOf = (name) => {
    const prop = props.find((p) => p.name === name);
    return prop ? parseDateValue(prop, zone, onUnknownTimeZone) : null;
  };
  const start = dateOf('DTSTART');
  const due = dateOf('DUE');
  if (!isTodo && !start) return null; // an event with no start has no place in a calendar

  let end = isTodo ? null : dateOf('DTEND');
  const duration = props.find((p) => p.name === 'DURATION');
  if (!isTodo && !end && duration && start) {
    const ms = parseDuration(duration.value);
    if (ms !== null) end = { wall: start.wall + ms, allDay: start.allDay };
  }

  const rrule = props.find((p) => p.name === 'RRULE');
  const anchor = isTodo ? due || start : start;
  let repeater = null;
  const kept = {};
  if (rrule && anchor) {
    repeater = repeaterFor(rrule.value, anchor.wall);
    if (!repeater) {
      kept.RRULE = rrule.value;
      if (onRecurrenceKept) onRecurrenceKept(summary);
    }
  }

  const properties = [];
  const uid = textOf(props, 'UID');
  if (uid) properties.push(['UID', uid]);
  const location = textOf(props, 'LOCATION').replace(/\s*\n\s*/g, ', ');
  if (location) properties.push(['LOCATION', location]);
  const url = textOf(props, 'URL');
  if (url) properties.push(['URL', url]);
  if (/^CANCELLED$/i.test(textOf(props, 'STATUS'))) properties.push(['STATUS', 'CANCELLED']);
  if (kept.RRULE) properties.push(['RRULE', kept.RRULE]);

  const handled = new Set(['SUMMARY', 'DTSTART', 'DTEND', 'DUE', 'DURATION', 'RRULE', 'UID', 'LOCATION', 'URL', 'STATUS', 'CATEGORIES', 'DESCRIPTION', 'COMPLETED']);
  if (onUnmappedProperty) {
    for (const prop of props) {
      if (handled.has(prop.name) || SILENT.has(prop.name) || prop.name.startsWith('X-')) continue;
      onUnmappedProperty(prop.name);
    }
  }

  const tags = tagsFrom(props);
  const tagText = tags.length ? ` :${tags.join(':')}:` : '';
  const description = textOf(props, 'DESCRIPTION');
  const body = description ? description.split('\n').map((line) => (line.trim() ? `  ${line.replace(/\s+$/, '')}` : '')) : [];
  while (body.length && body[body.length - 1] === '') body.pop();

  const lines = [];
  if (isTodo) {
    const done = /^COMPLETED$/i.test(textOf(props, 'STATUS')) || props.some((p) => p.name === 'COMPLETED');
    const priority = Number(textOf(props, 'PRIORITY'));
    const mark = priority >= 1 && priority <= 4 ? '[#A] ' : priority === 5 ? '[#B] ' : priority >= 6 && priority <= 9 ? '[#C] ' : '';
    lines.push(`* ${done ? 'DONE' : 'TODO'} ${mark}${summary}${tagText}`);
    const completed = dateOf('COMPLETED');
    const planning = [];
    if (done && completed) planning.push(`CLOSED: ${stamp(completed.wall, completed.allDay, {}).replace(/^<|>$/g, (c) => (c === '<' ? '[' : ']'))}`);
    if (due) planning.push(`DEADLINE: ${stamp(due.wall, due.allDay, repeater ? { repeaterMark: '+', repeaterValue: repeater.slice(1) } : {})}`);
    if (start) planning.push(`SCHEDULED: ${stamp(start.wall, start.allDay, !due && repeater ? { repeaterMark: '+', repeaterValue: repeater.slice(1) } : {})}`);
    if (planning.length) lines.push(planning.join(' '));
  } else {
    lines.push(`* ${summary} ${eventTimestamp(start, end, repeater)}${tagText}`);
  }
  if (properties.length) lines.push(':PROPERTIES:', ...properties.map(([k, v]) => `:${k}: ${v}`), ':END:');
  lines.push(...body);
  return lines.join('\n');
}

/**
 * `icsText` as org text, one top-level heading per event or task.
 * @param {object} [options]
 *   zone                 an IANA zone name to convert times into (the device's own zone if omitted)
 *   onUnmappedProperty   (name) => void   a property that was not carried over
 *   onRecurrenceKept     (summary) => void   a recurrence that became an :RRULE: property instead of a repeater
 *   onUnknownTimeZone    (tzid) => void   a time zone name this runtime does not know
 * @returns {{ orgText: string, eventCount: number, todoCount: number }} orgText is '' when there is nothing to import
 */
function importIcalendarAsOrgText(icsText, options = {}) {
  const blocks = [];
  let eventCount = 0;
  let todoCount = 0;
  for (const component of collectComponents(icsText)) {
    const block = headingFor(component, { zone: options.zone || null, ...options });
    if (!block) continue;
    blocks.push(block);
    if (component.type === 'VTODO') todoCount++;
    else eventCount++;
  }
  return { orgText: blocks.length ? blocks.join('\n') + '\n' : '', eventCount, todoCount };
}

const stampText = (wall, allDay) => {
  const w = wallParts(wall);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}` + (allDay ? '' : ` ${pad(w.h)}:${pad(w.mi)}`);
};

/**
 * The events (not tasks) of `icsText` as plain data, for scripts: { uid, summary, location, description, allDay,
 * start, end, repeat, rrule, cancelled }. `start` and `end` are "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" in `zone`
 * (the device's own zone if omitted). `repeat` is an Org repeater such as "+1w" when the recurrence is a simple
 * one, else null with the raw rule in `rrule`. Recurrences are not expanded.
 */
function parseIcalendarEvents(icsText, { zone = null, max = 2000 } = {}) {
  const events = [];
  for (const component of collectComponents(icsText)) {
    if (component.type !== 'VEVENT') continue;
    const props = component.props;
    const dateOf = (name) => {
      const prop = props.find((p) => p.name === name);
      return prop ? parseDateValue(prop, zone, null) : null;
    };
    const start = dateOf('DTSTART');
    if (!start) continue;
    let end = dateOf('DTEND');
    const duration = props.find((p) => p.name === 'DURATION');
    if (!end && duration) {
      const ms = parseDuration(duration.value);
      if (ms !== null) end = { wall: start.wall + ms, allDay: start.allDay };
    }
    const rrule = props.find((p) => p.name === 'RRULE');
    const repeat = rrule ? repeaterFor(rrule.value, start.wall) : null;
    events.push({
      uid: textOf(props, 'UID'),
      summary: textOf(props, 'SUMMARY').replace(/\s*\n\s*/g, ' ') || '(no title)',
      location: textOf(props, 'LOCATION').replace(/\s*\n\s*/g, ', '),
      description: textOf(props, 'DESCRIPTION'),
      allDay: start.allDay,
      start: stampText(start.wall, start.allDay),
      end: end ? stampText(end.wall, end.allDay) : null,
      repeat: repeat || null,
      rrule: rrule && !repeat ? rrule.value : null,
      cancelled: /^CANCELLED$/i.test(textOf(props, 'STATUS')),
    });
    if (events.length >= max) break;
  }
  return events;
}

export { parseIcalendarEvents, importIcalendarAsOrgText, parseProperty, unfold, repeaterFor, parseDuration };
