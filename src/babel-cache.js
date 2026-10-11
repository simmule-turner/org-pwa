/**
 * `:cache yes`: a block whose code and inputs have not changed since its last run is not run again. The hash of those
 * is kept in its results line, `#+RESULTS[hash]:`, as in Org. (Org's own hash is made differently, so a block cached
 * by Emacs simply runs once here and is then cached by this app's hash.)
 */

const IGNORED_RESULT_WORDS = new Set(['replace', 'silent', 'none', 'discard', 'append', 'prepend']);

/** SHA-1 of `text` as 40 hex digits. */
export async function sha1Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The hash of what decides a block's result: its language, the code after Noweb, the variables as they arrive, and
 *  the header arguments that change the shape of the result. */
export function cacheHash({ lang, args, vars, code }) {
  const results = String((args && args.results) || '')
    .split(/\s+/)
    .filter((w) => w && !IGNORED_RESULT_WORDS.has(w))
    .sort()
    .join(' ');
  return sha1Hex(JSON.stringify({ lang: String(lang || ''), code, vars: vars || {}, results, wrap: (args && args.wrap) || '' }));
}
