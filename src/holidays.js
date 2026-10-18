/**
 * The holidays `org-class` skips for the symbol `holidays`, and `calendar-check-holidays` lists:
 * Emacs's `holiday-general-holidays` (the US list) plus `holiday-christian-holidays` (Easter and
 * the days around it, and Christmas). The Hebrew, Islamic, Bahá'í, Chinese and solar holidays that
 * Emacs also lists by default are not included.
 */

/** Easter Sunday of `year`, as [month, day] (the Gregorian computus).
 * @param {number} year
 * @returns {[number, number]} */
function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return [month, ((h + l - 7 * m + 114) % 31) + 1];
}

/** Day of the month of the `n`th `weekday` (0 Sunday) of `month`; a negative `n` counts from the end.
 * @param {number} year @param {number} month @param {number} weekday @param {number} n */
function floatDay(year, month, weekday, n) {
  if (n > 0) return 1 + ((weekday - new Date(year, month - 1, 1).getDay() + 7) % 7) + 7 * (n - 1);
  const last = new Date(year, month, 0).getDate();
  return last - ((new Date(year, month - 1, last).getDay() - weekday + 7) % 7) + 7 * (n + 1);
}

/** Fixed-date holidays: [month, day, name]. */
const FIXED = /** @type {[number, number, string][]} */ ([
  [1, 1, "New Year's Day"], [2, 2, 'Groundhog Day'], [2, 14, "Valentine's Day"], [3, 17, "St. Patrick's Day"], [4, 1, "April Fools' Day"],
  [6, 14, 'Flag Day'], [7, 4, 'Independence Day'], [10, 31, 'Halloween'], [11, 11, "Veteran's Day"], [12, 25, 'Christmas'],
]);

/** Holidays on the nth weekday of a month: [month, weekday, n, name]. */
const FLOATING = /** @type {[number, number, number, string][]} */ ([
  [1, 1, 3, 'Martin Luther King Day'], [2, 1, 3, "President's Day"], [5, 0, 2, "Mother's Day"], [5, 1, -1, 'Memorial Day'],
  [6, 0, 3, "Father's Day"], [9, 1, 1, 'Labor Day'], [10, 1, 2, 'Columbus Day'], [11, 4, 4, 'Thanksgiving'],
]);

/** Days from Easter Sunday: [offset, name]. */
const EASTER_DAYS = /** @type {[number, string][]} */ ([[-46, 'Ash Wednesday'], [-2, 'Good Friday'], [0, 'Easter Sunday']]);

/**
 * The names of the holidays on `date`, as `calendar-check-holidays` returns them (empty when none).
 * @param {Date} date
 * @returns {string[]}
 */
export function holidaysOn(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const names = [];
  for (const [fm, fd, name] of FIXED) if (fm === m && fd === d) names.push(name);
  for (const [fm, wd, n, name] of FLOATING) if (fm === m && floatDay(y, m, wd, n) === d) names.push(name);
  const [em, ed] = easter(y);
  const easterDate = new Date(y, em - 1, ed);
  for (const [offset, name] of EASTER_DAYS) {
    const h = new Date(y, easterDate.getMonth(), easterDate.getDate() + offset);
    if (h.getMonth() + 1 === m && h.getDate() === d) names.push(name);
  }
  return names;
}
