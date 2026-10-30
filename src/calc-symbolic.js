// @ts-check
/**
 * Calc's symbolic algebra, as Emacs shows it when a table formula can't be reduced to a number.
 *
 * In Org the cells a formula refers to are pasted into it as text and Calc reads the whole thing as algebra, so a cell holding "hello"
 * is the variable hello and `$1+1` comes out as `hello + 1`, `$1*2` as `2 hello`, and `$1-$1` as `0`. This module ports the part of Calc
 * (calc-arith.el / calc.el / calccomp.el) that does that: reading an expression, the add / subtract / multiply / divide / power
 * rules and their `combine-sum` / `combine-prod` collection of like terms, and the printer. Calc's quirks are kept on purpose --
 * `x + 3 + x` stays as it is because `combine-sum` only compares a term with the last one -- since matching Emacs is the point.
 *
 * A form is a plain object: {t:'int', v:bigint} {t:'flt', m:bigint, e:number} (Calc's decimal float m x 10^e) {t:'frac', n, d} {t:'var', name}
 * {t:'vec', items} and {t:'op', f, a} where f is '+', '-', '*', '/', '^', '%', 'neg' or a function name.
 */

export class SymbolicUnsupported extends Error {}
export class SymbolicSyntaxError extends Error {
  /** @param {string} message @param {boolean} [definite] true when Calc rejects this whatever the cells hold, so the cell shows #ERROR even from the main evaluator */
  constructor(message, definite = false) {
    super(message);
    this.definite = definite;
  }
}
/** Calc refuses an operation (math-reject-arg): its normalizer leaves that one node as written, with its arguments evaluated. */
export class SymbolicReject extends Error {}
export class SymbolicDivisionByZero extends SymbolicReject {
  /** @param {any} numerator */
  constructor(numerator) {
    super('Division by zero');
    this.numerator = numerator;
  }
}

/** @typedef {any} Form */

// ---------------------------------------------------------------------------------------------------------------------------------
// Constructors and predicates
// ---------------------------------------------------------------------------------------------------------------------------------

let workDigits = 12;
/** True while `simplify` runs: Calc's math-simplifying, which loosens how like terms and factors are matched. */
const mode = { simplifying: false };
/** @param {boolean} on */
export function setSimplifying(on) {
  mode.simplifying = on;
}
/** @param {number} n */
const pow10 = (n) => 10n ** BigInt(n);
/** @param {bigint} m */
function numdigs(m) {
  return m === 0n ? 0 : (m < 0n ? -m : m).toString().length;
}
/** Calc's math-scale-rounding: divide by 10^-n, rounding halves up. @param {bigint} a @param {number} n @returns {bigint} */
function scaleRounding(a, n) {
  if (a < 0n) return -scaleRounding(-a, n);
  const d = pow10(-n);
  return (a + d / 2n) / d;
}
/** math-make-float: Calc's decimal float, rounded to the working number of digits and with trailing zeros dropped. @param {bigint} m @param {number} e @returns {Form} */
function makeFloat(m, e) {
  if (m === 0n) return { t: 'flt', m: 0n, e: 0 };
  const ldiff = workDigits - numdigs(m);
  if (ldiff < 0) {
    m = scaleRounding(m, ldiff);
    e -= ldiff;
  }
  while (m % 10n === 0n) {
    m /= 10n;
    e++;
  }
  return { t: 'flt', m, e };
}
/** Read decimal text such as 2.5, .5, 3. or 1e-3 exactly. @param {string} text @returns {Form} */
function parseDecimal(text) {
  const m = /^(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!m || (m[1] === '' && m[2] === '')) throw new SymbolicSyntaxError(`bad number ${text}`);
  return makeFloat(BigInt(m[1] + m[2]), Number(m[3] || 0) - m[2].length);
}
/** A float from a JS number, to the working number of digits. @param {number} v @returns {Form} */
export const F = (v) => {
  if (!Number.isFinite(v)) throw new SymbolicUnsupported('number out of range');
  return v === 0 ? makeFloat(0n, 0) : parseDecimal(v.toExponential(workDigits - 1));
};
/** @param {string} text @returns {Form} */
export const D = (text) => parseDecimal(text);
/** @param {number | bigint} v @returns {Form} */
export const I = (v) => ({ t: 'int', v: BigInt(v) });
/** @param {string} name @returns {Form} */
export const V = (name) => ({ t: 'var', name });
/** @param {string} f @param {...Form} a @returns {Form} */
export const O = (f, ...a) => ({ t: 'op', f, a });
/** @param {Form[]} items @returns {Form} */
export const VEC = (items) => ({ t: 'vec', items });

/** @param {bigint} a @param {bigint} b */
function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}
/** A fraction in lowest terms, or an integer when the denominator is 1. @param {bigint} n @param {bigint} d @returns {Form} */
export function frac(n, d) {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1n; // a zero denominator is kept, as in Calc: 4/0 is the fraction 1:0 until something needs its value
  n /= g;
  d /= g;
  return d === 1n ? { t: 'int', v: n } : { t: 'frac', n, d };
}

const isInt = (/** @type {Form} */ a) => a.t === 'int';
const isFlt = (/** @type {Form} */ a) => a.t === 'flt';
const isFrac = (/** @type {Form} */ a) => a.t === 'frac';
export const isNum = (/** @type {Form} */ a) => a.t === 'int' || a.t === 'flt' || a.t === 'frac';
const isRat = (/** @type {Form} */ a) => a.t === 'int' || a.t === 'frac';
const isVec = (/** @type {Form} */ a) => a.t === 'vec';
const isObjVec = (/** @type {Form} */ a) => isNum(a) || isVec(a);
const isOp = (/** @type {Form} */ a, /** @type {string} */ f) => a.t === 'op' && a.f === f;
const isIntv = (/** @type {Form} */ a) => a.t === 'intv';

/** @param {Form} a */
export function toNumber(a) {
  if (a.t === 'frac' && a.d === 0n) throw new SymbolicDivisionByZero(a);
  return a.t === 'int' ? Number(a.v) : a.t === 'frac' ? Number(a.n) / Number(a.d) : Number(`${a.m}e${a.e}`);
}
/** @param {Form} a */
export function zerop(a) {
  return a.t === 'int' ? a.v === 0n : a.t === 'flt' ? a.m === 0n : false;
}
/** @param {Form} a */
export function negp(a) {
  return a.t === 'int' ? a.v < 0n : a.t === 'frac' ? a.n < 0n : a.t === 'flt' ? a.m < 0n : false;
}
/** @param {Form} a */
export function posp(a) {
  return a.t === 'int' ? a.v > 0n : a.t === 'frac' ? a.n > 0n : a.t === 'flt' ? a.m > 0n : false;
}
/** Calc's Math-equal-int: the integer n, or a float with that whole value. @param {Form} a @param {number} n */
export function eqInt(a, n) {
  return (a.t === 'int' && a.v === BigInt(n)) || (a.t === 'flt' && a.e === 0 && a.m === BigInt(n));
}
/** @param {Form} a @param {Form} b @returns {boolean} */
export function equal(a, b) {
  if (a.t !== b.t) return false;
  switch (a.t) {
    case 'int':
      return a.v === b.v;
    case 'flt':
      return a.m === b.m && a.e === b.e;
    case 'frac':
      return a.n === b.n && a.d === b.d;
    case 'var':
      return a.name === b.name;
    case 'vec':
      return a.items.length === b.items.length && a.items.every((/** @type {Form} */ x, /** @type {number} */ i) => equal(x, b.items[i]));
    case 'intv':
      return a.mask === b.mask && equal(a.lo, b.lo) && equal(a.hi, b.hi);
    case 'cplx':
      return equal(a.re, b.re) && equal(a.im, b.im);
    default:
      return a.f === b.f && a.a.length === b.a.length && a.a.every((/** @type {Form} */ x, /** @type {number} */ i) => equal(x, b.a[i]));
  }
}
/** @param {Form} a @returns {boolean} */
export function looksNeg(a) {
  if (negp(a)) return true;
  if (a.t !== 'op') return false;
  if (a.f === 'neg') return true;
  if (a.f === '*' || a.f === '/') return looksNeg(a.a[0]) || looksNeg(a.a[1]);
  if (a.f === '-') return looksNeg(a.a[0]);
  return false;
}
/** @param {Form} a */
/** The inline Math-looks-negp, which unlike math-looks-negp does not look inside a subtraction. @param {Form} a */
function looksNegShallow(a) {
  return negp(a) || (a.t === 'op' && (a.f === 'neg' || ((a.f === '*' || a.f === '/') && (looksNeg(a.a[0]) || looksNeg(a.a[1])))));
}
const okayNeg = (/** @type {Form} */ a) => looksNeg(a) || isOp(a, '-');
const INFINITIES = new Set(['inf', 'uinf', 'nan']);
/** @param {Form} a */
export function infinitep(a) {
  while (a.t === 'op' && (a.f === '*' || a.f === '/' || a.f === 'neg')) {
    a = a.f !== '*' || infinitep(a.a[0]) ? a.a[0] : a.a[1];
  }
  return a.t === 'var' && INFINITIES.has(a.name) ? a : null;
}
/** Integer-valued: an integer, or a float with no fractional part. @param {Form} a */
function numIntegerp(a) {
  return a.t === 'int' || (a.t === 'flt' && a.e >= 0);
}
/** @param {Form} a */
function evenp(a) {
  return a.t === 'int' && a.v % 2n === 0n;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------------------------------------------

/** @param {Form} a @returns {[bigint, bigint]} */
const ratParts = (a) => (a.t === 'int' ? [a.v, 1n] : [a.n, a.d]);

/** @param {Form} a @returns {Form} */
function toFloatForm(a) {
  if (isFlt(a)) return a;
  if (isInt(a)) return makeFloat(a.v, 0);
  if (a.d === 0n) throw new SymbolicDivisionByZero(a);
  return divFloat(makeFloat(a.n, 0), makeFloat(a.d, 0));
}
/** @param {Form} a @param {Form} b @returns {Form} */
function addFloat(a, b) {
  const ediff = a.e - b.e;
  if (ediff >= 0) return ediff >= workDigits * 2 ? a : makeFloat(b.m + a.m * pow10(ediff), b.e);
  return -ediff >= workDigits * 2 ? b : makeFloat(a.m + b.m * pow10(-ediff), a.e);
}
/** @param {Form} a @param {Form} b @returns {Form} */
function divFloat(a, b) {
  const ldiff = Math.max(workDigits + 1 - (numdigs(a.m) - numdigs(b.m)), 0);
  return makeFloat((a.m * pow10(ldiff)) / b.m, a.e - b.e - ldiff);
}
/** @param {Form} a @param {Form} b @returns {Form} */
function numAdd(a, b) {
  if (isRat(a) && isRat(b)) {
    const [an, ad] = ratParts(a);
    const [bn, bd] = ratParts(b);
    return frac(an * bd + bn * ad, ad * bd);
  }
  return addFloat(toFloatForm(a), toFloatForm(b));
}
/** @param {Form} a @param {Form} b @returns {Form} */
function numMul(a, b) {
  if (isRat(a) && isRat(b)) {
    const [an, ad] = ratParts(a);
    const [bn, bd] = ratParts(b);
    return frac(an * bn, ad * bd);
  }
  const x = toFloatForm(a);
  const y = toFloatForm(b);
  return makeFloat(/** @type {bigint} */ (x.m) * /** @type {bigint} */ (y.m), x.e + y.e);
}
/** Integers that don't divide evenly give a float (Calc's default), fractions stay fractions. @param {Form} a @param {Form} b @returns {Form} */
function numDiv(a, b) {
  if (a.t === 'int' && b.t === 'int') {
    const av = /** @type {bigint} */ (a.v);
    const bv = /** @type {bigint} */ (b.v);
    return av % bv === 0n ? { t: 'int', v: av / bv } : divFloat(makeFloat(av, 0), makeFloat(bv, 0));
  }
  if (isRat(a) && isRat(b)) {
    const [an, ad] = ratParts(a);
    const [bn, bd] = ratParts(b);
    return frac(an * bd, ad * bn);
  }
  return divFloat(toFloatForm(a), toFloatForm(b));
}
/** @param {Form} a @returns {Form} */
function negNumber(a) {
  return a.t === 'int' ? { t: 'int', v: -a.v } : a.t === 'frac' ? { t: 'frac', n: -a.n, d: a.d } : { t: 'flt', m: -a.m, e: a.e };
}

/** @param {(a: Form, b: Form) => Form} fn @param {Form} a @param {Form} b @returns {Form} */
function mapVec2(fn, a, b) {
  if (isVec(a) && isVec(b)) {
    if (a.items.length !== b.items.length) throw new SymbolicReject('Dimension error');
    return VEC(a.items.map((/** @type {Form} */ x, /** @type {number} */ i) => fn(x, b.items[i])));
  }
  if (isVec(a)) return VEC(a.items.map((/** @type {Form} */ x) => fn(x, b)));
  return VEC(b.items.map((/** @type {Form} */ y) => fn(a, y)));
}

/** @param {Form} a @returns {Form} */
export function neg(a) {
  if (isNum(a)) return negNumber(a);
  if (isVec(a)) return VEC(a.items.map(neg));
  if (isIntv(a)) return makeIntv(FLIP_MASK[a.mask], neg(a.hi), neg(a.lo));
  if (a.t === 'op') {
    const [x, y] = a.a;
    if (a.f === '+') return sub(neg(x), y);
    if (a.f === '-') return sub(y, x);
    if (a.f === '*' || a.f === '/') {
      if (okayNeg(x)) return O(a.f, neg(x), y);
      if (okayNeg(y)) return O(a.f, x, neg(y));
      if (isNum(x) || (isOp(x, '*') && isNum(x.a[0]))) return O(a.f, neg(x), y);
      if (a.f === '/' && (isNum(y) || (isOp(y, '*') && isNum(y.a[0])))) return O('/', x, neg(y));
    }
    if (a.f === 'neg') return x;
  }
  if (a.t === 'var' && (a.name === 'uinf' || a.name === 'nan')) return a;
  return O('neg', a);
}

/** @param {Form} a @param {Form} b @returns {Form} */
export function add(a, b) {
  if (zerop(a)) return isFlt(a) && isRat(b) ? toFloatForm(b) : b;
  if (zerop(b)) return isFlt(b) && isRat(a) ? toFloatForm(a) : a;
  if (isNum(a) && isNum(b)) return numAdd(a, b);
  if (isVec(a) || isVec(b)) {
    if ((isVec(a) && isVec(b)) || knownScalar(isVec(a) ? b : a)) return mapVec2(add, a, b);
    return addSymb(a, b); // a vector and something that may be one too: left as written
  }
  if ((isIntv(a) && (isNum(b) || isIntv(b))) || (isIntv(b) && isNum(a))) return intvAdd(a, b);
  return addSymb(a, b);
}

/** @param {Form} a @param {Form} b @returns {Form} */
export function sub(a, b) {
  if (isNum(a) && isNum(b)) return numAdd(a, negNumber(b));
  return add(a, neg(b));
}

/** @param {Form} a @param {Form} b @returns {Form} */
function addSymb(a, b) {
  if (isOp(b, '+')) return add(add(a, b.a[0]), b.a[1]);
  if (isOp(b, '-')) return sub(add(a, b.a[0]), b.a[1]);
  if (isOp(b, 'neg') && isOp(b.a[0], '+')) return sub(sub(a, b.a[0].a[0]), b.a[0].a[1]);
  /** @type {Form | null} */ let r;
  const infA = infinitep(a);
  const infB = infinitep(b);
  if (infA) {
    if (infB) {
      if (infA.name === 'nan' || infB.name === 'nan' || infA.name === 'uinf' || infB.name === 'uinf') return V('nan');
      if (equal(a, b)) return a;
      return V('nan');
    }
    return a;
  }
  if (infB) return b;
  if (isOp(a, '+')) {
    const t = combineSum(a.a[1], b, false, false, true);
    r = t ? add(a.a[0], t) : null;
  } else if (isOp(a, '-')) {
    const t = combineSum(a.a[1], b, true, false, true);
    r = t ? add(a.a[0], t) : null;
  } else if (isNum(a) && isNum(b)) {
    r = null;
  } else {
    r = combineSum(a, b, false, false, false);
  }
  if (r) return r;
  if (looksNegShallow(b)) return O('-', a, neg(b));
  if (looksNegShallow(a)) return O('-', b, neg(a));
  return O('+', a, b);
}

/** Like terms: x + x is 2 x, 2 x + 3 x is 5 x -- but only when the two forms are the same apart from a numeric multiplier.
 * @param {Form} a @param {Form} b @param {boolean} nega @param {boolean} negb @param {boolean} scalarOkay @returns {Form | null} */
export function combineSum(a, b, nega, negb, scalarOkay) {
  if (scalarOkay && isObjVec(a) && isObjVec(b)) return addOrSub(a, b, nega, negb);
  let amult = I(1);
  let bmult = I(1);
  if (a.t === 'op') {
    if (a.f === '*' && isNum(a.a[0])) {
      amult = a.a[0];
      a = a.a[1];
    } else if (a.f === '/' && isNum(a.a[1])) {
      amult = isInt(a.a[1]) ? frac(1n, a.a[1].v) : div(I(1), a.a[1]);
      a = a.a[0];
    } else if (a.f === 'neg') {
      amult = I(-1);
      a = a.a[0];
    }
  }
  if (b.t === 'op') {
    if (b.f === '*' && isNum(b.a[0])) {
      bmult = b.a[0];
      b = b.a[1];
    } else if (b.f === '/' && isNum(b.a[1])) {
      bmult = isInt(b.a[1]) ? frac(1n, b.a[1].v) : div(I(1), b.a[1]);
      b = b.a[0];
    } else if (b.f === 'neg') {
      bmult = I(-1);
      b = b.a[0];
    }
  }
  if (mode.simplifying ? compare(a, b) !== 0 : !equal(a, b)) return null;
  if (nega) amult = neg(amult);
  if (negb) bmult = neg(bmult);
  return mul(add(amult, bmult), a);
}

/** @param {Form} a @param {Form} b @param {boolean} aneg @param {boolean} bneg @returns {Form} */
function addOrSub(a, b, aneg, bneg) {
  if (aneg) a = neg(a);
  if (bneg) b = neg(b);
  return add(a, b);
}

/** @param {Form} a @param {Form} b @returns {Form} */
export function mul(a, b) {
  if (zerop(a)) {
    if (isNum(b)) return isFlt(b) && isRat(a) ? toFloatForm(a) : a;
    return mulZero(a, b);
  }
  if (zerop(b)) {
    if (isNum(a)) return isFlt(a) && isRat(b) ? toFloatForm(b) : b;
    return mulZero(b, a);
  }
  if (isNum(a) && isNum(b)) return numMul(a, b);
  if (isVec(a) || isVec(b)) {
    if (isVec(a) && isVec(b)) throw new SymbolicUnsupported('matrix product');
    if (!knownScalar(isVec(a) ? b : a)) return mulSymb(a, b);
    return mapVec2(mul, a, b);
  }
  if ((isIntv(a) && (isNum(b) || isIntv(b))) || (isIntv(b) && isNum(a))) return intvMul(a, b);
  return mulSymb(a, b);
}

/** Zero times something that isn't a number. @param {Form} a @param {Form} b @returns {Form} */
function mulZero(a, b) {
  if (infinitep(b)) return V('nan');
  return isFlt(a) || isFlt(b) ? F(0) : I(0);
}

/** @param {Form} a @param {Form} b @returns {Form} */
function mulSymb(a, b) {
  /** @type {Form | null} */ let r;
  if (eqInt(a, 1)) return b;
  if (eqInt(a, -1)) return neg(b);
  if (isNum(b) && !isNum(a)) return mul(b, a);
  if (isOp(a, 'neg')) return neg(mul(a.a[0], b));
  if (isOp(b, 'neg')) return neg(mul(a, b.a[0]));
  if (isOp(a, '*')) return mul(a.a[0], mul(a.a[1], b));
  if (isOp(a, '^') && looksNegShallow(a.a[1]) && !(isOp(b, '^') && looksNegShallow(b.a[1]))) return div(b, normalize(O('^', a.a[0], neg(a.a[1]))));
  if (isOp(b, '^') && looksNegShallow(b.a[1]) && !(isOp(a, '^') && looksNegShallow(a.a[1]))) return div(a, normalize(O('^', b.a[0], neg(b.a[1]))));
  if (isOp(a, '/')) {
    const temp = combineProd(a.a[1], b, true, false, true);
    return temp ? mul(a.a[0], temp) : div(mul(a.a[0], b), a.a[1]);
  }
  if (isOp(b, '/')) return div(mul(a, b.a[0]), b.a[1]);
  if (isOp(b, '+') && isNum(a) && (isNum(b.a[0]) || isNum(b.a[1]))) return add(mul(a, b.a[0]), mul(a, b.a[1]));
  if (isOp(b, '-') && isNum(a) && (isNum(b.a[0]) || isNum(b.a[1]))) return sub(mul(a, b.a[0]), mul(a, b.a[1]));
  if (isOp(b, '*') && isNum(b.a[0]) && !isNum(a)) return mul(b.a[0], mul(a, b.a[1]));
  if (looksNeg(b)) return mul(neg(a), neg(b));
  if (isOp(b, '-') && looksNeg(a)) return mul(neg(a), neg(b));
  if (isOp(b, '*')) {
    const temp = combineProd(a, b.a[0], false, false, true);
    r = temp ? mul(temp, b.a[1]) : null;
  } else {
    r = combineProd(a, b, false, false, false);
  }
  if (r) return r;
  if (equal(a, V('nan'))) return a;
  if (equal(b, V('nan'))) return b;
  if (equal(a, V('uinf'))) return a;
  if (equal(b, V('uinf'))) return b;
  if (equal(a, V('inf')) && !isNum(b)) return O('*', b, a);
  return O('*', a, b);
}

/** @param {Form} a @param {Form} b @returns {Form} */
export function div(a, b) {
  if (zerop(b)) throw new SymbolicDivisionByZero(a);
  if (zerop(a)) {
    if (isNum(b)) return isFlt(b) && isRat(a) ? toFloatForm(a) : a;
    return a;
  }
  if (isNum(a) && isNum(b)) return numDiv(a, b);
  if (isVec(a) || isVec(b)) {
    if (isVec(b)) throw new SymbolicUnsupported('matrix division');
    if (!knownScalar(b)) return divSymb(a, b);
    return mapVec2(div, a, b);
  }
  if ((isIntv(a) && (isNum(b) || isIntv(b))) || (isIntv(b) && isNum(a))) return intvDiv(a, b);
  return divSymb(a, b);
}

/** @param {Form} a @param {Form} b @returns {Form} */
function divSymb(a, b) {
  /** @type {Form | null} */ let r;
  if (eqInt(b, 1)) return a;
  if (eqInt(b, -1)) return neg(a);
  if (isOp(b, '^') && (looksNegShallow(b.a[1]) || eqInt(a, 1))) return mul(a, normalize(O('^', b.a[0], neg(b.a[1]))));
  if (isOp(a, 'neg')) return neg(div(a.a[0], b));
  if (isOp(b, 'neg')) return neg(div(a, b.a[0]));
  if (isOp(a, '/')) return div(a.a[0], mul(a.a[1], b));
  if (isOp(b, '/')) return div(mul(a, b.a[1]), b.a[0]);
  if (isFrac(b)) return mul(frac(b.d, b.n), a);
  if (isOp(a, '+') && (isNum(a.a[0]) || isNum(a.a[1])) && isNum(b)) return add(div(a.a[0], b), div(a.a[1], b));
  if (isOp(a, '-') && (isNum(a.a[0]) || isNum(a.a[1])) && isNum(b)) return sub(div(a.a[0], b), div(a.a[1], b));
  if ((isOp(a, '-') || looksNeg(a)) && looksNeg(b)) return div(neg(a), neg(b));
  if (isOp(b, '-') && looksNeg(a)) return div(neg(a), neg(b));
  if (isOp(a, '*')) {
    if (isOp(b, '*')) {
      const c = combineProd(a.a[0], b.a[0], false, true, true);
      r = c ? div(mul(c, a.a[1]), b.a[1]) : null;
    } else {
      const c = combineProd(a.a[0], b, false, true, true);
      r = c ? mul(c, a.a[1]) : null;
    }
  } else if (isOp(b, '*')) {
    const c = combineProd(a, b.a[0], false, true, true);
    r = c ? div(c, b.a[1]) : null;
  } else {
    r = combineProd(a, b, false, true, false);
  }
  if (r) return r;
  if (infinitep(a)) {
    if (infinitep(b)) return V('nan');
    if (equal(a, V('nan')) || equal(a, V('uinf'))) return a;
    if (equal(a, V('inf'))) return posp(b) ? a : negp(b) ? neg(a) : O('/', a, b);
  }
  return O('/', a, b);
}

const E_FORM = V('e');

/** The terms of a sum, a subtracted one negated: math-commutative-collect. @param {Form} b @param {boolean} negate @param {Form[]} out */
function collectTerms(b, negate, out) {
  if (isOp(b, '+')) {
    collectTerms(b.a[0], negate, out);
    collectTerms(b.a[1], negate, out);
  } else if (isOp(b, '-')) {
    collectTerms(b.a[0], negate, out);
    collectTerms(b.a[1], !negate, out);
  } else out.unshift(negate ? neg(b) : b);
}

/** math-commutative-equal: equal, except that two sums are the same when they have the same terms in any order. @param {Form} a @param {Form} b @returns {boolean} */
function commutativeEqual(a, b) {
  if (!(isOp(a, '+') || isOp(a, '-'))) return equal(a, b);
  if (!(isOp(b, '+') || isOp(b, '-'))) return false;
  /** @type {Form[]} */ const bterms = [];
  /** @type {Form[]} */ const aterms = [];
  collectTerms(b, false, bterms);
  collectTerms(a, false, aterms);
  if (aterms.length !== bterms.length) return false;
  for (const t of aterms) {
    const at = bterms.findIndex((x) => equal(t, x));
    if (at < 0) return false;
    bterms.splice(at, 1);
  }
  return true;
}

/** Powers of like factors: x * x is x^2, x^2 * x^3 is x^5, sqrt(x) * sqrt(x) is x.
 * @param {Form} a @param {Form} b @param {boolean} inva @param {boolean} invb @param {boolean} scalarOkay @returns {Form | null} */
export function combineProd(a, b, inva, invb, scalarOkay) {
  if ((inva && zerop(a)) || (invb && zerop(b))) return null;
  if (scalarOkay && isObjVec(a) && isObjVec(b)) {
    const r = inva ? (invb ? div(div(I(1), a), b) : div(b, a)) : invb ? div(a, b) : mul(a, b);
    return isObjVec(r) ? r : null;
  }
  if (isOp(a, '^') && inva && looksNeg(a.a[1])) return mul(pow(a.a[0], neg(a.a[1])), b);
  if (isOp(b, '^') && invb && looksNeg(b.a[1])) return mul(a, pow(b.a[0], neg(b.a[1])));
  let apow = I(1);
  let bpow = I(1);
  let aFromExp = false;
  let bFromExp = false;
  if (a.t === 'op' || isFlt(a) || isFrac(a)) {
    if (isOp(a, '^') && (mode.simplifying || isNum(a.a[1]))) {
      apow = a.a[1];
      a = a.a[0];
    } else if (isOp(a, 'sqrt')) {
      apow = frac(1n, 2n);
      a = a.a[0];
    } else if (isOp(a, 'exp') && (mode.simplifying || isNum(a.a[0]))) {
      apow = a.a[0];
      a = E_FORM;
      aFromExp = true;
    }
  }
  if (isFrac(a) && a.n < a.d) {
    a = div(I(1), a);
    apow = neg(apow);
  }
  if (b.t === 'op' || isFlt(b) || isFrac(b)) {
    if (isOp(b, '^') && (mode.simplifying || isNum(b.a[1]))) {
      bpow = b.a[1];
      b = b.a[0];
    } else if (isOp(b, 'sqrt')) {
      bpow = frac(1n, 2n);
      b = b.a[0];
    } else if (isOp(b, 'exp') && (mode.simplifying || isNum(b.a[0]))) {
      bpow = b.a[0];
      b = E_FORM;
      bFromExp = true;
    }
  }
  if (isFrac(b) && b.n < b.d) {
    b = div(I(1), b);
    bpow = neg(bpow);
  }
  if (inva) apow = neg(apow);
  if (invb) bpow = neg(bpow);
  if (mode.simplifying ? commutativeEqual(a, b) : equal(a, b)) {
    let sumpow = add(apow, bpow);
    if (!isInt(a) || zerop(sumpow) || isFrac(apow) === isFrac(bpow)) {
      if (looksNeg(sumpow) && isRat(a) && posp(a)) {
        a = div(I(1), a);
        sumpow = neg(sumpow);
      }
      if (equal(sumpow, frac(1n, 2n))) return O('sqrt', a);
      if (equal(sumpow, frac(-1n, 2n))) return div(I(1), O('sqrt', a));
      if (aFromExp && bFromExp) return O('exp', sumpow); // Calc compares these with eq, so a plain e (a variable) does not count
      return pow(a, sumpow);
    }
  }
  if (equal(apow, bpow) && isInt(a) && isInt(b) && a.v >= 0n && b.v >= 0n) {
    if (equal(apow, frac(1n, 2n))) return O('sqrt', mul(a, b));
    if (equal(apow, frac(-1n, 2n))) return div(I(1), O('sqrt', mul(a, b)));
    return pow(mul(a, b), apow);
  }
  return null;
}

/** @param {Form} a @param {Form} b @returns {Form} */
export function pow(a, b) {
  if (equal(b, V('nan'))) return b;
  if (zerop(a)) {
    if (isNum(b) && posp(b)) return isFlt(b) ? F(0) : a;
    return powOfZero(a, b);
  }
  if (eqInt(a, 1) && isInt(a)) return a;
  if (isInt(b) && b.v === 1n) return a;
  if (equal(a, F(1)) || equal(b, F(1))) return a;
  if (zerop(b)) return isFlt(a) || isFlt(b) ? F(1) : I(1);
  if (isInt(b) && isNum(a)) return ipow(a, b.v);
  if (isInt(b) && isVec(a)) return VEC(a.items.map((/** @type {Form} */ x) => pow(x, b)));
  const viaInterval = intvPow(a, b);
  if (viaInterval) return viaInterval;
  return powFancy(a, b);
}

/** @param {Form} a @param {bigint} n @returns {Form} */
function ipow(a, n) {
  if (isInt(a) && n >= 0n) return { t: 'int', v: a.v ** n };
  if (isFrac(a) && n >= 0n) return frac(a.n ** n, a.d ** n);
  // Calc works to two extra digits while it squares its way to the power, then rounds
  workDigits = 14;
  try {
    const raw = ipowSteps(a, n);
    workDigits = 12;
    workDigits = 12;
    return isFlt(raw) ? makeFloat(raw.m, raw.e) : raw;
  } finally {
    workDigits = 12;
  }
}

/** math-ipow: a to the integer power n by repeated squaring, in the order Calc multiplies. @param {Form} a @param {bigint} n @returns {Form} */
function ipowSteps(a, n) {
  if (n < 0n) return ipowSteps(div(I(1), a), -n);
  if (n === 0n) return I(1);
  if (n === 1n) return a;
  const squared = mul(a, a);
  return n % 2n === 0n ? ipowSteps(squared, n / 2n) : mul(a, ipowSteps(squared, n / 2n));
}

/** @param {Form} a @param {Form} b @returns {Form} */
function powOfZero(a, b) {
  if (isFlt(b)) a = toFloatForm(a);
  if (isInt(b) && b.v === 0n) return I(1);
  if (zerop(b)) throw new SymbolicReject('Indeterminate form');
  if (knownSigns(b) === 4) return a;
  if (knownSigns(b) === 1) return div(I(1), a);
  return O('^', a, b);
}

/** @param {Form} a @param {Form} b @returns {Form} */
function powFancy(a, b) {
  if (isNum(a) && isNum(b)) {
    const x = toNumber(a);
    const y = toNumber(b);
    if (x < 0 && !Number.isInteger(y)) throw new SymbolicUnsupported('complex power');
    if (isFrac(b) && y === 0.5 && isInt(a)) {
      const root = Math.sqrt(Number(a.v));
      if (Number.isInteger(root)) return I(root);
    }
    return F(Math.pow(x, y));
  }
  if (isOp(a, '*') && (numIntegerp(b))) return mul(pow(a.a[0], b), pow(a.a[1], b));
  if (isOp(a, '/') && numIntegerp(b)) return div(pow(a.a[0], b), pow(a.a[1], b));
  if (isOp(a, '^') && numIntegerp(b)) return pow(a.a[0], mul(a.a[1], b));
  if (isOp(a, 'sqrt') && numIntegerp(b)) return pow(a.a[0], div(b, I(2)));
  if (looksNeg(a) && isInt(b)) {
    if (evenp(b)) return pow(neg(a), b);
    return neg(pow(neg(a), b));
  }
  if (infinitep(a)) {
    if (equal(a, V('nan'))) return a;
    if (posp(b)) return a;
    if (negp(b)) return isFlt(b) ? F(0) : I(0);
    return V('nan');
  }
  return O('^', a, b);
}

/** Calc's `%` (floor modulo) and `\` (floor integer division) on numbers. @param {string} f @param {Form} a @param {Form} b @returns {Form | null} */
function numericIntegerOp(f, a, b) {
  if (!isNum(a) || !isNum(b)) return null;
  if (zerop(b)) throw new SymbolicDivisionByZero(a);
  if (isInt(a) && isInt(b)) {
    const av = /** @type {bigint} */ (a.v);
    const bv = /** @type {bigint} */ (b.v);
    if (f === '%') {
      const m = av % bv;
      return I(m !== 0n && m < 0n !== bv < 0n ? m + bv : m);
    }
    const q = av / bv;
    return I(av % bv !== 0n && av < 0n !== bv < 0n ? q - 1n : q);
  }
  const x = toNumber(a);
  const y = toNumber(b);
  return f === '%' ? F(x - y * Math.floor(x / y)) : I(Math.floor(x / y));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Evaluation of a parsed form
// ---------------------------------------------------------------------------------------------------------------------------------

/** What `!` turns a comparison into (calc-tweak-eqn-table). */
const COMPLEMENT = /** @type {Record<string, string>} */ ({ eq: 'neq', neq: 'eq', lt: 'geq', gt: 'leq', leq: 'gt', geq: 'lt' });
/** The comparison with its operands' signs flipped. */
const MIRROR = /** @type {Record<string, string>} */ ({ eq: 'eq', neq: 'neq', lt: 'gt', gt: 'lt', leq: 'geq', geq: 'leq' });

/** Calc's math-compare: -1, 0, 1, or 2 when it cannot tell. @param {Form} a @param {Form} b */
export function compare(a, b) {
  if (equal(a, b)) return (a.t === 'var' || (a.t === 'op' && (a.f === 'neg' || a.f === '*' || a.f === '/'))) && infinitep(a) ? 2 : 0;
  if (isNum(a) && isNum(b)) {
    if (isInt(a) && isInt(b)) return a.v < b.v ? -1 : 1;
    const d = numAdd(a, negNumber(b));
    return posp(d) ? 1 : negp(d) ? -1 : 0;
  }
  if (isIntv(a) && isNum(b)) {
    let res = compare(a.lo, b);
    if (res === 1 || (res === 0 && !(a.mask & 2))) return 1;
    res = compare(a.hi, b);
    if (res === -1 || (res === 0 && !(a.mask & 1))) return -1;
    return 2;
  }
  if (isIntv(b) && isNum(a)) {
    let res = compare(a, b.lo);
    if (res === -1 || (res === 0 && !(b.mask & 2))) return -1;
    res = compare(a, b.hi);
    if (res === 1 || (res === 0 && !(b.mask & 1))) return 1;
    return 2;
  }
  if (isIntv(a) && isIntv(b)) {
    let res = compare(a.hi, b.lo);
    if (res === -1 || (res === 0 && (!(a.mask & 1) || !(b.mask & 2)))) return -1;
    res = compare(a.lo, b.hi);
    if (res === 1 || (res === 0 && (!(a.mask & 2) || !(b.mask & 1)))) return 1;
    return 2;
  }
  if (infinitep(a) || infinitep(b) || a.t === 'var') return 2;
  if (a.t === 'op' && b.t === 'op' && a.f === b.f && a.a.length === b.a.length && a.a.every((/** @type {Form} */ x, /** @type {number} */ i) => compare(x, b.a[i]) === 0)) return 0;
  return 2;
}

/** @param {string} f @param {Form} a @param {Form} b @param {...Form} more @returns {Form} */
function comparison(f, a, b, ...more) {
  if (more.length) return nAryEquation(f, [a, b, ...more]);
  if (a.t === 'cplx' || b.t === 'cplx') return O(f, a, b); // complex numbers have no order: the comparison stays as written
  if (isVec(a) || isVec(b)) {
    if ((f === 'eq' || f === 'neq') && (isVec(a) ? isVec(b) : isNum(a)) && (isVec(b) ? isVec(a) : isNum(b))) throw new SymbolicUnsupported('vector equality'); // a name against a vector stays an equation
    return O(f, a, b); // Calc does not order vectors: the comparison stays as written
  }
  const res = compare(a, b);
  if (f === 'eq' || f === 'neq') {
    if (res === 0) return I(f === 'eq' ? 1 : 0);
    if (res !== 2 || (isNum(a) && isNum(b))) return I(f === 'eq' ? 0 : 1);
  } else {
    const truth = { lt: res === -1, gt: res === 1, leq: res !== 1, geq: res !== -1 }[/** @type {'lt' | 'gt' | 'leq' | 'geq'} */ (f)];
    if (res !== 2) return I(truth ? 1 : 0);
  }
  if ((looksNeg(a) || zerop(a)) && (looksNeg(b) || zerop(b))) return O(MIRROR[f], neg(a), neg(b));
  return O(f, a, b);
}

/** a = b = c: 1 when all agree, 0 when two provably differ, else what is left. @param {string} f @param {Form[]} list @returns {Form} */
function nAryEquation(f, list) {
  if (list.some(isVec)) throw new SymbolicUnsupported('vector comparison');
  if (f === 'eq') {
    const rest = [...list];
    for (let i = 0; i < rest.length - 1; i++) {
      for (let j = i + 1; j < rest.length; j++) {
        const res = compare(rest[i], rest[j]);
        if (res === 0) {
          rest.splice(j, 1);
          j--;
        } else if (res !== 2 || (isNum(rest[i]) && isNum(rest[j]))) return I(0);
      }
    }
    return rest.length > 1 ? O('eq', ...rest) : I(1);
  }
  let allKnown = true;
  for (let i = 0; i < list.length - 1; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const res = compare(list[i], list[j]);
      if (res === 0) return I(0);
      if (res === 2 && !(isNum(list[i]) && isNum(list[j]))) allKnown = false;
    }
  }
  return allKnown ? I(1) : O('neq', ...list);
}

/** @param {Form} a */
function isTrue(a) {
  return isNum(a) ? !zerop(a) : [1, 4, 5, 8, 9, 12, 13].includes(knownSigns(a));
}

const NONSCALAR = new Set(['vec', 'idn', 'diag', 'cvec', 'index', 'trn', 'append', 'cons', 'rcons', 'tail', 'rhead']);
const SCALAR_FUNCTIONS = new Set(['det', 'cnorm', 'rnorm', 'vlen', 'vcount', 'vsum', 'vprod', 'vmin', 'vmax']);
const REAL_SCALAR = new Set(['%', 'idiv', 'abs', 'choose', 'perm', 'eq', 'neq', 'lt', 'gt', 'leq', 'geq', 'lnot', 'max', 'min']);
const SCALAR_IF_ARGS = new Set(['+', '-', '*', '/', 'neg']);
const CONSTANT_VARS = new Set(['pi', 'e', 'inf', 'uinf', 'nan']);

/** math-check-known-matrixp. @param {Form} a @returns {boolean} */
export function knownMatrix(a) {
  if (a.t === 'vec') return true;
  if (a.t !== 'op') return false;
  if (NONSCALAR.has(a.f)) return true;
  if (SCALAR_IF_ARGS.has(a.f)) return a.a.some(knownMatrix);
  if (a.f === '^') return knownMatrix(a.a[0]);
  return false;
}

/** math-check-known-scalarp. @param {Form} a @returns {boolean} */
export function knownScalar(a) {
  if (isNum(a) || a.t === 'intv' || a.t === 'cplx') return true;
  if (a.t === 'var') return CONSTANT_VARS.has(a.name);
  if (a.t !== 'op') return false;
  if (SCALAR_FUNCTIONS.has(a.f) || REAL_SCALAR.has(a.f)) return true;
  if (SCALAR_IF_ARGS.has(a.f)) return a.a.every(knownScalar);
  if (a.f === '^') return knownScalar(a.a[0]);
  return false;
}


/** @type {(s: number) => number} math-neg-signs */
const negSigns = (s) => (s >= 8 ? 8 + negSigns(s - 8) : (s & 1 ? 4 : 0) + (s & 2) + (s & 4 ? 1 : 0));

/** Math-posp / Math-negp on any form: a number, an interval, or an infinity. @param {Form} a @returns {boolean} */
function mathPosp(a) {
  if (isNum(a)) return posp(a);
  if (isIntv(a)) return mathPosp(a.lo) || (zerop(a.lo) && !(a.mask & 2));
  return a.t === 'var' && a.name === 'inf';
}
/** @param {Form} a @returns {boolean} */
function mathNegp(a) {
  if (isNum(a)) return negp(a);
  if (isIntv(a)) return mathNegp(a.hi) || (zerop(a.hi) && !(a.mask & 1));
  return isOp(a, 'neg') && a.a[0].t === 'var' && a.a[0].name === 'inf';
}

const REAL_FUNCTIONS = new Set(['arg', 're', 'im', 'floor', 'ceil', 'trunc', 'round', 'rounde', 'roundu', 'ffloor', 'fceil', 'ftrunc', 'fround', 'frounde', 'froundu']);
const REAL_SCALAR_FUNCTIONS = new Set(['%', 'idiv', 'abs', 'choose', 'perm', 'eq', 'neq', 'lt', 'gt', 'leq', 'geq', 'lnot', 'max', 'min']);
const REAL_IF_ARG_FUNCTIONS = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arctan', 'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth', 'exp', 'gamma', 'fact']);
const NONNEGATIVE_FUNCTIONS = new Set(['cnorm', 'rnorm', 'vlen', 'vcount']);

/**
 * Which signs a form may have: the sum of 1 (may be negative), 2 (may be zero), 4 (may be positive) and 8 (may be nonreal).
 * `origin` asks about the form minus that number instead. A port of math-possible-signs.
 * @param {Form} a @param {Form} [origin] @returns {number}
 */
export function possibleSigns(a, origin) {
  if (isNum(a) || isIntv(a) || a.t === 'cplx') {
    if (origin) a = sub(a, origin);
    if (a.t === 'cplx') return 8;
    if (mathPosp(a)) return 4;
    if (mathNegp(a)) return 1;
    if (isNum(a) && zerop(a)) return 2;
    if (isIntv(a)) return mathPosp(a.lo) ? 4 : mathNegp(a.hi) ? 1 : zerop(a.lo) ? 6 : zerop(a.hi) ? 3 : 7;
    return 8;
  }
  if (a.t === 'op' && (a.f === '+' || a.f === '-')) {
    const [x, y] = a.a;
    if (isNum(x)) {
      if (a.f === '-') return negSigns(possibleSigns(y, origin ? add(origin, x) : x));
      return possibleSigns(y, origin ? sub(origin, x) : neg(x));
    }
    if (isNum(y)) {
      const org = a.f === '-' ? y : neg(y);
      return possibleSigns(x, origin ? add(origin, org) : org);
    }
    const s1 = possibleSigns(x, origin);
    let s2 = possibleSigns(y);
    if (a.f === '-') s2 = negSigns(s2);
    if (s1 === s2) return s1;
    if (s1 === 2) return s2;
    if (s2 === 2) return s1;
    if (s1 >= 8 || s2 >= 8) return 15;
    if ((s1 === 4 && s2 === 6) || (s2 === 4 && s1 === 6)) return 4;
    if ((s1 === 1 && s2 === 3) || (s2 === 1 && s1 === 3)) return 1;
    return 7;
  }
  if (isOp(a, 'neg')) return negSigns(possibleSigns(a.a[0], origin ? neg(origin) : undefined));
  if (origin && zerop(origin)) origin = undefined;
  if (a.t === 'op' && (a.f === '*' || (a.f === '/' && origin)) && isNum(a.a[0])) {
    let s;
    if (a.f === '*') s = zerop(a.a[0]) ? possibleSigns(I(0), origin) : possibleSigns(a.a[1], div(origin || I(0), a.a[0]));
    else s = negSigns(possibleSigns(a.a[1], div(a.a[0], origin)));
    return negp(a.a[0]) ? negSigns(s) : s;
  }
  if (a.t === 'op' && (a.f === '*' || a.f === '/') && isNum(a.a[1])) {
    const s = possibleSigns(a.a[0], a.f === '*' ? mul(origin || I(0), a.a[1]) : div(origin || I(0), a.a[1]));
    return negp(a.a[1]) ? negSigns(s) : s;
  }
  if (a.t === 'vec') {
    let signs = 0;
    for (const item of a.items) {
      if (signs >= 15) break;
      signs |= possibleSigns(item, origin);
    }
    return signs;
  }
  /** @type {number | null} */ let sign = null;
  if (a.t === 'op') {
    const [x, y] = a.a;
    const f = a.f;
    if ((f === '*' || f === '/') && a.a.length === 2) {
      const s1 = possibleSigns(x);
      const s2 = possibleSigns(y);
      if (s1 >= 8 || s2 >= 8) sign = 15;
      else if (f === '/' && [2, 3, 6, 7].includes(s2)) sign = 15;
      else sign = ([4, 5, 6, 7].includes(s1) ? s2 : 0) | ([2, 3, 6, 7].includes(s1) ? 2 : 0) | ([1, 3, 5, 7].includes(s1) ? negSigns(s2) : 0);
    } else if (f === '^' && a.a.length === 2) {
      const s1 = possibleSigns(x);
      const s2 = possibleSigns(y);
      if (s1 >= 8 || s2 >= 8) sign = 15;
      else if (s1 === 4) sign = 4;
      else if (s1 === 2) sign = s2 === 4 ? 2 : 15;
      else if (s2 === 2) sign = s1 === 1 || s1 === 5 ? 2 : 15;
      else if (isInt(y)) sign = evenp(y) ? ([3, 6, 7].includes(s1) ? 6 : 4) : s1;
      else if (s1 === 6) sign = s2 === 4 ? 6 : 15;
      else sign = 7;
    } else if (f === '%' && a.a.length === 2) {
      const s2 = possibleSigns(y);
      sign = s2 >= 8 ? 7 : s2 === 2 ? 2 : s2 === 4 || s2 === 6 ? 6 : s2 === 1 || s2 === 3 ? 3 : 7;
    } else if ((f === 'abs' || f === 'abssqr') && a.a.length === 1) {
      const s1 = possibleSigns(x);
      sign = s1 === 2 ? 2 : [1, 4, 5].includes(s1) ? 4 : 6;
    } else if (f === 'exp' && a.a.length === 1) {
      const s1 = possibleSigns(x);
      if (s1 >= 8) sign = 15;
      else if (!origin || mathNegp(origin)) sign = 4;
      else {
        origin = sub(origin, I(1));
        if (zerop(origin)) origin = undefined;
        sign = s1;
      }
    } else if (((f === 'ln' || f === 'log10') && a.a.length === 1) || (f === 'log' && a.a.length === 2 && possibleSigns(y) === 4)) {
      sign = [2, 4, 6].includes(possibleSigns(x)) ? possibleSigns(x, I(1)) : 15;
    } else if (f === 'sqrt' && a.a.length === 1) {
      const s1 = possibleSigns(x);
      sign = [2, 4, 6].includes(s1) ? s1 : 15;
    } else if (NONNEGATIVE_FUNCTIONS.has(f)) sign = 6;
    else if (REAL_FUNCTIONS.has(f) || REAL_SCALAR_FUNCTIONS.has(f)) sign = 7;
    else if (REAL_IF_ARG_FUNCTIONS.has(f) && a.a.length === 1) sign = possibleSigns(x) < 8 ? 7 : 15;
  }
  if (sign !== null) {
    if (origin) return (sign & 8) + (mathPosp(origin) ? ([1, 2, 3, 8, 9, 10, 11].includes(sign) ? 1 : 7) : [2, 4, 6, 8, 10, 12, 14].includes(sign) ? 4 : 7);
    return sign;
  }
  if (a.t === 'var') {
    if (a.name === 'pi' || a.name === 'e') return origin ? possibleSigns(F(a.name === 'pi' ? Math.PI : Math.E), origin) : 4;
    if (a.name === 'inf') return 4;
    if (a.name === 'uinf') return 13;
    if (a.name === 'i') return 8;
  }
  return 15;
}

/** @param {Form} a @returns {number} */
function knownSigns(a) {
  return possibleSigns(a);
}

/** @type {{ numericCall: ((name: string, args: Form[]) => Form | null) | null, strict: boolean, simplifier: ((form: Form, dangerous: boolean) => Form) | null, degrees: boolean }} */
const hooks = { numericCall: null, strict: false, simplifier: null, degrees: false };
/** Functions other modules supply (solve, expand): name to implementation, which returns null to leave the call as written. @type {Map<string, (args: Form[]) => Form | null>} */
const registered = new Map();

/** In strict mode a function whose numbers the table engine cannot compute is not left as written; the caller falls back to that engine.
 * @param {boolean} on */
export function setStrictFunctions(on) {
  hooks.strict = on;
}

/** Lets the table engine evaluate a function Calc can compute (sqrt(4), sin(0.5)) when every argument is a plain number.
 * @param {(name: string, args: Form[]) => Form | null} fn */
export function setNumericCall(fn) {
  hooks.numericCall = fn;
}

/** Hands `simplify` and `esimplify` to calc-simplify.js (which imports this module). @param {(form: Form, dangerous: boolean) => Form} fn */
export function setSimplifier(fn) {
  hooks.simplifier = fn;
}

/** Calc's angle mode for the symbolic rules (derivatives of sin, arctan, ...). @param {boolean} on */
export function setAngleDegrees(on) {
  hooks.degrees = on;
}

/** @returns {boolean} whether angles are in degrees */
export function angleIsDegrees() {
  return hooks.degrees;
}

/** Lets another module supply a Calc function. @param {string} name @param {(args: Form[]) => Form | null} fn */
export function registerFunction(name, fn) {
  registered.set(name, fn);
}

/** Evaluate a parsed expression the way Calc's normalizer does: bottom-up, arguments first. @param {Form} form @returns {Form} */
export function normalize(form) {
  if (form.t === 'vec') return VEC(form.items.map(normalize));
  if (form.t === 'intv') return makeIntv(form.mask, normalize(form.lo), normalize(form.hi));
  if (form.t === 'cplx') return { t: 'cplx', re: normalize(form.re), im: normalize(form.im) };
  if (form.t !== 'op') return form;
  const args = form.a.map(normalize);
  try {
    return apply(form, args);
  } catch (err) {
    if (err instanceof SymbolicReject) return O(form.f, ...args);
    throw err;
  }
}

/** @param {Form} form @param {Form[]} args @returns {Form} */
function apply(form, args) {
  if (args.some((/** @type {Form} */ x) => x.t === 'cplx') && !['lt', 'gt', 'leq', 'geq'].includes(form.f)) throw new SymbolicUnsupported('complex arithmetic');
  switch (form.f) {
    case '+':
      return add(args[0], args[1]);
    case '-':
      return sub(args[0], args[1]);
    case '*':
      return mul(args[0], args[1]);
    case '/':
      return div(args[0], args[1]);
    case '^':
      return pow(args[0], args[1]);
    case 'neg':
      return neg(args[0]);
    case '%':
    case 'idiv': {
      if (args.length !== 2) return O('idiv', ...args);
      const r = numericIntegerOp(form.f === '%' ? '%' : '\\', args[0], args[1]);
      return r ?? O(form.f, args[0], args[1]);
    }
    case 'percent':
      return isNum(args[0]) ? div(args[0], I(100)) : O('percent', args[0]);
    case 'lt':
    case 'gt':
    case 'leq':
    case 'geq':
    case 'eq':
    case 'neq':
      return comparison(form.f, args[0], args[1], ...args.slice(2));
    case 'lnot': {
      const a = args[0];
      if (zerop(a)) return I(1);
      if (isTrue(a)) return I(0);
      const flip = a.t === 'op' && a.a.length === 2 ? COMPLEMENT[a.f] : undefined;
      return flip ? O(flip, a.a[0], a.a[1]) : O('lnot', a);
    }
    case 'land': {
      const [x, y] = args;
      if (zerop(x)) return x;
      if (zerop(y)) return y;
      if (isTrue(x)) return y;
      if (isTrue(y)) return x;
      return O('land', x, y);
    }
    case 'lor': {
      const [x, y] = args;
      if (zerop(x)) return y;
      if (zerop(y)) return x;
      if (isTrue(x)) return x;
      if (isTrue(y)) return y;
      return O('lor', x, y);
    }
    case 'if':
      if (args.length === 3 && isNum(args[0])) return zerop(args[0]) ? args[2] : args[1];
      return O('if', ...args);
    default:
      return callFunction(form.f, args);
  }
}

/** math-abs. @param {Form} a @returns {Form} */
function abs(a) {
  if (isNum(a)) return negp(a) ? neg(a) : a;
  if (looksNeg(a)) return O('abs', neg(a));
  const signs = knownSigns(a);
  if (signs === 2 || signs === 4 || signs === 6) return a;
  if (signs === 1 || signs === 3) return neg(a);
  return O('abs', a);
}

/** The symbolic rules of math-sqrt. @param {Form} a @returns {Form} */
function sqrtSymbolic(a) {
  const s = knownSigns(a);
  if (s === 1 || s === 3) throw new SymbolicUnsupported('imaginary square root');
  if (isOp(a, '*') && ([2, 4, 6].includes(knownSigns(a.a[0])) || [2, 4, 6].includes(knownSigns(a.a[1])))) return mul(callFunction('sqrt', [a.a[0]]), callFunction('sqrt', [a.a[1]]));
  if (isOp(a, '/')) {
    if ([2, 4, 6].includes(knownSigns(a.a[1]))) return div(callFunction('sqrt', [a.a[0]]), callFunction('sqrt', [a.a[1]]));
    if ([2, 4, 6].includes(knownSigns(a.a[0])) && !eqInt(a.a[0], 1)) return mul(callFunction('sqrt', [a.a[0]]), callFunction('sqrt', [div(I(1), a.a[1])]));
  }
  if (isOp(a, '^') && evenp(a.a[1]) && knownSigns(a.a[0]) < 8) return abs(pow(a.a[0], div(a.a[1], I(2))));
  return O('sqrt', a);
}

/** @param {string} name @param {Form[]} args @returns {Form} */
export function callFunction(name, args) {
  const vec = args.length === 1 && isVec(args[0]) ? args[0].items : null;
  switch (name) {
    case 'vec':
      return VEC(args);
    case 'vsum':
      if (vec) return vec.length === 0 ? I(0) : vec.reduce((/** @type {Form} */ x, /** @type {Form} */ y) => add(x, y));
      break;
    case 'vprod':
      if (vec) return vec.length === 0 ? I(1) : vec.reduce((/** @type {Form} */ x, /** @type {Form} */ y) => mul(x, y));
      break;
    case 'vmean':
      if (vec && vec.length) return div(callFunction('vsum', args), I(vec.length));
      if (vec) return O('vmean', args[0]);
      break;
    case 'vcount':
    case 'vlen':
      if (vec) return I(vec.length);
      break;
    case 'vflat':
      if (vec) return VEC(vec.flatMap((/** @type {Form} */ x) => (isVec(x) ? x.items : [x])));
      break;
    case 'vmax':
    case 'vmin':
      if (vec && vec.length) return vec.reduce((/** @type {Form} */ x, /** @type {Form} */ y) => callFunction(name === 'vmax' ? 'max' : 'min', [x, y]));
      if (vec) return name === 'vmin' ? V('inf') : O('neg', V('inf'));
      break;
    case 'vmedian':
    case 'vvar':
    case 'vpvar':
    case 'vsdev':
    case 'vpsdev':
      if (vec && vec.length === 0) return O(name, args[0]);
      if (vec && name !== 'vmedian' && vec.some((/** @type {Form} */ x) => x.t === 'var' && x.name === 'nan')) return V('nan'); // an empty field read as nan spoils the statistic
      if (vec && hooks.strict) throw new SymbolicUnsupported(name);
      if (vec && vec.every(isNum) && name === 'vmedian') {
        const sorted = [...vec].sort((x, y) => toNumber(x) - toNumber(y));
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : div(add(sorted[mid - 1], sorted[mid]), I(2));
      }
      if (vec && vec.every(isNum)) throw new SymbolicUnsupported(name);
      break;
    case 'max':
    case 'min':
      if (args.length === 2 && ((isNum(args[0]) && args[1].t === 'var' && args[1].name === 'nan') || (isNum(args[1]) && args[0].t === 'var' && args[0].name === 'nan'))) return V('nan');
      if (args.length === 2 && isNum(args[0]) && isNum(args[1])) {
        const pickFirst = name === 'max' ? toNumber(args[0]) >= toNumber(args[1]) : toNumber(args[0]) <= toNumber(args[1]);
        return pickFirst ? args[0] : args[1];
      }
      break;
    default:
      break;
  }
  if ((name === 'simplify' || name === 'esimplify') && args.length === 1 && hooks.simplifier) return hooks.simplifier(args[0], name === 'esimplify');
  const supplied = registered.get(name);
  if (supplied) {
    const result = supplied(args);
    if (result) return result;
  }
  if (name === 'in' && args.length === 2) {
    const r = isIn(args[0], args[1]);
    if (r) return r;
  }
  if (args.length === 1 && isIntv(args[0]) && intvConst(args[0])) {
    const x = args[0];
    if (name === 'sqrt' && !negp(x.lo)) return makeIntv(x.mask, callFunction('sqrt', [x.lo]), callFunction('sqrt', [x.hi]));
    if (name === 'abs') return intvAbs(x);
  }
  if (args.length === 1) {
    const x = args[0];
    if (name === 'abs') return abs(x);
    if (name === 'sqrt' && !isNum(x)) return sqrtSymbolic(x);
    if (name === 'ln' && !isNum(x)) {
      if (x.t === 'var' && x.name === 'e') return I(1);
      if (isOp(x, '^') && equal(x.a[0], V('e')) && knownSigns(x.a[1]) < 8) return x.a[1];
    }
    if (name === 'ln' && isNum(x)) {
      if (zerop(x)) throw new SymbolicReject('Logarithm of zero');
      if (eqInt(x, 1) && isInt(x)) return I(0);
      if (negp(x)) throw new SymbolicUnsupported('complex logarithm');
    }
    if (name === 'exp' && isInt(x) && x.v === 0n) return I(1);
    if (name === 'sqrt' && isNum(x) && negp(x)) throw new SymbolicUnsupported('complex square root');
    if (name === 'sqrt' && isFrac(x) && !negp(x)) {
      const isqrt = (/** @type {bigint} */ v) => BigInt(Math.round(Math.sqrt(Number(v))));
      const n = isqrt(x.n);
      const d = isqrt(x.d);
      if (n * n === x.n && d * d === x.d) return frac(n, d); // a perfect square fraction has an exact root
    }
  }
  if (args.length > 0 && args.every(isNum) && hooks.numericCall) {
    const value = hooks.numericCall(name, args);
    if (value) return value;
    if (hooks.strict) throw new SymbolicUnsupported(`${name} of numbers`);
  }
  if (hooks.strict && !args.some(mentionsConstant)) throw new SymbolicUnsupported(`${name} left as written`); // only pi and e justify leaving a function unevaluated here
  return O(name, ...args);
}

/** @param {Form} a @returns {boolean} */
function mentionsConstant(a) {
  if (a.t === 'var') return a.name === 'pi' || a.name === 'e';
  if (a.t === 'vec') return a.items.some(mentionsConstant);
  return a.t === 'op' && a.a.some(mentionsConstant);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading cell text as Calc algebra (calc-aent.el)
// ---------------------------------------------------------------------------------------------------------------------------------

/** @typedef {{ kind: 'num' | 'frac' | 'id' | 'op', text: string }} Tok */

/** @param {string} text @returns {Tok[]} */
function lex(text) {
  /** @type {Tok[]} */ const out = [];
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let m;
    if ((m = /^\s+/.exec(rest))) {
      i += m[0].length;
    } else if (rest.startsWith('..')) {
      out.push({ kind: 'op', text: '..' });
      i += 2;
    } else if ((m = /^\d+:\d+(?::\d+)?/.exec(rest))) {
      out.push({ kind: 'frac', text: m[0] });
      i += m[0].length;
    } else if ((m = /^\d+_(?:\d+|[A-Za-z_][A-Za-z0-9_']*)(?:_[A-Za-z0-9_']*)?/.exec(rest))) { // 1_0 is a name; the digits after the underscore are read as a number (1_000 is 1_0)
      out.push({ kind: 'id', text: m[0].replace(/_(\d+)/g, (_all, d) => `_${Number(d)}`) });
      i += m[0].length;
    } else if ((m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest))) {
      out.push({ kind: 'num', text: m[0] });
      i += m[0].length;
      if (text[i] === '.' && /^\.\d|^\./.test(text.slice(i))) throw new SymbolicSyntaxError('stray decimal point');
    } else if ((m = /^[A-Za-z][A-Za-z0-9_']*/.exec(rest))) {
      out.push({ kind: 'id', text: m[0] });
      i += m[0].length;
    } else if ((m = /^(?:<=|>=|==|!=|&&|\|\||[-+*/^%\\!<>=()[\],])/.exec(rest))) {
      out.push({ kind: 'op', text: m[0] });
      i += m[0].length;
    } else {
      throw new SymbolicSyntaxError(`cannot read "${rest[0]}"`);
    }
  }
  return out;
}

const BINARY = new Map([
  ['+', { f: '+', l: 180, r: 181 }],
  ['-', { f: '-', l: 180, r: 181 }],
  ['*', { f: '*', l: 196, r: 195 }],
  ['/', { f: '/', l: 190, r: 191 }],
  ['%', { f: '%', l: 190, r: 191 }],
  ['\\', { f: 'idiv', l: 190, r: 191 }],
  ['^', { f: '^', l: 201, r: 200 }],
  ['<', { f: 'lt', l: 160, r: 161 }],
  ['>', { f: 'gt', l: 160, r: 161 }],
  ['<=', { f: 'leq', l: 160, r: 161 }],
  ['>=', { f: 'geq', l: 160, r: 161 }],
  ['=', { f: 'eq', l: 160, r: 161 }],
  ['==', { f: 'eq', l: 160, r: 161 }],
  ['!=', { f: 'neq', l: 160, r: 161 }],
  ['&&', { f: 'land', l: 110, r: 111 }],
  ['||', { f: 'lor', l: 100, r: 101 }],
]);

/** Parse a piece of text as a Calc expression (not yet evaluated). @param {string} text @returns {Form} */
export function parseExpression(text) {
  const toks = lex(text);
  let pos = 0;
  const peek = () => toks[pos];
  /** @param {string} s */
  const isOpTok = (s) => peek() && peek().kind === 'op' && peek().text === s;
  /** @param {string} s */
  const expect = (s) => {
    if (!isOpTok(s)) throw new SymbolicSyntaxError(`expected ${s}`);
    pos++;
  };
  let juxtaposition = true; // false inside [ ]: there, side by side means separate elements
  /** Does the next token start an operand, so that juxtaposition means multiplication? */
  const startsOperand = () => {
    const t = peek();
    return !!t && (t.kind === 'num' || t.kind === 'frac' || t.kind === 'id' || (t.kind === 'op' && (t.text === '(' || t.text === '[')));
  };

  /** @returns {Form} */
  function primary() {
    const t = peek();
    if (!t) throw new SymbolicSyntaxError('unexpected end');
    pos++;
    if (t.kind === 'num') {
      return /[.eE]/.test(t.text) ? D(t.text) : I(BigInt(t.text));
    }
    if (t.kind === 'frac') {
      const parts = t.text.split(':').map((x) => BigInt(x)); // a:b is a fraction, a:b:c is a + b/c
      const [first, second, third] = parts;
      const numerator = third === undefined ? first : first * third + second;
      const denominator = third === undefined ? second : third;
      if (denominator === 0n) throw new SymbolicSyntaxError('zero denominator'); // Calc cannot read 100:00
      return frac(numerator, denominator);
    }
    if (t.kind === 'id') {
      if (isOpTok('(')) {
        pos++;
        /** @type {Form[]} */ const args = [];
        if (!isOpTok(')')) {
          for (;;) {
            args.push(expr(0));
            if (isOpTok(',')) pos++;
            else break;
          }
        }
        expect(')');
        return O(t.text, ...args);
      }
      return V(t.text);
    }
    if (t.text === '(') {
      const outerJuxtaposition = juxtaposition;
      juxtaposition = true;
      const inner = expr(0);
      juxtaposition = outerJuxtaposition;
      if (isOpTok('..')) {
        pos++;
        const hi = isOpTok(')') || isOpTok(']') ? V('inf') : expr(0);
        if (!isOpTok(')') && !isOpTok(']')) throw new SymbolicSyntaxError('expected )');
        const closed = isOpTok(']');
        pos++;
        return { t: 'intv', mask: closed ? 1 : 0, lo: inner, hi };
      }
      if (isOpTok(',')) {
        pos++;
        const imag = expr(0);
        expect(')');
        return { t: 'cplx', re: inner, im: imag }; // only displayed and compared: arithmetic on it belongs to the complex engine
      }
      expect(')');
      return inner;
    }
    if (t.text === '[') {
      /** @type {Form[]} */ const items = [];
      const outerJuxtaposition = juxtaposition;
      juxtaposition = false; // inside a vector, elements follow one another without a comma: [1 2] and [[x][1]]
      if (!isOpTok(']')) {
        for (;;) {
          items.push(expr(0));
          if (isOpTok('..')) {
            if (items.length > 1) throw new SymbolicUnsupported('interval after a list');
            pos++;
            const hi = isOpTok(')') || isOpTok(']') ? V('inf') : expr(0);
            if (!isOpTok(')') && !isOpTok(']')) throw new SymbolicSyntaxError('expected ]');
            const closed = isOpTok(']');
            pos++;
            if (isOpTok('..')) throw new SymbolicSyntaxError('Syntax error', true);
            return { t: 'intv', mask: closed ? 3 : 2, lo: items[0], hi };
          }
          if (isOpTok(',')) pos++;
          else if (!isOpTok(']') && startsOperand()) continue;
          else break;
        }
      }
      juxtaposition = outerJuxtaposition;
      expect(']');
      return VEC(items);
    }
    if (t.text === '-') return O('neg', expr(197));
    if (t.text === '+') return expr(197);
    if (t.text === '!') return O('lnot', expr(1000));
    throw new SymbolicSyntaxError(`unexpected ${t.text}`);
  }

  /** @param {number} minPrec @returns {Form} */
  function expr(minPrec) {
    let left = primary();
    /** @type {Form | null} */ let chain = null; // the last comparison built at this level
    for (;;) {
      const t = peek();
      if (!t) break;
      if (t.kind === 'op' && t.text === '!' && 210 >= minPrec && !(toks[pos + 1] && toks[pos + 1].text === '=')) {
        pos++;
        left = O('fact', left);
        continue;
      }
      if (t.kind === 'op' && t.text === '%' && 1100 >= minPrec && !startsOperandAfter(pos + 1)) {
        pos++;
        left = O('percent', left);
        continue;
      }
      const info = t.kind === 'op' ? BINARY.get(t.text) : undefined;
      if (info) {
        if (info.l < minPrec) break;
        pos++;
        const right = expr(info.r);
        if (chain && COMPLEMENT[info.f] && chain === left) {
          // a = b = c reads as one equation with three sides; other chains are Calc's interval syntax or an error
          if ((info.f === 'eq' || info.f === 'neq') && left.f === info.f) left = O(info.f, ...left.a, right);
          else if (info.f === 'eq' || info.f === 'neq') throw new SymbolicSyntaxError('Syntax error', true);
          else if (['lt', 'leq'].includes(info.f) && ['lt', 'leq'].includes(left.f)) left = O('in', left.a[1], { t: 'intv', mask: (left.f === 'leq' ? 2 : 0) + (info.f === 'leq' ? 1 : 0), lo: left.a[0], hi: right }); // 1 < x < 5 is x in the interval (1 .. 5)
          else if (['gt', 'geq'].includes(info.f) && ['gt', 'geq'].includes(left.f)) left = O('in', left.a[1], { t: 'intv', mask: (info.f === 'geq' ? 2 : 0) + (left.f === 'geq' ? 1 : 0), lo: right, hi: left.a[0] });
          else throw new SymbolicSyntaxError('Syntax error', true);
        } else {
          left = O(info.f, left, right);
        }
        chain = COMPLEMENT[info.f] && COMPLEMENT[left.f] ? left : null;
        continue;
      }
      if (juxtaposition && startsOperand() && 196 >= minPrec) {
        const right = expr(195);
        left = O('*', left, right);
        continue;
      }
      break;
    }
    return left;
  }
  /** @param {number} p */
  function startsOperandAfter(p) {
    const t = toks[p];
    return !!t && (t.kind === 'num' || t.kind === 'frac' || t.kind === 'id' || (t.kind === 'op' && (t.text === '(' || t.text === '[' || t.text === '-' || t.text === '+')));
  }

  const result = expr(0);
  if (pos < toks.length) throw new SymbolicSyntaxError(`unexpected ${toks[pos].text}`);
  return result;
}

/** In strict mode only pi and e may stand as symbols; anything else means the table engine should decide. @param {Form} form */
export function assertNumericSymbols(form) {
  if (form.t === 'var' && form.name !== 'pi' && form.name !== 'e') throw new SymbolicUnsupported(form.name);
  if (form.t === 'vec') form.items.forEach(assertNumericSymbols);
  if (form.t === 'intv') throw new SymbolicUnsupported('interval');
  if (form.t === 'op') form.a.forEach(assertNumericSymbols);
}

/** Swap the placeholder variables of a parsed formula for the forms they stand for. @param {Form} form @param {Map<string, Form>} bound @returns {Form} */
export function substitute(form, bound) {
  if (form.t === 'var') return bound.get(form.name) ?? form;
  if (form.t === 'vec') return VEC(form.items.map((/** @type {Form} */ x) => substitute(x, bound)));
  if (form.t === 'intv') return { ...form, lo: substitute(form.lo, bound), hi: substitute(form.hi, bound) };
  if (form.t === 'op') return { ...form, a: form.a.map((/** @type {Form} */ x) => substitute(x, bound)) };
  return form;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Intervals (calc-forms.el, calc-arith.el). `mask` is Calc's: 0 is (a .. b), 1 is (a .. b], 2 is [a .. b), 3 is [a .. b].
// Only intervals with finite number ends are computed with; anything else is left as written.
// ---------------------------------------------------------------------------------------------------------------------------------

/** What swapping the two ends does to a mask. */
const FLIP_MASK = [0, 2, 1, 3];

/** math-make-intv: a closed interval of one point is that point, and a backwards one is empty. @param {number} mask @param {Form} lo @param {Form} hi @returns {Form} */
function makeIntv(mask, lo, hi) {
  if (isNum(lo) && isNum(hi)) {
    const cmp = compare(lo, hi);
    if (cmp === 0) return mask === 3 ? lo : { t: 'intv', mask, lo, hi };
    if (cmp > 0) return { t: 'intv', mask: mask === 3 ? 2 : mask, lo, hi: lo };
  }
  return { t: 'intv', mask, lo, hi };
}

/** math-intv-constp: both ends are numbers. @param {Form} a */
const intvConst = (a) => isNum(a.lo) && isNum(a.hi);

/** math-sort-intv. @param {number} mask @param {Form} lo @param {Form} hi @returns {Form} */
function sortIntv(mask, lo, hi) {
  return compare(hi, lo) === -1 ? makeIntv(FLIP_MASK[mask], hi, lo) : makeIntv(mask, lo, hi);
}

/** math-combine-intervals: the interval from the smallest to the largest of four ends. @param {Form} a @param {boolean} am @param {Form} b @param {boolean} bm @param {Form} c @param {boolean} cm @param {Form} d @param {boolean} dm @returns {Form} */
function combineIntervals(a, am, b, bm, c, cm, d, dm) {
  let res = compare(a, c);
  if (res === 1) {
    a = c;
    am = cm;
  } else if (res === 0) am = am || cm;
  res = compare(b, d);
  if (res === -1) {
    b = d;
    bm = dm;
  } else if (res === 0) bm = bm || dm;
  return makeIntv((am ? 2 : 0) + (bm ? 1 : 0), a, b);
}

/** @param {Form} a @param {Form} b @returns {Form} */
function intvAdd(a, b) {
  if (isIntv(a) && isIntv(b)) return makeIntv(a.mask & b.mask, add(a.lo, b.lo), add(a.hi, b.hi));
  if (isIntv(b)) [a, b] = [b, a];
  return makeIntv(a.mask, add(a.lo, b), add(a.hi, b));
}

/** @param {Form} a @param {Form} b @returns {Form} */
function intvMul(a, b) {
  if (isIntv(b) && isNum(a)) [a, b] = [b, a];
  if (isNum(b)) {
    if (negp(b)) return neg(intvMul(a, neg(b)));
    return makeIntv(a.mask, mul(a.lo, b), mul(a.hi, b));
  }
  if (!intvConst(a) || !intvConst(b)) return O('*', a, b);
  let lo = mul(a, b.lo);
  let hi = mul(a, b.hi);
  if (!isIntv(lo)) lo = { t: 'intv', mask: b.mask & 2 ? 3 : 0, lo, hi: lo };
  if (!isIntv(hi)) hi = { t: 'intv', mask: b.mask & 1 ? 3 : 0, lo: hi, hi };
  return combineIntervals(lo.lo, !!(b.mask & 2) && !!(lo.mask & 2), lo.hi, !!(b.mask & 2) && !!(lo.mask & 1), hi.lo, !!(b.mask & 1) && !!(hi.mask & 2), hi.hi, !!(b.mask & 1) && !!(hi.mask & 1));
}

/** @param {Form} a @param {Form} b @returns {Form} */
function intvDiv(a, b) {
  if (isNum(b)) return negp(b) ? neg(intvDiv(a, neg(b))) : makeIntv(a.mask, div(a.lo, b), div(a.hi, b));
  if (!intvConst(b)) return O('/', a, b);
  const positive = posp(b.lo) || (zerop(b.lo) && !(b.mask & 2));
  if (isNum(a)) {
    if (positive) {
      if (zerop(b.lo)) return O('/', a, b); // dividing by an interval that starts at zero reaches infinity
      return negp(a) ? neg(intvDiv(neg(a), b)) : makeIntv(FLIP_MASK[b.mask], div(a, b.hi), div(a, b.lo));
    }
    if (negp(b.hi)) return neg(intvDiv(a, neg(b)));
    throw new SymbolicReject('Division by zero'); // the interval holds zero
  }
  if (!intvConst(a)) return O('/', a, b);
  if (positive && !zerop(b.lo)) {
    let lo = div(a, b.lo);
    let hi = div(a, b.hi);
    if (!isIntv(lo)) lo = { t: 'intv', mask: b.mask & 2 ? 3 : 0, lo, hi: lo };
    if (!isIntv(hi)) hi = { t: 'intv', mask: b.mask & 1 ? 3 : 0, lo: hi, hi };
    return combineIntervals(lo.lo, !!(b.mask & 2) && !!(lo.mask & 2), lo.hi, !!(b.mask & 2) && !!(lo.mask & 1), hi.lo, !!(b.mask & 1) && !!(hi.mask & 2), hi.hi, !!(b.mask & 1) && !!(hi.mask & 1));
  }
  if (negp(b.hi)) return neg(intvDiv(a, neg(b)));
  if (positive) return O('/', a, b);
  throw new SymbolicReject('Division by zero');
}

/** An interval to a real power, or a positive number to an interval power; null when Calc has no rule. @param {Form} a @param {Form} b @returns {Form | null} */
function intvPow(a, b) {
  if (isIntv(a) && intvConst(a) && isNum(b)) {
    const natural = isInt(b) && b.v >= 0n;
    const ok = natural || posp(a.lo) || (zerop(a.lo) && posp(b)) || negp(a.hi) || (zerop(a.hi) && posp(b));
    if (!ok) return null;
    if (evenp(b)) a = intvAbs(a);
    if (!isIntv(a)) return pow(a, b);
    return sortIntv(a.mask, pow(a.lo, b), pow(a.hi, b));
  }
  if (isIntv(b) && intvConst(b) && isNum(a) && posp(a)) return sortIntv(b.mask, pow(a, b.lo), pow(a, b.hi));
  return null;
}

/** math-abs of an interval with number ends. @param {Form} a @returns {Form} */
function intvAbs(a) {
  if (posp(a.lo) || (zerop(a.lo) && !(a.mask & 2))) return a;
  const nlo = neg(a.lo);
  const res = compare(nlo, a.hi);
  if (res === 1) return makeIntv(a.mask & 2 ? 3 : 2, I(0), nlo);
  if (res === 0) return makeIntv(a.mask === 0 ? 2 : 3, I(0), nlo);
  return makeIntv(a.mask & 1 ? 3 : 2, I(0), a.hi);
}

/** calcFunc-in for an interval or a vector; null when it cannot be told. @param {Form} a @param {Form} b @returns {Form | null} */
function isIn(a, b) {
  if (isIntv(b) && isNum(a) && isNum(b.lo) && isNum(b.hi)) {
    const res = compare(a, b.lo);
    if (res === -1) return I(0);
    if (res === 0 && (b.mask !== 2 || compare(b.lo, b.hi) === -1)) return I(b.mask & 2 ? 1 : 0);
    const res2 = compare(a, b.hi);
    if (res2 === 1) return I(0);
    if (res2 === 0 && (b.mask !== 1 || compare(b.lo, b.hi) === -1)) return I(b.mask & 1 ? 1 : 0);
    return res !== 1 || res2 !== -1 ? null : I(1);
  }
  if (b.t === 'vec' && isNum(a) && b.items.every(isNum)) return I(b.items.some((/** @type {Form} */ x) => compare(a, x) === 0) ? 1 : 0);
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Printing (calccomp.el, math-compose-expr)
// ---------------------------------------------------------------------------------------------------------------------------------

/** @type {{ formatFloat: (v: number) => string }} */
const printer = { formatFloat: (v) => String(v) };

/** @param {(v: number) => string} fn */
export function setFloatFormatter(fn) {
  printer.formatFloat = fn;
}

// [text, left precedence, right precedence]: the operator table, as Calc has it when multiplication has precedence
const OPERATORS = /** @type {Record<string, [string, number, number]>} */ ({
  '+': ['+', 180, 181],
  '-': ['-', 180, 181],
  '*': ['*', 196, 195],
  '/': ['/', 190, 191],
  '%': ['%', 190, 191],
  idiv: ['\\', 190, 191],
  '^': ['^', 201, 200],
  lt: ['<', 160, 161],
  gt: ['>', 160, 161],
  leq: ['<=', 160, 161],
  geq: ['>=', 160, 161],
  eq: ['=', 160, 161],
  neq: ['!=', 160, 161],
  land: ['&&', 110, 111],
  lor: ['||', 100, 101],
});

/** @param {Form} a */
function lastTerm(a) {
  while (isOp(a, '*')) a = a.a[1];
  return a;
}

/** A float beyond what a JS number holds, in Calc's default display (8 digits, scientific). @param {Form} a */
function hugeFloat(a) {
  let digits = (a.m < 0n ? -a.m : a.m).toString();
  let exp = a.e + digits.length - 1;
  if (digits.length > 8) {
    const rounded = scaleRounding(BigInt(digits), 8 - digits.length).toString();
    if (rounded.length > 8) exp++;
    digits = rounded.slice(0, 8);
  }
  return `${a.m < 0n ? '-' : ''}${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ''}e${exp}`;
}

/** Calc's text for a form. @param {Form} a @param {number} [prec] @param {boolean} [inDivisor] @returns {string} */
export function show(a, prec = 0, inDivisor = false) {
  switch (a.t) {
    case 'int':
      return a.v.toString();
    case 'flt': {
      const v = toNumber(a);
      return Number.isFinite(v) && (v !== 0 || a.m === 0n) ? printer.formatFloat(v) : hugeFloat(a);
    }
    case 'frac':
      return `${a.n}:${a.d}`;
    case 'var':
      return a.name;
    case 'cplx':
      return `(${show(a.re, 0)}, ${show(a.im, 0)})`;
    case 'vec':
      return `[${a.items.map((/** @type {Form} */ x) => show(x, 0)).join(', ')}]`;
    case 'intv':
      return `${a.mask & 2 ? '[' : '('}${show(a.lo, 0)} .. ${show(a.hi, 0)}${a.mask & 1 ? ']' : ')'}`;
    default:
      break;
  }
  const paren = (/** @type {string} */ s) => `(${s})`;
  const x = a.a;
  if (a.f === 'if' && x.length === 3) {
    if (prec > 90) return paren(show(a, 0));
    return `${show(x[0], 91)} ? ${show(x[1], 0)} : ${show(x[2], 90)}`;
  }
  const op = OPERATORS[a.f];
  if (op && x.length === 2) {
    const [text, lp, rp] = op;
    if (prec > Math.min(lp, rp) || (inDivisor && a.f === '*')) return paren(show(a, 0));
    let lhs = show(x[0], lp);
    const rhs = show(x[1], rp, a.f === '/');
    if (a.f === '^' && lhs.startsWith('-')) lhs = paren(lhs);
    if (a.f === '*') {
      const prevc = lhs.slice(-1);
      const nextc = rhs.charAt(0);
      if (prevc && nextc && /[A-Za-z0-9._#([{]/.test(nextc) && !(lastTerm(x[0]).t === 'var' && nextc === '(')) return `${lhs} ${rhs}`;
      return `${lhs}*${rhs}`;
    }
    const tight = a.f === '^' || (a.f === '/' && numIntegerp(x[0]) && isInt(x[1]));
    return tight ? `${lhs}${text}${rhs}` : `${lhs} ${text} ${rhs}`;
  }
  if ((a.f === 'neg' || a.f === 'lnot') && x.length === 1) {
    const rp = a.f === 'neg' ? 197 : 1000;
    if (prec > rp) return paren(show(a, 0));
    const inner = show(x[0], rp);
    return `${a.f === 'neg' ? '-' : '!'}${inner}`;
  }
  if ((a.f === 'fact' || a.f === 'percent') && x.length === 1) {
    const lp = a.f === 'fact' ? 210 : 1100;
    if (prec > lp) return paren(show(a, 0));
    return `${show(x[0], lp)}${a.f === 'fact' ? '!' : '%'}`;
  }
  return `${a.f}(${x.map((/** @type {Form} */ y) => show(y, 0)).join(', ')})`;
}
