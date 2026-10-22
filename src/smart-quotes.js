// @ts-check
/**
 * Smart quotes (`#+OPTIONS: ':t`) for LaTeX export, as `org-export-activate-smart-quotes` does: every `"` in a run of text toggles a primary quote, and
 * a `'` inside an open primary quote is an opening or closing secondary quote by the characters around it, otherwise an apostrophe. The quotes
 * are Org's `org-export-smart-quotes-alist` for LaTeX; a language without an entry (or an apostrophe with none) keeps the plain character.
 */

/** @typedef {{ po?: string, pc?: string, so?: string, sc?: string }} QuoteSet */

/** @type {Record<string, QuoteSet>} */
const QUOTES = {
  "ar": {po: "\\guillemotleft{}", pc: "\\guillemotright{}", so: "\\guilsinglleft{}", sc: "\\guilsinglright{}"},
  "da": {po: ">>", pc: "<<", so: "\\frq{}", sc: "\\flq{}"},
  "de": {po: "\"`", pc: "\"'", so: "\\glq{}", sc: "\\grq{}"},
  "el": {po: "\\guillemotleft{}", pc: "\\guillemotright{}", so: "``", sc: "''"},
  "en": {po: "``", pc: "''", so: "`", sc: "'"},
  "es": {po: "\\guillemotleft{}", pc: "\\guillemotright{}", so: "``", sc: "''"},
  "fa": {po: "\\guillemotleft{}", pc: "\\guillemotright{}", so: "\\guilsinglleft{}", sc: "\\guilsinglright{}"},
  "fr": {po: "\\og ", pc: "\\fg{}", so: "``", sc: "''"},
  "is": {po: "\"`", pc: "\"'", so: "\\glq{}", sc: "\\grq{}"},
  "it": {po: "``", pc: "''", so: "`", sc: "'"},
  "no": {po: "\\guillemotleft{}", pc: "\\guillemotright{}", so: "`", sc: "'"},
  "nb": {po: "\\guillemotleft{}", pc: "\\guillemotright{}", so: "`", sc: "'"},
  "nn": {po: "\\guillemotleft{}", pc: "\\guillemotright{}", so: "`", sc: "'"},
  "ro": {po: "\"`", pc: "''", so: "\\guillemotleft{}", sc: "\\guillemotright{}"},
  "ru": {po: "{}<<", pc: ">>{}", so: "\\glqq{}", sc: "\\grqq{}"},
  "sl": {po: "{}<<", pc: ">>{}", so: "\\glqq{}", sc: "\\grqq{}"},
  "sv": {po: "’’", pc: "’’", so: "’", sc: "’"},
};

/** The syntax class Org's syntax table gives a character: whitespace, open or close bracket, word, symbol, punctuation or string quote. @param {string} c */
function syntaxClass(c) {
  if (c === '"') return 'q';
  if (/[\s\u00a0]/.test(c)) return ' ';
  if (/[([{<]/.test(c)) return '(';
  if (/[)\]}>]/.test(c)) return ')';
  if (/[\p{L}\p{N}$%']/u.test(c)) return 'w';
  if (/[&*+\-/=\\_|~\p{Sc}\p{Sm}\p{Sk}\p{So}]/u.test(c)) return '_';
  return '.';
}

/**
 * What each quote character in each text node of one run of siblings is: `po`, `pc`, `so`, `sc` or `ap` (apostrophe), in reading order.
 * @param {{ type: string, value?: string }[]} list
 * @returns {Map<object, string[]>}
 */
export function quoteStatuses(list) {
  /** @type {Map<object, string[]>} */
  const out = new Map();
  let open = false;
  list.forEach((n, i) => {
    if (n.type !== 'text' || typeof n.value !== 'string') return;
    const text = n.value;
    /** @type {string[]} */
    const status = [];
    for (let at = 0; at < text.length; at++) {
      const ch = text[at];
      if (ch !== '"' && ch !== "'") continue;
      if (ch === '"') {
        open = !open;
        status.push(open ? 'po' : 'pc');
      } else if (!open) status.push('ap');
      else {
        const previous = at > 0 ? text[at - 1] : i > 0 ? 'no-blank' : null;
        const next = at + 1 < text.length ? text[at + 1] : i + 1 < list.length ? 'no-blank' : null;
        const p = previous === null || previous === 'no-blank' ? previous : syntaxClass(previous);
        const x = next === null || next === 'no-blank' ? next : syntaxClass(next);
        const allowOpen = (typeof p === 'string' && p.length === 1 ? 'q ('.includes(p) : p === null) && (typeof x === 'string' && x.length === 1 ? 'w._'.includes(x) : x === 'no-blank');
        const allowClose = (typeof p === 'string' && p.length === 1 ? 'w._'.includes(p) : p === 'no-blank') && (typeof x === 'string' && x.length === 1 ? ' ).q'.includes(x) : x === null);
        status.push(allowOpen ? 'so' : allowClose ? 'sc' : 'ap');
      }
    }
    if (status.length) out.set(n, status);
  });
  return out;
}

/** The text with its quotes replaced. @param {string} text @param {string[]} status @param {string} language */
export function smartQuotes(text, status, language) {
  const set = QUOTES[language];
  let k = 0;
  return text.replace(/['"]/g, (m) => {
    const kind = status[k++];
    return (set && kind !== 'ap' && /** @type {Record<string, string | undefined>} */ (set)[kind]) || m;
  });
}
