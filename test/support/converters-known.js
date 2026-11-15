// Converter cases (Lisp source) where the app differs from Emacs, with the reason.
export const KNOWN = new Set([
  // a cell that is only dashes: Org leaves a -- or --- with nothing after it in the text as it is; the HTML exporter of the app turns it into a dash entity
  "(orgtbl-to-html (org-table-to-lisp \"| -- | --- | ... | a--b |\") nil)",
  // a cell that is only dashes: Org leaves a -- or --- with nothing after it in the text as it is; the HTML exporter of the app turns it into a dash entity
  "(orgtbl-to-html (org-table-to-lisp \"| -- | --- | ... | a--b |\") '(:skipcols (1)))",
  // a cell that is only dashes: Org leaves a -- or --- with nothing after it in the text as it is; the HTML exporter of the app turns it into a dash entity
  "(orgtbl-to-html (org-table-to-lisp \"| -- | --- | ... | a--b |\") '(:hline nil))",
  // a cell that is only dashes: Org leaves a -- or --- with nothing after it in the text as it is; the HTML exporter of the app turns it into a dash entity
  "(orgtbl-to-generic (org-table-to-lisp \"| -- | --- | ... | a--b |\") '(:backend html))",
  // a cell that is only dashes: Org leaves a -- or --- with nothing after it in the text as it is; the HTML exporter of the app turns it into a dash entity
  "(orgtbl-to-generic (org-table-to-lisp \"| -- | --- | ... | a--b |\") '(:backend html :lstart \"<R>\" :lend \"</R>\"))",
  // a cell that is only dashes: Org leaves a -- or --- with nothing after it in the text as it is; the HTML exporter of the app turns it into a dash entity
  "(orgtbl-to-generic (org-table-to-lisp \"| -- | --- | ... | a--b |\") '(:backend html :hlfmt \"H:%s\"))",
  // an example block inside an item: HTML and LaTeX write it as pre or verbatim (the HTML one with a hash id); the converters keep the lines as they are
  "(org-test-with-temp-text \"- a\\n  #+begin_example\\n  code\\n  #+end_example\\n- b\" (org-list-to-generic (org-list-to-lisp) '(:backend html)))",
  // an example block inside an item: HTML and LaTeX write it as pre or verbatim (the HTML one with a hash id); the converters keep the lines as they are
  "(org-test-with-temp-text \"- a\\n  #+begin_example\\n  code\\n  #+end_example\\n- b\" (org-list-to-generic (org-list-to-lisp) '(:backend latex)))",
  // an example block inside an item: HTML and LaTeX write it as pre or verbatim (the HTML one with a hash id); the converters keep the lines as they are
  "(org-test-with-temp-text \"- a\\n  #+begin_example\\n  code\\n  #+end_example\\n- b\" (org-list-to-generic (org-list-to-lisp) '(:backend html :raw t)))",
  // an example block inside an item: HTML and LaTeX write it as pre or verbatim (the HTML one with a hash id); the converters keep the lines as they are
  "(org-test-with-temp-text \"- a\\n  #+begin_example\\n  code\\n  #+end_example\\n- b\" (org-list-to-generic (org-list-to-lisp) '(:backend latex :raw t)))",
  // an empty item through the ascii back end: the app writes a blank line after the bullet
  "(org-test-with-temp-text \"-\\n- x\" (org-list-to-generic (org-list-to-lisp) '(:backend ascii)))",
]);
