// @ts-check
// Extracted from app.js: views.
import { getMenuAliases } from '../src/local-variables.js';
import { parseMenuAliases } from '../src/menu-alias.js';
import { isPlainTextFile } from '../src/plain-file.js';
import { S, isAgendaFamilyView } from './app-state.js';
import { agendaRestriction } from './agenda-files.js';
import { closeAllOverlayPanels } from './chrome.js';
import { viewMenuBtn, viewMenuPanel } from './dom.js';
import { commitTextModeIfActive, setStatus } from './editing.js';
import { lookupHelp } from '../src/help-lookup.js';
import { HELP_NODE_BY_HEADING, HELP_NODE_BY_ID } from '../src/help-nodes.js';
import { BUILTIN_MANUAL } from './info-storage.js';
import { openInfo } from './info-view.js';
import { render } from './render.js';
import { renderSearchPanel } from './search-ui.js';
import { aliasedMenuDivItem, appendMenuButtonsInOrder, positionPopupNearButton } from './ui-widgets.js';

/** Switches between the three top-level views, handling the
 *  enter/exit bookkeeping each transition needs: leaving 'text' commits
 *  its content into state.doc first (the fix from a previous bug — never
 *  read a stale doc); leaving 'org' clears outline edit state, since
 * @param {string} view
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
  if (view !== 'text' && S.state.doc && isPlainTextFile(S.state.documentId, S.state.storageKind)) {
    // a plain text file has no headings, so there is nothing to show in the other views
    S.viewMenuOpen = false;
    renderViewMenu();
    setStatus('This is a plain text file \u2014 it opens in Text view only.');
    return;
  }

  if (isAgendaFamilyView(S.currentView) && !isAgendaFamilyView(view)) agendaRestriction.pending = null; // what `<` chose holds while the agenda views are open

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

  if (view !== 'command' && S.currentView === 'command') leaveCommandView(); // the Agenda gets its own span and day back
  if (view !== 'tasklist') S.taskKeywords = null; // a TODO list for some keywords lasts until the screen is left
  S.currentView = view;
  S.viewMenuOpen = false;
  renderViewMenu();
  render();
}

/** Gives the Agenda back the span and day it had before a command's screen. Called when the screen is left. */
function leaveCommandView() {
  const view = S.commandView;
  if (!view) return;
  S.agendaViewType = view.saved.viewType;
  S.agendaAnchorDate = view.saved.anchor;
  S.agendaInitialSpanApplied = view.saved.applied;
  S.commandView = undefined;
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
  /** @type {Record<string, HTMLElement | null>} */
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
  // The read-only toggle ("%%RO" / "**RW") used to be a separate item here.
  // It's reached through the command palette now (Toggle read-only) or
  // god-mode's own C-x C-q -- see toggleBufferReadOnly's own docs.
}

/** Opens Help: the app's own manual (org-pwa.info, made from README.org) at its Top node. */
export async function openHelp() {
  closeAllOverlayPanels();
  await openInfo({ manual: BUILTIN_MANUAL });
}

/** Opens the manual at the section that a CUSTOM_ID of README.org names (e.g. "#capture-templates"); Settings' hints and Capture's help link use it. The Info reader opens over the screen that asked, so closing it returns there.
 * @param {string} anchorId */
export async function openDocsAtHeading(anchorId) {
  const node = HELP_NODE_BY_ID[anchorId.replace(/^#/, '')];
  if (!node) throw new Error('Help has no section with the CUSTOM_ID ' + anchorId);
  await openInfo({ manual: BUILTIN_MANUAL, node });
}

/** Opens the manual at the first place that documents NAME (a `[[help:NAME]]` link), or at its top, with a status line, when nothing does.
 * @param {string} name */
export async function openHelpLink(name) {
  const response = await fetch('./README.org');
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const hit = lookupHelp(await response.text(), name);
  const node = hit && hit.headingIndex >= 0 ? HELP_NODE_BY_HEADING[hit.headingIndex] : undefined;
  await openInfo({ manual: BUILTIN_MANUAL, node });
  if (!node) {
    setStatus('No help for ' + name);
    render();
  }
}
