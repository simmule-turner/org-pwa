// @ts-check
// Syntax coloring for the Text view: which language a file is, and the colored pieces of each of its lines.
//
// Five languages: the Emacs diary, Org, Lisp (the sexp of a `%%(…)` diary line and of Org source blocks), Markdown and JavaScript
// (also for JSON). The scanners are small and line-by-line, with a little state carried from line to line (a source block, a
// block comment); they color, they do not parse, so a half-typed line always gets some coloring and never an error.

/** @typedef {'diary' | 'org' | 'markdown' | 'javascript' | 'lisp' | 'plain'} SyntaxKind */
/** @typedef {{ block: string | null, inner?: { block: string | null }, src?: SyntaxKind }} LineState  what is carried from one line to the next: the block being in (a source block, a comment, a fence) */
/** @typedef {{ text: string, cls: string }} Seg  one piece of a line; cls is '' for plain text, else a `tk-…` class */

/** The language of a file by its name; the diary file is told apart by the caller.
 * @param {string} name
 * @param {boolean} [isDiary]
 * @returns {SyntaxKind} */
export function syntaxKindFor(name, isDiary = false) {
  if (isDiary) return 'diary';
  const base = String(name || '').split('/').pop() || '';
  if (/^diary$/i.test(base)) return 'diary';
  if (/\.(org|org_archive)$|_archive$/i.test(base)) return 'org';
  if (/\.(md|markdown)$/i.test(base)) return 'markdown';
  if (/\.(m?js|cjs|jsx|ts|json)$/i.test(base)) return 'javascript';
  if (/\.(el|lisp|scm)$/i.test(base)) return 'lisp';
  return 'plain';
}

/** @param {Seg[]} out @param {string} text @param {string} [cls] */
function push(out, text, cls = '') {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.cls === cls) last.text += text;
  else out.push({ text, cls });
}

/** Splits `text` by the first matching rule at each position: rules are [regexp (sticky), class | function].
 * @param {string} text
 * @param {[RegExp, string | ((m: RegExpExecArray) => Seg[])][]} rules
 * @param {Seg[]} [out] */
function scan(text, rules, out = []) {
  let i = 0;
  let plainFrom = 0;
  while (i < text.length) {
    let hit = false;
    for (const [re, what] of rules) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m && m[0].length > 0) {
        push(out, text.slice(plainFrom, i));
        if (typeof what === 'string') push(out, m[0], what);
        else for (const seg of what(m)) push(out, seg.text, seg.cls);
        i += m[0].length;
        plainFrom = i;
        hit = true;
        break;
      }
    }
    if (!hit) i++;
  }
  push(out, text.slice(plainFrom));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- Lisp

const LISP_RULES = /** @type {[RegExp, string | ((m: RegExpExecArray) => Seg[])][]} */ ([
  [/;.*/y, 'tk-cmt'],
  [/"(?:[^"\\]|\\.)*"?/y, 'tk-str'],
  [/\(\s*([^\s()"';]+)/y, (m) => [{ text: '(', cls: 'tk-paren' }, { text: m[0].slice(1, m[0].length - m[1].length), cls: '' }, { text: m[1], cls: /^-?[0-9.]+$/.test(m[1]) ? 'tk-num' : m[1].startsWith(':') ? 'tk-kw' : 'tk-fn' }]],
  [/[()]/y, 'tk-paren'],
  [/(?<![\w-])-?[0-9]+(?:\.[0-9]+)?(?![\w-])/y, 'tk-num'],
  [/'[^\s()]+/y, 'tk-kw'],
  [/\b(?:t|nil)\b/y, 'tk-kw'],
]);

/** @param {string} text @returns {Seg[]} */
function lispLine(text) {
  return scan(text, LISP_RULES);
}

// ----------------------------------------------------------------------------------------------------------- JavaScript

const JS_KEYWORDS = new Set(
  'async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield true false null undefined'.split(' ')
);

/**
 * One line of JavaScript.
 * @param {string} line
 * @param {{ block: string | null }} st  block: 'cmt' inside a block comment, 'tpl' inside a template literal
 * @returns {Seg[]} */
function jsLine(line, st) {
  /** @type {Seg[]} */ const out = [];
  let i = 0;
  let prev = ''; // the last significant character, to tell a regexp from a division
  while (i < line.length) {
    if (st.block === 'cmt') {
      const end = line.indexOf('*/', i);
      if (end === -1) {
        push(out, line.slice(i), 'tk-cmt');
        return out;
      }
      push(out, line.slice(i, end + 2), 'tk-cmt');
      i = end + 2;
      st.block = null;
      continue;
    }
    if (st.block === 'tpl') {
      let j = i;
      while (j < line.length && line[j] !== '`') j += line[j] === '\\' ? 2 : 1;
      if (j >= line.length) {
        push(out, line.slice(i), 'tk-str');
        return out;
      }
      push(out, line.slice(i, j + 1), 'tk-str');
      i = j + 1;
      st.block = null;
      prev = '`';
      continue;
    }
    const c = line[i];
    const rest = line.slice(i);
    let m;
    if (rest.startsWith('//')) {
      push(out, rest, 'tk-cmt');
      return out;
    }
    if (rest.startsWith('/*')) {
      const end = line.indexOf('*/', i + 2);
      if (end === -1) {
        st.block = 'cmt';
        push(out, rest, 'tk-cmt');
        return out;
      }
      push(out, line.slice(i, end + 2), 'tk-cmt');
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === '\\' ? 2 : 1;
      push(out, line.slice(i, Math.min(j + 1, line.length)), 'tk-str');
      i = Math.min(j + 1, line.length);
      prev = c;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      while (j < line.length && line[j] !== '`') j += line[j] === '\\' ? 2 : 1;
      if (j >= line.length) {
        st.block = 'tpl';
        push(out, line.slice(i), 'tk-str');
        return out;
      }
      push(out, line.slice(i, j + 1), 'tk-str');
      i = j + 1;
      prev = '`';
      continue;
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      m = /^\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[a-z]*/.exec(rest);
      if (m) {
        push(out, m[0], 'tk-str');
        i += m[0].length;
        prev = '/';
        continue;
      }
    }
    if ((m = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?|\.\d+)/.exec(rest)) && !/[\w$]/.test(line[i - 1] || '')) {
      push(out, m[0], 'tk-num');
      i += m[0].length;
      prev = '0';
      continue;
    }
    if ((m = /^[A-Za-z_$][\w$]*/.exec(rest))) {
      const word = m[0];
      const after = line.slice(i + word.length);
      push(out, word, JS_KEYWORDS.has(word) ? 'tk-kw' : /^\s*\(/.test(after) ? 'tk-fn' : '');
      i += word.length;
      prev = 'a';
      continue;
    }
    push(out, c);
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------- Markdown

const MD_INLINE = /** @type {[RegExp, string][]} */ ([
  [/`[^`\n]+`/y, 'tk-code'],
  [/\*\*[^*\n]+\*\*|__[^_\n]+__/y, 'tk-bold'],
  [/(?<![\w*])\*[^*\s][^*\n]*\*(?![\w*])|(?<![\w_])_[^_\s][^_\n]*_(?![\w_])/y, 'tk-italic'],
  [/!?\[[^\]\n]*\]\([^)\n]*\)/y, 'tk-link'],
  [/<https?:[^>\n]+>/y, 'tk-link'],
]);

/** @param {string} line @param {{ block: string | null }} st @returns {Seg[]} */
function markdownLine(line, st) {
  if (/^\s*(```|~~~)/.test(line)) {
    st.block = st.block === 'fence' ? null : 'fence';
    return [{ text: line, cls: 'tk-meta' }];
  }
  if (st.block === 'fence') return [{ text: line, cls: 'tk-code' }];
  if (/^#{1,6}(\s.*)?$/.test(line)) return [{ text: line, cls: 'tk-heading' }];
  if (/^\s*([-*_]\s*){3,}$/.test(line)) return [{ text: line, cls: 'tk-meta' }];
  if (/^>/.test(line)) return scan(line, MD_INLINE).map((s) => (s.cls ? s : { text: s.text, cls: 'tk-cmt' }));
  const item = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/.exec(line);
  if (item) return [{ text: item[1], cls: 'tk-list' }, ...scan(item[2], MD_INLINE)];
  return scan(line, MD_INLINE);
}

// ------------------------------------------------------------------------------------------------------------------ Org

const ORG_DONE = new Set(['DONE', 'CANCELLED', 'CANCELED']);
const ORG_TODO = new Set(['TODO', 'NEXT', 'WAIT', 'WAITING', 'HOLD', 'SOMEDAY', 'STARTED', 'DOING', 'PROJECT']);
const ORG_INLINE = /** @type {[RegExp, string][]} */ ([
  [/[<[]\d{4}-\d\d-\d\d[^\]>\n]*[>\]](?:--[<[]\d{4}-\d\d-\d\d[^\]>\n]*[>\]])?/y, 'tk-ts'],
  [/\[\[[^\]\n]*\](?:\[[^\]\n]*\])?\]/y, 'tk-link'],
  [/(?<![\w])=[^=\s][^=\n]*=(?![\w])|(?<![\w])~[^~\s][^~\n]*~(?![\w])/y, 'tk-code'],
  [/(?<![\w])\*[^*\s](?:[^*\n]*[^*\s])?\*(?![\w])/y, 'tk-bold'],
  [/(?<![\w:/])\/[^/\s](?:[^/\n]*[^/\s])?\/(?![\w/])/y, 'tk-italic'],
  [/(?<![\w])\+[^+\s](?:[^+\n]*[^+\s])?\+(?![\w])/y, 'tk-cmt'],
  [/\b(?:SCHEDULED|DEADLINE|CLOSED):/y, 'tk-meta'],
  [/%%\([^\n]*\)/y, (/** @type {RegExpExecArray} */ m) => lispLine(m[0]).map((s) => ({ text: s.text, cls: s.cls || 'tk-sexp' }))],
]);

/** The block language for `#+begin_src LANG`. @param {string} lang @returns {SyntaxKind} */
function srcKind(lang) {
  const l = lang.toLowerCase();
  if (['js', 'javascript', 'json', 'ts', 'typescript', 'node'].includes(l)) return 'javascript';
  if (['emacs-lisp', 'elisp', 'lisp', 'scheme', 'clojure'].includes(l)) return 'lisp';
  if (['markdown', 'md'].includes(l)) return 'markdown';
  return 'plain';
}

/** @param {string} line @param {LineState} st @returns {Seg[]} */
function orgLine(line, st) {
  let m;
  if (st.block === 'src') {
    if (/^\s*#\+end_src\b/i.test(line)) {
      st.block = null;
      return [{ text: line, cls: 'tk-meta' }];
    }
    return highlightLineWith(st.src || 'plain', line, st.inner || { block: null });
  }
  if (st.block === 'block') {
    if (/^\s*#\+end_/i.test(line)) st.block = null;
    return [{ text: line, cls: /^\s*#\+end_/i.test(line) ? 'tk-meta' : 'tk-code' }];
  }
  if ((m = /^(\s*#\+begin_src)(\s+)(\S+)?(.*)$/i.exec(line))) {
    st.block = 'src';
    st.src = srcKind(m[3] || '');
    st.inner = { block: null };
    return [{ text: m[1], cls: 'tk-meta' }, { text: m[2], cls: '' }, { text: m[3] || '', cls: 'tk-kw' }, { text: m[4], cls: 'tk-meta' }];
  }
  if (/^\s*#\+begin_/i.test(line)) {
    st.block = 'block';
    return [{ text: line, cls: 'tk-meta' }];
  }
  if (/^\s*#\+/.test(line)) return [{ text: line, cls: 'tk-meta' }];
  if (/^\s*#(\s|$)/.test(line)) return [{ text: line, cls: 'tk-cmt' }];
  if ((m = /^(\*+)(\s+)(.*)$/.exec(line))) {
    /** @type {Seg[]} */ const out = [{ text: m[1], cls: 'tk-heading' }, { text: m[2], cls: '' }];
    let rest = m[3];
    const tags = /(\s+)(:[\w@#%:]+:)\s*$/.exec(rest);
    const tagSeg = tags ? [{ text: tags[1], cls: '' }, { text: tags[2], cls: 'tk-tag' }] : [];
    if (tags) rest = rest.slice(0, rest.length - tags[0].length);
    const kw = /^([A-Z][A-Z_-]+)(\s|$)/.exec(rest);
    if (kw && (ORG_TODO.has(kw[1]) || ORG_DONE.has(kw[1]))) {
      out.push({ text: kw[1], cls: ORG_DONE.has(kw[1]) ? 'tk-done' : 'tk-todo' });
      rest = rest.slice(kw[1].length);
    }
    const pr = /^(\s+)(\[#[A-Z0-9]\])/.exec(rest);
    if (pr) {
      out.push({ text: pr[1], cls: '' }, { text: pr[2], cls: 'tk-kw' });
      rest = rest.slice(pr[0].length);
    }
    out.push(...scan(rest, ORG_INLINE).map((s) => ({ text: s.text, cls: s.cls || 'tk-heading' })), ...tagSeg);
    return out;
  }
  if (/^\s*:(PROPERTIES|END|LOGBOOK|[A-Za-z_][\w-]*):\s*$/.test(line)) return [{ text: line, cls: 'tk-meta' }];
  if ((m = /^(\s*:[\w+-]+\+?:)(.*)$/.exec(line))) return [{ text: m[1], cls: 'tk-meta' }, ...scan(m[2], ORG_INLINE)];
  if ((m = /^(\s*(?:[-+]|\d+[.)])\s+(?:\[[ X-]\]\s+)?)(.*)$/.exec(line))) return [{ text: m[1], cls: 'tk-list' }, ...scan(m[2], ORG_INLINE)];
  if (/^\s*\|/.test(line)) return scan(line, [[/\|/y, 'tk-meta'], ...ORG_INLINE]);
  return scan(line, ORG_INLINE);
}

// ------------------------------------------------------------------------------------------------------------------ Diary

const MONTH_NAMES = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const DAY_NAMES = 'Sun(?:day)?|Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:rs(?:day)?)?|Fri(?:day)?|Sat(?:urday)?';
const N = '(?:\\*|\\d{1,2})';
const Y = '(?:\\*|\\d{2,4})';
// the date at the start of a diary line, in any of the three styles; `Check this line` is what says whether it is an entry
const DIARY_DATE = new RegExp(
  `^(?:${N}/${N}(?:/${Y})?(?![\\d/])|${Y}[-/]${N}[-/]${N}(?![\\d])|\\*[-/]${N}(?![\\d])|(?:${MONTH_NAMES}|\\*)\\.?\\s*${N}(?:,\\s*${Y})?(?![\\d])|${N}\\s*(?:${MONTH_NAMES}|\\*)\\.?(?:\\s*${Y})?(?![\\d:])|${Y}\\s*(?:${MONTH_NAMES})\\.?\\s*${N}(?![\\d])|(?:${DAY_NAMES})\\.?(?![\\w]))`,
  'i'
);

/** @param {string} text @returns {Seg[]} */
function diaryText(text) {
  /** @type {Seg[]} */ const out = [];
  let last = 0;
  for (const m of text.matchAll(/\b(?:(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?[ap]m)?|(?:1[0-2]|0?[1-9])\s?[ap]m)\b/gi)) {
    push(out, text.slice(last, m.index));
    push(out, m[0], 'tk-time');
    last = m.index + m[0].length;
  }
  push(out, text.slice(last));
  return out;
}

/** @param {string} line @returns {Seg[]} */
function diaryLine(line) {
  if (line === '') return [];
  if (/^[ \t]/.test(line)) return diaryText(line); // a continuation
  let m;
  if (/^#include\b/.test(line)) return [{ text: line, cls: 'tk-meta' }];
  const mark = /^&/.test(line) ? '&' : '';
  const body = line.slice(mark.length);
  /** @type {Seg[]} */ const out = mark ? [{ text: mark, cls: 'tk-mark' }] : [];
  if (/^%%\(/.test(body)) {
    // the sexp runs to its closing parenthesis; the rest is the entry's text
    let depth = 0;
    let inStr = false;
    let end = body.length;
    for (let i = 2; i < body.length; i++) {
      const ch = body[i];
      if (inStr) {
        if (ch === '\\') i++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    out.push({ text: '%%', cls: 'tk-sexp' }, ...lispLine(body.slice(2, end)), ...diaryText(body.slice(end)));
    return out;
  }
  if ((m = DIARY_DATE.exec(body))) {
    out.push({ text: m[0], cls: 'tk-date' }, ...diaryText(body.slice(m[0].length)));
    return out;
  }
  return [{ text: line, cls: 'tk-ignored' }];
}

// ------------------------------------------------------------------------------------------------------------- the entry

/** @param {SyntaxKind} kind @param {string} line @param {LineState} st @returns {Seg[]} */
function highlightLineWith(kind, line, st) {
  switch (kind) {
    case 'diary':
      return diaryLine(line);
    case 'org':
      return orgLine(line, st);
    case 'markdown':
      return markdownLine(line, st);
    case 'javascript':
      return jsLine(line, st);
    case 'lisp':
      return lispLine(line);
    default:
      return line ? [{ text: line, cls: '' }] : [];
  }
}

/** Above this many lines the text is shown without coloring: the Text view keeps up with typing in a file of any size. */
export const SYNTAX_LINE_LIMIT = 20000;

/**
 * The colored pieces of every line of `text`.
 * @param {SyntaxKind} kind
 * @param {string} text
 * @returns {Seg[][]}  one array of segments per line (an empty line has none); joined, the segments are exactly the line
 */
export function highlight(kind, text) {
  const lines = text.split('\n');
  if (kind === 'plain' || lines.length > SYNTAX_LINE_LIMIT) return lines.map((l) => (l ? [{ text: l, cls: '' }] : []));
  /** @type {LineState} */
  const st = { block: null };
  return lines.map((line) => highlightLineWith(kind, line, st));
}
