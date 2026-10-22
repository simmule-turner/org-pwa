(setq org-beamer-frame-level 2
      org-beamer-theme "metropolis"
      org-beamer-frame-default-options "t"
      org-beamer-outline-frame-title "TOC"
      org-beamer-outline-frame-options "plain"
      org-beamer-subtitle-format "\\subtitle{%s}"
      org-beamer-environments-extra
      '(("myenv" "m" "\\begin{myenv}%a{%h}" "\\end{myenv}")
        ("fancy" "f" "\\begin{fancy}%o %A[%r|%R]{%h}" "\\end{fancy}")
        ("e1" "e" "<%a|%A|%o|%O|%R|%h|%r|%H|%%|%c|%Z>" "\\end{e1}")
        ("block" "b" "\\begin{MYBLOCK}%a{%h}" "\\end{MYBLOCK}")))
