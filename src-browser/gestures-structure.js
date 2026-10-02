// Extracted from app.js: gestures structure.
import { findContainer, isArchivedInPlace, shiftLevels } from '../src/archive-model.js';
import { cycleFoldLevel } from '../src/fold-state.js';
import { removeHeading } from '../src/heading-edit.js';
import { getCycleOpenArchivedTrees } from '../src/local-variables.js';
import { findHeadingByOutlineKey, loadNarrowState, loadSparseNarrowState, outlineKeyForHeading, saveNarrowState, saveSparseNarrowState } from '../src/narrow-state.js';
import { parseOrg, serializeHeadingSubtree } from '../src/org-parser.js';
import { findHeadingByOutlinePath } from '../src/refile.js';
import { isDoneKeyword, resolveTodoSequence, setTodoState } from '../src/todo-cycle.js';
import { agendaStepAnchor } from './agenda-format.js';
import { S } from './app-state.js';
import { openArchiveConfirmPrompt, unarchiveHeadingToOriginalLocation } from './archive-flow.js';
import { GLOBAL_TODO_DEFAULT } from './constants.js';
import { confirmDialog } from './dialogs.js';
import { expandScopeWithAncestors, listItemDescendantCount, paragraphHasContent, tableHasContent } from './doc-helpers.js';
import { commitAndRender, setStatus } from './editing.js';
import { setKeyboardFocusToHeading } from './keyboard-focus.js';
import { outlinePathForHeadingInDocument } from './navigation.js';
import { render } from './render.js';
import { renderSearchPanel } from './search-ui.js';
import { kv } from './singletons.js';
import { applyTodoTransition } from './todo-workflow.js';
import { SWIPE_THRESHOLD_PX } from './ui-widgets.js';

export function attachSlideLeftToFold(el, heading, opts = {}) {
  const onFolded = opts.onFolded || render;
  const archiveVisibility =
    opts.archiveVisibility || (getCycleOpenArchivedTrees(S.state.localVariables) ? 'noarchived' : 'archived');
  let startX = null;
  let startY = null;
  let active = false;

  el.addEventListener('pointerdown', (e) => {
    // Don't hijack taps meant for an actual control (fold button, TODO
    // badge, title, add/delete buttons, links) — only bare row space and
    // plain text starts a swipe candidate.
    if (e.target.closest('button, a, input, textarea, [data-inline-link]')) return;
    startX = e.clientX;
    startY = e.clientY;
    active = true;
  });

  const finish = (e) => {
    if (!active) return;
    active = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const isLeftSwipe = dx < -SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.5;
    if (!isLeftSwipe) return;
    cycleFoldLevel(heading, { archiveVisibility });
    onFolded();
  };

  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', () => {
    active = false;
  });
}

export function attachSlideRightToComplete(el, heading, opts = {}) {
  const onDone = opts.onDone || (() => commitAndRender('Completed via swipe'));
  let startX = null;
  let startY = null;
  let active = false;

  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, input, textarea, [data-inline-link]')) return;
    startX = e.clientX;
    startY = e.clientY;
    active = true;
  });

  const finish = (e) => {
    if (!active) return;
    active = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const isRightSwipe = dx > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.5;
    if (!isRightSwipe) return;

    const sequence = resolveTodoSequence(S.state.doc, GLOBAL_TODO_DEFAULT);
    const hasActiveTodo = heading.todo !== null && !isDoneKeyword(heading.todo, sequence) && sequence.doneKeywords.length > 0;
    if (hasActiveTodo) {
      applyTodoTransition(heading, () => setTodoState(heading, sequence.doneKeywords[0], sequence));
      onDone();
    } else if (isArchivedInPlace(heading)) {
      unarchiveHeadingToOriginalLocation(heading);
    } else {
      openArchiveConfirmPrompt(heading);
    }
  };

  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', () => {
    active = false;
  });
}

export function attachAgendaSwipeNav(el) {
  let startX = null;
  let startY = null;
  let active = false;

  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, input, textarea, [data-inline-link]')) return;
    startX = e.clientX;
    startY = e.clientY;
    active = true;
  });

  const finish = (e) => {
    if (!active) return;
    active = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) <= SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
    S.agendaAnchorDate = agendaStepAnchor(S.agendaViewType, S.agendaAnchorDate, dx < 0 ? 1 : -1);
    render();
  };

  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', () => {
    active = false;
  });
}

export async function confirmHeadingDelete(heading) {
  const parts = [];
  if (heading.children.length) {
    parts.push(`${heading.children.length} sub-heading${heading.children.length === 1 ? '' : 's'}`);
  }
  if (heading.body.length) parts.push('notes/lists/tables');
  if (heading.todo !== null) parts.push(`its "${heading.todo}" state`);
  if (heading.priority !== null) parts.push('a priority');
  if (heading.tags && heading.tags.length) parts.push(`tags (${heading.tags.join(', ')})`);
  if (heading.propertyOrder && heading.propertyOrder.length) parts.push('properties');
  if (heading.logbookLines && heading.logbookLines.length) parts.push('a state-change/note history');
  if (heading.planning && (heading.planning.scheduled || heading.planning.deadline)) parts.push('a scheduled/deadline date');
  const title = heading.title || '(untitled)';
  const detail = parts.length > 0 ? ` It has ${parts.join(', ')}, which will be lost.` : '';
  return confirmDialog(`Delete "${title}"?${detail}`);
}

export async function cutSubtree(heading) {
  const text = serializeHeadingSubtree(heading);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    setStatus("Couldn't copy to clipboard \u2014 your browser may not allow clipboard access here. Nothing was deleted.");
    return;
  }
  S.actionMenuFor = null;
  S.editingHeading = null;
  S.editingIsNew = false;
  S.editingCell = null;
  S.editingParagraph = null;
  S.editingListItem = null;
  S.editingHeadingText = null;
  S.editingGeneral = null;
  if (S.keyboardFocusedBodyRow && S.keyboardFocusedBodyRow.heading === heading) {
    S.keyboardFocusedBodyRow = null;
    S.keyboardFocusedCellPos = null;
  }
  removeHeading(S.state.doc, heading);
  commitAndRender('Cut subtree to clipboard');
}

export async function pasteSubtree(heading) {
  if (!S.state.doc) return;
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    setStatus("Couldn't read from the clipboard \u2014 your browser may not allow clipboard access here.");
    return;
  }
  if (!text || !text.trim()) {
    setStatus('Clipboard is empty.');
    return;
  }
  const parsed = parseOrg(text);
  if (!parsed.children || parsed.children.length === 0) {
    setStatus('Clipboard doesn\u2019t contain a subtree to paste.');
    return;
  }
  const located = findContainer(S.state.doc, heading);
  if (!located) return;
  const targetLevel = heading.level;
  for (const node of parsed.children) shiftLevels(node, targetLevel);
  located.container.splice(located.index + 1, 0, ...parsed.children);
  setKeyboardFocusToHeading(parsed.children[0]);
  commitAndRender('Pasted subtree');
}

export function extraMenuTargetHeading() {
  if (S.actionMenuFor && S.state.doc && findContainer(S.state.doc, S.actionMenuFor)) return S.actionMenuFor;
  return S.keyboardFocusedHeading;
}

/** Restricts the outline to `heading` and its own subtree -- replaces
 *  any existing narrowing outright rather than stacking (matching
 *  real Emacs's own actual C-x n s: narrowing again while already
 *  narrowed just moves the restriction, there's no nested "un-narrow
 *  one level at a time" concept at all). */
export function narrowToHeading(heading) {
  S.narrowedHeading = heading;
  render();
  const outlinePath = outlinePathForHeadingInDocument(S.state.documentId, heading);
  saveNarrowState(kv, S.state.documentId, outlinePath).catch(() => {});
}

/** Removes any narrowing restriction, showing the whole document
 *  again -- real org's own C-x n w. */
export function widen() {
  S.narrowedHeading = null;
  render();
  saveNarrowState(kv, S.state.documentId, null).catch(() => {});
}

/** Narrows the outline to `matchedHeadings` (from the current document's
 *  own search results) plus their own ancestors -- an independent,
 *  additional row filter alongside narrowedHeading; see
 *  sparseNarrowScope's own doc comment above for how the two compose.
 *  Saved per document (as outline paths, like narrowedHeading), so it
 *  survives a reload. */
export function narrowToSparseMatches(matchedHeadings) {
  S.sparseNarrowScope = { matched: matchedHeadings, visible: expandScopeWithAncestors(S.state.doc, matchedHeadings) };
  const documentId = S.state.documentId;
  const keys = [...matchedHeadings].map((h) => outlineKeyForHeading(S.state.doc, h)).filter(Boolean);
  saveSparseNarrowState(kv, documentId, keys).catch(() => {});
  S.searchOpen = false;
  render();
  renderSearchPanel();
}

/** Drops the sparse-search narrow scope and its saved copy, without rendering -- for render() itself, which
 *  clears it when nothing matches any more, as well as for widenSparseSearch. Forgetting only the in-memory
 *  scope would let a stale saved copy bring a dismissed narrow back on the next reload. */
export function forgetSparseNarrow() {
  S.sparseNarrowScope = null;
  if (S.state.documentId) saveSparseNarrowState(kv, S.state.documentId, null).catch(() => {});
}

/** Clears the sparse-search narrow scope, independent of narrowedHeading
 *  (widen() above) -- widening one never affects the other. */
export function widenSparseSearch() {
  forgetSparseNarrow();
  render();
}

/** Restores Search's Narrow after a reload, from its saved outline paths. Called from render() like
 *  maybeRestoreNarrowState, with the same guards: only once per document, and a slow lookup never overrides a
 *  document change or a narrow made in the meantime. The headings are looked up in the freshly parsed
 *  document, so one that was renamed or removed simply drops out of the narrowed set. */
export function maybeRestoreSparseNarrow() {
  if (!S.state.doc || !S.state.documentId) return;
  if (S.sparseNarrowRestoreAttemptedFor === S.state.documentId) return;
  S.sparseNarrowRestoreAttemptedFor = S.state.documentId;
  const documentId = S.state.documentId;
  loadSparseNarrowState(kv, documentId)
    .then((keys) => {
      if (!keys) return;
      if (S.state.documentId !== documentId || S.sparseNarrowScope) return;
      const matched = new Set(keys.map((k) => findHeadingByOutlineKey(S.state.doc, k)).filter(Boolean));
      if (matched.size === 0) {
        saveSparseNarrowState(kv, documentId, null).catch(() => {});
        return;
      }
      S.sparseNarrowScope = { matched, visible: expandScopeWithAncestors(S.state.doc, matched) };
      render();
    })
    .catch(() => {});
}

/** Lazily restores narrowedHeading from its own reload-surviving
 *  persistence (see narrow-state.js) -- called from render() itself
 *  rather than hooked into any of the app's own several separate
 *  "a document just opened" call sites (Save As, filesystem open,
 *  GitHub/WebDAV open, startup restore), so there's no risk of
 *  missing one. The documentId guard means the actual kv lookup only
 *  ever fires once per document, not on every render() call; the two
 *  checks after the await guard against two different races: the
 *  person navigating to a different document while this was still in
 *  flight, or narrowing/widening (by any means, including an
 *  in-session tab-switch restore) before it resolved -- either way,
 *  a slow, now-stale lookup must never override what's actually true
 *  by the time it comes back. */
export function maybeRestoreNarrowState() {
  if (!S.state.doc || !S.state.documentId) return;
  if (S.narrowStateRestoreAttemptedFor === S.state.documentId) return;
  S.narrowStateRestoreAttemptedFor = S.state.documentId;
  const documentId = S.state.documentId;
  loadNarrowState(kv, documentId)
    .then((outlinePath) => {
      if (!outlinePath) return;
      if (S.state.documentId !== documentId) return;
      if (S.narrowedHeading) return;
      const heading = findHeadingByOutlinePath(S.state.doc, outlinePath);
      if (heading) {
        S.narrowedHeading = heading;
        render();
      }
    })
    .catch(() => {});
}

export async function deleteHeadingWithConfirmation(heading) {
  if (!(await confirmHeadingDelete(heading))) return;
  S.actionMenuFor = null;
  S.editingHeading = null;
  S.editingIsNew = false;
  S.editingCell = null;
  S.editingParagraph = null;
  S.editingListItem = null;
  S.editingHeadingText = null;
  S.editingGeneral = null;
  if (S.keyboardFocusedBodyRow && S.keyboardFocusedBodyRow.heading === heading) {
    S.keyboardFocusedBodyRow = null;
    S.keyboardFocusedCellPos = null;
  }
  removeHeading(S.state.doc, heading);
  commitAndRender('Deleted heading');
}

export async function confirmTableDelete(table) {
  if (!tableHasContent(table)) return true;
  return confirmDialog('Delete this table and all its data?');
}

export async function confirmParagraphDelete(paragraph) {
  if (!paragraphHasContent(paragraph)) return true;
  return confirmDialog('Delete this note?');
}

export async function confirmListItemDelete(item) {
  const count = listItemDescendantCount(item);
  const hasOwnContent = (item.text && item.text.trim() !== '') || (item.tag && item.tag.trim() !== '');
  if (count === 0 && !hasOwnContent) return true; // genuinely empty item, nothing lost either way
  if (count > 0) {
    return confirmDialog(`Delete this item? It has ${count} nested sub-item${count === 1 ? '' : 's'} that will be deleted too.`);
  }
  return confirmDialog('Delete this item?');
}
