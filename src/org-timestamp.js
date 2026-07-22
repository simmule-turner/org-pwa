
/**
 * Parses org timestamp strings — the raw <...>/[...] strings the parser
 * already extracts into heading.planning.{scheduled,deadline,closed} — into
 * structured data the agenda view can sort and group by.
 *
 * Handles: active <2026-07-21 Tue> vs inactive [2026-07-21 Tue], optional
 * time (<2026-07-21 Tue 14:30>), and a repeater suffix (+1w, ++1m, .+3d).
 *
 * This module only parses a single timestamp and keeps the repeater
 * string on the returned object — it does not expand a repeater into
 * future occurrences itself. That expansion lives in agenda.js
 * (parseRepeater/expandRepeats), since "which occurrences fall in this
 * displayed range" is inherently an agenda-view concern (it needs a
 * range to expand into), not something a single-timestamp parser should
 * decide on its own.
 */

const TIMESTAMP_RE =
  /^([<[])(\d{4})-(\d{2})-(\d{2})\s+\S+(?:\s+(\d{2}):(\d{2}))?(?:\s+([.+]{1,2}\d+[hdwmy]))?([>\]])$/;

// Same shape as TIMESTAMP_RE but NOT anchored to the whole string and
// marked global, for finding a timestamp embedded anywhere within a
// larger string (a heading title, a line of body text) rather than
// requiring the entire string to be exactly one timestamp.
const TIMESTAMP_SCAN_RE =
  /([<[])(\d{4})-(\d{2})-(\d{2})\s+\S+(?:\s+(\d{2}):(\d{2}))?(?:\s+([.+]{1,2}\d+[hdwmy]))?([>\]])/g;

/** @returns parsed timestamp object, or null if `raw` isn't a recognizable org timestamp. */
function parseOrgTimestamp(raw) {
  if (!raw) return null;
  const m = TIMESTAMP_RE.exec(raw.trim());
  if (!m) return null;

  const [, open, y, mo, d, h, min, repeater, close] = m;
  if (open === '<' && close !== '>') return null;
  if (open === '[' && close !== ']') return null;

  const hasTime = h !== undefined;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), hasTime ? Number(h) : 0, hasTime ? Number(min) : 0);

  return {
    active: open === '<',
    date,
    hasTime,
    repeater: repeater || null,
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

export {
  parseOrgTimestamp,
  findTimestamps,
  dateKey,
  isSameDay,
};
