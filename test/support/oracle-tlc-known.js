// Cases of test/oracle-todo-log-clock.test.js where the app differs from Emacs 29.3, each with the reason. The test fails when a
// listed case starts to match, so the list only shrinks.
/** @type {{ id: string, reason: string, matches: (c: { kind: string, name: string, [k: string]: any }) => boolean }[]} */
export const KNOWN_DEVIATIONS = [
  {
    id: 'clocktable-agenda-without-files',
    reason: 'the agenda of the Clock report is the open documents; Emacs reports an error when org-agenda-files is empty',
    matches: (c) => c.kind === 'clocktable' && /:scope agenda/.test(c.params) && c.ctOrg2 === undefined,
  },
];
