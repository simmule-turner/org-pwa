#!/usr/bin/env node
/**
 * Writes examples/capture-datetree.org: for each case the file before, the template, and the file Emacs 29.3 leaves after org-capture
 * files it under a date tree. test/example-capture-datetree.test.js holds the app to them.
 *   node tools/gen-example-capture-datetree.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureTemplatesFromLisp } from '../src/capture-lisp.js';

const DAY = '* 2026\n** 2026-11 November\n*** 2026-11-05 Thursday\n**** Called Mom\n';
/** @type {{ title: string, about: string, ymd: [number, number, number], before: string, form: string }[]} */
export const CASES = [
  {
    title: 'A new day tree',
    about: 'A file+olp+datetree target files under the year, the month and the day of the capture. Headings that are not there yet are made: the year, the month with its name, and the day with its weekday. Here the file is empty.',
    ymd: [2026, 11, 7],
    before: '#+TITLE: Journal\n',
    form: `(add-to-list 'org-capture-templates
  '("j" "Journal" entry (file+olp+datetree "journal.org") "* Walked the dog"))`,
  },
  {
    title: 'Into a tree that is there',
    about: 'The year and the month are found. The new day goes after the days already in the month, in date order.',
    ymd: [2026, 11, 7],
    before: DAY,
    form: `(add-to-list 'org-capture-templates
  '("j" "Journal" entry (file+olp+datetree "journal.org") "* Walked the dog"))`,
  },
  {
    title: 'The newest entry first',
    about: '=:prepend t= puts the entry at the top of its day instead of the end.',
    ymd: [2026, 11, 5],
    before: DAY,
    form: `(add-to-list 'org-capture-templates
  '("j" "Journal" entry (file+olp+datetree "journal.org") "* Walked the dog" :prepend t))`,
  },
  {
    title: 'Under a heading',
    about: 'Headings after the file name say where the tree goes: it is made under =Journal=, and the rest of the file is left alone.',
    ymd: [2026, 11, 7],
    before: '* Journal\n* Archive\nold notes\n',
    form: `(add-to-list 'org-capture-templates
  '("j" "Journal" entry (file+olp+datetree "journal.org" "Journal") "* Walked the dog"))`,
  },
  {
    title: 'A list item in the day',
    about: 'A template of type =item= (or =checkitem=, =plain=) goes in the body of the day heading.',
    ymd: [2026, 11, 5],
    before: '* 2026\n** 2026-11 November\n*** 2026-11-05 Thursday\n- Called Mom\n',
    form: `(add-to-list 'org-capture-templates
  '("b" "Bought" item (file+olp+datetree "journal.org") "Bought milk"))`,
  },
  {
    title: 'A week tree',
    about: '=:tree-type week= keeps the days of an ISO week under a heading for the week. 2024-12-30 is a Monday in the first week of 2025, so it goes under the year 2025.',
    ymd: [2024, 12, 30],
    before: '#+TITLE: Journal\n',
    form: `(add-to-list 'org-capture-templates
  '("j" "Journal" entry (file+olp+datetree "journal.org") "* Walked the dog" :tree-type week))`,
  },
  {
    title: 'A month tree',
    about: '=:tree-type month= has no heading for the day: the entry goes under the month.',
    ymd: [2026, 11, 7],
    before: '* 2026\n** 2026-11 November\n*** Earlier\n',
    form: `(add-to-list 'org-capture-templates
  '("j" "Journal" entry (file+olp+datetree "journal.org") "* Walked the dog" :tree-type month))`,
  },
  {
    title: 'The older names',
    about: '=file+datetree= is the same as =file+olp+datetree= with no headings, and =file+weektree= is the same with =:tree-type week=.',
    ymd: [2026, 11, 7],
    before: '#+TITLE: Journal\n',
    form: `(add-to-list 'org-capture-templates
  '("w" "Weekly" entry (file+weektree "journal.org") "* Walked the dog"))`,
  },
];

const q = (s) => JSON.stringify(s);
const el = `
(require 'org) (require 'org-capture) (require 'json)
(defun run-case (init form ymd file)
  (let* ((org-overriding-default-time (encode-time (list 0 0 12 (nth 2 ymd) (nth 1 ymd) (nth 0 ymd) nil -1 nil)))
         (org-capture-templates nil)
         (form (read (replace-regexp-in-string "journal\\\\.org" file form t t))))
    (with-temp-file file (insert init))
    (eval form t)
    (setq org-capture-templates (list (append (car org-capture-templates) (list :immediate-finish t))))
    (condition-case err
        (progn (org-capture nil (car (car org-capture-templates)))
               (with-current-buffer (find-buffer-visiting file)
                 (prog1 (substring-no-properties (buffer-string)) (set-buffer-modified-p nil))))
      (error (concat "ERROR " (error-message-string err))))))
(let (out)
  ${CASES.map((c) => `(push (run-case ${q(c.before)} ${q(c.form)} '(${c.ymd.join(' ')}) (make-temp-file "journal" nil ".org")) out)`).join('\n  ')}
  (princ (json-encode (vconcat (nreverse out)))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtex-'));
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 26 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stderr.slice(-2000)); process.exit(1); }
const outs = JSON.parse(m[0]);
const esc = (s) => s.replace(/^(\*|#\+)/gm, ',$1').replace(/\n$/, '');
const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let out = `#+TITLE: Capture into a date tree
#+STARTUP: showall

A cookbook for journals. Each section shows the file before, the template, and the file after org-capture files it. The results are what Emacs 29.3 (Org 9.6.15) produced, and a test holds the app to them. The template is written the way it goes in the Lisp init (=org-xx-lisp-init=), and in the Capture Templates setting as JSON.

`;
CASES.forEach((c, i) => {
  const { templates, notes } = captureTemplatesFromLisp(c.form.replace('(add-to-list \'org-capture-templates', '(setq org-capture-templates (list').replace(/\)\)$/, '))))'));
  if (notes.length || templates.length !== 1) throw new Error(`${c.title}: ${JSON.stringify(notes)}`);
  const t = templates[0];
  const json = JSON.stringify({ key: t.key, description: t.description, type: t.type, ...(t.file ? { file: t.file } : {}), olp: t.olp, datetree: t.datetree, ...(t.treeType ? { treeType: t.treeType } : {}), ...(t.prepend ? { prepend: true } : {}), template: t.template }, null, 2);
  const [y, mo, d] = c.ymd;
  const day = `${y}-${pad(mo)}-${pad(d)} ${WEEKDAYS[new Date(y, mo - 1, d, 12).getDay()]}`;
  out += `* ${c.title}\n${c.about}\n\nCaptured on ${day}.\n\nTemplate, in the Lisp init:\n#+BEGIN_SRC emacs-lisp\n${c.form}\n#+END_SRC\n\nThe same template in Capture Templates:\n#+BEGIN_SRC json\n${json}\n#+END_SRC\n\nBefore, journal.org:\n#+BEGIN_SRC org\n${esc(c.before)}\n#+END_SRC\n\nAfter, journal.org:\n#+BEGIN_SRC org\n${esc(outs[i])}\n#+END_SRC\n\n`;
});
out += `* Where the app differs from Emacs
=:time-prompt t= (asking for the date) is not read, and neither is =file+olp+datetree= with =:tree-type= given as a function or a list of levels: those need Org 9.8, and a message says so when the Capture list opens. The app leaves the end of a file as it was, where Emacs adds a final newline to a file that lacked one.
`;
fs.writeFileSync(new URL('../examples/capture-datetree.org', import.meta.url), out);
console.log(`${CASES.length} cases`);
