// Extracted from app.js: god mode palette.
import { isArchivedInPlace } from '../src/archive-model.js';
import { computeNonCollidingKeys } from '../src/capture-template.js';
import { findHeadingWithRunningClock } from '../src/clock.js';
import { pushRecent, searchCommands } from '../src/command-palette.js';
import { applyStartupVisibility, cycleFoldLevel } from '../src/fold-state.js';
import { demoteHeading, insertHeadingAfter, moveHeadingDown, moveHeadingUp, promoteHeading } from '../src/heading-edit.js';
import { getBufferReadOnly, getCycleOpenArchivedTrees } from '../src/local-variables.js';
import { resolveTodoSequences } from '../src/todo-cycle.js';
import { canRedo, canUndo } from '../src/undo-history.js';
import { S } from './app-state.js';
import { openArchiveConfirmPrompt, unarchiveHeadingToOriginalLocation } from './archive-flow.js';
import { openAttachChoicePrompt } from './attachments-flow.js';
import { openCalendarPanel } from './calendar-panel.js';
import { openCapturePrompt, renderCapturePanel } from './capture-ui.js';
import { closeAllOverlayPanels } from './chrome.js';
import { clockCancelHeading, clockContinue, clockInHeading, clockOutHeading } from './clock-flow.js';
import { GLOBAL_TODO_DEFAULT, PALETTE_RECENT_KEY } from './constants.js';
import { lockBackgroundScroll } from './dialogs.js';
import { createNewUnsavedDocument, saveCurrent } from './documents-io.js';
import { fileMenuBtn, moreBtn, outlineEl, searchBtn, settingsBtn } from './dom.js';
import { commitAndRender, commitTextModeIfActive, performRedo, performUndo, renderHistoryPanel, setStatus, startEditingTitle } from './editing.js';
import { performExport } from './export-import.js';
import { renderFileMenu } from './file-menu.js';
import { openGeneralEditor } from './general-editor.js';
import { cutSubtree, extraMenuTargetHeading, narrowToHeading, pasteSubtree, widen } from './gestures-structure.js';
import { cyclePriorityFor, openEffortEditor } from './heading-commands.js';
import { moveKeyboardFocus, moveLineFocus, moveTableCellFocus, moveToParentHeading, moveToSameLevelHeading, setKeyboardFocusToHeading } from './keyboard-focus.js';
import { renderMoreMenu } from './menus.js';
import { openRefilePicker } from './refile-flow.js';
import { scrollFocusedHeadingIntoView } from './render-helpers.js';
import { render } from './render.js';
import { kv } from './singletons.js';
import { loadPaletteRecent } from './sync-helpers.js';
import { chooseTodoWorkflowState, openTodoOrPickWorkflow } from './todo-workflow.js';
import { isWideLayout, keepOverlayInVisibleViewport } from './ui-widgets.js';
import { openOrSwitchToHelp, switchToView } from './views.js';

export function globalCycleFold() {
  if (!S.state.doc) return;
  const archiveVisibility = getCycleOpenArchivedTrees(S.state.localVariables) ? 'noarchived' : 'archived';
  S.lastGlobalFoldState = S.lastGlobalFoldState === 'overview' ? 'showeverything' : 'overview';
  applyStartupVisibility(S.state.doc, { visibility: S.lastGlobalFoldState }, archiveVisibility);
  render();
}

/** Reports a god-mode sequence that's genuinely valid (it's in the
 *  reference this feature was built from) but has no equivalent in
 *  this app yet -- table-cell-relative operations, link insertion,
 *  and code-block execution all need a keyboard-focus/cursor concept
 *  this app's own heading-level-only keyboard model doesn't have, or
 *  (for code execution) a capability this app deliberately doesn't
 *  implement at all (see the README's own Known limitations). Told
 *  honestly rather than silently doing nothing or approximating
 *  something misleading. */
export function godModeNotSupported(reason) {
  setStatus(`God-mode: ${reason}`);
  render();
}

/** god-mode's own action table -- maps a normalized chord string (see
 *  src/god-mode.js) to a callback, one entry per row in the reference
 *  document this feature was built from. Every action here operates
 *  on `keyboardFocusedHeading`, the same heading-level keyboard-focus
 *  concept the existing simple shortcuts (j/k/t/[/]/...) already use. */
export const GOD_MODE_ACTIONS = {
  // Section 1: Structural Editing & Navigation
  TAB: () => {
    if (!S.keyboardFocusedHeading) return;
    const archiveVisibility = getCycleOpenArchivedTrees(S.state.localVariables) ? 'noarchived' : 'archived';
    cycleFoldLevel(S.keyboardFocusedHeading, { archiveVisibility });
    render();
  },
  'S-TAB': () => globalCycleFold(),
  'M-<up>': () => {
    if (S.keyboardFocusedHeading && moveHeadingUp(S.state.doc, S.keyboardFocusedHeading)) {
      commitAndRender('Moved heading up');
      scrollFocusedHeadingIntoView();
    }
  },
  'M-<down>': () => {
    if (S.keyboardFocusedHeading && moveHeadingDown(S.state.doc, S.keyboardFocusedHeading)) {
      commitAndRender('Moved heading down');
      scrollFocusedHeadingIntoView();
    }
  },
  'M-<right>': () => {
    if (S.keyboardFocusedHeading && demoteHeading(S.state.doc, S.keyboardFocusedHeading)) commitAndRender('Demoted heading');
  },
  'M-<left>': () => {
    if (S.keyboardFocusedHeading && promoteHeading(S.state.doc, S.keyboardFocusedHeading)) commitAndRender('Promoted heading');
  },
  // Real org's own C-x n s / C-x n w (narrow-to-subtree / widen).
  'C-x n s': () => {
    if (S.keyboardFocusedHeading) narrowToHeading(S.keyboardFocusedHeading);
  },
  'C-x n w': () => widen(),
  // This app's own promote/demote already act on the whole subtree
  // (see heading-edit.js's own docs) -- there's no separate single-
  // heading-only version, so the "entire subtree" god-mode sequence
  // maps to the exact same action as the plain one above.
  'M-S-<right>': () => {
    if (S.keyboardFocusedHeading && demoteHeading(S.state.doc, S.keyboardFocusedHeading)) commitAndRender('Demoted heading');
  },
  'M-S-<left>': () => {
    if (S.keyboardFocusedHeading && promoteHeading(S.state.doc, S.keyboardFocusedHeading)) commitAndRender('Promoted heading');
  },
  'C-c C-f': () => moveToSameLevelHeading(1),
  'C-c C-b': () => moveToSameLevelHeading(-1),
  'C-c C-u': () => moveToParentHeading(),
  'C-c C-n': () => {
    moveKeyboardFocus(1);
  },
  'C-c C-p': () => {
    moveKeyboardFocus(-1);
  },

  // Section 2: Item & Headline Creation
  'M-RET': () => {
    if (!S.keyboardFocusedHeading || !S.state.doc) return;
    const heading = insertHeadingAfter(S.state.doc, S.keyboardFocusedHeading, {});
    if (heading) {
      setKeyboardFocusToHeading(heading);
      startEditingTitle(heading, true);
    }
  },
  'M-S-RET': () => {
    if (!S.keyboardFocusedHeading || !S.state.doc) return;
    const heading = insertHeadingAfter(S.state.doc, S.keyboardFocusedHeading, { todo: 'TODO' });
    if (heading) {
      setKeyboardFocusToHeading(heading);
      startEditingTitle(heading, true);
    }
  },
  'C-c C-c': () => godModeNotSupported('checkbox toggling and code execution both need a finer keyboard focus than headings -- tap the checkbox or block directly'),

  // Section 3: TODOs & Task Management
  'C-c C-t': () => S.keyboardFocusedHeading && openTodoOrPickWorkflow(S.keyboardFocusedHeading),
  'C-c ,': () => cyclePriorityFor(S.keyboardFocusedHeading),
  'C-c C-x e': () => openEffortEditor(S.keyboardFocusedHeading),
  'C-c C-v': () => {
    if (!S.state.doc) return;
    switchToView('tasklist');
  },

  // Section 4: Dates, Deadlines & Timestamps
  'C-c .': () => {
    if (S.keyboardFocusedHeading) {
      S.editingGeneral = S.keyboardFocusedHeading;
      openGeneralEditor(S.keyboardFocusedHeading);
    }
  },
  'C-c !': () => {
    if (S.keyboardFocusedHeading) {
      S.editingGeneral = S.keyboardFocusedHeading;
      openGeneralEditor(S.keyboardFocusedHeading);
    }
  },
  'C-c C-d': () => {
    if (S.keyboardFocusedHeading) {
      S.editingGeneral = S.keyboardFocusedHeading;
      openGeneralEditor(S.keyboardFocusedHeading);
    }
  },
  'C-c C-s': () => {
    if (S.keyboardFocusedHeading) {
      S.editingGeneral = S.keyboardFocusedHeading;
      openGeneralEditor(S.keyboardFocusedHeading);
    }
  },

  // Section 5: Table Manipulation -- none of these have a keyboard-
  // focus equivalent, since this app's own keyboard focus tracks a
  // heading, not a specific table cell.
  'C-c |': () => godModeNotSupported('table creation needs a table-cell keyboard focus this app doesn\u2019t have -- use the \u25a6 Add table action instead'),

  // Section 6: Agenda, Hyperlinks & Babel Code Blocks
  'C-c l': () => godModeNotSupported('there\u2019s no dedicated link-insertion command -- type or paste a URL directly'),
  'C-c C-l': () => godModeNotSupported('there\u2019s no dedicated link-insertion command -- type or paste a URL directly'),
  'C-c C-o': () => godModeNotSupported('links are tappable directly -- there\u2019s no keyboard-cursor concept to open one from'),
  'C-c a': () => {
    if (S.state.doc) switchToView('agenda');
  },
  'C-c c': () => {
    S.godModeActive = false;
    closeAllOverlayPanels();
    S.captureOpenedViaGodMode = true;
    S.captureOpen = true;
    render();
    renderCapturePanel();
  },
  'C-c C-e': () => godModeNotSupported('use File \u2192 Export instead'),
  'C-h i': () => {
    S.moreOpen = false;
    renderMoreMenu();
    openOrSwitchToHelp();
  },
  '<up>': () => moveLineFocus(-1),
  '<down>': () => moveLineFocus(1),
  'S-<up>': () => moveTableCellFocus(-1, 0),
  'S-<down>': () => moveTableCellFocus(1, 0),
  'S-<left>': () => moveTableCellFocus(0, -1),
  'S-<right>': () => moveTableCellFocus(0, 1),
  'C-c C-x C-w': () => {
    if (S.keyboardFocusedHeading) cutSubtree(S.keyboardFocusedHeading);
  },
  'C-c C-x C-y': () => {
    if (S.keyboardFocusedHeading) pasteSubtree(S.keyboardFocusedHeading);
  },
  // M-x: this app's command palette (real M-x's touch-friendly counterpart).
  'M-x': () => {
    S.godModeActive = false;
    openCommandPalette();
  },
  'C-x C-q': () => {
    S.godModeActive = false; // otherwise renderMinibuffer's own god-mode-sequence-indicator immediately overwrites this action's own status message on the very same render() below, since god-mode intentionally stays active after a successful dispatch
    toggleBufferReadOnly();
  },
};

/** After a reparse (undo/redo, leaving Text view), re-derives
 *  read-only from the file's own buffer-read-only local variable ONLY
 *  if that variable itself changed -- otherwise a runtime C-x C-q
 *  toggle would be silently reverted, unlike real Emacs, where the
 *  local variable only applies when the file is loaded. */
export function reconcileReadOnlyAfterReparse(previousVars, newVars) {
  const before = getBufferReadOnly(previousVars);
  const after = getBufferReadOnly(newVars);
  if (before !== after) S.isBufferReadOnly = after;
}

/** Toggles buffer-read-only, per real Emacs's own actual C-x C-q --
 *  shared by that god-mode binding (see GOD_MODE_ACTIONS above) and
 *  the touch-native toggle in the View menu (see renderViewMenuContent
 *  below), so neither duplicates the other's own logic. */
export function toggleBufferReadOnly() {
  if (!S.state.doc) return;
  if (!S.isBufferReadOnly) commitTextModeIfActive(); // capture any pending Text-view edit while still writable -- once toggled on, the commit path would correctly (but too late) refuse it
  S.isBufferReadOnly = !S.isBufferReadOnly;
  setStatus(S.isBufferReadOnly ? 'Buffer is read-only now.' : 'Buffer is writable now.');
  render();
}

/** Why a command can't run right now, or null if it can. */
export const PALETTE_NEEDS = {
  doc: () => (S.state.doc ? null : 'open a document first'),
  heading: (target) => (target ? null : 'tap a heading first, or focus one with Escape'),
  writable: () => (S.isBufferReadOnly ? 'the buffer is read-only \u2014 toggle it in the View menu' : null),
  storage: () => (S.state.storageKind ? null : 'this document has no file yet \u2014 use Save as'),
  narrowed: () => (S.narrowedHeading ? null : 'nothing is narrowed'),
  undo: () => (canUndo(S.history) ? null : 'nothing to undo'),
  redo: () => (canRedo(S.history) ? null : 'nothing to redo'),
  clock: () => (S.state.doc && findHeadingWithRunningClock(S.state.doc) ? null : 'no clock is running'),
  archived: (target) => (target && isArchivedInPlace(target) ? null : 'this heading isn\u2019t archived'),
  notArchived: (target) => (target && isArchivedInPlace(target) ? 'it is already archived \u2014 use Unarchive' : null),
};

export function paletteUnavailableReason(command, target) {
  for (const need of command.needs || []) {
    const reason = PALETTE_NEEDS[need](target);
    if (reason) return reason;
  }
  return null;
}

/** The registry. `keys` is only shown where this app's own god-mode
 *  table really binds that chord, and those commands run through the
 *  same table entry, so the palette and the keyboard can't drift apart. */
export function paletteCommandList() {
  const chord = (c) => (target) => {
    S.actionMenuFor = null;
    if (target) setKeyboardFocusToHeading(target);
    GOD_MODE_ACTIONS[c]();
  };
  const onHeading = (fn) => (target) => {
    S.actionMenuFor = null;
    fn(target);
  };
  const HEAD = ['doc', 'heading', 'writable'];
  const runningClock = () => findHeadingWithRunningClock(S.state.doc);
  const openFileMenuAt = (step) => {
    fileMenuBtn.click();
    S.fileMenuStep = step;
    renderFileMenu();
  };
  const exportAs = (format) => () => performExport(format, null);

  return [
    // -- Heading
    { id: 'todo', label: 'Cycle TODO state', orgName: 'org-todo', keys: 'C-c C-t', group: 'Heading', needs: HEAD, run: onHeading(openTodoOrPickWorkflow) },
    { id: 'priority', label: 'Set priority', orgName: 'org-priority', keys: 'C-c ,', group: 'Heading', needs: HEAD, run: onHeading(cyclePriorityFor) },
    { id: 'effort', label: 'Set effort estimate', orgName: 'org-set-effort', keys: 'C-c C-x e', group: 'Heading', needs: HEAD, run: onHeading(openEffortEditor) },
    {
      id: 'details',
      label: 'Edit details',
      orgName: 'org-schedule',
      keys: 'C-c C-s',
      group: 'Heading',
      keywords: ['scheduled', 'deadline', 'org-deadline', 'timestamp', 'org-time-stamp', 'tags', 'org-set-tags-command', 'properties', 'org-set-property'],
      needs: ['doc', 'heading'],
      run: chord('C-c C-s'),
    },
    { id: 'add-heading', label: 'Add heading after', orgName: 'org-insert-heading', keys: 'M-RET', group: 'Heading', needs: HEAD, run: chord('M-RET') },
    { id: 'add-todo-heading', label: 'Add TODO heading after', orgName: 'org-insert-todo-heading', keys: 'M-S-RET', group: 'Heading', needs: HEAD, run: chord('M-S-RET') },
    { id: 'promote', label: 'Promote subtree', orgName: 'org-promote-subtree', keys: 'M-<left>', group: 'Heading', needs: HEAD, run: chord('M-<left>') },
    { id: 'demote', label: 'Demote subtree', orgName: 'org-demote-subtree', keys: 'M-<right>', group: 'Heading', needs: HEAD, run: chord('M-<right>') },
    { id: 'move-up', label: 'Move subtree up', orgName: 'org-move-subtree-up', keys: 'M-<up>', group: 'Heading', needs: HEAD, run: chord('M-<up>') },
    { id: 'move-down', label: 'Move subtree down', orgName: 'org-move-subtree-down', keys: 'M-<down>', group: 'Heading', needs: HEAD, run: chord('M-<down>') },
    { id: 'cut', label: 'Cut subtree', orgName: 'org-cut-subtree', keys: 'C-c C-x C-w', group: 'Heading', needs: HEAD, run: chord('C-c C-x C-w') },
    { id: 'paste', label: 'Paste subtree', orgName: 'org-paste-subtree', keys: 'C-c C-x C-y', group: 'Heading', needs: HEAD, run: chord('C-c C-x C-y') },
    { id: 'archive', label: 'Archive subtree', orgName: 'org-archive-subtree', group: 'Heading', needs: [...HEAD, 'notArchived'], run: onHeading(openArchiveConfirmPrompt) },
    { id: 'unarchive', label: 'Unarchive (restore)', group: 'Heading', needs: [...HEAD, 'archived'], run: onHeading(unarchiveHeadingToOriginalLocation) },
    { id: 'refile', label: 'Refile', orgName: 'org-refile', group: 'Heading', needs: HEAD, run: onHeading(openRefilePicker) },
    { id: 'attach', label: 'Attachments', orgName: 'org-attach', group: 'Heading', keywords: ['attach', 'file', 'audio', 'record'], needs: HEAD, run: onHeading(openAttachChoicePrompt) },
    { id: 'narrow', label: 'Narrow to subtree', orgName: 'org-narrow-to-subtree', keys: 'C-x n s', group: 'Heading', needs: ['doc', 'heading'], run: chord('C-x n s') },
    { id: 'widen', label: 'Widen', orgName: 'widen', keys: 'C-x n w', group: 'Heading', needs: ['doc', 'narrowed'], run: () => widen() },

    // -- Clocking
    { id: 'clock-in', label: 'Clock in', orgName: 'org-clock-in', group: 'Clocking', needs: HEAD, run: onHeading(clockInHeading) },
    { id: 'clock-out', label: 'Clock out', orgName: 'org-clock-out', group: 'Clocking', needs: ['doc', 'clock'], run: () => clockOutHeading(runningClock()) },
    { id: 'clock-cancel', label: 'Cancel clock', orgName: 'org-clock-cancel', group: 'Clocking', needs: ['doc', 'clock'], run: () => clockCancelHeading(runningClock()) },
    { id: 'clock-continue', label: 'Continue last clock', group: 'Clocking', needs: ['doc'], run: () => clockContinue() },

    // -- Document
    { id: 'save', label: 'Save', orgName: 'save-buffer', group: 'Document', needs: ['doc', 'storage'], run: () => saveCurrent() },
    { id: 'save-as', label: 'Save as\u2026', orgName: 'write-file', group: 'Document', needs: ['doc'], run: () => openFileMenuAt('saveas') },
    { id: 'open', label: 'Open file\u2026', orgName: 'find-file', group: 'Document', run: () => openFileMenuAt('open') },
    { id: 'new', label: 'New document', group: 'Document', run: () => createNewUnsavedDocument() },
    { id: 'undo', label: 'Undo', orgName: 'undo', group: 'Document', needs: ['doc', 'undo'], run: () => performUndo() },
    { id: 'redo', label: 'Redo', orgName: 'undo-redo', group: 'Document', needs: ['doc', 'redo'], run: () => performRedo() },
    {
      id: 'history',
      label: 'Undo history',
      group: 'Document',
      needs: ['doc'],
      run: () => {
        closeAllOverlayPanels();
        S.historyOpen = true;
        if (isWideLayout()) render();
        else renderHistoryPanel(outlineEl);
      },
    },
    { id: 'read-only', label: 'Toggle read-only', orgName: 'read-only-mode', keys: 'C-x C-q', group: 'Document', needs: ['doc'], run: chord('C-x C-q') },
    { id: 'capture', label: 'Capture', orgName: 'org-capture', keys: 'C-c c', group: 'Document', run: chord('C-c c') },

    // -- View
    { id: 'agenda', label: 'Agenda', orgName: 'org-agenda', keys: 'C-c a', group: 'View', needs: ['doc'], run: chord('C-c a') },
    { id: 'tasklist', label: 'TODO list', orgName: 'org-todo-list', keys: 'C-c C-v', group: 'View', keywords: ['tasks'], needs: ['doc'], run: chord('C-c C-v') },
    { id: 'view-org', label: 'Outline view', group: 'View', keywords: ['org'], needs: ['doc'], run: () => switchToView('org') },
    { id: 'view-text', label: 'Text view', group: 'View', keywords: ['raw', 'source'], needs: ['doc'], run: () => switchToView('text') },
    { id: 'cycle-visibility', label: 'Cycle visibility of the whole document', orgName: 'org-global-cycle', keys: 'S-TAB', group: 'View', keywords: ['fold', 'unfold', 'collapse', 'expand'], needs: ['doc'], run: () => globalCycleFold() },
    { id: 'calendar', label: 'Calendar', group: 'View', needs: ['doc'], run: () => openCalendarPanel() },
    { id: 'search', label: 'Search', group: 'View', keywords: ['find', 'replace'], run: () => searchBtn.click() },

    // -- Export
    {
      id: 'export',
      label: 'Export\u2026',
      orgName: 'org-export-dispatch',
      group: 'Export',
      needs: ['doc'],
      run: () => {
        moreBtn.click();
        S.moreMenuStep = 'export';
        S.exportFormat = null;
        renderMoreMenu();
      },
    },
    { id: 'export-html', label: 'Export this file as HTML', group: 'Export', needs: ['doc'], run: exportAs('html') },
    { id: 'export-markdown', label: 'Export this file as Markdown', group: 'Export', needs: ['doc'], run: exportAs('markdown') },
    { id: 'export-ascii', label: 'Export this file as ASCII', group: 'Export', needs: ['doc'], run: exportAs('ascii') },
    { id: 'export-odt', label: 'Export this file as ODT', group: 'Export', needs: ['doc'], run: exportAs('odt') },

    // -- App
    { id: 'settings', label: 'Settings', group: 'App', run: () => settingsBtn.click() },
    { id: 'help', label: 'Help', group: 'App', keywords: ['readme', 'docs', 'manual'], run: chord('C-h i') },
  ];
}

/** Opens the palette. Resolves once it closes. */
export async function openCommandPalette() {
  if (S.confirmDialogOpen) return;
  const target = extraMenuTargetHeading();
  if (S.paletteRecentIds === null) S.paletteRecentIds = await loadPaletteRecent();
  const commands = paletteCommandList();

  S.confirmDialogOpen = true;
  const overlay = document.createElement('div');
  overlay.id = 'command-palette';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(0,0,0,0.6)';
  overlay.style.zIndex = '10000';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'flex-start';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '10px';
  overlay.style.boxSizing = 'border-box';
  overlay.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.className = 'panel';
  modal.style.background = 'var(--modal-bg)';
  modal.style.color = 'var(--fg)';
  modal.style.border = '1px solid var(--border-strong)';
  modal.style.borderRadius = '10px';
  modal.style.padding = '10px';
  modal.style.width = '100%';
  modal.style.maxWidth = '560px';
  modal.style.maxHeight = '100%';
  modal.style.boxSizing = 'border-box';
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';
  modal.style.gap = '8px';
  overlay.appendChild(modal);

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type a command\u2026 (effort, clock, org-todo)';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('enterkeyhint', 'go');
  input.setAttribute('aria-label', 'Command');
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  input.style.padding = '10px';
  input.style.fontSize = '16px'; // 16px stops iOS zooming the page on focus
  input.style.border = '1px solid var(--border-strong)';
  input.style.borderRadius = '8px';
  input.style.background = 'var(--bg)';
  input.style.color = 'var(--fg)';
  modal.appendChild(input);

  const list = document.createElement('div');
  list.setAttribute('role', 'listbox');
  list.style.overflowY = 'auto';
  list.style.overscrollBehavior = 'contain';
  list.style.flex = '1 1 auto';
  list.style.minHeight = '0';
  list.style.maxHeight = 'min(62vh, 460px)';
  modal.appendChild(list);

  let results = [];
  let selected = 0;

  const stopTrackingViewport = keepOverlayInVisibleViewport(overlay);
  const unlockScroll = lockBackgroundScroll(overlay);
  function finish() {
    S.confirmDialogOpen = false;
    document.removeEventListener('keydown', onKeyDown, true);
    stopTrackingViewport();
    unlockScroll();
    overlay.remove();
  }

  function run(entry) {
    const { command } = entry;
    const reason = paletteUnavailableReason(command, target);
    finish();
    if (reason) {
      setStatus(`${command.label}: ${reason}.`);
      render();
      return;
    }
    S.paletteRecentIds = pushRecent(S.paletteRecentIds, command.id);
    kv.set(PALETTE_RECENT_KEY, JSON.stringify(S.paletteRecentIds)).catch(() => {});
    try {
      command.run(target);
    } catch (err) {
      setStatus(`${command.label} failed: ${err.message}`);
      render();
    }
  }

  function renderList() {
    list.innerHTML = '';
    if (results.length === 0) {
      const none = document.createElement('div');
      none.textContent = 'No command matches.';
      none.style.opacity = '0.6';
      none.style.padding = '12px 6px';
      none.style.fontSize = '14px';
      list.appendChild(none);
      return;
    }
    results.forEach((entry, i) => {
      const { command, recent } = entry;
      const reason = paletteUnavailableReason(command, target);
      const row = document.createElement('div');
      row.setAttribute('role', 'option');
      row.setAttribute('data-command-id', command.id);
      row.style.padding = '8px 8px';
      row.style.borderRadius = '6px';
      row.style.cursor = 'pointer';
      row.style.borderLeft = i === selected ? '3px solid var(--accent)' : '3px solid transparent';
      row.style.background = i === selected ? 'rgba(127,127,127,0.2)' : 'transparent';
      if (reason) row.style.opacity = '0.5';

      const top = document.createElement('div');
      top.style.display = 'flex';
      top.style.justifyContent = 'space-between';
      top.style.gap = '8px';
      top.style.alignItems = 'baseline';
      const name = document.createElement('span');
      name.textContent = (recent ? '\u21ba ' : '') + command.label;
      name.style.fontSize = '15px';
      name.style.fontWeight = '600';
      top.appendChild(name);
      const group = document.createElement('span');
      group.textContent = command.group || '';
      group.style.fontSize = '11px';
      group.style.opacity = '0.55';
      group.style.flexShrink = '0';
      top.appendChild(group);
      row.appendChild(top);

      const detail = document.createElement('div');
      detail.style.fontSize = '12px';
      detail.style.opacity = '0.7';
      detail.style.marginTop = '1px';
      detail.style.overflowWrap = 'anywhere';
      detail.textContent = reason
        ? `unavailable \u2014 ${reason}`
        : [command.orgName, command.keys && `god-mode: ${command.keys}`].filter(Boolean).join('  \u00b7  ');
      if (detail.textContent) row.appendChild(detail);

      row.onclick = () => run(entry);
      list.appendChild(row);
    });
    const current = list.children[selected];
    if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest' });
  }

  function refreshResults() {
    const ranked = searchCommands(commands, input.value, { recentIds: S.paletteRecentIds });
    // What can be done right now comes first; the rest follow, dimmed.
    // Ranking is kept within each half.
    const runnable = ranked.filter((entry) => !paletteUnavailableReason(entry.command, target));
    const blocked = ranked.filter((entry) => paletteUnavailableReason(entry.command, target));
    results = [...runnable, ...blocked];
    selected = 0;
    renderList();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish();
    }
  }
  document.addEventListener('keydown', onKeyDown, true);
  overlay.onclick = (e) => {
    if (e.target === overlay) finish();
  };
  input.addEventListener('input', refreshResults);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      renderList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Running a command closes the palette (and clears its "dialog open"
      // flag) while this same keypress is still on its way up to the global
      // key handler, which would then treat it as an ordinary Enter -- and
      // wipe the status message the command just set.
      e.stopPropagation();
      if (results[selected]) run(results[selected]);
    }
  });

  refreshResults();
  document.body.appendChild(overlay);
  input.focus();
}

/** True if `chordString` is either an exact match in GOD_MODE_ACTIONS
 *  or a proper prefix of some entry there (e.g. "C-c" is a prefix of
 *  "C-c C-t") -- the keydown handler uses this to decide whether an
 *  in-progress sequence should keep waiting for more input or be
 *  treated as a dead end. An empty chordString (nothing committed
 *  yet, e.g. mid-"c c" or right after "m"/"g") always counts as a
 *  valid prefix -- there's always more possible input at that point. */
export function isValidGodModePrefix(chordString) {
  if (chordString === '') return true;
  return Object.keys(GOD_MODE_ACTIONS).some((k) => k === chordString || k.startsWith(chordString + ' '));
}

/**
 * Keyboard shortcuts, primarily aimed at non-touch devices where a
 * pointer-driven tap/swipe UI is a worse fit than it is on a phone.
 * Mostly real org-mode's own bindings, but NOT a faithful reproduction
 * of them: org leans heavily on the `C-c` prefix (`C-c C-t`, `C-c C-s`,
 * etc.), and `C-c`/`C-v`/`C-a`/`C-f` and friends are universally
 * reserved by every browser for copy/paste/select-all/find and cannot
 * be reliably intercepted from a web page — building on that prefix
 * would mean silently breaking copy-paste, not a reasonable tradeoff.
 * Real org's `M-\u2190`/`M-\u2192` (promote/demote) collide with the browser's
 * own back/forward navigation the same way. Where the direct org key is
 * actually safe to use (`Tab` for org-cycle, `M-\u2191`/`M-\u2193` for moving a
 * subtree) it's used as-is; everywhere else this substitutes a
 * different, safe key rather than pretending the conflict doesn't
 * exist. See the README's Keybindings section for the full table and
 * this same reasoning stated for a reader, not just a future editor of
 * this code.
 *
 * All of this is inert on a touch device in practice -- there's no
 * keyboard to press these on -- except a Bluetooth keyboard paired to a
 * tablet, a real if uncommon case these bindings work correctly for
 * too, same code path either way.
 */
/** Matches a plain keypress against whichever god-mode-triggered
 *  picker (if any) is currently listening for hotkey selection --
 *  the capture-template picker or the TODO-workflow picker -- and
 *  dispatches the exact same function the corresponding button's own
 *  onclick would call. Returns true if a match was found and
 *  dispatched, false otherwise (so the caller knows whether to keep
 *  treating the key as unhandled). Deliberately checks against the
 *  SAME non-colliding key set the panel is currently showing, not a
 *  looser "any known key" match -- a colliding key was never shown as
 *  a hotkey in the first place and isn't accepted here either, click/
 *  tap only, matching the explicit design decision for this feature. */
export function tryDispatchPanelHotkey(key) {
  if (S.captureOpen && S.captureOpenedViaGodMode && !S.capturePromptTemplate) {
    const nonCollidingKeys = computeNonCollidingKeys(S.currentCaptureTemplates, (t) => t.key);
    for (const [template, hotkey] of nonCollidingKeys) {
      if (hotkey === key) {
        openCapturePrompt(template);
        return true;
      }
    }
  }
  if (S.pendingTodoWorkflowChoice && S.pendingTodoWorkflowChoice.viaGodMode) {
    const sequences = resolveTodoSequences(S.state.doc, GLOBAL_TODO_DEFAULT);
    const allEntries = sequences.flatMap((seq) => [...seq.todoKeywords, ...seq.doneKeywords].map((keyword) => ({ seq, keyword })));
    const nonCollidingKeys = computeNonCollidingKeys(allEntries, (entry) => entry.seq.keySpecs[entry.keyword]);
    for (const [entry, hotkey] of nonCollidingKeys) {
      if (hotkey === key) {
        chooseTodoWorkflowState(S.pendingTodoWorkflowChoice.heading, entry.keyword, entry.seq);
        return true;
      }
    }
  }
  return false;
}
