// @ts-check
// #+SETUPFILE: pulls another file's #+KEYWORD: lines into this document, as if they were written at that spot. The parser
// is synchronous, so the text of each setup file is fetched ahead of time (src-browser/setupfile.js) and kept here by the
// path as written. Until a file has been fetched its lines are simply absent.

/** @type {Map<string, string>} */
const texts = new Map();
const KEYWORD_LINE = /^#\+([A-Za-z][A-Za-z_]*):\s?(.*)$/;
const MAX_DEPTH = 5;

/** The path a #+SETUPFILE: value names: quotes, a leading file: and a trailing space removed. URLs stay as written.
 * @param {string} value */
export function setupFilePath(value) {
  let v = value.trim();
  const quoted = /^"(.*)"$/.exec(v);
  if (quoted) v = quoted[1];
  return v.replace(/^file:/i, '');
}

/** @param {string} path @param {string} text */
export function cacheSetupFile(path, text) {
  texts.set(path, text);
}

/** @param {string} path */
export function cachedSetupFile(path) {
  return texts.get(path);
}

/** The paths named by #+SETUPFILE: lines, in order.
 * @param {string[]} lines */
export function setupFilePaths(lines) {
  const out = [];
  for (const line of lines) {
    const m = KEYWORD_LINE.exec(line);
    if (m && m[1].toUpperCase() === 'SETUPFILE') out.push(setupFilePath(m[2]));
  }
  return out;
}

/** Keyword lines contributed by the setup files named in `lines` (nested setup files too, each file once).
 * @param {string[]} lines
 * @returns {{ key: string, value: string }[]} */
export function setupKeywords(lines) {
  /** @type {{ key: string, value: string }[]} */ const out = [];
  /** @type {Set<string>} */ const seen = new Set();
  /** @param {string[]} from @param {number} depth */
  function visit(from, depth) {
    if (depth > MAX_DEPTH) return;
    for (const path of setupFilePaths(from)) {
      if (seen.has(path)) continue;
      seen.add(path);
      const text = texts.get(path);
      if (text == null) continue;
      const own = text.split(/\r?\n/);
      for (const line of own) {
        const m = KEYWORD_LINE.exec(line);
        if (m && m[1].toUpperCase() !== 'SETUPFILE') out.push({ key: m[1], value: m[2] });
      }
      visit(own, depth + 1);
    }
  }
  visit(lines, 0);
  return out;
}

/** Nested setup files the cache already holds text for, so a fetcher knows what is still missing.
 * @param {string[]} lines
 * @returns {string[]} paths that are named but not cached */
export function missingSetupFiles(lines) {
  /** @type {string[]} */ const missing = [];
  /** @type {Set<string>} */ const seen = new Set();
  /** @param {string[]} from @param {number} depth */
  function visit(from, depth) {
    if (depth > MAX_DEPTH) return;
    for (const path of setupFilePaths(from)) {
      if (seen.has(path)) continue;
      seen.add(path);
      const text = texts.get(path);
      if (text == null) missing.push(path);
      else visit(text.split(/\r?\n/), depth + 1);
    }
  }
  visit(lines, 0);
  return missing;
}

/** Replaces the virtual keywords of a live document with the ones its setup files give now. Returns true if they changed.
 * @param {{ keywords: any[] }} doc */
export function refreshSetupKeywords(doc) {
  const real = doc.keywords.filter((kw) => !kw.virtual);
  const next = setupKeywords(real.map((kw) => `#+${kw.key}: ${kw.value}`));
  const before = doc.keywords.filter((kw) => kw.virtual);
  const same = before.length === next.length && before.every((kw, i) => kw.key === next[i].key && kw.value === next[i].value);
  if (same) return false;
  doc.keywords = [...real, ...next.map((k) => ({ key: k.key, value: k.value, bodyLineIndex: 0, virtual: true }))];
  return true;
}
