// @ts-check
/**
 * Source coloring of HTML as Emacs 29.3's html-mode (sgml-mode.el) font-lock gives it: the syntactic faces first (comments, and quoted strings
 * inside tags only; `sgml-syntax-propertize` decides which quotes and angle brackets count), then `sgml-font-lock-keywords-2` rule by rule: markup
 * declarations, tag names, attribute names that have a quoted value, entities, and the faces of `html-tag-face-alist` (bold for b and strong,
 * underline for u, ...) laid over the text of a tag that holds only text. test/source-color.test.js holds the result to the faces Emacs gave
 * test/fixtures/source-color/*.html.
 *
 * htmlRuns(code) -> [[text, face | null], ...]
 */

import { Paint, rule } from './source-paint.js';

/** @typedef {string | null} Face */

const NAME = String.raw`[_:\p{L}][-_.:\p{L}\p{N}]*`; // sgml-name-re
const NAMESPACE = String.raw`[_\p{L}][-_.\p{L}\p{N}]*`; // sgml-namespace-re

// html-tag-face-alist: the first face of each entry is the one this app gives the text.
/** @type {Record<string, string>} */
const TAG_FACES = {
  b: 'bold', big: 'bold', blink: 'highlight', cite: 'italic', em: 'italic', h1: 'bold', h2: 'bold-italic', h3: 'italic', h4: 'underline', h5: 'underline',
  h6: 'underline', i: 'italic', rev: 'mode-line', s: 'underline', small: 'default', strong: 'bold', title: 'bold', tt: 'default', u: 'underline', var: 'italic',
};

/**
 * The parse Emacs makes of the text: `<` opens and `>` closes a level, a quote inside a tag starts a string, `<!--` a comment, `<!` and `<?` a
 * declaration up to the next `>`. A quote outside a tag that is not closed before the next `<` or `>` is punctuation, as sgml-syntax-propertize makes it,
 * and a `>` with no tag open is punctuation too. Strings inside a tag are painted; comments always.
 * @param {string} code @param {Paint} paint
 */
function syntactic(code, paint) {
  const n = code.length;
  let depth = 0;
  let i = 0;
  while (i < n) {
    const c = code[i];
    if (code.startsWith('<!--', i)) {
      const end = /--[ \t\n]*>/g;
      end.lastIndex = i + 4;
      const m = end.exec(code);
      const stop = m ? m.index + m[0].length : n;
      paint.set(i, stop, 'comment');
      const start = /^<!--[ \t]*/.exec(code.slice(i, stop));
      paint.set(i, i + (start ? start[0].length : 4), 'comment-delimiter');
      if (m) {
        const closer = /[ \t]*--[ \t]*>$/.exec(code.slice(i + 4, stop));
        if (closer) paint.set(stop - closer[0].length, stop, 'comment-delimiter');
      }
      i = stop;
    } else if (c === '<' && (code[i + 1] === '!' || code[i + 1] === '?')) {
      const close = code.startsWith('<![CDATA[', i) ? ']]>' : '>';
      const at = code.indexOf(close, i + 2);
      const stop = at < 0 ? n : at + close.length;
      if (depth > 0) paint.set(i, stop, 'string');
      i = stop;
    } else if (c === '"' || c === "'") {
      let after = i + 1;
      while (after < n && !`"'<>`.includes(code[after])) after++;
      if (code[after] === c) {
        if (depth > 0) paint.set(i, after + 1, 'string');
        i = after + 1;
      } else if (depth === 0) i++;
      else {
        const close = code.indexOf(c, i + 1);
        const stop = close < 0 ? n : close + 1;
        paint.set(i, stop, 'string');
        i = stop;
      }
    } else if (c === '<') {
      depth++;
      i++;
    } else if (c === '>') {
      // the `>` of `-->` is a comment ender, not a bracket
      if (depth > 0 && !/--[ \t\n]*$/.test(code.slice(Math.max(0, i - 200), i))) depth--;
      i++;
    } else i++;
  }
}

/** @param {string} code @returns {[string, Face][]} */
export function htmlRuns(code) {
  const paint = new Paint(code.length);
  syntactic(code, paint);
  rule(code, paint, new RegExp(`<([!?]${NAME})`, 'gu'), [[1, 'keyword']]);
  rule(code, paint, new RegExp(`</?(${NAMESPACE})(?::(${NAME}))?`, 'gu'), [[1, (m) => (m[2] === undefined ? 'function-name' : 'sgml-namespace')], [2, 'function-name']]);
  rule(code, paint, new RegExp(`(?:^|[ \\t])(${NAMESPACE})(?::(${NAME}))?=["']`, 'gmu'), [[1, (m) => (m[2] === undefined ? 'variable-name' : 'sgml-namespace')], [2, 'variable-name']]);
  rule(code, paint, new RegExp(`[&%]${NAME};?`, 'gu'), [[0, 'variable-name']]);
  const tags = Object.keys(TAG_FACES).sort((a, b) => b.length - a.length).join('|');
  const tagText = new RegExp(`<(${tags})([ \\t][^>]*)?>([^<]+)</\\1>`, 'gidu');
  for (let m; (m = tagText.exec(code)); ) {
    const span = /** @type {[number, number]} */ (/** @type {RegExpIndicesArray} */ (m.indices)[3]);
    paint.set(span[0], span[1], TAG_FACES[m[1].toLowerCase()]);
  }
  return paint.runs(code);
}
