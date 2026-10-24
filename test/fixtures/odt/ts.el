(add-to-list 'org-odt-table-styles '("Banded" "Custom" ((use-banding-rows-styles . t))))
(add-to-list 'org-odt-table-styles '("BandedCols" "Custom" ((use-banding-columns-styles . t) (use-last-row-styles . t))))
(setq org-odt-table-styles (append org-odt-table-styles '(("Mine" "MyTemplate" ((use-first-row-styles . t) (use-last-column-styles . t))))))
(add-to-list 'org-odt-table-styles '("TableWithHeaderRowAndColumn" "Other" ((use-last-row-styles . t))))
