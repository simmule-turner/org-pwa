// @ts-check
/**
 * A small syntax colouring for source blocks in HTML export, using the class names Org's `htmlize` output has
 * (`org-keyword`, `org-string`, `org-comment`, `org-constant`, `org-builtin`, `org-type`, `org-function-name`,
 * `org-variable-name`, `org-preprocessor`). It is a lexer, not a parser: comments, strings, numbers, keywords and
 * the like, which is what reads well on paper. Languages it does not know come out uncoloured.
 *
 * highlightToHtml(code, lang) -> HTML, one line per "\n" (a token that spans lines is closed and reopened on each).
 */

/** @param {any} [s] */
const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const C_LIKE = {
  line: ['//'],
  block: [['/*', '*/']],
  strings: ['"', "'"],
  number: true,
};

const LANGS = {
  js: {
    ...C_LIKE,
    strings: ['"', "'", '`'],
    keywords: words('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await from as get set'),
    constants: words('true false null undefined NaN Infinity'),
    builtins: words('console window document Math JSON Object Array String Number Boolean Promise Map Set Date RegExp Error Symbol parseInt parseFloat require module exports fetch setTimeout setInterval'),
    functionAfter: words('function class'),
  },
  python: {
    line: ['#'],
    strings: ['"""', "'''", '"', "'"],
    number: true,
    keywords: words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case'),
    constants: words('True False None'),
    builtins: words('print len range int str float list dict set tuple bool open input sum min max abs sorted enumerate zip map filter isinstance type super self cls'),
    functionAfter: words('def class'),
  },
  sh: {
    line: ['#'],
    strings: ['"', "'"],
    number: false,
    keywords: words('if then else elif fi for while until do done case esac in function select time return exit break continue local export readonly declare unset'),
    constants: words(''),
    builtins: words('echo cd ls pwd cat grep sed awk find mkdir rm cp mv chmod chown touch tar curl wget git source eval exec set shift read printf test sudo make npm node python pip'),
    dollarVariables: true,
  },
  lisp: {
    line: [';'],
    strings: ['"'],
    number: true,
    keywords: words('defun defmacro defvar defcustom defconst defgroup defface defstruct defclass defmethod defgeneric let let* letrec lambda if when unless cond progn setq setf set and or not while dolist dotimes loop condition-case unwind-protect save-excursion save-restriction with-current-buffer require provide use-package define let-values do case begin quote function define-key add-hook ns fn def defn'),
    constants: words('t nil'),
    builtins: words('message format concat car cdr cons list append mapcar mapc funcall apply length nth null eq equal string-match insert goto-char point'),
    lispColon: true,
  },
  css: {
    block: [['/*', '*/']],
    strings: ['"', "'"],
    number: true,
    keywords: words(''),
    constants: words('important inherit initial none auto'),
    builtins: words(''),
    css: true,
  },
  json: {
    strings: ['"'],
    number: true,
    keywords: words(''),
    constants: words('true false null'),
    builtins: words(''),
    jsonKeys: true,
  },
  sql: {
    line: ['--'],
    block: [['/*', '*/']],
    strings: ["'", '"'],
    number: true,
    ignoreCase: true,
    keywords: words('select from where insert into values update set delete create table alter drop index view join inner left right outer on group by order having limit offset union all distinct as and or not in is like between exists case when then else end primary key foreign references default unique check with begin commit rollback'),
    constants: words('null true false'),
    builtins: words('count sum avg min max coalesce cast length lower upper now'),
    typeWords: words('int integer bigint text varchar char boolean date timestamp float double decimal serial'),
  },
  c: {
    ...C_LIKE,
    keywords: words('auto break case const continue default do else enum extern for goto if inline register return sizeof static struct switch typedef union volatile while class public private protected virtual namespace template typename using new delete this try catch throw operator override final interface implements extends import package func go defer chan select range fn let mut pub impl trait use mod match loop where async await dyn move ref'),
    constants: words('true false null NULL nullptr nil None'),
    builtins: words('printf scanf malloc free sizeof std string vector cout cin endl println fmt'),
    typeWords: words('int long short char float double void unsigned signed bool size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t byte string i8 i16 i32 i64 u8 u16 u32 u64 usize isize f32 f64 str String Vec Option Result'),
    preprocessor: true,
  },
  ruby: {
    line: ['#'],
    strings: ['"', "'"],
    number: true,
    keywords: words('alias and begin break case class def defined? do else elsif end ensure for if in module next nil not or redo rescue retry return self super then undef unless until when while yield require include extend attr_accessor attr_reader attr_writer'),
    constants: words('true false nil'),
    builtins: words('puts print p require_relative'),
    functionAfter: words('def class module'),
  },
  yaml: {
    line: ['#'],
    strings: ['"', "'"],
    number: true,
    keywords: words(''),
    constants: words('true false null yes no ~'),
    builtins: words(''),
    yamlKeys: true,
  },
  xml: { xml: true, strings: ['"', "'"] },
};

const ALIASES = {
  javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', node: 'js', mjs: 'js',
  py: 'python', python3: 'python',
  bash: 'sh', shell: 'sh', zsh: 'sh', sh: 'sh', ksh: 'sh',
  'emacs-lisp': 'lisp', elisp: 'lisp', emacs: 'lisp', clojure: 'lisp', clj: 'lisp', scheme: 'lisp', racket: 'lisp', lisp: 'lisp', cl: 'lisp',
  scss: 'css', less: 'css',
  jsonc: 'json',
  postgres: 'sql', mysql: 'sql', sqlite: 'sql', psql: 'sql',
  cpp: 'c', 'c++': 'c', h: 'c', java: 'c', go: 'c', rust: 'c', rs: 'c', cs: 'c', csharp: 'c', kotlin: 'c', swift: 'c', php: 'c', dart: 'c', scala: 'c',
  rb: 'ruby',
  yml: 'yaml',
  html: 'xml', htm: 'xml', svg: 'xml', xhtml: 'xml',
};

/** @param {any} [t] */
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Wraps `text` in a span of the given face, one span per line.
 * @param {any} face
 * @param {string} text
 */
function span(face, text) {
  if (!face) return esc(text);
  return text
    .split('\n')
    .map((/** @type {any} */ part) => (part === '' ? '' : `<span class="org-${face}">${esc(part)}</span>`))
    .join('\n');
}

const NUMBER_RE = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*\.?\d*(?:[eE][-+]?\d+)?[a-zA-Z]*|\.\d+(?:[eE][-+]?\d+)?)/;
const IDENT_RE = /^[A-Za-z_$][\w$]*(?:-[A-Za-z0-9_*!?<>=/+]+)*/;
const IDENT_PLAIN_RE = /^[A-Za-z_$][\w$]*[?!]?/;

/** @param {any} [code] */
function highlightXml(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    if (code.startsWith('<!--', i)) {
      const end = code.indexOf('-->', i + 4);
      const stop = end < 0 ? code.length : end + 3;
      out += span('comment', code.slice(i, stop));
      i = stop;
    } else if (code[i] === '<' && /[A-Za-z/!?]/.test(code[i + 1] || '')) {
      const end = code.indexOf('>', i);
      const stop = end < 0 ? code.length : end + 1;
      const tag = code.slice(i, stop);
      const m = /^<(\/?)([^\s>/]+)([\s\S]*?)(\/?>)$/.exec(tag);
      if (!m) {
        out += esc(tag);
      } else {
        out += span('keyword', '<' + m[1] + m[2]);
        let attrs = m[3];
        let a = 0;
        while (a < attrs.length) {
          const am = /^([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)?/.exec(attrs.slice(a));
          if (am) {
            out += span('variable-name', am[1]) + esc(am[2] || '') + (am[3] ? span('string', am[3]) : '');
            a += am[0].length;
          } else {
            out += esc(attrs[a]);
            a++;
          }
        }
        out += span('keyword', m[4]);
      }
      i = stop;
    } else {
      const next = code.indexOf('<', i + 1);
      const stop = next < 0 ? code.length : next;
      out += esc(code.slice(i, stop));
      i = stop;
    }
  }
  return out;
}

/**
 * @param {any} [code]
 * @param {any} [lang]
 */
export function highlightToHtml(code, lang) {
  const key = /** @type {any} */ (ALIASES)[String(lang || '').toLowerCase()] || String(lang || '').toLowerCase();
  const cfg = /** @type {any} */ (LANGS)[key];
  if (!cfg) return esc(code);
  if (cfg.xml) return highlightXml(code);
  let out = '';
  let i = 0;
  let prevWord = '';
  let lineStart = true;
  const n = code.length;
  while (i < n) {
    const rest = code.slice(i);
    const ch = code[i];
    if (ch === '\n') {
      out += '\n';
      i++;
      lineStart = true;
      continue;
    }
    // comments
    /** @param {any} [c] */
    const line = (cfg.line || []).find((/** @type {any} */ c) => code.startsWith(c, i));
    if (line && !(line === '#' && cfg.preprocessor)) {
      const end = code.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      out += span('comment', code.slice(i, stop));
      i = stop;
      continue;
    }
    const block = (cfg.block || []).find((/** @type {any} */ [open]) => code.startsWith(open, i));
    if (block) {
      const end = code.indexOf(block[1], i + block[0].length);
      const stop = end < 0 ? n : end + block[1].length;
      out += span('comment', code.slice(i, stop));
      i = stop;
      continue;
    }
    if (cfg.preprocessor && ch === '#' && lineStart) {
      const end = code.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      out += span('preprocessor', code.slice(i, stop));
      i = stop;
      continue;
    }
    // strings
    /** @param {any} [q] */
    const quote = (cfg.strings || []).find((/** @type {any} */ q) => code.startsWith(q, i));
    if (quote) {
      let j = i + quote.length;
      while (j < n && !code.startsWith(quote, j)) {
        if (code[j] === '\\') j++;
        else if (quote.length === 1 && code[j] === '\n' && quote !== '`') break;
        j++;
      }
      const stop = Math.min(n, j + quote.length);
      const text = code.slice(i, stop);
      const isKey = (cfg.jsonKeys || cfg.yamlKeys) && /^\s*:/.test(code.slice(stop));
      out += span(isKey ? 'variable-name' : 'string', text);
      i = stop;
      lineStart = false;
      continue;
    }
    if (cfg.dollarVariables && ch === '$') {
      const m = /^\$(?:\{[^}\n]*\}|[A-Za-z_]\w*|[0-9@#?*!$-])/.exec(rest);
      if (m) {
        out += span('variable-name', m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (cfg.css && ch === '@') {
      const m = /^@[\w-]+/.exec(rest);
      if (m) {
        out += span('keyword', m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (cfg.lispColon && ch === ':' && /[A-Za-z]/.test(code[i + 1] || '')) {
      const m = /^:[^\s()"']+/.exec(rest) || [''];
      out += span('constant', m[0]);
      i += m[0].length;
      continue;
    }
    // numbers
    if (cfg.number && /[0-9]/.test(ch) && !/[\w$]/.test(code[i - 1] || '')) {
      const m = NUMBER_RE.exec(rest);
      if (m) {
        out += span('constant', m[0]);
        i += m[0].length;
        lineStart = false;
        continue;
      }
    }
    // words
    const idRe = cfg.lispColon ? IDENT_RE : IDENT_PLAIN_RE;
    const w = (ch === '-' && cfg.css) || /[A-Za-z_$]/.test(ch) ? (cfg.css ? /^-?[A-Za-z_][\w-]*/ : idRe).exec(rest) : null;
    if (w) {
      const word = w[0];
      const lookup = cfg.ignoreCase ? word.toLowerCase() : word;
      /** @type {"builtin" | "constant" | "function-name" | "keyword" | "type" | "variable-name" | null} */
      let face = null;
      if (cfg.keywords && cfg.keywords.has(lookup)) face = 'keyword';
      else if (cfg.constants && cfg.constants.has(lookup)) face = 'constant';
      else if (cfg.typeWords && cfg.typeWords.has(lookup)) face = 'type';
      else if (cfg.builtins && cfg.builtins.has(lookup)) face = 'builtin';
      else if (cfg.functionAfter && cfg.functionAfter.has(prevWord)) face = 'function-name';
      else if (key === 'lisp' && /^\(\s*(?:defun|defmacro|defvar|defcustom|defconst|define|defn|def)\s*$/.test(code.slice(Math.max(0, i - 24), i)) && !/^\W/.test(word)) face = 'function-name';
      else if (cfg.css && /^\s*:/.test(code.slice(i + word.length)) && /\{[^}]*$/.test(code.slice(0, i))) face = 'variable-name';
      else if (cfg.yamlKeys && /^\s*:(\s|$)/.test(code.slice(i + word.length))) face = 'variable-name';
      else if (/^[A-Z][A-Za-z0-9]*$/.test(word) && key !== 'sh' && key !== 'sql' && word.length > 1 && /[a-z]/.test(word)) face = 'type';
      out += span(face, word);
      prevWord = lookup;
      i += word.length;
      lineStart = false;
      continue;
    }
    out += esc(ch);
    if (!/\s/.test(ch)) lineStart = false;
    i++;
  }
  return out;
}
