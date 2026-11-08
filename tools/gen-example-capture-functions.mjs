#!/usr/bin/env node
/**
 * Writes examples/capture-functions.org: capture templates that use Lisp functions (a target function, :prepare-finalize), each with the
 * file before and the file Emacs 29.3 leaves after org-capture files it. test/example-capture-functions.test.js holds the app to them.
 *   node tools/gen-example-capture-functions.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MEETING = `(add-to-list 'org-capture-templates
  '("m" "Meeting" entry (file+olp "inbox.org" "📥 Inbox - unprocessed" "Meeting Notes")
    "* %^{Meeting Title} :meeting:\\n:PROPERTIES:\\n:CREATED: %U\\n:END:\\n** Attendees\\n- %?\\n** Notes\\n- \\n** Action Items\\n*** TODO [#A] %^{Top Priority Task}"
    :prepend t))`;
const JOURNAL_TARGET = '(file+olp+datetree "github:home.org" "📔 Journal - journal and diary")';
const JOURNAL = `(add-to-list 'org-capture-templates
  '("j" "Journal" item ${JOURNAL_TARGET} "%<%H:%M> - %?" :prepend t))`;
const CHECK = `(add-to-list 'org-capture-templates
  '("c" "Journal-checkitem" checkitem ${JOURNAL_TARGET} "%?" :prepend t))`;
const APPOINTMENT = `(defun my-year-heading ()
  "Find or create the heading of this year and leave point on it."
  (let ((year (format-time-string "%Y")))
    (goto-char (point-min))
    (unless (re-search-forward (format "^\\\\* %s\\\\(?: .*\\\\)?$" (regexp-quote year)) nil t)
      (goto-char (point-max))
      (unless (bolp) (insert "\\n"))
      (insert "* " year "\\n")
      (forward-line -1))
    (beginning-of-line)))

(add-to-list 'org-capture-templates
  '("a" "Appointment" entry (file+function "calendar.org" my-year-heading)
    "* %^{Description} %^T\\n%?"))`;
const VCARD = `(defun my-vcard-drop-empty ()
  "Drop the empty fields of a captured vCard, and an empty trailing tag."
  (goto-char (point-min))
  (when (re-search-forward "[ \\t]+:+[ \\t]*$" (line-end-position) t)
    (replace-match ""))
  (goto-char (point-min))
  (flush-lines "^[A-Za-z][A-Za-z0-9_-]*\\\\(;[^:\\n]*\\\\)?:[; \\t]*$"))

(add-to-list 'org-capture-templates
  '("v" "vCard Contact" entry (file+olp "github:contacts.org" "New")
    "* %^{First Name} %^{Last Name} :%^{Category/Tag}:\\nBEGIN:VCARD\\nVERSION:3.0\\nFN:%\\\\1 %\\\\2\\nN:%\\\\2;%\\\\1;;;\\nEMAIL:%^{Email}\\nTEL;TYPE=voice:%^{Phone Number}\\nTEL;TYPE=cell:%^{Mobile Number}\\nADR;TYPE=home:;;%^{Street};%^{City};%^{State};%^{Postal Code};%^{Country}\\nBDAY:%^{Birthday (YYYY-MM-DD)}\\nNOTE:%^{Note}\\nORG:%^{Company/Organization}\\nTITLE:%^{Job Title}\\nEND:VCARD\\n\\n%?"
    :prepare-finalize my-vcard-drop-empty))`;
const TRACKING = String.raw`(defun my-tracking-target ()
  "Find or create Bag > Health > Tracking > this month and leave point on that heading.
A new heading goes first among its siblings; a new month also gets the plot, the table and its formulas."
  (let ((level 1) (start (point-min)) (end (point-max)))
    (dolist (name (list "🛍️ Bag - lists and notes" "❤️ Health" "🏩 Tracking" (format-time-string "%Y-%m")))
      (goto-char start)
      (if (re-search-forward (format "^\\*\\{%d\\} %s[ \t]*$" level (regexp-quote name)) end t)
          (setq start (1+ (match-end 0)))
        (goto-char start)
        (goto-char (if (re-search-forward "^\\*+ " end t) (match-beginning 0) end))
        (unless (bolp) (insert "\n"))
        (insert (make-string level ?*) " " name "\n")
        (when (= level 4)
          (insert "#+PLOT: title:\"Tracking\" ind:4 deps:1 with:points ticks:6\n|   |\n|---|\n"
                  "#+TBLFM: $1=@#-1 :: $4=if(round(trunc($3/100) + 100*($3/100 - trunc($3/100)) / 60) == 24, 0, round(trunc($3/100) + 100*($3/100 - trunc($3/100)) / 60))\n"))
        (setq start (save-excursion (re-search-backward (format "^\\*\\{%d\\} " level)) (forward-line 1) (point))))
      (goto-char start)
      (setq end (if (re-search-forward (format "^\\*\\{1,%d\\} " level) nil t) (match-beginning 0) (point-max)))
      (setq level (1+ level)))
    (goto-char start) (forward-line -1) (beginning-of-line)))

(add-to-list 'org-capture-templates
  '("t" "Tracking" table-line (file+function "github:home.org" my-tracking-target)
     "| | %<%Y-%m-%d> | %<%H%M> ||"))`;

const WEB = `(add-to-list 'org-capture-templates
  '("w" "Web page or text" entry (file+olp "inbox.org" "Inbox")
    "* %a%^{Title (leave blank for a web page)}\\n:PROPERTIES:\\n:CREATED: %U\\n:END:\\n  %i\\n  %?"
    :empty-lines 1))`;
const BULLET = `(add-to-list 'org-capture-templates
  '("b" "Bullet List" item (file+olp "notes.org" "Lists" "Shopping")
    "%?" :empty-lines 1))`;
const CHECKLIST = `(add-to-list 'org-capture-templates
  '("c" "Check List" checkitem (file+olp "notes.org" "Lists" "Errands")
    "%^{Item description}"))`;
const EXPENSES = `(add-to-list 'org-capture-templates
  '("t" "Table Insert prompted for values" table-line (file+olp "money.org" "Expenses")
    "| | %U | %^{Description} | %^{Amount} |"))`;
const OLP_TARGET = String.raw`(defun my-olp-target (names)
  "Find or create the outline path NAMES in the file and leave point on its last heading.
A heading that has to be created goes last among its siblings."
  (let ((level 1) (start (point-min)) (end (point-max)))
    (dolist (name names)
      (goto-char start)
      (if (re-search-forward (format "^\\*\\{%d\\} %s[ \t]*$" level (regexp-quote name)) end t)
          (setq start (1+ (match-end 0)))
        (goto-char end)
        (unless (bolp) (insert "\n"))
        (insert (make-string level ?*) " " name "\n")
        (setq start (point)))
      (goto-char start)
      (setq end (if (re-search-forward (format "^\\*\\{1,%d\\} " level) nil t) (match-beginning 0) (point-max)))
      (setq level (1+ level)))
    (goto-char start) (forward-line -1) (beginning-of-line)))

(defun my-journal-target ()
  "The day of today in the month of today in the journal."
  (my-olp-target (list "📔 Journal - journal and diary"
                       (format-time-string "%Y-%m %b")
                       (format-time-string "%Y-%m-%d"))))

(add-to-list 'org-capture-templates
  '("j" "Journal" item (file+function "journal.org" my-journal-target) "%<%H:%M> - %?" :prepend t))
(add-to-list 'org-capture-templates
  '("c" "Journal check item" checkitem (file+function "journal.org" my-journal-target) "%?" :prepend t))`;

/** @type {{ title: string, about: string[], init: string, key: string, at: [number, number, number, number, number], answers?: Record<string, string>, before: string, runs?: number, warm?: [number, number, number, number, number], file: string, shared?: { title?: string, text?: string, url?: string }, steps?: { key: string, typed: string }[], typed?: string }[]} */
export const CASES = [
  {
    title: 'A shared web page', key: 'w', file: 'inbox.org', at: [2026, 11, 7, 9, 30],
    about: ['The template for anything shared in from another app: =entry= (Emacs does not shift the headings of =plain= text), with =:empty-lines 1=. In Emacs, =%a= is the link stored for the page and =%i= the text selected when the capture starts. In the app, sharing a web page fills them: =%a= is the page as a link, =[[address][title]]=, and =%i= the shared text, if any. A web page has a title already, so the title prompt is left blank; the note is typed at =%?=.'],
    init: WEB, shared: { title: 'Org mode compact guide', url: 'https://orgmode.org/guide/' }, typed: 'read this later',
    before: '* Inbox\n* Other\n',
  },
  {
    title: 'Shared text', key: 'w', file: 'inbox.org', at: [2026, 11, 7, 9, 30],
    about: ['The same template, for some text shared from a document: there is no link, so =%a= is empty and the title prompt supplies the heading. =%i= is the shared text; every line after the first is indented like the first.'],
    init: WEB, shared: { text: 'The quick brown fox\njumps over the lazy dog.' }, answers: { 'Title (leave blank for a web page)': 'A fox' },
    before: '* Inbox\n** Earlier\n',
  },
  {
    title: 'Bullet list', key: 'b', file: 'notes.org', at: [2026, 11, 7, 9, 30],
    about: ['An =item= goes into the list under the target heading. =:empty-lines 1= puts a blank line between the new item and the list above it.'],
    init: BULLET, typed: 'Milk',
    before: '* Lists\n** Shopping\n- Eggs\n',
  },
  {
    title: 'Check list', key: 'c', file: 'notes.org', at: [2026, 11, 7, 9, 30],
    about: ['A =checkitem= template asks for the text of the item. Org 9.6 files it as an ordinary list item.'],
    init: CHECKLIST, answers: { 'Item description': 'Call the plumber' },
    before: '* Lists\n** Errands\n- Pay rent\n',
  },
  {
    title: 'Table row with prompts', key: 't', file: 'money.org', at: [2026, 11, 7, 9, 30],
    about: ['A =table-line= template adds a row to the first table under the target; the target is the heading above it. Emacs does not expand =@#= in a template, so the first column is empty and the table\'s =#+TBLFM:= line numbers the rows (=$1=@#-1=, the header row counts as a row); it is worked out again after the capture.'],
    init: EXPENSES, answers: { Description: 'Coffee', Amount: '3.50' },
    before: '* Expenses\n|   | Date | What | Amount |\n|---+------+------+--------|\n| 1 | [2026-11-02 Mon 08:10] | Bus | 2.00 |\n#+TBLFM: $1=@#-1\n',
  },
  {
    title: 'Journal by month and day', key: 'j', file: 'journal.org', at: [2026, 11, 8, 1, 19],
    about: ['A helper, =my-olp-target=, finds or makes the headings of an outline path whose names can be worked out from the date (here the month =2026-11 Nov= and the day =2026-11-08=), and a target function uses it. Two templates share the target: =j= for an =item= and =c= for a =checkitem=, both =:prepend t=, so the newest is first. The headings of November are made by the first capture; the second finds them. The text is typed at =%?=.'],
    init: OLP_TARGET, steps: [{ key: 'j', typed: 'first' }, { key: 'c', typed: 'second' }],
    before: '* 📔 Journal - journal and diary\n** 2026-10 Oct\n*** 2026-10-30\n- 09:00 - old entry\n* Other\n',
  },
  {
    title: 'Meeting notes', key: 'm', file: 'inbox.org', at: [2026, 11, 7, 18, 30],
    about: ['An =entry= template with prompts, a property drawer and sub-headings. =:prepend t= puts the new meeting first under =Meeting Notes=. Emacs stops with an error when the headings of the target are missing; the app makes them.'],
    init: MEETING, answers: { 'Meeting Title': 'Planning', 'Top Priority Task': 'Send the agenda' },
    before: '* 📥 Inbox - unprocessed\n** Meeting Notes\n*** Earlier meeting\n',
  },
  {
    title: 'Journal entry', key: 'j', file: 'home.org', at: [2026, 11, 7, 18, 30],
    about: ['An =item= template in the day of a date tree, newest first. Emacs reads =github:home.org= as a file of that name; =github:= is the app\'s own prefix for a file in the GitHub repository, so in Emacs write a plain file name.'],
    init: JOURNAL, before: '* 📔 Journal - journal and diary\n** 2026\n*** 2026-11 November\n**** 2026-11-07 Saturday\n- 09:15 - Breakfast\n',
  },
  {
    title: 'Journal check item', key: 'c', file: 'home.org', at: [2026, 11, 7, 18, 30],
    about: ['A =checkitem= template, with nothing but =%?=: the cursor lands in an empty check box in the day.'],
    init: CHECK, before: '* 📔 Journal - journal and diary\n',
  },
  {
    title: 'Appointment in the current year', key: 'a', file: 'calendar.org', at: [2026, 11, 7, 18, 30],
    about: ['A target function finds the heading of the year, or makes it, and leaves point on it. The function sees the text of the whole file with point at the start; the capture goes where point ends: here under the heading, after its other entries. It may insert whole lines (a new heading); it may not change or delete one.', 'Run twice: the year heading is made once and both appointments are its children.'],
    init: APPOINTMENT, answers: { Description: 'Dentist', date: '2026-11-09 14:30' }, runs: 2, before: '* 2025\n** old\n* Other\n',
  },
  {
    title: 'Contact without the empty fields', key: 'v', file: 'contacts.org', at: [2026, 11, 7, 18, 30],
    about: ['=:prepare-finalize= names a function (or a lambda, or a list of them) that runs on the text of the capture once every =%= escape and prompt is filled in, with point at its start. What is in the buffer afterwards is filed. Here it drops the lines of the vCard that were left blank, and the empty tag. Fields not answered: Category/Tag, Mobile Number, Street, Postal Code, Country, Birthday, Note, Company/Organization, Job Title.'],
    init: VCARD, answers: { 'First Name': 'Ann', 'Last Name': 'Lee', Email: 'ann@x.org', 'Phone Number': '555-1', City: 'Troy', State: 'NY' },
    before: '* New\n** existing\n',
  },
  {
    title: 'Tracking', key: 't', file: 'home.org', at: [2026, 11, 7, 18, 30], runs: 2, warm: [2026, 10, 31, 8, 0],
    about: ['A =table-line= template whose target function finds or makes the headings =Bag=, =Health=, =Tracking= and the current month, puts the new month first, and gives it a plot line, a table and the formulas. The row is filed into that table and the formulas are worked out again. The file already has October; two rows are captured in November.',
      'Emacs does not expand =@#= in a template, so the first column is a formula, =$1=@#-1= (the header row counts as a row). Emacs rejects a =#+TBLFM= line that defines =$4== twice ("Double definition"), so one formula gives the hour column.'],
    init: TRACKING, before: '* 🛍️ Bag - lists and notes\n** ❤️ Health\n*** 🏩 Tracking\n*** Other\n',
  },
];

const q = (s) => JSON.stringify(s);
/** What %a is for a shared page: the page as an org link. */
const annotation = ({ title, url }) => (url ? (title ? `[[${url}][${title}]]` : `[[${url}]]`) : '');
const el = (dir) => `
(require 'org) (require 'org-capture) (require 'json) (require 'cl-lib)
(defvar my-answers nil)
(defvar my-date "2026-11-09 14:30")
(defun my-ans (p &rest _) (or (cdr (cl-find-if (lambda (a) (string-match-p (regexp-quote (car a)) p)) my-answers)) ""))
(defvar org-time-was-given) (defvar org-end-time-was-given)
(defun my-read-date (&rest args) (setq org-time-was-given t org-end-time-was-given nil) (org-time-string-to-time my-date))
(advice-add 'format-time-string :filter-args
  (lambda (args) (list (car args) (or (nth 1 args) org-overriding-default-time) (nth 2 args))))
(defun run-case (init steps file before at runs warm answers shared)
  (let* ((org-capture-templates nil)
         (my-answers answers)
         (forms (with-temp-buffer (insert init) (goto-char (point-min)) (let (r) (condition-case nil (while t (push (read (current-buffer)) r)) (end-of-file nil)) (nreverse r)))))
    (with-temp-file file (insert before))
    (dolist (f forms) (eval f t))
    (cl-letf (((symbol-function 'read-string) #'my-ans)
              ((symbol-function 'completing-read) #'my-ans)
              ((symbol-function 'org-completing-read) #'my-ans)
              ((symbol-function 'org-read-date) #'my-read-date)
              ((symbol-function 'read-from-minibuffer) #'my-ans))
      (condition-case err
          (progn
            (dolist (when (append (and warm (list warm)) (make-list runs at)))
              (dolist (step steps)
                (let ((org-overriding-default-time (encode-time (list 0 (nth 4 when) (nth 3 when) (nth 2 when) (nth 1 when) (nth 0 when) nil -1 nil)))
                      (org-capture-link-is-already-stored (and shared t))
                      (org-store-link-plist (and shared (list :annotation (nth 0 shared)))))
                  (org-capture-string (nth 1 shared) (car step))
                  (unless (string= (cdr step) "") (insert (cdr step)))
                  (org-capture-finalize))))
            (with-current-buffer (find-buffer-visiting file)
              (prog1 (substring-no-properties (buffer-string)) (set-buffer-modified-p nil))))
        (error (concat "ERROR " (error-message-string err)))))))
(let (out)
  ${CASES.map((c, i) => {
    const file = path.join(dir, c.file.replace('.org', `-${i}.org`));
    const init = c.init.replace(/"(?:github:)?([\w.-]+\.org)"/g, () => q(file));
    const answers = Object.entries(c.answers || {}).map(([k, v]) => `(cons ${q(k)} ${q(v)})`).join(' ');
    const steps = (c.steps || [{ key: c.key, typed: c.typed ?? '' }]).map((st) => `(cons ${q(st.key)} ${q(st.typed)})`).join(' ');
    const shared = c.shared ? `(list ${q(annotation(c.shared))} ${q(c.shared.text || '')})` : 'nil';
    return `(push (list ${q(c.key)} (run-case ${q(init)} (list ${steps}) ${q(file)} ${q(c.before)} '(${c.at.join(' ')}) ${c.runs ?? 1} ${c.warm ? `'(${c.warm.join(' ')})` : 'nil'} (list ${answers}) ${shared})) out)`;
  }).join('\n  ')}
  (princ (json-encode (vconcat (mapcar (lambda (x) (cadr x)) (nreverse out))))))
`;

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfex-'));
  const file = path.join(dir, 'run.el');
  fs.writeFileSync(file, el(dir));
  if (process.env.KEEP_EL) fs.writeFileSync(process.env.KEEP_EL, fs.readFileSync(file));
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const m = r.stdout.match(/\[.*\]$/s);
  if (!m) { console.error(r.stdout.slice(-1500), r.stderr.slice(-2500)); process.exit(1); }
  const outs = JSON.parse(m[0]);
  const esc = (s) => s.replace(/^(\*|#\+)/gm, ',$1').replace(/\n$/, '');
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const pad = (n) => String(n).padStart(2, '0');
  let out = `#+TITLE: Capture with Lisp functions
#+STARTUP: showall

Capture templates that use a function: the templates of the Lisp init (=org-xx-lisp-init=, Settings > Advanced) beyond a fixed place. Each section shows the file before, the Lisp to copy into the init, and the file after org-capture files it. The results are what Emacs 29.3 (Org 9.6.15) produced, and a test holds the app to them.

Two keywords make this possible: =(file+function "file.org" FUNCTION)= as a target, and =:prepare-finalize FUNCTION=. A function is a name, a =(lambda () ...)=, and for =:prepare-finalize= also a list of them; it runs in a text buffer as Emacs's (=point=, =re-search-forward=, =insert=, =flush-lines= ...).

`;
  CASES.forEach((c, i) => {
    const [y, mo, d, h, mi] = c.at;
    const day = `${y}-${pad(mo)}-${pad(d)} ${WEEKDAYS[new Date(y, mo - 1, d, 12).getDay()]} ${pad(h)}:${pad(mi)}`;
    const answers = Object.entries(c.answers || {}).map(([k, v]) => `- ${k}: ${v}`).join('\n');
    out += `* ${c.title}\n${c.about.join('\n\n')}\n\nCaptured on ${day}${c.runs > 1 ? `, ${c.runs} times` : ''}${c.warm ? `, after one capture on ${c.warm[0]}-${pad(c.warm[1])}-${pad(c.warm[2])}` : ''}.${c.steps ? `\n\nTemplates captured, in order: ${c.steps.map((st) => st.key).join(', ')}.` : ''}\n\nIn the Lisp init:\n#+BEGIN_SRC emacs-lisp\n${c.init}\n#+END_SRC\n\n${c.shared ? `Shared into the app:\n#+BEGIN_SRC text\n${Object.entries(c.shared).map(([k, v]) => `- ${k}: ${v.replace(/\n/g, '\n    ')}`).join('\n')}\n#+END_SRC\n\n` : ''}${answers ? `Answers to the prompts:\n#+BEGIN_SRC text\n${answers}\n#+END_SRC\n\n` : ''}${c.typed || c.steps ? `Typed at the cursor (=%?=):\n#+BEGIN_SRC text\n${(c.steps || [{ key: c.key, typed: c.typed }]).map((st) => `- ${st.key}: ${st.typed}`).join('\n')}\n#+END_SRC\n\n` : ''}Before, ${c.file}:\n#+BEGIN_SRC org\n${esc(c.before)}\n#+END_SRC\n\nAfter, ${c.file}:\n#+BEGIN_SRC org\n${esc(outs[i])}\n#+END_SRC\n\n`;
  });
  out += `* Where the app differs from Emacs
The app makes missing headings of a =file+olp= target, where Emacs stops with an error. A target function may only insert whole lines; one that changes or deletes a line is refused with a message and nothing is filed. A =file+function= template of type =item=, =checkitem= or =table-line= needs the function to leave point on a heading. In the buffer of a function, markers and text properties are not available, the regexp operator ~\\=~ never matches, and a search with a bound treats ~$~ and ~\\'~ at the bound as the end of the text. The =github:= prefix of a file name is the app's own.
`;
  fs.writeFileSync(new URL('../examples/capture-functions.org', import.meta.url), out);
  console.log(`${CASES.length} cases`);
}
