// Asks Emacs 29.3 (Org 9.6.15) what M-RET (org-meta-return) does at every caret position of some texts, for each setting of
// org-M-RET-may-split-line, and writes test/fixtures/meta-return-oracle.json. Run: node tools/gen-meta-return-oracle.mjs   (needs emacs on the path)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEXTS = [
  '* Buy milk and eggs :a:b:\nbody\n',
  '* TODO [#A] Write report :work:\n** Child\n',
  '* H1\nsome text here\n* H2\n',
  '- one two\n- three four\n',
  '- [ ] aa bb\n- [X] cc dd\n',
  '1. aa bb\n2. cc dd\n3. ee\n',
  '- a b\n  - sub c\n  - sub2 d\n- e\n',
  '- term :: desc here\n- t2 :: more\n',
  '* H\n- a b\n  cont line\n- c\n\nPlain para\n',
  '- a\n\n- b c\n\n- d\n',
  'Plain line text\n',
  '* H\n  - indented item x\n',
  '** Sub  heading with   spaces   \n',
  '* A\n\n* B text\nbody\n',
  '* A\n* B text\n\n\n* C\n',
  '* A\n\ntext line\n\n- item x\n',
];
const SETTINGS = ['((default . t))', 't', 'nil', '((headline) (default . t))', '((item) (default . t))'];
const cases = [];
for (const text of TEXTS) for (const setting of SETTINGS) for (let pos = 0; pos <= text.length; pos++) cases.push({ text, setting, pos });

const el = `
(require 'org) (require 'json)
(let* ((json-object-type 'alist) (json-array-type 'list)
       (cs (with-temp-buffer (insert-file-contents (getenv "ORACLE_IN")) (json-read-from-string (buffer-string))))
       (out '()))
  (dolist (c cs)
    (with-temp-buffer
      (org-mode)
      (insert (cdr (assq 'text c)))
      (goto-char (1+ (cdr (assq 'pos c))))
      (let ((org-M-RET-may-split-line (car (read-from-string (cdr (assq 'setting c)))))
            (inhibit-message t) (message-log-max nil))
        (push (condition-case e
                  (progn (org-meta-return) (list (cons 'text (substring-no-properties (buffer-string))) (cons 'pos (1- (point)))))
                (error (list (cons 'error (error-message-string e)))))
              out))))
  (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out)))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mret-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', maxBuffer: 1 << 28 });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/meta-return-oracle.json', JSON.stringify(cases.map((c, i) => ({ ...c, result: results[i] }))));
console.log(`${cases.length} cases, ${results.filter((x) => x.error).length} errors`);
