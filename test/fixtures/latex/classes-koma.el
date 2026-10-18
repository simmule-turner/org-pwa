(with-eval-after-load 'ox-latex
  (add-to-list 'org-latex-classes
    '("koma" "\\documentclass{scrartcl}"
      ("\\section{%s}" . "\\section*{%s}")
      ("\\begin{block}{%s}" "\\end{block}" "\\begin{plain}{%s}" "\\end{plain}")
      ("\\subsubsection{%s}" . "\\subsubsection*{%s}"))))
