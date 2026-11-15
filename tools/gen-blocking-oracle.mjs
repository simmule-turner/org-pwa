#!/usr/bin/env node
/**
 * Writes test/fixtures/blocking-oracle.json: what Emacs 29.3 does when org-todo is asked to change a state while
 * org-enforce-todo-dependencies and org-enforce-todo-checkbox-dependencies are set (ORDERED and NOBLOCKING properties included):
 * the text it leaves, the message it gives when it refuses, and what org-entry-blocked-p answers.
 *   node tools/gen-blocking-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const trees = {
  'children': '* TODO Parent\n** TODO one\n** DONE two\n',
  'children done': '* TODO Parent\n** DONE one\n** DONE two\n',
  'deep child': '* TODO Parent\n** DONE one\n*** TODO deep\n',
  'child not a task': '* TODO Parent\n** plain\n*** TODO deep\n',
  'child with priority and tags': '* TODO Parent\n** TODO [#A] Fancy title :tag:other:\n',
  'child next': '* TODO Parent\n** NEXT started\n',
  'ordered': '* H\n:PROPERTIES:\n:ORDERED: t\n:END:\n** TODO one\n** TODO two\n** TODO three\n',
  'ordered first done': '* H\n:PROPERTIES:\n:ORDERED: t\n:END:\n** DONE one\n** TODO two\n** TODO three\n',
  'ordered nil': '* H\n:PROPERTIES:\n:ORDERED: nil\n:END:\n** TODO one\n** TODO two\n',
  'ordered with deep earlier': '* H\n:PROPERTIES:\n:ORDERED: t\n:END:\n** DONE one\n*** TODO inner\n** TODO two\n',
  'ordered priority tags': '* H\n:PROPERTIES:\n:ORDERED: t\n:END:\n** TODO [#B] Earlier one :t:\n** TODO two\n',
  'ordered grandparent': '* G\n:PROPERTIES:\n:ORDERED: t\n:END:\n** TODO P1\n** TODO P2\n*** TODO c\n',
  'ordered grandparent, parent not a task': '* G\n:PROPERTIES:\n:ORDERED: t\n:END:\n** TODO P1\n** P2\n*** TODO c\n',
  'ordered grandparent, parent done': '* G\n:PROPERTIES:\n:ORDERED: t\n:END:\n** TODO P1\n** DONE P2\n*** TODO c\n',
  'ordered great-grandparent': '* G\n:PROPERTIES:\n:ORDERED: t\n:END:\n** TODO P1\n** TODO P2\n*** TODO c1\n**** TODO d\n',
  'ordered not inherited': '* G\n:PROPERTIES:\n:ORDERED: t\n:END:\n** Mid\n*** TODO a\n*** TODO b\n',
  'checkboxes': '* TODO T\n- [ ] one\n- [X] two\n',
  'checkboxes checked': '* TODO T\n- [X] one\n- [X] two\n',
  'checkbox partial': '* TODO T\n- [-] one\n  - [X] sub\n  - [ ] sub2\n',
  'checkbox numbered': '* TODO T\n1. [ ] one\n',
  'checkbox counter': '* TODO T\n1. [@3] [ ] one\n',
  'checkbox in child body': '* TODO T\n** child\n- [ ] one\n',
  'checkbox text': '* TODO T\nplain [ ] text\n',
  'checkbox in src': '* TODO T\n#+begin_src sh\n- [ ] x\n#+end_src\n',
  'both': '* TODO T\n- [ ] one\n** TODO c\n',
  'noblocking': '* TODO T\n:PROPERTIES:\n:NOBLOCKING: t\n:END:\n** TODO c\n- [ ] one\n',
  'noblocking nil': '* TODO T\n:PROPERTIES:\n:NOBLOCKING: nil\n:END:\n** TODO c\n',
  'noblocking empty': '* TODO T\n:PROPERTIES:\n:NOBLOCKING:\n:END:\n** TODO c\n',
  'no state': '* Parent\n** TODO one\n',
  'already done': '* DONE Parent\n** TODO one\n',
  'sibling is a parent': '* H\n:PROPERTIES:\n:ORDERED: t\n:END:\n** TODO a\n*** DONE a1\n** TODO b\n',
  'no parent': '* TODO alone\n',
};
const varSets = [
  { deps: false, boxes: false },
  { deps: true, boxes: false },
  { deps: false, boxes: true },
  { deps: true, boxes: true },
];
const keywordLines = ['', '#+TODO: TODO NEXT | DONE CANC\n'];
const targets = ['DONE', 'CANC', 'NEXT', 'TODO', 'none'];
const cases = [];
for (const [name, org] of Object.entries(trees)) {
  const titles = [...org.matchAll(/^\*+ (?:(?:TODO|DONE|NEXT) )?(?:\[#.\] )?(.*?)(?: +:[\w:]+:)?$/gm)].map((m) => m[1]).filter((t, i, a) => t && a.indexOf(t) === i);
  for (const find of titles) {
    for (const vars of varSets) {
      for (const kl of keywordLines) {
        for (const to of targets) {
          if (kl === '' && (to === 'CANC' || to === 'NEXT') && !org.includes('NEXT')) continue;
          cases.push({ name, org: kl + org, find, vars, to });
        }
      }
    }
  }
}
const el = `
(require 'org) (require 'cl-lib) (require 'json)
(setq org-todo-keywords '((sequence "TODO" "|" "DONE")))
(defun run-case (c)
  (let* ((vars (cdr (assq 'vars c))) (to (cdr (assq 'to c))) (msgs nil))
    (customize-set-variable 'org-enforce-todo-dependencies (eq (cdr (assq 'deps vars)) t))
    (customize-set-variable 'org-enforce-todo-checkbox-dependencies (eq (cdr (assq 'boxes vars)) t))
    (with-temp-buffer
      (insert (cdr (assq 'org c))) (org-mode) (goto-char (point-min))
      (setq case-fold-search nil)
      (re-search-forward (concat "^\\\\*+ \\\\(?:\\\\(?:TODO\\\\|DONE\\\\|NEXT\\\\) \\\\)?\\\\(?:\\\\[#.\\\\] \\\\)?" (regexp-quote (cdr (assq 'find c)))))
      (beginning-of-line)
      (let ((blocked (org-entry-blocked-p)))
        (cl-letf (((symbol-function 'message) (lambda (fmt &rest args) (push (apply #'format fmt args) msgs))))
          (condition-case e (org-todo (if (equal to "none") 'none to)) (error (push (concat "ERROR " (error-message-string e)) msgs))))
        (list (cons 'text (buffer-string)) (cons 'blockedp (if blocked t :json-false))
              (cons 'msg (or (cl-find-if (lambda (m) (string-match-p "blocked\\\\|ERROR" m)) msgs) :null)))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (json-key-type 'symbol)
         (in (json-read-from-string (buffer-string))) (out nil))
    (dolist (c in) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blockorc-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', maxBuffer: 1 << 28 });
if (r.status !== 0) { console.error(r.stderr.slice(-3000)); process.exit(1); }
const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync(new URL('../test/fixtures/blocking-oracle.json', import.meta.url), JSON.stringify({ emacs: '29.3', cases: cases.map((c, i) => ({ ...c, emacs: results[i] })) }) + '\n');
console.log(`${cases.length} cases, ${results.filter((x) => x.msg).length} refused`);
