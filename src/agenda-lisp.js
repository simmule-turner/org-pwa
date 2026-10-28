// @ts-check
/**
 * The agenda settings that name a Lisp function, run on the interpreter: `org-agenda-cmp-user-defined` (the `user-defined-up` and
 * `-down` sort keys), `org-priority-get-priority-function`, `%(form)` in `org-agenda-prefix-format`, and a function as an
 * `org-agenda-custom-commands` command. A setting is the function's name, `#'name`, or a `(lambda ...)` form, taken from the
 * Lisp init when that sets the variable, else from the setting's text.
 */
import { Cons, NIL, Sym, intern, print } from './elisp-data.js';
import { Reader } from './elisp-read.js';
import { evalForm, funcall, state, withDynamic } from './elisp-core.js';
import { defun } from './elisp-core.js';
import { describeFailure } from './elisp.js';
import { withContext } from './diary-lisp.js';
import { initValue } from './holidays.js';
import { withHeading } from './org-lisp.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */
/** @typedef {import('./org-lisp.js').HeadingContext} HeadingContext */
/** @typedef {{ ok: true, value: LObj } | { ok: false, message: string }} Outcome */

/** The function a setting names, or null when it names none. @param {string} name  the variable @param {string | null | undefined} text  its setting's text @returns {LObj | null} */
export function settingFunction(name, text) {
  const fromInit = initValue(name);
  if (fromInit !== undefined) return fromInit === NIL ? null : fromInit;
  const source = String(text ?? '').trim();
  if (!source || source === 'nil') return null;
  try {
    let form = new Reader(source).read();
    if (form instanceof Cons && form.car instanceof Sym && (form.car.name === 'quote' || form.car.name === 'function') && form.cdr instanceof Cons) form = form.cdr.car;
    if (form instanceof Sym) return form === NIL ? null : form;
    return withContext({}, () => evalForm(form, null));
  } catch {
    return null;
  }
}

/**
 * Calls `fn` with `args` (on the heading, when given) under the step budget and nesting limit.
 * @param {LObj} fn @param {LObj[]} args @param {HeadingContext | null} [heading] @param {Record<string, LObj>} [variables]
 * @returns {Outcome}
 */
export function callFunction(fn, args, heading = null, variables = {}) {
  try {
    const pairs = Object.entries(variables).map(([name, value]) => /** @type {[Sym, LObj]} */ ([intern(name), value]));
    for (const [s] of pairs) s.special = true;
    const value = withContext({}, () => withDynamic(pairs, () => (heading ? withHeading(heading, () => funcall(fn, args)) : funcall(fn, args))));
    return { ok: true, value };
  } catch (raw) {
    return { ok: false, message: describeFailure(raw).message };
  }
}

/**
 * `org-agenda-cmp-user-defined` as a comparison of two agenda lines: -1 (a first), 1, or null for no opinion.
 * @param {string | null | undefined} text
 * @returns {((a: string, b: string) => -1 | 1 | null) | null}
 */
export function userComparator(text) {
  const fn = settingFunction('org-agenda-cmp-user-defined', text);
  if (!fn) return null;
  return (a, b) => {
    const r = callFunction(fn, [a, b]);
    return r.ok && (r.value === -1 || r.value === 1) ? r.value : null;
  };
}

/**
 * `org-priority-get-priority-function`: the headline text in, a priority number out; null when the setting names none, or the
 * function gives something else.
 * @param {string | null | undefined} text
 * @returns {((headline: string, heading: HeadingContext | null) => number | null) | null}
 */
export function priorityFunction(text) {
  const fn = settingFunction('org-priority-get-priority-function', text);
  if (!fn) return null;
  return (headline, heading) => {
    const r = callFunction(fn, [headline], heading);
    return r.ok && typeof r.value === 'number' ? r.value : null;
  };
}

/**
 * The text a `%(form)` of `org-agenda-prefix-format` gives: the form's value as `%s` prints it, or Emacs's error text. The form sees
 * `category`, `time`, `level`, `extra`, `effort`, `tag` and `breadcrumbs`, and the heading as the cursor's place.
 * @param {string} formText  the form as written, `(my-function)`
 * @param {Record<string, string>} fields
 * @param {HeadingContext | null} heading
 * @returns {string}
 */
export function evalPrefixForm(formText, fields, heading) {
  /** @type {LObj} */
  let form;
  try {
    form = new Reader(formText).read();
  } catch (raw) {
    return `%![Error: ${describeFailure(raw).message}]`;
  }
  const variables = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v]));
  try {
    const pairs = Object.entries(variables).map(([name, value]) => /** @type {[Sym, LObj]} */ ([intern(name), value]));
    for (const [s] of pairs) s.special = true;
    const value = withContext({}, () => withDynamic(pairs, () => (heading ? withHeading(heading, () => evalForm(form, null)) : evalForm(form, null))));
    return print(value, false);
  } catch (raw) {
    const { message, kind } = describeFailure(raw);
    return kind === 'budget' ? `%![Error: ${message}]` : `%![Error: ${errorObjectText(raw, message)}]`;
  }
}

/** Emacs formats the error object in `%![Error: ...]` as `(error "text")`; the object prints as the error message here. @param {unknown} raw @param {string} message */
function errorObjectText(raw, message) {
  const e = /** @type {{ symbol?: Sym, data?: LObj }} */ (raw);
  return e && e.symbol ? print(new Cons(e.symbol, e.data ?? NIL), false) : message;
}

// `insert` writes where `princ` does, so a function command can build its text either way.
defun('insert', 0, -1, (args) => {
  for (const a of args) funcall(intern('princ'), [typeof a === 'number' ? String.fromCodePoint(a) : a]);
  return NIL;
});

/**
 * Runs a function command: the function is called with the match string, and what it writes (`princ`, `insert`, `print`) and returns
 * (a string, or a list of strings, one to a line) becomes the text of the agenda buffer.
 * @param {string} functionText  the command's type as written: a name or a lambda form
 * @param {string} match
 * @returns {{ ok: true, text: string } | { ok: false, message: string }}
 */
export function runFunctionCommand(functionText, match) {
  const fn = settingFunction('org-xx-command-function', functionText);
  if (!fn) return { ok: false, message: 'Not a function: ' + functionText };
  const r = callFunction(fn, [match]);
  if (!r.ok) return r;
  const written = state.outputs[0].join('');
  const returned = typeof r.value === 'string' ? r.value : r.value instanceof Cons ? flattenStrings(r.value).join('\n') : '';
  return { ok: true, text: [written, returned].filter(Boolean).join(written && returned && !written.endsWith('\n') ? '\n' : '') };
}

/** @param {LObj} x @returns {string[]} */
function flattenStrings(x) {
  /** @type {string[]} */
  const out = [];
  for (let p = x; p instanceof Cons; p = p.cdr) {
    if (typeof p.car === 'string') out.push(p.car);
    else if (p.car instanceof Cons) out.push(...flattenStrings(p.car));
  }
  return out;
}

/** @typedef {import('./agenda.js').AgendaItem} AgendaItem */
/** @typedef {{ userCompare: ((a: AgendaItem, b: AgendaItem) => -1 | 1 | null) | null, priorityOf: ((item: AgendaItem) => number | null) | null }} AgendaLisp */

/** The headline as Emacs hands it to a priority function: `TODO [#A] Title :tag:`. @param {AgendaItem} item */
export function headlineOf(item) {
  const tags = item.tags && item.tags.length ? ` :${item.tags.join(':')}:` : '';
  return [item.todo, item.priority ? `[#${item.priority}]` : '', item.title].filter(Boolean).join(' ') + tags;
}

/** An agenda line as the default prefix and the headline make it (Emacs's carries text properties too, which are not here). @param {AgendaItem} item */
export function lineOf(item) {
  return `  ${((item.category || '') + ':').padEnd(12)} ${headlineOf(item)}`;
}

/**
 * What the agenda's sorting needs from the two settings that name a function; null for each that is unset.
 * @param {Record<string, string> | undefined} localVariables
 * @param {{ documentId: string, doc: import('./types.js').Doc }[]} docs
 * @param {{ todoKeywords?: string[], doneKeywords?: string[] }} [keywords]
 * @returns {AgendaLisp | null}
 */
export function agendaLisp(localVariables, docs, keywords = {}) {
  const compare = userComparator(localVariables?.['org-agenda-cmp-user-defined']);
  const priority = priorityFunction(localVariables?.['org-priority-get-priority-function']);
  if (!compare && !priority) return null;
  const docOf = new Map(docs.map((d) => [d.documentId, d.doc]));
  /** @param {AgendaItem} item @returns {HeadingContext | null} */
  const headingFor = (item) => {
    const doc = docOf.get(item.documentId);
    return doc && item.heading ? { doc, heading: item.heading, category: item.category, ...keywords } : null;
  };
  return {
    userCompare: compare && ((a, b) => compare(lineOf(a), lineOf(b))),
    priorityOf: priority && ((item) => (item.heading ? priority(headlineOf(item), headingFor(item)) : null)),
  };
}

/** The `%(form)` evaluator `formatAgendaPrefix` takes, for one agenda row. @param {AgendaItem} item @param {{ documentId: string, doc: import('./types.js').Doc }[]} docs @param {Record<string, string>} fields @param {{ todoKeywords?: string[], doneKeywords?: string[] }} [keywords] */
export function prefixEvaluator(item, docs, fields, keywords = {}) {
  const doc = docs.find((d) => d.documentId === item.documentId)?.doc;
  const heading = doc && item.heading ? { doc, heading: item.heading, category: item.category, ...keywords } : null;
  return (/** @type {string} */ form) => evalPrefixForm(form, fields, heading);
}
