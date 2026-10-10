// Extracted from app.js: god mode palette.
import { findAncestorPath, isArchivedInPlace } from '../src/archive-model.js';
import { computeNonCollidingKeys } from '../src/capture-template.js';
import { findHeadingWithRunningClock } from '../src/clock.js';
import { dynamicCommandSpecs, pushRecent, searchCommands } from '../src/command-palette.js';
import { parseExtraMenu } from '../src/extra-menu.js';
import { applyStartupVisibility, collapseFully, cycleFoldLevel, expandOneLevel } from '../src/fold-state.js';
import { initialState as godModeInitialState, processKey as godModeProcessKey } from '../src/god-mode.js';
import { demoteHeading, insertHeadingAfter, insertTopLevelHeading, moveHeadingDown, moveHeadingUp, promoteHeading } from '../src/heading-edit.js';
import { getBufferReadOnly, getCycleOpenArchivedTrees, getExtraMenu } from '../src/local-variables.js';
import { resolveTodoSequences } from '../src/todo-cycle.js';
import { canRedo, canUndo } from '../src/undo-history.js';
import { S } from './app-state.js';
import { openArchiveConfirmPrompt, unarchiveHeadingToOriginalLocation } from './archive-flow.js';
import { openAttachChoicePrompt } from './attachments-flow.js';
import { openCalendarPanel } from './calendar-panel.js';
import { openCapturePrompt, renderCapturePanel } from './capture-ui.js';
import { closeAllOverlayPanels } from './chrome.js';
import { effectiveCalendarConfig, syncAgendaToCalendar } from './calendar-sync.js';
import { effectiveContactsConfig, syncContactsToAddressBook } from './contacts-sync.js';
import { chooseAttachmentsFolder } from './attachments-store.js';
import { addCaptureIconToHomeScreen } from './capture-shortcuts.js';
import { executeFocusedBlock } from './babel-flow.js';
import { extensionPaletteEntries } from './extension-flow.js';
import { showDisplayMeasurements } from './display-info.js';
import { platform } from './platform.js';
import { clockCancelHeading, clockContinue, clockGoto, clockGotoRecent, clockInHeading, clockOutHeading, findRunningClockAcrossSessions, recentlyClockedAcrossSessions } from './clock-flow.js';
import { GLOBAL_TODO_DEFAULT, PALETTE_RECENT_KEY } from './constants.js';
import { lockBackgroundScroll } from './dialogs.js';
import { createNewUnsavedDocument, saveCurrent } from './documents-io.js';
import { fileMenuBtn, moreBtn, outlineEl, searchBtn, settingsBtn } from './dom.js';
import { commitAndRender, commitTextModeIfActive, performRedo, performUndo, renderHistoryPanel, setStatus, startEditingTitle } from './editing.js';
import { performExport, performOrgOrgExport } from './export-import.js';
import { renderFileMenu } from './file-menu.js';
import { openGeneralEditor } from './general-editor.js';
import { cutSubtree, extraMenuTargetHeading, narrowToHeading, pasteSubtree, widen } from './gestures-structure.js';
import { cyclePriorityFor, openEffortEditor } from './heading-commands.js';
import { moveKeyboardFocus, moveLineFocus, moveTableCellFocus, moveToParentHeading, moveToSameLevelHeading, setKeyboardFocusToHeading, enterInsertModeAtCurrentLine, visibleHeadingsInOrder } from './keyboard-focus.js';
import { renderMoreMenu, runExtraMenuEntry } from './menus.js';
import { openRefilePicker } from './refile-flow.js';
import { scrollFocusedHeadingIntoView } from './render-helpers.js';
import { render } from './render.js';
import { getCaptureTemplates } from './settings.js';
import { kv } from './singletons.js';
import { loadPaletteRecent } from './sync-helpers.js';
import { recalculateAllTables } from './table-recalc.js';
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

/** Opens the File menu already on a specific step (Save As, Open) --
 *  shared by the palette's own Save as / Open commands and their
 *  matching god-mode chords (C-x C-w / C-x C-f), so both routes run
 *  through exactly the same code. */
function openFileMenuAt(step) {
  fileMenuBtn.click();
  S.fileMenuStep = step;
  renderFileMenu();
}

/**
 * Inserts a new heading the way M-RET / C-RET / M-S-RET do (real org's
 * org-insert-heading, relative to point). This app has no literal
 * text-cursor concept in the outline view, so "point" is approximated:
 *
 *   - a heading is keyboard-focused -> insert as its sibling, right
 *     after it (the normal, most common case);
 *   - otherwise, an EMPTY document (no headings at all) -> a single
 *     top-level heading at the top of the file, matching what M-RET
 *     does at position 1 of a truly empty buffer in real Emacs;
 *   - otherwise (headings exist, but none is focused -- e.g. invoked
 *     from the command palette with nothing selected) -> a new
 *     top-level heading at the BOTTOM of the file, so the command is
 *     never simply a silent no-op just because nothing happened to be
 *     focused when it was run.
 *
 * `opts` is passed straight through to createHeading (e.g. `{ todo:
 * 'TODO' }` for M-S-RET). No-op if there's no open document.
 */
function insertHeadingSmart(opts) {
  if (!S.state.doc) return;
  let heading;
  if (S.state.doc.children.length === 0) {
    heading = insertTopLevelHeading(S.state.doc, opts, true); // "top of file" -- doc is empty, so prepend vs. append makes no practical difference, but this names the intent
  } else if (S.keyboardFocusedHeading) {
    heading = insertHeadingAfter(S.state.doc, S.keyboardFocusedHeading, opts);
  } else {
    heading = insertTopLevelHeading(S.state.doc, opts); // bottom of file
  }
  if (heading) {
    setKeyboardFocusToHeading(heading);
    startEditingTitle(heading, true);
  }
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
  // Bare left/right have no other meaning anywhere in this app (only
  // their Shift forms do, for table-cell navigation) -- added here
  // specifically so the floating keyboard's own \u2190/\u2192 buttons (see
  // src-browser/floating-keyboard.js) are never dead, using the
  // conventional collapse/expand-one-level pairing every outline-style
  // tree view uses. A genuinely new capability, not a rebinding of an
  // existing one -- see the README's own note on this.
  '<left>': () => {
    if (!S.keyboardFocusedHeading) return;
    collapseFully(S.keyboardFocusedHeading);
    render();
  },
  '<right>': () => {
    if (!S.keyboardFocusedHeading) return;
    expandOneLevel(S.keyboardFocusedHeading);
    render();
  },
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
  'M-RET': () => insertHeadingSmart({}),
  'M-S-RET': () => insertHeadingSmart({ todo: 'TODO' }),
  'C-c C-c': () => {
    if (S.keyboardFocusedBodyRow && S.keyboardFocusedBodyRow.rowType === 'block') return executeFocusedBlock();
    return godModeNotSupported('checkbox toggling needs a finer keyboard focus than headings -- tap the checkbox directly; C-c C-c runs a source block when the cursor is on one');
  },

  // Section 3: TODOs & Task Management
  'C-c C-t': () => S.keyboardFocusedHeading && openTodoOrPickWorkflow(S.keyboardFocusedHeading),
  'C-c ,': () => cyclePriorityFor(S.keyboardFocusedHeading),
  'C-c C-x e': () => openEffortEditor(S.keyboardFocusedHeading),
  'C-c C-w': () => S.keyboardFocusedHeading && openRefilePicker(S.keyboardFocusedHeading),
  'C-c C-a': () => S.keyboardFocusedHeading && openAttachChoicePrompt(S.keyboardFocusedHeading, { viaKeys: true }),
  'C-c C-x C-i': () => S.keyboardFocusedHeading && clockInHeading(S.keyboardFocusedHeading),
  'C-c C-x C-o': () => {
    const running = findHeadingWithRunningClock(S.state.doc);
    if (running) clockOutHeading(running);
    else setStatus('No clock is currently running.');
  },
  'C-c C-x C-q': () => {
    const running = findHeadingWithRunningClock(S.state.doc);
    if (running) clockCancelHeading(running);
    else setStatus('No clock is currently running.');
  },
  'C-c C-x C-x': () => clockContinue(),
  'C-c C-x C-j': () => clockGoto(),
  'C-u C-c C-x C-j': () => clockGotoRecent(),
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
  'C-c C-e': () => {
    if (!S.state.doc) return;
    moreBtn.click();
    S.moreMenuStep = 'export';
    S.exportFormat = null;
    renderMoreMenu();
  },
  'C-h m': () => {
    S.moreOpen = false;
    renderMoreMenu();
    openOrSwitchToHelp();
  },
  // C-h a is Emacs's apropos-command, "find the commands that match": this app's command palette does just that. On the
  // keys it is `h SPC a`, like `h SPC m`, since a bare `a` after `h` would mean C-a.
  'C-h a': () => {
    S.godModeActive = false;
    openCommandPalette();
  },
  'C-s': () => searchBtn.click(),
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
  'C-x C-s': () => saveCurrent(),
  'C-x C-w': () => openFileMenuAt('saveas'),
  'C-x C-f': () => openFileMenuAt('open'),
  'C-x C-q': () => {
    S.godModeActive = false; // otherwise renderMinibuffer's own god-mode-sequence-indicator immediately overwrites this action's own status message on the very same render() below, since god-mode intentionally stays active after a successful dispatch
    toggleBufferReadOnly();
  },
  // Redo, real god-mode's own actual way: Emacs's own undo has no separate
  // redo command -- redo IS undo, applied to the undo history itself, which
  // only works once the undo chain has been broken by some other command
  // (real Emacs: moving point is enough). god-mode's own C-f (forward-char)
  // is the conventional affirming keystroke for this. This app's own
  // undo/redo is a clean, separate pair rather than Emacs's own undo-of-undo
  // trick, so C-f here just arms the NEXT C-/ to mean redo instead of undo
  // -- consumed only by something other than C-f/C-/ itself, so "C-f, then
  // C-/ repeatedly" keeps redoing, matching real god-mode's own behavior,
  // and running out of redo (or skipping C-f) falls back to a plain undo.
  'C-f': () => {
    S.godModeRedoArmed = true;
  },
  'C-/': () => {
    if (S.godModeRedoArmed && canRedo(S.history)) {
      performRedo();
    } else {
      S.godModeRedoArmed = false;
      performUndo();
    }
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
 *  the palette's Toggle read-only command, so neither duplicates the
 *  other's own logic. */
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
  writable: () => (S.isBufferReadOnly ? 'the buffer is read-only \u2014 run Toggle read-only (C-x C-q)' : null),
  storage: () => (S.state.storageKind ? null : 'this document has no file yet \u2014 use Save as'),
  narrowed: () => (S.narrowedHeading ? null : 'nothing is narrowed'),
  undo: () => (canUndo(S.history) ? null : 'nothing to undo'),
  redo: () => (canRedo(S.history) ? null : 'nothing to redo'),
  clock: () => (S.state.doc && findHeadingWithRunningClock(S.state.doc) ? null : 'no clock is running'),
  // unlike `clock`, any open tab counts: org-clock-goto is most useful exactly when the clock is somewhere else
  anyClock: () => (findRunningClockAcrossSessions() ? null : 'no clock is running'),
  anyClocked: () => (recentlyClockedAcrossSessions(1).length ? null : 'nothing has been clocked yet'),
  calendar: () => (effectiveCalendarConfig() ? null : 'no calendar address is set (Settings \u2192 Calendar)'),
  contacts: () => (effectiveContactsConfig() ? null : 'no contacts address is set (Settings \u2192 Contacts)'),
  captureShortcuts: () => (platform.captureShortcuts.supported() ? null : 'only in the Android app'),
  orgPwaFolder: () => (platform.attachments.supported() ? null : 'only in the Android app'),
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

/** The palette command whose real Emacs/Org function name is `name`, or null.
 *  This is what a quoted function in an Extras-menu entry (`'org-clock-out`)
 *  resolves to, so the two vocabularies are one. */
export function findPaletteCommandByOrgName(name) {
  return paletteCommandList().find((command) => command.orgName === name) || null;
}

/** Runs `command` against `target` exactly as the palette does: a command that
 *  is unavailable right now says why instead of doing nothing, and one that
 *  throws says so. Shared by the palette itself and the Extras menu. */
export function runPaletteCommand(command, target) {
  const reason = paletteUnavailableReason(command, target);
  if (reason) {
    setStatus(`${command.label}: ${reason}.`);
    render();
    return;
  }
  try {
    command.run(target);
  } catch (err) {
    setStatus(`${command.label} failed: ${err.message}`);
    render();
  }
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
  const exportAs = (format) => () => performExport(format, null);
  // More > Import opened on one format's panel, the way the C-c C-e chord opens More > Export (moreBtn toggles the menu, and the
  // palette has closed it by the time a command runs)
  const openImport = (format) => {
    moreBtn.click();
    S.moreMenuStep = 'import';
    S.importFormat = format;
    S.importPickingHeading = false;
    renderMoreMenu();
  };

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
    { id: 'add-heading', label: 'Add heading after', orgName: 'org-insert-heading', keys: 'M-RET', group: 'Heading', needs: ['doc', 'writable'], run: chord('M-RET') },
    { id: 'add-todo-heading', label: 'Add TODO heading after', orgName: 'org-insert-todo-heading', keys: 'M-S-RET', group: 'Heading', needs: ['doc', 'writable'], run: chord('M-S-RET') },
    { id: 'promote', label: 'Promote subtree', orgName: 'org-promote-subtree', keys: 'M-<left>', group: 'Heading', needs: HEAD, run: chord('M-<left>') },
    { id: 'demote', label: 'Demote subtree', orgName: 'org-demote-subtree', keys: 'M-<right>', group: 'Heading', needs: HEAD, run: chord('M-<right>') },
    { id: 'move-up', label: 'Move subtree up', orgName: 'org-move-subtree-up', keys: 'M-<up>', group: 'Heading', needs: HEAD, run: chord('M-<up>') },
    { id: 'move-down', label: 'Move subtree down', orgName: 'org-move-subtree-down', keys: 'M-<down>', group: 'Heading', needs: HEAD, run: chord('M-<down>') },
    { id: 'cut', label: 'Cut subtree', orgName: 'org-cut-subtree', keys: 'C-c C-x C-w', group: 'Heading', needs: HEAD, run: chord('C-c C-x C-w') },
    { id: 'paste', label: 'Paste subtree', orgName: 'org-paste-subtree', keys: 'C-c C-x C-y', group: 'Heading', needs: HEAD, run: chord('C-c C-x C-y') },
    { id: 'archive', label: 'Archive subtree', orgName: 'org-archive-subtree', group: 'Heading', needs: [...HEAD, 'notArchived'], run: onHeading(openArchiveConfirmPrompt) },
    { id: 'unarchive', label: 'Unarchive (restore)', orgName: 'org-unarchive-subtree', group: 'Heading', needs: [...HEAD, 'archived'], run: onHeading(unarchiveHeadingToOriginalLocation) },
    { id: 'refile', label: 'Refile', orgName: 'org-refile', keys: 'C-c C-w', group: 'Heading', needs: HEAD, run: onHeading(openRefilePicker) },
    { id: 'attach', label: 'Attachments', orgName: 'org-attach', keys: 'C-c C-a', group: 'Heading', keywords: ['attach', 'file', 'audio', 'record'], needs: HEAD, run: onHeading(openAttachChoicePrompt) },
    { id: 'narrow', label: 'Narrow to subtree', orgName: 'org-narrow-to-subtree', keys: 'C-x n s', group: 'Heading', needs: ['doc', 'heading'], run: chord('C-x n s') },
    { id: 'widen', label: 'Widen', orgName: 'widen', keys: 'C-x n w', group: 'Heading', needs: ['doc', 'narrowed'], run: () => widen() },

    // -- Clocking
    { id: 'clock-in', label: 'Clock in', orgName: 'org-clock-in', keys: 'C-c C-x C-i', group: 'Clocking', needs: HEAD, run: onHeading(clockInHeading) },
    { id: 'clock-out', label: 'Clock out', orgName: 'org-clock-out', keys: 'C-c C-x C-o', group: 'Clocking', needs: ['doc', 'clock'], run: () => clockOutHeading(runningClock()) },
    { id: 'clock-cancel', label: 'Cancel clock', orgName: 'org-clock-cancel', keys: 'C-c C-x C-q', group: 'Clocking', needs: ['doc', 'clock'], run: () => clockCancelHeading(runningClock()) },
    { id: 'clock-continue', label: 'Continue last clock', orgName: 'org-clock-in-last', keys: 'C-c C-x C-x', group: 'Clocking', needs: ['doc'], run: () => clockContinue() },
    { id: 'clock-goto', label: 'Go to clocked task', orgName: 'org-clock-goto', keys: 'C-c C-x C-j', group: 'Clocking', keywords: ['jump', 'running', 'current'], needs: ['doc', 'anyClock'], run: chord('C-c C-x C-j') },
    { id: 'clock-goto-recent', label: 'Go to a recently clocked task', orgName: 'org-clock-select-task', keys: 'C-u C-c C-x C-j', group: 'Clocking', keywords: ['history', 'recent', 'select', 'list'], needs: ['doc', 'anyClocked'], run: chord('C-u C-c C-x C-j') },

    // -- Document
    { id: 'save', label: 'Save', orgName: 'save-buffer', keys: 'C-x C-s', group: 'Document', needs: ['doc', 'storage'], run: () => saveCurrent() },
    { id: 'save-as', label: 'Save as\u2026', orgName: 'write-file', keys: 'C-x C-w', group: 'Document', needs: ['doc'], run: () => openFileMenuAt('saveas') },
    { id: 'open', label: 'Open file\u2026', orgName: 'find-file', keys: 'C-x C-f', group: 'Document', run: () => openFileMenuAt('open') },
    { id: 'new', label: 'New document', group: 'Document', run: () => createNewUnsavedDocument() },
    { id: 'undo', label: 'Undo', orgName: 'undo', keys: 'C-/', group: 'Document', needs: ['doc', 'undo'], run: () => performUndo() },
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
    { id: 'calendar-sync', label: 'Sync agenda to calendar', group: 'View', keywords: ['caldav', 'calendar', 'radicale', 'mirror', 'events'], needs: ['calendar'], run: () => syncAgendaToCalendar({ manual: true }) },
    { id: 'contacts-sync', label: 'Sync contacts to the address book', group: 'View', keywords: ['carddav', 'contacts', 'address book', 'radicale', 'mirror', 'vcard'], needs: ['contacts'], run: () => syncContactsToAddressBook({ manual: true }) },
    { id: 'contacts-rebuild', label: 'Rebuild contacts from the contacts files', group: 'View', keywords: ['carddav', 'contacts', 'address book', 'radicale', 'mirror', 'reset', 'vcard'], needs: ['contacts'], run: () => syncContactsToAddressBook({ manual: true, rebuild: true }) },
    { id: 'calendar-rebuild', label: 'Rebuild calendar from the agenda', group: 'View', keywords: ['caldav', 'calendar', 'radicale', 'mirror', 'reset'], needs: ['calendar'], run: () => syncAgendaToCalendar({ manual: true, rebuild: true }) },
    { id: 'tasklist', label: 'TODO list', orgName: 'org-todo-list', keys: 'C-c C-v', group: 'View', keywords: ['tasks'], needs: ['doc'], run: chord('C-c C-v') },
    { id: 'view-org', label: 'Outline view', orgName: 'org-mode', group: 'View', keywords: ['org'], needs: ['doc'], run: () => switchToView('org') },
    { id: 'view-text', label: 'Text view', orgName: 'text-mode', group: 'View', keywords: ['raw', 'source'], needs: ['doc'], run: () => switchToView('text') },
    { id: 'cycle-visibility', label: 'Cycle visibility of the whole document', orgName: 'org-global-cycle', keys: 'S-TAB', group: 'View', keywords: ['fold', 'unfold', 'collapse', 'expand'], needs: ['doc'], run: () => globalCycleFold() },
    { id: 'calendar', label: 'Calendar', orgName: 'calendar', group: 'View', needs: ['doc'], run: () => openCalendarPanel() },
    { id: 'search', label: 'Search', orgName: 'isearch-forward', keys: 'C-s', group: 'View', keywords: ['find', 'replace'], run: () => searchBtn.click() },

    // -- Export
    {
      id: 'export',
      label: 'Export\u2026',
      orgName: 'org-export-dispatch',
      keys: 'C-c C-e',
      group: 'Export',
      needs: ['doc'],
      run: chord('C-c C-e'),
    },
    { id: 'export-html', label: 'Export this file as HTML', orgName: 'org-html-export-to-html', group: 'Export', needs: ['doc'], run: exportAs('html') },
    { id: 'export-markdown', label: 'Export this file as Markdown', orgName: 'org-md-export-to-markdown', group: 'Export', needs: ['doc'], run: exportAs('markdown') },
    { id: 'export-ascii', label: 'Export this file as ASCII', orgName: 'org-ascii-export-to-ascii', group: 'Export', needs: ['doc'], run: exportAs('ascii') },
    { id: 'export-odt', label: 'Export this file as ODT', orgName: 'org-odt-export-to-odt', group: 'Export', needs: ['doc'], run: exportAs('odt') },
    // Two commands that used to exist only as Extras-menu functions; now ordinary palette commands, so every
    // quoted function an Extras entry can name is a palette command (see runExtraMenuEntry)
    // -- Import: the two panels of More > Import, opened the way C-c C-e opens More > Export
    { id: 'import-vcard', label: 'Import Contacts (.vcf)', orgName: 'org-vcard-import', group: 'Import', keywords: ['vcard', 'vcf', 'contacts', 'address book'], needs: ['doc'], run: () => openImport('vcard') },
    { id: 'import-icalendar', label: 'Import iCalendar (.ics)', orgName: 'icalendar-import-file', group: 'Import', keywords: ['ics', 'ical', 'calendar', 'events'], needs: ['doc'], run: () => openImport('icalendar') },
    { id: 'export-org', label: 'Export as an Org buffer', orgName: 'org-org-export-as-org', group: 'Export', needs: ['doc'], run: () => performOrgOrgExport() },
    { id: 'babel-execute', label: 'Run source block', orgName: 'org-babel-execute-src-block', keys: 'C-c C-c', group: 'Document', keywords: ['babel', 'javascript', 'js', 'execute', 'code'], needs: ['doc', 'writable'], run: () => executeFocusedBlock() },
    { id: 'recalculate-tables', label: 'Recalculate all tables', orgName: 'org-table-recalculate-buffer-tables', group: 'Document', keywords: ['formula', 'TBLFM'], needs: ['doc', 'writable'], run: () => recalculateAllTables() },

    // -- App
    { id: 'settings', label: 'Settings', orgName: 'customize', group: 'App', run: () => settingsBtn.click() },
    { id: 'help', label: 'Help', orgName: 'describe-mode', keys: 'C-h m', group: 'App', keywords: ['readme', 'docs', 'manual'], run: chord('C-h m') },
    { id: 'display-info', label: 'Show display measurements', group: 'App', keywords: ['status bar', 'inset', 'viewport', 'keyboard', 'screen', 'notch', 'debug'], run: () => showDisplayMeasurements() },
    { id: 'capture-icon', label: 'Add a capture icon to the home screen', group: 'App', keywords: ['shortcut', 'launcher', 'pin', 'capture template'], needs: ['captureShortcuts'], run: () => addCaptureIconToHomeScreen() },
    { id: 'org-pwa-folder', label: 'Choose the org-pwa folder', group: 'App', keywords: ['folder', 'local', 'attachments', 'attach', 'documents', 'data'], needs: ['orgPwaFolder'], run: () => chooseAttachmentsFolder() },
  ].concat(extensionPaletteEntries());
}

/** Opens the palette. Resolves once it closes. */
export async function openCommandPalette() {
  if (S.confirmDialogOpen) return;
  const target = extraMenuTargetHeading();
  if (S.paletteRecentIds === null) S.paletteRecentIds = await loadPaletteRecent();
  const commands = [...paletteCommandList(), ...(await paletteDynamicCommands())];

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
    const available = !paletteUnavailableReason(command, target);
    finish();
    if (available) {
      S.paletteRecentIds = pushRecent(S.paletteRecentIds, command.id);
      kv.set(PALETTE_RECENT_KEY, JSON.stringify(S.paletteRecentIds)).catch(() => {});
    }
    runPaletteCommand(command, target);
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


/**
 * The commands that come from the person's own configuration -- one per
 * capture template and one per Extras-menu entry (see dynamicCommandSpecs in
 * src/command-palette.js for the naming) -- so either can be run by name.
 * Read fresh each time the palette opens, so an edited template list or a
 * different document's Extras menu is always current.
 */
async function paletteDynamicCommands() {
  let templates = [];
  try {
    templates = await getCaptureTemplates(kv);
  } catch {
    templates = []; // a broken template list must never stop the palette opening
  }
  const extraEntries = S.state && S.state.localVariables ? parseExtraMenu(getExtraMenu(S.state.localVariables)) : [];
  return dynamicCommandSpecs({ templates, extraEntries }).map((spec) => ({
    ...spec,
    run:
      spec.source === 'capture'
        ? () => {
            // the same steps as the C-c c chord, then straight to this template
            closeAllOverlayPanels();
            S.captureOpen = true;
            render();
            return openCapturePrompt(templates[spec.index]);
          }
        : () => runExtraMenuEntry(extraEntries[spec.index]),
  }));
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

/** chord -> the palette's own label for the command bound to it, built once
 *  from the palette's list so the two can never disagree about a name. Each
 *  chord is bound to at most one palette command (checked when this was added). */
const CHORD_LABELS = new Map();

/** The palette label for the command a completed chord runs, or null when the
 *  chord has no palette command (Tab, the arrows, C-f, ...). */
export function labelForChord(chordString) {
  if (CHORD_LABELS.size === 0) {
    for (const command of paletteCommandList()) {
      if (command.keys && !CHORD_LABELS.has(command.keys)) CHORD_LABELS.set(command.keys, command.label);
    }
  }
  return CHORD_LABELS.get(chordString) || null;
}

/**
 * Activates god-mode: resets the in-progress key sequence, and -- if no
 * heading is currently keyboard-focused -- focuses the first visible one,
 * so a heading-targeted chord always has something to act on. Shared by
 * the real Escape key's own entry path and the [g] toolbar button (see
 * src-browser/floating-keyboard.js), which layers its own extra setup
 * (the floating keyboard, the hidden input for the native keyboard) on
 * top of this same common part. Does NOT call render() or scroll the
 * focused heading into view -- callers do that themselves, since the
 * right moment differs slightly between the two (the floating keyboard
 * needs to focus its own hidden input first).
 */
export function enterGodMode() {
  S.godModeActive = true;
  S.godModeState = godModeInitialState();
  S.godModeLastCommand = null;
  // Keyboard focus survives a tab or document switch, so it can be left over
  // from ANOTHER document: a heading that isn't in this one, which every
  // heading-targeted chord would then silently fail on. (A real Escape masks
  // this -- its first press clears focus -- but the [g] button has no such step.)
  if (S.keyboardFocusedHeading && !(S.state.doc && findAncestorPath(S.state.doc, S.keyboardFocusedHeading))) {
    setKeyboardFocusToHeading(null);
  }
  if (!S.keyboardFocusedHeading) {
    const headings = visibleHeadingsInOrder();
    if (headings.length > 0) setKeyboardFocusToHeading(headings[0]);
  }
}

/**
 * Processes one god-mode keystroke -- real or synthesized -- through
 * exactly the same logic regardless of where it came from: a real
 * keydown while `S.godModeActive`, or a tap on the floating keyboard's
 * own buttons (see src-browser/floating-keyboard.js). Neither caller
 * needs to know anything about chord-building, the i/a/e special
 * cases, or the redo-arm reset -- that's the whole point of sharing
 * this, so the two routes provably can't drift apart.
 *
 * `rawKey` is a raw key name exactly as `KeyboardEvent.key` would give
 * it (a single character like 'g', or a named key like 'Tab' /
 * 'ArrowUp' / 'Enter'), `shiftKey` whether Shift applies. Does NOT
 * call `e.preventDefault()` -- callers with a real DOM event handle
 * that themselves, since a synthesized call has no event to prevent.
 * Does NOT check for a bare modifier keypress (Shift/Control/Alt/Meta
 * alone) either -- callers filter that out first, since it's specific
 * to real keydown events and never arises from a button tap.
 */
export function dispatchGodModeKeystroke(rawKey, shiftKey) {
  S.godModeLastCommand = null; // any new keystroke starts over: the minibuffer shows the sequence being built, not the last result
  const freshSequence = S.godModeState.chordString === '' && S.godModeState.pendingModifier === null && !S.godModeState.literalActive;
  if (freshSequence && !shiftKey && rawKey === 'i') {
    enterInsertModeAtCurrentLine();
    render();
    return;
  }
  // a and e don't run a command: they only choose where the cursor lands when i
  // opens the editor next. They used to return without redrawing, so the minibuffer
  // gave no sign the key had registered (and could keep showing the previous
  // command's name); they now say what they did, the same way a chord does.
  if (freshSequence && !shiftKey && rawKey === 'a') {
    S.pendingCursorPosition = 'start';
    S.godModeLastCommand = { chord: 'C-a', label: 'edit at start (press i)' };
    render();
    return;
  }
  if (freshSequence && !shiftKey && rawKey === 'e') {
    S.pendingCursorPosition = 'end';
    S.godModeLastCommand = { chord: 'C-e', label: 'edit at end (press i)' };
    render();
    return;
  }
  const { state: newState, chordString } = godModeProcessKey(S.godModeState, rawKey, shiftKey);
  S.godModeState = newState;
  const stillWaiting = newState.pendingModifier !== null;
  if (!stillWaiting && chordString in GOD_MODE_ACTIONS) {
    // C-f arms the next C-/ to mean redo instead of undo (see that
    // chord's own comment); any OTHER action breaks the chain back to
    // plain undo, matching real Emacs -- almost any command does.
    if (chordString !== 'C-f' && chordString !== 'C-/') S.godModeRedoArmed = false;
    // named in the minibuffer once it has run, so it is clear what was executed
    S.godModeLastCommand = { chord: chordString, label: labelForChord(chordString) };
    GOD_MODE_ACTIONS[chordString]();
    S.godModeState = godModeInitialState();
  } else if (!stillWaiting && !isValidGodModePrefix(chordString)) {
    setStatus(`God-mode: "${chordString}" isn\u2019t a recognized sequence.`);
    S.godModeState = godModeInitialState();
  }
  render();
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
