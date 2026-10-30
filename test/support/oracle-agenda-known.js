// Scenarios where the app still differs from Emacs 29.3 (see test/oracle-agenda.test.js). Each rule names what Emacs does and what the app does.
/** @type {{ id: string, reason: string, match: (s: any, want: string[], got: string[]) => boolean }[]} */
export const AGENDA_RULES = [
  {
    id: 'skip-todo-next-deadlines',
    reason:
      'org-agenda-skip-function (org-agenda-skip-entry-if \'todo \'("NEXT")): Emacs 29.3 lists no deadline at all on the day (its element-cache scan loses them once the function has skipped the NEXT entry); the app lists the deadlines of the entries the function does not skip',
    match: (/** @type {any} */ s, /** @type {string[]} */ want, /** @type {string[]} */ got) => /^skip entry todo NEXT( scheduled)? /.test(s.id) && want.every((r) => got.includes(r)) && got.filter((r) => !want.includes(r)).every((r) => r.split('|')[2] === 'deadline'),
  },
];

/** The rule that explains a scenario's difference, if any. @param {any} s @param {string[]} want @param {string[]} got */
export function agendaKnown(s, want, got) {
  if (JSON.stringify(want) === JSON.stringify(got)) return null;
  return AGENDA_RULES.find((r) => r.match(s, want, got)) ?? null;
}

/**
 * Habits whose graph the app does not draw as Emacs does. Emacs stops the agenda with an error for a habit it cannot read (no
 * repeater, a repeat of 0, a last-chance period no longer than the repeat, hours); the app lists such a task as an ordinary one.
 * @param {string} id @param {string} want the graph of Emacs, or its error @param {string | null} got the graph of the app, null: not a habit
 */
export function habitKnown(id, want, got) {
  return String(want).startsWith('ERROR') && got === null;
}
