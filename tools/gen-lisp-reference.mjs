#!/usr/bin/env node
/**
 * The "Lisp functions" reference of README.org, generated from the Lisp interpreter's symbol table.
 *
 *   node tools/gen-lisp-reference.mjs           prints the section's text
 *   node tools/gen-lisp-reference.mjs --write   puts it into README.org between the `# BEGIN lisp-reference` and `# END lisp-reference` lines
 *
 * Every function-bound symbol the app's Lisp has (functions, special forms, macros) is listed under the group NAMES gives it. A name that
 * is in no group lands in "other", and test/lisp-reference.test.js fails until it is classified here. Names with `--` are the
 * interpreter's own helpers and are not listed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The modules of the app that define Lisp functions, found by reading the source, and which of them the app (app.js) reaches. */
export function definingModules() {
  const defines = /\b(?:defun|defSpecial|defAlias|defineLispFunction)\(/;
  const files = fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.js') && f !== 'elisp-core.js' && f !== 'elisp-data.js');
  const defining = files.filter((f) => defines.test(fs.readFileSync(path.join(root, 'src', f), 'utf8'))).map((f) => `src/${f}`);
  /** @type {Set<string>} */
  const reached = new Set();
  /** @param {string} file */
  const visit = (file) => {
    if (reached.has(file) || !fs.existsSync(path.join(root, file))) return;
    reached.add(file);
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const m of text.matchAll(/(?:from\s+|import\s*\(?\s*|import\s+)'(\.[^']+\.js)'/g)) visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
  };
  visit('app.js');
  return { defining, unreached: defining.filter((f) => !reached.has(f)) };
}

/** Loads the interpreter with every module that defines functions, as the app has them at run time. */
async function loadInterpreter() {
  await import(pathToFileURL(path.join(root, 'src/elisp.js')).href);
  for (const f of definingModules().defining) await import(pathToFileURL(path.join(root, f)).href);
  return import(pathToFileURL(path.join(root, 'src/elisp-data.js')).href);
}

/** The groups, in README order: a title, the one-line intro, an optional note on where the group differs from Emacs, and the names. */
export const GROUPS = [
  {
    id: 'control', title: 'Control and binding',
    intro: 'Special forms and macros for choosing, looping, binding and quitting early.',
    note: 'Code runs with lexical binding.',
    names: 'and or if when unless cond while progn prog1 prog2 let let* letrec setq setq-default setq-local pop push catch throw unwind-protect dolist dotimes quote function lambda ` if-let if-let* when-let when-let* and-let* let-alist thread-first thread-last pcase pcase-let pcase-let* pcase-dolist seq-let setf setopt save-excursion save-restriction save-match-data with-output-to-string macroexp-progn',
  },
  {
    id: 'numbers', title: 'Numbers and math',
    intro: 'Integers of any size up to 65536 bits, floats, bitwise operations and the usual functions.',
    names: '+ - * / % mod 1+ 1- = /= < <= > >= abs max min float truncate floor ceiling round ffloor fceiling fround ftruncate sqrt exp expt log sin cos tan asin acos atan isnan copysign ldexp logb logand logior logxor lognot ash lsh random zerop natnump wholenump numberp integerp floatp fixnump bignump number-or-marker-p integer-or-marker-p number-to-string number-sequence',
  },
  {
    id: 'lists', title: 'Lists',
    intro: 'Conses, association lists and property lists.',
    names: 'cons car cdr car-safe cdr-safe caar cadr cdar cddr caaar caadr cadar caddr cdaar cdadr cddar cdddr cadddr nth nthcdr last butlast nbutlast take ntake list safe-length proper-list-p append nconc copy-tree copy-alist flatten-tree ensure-list setcar setcdr member memq memql assoc assq rassoc rassq assoc-default assoc-delete-all assq-delete-all alist-get delq delete remove remq delete-dups delete-consecutive-dups plist-get plist-put plist-member make-list consp listp nlistp atom null not',
  },
  {
    id: 'sequences', title: 'Sequences and vectors',
    intro: 'Functions that take a list, vector or string alike.',
    names: 'vector make-vector vconcat aref aset elt fillarray vectorp arrayp sequencep length length< length= length> reverse nreverse copy-sequence sort mapcar mapc mapcan mapconcat seq-concatenate seq-contains-p seq-count seq-difference seq-do seq-do-indexed seq-doseq seq-drop seq-drop-while seq-elt seq-empty-p seq-every-p seq-filter seq-find seq-first seq-group-by seq-intersection seq-into seq-keep seq-length seq-map seq-map-indexed seq-mapcat seq-mapn seq-max seq-min seq-partition seq-position seq-positions seq-reduce seq-remove seq-remove-at-position seq-rest seq-reverse seq-set-equal-p seq-some seq-sort seq-sort-by seq-split seq-subseq seq-take seq-take-while seq-union seq-uniq',
  },
  {
    id: 'bool-vectors', title: 'Bool-vectors',
    intro: 'Fixed-length vectors of bits, printed as ~#&5"\\31"~ and read back from that syntax.',
    note: 'A bool-vector of more than 134 million bits is refused with ~Memory exhausted~.',
    names: 'make-bool-vector bool-vector bool-vector-p bool-vector-union bool-vector-intersection bool-vector-exclusive-or bool-vector-set-difference bool-vector-not bool-vector-subsetp bool-vector-count-population bool-vector-count-consecutive',
  },
  {
    id: 'strings', title: 'Strings and characters',
    intro: 'Building, comparing, trimming and converting text.',
    note: '~substring-no-properties~ is ~substring~.',
    names: 'concat string make-string substring substring-no-properties string-to-char char-to-string string-to-list string-to-vector string-to-number string-join string-reverse string-pad string-width string-limit string-lines string-trim string-trim-left string-trim-right string-clean-whitespace string-chop-newline string-remove-prefix string-remove-suffix string-prefix-p string-suffix-p string-empty-p string-blank-p string-search string-replace string-distance string-version-lessp string= string-equal string< string-lessp string> string-greaterp compare-strings assoc-string char-equal upcase downcase capitalize upcase-initials truncate-string-to-width split-string stringp characterp',
  },
  {
    id: 'regexps', title: 'Regexps and searching',
    intro: 'Emacs regexp syntax on strings, with the match data kept for ~match-string~ and ~replace-match~.',
    note: 'The matching runs on the browser\'s regexp engine; a pattern that would backtrack without end signals ~Stack overflow in regexp matcher~.',
    names: 'string-match string-match-p match-data match-beginning match-end match-string match-string-no-properties set-match-data replace-match replace-regexp-in-string match-substitute-replacement regexp-quote regexp-opt regexp-opt-charset regexp-opt-depth regexp-opt-group',
  },
  {
    id: 'hash-tables', title: 'Hash tables',
    intro: 'Tables with ~eq~, ~eql~ or ~equal~ keys.',
    names: 'make-hash-table gethash puthash remhash clrhash maphash hash-table-p hash-table-count hash-table-keys hash-table-values copy-hash-table',
  },
  {
    id: 'symbols', title: 'Symbols and functions',
    intro: 'Defining and calling functions, symbols, variables, features, equality and type tests.',
    note: '~require~, ~provide~ and ~featurep~ treat every feature as loaded, so ~eval-after-load~ and ~with-eval-after-load~ run their body at once.',
    names: 'defun defmacro defalias defvar defvar-local defconst defcustom defgroup declare declare-function interactive funcall apply eval macroexpand macroexpand-1 macroexpand-all func-arity fset functionp fboundp fmakunbound symbol-function symbol-name symbol-value symbol-plist symbolp keywordp booleanp boundp makunbound set default-value special-variable-p make-variable-buffer-local get put intern intern-soft make-symbol gensym eq eql equal type-of identity ignore always add-hook remove-hook add-to-list require provide featurep eval-after-load with-eval-after-load eval-and-compile eval-when-compile',
  },
  {
    id: 'buffer', title: 'Text buffers',
    intro: 'A buffer of text with point, narrowing, motion, insertion, deletion and searching, for ~:prepare-finalize~ and target functions, and for code of your own inside ~with-temp-buffer~.',
    note: 'Positions count characters from 1. ~save-excursion~ and ~save-restriction~ keep point and the narrowing.',
    names: 'backward-char beginning-of-line bobp bolp buffer-live-p buffer-size buffer-string buffer-substring buffer-substring-no-properties bufferp char-after char-before count-lines current-buffer delete-char delete-region end-of-line eobp eolp erase-buffer flush-lines following-char forward-char forward-line goto-char how-many keep-lines line-beginning-position line-end-position line-number-at-pos looking-at looking-at-p looking-back narrow-to-region point point-max point-min pos-bol pos-eol preceding-char re-search-backward re-search-forward replace-regexp-in-region replace-string-in-region search-backward search-forward set-buffer skip-chars-backward skip-chars-forward widen with-current-buffer with-temp-buffer',
  },
  {
    id: 'errors', title: 'Errors and conditions',
    intro: 'Signaling, catching and describing errors.',
    names: 'signal error user-error define-error condition-case condition-case-unless-debug ignore-errors ignore-error with-demoted-errors error-message-string',
  },
  {
    id: 'time', title: 'Time and dates',
    intro: 'Time values as numbers, ~(HIGH LOW)~ lists or ~(TICKS . HZ)~ pairs.',
    note: 'A zone is nil (the device\'s), ~t~ (UTC) or a number of seconds east of UTC.',
    names: 'current-time float-time decode-time encode-time format-time-string',
  },
  {
    id: 'output', title: 'Formatting and output',
    intro: 'Building text with ~format~, printing it and reading Lisp text back.',
    note: '~message~ lines go to the status line, and ~princ~, ~print~ and ~insert~ write to the output a block or command returns.',
    names: 'format format-message message prin1 princ print terpri write-char insert prin1-to-string read read-from-string',
  },
  {
    id: 'org', title: 'Org functions',
    intro: 'The read-only Org functions an agenda setting, skip function or capture template may call.',
    note: 'They work on the entry being processed, as when Emacs runs them with the cursor on a heading.',
    names: 'org-agenda-skip-entry-if org-agenda-skip-if org-agenda-skip-subtree-if org-entry-get org-entry-get-with-inheritance org-entry-is-done-p org-entry-is-todo-p org-get-category org-get-heading org-get-tags org-get-todo-state org-link-escape org-link-make-string org-outline-level orgtbl-ascii-draw',
  },
  {
    id: 'calendar', title: 'Calendar, diary and holiday functions',
    intro: 'Calendar arithmetic, the holiday functions of ~calendar-holidays~ and the diary sexp functions of ~%%(...)~ entries.',
    note: 'A holiday entry is evaluated for the month shown, with ~displayed-month~ and ~displayed-year~ bound. ~org-xx-dst-date~, ~org-weather~ and ~today-p~ are this app\'s own.',
    prefixes: ['calendar-', 'diary-', 'holiday-', 'solar-'],
    names: 'org-anniversary org-block org-class org-cyclic org-date org-weather org-xx-dst-date today-p',
  },
  {
    id: 'cl', title: 'cl-lib',
    intro: 'The common cl-lib functions and macros, including ~cl-loop~ with its usual clauses.',
    prefixes: ['cl-'],
    names: 'cl-assert',
  },
];

/** The text of a group's "other" fallback. */
export const OTHER = { id: 'other', title: 'Other', intro: 'Functions not classified yet.', names: '' };

/** The names this app adds to Emacs's: marked "(own)" in the reference. */
export const OWN = new Set(['org-weather', 'org-xx-dst-date', 'today-p']);

/** @returns {Map<string, string>} name to group id */
function groupIndex() {
  /** @type {Map<string, string>} */
  const index = new Map();
  for (const g of GROUPS) for (const n of g.names.split(/\s+/).filter(Boolean)) if (!index.has(n)) index.set(n, g.id);
  return index;
}

/** The group a name belongs to: its explicit entry, else a prefix rule, else "other". @param {string} name */
export function groupOf(name) {
  const explicit = groupIndex().get(name);
  if (explicit) return explicit;
  for (const g of GROUPS) if (g.prefixes?.some((p) => name.startsWith(p))) return g.id;
  return OTHER.id;
}

/** Every Emacs-visible, function-bound symbol of the interpreter, sorted. @returns {Promise<string[]>} */
export async function lispNames() {
  const { allSymbols } = await loadInterpreter();
  return /** @type {{ name: string, fn: unknown }[]} */ (allSymbols())
    .filter((s) => s.fn !== undefined && s.fn !== null && s.fn !== s && !s.name.includes('--'))
    .map((s) => s.name)
    .sort();
}

/** The generated text. @param {string[]} names */
export function render(names) {
  /** @type {Map<string, string[]>} */
  const byGroup = new Map();
  for (const n of names) {
    const id = groupOf(n);
    byGroup.set(id, [...(byGroup.get(id) ?? []), n]);
  }
  const out = [];
  for (const g of [...GROUPS, OTHER]) {
    const list = byGroup.get(g.id);
    if (!list) continue;
    out.push(`*${g.title}* (${list.length}): ${g.intro}${g.note ? ` ${g.note}` : ''}`, '', list.map((n) => `~${n}~${OWN.has(n) ? ' (own)' : ''}`).join(' '), '');
  }
  return out.join('\n').trimEnd();
}

/** The README text with the generated section put between its markers. @param {string} readme @param {string} text */
export function splice(readme, text) {
  const begin = readme.indexOf('# BEGIN lisp-reference\n');
  const end = readme.indexOf('# END lisp-reference');
  if (begin < 0 || end < begin) throw new Error('README.org has no # BEGIN lisp-reference / # END lisp-reference lines');
  return `${readme.slice(0, begin)}# BEGIN lisp-reference\n${text}\n${readme.slice(end)}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = await lispNames();
  const text = render(names);
  if (process.argv.includes('--write')) {
    const file = path.join(root, 'README.org');
    fs.writeFileSync(file, splice(fs.readFileSync(file, 'utf8'), text));
    console.log(`README.org: ${names.length} names in ${new Set(names.map(groupOf)).size} groups`);
  } else console.log(text);
}
