#!/usr/bin/env node
/**
 * Writes test/fixtures/emacs-org-oracle.json: what Emacs 29.3 (org-mode buffer) does for the Org commands at the caret that Emacs mode
 * has (heading motion, C-c C-t, C-c C-c, C-c C-x C-b and M-up, M-down, M-left, M-right), run at every caret position of a few texts.
 * test/emacs-org-oracle.test.js holds src/emacs-org.js and the commands of src/emacs-edit.js to it.
 *
 *   node tools/gen-emacs-org-oracle.mjs        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emacs-org-oracle-'));
const texts = [
  '* TODO [#B] Head one :a:b:\nbody line\n** Sub\n- item one\n  more\n- [ ] box two\n  - [X] inner\n  - [ ] inner two\n- [-] three\n* Second\n:PROPERTIES:\n:A: b\n:END:\ntext <2024-03-05 Tue> and [2024-03-06 Wed 10:30]\n',
  '| a | bb |\n|---+----|\n| ccc | d |\n| e | f |\n\nafter\n',
  '1. one\n2. two\n   - sub\n3. three\n',
  'intro\nmore\n* A\n** B\n*** B1\n** C\n* D\n',
  '* DONE Item\nSCHEDULED: <2024-03-05 Tue +1w>\n** TODO Child\n*** Deep\n* Last\n',
];
const cmds = ['org-metaup','org-metadown','org-metaleft','org-metaright','org-ctrl-c-ctrl-c','org-toggle-checkbox','org-todo','org-next-visible-heading','org-previous-visible-heading','org-forward-heading-same-level','org-backward-heading-same-level','outline-up-heading'];
const cases=[];
for (const text of texts) for (let pos=0;pos<=text.length;pos++) for (const c of cmds) cases.push({text,pos,cmd:c});
const el=`(require 'org) (require 'json)
(transient-mark-mode 1)
(dolist (f '(read-from-minibuffer completing-read read-string read-key read-event read-char read-char-exclusive y-or-n-p yes-or-no-p org-read-date))
  (advice-add f :around (lambda (&rest _) (error "PROMPT"))))
(defun run-case (c)
  (let ((text (cdr (assq 'text c))) (pos (cdr (assq 'pos c))) (cmd (intern (cdr (assq 'cmd c)))) (err nil))
    (with-temp-buffer (insert text) (org-mode) (goto-char (1+ pos))
      (let ((inhibit-message t) (message-log-max nil) (current-prefix-arg nil) (this-command cmd) (last-command nil) (last-command-event ?\\r))
        (condition-case e (call-interactively cmd) (error (setq err (error-message-string e)))))
      (list (cons 'text (buffer-string)) (cons 'pos (1- (point))) (cons 'error (or err :null))))))
(with-temp-buffer (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))`;
fs.writeFileSync(`${dir}/run.el`, el);
fs.writeFileSync(`${dir}/in.json`, JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', `${dir}/run.el`], { env: { ...process.env, ORACLE_IN: `${dir}/in.json`, ORACLE_OUT: `${dir}/out.json` }, encoding: 'utf8', maxBuffer: 1 << 28 });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const res = JSON.parse(fs.readFileSync(`${dir}/out.json`, 'utf8'));
fs.writeFileSync('test/fixtures/emacs-org-oracle.json', JSON.stringify({ emacs: '29.3', cases: cases.map((c, i) => ({ ...c, emacs: res[i] })) }) + '\n');
console.log(`${cases.length} cases written`);
