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
    return { t: 'rep', node: a, min, max, greedy, lo: before + 1, hi: groups };
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

/** @type {Map<string, { root: Node, groups: number } | null>} */
const parsed = new Map();

/**
 * The parsed pattern when it can backtrack without end, else null (use the native engine).
 * @param {string} source @param {string} flags
 */
export function guardFor(source, flags) {
  const key = `${flags}/${source}`;
  if (parsed.has(key)) return parsed.get(key) ?? null;
  /** @type {{ root: Node, groups: number } | null} */
  let result = null;
  try {
    const p = parse(source, flags);
    if (runaway(p.root)) result = p;
  } catch (e) {
    if (!(e instanceof Unsupported)) throw e;
  }
  parsed.set(key, result);
  return result;
}

/**
 * Searches `s` from `start` with JavaScript's matching rules.
 * @param {{ root: Node, groups: number }} pattern @param {string} s @param {number} start
 * @returns {{ index: number, end: number, caps: number[] } | null}
 */
export function guardedSearch(pattern, s, start) {
  let steps = 0;
  const tick = () => {
    if (++steps > STEP_LIMIT) throw new Overflow();
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
