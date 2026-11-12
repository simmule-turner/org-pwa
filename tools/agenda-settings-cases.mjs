// The sample entries and the scenarios of examples/agenda-settings.org (tools/gen-agenda-settings-example.mjs writes the file,
// test/example-agenda-settings.test.js holds the app to it). Every day shown is Monday 15 March 2027.

export const DAY = '2027-03-15';

export const INTRO = `#+TITLE: Agenda settings
#+STARTUP: showall
#+CATEGORY: work
#+TODO: TODO NEXT | DONE

Settings that shape the rows of the Agenda: what comes before each heading, the order of the rows, a priority of your own, a Lisp function as a command, how many days show and where they start, finished entries, the log, stuck projects, and commands made of blocks with settings, headers and files of their own. This file is its own sample: the four entries just below are the ones every section lists, for Monday 15 March 2027. Put a setting in Settings → Advanced → *Lisp init*, open this file as an Agenda File, and compare the rows with the ones under each section. The rows are what Emacs 29.3 (Org 9.6.15) showed, and a test in this project checks that the app shows the same. The last section says where the two differ.
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

/** The second sample, for the scenarios over several days: the week of Monday 15 March 2027, and two projects for the stuck view. */
export const WEEK = `* TODO Plan sprint
SCHEDULED: <2027-03-15 Mon>
* DONE Ship release
CLOSED: [2027-03-16 Tue 08:30]
SCHEDULED: <2027-03-16 Tue>
* TODO Write report
SCHEDULED: <2027-03-17 Wed 10:00>
* TODO Dentist <2027-03-19 Fri 15:00>
* TODO Review budget
SCHEDULED: <2027-03-20 Sat>
* Website :project:
** NEXT Draft copy
* Garden :project:
** TODO Buy seeds
`;

/** The file a command names with org-agenda-files in the scenarios of kind `command` (written `other.org` here; the app writes `local:other.org`). */
export const OTHER = `#+CATEGORY: home
* TODO Mow the lawn :garden:
SCHEDULED: <2027-03-16 Tue>
* TODO Call the plumber
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
    id: 'unusable-value',
    title: 'A value that cannot be used',
    text: 'A value of the wrong kind stops the Agenda with a message. =org-deadline-warning-days= is a number of days; here it is the symbol =soon=.',
    kind: 'agenda',
    vars: { 'org-agenda-prefix-format': `'((agenda . ${DEFAULT_PREFIX}))`, 'org-deadline-warning-days': "'soon" },
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
  {
    id: 'span-week',
    sample: 'week',
    title: 'The days shown: org-agenda-span',
    text: "=org-agenda-span= is the number of days the Agenda shows: =day=, =week=, =month=, =year= (a symbol) or a number. A week starts on the day of =org-agenda-start-on-weekday= (1 is Monday; =nil= starts today). Each day has a heading, and the first day of a week carries the week number.",
    kind: 'agenda',
    span: true,
    vars: { 'org-agenda-span': "'week", 'org-agenda-start-on-weekday': '1' },
  },
  {
    id: 'start-day',
    sample: 'week',
    title: 'Where the days start: org-agenda-start-day',
    text: "=org-agenda-start-day= is the first day shown: a date, or an offset from today such as =\"+1d\"=. With a number of days as the span, the Agenda begins there and does not look for a weekday.",
    kind: 'agenda',
    span: true,
    vars: { 'org-agenda-span': '3', 'org-agenda-start-day': '"2027-03-17"' },
  },
  {
    id: 'skip-done',
    sample: 'week',
    title: 'Hiding finished entries',
    text: '=org-agenda-skip-scheduled-if-done= leaves out an entry that is done even though it still has a scheduled date; =org-agenda-skip-deadline-if-done= does the same for deadlines. Emacs also lists the scheduled date of a done entry as a plain timestamp, which =org-agenda-skip-timestamp-if-done= leaves out. With both set, Ship release is no longer listed on Tuesday.',
    kind: 'agenda',
    span: true,
    vars: { 'org-agenda-span': "'week", 'org-agenda-start-on-weekday': '1', 'org-agenda-skip-scheduled-if-done': 't', 'org-agenda-skip-timestamp-if-done': 't' },
  },
  {
    id: 'log-mode',
    sample: 'week',
    title: 'The log: closed entries',
    text: '=org-agenda-start-with-log-mode= adds the entries the log records. With =t= every kind is shown: when an entry was closed, state changes and clocked time. Here Ship release shows when it was closed.',
    kind: 'agenda',
    span: true,
    vars: { 'org-agenda-span': "'week", 'org-agenda-start-on-weekday': '1', 'org-agenda-start-with-log-mode': 't' },
  },
  {
    id: 'stuck',
    sample: 'week',
    title: 'Stuck projects',
    text: '=org-stuck-projects= says what a project is and what makes it not stuck: a matcher for the projects, TODO keywords or tags a next action carries, and a regular expression. A project with none of those under it is stuck. Website has a NEXT entry, Garden does not.',
    kind: 'stuck',
    vars: { 'org-stuck-projects': `'("+LEVEL=1+project" ("NEXT") nil "")` },
  },
  {
    id: 'command-stuck',
    sample: 'week',
    title: 'A stuck command with its own setting',
    text: 'A `stuck` command takes settings of its own after its description, and they apply to that command only. Here =org-stuck-projects= counts a project as stuck unless a child is NEXT or TODO, so Website, whose only child is NEXT, is stuck and Garden, with a TODO child, is not. The heading is Emacs\'s own.',
    kind: 'command',
    commands: `(setq org-agenda-custom-commands
      '(("x" "Stuck" stuck "" ((org-stuck-projects '("+LEVEL=1+project" ("TODO") nil ""))))))`,
    vars: {},
  },
  {
    id: 'command-agenda',
    sample: 'week',
    title: 'An agenda command with its own settings',
    text: 'An `agenda` command can set =org-agenda-span=, =org-agenda-start-day=, =org-deadline-warning-days=, =org-agenda-prefix-format= and the rest for itself: they go over the variables while the command runs. This one shows three days from Tuesday. It opens as the text of the *Org Agenda* buffer, as Emacs makes it.',
    kind: 'command',
    commands: `(setq org-agenda-custom-commands
      '(("x" "Three days" agenda "" ((org-agenda-span 3) (org-agenda-start-day "+1d")))))`,
    vars: {},
  },
  {
    id: 'command-block',
    sample: 'week',
    title: 'A composite command: blocks, headers and files',
    text: 'A command made of blocks shows each block under its own heading, with a line of `=` between blocks. The settings after the blocks are the whole command\'s and go over the variables for every block; a block\'s own settings come after that and go over those. =org-agenda-overriding-header= replaces a block\'s heading line, and =org-agenda-files= makes a block list those files only (here =other.org=). The agenda block shows its days, the todo block lists the TODO entries of the sample, and the last block lists the other file. In the app a file is written with its source, as =local:other.org=.',
    kind: 'command',
    commands: `(setq org-agenda-custom-commands
      '(("x" "Day and lists"
         ((agenda "" ((org-agenda-span 'day) (org-agenda-overriding-header "Today")))
          (todo "NEXT" ((org-agenda-overriding-header "Next actions")))
          (tags-todo "garden" ((org-agenda-files '("other.org"))
                               (org-agenda-overriding-header "Garden, from the other file"))))
         ((org-agenda-prefix-format '((agenda . "  %-10c %?-12t") (todo . "  %-10c") (tags . "  %-10c")))))))`,
    vars: {},
  },
];
