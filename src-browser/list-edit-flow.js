// The list commands of org-list.el on the focused list item: M-right / M-left (org-indent-item, org-outdent-item), M-S-right / M-S-left
// (the tree forms), M-up / M-down (org-move-item-up, -down), C-c - (org-cycle-list-bullet), C-c ^ (org-sort-list), C-c C-c on the item's box
// (org-toggle-checkbox), org-list-repair.  The engine is src/list-struct.js; this file runs it on the lines of the heading that holds the item.
import { commitLines } from '../src/body-edit.js';
import { cycleListBullet, indentItem, indentItemTree, moveItemDown, moveItemUp, outdentItem, outdentItemTree, repairListAt, sortList, toggleCheckbox } from '../src/list-struct.js';
import { S } from './app-state.js';
import { openGridChoiceModal } from './dialogs.js';
import { commitAndRender, setStatus } from './editing.js';
import { render } from './render.js';
import { listCommandInText } from './text-org-commands.js';

/** The focused row when it is a list item, with the heading that holds it. */
export function focusedListItem() {
  const row = S.keyboardFocusedBodyRow;
  if (!row || row.rowType !== 'list-item' || !row.heading || !Array.isArray(row.heading.bodyLines)) return null;
  return { heading: /** @type {import('../src/types.js').Heading} */ (row.heading), line: /** @type {number} */ (row.item.lineIndex) };
}

/** @typedef {import('../src/types.js').Heading} Heading */

/**
 * Runs `command` on the focused list item and commits the lines it leaves; its error text goes to the status line.
 * @param {string} say @param {(lines: string[], line: number) => string[]} command
 */
function run(say, command) {
  const at = focusedListItem();
  if (!at) return;
  let out;
  try {
    out = command(at.heading.bodyLines.slice(), at.line);
  } catch (e) {
    setStatus(/** @type {Error} */ (e).message);
    render();
    return;
  }
  commitLines(at.heading, 0, at.heading.bodyLines.length, out);
  commitAndRender(say);
}

/** @type {Record<string, (lines: string[], line: number) => string[]>} */
const COMMANDS = {
  'indent-item': (l, n) => indentItem(l, n),
  'outdent-item': (l, n) => outdentItem(l, n),
  'indent-item-tree': (l, n) => indentItemTree(l, n),
  'outdent-item-tree': (l, n) => outdentItemTree(l, n),
  'move-item-up': (l, n) => moveItemUp(l, n),
  'move-item-down': (l, n) => moveItemDown(l, n),
  'cycle-list-bullet': (l, n) => cycleListBullet(l, n),
  'toggle-checkbox': (l, n) => toggleCheckbox(l, n),
  'list-repair': (l, n) => repairListAt(l, n),
};

const SAYS = {
  'indent-item': 'Indented item',
  'outdent-item': 'Outdented item',
  'indent-item-tree': 'Indented item with its sub-items',
  'outdent-item-tree': 'Outdented item with its sub-items',
  'move-item-up': 'Moved item up',
  'move-item-down': 'Moved item down',
  'cycle-list-bullet': 'Cycled the bullet',
  'toggle-checkbox': 'Toggled the checkbox',
  'list-repair': 'Repaired the list',
};

/** A list chord of god-mode: runs `id` on the focused list item.  Returns whether focus was on one. @param {keyof typeof COMMANDS} id */
export function listChord(id) {
  if (!focusedListItem()) return listCommandInText(id);
  run(/** @type {Record<string, string>} */ (SAYS)[id], COMMANDS[id]);
  return true;
}

/** `C-c ^` on a list item (org-sort-list): one key for the kind of sort, a capital for reversed.  Returns whether focus was on an item. */
export function askListSort() {
  if (!focusedListItem()) return false;
  /** @param {string} type @param {boolean} [withCase] */
  const by = (type, withCase = false) => () => run('Sorted the list', (l, n) => sortList(l, n, type, { withCase }));
  openGridChoiceModal({
    label: 'Sort list: [a]lphabetic, [n]umeric, [t]ime, [x] checked state. A/N/T/X means reversed:',
    buttons: [
      { key: 'a', text: 'Alphabetic', onClick: by('a') },
      { key: 'A', text: 'Alphabetic, reversed', onClick: by('A') },
      { key: 'n', text: 'Numeric', onClick: by('n') },
      { key: 'N', text: 'Numeric, reversed', onClick: by('N') },
      { key: 't', text: 'Time', onClick: by('t') },
      { key: 'T', text: 'Time, reversed', onClick: by('T') },
      { key: 'x', text: 'Checked state', onClick: by('x') },
      { key: 'X', text: 'Checked state, reversed', onClick: by('X') },
      { key: 'c', text: 'Alphabetic, case sensitive', onClick: by('a', true) },
      { key: 'C', text: 'Alphabetic, case sensitive, reversed', onClick: by('A', true) },
    ],
  });
  return true;
}
