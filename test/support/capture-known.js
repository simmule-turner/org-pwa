// Where capture differs from Emacs 29.3 by rule, one line of reason each (tests: test/capture-expand-oracle.test.js, test/capture-columns.test.js).
export const CAPTURE_KNOWN = {
  /** Templates whose expansion the app does not reproduce. */
  expand: [
    { template: '%[/nonexistent/capture-file.txt]', reason: '%[file] inserts a file read synchronously from the disk; the app has no synchronous file system (files are GitHub, WebDAV or local buffers read asynchronously), so the text stays as written' },
  ],
  /** Column view over inline tasks (test/inlinetask-oracle.test.js). */
  inlineColumns: [
    { reason: 'with org-inlinetask loaded, Emacs reads a property of a task through org-entry-get such that the task\'s END line counts as an entry with the task\'s own value (a parent sums it twice), and a task with no END shows an empty value; the app counts the task once, from its own drawer' },
  ],
  /** Settings values that capture treats differently from Emacs. */
  settings: [
    { key: 'org-table-formula-create-columns', value: 'prompt', reason: 'a capture runs with no one to ask at that moment, so `prompt` is treated as nil: a formula for a missing column is refused (Emacs asks with yes-or-no-p)' },
  ],
};
