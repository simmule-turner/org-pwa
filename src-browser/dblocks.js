// @ts-check
// Dynamic blocks: C-c C-x C-u (org-dblock-update) writes the `columnview` blocks of the focused heading again, org-update-all-dblocks
// those of the whole file, and org-columns-insert-dblock adds one. The table itself comes from src/org-columns.js.
import { updateAllColumnviewBlocks, updateColumnviewBlocksUnder } from '../src/org-columns.js';
import { commitLines } from '../src/body-edit.js';
import { openActionSheet } from './bottom-sheet.js';
import { S } from './app-state.js';
import { columnsContext } from './columns-panel.js';
import { commitAndRender, setStatus } from './editing.js';

/** @typedef {import('../src/types.js').Heading} Heading */

/** Says how many blocks were written, and keeps the change as one edit. @param {number} count @param {string} where */
function finish(count, where) {
  if (count === 0) {
    setStatus(`No dynamic block ${where}.`);
    return;
  }
  commitAndRender(count === 1 ? 'Dynamic block updated' : `${count} dynamic blocks updated`);
}

/** org-dblock-update: the `columnview` blocks in the body of the focused heading. */
export function updateDynamicBlocksAtFocus() {
  const heading = S.keyboardFocusedHeading;
  if (!heading) {
    setStatus('Put the cursor on a heading first.');
    return;
  }
  try {
    finish(updateColumnviewBlocksUnder(S.state.doc, heading, columnsContext()), 'under this heading');
  } catch (e) {
    setStatus(String(/** @type {Error} */ (e).message));
  }
}

/** org-update-all-dblocks. */
export function updateAllDynamicBlocks() {
  try {
    finish(updateAllColumnviewBlocks(S.state.doc, columnsContext()), 'in this file');
  } catch (e) {
    setStatus(String(/** @type {Error} */ (e).message));
  }
}

/** The entries of the file that have an ID, for the choice of what a new column view block captures. @returns {Heading[]} */
function headingsWithId() {
  /** @type {Heading[]} */
  const found = [];
  /** @param {Heading[]} nodes */
  const walk = (nodes) => {
    for (const h of nodes) {
      if (h.type !== 'heading') continue;
      if (Object.keys(h.properties || {}).some((k) => k.toUpperCase() === 'ID')) found.push(h);
      walk(h.children);
    }
  };
  walk(S.state.doc.children);
  return found;
}

/** org-columns-insert-dblock: asks what the table is of (this entry, the whole file, or an entry with an ID), adds the block to the focused heading and writes it. */
export function insertColumnviewBlock() {
  const heading = S.keyboardFocusedHeading;
  if (!heading) {
    setStatus('Put the cursor on a heading first.');
    return;
  }
  /** @param {string} id */
  const insert = (id) => {
    commitLines(heading, heading.bodyLines.length, 0, [`#+BEGIN: columnview :hlines 1 :id ${id}`, '#+END:']);
    updateDynamicBlocksAtFocus();
  };
  const idOf = (/** @type {Heading} */ h) => String(h.properties[Object.keys(h.properties).find((k) => k.toUpperCase() === 'ID') ?? '']);
  openActionSheet({
    title: 'Capture columns',
    actions: [
      { label: 'This entry (local)', onClick: () => insert('local') },
      { label: 'The whole file (global)', onClick: () => insert('global') },
      ...headingsWithId().slice(0, 30).map((h) => ({ label: h.title, hint: idOf(h), onClick: () => insert(JSON.stringify(idOf(h))) })),
    ],
  });
}
