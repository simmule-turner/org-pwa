#!/usr/bin/env node
/**
 * Writes test/fixtures/columns-types-oracle.json: the table Emacs's `#+BEGIN: columnview` block writes when org-columns-summary-types holds
 * summary functions of the user's own (and org-columns-modify-value-for-display-function is set), with the document as Emacs leaves it.
 *   node tools/gen-columns-types-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DOC = `* Tasks
** one
:PROPERTIES:
:Cost: 3
:Ok: yes
:END:
** two
:PROPERTIES:
:Cost: 4
:Ok: no
:END:
*** two-a
:PROPERTIES:
:Cost: 1
:Ok: yes
:END:
*** two-b
:PROPERTIES:
:Cost: 2
:Ok: yes
:END:
** three
:PROPERTIES:
:Cost: 5
:Ok: yes
:END:
`;
const SQ = `(lambda (vals pf) (format "%d" (apply #'+ (mapcar (lambda (s) (* (string-to-number s) (string-to-number s))) vals))))`;
const CC = `(lambda (vals pf) (format "%d" (apply #'+ (mapcar #'string-to-number vals))))`;
const COLLECT = `(lambda (prop) (if (equal (org-entry-get nil "Ok") "yes") (org-entry-get nil prop) ""))`;
const cases = [
  { types: `'(("sq" . ${SQ}))`, params: ':id global :format "%ITEM %Cost{sq}"' },
  { types: `'(("sq" . ${SQ}))`, params: ':id global :format "%ITEM %Cost{+} %Cost(Sq){sq}"' },
  { types: `'(("pf" . (lambda (vals pf) (format "%s|%d" pf (length vals)))))`, params: ':id global :format "%ITEM %Cost{pf;%.1f}"' },
  { types: `'(("pf" . (lambda (vals pf) (format "%s|%d" pf (length vals)))))`, params: ':id global :format "%ITEM %Cost{pf}"' },
  { types: `'(("cc" ${CC} ${COLLECT}))`, params: ':id global :format "%ITEM %Cost{cc}"' },
  { types: `'(("+" . (lambda (vals pf) "X")))`, params: ':id global :format "%ITEM %Cost{+}"' },
  { types: `'(("sq" . ${SQ}))`, params: ':id global :format "%ITEM %Cost{max} %Cost(S){sq}"' },
  { types: `'(("bad" 1))`, params: ':id global :format "%ITEM %Cost{bad}"' },
  { types: `'(("bad" . 1))`, params: ':id global :format "%ITEM %Cost{bad}"' },
  { types: `'(("boom" . (lambda (vals pf) (error "boom"))))`, params: ':id global :format "%ITEM %Cost{boom}"' },
  { types: `'(("num" . (lambda (vals pf) 5)))`, params: ':id global :format "%ITEM %Cost{num}"' },
  { types: `'(("sq" . ${SQ}))`, params: ':id global :format "%ITEM %Cost{nope}"' },
  { types: `nil`, params: ':id global :format "%ITEM %Cost{+}"', modify: `(lambda (title value) (if (equal title "Cost") (concat "$" value) nil))` },
  { types: `nil`, params: ':id global :format "%ITEM(Name) %Cost{+}"', modify: `(lambda (title value) (upcase value))` },
  { types: `nil`, params: ':id global :format "%ITEM %Cost{+}"', modify: `(lambda (title value) 7)` },
];
const q = (s) => JSON.stringify(s);
const prepared = cases.map((c) => ({ ...c, text: DOC + `* Report\n#+BEGIN: columnview ${c.params}\n#+END:\n` }));
const el = `
(require 'org) (require 'org-colview) (require 'json) (require 'cl-lib)
(setq org-id-locations-file "/nonexistent/ids" org-id-track-globally nil)
(defun run-case (text types modify)
  (let ((org-columns-summary-types (eval types t))
        (org-columns-modify-value-for-display-function (and modify (eval modify t))))
    (with-temp-buffer
      (org-mode)
      (insert text)
      (goto-char (point-min))
      (re-search-forward "^#\\\\+BEGIN: columnview")
      (beginning-of-line)
      (condition-case err
          (progn (org-update-dblock) (substring-no-properties (buffer-string)))
        (error (concat "ERROR " (error-message-string err)))))))
(let (out)
  ${prepared.map((c) => `(push (run-case ${q(c.text)} (car (read-from-string ${q(c.types)})) ${c.modify ? `(car (read-from-string ${q(c.modify)}))` : 'nil'}) out)`).join('\n  ')}
  (princ (json-encode (vconcat (nreverse out)))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coltypes-'));
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 26 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stdout.slice(-1500), r.stderr.slice(-2000)); process.exit(1); }
const outs = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/columns-types-oracle.json', import.meta.url), JSON.stringify({ cases: prepared.map((c, i) => ({ text: c.text, types: c.types, modify: c.modify ?? null, emacs: outs[i] })) }, null, 1) + '\n');
console.log(`${prepared.length} cases, ${outs.filter((o) => o.startsWith('ERROR')).length} errors`);
