#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-agenda.json: the rows Emacs 29.3 puts in the agenda (org-agenda-list over a day, a week or a month)
 * for every scenario of tools/oracle-agenda-cases.mjs, in the order it shows them, with the type, the leader ("Sched. 2x:",
 * "In 3 d.:"), the time of day and the category of each. Today is 2026-10-11 16:30, New York time.
 * test/oracle-agenda.test.js holds the app to it.
 *   node tools/gen-oracle-agenda.mjs   (needs emacs and faketime on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOCS, SCENARIOS } from './oracle-agenda-cases.mjs';

const NOW = '2026-10-11 16:30:00';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-agenda-'));
const files = {};
for (const [name, text] of Object.entries(DOCS)) {
  files[name] = path.join(dir, `${name}.org`);
  fs.writeFileSync(files[name], text);
}

const el = `
(require 'org) (require 'org-agenda) (require 'org-habit) (require 'json)
(setq org-agenda-window-setup 'current-window org-agenda-sticky nil inhibit-message t org-agenda-use-time-grid nil
      org-agenda-tags-column 0)
(defun iso-of-abs (n) (let ((g (calendar-gregorian-from-absolute n))) (format "%04d-%02d-%02d" (nth 2 g) (nth 0 g) (nth 1 g))))
(defun view-form (view query date span key)
  (cond ((equal view "todo") (list 'org-todo-list query))
        ((equal view "stuck") '(org-agenda-list-stuck-projects))
        ((equal view "match") (list 'org-tags-view nil query))
        ((equal view "command") (list 'org-agenda nil key))
        (t (list 'org-agenda-list nil date (list 'quote span)))))
(defun scan ()
  (let (rows days)
    (with-current-buffer "*Org Agenda*"
      (save-excursion
        (goto-char (point-min))
        (while (not (eobp))
          (let ((m (get-text-property (point) 'org-hd-marker)) (d (get-text-property (point) 'day)))
            (cond
             (m (let ((ov (cl-find-if (lambda (o) (overlay-get o 'before-string)) (overlays-at (point)))))
                  (when ov (push (vector (if d (iso-of-abs d) "") "clockissue" (string-trim (substring-no-properties (overlay-get ov 'before-string))) -1
                                         (org-with-point-at m (let ((h (nth 4 (org-heading-components)))) (if (string-match "[ETK][0-9]+" h) (match-string 0 h) h))) "" "") rows)))
                (push (vector (if d (iso-of-abs d) "")
                              (or (get-text-property (point) 'type) "")
                              (string-trim (or (get-text-property (point) 'extra) ""))
                              (let ((tm (get-text-property (point) 'time-of-day))) (if tm tm -1))
                              (or (org-with-point-at m (let ((h (nth 4 (org-heading-components)))) (if (string-match "[ETK][0-9]+" h) (match-string 0 h) h))) "")
                              (or (get-text-property (point) 'org-category) "")
                              (or (get-text-property (point) 'todo-state) ""))
                        rows))
             ((and d (get-text-property (point) 'org-agenda-date-header)) (push (iso-of-abs d) days))))
          (forward-line 1))))
    (list (vconcat (nreverse days)) (vconcat (nreverse rows)))))
(let* ((cases (with-temp-buffer (insert-file-contents (getenv "ORACLE_IN")) (json-parse-string (buffer-string) :object-type 'alist :array-type 'list :null-object nil)))
       (out '()))
  (ignore-errors (org-agenda-list nil "2026-10-11" 'day)) (when (get-buffer "*Org Agenda*") (kill-buffer "*Org Agenda*"))
  (dolist (c cases)
    (let* ((vars (cdr (assq 'vars c))) (sorting (cdr (assq 'sorting c))) (wd (cdr (assq 'weekday c)))
           (binds (append (list (list 'org-agenda-files (list 'quote (list (cdr (assq 'file c))))))
                          (mapcar (lambda (v) (let ((x (car (read-from-string (cdr v))))) (list (car v) (if (and (consp x) (not (eq (car x) 'quote))) (list 'quote x) x)))) vars)
                          (when sorting (list (list 'org-agenda-sorting-strategy (list 'quote (car (read-from-string sorting))))))
                          (when wd (list (list 'org-agenda-start-on-weekday (if (equal wd "nil") nil wd))))))
           (view (cdr (assq 'view c))) (query (cdr (assq 'query c))) (key (cdr (assq 'key c)))
           (span (let ((sp (or (cdr (assq 'span c)) "day"))) (if (string-match-p "^[0-9]+$" sp) (string-to-number sp) (intern sp)))) (date (cdr (assq 'date c))))
      (condition-case e
          (progn
            ;; the first listing of a session leaves out deadlines: list once with the same settings and throw it away
            (when (eq c (car cases)) (eval \`(let ,binds ,(view-form view nil date span key)) t) (when (get-buffer "*Org Agenda*") (kill-buffer "*Org Agenda*")))
            (eval \`(let ,binds ,(view-form view query date span key)) t)
            (let ((r (scan)))
              (push (list (cons 'id (cdr (assq 'id c))) (cons 'days (nth 0 r)) (cons 'rows (nth 1 r))) out)))
        (error (push (list (cons 'id (cdr (assq 'id c))) (cons 'error (error-message-string e))) out)))
      (when (get-buffer "*Org Agenda*") (kill-buffer "*Org Agenda*"))))
  (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (vconcat (nreverse out))))))
`;
const elFile = path.join(dir, 'run.el');
fs.writeFileSync(elFile, el);

const results = [];
const BATCH = 25;
for (let i = 0; i < SCENARIOS.length; i += BATCH) {
  const batch = SCENARIOS.slice(i, i + BATCH).map((s) => ({ ...s, file: files[s.doc] }));
  const inFile = path.join(dir, `in-${i}.json`);
  const outFile = path.join(dir, `out-${i}.json`);
  fs.writeFileSync(inFile, JSON.stringify(batch));
  const r = spawnSync('faketime', ['-f', `@${NOW}`, 'emacs', '--batch', '-Q', '-l', elFile], { env: { ...process.env, TZ: 'America/New_York', ORACLE_IN: inFile, ORACLE_OUT: outFile }, encoding: 'utf8', input: '', timeout: 600000 });
  if (r.status !== 0) {
    console.error(r.stderr || r.error);
    process.exit(1);
  }
  results.push(...JSON.parse(fs.readFileSync(outFile, 'utf8')));
  process.stdout.write(`${Math.min(i + BATCH, SCENARIOS.length)}/${SCENARIOS.length}\r`);
}
const version = spawnSync('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { encoding: 'utf8' }).stdout.trim();
fs.writeFileSync(new URL('../test/fixtures/oracle-agenda.json', import.meta.url), JSON.stringify({ emacs: version, now: NOW, tz: 'America/New_York', scenarios: SCENARIOS.map((s, i) => ({ ...s, emacs: results[i] })) }) + '\n');
const errors = results.filter((r) => r.error).length;
console.log(`\nwrote ${SCENARIOS.length} scenarios from Emacs ${version}, ${errors} errors, ${results.reduce((n, r) => n + (r.rows?.length ?? 0), 0)} rows`);
