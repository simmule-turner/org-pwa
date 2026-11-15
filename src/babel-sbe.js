// @ts-check
/**
 * `org-sbe` (ob-table.el): the value of a named source block called from a table formula, `'(org-sbe "name" (n $1) (m 3))`. Each variable is a
 * list of its name and its value (the field's text, a number, or several): a string is what a `:var` reads (`name` is looked up as a reference), and
 * the `$` marker before a value makes it a string. A first argument that is a string is header arguments for the call (`":results raw"`).
 */
import { collectDocumentBlocks } from './babel-blocks.js';
import { resolveVars } from './babel.js';
import { referenceLookup } from './babel-ref.js';
import { toLisp } from './babel-elisp.js';
import { Cons, NIL, Sym, isStr, print, signal, toArray, unbox } from './elisp-data.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */

/** The `:var` text for one variable of an `org-sbe` call. @param {LObj} spec */
function variableText(spec) {
  const [name, ...elements] = toArray(spec).map((x) => unbox(x));
  let quote = false;
  /** @type {LObj[]} */ const values = [];
  for (const el of elements) {
    if (el instanceof Sym && el.name === '$') {
      quote = true;
      continue;
    }
    values.push(quote ? `"${typeof el === 'string' ? el : print(el, false)}"` : el);
    quote = false;
  }
  const label = name instanceof Sym ? name.name : print(name, false);
  if (values.length > 1) {
    const read = values.map((v) => (typeof v === 'string' ? (/^\s*-?\d+(\.\d+)?\s*$/.test(v) ? v.trim() : /^".*"$/.test(v) ? v : `"${v}"`) : print(v, true)));
    return `${label}='(${read.join(' ')})`;
  }
  const only = values[0];
  return `${label}=${typeof only === 'string' ? only : print(only === undefined ? NIL : only, false)}`;
}

/**
 * What `(org-sbe SOURCE-BLOCK VARIABLES...)` gives: the called block's result as text (a table as its Lisp form), trimmed.
 * @param {import('./types.js').Doc} doc @param {LObj} args the unevaluated arguments of the form
 * @returns {string}
 */
export function sbeEvaluate(doc, args) {
  const list = toArray(args).map((x) => unbox(x));
  if (!list.length) throw signal('wrong-number-of-arguments', ['org-sbe', 0]);
  const block = list[0];
  let rest = list.slice(1);
  const header = typeof rest[0] === 'string' ? rest[0] : '';
  if (isStr(rest[0])) rest = rest.slice(1);
  const name = block instanceof Sym ? block.name : typeof block === 'string' ? block : print(block, false);
  const reference = `${name}[${header}](${rest.map(variableText).join(', ')})`;
  let value;
  try {
    value = resolveVars([`results=${reference}`], referenceLookup(doc, collectDocumentBlocks(doc)), {}).results;
  } catch (err) {
    throw signal('error', [/** @type {Error} */ (err).message]);
  }
  if (name === '') value = '';
  const lisp = toLisp(value);
  return (typeof lisp === 'string' ? lisp : print(lisp instanceof Cons || lisp === NIL ? lisp : lisp, true)).trim();
}
