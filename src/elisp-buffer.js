// @ts-check
/**
 * Text buffers for the Lisp interpreter, as Emacs 29.3 has them: a string with point and a narrowing, positions counted in
 * characters from 1. `with-temp-buffer` makes one; a program that does not has a buffer of its own to work in. There are no files,
 * windows, markers or text properties. Searching uses the same Emacs-regexp translation as `string-match` (src/elisp-regex.js),
 * and the match data it leaves holds buffer positions, so `match-string` and `replace-match` read and edit the buffer.
 */
import { Buffer, Cons, NIL, T, bool, intern, isStr, list, signal, toArray, unbox, wrongType } from './elisp-data.js';
import { defAlias, defSpecial, defun, emit, evalForm, progn, state, tick, withDynamic } from './elisp-core.js';
import { adaptCase, expandReplacement, search } from './elisp-lib.js';
import { posixClass, regexpQuote, translate } from './elisp-regex.js';
import { guardFor } from './regex-guard.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */
/** @typedef {(number | null)[]} MatchData */

// ---- the current buffer and positions ---------------------------------------------------------------------------------

/** The current buffer; the first call of a run makes the buffer a program works in when it has made none. */
const cur = () => state.buffer ?? (state.buffer = new Buffer('*scratch*'));

/** Per buffer: whether its text holds characters outside the BMP, and where each character starts in the string (only then). @type {WeakMap<Buffer, { text: string, offsets: number[] | null }>} */
const layouts = new WeakMap();

/** @param {Buffer} b */
function layout(b) {
  let l = layouts.get(b);
  if (!l || l.text !== b.text) {
    /** @type {number[] | null} */
    let offsets = null;
    if (/[\ud800-\udfff]/.test(b.text)) {
      offsets = [];
      for (let i = 0; i < b.text.length; i++) {
        offsets.push(i);
        if (b.text.charCodeAt(i) >= 0xd800 && b.text.charCodeAt(i) <= 0xdbff && i + 1 < b.text.length) i++;
      }
      offsets.push(b.text.length);
    }
    l = { text: b.text, offsets };
    layouts.set(b, l);
  }
  return l;
}

/** The number of characters in the buffer. @param {Buffer} b */
function size(b) {
  const { offsets } = layout(b);
  return offsets ? offsets.length - 1 : b.text.length;
}

/** The string index of position `pos` (1-based). @param {Buffer} b @param {number} pos */
function index(b, pos) {
  const { offsets } = layout(b);
  return offsets ? offsets[pos - 1] : pos - 1;
}

/** The characters of a string. @param {string} s */
function countChars(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** The text between two positions. @param {Buffer} b @param {number} from @param {number} to */
const slice = (b, from, to) => b.text.slice(index(b, from), index(b, to));

/** The character at `pos`, or undefined. @param {Buffer} b @param {number} pos */
function charAt(b, pos) {
  const i = index(b, pos);
  return b.text.codePointAt(i);
}

/** The character before `pos`. @param {Buffer} b @param {number} pos */
function charBefore(b, pos) {
  const { offsets } = layout(b);
  return b.text.codePointAt(offsets ? offsets[pos - 2] : pos - 2);
}

/** A string index of the accessible text and back, for a search. */
class Region {
  /** @param {Buffer} b @param {string} [only]  the text to use instead of the accessible part (it starts at `begv` all the same) */
  constructor(b, only) {
    this.b = b;
    this.text = only ?? slice(b, b.begv, b.zv);
    this.base = b.begv;
    this.astral = /[\ud800-\udfff]/.test(this.text);
    /** @type {number[] | null} */
    this.offsets = null;
    if (this.astral) {
      this.offsets = [];
      for (let i = 0; i < this.text.length; i++) {
        this.offsets.push(i);
        if (this.text.charCodeAt(i) >= 0xd800 && this.text.charCodeAt(i) <= 0xdbff && i + 1 < this.text.length) i++;
      }
      this.offsets.push(this.text.length);
    }
  }

  /** The string index of a buffer position. @param {number} pos */
  toIndex(pos) {
    return this.offsets ? this.offsets[pos - this.base] : pos - this.base;
  }

  /** The buffer position of a string index. @param {number} i */
  toPos(i) {
    if (!this.offsets) return this.base + i;
    let lo = 0;
    let hi = this.offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.offsets[mid] < i) lo = mid + 1;
      else hi = mid;
    }
    return this.base + lo;
  }

  /** The index after the character at `i`. @param {number} i */
  next(i) {
    const c = this.text.charCodeAt(i);
    return c >= 0xd800 && c <= 0xdbff && i + 1 < this.text.length ? i + 2 : i + 1;
  }
}

/** @param {number} lo @param {number} x @param {number} hi */
const clip = (lo, x, hi) => (x < lo ? lo : x > hi ? hi : x);

/** An integer argument. @param {LObj} x @param {string} [pred] @returns {number} */
function fixnum(x, pred = 'fixnump') {
  if (typeof x === 'number') return x;
  throw wrongType(pred, x);
}

/** A position argument (a marker is not supported, a float or anything else is the wrong type). @param {LObj} x @returns {number} */
const position = (x) => fixnum(x, 'integer-or-marker-p');
/** An argument of `min` and `max`. @param {LObj} x */
const numberOrMarker = (x) => fixnum(x, 'number-or-marker-p');

const given = (/** @type {LObj | undefined} */ x) => x !== undefined && x !== NIL;

/** A string argument. @param {LObj} x @returns {string} */
function text(x) {
  if (isStr(x)) return x.valueOf();
  throw wrongType('stringp', x);
}

// ---- editing ----------------------------------------------------------------------------------------------------------

/**
 * Replaces the characters from `from` to `to` by `s`. Point and the saved places move as Emacs's markers do: a place after the
 * change shifts, one inside it goes to its start, and one at the start of an insertion stays unless it advances.
 * @param {Buffer} b @param {number} from @param {number} to @param {string} s
 */
function edit(b, from, to, s) {
  const added = countChars(s);
  const delta = added - (to - from);
  const a = index(b, from);
  const z = index(b, to);
  b.text = b.text.slice(0, a) + s + b.text.slice(z);
  /** @param {number} p @param {boolean} advance */
  const move = (p, advance) => {
    if (p >= to && !(from === to && p === from && !advance)) return p + delta;
    if (p > from) return from;
    return p;
  };
  b.pt = move(b.pt, false);
  b.zv += delta;
  for (const m of b.marks) m.pos = move(m.pos, m.advance);
}

/** Inserts at point and leaves point after the text. @param {Buffer} b @param {string} s */
function insertText(b, s) {
  if (s === '') return;
  const at = b.pt;
  edit(b, at, at, s);
  b.pt = at + countChars(s);
}

/** The accessible region `a`..`b` of two position arguments, in order. @param {Buffer} buf @param {LObj} a @param {LObj} b @returns {[number, number]} */
function region(buf, a, b) {
  let from = position(a);
  let to = position(b);
  if (from > to) [from, to] = [to, from];
  if (from < buf.begv || to > buf.zv) throw signal('args-out-of-range', [buf, a, b]);
  return [from, to];
}

// ---- buffers ----------------------------------------------------------------------------------------------------------

/** @param {LObj} x @returns {Buffer} */
function buffer(x) {
  if (x instanceof Buffer) {
    if (!x.live) throw signal('error', ['Selecting deleted buffer']);
    return x;
  }
  if (isStr(x)) throw signal('error', [`No buffer named ${x.valueOf()}`]);
  throw wrongType('stringp', x);
}

defun('current-buffer', 0, 0, () => cur());
defun('bufferp', 1, 1, ([x]) => bool(x instanceof Buffer));
defun('buffer-live-p', 1, 1, ([x]) => bool(x instanceof Buffer && x.live));
defun('set-buffer', 1, 1, ([x]) => {
  state.buffer = buffer(x);
  return state.buffer;
});

defSpecial('with-temp-buffer', (args, scope) => {
  const before = state.buffer;
  const temp = new Buffer(' *temp*');
  state.buffer = temp;
  try {
    return progn(args, scope);
  } finally {
    temp.live = false;
    state.buffer = before && before.live ? before : null;
  }
});

defSpecial('with-current-buffer', (args, scope) => {
  const target = buffer(evalForm(args instanceof Cons ? args.car : NIL, scope));
  const before = cur();
  state.buffer = target;
  try {
    return progn(args instanceof Cons ? args.cdr : NIL, scope);
  } finally {
    if (before.live) state.buffer = before;
  }
}, 1);

defSpecial('save-excursion', (args, scope) => {
  const b = cur();
  const mark = { pos: b.pt, advance: false };
  b.marks.push(mark);
  try {
    return progn(args, scope);
  } finally {
    b.marks.splice(b.marks.indexOf(mark), 1);
    if (b.live) {
      state.buffer = b;
      b.pt = clip(b.begv, mark.pos, b.zv);
    }
  }
});

defSpecial('save-restriction', (args, scope) => {
  const b = cur();
  const narrowed = b.begv !== 1 || b.zv !== size(b) + 1;
  const beg = { pos: b.begv, advance: false };
  const end = { pos: b.zv, advance: true };
  if (narrowed) b.marks.push(beg, end);
  try {
    return progn(args, scope);
  } finally {
    if (narrowed) b.marks.splice(b.marks.indexOf(beg), 2);
    if (b.live) {
      b.begv = narrowed ? beg.pos : 1;
      b.zv = narrowed ? end.pos : size(b) + 1;
      b.pt = clip(b.begv, b.pt, b.zv);
    }
  }
});

defun('narrow-to-region', 2, 2, ([a, c]) => {
  const b = cur();
  let from = position(a);
  let to = position(c);
  if (from > to) [from, to] = [to, from];
  if (from < 1 || to > size(b) + 1) throw signal('args-out-of-range', [a, c]);
  b.begv = from;
  b.zv = to;
  b.pt = clip(from, b.pt, to);
  return NIL;
});
defun('widen', 0, 0, () => {
  const b = cur();
  b.begv = 1;
  b.zv = size(b) + 1;
  return NIL;
});
defun('buffer-size', 0, 1, ([x]) => size(given(x) ? buffer(x) : cur()));

// ---- point and motion -------------------------------------------------------------------------------------------------

defun('point', 0, 0, () => cur().pt);
defun('point-min', 0, 0, () => cur().begv);
defun('point-max', 0, 0, () => cur().zv);
defun('goto-char', 1, 1, ([pos]) => {
  const b = cur();
  b.pt = clip(b.begv, position(pos), b.zv);
  return pos;
});
defun('bobp', 0, 0, () => bool(cur().pt === cur().begv));
defun('eobp', 0, 0, () => bool(cur().pt === cur().zv));
defun('bolp', 0, 0, () => {
  const b = cur();
  return bool(b.pt === b.begv || charBefore(b, b.pt) === 10);
});
defun('eolp', 0, 0, () => {
  const b = cur();
  return bool(b.pt === b.zv || charAt(b, b.pt) === 10);
});

defun('forward-char', 0, 1, ([n]) => {
  const b = cur();
  const target = b.pt + (given(n) ? fixnum(n) : 1);
  if (target < b.begv) {
    b.pt = b.begv;
    throw signal('beginning-of-buffer', []);
  }
  if (target > b.zv) {
    b.pt = b.zv;
    throw signal('end-of-buffer', []);
  }
  b.pt = target;
  return NIL;
});
defun('backward-char', 0, 1, ([n]) => {
  const b = cur();
  const target = b.pt - (given(n) ? fixnum(n) : 1);
  if (target < b.begv) {
    b.pt = b.begv;
    throw signal('beginning-of-buffer', []);
  }
  if (target > b.zv) {
    b.pt = b.zv;
    throw signal('end-of-buffer', []);
  }
  b.pt = target;
  return NIL;
});

/**
 * Where `forward-line` with COUNT goes from point, and how many lines it fell short.
 * @param {Buffer} b @param {number} count
 * @returns {{ pos: number, shortage: number }}
 */
function lineScan(b, count) {
  const r = new Region(b);
  const here = r.toIndex(b.pt);
  if (count > 0) {
    let seen = 0;
    let i = r.text.indexOf('\n', here);
    let at = here;
    while (i >= 0 && seen < count) {
      seen++;
      at = i + 1;
      i = r.text.indexOf('\n', at);
    }
    if (seen === count) return { pos: r.toPos(at), shortage: 0 };
    return { pos: b.zv, shortage: count - seen };
  }
  const wanted = 1 - count;
  let seen = 0;
  let i = here;
  while (seen < wanted) {
    i = i > 0 ? r.text.lastIndexOf('\n', i - 1) : -1;
    if (i < 0) break;
    seen++;
    if (seen === wanted) return { pos: r.toPos(i + 1), shortage: 0 };
  }
  return { pos: b.begv, shortage: wanted - seen };
}

defun('forward-line', 0, 1, ([n]) => {
  const b = cur();
  const count = given(n) ? fixnum(n, 'integerp') : 1;
  const old = b.pt;
  const { pos, shortage: raw } = lineScan(b, count);
  b.pt = pos;
  let shortage = raw;
  if (shortage > 0 && (count <= 0 || (b.zv > b.begv && b.pt !== old && charBefore(b, b.pt) !== 10))) shortage--;
  return count <= 0 ? -shortage : shortage;
});

/** The start of the line `n` lines on from point's. @param {Buffer} b @param {number} n */
function lineStart(b, n) {
  return n === 1 ? lineScan(b, 0).pos : lineScan(b, n - 1).pos;
}

/** The end of the line `n` lines on from point's. @param {Buffer} b @param {number} n */
function lineEnd(b, n) {
  const count = n - (n <= 0 ? 1 : 0);
  const r = new Region(b);
  const here = r.toIndex(b.pt);
  if (count > 0) {
    let seen = 0;
    let i = r.text.indexOf('\n', here);
    while (i >= 0) {
      seen++;
      if (seen === count) return r.toPos(i);
      i = r.text.indexOf('\n', i + 1);
    }
    return b.zv;
  }
  let seen = 0;
  let i = here;
  while (i > 0) {
    i = r.text.lastIndexOf('\n', i - 1);
    if (i < 0) break;
    seen++;
    if (seen === -count) return r.toPos(i);
  }
  return b.begv;
}

const lineArg = (/** @type {LObj | undefined} */ n) => (n !== undefined && n !== NIL ? fixnum(n, 'integerp') : 1);

defun('line-beginning-position', 0, 1, ([n]) => lineStart(cur(), lineArg(n)));
defun('line-end-position', 0, 1, ([n]) => lineEnd(cur(), lineArg(n)));
defAlias('pos-bol', 'line-beginning-position');
defAlias('pos-eol', 'line-end-position');
defun('beginning-of-line', 0, 1, ([n]) => {
  const b = cur();
  b.pt = lineStart(b, lineArg(n));
  return NIL;
});
defun('end-of-line', 0, 1, ([n]) => {
  const b = cur();
  b.pt = lineEnd(b, lineArg(n));
  return NIL;
});

// ---- characters and text ----------------------------------------------------------------------------------------------

defun('char-after', 0, 1, ([pos]) => {
  const b = cur();
  const p = given(pos) ? position(pos) : b.pt;
  return p < b.begv || p >= b.zv ? NIL : (charAt(b, p) ?? NIL);
});
defun('char-before', 0, 1, ([pos]) => {
  const b = cur();
  const p = given(pos) ? position(pos) : b.pt;
  return p <= b.begv || p > b.zv ? NIL : (charBefore(b, p) ?? NIL);
});
defun('following-char', 0, 0, () => {
  const b = cur();
  return b.pt >= b.zv ? 0 : (charAt(b, b.pt) ?? 0);
});
defun('preceding-char', 0, 0, () => {
  const b = cur();
  return b.pt <= b.begv ? 0 : (charBefore(b, b.pt) ?? 0);
});

defun('insert', 0, -1, (args) => {
  const b = cur();
  const parts = args.map((a) => {
    if (typeof a === 'number' && a >= 0 && a <= 0x10ffff) return String.fromCodePoint(a);
    if (isStr(a)) return a.valueOf();
    throw wrongType('char-or-string-p', a);
  });
  // a function command (agenda-lisp.js) has no buffer to show: what it inserts is its output
  if (b.name === '*scratch*' && intern('org-xx--insert-to-output').value === T) for (const p of parts) emit(p);
  else for (const p of parts) insertText(b, p);
  return NIL;
});

defun('buffer-string', 0, 0, () => {
  const b = cur();
  return slice(b, b.begv, b.zv);
});
defun('buffer-substring', 2, 2, ([a, c]) => {
  const b = cur();
  const [from, to] = region(b, a, c);
  return slice(b, from, to);
});
defAlias('buffer-substring-no-properties', 'buffer-substring');
defun('delete-region', 2, 2, ([a, c]) => {
  const b = cur();
  const [from, to] = region(b, a, c);
  edit(b, from, to, '');
  return NIL;
});
defun('delete-char', 1, 2, ([n]) => {
  const b = cur();
  const k = fixnum(n);
  const target = b.pt + k;
  if (k < 0) {
    if (target < b.begv) throw signal('beginning-of-buffer', []);
    edit(b, target, b.pt, '');
  } else {
    if (target > b.zv) throw signal('end-of-buffer', []);
    edit(b, b.pt, target, '');
  }
  return NIL;
});
defun('erase-buffer', 0, 0, () => {
  const b = cur();
  b.begv = 1;
  b.zv = size(b) + 1;
  edit(b, 1, b.zv, '');
  return NIL;
});

defun('line-number-at-pos', 0, 2, ([pos, absolute]) => {
  const b = cur();
  let p = b.pt;
  if (given(pos)) {
    p = fixnum(pos);
    if (p < 1 || p > size(b) + 1) throw signal('args-out-of-range', [p, 1, size(b) + 1]);
  }
  const from = given(absolute) ? 1 : b.begv;
  if (!given(absolute)) p = clip(b.begv, p, b.zv);
  let lines = 1;
  const part = slice(b, from, p);
  for (let i = part.indexOf('\n'); i >= 0; i = part.indexOf('\n', i + 1)) lines++;
  return lines;
});

defun('count-lines', 2, 3, ([a, c]) => {
  const b = cur();
  let from = position(a);
  let to = position(c);
  if (from > to) [from, to] = [to, from];
  if (from < 1 || to > size(b) + 1) throw signal('args-out-of-range', [a, c]);
  const part = slice(b, from, to);
  let lines = 0;
  for (let i = part.indexOf('\n'); i >= 0; i = part.indexOf('\n', i + 1)) lines++;
  return part !== '' && !part.endsWith('\n') ? lines + 1 : lines;
});

// ---- skipping characters ----------------------------------------------------------------------------------------------

/**
 * The predicate for the characters of a `skip-chars-forward` string: `a-z` ranges, `[:class:]`, `\` to quote, a leading `^` to negate.
 * @param {string} spec @returns {(c: number) => boolean}
 */
function charSet(spec) {
  const chars = Array.from(spec);
  let i = 0;
  const negate = chars[0] === '^';
  if (negate) i = 1;
  let body = '';
  /** @param {number} c */
  const hex = (c) => `\\u{${c.toString(16)}}`;
  while (i < chars.length) {
    let c = chars[i];
    if (c === '[' && chars[i + 1] === ':') {
      const end = chars.indexOf(':', i + 2);
      if (end > 0 && chars[end + 1] === ']') {
        const name = chars.slice(i + 2, end).join('');
        const cls = posixClass(name);
        if (cls === undefined) throw signal('error', ['Invalid ISO C character class']);
        body += cls;
        i = end + 2;
        continue;
      }
    }
    if (c === '\\') {
      i++;
      if (i >= chars.length) break;
      c = chars[i];
    }
    i++;
    const lo = /** @type {number} */ (c.codePointAt(0));
    if (chars[i] === '-' && i + 1 < chars.length) {
      let j = i + 1;
      let h = chars[j];
      if (h === '\\') {
        j++;
        if (j >= chars.length) break;
        h = chars[j];
      }
      const hi = /** @type {number} */ (h.codePointAt(0));
      i = j + 1;
      if (lo <= hi) body += `${hex(lo)}-${hex(hi)}`;
    } else body += hex(lo);
  }
  const re = new RegExp(body === '' ? '(?!)' : `[${body}]`, 'u');
  return (c) => re.test(String.fromCodePoint(c)) !== negate;
}

/** @param {boolean} forward @param {LObj} spec @param {LObj} limit */
function skipChars(forward, spec, limit) {
  const b = cur();
  const test = charSet(text(spec));
  const lim = given(limit) ? clip(b.begv, position(limit), b.zv) : forward ? b.zv : b.begv;
  const start = b.pt;
  if (forward) while (b.pt < lim && test(/** @type {number} */ (charAt(b, b.pt)))) b.pt++;
  else while (b.pt > lim && test(/** @type {number} */ (charBefore(b, b.pt)))) b.pt--;
  return b.pt - start;
}
defun('skip-chars-forward', 1, 2, ([spec, lim]) => skipChars(true, spec, lim));
defun('skip-chars-backward', 1, 2, ([spec, lim]) => skipChars(false, spec, lim));

// ---- searching --------------------------------------------------------------------------------------------------------

const caseFold = () => (intern('case-fold-search').value ?? T) !== NIL;

/** The match data the string search left in `r`'s string indices, as buffer positions. @param {Region} r @param {MatchData} md @returns {MatchData} */
const toPositions = (r, md) => md.map((x) => (x === null ? null : r.toPos(x)));

/**
 * A match of `re` that starts at string index `at` of `text` and was found in the whole text but runs past `limit`: the match of the
 * text cut at `limit`, as Emacs's search with a bound sees it. Returns string indices, or null.
 * @param {string} text @param {string} re @param {number} at @param {number} limit
 * @returns {MatchData | null}
 */
function cutMatch(text, re, at, limit) {
  const cut = text.slice(0, limit);
  const saved = [state.matchData, state.matchBuffer, state.matchString];
  try {
    const { source, groups, nums, size: top } = translate(re);
    const flags = `muyd${caseFold() ? 'i' : ''}`;
    if (guardFor(source, flags, cut.length)) {
      const found = search(re, cut, at, true);
      return found === at ? /** @type {MatchData} */ ([...(state.matchData ?? [])]) : null;
    }
    const rx = new RegExp(source, flags);
    rx.lastIndex = at;
    const m = /** @type {RegExpExecArray & { indices?: ([number, number] | undefined)[] } | null} */ (rx.exec(cut));
    if (!m) return null;
    /** @type {MatchData} */
    const md = [m.index, m.index + m[0].length];
    while (md.length < (top + 1) * 2) md.push(null);
    for (let g = 1; g <= groups; g++) {
      const ind = m.indices?.[g];
      md[nums[g - 1] * 2] = ind ? ind[0] : null;
      md[nums[g - 1] * 2 + 1] = ind ? ind[1] : null;
    }
    return md;
  } finally {
    [state.matchData, state.matchBuffer, state.matchString] = /** @type {[MatchData | null, Buffer | null, string]} */ (saved);
  }
}

/**
 * The match of `re` starting at or after string index `from` whose end is at or before `limit`, as buffer positions; null for none.
 * @param {Region} r @param {string} re @param {number} from @param {number} limit
 * @returns {MatchData | null}
 */
function matchFrom(r, re, from, limit) {
  let at = from;
  while (at <= limit) {
    tick();
    const found = search(re, r.text, at, true);
    if (found === null || found > limit) return null;
    const md = /** @type {MatchData} */ ([...(state.matchData ?? [])]);
    if (/** @type {number} */ (md[1]) <= limit) return toPositions(r, md);
    const cut = cutMatch(r.text, re, found, limit);
    if (cut) return toPositions(r, cut);
    at = r.next(found);
  }
  return null;
}

/** Makes `md` the match data of a search in `b`. @param {Buffer} b @param {MatchData} md */
function setMatch(b, md) {
  regs.high = Math.max(regs.high, md.length / 2 - 1);
  state.matchData = md;
  state.matchBuffer = b;
  state.matchString = '';
}

/**
 * Searches `n` times from point, forward (`n` > 0) or backward, within `lim`, as Emacs's `search_buffer`. Returns the new point, or
 * the number of matches still missing as a negative number; the match data is that of the last match found.
 * @param {Buffer} b @param {string} re @param {number} n @param {number} lim
 * @returns {number}
 */
function searchBuffer(b, re, n, lim) {
  let pos = b.pt;
  if (n === 0 || re === '') {
    setMatch(b, [pos, pos]);
    return pos;
  }
  const r = new Region(b);
  const savedData = state.matchData;
  const savedBuffer = state.matchBuffer;
  const savedString = state.matchString;
  /** @type {MatchData | null} */
  let last = null;
  let remaining = Math.abs(n);
  try {
    while (remaining > 0) {
      let md;
      if (n > 0) md = matchFrom(r, re, r.toIndex(pos), r.toIndex(lim));
      else md = lastMatch(r, re, r.toIndex(lim), r.toIndex(pos));
      if (!md) {
        if (last) setMatch(b, last);
        else {
          state.matchData = savedData;
          state.matchBuffer = savedBuffer;
          state.matchString = savedString;
        }
        return -remaining;
      }
      last = md;
      pos = n > 0 ? /** @type {number} */ (md[1]) : /** @type {number} */ (md[0]);
      remaining--;
    }
  } catch (e) {
    state.matchData = savedData;
    state.matchBuffer = savedBuffer;
    state.matchString = savedString;
    throw e;
  }
  setMatch(b, /** @type {MatchData} */ (last));
  return pos;
}

/**
 * The match of `re` that starts last, no earlier than index `lo` and no later than `hi`, and ends by `hi`.
 * @param {Region} r @param {string} re @param {number} lo @param {number} hi
 * @returns {MatchData | null}
 */
function lastMatch(r, re, lo, hi) {
  /** @type {MatchData | null} */
  let best = null;
  let at = lo;
  while (at <= hi) {
    tick();
    const found = search(re, r.text, at, true);
    if (found === null || found > hi) break;
    let md = /** @type {MatchData} */ ([...(state.matchData ?? [])]);
    if (/** @type {number} */ (md[1]) > hi) md = cutMatch(r.text, re, found, hi) ?? [];
    if (md.length) best = toPositions(r, md);
    at = r.next(found);
  }
  return best;
}

/**
 * `re-search-forward` and its relatives.
 * @param {LObj} pattern @param {LObj} bound @param {LObj} noerror @param {LObj} count @param {number} direction @param {boolean} literal
 */
function searchCommand(pattern, bound, noerror, count, direction, literal) {
  const source = text(pattern);
  const n = (given(count) ? fixnum(count) : 1) * direction;
  const b = cur();
  let lim;
  if (!given(bound)) lim = n > 0 ? b.zv : b.begv;
  else {
    lim = position(bound);
    if (n > 0 ? lim < b.pt : lim > b.pt) throw signal('error', ['Invalid search bound (wrong side of point)']);
    lim = clip(b.begv, lim, b.zv);
  }
  const found = searchBuffer(b, literal ? regexpQuote(source) : source, n, lim);
  if (found <= 0) {
    if (noerror === NIL || noerror === undefined) throw signal('search-failed', [pattern]);
    if (noerror !== T) b.pt = lim;
    return NIL;
  }
  b.pt = found;
  return found;
}

defun('re-search-forward', 1, 4, ([re, bound, noerror, count]) => searchCommand(re, bound, noerror, count, 1, false));
defun('re-search-backward', 1, 4, ([re, bound, noerror, count]) => searchCommand(re, bound, noerror, count, -1, false));
defun('search-forward', 1, 4, ([s, bound, noerror, count]) => searchCommand(s, bound, noerror, count, 1, true));
defun('search-backward', 1, 4, ([s, bound, noerror, count]) => searchCommand(s, bound, noerror, count, -1, true));

/** A match of `re` anchored at point, as buffer positions, or null. @param {Buffer} b @param {string} re */
function anchoredAtPoint(b, re) {
  const r = new Region(b);
  const here = r.toIndex(b.pt);
  const { source, groups, nums, size: top } = translate(re);
  const flags = `muyd${caseFold() ? 'i' : ''}`;
  if (guardFor(source, flags, r.text.length)) {
    // a pattern that can run away is matched by the step-limited search of `string-match`
    const saved = [state.matchData, state.matchBuffer, state.matchString];
    try {
      const found = search(re, r.text, here, true);
      if (found !== here) return null;
      return toPositions(r, /** @type {MatchData} */ (state.matchData));
    } finally {
      [state.matchData, state.matchBuffer, state.matchString] = /** @type {[MatchData | null, Buffer | null, string]} */ (saved);
    }
  }
  let rx;
  try {
    rx = new RegExp(source, flags);
  } catch {
    throw signal('invalid-regexp', ['Invalid regexp']);
  }
  rx.lastIndex = here;
  const m = /** @type {RegExpExecArray & { indices?: ([number, number] | undefined)[] } | null} */ (rx.exec(r.text));
  if (!m) return null;
  /** @type {MatchData} */
  const md = [m.index, m.index + m[0].length];
  while (md.length < (top + 1) * 2) md.push(null);
  for (let g = 1; g <= groups; g++) {
    const ind = m.indices?.[g];
    md[nums[g - 1] * 2] = ind ? ind[0] : null;
    md[nums[g - 1] * 2 + 1] = ind ? ind[1] : null;
  }
  return toPositions(r, md);
}

defun('looking-at', 1, 2, ([re, inhibit]) => {
  const b = cur();
  const md = anchoredAtPoint(b, text(re));
  if (md && !given(inhibit)) setMatch(b, md);
  return bool(md !== null);
});
defun('looking-at-p', 1, 1, ([re]) => bool(anchoredAtPoint(cur(), text(re)) !== null));

defun('looking-back', 1, 3, ([re, limit, greedy]) => {
  const b = cur();
  const source = text(re);
  const wrapped = `\\(?:${source}\\)\\'`;
  if (given(limit) && position(limit) > b.pt) throw signal('error', ['Invalid search bound (wrong side of point)']);
  const lo = given(limit) ? clip(b.begv, position(limit), b.zv) : b.begv;
  // the text up to point, so that a match has to end there
  const head = new Region(b, slice(b, b.begv, b.pt));
  const saved = [state.matchData, state.matchBuffer, state.matchString];
  let best = lastMatch(head, wrapped, head.toIndex(lo), head.text.length);
  if (best && given(greedy)) {
    for (;;) {
      const start = /** @type {number} */ (best?.[0]);
      if (start <= b.begv) break;
      const at = head.toIndex(start - 1);
      if (search(wrapped, head.text, at, true) !== at) break;
      best = toPositions(head, /** @type {MatchData} */ ([...(state.matchData ?? [])]));
    }
  }
  if (best) setMatch(b, best);
  else [state.matchData, state.matchBuffer, state.matchString] = /** @type {[MatchData | null, Buffer | null, string]} */ (saved);
  return bool(best !== null);
});

// ---- the match data -----------------------------------------------------------------------------------------------------

// After a search in a buffer Emacs gives the match data as markers, or, with INTEGERS, as numbers with the buffer at the end. There
// are no markers here, so both give the second form.
const matchData = /** @type {import('./elisp-data.js').Subr} */ (intern('match-data').fn);
defun('match-data', 0, 3, (args) => {
  const plain = matchData.fn(args);
  return state.matchBuffer ? list([...toArray(plain), state.matchBuffer]) : plain;
});
const setMatchData = /** @type {import('./elisp-data.js').Subr} */ (intern('set-match-data').fn);
defun('set-match-data', 1, 2, ([data, reseat]) => {
  const items = toArray(data);
  const last = items[items.length - 1];
  if (last instanceof Buffer) {
    setMatchData.fn([list(items.slice(0, -1)), reseat ?? NIL]);
    state.matchBuffer = last;
    return NIL;
  }
  state.matchBuffer = null;
  return setMatchData.fn([data, reseat ?? NIL]);
});

const matchString = /** @type {import('./elisp-data.js').Subr} */ (intern('match-string').fn);
defun('match-string', 1, 2, (args) => {
  const [n, s] = args;
  if (given(s) || !state.matchBuffer) return matchString.fn(args);
  const md = state.matchData;
  const a = md?.[fixnum(n) * 2];
  const c = md?.[fixnum(n) * 2 + 1];
  if (a === undefined || a === null || c === undefined || c === null) return NIL;
  const b = cur();
  if (a < b.begv || c > b.zv || a > c) throw signal('args-out-of-range', [b, a, c]);
  return slice(b, a, c);
});

const replaceInString = /** @type {import('./elisp-data.js').Subr} */ (intern('replace-match').fn);
/** The most groups a search has had in this session, which Emacs keeps the register table sized for (6 after it has loaded cl-lib, subr-x and seq, as the oracle's session has). */
const regs = { high: 6 };

/** @param {LObj[]} args */
function replaceMatch(args) {
  const [rep, fixedcase, literal, string, subexp] = args;
  if (given(string)) return replaceInString.fn([unbox(rep), fixedcase ?? NIL, literal ?? NIL, unbox(string), subexp ?? NIL]);
  const newtext = text(rep);
  const b = cur();
  const sub = given(subexp) ? fixnum(subexp) : 0;
  const md = state.matchData;
  if (!md || md.length === 0) throw signal('error', ['replace-match called before any match found']);
  regs.high = Math.max(regs.high, md.length / 2 - 1);
  if (sub < 0 || sub > regs.high) throw signal('args-out-of-range', [sub, 0, regs.high]);
  const from = md[sub * 2];
  const to = md[sub * 2 + 1];
  if (from === undefined || from === null || to === undefined || to === null) throw sub === 0 ? signal('error', ['replace-match called before any match found']) : signal('error', ['replace-match subexpression does not exist', sub]);
  if (from < b.begv || from > to || to > b.zv) throw signal('args-out-of-range', [from, to]);
  let out = newtext;
  if (!given(literal)) {
    if (/(^|[^\\])(\\\\)*\\\?/.test(newtext)) throw signal('error', ['Invalid use of ‘\\’ in replacement text']);
    const whole = b.text;
    const at = (/** @type {number | null} */ p) => (p === null ? null : index(b, p));
    out = expandReplacement(newtext, whole, md.map(at), whole);
  }
  if (!given(fixedcase)) out = adaptCase(slice(b, from, to), out);
  edit(b, from, to, out);
  const end = from + countChars(out);
  b.pt = end;
  // the match data follows the change, as Emacs's `update_search_regs`
  const delta = end - to;
  state.matchData = md.map((x) => {
    if (x === null) return null;
    if (x >= to) return x + delta;
    if (x > from) return from;
    return x;
  });
  return NIL;
}
defun('replace-match', 1, 5, replaceMatch);

// ---- operations on lines and regions --------------------------------------------------------------------------------------

/** Emacs's `isearch-no-upper-case-p` for a regexp: no capital outside a backslash escape and no [:upper:] or [:lower:]. @param {string} re */
function noUpperCase(re) {
  let quote = false;
  for (const c of re) {
    if (c === '\\') quote = !quote;
    else {
      if (!quote && c !== c.toLowerCase()) return false;
      quote = false;
    }
  }
  const m = /\[:(upp|low)er:]/.exec(re);
  if (m) {
    try {
      translate(re.slice(0, m.index));
    } catch (e) {
      const data = /** @type {{ data?: LObj }} */ (e).data;
      if (data instanceof Cons && data.car === 'Unmatched [ or [^') return false;
    }
  }
  return true;
}

/** Runs `body` with `case-fold-search` as `flush-lines` and its relatives set it for `re`. @template T @param {string} re @param {() => T} body */
function withSearchCase(re, body) {
  const fold = caseFold() && (intern('search-upper-case').value ?? NIL) !== NIL ? noUpperCase(re) : caseFold();
  return withDynamic([[intern('case-fold-search'), bool(fold)]], body);
}
intern('search-upper-case').value = intern('not-yanks');
intern('search-upper-case').special = true;

/** A place that follows deletions, for the end of the region a command works on. @param {Buffer} b @param {number} pos */
function trackEnd(b, pos) {
  const mark = { pos, advance: false };
  b.marks.push(mark);
  return { mark, done: () => b.marks.splice(b.marks.indexOf(mark), 1) };
}

/** `forward-line` for the commands below. @param {Buffer} b @param {number} n */
function moveLines(b, n) {
  b.pt = lineScan(b, n).pos;
}

/** Runs `body` with point restored afterwards, as `save-excursion` does. @template T @param {Buffer} b @param {() => T} body */
function excursion(b, body) {
  const mark = { pos: b.pt, advance: false };
  b.marks.push(mark);
  try {
    return body();
  } finally {
    b.marks.splice(b.marks.indexOf(mark), 1);
    b.pt = clip(b.begv, mark.pos, b.zv);
  }
}

/** The search the commands below make: forward to `bound`, nil on failure. @param {string} re @param {number} bound */
const searchTo = (re, bound) => searchCommand(re, bound, T, NIL, 1, false) !== NIL;

/** The place the commands below work from and to: from RSTART to REND when given, else point to the end. @param {Buffer} b @param {LObj} rstart @param {LObj} rend @param {boolean} rendRequired */
function regionOf(b, rstart, rend, rendRequired) {
  if (given(rstart)) {
    const lo = numberOrMarker(rstart);
    const hi = given(rend) || rendRequired ? numberOrMarker(rend ?? NIL) : b.zv;
    b.pt = clip(b.begv, Math.min(lo, hi), b.zv);
    return Math.max(lo, hi);
  }
  return b.zv;
}

defun('flush-lines', 1, 4, ([re, rstart, rend]) => {
  const b = cur();
  const source = pattern(re);
  const end = trackEnd(b, regionOf(b, rstart, rend, true));
  try {
    return withSearchCase(source, () => excursion(b, () => {
      let count = 0;
      while (b.pt < end.mark.pos && searchTo(source, end.mark.pos)) {
        const from = excursion(b, () => {
          b.pt = /** @type {number} */ (/** @type {MatchData} */ (state.matchData)[0]);
          moveLines(b, 0);
          return b.pt;
        });
        moveLines(b, 1);
        edit(b, from, b.pt, '');
        count++;
      }
      return count;
    }));
  } finally {
    end.done();
  }
});

defun('keep-lines', 1, 4, ([re, rstart, rend]) => {
  const b = cur();
  const source = pattern(re);
  /** @type {{ mark: { pos: number }, done: () => void }} */
  let end;
  if (given(rstart)) {
    const lo = numberOrMarker(rstart);
    const hi = numberOrMarker(rend ?? NIL);
    b.pt = clip(b.begv, Math.min(lo, hi), b.zv);
    const at = excursion(b, () => {
      b.pt = clip(b.begv, Math.max(lo, hi), b.zv);
      if (!(b.pt === b.begv || charBefore(b, b.pt) === 10) && b.pt !== b.zv) moveLines(b, 0);
      return b.pt;
    });
    end = trackEnd(b, at);
  } else end = trackEnd(b, b.zv);
  try {
    withSearchCase(source, () => excursion(b, () => {
      if (!(b.pt === b.begv || charBefore(b, b.pt) === 10)) moveLines(b, 1);
      let start = b.pt;
      while (b.pt < end.mark.pos) {
        if (!searchTo(source, end.mark.pos)) {
          b.pt = end.mark.pos; // `re-search-forward` with MOVE goes to the bound
          edit(b, start, end.mark.pos, '');
        } else {
          const matchStart = /** @type {number} */ (/** @type {MatchData} */ (state.matchData)[0]);
          const lineStartPos = excursion(b, () => {
            b.pt = matchStart;
            moveLines(b, 0);
            return b.pt;
          });
          if (start < lineStartPos) edit(b, start, lineStartPos, '');
        }
        start = excursion(b, () => {
          moveLines(b, 1);
          return b.pt;
        });
        const md = /** @type {MatchData} */ (state.matchData);
        if (b.pt < end.mark.pos && md[0] === md[1]) b.pt++;
      }
    }));
  } finally {
    end.done();
  }
  return NIL;
});

defun('how-many', 1, 4, ([re, rstart, rend]) => {
  const b = cur();
  const source = pattern(re);
  return withSearchCase(source, () => excursion(b, () => {
    let stop = b.zv;
    if (given(rstart)) {
      if (given(rend)) {
        const lo = position(rstart);
        const hi = position(rend);
        b.pt = clip(b.begv, Math.min(lo, hi), b.zv);
        stop = Math.max(lo, hi);
      } else b.pt = clip(b.begv, position(rstart), b.zv);
    }
    let count = 0;
    while (b.pt < stop && searchTo(source, stop)) {
      const md = /** @type {MatchData} */ (state.matchData);
      if (md[0] === md[1] && b.pt !== b.zv) b.pt++;
      count++;
    }
    return count;
  }));
});

/** The regexp argument of the commands that look at its case first, `(length REGEXP)` in Emacs. @param {LObj} x */
function pattern(x) {
  if (isStr(x)) return x.valueOf();
  throw wrongType(x instanceof Cons || Array.isArray(x) ? 'arrayp' : 'sequencep', x);
}

/** The common part of `replace-string-in-region` and `replace-regexp-in-region`. @param {LObj} what @param {LObj} replacement @param {LObj} start @param {LObj} end @param {boolean} literal */
function replaceInRegion(what, replacement, start, end, literal) {
  const b = cur();
  const found = text(what);
  let from;
  if (given(start)) {
    from = position(start);
    if (from < b.begv) throw signal('error', ['Start before start of buffer']);
  } else from = b.pt;
  let to;
  if (given(end)) {
    to = position(end);
    if (to > b.zv) throw signal('error', ['End after end of buffer']);
  } else to = b.zv;
  const rep = text(replacement);
  return excursion(b, () => {
    b.pt = clip(b.begv, from, b.zv);
    const savedBegv = b.begv;
    const savedZv = b.zv;
    // the narrowing to START..END, undone as `save-restriction` does: the end follows the edits
    const hi = { pos: to, advance: true };
    b.marks.push(hi);
    b.begv = from;
    b.zv = to;
    try {
      return withDynamic([[intern('case-fold-search'), NIL]], () => {
        let matches = 0;
        for (;;) {
          b.zv = hi.pos;
          if (!(searchCommand(found, NIL, T, NIL, 1, literal) !== NIL)) break;
          if (literal) {
            const md = /** @type {MatchData} */ (state.matchData);
            edit(b, /** @type {number} */ (md[0]), /** @type {number} */ (md[1]), '');
            insertText(b, rep);
          } else {
            replaceMatch([rep, T]);
          }
          b.zv = hi.pos;
          matches++;
        }
        return matches === 0 ? NIL : matches;
      });
    } finally {
      b.marks.splice(b.marks.indexOf(hi), 1);
      b.begv = savedBegv;
      b.zv = savedZv + (hi.pos - to);
      b.pt = clip(b.begv, b.pt, b.zv);
    }
  });
}
defun('replace-string-in-region', 2, 4, ([s, rep, start, end]) => replaceInRegion(s, rep, start, end, true));
defun('replace-regexp-in-region', 2, 4, ([re, rep, start, end]) => replaceInRegion(re, rep, start, end, false));

// ---- for the app: a buffer holding some text --------------------------------------------------------------------------------

/** A buffer holding `text`, point at its start, for Lisp that edits text (capture functions). @param {string} text */
export function openBuffer(text) {
  const b = new Buffer(' *capture*');
  b.text = text;
  b.zv = size(b) + 1;
  return b;
}

/** Makes `b` the current buffer; call it inside a running evaluation, which starts with none. @param {Buffer} b */
export function enterBuffer(b) {
  state.buffer = b;
}

/** The text before position `pos` of `b`, which is how a line number is counted. @param {Buffer} b @param {number} pos */
export function textBefore(b, pos) {
  return slice(b, 1, clip(1, pos, size(b) + 1));
}
