// The Open / Save As screen: one sheet (dialog from 600px) that browses a place -- GitHub, WebDAV or this device -- and remembers where
// the person was last in each. The place bar names where it is looking and opens the list of places (a side list on a wide screen).
// GitHub and WebDAV show their folder list straight away; this device does too where the app keeps a folder (the org-pwa folder),
// and elsewhere is a button into the system picker. State lives in S.fileScreen so Escape and the other panels' dismissal reach it
// like any panel. The rules for which place opens first are in src/file-places.js.
import { connectionsLocked, forState } from './connection-vault.js';
import { joinPath, listedAsFile, parentFolder } from '../src/file-screen-model.js';
import { arrange, compileFind, findMatches, marking, sizeLabel, targets } from '../src/file-ops.js';
import { PLACES, PLACE_NAMES, rememberLocation, spotLabel, startingPlace } from '../src/file-places.js';
import { isPlainTextFile } from '../src/plain-file.js';
import { filesystemAdapter, githubAdapter, webdavAdapter } from './adapters.js';
import { S } from './app-state.js';
import { containTab, rememberOpener, restoreOpener } from './containers.js';
import { confirmDialog, openButtonChoiceModal, promptText, showModalOverlay } from './dialogs.js';
import { ensureConnectionsUnlocked } from './connection-protection.js';
import { openFromFilesystem, openFromImport, openRemotePath, saveAsDeviceFolder, saveAsFilesystem, saveAsGithub, saveAsImport, saveAsWebdav, suggestedSaveAsName } from './documents-io.js';
import { fileScreen, fileScreenBox, settingsBtn } from './dom.js';
import { commitTextModeIfActive, setStatus } from './editing.js';
import { chooseAttachmentsFolder } from './attachments-store.js';
import { allowDeviceFolder, chooseDeviceFolder, deviceFolderState, deviceIo, dirPickerSupported, isFolderPath, loadKnownPaths, registerFolderFile } from './device-folder.js';
import { collectFiles, ioOf } from './file-ops-io.js';
import { deleteEntries, newFile, newFolder, renameEntry, transferTo } from './file-manage.js';
import { isGithubConfigured } from './github-adapter.js';
import { folderAvailable } from './local-folder.js';
import { platform } from './platform.js';
import { render } from './render.js';
import { getFileLocation, getGithubConfig, getWebdavConfig, setFileLocation } from './settings.js';
import { kv } from './singletons.js';
import { hideModalOverlay, menuButton } from './ui-widgets.js';
import { base64ToArrayBuffer, isWebdavConfigured } from './webdav-adapter.js';

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

/** The chosen folder of this device, in a browser that can open one: its name and what the browser allows now. */
const dirState = /** @type {{ name: string, access: 'granted' | 'prompt' | 'none' }} */ ({ name: '', access: 'none' });

/** What this device is here: the org-pwa folder the app keeps (listed like the other places), a folder the person chose in the browser
 * (listed once the browser allows it), the system file chooser, or a read-once import where there is no File System Access (iOS).
 * @returns {'folder' | 'dirpicker' | 'picker' | 'import'} */
function deviceKind() {
  if (folderAvailable()) return 'folder';
  if (dirPickerSupported()) return 'dirpicker';
  return platform.localFiles.supported() ? 'picker' : 'import';
}

/** Whether `place` shows a list of folders and files (this device only when the app keeps a folder, or the browser allows the chosen one). @param {string} place */
function browsable(place) {
  if (place !== 'device') return true;
  const kind = deviceKind();
  return kind === 'folder' || (kind === 'dirpicker' && dirState.access === 'granted');
}

/** The text of a file in the chosen folder, or null. @param {string} path */
async function readFolderText(path) {
  const bytes = await deviceIo().readBinary(path);
  return bytes && typeof bytes.base64 === 'string' ? { content: new TextDecoder().decode(base64ToArrayBuffer(bytes.base64)) } : null;
}

/** The adapter that lists, reads and writes in `place`. @param {string} place */
function adapterOf(place) {
  if (place === 'github') return githubAdapter;
  if (place === 'webdav') return webdavAdapter;
  return { list: (/** @type {string} */ folder) => deviceIo().list(folder), read: (/** @type {string} */ path) => (deviceKind() === 'dirpicker' ? readFolderText(path) : filesystemAdapter.read(path)) };
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
 * @param {'open' | 'saveas'} mode @param {{ dired?: boolean, attach?: { heading: any, method: 'cp' | 'mv' | 'ln' | 'lns', onAttach: (files: any[]) => Promise<void> } }} [options] */
export async function openFileScreen(mode, options = {}) {
  if (mode === 'saveas' && !S.state.doc) return;
  if (commitTextModeIfActive()) render();
  if (dirPickerSupported()) {
    await loadKnownPaths();
    Object.assign(dirState, await deviceFolderState());
  }
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
  S.fileScreen = { mode, dired: !!options.dired, place: start.place, folder: start.folder, loc, entries: null, error: null, unconfigured: false, sort: 'name', reverse: false, marks: new Set(), flags: new Set(), found: null, transfer: null, attach: options.attach || null, switching: false, note: start.note, detail: status ? status.detail : {}, ready: status ? status.ready : null, name: mode === 'saveas' ? suggestedSaveAsName('notes.org') : '', pathEl: null, nameEl: null, focusPlace: false };
  renderFileScreen();
  loadListing();
}

/** The place and folder of the file in the current tab, when it is in one the screen lists. @returns {{ place: 'github' | 'webdav' | 'device', folder: string } | null} */
function currentFileSpot() {
  const kind = S.state.storageKind;
  const id = S.state.documentId;
  if (!id) return null;
  if (kind === 'github' || kind === 'webdav') return { place: kind, folder: parentFolder(id) };
  if (kind === 'filesystem' && !id.startsWith('/') && (folderAvailable() || (dirPickerSupported() && isFolderPath(id)))) return { place: 'device', folder: parentFolder(id) };
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
  f.found = null;
  f.marks = new Set();
  f.flags = new Set();
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
  else if (deviceKind() === 'dirpicker') {
    registerFolderFile(clean).then(
      () => openRemotePath(clean, 'filesystem', filesystemAdapter, 'Local'),
      (err) => setStatus(`Could not open "${clean}": ${err && err.message ? err.message : err}`),
    );
  } else openRemotePath(clean, 'filesystem', filesystemAdapter, 'Local');
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
  else {
    if (deviceKind() === 'dirpicker') {
      try {
        await registerFolderFile(path, true);
      } catch (err) {
        setStatus(`Could not save "${path}": ${err && err.message ? err.message : err}`);
        return;
      }
    }
    saveAsDeviceFolder(path, seen);
  }
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

/** Asks the browser for a folder of this device and lists it. @param {FileScreen} f */
async function pickDeviceFolder(f) {
  try {
    await chooseDeviceFolder();
  } catch {
    return; // nothing chosen
  }
  Object.assign(dirState, await deviceFolderState());
  if (S.fileScreen !== f) return;
  setPlace('device', '');
}

/** The folder of this device: choose it, or allow it again in this session. @param {FileScreen} f */
function dirPickerBody(f) {
  const box = div('border:1px dashed var(--border-strong);border-radius:var(--radius-control);padding:16px;text-align:center;display:flex;flex-direction:column;gap:10px;align-items:center;');
  const need = dirState.access === 'prompt';
  box.appendChild(div('font-weight:600;', need ? `Allow access to \u201c${dirState.name}\u201d` : 'Choose a folder of this device'));
  box.appendChild(div('font-size:13px;opacity:.7;', need ? 'The browser asks again in each new session.' : 'Its files are listed here and can be opened, saved and managed like the other places.'));
  const btn = menuButton(need ? 'Allow access' : 'Choose a folder\u2026', async () => {
    if (need) {
      const ok = await allowDeviceFolder().catch(() => false);
      Object.assign(dirState, await deviceFolderState());
      if (ok && S.fileScreen === f) setPlace('device', f.loc.folders.device || '');
      else renderFileScreen();
    } else await pickDeviceFolder(f);
  });
  btn.dataset.act = 'device-folder';
  box.appendChild(btn);
  if (need) {
    const other = menuButton('Choose another folder\u2026', () => pickDeviceFolder(f));
    other.dataset.act = 'change-folder';
    box.appendChild(other);
  }
  return box;
}

/** Whether the app can keep a folder of its own here (the Android app) but none is chosen yet. */
const needsAppFolder = () => platform.attachments.supported() && !folderAvailable();

/** The Android app has no folder yet: choose the org-pwa folder, which "This device" then lists. @param {FileScreen} f */
function appFolderBody(f) {
  const box = div('border:1px dashed var(--border-strong);border-radius:var(--radius-control);padding:16px;text-align:center;display:flex;flex-direction:column;gap:10px;align-items:center;');
  box.appendChild(div('font-weight:600;', 'Choose the org-pwa folder'));
  box.appendChild(div('font-size:13px;opacity:.7;', 'A folder of this device where attachments and local files live. Its files are listed here and can be opened, saved and managed like the other places.'));
  const btn = menuButton('Choose a folder\u2026', async () => {
    const name = await chooseAttachmentsFolder();
    if (name && S.fileScreen === f) setPlace('device', '');
    else renderFileScreen();
  });
  btn.dataset.act = 'device-folder';
  box.appendChild(btn);
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

/** The rows on screen: the listing, filtered and sorted. @param {FileScreen} f */
function shownRows(f) {
  if (f.found) return arrange(findMatches(f.found.all, f.found.regexp) || [], f.sort, f.reverse);
  return f.entries ? arrange(f.entries, f.sort, f.reverse) : [];
}

/** What to act on: the marked rows, or `point` when none is marked. @param {FileScreen} f @param {any} [point] */
function actTargets(f, point) {
  return targets(f.marks, shownRows(f), point || null);
}

/** Back to the folder list after a change to files. */
async function reloadAfter() {
  const f = S.fileScreen;
  if (!f) return;
  if (f.found) await runFind(f, f.found.regexp);
  else await loadListing();
}

/** @param {FileScreen} f @param {string} label @param {{ text: string, onClick: () => any, disabled?: boolean }[]} buttons */
function chooseFrom(f, label, buttons) {
  openButtonChoiceModal({ label, buttons: [...buttons, { text: 'Cancel', onClick: () => {} }] });
}

/** Copy or move `items` into a folder the person picks next in this same screen. @param {FileScreen} f @param {'copy' | 'move'} kind @param {any[]} items */
function startTransfer(f, kind, items) {
  if (items.length === 0) return;
  f.transfer = { kind, items, from: f.place };
  f.found = null; // the folder where the search started is the place to browse from
  f.marks = new Set();
  renderFileScreen();
}

async function finishTransfer() {
  const f = S.fileScreen;
  if (!f || !f.transfer) return;
  const { kind, items, from } = f.transfer;
  f.transfer = null;
  await transferTo(kind, items, from, f.place, f.folder);
  await reloadAfter();
}

/** @param {any} entry */
function infoLine(entry) {
  const parts = [`${entry.type === 'dir' ? 'Folder' : 'File'} “${entry.name}”`, `path /${entry.path.replace(/^\/+/, '')}`];
  if (typeof entry.size === 'number') parts.push(`${sizeLabel(entry.size)} (${entry.size} bytes)`);
  if (typeof entry.modified === 'number') parts.push(`modified ${new Date(entry.modified).toLocaleString()}`);
  return parts.join(' · ');
}

/** The actions for one row: what Dired does at point. @param {FileScreen} f @param {any} entry */
function rowMenu(f, entry) {
  const place = f.place;
  const flagged = f.flags.has(entry.path);
  chooseFrom(f, entry.name, [
    {
      text: 'Rename…',
      onClick: async () => {
        await renameEntry(entry, place, parentFolder(entry.path.replace(/^\/+/, '')));
        await reloadAfter();
      },
    },
    { text: 'Copy to…', onClick: () => startTransfer(f, 'copy', actTargets(f, entry)) },
    { text: 'Move to…', onClick: () => startTransfer(f, 'move', actTargets(f, entry)) },
    {
      text: 'Delete…',
      onClick: async () => {
        await deleteEntries(actTargets(f, entry), place);
        await reloadAfter();
      },
    },
    {
      text: flagged ? 'Unflag' : 'Flag for deletion',
      onClick: () => {
        if (flagged) f.flags.delete(entry.path);
        else f.flags.add(entry.path);
        renderFileScreen();
      },
    },
    { text: 'Info', onClick: () => confirmDialog(infoLine(entry), { confirmLabel: 'OK', cancelLabel: 'Close', danger: false }) },
  ]);
}

/** The buttons above the list: sort, new, marks, and what the marked rows can have done to them. @param {FileScreen} f */
function toolBar(f) {
  const bar = div('display:flex;flex-wrap:wrap;gap:6px;align-items:center;');
  bar.dataset.part = 'tools';
  const sortName = { name: 'Name', date: 'Date', size: 'Size' }[/** @type {'name' | 'date' | 'size'} */ (f.sort)];
  const sort = menuButton(`Sort: ${sortName}${f.reverse ? ' ⇅' : ''}`, () =>
    chooseFrom(f, 'Sort by', [
      ...(/** @type {['name' | 'date' | 'size', string][]} */ ([['name', 'Name'], ['date', 'Date, newest first'], ['size', 'Size, largest first']])).map(([key, text]) => ({
        text,
        onClick: () => {
          f.sort = key;
          renderFileScreen();
        },
      })),
      {
        text: 'Reverse the order',
        onClick: () => {
          f.reverse = !f.reverse;
          renderFileScreen();
        },
      },
    ]),
  );
  sort.dataset.act = 'sort';
  const find = menuButton('Find\u2026', () => askFind(f));
  find.dataset.act = 'find';
  bar.append(find, sort);
  if (f.attach) return bar;
  const create = menuButton('New…', () =>
    chooseFrom(f, 'New', [
      {
        text: 'File',
        onClick: async () => {
          const path = await newFile(f.place, f.folder, f.entries);
          if (path) openPath(path);
        },
      },
      {
        text: 'Folder',
        onClick: async () => {
          await newFolder(f.place, f.folder);
          await reloadAfter();
        },
      },
    ]),
  );
  create.dataset.act = 'new';
  const marks = menuButton(f.marks.size || f.flags.size ? `Marks (${f.marks.size}${f.flags.size ? ` + ${f.flags.size} flagged` : ''})` : 'Marks', () =>
    chooseFrom(f, 'Marks', [
      {
        text: 'Mark by pattern…',
        onClick: async () => {
          const pattern = await promptText('Mark the files whose name matches (a regular expression):', '', { okLabel: 'Mark' });
          if (!pattern) return;
          const next = marking.byRegexp(f.marks, shownRows(f), pattern);
          if (!next) setStatusNote(f, 'That is not a valid regular expression.');
          else f.marks = next;
          renderFileScreen();
        },
      },
      {
        text: 'Mark all shown',
        onClick: () => {
          f.marks = new Set(shownRows(f).map((e) => e.path));
          renderFileScreen();
        },
      },
      {
        text: 'Invert marks',
        onClick: () => {
          f.marks = marking.invert(f.marks, shownRows(f));
          renderFileScreen();
        },
      },
      {
        text: 'Unmark all',
        onClick: () => {
          f.marks = marking.clear();
          f.flags = new Set();
          renderFileScreen();
        },
      },
      {
        text: `Delete the ${f.flags.size} flagged`,
        disabled: f.flags.size === 0,
        onClick: async () => {
          const flagged = shownRows(f).filter((e) => f.flags.has(e.path));
          await deleteEntries(flagged, f.place);
          await reloadAfter();
        },
      },
    ]),
  );
  marks.dataset.act = 'marks';
  if (f.found) bar.appendChild(marks);
  else bar.append(create, marks);
  return bar;
}

/** A line of feedback under the place bar. @param {FileScreen} f @param {string} text */
function setStatusNote(f, text) {
  f.note = text;
}

/** What the marked rows can have done to them. @param {FileScreen} f */
function markedBar(f) {
  const bar = div('display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-control);background:var(--surface-solid);');
  bar.dataset.part = 'marked';
  bar.appendChild(div('font-size:13px;font-weight:600;flex:1 1 auto;', `${f.marks.size} marked`));
  const items = () => shownRows(f).filter((e) => f.marks.has(e.path));
  /** @type {[string, string, () => any][]} */
  const actions = [
    ['copy', 'Copy to…', () => startTransfer(f, 'copy', items())],
    ['move', 'Move to…', () => startTransfer(f, 'move', items())],
    [
      'delete',
      'Delete…',
      async () => {
        await deleteEntries(items(), f.place);
        await reloadAfter();
      },
    ],
    [
      'unmark',
      'Unmark',
      () => {
        f.marks = new Set();
        renderFileScreen();
      },
    ],
  ];
  if (f.attach) actions.splice(0, 3);
  for (const [act, text, run] of actions) {
    const b = menuButton(text, run);
    b.dataset.act = act;
    bar.appendChild(b);
  }
  return bar;
}

/** Attaches the marked files to the heading this screen was opened for. */
async function attachMarked() {
  const f = S.fileScreen;
  if (!f || !f.attach) return;
  const { heading, onAttach } = f.attach;
  const place = f.place;
  const picked = shownRows(f).filter((e) => f.marks.has(e.path) && e.type === 'file');
  closeFileScreen();
  const files = [];
  for (const entry of picked) {
    const path = entry.path.replace(/^\/+/, '');
    const bytes = await ioOf(place).readBinary(path);
    if (!bytes || typeof bytes.base64 !== 'string') continue;
    files.push({ name: entry.name, base64: bytes.base64, remove: () => ioOf(place).delete(path) });
  }
  if (files.length) await onAttach(files);
  void heading;
}

/** Fills the list with the rows of the current folder. @param {FileScreen} f @param {HTMLElement} list */
function fillList(f, list) {
  list.textContent = '';
  if (f.error) list.appendChild(div('padding:10px 12px;font-size:13px;color:#c0392b;', f.error));
  else if (f.entries === null) list.appendChild(div('padding:10px 12px;font-size:13px;opacity:.6;', 'Loading…'));
  else {
    const rows = shownRows(f);
    if (rows.length === 0) list.appendChild(div('padding:10px 12px;font-size:13px;opacity:.6;', f.found ? 'No file matches.' : 'No files or folders here.'));
    for (const entry of rows) list.appendChild(listRow(f, entry));
  }
}

/** One row: the mark, the name (open it, or go into the folder) and the actions. @param {FileScreen} f @param {any} entry */
function listRow(f, entry) {
  const pickingFolder = !!f.transfer;
  const row = div('display:flex;align-items:stretch;border-bottom:1px solid var(--border);');
  row.dataset.row = entry.name;
  if (!pickingFolder) {
    const marked = f.marks.has(entry.path);
    const flagged = f.flags.has(entry.path);
    const mark = document.createElement('button');
    mark.type = 'button';
    mark.dataset.act = 'mark';
    mark.setAttribute('aria-label', `${marked ? 'Unmark' : 'Mark'} ${entry.name}`);
    mark.setAttribute('aria-pressed', String(marked));
    mark.textContent = flagged ? 'D' : marked ? '✓' : '';
    mark.style.cssText = `flex:0 0 auto;width:40px;min-height:var(--target);border:none;border-right:1px solid var(--border);background:${marked ? 'var(--accent-soft, var(--surface-solid))' : 'transparent'};color:${flagged ? '#c0392b' : 'var(--accent)'};font:inherit;font-weight:700;`;
    mark.onclick = () => {
      f.marks = marking.toggleOne(f.marks, entry.path);
      renderFileScreen();
    };
    row.appendChild(mark);
  }
  const main = document.createElement('button');
  main.type = 'button';
  main.dataset.entry = entry.name;
  const dead = pickingFolder && entry.type !== 'dir';
  main.disabled = dead;
  main.style.cssText = `display:flex;justify-content:space-between;align-items:center;gap:8px;flex:1 1 auto;min-width:0;min-height:var(--target);text-align:left;padding:8px 12px;border:none;background:transparent;color:var(--fg);font:inherit;font-size:14px;${dead ? 'opacity:.4;' : ''}`;
  const name = document.createElement('span');
  name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  name.textContent = f.found ? entry.path.replace(/^\/+/, '').slice(f.found.folder ? f.found.folder.length + 1 : 0) : entry.name;
  main.appendChild(name);
  const tag = document.createElement('small');
  tag.style.cssText = 'opacity:.6;flex:0 0 auto;';
  tag.textContent = entry.type === 'dir' ? 'folder' : f.mode === 'saveas' && listedAsFile([entry], entry.path.replace(/^\/+/, '')) ? 'exists' : f.sort === 'date' && typeof entry.modified === 'number' ? new Date(entry.modified).toLocaleDateString() : sizeLabel(entry.size) || (isPlainTextFile(entry.name, 'github') ? 'text' : '');
  main.appendChild(tag);
  main.onclick = () => {
    if (entry.type === 'dir') {
      f.folder = entry.path.replace(/^\/+/, '');
      loadListing();
    } else if (f.attach) {
      f.marks = marking.toggleOne(f.marks, entry.path);
      renderFileScreen();
    } else if (f.mode === 'open') openPath(entry.path);
    else {
      if (f.nameEl) f.nameEl.value = entry.name;
      f.name = entry.name;
    }
  };
  row.appendChild(main);
  if (!pickingFolder && !f.attach) {
    const more = document.createElement('button');
    more.type = 'button';
    more.dataset.act = 'row-menu';
    more.setAttribute('aria-label', `Actions for ${entry.name}`);
    more.textContent = '⋯';
    more.style.cssText = 'flex:0 0 auto;width:44px;min-height:var(--target);border:none;border-left:1px solid var(--border);background:transparent;color:var(--fg);font:inherit;font-size:18px;';
    more.onclick = () => rowMenu(f, entry);
    row.appendChild(more);
  }
  return row;
}

/** Asks for the regexp of a Find and runs it from the folder on screen. @param {FileScreen} f */
async function askFind(f) {
  const regexp = await promptText(`Find files below /${f.folder} whose name matches (an Emacs regexp, e.g. \\.org$):`, f.found ? f.found.regexp : '', { okLabel: 'Find' });
  if (regexp == null || S.fileScreen !== f) return;
  await runFind(f, regexp);
}

/** `find-lisp-find-dired`: lists the files below the folder whose name matches `regexp`. The files are fetched once; changing the filter matches them again.
 * @param {FileScreen} f @param {string} regexp */
async function runFind(f, regexp) {
  const compiled = compileFind(regexp);
  if ('error' in compiled) {
    f.note = `Not an Emacs regexp: ${compiled.error}`;
    renderFileScreen();
    return;
  }
  const place = f.place;
  const folder = f.found ? f.found.folder : f.folder;
  let stop = false;
  const search = { regexp, all: /** @type {any[]} */ ([]), truncated: false, folder, place, searching: true, progress: 'Searching…', cancel: () => (stop = true) };
  f.found = search;
  f.note = null;
  f.marks = new Set();
  f.flags = new Set();
  renderFileScreen();
  try {
    const result = await collectFiles(place, folder, {
      cancelled: () => stop || S.fileScreen !== f || f.found !== search,
      onProgress: (files, folders) => {
        if (S.fileScreen !== f || f.found !== search) return;
        search.progress = `Searching… ${files} files in ${folders} folders`;
        const status = fileScreenBox.querySelector('[data-part=found-status]');
        if (status) status.textContent = search.progress;
      },
    });
    if (S.fileScreen !== f || f.found !== search) return;
    search.all = result.files;
    search.truncated = result.truncated;
  } catch (err) {
    if (S.fileScreen !== f || f.found !== search) return;
    f.found = null;
    f.error = err && err.message ? err.message : String(err);
  }
  search.searching = false;
  renderFileScreen();
}

/** The line above a Find's results: what it found, and changing the filter, searching again, or leaving. @param {FileScreen} f */
function foundBar(f) {
  const found = f.found;
  const bar = div('display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-control);background:var(--surface-solid);');
  bar.dataset.part = 'found';
  const rows = findMatches(found.all, found.regexp) || [];
  const text = found.searching ? found.progress : `${rows.length} of ${found.all.length} files below /${found.folder} match “${found.regexp}”${found.truncated ? ` (the search stopped at ${found.all.length} files)` : ''}`;
  const status = div('font-size:13px;flex:1 1 160px;min-width:0;', text);
  status.dataset.part = 'found-status';
  bar.appendChild(status);
  /** @type {[string, string, () => any][]} */
  const actions = found.searching
    ? [['find-cancel', 'Cancel', () => found.cancel()]]
    : [
        [
          'refine',
          'Change filter…',
          async () => {
            const next = await promptText('Change the filter to (an Emacs regexp):', found.regexp, { okLabel: 'Change' });
            if (next == null || S.fileScreen !== f || f.found !== found) return;
            const compiled = compileFind(next);
            if ('error' in compiled) {
              f.note = `Not an Emacs regexp: ${compiled.error}`;
              renderFileScreen();
              return;
            }
            found.regexp = next;
            const keep = new Set((findMatches(found.all, next) || []).map((e) => e.path));
            f.marks = new Set([...f.marks].filter((path) => keep.has(path)));
            f.flags = new Set([...f.flags].filter((path) => keep.has(path)));
            renderFileScreen();
          },
        ],
        ['find-reload', 'Search again', () => runFind(f, found.regexp)],
        [
          'find-close',
          'Close',
          () => {
            f.found = null;
            f.marks = new Set();
            f.flags = new Set();
            if (f.entries === null) loadListing();
            else renderFileScreen();
          },
        ],
      ];
  for (const [act, label, run] of actions) {
    const b = menuButton(label, run);
    b.dataset.act = act;
    bar.appendChild(b);
  }
  return bar;
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
  const list = div('border:1px solid var(--border-strong);border-radius:var(--radius-control);overflow-y:auto;overscroll-behavior:contain;min-height:80px;flex:1 1 auto;');
  list.dataset.part = 'files';
  if (f.transfer) {
    const word = f.transfer.kind === 'copy' ? 'Copy' : 'Move';
    wrap.appendChild(div('font-size:13px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-control);background:var(--surface-solid);', `${word} ${f.transfer.items.length === 1 ? `“${f.transfer.items[0].name}”` : `${f.transfer.items.length} items`}: open the folder to ${word.toLowerCase()} into${f.transfer.from !== f.place ? ` (from ${LABEL[f.transfer.from]})` : ''}, then tap ${word} here.`));
  } else {
    wrap.appendChild(toolBar(f));
    if (f.found) wrap.appendChild(foundBar(f));
    if (f.marks.size) wrap.appendChild(markedBar(f));
  }
  fillList(f, list);
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
    if (kind === 'dirpicker') return dirState.access === 'none' ? 'Choose a folder of this device' : dirState.access === 'granted' ? `The folder \u201c${dirState.name}\u201d` : `\u201c${dirState.name}\u201d \u2014 tap to allow access`;
    return kind === 'folder' ? 'The org-pwa folder' : needsAppFolder() ? 'Choose the org-pwa folder' : kind === 'picker' ? 'Choose a file with the system chooser' : "Import a file (this browser can't keep a link to it)";
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
    if (open && !f.attach) body.appendChild(field(f, 'pathEl'));
    body.appendChild(listBody(f));
    if (f.place === 'device' && platform.localFiles.supported() && !f.attach && !f.transfer) {
      // a file outside the org-pwa folder still comes from the system chooser
      const choose = menuButton(open ? 'Choose another file\u2026' : 'Save somewhere else\u2026', () => {
        closeFileScreen();
        if (open) openFromFilesystem();
        else saveAsFilesystem();
      });
      choose.dataset.act = 'local';
      body.appendChild(choose);
    }
    if (f.place === 'device' && deviceKind() === 'dirpicker' && !f.attach && !f.transfer) {
      const change = menuButton('Choose another folder\u2026', () => pickDeviceFolder(f));
      change.dataset.act = 'change-folder';
      body.appendChild(change);
    }
  } else {
    if (f.place === 'device' && deviceKind() === 'dirpicker' && !f.attach && !f.transfer) body.appendChild(dirPickerBody(f));
    if (f.place === 'device' && needsAppFolder() && !f.attach && !f.transfer) body.appendChild(appFolderBody(f));
    body.appendChild(localBody(f));
  }
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
  const title = f.attach ? `Attach to \u201c${f.attach.heading.title || '(untitled)'}\u201d` : f.dired ? 'Files' : open ? 'Open' : 'Save As';
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
  if (f.transfer) {
    const here = menuButton(f.transfer.kind === 'copy' ? 'Copy here' : 'Move here', () => finishTransfer());
    here.dataset.act = 'transfer-here';
    here.disabled = !browsable(f.place) || f.unconfigured;
    buttons.appendChild(here);
  } else if (f.attach) {
    const attach = menuButton(`Attach${f.marks.size ? ` (${f.marks.size})` : ''}`, () => attachMarked());
    attach.dataset.act = 'attach';
    attach.disabled = f.marks.size === 0;
    buttons.appendChild(attach);
  }
  const cancel = menuButton(f.transfer ? 'Cancel ' + f.transfer.kind : 'Cancel', () => {
    if (f.transfer) {
      f.transfer = null;
      renderFileScreen();
    } else closeFileScreen();
  });
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
