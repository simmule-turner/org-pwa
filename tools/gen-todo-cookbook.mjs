#!/usr/bin/env node
/**
 * Writes examples/todo-states.org: each case is a heading before and after marking it DONE (or another state), the "after"
 * being what Emacs (org-todo) left. test/examples-emacs.test.js holds the app to every pair.
 *
 *   node tools/gen-todo-cookbook.mjs        (needs emacs and faketime on the PATH; the clock is New York time)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TZ = 'America/New_York';
const NOW = '2026-10-11 16:30:00';
const cases = [
  { title: 'A repeating task', text: 'Marking a repeating task done moves its date on, stamps =LAST_REPEAT=, logs the completion and puts the state back.', org: '* TODO Water the plants\nSCHEDULED: <2026-10-05 Mon +1w>', state: 'DONE' },
  { title: 'Repeater +1d', text: '=+1d= adds one day to the old date, even if the result is still in the past.', org: '* TODO Cumulate\nSCHEDULED: <2026-10-05 Mon +1d>', state: 'DONE' },
  { title: 'Repeater ++1d', text: '=++1d= adds days until the date is in the future.', org: '* TODO Catch up\nSCHEDULED: <2026-10-05 Mon ++1d>', state: 'DONE' },
  { title: 'Repeater .+1d', text: '=.+1d= counts from today.', org: '* TODO Restart\nSCHEDULED: <2026-10-05 Mon .+1d>', state: 'DONE' },
  { title: 'Every repeating time stamp moves', text: 'A repeater in the title or text moves too, a time range keeps its end, and a =SCHEDULED= without a repeater is dropped.', org: '* TODO Standup <2026-10-05 Mon 09:00-09:15 +1w>\nSCHEDULED: <2026-10-05 Mon>\nDEADLINE: <2026-10-20 Tue +1m -3d>', state: 'DONE' },
  { title: 'Return to another state', text: '=REPEAT_TO_STATE= names the state a repeating task goes back to, if the file has it.', org: '#+TODO: TODO NEXT | DONE\n* TODO Review\nSCHEDULED: <2026-10-05 Mon +1d>\n:PROPERTIES:\n:REPEAT_TO_STATE: NEXT\n:END:', state: 'DONE' },
  { title: 'No repeat log', text: '=#+STARTUP: nologrepeat= leaves out =LAST_REPEAT= and the log item.', org: '#+STARTUP: nologrepeat\n* TODO Water the plants\nSCHEDULED: <2026-10-05 Mon +1w>', state: 'DONE' },
  { title: 'A closing time', text: '=#+STARTUP: logdone= writes =CLOSED:= and nothing else.', org: '#+STARTUP: logdone\n* TODO Write the report', state: 'DONE' },
  { title: 'Reopening', text: 'Going back to an open state removes =CLOSED:=.', org: '#+STARTUP: logdone\n* DONE Write the report\nCLOSED: [2026-10-10 Sat 09:00]', state: 'TODO' },
  { title: 'Logging every change', text: 'A =!= on a keyword logs each time the heading enters it. The item goes under the planning line, above the text.', org: '#+TODO: TODO NEXT(n!) | DONE(d!)\n* NEXT Call the bank\nSCHEDULED: <2026-10-12 Mon>\nThe number is on the card.', state: 'DONE' },
  { title: 'Logging into the drawer', text: '=#+STARTUP: logdrawer= puts log items in =:LOGBOOK:=.', org: '#+STARTUP: logdone logdrawer\n#+TODO: TODO NEXT(n!) | DONE(d!)\n* TODO Call the bank\nThe number is on the card.', state: 'NEXT' },
  { title: 'A log item above an existing drawer', text: 'Without =logdrawer=, a new item goes above a drawer the heading already has.', org: '#+TODO: TODO | DONE(d!)\n* TODO Call the bank\n:LOGBOOK:\nCLOCK: [2026-10-10 Sat 09:00]--[2026-10-10 Sat 09:30] =>  0:30\n:END:', state: 'DONE' },
];
const el = `
(require 'org) (require 'cl-lib) (require 'json)
(defun run-case (org state)
  (cl-letf (((symbol-function 'y-or-n-p) (lambda (&rest _) t)))
    (with-temp-buffer
      (insert org) (org-mode) (goto-char (point-min))
      (re-search-forward "^\\\\*+ ") (beginning-of-line)
      (let ((inhibit-message t) (message-log-max nil))
        (org-todo state) (run-hooks 'post-command-hook))
      (buffer-string))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case (cdr (assq 'org c)) (cdr (assq 'state c))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-book-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases.map((c) => ({ org: c.org + '\n', state: c.state }))));
const r = spawnSync('faketime', ['-f', `@${NOW}`, 'emacs', '--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, TZ, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const esc = (t) => t.trimEnd().split('\n').map((l) => (/^\s*(\*|#\+)/.test(l) ? ',' + l : l)).join('\n');
let out = `#+TITLE: Changing a TODO state
#+STARTUP: showall

A cookbook for what a change of TODO state writes. Each section shows a heading before, and after the state in the title is set; the clock reads 2026-10-11 16:30. The "after" texts are what Emacs 29.3 (Org 9.6.15) left, and the app gives the same. Lines that start with =*= or =#+= carry a comma, as org requires inside a block.
`;
cases.forEach((c, i) => {
  out += `\n* ${c.title}\n${c.text}\n\nBefore:\n#+BEGIN_SRC org\n${esc(c.org)}\n#+END_SRC\n\nAfter setting ${c.state}:\n#+BEGIN_SRC org\n${esc(results[i])}\n#+END_SRC\n`;
});
out += `
* Where the app differs from Emacs
- Emacs re-aligns a heading's tags to =org-tags-column= when its state changes; the app leaves their spacing as it is.
- =org-log-reschedule=, =org-log-redeadline= and =org-log-refile= are not applied.
- A drawer name other than =LOGBOOK= in =org-log-into-drawer= is written as =LOGBOOK=.
- A note (=@=, =lognotedone=, =lognoterepeat=) is asked for in a panel after the state has changed; skipping it writes no item.
`;
fs.writeFileSync('examples/todo-states.org', out);
console.log(`${cases.length} cases written`);
