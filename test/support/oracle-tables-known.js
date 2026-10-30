// Rule-based list of table cases where the app still differs from Emacs 29.3 (see test/oracle-tables.test.js).
// A rule is a limit chosen for the app (a Calc form the engine does not carry); it names what Emacs does and what the app does instead.
const tblfm = (org) => (org.split('\n').filter((l) => /^\s*#\+TBLFM:/i.test(l)).pop() || '').replace(/^\s*#\+TBLFM:\s*/i, '');

/** @type {{id:string, reason:string, match:(c:{org:string})=>boolean}[]} */
export const TABLE_RULES = [
  {
    id: 'symbolic vector stats',
    reason: 'chosen: app behavior -- variance, deviation and error of a vector holding a name (x) are Calc algebra with its own simplifier; the app leaves the call as written (nan and empty fields, vlen, vflat, vmax and vmin are done)',
    match: (c) => /\b(vsdev|vvar|vpvar|vpsdev|vmeane)\(/.test(tblfm(c.org)),
  },
];

/** The rule that covers this case, or undefined. */
export const ruleFor = (c) => TABLE_RULES.find((r) => r.match(c));
