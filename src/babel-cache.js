// @ts-check
/**
 * `:cache yes`: a block whose code and inputs have not changed since its last run is not run again. The hash of those
 * is kept in its results line, `#+RESULTS[hash]:`, as in Org, and is the same hash Org computes.
 */

const IGNORED_RESULT_WORDS = new Set(['replace', 'silent', 'none', 'discard', 'append', 'prepend']);

/**
 * SHA-1 of `text` as 40 hex digits.
 * @param {string} text
 */
export async function sha1Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A string as Lisp's `%S` prints it. @param {string} text */
const lispString = (text) => '"' + text.replace(/[\\"]/g, '\\$&') + '"';

/**
 * A value as Lisp's `%S` prints it: numbers as they are, strings quoted, arrays as lists (`hline` stays a symbol).
 * @param {unknown} v
 * @returns {string}
 */
function lispPrint(v) {
  if (Array.isArray(v)) return v.length ? '(' + v.map(lispPrint).join(' ') + ')' : 'nil';
  if (v === null || v === undefined || v === false) return 'nil';
  if (v === true) return 't';
  if (typeof v === 'string') return v === 'hline' ? 'hline' : lispString(v);
  return String(v);
}

/** The words of a `:results`/`:exports` value without the ones that only say how to write the results, sorted. @param {string} value */
const shapeWords = (value) => value.split(/\s+/).filter((w) => w && !IGNORED_RESULT_WORDS.has(w)).sort();

/**
 * The text Org's `org-babel-sha1-hash` digests for a block: its header arguments in name order (the ones that are set, `:results`
 * and `:exports` with their words sorted and without replace/silent/..., `:result-params` and `:result-type` as Org derives them),
 * joined by ":", then "-" and the body as the language expands it (Emacs Lisp: wrapped in a `let` for its variables, else with a
 * newline added). Checked against Emacs 29.3 for Emacs Lisp blocks.
 * @param {{ lang?: string, args?: Record<string, unknown>, vars?: Record<string, unknown>, code: string }} block
 * @returns {string}
 */
export function cacheInput({ lang, args, vars, code }) {
  const a = args || {};
  /** @type {[string, string | null][]} */
  const entries = [];
  const results = String(a.results || '');
  for (const [name, value] of Object.entries(a)) {
    if (name === 'var') continue;
    if (name === 'results' || name === 'exports') {
      if (String(value) !== '') entries.push([name, lispString(shapeWords(String(value)).join(' '))]);
    } else if (typeof value === 'string' && value !== '') entries.push([name, lispString(value)]);
  }
  const resultParams = shapeWords(results);
  if (resultParams.length) entries.push(['result-params', '(' + resultParams.map(lispString).join(' ') + ')']);
  entries.push(['result-type', /\boutput\b/.test(results) ? 'output' : 'value']);
  const names = Object.keys(vars || {});
  const varEntries = names.map((n) => {
    const value = /** @type {Record<string, unknown>} */ (vars)[n];
    return Array.isArray(value) ? `(${n}${value.length ? ' ' + value.map(lispPrint).join(' ') : ''})` : `(${n} . ${lispPrint(value)})`;
  });
  const sorted = entries.sort((x, y) => (':' + x[0] < ':' + y[0] ? -1 : ':' + x[0] > ':' + y[0] ? 1 : 0));
  // :var entries come where the name sorts (":var" after ":tangle", before ":wrap"), in their own order
  const at = sorted.findIndex(([n]) => ':' + n > ':var');
  const joined = sorted.map((e) => e[1]);
  joined.splice(at < 0 ? joined.length : at, 0, ...varEntries);
  const language = String(lang || '');
  const expanded =
    language === 'emacs-lisp' || language === 'elisp'
      ? names.length
        ? `(let (${names.map((n) => `(${n} '${lispPrint(/** @type {Record<string, unknown>} */ (vars)[n])})`).join('\n      ')})\n${code}\n)`
        : code + '\n'
      : code;
  return joined.join(':') + '-' + expanded;
}

/** The hash of what decides a block's result: Org's own (see cacheInput), so Emacs and the app agree on which results are current. */
export function cacheHash(/** @type {Parameters<typeof cacheInput>[0]} */ block) {
  return sha1Hex(cacheInput(block));
}
