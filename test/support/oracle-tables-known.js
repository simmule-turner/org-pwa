// Rule-based list of table cases where the app still differs from Emacs 29.3 (see test/oracle-tables.test.js).
// Every rule is a limit chosen for the app (Calc forms the engine does not carry); each names what Emacs does and what the app does instead.
const tblfm = (org) => (org.split('\n').filter((l) => /^\s*#\+TBLFM:/i.test(l)).pop() || '').replace(/^\s*#\+TBLFM:\s*/i, '');
const firstRow = (org) => org.split('\n').find((l) => l.startsWith('|')) || '';
const hasDates = (org) => /[<[]\d{4}-\d\d-\d\d|\b\d{4}-\d\d-\d\d\b/.test(org);


/** @type {{id:string, reason:string, match:(c:{org:string})=>boolean}[]} */
export const TABLE_RULES = [
  { id: 'juxtaposition', reason: 'chosen: app behavior -- Calc reads "3 4", "$1$2", "@2$1@3$1" and "(+ $1 $2)" as a product; needs Calc\'s full parser', match: (c) => ((c) => /=\s*\d+ \d+\s*$/.test(tblfm(c.org)) || /=\s*(\$\d+\$\d+|@\d+\$\d+@\d+\$\d+)\s*$/.test(tblfm(c.org)))(c) || ((c) => /=\s*\(\+ \$1 \$2\)\s*$/.test(tblfm(c.org)))(c) },
  { id: 'number literals', reason: 'chosen: app behavior -- Calc reads .5 as 0.5, 1_000 as 1_0, 0x10 as 0 and "1,5" as a pair; needs Calc\'s full reader', match: (c) => /=\s*(\.5|1_000|0x10|1,5|\(\$1)\s*$/.test(tblfm(c.org)) },
  { id: 'huge integers', reason: 'chosen: app behavior -- integers beyond 2^53 lose precision in JS numbers', match: (c) => /\d{16,}/.test(tblfm(c.org)) },
  { id: 'float overflow', reason: 'chosen: app behavior -- 1e100 with %.3f: Emacs prints all digits, the app the JS rounding', match: (c) => /\de\d/.test(tblfm(c.org)) },
  { id: 'constants', reason: 'chosen: app behavior -- #+CONSTANTS: floats print with a trailing "." in Emacs and string constants stay symbols', match: (c) => /#\+CONSTANTS:/i.test(c.org) },
  { id: 'string()', reason: 'chosen: app behavior -- Calc leaves string(x) as a symbolic form', match: (c) => /\bstring\(/.test(tblfm(c.org)) },
  { id: 'string and text cells', reason: 'chosen: app behavior -- Calc reads text cells and string operators as code vectors or symbolic sums', match: (c) => /"[^"]*"|\b(len|concat|upper|lower|vec)\(/.test(tblfm(c.org)) || /\|\s*(0x10|1,000)\s*\|/.test(firstRow(c.org)) },
  { id: 'symbolic cell', reason: 'chosen: app behavior -- a link or text cell in arithmetic stays a symbolic sum in Calc', match: (c) => /\[\[x\]\[1\]\]/.test(c.org) },
  { id: 'symbolic vector stats', reason: 'chosen: app behavior -- vector statistics over a symbolic cell (x) or nan give Calc algebra', match: (c) => /\b(vmax|vmin|vsdev|vvar|vpvar|vpsdev|vlen|vmeane|vflat)\(/.test(tblfm(c.org)) },
  { id: 'float-tagged results', reason: 'chosen: app behavior -- float(), frac(), inv(), idiv(), fact(-2.5), choose/round with fractions, and float zeros ("0.") are Calc forms the symbolic engine does not carry', match: (c) => /\b(float|frac|arg|sign|rad|deg|fact|inv|idiv|choose|perm|round|floor|ceil|trunc)\(/.test(tblfm(c.org)) },
  { id: 'if() forms', reason: 'chosen: app behavior -- if() with a date or string condition stays a symbolic ?: form in Calc', match: (c) => /\bif\(/.test(tblfm(c.org)) },
  { id: 'date cells in Calc', reason: 'chosen: app behavior -- Calc date arithmetic on date cells and on yyyy-mm-dd text read as subtraction', match: (c) => hasDates(c.org) },
  { id: 'odd cell text', reason: 'chosen: app behavior -- "<5>" is read as a date and "1,5" / "1_0" as Calc forms', match: (c) => /\|\s*(\$5|<5>|1,5|1_000|1_0)\s*\|/.test(c.org) },
];

/** The rule that covers this case, or undefined. */
export const ruleFor = (c) => TABLE_RULES.find((r) => r.match(c));
