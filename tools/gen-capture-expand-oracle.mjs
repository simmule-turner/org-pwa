#!/usr/bin/env node
/**
 * Writes test/fixtures/capture-expand-oracle.json: the text Emacs's org-capture-fill-template makes from a template, with the
 * answers to its prompts given in advance (clock 2026-10-11 16:30, New York time).
 *   node tools/gen-capture-expand-oracle.mjs   (needs emacs and faketime on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TZ = 'America/New_York';
const NOW = '2026-10-11 16:30:00';
const ctx = {
  killRing: 'last kill',
  initial: 'first line\nsecond line',
  annotation: '[[https://example.org/page][An example]]',
  fullName: 'Ada Lovelace',
  clockHeading: 'Write report',
  clockFile: '/home/u/work.org',
  originalFile: '/home/u/notes/ideas.org',
  linkProps: { ':link': 'https://example.org/page', ':description': 'An example', ':type': 'https' },
};
const T = [
  // times
  '%t', '%T', '%u', '%U', '%<%Y-%m-%d>', '%<%A %H:%M>', 'Meeting %U', '%<%B %e, %Y>', '%<%j>',
  // context
  '%a', '%A', '%l', '%L', '%i', '  %i', '- %i', '* TODO %i', '%c', '%n', '%k', '%K', '%f', '%F', '%:link', '%:description', '%:type', '%:nothing',
  // escapes
  '\\%t', '\\\\%t', '\\\\\\%t', '100%', '%%', '50%% done', '%z',
  // whitespace and ends
  '\n\n* TODO a', '* TODO a\n\n\n', '   \n', '', 'a\tb', '* a\n\tb', '%?', '* %?', '- %?\n  more', 'a %? b',
  // prompts
  '%^{Name}', '%^{Name}!', '%^{Name|Ada}', '%^{Name|Ada|Bob|Cy}', '%^{A} and %^{B}', '%^{A} %\\1', '%^{A} %^{B} %\\2 %\\1', '%\\3', '* %^{Title} %^g', '* %^{Title} :a:%^g', '%^G', '%^C', '%^L', '%^t', '%^T', '%^u', '%^U', '%^{Due}t', '%^{When}T',
  '* %^{Title}\n:PROPERTIES:\n:AUTHOR: %n\n:END:\n%?', '- [ ] %^{Item}\n  %U',
];
const answers = { strings: ['Grace', 'Hopper', 'Third'], tags: 'work:home', date: '2026-11-03 14:30', clip: 'chosen clip' };
const cases = T.map((template) => ({ template }));
const el = `
(require 'org) (require 'org-capture) (require 'cl-lib) (require 'json)
(defun run-case (template ctx ans)
  (let* ((strings (copy-sequence (cdr (assq 'strings ans))))
         (user-full-name (cdr (assq 'fullName ctx)))
         (kill-ring (list (cdr (assq 'killRing ctx))))
         (org-store-link-plist (list :initial (cdr (assq 'initial ctx)) :annotation (cdr (assq 'annotation ctx))
                                     :link "https://example.org/page" :description "An example" :type "https"))
         (org-capture--prompt-history-table (make-hash-table :test 'equal))
         (org-clock-marker (make-marker))
         (org-clock-heading (cdr (assq 'clockHeading ctx))))
    (with-temp-buffer
      (setq buffer-file-name (cdr (assq 'clockFile ctx)))
      (set-marker org-clock-marker (point) (current-buffer))
      (let ((buf (current-buffer)))
        (setq org-capture-plist (list :buffer buf :default-time (current-time)
                                      :original-file (cdr (assq 'originalFile ctx))
                                      :original-file-nondirectory (file-name-nondirectory (cdr (assq 'originalFile ctx)))))
        (cl-letf (((symbol-function 'org-completing-read)
                   (lambda (_prompt _coll &optional _p _r _i _h def &rest _)
                     (let ((a (pop strings))) (if (or (null a) (string= a "")) (or def "") a))))
                  ((symbol-function 'completing-read-multiple)
                   (lambda (&rest _) (split-string (cdr (assq 'tags ans)) ":" t)))
                  ((symbol-function 'read-string) (lambda (&rest _) (cdr (assq 'clip ans))))
                  ((symbol-function 'org-read-date)
                   (lambda (&rest _) (setq org-time-was-given (string-match-p ":" (cdr (assq 'date ans))))
                     (date-to-time (concat (cdr (assq 'date ans)) (if (string-match-p ":" (cdr (assq 'date ans))) ":00" " 00:00:00")))))
                  ((symbol-function 'org-global-tags-completion-table) (lambda (&rest _) nil))
                  ((symbol-function 'org-insert-link) (lambda (_i s) (insert "[[" s "]]"))))
          (let ((inhibit-message t))
            (org-capture-fill-template template)))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (in (json-read-from-string (buffer-string)))
         (ctx (cdr (assq 'ctx in))) (ans (cdr (assq 'answers in))) (out '()))
    (dolist (c (cdr (assq 'cases in)))
      (push (condition-case e (run-case (cdr (assq 'template c)) ctx ans) (error (format "ERROR %S" e))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capx-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify({ ctx, answers, cases }));
const r = spawnSync('faketime', ['-f', `@${NOW}`, 'emacs', '--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, TZ, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const res = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/capture-expand-oracle.json', JSON.stringify({ emacs: '29.3', tz: TZ, now: NOW, ctx, answers, cases: cases.map((c, i) => ({ ...c, emacs: res[i] })) }, null, 1) + '\n');
console.log(cases.length, 'cases,', res.filter((x) => x.startsWith('ERROR')).length, 'errors');
