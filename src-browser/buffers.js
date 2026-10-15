// @ts-check
/** @typedef {import('../src/types.js').Doc} Doc */
// Buffers, the Emacs way: Capture, Refile and Archive into another file edit that file's buffer (its tab), never the file
// behind the person's back. A file with no tab yet is loaded into a background tab first, as find-file-noselect does. The
// tab shows the modified mark until it is saved, and Save Some Buffers (C-x s) saves every modified one. Revert Buffer
// throws a buffer's changes away and reads the file again.
import { markDocumentOpen, saveDocument } from '../src/document-store.js';
import { applyStartupVisibility } from '../src/fold-state.js';
import { mergeGlobalAndLocalVariables } from '../src/global-variables.js';
import { savePersistedHistory } from '../src/history-store.js';
import { getBufferReadOnly, getCycleOpenArchivedTrees, parseLocalVariables } from '../src/local-variables.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { clearPendingChange, hasPendingChange } from '../src/outbox.js';
import { resolveEffectiveStartupConfig } from '../src/startup-config.js';
import { setSyncMeta } from '../src/sync-engine.js';
import { createHistory, pushSnapshot } from '../src/undo-history.js';
import { S } from './app-state.js';
import { confirmDialog } from './dialogs.js';
import { saveCurrent } from './documents-io.js';
import { commitAndRender, commitTextModeIfActive, persistHistoryInBackground, setStatus } from './editing.js';
import { activeDiskAdapter, reloadCurrentDocumentFromDisk } from './external-sync.js';
import { closeFileMenu } from './file-menu.js';
import { folderAvailable } from './local-folder.js';
import { render } from './render.js';
import { kv } from './singletons.js';
import { documentDisplayLabel } from './sync-helpers.js';
import { persistOpenTabsInBackground, renderTabBar, switchToTab } from './tabs.js';

/** What a status message says after an edit that left a buffer modified, not the file. */
export const UNSAVED_NOTE = ' — not saved yet';

/** The tab, other than the one on screen, that has `fileId` open on the current document's backend.
 * @param {string} fileId */
function findBackgroundSession(fileId) {
  const kind = S.state.storageKind;
  return S.documentSessions.find((/** @type {Record<string, any>} */ s) => s.tabId !== S.activeTabId && s.state && s.state.documentId === fileId && s.state.storageKind === kind) || null;
}

/**
 * Shared "edit another file" sequence for every cross-file operation (capture, archive, refile, restore): the edit goes to
 * that file's buffer and nothing is written to the file itself. The buffer is
 *   - the tab on screen, if the file is the open document (the callers handle that case themselves, but it is covered);
 *   - the file's own tab, if it is open in another tab: the entry is added to the text that tab holds, so unsaved changes
 *     there are kept and a later save sees any outside change as a conflict, as for any other edit;
 *   - otherwise a new background tab, loaded from the file. Nothing is changed, and no tab is added, if the edit is aborted.
 * The buffer is cached on the device at once, like every edit, so it survives a reload. Saving it (Save, or Save Some
 * Buffers) is what writes the file.
 *
 * `label` -- used in every generated status/error message, lowercase, describing the action a person would recognize
 * ("archive", "refile", "restore", "capture"). `historyLabel` -- the step's name in the buffer's undo history.
 * `allowMissing` -- if true, a target file that doesn't exist yet starts from an empty document rather than being treated as
 * an error (capture/archive: a fresh target file is normal; refile/restore: the target is expected to exist).
 * `mutate(doc)` -- feature-specific change to the target's document. Return `undefined`/`null` to abort (after calling
 * setStatus itself with a feature-specific message); anything else is passed through as this function's own `result`.
 *
 * Returns `{ ok: true, result }` once the buffer holds the change, or `{ ok: false }` after already calling setStatus with a
 * clear, label-specific error -- callers just check `.ok` and bail out if false.
 * @param {string} fileId
 * @param {{ label: string, historyLabel?: string, allowMissing?: boolean, mutate: (doc: Doc) => unknown }} options
 * @returns {Promise<{ ok: boolean, result?: any }>}
 */
export async function writeToOtherFile(fileId, options) {
  if (fileId === S.state.documentId) return editActiveBuffer(fileId, options);
  const open = findBackgroundSession(fileId);
  if (open) return editOpenBuffer(open, fileId, options);
  return editNewBuffer(fileId, options);
}

/** @param {string} fileId @param {string} label */
function readOnlyRefusal(fileId, label) {
  setStatus(`Can't ${label} to "${fileId}" — that buffer is read-only (C-x C-q makes it writable).`);
  return { ok: false };
}

/** @param {string} fileId @param {{ label: string, historyLabel?: string, mutate: (doc: Doc) => unknown }} options */
function editActiveBuffer(fileId, { label, historyLabel, mutate }) {
  if (S.isBufferReadOnly) return readOnlyRefusal(fileId, label);
  const result = mutate(S.state.doc);
  if (result === undefined || result === null) return { ok: false };
  commitAndRender(historyLabel || label);
  return { ok: true, result };
}

/** @param {Record<string, any>} session @param {string} fileId @param {{ label: string, historyLabel?: string, mutate: (doc: Doc) => unknown }} options */
async function editOpenBuffer(session, fileId, { label, historyLabel, mutate }) {
  if (session.isBufferReadOnly) return readOnlyRefusal(fileId, label);
  const doc = session.state.doc;
  const result = mutate(doc);
  if (result === undefined || result === null) return { ok: false };
  const history = pushSnapshot(session.history, serializeOrg(doc), historyLabel || label);
  if (history === session.history) return { ok: true, result }; // the edit changed nothing
  session.history = history;
  session.isDirty = true;
  try {
    await saveDocument({ documentId: fileId, doc, kvAdapter: kv }); // cache the change on this device, like any edit
  } catch (err) {
    setStatus(`"${fileId}" was changed, but caching it on this device failed — ${err.message}. Save it soon.`);
  }
  savePersistedHistory(kv, fileId, history).catch((/** @type {Error} */ err) => console.error('Failed to persist undo history:', err));
  renderTabBar();
  return { ok: true, result };
}

/** @param {string} fileId @param {{ label: string, historyLabel?: string, allowMissing?: boolean, mutate: (doc: Doc) => unknown }} options
 * @returns {Promise<{ ok: boolean, result?: any }>} */
async function editNewBuffer(fileId, options) {
  const { label, historyLabel, allowMissing, mutate } = options;
  // An earlier session's unsaved change for this file (never synced) belongs to the buffer that file would open with;
  // loading it fresh from disk here would shadow that change. Refuse and let the person open the file and decide.
  if (await hasPendingChange(kv, fileId)) {
    setStatus(
      `Can't ${label} to "${fileId}" right now — it has unsaved local changes from an earlier session that haven't been synced yet. Open "${fileId}" directly first and either save or discard those changes, then retry.`
    );
    return { ok: false };
  }

  const adapter = activeDiskAdapter();
  // a local file must exist already (a picker makes it); but with an org-pwa folder a missing one is created there, as on GitHub
  const creatable = allowMissing && S.state.storageKind === 'filesystem' && folderAvailable();
  if ((S.state.storageKind === 'filesystem' || S.state.storageKind === 'input') && !creatable && !(await adapter.exists(fileId))) {
    setStatus(
      `Can't ${label} to "${fileId}" automatically — local files need that file picked/created once first (browser security requires a file picker per file, not something this can do on its own). Try File → Open or Save As on "${fileId}" first, or use GitHub/WebDAV for automatic cross-file ${label}ing.`
    );
    return { ok: false };
  }

  /** @type {{ content: string, hash: string } | null} */
  let existing;
  /** @type {Doc} */
  let doc;
  try {
    existing = await adapter.read(fileId);
    if (!existing && !allowMissing) {
      setStatus(`Could not ${label}: "${fileId}" no longer exists.`);
      return { ok: false };
    }
    doc = parseOrg(existing ? existing.content : '');
  } catch (err) {
    setStatus(`Could not ${label}: reading "${fileId}" failed — ${err.message}`);
    return { ok: false };
  }

  // Opened in the meantime (the read is a network round trip): edit that buffer, not a second copy of the file.
  if (fileId === S.state.documentId) return editActiveBuffer(fileId, options);
  const openNow = findBackgroundSession(fileId);
  if (openNow) return editOpenBuffer(openNow, fileId, options);

  // Set up like any opened file: the file's own settings apply to it (startup folding, a read-only buffer).
  const rawLocalVars = parseLocalVariables(serializeOrg(doc));
  const startupConfig = resolveEffectiveStartupConfig(doc, rawLocalVars, S.globalVariables);
  const localVariables = mergeGlobalAndLocalVariables(S.globalVariables, rawLocalVars);
  const readOnly = getBufferReadOnly(localVariables);
  if (readOnly) return readOnlyRefusal(fileId, label);
  applyStartupVisibility(doc, startupConfig, getCycleOpenArchivedTrees(localVariables) ? 'noarchived' : 'archived');
  const openedText = serializeOrg(doc);

  const result = mutate(doc);
  if (result === undefined || result === null) return { ok: false };

  const history = pushSnapshot(createHistory(openedText, 'Opened'), serializeOrg(doc), historyLabel || label);
  try {
    // what opening the file would have recorded: the cached copy, and the version the next save is checked against
    if (existing) {
      await kv.set('doc:' + fileId, existing.content);
      await setSyncMeta(kv, fileId, { lastSyncedHash: existing.hash, baseContent: existing.content });
    }
    await saveDocument({ documentId: fileId, doc, kvAdapter: kv });
  } catch (err) {
    setStatus(`Could not ${label}: caching "${fileId}" on this device failed — ${err.message}. Nothing was changed.`);
    return { ok: false };
  }

  /** @type {Record<string, any>} */
  const session = {
    tabId: S.nextTabId++,
    scrollTop: 0,
    state: { documentId: fileId, doc, startupConfig, storageKind: S.state.storageKind, localVariables },
    editingHeading: null,
    editingIsNew: false,
    editingCell: null,
    editingParagraph: null,
    editingListItem: null,
    editingHeadingText: null,
    editingGeneral: null,
    actionMenuFor: null,
    keyboardFocusedHeading: null,
    keyboardFocusedBodyRow: null,
    keyboardFocusedCellPos: null,
    pendingCursorPosition: null,
    currentContextHeading: null,
    narrowedHeading: null,
    narrowedTextModeRange: null,
    navigationBackStack: [],
    currentView: 'org',
    isDirty: true,
    isBufferReadOnly: readOnly,
    lastSavedText: openedText,
    history,
    historyOpen: false,
    historyDiffExpandedIndex: null,
    lastGlobalFoldState: 'showeverything',
    externalChangeDismissedHash: null,
    externalChangeShownForHash: null,
    activeQueryReplace: null,
  };
  S.documentSessions.push(session);
  savePersistedHistory(kv, fileId, history).catch((/** @type {Error} */ err) => console.error('Failed to persist undo history:', err));
  markDocumentOpen(kv, fileId).catch((/** @type {Error} */ err) => console.error('Failed to register the open file:', err));
  renderTabBar();
  persistOpenTabsInBackground();
  return { ok: true, result };
}

/** The tabs whose file has unsaved changes -- the ones Save Some Buffers would save. A buffer with no file yet (*scratch*) is
 *  not one: it needs Save As, which is a choice only the person can make.
 * @returns {number[]} tab ids, in tab order */
export function modifiedFileBuffers() {
  const ids = [];
  for (const session of S.documentSessions) {
    const active = session.tabId === S.activeTabId;
    const state = active ? S.state : session.state;
    if ((active ? S.isDirty : session.isDirty) && state && state.storageKind) ids.push(session.tabId);
  }
  return ids;
}

/** save-some-buffers (C-x s): saves every modified buffer that has a file, each through the same Save as the File menu's, so
 *  an outside change to one is a conflict to settle, not an overwrite. Leaves the person on the tab they started on. */
export async function saveSomeBuffers() {
  closeFileMenu();
  if (commitTextModeIfActive()) render();
  const home = S.activeTabId;
  const ids = modifiedFileBuffers();
  if (ids.length === 0) {
    setStatus('(No files need saving)');
    return;
  }
  let saved = 0;
  for (const tabId of ids) {
    if (tabId !== S.activeTabId) switchToTab(tabId);
    if (await saveCurrent()) saved++;
  }
  if (S.activeTabId !== home && S.documentSessions.some((/** @type {Record<string, any>} */ s) => s.tabId === home)) switchToTab(home);
  const left = ids.length - saved;
  setStatus(`Saved ${saved} ${saved === 1 ? 'file' : 'files'}${left ? `; ${left} not saved — still marked ●` : ''}.`);
}

/** revert-buffer: throws the open buffer's changes away and reads its file again. Asks first when there are changes; Undo
 *  brings them back, as it does after Emacs's. */
export async function revertBuffer() {
  if (!S.state.doc || !S.state.storageKind) return;
  if (commitTextModeIfActive()) render();
  const documentId = S.state.documentId;
  const label = documentDisplayLabel(documentId, S.state.doc);
  if (S.isDirty) {
    const proceed = await confirmDialog(`Revert "${label}" from its file? Its unsaved changes are discarded (Undo brings them back).`, { confirmLabel: 'Revert', cancelLabel: 'Cancel', danger: true });
    if (!proceed) return;
  }
  setStatus('Reverting…');
  try {
    // openDocument falls back to the cached copy -- the very changes being discarded -- when the file is gone
    if (!(await activeDiskAdapter().read(documentId))) {
      setStatus(`Can't revert — "${label}" is no longer there. Save keeps what you have.`);
      return;
    }
    await reloadCurrentDocumentFromDisk();
    await clearPendingChange(kv, documentId);
    S.history = pushSnapshot(S.history, S.lastSavedText, 'Reverted from file');
    persistHistoryInBackground();
    renderTabBar();
    setStatus(`Reverted "${label}" from its file.`);
  } catch (err) {
    setStatus('Revert failed: ' + err.message);
  }
}
