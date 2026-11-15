#!/usr/bin/env node
/**
 * Writes test/fixtures/file-category-oracle.json: the category Emacs 29.3 gives each heading of the category documents of
 * tools/oracle-agenda-cases.mjs (org-get-category, org-entry-get, ARCHIVE_CATEGORY of org-archive-subtree, the CATEGORY column of a
 * clock table and of a column view, CATEGORIES of org-icalendar-export-to-ics), in a file named after the document.
 * test/file-category-oracle.test.js holds the app's modules to it.
 *   node tools/gen-file-category-oracle.mjs   (needs emacs on the PATH)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DOCS, stamp } from './oracle-agenda-cases.mjs';

export const CLOCK = 'CLOCK: [2026-10-11 Sun 10:00]--[2026-10-11 Sun 11:00] =>  1:00';
export const CLOCK_PARAMS = ':scope file :maxlevel 4 :properties ("CATEGORY") :tstart "2026-10-11" :tend "2026-10-12" :link nil';
export const COLUMNS_FORMAT = '%ITEM %CATEGORY';
/** @returns {Record<string, string>} the category documents, by name */
export function categoryDocs() {
  return Object.fromEntries(Object.entries(DOCS).filter(([name]) => name.startsWith('ctx-cat-')));
}
/** The document as the clock table is asked of it: a clock instead of the schedule. @param {string} text */
export const clockText = (text) => text.replaceAll(`SCHEDULED: ${stamp(0)}`, CLOCK);

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-category-'));
  for (const sub of ['plain', 'clock', 'cols', 'ical', 'archive']) fs.mkdirSync(path.join(dir, sub));
  const docs = categoryDocs();
  for (const [name, text] of Object.entries(docs)) {
    fs.writeFileSync(path.join(dir, 'plain', `${name}.org`), text);
    fs.writeFileSync(path.join(dir, 'clock', `${name}.org`), `${clockText(text)}#+BEGIN: clocktable ${CLOCK_PARAMS}\n#+END:\n`);
    fs.writeFileSync(path.join(dir, 'cols', `${name}.org`), `${text}#+BEGIN: columnview :id global :format "${COLUMNS_FORMAT}"\n#+END:\n`);
    fs.writeFileSync(path.join(dir, 'ical', `${name}.org`), text);
  }
  const el = `(require 'org) (require 'ox-icalendar) (require 'org-clock) (require 'org-colview) (require 'json)
(setq org-icalendar-use-scheduled '(event-if-todo-not-done event-if-not-todo) user-full-name "" make-backup-files nil org-archive-save-p nil)
(defun my-headings (f)
  (let (r) (with-current-buffer (find-file-noselect f) (org-mode) (goto-char (point-min))
    (while (re-search-forward "^\\\\*+ " nil t) (beginning-of-line) (push (list (org-get-category) (or (org-entry-get nil "CATEGORY") "nil")) r) (end-of-line))
    (set-buffer-modified-p nil) (kill-buffer)) (nreverse r)))
(defun my-count (f) (with-current-buffer (find-file-noselect f) (org-mode) (prog1 (how-many "^\\\\*+ " (point-min) (point-max)) (set-buffer-modified-p nil) (kill-buffer))))
(defun my-archive (f i)
  (let ((org-archive-location (concat (file-name-directory f) "../archive/%s_archive::")) (n 0))
    (with-current-buffer (find-file-noselect f) (org-mode) (goto-char (point-min))
      (dotimes (_ (1+ i)) (re-search-forward "^\\\\*+ " nil t)) (beginning-of-line)
      (org-archive-subtree) (set-buffer-modified-p nil) (kill-buffer))
    (let ((a (concat (file-name-directory f) "../archive/" (file-name-base f) ".org_archive")))
      (prog1 (with-temp-buffer (insert-file-contents a) (if (re-search-forward "^[ \\t]*:ARCHIVE_CATEGORY:\\\\(?: +\\\\(.*\\\\)\\\\)?$" nil t) (or (match-string 1) "") "nil")) (let ((b (find-buffer-visiting a))) (when b (with-current-buffer b (set-buffer-modified-p nil)) (kill-buffer b))) (delete-file a)))))
(defun my-clock (f) (with-current-buffer (find-file-noselect f) (org-mode) (org-update-all-dblocks)
  (prog1 (buffer-substring-no-properties (progn (goto-char (point-min)) (re-search-forward "^#\\\\+BEGIN: clocktable") (line-beginning-position)) (point-max)) (set-buffer-modified-p nil) (kill-buffer))))
(defun my-columns (f) (with-current-buffer (find-file-noselect f) (org-mode) (org-update-all-dblocks)
  (prog1 (buffer-substring-no-properties (progn (goto-char (point-min)) (re-search-forward "^#\\\\+BEGIN: columnview") (line-beginning-position)) (point-max)) (set-buffer-modified-p nil) (kill-buffer))))
(defun my-ical (f) (with-current-buffer (find-file-noselect f) (org-mode) (org-icalendar-export-to-ics) (set-buffer-modified-p nil) (kill-buffer))
  (with-temp-buffer (insert-file-contents (concat (file-name-sans-extension f) ".ics")) (let (r) (goto-char (point-min)) (while (re-search-forward "^CATEGORIES:\\\\(.*\\\\)$" nil t) (push (match-string 1) r)) (nreverse r))))
(let (out)
  (dolist (name (json-parse-string (getenv "NAMES") :array-type 'list))
    (let* ((plain (concat (getenv "DIR") "/plain/" name ".org")) (n (my-count plain)))
      (push (list (cons 'name name) (cons 'headings (vconcat (mapcar (lambda (x) (vconcat x)) (my-headings plain))))
                  (cons 'archive (vconcat (let (r) (dotimes (i n) (push (my-archive plain i) r)) (nreverse r))))
                  (cons 'clock (my-clock (concat (getenv "DIR") "/clock/" name ".org")))
                  (cons 'columns (my-columns (concat (getenv "DIR") "/cols/" name ".org")))
                  (cons 'ical (vconcat (my-ical (concat (getenv "DIR") "/ical/" name ".org")))))
            out)))
  (with-temp-file (getenv "OUT") (insert (json-encode (vconcat (nreverse out))))))`;
  const elFile = path.join(dir, 'run.el');
  fs.writeFileSync(elFile, el);
  const outFile = path.join(dir, 'out.json');
  const r = spawnSync('faketime', ['-f', '@2026-10-11 16:30:00', 'emacs', '--batch', '-Q', '-l', elFile], { env: { ...process.env, TZ: 'America/New_York', DIR: dir, OUT: outFile, NAMES: JSON.stringify(Object.keys(docs)) }, encoding: 'utf8', input: '', timeout: 600000 });
  if (r.status !== 0) { console.error(r.stderr || r.error); process.exit(1); }
  const results = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const clean = (/** @type {string} */ s) => s.replace(/Clock summary at \[[^\]]*\]/, 'Clock summary at [X]').trimEnd();
  const out = results.map((/** @type {any} */ x) => ({ ...x, text: docs[x.name], clock: clean(x.clock) }));
  fs.writeFileSync(new URL('../test/fixtures/file-category-oracle.json', import.meta.url), JSON.stringify(out).replace(/\},\{/g, '},\n{') + '\n');
  console.log(`${out.length} documents`);
}
