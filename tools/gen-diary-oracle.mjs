#!/usr/bin/env node
/**
 * Writes test/fixtures/diary/expected.json: for each case in test/fixtures/diary/cases.json (a diary file, a calendar-date-style,
 * the variables), what Emacs 29.3 lists for every day of 2026 and 2027:
 *   org   what the Org agenda shows (org-get-entries-from-diary), holidays included
 *   raw   the entries diary-list-entries finds, each as the text Emacs holds for it
 *   hol   the holidays of that day (Emacs's default groups the app has: general, Christian, Hebrew, Islamic and Bahá'í)
 *
 *   node tools/gen-diary-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diary-oracle-'));
const src = 'test/fixtures/diary';
for (const f of fs.readdirSync(src).filter((n) => n.endsWith('.diary'))) {
  fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(src, f), 'utf8').replaceAll('@DIR@', dir));
}
const cases = JSON.parse(fs.readFileSync(path.join(src, 'cases.json'), 'utf8')).map((c) => ({ ...c, path: path.join(dir, c.file) }));

const el = `
(require 'org-agenda) (require 'diary-lib) (require 'holidays) (require 'json)
(setq calendar-holidays (append holiday-general-holidays holiday-christian-holidays holiday-hebrew-holidays holiday-islamic-holidays holiday-bahai-holidays))
(defun kget (k alist) (cdr (assq k alist)))
(defun day-record (date)
  (let* ((org (mapcar #'substring-no-properties (let ((inhibit-message t)) (org-get-entries-from-diary date))))
         (raw (let ((inhibit-message t) (diary-display-function #'ignore))
                (mapcar (lambda (e) (substring-no-properties (nth 1 e))) (diary-list-entries date 1 t))))
         (hol (if diary-show-holidays-flag (mapcar #'substring-no-properties (calendar-check-holidays date)) '())))
    (when (or org raw hol)
      (list (cons 'd (format "%04d-%02d-%02d" (nth 2 date) (nth 0 date) (nth 1 date)))
            (cons 'org (vconcat org)) (cons 'raw (vconcat raw)) (cons 'hol (vconcat hol))))))
(defun case-record (c)
  (let* ((calendar-date-style (intern (kget 'style c)))
         ;; what (calendar-set-date-style STYLE) sets; a plain setq of the style leaves the American forms in place
         (diary-date-forms (symbol-value (intern (format "diary-%s-date-forms" (kget 'style c)))))
         (diary-file (kget 'path c))
         (diary-abbreviated-year-flag (not (eq (kget 'abbreviatedYear c) :json-false)))
         (diary-show-holidays-flag (not (eq (kget 'showHolidays c) :json-false)))
         (diary-list-entries-hook (mapcar #'intern (kget 'hooks c)))
         (days '())
         (abs (calendar-absolute-from-gregorian '(1 1 2026)))
         (end (calendar-absolute-from-gregorian '(12 31 2027))))
    (while (<= abs end)
      (let* ((gr (calendar-gregorian-from-absolute abs))
             (rec (day-record (list (nth 0 gr) (nth 1 gr) (nth 2 gr)))))
        (when rec (push rec days)))
      (setq abs (1+ abs)))
    (list (cons 'name (kget 'name c)) (cons 'days (vconcat (nreverse days))))))
(let ((cases (json-parse-string (getenv "DIARY_CASES") :object-type 'alist :array-type 'list :null-object nil :false-object :json-false)))
  (with-temp-file (getenv "ORACLE_OUT")
    (insert (json-encode (vconcat (mapcar #'case-record cases))))))
`;
const elFile = path.join(dir, 'run.el');
const outFile = path.join(dir, 'out.json');
fs.writeFileSync(elFile, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, TZ: 'America/New_York', DIARY_CASES: JSON.stringify(cases), ORACLE_OUT: outFile }, encoding: 'utf8', input: '', maxBuffer: 1 << 28 });
if (r.status !== 0) { console.error(r.stderr || r.error); process.exit(1); }
const rows = JSON.parse(fs.readFileSync(outFile, 'utf8'));
fs.writeFileSync(path.join(src, 'expected.json'), JSON.stringify({ emacs: '29.3', cases: rows }) + '\n');
console.log(rows.map((c) => `${c.name}: ${c.days.length} days`).join('\n'));
