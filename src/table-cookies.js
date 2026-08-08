/**
 * Real org-mode's own explicit column-width cookie row: a table row
 * where EVERY cell is exactly "<N>" (e.g. "| <30> | <10> | <24> |"),
 * typically placed just above the header row. It's a directive, not
 * table data -- every export backend in this app needs to recognize
 * and exclude it from its own output, or it gets treated as an
 * ordinary data row. For HTML and Markdown specifically, that's worse
 * than it sounds: both backends treat the FIRST data row as the table
 * header, so an unrecognized cookie row doesn't just show up as
 * literal "<10>" text -- it actively hijacks the header position,
 * demoting the table's real header row into the body underneath it.
 *
 * Only the ASCII exporter actually uses the widths themselves (to
 * force each column to a fixed size and word-wrap overflowing
 * content -- see export-ascii.js's own use of parseWidthCookieRow).
 * HTML, Markdown, and ODT export don't currently honor an explicit
 * width at all -- they use isWidthCookieRow just to recognize and
 * skip the row, leaving their own already-existing column-sizing
 * behavior (browser/renderer auto-sizing for HTML, GFM's own table
 * rendering for Markdown, ODF's own table-column defaults for ODT)
 * completely untouched otherwise.
 */

/** Whether `row` is a width-cookie row at all -- every cell matches
 *  "<N>" exactly, nothing else. A row with even one non-matching
 *  cell (blank, alignment-only like "<c>", or ordinary data) is NOT
 *  a cookie row -- there's no partial recognition, matching how real
 *  org itself treats this as an all-or-nothing directive line. */
function isWidthCookieRow(row) {
  if (row.type !== 'row' || row.cells.length === 0) return false;
  return row.cells.every((c) => /^<\d+>$/.test(c.trim()));
}

/** The per-column widths a cookie row specifies, in order, or null if
 *  `row` isn't actually a cookie row (see isWidthCookieRow). Only the
 *  ASCII exporter currently calls this -- the others only need
 *  isWidthCookieRow itself, to know which row to skip. */
function parseWidthCookieRow(row) {
  if (!isWidthCookieRow(row)) return null;
  return row.cells.map((c) => Number(/^<(\d+)>$/.exec(c.trim())[1]));
}

export { isWidthCookieRow, parseWidthCookieRow };
