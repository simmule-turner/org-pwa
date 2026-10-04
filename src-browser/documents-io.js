// Extracted from app.js: documents io.
import { UNSAVED_DOCUMENT_ID } from '../src/agenda.js';
import { findAncestorPath } from '../src/archive-model.js';
import { markDocumentOpen, openDocument, saveAndSync } from '../src/document-store.js';
import { applyStartupVisibility } from '../src/fold-state.js';
import { mergeGlobalAndLocalVariables } from '../src/global-variables.js';
import { clearPersistedHistory, loadPersistedHistory } from '../src/history-store.js';
import { findHeadingByTitle, resolveImagePath } from '../src/link-resolve.js';
import { getBufferReadOnly, getCycleOpenArchivedTrees, getUsePropertyInheritance, getUseTagInheritance, parseLocalVariables } from '../src/local-variables.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { searchDocument } from '../src/search.js';
import { resolveEffectiveStartupConfig } from '../src/startup-config.js';
import { createHistory, pushSnapshot } from '../src/undo-history.js';
import { filesystemAdapter, githubAdapter, inputFileAdapter, webdavAdapter } from './adapters.js';
import { syncAgendaFilesConfig, syncContactsFilesConfig } from './agenda-files.js';
import { scheduleCalendarSync } from './calendar-sync.js';
import { S } from './app-state.js';
import { scrollContainer } from './chrome.js';
import { NAVIGATION_BACK_STACK_LIMIT } from './constants.js';
import { captureBtn, moreBtn, searchBtn, viewMenuBtn } from './dom.js';
import { commitTextModeIfActive, persistHistoryInBackground, setStatus } from './editing.js';
import { activeDiskAdapter, hideExternalChangeBanner, reloadCurrentDocumentFromDisk, resolveSaveConflict } from './external-sync.js';
import { closeFileMenu, renderFileMenu } from './file-menu.js';
import { isGithubConfigured } from './github-adapter.js';
import { pickAndImportFile } from './input-file-adapter.js';
import { navigateToHeading, syncNavBackButtonVisibility } from './navigation.js';
import { render } from './render.js';
import { renderSearchPanel } from './search-ui.js';
import { getGithubConfig, getWebdavConfig, recordRecentFile, setLastActiveDocument } from './settings.js';
import { kv } from './singletons.js';
import { ALWAYS_KEEP_MINE, resolvePendingChangeChoice } from './sync-helpers.js';
import { persistOpenTabsInBackground, renderTabBar, saveSessionSnapshot, switchToTab } from './tabs.js';
import { renderViewMenu } from './views.js';
import { isWebdavConfigured } from './webdav-adapter.js';
import { folderAvailable } from './local-folder.js';
import { platform } from './platform.js';

export function suggestedSaveAsName(fallback) {
  return S.state.documentId && S.state.documentId.startsWith(UNSAVED_DOCUMENT_ID) ? fallback : S.state.documentId || fallback;
}

/** Common finish-up after any successful open/create, regardless of which
 *  backend it came from. */
export async function afterDocumentLoaded(documentId, doc, storageKind, resumedFromCache = false, { replaceCurrentTab = false } = {}) {
  if (!replaceCurrentTab) {
    const alreadyOpenTab = documentId && !documentId.startsWith(UNSAVED_DOCUMENT_ID) ? S.documentSessions.find((s) => s.state && s.state.documentId === documentId && s.state.storageKind === storageKind) : null;
    if (alreadyOpenTab && alreadyOpenTab.tabId !== S.activeTabId) {
      switchToTab(alreadyOpenTab.tabId);
      return;
    }
    if (S.activeTabId != null && !alreadyOpenTab) saveSessionSnapshot(S.activeTabId);
    if (!alreadyOpenTab) S.activeTabId = S.nextTabId++;
  }
  S.externalChangeDismissedHash = null;
  hideExternalChangeBanner();
  const rawLocalVars = parseLocalVariables(serializeOrg(doc));
  const startupConfig = resolveEffectiveStartupConfig(doc, rawLocalVars, S.globalVariables);
  const localVariables = mergeGlobalAndLocalVariables(S.globalVariables, rawLocalVars);
  const archiveVisibility = getCycleOpenArchivedTrees(localVariables) ? 'noarchived' : 'archived';
  applyStartupVisibility(doc, startupConfig, archiveVisibility);
  S.state = { documentId, doc, startupConfig, storageKind, localVariables };
  S.isBufferReadOnly = getBufferReadOnly(localVariables);
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
  S.currentView = 'org';
  S.agendaAnchorDate = new Date();
  viewMenuBtn.disabled = false;
  searchBtn.disabled = false;
  captureBtn.disabled = false;
  moreBtn.disabled = false;
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
}

export async function createNewUnsavedDocument(rawText = '', statusMessage = null) {
  if (commitTextModeIfActive()) render();
  await afterDocumentLoaded(UNSAVED_DOCUMENT_ID + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), parseOrg(rawText), null);
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
    const { fileId } = await pickAndImportFile(kv);
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
    ? [...(findAncestorPath(S.state.doc, containingHeading) || []).map((h) => h.title), containingHeading.title]
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

/** Sets up and shows the navigable file browser for `backend`
 *  ('github' | 'webdav') at the configured root, then kicks off the
 *  first listing load. This is what File \u2192 Open \u2192 GitHub/WebDAV
 *  actually does now -- see openGithubByPrompt/openWebdavByPrompt
 *  below for the manual-entry fallback this replaces as the default
 *  path, still reachable from within the browser UI itself. */
export function startBrowsing(backend) {
  S.browseBackend = backend;
  S.browsePath = '';
  S.browseEntries = null;
  S.browseError = null;
  renderFileMenu();
  loadBrowseEntries();
}

/** Fetches the listing for the current browsePath from whichever
 *  adapter browseBackend points at, updating browseEntries/browseError
 *  and re-rendering when done. Split out from startBrowsing so
 *  navigating into a folder (which doesn't reset browsePath to root)
 *  can call just this part again. */
export async function loadBrowseEntries() {
  const adapter = S.browseBackend === 'github' ? githubAdapter : webdavAdapter;
  const requestedPath = S.browsePath; // captured now -- if the user navigates again before this resolves, a stale response must not overwrite the newer one
  S.browseEntries = null;
  S.browseError = null;
  renderFileMenu();
  try {
    const entries = await adapter.list(requestedPath);
    if (requestedPath !== S.browsePath || !S.browseBackend) return; // superseded by a newer navigation, or the browser was closed while this was in flight
    S.browseEntries = entries;
  } catch (err) {
    if (requestedPath !== S.browsePath || !S.browseBackend) return;
    S.browseError = err.message;
  }
  renderFileMenu();
}

export async function openGithubByPrompt() {
  if (commitTextModeIfActive()) render();
  const config = await getGithubConfig(kv);
  S.githubConfig = config;
  const path = window.prompt(`Path of the file in ${config.owner}/${config.repo} (e.g. notes.org):`);
  if (!path) return;
  await openRemotePath(path, 'github', githubAdapter, 'GitHub');
}

export async function openFromGithub() {
  if (commitTextModeIfActive()) render();
  const config = await getGithubConfig(kv);
  S.githubConfig = config;
  if (!isGithubConfigured(config)) {
    setStatus('GitHub is not set up yet \u2014 open Settings first.');
    closeFileMenu();
    return;
  }
  startBrowsing('github');
}

export async function openWebdavByPrompt() {
  if (commitTextModeIfActive()) render();
  const config = await getWebdavConfig(kv);
  S.webdavConfig = config;
  const path = window.prompt('Path of the file on the WebDAV server (e.g. notes.org):');
  if (!path) return;
  await openRemotePath(path, 'webdav', webdavAdapter, 'WebDAV');
}

export async function openFromWebdav() {
  if (commitTextModeIfActive()) render();
  const config = await getWebdavConfig(kv);
  S.webdavConfig = config;
  if (!isWebdavConfigured(config)) {
    setStatus('WebDAV is not set up yet \u2014 open Settings first.');
    closeFileMenu();
    return;
  }
  startBrowsing('webdav');
}

export async function saveCurrent() {
  if (!S.state.storageKind) return;
  if (commitTextModeIfActive()) render();
  setStatus('Saving\u2026');
  try {
    const result = await saveAndSync({
      documentId: S.state.documentId,
      doc: S.state.doc,
      kvAdapter: kv,
      diskAdapter: activeDiskAdapter(),
      resolveConflict: resolveSaveConflict,
    });
    if (result.status === 'conflict' && result.resolution === 'cancelled') {
      // Nothing was written anywhere and the local edit is still pending.
      setStatus('Save cancelled \u2014 the other version is untouched and your edits are still here.');
      render();
      closeFileMenu();
      return;
    }
    if (result.status === 'conflict' && (result.resolution === 'disk' || result.resolution === 'merged')) {
      setStatus('Reloading\u2026');
      render();
      await reloadCurrentDocumentFromDisk();
      if (result.resolution === 'merged') {
        // Recorded as its own history step so Undo can return to the
        // pre-merge text.
        S.history = pushSnapshot(S.history, serializeOrg(S.state.doc), 'Merged with changes from elsewhere');
        persistHistoryInBackground();
      }
    }
    S.isDirty = false;
    S.lastSavedText = serializeOrg(S.state.doc);
    render();
    setStatus(result.resolution === 'merged' ? 'Saved \u2014 merged with the changes made elsewhere.' : 'Saved (' + result.status + ').');
    scheduleCalendarSync(); // the agenda may have changed
  } catch (err) {
    setStatus('Save failed: ' + err.message);
  }
  closeFileMenu();
}

export async function saveAsFilesystem() {
  if (!S.state.doc) return;
  if (commitTextModeIfActive()) render();
  if (!platform.localFiles.supported()) {
    setStatus('This browser lacks File System Access support.');
    return;
  }
  try {
    const documentId = await platform.localFiles.pickNew(kv, suggestedSaveAsName('untitled.org'));
    S.state.documentId = documentId;
    S.state.storageKind = 'filesystem';
    await markDocumentOpen(kv, documentId);
    setStatus('Saving\u2026');
    render();
    await saveAndSync({
      documentId,
      doc: S.state.doc,
      kvAdapter: kv,
      diskAdapter: filesystemAdapter,
      resolveConflict: ALWAYS_KEEP_MINE,
    });
    S.isDirty = false;
    S.lastSavedText = serializeOrg(S.state.doc);
    await recordRecentFile(kv, documentId, 'filesystem');
    setStatus('Saved as ' + documentId + '.');
    closeFileMenu();
    render();
  } catch (err) {
    if (err.name !== 'AbortError') setStatus('Save As failed: ' + err.message);
  }
}

export async function saveAsGithub() {
  if (!S.state.doc) return;
  if (commitTextModeIfActive()) render();
  const config = await getGithubConfig(kv);
  S.githubConfig = config;
  if (!isGithubConfigured(config)) {
    setStatus('GitHub is not set up yet \u2014 open Settings first.');
    closeFileMenu();
    return;
  }
  const path = window.prompt(
    `Save to which path in ${config.owner}/${config.repo}?`,
    suggestedSaveAsName('notes.org')
  );
  if (!path) return;
  try {
    S.state.documentId = path;
    S.state.storageKind = 'github';
    await markDocumentOpen(kv, path);
    setStatus('Saving\u2026');
    render();
    await saveAndSync({
      documentId: path,
      doc: S.state.doc,
      kvAdapter: kv,
      diskAdapter: githubAdapter,
      resolveConflict: ALWAYS_KEEP_MINE,
    });
    S.isDirty = false;
    S.lastSavedText = serializeOrg(S.state.doc);
    await recordRecentFile(kv, path, 'github');
    setStatus('Saved to GitHub as ' + path + '.');
    closeFileMenu();
    render();
  } catch (err) {
    setStatus('Save As failed: ' + err.message);
  }
}

export async function saveAsWebdav() {
  if (!S.state.doc) return;
  if (commitTextModeIfActive()) render();
  const config = await getWebdavConfig(kv);
  S.webdavConfig = config;
  if (!isWebdavConfigured(config)) {
    setStatus('WebDAV is not set up yet \u2014 open Settings first.');
    closeFileMenu();
    return;
  }
  const path = window.prompt('Save to which path on the WebDAV server?', suggestedSaveAsName('notes.org'));
  if (!path) return;
  try {
    S.state.documentId = path;
    S.state.storageKind = 'webdav';
    await markDocumentOpen(kv, path);
    setStatus('Saving\u2026');
    render();
    await saveAndSync({
      documentId: path,
      doc: S.state.doc,
      kvAdapter: kv,
      diskAdapter: webdavAdapter,
      resolveConflict: ALWAYS_KEEP_MINE,
    });
    S.isDirty = false;
    S.lastSavedText = serializeOrg(S.state.doc);
    await recordRecentFile(kv, path, 'webdav');
    setStatus('Saved to WebDAV as ' + path + '.');
    closeFileMenu();
    render();
  } catch (err) {
    setStatus('Save As failed: ' + err.message);
  }
}

export async function saveAsImport() {
  if (!S.state.doc) return;
  if (commitTextModeIfActive()) render();
  const name = window.prompt('File name to save as:', suggestedSaveAsName('untitled.org'));
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
    S.isDirty = false;
    S.lastSavedText = serializeOrg(S.state.doc);
    await recordRecentFile(kv, name, 'input');
    setStatus('Downloaded as ' + name + '.');
    closeFileMenu();
    render();
  } catch (err) {
    setStatus('Save As failed: ' + err.message);
  }
}
