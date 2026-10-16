// @ts-check
// Extracted from app.js: file menu.
import { getMenuAliases } from '../src/local-variables.js';
import { parseMenuAliases } from '../src/menu-alias.js';
import { filesystemAdapter, githubAdapter, webdavAdapter } from './adapters.js';
import { S } from './app-state.js';
import { modifiedFileBuffers, saveSomeBuffers } from './buffers.js';
import { RECENT_FILES_DISPLAY_LIMIT } from './constants.js';
import { confirmDialog } from './dialogs.js';
import { createNewUnsavedDocument, openRemotePath, saveCurrent } from './documents-io.js';
import { openFileScreen } from './file-screen.js';
import { fileMenuBtn, fileMenuPanel } from './dom.js';
import { setStatus } from './editing.js';
import { clearRecentFiles, getRecentFiles, removeRecentFile } from './settings.js';
import { kv } from './singletons.js';
import { storageKindLabel } from './sync-helpers.js';
import { aliasedMenuDivItem, appendMenuButtonsInOrder, attachLongPress, menuDivItem, positionPopupNearButton } from './ui-widgets.js';

export function closeFileMenu() {
  S.fileMenuOpen = false;
  renderFileMenu();
}

/**
 * @param {string} documentId
 * @param {any} [storageKind]
 */
export function isCurrentDocument(documentId, storageKind) {
  return !!S.state.doc && S.state.documentId === documentId && S.state.storageKind === storageKind;
}

/** @param {HTMLElement} container */
export async function renderRecentFilesSection(container) {
  const stored = await getRecentFiles(kv);
  const displayed = stored
    .filter((/** @type {any} */ f) => !isCurrentDocument(f.documentId, f.storageKind))
    .slice(0, RECENT_FILES_DISPLAY_LIMIT)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => a.documentId.localeCompare(b.documentId));
  if (displayed.length === 0) return;

  const sep = document.createElement('div');
  sep.style.borderTop = '3px double var(--border-strong)';
  sep.style.margin = '10px 0 6px';
  container.appendChild(sep);

  const header = document.createElement('div');
  header.textContent = 'Recently opened';
  header.style.fontSize = '12px';
  header.style.opacity = '0.7';
  header.style.marginBottom = '4px';
  header.style.padding = '0 4px';
  container.appendChild(header);
  attachLongPress(header, () => confirmClearRecentFiles());

  for (const entry of displayed) {
    const item = menuDivItem(`${entry.documentId} (${storageKindLabel(entry.storageKind)})`, () => {
      closeFileMenu();
      openRecentFile(entry.documentId, entry.storageKind);
    });
    // a long press removes the entry; the release that follows it must not also open the file, and the menu stays where it is
    item.addEventListener('contextmenu', (e) => e.preventDefault());
    const openIt = item.onclick;
    item.addEventListener('pointerdown', () => delete item.dataset.longPressFired);
    attachLongPress(item, () => confirmRemoveRecentFile(entry.documentId, entry.storageKind));
    item.onclick = (e) => {
      if (item.dataset.longPressFired) {
        delete item.dataset.longPressFired;
        return;
      }
      openIt?.call(item, e);
    };
    container.appendChild(item);
  }
}

/**
 * Long-press on one entry: asks, then drops just that entry from the list.
 * @param {string} documentId
 * @param {string} storageKind
 */
export async function confirmRemoveRecentFile(documentId, storageKind) {
  if (!(await confirmDialog(`Remove "${documentId}" from the recently opened list?`, { confirmLabel: 'Remove' }))) return;
  await removeRecentFile(kv, documentId, storageKind);
  renderFileMenu();
}

/** Confirms (via the custom confirmDialog(), whose default button is
 *  Cancel, not Clear -- see confirmDialog's own docstring) and, if
 *  confirmed, empties the recent-files list. Reachable via a
 *  long-press on the "Recently opened" label. */
export async function confirmClearRecentFiles() {
  if (!(await confirmDialog('Clear the recently opened files list?', { confirmLabel: 'Clear' }))) return;
  await clearRecentFiles(kv);
  renderFileMenu();
}

/** Opens a recent-files entry directly by its own stored documentId,
 *  the same way tapping a browsed file or an in-document file: link
 *  already does (openRemotePath, no re-prompting) -- for GitHub, WebDAV,
 *  and local filesystem files alike, since filesystem-adapter.js's own
 *  read() already transparently reuses a previously-granted
 *  FileSystemFileHandle rather than needing the picker again. An
 *  imported file (the read-once, no-live-link fallback used where the
 *  File System Access API isn't available at all, e.g. iOS Safari) has
 *  no such handle to reuse and genuinely can't be reopened without the
 *  person re-selecting it themselves -- explained rather than silently
 * @param {string} documentId
 * @param {string} storageKind
 *  failing or pretending it opened. */
export async function openRecentFile(documentId, storageKind) {
  if (storageKind === 'github') {
    await openRemotePath(documentId, 'github', githubAdapter, 'GitHub');
  } else if (storageKind === 'webdav') {
    await openRemotePath(documentId, 'webdav', webdavAdapter, 'WebDAV');
  } else if (storageKind === 'filesystem') {
    await openRemotePath(documentId, 'filesystem', filesystemAdapter, 'Local');
  } else {
    setStatus(`"${documentId}" was imported from a local file \u2014 use Open to re-select it (this app can't reopen an imported file automatically).`);
  }
}

export async function renderFileMenu() {
  await renderFileMenuContent();
  if (S.fileMenuOpen) positionPopupNearButton(fileMenuPanel, fileMenuBtn);
}

export async function renderFileMenuContent() {
  fileMenuPanel.innerHTML = '';
  if (!S.fileMenuOpen) {
    fileMenuPanel.style.display = 'none';
    return;
  }
  fileMenuPanel.style.display = 'block';

  {
    const fileMenuAliases = parseMenuAliases(getMenuAliases(S.state.localVariables)).file;
    const newBtn = aliasedMenuDivItem(fileMenuAliases, 'New', () => {
      S.fileMenuOpen = false;
      renderFileMenu();
      createNewUnsavedDocument();
    });
    const openBtn = aliasedMenuDivItem(fileMenuAliases, 'Open', () => {
      S.fileMenuOpen = false;
      renderFileMenu();
      openFileScreen('open');
    });
    const saveBtn = aliasedMenuDivItem(
      fileMenuAliases,
      'Save',
      () => {
        S.fileMenuOpen = false;
        renderFileMenu();
        saveCurrent();
      },
      !S.state.storageKind
    );
    const saveAsBtn = aliasedMenuDivItem(
      fileMenuAliases,
      'Save As',
      () => {
        S.fileMenuOpen = false;
        renderFileMenu();
        openFileScreen('saveas');
      },
      !S.state.doc
    );
    appendMenuButtonsInOrder(fileMenuPanel, fileMenuAliases, [
      { label: 'New', btn: newBtn },
      { label: 'Open', btn: openBtn },
      { label: 'Save', btn: saveBtn },
      { label: 'Save As', btn: saveAsBtn },
    ]);
    // Always last, outside the reorderable four: a menu order a person already set lists exactly those four labels.
    const saveSomeBtn = aliasedMenuDivItem(
      fileMenuAliases,
      'Save Some Buffers',
      () => {
        S.fileMenuOpen = false;
        renderFileMenu();
        saveSomeBuffers(true); // silently, as (save-some-buffers t)
      },
      modifiedFileBuffers().length === 0
    );
    if (saveSomeBtn) fileMenuPanel.appendChild(saveSomeBtn);
    await renderRecentFilesSection(fileMenuPanel);
  }
}
