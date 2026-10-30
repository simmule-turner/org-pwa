/**
 * Where the app and Emacs 29.3 still differ on tools/oracle-org-settings-cases.mjs, each with its reason.
 * `chosen` is true where the app deliberately keeps its own behavior.
 * @type {{ kind: string, chosen: boolean, reason: string, match: RegExp }[]}
 */
export const KNOWN = [
  { kind: 'locals', chosen: true, reason: 'A value whose line ends in a backslash continues on the next line and the two are joined with a blank: the app\'s way to write the multi-entry values of its own variables (org-xx-extra-menu); Emacs reads the backslash as part of a symbol.', match: /foo: a\\\n/ },
];
