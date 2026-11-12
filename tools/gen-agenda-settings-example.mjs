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
import { DAY, INTRO, OTHER, SAMPLE, SCENARIOS, WEEK } from './agenda-settings-cases.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-settings-'));
const sample = path.join(dir, 'agenda-settings.org');
const header = '#+CATEGORY: work\n#+TODO: TODO NEXT | DONE\n';
fs.writeFileSync(sample, header + SAMPLE);
const weekSample = path.join(dir, 'week.org');
fs.writeFileSync(weekSample, header + WEEK);

const el = `
(require 'org-agenda) (require 'json)
(setq org-agenda-files (list (getenv "SAMPLE")) org-agenda-use-time-grid nil org-agenda-tags-column 0
      org-agenda-window-setup 'current-window org-agenda-sticky nil inhibit-message t)
(defun rows (&optional headers)
  (let (r)
    (with-current-buffer "*Org Agenda*"
      (save-excursion
        (goto-char (point-min))
        (while (not (eobp))
          (when (or (get-text-property (point) 'org-hd-marker) (and headers (get-text-property (point) 'org-agenda-date-header)))
            (push (string-trim-right (buffer-substring-no-properties (line-beginning-position) (line-end-position))) r))
          (forward-line 1))))
    (nreverse r)))
(let* ((c (json-parse-string (getenv "CASE") :object-type 'alist :array-type 'list)))
  (dolist (form (cdr (assq 'setq c))) (eval (car (read-from-string form)) t))
  (ignore-errors (org-agenda-list nil "${DAY}" 'day)) (when (get-buffer "*Org Agenda*") (kill-buffer "*Org Agenda*")) ; the first run of a session leaves the deadlines out
  (let ((kind (cdr (assq 'kind c))))
    (cond ((equal kind "stuck") (org-agenda-list-stuck-projects) (princ (json-encode (vconcat (rows)))))
          ((and (equal kind "agenda") (cdr (assq 'span c))) (org-agenda-list nil (let ((a (cdr (assq 'startArg c)))) (and (not (equal a "")) a))) (princ (json-encode (vconcat (rows t)))))
          ((equal kind "agenda") (condition-case e (progn (org-agenda-list nil "${DAY}" 'day) (princ (json-encode (vconcat (rows)))))
                                   (error (princ (json-encode (vector (error-message-string e)))))))
          ((equal kind "search") (org-search-view nil (cdr (assq 'query c))) (princ (json-encode (vconcat (rows)))))
          ((equal kind "match") (org-tags-view nil (cdr (assq 'query c))) (princ (json-encode (vconcat (rows)))))
          (t (let ((out (with-output-to-string (funcall (eval (car (read-from-string (cdr (assq 'fn c)))) t) (cdr (assq 'match c))))))
               (princ (json-encode (vconcat (split-string (string-trim-right out) "\\n")))))))))
`;
fs.writeFileSync(path.join(dir, 'other.org'), OTHER);
const commandEl = `
(require 'org-agenda) (require 'json)
(setq org-agenda-files (list (getenv "SAMPLE")) org-agenda-use-time-grid nil org-agenda-tags-column 0
      org-agenda-window-setup 'current-window org-agenda-sticky nil inhibit-message t)
(let ((org-agenda-files (list (getenv "SAMPLE")))) (ignore-errors (org-agenda-list nil "${DAY}" 'day)) (when (get-buffer "*Org Agenda*") (kill-buffer "*Org Agenda*")))
(eval (car (read-from-string (getenv "COMMANDS"))) t)
(org-agenda nil "x")
(with-current-buffer "*Org Agenda*"
  (let (acc)
    (goto-char (point-min))
    (while (not (eobp))
      (let ((line (string-trim-right (buffer-substring-no-properties (line-beginning-position) (line-end-position)))))
        (unless (string-match-p "^\\(Press \`\\|  +([0-9]+)[A-Z]\\)" line) (push line acc)))
      (forward-line 1))
    (princ (json-encode (vconcat (nreverse acc))))))
`;
const commandElFile = path.join(dir, 'command.el');
fs.writeFileSync(commandElFile, commandEl);
const elFile = path.join(dir, 'run.el');
fs.writeFileSync(elFile, el);

/** @param {{ vars: Record<string, string> }} c */
const setqForms = (c) => Object.entries(c.vars).map(([name, value]) => `(setq ${name} ${value})`);

const out = [INTRO.trimEnd(), '', SAMPLE.trimEnd()];
let weekShown = false;
for (const c of SCENARIOS) {
  if (c.kind === 'command') { // the whole *Org Agenda* buffer of a custom command, on Monday 15 March 2027
    const commands = c.commands.replace(/"other\.org"/g, JSON.stringify(path.join(dir, 'other.org')));
    const run = spawnSync('faketime', ['-f', '@2027-03-15 08:00:00', 'emacs', '--batch', '-Q', '-l', commandElFile], { env: { ...process.env, TZ: 'America/New_York', SAMPLE: weekSample, COMMANDS: commands }, encoding: 'utf8', input: '' });
    if (run.status !== 0) throw new Error(`${c.id}\n${run.stderr}`);
    const lines = JSON.parse(run.stdout.slice(run.stdout.indexOf('[')));
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (!weekShown) {
      weekShown = true;
      out.push('', '* A week of entries', 'The scenarios from here on use a second sample: the week of Monday 15 March 2027, and two projects for the stuck view. Its entries are in the block below.', '', '#+begin_src org', ...WEEK.trimEnd().split('\n'), '#+end_src');
    }
    out.push('', `* ${c.title}`, c.text, '', '#+begin_src emacs-lisp', ...c.commands.split('\n'), '#+end_src', '');
    if (c.id === 'command-block') out.push('The file =other.org= is:', '', '#+begin_src org', ...OTHER.trimEnd().split('\n'), '#+end_src', '');
    out.push(`#+NAME: ${c.id}`, '#+begin_example', ...lines, '#+end_example');
    continue;
  }
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, TZ: 'America/New_York', SAMPLE: c.sample === 'week' ? weekSample : sample, CASE: JSON.stringify({ ...c, startArg: c.vars['org-agenda-start-day'] ? '' : DAY, setq: setqForms(c) }) }, encoding: 'utf8', input: '' });
  if (r.status !== 0) throw new Error(`${c.id}\n${r.stderr}`);
  const rows = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
  if (c.sample === 'week' && !weekShown) {
    weekShown = true;
    out.push('', '* A week of entries', 'The scenarios from here on use a second sample: the week of Monday 15 March 2027, and two projects for the stuck view. Its entries are in the block below.', '', '#+begin_src org', ...WEEK.trimEnd().split('\n'), '#+end_src');
  }
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
  'Three things. With a value that cannot be used (the section above), Emacs stops with its own error text; the app says which variable holds the value and what it was, and skips what needed it, and a variable that is not set keeps its default. A file a command names with =org-agenda-files= is written with its source in the app (=local:other.org=, =github:...=, =webdav:...=), where Emacs takes a path. The lines Emacs puts under the heading of a single command ("Press ..." with its keys) are not shown, and the text of a command is not the interactive Agenda: it has no keys.',
  '',
);
fs.writeFileSync(new URL('../examples/agenda-settings.org', import.meta.url), out.join('\n'));
console.log('wrote examples/agenda-settings.org');
