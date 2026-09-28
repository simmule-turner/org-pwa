/**
 * Org durations (Emacs's org-duration.el), as used by the EFFORT
 * property. Accepted forms, matching that library's own documented set:
 *
 *   3:12            H:MM
 *   1:23:45         H:MM:SS
 *   1y 3d 3h 4min   any of the default units, in any order
 *   1d3h5min        the same, with no spaces (the Org manual's own example)
 *   3d 13:35        units followed by an H:MM(:SS) part
 *   2.35h           decimal numbers
 *   30              a bare number is minutes
 *   (empty)         0
 *
 * Anything else is invalid (null here; an error in Emacs). Units are
 * Emacs's default org-duration-units: min=1, h=60, d=24h, w=7d,
 * m=30d (a MONTH -- minutes are "min"), y=365.25d. Custom units and
 * range durations are not supported.
 *
 * Returns minutes as a number (fractional for decimals or seconds), or
 * null when `text` isn't a valid duration.
 */
const UNIT_MINUTES = {
  min: 1,
  h: 60,
  d: 60 * 24,
  w: 60 * 24 * 7,
  m: 60 * 24 * 30,
  y: 60 * 24 * 365.25,
};

const BARE_NUMBER_RE = /^\d+(?:\.\d*)?$/;
const TRAILING_HMS_RE = /(?:^|\s)(\d+):(\d{2})(?::(\d{2}))?$/;
const UNIT_PART_RE = /\s*(\d+(?:\.\d*)?)\s*(min|h|d|w|m|y)/y;

function parseOrgDuration(text) {
  const s = String(text == null ? '' : text).trim();
  if (s === '') return 0;
  if (BARE_NUMBER_RE.test(s)) return Number(s);

  let total = 0;
  let rest = s;

  const hms = TRAILING_HMS_RE.exec(rest);
  if (hms) {
    total += Number(hms[1]) * 60 + Number(hms[2]) + (hms[3] ? Number(hms[3]) / 60 : 0);
    rest = rest.slice(0, hms.index).trim();
  }

  let pos = 0;
  while (pos < rest.length) {
    UNIT_PART_RE.lastIndex = pos;
    const m = UNIT_PART_RE.exec(rest);
    if (!m) return null;
    total += Number(m[1]) * UNIT_MINUTES[m[2]];
    pos = UNIT_PART_RE.lastIndex;
  }
  return total;
}

export { parseOrgDuration };
