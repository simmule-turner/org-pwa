;;; sample.el --- a sample  -*- lexical-binding: t; -*-

(require 'cl-lib)
(defvar my-count 0 "Number of things.")
(defconst my-limit 10)
(defcustom my-name "x" "Doc string." :type 'string :group 'my)
(defun my-add (a &optional b)
  "Add A and B.
Second doc line."
  (let ((sum (+ a (or b 0))) (s "text \"q\" \n"))
    (when (> sum 5) (message "big %d" sum))
    (if (and sum t) nil (setq my-count (1+ my-count)))
    (dolist (x '(1 2 3.5 #x1f ?a)) (push x s))
    (condition-case err (car-safe s) (error (signal 'foo err)))
    (lambda (y) (* y 2))))
(defmacro my-mac (&rest body) `(progn ,@body))
(cl-defun my-key (&key foo) foo)
(add-hook 'my-hook #'my-add) ; trailing comment
;; line comment
(provide 'sample)
