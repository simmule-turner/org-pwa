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

/** The next cookie when cycling: none, highest, ... lowest, none.
 * @param {string | null | undefined} cookie
 * @param {PriorityRange} range
 * @returns {string | null} */
export function nextPriority(cookie, range) {
  const all = priorityCookies(range);
  if (!cookie) return all[0];
  const at = all.indexOf(cookie.toUpperCase());
  if (at < 0) return all[0];
  return at + 1 < all.length ? all[at + 1] : null;
}

/** Whether a cookie may be stored for this range (Emacs refuses one outside it).
 * @param {string} cookie
 * @param {PriorityRange} range */
export function priorityInRange(cookie, range) {
  if (!/^([A-Za-z]|\d{1,2})$/.test(cookie)) return false;
  const v = valueOf(cookie);
  return v >= range.highest && v <= range.lowest;
}
