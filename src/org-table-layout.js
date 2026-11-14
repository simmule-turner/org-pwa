// @ts-check
/**
 * Org's own table alignment (`org-table-align`): every column as wide as its widest cell, columns of mostly numbers
 * right-aligned, rules written as `|---+---|`. Compared with Emacs 29.3.
 */

/** Display width: East Asian wide characters and emoji take two columns. @param {string} s */
export function width(s) {
  let w = 0;
  for (const ch of s) {
    const c = /** @type {number} */ (ch.codePointAt(0));
    w += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x20000 && c <= 0x3fffd) || (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f680 && c <= 0x1f6ff) || (c >= 0x1f900 && c <= 0x1f9ff) || (c >= 0x1fa70 && c <= 0x1faff) ? 2 : c >= 0x300 && c <= 0x36f ? 0 : 1;
  }
  return w;
}

/** Width with each link counted as the text it shows, as in an Org buffer. @param {string} s */
export function widthWithLinks(s) {
  return width(s.replace(/\[\[(?:[^\][\\]|\\.)*\]\[([^\]]*)\]\]/g, '$1').replace(/\[\[((?:[^\][\\]|\\.)*)\]\]/g, '$1'));
}

// org-table-number-regexp
const NUMBER_RE = /^(?:[<>]?[-+^.0-9]*[0-9][-+^.0-9eEdDx()%:]*|[<>]?[-+]?0[xX][0-9a-fA-F.]+|[<>]?[-+]?[0-9]+#[0-9a-zA-Z.]+|nan|[-+u]?inf)$/;
const ALIGN_COOKIE_RE = /^<([lrc])[0-9]*>$/;
const NUMBER_FRACTION = 0.5;

/**
 * The lines of a table. A row is its cells, or null for a rule.
 * @param {(string[] | null)[]} rows
 * @param {(cell: string) => number} [widthOf]
 * @param {number} [ruleColumns] the columns of a table made only of rules (Org counts the "+" of its first line)
 * @returns {string[]}
 */
export function layoutTable(rows, widthOf = width, ruleColumns = 1) {
  const columns = Math.max(0, ...rows.map((r) => (r ? r.length : 0)));
  if (!columns) return rows.length && rows.every((r) => !r) ? rows.map(() => '|' + Array(ruleColumns).fill('---').join('+') + '|') : [];
  const cells = rows.map((r) => (r ? Array.from({ length: columns }, (_, i) => r[i] ?? '') : null));
  const widths = Array.from({ length: columns }, (_, i) => Math.max(1, ...cells.map((r) => (r ? widthOf(r[i]) : 0))));
  const align = Array.from({ length: columns }, (_, i) => {
    let fixed = '';
    let numbers = 0;
    let nonEmpty = 0;
    for (const r of cells) {
      const c = r ? r[i] : '';
      if (fixed || c === '') continue;
      const cookie = ALIGN_COOKIE_RE.exec(c);
      if (cookie) fixed = cookie[1];
      else {
        nonEmpty++;
        if (NUMBER_RE.test(c)) numbers++;
      }
    }
    return fixed || (numbers >= NUMBER_FRACTION * nonEmpty ? 'r' : 'l');
  });
  const field = (/** @type {string} */ c, /** @type {number} */ i) => {
    const spaces = widths[i] - widthOf(c);
    const before = align[i] === 'r' ? spaces : align[i] === 'c' ? Math.floor(spaces / 2) : 0;
    return ' '.repeat(before) + c + ' '.repeat(spaces - before);
  };
  return cells.map((r) => {
    if (!r) return '|' + widths.map((w) => '-'.repeat(w + 2)).join('+') + '|';
    return '| ' + r.map(field).join(' | ') + ' |';
  });
}
