// Asks Emacs 29.3 (Org 9.6.15) what org-insert-structure-template and org-insert-drawer make of a text, and writes
// test/fixtures/structure-template-oracle.json. Run: node tools/gen-structure-template-oracle.mjs   (needs emacs on the path)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEYS = ['a', 'c', 'C', 'e', 'E', 'h', 'l', 'q', 's', 'v'];
const TEXTS = [
  '* H\nbody\nmore\n* N\n',
  '* H\n  indented\n  second\n* N\n',
  '* H\n',
  '* H\nbody\n',
  '* H\nbody\n\nafter blank\n* N\n',
  '* H\n* not a line\n#+title: x\n  - item\n    more\n',
  '* H\nSCHEDULED: <2024-01-01 Mon>\n:PROPERTIES:\n:ID: 1\n:END:\ntext\n',
  '* H\n  indented\n  second\n',
  '* H\n- item\n  more\n',
  '** H\n  - item\n    more\n  para\n',
  '* H\n#+begin_src sh\n* x\n#+end_src\n| a | b |\n',
];
/** @type {{ text: string, key: string, from: number | null, to: number | null }[]} */
const cases = [];
for (const text of TEXTS) {
  const lines = text.split('\n');
  const n = lines.length - 1;
  for (const key of KEYS) {
    cases.push({ text, key, from: null, to: null });
    for (let from = 1; from < n; from++) for (let to = from; to < Math.min(n, from + 3); to++) cases.push({ text, key, from, to });
  }
}
const DRAWERS = ['LOGBOOK', 'NOTES'];
/** @type {{ text: string, name: string, adapt: string, from: number | null, to: number | null }[]} */
const drawers = [];
for (const text of TEXTS) {
  const n = text.split('\n').length - 1;
  for (const name of DRAWERS) for (const adapt of ['nil', 't']) {
    drawers.push({ text, name, adapt, from: null, to: null });
    for (let from = 1; from < n; from++) for (let to = from; to < Math.min(n, from + 2); to++) drawers.push({ text, name, adapt, from, to });
  }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'struct-'));
fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify({ cases, drawers }));
const el = `
(require 'org) (require 'json) (require 'cl-lib)
(defun at-line (n) (goto-char (point-min)) (forward-line n))
(defun region-or-end (from to)
  (if from
      (progn (at-line from) (set-mark (point)) (at-line (1+ to)) (activate-mark))
    (goto-char (point-max))))
(defun do-template (text key from to)
  (with-temp-buffer
    (org-mode) (insert text)
    (let ((org-adapt-indentation nil) (transient-mark-mode t))
      (region-or-end from to)
      (condition-case err
          (progn (org-insert-structure-template (cdr (assoc key org-structure-template-alist))) (buffer-string))
        (error (concat "ERROR " (error-message-string err)))))))
(defun do-drawer (text name adapt from to)
  (with-temp-buffer
    (org-mode) (insert text)
    (let ((org-adapt-indentation (if (equal adapt "t") t nil)) (transient-mark-mode t))
      (region-or-end from to)
      (cl-letf (((symbol-function 'completing-read) (lambda (&rest _) name)))
        (condition-case err
            (progn (org-insert-drawer nil name) (buffer-string))
          (error (concat "ERROR " (error-message-string err))))))))
(let* ((data (json-parse-string (with-temp-buffer (insert-file-contents "${path.join(dir, 'cases.json')}") (buffer-string)) :object-type 'alist :null-object nil))
       (cs (alist-get 'cases data)) (ds (alist-get 'drawers data)))
  (princ (json-encode
          (list (cons 'templates (vconcat (mapcar (lambda (c) (do-template (alist-get 'text c) (alist-get 'key c) (alist-get 'from c) (alist-get 'to c))) cs)))
                (cons 'drawers (vconcat (mapcar (lambda (c) (do-drawer (alist-get 'text c) (alist-get 'name c) (alist-get 'adapt c) (alist-get 'from c) (alist-get 'to c))) ds)))))))
`;
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
const m = r.stdout.match(/\{.*\}$/s);
if (!m) { console.error(r.stdout.slice(-1500), r.stderr.slice(-2500)); process.exit(1); }
const out = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/structure-template-oracle.json', import.meta.url), JSON.stringify({
  templates: cases.map((c, i) => ({ ...c, result: out.templates[i] })),
  drawers: drawers.map((c, i) => ({ ...c, result: out.drawers[i] })),
}) + '\n');
console.log(`${cases.length} template cases, ${drawers.length} drawer cases`);
