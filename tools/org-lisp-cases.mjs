/**
 * What the Org functions an agenda setting may call are compared with Emacs 29.3 on (tools/gen-org-lisp-oracle.mjs, test/org-lisp.test.js):
 * a document, and forms evaluated with the cursor on each heading in turn.
 */
export const DOC = `:PROPERTIES:
:CATEGORY: topcat
:Top: tv
:Acc: a
:Acc+: b
:Owner: Top Owner
:END:
#+CATEGORY: work
#+FILETAGS: :ft:
* TODO [#A] Alpha project :proj:big:
SCHEDULED: <2026-10-28 Wed>
:PROPERTIES:
:Owner: Ann
:Empty:
:END:
** NEXT Child task :next:
DEADLINE: <2026-11-01 Sun>
:PROPERTIES:
:CATEGORY: sub
:END:
*** DONE Grandchild
CLOSED: [2026-10-20 Tue 09:00]
* Plain heading
** [#C] Low prio :a:
* COMMENT Hidden
* TODO Write *bold* report [1/2]
* TODO [#B] Spaced out        :s:t:
* Dupes :ft:x:big:
** Child :x:y:
:PROPERTIES:
:Own+: 2
:Own: 1
:Own+: 3
:Acc+: c
:END:
`;

export const FORMS = [
  '(org-entry-get nil "ITEM")', '(org-entry-get nil "TODO")', '(org-entry-get nil "PRIORITY")', '(org-entry-get nil "TAGS")', '(org-entry-get nil "ALLTAGS")',
  '(org-entry-get nil "CATEGORY")', '(org-entry-get nil "SCHEDULED")', '(org-entry-get nil "DEADLINE")', '(org-entry-get nil "CLOSED")',
  '(org-entry-get nil "Own")', '(org-entry-get nil "Own" t)', '(org-entry-get nil "Acc")', '(org-entry-get nil "Acc" t)', '(org-entry-get nil "Top")', '(org-entry-get nil "Top" t)', '(org-entry-get-with-inheritance "Top")',
  '(org-entry-get nil "Owner" (quote selective))', '(let ((org-use-property-inheritance t)) (org-entry-get nil "Owner" (quote selective)))',
  '(let ((org-use-property-inheritance (quote ("owner")))) (org-entry-get nil "Owner" (quote selective)))', '(let ((org-use-property-inheritance (quote ("top")))) (org-entry-get nil "Owner" (quote selective)))',
  '(let ((org-use-property-inheritance "^Ow")) (org-entry-get nil "Owner" (quote selective)))', '(let ((org-use-property-inheritance "^T")) (org-entry-get nil "Owner" (quote selective)))',
  '(let ((org-use-property-inheritance t)) (org-entry-get nil "Acc" (quote selective)))',
  '(let ((org-use-tag-inheritance nil)) (org-get-tags))', '(let ((org-use-tag-inheritance (quote ("proj")))) (org-get-tags))', '(let ((org-use-tag-inheritance "^p")) (org-get-tags))',
  '(let ((org-tags-exclude-from-inheritance (quote ("big")))) (org-get-tags))', '(let ((org-use-tag-inheritance (quote ("big" "x"))) (org-tags-exclude-from-inheritance (quote ("big")))) (org-get-tags))',
  '(let ((org-use-tag-inheritance "^.") (org-tags-exclude-from-inheritance (quote ("ft")))) (org-get-tags))', '(let ((org-tags-exclude-from-inheritance (quote ("x")))) (org-get-tags nil t))',
  '(org-entry-get nil "Owner")', '(org-entry-get nil "owner")', '(org-entry-get nil "OWNER" t)', '(org-entry-get nil "Owner" t)', '(org-entry-get nil "Empty")', '(org-entry-get nil "Missing")',
  '(org-entry-get-with-inheritance "Owner")', '(org-entry-get-with-inheritance "CATEGORY")',
  '(org-get-heading)', '(org-get-heading t)', '(org-get-heading nil t)', '(org-get-heading nil nil t)', '(org-get-heading nil nil nil t)', '(org-get-heading t t t t)',
  '(org-get-todo-state)', '(org-get-tags)', '(org-get-tags nil t)', '(org-get-category)', '(org-outline-level)', '(org-entry-is-todo-p)', '(org-entry-is-done-p)',
  '(org-entry-get nil 5)', '(org-get-heading "x")',
];
