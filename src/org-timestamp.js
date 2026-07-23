
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

const TIMESTAMP_RE =
  /^([<[])(\d{4})-(\d{2})-(\d{2})\s+\S+(?:\s+(\d{2}):(\d{2}))?(?:\s+([.+]{1,2}\d+[hdwmy]))?(?:\s+(-\d+[hdwmy]))?([>\]])$/;

// Same shape as TIMESTAMP_RE but NOT anchored to the whole string and
// marked global, for finding a timestamp embedded anywhere within a
// larger string (a heading title, a line of body text) rather than
// requiring the entire string to be exactly one timestamp.
const TIMESTAMP_SCAN_RE =
  /([<[])(\d{4})-(\d{2})-(\d{2})\s+\S+(?:\s+(\d{2}):(\d{2}))?(?:\s+([.+]{1,2}\d+[hdwmy]))?(?:\s+(-\d+[hdwmy]))?([>\]])/g;

/** @returns parsed timestamp object, or null if `raw` isn't a recognizable org timestamp. */
function parseOrgTimestamp(raw) {
  if (!raw) return null;
  const m = TIMESTAMP_RE.exec(raw.trim());
  if (!m) return null;

  const [, open, y, mo, d, h, min, repeater, delay, close] = m;
  if (open === '<' && close !== '>') return null;
  if (open === '[' && close !== ']') return null;

  const hasTime = h !== undefined;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), hasTime ? Number(h) : 0, hasTime ? Number(min) : 0);

  return {
    active: open === '<',
    date,
    hasTime,
    repeater: repeater || null,
    delay: delay || null,
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
 *  boundary should match the user's own calendar, not the server's. */
function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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
function formatOrgTimestamp({ date, time = null, repeaterMark = null, repeaterValue = null, delayValue = null, active = true }) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('formatOrgTimestamp requires a valid Date');
  }
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const dayName = DAY_NAMES[date.getDay()];

  const parts = [`${y}-${mo}-${d} ${dayName}`];
  if (time) parts.push(time);
  if (repeaterMark && repeaterValue) parts.push(`${repeaterMark}${repeaterValue}`);
  if (delayValue) parts.push(`-${delayValue}`);

  const inner = parts.join(' ');
  return active ? `<${inner}>` : `[${inner}]`;
}

const DELAY_RE = /^-(\d+)([hdwmy])$/;

/** Parses a delay string (e.g. "-3d") into { amount, unit }, or null if
 *  it doesn't match. Mirrors agenda.js's parseRepeater in shape, but
 *  lives here rather than there since a delay is purely a single-
 *  timestamp-parsing concern (unlike a repeater, it has no expansion
 *  behavior for agenda.js to own) — used by the structured timestamp
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
  parseDelay,
  dateKey,
  isSameDay,
};
