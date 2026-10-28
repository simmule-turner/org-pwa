// The sections of examples/lisp-init.org (tools/gen-lisp-init-example.mjs, test/example-lisp-init.test.js). `init` is the Lisp as typed in
// Settings → Advanced → Lisp init; `show` are expressions evaluated after it, whose values Emacs printed.
export const SECTIONS = [
  {
    heading: 'Settings',
    prose: '=setq= gives a setting a value, written as in Emacs. Numbers can be computed.',
    init: `(setq org-agenda-files '("github:home.org" "github:journal.org")
      org-deadline-warning-days (* 2 7)
      org-log-done 'time)`,
    show: ['org-agenda-files', 'org-deadline-warning-days', 'org-log-done'],
  },
  {
    heading: 'Lists',
    prose: '=add-to-list= and =push= add to a list you have set. A third argument of =t= adds at the end.',
    init: `(setq my-list nil my-other nil)
(add-to-list 'my-list 'a)
(add-to-list 'my-list 'b t)
(add-to-list 'my-list 'a)
(push "z" my-other)`,
    show: ['my-list', 'my-other'],
  },
  {
    heading: 'A variable that was never set',
    prose: '=add-to-list= and =push= need a variable that has a value. On one that was never set, Emacs reports that it is void, and the form after it still runs. The variables the app knows, such as =org-modules= and =org-capture-templates=, always have one.',
    init: `(add-to-list 'never-set 'a)
(push 1 never-set-either)
(add-to-list 'org-modules 'org-habit)`,
    show: ["(boundp 'never-set)", "(car org-modules)"],
  },
  {
    heading: 'Functions and computed values',
    prose: 'All of Lisp is there to compute a value: =defun=, =let=, loops, =format=. What the init defines is there for diary entries and holiday lists too.',
    init: `(defun double (n) (* 2 n))
(setq doubled (let ((acc nil))
                (dolist (x '(1 2 3)) (push (double x) acc))
                (nreverse acc)))
(setq label (mapconcat #'identity '("x" "y") "-"))`,
    show: ['doubled', 'label', '(format "%s has %d items, %.1f%%" label (length doubled) 12.5)'],
  },
  {
    heading: 'Holidays',
    prose: 'The holiday lists are variables. This switches the general holidays off and adds a day of your own. See =holidays.org= for every entry and flag.',
    init: `(setq holiday-general-holidays nil)
(setq holiday-other-holidays
      '((holiday-fixed 3 14 "Pi Day")
        (holiday-float 11 4 4 "Thanksgiving")))`,
    show: ['holiday-general-holidays', 'holiday-other-holidays'],
  },
  {
    heading: 'A capture template',
    prose: 'Templates are read as Emacs reads them and appear beside the JSON ones. See =capture-templates.org=.',
    init: `(setq org-capture-templates
      '(("t" "Todo" entry (file+headline "gtd.org" "Tasks")
         "* TODO %?\\n  %i")))`,
    show: ['org-capture-templates', '(car (car org-capture-templates))'],
  },
  {
    heading: 'LaTeX settings',
    prose: 'The LaTeX export reads the ox-latex variables, among them the source block backend and the table options.',
    init: `(setq org-latex-src-block-backend 'minted
      org-latex-tables-booktabs t
      org-latex-default-figure-position "htbp")`,
    show: ['org-latex-src-block-backend', 'org-latex-tables-booktabs', 'org-latex-default-figure-position'],
  },
  {
    heading: 'A function as a setting',
    prose: 'Some settings name a function. =org-latex-format-headline-function= formats every section title; the Agenda settings such as =org-agenda-cmp-user-defined= work the same way. The expressions below call the function directly.',
    init: `(setq org-latex-format-headline-function
      (lambda (todo todo-type priority text tags info)
        (concat (if todo (format "[%s] " todo) "") (upcase text))))`,
    show: ['(funcall org-latex-format-headline-function "TODO" (quote todo) nil "Write" nil nil)', '(funcall org-latex-format-headline-function nil nil nil "Plan" nil nil)'],
  },
  {
    heading: 'When a form fails',
    prose: 'A form that fails shows Emacs\'s message in the status line, and the forms after it still run.',
    init: `(setq before 1)
(car 5)
(no-such-function 1)
(setq after 2)`,
    show: ['before', 'after'],
    errors: true,
  },
];
