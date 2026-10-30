// @ts-check
/** `pcase` and its relatives, `cl-letf`, and macro expansion of the built-in `when` / `unless`. */
import { Cons, Flt, NIL, Sym, T, equal, intern, list, toArray } from './elisp-data.js';
import { defSpecial, defun, evalForm, funcall, progn, resolvePlace } from './elisp-core.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */
/** @typedef {import('./elisp-data.js').Scope} Scope */

/** @param {string} name */
const S = (name) => intern(name);
const quoteForm = (/** @type {LObj} */ x) => list([S('quote'), x]);
/** @type {(x: LObj) => LObj} */
const car = (x) => (x instanceof Cons ? x.car : NIL);
/** @type {(x: LObj) => LObj} */
const cdr = (x) => (x instanceof Cons ? x.cdr : NIL);

/** The `let` form that binds `binds` and evaluates `body`. @param {[Sym, LObj][]} binds @param {LObj[]} body */
const withBinds = (binds, body) => list([S('let'), list(binds.map(([k, v]) => list([k, quoteForm(v)]))), ...body]);

/**
 * Matches `value` against `pattern`, adding bindings; false when it does not match.
 * @param {LObj} pattern @param {LObj} value @param {[Sym, LObj][]} binds @param {Scope | null} scope @returns {boolean}
 */
function match(pattern, value, binds, scope) {
  if (pattern instanceof Sym) {
    if (pattern === S('_')) return true;
    if (pattern === NIL || pattern === T || pattern.name.startsWith(':')) return value === pattern;
    binds.push([pattern, value]);
    return true;
  }
  if (typeof pattern === 'string' || typeof pattern === 'number' || typeof pattern === 'bigint' || pattern instanceof Flt) return equal(pattern, value);
  if (!(pattern instanceof Cons)) return false;
  const head = pattern.car instanceof Sym ? pattern.car.name : '';
  switch (head) {
    case 'quote': return equal(car(pattern.cdr), value);
    case 'pred': {
      let f = car(pattern.cdr);
      let negate = false;
      if (f instanceof Cons && f.car === S('not')) { negate = true; f = car(f.cdr); }
      /** @type {LObj} */
      let r;
      if (f instanceof Sym) r = funcall(f, [value]);
      else if (f instanceof Cons && f.car === S('lambda')) r = funcall(evalForm(f, scope), [value]);
      else if (f instanceof Cons) r = evalForm(list([...toArray(f), quoteForm(value)]), scope);
      else r = NIL;
      return (r !== NIL) !== negate;
    }
    case 'guard': return evalForm(withBinds(binds, [car(pattern.cdr)]), scope) !== NIL;
    case 'and': return toArray(pattern.cdr).every((p) => match(p, value, binds, scope));
    case 'or': {
      for (const p of toArray(pattern.cdr)) {
        const trial = binds.slice();
        if (match(p, value, trial, scope)) { binds.splice(0, binds.length, ...trial); return true; }
      }
      return false;
    }
    case 'app': {
      const f = car(pattern.cdr);
      const r = f instanceof Sym ? funcall(f, [value]) : f instanceof Cons && f.car === S('lambda') ? funcall(evalForm(f, scope), [value]) : evalForm(list([...toArray(f), quoteForm(value)]), scope);
      return match(car(cdr(pattern.cdr)), r, binds, scope);
    }
    case 'cl-type': return evalForm(list([S('cl-typep'), quoteForm(value), quoteForm(car(pattern.cdr))]), scope) !== NIL;
    case 'let': return match(car(pattern.cdr), evalForm(withBinds(binds, [car(cdr(pattern.cdr))]), scope), binds, scope);
    case '`': return matchQuasi(car(pattern.cdr), value, binds, scope);
    default: return false;
  }
}

/** @param {LObj} q @param {LObj} value @param {[Sym, LObj][]} binds @param {Scope | null} scope @returns {boolean} */
function matchQuasi(q, value, binds, scope) {
  if (q instanceof Cons) {
    if (q.car === S(',')) return match(car(q.cdr), value, binds, scope);
    if (!(value instanceof Cons)) return false;
    return matchQuasi(q.car, value.car, binds, scope) && matchQuasi(q.cdr, value.cdr, binds, scope);
  }
  if (Array.isArray(q)) {
    if (!Array.isArray(value) || value.length !== q.length) return false;
    return q.every((p, i) => matchQuasi(p, value[i], binds, scope));
  }
  return equal(q, value);
}

defSpecial('pcase', (args, scope) => {
  const value = evalForm(car(args), scope);
  for (const clause of toArray(cdr(args))) {
    const binds = /** @type {[Sym, LObj][]} */ ([]);
    if (match(car(clause), value, binds, scope)) return evalForm(withBinds(binds, toArray(cdr(clause)).length ? toArray(cdr(clause)) : [NIL]), scope);
  }
  return NIL;
}, 1);

/** Binds the variables of `pattern` (nil where it does not match). @param {LObj} pattern @param {LObj} value @param {Scope | null} scope */
function destructure(pattern, value, scope) {
  /** @type {[Sym, LObj][]} */
  const binds = [];
  match(pattern, value, binds, scope);
  return binds;
}

for (const sequential of [false, true]) {
  defSpecial(sequential ? 'pcase-let*' : 'pcase-let', (args, scope) => {
    /** @type {[Sym, LObj][]} */
    let all = [];
    for (const b of toArray(car(args))) {
      const pat = car(b);
      const form = car(cdr(b));
      const v = evalForm(sequential ? withBinds(all, [form]) : form, scope);
      all = all.concat(destructure(pat, v, scope));
    }
    return evalForm(withBinds(all, toArray(cdr(args))), scope);
  }, 1);
}

defSpecial('pcase-dolist', (args, scope) => {
  const spec = car(args);
  const pat = car(spec);
  for (const item of toArray(evalForm(car(cdr(spec)), scope))) {
    evalForm(withBinds(destructure(pat, item, scope), toArray(cdr(args))), scope);
  }
  return NIL;
}, 1);

/** @param {boolean} sequential */
const letf = (sequential) => (/** @type {LObj} */ args, /** @type {Scope | null} */ scope) => {
  /** @type {(() => void)[]} */
  const undo = [];
  try {
    /** @type {[ReturnType<typeof resolvePlace>, LObj][]} */
    const pending = [];
    for (const b of toArray(car(args))) {
      const place = car(b);
      const hasValue = cdr(b) !== NIL;
      if (place instanceof Sym) {
        const value = hasValue ? evalForm(car(cdr(b)), scope) : NIL;
        const old = place.value;
        const bound = old !== undefined;
        undo.push(() => { place.value = bound ? old : undefined; });
        place.value = value;
        place.special = true;
        continue;
      }
      const target = resolvePlace(place, scope);
      const value = hasValue ? evalForm(car(cdr(b)), scope) : undefined;
      if (sequential) {
        const old = target.get();
        undo.push(() => target.set(old));
        if (value !== undefined) target.set(value);
      } else pending.push([target, value ?? NIL]);
    }
    for (const [target, value] of pending) {
      const old = target.get();
      undo.push(() => target.set(old));
      target.set(value);
    }
    return progn(cdr(args), scope);
  } finally {
    for (const u of undo.reverse()) u();
  }
};
defSpecial('cl-letf', letf(false), 1);
defSpecial('cl-letf*', letf(true), 1);

// ---- macro expansion of the built-in `when` and `unless`, and `macroexpand-all` ----------------------

/** @param {LObj} form @returns {LObj} */
function expandBuiltin(form) {
  if (!(form instanceof Cons) || !(form.car instanceof Sym)) return form;
  const name = form.car.name;
  if (name === 'when' && form.cdr instanceof Cons) return list([S('if'), form.cdr.car, list([S('progn'), ...toArray(form.cdr.cdr)])]);
  if (name === 'unless' && form.cdr instanceof Cons) return list([S('if'), form.cdr.car, NIL, ...toArray(form.cdr.cdr)]);
  return form;
}
const prevExpand1 = intern('macroexpand-1').fn;
defun('macroexpand-1', 1, 2, ([form, env]) => {
  const e = expandBuiltin(form);
  if (e !== form) return e;
  return funcall(/** @type {LObj} */ (prevExpand1), env === undefined ? [form] : [form, env]);
});
/** @param {LObj} form @returns {LObj} */
function expandAll(form) {
  if (!(form instanceof Cons)) return form;
  const full = funcall(intern('macroexpand'), [form]);
  if (full !== form) return expandAll(full);
  if (form.car === S('quote')) return form;
  if (form.car === S('function')) {
    const f = car(form.cdr);
    return f instanceof Cons && f.car === S('lambda') ? list([S('function'), list([f.car, car(f.cdr), ...toArray(cdr(f.cdr)).map(expandAll)])]) : form;
  }
  /** @type {LObj[]} */
  const out = [];
  /** @type {LObj} */
  let p = form;
  while (p instanceof Cons) { out.push(out.length === 0 ? p.car : expandAll(p.car)); p = p.cdr; }
  return list(out, p);
}
defun('macroexpand-all', 1, 2, ([form]) => expandAll(form));
