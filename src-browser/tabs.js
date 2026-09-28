// Extracted from app.js: tabs.
import { syncAgendaFilesConfig, syncContactsFilesConfig } from './agenda-files.js';
import { S } from './app-state.js';
import { closeAllOverlayPanels, scrollContainer } from './chrome.js';
import { HELP_DOCUMENT_ID } from './constants.js';
import { confirmDialog } from './dialogs.js';
import { createNewUnsavedDocument } from './documents-io.js';
import { outlineEl, tabBarEl } from './dom.js';
import { commitTextModeIfActive } from './editing.js';
import { checkForExternalChange, hideExternalChangeBanner } from './external-sync.js';
import { render } from './render.js';
import { setLastActiveDocument, setOpenTabs } from './settings.js';
import { kv } from './singletons.js';
import { documentDisplayLabel } from './sync-helpers.js';
import { openOrSwitchToHelp } from './views.js';

/** Reads the CURRENT live value of every per-document global into a
 *  plain object -- this, and its counterpart below, are the only two
 *  places that need to know the full list of per-document state at
 *  all; every other read/write site throughout this file keeps using
 *  the same global variable names exactly as before. */
export function snapshotCurrentSessionValues() {
  return {
    state: S.state,
    editingHeading: S.editingHeading,
    editingIsNew: S.editingIsNew,
    editingCell: S.editingCell,
    editingParagraph: S.editingParagraph,
    editingListItem: S.editingListItem,
    editingHeadingText: S.editingHeadingText,
    editingGeneral: S.editingGeneral,
    actionMenuFor: S.actionMenuFor,
    keyboardFocusedHeading: S.keyboardFocusedHeading,
    keyboardFocusedBodyRow: S.keyboardFocusedBodyRow,
    keyboardFocusedCellPos: S.keyboardFocusedCellPos,
    pendingCursorPosition: S.pendingCursorPosition,
    currentContextHeading: S.currentContextHeading,
    narrowedHeading: S.narrowedHeading,
    narrowedTextModeRange: S.narrowedTextModeRange,
    navigationBackStack: S.navigationBackStack,
    currentView: S.currentView,
    isDirty: S.isDirty,
    isBufferReadOnly: S.isBufferReadOnly, // buffer-local in Emacs, so per tab here too
    lastSavedText: S.lastSavedText,
    history: S.history,
    historyOpen: S.historyOpen,
    historyDiffExpandedIndex: S.historyDiffExpandedIndex,
    lastGlobalFoldState: S.lastGlobalFoldState,
    externalChangeDismissedHash: S.externalChangeDismissedHash,
    externalChangeShownForHash: S.externalChangeShownForHash,
    activeQueryReplace: S.activeQueryReplace,
  };
}

/** The inverse of snapshotCurrentSessionValues() -- writes each saved
 *  value back into its own same-named global, restoring exactly the
 *  state a tab was in the last time it was active. */
export function applySessionSnapshotValues(snap) {
  S.state = snap.state;
  S.editingHeading = snap.editingHeading;
  S.editingIsNew = snap.editingIsNew;
  S.editingCell = snap.editingCell;
  S.editingParagraph = snap.editingParagraph;
  S.editingListItem = snap.editingListItem;
  S.editingHeadingText = snap.editingHeadingText;
  S.editingGeneral = snap.editingGeneral;
  S.actionMenuFor = snap.actionMenuFor;
  S.keyboardFocusedHeading = snap.keyboardFocusedHeading;
  S.keyboardFocusedBodyRow = snap.keyboardFocusedBodyRow;
  S.keyboardFocusedCellPos = snap.keyboardFocusedCellPos;
  S.pendingCursorPosition = snap.pendingCursorPosition;
  S.currentContextHeading = snap.currentContextHeading;
  S.narrowedHeading = snap.narrowedHeading;
  S.narrowedTextModeRange = snap.narrowedTextModeRange;
  S.navigationBackStack = snap.navigationBackStack;
  S.currentView = snap.currentView;
  S.isDirty = snap.isDirty;
  S.isBufferReadOnly = snap.isBufferReadOnly;
  S.lastSavedText = snap.lastSavedText;
  S.history = snap.history;
  S.historyOpen = snap.historyOpen;
  S.historyDiffExpandedIndex = snap.historyDiffExpandedIndex;
  S.lastGlobalFoldState = snap.lastGlobalFoldState;
  S.externalChangeDismissedHash = snap.externalChangeDismissedHash;
  S.externalChangeShownForHash = snap.externalChangeShownForHash;
  S.activeQueryReplace = snap.activeQueryReplace;
}

/** Writes the live globals' current values into documentSessions'
 *  entry for `tabId` (creating it first if this is a brand new tab).
 *  Called before switching away from a tab, and periodically while
 *  editing it, so a session object is never more than one edit stale. */
export function saveSessionSnapshot(tabId) {
  if (tabId == null) return;
  const values = snapshotCurrentSessionValues();
  const scrollTop = scrollContainer().scrollTop;
  const existing = S.documentSessions.find((s) => s.tabId === tabId);
  if (existing) {
    Object.assign(existing, values);
    existing.scrollTop = scrollTop;
  } else {
    S.documentSessions.push({ tabId, scrollTop, ...values });
  }
}

/** Loads `tabId`'s own saved session values back into the live
 *  globals, restoring its scroll position too (deferred until after
 *  the render() a caller is about to trigger actually completes --
 *  see the queueMicrotask below). Does nothing (silently) if `tabId`
 *  isn't a real, currently-open session -- callers that need to know
 *  whether the switch actually happened should check documentSessions
 *  themselves first. */
export function loadSessionSnapshot(tabId) {
  const session = S.documentSessions.find((s) => s.tabId === tabId);
  if (!session) return;
  applySessionSnapshotValues(session);
  S.activeTabId = tabId;
  syncAgendaFilesConfig();
  syncContactsFilesConfig();
  queueMicrotask(() => {
    scrollContainer().scrollTop = session.scrollTop || 0;
  });
}

/** Switches the live, on-screen document to `tabId` -- saves the
 *  currently-active tab's own state first (so switching back to it
 *  later picks up exactly where it left off), then loads the target
 *  tab's own saved state, then re-renders. The one function every
 *  tab-bar click handler and keyboard shortcut should actually call;
 *  everything else here is a supporting piece for this one. */
/** Persists the full set of open tabs -- called on every tab-set change
 *  (switch, close, open) so a reload can restore ALL of them, not just
 *  the single most recent document lastActiveDocument alone tracks.
 *  Fire-and-forget, matching persistHistoryInBackground's own "log,
 *  don't interrupt the person's workflow over this" error handling --
 *  losing track of exactly which tabs were open is a real but much
 *  smaller loss than a failed document save. */
export function persistOpenTabsInBackground() {
  const tabs = S.documentSessions.map((s) => {
    const docState = s.tabId === S.activeTabId ? S.state : s.state;
    return { documentId: docState.documentId, storageKind: docState.storageKind };
  });
  const activeIndex = S.documentSessions.findIndex((s) => s.tabId === S.activeTabId);
  setOpenTabs(kv, tabs, activeIndex).catch((err) => console.error('Failed to persist open tabs:', err));
}

export function switchToTab(tabId) {
  if (tabId === S.activeTabId) return;
  // Committing (if there's anything to commit) brings state.doc fully
  // up to date -- and clears narrowedTextModeRange -- for the tab
  // being left, BEFORE the snapshot below captures it. Without this,
  // a pending edit in that tab is silently lost the moment it's
  // switched away from, never having been written into its own
  // state.doc at all.
  commitTextModeIfActive();
  if (S.activeTabId != null) saveSessionSnapshot(S.activeTabId);
  loadSessionSnapshot(tabId);
  closeAllOverlayPanels();
  hideExternalChangeBanner();
  checkForExternalChange();
  // A text-mode textarea left over from the tab just switched AWAY from
  // has no relationship to the tab just switched TO -- render()'s own
  // "already showing the text editor, leave it alone" short-circuit
  // (see the text-view render code) has no notion of which tab built
  // it, only whether one currently exists in the DOM at all. Without
  // this, switching between two tabs both left in Text view shows
  // whichever tab's textarea happened to be built most recently,
  // regardless of which tab is actually now active -- confirmed
  // directly, a real, severe bug: saving in that state overwrites the
  // active tab's own document with the OTHER tab's content entirely.
  // Clearing this here forces a fresh rebuild from the now-correct,
  // just-restored state instead.
  outlineEl.innerHTML = '';
  render();
  renderTabBar();
  persistOpenTabsInBackground();
}

/** Closes `tabId` -- confirms first if that tab's own document has
 *  unsaved changes, matching real Emacs's own kill-buffer behavior
 *  ("Buffer BUFFERNAME modified; kill anyway?"). Choosing not to close
 *  leaves the tab open exactly as it was, unsaved changes and all, so
 *  the person can then use the Save button on it themselves -- this
 *  is deliberately a plain two-choice prompt, not a combined
 *  save-and-close shortcut, the same as real Emacs's own. A clean
 *  (non-dirty) tab still closes immediately, no confirmation: the
 *  existing outbox/cache system already keeps ANY edit safe
 *  independent of which tabs happen to be open, so what this
 *  confirmation actually protects is the person's own intent (did
 *  they mean to set this aside without saving it), not the data
 *  itself. Picks the tab immediately before the closed one as the
 *  next active tab (or the one after, if the first tab was closed),
 *  matching the common browser/editor convention; falls back to this
 *  app's own existing "nothing open" state if that was the last tab
 *  left. */
export async function closeTab(tabId) {
  const index = S.documentSessions.findIndex((s) => s.tabId === tabId);
  if (index === -1) return;
  const session = S.documentSessions[index];
  const dirtyForThisTab = tabId === S.activeTabId ? S.isDirty : session.isDirty;
  if (dirtyForThisTab) {
    const label =
      tabId === S.activeTabId
        ? documentDisplayLabel(S.state.documentId, S.state.doc)
        : documentDisplayLabel(session.state.documentId, session.state.doc);
    const proceed = await confirmDialog(`"${label}" has unsaved changes. Close it anyway?`, {
      confirmLabel: 'Close',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!proceed) return;
  }
  S.documentSessions.splice(index, 1);
  if (tabId !== S.activeTabId) {
    renderTabBar();
    persistOpenTabsInBackground();
    return;
  }
  if (S.documentSessions.length === 0) {
    S.activeTabId = null;
    await createNewUnsavedDocument();
    return;
  }
  const nextIndex = Math.min(index, S.documentSessions.length - 1);
  loadSessionSnapshot(S.documentSessions[nextIndex].tabId);
  hideExternalChangeBanner();
  checkForExternalChange();
  await setLastActiveDocument(kv, S.state.documentId, S.state.storageKind);
  render();
  renderTabBar();
  persistOpenTabsInBackground();
}

/** Rebuilds the tab bar from documentSessions -- hidden entirely with
 *  0 or 1 tabs open (nothing to switch between yet), so it doesn't
 *  cost any vertical space on a small screen until it's actually
 *  useful. Reads each tab's own documentId/isDirty directly from its
 *  saved session snapshot, NOT from the live globals (which only ever
 *  reflect the currently-ACTIVE tab) -- the one exception is the
 *  active tab itself, shown from the live globals so its own label
 *  updates immediately as it's edited, without waiting for the next
 *  tab switch to save a fresh snapshot. */
export function renderTabBar() {
  tabBarEl.innerHTML = '';
  if (S.documentSessions.length < 1) {
    tabBarEl.style.display = 'none';
    return;
  }
  tabBarEl.style.display = 'flex';
  tabBarEl.style.overflowX = 'auto';
  tabBarEl.style.overscrollBehaviorX = 'contain';
  tabBarEl.style.borderBottom = '1px solid var(--border)';
  tabBarEl.style.background = 'var(--surface)';

  // Help always renders last, regardless of when it was opened -- a
  // render-time-only sort, so documentSessions' own order (used
  // elsewhere for tab-cycling) is unaffected.
  const sessionsInOrder = [...S.documentSessions].sort((a, b) => {
    const aIsHelp = a.state.documentId === HELP_DOCUMENT_ID;
    const bIsHelp = b.state.documentId === HELP_DOCUMENT_ID;
    return aIsHelp === bIsHelp ? 0 : aIsHelp ? 1 : -1;
  });

  let activeTabEl = null;
  for (const session of sessionsInOrder) {
    const isActive = session.tabId === S.activeTabId;
    const docId = isActive ? S.state.documentId : session.state.documentId;
    const doc = isActive ? S.state.doc : session.state.doc;
    const dirty = isActive ? S.isDirty : session.isDirty;
    const isHelp = docId === HELP_DOCUMENT_ID;
    const label = documentDisplayLabel(docId, doc);

    const tab = document.createElement('div');
    tab.style.display = 'flex';
    tab.style.alignItems = 'center';
    tab.style.gap = '4px';
    tab.style.padding = '8px 6px 8px 12px';
    tab.style.flexShrink = '0';
    tab.style.maxWidth = '160px';
    tab.style.cursor = 'pointer';
    // Help's own active-tab border is the same gold navigateToHeading's
    // own "go back to" highlight flash uses (rgba(255,214,0,0.45)), not
    // this app's usual blue (--accent) -- distinguishes it from every
    // other, unrelated active-tab border.
    tab.style.borderBottom = isActive ? (isHelp ? '2px solid rgb(255,214,0)' : '2px solid var(--accent)') : '2px solid transparent';
    // Help's own background is this app's existing green convention
    // (DONE-state badges) -- always shown, whether or not it's the
    // currently-active tab, so it reads as "Help exists" at a glance,
    // the same way the dirty indicator is a constant marker rather
    // than only an active-state one.
    tab.style.background = isHelp ? 'var(--done-bg)' : isActive ? 'var(--bg)' : 'transparent';
    tab.onclick = () => (isHelp ? openOrSwitchToHelp() : switchToTab(session.tabId));

    const labelEl = document.createElement('span');
    labelEl.textContent = (dirty ? '\u25cf ' : '') + label;
    labelEl.title = label;
    labelEl.style.overflow = 'hidden';
    labelEl.style.textOverflow = 'ellipsis';
    labelEl.style.whiteSpace = 'nowrap';
    labelEl.style.fontSize = '13px';
    labelEl.style.color = isHelp ? 'var(--done-fg)' : dirty ? '#c0392b' : 'var(--fg)';
    tab.appendChild(labelEl);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.setAttribute('aria-label', 'Close tab: ' + label);
    closeBtn.style.border = 'none';
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = isHelp ? 'var(--done-fg)' : 'var(--muted)';
    closeBtn.style.opacity = isHelp ? '0.7' : '1';
    closeBtn.style.fontSize = '12px';
    closeBtn.style.padding = '6px';
    closeBtn.style.minWidth = '28px';
    closeBtn.style.minHeight = '28px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      closeTab(session.tabId);
    };
    tab.appendChild(closeBtn);

    if (isActive) activeTabEl = tab;
    tabBarEl.appendChild(tab);
  }

  if (activeTabEl) activeTabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
