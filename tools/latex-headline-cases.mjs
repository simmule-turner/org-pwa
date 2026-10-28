// org-latex-format-headline-function: an init that sets it and an Org text (tools/gen-latex-headline-oracle.mjs, test/latex-headline.test.js).
const show = '(setq org-latex-format-headline-function (lambda (todo todo-type priority text tags info) (format "<%s|%s|%s|%s|%S>" todo todo-type priority text tags)))';
const c = (init, org) => ({ init, org });
export const CASES = [
  c(show, '* TODO [#A] Title :a:b:\n'),
  c(show, '* DONE Finished\n'),
  c(show, '* Plain\n'),
  c(show, '* TODO Plain todo\n'),
  c(show, '* [#B] Only priority\n'),
  c(show, '* Tagged :work:\n'),
  c(show, '* A *bold* title and _under_\n'),
  c(show, '* One\n** Two\n*** Three\n**** Four :x:\n***** Five\n'),
  c(show, '#+TODO: NEXT WAIT | FINISHED\n* NEXT first\n* WAIT second\n* FINISHED third\n'),
  c(show, '#+OPTIONS: todo:nil pri:t tags:nil\n* TODO [#A] Title :a:\n'),
  c(show, '#+OPTIONS: todo:t pri:nil tags:t\n* TODO [#A] Title :a:\n'),
  c(show, '* TODO [#a] lower\n'),
  c('(setq org-latex-format-headline-function (lambda (todo todo-type priority text tags info) (concat (upcase text) "!")))', '* hello\n** world\n'),
  c('(defun my-fmt (todo todo-type priority text tags info) (if todo (format "[%s] %s" todo text) text))\n(setq org-latex-format-headline-function #\'my-fmt)', '* TODO a\n* b\n'),
  c('(defun my-fmt (todo todo-type priority text tags info) (format "%s%s" text (if tags (concat " #" (mapconcat #\'identity tags ",")) "")))\n(setq org-latex-format-headline-function (quote my-fmt))', '* a :x:y:\n* b\n'),
  c('(setq org-latex-format-headline-function (lambda (&rest args) "FIXED"))', '* one\n* two\n'),
  c('(setq org-latex-format-headline-function (lambda (todo todo-type priority text tags info) (if (eq todo-type (quote done)) (concat "\\\\sout{" text "}") text)))', '* TODO open\n* DONE closed\n'),
  c('(setq org-latex-format-headline-function (lambda (todo todo-type priority text tags info) (format "%c" priority)))', '* [#C] x\n'),
  c('(setq org-latex-format-headline-function (lambda (todo todo-type priority text tags info) (car 1)))', '* boom\n'),
  c('(setq org-latex-format-headline-function (lambda (todo todo-type priority text tags info) text))', '* One\n* Two\n- a list\n\ntext\n'),
  c('(setq org-latex-format-headline-function (quote org-latex-format-headline-default-function))', '* TODO [#A] Default :t:\n'),
];
