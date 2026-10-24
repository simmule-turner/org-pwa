// @ts-check
/**
 * Calc's `simplify` and `esimplify`: a port of math-simplify (calc-alg.el) with the rules for sums, products, quotients, powers,
 * roots, comparisons, exp, ln, log10 and the basic trigonometric functions. Calc edits the expression it is simplifying in place, and
 * the handlers below do the same -- a pointer is an array and an index into it, as a Lisp `(cdr expr)` is -- so the ports can follow
 * the Lisp line by line. The order Calc writes terms in comes out of that, so it is kept exactly (`x + y + x` is `y + 2 x`).
 *
 * Left out: the rules for sec/csc/cot, the hyperbolic and inverse trigonometric functions, the `%` rule, and angles in degrees
 * that are whole multiples of 30 or 45 symbolically (`sin(x + 30)`).
 */

import { I, O, V, VEC, add, sub, mul, div, neg, equal, normalize, compare, combineSum, combineProd, looksNeg, possibleSigns, setSimplifying, isNum, frac, negp, posp, zerop, eqInt, setSimplifier, knownScalar, knownMatrix } from './calc-symbolic.js';

/** @typedef {import('./calc-symbolic.js').Form} Form */
/** A place in an operand list: `(cdr expr)` is { arr: expr.a, i: 0 } and `(cdr (cdr expr))` is { arr: expr.a, i: 1 }. @typedef {{ arr: Form[], i: number }} Ptr */

const state = { dangerous: false };

const isInt = (/** @type {Form} */ a) => a.t === 'int';
const isFrac = (/** @type {Form} */ a) => a.t === 'frac';
const isFlt = (/** @type {Form} */ a) => a.t === 'flt';
const isRat = (/** @type {Form} */ a) => isInt(a) || isFrac(a);
const isOp = (/** @type {Form} */ a, /** @type {string} */ f) => a.t === 'op' && a.f === f;
const isFn = (/** @type {Form} */ a, /** @type {string} */ f) => a.t === 'op' && a.f === f;
const E = V('e');

/** @param {Ptr} p */
const car = (p) => p.arr[p.i];
/** @param {Ptr} p @param {Form} v */
const setcar = (p, v) => void (p.arr[p.i] = v);
/** @param {Form} node the operands of a node */
const operands = (node) => ({ arr: node.a, i: 0 });
/** @param {Ptr} p @param {Ptr} q */
const samePtr = (p, q) => p.arr === q.arr && p.i === q.i;

// ---------------------------------------------------------------------------------------------------------------------------------
// Small pieces of Calc's arithmetic the rules lean on
// ---------------------------------------------------------------------------------------------------------------------------------

/** @param {Form} a @returns {Form} */
function mathAbs(a) {
  return negp(a) ? neg(a) : a;
}

/** @param {bigint} a @param {bigint} b @returns {bigint} */
function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

/** math-to-simple-fraction: a float that is a whole number or a short decimal, as the fraction it is. @param {Form} f @returns {Form} */
export function toSimpleFraction(f) {
  if (isFlt(f)) {
    if (f.e >= 0) return I(f.m * 10n ** BigInt(f.e));
    if (f.m > -1000n && f.m < 1000n) return frac(f.m, 10n ** BigInt(-f.e));
  }
  return f;
}

/** math-frac-gcd. @param {Form} a @param {Form} b @returns {Form} */
function fracGcd(a, b) {
  if (zerop(a)) return b;
  if (zerop(b)) return a;
  if (isInt(a) && isInt(b)) return I(gcd(a.v, b.v));
  if (isInt(a)) a = { t: 'frac', n: a.v, d: 1n };
  if (isInt(b)) b = { t: 'frac', n: b.v, d: 1n };
  return frac(gcd(a.n, b.n), gcd(a.d, b.d));
}

/** math-common-constant-factor: the number every term of the expression is a multiple of, or null. @param {Form} expr @returns {Form | null} */
function commonConstantFactor(expr) {
  if (isNum(expr)) {
    if (isRat(expr)) return eqInt(expr, 0) || eqInt(expr, 1) || eqInt(expr, -1) ? null : mathAbs(expr);
    const simple = toSimpleFraction(expr);
    return isRat(simple) ? commonConstantFactor(simple) : null;
  }
  if (expr.t !== 'op') return null;
  if (expr.f === '+' || expr.f === '-') {
    const f1 = commonConstantFactor(expr.a[0]);
    const f2 = commonConstantFactor(expr.a[1]);
    if (!f1 || !f2) return null;
    const g = fracGcd(f1, f2);
    return eqInt(g, 1) && isInt(g) ? null : g;
  }
  if (expr.f === '*') return commonConstantFactor(expr.a[0]);
  if (expr.f === '/') return commonConstantFactor(expr.a[0]) || (isInt(expr.a[1]) ? frac(1n, mathAbs(expr.a[1]).v) : null);
  return null;
}

/** math-cancel-common-factor: divides `val` out of the expression, in place for a sum. @param {Form} expr @param {Form} val @returns {Form} */
function cancelCommonFactor(expr, val) {
  if (expr.t === 'op' && (expr.f === '+' || expr.f === '-')) {
    expr.a[0] = cancelCommonFactor(expr.a[0], val);
    expr.a[1] = cancelCommonFactor(expr.a[1], val);
    return expr;
  }
  if (isOp(expr, '*')) return mul(cancelCommonFactor(expr.a[0], val), expr.a[1]);
  return div(expr, val);
}

/** math-expr-contains. @param {Form} expr @param {Form} thing @returns {boolean} */
function contains(expr, thing) {
  if (equal(expr, thing)) return true;
  if (expr.t === 'op') return expr.a.some((/** @type {Form} */ x) => contains(x, thing));
  if (expr.t === 'vec') return expr.items.some((/** @type {Form} */ x) => contains(x, thing));
  if (expr.t === 'intv') return contains(expr.lo, thing) || contains(expr.hi, thing);
  return false;
}

/** math-known-scalarp: with `assume`, anything not known to be a matrix passes. @param {Form} a @param {boolean} [assume] */
const knownScalarp = (a, assume = false) => (assume ? !knownMatrix(a) : knownScalar(a));

/** math-known-negp, math-known-realp. @param {Form} a */
const knownNegp = (a) => possibleSigns(a) === 1;
/** @param {Form} a */
const knownRealp = (a) => possibleSigns(a) < 8;

/** Is the name an operator (rather than a function, which Calc names calcFunc-NAME)? @param {string} f */
const orderName = (f) => (['+', '-', '*', '/', '^', '%', 'neg', 'vec'].includes(f) ? f : `calcFunc-${f}`);

/** Math-objectp: a number, interval or complex number. @param {Form} a */
const isObject = (a) => isNum(a) || a.t === 'intv' || a.t === 'cplx';

/** math-beforep: does `a` come before `b` in Calc's order of expressions. @param {Form} a @param {Form} b @returns {boolean} */
function beforep(a, b) {
  if (isNum(a) && isNum(b)) {
    const comp = compare(a, b);
    return comp === -1 || (comp === 0 && !equal(a, b) && rank(a) > rank(b));
  }
  const negInf = O('neg', V('inf'));
  if (equal(b, negInf)) return false;
  if (equal(a, negInf)) return true;
  if (equal(a, V('inf'))) return false;
  if (equal(b, V('inf'))) return true;
  if (isNum(a)) {
    if (b.t === 'intv' && isNum(b.lo) && isNum(b.hi)) return beforep(a, b.lo) || compare(a, b.lo) === 0;
    return true;
  }
  if (isNum(b)) {
    if (a.t === 'intv' && isNum(a.lo) && isNum(a.hi)) return beforep(a.lo, b);
    return false;
  }
  if (a.t === 'intv' && b.t === 'intv' && isNum(a.lo) && isNum(a.hi) && isNum(b.lo) && isNum(b.hi)) {
    let comp = compare(a.lo, b.lo);
    if (comp === -1) return true;
    if (comp === 1) return false;
    if (a.mask & 2 && !(b.mask & 2)) return true;
    if (!(a.mask & 2) && b.mask & 2) return false;
    comp = compare(a.hi, b.hi);
    if (comp === -1) return true;
    if (comp === 1) return false;
    return !!(!(a.mask & 1) && b.mask & 1);
  }
  if (isObject(a) !== isObject(b)) return isObject(a);
  if (a.t === 'var') return b.t === 'var' ? a.name < b.name : !isNum(b);
  if (b.t === 'var') return isNum(a);
  const headA = a.t === 'op' ? a.f : a.t;
  const headB = b.t === 'op' ? b.f : b.t;
  if (headA === headB) {
    const xs = a.t === 'op' ? a.a : a.t === 'vec' ? a.items : [];
    const ys = b.t === 'op' ? b.a : b.t === 'vec' ? b.items : [];
    let i = 0;
    while (i < xs.length && i < ys.length && equal(xs[i], ys[i])) i++;
    if (i >= ys.length) return false;
    return i >= xs.length || beforep(xs[i], ys[i]);
  }
  return orderName(headA) < orderName(headB);
}
/** Calc compares an integer, a fraction and a float of the same value by this: integers first. @param {Form} a */
const rank = (a) => (isInt(a) ? 3 : isFrac(a) ? 2 : 1);

/** calc-tweak-eqn-table: the comparison with its sides swapped. */
const TWEAK = /** @type {Record<string, string>} */ ({ eq: 'eq', neq: 'neq', lt: 'gt', gt: 'lt', leq: 'geq', geq: 'leq' });

// ---------------------------------------------------------------------------------------------------------------------------------
// The rules, one per function (math-defsimplify)
// ---------------------------------------------------------------------------------------------------------------------------------

/** (math-defsimplify (+ -) ...) @param {Form} expr @returns {Form} */
function simplifySum(expr) {
  const first = expr.a[0];
  if (first.t === 'op' && (first.f === '+' || first.f === '-') && isNum(first.a[1]) && !isNum(expr.a[1])) {
    // (p +- n) op x becomes (p op x) +- n: the number goes to the end
    const x = expr.a[1];
    const op = expr.f;
    expr.a[1] = first.a[1];
    expr.f = first.f;
    first.a[1] = x;
    first.f = op;
  } else if (expr.f === '+' && isNum(expr.a[0]) && !isNum(expr.a[1])) {
    [expr.a[0], expr.a[1]] = [expr.a[1], expr.a[0]];
  }
  let aa = expr;
  let aaa;
  let temp;
  while ((aaa = aa.a[0]).t === 'op' && (aaa.f === '+' || aaa.f === '-')) {
    if ((temp = combineSum(aaa.a[1], expr.a[1], aaa.f === '-', expr.f === '-', true))) {
      expr.a[1] = temp;
      expr.f = '+';
      aaa.a[1] = I(0);
    }
    aa = aa.a[0];
  }
  if ((temp = combineSum(aaa, expr.a[1], false, expr.f === '-', true))) {
    expr.a[1] = temp;
    expr.f = '+';
    aa.a[0] = I(0);
  }
  return expr;
}

/** (math-defsimplify * ...) @param {Form} expr @returns {Form} */
function simplifyProduct(expr) {
  if (isOp(expr.a[1], '*')) {
    if (beforep(expr.a[1].a[0], expr.a[0]) && (knownScalarp(expr.a[0], true) || knownScalarp(expr.a[1].a[0], true))) {
      const x = expr.a[0];
      expr.a[0] = expr.a[1].a[0];
      expr.a[1].a[0] = x;
    }
  } else if (beforep(expr.a[1], expr.a[0]) && (knownScalarp(expr.a[0], true) || knownScalarp(expr.a[1], true))) {
    [expr.a[0], expr.a[1]] = [expr.a[1], expr.a[0]];
  }
  let aa = expr;
  let aaa;
  let temp;
  let safe = true;
  const scalar = knownScalarp(expr.a[0]);
  if (isRat(expr.a[0]) && (temp = commonConstantFactor(expr.a[1]))) {
    expr.a[1] = cancelCommonFactor(expr.a[1], temp);
    expr.a[0] = mul(expr.a[0], temp);
  }
  while (isOp((aaa = aa.a[1]), '*') && safe) {
    if ((temp = combineProd(expr.a[0], aaa.a[0], false, false, true))) {
      expr.a[0] = temp;
      aaa.a[0] = I(1);
    }
    safe = scalar || knownScalarp(aaa.a[0], true);
    aa = aa.a[1];
  }
  temp = combineProd(aaa, expr.a[0], false, false, true);
  if (temp && safe) {
    expr.a[0] = temp;
    aa.a[1] = I(1);
  }
  if (isFrac(expr.a[0]) && (expr.a[0].n === 1n || expr.a[0].n === -1n)) return div(mul(expr.a[1], I(expr.a[0].n)), I(expr.a[0].d));
  return expr;
}

/** @param {Form} expr @returns {Form} */
function simplifyQuotient(expr) {
  return simplifyDivide(expr);
}

/** math-simplify-divide: also used for the two sides of a comparison, where the common factor of both goes. @param {Form} expr @returns {Form} */
function simplifyDivide(expr) {
  let np = operands(expr);
  let nover = false;
  const isDivision = expr.f === '/';
  const nn = isDivision || !isNum(expr.a[1]) ? commonConstantFactor(expr.a[1]) : null;
  let n;
  if (nn) {
    n = isDivision || !isNum(expr.a[0]) ? commonConstantFactor(expr.a[0]) : null;
    if (isFrac(nn) && nn.n === 1n && !n) {
      if (!(expr.f === 'eq' && expr.a[0].t === 'var' && !contains(expr.a[1], expr.a[0]))) {
        expr.a[0] = mul(I(nn.d), expr.a[0]);
        expr.a[1] = cancelCommonFactor(expr.a[1], nn);
        if (negp(nn) && TWEAK[expr.f]) expr.f = TWEAK[expr.f];
      }
    } else if (n) {
      n = fracGcd(n, nn);
      if (!(eqInt(n, 1) && isInt(n))) {
        expr.a[0] = cancelCommonFactor(expr.a[0], n);
        expr.a[1] = cancelCommonFactor(expr.a[1], n);
        if (negp(n) && TWEAK[expr.f]) expr.f = TWEAK[expr.f];
      }
    }
  }
  const dp = { arr: expr.a, i: 1 };
  const divideExpr = expr;
  if (isOp(car(np), '/') && knownScalarp(expr.a[1], true)) {
    np = operands(expr.a[0]);
    while (isOp((n = car(np)), '*')) {
      if (knownScalarp(n.a[1], true)) simplifyDivisor(divideExpr, operands(n), dp, false, true);
      np = { arr: n.a, i: 1 };
    }
    simplifyDivisor(divideExpr, np, dp, false, true);
    nover = true;
    np = { arr: expr.a[0].a, i: 1 };
  }
  while (isOp((n = car(np)), '*')) {
    if (knownScalarp(n.a[1], true)) simplifyDivisor(divideExpr, operands(n), dp, nover, true);
    np = { arr: n.a, i: 1 };
  }
  simplifyDivisor(divideExpr, np, dp, nover, true);
  return expr;
}

/** math-simplify-divisor: cancels factors of the denominator against those of the numerator. @param {Form} divideExpr @param {Ptr} np @param {Ptr} dp @param {boolean} nover @param {boolean} dover */
function simplifyDivisor(divideExpr, np, dp, nover, dover) {
  const head = car(dp);
  if (isOp(head, '/')) {
    simplifyDivisor(divideExpr, np, operands(head), nover, dover);
    if (knownScalarp(head.a[0], true)) simplifyDivisor(divideExpr, np, { arr: head.a, i: 1 }, nover, !dover);
    return;
  }
  const signs = possibleSigns(car(np));
  const allowed = divideExpr.f === '/' || signs === 1 || signs === 4 || ((divideExpr.f === 'eq' || divideExpr.f === 'neq') && signs === 5) || state.dangerous || isNum(car(np));
  if (!allowed) return;
  let d;
  let safe = true;
  const scalar = knownScalarp(car(np));
  while (isOp((d = car(dp)), '*') && safe) {
    simplifyOneDivisor(divideExpr, np, operands(d), nover, dover);
    safe = scalar || knownScalarp(d.a[0], true);
    dp = { arr: d.a, i: 1 };
  }
  if (safe) simplifyOneDivisor(divideExpr, np, dp, nover, dover);
}

/** @param {Form} divideExpr @param {Ptr} np @param {Ptr} dp @param {boolean} nover @param {boolean} dover */
function simplifyOneDivisor(divideExpr, np, dp, nover, dover) {
  const temp = combineProd(car(np), car(dp), nover, dover, true);
  if (temp) {
    if (!['/', 'eq', 'neq'].includes(divideExpr.f) && knownNegp(car(dp)) && TWEAK[divideExpr.f]) divideExpr.f = TWEAK[divideExpr.f];
    setcar(np, nover ? div(I(1), temp) : temp);
    setcar(dp, I(1));
  } else if (dover && !nover && divideExpr.f === '/' && isFn(car(dp), 'sqrt') && isInt(car(dp).a[0])) {
    setcar(np, mul(car(np), O('sqrt', car(dp).a[0])));
    setcar(dp, car(dp).a[0]);
  }
}

/** (math-defsimplify (eq neq lt gt leq geq) ...) @param {Form} expr @returns {Form | null} */
function simplifyComparison(expr) {
  if (expr.a.length !== 2) return null;
  return simplifyInequality(expr);
}

/** math-simplify-ineq: moves like terms from both sides together and cancels a common factor. @param {Form} expr @returns {Form} */
function simplifyInequality(expr) {
  let np = operands(expr);
  let n;
  while ((n = car(np)).t === 'op' && (n.f === '+' || n.f === '-')) {
    simplifyAddTerm({ arr: n.a, i: 1 }, { arr: expr.a, i: 1 }, n.f === '-', false);
    np = operands(n);
  }
  simplifyAddTerm(np, { arr: expr.a, i: 1 }, false, samePtr(np, operands(expr)));
  simplifyDivide(expr);
  const signs = possibleSigns(O('-', expr.a[0], expr.a[1]));
  /** @type {number | null} */ let result;
  switch (expr.f) {
    case 'eq':
      result = signs === 2 ? 1 : [1, 4, 5].includes(signs) ? 0 : null;
      break;
    case 'neq':
      result = signs === 2 ? 0 : [1, 4, 5].includes(signs) ? 1 : null;
      break;
    case 'lt':
      result = signs === 1 ? 1 : [2, 4, 6].includes(signs) ? 0 : null;
      break;
    case 'gt':
      result = signs === 4 ? 1 : [1, 2, 3].includes(signs) ? 0 : null;
      break;
    case 'leq':
      result = signs === 4 ? 0 : [1, 2, 3].includes(signs) ? 1 : null;
      break;
    default:
      result = signs === 1 ? 0 : [2, 4, 6].includes(signs) ? 1 : null;
      break;
  }
  return result === null ? expr : I(result);
}

/** math-simplify-add-term. @param {Ptr} np @param {Ptr} dp @param {boolean} minus @param {boolean} lplain */
function simplifyAddTerm(np, dp, minus, lplain) {
  if (car(np).t === 'vec') return;
  let rplain = true;
  let temp;
  while (car(dp).t === 'op' && (car(dp).f === '+' || car(dp).f === '-')) {
    const d = car(dp);
    rplain = false;
    if ((temp = combineSum(car(np), d.a[1], minus, d.f === '+', true))) {
      if (lplain || looksNeg(temp) === minus) {
        setcar(np, minus ? neg(temp) : temp);
        d.a[1] = I(0);
      } else {
        setcar(np, I(0));
        d.a[1] = d.f === '+' ? neg(temp) : temp;
      }
    }
    dp = operands(d);
  }
  if ((temp = combineSum(car(np), car(dp), minus, true, true))) {
    if (lplain || (!rplain && looksNeg(temp) === minus)) {
      setcar(np, minus ? neg(temp) : temp);
      setcar(dp, I(0));
    } else {
      setcar(np, I(0));
      setcar(dp, neg(temp));
    }
  }
}

/** math-quarter-integer: 0 to 3 when the number is a whole number of quarters (the quarters over the whole number), else null. @param {Form} x @returns {number | null} */
function quarterInteger(x) {
  if (isInt(x)) return 0;
  if (negp(x)) {
    const q = quarterInteger(neg(x));
    return q === null ? null : 4 - q;
  }
  if (isFrac(x)) {
    if (x.d === 2n) return 2;
    return x.d === 4n ? Number(x.n % 4n) : null;
  }
  if (isFlt(x)) {
    if (x.e >= 0) return 0;
    if (x.e === -1) return x.m % 10n === 5n ? 2 : null;
    if (x.e === -2) {
      const r = x.m % 100n;
      return r === 25n ? 1 : r === 75n ? 3 : null;
    }
  }
  return null;
}

/** math-squared-factor: the largest square among the first ten prime squares that divides the integer. @param {Form} x @returns {Form | null} */
function squaredFactor(x) {
  if (!isInt(x)) return null;
  let v = x.v;
  let fac = 1n;
  for (const sq of [4n, 9n, 25n, 49n, 121n, 169n, 289n, 361n, 529n, 841n]) {
    while (v % sq === 0n) {
      v /= sq;
      fac *= sq;
    }
  }
  return I(fac);
}

/** math-simplify-sqrt. @param {Form} expr @returns {Form | null} */
function simplifySqrt(expr) {
  const arg = expr.a[0];
  if (isFrac(arg)) return div(O('sqrt', mul(I(arg.n), I(arg.d))), I(arg.d));
  const fac = isObject(arg) ? squaredFactor(arg) : commonConstantFactor(arg);
  if (fac && !(isInt(fac) && fac.v === 1n)) return mul(normalize(O('sqrt', fac)), normalize(O('sqrt', cancelCommonFactor(arg, fac))));
  if (state.dangerous) {
    if (isOp(arg, '^')) return O('^', arg.a[0], div(arg.a[1], I(2)));
    if (isFn(arg, 'sqrt')) return O('^', arg.a[0], div(I(1), I(4)));
    if (arg.t === 'op' && (arg.f === '*' || arg.f === '/')) return O(arg.f, O('sqrt', arg.a[0]), O('sqrt', arg.a[1]));
  }
  return null;
}

/** math-simplify-exp. @param {Form} x @returns {Form | null} */
function simplifyExp(x) {
  return isFn(x, 'ln') ? x.a[0] : null;
}

/** (math-defsimplify ^ ...) @param {Form} expr @returns {Form | null} */
function simplifyPower(expr) {
  const [base, exponent] = expr.a;
  if (state.dangerous) {
    if (isOp(base, '^')) return O('^', base.a[0], mul(exponent, base.a[1]));
    if (isFn(base, 'sqrt')) return O('^', base.a[0], div(exponent, I(2)));
    if (base.t === 'op' && (base.f === '*' || base.f === '/')) return O(base.f, O('^', base.a[0], exponent), O('^', base.a[1], exponent));
  }
  if (eqInt(base, 10) && isFn(exponent, 'log10')) return exponent.a[0];
  if (equal(base, E)) {
    const r = simplifyExp(exponent);
    if (r) return r;
  }
  if (isFn(base, 'exp')) return O('exp', mul(base.a[0], exponent));
  if (isFrac(exponent) && isRat(base) && posp(base)) {
    if (equal(exponent, frac(1n, 2n))) return O('sqrt', base);
    const flr = floorRat(exponent);
    if (flr !== 0n) return O('*', O('^', base, I(flr)), O('^', base, sub(exponent, I(flr))));
  }
  if (quarterInteger(exponent) === 2) {
    const temp = simplifySqrt(expr);
    if (temp) return O('^', temp, mul(exponent, I(2)));
  }
  return null;
}

/** @param {Form} f a fraction @returns {bigint} */
function floorRat(f) {
  const n = /** @type {bigint} */ (f.n);
  const d = /** @type {bigint} */ (f.d);
  const q = n / d;
  return n < 0n && n % d !== 0n ? q - 1n : q;
}

/** @param {string} name @returns {(expr: Form) => Form | null} the rule for sin, cos or tan: the odd and even symmetries and the inverse functions */
function trigRule(name) {
  /** @type {Record<string, [string, (x: Form) => Form, (x: Form) => Form]>} */
  const inverse = {
    sin: ['arcsin', (x) => x, (x) => O('sqrt', sub(I(1), mul(x, x)))],
    cos: ['arccos', (x) => x, (x) => O('sqrt', sub(I(1), mul(x, x)))],
    tan: ['arctan', (x) => x, (x) => x],
  };
  return (expr) => {
    const arg = expr.a[0];
    if (isFn(arg, inverse[name][0])) return arg.a[0];
    if (looksNeg(arg)) return name === 'cos' ? O('cos', neg(arg)) : neg(O(name, neg(arg)));
    const other = { sin: ['arccos', 'arctan'], cos: ['arcsin', 'arctan'], tan: ['arcsin', 'arccos'] }[name];
    const x = arg.t === 'op' && arg.a.length === 1 ? arg.a[0] : null;
    if (!x) return null;
    const root = O('sqrt', sub(I(1), mul(x, x)));
    const hyp = O('sqrt', add(I(1), mul(x, x)));
    if (name === 'sin') {
      if (isFn(arg, 'arccos')) return root;
      if (isFn(arg, 'arctan')) return div(x, hyp);
    } else if (name === 'cos') {
      if (isFn(arg, 'arcsin')) return root;
      if (isFn(arg, 'arctan')) return div(I(1), hyp);
    } else if (isFn(arg, 'arcsin')) return div(x, root);
    else if (isFn(arg, 'arccos')) return div(root, x);
    return other ? null : null;
  };
}

/** @type {Record<string, ((expr: Form) => Form | null)[]>} */
const HANDLERS = {
  '+': [simplifySum],
  '-': [simplifySum],
  '*': [simplifyProduct],
  '/': [simplifyQuotient],
  eq: [simplifyComparison],
  neq: [simplifyComparison],
  lt: [simplifyComparison],
  gt: [simplifyComparison],
  leq: [simplifyComparison],
  geq: [simplifyComparison],
  '^': [simplifyPower],
  sqrt: [simplifySqrt],
  exp: [(expr) => simplifyExp(expr.a[0])],
  ln: [
    (expr) => {
      const x = expr.a[0];
      if (isFn(x, 'exp') && (state.dangerous || knownRealp(x.a[0]))) return x.a[0];
      if (isOp(x, '^') && equal(x.a[0], E) && (state.dangerous || knownRealp(x.a[1]))) return x.a[1];
      return null;
    },
  ],
  log10: [
    (expr) => {
      const x = expr.a[0];
      return isOp(x, '^') && eqInt(x.a[0], 10) && (state.dangerous || knownRealp(x.a[1])) ? x.a[1] : null;
    },
  ],
  sin: [trigRule('sin')],
  cos: [trigRule('cos')],
  tan: [trigRule('tan')],
};

// ---------------------------------------------------------------------------------------------------------------------------------
// The driver (math-simplify, math-simplify-step)
// ---------------------------------------------------------------------------------------------------------------------------------

/** @param {Form} a @returns {boolean} math-primp */
const isPrimitive = (a) => a.t === 'int' || a.t === 'flt' || a.t === 'frac' || a.t === 'var';

/** math-simplify-step: simplifies the arguments, then applies the rules to the node until one changes it. @param {Form} a @returns {Form} */
function step(a) {
  if (isPrimitive(a)) return a;
  /** @type {Form} */ let aa;
  if (a.t === 'vec') aa = VEC(a.items.map(step));
  else if (a.t === 'intv') aa = { ...a, lo: step(a.lo), hi: step(a.hi) };
  else if (a.t === 'cplx') aa = { ...a, re: step(a.re), im: step(a.im) };
  else aa = { ...a, a: a.a.map(step) };
  if (aa.t !== 'op') return aa;
  for (const handler of HANDLERS[aa.f] || []) {
    aa = handler(aa) || aa;
    if (!equal(aa, a)) break;
  }
  return aa;
}

/**
 * Calc's simplify (`dangerous` is esimplify, which also uses the rules that hold only for most values).
 * @param {Form} top @param {boolean} [dangerous] @returns {Form}
 */
export function simplify(top, dangerous = false) {
  const saved = state.dangerous;
  state.dangerous = dangerous;
  setSimplifying(true);
  try {
    for (let rounds = 0; rounds < 200; rounds++) {
      const res = step(normalize(top));
      if (equal(top, res)) break;
      top = res;
    }
    return top;
  } finally {
    setSimplifying(false);
    state.dangerous = saved;
  }
}

setSimplifier(simplify);
