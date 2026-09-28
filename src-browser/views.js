// Extracted from app.js: views.
import { resolveLinkTarget } from '../src/link-resolve.js';
import { getMenuAliases } from '../src/local-variables.js';
import { parseMenuAliases } from '../src/menu-alias.js';
import { parseOrg } from '../src/org-parser.js';
import { S } from './app-state.js';
import { closeAllOverlayPanels, scrollContainer } from './chrome.js';
import { HELP_DOCUMENT_ID, NAVIGATION_BACK_STACK_LIMIT } from './constants.js';
import { afterDocumentLoaded } from './documents-io.js';
import { viewMenuBtn, viewMenuPanel } from './dom.js';
import { commitTextModeIfActive, setStatus } from './editing.js';
import { toggleBufferReadOnly } from './god-mode-palette.js';
import { navigateToHeading, syncNavBackButtonVisibility } from './navigation.js';
import { render } from './render.js';
import { renderSearchPanel } from './search-ui.js';
import { aliasedMenuDivItem, appendMenuButtonsInOrder, menuDivItem, positionPopupNearButton } from './ui-widgets.js';

/** Switches between the three top-level views, handling the
 *  enter/exit bookkeeping each transition needs: leaving 'text' commits
 *  its content into state.doc first (the fix from a previous bug — never
 *  read a stale doc); leaving 'org' clears outline edit state, since
 *  nothing should be mid-edit while the outline isn't even shown. */
export function switchToView(view) {
  if (S.settingsOpen) {
    S.settingsOpen = false;
    render();
  }
  if (S.historyOpen) {
    S.historyOpen = false;
    render();
  }
  if (view === S.currentView) {
    S.viewMenuOpen = false;
    renderViewMenu();
    return;
  }

  if (S.currentView === 'text') {
    commitTextModeIfActive();
  } else if (S.currentView === 'org') {
    S.editingHeading = null;
    S.editingIsNew = false;
    S.editingCell = null;
    S.editingParagraph = null;
    S.editingListItem = null;
    S.editingHeadingText = null;
    S.editingGeneral = null;
    S.actionMenuFor = null;
    S.keyboardFocusedBodyRow = null;
    S.keyboardFocusedCellPos = null;
  }

  if (view === 'text' && S.searchOpen) {
    // Entering text mode means the document could be reparsed (new
    // object identities) the next time it's left — any search result
    // currently held would reference objects that no longer exist by
    // the time it's tapped. Closing search here removes that
    // possibility rather than leaving stale results sitting around.
    S.searchOpen = false;
    S.searchQuery = '';
    renderSearchPanel();
  }

  S.currentView = view;
  S.viewMenuOpen = false;
  renderViewMenu();
  render();
}

export function renderViewMenu() {
  renderViewMenuContent();
  if (S.viewMenuOpen) positionPopupNearButton(viewMenuPanel, viewMenuBtn);
}

export function renderViewMenuContent() {
  viewMenuPanel.innerHTML = '';
  if (!S.viewMenuOpen) {
    viewMenuPanel.style.display = 'none';
    return;
  }
  viewMenuPanel.style.display = 'block';

  const viewMenuAliases = parseMenuAliases(getMenuAliases(S.state.localVariables)).view;
  const viewSwitchButtons = {};
  for (const [key, label] of [
    ['agenda', 'Agenda'],
    ['org', 'Org'],
    ['text', 'Text'],
    ['tasklist', 'TODO'],
  ]) {
    const btn = aliasedMenuDivItem(viewMenuAliases, label, () => switchToView(key));
    if (btn && key === S.currentView) btn.style.fontWeight = '700';
    viewSwitchButtons[label] = btn;
  }

  appendMenuButtonsInOrder(viewMenuPanel, viewMenuAliases, [
    { label: 'Agenda', btn: viewSwitchButtons['Agenda'] },
    { label: 'Org', btn: viewSwitchButtons['Org'] },
    { label: 'Text', btn: viewSwitchButtons['Text'] },
    { label: 'TODO', btn: viewSwitchButtons['TODO'] },
  ]);

  // Read-only toggle -- a separate, un-aliased item (not part of the
  // menu-alias system above), since its own label text is dynamic
  // (changes between the two states below) rather than the fixed string
  // that system expects to match against. Shows the ACTION tapping it
  // would perform, not the current state -- "%%RO" (make it read-only)
  // while currently writable, "**RW" (make it writable) while currently
  // read-only, matching real Emacs's own -- / ** / %% / %* modeline
  // convention this app's own modeline already shows (see
  // buildGlobalModeStringParts's own caller, renderModeline).
  const roToggle = menuDivItem(S.isBufferReadOnly ? '**RW' : '%%RO', () => {
    toggleBufferReadOnly();
    S.viewMenuOpen = false;
    renderViewMenu();
  }, !S.state.doc);
  viewMenuPanel.appendChild(roToggle);
}

/** Opens Help by fetching and opening README.org through the exact
 *  same pipeline any other document uses (afterDocumentLoaded) --
 *  read-only (its own first-line cookie), first-visit-collapsed (its
 *  own #+STARTUP: line), and "switch to it if it's already open as a
 *  tab" (afterDocumentLoaded's own existing, general logic) all come
 *  from that pipeline directly, not from anything Help-specific here.
 *  storageKind 'help' -- see storageKindLabel's own one-line case for
 *  it, and updateSaveButtonState's own explicit exclusion of it (a
 *  real, truthy string, so the usual falsy-storageKind check alone
 *  wouldn't have disabled Save on its own). */
export async function openOrSwitchToHelp() {
  closeAllOverlayPanels();
  try {
    const response = await fetch('./README.org');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    await afterDocumentLoaded(HELP_DOCUMENT_ID, parseOrg(text), 'help');
  } catch (err) {
    setStatus("Couldn't load Help (" + err.message + '). Try again once you\u2019re back online.');
    render();
  }
}

/** Opens Help and scrolls directly to a specific section, identified
 *  by its CUSTOM_ID anchor (e.g. "#capture-templates") -- the same
 *  resolution resolveLinkTarget already uses for [[#id][...]]-style
 *  links, and the same navigateToHeading every other internal-link
 *  jump in this app already uses. Used by Settings' own hotlinks to
 *  the corresponding help section, so a streamlined settings hint can
 *  point at the full documentation instead of duplicating it inline. */
export async function openDocsAtHeading(anchorId) {
  S.navigationBackStack.push({
    view: S.currentView,
    settingsOpen: S.settingsOpen,
    documentId: S.state.documentId,
    storageKind: S.state.storageKind,
    scrollTop: scrollContainer().scrollTop,
  });
  if (S.navigationBackStack.length > NAVIGATION_BACK_STACK_LIMIT) S.navigationBackStack.shift();
  syncNavBackButtonVisibility();

  await openOrSwitchToHelp();
  if (!S.state.doc || S.state.documentId !== HELP_DOCUMENT_ID) return; // load failed -- openOrSwitchToHelp already showed its own error message

  const resolution = resolveLinkTarget(S.state.doc, anchorId);
  if (resolution.type !== 'heading') return; // an unresolvable anchor is a documentation bug, not something to surface as a runtime error

  navigateToHeading(resolution.heading, { pushToBackStack: false, revealOwnBody: true });
}
