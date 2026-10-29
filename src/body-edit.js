// @ts-check
/** @typedef {import('./types.js').Table} Table */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * Table and paragraph editing.
 *
 * The core problem, same shape as the earlier checkbox fix but general
 * this time: body-parser.js's `body` tree (tables, paragraphs, lists) is
 * derived from a heading's `bodyLines`, and the serializer only ever reads
 * `bodyLines`. Mutating a table cell or paragraph text on the derived tree
 * alone is invisible on save.
 *
 * The fix here generalizes past the single-line patch checkboxes used:
 * every edit function ends by regenerating the *entire* raw text for the
 * node being edited (serializeTable / the paragraph's new lines), splicing
 * that into the owning heading's `bodyLines` at the node's tracked
 * `lineIndex`/`lineCount`, and then fully re-running `parseBody` on the
 * whole `bodyLines` array to rebuild `heading.body` from scratch.
 *
 * That reparse step is why a stale `table`/`paragraph` object reference
 * must never be reused across two edits without re-reading it from a fresh
 * render: reparsing invalidates every lineIndex in the tree except the one
 * that was just patched (anything after the edited span shifts if the
 * line count changed). This mirrors how heading-edit.js's `editingHeading`
 * only makes sense within the render pass that produced it — callers
 * should always operate on the table/paragraph object handed to them by
 * the *current* render, never one captured earlier.
 *
 * Known limitation, stated rather than hidden: editing a table cell does
 * not preserve the original column-alignment whitespace — edited rows come
 * out as simple `| a | b | c |` with single-space padding, not re-aligned
 * to match column widths the way Emacs's table editor does. Data is
 * correct; visual column alignment on an edited table is not preserved.
 * "Align table" is a natural, separate follow-up feature, not something
 * silently half-done here.
 */

import { parseBody } from './body-parser.js';
import { layoutTable } from './org-table-layout.js';
import { fixBoxes, inBlockAt, isItemLine, itemEnd, listKind, renumber, separatingBlankLines } from './list-edit.js';
import { updateCheckboxCookie } from './checkbox-cookie.js';

// ---- table serialization (pure, independently testable) ------------------

/** @param {any} [cells] */
export function serializeTableRow(cells) {
  return '| ' + cells.join(' | ') + ' |';
}

/** @param {number} columnCount */
export function serializeTableRule(columnCount) {
  return '|' + Array(Math.max(1, columnCount)).fill('---').join('+') + '|';
}

/**
 * @param {Table} table
 * @param {boolean} [align] pad the columns as Emacs's org-table-align does (every table edit does); false writes each row as is
 */
export function serializeTable(table, align = true) {
  const dataRow = table.rows.find(/** @param {import('./types.js').TableRow} r @returns {r is import('./types.js').DataRow} */ (r) => r.type === 'row');
  const columnCount = dataRow ? dataRow.cells.length : 1;
  const lines = align
    ? layoutTable(table.rows.map((row) => (row.type === 'rule' ? null : row.cells)))
    : table.rows.map((row) => (row.type === 'rule' ? serializeTableRule(columnCount) : serializeTableRow(row.cells)));
  if (table.tblfm !== null) {
    for (let k = 0; k < (table.blankBeforeTblfm || 0); k++) lines.push('');
    lines.push('#+TBLFM: ' + table.tblfm);
  }
  return lines;
}

/**
 * Whether `table.rows[rowIndex]` is a HEADER row, as opposed to just
 * being positionally first. Real org has no separate header-row syntax
 * of its own -- confirmed directly against the Org Manual, a header is
 * defined entirely by position relative to the table's FIRST horizontal
 * rule line (`|---+---|`): every row before that first rule is a
 * header row, and that's the only reliable signal there is. This is
 * NOT the same question as "is rowIndex === 0": a table with no rule
 * line anywhere (a fresh, just-created table, or a plain data table
 * someone never bothered to add a header divider to) has no header at
 * all, even though it very much has a first row.
 *
 * A rule line itself is never a header (nothing to distinguish it
 * from). A table can have more than one rule (a real, if less common,
 * org convention for grouping data rows into visual sections) -- only
 * rows before the FIRST one are ever headers; a later rule is just a
 * group separator within the data, and doesn't retroactively make the
 * row before it look like a header too.
 * @param {Table} table
 * @param {number} rowIndex
 */
export function isTableHeaderRow(table, rowIndex) {
  const row = table.rows[rowIndex];
  if (!row || row.type !== 'row') return false;
  const firstRuleIndex = table.rows.findIndex((r) => r.type === 'rule');
  if (firstRuleIndex === -1) return false; // no rule anywhere in the table -- no header at all
  return rowIndex < firstRuleIndex;
}

/** The last (most recently added) table directly in `heading`'s own
 *  body, or null if it has none. "Last" matches insertTable's own
 *  append-at-the-end convention, so a heading with more than one
 *  table has an unambiguous, predictable target for anything (like
 *  the general editor's Delete table button) that needs to act on
 *  "the" table without the person first having tapped into a specific
 * @param {Heading} heading
 *  one. */
export function lastTableInBody(heading) {
  const body = heading.body || [];
  for (let i = body.length - 1; i >= 0; i--) {
    if (body[i].type === 'table') return /** @type {import('./types.js').Table} */ (body[i]);
  }
  return null;
}

/** Every table in `heading`'s own body, in reading order -- a sibling
 *  to lastTableInBody above, for callers (like org-table-recalculate
 *  in app.js) that need to walk ALL of a heading's own tables, not
 *  just the last one. Deliberately re-derived fresh from heading.body
 *  on every call rather than cached anywhere -- exactly the point:
 *  after committing one table's own changes (which re-parses
 *  heading.body entirely, see commitLines below), any table reference
 *  taken from the PREVIOUS call is stale, and a caller processing
 *  several tables in the same heading needs to call this again to get
 * @param {Heading} heading
 *  a valid one. */
export function allTablesInBody(heading) {
  return (heading.body || []).filter(/** @param {import('./types.js').BodyNode} node @returns {node is import('./types.js').Table} */ (node) => node.type === 'table');
}

// ---- commit: flush a mutated table/paragraph back to bodyLines ----------

/** Replaces `heading.bodyLines[lineIndex, lineIndex+lineCount)` with
 *  `newLines`, then fully reparses `heading.body` from the updated
 *  bodyLines. This is the one place that keeps the derived tree and the
 *  serialization source in sync — every edit function below ends by
 * @param {Heading} heading
 * @param {number} lineIndex
 * @param {number} lineCount
 * @param {string[]} newLines
 *  calling this rather than mutating heading.body directly. */
export function commitLines(heading, lineIndex, lineCount, newLines) {
  heading.bodyLines.splice(lineIndex, lineCount, ...newLines);
  heading.body = parseBody(heading.bodyLines);
}

// ---- table edits ----------------------------------------------------------

/**
 * @param {Table} table
 * @param {string | number} rowIndex
 */
function requireDataRow(table, rowIndex) {
  const row = table.rows[Number(rowIndex)];
  if (!row || row.type !== 'row') {
    throw new Error(`setTableCell: row ${rowIndex} is not a data row (rule rows have no cells)`);
  }
  return row;
}

/** Sets one cell's text and commits the whole table's new text back to
 *  bodyLines. `table` must be a fresh reference from the current render
 * @param {Heading} heading
 * @param {Table} table
 * @param {number} rowIndex
 * @param {number} colIndex
 * @param {string} value
 * @param {boolean} [align]
 *  (see module docstring). */
export function setTableCell(heading, table, rowIndex, colIndex, value, align = true) {
  const row = requireDataRow(table, rowIndex);
  row.cells[colIndex] = String(value).replace(/[\r\n|]+/g, ' ').trim();
  commitLines(heading, table.lineIndex, table.lineCount, serializeTable(table, align));
}

/**
 * `org-table-fix-formulas`: the references in a #+TBLFM: line follow a row or column that was inserted or deleted. `key` is
 * "@" (rows) or "$" (columns); numbers above `limit` move by `delta`, those in `replace` become the value given, and the
 * terms that set the `remove`d row or column go. Throws, as Emacs refuses, if a range ends on the removed one.
 * @param {string} tblfm @param {string} key @param {Record<string, string>} replace
 * @param {number | undefined} limit @param {number} delta @param {number} [remove]
 */
export function fixTableFormulas(tblfm, key, replace, limit, delta, remove) {
  const inRemote = (/** @type {string} */ line, /** @type {number} */ at) => [...line.matchAll(/remote\([^)]+?\)/g)].some((m) => /** @type {number} */ (m.index) <= at && at <= /** @type {number} */ (m.index) + m[0].length);
  let line = tblfm;
  if (remove !== undefined) {
    const re2 = key === '$' ? new RegExp(`(@[0-9]+)?\\$${remove}=.*?(::|$)`, 'g') : new RegExp(`@${remove}\\$[0-9]+=.*?(::|$)`, 'g');
    let out = '';
    let last = 0;
    for (const m of line.matchAll(re2)) {
      const at = /** @type {number} */ (m.index);
      if (inRemote(line, at + m[0].length)) continue; // Emacs asks at the end of the match
      if (line[at - 1] === '.') throw new Error(`Change makes TBLFM term ${m[0]} invalid`);
      out += line.slice(last, at);
      last = at + m[0].length;
    }
    line = out + line.slice(last);
  }
  const re = key === '$' ? /\$([0-9]+)/g : /@([0-9]+)/g;
  return line.replace(re, (whole, digits, at) => {
    if (inRemote(line, at + whole.length)) return whole;
    if (digits in replace) return key + replace[digits];
    if (limit !== undefined && Number(digits) > limit) return key + (Number(digits) + delta);
    return whole;
  });
}

/** @param {Table} table @param {number} rowIndex the 1-based number of the data line, rules not counted */
function dataLineNumber(table, rowIndex) {
  return table.rows.slice(0, rowIndex + 1).filter((r) => r.type === 'row').length;
}

/** Inserts a new blank data row after `afterRowIndex` (-1 to insert at the
 * @param {Heading} heading
 * @param {Table} table
 * @param {number} afterRowIndex
 * @param {boolean} [align]
 *  very start), with the same column count as the table's existing rows. */
export function insertTableRow(heading, table, afterRowIndex, align = true) {
  const dataRow = table.rows.find(/** @param {import('./types.js').TableRow} r @returns {r is import('./types.js').DataRow} */ (r) => r.type === 'row');
  const columnCount = dataRow ? dataRow.cells.length : 1;
  const newRow = /** @type {import('./types.js').DataRow} */ ({ type: 'row', cells: Array(columnCount).fill('') });
  table.rows.splice(afterRowIndex + 1, 0, newRow);
  if (table.tblfm !== null) table.tblfm = fixTableFormulas(table.tblfm, '@', {}, dataLineNumber(table, afterRowIndex + 1) - 1, 1);
  commitLines(heading, table.lineIndex, table.lineCount, serializeTable(table, align));
}

/**
 * @param {Heading} heading
 * @param {Table} table
 * @param {number} rowIndex
 */
export function deleteTableRow(heading, table, rowIndex) {
  if (table.rows.length <= 1) {
    throw new Error('deleteTableRow: refusing to delete the last row of a table');
  }
  // Emacs's org-table-kill-row takes the line out and leaves the others as they are
  const dline = table.rows[rowIndex].type === 'row' ? dataLineNumber(table, rowIndex) : 0;
  table.rows.splice(rowIndex, 1);
  commitLines(heading, table.lineIndex + rowIndex, 1, []);
  table.lineCount -= 1;
  if (dline && table.tblfm !== null) {
    table.tblfm = fixTableFormulas(table.tblfm, '@', { [dline]: 'INVALID' }, dline, -1, dline);
    commitLines(heading, table.lineIndex + table.lineCount - 1, 1, ['#+TBLFM: ' + table.tblfm]);
  }
}

/** Inserts a new blank column after `afterColIndex` (-1 for the start) in
 *  every data row. Rule rows need no per-row change — serializeTable
 * @param {Heading} heading
 * @param {Table} table
 * @param {number} afterColIndex
 *  derives the rule's width from the (now-updated) data row column count. */
export function insertTableColumn(heading, table, afterColIndex) {
  for (const row of table.rows) {
    if (row.type === 'row') row.cells.splice(afterColIndex + 1, 0, '');
  }
  if (table.tblfm !== null) table.tblfm = fixTableFormulas(table.tblfm, '$', {}, afterColIndex + 1, 1);
  commitLines(heading, table.lineIndex, table.lineCount, serializeTable(table));
}

/**
 * @param {Heading} heading
 * @param {Table} table
 * @param {number} colIndex
 */
export function deleteTableColumn(heading, table, colIndex) {
  const dataRow = table.rows.find(/** @param {import('./types.js').TableRow} r @returns {r is import('./types.js').DataRow} */ (r) => r.type === 'row');
  if (dataRow && dataRow.cells.length <= 1) {
    throw new Error('deleteTableColumn: refusing to delete the last column of a table');
  }
  for (const row of table.rows) {
    if (row.type === 'row') row.cells.splice(colIndex, 1);
  }
  if (table.tblfm !== null) table.tblfm = fixTableFormulas(table.tblfm, '$', { [colIndex + 1]: 'INVALID' }, colIndex + 1, -1, colIndex + 1);
  commitLines(heading, table.lineIndex, table.lineCount, serializeTable(table));
}

/**
 * @param {Heading} heading
 * @param {Table} table
 */
export function deleteTable(heading, table) {
  commitLines(heading, table.lineIndex, table.lineCount, []);
}

/** Appends a brand-new table (default 2x2, blank cells, with a header
 *  rule unless headerRule is explicitly false) to the end of
 *  `heading`'s body content. Adds a blank-line separator first if the
 *  heading already has body content, so the new table doesn't
 * @param {Heading} heading
 *  visually run into whatever precedes it. */
export function insertTable(heading, { rows = 2, cols = 2, headerRule = true } = {}) {
  const headerCells = Array(cols).fill('');
  const lines = headerRule
    ? [serializeTableRow(headerCells), serializeTableRule(cols)]
    : [serializeTableRow(headerCells)];
  for (let r = 1; r < rows; r++) lines.push(serializeTableRow(Array(cols).fill('')));

  const needsSeparator =
    heading.bodyLines.length > 0 && heading.bodyLines[heading.bodyLines.length - 1].trim() !== '';
  const insertAt = heading.bodyLines.length;
  const toInsert = needsSeparator ? ['', ...lines] : lines;
  commitLines(heading, insertAt, 0, toInsert);

  return /** @type {Table} */ (heading.body[heading.body.length - 1]);
}

// ---- list item edits --------------------------------------------------

/**
 * Replaces a list item's text, reconstructing its single source line with
 * the original indentation, marker, checkbox, [@N] start-value cookie, and
 * tag preserved — only the text portion changes. A list item is always exactly one line (its
 * lineCount is implicitly 1; nested content lives in separate list-item
 * entries with their own lineIndex, never as continuation lines of this
 * one), so this always splices exactly one line.
 *
 * Newlines in `newText` are stripped (a list item is one line, same rule
 * as heading-edit.js's renameHeading for heading titles).
 * @param {Heading} heading
 * @param {any} item
 * @param {string} newText
 */
export function editListItemText(heading, item, newText) {
  const sanitized = String(newText).replace(/[\r\n]+/g, ' ').trim();
  const checkboxPart = item.checkbox !== null ? `[${item.checkbox}] ` : '';
  const startValuePart = item.startValue != null ? `[@${item.startValue}] ` : '';
  const tagPart = item.tag ? `${item.tag} :: ` : '';
  const line = `${item.indent}${item.marker} ${startValuePart}${checkboxPart}${tagPart}${sanitized}`;
  commitLines(heading, item.lineIndex, 1, [line]);
}

/**
 * Inserts a new sibling item directly under `afterItem`'s first line, as Org's M-RET at the end of an item does, at the same
 * indentation and with the same kind of bullet; the item's sub-items and text follow the new one.  The new item has no
 * checkbox unless `withCheckbox` (M-S-RET), and a description item gets an empty term.  Ordered items are numbered again.
 * Returns the freshly parsed item so the caller can e.g. start editing it right away.
 * @param {Heading} heading
 * @param {any} [afterItem]
 * @param {string} [text]
 * @param {boolean} [withCheckbox]
 */
export function insertListItem(heading, afterItem, text = '', withCheckbox = false) {
  const key = /** @type {'bodyLines' | 'logbookLines' | 'preLogLines'} */ (afterItem.linesKey || 'bodyLines');
  const lines = heading[key] || (heading[key] = []);
  if (inBlockAt(lines, afterItem.lineIndex)) {
    // Org does not read a block's lines as a list: M-RET there starts a heading under the line, M-S-RET a TODO heading
    commitLinesIn(heading, key, afterItem.lineIndex + 1, 0, [withCheckbox ? '* TODO ' : '* ']);
    return null;
  }
  const checkboxPart = withCheckbox ? '[ ] ' : '';
  // Only a list whose first item has a term gets a new term (a description item's M-RET); an ordered one is numbered below
  const termPart = listKind(lines, afterItem.lineIndex) === 'descriptive' && !text ? ' :: ' : '';
  const line = `${afterItem.indent}${afterItem.marker} ${checkboxPart}${termPart}${text}`;
  // M-RET at the end of the item's line: trailing blanks go, and the new item goes right under it with the item's sub-items and
  // text following it; an item with nothing after its bullet and box gets the new one above it
  const own = lines[afterItem.lineIndex];
  const bare = /^[ \t]*(?:[-+*]|\d+[.)])(?:[ \t]+(?:\[@\d+\][ \t]*)?(?:\[[ xX-]\])?)?[ \t]*$/.test(own);
  const insertAt = bare ? afterItem.lineIndex : afterItem.lineIndex + 1;
  if (!bare && /[ \t]$/.test(own)) lines[afterItem.lineIndex] = own.replace(/[ \t]+$/, '');
  // blank lines separate the new item from its neighbors as they separate the others
  const blanks = Array(separatingBlankLines(lines, afterItem.lineIndex)).fill('');
  const newAt = bare ? insertAt : insertAt + blanks.length;
  commitLinesIn(heading, key, insertAt, 0, bare ? [line, ...blanks] : [...blanks, line]);
  heading[key] = fixBoxes(renumber(lines, newAt, newAt), newAt);
  if (key === 'bodyLines') heading.body = parseBody(heading.bodyLines);
  if (withCheckbox && typeof heading.title === 'string') updateCheckboxCookie(heading);
  if (key !== 'bodyLines') return { ...parseListItemAt(heading[key] || [], newAt), linesKey: key };

  /** @param {any} [items] */
  function findByLineIndex(items) {
    for (const item of items) {
      if (item.lineIndex === newAt) return item;
      for (const nestedList of item.children || []) {
        /** @type {any} */ const found = findByLineIndex(nestedList.items);
        if (found) return found;
      }
    }
    return null;
  }
  for (const node of heading.body) {
    if (node.type === 'list') {
      const found = findByLineIndex(node.items);
      if (found) return found;
    }
  }
  return null;
}

/** Replaces lines of `heading[key]` (`bodyLines`, or the lines of a LOGBOOK drawer), parsing the body again when it is the body.
 * @param {Heading} heading @param {'bodyLines' | 'logbookLines' | 'preLogLines'} key
 * @param {number} lineIndex @param {number} lineCount @param {string[]} newLines */
function commitLinesIn(heading, key, lineIndex, lineCount, newLines) {
  (heading[key] || (heading[key] = [])).splice(lineIndex, lineCount, ...newLines);
  if (key === 'bodyLines') heading.body = parseBody(heading.bodyLines);
}

/** An item described from its line, for a line the body tree has no item for (a drawer's, a block's).
 * @param {string[]} lines @param {number} lineIndex */
function parseListItemAt(lines, lineIndex) {
  const m = /^([ \t]*)([-+*]|\d+[.)])(?:[ \t]+(?:\[@\d+\][ \t]*)?(?:\[([ xX-])\](?:[ \t]+|$))?(.*))?$/.exec(lines[lineIndex]);
  const text = m?.[4] ?? '';
  return { type: 'list-item', indent: m?.[1] ?? '', marker: m?.[2] ?? '-', ordered: /^\d/.test(m?.[2] ?? ''), checkbox: m?.[3] ? m[3].toUpperCase() : null, startValue: null, tag: null, text, children: [], lineIndex };
}

/**
 * The list item on line `lineIndex` of `heading[key]` (the body, or the lines of a LOGBOOK drawer): the body tree's item, or one
 * read from the line itself where the tree has none (a drawer's, a `#+begin_` block's), as `org-list-struct` reads any line.
 * @param {Heading} heading @param {number} lineIndex @param {'bodyLines' | 'logbookLines' | 'preLogLines'} [key]
 */
export function listItemAtLine(heading, lineIndex, key = 'bodyLines') {
  const lines = heading[key];
  if (!lines || !isItemLine(lines[lineIndex] ?? '')) return null;
  if (key === 'bodyLines') {
    /** @param {import('./types.js').List[]} lists @returns {import('./types.js').ListItem | null} */
    const walk = (lists) => {
      for (const list of lists) for (const item of list.items || []) {
        if (item.lineIndex === lineIndex) return item;
        const found = walk(item.children || []);
        if (found) return found;
      }
      return null;
    };
    const found = walk(/** @type {import('./types.js').List[]} */ (heading.body.filter((n) => n.type === 'list')));
    if (found) return found;
  }
  return { ...parseListItemAt(lines, lineIndex), linesKey: key };
}

/**
 * Deletes a list item and everything nested under it (sub-items, at any
 * depth) — deleting a parent bullet takes its children with it, silently,
 * the same way deleting a folder takes its contents. No confirmation here;
 * that's a deliberate scope choice (unlike heading deletion, which does
 * confirm when there's content) since list items are smaller, more
 * frequent, easier-to-redo edits. Revisit if that turns out wrong in
 * practice.
 * @param {Heading} heading
 * @param {any} [item]
 */
export function deleteListItem(heading, item) {
  const key = /** @type {'bodyLines' | 'logbookLines' | 'preLogLines'} */ (item.linesKey || 'bodyLines');
  const start = item.lineIndex;
  const all = heading[key] || [];
  const end = itemEnd(all, start);
  const plainText = inBlockAt(all, start); // Org repairs no list inside such a block
  // the last item of a drawer's list ends before its final newline in Org, so deleting it leaves an empty line
  const drawerEnd = end >= all.length ? key !== 'bodyLines' : /^[ \t]*(?::END:|#\+end_\w+)[ \t]*$/i.test(all[end]);
  commitLinesIn(heading, key, start, end - start, drawerEnd ? [''] : []);
  // What is left follows Org's list rules: ordered items numbered again, parent checkboxes showing their sub-items
  const rest = heading[key] || [];
  const at = [start, start - 1, start + 1].find((l) => l >= 0 && l < rest.length && isItemLine(rest[l]));
  if (at !== undefined && !plainText) heading[key] = fixBoxes(renumber(rest, at), at);
  if (key === 'bodyLines') heading.body = parseBody(heading.bodyLines);
}

// ---- paragraph edits --------------------------------------------------

/**
 * Replaces a paragraph's text wholesale. `newText` is split on newlines
 * into raw org lines — typing a blank line inside it will genuinely split
 * into two paragraphs on reparse (a blank line is a paragraph break in
 * org), and typing something that looks like a list item or table row will
 * genuinely become one. That's correct org semantics reapplied, not a bug:
 * the editor is literal-syntax, the same way a plain-text org file is.
 * @param {Heading} heading
 * @param {any} paragraph
 * @param {string} newText
 */
export function editParagraphText(heading, paragraph, newText) {
  const newLines = String(newText).split('\n');
  commitLines(heading, paragraph.lineIndex, paragraph.lineCount, newLines.length ? newLines : ['']);
}

/**
 * @param {Heading} heading
 * @param {any} [paragraph]
 */
export function deleteParagraph(heading, paragraph) {
  commitLines(heading, paragraph.lineIndex, paragraph.lineCount, []);
}

/** Appends a brand-new paragraph to the end of `heading`'s body content,
 * @param {Heading} heading
 *  with the same blank-line-separator logic as insertTable. */
export function insertParagraph(heading, text = '') {
  const lines = String(text).split('\n');
  const needsSeparator =
    heading.bodyLines.length > 0 && heading.bodyLines[heading.bodyLines.length - 1].trim() !== '';
  const insertAt = heading.bodyLines.length;
  const toInsert = needsSeparator ? ['', ...lines] : lines;
  commitLines(heading, insertAt, 0, toInsert);
  return heading.body[heading.body.length - 1];
}

/**
 * Inserts a new paragraph right after `afterParagraph` — a targeted
 * sibling insert, unlike insertParagraph, which always appends at the
 * very end of the heading's body regardless of where you're looking.
 * Always separates the new paragraph from its neighbors with a blank
 * line on both sides it needs one (none needed on a side that's already
 * blank or at the end of the body), so it reads as its own paragraph, not
 * a continuation of whatever it's inserted next to.
 * @param {Heading} heading
 * @param {any} [afterParagraph]
 */
export function insertParagraphAfter(heading, afterParagraph, text = '') {
  const insertAt = afterParagraph.lineIndex + afterParagraph.lineCount;
  const lines = String(text).split('\n');
  const nextLine = heading.bodyLines[insertAt];
  const needsTrailingSeparator = nextLine !== undefined && nextLine.trim() !== '';
  const toInsert = needsTrailingSeparator ? ['', ...lines, ''] : ['', ...lines];
  commitLines(heading, insertAt, 0, toInsert);

  const newParagraphLineIndex = insertAt + 1;
  return heading.body.find(/** @param {import('./types.js').BodyNode} n @returns {n is import('./types.js').Paragraph} */ (n) => n.type === 'paragraph' && n.lineIndex === newParagraphLineIndex) || null;
}

// ---- heading "body text" (everything belonging to the heading) --------

/**
 * The bug this section fixes: org has no separate "description" field on
 * a heading — per the org spec, *any* content immediately following a
 * heading (or its planning line / property drawer) belongs to that
 * heading, until a sub-heading or end of file ends it. That content isn't
 * just paragraphs: it can be — and very often is — a mix of lists,
 * paragraphs, and tables, in any order and any combination.
 *
 * An earlier version of this only covered the *leading run of paragraph
 * nodes*, which handled simple description-only headings fine but missed
 * essentially everything in a heading like "Fix organice issues" — a
 * checklist, then a bold-text paragraph, then another list — because that
 * heading's body starts with a list, not a paragraph, so the leading-run
 * scan found nothing and returned empty. That was the actual bug: it
 * covered a narrow, common-but-not-representative case, not "the text
 * associated with the header" in general.
 *
 * The fix: getHeadingText/setHeadingText now cover the heading's *entire*
 * bodyLines — every line between the heading (and its planning line /
 * property drawer, which live on the heading object itself, not in
 * bodyLines) and the next heading. Nothing is excluded. Editing this and
 * writing it back is exactly as literal as editing the underlying .org
 * text directly would be: typing "- [ ] " at the start of a line turns it
 * into a checklist item on reparse, the same as it would anywhere else in
 * this app, because bodyLines is genuinely the org source text, not a
 * sanitized subset of it.
 *
 * This does overlap with the existing granular per-item editors (tap a
 * checkbox, tap one list item, tap one table cell) — that's intentional,
 * not a redundancy to resolve. Those stay the fast path for a single
 * small fix; this is the "edit everything about this heading's content
 * at once" path, useful for larger restructuring or when you just want to
 * see and edit it all together.
 * @param {Heading} heading
 */
export function getHeadingText(heading) {
  return heading.bodyLines.join('\n');
}

/**
 * Replaces the heading's entire body content with `newText`, splitting on
 * newlines and fully reparsing `heading.body` from scratch — the same
 * "patch the source, then re-derive everything" pattern every other
 * function in this file uses, just applied to the whole body instead of
 * one node's line span.
 * @param {Heading} heading
 * @param {string} newText
 */
export function setHeadingText(heading, newText) {
  const isEmpty = String(newText).trim() === '';
  heading.bodyLines = isEmpty ? [] : String(newText).split('\n');
  heading.body = parseBody(heading.bodyLines);
}
