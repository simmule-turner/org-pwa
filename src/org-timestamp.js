// @ts-check

/**
 * Parses org timestamp strings — the raw <...>/[...] strings the parser
 * already extracts into heading.planning.{scheduled,deadline,closed} — into
 * structured data the agenda view can sort and group by.
 *
 * Handles: active <2026-07-21 Tue> vs inactive [2026-07-21 Tue], optional
 * time (<2026-07-21 Tue 14:30>), a repeater suffix (+1w, ++1m, .+3d), and
 * a delay/warning-period suffix (-3d) — real org syntax for "start
 * showing this on the agenda N days before its actual date," used
 * almost exclusively on DEADLINE (so an upcoming deadline gives advance
 * warning instead of only appearing the day it's due). Distinguished
 * from a repeater by the single leading `-` versus `+`/`++`/`.+`.
 *
 * This module only parses a single timestamp and keeps the repeater/
 * delay strings on the returned object — it does not expand a repeater
 * into future occurrences, or act on a delay's warning window, itself.
 * That's agenda.js's job (parseRepeater/expandRepeats and the delay-
 * aware equivalent), since both are inherently agenda-view concerns (a
 * range to expand into, "today" to warn ahead of), not something a
 * single-timestamp parser should decide on its own.
 */

// A whole timestamp as org-element reads it: the date, then (after one space) anything but a closing bracket, then a closer. The two brackets
// need not match -- the opener alone says active or inactive -- and everything after the date is read loosely, as below.
const TIMESTAMP_RE = /^([<[])(\d{4})-(\d{2})-(\d{2})((?: [^\]>\n]*?)?)[\]>]$/;
// org-parse-time-string: after the date, an optional weekday (anything but a digit, "+", "-", a bracket or a space), then " H:MM"
const CLOCK_RE = /^(?: +[^\]+0-9>\n -]+)? +(\d{1,2}):(\d{2})/;
const RANGE_RE = /[012]?[0-9]:[0-5][0-9]-([012]?[0-9]):([0-5][0-9])/;
// the repeater and the warning are found anywhere in the text, in either order (a habit's "/4d" range stays with its repeater)
const REPEATER_RE = /([.+]?\+)(\d+)([hdwmy])(\/\d+[hdwmy])?/i;
const WARNING_RE = /(-)?-(\d+)([hdwmy])/i;
// Emacs matches the unit without regard to case, then takes anything but a lower-case h, d, w or m for years
/** @param {string} unit */
const unitOf = (unit) => ('hdwm'.includes(unit) ? unit : 'y');

// The same opening and closing, not anchored to the whole string and marked global, for finding timestamps embedded anywhere in a
// larger string (a heading title, a line of body text); each hit is then read by parseOrgTimestamp, which decides if it is one.
const TIMESTAMP_SCAN_RE = /[<[]\d{4}-\d{2}-\d{2}[^<>[\]\n]*[>\]]/g;

/**
 * @returns parsed timestamp object, or null if `raw` isn't a recognizable org timestamp.
 * @param {string | undefined} raw
 */
function parseOrgTimestamp(raw) {
  if (!raw) return null;
  const m = TIMESTAMP_RE.exec(raw);
  if (!m) return null;

  const [text, open, y, mo, d, rest] = m;
  const clock = CLOCK_RE.exec(rest);
  const range = RANGE_RE.exec(rest);
  const rep = REPEATER_RE.exec(text);
  const warn = WARNING_RE.exec(text);
  const repeater = rep ? `${rep[1]}${rep[2]}${unitOf(rep[3])}${rep[4] || ''}` : null;
  const delay = warn ? `${warn[1] ? '--' : '-'}${warn[2]}${unitOf(warn[3])}` : null;

  const hasTime = clock !== null;
  /** @param {number} h @param {number} min */
  const at = (h, min) => {
    const date = new Date(2000, Number(mo) - 1, Number(d), h, min);
    date.setFullYear(Number(y));
    return date;
  };
  const date = at(hasTime ? Number(clock[1]) : 0, hasTime ? Number(clock[2]) : 0);
  // A time RANGE (08:00-09:00) is always within the same calendar day as
  // the start -- real org's own syntax for a range spanning multiple
  // days is two separate timestamps joined by "--", a different
  // construct entirely, not this single-timestamp form.
  const endDate = hasTime && range ? at(Number(range[1]), Number(range[2])) : null;

  return {
    active: open === '<',
    date,
    hasTime,
    endDate,
    repeater,
    delay,
    raw,
  };
}

/**
 * Finds every org timestamp written anywhere within `text` — not a
 * standalone planning-line value (that's parseOrgTimestamp), but a
 * timestamp embedded directly in a heading title or a line of body text.
 * This is genuine, standard org syntax: real org-mode's agenda picks up
 * a plain timestamp anywhere in an entry as a separate source from
 * SCHEDULED:/DEADLINE:, the conventional way to track something like a
 * recurring birthday directly on its own heading line. Returns parsed
 * timestamp objects (same shape as parseOrgTimestamp's) in the order
 * found, reusing that same parser/validator for each match rather than
 * duplicating its bracket-matching logic.
 * @param {string} text
 */
function findTimestamps(text) {
  if (!text) return [];
  const results = [];
  TIMESTAMP_SCAN_RE.lastIndex = 0;
  let m;
  while ((m = TIMESTAMP_SCAN_RE.exec(text))) {
    const parsed = parseOrgTimestamp(m[0]);
    if (parsed) results.push(parsed);
  }
  return results;
}

/** YYYY-MM-DD, using local calendar fields (not UTC) — an agenda day
 * @param {Date} date
 *  boundary should match the user's own calendar, not the server's. */
function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * @param {Date} a
 * @param {Date} b
 */
function isSameDay(a, b) {
  return dateKey(a) === dateKey(b);
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Builds a valid org timestamp string from structured fields — the
 * inverse of parseOrgTimestamp, for a structured editor to construct a
 * raw value from form fields rather than requiring the user to
 * hand-type org syntax.
 *
 *   date (required) — a Date; only its Y/M/D fields are used (time is
 *     controlled separately by `time` below, not by the Date's own
 *     hours/minutes)
 *   time — 'HH:MM' string, or null/omitted for a date-only timestamp
 *   repeaterMark — '+' | '++' | '.+' | null (real org's three repeater
 *     kinds — see agenda.js's expandRepeats for why this app doesn't
 *     distinguish between them when displaying, but the mark is still
 *     preserved faithfully in the written timestamp either way)
 *   repeaterValue — 'Nunit' (e.g. '1w'), required if repeaterMark is set
 *   delayValue — 'Nunit' (e.g. '3d'), or null/omitted for no delay
 *   active — true for <...> (the default), false for [...]
 *
 * Throws on a missing/invalid date rather than silently building a
 * malformed timestamp — this is meant to be called with values a form
 * has already validated, not raw user text (that's setPlanningFromText's
 * job, which validates by round-tripping through parseOrgTimestamp).
 */
function formatOrgTimestamp(/** @type {any} */ { date, time = /** @type {string | null} */ (null), endTime = /** @type {string | null} */ (null), repeaterMark = /** @type {string | null} */ (null), repeaterValue = /** @type {string | null} */ (null), delayValue = /** @type {string | null} */ (null), active = true }) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('formatOrgTimestamp requires a valid Date');
  }
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const dayName = DAY_NAMES[date.getDay()];

  const parts = [`${y}-${mo}-${d} ${dayName}`];
  if (time) parts.push(endTime ? `${time}-${endTime}` : time); // an end time only goes with a start: 09:00-10:00
  if (repeaterMark && repeaterValue) parts.push(`${repeaterMark}${repeaterValue}`);
  if (delayValue) parts.push(`-${delayValue}`);

  const inner = parts.join(' ');
  return active ? `<${inner}>` : `[${inner}]`;
}

/** "HH:MM" plus some minutes, as "HH:MM", or '' when that would pass the end of the day (an org time range stays within the day).
 * @param {string} time @param {number} minutes */
function addMinutesToTime(time, minutes) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  if (!m) return '';
  const total = Number(m[1]) * 60 + Number(m[2]) + minutes;
  if (total > 23 * 60 + 59) return '';
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const DELAY_RE = /^-(\d+)([hdwmy])$/;

/** Parses a delay string (e.g. "-3d") into { amount, unit }, or null if
 *  it doesn't match. Mirrors agenda.js's parseRepeater in shape, but
 *  lives here rather than there since a delay is purely a single-
 *  timestamp-parsing concern (unlike a repeater, it has no expansion
 *  behavior for agenda.js to own) — used by the structured timestamp
 * @param {string} raw
 *  editor to pre-fill its delay field from an existing timestamp. */
function parseDelay(raw) {
  if (!raw) return null;
  const m = DELAY_RE.exec(raw);
  if (!m) return null;
  return { amount: Number(m[1]), unit: m[2] };
}

export {
  parseOrgTimestamp,
  findTimestamps,
  formatOrgTimestamp,
  addMinutesToTime,
  parseDelay,
  dateKey,
  isSameDay,
};
