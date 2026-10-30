;;; oracle-babel.el --- what Emacs 29.3 (Org 9.6) does with source blocks, for tools/gen-oracle-babel.mjs
;;
;; Reads the JSON file named by ORACLE_IN (a list of cases, each with a "kind") and writes the JSON file named by ORACLE_OUT
;; (one result per case; a Lisp error becomes the string "ERROR message").  Run by:  emacs --batch -Q -l tools/oracle-babel.el
(require 'org)
(require 'ob-core)
(require 'ob-tangle)
(require 'ob-exp)
(require 'ox)
(require 'ob-js)
(require 'ob-emacs-lisp)
(require 'json)
(require 'cl-lib)
(setq org-confirm-babel-evaluate nil
      make-backup-files nil
      create-lockfiles nil
      inhibit-message t)

(defun ob--s (v) (cond ((null v) "") ((stringp v) v) (t (format "%s" v))))

(defun ob--params (params)
  "PARAMS (the light-mode alist) as an alist of (name . string), :var entries gathered into a list."
  (let (out vars)
    (dolist (p params)
      (let ((k (substring (symbol-name (car p)) 1)))
        (if (string= k "var")
            (push (ob--s (cdr p)) vars)
          (push (cons k (ob--s (cdr p))) out))))
    (append (nreverse out) (list (cons "var" (vconcat (nreverse vars)))))))

(defun ob--blocks (text)
  "Every source block of TEXT as Org sees it."
  (with-temp-buffer
    (insert text) (org-mode)
    (let (out)
      (org-element-map (org-element-parse-buffer) 'src-block
        (lambda (e)
          (goto-char (org-element-property :begin e))
          (let ((i (org-babel-get-src-block-info 'light)))
            (push (list (cons "line" (line-number-at-pos (org-element-property :begin e)))
                        (cons "lang" (ob--s (nth 0 i)))
                        (cons "body" (nth 1 i))
                        (cons "name" (ob--s (nth 4 i)))
                        (cons "params" (ob--params (nth 2 i))))
                  out))))
      (vconcat (nreverse out)))))

(defun ob--noweb (text index)
  (with-temp-buffer
    (insert text) (org-mode)
    (let ((n 0) out)
      (org-element-map (org-element-parse-buffer) 'src-block
        (lambda (e)
          (when (= n index)
            (goto-char (org-element-property :begin e))
            (setq out (org-babel-expand-noweb-references (org-babel-get-src-block-info 'light))))
          (setq n (1+ n))))
      out)))

(defun ob--noweb-p (value context)
  (if (org-babel-noweb-p (list (cons :noweb value)) context) t :json-false))

(defun ob--read-tree (dir)
  (let (out)
    (dolist (f (directory-files-recursively dir "" nil))
      (let ((rel (file-relative-name f dir)))
        (unless (string= rel "doc.org")
          (push (list (cons "path" rel)
                      (cons "text" (with-temp-buffer (insert-file-contents f) (buffer-string)))
                      (cons "mode" (format "%o" (logand (file-modes f) #o777))))
                out))))
    (vconcat (sort out (lambda (a b) (string< (cdr (assoc "path" a)) (cdr (assoc "path" b))))))))

(defun ob--tangle (text name)
  (let ((dir (make-temp-file "obt" t)))
    (unwind-protect
        (let ((default-directory (file-name-as-directory dir)) (file (expand-file-name name dir)))
          (write-region text nil file nil 'silent)
          (with-current-buffer (find-file-noselect file)
            (org-mode)
            (let ((org-babel-tangle-lang-exts org-babel-tangle-lang-exts))
              (org-babel-tangle))
            (set-buffer-modified-p nil)
            (kill-buffer))
          (let ((tree (ob--read-tree dir)))
            tree))
      (delete-directory dir t))))

(defun ob--export (text)
  (with-temp-buffer
    (insert text) (org-mode)
    (let ((org-export-babel-evaluate nil) (org-export-use-babel t)
          (org-babel-default-header-args (cons '(:eval . "never-export") org-babel-default-header-args)))
      (org-babel-exp-process-buffer))
    (buffer-string)))

(defun ob--exec (text index)
  "TEXT after org-babel-execute-src-block on the INDEXth block (0-based)."
  (with-temp-buffer
    (insert text) (org-mode)
    (let ((n 0) (done nil))
      (org-element-map (org-element-parse-buffer) 'src-block
        (lambda (e)
          (when (and (= n index) (not done))
            (setq done t)
            (goto-char (org-element-property :begin e))
            (org-babel-execute-src-block))
          (setq n (1+ n)))))
    (buffer-substring-no-properties (point-min) (point-max))))

(defun ob--run-case (c)
  (let ((kind (alist-get 'kind c)))
    (cond
     ((string= kind "blocks") (ob--blocks (alist-get 'text c)))
     ((string= kind "noweb") (ob--noweb (alist-get 'text c) (alist-get 'index c)))
     ((string= kind "nowebp") (ob--noweb-p (alist-get 'value c) (intern (concat ":" (alist-get 'context c)))))
     ((string= kind "tangle") (ob--tangle (alist-get 'text c) (or (alist-get 'name c) "doc.org")))
     ((string= kind "export") (ob--export (alist-get 'text c)))
     ((string= kind "exec") (ob--exec (alist-get 'text c) (alist-get 'index c)))
     (t (error "unknown kind %s" kind)))))

(defun ob--main ()
  (let* ((json-array-type 'list)
         (cases (json-parse-string (with-temp-buffer (insert-file-contents (getenv "ORACLE_IN")) (buffer-string))
                                   :object-type 'alist :array-type 'list))
         (out nil))
    (dolist (c cases)
      (push (condition-case err
                (let ((r (with-timeout (10 (error "TIMEOUT")) (ob--run-case c))))
                  (if (null r) "" r))
              (error (concat "ERROR " (error-message-string err))))
            out))
    (with-temp-file (getenv "ORACLE_OUT")
      (insert (json-encode (vconcat (nreverse out)))))))

(ob--main)
