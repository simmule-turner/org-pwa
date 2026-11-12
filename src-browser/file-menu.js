// @ts-check
// Extracted from app.js: file menu.
import { getMenuAliases } from '../src/local-variables.js';
import { parseMenuAliases } from '../src/menu-alias.js';
import { filesystemAdapter, githubAdapter, webdavAdapter } from './adapters.js';
import { S } from './app-state.js';
import { modifiedFileBuffers, saveSomeBuffers } from './buffers.js';
import { confirmDialog } from './dialogs.js';
import { createNewUnsavedDocument, openRemotePath, saveCurrent } from './documents-io.js';
import { openFileScreen } from './file-screen.js';
import { fileMenuBtn, fileMenuPanel } from './dom.js';
import { setStatus } from './editing.js';
import { recentKey, recentRows } from '../src/recent-files.js';
import { dropSavedCopies, hasSavedCopy, openTabOf } from './recent-files.js';
import { clearRecentFiles, getRecentFiles, removeRecentFile } from './settings.js';
import { switchToTab } from './tabs.js';
import { kv } from './singletons.js';
import { storageKindLabel } from './sync-helpers.js';
import { aliasedMenuDivItem, appendMenuButtonsInOrder, attachLongPress, menuButton, menuDivItem, positionPopupNearButton } from './ui-widgets.js';

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

/** One row of the recently opened list: the file and its backend, with where it stands at the right. @param {import('../src/recent-files.js').RecentFile & { state: string }} entry @param {boolean} viewable whether a saved copy is held */
function recentRow(entry, viewable) {
  const item = menuDivItem(`${entry.documentId} (${storageKindLabel(entry.storageKind)})`, () => {
    closeFileMenu();
    if (entry.state === 'current') return;
    if (entry.state === 'open') {
      const tab = openTabOf(entry);
      if (tab) switchToTab(tab.tabId);
      return;
    }
    openRecentFile(entry.documentId, entry.storageKind, entry.textAt ?? entry.openedAt);
  });
  const name = document.createElement('span');
  name.textContent = item.textContent;
  name.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  item.textContent = '';
  item.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;padding:9px 12px;';
  if (entry.state === 'current') item.style.background = 'color-mix(in srgb, var(--accent) 10%, transparent)';
  item.appendChild(name);
  const tag = entry.state === 'closed' ? (viewable ? 'view' : '') : entry.state;
  if (tag) {
    const small = document.createElement('small');
    small.textContent = tag;
    small.style.cssText = 'opacity:.6;flex:0 0 auto;';
    item.appendChild(small);
  }
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
  return item;
}

/** Adds the recently opened list to the File menu: newest first, each file marked current, open or (when closed and a saved copy is held) view, in a list that scrolls, then Clear recents and Cancel. @param {HTMLElement} container @returns {Promise<boolean>} whether there was a list */
export async function renderRecentFilesSection(container) {
  const stored = await getRecentFiles(kv);
  if (stored.length === 0) return false;
  const openKeys = new Set(stored.filter((f) => openTabOf(f)).map(recentKey));
  const current = S.state.doc && S.state.storageKind ? recentKey({ documentId: S.state.documentId, storageKind: S.state.storageKind }) : null;
  const rows = recentRows(stored, openKeys, current);

  const header = document.createElement('div');
  header.textContent = 'Recently opened (long-press an entry to remove it from this list; the file is not deleted)';
  header.style.cssText = 'font-size:12px;opacity:0.7;padding:0 4px;margin-top:6px;';
  container.appendChild(header);

  const list = document.createElement('div');
  list.dataset.recentList = '1';
  list.style.cssText = 'border:1px solid var(--border-strong);border-radius:var(--radius-control);overflow-y:auto;overscroll-behavior:contain;min-height:80px;flex:1 1 auto;margin-top:6px;';
  for (const entry of rows) {
    const viewable = entry.state === 'closed' && (entry.storageKind === 'github' || entry.storageKind === 'webdav') && (await hasSavedCopy(entry.documentId));
    list.appendChild(recentRow(entry, viewable));
  }
  container.appendChild(list);

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:8px;justify-content:space-between;flex:0 0 auto;margin-top:10px;';
  const clear = menuButton('Clear recents', () => confirmClearRecentFiles());
  clear.dataset.act = 'clear-recents';
  const cancel = menuButton('Cancel', () => closeFileMenu());
  cancel.dataset.act = 'cancel';
  cancel.classList.add('ui-cancel');
  for (const b of [clear, cancel]) b.style.cssText = 'min-height:var(--target);padding:10px 14px;font:inherit;font-size:16px;border-radius:6px;'; // as the buttons of Open
  cancel.style.paddingInline = '24px';
  buttons.append(clear, cancel);
  container.appendChild(buttons);
  return true;
}

/**
 * Long-press on one entry: asks, then drops just that entry from the recently opened list (the file itself stays where it is).
 * @param {string} documentId
 * @param {string} storageKind
 */
export async function confirmRemoveRecentFile(documentId, storageKind) {
  if (!(await confirmDialog(`Remove \u201c${documentId}\u201d from the recently opened list? The file itself is not deleted.`, { confirmLabel: 'Remove' }))) return;
  await dropSavedCopies(await removeRecentFile(kv, documentId, storageKind));
  renderFileMenu();
}

/** Confirms (via the custom confirmDialog(), whose default button is
 *  Cancel, not Clear -- see confirmDialog's own docstring) and, if
 *  confirmed, empties the recently opened list. Reachable with the
 *  Clear recents button under the list. */
export async function confirmClearRecentFiles() {
  if (!(await confirmDialog('Clear the recently opened list? The saved copies kept for viewing without a connection go with it. The files themselves are not deleted.', { confirmLabel: 'Clear' }))) return;
  await dropSavedCopies(await clearRecentFiles(kv));
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
 * @param {number} [savedCopyAt] when the saved copy of the file dates from: with it, a GitHub or WebDAV file that cannot be reached offers that copy to view
 *  failing or pretending it opened. */
export async function openRecentFile(documentId, storageKind, savedCopyAt) {
  if (storageKind === 'github') {
    await openRemotePath(documentId, 'github', githubAdapter, 'GitHub', { savedCopyAt: savedCopyAt ?? null });
  } else if (storageKind === 'webdav') {
    await openRemotePath(documentId, 'webdav', webdavAdapter, 'WebDAV', { savedCopyAt: savedCopyAt ?? null });
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
  fileMenuPanel.classList.remove('has-recents');
  const title = document.createElement('div');
  title.className = 'menu-sheet-title';
  title.textContent = 'File';
  fileMenuPanel.appendChild(title);

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
    if (await renderRecentFilesSection(fileMenuPanel)) {
      fileMenuPanel.classList.add('has-recents'); // a column: the list takes the room left and scrolls
      fileMenuPanel.style.display = 'flex';
    }
  }
}
