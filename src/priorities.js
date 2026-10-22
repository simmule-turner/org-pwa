// @ts-check
// Priority cookies beyond A/B/C: org-priority-highest, org-priority-lowest and org-priority-default. Each is a character
// (`?A`, or just `A`) or a number below 65 (`1`): a numeric range gives digit cookies ([#1] to [#9]). Pure functions.

/** @typedef {{ highest: number, lowest: number, default: number }} PriorityRange  character codes, or numbers below 65 */

/** One variable's value as a number: `?A`, `A`, `"A"`, `65` or `3`.
 * @param {string | number | null | undefined} raw
 * @returns {number | null} */
function readValue(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim().replace(/^'/, '');
  if (/^\d+$/.test(text)) return Number(text);
  const char = /^\?(.)$/.exec(text) || /^"(.)"$/.exec(text) || /^([A-Za-z])$/.exec(text);
  return char ? char[1].toUpperCase().charCodeAt(0) : null;
}

/** The range from the three variables; anything unusable falls back to Emacs's A, C and B (a reversed range too).
 * @param {Record<string, string> | null | undefined} vars
 * @returns {PriorityRange} */
export function readPriorityRange(vars) {
  const v = vars || {};
  let highest = readValue(v['org-priority-highest']) ?? 65;
  let lowest = readValue(v['org-priority-lowest']) ?? 67;
  if (highest > lowest || highest < 0 || lowest > 90 || (highest < 65) !== (lowest < 65)) {
    highest = 65;
    lowest = 67;
  }
  let def = readValue(v['org-priority-default']);
  if (def === null || def < highest || def > lowest) def = Math.min(lowest, Math.max(highest, def === null ? 66 : def));
  return { highest, lowest, default: def };
}

/** The cookie text for a value: a character above 64, a number otherwise (Emacs's own rule).
 * @param {number} value */
export function cookieOf(value) {
  return value > 64 ? String.fromCharCode(value) : String(value);
}

/** org-priority-to-value: a cookie as a number.
 * @param {string} cookie */
export function valueOf(cookie) {
  return /^\d+$/.test(cookie) ? Number(cookie) : cookie.toUpperCase().charCodeAt(0);
}

/** Every cookie of the range, highest first.
 * @param {PriorityRange} range
 * @returns {string[]} */
export function priorityCookies(range) {
  const out = [];
  for (let v = range.highest; v <= range.lowest; v++) out.push(cookieOf(v));
  return out;
}

/** org-get-priority: larger is more urgent; a heading with no cookie counts as the default.
 * @param {string | null | undefined} cookie
 * @param {PriorityRange} range */
export function priorityRank(cookie, range) {
  return 1000 * (range.lowest - (cookie ? valueOf(cookie) : range.default));
}

/** org-priority-up and org-priority-down for a heading (Shift-Up and Shift-Down): one step higher or lower; past the end of the
 * range the cookie is removed (null). With none, org-priority-start-cycle-with-default (t unless set) starts at the default,
 * else one step from it in the direction asked.
 * @param {string | null | undefined} cookie
 * @param {PriorityRange} range
 * @param {'up' | 'down'} [direction]
 * @param {boolean} [startWithDefault]
 * @returns {string | null} */
export function nextPriority(cookie, range, direction = 'down', startWithDefault = true) {
  const step = direction === 'up' ? -1 : 1;
  const known = cookie && priorityInRange(cookie, range) ? valueOf(cookie) : null;
  const next = known === null ? range.default + (startWithDefault ? 0 : step) : known + step;
  return next < range.highest || next > range.lowest ? null : cookieOf(next);
}

/** org-priority-start-cycle-with-default: t unless the variable says nil.
 * @param {Record<string, string> | null | undefined} vars */
export function startCycleWithDefault(vars) {
  return String((vars || {})['org-priority-start-cycle-with-default'] ?? 't').trim().toLowerCase() !== 'nil';
}

/** A `#+PRIORITIES: highest lowest [default]` line of a file as the three variables; empty when there is none or it is unusable.
 * @param {string} text
 * @returns {Record<string, string>} */
export function prioritiesKeyword(text) {
  const m = /^[ \t]*#\+PRIORITIES:[ \t]*(\S+)[ \t]+(\S+)(?:[ \t]+(\S+))?[ \t]*$/im.exec(text || '');
  if (!m) return {};
  const [highest, lowest, def] = [m[1], m[2], m[3]];
  if (readValue(highest) === null || readValue(lowest) === null || (def !== undefined && readValue(def) === null)) return {};
  /** @type {Record<string, string>} */
  const out = { 'org-priority-highest': highest, 'org-priority-lowest': lowest };
  if (def !== undefined) out['org-priority-default'] = def;
  return out;
}

const FACE_COLORS = Object.freeze({ error: '#d32f2f', warning: '#ef6c00', success: '#2e7d32' });

/** org-priority-faces: the look of each cookie, from `((?A . error) (?B . "orange") (?C . (:foreground "green" :weight bold)))`.
 * A face is a color name, error / warning / success, or a list with :foreground, :weight bold and :inherit.
 * @param {string | null | undefined} raw
 * @returns {Map<string, { color?: string, bold?: boolean }>} */
export function readPriorityFaces(raw) {
  const out = new Map();
  const text = String(raw ?? '').trim().replace(/^'/, '');
  const entry = /\(\s*\?(.)\s*\.\s*("(?:[^"\\]|\\.)*"|\([^()]*\)|[^\s()]+)\s*\)/g;
  for (let m = entry.exec(text); m; m = entry.exec(text)) {
    const face = m[2];
    /** @type {{ color?: string, bold?: boolean }} */
    const look = {};
    const named = (/** @type {string} */ name) => /** @type {Record<string, string>} */ (FACE_COLORS)[name];
    if (face.startsWith('"')) look.color = face.slice(1, -1);
    else if (face.startsWith('(')) {
      const color = /:foreground\s+"([^"]*)"/.exec(face);
      const inherit = /:inherit\s+(\w+)/.exec(face);
      if (color) look.color = color[1];
      else if (inherit && named(inherit[1])) look.color = named(inherit[1]);
      if (/:weight\s+bold\b/.test(face)) look.bold = true;
    } else if (named(face)) look.color = named(face);
    out.set(m[1].toUpperCase(), look);
  }
  return out;
}

/** Whether a cookie may be stored for this range (Emacs refuses one outside it).
 * @param {string} cookie
 * @param {PriorityRange} range */
export function priorityInRange(cookie, range) {
  if (!/^([A-Za-z]|\d{1,2})$/.test(cookie)) return false;
  const v = valueOf(cookie);
  return v >= range.highest && v <= range.lowest;
}
