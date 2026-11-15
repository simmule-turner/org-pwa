// @ts-check
/**
 * Source coloring of shell scripts as Emacs 29.3's sh-mode font-lock gives it (sh-script.el): the syntactic faces first (comments, quoted
 * strings, backquote strings, here-documents), then `sh-font-lock-keywords-2` rule by rule, in order, each painting only what no earlier
 * rule has painted unless it overrides. The shell is the one Emacs would guess in a buffer without a magic number: bash. A `#!` line naming
 * sh, dash or ash selects the sh word lists (no `$(` rule, no array assignments, fewer builtins); another shell keeps the bash lists.
 * test/source-color.test.js holds the result to the faces Emacs gave test/fixtures/source-color/*.sh.
 *
 * shRuns(code) -> [[text, face | null], ...]
 */

import { Paint, rule } from './source-paint.js';

/** @typedef {string | null} Face */

// The word constituents sh-mode font-lock sees: letters, digits and / ~ . - _ (font-lock-defaults' syntax alist).
const W = String.raw`\p{L}\p{N}_/~.\-`;
const BOW = `(?<![${W}])(?=[${W}])`; // \<
const EOW = `(?<=[${W}])(?![${W}])`; // \>
const SPACE = String.raw`[ \t\r\f]`; // \s- (the syntax class whitespace; a newline is a comment ender in sh-mode)
const META = '|&;<>(`\\"\' \t\n'; // a `#` after one of these (or at a line start) starts a comment

// sh-builtins, sh-leading-keywords and sh-other-keywords of sh-mode, per shell (taken from Emacs 29.3 with sh-set-shell).
const BASH = {
  builtins: ['.', 'alias', 'bg', 'bind', 'builtin', 'caller', 'compgen', 'complete', 'declare', 'dirs', 'disown', 'enable', 'fc', 'fg', 'help', 'history', 'jobs',
    'kill', 'let', 'local', 'popd', 'printf', 'pushd', 'shopt', 'source', 'suspend', 'typeset', 'unalias', 'mapfile', 'readarray', 'coproc', 'command', 'hash', 'test',
    'type', 'eval', 'export', 'getopts', 'newgrp', 'pwd', 'read', 'readonly', 'times', 'ulimit', 'cd', 'echo', 'set', 'shift', 'umask', 'unset', 'wait'],
  leading: ['time', '!', 'do', 'elif', 'else', 'if', 'then', 'trap', 'type', 'until', 'while'],
  other: ['bye', 'logout', 'select', 'function', 'done', 'esac', 'fi', 'for', 'in', 'return', 'break', 'case', 'continue', 'exec', 'exit'],
  assignment: String.raw`(?<![${W}])(?=[${W}])([\p{L}\p{N}_]+)(\[.+\])?\+?=`,
  subshell: true,
};
const SH = {
  builtins: ['hash', 'test', 'type', 'eval', 'export', 'getopts', 'newgrp', 'pwd', 'read', 'readonly', 'times', 'ulimit', 'cd', 'echo', 'set', 'shift', 'umask', 'unset', 'wait'],
  leading: ['!', 'do', 'elif', 'else', 'if', 'then', 'trap', 'type', 'until', 'while'],
  other: ['done', 'esac', 'fi', 'for', 'in', 'return', 'break', 'case', 'continue', 'exec', 'exit'],
  assignment: String.raw`(?<![${W}])(?=[${W}])([\p{L}\p{N}_]+)=`,
  subshell: false,
};

const escapeRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (/** @type {string[]} */ words) => [...new Set(words)].sort((a, b) => b.length - a.length).map(escapeRe).join('|');

/** The shell a script's first line names: sh for sh, dash and ash, bash otherwise. @param {string} code */
function shellOf(code) {
  const m = /^#!.*\/([^ \t\n]+)/.exec(code);
  return m && /^(?:sh|dash|ash)$/.test(m[1]) ? SH : BASH;
}

// ---- syntactic faces ---------------------------------------------------------------------------------------

/** The end (after the closing quote) of the double-quoted string opened at `open`, following sh-font-lock-quoted-subshell: inside `$(...)` and
 * backquotes the quotes pair up on their own and do not end the string. @param {string} code @param {number} open @returns {number} */
function doubleQuoted(code, open) {
  const n = code.length;
  /** @type {string | null} */
  let state = 'double-quote';
  /** @type {string[]} */
  const states = [];
  let i = open + 1;
  while (state) {
    while (i < n && !`'\\"\`$()`.includes(code[i])) i++;
    if (i >= n) return n;
    const c = code[i];
    if (c === "'") {
      if (state !== 'double-quote') {
        const close = code.indexOf("'", i + 1);
        i = close < 0 ? n : close;
      }
    } else if (c === '\\') i++;
    else if (c === '"') {
      if (state === 'double-quote') state = states.pop() ?? null;
      else { states.push(state); state = 'double-quote'; }
    } else if (c === '`') {
      if (state === 'backquote') state = states.pop() ?? null;
      else { states.push(state); state = 'backquote'; }
    } else if (c === '$') {
      if (code[i + 1] === '(') { i++; states.push(state); state = 'code'; }
    } else if (c === '(') {
      if (state !== 'double-quote') { states.push(state); state = 'code'; }
    } else if (state !== 'double-quote') state = states.pop() ?? null; // ")"
    i++;
  }
  return Math.min(i, n);
}

const PATTERN = String.raw`(?:[\p{L}\p{N}_\-$=?\[\]*@/\\.!:%^~,]|\\[\s\S]|"[^"]*"|'[^']*'|\$\{[^}]*\})+`;
const CASE_CLOSE = new RegExp(String.raw`(;[;&]|(?<![${W}])in)\s*\(?\s*(${PATTERN})(?:\s*\|\s*${PATTERN})*\s*$`, 'u');

/** Whether the `)` at `i` closes a case pattern (sh-font-lock-paren makes it punctuation, so it closes no group). @param {string} code @param {number} i */
function closesCasePattern(code, i) {
  const m = CASE_CLOSE.exec(code.slice(Math.max(0, i - 300), i));
  if (!m) return false;
  return !(m[2] === 'esac' && /^(?:;[;&]|in)\s+esac$/.test(m[0].replace(/\s+$/, '')));
}

/** The paint of comments, strings, backquote strings and here-documents (the syntactic part of font-lock). @param {string} code @param {Paint} paint */
function syntactic(code, paint) {
  const n = code.length;
  /** @type {boolean[]} */
  const open = []; // the enclosing brackets, each: is it a `((`, `$((`, `${` or `$[` (not a command list)
  /** @type {Map<number, string>} */
  const markers = new Map(); // the newline that starts a here-document -> its delimiter
  let escapedEnd = -1; // the index after a backslash and the character it escapes
  let hiddenUntil = 0; // syntax-propertize-rules matches its rules past this point only (see the escaped quote below)
  let i = 0;
  while (i < n) {
    const c = code[i];
    if (c === '\n' && markers.has(i)) {
      const key = /** @type {string} */ (markers.get(i));
      const end = new RegExp(`^[ \\t]*${escapeRe(key)}\\n`, 'gm');
      end.lastIndex = i + 1;
      const m = end.exec(code);
      const stop = m ? m.index + m[0].length : n;
      // A comment that ends at this newline stops one character early in Emacs: that character is made the comment's ender, which is a delimiter;
      // the blanks before it are part of the ender, as in a comment-end-skip match.
      if (i > 0 && (paint.faces[i - 1] === 'comment' || paint.faces[i - 1] === 'comment-delimiter')) {
        let k = i - 1;
        paint.faces[k] = 'comment-delimiter';
        while (k > 0 && paint.faces[k - 1] === 'comment' && /[ \t]/.test(code[k - 1])) paint.faces[--k] = 'comment-delimiter';
      }
      paint.set(i, stop, 'sh-heredoc');
      i = stop;
    } else if (c === '\\') {
      escapedEnd = code[i + 1] === '\n' ? -1 : Math.min(n, i + 2); // a newline is no escaped character a `#` can follow
      if (code[i + 1] === '"' && i + 1 >= hiddenUntil) {
        // The rule for a quote that may open a `$(` or backquote inside a string also matches this escaped one (Emacs asks the parser only afterwards
        // and finds no string), and swallows the text up to that `$(` or backquote: the other rules do not see it, so a `#` there starts a comment.
        const swallow = /"(?:[^\\"]|\\[\s\S])*?(?:\$\(|`)/y;
        swallow.lastIndex = i + 1;
        const m = swallow.exec(code);
        if (m) hiddenUntil = m.index + m[0].length;
      }
      i += 2;
    } else if (c === '#') {
      if (isComment(code, i, escapedEnd, i < hiddenUntil)) {
        const stop = code.indexOf('\n', i) < 0 ? n : code.indexOf('\n', i);
        const delim = /^#+[ \t]*/.exec(code.slice(i, stop));
        const d = delim ? delim[0].length : 1;
        paint.set(i, i + d, 'comment-delimiter');
        paint.set(i + d, Math.min(n, stop + 1), 'comment');
        i = stop;
      } else i++;
    } else if (c === "'") {
      const close = code.indexOf("'", i + 1);
      const stop = close < 0 ? n : close + 1;
      paint.set(i, stop, 'string');
      i = stop;
    } else if (c === '"') {
      const stop = doubleQuoted(code, i);
      paint.set(i, stop, 'string');
      i = stop;
    } else if (c === '`') {
      let j = i + 1;
      while (j < n && code[j] !== '`') j += code[j] === '\\' ? 2 : 1;
      const stop = Math.min(n, j + 1);
      paint.set(i, stop, 'sh-quoted-exec');
      i = stop;
    } else if (c === '(' || c === '{' || c === '[') {
      open.push((c === '(' && code[i - 1] === '(') || (c !== '(' && code[i - 1] === '$'));
      i++;
    } else if (c === ')' || c === '}' || c === ']') {
      if (!(c === ')' && i >= hiddenUntil && closesCasePattern(code, i))) open.pop();
      i++;
    } else if (c === '<' && code[i + 1] === '<' && i > 0 && code[i - 1] !== '<' && i >= hiddenUntil) {
      i = startHeredoc(code, i, open, markers);
    } else i++;
  }
}

/** Whether the `#` at `i` starts a comment: it begins a word (after a blank, a line start or one of | & ; < > ( ` " '), is not the character a backslash
 * escapes, and is not part of `${#`, `foo(#q` or `(#b)foo`. @param {string} code @param {number} i @param {number} escapedEnd @param {boolean} hidden the text is one the rules do not see, where every `#` starts a comment */
function isComment(code, i, escapedEnd, hidden) {
  if (i === escapedEnd) return false;
  if (i === 0 || hidden) return true;
  const p = code[i - 1];
  if (!META.includes(p)) return false;
  if (p === '(') {
    if (i >= 2 && !META.includes(code[i - 2])) return false;
    if (/^\(#[^)]+?\)[^|&;<>)`\\"' \t\n]/.test(code.slice(i - 1))) return false;
  }
  return true;
}

/** A `<<WORD` at `i` starts a here-document at the end of its line, unless it is inside `((...))`, `${...}` or `$[...]`; the rest of the line is then
 * skipped as Emacs's search does (a refused `<<WORD` hides a second one on the same line). @param {string} code @param {number} i
 * @param {boolean[]} open @param {Map<number, string>} markers @returns {number} where scanning goes on */
function startHeredoc(code, i, open, markers) {
  const re = /<<-?[ \t\r\f]*\\?((?:['"][^'"]+['"]|[\p{L}\p{N}]|[-/~._@])+)(?:(?:.*[^\\\n])?(?:\\\\)*\\\n)*.*(\n)/uy;
  re.lastIndex = i;
  const m = re.exec(code);
  if (!m) return i + 2;
  if (open.some(Boolean) || code[i - 1] === '>') return m.index + m[0].length;
  markers.set(m.index + m[0].length - 1, m[1].replace(/['"]/g, ''));
  return i + 2;
}

// ---- keyword rules -----------------------------------------------------------------------------------------

/** @param {string} code @returns {[string, Face][]} */
export function shRuns(code) {
  const paint = new Paint(code.length);
  const shell = shellOf(code);
  syntactic(code, paint);
  const delim = '(^|[;(){}`|&])';
  const lead = alt(shell.leading);
  const all = alt([...shell.leading, ...shell.other]);
  const keywords = `${delim}[ \\t]*((?:(?:${lead})[ \\t]+)?(?:${all})`;
  rule(code, paint, new RegExp(shell.assignment, 'gmu'), [[1, 'variable-name']]);
  rule(code, paint, new RegExp(`${keywords}[ \\t]+)?(${alt(shell.builtins)})${EOW}`, 'gm'), [[2, 'keyword'], [3, 'builtin']]);
  rule(code, paint, new RegExp(`${keywords})${EOW}`, 'gm'), [[2, 'keyword']]);
  rule(code, paint, new RegExp(`[ \\t]in${EOW}`, 'g'), [[0, 'keyword']]);
  if (shell.subshell) rule(code, paint, /\$\(([^)\n]+)/g, [[1, 'sh-quoted-exec', true]]);
  rule(code, paint, /\$(\{#?)?([\p{L}_][\p{L}\p{N}_]*|[-#?@!])/gu, [[2, 'variable-name']]);
  rule(code, paint, new RegExp(`^([${W}]+)[ \\t]*\\(`, 'gmu'), [[1, 'function-name']]);
  rule(code, paint, new RegExp(`${BOW}(function)${EOW}[ \\t]*([${W}]+)?`, 'gu'), [[1, 'keyword'], [2, 'function-name']]);
  rule(code, paint, new RegExp(`(?:^${SPACE}*|[\\[();&|]${SPACE}*|(?:${SPACE}+-[ao]|if|else|then|while|do)${SPACE}+)(!)`, 'gm'), [[1, 'negation-char']]);
  rule(code, paint, /(^|[^\\])(\\\\)*(\\)$/gm, [[3, 'sh-escaped-newline']]);
  rule(code, paint, /\\[^\p{L}\p{N}]/gu, [[0, 'string']]);
  rule(code, paint, /\$\{?([\p{L}_][\p{L}\p{N}_]*|[0-9]+|[$*_])/gu, [[1, 'variable-name']]);
  rule(code, paint, /^#!.*\/([^ \t\n]+)/g, [[1, 'keyword', true]]);
  return paint.runs(code);
}
