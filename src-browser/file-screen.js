// @ts-check
// The Open / Save As screen: one sheet (dialog from 600px) with a GitHub / Local file / WebDAV picker that remembers the last type
// used. GitHub and WebDAV show their folder list straight away; Local file is a single button into the system picker.
// State lives in S.fileScreen so Escape and the other panels' dismissal reach it like any panel.
import { FILE_SCREEN_TYPES, joinPath, listedAsFile, parentFolder, resolveFileScreenType, stepFileScreenType, visibleEntries } from '../src/file-screen-model.js';
import { githubAdapter, webdavAdapter } from './adapters.js';
import { S } from './app-state.js';
import { containTab, rememberOpener, restoreOpener } from './containers.js';
import { confirmDialog, showModalOverlay } from './dialogs.js';
import { openFromFilesystem, openFromImport, openRemotePath, saveAsFilesystem, saveAsGithub, saveAsImport, saveAsWebdav, suggestedSaveAsName } from './documents-io.js';
import { fileScreen, fileScreenBox, settingsBtn } from './dom.js';
import { commitTextModeIfActive } from './editing.js';
import { isGithubConfigured } from './github-adapter.js';
import { platform } from './platform.js';
import { render } from './render.js';
import { getFileScreenType, getGithubConfig, getWebdavConfig, setFileScreenType } from './settings.js';
import { kv } from './singletons.js';
import { hideModalOverlay, menuButton } from './ui-widgets.js';
import { isWebdavConfigured } from './webdav-adapter.js';

const LABEL = { github: 'GitHub', local: 'Local file', webdav: 'WebDAV' };

/** @param {string} css @param {string} [text] */
function div(css, text) {
  const el = document.createElement('div');
  el.style.cssText = css;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** The middle segment's name: a live file on most browsers, a read-once import where there is no File System Access (iOS).
 * @param {'open' | 'saveas'} mode */
function localLabel(mode) {
  if (platform.localFiles.supported()) return LABEL.local;
  return mode === 'open' ? 'Import file' : 'Download';
}

/** Opens the screen for 'open' or 'saveas' on the remembered type.
 * @param {'open' | 'saveas'} mode */
export async function openFileScreen(mode) {
  if (mode === 'saveas' && !S.state.doc) return;
  if (commitTextModeIfActive()) render();
  const type = resolveFileScreenType(await getFileScreenType(kv));
  S.fileScreen = { mode, type, folder: '', entries: null, error: null, unconfigured: false, name: mode === 'saveas' ? suggestedSaveAsName('notes.org') : '', pathEl: null, nameEl: null, focusSeg: false };
  renderFileScreen();
  loadListing();
}

export function closeFileScreen() {
  S.fileScreen = null;
  renderFileScreen();
}

/** Switches type, remembers it, and shows that type's body. @param {'github' | 'local' | 'webdav'} type */
async function setType(type) {
  const f = S.fileScreen;
  if (!f || f.type === type) return;
  f.type = type;
  f.folder = '';
  f.entries = null;
  f.error = null;
  f.unconfigured = false;
  f.focusSeg = true;
  await setFileScreenType(kv, type);
  renderFileScreen();
  loadListing();
}

/** Loads the folder list for the current GitHub / WebDAV folder; flags a backend that has no settings yet. */
async function loadListing() {
  const f = S.fileScreen;
  if (!f || f.type === 'local') return;
  const type = f.type;
  const folder = f.folder;
  const config = type === 'github' ? await getGithubConfig(kv) : await getWebdavConfig(kv);
  if (type === 'github') S.githubConfig = config;
  else S.webdavConfig = config;
  if (S.fileScreen !== f || f.type !== type) return;
  const ok = type === 'github' ? isGithubConfigured(config) : isWebdavConfigured(config);
  if (!ok) {
    f.unconfigured = true;
    renderFileScreen();
    return;
  }
  f.entries = null;
  f.error = null;
  renderFileScreen();
  try {
    const entries = await (type === 'github' ? githubAdapter : webdavAdapter).list(folder);
    if (S.fileScreen !== f || f.type !== type || f.folder !== folder) return; // superseded
    f.entries = entries;
  } catch (err) {
    if (S.fileScreen !== f || f.type !== type || f.folder !== folder) return;
    f.error = err.message;
  }
  renderFileScreen();
}

/** @param {string} path */
function openPath(path) {
  const f = S.fileScreen;
  if (!f || !path.trim()) return;
  const type = f.type;
  closeFileScreen();
  const clean = path.trim().replace(/^\/+/, '');
  if (type === 'github') openRemotePath(clean, 'github', githubAdapter, 'GitHub');
  else openRemotePath(clean, 'webdav', webdavAdapter, 'WebDAV');
}

/** Saves under the typed name, asking first when that file is already in the listed folder. */
async function saveHere() {
  const f = S.fileScreen;
  if (!f) return;
  const name = (f.nameEl ? f.nameEl.value : f.name).trim();
  if (!name) return;
  const type = f.type;
  if (type === 'local') {
    closeFileScreen();
    saveAsImport(name);
    return;
  }
  const path = joinPath(f.folder, name);
  if (listedAsFile(f.entries, path) && !(await confirmDialog(`Replace "${path}"?`, { confirmLabel: 'Replace' }))) return;
  if (S.fileScreen !== f) return;
  closeFileScreen();
  if (type === 'github') saveAsGithub(path);
  else saveAsWebdav(path);
}

function localBody(f) {
  const box = div('border:1px dashed var(--border-strong);border-radius:var(--radius-control);padding:16px;text-align:center;display:flex;flex-direction:column;gap:10px;align-items:center;');
  const live = platform.localFiles.supported();
  const open = f.mode === 'open';
  if (live || open) {
    const btn = menuButton(open ? 'Choose a file…' : 'Choose where to save…', () => {
      closeFileScreen();
      if (open) (live ? openFromFilesystem : openFromImport)();
      else saveAsFilesystem();
    });
    btn.dataset.act = 'local';
    box.appendChild(btn);
    box.appendChild(div('font-size:13px;opacity:.7;', live ? (open ? "Opens your device's file picker. Changes save back to the same file." : "Opens your device's save dialog.") : "This browser can't keep a live link to a file, so the file is read once. Use Save to download it back."));
  } else {
    box.appendChild(div('font-size:13px;opacity:.7;', 'This browser downloads the file. Choose its name below.'));
  }
  return box;
}

function unconfiguredBody(f) {
  const box = div('border:1px dashed var(--border-strong);border-radius:var(--radius-control);padding:16px;text-align:center;display:flex;flex-direction:column;gap:8px;align-items:center;');
  box.appendChild(div('font-weight:600;', `${LABEL[f.type]} isn't set up yet`));
  box.appendChild(div('font-size:13px;opacity:.7;', f.type === 'github' ? 'Add a repository and access token to browse it here.' : 'Add a server address and login to browse it here.'));
  const btn = menuButton(`Open ${LABEL[f.type]} settings`, () => {
    closeFileScreen();
    settingsBtn.click();
  });
  btn.dataset.act = 'settings';
  box.appendChild(btn);
  return box;
}

function listBody(f) {
  const wrap = div('display:flex;flex-direction:column;gap:8px;min-height:0;flex:1 1 auto;');
  const crumb = div('display:flex;align-items:center;gap:8px;font-size:13px;');
  if (f.folder) {
    const up = menuButton('↑ Up', () => {
      f.folder = parentFolder(f.folder);
      loadListing();
    });
    up.dataset.act = 'up';
    crumb.appendChild(up);
  }
  const where = div('opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', `${LABEL[f.type]}: /${f.folder}`);
  crumb.appendChild(where);
  wrap.appendChild(crumb);
  const list = div('border:1px solid var(--border-strong);border-radius:var(--radius-control);overflow-y:auto;overscroll-behavior:contain;min-height:80px;flex:1 1 auto;');
  list.dataset.part = 'files';
  if (f.error) list.appendChild(div('padding:10px 12px;font-size:13px;color:#c0392b;', f.error));
  else if (f.entries === null) list.appendChild(div('padding:10px 12px;font-size:13px;opacity:.6;', 'Loading…'));
  else {
    const rows = visibleEntries(f.entries);
    if (rows.length === 0) list.appendChild(div('padding:10px 12px;font-size:13px;opacity:.6;', 'No .org files or folders here.'));
    for (const entry of rows) {
      const row = document.createElement('button');
      row.type = 'button';
      row.dataset.entry = entry.name;
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;min-height:var(--target);text-align:left;padding:8px 12px;border:none;border-bottom:1px solid var(--border);background:transparent;color:var(--fg);font:inherit;font-size:14px;';
      const name = document.createElement('span');
      name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      name.textContent = entry.name;
      row.appendChild(name);
      const tag = document.createElement('small');
      tag.style.opacity = '.6';
      tag.textContent = entry.type === 'dir' ? 'folder' : f.mode === 'saveas' && listedAsFile([entry], entry.path.replace(/^\/+/, '')) ? 'exists' : '';
      row.appendChild(tag);
      row.onclick = () => {
        if (entry.type === 'dir') {
          f.folder = entry.path.replace(/^\/+/, '');
          loadListing();
        } else if (f.mode === 'open') openPath(entry.path);
        else {
          if (f.nameEl) f.nameEl.value = entry.name;
          f.name = entry.name;
        }
      };
      list.appendChild(row);
    }
  }
  wrap.appendChild(list);
  return wrap;
}

/** The path or name field, built once per open so typing survives redraws. */
function field(f, which) {
  if (f[which]) return f[which];
  const input = document.createElement('input');
  input.type = 'text';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.style.cssText = 'width:100%;box-sizing:border-box;min-height:var(--target);padding:8px 12px;border:1px solid var(--border-strong);border-radius:var(--radius-control);background:var(--bg);color:var(--fg);font:inherit;';
  if (which === 'pathEl') {
    input.placeholder = 'Enter path…';
    input.setAttribute('aria-label', 'Enter path');
    input.dataset.field = 'path';
    input.onkeydown = (e) => {
      if (e.key === 'Enter') openPath(input.value);
    };
  } else {
    input.value = f.name;
    input.setAttribute('aria-label', 'File name');
    input.dataset.field = 'name';
    input.oninput = () => (f.name = input.value);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') saveHere();
    };
  }
  f[which] = input;
  return input;
}

/** Draws, or hides, the screen from S.fileScreen. */
export function renderFileScreen() {
  const f = S.fileScreen;
  fileScreenBox.innerHTML = '';
  if (!f) {
    hideModalOverlay(fileScreen);
    restoreOpener(fileScreen);
    return;
  }
  rememberOpener(fileScreen);
  containTab(fileScreen);
  showModalOverlay(fileScreen);
  fileScreenBox.setAttribute('role', 'dialog');
  const open = f.mode === 'open';
  fileScreenBox.setAttribute('aria-label', open ? 'Open' : 'Save As');
  const col = 'display:flex;flex-direction:column;gap:10px;padding:0 14px 14px;min-height:0;flex:1 1 auto;';
  const inner = div(col);
  const grip = div('');
  grip.className = 'ui-grip';
  fileScreenBox.appendChild(grip);
  inner.appendChild(div('font-weight:650;font-size:var(--text-title);', open ? 'Open' : 'Save As'));

  // type picker
  const seg = div('display:flex;border:1px solid var(--border-strong);border-radius:var(--radius-control);overflow:hidden;flex:0 0 auto;');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Where');
  for (const t of FILE_SCREEN_TYPES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.type = t;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(f.type === t));
    b.tabIndex = f.type === t ? 0 : -1;
    b.textContent = t === 'local' ? localLabel(f.mode) : LABEL[t];
    b.style.cssText = `flex:1;min-height:var(--target);border:none;border-left:1px solid var(--border-strong);font:inherit;color:var(--fg);background:${f.type === t ? 'var(--accent-soft, var(--surface-solid))' : 'transparent'};font-weight:${f.type === t ? 700 : 400};${f.type === t ? 'box-shadow:inset 0 -3px 0 var(--accent);' : ''}`;
    b.onclick = () => setType(t);
    b.onkeydown = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      setType(stepFileScreenType(f.type, e.key === 'ArrowLeft' ? -1 : 1));
    };
    seg.appendChild(b);
  }
  inner.appendChild(seg);

  // body
  const remote = f.type !== 'local';
  if (remote && f.unconfigured) inner.appendChild(unconfiguredBody(f));
  else if (remote) {
    if (open) inner.appendChild(field(f, 'pathEl'));
    inner.appendChild(listBody(f));
  } else inner.appendChild(localBody(f));

  const needsName = !open && ((remote && !f.unconfigured) || (!remote && !platform.localFiles.supported()));
  if (needsName) inner.appendChild(field(f, 'nameEl'));

  // buttons: Cancel is the emphasized one; nothing here is highlighted for Open or Save
  const buttons = div('display:flex;gap:8px;justify-content:flex-end;flex:0 0 auto;');
  if (needsName) {
    const save = menuButton(!remote ? 'Download' : 'Save', () => saveHere());
    save.dataset.act = 'save';
    buttons.appendChild(save);
  }
  const cancel = menuButton('Cancel', () => closeFileScreen());
  cancel.dataset.act = 'cancel';
  cancel.classList.add('ui-cancel');
  buttons.appendChild(cancel);
  inner.appendChild(buttons);
  fileScreenBox.appendChild(inner);

  if (f.focusSeg) {
    f.focusSeg = false;
    /** @type {HTMLElement | null} */ (seg.querySelector('[aria-checked="true"]'))?.focus();
  } else if (!fileScreenBox.contains(document.activeElement)) cancel.focus();
}

fileScreen.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.fileScreen) {
    e.stopPropagation();
    closeFileScreen();
  }
});
fileScreen.addEventListener('click', (e) => {
  if (e.target === fileScreen && S.fileScreen) closeFileScreen();
});
