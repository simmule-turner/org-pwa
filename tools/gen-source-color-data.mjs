// Writes src/source-color-data.js: the word lists Emacs 29.3 colors in emacs-lisp, python, js and java, read from Emacs's own font-lock
// variables (python.el, js.el, elisp-mode / lisp-mode, cc-langs) so nothing is typed from memory. test/source-color.test.js holds the
// highlighter to the faces Emacs gave test/fixtures/source-color/*. Run: node tools/gen-source-color-data.mjs   (needs emacs on the path)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const lisp = `(progn (require 'org) (require 'python) (require 'js) (require 'cc-mode) (require 'cc-langs) (require 'json)
  (let ((print-length nil) (print-level nil) (kw nil) (doc nil) (def nil))
    (mapatoms (lambda (s)
      (when (and (fboundp s) (or (special-form-p s) (and (macrop s) (not (get s 'no-font-lock-keyword))))) (push (symbol-name s) kw))
      (when (get s 'doc-string-elt) (push (cons (symbol-name s) (get s 'doc-string-elt)) doc))
      (when (get s 'lisp-define-type) (push (cons (symbol-name s) (symbol-name (get s 'lisp-define-type))) def))))
    (let* ((el2 lisp-el-font-lock-keywords-2) (defre (car (nth 0 el2)))
           (definers nil))
      (dolist (n (append (mapcar 'car def) kw))
        (when (and (string-match defre (concat "(" n " x")) (equal (match-string 1 (concat "(" n " x")) n)) (push n definers)))
      (princ (json-encode (list :elKeywords (vconcat (sort kw 'string<))
        :elDocElt (vconcat (mapcar (lambda (c) (vector (car c) (if (numberp (cdr c)) (cdr c) -1))) (sort doc (lambda (a b) (string< (car a) (car b))))))
        :elDefiners (vconcat (mapcar (lambda (n) (vector n (or (cdr (assoc n def)) "function"))) (sort (delete-dups definers) 'string<)))
        :javaKeywords (vconcat (c-lang-const c-keywords java))
        :javaPrim (vconcat (c-lang-const c-primitive-type-kwds java))
        :javaConst (vconcat (c-lang-const c-constant-kwds java))
        :javaModifiers (vconcat (c-lang-const c-modifier-kwds java))))))))`;
const raw = JSON.parse(execFileSync('emacs', ['--batch', '-Q', '--eval', lisp], { encoding: 'utf8', maxBuffer: 1 << 26 }));

// The regexps of the font-lock variables of python.el and js.el, read again for the lists they hold (regexp-opt output: groups, [..], |)
const rules = JSON.parse(execFileSync('emacs', ['--batch', '-Q', '--eval', `(progn (require 'python) (require 'js) (require 'json)
  (princ (json-encode (list :py (vconcat (mapcar (lambda (r) (cond ((stringp r) r) ((and (consp r) (stringp (car r))) (car r)) (t ""))) python-font-lock-keywords-maximum-decoration))
     :js (vconcat (mapcar (lambda (r) (cond ((stringp r) r) ((and (consp r) (stringp (car r))) (car r)) (t ""))) js--font-lock-keywords-3))))))`], { encoding: 'utf8', maxBuffer: 1 << 26 }));

/** Every string the regexp-opt output `re` matches (groups, `[..]` classes, `|`, `?`). @param {string} re @returns {string[]} */
function expand(re) {
  let i = 0;
  function alt() {
    const out = [];
    for (;;) {
      out.push(...seq());
      if (re.startsWith('\\|', i)) i += 2;
      else return out;
    }
  }
  function seq() {
    let acc = [''];
    while (i < re.length && !re.startsWith('\\|', i) && !re.startsWith('\\)', i)) {
      let opts;
      if (re.startsWith('\\(?:', i) || re.startsWith('\\(', i)) {
        i += re.startsWith('\\(?:', i) ? 4 : 2;
        opts = alt();
        i += 2; // \)
      } else if (re[i] === '[') {
        const end = re.indexOf(']', i + 1);
        opts = [...re.slice(i + 1, end)];
        i = end + 1;
      } else if (re[i] === '\\') {
        opts = [re[i + 1]];
        i += 2;
      } else {
        opts = [re[i]];
        i++;
      }
      if (re[i] === '?') { opts = ['', ...opts]; i++; }
      acc = acc.flatMap((a) => opts.map((o) => a + o));
    }
    return acc;
  }
  const out = alt();
  return out;
}
/** The words of the one regexp of `list` that contains `marker`, between `\\_<` and `\\_>`. @param {string[]} list @param {RegExp} pick */
function wordsOf(list, pick) {
  const re = list.find((r) => pick.test(r));
  if (!re) throw new Error(`no rule for ${pick}`);
  const body = re.replace(/^\\_<\\\(\?:/, '').replace(/\\\)\\_>$/, '').replace(/^\\_</, '').replace(/\\_>$/, '').replace(/^\\\(/, '').replace(/\\\)$/, '');
  return expand(body).sort();
}

/** @param {any} v an alist as json-encode wrote it: pairs, or already an object */
const asObject = (v) => (Array.isArray(v) ? Object.fromEntries(v) : v);
const py = rules.py;
const pyKeywordRe = py.find((r) => r.startsWith('\\_<\\(?:and\\|'));
const pyKeywords = wordsOf([pyKeywordRe.replace('\\|async[[:space:]]+\\(?:def\\|for\\|with\\)', '')], /^/);
const pyBuiltins = wordsOf(py, /^\\_<\\\(\?:__\\\(/);
const pyConstants = wordsOf(py, /^\\_<\\\(\?:Ellipsis/);
const pyExceptions = wordsOf(py, /^\\_<\\\(\?:A\\\(\?:\\\(\?:rithmetic/);
const jsKeywords = wordsOf(rules.js, /^\\_<\\\(a\\\(\?:bstract\\\|sync/);
const jsTypes = wordsOf(rules.js, /^\\_<\\\(b\\\(\?:oolean\\\|yte/);
const jsConstants = wordsOf(rules.js, /^\\_<\\\(Infinity/);

const noType = new Set([...raw.javaPrim, ...raw.javaConst, '@interface']);
const javaKeywords = raw.javaKeywords.filter((w) => !noType.has(w)).sort();

const lines = [
  '// @ts-check',
  '// Generated by tools/gen-source-color-data.mjs from Emacs 29.3 (python.el, js.el, elisp-mode, cc-langs); do not edit.',
  '',
  '/** @param {string} s */',
  "const words = (s) => new Set(s.split(' '));",
  '',
  `export const EL_KEYWORDS = words(${JSON.stringify(raw.elKeywords.join(' '))});`,
  `/** Where a docstring sits in a form, by its head symbol: the element's index, the head being 0. @type {Record<string, number>} */`,
  `export const EL_DOC_ELT = ${JSON.stringify(Object.fromEntries(raw.elDocElt.filter(([, n]) => n >= 0)))};`,
  `/** The forms that name something: what the name is (a variable, a type, a function). @type {Record<string, string>} */`,
  `export const EL_DEFINERS = ${JSON.stringify(asObject(raw.elDefiners))};`,
  `export const PY_KEYWORDS = words(${JSON.stringify(pyKeywords.join(' '))});`,
  `export const PY_BUILTINS = words(${JSON.stringify(pyBuiltins.join(' '))});`,
  `export const PY_CONSTANTS = words(${JSON.stringify(pyConstants.join(' '))});`,
  `export const PY_EXCEPTIONS = words(${JSON.stringify(pyExceptions.join(' '))});`,
  `export const JS_KEYWORDS = words(${JSON.stringify(jsKeywords.join(' '))});`,
  `export const JS_TYPES = words(${JSON.stringify(jsTypes.join(' '))});`,
  `export const JS_CONSTANTS = words(${JSON.stringify(jsConstants.join(' '))});`,
  `export const JAVA_KEYWORDS = words(${JSON.stringify(javaKeywords.join(' '))});`,
  `export const JAVA_TYPES = words(${JSON.stringify(raw.javaPrim.join(' '))});`,
  `export const JAVA_CONSTANTS = words(${JSON.stringify(raw.javaConst.join(' '))});`,
  `export const JAVA_MODIFIERS = words(${JSON.stringify(raw.javaModifiers.join(' '))});`,
  '',
];
writeFileSync(new URL('../src/source-color-data.js', import.meta.url), lines.join('\n'));
console.log(`elisp ${raw.elKeywords.length} keywords; python ${pyKeywords.length}/${pyBuiltins.length}/${pyConstants.length}/${pyExceptions.length}; js ${jsKeywords.length}/${jsTypes.length}/${jsConstants.length}; java ${javaKeywords.length}`);
