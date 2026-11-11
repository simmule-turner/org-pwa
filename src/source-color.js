// @ts-check
/**
 * Source coloring as Emacs 29.3 does it for emacs-lisp, python, js and java: the faces font-lock gives (keyword, string, comment,
 * comment-delimiter, doc, constant, builtin, type, function-name, variable-name, operator, warning, c-annotation; numbers stay plain).
 * The word lists come from Emacs's own font-lock variables (src/source-color-data.js, written by tools/gen-source-color-data.mjs) and the
 * rules follow python.el, js.el, elisp-mode and cc-fonts, in their order: a rule paints only what no earlier rule has painted, as
 * font-lock does without OVERRIDE. test/source-color.test.js holds the result to the faces Emacs gave test/fixtures/source-color/*.
 *
 * highlightRuns(code, language) -> [[text, face | null], ...], or null for a language this module does not color.
 */

import {
  EL_DEFINERS, EL_DOC_ELT, EL_KEYWORDS, JAVA_CONSTANTS, JAVA_KEYWORDS, JAVA_MODIFIERS, JAVA_TYPES, JS_CONSTANTS, JS_KEYWORDS, JS_TYPES,
  PY_BUILTINS, PY_CONSTANTS, PY_EXCEPTIONS, PY_KEYWORDS,
} from './source-color-data.js';

/** @typedef {string | null} Face */
/** @typedef {{ s: number, e: number, text: string }} Token */

/** One face per UTF-16 unit of the code; `set` overrides, `fill` paints only what is still plain (a font-lock rule without OVERRIDE). */
class Paint {
  /** @param {number} n */
  constructor(n) {
    /** @type {Face[]} */
    this.faces = new Array(n).fill(null);
  }

  /** @param {number} a @param {number} b @param {string | null} face */
  set(a, b, face) {
    for (let i = a; i < b; i++) this.faces[i] = face;
  }

  /** @param {number} a @param {number} b @param {string} face */
  fill(a, b, face) {
    for (let i = a; i < b; i++) if (this.faces[i] === null) this.faces[i] = face;
  }

  /** @param {string} code @returns {[string, Face][]} */
  runs(code) {
    /** @type {[string, Face][]} */
    const out = [];
    let start = 0;
    for (let i = 1; i <= code.length; i++) {
      if (i === code.length || this.faces[i] !== this.faces[start]) {
        out.push([code.slice(start, i), this.faces[start] ?? null]);
        start = i;
      }
    }
    return code.length ? out : [];
  }
}

const TOKEN_RE = /[\p{L}_$][\p{L}\p{N}_$]*|\d[\w.]*|\.\.\.|\S/gu;

/** The tokens of the code that no syntactic rule painted (not inside a string or comment). @param {string} code @param {Paint} paint @returns {Token[]} */
function tokens(code, paint) {
  /** @type {Token[]} */
  const out = [];
  TOKEN_RE.lastIndex = 0;
  for (let m; (m = TOKEN_RE.exec(code)); ) {
    if (paint.faces[m.index] === null) out.push({ s: m.index, e: m.index + m[0].length, text: m[0] });
  }
  return out;
}

/** The end of the line that holds `i`. @param {string} code @param {number} i */
function lineEnd(code, i) {
  const e = code.indexOf('\n', i);
  return e < 0 ? code.length : e;
}

/** The start of the line that holds `i`. @param {string} code @param {number} i */
const lineStart = (code, i) => code.lastIndexOf('\n', i - 1) + 1;

/** Comments and delimiters of a language with line and block comments: the starter and the blanks after it are comment-delimiter, a block's closer
 * with the blanks before it too, and a block that starts with two stars is a doc comment as a whole.
 * @param {string} code @param {Paint} paint @param {number} i @returns {number} the index after the comment, or -1 when none starts at i */
function cComment(code, paint, i) {
  if (code.startsWith('//', i)) {
    const stop = lineEnd(code, i);
    const delim = /^\/\/+[ \t]*/.exec(code.slice(i, stop));
    const d = delim ? delim[0].length : 0;
    paint.set(i, i + d, 'comment-delimiter');
    paint.set(i + d, stop, 'comment');
    return stop;
  }
  if (code.startsWith('/*', i)) {
    const end = code.indexOf('*/', i + 2);
    const stop = end < 0 ? code.length : end + 2;
    if (code.startsWith('/**', i) && code[i + 3] !== '/' && end >= 0) {
      paint.set(i, stop, 'doc');
      return stop;
    }
    const open = /^\/\*+[ \t]*/.exec(code.slice(i, stop));
    const o = open ? open[0].length : 2;
    paint.set(i, i + o, 'comment-delimiter');
    paint.set(i + o, stop, 'comment');
    if (end >= 0) {
      let c = end;
      while (c > i + o && /[ \t]/.test(code[c - 1])) c--;
      paint.set(c, stop, 'comment-delimiter');
    }
    return stop;
  }
  return -1;
}

/** A quoted string with backslash escapes from `i`; ends at a line end unless `multiline`. @param {string} code @param {number} i @param {boolean} multiline @returns {number} */
function quoted(code, i, multiline) {
  const q = code[i];
  let j = i + 1;
  while (j < code.length && code[j] !== q) {
    if (code[j] === '\\') j++;
    else if (code[j] === '\n' && !multiline) return j;
    j++;
  }
  return Math.min(code.length, j + 1);
}

// ---- emacs-lisp -----------------------------------------------------------------------------------------

/** @typedef {{ head: string | null, count: number, quoted: boolean }} Form */

/** @param {string} code @returns {[string, Face][]} */
function elisp(code) {
  const paint = new Paint(code.length);
  const n = code.length;
  /** @type {Form[]} */
  const stack = [];
  /** @type {{ s: number, e: number, text: string, index: number, form: Form | null, direct: boolean }[]} */
  const atoms = [];
  let pendingQuote = false; // the next element follows a ' or #'
  const element = () => {
    const top = stack[stack.length - 1];
    return top ? top.count++ : -1;
  };
  let i = 0;
  while (i < n) {
    const c = code[i];
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r' || c === '\f') {
      i++;
    } else if (c === ';') {
      const stop = lineEnd(code, i);
      const d = /^;+[ \t]*/.exec(code.slice(i, stop));
      paint.set(i, i + (d ? d[0].length : 1), 'comment-delimiter');
      paint.set(i + (d ? d[0].length : 1), stop, 'comment');
      i = stop;
    } else if (c === '"') {
      const stop = quoted(code, i, true);
      const top = stack[stack.length - 1];
      const index = element();
      const docAt = top && top.head !== null && Object.hasOwn(EL_DOC_ELT, top.head) ? EL_DOC_ELT[top.head] : -1;
      paint.set(i, stop, index === docAt ? 'doc' : 'string');
      pendingQuote = false;
      i = stop;
    } else if (c === '(' || c === '[') {
      const parent = stack[stack.length - 1];
      element();
      stack.push({ head: null, count: 0, quoted: pendingQuote || (parent ? parent.quoted : false) });
      pendingQuote = false;
      i++;
    } else if (c === ')' || c === ']') {
      stack.pop();
      i++;
    } else if (c === "'" || c === '`' || c === ',') {
      if (c === "'") pendingQuote = true;
      i += c === ',' && code[i + 1] === '@' ? 2 : 1;
    } else if (c === '#' && code[i + 1] === "'") {
      pendingQuote = true;
      i += 2;
    } else if (c === '?' && (i === 0 || /[\s([]/.test(code[i - 1]))) {
      let j = i + 1;
      if (code[j] === '\\') {
        j += 2;
        while (j < n && /[\w-]/.test(code[j]) && !/[\s()]/.test(code[j])) j++;
      } else j += 1;
      element();
      pendingQuote = false;
      i = j;
    } else {
      let j = i;
      while (j < n && !/[\s()[\]";]/.test(code[j])) j++;
      if (j === i) j = i + 1;
      const form = stack[stack.length - 1] ?? null;
      const index = element();
      const text = code.slice(i, j);
      atoms.push({ s: i, e: j, text, index, form, direct: pendingQuote });
      if (form && index === 0) form.head = text;
      pendingQuote = false;
      i = j;
    }
  }
  // the rules of lisp-el-font-lock-keywords-2, in order
  const headAfterParen = (/** @type {typeof atoms[number]} */ a) => a.index === 0 && code[a.s - 1] === '(';
  for (const a of atoms) { // (defun NAME ...): the definer is a keyword and the name is what the definer defines
    if (!headAfterParen(a) || !Object.hasOwn(EL_DEFINERS, a.text)) continue;
    paint.fill(a.s, a.e, 'keyword');
    const name = atoms.find((b) => b.form === a.form && b.index === 1);
    if (name && /^[ \t']*$/.test(code.slice(a.e, name.s))) {
      const kind = EL_DEFINERS[a.text];
      paint.fill(name.s, name.e, kind === 'var' ? 'variable-name' : kind === 'type' ? 'type' : 'function-name');
    }
  }
  for (const a of atoms) if (headAfterParen(a) && /^(?:cl-assert|cl-check-type|error|signal|user-error|warn)$/.test(a.text)) paint.fill(a.s, a.e, 'warning');
  for (const a of atoms) { // a macro or special form in function position
    if (!headAfterParen(a) || !EL_KEYWORDS.has(a.text)) continue;
    const before = code[a.s - 2];
    if (before === "'" || (a.form && a.form.quoted)) continue; // quoted data, not a call
    paint.fill(a.s, a.e, 'keyword');
  }
  for (const a of atoms) { // (require 'feature)
    if (!headAfterParen(a) || !/^(?:catch|throw|featurep|provide|require)$/.test(a.text)) continue;
    paint.fill(a.s, a.e, 'keyword');
    const arg = atoms.find((b) => b.form === a.form && b.index === 1);
    if (arg && /^[ \t']*$/.test(code.slice(a.e, arg.s))) paint.fill(arg.s, arg.e, 'constant');
  }
  for (const a of atoms) {
    if (/^:[^\s:]/.test(a.text) && a.text.length > 1) paint.fill(a.s, a.e, 'builtin'); // :keyword
    else if (/^&[A-Za-z]/.test(a.text)) paint.fill(a.s, a.e, 'type'); // &optional
  }
  return paint.runs(code);
}

// ---- python ---------------------------------------------------------------------------------------------

/** Escapes python-mode paints as constants inside a string: the bytes escapes, and for text also \u, \U and \N. */
const PY_BYTES_ESCAPE = /\\(?:\\|'|a|b|f|n|r|t|v|[0-7]{1,3}|x[0-9a-fA-F]{2})/y;
const PY_TEXT_ESCAPE = /\\(?:\\|'|a|b|f|n|r|t|v|[0-7]{1,3}|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|N\{[^}]*?\})/y;

/** @param {string} code @returns {[string, Face][]} */
function python(code) {
  const paint = new Paint(code.length);
  const n = code.length;
  /** @type {{ s: number, q: number, e: number }[]} */
  const strings = [];
  let i = 0;
  while (i < n) {
    const c = code[i];
    if (c === '#') {
      const stop = lineEnd(code, i);
      const d = /^#+[ \t]*/.exec(code.slice(i, stop));
      paint.set(i, i + (d ? d[0].length : 1), 'comment-delimiter');
      paint.set(i + (d ? d[0].length : 1), stop, 'comment');
      i = stop;
      continue;
    }
    const m = c === '"' || c === "'" || (/[rRbBuUfF]/.test(c) && !/[\w]/.test(code[i - 1] ?? ' '))
      ? /^([rRbBuUfF]{0,2})("""|'''|"|')/.exec(code.slice(i, i + 5))
      : null;
    if (!m) { i++; continue; }
    const q = i + m[1].length;
    const quote = m[2];
    let j = q + quote.length;
    while (j < n && !code.startsWith(quote, j)) {
      if (code[j] === '\\') j++;
      else if (quote.length === 1 && code[j] === '\n') break;
      j++;
    }
    const e = Math.min(n, j + quote.length);
    paint.set(q, e, 'string');
    strings.push({ s: i, q, e });
    const prefix = m[1].toLowerCase();
    const bodyStart = q + quote.length;
    const bodyEnd = Math.max(bodyStart, e - quote.length);
    if (prefix.includes('f')) { // {expression} of an f-string is code, not string
      for (let k = bodyStart; k < bodyEnd; k++) {
        if (code[k] !== '{') continue;
        if (code[k + 1] === '{') { k++; continue; }
        let depth = 1;
        let l = k + 1;
        while (l < bodyEnd && depth) { if (code[l] === '{') depth++; else if (code[l] === '}') depth--; l++; }
        paint.set(k, l, null);
        k = l - 1;
      }
    }
    if (!prefix.includes('r')) {
      const re = prefix.includes('b') ? PY_BYTES_ESCAPE : PY_TEXT_ESCAPE;
      for (let k = bodyStart; k < bodyEnd; k++) {
        if (code[k] !== '\\') continue;
        re.lastIndex = k;
        const esc = re.exec(code);
        if (esc && paint.faces[k] === 'string') { paint.set(k, k + esc[0].length, 'constant'); k += esc[0].length - 1; } else k++;
      }
    }
    i = e;
  }
  const toks = tokens(code, paint);
  // the bracket depth at the start of each line, outside strings and comments
  const lines = code.split('\n');
  /** @type {number[]} */
  const startOf = [];
  let off = 0;
  for (const l of lines) { startOf.push(off); off += l.length + 1; }
  /** @type {number[]} */
  const depthAt = new Array(lines.length).fill(0);
  {
    let depth = 0;
    let line = 0;
    for (let k = 0; k < n; k++) {
      while (line + 1 < lines.length && startOf[line + 1] <= k) { line++; depthAt[line] = depth; }
      if (paint.faces[k] !== null && paint.faces[k] !== 'constant') continue;
      if (paint.faces[k] === 'constant') continue;
      if ('([{'.includes(code[k])) depth++;
      else if (')]}'.includes(code[k])) depth = Math.max(0, depth - 1);
    }
  }
  const lineOf = (/** @type {number} */ idx) => { let lo = 0; let hi = lines.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (startOf[mid] <= idx) lo = mid; else hi = mid - 1; } return lo; };
  // docstrings: a string alone on its statement, first in the body of a def or class (or first in the file)
  for (const st of strings) {
    const L = lineOf(st.s);
    if (!/^[ \t]*$/.test(code.slice(startOf[L], st.s)) || depthAt[L] !== 0) continue;
    if (!/^[ \t]*(?:#.*)?$/.test(code.slice(st.e, lineEnd(code, st.e)))) continue;
    let P = L - 1;
    while (P >= 0 && (/^\s*(?:#.*)?$/.test(lines[P]) || depthAt[P] !== 0)) P--;
    let isDoc = P < 0;
    if (!isDoc) {
      const header = lines.slice(P, L).join('\n').replace(/#[^\n]*/g, '').trimEnd();
      isDoc = /^[ \t]*(?:async\s+def|def|class)\b/.test(lines[P]) && header.endsWith(':');
    }
    if (isDoc) for (let k = st.q; k < st.e; k++) if (paint.faces[k] === 'string') paint.faces[k] = 'doc';
  }
  // rules of python-font-lock-keywords-maximum-decoration, in order
  for (let t = 0; t + 1 < toks.length; t++) {
    const a = toks[t];
    const b = toks[t + 1];
    if ((a.text === 'def' || a.text === 'class') && /^[\p{L}_]/u.test(b.text)) paint.fill(b.s, b.e, a.text === 'def' ? 'function-name' : 'type');
  }
  for (let t = 0; t < toks.length; t++) {
    const a = toks[t];
    if (a.text === 'async' && toks[t + 1] && /^(?:def|for|with)$/.test(toks[t + 1].text) && /^\s+$/.test(code.slice(a.e, toks[t + 1].s))) {
      paint.fill(a.s, toks[t + 1].e, 'keyword');
      t++;
    } else if (PY_KEYWORDS.has(a.text)) paint.fill(a.s, a.e, 'keyword');
  }
  for (const a of toks) if (PY_BUILTINS.has(a.text)) paint.fill(a.s, a.e, 'builtin');
  for (const a of toks) if (PY_CONSTANTS.has(a.text)) paint.fill(a.s, a.e, 'constant');
  for (let L = 0; L < lines.length; L++) { // @decorator
    const m = /^[ \t]*(@[\w]+(?:\.[\w]+)*)/.exec(lines[L]);
    if (m && depthAt[L] === 0) paint.fill(startOf[L] + m[0].length - m[1].length, startOf[L] + m[0].length, 'type');
  }
  for (const a of toks) if (PY_EXCEPTIONS.has(a.text)) paint.fill(a.s, a.e, 'type');
  for (let L = 0; L < lines.length; L++) { // NAME = ..., NAME: type = ..., a, b = ...
    if (depthAt[L] !== 0 || (L > 0 && /\\$/.test(lines[L - 1]))) continue;
    const base = startOf[L];
    const line = lines[L];
    const one = /^([ \t]*)\*?(?:\w+\.)*(\w+)(?:\[[^\]]+\])?[ \t]*(?::[ \t]*[^\n%&*+/<->^|~=-]+[ \t]*)?((?:\*\*|\/\/|<<|>>|[%&*+/|^-])?=)(?!=)/.exec(line);
    if (one) {
      const nameEnd = one.index + one[0].length - one[3].length;
      const target = /(\w+)(?:\[[^\]]+\])?[ \t]*(?::[ \t]*[^\n%&*+/<->^|~=-]+[ \t]*)?$/.exec(line.slice(0, nameEnd));
      if (target) paint.fill(base + nameEnd - target[0].length, base + nameEnd - target[0].length + target[1].length, 'variable-name');
      paint.fill(base + nameEnd, base + nameEnd + one[3].length, 'operator');
      continue;
    }
    const many = /^[ \t]*((?:[([][ \t]*)?\*?(?:\w+\.)*\w+(?:[ \t]*,[ \t]*\*?(?:\w+\.)*\w+)+[ \t]*[)\]]?)[ \t]*((?:\*\*|\/\/|<<|>>|[%&*+/|^-])?=)(?!=)/.exec(line);
    if (many) {
      const from = line.indexOf(many[1]);
      for (const w of many[1].matchAll(/\*?(?:\w+\.)*(\w+)/g)) {
        const at = from + (w.index ?? 0) + w[0].length - w[1].length;
        paint.fill(base + at, base + at + w[1].length, 'variable-name');
      }
      const opAt = many[0].length - many[2].length;
      paint.fill(base + opAt, base + opAt + many[2].length, 'operator');
    }
  }
  const OP = /!=|\*\*|\/\/|<[<=]|==|>[=>]|[%&*+/<=>|~^-]/y;
  for (let k = 0; k < n; k++) {
    if (paint.faces[k] !== null) continue;
    OP.lastIndex = k;
    const m = OP.exec(code);
    if (m) { paint.fill(k, k + m[0].length, 'operator'); k += m[0].length - 1; }
  }
  return paint.runs(code);
}

// ---- js -------------------------------------------------------------------------------------------------

/** Words after which a `/` starts a regular expression. */
const BEFORE_REGEX = /(?:^|[^\w$])(?:return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)$/;

/** @param {string} code @param {boolean} regexLiterals @param {boolean} template @returns {Paint} */
function cSyntactic(code, regexLiterals, template) {
  const paint = new Paint(code.length);
  const n = code.length;
  let i = 0;
  let prev = ''; // the last character that was not blank or in a comment
  while (i < n) {
    const c = code[i];
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    const stop = cComment(code, paint, i);
    if (stop >= 0) { i = stop; continue; }
    if (c === '"' || c === "'" || (template && c === '`')) {
      const e = quoted(code, i, c === '`');
      paint.set(i, e, 'string');
      prev = c;
      i = e;
      continue;
    }
    if (regexLiterals && c === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || BEFORE_REGEX.test(code.slice(Math.max(0, i - 12), i).trimEnd()))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && code[j] !== '\n' && (code[j] !== '/' || inClass)) {
        if (code[j] === '\\') j++;
        else if (code[j] === '[') inClass = true;
        else if (code[j] === ']') inClass = false;
        j++;
      }
      if (code[j] === '/') {
        paint.set(i, j + 1, 'string');
        prev = '/';
        i = j + 1;
        continue;
      }
    }
    prev = c;
    i++;
  }
  return paint;
}

/** @param {string} code @returns {[string, Face][]} */
function js(code) {
  const paint = cSyntactic(code, true, true);
  const toks = tokens(code, paint);
  const isWord = (/** @type {Token} */ t) => /^[\p{L}_$]/u.test(t.text);
  const dotted = (/** @type {number} */ from) => { // NAME(.NAME)* from token index `from`: the end offset, or -1
    let t = from;
    if (!toks[t] || !isWord(toks[t])) return -1;
    let end = toks[t].e;
    while (toks[t + 1] && toks[t + 1].text === '.' && toks[t + 1].s === end && toks[t + 2] && isWord(toks[t + 2]) && toks[t + 2].s === end + 1) { end = toks[t + 2].e; t += 2; }
    return end;
  };
  for (const t of toks) if (t.text === 'import') paint.fill(t.s, t.e, 'keyword');
  for (let k = 0; k < toks.length; k++) { // function NAME at the start of a line, NAME: function
    const t = toks[k];
    const first = /^[ \t]*$/.test(code.slice(lineStart(code, t.s), t.s));
    if (t.text === 'function' && first) {
      let j = k + 1;
      if (toks[j] && toks[j].text === '*') j++;
      if (toks[j] && isWord(toks[j])) paint.fill(toks[j].s, toks[j].e, 'function-name');
    } else if (first && isWord(t) && toks[k + 1] && toks[k + 1].text === ':' && toks[k + 2] && toks[k + 2].text === 'function') paint.fill(t.s, t.e, 'function-name');
  }
  for (const t of toks) if (JS_KEYWORDS.has(t.text)) paint.fill(t.s, t.e, 'keyword');
  for (const t of toks) if (JS_TYPES.has(t.text)) paint.fill(t.s, t.e, 'type');
  for (const t of toks) if (JS_CONSTANTS.has(t.text)) paint.fill(t.s, t.e, 'constant');
  for (let k = 1; k < toks.length; k++) if (toks[k].text === 'prototype' && toks[k - 1].text === '.' && toks[k - 1].e === toks[k].s) paint.fill(toks[k].s, toks[k].e, 'constant');
  for (let k = 0; k < toks.length; k++) { // const / let / var: the names declared
    if (!/^(?:const|let|var)$/.test(toks[k].text)) continue;
    let j = k + 1;
    for (;;) {
      if (!toks[j] || !isWord(toks[j])) break;
      paint.fill(toks[j].s, toks[j].e, 'variable-name');
      j++;
      let depth = 0; // the initializer, to the comma or end of the declaration
      while (toks[j]) {
        const x = toks[j].text;
        if ('([{'.includes(x)) depth++;
        else if (')]}'.includes(x)) { if (!depth) break; depth--; } else if (depth === 0 && (x === ',' || x === ';')) break;
        else if (depth === 0 && /^(?:of|in)$/.test(x)) break;
        else if (depth === 0 && /\n/.test(code.slice(toks[j - 1].e, toks[j].s)) && !/^[-+*/%&|=<>?:,.]$/.test(toks[j - 1].text) && !/^[-+*/%&|=<>?:.]/.test(x)) break;
        j++;
      }
      if (toks[j] && toks[j].text === ',') j++;
      else break;
    }
  }
  for (let k = 0; k < toks.length; k++) { // new X.Y, instanceof X.Y
    if (toks[k].text !== 'new' && toks[k].text !== 'instanceof') continue;
    const end = dotted(k + 1);
    if (end >= 0) paint.fill(toks[k + 1].s, end, 'type');
  }
  for (let k = 0; k < toks.length; k++) { // function NAME?(params): the names to the end of the line
    if (toks[k].text !== 'function') continue;
    let j = k + 1;
    if (toks[j] && isWord(toks[j])) j++;
    if (!toks[j] || toks[j].text !== '(' || !toks[j + 1] || !isWord(toks[j + 1])) continue;
    const eol = lineEnd(code, toks[j + 1].s);
    for (let p = j + 1; toks[p] && toks[p].s < eol; p++) {
      if (!isWord(toks[p])) continue;
      paint.fill(toks[p].s, toks[p].e, 'variable-name');
      if (/^\s*\)/.test(code.slice(toks[p].e, eol))) break;
    }
  }
  return paint.runs(code);
}

// ---- java -----------------------------------------------------------------------------------------------

/** @param {string} code @returns {[string, Face][]} */
function java(code) {
  const paint = cSyntactic(code, false, false);
  const toks = tokens(code, paint);
  const word = (/** @type {Token | undefined} */ t) => !!t && /^[\p{L}_$]/u.test(t.text);
  /** A word that can be a name: not a keyword, primitive type or literal. @param {Token | undefined} t */
  const name = (t) => word(t) && !JAVA_KEYWORDS.has(/** @type {Token} */ (t).text) && !JAVA_TYPES.has(/** @type {Token} */ (t).text) && !JAVA_CONSTANTS.has(/** @type {Token} */ (t).text);
  /** The token after the balanced pair that opens at `k` (`(`, `{`, `[` or `<`), or -1. @param {number} k */
  const close = (k) => {
    const open = toks[k].text;
    const shut = { '(': ')', '{': '}', '[': ']', '<': '>' }[/** @type {'('} */ (open)];
    let depth = 0;
    for (let j = k; j < toks.length; j++) {
      if (toks[j].text === open) depth++;
      else if (toks[j].text === shut && --depth === 0) return j + 1;
    }
    return -1;
  };
  /** Type arguments `<...>` from token `k`: paints the names as types and returns the index after, or -1 when it is not a type argument list. @param {number} k @param {boolean} paintIt */
  const typeArgs = (k, paintIt) => {
    const end = close(k);
    if (end < 0) return -1;
    for (let j = k + 1; j < end - 1; j++) {
      const x = toks[j].text;
      if (!(word(toks[j]) || /^[<>,.?&[\]]$/.test(x))) return -1;
    }
    if (paintIt) for (let j = k + 1; j < end - 1; j++) if (name(toks[j]) && toks[j + 1] && toks[j + 1].text !== '.') paint.fill(toks[j].s, toks[j].e, 'type');
    return end;
  };
  /** A type from token `k`: the primitive or the dotted name, its type arguments, its array brackets. @param {number} k @param {boolean} paintIt @returns {number} the index after it, or -1 */
  const type = (k, paintIt) => {
    const t = toks[k];
    if (!t) return -1;
    let j;
    if (JAVA_TYPES.has(t.text)) {
      if (paintIt) paint.fill(t.s, t.e, 'type');
      j = k + 1;
    } else if (name(t)) {
      j = k;
      while (toks[j + 1] && toks[j + 1].text === '.' && name(toks[j + 2])) j += 2;
      if (paintIt) paint.fill(toks[j].s, toks[j].e, 'type');
      j++;
      if (toks[j] && toks[j].text === '<') {
        j = typeArgs(j, paintIt);
        if (j < 0) return -1;
      }
    } else return -1;
    while (toks[j] && toks[j].text === '[' && toks[j + 1] && toks[j + 1].text === ']') j += 2;
    return j;
  };
  // annotations
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].text !== '@' || !toks[k + 1]) continue;
    if (toks[k + 1].text === 'interface') { paint.fill(toks[k].s, toks[k + 1].e, 'keyword'); continue; }
    if (!word(toks[k + 1])) continue;
    let j = k + 1;
    while (toks[j + 1] && toks[j + 1].text === '.' && word(toks[j + 2])) j += 2;
    paint.fill(toks[k].s, toks[j].e, 'c-annotation');
  }
  // package and import
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].text !== 'package' && toks[k].text !== 'import') continue;
    const isImport = toks[k].text === 'import';
    let j = k + 1;
    if (toks[j] && toks[j].text === 'static') j++;
    /** @type {Token[]} */
    const parts = [];
    while (toks[j] && toks[j].text !== ';') {
      if (word(toks[j]) || toks[j].text === '*') parts.push(toks[j]);
      j++;
    }
    parts.forEach((p, idx) => {
      const last = idx === parts.length - 1;
      if (isImport) paint.fill(p.s, p.e, last && p.text !== '*' && /^[A-Z]/.test(p.text) ? 'type' : p.text === '*' ? 'type' : 'constant');
      else if (idx > 0) paint.fill(p.s, p.e, 'constant'); // Emacs leaves the first part of a package name plain
    });
    if (isImport && parts.length && parts[parts.length - 1].text === '*') paint.set(parts[parts.length - 1].s, parts[parts.length - 1].e, null);
  }
  // class, interface and enum names, their type parameters, extends / implements / throws / new
  for (let k = 0; k < toks.length; k++) {
    const x = toks[k].text;
    if ((x === 'class' || x === 'interface' || x === 'enum') && name(toks[k + 1])) {
      paint.fill(toks[k + 1].s, toks[k + 1].e, 'type');
      if (toks[k + 2] && toks[k + 2].text === '<') typeArgs(k + 2, true);
      if (x === 'enum') {
        let j = k + 2;
        while (toks[j] && toks[j].text !== '{') j++;
        j++;
        while (name(toks[j])) {
          paint.fill(toks[j].s, toks[j].e, 'variable-name');
          j++;
          if (toks[j] && toks[j].text === '(') j = Math.max(j, close(j));
          if (toks[j] && toks[j].text === '{') j = Math.max(j, close(j));
          if (toks[j] && toks[j].text === ',') j++;
          else break;
        }
      }
    } else if (x === 'extends' || x === 'implements' || x === 'throws') {
      let j = k + 1;
      for (;;) {
        const end = type(j, true);
        if (end < 0) break;
        j = end;
        if (toks[j] && toks[j].text === ',') j++;
        else break;
      }
    } else if (x === 'new') {
      type(k + 1, true);
    }
  }
  // declarations: [modifiers] [<T>] Type name followed by ( = ; , or :
  const gate = (/** @type {number} */ k) => k === 0 || /^[{};)(]$/.test(toks[k - 1].text) || paint.faces[toks[k - 1].s] === 'c-annotation';
  for (let k = 0; k < toks.length; k++) {
    if (!gate(k)) continue;
    let j = k;
    while (toks[j] && (JAVA_MODIFIERS.has(toks[j].text) && toks[j + 1] && toks[j + 1].text !== ':' || paint.faces[toks[j].s] === 'c-annotation')) j++;
    if (toks[j] && toks[j].text === '<') {
      const end = typeArgs(j, true);
      if (end < 0) continue;
      j = end;
    }
    const tEnd = type(j, false);
    if (tEnd < 0) continue;
    const nameTok = toks[tEnd];
    if (!name(nameTok)) continue;
    const next = toks[tEnd + 1];
    if (!next) continue;
    if (next.text === '(') {
      type(j, true);
      paint.fill(nameTok.s, nameTok.e, 'function-name');
      const endParams = close(tEnd + 1);
      let p = tEnd + 2;
      while (p < (endParams < 0 ? 0 : endParams - 1)) { // each parameter: [final] [@annotations] Type name
        while (toks[p] && (toks[p].text === 'final' || paint.faces[toks[p].s] === 'c-annotation')) p++;
        const pEnd = type(p, false);
        if (pEnd >= 0 && toks[pEnd] && toks[pEnd].text === '...') {
          type(p, true);
          p = pEnd + 1;
        } else if (pEnd >= 0) type(p, true);
        const pn = pEnd >= 0 ? (toks[pEnd].text === '...' ? toks[pEnd + 1] : toks[pEnd]) : undefined;
        if (pn && name(pn)) paint.fill(pn.s, pn.e, 'variable-name');
        while (p < endParams - 1 && toks[p].text !== ',') p += toks[p].text === '<' || toks[p].text === '(' ? Math.max(1, close(p) - p) : 1;
        p++;
      }
    } else if (/^[=;,:]$/.test(next.text)) {
      type(j, true);
      paint.fill(nameTok.s, nameTok.e, 'variable-name');
      let p = tEnd + 1;
      while (next.text !== ':' && toks[p]) { // the initializer, then more declarators after a top-level comma
        const x = toks[p].text;
        if (x === ';') break;
        if ('([{'.includes(x)) { p = Math.max(p + 1, close(p)); continue; }
        if (x === ')' || x === '}') break;
        if (x === ',' && name(toks[p + 1]) && toks[p + 2] && /^[=;,]$/.test(toks[p + 2].text)) paint.fill(toks[p + 1].s, toks[p + 1].e, 'variable-name');
        p++;
      }
    }
  }
  // a cast: (Type) operand
  for (let k = 1; k + 2 < toks.length; k++) {
    if (toks[k].text !== '(' || !name(toks[k + 1]) || toks[k + 2].text !== ')' || !/^[A-Z]/.test(toks[k + 1].text)) continue;
    const before = toks[k - 1];
    if (word(before) || before.text === ')' || before.text === ']') continue;
    const after = toks[k + 3];
    if (after && (name(after) || /^["'\d(]/.test(after.text) || /^[\d]/.test(after.text) || paint.faces[after.s] === 'string')) paint.fill(toks[k + 1].s, toks[k + 1].e, 'type');
  }
  for (const t of toks) {
    if (JAVA_KEYWORDS.has(t.text)) paint.fill(t.s, t.e, 'keyword');
    else if (JAVA_CONSTANTS.has(t.text)) paint.fill(t.s, t.e, 'constant');
    else if (JAVA_TYPES.has(t.text)) paint.fill(t.s, t.e, 'type');
  }
  return paint.runs(code);
}

const LANGUAGES = /** @type {Record<string, (code: string) => [string, Face][]>} */ ({ elisp, python, js, java });

/** The language names this module colors the way Emacs does, and which of its colorings each one gets. */
export const EMACS_ALIASES = /** @type {Record<string, string>} */ ({
  'emacs-lisp': 'elisp', elisp: 'elisp', emacs: 'elisp',
  python: 'python', py: 'python', python3: 'python',
  js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', node: 'js',
  java: 'java',
});

/**
 * The runs of equal face in `code`, as Emacs colors it, or null when the language is not one this module colors.
 * @param {string} code @param {string} language
 * @returns {[string, string | null][] | null}
 */
export function highlightRuns(code, language) {
  const key = Object.hasOwn(EMACS_ALIASES, language.toLowerCase()) ? EMACS_ALIASES[language.toLowerCase()] : null;
  return key ? LANGUAGES[key](code) : null;
}
