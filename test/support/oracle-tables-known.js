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
  {
    id: 'calc algebra of text',
    reason: 'chosen: product owner decision -- Calc simplifies algebra over text (z+1 shows z + 1, a b is a product, x 42 doubled is 84 x, 1.5 A/B * 2.0 B reduces its units); the app does not evaluate text as algebra, so a field that is not a number reads as nan there',
    match: (c) => /string\(""\), \$1( \+ 1)?\); E$/.test(tblfm(c.org)) || /;u$/.test(tblfm(c.org)) || /2 \* remote\(table, @1\$2\)/.test(tblfm(c.org)),
  },
  {
    id: 'typeof of an unevaluated call',
    reason: 'chosen: app behavior -- Calc gives typeof of a call it could not evaluate (vmean of nothing) the name of the function, so the whole if() stays as written with that name; the app shows the call itself',
    match: (c) => /typeof\(vmean\(\$1\.\.\$2\)\) == 12, string\(""\), vmean\(\$1\.\.\$2\)\)$/.test(tblfm(c.org)),
  },
];

/** The rule that covers this case, or undefined. */
export const ruleFor = (c) => TABLE_RULES.find((r) => r.match(c));
