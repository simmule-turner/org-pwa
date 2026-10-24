#!/usr/bin/env node
/**
 * Writes test/fixtures/agenda-search/expected.json: for each case in tools/search-view-cases.json, the entries Emacs 29.3 lists in the
 * Agenda's Search view (org-search-view) or Match view (org-tags-view), as [file, line] in the order shown.
 *
 *   node tools/gen-search-view-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const src = 'test/fixtures/agenda-search';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-oracle-'));
for (const f of fs.readdirSync(src).filter((n) => n.endsWith('.org'))) fs.copyFileSync(path.join(src, f), path.join(dir, f));
const cases = JSON.parse(fs.readFileSync('tools/search-view-cases.json', 'utf8'));
const el = `
(require 'org-agenda) (require 'json)
(setq org-agenda-window-setup 'current-window org-agenda-sticky nil)
(defun kget (k alist) (cdr (assq k alist)))
(defun rows ()
  (let (r)
    (with-current-buffer org-agenda-buffer-name
      (save-excursion
        (goto-char (point-min))
        (while (not (eobp))
          (let ((m (get-text-property (point) 'org-hd-marker)))
            (when m (push (vector (file-name-nondirectory (buffer-file-name (marker-buffer m)))
                                  (with-current-buffer (marker-buffer m) (save-excursion (goto-char m) (line-number-at-pos)))) r)))
          (forward-line 1))))
    (vconcat (nreverse r))))
(defun run-case (c)
  (let* ((dir (getenv "SV_DIR"))
         (files (or (kget 'files c) '("work.org" "home.org")))
         (org-agenda-files (mapcar (lambda (f) (expand-file-name f dir)) files))
         (org-agenda-sorting-strategy (if (kget 'strategy c) (car (read-from-string (kget 'strategy c))) org-agenda-sorting-strategy))
         (org-agenda-search-view-always-boolean (and (kget 'vars c) (assq (quote org-agenda-search-view-always-boolean) (kget 'vars c)) t))
         (org-agenda-search-view-force-full-words (and (kget 'vars c) (assq (quote org-agenda-search-view-force-full-words) (kget 'vars c)) t))
         (org-use-tag-inheritance (if (and (kget 'vars c) (assq (quote org-use-tag-inheritance) (kget 'vars c))) nil t))
         (org-agenda-search-view-max-outline-level (let ((v (and (kget 'vars c) (assq (quote org-agenda-search-view-max-outline-level) (kget 'vars c))))) (if v (string-to-number (cdr v)) 0)))
         (todo (eq (kget 'todoOnly c) t))
         (inhibit-message t) (inhibit-read-only t))
    (when (get-buffer "*Org Agenda*") (kill-buffer "*Org Agenda*"))
    (condition-case err
        (progn
          (cond ((equal (kget 'kind c) "search") (org-search-view todo (kget 'query c)))
                ((equal (kget 'kind c) "command")
                 (let ((org-agenda-custom-commands (let ((v (car (read-from-string (kget 'commands c))))) (if (eq (car v) 'quote) (cadr v) v))))
                   (org-agenda nil (kget 'key c))))
                (t (org-tags-view todo (kget 'query c))))
          (list (cons 'name (kget 'name c)) (cons 'rows (rows))))
      (error (list (cons 'name (kget 'name c)) (cons 'error (error-message-string err)))))))
(let ((cases (json-parse-string (getenv "SV_CASES") :object-type 'alist :array-type 'list :false-object :json-false)))
  (let ((res (vconcat (mapcar #'run-case cases)))) (with-temp-file (getenv "SV_OUT") (insert (json-encode res)))))
`;
const elFile = path.join(dir, 'run.el');
const out = path.join(dir, 'out.json');
fs.writeFileSync(elFile, el);
const r = spawnSync('emacs', ['--batch', '-Q', '--eval', '(setq debug-on-error t)', '-l', elFile], { env: { ...process.env, TZ: 'America/New_York', SV_DIR: dir, SV_CASES: JSON.stringify(cases.map((c) => ({ ...c, todoOnly: c.todoOnly === true ? true : undefined }))), SV_OUT: out }, encoding: 'utf8', input: '', args: [], maxBuffer: 1 << 28 });
if (r.status !== 0) { console.error(r.stderr || r.error); process.exit(1); }
const rows = JSON.parse(fs.readFileSync(out, 'utf8'));
fs.writeFileSync(path.join(src, 'expected.json'), JSON.stringify({ emacs: '29.3', cases: rows }, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(rows.map((c) => `${c.name}: ${c.error ? 'ERROR ' + c.error : c.rows.length + ' rows'}`).join('\n'));
