// @ts-check
/**
 * The evaluator of the Lisp interpreter: scopes, function calls, special forms and macros.
 *
 * A program runs under two limits: `max-lisp-eval-depth` (Emacs's own, which signals `excessive-lisp-nesting`) and a step budget
 * (which stops a runaway loop with a `BudgetExceeded` that no `condition-case` can catch).
 */
import {
  BudgetExceeded, Cons, Flt, HashTable, LispSignal, LispThrow, Lambda, NIL, Special, Subr, Sym, T,
  bool, conditionsOf, eql, equal, intern, list, print, signal, toArray, userErrors, wrongType,
} from './elisp-data.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */
/** @typedef {import('./elisp-data.js').Scope} Scope */

/** The run state shared by the evaluator and the library. */
export const state = {
  steps: 0,
  budget: 1_000_000,
  depth: 0,
  /** @type {string[][]} */
  outputs: [[]],
  /** @type {string[]} */
  messages: [],
  /** @type {LObj[]} */
  catches: [],
  /** @type {(number | null)[] | null} */
  matchData: null,
  matchString: '',
};

const maxDepthSym = intern('max-lisp-eval-depth');
maxDepthSym.value = 1600;
maxDepthSym.special = true;

/** @param {string} s */
export const emit = (s) => state.outputs[state.outputs.length - 1].push(s);

// ---- definition helpers -------------------------------------------------------------------------

/** Defines a built-in function. @param {string} name @param {number} min @param {number} max @param {(args: LObj[]) => LObj} fn */
export function defun(name, min, max, fn) {
  intern(name).fn = new Subr(name, fn, min, max);
}

/** Defines a special form; `min` and `max` bound its argument count. @param {string} name @param {(args: LObj, scope: Scope | null) => LObj} fn @param {number} [min] @param {number} [max] */
export function defSpecial(name, fn, min = 0, max = -1) {
  intern(name).fn = new Special(name, fn, min, max);
}

/** Makes `alias` another name of `name`. @param {string} alias @param {string} name */
export function defAlias(alias, name) {
  intern(alias).fn = intern(name);
}

// ---- variables ----------------------------------------------------------------------------------

/** @param {Sym} sym @param {Scope | null} scope */
export function lookupVar(sym, scope) {
  if (sym.constant) return /** @type {LObj} */ (sym.value);
  for (let s = scope; s; s = s.parent) {
    const v = s.vars.get(sym);
    if (v !== undefined) return v;
  }
  if (sym.value === undefined) throw signal('void-variable', [sym]);
  return sym.value;
}

/** @param {Sym} sym @param {LObj} value @param {Scope | null} scope */
export function setVar(sym, value, scope) {
  for (let s = scope; s; s = s.parent) {
    if (s.vars.has(sym)) {
      s.vars.set(sym, value);
      return value;
    }
  }
  if (sym.constant) throw signal('setting-constant', [sym]);
  sym.value = value;
  return value;
}

/** Runs `body` with `pairs` bound dynamically. @template T @param {[Sym, LObj][]} pairs @param {() => T} body */
export function withDynamic(pairs, body) {
  const saved = pairs.map(([s]) => s.value);
  for (const [s, v] of pairs) {
    if (s.constant) throw signal('setting-constant', [s]);
    s.value = v;
  }
  try {
    return body();
  } finally {
    for (let i = pairs.length - 1; i >= 0; i--) pairs[i][0].value = saved[i];
  }
}

/** @param {Scope | null} scope */
const newScope = (scope) => ({ vars: new Map(), parent: scope });

/** A fresh lexical scope for a top-level `eval` with lexical binding. */
export const topScope = () => newScope(null);

// ---- evaluation ---------------------------------------------------------------------------------

/** Resolves a function designator to a callable; `original` is used in the error. @param {LObj} fn @param {LObj} original */
function resolveFn(fn, original) {
  let f = fn;
  let hops = 0;
  while (f instanceof Sym) {
    if (f === NIL || f.fn === undefined) throw signal('void-function', [original]);
    f = f.fn;
    if (++hops > 100) throw signal('cyclic-function-indirection', [original]);
  }
  return f;
}

/** @param {LObj} form @param {Scope | null} scope @returns {LObj} */
export function evalForm(form, scope) {
  if (form instanceof Sym) return lookupVar(form, scope);
  if (!(form instanceof Cons)) return form;
  if (++state.steps > state.budget) throw new BudgetExceeded('step limit');
  const limit = /** @type {number} */ (typeof maxDepthSym.value === 'number' ? maxDepthSym.value : 1600);
  if (++state.depth > limit) {
    const d = state.depth;
    state.depth--;
    throw signal('excessive-lisp-nesting', [d]);
  }
  try {
    const head = form.car;
    let fn = head;
    if (head instanceof Sym) fn = resolveFn(head, head);
    else if (head instanceof Cons && head.car === intern('lambda')) fn = makeLambda(head.cdr, scope);
    if (fn instanceof Special) {
      if (fn.min > 0 || fn.max >= 0) checkSpecialArity(fn, form.cdr);
      return fn.fn(form.cdr, scope);
    }
    if (fn instanceof Lambda && fn.isMacro) return evalForm(applyLambda(fn, toArray(form.cdr), head), scope);
    if (fn instanceof Cons && fn.car === intern('macro')) {
      const m = fn.cdr instanceof Lambda ? fn.cdr : null;
      if (m) return evalForm(applyLambda(m, toArray(form.cdr), head), scope);
    }
    /** @type {LObj[]} */
    const args = [];
    let p = form.cdr;
    for (; p instanceof Cons; p = p.cdr) args.push(evalForm(p.car, scope));
    if (p !== NIL) throw wrongType('listp', p);
    return callFn(fn, args, head);
  } finally {
    state.depth--;
  }
}

/** @param {Special} fn @param {LObj} args */
function checkSpecialArity(fn, args) {
  let n = 0;
  for (let p = args; p instanceof Cons; p = p.cdr) n++;
  if (n < fn.min || (fn.max >= 0 && n > fn.max)) throw signal('wrong-number-of-arguments', [intern(fn.name), n]);
}

/** Calls the callable `fn` (already resolved) with evaluated `args`. @param {LObj} fn @param {LObj[]} args @param {LObj} original */
function callFn(fn, args, original) {
  if (fn instanceof Subr) {
    if (args.length < fn.min || (fn.max >= 0 && args.length > fn.max)) throw signal('wrong-number-of-arguments', [original instanceof Sym ? original : fn, args.length]);
    return fn.fn(args);
  }
  if (fn instanceof Lambda) return applyLambda(fn, args, original);
  if (fn instanceof Cons && fn.car === intern('lambda')) return applyLambda(makeLambda(fn.cdr, null), args, original);
  if (fn instanceof Cons && fn.car === intern('closure')) {
    const rest = fn.cdr instanceof Cons ? fn.cdr.cdr : NIL;
    return applyLambda(makeLambda(rest, null), args, original);
  }
  throw signal('invalid-function', [fn instanceof Special ? fn : original]);
}

/** `funcall`: `fn` is any function designator. @param {LObj} fn @param {LObj[]} args */
export function funcall(fn, args) {
  const f = resolveFn(fn, fn);
  if (f instanceof Special) throw signal('invalid-function', [f]);
  if (f instanceof Lambda && f.isMacro) throw signal('invalid-function', [f]);
  if (++state.steps > state.budget) throw new BudgetExceeded('step limit');
  const limit = /** @type {number} */ (typeof maxDepthSym.value === 'number' ? maxDepthSym.value : 1600);
  if (++state.depth > limit) {
    const d = state.depth;
    state.depth--;
    throw signal('excessive-lisp-nesting', [d]);
  }
  try {
    return callFn(f, args, f);
  } finally {
    state.depth--;
  }
}

/** @type {WeakMap<Lambda, { req: Sym[], opt: Sym[], rest: Sym | null }>} */
const paramCache = new WeakMap();

/** @param {Lambda} f */
function paramInfo(f) {
  let info = paramCache.get(f);
  if (info) return info;
  /** @type {Sym[]} */ const req = [];
  /** @type {Sym[]} */ const opt = [];
  /** @type {Sym | null} */ let rest = null;
  let mode = 0;
  for (const p of toArray(f.params)) {
    if (!(p instanceof Sym)) throw signal('invalid-function', [f]);
    if (p.name === '&optional') mode = 1;
    else if (p.name === '&rest') mode = 2;
    else if (mode === 0) req.push(p);
    else if (mode === 1) opt.push(p);
    else rest = p;
  }
  info = { req, opt, rest };
  paramCache.set(f, info);
  return info;
}

/** Runs a body of forms; the value of the last. @param {LObj} body @param {Scope | null} scope */
export function progn(body, scope) {
  /** @type {LObj} */
  let v = NIL;
  for (let p = body; p instanceof Cons; p = p.cdr) v = evalForm(p.car, scope);
  return v;
}

/** The closure as Emacs reports it in an argument-count error: `(ENV PARAMS BODY...)`, without the word `closure`. @param {Lambda} f */
function closureData(f) {
  /** @type {LObj[]} */
  const env = [];
  for (let s = f.scope; s; s = s.parent) for (const [k, v] of s.vars) env.push(new Cons(k, v));
  env.push(T);
  return new Cons(list(env), new Cons(f.params, f.body));
}

/** @param {Lambda} f @param {LObj[]} args @param {LObj} [original] */
export function applyLambda(f, args, original) {
  const { req, opt, rest } = paramInfo(f);
  if (args.length < req.length || (!rest && args.length > req.length + opt.length)) {
    if (f.compiled) throw signal('wrong-number-of-arguments', [new Cons(req.length, rest ? intern('many') : req.length + opt.length), args.length]);
    throw signal('wrong-number-of-arguments', [f.isMacro ? new Cons(intern('macro'), new Cons(intern('lambda'), new Cons(f.params, f.body))) : f.lexical ? closureData(f) : f, args.length]);
  }
  void original;
  /** @type {[Sym, LObj][]} */
  const dyn = [];
  const lexical = f.scope !== null;
  const scope = lexical ? newScope(f.scope) : null;
  /** @param {Sym} s @param {LObj} v */
  const bind = (s, v) => {
    if (scope && !s.special) scope.vars.set(s, v);
    else dyn.push([s, v]);
  };
  req.forEach((s, i) => bind(s, args[i]));
  opt.forEach((s, i) => bind(s, args[req.length + i] ?? NIL));
  if (rest) bind(rest, list(args.slice(req.length + opt.length)));
  if (dyn.length) return withDynamic(dyn, () => progn(f.body, scope));
  return progn(f.body, scope);
}

/** @param {LObj} spec  `(ARGS . BODY)` @param {Scope | null} scope */
function makeLambda(spec, scope) {
  if (!(spec instanceof Cons)) throw signal('wrong-type-argument', [intern('listp'), spec]);
  return new Lambda(spec.car, spec.cdr, scope, scope !== null);
}

// ---- special forms ------------------------------------------------------------------------------

/** @param {LObj} x */
const car = (x) => (x instanceof Cons ? x.car : NIL);
/** @param {LObj} x */
const cdr = (x) => (x instanceof Cons ? x.cdr : NIL);
/** @param {LObj} x */
const cadr = (x) => car(cdr(x));
/** @param {LObj} x */
const cddr = (x) => cdr(cdr(x));

defSpecial('quote', (args) => car(args));
defSpecial('function', (args, scope) => {
  const f = car(args);
  if (f instanceof Cons && f.car === intern('lambda')) return makeLambda(f.cdr, scope);
  return f;
});
defSpecial('lambda', (args, scope) => makeLambda(args, scope));
defSpecial('progn', (args, scope) => progn(args, scope));
defSpecial('prog1', (args, scope) => {
  const v = evalForm(car(args), scope);
  progn(cdr(args), scope);
  return v;
});
defSpecial('prog2', (args, scope) => {
  evalForm(car(args), scope);
  const v = evalForm(cadr(args), scope);
  progn(cddr(args), scope);
  return v;
});
defSpecial('if', (args, scope) => (evalForm(car(args), scope) !== NIL ? evalForm(cadr(args), scope) : progn(cddr(args), scope)));
defSpecial('when', (args, scope) => (evalForm(car(args), scope) !== NIL ? progn(cdr(args), scope) : NIL));
defSpecial('unless', (args, scope) => (evalForm(car(args), scope) === NIL ? progn(cdr(args), scope) : NIL));
defSpecial('and', (args, scope) => {
  /** @type {LObj} */
  let v = T;
  for (let p = args; p instanceof Cons; p = p.cdr) {
    v = evalForm(p.car, scope);
    if (v === NIL) return NIL;
  }
  return v;
});
defSpecial('or', (args, scope) => {
  for (let p = args; p instanceof Cons; p = p.cdr) {
    const v = evalForm(p.car, scope);
    if (v !== NIL) return v;
  }
  return NIL;
});
defSpecial('cond', (args, scope) => {
  for (let p = args; p instanceof Cons; p = p.cdr) {
    const clause = p.car;
    if (!(clause instanceof Cons)) {
      if (clause === NIL) continue;
      throw wrongType('listp', clause);
    }
    const t = evalForm(clause.car, scope);
    if (t !== NIL) return clause.cdr === NIL ? t : progn(clause.cdr, scope);
  }
  return NIL;
});

/** Is `sym` to be bound dynamically here? @param {Sym} sym @param {Scope | null} scope */
const dynamicHere = (sym, scope) => scope === null || sym.special;

/** Binds `name` to `value` for the extent of `body`. @param {Sym} name @param {LObj} value @param {Scope | null} scope @param {(s: Scope | null) => LObj} body */
function bindOne(name, value, scope, body) {
  if (dynamicHere(name, scope)) return withDynamic([[name, value]], () => body(scope));
  const inner = newScope(scope);
  inner.vars.set(name, value);
  return body(inner);
}

/** @param {LObj} args @param {Scope | null} scope @param {boolean} star */
function letForm(args, scope, star) {
  const bindings = toArray(car(args));
  const body = cdr(args);
  /** @param {LObj} b @returns {[Sym, LObj]} */
  const split = (b) => {
    if (b instanceof Sym) return [b, NIL];
    if (b instanceof Cons && b.car instanceof Sym) {
      if (b.cdr instanceof Cons && b.cdr.cdr !== NIL) throw signal('error', ["`let' bindings can have only one value-form", b.car, ...toArray(b.cdr)]);
      return [b.car, evalWith(cadr(b))];
    }
    throw wrongType('symbolp', b instanceof Cons ? b.car : b);
  };
  /** @type {Scope | null} */
  let cur = scope;
  /** @param {LObj} f */
  const evalWith = (f) => evalForm(f, cur);
  if (!star) {
    const evaluated = bindings.map((b) => split(b));
    const inner = scope === null ? null : newScope(scope);
    /** @type {[Sym, LObj][]} */
    const dyn = [];
    for (const [s, v] of evaluated) {
      if (inner && !s.special) inner.vars.set(s, v);
      else dyn.push([s, v]);
    }
    if (dyn.length) return withDynamic(dyn, () => progn(body, inner));
    return progn(body, inner);
  }
  /** @type {[Sym, LObj][]} */
  const dynSaved = [];
  /** @type {Sym[]} */
  const dynSyms = [];
  const inner = scope === null ? null : newScope(scope);
  cur = inner;
  /** @type {unknown[]} */
  const old = [];
  try {
    for (const b of bindings) {
      const [s, v] = split(b);
      if (inner && !s.special) inner.vars.set(s, v);
      else {
        if (s.constant) throw signal('setting-constant', [s]);
        old.push(s.value);
        dynSyms.push(s);
        s.value = v;
      }
    }
    return progn(body, inner);
  } finally {
    for (let i = dynSyms.length - 1; i >= 0; i--) dynSyms[i].value = /** @type {LObj | undefined} */ (old[i]);
    void dynSaved;
  }
}
defSpecial('let', (args, scope) => letForm(args, scope, false));
defSpecial('let*', (args, scope) => letForm(args, scope, true));

defSpecial('setq', (args, scope) => {
  /** @type {LObj} */
  let v = NIL;
  let n = 0;
  for (let p = args; p instanceof Cons; p = cddr(p)) {
    n++;
    if (!(p.cdr instanceof Cons)) throw signal('wrong-number-of-arguments', [intern('setq'), toArray(args).length]);
    if (!(p.car instanceof Sym)) throw wrongType('symbolp', p.car);
    v = evalForm(p.cdr.car, scope);
    setVar(p.car, v, scope);
  }
  void n;
  return v;
});
defAlias('setq-local', 'setq');
defAlias('setq-default', 'setq');
defAlias('setopt', 'setq');

// (with-eval-after-load FEATURE BODY...): the features are always loaded here, so the body runs at once
defSpecial('with-eval-after-load', (args, scope) => progn(cdr(args), scope), 1);

// (cl-pushnew X VAR): X onto the front of the list in VAR unless it is already there (compared with eql)
defSpecial('cl-pushnew', (args, scope) => {
  const place = car(cdr(args));
  if (!(place instanceof Sym)) throw wrongType('symbolp', place);
  const x = evalForm(car(args), scope);
  const current = lookupVar(place, scope);
  if (toArray(current).some((e) => eql(e, x))) return current;
  const updated = new Cons(x, current);
  setVar(place, updated, scope);
  return updated;
}, 2);

defSpecial('defvar', (args, scope) => {
  const name = car(args);
  if (!(name instanceof Sym)) throw wrongType('symbolp', name);
  if (cdr(args) instanceof Cons) {
    name.special = true;
    if (name.value === undefined) name.value = evalForm(cadr(args), scope);
  } else name.special = true;
  return name;
});
defSpecial('defconst', (args, scope) => {
  const name = car(args);
  if (!(name instanceof Sym)) throw wrongType('symbolp', name);
  name.special = true;
  name.value = evalForm(cadr(args), scope);
  return name;
});
defSpecial('defcustom', (args, scope) => {
  const name = car(args);
  if (!(name instanceof Sym)) throw wrongType('symbolp', name);
  name.special = true;
  if (name.value === undefined) name.value = evalForm(cadr(args), scope);
  return name;
});
defSpecial('defgroup', (args) => car(args));
defSpecial('declare', () => NIL);
defSpecial('interactive', () => NIL);
defSpecial('declare-function', () => NIL);
defSpecial('defun', (args, scope) => {
  const name = car(args);
  if (!(name instanceof Sym)) throw wrongType('symbolp', name);
  name.fn = makeLambda(cdr(args), scope);
  return name;
});
defSpecial('defmacro', (args, scope) => {
  const name = car(args);
  if (!(name instanceof Sym)) throw wrongType('symbolp', name);
  const m = makeLambda(cdr(args), scope);
  m.isMacro = true;
  name.fn = m;
  return name;
});
defAlias('cl-defmacro', 'defmacro');
defSpecial('eval-when-compile', (args, scope) => progn(args, scope));
defSpecial('eval-and-compile', (args, scope) => progn(args, scope));
defSpecial('save-match-data', (args, scope) => {
  const saved = state.matchData;
  try {
    return progn(args, scope);
  } finally {
    state.matchData = saved;
  }
});
defSpecial('save-excursion', (args, scope) => progn(args, scope));
defSpecial('save-restriction', (args, scope) => progn(args, scope));

defSpecial('while', (args, scope) => {
  const test = car(args);
  const body = cdr(args);
  while (evalForm(test, scope) !== NIL) {
    if (++state.steps > state.budget) throw new BudgetExceeded('step limit');
    progn(body, scope);
  }
  return NIL;
});

defSpecial('dolist', (args, scope) => {
  const spec = car(args);
  const name = car(spec);
  if (!(name instanceof Sym)) throw wrongType('symbolp', name);
  const body = cdr(args);
  const items = evalForm(cadr(spec), scope);
  const dynamic = dynamicHere(name, scope);
  /** @type {LObj} */
  let p = items;
  const old = name.value;
  try {
    while (p instanceof Cons) {
      if (++state.steps > state.budget) throw new BudgetExceeded('step limit');
      if (dynamic) {
        name.value = p.car;
        progn(body, scope);
      } else {
        const inner = newScope(scope);
        inner.vars.set(name, p.car);
        progn(body, inner);
      }
      p = p.cdr;
    }
    if (p !== NIL) throw wrongType('listp', p);
    if (cddr(spec) === NIL) return NIL;
    if (scope !== null && !name.special) return progn(cddr(spec), scope);
    return bindOne(name, NIL, scope, (s) => progn(cddr(spec), s));
  } finally {
    if (dynamic) name.value = old;
  }
});

defSpecial('dotimes', (args, scope) => {
  const spec = car(args);
  const name = car(spec);
  if (!(name instanceof Sym)) throw wrongType('symbolp', name);
  const body = cdr(args);
  const count = evalForm(cadr(spec), scope);
  if (typeof count !== 'number') throw wrongType('integerp', count);
  const dynamic = dynamicHere(name, scope);
  const old = name.value;
  try {
    for (let i = 0; i < count; i++) {
      if (++state.steps > state.budget) throw new BudgetExceeded('step limit');
      if (dynamic) {
        name.value = i;
        progn(body, scope);
      } else {
        const inner = newScope(scope);
        inner.vars.set(name, i);
        progn(body, inner);
      }
    }
    if (cddr(spec) === NIL) return NIL;
    return bindOne(name, Math.max(count, 0), scope, (s) => progn(cddr(spec), s));
  } finally {
    if (dynamic) name.value = old;
  }
});

defSpecial('catch', (args, scope) => {
  const tag = evalForm(car(args), scope);
  state.catches.push(tag);
  const depth = state.catches.length;
  try {
    return progn(cdr(args), scope);
  } catch (e) {
    if (e instanceof LispThrow && eql(e.tag, tag)) return e.value;
    throw e;
  } finally {
    state.catches.length = depth - 1;
  }
});

defSpecial('unwind-protect', (args, scope) => {
  try {
    return evalForm(car(args), scope);
  } finally {
    progn(cdr(args), scope);
  }
});

/** Turns a JS stack overflow into Emacs's nesting error. @param {unknown} e */
export function normalizeError(e) {
  if (e instanceof RangeError && /call stack/i.test(e.message)) return signal('excessive-lisp-nesting', [1601]);
  return e;
}

/** Does the handler condition spec match the signal? @param {LObj} spec @param {Sym} symbol */
function conditionMatches(spec, symbol) {
  const conds = conditionsOf(symbol);
  /** @param {LObj} c */
  const one = (c) => c === T || (c instanceof Sym && conds.includes(c.name));
  if (spec instanceof Cons) return toArray(spec).some(one);
  return one(spec);
}

defSpecial('condition-case', (args, scope) => {
  const variable = car(args);
  const bodyform = cadr(args);
  const handlers = toArray(cddr(args));
  /** @param {LObj} value @param {LObj} body */
  const runHandler = (value, body) => {
    if (variable === NIL) return progn(body, scope);
    return bindOne(/** @type {Sym} */ (variable), value, scope, (s) => progn(body, s));
  };
  const depth = state.depth;
  const catchDepth = state.catches.length;
  const outDepth = state.outputs.length;
  /** @type {LObj} */
  let result;
  try {
    result = evalForm(bodyform, scope);
  } catch (raw) {
    const e = normalizeError(raw);
    if (!(e instanceof LispSignal)) throw e;
    for (const h of handlers) {
      if (!(h instanceof Cons)) continue;
      if (h.car === intern(':success')) continue;
      if (conditionMatches(h.car, e.symbol)) {
        state.depth = depth;
        state.catches.length = catchDepth;
        state.outputs.length = outDepth;
        return runHandler(new Cons(e.symbol, e.data), h.cdr);
      }
    }
    throw e;
  }
  for (const h of handlers) if (h instanceof Cons && h.car === intern(':success')) return runHandler(result, h.cdr);
  return result;
});
defAlias('condition-case-unless-debug', 'condition-case');

defSpecial('ignore-errors', (args, scope) => {
  const depth = state.depth;
  try {
    return progn(args, scope);
  } catch (raw) {
    const e = normalizeError(raw);
    if (e instanceof LispSignal && conditionsOf(e.symbol).includes('error')) {
      state.depth = depth;
      return NIL;
    }
    throw e;
  }
});

defSpecial('ignore-error', (args, scope) => {
  const spec = car(args);
  try {
    return progn(cdr(args), scope);
  } catch (raw) {
    const e = normalizeError(raw);
    if (e instanceof LispSignal && conditionMatches(spec, e.symbol)) return NIL;
    throw e;
  }
});

defSpecial('with-demoted-errors', (args, scope) => {
  const format = typeof car(args) === 'string';
  try {
    return progn(format ? cdr(args) : args, scope);
  } catch (raw) {
    const e = normalizeError(raw);
    if (e instanceof LispSignal && conditionsOf(e.symbol).includes('error')) {
      const err = new Cons(e.symbol, e.data);
      state.messages.push(format ? String(funcall(intern('format-message'), [car(args), err])) : `Debugger entered--Lisp error: ${print(err)}`);
      return NIL;
    }
    throw e;
  }
});

/** The bindings of an `if-let` style spec, evaluated in turn. @param {LObj} spec @param {Scope | null} scope @param {[Sym, LObj | undefined][]} saved  old values of dynamically bound symbols @returns {{ ok: boolean, scope: Scope | null }} */
function letSpec(spec, scope, saved) {
  let list_ = spec;
  if (spec instanceof Cons && spec.car instanceof Sym && spec.car !== NIL) list_ = new Cons(spec, NIL);
  const inner = scope === null ? null : newScope(scope);
  for (const b of toArray(list_)) {
    /** @type {LObj} */
    let v;
    /** @type {Sym | null} */
    let name = null;
    if (b instanceof Sym) v = lookupVar(b, inner);
    else if (b instanceof Cons && b.cdr === NIL) v = evalForm(b.car, inner);
    else if (b instanceof Cons && b.car instanceof Sym) {
      name = b.car;
      v = evalForm(cadr(b), inner);
    } else throw wrongType('listp', b);
    if (v === NIL) return { ok: false, scope: inner };
    if (name) {
      if (inner && !name.special) inner.vars.set(name, v);
      else {
        saved.push([name, name.value]);
        name.value = v;
      }
    }
  }
  return { ok: true, scope: inner };
}

/** Runs `fn` with the spec's bindings, then undoes dynamic ones. @param {LObj} spec @param {Scope | null} scope @param {(r: { ok: boolean, scope: Scope | null }) => LObj} fn */
function withLetSpec(spec, scope, fn) {
  /** @type {[Sym, LObj | undefined][]} */
  const saved = [];
  try {
    return fn(letSpec(spec, scope, saved));
  } finally {
    for (let i = saved.length - 1; i >= 0; i--) saved[i][0].value = saved[i][1];
  }
}
defSpecial('if-let', (args, scope) => withLetSpec(car(args), scope, (r) => (r.ok ? evalForm(cadr(args), r.scope) : progn(cddr(args), scope))));
defAlias('if-let*', 'if-let');
defSpecial('when-let', (args, scope) => withLetSpec(car(args), scope, (r) => (r.ok ? progn(cdr(args), r.scope) : NIL)));
defAlias('when-let*', 'when-let');
defSpecial('and-let*', (args, scope) => withLetSpec(car(args), scope, (r) => (!r.ok ? NIL : cdr(args) === NIL ? T : progn(cdr(args), r.scope))));

// ---- places (setf, push, pop) -------------------------------------------------------------------

/** @typedef {{ get: () => LObj, set: (v: LObj) => void }} Place */

/** @param {LObj} place @param {Scope | null} scope @returns {Place} */
export function resolvePlace(place, scope) {
  if (place instanceof Sym) return { get: () => lookupVar(place, scope), set: (v) => void setVar(place, v, scope) };
  if (!(place instanceof Cons) || !(place.car instanceof Sym)) throw signal('error', ['Bad place', place]);
  const name = place.car.name;
  const argForms = toArray(place.cdr);
  const a = argForms.map((f) => evalForm(f, scope));
  /** @param {LObj} x */
  const cell = (x) => {
    if (x instanceof Cons) return x;
    throw wrongType('consp', x);
  };
  switch (name) {
    case 'car': return { get: () => cell(a[0]).car, set: (v) => void (cell(a[0]).car = v) };
    case 'cdr': return { get: () => cell(a[0]).cdr, set: (v) => void (cell(a[0]).cdr = v) };
    case 'cadr': return { get: () => car(cdr(a[0])), set: (v) => void (cell(cdr(a[0])).car = v) };
    case 'cddr': return { get: () => cdr(cdr(a[0])), set: (v) => void (cell(cdr(a[0])).cdr = v) };
    case 'nth': return { get: () => car(nthcdr(/** @type {number} */ (a[0]), a[1])), set: (v) => void (cell(nthcdr(/** @type {number} */ (a[0]), a[1])).car = v) };
    case 'nthcdr': return { get: () => nthcdr(/** @type {number} */ (a[0]), a[1]), set: () => { throw signal('error', ['Bad place', place]); } };
    case 'aref': return {
      get: () => callFn(resolveFn(intern('aref'), intern('aref')), [a[0], a[1]], intern('aref')),
      set: (v) => void callFn(resolveFn(intern('aset'), intern('aset')), [a[0], a[1], v], intern('aset')),
    };
    case 'gethash': return {
      get: () => callFn(resolveFn(intern('gethash'), intern('gethash')), [a[0], a[1], a[2] ?? NIL], intern('gethash')),
      set: (v) => void callFn(resolveFn(intern('puthash'), intern('puthash')), [a[0], v, a[1]], intern('puthash')),
    };
    case 'get': return {
      get: () => callFn(resolveFn(intern('get'), intern('get')), [a[0], a[1]], intern('get')),
      set: (v) => void callFn(resolveFn(intern('put'), intern('put')), [a[0], a[1], v], intern('put')),
    };
    case 'symbol-value': return { get: () => /** @type {Sym} */ (a[0]).value ?? NIL, set: (v) => void (/** @type {Sym} */ (a[0]).value = v) };
    case 'alist-get': return alistGetPlace(argForms, a, scope);
    default: {
      const fn = intern(name).fn;
      if (fn instanceof Lambda && fn.isMacro) return resolvePlace(applyLambda(fn, argForms, place.car), scope);
      throw signal('void-function', [intern(`\\(setf\\ ${name}\\)`)]);
    }
  }
}

/** @param {number} n @param {LObj} x */
export function nthcdr(n, x) {
  let p = x;
  for (let i = 0; i < n && p instanceof Cons; i++) p = p.cdr;
  return p;
}

/** `(alist-get KEY ALIST [DEFAULT REMOVE TESTFN])` as a place; ALIST is itself a place form. @param {LObj[]} argForms @param {LObj[]} a @param {Scope | null} scope @returns {Place} */
function alistGetPlace(argForms, a, scope) {
  const alistPlace = resolvePlaceNoEval(argForms[1], scope);
  const test = a[4] ?? NIL;
  /** @param {LObj} x @param {LObj} y */
  const same = (x, y) => (test === NIL ? eql(x, y) : funcall(test, [x, y]) !== NIL);
  /** @returns {Cons | null} */
  const find = () => {
    for (let p = alistPlace.get(); p instanceof Cons; p = p.cdr) if (p.car instanceof Cons && same(a[0], p.car.car)) return p.car;
    return null;
  };
  return {
    get: () => find()?.cdr ?? a[2] ?? NIL,
    set: (v) => {
      const c = find();
      if (c) c.cdr = v;
      else alistPlace.set(new Cons(new Cons(a[0], v), alistPlace.get()));
    },
  };
}

/** A place whose subforms are evaluated now. @param {LObj} place @param {Scope | null} scope */
const resolvePlaceNoEval = (place, scope) => resolvePlace(place, scope);

defSpecial('setf', (args, scope) => {
  /** @type {LObj} */
  let v = NIL;
  for (let p = args; p instanceof Cons; p = cddr(p)) {
    if (!(p.cdr instanceof Cons)) throw signal('wrong-number-of-arguments', [intern('setf'), toArray(args).length]);
    const place = resolvePlace(p.car, scope);
    v = evalForm(p.cdr.car, scope);
    place.set(v);
  }
  return v;
});
defSpecial('push', (args, scope) => {
  const x = evalForm(car(args), scope);
  const place = resolvePlace(cadr(args), scope);
  const v = new Cons(x, place.get());
  place.set(v);
  return v;
});
defSpecial('pop', (args, scope) => {
  const place = resolvePlace(car(args), scope);
  const l = place.get();
  if (l === NIL) return NIL;
  if (!(l instanceof Cons)) throw wrongType('listp', l);
  place.set(l.cdr);
  return l.car;
});
/** @param {number} sign */
const incf = (sign) => (/** @type {LObj} */ args, /** @type {Scope | null} */ scope) => {
  const place = resolvePlace(car(args), scope);
  const by = cdr(args) === NIL ? 1 : evalForm(cadr(args), scope);
  const sum = callFn(resolveFn(intern(sign > 0 ? '+' : '-'), intern('+')), [place.get(), by], intern('+'));
  place.set(sum);
  return sum;
};
defSpecial('cl-incf', incf(1));
defSpecial('cl-decf', incf(-1));

defSpecial('with-output-to-string', (args, scope) => {
  state.outputs.push([]);
  const depth = state.outputs.length;
  try {
    progn(args, scope);
    return /** @type {string[]} */ (state.outputs[depth - 1]).join('');
  } finally {
    state.outputs.length = depth - 1;
  }
});

// ---- backquote ----------------------------------------------------------------------------------

const BQ = intern('`');
const COMMA = intern(',');
const SPLICE = intern(',@');

/** @param {LObj} t @param {Scope | null} scope @param {number} depth @returns {LObj} */
function backquote(t, scope, depth) {
  if (Array.isArray(t)) {
    /** @type {LObj[]} */
    const out = [];
    for (const e of t) {
      if (e instanceof Cons && e.car === SPLICE && depth === 1) out.push(...toArray(evalForm(cadr(e), scope)));
      else out.push(backquote(e, scope, depth));
    }
    return out;
  }
  if (!(t instanceof Cons)) return t;
  if (t.car === COMMA) return depth === 1 ? evalForm(cadr(t), scope) : list([COMMA, backquote(cadr(t), scope, depth - 1)]);
  if (t.car === BQ) return list([BQ, backquote(cadr(t), scope, depth + 1)]);
  /** @type {LObj[][]} */
  const parts = [];
  /** @type {LObj[]} */
  let cur = [];
  /** @type {LObj} */
  let tail = NIL;
  /** @type {LObj} */
  let p = t;
  while (p instanceof Cons) {
    if (p.car === COMMA && p !== t) {
      // `(a . ,b)`: the rest of the list is the comma form
      tail = depth === 1 ? evalForm(cadr(p), scope) : backquote(p, scope, depth);
      p = NIL;
      break;
    }
    const e = p.car;
    if (e instanceof Cons && e.car === SPLICE && depth === 1) {
      const v = evalForm(cadr(e), scope);
      if (p.cdr === NIL) tail = v;
      else {
        parts.push(cur);
        parts.push(toArray(v));
        cur = [];
      }
    } else if (e instanceof Cons && e.car === SPLICE) cur.push(list([SPLICE, backquote(cadr(e), scope, depth - 1)]));
    else cur.push(backquote(e, scope, depth));
    p = p.cdr;
  }
  if (p !== NIL) tail = backquote(p, scope, depth);
  parts.push(cur);
  /** @type {LObj} */
  let out = tail;
  for (let i = parts.length - 1; i >= 0; i--) out = list(parts[i], out);
  return out;
}
defSpecial('`', (args, scope) => backquote(car(args), scope, 1));

// argument counts of the special forms Emacs checks
for (const [name, min, max] of /** @type {[string, number, number][]} */ ([
  ['quote', 1, 1], ['function', 1, 1], ['if', 2, -1], ['let', 1, -1], ['let*', 1, -1], ['while', 1, -1], ['catch', 1, -1],
  ['unwind-protect', 1, -1], ['condition-case', 2, -1], ['prog1', 1, -1], ['defvar', 1, 3], ['defconst', 2, 3],
])) {
  const f = intern(name).fn;
  if (f instanceof Special) {
    f.min = min;
    f.max = max;
  }
}

// ---- running ------------------------------------------------------------------------------------

/** Resets the per-run state. @param {{ budget?: number }} [options] */
export function resetRun(options = {}) {
  state.steps = 0;
  state.budget = options.budget ?? 1_000_000;
  state.depth = 0;
  state.outputs = [[]];
  state.messages = [];
  state.catches = [];
}

/** `defvar`-style global setup used by the library. @param {string} name @param {LObj} value */
export function defvarGlobal(name, value) {
  const s = intern(name);
  s.value = value;
  s.special = true;
  return s;
}

/** Registers an error symbol made by `define-error`. @param {string} name @param {string} message @param {string[]} parents */
export function defineError(name, message, parents) {
  /** @type {string[]} */
  const chain = [];
  for (const p of parents) {
    chain.push(p);
    for (const c of conditionsOf(intern(p))) if (!chain.includes(c)) chain.push(c);
  }
  if (!chain.includes('error')) chain.push('error');
  userErrors.set(name, { parents: chain, message });
}

export { Flt, HashTable, bool, equal, print };
