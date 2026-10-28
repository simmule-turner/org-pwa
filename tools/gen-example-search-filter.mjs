#!/usr/bin/env node
/**
 * Writes examples/search-filter.org: one sample outline, and for each query the headings Emacs 29.3 finds (org-search-view for
 * keyword and regexp queries, org-tags-view for the Match query a filter stands for) and the lines query-replace-regexp changes.
 * test/example-search-filter.test.js holds the app to them.
 *   node tools/gen-example-search-filter.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SAMPLE = `#+TODO: TODO WAITING | DONE
#+CATEGORY: sample
* TODO [#A] Buy a computer :shopping:work:
:PROPERTIES:
:assignee: Bob
:END:
Needs wifi, no ethernet port. Budget 800.
* WAITING Fix the wifi router :home:urgent:
:PROPERTIES:
:assignee: Alice
:END:
The vendor's colour chart is wrong. Call on Tuesday.
* DONE Buy a colour printer :shopping:
Bought with ethernet and wifi.
* Plan the quarter :work:
** TODO [#B] Fix the budget :urgent:
:PROPERTIES:
:assignee: Bob
:END:
Review the Q4 plan.
** Colour palette for slides
Colors are checked.
* Notes (a) :home:
Version 2.1 (draft) {final} aa
`;

/** Queries for the Keyword search view; the second kind is a {regexp}. */
export const KEYWORD = ['wifi', '+wifi -ethernet', '+wifi +ethernet', '+"colour chart"', 'colour chart', '+budget -{Q4}', '*+fix', '!fix', ':+color +colors', '{wi.?fi}'];
export const REGEXP = ['^\\*+ \\(TODO\\|DONE\\)', '^colou?r', '\\(Buy\\|Fix\\)', '\\<ca', '\\(a\\)\\1', '[[:digit:]]+', '(draft)', '{final}', 'a\\{2\\}', 'a\\{3,\\}', '\\bwi', 'ETHERNET', '\\_<port\\_>'];
/** [filter query, the Match query it stands for] */
export const FILTERS = [
  ['tag:urgent', 'urgent'],
  ['-tag:work', '-work'],
  ['tag:work todo:TODO', 'work/TODO'],
  ['todo:WAITING', '/WAITING'],
  ['todo:TODO|WAITING', '/TODO|WAITING'],
  ['-todo:DONE', '/-DONE'],
  ['priority:A', 'PRIORITY="A"'],
  ['assignee:Bob', 'assignee={Bob}'],
  ['assignee:Bob|Alice', 'assignee={Bob\\|Alice}'],
  ['-assignee:Bob', 'assignee<>"Bob"'],
];
/** [search, replacement in Emacs notation, regexp?] */
export const REPLACES = [
  ['wifi', 'Wi-Fi', false],
  ['Fix the \\(.*\\)$', 'Repair the \\1', true],
  ['\\([0-9]+\\)\\.\\([0-9]+\\)', '\\2.\\1', true],
  ['colour', 'color', false],
];

const el = `
(require 'org-agenda) (require 'json)
(setq org-agenda-window-setup 'current-window org-agenda-sticky nil)
(defun sample-file () (expand-file-name "sample.org" (getenv "SF_DIR")))
(defun rows ()
  (let (r)
    (with-current-buffer org-agenda-buffer-name
      (save-excursion
        (goto-char (point-min))
        (while (not (eobp))
          (let ((m (get-text-property (point) 'org-hd-marker)))
            (when m (push (with-current-buffer (marker-buffer m) (save-excursion (goto-char m) (line-number-at-pos))) r)))
          (forward-line 1))))
    (sort (delete-dups r) #'<)))
(defun run-view (kind query)
  (let* ((org-agenda-files (list (sample-file))) (inhibit-message t) (inhibit-read-only t))
    (when (get-buffer "*Org Agenda*") (kill-buffer "*Org Agenda*"))
    (condition-case err
        (progn (if (equal kind "search") (org-search-view nil query) (org-tags-view nil query))
               (list (cons 'rows (vconcat (rows)))))
      (error (list (cons 'error (error-message-string err)))))))
(defun run-regex (re)
  (with-temp-buffer
    (insert-file-contents (sample-file)) (org-mode)
    (let ((case-fold-search t) r)
      (condition-case err
          (progn
            (org-map-entries
             (lambda ()
               (let ((text (buffer-substring (point) (save-excursion (outline-next-heading) (point)))))
                 (when (string-match-p re text) (push (line-number-at-pos) r)))))
            (list (cons 'rows (vconcat (nreverse r)))))
        (error (list (cons 'error (error-message-string err))))))))
(defun run-replace (from to regexp)
  (with-temp-buffer
    (insert-file-contents (sample-file)) (org-mode)
    (goto-char (point-min))
    (let ((inhibit-message t)) (perform-replace from to nil (eq regexp t) nil))
    (buffer-string)))
(let* ((cs (json-parse-string (getenv "SF_CASES") :object-type 'alist :array-type 'list :false-object nil))
       (out (mapcar (lambda (c)
                      (let ((k (alist-get 'kind c)))
                        (cond ((equal k "regex") (run-regex (alist-get 'query c)))
                              ((equal k "replace")
                            (list (cons 'text (run-replace (alist-get 'from c) (alist-get 'to c) (alist-get 'regexp c)))))
                              (t (run-view k (alist-get 'query c))))))
                    cs)))
  (with-temp-file (getenv "SF_OUT") (insert (json-encode (vconcat out)))))
`;

/** Runs the cases in Emacs. @param {object[]} cases */
export function runCases(cases) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ex-search-'));
  fs.writeFileSync(path.join(dir, 'sample.org'), SAMPLE);
  fs.writeFileSync(path.join(dir, 'run.el'), el);
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, TZ: 'America/New_York', SF_DIR: dir, SF_CASES: JSON.stringify(cases), SF_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
}

if (process.argv[1] && new URL(import.meta.url).pathname === path.resolve(process.argv[1])) {
  const lines = SAMPLE.split('\n');
  const title = (/** @type {number} */ n) => lines[n - 1].replace(/^\*+ (?:(?:TODO|WAITING|DONE) )?(?:\[#.\] )?/, '').replace(/\s+:[\w:]+:$/, '');
  const names = (/** @type {{ rows?: number[], error?: string }} */ r) => (r.error ? 'error: ' + r.error : (r.rows || []).map(title).join('; ') || '(none)');
  const cases = [
    ...KEYWORD.map((q) => ({ kind: 'search', query: q })),
    ...REGEXP.map((q) => ({ kind: 'regex', query: q })),
    ...FILTERS.map(([, m]) => ({ kind: 'match', query: m })),
    ...REPLACES.map(([from, to, regexp]) => ({ kind: 'replace', from, to, regexp })),
  ];
  const res = runCases(cases);
  let i = 0;
  const escape = (/** @type {string} */ s) => s.replace(/^(\*|#\+)/gm, ',$1');
  let out = `#+TITLE: Search and replace
#+STARTUP: showall

One outline, searched in four ways. The tables list what Emacs 29.3 (Org 9.6.15) finds in it, in file order, and the app finds the same. Try each in *Search*. For queries by tag, state and property, see =match-queries.org=.

The outline:
#+BEGIN_SRC org
${escape(SAMPLE.trimEnd())}
#+END_SRC

* Keyword search
=org-search-view= (*Search → Keyword search*) takes words, ="phrases"=, =+word= and =-word=, and a regular expression in braces. A word looks at the heading, its tags, properties and text, but not at its sub-headings. A string that starts with a word is one phrase; one that starts with =+= or =-= is a list of words that must (or must not) be there. A leading =*= limits it to headings, =!= to TODO headings, and =:= to whole words.

`;
  for (const q of KEYWORD) out += `- =${q}= :: ${names(res[i++])}\n`;
  out += `
* Regular expressions
In regex mode a pattern is in Emacs's syntax and is matched against each entry (its heading line, planning, drawers and text, as =string-match= would see it): =\\(= =\\)= group, =\\|= chooses, =\\{n,m\\}= repeats, and a bare =(=, =)=, ={= or =}= is itself. Case is ignored.

`;
  for (const q of REGEXP) out += `- =${q}= :: ${names(res[i++])}\n`;
  out += `
* Filters
A query of =tag:=, =todo:=, =priority:= and =key:value= filters stands for a Match query (the text after "as"), and finds the same headings. Tags are inherited, properties are not. A =key:value= matches when the value contains the text.

`;
  for (const [f, m] of FILTERS) out += `- =${f}= as =${m}= :: ${names(res[i++])}\n`;
  out += `
* Replace
*Replace* in the options popover starts a query-replace of the search text. In the lines below, a minus is the line before and a plus the line after replacing every match; the other lines of the outline stay as they are. A regexp replacement refers to a group as =\\1= in Emacs.

`;
  for (const [from, to, regexp] of REPLACES) {
    const after = res[i++].text.split('\n');
    out += `Replace ${regexp ? 'the regexp' : 'the text'} =${from}= with =${to}=:\n#+BEGIN_SRC org\n`;
    lines.forEach((l, n) => {
      if (l !== after[n]) out += `${escape('- ' + l)}\n${escape('+ ' + after[n])}\n`;
    });
    out += '#+END_SRC\n\n';
  }
  out += `* Where the app differs from Emacs
- *Where it replaces*: Emacs changes any text; the app leaves tags, TODO states, priorities, properties, planning and blocks alone (see the README).
`;
  fs.writeFileSync(new URL('../examples/search-filter.org', import.meta.url), out.replace(/\n+$/, '\n'));
  console.log('wrote examples/search-filter.org');
}
