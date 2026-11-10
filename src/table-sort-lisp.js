// @ts-check
// The `f` and `F` of Org's table sort (C-c ^): a function that gets the sort key from a field and one that compares two keys, each
// named as Emacs asks for them (org-read-function, which takes the name of a function that exists), run on the Lisp interpreter.
import { Flt, NIL, intern } from './elisp-data.js';
import { callFunction } from './agenda-lisp.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */

/** The function a name stands for, as org-read-function reads it: nothing for an empty name when that is allowed, else a function that exists.
 * @param {string} name @param {boolean} allowEmpty @returns {{ fn: LObj | null } | { error: string }} */
export function readFunction(name, allowEmpty) {
  const text = name.trim();
  if (text === '') return allowEmpty ? { fn: null } : { error: 'Empty input is not valid' };
  const symbol = intern(text);
  if (symbol === NIL || symbol.fn === undefined) return { error: `[No match] ${text} is not a function` };
  return { fn: symbol };
}

/** @param {LObj} value @returns {number | null} */
function numberOf(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Flt) return value.v;
  return null;
}

/** Where sort-subr puts two keys when no predicate is given: numbers by `<`, strings by `string<` (character codes).
 * @param {LObj} a @param {LObj} b */
function defaultLess(a, b) {
  const x = numberOf(a);
  const y = numberOf(b);
  if (x !== null && y !== null) return x < y;
  if (typeof a === 'string' && typeof b === 'string') {
    const p = Array.from(a);
    const q = Array.from(b);
    for (let i = 0; i < Math.min(p.length, q.length); i++) {
      const d = /** @type {number} */ (p[i].codePointAt(0)) - /** @type {number} */ (q[i].codePointAt(0));
      if (d) return d < 0;
    }
    return p.length < q.length;
  }
  throw new Error('Wrong type argument: number-or-string-p, a key that is neither');
}

/**
 * The key and compare functions of a sort by function. An error in either, when the sort runs, is thrown (Emacs signals it and sorts nothing).
 * @param {LObj} keyFn @param {LObj | null} compareFn
 * @returns {{ key: (field: string) => LObj, less: (a: LObj, b: LObj) => boolean }}
 */
export function sortFunctions(keyFn, compareFn) {
  return {
    key(field) {
      const r = callFunction(keyFn, [field]);
      if (!r.ok) throw new Error(r.message);
      return r.value;
    },
    less(a, b) {
      if (!compareFn) return defaultLess(a, b);
      const r = callFunction(compareFn, [a, b]);
      if (!r.ok) throw new Error(r.message);
      return r.value !== NIL;
    },
  };
}
