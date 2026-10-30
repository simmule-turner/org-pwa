// Known deviations of the Lisp interpreter from Emacs 29.3 (tools/oracle-lisp-settings-cases.mjs). Each rule says which expressions it covers and why
// the interpreter answers differently. test/oracle-lisp-settings.test.js fails when a covered expression starts to agree with Emacs, so a rule
// never outlives its deviation.

/** @typedef {{ reason: string, chosen: boolean, match: RegExp }} Known */

/** @type {Known[]} */
export const KNOWN = [
  { chosen: false, reason: 'Strings are values here, so `eql` on two equal strings is true; Emacs compares the string objects.', match: /^\(let \(\(l \(list "a"\)\)\) \(cl-pushnew "a" l\) l\)$|^\(cl-case "a" \("a" 1\)/ },
  { chosen: false, reason: 'The last digit of `atan` with two arguments and of `expt` with a negative exponent differs between the JavaScript engine and the C library.', match: /^\((atan -3 -2|atan 2\.5 3|atan -2\.5 3|expt 7 -2)\)$/ },
  { chosen: true, reason: 'Every feature counts as loaded, so the body of `with-eval-after-load` / `eval-after-load` runs at once (Emacs waits for the feature).', match: /^\((with-eval-after-load|eval-after-load) \(quote zz-feat/ },
  { chosen: true, reason: '`special-variable-p` is true only for variables the app defines, not for every Emacs built-in variable such as `load-path`.', match: /^\(special-variable-p \(quote load-path\)\)$/ },
  { chosen: true, reason: 'A `cl-case` clause keyed by `nil` makes Emacs print a compiler warning; the interpreter stays silent.', match: /^\(cl-case nil \(nil 1\) \(t 2\)\)$/ },
  { chosen: false, reason: '`(lambda)` with no parameter list: Emacs makes an empty closure, the interpreter signals an error.', match: /^\(condition-case e \(lambda\) \(error e\)\)$/ },
  { chosen: false, reason: 'Read syntax `#s(...)` records, `#&N"..."` bool-vectors, `#N=` labels, `#("..." props)` strings and `?\\N{NAME}` characters is not supported, nor are bool-vectors.', match: /#s\(|#&|#1=|'#\(\\"abc|\\N\{|make-bool-vector/ },
  { chosen: false, reason: 'A group repeated over an empty match (`\\(a*\\)*`) keeps its last non-empty match in JavaScript; Emacs lets an empty iteration set it.', match: /string-match "\\\\\(a\*\\\\\)[*+]"/ },
  { chosen: false, reason: 'A back-reference to a group that did not take part in the match matches the empty string in JavaScript; in Emacs it fails.', match: /string-match "\\\\\(\\\\\(a\\\\\)\\\\\|b\\\\\)\\\\2"/ },
  { chosen: false, reason: 'With case folding JavaScript treats the Kelvin sign and the long s as `k` and `s`, so `[[:nonascii:]]` also matches those ASCII letters.', match: /string-match "\[\[:(nonascii|multibyte):\]\]"/ },
  { chosen: false, reason: 'There are no buffers: `match-string` after a search in a temporary buffer cannot signal the buffer range error.', match: /^\(match-string 0\)$/ },
];
