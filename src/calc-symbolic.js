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
function frac(n, d) {
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
const isNum = (/** @type {Form} */ a) => a.t === 'int' || a.t === 'flt' || a.t === 'frac';
const isRat = (/** @type {Form} */ a) => a.t === 'int' || a.t === 'frac';
const isVec = (/** @type {Form} */ a) => a.t === 'vec';
const isObjVec = (/** @type {Form} */ a) => isNum(a) || isVec(a);
const isOp = (/** @type {Form} */ a, /** @type {string} */ f) => a.t === 'op' && a.f === f;

/** @param {Form} a */
export function toNumber(a) {
  if (a.t === 'frac' && a.d === 0n) throw new SymbolicDivisionByZero(a);
  return a.t === 'int' ? Number(a.v) : a.t === 'frac' ? Number(a.n) / Number(a.d) : Number(`${a.m}e${a.e}`);
}
/** @param {Form} a */
function zerop(a) {
  return a.t === 'int' ? a.v === 0n : a.t === 'flt' ? a.m === 0n : false;
}
/** @param {Form} a */
function negp(a) {
  return a.t === 'int' ? a.v < 0n : a.t === 'frac' ? a.n < 0n : a.t === 'flt' ? a.m < 0n : false;
}
/** @param {Form} a */
function posp(a) {
  return a.t === 'int' ? a.v > 0n : a.t === 'frac' ? a.n > 0n : a.t === 'flt' ? a.m > 0n : false;
}
/** Calc's Math-equal-int: the integer n, or a float with that whole value. @param {Form} a @param {number} n */
function eqInt(a, n) {
  return (a.t === 'int' && a.v === BigInt(n)) || (a.t === 'flt' && a.e === 0 && a.m === BigInt(n));
}
/** @param {Form} a @param {Form} b */
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
    default:
      return a.f === b.f && a.a.length === b.a.length && a.a.every((/** @type {Form} */ x, /** @type {number} */ i) => equal(x, b.a[i]));
  }
}
/** @param {Form} a @returns {boolean} */
function looksNeg(a) {
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
function infinitep(a) {
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
  if (isVec(a) || isVec(b)) return mapVec2(add, a, b);
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
function combineSum(a, b, nega, negb, scalarOkay) {
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
  if (!equal(a, b)) return null;
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
    return mapVec2(mul, a, b);
  }
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
    return mapVec2(div, a, b);
  }
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

/** Powers of like factors: x * x is x^2, x^2 * x^3 is x^5, sqrt(x) * sqrt(x) is x.
 * @param {Form} a @param {Form} b @param {boolean} inva @param {boolean} invb @param {boolean} scalarOkay @returns {Form | null} */
function combineProd(a, b, inva, invb, scalarOkay) {
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
    if (isOp(a, '^') && isNum(a.a[1])) {
      apow = a.a[1];
      a = a.a[0];
    } else if (isOp(a, 'sqrt')) {
      apow = frac(1n, 2n);
      a = a.a[0];
    } else if (isOp(a, 'exp') && isNum(a.a[0])) {
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
    if (isOp(b, '^') && isNum(b.a[1])) {
      bpow = b.a[1];
      b = b.a[0];
    } else if (isOp(b, 'sqrt')) {
      bpow = frac(1n, 2n);
      b = b.a[0];
    } else if (isOp(b, 'exp') && isNum(b.a[0])) {
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
  if (equal(a, b)) {
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
function compare(a, b) {
  if (equal(a, b)) return (a.t === 'var' || (a.t === 'op' && (a.f === 'neg' || a.f === '*' || a.f === '/'))) && infinitep(a) ? 2 : 0;
  if (isNum(a) && isNum(b)) {
    if (isInt(a) && isInt(b)) return a.v < b.v ? -1 : 1;
    const d = numAdd(a, negNumber(b));
    return posp(d) ? 1 : negp(d) ? -1 : 0;
  }
  if (infinitep(a) || infinitep(b) || a.t === 'var') return 2;
  if (a.t === 'op' && b.t === 'op' && a.f === b.f && a.a.length === b.a.length && a.a.every((/** @type {Form} */ x, /** @type {number} */ i) => compare(x, b.a[i]) === 0)) return 0;
  return 2;
}

/** @param {string} f @param {Form} a @param {Form} b @param {...Form} more @returns {Form} */
function comparison(f, a, b, ...more) {
  if (more.length) return nAryEquation(f, [a, b, ...more]);
  if (isVec(a) || isVec(b)) {
    if (f === 'eq' || f === 'neq') throw new SymbolicUnsupported('vector equality');
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

/** Which signs a form may have: 1 negative, 2 zero, 4 positive, 8 not real (a reduced port of math-possible-signs). @param {Form} a @returns {number} */
function knownSigns(a) {
  if (isNum(a)) return posp(a) ? 4 : negp(a) ? 1 : 2;
  if (a.t === 'var') return a.name === 'pi' || a.name === 'e' || a.name === 'inf' ? 4 : a.name === 'uinf' ? 13 : 15;
  if (a.t !== 'op') return 15;
  const [x, y] = a.a;
  /** @type {(s: number) => number} */ const negSigns = (s) => (s >= 8 ? 8 + negSigns(s - 8) : (s & 1 ? 4 : 0) + (s & 2) + (s & 4 ? 1 : 0));
  switch (a.f) {
    case 'neg':
      return negSigns(knownSigns(x));
    case '+':
    case '-': {
      const s1 = knownSigns(x);
      let s2 = knownSigns(y);
      if (a.f === '-') s2 = negSigns(s2);
      if (s1 === s2) return s1;
      if (s1 === 2) return s2;
      if (s2 === 2) return s1;
      if (s1 >= 8 || s2 >= 8) return 15;
      if ((s1 === 4 && s2 === 6) || (s2 === 4 && s1 === 6)) return 4;
      if ((s1 === 1 && s2 === 3) || (s2 === 1 && s1 === 3)) return 1;
      return 7;
    }
    case '*':
    case '/': {
      const s1 = knownSigns(x);
      const s2 = knownSigns(y);
      if (s1 >= 8 || s2 >= 8) return 15;
      if (a.f === '/' && [2, 3, 6, 7].includes(s2)) return 15;
      return ([4, 5, 6, 7].includes(s1) ? s2 : 0) | ([2, 3, 6, 7].includes(s1) ? 2 : 0) | ([1, 3, 5, 7].includes(s1) ? negSigns(s2) : 0);
    }
    case '^': {
      const s1 = knownSigns(x);
      const s2 = knownSigns(y);
      if (s1 >= 8 || s2 >= 8) return 15;
      if (s1 === 4) return 4;
      if (s1 === 2) return s2 === 4 ? 2 : 15;
      if (s2 === 2) return s1 === 1 || s1 === 5 ? 2 : 15;
      if (isInt(y)) return evenp(y) ? ([3, 6, 7].includes(s1) ? 6 : 4) : s1;
      if (s1 === 6) return s2 === 4 ? 6 : 15;
      return 7;
    }
    case 'abs': {
      const s1 = knownSigns(x);
      return s1 === 2 ? 2 : [1, 4, 5].includes(s1) ? 4 : 6;
    }
    case 'exp':
      return knownSigns(x) >= 8 ? 15 : 4;
    case 'sqrt': {
      const s1 = knownSigns(x);
      return [2, 4, 6].includes(s1) ? s1 : 15;
    }
    default:
      return 15;
  }
}

/** @type {{ numericCall: ((name: string, args: Form[]) => Form | null) | null, strict: boolean }} */
const hooks = { numericCall: null, strict: false };

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

/** Evaluate a parsed expression the way Calc's normalizer does: bottom-up, arguments first. @param {Form} form @returns {Form} */
export function normalize(form) {
  if (form.t === 'vec') return VEC(form.items.map(normalize));
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
      if (isNum(args[0])) return zerop(args[0]) ? args[2] : args[1];
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
function callFunction(name, args) {
  const vec = args.length === 1 && isVec(args[0]) ? args[0].items : null;
  switch (name) {
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
      if (vec) return I(vec.length);
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
      if (args.length === 2 && isNum(args[0]) && isNum(args[1])) {
        const pickFirst = name === 'max' ? toNumber(args[0]) >= toNumber(args[1]) : toNumber(args[0]) <= toNumber(args[1]);
        return pickFirst ? args[0] : args[1];
      }
      break;
    default:
      break;
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
    } else if ((m = /^\d+:\d+/.exec(rest))) {
      out.push({ kind: 'frac', text: m[0] });
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
      const [n, d] = t.text.split(':');
      return frac(BigInt(n), BigInt(d));
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
      const inner = expr(0);
      if (isOpTok(',')) throw new SymbolicUnsupported('complex form');
      expect(')');
      return inner;
    }
    if (t.text === '[') {
      /** @type {Form[]} */ const items = [];
      if (!isOpTok(']')) {
        for (;;) {
          items.push(expr(0));
          if (isOpTok(',')) pos++;
          else break;
        }
      }
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
          else if (['lt', 'leq'].includes(info.f) && ['lt', 'leq'].includes(left.f)) throw new SymbolicUnsupported('interval');
          else if (['gt', 'geq'].includes(info.f) && ['gt', 'geq'].includes(left.f)) throw new SymbolicUnsupported('interval');
          else throw new SymbolicSyntaxError('Syntax error', true);
        } else {
          left = O(info.f, left, right);
        }
        chain = COMPLEMENT[info.f] ? left : null;
        continue;
      }
      if (startsOperand() && 196 >= minPrec) {
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
  if (form.t === 'op') form.a.forEach(assertNumericSymbols);
}

/** Swap the placeholder variables of a parsed formula for the forms they stand for. @param {Form} form @param {Map<string, Form>} bound @returns {Form} */
export function substitute(form, bound) {
  if (form.t === 'var') return bound.get(form.name) ?? form;
  if (form.t === 'vec') return VEC(form.items.map((/** @type {Form} */ x) => substitute(x, bound)));
  if (form.t === 'op') return { ...form, a: form.a.map((/** @type {Form} */ x) => substitute(x, bound)) };
  return form;
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
    case 'vec':
      return `[${a.items.map((/** @type {Form} */ x) => show(x, 0)).join(', ')}]`;
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
