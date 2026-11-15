// Cases of test/oracle-capture-refile.test.js where the app still differs from Emacs 29.3, by rule (each says what Emacs does and what the app does).
// Chosen: app behavior, outside the oracle (it runs with creation off): a capture to a file+olp path whose heading is missing creates the heading; Emacs signals "Heading not found on level N".
/** @type {{ id: string, reason: string, match: (c: any) => boolean }[]} */
export const KNOWN = [
  { id: 'archive heading inside the subtree', reason: 'chosen: app behavior (Emacs loses the entry) -- archiving a top-level subtree to "::** Heading" that is not in the file yet: Emacs puts the new level-2 heading at the end of the file, inside the last top-level subtree, then cuts that subtree: the entry is lost; the app keeps it', match: (c) => c.kind === 'archive' && /^#\+ARCHIVE: ::\*\* /m.test(c.files['notes.org'] || '') && !/^\*\* Archive two/m.test(c.files['notes.org'] || '') },
  { id: 'archive sibling named like a keyword', reason: 'Emacs oddity: the statistics cookie above counts an archive sibling named "Done" as an open task (org-update-parent-todo-statistics matches keywords without regard to case)', match: (c) => c.kind === 'archive-sibling' && c.vars?.['org-archive-sibling-heading'] === '"Done"' && /\[%\]/.test(c.files['notes.org']) },
];
/** @param {any} c */
export const knownFor = (c) => KNOWN.find((r) => r.match(c));
