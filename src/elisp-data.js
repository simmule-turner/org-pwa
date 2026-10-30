// @ts-check
/**
 * The data of the Lisp interpreter (src/elisp.js): symbols, conses, floats, errors and the printer, all as Emacs 29.3 has them.
 *
 * An integer is a JS number (a safe integer); a float is a `Flt`, so `1` and `1.0` stay different as in Emacs. A string is a JS string,
 * a vector a JS array, `nil` and `t` the symbols of those names, a list a chain of `Cons`.
 */

/** @typedef {Sym | Cons | Flt | number | bigint | string | LObj[] | Lambda | Subr | Special | HashTable | Marker} LObj  any Lisp object */
/** @typedef {{ vars: Map<Sym, LObj>, parent: Scope | null }} Scope  a lexical scope */

/** A symbol. `value` is its global (dynamic) value; `fn` its function cell. */
export class Sym {
  /** @param {string} name @param {boolean} [interned] */
  constructor(name, interned = true) {
    this.name = name;
    this.interned = interned;
    /** @type {LObj | undefined} */
    this.value = undefined;
    /** @type {LObj | undefined} */
    this.fn = undefined;
    this.special = false;
    this.constant = false;
    /** @type {Map<Sym, LObj> | null} */
    this.plist = null;
  }
}

/** @type {Map<string, Sym>} */
const obarray = new Map();

/** `intern`. @param {string} name */
export function intern(name) {
  let s = obarray.get(name);
  if (!s) {
    s = new Sym(name);
    obarray.set(name, s);
    if (name.startsWith(':')) {
      s.value = s;
      s.constant = true;
      s.special = true;
    }
  }
  return s;
}

export const NIL = intern('nil');
NIL.value = NIL;
NIL.constant = true;
NIL.special = true;
export const T = intern('t');
T.value = T;
T.constant = true;
T.special = true;

/** Every symbol interned so far, for code that needs to see which variables are bound. @returns {Sym[]} */
export function allSymbols() {
  return [...obarray.values()];
}

/** A cons cell. */
export class Cons {
  /** @param {LObj} car @param {LObj} cdr */
  constructor(car, cdr) {
    this.car = car;
    this.cdr = cdr;
  }
}

/** A float. */
export class Flt {
  /** @param {number} v */
  constructor(v) {
    this.v = v;
    /** For a NaN: whether its sign bit is clear (read from `0.0e+NaN`, or passed on from such an operand). */
    this.pos = false;
  }
}

/** An interpreted function (`lambda`, `defun`, `defmacro`). `scope` is null for dynamic binding. */
export class Lambda {
  /** @param {LObj} params @param {LObj} body @param {Scope | null} scope @param {boolean} lexical */
  constructor(params, body, scope, lexical) {
    this.params = params;
    this.body = body;
    this.scope = scope;
    this.lexical = lexical;
    this.isMacro = false;
    /** A library function (the Lisp prelude's): an argument-count error reports `(MIN . MAX)` as for byte-compiled code. */
    this.compiled = false;
  }
}

/** A built-in function. `fn` takes the evaluated arguments. */
export class Subr {
  /** @param {string} name @param {(args: LObj[]) => LObj} fn @param {number} min @param {number} max  -1 for any number */
  constructor(name, fn, min, max) {
    this.name = name;
    this.fn = fn;
    this.min = min;
    this.max = max;
  }
}

/** A special form: `fn` takes the unevaluated argument list and the scope. */
export class Special {
  /** @param {string} name @param {(args: LObj, scope: Scope | null) => LObj} fn @param {number} [min] @param {number} [max]  -1 for any number */
  constructor(name, fn, min = 0, max = -1) {
    this.name = name;
    this.fn = fn;
    this.min = min;
    this.max = max;
    /** True for a function a script registered (extensions.js), which the next registration replaces. */
    this.user = false;
  }
}

/** A hash table. */
export class HashTable {
  /** @param {string} test */
  constructor(test) {
    this.test = test;
    /** @type {Map<string, [LObj, LObj]>} */
    this.map = new Map();
  }
}

/** The regexp match data, kept as a marker-less record. */
export class Marker {
  constructor() {
    this.pos = 0;
  }
}

// ---- lists --------------------------------------------------------------------------------------

/** @param {LObj} x @returns {x is Cons} */
export const isCons = (x) => x instanceof Cons;
/** @param {LObj} x */
export const isNil = (x) => x === NIL;
/** @param {boolean} b */
export const bool = (b) => (b ? T : NIL);

/** A proper list of `items`. @param {LObj[]} items @param {LObj} [tail] */
export function list(items, tail = NIL) {
  let out = tail;
  for (let i = items.length - 1; i >= 0; i--) out = new Cons(items[i], out);
  return out;
}

/** The elements of a proper list; signals `wrong-type-argument listp` for a dotted or circular one. @param {LObj} x */
export function toArray(x) {
  /** @type {LObj[]} */
  const out = [];
  let p = x;
  let n = 0;
  while (p instanceof Cons) {
    out.push(p.car);
    p = p.cdr;
    if (++n > 10_000_000) throw signal('circular-list', [x]);
  }
  if (p !== NIL) throw signal('wrong-type-argument', [intern('listp'), p]);
  return out;
}

// ---- errors -------------------------------------------------------------------------------------

/** A Lisp error in flight: `(SYMBOL . DATA)`. */
export class LispSignal extends Error {
  /** @param {Sym} symbol @param {LObj} data */
  constructor(symbol, data) {
    super(symbol.name);
    this.symbol = symbol;
    this.data = data;
  }
}

/** A `throw` in flight. */
export class LispThrow extends Error {
  /** @param {LObj} tag @param {LObj} value */
  constructor(tag, value) {
    super('throw');
    this.tag = tag;
    this.value = value;
  }
}

/** The program ran past its step budget: not an Emacs condition, so no `condition-case` can catch it. */
export class BudgetExceeded extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'BudgetExceeded';
  }
}

/** @param {string} symbol @param {LObj[]} data */
export function signal(symbol, data) {
  return new LispSignal(intern(symbol), list(data));
}
/** `(error "message")`. @param {string} message */
export const lispError = (message) => signal('error', [message]);
/** @param {string} predicate @param {LObj} value */
export const wrongType = (predicate, value) => signal('wrong-type-argument', [intern(predicate), value]);

/** The standard error symbols with their parents and messages (the `error-conditions` and `error-message` properties). */
export const ERROR_TABLE = new Map([
  ['error', { parents: [], message: 'error' }],
  ['quit', { parents: [], message: 'Quit' }],
  ['user-error', { parents: ['error'], message: '' }],
  ['args-out-of-range', { parents: ['error'], message: 'Args out of range' }],
  ['arith-error', { parents: ['error'], message: 'Arithmetic error' }],
  ['overflow-error', { parents: ['range-error', 'arith-error', 'error'], message: 'Arithmetic overflow error' }],
  ['range-error', { parents: ['arith-error', 'error'], message: 'Arithmetic range error' }],
  ['domain-error', { parents: ['arith-error', 'error'], message: 'Arithmetic domain error' }],
  ['singularity-error', { parents: ['domain-error', 'arith-error', 'error'], message: 'Arithmetic singularity error' }],
  ['underflow-error', { parents: ['range-error', 'arith-error', 'error'], message: 'Arithmetic underflow error' }],
  ['cyclic-function-indirection', { parents: ['error'], message: 'Symbol’s chain of function indirections contains a loop' }],
  ['end-of-file', { parents: ['error'], message: 'End of file during parsing' }],
  ['invalid-function', { parents: ['error'], message: 'Invalid function' }],
  ['invalid-read-syntax', { parents: ['error'], message: 'Invalid read syntax' }],
  ['no-catch', { parents: ['error'], message: 'No catch for tag' }],
  ['scan-error', { parents: ['error'], message: 'Scan error' }],
  ['setting-constant', { parents: ['error'], message: 'Attempt to set a constant symbol' }],
  ['void-function', { parents: ['error'], message: 'Symbol’s function definition is void' }],
  ['void-variable', { parents: ['error'], message: 'Symbol’s value as variable is void' }],
  ['wrong-number-of-arguments', { parents: ['error'], message: 'Wrong number of arguments' }],
  ['wrong-type-argument', { parents: ['error'], message: 'Wrong type argument' }],
  ['wrong-length-argument', { parents: ['error'], message: 'Wrong length argument' }],
  ['circular-list', { parents: ['error'], message: 'List contains a loop' }],
  ['excessive-lisp-nesting', { parents: ['recursion-error', 'error'], message: 'Lisp nesting exceeds ‘max-lisp-eval-depth’' }],
  ['excessive-variable-binding', { parents: ['recursion-error', 'error'], message: 'Variable binding depth exceeds max-specpdl-size' }],
  ['recursion-error', { parents: ['error'], message: 'Excessive recursive calling error' }],
  ['text-read-only', { parents: ['buffer-read-only', 'error'], message: 'Text is read-only' }],
  ['beginning-of-buffer', { parents: ['error'], message: 'Beginning of buffer' }],
  ['end-of-buffer', { parents: ['error'], message: 'End of buffer' }],
  ['mark-inactive', { parents: ['error'], message: 'The mark is not active now' }],
  ['search-failed', { parents: ['error'], message: 'Search failed' }],
  ['invalid-regexp', { parents: ['error'], message: 'Invalid regexp' }],
  ['cl-assertion-failed', { parents: ['error'], message: 'Assertion failed' }],
]);

/** Errors made with `define-error`, by symbol name. @type {Map<string, { parents: string[], message: string }>} */
export const userErrors = new Map();

/** The condition symbols of an error symbol, itself first. @param {Sym} symbol @returns {string[]} */
export function conditionsOf(symbol) {
  const known = ERROR_TABLE.get(symbol.name) || userErrors.get(symbol.name);
  if (!known) return [];
  return [symbol.name, ...known.parents.filter((p) => p !== symbol.name)];
}

// ---- equality -----------------------------------------------------------------------------------

/** `eql`. @param {LObj} a @param {LObj} b */
export function eql(a, b) {
  if (a === b) return true;
  if (a instanceof Flt && b instanceof Flt) return Object.is(a.v, b.v);
  return false;
}

/** `equal`. @param {LObj} a @param {LObj} b @returns {boolean} */
export function equal(a, b) {
  for (;;) {
    if (eql(a, b)) return true;
    if (a instanceof Cons && b instanceof Cons) {
      if (!equal(a.car, b.car)) return false;
      a = a.cdr;
      b = b.cdr;
      continue;
    }
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, /** @type {LObj[]} */ (b)[i]));
    return false;
  }
}

// ---- printing -----------------------------------------------------------------------------------

/** C's `%.Pg` for a finite number. @param {number} x @param {number} prec */
export function formatG(x, prec) {
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const p = prec === 0 ? 1 : prec;
  const exp = Number(x.toExponential(p - 1).split('e')[1]);
  if (exp < -4 || exp >= p) {
    let [mantissa, e] = x.toExponential(p - 1).split('e');
    if (mantissa.includes('.')) mantissa = mantissa.replace(/0+$/, '').replace(/\.$/, '');
    const n = Number(e);
    return `${mantissa}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
  }
  let s = x.toFixed(Math.max(0, p - 1 - exp));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/** A float as Emacs prints it: the shortest of 15 to 17 significant digits that reads back the same, with ".0" when it looks like an integer. @param {number} x */
export function floatToString(x, positiveNaN = false) {
  if (Number.isNaN(x)) return positiveNaN ? '0.0e+NaN' : '-0.0e+NaN';
  if (x === Infinity) return '1.0e+INF';
  if (x === -Infinity) return '-1.0e+INF';
  let s = '';
  for (let prec = Math.abs(x) < 2.2250738585072014e-308 ? 1 : 15; prec <= 17; prec++) {
    s = formatG(x, prec);
    if (Number(s) === x) break;
  }
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/** Does a symbol name need a backslash to read back, and where. @param {string} name */
function symbolText(name) {
  if (name === '') return '##';
  let out = '';
  const looksNumeric = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(name) || /^[-+]?(\d+\.?\d*|\.\d+)e\+?(INF|NaN)$/.test(name);
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if ('"\\;\'`,#()[]? \t\n\r\f'.includes(c) && !(c === '?' && i > 0) && !(c === '#' && i > 0)) out += '\\' + c;
    else if (c === '.' && (name.length === 1 || i === 0)) out += '\\.';
    else out += c;
  }
  if (looksNumeric) out = '\\' + out;
  else if (name[0] === '?') out = out.startsWith('\\') ? out : '\\' + out;
  return out;
}

/** Prints `x` as `prin1` (`escape` true) or `princ` (false) does. @param {LObj} x @param {boolean} [escape] */
export function print(x, escape = true) {
  /** @type {string[]} */
  const out = [];
  printTo(x, escape, out, 0);
  return out.join('');
}

/** @param {LObj} x @param {boolean} escape @param {string[]} out @param {number} depth */
function printTo(x, escape, out, depth) {
  if (depth > 200) {
    out.push('...');
    return;
  }
  if (typeof x === 'number' || typeof x === 'bigint') out.push(String(x));
  else if (x instanceof Flt) out.push(floatToString(x.v, x.pos));
  else if (typeof x === 'string') {
    if (!escape) out.push(x);
    else out.push('"' + x.replace(/["\\]/g, '\\$&') + '"');
  } else if (x instanceof Sym) {
    if (!escape) out.push(x.name === '' ? '##' : x.name);
    else out.push(x.interned ? symbolText(x.name) : symbolText(x.name));
  } else if (x instanceof Cons) printList(x, escape, out, depth);
  else if (Array.isArray(x)) {
    out.push('[');
    x.forEach((e, i) => {
      if (i) out.push(' ');
      printTo(e, escape, out, depth + 1);
    });
    out.push(']');
  } else if (x instanceof Lambda) printLambda(x, escape, out, depth);
  else if (x instanceof Subr) out.push(`#<subr ${x.name}>`);
  else if (x instanceof Special) out.push(`#<subr ${x.name}>`);
  else if (x instanceof HashTable) {
    out.push(`#s(hash-table size ${Math.max(65, x.map.size)} test ${x.test} rehash-size 1.5 rehash-threshold 0.8125 data (`);
    let first = true;
    for (const [k, v] of x.map.values()) {
      if (!first) out.push(' ');
      first = false;
      printTo(k, escape, out, depth + 1);
      out.push(' ');
      printTo(v, escape, out, depth + 1);
    }
    out.push('))');
  }
  else out.push('#<marker>');
}

/** @param {Lambda} f @param {boolean} escape @param {string[]} out @param {number} depth */
function printLambda(f, escape, out, depth) {
  const head = f.isMacro ? 'macro' : 'lambda';
  if (f.lexical && !f.isMacro) {
    // (closure ENV ARGS BODY...) with ENV the captured variables then t, as Emacs 29 prints an interpreted closure
    /** @type {LObj[]} */
    const env = [];
    for (let s = f.scope; s; s = s.parent) for (const [k, v] of s.vars) env.push(new Cons(k, v));
    env.push(T);
    printTo(new Cons(intern('closure'), new Cons(list(env), new Cons(f.params, f.body))), escape, out, depth + 1);
    return;
  }
  printTo(f.isMacro ? new Cons(intern('macro'), new Cons(intern('lambda'), new Cons(f.params, f.body))) : new Cons(intern(head), new Cons(f.params, f.body)), escape, out, depth + 1);
}

const QUOTES = new Map([['quote', "'"], ['function', "#'"], ['`', '`']]);
/** The commas abbreviate only inside a backquote. */
const COMMAS = new Map([[',', ','], [',@', ',@']]);
const quoting = { backquote: 0 };

/** @param {Cons} x @param {boolean} escape @param {string[]} out @param {number} depth */
function printList(x, escape, out, depth) {
  if (x.car instanceof Sym && x.cdr instanceof Cons && x.cdr.cdr === NIL && (QUOTES.has(x.car.name) || (quoting.backquote > 0 && COMMAS.has(x.car.name)))) {
    out.push(/** @type {string} */ (QUOTES.get(x.car.name) ?? COMMAS.get(x.car.name)));
    const inside = x.car.name === '`';
    if (inside) quoting.backquote += 1;
    try {
      printTo(x.cdr.car, escape, out, depth + 1);
    } finally {
      if (inside) quoting.backquote -= 1;
    }
    return;
  }
  out.push('(');
  /** @type {LObj} */
  let p = x;
  let n = 0;
  let first = true;
  while (p instanceof Cons) {
    if (!first) out.push(' ');
    first = false;
    printTo(p.car, escape, out, depth + 1);
    p = p.cdr;
    if (++n > 100000) {
      out.push(' ...');
      p = NIL;
    }
  }
  if (p !== NIL) {
    out.push(' . ');
    printTo(p, escape, out, depth + 1);
  }
  out.push(')');
}

/** `error-message-string` for the error object `(SYMBOL . DATA)`, as Emacs's `print_error_message` words it. @param {LObj} err */
export function errorMessageString(err) {
  if (err !== NIL && !(err instanceof Cons)) throw wrongType('listp', err);
  const sym = err instanceof Cons ? err.car : NIL;
  /** @type {LObj} */
  let data = err;
  /** @type {LObj} */
  let errmsg;
  if (sym === intern('error')) {
    data = err instanceof Cons && err.cdr instanceof Cons ? err.cdr : NIL;
    errmsg = data instanceof Cons ? data.car : NIL;
  } else {
    const known = sym instanceof Sym ? ERROR_TABLE.get(sym.name) || userErrors.get(sym.name) : undefined;
    errmsg = known ? known.message : NIL;
  }
  const tail = data instanceof Cons ? safeArray(data.cdr) : [];
  let out = '';
  let sep = ': ';
  if (typeof errmsg !== 'string') out += 'peculiar error';
  else if (errmsg.length) out += errmsg;
  else sep = '';
  const princIt = sym === intern('end-of-file') || sym === intern('user-error');
  tail.forEach((item, i) => {
    out += (i === 0 ? sep : ', ') + print(item, !princIt);
  });
  return out;
}

/** @param {LObj} x @returns {LObj[]} */
function safeArray(x) {
  /** @type {LObj[]} */
  const out = [];
  let p = x;
  while (p instanceof Cons) {
    out.push(p.car);
    p = p.cdr;
  }
  if (p !== NIL) out.push(p);
  return out;
}
