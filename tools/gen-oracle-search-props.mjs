#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-search-props.json: what Emacs 29.3 (Org 9.6) answers for the cases in tools/search-props-cases.mjs --
 *   match      the headings org-map-entries selects for a tags/property match string, under tag and property inheritance settings
 *   headings   org-heading-components and the local tags of one heading line, under a #+TODO line
 *   todo       the keyword sets (org-todo-keywords-1, org-done-keywords, org-todo-sets, fast keys, logging) a #+TODO line defines
 * test/oracle-search-props.test.js holds the app to them.
 *
 *   node tools/gen-oracle-search-props.mjs      (needs emacs and faketime on the PATH; the clock is 2026-10-11 16:30 New York)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './search-props-cases.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const scenarios = [];
for (const s of C.TAG_SETTINGS) scenarios.push({ kind: 'tags', org: C.TAGS_DOC_TEXT, settings: s, queries: C.TAG_QUERIES });
for (const s of C.PROP_SETTINGS) scenarios.push({ kind: 'props', org: C.PROPS_DOC_TEXT, settings: s, queries: C.PROP_QUERIES });
for (const form of C.FILETAG_FORMS) for (const s of [C.TAG_SETTINGS[0], C.TAG_SETTINGS[1]]) scenarios.push({ kind: 'filetags', org: `#+FILETAGS: ${form}\n* H\n* I :own:\n** J\n`, settings: s, queries: C.FILETAG_QUERIES });
for (const s of C.TODO_SETTINGS) scenarios.push({ kind: 'todo-match', org: C.TODO_DOC, settings: s, queries: C.TODO_QUERIES });

const input = {
  scenarios, headings: { spec: C.HEADING_SPEC, lines: C.HEADING_LINES }, specs: C.TODO_SPECS,
  occur: { org: C.OCCUR_DOC, regexps: C.OCCUR_REGEXPS, plain: C.OCCUR_PLAIN }, allowed: C.ALLOWED_CASES,
};

const el = String.raw`
(require 'org) (require 'org-element) (require 'json) (require 'cl-lib)
(setq org-startup-folded nil)
(defun sp-str (v) (if (stringp v) v nil))
(defun sp-run-match (org settings queries)
  (let* ((dir (make-temp-file "spm" t)) (file (expand-file-name "fx.org" dir)))
    (with-temp-file file (insert org))
    (let ((buf (find-file-noselect file)) (out nil))
      (with-current-buffer buf
        (org-mode)
        (cl-progv '(org-use-tag-inheritance org-tags-exclude-from-inheritance org-use-property-inheritance)
            (list (eval (read (cdr (assq 'inherit settings)))) (eval (read (cdr (assq 'exclude settings)))) (eval (read (or (cdr (assq 'propInherit settings)) "nil"))))
          (let ((points (org-map-entries #'point t)))
            (dolist (q queries)
              (push (condition-case e
                        (list (cons 'ok (vconcat (mapcar (lambda (p) (1+ (cl-position p points))) (org-map-entries #'point q)))))
                      (error (list (cons 'error (error-message-string e)))))
                    out)))))
      (kill-buffer buf)
      (nreverse out))))
(defun sp-run-heading (spec line)
  (with-temp-buffer
    (insert spec line "\n") (org-mode)
    (goto-char (point-min)) (forward-line (cl-count ?\n spec))
    (condition-case e
        (if (not (org-at-heading-p)) (list (cons 'heading :json-false))
          (let* ((c (org-heading-components)))
            (list (cons 'heading t) (cons 'level (nth 0 c)) (cons 'todo (nth 2 c)) (cons 'priority (nth 3 c)) (cons 'title (nth 4 c))
                  (cons 'tags (vconcat (org-get-tags nil t)))
                  (cons 'element (let ((e (org-element-map (org-element-parse-buffer) 'headline #'identity nil t)))
                    (if e (list (cons 'level (org-element-property :level e)) (cons 'todo (org-element-property :todo-keyword e)) (cons 'priority (org-element-property :priority e))
                                (cons 'title (org-element-property :raw-value e)) (cons 'tags (vconcat (org-element-property :tags e)))
                                (cons 'commented (if (org-element-property :commentedp e) t :json-false)) (cons 'archived (if (org-element-property :archivedp e) t :json-false)))
                      (list (cons 'heading :json-false))))))))
      (error (list (cons 'error (error-message-string e)))))))
(defun sp-run-spec (spec)
  (with-temp-buffer
    (insert spec "\n* x\n") (condition-case e (progn (org-mode)
      (list (cons 'keywords (vconcat org-todo-keywords-1)) (cons 'done (vconcat org-done-keywords))
            (cons 'sets (vconcat (mapcar #'vconcat org-todo-sets)))
            (cons 'keys (vconcat (delq nil (mapcar (lambda (x) (and (consp x) (stringp (car x)) (list (cons 'k (car x)) (cons 'c (if (cdr x) (char-to-string (cdr x)) :json-false))))) org-todo-key-alist))))
            (cons 'log (vconcat (mapcar (lambda (x) (list (cons 'k (car x)) (cons 'v (format "%S" (cdr x))))) org-todo-log-states)))))
      (error (list (cons 'error (error-message-string e)))))))
(defun sp-occur (org re)
  (with-temp-buffer
    (insert org) (org-mode) (goto-char (point-min))
    (condition-case e
        (progn
          (when (string-match-p re "") (error "SKIPPED: the regexp matches the empty string"))
          (org-occur re)
          (let* ((lines (mapcar (lambda (o) (line-number-at-pos (overlay-start o))) org-occur-highlights))
                 (heads (let (hs) (goto-char (point-min)) (while (re-search-forward "^\\*+ " nil t) (push (line-number-at-pos (match-beginning 0)) hs)) (nreverse hs)))
                 (idx (mapcar (lambda (l) (let ((n 0) (k 0)) (dolist (h heads) (setq k (1+ k)) (when (<= h l) (setq n k))) n)) lines)))
            (org-remove-occur-highlights)
            (list (cons 'ok (vconcat (sort (delete-dups idx) #'<))))))
      (error (list (cons 'error (error-message-string e)))))))
(defun sp-allowed (org n global)
  (with-temp-buffer
    (insert org) (org-mode) (goto-char (point-min))
    (let ((org-global-properties (if (stringp global) (list (cons "Effort_ALL" global)) nil)))
      (condition-case e
          (progn (let ((k 0)) (while (and (< k n) (re-search-forward "^\\*+ " nil t)) (setq k (1+ k))) (beginning-of-line))
                 (list (cons 'ok (vconcat (org-property-get-allowed-values (point) "Effort")))))
        (error (list (cons 'error (error-message-string e))))))))
(with-temp-buffer
  (let ((coding-system-for-read (quote utf-8))) (insert-file-contents (getenv "ORACLE_IN")))
  (let* ((json-object-type 'alist) (json-array-type 'list) (in (json-read-from-string (buffer-string)))
         (scs (cdr (assq 'scenarios in))) (hd (cdr (assq 'headings in))) (specs (cdr (assq 'specs in))))
    (let ((coding-system-for-write (quote utf-8))) (with-temp-file (getenv "ORACLE_OUT")
      (insert (json-encode
        (list (cons 'scenarios (vconcat (mapcar (lambda (s) (vconcat (sp-run-match (cdr (assq 'org s)) (cdr (assq 'settings s)) (cdr (assq 'queries s))))) scs)))
              (cons 'headings (vconcat (mapcar (lambda (l) (sp-run-heading (cdr (assq 'spec hd)) l)) (cdr (assq 'lines hd)))))
              (cons 'specs (vconcat (mapcar #'sp-run-spec specs)))
              (cons 'occur (let ((o (cdr (assq 'occur in)))) (list (cons 'regexp (vconcat (mapcar (lambda (re) (sp-occur (cdr (assq 'org o)) re)) (cdr (assq 'regexps o)))))
                                                                   (cons 'plain (vconcat (mapcar (lambda (re) (sp-occur (cdr (assq 'org o)) (regexp-quote re))) (cdr (assq 'plain o))))))))
              (cons 'allowed (vconcat (mapcar (lambda (c) (sp-allowed (nth 0 c) (nth 1 c) (nth 2 c))) (cdr (assq 'allowed in))))))))))))
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprops-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(input));
const r = spawnSync('faketime', ['2026-10-11 16:30:00', 'emacs', '--batch', '-Q', '-l', path.join(dir, 'run.el')], {
  env: { ...process.env, LC_ALL: 'C.UTF-8', TZ: 'America/New_York', ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '',
});
if (r.status !== 0) { console.error(r.stderr.slice(-600)); process.exit(1); }
fs.writeFileSync('/tmp/sp-stderr.txt', r.stderr);
const res = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const fixture = {
  emacs: '29.3',
  scenarios: scenarios.map((s, i) => ({ kind: s.kind, org: s.org, settings: s.settings, cases: s.queries.map((q, j) => ({ query: q, emacs: res.scenarios[i][j] })) })),
  headings: { spec: C.HEADING_SPEC, cases: C.HEADING_LINES.map((l, i) => ({ line: l, emacs: res.headings[i] })) },
  specs: C.TODO_SPECS.map((s, i) => ({ spec: s, emacs: res.specs[i] })),
  occur: { org: C.OCCUR_DOC, regexp: C.OCCUR_REGEXPS.map((re, i) => ({ query: re, emacs: res.occur.regexp[i] })), plain: C.OCCUR_PLAIN.map((q, i) => ({ query: q, emacs: res.occur.plain[i] })) },
  allowed: C.ALLOWED_CASES.map(([org, heading, global], i) => ({ org, heading, global, emacs: res.allowed[i] })),
};
fs.writeFileSync(path.join(root, 'test', 'fixtures', 'oracle-search-props.json'), JSON.stringify(fixture).replace(/\},\{/g, '},\n{') + '\n');
const n = fixture.scenarios.reduce((a, s) => a + s.cases.length, 0);
const errs = fixture.scenarios.flatMap((s) => s.cases).filter((c) => c.emacs.error).length;
console.log(`${n} match cases (${errs} Emacs errors), ${fixture.headings.cases.length} headings, ${fixture.specs.length} keyword specs`);
