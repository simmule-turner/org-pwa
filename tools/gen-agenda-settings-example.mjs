#!/usr/bin/env node
/**
 * Writes examples/agenda-settings.org. Each scenario of tools/agenda-settings-cases.mjs is run in Emacs 29.3 over the sample entries
 * with its settings, and the rows Emacs shows are written under it. test/example-agenda-settings.test.js holds the app to them.
 *
 *   node tools/gen-agenda-settings-example.mjs     (needs emacs on the PATH; time zone America/New_York)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DAY, INTRO, SAMPLE, SCENARIOS } from './agenda-settings-cases.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-settings-'));
const sample = path.join(dir, 'agenda-settings.org');
fs.writeFileSync(sample, '#+CATEGORY: work\n#+TODO: TODO NEXT | DONE\n' + SAMPLE);

const el = `
(require 'org-agenda) (require 'json)
(setq org-agenda-files (list (getenv "SAMPLE")) org-agenda-use-time-grid nil org-agenda-tags-column 0
      org-agenda-window-setup 'current-window org-agenda-sticky nil inhibit-message t)
(defun rows ()
  (let (r)
    (with-current-buffer "*Org Agenda*"
      (save-excursion
        (goto-char (point-min))
        (while (not (eobp))
          (when (get-text-property (point) 'org-hd-marker)
            (push (string-trim-right (buffer-substring-no-properties (line-beginning-position) (line-end-position))) r))
          (forward-line 1))))
    (nreverse r)))
(let* ((c (json-parse-string (getenv "CASE") :object-type 'alist :array-type 'list)))
  (dolist (form (cdr (assq 'setq c))) (eval (car (read-from-string form)) t))
  (ignore-errors (org-agenda-list nil "${DAY}" 'day)) (when (get-buffer "*Org Agenda*") (kill-buffer "*Org Agenda*")) ; the first run of a session leaves the deadlines out
  (let ((kind (cdr (assq 'kind c))))
    (cond ((equal kind "agenda") (condition-case e (progn (org-agenda-list nil "${DAY}" 'day) (princ (json-encode (vconcat (rows)))))
                                   (error (princ (json-encode (vector (error-message-string e)))))))
          ((equal kind "search") (org-search-view nil (cdr (assq 'query c))) (princ (json-encode (vconcat (rows)))))
          ((equal kind "match") (org-tags-view nil (cdr (assq 'query c))) (princ (json-encode (vconcat (rows)))))
          (t (let ((out (with-output-to-string (funcall (eval (car (read-from-string (cdr (assq 'fn c)))) t) (cdr (assq 'match c))))))
               (princ (json-encode (vconcat (split-string (string-trim-right out) "\\n")))))))))
`;
const elFile = path.join(dir, 'run.el');
fs.writeFileSync(elFile, el);

/** @param {{ vars: Record<string, string> }} c */
const setqForms = (c) => Object.entries(c.vars).map(([name, value]) => `(setq ${name} ${value})`);

const out = [INTRO.trimEnd(), '', SAMPLE.trimEnd()];
for (const c of SCENARIOS) {
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, TZ: 'America/New_York', SAMPLE: sample, CASE: JSON.stringify({ ...c, setq: setqForms(c) }) }, encoding: 'utf8', input: '' });
  if (r.status !== 0) throw new Error(`${c.id}\n${r.stderr}`);
  const rows = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
  out.push('', `* ${c.title}`, c.text, '');
  const forms = setqForms(c);
  if (forms.length) out.push('#+begin_src emacs-lisp', ...forms, '#+end_src', '');
  if (c.kind === 'search' || c.kind === 'match') out.push(`The query is =${c.query}=.`, '');
  if (c.kind === 'function') out.push('#+begin_src emacs-lisp', `(setq org-agenda-custom-commands '(("x" "Mine" ${c.fn} "${c.match}")))`, '#+end_src', '');
  out.push(`#+NAME: ${c.id}`, '#+begin_example', ...rows, '#+end_example');
}
out.push(
  '',
  '* Where the app differs from Emacs',
  'Nothing in the examples above differs.',
  '',
);
fs.writeFileSync(new URL('../examples/agenda-settings.org', import.meta.url), out.join('\n'));
console.log('wrote examples/agenda-settings.org');
