// @ts-check
/**
 * New diary-sexp forms for the agenda -- org-anniversary, org-cyclic,
 * org-block, diary-float, and the solar functions below. Each of
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
import { nthNamedAbsday, gregorianFromAbsolute, lastDayOfMonth } from './calendar-conv.js';
import { emacsSunriseSunset } from './solar-emacs.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS = 10000; // safety valve, matching agenda.js's own precedent throughout

/** @param {number} year */
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** "st"/"nd"/"rd"/"th" for `n` -- real diary-anniversary's own %s
 *  placeholder, confirmed directly against its docstring: 11th/12th/
 *  13th (and their multiples of 100, e.g. 111th) are always "th"
 *  despite ending in 1/2/3, matching the standard English ordinal
 * @param {number} n
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
 * @param {any} [rangeStart]
 * @param {any} [rangeEnd]
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
 * @param {string} line
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
 *  at all.
 *
 *  `afterYear`, when given, is the anniversary's own start year: like
 *  real diary-anniversary (the Emacs manual: "applies to October 31 in
 *  any year after 1948"), it applies only to years AFTER that one -- so
 *  no "-8th birthday" before the person was born, and no "0th" in the
 * @param {number} month
 * @param {number} day
 * @param {any} [rangeStart]
 * @param {any} [rangeEnd]
 *  year itself. */
function expandOrgAnniversaryOccurrences(month, day, rangeStart, rangeEnd, afterYear = /** @type {number | null} */ (null)) {
  const rangeStartDay = startOfDay(rangeStart);
  const rangeEndDay = endOfDay(rangeEnd);
  const dates = [];
  for (let year = rangeStart.getFullYear(); year <= rangeEnd.getFullYear(); year++) {
    if (afterYear !== null && year <= afterYear) continue;
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
 * @param {string} template
 * @param {number} age
 *  confirmed two placeholders, nothing else recognized. */
function formatOrgAnniversaryTitle(template, age) {
  return template.replace(/%d/g, String(age)).replace(/%s/g, ordinalSuffix(age));
}

// ---- quoted month list in diary-float ------------------------------------------

/** Emacs writes diary-float's month list quoted -- `(diary-float '(1 4 7 10)
 *  4 3)` -- so this drops that quote before the line is matched. Nothing
 *  else is rewritten: in particular the standard diary-anniversary /
 *  diary-cyclic / diary-block / diary-date are NOT translated into their
 *  org-* twins. Their argument order depends on calendar-date-style (month
 *  day year by default), so the same line would mean different dates under
 * @param {string} line
 *  different settings; the org-* versions always read year month day. */
function unquoteDiaryFloatMonthList(line) {
  return line.replace(/^(%%\(diary-float\s+)'(?=\()/, '$1');
}

// ---- org-cyclic ---------------------------------------------------------

const ORG_CYCLIC_RE = /^%%\(org-cyclic\s+(\d+)\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\)\s*(.*)$/;

/** Parses an org-cyclic line into { n, year, month, day, title },
 *  or null if it doesn't match -- N (the day interval), the 4-digit
 *  baseline year, and a 1-12 month / 1-31 day with no leading zeros,
 * @param {string} line
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
 * @param {number} n
 * @param {Date} baselineDate
 * @param {any} [rangeStart]
 * @param {any} [rangeEnd]
 *  before it. */
function expandOrgCyclicOccurrences(n, baselineDate, rangeStart, rangeEnd) {
  const baselineDay = startOfDay(baselineDate);
  const rangeStartDay = startOfDay(rangeStart);
  const rangeEndDay = endOfDay(rangeEnd);
  if (rangeEndDay < baselineDay) return [];

  const searchStart = rangeStartDay > baselineDay ? rangeStartDay : baselineDay;
  const diffDays = Math.round((searchStart.getTime() - baselineDay.getTime()) / MS_PER_DAY);
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
 *  in the source; a block written "backwards" (end date first) covers
 * @param {string} line
 *  no day, as in Emacs. */
function parseOrgBlockLine(line) {
  const m = ORG_BLOCK_RE.exec(line.trim());
  if (!m) return null;
  const [y1, mo1, d1, y2, mo2, d2] = m.slice(1, 7).map(Number);
  if (mo1 < 1 || mo1 > 12 || d1 < 1 || d1 > 31 || mo2 < 1 || mo2 > 12 || d2 < 1 || d2 > 31) return null;
  return { dateA: new Date(y1, mo1 - 1, d1), dateB: new Date(y2, mo2 - 1, d2), title: m[7] };
}

/** Every day from `dateA` to `dateB` (inclusive; none when `dateB` is earlier),
 * @param {Date} dateA
 * @param {Date} dateB
 * @param {any} [rangeStart]
 * @param {any} [rangeEnd]
 *  intersected with [rangeStart, rangeEnd]. */
function expandOrgBlockOccurrences(dateA, dateB, rangeStart, rangeEnd) {
  const windowStart = dateA > rangeStart ? dateA : rangeStart;
  const windowEnd = dateB < rangeEnd ? dateB : rangeEnd;
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
 * @param {string} line
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

  const trailing = m[4].trim().split(/\s+/).filter(Boolean).map(Number);
  /** @type {number | null} */
  let day = null;
  /** @type {number | null} */
  let year = null;
  // (diary-float MONTH DAYNAME N &optional DAY MARK): the fifth argument is a face for the calendar, not a year
  if (trailing.length) day = trailing[0];
  if (day !== null && (day < 1 || day > 31)) return null;

  return { monthSpec, dayname, n, day, year, title: m[5] };
}

/** Whether `month` (1-12) matches `monthSpec` -- 't' matches every
 * @param {number | number[] | string} monthSpec
 * @param {number} month
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
 * @param {number} year
 * @param {number} month
 * @param {number} dayname
 * @param {number} n
 * @param {number | null} dayOverride
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

/** Every day in [rangeStart, rangeEnd] on which a `diary-float` entry applies (see diaryFloatMatches).
 * @param {number | number[] | string} monthSpec
 * @param {number} dayname
 * @param {number} n
 * @param {number | null} dayOverride
 * @param {unknown} _mark the calendar face of Emacs's fifth argument, which has no effect on the days
 * @param {Date} rangeStart
 * @param {Date} rangeEnd */
function expandDiaryFloatOccurrences(monthSpec, dayname, n, dayOverride, _mark, rangeStart, rangeEnd) {
  const dates = [];
  for (let d = startOfDay(rangeStart); d <= endOfDay(rangeEnd); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    if (diaryFloatMatches(d, monthSpec, dayname, n, dayOverride)) dates.push(d);
  }
  return dates;
}

/**
 * `diary-float` as diary-lib.el decides it for one date: the date is the Nth DAYNAME after (before, when N is negative) MONTH DAY,
 * where that base day may lie in the month before or after the date's own.
 * @param {Date} date
 * @param {number | number[] | string} monthSpec
 * @param {number} dayname
 * @param {number} n
 * @param {number | null} day
 */
function diaryFloatMatches(date, monthSpec, dayname, n, day) {
  if (date.getDay() !== dayname) return false;
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const y = date.getFullYear();
  const limit = nthNamedAbsday(-n, dayname, m, y, d); // last (n > 0) or first (n < 0) possible base date
  const lastAbs = n > 0 ? limit : limit + 6;
  const firstAbs = n > 0 ? limit - 6 : limit;
  const [m1, d1, y1] = gregorianFromAbsolute(firstAbs);
  const [m2, d2, y2] = gregorianFromAbsolute(lastAbs);
  const baseDay = (/** @type {number} */ month, /** @type {number} */ year) => day ?? (n > 0 ? 1 : lastDayOfMonth(month, year));
  if (m1 === m2) return monthSpecMatches(monthSpec, m1) && d1 <= baseDay(m1, y1) && baseDay(m1, y1) <= d2;
  return (y1 < y2 || (y1 === y2 && m1 < m2)) && ((monthSpecMatches(monthSpec, m1) && d1 <= baseDay(m1, y1)) || (monthSpecMatches(monthSpec, m2) && baseDay(m2, y2) <= d2));
}

// ---- solar position ---------------------------------------------------------

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
 * @param {any} [date]
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
 *  latitude near the poles legitimately could. `angleDegrees` is how
 *  far below the horizon the sun's own center must be for this to
 *  count as "risen"/"set" -- defaults to -0.61, the value Emacs's
 *  solar.el uses for sunrise and sunset; -6, -12 and -18 degrees
 *  give the civil, nautical and astronomical twilights. */
/** The sun's own declination (radians) and solar transit (Julian
 *  day) for `date` at `longitude` -- factored out of
 *  computeSunriseSunsetUtc so computeDaylightHours below can reuse
 *  the exact same computation for its own polar-day/night
 *  disambiguation, rather than a second, independently-written copy
 *  of the same formula that could subtly drift out of sync with it.
 *  Declination genuinely does have a (very small) longitude
 *  dependence in this specific NOAA-style formula -- longitude feeds
 *  into meanSolarNoon before the mean anomaly is computed -- so this
 * @param {any} date
 * @param {number} longitude
 *  takes longitude too, not just date, to stay exactly consistent. */
function computeSolarPosition(date, longitude) {
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
  return { declination, solarTransit };
}

/**
 * @param {any} date
 * @param {number} latitude
 * @param {any} [longitude]
 */
function computeSunriseSunsetUtc(date, latitude, longitude, angleDegrees = -0.61) {
  const { declination, solarTransit } = computeSolarPosition(date, longitude);
  const latRad = latitude * RAD;
  const cosHourAngle =
    (Math.sin(angleDegrees * RAD) - Math.sin(latRad) * Math.sin(declination)) / (Math.cos(latRad) * Math.cos(declination));
  if (cosHourAngle > 1 || cosHourAngle < -1) return null; // sun never rises, or never sets, that day at this latitude, for this angle

  const hourAngle = Math.acos(cosHourAngle) / RAD;
  const julianSunset = solarTransit + hourAngle / 360;
  const julianSunrise = solarTransit - hourAngle / 360;

  /** @param {number} jdValue */
  const julianToUtcHours = (jdValue) => {
    const fractionalDay = jdValue - Math.floor(jdValue) - 0.5;
    return ((fractionalDay * 24) % 24 + 24) % 24;
  };
  return { sunrise: julianToUtcHours(julianSunrise), sunset: julianToUtcHours(julianSunset) };
}

/** Total daylight duration for `date` at the given location, in
 *  decimal hours -- reuses computeSunriseSunsetUtc for the ordinary
 *  case (sunset minus sunrise, correctly handling the UTC wraparound
 *  past midnight for a west-of-Greenwich longitude). For the polar
 *  day/night edge case (computeSunriseSunsetUtc returns null, since
 *  there's no sunrise/sunset crossing that day at all), determines
 *  which of the two genuinely different cases actually applies --
 *  continuous daylight (24) or continuous night (0) -- via the
 *  standard solar-noon-elevation formula (90 minus the absolute
 *  difference between latitude and declination, both in degrees):
 *  if even solar noon doesn't clear the horizon, the sun never rises
 *  at all that day; otherwise, since computeSunriseSunsetUtc already
 *  confirmed there's no crossing, it never sets. Reuses
 *  computeSolarPosition directly rather than a second, independently
 * @param {any} date
 * @param {number} latitude
 * @param {any} [longitude]
 *  re-derived copy of the same declination formula. */
function computeDaylightHours(date, latitude, longitude, angleDegrees = -0.61) {
  const result = computeSunriseSunsetUtc(date, latitude, longitude, angleDegrees);
  if (result) {
    let hours = result.sunset - result.sunrise;
    if (hours < 0) hours += 24;
    return hours;
  }
  const { declination } = computeSolarPosition(date, longitude);
  const noonElevation = 90 - Math.abs(latitude - declination / RAD);
  return noonElevation > angleDegrees ? 24 : 0;
}

/** Emacs's solar-daylight: a length of time in hours as "H:MM" (truncated, not rounded).
 * @param {number} hours */
function solarDaylight(hours) {
  const h = Math.floor(hours);
  return `${h}:${String(Math.floor(60 * (hours - h))).padStart(2, '0')}`;
}

/** The device's offset from UTC on `date`, in minutes east (daylight saving included).
 * @param {Date} date */
function localOffsetMinutes(date) {
  return -new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTimezoneOffset();
}

/** The device's short time zone name on `date`, such as "EDT".
 * @param {Date} date */
function timeZoneName(date) {
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(noon).find((p) => p.type === 'timeZoneName');
  return part ? part.value : '';
}

/** The device's short time zone name at `instant`, such as "EDT".
 * @param {Date} instant */
function zoneNameAt(instant) {
  const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(instant).find((p) => p.type === 'timeZoneName');
  return part ? part.value : '';
}

/** Emacs's solar-sunrise-sunset for `date`: local sunrise and sunset in decimal hours (null on a day without one) and the
 *  length of the daylight as "H:MM". `height` is the angle of the sun's center to the horizon; Emacs uses -0.61 for sunrise and
 *  sunset, and this takes -6, -12 and -18 as well for the civil, nautical and astronomical twilights.
 *  As in dst-adjust-time, each event is a time of standard time moved to daylight saving time when that is in effect at that moment,
 *  and it counts only if it then falls on `date` (a place far from the device's own zone loses events that land on another day).
 *  `riseZone` and `setZone` name the zone of each event; `zone` is the one for the day.
 * @param {Date} date @param {number} latitude @param {number} longitude @param {number} [height]
 * @returns {{ rise: number | null, set: number | null, daylight: string, zone: string, riseZone: string, setZone: string }} */
function solarSunriseSunset(date, latitude, longitude, height = -0.61) {
  const standard = Math.min(localOffsetMinutes(new Date(date.getFullYear(), 0, 1)), localOffsetMinutes(new Date(date.getFullYear(), 6, 1)));
  const sun = emacsSunriseSunset(date.getMonth() + 1, date.getDate(), date.getFullYear(), latitude, longitude, standard, height);
  const midnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  /** @param {number | null} h */
  const local = (h) => {
    if (h === null) return { time: null, zone: '' };
    const minutes = Math.round(60 * h);
    const instant = new Date(midnight + (minutes - standard) * 60000);
    const saving = -instant.getTimezoneOffset() - standard;
    const total = minutes + saving;
    return { time: total >= 0 && total < 1440 ? total / 60 : null, zone: zoneNameAt(instant) };
  };
  const rise = local(sun.rise);
  const set = local(sun.set);
  return { rise: rise.time, set: set.time, daylight: solarDaylight(sun.length), zone: timeZoneName(date), riseZone: rise.zone, setZone: set.zone };
}

export {
  ordinalSuffix,
  parseOrgAnniversaryLine,
  expandOrgAnniversaryOccurrences,
  unquoteDiaryFloatMonthList,
  formatOrgAnniversaryTitle,
  parseOrgCyclicLine,
  expandOrgCyclicOccurrences,
  parseOrgBlockLine,
  expandOrgBlockOccurrences,
  enumerateDays,
  parseDiaryFloatLine,
  monthSpecMatches,
  nthWeekdayOfMonth,
  diaryFloatMatches,
  expandDiaryFloatOccurrences,
  computeSunriseSunsetUtc,
  computeDaylightHours,
  solarSunriseSunset,
  solarDaylight,
  timeZoneName,
};
