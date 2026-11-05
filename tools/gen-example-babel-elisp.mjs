#!/usr/bin/env node
/**
 * Writes examples/babel-elisp.org: the sections below, with the #+RESULTS: Emacs 29.3 (org-babel-execute-src-block on each block in
 * turn) writes under each emacs-lisp block. test/example-babel-elisp.test.js holds the app to the file.
 *   node tools/gen-example-babel-elisp.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HEAD = `#+TITLE: Emacs Lisp blocks
#+STARTUP: showall

A cookbook for =emacs-lisp= source blocks, which run by default. Use the block's *Run* button (in Emacs, =C-c C-c=). The =#+RESULTS:= under each block is what Emacs 29.3 (Org 9.6.15) writes for it; the app writes the same text. The last section says where the two differ.
`;

export const SOURCE = `
* A value and its layout
A block's last value is laid out by its type: a number is a =: = line, a list of lists is a table, a list of values is a table of one row, and a string is a =: = line.

#+begin_src emacs-lisp
(* 6 7)
#+end_src

#+begin_src emacs-lisp
(list (list 1 2) (list 3 4))
#+end_src

#+begin_src emacs-lisp :results list
(list 1 2 3)
#+end_src

#+begin_src emacs-lisp
(concat "ab" "cd")
#+end_src

* Output instead of value
=:results output= collects what the code prints.

#+begin_src emacs-lisp :results output
(princ "one\\n")
(print '(1 "two"))
#+end_src

* Header arguments from the outline
=:header-args:emacs-lisp:= in a property drawer (or =#+PROPERTY: header-args:emacs-lisp= at the top of the file) gives every block below it its arguments, and the block's own header wins. A =:results= word replaces the word of the same kind from above: here the second block takes =value= in place of =output=.

** Printing for the whole subtree
:PROPERTIES:
:header-args:emacs-lisp: :results output
:END:

#+begin_src emacs-lisp
(princ (+ 1 2))
#+end_src

#+begin_src emacs-lisp :results value
(list 1 2)
#+end_src

* Variables
=:var= takes a number, a string, or the name of a table, a list, a result or a block anywhere in the file (the first one with that name). A named block is run, and a call such as =triple(n=4)= or =triple(4)= gives its variables. A header row followed by one rule is left out; \`name[row,column]\` picks a cell, counting from 0.

#+NAME: sales
| quarter | amount |
|---------+--------|
| Q1      |     10 |
| Q2      |     20 |

#+begin_src emacs-lisp :var data=sales
(mapcar (lambda (row) (* 2 (cadr row))) data)
#+end_src

#+begin_src emacs-lisp :var last=sales[-1,1]
last
#+end_src

#+NAME: ten
#+begin_src emacs-lisp
(* 2 5)
#+end_src

#+begin_src emacs-lisp :var n=ten
(+ n 1)
#+end_src

#+NAME: triple
#+begin_src emacs-lisp :var n=1
(* n 3)
#+end_src

#+begin_src emacs-lisp :var x=triple(n=4)
x
#+end_src

#+NAME: shopping
- milk
- eggs
- bread

#+begin_src emacs-lisp :var items=shopping
(length items)
#+end_src

#+HEADER: :var x=3
#+begin_src emacs-lisp :var y=4
(* x y)
#+end_src

* Noweb
=:noweb yes= replaces =<<name>>= by the body of the block with that name, before the block runs.

#+NAME: greeting
#+begin_src emacs-lisp :results silent
"hello"
#+end_src

#+begin_src emacs-lisp :noweb yes
(concat <<greeting>> ", world")
#+end_src

* Wrapping
=:wrap= puts the result in a block of that name; =:results raw= pastes text as Org.

#+begin_src emacs-lisp :wrap quote
(+ 1 1)
#+end_src

#+begin_src emacs-lisp :results raw
"*bold* and /italic/"
#+end_src
`;

const TAIL = `
* Where the app differs from Emacs
- A heading with an empty =:header-args:= value and a =:header-args+:= line makes Emacs drop the first two characters of the appended arguments (=:tangle yes= becomes =angle yes=); the app appends them as written.
- A block named in a =:var= must be an Emacs Lisp block; Emacs also runs a JavaScript block there.
- Emacs finds a block written inside a =:LOGBOOK:= drawer; the app does not.
- A line that looks like a heading ends the section in Emacs, so a block holding one is not a block there; the app keeps it a block.
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ex-babel-'));
fs.writeFileSync(path.join(dir, 'in.org'), HEAD + SOURCE);
fs.writeFileSync(path.join(dir, 'run.el'), `(require 'org) (require 'ob-core) (require 'ob-emacs-lisp)
(setq org-confirm-babel-evaluate nil make-backup-files nil inhibit-message t)
(with-temp-buffer
  (insert-file-contents (expand-file-name "in.org" (getenv "DIR"))) (org-mode)
  (let ((n (length (org-element-map (org-element-parse-buffer) 'src-block #'identity))))
    (dotimes (i n)
      (let ((k 0) (done nil))
        (org-element-map (org-element-parse-buffer) 'src-block
          (lambda (e) (when (and (= k i) (not done)) (setq done t) (goto-char (org-element-property :begin e)) (org-babel-execute-src-block)) (setq k (1+ k)))))))
  (write-region (point-min) (point-max) (expand-file-name "out.org" (getenv "DIR"))))`);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, DIR: dir, TZ: 'America/New_York' }, encoding: 'utf8' });
if (r.status !== 0) throw new Error(r.stderr);
const out = fs.readFileSync(path.join(dir, 'out.org'), 'utf8');
fs.writeFileSync(new URL('../examples/babel-elisp.org', import.meta.url), out.replace(/\n+$/, '\n') + TAIL);
console.log('wrote examples/babel-elisp.org');
