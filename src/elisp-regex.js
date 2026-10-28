// @ts-check
/**
 * Emacs regexps translated to JavaScript ones: groups, alternation, repetition (also stacked, as in `a**`), classes, anchors,
 * word boundaries and the syntax classes `\s-` `\sw`. Matching follows JavaScript's backtracking, which agrees with Emacs's
 * except for odd cases such as a group repeated over an empty match (`\(a*\)*`).
 */
import { signal } from './elisp-data.js';

const W = 'a-zA-Z0-9\\u00c0-\\u024f';
const CLASSES = new Map([
  ['alpha', 'a-zA-Z\\u00c0-\\u024f'], ['alnum', W], ['digit', '0-9'], ['xdigit', '0-9a-fA-F'],
  ['upper', 'A-Z'], ['lower', 'a-z'], ['space', ' \\t\\n\\r\\f\\v'], ['blank', ' \\t'], ['punct', '!-\\/:-@\\[-`{-~'],
  ['word', W], ['cntrl', '\\x00-\\x1f\\x7f'], ['print', ' -~\\u00a0-\\u{10ffff}'], ['graph', '!-~\\u00a1-\\u{10ffff}'],
  ['ascii', '\\x00-\\x7f'], ['nonascii', '\\x80-\\u{10ffff}'], ['multibyte', '\\x80-\\u{10ffff}'], ['unibyte', '\\x00-\\x7f'],
]);
const WORD_BOUNDARY = `(?:(?<=[${W}])(?![${W}])|(?<![${W}])(?=[${W}])|(?<![\\s\\S])|(?![\\s\\S]))`;

/** @type {Map<string, { source: string, groups: number, unicode: boolean }>} */
const cache = new Map();

/** The characters of a syntax class `\sC`. @param {string} k */
function syntaxSet(k) {
  switch (k) {
    case '-': case ' ': return ' \\t\\n\\r\\f';
    case 'w': return W;
    case '_': return '_\\-+*/<>=&$%!?~^';
    case '.': return '.,;:!?';
    case '(': return '(\\[{';
    case ')': return ')\\]}';
    case '"': return '"';
    case '\'': return '\'';
    default: return ' ';
  }
}

/** Translates an Emacs regexp; `groups` counts its capture groups. @param {string} re */
export function translate(re) {
  const hit = cache.get(re);
  if (hit) return hit;
  let out = '';
  let groups = 0;
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
            out += '(';
            groups++;
            i = j + 1;
          } else {
            out += '(';
            groups++;
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
        case 'w': atomOut(`[${W}]`); continue;
        case 'W': atomOut(`[^${W}]`); continue;
        case 's': case 'S': {
          const k = re[i++];
          atomOut(d === 's' ? `[${syntaxSet(k)}]` : `[^${syntaxSet(k)}]`);
          continue;
        }
        case 'b': assertion(WORD_BOUNDARY); continue;
        case 'B': assertion(`(?!${WORD_BOUNDARY})`); continue;
        case '<': assertion(`(?<![${W}])(?=[${W}])`); continue;
        case '>': assertion(`(?<=[${W}])(?![${W}])`); continue;
        case '_': {
          const k = re[i++];
          assertion(k === '<' ? `(?<![${W}_\\-])(?=[${W}_\\-])` : `(?<=[${W}_\\-])(?![${W}_\\-])`);
          continue;
        }
        case '`': assertion('(?<![\\s\\S])'); continue;
        case "'": assertion('(?![\\s\\S])'); continue;
        case '=': assertion(''); continue;
        default:
          if (/[1-9]/.test(d)) atomOut(`\\${d}`);
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
      for (;;) {
        if (j >= n) throw signal('invalid-regexp', ['Unmatched [ or [^']);
        const k = re[j];
        if (k === ']' && !first) break;
        first = false;
        if (k === '[' && re[j + 1] === ':') {
          const end = re.indexOf(':]', j + 2);
          const name = end > 0 ? re.slice(j + 2, end) : '';
          const cls = CLASSES.get(name);
          if (!cls) throw signal('invalid-regexp', ['Invalid character class name']);
          body += cls;
          j = end + 2;
          continue;
        }
        if (k === '\\' || k === '[' || k === ']' || k === '^') body += `\\${k}`;
        else body += k;
        j++;
      }
      atomOut(`[${neg ? '^' : ''}${body}]`);
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
      case '(': case ')': case '{': case '}': case '|': case '/':
        atomOut(`\\${c}`);
        break;
      default: atomOut(c);
    }
  }
  if (stack.length) throw signal('invalid-regexp', ['Unmatched ( or \\(']);
  const result = { source: out, groups, unicode: /\\u\{/.test(out) };
  cache.set(re, result);
  return result;
}

/** A JS RegExp for an Emacs regexp. @param {string} re @param {boolean} fold @param {boolean} [global] */
export function toRegExp(re, fold, global = false) {
  const { source, unicode } = translate(re);
  try {
    return new RegExp(source, `m${fold ? 'i' : ''}${global ? 'g' : ''}${unicode ? 'u' : ''}`);
  } catch {
    throw signal('invalid-regexp', ['Invalid regexp']);
  }
}

/** Escapes `s` for use in a regexp (`regexp-quote`). @param {string} s */
export const regexpQuote = (s) => s.replace(/[[*.\\?+^$]/g, '\\$&');
