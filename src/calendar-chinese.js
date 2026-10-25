// @ts-check
/**
 * The Chinese calendar of Emacs's cal-china.el, with the astronomy it rests on: the moon's new phases (lunar.el's
 * `lunar-new-moon-time`) and the sun's longitude (solar.el's `solar-longitude`), all for Beijing time. A Chinese year is the list of its
 * months, each starting on a new moon; a month that holds no solar term is a leap month. The holiday functions are those of
 * `holiday-oriental-holidays`, and `calendarChineseDateString` is what `diary-chinese-date` shows.
 */

import { absoluteFromGregorian, gregorianFromAbsolute, dayNumber, incrementMonth, dateIsVisible, lastDayOfMonth } from './calendar-conv.js';

/** @typedef {import('./calendar-conv.js').CalDate} CalDate */
/** @typedef {[number, number]} ChineseMonth  the month number (a half for a leap month) and the absolute day it starts */
/** @typedef {{ date: CalDate, name: string }} Holiday */

const ASTRO = 1721424.5;
/** `calendar-astro-from-absolute` and `-to-absolute`. @param {number} d */
const astroFromAbsolute = (d) => d + ASTRO;
/** @param {number} d */
const astroToAbsolute = (d) => d - ASTRO;

/** Elisp `mod` on floats: fmod, then moved to the sign of the divisor. @param {number} a @param {number} b */
function fmod(a, b) {
  let r = a % b;
  if (b < 0 ? r > 0 : r < 0) r += b;
  return r;
}
const toRadians = (/** @type {number} */ x) => (x / 180) * Math.PI;
const sinDeg = (/** @type {number} */ x) => Math.sin(toRadians(fmod(x, 360)));
/** Elisp `round`: halves go to the even number. @param {number} x */
function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** `solar-ephemeris-correction`: ephemeris time minus universal time in days, by the formula for the year. @param {number} year */
export function ephemerisCorrection(year) {
  if (year >= 1988 && year < 2020) return (year + -2000 + 67.0) / 60.0 / 60.0 / 24.0;
  if ((year >= 1800 && year < 1988)) {
    const theta = (astroFromAbsolute(absoluteFromGregorian([7, 1, year])) - astroFromAbsolute(absoluteFromGregorian([1, 1, 1900]))) / 36525.0;
    const theta2 = theta * theta;
    const theta3 = theta2 * theta;
    const theta4 = theta2 * theta2;
    const theta5 = theta3 * theta2;
    if (year >= 1900) {
      return -0.00002 + 0.000297 * theta + 0.025184 * theta2 + -0.181133 * theta3 + 0.55304 * theta4 + -0.861938 * theta5 + 0.677066 * theta3 * theta3 + -0.212591 * theta4 * theta3;
    }
    return -0.000009 + 0.003844 * theta + 0.083563 * theta2 + 0.865736 * theta3 + 4.867575 * theta4 + 15.845535 * theta5 + 31.332267 * theta3 * theta3 +
      38.291999 * theta4 * theta3 + 28.316289 * theta4 * theta4 + 11.636204 * theta4 * theta5 + 2.043794 * theta5 * theta5;
  }
  if (year >= 1620 && year < 1800) {
    const x = (year - 1600) / 10.0;
    return (2.19167 * x * x + -40.675 * x + 196.58333) / 60.0 / 60.0 / 24.0;
  }
  const tmp = astroFromAbsolute(absoluteFromGregorian([1, 1, year])) - 2382148;
  const second = (tmp * tmp) / 41048480.0 - 15;
  return second / 60.0 / 60.0 / 24.0;
}

// solar-data-list: terms of the sun's longitude
const SOLAR_DATA = [
  [403406, 4.721964, 1.621043], [195207, 5.937458, 62830.348067], [119433, 1.115589, 62830.821524], [112392, 5.781616, 62829.634302],
  [3891, 5.5474, 125660.5691], [2819, 1.512, 125660.984], [1721, 4.1897, 62832.4766], [0, 1.163, 0.813], [660, 5.415, 125659.31],
  [350, 4.315, 57533.85], [334, 4.553, -33.931], [314, 5.198, 777137.715], [268, 5.989, 78604.191], [242, 2.911, 5.412],
  [234, 1.423, 39302.098], [158, 0.061, -34.861], [132, 2.317, 115067.698], [129, 3.193, 15774.337], [114, 2.828, 5296.67],
  [99, 0.52, 58849.27], [93, 4.65, 5296.11], [86, 4.35, -3980.7], [78, 2.75, 52237.69], [72, 4.5, 55076.47], [68, 3.23, 261.08],
  [64, 1.22, 15773.85], [46, 0.14, 188491.03], [38, 3.44, -7756.55], [37, 4.37, 264.89], [32, 1.14, 117906.27], [29, 2.84, 55075.75],
  [28, 5.96, -7961.39], [27, 5.09, 188489.81], [27, 1.72, 2132.19], [25, 2.56, 109771.03], [24, 1.92, 54868.56], [21, 0.09, 25443.93],
  [21, 5.98, -55731.43], [20, 4.03, 60697.74], [18, 4.47, 2132.79], [17, 0.79, 109771.63], [14, 4.24, -7752.82], [13, 2.01, 188491.91],
  [13, 2.65, 207.81], [13, 4.98, 29424.63], [12, 0.93, -7.99], [10, 2.21, 46941.14], [10, 3.59, -68.29], [10, 1.5, 21463.25], [10, 2.55, 157208.4],
];

/**
 * `solar-longitude`: the sun's longitude in degrees on astronomical day number `d` of the time zone `zone` (minutes east of UTC),
 * with no daylight saving time, as the Chinese calendar has it.
 * @param {number} d @param {number} zone
 */
function solarLongitude(d, zone) {
  const aD = astroToAbsolute(d);
  let date = astroFromAbsolute(aD - zone / 60.0 / 24.0);
  date += ephemerisCorrection(gregorianFromAbsolute(Math.floor(astroToAbsolute(date)))[2]);
  const U = (date - 2451545) / 3652500;
  let sum = 0;
  for (const [a, b, c] of SOLAR_DATA) sum += a * Math.sin(fmod(b + c * U, 2 * Math.PI));
  const longitude = 4.9353929 + 62833.196168 * U + 0.0000001 * sum;
  const aberration = 0.0000001 * (17 * Math.cos(3.1 + 62830.14 * U) - 973);
  const A1 = fmod(2.18 + U * (-3375.7 + 0.36 * U), 2 * Math.PI);
  const A2 = fmod(3.51 + U * (125666.39 + 0.1 * U), 2 * Math.PI);
  const nutation = -0.0000001 * (834 * Math.sin(A1) + 64 * Math.sin(A2));
  return fmod((longitude + aberration + nutation) / Math.PI * 180.0, 360.0);
}

/** `solar-date-next-longitude`: the first time after `d` when the sun's longitude is a multiple of `l` degrees. @param {number} d @param {number} l @param {number} zone */
function solarDateNextLongitude(d, l, zone) {
  let start = d;
  const next = fmod(l * (1 + Math.floor(solarLongitude(d, zone) / l)), 360);
  let end = d + (l / 360.0) * 400;
  while (0.00001 < end - start) {
    const mid = (start + end) / 2.0;
    const long = solarLongitude(mid, zone);
    if ((next !== 0 && long < next) || (next === 0 && l < long)) start = mid;
    else end = mid;
  }
  return (start + end) / 2.0;
}

/** `lunar-new-moon-time`: astronomical day number of the `k`th new moon, in the time zone `zone`. @param {number} k @param {number} zone */
function lunarNewMoonTime(k, zone) {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T * T * T;
  const T4 = T2 * T2;
  const JDE = 2451550.09765 + 29.530588853 * k + 0.0001337 * T2 + -0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const sunAnomaly = 2.5534 + 29.10535669 * k + -0.0000218 * T2 + -0.00000011 * T3;
  const moonAnomaly = 201.5643 + 385.81693528 * k + 0.0107438 * T2 + 0.00001239 * T3 + -0.000000058 * T4;
  const moonArgument = 160.7108 + 390.67050274 * k + -0.0016341 * T2 + -0.00000227 * T3 + 0.000000011 * T4;
  const omega = 124.7746 + -1.5637558 * k + 0.0020691 * T2 + 0.00000215 * T3;
  const A = [
    299.77 + 0.107408 * k + -0.009173 * T2, 251.88 + 0.016321 * k, 251.83 + 26.641886 * k, 349.42 + 36.412478 * k, 84.66 + 18.206239 * k,
    141.74 + 53.303771 * k, 207.14 + 2.453732 * k, 154.84 + 7.30686 * k, 34.52 + 27.261239 * k, 207.19 + 0.121824 * k,
    291.34 + 1.844379 * k, 161.72 + 24.198154 * k, 239.56 + 25.513099 * k, 331.55 + 3.592518 * k,
  ];
  const s = sinDeg;
  const M = sunAnomaly;
  const L = moonAnomaly;
  const F = moonArgument;
  const correction =
    -0.4072 * s(L) + 0.17241 * E * s(M) + 0.01608 * s(2 * L) + 0.01039 * s(2 * F) + 0.00739 * E * s(L - M) + -0.00514 * E * s(L + M) +
    0.00208 * E * E * s(2 * M) + -0.00111 * s(L - 2 * F) + -0.00057 * s(L + 2 * F) + 0.00056 * E * s(2 * L + M) + -0.00042 * s(3 * L) +
    0.00042 * E * s(M + 2 * F) + 0.00038 * E * s(M - 2 * F) + -0.00024 * E * s(2 * L - M) + -0.00017 * s(omega) + -0.00007 * s(L + 2 * M) +
    0.00004 * s(2 * L - 2 * F) + 0.00004 * s(3 * M) + 0.00003 * s(L + M + -2 * F) + 0.00003 * s(2 * L + 2 * F) + -0.00003 * s(L + M + 2 * F) +
    0.00003 * s(L - M - -2 * F) + -0.00002 * s(L - M - 2 * F) + -0.00002 * s(3 * L + M) + 0.00002 * s(4 * L);
  const weights = [0.000325, 0.000165, 0.000164, 0.000126, 0.00011, 0.000062, 0.00006, 0.000056, 0.000047, 0.000042, 0.00004, 0.000037, 0.000035, 0.000023];
  let additional = 0;
  for (let i = 0; i < 14; i++) additional += weights[i] * s(A[i]);
  const newJDE = JDE + correction + additional;
  return newJDE + -ephemerisCorrection(gregorianFromAbsolute(Math.floor(astroToAbsolute(newJDE)))[2]) + zone / 60.0 / 24.0;
}

/** `lunar-new-moon-on-or-after`: astronomical day number of the first new moon on or after `d`, without daylight saving time. @param {number} d @param {number} zone */
function lunarNewMoonOnOrAfter(d, zone) {
  const date = gregorianFromAbsolute(Math.floor(astroToAbsolute(d)));
  const year = date[2] + dayNumber(date) / 365.25;
  let k = Math.floor((year - 2000.0) * 12.3685);
  let moon = lunarNewMoonTime(k, zone);
  while (moon < d) {
    k += 1;
    moon = lunarNewMoonTime(k, zone);
  }
  const aDate = astroToAbsolute(moon);
  const time = 24 * (aDate - Math.trunc(aDate));
  const greg = gregorianFromAbsolute(Math.trunc(aDate));
  // dst-adjust-time with no daylight saving time: the time rounded to the minute
  const rounded = absoluteFromGregorian(greg) + roundHalfEven(60 * time) / 60.0 / 24.0;
  const adjDate = gregorianFromAbsolute(Math.trunc(rounded));
  const adjTime = 24.0 * (rounded - Math.trunc(rounded));
  return astroFromAbsolute(absoluteFromGregorian(adjDate) + adjTime / 24.0);
}

/** `calendar-chinese-time-zone`: Beijing, which changed at 1928 from UT+7:45:40 to UT+8. @param {number} year */
const chineseZone = (year) => (year < 1928 ? 465 + 40.0 / 60.0 : 480);

/** `calendar-chinese-zodiac-sign-on-or-after`: the absolute day the sun next reaches a multiple of 30 degrees. @param {number} d */
export function zodiacSignOnOrAfter(d) {
  const year = gregorianFromAbsolute(d)[2];
  return Math.floor(astroToAbsolute(solarDateNextLongitude(astroFromAbsolute(d), 30, chineseZone(year))));
}

/** `calendar-chinese-new-moon-on-or-after`. @param {number} d */
function newMoonOnOrAfter(d) {
  const year = gregorianFromAbsolute(d)[2];
  return Math.floor(astroToAbsolute(lunarNewMoonOnOrAfter(astroFromAbsolute(d), chineseZone(year))));
}

/** `calendar-chinese-month-list`: the days new moons fall on from `start` to `end`. @param {number} start @param {number} end */
function monthList(start, end) {
  /** @type {number[]} */
  const out = [];
  let from = start;
  while (from <= end) {
    const moon = newMoonOnOrAfter(from);
    if (moon > end) break;
    out.push(moon);
    from = moon + 1;
  }
  return out;
}

/** `calendar-chinese-number-months`: month numbers for the lunar months in `list`, a half for a leap month. @param {number[]} list @param {number} start @returns {ChineseMonth[]} */
function numberMonths(list, start) {
  /** @type {ChineseMonth[]} */
  const out = [];
  let rest = list;
  let n = start;
  while (rest.length) {
    out.push([n, rest[0]]);
    const tail = rest.slice(1);
    if (12 - n - rest.length === 0) {
      rest = tail;
    } else if (rest.length > 2 && rest[2] <= zodiacSignOnOrAfter(rest[1])) {
      out.push([n + 0.5, rest[1]]);
      rest = rest.slice(2);
    } else {
      rest = tail;
    }
    n += 1;
  }
  return out;
}

/** `calendar-chinese-compute-year`: the months from the one after the solstice of year `y - 1` to the one of the solstice of `y`. @param {number} y @returns {ChineseMonth[]} */
function computeYear(y) {
  const nextSolstice = zodiacSignOnOrAfter(absoluteFromGregorian([12, 15, y]));
  const list = monthList(1 + zodiacSignOnOrAfter(absoluteFromGregorian([12, 15, y - 1])), nextSolstice);
  const nextSign = zodiacSignOnOrAfter(list[0]);
  if (list.length === 12) return [[12, list[0]], ...numberMonths(list.slice(1), 1)];
  if (list[0] > nextSign || nextSign >= list[1]) return [[11.5, list[0]], [12, list[1]], ...numberMonths(list.slice(2), 1)];
  if (zodiacSignOnOrAfter(list[1]) >= list[2]) return [[12, list[0]], [12.5, list[1]], ...numberMonths(list.slice(2), 1)];
  return [[12, list[0]], ...numberMonths(list.slice(1), 1)];
}

/** @type {Map<number, ChineseMonth[]>} */
const yearCache = new Map();

/** `calendar-chinese-year`: the structure of the Chinese year for Gregorian year `y`. @param {number} y */
export function chineseYear(y) {
  let hit = yearCache.get(y);
  if (!hit) {
    hit = computeYear(y);
    yearCache.set(y, hit);
  }
  return hit;
}

/** @param {ChineseMonth[]} year @param {number} month */
const monthStart = (year, month) => {
  const found = year.find((m) => m[0] === month);
  return found ? found[1] : NaN;
};

/** `calendar-chinese-to-absolute`: the absolute day of a Chinese date (cycle year month day). @param {[number, number, number, number]} date */
export function chineseToAbsolute([cycle, year, month, day]) {
  const gYear = (cycle - 1) * 60 + (year - 1) - 2636;
  const here = chineseYear(gYear);
  const from = here.findIndex((m) => m[0] === 1);
  const months = [...(from < 0 ? [] : here.slice(from)), ...chineseYear(gYear + 1)];
  return day - 1 + monthStart(months, month);
}

/** `calendar-chinese-from-absolute`: the Chinese date (cycle year month day) of an absolute day. @param {number} date @returns {[number, number, number, number]} */
export function chineseFromAbsolute(date) {
  const gYear = gregorianFromAbsolute(date)[2];
  let cYear = gYear + 2695;
  let list = [...chineseYear(gYear - 1), ...chineseYear(gYear), ...chineseYear(gYear + 1)];
  while (list[1][1] <= date) {
    if (list[1][0] === 1) cYear += 1;
    list = list.slice(1);
  }
  return [Math.floor((cYear - 1) / 60), 1 + fmod(cYear - 1, 60), list[0][0], 1 + (date - list[0][1])];
}

const STEMS = ['Jia', 'Yi', 'Bing', 'Ding', 'Wu', 'Ji', 'Geng', 'Xin', 'Ren', 'Gui'];
const BRANCHES = ['Zi', 'Chou', 'Yin', 'Mao', 'Chen', 'Si', 'Wu', 'Wei', 'Shen', 'You', 'Xu', 'Hai'];
/** `calendar-chinese-sexagesimal-name`. @param {number} n */
export const sexagesimalName = (n) => `${STEMS[(n - 1) % 10]}-${BRANCHES[(n - 1) % 12]}`;

/** `calendar-chinese-date-string`, the text of `diary-chinese-date` after "Chinese date: ". @param {CalDate} date */
export function chineseDateString(date) {
  const aDate = absoluteFromGregorian(date);
  const [cycle, year, month, day] = chineseFromAbsolute(aDate);
  const thisMonth = chineseToAbsolute([cycle, year, month, 1]);
  const whole = Math.floor(month);
  const nextMonth = chineseToAbsolute([year === 60 ? cycle + 1 : cycle, whole === 12 ? year + 1 : year, 1 + (whole % 12), 1]);
  const prefix = !Number.isInteger(month) ? 'second ' : 30 < nextMonth - thisMonth ? 'first ' : '';
  const monthName = Number.isInteger(month) ? ` (${sexagesimalName(12 * year + month + 50)})` : '';
  return `Cycle ${cycle}, year ${year} (${sexagesimalName(year)}), ${prefix}month ${whole}${monthName}, day ${day} (${sexagesimalName(aDate + 15)})`;
}

// ---- the holidays ---------------------------------------------------------------------------------

/** @param {number} month @param {number} year */
const visibleIn = (month, year) => (/** @type {CalDate} */ date) => dateIsVisible(date, month, year);

/** `holiday-chinese-new-year`. @param {{ month: number, year: number }} w @returns {Holiday[]} */
export function holidayChineseNewYear(w) {
  const [m, y] = incrementMonth(w.month, w.year, 1);
  if (!(m < 5)) return [];
  const start = monthStart(chineseYear(y), 1);
  const date = gregorianFromAbsolute(start);
  return visibleIn(w.month, w.year)(date) ? [{ date, name: `Chinese New Year (${sexagesimalName(y + 57)})` }] : [];
}

/** `holiday-chinese-qingming`. @param {{ month: number, year: number }} w @returns {Holiday[]} */
export function holidayChineseQingming(w) {
  if (![3, 4, 5].includes(w.month)) return [];
  return [{ date: gregorianFromAbsolute(15 + zodiacSignOnOrAfter(absoluteFromGregorian([3, 15, w.year]))), name: 'Qingming Festival' }];
}

/** `holiday-chinese-winter-solstice`. @param {{ month: number, year: number }} w @returns {Holiday[]} */
export function holidayChineseWinterSolstice(w) {
  if (![11, 12, 1].includes(w.month)) return [];
  const year = w.month === 1 ? w.year - 1 : w.year;
  return [{ date: gregorianFromAbsolute(zodiacSignOnOrAfter(absoluteFromGregorian([12, 15, year]))), name: 'Winter Solstice Festival' }];
}

/** `holiday-chinese`: Chinese `month` and `day` when they are in the window. @param {{ month: number, year: number }} w @param {number} month @param {number} day @param {string} name @returns {Holiday[]} */
export function holidayChinese(w, month, day, name) {
  let abs;
  if ([12, 1, 2, 3].includes(w.month)) {
    const [m1, y1] = incrementMonth(w.month, w.year, -1);
    const [m2, y2] = incrementMonth(w.month, w.year, 1);
    const startDate = absoluteFromGregorian([m1, 1, y1]);
    const endDate = absoluteFromGregorian([m2, lastDayOfMonth(m2, y2), y2]);
    const local = month < 10 ? chineseFromAbsolute(endDate) : chineseFromAbsolute(startDate);
    abs = chineseToAbsolute([local[0], local[1], month, day]);
  } else {
    abs = monthStart(chineseYear(w.year), month) + (day - 1);
  }
  if (Number.isNaN(abs)) return [];
  const date = gregorianFromAbsolute(abs);
  return visibleIn(w.month, w.year)(date) ? [{ date, name }] : [];
}
