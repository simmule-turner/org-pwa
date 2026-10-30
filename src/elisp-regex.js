// @ts-check
/**
 * Emacs regexps translated to JavaScript ones: groups, alternation, repetition (also stacked, as in `a**`), classes, anchors,
 * word boundaries and the syntax classes `\s-` `\sw`. Matching follows JavaScript's backtracking, which agrees with Emacs's
 * except for odd cases such as a group repeated over an empty match (`\(a*\)*`).
 */
import { signal } from './elisp-data.js';
import { classBody } from './emacs-classes.js';

/** The decoded class `name`; the tables are generated, so a missing one is a build error. @param {string} name */
const table = (name) => /** @type {string} */ (classBody(name));
const W = table('syntax:w');
const SYMBOL = W + table('syntax:_');
/** The inside of a character class for `[[:NAME:]]`, or undefined. @param {string} name */
function posixClass(name) {
  switch (name) {
    case 'alpha': case 'alnum': case 'upper': case 'lower': case 'punct': case 'space': case 'blank': case 'print': case 'graph': return table(name);
    case 'word': return W;
    case 'digit': return '0-9';
    case 'xdigit': return '0-9a-fA-F';
    case 'cntrl': return '\\x00-\\x1f';
    case 'ascii': case 'unibyte': return '\\x00-\\x7f';
    case 'nonascii': case 'multibyte': return '\\u{80}-\\u{10ffff}';
    default: return undefined;
  }
}
const WORD_BOUNDARY = `(?:(?<=[${W}])(?![${W}])|(?<![${W}])(?=[${W}])|(?<![\\s\\S])|(?![\\s\\S]))`;

/** @type {Map<string, { source: string, groups: number, nums: number[], size: number }>} */
const cache = new Map();

/** The characters of a syntax class `\sC`, as the inside of a character class (an empty one matches nothing). @param {string} k */
function syntaxSet(k) {
  switch (k) {
    case '-': case ' ': return table('space');
    case 'w': return W;
    case '_': return table('syntax:_');
    case '.': return table('syntax:.');
    case '(': return table('syntax:(');
    case ')': return table('syntax:)');
    case '"': return table('syntax:"');
    case '\'': return table("syntax:'");
    case '<': return '\\u{3b}';
    case '>': return '\\u{a}';
    case '\\': return '\\u{5c}';
    case '$': case '/': case '|': case '!': case '@': return '';
    default: throw signal('invalid-regexp', ['Invalid syntax designator']);
  }
}

/** The characters of a category `\cC`. @param {string} k */
function categorySet(k) {
  const set = classBody(`cat:${k}`);
  if (set === undefined) throw signal('invalid-regexp', ['Invalid category designator']);
  return set;
}

/** A character class from a body; an empty body matches nothing, an empty negated one everything. @param {string} body @param {boolean} neg */
const charClass = (body, neg) => (neg ? `[^${body}]` : `[${body}]`);

/** Translates an Emacs regexp; `groups` counts its capture groups. @param {string} re */
export function translate(re) {
  const hit = cache.get(re);
  if (hit) return hit;
  let out = '';
  let groups = 0;
  /** The Emacs number of each JS capture group, and the highest number given so far. @type {number[]} */
  const nums = [];
  let counter = 0;
  let i = 0;
  const n = re.length;
  /** Where the last atom starts in `out` (-1: none, so a quantifier is literal). */
  let atom = -1;
  /** The last thing emitted was a quantifier (and whether it was already made lazy). */
  let quant = false;
  let lazy = false;
  /** True when `^` here is an anchor: at the start, or after `\(`, `\(?:` or `\|`. */
  let anchorOk = true;
  /** @type {number[]} */
  const stack = [];
  /** @param {string} text */
  const atomOut = (text) => {
    atom = out.length;
    out += text;
    quant = false;
    lazy = false;
    anchorOk = false;
  };
  /** Something that cannot take a quantifier. @param {string} text */
  const assertion = (text) => {
    out += text;
    atom = -1;
    quant = false;
    lazy = false;
    anchorOk = false;
  };
  /** @param {string} q */
  const quantifier = (q) => {
    if (atom < 0) {
      atomOut(q.length === 1 ? `\\${q}` : q);
      return;
    }
    if (quant && !lazy && q === '?') {
      out += '?';
      lazy = true;
      return;
    }
    if (quant) out = `${out.slice(0, atom)}(?:${out.slice(atom)})`;
    out += q;
    quant = true;
    lazy = false;
    anchorOk = false;
  };
  while (i < n) {
    const c = re[i];
    if (c === '\\') {
      const d = re[i + 1];
      if (d === undefined) throw signal('invalid-regexp', ['Trailing backslash']);
      i += 2;
      switch (d) {
        case '(': {
          stack.push(out.length);
          if (re[i] === '?' && re[i + 1] === ':') {
            out += '(?:';
            i += 2;
          } else if (re[i] === '?' && /\d/.test(re[i + 1] || '')) {
            let j = i + 1;
            while (/\d/.test(re[j])) j++;
            if (re[j] !== ':') throw signal('invalid-regexp', ['Invalid regular expression']);
            const num = Number(re.slice(i + 1, j));
            if (num === 0) throw signal('invalid-regexp', ['Invalid regular expression']);
            out += '(';
            groups++;
            nums.push(num);
            counter = Math.max(counter, num);
            i = j + 1;
          } else {
            out += '(';
            groups++;
            nums.push(++counter);
          }
          atom = -1;
          quant = false;
          anchorOk = true;
          continue;
        }
        case ')': {
          const start = stack.pop();
          if (start === undefined) throw signal('invalid-regexp', ['Unmatched ) or \\)']);
          out += ')';
          atom = start;
          quant = false;
          lazy = false;
          anchorOk = false;
          continue;
        }
        case '|':
          out += '|';
          atom = -1;
          quant = false;
          anchorOk = true;
          continue;
        case '{': {
          const close = re.indexOf('\\}', i);
          if (close < 0) throw signal('invalid-regexp', ['Unmatched \\{']);
          const body = re.slice(i, close) || '0';
          if (!/^\d*(,\d*)?$/.test(body)) throw signal('invalid-regexp', ['Invalid content of \\{\\}']);
          i = close + 2;
          quantifier(`{${body.startsWith(',') ? `0${body}` : body}}`);
          continue;
        }
        case 'w': atomOut(charClass(W, false)); continue;
        case 'W': atomOut(charClass(W, true)); continue;
        case 'c': case 'C': atomOut(charClass(categorySet(re[i++]), d === 'C')); continue;
        case 's': case 'S': {
          const k = re[i++];
          atomOut(charClass(syntaxSet(k), d === 'S'));
          continue;
        }
        case 'b': assertion(WORD_BOUNDARY); continue;
        case 'B': assertion(`(?!${WORD_BOUNDARY})`); continue;
        case '<': assertion(`(?<![${W}])(?=[${W}])`); continue;
        case '>': assertion(`(?<=[${W}])(?![${W}])`); continue;
        case '_': {
          const k = re[i++];
          assertion(k === '<' ? `(?<![${SYMBOL}])(?=[${SYMBOL}])` : `(?<=[${SYMBOL}])(?![${SYMBOL}])`);
          continue;
        }
        case '`': assertion('(?<![\\s\\S])'); continue;
        case "'": assertion('(?![\\s\\S])'); continue;
        case '=': assertion('(?!)'); continue;
        default:
          if (/[1-9]/.test(d)) {
            const at = nums.indexOf(Number(d));
            if (Number(d) > counter || at < 0) throw signal('invalid-regexp', ['Invalid back reference']);
            atomOut(`(?:\\${at + 1})`);
          }
          else atomOut(d.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
          continue;
      }
    }
    if (c === '[') {
      let j = i + 1;
      let neg = false;
      if (re[j] === '^') {
        neg = true;
        j++;
      }
      let body = '';
      let first = true;
      /** @param {number} cp */
      const hex = (cp) => `\\u{${cp.toString(16)}}`;
      for (;;) {
        if (j >= n) throw signal('invalid-regexp', ['Unmatched [ or [^']);
        const k = re[j];
        if (k === ']' && !first) break;
        first = false;
        if (k === '[' && re[j + 1] === ':') {
          const end = re.indexOf(':]', j + 2);
          if (end > 0) {
            const cls = posixClass(re.slice(j + 2, end));
            if (cls === undefined) throw signal('invalid-regexp', ['Invalid character class name']);
            body += cls;
            j = end + 2;
            continue;
          }
        }
        const lo = /** @type {number} */ (re.codePointAt(j));
        j += lo > 0xffff ? 2 : 1;
        if (re[j] === '-' && j + 1 < n && re[j + 1] !== ']') {
          const hi = /** @type {number} */ (re.codePointAt(j + 1));
          j += 1 + (hi > 0xffff ? 2 : 1);
          if (hi >= lo) body += `${hex(lo)}-${hex(hi)}`;
        } else body += hex(lo);
      }
      atomOut(charClass(body, neg));
      i = j + 1;
      continue;
    }
    i++;
    switch (c) {
      case '^':
        if (anchorOk) assertion('^');
        else atomOut('\\^');
        anchorOk = anchorOk && false;
        break;
      case '$': {
        const rest = re.slice(i);
        if (rest === '' || rest.startsWith('\\)') || rest.startsWith('\\|')) assertion('$');
        else atomOut('\\$');
        break;
      }
      case '.': atomOut('[^\\n]'); break;
      case '*': case '+': case '?':
        quantifier(c);
        break;
      case '(': case ')': case '{': case '}': case '|': case '/': case ']':
        atomOut(`\\${c}`);
        break;
      default: atomOut(c);
    }
  }
  if (stack.length) throw signal('invalid-regexp', ['Unmatched ( or \\(']);
  const result = { source: out, groups, nums, size: counter };
  cache.set(re, result);
  return result;
}

/** A JS RegExp for an Emacs regexp. @param {string} re @param {boolean} fold @param {boolean} [global] */
export function toRegExp(re, fold, global = false) {
  const { source } = translate(re);
  try {
    return new RegExp(source, `mu${fold ? 'i' : ''}${global ? 'g' : ''}`);
  } catch {
    throw signal('invalid-regexp', ['Invalid regexp']);
  }
}

/** Escapes `s` for use in a regexp (`regexp-quote`). @param {string} s */
export const regexpQuote = (s) => s.replace(/[[*.\\?+^$]/g, '\\$&');
