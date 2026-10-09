/**
 * Complex numbers for #+TBLFM, following Emacs Calc.
 *
 * A complex value is `(re, im)` (rectangular) or `(r; theta)` (polar). Calc keeps integers exact and turns a
 * component into a float (printed with a trailing "." when it is whole, `2.`) as soon as an operation can't stay exact,
 * so every component carries a float flag next to its value. Arithmetic runs on a "domain": decimal BigNumbers rounded to
 * the working precision (12 digits, or whatever `pN` says), or exact Fractions under the `F` flag. A result whose
 * imaginary part is zero collapses to a real number, as in Calc.
 *
 * This module has no imports. The caller passes a mathjs instance (with the arithmetic and transcendental functions
 * the engine already vendors) to bigDomain()/fractionDomain().
 */

export const isComplex = (v) => v !== null && typeof v === 'object' && v.isComplex === true;
export const isReal = (v) => v !== null && typeof v === 'object' && v.isReal === true;

// ---- domains ---------------------------------------------------------------------------------------------------

/** Decimal arithmetic at `digits` significant digits (mathjs BigNumber). `m` must be created with that precision. */
export function bigDomain(m, digits, mGuard) {
  const D = {
    kind: 'big',
    digits,
    m,
    from: (x) => {
      if (x && x.isBigNumber) return x.toSignificantDigits(digits);
      if (x && x.isFraction) return m.bignumber(x.valueOf()).toSignificantDigits(digits);
      return m.bignumber(x).toSignificantDigits(digits);
    },
    zero: () => m.bignumber(0),
    one: () => m.bignumber(1),
    add: (a, b) => m.add(a, b),
    sub: (a, b) => m.subtract(a, b),
    mul: (a, b) => m.multiply(a, b),
    div: (a, b) => m.divide(a, b),
    neg: (a) => m.unaryMinus(a),
    isZero: (a) => a.isZero(),
    isNeg: (a) => a.isNegative() && !a.isZero(),
    isInt: (a) => a.isInteger(),
    eq: (a, b) => a.equals(b),
    cmp: (a, b) => a.comparedTo(b),
    toNumber: (a) => a.toNumber(),
    sqrt: (a) => m.sqrt(a),
    exp: (a) => m.exp(a),
    ln: (a) => m.log(a),
    sin: (a) => m.sin(a),
    cos: (a) => m.cos(a),
    atan: (a) => m.atan(a),
    pi: () => m.acos(m.bignumber(-1)),
  };
  // Calc works a few digits beyond the working precision inside a transcendental function and rounds at the end
  // (so (-8)^(1/3) is exactly (1., 1.7320508), not (0.99999999999, ...)); `guard` is that wider domain.
  if (mGuard) D.guard = bigDomain(mGuard, digits + 6);
  return D;
}

/** Exact fractions for + - * /; anything transcendental goes through `big` (a bigDomain) and is converted back. */
export function fractionDomain(m, big) {
  const toBig = (a) => big.from(a.valueOf());
  const back = (b) => m.fraction(b.toNumber());
  return {
    kind: 'fraction',
    digits: 12,
    m,
    from: (x) => {
      if (x && x.isFraction) return x;
      if (x && x.isBigNumber) return m.fraction(x.toNumber());
      return m.fraction(x);
    },
    zero: () => m.fraction(0),
    one: () => m.fraction(1),
    add: (a, b) => m.add(a, b),
    sub: (a, b) => m.subtract(a, b),
    mul: (a, b) => m.multiply(a, b),
    div: (a, b) => m.divide(a, b),
    neg: (a) => m.unaryMinus(a),
    isZero: (a) => Number(a.n) === 0,
    isNeg: (a) => Number(a.s) < 0 && Number(a.n) !== 0,
    isInt: (a) => Number(a.d) === 1,
    eq: (a, b) => a.equals(b),
    cmp: (a, b) => a.compare(b),
    toNumber: (a) => a.valueOf(),
    sqrt: (a) => back(big.sqrt(toBig(a))),
    exp: (a) => back(big.exp(toBig(a))),
    ln: (a) => back(big.ln(toBig(a))),
    sin: (a) => back(big.sin(toBig(a))),
    cos: (a) => back(big.cos(toBig(a))),
    atan: (a) => back(big.atan(toBig(a))),
    pi: () => back(big.pi()),
  };
}


// ---- guard digits ----------------------------------------------------------------------------------------------

function mapParts(v, f) {
  if (isReal(v)) return { ...v, x: f(v.x) };
  if (v.polar) return { ...v, r: f(v.r), t: f(v.t) };
  return { ...v, re: f(v.re), im: f(v.im) };
}
const liftValue = (v, D, G) => (D === G ? v : mapParts(v, (x) => G.m.bignumber(x.toString())));
const lowerValue = (v, D) => mapParts(v, (x) => D.m.bignumber(x.toString()).toSignificantDigits(D.digits));
/** Runs `fn(G)` in the wider guard domain (when there is one) and rounds the result back to D's precision. */
function viaGuard(D, fn) {
  if (!D.guard) return fn(D);
  return lowerValue(fn(D.guard), D);
}

// ---- construction ----------------------------------------------------------------------------------------------

const real = (x, f) => ({ isReal: true, x, f: !!f });
const rect = (re, rf, im, imf) => ({ isComplex: true, polar: false, re, im, rf: !!rf, imf: !!imf });
const polarForm = (r, rf, t, tf) => ({ isComplex: true, polar: true, r, t, rf: !!rf, tf: !!tf });

/** A real operand (JS number, BigNumber or Fraction from the engine) as a `real` in domain D. */
export function toReal(v, D) {
  if (isReal(v)) return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('A complex operation needs a finite number');
    return real(D.from(v), !Number.isInteger(v));
  }
  if (v && v.isBigNumber) return real(D.from(v), !v.isInteger());
  if (v && v.isFraction) return real(D.from(v), false);
  throw new Error('Not a number');
}

/** The engine's own representation of a real result: a JS number by default, the mathjs value under pN / F. */
export function realToEngine(r, D, numericMode) {
  if (!numericMode) return D.toNumber(r.x);
  if (numericMode.kind === 'fraction') return D.kind === 'fraction' ? r.x : numericMode.instance.fraction(D.toNumber(r.x));
  return r.x;
}

function angleToRad(x, D, degrees) {
  if (!degrees) return x;
  return D.div(D.mul(x, D.pi()), D.from(180));
}
function radToAngle(x, D, degrees) {
  if (!degrees) return x;
  return D.div(D.mul(x, D.from(180)), D.pi());
}

// sin/cos of an angle that is exact where Calc is: multiples of 90 degrees
function sinCosAngle(t, tf, D, degrees) {
  if (D.guard) {
    const G = D.guard;
    const out = sinCosAngle(G.m.bignumber(t.toString()), tf, G, degrees);
    const low = (x) => D.m.bignumber(x.toString()).toSignificantDigits(D.digits);
    return { s: low(out.s), c: low(out.c), f: out.f };
  }
  if (degrees) {
    const full = D.from(360);
    let a = t;
    if (D.isInt(a)) {
      let k = Number(D.toNumber(a)) % 360;
      if (k < 0) k += 360;
      if (k === 0) return { s: D.zero(), c: D.one(), f: tf };
      if (k === 90) return { s: D.one(), c: D.zero(), f: tf };
      if (k === 180) return { s: D.zero(), c: D.neg(D.one()), f: tf };
      if (k === 270) return { s: D.neg(D.one()), c: D.zero(), f: tf };
      a = D.from(k);
    }
    void full;
    const rad = angleToRad(a, D, true);
    return { s: D.sin(rad), c: D.cos(rad), f: true };
  }
  return { s: D.sin(t), c: D.cos(t), f: true };
}

/** Rectangular parts of any complex. */
function toRect(z, D, degrees) {
  if (!z.polar) return z;
  const { s, c, f } = sinCosAngle(z.t, z.tf, D, degrees);
  const exactAxis = !f && !z.rf;
  const re = D.mul(z.r, c);
  const im = D.mul(z.r, s);
  // a polar number converted to rectangular is exact only along the axes; Calc shows (0., 2.) for (2; 90)
  void exactAxis;
  return rect(re, true, im, true);
}

function normalizeAngle(t, D, degrees) {
  if (!degrees) return t;
  const full = D.from(360);
  let a = t;
  // bring into (-180, 180]
  let guard = 0;
  while (D.cmp(a, D.from(180)) > 0 && guard++ < 1000) a = D.sub(a, full);
  while (D.cmp(a, D.from(-180)) <= 0 && guard++ < 1000) a = D.add(a, full);
  return a;
}

/** Collapses to a real when there is no imaginary part (or a polar angle of 0 or 180 degrees). */
function norm(z, D, degrees) {
  if (z.polar) {
    if (D.isZero(z.t)) return real(z.r, z.rf || z.tf);
    if (degrees && D.eq(z.t, D.from(180))) return real(D.neg(z.r), z.rf || z.tf);
    return z;
  }
  if (D.isZero(z.im)) return real(z.re, z.rf);
  return z;
}

export function makeRect(re, im, D, degrees) {
  return norm(rect(re.x, re.f, im.x, im.f), D, degrees);
}

/** (r; theta) from a literal in a cell. */
export function makePolar(r, t, D, degrees) {
  return norm(polarForm(r.x, r.f, normalizeAngle(t.x, D, degrees), t.f), D, degrees);
}

export function asComplex(v, D) {
  if (isComplex(v)) return v;
  const r = isReal(v) ? v : toReal(v, D);
  return rect(r.x, r.f, D.zero(), false);
}

// ---- cells -----------------------------------------------------------------------------------------------------

const NUM = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
const RECT_CELL = new RegExp(`^\\(\\s*(${NUM})\\s*,\\s*(${NUM})\\s*\\)$`);
const POLAR_CELL = new RegExp(`^\\(\\s*(${NUM})\\s*;\\s*(${NUM})\\s*\\)$`);

function componentFromText(text, D) {
  const isFloat = /[.eE]/.test(text);
  return real(D.from(text), isFloat);
}

/** A cell such as "(1, 2)" or "(2; 90)" as a complex value, or null if it is neither. */
export function parseComplexCell(text, D, degrees) {
  const t = String(text).trim();
  let m = RECT_CELL.exec(t);
  if (m) return makeRect(componentFromText(m[1], D), componentFromText(m[2], D), D, degrees);
  m = POLAR_CELL.exec(t);
  if (m) return makePolar(componentFromText(m[1], D), componentFromText(m[2], D), D, degrees);
  return null;
}

/** A bare number or a "(a, b)" / "(r; theta)" as a Real or Complex, or null. */
export function parseScalarText(text, D, degrees) {
  const t = String(text).trim();
  if (new RegExp(`^${NUM}$`).test(t)) return componentFromText(t, D);
  return parseComplexCell(t, D, degrees);
}

// ---- arithmetic ------------------------------------------------------------------------------------------------

export function cNeg(a, D, degrees) {
  if (isReal(a)) return real(D.neg(a.x), a.f);
  if (a.polar) return norm(polarForm(a.r, a.rf, normalizeAngle(D.add(a.t, D.from(180)), D, degrees), a.tf), D, degrees);
  return norm(rect(D.neg(a.re), a.rf, D.neg(a.im), a.imf), D, degrees);
}

export function cConj(a, D, degrees) {
  if (isReal(a)) return a;
  if (a.polar) return norm(polarForm(a.r, a.rf, normalizeAngle(D.neg(a.t), D, degrees), a.tf), D, degrees);
  return norm(rect(a.re, a.rf, D.neg(a.im), a.imf), D, degrees);
}

function bothPolar(a, b) {
  const polarA = isComplex(a) && a.polar;
  const polarB = isComplex(b) && b.polar;
  const rectA = isComplex(a) && !a.polar;
  const rectB = isComplex(b) && !b.polar;
  return (polarA || polarB) && !rectA && !rectB;
}

export function cAdd(a, b, D, degrees) {
  const keepPolar = bothPolar(a, b);
  const x = toRect(asComplex(a, D), D, degrees);
  const y = toRect(asComplex(b, D), D, degrees);
  const z = norm(rect(D.add(x.re, y.re), x.rf || y.rf, D.add(x.im, y.im), x.imf || y.imf), D, degrees);
  return keepPolar ? cToPolar(z, D, degrees) : z;
}

export function cSub(a, b, D, degrees) {
  return cAdd(a, cNeg(isReal(b) || isComplex(b) ? b : toReal(b, D), D, degrees), D, degrees);
}

export function cMul(a, b, D, degrees) {
  if (isComplex(a) && a.polar && isComplex(b) && b.polar) {
    return norm(polarForm(D.mul(a.r, b.r), a.rf || b.rf, normalizeAngle(D.add(a.t, b.t), D, degrees), a.tf || b.tf), D, degrees);
  }
  if ((isComplex(a) && a.polar && isReal(b)) || (isComplex(b) && b.polar && isReal(a))) {
    const p = isReal(b) ? a : b;
    const r = isReal(b) ? b : a;
    const negative = D.isNeg(r.x);
    const magnitude = negative ? D.neg(r.x) : r.x;
    const angle = negative ? normalizeAngle(D.add(p.t, D.from(180)), D, degrees) : p.t;
    return norm(polarForm(D.mul(p.r, magnitude), p.rf || r.f, angle, p.tf), D, degrees);
  }
  const x = toRect(asComplex(a, D), D, degrees);
  const y = toRect(asComplex(b, D), D, degrees);
  const f = x.rf || x.imf || y.rf || y.imf;
  const re = D.sub(D.mul(x.re, y.re), D.mul(x.im, y.im));
  const im = D.add(D.mul(x.re, y.im), D.mul(x.im, y.re));
  return norm(rect(re, f, im, f), D, degrees);
}

export function cDiv(a, b, D, degrees) {
  if (isComplex(a) && a.polar && isComplex(b) && b.polar) {
    if (D.isZero(b.r)) throw new Error('Division by zero');
    const r = D.div(a.r, b.r);
    const exact = !(a.rf || b.rf) && D.isInt(r);
    return norm(polarForm(r, !exact, normalizeAngle(D.sub(a.t, b.t), D, degrees), a.tf || b.tf), D, degrees);
  }
  const x = toRect(asComplex(a, D), D, degrees);
  const y = toRect(asComplex(b, D), D, degrees);
  const den = D.add(D.mul(y.re, y.re), D.mul(y.im, y.im));
  if (D.isZero(den)) throw new Error('Division by zero');
  const anyFloat = x.rf || x.imf || y.rf || y.imf;
  const reNum = D.add(D.mul(x.re, y.re), D.mul(x.im, y.im));
  const imNum = D.sub(D.mul(x.im, y.re), D.mul(x.re, y.im));
  const re = D.div(reNum, den);
  const im = D.div(imNum, den);
  const reExact = !anyFloat && (D.kind === 'fraction' || D.isInt(re));
  const imExact = !anyFloat && (D.kind === 'fraction' || D.isInt(im));
  const z = norm(rect(re, !reExact, im, !imExact), D, degrees);
  const keepPolar = bothPolar(a, b);
  return keepPolar ? cToPolar(z, D, degrees) : z;
}

function intExponent(e, D) {
  if (!isReal(e) || e.f || !D.isInt(e.x)) return null;
  const n = D.toNumber(e.x);
  return Math.abs(n) <= 4096 ? n : null;
}

export function cPow(a, b, D, degrees) {
  const base = isReal(a) || isComplex(a) ? a : toReal(a, D);
  const exp = isReal(b) || isComplex(b) ? b : toReal(b, D);
  const n = intExponent(exp, D);
  if (n !== null) {
    if (n === 0) return real(D.one(), false);
    if (isComplex(base) && base.polar) {
      const nn = D.from(n);
      return norm(polarForm(powReal(base.r, n, D), base.rf, normalizeAngle(D.mul(base.t, nn), D, degrees), base.tf), D, degrees);
    }
    let result = null;
    let square = base;
    let k = Math.abs(n);
    while (k > 0) {
      if (k & 1) result = result === null ? square : cMul(result, square, D, degrees);
      k = Math.floor(k / 2);
      if (k > 0) square = cMul(square, square, D, degrees);
    }
    return n < 0 ? cDiv(real(D.one(), false), result, D, degrees) : result;
  }
  // a real base with a real exponent only needs the complex route when the base is negative
  if (isReal(base) && isReal(exp) && !D.isNeg(base.x)) {
    if (D.isZero(base.x)) return real(D.zero(), false);
    return real(D.exp(D.mul(exp.x, D.ln(base.x))), true);
  }
  if (isReal(base) && D.isZero(base.x)) return real(D.zero(), false);
  // Calc takes x^0.5 as a square root, which keeps (-1)^0.5 exactly (0., 1.)
  if (isReal(exp) && exp.f && D.eq(exp.x, D.from(0.5))) {
    const root = cSqrt(base, D, degrees);
    if (isReal(root)) return real(root.x, true);
    return root.polar ? { ...root, rf: true, tf: true } : { ...root, rf: true, imf: true };
  }
  return viaGuard(D, (G) => {
    const b = liftValue(isReal(base) || isComplex(base) ? base : toReal(base, D), D, G);
    const e = liftValue(exp, D, G);
    return cExp(cMul(e, cLn(b, G, degrees), G, degrees), G, degrees);
  });
}

function powReal(x, n, D) {
  let result = D.one();
  for (let i = 0; i < Math.abs(n); i++) result = D.mul(result, x);
  return n < 0 ? D.div(D.one(), result) : result;
}

// ---- functions -------------------------------------------------------------------------------------------------

/** |z| and the angle in radians, for a complex or real value. */
function absAndAngle(z, D, degrees) {
  const r = toRect(asComplex(z, D), D, degrees);
  const modulus = D.sqrt(D.add(D.mul(r.re, r.re), D.mul(r.im, r.im)));
  const imZero = D.isZero(r.im);
  let angle;
  if (imZero) angle = D.isNeg(r.re) ? D.pi() : D.zero();
  else if (D.isZero(r.re)) angle = D.isNeg(r.im) ? D.neg(D.div(D.pi(), D.from(2))) : D.div(D.pi(), D.from(2));
  else {
    angle = D.atan(D.div(r.im, r.re));
    if (D.isNeg(r.re)) angle = D.isNeg(r.im) ? D.sub(angle, D.pi()) : D.add(angle, D.pi());
  }
  return { modulus, angle, rectangular: r };
}

function cAbsImpl(z, D, degrees) {
  if (isReal(z)) return real(D.isNeg(z.x) ? D.neg(z.x) : z.x, z.f);
  if (z.polar) return real(z.r, z.rf);
  const exact = !z.rf && !z.imf;
  const { modulus } = absAndAngle(z, D, degrees);
  return real(modulus, !(exact && D.isInt(modulus)));
}

function cArgImpl(z, D, degrees) {
  if (isReal(z)) {
    if (D.isZero(z.x)) return real(D.zero(), false);
    if (D.isNeg(z.x)) return degrees ? real(D.from(180), false) : real(D.pi(), true);
    return real(D.zero(), false);
  }
  if (z.polar) return real(z.t, z.tf);
  const { angle } = absAndAngle(z, D, degrees);
  return real(radToAngle(angle, D, degrees), true);
}

export function cRe(z, D, degrees) {
  if (isReal(z)) return z;
  const r = toRect(z, D, degrees);
  return real(r.re, r.rf);
}
export function cIm(z, D, degrees) {
  if (isReal(z)) return real(D.zero(), false);
  const r = toRect(z, D, degrees);
  return real(r.im, r.imf);
}

/** polar(z): the (r; theta) form. */
function cToPolarImpl(z, D, degrees) {
  if (isReal(z)) return z;
  if (z.polar) return z;
  const { modulus, angle } = absAndAngle(z, D, degrees);
  return norm(polarForm(modulus, true, radToAngle(angle, D, degrees), true), D, degrees);
}
/** rect(z). */
export function cToRect(z, D, degrees) {
  if (isReal(z) || !z.polar) return z;
  return norm(toRect(z, D, degrees), D, degrees);
}

function cSqrtImpl(z, D, degrees) {
  if (isReal(z)) {
    if (!D.isNeg(z.x)) {
      const s = D.sqrt(z.x);
      return real(s, !(!z.f && D.isInt(s)));
    }
    const s = D.sqrt(D.neg(z.x));
    const f = !(!z.f && D.isInt(s));
    return rect(D.zero(), f, s, f);
  }
  if (z.polar) {
    const s = D.sqrt(z.r);
    const f = z.rf || !D.isInt(s);
    return norm(polarForm(s, f, normalizeAngle(D.div(z.t, D.from(2)), D, degrees), true), D, degrees);
  }
  const { modulus, rectangular } = absAndAngle(z, D, degrees);
  const two = D.from(2);
  const re = D.sqrt(D.div(D.add(modulus, rectangular.re), two));
  let im = D.sqrt(D.div(D.sub(modulus, rectangular.re), two));
  if (D.isNeg(rectangular.im)) im = D.neg(im);
  return norm(rect(re, true, im, true), D, degrees);
}

function cExpImpl(z, D, degrees) {
  const r = toRect(asComplex(z, D), D, degrees);
  const magnitude = D.exp(r.re);
  if (D.isZero(r.im)) return real(magnitude, true);
  return norm(rect(D.mul(magnitude, D.cos(r.im)), true, D.mul(magnitude, D.sin(r.im)), true), D, degrees);
}

/** ln(z); `allowNegative` lets the real route reach negative numbers (they have a complex logarithm). */
function cLnImpl(z, D, degrees) {
  const operand = isReal(z) || isComplex(z) ? z : toReal(z, D);
  const { modulus, angle, rectangular } = absAndAngle(operand, D, degrees);
  if (D.isZero(modulus)) throw new Error('ln(0) is undefined');
  const lnModulus = D.ln(modulus);
  if (D.isZero(rectangular.im) && !D.isNeg(rectangular.re)) return real(lnModulus, true);
  return norm(rect(lnModulus, true, angle, true), D, degrees);
}

function cLog10Impl(z, D, degrees) {
  return cDiv(cLn(z, D, degrees), real(D.ln(D.from(10)), true), D, degrees);
}
export function cAbs(z, D, degrees) {
  return viaGuard(D, (G) => cAbsImpl(isReal(z) || isComplex(z) ? liftValue(z, D, G) : z, G, degrees));
}
export function cArg(z, D, degrees) {
  return viaGuard(D, (G) => cArgImpl(isReal(z) || isComplex(z) ? liftValue(z, D, G) : z, G, degrees));
}
export function cToPolar(z, D, degrees) {
  return viaGuard(D, (G) => cToPolarImpl(isReal(z) || isComplex(z) ? liftValue(z, D, G) : z, G, degrees));
}
export function cSqrt(z, D, degrees) {
  return viaGuard(D, (G) => cSqrtImpl(isReal(z) || isComplex(z) ? liftValue(z, D, G) : z, G, degrees));
}
export function cExp(z, D, degrees) {
  return viaGuard(D, (G) => cExpImpl(isReal(z) || isComplex(z) ? liftValue(z, D, G) : z, G, degrees));
}
export function cLn(z, D, degrees) {
  return viaGuard(D, (G) => cLnImpl(isReal(z) || isComplex(z) ? liftValue(z, D, G) : z, G, degrees));
}
export function cLog10(z, D, degrees) {
  return viaGuard(D, (G) => cLog10Impl(isReal(z) || isComplex(z) ? liftValue(z, D, G) : z, G, degrees));
}
export function cSin(z, D, degrees) {
  return viaGuard(D, (G) => cSinImpl(isReal(z) || isComplex(z) ? liftValue(z, D, G) : z, G, degrees));
}
export function cCos(z, D, degrees) {
  return viaGuard(D, (G) => cCosImpl(isReal(z) || isComplex(z) ? liftValue(z, D, G) : z, G, degrees));
}
export function cTan(z, D, degrees) {
  return viaGuard(D, (G) => cTanImpl(isReal(z) || isComplex(z) ? liftValue(z, D, G) : z, G, degrees));
}
export function cAsin(z, D, degrees) {
  return viaGuard(D, (G) => cAsinImpl(isReal(z) || isComplex(z) ? liftValue(z, D, G) : z, G, degrees));
}
export function cAcos(z, D, degrees) {
  return viaGuard(D, (G) => cAcosImpl(isReal(z) || isComplex(z) ? liftValue(z, D, G) : z, G, degrees));
}
export function cAtan(z, D, degrees) {
  return viaGuard(D, (G) => cAtanImpl(isReal(z) || isComplex(z) ? liftValue(z, D, G) : z, G, degrees));
}
export function cLog(z, base, D, degrees) {
  return cDiv(cLn(z, D, degrees), cLn(base, D, degrees), D, degrees);
}

function cosh(x, D) {
  const e = D.exp(x);
  return D.div(D.add(e, D.div(D.one(), e)), D.from(2));
}
function sinh(x, D) {
  const e = D.exp(x);
  return D.div(D.sub(e, D.div(D.one(), e)), D.from(2));
}

function trigArg(z, D, degrees) {
  const r = toRect(asComplex(z, D), D, degrees);
  return { a: angleToRad(r.re, D, degrees), b: angleToRad(r.im, D, degrees) };
}

function cSinImpl(z, D, degrees) {
  const { a, b } = trigArg(z, D, degrees);
  return norm(rect(D.mul(D.sin(a), cosh(b, D)), true, D.mul(D.cos(a), sinh(b, D)), true), D, degrees);
}
function cCosImpl(z, D, degrees) {
  const { a, b } = trigArg(z, D, degrees);
  return norm(rect(D.mul(D.cos(a), cosh(b, D)), true, D.neg(D.mul(D.sin(a), sinh(b, D))), true), D, degrees);
}
function cTanImpl(z, D, degrees) {
  return cDiv(cSin(z, D, degrees), cCos(z, D, degrees), D, degrees);
}

const I = (D) => rect(D.zero(), false, D.one(), false);

function toAngles(z, D, degrees) {
  if (isReal(z)) return real(radToAngle(z.x, D, degrees), true);
  const r = toRect(z, D, degrees);
  return norm(rect(radToAngle(r.re, D, degrees), true, radToAngle(r.im, D, degrees), true), D, degrees);
}

// asin(z) = -i ln(iz + sqrt(1 - z^2)), in radians until the end
function cAsinImpl(z, D, degrees) {
  const operand = isReal(z) || isComplex(z) ? z : toReal(z, D);
  const one = real(D.one(), false);
  const inner = cAdd(cMul(I(D), operand, D, true), cSqrt(cSub(one, cMul(operand, operand, D, true), D, true), D, true), D, true);
  const logged = cLn(inner, D, true);
  return toAngles(cMul(cNeg(I(D), D, true), logged, D, true), D, degrees);
}
function cAcosImpl(z, D, degrees) {
  const operand = isReal(z) || isComplex(z) ? z : toReal(z, D);
  const halfPi = real(D.div(D.pi(), D.from(2)), true);
  const asin = (() => {
    const one = real(D.one(), false);
    const inner = cAdd(cMul(I(D), operand, D, true), cSqrt(cSub(one, cMul(operand, operand, D, true), D, true), D, true), D, true);
    return cMul(cNeg(I(D), D, true), cLn(inner, D, true), D, true);
  })();
  return toAngles(cSub(halfPi, asin, D, true), D, degrees);
}
// atan(z) = (i/2) (ln(1 - iz) - ln(1 + iz))
function cAtanImpl(z, D, degrees) {
  const operand = isReal(z) || isComplex(z) ? z : toReal(z, D);
  const one = real(D.one(), false);
  const iz = cMul(I(D), operand, D, true);
  const diff = cSub(cLn(cSub(one, iz, D, true), D, true), cLn(cAdd(one, iz, D, true), D, true), D, true);
  const half = real(D.div(D.one(), D.from(2)), true);
  return toAngles(cMul(cMul(I(D), half, D, true), diff, D, true), D, degrees);
}

// ---- comparison and aggregates ------------------------------------------------------------------------------------

export function cEquals(a, b, D, degrees) {
  const x = toRect(asComplex(a, D), D, degrees);
  const y = toRect(asComplex(b, D), D, degrees);
  return D.eq(x.re, y.re) && D.eq(x.im, y.im);
}

export function cIsZero(z, D) {
  if (isReal(z)) return D.isZero(z.x);
  if (z.polar) return D.isZero(z.r);
  return D.isZero(z.re) && D.isZero(z.im);
}

/** vsum / vmean / vprod / vcount over a list that holds at least one complex value. */
export function cAggregate(name, values, D, degrees) {
  const list = values.map((v) => (isComplex(v) || isReal(v) ? v : toReal(v, D)));
  switch (name) {
    case 'vcount':
      return real(D.from(list.length), false);
    case 'vsum':
    case 'vmean': {
      let total = real(D.zero(), false);
      for (const v of list) total = cAdd(total, v, D, degrees);
      if (name === 'vsum') return total;
      if (list.length === 0) throw new Error('vmean of nothing');
      return cDiv(total, real(D.from(list.length), false), D, degrees);
    }
    case 'vprod': {
      let product = real(D.one(), false);
      for (const v of list) product = cMul(product, v, D, degrees);
      return product;
    }
    default:
      throw new Error(`${name} does not take complex values`);
  }
}

// ---- display ---------------------------------------------------------------------------------------------------

function digitsOf(x) {
  return x.toExponential().replace(/^-/, '').split('e')[0].replace('.', '').length;
}

/** One float component the way Calc prints it: 8 significant digits (fewer under a smaller pN), `1.5e12` for the
 *  very large and very small, a trailing "." on a whole float, and trailing zeros only where rounding left them. */
function floatText(x, D, { spec, applySpec }) {
  if (spec && applySpec) {
    const text = applySpec(D.toNumber(x), spec);
    return /^-?\d+$/.test(text) ? `${text}.` : text;
  }
  const shown = Math.min(8, D.digits);
  if (x.isZero()) return '0.';
  const exact = x.toSignificantDigits(shown).equals(x);
  const exp = exact ? x.toExponential() : x.toExponential(shown - 1);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(exp);
  const sign = m[1];
  const lead = m[2];
  const frac = m[3] || '';
  const e = Number(m[4]);
  if (e < -2 || e >= D.digits) return `${sign}${lead}${frac ? `.${frac}` : ''}e${e}`;
  const digits = lead + frac;
  if (e >= 0) {
    const intPart = digits.length > e + 1 ? digits.slice(0, e + 1) : digits.padEnd(e + 1, '0');
    const fracPart = digits.length > e + 1 ? digits.slice(e + 1) : '';
    return `${sign}${intPart}.${fracPart}`;
  }
  return `${sign}0.${'0'.repeat(-e - 1)}${digits}`;
}

function componentText(x, f, D, fmt) {
  if (D.kind === 'fraction') {
    const n = Number(x.s) * Number(x.n);
    return D.isInt(x) ? String(n) : `${n}:${Number(x.d)}`;
  }
  if (!f) return x.toFixed();
  return floatText(x, D, fmt);
}

/** The cell text for a complex value (or a real produced by a complex operation). */
export function formatComplexValue(z, D, fmt) {
  if (isReal(z)) return componentText(z.x, z.f, D, fmt);
  if (z.polar) return `(${componentText(z.r, z.rf, D, fmt)}; ${componentText(z.t, z.tf, D, fmt)})`;
  return `(${componentText(z.re, z.rf, D, fmt)}, ${componentText(z.im, z.imf, D, fmt)})`;
}

export { digitsOf as _digitsOf };
