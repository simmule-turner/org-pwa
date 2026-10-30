// @ts-check
/** The built-in functions of the Lisp interpreter: numbers, lists, strings, vectors, hash tables, output, errors, `format`. */
import {
  Cons, Flt, HashTable, Lambda, LispSignal, LispThrow, NIL, Special, Subr, Sym, T,
  allSymbols, bool, conditionsOf, eql, equal, errorMessageString, floatToString, formatG, intern, list, print, signal, toArray, userErrors, wrongType,
} from './elisp-data.js';
import { Reader, readFromString } from './elisp-read.js';
import { regexpQuote, toRegExp, translate } from './elisp-regex.js';
import {
  defAlias, defineError, defun, defvarGlobal, emit, evalForm, funcall, nthcdr, state, topScope,
} from './elisp-core.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */

/** The columns a character takes: 0 for combining marks, 2 for wide East Asian and emoji, else 1. @param {number} c */
export function charWidth(c) {
  if (c === 0x200b || (c >= 0x0300 && c <= 0x036f) || (c >= 0x200c && c <= 0x200f) || (c >= 0xfe00 && c <= 0xfe0f)) return 0;
  if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f900 && c <= 0x1f9ff) || (c >= 0x20000 && c <= 0x3fffd)) return 2;
  return 1;
}

// ---- numbers ------------------------------------------------------------------------------------

/** @param {LObj} x @returns {x is number | bigint} */
const isInt = (x) => typeof x === 'number' || typeof x === 'bigint';
/** @param {LObj} x */
const isNum = (x) => isInt(x) || x instanceof Flt;
/** A JS number from a Lisp number. @param {LObj} x @param {string} [pred] */
function num(x, pred = 'number-or-marker-p') {
  if (typeof x === 'number') return x;
  if (x instanceof Flt) return x.v;
  if (typeof x === 'bigint') return Number(x);
  throw wrongType(pred, x);
}
/** @param {bigint} b @returns {number | bigint} */
const normInt = (b) => (b >= BigInt(Number.MIN_SAFE_INTEGER) && b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : b);
/** @param {LObj} x @param {string} [pred] @returns {number | bigint} */
function int(x, pred = 'integerp') {
  if (isInt(x)) return /** @type {number | bigint} */ (x);
  throw wrongType(pred, x);
}
/** A float from a JS number. @param {number} v */
/** A float whose NaN, if it is one, has a clear sign bit (what the C library's `asin` and `acos` return for a value out of range). @param {number} v @param {...LObj} inputs */
const posNaN = (v, ...inputs) => {
  const r = flt(v, ...inputs);
  if (Number.isNaN(v)) r.pos = true;
  return r;
};
/** @param {number} v @param {...LObj} inputs */
const flt = (v, ...inputs) => {
  const r = new Flt(v);
  if (Number.isNaN(v)) r.pos = inputs.some((i) => i instanceof Flt && Number.isNaN(i.v) && i.pos);
  return r;
};
/** @param {LObj} x @returns {string} */
function str(x) {
  if (typeof x === 'string') return x;
  throw wrongType('stringp', x);
}
/** @param {LObj} x @returns {Sym} */
function sym(x) {
  if (x instanceof Sym) return x;
  throw wrongType('symbolp', x);
}

/** @param {'+' | '-' | '*'} op @param {number | bigint} a @param {number | bigint} b @returns {number | bigint} */
function intOp(op, a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    const r = op === '+' ? a + b : op === '-' ? a - b : a * b;
    if (Number.isSafeInteger(r)) return r;
  }
  const x = BigInt(a);
  const y = BigInt(b);
  return normInt(op === '+' ? x + y : op === '-' ? x - y : x * y);
}

/** @param {LObj[]} args @param {'+' | '-' | '*'} op @param {number} unit */
function fold(args, op, unit) {
  if (!args.length) return unit;
  /** @type {LObj} */
  let acc = args[0];
  if (!isNum(acc)) throw wrongType('number-or-marker-p', acc);
  if (args.length === 1) {
    if (op === '-') return isInt(acc) ? intOp('-', 0, /** @type {number | bigint} */ (acc)) : flt(-/** @type {Flt} */ (acc).v, acc);
    return acc;
  }
  for (let i = 1; i < args.length; i++) {
    const b = args[i];
    if (!isNum(b)) throw wrongType('number-or-marker-p', b);
    if (isInt(acc) && isInt(b)) acc = intOp(op, /** @type {number | bigint} */ (acc), /** @type {number | bigint} */ (b));
    else {
      const x = num(acc);
      const y = num(b);
      acc = flt(op === '+' ? x + y : op === '-' ? x - y : x * y, acc, b);
    }
  }
  return acc;
}
defun('+', 0, -1, (a) => fold(a, '+', 0));
defun('-', 0, -1, (a) => fold(a, '-', 0));
defun('*', 0, -1, (a) => fold(a, '*', 1));
defun('/', 1, -1, (a) => {
  const items = a.length === 1 ? [1, a[0]] : a;
  for (const x of items) if (!isNum(x)) throw wrongType('number-or-marker-p', x);
  const anyFloat = items.some((x) => x instanceof Flt);
  if (anyFloat) {
    let acc = num(items[0]);
    for (let i = 1; i < items.length; i++) acc /= num(items[i]);
    return flt(acc, ...items);
  }
  /** @type {number | bigint} */
  let acc = /** @type {number | bigint} */ (items[0]);
  for (let i = 1; i < items.length; i++) {
    const d = /** @type {number | bigint} */ (items[i]);
    if (d === 0 || d === 0n) throw signal('arith-error', []);
    acc = typeof acc === 'number' && typeof d === 'number' ? Math.trunc(acc / d) : normInt(BigInt(acc) / BigInt(d));
    if (typeof acc === 'number' && !Number.isSafeInteger(acc)) acc = normInt(BigInt(items[0] + '') / BigInt(d));
  }
  return acc;
});
defun('%', 2, 2, ([x, y]) => {
  const a = int(x, 'integer-or-marker-p');
  const b = int(y, 'integer-or-marker-p');
  if (b === 0 || b === 0n) throw signal('arith-error', []);
  return typeof a === 'number' && typeof b === 'number' ? a % b : normInt(BigInt(a) % BigInt(b));
});
defun('mod', 2, 2, ([x, y]) => {
  if (!isNum(x)) throw wrongType('number-or-marker-p', x);
  if (!isNum(y)) throw wrongType('number-or-marker-p', y);
  if (x instanceof Flt || y instanceof Flt) {
    const a = num(x);
    const b = num(y);
    let r = a % b;
    if (r !== 0 && (r < 0) !== (b < 0)) r += b;
    return flt(r, x, y);
  }
  const a = BigInt(/** @type {number | bigint} */ (x));
  const b = BigInt(/** @type {number | bigint} */ (y));
  if (b === 0n) throw signal('arith-error', []);
  let r = a % b;
  if (r !== 0n && (r < 0n) !== (b < 0n)) r += b;
  return normInt(r);
});
defun('1+', 1, 1, ([x]) => fold([x, 1], '+', 0));
defun('1-', 1, 1, ([x]) => fold([x, 1], '-', 0));

/** @param {(sign: number) => boolean} cmp  tests the sign of `a - b` */
const compareChain = (cmp) => (/** @type {LObj[]} */ a) => {
  for (const x of a) if (!isNum(x)) throw wrongType('number-or-marker-p', x);
  for (let i = 0; i + 1 < a.length; i++) {
    const x = a[i];
    const y = a[i + 1];
    /** @type {number} */
    let sign;
    if (isInt(x) && isInt(y)) sign = x > y ? 1 : x < y ? -1 : 0;
    else {
      const p = num(x);
      const q = num(y);
      if (Number.isNaN(p) || Number.isNaN(q)) return NIL;
      sign = p > q ? 1 : p < q ? -1 : 0;
    }
    if (!cmp(sign)) return NIL;
  }
  return T;
};
defun('=', 1, -1, compareChain((s) => s === 0));
defun('<', 1, -1, compareChain((s) => s < 0));
defun('>', 1, -1, compareChain((s) => s > 0));
defun('<=', 1, -1, compareChain((s) => s <= 0));
defun('>=', 1, -1, compareChain((s) => s >= 0));
defun('/=', 2, 2, ([x, y]) => bool(num(x) !== num(y)));

/** @param {boolean} wantMax */
const extreme = (wantMax) => (/** @type {LObj[]} */ a) => {
  let best = a[0];
  num(best);
  for (let i = 1; i < a.length; i++) {
    const v = num(a[i]);
    if (Number.isNaN(v)) return a[i];
    if (wantMax ? v > num(best) : v < num(best)) best = a[i];
  }
  return best;
};
defun('max', 1, -1, extreme(true));
defun('min', 1, -1, extreme(false));
defun('abs', 1, 1, ([x]) => {
  if (x instanceof Flt) return flt(Math.abs(x.v), x);
  const i = int(x, 'numberp');
  return typeof i === 'number' ? intOp('*', Math.abs(i), 1) : i < 0n ? -i : i;
});
defun('float', 1, 1, ([x]) => (x instanceof Flt ? x : flt(num(x, 'numberp'))));
defun('zerop', 1, 1, ([x]) => bool(num(x) === 0));
defun('natnump', 1, 1, ([x]) => bool(isInt(x) && x >= 0));
defAlias('wholenump', 'natnump');
defun('cl-plusp', 1, 1, ([x]) => bool(num(x) > 0));
defun('cl-minusp', 1, 1, ([x]) => bool(num(x) < 0));
defun('cl-evenp', 1, 1, ([x]) => bool(BigInt(int(x, 'integer-or-marker-p')) % 2n === 0n));
defun('cl-oddp', 1, 1, ([x]) => bool(BigInt(int(x, 'integer-or-marker-p')) % 2n !== 0n));
defun('integerp', 1, 1, ([x]) => bool(isInt(x)));
defun('fixnump', 1, 1, ([x]) => bool(typeof x === 'number' || (typeof x === 'bigint' && x <= 2305843009213693951n && x >= -2305843009213693952n)));
defun('bignump', 1, 1, ([x]) => bool(typeof x === 'bigint' && (x > 2305843009213693951n || x < -2305843009213693952n)));
defun('floatp', 1, 1, ([x]) => bool(x instanceof Flt));
defun('numberp', 1, 1, ([x]) => bool(isNum(x)));
defAlias('number-or-marker-p', 'numberp');
defAlias('integer-or-marker-p', 'integerp');
defun('isnan', 1, 1, ([x]) => bool(x instanceof Flt ? Number.isNaN(x.v) : (() => { throw wrongType('floatp', x); })()));
defun('sqrt', 1, 1, ([x]) => flt(Math.sqrt(num(x, 'numberp')), x));
defun('exp', 1, 1, ([x]) => flt(Math.exp(num(x, 'numberp')), x));
defun('log', 1, 2, ([x, b]) => flt(b === undefined || b === NIL ? Math.log(num(x, 'numberp')) : Math.log(num(x, 'numberp')) / Math.log(num(b, 'numberp')), x, b));
for (const f of ['sin', 'cos', 'tan', 'asin', 'acos']) defun(f, 1, 1, ([x]) => (f === 'asin' || f === 'acos' ? posNaN : flt)(/** @type {(n: number) => number} */ (Math[/** @type {'sin'} */ (f)])(num(x, 'numberp')), x));
defun('atan', 1, 2, ([y, x]) => flt(x === undefined || x === NIL ? Math.atan(num(y, 'numberp')) : Math.atan2(num(y, 'numberp'), num(x, 'numberp')), y, x));
defun('expt', 2, 2, ([x, y]) => {
  if (isInt(x) && isInt(y) && y >= 0) {
    if (y === 0 || y === 0n) return 1;
    if (x === 0 || x === 1 || x === 0n || x === 1n) return x;
    if (x === -1 || x === -1n) return BigInt(y) % 2n === 0n ? 1 : -1;
    if (y > 4_000_000) throw signal('overflow-error', []);
    return normInt(BigInt(x) ** BigInt(y));
  }
  return flt(num(x, 'numberp') ** num(y, 'numberp'), x, y);
});
defun('logand', 0, -1, (a) => {
  /** @type {bigint} */
  let acc = -1n;
  for (const x of a) acc &= BigInt(int(x, 'integer-or-marker-p'));
  return normInt(acc);
});
defun('logior', 0, -1, (a) => {
  /** @type {bigint} */
  let acc = 0n;
  for (const x of a) acc |= BigInt(int(x, 'integer-or-marker-p'));
  return normInt(acc);
});
defun('logxor', 0, -1, (a) => {
  /** @type {bigint} */
  let acc = 0n;
  for (const x of a) acc ^= BigInt(int(x, 'integer-or-marker-p'));
  return normInt(acc);
});
defun('lognot', 1, 1, ([x]) => normInt(~BigInt(int(x))));
/** Shifts `x` left by `n` bits (right when negative); a shift too large for memory is an overflow. @param {bigint} x @param {bigint} n */
function shift(x, n) {
  if (n >= 0n) {
    if (x === 0n) return 0n;
    if (n > 1n << 32n) throw signal('overflow-error', []);
    return x << n;
  }
  return -n > 1n << 32n ? (x < 0n ? -1n : 0n) : x >> -n;
}
defun('ash', 2, 2, ([x, n]) => normInt(shift(BigInt(int(x)), BigInt(int(n)))));
defun('lsh', 2, 2, ([x, n]) => {
  const a = BigInt(int(x));
  const k = BigInt(int(n));
  return normInt(shift(a < 0n && k < 0n ? a + (1n << 62n) : a, k));
});
defun('random', 0, 1, ([n]) => {
  if (isInt(n) && n <= 0) throw signal('args-out-of-range', [n]);
  return typeof n === 'number' ? Math.floor(Math.random() * n) : Math.floor(Math.random() * 2 ** 40);
});

/** Rounds `x / d` the Emacs way. @param {string} kind @param {LObj} x @param {LObj | undefined} d */
function roundOp(kind, x, d) {
  /** @param {number} v */
  const apply = (v) => {
    switch (kind) {
      case 'floor': return Math.floor(v);
      case 'ceiling': return Math.ceil(v);
      case 'truncate': return Math.trunc(v);
      default: {
        const r = Math.round(v);
        return Math.abs(v % 1) === 0.5 ? 2 * Math.round(v / 2) : r;
      }
    }
  };
  if (d === undefined || d === NIL) {
    if (isInt(x)) return x;
    const v = num(x, 'numberp');
    if (!Number.isFinite(v)) throw signal('overflow-error', []);
    const r = apply(v);
    return Number.isSafeInteger(r) ? r : normInt(BigInt(r));
  }
  if (isInt(x) && isInt(d)) {
    const a = BigInt(x);
    const b = BigInt(d);
    if (b === 0n) throw signal('arith-error', []);
    let q = a / b;
    const rem = a % b;
    if (rem !== 0n) {
      const neg = (a < 0n) !== (b < 0n);
      if (kind === 'floor' && neg) q -= 1n;
      else if (kind === 'ceiling' && !neg) q += 1n;
      else if (kind === 'round') {
        const twice = (rem < 0n ? -rem : rem) * 2n;
        const babs = b < 0n ? -b : b;
        if (twice > babs || (twice === babs && q % 2n !== 0n)) q += neg ? -1n : 1n;
      }
    }
    return normInt(q);
  }
  const bv = num(d, 'numberp');
  if (bv === 0) throw signal('arith-error', []);
  const q = num(x, 'numberp') / bv;
  if (!Number.isFinite(q)) throw signal('overflow-error', []);
  const r = apply(q);
  return Number.isSafeInteger(r) ? r : normInt(BigInt(r));
}
for (const k of ['floor', 'ceiling', 'truncate', 'round']) defun(k, 1, 2, ([x, d]) => roundOp(k, x, d));
for (const [name, k] of [['ffloor', 'floor'], ['fceiling', 'ceiling'], ['ftruncate', 'truncate'], ['fround', 'round']]) {
  defun(name, 1, 1, ([x]) => {
    if (!(x instanceof Flt)) throw wrongType('floatp', x);
    if (!Number.isFinite(x.v)) return x;
    return flt(Number(roundOp(k, x, undefined)));
  });
}
defvarGlobal('most-positive-fixnum', 2305843009213693951n);
defvarGlobal('most-negative-fixnum', -2305843009213693952n);
defvarGlobal('float-pi', flt(Math.PI));
defvarGlobal('pi', flt(Math.PI));
defvarGlobal('float-e', flt(Math.E));

// ---- equality and types -------------------------------------------------------------------------

defun('eq', 2, 2, ([a, b]) => bool(eqSame(a, b)));
defun('eql', 2, 2, ([a, b]) => bool(eql(a, b)));
defun('equal', 2, 2, ([a, b]) => bool(equal(a, b)));
defun('not', 1, 1, ([x]) => bool(x === NIL));
defAlias('null', 'not');
defun('identity', 1, 1, ([x]) => x);
defun('ignore', 0, -1, () => NIL);
defun('always', 0, -1, () => T);
defun('consp', 1, 1, ([x]) => bool(x instanceof Cons));
defun('atom', 1, 1, ([x]) => bool(!(x instanceof Cons)));
defun('listp', 1, 1, ([x]) => bool(x instanceof Cons || x === NIL));
defun('nlistp', 1, 1, ([x]) => bool(!(x instanceof Cons || x === NIL)));
defun('symbolp', 1, 1, ([x]) => bool(x instanceof Sym));
defun('keywordp', 1, 1, ([x]) => bool(x instanceof Sym && x.name.startsWith(':') && x.interned));
defun('stringp', 1, 1, ([x]) => bool(typeof x === 'string'));
defun('vectorp', 1, 1, ([x]) => bool(Array.isArray(x)));
defun('arrayp', 1, 1, ([x]) => bool(Array.isArray(x) || typeof x === 'string'));
defun('sequencep', 1, 1, ([x]) => bool(Array.isArray(x) || typeof x === 'string' || x instanceof Cons || x === NIL));
defun('characterp', 1, 1, ([x]) => bool(typeof x === 'number' && x >= 0 && x <= 0x3fffff));
defun('booleanp', 1, 1, ([x]) => bool(x === NIL || x === T));
defun('hash-table-p', 1, 1, ([x]) => bool(x instanceof HashTable));
defun('proper-list-p', 1, 1, ([x]) => {
  let n = 0;
  let p = x;
  while (p instanceof Cons) {
    p = p.cdr;
    n++;
  }
  return p === NIL ? n : NIL;
});
/** @param {LObj} f */
const isFunction = (f) => {
  let x = f;
  for (let i = 0; x instanceof Sym && x !== NIL && i < 100; i++) x = x.fn ?? NIL;
  if (x instanceof Subr) return true;
  if (x instanceof Lambda) return !x.isMacro;
  if (x instanceof Cons) return x.car === intern('lambda') || x.car === intern('closure');
  return false;
};
defun('functionp', 1, 1, ([f]) => bool(isFunction(f)));
defun('type-of', 1, 1, ([x]) => {
  if (typeof x === 'number') return intern('integer');
  if (typeof x === 'bigint') return intern('integer');
  if (x instanceof Flt) return intern('float');
  if (typeof x === 'string') return intern('string');
  if (x instanceof Sym) return intern(x === NIL || x === T ? 'symbol' : 'symbol');
  if (x instanceof Cons) return intern('cons');
  if (Array.isArray(x)) return intern('vector');
  if (x instanceof HashTable) return intern('hash-table');
  if (x instanceof Lambda) return intern('cons');
  if (x instanceof Subr) return intern('subr');
  return intern('subr');
});

// ---- lists --------------------------------------------------------------------------------------

/** @param {LObj} x @param {string} [pred] */
function carOf(x, pred = 'listp') {
  if (x instanceof Cons) return x.car;
  if (x === NIL) return NIL;
  throw wrongType(pred, x);
}
/** @param {LObj} x */
function cdrOf(x) {
  if (x instanceof Cons) return x.cdr;
  if (x === NIL) return NIL;
  throw wrongType('listp', x);
}
defun('cons', 2, 2, ([a, b]) => new Cons(a, b));
defun('car', 1, 1, ([x]) => carOf(x));
defun('cdr', 1, 1, ([x]) => cdrOf(x));
defun('car-safe', 1, 1, ([x]) => (x instanceof Cons ? x.car : NIL));
defun('cdr-safe', 1, 1, ([x]) => (x instanceof Cons ? x.cdr : NIL));
for (const name of ['caar', 'cadr', 'cdar', 'cddr', 'caddr', 'cdddr', 'cadddr', 'caadr', 'cddar', 'cdadr', 'cadar', 'caaar', 'cdaar']) {
  const ops = name.slice(1, -1).split('').reverse();
  defun(name, 1, 1, ([x]) => {
    /** @type {LObj} */
    let v = x;
    for (const o of ops) v = o === 'a' ? carOf(v) : cdrOf(v);
    return v;
  });
}
defun('setcar', 2, 2, ([c, v]) => {
  if (!(c instanceof Cons)) throw wrongType('consp', c);
  c.car = v;
  return v;
});
defun('setcdr', 2, 2, ([c, v]) => {
  if (!(c instanceof Cons)) throw wrongType('consp', c);
  c.cdr = v;
  return v;
});
defun('list', 0, -1, (a) => list(a));
/** A non-negative count, or the `wholenump` error. @param {LObj} n */
function count(n) {
  if (typeof n !== 'number' || n < 0) throw wrongType('wholenump', n);
  if (n > 2 ** 30) throw signal('error', ['Memory exhausted']);
  return n;
}
defun('make-list', 2, 2, ([n, x]) => list(Array(count(n)).fill(x)));
defun('nth', 2, 2, ([n, l]) => carOf(nthcdr(Number(int(n)), l)));
defun('nthcdr', 2, 2, ([n, l]) => {
  const k = Number(int(n));
  if (k <= 0) return l;
  if (!(l instanceof Cons) && l !== NIL) throw wrongType('listp', l);
  return nthcdr(k, l);
});
defun('elt', 2, 2, ([s, n]) => {
  if (s instanceof Cons || s === NIL) return carOf(nthcdr(Number(int(n)), s));
  if (typeof s !== 'string' && !Array.isArray(s)) throw wrongType('sequencep', s);
  return seqGet(s, Number(int(n)));
});
defun('last', 1, 2, ([l, n]) => {
  const items = [];
  for (let p = l; p instanceof Cons; p = p.cdr) items.push(p);
  const k = n === undefined || n === NIL ? 1 : Number(num(n));
  if (k < 0) return NIL;
  if (k === 0 && !(l instanceof Cons)) return l;
  if (k === 0) return NIL;
  return items.length ? (items[Math.max(0, items.length - k)] ?? NIL) : l === NIL ? NIL : l;
});
defun('butlast', 1, 2, ([l, n]) => {
  const k = n === undefined || n === NIL ? 1 : Number(num(n));
  if (n !== undefined && n !== NIL && k <= 0) return l;
  if (Array.isArray(l) && k >= l.length) return NIL;
  if (typeof l !== 'string' && !Array.isArray(l) && l !== NIL && !(l instanceof Cons)) throw wrongType('sequencep', l);
  const a = toArray(l);
  return list(k <= 0 ? a : a.slice(0, Math.max(0, a.length - k)));
});
defAlias('nbutlast', 'butlast');
defun('take', 2, 2, ([n, l]) => {
  if (typeof n !== 'number' && typeof n !== 'bigint') throw wrongType('integerp', n);
  if (n <= 0) return NIL;
  if (!(l instanceof Cons) && l !== NIL) throw wrongType('listp', l);
  const out = [];
  /** @type {LObj} */ let p = l;
  for (let i = 0; i < Number(int(n)) && p instanceof Cons; i++, p = p.cdr) out.push(p.car);
  return list(out);
});
defun('safe-length', 1, 1, ([l]) => {
  let n = 0;
  for (let p = l; p instanceof Cons && n < 1e7; p = p.cdr) n++;
  return n;
});
defun('length', 1, 1, ([s]) => seqLength(s));
defun('length=', 2, 2, ([s, n]) => bool(seqLength(s) === n));
defun('length<', 2, 2, ([s, n]) => bool(seqLength(s) < num(n)));
defun('length>', 2, 2, ([s, n]) => bool(seqLength(s) > num(n)));

/** @param {string} s */
const hasPairs = (s) => /[\ud800-\udfff]/.test(s);
/** Code points of a string. @param {string} s */
const chars = (s) => (hasPairs(s) ? Array.from(s) : s.split(''));
/** @param {LObj} s */
function seqLength(s) {
  if (typeof s === 'string') return hasPairs(s) ? Array.from(s).length : s.length;
  if (Array.isArray(s)) return s.length;
  if (s === NIL) return 0;
  if (s instanceof Cons) {
    let n = 0;
    let p = /** @type {LObj} */ (s);
    while (p instanceof Cons) {
      n++;
      p = p.cdr;
      if (n > 1e7) throw signal('circular-list', [s]);
    }
    if (p !== NIL) throw wrongType('listp', p);
    return n;
  }
  throw wrongType('sequencep', s);
}
/** @param {LObj} s @param {number} i */
function seqGet(s, i) {
  if (typeof s === 'string') {
    const c = chars(s);
    if (i < 0 || i >= c.length) throw signal('args-out-of-range', [s, i]);
    return /** @type {number} */ (c[i].codePointAt(0));
  }
  if (Array.isArray(s)) {
    if (i < 0 || i >= s.length) throw signal('args-out-of-range', [s, i]);
    return s[i];
  }
  throw wrongType('arrayp', s);
}
/** The elements of any sequence. @param {LObj} s @returns {LObj[]} */
function seqToArray(s) {
  if (s === NIL) return [];
  if (s instanceof Cons) return toArray(s);
  if (Array.isArray(s)) return s.slice();
  if (typeof s === 'string') return chars(s).map((c) => /** @type {number} */ (c.codePointAt(0)));
  throw wrongType('sequencep', s);
}

defun('append', 0, -1, (a) => {
  if (!a.length) return NIL;
  const last = a[a.length - 1];
  /** @type {LObj[]} */
  const items = [];
  for (const s of a.slice(0, -1)) items.push(...seqToArray(s));
  return list(items, last);
});
defun('nconc', 0, -1, (a) => {
  /** @type {LObj} */
  let result = NIL;
  /** @type {Cons | null} */
  let tail = null;
  a.forEach((l, i) => {
    if (l === NIL) return;
    if (tail) tail.cdr = l;
    else result = l;
    if (i < a.length - 1) {
      if (!(l instanceof Cons)) throw wrongType('consp', l);
      let p = l;
      while (p.cdr instanceof Cons) p = p.cdr;
      tail = p;
    }
  });
  return result;
});
defun('reverse', 1, 1, ([s]) => {
  if (typeof s !== 'string' && !Array.isArray(s) && s !== NIL && !(s instanceof Cons)) throw wrongType('sequencep', s);
  if (typeof s === 'string') return chars(s).reverse().join('');
  if (Array.isArray(s)) return s.slice().reverse();
  return list(toArray(s).reverse());
});
defun('nreverse', 1, 1, ([s]) => {
  if (s !== NIL && !(s instanceof Cons) && !Array.isArray(s) && typeof s !== 'string') throw wrongType('arrayp', s);
  if (Array.isArray(s)) return s.reverse();
  if (typeof s === 'string') return chars(s).reverse().join('');
  /** @type {LObj} */
  let prev = NIL;
  /** @type {LObj} */
  let p = s;
  while (p instanceof Cons) {
    /** @type {LObj} */
    const next = p.cdr;
    p.cdr = prev;
    prev = p;
    p = next;
  }
  if (p !== NIL) {
    throw wrongType('listp', prev);
  }
  return prev;
});
defun('copy-sequence', 1, 1, ([s]) => {
  if (typeof s !== 'string' && !Array.isArray(s) && s !== NIL && !(s instanceof Cons)) throw wrongType('sequencep', s);
  if (s === NIL || typeof s === 'string') return s;
  if (Array.isArray(s)) return s.slice();
  return list(toArray(s));
});
/** @param {LObj} x @returns {LObj} */
const copyTree = (x) => (x instanceof Cons ? new Cons(copyTree(x.car), copyTree(x.cdr)) : x);
defun('copy-tree', 1, 2, ([x, vec]) => (vec !== undefined && vec !== NIL && Array.isArray(x) ? x.map(copyTree) : copyTree(x)));
defun('copy-alist', 1, 1, ([l]) => list(toArray(l).map((e) => (e instanceof Cons ? new Cons(e.car, e.cdr) : e))));
defun('flatten-tree', 1, 1, ([t]) => {
  /** @type {LObj[]} */
  const out = [];
  /** @param {LObj} x */
  const walk = (x) => {
    for (let p = x; ; p = /** @type {Cons} */ (p).cdr) {
      if (p === NIL) return;
      if (!(p instanceof Cons)) {
        out.push(p);
        return;
      }
      if (p.car instanceof Cons) walk(p.car);
      else if (p.car !== NIL) out.push(p.car);
    }
  };
  walk(t);
  return list(out);
});
defun('ensure-list', 1, 1, ([x]) => (x instanceof Cons || x === NIL ? x : list([x])));
defun('number-sequence', 1, 3, ([from, to, step]) => {
  if (to === undefined || to === NIL) return list([from]);
  const out = [];
  const s = step === undefined || step === NIL ? 1 : num(step);
  if (s === 0) throw signal('error', ['The increment can not be zero']);
  const f = num(from);
  const t = num(to);
  const anyFloat = from instanceof Flt || to instanceof Flt || step instanceof Flt;
  for (let i = 0, v = f; s > 0 ? v <= t : v >= t; i++, v = f + i * s) out.push(i === 0 ? from : anyFloat ? flt(v) : v);
  return list(out);
});

/** Membership with a given equality. @param {(a: LObj, b: LObj) => boolean} same */
const memberWith = (same) => (/** @type {LObj} */ x, /** @type {LObj} */ l) => {
  let p = l;
  while (p instanceof Cons) {
    if (same(x, p.car)) return p;
    p = p.cdr;
  }
  if (p !== NIL) throw wrongType('listp', p);
  return NIL;
};
/** @param {LObj} a @param {LObj} b */
const eqSame = (a, b) => (typeof a === 'string' ? typeof b === 'string' && a === '' && b === '' : a === b || (isInt(a) && isInt(b) && a == b));
defun('memq', 2, 2, ([x, l]) => memberWith(eqSame)(x, l));
defun('memql', 2, 2, ([x, l]) => memberWith(eql)(x, l));
defun('member', 2, 2, ([x, l]) => memberWith(equal)(x, l));
defun('assq', 2, 2, ([k, l]) => {
  for (let p = l; p instanceof Cons; p = p.cdr) if (p.car instanceof Cons && eqSame(p.car.car, k)) return p.car;
  return NIL;
});
defun('assoc', 2, 3, ([k, l, test]) => {
  for (let p = l; p instanceof Cons; p = p.cdr) {
    if (p.car instanceof Cons && (test === undefined || test === NIL ? equal(k, p.car.car) : funcall(test, [p.car.car, k]) !== NIL)) return p.car;
  }
  return NIL;
});
defun('rassq', 2, 2, ([k, l]) => {
  for (let p = l; p instanceof Cons; p = p.cdr) if (p.car instanceof Cons && eqSame(p.car.cdr, k)) return p.car;
  return NIL;
});
defun('rassoc', 2, 2, ([k, l]) => {
  for (let p = l; p instanceof Cons; p = p.cdr) if (p.car instanceof Cons && equal(p.car.cdr, k)) return p.car;
  return NIL;
});
defun('alist-get', 2, 5, ([k, l, def, , test]) => {
  for (let p = l; p instanceof Cons; p = p.cdr) {
    if (p.car instanceof Cons && (test === undefined || test === NIL ? eqSame(k, p.car.car) : funcall(test, [p.car.car, k]) !== NIL)) return p.car.cdr;
  }
  return def ?? NIL;
});
/** Destructive removal keeping the head cell identity as Emacs does. @param {(a: LObj) => boolean} drop */
const removeWith = (drop) => (/** @type {LObj} */ l) => {
  /** @type {LObj} */
  let head = l;
  while (head instanceof Cons && drop(head.car)) head = head.cdr;
  if (head instanceof Cons) {
    let p = head;
    while (p.cdr instanceof Cons) {
      if (drop(p.cdr.car)) p.cdr = p.cdr.cdr;
      else p = p.cdr;
    }
  }
  return head;
};
defun('delq', 2, 2, ([x, l]) => removeWith((e) => eqSame(e, x))(l));
defun('delete', 2, 2, ([x, l]) => {
  if (Array.isArray(l)) return l.filter((e) => !equal(e, x));
  if (typeof l === 'string') return chars(l).filter((c) => c.codePointAt(0) !== x).join('');
  return removeWith((e) => equal(e, x))(l);
});
defun('remq', 2, 2, ([x, l]) => list(toArray(l).filter((e) => !eqSame(e, x))));
defun('remove', 2, 2, ([x, l]) => {
  if (Array.isArray(l)) return l.filter((e) => !equal(e, x));
  if (typeof l === 'string') return chars(l).filter((c) => c.codePointAt(0) !== x).join('');
  return list(toArray(l).filter((e) => !equal(e, x)));
});
defun('delete-dups', 1, 1, ([l]) => {
  if (l !== NIL && !(l instanceof Cons)) throw wrongType(typeof l === 'string' || Array.isArray(l) ? 'listp' : 'sequencep', l);
  /** @type {LObj[]} */
  const seen = [];
  const kept = toArray(l).filter((e) => (seen.some((s) => equal(s, e)) ? false : (seen.push(e), true)));
  /** @type {LObj} */ let p = l;
  kept.forEach((e, i) => {
    /** @type {Cons} */ (p).car = e;
    if (i === kept.length - 1) /** @type {Cons} */ (p).cdr = NIL;
    else p = /** @type {Cons} */ (p).cdr;
  });
  return kept.length ? l : NIL;
});
defun('assq-delete-all', 2, 2, ([k, l]) => list(toArray(l).filter((e) => !(e instanceof Cons && eqSame(e.car, k)))));
defun('assoc-delete-all', 2, 3, ([k, l]) => list(toArray(l).filter((e) => !(e instanceof Cons && equal(e.car, k)))));
defun('plist-get', 2, 3, ([pl, k, pred]) => {
  for (let p = pl; p instanceof Cons && p.cdr instanceof Cons; p = p.cdr.cdr) {
    if (pred === undefined || pred === NIL ? eqSame(p.car, k) : funcall(pred, [p.car, k]) !== NIL) return p.cdr.car;
  }
  return NIL;
});
defun('plist-put', 3, 4, ([pl, k, v, pred]) => {
  for (let p = pl, n = 0; p !== NIL; p = /** @type {Cons} */ (/** @type {Cons} */ (p).cdr).cdr, n++) {
    if (!(p instanceof Cons) || !(p.cdr instanceof Cons)) throw wrongType('plistp', pl);
    if (n > 1e7) break;
  }
  for (let p = pl; p instanceof Cons && p.cdr instanceof Cons; p = p.cdr.cdr) {
    if (pred === undefined || pred === NIL ? eqSame(p.car, k) : funcall(pred, [p.car, k]) !== NIL) {
      p.cdr.car = v;
      return pl;
    }
  }
  if (pl === NIL) return list([k, v]);
  let last = /** @type {Cons} */ (pl);
  while (last.cdr instanceof Cons) last = last.cdr;
  last.cdr = list([k, v]);
  return pl;
});
defun('plist-member', 2, 3, ([pl, k]) => {
  for (let p = pl; p instanceof Cons; p = p.cdr instanceof Cons ? p.cdr.cdr : NIL) if (eqSame(p.car, k)) return p;
  return NIL;
});
defun('add-to-list', 2, 4, ([s, x, append]) => {
  const symbol = sym(s);
  if (symbol.value === undefined) throw signal('void-variable', [s]);
  const cur = symbol.value;
  if (toArray(cur).some((e) => equal(e, x))) return cur;
  symbol.value = append !== undefined && append !== NIL ? list([...toArray(cur), x]) : new Cons(x, cur);
  return symbol.value;
});

/** Calls `f` on every element of `seq`. @param {LObj} f @param {LObj} seq */
const mapSeq = (f, seq) => seqToArray(seq).map((e) => funcall(f, [e]));
defun('mapcar', 2, 2, ([f, s]) => list(mapSeq(f, s)));
defun('mapc', 2, 2, ([f, s]) => (mapSeq(f, s), s));
defun('mapcan', 2, 2, ([f, s]) => funcall(intern('nconc'), mapSeq(f, s)));
defun('mapconcat', 1, 3, ([f, s, sep]) => {
  const parts = seqToArray(s === undefined ? NIL : s).map((e) => {
    const r = funcall(f, [e]);
    return typeof r === 'string' ? r : concatPiece(r);
  });
  return parts.join(sep === undefined || sep === NIL ? '' : str(sep));
});
defun('funcall', 1, -1, ([f, ...rest]) => funcall(f, rest));
defun('apply', 1, -1, ([f, ...rest]) => {
  if (!rest.length) {
    const items = toArray(f);
    return funcall(items[0], items.slice(1));
  }
  const last = rest.pop();
  return funcall(f, [...rest, ...toArray(/** @type {LObj} */ (last))]);
});
defun('sort', 1, 2, ([s, pred]) => {
  if (pred === undefined) throw signal('wrong-number-of-arguments', [intern('sort'), 1]);
  /** @param {LObj} a @param {LObj} b */
  const cmp = (a, b) => (funcall(pred, [a, b]) !== NIL ? -1 : funcall(pred, [b, a]) !== NIL ? 1 : 0);
  if (Array.isArray(s)) {
    const sorted = s.slice().sort(cmp);
    sorted.forEach((e, i) => (s[i] = e));
    return s;
  }
  const items = toArray(s).sort(cmp);
  /** @type {LObj} */
  let p = s;
  for (const e of items) {
    /** @type {Cons} */ (p).car = e;
    p = /** @type {Cons} */ (p).cdr;
  }
  return s;
});

// ---- seq and cl-lib ------------------------------------------------------------------------------

/** @param {LObj} f */
const truthy = (f) => (/** @type {LObj} */ x) => funcall(f, [x]) !== NIL;
defun('seq-filter', 2, 2, ([f, s]) => list(seqToArray(s).filter(truthy(f))));
defun('seq-remove', 2, 2, ([f, s]) => list(seqToArray(s).filter((x) => !truthy(f)(x))));
defun('seq-map', 2, 2, ([f, s]) => list(mapSeq(f, s)));
defun('seq-reduce', 3, 3, ([f, s, init]) => seqToArray(s).reduce((acc, x) => funcall(f, [acc, x]), init));
defun('seq-find', 2, 3, ([f, s, def]) => seqToArray(s).find(truthy(f)) ?? def ?? NIL);
defun('seq-some', 2, 2, ([f, s]) => {
  for (const x of seqToArray(s)) {
    const r = funcall(f, [x]);
    if (r !== NIL) return r;
  }
  return NIL;
});
defun('seq-every-p', 2, 2, ([f, s]) => bool(seqToArray(s).every(truthy(f))));
defun('seq-count', 2, 2, ([f, s]) => seqToArray(s).filter(truthy(f)).length);
defun('seq-length', 1, 1, ([s]) => seqLength(s));
defun('seq-elt', 2, 2, ([s, n]) => funcall(intern('elt'), [s, n]));
defun('seq-reverse', 1, 1, ([s]) => funcall(intern('reverse'), [s]));
defun('seq-uniq', 1, 2, ([s, test]) => {
  /** @type {LObj[]} */
  const out = [];
  for (const x of seqToArray(s)) if (!out.some((y) => (test === undefined || test === NIL ? equal(x, y) : funcall(test, [x, y]) !== NIL))) out.push(x);
  return list(out);
});
/** @param {LObj} s @param {LObj} n @param {boolean} take */
function seqCut(s, n, take) {
  const k = num(n);
  if (s instanceof Cons || s === NIL) {
    if (take) return funcall(intern('take'), [n, s]);
    return nthcdr(Math.max(0, k), s);
  }
  const items = seqToArray(s);
  const part = take ? items.slice(0, Math.max(0, k)) : items.slice(Math.max(0, k));
  return typeof s === 'string' ? String.fromCodePoint(...part.map(Number)) : part;
}
defun('seq-take', 2, 2, ([s, n]) => seqCut(s, n, true));
defun('seq-drop', 2, 2, ([s, n]) => seqCut(s, n, false));
defun('seq-contains-p', 2, 3, ([s, x, test]) => bool(seqToArray(s).some((y) => (test === undefined || test === NIL ? equal(x, y) : funcall(test, [x, y]) !== NIL))));
defun('seq-position', 2, 3, ([s, x]) => {
  const i = seqToArray(s).findIndex((y) => equal(x, y));
  return i < 0 ? NIL : i;
});
defun('seq-min', 1, 1, ([s]) => funcall(intern('min'), seqToArray(s)));
defun('seq-max', 1, 1, ([s]) => funcall(intern('max'), seqToArray(s)));
defun('seq-sort', 2, 2, ([p, s]) => {
  const sorted = funcall(intern('sort'), [list(seqToArray(s)), p]);
  return Array.isArray(s) ? toArray(sorted) : typeof s === 'string' ? String.fromCodePoint(...toArray(sorted).map(Number)) : sorted;
});
defun('seq-concatenate', 1, -1, ([type, ...seqs]) => {
  const items = seqs.flatMap(seqToArray);
  const t = /** @type {Sym} */ (type).name;
  return t === 'vector' ? items : t === 'string' ? String.fromCodePoint(...items.map(Number)) : list(items);
});
defun('seq-empty-p', 1, 1, ([s]) => bool(s instanceof Cons ? false : seqLength(s) === 0));
defun('seq-first', 1, 1, ([s]) => funcall(intern('elt'), [s, 0]));
defun('seq-rest', 1, 1, ([s]) => seqCut(s, 1, false));
defun('seq-subseq', 2, 3, ([s, a, b]) => {
  if (s !== NIL && !(s instanceof Cons) && !Array.isArray(s) && typeof s !== 'string') throw signal('error', [`Unsupported sequence: ${print(s)}`]);
  const items = seqToArray(s);
  const from = Number(a) < 0 ? items.length + Number(a) : Number(a);
  const to = b === undefined || b === NIL ? items.length : Number(b) < 0 ? items.length + Number(b) : Number(b);
  if (from < 0 || to > items.length || from > to) throw signal('args-out-of-range', [s, a, b ?? NIL]);
  const part = items.slice(from, to);
  return typeof s === 'string' ? String.fromCodePoint(...part.map(Number)) : Array.isArray(s) ? part : list(part);
});
defun('seq-partition', 2, 2, ([s, n]) => {
  const items = seqToArray(s);
  const k = Number(n);
  /** @type {LObj[]} */
  const out = [];
  if (k > 0) for (let i = 0; i < items.length; i += k) out.push(list(items.slice(i, i + k)));
  return list(out);
});
defun('cl-remove-if', 2, -1, ([f, s]) => list(seqToArray(s).filter((x) => !truthy(f)(x))));
defun('cl-remove-if-not', 2, -1, ([f, s]) => list(seqToArray(s).filter(truthy(f))));
defun('cl-find-if', 2, -1, ([f, s]) => seqToArray(s).find(truthy(f)) ?? NIL);
defun('cl-some', 2, 2, ([f, s]) => {
  for (const x of seqToArray(s)) {
    const r = funcall(f, [x]);
    if (r !== NIL) return r;
  }
  return NIL;
});
defun('cl-every', 2, 2, ([f, s]) => bool(seqToArray(s).every(truthy(f))));
defun('cl-reduce', 2, -1, ([f, s, ...kw]) => {
  const items = seqToArray(s);
  const at = kw.indexOf(intern(':initial-value'));
  const fe = kw.indexOf(intern(':from-end'));
  if (fe >= 0 && kw[fe + 1] !== NIL) {
    const rev = items.reverse();
    if (at >= 0) return rev.reduce((acc, x) => funcall(f, [x, acc]), kw[at + 1]);
    if (!rev.length) return funcall(f, []);
    return rev.slice(1).reduce((acc, x) => funcall(f, [x, acc]), rev[0]);
  }
  if (at >= 0) return items.reduce((acc, x) => funcall(f, [acc, x]), kw[at + 1]);
  if (!items.length) return funcall(f, []);
  return items.slice(1).reduce((acc, x) => funcall(f, [acc, x]), items[0]);
});
defun('cl-first', 1, 1, ([l]) => carOf(l));
defun('cl-second', 1, 1, ([l]) => carOf(cdrOf(l)));
defun('cl-third', 1, 1, ([l]) => carOf(cdrOf(cdrOf(l))));
defun('cl-position', 2, -1, ([x, s]) => {
  const i = seqToArray(s).findIndex((y) => eql(x, y));
  return i < 0 ? NIL : i;
});
defun('cl-member', 2, -1, ([x, l]) => memberWith(eql)(x, l));
defun('cl-remove-duplicates', 1, -1, ([s]) => {
  /** @type {LObj[]} */
  const out = [];
  const items = seqToArray(s);
  items.forEach((x, i) => {
    if (!items.slice(i + 1).some((y) => eql(x, y))) out.push(x);
  });
  return list(out);
});
defun('cl-subseq', 2, 3, ([s, a, b]) => funcall(intern('seq-subseq'), [s, a, b ?? NIL]));
defun('cl-list*', 1, -1, (a) => list(a.slice(0, -1), a[a.length - 1]));
defun('cl-mapcar', 2, -1, ([f, ...seqs]) => {
  const arrays = seqs.map(seqToArray);
  const n = Math.min(...arrays.map((a) => a.length));
  return list(Array.from({ length: n }, (_, i) => funcall(f, arrays.map((a) => a[i]))));
});
defun('cl-parse-integer', 1, -1, ([s, ...kw]) => {
  const opt = (/** @type {string} */ name) => { const at = kw.indexOf(intern(name)); return at >= 0 ? kw[at + 1] : NIL; };
  const radix = opt(':radix') === NIL ? 10 : Number(opt(':radix'));
  const junk = opt(':junk-allowed') !== NIL;
  const text = str(s).trim();
  const sign = /^[+-]/.exec(text)?.[0] ?? '';
  let i = sign.length;
  while (i < text.length && parseInt(text[i], 36) < radix) i += 1;
  const digits = text.slice(sign.length, i);
  if (digits === '' || (!junk && i < text.length)) {
    if (junk) return NIL;
    throw signal('error', [`Not an integer string: ‘${str(s)}’`]);
  }
  return parseInt(sign + digits, radix);
});

// ---- vectors and hash tables -------------------------------------------------------------------

defun('vector', 0, -1, (a) => a);
defun('make-vector', 2, 2, ([n, x]) => Array(count(n)).fill(x));
defun('vconcat', 0, -1, (a) => a.flatMap(seqToArray));
defun('aref', 2, 2, ([s, i]) => seqGet(s, Number(int(i))));
defun('aset', 3, 3, ([s, i, v]) => {
  if (!Array.isArray(s)) throw wrongType('arrayp', s);
  const k = Number(int(i));
  if (k < 0 || k >= s.length) throw signal('args-out-of-range', [s, i]);
  s[k] = v;
  return v;
});
defun('fillarray', 2, 2, ([s, v]) => {
  if (!Array.isArray(s)) throw wrongType('arrayp', s);
  s.fill(v);
  return s;
});

/** @type {WeakMap<object, number>} */
const ids = new WeakMap();
let nextId = 1;
/** @param {object} o */
const idOf = (o) => {
  let n = ids.get(o);
  if (!n) ids.set(o, (n = nextId++));
  return n;
};
/** @param {HashTable} h @param {LObj} k */
function hashKey(h, k) {
  if (typeof k === 'number' || typeof k === 'bigint') return `n${k}`;
  if (k instanceof Flt) return h.test === 'eq' ? `f${idOf(k)}` : `f${Object.is(k.v, -0) ? '-0' : k.v}`;
  if (typeof k === 'string') return h.test === 'equal' || h.test === 'eql' || h.test === 'eq' ? `s${k}` : `s${k}`;
  if (k instanceof Sym) return `y${k.interned ? k.name : idOf(k)}${k.interned ? '' : '#'}`;
  if (h.test === 'equal') return `e${print(k)}`;
  return `o${idOf(/** @type {object} */ (k))}`;
}
defun('make-hash-table', 0, -1, (a) => {
  const i = a.indexOf(intern(':test'));
  const test = i >= 0 ? /** @type {Sym} */ (a[i + 1]).name : 'eql';
  if (!['eq', 'eql', 'equal'].includes(test)) throw signal('error', ['Invalid hash table test']);
  return new HashTable(test);
});
/** @param {LObj} h */
const table = (h) => {
  if (h instanceof HashTable) return h;
  throw wrongType('hash-table-p', h);
};
defun('puthash', 3, 3, ([k, v, h]) => (table(h).map.set(hashKey(table(h), k), [k, v]), v));
defun('gethash', 2, 3, ([k, h, d]) => table(h).map.get(hashKey(table(h), k))?.[1] ?? d ?? NIL);
defun('remhash', 2, 2, ([k, h]) => (table(h).map.delete(hashKey(table(h), k)), NIL));
defun('clrhash', 1, 1, ([h]) => (table(h).map.clear(), h));
defun('hash-table-count', 1, 1, ([h]) => table(h).map.size);
defun('hash-table-keys', 1, 1, ([h]) => list([...table(h).map.values()].map((e) => e[0]).reverse()));
defun('hash-table-values', 1, 1, ([h]) => list([...table(h).map.values()].map((e) => e[1]).reverse()));
defun('maphash', 2, 2, ([f, h]) => {
  for (const [k, v] of [...table(h).map.values()]) funcall(f, [k, v]);
  return NIL;
});
defun('copy-hash-table', 1, 1, ([h]) => {
  const out = new HashTable(table(h).test);
  for (const [k, e] of table(h).map) out.map.set(k, [e[0], e[1]]);
  return out;
});

// ---- symbols and functions ----------------------------------------------------------------------

defun('symbol-name', 1, 1, ([s]) => sym(s).name);
defun('intern', 1, 2, ([s]) => intern(str(s)));
defun('intern-soft', 1, 2, ([s]) => (typeof s === 'string' ? (allSymbols().find((x) => x.name === s) ?? NIL) : s));
defun('make-symbol', 1, 1, ([s]) => new Sym(str(s), false));
let gensymCounter = 0;
defun('gensym', 0, 1, ([p]) => new Sym(`${typeof p === 'string' ? p : 'g'}${gensymCounter++}`, false));
defun('symbol-value', 1, 1, ([s]) => {
  const v = sym(s).value;
  if (v === undefined) throw signal('void-variable', [s]);
  return v;
});
defun('symbol-function', 1, 1, ([s]) => sym(s).fn ?? NIL);
defun('boundp', 1, 1, ([s]) => bool(sym(s).value !== undefined));
defun('fboundp', 1, 1, ([s]) => bool(sym(s).fn !== undefined && s !== NIL));
defun('special-variable-p', 1, 1, ([s]) => bool(sym(s).special));
defun('set', 2, 2, ([s, v]) => {
  const symbol = sym(s);
  if (symbol.constant) throw signal('setting-constant', [s]);
  symbol.value = v;
  return v;
});
defun('default-value', 1, 1, ([s]) => {
  const v = sym(s).value;
  if (v === undefined) throw signal('void-variable', [s]);
  return v;
});
defun('fset', 2, 2, ([s, f]) => ((sym(s).fn = f === NIL ? undefined : f), f));
defun('defalias', 2, 3, ([s, f]) => ((sym(s).fn = f), s));
defun('fmakunbound', 1, 1, ([s]) => ((sym(s).fn = undefined), s));
defun('makunbound', 1, 1, ([s]) => ((sym(s).value = undefined), s));
defun('put', 3, 3, ([s, k, v]) => {
  const symbol = sym(s);
  (symbol.plist ??= new Map()).set(sym(k), v);
  return v;
});
defun('get', 2, 2, ([s, k]) => sym(s).plist?.get(sym(k)) ?? NIL);
defun('symbol-plist', 1, 1, ([s]) => list([...(sym(s).plist ?? new Map()).entries()].flat()));
defun('func-arity', 1, 1, ([f]) => {
  let x = f;
  while (x instanceof Sym && x.fn) x = x.fn;
  if (x instanceof Subr) return new Cons(x.min, x.max < 0 ? intern('many') : x.max);
  if (x instanceof Special) return new Cons(x.min, intern('unevalled'));
  if (x instanceof Lambda) {
    let req = 0;
    let opt = 0;
    let mode = 0;
    let many = false;
    for (const p of toArray(x.params)) {
      const n = /** @type {Sym} */ (p).name;
      if (n === '&optional') mode = 1;
      else if (n === '&rest') many = true;
      else if (many) continue;
      else if (mode === 0) req++;
      else opt++;
    }
    return new Cons(req, many ? intern('many') : req + opt);
  }
  throw signal('invalid-function', [f]);
});
defun('eval', 1, 2, ([form, lexical]) => {
  if (lexical === undefined || lexical === NIL) return evalForm(form, null);
  const scope = topScope();
  if (lexical instanceof Cons) {
    for (const e of toArray(lexical)) if (e instanceof Cons && e.car instanceof Sym) scope.vars.set(e.car, e.cdr);
  }
  return evalForm(form, scope);
});
defun('macroexpand-1', 1, 2, ([form]) => {
  if (form instanceof Cons && form.car instanceof Sym && form.car.fn instanceof Lambda && form.car.fn.isMacro) {
    return funcall(new Lambda(form.car.fn.params, form.car.fn.body, form.car.fn.scope, form.car.fn.lexical), toArray(form.cdr));
  }
  return form;
});
defun('macroexpand', 1, 2, ([form]) => {
  /** @type {LObj} */
  let f = form;
  for (let i = 0; i < 1000; i++) {
    const next = funcall(intern('macroexpand-1'), [f]);
    if (next === f) return f;
    f = next;
  }
  return f;
});
defun('require', 1, 3, ([f]) => f);
defun('provide', 1, 2, ([f]) => f);
defun('featurep', 1, 2, () => T);
defun('eval-after-load', 2, 2, ([, form]) => (form instanceof Cons && form.car !== intern('lambda') && form.car !== intern('closure') ? evalForm(form, null) : funcall(form, [])));
// (add-hook HOOK FUNCTION [DEPTH]): FUNCTION joins the list in HOOK, at the front (at the end when DEPTH is non-nil and not negative)
defun('add-hook', 2, 4, ([hook, fn, depth]) => {
  const symbol = sym(hook);
  const cur = symbol.value === undefined || symbol.value === NIL ? NIL : symbol.value;
  const items = cur instanceof Cons ? toArray(cur) : cur === NIL ? [] : [cur];
  if (!items.some((e) => equal(e, fn))) {
    const atEnd = depth !== undefined && depth !== NIL && !(typeof depth === 'number' && depth < 0);
    symbol.value = list(atEnd ? [...items, fn] : [fn, ...items]);
    symbol.special = true;
  }
  return NIL;
});
defun('remove-hook', 2, 3, ([hook, fn]) => {
  const symbol = sym(hook);
  if (symbol.value instanceof Cons) symbol.value = list(toArray(symbol.value).filter((e) => !equal(e, fn)));
  return NIL;
});

// ---- errors and non-local exits ----------------------------------------------------------------

defun('error', 0, -1, (a) => {
  if (!a.length) throw signal('wrong-number-of-arguments', [intern('format-message').fn ?? intern('format-message'), 0]);
  throw new LispSignal(intern('error'), list([formatMessage(str(a[0]), a.slice(1))]));
});
defun('user-error', 0, -1, (a) => {
  if (!a.length) throw signal('wrong-number-of-arguments', [intern('format-message').fn ?? intern('format-message'), 0]);
  throw new LispSignal(intern('user-error'), list([formatMessage(str(a[0]), a.slice(1))]));
});
defun('signal', 2, 2, ([s, data]) => {
  if (s === NIL && data instanceof Cons) throw new LispSignal(/** @type {Sym} */ (data.car), data.cdr);
  throw new LispSignal(sym(s), data);
});
defun('throw', 2, 2, ([tag, value]) => {
  if (!state.catches.some((t) => eql(t, tag))) throw signal('no-catch', [tag, value]);
  throw new LispThrow(tag, value);
});
defun('define-error', 2, 3, ([name, message, parent]) => {
  const parents = parent === undefined || parent === NIL ? ['error'] : parent instanceof Cons ? toArray(parent).map((p) => /** @type {Sym} */ (p).name) : [sym(parent).name];
  defineError(sym(name).name, typeof message === 'string' ? message : '', parents);
  return message;
});
defun('error-message-string', 1, 1, ([e]) => errorMessageString(e));

// ---- output -------------------------------------------------------------------------------------

/** @param {LObj | undefined} dest @param {string} text */
function out(dest, text) {
  if (dest === undefined || dest === NIL || dest === T || dest === intern('standard-output')) emit(text);
  else if (dest instanceof Sym || isFunction(dest)) for (const c of chars(text)) funcall(dest, [/** @type {number} */ (c.codePointAt(0))]);
  else emit(text);
}
defun('message', 1, -1, ([f, ...rest]) => {
  if (f === NIL) return NIL;
  const s = formatMessage(str(f), rest);
  state.messages.push(s);
  return s;
});
defun('format', 1, -1, ([f, ...rest]) => format(str(f), rest));
/** `format-message`: `format` with the grave accent and apostrophe of the format string turned into curved quotes. @param {string} fmt @param {LObj[]} args */
function formatMessage(fmt, args) {
  return format(fmt.replace(/`/g, '‘').replace(/'/g, '’'), args);
}
defun('format-message', 1, -1, ([f, ...rest]) => formatMessage(str(f), rest));
defun('princ', 1, 2, ([x, d]) => (out(d, print(x, false)), x));
defun('prin1', 1, 3, ([x, d]) => (out(d, print(x, true)), x));
defun('print', 1, 2, ([x, d]) => (out(d, `\n${print(x, true)}\n`), x));
defun('terpri', 0, 2, ([d]) => (out(d, '\n'), T));
defun('write-char', 1, 2, ([c, d]) => (out(d, String.fromCodePoint(Number(int(c)))), c));
defun('prin1-to-string', 1, 3, ([x, noescape]) => print(x, noescape === undefined || noescape === NIL));
defun('read', 0, 1, ([s]) => {
  if (typeof s !== 'string') throw signal('error', ['read: only strings are supported']);
  return readFromString(s).obj;
});
defun('read-from-string', 1, 3, ([s, a]) => {
  const { obj, pos } = readFromString(str(s), a === undefined || a === NIL ? 0 : Number(a));
  return new Cons(obj, pos);
});
defvarGlobal('standard-output', T);
defvarGlobal('case-fold-search', T);
defvarGlobal('split-string-default-separators', '[ \f\t\n\r\v]+');
defvarGlobal('print-length', NIL);
defvarGlobal('lexical-binding', T);
defvarGlobal('noninteractive', T);
defvarGlobal('emacs-version', '29.3');
defvarGlobal('emacs-major-version', 29);
defvarGlobal('emacs-minor-version', 3);
defvarGlobal('system-type', intern('gnu/linux'));

// ---- strings ------------------------------------------------------------------------------------

/** One argument of `concat`. @param {LObj} x */
function concatPiece(x) {
  if (typeof x === 'string') return x;
  if (x === NIL) return '';
  if (x instanceof Cons || Array.isArray(x)) return String.fromCodePoint(...seqToArray(x).map((c) => Number(int(c, 'characterp'))));
  throw wrongType('sequencep', x);
}
defun('concat', 0, -1, (a) => a.map(concatPiece).join(''));
defun('string', 0, -1, (a) => String.fromCodePoint(...a.map((c) => Number(int(c, 'characterp')))));
defun('make-string', 2, 3, ([n, c]) => {
  const k = count(n);
  if (typeof c !== 'number' || c < 0 || c > 0x10ffff) throw wrongType('characterp', c);
  return String.fromCodePoint(c).repeat(k);
});
defun('char-to-string', 1, 1, ([c]) => {
  if (typeof c !== 'number' || c < 0 || c > 0x3fffff) throw wrongType('characterp', c);
  return c > 0x10ffff ? '\ufffd' : String.fromCodePoint(c);
});
defun('string-to-char', 1, 1, ([s]) => (str(s) === '' ? 0 : /** @type {number} */ (str(s).codePointAt(0))));
defun('string-to-list', 1, 1, ([s]) => list(seqToArray(str(s))));
defun('string-to-vector', 1, 1, ([s]) => seqToArray(str(s)));

/** Resolves FROM/TO of `substring`-like functions over `n` characters. @param {LObj} obj @param {LObj | undefined} from @param {LObj | undefined} to @param {number} n @returns {[number, number]} */
function range(obj, from, to, n) {
  let a = from === undefined || from === NIL ? 0 : Number(int(from));
  let b = to === undefined || to === NIL ? n : Number(int(to));
  if (a < 0) a += n;
  if (b < 0) b += n;
  if (!(a >= 0 && a <= b && b <= n)) throw signal('args-out-of-range', [obj, from ?? NIL, to ?? NIL]);
  return [a, b];
}
defun('substring', 1, 3, ([s, from, to]) => {
  if (Array.isArray(s)) {
    const [a, b] = range(s, from, to, s.length);
    return s.slice(a, b);
  }
  if (typeof s !== 'string') throw wrongType('arrayp', s);
  const c = chars(s);
  const [a, b] = range(s, from, to, c.length);
  return c.slice(a, b).join('');
});
defun('substring-no-properties', 1, 3, ([s, from, to]) => funcall(intern('substring'), [s, from ?? NIL, to ?? NIL]));
defun('upcase', 1, 1, ([x]) => (typeof x === 'number' ? (String.fromCodePoint(x).toUpperCase().length === String.fromCodePoint(x).length ? (String.fromCodePoint(x).toUpperCase().codePointAt(0) ?? x) : x) : str(x).toUpperCase()));
defun('downcase', 1, 1, ([x]) => (typeof x === 'number' ? /** @type {number} */ (String.fromCodePoint(x).toLowerCase().codePointAt(0)) : str(x).toLowerCase()));
/** @param {string} s @param {boolean} lowerRest */
const capitalizeWords = (s, lowerRest) => s.replace(/[\p{L}\p{N}]+/gu, (w) => w[0].toUpperCase() + (lowerRest ? w.slice(1).toLowerCase() : w.slice(1)));
defun('capitalize', 1, 1, ([x]) => (typeof x === 'number' ? /** @type {number} */ (String.fromCodePoint(x).toUpperCase().codePointAt(0)) : capitalizeWords(str(x), true)));
defun('upcase-initials', 1, 1, ([x]) => (typeof x === 'number' ? /** @type {number} */ (String.fromCodePoint(x).toUpperCase().codePointAt(0)) : capitalizeWords(str(x), false)));
/** @param {LObj} x @returns {string} */
const strOrSym = (x) => (x instanceof Sym ? x.name : str(x));
defun('string=', 2, 2, ([a, b]) => bool(strOrSym(a) === strOrSym(b)));
defAlias('string-equal', 'string=');
defun('string<', 2, 2, ([a, b]) => bool(strOrSym(a) < strOrSym(b)));
defAlias('string-lessp', 'string<');
defun('string>', 2, 2, ([a, b]) => bool(strOrSym(a) > strOrSym(b)));
defAlias('string-greaterp', 'string>');
defun('string-prefix-p', 2, 3, ([p, s, ic]) => bool(ic !== undefined && ic !== NIL ? str(s).toLowerCase().startsWith(str(p).toLowerCase()) : str(s).startsWith(str(p))));
defun('string-suffix-p', 2, 3, ([p, s, ic]) => bool(ic !== undefined && ic !== NIL ? str(s).toLowerCase().endsWith(str(p).toLowerCase()) : str(s).endsWith(str(p))));
defun('string-empty-p', 1, 1, ([s]) => bool(s === ''));
defun('string-blank-p', 1, 1, ([s]) => (/^[ \t\n\r]*$/.test(str(s)) ? 0 : NIL));
defun('string-search', 2, 3, ([needle, hay, start]) => {
  const i = str(hay).indexOf(str(needle), start === undefined || start === NIL ? 0 : Number(start));
  return i < 0 ? NIL : i;
});
defun('string-replace', 3, 3, ([from, to, s]) => {
  if (str(from) === '') throw signal('wrong-length-argument', [0]);
  return str(s).split(str(from)).join(str(to));
});
/** One element of `string-join`, as `concat` takes it: a string, nil, or a list or vector of characters. @param {LObj} x @returns {string} */
function joinPart(x) {
  if (typeof x === 'string') return x;
  if (x === NIL) return '';
  if (x instanceof Cons || Array.isArray(x)) return (Array.isArray(x) ? x : toArray(x)).map((c) => (typeof c === 'number' && c >= 0 ? String.fromCodePoint(c) : (() => { throw wrongType('characterp', c); })())).join('');
  throw wrongType('sequencep', x);
}
defun('string-join', 1, 2, ([l, sep]) => (Array.isArray(l) ? l : toArray(l)).map(joinPart).join(sep === undefined || sep === NIL ? '' : str(sep)));
defun('string-reverse', 1, 1, ([s]) => chars(str(s)).reverse().join(''));
defun('string-width', 1, 3, ([s]) => chars(str(s)).reduce((n, c) => n + charWidth(/** @type {number} */ (c.codePointAt(0))), 0));
defun('string-pad', 2, 4, ([s, n, pad, start]) => {
  const p = pad === undefined || pad === NIL ? ' ' : String.fromCodePoint(Number(pad));
  const missing = Math.max(0, Number(n) - chars(str(s)).length);
  return start !== undefined && start !== NIL ? p.repeat(missing) + str(s) : str(s) + p.repeat(missing);
});
defun('string-chop-newline', 1, 1, ([s]) => str(s).replace(/\n$/, ''));
defun('char-equal', 2, 2, ([a, b]) => bool(a === b || (foldCase() && String.fromCodePoint(Number(a)).toLowerCase() === String.fromCodePoint(Number(b)).toLowerCase())));
defun('number-to-string', 1, 1, ([x]) => {
  if (!isNum(x)) throw wrongType('numberp', x);
  return print(x);
});
defun('string-to-number', 1, 2, ([s, base]) => {
  const text = str(s).replace(/^[ \t]+/, '');
  const b = base === undefined || base === NIL ? 10 : Number(int(base));
  if (b < 2 || b > 16) throw signal('args-out-of-range', [base ?? NIL]);
  if (b !== 10) {
    const m = new RegExp(`^[-+]?[${'0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, b)}]+`, 'i').exec(text);
    if (!m) return 0;
    const n = parseInt(m[0], b);
    return Number.isSafeInteger(n) ? n : normInt(BigInt(n));
  }
  const special = /^([-+]?)\d+\.\d+e\+(INF|NaN)/.exec(text);
  if (special) {
    if (special[2] === 'INF') return flt(special[1] === '-' ? -Infinity : Infinity);
    const nan = flt(NaN);
    nan.pos = special[1] !== '-';
    return nan;
  }
  const m = /^[-+]?(\d+\.?\d*(e[-+]?\d+)?|\.\d+(e[-+]?\d+)?)/i.exec(text);
  if (!m) return 0;
  const t = m[0];
  if (/^[-+]?\d+\.?$/.test(t)) {
    const digits = t.replace(/\.$/, '').replace(/^\+/, '');
    const n = Number(digits);
    return Number.isSafeInteger(n) ? n : BigInt(digits);
  }
  if (/^[-+]?\d+e/i.test(t) || t.includes('.') || /e/i.test(t)) return flt(Number(t));
  return 0;
});

// ---- regexps ------------------------------------------------------------------------------------

/** @returns {boolean} */
const foldCase = () => (intern('case-fold-search').value ?? T) !== NIL;

/** Searches `s` from `start`; sets the match data. @param {string} re @param {string} s @param {number} start @param {boolean} setData */
function search(re, s, start, setData) {
  const rx = toRegExp(re, foldCase(), true);
  rx.lastIndex = start;
  const m = rx.exec(s);
  if (!m) return null;
  if (setData) {
    const data = [m.index, m.index + m[0].length];
    /** @type {(number | null)[]} */
    const md = [data[0], data[1]];
    const idx = /** @type {{ indices?: number[][] }} */ (m).indices;
    void idx;
    // Locate groups by re-running with the `d` flag when the pattern has any
    const { groups, nums, size } = translate(re);
    if (groups) {
      const rd = new RegExp(rx.source, rx.flags.replace('g', '') + 'dy');
      rd.lastIndex = m.index;
      const dm = /** @type {RegExpExecArray & { indices?: ([number, number] | undefined)[] }} */ (rd.exec(s));
      while (md.length < (size + 1) * 2) md.push(null);
      for (let g = 1; g <= groups; g++) {
        const ind = dm?.indices?.[g];
        md[nums[g - 1] * 2] = ind ? ind[0] : null;
        md[nums[g - 1] * 2 + 1] = ind ? ind[1] : null;
      }
    }
    state.matchData = md;
    state.matchString = s;
  }
  return m.index;
}
defun('string-match', 2, 4, ([re, s, start, inhibit]) => {
  const text = str(s);
  let from = start === undefined || start === NIL ? 0 : Number(int(start));
  if (from < 0) from += text.length;
  if (from < 0 || from > text.length) throw signal('args-out-of-range', [s, start ?? NIL]);
  const r = search(str(re), text, from, inhibit === undefined || inhibit === NIL);
  return r === null ? NIL : r;
});
defun('string-match-p', 2, 3, ([re, s, start]) => {
  const r = search(str(re), str(s), start === undefined || start === NIL ? 0 : Number(start), false);
  return r === null ? NIL : r;
});
defun('match-beginning', 1, 1, ([n]) => state.matchData?.[Number(n) * 2] ?? NIL);
defun('match-end', 1, 1, ([n]) => state.matchData?.[Number(n) * 2 + 1] ?? NIL);
defun('match-data', 0, 3, () => {
  const md = [...(state.matchData ?? [])];
  while (md.length > 2 && md[md.length - 1] === null) md.length -= 2;
  return list(md.map((x) => (x === null ? NIL : x)));
});
defun('set-match-data', 1, 2, ([l]) => {
  state.matchData = toArray(l).map((x) => (typeof x === 'number' ? x : null));
  return NIL;
});
defun('match-string', 1, 2, ([n, s]) => {
  const i = Number(n);
  const a = state.matchData?.[i * 2];
  const b = state.matchData?.[i * 2 + 1];
  if (a === undefined || a === null || b === undefined || b === null) return NIL;
  return (s === undefined || s === NIL ? state.matchString : str(s)).slice(a, b);
});
defAlias('match-string-no-properties', 'match-string');
defun('regexp-quote', 1, 1, ([s]) => regexpQuote(str(s)));

/** Expands `\&`, `\N` and `\\` of a replacement. @param {string} rep @param {string} source @param {(number | null)[]} md @param {string} whole */
function expandReplacement(rep, source, md, whole) {
  void whole;
  if (/(^|[^\\])(\\\\)*\\$/.test(rep)) throw signal('error', ['Invalid use of ‘\\’ in replacement text']);
  return rep.replace(/\\(.)/gs, (_, c) => {
    if (c === '?') return '\\?';
    if (c === '&') return source.slice(md[0] ?? 0, md[1] ?? 0);
    if (/\d/.test(c)) {
      const a = md[Number(c) * 2];
      const b = md[Number(c) * 2 + 1];
      return a === undefined || a === null || b === undefined || b === null ? '' : source.slice(a, b);
    }
    if (c === '\\') return '\\';
    throw signal('error', ['Invalid use of ‘\\’ in replacement text']);
  });
}
const WORD = /[\p{L}\p{N}]/u;
/** Case adaptation of `replace-match`. @param {string} matched @param {string} rep */
function adaptCase(matched, rep) {
  let someMulti = false;
  let someLower = false;
  let someUpper = false;
  let someNonUpperInitial = false;
  let prev = '\n';
  for (const c of matched) {
    const lower = c !== c.toUpperCase();
    const upper = c !== c.toLowerCase();
    const prevWord = WORD.test(prev);
    if (lower) {
      someLower = true;
      if (!prevWord) someNonUpperInitial = true;
      else someMulti = true;
    } else if (upper) {
      someUpper = true;
      if (prevWord) someMulti = true;
    } else if (!prevWord) someNonUpperInitial = true;
    prev = c;
  }
  if (!someLower && someMulti) return rep.toUpperCase();
  if (!someNonUpperInitial && someMulti) return capitalizeWords(rep, false);
  if (!someNonUpperInitial && someUpper) return rep.toUpperCase();
  return rep;
}
/** `replace-match` on a string. @param {string} rep @param {boolean} fixedcase @param {boolean} literal @param {string} s @param {number} sub */
function replaceMatchIn(rep, fixedcase, literal, s, sub) {
  const md = state.matchData;
  const a = md?.[sub * 2];
  const b = md?.[sub * 2 + 1];
  if (!md || a === undefined || a === null || b === undefined || b === null) throw signal('error', [`replace-match subexpression does not exist`, sub]);
  let text = literal ? rep : expandReplacement(rep, s, md, s);
  if (!fixedcase) text = adaptCase(s.slice(a, b), text);
  return s.slice(0, a) + text + s.slice(b);
}
defun('replace-match', 1, 5, ([rep, fixed, literal, s, sub]) => {
  if (typeof s !== 'string') throw signal('error', ['replace-match: only strings are supported']);
  return replaceMatchIn(str(rep), fixed !== undefined && fixed !== NIL, literal !== undefined && literal !== NIL, s, sub === undefined || sub === NIL ? 0 : Number(sub));
});
defun('replace-regexp-in-string', 3, 7, ([re, rep, s, fixed, literal, sub, start]) => {
  // a port of subr.el's function: the match data is translated to apply to the matched piece
  const text = str(s);
  const fx = fixed !== undefined && fixed !== NIL;
  const lit = literal !== undefined && literal !== NIL;
  const subexp = sub === undefined || sub === NIL ? 0 : Number(sub);
  let begin = start === undefined || start === NIL ? 0 : Number(start);
  const l = text.length;
  if (begin > l || begin < 0) throw signal('args-out-of-range', [s, start ?? NIL, l]);
  const saved = state.matchData;
  const savedString = state.matchString;
  try {
    /** @type {string[]} */
    const parts = [];
    while (begin < l) {
      const mb = search(str(re), text, begin, true);
      if (mb === null) break;
      let me = /** @type {number} */ (state.matchData?.[1]);
      if (me === mb) me = Math.min(l, mb + 1);
      state.matchData = /** @type {(number | null)[]} */ (state.matchData).map((x) => (x === null ? null : x - mb));
      const piece = text.slice(mb, me);
      state.matchString = piece;
      const newText = typeof rep === 'string' ? rep : str(funcall(rep, [piece.slice(/** @type {number} */ (state.matchData[0]), /** @type {number} */ (state.matchData[1]))]));
      parts.push(text.slice(begin, mb), replaceMatchIn(newText, fx, lit, piece, subexp));
      begin = me;
    }
    parts.push(text.slice(begin, l));
    return parts.join('');
  } finally {
    state.matchData = saved;
    state.matchString = savedString;
  }
});
defun('split-string', 1, 4, ([s, seps, omit, trim]) => {
  const text = str(s);
  const keepNulls = !(seps !== undefined && seps !== NIL ? omit !== undefined && omit !== NIL : true);
  const rexp = seps === undefined || seps === NIL ? str(intern('split-string-default-separators').value ?? '') : str(seps);
  const trimRe = trim === undefined || trim === NIL ? null : str(trim);
  /** @type {string[]} */
  const result = [];
  let start = 0;
  let notfirst = false;
  let lastBegin = 0;
  /** @param {number} a @param {number} b */
  const pushOne = (a, b) => {
    let thisStart = a;
    if (trimRe) {
      const t = search(trimRe, text, thisStart, true);
      if (t === thisStart) thisStart = /** @type {number} */ (state.matchData?.[1]);
    }
    if (keepNulls || thisStart < b) {
      if (thisStart > b) throw signal('args-out-of-range', [text, thisStart, b]);
      let piece = text.slice(thisStart, b);
      if (trimRe) {
        const e = search(`${trimRe}\\'`, piece, 0, true);
        if (e !== null && e < piece.length) piece = piece.slice(0, e);
      }
      if (keepNulls || piece.length > 0) result.push(piece);
    }
  };
  for (;;) {
    const from = notfirst && start === lastBegin && start < text.length ? start + 1 : start;
    const m = from <= text.length ? search(rexp, text, from, true) : null;
    if (m === null || !(start < text.length)) break;
    notfirst = true;
    lastBegin = m;
    const thisStart = start;
    const thisEnd = m;
    start = /** @type {number} */ (state.matchData?.[1]);
    pushOne(thisStart, thisEnd);
  }
  pushOne(start, text.length);
  return list(result);
});
defun('string-trim-left', 1, 2, ([s, re]) => {
  const text = str(s);
  const r = search(`\\\`\\(?:${re === undefined || re === NIL ? '[ \t\n\r]+' : str(re)}\\)`, text, 0, true);
  return r === null ? text : text.slice(/** @type {number} */ (state.matchData?.[1]));
});
defun('string-trim-right', 1, 2, ([s, re]) => {
  const text = str(s);
  const r = search(`\\(?:${re === undefined || re === NIL ? '[ \t\n\r]+' : str(re)}\\)\\'`, text, 0, true);
  return r === null ? text : text.slice(0, /** @type {number} */ (state.matchData?.[0]));
});
defun('string-trim', 1, 3, ([s, l, r]) => funcall(intern('string-trim-left'), [funcall(intern('string-trim-right'), [s, r ?? NIL]), l ?? NIL]));

// ---- format -------------------------------------------------------------------------------------

/** Rounds a finite float to `p` decimals as C's `%.pf` does (exact ties go to even). @param {number} x @param {number} p */
function toFixedC(x, p) {
  if (Math.abs(x) >= 1e21) return BigInt(x).toString() + (p ? `.${'0'.repeat(p)}` : '');
  const up = x.toFixed(p);
  if (p > 70) return up;
  const long = x.toFixed(p + 25);
  const tail = long.slice(long.length - 25);
  if (tail !== `5${'0'.repeat(24)}`) return up;
  let down = long.slice(0, long.length - 25);
  if (down.endsWith('.')) down = down.slice(0, -1);
  const lastDigit = Number(down.replace('.', '').slice(-1));
  return lastDigit % 2 === 0 ? down : up;
}
/** C's `%.pe`. @param {number} x @param {number} p */
function toExpC(x, p) {
  const [m, e] = x.toExponential(p).split('e');
  const n = Number(e);
  return `${m}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
}

/** `format`: `fmt` with `args`, Emacs's directives (`%s %S %d %o %x %X %c %e %f %g %%`, flags, width, precision, `%N$`). @param {string} fmt @param {LObj[]} args */
export function format(fmt, args) {
  let outText = '';
  let next = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
    const c = fmt[i];
    if (c !== '%') {
      outText += c;
      i++;
      continue;
    }
    i++;
    let field = -1;
    const fm = /^(\d+)\$/.exec(fmt.slice(i));
    if (fm) {
      field = Number(fm[1]) - 1;
      i += fm[0].length;
    }
    let flags = '';
    while ('-+ #0'.includes(fmt[i] ?? 'x')) flags += fmt[i++];
    let width = '';
    while (/\d/.test(fmt[i] ?? '')) width += fmt[i++];
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      let p = '';
      while (/\d/.test(fmt[i] ?? '')) p += fmt[i++];
      prec = Number(p || 0);
    }
    const conv = fmt[i++];
    if (conv === undefined) throw signal('error', ['Format string ends in middle of format specifier']);
    if (conv === '%') {
      outText += '%';
      continue;
    }
    if (field >= 0) next = field;
    if (next >= args.length) throw signal('error', ['Not enough arguments for format string']);
    const arg = args[next++];
    const left = flags.includes('-');
    const plus = flags.includes('+');
    const space = flags.includes(' ');
    const alt = flags.includes('#');
    const zero = flags.includes('0') && !left;
    /** @type {string} */
    let body;
    /** @type {string} */
    let sign = '';
    let numeric = false;
    switch (conv) {
      case 's':
      case 'S': {
        body = conv === 's' ? (typeof arg === 'string' ? arg : arg instanceof Sym ? arg.name : print(arg, false)) : print(arg, true);
        if (prec >= 0) body = chars(body).slice(0, prec).join('');
        break;
      }
      case 'c':
        if (typeof arg !== 'number' && typeof arg !== 'bigint') throw signal('error', ['Format specifier doesn’t match argument type']);
        if (!(arg >= 0 && arg <= 0x3fffff)) throw wrongType('characterp', arg);
        body = String.fromCodePoint(Math.min(Number(arg), 0x10ffff));
        break;
      case 'd':
      case 'o':
      case 'x':
      case 'X': {
        if (!isNum(arg)) throw signal('error', ['Format specifier doesn’t match argument type']);
        /** @type {bigint} */
        let v;
        if (arg instanceof Flt) {
          if (!Number.isFinite(arg.v)) throw signal('overflow-error', []);
          v = BigInt(Math.trunc(arg.v));
        } else v = BigInt(arg);
        if (v < 0n) {
          sign = '-';
          v = -v;
        }
        body = v.toString(conv === 'd' ? 10 : conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec >= 0) body = body.padStart(prec, '0');
        if (alt && v !== 0n) body = (conv === 'o' ? '0' : conv === 'x' ? '0x' : conv === 'X' ? '0X' : '') + body;
        if (!sign && (conv === 'd')) sign = plus ? '+' : space ? ' ' : '';
        numeric = prec < 0;
        break;
      }
      case 'e':
      case 'f':
      case 'g': {
        if (!isNum(arg)) throw signal('error', ['Format specifier doesn’t match argument type']);
        const x = num(arg);
        sign = x < 0 || Object.is(x, -0) ? '-' : plus ? '+' : space ? ' ' : '';
        const ax = Math.abs(x);
        if (!Number.isFinite(x)) {
          body = Number.isNaN(x) ? 'nan' : 'inf';
          if (Number.isNaN(x)) sign = /** @type {Flt} */ (arg).pos ? (plus ? '+' : space ? ' ' : '') : '-';
          break;
        }
        const p = prec >= 0 ? prec : 6;
        body = conv === 'f' ? toFixedC(ax, p) : conv === 'e' ? toExpC(ax, p) : formatG(ax, p);
        if (alt && conv !== 'g' && !body.includes('.')) body = body.replace(/^(\d+)/, '$1.');
        numeric = Number.isFinite(x);
        break;
      }
      default:
        throw signal('error', [`Invalid format operation %${conv}`]);
    }
    const len = chars(sign + body).length;
    const w = width ? Number(width) : 0;
    if (len < w) {
      if (left) body = sign + body + ' '.repeat(w - len);
      else if (zero && numeric) body = sign + '0'.repeat(w - len) + body;
      else body = ' '.repeat(w - len) + sign + body;
    } else body = sign + body;
    outText += body;
  }
  return outText;
}

export { floatToString, Reader, userErrors, conditionsOf };
