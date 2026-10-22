/** `#+LINK:` link abbreviations, as `org-link-expand-abbrev` expands them. */

/** @typedef {import('./types.js').Doc} Doc */

/** The abbreviations a file defines: `#+LINK: gh https://github.com/%s` gives `gh` -> that text. @param {Doc} doc @returns {Map<string, string>} */
export function linkAbbreviations(doc) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const k of doc.keywords || []) {
    if (String(k.key).toUpperCase() !== 'LINK') continue;
    const m = /^\s*(\S+)\s+(\S.*?)\s*$/.exec(k.value);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

/** A link target with its abbreviation expanded: `%s` is the rest of the target, `%h` that text percent-encoded, and a value with neither
 * gets the rest appended. A value that calls a function (`%(name)`) is left as written. @param {string} target @param {Map<string, string>} map */
export function expandAbbreviation(target, map) {
  if (!map.size) return target;
  const m = /^([^:]+):([\s\S]*)$/.exec(target);
  const value = m && map.get(m[1]);
  if (!m || value === undefined || /%\(/.test(value)) return target;
  if (!/%[sh]/.test(value)) return value + m[2];
  return value.replace(/%([sh])/g, (_, c) => (c === 's' ? m[2] : encodeURIComponent(m[2])));
}
