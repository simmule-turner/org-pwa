// Extracted from app.js: render.
import { findContainer } from '../src/archive-model.js';
import { findHeadingLineNumber, serializeHeadingSubtree, serializeOrg } from '../src/org-parser.js';
import { flattenVisibleRows } from '../src/outline-view-model.js';
import { collectSubtreeHeadings } from '../src/refile.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';
import { renderAgendaView, renderTaskListView } from './agenda-view.js';
import { S } from './app-state.js';
import { renderMinibuffer, renderModeline, syncContentOffset } from './chrome.js';
import { GLOBAL_TODO_DEFAULT } from './constants.js';
import { outlineEl, saveBtnEl } from './dom.js';
import { applyPendingCursorPosition, setStatus } from './editing.js';
import { maybeRestoreNarrowState, widen, widenSparseSearch } from './gestures-structure.js';
import { syncExtraMenuButtonVisibility } from './menus.js';
import { renderRow, syncSidePanel } from './row-render.js';
import { renderTabBar } from './tabs.js';
import { VH_UNIT, isWideLayout, menuButton, tableActionButton } from './ui-widgets.js';

export function render() {
  updateSaveButtonState();
  renderTabBar();
  syncSidePanel();
  syncExtraMenuButtonVisibility();
  renderMinibuffer();
  renderModeline();
  syncContentOffset();

  const wide = isWideLayout();
  // renderSettingsView()/renderDocsView()/renderHistoryPanel() own
  // #outline while showing — but only on a narrow layout; on a wide
  // one, syncSidePanel above already routed them to #sidePanel
  // instead, so #outline should keep rendering normally below rather
  // than being replaced too.
  if (S.settingsOpen && !wide) return;
  if (S.historyOpen && !wide) return;

  if (!S.state.doc) {
    outlineEl.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Open an .org file to get started.';
    outlineEl.appendChild(empty);
    return;
  }

  maybeRestoreNarrowState();

  if (S.currentView === 'text') {
    const existingTextarea = document.getElementById('document-text-edit-input');
    if (existingTextarea && existingTextarea.parentElement === outlineEl) {
      // Already showing the text editor with the person's own,
      // possibly-unsaved edits sitting in it -- leave it completely
      // alone. Rebuilding it here from state.doc (stale until the
      // person explicitly switches away, which commits first) would
      // silently discard whatever they've typed but not yet saved.
      // Only the read-only flag is synced: toggling read-only while
      // already in Text view otherwise never reached this textarea.
      existingTextarea.readOnly = S.isBufferReadOnly;
      return;
    }
    outlineEl.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'panel-row';
    toolbar.style.padding = '6px 10px';
    toolbar.style.borderBottom = '0.5px solid var(--border)';
    toolbar.appendChild(
      tableActionButton('Select All', () => {
        textarea.focus();
        textarea.select();
      })
    );
    toolbar.appendChild(
      tableActionButton('Copy All', async () => {
        try {
          await navigator.clipboard.writeText(textarea.value);
          setStatus('Copied to clipboard.');
        } catch {
          // navigator.clipboard can fail or be unavailable (a non-secure
          // context, a browser without support, permission denied) --
          // fall back to selecting the text so the device's own native
          // Copy (from the OS selection toolbar that appears) still works,
          // one step short of fully automatic but never a dead end.
          textarea.focus();
          textarea.select();
          setStatus('Text selected \u2014 use your device\u2019s own Copy.');
        }
      })
    );
    outlineEl.appendChild(toolbar);

    const textarea = document.createElement('textarea');
    textarea.id = 'document-text-edit-input';
    const fullText = S.narrowedHeading ? serializeHeadingSubtree(S.narrowedHeading) : serializeOrg(S.state.doc);
    textarea.value = fullText;
    textarea.readOnly = S.isBufferReadOnly;
    textarea.style.width = '100%';
    textarea.style.boxSizing = 'border-box';
    textarea.style.height = VH_UNIT === 'dvh' ? 'calc(100dvh - 204px)' : 'calc(100vh - 204px)';
    textarea.style.font = 'ui-monospace, monospace';
    textarea.style.fontSize = '13px';
    textarea.style.padding = '10px';
    textarea.style.border = 'none';
    textarea.spellcheck = false;
    outlineEl.appendChild(textarea);

    if (S.narrowedHeading) {
      // The splice-back boundary: fixed here, once, BEFORE any editing
      // happens -- not re-derived from the edited text later, which is
      // exactly what makes this safe even if the person promotes the
      // heading, retypes its own level, or adds a whole new heading
      // inside the fragment while editing (see narrowedTextModeRange's
      // own doc comment for the full reasoning).
      S.narrowedTextModeRange = {
        startLine: findHeadingLineNumber(S.state.doc, S.narrowedHeading),
        lineCount: fullText.split('\n').length,
      };
      textarea.scrollTop = 0;
      textarea.setSelectionRange(0, 0);
      queueMicrotask(() => {
        textarea.focus();
        textarea.scrollTop = 0;
      });
      return;
    }
    S.narrowedTextModeRange = null;

    // Land near wherever the person last explicitly navigated to
    // (a search result, an internal link) rather than always resetting
    // to the top of the file -- losing that context on every switch
    // into the plain-text editor was the actual complaint this fixes.
    // findHeadingLineNumber returns -1 for a stale reference (the
    // heading was deleted, or nothing was ever navigated to this
    // session), which falls through to the original top-of-file
    // behavior below.
    const lines = fullText.split('\n');
    const targetLine = S.currentContextHeading ? findHeadingLineNumber(S.state.doc, S.currentContextHeading) : -1;

    if (targetLine >= 0) {
      let charOffset = 0;
      for (let i = 0; i < targetLine; i++) charOffset += lines[i].length + 1; // +1 for the newline each line consumed
      textarea.setSelectionRange(charOffset, charOffset);
      // Scroll proportionally to the target line's fraction of the
      // total line count -- an approximation, not an exact per-line
      // pixel position (which would need the textarea's actual
      // rendered line height, itself variable once a long line wraps).
      // "Near the same line" is the actual goal here, not pixel-exact
      // positioning.
      queueMicrotask(() => {
        textarea.focus();
        const fraction = targetLine / Math.max(1, lines.length - 1);
        textarea.scrollTop = fraction * (textarea.scrollHeight - textarea.clientHeight);
      });
      return;
    }

    // Setting .value moves the caret to the end of the text by default in
    // most browsers, and focus() scrolls to keep the caret in view — that
    // combination is exactly why text mode used to open scrolled all the
    // way to the bottom of the file instead of the top. Explicitly
    // resetting both the selection and the scroll position fixes it.
    textarea.scrollTop = 0;
    textarea.setSelectionRange(0, 0);
    queueMicrotask(() => {
      textarea.focus();
      textarea.scrollTop = 0; // re-assert: some browsers scroll-to-caret again on focus
    });
    return;
  }

  if (S.currentView === 'agenda') {
    renderAgendaView();
    return;
  }

  if (S.currentView === 'tasklist') {
    renderTaskListView();
    return;
  }

  const rows = flattenVisibleRows(S.state.doc);
  if (rows.length === 0) {
    outlineEl.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Empty file \u2014 no headings yet.';
    outlineEl.appendChild(empty);
    return;
  }

  // While a heading's combined body text is being edited as one block
  // (editingHeadingText), ALL of its body content — list items,
  // paragraphs, tables, blocks, everything — is covered by that one
  // editor, not just paragraphs. Every body-content row carries a
  // `.heading` reference to its owning heading, so this hides exactly the
  // rows that belong to the heading being edited, without touching a
  // sub-heading's own content (which has its own `.heading` reference).
  const visibleRows = S.editingHeadingText
    ? rows.filter((r) => r.rowType === 'heading' || r.heading !== S.editingHeadingText)
    : rows;

  // Narrowing restricts which rows are shown at all -- a display-only
  // filter, never touching state.doc itself (see narrowedHeading's own
  // doc comment). Re-validated fresh here, every render, rather than
  // trusted blindly: if the narrowed heading was deleted since narrowing
  // (directly, or as part of a deleted ancestor), this auto-widens
  // instead of rendering nothing with no way back.
  if (S.narrowedHeading && !findContainer(S.state.doc, S.narrowedHeading)) {
    S.narrowedHeading = null;
  }
  const narrowedVisibleRows = S.narrowedHeading
    ? (() => {
        const subtreeHeadings = collectSubtreeHeadings(S.narrowedHeading);
        return visibleRows.filter((r) => subtreeHeadings.has(r.rowType === 'heading' ? r.node : r.heading));
      })()
    : visibleRows;

  // Sparse-search narrowing: an additional, independent filter step,
  // composing with narrowedHeading's own filter above rather than
  // replacing it. Re-validated fresh here, every render, the same as
  // narrowedHeading itself: if every one of the scope's own headings has
  // since been deleted, this auto-widens instead of rendering an empty
  // outline with no way back.
  const sparseFilteredRows = S.sparseNarrowScope
    ? narrowedVisibleRows.filter((r) => S.sparseNarrowScope.visible.has(r.rowType === 'heading' ? r.node : r.heading))
    : narrowedVisibleRows;
  if (S.sparseNarrowScope && sparseFilteredRows.length === 0) {
    S.sparseNarrowScope = null;
  }
  const finalVisibleRows = S.sparseNarrowScope ? sparseFilteredRows : narrowedVisibleRows;

  const todoSequence = resolveTodoSequence(S.state.doc, GLOBAL_TODO_DEFAULT);

  // Build the new row elements off-DOM (a DocumentFragment has no layout
  // box, so appending into it triggers no reflow), then swap the whole
  // thing into the live container in one operation, instead of clearing
  // outlineEl and appendChild-ing each row directly onto an already
  // on-screen, already-laid-out element.
  const fragment = document.createDocumentFragment();
  for (const row of finalVisibleRows) fragment.appendChild(renderRow(row, todoSequence));
  outlineEl.innerHTML = '';
  outlineEl.appendChild(fragment);

  if (S.narrowedHeading) {
    const banner = document.createElement('div');
    banner.className = 'panel-row';
    banner.style.background = 'var(--surface)';
    banner.style.borderBottom = '0.5px solid var(--border)';
    banner.style.padding = '6px 10px';
    banner.style.fontSize = '13px';
    banner.style.display = 'flex';
    banner.style.alignItems = 'center';
    banner.style.gap = '8px';

    const label = document.createElement('span');
    label.style.flex = '1';
    label.style.minWidth = '0';
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';
    label.style.whiteSpace = 'nowrap';
    label.textContent = `Narrowed to: ${S.narrowedHeading.title || '(untitled)'}`;
    banner.appendChild(label);

    banner.appendChild(menuButton('Widen', () => widen()));
    outlineEl.insertBefore(banner, outlineEl.firstChild);
  }

  if (S.sparseNarrowScope) {
    const banner = document.createElement('div');
    banner.className = 'panel-row';
    banner.style.background = 'var(--surface)';
    banner.style.borderBottom = '0.5px solid var(--border)';
    banner.style.padding = '6px 10px';
    banner.style.fontSize = '13px';
    banner.style.display = 'flex';
    banner.style.alignItems = 'center';
    banner.style.gap = '8px';

    const label = document.createElement('span');
    label.style.flex = '1';
    label.style.minWidth = '0';
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';
    label.style.whiteSpace = 'nowrap';
    const matchCount = S.sparseNarrowScope.matched.size;
    label.textContent = `Narrowed to search: ${matchCount} heading${matchCount === 1 ? '' : 's'}`;
    banner.appendChild(label);

    banner.appendChild(menuButton('Widen', () => widenSparseSearch()));
    outlineEl.insertBefore(banner, outlineEl.firstChild);
  }

  if (S.editingCell) {
    queueMicrotask(() => {
      const input = document.getElementById('cell-edit-input');
      if (input) {
        input.focus();
        applyPendingCursorPosition(input);
      }
    });
  }
}

/** Single source of truth for the filename display, including the
 *  "modified" indicator — called from render() itself (so it's always
 *  current on every render, without needing every call site that changes
 *  state.documentId/storageKind/isDirty to separately remember to update
 *  it) rather than being set ad hoc in half a dozen different places. */
export function updateSaveButtonState() {
  saveBtnEl.disabled = !S.state.doc || !S.state.storageKind || S.state.storageKind === 'help';
  saveBtnEl.style.color = !saveBtnEl.disabled && S.isDirty ? '#c0392b' : '';
}
