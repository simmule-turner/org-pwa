// @ts-check
/**
 * The Hebrew-calendar diary functions of Emacs's cal-hebrew.el, for sexp entries: `diary-hebrew-birthday`, `diary-hebrew-yahrzeit`,
 * `diary-hebrew-omer`, `diary-hebrew-rosh-hodesh`, `diary-hebrew-parasha` and `diary-hebrew-sabbath-candles` (the time of that one is worked out
 * by the caller from the sun). Each takes the day being listed and returns the entry's text, or null when the day does not match.
 */

import { absoluteFromGregorian, hebrewFromAbsolute, hebrewToAbsolute, hebrewElapsedDays, hebrewLeapYear, hebrewLastDayOfMonth } from './calendar-conv.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_COMMON = ['Nisan', 'Iyar', 'Sivan', 'Tammuz', 'Av', 'Elul', 'Tishri', 'Heshvan', 'Kislev', 'Teveth', 'Shevat', 'Adar'];
const MONTHS_LEAP = ['Nisan', 'Iyar', 'Sivan', 'Tammuz', 'Av', 'Elul', 'Tishri', 'Heshvan', 'Kislev', 'Teveth', 'Shevat', 'Adar I', 'Adar II'];
const SEFIROT = ['Hesed', 'Gevurah', 'Tiferet', 'Netzach', 'Hod', 'Yesod', 'Malchut'];
const PARASHIOT = [
  'Bereshith', 'Noah', "Lech L'cha", 'Vayera', 'Hayei Sarah', 'Toledoth', 'Vayetze', 'Vayishlah', 'Vayeshev', 'Mikketz', 'Vayiggash', 'Vayhi',
  'Shemoth', 'Vaera', 'Bo', 'Beshallah', 'Yithro', 'Mishpatim', 'Terumah', 'Tetzavveh', 'Ki Tissa', 'Vayakhel', 'Pekudei', 'Vayikra',
  'Tzav', 'Shemini', 'Tazria', 'Metzora', 'Aharei Moth', 'Kedoshim', 'Emor', 'Behar', 'Behukkotai', 'Bemidbar', 'Naso', "Behaalot'cha",
  "Shelah L'cha", 'Korah', 'Hukkath', 'Balak', 'Pinhas', 'Mattoth', 'Masei', 'Devarim', 'Vaethanan', 'Ekev', 'Reeh', 'Shofetim',
  'Ki Tetze', 'Ki Tavo', 'Nitzavim', 'Vayelech', 'Haazinu',
];

/** The parashiot of the fourteen kinds of Hebrew year (calendar-hebrew-year-DAY-TYPE-PASSOVER): a number, two numbers for a double portion, `{ c: [diaspora, Israel] }` where they differ, or null. */
const YEAR_KINDS = /** @type {Record<string, unknown[]>} */ ({
  'Saturday-incomplete-Sunday': [null,52,null,null,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,[21,22],23,24,null,25,[26,27],[28,29],30,[31,32],33,34,35,36,37,38,39,40,[41,42],43,44,45,46,47,48,49,50],
  'Saturday-complete-Tuesday': [null,52,null,null,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,[21,22],23,24,null,25,[26,27],[28,29],30,[31,32],33,34,35,36,37,38,39,40,[41,42],43,44,45,46,47,48,49,[50,51]],
  'Monday-incomplete-Tuesday': [51,52,null,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,[21,22],23,24,null,25,[26,27],[28,29],30,[31,32],33,34,35,36,37,38,39,40,[41,42],43,44,45,46,47,48,49,[50,51]],
  'Monday-complete-Thursday': [51,52,null,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,[21,22],23,24,null,25,[26,27],[28,29],30,[31,32],33,{c:[null,34]},{c:[34,35]},{c:[35,36]},{c:[36,37]},{c:[37,38]},{c:[[38,39],39]},40,[41,42],43,44,45,46,47,48,49,[50,51]],
  'Tuesday-regular-Thursday': [51,52,null,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,[21,22],23,24,null,25,[26,27],[28,29],30,[31,32],33,{c:[null,34]},{c:[34,35]},{c:[35,36]},{c:[36,37]},{c:[37,38]},{c:[[38,39],39]},40,[41,42],43,44,45,46,47,48,49,[50,51]],
  'Thursday-regular-Saturday': [52,null,null,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,[21,22],23,24,null,{c:[null,25]},{c:[25,[26,27]]},{c:[[26,27],[28,29]]},{c:[[28,29],30]},{c:[30,31]},{c:[[31,32],32]},33,34,35,36,37,38,39,40,[41,42],43,44,45,46,47,48,49,50],
  'Thursday-complete-Sunday': [52,null,null,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,null,25,[26,27],[28,29],30,[31,32],33,34,35,36,37,38,39,40,[41,42],43,44,45,46,47,48,49,50],
  'Saturday-incomplete-Tuesday': [null,52,null,null,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,null,28,29,30,31,32,33,34,35,36,37,38,39,40,[41,42],43,44,45,46,47,48,49,[50,51]],
  'Saturday-complete-Thursday': [null,52,null,null,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,null,28,29,30,31,32,33,{c:[null,34]},{c:[34,35]},{c:[35,36]},{c:[36,37]},{c:[37,38]},{c:[[38,39],39]},40,[41,42],43,44,45,46,47,48,49,[50,51]],
  'Monday-incomplete-Thursday': [51,52,null,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,null,28,29,30,31,32,33,{c:[null,34]},{c:[34,35]},{c:[35,36]},{c:[36,37]},{c:[37,38]},{c:[[38,39],39]},40,[41,42],43,44,45,46,47,48,49,[50,51]],
  'Monday-complete-Saturday': [51,52,null,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,null,{c:[null,28]},{c:[28,29]},{c:[29,30]},{c:[30,31]},{c:[31,32]},{c:[32,33]},{c:[33,34]},{c:[34,35]},{c:[35,36]},{c:[36,37]},{c:[37,38]},{c:[38,39]},{c:[39,40]},{c:[40,41]},{c:[[41,42],42]},43,44,45,46,47,48,49,50],
  'Tuesday-regular-Saturday': [51,52,null,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,null,{c:[null,28]},{c:[28,29]},{c:[29,30]},{c:[30,31]},{c:[31,32]},{c:[32,33]},{c:[33,34]},{c:[34,35]},{c:[35,36]},{c:[36,37]},{c:[37,38]},{c:[38,39]},{c:[39,40]},{c:[40,41]},{c:[[41,42],42]},43,44,45,46,47,48,49,50],
  'Thursday-incomplete-Sunday': [52,null,null,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,null,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50],
  'Thursday-complete-Tuesday': [52,null,null,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,null,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,[50,51]],
});

/** Hebrew months: the last of a year. @param {number} year */
const lastMonthOfYear = (year) => (hebrewLeapYear(year) ? 13 : 12);
/** @param {number} year */
const daysInYear = (year) => hebrewElapsedDays(year + 1) - hebrewElapsedDays(year);
/** @param {number} year */
const longHeshvan = (year) => daysInYear(year) % 10 === 5;
/** @param {number} year */
const shortKislev = (year) => daysInYear(year) % 10 === 3;
/** @param {number} year */
const monthNames = (year) => (hebrewLeapYear(year) ? MONTHS_LEAP : MONTHS_COMMON);

/** "st", "nd", "rd" or "th" (diary-ordinal-suffix). @param {number} n */
function ordinalSuffix(n) {
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][Math.abs(n) % 10] || 'th';
}

/** @param {Date} date */
const absoluteOf = (date) => absoluteFromGregorian([date.getMonth() + 1, date.getDate(), date.getFullYear()]);

/** The absolute date of the anniversary of Hebrew death date `[month, day, year]` in Hebrew `year` (calendar-hebrew-yahrzeit). @param {number[]} death @param {number} year */
function yahrzeitOf([month, day, deathYear], year) {
  if (month === 8 && day === 30 && !longHeshvan(deathYear + 1)) return hebrewToAbsolute([9, 1, year]) - 1;
  if (month === 9 && day === 30 && shortKislev(deathYear + 1)) return hebrewToAbsolute([10, 1, year]) - 1;
  if (month === 13) return hebrewToAbsolute([lastMonthOfYear(year), day, year]);
  if (day === 30 && month === 12 && !hebrewLeapYear(year)) return hebrewToAbsolute([11, 30, year]);
  return hebrewToAbsolute([month, day, year]);
}

/** The absolute date of the anniversary of Hebrew birth date `[month, day, year]` in Hebrew `year` (calendar-hebrew-birthday). @param {number[]} birth @param {number} year */
function birthdayOf([month, day, birthYear], year) {
  if (month === lastMonthOfYear(birthYear)) return hebrewToAbsolute([lastMonthOfYear(year), day, year]);
  return hebrewToAbsolute([month, 1, year]) + day - 1;
}

/** `diary-hebrew-birthday MONTH DAY YEAR [AFTER-SUNSET]` for a birth on that civil date: "NAME's 3rd Hebrew birthday", or "(evening)" the day before. @param {Date} date @param {[number, number, number]} born  month, day, year @param {boolean} afterSunset @param {string} entry */
export function hebrewBirthday(date, born, afterSunset, entry) {
  const h = hebrewFromAbsolute(absoluteFromGregorian(born) + (afterSunset ? 1 : 0));
  const d = absoluteOf(date);
  const year = hebrewFromAbsolute(d)[2];
  const age = year - h[2];
  const day = birthdayOf(h, year);
  if (!(age > 0 && (day === d || day === d + 1))) return null;
  return `${entry}'s ${age}${ordinalSuffix(age)} Hebrew birthday${day === d ? '' : ' (evening)'}`;
}

/** `diary-hebrew-yahrzeit MONTH DAY YEAR [MARK AFTER-SUNSET]`. @param {Date} date @param {[number, number, number]} died  month, day, year @param {boolean} afterSunset @param {string} entry */
export function hebrewYahrzeit(date, died, afterSunset, entry) {
  const h = hebrewFromAbsolute(absoluteFromGregorian(died) + (afterSunset ? 1 : 0));
  const d = absoluteOf(date);
  const year = hebrewFromAbsolute(d)[2];
  const diff = year - h[2];
  const y = yahrzeitOf(h, year);
  if (!(diff > 0 && (y === d || y === d + 1))) return null;
  return `Yahrzeit of ${entry}${y === d ? '' : ' (evening)'}: ${diff}${ordinalSuffix(diff)} anniversary`;
}

/** `diary-hebrew-omer`: the count of the omer on the 49 days after Passover. @param {Date} date */
export function hebrewOmer(date) {
  const passover = hebrewToAbsolute([1, 15, date.getFullYear() + 3760]);
  const omer = absoluteOf(date) - passover;
  if (!(omer > 0 && omer < 50)) return null;
  const week = Math.trunc(omer / 7);
  const day = omer % 7;
  const weeks = week === 0 ? '' : `, that is, ${week} week${week === 1 ? '' : 's'}${day === 0 ? '' : ` and ${day} day${day === 1 ? '' : 's'}`}`;
  return `Day ${omer}${weeks} of the omer (until sunset) ${SEFIROT[(6 + day) % 7]} she'be'${SEFIROT[(day === 0 ? -1 : 0) + week]}`;
}

/** `diary-hebrew-rosh-hodesh`: the new month's first day (and a 30th day), the day before, and the Saturday before. @param {Date} date */
export function hebrewRoshHodesh(date) {
  const d = absoluteOf(date);
  const [hMonth, hDay, hYear] = hebrewFromAbsolute(d);
  const lastDay = hebrewLastDayOfMonth(hMonth, hYear);
  const names = monthNames(hYear);
  const thisMonth = names[hMonth - 1];
  const yesterday = hebrewFromAbsolute(d - 1)[1];
  if (hDay === 30 || (hDay === 1 && hMonth !== 7)) {
    if (hDay === 30) return `Rosh Hodesh ${names[hMonth]} (first day)`;
    return `Rosh Hodesh ${yesterday === 30 ? `${thisMonth} (second day)` : thisMonth}`;
  }
  const next = names[hMonth === lastMonthOfYear(hYear) ? 0 : hMonth];
  if (d % 7 === 6) {
    if (hDay > 22 && hMonth !== 6 && lastDay === 29) return `Mevarchim Rosh Hodesh ${next} (${DAY_NAMES[29 - hDay]})`;
    if (hDay < 30 && hDay > 22 && lastDay === 30) return `Mevarchim Rosh Hodesh ${names[hMonth]} (${hDay === 29 ? 'tomorrow' : DAY_NAMES[29 - hDay]}-${DAY_NAMES[(30 - hDay) % 7]})`;
    return null;
  }
  if (hDay === 29 && hMonth !== 6) return `Erev Rosh Hodesh ${next}`;
  return null;
}

/** @param {unknown} p */
function parashaName(p) {
  return Array.isArray(p) ? `${PARASHIOT[p[0]]}/${PARASHIOT[p[1]]}` : PARASHIOT[/** @type {number} */ (p)];
}

/** `diary-hebrew-parasha`: the weekly Torah portion on a Saturday. @param {Date} date */
export function hebrewParasha(date) {
  const d = absoluteOf(date);
  if (d % 7 !== 6) return null;
  const year = hebrewFromAbsolute(d)[2];
  const rosh = hebrewToAbsolute([7, 1, year]);
  const passover = hebrewToAbsolute([1, 15, year]);
  const longH = longHeshvan(year);
  const shortK = shortKislev(year);
  const type = longH && !shortK ? 'complete' : !longH && shortK ? 'incomplete' : 'regular';
  const kind = YEAR_KINDS[`${DAY_NAMES[rosh % 7]}-${type}-${DAY_NAMES[passover % 7]}`];
  const firstSaturday = rosh + 6 - ((rosh + 6 - 6) % 7);
  const parasha = kind && kind[Math.trunc((d - firstSaturday) / 7)];
  if (parasha === null || parasha === undefined) return null;
  if (typeof parasha === 'object' && !Array.isArray(parasha)) {
    const [diaspora, israel] = /** @type {{ c: unknown[] }} */ (parasha).c;
    return `Parashat ${diaspora !== null ? `${parashaName(diaspora)} (diaspora), ${parashaName(israel)} (Israel)` : `${parashaName(israel)} (Israel)`}`;
  }
  return `Parashat ${parashaName(parasha)}`;
}

/** Is this a Friday, the day of `diary-hebrew-sabbath-candles`? @param {Date} date */
export const isFriday = (date) => absoluteOf(date) % 7 === 5;
