// @ts-check
/**
 * A step-limited matcher for the translated regexps that can backtrack without end: a repeated group that holds another
 * repetition or an overlapping alternation (`\(a+\)+`, `\(a\|aa\)*`). The browser's own engine cannot be interrupted, so such a
 * pattern runs here instead, with JavaScript's matching rules and a budget; running past it signals Emacs's own
 * "Stack overflow in regexp matcher". Every other pattern keeps the native engine.
 */
import { signal } from './elisp-data.js';

/** How many matcher steps one search may take. */
const STEP_LIMIT = 2_000_000;

/**
 * @typedef {{ t: 'atom', re: RegExp, text: string, wide: boolean }
 *   | { t: 'group', index: number, node: Node }
 *   | { t: 'back', n: number }
 *   | { t: 'seq', items: Node[] }
 *   | { t: 'alt', branches: Node[] }
 *   | { t: 'rep', node: Node, min: number, max: number, greedy: boolean, lo: number, hi: number }} Node
 */

class Unsupported extends Error {}
class Overflow extends Error {}

/**
 * Parses the JavaScript source `translate` produced.
 * @param {string} src @param {string} flags
 * @returns {{ root: Node, groups: number }}
 */
function parse(src, flags) {
  let i = 0;
  let groups = 0;
  const n = src.length;
  const fl = `${flags.replace(/[gdy]/g, '')}y`;
  /** @param {string} text @param {boolean} wide */
  const atom = (text, wide) => {
    try {
      return /** @type {Node} */ ({ t: 'atom', re: new RegExp(text, fl), text, wide });
    } catch {
      throw new Unsupported();
    }
  };
  /** The index after the `)` that closes the group opened before `from`. @param {number} from */
  const closeOf = (from) => {
    let depth = 0;
    for (let j = from; j < n; j++) {
      const c = src[j];
      if (c === '\\') j++;
      else if (c === '[') {
        j++;
        if (src[j] === '^') j++;
        for (; j < n && src[j] !== ']'; j++) if (src[j] === '\\') j++;
      } else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return j + 1;
    }
    throw new Unsupported();
  };
  /** @returns {Node} */
  function alt() {
    const branches = [seq()];
    while (src[i] === '|') {
      i++;
      branches.push(seq());
    }
    return branches.length > 1 ? { t: 'alt', branches } : branches[0];
  }
  /** @returns {Node} */
  function seq() {
    /** @type {Node[]} */ const items = [];
    while (i < n && src[i] !== '|' && src[i] !== ')') items.push(term());
    return { t: 'seq', items };
  }
  /** @returns {Node} */
  function term() {
    const before = groups;
    const a = primary();
    const c = src[i];
    let min;
    let max;
    if (c === '*') [min, max] = [0, Infinity];
    else if (c === '+') [min, max] = [1, Infinity];
    else if (c === '?') [min, max] = [0, 1];
    else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
      if (!m) throw new Unsupported();
      min = Number(m[1]);
      max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
      i += m[0].length - 1;
    } else return a;
    i++;
    let greedy = true;
    if (src[i] === '?') {
      greedy = false;
      i++;
    }
    return { t: 'rep', node: a.t === 'seq' && a.items.length === 1 ? a.items[0] : a, min, max, greedy, lo: before + 1, hi: groups };
  }
  /** @returns {Node} */
  function primary() {
    const c = src[i];
    if (c === '(') {
      if (/^\(\?<?[=!]/.test(src.slice(i, i + 4))) {
        const end = closeOf(i);
        const text = src.slice(i, end);
        i = end;
        return atom(text, false);
      }
      if (src.startsWith('(?:', i)) {
        i += 3;
        const node = alt();
        if (src[i++] !== ')') throw new Unsupported();
        return node;
      }
      if (src[i + 1] === '?') throw new Unsupported();
      i++;
      const index = ++groups;
      const node = alt();
      if (src[i++] !== ')') throw new Unsupported();
      return { t: 'group', index, node };
    }
    if (c === '[') {
      let j = i + 1;
      if (src[j] === '^') j++;
      for (; j < n && src[j] !== ']'; j++) if (src[j] === '\\') j++;
      if (j >= n) throw new Unsupported();
      const text = src.slice(i, j + 1);
      i = j + 1;
      return atom(text, true);
    }
    if (c === '\\') {
      const d = src[i + 1];
      if (d >= '1' && d <= '9') {
        let j = i + 1;
        while (/\d/.test(src[j] || '')) j++;
        const num = Number(src.slice(i + 1, j));
        i = j;
        return { t: 'back', n: num };
      }
      let end = i + 2;
      if (d === 'u' && src[end] === '{') end = src.indexOf('}', end) + 1;
      else if (d === 'u') end = i + 6;
      else if (d === 'x') end = i + 4;
      else if ((d === 'p' || d === 'P') && src[end] === '{') end = src.indexOf('}', end) + 1;
      else if (d === 'k') throw new Unsupported();
      if (end <= i) throw new Unsupported();
      const text = src.slice(i, end);
      i = end;
      return atom(text, !/^\\[bB]$/.test(text));
    }
    if (c === '^' || c === '$') {
      i++;
      return atom(c, false);
    }
    if (c === '*' || c === '+' || c === '?' || c === '{' || c === ')' || c === '|' || c === undefined) throw new Unsupported();
    const ch = String.fromCodePoint(/** @type {number} */ (src.codePointAt(i)));
    i += ch.length;
    return atom(ch === '.' ? '.' : ch.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&'), true);
  }
  const root = alt();
  if (i < n) throw new Unsupported();
  return { root, groups };
}

/** The text of the first thing a node matches, or null when it varies. @param {Node} node @returns {string | null} */
function firstText(node) {
  switch (node.t) {
    case 'atom': return node.wide && !/^(\[|\.|\\[a-zA-Z])/.test(node.text) ? node.text : null;
    case 'group': return firstText(node.node);
    case 'seq': return node.items.length ? firstText(node.items[0]) : null;
    case 'rep': return node.min > 0 ? firstText(node.node) : null;
    default: return null;
  }
}

/** Whether the node holds a repetition or an alternation whose branches can start alike. @param {Node} node @returns {boolean} */
function branchy(node) {
  switch (node.t) {
    case 'rep': return node.max > 1 || branchy(node.node);
    case 'group': return branchy(node.node);
    case 'seq': return node.items.some(branchy);
    case 'alt': {
      const starts = node.branches.map(firstText);
      return starts.includes(null) || new Set(starts).size < starts.length || node.branches.some(branchy);
    }
    default: return false;
  }
}

/** Whether some repetition of more than one round repeats something that branches. @param {Node} node @returns {boolean} */
function runaway(node) {
  switch (node.t) {
    case 'rep': return (node.max > 1 && branchy(node.node)) || runaway(node.node);
    case 'group': return runaway(node.node);
    case 'seq': return node.items.some(runaway);
    case 'alt': return node.branches.some(runaway);
    default: return false;
  }
}

/** Whether a node is a repetition without an upper bound of one character (`.*`, `[a-z]*`, `\\s+`, `a*`). @param {Node} node @returns {node is Extract<Node, { t: 'rep' }>} */
function unboundedChar(node) {
  return node.t === 'rep' && node.max === Infinity && node.node.t === 'atom' && node.node.wide;
}

/** The characters of a simple atom (a literal, or a bracket expression of plain characters and ranges, written as the translator
 * writes them: `\\u{61}-\\u{7a}` or a bare character), or null when unknown. @param {string} text @returns {Set<number> | null} */
function charsOf(text) {
  const bracket = text.startsWith('[') && text.endsWith(']');
  if (bracket && text[1] === '^') return null;
  const body = bracket ? text.slice(1, -1) : text;
  /** @type {(number | '-')[]} */ const tokens = [];
  for (const m of body.matchAll(/\\u\{([0-9a-fA-F]+)\}|\\(.)|(.)/gsu)) {
    if (m[1] !== undefined) tokens.push(parseInt(m[1], 16));
    else if (m[2] !== undefined) {
      if (/[a-zA-Z0-9]/.test(m[2])) return null; // a class such as \d or \w: unknown
      tokens.push(m[2].codePointAt(0) ?? 0);
    } else tokens.push(bracket && m[3] === '-' ? '-' : (m[3] ?? '').codePointAt(0) ?? 0);
  }
  if (!bracket && tokens.length !== 1) return null;
  const set = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-') {
      set.add(45);
      continue;
    }
    if (tokens[i + 1] === '-' && typeof tokens[i + 2] === 'number') {
      const to = /** @type {number} */ (tokens[i + 2]);
      if (t > to || to - t > 0x3000) return null;
      for (let c = t; c <= to; c++) set.add(c);
      i += 2;
    } else set.add(t);
  }
  return set;
}

/** Whether two one-character repetitions can match the same character: unless both are plain sets that share nothing, they are taken to overlap. @param {Extract<Node, { t: 'rep' }>} a @param {Extract<Node, { t: 'rep' }>} b */
function overlap(a, b) {
  const x = charsOf(/** @type {Extract<Node, { t: 'atom' }>} */ (a.node).text);
  const y = charsOf(/** @type {Extract<Node, { t: 'atom' }>} */ (b.node).text);
  if (!x || !y) return true;
  for (const c of x) if (y.has(c)) return true;
  return false;
}

/** The unbounded one-character repetition an item is (or holds alone, in a group), else null. @param {Node} node @returns {Extract<Node, { t: 'rep' }> | null} */
function asUnbounded(node) {
  if (unboundedChar(node)) return node;
  if (node.t === 'group') return asUnbounded(node.node);
  if (node.t === 'seq' && node.items.length === 1) return asUnbounded(node.items[0]);
  return null;
}

/** Whether some sequence has two unbounded one-character repetitions side by side that can match the same characters (`.*.*x`):
 * polynomial work on a failing match, which a long input turns into a stall. @param {Node} node @returns {boolean} */
function polynomial(node) {
  switch (node.t) {
    case 'seq': {
      /** @type {Extract<Node, { t: 'rep' }> | null} */
      let previous = null;
      for (const item of node.items) {
        const rep = asUnbounded(item);
        if (rep) {
          if (previous && overlap(previous, rep)) return true;
          previous = rep;
        } else {
          previous = null;
          if (polynomial(item)) return true;
        }
      }
      return false;
    }
    case 'group': return polynomial(node.node);
    case 'rep': return polynomial(node.node);
    case 'alt': return node.branches.some(polynomial);
    default: return false;
  }
}

/** Input shorter than this always uses the native engine, which is fast enough for polynomial patterns. */
const POLY_MIN_INPUT = 2000;
/** The budget for a polynomial pattern: more than STEP_LIMIT, because a legitimate quadratic match on a few thousand characters is real work. */
const POLY_LIMIT = 10_000_000;

/** @typedef {{ root: Node, groups: number, limit?: number }} Guard */
/** @type {Map<string, { root: Node, groups: number, kind: 'runaway' | 'poly' | null, deep: boolean }>} */
const parsed = new Map();

/**
 * The parsed pattern when it can backtrack without end (or, for an input over POLY_MIN_INPUT characters, in polynomial time),
 * else null (use the native engine).
 * @param {string} source @param {string} flags @param {number} [inputLength]
 * @returns {Guard | null}
 */
export function guardFor(source, flags, inputLength = 0) {
  const key = `${flags}/${source}`;
  let entry = parsed.get(key);
  if (!entry) {
    entry = { root: { t: 'seq', items: [] }, groups: 0, kind: null, deep: false };
    try {
      const p = parse(source, flags);
      entry = { root: p.root, groups: p.groups, kind: runaway(p.root) ? 'runaway' : polynomial(p.root) ? 'poly' : null, deep: hasLoopOverGroup(p.root) || hasFollowedCharLoop(p.root) };
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
    }
    parsed.set(key, entry);
  }
  if (entry.kind === 'runaway') return entry;
  if (entry.kind === 'poly' && inputLength > POLY_MIN_INPUT) return { root: entry.root, groups: entry.groups, limit: POLY_LIMIT };
  return null;
}


// ---- Emacs's failure stack ---------------------------------------------------------------------------------------------
//
// Emacs keeps the places a match can still back up to on a failure stack of 40,000 entries of 20 words (800,000 words), and signals
// "Stack overflow in regexp matcher" when a loop pushes past it, however simple the loop is: `\(a\|b\)*` over 100,000 characters
// does, `[ab]*` does not. The browser's engine has no such limit and a failing `\(a\|b\)*c` on that input takes half a minute
// (every start position runs to the end), so before the native engine runs on a long input this walks the greedy path of the
// pattern and counts words the way Emacs 29.3 pushes them. Measured with string-match on a string of one repeated unit (the
// last column is the string length at which Emacs overflowed; words per round = 800,000 / length):
//
//   pattern            unit  length  words per round
//   \(a\)*             a     133333  6   loop 3 + capture 3
//   \(.\)*             a     133333  6
//   \(ab\)*            ab    133333  6   (rounds, not characters)
//   \(?:ab\|cd\)*      ab    133333  6   loop 3 + first branch left to try 3
//   \(?:a\|b\)*        a     133333  6
//   \(?:a\|b\)*        b     266665  3   the last branch leaves nothing to try
//   \(a\|b\)*          a      88888  9   loop 3 + capture 3 + first branch 3
//   \(a\|b\)*          b     133332  6
//   \(a\|b\)+          a      88889  9
//   \(?:a*b\)*         ab    266665  3
//   \(\(a\)*\)*        a     133331  6   the inner loop's rounds
//   .*c  [ab]*a  a*a   a  266665  3   a loop over one character pushes 3 words per character when what follows could
//                                     also match that character (`.*c`, `[ab]*a`, `a*\(a\|b\)`), and nothing when it cannot (`[ab]*c`)
//   no overflow up to 400,000: \(?:a\)*c  \(?:ab\)*c  [ab]*c  \(a\|b\)\{1,500000\}  (a plain character or fixed text repeated
//   needs no stack, and neither does a counted loop).
//
// A lazy loop (`*?`, `+?`) pushes nothing for itself; a round costs 3 words for a capture group around the body and 3 more when the
// branch taken has later branches to try (words per round, from the length at which Emacs overflowed, last column):
//   \(?:a\|b\)*?c    a   3  266667      \(?:a\|b\)*?c   b   0  none up to 400,000
//   \(a\|b\)*?c      a   6  133333      \(a\|b\)*?c     b   3  266667
//   \(ab\)*?c        ab   3  266667      \(?:ab\)*?c     ab   0  none      \(?:a*b\)*?c  ab  0  none      a*?c  a  0  none
//   \(?:a\|b\)+?c    a   3  266667
// A lazy loop is walked until what follows it could start; a pattern whose follower is not known is left to the native engine.
//
// Only a loop that can overflow at all (over 800,000 / 9 characters) triggers the walk, so shorter input is untouched.

/** The failure stack's size in words, and the input length below which no pattern of the shapes above can overflow it. */
const FAILURE_WORDS = 800_000;
const DEEP_MIN_INPUT = 40_000;
/** The walk gives up (the native engine runs, as before) after this many nodes. */
const WALK_BUDGET = 5_000_000;

/** Whether a node is only characters and fixed text (no loop, no choice, no group): the body of a loop Emacs compiles without a stack. @param {Node} node @returns {boolean} */
function plainText(node) {
  switch (node.t) {
    case 'atom': return true;
    case 'seq': return node.items.every(plainText);
    default: return false;
  }
}

/** The characters a node must start with, or null when that is not known (a class, a dot, a loop that can match nothing).
 * @param {Node} node @returns {Set<number> | null} */
function firstSet(node) {
  switch (node.t) {
    case 'atom': return node.text === '.' || !node.wide ? null : charsOf(node.text);
    case 'group': return firstSet(node.node);
    case 'seq': return node.items.length ? firstSet(node.items[0]) : null;
    case 'rep': return node.min > 0 ? firstSet(node.node) : null;
    case 'alt': {
      /** @type {Set<number>} */
      const all = new Set();
      for (const b of node.branches) {
        const f = firstSet(b);
        if (!f) return null;
        for (const c of f) all.add(c);
      }
      return all;
    }
    default: return null;
  }
}

/** The characters the items from `k` on can start with, looking past loops that may match nothing; null when not known.
 * @param {Node[]} items @param {number} k @returns {Set<number> | null} */
function followSet(items, k) {
  /** @type {Set<number>} */
  const all = new Set();
  for (let j = k; j < items.length; j++) {
    const it = items[j];
    const f = it.t === 'rep' && it.min === 0 ? firstSet(it.node) : firstSet(it);
    if (!f) return null;
    for (const c of f) all.add(c);
    if (!(it.t === 'rep' && it.min === 0)) return all;
  }
  return null;
}

/** Whether a node holds a greedy unbounded loop over one character with something after it in a sequence (`.*c`). @param {Node} node @returns {boolean} */
function hasFollowedCharLoop(node) {
  switch (node.t) {
    case 'seq': return node.items.some((item, k) => (k + 1 < node.items.length && unboundedChar(item) && item.greedy && item.min <= 1) || hasFollowedCharLoop(item));
    case 'group': return hasFollowedCharLoop(node.node);
    case 'rep': return hasFollowedCharLoop(node.node);
    case 'alt': return node.branches.some(hasFollowedCharLoop);
    default: return false;
  }
}

/** Whether a node holds an unbounded loop (greedy or lazy) over something that is not one character. @param {Node} node @returns {boolean} */
function hasLoopOverGroup(node) {
  switch (node.t) {
    case 'rep': return (node.max === Infinity && node.min <= 1 && !(node.node.t === 'atom' && node.node.wide)) || hasLoopOverGroup(node.node);
    case 'group': return hasLoopOverGroup(node.node);
    case 'seq': return node.items.some(hasLoopOverGroup);
    case 'alt': return node.branches.some(hasLoopOverGroup);
    default: return false;
  }
}

/**
 * Signals "Stack overflow in regexp matcher" when Emacs would, for a long input, by walking the pattern's greedy path from each
 * start position and counting failure-stack words. It never decides a match: when nothing overflows it returns and the usual
 * engine runs. Back-references and the paths taken after backing up are not followed.
 * Returns true when the greedy path matched at `start` without overflowing: the native engine takes that same path and ends at once,
 * which the step-limited matcher (recursive, so too deep for a match this long) cannot do.
 * @param {string} source @param {string} flags @param {string} s @param {number} start @returns {boolean}
 */
export function checkFailureStack(source, flags, s, start) {
  if (s.length - start < DEEP_MIN_INPUT) return false;
  guardFor(source, flags, 0); // fills the cache
  const entry = parsed.get(`${flags}/${source}`);
  if (!entry || !entry.deep) return false;
  let depth = 0;
  let altWords = 0;
  let steps = 0;
  /** What the item after the loop being walked can start with. @type {Set<number> | null} */
  let follower = null;
  /** What the item after the lazy loop being walked can start with. @type {Set<number> | null} */
  let lazyStop = null;
  /** @type {number[]} */
  let caps = [];
  /** @param {Extract<Node, { t: 'atom' }>} a @param {number} pos */
  const test = (a, pos) => {
    a.re.lastIndex = pos;
    const m = a.re.exec(s);
    return m ? m[0].length : -1;
  };
  /** The end of the first way the node matches at `pos`, or -1. @param {Node} node @param {number} pos @returns {number} */
  function walk(node, pos) {
    if (++steps > WALK_BUDGET) throw new Unsupported();
    switch (node.t) {
      case 'atom': {
        const len = test(node, pos);
        return len < 0 ? -1 : pos + len;
      }
      case 'seq': {
        let p = pos;
        for (let k = 0; k < node.items.length; k++) {
          const item = node.items[k];
          follower = k + 1 < node.items.length && unboundedChar(item) ? followSet(node.items, k + 1) : null;
          lazyStop = null;
          if (item.t === 'rep' && !item.greedy && item.max === Infinity && !(item.node.t === 'atom' && item.node.wide)) {
            lazyStop = k + 1 < node.items.length ? followSet(node.items, k + 1) : null;
            if (!lazyStop) throw new Unsupported(); // where the loop ends depends on what follows: not known
          }
          p = walk(item, p);
          if (p < 0) return -1;
        }
        return p;
      }
      case 'alt': {
        for (let k = 0; k < node.branches.length; k++) {
          const before = depth;
          const r = walk(node.branches[k], pos);
          if (r >= 0) {
            if (k < node.branches.length - 1) altWords += 3; // the later branches are still to try
            return r;
          }
          depth = before;
        }
        return -1;
      }
      case 'group': {
        const r = walk(node.node, pos);
        if (r >= 0) {
          caps[node.index * 2] = pos;
          caps[node.index * 2 + 1] = r;
        }
        return r;
      }
      case 'back': {
        const from = caps[node.n * 2];
        const to = caps[node.n * 2 + 1];
        if (from === undefined || from < 0) return pos;
        const text = s.slice(from, to);
        return s.startsWith(text, pos) ? pos + text.length : -1;
      }
      case 'rep': {
        const body = node.node;
        if (body.t === 'atom' && body.wide) {
          // one character at a time: 3 stack words a character when what follows could match that character too
          const after = node.greedy && node.max === Infinity && node.min <= 1 ? follower : null;
          follower = null;
          const costly = after !== null && [...after].some((c) => {
            body.re.lastIndex = 0;
            return body.re.test(String.fromCodePoint(c));
          });
          let p = pos;
          let n = 0;
          const most = node.greedy ? node.max : node.min;
          while (n < most) {
            steps++;
            const len = test(body, p);
            if (len <= 0) break;
            p += len;
            n++;
            if (costly) {
              depth += 3;
              if (depth > FAILURE_WORDS) throw new Overflow();
            }
          }
          return n < node.min ? -1 : p;
        }
        const lazy = !node.greedy && node.max === Infinity && node.min <= 1 ? lazyStop : null;
        lazyStop = null;
        const unbounded = node.greedy && node.max === Infinity && node.min <= 1;
        let p = pos;
        let n = 0;
        const most = node.greedy ? (node.max === Infinity ? Infinity : node.max) : lazy ? Infinity : node.min;
        while (n < most) {
          if (lazy && n >= node.min && p < s.length && lazy.has(/** @type {number} */ (s.codePointAt(p)))) break; // the rest may match here: Emacs tries it first
          const savedAlt = altWords;
          altWords = 0;
          const r = walk(body, p);
          const round = altWords;
          altWords = savedAlt;
          if (r < 0 || (r === p && n >= node.min)) break;
          if (unbounded) {
            depth += (body.t === 'group' ? 6 : plainText(body) ? 0 : 3) + round;
            if (depth > FAILURE_WORDS) throw new Overflow();
          } else if (lazy) {
            depth += (body.t === 'group' ? 3 : 0) + round;
            if (depth > FAILURE_WORDS) throw new Overflow();
          }
          p = r;
          n++;
        }
        return n < node.min ? -1 : p;
      }
    }
  }
  try {
    for (let i = start; i <= s.length; i++) {
      depth = 0;
      altWords = 0;
      caps = [];
      if (walk(entry.root, i) >= 0) return i === start; // matched on the first path tried: the usual engine finds it at once too
      const cp = s.codePointAt(i);
      if (cp !== undefined && cp > 0xffff) i++;
    }
  } catch (e) {
    if (e instanceof Overflow) throw signal('error', ['Stack overflow in regexp matcher']);
    if (!(e instanceof Unsupported)) throw e;
  }
  return false;
}

/**
 * Searches `s` from `start` with JavaScript's matching rules.
 * @param {Guard} pattern @param {string} s @param {number} start
 * @returns {{ index: number, end: number, caps: number[] } | null}
 */
export function guardedSearch(pattern, s, start) {
  let steps = 0;
  const limit = pattern.limit ?? STEP_LIMIT;
  const tick = () => {
    if (++steps > limit) throw new Overflow();
  };
  /** The length of the atom's match at `pos`, or -1. @param {Extract<Node, { t: 'atom' }>} a @param {number} pos */
  const test = (a, pos) => {
    a.re.lastIndex = pos;
    const m = a.re.exec(s);
    return m ? m[0].length : -1;
  };
  /** @typedef {(pos: number, caps: number[]) => { end: number, caps: number[] } | null} Cont */
  /** @param {Node} node @param {number} pos @param {number[]} caps @param {Cont} k @returns {{ end: number, caps: number[] } | null} */
  function m(node, pos, caps, k) {
    tick();
    switch (node.t) {
      case 'atom': {
        const len = test(node, pos);
        return len < 0 ? null : k(pos + len, caps);
      }
      case 'seq': return items(node.items, 0, pos, caps, k);
      case 'alt':
        for (const b of node.branches) {
          const r = m(b, pos, caps, k);
          if (r) return r;
        }
        return null;
      case 'group':
        return m(node.node, pos, caps, (p, c) => {
          const next = c.slice();
          next[node.index * 2] = pos;
          next[node.index * 2 + 1] = p;
          return k(p, next);
        });
      case 'back': {
        const from = caps[node.n * 2];
        const to = caps[node.n * 2 + 1];
        if (from === undefined || from < 0) return k(pos, caps);
        const text = s.slice(from, to);
        return s.startsWith(text, pos) ? k(pos + text.length, caps) : null;
      }
      case 'rep': return rep(node, node.min, node.max, pos, caps, k);
    }
  }
  /** @param {Node[]} list @param {number} at @param {number} pos @param {number[]} caps @param {Cont} k @returns {{ end: number, caps: number[] } | null} */
  function items(list, at, pos, caps, k) {
    if (at === list.length) return k(pos, caps);
    return m(list[at], pos, caps, (p, c) => items(list, at + 1, p, c, k));
  }
  /** @param {Extract<Node, { t: 'rep' }>} r @param {number} min @param {number} max @param {number} pos @param {number[]} caps @param {Cont} k @returns {{ end: number, caps: number[] } | null} */
  function rep(r, min, max, pos, caps, k) {
    if (r.node.t === 'atom' && r.node.wide) {
      // a single character at a time: walk forward without recursion
      const stops = [pos];
      let p = pos;
      while (stops.length - 1 < max) {
        tick();
        const len = test(r.node, p);
        if (len <= 0) break;
        p += len;
        stops.push(p);
      }
      if (stops.length - 1 < min) return null;
      const order = r.greedy ? [...stops.keys()].reverse() : [...stops.keys()];
      for (const j of order) {
        if (j < min) continue;
        const z = k(stops[j], caps);
        if (z) return z;
      }
      return null;
    }
    if (max === 0) return k(pos, caps);
    const again = () => {
      const cleared = caps.slice();
      for (let g = r.lo; g <= r.hi; g++) cleared[g * 2] = cleared[g * 2 + 1] = -1;
      return m(r.node, pos, cleared, (p, c) => (min === 0 && p === pos ? null : rep(r, min === 0 ? 0 : min - 1, max === Infinity ? Infinity : max - 1, p, c, k)));
    };
    if (min > 0) return again();
    if (!r.greedy) return k(pos, caps) ?? again();
    return again() ?? k(pos, caps);
  }
  try {
    for (let i = start; i <= s.length; i++) {
      const r = m(pattern.root, i, new Array((pattern.groups + 1) * 2).fill(-1), (end, caps) => ({ end, caps }));
      if (r) return { index: i, end: r.end, caps: r.caps };
      const cp = s.codePointAt(i);
      if (cp !== undefined && cp > 0xffff) i++;
    }
    return null;
  } catch (e) {
    if (e instanceof Overflow || e instanceof RangeError) throw signal('error', ['Stack overflow in regexp matcher']);
    throw e;
  }
}
