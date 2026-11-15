// The cases of tools/gen-oracle-babel-ops.mjs: { op, text (the point is the ‸ mark), vars?, lob?, arg? } for the commands of src/babel-ops.js.
export const opsCases = [
{
"op": "maybe",
"text": "* H\na src_emacs-lisp{(+ 1 2)‸} {{{results(=3=)}}} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results raw]{\"*bold*\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results html]{\"<b>x</b>\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results code]{(list 1 2)‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results silent]{1‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results output]{(princ \"hi\\nthere\")‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp{(list 1 2)‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results table]{(list 1 2)‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results list]{\"a\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:wrap src emacs-lisp]{\"a\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:wrap quote]{\"a\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:wrap export html]{\"a\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:wrap example]{\"a\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results drawer]{\"a\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results org]{\"a\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp{\"a b\"‸}\nnext line\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp{\"a, b)\"‸}\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp{ \"x\" ‸}   tail\n"
},
{
"op": "maybe",
"text": "* H\nsrc_emacs-lisp{ (+ 1 2) }‸\n\n{{{results(=3=)}}}\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp{(+ 1 2)}‸ {{{results(=3=)}}}  \n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp{(+ 1 2)}‸ {{{results(=old=)}}} and src_emacs-lisp{1}\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp{nil‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp{\"a=b)\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp{\"a,b\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp{\"a\\\\b\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp{(+ 1 2)‸} z\n",
"vars": {
"org-babel-inline-result-wrap": "\"<<%s>>\""
}
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results file :file x.png]{\"a\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results file]{\"a.png\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results graphics :file x.png]{\"a.png\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results link :file x.png]{\"a.png\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:var x=3]{(* x 2)‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results scalar]{\"a b\"‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results raw]{(list 1 2)‸} z\n"
},
{
"op": "maybe",
"text": "* H\na src_emacs-lisp[:results prepend]{1‸} {{{results(=2=)}}} z\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(4)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(x=4)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(x=4) :results raw\n‸"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g[:results raw](x=4)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g[:results raw](x=4)[:results silent]‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g[:results output](x=4)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: f(x=4, y=5)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g()‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(x=4)‸\n\n#+RESULTS:\n: old\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+NAME: c1\n#+CALL: g(x=4)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(x=4) ‸\n\nnext\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: nosuch(x=4)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\ntext call_g(x=4)‸ more\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\ntext call_g[:results raw](x=4)‸ more\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\ntext call_g(x=4)[:results raw]‸ more\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\ntext call_f(x=4,y=5)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\ntext call_g(x=4)‸ {{{results(=8=)}}} more\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\ntext call_g(x=4, :wrap quote)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(x=4) :var x=9‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g[:var x=9](x=4)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(x='(1 2))‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(x=\"a\")‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(x=(+ 1 2))‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g[:eval never](x=4)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g[:post h(*this*)](x=4)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(4)‸\n#+RESULTS:\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: lg(x=4)‸\n",
"lob": [
"* L\n#+NAME: lg\n#+begin_src emacs-lisp :var x=1\n(+ x 100)\n#+end_src\n"
]
},
{
"op": "maybe",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(x=4)‸\n",
"lob": [
"* L\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(+ x 100)\n#+end_src\n"
]
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp :results file :file x.png :dir sub :mkdirp yes\n\"a\"‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp :results file :file x.png :dir ../o :mkdirp yes\n\"a\"‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp :results file :file x.png :dir . \n\"a\"‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp :results file :file x.png :output-dir out\n\"a\"‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+NAME: nm\n#+begin_src emacs-lisp :results file :file-ext png\n\"a\"‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+NAME: nm\n#+begin_src emacs-lisp :results file :file-ext png :output-dir out\n\"a\"‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp :results file :file x.png :file-desc pic\n\"a\"‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp :results file :file x.png :file-desc\n\"a\"‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp :results file link :file x.png\n\"a\"‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp :results file graphics :file x.png\n\"a\"‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp :results file :file x.png :file-mode (identity #o755)\n\"a\"‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+NAME: h\n#+begin_src emacs-lisp :var x=0\n(list \"post\" x)\n#+end_src\n\n#+begin_src emacs-lisp :post h(*this*)\n7‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+NAME: h\n#+begin_src emacs-lisp :var x=0\n(* x 3)\n#+end_src\n\n#+begin_src emacs-lisp :post h(*this*)\n7‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+NAME: h\n#+begin_src emacs-lisp :var x=0\n(format \"<%s>\" x)\n#+end_src\n\n#+begin_src emacs-lisp :post h(*this*) :results raw\n7‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp :post nosuch(*this*)\n7‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+NAME: tb\n| a | b |\n\n#+begin_src emacs-lisp :post tb\n7‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp :eval never\n7‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp :eval no\n7‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp :eval never-export\n7‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp :results table\n(list 1 2)‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp\n(mapconcat (lambda (x) (format \"line %d\" x)) (number-sequence 1 11) \"\\n\")‸\n#+end_src\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp\n(mapconcat (lambda (x) (format \"line %d\" x)) (number-sequence 1 11) \"\\n\")‸\n#+end_src\n",
"vars": {
"org-babel-min-lines-for-block-output": "3"
}
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp\n(mapconcat (lambda (x) (format \"line %d\" x)) (number-sequence 1 4) \"\\n\")‸\n#+end_src\n",
"vars": {
"org-babel-min-lines-for-block-output": "3",
"org-babel-uppercase-example-markers": "t"
}
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp\n1‸\n#+end_src\n",
"vars": {
"org-babel-results-keyword": "\"results\""
}
},
{
"op": "maybe",
"file": true,
"text": "* H\n‸#+CALL: nosuch(1)\n"
},
{
"op": "maybe",
"file": true,
"text": "* H\n#+begin_src emacs-lisp\n1\n#+end_src\n\n‸\n"
},
{
"op": "next",
"text": "* A\n‸text\n#+begin_src emacs-lisp\n1\n#+end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n"
},
{
"op": "next",
"text": "* A\ntext\n#+begin_src emacs-lisp\n1\n#+end_src\n‸mid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n"
},
{
"op": "next",
"text": "* A\ntext\n#+begin_src emacs-lisp\n1\n#+‸end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n"
},
{
"op": "next",
"text": "* A\ntext\n#+begin_src emacs-lisp\n1\n#+end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n‸* C\n  #+begin_src sh\n3\n  #+end_src\nend\n"
},
{
"op": "next",
"text": "* A\n‸text\n#+begin_src emacs-lisp\n1\n#+end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n",
"arg": 2
},
{
"op": "next",
"text": "* A\n‸text\n#+begin_src emacs-lisp\n1\n#+end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n",
"arg": 3
},
{
"op": "next",
"text": "* A\n‸text\n#+begin_src emacs-lisp\n1\n#+end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n",
"arg": 4
},
{
"op": "next",
"text": "* A\ntext\n#+begin_src emacs-lisp\n1\n#+‸end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n",
"arg": 1
},
{
"op": "previous",
"text": "* A\ntext\n#+begin_src emacs-lisp\n1\n#+‸end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n"
},
{
"op": "previous",
"text": "* A\ntext\n#+begin_src emacs-lisp\n1\n#+end_src\n‸mid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n"
},
{
"op": "previous",
"text": "* A\n‸text\n#+begin_src emacs-lisp\n1\n#+end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n"
},
{
"op": "previous",
"text": "* A\ntext\n‸#+begin_src emacs-lisp\n1\n#+end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n"
},
{
"op": "previous",
"text": "* A\ntext\n#+begin_src emacs-lisp\n‸1\n#+end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n"
},
{
"op": "previous",
"text": "* A\ntext\n#+begin_src emacs-lisp\n1\n#+end_src\nmid\n‸** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n"
},
{
"op": "previous",
"text": "* A\ntext\n#+begin_src emacs-lisp\n1\n#+‸end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n",
"arg": 2
},
{
"op": "previous",
"text": "* A\ntext\n#+begin_src emacs-lisp\n1\n#+‸end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n",
"arg": 3
},
{
"op": "previous",
"text": "* A\ntext\n#+begin_src emacs-lisp\n1\n#+‸end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n",
"arg": 4
},
{
"op": "next",
"text": "* A\ntext\n‸#+begin_src emacs-lisp\n1\n#+end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n"
},
{
"op": "next",
"text": "* A\ntext\n#+begin_src emacs-lisp\n‸1\n#+end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n"
},
{
"op": "next",
"text": "* A\n‸text\n#+begin_src emacs-lisp\n1\n#+end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n",
"arg": 0
},
{
"op": "next",
"text": "* A\n‸text\n#+begin_src emacs-lisp\n1\n#+end_src\nmid\n** B\n#+NAME: n\n#+begin_src js\n2\n#+end_src\n#+begin_example\n#+begin_src js\nno\n#+end_src\n#+end_example\n* C\n  #+begin_src sh\n3\n  #+end_src\nend\n",
"arg": -1
},
{
"op": "where",
"text": "* H\n‸#+NAME: f\n#+begin_src emacs-lisp\n1\n#+end_src\n\n#+RESULTS: f\n: 1\n\n#+begin_src emacs-lisp\n2\n#+end_src\n\n#+RESULTS:\n: 2\n\nafter\n\ntext src_emacs-lisp{3} {{{results(=3=)}}} more\n\n#+begin_src emacs-lisp\n4\n#+end_src\n\n"
},
{
"op": "where",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp\n1\n#+end_src\n\n#+RESULTS: f\n: 1\n\n#+begin_src emacs-lisp\n‸2\n#+end_src\n\n#+RESULTS:\n: 2\n\nafter\n\ntext src_emacs-lisp{3} {{{results(=3=)}}} more\n\n#+begin_src emacs-lisp\n4\n#+end_src\n\n"
},
{
"op": "where",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp\n1\n#+end_src\n\n#+RESULTS: f\n: 1\n\n#+begin_src emacs-lisp\n2\n#+end_src\n\n#+RESULTS:\n: 2\n\nafter\n\n‸text src_emacs-lisp{3} {{{results(=3=)}}} more\n\n#+begin_src emacs-lisp\n4\n#+end_src\n\n"
},
{
"op": "where",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp\n1\n#+end_src\n\n#+RESULTS: f\n: 1\n\n#+begin_src emacs-lisp\n2\n#+end_src\n\n#+RESULTS:\n: 2\n\nafter\n\ntext src_emacs-lisp{3} {{{results(=3=)}}} more\n\n#+begin_src emacs-lisp\n‸4\n#+end_src\n\n"
},
{
"op": "where",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp\n1\n#+end_src\n\n#+RESULTS: f\n: 1\n\n‸#+begin_src emacs-lisp\n2\n#+end_src\n\n#+RESULTS:\n: 2\n\nafter\n\ntext src_emacs-lisp{3} {{{results(=3=)}}} more\n\n#+begin_src emacs-lisp\n4\n#+end_src\n\n"
},
{
"op": "remove",
"text": "* H\n‸#+NAME: f\n#+begin_src emacs-lisp\n1\n#+end_src\n\n#+RESULTS: f\n: 1\n\n#+begin_src emacs-lisp\n2\n#+end_src\n\n#+RESULTS:\n: 2\n\nafter\n\ntext src_emacs-lisp{3} {{{results(=3=)}}} more\n\n#+begin_src emacs-lisp\n4\n#+end_src\n\n"
},
{
"op": "remove",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp\n1\n#+end_src\n\n#+RESULTS: f\n: 1\n\n#+begin_src emacs-lisp\n‸2\n#+end_src\n\n#+RESULTS:\n: 2\n\nafter\n\ntext src_emacs-lisp{3} {{{results(=3=)}}} more\n\n#+begin_src emacs-lisp\n4\n#+end_src\n\n"
},
{
"op": "remove",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp\n1\n#+end_src\n\n#+RESULTS: f\n: 1\n\n#+begin_src emacs-lisp\n2\n#+end_src\n\n#+RESULTS:\n: 2\n\nafter\n\n‸text src_emacs-lisp{3} {{{results(=3=)}}} more\n\n#+begin_src emacs-lisp\n4\n#+end_src\n\n"
},
{
"op": "remove",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp\n1\n#+end_src\n\n#+RESULTS: f\n: 1\n\n#+begin_src emacs-lisp\n2\n#+end_src\n\n#+RESULTS:\n: 2\n\nafter\n\ntext src_emacs-lisp{3} {{{results(=3=)}}} more\n\n#+begin_src emacs-lisp\n‸4\n#+end_src\n\n"
},
{
"op": "remove",
"text": "* H\n#+NAME: f\n#+begin_src emacs-lisp\n1\n#+end_src\n\n#+RESULTS: f\n: 1\n\n‸#+begin_src emacs-lisp\n2\n#+end_src\n\n#+RESULTS:\n: 2\n\nafter\n\ntext src_emacs-lisp{3} {{{results(=3=)}}} more\n\n#+begin_src emacs-lisp\n4\n#+end_src\n\n"
},
{
"op": "remove",
"text": "* H\ntext src_emacs-lisp{3‸} {{{results(=3=)}}} more\n"
},
{
"op": "remove",
"text": "* H\ntext src_emacs-lisp{3‸}{{{results(=3=)}}} more\n"
},
{
"op": "remove",
"text": "* H\ntext call_f(3)‸   {{{results(=3=)}}}   more\n"
},
{
"op": "remove",
"text": "* H\n#+begin_src emacs-lisp\n2‸\n#+end_src\n#+RESULTS:\n| a | b |\n| c | d |\nnext\n"
},
{
"op": "remove",
"text": "* H\n#+begin_src emacs-lisp\n2‸\n#+end_src\n\n#+RESULTS:\n#+begin_example\nx\n#+end_example\n\nnext\n"
},
{
"op": "remove",
"text": "* H\n#+begin_src emacs-lisp\n2‸\n#+end_src\n\n\n#+RESULTS:\n: 1\n: 2\nnext\n"
},
{
"op": "remove",
"text": "* H\n#+CALL: f(1)‸\n\n#+RESULTS:\n: 1\n\nnext\n"
},
{
"op": "sbe",
"text": "* H\n#+NAME: fibbd\n#+begin_src emacs-lisp :var n=2 :results silent\n(if (< n 2) 1 (+ n 100))\n#+end_src\n\n| 0 | |\n| 1 | |\n| 5 | |\n#+TBLFM: $2='(org-sbe \"fibbd\" (n $1))\n"
},
{
"op": "sbe",
"text": "* H\n#+NAME: fibbd\n#+begin_src emacs-lisp :var n=2 :results silent\n(if (< n 2) 1 (+ n 100))\n#+end_src\n\n| 0 | |\n| 7 | |\n#+TBLFM: $2='(org-sbe fibbd (n $1))\n"
},
{
"op": "sbe",
"text": "* H\n#+NAME: fibbd\n#+begin_src emacs-lisp :var n=2 :results silent\n(if (< n 2) 1 (+ n 100))\n#+end_src\n\n| 3 | |\n#+TBLFM: $2='(org-sbe fibbd (n $$1))\n"
},
{
"op": "sbe",
"text": "* H\n#+NAME: fibbd\n#+begin_src emacs-lisp :var n=2 :results silent\n(if (< n 2) 1 (+ n 100))\n#+end_src\n\n| 3 | |\n#+TBLFM: $2='(org-sbe fibbd (n 4))\n"
},
{
"op": "sbe",
"text": "* H\n#+NAME: fibbd\n#+begin_src emacs-lisp :var n=2 :results silent\n(if (< n 2) 1 (+ n 100))\n#+end_src\n\n| 3 | |\n#+TBLFM: $2='(org-sbe \"fibbd\" (n $1));N\n"
},
{
"op": "sbe",
"text": "* H\n#+NAME: fibbd\n#+begin_src emacs-lisp :var n=2 :results silent\n(if (< n 2) 1 (+ n 100))\n#+end_src\n\n| 3 | |\n#+TBLFM: $2='(org-sbe \"nosuch\" (n $1))\n"
},
{
"op": "sbe",
"text": "* H\n#+NAME: fibbd\n#+begin_src emacs-lisp :var n=2 :results silent\n(if (< n 2) 1 (+ n 100))\n#+end_src\n\n| 3 | |\n#+TBLFM: $2='(org-sbe \"fibbd\" (n $1) (m 5))\n"
},
{
"op": "sbe",
"text": "* H\n#+NAME: tb\n#+begin_src emacs-lisp :var x=1 :var y=2\n(list x y)\n#+end_src\n\n| 3 | |\n#+TBLFM: $2='(org-sbe \"tb\" (x $1))\n"
},
{
"op": "sbe",
"text": "* H\n#+NAME: tb\n#+begin_src emacs-lisp :var x=1 :var y=2\n(format \"%s-%s\" x y)\n#+end_src\n\n| 3 | |\n#+TBLFM: $2='(org-sbe \"tb\" (x $1) (y \"a\"))\n"
},
{
"op": "sbe",
"text": "* H\n#+NAME: tb\n#+begin_src emacs-lisp :var x=1 :results raw\n(format \"<%s>\" x)\n#+end_src\n\n| 3 | |\n#+TBLFM: $2='(org-sbe \"tb\" \":results output\" (x $1))\n"
},
{
"op": "sbe",
"text": "* H\n| 3 | |\n#+TBLFM: $2='(identity \"\")\n"
},
{
"op": "sbe",
"text": "* H\n| 3 | |\n#+TBLFM: $2='(identity \"a\")\n"
},
{
"op": "buffer",
"text": "* A\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(x=3)\n\ninline src_emacs-lisp{(+ 1 1)} and call_g(x=4) here\n** B\n#+begin_src emacs-lisp\n(+ 5 5)\n#+end_src\n* C\n#+begin_src emacs-lisp :results silent\n9\n#+end_src\ntext src_emacs-lisp{7}\n"
},
{
"op": "subtree",
"text": "* A\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(x=3)\n\ninline src_emacs-lisp{(+ 1 1)} and call_g(x=4) here\n** B\n‸#+begin_src emacs-lisp\n(+ 5 5)\n#+end_src\n* C\n#+begin_src emacs-lisp :results silent\n9\n#+end_src\ntext src_emacs-lisp{7}\n"
},
{
"op": "subtree",
"text": "* A\n‸#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(x=3)\n\ninline src_emacs-lisp{(+ 1 1)} and call_g(x=4) here\n** B\n#+begin_src emacs-lisp\n(+ 5 5)\n#+end_src\n* C\n#+begin_src emacs-lisp :results silent\n9\n#+end_src\ntext src_emacs-lisp{7}\n"
},
{
"op": "buffer",
"text": "* A\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g(x=3)\n\ninline src_emacs-lisp{(+ 1 1)} and call_g(x=4) here\n** B\n#+begin_src emacs-lisp\n(+ 5 5)\n#+end_src\n* C\n#+begin_src emacs-lisp :results silent\n9\n#+end_src\ntext src_emacs-lisp{7}\n#+begin_src emacs-lisp\n(error \"boom\")\n#+end_src\n#+begin_src emacs-lisp\n1\n#+end_src\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: lg\n#+begin_src emacs-lisp :var x=1\n(+ x 1000)\n#+end_src\n\n#+CALL: lg(x=1)‸\n",
"lob": []
},
{
"op": "maybe",
"text": "* H\n#+CALL: lib(x=1)‸\n",
"lob": [
"* L\n#+NAME: lib\n#+begin_src emacs-lisp :var x=0 :results raw\n(format \"L%s\" x)\n#+end_src\n"
]
},
{
"op": "maybe",
"text": "* H\n#+CALL: lib(5)‸\n",
"lob": [
"* L\n#+NAME: lib\n#+begin_src emacs-lisp :var x=0\n(format \"L%s\" x)\n#+end_src\n",
"* M\n#+NAME: lib\n#+begin_src emacs-lisp :var x=0\n(format \"M%s\" x)\n#+end_src\n"
]
},
{
"op": "maybe",
"text": "* H\ntext call_lib(x=2)‸ z\n",
"lob": [
"#+NAME: lib\n#+begin_src emacs-lisp :var x=0 :noweb yes\n(format \"L%s<<k>>\" x)\n#+end_src\n\n#+NAME: k\n#+begin_src emacs-lisp\nK\n#+end_src\n"
]
},
{
"op": "maybe",
"text": "* H\n#+CALL: lib(x=2)‸\n",
"lob": [
"* L\n#+PROPERTY: header-args :var x=7\n#+NAME: lib\n#+begin_src emacs-lisp :var x=0\n(format \"L%s\" x)\n#+end_src\n"
]
},
{
"op": "maybe",
"text": "* H\n#+CALL: lib()‸\n",
"lob": [
"* L :hh:\n:PROPERTIES:\n:header-args: :var x=7\n:END:\n#+NAME: lib\n#+begin_src emacs-lisp\n(format \"L%s\" x)\n#+end_src\n"
]
},
{
"op": "maybe",
"text": "* H\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* x 2)\n#+end_src\n\n#+CALL: g[:results raw :wrap quote](x=4)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: g\n#+begin_src emacs-lisp :var x=1 :results raw\n(* x 2)\n#+end_src\n\n#+CALL: g[:results replace](x=4)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: g\n#+begin_src emacs-lisp :var x=1 :results silent\n(* x 2)\n#+end_src\n\n#+CALL: g(x=4)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: g\n#+begin_src emacs-lisp :var x=1 :results silent\n(* x 2)\n#+end_src\n\n#+CALL: g[:results value](x=4)‸\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(list x x)\n#+end_src\n\n#+CALL: g[:results vector](x=4)‸\n\ntext\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(list x x)\n#+end_src\n\n  #+CALL: g(x=4)‸\n\ntext\n"
},
{
"op": "maybe",
"text": "* H\n#+NAME: g\n#+begin_src emacs-lisp :var x=1\n(* 2 x)\n#+end_src\n\n#+NAME: g[:results raw](x=4)\n#+begin_src emacs-lisp :var x='(1 2)\n(length x)\n#+end_src\n\n  #+CALL: g(x=4)‸\n\ntext\n"
}
];
