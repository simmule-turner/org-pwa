;;; gen-info.el --- README.org to Texinfo, and which node each heading became  -*- lexical-binding: t; -*-
;; Run by tools/gen-info.mjs:  emacs -Q --batch -l tools/gen-info.el IN.org OUT.texi OUT.json
;; Org's own ox-texinfo does the export.  Every headline is recorded with the node (or anchor) Texinfo names it, in document order,
;; with its CUSTOM_ID, so the app can open the manual at the node that a link or a Settings hint points to.
(require 'ox-texinfo)
(require 'json)

(let ((in (nth 0 command-line-args-left))
      (out (nth 1 command-line-args-left))
      (map-file (nth 2 command-line-args-left))
      (seen nil))
  (setq command-line-args-left nil)
  (setq org-export-use-babel nil
        org-export-with-broken-links nil)
  (advice-add 'org-texinfo-headline :before
              (lambda (headline _contents info)
                (push (list (org-element-property :begin headline)
                            (org-element-property :CUSTOM_ID headline)
                            (org-texinfo--get-node headline info))
                      seen)))
  (with-current-buffer (find-file-noselect in)
    (org-export-to-file 'texinfo out))
  (let ((ordered (sort seen (lambda (a b) (< (car a) (car b))))))
    (with-temp-file map-file
      (insert (json-encode
               (list (cons 'nodes (vconcat (mapcar #'caddr ordered)))
                     (cons 'ids (let (alist)
                                  (dolist (e ordered)
                                    (when (cadr e) (push (cons (intern (cadr e)) (caddr e)) alist)))
                                  (nreverse alist)))))))))
