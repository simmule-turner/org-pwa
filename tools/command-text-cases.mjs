// The cases of the *Org Agenda* text of custom commands (tools/gen-command-text-oracle.mjs asks Emacs, test/command-text.test.js holds the
// app to it). Two files: the agenda files of every case are `mini.org`, and `other.org` is the one a command names with org-agenda-files.
// Today is 2026-10-11 16:30.

export const FILES = {
  'mini.org': `#+CATEGORY: mini
#+TODO: TODO NEXT WAIT | DONE
* TODO A today sched :work:
SCHEDULED: <2026-10-11 Sun>
:PROPERTIES:
:EFFORT: 0:30
:END:
* NEXT B deadline soon :home:
DEADLINE: <2026-10-13 Tue>
* TODO [#A] C tomorrow timed :work:
SCHEDULED: <2026-10-12 Mon 09:30>
* NEXT D next no date :work:
* TODO E overdue sched
SCHEDULED: <2026-10-08 Thu>
* TODO F overdue deadline :home:
DEADLINE: <2026-10-09 Fri>
:PROPERTIES:
:EFFORT: 3:00
:END:
* DONE H finished :work:
CLOSED: [2026-10-10 Sat 10:00]
* Project :work:
** TODO J child one
** WAIT K child two :home:
** L plain child
* Notes
:PROPERTIES:
:CATEGORY: notes
:END:
** TODO M under notes :work:
SCHEDULED: <2026-10-11 Sun>
`,
  'other.org': `#+CATEGORY: other
#+TODO: TODO NEXT WAIT | DONE
* TODO Z other file :work:
SCHEDULED: <2026-10-11 Sun>
* NEXT Y other next
* TODO X other deadline :home:
DEADLINE: <2026-10-12 Mon>
`,
};

const SPAN_WEEK = "(org-agenda-span 'week)";
/** [id, org-agenda-custom-commands as written after the quote, global variables]. The command's key is x. */
export const CASES = [
  ['all block types', '(("x" "All" ((tags "+work") (tags-todo "+home") (search "overdue") (todo "NEXT") (alltodo "") (stuck "") (agenda ""))))', {}],
  ['agenda and todo', '(("x" "B" ((agenda "") (todo "NEXT"))))', {}],
  ['agenda block week', `(("x" "B" ((agenda "" (${SPAN_WEEK})) (todo "NEXT"))))`, {}],
  ['global span', `(("x" "B" ((agenda "") (todo "NEXT")) (${SPAN_WEEK})))`, {}],
  ['global span, block overrides', `(("x" "B" ((agenda "" ((org-agenda-span 'day))) (todo "NEXT")) (${SPAN_WEEK})))`, {}],
  ['single agenda', '(("x" "A" agenda ""))', {}],
  ['single agenda span week', `(("x" "A" agenda "" (${SPAN_WEEK})))`, {}],
  ['single agenda span 3', '(("x" "A" agenda "" ((org-agenda-span 3))))', {}],
  ['single agenda span fortnight', `(("x" "A" agenda "" ((org-agenda-span 'fortnight))))`, {}],
  ['single agenda start day', '(("x" "A" agenda "" ((org-agenda-span 2) (org-agenda-start-day "2026-10-12"))))', {}],
  ['single agenda start day offset', '(("x" "A" agenda "" ((org-agenda-span 2) (org-agenda-start-day "+1d"))))', {}],
  ['agenda warning days', '(("x" "A" agenda "" ((org-deadline-warning-days 1))))', {}],
  ['agenda warning days 0', '(("x" "A" agenda "" ((org-deadline-warning-days 0))))', {}],
  ['agenda skip function', `(("x" "A" agenda "" ((org-agenda-skip-function '(org-agenda-skip-entry-if 'todo '("NEXT"))))))`, {}],
  ['agenda sorting', `(("x" "A" agenda "" ((org-agenda-sorting-strategy '((agenda alpha-down))))))`, {}],
  ['agenda prefix', '(("x" "A" agenda "" ((org-agenda-prefix-format "%-8c|"))))', {}],
  ['agenda prefix alist', `(("x" "A" agenda "" ((org-agenda-prefix-format '((agenda . " %-6c %?-8t% s"))))))`, {}],
  ['agenda show all dates nil', `(("x" "A" agenda "" (${SPAN_WEEK} (org-agenda-show-all-dates nil))))`, {}],
  ['header on agenda', '(("x" "A" agenda "" ((org-agenda-overriding-header "Mine"))))', {}],
  ['header empty on agenda', '(("x" "A" agenda "" ((org-agenda-overriding-header ""))))', {}],
  ['block headers', '(("x" "B" ((tags "+work" ((org-agenda-overriding-header "Work"))) (todo "NEXT" ((org-agenda-overriding-header "Next"))) (stuck "" ((org-agenda-overriding-header "Stuck"))))))', {}],
  ['block header empty', '(("x" "B" ((tags "+work" ((org-agenda-overriding-header ""))) (todo "NEXT"))))', {}],
  ['global header', '(("x" "B" ((todo "NEXT") (tags "+home")) ((org-agenda-overriding-header "Same"))))', {}],
  ['single stuck', '(("x" "S" stuck ""))', {}],
  ['stuck settings', `(("x" "S" stuck "" ((org-stuck-projects '("+LEVEL=2/-DONE" ("WAIT") nil "")))))`, {}],
  ['stuck header', '(("x" "S" stuck "" ((org-agenda-overriding-header "None moving"))))', {}],
  ['files todo', `(("x" "B" ((todo "" ((org-agenda-files '("other.org")))) (todo "NEXT"))))`, {}],
  ['files agenda', `(("x" "B" ((agenda "" ((org-agenda-files '("other.org")))) (tags "+work"))))`, {}],
  ['files tags and stuck', `(("x" "B" ((tags "+home" ((org-agenda-files '("other.org")))) (stuck "" ((org-agenda-files '("other.org")))))))`, {}],
  ['files global', `(("x" "B" ((todo "") (tags "+work")) ((org-agenda-files '("other.org")))))`, {}],
  ['files both', `(("x" "B" ((todo "") (tags "+work")) ((org-agenda-files '("mini.org" "other.org")))))`, {}],
  // a filter preset works on the whole buffer: under the global settings of a composite command, or the settings of a single command; a block's own is not used
  ['tag preset in a block is not used', `(("x" "B" ((todo "" ((org-agenda-tag-filter-preset '("+work")))) (agenda "" ((org-agenda-tag-filter-preset '("+work")))))))`, {}],
  ['global tag preset', `(("x" "B" ((todo "") (agenda "") (tags "+LEVEL=2") (stuck "")) ((org-agenda-tag-filter-preset '("+work")))))`, {}],
  ['global tag preset exclude', `(("x" "B" ((todo "") (tags "+LEVEL=2")) ((org-agenda-tag-filter-preset '("-home")))))`, {}],
  ['global tag preset two', `(("x" "B" ((todo "")) ((org-agenda-tag-filter-preset '("+work" "+home")))))`, {}],
  ['global tag preset inherited', `(("x" "B" ((tags "+LEVEL=2")) ((org-agenda-tag-filter-preset '("+work")))))`, {}],
  ['global category preset', `(("x" "B" ((todo "") (agenda "")) ((org-agenda-category-filter-preset '("+notes")))))`, {}],
  ['global category preset exclude', `(("x" "B" ((todo "")) ((org-agenda-category-filter-preset '("-mini")))))`, {}],
  ['global regexp preset', `(("x" "B" ((todo "") (agenda "")) ((org-agenda-regexp-filter-preset '("+child")))))`, {}],
  ['global regexp preset exclude', `(("x" "B" ((todo "")) ((org-agenda-regexp-filter-preset '("-child")))))`, {}],
  ['global effort preset', `(("x" "B" ((todo "") (agenda "")) ((org-agenda-effort-filter-preset '("+<1:00")))))`, {}],
  ['global effort preset greater', `(("x" "B" ((todo "")) ((org-agenda-effort-filter-preset '("+>2:00")))))`, {}],
  ['single tags preset', `(("x" "T" tags "TODO=\\"TODO\\"" ((org-agenda-tag-filter-preset '("+home")))))`, {}],
  ['single todo preset', `(("x" "T" todo "" ((org-agenda-tag-filter-preset '("-home")))))`, {}],
  ['single agenda preset', `(("x" "T" agenda "" ((org-agenda-tag-filter-preset '("+home")))))`, {}],
  ['single stuck preset', `(("x" "T" stuck "" ((org-agenda-tag-filter-preset '("+home")))))`, {}],
  ['single category preset', `(("x" "T" todo "" ((org-agenda-category-filter-preset '("+notes")))))`, {}],
  ['preset variable', `(("x" "B" ((todo "") (agenda ""))))`, { 'org-agenda-tag-filter-preset': "'(\"+home\")" }],
  ['block sorting', `(("x" "B" ((tags "+LEVEL=2" ((org-agenda-sorting-strategy '(alpha-down)))) (tags "+LEVEL=2"))))`, {}],
  ['todo prefix', '(("x" "B" ((todo "NEXT" ((org-agenda-prefix-format "%c|"))) (tags "+work"))))', {}],
  ['tags prefix alist', `(("x" "B" ((todo "NEXT") (tags "+work")) ((org-agenda-prefix-format '((todo . "T %-6c") (tags . "G %-6c"))))))`, {}],
  ['empty tags', '(("x" "B" ((tags "+nothing") (todo "NEXT"))))', {}],
  ['todo several keywords', '(("x" "B" ((todo "NEXT|WAIT") (todo "TODO"))))', {}],
  ['global variables span', '(("x" "A" agenda ""))', { 'org-agenda-span': "'week" }],
  ['global variable overridden', `(("x" "A" agenda "" ((org-agenda-span 'day))))`, { 'org-agenda-span': "'week" }],
  // the "Press ..." hints under the heading of a single command
  ['hint tags', '(("x" "T" tags "+work"))', {}],
  ['hint tags-todo', '(("x" "T" tags-todo "+work"))', {}],
  ['hint search', '(("x" "T" search "deadline"))', {}],
  ['hint todo', '(("x" "T" todo "NEXT"))', {}],
  ['hint alltodo', '(("x" "T" alltodo ""))', {}],
  ['hint stuck', '(("x" "T" stuck ""))', {}],
  ['hint with header', '(("x" "T" tags "+work" ((org-agenda-overriding-header "Mine"))))', {}],
  ['hint with empty header', '(("x" "T" todo "" ((org-agenda-overriding-header ""))))', {}],
  ['hint in a block', '(("x" "T" ((tags "+work") (search "deadline") (todo "NEXT"))))', {}],
];
