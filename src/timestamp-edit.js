// @ts-check
/**
 * Changing and inserting time stamps in text as Emacs 29.3 / Org 9.6 does: `org-timestamp-change` (S-up and S-down on a year, month, day,
 * hour, minute, the repeater or the warning), `org-clock-timestamps-change` and `org-clock-update-time-maybe` for CLOCK lines,
 * `org-time-stamp` and `org-time-stamp-inactive` (C-c . and C-c !, through the date prompt of read-date.js), and
 * `org-clone-subtree-with-time-shift`. Every function takes text and a position (an index; "point") and returns the new text and position.
 * org-time-stamp-rounding-minutes is Emacs's default, (0 5).
 */
import { readDate, readDateSettings } from './read-date.js';

/** @typedef {{ text: string, pos: number, message?: string }} Edit */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ROUNDING = [0, 5];

// org-ts-regexp3 and friends: the groups are 1 (the inside), 2 year, 3 month, 4 day, 5 day name, 6 time, 7 hour, 8 minute
const TS_INNER = '(([0-9]{4})-([0-9]{2})-([0-9]{2})(?: *([^\\]+0-9>\\r\\n -]+))?( ([0-9]{1,2}):([0-9]{2}))?)';
const TS3 = `[[<]${TS_INNER}[^\\]>\\n]{0,16}[\\]>]`;
const TS0 = /(([0-9]{4})-([0-9]{2})-([0-9]{2})( +[^\]+0-9>\r\n -]+)?( +([0-9]{1,2}):([0-9]{2}))?)/;
const TS_BOTH = '[[<]([0-9]{4}-[0-9]{2}-[0-9]{2}(?: .*?)?)[\\]>]';
const TR_BOTH = new RegExp(`${TS_BOTH}--?-?[[<]([0-9]{4}-[0-9]{2}-[0-9]{2}(?: .*?)?)[\\]>]`, 'y');
const EXTRA_RE = /(?:(-[012][0-9]:[0-5][0-9])?((?: +[.+]?-?[-+][0-9]+[hdwmy](?:\/[0-9]+[hdwmy])?)*))[\]>]/;

/** The local Date of civil fields; fields out of range roll over, as encode-time's do. @param {number} y @param {number} mo @param {number} d @param {number} h @param {number} mi @param {number} s */
function encode(y, mo, d, h, mi, s) {
  const t = new Date(2000, 0, 1, 0, 0, 0, 0);
  t.setFullYear(y, mo - 1, d);
  t.setHours(h, mi, s, 0);
  return t;
}

const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');

/**
 * org-time-stamp-format applied to `time`: "<2026-11-14 Sat>" or "<2026-11-14 Sat 10:00>", with `extra` before the closing bracket.
 * @param {Date} time @param {boolean} withTime @param {boolean} inactive @param {string | null} [extra]
 */
export function formatStamp(time, withTime, inactive, extra = null) {
  const body = `${String(time.getFullYear()).padStart(4, '0')}-${pad2(time.getMonth() + 1)}-${pad2(time.getDate())} ${DAYS[time.getDay()]}${withTime ? ` ${pad2(time.getHours())}:${pad2(time.getMinutes())}` : ''}${extra ?? ''}`;
  return inactive ? `[${body}]` : `<${body}>`;
}

/** org-parse-time-string: [sec, min, hour, day, month, year] of a time string, 0 for a missing time. @param {string} s */
export function parseTimeStringOrg(s) {
  const m = TS0.exec(s);
  if (!m) throw new Error(`Not an Org time string: ${s}`);
  return { sec: 0, min: m[8] !== undefined ? Number(m[8]) : 0, hour: m[7] !== undefined ? Number(m[7]) : 0, day: Number(m[4]), month: Number(m[3]), year: Number(m[2]) };
}

/** org-time-string-to-time. @param {string} s */
export function timeStringToTime(s) {
  const t = parseTimeStringOrg(s);
  return encode(t.year, t.month, t.day, t.hour, t.min, t.sec);
}

/** @param {string} text @param {number} pos @returns {[number, number]} the start and the end of the line */
function lineAt(text, pos) {
  const start = text.lastIndexOf('\n', pos - 1) + 1;
  const nl = text.indexOf('\n', pos);
  return [start, nl === -1 ? text.length : nl];
}

/** @typedef {{ start: number, end: number, m: RegExpExecArray & { indices: number[][] } }} TsMatch */

/** org-in-regexp for org-ts-regexp3 on the line of `pos`: the match that holds `pos`. @param {string} text @param {number} pos @returns {TsMatch | null} */
function tsMatchAt(text, pos) {
  const [bol, eol] = lineAt(text, pos);
  const re = new RegExp(TS3, 'dg');
  const line = text.slice(bol, eol);
  for (let m = re.exec(line); m && bol + m.index <= pos; m = re.exec(line)) {
    const end = bol + m.index + m[0].length;
    if (end >= pos) {
      const indices = /** @type {RegExpExecArray & { indices: number[][] }} */ (m).indices.map((r) => (r ? [r[0] + bol, r[1] + bol] : /** @type {number[]} */ (/** @type {unknown} */ (r))));
      return { start: bol + m.index, end, m: Object.assign(m, { indices }) };
    }
  }
  return null;
}

/** org-pos-in-match-range. @param {TsMatch} t @param {number} pos @param {number} n */
const inRange = (t, pos, n) => !!t.m.indices[n] && t.m.indices[n][0] <= pos && t.m.indices[n][1] >= pos;

/**
 * org-at-timestamp-p with `lax`: where `pos` is in the time stamp around it, as 'bracket, 'after, 'year, 'month, 'hour, 'minute, 'day or a
 * number of characters past the last known part; null when it is in none.
 * @param {string} text @param {number} pos
 * @returns {{ ts: TsMatch, category: string | number } | null}
 */
export function timestampAt(text, pos) {
  const ts = tsMatchAt(text, pos);
  if (!ts) return null;
  /** @type {string | number} */ let category;
  const ind = ts.m.indices;
  if (pos === ts.start) category = 'bracket';
  else if (pos === ts.end - 1) category = 'bracket';
  else if (pos === ts.end) category = 'after';
  else if (inRange(ts, pos, 2)) category = 'year';
  else if (inRange(ts, pos, 3)) category = 'month';
  else if (inRange(ts, pos, 7)) category = 'hour';
  else if (inRange(ts, pos, 8)) category = 'minute';
  else if (inRange(ts, pos, 4) || inRange(ts, pos, 5)) category = 'day';
  else if ((ind[8] || ind[5]) && pos > (ind[8] ? ind[8][1] : ind[5][1]) && pos < ts.end) category = pos - (ind[8] ? ind[8][1] : ind[5][1]);
  else category = 'day';
  return { ts, category };
}

const UNIT_IDX = /** @type {[string, number][]} */ ([['d', 0], ['w', 1], ['m', 2], ['y', 3], ['d', -1], ['y', 4]]);

/** org-modify-ts-extra: the lead-time and repeat fields of `s` changed by `n` where `pos` is. @param {string} s @param {number} pos @param {number} n @param {number} dm */
function modifyTsExtra(s, pos, n, dm) {
  const m = /(-([012][0-9]):([0-5][0-9]))?( +\+([0-9]+)([dmwy]))?( +-([0-9]+)([dmwy]))?/d.exec(s);
  if (!m) return s;
  const ind = /** @type {RegExpExecArray & { indices: number[][] }} */ (m).indices;
  const inM = (/** @type {number} */ g) => !!ind[g] && ind[g][0] <= pos && ind[g][1] >= pos;
  /** @type {number | null} */ let ng = null;
  let replacement = '';
  const unitShift = (/** @type {string} */ unit) => {
    const value = n + /** @type {number} */ (UNIT_IDX.find(([u]) => u === unit)?.[1]);
    return UNIT_IDX.find(([, v]) => v === value)?.[0] ?? '';
  };
  if (inM(2) || inM(3)) {
    let minute = Number(m[3]);
    let hour = Number(m[2]);
    let step = n;
    if (inM(2)) hour += step;
    else {
      step = dm * Math.sign(step);
      const rem = minute % dm;
      if (rem !== 0) minute += step > 0 ? -rem : dm - rem;
      minute += step;
    }
    if (minute < 0) {
      minute += 60;
      hour -= 1;
    }
    if (minute > 59) {
      minute -= 60;
      hour += 1;
    }
    hour = ((hour % 24) + 24) % 24;
    ng = 1;
    replacement = `-${pad2(hour)}:${pad2(minute)}`;
  } else if (inM(6)) {
    ng = 6;
    replacement = unitShift(m[6]);
  } else if (inM(5)) {
    ng = 5;
    replacement = String(Math.max(1, n + Number(m[5])));
  } else if (inM(9)) {
    ng = 9;
    replacement = unitShift(m[9]);
  } else if (inM(8)) {
    ng = 8;
    replacement = String(Math.max(0, n + Number(m[8])));
  }
  return ng === null ? s : s.slice(0, ind[ng][0]) + replacement + s.slice(ind[ng][1]);
}

/**
 * org-timestamp-change: the time stamp at `pos` changed by `n` times `what` (year, month, day, hour or minute; by where `pos` is when
 * not given). `updown` (S-up, S-down) rounds minutes by org-time-stamp-rounding-minutes unless `prefix` (a numeric prefix argument was
 * given). On a bracket without `what` the type toggles between active and inactive.
 * @param {string} text @param {number} pos @param {number} n
 * @param {{ what?: string | null, updown?: boolean, suppressTmpDelay?: boolean, prefix?: boolean }} [options]
 * @returns {Edit}
 */
export function timestampChange(text, pos, n, options = {}) {
  const { what = null, updown = false, suppressTmpDelay = false, prefix = false } = options;
  const at = timestampAt(text, pos);
  if (!at) throw new Error('Not at a timestamp');
  const { ts: found } = at;
  let category = at.category;
  if (!what && category === 'bracket') {
    const flipped = found.m[0].replace(/[[\]<>]/g, (c) => ({ '[': '<', ']': '>', '<': '[', '>': ']' })[/** @type {'['} */ (c)]);
    return { text: text.slice(0, found.start) + flipped + text.slice(found.end), pos, message: `Timestamp is now ${found.m[0][0] === '[' ? '' : 'in'}active` };
  }
  const originCat = category;
  category = what || category;
  const dm = Math.max(ROUNDING[1], 1);
  const inactive = text[found.start] === '[';
  const ts = found.m[0];
  let extra = null;
  const ex = EXTRA_RE.exec(ts);
  if (ex) {
    extra = ex[1] === undefined && ex[2] === undefined ? '' : (ex[1] ?? '') + (ex[2] ?? '');
    if (suppressTmpDelay) extra = extra.replace(/ --[0-9]+[hdwmy]/g, '');
  }
  const withHm = /^.{10}.*?[0-9]+:[0-9][0-9]/.test(ts);
  const time0 = parseTimeStringOrg(ts);
  let step = n;
  if (updown && category === 'minute' && !prefix) {
    step = dm * Math.sign(step);
    const rem = time0.min % dm;
    if (rem !== 0) time0.min += step > 0 ? -rem : dm - rem;
  }
  const time = encode(
    time0.year + (category === 'year' ? step : 0),
    time0.month + (category === 'month' ? step : 0),
    time0.day + (category === 'day' ? step : 0),
    time0.hour + (category === 'hour' ? step : 0),
    time0.min + (category === 'minute' ? step : 0),
    time0.sec,
  );
  if ((category === 'hour' || category === 'minute') && extra && /-([012][0-9]):([0-5][0-9])/.test(extra)) extra = modifyTsExtra(extra, category === 'hour' ? 2 : 5, step, dm);
  if (typeof category === 'number') extra = modifyTsExtra(/** @type {string} */ (extra), category, step, dm);
  const stamp = formatStamp(time, withHm, inactive, extra || null);
  let next = text.slice(0, found.start) + stamp + text.slice(found.end);
  const m = new RegExp(TS3, 'd').exec(stamp);
  const ind = /** @type {RegExpExecArray & { indices: number[][] }} */ (m).indices.map((r) => (r ? [r[0] + found.start, r[1] + found.start] : /** @type {number[]} */ (/** @type {unknown} */ (r))));
  const end0 = found.start + stamp.length;
  let newPos = pos;
  if (originCat === 'day') newPos = Math.min(ind[7] ? ind[7][0] : ind[5][1] - 1, pos);
  else if (originCat === 'hour') newPos = Math.min(ind[7][1], pos);
  else if (originCat === 'minute') newPos = Math.min(ind[8][1] - 1, pos);
  else if (typeof originCat === 'number') newPos = Math.min(end0 - 1, pos);
  else if (originCat === 'after') newPos = end0;
  const cleared = clockUpdateTimeMaybe(next, newPos);
  if (cleared) next = cleared.text;
  return { text: next, pos: cleared ? cleared.pos : newPos };
}

const CLOCK_LINE_RE = /^([ \t]*)CLOCK: *[[<]([^\]>]+)[\]>](-+[[<]([^\]>]+)[\]>]([ \t]*=>.*)?)?/d;

/**
 * org-clock-update-time-maybe: on a CLOCK line with both time stamps, the stamps are rewritten and the " => H:MM" duration brought up to date.
 * Null when `pos` is not on such a line.
 * @param {string} text @param {number} pos @returns {Edit | null}
 */
export function clockUpdateTimeMaybe(text, pos) {
  const [bol, eol] = lineAt(text, pos);
  const m = CLOCK_LINE_RE.exec(text.slice(bol, eol));
  if (!m || m[3] === undefined) return null;
  const ind = /** @type {RegExpExecArray & { indices: number[][] }} */ (m).indices;
  let t = text;
  const first = bol + ind[2][0] - 1; // the opening bracket of the first stamp
  t = timestampChangeNoClock(t, first);
  const [bol2, eol2] = lineAt(t, pos);
  const again = CLOCK_LINE_RE.exec(t.slice(bol2, eol2));
  if (!again) return null;
  const ind2 = /** @type {RegExpExecArray & { indices: number[][] }} */ (again).indices;
  t = timestampChangeNoClock(t, bol2 + ind2[4][0] - 1);
  const [bol3, eol3] = lineAt(t, pos);
  const last = /** @type {RegExpExecArray & { indices: number[][] }} */ (CLOCK_LINE_RE.exec(t.slice(bol3, eol3)));
  const line = t.slice(bol3, eol3);
  const ts = last[2];
  const te = last[4];
  let s = (timeStringToTime(te).getTime() - timeStringToTime(ts).getTime()) / 1000;
  const neg = s < 0;
  s = Math.abs(s);
  const h = Math.floor(s / 3600);
  const mins = Math.floor((s - 3600 * h) / 60);
  const cut = last[5] !== undefined ? line.slice(0, last.indices[5][0]) + line.slice(last.indices[5][1]) : line;
  const durationText = neg ? `-${h}:${pad2(mins)}` : `${String(h).padStart(2, ' ')}:${pad2(mins)}`;
  return { text: t.slice(0, bol3) + cut + ' => ' + durationText + t.slice(eol3), pos };
}

/** The time stamp starting at `start` rewritten with a zero change of its day (org-timestamp-change 0 'day), without the clock update. @param {string} text @param {number} start */
function timestampChangeNoClock(text, start) {
  const found = tsMatchAt(text, start);
  if (!found) return text;
  const ts = found.m[0];
  const ex = EXTRA_RE.exec(ts);
  const extra = ex ? (ex[1] ?? '') + (ex[2] ?? '') : null;
  const time0 = parseTimeStringOrg(ts);
  const time = encode(time0.year, time0.month, time0.day, time0.hour, time0.min, time0.sec);
  const stamp = formatStamp(time, /^.{10}.*?[0-9]+:[0-9][0-9]/.test(ts), text[found.start] === '[', extra || null);
  return text.slice(0, found.start) + stamp + text.slice(found.end);
}

/**
 * org-clock-timestamps-change: the time stamp at `pos` of a CLOCK line changed by `n` (1 when not given), and the other one by as much, so
 * that the duration stays.
 * @param {string} text @param {number} pos @param {'up' | 'down'} updown @param {number | null} [n] @param {boolean} [prefix]
 * @returns {Edit}
 */
export function clockTimestampsChange(text, pos, updown, n = null, prefix = false) {
  const at = timestampAt(text, pos);
  if (!at) return { text, pos };
  const category = at.category;
  const [bol, eol] = lineAt(text, pos);
  const line = text.slice(bol, eol);
  const re = new RegExp(TS3, 'g');
  const one = re.exec(line);
  const two = one ? re.exec(line) : null;
  const ts1 = one ? one[0] : null;
  const begts1 = one ? bol + one.index : 0;
  const ts2 = two ? two[0] : null;
  const begts2 = two ? bol + two.index : null;
  if (begts2 === null) throw new Error('Wrong type argument: number-or-marker-p, nil');
  const updatets1 = begts2 <= pos;
  const amount = (n ?? 1) * (updown === 'up' ? 1 : -1);
  const changed = timestampChange(text, pos, amount, { updown: true, prefix });
  let t = changed.text;
  const old = updatets1 ? ts2 : ts1;
  const begts = updatets1 ? begts1 : begts2;
  const probe = new RegExp(TS3, 'y');
  probe.lastIndex = updatets1 ? begts2 : begts1;
  const other = probe.exec(t);
  if (!other || old === null) return changed;
  const tdiff = (timeStringToTime(other[0]).getTime() - timeStringToTime(old).getTime()) / 1000;
  const unit = /** @type {Record<string, number>} */ ({ minute: 60, hour: 3600, day: 86400, month: 86400 * 31, year: 86400 * 365.2 })[/** @type {string} */ (category)];
  if (unit === undefined) throw new Error('Wrong type argument: numberp, nil');
  const second = timestampChange(t, begts, Math.round(tdiff / unit), { what: /** @type {string} */ (category), updown: true, prefix });
  t = second.text;
  return { text: t, pos: Math.max(changed.pos, pos) };
}

/** org-get-compact-tod: "10:00" or "10:00+1:30" for a time or a time range in a time stamp. @param {string} s @returns {string | null} */
export function compactTimeOfDay(s) {
  const m = /(([012]?[0-9]):([0-5][0-9]))(-(([012]?[0-9]):([0-5][0-9])))?/.exec(s);
  if (!m) return null;
  if (m[5] === undefined) return m[1];
  let dh = Number(m[6]) - Number(m[2]);
  let dm = Number(m[7]) - Number(m[3]);
  if (dm < 0) {
    dm += 60;
    dh -= 1;
  }
  return `${m[1]}+${dh}${dm !== 0 ? `:${pad2(dm)}` : ''}`;
}

/** org-at-date-range-p with inactive stamps accepted: the range around `pos` as the two inner texts and where the second starts, or null. @param {string} text @param {number} pos */
function dateRangeAt(text, pos) {
  const back = (/** @type {number} */ from, /** @type {string} */ stop) => {
    let i = from;
    while (i > 0 && !stop.includes(text[i - 1])) i--;
    return i;
  };
  const skipOpeners = (/** @type {number} */ from) => {
    let i = from;
    while (i > 0 && (text[i - 1] === '<' || text[i - 1] === '[')) i--;
    return i;
  };
  let p = skipOpeners(back(pos, '[<\r\n'));
  for (let round = 0; round < 2; round++) {
    TR_BOTH.lastIndex = p;
    const m = TR_BOTH.exec(text);
    if (m && p + m[0].length >= pos) {
      const second = p + m[0].lastIndexOf(m[2]);
      return { first: m[1], second: m[2], secondStart: second, start: p, end: p + m[0].length };
    }
    p = skipOpeners(back(p, '<[\r\n'));
  }
  return null;
}

/**
 * org-time-stamp and org-time-stamp-inactive: the stamp for the date `typed` at the prompt, inserted at `pos`, or put in place of the
 * time stamp there (its repeater kept); after a time stamp inserted by this command, the second of a range. `arg` is the prefix:
 * 'single' (C-u: the stamp has the time), 'double' (C-u C-u: now, with the time, without asking) or a number or null.
 * `typed` is what was answered at the prompt (null for the double prefix); `defaultInput` of the prompt is compactTimeOfDay of the stamp there.
 * @param {string} text @param {number} pos
 * @param {{ typed: string | null, arg?: 'single' | 'double' | 'number' | null, inactive?: boolean, afterTimeStamp?: boolean, now?: Date, vars?: Record<string, string> }} options
 * @returns {Edit}
 */
export function insertTimeStampCommand(text, pos, options) {
  const { typed, arg = null, inactive = false, afterTimeStamp = false, now = new Date(), vars } = options;
  const range = dateRangeAt(text, pos);
  /** @type {string | null} */ let ts = null;
  if (range) ts = pos < range.secondStart - 2 ? range.first : range.second;
  else {
    const lax = timestampAt(text, pos);
    if (lax) ts = lax.ts.m[0];
  }
  const defaultTime = ts ? timeStringToTime(ts) : null;
  const rep = ts ? /([.+-]+[0-9]+[hdwmy] ?)+/.exec(ts) : null;
  const repeater = rep ? rep[0] : null;
  let timeDate;
  let timeGiven = false;
  /** @type {string | null} */ let endGiven = null;
  if (arg === 'double') timeDate = now;
  else {
    const r = readDate(typed ?? '', { now, defaultTime, ...readDateSettings(vars), endBound: true });
    [timeDate, timeGiven, endGiven] = [r.date, r.timeGiven, r.endTimeGiven];
  }
  const withHm = timeGiven || arg !== null;
  const endExtra = (/** @type {string | null} */ e) => {
    const m = e ? /([0-9]+):([0-9]+)/.exec(e) : null;
    return m ? `-${pad2(Number(m[1]))}:${pad2(Number(m[2]))}` : null;
  };
  if (ts && afterTimeStamp) {
    const stamp = formatStamp(timeDate, withHm, inactive);
    return { text: text.slice(0, pos) + '--' + stamp + text.slice(pos), pos: pos + 2 + stamp.length };
  }
  if (ts) {
    let at = timestampAt(text, pos);
    let p = pos;
    if (!at) {
      while (text[p] === '-') p++;
      at = timestampAt(text, p);
    }
    if (!at) return { text, pos };
    const found = at.ts;
    const stamp = formatStamp(timeDate, withHm, inactive, endExtra(endGiven));
    let out = text.slice(0, found.start) + stamp + text.slice(found.end);
    let newPos = found.start + stamp.length;
    if (repeater) {
      out = out.slice(0, newPos - 1) + ' ' + repeater + out.slice(newPos - 1);
      newPos += 1 + repeater.length - 1;
    }
    return { text: out, pos: newPos, message: 'Timestamp updated' };
  }
  if (arg === 'double') {
    const stamp = formatStamp(timeDate, true, inactive);
    return { text: text.slice(0, pos) + stamp + text.slice(pos), pos: pos + stamp.length };
  }
  const stamp = formatStamp(timeDate, withHm, inactive, endExtra(endGiven));
  return { text: text.slice(0, pos) + stamp + text.slice(pos), pos: pos + stamp.length };
}

const CLOCK_ONLY_RE = /^[ \t]*CLOCK:/;
const STAMP_BOTH_RE = /[[<]([0-9]{4}-[0-9]{2}-[0-9]{2}(?: .*?)?)[\]>]/g;
const ACTIVE_STAMP_RE = /<([0-9]{4}-[0-9]{2}-[0-9]{2}(?: .*?)?)>/g;

/** The lines of the property drawer of the heading that starts `lines`: [first, last] of its :ID: line, or null. @param {string[]} lines @returns {number | null} */
function ownIdLine(lines) {
  let i = 1;
  if (/^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/.test(lines[i] ?? '')) i++;
  if (!/^[ \t]*:PROPERTIES:[ \t]*$/i.test(lines[i] ?? '')) return null;
  for (i++; i < lines.length && !/^[ \t]*:END:[ \t]*$/i.test(lines[i]); i++) if (/^[ \t]*:ID:/i.test(lines[i])) return i;
  return null;
}

/**
 * org-clone-subtree-with-time-shift on the text of a subtree (its heading and everything below it, no final newline): the text of the
 * subtree after the command, every line ended with a newline: the original and its `n` clones; with a repeater and a shift, the clones and the original placed after them.
 * `shift` is "+3d", "-2h", "+1w" and so on, or empty for none. A clone has its CLOCK lines and empty drawers removed and, if the
 * heading has an ID, a new one (`newId`) or, with `deleteId` (org-clone-delete-id), none.
 * @param {string} subtree @param {number} n @param {string} shift
 * @param {{ deleteId?: boolean, newId?: () => string }} [options]
 * @returns {string}
 */
export function cloneSubtreeWithTimeShift(subtree, n, shift, options = {}) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid number of replications ${n}`);
  const { deleteId = false, newId = () => '' } = options;
  const sh = shift.trim() === '' ? null : /^[ \t]*([+-]?[0-9]+)([hdwmy])[ \t]*$/.exec(shift);
  if (shift.trim() !== '' && !sh) throw new Error(`Invalid shift specification ${shift}`);
  const template = subtree + '\n';
  let shiftN = sh ? Number(sh[1]) : 0;
  const shiftWhat = sh ? ({ h: 'hour', d: 'day', w: 'day', m: 'month', y: 'year' })[/** @type {'h'} */ (sh[2])] : null;
  if (sh && sh[2] === 'w') shiftN *= 7;
  let nmin = 1;
  let nmax = n;
  let noRemove = -1;
  let out = template;
  if (sh && /<[^<>\n]+ [.+]?\+[0-9]+[hdwmy][^<>\n]*>/.test(template)) {
    out = '';
    nmin = 0;
    nmax = n + 1;
    noRemove = nmax;
  }
  const hasId = ownIdLine(template.split('\n')) !== null;
  for (let k = nmin; k <= nmax; k++) {
    let clone = template;
    if (hasId) {
      const lines = clone.split('\n');
      const at = /** @type {number} */ (ownIdLine(lines));
      if (deleteId) {
        lines.splice(at, 1);
        clone = removeEmptyDrawers(lines.join('\n'));
      } else {
        lines[at] = lines[at].replace(/^([ \t]*)(:ID:)[ \t]*.*$/i, (_all, indent, key) => `${indent}${key.padEnd(10)} ${newId()}`); // as org-entry-put writes it, the key padded to ten columns
        clone = lines.join('\n');
      }
    }
    if (k !== 0) {
      clone = clone.split('\n').filter((l) => !CLOCK_ONLY_RE.test(l)).join('\n');
      clone = removeEmptyDrawers(clone);
    }
    if (sh) {
      let pos = 0;
      for (;;) {
        STAMP_BOTH_RE.lastIndex = pos;
        const m = STAMP_BOTH_RE.exec(clone);
        if (!m) break;
        const edit = timestampChange(clone, m.index + m[0].length, k * shiftN, { what: /** @type {string} */ (shiftWhat) });
        clone = edit.text;
        pos = edit.pos;
      }
      if (k !== noRemove) {
        pos = 0;
        for (;;) {
          ACTIVE_STAMP_RE.lastIndex = pos;
          const m = ACTIVE_STAMP_RE.exec(clone);
          if (!m) break;
          const rest = /^<[^<>\n]+( +[.+]?\+[0-9]+[hdwmy])/.exec(clone.slice(m.index));
          pos = m.index + m[0].length;
          if (rest) {
            const from = m.index + rest[0].length - rest[1].length;
            clone = clone.slice(0, from) + clone.slice(from + rest[1].length);
            pos -= rest[1].length;
          }
        }
      }
    }
    out += clone;
  }
  return out;
}

/** org-remove-empty-drawer-at for every drawer: a drawer with nothing in it goes. @param {string} text */
function removeEmptyDrawers(text) {
  return text.replace(/^[ \t]*:(?:\w|[-_])+:[ \t]*\n[ \t]*:END:[ \t]*\n/gm, '');
}

/**
 * org-clone-subtree-with-time-shift at `pos` of a whole text: the subtree of the heading the point is in, cloned `n` times after it.
 * `shift` is asked for (as Emacs does when it is undefined) by the caller, which knows whether a time stamp is in the subtree: see
 * `subtreeHasTimestamp`. Returns the new text and the start of the first heading of the result (where the point goes).
 * @param {string} text @param {number} pos @param {number} n @param {string} shift
 * @param {{ deleteId?: boolean, newId?: () => string }} [options]
 * @returns {Edit}
 */
export function cloneSubtreeAt(text, pos, n, shift, options = {}) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid number of replications ${n}`);
  const lines = text.split('\n');
  let offset = 0;
  /** @type {{ line: number, start: number, level: number } | null} */ let heading = null;
  const starts = lines.map((l) => {
    const s = offset;
    offset += l.length + 1;
    return s;
  });
  for (let i = 0; i < lines.length && starts[i] <= pos; i++) {
    const m = /^(\*+) /.exec(lines[i]);
    if (m) heading = { line: i, start: starts[i], level: m[1].length };
  }
  if (!heading) throw new Error('No subtree to clone');
  let endLine = heading.line + 1;
  while (endLine < lines.length && !(/^(\*+) /.test(lines[endLine]) && /** @type {RegExpExecArray} */ (/^(\*+) /.exec(lines[endLine]))[1].length <= heading.level)) endLine++;
  const end = endLine >= lines.length ? text.length : starts[endLine];
  const body = text.slice(heading.start, end);
  const subtree = body.endsWith('\n') ? body.slice(0, -1) : body;
  return { text: text.slice(0, heading.start) + cloneSubtreeWithTimeShift(subtree, n, shift, options) + text.slice(end), pos: heading.start };
}

/** Whether the subtree at `pos` holds a time stamp (the clone command asks for a time shift when it does). @param {string} text @param {number} pos */
export function subtreeHasTimestamp(text, pos) {
  const lines = text.split('\n');
  let offset = 0;
  let from = -1;
  let level = 0;
  const starts = lines.map((l) => {
    const s = offset;
    offset += l.length + 1;
    return s;
  });
  for (let i = 0; i < lines.length && starts[i] <= pos; i++) {
    const m = /^(\*+) /.exec(lines[i]);
    if (m) [from, level] = [i, m[1].length];
  }
  if (from === -1) return false;
  let to = from + 1;
  while (to < lines.length && !(/^(\*+) /.test(lines[to]) && /** @type {RegExpExecArray} */ (/^(\*+) /.exec(lines[to]))[1].length <= level)) to++;
  return /[[<][0-9]{4}-[0-9]{2}-[0-9]{2}(?: .*?)?[\]>]/.test(lines.slice(from, to).join('\n'));
}
