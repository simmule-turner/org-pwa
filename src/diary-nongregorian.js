// @ts-check
/**
 * The Hebrew, Islamic and Bahá'í dates of a day for the diary: the entries that `diary-hebrew-list-entries`,
 * `diary-islamic-list-entries` and `diary-bahai-list-entries` find (a line starting with H, I or B and a date in that calendar), and
 * the text of the `diary-hebrew-date`, `diary-islamic-date` and `diary-bahai-date` sexps.
 */

import {
  absoluteFromGregorian, hebrewFromAbsolute, hebrewLeapYear, HEBREW_MONTHS_COMMON, HEBREW_MONTHS_LEAP,
  islamicFromAbsolute, ISLAMIC_MONTHS, bahaiFromAbsolute, BAHAI_MONTHS, gregorianLeapYear,
} from './calendar-conv.js';

/** @typedef {'hebrew' | 'islamic' | 'bahai'} Kind */
/** @typedef {{ month: number, day: number, year: number, monthName: string }} NonGregorianDate */

/** The hook function that lists the entries of each calendar, and the variable holding the symbol that marks them. */
export const LISTERS = /** @type {const} */ ({
  'diary-hebrew-list-entries': 'hebrew',
  'diary-islamic-list-entries': 'islamic',
  'diary-bahai-list-entries': 'bahai',
});

/** The date of `date` in a calendar; `null` before the calendar's epoch.
 * @param {Kind} kind @param {Date} date @returns {NonGregorianDate | null} */
export function nonGregorianDate(kind, date) {
  const abs = absoluteFromGregorian([date.getMonth() + 1, date.getDate(), date.getFullYear()]);
  if (kind === 'hebrew') {
    const [month, day, year] = hebrewFromAbsolute(abs);
    return { month, day, year, monthName: HEBREW_MONTHS_LEAP[month - 1] };
  }
  if (kind === 'islamic') {
    const [month, day, year] = islamicFromAbsolute(abs);
    return year < 1 ? null : { month, day, year, monthName: ISLAMIC_MONTHS[month - 1] };
  }
  const [month, day, year] = bahaiFromAbsolute(abs);
  return year < 1 ? null : { month, day, year, monthName: BAHAI_MONTHS[month - 1] };
}

/** The date as `calendar-date-string` writes it with the default `calendar-date-display-form`: "Tishri 10, 5787".
 * @param {Kind} kind @param {Date} date @returns {string} */
export function nonGregorianDateString(kind, date) {
  const d = nonGregorianDate(kind, date);
  if (!d) return '';
  if (kind === 'hebrew') {
    const names = hebrewLeapYear(d.year) ? HEBREW_MONTHS_LEAP : HEBREW_MONTHS_COMMON;
    return `${names[d.month - 1]} ${d.day}, ${d.year}`;
  }
  if (kind === 'bahai') {
    const leap = gregorianLeapYear(d.year + 1844);
    const ayyam = d.month === 19 && d.day <= 0;
    return `${ayyam ? 'Ayyám-i-Há' : d.monthName} ${d.day <= 0 ? d.day + (leap ? 5 : 4) : d.day}, ${d.year}`;
  }
  return `${d.monthName} ${d.day}, ${d.year}`;
}

/** What `diary-hebrew-date`, `diary-islamic-date` and `diary-bahai-date` show for `date`.
 * @param {Kind} kind @param {Date} date @returns {string} */
export function nonGregorianDateLine(kind, date) {
  const s = nonGregorianDateString(kind, date);
  if (kind === 'hebrew') return `Hebrew date (until sunset): ${s}`;
  if (kind === 'islamic') return s === '' ? 'Date is pre-Islamic' : `Islamic date (until sunset): ${s}`;
  return `Bahá’í date: ${s}`;
}
