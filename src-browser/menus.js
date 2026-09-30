// Extracted from app.js: menus.
import { resolveOlpTarget } from '../src/capture-template.js';
import { parseExtraMenu } from '../src/extra-menu.js';
import { getExtraMenu, getMenuAliases } from '../src/local-variables.js';
import { parseMenuAliases } from '../src/menu-alias.js';
import { S } from './app-state.js';
import { openCapturePrompt } from './capture-ui.js';
import { closeAllOverlayPanels } from './chrome.js';
import { extraMenuBtn, extraMenuPanel, moreBtn, morePanel, settingsBtn } from './dom.js';
import { setStatus } from './editing.js';
import { renderExportFlow, renderImportFlow } from './export-import.js';
import { extraMenuTargetHeading } from './gestures-structure.js';
import { findPaletteCommandByOrgName, openCommandPalette, runPaletteCommand } from './god-mode-palette.js';
import { navigateToHeading } from './navigation.js';
import { render } from './render.js';
import { getCaptureTemplates } from './settings.js';
import { kv } from './singletons.js';
import { aliasedMenuDivItem, appendMenuButtonsInOrder, positionPopupNearButton, requiredMenuDivItem } from './ui-widgets.js';
import { switchToView } from './views.js';

/** Shows/hides the floating extras (☰) button based on whether
 *  org-xx-extra-menu (Global/Local Variables, see src/extra-menu.js's own
 *  docs) currently resolves to at least one SELECTABLE entry --
 *  showing an always-visible button that opens an empty or
 *  separator-only menu would be confusing, not useful. */
export function syncExtraMenuButtonVisibility() {
  if (!S.state.localVariables) {
    extraMenuBtn.style.display = 'none';
    return;
  }
  const entries = parseExtraMenu(getExtraMenu(S.state.localVariables));
  const hasSelectable = entries.some((e) => e.type !== 'separator');
  extraMenuBtn.style.display = hasSelectable ? 'flex' : 'none';
}

/** Renders the extras popup's own content -- a vertical list of
 *  tappable rows (one per menu entry) plus visual dividers for
 *  separator entries, matching the org-xx-extra-menu spec's own
 *  five-hyphen convention. */
export function renderExtraMenu() {
  renderExtraMenuContent();
  if (S.extraMenuOpen) positionPopupNearButton(extraMenuPanel, extraMenuBtn);
}

export function renderExtraMenuContent() {
  extraMenuPanel.innerHTML = '';
  if (!S.extraMenuOpen) {
    extraMenuPanel.style.display = 'none';
    return;
  }
  const entries = S.state.localVariables ? parseExtraMenu(getExtraMenu(S.state.localVariables)) : [];
  if (entries.length === 0) {
    // The menu emptied out from under an already-open popup (e.g. the
    // document changed) -- close it rather than showing a blank panel.
    S.extraMenuOpen = false;
    extraMenuPanel.style.display = 'none';
    return;
  }
  extraMenuPanel.style.display = 'block';
  for (const entry of entries) {
    if (entry.type === 'separator') {
      const hr = document.createElement('div');
      hr.style.borderTop = '1px solid var(--border)';
      hr.style.margin = '4px 2px';
      extraMenuPanel.appendChild(hr);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'menu-list-item';
    row.textContent = entry.label;
    row.onclick = () => runExtraMenuEntry(entry);
    extraMenuPanel.appendChild(row);
  }
}

/** Executes a selected extras-menu entry, dispatched by type:
 *  - capture: runs the matching capture template by key, exactly as
 *    if it had been picked from the regular Capture menu itself.
 *  - olp: resolves (and creates, if needed -- the same
 *    resolveOlpTarget capture templates themselves already use,
 *    including its own %<FORMAT> expansion) the target heading, then
 *    navigates to it.
 *  - function: runs the command palette command with that real
 *    Emacs/Org function name (findPaletteCommandByOrgName), or says the
 *    name is not a recognized function.
 */
export async function runExtraMenuEntry(entry) {
  S.extraMenuOpen = false;
  renderExtraMenu();

  if (entry.type === 'capture') {
    const templates = await getCaptureTemplates(kv);
    const template = templates.find((t) => t.key === entry.key);
    if (!template) {
      setStatus(`No capture template with key "${entry.key}" found.`);
      render();
      return;
    }
    closeAllOverlayPanels();
    S.captureOpenedFromExtraMenu = true;
    S.captureOpen = true;
    render();
    openCapturePrompt(template);
    return;
  }

  if (entry.type === 'olp') {
    if (!S.state.doc) return;
    const target = resolveOlpTarget(S.state.doc, entry.headers, { now: new Date(), allowCreate: false });
    if (!target) {
      setStatus(`"${entry.headers.join(' / ')}" doesn't exist yet \u2014 nothing was created.`);
      render();
      return;
    }
    switchToView('org');
    navigateToHeading(target);
    return;
  }

  if (entry.type === 'function') {
    // A quoted function is a command palette command, named by its real
    // Emacs/Org function name: run it exactly as the palette would, acting on
    // the same heading (the one whose action menu is open, else the keyboard-
    // focused one) and reporting why it can't run when it can't.
    const command = findPaletteCommandByOrgName(entry.name);
    if (!command) {
      setStatus(`'${entry.name} is not a recognized function.`);
      render();
      return;
    }
    runPaletteCommand(command, extraMenuTargetHeading());
  }
}

/** Search, Capture, Export, Settings, and Clocks live behind this one
 *  button instead of each having their own place in the top bar.
 *  Search/Capture/Settings each just call .click() on the original
 *  (still-present-but-hidden) button rather than reimplementing any of
 *  its logic, so nothing about how they actually work changes at all
 *  — only how they're reached. */
export function renderMoreMenu() {
  renderMoreMenuContent();
  if (S.moreOpen) positionPopupNearButton(morePanel, moreBtn);
}

export function renderMoreMenuContent() {
  morePanel.innerHTML = '';
  if (!S.moreOpen) {
    morePanel.style.display = 'none';
    return;
  }
  morePanel.style.display = 'block';

  if (S.moreMenuStep === 'export') {
    renderExportFlow();
    return;
  }

  if (S.moreMenuStep === 'import') {
    renderImportFlow();
    return;
  }

  const moreMenuAliases = parseMenuAliases(getMenuAliases(S.state.localVariables)).more;

  const settingsBtnOption = requiredMenuDivItem(moreMenuAliases, 'Settings', () => {
    S.moreOpen = false;
    renderMoreMenu();
    settingsBtn.click();
  });

  const exportBtnOption = aliasedMenuDivItem(
    moreMenuAliases,
    'Export',
    () => {
      S.moreMenuStep = 'export';
      S.exportFormat = null;
      renderMoreMenu();
    },
    !S.state.doc
  );

  const importBtnOption = aliasedMenuDivItem(
    moreMenuAliases,
    'Import',
    () => {
      S.moreMenuStep = 'import';
      renderMoreMenu();
    },
    !S.state.doc
  );

  const commandsBtnOption = aliasedMenuDivItem(moreMenuAliases, 'Commands', () => {
    S.moreOpen = false;
    renderMoreMenu();
    openCommandPalette();
  });

  appendMenuButtonsInOrder(morePanel, moreMenuAliases, [
    { label: 'Commands', btn: commandsBtnOption },
    { label: 'Export', btn: exportBtnOption },
    { label: 'Import', btn: importBtnOption },
    { label: 'Settings', btn: settingsBtnOption },
  ]);
}
