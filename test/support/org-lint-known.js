// Cases where the app's org-lint differs from Emacs 29.3 (see test/org-lint-oracle.test.js). A rule names what Emacs does that
// the app's model cannot.
/** @type {{id: string, reason: string, match: (c: {text: string, got: any, want: any}) => boolean}[]} */
export const LINT_RULES = [];
/** @param {{text: string, got: any, want: any}} c */
export const lintRuleFor = (c) => LINT_RULES.find((r) => r.match(c)) || null;

// Cases where org-lint in the app's file model (src/org-lint-files.js; test/org-lint-files.test.js) differs from Emacs, which asks
// the file system: the app lists the folders of the document's storage and treats a file whose place it cannot tell as existing.
/** @type {{id: string, reason: string, match: (c: {text: string, got: any, want: any}) => boolean}[]} */
export const FILE_RULES = [
  {
    id: 'absolute-path',
    reason: 'A file named by an absolute or ~ path is on the file system of a device the app cannot look at (the document is in a GitHub, WebDAV or device folder), so it counts as existing.',
    match: (c) => differsOnlyBy(c, /"(?:\/|~)/),
  },
  {
    id: 'attachment',
    reason: 'The directory of an attachment depends on the heading (ID or DIR property, org-attach-id-dir) and on what the storage lists there; the app does not look, so an attachment link counts as existing.',
    match: (c) => differsOnlyBy(c, /"CWD\//),
  },
];
/** Whether every report Emacs gives and the app does not has a message matching `pattern`, and the app gives none Emacs does not. @param {{got: any, want: any}} c @param {RegExp} pattern */
function differsOnlyBy(c, pattern) {
  const got = new Set(c.got.map((/** @type {any} */ r) => JSON.stringify(r)));
  const want = new Set(c.want.map((/** @type {any} */ r) => JSON.stringify(r)));
  const missing = [...want].filter((r) => !got.has(r));
  return [...got].every((r) => want.has(r)) && missing.length > 0 && missing.every((r) => pattern.test(JSON.parse(r)[2]));
}
/** @param {{text: string, got: any, want: any}} c */
export const fileRuleFor = (c) => FILE_RULES.find((r) => r.match(c)) || null;
