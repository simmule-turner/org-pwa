;;; info-oracle.el --- what Emacs's info.el makes of Info manuals  -*- lexical-binding: t -*-
;;
;; Used by tools/gen-info-oracle.mjs and test/info-oracle.test.js (Emacs 29.3, batch):
;;   emacs --batch -Q -l tools/info-oracle.el --eval '(info-oracle-run "DIR" "QUERIES.json" "OUT.json")'
;; DIR holds the Info files (and a `dir' file). QUERIES.json says which manuals to read and what to ask each. OUT.json gets, for
;; each manual, every node (text as the reader shows it, pointers, menu entries, cross references, what is shown), the completion
;; table, the index nodes, the table of contents, and the answers to the goto, index and search queries.

(require 'info)
(require 'json)
(require 'subr-x)

(defun oc-vec (list) (vconcat list))
(defun oc-str (s) (and s (substring-no-properties s)))

(defun oc-menu ()
  "The entries of this node's menu: name, node and description, as Info-fontify-node's regexp finds them."
  (save-excursion
    (goto-char (point-min))
    (let ((case-fold-search t) res)
      (when (search-forward "\n* menu:" nil t)
        (while (re-search-forward
                (concat "^\\* Menu:\\|\\(?:^\\* +\\(" Info-menu-entry-name-re "\\)\\(:"
                        Info-node-spec-re "\\([ \t]*\\)\\)\\)")
                nil t)
          (when (match-beginning 1)
            (let ((name (match-string-no-properties 1))
                  (start (match-beginning 0))
                  (desc-from (match-end 0)))
              (let ((target (save-excursion (goto-char (+ start 2)) (Info-extract-menu-node-name))))
                (when target
                  (let ((desc (save-excursion
                                (goto-char desc-from)
                                (let ((parts (list (string-trim (buffer-substring-no-properties (point) (line-end-position))))))
                                  (while (and (= (forward-line 1) 0) (not (eobp))
                                              (looking-at "[ \t]+[^*\n]"))
                                    (push (string-trim (buffer-substring-no-properties (point) (line-end-position))) parts))
                                  (mapconcat #'identity (nreverse (delete "" parts)) " ")))))
                    (push (list (cons 'name name) (cons 'target (oc-str target)) (cons 'description desc)
                                (cons 'index (- start (point-min))))
                          res))))))))
      (nreverse res))))

(defun oc-xrefs ()
  (save-excursion
    (goto-char (point-min))
    (let ((case-fold-search t) res)
      (while (re-search-forward "\\*note[ \n\t]+" nil t)
        (let ((start (match-beginning 0)))
          (save-excursion
            (goto-char (+ start 5))
            (let ((target (Info-extract-menu-node-name t)))
              (when target
                (push (list (cons 'target (oc-str target)) (cons 'index (- start (point-min)))) res))))))
      (nreverse res))))

(defun oc-display ()
  "What the node shows after its first line (which Info covers with breadcrumbs): invisible text left out, display strings in."
  (save-excursion
    (goto-char (point-min))
    (forward-line 1)
    (let ((pos (point)) (end (point-max)) (out ""))
      (while (< pos end)
        (let ((next (min (next-single-char-property-change pos 'invisible nil end)
                         (next-single-char-property-change pos 'display nil end))))
          (cond ((get-char-property pos 'invisible) nil)
                ((let ((d (get-char-property pos 'display)))
                   (cond ((null d) nil)
                         ((stringp d) (setq out (concat out d)) t)
                         ((and (consp d) (eq (car d) 'space)) (setq out (concat out " ")) t)
                         (t t))))
                (t (setq out (concat out (buffer-substring-no-properties pos next)))))
          (setq pos next)))
      out)))

(defun oc-node (file name)
  (Info-find-node file name)
  (list (cons 'name Info-current-node)
        (cons 'text (buffer-substring-no-properties (point-min) (point-max)))
        (cons 'next (oc-str (Info-extract-pointer "next" t)))
        (cons 'prev (oc-str (Info-extract-pointer "prev[ious]*" t)))
        (cons 'up (oc-str (Info-extract-pointer "up" t)))
        (cons 'menu (oc-vec (oc-menu)))
        (cons 'xrefs (oc-vec (oc-xrefs)))
        (cons 'display (oc-display))
        (cons 'index (if (Info-index-node) t :json-false))
        (cons 'breadcrumbs (oc-str (save-excursion (Info-breadcrumbs))))))

(defun oc-goto (file query)
  (condition-case err
      (progn
        (Info-find-node file "Top" t)
        (Info-goto-node query)
        (list (cons 'node Info-current-node)
              (cons 'file (file-name-nondirectory Info-current-file))
              (cons 'point (- (point) (point-min)))))
    (error (list (cons 'error (error-message-string err))))))

(defun oc-index (file topic)
  (condition-case err
      (progn
        (Info-find-node file "Top" t)
        (setq Info-index-alternatives nil)
        (Info-index topic)
        (list (cons 'node Info-current-node)
              (cons 'point (- (point) (point-min)))
              (cons 'matches (oc-vec (mapcar (lambda (e)
                                              (list (cons 'entry (oc-str (nth 0 e))) (cons 'node (nth 1 e))
                                                    (cons 'indexNode (nth 2 e)) (cons 'line (nth 3 e))))
                                            Info-index-alternatives)))))
    (error (list (cons 'error (error-message-string err))))))

(defun oc-search (file regexp fold)
  "Repeated Info-search from the Top node: the node and where point is after each hit."
  (when (get-buffer "*info*") (kill-buffer "*info*"))
  (Info-find-node file "Top" t)
  (let ((hits nil) (n 0) (case-fold-search fold) (stop nil))
    (while (and (not stop) (< n 12))
      (condition-case _err
          (progn (Info-search regexp)
                 (push (list (cons 'node Info-current-node) (cons 'point (- (point) (point-min)))) hits))
        (error (setq stop t)))
      (setq n (1+ n)))
    (oc-vec (nreverse hits))))

(defun oc-walk (file)
  "Next-preorder and last-preorder from every node: what the SPC and DEL keys do at the end or the start of a node."
  (let (res)
    (dolist (n (Info-toc-build file))
      (let ((name (car n)))
        (push (list (cons 'node name)
                    (cons 'scrollUp (condition-case nil
                                        (progn (Info-find-node file name t)
                                               (goto-char (point-max))
                                               (or (condition-case nil
                                                       (progn (Info-goto-node (Info-extract-menu-counting 1)) t)
                                                     (error nil))
                                                   (Info-next-preorder))
                                               Info-current-node)
                                      (error nil)))
                    (cons 'scrollDown (condition-case nil
                                          (progn (Info-find-node file name t) (Info-last-preorder) Info-current-node)
                                        (error nil))))
              res)))
    (oc-vec (nreverse res))))

(defun oc-op (op)
  (pcase (car op)
    ("next" (Info-next))
    ("prev" (Info-prev))
    ("up" (Info-up))
    ("top" (Info-top-node))
    ("menu" (Info-menu (cadr op)))
    ("goto" (Info-goto-node (cadr op)))
    ("index" (Info-index (cadr op)))
    ("index-next" (Info-index-next 1))
    ("back" (Info-history-back))
    ("forward" (Info-history-forward))
    ("scroll-up" (goto-char (point-max))
     (or (Info-no-error (Info-goto-node (Info-extract-menu-counting 1))) (Info-next-preorder)))
    ("scroll-down" (Info-last-preorder))
    ("search" (let ((case-fold-search (eq (nth 2 op) t))) (Info-search (cadr op))))))

(defun oc-script (file ops)
  "Runs a list of commands from the Top node: the node, file, point, history length and error after each."
  (when (get-buffer "*info*") (kill-buffer "*info*"))
  (Info-find-node file "Top")
  (setq Info-history nil Info-history-list nil Info-history-forward nil Info-index-alternatives nil)
  (let (res)
    (dolist (op (append ops nil))
      (setq op (append op nil))
      (let ((err (condition-case e (progn (oc-op op) nil) (error (error-message-string e)))))
        (push (list (cons 'op (oc-vec op)) (cons 'node Info-current-node)
                    (cons 'file (file-name-nondirectory Info-current-file))
                    (cons 'point (- (point) (point-min)))
                    (cons 'history (length Info-history))
                    (cons 'forward (length Info-history-forward))
                    (cons 'error err))
              res)))
    (oc-vec (nreverse res))))

(defun oc-manual (file spec)
  (let* ((Info-fontify-visited-nodes nil)
         (toc (Info-toc-build file))
         (names (mapcar #'car toc))
         (topics (append (gethash "topics" spec) nil))
         (gotos (append (gethash "gotos" spec) nil))
         (searches (append (gethash "searches" spec) nil))
         (scripts (append (gethash "scripts" spec) nil)))
    (Info-find-node file "Top")
    (list
     (cons 'file file)
     (cons 'completions (oc-vec (mapcar (lambda (c) (if (consp c) (car c) c)) (Info-build-node-completions))))
     (cons 'indexNodes (oc-vec (Info-index-nodes Info-current-file)))
     (cons 'toc (oc-vec (mapcar (lambda (n) (list (cons 'name (nth 0 n)) (cons 'up (nth 1 n)) (cons 'section (nth 2 n))
                                                  (cons 'items (oc-vec (nth 3 n)))))
                                toc)))
     (cons 'tocText (progn (Info-find-node file "*TOC*") (buffer-substring-no-properties (point-min) (point-max))))
     (cons 'nodes (oc-vec (mapcar (lambda (name) (oc-node file name)) names)))
     (cons 'gotos (oc-vec (mapcar (lambda (q) (list (cons 'query q) (cons 'result (oc-goto file q)))) gotos)))
     (cons 'indexQueries (oc-vec (mapcar (lambda (q) (list (cons 'topic q) (cons 'result (oc-index file q)))) topics)))
     (cons 'searches (oc-vec (mapcar (lambda (s)
                                       (let ((re (gethash "regexp" s)) (fold (eq (gethash "fold" s) t)))
                                         (list (cons 'regexp re) (cons 'fold (if fold t :json-false))
                                               (cons 'hits (oc-search file re fold)))))
                                     searches)))
     (cons 'walk (oc-walk file))
     (cons 'scripts (oc-vec (mapcar (lambda (ops) (oc-script file ops)) scripts))))))

(defun info-oracle-run (dir queries-file out-file)
  (setq Info-directory-list (list dir)
        Info-additional-directory-list nil
        installation-directory nil
        Info-history nil Info-history-list nil)
  (let* ((q (with-temp-buffer
              (insert-file-contents queries-file)
              (goto-char (point-min))
              (json-parse-buffer :object-type 'hash-table :null-object nil :false-object :false)))
         (out nil))
    (maphash (lambda (file spec)
               (setq Info-index-nodes nil Info-toc-nodes nil Info-file-supports-index-cookies-list nil Info-file-completions nil)
               (push (cons file (condition-case err (oc-manual file spec)
                                  (error (list (cons 'error (error-message-string err))))))
                     out))
             q)
    (let ((coding-system-for-write 'utf-8))
      (with-temp-file out-file
        (insert (json-encode (nreverse out)))))))
