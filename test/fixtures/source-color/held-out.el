;;; sample.el --- demo  -*- lexical-binding: t; -*-
(require 'cl-lib)
(defvar my-var 42 "A documented variable.")
(defcustom my-opt nil "Option." :type 'boolean :group 'demo)
(defconst my-const '(1 2 3))
(defmacro my-when (cond &rest body) "Doc." `(if ,cond (progn ,@body)))
(defun my-fn (a &optional b &rest c)
  "Docstring with `quoted' and \\[command]."
  (interactive "p")
  (let* ((x (+ a 1)) (y (or b 2.5)))
    (when (and x (> y 0))
      (message "x=%d y=%s" x y)
      (condition-case err
          (cl-loop for i from 1 to 10 collect (* i i))
        (error (signal 'my-error (list err)))))
    (unless t (error "never"))
    (setq my-var (lambda (z) (funcall #'identity z)))
    :keyword ?a ?\n 'sym "str\n" nil t))
;; comment
(provide 'sample)
