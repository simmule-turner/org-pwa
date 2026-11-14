// @ts-check
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
 * RECURRENCE becomes a repeater when the repeater says the same thing: FREQ with an INTERVAL, and BYDAY / BYMONTHDAY /
 * BYMONTH only where they repeat what DTSTART already says. Anything Org's repeaters cannot say (an end date or COUNT, several
 * weekdays, "the second Tuesday", EXDATE) becomes a diary-style `<%%(...)>` expression built from Org's own org-cyclic,
 * org-date, org-block and diary-float, which finds the same days. Only a rule that expression cannot say either (an INTERVAL
 * with several weekdays, or on a monthly or yearly rule) is imported once, at its first occurrence, with the original rule kept
 * in an :RRULE: property, and reported through onRecurrenceKept.
 *
 * ORGANIZER, ATTENDEE and ATTACH become :ORGANIZER: / :ATTENDEES: properties and link lines; a VALARM becomes :APPT_WARNTIME:
 * (minutes before). Properties that are still not carried over are reported through onUnmappedProperty; bookkeeping ones
 * (DTSTAMP, SEQUENCE, X-... and the like) are skipped silently.
 */
import { formatOrgTimestamp } from './org-timestamp.js';
import { oneLine, propertyText, bodyLines } from './import-safe.js';

/** @typedef {{ name: string, params: Record<string, string>, value: string }} IcsProp */

const SILENT = new Set(['DTSTAMP', 'CREATED', 'LAST-MODIFIED', 'SEQUENCE', 'TRANSP', 'CLASS', 'PRODID', 'VERSION', 'CALSCALE', 'METHOD', 'COLOR', 'PERCENT-COMPLETE', 'PRIORITY']);
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ---- reading the text -------------------------------------------------------------------------------

/**
 * The lines of `text` with folded continuation lines (CRLF or LF, then a space or tab) joined back on.
 * @param {string} text
 */
function unfold(text) {
  return String(text || '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

/**
 * `NAME;PARAM=a;PARAM="b:c":value` as { name, params, value }, or null if the line has no colon. Quotes may hold ':' and ';'.
 * @param {string} line
 */
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
    if (eq > 0) /** @type {any} */ (params)[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].trim().toUpperCase(), params, value };
}

/**
 * iCalendar text escapes: \n and \N newline, \, \; \\ .
 * @param {any} [value]
 */
function unescapeText(value) {
  return String(value).replace(/\\([nN,;\\])/g, (match, ch) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}

/**
 * The VEVENT and VTODO components, each as { type, props: [{ name, params, value }], alarms: [the TRIGGER of each VALARM] }. Other nested blocks are skipped.
 * @param {string} text
 */
function collectComponents(text) {
  const found = [];
  const stack = [];
  for (const line of unfold(text)) {
    if (!line.trim()) continue;
    const begin = /^BEGIN:(.+)$/i.exec(line.trim());
    if (begin) {
      stack.push({ type: begin[1].trim().toUpperCase(), props: /** @type {IcsProp[]} */ ([]), alarms: /** @type {IcsProp[]} */ ([]) });
      continue;
    }
    const end = /^END:(.+)$/i.exec(line.trim());
    if (end) {
      const top = stack.pop();
      if (top && top.type === 'VALARM') {
        const parent = stack[stack.length - 1];
        const trigger = top.props.find((p) => p.name === 'TRIGGER');
        if (parent && trigger) parent.alarms = [...parent.alarms, trigger];
        continue;
      }
      if (top && (top.type === 'VEVENT' || top.type === 'VTODO') && !stack.some((c) => c.type === 'VEVENT' || c.type === 'VTODO')) found.push(top);
      continue;
    }
    const top = stack[stack.length - 1];
    if (top && top.type === 'VALARM') {
      const alarmProp = parseProperty(line);
      if (alarmProp) top.props.push(alarmProp);
      continue;
    }
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

/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');

/** @param {string | number | Date} wall */
function wallParts(wall) {
  const d = new Date(wall);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}

/**
 * The wall-clock fields `instantMs` shows in `zone` (an IANA name), or in the device's own zone when `zone` is null.
 * @param {number} instantMs
 * @param {any} [zone]
 */
function instantToWall(instantMs, zone) {
  if (!zone) {
    const d = new Date(instantMs);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  }
  const parts = zoneFields(instantMs, zone);
  return Date.UTC(parts.y, parts.m - 1, parts.d, parts.h, parts.mi, parts.s);
}

/**
 * @param {number} instantMs
 * @param {any} [zone]
 */
function zoneFields(instantMs, zone) {
  const out = {};
  for (const part of new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(instantMs))) /** @type {any} */ (out)[part.type] = Number(part.value);
  return { y: /** @type {any} */ (out).year, m: /** @type {any} */ (out).month, d: /** @type {any} */ (out).day, h: /** @type {any} */ (out).hour === 24 ? 0 : /** @type {any} */ (out).hour, mi: /** @type {any} */ (out).minute, s: /** @type {any} */ (out).second };
}

/**
 * The instant a wall-clock time is, in the IANA zone `zone` (two passes settle the offset around a daylight-saving change).
 * @param {number} wall
 * @param {any} [zone]
 */
function zonedWallToInstant(wall, zone) {
  let instant = wall;
  for (let i = 0; i < 2; i++) {
    const shown = zoneFields(instant, zone);
    const asWall = Date.UTC(shown.y, shown.m - 1, shown.d, shown.h, shown.mi, shown.s);
    instant -= asWall - wall;
  }
  return instant;
}

/**
 * One DTSTART / DTEND / DUE / COMPLETED value as { wall, allDay }, or null if it is not a date.
 * @param {any} prop
 * @param {null} zone
 * @param {any} [onUnknownTimeZone]
 */
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

/**
 * An iCalendar DURATION (P1DT2H30M, PT45M, P2W, -PT15M) in milliseconds, or null.
 * @param {string} value
 */
function parseDuration(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!m) return null;
  const ms = ((+(m[2] || 0)) * 7 * 86400 + (+(m[3] || 0)) * 86400 + (+(m[4] || 0)) * 3600 + (+(m[5] || 0)) * 60 + (+(m[6] || 0))) * 1000;
  return m[1] === '-' ? -ms : ms;
}

// ---- recurrence --------------------------------------------------------------------------------------

/**
 * The repeater ('+1w') an RRULE says, or null if no repeater says the same thing (see the header).
 * @param {string} rruleText
 * @param {number} startWall
 */
function repeaterFor(rruleText, startWall) {
  const rule = {};
  for (const piece of rruleText.split(';')) {
    const eq = piece.indexOf('=');
    if (eq > 0) /** @type {any} */ (rule)[piece.slice(0, eq).toUpperCase()] = piece.slice(eq + 1).toUpperCase();
  }
  const unit = /** @type {any} */ ({ DAILY: 'd', WEEKLY: 'w', MONTHLY: 'm', YEARLY: 'y' })[/** @type {any} */ (rule).FREQ];
  if (!unit) return null;
  const interval = /** @type {any} */ (rule).INTERVAL === undefined ? 1 : Number(/** @type {any} */ (rule).INTERVAL);
  if (!Number.isInteger(interval) || interval < 1) return null;
  const start = wallParts(startWall);
  const weekday = DAY_CODES[new Date(startWall).getUTCDay()];
  for (const key of Object.keys(rule)) {
    if (key === 'FREQ' || key === 'INTERVAL' || key === 'WKST') continue;
    if (key === 'BYDAY' && unit === 'w' && /** @type {any} */ (rule).BYDAY === weekday) continue;
    if (key === 'BYMONTHDAY' && (unit === 'm' || unit === 'y') && Number(/** @type {any} */ (rule).BYMONTHDAY) === start.d) continue;
    if (key === 'BYMONTH' && unit === 'y' && Number(/** @type {any} */ (rule).BYMONTH) === start.m) continue;
    return null; // COUNT, UNTIL, several weekdays, ordinals, BYSETPOS, ...
  }
  return `+${interval}${unit}`;
}

/** The parts of an RRULE as an object with upper-case keys. @param {string} text @returns {Record<string, string>} */
function parseRule(text) {
  /** @type {Record<string, string>} */ const rule = {};
  for (const piece of text.split(';')) {
    const eq = piece.indexOf('=');
    if (eq > 0) rule[piece.slice(0, eq).toUpperCase()] = piece.slice(eq + 1).toUpperCase();
  }
  return rule;
}

/** @param {number} y @param {number} m */
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Does the rule hold on the day with these wall-clock fields? One predicate for every rule the sexp below writes, so that COUNT
 * can be turned into the day of the last occurrence. `n` is the number of days since the start.
 * @param {{ freq: string, interval: number, weekdays: number[] | null, nth: [number, number] | null }} r
 * @param {{ y: number, m: number, d: number }} start @param {{ y: number, m: number, d: number }} day @param {number} n
 */
function ruleHolds(r, start, day, n) {
  const dow = new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
  const startDow = new Date(Date.UTC(start.y, start.m - 1, start.d)).getUTCDay();
  if (r.freq === 'DAILY') return n % r.interval === 0;
  if (r.freq === 'WEEKLY') return r.weekdays ? r.weekdays.includes(dow) : n % (7 * r.interval) === 0 && dow === startDow;
  if (r.freq === 'MONTHLY') {
    if (r.nth) {
      if (dow !== r.nth[1]) return false;
      const count = r.nth[0];
      if (count > 0) return Math.ceil(day.d / 7) === count;
      return day.d + 7 * -count > daysInMonth(day.y, day.m) && day.d + 7 * (-count - 1) <= daysInMonth(day.y, day.m);
    }
    return day.d === start.d;
  }
  return day.m === start.m && day.d === start.d; // YEARLY
}

/**
 * The `<%%(...)>` expression for a recurrence a repeater cannot say (an end date or COUNT, several weekdays, "the second Tuesday"),
 * and for one with excluded dates (EXDATE), or null when there is none: every day the expression is true is an occurrence. It uses
 * Org's own sexp functions (org-cyclic, org-date, org-block) and diary-float, which take their dates in the
 * same order whatever calendar-date-style is. A rule it cannot write (an INTERVAL with several weekdays or on a month or year,
 * BYSETPOS, BYMONTHDAY=-1, ...) gives null.
 * @param {string} rruleText @param {number} startWall @param {number[]} exdates the wall times of EXDATE
 * @returns {string | null}
 */
function sexpFor(rruleText, startWall, exdates) {
  const rule = parseRule(rruleText);
  const freq = rule.FREQ;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const interval = rule.INTERVAL === undefined ? 1 : Number(rule.INTERVAL);
  if (!Number.isInteger(interval) || interval < 1) return null;
  const start = wallParts(startWall);
  const startDay = { y: start.y, m: start.m, d: start.d };
  const startDow = new Date(startWall).getUTCDay();
  for (const key of Object.keys(rule)) if (!['FREQ', 'INTERVAL', 'WKST', 'UNTIL', 'COUNT', 'BYDAY', 'BYMONTHDAY', 'BYMONTH'].includes(key)) return null;
  /** @type {number[] | null} */ let weekdays = null;
  /** @type {[number, number] | null} */ let nth = null;
  if (rule.BYDAY !== undefined) {
    const parts = rule.BYDAY.split(',');
    if (freq === 'WEEKLY') {
      if (!parts.every((p) => DAY_CODES.includes(p))) return null;
      weekdays = parts.map((p) => DAY_CODES.indexOf(p));
    } else if (freq === 'MONTHLY' && parts.length === 1) {
      const m = /^(-?[1-5])([A-Z]{2})$/.exec(parts[0]);
      if (!m || !DAY_CODES.includes(m[2]) || Number(m[1]) === -5) return null;
      nth = [Number(m[1]), DAY_CODES.indexOf(m[2])];
    } else return null;
  }
  if (rule.BYMONTHDAY !== undefined && (freq === 'DAILY' || freq === 'WEEKLY' || Number(rule.BYMONTHDAY) !== start.d)) return null;
  if (rule.BYMONTH !== undefined && !(freq === 'YEARLY' && Number(rule.BYMONTH) === start.m)) return null;
  const several = weekdays !== null && (weekdays.length > 1 || weekdays[0] !== startDow);
  if ((freq === 'MONTHLY' || freq === 'YEARLY' || several) && interval !== 1) return null;
  if (weekdays && !several) weekdays = null;
  const r = { freq, interval, weekdays, nth };

  /** @type {{ y: number, m: number, d: number } | null} */ let last = null;
  if (rule.UNTIL !== undefined) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(rule.UNTIL);
    if (!m) return null;
    last = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  } else if (rule.COUNT !== undefined) {
    const count = Number(rule.COUNT);
    if (!Number.isInteger(count) || count < 1) return null;
    let found = 0;
    for (let n = 0; n < 366 * 400 && found < count; n++) {
      const t = new Date(startWall + n * 86400000);
      const day = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
      if (ruleHolds(r, startDay, day, n)) {
        found++;
        last = day;
      }
    }
    if (found < count) return null;
  }

  const clauses = exdates.map((w) => {
    const e = wallParts(w);
    return `(not (org-date ${e.y} ${e.m} ${e.d}))`;
  });
  /** Does the clause itself start at the first day? */
  let bounded = false;
  if (freq === 'DAILY') {
    clauses.push(`(org-cyclic ${interval} ${start.y} ${start.m} ${start.d})`);
    bounded = true;
  } else if (freq === 'WEEKLY') {
    if (weekdays) clauses.push(`(memq (calendar-day-of-week date) '(${weekdays.join(' ')}))`);
    else {
      clauses.push(`(org-cyclic ${7 * interval} ${start.y} ${start.m} ${start.d})`);
      bounded = true;
    }
  } else if (freq === 'MONTHLY') clauses.push(nth ? `(diary-float t ${nth[1]} ${nth[0]})` : `(org-date t t ${start.d})`);
  else clauses.push(`(org-date t ${start.m} ${start.d})`);
  if (last) clauses.push(`(org-block ${start.y} ${start.m} ${start.d} ${last.y} ${last.m} ${last.d})`);
  else if (!bounded) clauses.push(`(org-block ${start.y} ${start.m} ${start.d} 9999 12 31)`);
  return clauses.length === 1 ? clauses[0] : `(and ${clauses.join(' ')})`;
}

/** The minutes before the start a display alarm rings, from `TRIGGER:-PT15M`, `-PT1H30M`, `-P1D` or `-P1W`; null for any other trigger. @param {IcsProp} trigger */
function alarmMinutes(trigger) {
  if (trigger.params.RELATED && /^END$/i.test(trigger.params.RELATED)) return null;
  const m = /^-P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/i.exec(trigger.value.trim());
  if (!m) return null;
  const minutes = Number(m[1] || 0) * 10080 + Number(m[2] || 0) * 1440 + Number(m[3] || 0) * 60 + Number(m[4] || 0);
  return minutes > 0 ? minutes : null;
}

// ---- building headings -------------------------------------------------------------------------------

/**
 * @param {IcsProp[]} props
 * @param {string} name
 */
const textOf = (props, name) => {
  const prop = props.find((/** @type {IcsProp} */ p) => p.name === name);
  return prop ? unescapeText(prop.value).trim() : '';
};

/** @param {any} [props] */
function tagsFrom(props) {
  /** @type {any[]} */ const tags = [];
  for (const prop of props.filter((/** @type {IcsProp} */ p) => p.name === 'CATEGORIES')) {
    for (const raw of prop.value.split(/(?<!\\),/)) {
      const tag = unescapeText(raw).trim().replace(/[^A-Za-z0-9_@#%]+/g, '_').replace(/^_+|_+$/g, '');
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  }
  return tags;
}

/**
 * @param {any} [wall]
 * @param {any} [allDay]
 */
const stamp = (wall, allDay, extra = {}) => {
  const p = wallParts(wall);
  return formatOrgTimestamp({ date: new Date(p.y, p.m - 1, p.d), time: allDay ? null : `${pad(p.h)}:${pad(p.mi)}`, ...extra });
};

/**
 * The org timestamp text for an event's time: a range in the day, a day, several days, or a day with a repeater.
 * @param {any} [start]
 * @param {any} [end]
 * @param {any} [repeater]
 */
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

/**
 * @param {any} [component]
 * @param {any} [options]
 */
function headingFor(component, options) {
  const { zone, onUnmappedProperty, onRecurrenceKept, onUnknownTimeZone } = options;
  const props = component.props;
  const isTodo = component.type === 'VTODO';
  const summary = oneLine(textOf(props, 'SUMMARY').replace(/\s*\n\s*/g, ' ')) || '(no title)';
  /** @param {string} name */
  const dateOf = (name) => {
    const prop = props.find((/** @type {IcsProp} */ p) => p.name === name);
    return prop ? parseDateValue(prop, zone, onUnknownTimeZone) : null;
  };
  const start = dateOf('DTSTART');
  const due = dateOf('DUE');
  if (!isTodo && !start) return null; // an event with no start has no place in a calendar

  let end = isTodo ? null : dateOf('DTEND');
  const duration = props.find((/** @type {IcsProp} */ p) => p.name === 'DURATION');
  if (!isTodo && !end && duration && start) {
    const ms = parseDuration(duration.value);
    if (ms !== null) end = { wall: start.wall + ms, allDay: start.allDay };
  }

  const rrule = props.find((/** @type {IcsProp} */ p) => p.name === 'RRULE');
  const anchor = isTodo ? due || start : start;
  /** @type {any} */
  let repeater = null;
  /** @type {string | null} */
  let sexp = null;
  const kept = {};
  const exdates = /** @type {number[]} */ ([]);
  for (const prop of props.filter((/** @type {IcsProp} */ p) => p.name === 'EXDATE')) {
    for (const value of prop.value.split(',')) {
      const parsed = parseDateValue({ ...prop, value }, zone, onUnknownTimeZone);
      if (parsed) exdates.push(parsed.wall);
    }
  }
  let exceptionsKept = false;
  if (rrule && anchor) {
    repeater = repeaterFor(rrule.value, anchor.wall);
    if (!isTodo && (exdates.length || !repeater)) {
      sexp = sexpFor(rrule.value, anchor.wall, exdates);
      if (sexp) repeater = null;
    }
    if (!repeater && !sexp) {
      kept.RRULE = rrule.value;
      if (onRecurrenceKept) onRecurrenceKept(summary);
    } else if (exdates.length && !sexp) exceptionsKept = true;
  } else if (exdates.length) exceptionsKept = true;
  if (exceptionsKept && onUnmappedProperty) onUnmappedProperty('EXDATE');

  const properties = [];
  const uid = textOf(props, 'UID');
  if (uid) properties.push(['UID', propertyText(uid)]);
  const location = propertyText(textOf(props, 'LOCATION').replace(/\s*\n\s*/g, ', '));
  if (location) properties.push(['LOCATION', location]);
  const url = textOf(props, 'URL');
  if (url) properties.push(['URL', propertyText(url)]);
  if (/^CANCELLED$/i.test(textOf(props, 'STATUS'))) properties.push(['STATUS', 'CANCELLED']);
  if (kept.RRULE) properties.push(['RRULE', propertyText(kept.RRULE)]);
  /** `Name <address>` for an ORGANIZER or ATTENDEE. @param {IcsProp} prop */
  const person = (prop) => {
    const address = prop.value.replace(/^mailto:/i, '');
    const name = prop.params.CN ? oneLine(prop.params.CN) : '';
    return propertyText(name && name !== address ? `${name} <${address}>` : address);
  };
  const organizer = props.find((/** @type {IcsProp} */ p) => p.name === 'ORGANIZER');
  if (organizer) properties.push(['ORGANIZER', person(organizer)]);
  const attendees = props.filter((/** @type {IcsProp} */ p) => p.name === 'ATTENDEE');
  if (attendees.length) properties.push(['ATTENDEES', attendees.map(person).join(', ')]);
  // a display alarm before the start is what `:APPT_WARNTIME:` says on export
  const alarms = component.alarms || [];
  if (alarms.length) {
    const minutes = alarms.length === 1 && !isTodo && start && !start.allDay ? alarmMinutes(alarms[0]) : null;
    if (minutes === null) {
      if (onUnmappedProperty) onUnmappedProperty('VALARM');
    } else properties.push(['APPT_WARNTIME', String(minutes)]);
  }

  const handled = new Set(['SUMMARY', 'DTSTART', 'DTEND', 'DUE', 'DURATION', 'RRULE', 'EXDATE', 'UID', 'LOCATION', 'URL', 'STATUS', 'CATEGORIES', 'DESCRIPTION', 'COMPLETED', 'ORGANIZER', 'ATTENDEE']);
  const attachments = [];
  for (const prop of props.filter((/** @type {IcsProp} */ p) => p.name === 'ATTACH')) {
    if (/^BINARY$/i.test(prop.params.VALUE || '') || /^BASE64$/i.test(prop.params.ENCODING || '') || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(prop.value)) {
      if (onUnmappedProperty) onUnmappedProperty('ATTACH');
    } else attachments.push(prop.params.FILENAME ? `[[${prop.value}][${oneLine(prop.params.FILENAME)}]]` : `[[${prop.value}]]`);
  }
  handled.add('ATTACH');
  if (onUnmappedProperty) {
    for (const prop of props) {
      if (handled.has(prop.name) || SILENT.has(prop.name) || prop.name.startsWith('X-')) continue;
      onUnmappedProperty(prop.name);
    }
  }

  const tags = tagsFrom(props);
  const tagText = tags.length ? ` :${tags.join(':')}:` : '';
  const description = textOf(props, 'DESCRIPTION');
  const body = description ? bodyLines(description).map((line) => (line.trim() ? `  ${line.replace(/\s+$/, '')}` : '')) : [];
  while (body.length && body[body.length - 1] === '') body.pop();
  for (const link of attachments) body.push(`  - ${link}`);

  const lines = [];
  if (isTodo) {
    const done = /^COMPLETED$/i.test(textOf(props, 'STATUS')) || props.some((/** @type {IcsProp} */ p) => p.name === 'COMPLETED');
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
    if (sexp) {
      const timed = start && !start.allDay ? wallParts(start.wall) : null;
      const until = timed && start && end && end.wall > start.wall ? wallParts(end.wall) : null;
      const time = timed ? `${pad(timed.h)}:${pad(timed.mi)}${until ? `-${pad(until.h)}:${pad(until.mi)}` : ''} ` : '';
      lines.push(`* ${time}${summary} <%%${sexp}>${tagText}`); // the time first, as a diary entry has it
    } else lines.push(`* ${summary} ${eventTimestamp(start, end, repeater)}${tagText}`);
  }
  if (properties.length) lines.push(':PROPERTIES:', ...properties.map(([k, v]) => `:${k}: ${v}`), ':END:');
  lines.push(...body);
  return lines.join('\n');
}

/**
 * `icsText` as org text, one top-level heading per event or task.
 * @param {{ zone?: string | null, onUnmappedProperty?: (name: string) => void, onRecurrenceKept?: (summary: string) => void, onUnknownTimeZone?: (tzid: string) => void }} [options]
 *   zone                 an IANA zone name to convert times into (the device's own zone if omitted)
 *   onUnmappedProperty   (name) => void   a property that was not carried over
 *   onRecurrenceKept     (summary) => void   a recurrence that became an :RRULE: property instead of a repeater
 *   onUnknownTimeZone    (tzid) => void   a time zone name this runtime does not know
 * @returns {{ orgText: string, eventCount: number, todoCount: number }} orgText is '' when there is nothing to import
 * @param {string} icsText
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

/**
 * @param {number} wall
 * @param {boolean} allDay
 */
const stampText = (wall, allDay) => {
  const w = wallParts(wall);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}` + (allDay ? '' : ` ${pad(w.h)}:${pad(w.mi)}`);
};

/**
 * The events (not tasks) of `icsText` as plain data, for scripts: { uid, summary, location, description, allDay,
 * start, end, repeat, rrule, cancelled }. `start` and `end` are "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" in `zone`
 * (the device's own zone if omitted). `repeat` is an Org repeater such as "+1w" when the recurrence is a simple
 * one, else null with the raw rule in `rrule`. Recurrences are not expanded.
 * @param {string} icsText
 */
function parseIcalendarEvents(icsText, { zone = null, max = 2000 } = {}) {
  const events = [];
  for (const component of collectComponents(icsText)) {
    if (component.type !== 'VEVENT') continue;
    const props = component.props;
    /** @param {string} name */
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
