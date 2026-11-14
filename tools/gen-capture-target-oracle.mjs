#!/usr/bin/env node
/**
 * Writes test/fixtures/capture-target-oracle.json: the file Emacs's org-capture leaves after filing an already-expanded template
 * at a (file+regexp), (id) or (clock) target, with and without :prepend.
 *   node tools/gen-capture-target-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cases = [];
const TEXT = {
  entry: '* NEW',
  item: 'NEWITEM',
  checkitem: 'NEWCHECK',
  'table-line': '| a | b |',
  plain: 'PLAIN',
};
const DOC = '* A\ntext a\n** A1\n- x\n- y\n** A2\n* Marker line\n:PROPERTIES:\n:ID: id-1\n:END:\nbody\nmore\n* B\n- z\n| t | u |\n';
const DOC2 = '- first\n* A\n:PROPERTIES:\n:ID: id-2\n:END:\n** Sub\n* B\n';
for (const prepend of [false, true]) {
  for (const type of Object.keys(TEXT)) {
    for (const re of ['^\\* A$', '^\\*\\* A1', '^body', '^- x', 'mor', 'bo', '^| t', '^\\* B$', 'Marker', 'nomatch', 'text a']) {
      cases.push({ kind: 'regexp', arg: re, type, prepend, init: DOC });
    }
    cases.push({ kind: 'regexp', arg: '^\\* A$', type, prepend, init: DOC2 });
    for (const id of ['id-1', 'id-2', 'nope']) cases.push({ kind: 'id', arg: id, type, prepend, init: id === 'id-2' ? DOC2 : DOC });
    cases.push({ kind: 'clock', arg: 'Marker line', type, prepend, init: DOC });
    cases.push({ kind: 'clock', arg: '', type, prepend, init: DOC });
  }
}
// a (file+regexp) that finds an item of a nested list files into that list
for (const type of ['item', 'checkitem']) {
  for (const [init, re] of [
    ['* A\n- skip\n  - here\n- skip\n', 'here'],
    ['* A\n- skip\n  - here\n- skip\n', '^- skip'],
    ['* A\n- a\n  - b\n    - c here\n  - d\n- e\n', 'c here'],
    ['* A\n- a\n  - b\n    - c here\n  - d\n- e\n', '- b'],
    ['* A\n- a\n  - b here\n    more\n  - d\n    text\n- e\n', 'b here'],
    ['intro\n- a\n  - here\n', 'here'],
  ]) cases.push({ kind: 'regexp', arg: re, type, prepend: false, init });
}
cases.push({ kind: 'regexp', arg: 'here', type: 'item', prepend: false, init: '* A\n- skip\n  - here\n- skip\n', template: '- X\n  Line 2' });
cases.push({ kind: 'regexp', arg: 'here', type: 'item', prepend: false, init: '* A\n- skip\n  - here\n- skip\n', template: 'X\nLine 2' });
// %^{Name}p asks for a property and sets it on the entry the placeholder is in
const PROPS = [
  ['entry', '* TODO task %^{Effort}p', ['2h']],
  ['entry', '* TODO task\nbody %^{Effort}p more', ['2h']],
  ['entry', '* TODO task\n:PROPERTIES:\n:ID: x\n:END:\n%^{Foo}p', ['bar']],
  ['entry', '* TODO task\n:PROPERTIES:\n:Foo: old\n:ID: x\n:END:\n%^{Foo}p', ['bar']],
  ['entry', '* TODO task\nSCHEDULED: <2026-01-01 Thu>\n%^{Foo}p', ['bar']],
  ['entry', '* T %^{A}p %^{B}p', ['1', '2']],
  ['entry', '* T %^{A|dflt|x|y}p', ['1']],
  ['entry', '* T %^{A|dflt}p', ['']],
  ['entry', '* T %^{A}p', ['']],
  ['entry', '* T\n** U %^{A}p\n%^{B}p', ['1', '2']],
  ['plain', 'text %^{Foo}p', ['bar']],
  ['plain', '#+TITLE: x\ntext %^{Foo}p', ['bar']],
  ['item', '- item %^{Foo}p', ['bar']],
  ['checkitem', '- [ ] item %^{Foo}p', ['bar']],
];
for (const [type, template, answers] of PROPS) cases.push({ kind: 'prop', arg: '', type, prepend: false, init: '* A\n** A1\n* B\n', template, answers });
// C-0 C-c c: the cursor is the place (point is at the end of `search`, moved by `offset`)
const HERE = '* A\ntext a\nmore a\n- x\n- y\n** A1\nbody 1\n* B\n';
for (const type of Object.keys(TEXT)) {
  for (const [search, offset] of [['more', 0], ['text a', -3], ['* A', 0], ['body 1', 0], ['- x', 0], ['text a', 0], ['* B', 0], ['- y', -1]]) {
    cases.push({ kind: 'here', arg: JSON.stringify({ search, offset }), type, prepend: false, init: HERE });
  }
  cases.push({ kind: 'here', arg: JSON.stringify({ search: 'intro', offset: 0 }), type, prepend: false, init: 'intro\n* A\n' });
  cases.push({ kind: 'here', arg: JSON.stringify({ search: 'text a', offset: 0 }), type, prepend: false, init: HERE, extra: ':empty-lines 1' });
}
const q = (s) => JSON.stringify(s);
const el = `
(require 'org) (require 'org-capture) (require 'org-id) (require 'org-clock) (require 'json) (require 'cl-lib)
(setq org-id-locations-file "/nonexistent/ids" org-id-track-globally nil)
(defvar answers nil)
(defun run-case (init kind arg type template prepend ans extra)
  (setq answers ans)
  (let* ((f (make-temp-file "target" nil ".org")))
    (with-temp-file f (insert init))
    (setq org-id-locations (make-hash-table :test 'equal))
    (puthash "id-1" f org-id-locations) (puthash "id-2" f org-id-locations)
    (ignore-errors (org-clock-cancel))
    (let* ((target (cond ((equal kind "here") (list 'file "/nonexistent")) ((equal kind "prop") (list 'file+headline f "A")) ((equal kind "regexp") (list 'file+regexp f arg)) ((equal kind "id") (list 'id arg)) (t (list 'clock))))
           (org-capture-templates (list (append (list "t" "T" type target template) (when prepend '(:prepend t)) extra (list :immediate-finish t)))))
      (condition-case err
          (let (started)
            (when (and (equal kind "clock") (not (equal arg "")))
              (with-current-buffer (find-file-noselect f)
                (goto-char (point-min)) (search-forward arg) (beginning-of-line) (org-clock-in)
                (setq started (substring-no-properties (buffer-string)))))
            (cl-letf (((symbol-function 'org-read-property-value) (lambda (_p _pom &optional default) (let ((a (pop answers))) (if (or (null a) (string= a "")) (or default "") a)))))
              (if (equal kind "here")
                  (let ((spec (json-parse-string arg :object-type 'alist)))
                    (with-current-buffer (find-file-noselect f)
                      (goto-char (point-min)) (search-forward (cdr (assq 'search spec))) (forward-char (cdr (assq 'offset spec))))
                    (switch-to-buffer (find-file-noselect f))
                    (org-capture 0 "t"))
                (org-capture nil "t")))
            (vector (or started init) (with-current-buffer (find-buffer-visiting f)
              (prog1 (substring-no-properties (buffer-string)) (set-buffer-modified-p nil)))))
        (error (vector init (concat "ERROR " (error-message-string err))))))))
(let (out)
  ${cases.map((c) => `(push (run-case ${q(c.init)} ${q(c.kind)} ${q(c.arg)} '${c.type} ${q(c.template ?? TEXT[c.type])} ${c.prepend ? 't' : 'nil'} (list ${(c.answers || []).map(q).join(' ')}) ${c.extra ? `'(${c.extra})` : 'nil'}) out)`).join('\n  ')}
  (princ (json-encode (vconcat (nreverse out)))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'target-'));
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 26 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stderr.slice(-2000)); process.exit(1); }
const outs = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/capture-target-oracle.json', import.meta.url), JSON.stringify({ cases: cases.map((c, i) => ({ ...c, init: outs[i][0], template: c.template ?? TEXT[c.type], emacs: outs[i][1] })) }, null, 1) + '\n');
console.log(`${cases.length} cases`);
