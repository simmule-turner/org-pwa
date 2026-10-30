// @ts-check
/**
 * `format-time-string`: Emacs's strftime, ported with its flags and widths and held to Emacs's own answers by
 * test/format-time.test.js (tools/gen-format-time-oracle.mjs writes them).  Used by capture templates (`%<FORMAT>`),
 * the `format-time-string` function of table formulas, and the mode line clock (`display-time-format`).
 *
 *   %a %A  weekday, short / full        %b %B %h  month, short / full        %c  date and time (C locale)
 *   %C  century                         %d %e  day of month, 01 / " 1"       %D  %m/%d/%y
 *   %F  %Y-%m-%d                        %g %G  ISO week-numbering year       %H %k  hour 00-23 / " 0"-"23"
 *   %I %l  hour 01-12 / " 1"-"12"       %j  day of year                      %m  month 01-12
 *   %M  minute                          %n %t  newline, tab                  %N  nanoseconds (%3N = milliseconds)
 *   %p %P  AM/PM, am/pm                 %r  %I:%M:%S %p                      %R  %H:%M
 *   %s  seconds since 1970              %S  second                           %T  %H:%M:%S
 *   %u  weekday 1-7 (Monday is 1)       %w  weekday 0-6 (Sunday is 0)        %U %W  week of the year (Sunday / Monday first)
 *   %V  ISO week                        %x  %m/%d/%y                         %X  %H:%M:%S
 *   %y  year in the century             %Y  year                             %z %:z %::z %:::z  UTC offset
 *   %Z  time zone name                  %%  a percent sign
 *
 * Between `%` and the letter: a flag (`-` no padding, `_` pad with spaces, `0` pad with zeros, `^` upper case, `#` the other
 * case), a width, and `E` or `O` (ignored).  Text that is not a conversion is left as it is, `%Q` included.
 * Names are English, whatever the device's language, as in Emacs's default locale.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * @typedef {{
 *   year: number, month: number, day: number, hour: number, minute: number, second: number, ms: number,
 *   wday: number, yday: number, offset: number, zone: string, epoch: number
 * }} TimeFields
 */

/** @param {number} y */
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** @param {Date} date @param {boolean} utc @param {number} [shiftMinutes]  a fixed UTC offset to show the time in (Emacs's `ZONE` argument as a number of seconds) @returns {TimeFields} */
function fieldsOf(date, utc, shiftMinutes) {
  if (shiftMinutes !== undefined) {
    const f = fieldsOf(new Date(date.getTime() + shiftMinutes * 60000), true);
    const sign = shiftMinutes < 0 ? '-' : '+';
    const abs = Math.abs(shiftMinutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = abs % 60 ? String(abs % 60).padStart(2, '0') : '';
    return { ...f, offset: shiftMinutes, zone: shiftMinutes === 0 ? 'UTC' : sign + hh + mm, epoch: Math.floor(date.getTime() / 1000) };
  }
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = utc ? date.getUTCMonth() : date.getMonth();
  const day = utc ? date.getUTCDate() : date.getDate();
  const startOfYear = Date.UTC(year, 0, 1);
  const today = Date.UTC(year, month, day);
  return {
    year,
    month,
    day,
    hour: utc ? date.getUTCHours() : date.getHours(),
    minute: utc ? date.getUTCMinutes() : date.getMinutes(),
    second: utc ? date.getUTCSeconds() : date.getSeconds(),
    ms: date.getMilliseconds(),
    wday: utc ? date.getUTCDay() : date.getDay(),
    yday: Math.round((today - startOfYear) / 86400000),
    offset: utc ? 0 : -date.getTimezoneOffset(),
    zone: utc ? 'GMT' : zoneAbbreviation(date),
    epoch: Math.floor(date.getTime() / 1000),
  };
}

/** @param {Date} date */
function zoneAbbreviation(date) {
  const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(date).find((p) => p.type === 'timeZoneName');
  return part ? part.value : '';
}

/** ISO 8601 week-numbering year and week. @param {TimeFields} f */
function isoWeek(f) {
  const isoWday = (f.wday + 6) % 7; // Monday is 0
  let year = f.year;
  let week = Math.floor((f.yday - isoWday + 10) / 7);
  if (week < 1) {
    year -= 1;
    const dec31Yday = isLeap(year) ? 365 : 364;
    const dec31Wday = (isoWday - f.yday - 1 + 7 * 60) % 7; // weekday of Dec 31 of the previous year, Monday 0
    week = Math.floor((dec31Yday - dec31Wday + 10) / 7);
  } else if (week === 53) {
    const daysInYear = isLeap(year) ? 366 : 365;
    if (f.yday - isoWday + 3 >= daysInYear) {
      week = 1;
      year += 1;
    }
  }
  return { year, week };
}

/**
 * `format-time-string`.
 * @param {Date} date
 * @param {string} format
 * @param {{ utc?: boolean, offset?: number }} [options] `utc`: format in UTC rather than the device's time zone (Emacs's `ZONE` argument `t`); `offset`: in the zone that many minutes east of UTC.
 * @returns {string}
 */
export function formatTimeString(date, format, options = {}) {
  return expand(format, fieldsOf(date, !!options.utc, options.offset));
}

/** @param {string} format @param {TimeFields} f @returns {string} */
function expand(format, f) {
  let out = '';
  for (let i = 0; i < format.length; i++) {
    if (format[i] !== '%') {
      out += format[i];
      continue;
    }
    const start = i;
    let j = i + 1;
    let pad = '';
    let upper = false;
    let swap = false;
    for (; j < format.length; j++) {
      const c = format[j];
      if (c === '-' || c === '_' || c === '0') pad = c;
      else if (c === '^') upper = true;
      else if (c === '#') swap = true;
      else break;
    }
    let width = -1;
    const digits = /^[0-9]+/.exec(format.slice(j));
    if (digits) {
      width = Number(digits[0]);
      j += digits[0].length;
    }
    while (format[j] === 'E' || format[j] === 'O') j++;
    let colons = 0;
    while (format[j] === ':') {
      colons++;
      j++;
    }
    const spec = format[j];
    const fl = { pad, upper, swap, width, colons };
    const piece = spec === undefined ? null : convert(spec, f, fl, j > i + 1);
    if (piece === null) {
      // not a conversion: kept as written, padded like any other text
      const end = spec === undefined ? format.length : j + 1;
      out += word(format.slice(start, end), { ...fl, swap: false }, 'none');
      i = end - 1;
    } else {
      out += piece;
      i = j;
    }
  }
  return out;
}

/**
 * @typedef {{ pad: string, upper: boolean, swap: boolean, width: number, colons: number }} Flags
 */

/** A number, padded as strftime pads it. @param {number} value @param {number} digits @param {string} defaultPad @param {Flags} fl */
function number(value, digits, defaultPad, fl) {
  const negative = value < 0;
  let text = String(Math.abs(value));
  const pad = fl.pad || defaultPad;
  const width = fl.width < 0 ? digits : fl.width;
  if (pad !== '-') {
    const room = width - text.length - (negative ? 1 : 0);
    if (room > 0) text = pad === '_' ? ' '.repeat(room) + (negative ? '-' : '') + text : (negative ? '-' : '') + '0'.repeat(room) + text;
    else if (negative) text = '-' + text;
  } else if (negative) text = '-' + text;
  return text;
}

/** Text, padded to the width; `^` and `#` change its case. @param {string} text @param {Flags} fl @param {'upper' | 'lower' | 'none'} swapTo */
function word(text, fl, swapTo) {
  let s = text;
  if (fl.upper) s = s.toUpperCase();
  else if (fl.swap) s = swapTo === 'upper' ? s.toUpperCase() : swapTo === 'lower' ? s.toLowerCase() : s;
  if (fl.width > s.length && fl.pad !== '-') s = (fl.pad === '0' ? '0' : ' ').repeat(fl.width - s.length) + s;
  return s;
}

/** @param {string} spec @param {TimeFields} f @param {Flags} fl @param {boolean} flagged a flag, width or modifier came before the letter @returns {string | null} */
function convert(spec, f, fl, flagged) {
  const hour12 = f.hour % 12 || 12;
  const composite = (/** @type {string} */ sub) => word(expand(sub, f), fl.upper ? fl : { ...fl, upper: false }, 'none');
  if (fl.colons && spec !== 'z') return null;
  switch (spec) {
    case 'a':
      return word(DAYS[f.wday].slice(0, 3), fl, 'upper');
    case 'A':
      return word(DAYS[f.wday], fl, 'upper');
    case 'b':
    case 'h':
      return word(MONTHS[f.month].slice(0, 3), fl, 'upper');
    case 'B':
      return word(MONTHS[f.month], fl, 'upper');
    case 'c':
      return composite('%a %b %e %H:%M:%S %Y');
    case 'C':
      return number(Math.floor(f.year / 100), 2, '0', fl);
    case 'd':
      return number(f.day, 2, '0', fl);
    case 'D':
    case 'x':
      return composite('%m/%d/%y');
    case 'e':
      return number(f.day, 2, '_', fl);
    case 'F':
      return word(expand('%Y-%m-%d', f), { ...fl, pad: fl.pad || '0' }, 'none');
    case 'g': {
      const { year } = isoWeek(f);
      return number(((year % 100) + 100) % 100, 2, '0', fl);
    }
    case 'G':
      return number(isoWeek(f).year, 4, '0', fl);
    case 'H':
      return number(f.hour, 2, '0', fl);
    case 'I':
      return number(hour12, 2, '0', fl);
    case 'j':
      return number(f.yday + 1, 3, '0', fl);
    case 'k':
      return number(f.hour, 2, '_', fl);
    case 'l':
      return number(hour12, 2, '_', fl);
    case 'm':
      return number(f.month + 1, 2, '0', fl);
    case 'M':
      return number(f.minute, 2, '0', fl);
    case 'n':
      return word('\n', fl, 'none');
    case 'N': {
      const digits = fl.width < 0 ? 9 : fl.width;
      let text = String(f.ms * 1e6).padStart(9, '0');
      text = digits <= 9 ? text.slice(0, digits) : text + '0'.repeat(digits - 9);
      if (fl.pad === '-' || fl.pad === '_') {
        text = text.replace(/0+$/, '') || '0';
        if (fl.pad === '_') text = text.padEnd(digits, ' ');
      }
      return text;
    }
    case 'p':
      return word(f.hour < 12 ? 'AM' : 'PM', fl, 'lower');
    case 'P':
      return word(f.hour < 12 ? 'am' : 'pm', { ...fl, upper: false }, 'none');
    case 'q':
      return number(Math.floor(f.month / 3) + 1, 1, '0', fl);
    case 'r':
      return composite('%I:%M:%S %p');
    case 'R':
      return composite('%H:%M');
    case 's':
      return number(f.epoch, 1, '0', fl);
    case 'S':
      return number(f.second, 2, '0', fl);
    case 't':
      return word('\t', fl, 'none');
    case 'T':
    case 'X':
      return composite('%H:%M:%S');
    case 'u':
      return number(f.wday === 0 ? 7 : f.wday, 1, '0', fl);
    case 'U':
      return number(Math.floor((f.yday + 7 - f.wday) / 7), 2, '0', fl);
    case 'V':
      return number(isoWeek(f).week, 2, '0', fl);
    case 'w':
      return number(f.wday, 1, '0', fl);
    case 'W':
      return number(Math.floor((f.yday + 7 - ((f.wday + 6) % 7)) / 7), 2, '0', fl);
    case 'y':
      return number(((f.year % 100) + 100) % 100, 2, '0', fl);
    case 'Y':
      return number(f.year, 4, '0', fl);
    case 'z':
      return offset(f.offset, fl);
    case 'Z':
      return word(f.zone, fl, 'lower');
    case '%': {
      if (!flagged) return '%';
      // Emacs reads `%` with a flag or width as a bad conversion, and counts its padding one short
      const text = '%' + fl.pad + (fl.upper ? '^' : '') + (fl.swap ? '#' : '') + (fl.width >= 0 ? fl.width : '') + '%';
      return fl.width > text.length - 1 && fl.pad !== '-' ? ' '.repeat(fl.width - (text.length - 1)) + text : text;
    }
    default:
      return null;
  }
}

/** `%z` and its colon forms: the sign and the digits, padded as a number is (spaces go before the sign, zeros after it).
 * @param {number} minutes @param {Flags} fl */
function offset(minutes, fl) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  const two = (/** @type {number} */ n) => (fl.pad === '-' ? String(n) : String(n).padStart(2, '0'));
  let digits;
  let defaultWidth;
  switch (fl.colons) {
    case 0:
      digits = String(hh * 100 + mm);
      defaultWidth = 5;
      break;
    case 1:
      digits = `${two(hh)}:${String(mm).padStart(2, '0')}`;
      defaultWidth = 6;
      break;
    case 2:
      digits = `${two(hh)}:${String(mm).padStart(2, '0')}:00`;
      defaultWidth = 9;
      break;
    default:
      digits = mm ? `${two(hh)}:${String(mm).padStart(2, '0')}` : two(hh);
      defaultWidth = mm ? 6 : 3;
  }
  const width = fl.width < 0 ? defaultWidth : fl.width;
  const room = width - digits.length - 1;
  if (fl.pad === '-' || room <= 0) return sign + digits;
  return fl.pad === '_' ? ' '.repeat(room) + sign + digits : sign + '0'.repeat(room) + digits;
}
