// Asks Emacs 29.3 (Org 9.6.15) what org-beginning-of-line, org-end-of-line, org-toggle-heading, org-mark-subtree and org-next-link do in a text,
// and writes test/fixtures/text-commands-oracle.json. Run: node tools/gen-text-commands-oracle.mjs   (needs emacs on the path)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LINE_TEXT = [
  '* TODO [#A] Title text :tag:other:\n  body line\n- [ ] item one\n    continued\n1. numbered\n',
  '** Plain heading\n* TODO\n* :only:tags:\n*** DONE Finished   :x:\n* Long title here that goes on                          :a:\n',
  '  indented text\n\n    - nested [ ] box\n  + plus item\n',
];
const SETTINGS = ['nil', 't', 'reversed', 'reversed-repeat'];
const TOGGLE_TEXT = [
  '* Heading\nplain line\n- item one\n- [ ] checked item\n  more\n1. num\n\n** Child\nbody\n',
  '* TODO [#B] Task :t:\n  indented plain\n* DONE x\ntext\n',
  'before heading\n* H\n   - a\n   - b\n',
  '* H\n- a\n  - a1\n  - a2\n- b\n  para\n\n  para2\n- [X] done\n- [-] trans\n- term :: desc\n+ plus\n',
  '** H\nplain\n  - x\n    deeper text\n    - y\n  - z\n\ntail\n',
];
const LINK_TEXT = [
  'text [[https://a.org][A]] and [[file:b.org]] then <https://c.org> plain https://d.org end\n* H\n[[id:1][one]]\n',
];
const MARK_TEXT = [
  '* A\ntext\n** B\nmore\n*** C\ndeep\n** D\nlast\n* E\nend\n',
  'preface\n* A\ntext\n',
];
/** @type {object[]} */
const cases = [];
for (const text of LINE_TEXT) {
  for (const setting of SETTINGS) for (let pos = 0; pos <= text.length; pos++) cases.push({ kind: 'line', text, setting, pos });
}
for (const text of TOGGLE_TEXT) {
  const n = text.split('\n').length - 1;
  for (let line = 0; line < n; line++) cases.push({ kind: 'toggle', text, line, to: line });
  for (let line = 0; line < n; line++) for (let to = line + 1; to < Math.min(n, line + 4); to++) cases.push({ kind: 'toggle', text, line, to });
}
for (const text of LINK_TEXT) for (let pos = 0; pos <= text.length; pos++) cases.push({ kind: 'link', text, pos });
for (const text of MARK_TEXT) for (let pos = 0; pos <= text.length; pos++) cases.push({ kind: 'mark', text, pos });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'textcmd-'));
fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases));
const el = `
(require 'org) (require 'json) (require 'cl-lib)
(defun at-line (n) (goto-char (point-min)) (forward-line n))
(defun run-case (c)
  (with-temp-buffer
    (org-mode) (insert (alist-get 'text c))
    (let ((kind (alist-get 'kind c)) (transient-mark-mode t) (org-adapt-indentation nil))
      (condition-case err
          (pcase kind
            ("line"
             (let ((org-special-ctrl-a/e (pcase (alist-get 'setting c) ("nil" nil) ("t" t) (_ 'reversed)))
                   (last-command (if (equal (alist-get 'setting c) "reversed-repeat") 'x 'y)) (this-command 'x))
               (goto-char (1+ (alist-get 'pos c)))
               (org-beginning-of-line) (let ((a (1- (point)))) 
                 (goto-char (1+ (alist-get 'pos c)))
                 (org-end-of-line) (list a (1- (point))))))
            ("toggle"
             (at-line (alist-get 'line c)) (set-mark (point))
             (at-line (1+ (alist-get 'to c)))
             (when (> (alist-get 'to c) (alist-get 'line c)) (activate-mark))
             (if (> (alist-get 'to c) (alist-get 'line c)) (org-toggle-heading) (progn (goto-char (mark)) (org-toggle-heading)))
             (buffer-string))
            ("link"
             (goto-char (1+ (alist-get 'pos c))) (setq org-link--search-failed nil)
             (condition-case e (progn (org-next-link) (1- (point))) (error (concat "ERROR " (error-message-string e)))))
            ("mark"
             (goto-char (1+ (alist-get 'pos c)))
             (condition-case e (progn (org-mark-subtree) (list (1- (region-beginning)) (1- (region-end)))) (error (concat "ERROR " (error-message-string e))))))
        (error (concat "ERROR " (error-message-string err)))))))
(let* ((cases (json-parse-string (with-temp-buffer (insert-file-contents "${path.join(dir, 'cases.json')}") (buffer-string)) :object-type 'alist :array-type 'list)))
  (princ (json-encode (vconcat (mapcar #'run-case cases)))))
`;
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stdout.slice(-1500), r.stderr.slice(-2500)); process.exit(1); }
const out = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/text-commands-oracle.json', import.meta.url), JSON.stringify(cases.map((c, i) => ({ ...c, result: out[i] }))) + '\n');
const count = (/** @type {string} */ k) => cases.filter((c) => /** @type {{ kind: string }} */ (c).kind === k).length;
console.log(`${cases.length} cases: ${count('line')} line, ${count('toggle')} toggle, ${count('link')} link, ${count('mark')} mark`);
