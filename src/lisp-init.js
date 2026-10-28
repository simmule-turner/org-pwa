// @ts-check
/**
 * The Lisp init text (`org-xx-lisp-init`), run by the Lisp interpreter: every form is evaluated as Emacs evaluates an init file,
 * and the variables it leaves set are handed to the features that read them (holidays, capture templates, LaTeX, ODT styles,
 * inline tasks, agenda commands, and the settings themselves).
 */
import { Cons, Flt, NIL, Sym, T, allSymbols, intern, list, toArray } from './elisp-data.js';
import { Reader } from './elisp-read.js';
import { evalForm, resetRun, state } from './elisp-core.js';
import { describeFailure } from './elisp.js';

/** @typedef {import('./lisp-read.js').Lisp} Lisp */
/** @typedef {import('./elisp-data.js').LObj} LObj */

/** An init may run this many steps; a larger program stops with a message. */
const BUDGET = 500000;

/** A reader-shaped value as the Lisp object it stands for. @param {Lisp} f @returns {LObj} */
export function toObject(f) {
  if (f.k === 'str') return f.v;
  if (f.k === 'num') return Number.isInteger(f.v) ? f.v : new Flt(f.v);
  if (f.k === 'sym') return intern(f.v);
  return list(f.items.map(toObject), f.tail ? toObject(f.tail) : NIL);
}

/** A Lisp object as the reader-shaped value the init's consumers read. @param {LObj} x @returns {Lisp} */
export function fromObject(x) {
  if (typeof x === 'string') return { k: 'str', v: x };
  if (typeof x === 'number') return { k: 'num', v: x };
  if (typeof x === 'bigint') return { k: 'num', v: Number(x) };
  if (x instanceof Flt) return { k: 'num', v: x.v };
  if (x instanceof Sym) return { k: 'sym', v: x.name };
  if (x instanceof Cons) {
    /** @type {Lisp[]} */
    const items = [];
    /** @type {LObj} */
    let p = x;
    while (p instanceof Cons) {
      items.push(fromObject(p.car));
      p = p.cdr;
    }
    return p === NIL ? { k: 'list', items } : { k: 'list', items, tail: fromObject(p) };
  }
  if (Array.isArray(x)) return { k: 'list', items: x.map(fromObject) };
  return { k: 'sym', v: 'nil' };
}

/** Variables a program changes with `add-to-list`, `push` or `cl-pushnew` that nothing has set yet start as the empty list, as the app has always read them. @param {string} text */
function pushedNames(text) {
  const names = new Set();
  for (const m of text.matchAll(/\(add-to-list\s+'([^\s()]+)/g)) names.add(m[1]);
  for (const m of text.matchAll(/\((?:push|cl-pushnew)\s+(?:'[^\s()]+|"[^"]*"|\([^()]*\)|[^\s()]+)\s+([^\s()']+)\)/g)) names.add(m[1]);
  return names;
}

/**
 * Plays the init `text` on top of `initial` (variable name to value) and returns the variables as they end up, with `errors`: the
 * message of each form that failed. A form that fails does not stop the ones after it. `aliases` names variables that are another
 * variable under an old name. Nothing the program sets stays behind in the interpreter.
 * @param {string} text
 * @param {Map<string, Lisp>} [initial]
 * @param {Record<string, string>} [aliases]
 * @returns {Map<string, Lisp> & { errors: string[] }}
 */
export function runInit(text, initial, aliases = {}) {
  const before = new Map(allSymbols().map((s) => [s, s.value]));
  /** @type {string[]} */
  const errors = [];
  const out = Object.assign(new Map(initial || []), { errors });
  if (!text.trim()) return out;
  for (const [name, value] of initial || []) {
    const s = intern(name);
    s.value = toObject(value);
    s.special = true;
  }
  for (const name of pushedNames(text)) {
    const s = intern(aliases[name] || name);
    if (s.value === undefined) s.value = NIL;
    s.special = true;
  }
  resetRun({ budget: BUDGET });
  state.depth = 20;
  try {
    const reader = new Reader(text);
    while (reader.more()) {
      try {
        evalForm(reader.read(), null);
      } catch (raw) {
        const { message, kind } = describeFailure(raw);
        errors.push(message);
        if (kind === 'budget') break;
        if (raw instanceof Error && raw.constructor.name === 'LispSignal' && /** @type {{ symbol?: Sym }} */ (raw).symbol === intern('end-of-file')) break;
      }
    }
    for (const s of allSymbols()) {
      if (s.value === undefined || s.constant || before.get(s) === s.value) continue;
      const value = fromObject(s.value);
      out.set(s.name, value);
      const real = aliases[s.name];
      if (real) out.set(real, value);
    }
  } finally {
    for (const s of allSymbols()) if (before.has(s) ? s.value !== before.get(s) : s.value !== undefined) s.value = before.get(s);
  }
  return out;
}

export { NIL, T, toArray };
