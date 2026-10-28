#!/usr/bin/env node
/**
 * Writes examples/habits.org. Each habit of tools/habit-cases.mjs is drawn by org-habit-build-graph in Emacs 29.3 for 13 October 2026
 * (21 days before today and 7 after, the defaults), and the days, marks and colors are written under it. test/example-habits.test.js
 * holds the app to them.
 *
 *   node tools/gen-habits-example.mjs     (needs emacs on the PATH; time zone America/New_York)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HABITS } from './habit-cases.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'habits-'));
const file = path.join(dir, 'habits.org');
fs.writeFileSync(file, HABITS.map((h) => h.org).join('\n') + '\n');

const el = `
(require 'org) (require 'org-habit) (require 'json)
(setq inhibit-message t)
(find-file (getenv "HABITS"))
(let ((today (encode-time 0 0 0 13 10 2026)) (out '()))
  (org-map-entries
   (lambda ()
     (let* ((habit (org-habit-parse-todo))
            (g (org-habit-build-graph habit (time-subtract today (days-to-time 21)) today (time-add today (days-to-time 7))))
            (cells '()))
       (dotimes (i (length g))
         (let ((face (symbol-name (or (get-text-property i 'face g) 'none))))
           (push (list (string (aref g i)) (concat (cond ((string-match "clear" face) "b") ((string-match "ready" face) "g") ((string-match "alert" face) "y") ((string-match "overdue" face) "r") (t "-")) (if (string-match "future" face) "l" "p"))) cells)))
       (push (cons (org-get-heading t t t t) (vconcat (nreverse cells))) out))))
  (princ (json-encode (nreverse out))))
`;
const elFile = path.join(dir, 'run.el');
fs.writeFileSync(elFile, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, TZ: 'America/New_York', HABITS: file }, encoding: 'utf8', input: '' });
if (r.status !== 0) throw new Error(r.stderr);
const graphs = Object.values(JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))));

const INTRO = `#+TITLE: Habits
#+STARTUP: showall

A habit is an open TODO with =:STYLE: habit= and a repeating =SCHEDULED:= date. In the Agenda, its row gets a strip of days: 21 before today, today and 7 after. This file holds four habits. Open it as an Agenda File and compare the strips with the ones under each habit, drawn for Tuesday 13 October 2026. The strips are what Emacs 29.3 (Org 9.6.15) drew with =org-habit-build-graph=, and a test in this project checks that the app draws the same.

Each strip has two lines, one character for each day, the first being 22 September. The first line marks the days: =*= is a day the habit was done, =!= is today. The second line gives the color: =b= blue (not due yet), =g= green (can be done), =y= yellow (last chance) and =r= red (overdue). The third line is the shade: =p= plain, =l= the lighter shade Emacs uses for a day that is not done, not today and not a past overdue day. A habit is done when its =:LOGBOOK:= has a =State "DONE"= line for the day.
`;

const out = [INTRO.trimEnd(), ''];
HABITS.forEach((h, i) => {
  const cells = graphs[i];
  const first = cells.slice(0, 28); // Emacs leaves the last day of the strip blank
  out.push(h.org, '', `** ${h.title}`, h.text, '', `#+NAME: ${h.id}`, '#+begin_example', first.map(([mark]) => (mark === ' ' ? '.' : mark)).join(''), first.map(([, color]) => color[0]).join(''), first.map(([, color]) => color[1]).join(''), '#+end_example', '');
});
out.push(
  '* Where the app differs from Emacs',
  '- Colors: the app uses its own palette. It chooses the same color and the same plain or lighter shade for every day, but draws them in its own shades.',
  '',
);
fs.writeFileSync(new URL('../examples/habits.org', import.meta.url), out.join('\n'));
console.log('wrote examples/habits.org');
