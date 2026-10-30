// @ts-check
/**
 * The Lisp interpreter: reads and evaluates Emacs Lisp text with Emacs 29's semantics (lexical binding by default), under a step
 * budget and `max-lisp-eval-depth`. The data, reader, evaluator and library live in the `elisp-*.js` modules.
 */
import './elisp-lib.js';
import './elisp-extra.js';
import './elisp-loop.js';
import './elisp-pcase.js';
import './elisp-time.js';
import './elisp-prelude.js';
import {
  BudgetExceeded, Cons, LispSignal, LispThrow, NIL, errorMessageString, print, signal,
} from './elisp-data.js';
import { Reader } from './elisp-read.js';
import { evalForm, normalizeError, resetRun, state, topScope } from './elisp-core.js';

export * from './elisp-data.js';
export { Reader, readAll, readFromString } from './elisp-read.js';
export { defAlias, defSpecial, defun, evalForm, funcall, progn, resetRun, state, topScope, withDynamic } from './elisp-core.js';
export { format } from './elisp-lib.js';

/**
 * @typedef {object} RunOptions
 * @property {boolean} [lexical]  lexical binding (default true); false is Emacs's plain `eval`
 * @property {number} [budget]  the step budget
 * @property {number} [baseDepth]  evaluation depth already in use when the program starts (default 20, what `emacs --batch --eval` uses)
 */

/**
 * @typedef {object} RunResult
 * @property {boolean} ok
 * @property {import('./elisp-data.js').LObj} value  the value of the last form (nil after an error)
 * @property {string} output  what `princ`, `print` and friends wrote
 * @property {string[]} messages  what `message` wrote
 * @property {string} [error]  the error as Emacs prints it, when `ok` is false
 * @property {'error' | 'budget' | 'nesting' | 'throw'} [kind]
 * @property {string} [errorForm]  the error object as `prin1` prints it, for a Lisp error
 */

/** The message for anything that can stop a program. @param {unknown} raw @returns {{ message: string, kind: 'error' | 'budget' | 'nesting' | 'throw' }} */
export function describeFailure(raw) {
  const e = normalizeError(raw);
  if (e instanceof LispSignal) return { message: errorMessageString(new Cons(e.symbol, e.data)), kind: e.symbol.name === 'excessive-lisp-nesting' ? 'nesting' : 'error' };
  if (e instanceof LispThrow) return { message: `No catch for tag: ${print(e.tag)}, ${print(e.value)}`, kind: 'throw' };
  if (e instanceof BudgetExceeded) return { message: 'Lisp evaluation stopped: too many steps (possible infinite loop)', kind: 'budget' };
  throw e;
}

/** Reads and evaluates every form of `text`. @param {string} text @param {RunOptions} [options] @returns {RunResult} */
export function run(text, options = {}) {
  resetRun({ budget: options.budget });
  state.depth = options.baseDepth ?? 20;
  const scope = options.lexical === false ? null : topScope();
  /** @type {import('./elisp-data.js').LObj} */
  let value = NIL;
  try {
    const reader = new Reader(text);
    while (reader.more()) value = evalForm(reader.read(), scope);
    return { ok: true, value, output: state.outputs[0].join(''), messages: state.messages };
  } catch (raw) {
    const { message, kind } = describeFailure(raw);
    const e = normalizeError(raw);
    const errorForm = e instanceof LispSignal ? print(new Cons(e.symbol, e.data)) : undefined;
    return { ok: false, value: NIL, output: state.outputs[0].join(''), messages: state.messages, error: message, kind, errorForm };
  }
}

export { signal };
