#!/usr/bin/env node
/**
 * Writes test/fixtures/recentf-oracle.json: the recent files list Emacs 29.3 (recentf-mode) leaves after a run of find-file and
 * save-buffer, for several limits (recentf-max-saved-items, including 0, negative and nil), after recentf-save-list wrote it out. A kill-buffer is part of the
 * runs too: recentf leaves the list as it is for a readable file.  test/recent-files.test.js holds the app to it.
 *   node tools/gen-recentf-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FILES = Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(97 + i)}.org`);
let seed = 20261112;
const rnd = (n) => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return seed % n;
};
const cases = [];
const add = (max, ops) => cases.push({ max, ops });
add(20, [['open', 'a.org'], ['open', 'b.org'], ['open', 'a.org']]);
add(20, [['open', 'a.org'], ['open', 'b.org'], ['save', 'a.org'], ['close', 'a.org']]);
add(20, [['open', 'a.org'], ['open', 'b.org'], ['close', 'b.org'], ['close', 'a.org']]);
add(3, FILES.slice(0, 5).map((f) => ['open', f]));
add(1, [['open', 'a.org'], ['open', 'b.org']]);
for (const max of [0, -1, null]) add(max, FILES.map((f) => ['open', f]));
add(25, FILES.map((f) => ['open', f]));
add(20, FILES.map((f) => ['open', f]));
for (const max of [3, 5, 20]) {
  for (let n = 0; n < 12; n++) {
    const ops = [];
    for (let k = 0; k < 30; k++) ops.push([['open', 'save', 'close'][rnd(3)], FILES[rnd(max === 20 ? 26 : 8)]]);
    add(max, ops);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recentf-'));
for (const f of FILES) fs.writeFileSync(path.join(dir, f), '* heading\n');
const str = (s) => JSON.stringify(s);
const lisp = `(progn (require 'recentf) (require 'json)
  (setq make-backup-files nil auto-save-default nil create-lockfiles nil)
  (let ((dir ${str(dir + '/')}) (out nil)
        (cases (json-parse-string ${str(JSON.stringify(cases))} :object-type 'alist :array-type 'list :null-object nil)))
    (dolist (c cases)
      (setq recentf-list nil recentf-max-saved-items (alist-get 'max c))
      (recentf-mode 1)
      (setq recentf-save-file (concat dir "saved"))
      (dolist (op (alist-get 'ops c))
        (let ((file (concat dir (cadr op))))
          (pcase (car op)
            ("open" (find-file-noselect file))
            ("save" (with-current-buffer (find-file-noselect file) (set-buffer-modified-p t) (save-buffer)))
            ("close" (let ((b (find-buffer-visiting file))) (when b (kill-buffer b)))))))
      (recentf-save-list)
      (setq recentf-list nil)
      (load recentf-save-file nil t)
      (push (vconcat (mapcar #'file-name-nondirectory recentf-list)) out)
      (mapc #'kill-buffer (buffer-list)))
    (princ (json-encode (vconcat (nreverse out))))))`;
const r = spawnSync('emacs', ['--batch', '-Q', '--eval', lisp], { encoding: 'utf8', maxBuffer: 1 << 26 });
if (r.status !== 0) throw new Error(r.stderr || 'emacs failed');
const results = JSON.parse(r.stdout);
fs.writeFileSync(new URL('../test/fixtures/recentf-oracle.json', import.meta.url), JSON.stringify(cases.map((c, i) => ({ ...c, list: results[i] }))) + '\n');
console.log(`${cases.length} cases`);
