// @ts-check
/**
 * Calc's `solve` and `fsolve` (calcalg2.el): an equation solved for one variable, or a system of equations for several. A port of
 * math-try-solve-for with the rules that cover linear and quadratic polynomials, products, quotients, powers, roots and the inverse
 * functions. `solve` takes the positive root where an equation has two (as Calc does with symbolic mode off); `fsolve` writes the
 * choice as a sign variable `s1` and the whole numbers a periodic solution needs as `n1`.
 *
 * Left out: cubic and quartic polynomials, polynomials in an expression other than the variable itself (`(x+1)^2 + 1 = 5` is solved as a
 * quadratic in x), negative and fractional powers of the variable in a sum, and `roots`. An equation Calc can solve but this cannot is
 * reported as unsupported rather than left as `solve(...)`.
 */

import { I, O, V, VEC, F, frac, add, sub, mul, div, neg, pow, equal, normalize, callFunction, possibleSigns, isNum, zerop, eqInt, negp, looksNeg, registerFunction, SymbolicUnsupported } from './calc-symbolic.js';
import { simplify } from './calc-simplify.js';

/** @typedef {import('./calc-symbolic.js').Form} Form */

const state = {
  /** @type {Form} */ v: null,
  full: false,
  /** @type {number | null} */ sign: null,
  signCount: 0,
  intCount: 0,
};

const isOp = (/** @type {Form} */ a, /** @type {string} */ f) => a.t === 'op' && a.f === f;
const isInt = (/** @type {Form} */ a) => a.t === 'int';
const sqr = (/** @type {Form} */ a) => mul(a, a);

/** math-expr-contains: does `target` occur anywhere in `expr`. @param {Form} expr @param {Form} target @returns {boolean} */
function contains(expr, target) {
  if (equal(expr, target)) return true;
  if (expr.t === 'vec') return expr.items.some((/** @type {Form} */ x) => contains(x, target));
  if (expr.t === 'op') return expr.a.some((/** @type {Form} */ x) => contains(x, target));
  if (expr.t === 'intv') return contains(expr.lo, target) || contains(expr.hi, target);
  if (expr.t === 'cplx') return contains(expr.re, target) || contains(expr.im, target);
  return false;
}

/** math-expr-subst: the replacement is not simplified. @param {Form} expr @param {Form} old @param {Form} repl @returns {Form} */
function subst(expr, old, repl) {
  if (equal(expr, old)) return repl;
  if (expr.t === 'vec') return VEC(expr.items.map((/** @type {Form} */ x) => subst(x, old, repl)));
  if (expr.t === 'op') return { ...expr, a: expr.a.map((/** @type {Form} */ x) => subst(x, old, repl)) };
  return expr;
}

const hasVar = (/** @type {Form} */ e) => contains(e, state.v);

/** math-solve-sign: what an inequality's direction does when both sides are divided by `expr`. @param {number | null} sign @param {Form} expr @returns {number | null} */
function solveSign(sign, expr) {
  if (sign === null) return null;
  const s = possibleSigns(expr);
  if (s === 4 || s === 6) return sign;
  if (s === 1 || s === 3) return -sign;
  return null;
}

/** math-solve-get-sign: the choice between a root and its negative. @param {Form} val @returns {Form} */
function getSign(val) {
  if (val.t !== 'cplx') val = simplify(val);
  if (isOp(val, '*') && isNum(val.a[0])) return O('*', val.a[0], getSign(val.a[1]));
  if (isOp(val, 'sqrt') && isOp(val.a[0], '^')) val = normalize(O('^', val.a[0].a[0], div(val.a[0].a[1], I(2))));
  if (!state.full) return val;
  state.signCount++;
  const s = V(`s${state.signCount}`);
  return val.t === 'cplx' ? O('*', val, s) : mul(s, val);
}

/** math-solve-get-int: the whole number in a periodic solution; 0 when only one solution is wanted. @param {Form} val @returns {Form} */
function getInt(val) {
  if (!state.full) return I(0);
  state.intCount++;
  return mul(val, V(`n${state.intCount}`));
}

/** @param {Form} x @returns {boolean} whether a complex number is in the form (the engine does not compute with them) */
function hasComplex(x) {
  if (x.t === 'cplx') return true;
  return x.t === 'op' && x.a.some(hasComplex);
}

/** The square root as Calc normalizes it, complex for a negative number. @param {Form} x @returns {Form} */
function sqrtOf(x) {
  if (isNum(x) && negp(x)) {
    const root = callFunction('sqrt', [neg(x)]);
    return { t: 'cplx', re: root.t === 'flt' ? F(0) : I(0), im: root };
  }
  return normalize(O('sqrt', x));
}

/** math-nth-root for the cases a solution needs. @param {Form} x @param {Form} n @returns {Form} */
function nroot(x, n) {
  if (isNum(x) && isNum(n)) {
    if (negp(x)) throw new SymbolicUnsupported('root of a negative number');
    if (isInt(x) && isInt(n) && n.v > 0n) {
      const guess = BigInt(Math.round(Math.pow(Number(x.v), 1 / Number(n.v))));
      for (const g of [guess - 1n, guess, guess + 1n]) if (g >= 0n && g ** n.v === x.v) return I(g); // a whole root is exact
    }
    return pow(x, isInt(n) ? frac(1n, n.v) : div(I(1), n));
  }
  return pow(x, isInt(n) ? frac(1n, n.v) : div(I(1), n));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Polynomials (math-is-polynomial)
// ---------------------------------------------------------------------------------------------------------------------------------

/** @param {Form[]} p */
function polySimplify(p) {
  const out = p.slice();
  while (out.length > 1 && zerop(out[out.length - 1])) out.pop();
  return out;
}

/** @param {Form[]} a @param {Form} ac @param {Form[]} b @param {Form} bc @returns {Form[]} */
function polyMix(a, ac, b, bc) {
  const n = Math.max(a.length, b.length);
  const out = [];
  for (let i = 0; i < n; i++) out.push(add(mul(a[i] ?? I(0), ac), mul(b[i] ?? I(0), bc)));
  return out;
}

/** @param {Form[]} a @param {Form[]} b @returns {Form[]} */
function polyMul(a, b) {
  if (a.length === 0 || b.length === 0) return [];
  return polyMix(b, a[0], polyMul(a.slice(1), [I(0), ...b]), I(1));
}

/**
 * The coefficients [a, b, c, ...] of `expr` as a + b x + c x^2 ..., or null when it is not a polynomial in the variable.
 * @param {Form} expr @param {number} degree @returns {Form[] | null}
 */
function isPolynomial(expr, degree) {
  const poly = polyRec(expr, degree);
  return poly && poly.length <= degree + 1 ? poly : null;
}

/** @param {Form} expr @param {number} degree @returns {Form[] | null} */
function polyRec(expr, degree) {
  /** @type {Form[] | null} */ let r = null;
  if (equal(expr, state.v)) {
    r = [I(0), I(1)];
  } else if (isOp(expr, '^')) {
    const [base, p] = expr.a;
    if (isInt(p) && p.v >= 0n && hasVar(base)) {
      const p1 = polyRec(base, degree);
      const n = Number(p.v);
      if (p1 && (p1.length - 1) * n <= degree) {
        let accum = [I(1)];
        for (let i = 0; i < n; i++) accum = polyMul(accum, p1);
        r = accum;
      }
    }
  } else if (isNum(expr)) {
    r = [expr];
  } else if (isOp(expr, '+') || isOp(expr, '-')) {
    const p1 = polyRec(expr.a[0], degree);
    const p2 = p1 && polyRec(expr.a[1], degree);
    if (p1 && p2) r = polyMix(p1, I(1), p2, I(expr.f === '+' ? 1 : -1));
  } else if (isOp(expr, 'neg')) {
    const p1 = polyRec(expr.a[0], degree);
    if (p1) r = p1.map(neg);
  } else if (isOp(expr, '*')) {
    const p1 = polyRec(expr.a[0], degree);
    const p2 = p1 && polyRec(expr.a[1], degree);
    if (p1 && p2 && p1.length + p2.length - 2 <= degree) r = polyMul(p1, p2);
  } else if (isOp(expr, '/')) {
    if (!hasVar(expr.a[1]) && !zerop(expr.a[1])) {
      const p1 = polyRec(expr.a[0], degree);
      if (p1) r = p1.map((x) => div(x, expr.a[1]));
    }
  }
  if (r) return polySimplify(r);
  if (!hasVar(expr) && expr.t !== 'vec') return [expr];
  return null;
}

/**
 * math-decompose-poly with the variable as the base: the equation as `factor * (poly in base^scale) = 0`, or null.
 * @param {Form} lhs @param {Form} rhs @returns {{ base: Form, coeffs: Form[], factor: Form } | null}
 */
function decomposePoly(lhs, rhs) {
  let p = isPolynomial(lhs, 50);
  /** @type {Form[]} */ let t1;
  if (p) {
    t1 = [sub(p[0], rhs), ...p.slice(1)];
  } else {
    const factors = funnyFactors(lhs);
    if (factors.length === 0) return null;
    const fac = factors.reduce((acc, f) => mul(acc, f));
    p = isPolynomial(simplify(expand(sub(mul(lhs, fac), mul(rhs, fac)))), 50);
    if (!p) return null;
    t1 = p;
  }
  let count = 0;
  while (t1.length && zerop(t1[0])) {
    t1 = t1.slice(1);
    count++;
  }
  if (t1.length === 0) return null;
  const degree = t1.length - 1;
  let scale = 1;
  for (let s = degree; s > 1; s--) {
    if (degree % s !== 0) continue;
    if (t1.every((c, n) => n % s === 0 || zerop(c))) {
      scale = s;
      t1 = t1.filter((_, n) => n % s === 0);
      break;
    }
  }
  if (t1.length - 1 > 15) return null;
  return { base: pow(state.v, I(scale)), coeffs: t1, factor: pow(state.v, I(count)) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// math-try-solve-for
// ---------------------------------------------------------------------------------------------------------------------------------

const isEven = (/** @type {Form} */ a) => isInt(a) && a.v % 2n === 0n;
const isOdd = (/** @type {Form} */ a) => isInt(a) && a.v % 2n !== 0n;

/** math-looks-evenp. @param {Form} a @returns {boolean} */
function looksEven(a) {
  if (isInt(a)) return isEven(a);
  if (isOp(a, '*') || isOp(a, '/')) return looksEven(a.a[0]);
  return false;
}

/** math-integer-log2: k when n is 2^k. @param {bigint} n @returns {number | null} */
function integerLog2(n) {
  if (n < 1n) return null;
  let k = 0;
  while (n > 1n) {
    if (n % 2n !== 0n) return null;
    n /= 2n;
    k++;
  }
  return k;
}

/** math-solve-prod: two solutions of a factored equation; only the first is kept unless fsolve. @param {Form | null} l @param {Form | null} r @returns {Form | null} */
function solveProd(l, r) {
  if (!l) return r;
  if (!r) return l;
  if (state.full) {
    state.signCount++;
    return O('if', O('gt', V(`s${state.signCount}`), I(0)), l, r);
  }
  return l;
}

/** @param {Form} lhs @param {Form} rhs @param {number | null} sign @returns {Form | null} */
function tryProd(lhs, rhs, sign) {
  if (isOp(lhs, '*')) {
    const [a, b] = lhs.a;
    if (!hasVar(a)) return tryFor(b, div(rhs, a), solveSign(sign, a));
    if (!hasVar(b)) return tryFor(a, div(rhs, b), solveSign(sign, b));
    if (zerop(rhs)) return solveProd(tryFor(b, I(0)), tryFor(a, I(0)));
    return null;
  }
  if (isOp(lhs, '/')) {
    const [a, b] = lhs.a;
    if (!hasVar(a)) return tryFor(b, div(a, rhs), solveSign(sign, a));
    if (!hasVar(b)) return tryFor(a, mul(rhs, b), solveSign(sign, b));
    return tryFor(sub(a, mul(b, rhs)), I(0));
  }
  if (isOp(lhs, '^')) {
    const [base, e] = lhs.a;
    if (!hasVar(base)) {
      const logged = normalize(O('log', rhs, base));
      const around = div(mul(I(2), mul(V('pi'), getInt(V('i')))), normalize(O('ln', base)));
      return tryFor(e, add(isInt(logged) ? F(Number(logged.v)) : logged, state.full ? around : I(0))); // Calc divides two natural logarithms, so a whole answer is still a float
    }
    if (!hasVar(e)) {
      const log2 = isInt(e) && e.v >= 2n ? integerLog2(e.v) : null;
      if (log2 !== null) {
        let t2 = rhs;
        for (let k = 0; k < log2; k++) t2 = getSign(sqrtOf(t2));
        return tryFor(base, hasComplex(t2) ? t2 : normalize(t2));
      }
      if (looksNeg(e)) return tryFor(O('^', base, neg(e)), div(I(1), rhs));
      const turn = normalize(O('exp', div(mul(V('pi'), getInt(V('i'))), div(e, I(2)))));
      return tryFor(base, mul(turn, nroot(rhs, e)), isOdd(e) ? solveSign(sign, e) : null);
    }
  }
  return null;
}

/** math-solve-find-root-in-prod: the exponent of a root in a product, or 0. @param {Form} x @returns {number} */
function findRootInProd(x) {
  if (x.t !== 'op' || !hasVar(x)) return 0;
  if (x.f === 'sqrt') return 2;
  if (x.f === '^') {
    const e = x.a[1];
    if (e.t === 'frac' && e.d === 2n) return 2;
    if (e.t === 'frac' && e.d === 4n) return 2;
    if (e.t === 'frac' && e.d === 3n) return 3;
    if (e.t === 'flt' && (Math.abs(Number(e.m) * 10 ** e.e) % 0.5 === 0.25 || Math.abs(Number(e.m) * 10 ** e.e) % 0.5 === 0)) return 2;
  }
  if (x.f === '*' || x.f === '/') {
    if (!hasVar(x.a[0])) return findRootInProd(x.a[1]);
    if (!hasVar(x.a[1])) return findRootInProd(x.a[0]);
  }
  return 0;
}

/** math-solve-find-root-term. @param {Form} x @param {boolean} negated @returns {{ term: Form, power: number, negated: boolean } | null} */
function findRootTerm(x, negated) {
  const power = findRootInProd(x);
  if (power) return { term: x, power, negated };
  if (isOp(x, '+') || isOp(x, '-')) return findRootTerm(x.a[0], negated) ?? findRootTerm(x.a[1], isOp(x, '-') ? !negated : negated);
  return null;
}

/** @param {bigint} n @param {bigint} k @returns {bigint} */
function choose(n, k) {
  let r = 1n;
  for (let i = 1n; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/**
 * math-expand-power: (a + b + ...)^n multiplied out for n up to 3 (and any n for two terms). With a variable only the terms that contain it
 * are kept apart; the rest are added together first. Anything else is left as a power.
 * @param {Form} x @param {number} n @param {Form | null} [v] @param {boolean} [elseNil] @returns {Form | null}
 */
function expandPower(x, n, v = null, elseNil = false) {
  if (isOp(x, '+') || isOp(x, '-')) {
    /** @type {Form[]} */ let terms = [];
    let rest = x;
    while (isOp(rest, '+') || isOp(rest, '-')) {
      terms.unshift(isOp(rest, '-') ? neg(rest.a[1]) : rest.a[1]);
      rest = rest.a[0];
    }
    terms.unshift(rest);
    if (v) {
      const constant = terms.filter((t) => !contains(t, v));
      terms = terms.filter((t) => contains(t, v));
      if (constant.length) terms.unshift(constant.reduceRight((acc, t) => add(t, acc)));
    }
    const P = (/** @type {Form} */ a, /** @type {number} */ k) => O('^', a, I(k));
    if (terms.length === 2) {
      let accum = I(0);
      for (let i = 0; i <= n; i++) accum = O('+', accum, O('*', I(choose(BigInt(n), BigInt(i))), O('*', P(terms[1], i), P(terms[0], n - i))));
      return accum;
    }
    if (n === 2) {
      let accum = I(0);
      for (let i = 0; i < terms.length; i++) {
        accum = O('+', accum, P(terms[i], 2));
        for (let j = i + 1; j < terms.length; j++) accum = O('+', accum, O('*', I(2), O('*', terms[i], terms[j])));
      }
      return accum;
    }
    if (n === 3) {
      let accum = I(0);
      for (let i = 0; i < terms.length; i++) {
        accum = O('+', accum, P(terms[i], 3));
        for (let j = i + 1; j < terms.length; j++) {
          accum = O('+', O('+', accum, O('*', I(3), O('*', P(terms[i], 2), terms[j]))), O('*', I(3), O('*', terms[i], P(terms[j], 2))));
          for (let k = j + 1; k < terms.length; k++) accum = O('+', accum, O('*', I(6), O('*', terms[i], O('*', terms[j], terms[k]))));
        }
      }
      return accum;
    }
  }
  return elseNil ? null : O('^', x, I(n));
}

/** math-expand-term: one step of multiplying out a sum. @param {Form} e @returns {Form} */
function expandTerm(e) {
  if (e.t !== 'op') return e;
  const pair = (/** @type {Form} */ a, /** @type {Form} */ b, /** @type {boolean} */ minus) => (minus ? sub(a, b) : add(a, b));
  if (e.f === '*' && (isOp(e.a[0], '+') || isOp(e.a[0], '-'))) {
    const [s, c] = [e.a[0], e.a[1]];
    return pair(O('*', s.a[0], c), O('*', s.a[1], c), s.f === '-');
  }
  if (e.f === '*' && (isOp(e.a[1], '+') || isOp(e.a[1], '-'))) {
    const [c, s] = [e.a[0], e.a[1]];
    return pair(O('*', c, s.a[0]), O('*', c, s.a[1]), s.f === '-');
  }
  if (e.f === '/' && (isOp(e.a[0], '+') || isOp(e.a[0], '-'))) {
    const s = e.a[0];
    return pair(O('/', s.a[0], e.a[1]), O('/', s.a[1], e.a[1]), s.f === '-');
  }
  if (e.f === '^' && (isOp(e.a[0], '+') || isOp(e.a[0], '-')) && isInt(e.a[1])) {
    const n = e.a[1].v;
    if (n > 0n) return expandPower(e.a[0], Number(n), null, true) ?? O('*', e.a[0], O('^', e.a[0], I(n - 1n)));
    if (n < 0n) return O('/', I(1), O('^', e.a[0], I(-n)));
  }
  return e;
}

/** math-map-tree: a rewrite applied until it stops changing, then to every part. @param {(e: Form) => Form} fn @param {Form} e @returns {Form} */
function mapTree(fn, e) {
  for (let guard = 0; guard < 1000; guard++) {
    const next = fn(e);
    if (equal(next, e)) break;
    e = next;
  }
  if (e.t === 'op') {
    const parts = e.a.map((/** @type {Form} */ x) => mapTree(fn, x));
    const next = { ...e, a: parts };
    if (!equal(next, e)) return mapTree(fn, next);
  } else if (e.t === 'vec') {
    return VEC(e.items.map((/** @type {Form} */ x) => mapTree(fn, x)));
  }
  return e;
}

/** Calc's expand. @param {Form} e @returns {Form} */
function expand(e) {
  return normalize(mapTree(expandTerm, e));
}

/** The denominators in `e` that contain the variable (a quotient's, or the base of a negative power), as math-is-polynomial collects them. @param {Form} e @returns {Form[]} */
function funnyFactors(e) {
  /** @type {Form[]} */ const out = [];
  const walk = (/** @type {Form} */ x) => {
    if (x.t !== 'op') return;
    if (x.f === '/' && hasVar(x.a[1]) && isPolynomial(x.a[1], 50)) out.push(x.a[1]);
    else if (x.f === '^' && isInt(x.a[1]) && x.a[1].v < 0n && hasVar(x.a[0]) && isPolynomial(x.a[0], 50)) out.push(pow(x.a[0], neg(x.a[1])));
    for (const y of x.a) walk(y);
  };
  walk(e);
  return out;
}

/**
 * @param {Form} lhs @param {Form} rhs @param {number | null} [sign] @param {boolean} [noPoly]
 * @returns {Form | null}
 */
function tryFor(lhs, rhs, sign = null, noPoly = false) {
  if (equal(lhs, state.v)) {
    state.sign = sign;
    return rhs;
  }
  if (lhs.t !== 'op') return null;
  if (lhs.f === 'neg') return tryFor(lhs.a[0], neg(rhs), sign === null ? null : -sign);
  if (!state.full) {
    const r = tryProd(lhs, rhs, sign);
    if (r) return r;
  }
  if (!noPoly) {
    const d = decomposePoly(lhs, rhs);
    if (d) {
      const [c0, c1, c2, c3, c4] = d.coeffs;
      /** @type {Form | null} */ let r = null;
      if (d.coeffs.length >= 4) throw new SymbolicUnsupported('cubic and quartic equations');
      if (d.coeffs.length === 3) r = solveQuadratic(d.base, c0, c1, c2);
      else if (d.coeffs.length === 2) r = tryFor(d.base, div(neg(c0), c1), solveSign(sign, c1), true);
      else if (!eqInt(d.factor, 1)) r = tryFor(d.factor, I(0), null, true);
      void c3;
      void c4;
      if (!r) return null;
      if (eqInt(d.factor, 1)) return r;
      return solveProd(r, tryFor(d.factor, I(0), null, true));
    }
  }
  const root = findRootTerm(lhs, false);
  if (root && countOf(lhs, root.term) === 1) {
    const stripped = normalize(subst(lhs, root.term, I(0)));
    const power = I(root.power);
    const own = root.negated || isEven(power) ? pow(root.term, power) : neg(pow(root.term, power));
    const next = simplify(sub(own, /** @type {Form} */ (expandPower(sub(stripped, rhs), root.power, state.v))));
    return tryFor(next, I(0));
  }
  if (lhs.f === '+') {
    const [a, b] = lhs.a;
    if (!hasVar(a)) return tryFor(b, sub(rhs, a), sign);
    if (!hasVar(b)) return tryFor(a, sub(rhs, b), sign);
    return null;
  }
  if (lhs.f === 'eq') return tryFor(sub(lhs.a[0], lhs.a[1]), rhs, sign, noPoly);
  if (lhs.f === '-') {
    const [a, b] = lhs.a;
    if (!hasVar(a)) return tryFor(b, sub(a, rhs), sign === null ? null : -sign);
    if (!hasVar(b)) return tryFor(a, add(rhs, b), sign);
    return null;
  }
  if (state.full) {
    const r = tryProd(lhs, rhs, sign);
    if (r) return r;
  }
  if (lhs.f === 'log' && lhs.a.length === 2) {
    const [a, b] = lhs.a;
    if (!hasVar(b)) return tryFor(a, pow(b, rhs));
    if (!hasVar(a)) return tryFor(b, pow(a, div(I(1), rhs)));
    return null;
  }
  if (lhs.a.length === 1) {
    const inv = inverseOf(lhs.f, rhs);
    if (inv) return tryFor(lhs.a[0], normalize(inv.value), sign !== null && inv.sign !== null ? sign * inv.sign : null);
  }
  return null;
}

/** @param {Form} expr @param {Form} term @returns {number} */
function countOf(expr, term) {
  if (equal(expr, term)) return 1;
  if (expr.t === 'op') return expr.a.reduce((/** @type {number} */ n, /** @type {Form} */ x) => n + countOf(x, term), 0);
  if (expr.t === 'vec') return expr.items.reduce((/** @type {number} */ n, /** @type {Form} */ x) => n + countOf(x, term), 0);
  return 0;
}

/** The `math-inverse` property of Calc's functions: what the argument must equal, and the sign it keeps. @param {string} f @param {Form} x @returns {{ value: Form, sign: number | null } | null} */
function inverseOf(f, x) {
  switch (f) {
    case 'inv':
      return { value: div(I(1), x), sign: -1 };
    case 'sqrt':
      return { value: sqr(x), sign: null };
    case 'abs':
      return { value: getSign(x), sign: null };
    case 'ln':
      return { value: O('exp', x), sign: 1 };
    case 'log10': {
      const raised = isNum(x) ? normalize(O('exp10', x)) : O('^', F(10), x);
      return { value: isInt(raised) ? F(Number(raised.v)) : raised, sign: 1 };
    }
    case 'exp':
      return { value: add(normalize(O('ln', x)), mul(I(2), mul(V('pi'), getInt(V('i'))))), sign: 1 };
    case 'sin':
      if (state.full) throw new SymbolicUnsupported('fsolve of sin');
      return { value: normalize(O('arcsin', x)), sign: null };
    case 'cos':
      if (state.full) throw new SymbolicUnsupported('fsolve of cos');
      return { value: getSign(normalize(O('arccos', x))), sign: null };
    case 'tan':
      if (state.full) throw new SymbolicUnsupported('fsolve of tan');
      return { value: normalize(O('arctan', x)), sign: null };
    case 'arcsin':
      return { value: normalize(O('sin', x)), sign: null };
    case 'arccos':
      return { value: normalize(O('cos', x)), sign: null };
    case 'arctan':
      return { value: normalize(O('tan', x)), sign: null };
    default:
      return null;
  }
}

/** math-solve-quadratic. @param {Form} v @param {Form} c @param {Form} b @param {Form} a @returns {Form | null} */
function solveQuadratic(v, c, b, a) {
  /** @type {Form} */ let value;
  const even = looksEven(b);
  const half = even ? div(b, I(2)) : b;
  const radicand = even ? add(sqr(half), mul(neg(c), a)) : add(sqr(b), mul(I(4), mul(neg(c), a)));
  const denom = even ? a : mul(I(2), a);
  if (isNum(radicand) && negp(radicand) && isNum(a) && isNum(half)) {
    if (state.full) throw new SymbolicUnsupported('fsolve with complex roots');
    value = { t: 'cplx', re: div(neg(half), denom), im: div(callFunction('sqrt', [neg(radicand)]), denom) }; // complex arithmetic is not in the engine: the two parts directly
  } else {
    value = div(add(neg(half), getSign(sqrtOf(radicand))), denom);
  }
  return tryFor(v, value, null, true);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// math-solve-for, math-solve-eqn, math-solve-system
// ---------------------------------------------------------------------------------------------------------------------------------

/** @param {Form} lhs @param {Form} rhs @param {Form} v @param {number | null} [sign] @returns {Form | null} */
function solveFor(lhs, rhs, v, sign = null) {
  state.v = v;
  if (contains(rhs, v)) return solveFor(sub(lhs, rhs), I(0), v);
  if (!contains(lhs, v)) return null;
  return tryFor(lhs, rhs, sign);
}

const INEQUALITIES = new Set(['neq', 'lt', 'gt', 'leq', 'geq']);

/** @param {Form} expr @param {Form} v @returns {Form | null} */
function solveEqn(expr, v) {
  state.sign = null;
  if (expr.t === 'op' && INEQUALITIES.has(expr.f)) {
    const res = solveFor(O('-', expr.a[0], expr.a[1]), I(0), v, expr.f === 'neq' ? null : 1);
    if (!res) return null;
    if (state.sign === 1) return O(expr.f, v, res);
    if (state.sign === -1) return O(expr.f, res, v);
    return expr.f === 'neq' || expr.f === 'lt' || expr.f === 'gt' ? O('neq', v, res) : null;
  }
  const res = solveFor(expr, I(0), v);
  return res ? O('eq', v, res) : null;
}

/** @param {Form[]} eqns @param {Form[]} vars @param {boolean} simplifying @param {Form[]} varOrder @param {[Form, Form][]} solns @returns {[Form, Form][] | null} */
function solveSystemRec(eqns, vars, simplifying, varOrder, solns) {
  if (vars.length === 0) return solns;
  for (const v of vars) {
    for (let i = 0; i < eqns.length; i++) {
      const res = solveFor(eqns[i], I(0), v);
      if (!res) continue;
      const put = (/** @type {Form} */ x) => (simplifying ? simplify(subst(x, v, res)) : subst(x, v, res));
      const restEqns = eqns.filter((_, k) => k !== i).map(put);
      const restVars = vars.filter((x) => x !== v);
      const nextSolns = /** @type {[Form, Form][]} */ (solns.map(([name, value]) => [name, subst(value, v, res)]));
      nextSolns.unshift([v, res]);
      const done = solveSystemRec(restEqns, restVars, simplifying, varOrder, nextSolns);
      if (done) return done;
    }
  }
  return null;
}

/** @param {Form} exprs @param {Form} vars @returns {Form | null} */
function solveSystem(exprs, vars) {
  const eqns = exprs.t === 'vec' ? exprs.items : [exprs];
  const names = vars.t === 'vec' ? vars.items : [vars];
  const found = solveSystemRec(eqns, names, false, names, []) ?? solveSystemRec(eqns, names, true, names, []);
  if (!found) return null;
  const order = (/** @type {Form} */ v) => names.findIndex((/** @type {Form} */ x) => equal(x, v));
  found.sort((x, y) => order(x[0]) - order(y[0]));
  return normalize(VEC(found.map(([name, value]) => O('eq', name, value))));
}

/** Calc's solve and fsolve. @param {string} name @param {Form[]} args @returns {Form} */
function solveCall(name, args) {
  state.full = name === 'fsolve';
  state.signCount = 0;
  state.intCount = 0;
  const [expr, v] = args;
  const res = expr.t === 'vec' || v.t === 'vec' ? solveSystem(expr, v) : solveEqn(expr, v);
  return res ?? O(name, expr, v);
}

registerFunction('solve', (args) => (args.length === 2 ? solveCall('solve', args) : null));
registerFunction('fsolve', (args) => (args.length === 2 ? solveCall('fsolve', args) : null));
registerFunction('expand', (args) => (args.length === 1 ? expand(args[0]) : null));
