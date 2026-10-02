// Extracted from app.js: agenda files.
import { findDuplicateAgendaFiles, getAgendaFilesVar, getContactsFilesVar, parseAgendaFilesVar } from '../src/local-variables.js';
import { parseOrg } from '../src/org-parser.js';
import { filesystemAdapter, githubAdapter, webdavAdapter } from './adapters.js';
import { S } from './app-state.js';
import { render } from './render.js';
import { renderSearchPanel } from './search-ui.js';
import { renderSettingsView } from './settings-view.js';
import { agendaFilesCache, contactsFilesCache } from './singletons.js';

/** Recomputes agendaFilesConfig from whichever variable set is
 *  actually authoritative right now: state.localVariables (already
 *  the correctly-merged global+file-local set -- see
 *  mergeGlobalAndLocalVariables's own docs) when a document is open,
 *  since real org itself does honor a file's own #+STARTUP:-adjacent
 *  "# Local Variables:" override for org-agenda-files when the
 *  agenda command runs from within that specific buffer (confirmed
 *  directly against real Emacs org-mode) -- the closest real-org
 *  analogy to this app's own always-current-document Agenda view.
 *  Falls back to globalVariables directly when no document is open at
 *  all (there's no state.localVariables to merge yet).
 *
 *  THE FIX: every call site here used to read globalVariables['org-
 *  agenda-files'] directly, so a file-local override was silently
 *  ignored entirely -- an org-agenda-files line inside a document's
 *  own "# Local Variables:" block never took effect, even though the
 *  identical value pasted into Settings' own Global Variables worked
 *  immediately. Call this any time state.localVariables changes for
 *  any reason: opening a different document, undo/redo, committing
 *  from Text view, or a Settings change to the global value while a
 *  document is open.
 *
 *  THE FIX (per direct follow-up): also kicks off the actual cache
 *  warm-up immediately, rather than leaving that to whichever of
 *  Agenda/TODO/Search happens to render first -- confirmed directly
 *  that opening a document with a real, correctly-parsing org-
 *  agenda-files setting did NOT, on its own, cache anything at all;
 *  the fetch only ever started once one of those views actually ran.
 *  ensureAgendaFilesLoaded is already idempotent (already-cached or
 *  in-flight entries are skipped), so calling it here on every one of
 *  this function's own call sites is safe and cheap once things are
 *  warm -- the cache now starts filling the moment the config is
 *  known, matching the expectation that the INITIAL load should be
 *  automatic (an explicit Refresh remains the way to force a genuinely
 *  fresh fetch of something already cached). */
export function syncAgendaFilesConfig() {
  S.agendaFilesConfig = parseAgendaFilesVar(getAgendaFilesVar(S.state.doc ? S.state.localVariables : S.globalVariables));
  ensureAgendaFilesLoaded();
}

/** Kicks off a fetch for every configured agenda file not already
 *  cached (or currently loading), triggering a re-render each time one
 *  resolves. Safe to call on every agenda/TODO render -- already-
 *  cached or in-flight entries are skipped, so this is cheap once
 *  everything's loaded. A config change (different agendaFilesConfig
 *  than the cache currently reflects) clears the whole cache first, so
 *  a removed entry doesn't linger and a changed path gets refetched. */
export function ensureAgendaFilesLoaded({ prompt = false } = {}) {
  const configKey = JSON.stringify(S.agendaFilesConfig);
  if (S.agendaFilesCacheLoadedFor !== configKey) {
    agendaFilesCache.clear();
    S.agendaFilesCacheLoadedFor = configKey;
  }

  const duplicates = findDuplicateAgendaFiles(S.agendaFilesConfig);
  const localEntries = [];
  for (const key of S.agendaFilesConfig) {
    if (agendaFilesCache.has(key)) continue; // already loaded, errored, or currently loading
    if (duplicates.has(key)) {
      // the same path under another scheme: say so, instead of one of the two silently disappearing
      const first = duplicates.get(key);
      agendaFilesCache.set(key, { readOnly: true, error: `"${key}" has the same file name as "${first}", and agenda files must have different names, so only "${first}" is used.` });
      continue;
    }

    const colonIndex = key.indexOf(':');
    const scheme = colonIndex === -1 ? key : key.slice(0, colonIndex);
    const path = colonIndex === -1 ? '' : key.slice(colonIndex + 1);
    if (scheme === 'local') {
      localEntries.push({ key, path });
      continue;
    }
    const adapter = scheme === 'github' ? githubAdapter : scheme === 'webdav' ? webdavAdapter : null;
    if (!adapter) {
      agendaFilesCache.set(key, { error: `Unsupported scheme "${scheme}" \u2014 only github/webdav are supported for agenda files.` });
      continue;
    }

    const promise = adapter
      .read(path)
      .then((result) => {
        agendaFilesCache.set(
          key,
          result ? { doc: parseOrg(result.content), documentId: path } : { error: `"${path}" not found.` }
        );
        if (S.currentView === 'agenda' || S.currentView === 'tasklist') render();
        if (S.settingsOpen) renderSettingsView();
        if (S.searchOpen) renderSearchPanel();
      })
      .catch((err) => {
        agendaFilesCache.set(key, { error: err.message });
        if (S.currentView === 'agenda' || S.currentView === 'tasklist') render();
        if (S.searchOpen) renderSearchPanel();
      });
    agendaFilesCache.set(key, { loading: true, promise });
  }

  if (localEntries.length > 0) {
    const promise = loadLocalAgendaFiles(localEntries, prompt);
    for (const { key } of localEntries) agendaFilesCache.set(key, { loading: true, promise });
  }
}

/** Loads `local:` agenda files, one at a time: a file opened on this device earlier with File -> Open -> Local
 *  file. The browser keeps access to such a file only while it says so, and asking for it shows a prompt, so this
 *  NEVER asks unless `prompt` is true, which only a person's own tap on the refresh button passes. Without
 *  access the entry is an error that says what to do (shown above the agenda, like any file that fails to
 *  load), and with it the file is read like any other. Always marked readOnly: nothing may be written into one of
 *  these (Refile, Capture and Replace use only writable entries), since writing a local file back needs its own
 *  permission and its own adapter. One at a time because concurrent permission prompts are not reliable. */
async function loadLocalAgendaFiles(entries, prompt) {
  for (const { key, path } of entries) {
    const marks = { local: true, readOnly: true };
    let entry;
    try {
      const access = await filesystemAdapter.access(path);
      if (access === 'none') {
        entry = { ...marks, error: `"${path}" hasn't been opened on this device yet. Open it once with File \u2192 Open \u2192 Local file.` };
      } else if (access !== 'granted' && !prompt) {
        entry = { ...marks, needsAccess: true, error: `"${path}" needs permission to be read. Tap \u21bb to allow it.` };
      } else {
        const result = await filesystemAdapter.read(path, { prompt });
        entry = result ? { ...marks, doc: parseOrg(result.content), documentId: path } : { ...marks, error: `"${path}" not found.` };
      }
    } catch (err) {
      entry = { ...marks, needsAccess: true, error: `"${path}" could not be read: ${err.message}. Tap \u21bb to try again.` };
    }
    agendaFilesCache.set(key, entry);
    if (S.currentView === 'agenda' || S.currentView === 'tasklist') render();
    if (S.settingsOpen) renderSettingsView();
    if (S.searchOpen) renderSearchPanel();
  }
}

/** Like ensureAgendaFilesLoaded, but actually waits for every fetch it
 *  kicks off (or finds already in flight) to finish before returning
 *  -- unlike that function's own deliberate fire-and-forget design
 *  (correct for Agenda/TODO's own progressive-render UX: show what's
 *  already loaded, re-render again as each fetch resolves), a caller
 *  that needs a complete, accurate result on the very first render --
 *  Refile's own candidate list, in particular -- needs to genuinely
 *  wait rather than silently show an incomplete list the first time
 *  agenda files haven't been fetched yet in this session. */
export async function ensureAgendaFilesLoadedAndWait() {
  ensureAgendaFilesLoaded();
  await Promise.all(
    Array.from(agendaFilesCache.values())
      .filter((entry) => entry.loading)
      .map((entry) => entry.promise)
  );
}

/** Forces a fresh fetch of every configured agenda file, discarding
 *  whatever's currently cached (including any past errors) -- the
 *  explicit "Refresh" action, for when a file's contents have actually
 *  changed since it was last loaded this session. */
export function refreshAgendaFiles() {
  agendaFilesCache.clear();
  S.agendaFilesCacheLoadedFor = null;
  ensureAgendaFilesLoaded({ prompt: true }); // a tap on the refresh button is the one thing allowed to ask for a local file's permission
  render();
}

/** Waits until every currently-configured agenda file has actually
 *  finished loading (succeeded or errored -- not still `{ loading:
 *  true }`), kicking off any fetches that haven't started yet.
 *  ensureAgendaFilesLoaded's own fetches are fire-and-forget (the
 *  Agenda/TODO views just re-render as each one resolves), which is
 *  fine for a live view but not for an export: without this, exporting
 *  "this file + Agenda Files" before ever having visited the Agenda
 *  view would silently produce a calendar missing every other file,
 *  since nothing would have triggered their fetches yet. Capped at a
 *  few seconds so one stuck fetch can't hang the export flow forever;
 *  whatever's actually settled by then (successful or errored) is what
 *  aggregateAgendaDocs sees. */
export function waitForAgendaFilesLoaded() {
  ensureAgendaFilesLoaded();
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      const allSettled = S.agendaFilesConfig.every((key) => {
        const entry = agendaFilesCache.get(key);
        return entry && !entry.loading;
      });
      if (allSettled || Date.now() - startedAt > 8000) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

/** The full docs list for agenda/TODO aggregation: the currently open
 *  document plus every successfully-loaded configured agenda file,
 *  deduplicated by documentId -- if the current file also happens to
 *  be in the configured list, the live in-memory version (with
 *  whatever unsaved edits exist right now) wins over a separately
 *  fetched, possibly-stale read of the same file. */
export function aggregateAgendaDocs({ writable = false } = {}) {
  const docs = [{ documentId: S.state.documentId, doc: S.state.doc }];
  const seen = new Set([S.state.documentId]);
  for (const entry of agendaFilesCache.values()) {
    if (writable && entry.readOnly) continue; // `writable`: only for callers that write back (Refile, Replace); a local agenda file is read-only
    if (entry.doc && !seen.has(entry.documentId)) {
      docs.push({ documentId: entry.documentId, doc: entry.doc });
      seen.add(entry.documentId);
    }
  }
  return docs;
}

/** Recomputes contactsFilesConfig from whichever variable set is
 *  actually authoritative right now -- same reasoning and same file-
 *  local-override handling as syncAgendaFilesConfig above. Call this
 *  at every one of that function's own call sites. */
export function syncContactsFilesConfig() {
  S.contactsFilesConfig = parseAgendaFilesVar(getContactsFilesVar(S.state.doc ? S.state.localVariables : S.globalVariables));
}

/** Kicks off a fetch for every configured contacts file not already
 *  cached (or currently loading) -- same fire-and-forget shape as
 *  ensureAgendaFilesLoaded, re-rendering Settings (the only place this
 *  cache's own loading/error state is currently shown) as each fetch
 *  resolves. */
export function ensureContactsFilesLoaded() {
  const configKey = JSON.stringify(S.contactsFilesConfig);
  if (S.contactsFilesCacheLoadedFor !== configKey) {
    contactsFilesCache.clear();
    S.contactsFilesCacheLoadedFor = configKey;
  }

  for (const key of S.contactsFilesConfig) {
    if (contactsFilesCache.has(key)) continue;

    const colonIndex = key.indexOf(':');
    const scheme = colonIndex === -1 ? key : key.slice(0, colonIndex);
    const path = colonIndex === -1 ? '' : key.slice(colonIndex + 1);
    const adapter = scheme === 'github' ? githubAdapter : scheme === 'webdav' ? webdavAdapter : null;
    if (!adapter) {
      contactsFilesCache.set(key, { error: `Unsupported scheme "${scheme}" \u2014 only github/webdav are supported for contacts files.` });
      continue;
    }

    const promise = adapter
      .read(path)
      .then((result) => {
        contactsFilesCache.set(
          key,
          result ? { doc: parseOrg(result.content), documentId: path } : { error: `"${path}" not found.` }
        );
        if (S.settingsOpen) renderSettingsView();
      })
      .catch((err) => {
        contactsFilesCache.set(key, { error: err.message });
        if (S.settingsOpen) renderSettingsView();
      });
    contactsFilesCache.set(key, { loading: true, promise });
  }
}

/** Like ensureContactsFilesLoaded, but actually waits for every fetch
 *  to finish -- the vCard export needs a complete, accurate result on
 *  the very first render, the same reasoning ensureAgendaFilesLoadedAndWait
 *  documents for Refile's own candidate list. */
export async function ensureContactsFilesLoadedAndWait() {
  ensureContactsFilesLoaded();
  await Promise.all(
    Array.from(contactsFilesCache.values())
      .filter((entry) => entry.loading)
      .map((entry) => entry.promise)
  );
}

/** The full docs list for vCard export aggregation: the currently open
 *  document plus every successfully-loaded configured contacts file,
 *  deduplicated by documentId -- same "the live, possibly-unsaved
 *  version wins" precedence as aggregateAgendaDocs above. */
export function aggregateContactsDocs() {
  const docs = [{ documentId: S.state.documentId, doc: S.state.doc }];
  const seen = new Set([S.state.documentId]);
  for (const entry of contactsFilesCache.values()) {
    if (entry.doc && !seen.has(entry.documentId)) {
      docs.push({ documentId: entry.documentId, doc: entry.doc });
      seen.add(entry.documentId);
    }
  }
  return docs;
}
