// The Open / Save As screen: one sheet (dialog from 600px) that browses a place -- GitHub, WebDAV or this device -- and remembers where
// the person was last in each. The place bar names where it is looking and opens the list of places (a side list on a wide screen).
// GitHub and WebDAV show their folder list straight away; this device does too where the app keeps a folder (the org-pwa folder),
// and elsewhere is a button into the system picker. State lives in S.fileScreen so Escape and the other panels' dismissal reach it
// like any panel. The rules for which place opens first are in src/file-places.js.
import { connectionsLocked, forState } from './connection-vault.js';
import { joinPath, listedAsFile, parentFolder, visibleEntries } from '../src/file-screen-model.js';
import { PLACES, PLACE_NAMES, rememberLocation, spotLabel, startingPlace } from '../src/file-places.js';
import { isPlainTextFile } from '../src/plain-file.js';
import { filesystemAdapter, githubAdapter, webdavAdapter } from './adapters.js';
import { S } from './app-state.js';
import { containTab, rememberOpener, restoreOpener } from './containers.js';
import { confirmDialog, showModalOverlay } from './dialogs.js';
import { ensureConnectionsUnlocked } from './connection-protection.js';
import { openFromFilesystem, openFromImport, openRemotePath, saveAsDeviceFolder, saveAsFilesystem, saveAsGithub, saveAsImport, saveAsWebdav, suggestedSaveAsName } from './documents-io.js';
import { fileScreen, fileScreenBox, settingsBtn } from './dom.js';
import { commitTextModeIfActive } from './editing.js';
import { isGithubConfigured } from './github-adapter.js';
import { folderAvailable } from './local-folder.js';
import { platform } from './platform.js';
import { render } from './render.js';
import { getFileLocation, getGithubConfig, getWebdavConfig, setFileLocation } from './settings.js';
import { kv } from './singletons.js';
import { hideModalOverlay, menuButton } from './ui-widgets.js';
import { isWebdavConfigured } from './webdav-adapter.js';

/** @typedef {typeof S.fileScreen} FileScreen */

const LABEL = PLACE_NAMES;
const BADGE = { github: 'GH', webdav: 'DAV', device: '\u{1F4F1}' };
/** A wide screen lists the places beside the files instead of in a sheet. */
const wide = () => window.matchMedia('(min-width: 900px)').matches;

/** @param {string} css @param {string} [text] */
function div(css, text) {
  const el = document.createElement('div');
  el.style.cssText = css;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** What this device is here: the org-pwa folder the app keeps (listed like the other places), the system file chooser, or a
 * read-once import where there is no File System Access (iOS).
 * @returns {'folder' | 'picker' | 'import'} */
function deviceKind() {
  if (folderAvailable()) return 'folder';
  return platform.localFiles.supported() ? 'picker' : 'import';
}

/** Whether `place` shows a list of folders and files (this device only when the app keeps a folder). @param {string} place */
function browsable(place) {
  return place !== 'device' || deviceKind() === 'folder';
}

/** The adapter that lists, reads and writes in `place`. @param {string} place */
function adapterOf(place) {
  if (place === 'github') return githubAdapter;
  if (place === 'webdav') return webdavAdapter;
  return { list: (/** @type {string} */ folder) => platform.attachments.adapter.list(folder), read: (/** @type {string} */ path) => filesystemAdapter.read(path) };
}

/** Whether each place can be used now, without asking for a passphrase: a locked connection counts as usable (listing it asks).
 * @returns {Promise<{ ready: Record<'github' | 'webdav' | 'device', boolean>, detail: Record<string, string> }>} */
async function placeStatus() {
  /** @type {Record<string, string>} */
  const detail = {};
  const ready = { github: true, webdav: true, device: true };
  if (!connectionsLocked()) {
    const gh = await getGithubConfig(kv);
    const dav = await getWebdavConfig(kv);
    ready.github = isGithubConfigured(gh);
    ready.webdav = isWebdavConfigured(dav);
    if (ready.github) detail.github = `${gh.owner}/${gh.repo}${gh.branch ? ' \u00b7 ' + gh.branch : ''}`;
    if (ready.webdav) detail.webdav = String(dav.baseUrl || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  } else detail.github = detail.webdav = 'Locked \u2014 enter the passphrase to list';
  return { ready, detail };
}

/** Opens the screen for 'open' or 'saveas' where the person was last, or with `dired` in the folder of the current file.
 * @param {'open' | 'saveas'} mode @param {{ dired?: boolean }} [options] */
export async function openFileScreen(mode, options = {}) {
  if (mode === 'saveas' && !S.state.doc) return;
  if (commitTextModeIfActive()) render();
  const loc = await getFileLocation(kv);
  let status = null;
  /** @type {{ place: 'github' | 'webdav' | 'device', folder: string, note: string | null }} */
  let start;
  const wanted = loc.place ?? 'device';
  if (wanted !== 'device' && (await ensureConnectionsUnlocked())) {
    status = await placeStatus();
    start = startingPlace(loc, status.ready);
  } else start = startingPlace(loc, { github: true, webdav: true, device: true });
  if (options.dired && S.state.doc) {
    const here = currentFileSpot();
    if (here) start = { ...here, note: null };
  }
  S.fileScreen = { mode, dired: !!options.dired, place: start.place, folder: start.folder, loc, entries: null, error: null, unconfigured: false, all: false, switching: false, note: start.note, detail: status ? status.detail : {}, ready: status ? status.ready : null, name: mode === 'saveas' ? suggestedSaveAsName('notes.org') : '', pathEl: null, nameEl: null, focusPlace: false };
  renderFileScreen();
  loadListing();
}

/** The place and folder of the file in the current tab, when it is in one the screen lists. @returns {{ place: 'github' | 'webdav' | 'device', folder: string } | null} */
function currentFileSpot() {
  const kind = S.state.storageKind;
  const id = S.state.documentId;
  if (!id) return null;
  if (kind === 'github' || kind === 'webdav') return { place: kind, folder: parentFolder(id) };
  if (kind === 'filesystem' && folderAvailable() && !id.startsWith('/')) return { place: 'device', folder: parentFolder(id) };
  return null;
}

export function closeFileScreen() {
  S.fileScreen = null;
  renderFileScreen();
}

/** Remembers that the person is in `folder` of the current place (what the next Open starts on). @param {FileScreen} f */
function remember(f) {
  // a place that has no folders to list (the system chooser) is the last place but has no folder worth coming back to
  f.loc = browsable(f.place) ? rememberLocation(f.loc, f.place, f.folder) : { ...f.loc, place: f.place };
  setFileLocation(kv, f.loc).catch(() => {});
}

/** Moves to a place, in its own last folder unless one is given; a place this device cannot list is the chooser. @param {'github' | 'webdav' | 'device'} place @param {string} [folder] */
function setPlace(place, folder) {
  const f = S.fileScreen;
  if (!f) return;
  f.place = place;
  f.folder = folder ?? f.loc.folders[place] ?? '';
  f.entries = null;
  f.error = null;
  f.unconfigured = false;
  f.switching = false;
  f.note = null;
  f.focusPlace = true;
  if (!browsable(place)) remember(f);
  renderFileScreen();
  loadListing();
}

/** Loads the folder list of the current place; flags a place that has no settings yet. */
async function loadListing() {
  const f = S.fileScreen;
  if (!f || !browsable(f.place)) return;
  const place = f.place;
  const folder = f.folder;
  if (place !== 'device') {
    if (!(await ensureConnectionsUnlocked())) {
      if (S.fileScreen === f && f.place === place) {
        f.entries = null;
        f.error = 'The connections are locked. Enter the passphrase to list these files.';
        renderFileScreen();
      }
      return;
    }
    const config = place === 'github' ? await getGithubConfig(kv) : await getWebdavConfig(kv);
    if (place === 'github') S.githubConfig = forState('github', config);
    else S.webdavConfig = forState('webdav', config);
    if (S.fileScreen !== f || f.place !== place) return;
    const ok = place === 'github' ? isGithubConfigured(config) : isWebdavConfigured(config);
    if (!ok) {
      f.unconfigured = true;
      renderFileScreen();
      return;
    }
  }
  f.entries = null;
  f.error = null;
  renderFileScreen();
  try {
    const entries = await adapterOf(place).list(folder);
    if (S.fileScreen !== f || f.place !== place || f.folder !== folder) return; // superseded
    f.entries = entries;
    remember(f);
  } catch (err) {
    if (S.fileScreen !== f || f.place !== place || f.folder !== folder) return;
    f.error = err.message;
  }
  renderFileScreen();
}

/** @param {string} path */
function openPath(path) {
  const f = S.fileScreen;
  if (!f || !path.trim()) return;
  const place = f.place;
  closeFileScreen();
  const clean = path.trim().replace(/^\/+/, '');
  if (place === 'github') openRemotePath(clean, 'github', githubAdapter, 'GitHub');
  else if (place === 'webdav') openRemotePath(clean, 'webdav', webdavAdapter, 'WebDAV');
  else openRemotePath(clean, 'filesystem', filesystemAdapter, 'Local');
}

/** Saves under the typed name, asking first when that file is already in the listed folder. */
async function saveHere() {
  const f = S.fileScreen;
  if (!f) return;
  const name = (f.nameEl ? f.nameEl.value : f.name).trim();
  if (!name) return;
  const place = f.place;
  if (!browsable(place)) {
    closeFileScreen();
    saveAsImport(name);
    return;
  }
  const path = joinPath(f.folder, name);
  /** @type {string | null | undefined} */ let seen; // the text being replaced, so a save by someone else meanwhile is asked about
  if (listedAsFile(f.entries, path)) {
    try {
      const existing = await adapterOf(place).read(path);
      seen = existing ? existing.content : null;
    } catch {
      seen = undefined; // not readable now; the save reads it again
    }
    if (!(await confirmDialog(`Replace "${path}"?`, { confirmLabel: 'Replace' }))) return;
  }
  if (S.fileScreen !== f) return;
  closeFileScreen();
  if (place === 'github') saveAsGithub(path, seen);
  else if (place === 'webdav') saveAsWebdav(path, seen);
  else saveAsDeviceFolder(path, seen);
}

/** @param {FileScreen} [f] */
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

/** @param {FileScreen} [f] */
function unconfiguredBody(f) {
  const box = div('border:1px dashed var(--border-strong);border-radius:var(--radius-control);padding:16px;text-align:center;display:flex;flex-direction:column;gap:8px;align-items:center;');
  box.appendChild(div('font-weight:600;', `${LABEL[f.place]} isn't set up yet`));
  box.appendChild(div('font-size:13px;opacity:.7;', f.place === 'github' ? 'Add a repository and access token to browse it here.' : 'Add a server address and login to browse it here.'));
  const btn = menuButton(`Open ${LABEL[f.place]} settings`, () => {
    closeFileScreen();
    settingsBtn.click();
  });
  btn.dataset.act = 'settings';
  box.appendChild(btn);
  return box;
}

/** @param {FileScreen} [f] */
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
  const where = div('opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', `/${f.folder}`);
  crumb.appendChild(where);
  wrap.appendChild(crumb);
  if (f.mode === 'open') {
    // Org files only (the default) or every file: a diary, a notes.txt and a README.md open in the Text view
    const filter = div('display:flex;border:1px solid var(--border-strong);border-radius:var(--radius-control);overflow:hidden;flex:0 0 auto;');
    filter.setAttribute('role', 'radiogroup');
    filter.setAttribute('aria-label', 'Show');
    for (const [all, label] of /** @type {[boolean, string][]} */ ([[false, 'Org files'], [true, 'All files']])) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.show = all ? 'all' : 'org';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(!!f.all === all));
      b.textContent = label;
      b.style.cssText = `flex:1;min-height:var(--target);border:none;border-left:1px solid var(--border-strong);font:inherit;font-size:14px;color:var(--fg);background:${!!f.all === all ? 'var(--accent-soft, var(--surface-solid))' : 'transparent'};font-weight:${!!f.all === all ? 700 : 400};`;
      b.onclick = () => {
        f.all = all;
        renderFileScreen();
      };
      filter.appendChild(b);
    }
    wrap.appendChild(filter);
  }
  const list = div('border:1px solid var(--border-strong);border-radius:var(--radius-control);overflow-y:auto;overscroll-behavior:contain;min-height:80px;flex:1 1 auto;');
  list.dataset.part = 'files';
  if (f.error) list.appendChild(div('padding:10px 12px;font-size:13px;color:#c0392b;', f.error));
  else if (f.entries === null) list.appendChild(div('padding:10px 12px;font-size:13px;opacity:.6;', 'Loading…'));
  else {
    const rows = visibleEntries(f.entries, !!f.all && f.mode === 'open');
    if (rows.length === 0) list.appendChild(div('padding:10px 12px;font-size:13px;opacity:.6;', f.all && f.mode === 'open' ? 'No files or folders here.' : 'No .org files or folders here.'));
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
      tag.textContent = entry.type === 'dir' ? 'folder' : f.mode === 'saveas' && listedAsFile([entry], entry.path.replace(/^\/+/, '')) ? 'exists' : isPlainTextFile(entry.name, 'github') ? 'text' : '';
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

/**
 * The path or name field, built once per open so typing survives redraws.
 * @param {FileScreen} f
 * @param {string} which
 */
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

/** The line under a place's name in the list of places. @param {FileScreen} f @param {'github' | 'webdav' | 'device'} place */
function placeDetail(f, place) {
  if (place === 'device') {
    const kind = deviceKind();
    return kind === 'folder' ? 'The org-pwa folder' : kind === 'picker' ? 'Choose a file with the system chooser' : "Import a file (this browser can't keep a link to it)";
  }
  if (f.ready && f.ready[place] === false) return 'Not set up';
  return f.detail[place] || 'Tap to browse';
}

/** One row of the list of places or of the recent folders. @param {FileScreen} f @param {'github' | 'webdav' | 'device'} place @param {string} title @param {string} detail @param {() => void} act @param {boolean} current @param {boolean} [recent] */
function placeRow(f, place, title, detail, act, current, recent = false) {
  const row = document.createElement('button');
  row.type = 'button';
  if (recent) row.dataset.recent = place;
  else {
    row.dataset.type = place;
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', String(current));
  }
  row.style.cssText = `display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 12px;border:none;border-bottom:1px solid var(--border);background:${current ? 'var(--accent-soft, var(--surface-solid))' : 'transparent'};color:var(--fg);font:inherit;min-height:var(--target);`;
  const badge = div('flex:0 0 auto;width:30px;height:30px;border-radius:8px;background:var(--fg);color:var(--bg);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;', BADGE[place]);
  const text = div('flex:1;min-width:0;');
  text.appendChild(div('font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', title));
  text.appendChild(div('font-size:12px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', detail));
  row.append(badge, text);
  if (current) row.appendChild(div('color:var(--accent);', '\u2713'));
  row.onclick = act;
  return row;
}

/** The places to choose from, and the recent folders. @param {FileScreen} f */
function placeList(f) {
  const list = div('display:flex;flex-direction:column;overflow-y:auto;min-height:0;');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', 'Where');
  if (f.loc.recent.length) {
    list.appendChild(div('padding:8px 12px 2px;font-size:11px;font-weight:700;opacity:.6;letter-spacing:.04em;', 'RECENT'));
    for (const r of f.loc.recent) list.appendChild(placeRow(f, r.place, spotLabel(r.place, r.folder), `${LABEL[/** @type {'github' | 'webdav' | 'device'} */ (r.place)]} \u00b7 ${r.folder || 'top folder'}`, () => setPlace(r.place, r.folder), false, true));
  }
  list.appendChild(div('padding:8px 12px 2px;font-size:11px;font-weight:700;opacity:.6;letter-spacing:.04em;', 'PLACES'));
  for (const place of PLACES) list.appendChild(placeRow(f, place, LABEL[place], placeDetail(f, place), () => setPlace(place), f.place === place));
  return list;
}

/** The place bar: where the screen is looking, and a way to change it. @param {FileScreen} f */
function placeBar(f) {
  const bar = document.createElement('button');
  bar.type = 'button';
  bar.dataset.act = 'place';
  bar.setAttribute('aria-label', `${LABEL[f.place]}. Change place`);
  bar.setAttribute('aria-expanded', String(!!f.switching));
  bar.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 10px;border:1px solid var(--border-strong);border-radius:var(--radius-control);background:transparent;color:var(--fg);font:inherit;flex:0 0 auto;min-height:var(--target);';
  const badge = div('flex:0 0 auto;width:26px;height:26px;border-radius:7px;background:var(--fg);color:var(--bg);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;', BADGE[f.place]);
  const text = div('flex:1;min-width:0;');
  text.appendChild(div('font-weight:600;', LABEL[f.place]));
  text.appendChild(div('font-size:12px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', placeDetail(f, f.place)));
  bar.append(badge, text, div('opacity:.7;', f.switching ? '\u25B4 Close' : '\u25BE Change'));
  bar.onclick = () => {
    f.switching = !f.switching;
    renderFileScreen();
  };
  return bar;
}

/** What goes under the place bar: the files of the place, or what is needed first. @param {FileScreen} f @param {boolean} needsName */
function mainBody(f, needsName) {
  const body = div('display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto;');
  if (f.note) {
    const note = div('font-size:12px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-control);background:var(--surface-solid);', f.note);
    note.dataset.part = 'note';
    body.appendChild(note);
  }
  const open = f.mode === 'open';
  if (browsable(f.place) && f.unconfigured) body.appendChild(unconfiguredBody(f));
  else if (browsable(f.place)) {
    if (open) body.appendChild(field(f, 'pathEl'));
    body.appendChild(listBody(f));
    if (f.place === 'device' && platform.localFiles.supported()) {
      // a file outside the org-pwa folder still comes from the system chooser
      const choose = menuButton(open ? 'Choose another file\u2026' : 'Save somewhere else\u2026', () => {
        closeFileScreen();
        if (open) openFromFilesystem();
        else saveAsFilesystem();
      });
      choose.dataset.act = 'local';
      body.appendChild(choose);
    }
  } else body.appendChild(localBody(f));
  if (needsName) body.appendChild(field(f, 'nameEl'));
  return body;
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
  const title = f.dired ? 'Files' : open ? 'Open' : 'Save As';
  fileScreenBox.setAttribute('aria-label', title);
  const sideBySide = wide();
  fileScreenBox.style.maxWidth = sideBySide ? '860px' : '';
  const col = `display:flex;flex-direction:column;gap:10px;padding:${sideBySide ? 12 : 0}px 14px 14px;min-height:0;flex:1 1 auto;`;
  const inner = div(col);
  const grip = div('');
  grip.className = 'ui-grip';
  fileScreenBox.appendChild(grip);
  inner.appendChild(div('font-weight:650;font-size:var(--text-title);', title));

  const needsName = !open && ((browsable(f.place) && !f.unconfigured) || (!browsable(f.place) && !platform.localFiles.supported()));
  const main = div('display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto;');
  if (sideBySide) {
    // places beside the files
    main.appendChild(mainBody(f, needsName));
    const row = div('display:flex;gap:12px;min-height:0;flex:1 1 auto;');
    const side = div('flex:0 0 240px;border:1px solid var(--border-strong);border-radius:var(--radius-control);overflow:hidden;display:flex;flex-direction:column;min-height:0;');
    side.appendChild(placeList(f));
    row.append(side, main);
    inner.appendChild(row);
  } else {
    inner.appendChild(placeBar(f));
    if (f.switching) main.appendChild(placeList(f));
    else main.appendChild(mainBody(f, needsName));
    inner.appendChild(main);
  }

  // buttons: Cancel is the emphasized one; nothing here is highlighted for Open or Save
  const buttons = div('display:flex;gap:8px;justify-content:flex-end;flex:0 0 auto;');
  if (needsName && !f.switching) {
    const save = menuButton(!browsable(f.place) ? 'Download' : 'Save', () => saveHere());
    save.dataset.act = 'save';
    buttons.appendChild(save);
  }
  const cancel = menuButton('Cancel', () => closeFileScreen());
  cancel.dataset.act = 'cancel';
  cancel.classList.add('ui-cancel');
  buttons.appendChild(cancel);
  inner.appendChild(buttons);
  fileScreenBox.appendChild(inner);

  if (f.focusPlace) {
    f.focusPlace = false;
    /** @type {HTMLElement | null} */ (fileScreenBox.querySelector('[data-act="place"], [role="radio"][aria-checked="true"]'))?.focus();
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
