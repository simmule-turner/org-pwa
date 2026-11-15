/** The cases of test/list-commands-oracle.test.js where the app still differs from Emacs, with the reason. */
export const KNOWN_LIST_COMMANDS = /** @type {{ reason: string, match: (c: any) => boolean }[]} */ ([
  {
    reason: 'org-sort-list on a list line inside a drawer or an example block: Emacs sorts the text as a list (a drawer gains a blank line), the app does not take it for an item',
    match: (c) => (c.op === 'sort' || c.op === 'sort-case') && /:LOGBOOK:|#\+begin_example/.test(c.org),
  },
  {
    reason: 'C-u C-c C-c over a whole subtree with two blank lines inside the list: Emacs boxes the items after the gap too',
    match: (c) => c.op === 'toggle-cb' && !!c.heading && /\n\n\n/.test(c.org),
  },
  {
    reason: 'M-S-right on the first item of a list whose sub-items carry a cookie: Emacs leaves the cookie as it was',
    match: (c) => c.op === 'indent-item-tree' && c.line === 0 && /\[\d+\/\d+\]/.test(c.org),
  },
]);
