// @ts-check
/**
 * Org Babel for `emacs-lisp` blocks: the block is evaluated by the Lisp interpreter as `org-babel-execute:emacs-lisp` evaluates it
 * (`:var` bindings in a `let`, `with-output-to-string` for `:results output`, dynamic binding unless `:lexical yes`), and the value is laid out under `#+RESULTS:` as `org-babel-insert-result` lays out a Lisp value.
 */
import { Cons, Flt, NIL, Sym, T, print, toArray } from './elisp-data.js';
import { run } from './elisp.js';
import { blockLanguage, layoutResult } from './babel.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */
/** @typedef {ReturnType<typeof import('./babel.js').parseResultsSpec>} ResultsSpec */

const LANGUAGES = new Set(['emacs-lisp', 'elisp']);

/** True for a `#+BEGIN_SRC emacs-lisp` (or `elisp`) block. @param {{ name?: string, params?: string } | null | undefined} block */
export function isElispBlock(block) {
  return !!block && block.name === 'SRC' && LANGUAGES.has(blockLanguage(block.params));
}

/** A `:var` value from the header reader (numbers, strings, lists, null) as the Lisp object it stands for. @param {unknown} v @returns {LObj} */
function toLisp(v) {
  if (v === null || v === undefined || v === false) return NIL;
  if (v === true) return T;
  if (typeof v === 'number') return Number.isInteger(v) ? v : new Flt(v);
  if (typeof v === 'string') return v === 'hline' ? new Sym('hline') : v;
  if (Array.isArray(v)) return v.reduceRight((tail, x) => new Cons(toLisp(x), tail), /** @type {LObj} */ (NIL));
  return NIL;
}

/** The text `org-babel-execute:emacs-lisp` evaluates for a block. @param {string} body @param {Record<string, unknown>} vars @param {ResultsSpec} spec */
export function expandedSource(body, vars, spec) {
  const names = Object.keys(vars);
  const inner = names.length ? `(let (${names.map((n) => `(${n} '${print(toLisp(vars[n]))})`).join('\n      ')})\n${body}\n)` : body + '\n';
  const wrapped = spec.collect === 'output' ? `(with-output-to-string ${inner}\n)` : `(progn ${inner}\n)`;
  return wrapped;
}

/**
 * Evaluates a block.
 * @param {{ code: string, vars?: Record<string, unknown>, spec: ResultsSpec, lexical?: string, budget?: number }} options
 * @returns {{ ok: true, value: LObj } | { ok: false, message: string }}
 */
export function runElisp({ code, vars = {}, spec, lexical, budget = 500000 }) {
  const r = run(expandedSource(code, vars, spec), { lexical: lexical === 'yes' || lexical === 't', budget, baseDepth: 20 });
  return r.ok ? { ok: true, value: r.value } : { ok: false, message: r.error || 'error' };
}

/** @param {LObj} x */
const isProperList = (x) => {
  let p = x;
  while (p instanceof Cons) p = p.cdr;
  return p === NIL;
};

/** `pp` of a Lisp object, as Emacs 29 breaks it: a list holding lists goes one element to a line, each indented under the first. @param {LObj} x @param {number} [col] @returns {string} */
export function pretty(x, col = 0) {
  const flat = (/** @type {LObj} */ y) => print(y).replace(/\n/g, '\\n'); // pp prints with print-escape-newlines
  if (!(x instanceof Cons) || !isProperList(x)) return flat(x);
  const items = toArray(x);
  if (!items.some((i) => i instanceof Cons) || (items.length === 2 && items[0] instanceof Sym && items[0].name === 'quote')) return flat(x);
  /** The column after `text` written from `from`. @param {number} from @param {string} text */
  const after = (from, text) => (text.includes('\n') ? text.length - text.lastIndexOf('\n') - 1 : from + text.length);
  const symbolHead = items[0] instanceof Sym;
  let pos = col + 1;
  let out = '(';
  /** @type {number} */
  let alignCol = col + 1;
  for (let i = 0; i < items.length; i++) {
    if (i > 0) {
      if (items[i] instanceof Cons || items[i - 1] instanceof Cons) {
        out += '\n' + ' '.repeat(alignCol);
        pos = alignCol;
      } else {
        out += ' ';
        pos += 1;
        if (i === 1 && symbolHead) alignCol = pos;
      }
    }
    const text = pretty(items[i], pos);
    out += text;
    pos = after(pos, text);
  }
  return out + ')';
}

/** One element of a result list as the text `format "%s"` gives it, nested lists as items. @param {LObj} v @returns {import('./babel.js').Item} */
function itemOf(v) {
  if (v === NIL) return [];
  if (v instanceof Cons && isProperList(v)) return toArray(v).map(itemOf);
  return print(v, false);
}

/** The text of a table cell: the first line only, and a bar starts another cell. @param {string} text @returns {string[]} */
const cellsOf = (text) => text.split('\n')[0].split('|').map((c) => c.trim());

/**
 * The lines to put under `#+RESULTS:` for what a block gave (`org-babel-execute:emacs-lisp` and `org-babel-insert-result`).
 * @param {LObj} value  the block's value, or the string it wrote with `:results output`
 * @param {ResultsSpec} spec
 * @param {{ wrap?: string | null, file?: string | null }} [options]
 * @returns {string[]}
 */
export function formatElispResult(value, spec, { wrap = null, file = null } = {}) {
  if (spec.file) {
    // `:results file`: a link to the file :file names, else to the value itself
    const target = file !== null && file !== undefined ? file : typeof value === 'string' ? value : print(value, false);
    return layoutResult({ text: `[[file:${target}]]` }, { ...spec, words: new Set(['raw']) }, { wrap, lang: 'emacs-lisp' });
  }
  const w = spec.words;
  const literal = w.has('scalar') || w.has('verbatim') || (w.has('html') && !w.has('table')) || w.has('code') || w.has('pp') || ((spec.collect === 'output' || w.has('raw') || w.has('org') || w.has('drawer')) && !w.has('table'));
  /** @type {{ text: string } | { list: import('./babel.js').Item[] }} */
  let result;
  if (literal) result = { text: w.has('code') || w.has('pp') ? pretty(value) : print(value, w.has('scalar') || w.has('verbatim')) };
  else if (spec.collect === 'output') result = { text: typeof value === 'string' ? value : print(value, false) };
  else if (value === NIL) result = { list: [] };
  else if (value instanceof Cons) {
    if (!isProperList(value)) {
      if (w.has('list')) throw new Error('Wrong type argument: listp, ' + print(value.cdr));
      result = { text: print(value, false) };
    } else {
      const items = toArray(value);
      // Org tabulates a list only when each element is an atom or a proper list: a dotted pair such as (a . 1) keeps it as one value
      const dotted = items.find((x) => x instanceof Cons && !isProperList(x));
      if (dotted instanceof Cons) {
        if (w.has('list')) throw new Error('Wrong type argument: listp, ' + print(dotted.cdr));
        result = { text: print(value, false) };
      }
      else result = { list: items.map((x) => (x instanceof Sym && x.name === 'hline' ? /** @type {never} */ (null) : itemOf(x))) };
    }
  } else if (w.has('table')) result = { list: [[print(value, false)]] };
  else result = { text: print(value, false) };
  if ('text' in result && w.has('list')) result = { text: result.text.split('\n').map((l) => l.trim()).join('\n') };
  let lines = layoutResult(result, spec, { wrap, lang: 'emacs-lisp', cells: cellsOf });
  // a table row holding a blank line, or an empty row, leaves a blank line where Org's table code cuts the text
  if ('list' in result && result.list.length && !w.has('list')) {
    if (result.list.every((r) => Array.isArray(r) && r.length === 0) || result.list.some((r) => Array.isArray(r) && r.some((c) => typeof c === 'string' && c.includes('\n\n')))) lines = [...lines, ''];
  }
  // in a list, a line a cell broke across is indented under its bullet, and an empty item is a bare bullet
  if ('list' in result && w.has('list')) return lines.flatMap((l) => l.split('\n')).map((l) => (/^(- |  |-$)/.test(l) ? l.replace(/\s+$/, '') : '  ' + l));
  return lines;
}
