
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
  dateKey,
  isSameDay,
};
