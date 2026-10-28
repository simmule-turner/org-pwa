#!/usr/bin/env node
/**
 * Writes examples/logging.org: each case is a heading before and after its state is set, with the note typed when the state asks for
 * one. The "after" is what Emacs 29.3 (org-todo, then org-store-log-note) left; test/example-logging.test.js holds the app to it.
 * What a plain state change writes is in examples/todo-states.org.
 *
 *   node tools/gen-example-logging.mjs        (needs emacs and faketime on the PATH; the clock is New York time)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NOW = '2026-10-11 16:30:00';
/** @type {{ title: string, text: string, org: string, state: string, note?: string, find?: string }[]} */
export const CASES = [
  { title: 'A note when a state is entered', text: 'An =@= on a keyword asks for a note each time the heading enters it. The item and the note go together.', org: '#+TODO: TODO NEXT(n@) | DONE(d!)\n* TODO Call the bank\nSCHEDULED: <2026-10-12 Mon>\nThe number is on the card.', state: 'NEXT', note: 'Waiting for the card' },
  { title: 'A note of several lines', text: 'Every line after the first is indented under the item.', org: '#+TODO: TODO NEXT(n@) | DONE(d!)\n* TODO Call the bank', state: 'NEXT', note: 'Waiting for the card.\nPat said Tuesday.' },
  { title: 'A note left empty', text: 'Leaving the note empty keeps the item without text.', org: '#+TODO: TODO NEXT(n@) | DONE(d!)\n* TODO Call the bank', state: 'NEXT', note: '' },
  { title: 'A time stamp when a state is left', text: '=NEXT(n/!)= does not log on the way in, but logs a time stamp on the way out, whatever the next state\'s own setting.', org: '#+TODO: TODO NEXT(n/!) | DONE(d)\n* NEXT Call the bank', state: 'DONE' },
  { title: 'Entering with a note, leaving with a time stamp', text: '=NEXT(n@/!)= asks for a note on the way in; on the way out it writes only the item.', org: '#+TODO: TODO NEXT(n@/!) | DONE(d)\n* NEXT Call the bank', state: 'TODO' },
  { title: 'A note when a task is closed', text: '=#+STARTUP: lognotedone= asks for a note on the way to a done state and writes =CLOSED:=. The note item is "CLOSING NOTE".', org: '#+STARTUP: lognotedone\n* TODO Send the form\nSCHEDULED: <2026-10-12 Mon>', state: 'DONE', note: 'Mailed it with the receipt.' },
  { title: 'A note for a repeating task', text: '=#+STARTUP: lognoterepeat= asks for a note each time a repeating task is marked done.', org: '#+STARTUP: lognoterepeat\n* TODO Water the plants\nSCHEDULED: <2026-10-05 Mon +1w>', state: 'DONE', note: 'Gave the ferns extra.' },
  { title: 'One subtree logs; the rest does not', text: 'The =LOGGING= property takes the same words as =#+STARTUP:= and is inherited, so everything below this heading gets =CLOSED:= when it is done.', org: '* Taxes\n:PROPERTIES:\n:LOGGING: logdone\n:END:\n** TODO File the form', state: 'DONE', find: 'File the form' },
  { title: 'One subtree logs into a drawer', text: '=LOG_INTO_DRAWER: t= puts the log items of this subtree in =:LOGBOOK:=.', org: '#+TODO: TODO NEXT(n!) | DONE(d!)\n* Taxes\n:PROPERTIES:\n:LOG_INTO_DRAWER: t\n:END:\n** TODO File the form\n* TODO Call Pat', state: 'NEXT', find: 'File the form' },
  { title: 'Logging switched off for a subtree', text: '=LOGGING: nil= turns off =CLOSED:= and repeat logging for the subtree, even when the file asks for them.', org: '#+STARTUP: logdone\n* Taxes\n:PROPERTIES:\n:LOGGING: nil\n:END:\n** TODO File the form', state: 'DONE', find: 'File the form' },
];

const el = `
(require 'org) (require 'cl-lib) (require 'json)
(defun run-case (org state note find)
  (cl-letf (((symbol-function 'y-or-n-p) (lambda (&rest _) t)))
    (with-temp-buffer
      (insert org) (org-mode) (goto-char (point-min))
      (if find (re-search-forward (concat "^\\\\*+ \\\\(?:[A-Z]+ \\\\)?" (regexp-quote find))) (re-search-forward "^\\\\*+ "))
      (beginning-of-line)
      (let ((inhibit-message t) (message-log-max nil))
        (org-todo state) (run-hooks 'post-command-hook)
        (let ((b (get-buffer "*Org Note*")))
          (when (and b note) (with-current-buffer b (insert note) (org-store-log-note)))))
      (buffer-string))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case (cdr (assq 'org c)) (cdr (assq 'state c)) (cdr (assq 'note c)) (cdr (assq 'find c))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;

if (process.argv[1] && new URL(import.meta.url).pathname === path.resolve(process.argv[1])) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-book-'));
  fs.writeFileSync(path.join(dir, 'run.el'), el);
  fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(CASES.map((c) => ({ org: c.org + '\n', state: c.state, note: c.note ?? null, find: c.find ?? null }))));
  const r = spawnSync('faketime', ['-f', `@${NOW}`, 'emacs', '--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, TZ: 'America/New_York', ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
  if (r.status !== 0) {
    console.error(r.stderr || r.error);
    process.exit(1);
  }
  const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
  const esc = (/** @type {string} */ t) => t.trimEnd().split('\n').map((l) => (/^\s*(\*|#\+)/.test(l) ? ',' + l : l)).join('\n');
  let out = `#+TITLE: Logging
#+STARTUP: showall

A cookbook for the notes and log items that go with a change of TODO state. What a plain change writes is in =todo-states.org=; this file adds the keyword settings with =@=, =!= and =/=, notes, and the =LOGGING= and =LOG_INTO_DRAWER= properties. Each section shows a heading before, and after the state in the title is set, with the note typed when one is asked for; the clock reads 2026-10-11 16:30. The "after" texts are what Emacs 29.3 (Org 9.6.15) left. Lines that start with =*= or =#+= carry a comma, as org requires inside a block.

A keyword's setting is written in the =#+TODO:= line in parentheses: its fast key, then =@= (ask for a note) or =!= (write a time stamp) for entering the state, and after a =/= the same for leaving it.
`;
  CASES.forEach((c, i) => {
    const typed = c.note === undefined ? '' : c.note === '' ? ' and leaving the note empty' : ` and typing the note "${c.note.replace(/\n/g, ' / ')}"`;
    out += `\n* ${c.title}\n${c.text}\n\nBefore:\n#+BEGIN_SRC org\n${esc(c.org)}\n#+END_SRC\n\nAfter setting ${c.state}${c.find ? ` on =${c.find}=` : ''}${typed}:\n#+BEGIN_SRC org\n${esc(results[i])}\n#+END_SRC\n`;
  });
  out += `
* Where the app differs from Emacs
- When the app starts a =:LOGBOOK:= on the last heading of a file, and nothing follows the heading, it leaves no blank line after =:END:=; Emacs leaves one.
- The differences listed in =todo-states.org= apply here too: the note is asked for after the state changes, and a skipped note writes no item.
`;
  fs.writeFileSync(new URL('../examples/logging.org', import.meta.url), out);
  console.log(`${CASES.length} cases written`);
}
