
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

import { resolveTodoSequence, cycleTodoState } from './todo-cycle.js';

const CHECKBOX_CYCLE_SIMPLE = [' ', 'X'];
const CHECKBOX_CYCLE_WITH_CHILDREN = [' ', '-', 'X'];

/**
 * Flattens `doc` into a linear row array respecting two independent
 * per-heading visibility flags: `collapsed` (a collapsed heading's
 * children — sub-headings AND body content — are omitted entirely, not
 * just visually hidden, matching what a virtualized list needs) and
 * `bodyHidden` (this heading's own body content specifically, independent
 * of whether its child headings show — this is what makes #+STARTUP:
 * content's "unfold every heading, hide body text" distinct from
 * showall/showeverything's "unfold everything, body text included").
 * A heading can be expanded with its body hidden; its children's own
 * visibility is governed by their own `collapsed`/`bodyHidden`, not by
 * this heading's `bodyHidden`.
 *
 * Every body-content row (list-item, paragraph, table, block) carries a
 * `heading` reference to its owning heading node — needed by any editing
 * operation that has to splice that heading's `bodyLines` (see
 * body-edit.js), so callers never have to re-derive "which heading does
 * this row belong to" by searching.
 *
 * Rows carry a `key` (a plain positional path string, e.g. "0.2.1") for
 * use as a rendering key (React-style list keys, DOM diffing, etc.) —
 * this is NOT a stable cross-session identity the way an earlier
 * version's hashed `id` was; it's only meant to be unique *within one
 * render* of one document. Callers needing to act on a specific
 * node/item hold the live object reference itself (row.node / row.item),
 * not this key.
 *
 * Row shapes:
 *   { rowType: 'heading', key, node, depth, hasChildren }
 *   { rowType: 'list-item', key, item, depth, heading, displayNumber }
 *   { rowType: 'paragraph' | 'table' | 'block', key, node, depth, heading }
 *
 * `displayNumber` is the item's position for rendering an ordered list's
 * numbering (null for unordered items) — computed per items-array (each
 * nested list numbers independently) and reset by a [@N] start-value
 * cookie, so callers don't need to re-derive numbering themselves.
 */
function flattenVisibleRows(doc) {
  const rows = [];

  function flattenListItems(items, headingNode, depth, keyPrefix) {
    let orderedCounter = 0;
    items.forEach((item, i) => {
      let displayNumber = null;
      if (item.ordered) {
        orderedCounter = item.startValue != null ? item.startValue : orderedCounter + 1;
        displayNumber = orderedCounter;
      }
      const key = `${keyPrefix}${i}`;
      rows.push({ rowType: 'list-item', key, item, depth, heading: headingNode, displayNumber });
      for (const nestedList of item.children || []) {
        flattenListItems(nestedList.items, headingNode, depth + 1, `${key}.`);
      }
    });
  }

  function flattenBody(bodyNodes, headingNode, depth, keyPrefix) {
    (bodyNodes || []).forEach((node, i) => {
      if (node.type === 'list') {
        flattenListItems(node.items, headingNode, depth, `${keyPrefix}${i}.`);
      } else {
        rows.push({ rowType: node.type, key: `${keyPrefix}${i}`, node, depth, heading: headingNode });
      }
    });
  }

  function walk(nodes, depth, keyPrefix) {
    nodes.forEach((node, i) => {
      if (node.type !== 'heading') return;
      const key = `${keyPrefix}${i}`;
      const hasChildren = (node.children && node.children.length > 0) || (node.body && node.body.length > 0);
      rows.push({ rowType: 'heading', key, node, depth, hasChildren });

      if (!node.collapsed) {
        if (!node.bodyHidden) flattenBody(node.body, node, depth + 1, `${key}.b`);
        walk(node.children, depth + 1, `${key}.`);
      }
    });
  }

  walk(doc.children, 0, '');
  return rows;
}

// ---- gesture handlers ---------------------------------------------------

/**
 * Tap-a-chevron: flips a heading's fold state. Returns the new value.
 *
 * When this expands a heading (collapsed: true -> false), it also clears
 * bodyHidden for that heading. This is the fix for a real bug: bodyHidden
 * is only ever set by applyStartupVisibility (from #+STARTUP: content),
 * and nothing else ever cleared it — so a heading with only body content
 * and no sub-headings (the majority of headings in a typical file: a
 * journal entry, a note, a health-metrics table) could never have its
 * content revealed at all. Toggling `collapsed` alone produced literally
 * no visible change for such a heading, because body was hidden either
 * way (bodyHidden: true) whether collapsed was true or false — there was
 * no path to ever see it. Tapping a chevron to expand a heading means
 * "let me see this" — that should include its own body text, not just
 * reveal child headings while leaving the body permanently invisible.
 * Collapsing doesn't touch bodyHidden — once revealed, a heading's body
 * stays revealed for the rest of the session even if you fold and
 * re-expand it, rather than making you re-reveal it every time.
 */
function toggleFold(heading) {
  heading.collapsed = !heading.collapsed;
  if (!heading.collapsed) heading.bodyHidden = false;
  return heading.collapsed;
}

/** Tap-the-TODO-badge: advances a heading's TODO state using whichever
 *  sequence applies (file's own #+TODO: line, else `globalDefault`). */
function cycleHeadingTodo(doc, heading, globalDefault, opts) {
  const sequence = resolveTodoSequence(doc, globalDefault);
  return cycleTodoState(heading, sequence, opts);
}

/**
 * Toggles a heading's TODO state on/off directly, rather than advancing
 * one step through the full sequence: null -> the sequence's first
 * keyword (same starting point cycling would land on), but any existing
 * state (TODO, DONE, a custom keyword — doesn't matter which) clears
 * straight back to null in one step. This is deliberately NOT the same
 * as calling cycleHeadingTodo repeatedly until it wraps back to null —
 * the "Mark as TODO" action button is meant to work as an on/off toggle,
 * not force stepping through every state in between.
 */
function toggleHeadingTodo(doc, heading, globalDefault) {
  if (heading.todo === null) {
    return cycleHeadingTodo(doc, heading, globalDefault);
  }
  heading.todo = null;
  return null;
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
  const hasNestedItems = (item.children || []).some((list) => list.items.length > 0);
  const cycle = hasNestedItems ? CHECKBOX_CYCLE_WITH_CHILDREN : CHECKBOX_CYCLE_SIMPLE;
  const idx = cycle.indexOf(item.checkbox);
  const next = cycle[((idx === -1 ? 0 : idx) + 1) % cycle.length];
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
  toggleHeadingTodo,
  cycleItemCheckbox,
};
