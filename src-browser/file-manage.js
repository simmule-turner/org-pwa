// @ts-check
// Managing files from the Files view, the way Dired does: copy, move, rename and delete with the questions Dired asks (a file that
// would be replaced: yes / no / all / quit; delete: one confirmation, a folder named as such), and the care it takes of open
// documents. A file that is open with unsaved changes is never deleted, moved or replaced; one that is open and saved is asked
// about, and its tab follows a move or closes with a delete. The decisions are in src/file-ops.js; the work on files in file-ops-io.js.
import { cleanPath, isInside, movedPath, openConflicts, planTransfer, renameTarget, validName } from '../src/file-ops.js';
import { githubAdapter, webdavAdapter, filesystemAdapter } from './adapters.js';
import { S } from './app-state.js';
import { confirmDialog, openButtonChoiceModal, promptText } from './dialogs.js';
import { setStatus } from './editing.js';
import { copyEntry, listing, makeFile, makeFolder, removeEntry } from './file-ops-io.js';
import { dirPickerSupported, isFolderPath } from './device-folder.js';
import { folderAvailable } from './local-folder.js';
import { openRemotePath } from './documents-io.js';
import { render } from './render.js';
import { closeTab } from './tabs.js';

/** @typedef {import('./file-ops-io.js').Place} Place */
/** @typedef {import('../src/file-ops.js').FileEntry} FileEntry */

/** @param {{ documentId?: string | null, storageKind?: string | null } | null | undefined} state @returns {Place | null} */
function placeOfState(state) {
  const id = state && state.documentId;
  if (!id) return null;
  if (state.storageKind === 'github' || state.storageKind === 'webdav') return state.storageKind;
  if (state.storageKind === 'filesystem' && !String(id).startsWith('/') && (folderAvailable() || (dirPickerSupported() && isFolderPath(String(id))))) return 'device';
  return null;
}

/** The open documents that live in `place`: where each is, whether it has unsaved changes, and its tab. @param {Place} place */
export function openDocuments(place) {
  const out = [];
  const sessions = S.documentSessions.length ? S.documentSessions : [{ tabId: S.activeTabId, state: S.state, isDirty: S.isDirty }];
  for (const session of sessions) {
    const active = session.tabId === S.activeTabId;
    const state = active ? S.state : session.state;
    if (placeOfState(state) === place) out.push({ path: cleanPath(String(state.documentId)), dirty: !!(active ? S.isDirty : session.isDirty), tabId: session.tabId });
  }
  return out;
}

/** Reopens `path` of `place` in a tab. @param {Place} place @param {string} path */
export function openInPlace(place, path) {
  if (place === 'github') return openRemotePath(path, 'github', githubAdapter, 'GitHub');
  if (place === 'webdav') return openRemotePath(path, 'webdav', webdavAdapter, 'WebDAV');
  return openRemotePath(path, 'filesystem', filesystemAdapter, 'Local');
}

/** A file that would be replaced: 'yes' (this one), 'no' (skip it), 'all' (this and the rest) or 'quit' (stop). Dismissing the question is quit.
 * @param {string} path @returns {Promise<'yes' | 'no' | 'all' | 'quit'>} */
function askReplace(path) {
  return new Promise((resolve) => {
    let answered = false;
    /** @param {'yes' | 'no' | 'all' | 'quit'} answer */
    const answer = (answer) => () => {
      answered = true;
      resolve(answer);
    };
    const overlay = openButtonChoiceModal({
      label: `"${path}" already exists. Replace it?`,
      buttons: [
        { text: 'Yes', onClick: answer('yes') },
        { text: 'No', onClick: answer('no') },
        { text: 'Yes to all', onClick: answer('all') },
        { text: 'Quit', onClick: answer('quit') },
      ],
    });
    // Escape removes the question without pressing a button
    new MutationObserver((_, observer) => {
      if (!overlay.isConnected) {
        observer.disconnect();
        setTimeout(() => {
          if (!answered) resolve('quit');
        }, 0);
      }
    }).observe(document.body, { childList: true });
  });
}

/** @param {number} n @param {string} one @param {string} many */
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Closes the tabs of the open documents, or follows them to new paths. @param {Place} reopenIn @param {{ path: string, tabId: number | null }[]} docs @param {((path: string) => string | null) | null} follow */
async function settleTabs(reopenIn, docs, follow) {
  for (const doc of docs) {
    if (doc.tabId != null) await closeTab(doc.tabId);
    const next = follow ? follow(doc.path) : null;
    if (next) await openInPlace(reopenIn, next);
  }
}

/**
 * Copies or moves the planned items; the target of each is its `to`. A clash is asked about. A move deletes the original only once
 * the copy is written, and an open document that moved is reopened at its new path.
 * @param {'copy' | 'move'} kind
 * @param {{ item: FileEntry, to: string, clash: boolean }[]} moves
 * @param {Place} from @param {Place} into
 * @returns {Promise<number>} how many were done
 */
export async function performTransfer(kind, moves, from, into) {
  if (moves.length === 0) return 0;
  const open = kind === 'move' ? openDocuments(from) : [];
  const { refuse } = openConflicts(
    moves.map((m) => cleanPath(m.item.path)),
    open,
  );
  if (refuse.length) {
    setStatus(`Not moved: ${refuse.join(', ')} ${refuse.length === 1 ? 'is' : 'are'} open with unsaved changes. Save or close ${refuse.length === 1 ? 'it' : 'them'} first.`);
    render();
    return 0;
  }
  let all = false;
  let done = 0;
  /** @type {string | null} */
  let failed = null;
  for (const move of moves) {
    if (move.clash && !all) {
      const answer = await askReplace(move.to);
      if (answer === 'quit') break;
      if (answer === 'no') continue;
      if (answer === 'all') all = true;
    }
    try {
      await copyEntry(from, move.item, into, move.to);
      if (kind === 'move') {
        await removeEntry(from, move.item);
        const source = cleanPath(move.item.path);
        const affected = open.filter((d) => movedPath(d.path, source, move.to) !== null);
        await settleTabs(into, affected, (path) => movedPath(path, source, move.to));
      }
      done++;
    } catch (err) {
      failed = `${move.item.name}: ${err && err.message ? err.message : err}`;
      break;
    }
  }
  const verb = kind === 'copy' ? 'Copied' : 'Moved';
  setStatus(failed ? `${verb} ${done} of ${moves.length}; stopped at ${failed}` : `${verb} ${count(done, 'item', 'items')}.`);
  render();
  return done;
}

/** Copy or move `items` of `from` into `folder` of `into`, with the checks Dired makes (not onto itself, not into itself).
 * @param {'copy' | 'move'} kind @param {FileEntry[]} items @param {Place} from @param {Place} into @param {string} folder */
export async function transferTo(kind, items, from, into, folder) {
  const existing = await listing(into, folder);
  const plan = planTransfer(items, folder, existing, { samePlace: from === into });
  if (plan.same.length) setStatus(`Cannot ${kind} over itself: ${plan.same.map((e) => e.name).join(', ')}.`);
  if (plan.intoSelf.length) setStatus(`Cannot ${kind} a folder into itself: ${plan.intoSelf.map((e) => e.name).join(', ')}.`);
  return performTransfer(kind, plan.moves, from, into);
}

/** The folder part of a path and its last name. @param {string} path @returns {[string, string]} */
const splitLast = (path) => {
  const i = path.lastIndexOf('/');
  return i < 0 ? ['', path] : [path.slice(0, i), path.slice(i + 1)];
};

/**
 * `R` (dired-do-rename) on one file: asks where it goes. A bare name renames it in its folder; a path moves it there, relative to the folder in
 * view or, with a leading slash, to the top of the place. An existing folder takes the file in, keeping its name. The file is copied and the
 * original deleted, as every move is here.
 * @param {FileEntry} entry @param {Place} place @param {string} folder
 */
export async function renameEntry(entry, place, folder) {
  const typed = await promptText(`Rename "${entry.name}" to:`, entry.name, { okLabel: 'Rename' });
  if (typed == null) return 0;
  /** @param {string} message */
  const refuse = (message) => {
    setStatus(message);
    render();
    return 0;
  };
  const target = renameTarget(folder, typed);
  if ('error' in target) return refuse(target.error);
  const [targetParent, targetName] = splitLast(target.path);
  const inParent = target.path === '' ? null : await listing(place, targetParent);
  const intoFolder = target.path === '' || (!!inParent && inParent.some((e) => e.name === targetName && e.type === 'dir'));
  let to;
  if (intoFolder) to = [target.path, entry.name].filter(Boolean).join('/');
  else if (target.folder || !inParent) return refuse(`No such directory: ${target.folder ? target.path : targetParent}`);
  else to = target.path;
  const source = cleanPath(entry.path);
  if (to === source) return refuse('Cannot rename a file to itself.');
  if (entry.type === 'dir' && isInside(source, to)) return refuse('Cannot move a folder into itself.');
  const [toParent, toName] = splitLast(to);
  const existing = await listing(place, toParent);
  return performTransfer('move', [{ item: entry, to, clash: !!existing && existing.some((e) => e.name === toName) }], place, place);
}

/** `D`: deletes `items` after one question (Dired names a folder as a recursive delete). Open files with unsaved changes refuse; saved ones are mentioned and their tabs close.
 * @param {FileEntry[]} items @param {Place} place */
export async function deleteEntries(items, place) {
  if (items.length === 0) return 0;
  const open = openDocuments(place);
  const { refuse, ask } = openConflicts(
    items.map((e) => cleanPath(e.path)),
    open,
  );
  if (refuse.length) {
    setStatus(`Not deleted: ${refuse.join(', ')} ${refuse.length === 1 ? 'is' : 'are'} open with unsaved changes. Save or close ${refuse.length === 1 ? 'it' : 'them'} first.`);
    render();
    return 0;
  }
  const folders = items.filter((e) => e.type === 'dir').length;
  let message = items.length === 1 ? (folders ? `Delete the folder "${items[0].name}" and everything in it?` : `Delete "${items[0].name}"?`) : `Delete ${count(items.length, 'file', 'files')}${folders ? ` (${count(folders, 'folder', 'folders')}, with everything in ${folders === 1 ? 'it' : 'them'})` : ''}?`;
  if (ask.length) message += ` ${ask.length === 1 ? `"${ask[0]}" is open; its tab will close.` : `${ask.length} of them are open; their tabs will close.`}`;
  if (!(await confirmDialog(message, { confirmLabel: 'Delete' }))) return 0;
  let done = 0;
  for (const item of items) {
    try {
      await removeEntry(place, item);
      done++;
    } catch (err) {
      setStatus(`Deleted ${done} of ${items.length}; stopped at ${item.name}: ${err && err.message ? err.message : err}`);
      render();
      break;
    }
  }
  await settleTabs(place, open.filter((d) => ask.includes(d.path)), null);
  if (done === items.length) setStatus(`Deleted ${count(done, 'item', 'items')}.`);
  render();
  return done;
}

/** `+`: a new folder in `folder`. @param {Place} place @param {string} folder */
export async function newFolder(place, folder) {
  const name = await promptText('New folder:', '', { okLabel: 'Create' });
  if (name == null) return false;
  if (!validName(name)) {
    setStatus('A name cannot be empty or hold a slash.');
    render();
    return false;
  }
  const path = [cleanPath(folder), name.trim()].filter(Boolean).join('/');
  try {
    await makeFolder(place, path);
    setStatus(`Created the folder "${path}".`);
  } catch (err) {
    setStatus(`Could not create "${path}": ${err && err.message ? err.message : err}`);
  }
  render();
  return true;
}

/** A new, empty file in `folder`, opened afterwards; an existing name is not touched. @param {Place} place @param {string} folder @param {FileEntry[] | null} existing */
export async function newFile(place, folder, existing) {
  const name = await promptText('New file:', 'untitled.org', { okLabel: 'Create' });
  if (name == null) return null;
  if (!validName(name)) {
    setStatus('A name cannot be empty or hold a slash.');
    render();
    return null;
  }
  if (existing && existing.some((e) => e.name === name.trim())) {
    setStatus(`"${name.trim()}" already exists.`);
    render();
    return null;
  }
  const path = [cleanPath(folder), name.trim()].filter(Boolean).join('/');
  try {
    await makeFile(place, path);
  } catch (err) {
    setStatus(`Could not create "${path}": ${err && err.message ? err.message : err}`);
    render();
    return null;
  }
  return path;
}
