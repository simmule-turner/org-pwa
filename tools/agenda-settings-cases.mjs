// The sample entries and the scenarios of examples/agenda-settings.org (tools/gen-agenda-settings-example.mjs writes the file,
// test/example-agenda-settings.test.js holds the app to it). Every day shown is Monday 15 March 2027.

export const DAY = '2027-03-15';

export const INTRO = `#+TITLE: Agenda settings
#+STARTUP: showall
#+CATEGORY: work
#+TODO: TODO NEXT | DONE

Settings that shape the rows of the Agenda: what comes before each heading, the order of the rows, a priority of your own, and a Lisp function as a command. This file is its own sample: the four entries just below are the ones every section lists, for Monday 15 March 2027. Put a setting in Settings → Advanced → *Lisp init*, open this file as an Agenda File, and compare the rows with the ones under each section. The rows are what Emacs 29.3 (Org 9.6.15) showed, and a test in this project checks that the app shows the same. The last section says where the two differ.
`;

export const SAMPLE = `* TODO [#A] Alpha deploy :ops:
SCHEDULED: <2027-03-15 Mon 09:00>
:PROPERTIES:
:Effort: 2:00
:WEIGHT: 3
:END:
* TODO Bravo review
SCHEDULED: <2027-03-15 Mon>
:PROPERTIES:
:WEIGHT: 1
:END:
The budget figures are in the spreadsheet.
* NEXT [#C] Charlie cleanup :home:
DEADLINE: <2027-03-15 Mon>
:PROPERTIES:
:WEIGHT: 2
:END:
* TODO [#B] Delta call <2027-03-15 Mon 11:00>
`;

const DEFAULT_PREFIX = '"  %-12:c%?-12t% s"';

/**
 * kind: agenda (the day), search (Keyword search), match (Match view) or function (a function as a command).
 * vars: the settings, as the text after the variable name in a `setq`.
 */
export const SCENARIOS = [
  {
    id: 'default',
    title: 'The default rows',
    text: 'With nothing set, a row is the category, the time, whether it is scheduled or due, then the heading. Rows go by time of day, then priority, then the order in the file.',
    kind: 'agenda',
    vars: { 'org-agenda-prefix-format': `'((agenda . ${DEFAULT_PREFIX}))` },
  },
  {
    id: 'prefix-short',
    title: 'What comes before each heading',
    text: '=org-agenda-prefix-format= is a format string per view. =%c= is the category (=%-8:c= pads it to 8 and adds the colon), =%t= the time, =%s= the scheduling word, =%e= the effort. A =?= makes the part disappear when it is empty.',
    kind: 'agenda',
    vars: { 'org-agenda-prefix-format': `'((agenda . "%-8:c %?-12t %e "))` },
  },
  {
    id: 'prefix-lisp',
    title: 'A Lisp form in the prefix',
    text: '=%(form)= is evaluated for each row, with =category=, =time=, =level=, =effort= and =tag= set to that row\'s values; what it returns takes the place of the form.',
    kind: 'agenda',
    vars: { 'org-agenda-prefix-format': `'((agenda . "%(upcase category) %(concat \\"<\\" (substring category 0 1) \\">\\") "))` },
  },
  {
    id: 'prefix-string',
    title: 'A format that is a plain string',
    text: 'The value may also be one string, used for every view. Emacs reads it as a Lisp string, so =\\"= is a quote mark and =\\\\= a backslash. The time is =%t=: a one-digit hour has a space before it.',
    kind: 'agenda',
    vars: { 'org-agenda-prefix-format': '"%-6c \\"%t\\"%s "' },
  },
  {
    id: 'prefix-error',
    title: 'A form that fails',
    text: 'When a =%(form)= fails, the Agenda stops and shows the error in place of the rows.',
    kind: 'agenda',
    vars: { 'org-agenda-prefix-format': `'((agenda . "%(no-such-function category) %c"))` },
  },
  {
    id: 'sort-priority',
    title: 'The order of the rows',
    text: '=org-agenda-sorting-strategy= lists the keys to sort by, per view. Here the highest priority comes first and the rest keep their order in the file.',
    kind: 'agenda',
    vars: { 'org-agenda-prefix-format': `'((agenda . ${DEFAULT_PREFIX}))`, 'org-agenda-sorting-strategy': "'((agenda priority-down category-keep))" },
  },
  {
    id: 'sort-user',
    title: 'Sorting by your own rule',
    text: '=user-defined-up= and =user-defined-down= sort by =org-agenda-cmp-user-defined=, a function of two agenda lines. It returns =-1= to put the first line first, =1= to put it second, or =nil= for no opinion. This one puts the rows tagged =ops= first.',
    kind: 'agenda',
    vars: {
      'org-agenda-prefix-format': `'((agenda . ${DEFAULT_PREFIX}))`,
      'org-agenda-sorting-strategy': "'((agenda user-defined-up))",
      'org-agenda-cmp-user-defined': `(lambda (a b) (cond ((string-match-p ":ops:" a) -1) ((string-match-p ":ops:" b) 1)))`,
    },
  },
  {
    id: 'priority-function',
    title: 'A priority of your own',
    text: '=org-priority-get-priority-function= gives the priority number of a heading, from its text, instead of the letter. It runs with the cursor on the heading, so it can read a property. Here the =WEIGHT= property is the number. A scheduled or due entry still adds its own part to the number, as it does to a letter\'s.',
    kind: 'agenda',
    vars: {
      'org-agenda-prefix-format': `'((agenda . ${DEFAULT_PREFIX}))`,
      'org-agenda-sorting-strategy': "'((agenda priority-down))",
      'org-priority-get-priority-function': `(lambda (headline) (string-to-number (or (org-entry-get nil "WEIGHT") "0")))`,
    },
  },
  {
    id: 'search',
    title: 'Keyword search shows the heading only',
    text: 'A Keyword search finds an entry by its text, not only its heading. The query below is the word in the text of Bravo, written as a regular expression in braces. It finds Bravo, and the row shows the heading alone.',
    kind: 'search',
    query: '{bud[g]et}',
    vars: {},
  },
  {
    id: 'match',
    title: 'Match shows the heading only',
    text: 'The Match query =ops|home= lists the entries with either tag.',
    kind: 'match',
    query: 'ops|home',
    vars: {},
  },
  {
    id: 'function-command',
    title: 'A function as a command',
    text: 'In =org-agenda-custom-commands=, a command whose type is a function calls it with the command\'s match string. What the function prints is the result; what it returns is not shown.',
    kind: 'function',
    match: 'ops',
    fn: '(lambda (match) (princ (format "Report for %s\\n" match)) (princ "second line\\n") "a result that is not shown")',
    vars: {},
  },
];
