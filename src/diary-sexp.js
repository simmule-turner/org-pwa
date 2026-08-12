/**
 * New diary-sexp forms for the agenda -- org-anniversary, org-date-
 * cyclic, org-block, diary-float, and diary-sunrise-sunset. Each of
 * these is a per-line sexp: the line itself, wherever it appears in a
 * heading's body text, both triggers the computation AND (for the
 * first four) supplies the description template that follows the
 * sexp on the same line -- real org's own actual convention for
 * these, confirmed directly against the Org manual's own example:
 * "%%(org-anniversary 1956 5 14) Arthur Dent is %d years old". This
 * is a genuinely different mechanism from org-contacts-anniversaries
 * (a trigger line + a separate property scan, see agenda.js's own
 * comments there) -- these don't need a trigger at all, each line is
 * self-contained.
 */

import { startOfDay, endOfDay } from './agenda.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS = 10000; // safety valve, matching agenda.js's own precedent throughout

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** "st"/"nd"/"rd"/"th" for `n` -- real diary-anniversary's own %s
 *  placeholder, confirmed directly against its docstring: 11th/12th/
 *  13th (and their multiples of 100, e.g. 111th) are always "th"
 *  despite ending in 1/2/3, matching the standard English ordinal
 *  exception. */
function ordinalSuffix(n) {
  const abs = Math.abs(n);
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (abs % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/** Every day in [rangeStart, rangeEnd] (inclusive, day-granularity) --
 *  a small, local day-enumeration helper for the sexp types below that
 *  need "every day in this window" rather than a computed set of
 *  specific occurrence dates. */
function enumerateDays(rangeStart, rangeEnd) {
  const days = [];
  let current = startOfDay(rangeStart);
  const windowEnd = startOfDay(rangeEnd);
  let count = 0;
  while (current <= windowEnd && count < MAX_DAYS) {
    days.push(new Date(current));
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
    count++;
  }
  return days;
}

// ---- org-anniversary --------------------------------------------------------

const ORG_ANNIVERSARY_RE = /^%%\(org-anniversary\s+(-?\d+)\s+(\d{1,2})\s+(\d{1,2})\)\s*(.*)$/;

/** Parses an org-anniversary line into { year, month, day, template },
 *  or null if `line` doesn't match at all. `template` is whatever text
 *  follows the sexp on the same line -- the file author's own
 *  description, with %d/%s as placeholders (see
 *  formatOrgAnniversaryTitle below) -- matching real org's actual
 *  convention rather than a fixed, generated string the way
 *  org-contacts-anniversaries produces. */
function parseOrgAnniversaryLine(line) {
  const m = ORG_ANNIVERSARY_RE.exec(line.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day, template: m[4] };
}

/** Every (month, day) occurrence within [rangeStart, rangeEnd], one
 *  per matching year -- the same shape as agenda.js's own
 *  expandContactEventOccurrences, but with real diary-anniversary's
 *  own confirmed special case added: February 29 is treated as March
 *  1 in a non-leap year, rather than simply not occurring that year
 *  at all. */
function expandOrgAnniversaryOccurrences(month, day, rangeStart, rangeEnd) {
  const rangeStartDay = startOfDay(rangeStart);
  const rangeEndDay = endOfDay(rangeEnd);
  const dates = [];
  for (let year = rangeStart.getFullYear(); year <= rangeEnd.getFullYear(); year++) {
    let m = month;
    let d = day;
    if (month === 2 && day === 29 && !isLeapYear(year)) {
      m = 3;
      d = 1;
    }
    const occurrence = new Date(year, m - 1, d);
    if (occurrence >= rangeStartDay && occurrence <= rangeEndDay) dates.push(occurrence);
  }
  return dates;
}

/** Substitutes `%d` (elapsed years) and `%s` (that number's own
 *  ordinal suffix) into `template` -- real diary-anniversary's own
 *  confirmed two placeholders, nothing else recognized. */
function formatOrgAnniversaryTitle(template, age) {
  return template.replace(/%d/g, String(age)).replace(/%s/g, ordinalSuffix(age));
}

// ---- org-cyclic ---------------------------------------------------------

const ORG_CYCLIC_RE = /^%%\(org-cyclic\s+(\d+)\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\)\s*(.*)$/;

/** Parses an org-cyclic line into { n, year, month, day, title },
 *  or null if it doesn't match -- N (the day interval), the 4-digit
 *  baseline year, and a 1-12 month / 1-31 day with no leading zeros,
 *  exactly the syntax specified. */
function parseOrgCyclicLine(line) {
  const m = ORG_CYCLIC_RE.exec(line.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const year = Number(m[2]);
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (n < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { n, year, month, day, title: m[5] };
}

/** Every date within [rangeStart, rangeEnd] that's exactly N days
 *  after the baseline date, or a whole multiple of N days after it --
 *  flags the agenda every N days starting from the baseline, never
 *  before it. */
function expandOrgCyclicOccurrences(n, baselineDate, rangeStart, rangeEnd) {
  const baselineDay = startOfDay(baselineDate);
  const rangeStartDay = startOfDay(rangeStart);
  const rangeEndDay = endOfDay(rangeEnd);
  if (rangeEndDay < baselineDay) return [];

  const searchStart = rangeStartDay > baselineDay ? rangeStartDay : baselineDay;
  const diffDays = Math.round((searchStart - baselineDay) / MS_PER_DAY);
  const firstK = Math.ceil(diffDays / n);

  const dates = [];
  let count = 0;
  let current = new Date(baselineDay.getFullYear(), baselineDay.getMonth(), baselineDay.getDate() + firstK * n);
  while (current <= rangeEndDay && count < MAX_DAYS) {
    if (current >= rangeStartDay) dates.push(new Date(current));
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + n);
    count++;
  }
  return dates;
}

// ---- org-block -----------------------------------------------------------

const ORG_BLOCK_RE =
  /^%%\(org-block\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\)\s*(.*)$/;

/** Parses an org-block line into { dateA, dateB, title }, or null if
 *  it doesn't match. `dateA`/`dateB` are returned in the order given
 *  in the source -- expandOrgBlockOccurrences below sorts them itself,
 *  so a block written "backwards" (end date first) still works. */
function parseOrgBlockLine(line) {
  const m = ORG_BLOCK_RE.exec(line.trim());
  if (!m) return null;
  const [y1, mo1, d1, y2, mo2, d2] = m.slice(1, 7).map(Number);
  if (mo1 < 1 || mo1 > 12 || d1 < 1 || d1 > 31 || mo2 < 1 || mo2 > 12 || d2 < 1 || d2 > 31) return null;
  return { dateA: new Date(y1, mo1 - 1, d1), dateB: new Date(y2, mo2 - 1, d2), title: m[7] };
}

/** Every day between `dateA` and `dateB` (inclusive, order-
 *  independent), intersected with [rangeStart, rangeEnd]. */
function expandOrgBlockOccurrences(dateA, dateB, rangeStart, rangeEnd) {
  const lo = dateA <= dateB ? dateA : dateB;
  const hi = dateA <= dateB ? dateB : dateA;
  const windowStart = lo > rangeStart ? lo : rangeStart;
  const windowEnd = hi < rangeEnd ? hi : rangeEnd;
  if (startOfDay(windowStart) > startOfDay(windowEnd)) return [];
  return enumerateDays(windowStart, windowEnd);
}

// ---- diary-float -----------------------------------------------------------

// Month: a bare 1-12 integer, a parenthesized list "(1 4 7 10)", or the
// literal "t" (every month). DAYNAME: 0-6. N: signed integer (positive
// counts forward from the start of the search window, negative counts
// backward from its end). Then 0-2 more trailing integers -- an
// optional DAY (search-window override) and/or optional YEAR
// (restricts to one specific year) -- captured together and
// disambiguated in parseDiaryFloatLine below, since a single trailing
// number's own role (DAY vs YEAR) depends on its magnitude when only
// one is given.
const DIARY_FLOAT_RE = /^%%\(diary-float\s+(\([^()]*\)|t|\d{1,2})\s+(\d)\s+(-?\d{1,2})((?:\s+\d{1,4})*)\)\s*(.*)$/;

/** Parses a diary-float line into { monthSpec, dayname, n, day, year,
 *  title }, or null if it doesn't match. `monthSpec` is either the
 *  string 't' (every month), an array of 1-12 integers (from a
 *  parenthesized list), or a single 1-12 integer. `day`/`year` are
 *  each either a number or null, disambiguated from the trailing
 *  number(s): with two trailing numbers, the first is always DAY and
 *  the second YEAR (real elisp's own positional calling convention,
 *  (diary-float MONTH DAYNAME N &optional DAY YEAR)); with exactly
 *  one, it's treated as YEAR when greater than 31 (impossible as a
 *  day-of-month) and DAY otherwise. */
function parseDiaryFloatLine(line) {
  const m = DIARY_FLOAT_RE.exec(line.trim());
  if (!m) return null;

  const rawMonth = m[1];
  let monthSpec;
  if (rawMonth === 't') {
    monthSpec = 't';
  } else if (rawMonth.startsWith('(')) {
    monthSpec = rawMonth
      .slice(1, -1)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
    if (monthSpec.some((mo) => mo < 1 || mo > 12)) return null;
  } else {
    monthSpec = Number(rawMonth);
    if (monthSpec < 1 || monthSpec > 12) return null;
  }

  const dayname = Number(m[2]);
  if (dayname < 0 || dayname > 6) return null;
  const n = Number(m[3]);
  if (n === 0) return null; // real elisp: N must be nonzero, no "0th occurrence" concept

  const trailing = m[4].trim().split(/\s+/).filter(Boolean).map(Number);
  let day = null;
  let year = null;
  if (trailing.length === 2) {
    [day, year] = trailing;
  } else if (trailing.length === 1) {
    if (trailing[0] > 31) year = trailing[0];
    else day = trailing[0];
  }
  if (day !== null && (day < 1 || day > 31)) return null;

  return { monthSpec, dayname, n, day, year, title: m[5] };
}

/** Whether `month` (1-12) matches `monthSpec` -- 't' matches every
 *  month, an array checks membership, a bare number checks equality. */
function monthSpecMatches(monthSpec, month) {
  if (monthSpec === 't') return true;
  if (Array.isArray(monthSpec)) return monthSpec.includes(month);
  return monthSpec === month;
}

/** The `n`-th occurrence of `dayname` (0=Sunday..6=Saturday) within
 *  `month` of `year` -- positive `n` counts forward from `dayOverride`
 *  (default day 1 of the month), negative `n` counts backward from
 *  `dayOverride` (default the month's own last day). Returns null if
 *  that occurrence doesn't actually exist within the month (an N too
 *  large for how many times that weekday appears), rather than
 *  spilling into an adjacent month. */
function nthWeekdayOfMonth(year, month, dayname, n, dayOverride) {
  const daysInMonth = new Date(year, month, 0).getDate();
  if (n > 0) {
    let d = dayOverride || 1;
    while (d <= daysInMonth && new Date(year, month - 1, d).getDay() !== dayname) d++;
    if (d > daysInMonth) return null;
    d += (n - 1) * 7;
    if (d > daysInMonth) return null;
    return new Date(year, month - 1, d);
  }
  let d = dayOverride || daysInMonth;
  while (d >= 1 && new Date(year, month - 1, d).getDay() !== dayname) d--;
  if (d < 1) return null;
  d -= (Math.abs(n) - 1) * 7;
  if (d < 1) return null;
  return new Date(year, month - 1, d);
}

/** Every diary-float occurrence within [rangeStart, rangeEnd] --
 *  iterates every (year, month) pair the range spans, computing the
 *  nth-weekday occurrence for each month `monthSpec` matches (and,
 *  when `yearFilter` is given, only for that one specific year). */
function expandDiaryFloatOccurrences(monthSpec, dayname, n, dayOverride, yearFilter, rangeStart, rangeEnd) {
  const rangeStartDay = startOfDay(rangeStart);
  const rangeEndDay = endOfDay(rangeEnd);
  const dates = [];

  let y = rangeStart.getFullYear();
  let mo = rangeStart.getMonth() + 1;
  const endY = rangeEnd.getFullYear();
  const endMo = rangeEnd.getMonth() + 1;
  let guard = 0;
  while ((y < endY || (y === endY && mo <= endMo)) && guard < 2000) {
    if ((yearFilter == null || yearFilter === y) && monthSpecMatches(monthSpec, mo)) {
      const occ = nthWeekdayOfMonth(y, mo, dayname, n, dayOverride);
      if (occ && occ >= rangeStartDay && occ <= rangeEndDay) dates.push(occ);
    }
    mo++;
    if (mo > 12) {
      mo = 1;
      y++;
    }
    guard++;
  }
  return dates;
}

// ---- diary-sunrise-sunset ---------------------------------------------------

// Standard NOAA solar-position algorithm (the widely-used, well-tested
// astronomical formulas for sunrise/sunset given latitude, longitude,
// and date -- accurate to within a minute or two, matching real
// Emacs's own documented accuracy for calendar-sunrise-sunset:
// "Special calendar commands can tell you, to within a minute or two,
// the times of sunrise and sunset for any date"). No trigonometric
// shortcuts specific to this app -- this is the same general-purpose
// algorithm widely implemented for this exact purpose elsewhere.

const RAD = Math.PI / 180;

/** Julian day number for `date` at noon UTC -- the standard
 *  astronomical day-counting system every solar-position formula
 *  below is built on. */
function toJulianDay(date) {
  const y = date.getFullYear();
  const mo = date.getMonth() + 1;
  const d = date.getDate();
  const a = Math.floor((14 - mo) / 12);
  const yy = y + 4800 - a;
  const mm = mo + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

/** Fraction of a full sunrise/sunset day-length calculation --
 *  returns { sunrise, sunset } as fractional hours in UTC (0-24), or
 *  null for a location/date combination where the sun doesn't rise or
 *  set at all that day (polar day/night) -- Durham, NC and virtually
 *  every populated latitude never hits this, but a user-supplied
 *  latitude near the poles legitimately could. */
function computeSunriseSunsetUtc(date, latitude, longitude) {
  const jd = toJulianDay(date);
  const n = jd - 2451545.0 + 0.0008;
  const meanSolarNoon = n - longitude / 360;
  const solarMeanAnomaly = (357.5291 + 0.98560028 * meanSolarNoon) % 360;
  const M = solarMeanAnomaly * RAD;
  const equationOfCenter = 1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M);
  const eclipticLongitude = (solarMeanAnomaly + 102.9372 + equationOfCenter + 180) % 360;
  const lambda = eclipticLongitude * RAD;
  const solarTransit = 2451545.0 + meanSolarNoon + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * lambda);

  const declination = Math.asin(Math.sin(lambda) * Math.sin(23.4397 * RAD));
  const latRad = latitude * RAD;
  const cosHourAngle =
    (Math.sin(-0.83 * RAD) - Math.sin(latRad) * Math.sin(declination)) / (Math.cos(latRad) * Math.cos(declination));
  if (cosHourAngle > 1 || cosHourAngle < -1) return null; // sun never rises, or never sets, that day at this latitude

  const hourAngle = Math.acos(cosHourAngle) / RAD;
  const julianSunset = solarTransit + hourAngle / 360;
  const julianSunrise = solarTransit - hourAngle / 360;

  const julianToUtcHours = (jdValue) => {
    const fractionalDay = jdValue - Math.floor(jdValue) - 0.5;
    return ((fractionalDay * 24) % 24 + 24) % 24;
  };
  return { sunrise: julianToUtcHours(julianSunrise), sunset: julianToUtcHours(julianSunset) };
}

/** "H:MMam"/"H:MMpm", `offsetMinutes` (this app's own equivalent of
 *  real Emacs's calendar-time-zone -- minutes east of UTC, e.g. -240
 *  for EDT) applied to the UTC fractional-hour value first. */
function formatSunTime(utcHours, offsetMinutes) {
  let totalMinutes = Math.round(utcHours * 60 + offsetMinutes);
  totalMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  let h = Math.floor(totalMinutes / 60);
  const mi = totalMinutes % 60;
  const period = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(mi).padStart(2, '0')}${period}`;
}

/** The full diary-sunrise-sunset line for `date` at the given
 *  location -- "Sunrise 7:12am, sunset 5:07pm, 9hr 55min daylight",
 *  matching real diary-sunrise-sunset's own general shape. Returns a
 *  polar-day/night message instead when the sun doesn't rise or set
 *  at all that day. `offsetMinutes` shifts the UTC calculation into
 *  local time -- this app's own equivalent of real Emacs's
 *  calendar-time-zone. Defaults to the browser's own current
 *  timezone offset for `date` (correctly DST-aware) rather than a
 *  separately-configured variable, since a person's own device
 *  timezone virtually always matches wherever their own
 *  calendar-latitude/longitude actually point -- but callers (tests,
 *  or a future explicit setting) can override it directly rather than
 *  being locked to whatever system timezone happens to be running. */
function formatSunriseSunsetLine(date, latitude, longitude, offsetMinutes = -date.getTimezoneOffset()) {
  const result = computeSunriseSunsetUtc(date, latitude, longitude);
  if (!result) return 'Sun does not rise or set at this location today';
  const sunriseStr = formatSunTime(result.sunrise, offsetMinutes);
  let sunsetStr = formatSunTime(result.sunset, offsetMinutes);
  let daylightMinutes = Math.round((result.sunset - result.sunrise) * 60);
  if (daylightMinutes < 0) daylightMinutes += 24 * 60;
  const dh = Math.floor(daylightMinutes / 60);
  const dm = daylightMinutes % 60;
  return `Sunrise ${sunriseStr}, sunset ${sunsetStr}, ${dh}hr ${dm}min daylight`;
}

const DIARY_SUNRISE_SUNSET_RE = /^%%\(diary-sunrise-sunset\)\s*$/;

/** True if `line` is the %%(diary-sunrise-sunset) trigger -- a
 *  self-contained line (no trailing description text; the line
 *  itself both triggers and IS the entry, unlike the other diary-sexp
 *  types above, since real diary-sunrise-sunset always generates its
 *  own full text). */
function isDiarySunriseSunsetLine(line) {
  return DIARY_SUNRISE_SUNSET_RE.test(line.trim());
}

export {
  ordinalSuffix,
  parseOrgAnniversaryLine,
  expandOrgAnniversaryOccurrences,
  formatOrgAnniversaryTitle,
  parseOrgCyclicLine,
  expandOrgCyclicOccurrences,
  parseOrgBlockLine,
  expandOrgBlockOccurrences,
  enumerateDays,
  parseDiaryFloatLine,
  monthSpecMatches,
  nthWeekdayOfMonth,
  expandDiaryFloatOccurrences,
  isDiarySunriseSunsetLine,
  computeSunriseSunsetUtc,
  formatSunTime,
  formatSunriseSunsetLine,
};
