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

/** A link target with its abbreviation expanded, as org-link-expand-abbrev does: the part after the first `:` (or `::`) is the
 * tag. In the value, the first `%s` becomes the tag; failing that, the first `%h` becomes the tag percent-encoded; a value
 * with neither gets the tag appended. A value that calls a function (`%(name)`) is left as written, because the app has no Lisp
 * to call. @param {string} target @param {Map<string, string>} map */
export function expandAbbreviation(target, map) {
  if (!map.size) return target;
  const m = /^([^:]*)(?:::?(.*))?$/.exec(target);
  const value = m && map.get(m[1]);
  if (!m || value === undefined || /%\([^)]+\)/.test(value)) return target;
  const tag = m[2] ?? '';
  if (value.includes('%s')) return value.replace('%s', () => tag);
  if (value.includes('%h')) return value.replace('%h', () => encodeURIComponent(tag));
  return value + tag;
}
