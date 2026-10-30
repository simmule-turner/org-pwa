// @ts-check
/**
 * Time values for the Lisp interpreter, as Emacs 29.3 has them: `format-time-string`, `encode-time`, `decode-time`, `float-time`
 * and `current-time`. A time is nil (now), a number of seconds, `(HIGH LOW [MICRO [PICO]])` or `(TICKS . HZ)`; a zone is nil
 * (the device's), t (UTC) or a number of seconds east of UTC (zone names are not carried).
 */
import { Cons, Flt, NIL, T, intern, list, signal, toArray, wrongType } from './elisp-data.js';
import { defun } from './elisp-core.js';
import { formatTimeString } from './format-time.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */

const invalidTime = () => signal('error', ['Invalid time specification']);

/** @param {LObj} x @returns {number} */
const isInt = (x) => (typeof x === 'number' ? x : typeof x === 'bigint' ? Number(x) : NaN);

/**
 * The seconds since the epoch a Lisp time stands for.
 * @param {LObj} t
 * @returns {number}
 */
function secondsOf(t) {
  if (t === NIL) return Date.now() / 1000;
  if (typeof t === 'number' || typeof t === 'bigint') return Number(t);
  if (t instanceof Flt) {
    if (!Number.isFinite(t.v)) throw invalidTime();
    return t.v;
  }
  if (t instanceof Cons) {
    if (typeof t.car === 'number' && typeof t.cdr === 'number' && t.cdr > 0) return t.car / t.cdr; // (TICKS . HZ)
    /** @type {LObj[]} */
    let parts;
    try {
      parts = toArray(t);
    } catch {
      if (typeof t.car === 'number' && typeof t.cdr === 'number') return t.car * 65536 + t.cdr; // (HIGH . LOW)
      throw invalidTime();
    }
    if (parts.length < 2 || parts.length > 4 || parts.some((p) => typeof p !== 'number')) throw invalidTime();
    const [hi, lo, us = 0, ps = 0] = /** @type {number[]} */ (parts);
    return hi * 65536 + lo + us / 1e6 + ps / 1e12;
  }
  throw invalidTime();
}

/**
 * A zone argument as minutes east of UTC: 0 for t, the number for an integer, null for the device's zone.
 * @param {LObj} zone
 * @returns {number | null}
 */
function zoneMinutes(zone) {
  if (zone === NIL) return null;
  if (zone === T) return 0;
  if (typeof zone === 'number') return zone / 60;
  throw signal('error', ['Invalid time zone specification: ' + (zone instanceof Cons || typeof zone === 'string' ? JSON.stringify(String(zone)) : String(/** @type {{ name?: string }} */ (zone).name ?? zone))]);
}

/** @param {number} seconds @returns {LObj} the list Emacs gives for a time */
function timeList(seconds) {
  const whole = Math.floor(seconds);
  const frac = seconds - whole;
  const items = [Math.floor(whole / 65536), whole - Math.floor(whole / 65536) * 65536];
  if (frac === 0) return list(items);
  return list([...items, Math.round(frac * 1e6), 0]);
}

defun('format-time-string', 2, 3, ([format, time = NIL, zone = NIL]) => {
  if (typeof format !== 'string') throw wrongType('stringp', format);
  const date = new Date(Math.round(secondsOf(time) * 1000));
  const minutes = zoneMinutes(zone);
  return formatTimeString(date, format, zone === T ? { utc: true } : minutes === null ? {} : { offset: minutes });
});

defun('float-time', 0, 1, ([time = NIL]) => new Flt(secondsOf(time)));
defun('current-time', 0, 0, () => timeList(Math.floor(Date.now() / 1000)));

/** @param {LObj} x @returns {number} */
function field(x) {
  const n = isInt(x);
  if (Number.isNaN(n)) throw invalidTime();
  return n;
}

defun('encode-time', 1, -1, (args) => {
  /** @type {LObj[]} */
  let items;
  /** @type {LObj} */
  let zone;
  if (args.length === 1) {
    items = toArray(args[0]);
    if (items.length < 6) throw invalidTime();
    zone = items.length >= 9 ? items[8] : NIL;
  } else {
    if (args.length < 6) throw signal('wrong-number-of-arguments', [intern('encode-time'), args.length]);
    items = args;
    zone = args.length >= 7 ? args[args.length - 1] : NIL;
  }
  const [sec, min, hour, day, mon, year] = items;
  const seconds = sec instanceof Flt ? sec.v : field(sec);
  const minutes = zoneMinutes(zone);
  const whole = Math.floor(seconds);
  const ms = Date.UTC(field(year), field(mon) - 1, field(day), field(hour), field(min), whole);
  const local = minutes === null ? new Date(field(year), field(mon) - 1, field(day), field(hour), field(min), whole).getTime() : ms - minutes * 60000;
  return timeList(local / 1000 + (seconds - whole));
});

defun('decode-time', 0, 3, ([time = NIL, zone = NIL]) => {
  const seconds = secondsOf(time);
  const minutes = zoneMinutes(zone);
  const date = new Date(Math.floor(seconds) * 1000);
  const shown = minutes === null ? date : new Date(date.getTime() + minutes * 60000);
  const utc = minutes !== null;
  const get = (/** @type {'Seconds'|'Minutes'|'Hours'|'Date'|'Month'|'FullYear'|'Day'} */ unit) => (utc ? shown[`getUTC${unit}`]() : shown[`get${unit}`]());
  const offset = minutes === null ? -date.getTimezoneOffset() * 60 : minutes * 60;
  return list([get('Seconds'), get('Minutes'), get('Hours'), get('Date'), get('Month') + 1, get('FullYear'), get('Day'), NIL, offset]);
});
