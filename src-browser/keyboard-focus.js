// Extracted from app.js: keyboard focus.
import { findAncestorPath } from '../src/archive-model.js';
import { flattenVisibleRows } from '../src/outline-view-model.js';
import { S } from './app-state.js';
import { findListItemByLineIndex, firstDataRowIndex, hasBodyContent } from './doc-helpers.js';
import { outlineEl } from './dom.js';
import { openListItemEditor, openParagraphEditor, setStatus, startEditingTitle } from './editing.js';
import { scrollFocusedHeadingIntoView } from './render-helpers.js';
import { render } from './render.js';

/** Every heading currently visible in the outline, in on-screen order --
 *  the pool keyboard-focus navigation (j/k, arrow keys) moves through.
 *  Respects current fold state via flattenVisibleRows, the same
 *  function the outline's own rendering uses, so keyboard nav never
 *  lands on a heading that isn't actually shown. */
export function visibleHeadingsInOrder() {
  if (!S.state.doc) return [];
  return flattenVisibleRows(S.state.doc)
    .filter((row) => row.rowType === 'heading')
    .map((row) => row.node);
}

/** Moves keyboard focus by `delta` (+1/-1) among currently visible
 *  headings. No wraparound at either end -- staying put at a boundary
 *  is more predictable than silently jumping to the opposite end of a
 *  potentially long document. Scrolls the newly-focused heading into
 *  view, since it may not currently be on screen. */
/** True if `row` (one of flattenVisibleRows' own row objects) is the
 *  one keyboardFocusedHeading/keyboardFocusedBodyRow currently point
 *  at -- matched by the row's own underlying node/item identity, not
 *  the row-wrapper object itself, since flattenVisibleRows rebuilds a
 *  fresh wrapper on every single call even when the underlying AST
 *  hasn't changed at all. */
export function rowMatchesKeyboardFocus(row) {
  if (row.rowType === 'heading') return !S.keyboardFocusedBodyRow && row.node === S.keyboardFocusedHeading;
  if (!S.keyboardFocusedBodyRow || S.keyboardFocusedBodyRow.rowType !== row.rowType) return false;
  if (row.rowType === 'list-item') return row.item === S.keyboardFocusedBodyRow.item;
  return row.node === S.keyboardFocusedBodyRow.node;
}

/** Sets keyboard focus to `row` (one of flattenVisibleRows' own row
 *  objects) -- keyboardFocusedHeading is kept in sync to the row's
 *  own containing heading either way (itself, if row IS a heading;
 *  its own .heading reference otherwise), so every existing
 *  heading-specific action still has a sensible heading to act on
 *  regardless of where the line-cursor has actually drilled to.
 *  Landing on a table also initializes keyboardFocusedCellPos to its
 *  own first data row/first column -- the entry point Shift+arrow's
 *  cell-by-cell stepping (moveTableCellFocus) then moves from. */
export function setKeyboardFocusToRow(row) {
  if (row.rowType === 'heading') {
    S.keyboardFocusedHeading = row.node;
    S.keyboardFocusedBodyRow = null;
    S.keyboardFocusedCellPos = null;
  } else if (row.rowType === 'table') {
    S.keyboardFocusedHeading = row.heading;
    S.keyboardFocusedBodyRow = row;
    S.keyboardFocusedCellPos = { rowIndex: firstDataRowIndex(row.node), colIndex: 0 };
  } else {
    S.keyboardFocusedHeading = row.heading;
    S.keyboardFocusedBodyRow = row;
    S.keyboardFocusedCellPos = null;
  }
}

/** THE FIX: sets keyboard focus squarely to `heading` itself, clearing
 *  keyboardFocusedBodyRow -- every heading-only navigation action
 *  (j/k, C-c C-f/C-c C-b, C-c C-u, C-c C-n/C-c C-p, M-RET/M-S-RET, and
 *  Escape's own "clear focus"/"enter god-mode" branches) needs this,
 *  not just a bare "keyboardFocusedHeading = heading" assignment:
 *  leaving a stale keyboardFocusedBodyRow behind meant the visual
 *  highlight (and scroll-into-view) stayed stuck on wherever the
 *  line-cursor had last drilled into, since rowMatchesKeyboardFocus
 *  requires keyboardFocusedBodyRow to be null for a HEADING row to
 *  ever match -- even though keyboardFocusedHeading itself really was
 *  being updated correctly. This is what made C-c C-n/C-c C-p (and
 *  friends) look like they weren't moving at all while focus was on
 *  body text. `heading` may be null (Escape's own "clear focus
 *  entirely" case). */
export function setKeyboardFocusToHeading(heading) {
  S.keyboardFocusedHeading = heading;
  S.keyboardFocusedBodyRow = null;
  S.keyboardFocusedCellPos = null;
}

/** Moves the line-cursor to the adjacent VISIBLE row -- headings,
 *  paragraphs, tables, list items, and blocks alike, in document
 *  order, respecting current fold state exactly the way
 *  flattenVisibleRows itself already does. This is the "navigate to
 *  all visible lines in the buffer" feature: plain Up/Down (both
 *  outside and inside god-mode) move through EVERY visible row, not
 *  just headings the way j/k (unchanged, kept as a faster
 *  heading-to-heading jump) already do. */
export function moveLineFocus(delta) {
  if (!S.state.doc) return;
  // Moving down into a heading whose own body is currently folded --
  // reveal it first, so the row-walk below naturally lands on its
  // own first body row next, instead of skipping straight past to
  // the next heading the way a fold-respecting walk otherwise would.
  if (delta > 0 && !S.keyboardFocusedBodyRow && S.keyboardFocusedHeading && S.keyboardFocusedHeading.bodyHidden && hasBodyContent(S.keyboardFocusedHeading)) {
    S.keyboardFocusedHeading.bodyHidden = false;
  }
  const rows = flattenVisibleRows(S.state.doc);
  if (rows.length === 0) return;
  const currentIndex = rows.findIndex(rowMatchesKeyboardFocus);
  let nextIndex;
  if (currentIndex === -1) {
    nextIndex = delta > 0 ? 0 : rows.length - 1;
  } else {
    nextIndex = Math.max(0, Math.min(rows.length - 1, currentIndex + delta));
    if (nextIndex === currentIndex) {
      setStatus(delta > 0 ? 'Already at the last line.' : 'Already at the first line.');
      return;
    }
  }
  setKeyboardFocusToRow(rows[nextIndex]);
  render();
  scrollFocusedHeadingIntoView();
}

export function moveTableCellFocus(deltaRow, deltaCol) {
  if (!S.keyboardFocusedBodyRow || S.keyboardFocusedBodyRow.rowType !== 'table' || !S.keyboardFocusedCellPos) return;
  const table = S.keyboardFocusedBodyRow.node;
  const dataRowIndices = table.rows.map((r, i) => i).filter((i) => table.rows[i].type !== 'rule');
  const colCount = Math.max(1, ...table.rows.filter((r) => r.type !== 'rule').map((r) => r.cells.length));
  let { rowIndex, colIndex } = S.keyboardFocusedCellPos;

  if (deltaRow !== 0) {
    const currentPos = dataRowIndices.indexOf(rowIndex);
    const nextPos = Math.max(0, Math.min(dataRowIndices.length - 1, currentPos + deltaRow));
    if (dataRowIndices[nextPos] === rowIndex) {
      setStatus(deltaRow > 0 ? 'Already at the last row.' : 'Already at the first row.');
      return;
    }
    rowIndex = dataRowIndices[nextPos];
  }
  if (deltaCol !== 0) {
    const nextCol = Math.max(0, Math.min(colCount - 1, colIndex + deltaCol));
    if (nextCol === colIndex) {
      setStatus(deltaCol > 0 ? 'Already at the last column.' : 'Already at the first column.');
      return;
    }
    colIndex = nextCol;
  }
  S.keyboardFocusedCellPos = { rowIndex, colIndex };
  render();
  scrollFocusedHeadingIntoView();
}

/** The "i" dispatcher -- enters insert/edit mode for whatever the
 *  line-cursor currently points at, reusing each row type's own
 *  existing structured-editing entry point rather than building a
 *  new one: a heading's own title (startEditingTitle), a paragraph
 *  (editingParagraph), a table cell (editingCell, at the current
 *  sub-line's own row, column 0 -- there's no column-level
 *  navigation, only row-by-row per the explicit request), or a list
 *  item (editingListItem). A "block" row (#+BEGIN_SRC etc.) has no
 *  structured edit UI at all in this app -- read-only, requires Text
 *  view -- so "i" there is a deliberate no-op matching that existing,
 *  already-documented limitation, not a silent failure.
 *
 *  pendingCursorPosition (set by a/e beforehand -- see GOD_MODE_ACTIONS'
 *  own 'C-a'/'C-e' entries) is consumed here: 'start' or 'end'
 *  positions the resulting input's own cursor there once the shared
 *  post-render focus logic (see render()'s own queueMicrotask) picks
 *  it up; unset defaults to 'start', per the explicit request that
 *  "i" alone (no a/e first) inserts at the beginning of the line. */
export function enterInsertModeAtCurrentLine() {
  S.pendingCursorPosition = S.pendingCursorPosition || 'start';
  if (!S.keyboardFocusedBodyRow) {
    if (S.keyboardFocusedHeading) startEditingTitle(S.keyboardFocusedHeading, false);
    return;
  }
  const row = S.keyboardFocusedBodyRow;
  if (row.rowType === 'paragraph') {
    S.editingParagraph = { heading: row.heading, paragraph: row.node };
    render();
    openParagraphEditor(row.heading, row.node);
  } else if (row.rowType === 'table') {
    const rowIndex = S.keyboardFocusedCellPos ? S.keyboardFocusedCellPos.rowIndex : 0;
    const colIndex = S.keyboardFocusedCellPos ? S.keyboardFocusedCellPos.colIndex : 0;
    S.editingCell = { heading: row.heading, table: row.node, rowIndex, colIndex };
    render();
  } else if (row.rowType === 'list-item') {
    S.editingListItem = { heading: row.heading, item: row.item };
    render();
    openListItemEditor(row.heading, row.item);
  }
  // 'block'/'hr': no structured edit UI exists for either -- no-op.
}

export function moveKeyboardFocus(delta) {
  const headings = visibleHeadingsInOrder();
  if (headings.length === 0) return;
  const currentIndex = S.keyboardFocusedHeading ? headings.indexOf(S.keyboardFocusedHeading) : -1;
  let nextIndex;
  if (currentIndex === -1) {
    nextIndex = delta > 0 ? 0 : headings.length - 1;
  } else {
    nextIndex = Math.max(0, Math.min(headings.length - 1, currentIndex + delta));
    if (nextIndex === currentIndex) {
      setStatus(delta > 0 ? 'Already at the last heading.' : 'Already at the first heading.');
      return;
    }
  }
  setKeyboardFocusToHeading(headings[nextIndex]);
  render();
  scrollFocusedHeadingIntoView();
}

/** Moves keyboard focus to the next/previous VISIBLE heading at the
 *  SAME level as the currently focused one -- real org's own
 *  org-forward-heading-same-level / org-backward-heading-same-level
 *  (god-mode's own C-c C-f / C-c C-b). Stops without moving if a
 *  shallower-level heading is reached first, since that means we've
 *  left the current heading's own region entirely. No-op if nothing
 *  is currently focused. */
export function moveToSameLevelHeading(delta) {
  if (!S.keyboardFocusedHeading) return;
  const headings = visibleHeadingsInOrder();
  const currentIndex = headings.indexOf(S.keyboardFocusedHeading);
  if (currentIndex === -1) return;
  const level = S.keyboardFocusedHeading.level;
  for (let i = currentIndex + delta; i >= 0 && i < headings.length; i += delta) {
    if (headings[i].level < level) {
      setStatus(delta > 0 ? 'No next heading at this level.' : 'No previous heading at this level.');
      return;
    }
    if (headings[i].level === level) {
      setKeyboardFocusToHeading(headings[i]);
      render();
      scrollFocusedHeadingIntoView();
      return;
    }
  }
  setStatus(delta > 0 ? 'No next heading at this level.' : 'No previous heading at this level.');
}

/** Moves keyboard focus to the current heading's own immediate
 *  parent -- real org's own org-up-heading (god-mode's own C-c
 *  C-u). No-op if nothing is currently focused at all; reports via
 *  setStatus if focus IS on something but it's already top-level
 *  (no parent to move to) -- see this file's own broader "report a
 *  boundary rather than clamping silently" pass for why the two
 *  cases are treated differently. */
export function moveToParentHeading() {
  if (!S.keyboardFocusedHeading || !S.state.doc) return;
  const path = findAncestorPath(S.state.doc, S.keyboardFocusedHeading);
  if (!path || path.length === 0) {
    setStatus('Already at the top level.');
    return;
  }
  setKeyboardFocusToHeading(path[path.length - 1]);
  render();
  scrollFocusedHeadingIntoView();
}

/** THE FIX: re-syncs keyboardFocusedBodyRow to freshly-parsed body
 *  content after an edit that reparsed heading.body from scratch --
 *  see this section's own docs above for the full mechanics. Handles
 *  all three drillable-into row types (paragraph, table, list-item),
 *  matched by lineIndex -- an in-place edit doesn't move where the
 *  content itself starts within the heading's own body. No-op if
 *  keyboard focus wasn't actually on `oldRowType`-at-`oldLineIndex`
 *  to begin with. */
export function resyncKeyboardFocusToBodyRow(heading, oldRowType, oldLineIndex) {
  if (!S.keyboardFocusedBodyRow || S.keyboardFocusedBodyRow.heading !== heading || S.keyboardFocusedBodyRow.rowType !== oldRowType) return;
  if (oldRowType === 'list-item') {
    if (S.keyboardFocusedBodyRow.item.lineIndex !== oldLineIndex) return;
    const freshItem = findListItemByLineIndex((heading.body || []).filter((n) => n.type === 'list').flatMap((n) => n.items), oldLineIndex);
    if (freshItem) S.keyboardFocusedBodyRow = { ...S.keyboardFocusedBodyRow, item: freshItem };
    return;
  }
  if (S.keyboardFocusedBodyRow.node.lineIndex !== oldLineIndex) return;
  const freshNode = (heading.body || []).find((node) => node.type === oldRowType && node.lineIndex === oldLineIndex);
  if (freshNode) S.keyboardFocusedBodyRow = { ...S.keyboardFocusedBodyRow, node: freshNode };
}

/** Wraps a body-mutating operation that adds new, unrelated content to
 *  `heading` (so keyboard focus, if it was on some OTHER existing row
 *  in the same heading at the time, doesn't get silently orphaned the
 *  same way resyncKeyboardFocusToBodyRow's own docs describe above)
 *  -- captures whichever row/item keyboard focus is currently on
 *  (only if it actually belongs to `heading`) before running
 *  `mutate`, then re-syncs it afterward. Returns whatever `mutate`
 *  itself returns, so this can wrap a call whose own return value the
 *  caller still needs (e.g. a newly-inserted node). */
export function withKeyboardFocusPreserved(heading, mutate) {
  const prior =
    S.keyboardFocusedBodyRow && S.keyboardFocusedBodyRow.heading === heading
      ? {
          rowType: S.keyboardFocusedBodyRow.rowType,
          lineIndex: S.keyboardFocusedBodyRow.rowType === 'list-item' ? S.keyboardFocusedBodyRow.item.lineIndex : S.keyboardFocusedBodyRow.node.lineIndex,
        }
      : null;
  const result = mutate();
  if (prior) resyncKeyboardFocusToBodyRow(heading, prior.rowType, prior.lineIndex);
  return result;
}

/** Applies the keyboard-focus visual highlight to `el` if `row` is
 *  the one currently focused -- the same outline styling every row
 *  type shares, factored out here since keyboard focus can now land
 *  on any visible row (not just headings), and every one of this
 *  function's own callers needs the identical treatment. */
export function applyKeyboardFocusHighlight(el, row) {
  if (!rowMatchesKeyboardFocus(row)) return;
  el.id = 'keyboard-focused-row';
  el.style.outline = '2px solid var(--accent)';
  el.style.outlineOffset = '-2px';
  el.style.borderRadius = '4px';
}

export function clearStaleKeyboardFocusIfClickedElsewhere(e) {
  // A fresh edit session may have already started -- and already
  // rendered once, correctly -- as part of THIS SAME click, if it
  // landed on a button whose own handler runs before this listener
  // (element-level handlers fire before the click bubbles up here).
  // Re-rendering again in that case would tear down the just-created,
  // about-to-be-focused input right as the platform's own virtual
  // keyboard/IME is establishing focus and composition on it. The
  // cleanup below still correctly fires on the NEXT click instead.
  if (S.editingGeneral) return;
  // Only clicks landing within the document content area itself are
  // relevant here -- tapping the File menu, tab bar, or other app
  // chrome is about navigating away entirely, not "clicked elsewhere
  // within the document," and shouldn't discard keyboard focus before
  // a tab switch's own session snapshot gets a chance to save it.
  if (!outlineEl.contains(e.target)) return;
  const onCell = !!e.target.closest('td');
  const onHeadingTitle = !!e.target.closest('.heading-title');
  let changed = false;
  if (!onCell && (S.keyboardFocusedBodyRow || S.keyboardFocusedCellPos)) {
    S.keyboardFocusedBodyRow = null;
    S.keyboardFocusedCellPos = null;
    changed = true;
  }
  if (!onCell && !onHeadingTitle && S.keyboardFocusedHeading) {
    S.keyboardFocusedHeading = null;
    changed = true;
  }
  if (changed) render(); // avoid a pointless re-render on every ordinary click that has nothing to clear
}
