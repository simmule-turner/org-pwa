#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-habits.json: the graph org-habit-build-graph draws in Emacs 29.3 for every habit of
 * tools/oracle-habit-cases.mjs (for 13 October 2026), under three settings of the days before and after and
 * org-habit-show-done-always-green: each day's character, color and shade. test/oracle-habits.test.js holds the app to it.
 *   node tools/gen-oracle-habits.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HABITS, HEADER, VARIANTS } from './oracle-habit-cases.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-habits-'));
const file = path.join(dir, 'habits.org');
fs.writeFileSync(file, HEADER + HABITS.map((h) => h.org).join('\n') + '\n');

const el = `
(require 'org) (require 'org-habit) (require 'json)
(setq inhibit-message t org-habit-show-done-always-green nil)
(find-file (getenv "HABITS"))
(defun cells-of (g)
  (let (cells)
    (dotimes (i (length g))
      (let ((face (symbol-name (or (get-text-property i 'face g) 'none))))
        (push (concat (string (aref g i))
                      (cond ((string-match "clear" face) "b") ((string-match "ready" face) "g") ((string-match "alert" face) "y") ((string-match "overdue" face) "r") (t "-"))
                      (if (string-match "future" face) "l" "p")) cells)))
    (mapconcat #'identity (nreverse cells) "")))
(let ((today (encode-time 0 0 0 13 10 2026)) (out '()))
  (dolist (v (quote (${VARIANTS.map((v) => `(${v.preceding} ${v.following} ${v.green ? 't' : 'nil'})`).join(' ')})))
    (let ((org-habit-preceding-days (nth 0 v)) (org-habit-following-days (nth 1 v)) (org-habit-show-done-always-green (nth 2 v)) (rows '()))
      (org-map-entries
       (lambda ()
         (let ((id (progn (looking-at "\\\\*+ +\\\\(?:TODO\\\\|NEXT\\\\|WAIT\\\\|DONE\\\\) +\\\\(H[0-9]+\\\\)") (match-string 1))))
           (push (cons id
                       (condition-case e
                           (let* ((habit (org-habit-parse-todo))
                                  (g (org-habit-build-graph habit (time-subtract today (days-to-time org-habit-preceding-days)) today (time-add today (days-to-time org-habit-following-days)))))
                             (cells-of g))
                         (error (concat "ERROR " (error-message-string e)))))
                 rows))))
      (push (nreverse rows) out)))
  (princ (json-encode (nreverse out))))
`;
const elFile = path.join(dir, 'run.el');
fs.writeFileSync(elFile, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, TZ: 'America/New_York', HABITS: file }, encoding: 'utf8', input: '', maxBuffer: 1 << 28 });
if (r.status !== 0) {
  console.error(r.stderr);
  process.exit(1);
}
const variants = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
const version = spawnSync('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { encoding: 'utf8' }).stdout.trim();
fs.writeFileSync(new URL('../test/fixtures/oracle-habits.json', import.meta.url), JSON.stringify({ emacs: version, today: '2026-10-13', tz: 'America/New_York', variants: VARIANTS.map((v, i) => ({ ...v, habits: variants[i] })) }) + '\n');
const errors = Object.values(variants[0]).filter((h) => String(h).startsWith('ERROR')).length;
console.log(`wrote ${HABITS.length} habits x ${VARIANTS.length} settings from Emacs ${version}, ${errors} errors`);
