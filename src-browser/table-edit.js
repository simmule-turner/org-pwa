// @ts-check
// The table commands of Org that change a table's shape or order, as the Table pad under a table and the god-mode / keyboard chords
// (M-arrows, M-S-arrows, C-c -, C-c RET, C-c ^) offer them. They act at the table's cursor: the cell last tapped or stepped to.
// What each does is in src/table-commands.js (held to Emacs 29.3); this file is the cursor, the status line and the undo step.
import { deleteTableColumn, deleteTableRow, insertTableColumn, insertTableRow, setTableCell } from '../src/body-edit.js';
import { readFunction, sortFunctions } from '../src/table-sort-lisp.js';
import { insertRowAbove, insertRule, insertRuleAndMove, moveColumn, moveRow, sortRows } from '../src/table-commands.js';
import { S } from './app-state.js';
import { openGridChoiceModal, promptText } from './dialogs.js';
import { commitAndRender, setStatus } from './editing.js';
import { resyncKeyboardFocusToBodyRow } from './keyboard-focus.js';
import { render } from './render.js';

/** @typedef {import('../src/types.js').Table} Table */
/** @typedef {import('../src/types.js').Heading} Heading */
/** @typedef {[number, number]} Cursor */

/** @param {Heading} heading @param {Table} table @returns {Table} the table as it is now (a commit makes a new one) */
function fresh(heading, table) {
  return /** @type {Table} */ ((heading.body || []).find((n) => n.type === 'table' && n.lineIndex === table.lineIndex) || table);
}

/** Writes the cell being edited, if any. A tap on a button would otherwise end the edit by blur, which draws the table again and loses the tap. */
export function commitPendingCellEdit() {
  if (!S.editingCell) return;
  const input = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('cell-edit-input'));
  const { heading, table, rowIndex, colIndex } = S.editingCell;
  S.editingCell = null;
  if (!input) return;
  setTableCell(heading, table, rowIndex, colIndex, input.value.replace(/\n/g, ' '));
  resyncKeyboardFocusToBodyRow(heading, 'table', table.lineIndex);
  commitAndRender('Edited table cell');
}

/** Makes `button` act when pressed, before the cell being edited loses focus (see commitPendingCellEdit); a key press on the focused button works too.
 * @param {HTMLElement} button @param {() => void} action */
export function onPress(button, action) {
  button.onclick = null;
  button.addEventListener('mousedown', (e) => {
    e.preventDefault();
    commitPendingCellEdit();
    action();
  });
  button.addEventListener('click', (e) => {
    if (e.detail === 0) action();
  });
}

/** The cursor of a table: the focused cell when focus is on this table, else the first cell. @param {Heading} heading @param {Table} table @returns {Cursor} */
export function tableCursor(heading, table) {
  const f = S.keyboardFocusedBodyRow;
  const pos = S.keyboardFocusedCellPos;
  if (f && f.rowType === 'table' && f.heading === heading && f.node.lineIndex === table.lineIndex && pos && table.rows[pos.rowIndex] && table.rows[pos.rowIndex].type === 'row') return [pos.rowIndex, pos.colIndex];
  return [Math.max(0, table.rows.findIndex((r) => r.type === 'row')), 0];
}

/** Whether keyboard focus is on a table row (so the chords of Org's table commands apply instead of the heading ones). */
export const inTable = () => !!S.keyboardFocusedBodyRow && S.keyboardFocusedBodyRow.rowType === 'table';

/** The nearest data row at or above `row` (else below), after rows went away. @param {Table} table @param {number} row */
function nearestDataRow(table, row) {
  let r = Math.min(row, table.rows.length - 1);
  while (r > 0 && table.rows[r].type !== 'row') r--;
  if (table.rows[r] && table.rows[r].type === 'row') return r;
  return Math.max(0, table.rows.findIndex((x) => x.type === 'row'));
}

/** @type {Record<string, { label: string, key: string, run: (h: Heading, t: Table, at: Cursor) => { cursor: Cursor, say: string } }>} */
export const TABLE_COMMANDS = {
  'row-above': { label: 'Row above', key: 'M-S-<down>', run: (h, t, at) => ({ cursor: insertRowAbove(h, t, at), say: 'Added a row above' }) },
  'row-below': {
    label: 'Row below',
    key: 'C-u M-S-<down>',
    run: (h, t, [row, col]) => {
      insertTableRow(h, t, row);
      return { cursor: [row + 1, col], say: 'Added a row below' };
    },
  },
  'row-delete': {
    label: 'Delete row',
    key: 'M-S-<up>',
    run: (h, t, [row, col]) => {
      deleteTableRow(h, t, row);
      return { cursor: [nearestDataRow(t, row), col], say: 'Deleted the row' };
    },
  },
  'row-up': { label: 'Move row up', key: 'M-<up>', run: (h, t, at) => ({ cursor: moveRow(h, t, at, true), say: 'Moved the row up' }) },
  'row-down': { label: 'Move row down', key: 'M-<down>', run: (h, t, at) => ({ cursor: moveRow(h, t, at, false), say: 'Moved the row down' }) },
  'col-left': {
    label: 'Column left',
    key: 'M-S-<right>',
    run: (h, t, [row, col]) => {
      insertTableColumn(h, t, col - 1);
      return { cursor: [row, col], say: 'Added a column to the left' };
    },
  },
  'col-right': {
    label: 'Column right',
    key: 'C-u M-S-<right>',
    run: (h, t, [row, col]) => {
      insertTableColumn(h, t, col);
      return { cursor: [row, col + 1], say: 'Added a column to the right' };
    },
  },
  'col-delete': {
    label: 'Delete column',
    key: 'M-S-<left>',
    run: (h, t, [row, col]) => {
      deleteTableColumn(h, t, col);
      const width = Math.max(1, ...t.rows.map((r) => (r.type === 'row' ? r.cells.length : 0)));
      return { cursor: [row, Math.min(col, width - 1)], say: 'Deleted the column' };
    },
  },
  'col-move-left': { label: 'Move column left', key: 'M-<left>', run: (h, t, at) => ({ cursor: moveColumn(h, t, at, true), say: 'Moved the column left' }) },
  'col-move-right': { label: 'Move column right', key: 'M-<right>', run: (h, t, at) => ({ cursor: moveColumn(h, t, at, false), say: 'Moved the column right' }) },
  'rule-below': { label: 'Rule below', key: 'C-c -', run: (h, t, at) => ({ cursor: insertRule(h, t, at), say: 'Added a rule below' }) },
  'rule-above': { label: 'Rule above', key: 'C-u C-c -', run: (h, t, at) => ({ cursor: insertRule(h, t, at, { above: true }), say: 'Added a rule above' }) },
  'rule-and-move': { label: 'Rule below, then next row', key: 'C-c RET', run: (h, t, at) => ({ cursor: insertRuleAndMove(h, t, at), say: 'Added a rule below' }) },
  'sort-a': { label: 'Sort A to Z', key: 'C-c ^ a', run: (h, t, at) => ({ cursor: sortRows(h, t, at, 'a'), say: 'Sorted alphabetically' }) },
  'sort-A': { label: 'Sort Z to A', key: 'C-c ^ A', run: (h, t, at) => ({ cursor: sortRows(h, t, at, 'A'), say: 'Sorted alphabetically, reversed' }) },
  'sort-c': { label: 'Sort A to Z, case sensitive', key: 'C-u C-c ^ a', run: (h, t, at) => ({ cursor: sortRows(h, t, at, 'a', undefined, true), say: 'Sorted alphabetically, case sensitive' }) },
  'sort-C': { label: 'Sort Z to A, case sensitive', key: 'C-u C-c ^ A', run: (h, t, at) => ({ cursor: sortRows(h, t, at, 'A', undefined, true), say: 'Sorted alphabetically, case sensitive, reversed' }) },
  'sort-n': { label: 'Sort 1 to 9', key: 'C-c ^ n', run: (h, t, at) => ({ cursor: sortRows(h, t, at, 'n'), say: 'Sorted numerically' }) },
  'sort-N': { label: 'Sort 9 to 1', key: 'C-c ^ N', run: (h, t, at) => ({ cursor: sortRows(h, t, at, 'N'), say: 'Sorted numerically, reversed' }) },
  'sort-t': { label: 'Sort oldest first', key: 'C-c ^ t', run: (h, t, at) => ({ cursor: sortRows(h, t, at, 't'), say: 'Sorted by time' }) },
  'sort-T': { label: 'Sort newest first', key: 'C-c ^ T', run: (h, t, at) => ({ cursor: sortRows(h, t, at, 'T'), say: 'Sorted by time, reversed' }) },
};

/** Runs `run` on the table at its cursor, then puts the cursor where Emacs does and records one undo step. A refusal is said in the status line.
 * @param {Heading} heading @param {Table} table @param {(h: Heading, t: Table, at: Cursor) => { cursor: Cursor, say: string }} run */
function execute(heading, table, run) {
  const now = fresh(heading, table);
  const lineIndex = now.lineIndex;
  let result;
  try {
    result = run(heading, now, tableCursor(heading, now));
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
    render();
    return;
  }
  resyncKeyboardFocusToBodyRow(heading, 'table', lineIndex);
  const after = fresh(heading, now);
  const row = nearestDataRow(after, result.cursor[0]);
  S.keyboardFocusedCellPos = { rowIndex: row, colIndex: Math.max(0, result.cursor[1]) };
  commitAndRender(result.say);
}

/** Runs the table command `id`. @param {Heading} heading @param {Table} table @param {string} id */
export function runTableCommand(heading, table, id) {
  execute(heading, table, TABLE_COMMANDS[id].run);
}

/** The table that keyboard focus is on, or null. */
export function focusedTable() {
  const f = S.keyboardFocusedBodyRow;
  return f && f.rowType === 'table' ? { heading: f.heading, table: f.node } : null;
}

/** A table chord of god-mode: runs `id` on the focused table, or says there is none. Returns whether focus was on a table. @param {string} id */
export function tableChord(id) {
  const t = focusedTable();
  if (!t) return false;
  runTableCommand(t.heading, t.table, id);
  return true;
}

/** `C-c ^` (org-table-sort-lines) asks the way Emacs does: one key for the kind of sort, a capital for reversed. `f` goes on to ask for the function that
 * gets the key and the one that compares keys (org-read-function: the name of a function that exists; the second may be empty).
 * @param {Heading} heading @param {Table} table */
export function askSort(heading, table) {
  /** @param {'a' | 'A' | 'c' | 'C' | 'n' | 'N' | 't' | 'T'} type */
  const sortBy = (type) => () => runTableCommand(heading, table, 'sort-' + type);
  /** @param {'f' | 'F'} type */
  const sortByFunction = (type) => async () => {
    const keyName = await promptText('Function for extracting keys:', '', { okLabel: 'Next' });
    if (keyName === null) return;
    const key = readFunction(keyName, false);
    if ('error' in key) {
      setStatus(key.error);
      render();
      return;
    }
    const compareName = await promptText("Function for comparing keys (empty for default `sort-subr' predicate):", '', { okLabel: 'Sort' });
    if (compareName === null) return;
    const compare = readFunction(compareName, true);
    if ('error' in compare) {
      setStatus(compare.error);
      render();
      return;
    }
    const by = sortFunctions(/** @type {import('../src/elisp-data.js').LObj} */ (key.fn), compare.fn);
    execute(heading, table, (h, t, at) => ({ cursor: sortRows(h, t, at, type, by), say: type === 'f' ? 'Sorted by function' : 'Sorted by function, reversed' }));
  };
  openGridChoiceModal({
    label: 'Sort Table: [a]lphabetic, [n]umeric, [t]ime, [f]unc. A/N/T/F means reversed:',
    buttons: [
      { key: 'a', text: 'Alphabetic', onClick: sortBy('a') },
      { key: 'A', text: 'Alphabetic, reversed', onClick: sortBy('A') },
      { key: 'n', text: 'Numeric', onClick: sortBy('n') },
      { key: 'N', text: 'Numeric, reversed', onClick: sortBy('N') },
      { key: 't', text: 'Time', onClick: sortBy('t') },
      { key: 'T', text: 'Time, reversed', onClick: sortBy('T') },
      { key: 'f', text: 'Function\u2026', onClick: sortByFunction('f') },
      { key: 'F', text: 'Function, reversed\u2026', onClick: sortByFunction('F') },
      { key: 'c', text: 'Alphabetic, case sensitive', onClick: sortBy('c') },
      { key: 'C', text: 'Alphabetic, case sensitive, reversed', onClick: sortBy('C') },
    ],
  });
}
