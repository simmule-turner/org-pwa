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

// ---- table serialization (pure, independently testable) ------------------

export function serializeTableRow(cells) {
  return '| ' + cells.join(' | ') + ' |';
}

export function serializeTableRule(columnCount) {
  return '|' + Array(Math.max(1, columnCount)).fill('---').join('+') + '|';
}

export function serializeTable(table) {
  const dataRow = table.rows.find((r) => r.type === 'row');
  const columnCount = dataRow ? dataRow.cells.length : 1;
  const lines = table.rows.map((row) =>
    row.type === 'rule' ? serializeTableRule(columnCount) : serializeTableRow(row.cells)
  );
  if (table.tblfm) lines.push('#+TBLFM: ' + table.tblfm);
  return lines;
}

// ---- commit: flush a mutated table/paragraph back to bodyLines ----------

/** Replaces `heading.bodyLines[lineIndex, lineIndex+lineCount)` with
 *  `newLines`, then fully reparses `heading.body` from the updated
 *  bodyLines. This is the one place that keeps the derived tree and the
 *  serialization source in sync — every edit function below ends by
 *  calling this rather than mutating heading.body directly. */
function commitLines(heading, lineIndex, lineCount, newLines) {
  heading.bodyLines.splice(lineIndex, lineCount, ...newLines);
  heading.body = parseBody(heading.bodyLines);
}

// ---- table edits ----------------------------------------------------------

function requireDataRow(table, rowIndex) {
  const row = table.rows[rowIndex];
  if (!row || row.type !== 'row') {
    throw new Error(`setTableCell: row ${rowIndex} is not a data row (rule rows have no cells)`);
  }
  return row;
}

/** Sets one cell's text and commits the whole table's new text back to
 *  bodyLines. `table` must be a fresh reference from the current render
 *  (see module docstring). */
export function setTableCell(heading, table, rowIndex, colIndex, value) {
  const row = requireDataRow(table, rowIndex);
  row.cells[colIndex] = String(value).replace(/[\r\n|]+/g, ' ').trim();
  commitLines(heading, table.lineIndex, table.lineCount, serializeTable(table));
}

/** Inserts a new blank data row after `afterRowIndex` (-1 to insert at the
 *  very start), with the same column count as the table's existing rows. */
export function insertTableRow(heading, table, afterRowIndex) {
  const dataRow = table.rows.find((r) => r.type === 'row');
  const columnCount = dataRow ? dataRow.cells.length : 1;
  const newRow = { type: 'row', cells: Array(columnCount).fill('') };
  table.rows.splice(afterRowIndex + 1, 0, newRow);
  commitLines(heading, table.lineIndex, table.lineCount, serializeTable(table));
}

export function deleteTableRow(heading, table, rowIndex) {
  if (table.rows.length <= 1) {
    throw new Error('deleteTableRow: refusing to delete the last row of a table');
  }
  table.rows.splice(rowIndex, 1);
  commitLines(heading, table.lineIndex, table.lineCount, serializeTable(table));
}

/** Inserts a new blank column after `afterColIndex` (-1 for the start) in
 *  every data row. Rule rows need no per-row change — serializeTable
 *  derives the rule's width from the (now-updated) data row column count. */
export function insertTableColumn(heading, table, afterColIndex) {
  for (const row of table.rows) {
    if (row.type === 'row') row.cells.splice(afterColIndex + 1, 0, '');
  }
  commitLines(heading, table.lineIndex, table.lineCount, serializeTable(table));
}

export function deleteTableColumn(heading, table, colIndex) {
  const dataRow = table.rows.find((r) => r.type === 'row');
  if (dataRow && dataRow.cells.length <= 1) {
    throw new Error('deleteTableColumn: refusing to delete the last column of a table');
  }
  for (const row of table.rows) {
    if (row.type === 'row') row.cells.splice(colIndex, 1);
  }
  commitLines(heading, table.lineIndex, table.lineCount, serializeTable(table));
}

export function deleteTable(heading, table) {
  commitLines(heading, table.lineIndex, table.lineCount, []);
}

/** Appends a brand-new table (default 2x2, blank cells, with a header
 *  rule) to the end of `heading`'s body content. Adds a blank-line
 *  separator first if the heading already has body content, so the new
 *  table doesn't visually run into whatever precedes it. */
export function insertTable(heading, { rows = 2, cols = 2 } = {}) {
  const headerCells = Array(cols).fill('');
  const lines = [serializeTableRow(headerCells), serializeTableRule(cols)];
  for (let r = 1; r < rows; r++) lines.push(serializeTableRow(Array(cols).fill('')));

  const needsSeparator =
    heading.bodyLines.length > 0 && heading.bodyLines[heading.bodyLines.length - 1].trim() !== '';
  const insertAt = heading.bodyLines.length;
  const toInsert = needsSeparator ? ['', ...lines] : lines;
  commitLines(heading, insertAt, 0, toInsert);

  return heading.body[heading.body.length - 1];
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
 */
export function editListItemText(heading, item, newText) {
  const sanitized = String(newText).replace(/[\r\n]+/g, ' ').trim();
  const checkboxPart = item.checkbox !== null ? `[${item.checkbox}] ` : '';
  const startValuePart = item.startValue != null ? `[@${item.startValue}] ` : '';
  const tagPart = item.tag ? `${item.tag} :: ` : '';
  const line = `${item.indent}${item.marker} ${checkboxPart}${startValuePart}${tagPart}${sanitized}`;
  commitLines(heading, item.lineIndex, 1, [line]);
}

/** The line just past the end of `item`'s own line and everything nested
 *  under it (recursively) — i.e. the exclusive end of its line span. */
function listItemEndLine(item) {
  let end = item.lineIndex + 1;
  for (const nestedList of item.children || []) {
    for (const child of nestedList.items) {
      end = Math.max(end, listItemEndLine(child));
    }
  }
  return end;
}

/**
 * Inserts a new sibling item right after `afterItem` (and after
 * everything nested under it), at the same indentation/marker style. If
 * `afterItem` has a checkbox, the new item gets an unchecked one too
 * (matching "this is a checklist" convention); it never inherits
 * `afterItem`'s tag, since a tag is a per-item descriptive term, not
 * something that makes sense to duplicate onto a sibling. Returns the
 * freshly parsed item so the caller can e.g. start editing it right away.
 */
export function insertListItem(heading, afterItem, text = '') {
  const checkboxPart = afterItem.checkbox !== null ? '[ ] ' : '';
  const line = `${afterItem.indent}${afterItem.marker} ${checkboxPart}${text}`;
  const insertAt = listItemEndLine(afterItem);
  commitLines(heading, insertAt, 0, [line]);

  function findByLineIndex(items) {
    for (const item of items) {
      if (item.lineIndex === insertAt) return item;
      for (const nestedList of item.children || []) {
        const found = findByLineIndex(nestedList.items);
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

/**
 * Deletes a list item and everything nested under it (sub-items, at any
 * depth) — deleting a parent bullet takes its children with it, silently,
 * the same way deleting a folder takes its contents. No confirmation here;
 * that's a deliberate scope choice (unlike heading deletion, which does
 * confirm when there's content) since list items are smaller, more
 * frequent, easier-to-redo edits. Revisit if that turns out wrong in
 * practice.
 */
export function deleteListItem(heading, item) {
  const start = item.lineIndex;
  const end = listItemEndLine(item);
  commitLines(heading, start, end - start, []);
}

// ---- paragraph edits --------------------------------------------------

/**
 * Replaces a paragraph's text wholesale. `newText` is split on newlines
 * into raw org lines — typing a blank line inside it will genuinely split
 * into two paragraphs on reparse (a blank line is a paragraph break in
 * org), and typing something that looks like a list item or table row will
 * genuinely become one. That's correct org semantics reapplied, not a bug:
 * the editor is literal-syntax, the same way a plain-text org file is.
 */
export function editParagraphText(heading, paragraph, newText) {
  const newLines = String(newText).split('\n');
  commitLines(heading, paragraph.lineIndex, paragraph.lineCount, newLines.length ? newLines : ['']);
}

export function deleteParagraph(heading, paragraph) {
  commitLines(heading, paragraph.lineIndex, paragraph.lineCount, []);
}

/** Appends a brand-new paragraph to the end of `heading`'s body content,
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

// ---- heading "body text" (multi-paragraph) --------------------------

/**
 * The bug this section fixes: org has no separate "description" field on
 * a heading — per the org spec, *any* text immediately following a
 * heading (or its planning line / property drawer) belongs to that
 * heading as its body, and that body can span multiple paragraphs
 * separated by blank lines, all still belonging to the same heading right
 * up until a list, table, sub-heading, or end of file interrupts it. The
 * previous "edit text" feature only surfaced the *first* paragraph node
 * for editing, silently ignoring any further paragraphs — this section
 * replaces that with the actual multi-paragraph semantics.
 *
 * Scope boundary, stated rather than hidden: this covers the *leading*
 * run of paragraphs — every paragraph node starting from the beginning of
 * `heading.body`, until a non-paragraph node (list/table/block) breaks
 * the run. A paragraph appearing *after* a list or table is not part of
 * this combined block; it's still individually editable by tapping that
 * specific paragraph row (unchanged, already worked). This matches every
 * example in the org documentation, which shows body text as a
 * contiguous run at the top of a heading's content, not interleaved with
 * structured content.
 */
function leadingParagraphs(heading) {
  const paras = [];
  for (const node of heading.body) {
    if (node.type !== 'paragraph') break;
    paras.push(node);
  }
  return paras;
}

/** Every leading paragraph node, for callers (the UI) that need to know
 *  which specific nodes are covered by getHeadingText/setHeadingText —
 *  e.g. to avoid rendering them a second time as separate rows while
 *  they're being edited as one combined block. */
export function getLeadingParagraphNodes(heading) {
  return leadingParagraphs(heading);
}

/** The heading's full leading-paragraph text as one string, with a blank
 *  line between each paragraph (so the multi-paragraph structure survives
 *  round-trip through a single textarea) — '' if there's no leading text yet. */
export function getHeadingText(heading) {
  return leadingParagraphs(heading)
    .map((p) => p.lines.join('\n'))
    .join('\n\n');
}

/**
 * Replaces the heading's entire leading-paragraph run with `newText` in
 * one operation. Blank lines the user types are NOT flattened away —
 * they split back into separate paragraph nodes on reparse, same as
 * editParagraphText's literal-syntax behavior, because that's correct org
 * semantics, not something to paper over.
 *
 * If there's no leading paragraph run yet, the new text is inserted right
 * at the start of the heading's body content (before any existing list or
 * table), matching where descriptive text conventionally goes — not
 * appended at the end the way insertParagraph does for a deliberately
 * separate, later note.
 */
export function setHeadingText(heading, newText) {
  const paras = leadingParagraphs(heading);
  const isEmpty = String(newText).trim() === '';
  const newLines = isEmpty ? [] : String(newText).split('\n');

  if (paras.length > 0) {
    const start = paras[0].lineIndex;
    const last = paras[paras.length - 1];
    const end = last.lineIndex + last.lineCount;
    commitLines(heading, start, end - start, newLines);
  } else if (newLines.length > 0) {
    commitLines(heading, 0, 0, newLines);
  }
  // else: nothing existed and nothing was typed — no-op.
}
