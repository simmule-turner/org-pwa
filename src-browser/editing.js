// Extracted from app.js: editing.
import { editListItemText, editParagraphText } from '../src/body-edit.js';
import { saveDocument } from '../src/document-store.js';
import { applyStartupVisibility } from '../src/fold-state.js';
import { mergeGlobalAndLocalVariables } from '../src/global-variables.js';
import { removeHeading, renameHeading } from '../src/heading-edit.js';
import { savePersistedHistory } from '../src/history-store.js';
import { getCycleOpenArchivedTrees, parseLocalVariables } from '../src/local-variables.js';
import { saveNarrowState } from '../src/narrow-state.js';
import { findHeadingAtLine, parseOrg, serializeHeadingSubtree, serializeOrg } from '../src/org-parser.js';
import { resolveEffectiveStartupConfig } from '../src/startup-config.js';
import { canRedo, canUndo, currentEntry, jumpTo, pushSnapshot, redo, undo } from '../src/undo-history.js';
import { syncAgendaFilesConfig, syncContactsFilesConfig } from './agenda-files.js';
import { S } from './app-state.js';
import { openTextFieldPopup } from './dialogs.js';
import { statusEl } from './dom.js';
import { reconcileReadOnlyAfterReparse } from './god-mode-palette.js';
import { resyncKeyboardFocusToBodyRow } from './keyboard-focus.js';
import { outlinePathForHeadingInDocument } from './navigation.js';
import { renderDiffView } from './render-helpers.js';
import { render } from './render.js';
import { kv, textModeLastCommittedValue } from './singletons.js';
import { renderLogNotePrompt } from './todo-workflow.js';
import { menuButton } from './ui-widgets.js';

export function setStatus(text) {
  statusEl.innerHTML = '';
  const isBusy = /\u2026$/.test(text);
  statusEl.classList.toggle('status--busy', isBusy);
  if (isBusy) {
    const spinner = document.createElement('span');
    spinner.className = 'status-spinner';
    statusEl.appendChild(spinner);
  }
  statusEl.appendChild(document.createTextNode(text));
}

/** The heading action menu's own "Edit title" entry point, and also
 *  new-heading creation's own initial-title entry point (isNew, via
 *  editingIsNew) -- same modal either way, per direct request. Reuses
 *  cancelTitleEdit/commitTitleEdit directly as this modal's own
 *  callbacks; both already correctly encapsulate the isNew-aware
 *  "discard an empty new heading entirely" logic, so it isn't
 *  duplicated here. */
/** The list item action menu's own "Edit text" entry point (also used
 *  by "Add item below" and the generic "i" keyboard shortcut, both of
 *  which set editingListItem then call this same function). Commits
 *  whatever's typed on OK, even if empty -- matching the old inline
 *  editor's own existing behavior exactly; list items, unlike new
 *  headings, never had a "discard if left empty" special case, so
 *  this isn't introducing new behavior here. */
/** The paragraph action menu's own "Edit text" entry point (also used
 *  by "Add paragraph below" and the "i" keyboard shortcut). */
/** Applies (and clears) pendingCursorPosition to `textarea` -- the
 *  god-mode "a"/"e" then "i" feature (position the cursor at the
 *  start/end of the field about to be entered), which only these four
 *  editors' own modals ever need to honor; openTextFieldPopup itself
 *  stays unaware of this narrower concept, since none of its other
 *  callers (Settings' own Menu labels, WebDAV, etc.) have any use for
 *  it. Called after openTextFieldPopup already focused the textarea,
 *  same "the field is already focused, only the cursor's own position
 *  within it changes" ordering the old inline editors' own version of
 *  this used. */
export function applyPendingCursorPosition(textarea) {
  if (typeof textarea.setSelectionRange === 'function') {
    const pos = S.pendingCursorPosition === 'start' ? 0 : textarea.value.length;
    textarea.setSelectionRange(pos, pos);
  }
  S.pendingCursorPosition = null;
}

export function openParagraphEditor(heading, paragraph) {
  const originalText = paragraph.lines.join('\n');
  const overlay = openTextFieldPopup({
    label: 'Edit paragraph',
    value: originalText,
    resetInPlace: true,
    onCancel: () => {
      S.editingParagraph = null;
      render();
    },
    onSave: (newText) => {
      S.editingParagraph = null;
      editParagraphText(heading, paragraph, newText);
      resyncKeyboardFocusToBodyRow(heading, 'paragraph', paragraph.lineIndex);
      commitAndRender('Edited paragraph text');
    },
  });
  overlay.id = 'paragraph-edit-popup';
  applyPendingCursorPosition(overlay.querySelector('textarea'));
}

export function openListItemEditor(heading, item) {
  const originalText = item.text;
  const overlay = openTextFieldPopup({
    label: 'Edit list item',
    value: originalText,
    resetInPlace: true,
    onCancel: () => {
      S.editingListItem = null;
      render();
    },
    onSave: (newText) => {
      S.editingListItem = null;
      editListItemText(heading, item, newText.replace(/\n/g, ' '));
      resyncKeyboardFocusToBodyRow(heading, 'list-item', item.lineIndex);
      commitAndRender('Edited list item text');
    },
  });
  overlay.id = 'list-item-edit-popup';
  applyPendingCursorPosition(overlay.querySelector('textarea'));
}

export function openHeadingTitleEditor(heading) {
  const originalTitle = heading.title;
  const overlay = openTextFieldPopup({
    label: S.editingIsNew ? 'New heading' : 'Edit heading title',
    value: originalTitle,
    resetInPlace: true,
    onCancel: () => cancelTitleEdit(),
    onSave: (newTitle) => commitTitleEdit(newTitle),
  });
  overlay.id = 'heading-title-edit-popup';
  applyPendingCursorPosition(overlay.querySelector('textarea'));
}

export function startEditingTitle(heading, isNew) {
  if (S.isBufferReadOnly) {
    setStatus('Buffer is read-only.');
    return;
  }
  S.editingHeading = heading;
  S.editingIsNew = isNew;
  render();
  openHeadingTitleEditor(heading);
}

export function commitTitleEdit(rawValue) {
  const heading = S.editingHeading;
  if (!heading) return; // re-entrant call -- already committed (see this function's own doc note on why that can happen)
  const isNew = S.editingIsNew;
  S.editingHeading = null;
  S.editingIsNew = false;

  const sanitized = String(rawValue).replace(/[\r\n]+/g, ' ').trim();
  if (sanitized === '' && isNew) {
    // User backed out of creating a heading without typing a title —
    // discard it rather than leave an empty heading behind.
    removeHeading(S.state.doc, heading);
    commitAndRender('Discarded empty new heading');
    return;
  }
  renameHeading(heading, sanitized);
  commitAndRender(isNew ? 'Added heading' : 'Edited heading title');
}

export function cancelTitleEdit() {
  const heading = S.editingHeading;
  const isNew = S.editingIsNew;
  S.editingHeading = null;
  S.editingIsNew = false;
  if (isNew) {
    removeHeading(S.state.doc, heading);
    commitAndRender('Discarded empty new heading');
  } else {
    render();
  }
}

export async function persist() {
  await saveDocument({ documentId: S.state.documentId, doc: S.state.doc, kvAdapter: kv });
}

// The fix for "every tap feels laggy": document-store.js's whole design is
// "writes apply to the kv cache instantly, offline-safe" — but the UI was
// awaiting that write (a full serialize + two sequential IndexedDB
// transactions: doc cache + outbox) before rendering anything at all,
// which defeats the point. render() reflects the already-mutated in-memory
// doc immediately; the storage write happens after, in the background.
// Errors still surface (via status text) rather than vanishing silently.
export function persistInBackground() {
  persist().catch((err) => setStatus('Save failed: ' + err.message));
}

// Persists the current undo/redo history alongside the document itself,
// so it survives a reopen -- see history-store.js's own docstring for
// why this is a separate module/key from the document's own save.
// Unlike persistInBackground, a failure here is logged, not surfaced
// via setStatus: losing undo history is a real but much smaller loss
// than a failed document save, and shouldn't interrupt the person's
// workflow with a status message about something they didn't ask for.
export function persistHistoryInBackground() {
  if (!S.state.documentId) return;
  savePersistedHistory(kv, S.state.documentId, S.history).catch((err) => console.error('Failed to persist undo history:', err));
}

export function commitAndRender(label = 'Edited') {
  if (S.isBufferReadOnly) {
    // Reverts the caller's own already-applied in-memory mutation by
    // re-parsing the last COMMITTED snapshot, rather than leaving an
    // uncommitted, silently-lingering change on screen -- see this
    // function's own doc comment above for the full reasoning.
    const archiveVisibility = getCycleOpenArchivedTrees(S.state.localVariables) ? 'noarchived' : 'archived';
    S.state.doc = parseOrg(currentEntry(S.history).text);
    applyStartupVisibility(S.state.doc, S.state.startupConfig, archiveVisibility);
    setStatus('Buffer is read-only \u2014 change not applied.');
    render();
    return;
  }
  const previousHistory = S.history;
  S.history = pushSnapshot(S.history, serializeOrg(S.state.doc), label);
  // pushSnapshot returns the SAME history object reference, unchanged,
  // when the serialized text turned out identical to what's already
  // there (a genuine no-op edit -- e.g. opening a text field and
  // blurring it again without actually typing anything). Only mark
  // the document dirty / trigger a background save when something
  // actually changed -- otherwise the undo history and the "modified"
  // indicator disagree with each other: no new history entry, but
  // still shown as modified, confusing and simply wrong either way.
  const changed = S.history !== previousHistory;
  if (changed) S.isDirty = true;
  render();
  renderLogNotePrompt();
  if (changed) {
    persistInBackground();
    persistHistoryInBackground();
  }
}

/**
 * Restores state.doc from whichever history entry `history.index`
 * currently points at, after `history` has already been moved there
 * (by undo/redo/jumpTo) -- re-parses fresh and reapplies
 * startupConfig/localVariables, the same pattern
 * commitTextModeIfActive's own "reparse the whole doc" path already
 * uses. isDirty reflects the LANDED-ON content's actual state, not
 * just "an undo/redo/jump happened": if it exactly matches
 * lastSavedText (the most recent moment this document is known to
 * match what's confirmed saved), isDirty correctly clears, the same
 * as it would if the person had manually edited their way back to
 * identical content by hand. Undoing past every edit back to the
 * exact version already on disk genuinely doesn't need saving again --
 * claiming otherwise would be misleading, and would risk a real,
 * pointless write (or, worse, an unnecessary "resume unsaved edits?"
 * prompt on next open for content that turns out to be identical to
 * what's already there).
 *
 * Deliberately does NOT try to preserve fold state across the jump --
 * reapplying the document's own #+STARTUP visibility on every
 * undo/redo step is a stated simplification, not an oversight: the
 * alternative (matching which headings correspond to which across two
 * potentially very different trees, to carry fold state over) is real
 * complexity for a benefit that's mostly invisible day to day, and
 * "fold state resets" already matches how this app treats reopening a
 * file or switching documents elsewhere.
 */
export function restoreFromHistory() {
  const entry = currentEntry(S.history);
  const newDoc = parseOrg(entry.text);
  const rawLocalVars = parseLocalVariables(entry.text);
  const startupConfig = resolveEffectiveStartupConfig(newDoc, rawLocalVars, S.globalVariables);
  const localVariables = mergeGlobalAndLocalVariables(S.globalVariables, rawLocalVars);
  const archiveVisibility = getCycleOpenArchivedTrees(localVariables) ? 'noarchived' : 'archived';
  applyStartupVisibility(newDoc, startupConfig, archiveVisibility);
  S.state.doc = newDoc;
  S.state.startupConfig = startupConfig;
  reconcileReadOnlyAfterReparse(S.state.localVariables, localVariables);
  S.state.localVariables = localVariables;
  syncAgendaFilesConfig();
  syncContactsFilesConfig();
  // currentContextHeading DOES hold an actual heading object
  // reference, now stale -- a fresh parseOrg call always produces
  // brand new heading instances, even when re-parsing what is
  // nominally "the same" file. navigationBackStack does NOT hold any
  // such reference (just documentId/storageKind/scrollTop/view, all
  // plain data unaffected by re-parsing the CURRENT
  // document), so it's deliberately left untouched here -- clearing
  // it unconditionally used to destroy cross-document back-navigation
  // the moment a user did anything that re-parsed the current
  // document (undo/redo, Text-view commit, Reload), a real, confirmed
  // bug.
  S.currentContextHeading = null;
  S.isDirty = S.lastSavedText === null || entry.text !== S.lastSavedText;
  if (S.currentView === 'text') S.currentView = 'org'; // avoid showing now-stale textarea content after a jump
  render();
  persistInBackground();
  persistHistoryInBackground();
}

export function performUndo() {
  if (!canUndo(S.history)) {
    setStatus('Nothing to undo.');
    return;
  }
  const undoneLabel = currentEntry(S.history).label; // the step we're about to leave
  S.history = undo(S.history);
  restoreFromHistory();
  setStatus(`Undid: ${undoneLabel}`);
}

export function performRedo() {
  if (!canRedo(S.history)) {
    setStatus('Nothing to redo.');
    return;
  }
  S.history = redo(S.history);
  restoreFromHistory();
  setStatus(`Redid: ${currentEntry(S.history).label}`);
}

export function renderHistoryPanel(target = S.historyRenderTarget) {
  S.historyRenderTarget = target;
  if (!S.historyOpen) return;
  target.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'panel';
  container.style.minHeight = '100%';
  target.appendChild(container);

  const title = document.createElement('div');
  title.className = 'panel-section-title';
  title.textContent = 'History';
  container.appendChild(title);

  const stepRow = document.createElement('div');
  stepRow.className = 'panel-row';
  stepRow.appendChild(
    menuButton('\u2039 Undo', () => {
      performUndo();
      renderHistoryPanel();
    }, !canUndo(S.history))
  );
  stepRow.appendChild(
    menuButton('Redo \u203a', () => {
      performRedo();
      renderHistoryPanel();
    }, !canRedo(S.history))
  );
  container.appendChild(stepRow);

  const hint = document.createElement('div');
  hint.style.fontSize = '11px';
  hint.style.opacity = '0.6';
  hint.style.margin = '4px 0';
  hint.textContent = 'Tap an entry to jump there. Tap "diff" to see what that step actually changed.';
  container.appendChild(hint);

  const list = document.createElement('div');

  S.history.entries.forEach((entry, idx) => {
    const row = document.createElement('div');
    row.className = 'menu-list-item';
    row.style.cursor = 'pointer';
    row.style.opacity = idx > S.history.index ? '0.55' : '1'; // "future" (redo-available) entries shown dimmer

    const line = document.createElement('div');
    line.style.display = 'flex';
    line.style.alignItems = 'center';
    line.style.gap = '6px';

    const marker = document.createElement('span');
    marker.textContent = idx === S.history.index ? '\u25cf' : '\u25cb';
    marker.style.fontSize = '10px';
    marker.style.color = idx === S.history.index ? 'var(--accent)' : 'var(--text-muted, #888)';
    line.appendChild(marker);

    const label = document.createElement('span');
    label.textContent = entry.label;
    label.style.flex = '1';
    label.style.fontWeight = idx === S.history.index ? '600' : '400';
    line.appendChild(label);

    const time = document.createElement('span');
    time.textContent = entry.timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    time.style.fontSize = '11px';
    time.style.opacity = '0.6';
    line.appendChild(time);

    if (idx > 0) {
      const diffBtn = document.createElement('span');
      diffBtn.textContent = 'diff';
      diffBtn.style.fontSize = '11px';
      diffBtn.style.opacity = '0.7';
      diffBtn.style.textDecoration = 'underline';
      diffBtn.style.marginLeft = '4px';
      diffBtn.onclick = (e) => {
        e.stopPropagation();
        S.historyDiffExpandedIndex = S.historyDiffExpandedIndex === idx ? null : idx;
        renderHistoryPanel();
      };
      line.appendChild(diffBtn);
    }

    row.appendChild(line);
    row.onclick = () => {
      S.history = jumpTo(S.history, idx);
      restoreFromHistory();
      setStatus(`Jumped to: ${entry.label}`);
      renderHistoryPanel();
    };

    if (S.historyDiffExpandedIndex === idx && idx > 0) {
      row.appendChild(renderDiffView(S.history.entries[idx - 1].text, entry.text));
    }

    list.appendChild(row);
  });

  container.appendChild(list);
}

// textarea element -> the raw value it was last successfully committed with
export function commitTextModeIfActive() {
  if (S.currentView !== 'text') return false;
  if (S.isBufferReadOnly) {
    setStatus('Buffer is read-only \u2014 change not applied.');
    return false;
  }
  const textarea = document.getElementById('document-text-edit-input');
  const rawValue = textarea ? textarea.value : S.narrowedHeading ? serializeHeadingSubtree(S.narrowedHeading) : serializeOrg(S.state.doc);

  if (textarea && textModeLastCommittedValue.get(textarea) === rawValue) {
    // This exact textarea, with this exact content, was already
    // committed once -- e.g. Save immediately followed by switching
    // views, both of which call this function while currentView is
    // still 'text' and the textarea itself was never rebuilt in
    // between. Committing again here would be wrong: narrowedTextModeRange's
    // own one-shot bookkeeping (the splice-back boundary) was already
    // consumed and reset by the prior commit, so a second pass would
    // treat this textarea's own, possibly-narrowed content as a fresh
    // full-document replacement -- a real, confirmed data-loss bug
    // this guard exists specifically to close. A genuine further edit
    // made to the same textarea after that first commit still has a
    // different rawValue here, so it's never mistaken for this case.
    return false;
  }

  let newText;
  const wasNarrowedTextMode = S.narrowedTextModeRange !== null;
  if (S.narrowedTextModeRange) {
    const fullLines = serializeOrg(S.state.doc).split('\n');
    const before = fullLines.slice(0, S.narrowedTextModeRange.startLine);
    const after = fullLines.slice(S.narrowedTextModeRange.startLine + S.narrowedTextModeRange.lineCount);
    newText = [...before, ...rawValue.split('\n'), ...after].join('\n');
  } else {
    newText = rawValue;
  }

  const newDoc = parseOrg(newText);
  const rawLocalVars = parseLocalVariables(newText);
  const startupConfig = resolveEffectiveStartupConfig(newDoc, rawLocalVars, S.globalVariables);
  const localVariables = mergeGlobalAndLocalVariables(S.globalVariables, rawLocalVars);
  const archiveVisibility = getCycleOpenArchivedTrees(localVariables) ? 'noarchived' : 'archived';
  applyStartupVisibility(newDoc, startupConfig, archiveVisibility);
  S.state.doc = newDoc;
  S.state.startupConfig = startupConfig;
  reconcileReadOnlyAfterReparse(S.state.localVariables, localVariables);
  S.state.localVariables = localVariables;
  syncAgendaFilesConfig();
  syncContactsFilesConfig();
  if (wasNarrowedTextMode) {
    S.narrowedHeading = findHeadingAtLine(newDoc, S.narrowedTextModeRange.startLine);
    const outlinePath = S.narrowedHeading ? outlinePathForHeadingInDocument(S.state.documentId, S.narrowedHeading) : null;
    saveNarrowState(kv, S.state.documentId, outlinePath).catch(() => {});
  }
  if (wasNarrowedTextMode) {
    S.narrowedTextModeRange = { startLine: S.narrowedTextModeRange.startLine, lineCount: rawValue.split('\n').length };
  }
  // currentContextHeading DOES hold an actual heading object reference,
  // now stale -- a fresh parseOrg call always produces brand new
  // heading instances, even when re-parsing what is nominally "the
  // same" file. navigationBackStack does NOT hold any such reference
  // (just documentId/storageKind/scrollTop/view, all plain
  // data unaffected by re-parsing the CURRENT document), so it's
  // deliberately left untouched here -- clearing it unconditionally
  // used to destroy cross-document back-navigation the moment a user
  // visited Text view even once, a real, confirmed bug.
  S.currentContextHeading = null;
  const previousHistory = S.history;
  S.history = pushSnapshot(S.history, newText, 'Edited in text mode');
  const changed = S.history !== previousHistory;
  if (changed) {
    S.isDirty = true;
    persistInBackground();
    persistHistoryInBackground();
  }
  if (textarea) textModeLastCommittedValue.set(textarea, rawValue);
  return true;
}
