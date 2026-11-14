#!/usr/bin/env node
/**
 * Writes test/fixtures/todo-oracle.json: the text real Emacs (org-todo) leaves for a heading after a change of TODO state,
 * for a grid of headings (plain, repeating, with a logbook, with properties), file settings and states.
 * test/todo-oracle.test.js holds src/todo-transition.js to it.
 *
 *   node tools/gen-todo-oracle.mjs        (needs emacs and faketime on the PATH; the clock is New York time)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TZ = 'America/New_York';
const NOW = '2026-10-11 16:30:00';
const heads = {
  plain: '* TODO t',
  sched: '* TODO t\nSCHEDULED: <2026-10-05 Mon +1d>',
  dead: '* TODO t\nDEADLINE: <2026-10-05 Mon ++1w>',
  both: '* TODO t\nDEADLINE: <2026-10-20 Tue .+1m> SCHEDULED: <2026-10-05 Mon +1w>',
  nonrep: '* TODO t\nSCHEDULED: <2026-10-05 Mon>',
  body: '* TODO t\nSome <2026-10-05 Mon +1w> text',
  title: '* TODO t <2026-10-05 Mon +1w>',
  bodyAndPlanning: '* TODO t\nSCHEDULED: <2026-10-05 Mon +1d>\nSee <2026-10-06 Tue +1w> and <2026-10-07 Wed>.',
  logbook: '* TODO t\nSCHEDULED: <2026-10-05 Mon +1d>\n:LOGBOOK:\n- Note taken on [2026-10-01 Thu 09:00] \\\n  earlier\n:END:',
  props: '* TODO t\nSCHEDULED: <2026-10-05 Mon +1d>\n:PROPERTIES:\n:FOO: bar\n:END:',
  toState: '* TODO t\nSCHEDULED: <2026-10-05 Mon +1d>\n:PROPERTIES:\n:REPEAT_TO_STATE: NEXT\n:END:',
  checks: '* TODO t\nSCHEDULED: <2026-10-05 Mon +1d>\n:PROPERTIES:\n:RESET_CHECK_BOXES: t\n:END:\n- [X] a\n- [X] b\n  - [X] c',
  tagsPrio: '* TODO [#A] t :x:y:\nSCHEDULED: <2026-10-05 Mon +1d>',
  closed: '* DONE t\nCLOSED: [2026-10-10 Sat 10:00]',
  closedRep: '* DONE t\nCLOSED: [2026-10-10 Sat 10:00] SCHEDULED: <2026-10-05 Mon +1d>',
  none: '* t',
  noneRep: '* t\nSCHEDULED: <2026-10-05 Mon +1d>',
  next: '* NEXT t\nSCHEDULED: <2026-10-05 Mon +1d>',
  child: '* TODO t\nSCHEDULED: <2026-10-05 Mon +1d>\n** TODO c\nSCHEDULED: <2026-10-05 Mon +1d>',
  habit: '* TODO t\nSCHEDULED: <2026-10-05 Mon .+1d/3d>\n:PROPERTIES:\n:STYLE: habit\n:END:',
  timeRange: '* TODO t\nSCHEDULED: <2026-10-05 Mon 09:00-10:30 +1w>',
  warnRep: '* TODO t\nDEADLINE: <2026-10-20 Tue +1m -3d>',
  catchUp: '* TODO t\nSCHEDULED: <2026-10-05 Mon 09:00 ++1d>',
  repeatTo: '* TODO t\nSCHEDULED: <2026-10-05 Mon +1d>\n:PROPERTIES:\n:REPEAT_TO_STATE: NEXT\n:END:',
  inactiveRep: '* TODO t\nSCHEDULED: <2026-10-05 Mon +1d>\nSee [2026-10-05 Mon +1w]',
};
const settings = {
  none: '',
  logdone: '#+STARTUP: logdone\n',
  logdrawer: '#+STARTUP: logdrawer\n',
  logdoneDrawer: '#+STARTUP: logdone logdrawer\n',
  nologrepeat: '#+STARTUP: nologrepeat\n',
  nologrepeatDone: '#+STARTUP: nologrepeat logdone\n',
  flags: '#+TODO: TODO NEXT(n!) | DONE(d!) CANC(c)\n',
  flagsDrawer: '#+TODO: TODO NEXT(n!) | DONE(d!) CANC(c)\n#+STARTUP: logdrawer\n',
  lognoteless: '#+TODO: TODO NEXT | DONE CANC\n#+STARTUP: logdone\n',
};
// where a repeater counts: the places Emacs reads no time stamp in, +0, an hour repeater, a clock line, the order of the parts
Object.assign(heads, {
  zero: '* TODO t\nSCHEDULED: <2026-10-05 Mon +0d>',
  zeroFirst: '* TODO t\n<2026-10-05 Mon +0w> <2026-10-06 Tue +1w>',
  zeroSecond: '* TODO t\n<2026-10-05 Mon +1w> <2026-10-06 Tue +0w>',
  hourNoTime: '* TODO t\nSCHEDULED: <2026-10-05 Mon +2h>',
  hourTime: '* TODO t\nSCHEDULED: <2026-10-11 Sun 12:00 +5h>',
  hourTimeDot: '* TODO t\nSCHEDULED: <2026-10-11 Sun 12:00 .+5h>',
  hourNoTimeAfter: '* TODO t\n<2026-10-05 Mon +1w> <2026-10-06 Tue +2h>',
  clock: '* TODO t\nSCHEDULED: <2026-10-05 Mon +1d>\nCLOCK: [2026-10-05 Mon 10:00]--[2026-10-05 Mon 11:00] =>  1:00',
  clockDrawer: '* TODO t\nSCHEDULED: <2026-10-05 Mon +1d>\n:LOGBOOK:\nCLOCK: [2026-10-05 Mon 10:00]--[2026-10-05 Mon 11:00] =>  1:00\n:END:',
  clockInExample: '* TODO t\nSCHEDULED: <2026-10-05 Mon +1d>\n#+BEGIN_EXAMPLE\nCLOCK: [2026-10-05 Mon 10:00]--[2026-10-05 Mon 11:00] =>  1:00\n#+END_EXAMPLE',
  lastRepeat: '* TODO t\nSCHEDULED: <2026-10-05 Mon +1d>\n:PROPERTIES:\n:LAST_REPEAT: [2026-01-01 Thu 10:00]\n:END:',
  partOrder: '* TODO t\n<2026-10-05 Mon -2d +1w>',
  partOrderDeadline: '* TODO t\nDEADLINE: <2026-10-20 Tue -3d +1m>',
  propStamp: '* TODO t\n:PROPERTIES:\n:FOO: <2026-10-05 Mon +1w>\n:END:',
  propStampSpaced: '* TODO t\n:PROPERTIES:\n:FOO:      <2026-10-05 Mon +1w>\n:END:',
  inComment: '* TODO t\n<2026-10-05 Mon +1d>\n# <2026-10-04 Sun +1w>',
  commentOnly: '* TODO t\n# <2026-10-05 Mon +1w>',
  inExample: '* TODO t\n<2026-10-05 Mon +1d>\n#+BEGIN_EXAMPLE\n<2026-10-04 Sun +1w>\n#+END_EXAMPLE',
  exampleOnly: '* TODO t\n#+BEGIN_EXAMPLE\n<2026-10-05 Mon +1w>\n#+END_EXAMPLE',
  srcOnly: '* TODO t\n#+BEGIN_SRC emacs-lisp\n<2026-10-05 Mon +1w>\n#+END_SRC',
  exportOnly: '* TODO t\n#+BEGIN_EXPORT html\n<2026-10-05 Mon +1w>\n#+END_EXPORT',
  verbatimOnly: '* TODO t\n=<2026-10-05 Mon +1w>=',
  codeOnly: '* TODO t\n~<2026-10-05 Mon +1w>~',
  fixedOnly: '* TODO t\n: <2026-10-05 Mon +1w>',
  linkOnly: '* TODO t\n[[https://x.org][<2026-10-05 Mon +1w>]]',
  keywordOnly: '* TODO t\n#+CAPTION: <2026-10-05 Mon +1w>',
  quoteOnly: '* TODO t\n#+BEGIN_QUOTE\n<2026-10-05 Mon +1w>\n#+END_QUOTE',
  tableOnly: '* TODO t\n| <2026-10-05 Mon +1w> |',
  drawerOnly: '* TODO t\n:MYDRAWER:\n<2026-10-05 Mon +1w>\n:END:',
  childOnly: '* TODO t\n** sub\n<2026-10-05 Mon +1w>',
  verbatimThenPlain: '* TODO t\n=<2026-10-05 Mon +1w>= <2026-10-06 Tue +1d>',
});
const states = ['DONE', 'TODO', 'NEXT', 'CANC', ''];
const newHeads = Object.keys(heads).slice(Object.keys(heads).indexOf('zero'));
const cases = [];
for (const [h, text] of Object.entries(heads)) {
  for (const [s, pre] of Object.entries(settings)) {
    for (const state of states) {
      if (s === 'none' || s.startsWith('logdone') || s === 'logdrawer' ? state === 'CANC' : false) continue; // not keywords of that file
      if ((s === 'none' || s === 'logdrawer' || s === 'logdone' || s === 'logdoneDrawer' || s.startsWith('nolog')) && (state === 'NEXT' || state === 'CANC')) continue;
      if (h === 'toState' && !pre.includes('NEXT') && true) continue; // REPEAT_TO_STATE needs a NEXT keyword
      if (newHeads.includes(h) && (!['none', 'nologrepeat', 'logdrawer'].includes(s) || state !== 'DONE')) continue; // the repeat cases need only these
      cases.push({ head: h, setting: s, state, org: pre + text + '\n' });
    }
  }
}
// the state a repeating task goes back to: a type sequence keeps it, a second sequence goes back to its own first keyword
for (const [pre, kw, state] of [['#+TYP_TODO: KWD1 KWD2 | DONE\n', 'KWD2', 'DONE'], ['#+TYP_TODO: KWD1 KWD2 | DONE\n', 'KWD1', 'DONE'], ['#+TODO: A B | C\n#+TODO: X Y | Z\n', 'Y', 'Z'], ['#+TODO: A B | C\n#+TODO: X Y | Z\n', 'B', 'C'], ['#+TODO: A B | C\n#+TYP_TODO: X Y | Z\n', 'Y', 'Z'], ['#+TODO: A B | C\n#+TYP_TODO: X Y | Z\n', 'B', 'C'], ['#+TODO: TODO NEXT | DONE\n', 'NEXT', 'DONE']]) {
  for (const setting of ['', '#+STARTUP: nologrepeat\n']) cases.push({ head: 'seq-' + kw, setting: pre.trim().replace(/\n/g, ' ') + (setting ? ' nologrepeat' : ''), state, org: pre + setting + `* ${kw} t\nSCHEDULED: <2026-10-05 Mon +1d>\n` });
}
const el = `
(require 'org) (require 'cl-lib) (require 'json)
(defun run-case (org state)
  (cl-letf (((symbol-function 'y-or-n-p) (lambda (&rest _) t)))
    (setq org-log-setup nil) ; an error leaves the log of the case before set up, on a buffer that is gone
    (with-temp-buffer
      (insert org)
      (org-mode)
      (goto-char (point-min))
      (re-search-forward "^\\\\*+ ")
      (beginning-of-line)
      (let ((inhibit-message t) (message-log-max nil))
        ;; an error (an hour repeater without a time) leaves the entry as it has become by then
        (condition-case e
            (progn (org-todo (if (string= state "") 'none state))
                   (run-hooks 'post-command-hook))
          (user-error (goto-char (point-min)) (insert (format "ERROR %s\n" (error-message-string e))))))
      (buffer-string))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs)
      (push (condition-case e (run-case (cdr (assq 'org c)) (cdr (assq 'state c))) (error (format "ERROR %S" e))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-oracle-'));
const elFile = path.join(dir, 'run.el');
fs.writeFileSync(elFile, el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('faketime', ['-f', `@${NOW}`, 'emacs', '--batch', '-Q', '-l', elFile], { env: { ...process.env, TZ, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const out = cases.map((c, i) => ({ ...c, emacs: results[i] }));
fs.writeFileSync('test/fixtures/todo-oracle.json', JSON.stringify({ emacs: '29.3', tz: TZ, now: NOW, cases: out }, null, 1) + '\n');
console.log(`${out.length} cases written`);
