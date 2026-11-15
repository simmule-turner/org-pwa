// Cases of test/fixtures/oracle-babel-ops.json the app may differ on, each with the reason.
/** @type {{ why: string, match: (c: any) => boolean }[]} */
export const BABEL_OPS_RULES = [
  { why: 'new results directly above a following heading: Emacs adds a blank line, a section here ends at its last line', match: (c) => /^(maybe|buffer|subtree)$/.test(c.op) && /[^\n]\n\*+ /.test(c.text) },
  { why: 'point on the empty last line of the buffer just after a #+CALL: line: Emacs still takes it as the call', match: (c) => c.op === 'maybe' && /#\+CALL:[^\n]*\n‸$/.test(c.text) },
];
/** @param {any} c */
export const opsRuleFor = (c) => BABEL_OPS_RULES.find((r) => r.match(c));
