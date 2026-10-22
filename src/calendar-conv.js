// @ts-check
/**
 * Emacs's calendar arithmetic (calendar.el, cal-julian.el, cal-hebrew.el, cal-islam.el, cal-bahai.el), written the way those files
 * write it. A date is [month, day, year]; an absolute date counts days from Sunday, December 31, 1 BC (so January 1, 1 AD is 1).
 */

/** @typedef {[number, number, number]} CalDate  month, day, year */

/** Integer division that rounds toward zero, as Lisp's `/` on integers. @param {number} a @param {number} b */
const quo = (a, b) => Math.trunc(a / b);
/** Lisp's `%` on integers (the sign follows the dividend). @param {number} a @param {number} b */
const rem = (a, b) => a % b;
/** Lisp's `mod` (the sign follows the divisor). @param {number} a @param {number} b */
const mod = (a, b) => ((a % b) + b) % b;

/** @param {number} year */
export const gregorianLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** @param {number} month @param {number} year */
export function lastDayOfMonth(month, year) {
  return month === 2 ? (gregorianLeapYear(year) ? 29 : 28) : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Day of the year, 1 to 366 (`calendar-day-number`). @param {CalDate} date */
export function dayNumber([month, day, year]) {
  let n = day;
  for (let m = 1; m < month; m++) n += lastDayOfMonth(m, year);
  return n;
}

/** `calendar-absolute-from-gregorian`. @param {CalDate} date */
export function absoluteFromGregorian(date) {
  const year = date[2];
  const prior = year - 1;
  return dayNumber(date) + 365 * prior + Math.floor(prior / 4) - Math.floor(prior / 100) + Math.floor(prior / 400);
}

/** `calendar-gregorian-from-absolute`. @param {number} abs @returns {CalDate} */
export function gregorianFromAbsolute(abs) {
  const d0 = abs - 1;
  const n400 = Math.floor(d0 / 146097);
  const d1 = mod(d0, 146097);
  const n100 = quo(d1, 36524);
  const d2 = rem(d1, 36524);
  const n4 = quo(d2, 1461);
  const d3 = rem(d2, 1461);
  const n1 = quo(d3, 365);
  const year = 400 * n400 + 100 * n100 + 4 * n4 + n1 + (n100 === 4 || n1 === 4 ? 0 : 1);
  const day0 = n100 === 4 || n1 === 4 ? 366 : rem(d3, 365) + 1;
  let month = 1;
  let rest = day0;
  while (month < 12 && rest > lastDayOfMonth(month, year)) {
    rest -= lastDayOfMonth(month, year);
    month++;
  }
  return [month, rest, year];
}

/** `calendar-dayname-on-or-before`: the last day on or before `abs` that is `dayname` (0 Sunday). @param {number} dayname @param {number} abs */
export const daynameOnOrBefore = (dayname, abs) => abs - mod(abs - dayname, 7);

/** Day of the week of an absolute date, 0 for Sunday. @param {number} abs */
export const dayOfWeek = (abs) => mod(abs, 7);

/** `calendar-nth-named-absday`: the absolute date of the nth `dayname` of a month (negative n counts from the end). @param {number} n @param {number} dayname @param {number} month @param {number} year @param {number} [day] */
export function nthNamedAbsday(n, dayname, month, year, day) {
  if (n > 0) return daynameOnOrBefore(dayname, absoluteFromGregorian([month, day === undefined ? 1 : day, year]) + 6) + 7 * (n - 1);
  return daynameOnOrBefore(dayname, absoluteFromGregorian([month, day === undefined ? lastDayOfMonth(month, year) : day, year])) + 7 * (n + 1);
}

/** `calendar-nth-named-day`. @param {number} n @param {number} dayname @param {number} month @param {number} year @param {number} [day] @returns {CalDate} */
export const nthNamedDay = (n, dayname, month, year, day) => gregorianFromAbsolute(nthNamedAbsday(n, dayname, month, year, day));

// ---- Julian -----------------------------------------------------------------------------------

/** @param {number} year */
const julianLeap = (year) => mod(year, 4) === (year > 0 ? 0 : 3);

/** @param {CalDate} date */
export function julianToAbsolute([month, day, year]) {
  const y = year < 0 ? year + 1 : year; // there is no year 0
  let n = day;
  for (let m = 1; m < month; m++) n += m === 2 ? (julianLeap(year) ? 29 : 28) : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return n + 365 * (y - 1) + Math.floor((y - 1) / 4) - 2;
}

/** @param {number} abs @returns {CalDate} */
export function julianFromAbsolute(abs) {
  const approx = Math.floor((abs + 2) / 366);
  let year = approx;
  while (abs >= julianToAbsolute([1, 1, year + 1 === 0 ? 1 : year + 1])) year++;
  if (year === 0) year = 1;
  let month = 1;
  while (month < 12 && abs >= julianToAbsolute([month + 1, 1, year])) month++;
  return [month, abs - julianToAbsolute([month, 1, year]) + 1, year];
}

// ---- Hebrew -----------------------------------------------------------------------------------

/** @param {number} year */
export const hebrewLeapYear = (year) => mod(1 + 7 * year, 19) < 7;

/** @param {number} year */
export const hebrewLastMonthOfYear = (year) => (hebrewLeapYear(year) ? 13 : 12);

/** `calendar-hebrew-elapsed-days`. @param {number} year */
export function hebrewElapsedDays(year) {
  const monthsElapsed = 235 * quo(year - 1, 19) + 12 * rem(year - 1, 19) + quo(1 + 7 * rem(year - 1, 19), 19);
  const partsElapsed = 204 + 793 * rem(monthsElapsed, 1080);
  const hoursElapsed = 5 + 12 * monthsElapsed + 793 * quo(monthsElapsed, 1080) + quo(partsElapsed, 1080);
  const parts = 1080 * rem(hoursElapsed, 24) + rem(partsElapsed, 1080);
  const day = 1 + 29 * monthsElapsed + quo(hoursElapsed, 24);
  const alternative =
    parts >= 19440 || (rem(day, 7) === 2 && parts >= 9924 && !hebrewLeapYear(year)) || (rem(day, 7) === 1 && parts >= 16789 && hebrewLeapYear(year - 1)) ? day + 1 : day;
  return [0, 3, 5].includes(rem(alternative, 7)) ? alternative + 1 : alternative;
}

/** @param {number} year */
export const hebrewDaysInYear = (year) => hebrewElapsedDays(year + 1) - hebrewElapsedDays(year);
/** @param {number} year */
export const hebrewLongHeshvan = (year) => rem(hebrewDaysInYear(year), 10) === 5;
/** @param {number} year */
export const hebrewShortKislev = (year) => rem(hebrewDaysInYear(year), 10) === 3;

/** @param {number} month @param {number} year */
export function hebrewLastDayOfMonth(month, year) {
  return [2, 4, 6, 10, 13].includes(month) || (month === 12 && !hebrewLeapYear(year)) || (month === 8 && !hebrewLongHeshvan(year)) || (month === 9 && hebrewShortKislev(year)) ? 29 : 30;
}

/** @param {CalDate} date */
export function hebrewToAbsolute([month, day, year]) {
  let n = day;
  if (month < 7) {
    for (let m = 7; m <= hebrewLastMonthOfYear(year); m++) n += hebrewLastDayOfMonth(m, year);
    for (let m = 1; m < month; m++) n += hebrewLastDayOfMonth(m, year);
  } else {
    for (let m = 7; m < month; m++) n += hebrewLastDayOfMonth(m, year);
  }
  return n + hebrewElapsedDays(year) - 1373429;
}

/** @param {number} abs @returns {CalDate} */
export function hebrewFromAbsolute(abs) {
  const greg = gregorianFromAbsolute(abs);
  let year = 3760 + greg[2];
  let month = [9, 10, 11, 12, 1, 2, 3, 4, 7, 7, 7, 8][greg[0] - 1];
  while (abs >= hebrewToAbsolute([7, 1, year + 1])) year++;
  const length = hebrewLastMonthOfYear(year);
  while (abs > hebrewToAbsolute([month, hebrewLastDayOfMonth(month, year), year])) month = 1 + (month % length);
  return [month, abs - hebrewToAbsolute([month, 1, year]) + 1, year];
}

export const HEBREW_MONTHS_COMMON = ['Nisan', 'Iyar', 'Sivan', 'Tammuz', 'Av', 'Elul', 'Tishri', 'Heshvan', 'Kislev', 'Teveth', 'Shevat', 'Adar'];
export const HEBREW_MONTHS_LEAP = ['Nisan', 'Iyar', 'Sivan', 'Tammuz', 'Av', 'Elul', 'Tishri', 'Heshvan', 'Kislev', 'Teveth', 'Shevat', 'Adar I', 'Adar II'];

// ---- Islamic ----------------------------------------------------------------------------------

/** `calendar-islamic-epoch`: July 16, 622 (Julian). */
export const ISLAMIC_EPOCH = julianToAbsolute([7, 16, 622]);

/** @param {number} year */
export const islamicLeapYear = (year) => [2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29].includes(rem(year, 30));

/** @param {number} month @param {number} year */
export function islamicLastDayOfMonth(month, year) {
  if (month % 2 === 1 && month <= 11) return 30;
  if (month % 2 === 0 && month <= 10) return 29;
  return islamicLeapYear(year) ? 30 : 29;
}

/** @param {CalDate} date */
export function islamicToAbsolute([month, day, year]) {
  const y = rem(year, 30);
  const leapInCycle = y < 3 ? 0 : y < 6 ? 1 : y < 8 ? 2 : y < 11 ? 3 : y < 14 ? 4 : y < 17 ? 5 : y < 19 ? 6 : y < 22 ? 7 : y < 25 ? 8 : y < 27 ? 9 : 10;
  const dayNumberInYear = 30 * quo(month, 2) + 29 * quo(month - 1, 2) + day;
  return dayNumberInYear + (year - 1) * 354 + 11 * quo(year, 30) + leapInCycle + (ISLAMIC_EPOCH - 1);
}

/** @param {number} abs @returns {CalDate} */
export function islamicFromAbsolute(abs) {
  if (abs < ISLAMIC_EPOCH) return [0, 0, 0];
  const approx = quo(abs - ISLAMIC_EPOCH, 355);
  let year = approx;
  while (abs >= islamicToAbsolute([1, 1, year + 1])) year++;
  let month = 1;
  while (abs > islamicToAbsolute([month, islamicLastDayOfMonth(month, year), year])) month++;
  return [month, abs - islamicToAbsolute([month, 1, year]) + 1, year];
}

export const ISLAMIC_MONTHS = ['Muharram', 'Safar', 'Rabi I', 'Rabi II', 'Jumada I', 'Jumada II', 'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhu al-Qada", 'Dhu al-Hijjah'];

export const BAHAI_MONTHS = ['Bahá', 'Jalál', 'Jamál', '‘Aẓamat', 'Núr', 'Raḥmat', 'Kalimát', 'Kamál', 'Asmá’', '‘Izzat', 'Mas͟híyyat', '‘Ilm', 'Qudrat', 'Qawl', 'Masá’il', 'S͟haraf', 'Sulṭán', 'Mulk', '‘Alá’'];

// ---- Bahá'í -----------------------------------------------------------------------------------

const BAHAI_EPOCH = absoluteFromGregorian([3, 21, 1844]);
const BAHAI_LEAP_BASE = quo(1844, 4) - quo(1844, 100) + quo(1844, 400);

/** @param {number} year */
const bahaiLeapYear = (year) => gregorianLeapYear(year + 1844);

/** @param {CalDate} date */
export function bahaiToAbsolute([month, day, year]) {
  const prior = year - 1 + 1844;
  const leapDays = quo(prior, 4) - quo(prior, 100) + quo(prior, 400) - BAHAI_LEAP_BASE;
  let n = BAHAI_EPOCH - 1 + 365 * (year - 1) + leapDays + 19 * (month - 1);
  if (month === 19) n += bahaiLeapYear(year) ? 5 : 4;
  return n + day;
}

/** @param {number} abs @returns {CalDate} */
export function bahaiFromAbsolute(abs) {
  if (abs < BAHAI_EPOCH) return [0, 0, 0];
  const greg = gregorianFromAbsolute(abs);
  const year = greg[2] - 1844 + (greg[0] > 3 || (greg[0] === 3 && greg[1] >= 21) ? 1 : 0);
  let m = 1;
  while (abs > bahaiToAbsolute([m, 19, year])) m++;
  return [m, abs - (bahaiToAbsolute([m, 1, year]) - 1), year];
}

// ---- the calendar window ------------------------------------------------------------------------

/** `calendar-increment-month`: `month` and `year` moved by `n` months. @param {number} month @param {number} year @param {number} n @returns {[number, number]} */
export function incrementMonth(month, year, n) {
  const total = year * 12 + (month - 1) + n;
  return [mod(total, 12) + 1, Math.floor(total / 12)];
}

/** `calendar-date-is-visible-p`: is the date in the three months around `displayed`? @param {CalDate} date @param {number} displayedMonth @param {number} displayedYear */
export function dateIsVisible(date, displayedMonth, displayedYear) {
  const [m1, y1] = incrementMonth(displayedMonth, displayedYear, -1);
  const [m2, y2] = incrementMonth(displayedMonth, displayedYear, 1);
  const abs = absoluteFromGregorian(date);
  return abs >= absoluteFromGregorian([m1, 1, y1]) && abs <= absoluteFromGregorian([m2, lastDayOfMonth(m2, y2), y2]);
}
