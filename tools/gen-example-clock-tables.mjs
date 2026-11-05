#!/usr/bin/env node
/**
 * Writes examples/clock-tables.org: the file's clock data, then one block per case with the table Emacs 29.3 (org-update-all-dblocks)
 * writes under it. test/examples-emacs.test.js holds the app's Clock report to every block.
 *   node tools/gen-example-clock-tables.mjs   (needs emacs and faketime on the PATH; the clock is 2026-10-11 16:30 New York)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DATA = `* Projects
** Website
*** Design :ui:
:LOGBOOK:
CLOCK: [2026-08-03 Mon 09:00]--[2026-08-03 Mon 11:30] =>  2:30
CLOCK: [2026-08-04 Tue 14:00]--[2026-08-04 Tue 15:15] =>  1:15
:END:
*** Build
:LOGBOOK:
CLOCK: [2026-08-04 Tue 09:00]--[2026-08-04 Tue 12:00] =>  3:00
:END:
** Taxes :money:
:LOGBOOK:
CLOCK: [2026-08-05 Wed 10:00]--[2026-08-05 Wed 10:45] =>  0:45
:END:
`;
/** @type {{ title: string, about: string, params: string }[]} */
export const CASES = [
  { title: 'The week, two levels deep', about: '=:tstart= is included and =:tend= is not. A parent row includes its children.', params: ':maxlevel 2 :scope file :tstart "2026-08-03" :tend "2026-08-10"' },
  { title: 'Only the first day, all levels', about: '', params: ':maxlevel 4 :scope file :tstart "2026-08-04" :tend "2026-08-05"' },
  { title: 'A block: a whole month', about: '=:block 2026-08= is the month; =2026-W32= is a week and =2026-08-04= a day. =today=, =thisweek= and =lastmonth= work too.', params: ':maxlevel 2 :scope file :block 2026-08' },
  { title: 'A step: one table per week', about: '=:step week= with a range writes a table for each week, headed by its dates.', params: ':maxlevel 2 :scope file :tstart "2026-08-03" :tend "2026-08-17" :step week' },
  { title: 'Only headings with a tag', about: '=:match= takes a tag match, as in the Agenda.', params: ':maxlevel 4 :scope file :block 2026-08 :match "money|ui"' },
  { title: 'Percent of the total', about: '=:formula %= adds a column with each row\'s share of the total.', params: ':maxlevel 2 :scope file :block 2026-08 :formula %' },
  { title: 'Links and a compact table', about: '=:link t= makes the headlines links to the headings; =:compact t= puts all the times in one column.', params: ':maxlevel 2 :scope file :block 2026-08 :link t :compact t' },
];

const dir = '/home/me/org'; // what the file's directory is called in the example, so the links read the same
fs.mkdirSync(dir, { recursive: true });
const body = CASES.map((c) => `#+BEGIN: clocktable ${c.params}\n#+END:\n`).join('');
fs.writeFileSync(path.join(dir, 'clock-tables.org'), DATA + '\n' + body);
fs.writeFileSync(path.join(dir, 'run.el'), `(require 'org) (require 'org-clock)
(find-file "clock-tables.org") (org-update-all-dblocks) (write-region (point-min) (point-max) "/tmp/ct-out.org")`);
const r = spawnSync('faketime', ['2026-10-11 16:30:00', 'emacs', '--batch', '-Q', '-l', 'run.el'], { cwd: dir, env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
if (r.status !== 0) throw new Error(r.stderr);
const out = fs.readFileSync('/tmp/ct-out.org', 'utf8');
const blocks = [...out.matchAll(/^#\+BEGIN: clocktable [^\n]*\n[\s\S]*?^#\+END:$/gm)].map((m) => m[0]);
if (blocks.length !== CASES.length) throw new Error('blocks ' + blocks.length);
let text = `#+TITLE: Clock tables
#+STARTUP: showall

A cookbook for =#+BEGIN: clocktable=. In Emacs, =C-c C-c= on a block writes the table under it. In the app, *Clock* in the TODO view shows the same table read-only for a date range and any of the parameters in the *Parameters* field. The table under each block here is what Emacs 29.3 (Org 9.6.15) wrote, and the app's table is the same, apart from the time in the caption, which is when it was made. The last section says where the two differ.

${DATA}`;
CASES.forEach((c, i) => {
  text += `\n* ${c.title}\n${c.about ? c.about + '\n\n' : ''}${blocks[i]}\n`;
});
text += `
* Where the app differs from Emacs
- The app does not write the table into the file: it shows it in the TODO view. Open this file, pick *Clock*, and give the dates and the parameters.
- The caption time is the time of the update, as Emacs writes it.
`;
fs.writeFileSync(new URL('../examples/clock-tables.org', import.meta.url), text);
console.log(`${CASES.length} blocks written`);
