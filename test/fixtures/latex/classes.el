(add-to-list 'org-latex-classes
  '("memo" "\\documentclass[12pt]{article}
[NO-DEFAULT-PACKAGES]
\\usepackage{memoir-like}
[EXTRA]
[PACKAGES]"
    ("\\section{%s}" . "\\section*{%s}")
    ("\\subsection{%s}" . "\\subsection*{%s}")))
(add-to-list 'org-latex-classes
  '("koma" "\\documentclass{scrartcl}"
    ("\\section{%s}" "\\section*{%s}" "\\subsection{%s}" "\\subsection*{%s}")
    ("\\subsection{%s}" . "\\subsection*{%s}")
    ("\\subsubsection{%s}" . "\\subsubsection*{%s}")))
(add-to-list 'org-latex-packages-alist '("a4paper,margin=2cm" "geometry"))
(add-to-list 'org-latex-packages-alist '("" "microtype" ("pdflatex")))
