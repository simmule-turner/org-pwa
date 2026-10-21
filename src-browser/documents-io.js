// @ts-check
/** @typedef {import('../src/types.js').Heading} Heading */
/** @typedef {import('../src/types.js').Doc} Doc */
/** @typedef {import('../src/types.js').TabSession} TabSession */
/** @typedef {import('../src/types.js').DiskAdapter} DiskAdapter */
/** @typedef {Extract<import('../src/link-resolve.js').LinkResolution, { type: 'file' }>} FileLinkResolution */
// Extracted from app.js: documents io.
import { forState } from './connection-vault.js';
import { UNSAVED_DOCUMENT_ID } from '../src/agenda.js';
import { findAncestorPath } from '../src/archive-model.js';
import { markDocumentClosed, markDocumentOpen, openDocument, saveAndSync } from '../src/document-store.js';
import { applyStartupVisibility } from '../src/fold-state.js';
import { mergeGlobalAndLocalVariables } from '../src/global-variables.js';
import { clearPersistedHistory, loadPersistedHistory } from '../src/history-store.js';
import { findHeadingById, findHeadingByTitle, resolveImagePath } from '../src/link-resolve.js';
import { getBufferReadOnly, getCycleOpenArchivedTrees, getUsePropertyInheritance, getUseTagInheritance, parseLocalVariables } from '../src/local-variables.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { isPlainTextFile } from '../src/plain-file.js';
import { searchDocument } from '../src/search.js';
import { resolveEffectiveStartupConfig } from '../src/startup-config.js';
import { createHistory, pushSnapshot } from '../src/undo-history.js';
import { filesystemAdapter, githubAdapter, inputFileAdapter, webdavAdapter } from './adapters.js';
import { syncAgendaFilesConfig, syncContactsFilesConfig } from './agenda-files.js';
import { diarySaved } from './diary-file-load.js';
import { rememberIds } from './id-locations.js';
import { prefetchSetupFiles } from './setupfile.js';
import { requestApptScan } from './appt-flow.js';
import { scheduleSync } from './mirror-sync.js';
import { emitExtensionEvent } from './extension-events.js';
import { S } from './app-state.js';
import { scrollContainer } from './chrome.js';
import { NAVIGATION_BACK_STACK_LIMIT } from './constants.js';
import { captureBtn, moreBtn, searchBtn, viewMenuBtn } from './dom.js';
import { commitTextModeIfActive, persistHistoryInBackground, setStatus } from './editing.js';
import { activeDiskAdapter, conflictResolverFor, diskAdapterFor, hideExternalChangeBanner, reloadCurrentDocumentFromDisk } from './external-sync.js';
import { closeFileMenu } from './file-menu.js';
import { isGithubConfigured } from './github-adapter.js';
import { pickAndImportFile } from './input-file-adapter.js';
import { navigateToHeading, syncNavBackButtonVisibility } from './navigation.js';
import { render } from './render.js';
import { renderSearchPanel } from './search-ui.js';
import { getGithubConfig, getWebdavConfig, recordRecentFile, setLastActiveDocument } from './settings.js';
import { kv } from './singletons.js';
import { ALWAYS_KEEP_MINE, replaceOnlyWhatWasSeen, resolvePendingChangeChoice } from './sync-helpers.js';
import { persistOpenTabsInBackground, renderTabBar, saveSessionSnapshot, switchToTab } from './tabs.js';
import { renderViewMenu } from './views.js';
import { isWebdavConfigured } from './webdav-adapter.js';
import { folderAvailable } from './local-folder.js';
import { platform } from './platform.js';
import { confirmDialog, promptText } from './dialogs.js';
import { ensureConnectionsUnlocked } from './connection-protection.js';

/** @param {string} fallback */
export function suggestedSaveAsName(fallback) {
  return S.state.documentId && S.state.documentId.startsWith(UNSAVED_DOCUMENT_ID) ? fallback : S.state.documentId || fallback;
}

/** Common finish-up after any successful open/create, regardless of which
 * @param {string} documentId
 * @param {Doc} doc
 * @param {string | null} [storageKind]
 *  backend it came from. */
export async function afterDocumentLoaded(documentId, doc, storageKind, resumedFromCache = false, { replaceCurrentTab = false } = {}) {
  if (!replaceCurrentTab) {
    const alreadyOpenTab = documentId && !documentId.startsWith(UNSAVED_DOCUMENT_ID) ? S.documentSessions.find((/** @type {TabSession} */ s) => s.state && s.state.documentId === documentId && s.state.storageKind === storageKind) : null;
    if (alreadyOpenTab && alreadyOpenTab.tabId !== S.activeTabId) {
      switchToTab(alreadyOpenTab.tabId);
      return;
    }
    if (S.activeTabId != null && !alreadyOpenTab) saveSessionSnapshot(S.activeTabId);
    if (!alreadyOpenTab) S.activeTabId = S.nextTabId++;
  }
  S.externalChangeDismissedHash = null;
  hideExternalChangeBanner();
  // A plain text file (a diary, notes.txt) is only text: no #+ keywords, no Local Variables, no SETUPFILE
  const plainText = isPlainTextFile(documentId, storageKind ?? null);
  if (!plainText) doc = await prefetchSetupFiles(doc, documentId, storageKind ?? null); // #+SETUPFILE: keywords, before anything reads them
  const rawLocalVars = plainText ? {} : parseLocalVariables(serializeOrg(doc));
  const startupConfig = resolveEffectiveStartupConfig(plainText ? parseOrg('') : doc, rawLocalVars, S.globalVariables);
  const localVariables = mergeGlobalAndLocalVariables(S.globalVariables, rawLocalVars);
  const archiveVisibility = getCycleOpenArchivedTrees(localVariables) ? 'noarchived' : 'archived';
  applyStartupVisibility(doc, startupConfig, archiveVisibility);
  S.state = { documentId, doc, startupConfig, storageKind: storageKind ?? null, localVariables };
  S.isBufferReadOnly = getBufferReadOnly(localVariables);
  if (!plainText) void rememberIds(doc, storageKind, documentId);
  syncAgendaFilesConfig();
  syncContactsFilesConfig();
  const openedText = serializeOrg(doc);
  const persistedHistory = documentId ? await loadPersistedHistory(kv, documentId) : null;
  if (persistedHistory && persistedHistory.entries[persistedHistory.entries.length - 1].text === openedText) {
    S.history = persistedHistory;
  } else {
    if (persistedHistory) await clearPersistedHistory(kv, documentId); // stale -- text changed since this app last saved history here
    S.history = createHistory(openedText, resumedFromCache ? 'Opened (resumed unsaved local version)' : 'Opened');
  }
  S.historyOpen = false;
  S.lastSavedText = resumedFromCache ? null : openedText;
  // A resumed local version is, by definition, different from whatever's
  // actually on disk/GitHub/WebDAV right now -- that's the whole reason it
  // was worth resuming instead of just discarding. isDirty reflects that
  // correctly here rather than starting false and getting corrected
  // separately by every caller after the fact, which is exactly what let
  // this go silently unexplained before: the filename would show modified
  // with nothing in the history log to say why, since the label above is
  // the only place that actually says what happened.
  S.isDirty = resumedFromCache;
  await setLastActiveDocument(kv, documentId, storageKind);
  await recordRecentFile(kv, documentId, storageKind);
  S.currentView = plainText ? 'text' : 'org';
  S.agendaAnchorDate = new Date();
  /** @type {HTMLButtonElement} */ (viewMenuBtn).disabled = false;
  /** @type {HTMLButtonElement} */ (searchBtn).disabled = false;
  /** @type {HTMLButtonElement} */ (captureBtn).disabled = false;
  /** @type {HTMLButtonElement} */ (moreBtn).disabled = false;
  S.searchOpen = false;
  S.searchQuery = '';
  renderSearchPanel();
  S.viewMenuOpen = false;
  renderViewMenu();
  S.settingsOpen = false;
  closeFileMenu();
  saveSessionSnapshot(S.activeTabId);
  render();
  renderTabBar();
  persistOpenTabsInBackground();
  emitExtensionEvent('open');
}

/** A buffer name no open buffer already has: `*scratch*`, then `*scratch*<2>`, `*scratch*<3>`, as Emacs does.
 * @param {string} base */
function uniqueBufferName(base) {
  const taken = new Set([S.state.documentId, ...S.documentSessions.map((/** @type {TabSession} */ x) => x.state && x.state.documentId)].filter(Boolean).map((id) => (id.includes('|') ? id.slice(id.indexOf('|') + 1) : '')));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}<${n}>`)) n++;
  return `${base}<${n}>`;
}

/** @param {string} rawText @param {string | null} statusMessage
 * @param {string} bufferName  what the buffer is called until it is saved ('' for *scratch*). It goes after a '|' in the id, so it survives a reload. */
export async function createNewUnsavedDocument(rawText = '', statusMessage = /** @type {string | null} */ (null), bufferName = '') {
  if (commitTextModeIfActive()) render();
  await afterDocumentLoaded(UNSAVED_DOCUMENT_ID + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '|' + uniqueBufferName(bufferName || '*scratch*'), parseOrg(rawText), null);
  // text made for the new buffer (an export, an import) exists nowhere else yet, so the buffer starts modified until it is saved
  if (rawText.trim() !== '') {
    S.isDirty = true;
    S.lastSavedText = null;
    renderTabBar();
  }
  setStatus(statusMessage || 'New unsaved document \u2014 edits are cached locally, same as any other document; Save As to keep it for good.');
  render();
}

export async function openFromFilesystem() {
  if (commitTextModeIfActive()) render();
  if (!platform.localFiles.supported()) {
    setStatus('This browser lacks File System Access support.');
    return;
  }
  try {
    const documentId = await platform.localFiles.pickOpen(kv);
    const { preferCache } = await resolvePendingChangeChoice(documentId);
    await markDocumentOpen(kv, documentId);
    setStatus('Opening\u2026');
    render();
    const { doc } = await openDocument({
      documentId,
      kvAdapter: kv,
      diskAdapter: filesystemAdapter,
      preferCache,
    });
    await afterDocumentLoaded(documentId, doc, 'filesystem', preferCache);
    if (preferCache) render();
    setStatus(preferCache ? 'Resumed your unsaved local version \u2014 remember to Save it.' : 'Opened.');
  } catch (err) {
    if (err.name !== 'AbortError') setStatus('Could not open file: ' + err.message);
  }
}

export async function openFromImport() {
  if (commitTextModeIfActive()) render();
  try {
    const { fileId } = await pickAndImportFile(kv, '*/*'); // any file: a diary or a notes.txt opens in the Text view
    const { preferCache } = await resolvePendingChangeChoice(fileId);
    await markDocumentOpen(kv, fileId);
    setStatus('Importing\u2026');
    render();
    const { doc } = await openDocument({
      documentId: fileId,
      kvAdapter: kv,
      diskAdapter: inputFileAdapter,
      preferCache,
    });
    await afterDocumentLoaded(fileId, doc, 'input', preferCache);
    if (preferCache) render();
    setStatus(
      preferCache
        ? 'Resumed your unsaved local version \u2014 remember to Save it.'
        : 'Imported. Use Save to download your changes \u2014 there\u2019s no live link back to the original file on this platform.'
    );
  } catch (err) {
    setStatus('Could not import file: ' + err.message);
  }
}

/** Opens `path` from a remote backend -- the shared logic behind both
 *  the file-browser UI (tapping a file) and the manual "type a path"
 *  fallback, so there's exactly one place that knows how to actually
 *  open a remote path once you have one, regardless of how it was
 *  chosen. `kind` is 'github' | 'webdav' (passed through to
 *  afterDocumentLoaded, same as before this existed as a shared
 *  function), `label` is the human-readable name used in status
 * @param {string} path
 * @param {string} kind
 * @param {DiskAdapter} diskAdapter
 * @param {string} label
 *  messages ("GitHub" / "WebDAV"). */
export async function openRemotePath(path, kind, diskAdapter, label) {
  try {
    const { preferCache } = await resolvePendingChangeChoice(path);
    setStatus(`Loading from ${label}\u2026`);
    await markDocumentOpen(kv, path);
    const { doc, source } = await openDocument({
      documentId: path,
      kvAdapter: kv,
      diskAdapter,
      preferCache,
    });
    await afterDocumentLoaded(path, doc, kind, preferCache);
    if (preferCache) render();
    setStatus(
      preferCache
        ? 'Resumed your unsaved local version \u2014 remember to Save it.'
        : source === 'new'
          ? `"${path}" doesn't exist yet \u2014 opened as a new empty file.`
          : `Opened from ${label}.`
    );
  } catch (err) {
    setStatus(`Could not open from ${label}: ` + err.message);
  }
}

/**
 * Handles tapping a file:/github:/webdav: link — resolves which
 * adapter to use (the explicit scheme if given, otherwise whichever
 * backend the CURRENT document itself already uses, same convention
 * resolveImagePath/resolveCaptureFileId both already apply), opens the
 * target document via openRemotePath — the exact same switching
 * mechanism File \u2192 Open already uses, including its own conflict
 * resolution for unsaved changes — then jumps to the in-file target if
 * one was specified: a headline search (`*Title`) via
 * findHeadingByTitle, or a plain text search via the same
 * searchDocument engine the Search panel itself uses, landing on the
 * first match.
 *
 * Local filesystem / iOS import: same picker-permission wall as
 * archiving/capture-to-file/images — can't open an arbitrary path
 * without a fresh picker gesture the browser requires per file, so
 * this shows a clear message rather than silently failing.
 * @param {FileLinkResolution} resolution
 * @param {Heading | null} [containingHeading]
 */
export async function openFileLink(resolution, containingHeading = null) {
  let adapter, kind, label;
  if (resolution.scheme === 'github') {
    adapter = githubAdapter;
    kind = 'github';
    label = 'GitHub';
  } else if (resolution.scheme === 'webdav') {
    adapter = webdavAdapter;
    kind = 'webdav';
    label = 'WebDAV';
  } else if (resolution.scheme === 'local') {
    adapter = filesystemAdapter; // a file opened here earlier, or in the org-pwa folder (see local-folder.js)
    kind = 'filesystem';
    label = 'Local';
  } else if (S.state.storageKind === 'filesystem' && folderAvailable()) {
    // a plain file: link in a local document: a file in the org-pwa folder
    adapter = filesystemAdapter;
    kind = 'filesystem';
    label = 'Local';
  } else {
    // 'file' scheme, no explicit backend named — use whichever backend
    // the CURRENT document itself came from.
    if (S.state.storageKind !== 'github' && S.state.storageKind !== 'webdav') {
      setStatus(
        `Can't open "${resolution.path}" automatically \u2014 local files need a file picker per file (browser security), which can't happen from a link tap. Use a github:/webdav: link explicitly, or open it via File \u2192 Open.`
      );
      return;
    }
    adapter = activeDiskAdapter();
    kind = S.state.storageKind;
    label = S.state.storageKind === 'github' ? 'GitHub' : 'WebDAV';
  }

  // Captured BEFORE the jump switches state.documentId away from it --
  // this is what lets the back button return here later, even though
  // opening the target document (a fresh parseOrg call) would
  // otherwise invalidate any heading-object-based state the way it
  // already does for every other navigationBackStack entry. The
  // heading's own outline path (an array of titles, not the object
  // itself) is what survives that re-parse -- see navigateBack's own
  // docs for why this matters more than it might seem: restoring a
  // raw scrollTop alone breaks the moment the target document's own
  // fold state differs from whatever it was when this was captured,
  // since applyStartupVisibility always re-applies the DEFAULT fold
  // state on every fresh open, not whatever the user had left it as.
  const originHeadingPath = containingHeading
    ? [...(findAncestorPath(S.state.doc, containingHeading) || []).map((/** @type {Heading} */ h) => h.title), containingHeading.title]
    : null;
  const originEntry = {
    view: S.currentView,
    documentId: S.state.documentId,
    storageKind: S.state.storageKind,
    scrollTop: scrollContainer().scrollTop,
    originHeadingPath,
  };

  const resolvedPath = resolveImagePath(resolution.path, S.state.documentId);
  await openRemotePath(resolvedPath, kind, adapter, label);

  // openRemotePath catches and reports its own errors via setStatus
  // rather than throwing — the only reliable way to tell whether it
  // actually succeeded is checking that state now points at the
  // target document, before doing anything else -- including pushing
  // the back-stack entry above: a failed jump never actually left the
  // origin document, so there's nothing to push a "return to" entry
  // for.
  if (!S.state.doc || S.state.documentId !== resolvedPath) return;

  S.navigationBackStack.push(originEntry);
  if (S.navigationBackStack.length > NAVIGATION_BACK_STACK_LIMIT) S.navigationBackStack.shift();
  syncNavBackButtonVisibility();

  if (resolution.byId) {
    // an [[id:...]] link that was found in this file: jump to the heading that has the ID
    const heading = findHeadingById(S.state.doc, resolution.byId);
    if (heading) navigateToHeading(heading, { pushToBackStack: false });
    else setStatus(`Opened ${resolvedPath}, but couldn't find ID ${resolution.byId} in it.`);
    return;
  }

  if (!resolution.inFileTarget) return;

  const target = resolution.inFileTarget;
  if (target.startsWith('*')) {
    const headingTitle = target.slice(1).trim();
    const heading = findHeadingByTitle(S.state.doc, headingTitle);
    if (heading) {
      navigateToHeading(heading, { pushToBackStack: false });
    } else {
      setStatus(`Opened ${resolvedPath}, but couldn't find the heading "${headingTitle}".`);
    }
    return;
  }

  const results = searchDocument(S.state.doc, target, {
    useTagInheritance: getUseTagInheritance(S.state.localVariables),
    usePropertyInheritance: getUsePropertyInheritance(S.state.localVariables),
  });
  if (results.length > 0) {
    navigateToHeading(results[0].heading, { revealOwnBody: results[0].type !== 'heading', targetNode: results[0].node, pushToBackStack: false });
  } else {
    setStatus(`Opened ${resolvedPath}, but couldn't find "${target}" in it.`);
  }
}

/** The tabs with a save under way. A second Save on the same tab waits for the answer to the first instead of racing it. */
const savesInFlight = /** @type {Set<number>} */ (new Set());

/** Records that `text` is now what the file holds, in whichever tab it was saved from -- that tab may no longer be the one on
 *  screen, and the person may have kept typing while the save ran: then it stays modified, against the text that was written.
 * @param {number} tabId @param {string} text */
function markTabSaved(tabId, text) {
  if (S.activeTabId === tabId) {
    S.lastSavedText = text;
    S.isDirty = serializeOrg(S.state.doc) !== text;
    render();
    return;
  }
  const session = S.documentSessions.find((/** @type {TabSession} */ x) => x.tabId === tabId);
  if (!session) return; // closed while it saved
  session.lastSavedText = text;
  session.isDirty = !session.state || !session.state.doc || serializeOrg(session.state.doc) !== text;
  renderTabBar();
}

/** Saves the tab on screen. See saveTab.
 * @returns {Promise<boolean>} */
export function saveCurrent() {
  return saveTab(S.activeTabId);
}

/** Saves one tab -- the one on screen or a background one, which is saved where it is, without being switched to. Everything
 *  follows that tab, not "the tab on screen": a slow save leaves the person free to switch tabs or keep typing.
 * @param {number | null} tabId
 * @returns {Promise<boolean>} whether the document was saved (false: nothing to save it to, cancelled at a conflict, or failed) */
export async function saveTab(tabId) {
  if (tabId === null) return false;
  if (tabId === S.activeTabId && commitTextModeIfActive()) render();
  const session = tabId === S.activeTabId ? null : S.documentSessions.find((/** @type {TabSession} */ x) => x.tabId === tabId);
  const state = tabId === S.activeTabId ? S.state : session && session.state;
  if (!state || !state.storageKind || !state.doc) return false;
  if (savesInFlight.has(tabId)) {
    setStatus('Already saving this buffer\u2026');
    return false;
  }
  savesInFlight.add(tabId);
  const { documentId, doc, storageKind } = state;
  setStatus('Saving\u2026');
  let saved = false;
  try {
    const writtenText = serializeOrg(doc);
    const result = await saveAndSync({
      documentId,
      doc,
      kvAdapter: kv,
      diskAdapter: diskAdapterFor(storageKind),
      resolveConflict: conflictResolverFor(documentId),
    });
    const stillOpen = () => S.activeTabId === tabId || S.documentSessions.some((/** @type {TabSession} */ x) => x.tabId === tabId);
    if (result.status === 'conflict' && result.resolution === 'cancelled') {
      // Nothing was written anywhere and the local edit is still pending.
      setStatus('Save cancelled \u2014 the other version is untouched and your edits are still here.');
      if (S.activeTabId === tabId) render();
      return false;
    }
    let savedText = writtenText;
    if (result.status === 'conflict' && (result.resolution === 'disk' || result.resolution === 'merged') && stillOpen()) {
      setStatus('Reloading\u2026');
      if (S.activeTabId !== tabId) switchToTab(tabId); // the reload works on the tab on screen
      render();
      await reloadCurrentDocumentFromDisk();
      if (result.resolution === 'merged') {
        // Recorded as its own history step so Undo can return to the
        // pre-merge text.
        S.history = pushSnapshot(S.history, serializeOrg(S.state.doc), 'Merged with changes from elsewhere');
        persistHistoryInBackground();
      }
      savedText = serializeOrg(S.state.doc);
    }
    markTabSaved(tabId, savedText);
    if (!isPlainTextFile(documentId, storageKind)) void rememberIds(tabId === S.activeTabId ? S.state.doc : doc, storageKind, documentId);
    diarySaved(documentId, storageKind);
    setStatus(result.resolution === 'merged' ? 'Saved \u2014 merged with the changes made elsewhere.' : 'Saved (' + result.status + ').');
    scheduleSync(); // the agenda, or the contacts, may have changed
    requestApptScan(); // and so may the appointments
    emitExtensionEvent('save');
    saved = true;
  } catch (err) {
    setStatus('Save failed: ' + /** @type {Error} */ (err).message);
  } finally {
    savesInFlight.delete(tabId);
    closeFileMenu();
  }
  return saved;
}

export async function saveAsFilesystem() {
  if (!S.state.doc) return;
  if (commitTextModeIfActive()) render();
  const saveAsTab = /** @type {number} */ (S.activeTabId);
  const saveAsText = serializeOrg(S.state.doc);
  if (!platform.localFiles.supported()) {
    setStatus('This browser lacks File System Access support.');
    return;
  }
  const previous = { documentId: S.state.documentId, storageKind: S.state.storageKind };
  let renamedTo = null;
  try {
    const documentId = await platform.localFiles.pickNew(kv, suggestedSaveAsName('untitled.org'));
    renamedTo = documentId;
    S.state.documentId = documentId;
    S.state.storageKind = 'filesystem';
    const seen = await readSeen(filesystemAdapter, documentId); // the picker has asked about replacing this file
    await markDocumentOpen(kv, documentId);
    setStatus('Saving\u2026');
    render();
    const result = await saveAndSync({
      documentId,
      doc: S.state.doc,
      kvAdapter: kv,
      diskAdapter: filesystemAdapter,
      resolveConflict: replaceOnlyWhatWasSeen(seen),
    });
    if (result.status === 'conflict' && result.resolution === 'cancelled') {
      undoSaveAsRename(previous, documentId);
      setStatus('Save As cancelled \u2014 the file there is untouched.');
      render();
      return;
    }
    markTabSaved(saveAsTab, saveAsText); // the tab that was saved, which a slow save may have left
    await recordRecentFile(kv, documentId, 'filesystem');
    setStatus('Saved as ' + documentId + '.');
    closeFileMenu();
    render();
  } catch (err) {
    if (renamedTo !== null && S.state.documentId === renamedTo) undoSaveAsRename(previous, renamedTo); // a write that threw leaves the buffer as it was
    if (err.name !== 'AbortError') setStatus('Save As failed: ' + err.message);
    render();
  }
}

/** Save As to a typed path that already holds a file: Emacs asks before replacing it, so this does too (the Save As screen asks for itself). A failure to look is not a
 *  reason to refuse -- the save itself then reports what is wrong.
 * @param {{ read: (id: string) => Promise<any> }} adapter @param {string} kind @param {string} path @param {string} where
 * @returns {Promise<{ ok: boolean, seen: string | null }>} */
async function confirmReplaceOnServer(adapter, kind, path, where) {
  if (S.state.storageKind === kind && S.state.documentId === path) return { ok: true, seen: await readSeen(adapter, path) }; // saving over itself is just Save
  const seen = await readSeen(adapter, path);
  if (seen === null) return { ok: true, seen };
  const ok = await confirmDialog(`"${path}" already exists ${where}. Replace it with this document?`, { confirmLabel: 'Replace', cancelLabel: 'Cancel', danger: true });
  return { ok, seen };
}

/** The text a Save As is about to replace, or null if nothing is there or it can't be read (the save itself then reports what is wrong).
 * @param {{ read: (id: string) => Promise<any> }} adapter @param {string} path
 * @returns {Promise<string | null>} */
async function readSeen(adapter, path) {
  try {
    const existing = await adapter.read(path);
    return existing && typeof existing.content === 'string' ? existing.content : null;
  } catch {
    return null;
  }
}

/** A Save As that failed leaves the buffer as it was, not renamed to a file that was never written.
 * @param {{ documentId: string, storageKind: string | null }} previous @param {string} path */
function undoSaveAsRename(previous, path) {
  S.state.documentId = previous.documentId;
  S.state.storageKind = previous.storageKind;
  if (path !== previous.documentId) markDocumentClosed(kv, path).catch(() => {});
}

/** @param {string} [chosenPath] the path from the Save As screen; asked for in a prompt when omitted
 * @param {string | null} [seenFromScreen] the text of the file that screen asked to replace (null: none) */
export async function saveAsGithub(chosenPath, seenFromScreen) {
  if (!S.state.doc) return;
  if (commitTextModeIfActive()) render();
  const saveAsTab = /** @type {number} */ (S.activeTabId);
  const saveAsText = serializeOrg(S.state.doc);
  if (!(await ensureConnectionsUnlocked())) {
    setStatus('The connections are locked \u2014 enter the passphrase to save to GitHub.');
    return;
  }
  const config = await getGithubConfig(kv);
  S.githubConfig = forState('github', config);
  if (!isGithubConfigured(config)) {
    setStatus('GitHub is not set up yet \u2014 open Settings first.');
    closeFileMenu();
    return;
  }
  const path = chosenPath || (await promptText(`Save to which path in ${config.owner}/${config.repo}?`, suggestedSaveAsName('notes.org'), { okLabel: 'Save' }));
  if (!path) return;
  const previous = { documentId: S.state.documentId, storageKind: S.state.storageKind };
  let written = false;
  try {
    // typed here: ask now. From the Save As screen: it has asked and passes the text it showed, or this reads the file now
    let seen = seenFromScreen;
    if (!chosenPath) {
      const confirmed = await confirmReplaceOnServer(githubAdapter, 'github', path, `in ${config.owner}/${config.repo}`);
      if (!confirmed.ok) return;
      seen = confirmed.seen;
    } else if (seen === undefined) seen = await readSeen(githubAdapter, path);
    S.state.documentId = path;
    S.state.storageKind = 'github';
    await markDocumentOpen(kv, path);
    setStatus('Saving\u2026');
    render();
    const result = await saveAndSync({
      documentId: path,
      doc: S.state.doc,
      kvAdapter: kv,
      diskAdapter: githubAdapter,
      resolveConflict: replaceOnlyWhatWasSeen(seen ?? null),
    });
    if (result.status === 'conflict' && result.resolution === 'cancelled') {
      undoSaveAsRename(previous, path);
      setStatus('Save As cancelled \u2014 the file there is untouched.');
      render();
      return;
    }
    written = true;
    markTabSaved(saveAsTab, saveAsText); // the tab that was saved, which a slow save may have left
    await recordRecentFile(kv, path, 'github');
    setStatus('Saved to GitHub as ' + path + '.');
    closeFileMenu();
    render();
  } catch (err) {
    if (!written) undoSaveAsRename(previous, path);
    setStatus('Save As failed: ' + err.message);
  }
}

/** @param {string} [chosenPath] the path from the Save As screen; asked for in a prompt when omitted
 * @param {string | null} [seenFromScreen] the text of the file that screen asked to replace (null: none) */
export async function saveAsWebdav(chosenPath, seenFromScreen) {
  if (!S.state.doc) return;
  if (commitTextModeIfActive()) render();
  const saveAsTab = /** @type {number} */ (S.activeTabId);
  const saveAsText = serializeOrg(S.state.doc);
  if (!(await ensureConnectionsUnlocked())) {
    setStatus('The connections are locked \u2014 enter the passphrase to save to WebDAV.');
    return;
  }
  const config = await getWebdavConfig(kv);
  S.webdavConfig = forState('webdav', config);
  if (!isWebdavConfigured(config)) {
    setStatus('WebDAV is not set up yet \u2014 open Settings first.');
    closeFileMenu();
    return;
  }
  const path = chosenPath || (await promptText('Save to which path on the WebDAV server?', suggestedSaveAsName('notes.org'), { okLabel: 'Save' }));
  if (!path) return;
  const previous = { documentId: S.state.documentId, storageKind: S.state.storageKind };
  let written = false;
  try {
    // typed here: ask now. From the Save As screen: it has asked and passes the text it showed, or this reads the file now
    let seen = seenFromScreen;
    if (!chosenPath) {
      const confirmed = await confirmReplaceOnServer(webdavAdapter, 'webdav', path, 'on the WebDAV server');
      if (!confirmed.ok) return;
      seen = confirmed.seen;
    } else if (seen === undefined) seen = await readSeen(webdavAdapter, path);
    S.state.documentId = path;
    S.state.storageKind = 'webdav';
    await markDocumentOpen(kv, path);
    setStatus('Saving\u2026');
    render();
    const result = await saveAndSync({
      documentId: path,
      doc: S.state.doc,
      kvAdapter: kv,
      diskAdapter: webdavAdapter,
      resolveConflict: replaceOnlyWhatWasSeen(seen ?? null),
    });
    if (result.status === 'conflict' && result.resolution === 'cancelled') {
      undoSaveAsRename(previous, path);
      setStatus('Save As cancelled \u2014 the file there is untouched.');
      render();
      return;
    }
    written = true;
    markTabSaved(saveAsTab, saveAsText); // the tab that was saved, which a slow save may have left
    await recordRecentFile(kv, path, 'webdav');
    setStatus('Saved to WebDAV as ' + path + '.');
    closeFileMenu();
    render();
  } catch (err) {
    if (!written) undoSaveAsRename(previous, path);
    setStatus('Save As failed: ' + err.message);
  }
}

/** @param {string} [chosenName] the name from the Save As screen; asked for in a prompt when omitted */
export async function saveAsImport(chosenName) {
  if (!S.state.doc) return;
  if (commitTextModeIfActive()) render();
  const saveAsTab = /** @type {number} */ (S.activeTabId);
  const saveAsText = serializeOrg(S.state.doc);
  const name = chosenName || (await promptText('File name to save as:', suggestedSaveAsName('untitled.org'), { okLabel: 'Save' }));
  if (!name) return;
  S.state.documentId = name;
  S.state.storageKind = 'input';
  try {
    await markDocumentOpen(kv, name);
    setStatus('Saving\u2026');
    render();
    await saveAndSync({
      documentId: name,
      doc: S.state.doc,
      kvAdapter: kv,
      diskAdapter: inputFileAdapter,
      resolveConflict: ALWAYS_KEEP_MINE,
    });
    markTabSaved(saveAsTab, saveAsText); // the tab that was saved, which a slow save may have left
    await recordRecentFile(kv, name, 'input');
    setStatus('Downloaded as ' + name + '.');
    closeFileMenu();
    render();
  } catch (err) {
    setStatus('Save As failed: ' + err.message);
  }
}
