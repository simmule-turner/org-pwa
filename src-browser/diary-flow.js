// @ts-check
// Working with the diary file from the Agenda and from the Text view: opening an entry (the file opens in Text view with the entry
// selected), adding one at the end of the file, deleting one.
import { appendDiaryEntry, locateDiaryEntry } from '../src/diary-entry.js';
import { deleteLines, insertionBetween, lineRange } from '../src/text-edit.js';
import { filesystemAdapter, githubAdapter, webdavAdapter } from './adapters.js';
import { S } from './app-state.js';
import { openActionSheet } from './bottom-sheet.js';
import { confirmDialog } from './dialogs.js';
import { diarySpecs, parseDiarySpec } from './diary-file-load.js';
import { buildDiaryToolsRow, openAddEntrySheet } from './diary-sheets.js';
import { openRemotePath, saveCurrent } from './documents-io.js';
import { commitTextModeIfActive, setStatus } from './editing.js';
import { render } from './render.js';
import { switchToTab } from './tabs.js';
import { applyTextEdit, landInTextView, selectLines } from './text-view.js';
import { switchToView } from './views.js';

const ADAPTERS = /** @type {const} */ ({ github: [githubAdapter, 'GitHub'], webdav: [webdavAdapter, 'WebDAV'], local: [filesystemAdapter, 'Local'] });

/** @returns {HTMLTextAreaElement | null} */
function editor() {
  return /** @type {HTMLTextAreaElement | null} */ (document.getElementById('document-text-edit-input'));
}

/**
 * Brings the diary (file 0) or one of the files it includes up in a tab: the tab it is already in, else opened from where it is.
 * @param {number} fileIndex
 * @returns {Promise<boolean>}
 */
export async function openDiaryFileTab(fileIndex) {
  const spec = diarySpecs()[fileIndex];
  if (!spec) {
    setStatus('The diary has not been read yet.');
    return false;
  }
  const { scheme, kind, path } = parseDiarySpec(spec);
  if (S.state.doc && S.state.documentId === path && S.state.storageKind === kind) return true;
  const tab = S.documentSessions.find((/** @type {import('../src/types.js').TabSession} */ s) => s.state && s.state.documentId === path && s.state.storageKind === kind);
  if (tab) {
    if (commitTextModeIfActive()) render();
    switchToTab(tab.tabId);
    return true;
  }
  if (commitTextModeIfActive()) render();
  const [adapter, label] = ADAPTERS[/** @type {keyof typeof ADAPTERS} */ (scheme)] || ADAPTERS.github;
  await openRemotePath(path, kind, adapter, label);
  return !!S.state.doc && S.state.documentId === path && S.state.storageKind === kind;
}

/** Shows the Text view of the open file, selecting `landing` there.
 * @param {NonNullable<import('../src/types.js').AppState['textLanding']>} landing */
async function showInTextView(landing) {
  if (S.currentView === 'text' && landInTextView(landing)) return;
  S.textLanding = landing;
  if (S.currentView === 'text') render();
  else switchToView('text');
  S.textLanding = null;
}

/** Opens the diary entry a row came from, with the entry selected.
 * @param {import('../src/agenda.js').AgendaItem} item */
export async function openDiaryEntry(item) {
  const at = item.diaryAt;
  if (!at) return;
  if (!(await openDiaryFileTab(at.file))) return;
  await showInTextView({ startLine: at.startLine, endLine: at.endLine, lineText: at.lineText, source: 'Opened from the Agenda' });
}

/**
 * Adds a line at the end of the diary file (above a Local Variables block) and saves it.
 * @param {string} line
 */
export async function addDiaryLine(line) {
  if (!(await openDiaryFileTab(0))) return;
  if (S.currentView !== 'text') switchToView('text');
  const textarea = editor();
  if (!textarea) return;
  if (textarea.readOnly) {
    setStatus('The diary is read-only here (C-x C-q makes it writable).');
    return;
  }
  const result = appendDiaryEntry(textarea.value, line);
  const edit = insertionBetween(textarea.value, result.text);
  if (!edit) return;
  applyTextEdit(textarea, edit);
  selectLines(textarea, result.line, result.line);
  const saved = await saveCurrent();
  if (saved) setStatus(`Added to the diary and saved: ${line}`);
}

/** The sheet for a diary row in the Agenda.
 * @param {import('../src/agenda.js').AgendaItem} item */
export function openDiaryRowActions(item) {
  openActionSheet({
    title: 'Diary entry',
    subtitle: item.title,
    actions: [
      { label: 'Open entry', onClick: () => void openDiaryEntry(item) },
      { label: 'Add entry on this day', onClick: () => addEntryOn(item.date) },
      { label: 'Delete entry…', danger: true, onClick: () => void deleteDiaryEntry(item) },
    ],
  });
}

/** Opens the Add entry sheet for `date`. @param {Date} date */
export function addEntryOn(date) {
  const spec = diarySpecs()[0];
  const fileName = spec ? parseDiarySpec(spec).path.split('/').pop() || 'the diary' : 'the diary';
  openAddEntrySheet({ date, fileName, onAdd: (line) => void addDiaryLine(line) });
}

/** The diary tools above the Text view. @param {HTMLTextAreaElement} textarea */
export function diaryToolsRow(textarea) {
  return buildDiaryToolsRow(textarea, () => addEntryOn(new Date()));
}

/** Deletes the lines of a diary entry, after asking. @param {import('../src/agenda.js').AgendaItem} item */
async function deleteDiaryEntry(item) {
  const at = item.diaryAt;
  if (!at) return;
  const lines = at.startLine === at.endLine ? `line ${at.startLine}` : `lines ${at.startLine}–${at.endLine}`;
  if (!(await confirmDialog(`Delete ${lines} of the diary?\n\n${at.lineText}`, { confirmLabel: 'Delete' }))) return;
  if (!(await openDiaryFileTab(at.file))) return;
  if (S.currentView !== 'text') switchToView('text');
  const textarea = editor();
  if (!textarea) return;
  if (textarea.readOnly) {
    setStatus('The diary is read-only here (C-x C-q makes it writable).');
    return;
  }
  const found = locateDiaryEntry(textarea.value, at);
  if (!found) {
    setStatus('Could not find that entry in the file again — it may have changed. Nothing was deleted.');
    return;
  }
  const from = lineRange(textarea.value, found.startLine).start;
  applyTextEdit(textarea, deleteLines(textarea.value, from, lineRange(textarea.value, found.endLine).end));
  if (await saveCurrent()) setStatus('Deleted from the diary and saved.');
}
