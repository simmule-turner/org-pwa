#!/usr/bin/env node
/**
 * Writes test/fixtures/outline-edit-oracle.json: what Emacs 29.3 (Org 9.6) does for the single-heading structure and editing commands, on
 * small outlines, under org-adapt-indentation nil, t and headline-data and org-auto-align-tags t and nil:
 *  - org-promote and org-demote (one heading; the text under it follows as org-adapt-indentation says),
 *  - org-sort-entries (every sorting type, with and without case, on the children of a heading and on the top-level entries),
 *  - org-toggle-comment, org-insert-property-drawer, org-add-planning-info and org-set-property (a new drawer),
 *  - org-paste-subtree with point at the end, the start or after the stars of a heading, with a level, on folded and open headings.
 * test/outline-edit-oracle.test.js holds src/heading-edit.js, src/outline-sort.js and src/indent-fixup.js to it.
 *
 *   node tools/gen-outline-edit-oracle.mjs        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const adapts = ['nil', 't', 'headline-data'];
const levelDocs = [
  '* H', '** H', '*** H', '** H :tag:', '* H  :tag:', '*** H :a:b:\ntext', '* TODO [#A] H :x:\nSCHEDULED: <2024-03-04 Mon>\n:PROPERTIES:\n:ID: 1\n:END:\nbody',
  '* H\n  SCHEDULED: <2014-03-04 tue.>', '** H\n   SCHEDULED: <2014-03-04 tue.>', '* H\n  :PROPERTIES:\n  :FOO: Bar\n  :END:', '** H\n   :PROPERTIES:\n   :FOO: Bar\n   :END:',
  '* H\n  Paragraph', '** H\n   Paragraph', '* H\n   Paragraph\n  less', '** H\n   Paragraph\n[fn:1] line1\nline2', '* H\n[fn:1] Def.\n\n\n  After def.',
  '* H\n  :LOGBOOK:\n  - a\n  :END:\n  b', '** H\n   :LOGBOOK:\n   - a\n   :END:\n   b', '* H\n:LOGBOOK:\n- a\n:END:', '** H\n:LOGBOOK:\n- a\n:END:',
  '* H\n#+BEGIN_SRC emacs-lisp\n(+ 1 1)\n#+END_SRC', '* H\n#+BEGIN_EXAMPLE\n(+ 1 1)\n#+END_EXAMPLE', '* H\n#+BEGIN_SRC emacs-lisp -i\n(+ 1 1)\n#+END_SRC', '** H\n #+BEGIN_EXAMPLE\nContents\n #+END_EXAMPLE',
  '** H\n #+BEGIN_SRC emacs-lisp -i\n(+ 1 1)\n #+END_SRC', '* H\n- a\n  - b\n\ntext', '** H\n  - a\n  - b', '* A\ntext a\n** B\n  text b\n*** C\n* D', '* A\n** B\n*** C\n**** D\n** E', '*** H\n****** deep\n** x',
  '* H\n:PROPERTIES:\n:A:\n:LONG-NAME: v\n:END:\n  text', '* H\nSCHEDULED: <2024-03-04 Mon>\n:LOGBOOK:\n- a\n:END:\ntext', '** H\n\n  after blank\n    deeper',
];
const levelCases = [];
for (const org of levelDocs) {
  const n = (org.match(/^\*+ /gm) || []).length;
  for (let index = 0; index < Math.min(n, 3); index++) for (const op of ['promote', 'demote']) {
    for (const adapt of adapts) levelCases.push({ kind: 'level', op, org, index, adapt, align: true, preserve: false, column: 20 });
  }
}
for (const org of ['* H  :tag:', '** H :tag:', '*** H   :a:b:', '** H\n  text']) for (const op of ['promote', 'demote']) for (const align of [true, false]) levelCases.push({ kind: 'level', op, org, index: 0, adapt: 'nil', align, preserve: false, column: 10 });
for (const org of ['* H\n#+BEGIN_SRC emacs-lisp\n(+ 1 1)\n#+END_SRC', '* H\n#+BEGIN_EXAMPLE\n(+ 1 1)\n#+END_EXAMPLE']) levelCases.push({ kind: 'level', op: 'demote', org, index: 0, adapt: 't', align: true, preserve: true, column: 20 });

const sortDocs = {
  plain: '* P\n** banana\n** Apple\n** cherry\n** apple\n',
  keywords: '* P\n** DONE b\n** TODO a\n** c\n** NEXT d\n** CANCELED e\n',
  priorities: '* P\n** [#C] c\n** a\n** [#A] b\n** [#B] d\n** [#A] e\n',
  numbers: '* P\n** x 10\n** 9 nines\n** 1e1\n** abc\n** -3\n** 2.5\n** +7 and\n',
  times: '* P\n** a <2024-05-02 Thu>\n** b [2024-05-01 Wed]\n** c\nbody <2024-04-30 Tue 10:00>\n** d <2024-05-02 Thu 08:00>\n',
  planning: '* P\n** a\nSCHEDULED: <2024-05-02 Thu> DEADLINE: <2024-06-01 Sat>\n** b\nSCHEDULED: <2024-05-01 Wed>\n** c\nDEADLINE: <2024-05-30 Thu>\n** d\n',
  created: '* P\n** a\n[2024-05-02 Thu]\n** b\n[2024-05-01 Wed 10:00]\ntext [2024-01-01 Mon]\n** c\n',
  markup: '* P\n** *bold* z\n** [[http://x][Desc]] a\n** =code= m\n** [[file:foo][b link]]\n** /it/ c\n',
  blanks: '* P\n** b\n\n** a\n\n\n* Q\n',
  blanksEnd: '* P\n** b\n\n\n** a\n\n\n',
  nested: '* P\n** b\n*** z\n*** y\n** a\n*** q\n',
  noFinal: '* P\n** b\n** a',
  deeper: '* P\n*** b\n*** a\n',
  mixed: '* P\n*** b\n** a\n',
  intro: 'intro\n* b\n\n* a\n',
  topOnly: '* c\n** x\n* a\n** y\n* b\n',
  single: '* P\n** a\n',
  ties: '* P\n** a 1\n** A 1\n** b 1\n',
  tagsTodo: '* P\n** TODO [#B] banana :t:\n** DONE apple :u:\n',
  properties: '* P\n** a\n:PROPERTIES:\n:K: 3\n:END:\n** b\n:PROPERTIES:\n:K: 1\n:END:\n** c\n',
};
const sortCases = [];
const typeLetters = 'aAnNtTpPoOsSdDcCrRfF'.split('');
for (const [name, org] of Object.entries(sortDocs)) for (const type of typeLetters) for (const withCase of [false, true]) {
  if (withCase && !'aAfF'.includes(type)) continue;
  if ('rR'.includes(type) && name !== 'properties') continue;
  if ('fF'.includes(type) && !['plain', 'tagsTodo', 'ties', 'markup'].includes(name)) continue;
  const index = name === 'intro' || name === 'topOnly' ? -1 : 0;
  sortCases.push({ kind: 'sort', org, name, index, type, withCase, property: 'K', fn: 'org-get-heading' });
}
const commentCases = [];
for (const org of ['* Test', '* COMMENT Test', '*** Test', '* TODO Test', '* TODO COMMENT Test', '* COMMENT', '* ', '* TODO', '* TODO COMMENT', '* TODO [#A] Headline', '* TODO [#A] COMMENT Headline', '* Test :tag:', '* COMMENT Test :tag:', '* COMMENTED', '* COMMENT   spaced', '* A\n** COMMENT B\n** C']) {
  const n = (org.match(/^\*+( |$)/gm) || []).length;
  for (let index = 0; index < n; index++) commentCases.push({ kind: 'comment', org, index });
}
const drawerCases = [];
for (const org of ['* H', '* H\n', '* H\nbody', '* H\nSCHEDULED: <2024-03-04 Mon>', '* H\nSCHEDULED: <2024-03-04 Mon>\nbody', '* H\n:PROPERTIES:\n:A: 1\n:END:', '* H\n:LOGBOOK:\n- x\n:END:', '** H\ntext\n* I\n', 'intro\n* H', '* H\n  SCHEDULED: <2024-03-04 Mon>\n', '* A\n** B\n* C']) {
  const n = (org.match(/^\*+ /gm) || []).length;
  for (let index = 0; index < n; index++) for (const adapt of adapts) drawerCases.push({ kind: 'drawer', org, index, adapt });
}
for (const org of ['* H', '** H\nbody', '* H\n:PROPERTIES:\n:A: 1\n:END:']) for (const adapt of adapts) drawerCases.push({ kind: 'setprop', org, index: 0, adapt, name: 'FOO', value: 'bar' });
const planningCases = [];
for (const org of ['* H', '** H\nParagraph', '* H\n  DEADLINE: <2015-06-24 Wed>\nParagraph', '*** H\nSCHEDULED: <2015-06-24 Wed>']) for (const adapt of adapts) for (const what of ['deadline', 'scheduled']) planningCases.push({ kind: 'planning', org, index: 0, adapt, what, time: '2015-06-25 Thu' });

const treeA = '* Text';
const pasteCases = [];
const pasteDocs = ['* H', '* H\nbody\n* Z\n', '* A\nbody\n** c\n*** d\n* B\n', '** A\n*** c\n** B\n', '* A\n** c\n* B\n', '*** \n**** c\n* B\n', '* \nbody\n** c\n* B\n', '* A\n* \n', '* A\n** \nSCHEDULED: <2024-03-04 Mon>\ntext\n* B\n', '* A\n** B\n*** C\n* D\n'];
for (const org of pasteDocs) {
  const n = (org.match(/^\*+ ?$|^\*+ /gm) || []).length;
  for (let index = 0; index < n; index++) for (const tree of [treeA, '** Text\n*** Sub', '* T1\n* T2\nbody', '*** Deep\n:PROPERTIES:\n:A: 1\n:END:\ntext\n', '\n* After blank']) for (const [point, level] of [['end', null], ['bol', null], ['stars', null], ['end', 3], ['end', 1], ['stars', 2]]) for (const folded of [false, true]) {
    if (folded && !(/\*\* /.test(org))) continue;
    pasteCases.push({ kind: 'paste', org, index, tree, point, level, folded, adapt: 'nil' });
  }
}
for (const adapt of ['t', 'headline-data']) for (const tree of ['** T\n   SCHEDULED: <2024-03-04 Mon>\n   text\n*** S\n    sub', '* T\n  text']) for (const level of [null, 3, 2]) pasteCases.push({ kind: 'paste', org: '** A\n   body\n', index: 0, tree, point: 'end', level, folded: false, adapt });
for (const tree of ['not a tree', '** A\n* B', 'text\n* A', '']) pasteCases.push({ kind: 'paste', org: '* H', index: 0, tree, point: 'end', level: null, folded: false, adapt: 'nil' });

const cases = [...levelCases, ...sortCases, ...commentCases, ...drawerCases, ...planningCases, ...pasteCases];

const el = `;; -*- lexical-binding: t -*-
(require 'org) (require 'org-archive) (require 'cl-lib) (require 'json)
(defun goto-heading (n)
  (goto-char (point-min))
  (when (>= n 0) (dotimes (_ (1+ n)) (re-search-forward "^\\\\*+\\\\( \\\\|$\\\\)" nil t)) (beginning-of-line)))
(defun sym (s) (intern s))
(defun run-case (c)
  (let ((kind (cdr (assq 'kind c))) (org (cdr (assq 'org c))) (index (cdr (assq 'index c))))
    (with-temp-buffer
      (insert org)
      (org-mode)
      (setq buffer-file-name "/tmp/outline-edit-oracle-buffer.org")
      (goto-heading (or index 0))
      (let* ((inhibit-message t) (message-log-max nil)
             (org-adapt-indentation (sym (or (cdr (assq 'adapt c)) "nil")))
             (org-auto-align-tags (not (eq (cdr (assq 'align c)) :json-false)))
             (org-src-preserve-indentation (eq (cdr (assq 'preserve c)) t))
             (org-tags-column (or (cdr (assq 'column c)) -77))
             (org-odd-levels-only nil) (org-allow-promoting-top-level-subtree nil))
        (condition-case e
            (cond ((string= kind "level") (if (string= (cdr (assq 'op c)) "promote") (org-promote) (org-demote)))
                  ((string= kind "comment") (org-toggle-comment))
                  ((string= kind "drawer") (org-insert-property-drawer))
                  ((string= kind "setprop") (org-set-property (cdr (assq 'name c)) (cdr (assq 'value c))))
                  ((string= kind "planning") (org-add-planning-info (sym (cdr (assq 'what c))) (org-time-string-to-time (cdr (assq 'time c)))))
                  ((string= kind "sort")
                   (when (< index 0) (goto-char (point-min)))
                   (let ((typ (string-to-char (cdr (assq 'type c)))) (wc (eq (cdr (assq 'withCase c)) t)))
                     (org-sort-entries wc typ (and (memq (downcase typ) '(?f)) (sym (cdr (assq 'fn c)))) nil (cdr (assq 'property c)))))
                  ((string= kind "paste")
                   (let ((point (cdr (assq 'point c))) (level (cdr (assq 'level c))))
                     (cond ((string= point "end") (end-of-line))
                           ((string= point "bol") (beginning-of-line))
                           ((string= point "stars") (end-of-line)))
                     (when (eq (cdr (assq 'folded c)) t) (org-fold-subtree t))
                     (org-paste-subtree (and (numberp level) level) (cdr (assq 'tree c))))))
          (error (goto-char (point-min)) (insert (format "ERROR %s\\n" (error-message-string e))))))
      (set-buffer-modified-p nil)
      (buffer-string))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outline-edit-oracle-'));
const elFile = path.join(dir, 'run.el');
fs.writeFileSync(elFile, el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, TZ: 'UTC', ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '', maxBuffer: 1e9 });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const out = cases.map((c, i) => ({ ...c, emacs: results[i] }));
fs.writeFileSync('test/fixtures/outline-edit-oracle.json', JSON.stringify({ emacs: '29.3', cases: out }, null, 1) + '\n');
console.log(`${out.length} cases written`);
