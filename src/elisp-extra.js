// @ts-check
/** More Emacs built-ins for the Lisp interpreter: float scaling and sign helpers. */
import { Flt, NIL, Sym, T, bool, signal, toArray, wrongType } from './elisp-data.js';
import { charWidth, } from './elisp-lib.js';
import { regexpQuote } from './elisp-regex.js';
import { defun, state } from './elisp-core.js';

/** @param {import('./elisp-data.js').LObj} x @returns {number} */
function flo(x) {
  if (x instanceof Flt) return x.v;
  throw wrongType('floatp', x);
}

defun('copysign', 2, 2, ([a, b]) => {
  const x = flo(a);
  const y = flo(b);
  const neg = y < 0 || Object.is(y, -0);
  const r = new Flt(neg ? -Math.abs(x) : Math.abs(x));
  if (Number.isNaN(x)) r.pos = !neg;
  return r;
});

defun('ldexp', 2, 2, ([m, e]) => {
  const man = m instanceof Flt ? m.v : typeof m === 'number' || typeof m === 'bigint' ? Number(m) : (() => { throw wrongType('numberp', m); })();
  if (typeof e !== 'number') throw wrongType('fixnump', e);
  let r = man;
  let k = e;
  while (k > 1000) { r *= 2 ** 1000; k -= 1000; }
  while (k < -1000) { r *= 2 ** -1000; k += 1000; }
  const out = new Flt(r * 2 ** k);
  if (Number.isNaN(out.v)) out.pos = m instanceof Flt && m.pos;
  return out;
});

defun('logb', 1, 1, ([x]) => {
  const v = x instanceof Flt ? x.v : typeof x === 'number' ? x : typeof x === 'bigint' ? Number(x) : (() => { throw wrongType('numberp', x); })();
  if (v === 0) return new Flt(-Infinity);
  if (Number.isNaN(v)) { const r = new Flt(NaN); r.pos = x instanceof Flt && x.pos; return r; }
  if (!Number.isFinite(v)) return new Flt(Infinity);
  if (typeof x === 'bigint') return x.toString(2).replace('-', '').length - 1;
  const a = Math.abs(v);
  let e = Math.floor(Math.log2(a));
  if (2 ** (e + 1) <= a) e += 1;
  else if (2 ** e > a) e -= 1;
  return e;
});

/** @param {import('./elisp-data.js').LObj} x @returns {string} */
function strArg(x) {
  if (typeof x === 'string') return x;
  throw wrongType('stringp', x);
}

defun('string-version-lessp', 2, 2, ([a0, b0]) => {
  const a = Array.from(a0 instanceof Sym ? a0.name : strArg(a0));
  const b = Array.from(b0 instanceof Sym ? b0.name : strArg(b0));
  const digit = (/** @type {string | undefined} */ c) => c !== undefined && c >= '0' && c <= '9';
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (digit(a[i]) && digit(b[j])) {
      let ie = i;
      let je = j;
      while (digit(a[ie])) ie += 1;
      while (digit(b[je])) je += 1;
      const x = BigInt(a.slice(i, ie).join(''));
      const y = BigInt(b.slice(j, je).join(''));
      if (x !== y) return bool(x < y);
      i = ie;
      j = je;
    } else {
      if (a[i] !== b[j]) return bool(/** @type {number} */ (a[i].codePointAt(0)) < /** @type {number} */ (b[j].codePointAt(0)));
      i += 1;
      j += 1;
    }
  }
  return bool(a.length - i < b.length - j);
});

defun('string-distance', 2, 3, ([a0, b0]) => {
  const a = Array.from(strArg(a0));
  const b = Array.from(strArg(b0));
  let prev = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
});

defun('string-limit', 2, 4, ([s, n, end]) => {
  const a = Array.from(strArg(s));
  if (typeof n !== 'number') throw wrongType('integerp', n);
  if (n < 0) throw wrongType('natnump', n);
  if (end !== undefined && end !== NIL) return a.slice(Math.max(0, a.length - n)).join('');
  return a.slice(0, n).join('');
});

defun('truncate-string-to-width', 2, 6, ([s, end, start, padding, ellipsis]) => {
  const a = Array.from(strArg(s));
  if (typeof end !== 'number') throw wrongType('integerp', end);
  const from = typeof start === 'number' ? start : 0;
  const pad = typeof padding === 'number' ? String.fromCodePoint(padding) : '';
  const total = a.reduce((n, c) => n + charWidth(/** @type {number} */ (c.codePointAt(0))), 0);
  let ell = '';
  if (ellipsis !== undefined && ellipsis !== NIL && total > end) ell = typeof ellipsis === 'string' ? ellipsis : '…';
  const limit = end - ell.split('').length;
  let col = 0;
  let out = '';
  let headPad = '';
  for (const c of a) {
    const w = charWidth(/** @type {number} */ (c.codePointAt(0)));
    if (col + w > (ell ? limit : end)) break;
    if (col >= from) out += c;
    else if (col + w > from && pad) headPad += pad;
    col += w;
  }
  if (ell) return headPad + out + ell;
  if (pad && col < end) out += pad.repeat(end - col);
  return headPad + out;
});

defun('regexp-opt-charset', 1, 1, ([chars]) => {
  const codes = [...new Set(toArray(chars).map((c) => /** @type {number} */ (c)))].sort((x, y) => x - y);
  if (codes.length === 0) return '\\(?:\\`a\\`\\)';
  let bracket = '';
  let dash = '';
  let caret = '';
  let body = '';
  /** @type {number[]} */
  const rest = [];
  for (const c of codes) {
    if (c === 93) bracket = ']';
    else if (c === 45) dash = '-';
    else if (c === 94) caret = '^';
    else rest.push(c);
  }
  for (let i = 0; i < rest.length;) {
    let j = i;
    while (j + 1 < rest.length && rest[j + 1] === rest[j] + 1) j += 1;
    if (rest[j] > rest[i] + 2) body += `${String.fromCodePoint(rest[i])}-${String.fromCodePoint(rest[j])}`;
    else for (let k = i; k <= j; k += 1) body += String.fromCodePoint(rest[k]);
    i = j + 1;
  }
  if (codes.length === 1 && !bracket && !dash && !caret) return regexpQuote(body);
  if (codes.length === 1 && bracket) return '\\]';
  if (codes.length === 1 && caret) return '\\^';
  if (codes.length === 1 && dash) return '-';
  if (body === '' && bracket === '' && dash === '' && caret) return '\\^';
  return `[${bracket}${body}${caret}${dash}]`;
});

defun('compare-strings', 6, 7, ([a, s1, e1, b, s2, e2, fold]) => {
  const x = Array.from(strArg(a));
  const y = Array.from(strArg(b));
  const cut = (/** @type {string[]} */ arr, /** @type {import('./elisp-data.js').LObj} */ from, /** @type {import('./elisp-data.js').LObj} */ to) => {
    const f = from === NIL ? 0 : Number(from);
    const t = to === NIL ? arr.length : Math.min(Number(to), arr.length);
    return arr.slice(f, t);
  };
  const p = cut(x, s1, e1);
  const q = cut(y, s2, e2);
  const up = (/** @type {string} */ c) => (fold === NIL ? c : c.toUpperCase());
  const n = Math.min(p.length, q.length);
  for (let i = 0; i < n; i += 1) {
    const c = /** @type {number} */ (up(p[i]).codePointAt(0));
    const d = /** @type {number} */ (up(q[i]).codePointAt(0));
    if (c !== d) return c < d ? -(i + 1) : i + 1;
  }
  if (p.length === q.length) return T;
  return p.length < q.length ? -(n + 1) : n + 1;
});

defun('match-data--translate', 1, 1, ([n]) => {
  if (typeof n !== 'number') throw wrongType('integerp', n);
  if (state.matchData) state.matchData = state.matchData.map((x) => (x === null ? null : x + n));
  return NIL;
});

/** org-link-escape: backslashes before a bracket or the end of the link are doubled, and a bracket gets one more. @param {string} link */
const escapeLink = (link) => link.replace(/(\\*)([[\]]|$)/g, (_m, slashes, end) => slashes + slashes + (end === '' ? '' : '\\') + end);

defun('org-link-escape', 1, 1, ([link]) => {
  if (typeof link !== 'string') throw wrongType('stringp', link);
  return escapeLink(link);
});

defun('org-link-make-string', 1, 2, ([link, desc]) => {
  if (typeof link !== 'string') throw wrongType('stringp', link);
  if (desc !== undefined && desc !== NIL && typeof desc !== 'string') throw wrongType('stringp', desc);
  const text = typeof desc === 'string' && desc.trim() !== '' ? desc.trim().replace(/\]$/, '$&​').replace(/\]\]/g, ']​]') : null;
  if (link.trim() === '') {
    if (text !== null) return text;
    throw signal('error', ['Empty link']);
  }
  return `[[${escapeLink(link)}]${text === null ? '' : `[${text}]`}]`;
});
