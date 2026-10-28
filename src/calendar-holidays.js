// @ts-check
/**
 * Emacs's holidays (holidays.el and the holiday functions of cal-hebrew.el, cal-islam.el and cal-bahai.el), evaluated for the three
 * months around `displayed-month` exactly as `calendar-holiday-list` does, so `calendar-check-holidays` gives the same names.
 * A holiday list is Lisp data (`holiday-fixed`, `holiday-float`, `holiday-easter-etc`, `holiday-hebrew`, `holiday-sexp`, ...).
 */

import {
  absoluteFromGregorian, gregorianFromAbsolute, daynameOnOrBefore, lastDayOfMonth, nthNamedDay, incrementMonth, dateIsVisible,
  hebrewToAbsolute, hebrewFromAbsolute, islamicToAbsolute, islamicFromAbsolute, bahaiToAbsolute, bahaiFromAbsolute, julianToAbsolute, julianFromAbsolute,
} from './calendar-conv.js';
import { symbolName, stringValue, listItems, isNil } from './lisp-read.js';
import { holidayChineseNewYear, holidayChineseQingming, holidayChineseWinterSolstice, holidayChinese } from './calendar-chinese.js';
import { NORTH_SEASONS, SOUTH_SEASONS, seasonLocal } from './solar-holidays.js';

/** @typedef {import('./lisp-read.js').Lisp} Lisp */
/** @typedef {import('./calendar-conv.js').CalDate} CalDate */
/** @typedef {{ date: CalDate, name: string }} Holiday */
/**
 * @typedef {{ zone: string, latitude: number, timeString: (hours: number, zoneName: string) => string }} Solar  the time zone, calendar-latitude and solar-time-string for the sun-related holidays
 * @typedef {{ month: number, year: number, vars: Map<string, Lisp>, sexp: ((expr: Lisp, name: Lisp, year: number) => Holiday | null) | null, solar?: Solar }} Window
 */

/** @param {Lisp | undefined} f @returns {number | null} */
const num = (f) => (f && f.k === 'num' ? f.v : null);

/** `holiday-filter-visible-calendar`. @param {Holiday[]} list @param {Window} w */
const visible = (list, w) => list.filter((h) => dateIsVisible(h.date, w.month, w.year));

/** The Gregorian date of a non-Gregorian MONTH DAY if it is in the window (`calendar-nongregorian-visible-p`).
 * @param {Window} w @param {number} month @param {number} day @param {(d: CalDate) => number} toAbs @param {(a: number) => CalDate} fromAbs @param {(m: number) => boolean} switchYear */
function nongregorianVisible(w, month, day, toAbs, fromAbs, switchYear) {
  const [m1, y1] = incrementMonth(w.month, w.year, -1);
  const [m2, y2] = incrementMonth(w.month, w.year, 1);
  const start = absoluteFromGregorian([m1, 1, y1]);
  const end = absoluteFromGregorian([m2, lastDayOfMonth(m2, y2), y2]);
  const year = switchYear(month) ? fromAbs(end)[2] : fromAbs(start)[2];
  const date = gregorianFromAbsolute(toAbs([month, day, year]));
  return dateIsVisible(date, w.month, w.year) ? date : null;
}

/** @param {CalDate | null} date @param {string} name @returns {Holiday[]} */
const one = (date, name) => (date ? [{ date, name }] : []);

/** @param {Window} w @param {number} month @param {number} day @param {string} name */
function holidayFixed(w, month, day, name) {
  const [m, y] = incrementMonth(w.month, w.year, 11 - month);
  return m > 9 ? [{ date: /** @type {CalDate} */ ([month, day, y]), name }] : [];
}

/** @param {Window} w @param {number} month @param {number} dayname @param {number} n @param {string} name @param {number} [day] */
function holidayFloat(w, month, dayname, n, name, day) {
  const nth = (/** @type {number} */ k, /** @type {number} */ dn, /** @type {number} */ m, /** @type {number} */ y) => absoluteFromGregorian(nthNamedDay(k, dn, m, y)) ;
  const [m1, y1a] = incrementMonth(w.month, w.year, -1);
  const [m2, y2a] = incrementMonth(w.month, w.year, 1);
  const d1 = nth(1, dayname, m1, y1a) - 7 * n + (n > 0 ? 1 : -7);
  const d2 = nth(-1, dayname, m2, y2a) - 7 * n + (n > 0 ? 7 : -1);
  const y1 = gregorianFromAbsolute(d1)[2];
  const y2 = gregorianFromAbsolute(d2)[2];
  const y = y1 === y2 || month > 9 ? y1 : y2;
  const d = day !== undefined ? day : n > 0 ? 1 : lastDayOfMonth(month, y);
  const base = absoluteFromGregorian([month, d, y]);
  return d1 <= base && base <= d2 ? [{ date: nthNamedDay(n, dayname, month, y, d), name }] : [];
}

/** @param {Window} w @param {number | null} n @param {string | null} name @param {boolean} all @returns {Holiday[]} */
function holidayEasterEtc(w, n, name, all) {
  if (n === null) {
    const extra = all
      ? /** @type {[number, string][]} */ ([[-63, 'Septuagesima Sunday'], [-56, 'Sexagesima Sunday'], [-49, 'Shrove Sunday'], [-48, 'Shrove Monday'], [-47, 'Shrove Tuesday'], [-14, 'Passion Sunday'], [-7, 'Palm Sunday'], [-3, 'Maundy Thursday'], [35, 'Rogation Sunday'], [39, 'Ascension Day'], [49, 'Pentecost (Whitsunday)'], [50, 'Whitmonday'], [56, 'Trinity Sunday'], [60, 'Corpus Christi']])
      : [];
    return [...extra, /** @type {[number, string]} */ ([-46, 'Ash Wednesday']), /** @type {[number, string]} */ ([-2, 'Good Friday']), /** @type {[number, string]} */ ([0, 'Easter Sunday'])].flatMap(([k, s]) => holidayEasterEtc(w, k, s, all));
  }
  const year = w.year;
  const century = Math.trunc(year / 100) + 1;
  const shifted = (14 + 11 * (year % 19) - Math.trunc((3 * century) / 4) + Math.trunc((5 + 8 * century) / 25) + 30 * century) % 30;
  const adjusted = shifted === 0 || (shifted === 1 && 10 < year % 19) ? shifted + 1 : shifted;
  const paschal = absoluteFromGregorian([4, 19, year]) - adjusted;
  const easter = daynameOnOrBefore(0, paschal + 7);
  const greg = gregorianFromAbsolute(easter + n);
  return dateIsVisible(greg, w.month, w.year) ? [{ date: greg, name: name || '' }] : [];
}

/** @param {Window} w @param {number | null} n @param {string | null} name */
function holidayGreekOrthodoxEaster(w, n, name) {
  const [m, y] = incrementMonth(w.month, w.year, 1);
  const julianYear = julianFromAbsolute(absoluteFromGregorian([m, lastDayOfMonth(m, y), y]))[2];
  const shifted = (14 + 11 * (julianYear % 19)) % 30;
  const paschal = julianToAbsolute([4, 19, julianYear]) - shifted;
  const easter = daynameOnOrBefore(0, paschal + 7);
  const greg = gregorianFromAbsolute(easter + (n || 0));
  return dateIsVisible(greg, w.month, w.year) ? [{ date: greg, name: name || 'Pascha (Greek Orthodox Easter)' }] : [];
}

/** @param {Window} w @param {number | null} n @param {string | null} name @returns {Holiday[]} */
function holidayAdvent(w, n, name) {
  if (n === null) return holidayAdvent(w, 0, 'Advent');
  const [, year] = incrementMonth(w.month, w.year, -1);
  const advent = gregorianFromAbsolute(n + daynameOnOrBefore(0, absoluteFromGregorian([12, 3, year])));
  return dateIsVisible(advent, w.month, w.year) ? [{ date: advent, name: name || '' }] : [];
}

/** @param {Window} w @param {number} month @param {number} day @param {string} name */
const holidayJulian = (w, month, day, name) => one(nongregorianVisible(w, month, day, julianToAbsolute, julianFromAbsolute, (m) => m < 10), name);
/** @param {Window} w @param {number} month @param {number} day @param {string} name */
const holidayHebrew = (w, month, day, name) => one(nongregorianVisible(w, month, day, hebrewToAbsolute, hebrewFromAbsolute, (m) => m > 6), name);

/** @param {Window} w @param {number} month @param {number} day @param {string} name */
function holidayIslamic(w, month, day, name) {
  const [im, iy] = (() => {
    const d = islamicFromAbsolute(absoluteFromGregorian([w.month, 15, w.year]));
    return [d[0], d[2]];
  })();
  if (im < 1) return [];
  const [m, y] = incrementMonth(im, iy, 10 - month);
  if (!(m > 7)) return [];
  const date = gregorianFromAbsolute(islamicToAbsolute([month, day, y]));
  return dateIsVisible(date, w.month, w.year) ? [{ date, name }] : [];
}

/** @param {Window} w @param {number} month @param {number} day @param {string} name */
function holidayBahai(w, month, day, name) {
  const b = bahaiFromAbsolute(absoluteFromGregorian([w.month, 15, w.year]));
  let m = b[0];
  let y = b[2];
  if (m < 1) return [];
  const total = y * 19 + (m - 1) + (16 - month);
  m = (((total % 19) + 19) % 19) + 1;
  y = Math.floor(total / 19);
  if (!(m > 12)) return [];
  const date = gregorianFromAbsolute(bahaiToAbsolute([month, day, y]));
  return dateIsVisible(date, w.month, w.year) ? [{ date, name }] : [];
}

/** @param {Window} w @param {boolean} all */
function hebrewRoshHashanah(w, all) {
  if (![8, 9, 10, 11].includes(w.month)) return [];
  const a = hebrewToAbsolute([7, 1, w.year + 3761]);
  /** @type {[number, string][]} */
  const list = [[a, `Rosh HaShanah ${w.year + 3761}`], [a + 9, 'Yom Kippur'], [a + 14, 'Sukkot'], [a + 21, 'Shemini Atzeret'], [a + 22, 'Simchat Torah']];
  if (all) {
    list.push(
      [daynameOnOrBefore(6, a - 4), 'Selichot (night)'], [a - 1, 'Erev Rosh HaShanah'], [a + 1, 'Rosh HaShanah (second day)'],
      [a + (a % 7 === 4 ? 3 : 2), 'Tzom Gedaliah'], [daynameOnOrBefore(6, a + 7), 'Shabbat Shuvah'], [a + 8, 'Erev Yom Kippur'],
      [a + 13, 'Erev Sukkot'], [a + 15, 'Sukkot (second day)'], [a + 16, 'Hol Hamoed Sukkot (first day)'], [a + 17, 'Hol Hamoed Sukkot (second day)'],
      [a + 18, 'Hol Hamoed Sukkot (third day)'], [a + 19, 'Hol Hamoed Sukkot (fourth day)'], [a + 20, 'Hoshanah Rabbah'],
    );
  }
  return visible(list.map(([abs, name]) => ({ date: gregorianFromAbsolute(abs), name })), w);
}

/** @param {Window} w @param {boolean} all */
function hebrewHanukkah(w, all) {
  if (![10, 11, 12, 1, 2].includes(w.month)) return [];
  const [m, y] = incrementMonth(w.month, w.year, 1);
  const hy = hebrewFromAbsolute(absoluteFromGregorian([m, lastDayOfMonth(m, y), y]))[2];
  const a = hebrewToAbsolute([9, 25, hy]);
  const ord = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
  /** @type {[number, string][]} */
  const list = all ? [[a - 1, 'Erev Hanukkah'], ...ord.map((o, i) => /** @type {[number, string]} */ ([a + i, `Hanukkah (${o} day)`]))] : [[a, 'Hanukkah']];
  return visible(list.map(([abs, name]) => ({ date: gregorianFromAbsolute(abs), name })), w);
}

/** @param {Window} w @param {boolean} all */
function hebrewPassover(w, all) {
  if (!(w.month < 8)) return [];
  const p = hebrewToAbsolute([1, 15, w.year + 3760]);
  /** @type {[number, string][]} */
  const list = [[p, 'Passover'], [p + 50, 'Shavuot']];
  if (all) {
    const wd = p % 7;
    list.push(
      [daynameOnOrBefore(6, p - 43), 'Shabbat Shekalim'], [daynameOnOrBefore(6, p - 30), 'Shabbat Zachor'], [p - (wd === 2 ? 33 : 31), 'Fast of Esther'],
      [p - 31, 'Erev Purim'], [p - 30, 'Purim'], [p - (wd === 0 ? 28 : 29), 'Shushan Purim'], [daynameOnOrBefore(6, p - 14) - 7, 'Shabbat Parah'],
      [daynameOnOrBefore(6, p - 14), 'Shabbat HaHodesh'], [daynameOnOrBefore(6, p - 1), 'Shabbat HaGadol'], [p - 1, 'Erev Passover'], [p + 1, 'Passover (second day)'],
      [p + 2, 'Hol Hamoed Passover (first day)'], [p + 3, 'Hol Hamoed Passover (second day)'], [p + 4, 'Hol Hamoed Passover (third day)'], [p + 5, 'Hol Hamoed Passover (fourth day)'],
      [p + 6, 'Passover (seventh day)'], [p + 7, 'Passover (eighth day)'], [p + ((p + 12) % 7 === 0 ? 13 : 12), 'Yom HaShoah'],
      [p + (wd === 0 ? 18 : wd === 6 ? 19 : wd === 2 ? 21 : 20), "Yom HaAtzma'ut"], [p + 33, 'Lag BaOmer'], [p + 43, 'Yom Yerushalaim'], [p + 49, 'Erev Shavuot'], [p + 51, 'Shavuot (second day)'],
    );
  }
  return visible(list.map(([abs, name]) => ({ date: gregorianFromAbsolute(abs), name })), w);
}

/** @param {Window} w */
function hebrewTishaBAv(w) {
  if (![5, 6, 7, 8, 9].includes(w.month)) return [];
  const t = hebrewToAbsolute([5, 9, w.year + 3760]);
  const wd = t % 7;
  /** @type {[number, string][]} */
  const list = [[t - (wd === 6 ? 20 : 21), 'Tzom Tammuz'], [daynameOnOrBefore(6, t), 'Shabbat Hazon'], [wd === 6 ? t + 1 : t, "Tisha B'Av"], [daynameOnOrBefore(6, t + 7), 'Shabbat Nahamu']];
  return visible(list.map(([abs, name]) => ({ date: gregorianFromAbsolute(abs), name })), w);
}

/** @param {Window} w */
function hebrewMisc(w) {
  const [pm, py] = incrementMonth(w.month, w.year, -1);
  const julianYear = julianFromAbsolute(absoluteFromGregorian([pm, 1, py]))[2];
  const hYear = hebrewFromAbsolute(absoluteFromGregorian([w.month, 28, w.year]))[2];
  const [nm, ny] = incrementMonth(w.month, w.year, 1);
  const hNext = hebrewFromAbsolute(absoluteFromGregorian([nm, lastDayOfMonth(nm, ny), ny]))[2];
  const shirahDay = hebrewFromAbsolute(daynameOnOrBefore(6, hebrewToAbsolute([11, hebrewToAbsolute([7, 1, hNext]) % 7 === 6 ? 17 : 16, hNext])))[1];
  return [
    ...holidayJulian(w, 11, (julianYear + 1) % 4 === 0 ? 22 : 21, '"Tal Umatar" (evening)'),
    ...holidayHebrew(w, 10, hebrewToAbsolute([10, 10, hYear]) % 7 === 6 ? 11 : 10, 'Tzom Teveth'),
    ...holidayHebrew(w, 11, 15, "Tu B'Shevat"),
    ...holidayHebrew(w, 11, shirahDay, 'Shabbat Shirah'),
    ...(julianYear % 28 === 21 ? holidayJulian(w, 3, 26, 'Kiddush HaHamah') : []),
  ];
}

/** @param {Window} w */
function islamicNewYear(w) {
  const first = holidayIslamic(w, 1, 1, '');
  if (!first.length) return [];
  const [m, y] = incrementMonth(w.month, w.year, 1);
  const iy = islamicFromAbsolute(absoluteFromGregorian([m, lastDayOfMonth(m, y), y]))[2];
  return [{ date: first[0].date, name: `Islamic New Year ${iy}` }];
}

/** @param {Window} w */
const bahaiNewYear = (w) => holidayFixed(w, 3, 21, `Bahá’í New Year (Naw-Ruz) ${w.year - 1843}`);

/** @param {Window} w @param {boolean} all */
function bahaiRidvan(w, all) {
  const ord = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'];
  const show = all ? ord.map((_, i) => i) : [0, 8, 11];
  return show.flatMap((i) => holidayFixed(w, i < 10 ? 4 : 5, i + (i < 10 ? 21 : -9), `${ord[i]} Day of Ridvan`).slice(0, 1));
}

/** `solar-equinoxes-solstices`: the equinox or solstice of the quarter the window is on, with its local time. @param {Window} w @returns {Holiday[]} */
function solarEquinoxesSolstices(w) {
  if (!w.solar) return [];
  const [m, y] = incrementMonth(w.month, w.year, w.month % 3 === 1 ? -1 : w.month % 3 === 2 ? 1 : 0);
  const k = Math.trunc(m / 3) - 1;
  const local = seasonLocal(w.solar.zone, k, y);
  const names = w.solar.latitude < 0 ? SOUTH_SEASONS : NORTH_SEASONS;
  return [{ date: local.date, name: `${names[k]} ${w.solar.timeString(local.hours, local.name)}` }];
}

/** The names of the holiday functions the app implements itself (`holiday-fixed`, `holiday-float`, ... `solar-equinoxes-solstices`). */
export const HOLIDAY_FUNCTIONS = ['holiday-fixed', 'holiday-float', 'holiday-easter-etc', 'holiday-greek-orthodox-easter', 'holiday-advent', 'holiday-julian', 'holiday-hebrew', 'holiday-islamic', 'holiday-bahai', 'holiday-chinese-new-year', 'holiday-chinese-qingming', 'holiday-chinese-winter-solstice', 'holiday-chinese', 'holiday-hebrew-passover', 'holiday-hebrew-rosh-hashanah', 'holiday-hebrew-hanukkah', 'holiday-hebrew-tisha-b-av', 'holiday-hebrew-misc', 'holiday-islamic-new-year', 'holiday-bahai-new-year', 'holiday-bahai-ridvan', 'solar-equinoxes-solstices'];

/**
 * One holiday function applied to its (already evaluated) arguments for the window `w`; null when `head` is not one of HOLIDAY_FUNCTIONS.
 * @param {string} head @param {Lisp[]} a @param {Window} w @returns {Holiday[] | null}
 */
export function holidayCall(head, a, w) {
  const flag = (/** @type {string} */ name) => {
    const v = w.vars.get(name);
    return !!v && !isNil(v);
  };
  const n = (/** @type {number} */ i) => num(a[i]);
  const s = (/** @type {number} */ i) => stringValue(a[i]) ?? '';
  const nn = (/** @type {number} */ i) => /** @type {number} */ (n(i));
  const two = n(0) !== null && n(1) !== null;
  switch (head) {
    case 'holiday-fixed': return two ? holidayFixed(w, nn(0), nn(1), s(2)) : [];
    case 'holiday-float': return two && n(2) !== null ? holidayFloat(w, nn(0), nn(1), nn(2), s(3), n(4) ?? undefined) : [];
    case 'holiday-easter-etc': return holidayEasterEtc(w, n(0), a[1] ? s(1) : null, flag('calendar-christian-all-holidays-flag'));
    case 'holiday-greek-orthodox-easter': return holidayGreekOrthodoxEaster(w, n(0), a[1] ? s(1) : null);
    case 'holiday-advent': return holidayAdvent(w, n(0), a[1] ? s(1) : null);
    case 'holiday-julian': return two ? holidayJulian(w, nn(0), nn(1), s(2)) : [];
    case 'holiday-hebrew': return two ? holidayHebrew(w, nn(0), nn(1), s(2)) : [];
    case 'holiday-islamic': return two ? holidayIslamic(w, nn(0), nn(1), s(2)) : [];
    case 'holiday-bahai': return two ? holidayBahai(w, nn(0), nn(1), s(2)) : [];
    case 'holiday-chinese-new-year': return holidayChineseNewYear(w);
    case 'holiday-chinese-qingming': return holidayChineseQingming(w);
    case 'holiday-chinese-winter-solstice': return holidayChineseWinterSolstice(w);
    case 'holiday-chinese': return two ? holidayChinese(w, nn(0), nn(1), s(2)) : [];
    case 'holiday-hebrew-passover': return hebrewPassover(w, flag('calendar-hebrew-all-holidays-flag'));
    case 'holiday-hebrew-rosh-hashanah': return hebrewRoshHashanah(w, flag('calendar-hebrew-all-holidays-flag'));
    case 'holiday-hebrew-hanukkah': return hebrewHanukkah(w, flag('calendar-hebrew-all-holidays-flag'));
    case 'holiday-hebrew-tisha-b-av': return hebrewTishaBAv(w);
    case 'holiday-hebrew-misc': return hebrewMisc(w);
    case 'holiday-islamic-new-year': return islamicNewYear(w);
    case 'holiday-bahai-new-year': return bahaiNewYear(w);
    case 'holiday-bahai-ridvan': return bahaiRidvan(w, flag('calendar-bahai-all-holidays-flag'));
    case 'solar-equinoxes-solstices': return solarEquinoxesSolstices(w);
    default: return null;
  }
}

/** `holiday-filter-visible-calendar`. @param {Holiday[]} list @param {Window} w */
export const filterVisible = (list, w) => visible(list, w);

/** The holidays of the three months around `window`, in the order Emacs's `calendar-holiday-list` returns them, for a list written as data
 * (the walk the app made before the interpreter ran holiday lists; the tests of the Emacs-checked results still use it).
 * @param {Lisp[]} forms  the entries of `calendar-holidays`
 * @param {Window} w */
export function holidayList(forms, w) {
  const flag = (/** @type {string} */ name) => {
    const v = w.vars.get(name);
    return !!v && !isNil(v);
  };
  /** @param {Lisp} f @returns {Holiday[]} */
  const run = (f) => {
    const items = listItems(f);
    if (!items || !items.length) return [];
    const head = symbolName(items[0]) || '';
    const a = items.slice(1);
    switch (head) {
      case 'holiday-sexp': {
        const expr = a[0] ? (a[0].k === 'list' && symbolName(a[0].items[0]) === 'quote' ? a[0].items[1] : a[0]) : null;
        if (!expr || !a[1] || !w.sexp) return [];
        const [, py] = incrementMonth(w.month, w.year, -1);
        const nameForm = a[1];
        return visible([py, py + 1].flatMap((year) => {
          const h = w.sexp ? w.sexp(expr, nameForm, year) : null;
          return h ? [h] : [];
        }), w);
      }
      case 'if': {
        const test = a[0];
        const yes = test && (test.k === 'sym' ? (test.v === 't' ? true : flag(test.v)) : !isNil(test));
        return yes ? (a[1] ? run(a[1]) : []) : a.slice(2).flatMap(run);
      }
      case 'append': return a.flatMap(run);
      case 'progn': return a.flatMap(run);
      default:
        return holidayCall(head, a, w) || []; // a function the app does not have gives no holiday
    }
  };
  /** @type {Holiday[]} */
  let res = [];
  for (const form of forms) res = [...run(form), ...res];
  return res.sort((x, y) => absoluteFromGregorian(x.date) - absoluteFromGregorian(y.date));
}

// ---- the lists Emacs starts with ----------------------------------------------------------------------

export const DEFAULT_LISTS = `
(setq holiday-general-holidays
  '((holiday-fixed 1 1 "New Year's Day")
    (holiday-float 1 1 3 "Martin Luther King Day")
    (holiday-fixed 2 2 "Groundhog Day")
    (holiday-fixed 2 14 "Valentine's Day")
    (holiday-float 2 1 3 "President's Day")
    (holiday-fixed 3 17 "St. Patrick's Day")
    (holiday-fixed 4 1 "April Fools' Day")
    (holiday-float 5 0 2 "Mother's Day")
    (holiday-float 5 1 -1 "Memorial Day")
    (holiday-fixed 6 14 "Flag Day")
    (holiday-float 6 0 3 "Father's Day")
    (holiday-fixed 7 4 "Independence Day")
    (holiday-float 9 1 1 "Labor Day")
    (holiday-float 10 1 2 "Columbus Day")
    (holiday-fixed 10 31 "Halloween")
    (holiday-fixed 11 11 "Veteran's Day")
    (holiday-float 11 4 4 "Thanksgiving")))
(setq holiday-christian-holidays
  '((holiday-easter-etc)
    (holiday-fixed 12 25 "Christmas")
    (if calendar-christian-all-holidays-flag
        (append
         (holiday-fixed 1 6 "Epiphany")
         (holiday-julian 12 25 "Christmas (Julian calendar)")
         (holiday-greek-orthodox-easter)
         (holiday-fixed 8 15 "Assumption")
         (holiday-advent 0 "Advent")))))
(setq holiday-hebrew-holidays
  '((holiday-hebrew-passover)
    (holiday-hebrew-rosh-hashanah)
    (holiday-hebrew-hanukkah)
    (if calendar-hebrew-all-holidays-flag
        (append
         (holiday-hebrew-tisha-b-av)
         (holiday-hebrew-misc)))))
(setq holiday-islamic-holidays
  '((holiday-islamic-new-year)
    (holiday-islamic 9 1 "Ramadan Begins")
    (if calendar-islamic-all-holidays-flag
        (append
         (holiday-islamic 1 10 "Ashura")
         (holiday-islamic 3 12 "Mulad-al-Nabi")
         (holiday-islamic 7 26 "Shab-e-Mi'raj")
         (holiday-islamic 8 15 "Shab-e-Bara't")
         (holiday-islamic 9 27 "Shab-e Qadr")
         (holiday-islamic 10 1 "Id-al-Fitr")
         (holiday-islamic 12 10 "Id-al-Adha")))))
(setq holiday-bahai-holidays
  '((holiday-bahai-new-year)
    (holiday-bahai-ridvan)
    (holiday-fixed  5 23 "Declaration of the Báb")
    (holiday-fixed  5 29 "Ascension of Bahá’u’lláh")
    (holiday-fixed  7  9 "Martyrdom of the Báb")
    (holiday-fixed 10 20 "Birth of the Báb")
    (holiday-fixed 11 12 "Birth of Bahá’u’lláh")
    (if calendar-bahai-all-holidays-flag
        (append
         (holiday-fixed 11 26 "Day of the Covenant")
         (holiday-fixed 11 28 "Ascension of \`Abdu’l-Bahá")))))
(setq holiday-oriental-holidays
  '((holiday-chinese-new-year)
    (if calendar-chinese-all-holidays-flag
        (append
         (holiday-chinese 1 15 "Lantern Festival")
         (holiday-chinese-qingming)
         (holiday-chinese 5  5 "Dragon Boat Festival")
         (holiday-chinese 7  7 "Double Seventh Festival")
         (holiday-chinese 8 15 "Mid-Autumn Festival")
         (holiday-chinese 9  9 "Double Ninth Festival")
         (holiday-chinese-winter-solstice)))))
(setq holiday-solar-holidays
  '((solar-equinoxes-solstices)
    (holiday-sexp calendar-daylight-savings-starts
                  (format "Daylight Saving Time Begins %s"
                          (solar-time-string
                           (/ calendar-daylight-savings-starts-time (float 60))
                           calendar-standard-time-zone-name)))
    (holiday-sexp calendar-daylight-savings-ends
                  (format "Daylight Saving Time Ends %s"
                          (solar-time-string
                           (/ calendar-daylight-savings-ends-time (float 60))
                           calendar-daylight-time-zone-name)))))
`;

/** The group variables in the order `calendar-holidays` joins them. */
export const HOLIDAY_GROUPS = ['holiday-general-holidays', 'holiday-local-holidays', 'holiday-other-holidays', 'holiday-christian-holidays', 'holiday-hebrew-holidays', 'holiday-islamic-holidays', 'holiday-bahai-holidays', 'holiday-oriental-holidays', 'holiday-solar-holidays'];

