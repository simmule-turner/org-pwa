// Extracted from app.js: menus.
import { resolveOlpTarget } from '../src/capture-template.js';
import { findHeadingWithRunningClock } from '../src/clock.js';
import { parseExtraMenu } from '../src/extra-menu.js';
import { getExtraMenu, getMenuAliases } from '../src/local-variables.js';
import { parseMenuAliases } from '../src/menu-alias.js';
import { S } from './app-state.js';
import { openCalendarPanel } from './calendar-panel.js';
import { openCapturePrompt } from './capture-ui.js';
import { closeAllOverlayPanels } from './chrome.js';
import { clockCancelHeading, clockContinue, clockOutHeading } from './clock-flow.js';
import { extraMenuBtn, extraMenuPanel, moreBtn, morePanel, settingsBtn } from './dom.js';
import { setStatus } from './editing.js';
import { performOrgOrgExport, renderExportFlow, renderImportFlow } from './export-import.js';
import { cutSubtree, extraMenuTargetHeading, pasteSubtree } from './gestures-structure.js';
import { openCommandPalette } from './god-mode-palette.js';
import { navigateToHeading } from './navigation.js';
import { render } from './render.js';
import { getCaptureTemplates } from './settings.js';
import { kv } from './singletons.js';
import { recalculateAllTables } from './table-recalc.js';
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
 *  - function: runs a built-in function by name. Only org-clock-out
 *    is recognized today; more may be added later.
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
    if (entry.name === 'org-clock-out' || entry.name === 'org-clock-cancel') {
      const running = S.state.doc ? findHeadingWithRunningClock(S.state.doc) : null;
      if (!running) {
        setStatus('No clock is currently running.');
        render();
        return;
      }
      if (entry.name === 'org-clock-out') {
        clockOutHeading(running);
      } else {
        clockCancelHeading(running);
      }
    } else if (entry.name === 'org-clock-continue') {
      clockContinue();
    } else if (entry.name === 'org-cut-subtree' || entry.name === 'org-paste-subtree') {
      const target = extraMenuTargetHeading();
      if (!target) {
        setStatus('No heading selected \u2014 open a heading\u2019s own menu first.');
        render();
        return;
      }
      if (entry.name === 'org-cut-subtree') {
        await cutSubtree(target);
      } else {
        await pasteSubtree(target);
      }
    } else if (entry.name === 'org-xx-calendar') {
      openCalendarPanel();
    } else if (entry.name === 'org-table-recalculate-buffer-tables') {
      recalculateAllTables();
    } else if (entry.name === 'org-org-export-as-org') {
      S.extraMenuOpen = false;
      render();
      await performOrgOrgExport();
    }
    return;
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
