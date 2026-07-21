
/**
 * Outline view-model: turns a document AST + fold state into the flat row
 * list a touch UI actually renders (per §5's virtualization requirement —
 * a real renderer maps this array over a windowed/virtualized list, not
 * the tree directly), and exposes the action handlers behind the gestures
 * explored in the mobile mockup: tap-to-fold, tap-to-cycle-TODO,
 * tap-to-cycle-checkbox.
 *
 * This module is the seam between the data layer (org-parser, fold-state,
 * todo-cycle) and an actual renderer (DOM/React/whatever) — it produces
 * plain data and pure mutation functions, nothing UI-framework-specific.
 */

import { buildFoldIndex } from './fold-state.js';
import { resolveTodoSequence, cycleTodoState } from './todo-cycle.js';

const CHECKBOX_CYCLE = [' ', '-', 'X'];

/**
 * Flattens `doc` into a linear row array respecting each heading's
 * `collapsed` flag: a collapsed heading's children (sub-headings AND body
 * content) are omitted entirely, not just visually hidden — matching what
 * a virtualized list needs (it shouldn't have to measure/skip hidden rows,
 * they just shouldn't be in the array).
 *
 * Every body-content row (list-item, paragraph, table, block) carries a
 * `heading` reference to its owning heading node — needed by any editing
 * operation that has to splice that heading's `bodyLines` (see
 * body-edit.js), so callers never have to re-derive "which heading does
 * this row belong to" by searching.
 *
 * `computeIds` (default true) controls whether row.id gets populated.
 * Computing it requires buildFoldIndex — a full recursive tree walk with
 * an FNV-1a hash per heading — which is only actually needed by callers
 * that persist/look up fold state by id. A UI's per-interaction render
 * loop typically doesn't read row.id at all (it holds live node/item
 * object references instead), so pass `{ computeIds: false }` there to
 * skip that walk entirely — on a large document this is the difference
 * between "every tap re-hashes the whole tree" and "every tap just reads
 * a few already-set booleans".
 *
 * Row shapes:
 *   { rowType: 'heading', id, node, depth, hasChildren }
 *   { rowType: 'list-item', id, item, depth, heading, displayNumber }
 *   { rowType: 'paragraph' | 'table' | 'block', node, depth, heading }
 *
 * `displayNumber` is the item's position for rendering an ordered list's
 * numbering (null for unordered items) — computed per items-array (each
 * nested list numbers independently) and reset by a [@N] start-value
 * cookie, so callers don't need to re-derive numbering themselves.
 */
function flattenVisibleRows(doc, opts = {}) {
  const { computeIds = true } = opts;
  const idByNode = computeIds ? new Map(buildFoldIndex(doc).map((e) => [e.node, e.id])) : null;
  const rows = [];

  function flattenListItems(items, headingNode, headingId, depth, pathPrefix) {
    let orderedCounter = 0;
    items.forEach((item, i) => {
      let displayNumber = null;
      if (item.ordered) {
        orderedCounter = item.startValue != null ? item.startValue : orderedCounter + 1;
        displayNumber = orderedCounter;
      }
      const id = headingId !== null ? `${headingId}:${pathPrefix}${i}` : null;
      rows.push({ rowType: 'list-item', id, item, depth, heading: headingNode, displayNumber });
      for (const nestedList of item.children || []) {
        flattenListItems(nestedList.items, headingNode, headingId, depth + 1, `${id}.`);
      }
    });
  }

  function flattenBody(bodyNodes, headingNode, headingId, depth) {
    for (const node of bodyNodes || []) {
      if (node.type === 'list') {
        flattenListItems(node.items, headingNode, headingId, depth, '');
      } else {
        rows.push({ rowType: node.type, node, depth, heading: headingNode });
      }
    }
  }

  function walk(nodes, depth) {
    for (const node of nodes) {
      if (node.type !== 'heading') continue;
      const id = idByNode ? idByNode.get(node) : null;
      const hasChildren = (node.children && node.children.length > 0) || (node.body && node.body.length > 0);
      rows.push({ rowType: 'heading', id, node, depth, hasChildren });

      if (!node.collapsed) {
        flattenBody(node.body, node, id, depth + 1);
        walk(node.children, depth + 1);
      }
    }
  }

  walk(doc.children, 0);
  return rows;
}

// ---- gesture handlers ---------------------------------------------------

/** Tap-a-chevron: flips a heading's fold state. Returns the new value. */
function toggleFold(heading) {
  heading.collapsed = !heading.collapsed;
  return heading.collapsed;
}

/** Tap-the-TODO-badge: advances a heading's TODO state using whichever
 *  sequence applies (file's own #+TODO: line, else `globalDefault`). */
function cycleHeadingTodo(doc, heading, globalDefault, opts) {
  const sequence = resolveTodoSequence(doc, globalDefault);
  return cycleTodoState(heading, sequence, opts);
}

/**
 * Tap-a-checkbox: cycles a list item's checkbox state AND patches the
 * owning heading's raw `bodyLines` so the change actually survives
 * serialization — mutating `item.checkbox` alone would be invisible to
 * serializeOrg, which reads bodyLines, not the derived body tree. Requires
 * `item.lineIndex` (set by body-parser.js) to know which raw line to patch.
 */
function cycleItemCheckbox(heading, item) {
  if (item.checkbox === null) {
    throw new Error('cycleItemCheckbox: item has no checkbox to cycle');
  }
  const idx = CHECKBOX_CYCLE.indexOf(item.checkbox);
  const next = CHECKBOX_CYCLE[((idx === -1 ? 0 : idx) + 1) % CHECKBOX_CYCLE.length];
  item.checkbox = next;

  if (typeof item.lineIndex === 'number' && heading.bodyLines[item.lineIndex] !== undefined) {
    heading.bodyLines[item.lineIndex] = heading.bodyLines[item.lineIndex].replace(
      /\[([ xX-])\]/,
      `[${next}]`
    );
  }

  return next;
}

export {
  flattenVisibleRows,
  toggleFold,
  cycleHeadingTodo,
  cycleItemCheckbox,
};
