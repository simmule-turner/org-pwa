// @ts-check
// C-c [ (org-agenda-file-to-front), C-c ] (org-remove-file) and C-' / C-, (org-cycle-agenda-files): change the list of agenda files, or go
// through it. The list is the app's org-agenda-files setting.
import { getAgendaFilesVar, parseAgendaFilesVar } from '../src/local-variables.js';
import { S } from './app-state.js';
import { setStatus } from './editing.js';
import { openRecentFile } from './file-menu.js';
import { commitGlobalVariableChange } from './settings-quick.js';

/** The key of the open file in the list of agenda files: `local:`, `github:` or `webdav:` and its path. @returns {string | null} */
function openFileKey() {
  const kind = S.state.storageKind;
  if (!kind || !S.state.documentId) return null;
  return `${kind === 'filesystem' ? 'local' : kind}:${S.state.documentId}`;
}

/** The files of org-agenda-files; null, with the reason said, when the setting is not a list (Emacs reads a directory or a file of names there). @returns {string[] | null} */
function agendaFileList() {
  const raw = getAgendaFilesVar(S.globalVariables).trim().replace(/^'/, '');
  if (raw !== '' && raw !== 'nil' && !raw.startsWith('(')) {
    setStatus("`org-agenda-files' cannot be a single directory");
    return null;
  }
  return parseAgendaFilesVar(raw);
}

/** @param {string[]} files */
const storeList = (files) => commitGlobalVariableChange('org-agenda-files', `(${files.map((f) => JSON.stringify(f)).join(' ')})`);

/** `org-agenda-file-to-front`: puts the open file first in the agenda files (last with `C-u`). @param {boolean} toEnd */
export async function fileToFront(toEnd) {
  const key = openFileKey();
  if (!key) return setStatus('Please save the current buffer to a file');
  const files = agendaFileList();
  if (!files) return;
  const had = files.includes(key);
  const rest = files.filter((f) => f !== key);
  await storeList(toEnd ? [...rest, key] : [key, ...rest]);
  setStatus(`File ${had ? 'moved' : 'added'} to ${toEnd ? 'end' : 'front'} of agenda file list`);
}

/** `org-remove-file`: takes the open file out of the agenda files. */
export async function removeFile() {
  const key = openFileKey();
  if (!key) return setStatus('Current buffer does not visit a file');
  const files = agendaFileList();
  if (!files) return;
  const path = S.state.documentId;
  if (!files.includes(key)) return setStatus(`File was not in list: ${path} (not removed)`);
  await storeList(files.filter((f) => f !== key));
  setStatus(`Removed from Org Agenda list: ${path}`);
}

/** `org-cycle-agenda-files`: opens the agenda file after the open one, or the first when the open file is not one. */
export async function cycleAgendaFiles() {
  const files = agendaFileList();
  if (!files) return;
  if (!files.length) return setStatus('No agenda files');
  const key = openFileKey();
  const at = key ? files.indexOf(key) : -1;
  const next = at === -1 ? files[0] : (files[at + 1] ?? files[0]);
  const colon = next.indexOf(':');
  const scheme = next.slice(0, colon);
  await openRecentFile(next.slice(colon + 1), scheme === 'local' ? 'filesystem' : scheme);
}
