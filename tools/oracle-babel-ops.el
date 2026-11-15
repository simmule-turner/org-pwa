;;; oracle-babel-ops.el --- what Emacs 29.3 (Org 9.6) does with Babel commands, for tools/gen-oracle-babel-ops.mjs
;;
;; Reads the JSON file named by ORACLE_IN (a list of cases) and writes the JSON file named by ORACLE_OUT (one result per case; a Lisp
;; error becomes the string "ERROR message").  A case is { op, text, vars?, lob?, arg? }.  In `text' the character U+2038 marks point
;; (it is taken out, and put back in the result where point ends up).  `vars' is { symbol: lisp-text } bound while the command runs;
;; `lob' is a list of texts whose named blocks are ingested into the Library of Babel first.
;; Run by:  emacs --batch -Q -l tools/oracle-babel-ops.el
(require 'org)
(require 'ob-core)
(require 'ob-lob)
(require 'ob-table)
(require 'ob-emacs-lisp)
(require 'ob-js)
(require 'json)
(require 'cl-lib)
(setq org-confirm-babel-evaluate nil
      make-backup-files nil
      create-lockfiles nil
      inhibit-message t
      default-directory (file-name-as-directory (make-temp-file "obo" t)))

(defconst obo--mark "‸")

(defun obo--with-buffer (text fn &optional dir)
  "Runs FN in an Org buffer holding TEXT with point at the mark; returns the text with the mark where point ends.
With DIR the buffer visits DIR/doc.org (without a file)."
  (with-temp-buffer
    (when dir (setq default-directory dir buffer-file-name (expand-file-name "doc.org" dir)))
    (insert text)
    (goto-char (point-min))
    (let ((at (if (search-forward obo--mark nil t) (progn (delete-region (match-beginning 0) (point)) (point)) (point-min))))
      (org-mode)
      (goto-char at)
      (funcall fn)
      (insert obo--mark)
      (buffer-substring-no-properties (point-min) (point-max)))))

(defun obo--ingest (texts)
  (setq org-babel-library-of-babel nil)
  (dolist (text texts)
    (let ((file (make-temp-file "obolob" nil ".org")))
      (write-region text nil file nil 'silent)
      (org-babel-lob-ingest file)
      (delete-file file))))

(defun obo--run (c)
  (let* ((op (alist-get 'op c))
         (arg (alist-get 'arg c))
         (vars (alist-get 'vars c))
         (syms (mapcar (lambda (p) (intern (symbol-name (car p)))) vars))
         (vals (mapcar (lambda (p) (car (read-from-string (cdr p)))) vars)))
    (obo--ingest (alist-get 'lob c))
    (let ((dir (and (alist-get 'file c) (file-name-as-directory (make-temp-file "obodir" t)))))
     (unwind-protect
     (cl-progv syms vals
      (obo--with-buffer
       (alist-get 'text c)
       (lambda ()
         (cond
          ((string= op "maybe") (unless (org-babel-execute-maybe) (error "not on anything executable")))
          ((string= op "src") (org-babel-execute-src-block))
          ((string= op "next") (org-babel-next-src-block (or arg 1)))
          ((string= op "previous") (org-babel-previous-src-block (or arg 1)))
          ((string= op "where")
           (let ((p (org-babel-where-is-src-block-result))) (if p (goto-char p) (error "no result"))))
          ((string= op "remove") (org-babel-remove-result-one-or-many arg))
          ((string= op "buffer") (org-babel-execute-buffer))
          ((string= op "subtree") (org-babel-execute-subtree))
          ((string= op "sbe") (org-table-recalculate-buffer-tables))
          (t (error "unknown op %s" op))))
       dir))
      (when dir (delete-directory dir t))))))

(defun obo--main ()
  (let* ((cases (json-parse-string (with-temp-buffer (insert-file-contents (getenv "ORACLE_IN")) (buffer-string))
                                   :object-type 'alist :array-type 'list))
         (out nil))
    (dolist (c cases)
      (push (condition-case err
                (with-timeout (10 (error "TIMEOUT")) (obo--run c))
              (error (concat "ERROR " (error-message-string err))))
            out))
    (with-temp-file (getenv "ORACLE_OUT")
      (insert (json-encode (vconcat (nreverse out)))))))

(obo--main)
