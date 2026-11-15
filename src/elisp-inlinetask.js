// @ts-check
/**
 * The movement and test functions of org-inlinetask.el, written in Lisp as Org writes them (Org 9.6.15) and run on the interpreter's
 * buffers: `org-inlinetask-outline-regexp`, `-end-p`, `-at-task-p`, `-in-task-p`, `-goto-beginning`, `-goto-end` and `-get-task-level`,
 * with `org-match-line`. `org-inlinetask-min-level` is the level the app's `org-modules` setting gives (see src/inline-tasks.js).
 */
import { Reader } from './elisp-read.js';
import { NIL, intern } from './elisp-data.js';
import { evalForm, resetRun, topScope } from './elisp-core.js';

const SOURCE = String.raw`
(defun org-match-line (regexp)
  (save-excursion (beginning-of-line) (looking-at regexp)))
(defun org-inlinetask-outline-regexp ()
  (let ((nstars (if org-odd-levels-only
		    (1- (* org-inlinetask-min-level 2))
		  org-inlinetask-min-level)))
    (format "^\\(\\*\\{%d,\\}\\)[ \t]+" nstars)))
(defun org-inlinetask-end-p ()
  (let ((case-fold-search t))
    (org-match-line (concat (org-inlinetask-outline-regexp) "END[ \t]*$"))))
(defun org-inlinetask-at-task-p ()
  (and (org-match-line (concat (org-inlinetask-outline-regexp)  "\\(.*\\)"))
       (not (org-inlinetask-end-p))))
(defun org-inlinetask-in-task-p ()
  (save-excursion
    (beginning-of-line)
    (let ((case-fold-search t))
      (or (looking-at-p (concat (org-inlinetask-outline-regexp) "\\(?:.*\\)"))
	  (and (re-search-forward "^\\*+[ \t]+" nil t)
	       (org-inlinetask-end-p))))))
(defun org-inlinetask-goto-beginning ()
  (end-of-line)
  (let ((case-fold-search t)
	(inlinetask-re (org-inlinetask-outline-regexp)))
    (re-search-backward inlinetask-re nil t)
    (when (org-inlinetask-end-p)
      (re-search-backward inlinetask-re nil t))))
(defun org-inlinetask-goto-end ()
  (save-match-data
    (beginning-of-line)
    (let ((case-fold-search t)
	  (inlinetask-re (org-inlinetask-outline-regexp)))
      (cond
       ((org-inlinetask-end-p)
        (forward-line))
       ((looking-at-p inlinetask-re)
        (forward-line)
        (cond
         ((org-inlinetask-end-p) (forward-line))
         ((looking-at-p inlinetask-re))
         ((org-inlinetask-in-task-p)
          (re-search-forward inlinetask-re nil t)
          (forward-line))
         (t nil)))
       (t
        (re-search-forward inlinetask-re nil t)
        (forward-line)))))
  (point))
(defun org-inlinetask-get-task-level ()
  (save-excursion
    (end-of-line)
    (re-search-backward (org-inlinetask-outline-regexp) nil t)
    (- (match-end 1) (match-beginning 1))))
`;

for (const [name, value] of /** @type {[string, import('./elisp-data.js').LObj][]} */ ([['org-odd-levels-only', NIL], ['org-inlinetask-min-level', 15]])) {
  const sym = intern(name);
  sym.special = true;
  sym.value = value;
}

const reader = new Reader(SOURCE);
resetRun({ budget: 1_000_000 });
const scope = topScope();
while (reader.more()) evalForm(reader.read(), scope);
resetRun();
