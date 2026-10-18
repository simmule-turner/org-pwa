/**
 * The diary's display-only calendar lines: diary-day-of-year, diary-iso-date, diary-julian-date,
 * diary-astro-day-number and diary-lunar-phases. Each returns the text Emacs shows for the day, or
 * null when there is nothing (diary-lunar-phases on a day without a quarter). Wording follows Emacs 29.3.
 * The moon's phase times follow lunar.el; the time of day is shown in the device's time zone.
 */

const MS_PER_DAY = 86400000;
const UNIX_EPOCH_ABSOLUTE = 719163; // calendar-absolute-from-gregorian of 1 January 1970
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Days since 1 January of year 1 (Emacs's "absolute" day number) of a Gregorian date.
 * @param {number} year @param {number} month @param {number} day */
export function absoluteFromGregorian(year, month, day) {
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, day);
  return Math.round(t.getTime() / MS_PER_DAY) + UNIX_EPOCH_ABSOLUTE;
}

/** @param {number} abs @returns {[number, number, number]}  [month, day, year] */
function gregorianFromAbsolute(abs) {
  const t = new Date((abs - UNIX_EPOCH_ABSOLUTE) * MS_PER_DAY);
  return [t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCFullYear()];
}

/** @param {number} year */
const isLeap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** "Day 290 of 2026; 75 days remaining in the year"
 * @param {number} year @param {number} month @param {number} day */
export function dayOfYearLine(year, month, day) {
  const n = absoluteFromGregorian(year, month, day) - absoluteFromGregorian(year, 1, 1) + 1;
  const left = (isLeap(year) ? 366 : 365) - n;
  return `Day ${n} of ${year}; ${left} day${left === 1 ? '' : 's'} remaining in the year`;
}

/** "ISO date: Day 6 of week 42 of 2026" (Monday is day 1)
 * @param {number} year @param {number} month @param {number} day */
export function isoDateLine(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const isoYear = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(isoYear, 0, 1)) / MS_PER_DAY + 1) / 7);
  return `ISO date: Day ${weekday} of week ${week} of ${isoYear}`;
}

/** "Julian date: October 4, 2026" -- the same day in the Julian calendar
 * @param {number} year @param {number} month @param {number} day */
export function julianDateLine(year, month, day) {
  const jdn = absoluteFromGregorian(year, month, day) + 1721425; // Julian day number at noon
  const c = jdn + 32082;
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const jDay = e - Math.floor((153 * m + 2) / 5) + 1;
  const jMonth = m + 3 - 12 * Math.floor(m / 10);
  const jYear = d - 4800 + Math.floor(m / 10);
  if (jYear < 1) return null;
  return `Julian date: ${MONTH_NAMES[jMonth - 1]} ${jDay}, ${jYear}`;
}

/** "Astronomical (Julian) day number at noon UTC: 2461331.0"
 * @param {number} year @param {number} month @param {number} day */
export function astroDayNumberLine(year, month, day) {
  return `Astronomical (Julian) day number at noon UTC: ${absoluteFromGregorian(year, month, day) + 1721425}.0`;
}

// ---- the moon (lunar.el) ----------------------------------------------------------------------

const RAD = Math.PI / 180;
const sinDeg = (/** @type {number} */ x) => Math.sin(x * RAD);
const cosDeg = (/** @type {number} */ x) => Math.cos(x * RAD);
const mod = (/** @type {number} */ a, /** @type {number} */ b) => a - b * Math.floor(a / b);
const PHASE_NAMES = ['New Moon', 'First Quarter Moon', 'Full Moon', 'Last Quarter Moon'];

/** Ephemeris time minus Universal Time in days (solar-ephemeris-correction): the formula for 1988-2019 and the long-range one
 * Emacs uses after 2020. Emacs subtracts it from a time zone in minutes, so it moves a phase by under a tenth of a second.
 * @param {number} year */
function ephemerisCorrection(year) {
  if (year >= 1988 && year < 2020) return (year - 2000 + 67) / 60 / 60 / 24;
  const tmp = absoluteFromGregorian(year, 1, 1) + 1721424.5 - 2382148;
  return ((tmp * tmp) / 41048480 - 15) / 60 / 60 / 24;
}

/**
 * The time of lunar phase `index` (4 per lunation, counted from 1900) as an absolute day with a fraction,
 * in local standard time `tzMinutes` east of UTC, as lunar-phase computes it.
 * @param {number} index
 * @param {number} tzMinutes
 * @returns {{ abs: number, phase: number }}
 */
function lunarPhase(index, tzMinutes) {
  const phase = mod(index, 4);
  const k = index / 4;
  const time = k / 1236.85;
  let date = 693595.5 + 0.75933 + 29.53058868 * k + 0.0001178 * time * time - 0.000000155 * time ** 3 + 0.00033 * sinDeg(166.56 + 132.87 * time - 0.009173 * time * time);
  const sunAnomaly = mod(359.2242 + 29.105356 * k - 0.0000333 * time * time - 0.00000347 * time ** 3, 360);
  const moonAnomaly = mod(306.0253 + 385.81691806 * k + 0.0107306 * time * time + 0.00001236 * time ** 3, 360);
  const moonLat = mod(21.2964 + 390.67050646 * k - 0.0016528 * time * time - 0.00000239 * time ** 3, 360);
  let adjustment;
  if (phase === 0 || phase === 2) {
    adjustment =
      (0.1734 - 0.000393 * time) * sinDeg(sunAnomaly) + 0.0021 * sinDeg(2 * sunAnomaly) - 0.4068 * sinDeg(moonAnomaly) + 0.0161 * sinDeg(2 * moonAnomaly) -
      0.0004 * sinDeg(3 * moonAnomaly) + 0.0104 * sinDeg(2 * moonLat) - 0.0051 * sinDeg(sunAnomaly + moonAnomaly) - 0.0074 * sinDeg(sunAnomaly - moonAnomaly) +
      0.0004 * sinDeg(2 * moonLat + sunAnomaly) - 0.0004 * sinDeg(2 * moonLat - sunAnomaly) - 0.0006 * sinDeg(2 * moonLat + moonAnomaly) +
      0.001 * sinDeg(2 * moonLat - moonAnomaly) + 0.0005 * sinDeg(2 * moonAnomaly + sunAnomaly);
  } else {
    adjustment =
      (0.1721 - 0.0004 * time) * sinDeg(sunAnomaly) + 0.0021 * sinDeg(2 * sunAnomaly) - 0.628 * sinDeg(moonAnomaly) + 0.0089 * sinDeg(2 * moonAnomaly) -
      0.0004 * sinDeg(3 * moonAnomaly) + 0.0079 * sinDeg(2 * moonLat) - 0.0119 * sinDeg(sunAnomaly + moonAnomaly) - 0.0047 * sinDeg(sunAnomaly - moonAnomaly) +
      0.0003 * sinDeg(2 * moonLat + sunAnomaly) - 0.0004 * sinDeg(2 * moonLat - sunAnomaly) - 0.0006 * sinDeg(2 * moonLat + moonAnomaly) +
      0.0021 * sinDeg(2 * moonLat - moonAnomaly) + 0.0003 * sinDeg(2 * moonAnomaly + sunAnomaly) + 0.0004 * sinDeg(sunAnomaly - 2 * moonAnomaly) -
      0.0003 * sinDeg(2 * sunAnomaly + moonAnomaly);
  }
  const adj = 0.0028 - 0.0004 * cosDeg(sunAnomaly) + 0.0003 * cosDeg(moonAnomaly);
  if (phase === 1) adjustment += adj;
  else if (phase === 2) adjustment -= adj;
  date += adjustment;
  const year = gregorianFromAbsolute(Math.trunc(date))[2];
  // Emacs subtracts the correction (in days) from the zone (in minutes) here; it is kept as written
  date += (tzMinutes - ephemerisCorrection(year)) / 60 / 24;
  return { abs: date, phase };
}

/** Elisp `round`: halves go to the even number.
 * @param {number} x */
function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/**
 * The text for a day that has a quarter of the moon ("First Quarter Moon 12:14pm (EDT)"), or null.
 * @param {number} year @param {number} month @param {number} day
 * @param {string} [timeZone]  IANA zone; the device's own when omitted
 */
export function lunarPhasesLine(year, month, day, timeZone) {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetOf = (/** @type {number} */ ms) => {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
    return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000;
  };
  const standard = Math.min(offsetOf(Date.UTC(year, 0, 1)), offsetOf(Date.UTC(year, 6, 1)));
  const dayNumber = absoluteFromGregorian(year, month, day) - absoluteFromGregorian(year, 1, 1) + 1;
  let index = 4 * Math.trunc(12.3685 * (year + dayNumber / 366 - 1900));
  const target = absoluteFromGregorian(year, month, day);
  /** @param {number} i */
  const localOf = (i) => {
    const { abs, phase } = lunarPhase(i, standard);
    const instant = (abs - UNIX_EPOCH_ABSOLUTE) * MS_PER_DAY - standard * 60000; // abs is standard local time
    const local = instant + offsetOf(instant) * 60000;
    return { instant, local, phase };
  };
  let p = localOf(index);
  while (Math.floor(p.local / MS_PER_DAY) + UNIX_EPOCH_ABSOLUTE < target) p = localOf(++index);
  if (Math.floor(p.local / MS_PER_DAY) + UNIX_EPOCH_ABSOLUTE !== target) return null;
  const minutesOfDay = p.local / 60000 - (Math.floor(p.local / MS_PER_DAY) * 1440);
  const total = roundHalfEven(minutesOfDay);
  const h24 = Math.floor(total / 60);
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date(p.instant)).find((x) => x.type === 'timeZoneName')?.value || '';
  return `${PHASE_NAMES[p.phase]} ${1 + ((h24 + 11) % 12)}:${String(total % 60).padStart(2, '0')}${h24 >= 12 ? 'pm' : 'am'} (${name})`;
}
