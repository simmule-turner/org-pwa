#!/usr/bin/env node
/**
 * Writes test/fixtures/inlinetask-oracle.json: what org-inlinetask's movement and test functions give in Emacs 29.3 from every
 * position of a set of texts (point at the end of the function's work, or its value), for a minimum level of 5 (and 3 with odd levels).
 *   node tools/gen-inlinetask-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEXTS = [
  '** H\n***** I\n***** END\nfoo',
  '** H\n***** I\n***** END',
  '** H\n***** I\n inside\n***** END\n***** I\n***** END',
  '** H\n***** I\n***** END\n***** I\n***** END\n',
  '* A\n***** T1 TODO\ntext\n***** end  \nafter\n** B\n***** lone\nbody\n** C\n',
  '***** x\n***** END\n***** END\n**** four\n****** six\n',
  'plain\n\n***** a\n:PROPERTIES:\n:ID: 1\n:END:\n***** END\n',
  '***** I\n',
  '',
  '***** END',
];
const FUNCS = ['org-inlinetask-goto-end', 'org-inlinetask-goto-beginning', 'org-inlinetask-in-task-p', 'org-inlinetask-at-task-p', 'org-inlinetask-end-p', 'org-inlinetask-get-task-level'];
const SETTINGS = [{ min: 5, odd: false }, { min: 3, odd: true }, { min: 2, odd: false }];
const q = (s) => JSON.stringify(s);
const el = `
(require 'org) (require 'org-inlinetask) (require 'json)
(defun run-at (text pos fn min odd)
  (with-temp-buffer
    (insert text)
    (goto-char pos)
    (let ((org-inlinetask-min-level min) (org-odd-levels-only odd))
      (condition-case err
          (let ((v (funcall fn)))
            (list (point) (cond ((eq fn 'org-inlinetask-get-task-level) v) ((memq fn '(org-inlinetask-goto-end org-inlinetask-goto-beginning)) nil) (t (if v t :json-false)))))
        (error (list nil (format "ERROR %S" err)))))))
(let (out)
  ${SETTINGS.flatMap((s) => TEXTS.flatMap((t, ti) => FUNCS.map((f) => `(push (cons '(${ti} ${f} ${s.min} ${s.odd ? 1 : 0}) (let (r) (dotimes (i (1+ (length ${q(t)}))) (push (run-at ${q(t)} (1+ i) '${f} ${s.min} ${s.odd ? 't' : 'nil'}) r)) (nreverse r))) out)`))).join('\n  ')}
  (princ (json-encode (vconcat (mapcar (lambda (x) (list (car x) (vconcat (cdr x)))) (nreverse out))))))
`;
// a column view over a task of the minimum level and of one level deeper (Emacs indexes its level table by level: the deeper one is an error)
const COLUMN_DOCS = [15, 16].map((n) => `* A\n:PROPERTIES:\n:Cost: 1\n:END:\n${'*'.repeat(n)} T\n:PROPERTIES:\n:Cost: 2\n:END:\n${'*'.repeat(n)} END\n* Report\n#+BEGIN: columnview :id global :format "%ITEM %Cost{+}"\n#+END:\n`);
const colEl = `
(require 'org) (require 'org-inlinetask) (require 'org-colview) (require 'json)
(setq org-id-locations-file "/nonexistent/ids" org-id-track-globally nil)
(defun run-col (text)
  (with-temp-buffer
    (org-mode) (insert text) (goto-char (point-min))
    (re-search-forward "^#\\\\+BEGIN: columnview") (beginning-of-line)
    (condition-case err (progn (org-update-dblock) (buffer-string)) (error (concat "ERROR " (error-message-string err))))))
(princ (json-encode (vconcat (list ${COLUMN_DOCS.map((d) => `(run-col ${q(d)})`).join(' ')}))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-'));
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stdout.slice(-1500), r.stderr.slice(-2000)); process.exit(1); }
const outs = JSON.parse(m[0]);
const cases = outs.map(([key, results]) => ({ text: TEXTS[key[0]], fn: key[1], min: key[2], odd: key[3] === 1, results }));
const colFile = path.join(dir, 'col.el');
fs.writeFileSync(colFile, colEl);
const rc = spawnSync('emacs', ['--batch', '-Q', '-l', colFile], { encoding: 'utf8' });
const mc = rc.stdout.match(/\[.*\]$/s);
if (!mc) { console.error(rc.stdout.slice(-1500), rc.stderr.slice(-2000)); process.exit(1); }
const columns = JSON.parse(mc[0]).map((emacs, i) => ({ text: COLUMN_DOCS[i], emacs }));
fs.writeFileSync(new URL('../test/fixtures/inlinetask-oracle.json', import.meta.url), JSON.stringify({ cases, columns }) + '\n');
console.log(`${cases.length} cases`);
