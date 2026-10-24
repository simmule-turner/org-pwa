// @ts-check
/**
 * deriv and tderiv: a port of Calc's `math-derivative` (calcalg2.el). The rules build the result without simplifying, as Calc does, and
 * the final normalization produces the printed form. Functions Calc has no rule for come back as `f'(x)`.
 */

import { I, O, F, V, VEC, add, sub, mul, div, neg, equal, normalize, zerop, registerFunction, angleIsDegrees, SymbolicUnsupported } from './calc-symbolic.js';
import { subst } from './calc-solve.js';

/** @typedef {import('./calc-symbolic.js').Form} Form */

const CONSTANT_VARS = new Set(['pi', 'e', 'inf', 'uinf', 'nan']);
const COMPARISONS = new Set(['eq', 'neq', 'lt', 'gt', 'leq', 'geq']);

/** @param {Form} a @returns {Form} */
const sqr = (a) => mul(a, a);
const PI = V('pi');

/** math-to-radians-2 with force-symbolic. @param {Form} a @returns {Form} */
function toRadians(a) {
  return angleIsDegrees() ? div(mul(a, PI), I(180)) : a;
}

/** math-from-radians-2 with force-symbolic. @param {Form} a @returns {Form} */
function fromRadians(a) {
  return angleIsDegrees() ? div(mul(I(180), a), PI) : a;
}

/** @param {string} f @param {Form} u @returns {Form} */
const call = (f, u) => normalize(O(f, u));

/** The one-argument rules: name to the derivative with respect to the argument. @type {Record<string, (u: Form) => Form>} */
const RULES = {
  inv: (u) => neg(div(I(1), sqr(u))),
  sqrt: (u) => div(I(1), mul(I(2), O('sqrt', u))),
  deg: () => div(F(180), F(Math.PI)),
  rad: () => div(F(Math.PI), F(180)),
  ln: (u) => div(I(1), u),
  log10: (u) => div(div(I(1), call('ln', I(10))), u),
  lnp1: (u) => div(I(1), add(u, I(1))),
  exp: (u) => call('exp', u),
  expm1: (u) => call('expm1', u),
  sin: (u) => toRadians(call('cos', u)),
  cos: (u) => neg(toRadians(call('sin', u))),
  tan: (u) => toRadians(sqr(call('sec', u))),
  sec: (u) => toRadians(mul(call('sec', u), call('tan', u))),
  csc: (u) => neg(toRadians(mul(call('csc', u), call('cot', u)))),
  cot: (u) => neg(toRadians(sqr(call('csc', u)))),
  arcsin: (u) => fromRadians(div(I(1), call('sqrt', sub(I(1), sqr(u))))),
  arccos: (u) => fromRadians(div(I(-1), call('sqrt', sub(I(1), sqr(u))))),
  arctan: (u) => fromRadians(div(I(1), add(I(1), sqr(u)))),
  sinh: (u) => call('cosh', u),
  cosh: (u) => call('sinh', u),
  tanh: (u) => sqr(call('sech', u)),
  sech: (u) => neg(mul(call('sech', u), call('tanh', u))),
  csch: (u) => neg(mul(call('csch', u), call('coth', u))),
  coth: (u) => neg(sqr(call('csch', u))),
  arcsinh: (u) => div(I(1), call('sqrt', add(sqr(u), I(1)))),
  arccosh: (u) => div(I(1), call('sqrt', add(sqr(u), I(-1)))),
  arctanh: (u) => div(I(1), sub(I(1), sqr(u))),
};

/** The two-argument `log` rules, by the argument being differentiated. @type {Array<(x: Form, b: Form) => Form | null>} */
const LOG_RULES = [
  (x, b) => (zerop(b) ? null : div(I(1), mul(call('ln', b), x))),
  (x, b) => neg(div(O('log', x, b), mul(O('ln', b), b))),
];

/**
 * @param {Form} expr @param {Form} v the variable @param {boolean} total whether other variables may depend on it (tderiv)
 * @returns {Form}
 */
function derivative(expr, v, total) {
  const d = (/** @type {Form} */ e) => derivative(e, v, total);
  if (equal(expr, v)) return I(1);
  if (expr.t === 'int' || expr.t === 'flt' || expr.t === 'frac' || expr.t === 'cplx') return I(0);
  if (expr.t === 'var') return !total || CONSTANT_VARS.has(expr.name) ? I(0) : O('tderiv', expr, v);
  if (expr.t === 'vec') return VEC(expr.items.map(d));
  if (expr.t !== 'op') throw new SymbolicUnsupported('derivative of this form');
  const a = expr.a;
  switch (expr.f) {
    case '+': return add(d(a[0]), d(a[1]));
    case '-': return sub(d(a[0]), d(a[1]));
    case 'neg': return neg(d(a[0]));
    case '*': return add(mul(a[1], d(a[0])), mul(a[0], d(a[1])));
    case '/': return sub(div(d(a[0]), a[1]), div(mul(a[0], d(a[1])), sqr(a[1])));
    case '%': return d(a[0]);
    case '^': {
      let du = d(a[0]);
      let dv = d(a[1]);
      if (!zerop(du)) du = mul(a[1], mul(normalize(O('^', a[0], add(a[1], I(-1)))), du));
      if (!zerop(dv)) dv = mul(normalize(O('ln', a[0])), mul(expr, dv));
      return add(du, dv);
    }
    default:
  }
  if (COMPARISONS.has(expr.f)) return O(expr.f, d(a[0]), d(a[1]));
  if ((expr.f === 'conj' || expr.f === 're' || expr.f === 'im') && a.length === 1) return O(expr.f, d(a[0]));
  if (expr.f === 'subscr' || expr.f === 'mrow' || expr.f === 'mcol') throw new SymbolicUnsupported('derivative of an element');
  let accum = I(0);
  a.forEach((/** @type {Form} */ arg, /** @type {number} */ i) => {
    const derv = d(arg);
    if (zerop(derv)) return;
    const n = i + 1;
    const rule = a.length === 1 ? RULES[expr.f] : expr.f === 'log' && a.length === 2 ? LOG_RULES[i] : null;
    const handled = rule ? (a.length === 1 ? /** @type {(u: Form) => Form} */ (rule)(a[0]) : /** @type {(x: Form, b: Form) => Form | null} */ (rule)(a[0], a[1])) : null;
    accum = add(accum, mul(derv, handled ?? O(`${expr.f}'${n > 1 ? n : ''}`, ...a)));
  });
  return accum;
}

/** @param {boolean} total @returns {(args: Form[]) => Form | null} */
function derivCall(total) {
  return (args) => {
    if (args.length < 2 || args.length > 3 || args[1].t === 'int') return null;
    const [expr, v, value] = args;
    const name = total ? 'tderiv' : 'deriv';
    let res = derivative(expr, v, total);
    if (!(res.t === 'op' && res.f === name)) res = normalize(res);
    return value ? subst(res, v, value) : res;
  };
}

registerFunction('deriv', derivCall(false));
registerFunction('tderiv', derivCall(true));
