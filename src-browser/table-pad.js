// @ts-check
// The Table pad: the table commands that change shape or order, as buttons under the table (the touch way to Org's M-arrows,
// C-c - and C-c ^), with arrows to move the table cursor that they act at.
import { S } from './app-state.js';
import { moveTableCellFocus } from './keyboard-focus.js';
import { TABLE_COMMANDS, askSort, onPress, runTableCommand } from './table-edit.js';
import { smallButton } from './ui-widgets.js';

/** @typedef {import('../src/types.js').Table} Table */
/** @typedef {import('../src/types.js').Heading} Heading */

const GROUPS = /** @type {[string, string[]][]} */ ([
  ['Row', ['row-above', 'row-below', 'row-delete', 'row-up', 'row-down']],
  ['Column', ['col-left', 'col-right', 'col-delete', 'col-move-left', 'col-move-right']],
  ['Rule', ['rule-below', 'rule-above', 'rule-and-move']],
  ['Sort', ['sort']],
]);

/** Short text for a button, so the pad stays narrow on a phone. */
const SHORT = /** @type {Record<string, string>} */ ({
  'row-above': 'Add above', 'row-below': 'Add below', 'row-delete': 'Delete', 'row-up': 'Move ↑', 'row-down': 'Move ↓',
  'col-left': 'Add left', 'col-right': 'Add right', 'col-delete': 'Delete', 'col-move-left': 'Move ←', 'col-move-right': 'Move →',
  'rule-below': 'Below', 'rule-above': 'Above', 'rule-and-move': 'Below + next row',
  sort: 'Sort by this column\u2026',
});

/** @param {Heading} heading @param {Table} table whether the pad is open under this table */
export function tablePadOpen(heading, table) {
  return !!(heading.padVisible && heading.padVisible.has(table.lineIndex));
}

/** The pad itself. @param {Heading} heading @param {Table} table @returns {HTMLElement} */
export function renderTablePad(heading, table) {
  const pad = document.createElement('div');
  pad.dataset.tablePad = 'true';
  pad.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px;padding:8px;border:1px solid var(--border);border-radius:var(--radius-control);';
  /** @param {string} caption @returns {{ line: HTMLElement, add: (b: HTMLElement) => void }} */
  const line = (caption) => {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-items:center;';
    const label = document.createElement('span');
    label.textContent = caption;
    label.style.cssText = 'font-size:11px;opacity:.7;min-width:56px;';
    el.appendChild(label);
    return { line: el, add: (b) => el.appendChild(b) };
  };
  const cursor = line('Cursor');
  for (const [text, name, dr, dc] of /** @type {[string, string, number, number][]} */ ([['←', 'Cell left', 0, -1], ['↑', 'Cell up', -1, 0], ['↓', 'Cell down', 1, 0], ['→', 'Cell right', 0, 1]])) {
    const b = smallButton(text, name);
    onPress(b, () => moveTableCellFocus(dr, dc));
    b.dataset.padMove = name;
    cursor.add(b);
  }
  pad.appendChild(cursor.line);
  for (const [caption, ids] of GROUPS) {
    const g = line(caption);
    for (const id of ids) {
      const label = id === 'sort' ? 'Sort the rows by the cell\u2019s column (org-table-sort-lines)' : TABLE_COMMANDS[id].label;
      const key = id === 'sort' ? 'C-c ^' : TABLE_COMMANDS[id].key;
      const b = smallButton(SHORT[id], `${label} (${key})`);
      onPress(b, () => (id === 'sort' ? askSort(heading, table) : runTableCommand(heading, table, id)));
      b.title = `${label} \u2014 ${key}`;
      b.dataset.padCommand = id;
      g.add(b);
    }
    pad.appendChild(g.line);
  }
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:11px;opacity:.7;';
  hint.textContent = S.keyboardFocusedCellPos ? 'These act at the highlighted cell.' : 'Tap a cell first; these act at the highlighted cell.';
  pad.appendChild(hint);
  return pad;
}
