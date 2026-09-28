// Extracted from app.js: file menu.
import { getMenuAliases } from '../src/local-variables.js';
import { parseMenuAliases } from '../src/menu-alias.js';
import { filesystemAdapter, githubAdapter, webdavAdapter } from './adapters.js';
import { S } from './app-state.js';
import { RECENT_FILES_DISPLAY_LIMIT } from './constants.js';
import { confirmDialog } from './dialogs.js';
import { createNewUnsavedDocument, loadBrowseEntries, openFromFilesystem, openFromGithub, openFromImport, openFromWebdav, openGithubByPrompt, openRemotePath, openWebdavByPrompt, saveAsFilesystem, saveAsGithub, saveAsImport, saveAsWebdav, saveCurrent } from './documents-io.js';
import { fileMenuBtn, fileMenuPanel } from './dom.js';
import { setStatus } from './editing.js';
import { isFileSystemAccessUnsupported } from './input-file-adapter.js';
import { clearRecentFiles, getRecentFiles } from './settings.js';
import { kv } from './singletons.js';
import { storageKindLabel } from './sync-helpers.js';
import { VH_UNIT, aliasedMenuDivItem, appendMenuButtonsInOrder, attachLongPress, menuButton, menuDivItem, positionPopupNearButton } from './ui-widgets.js';

export function closeFileMenu() {
  S.fileMenuOpen = false;
  S.fileMenuStep = null;
  stopBrowsing();
  renderFileMenu();
}

export function isCurrentDocument(documentId, storageKind) {
  return !!S.state.doc && S.state.documentId === documentId && S.state.storageKind === storageKind;
}

export async function renderRecentFilesSection(container) {
  const stored = await getRecentFiles(kv);
  const displayed = stored
    .filter((f) => !isCurrentDocument(f.documentId, f.storageKind))
    .slice(0, RECENT_FILES_DISPLAY_LIMIT)
    .sort((a, b) => a.documentId.localeCompare(b.documentId));
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
    container.appendChild(
      menuDivItem(`${entry.documentId} (${storageKindLabel(entry.storageKind)})`, () => {
        closeFileMenu();
        openRecentFile(entry.documentId, entry.storageKind);
      })
    );
  }
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

  if (S.fileMenuStep === null) {
    const fileMenuAliases = parseMenuAliases(getMenuAliases(S.state.localVariables)).file;
    const newBtn = aliasedMenuDivItem(fileMenuAliases, 'New', () => {
      S.fileMenuOpen = false;
      renderFileMenu();
      createNewUnsavedDocument();
    });
    const openBtn = aliasedMenuDivItem(fileMenuAliases, 'Open', () => {
      S.fileMenuStep = 'open';
      renderFileMenu();
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
        S.fileMenuStep = 'saveas';
        renderFileMenu();
      },
      !S.state.doc
    );
    appendMenuButtonsInOrder(fileMenuPanel, fileMenuAliases, [
      { label: 'New', btn: newBtn },
      { label: 'Open', btn: openBtn },
      { label: 'Save', btn: saveBtn },
      { label: 'Save As', btn: saveAsBtn },
    ]);
    await renderRecentFilesSection(fileMenuPanel);
    return;
  }

  if (S.browseBackend) {
    renderFileBrowser();
    return;
  }

  const label = document.createElement('div');
  label.style.fontSize = '12px';
  label.style.opacity = '0.7';
  label.style.marginBottom = '4px';
  label.textContent = S.fileMenuStep === 'open' ? 'Open from:' : 'Save a copy to:';
  fileMenuPanel.appendChild(label);

  fileMenuPanel.appendChild(
    menuDivItem('GitHub', () => {
      if (S.fileMenuStep === 'open') openFromGithub();
      else saveAsGithub();
    })
  );

  if (!isFileSystemAccessUnsupported()) {
    fileMenuPanel.appendChild(
      menuDivItem('Local file', () => {
        if (S.fileMenuStep === 'open') openFromFilesystem();
        else saveAsFilesystem();
      })
    );
  } else {
    // This platform has no File System Access API at all (every browser
    // on iOS) — offer the read-once/download-based fallback instead.
    fileMenuPanel.appendChild(
      menuDivItem(S.fileMenuStep === 'open' ? 'Import file\u2026' : 'Local (download)', () => {
        if (S.fileMenuStep === 'open') openFromImport();
        else saveAsImport();
      })
    );
  }

  fileMenuPanel.appendChild(
    menuDivItem('WebDAV', () => {
      if (S.fileMenuStep === 'open') openFromWebdav();
      else saveAsWebdav();
    })
  );
}

export function stopBrowsing() {
  S.browseBackend = null;
  S.browsePath = '';
  S.browseEntries = null;
  S.browseError = null;
}

/** Renders the navigable file/folder listing for whichever backend
 *  startBrowsing set up -- the actual UI this whole feature is about.
 *  Folders are tappable to navigate into; only .org files are shown
 *  (and tappable to open) among files, since anything else isn't
 *  something this app can do anything useful with anyway and would
 *  just be clutter in the list. */
export function renderFileBrowser() {
  const backendLabel = S.browseBackend === 'github' ? 'GitHub' : 'WebDAV';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.gap = '8px';
  header.style.marginBottom = '6px';

  if (S.browsePath) {
    header.appendChild(
      menuButton('\u2191 Up', () => {
        const parts = S.browsePath.split('/');
        parts.pop();
        S.browsePath = parts.join('/');
        loadBrowseEntries();
      })
    );
  }

  const pathLabel = document.createElement('div');
  pathLabel.style.fontSize = '12px';
  pathLabel.style.opacity = '0.7';
  pathLabel.style.overflow = 'hidden';
  pathLabel.style.textOverflow = 'ellipsis';
  pathLabel.style.whiteSpace = 'nowrap';
  pathLabel.textContent = `${backendLabel}: /${S.browsePath}`;
  header.appendChild(pathLabel);
  fileMenuPanel.appendChild(header);

  const listEl = document.createElement('div');
  listEl.style.maxHeight = `40${VH_UNIT}`;
  listEl.style.overflowY = 'auto';
  listEl.style.overscrollBehavior = 'contain';
  fileMenuPanel.appendChild(listEl);

  if (S.browseEntries === null && !S.browseError) {
    const loading = document.createElement('div');
    loading.style.fontSize = '13px';
    loading.style.opacity = '0.6';
    loading.style.padding = '10px 2px';
    loading.textContent = 'Loading\u2026';
    listEl.appendChild(loading);
  } else if (S.browseError) {
    const errorEl = document.createElement('div');
    errorEl.style.fontSize = '13px';
    errorEl.style.color = '#c0392b';
    errorEl.style.padding = '6px 2px';
    errorEl.textContent = S.browseError;
    listEl.appendChild(errorEl);
  } else {
    const orgEntries = S.browseEntries.filter(
      (e) => e.type === 'dir' || e.name.toLowerCase().endsWith('.org') || e.name.toLowerCase().endsWith('_archive')
    );
    if (orgEntries.length === 0) {
      const empty = document.createElement('div');
      empty.style.fontSize = '13px';
      empty.style.opacity = '0.6';
      empty.style.padding = '10px 2px';
      empty.textContent = 'No .org files or folders here.';
      listEl.appendChild(empty);
    }
    for (const entry of orgEntries) {
      const row = document.createElement('button');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.width = '100%';
      row.style.boxSizing = 'border-box';
      row.style.minHeight = '44px';
      row.style.textAlign = 'left';
      row.style.padding = '12px 14px';
      row.style.border = 'none';
      row.style.borderBottom = '1px solid var(--border)';
      row.style.background = 'transparent';
      row.style.color = 'var(--fg)';
      row.style.font = 'inherit';
      row.style.fontSize = '14px';

      const icon = document.createElement('span');
      icon.textContent = entry.type === 'dir' ? '\ud83d\udcc1' : entry.name.toLowerCase().endsWith('_archive') ? '\ud83d\uddc4\ufe0f' : '\ud83d\udcc4';
      icon.style.flexShrink = '0';
      icon.style.fontSize = '1.3em';
      row.appendChild(icon);

      const name = document.createElement('span');
      name.textContent = entry.name;
      name.style.overflow = 'hidden';
      name.style.textOverflow = 'ellipsis';
      name.style.whiteSpace = 'nowrap';
      row.appendChild(name);

      row.onclick = () => {
        if (entry.type === 'dir') {
          S.browsePath = entry.path;
          loadBrowseEntries();
        } else {
          const diskAdapter = S.browseBackend === 'github' ? githubAdapter : webdavAdapter;
          const path = entry.path;
          const kind = S.browseBackend;
          stopBrowsing();
          closeFileMenu();
          openRemotePath(path, kind, diskAdapter, backendLabel);
        }
      };
      listEl.appendChild(row);
    }
  }

  const footerRow = document.createElement('div');
  footerRow.className = 'panel-row';
  footerRow.style.marginTop = '6px';
  footerRow.appendChild(
    menuButton('Type a path instead\u2026', () => {
      const kind = S.browseBackend;
      stopBrowsing();
      renderFileMenu();
      if (kind === 'github') openGithubByPrompt();
      else openWebdavByPrompt();
    })
  );
  footerRow.appendChild(
    menuButton('Cancel', () => {
      stopBrowsing();
      renderFileMenu();
    })
  );
  fileMenuPanel.appendChild(footerRow);
}
