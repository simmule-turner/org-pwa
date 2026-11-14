// @ts-check
/**
 * Org Timer (Emacs's org-timer.el): the relative timer (counts up from a start time), the countdown timer, the H:MM:SS strings
 * they put into a file, and the shifting of such strings. Compared with Emacs 29.3 in test/timer-oracle.test.js.
 */

/** Matches a timer stamp, as `org-timer-re` does (with the groups hour, minutes and seconds). */
export const TIMER_RE = /([-+]?[0-9]+):([0-9]{2}):([0-9]{2})/;

/** `org-timer-fix-incomplete`: "5" is 0:00:05, "1:05" is 0:01:05. Throws when there are no digits. @param {string} hms */
export function fixIncomplete(hms) {
  const m = /(?:([0-9]+:)?([0-9]+:))?([0-9]+)/.exec(hms);
  if (!m) throw new Error(`Cannot parse HMS string "${hms}"`);
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const text = `${m[1] ? parseInt(m[1], 10) : 0}:${pad(m[2] ? parseInt(m[2], 10) : 0)}:${pad(parseInt(m[3], 10))}`;
  return hms.slice(0, m.index) + text + hms.slice(m.index + m[0].length);
}

/** `org-timer-hms-to-secs`: "1:02:05" is 3725; a leading minus makes it negative; no stamp in the text is 0. @param {string} hms */
export function hmsToSecs(hms) {
  const m = TIMER_RE.exec(hms);
  if (!m) return 0;
  const negative = m[1].startsWith('-');
  const seconds = parseInt(m[3], 10) + 60 * (parseInt(m[2], 10) + 60 * Math.abs(parseInt(m[1], 10)));
  return negative ? -seconds : seconds;
}

/** `org-timer-secs-to-hms`: 3725 is "1:02:05", a negative number starts with "-". @param {number} s */
export function secsToHms(s) {
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/**
 * The state of the timer. `start` is t=0 of a relative timer, or the moment a countdown ends (milliseconds); `pause` is when it was
 * paused; `countdown` is null, 'running' or 'paused'.
 * @typedef {{ start: number, pause: number | null, countdown: 'running' | 'paused' | null, title?: string }} TimerState
 */

/** `org-timer-value-string`. @param {TimerState} timer @param {number} now milliseconds @param {string} [format] `org-timer-format` */
export function timerValueString(timer, now, format = '%s ') {
  const time = ((timer.pause ?? now) - timer.start) / 1000;
  return format.replace('%s', secsToHms(Math.abs(Math.floor(timer.countdown ? -time : time))));
}

/** The seconds left on a countdown, or null when no countdown is set. @param {TimerState | null} timer @param {number} now */
export function secondsLeft(timer, now) {
  if (!timer || !timer.countdown) return null;
  return Math.max(0, Math.ceil(((timer.pause ?? now) - timer.start) / -1000));
}

/**
 * `org-timer-change-times-in-region`: every H:MM:SS in `text` moves by `delta` ("-1:08:26"; empty: makes the first stamp zero).
 * Throws "No change" when the shift is zero. @param {string} text @param {string} delta
 */
export function changeTimes(text, delta) {
  let d = delta;
  if (!/\S/.test(d)) {
    const first = /[-+]?[0-9]+:[0-9]{2}:[0-9]{2}/.exec(text);
    if (first) d = first[0].startsWith('-') ? first[0].slice(1) : '-' + first[0];
  }
  const secs = hmsToSecs(fixIncomplete(d));
  if (secs === 0) throw new Error('No change');
  // Emacs searches backward, and takes the match that starts last: "-0:00:05" is found as "0:00:05" (its minus stays), "10:00:00" as "0:00:00"
  const re = /[-+]?[0-9]+:[0-9]{2}:[0-9]{2}/y;
  let out = text;
  let limit = out.length;
  for (;;) {
    let found = null;
    for (let pos = limit - 1; pos >= 0; pos--) {
      re.lastIndex = pos;
      const m = re.exec(out.slice(0, limit));
      if (m) { found = { pos, text: m[0] }; break; }
    }
    if (!found) return out;
    out = out.slice(0, found.pos) + secsToHms(hmsToSecs(found.text) + secs) + out.slice(found.pos + found.text.length);
    limit = found.pos;
  }
}

/** Is this line an item of a timer list (a description list whose terms are timer stamps)? `org-at-item-timer-p`. @param {string} line */
export function isTimerItem(line) {
  return /^[ \t]*(?:[-+*]|[0-9]+[.)])[ \t]+[0-9]+:[0-9]{2}:[0-9]{2}[ \t]+::[ \t]+\S/.test(line);
}

/**
 * `org-timer-item` at the end of a body: a new item "- H:MM:SS :: " after the timer list that ends it, or a new list when the body does
 * not end with one. Throws "This is not a timer list" when the last line is an item of another kind of list.
 * @param {string} body @param {string} stamp the value of `org-timer`, with the `org-timer-format` around it @returns {string} the new body
 */
export function appendTimerItem(body, stamp) {
  const lines = body === '' ? [] : body.split('\n');
  while (lines.length && /^[ \t]*$/.test(lines[lines.length - 1])) lines.pop();
  const last = lines[lines.length - 1];
  if (last !== undefined && /^[ \t]*(?:[-+*]|[0-9]+[.)])[ \t]/.test(last)) {
    if (!isTimerItem(last)) throw new Error('This is not a timer list');
    const indent = /^[ \t]*/.exec(last)?.[0] ?? '';
    const bullet = /^[ \t]*([-+*]|[0-9]+[.)])/.exec(last)?.[1] ?? '-';
    const next = /^[0-9]+/.test(bullet) ? `${parseInt(bullet, 10) + 1}${bullet.slice(-1)}` : bullet;
    return [...lines, `${indent}${next} ${stamp}:: `].join('\n');
  }
  return [...lines, `- ${stamp}:: `].join('\n');
}

/** What `org-timer-show-remaining-time` says. @param {number} secs */
export function remainingMessage(secs) {
  return `${Math.floor(secs / 60)} minute(s) ${secs % 60} seconds left before next time out`;
}
