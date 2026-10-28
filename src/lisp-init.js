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

/** The list variables the app reads from the init or keeps a default for; Emacs has them all bound, so a program may add to them. */
const KNOWN_LISTS = new Set([
  'org-modules', 'org-capture-templates', 'org-refile-targets', 'org-agenda-files', 'org-agenda-custom-commands', 'org-todo-keywords',
  'org-tag-alist', 'org-latex-classes', 'org-latex-packages-alist', 'org-latex-default-packages-alist', 'org-latex-text-markup-alist',
  'org-latex-listings-langs', 'org-latex-minted-langs', 'org-latex-minted-options', 'org-latex-listings-options',
  'org-beamer-environments-extra', 'org-odt-table-styles', 'org-structure-template-alist', 'org-link-abbrev-alist',
  'org-babel-load-languages', 'org-publish-project-alist', 'calendar-holidays', 'load-path',
]);

/** The known list variables the program names; a program adds to them with `add-to-list`, `push` or `cl-pushnew`, and Emacs has them bound. Any other variable is void until the program sets it. @param {string} text */
function pushedNames(text) {
  const names = new Set([...KNOWN_LISTS, ...(text.match(/holiday-[a-z]+-holidays/g) || [])]);
  return [...names].filter((n) => text.includes(n));
}

/**
 * Plays the init `text` on top of `initial` (variable name to value) and returns the variables as they end up, with `errors`: the
 * message of each form that failed. A form that fails does not stop the ones after it. `aliases` names variables that are another
 * variable under an old name. Nothing the program sets stays behind in the interpreter.
 * @param {string} text
 * @param {Map<string, Lisp>} [initial]
 * @param {Record<string, string>} [aliases]
 * @returns {Map<string, Lisp> & { errors: string[], raw: Map<string, LObj> }}  `raw` holds the values as Lisp objects, functions included
 */
export function runInit(text, initial, aliases = {}) {
  const before = new Map(allSymbols().map((s) => [s, s.value]));
  /** @type {string[]} */
  const errors = [];
  /** @type {Map<string, LObj>} */
  const raw = new Map();
  const out = Object.assign(new Map(initial || []), { errors, raw });
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
      raw.set(s.name, s.value);
      const real = aliases[s.name];
      if (real) out.set(real, value);
    }
  } finally {
    for (const s of allSymbols()) if (before.has(s) ? s.value !== before.get(s) : s.value !== undefined) s.value = before.get(s);
  }
  return out;
}

/** The functions the last `keepInitFunctions` left defined, with what each held before. @type {Map<Sym, LObj | undefined>} */
const keptFunctions = new Map();

/**
 * `runInit` for the init text the app is using, keeping the functions it defines (`defun`, `defmacro`, `defalias`) so Lisp that runs
 * later, such as a diary entry, can call them; the functions the previous text defined are removed first, so editing the init edits them.
 * @param {string} text
 * @param {Map<string, Lisp>} [initial]
 * @param {Record<string, string>} [aliases]
 */
export function keepInitFunctions(text, initial, aliases) {
  for (const [s, fn] of keptFunctions) s.fn = fn;
  keptFunctions.clear();
  const before = new Map(allSymbols().map((s) => [s, s.fn]));
  const out = runInit(text, initial, aliases);
  for (const s of allSymbols()) if (s.fn !== before.get(s)) keptFunctions.set(s, before.get(s));
  return out;
}

export { NIL, T, toArray };
