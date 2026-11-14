// Cases of test/oracle-export-fixes.test.js where an exporter differs from Emacs 29.3, each with the reason.
/** @type {{ id: string, reason: string, matches: (c: { backend: string, name: string }) => boolean }[]} */
export const FIXES_KNOWN = [
  {
    id: 'include-regexp-location',
    reason: 'Emacs 29.3 includes only the last line of the file for a ::/regexp/ location (org-link-search leaves point at the end after org-occur); the app includes the matching line, which is what the location says',
    matches: ({ name }) => name === 'include-regexp-search',
  },
  {
    id: 'empty-inlinetask-body',
    reason: 'Emacs 29.3 writes a stray "nil" after an inline task that has no text in HTML and drops its END line in Org (defects); the app writes neither',
    matches: ({ backend, name }) => (backend === 'html' || backend === 'orgx') && name === 'inlinetask-select-tag',
  },
  {
    id: 'html-planning-trailing-blank',
    reason: 'Emacs 29.3 HTML writes a blank inside the last timestamp span of a planning line when the line holds two entries',
    matches: ({ backend, name }) => backend === 'html' && name === 'timestamp-planning',
  },
];
