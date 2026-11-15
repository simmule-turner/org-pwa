// @ts-check
/**
 * The date prompt of Emacs 29.3 / Org 9.6 (org-read-date and org-read-date-analyze), for text that was typed: `+1h`, `12:30`, `9am`,
 * `fri 9:00`, `dec 25 2027`, `25.12.2027`, `2027-W10`, `12-3-29`, a bare day of the month, `+N[dwmy]` from today, `++N` from the
 * default time, `-fri`, and the rest of what `parse-time-string` understands. The analysis is ported branch by branch; `parse-time-string`
 * (with the ISO 8601 reading it tries first) is ported with it. Dates are worked out in civil fields (as UTC arithmetic) and only the
 * final answer is a local Date.
 *
 * org-read-date-prefer-future (nil, t or time) and org-extend-today-until are the options; `org-read-date-force-compatible-dates` is
 * Emacs's default, t: years are held to 1970-2037.
 */

/** @typedef {{ sec: number, min: number, hour: number, day: number, month: number, year: number }} Civil */
/** @typedef {{ preferFuture?: boolean | 'time', extendTodayUntil?: number, now?: Date, defaultTime?: Date | null, endBound?: boolean, givenBound?: boolean, timeGiven?: boolean }} ReadDateOptions */
/** @typedef {{ date: Date, timeGiven: boolean, endTimeGiven: string | null, futurep: boolean, forcedYear: boolean }} ReadDateResult */

const W_START = '(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}])';
const W_END = '(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}])';

const MONTHS = /** @type {Record<string, number>} */ ({ jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 });
const WEEKDAYS = /** @type {Record<string, number>} */ ({ sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 });
const ZONES = /** @type {Record<string, [number, boolean | null]>} */ ({ z: [0, null], ut: [0, null], gmt: [0, null], pst: [-8 * 3600, null], pdt: [-7 * 3600, true], mst: [-7 * 3600, null], mdt: [-6 * 3600, true], cst: [-6 * 3600, null], cdt: [-5 * 3600, true], est: [-5 * 3600, null], edt: [-4 * 3600, true] });

/** The Date of civil fields, as UTC arithmetic (fields out of range roll over, as encode-time's do). @param {number} y @param {number} mo @param {number} d @param {number} h @param {number} mi @param {number} s */
const utc = (y, mo, d, h, mi, s) => {
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  t.setUTCHours(h, mi, s, 0);
  return t;
};

/** The fields of a local Date, decode-time's. @param {Date} d @returns {Civil & { dow: number }} */
export function civilOf(d) {
  return { sec: d.getSeconds(), min: d.getMinutes(), hour: d.getHours(), day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear(), dow: d.getDay() };
}

/** `cl-parse-integer`. @param {string} s */
function parseInteger(s) {
  const t = s.trim();
  if (!/^[+-]?\d+$/.test(t)) throw new Error(`Not an integer string: \`${s}'`);
  return Number(t);
}

/** `string-to-number` for the integers this reads (leading blanks allowed, anything else after the digits ignored). @param {string} s */
const stringToNumber = (s) => {
  const m = /^[ \t]*([+-]?\d+)/.exec(s);
  return m ? Number(m[1]) : 0;
};

// ------------------------------------------------------------------ parse-time-string

/** @param {string} c @returns {number | string | null} */
function timeChar(c) {
  if (c >= 'a' && c <= 'z') return 'a';
  if (c >= '0' && c <= '9') return '0';
  if (c === '+') return 1;
  if (c === '-') return -1;
  if (c === ':') return 'd';
  return null;
}

/** `parse-time-tokenize`. @param {string} string @returns {(string | number)[]} */
function tokenize(string) {
  const end = string.length;
  /** @type {(string | number)[]} */ const list = [];
  let index = 0;
  while (index < end) {
    let c = timeChar(string[index]);
    while (index < end && c === null) {
      index++;
      if (index < end) c = timeChar(string[index]);
    }
    if (index >= end) break;
    const start = index;
    let allDigits = c === '0';
    index++;
    while (index < end && (c = timeChar(string[index])) !== null) {
      allDigits = allDigits && c === '0';
      index++;
    }
    const text = string.slice(start, index);
    list.push(allDigits ? Number(text) : text);
  }
  return list;
}

/** @typedef {(number | null)[]} TimeList  sec min hour day month year dow dst zone */

const ISO_YEAR = '([+-]?[0-9][0-9][0-9][0-9])';
const ISO_FULL = '([+-]?[0-9][0-9][0-9][0-9])-?([0-9][0-9])-?([0-9][0-9])';
const ISO_NODAY = '([+-]?[0-9][0-9][0-9][0-9])-([0-9][0-9])';
const ISO_OLD = '--([0-9][0-9])-?([0-9][0-9])';
const ISO_OLD_REDUCED = '---?([0-9][0-9])';
const ISO_WEEK = '([+-]?[0-9][0-9][0-9][0-9])-?W([0-9][0-9])-?([0-9])?';
const ISO_ORDINAL = '([+-]?[0-9][0-9][0-9][0-9])-?([0-9][0-9][0-9])';
const isoAlt = (/** @type {string[]} */ list) => list.map((r) => `(?:${r.replace(/\(/g, '(?:')})`).join('|');
const ISO_DATE = isoAlt([ISO_YEAR, ISO_FULL, ISO_NODAY, ISO_OLD, ISO_OLD_REDUCED, ISO_WEEK, ISO_ORDINAL]);
const ISO_TIME = '([0-9][0-9]):?([0-9][0-9])?:?([0-9][0-9])?[.,]?([0-9]*)';
const ISO_ZONE = '(Z|([+-])([0-9][0-9]):?([0-9][0-9])?)';
const ISO_COMBINED = new RegExp(`^(${ISO_DATE})(?:T(${ISO_TIME.replace(/\(/g, '(?:')})(${ISO_ZONE})?)?$`, 'i');
const isoWhole = (/** @type {string} */ r) => new RegExp(`^${r}$`, 'i');

/** `date-leap-year-p`. @param {number} y */
const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** iso8601-parse's date and time for a string iso8601-valid-p accepts; null if it does not. @param {string} string @returns {TimeList | null} */
function iso8601(string) {
  const m = ISO_COMBINED.exec(string);
  if (!m) return null;
  const date = m[1];
  const timeString = m[2];
  /** @type {RegExpExecArray | null} */ let r;
  let year = null;
  let month = null;
  let day = null;
  if (isoWhole(ISO_YEAR).test(date)) year = Number(date);
  else if ((r = isoWhole(ISO_FULL).exec(date))) [year, month, day] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = isoWhole(ISO_NODAY).exec(date))) [year, month] = [Number(r[1]), Number(r[2])];
  else if ((r = isoWhole(ISO_OLD).exec(date))) [month, day] = [Number(r[1]), Number(r[2])];
  else if ((r = isoWhole(ISO_WEEK).exec(date))) {
    year = Number(r[1]);
    const week = Number(r[2]);
    const dayOfWeek = r[3] === undefined ? 0 : Number(r[3]);
    const jan = utc(year, 1, 4, 0, 0, 0).getUTCDay();
    let ordinal = week * 7 + dayOfWeek - ((jan === 0 ? 7 : jan) + 3);
    if (ordinal < 1) {
      year -= 1;
      ordinal += leap(year) ? 366 : 365;
    } else if (ordinal > (leap(year) ? 366 : 365)) {
      ordinal -= leap(year) ? 366 : 365;
      year += 1;
    }
    const md = utc(year, 1, ordinal, 0, 0, 0);
    [month, day] = [md.getUTCMonth() + 1, md.getUTCDate()];
  } else if ((r = isoWhole(ISO_ORDINAL).exec(date))) {
    year = Number(r[1]);
    const md = utc(year, 1, Number(r[2]), 0, 0, 0);
    [month, day] = [md.getUTCMonth() + 1, md.getUTCDate()];
  } else if ((r = /^--([0-9][0-9])$/.exec(date))) month = Number(r[1]);
  else if ((r = /^---([0-9][0-9])$/.exec(date))) day = Number(r[1]);
  else return null;
  /** @type {TimeList} */ const time = [null, null, null, day, month, year, null, -1, null];
  if (timeString) {
    const t = new RegExp(`^${ISO_TIME}$`).exec(timeString);
    if (t) [time[2], time[1], time[0]] = [Number(t[1]), t[2] === undefined ? 0 : Number(t[2]), t[3] === undefined ? 0 : Number(t[3])];
  }
  return time;
}

/** `parse-time-string`: the six fields (SEC MIN HOUR DAY MON YEAR) and the weekday, nil as null. Errors as Emacs's do. @param {string} string @returns {TimeList} */
export function parseTimeString(string) {
  const iso = iso8601(string);
  if (iso) return iso;
  /** @type {TimeList} */ const time = [null, null, null, null, null, null, null, -1, null];
  const tokens = tokenize(string.toLowerCase());
  const isStr = (/** @type {unknown} */ x) => typeof x === 'string';
  /** @type {{ slots: number[], test: (e: string | number) => any, extract: (((e: string | number, v: any) => any) | [number, number])[] }[]} */
  const rules = [
    { slots: [6], test: (e) => WEEKDAYS[/** @type {string} */ (e)], extract: [] },
    { slots: [3], test: (e) => (typeof e === 'number' && e >= 1 && e <= 31 ? e : undefined), extract: [] },
    { slots: [4], test: (e) => MONTHS[/** @type {string} */ (e)], extract: [] },
    { slots: [5], test: (e) => (typeof e === 'number' && e >= 100 ? e : undefined), extract: [] },
    { slots: [2, 1, 0], test: (e) => isStr(e) && /** @type {string} */ (e).length === 8 && /** @type {string} */ (e)[2] === ':' && /** @type {string} */ (e)[5] === ':', extract: [[0, 2], [3, 5], [6, 8]] },
    { slots: [8, 7], test: (e) => ZONES[/** @type {string} */ (e)], extract: [(_e, v) => v[0], (_e, v) => v[1]] },
    { slots: [8], test: (e) => isStr(e) && /** @type {string} */ (e).length === 5 && (/** @type {string} */ (e)[0] === '+' || /** @type {string} */ (e)[0] === '-'), extract: [(e) => 60 * (parseInteger(/** @type {string} */ (e).slice(3, 5)) + 60 * parseInteger(/** @type {string} */ (e).slice(1, 3))) * (/** @type {string} */ (e)[0] === '-' ? -1 : 1)] },
    { slots: [5, 4, 3], test: (e) => isStr(e) && /** @type {string} */ (e).length === 10 && /** @type {string} */ (e)[4] === '-' && /** @type {string} */ (e)[7] === '-', extract: [[0, 4], [5, 7], [8, 10]] },
    { slots: [2, 1, 0], test: (e) => isStr(e) && /** @type {string} */ (e).length === 5 && /** @type {string} */ (e)[2] === ':', extract: [[0, 2], [3, 5], () => 0] },
    { slots: [2, 1, 0], test: (e) => isStr(e) && /** @type {string} */ (e).length === 4 && /** @type {string} */ (e)[1] === ':', extract: [[0, 1], [2, 4], () => 0] },
    { slots: [2, 1, 0], test: (e) => isStr(e) && /** @type {string} */ (e).length === 7 && /** @type {string} */ (e)[1] === ':', extract: [[0, 1], [2, 4], [5, 7]] },
    { slots: [5], test: (e) => (typeof e === 'number' && e >= 50 && e <= 110 ? e : undefined), extract: [(e) => 1900 + /** @type {number} */ (e)] },
    { slots: [5], test: (e) => (typeof e === 'number' && e >= 0 && e <= 49 ? e : undefined), extract: [(e) => 2000 + /** @type {number} */ (e)] },
  ];
  for (const elt of tokens) {
    for (const rule of rules) {
      if (time[rule.slots[0]] !== null) continue;
      const val = rule.test(elt);
      if (val === undefined || val === false || val === null) continue;
      rule.slots.forEach((slot, i) => {
        const x = rule.extract[i];
        time[slot] = rule.extract.length === 0 ? val : Array.isArray(x) ? parseInteger(String(elt).slice(x[0], x[1])) : x(elt, val);
      });
      break;
    }
  }
  return time;
}

// ------------------------------------------------------------------ org-read-date

/** `org-small-year-to-year`. @param {number} year @param {number} current */
export function smallYearToYear(year, current) {
  if (year >= 100) return year;
  const century = Math.trunc(current / 100);
  const offset = year - (current % 100);
  if (offset > 30) return (century - 1) * 100 + year;
  if (offset > -70) return century * 100 + year;
  return (century + 1) * 100 + year;
}

const RELATIVE_RE = new RegExp(`^[ \\t]*([-+]{0,2})([0-9]+)?([hdwmy]|(${Object.keys(WEEKDAYS).join('|')}))?([ \\t]|$)`, 'i');

/** org-read-date-get-relative: [n, what, relative-to-default] and the matched text, or null. @param {string} s @param {Civil & { dow: number }} today @param {Civil & { dow: number }} def */
function getRelative(s, today, def) {
  const m = RELATIVE_RE.exec(s);
  if (!m || !(m[1].length > 0 || m[4] !== undefined)) return null;
  const dir = m[1].length > 0 ? m[1][m[1].length - 1] : '+';
  const rel = m[1].length === 2;
  const n = m[2] === undefined ? 1 : Number(m[2]);
  const what = m[3] === undefined ? 'd' : m[3];
  const wday1 = WEEKDAYS[what.toLowerCase()];
  const wday = (rel ? def : today).dow;
  if (wday1 !== undefined) {
    let delta = (7 + wday1 - wday) % 7;
    if (delta === 0) delta = 7;
    if (dir === '-') {
      delta -= 7;
      if (delta === 0) delta = -7;
    }
    if (n > 1) delta += (n - 1) * (dir === '-' ? -7 : 7);
    return { delta: [delta, 'd', rel], text: m[0] };
  }
  return { delta: [n * (dir === '-' ? -1 : 1), what, rel], text: m[0] };
}

/** org-plain-time-of-day-regexp: groups 1 (the first time), 7 (the range part) and 8 (the second time). */
const T1 = `(${W_START}[012]?[0-9]((:([0-5][0-9]([AaPp][Mm])?))|([AaPp][Mm]))${W_END})`;
const PLAIN_TIME_RE = new RegExp(`${T1}(--?(${W_START}[012]?[0-9]((:([0-5][0-9]([AaPp][Mm])?))|([AaPp][Mm]))${W_END}))?`, 'u');
const HAS_CLOCK_RE = /(?:^|[^+])[012]?[0-9]:[0-9][0-9](?:[ \t\n]|$)/m;
const AMPM_RE = new RegExp(`([012]?[0-9])(:([0-5][0-9]))?(am|AM|pm|PM)${W_END}`, 'iu');
const HH_RE = new RegExp(`(?:([012]?[0-9])?h([0-5][0-9]))|(?:([012]?[0-9])h([0-5][0-9])?)${W_END}`, 'iu');
const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');
const pad4 = (/** @type {number} */ n) => String(n).padStart(4, '0');

/** @param {string} s @param {RegExpExecArray} m @param {string} by */
const replaceMatch = (s, m, by) => s.slice(0, m.index) + by + s.slice(m.index + m[0].length);

/**
 * org-read-date-analyze: the answer typed, over the default time `def` and the actual time `nowFields`.
 * @param {string} answer @param {Civil & { dow: number }} def @param {Civil & { dow: number }} now
 * @param {{ preferFuture: boolean | 'time', endBound: boolean, givenBound: boolean, timeGiven: boolean, currentYear: number }} o
 */
export function analyze(answer, def, now, o) {
  let ans = answer;
  let timeGiven = o.timeGiven;
  /** @type {string | null} */ let endTimeGiven = null;
  /** @type {number | undefined} */ let deltan;
  /** @type {string | undefined} */ let deltaw;
  /** @type {boolean | undefined} */ let deltadef;
  /** @type {number} */ let year;
  /** @type {number} */ let month;
  /** @type {number} */ let day;
  /** @type {number | undefined} */ let isoYear;
  /** @type {number | undefined} */ let isoWeekday;
  /** @type {number | undefined} */ let isoWeek;
  let futurep = false;
  let killYear = false;
  const small = (/** @type {number} */ y) => smallYearToYear(y, o.currentYear);
  /** @type {RegExpExecArray | null} */ let m;
  if (/^[ \t]*\.[ \t]*$/.test(ans)) ans = '+0';
  const rel = getRelative(ans, now, def);
  if (rel) {
    [deltan, deltaw, deltadef] = /** @type {[number, string, boolean]} */ (rel.delta);
    ans = ans.slice(rel.text.length);
  }
  if ((m = new RegExp(`${W_START}(?:([0-9]+)-)?[wW]([0-9]{1,2})(?:-([0-6]))?([ \\t]|$)`, 'imu').exec(ans))) {
    isoYear = m[1] !== undefined ? small(Number(m[1])) : undefined;
    isoWeekday = m[3] !== undefined ? Number(m[3]) : undefined;
    isoWeek = Number(m[2]);
    ans = replaceMatch(ans, m, '');
  }
  if ((m = /^ *(([0-9]+)-)?([0-1]?[0-9])-([0-3]?[0-9])([^-0-9]|$)/im.exec(ans))) {
    if (m[2] !== undefined) year = Number(m[2]);
    else {
      killYear = true;
      year = o.currentYear;
    }
    month = Number(m[3]);
    day = Number(m[4]);
    year = small(year);
    ans = replaceMatch(ans, m, `${pad4(year)}-${pad2(month)}-${pad2(day)}${m[5]}`);
  }
  if ((m = /^ *(3[01]|0?[1-9]|[12][0-9])\. ?(0?[1-9]|1[012])\.( ?[1-9][0-9]{3})?/im.exec(ans))) {
    if (m[3] !== undefined) year = stringToNumber(m[3]);
    else {
      killYear = true;
      year = o.currentYear;
    }
    day = Number(m[1]);
    month = Number(m[2]);
    ans = replaceMatch(ans, m, `${pad4(year)}-${pad2(month)}-${pad2(day)}`);
  }
  if ((m = /^ *(0?[1-9]|1[012])\/(0?[1-9]|[12][0-9]|3[01])(\/([0-9]+))?([^/0-9]|$)/im.exec(ans))) {
    if (m[4] !== undefined) year = Number(m[4]);
    else {
      killYear = true;
      year = o.currentYear;
    }
    month = Number(m[1]);
    day = Number(m[2]);
    year = small(year);
    ans = replaceMatch(ans, m, `${pad4(year)}-${pad2(month)}-${pad2(day)}${m[5]}`);
  }
  for (let i = 0; i < 2; i++) {
    if (!HAS_CLOCK_RE.test(ans) && (m = AMPM_RE.exec(ans))) {
      let hour = Number(m[1]);
      const minute = m[3] !== undefined ? Number(m[3]) : 0;
      const pm = m[4].toLowerCase()[0] === 'p';
      if (hour === 12 && !pm) hour = 0;
      else if (pm && hour < 12) hour += 12;
      ans = replaceMatch(ans, m, `${pad2(hour)}:${pad2(minute)}`);
    }
  }
  for (let i = 0; i < 2; i++) {
    if (!HAS_CLOCK_RE.test(ans) && (m = HH_RE.exec(ans))) {
      const h = m[1] ?? m[3];
      const mi = m[2] ?? m[4];
      ans = replaceMatch(ans, m, `${pad2(h !== undefined ? Number(h) : 0)}:${pad2(mi !== undefined ? Number(mi) : 0)}`);
    }
  }
  if ((m = /([012]?[0-9]):([0-6][0-9])\+([012]?[0-9])(:([0-5][0-9]))?/i.exec(ans))) {
    const hour = Number(m[1]);
    let h2 = hour + Number(m[3]);
    const minute = Number(m[2]);
    let m2 = minute + (m[5] !== undefined ? Number(m[5]) : 0);
    if (m2 >= 60) {
      h2 += 1;
      m2 -= 60;
    }
    ans = replaceMatch(ans, m, `${pad2(hour)}:${pad2(minute)}-${pad2(h2)}:${pad2(m2)}`);
  }
  if (o.endBound) {
    timeGiven = false;
    if ((m = PLAIN_TIME_RE.exec(ans)) && m[8] !== undefined) {
      endTimeGiven = m[8];
      const start = m.index + m[1].length;
      ans = ans.slice(0, start) + ans.slice(start + m[7].length);
    }
  }
  const tl = parseTimeString(ans);
  const defDay = def.day;
  day = tl[3] ?? defDay;
  if (tl[4] !== null) month = tl[4];
  else if (!o.preferFuture) month = def.month;
  else if (tl[3] !== null) {
    futurep = true;
    month = day < now.day ? now.month + 1 : now.month;
  } else month = def.month;
  if (!killYear && tl[5] !== null) year = tl[5];
  else if (!o.preferFuture) year = def.year;
  else if (futurep) year = month > now.month || day >= now.day ? now.year : now.year + 1;
  else if (tl[4] !== null) {
    futurep = true;
    if (month > now.month) year = now.year;
    else if (month < now.month) year = now.year + 1;
    else if (day < now.day) year = now.year + 1;
    else year = now.year;
  } else year = def.year;
  let hour = tl[2] ?? def.hour;
  const minute = tl[1] ?? def.min;
  const second = tl[0] ?? 0;
  const wday = tl[6];
  if (o.preferFuture === 'time' && tl[3] === null && tl[4] === null && tl[5] === null && day === now.day && month === now.month && year === now.year && tl[2] !== null && (tl[2] < now.hour || (tl[2] === now.hour && tl[1] !== null && tl[1] < now.min))) {
    day += 1;
    futurep = true;
  }
  if (isoWeek !== undefined) {
    futurep = false;
    year = isoYear ?? year;
    day = isoWeekday ?? wday ?? 1;
    // calendar-iso-to-absolute (week day year), then the Gregorian date of it
    const jan4 = utc(year, 1, 4, 0, 0, 0);
    const jan4dow = (jan4.getUTCDay() + 6) % 7;
    const first = new Date(jan4.getTime() - jan4dow * 86400000);
    const target = new Date(first.getTime() + ((isoWeek - 1) * 7 + ((day + 6) % 7)) * 86400000);
    [month, year, day] = [target.getUTCMonth() + 1, target.getUTCFullYear(), target.getUTCDate()];
  } else if (deltan !== undefined) {
    futurep = false;
    if (!deltadef) [day, month, year] = [now.day, now.month, now.year];
    if (deltaw === 'h' || deltaw === '') {
      if (o.givenBound) timeGiven = true;
      hour += deltan;
    } else if (deltaw === 'd') day += deltan;
    else if (deltaw === 'w') day += 7 * deltan;
    else if (deltaw === 'm') month += deltan;
    else if (deltaw === 'y') year += deltan;
  } else if (wday !== null && tl[3] === null) {
    const wday1 = utc(year, month, day, 0, 0, 0).getUTCDay();
    if (wday !== wday1) day += (wday - wday1 + 7) % 7;
  }
  if (o.givenBound && tl[2] !== null) timeGiven = true;
  if (year < 100) year += 2000;
  let forcedYear = false;
  if (year < 1970) {
    year = 1970;
    forcedYear = true;
  }
  if (year > 2037) {
    year = 2037;
    forcedYear = true;
  }
  return { sec: second, min: minute, hour, day, month, year, futurep, forcedYear, timeGiven, endTimeGiven };
}

/**
 * `(org-read-date nil t TEXT)` and its companions' answer: the time typed over the default time. The Date is local; `timeGiven` is
 * `org-time-was-given` (a time of day was typed, or a +Nh shift) and `endTimeGiven` `org-end-time-was-given` (the end of a range, as
 * typed; set only with `endBound`, as when org-time-stamp calls it).
 * @param {string} text
 * @param {ReadDateOptions} [options]
 * @returns {ReadDateResult}
 */
export function readDate(text, options = {}) {
  const now = options.now ?? new Date();
  const extend = options.extendTodayUntil ?? 0;
  let def = options.defaultTime ?? now;
  let defFields = civilOf(def);
  if (defFields.hour < extend) {
    const back = new Date(def.getFullYear(), def.getMonth(), def.getDate(), -1, 59, def.getSeconds());
    def = back;
    defFields = civilOf(def);
  }
  const nowFields = civilOf(now);
  const a = analyze(text, defFields, nowFields, {
    preferFuture: options.preferFuture ?? false,
    endBound: options.endBound ?? false,
    givenBound: options.givenBound ?? true,
    timeGiven: options.timeGiven ?? false,
    currentYear: nowFields.year,
  });
  return { date: new Date(a.year, a.month - 1, a.day, a.hour, a.min, a.sec), timeGiven: a.timeGiven, endTimeGiven: a.endTimeGiven, futurep: a.futurep, forcedYear: a.forcedYear };
}

/** The Settings values: org-read-date-prefer-future (nil, t or time) and org-extend-today-until (hours). @param {Record<string, string> | undefined} vars @returns {{ preferFuture: boolean | 'time', extendTodayUntil: number }} */
export function readDateSettings(vars) {
  const v = vars || {};
  const prefer = String(v['org-read-date-prefer-future'] ?? 't').trim().replace(/^'/, '');
  const ext = Number(String(v['org-extend-today-until'] ?? '0').trim());
  return { preferFuture: prefer === 'nil' || prefer === '' ? false : prefer === 'time' ? 'time' : true, extendTodayUntil: Number.isFinite(ext) ? Math.trunc(ext) : 0 };
}
