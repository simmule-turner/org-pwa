import { openDocument, saveDocument, saveAndSync, markDocumentOpen } from './src/document-store.js';
import { setSyncMeta, getSyncMeta } from './src/sync-engine.js';
import { hasPendingChange, getPendingChange, clearPendingChange } from './src/outbox.js';
import { parseOrg, serializeOrg, findHeadingLineNumber } from './src/org-parser.js';
import {
  findAncestorPath,
  getPropertiesText,
  buildArchivedClone,
  getArchiveLocation,
  parseArchiveLocation,
  resolveArchiveFileId,
  insertAtArchiveLocation,
  buildRestoredClone,
  isArchivedInPlace,
  shiftLevels,
} from './src/archive-model.js';
import {
  resolveLinkTarget,
  resolveImagePath,
  guessImageMimeType,
  isExternalUrl,
  findHeadingByTitle,
  findFootnoteDefinition,
} from './src/link-resolve.js';
import { parseInline, stripLineBreakMarker } from './src/inline-markup.js';
import { flattenVisibleRows, toggleFold, cycleHeadingTodo, toggleHeadingTodo, cycleItemCheckbox } from './src/outline-view-model.js';
import { updateCheckboxCookiesUpward } from './src/checkbox-cookie.js';
import { searchDocument } from './src/search.js';
import { applyStartupVisibility, cycleFoldLevel } from './src/fold-state.js';
import { parseStartupConfig, resolveEffectiveStartupConfig } from './src/startup-config.js';
import {
  parseLocalVariables,
  parseLispBoolean,
  parseLispNumber,
  getAgendaStartOnWeekday,
  getDeadlineWarningDays,
  getCalendarLatitude,
  getCalendarLongitude,
  getCalendarLocationName,
  getCycleOpenArchivedTrees,
  getAgendaSkipCommentTrees,
  getAgendaSkipArchivedTrees,
  getContactsBirthdayProperty,
  getUseSubSuperscripts,
  getUseTagInheritance,
  getUsePropertyInheritance,
  getClosedKeepWhenNoTodo,
  getRefileTargets,
  getAsciiTextWidth,
  getExtraMenu,
  getFileMenuAliases,
  getMoreMenuAliases,
  getExportMenuAliases,
  getViewMenuAliases,
} from './src/local-variables.js';
import { parseRefileTargets, getRefileCandidates, resolveEntryFileIds, findHeadingByOutlinePath } from './src/refile.js';
import { isClockRunning, clockIn, clockInSwitchingTasks, clockOut, clockCancel, totalClockedMinutes, formatClockDuration, findHeadingWithRunningClock } from './src/clock.js';
import { computeClocktable, renderClocktable } from './src/clocktable.js';
import { parseExtraMenu } from './src/extra-menu.js';
import { parseMenuAliases } from './src/menu-alias.js';
import { splitHexAlpha, combineHexAlpha } from './src/hex-alpha.js';
import { resolveTodoSequence } from './src/todo-cycle.js';
import { applyRepeaterShiftOnDone } from './src/repeater-shift.js';
import { decideProgressLogging, decideLogbookEntry, getEffectiveLogDoneSetting, parseLogDoneLispValue } from './src/progress-logging.js';
import { parseGlobalVariables, serializeGlobalVariables, mergeGlobalAndLocalVariables } from './src/global-variables.js';
import { formatStateLogLine, parseLogbookEntries } from './src/logbook.js';
import {
  buildAgendaItems,
  buildTaskList,
  dayView,
  weekView,
  monthView,
  startOfDay,
  endOfDay,
  startOfWeek,
  parseRepeater,
} from './src/agenda.js';
import { scanPrompts, expandTemplate, resolveOlpTarget, insertCapture, resolveCaptureFileId, getCaptureFileScheme, CAPTURE_FILE_SCHEMES } from './src/capture-template.js';
import { exportToMarkdown } from './src/export-markdown.js';
import { exportToOdt } from './src/export-odt.js';
import { exportToAscii } from './src/export-ascii.js';
import { exportToHtml } from './src/export-html.js';
import { exportToIcalendar } from './src/export-icalendar.js';
import { createHistory, pushSnapshot, canUndo, canRedo, undo, redo, jumpTo, currentEntry } from './src/undo-history.js';
import { diffHunks } from './src/text-diff.js';
import { parseOrgTimestamp, formatOrgTimestamp, parseDelay } from './src/org-timestamp.js';
import {
  renameHeading,
  setHeadingTags,
  setPriority,
  getPlainTimestampInTitle,
  setPlainTimestampInTitle,
  insertTopLevelHeading,
  insertChildHeading,
  removeHeading,
  moveHeadingUp,
  moveHeadingDown,
  promoteHeading,
  demoteHeading,
} from './src/heading-edit.js';
import {
  setTableCell,
  isTableHeaderRow,
  insertTableRow,
  deleteTableRow,
  insertTableColumn,
  deleteTableColumn,
  insertTable,
  editParagraphText,
  insertParagraphAfter,
  deleteListItem,
  deleteTable,
  lastTableInBody,
  deleteParagraph,
  editListItemText,
  insertListItem,
  getHeadingText,
  setHeadingText,
} from './src/body-edit.js';
import { createIndexedDbAdapter } from './src-browser/indexeddb-adapter.js';
import {
  createFileSystemAccessAdapter,
  pickAndRegisterFile,
  pickAndRegisterNewFile,
  isFileSystemAccessSupported,
} from './src-browser/filesystem-adapter.js';
import { createGithubAdapter, isGithubConfigured } from './src-browser/github-adapter.js';
import { createWebdavAdapter, isWebdavConfigured } from './src-browser/webdav-adapter.js';
import {
  createInputFileAdapter,
  pickAndImportFile,
  isFileSystemAccessUnsupported,
  downloadFile,
} from './src-browser/input-file-adapter.js';
import {
  getGithubConfig,
  setGithubConfig,
  getWebdavConfig,
  setWebdavConfig,
  getTheme,
  setTheme,
  getCustomThemeColors,
  setCustomThemeColors,
  getDocsViewState,
  setDocsViewState,
  getFontFamily,
  setFontFamily,
  getFontSize,
  setFontSize,
  getTablesFontSize,
  setTablesFontSize,
  exportAllSettings,
  importAllSettings,
  getLastActiveDocument,
  setLastActiveDocument,
  getCaptureTemplates,
  setCaptureTemplates,
  DEFAULT_CAPTURE_TEMPLATES,
  getAgendaFiles,
  getGlobalVariables,
  setGlobalVariables,
  DEFAULT_GLOBAL_VARIABLES,
} from './src-browser/settings.js';

// Disable auto-capitalization AND auto-correction app-wide, on every
// text input/textarea this app ever creates -- Chrome and Safari on
// mobile default autocapitalize to "sentences," which fights against
// this app's own conventions (tags, properties, list markers, and
// most everyday capture text are almost always lowercase) with no
// per-field way to opt out short of setting the attribute directly.
// autocorrect="off" is the same idea for a DIFFERENT, separately
// surprising behavior: iOS/Safari's own "double-tap space inserts a
// period" system shortcut is tied to the same underlying
// autocorrection subsystem as spelling suggestions, and ties directly
// to this attribute -- most noticeable while typing normal prose into
// a plain text field (a Settings text box, a capture prompt answer),
// where two spaces in a row (easy to type without noticing on a
// mobile keyboard) silently becomes ". " instead. Wrapping
// createElement here, once, covers every input/textarea this app ever
// creates without needing the same attributes repeated at dozens of
// individual call sites. A manual capital or period is still one tap
// away on the keyboard's own keys -- this only removes the automatic,
// unrequested kind, never the ability to type either deliberately.
const nativeCreateElement = document.createElement.bind(document);
document.createElement = function (tagName, options) {
  const el = nativeCreateElement(tagName, options);
  const tag = String(tagName).toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('autocorrect', 'off');
  }
  return el;
};

const GLOBAL_TODO_DEFAULT = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };

// Set to { heading, fromTodo, toTodo, timestamp } when a transition's
// effective logging spec requires a note -- renderLogNotePrompt shows a
// small form for it. Only ever one at a time (matching how only one
// heading can be mid-transition at once from user interaction); a
// second transition happening while a prompt is already pending
// (unlikely, but not impossible via rapid taps) simply replaces it --
// the earlier prompt's note is lost if never submitted, the same "skip
// discards it" behavior as explicitly dismissing one.
// happening while a prompt is already pending (unlikely, but not
// impossible via rapid taps) simply replaces it -- the earlier prompt's
// note is lost if never submitted, the same "skip discards it" behavior
// as explicitly dismissing one. Generalized beyond just "DONE" now:
// any keyword transition can require a note (the "@" logging marker
// isn't done-specific), not only org-log-done's own 'note value.
let pendingLogNote = null;
// Set to { heading } when "Refile..." is tapped from a heading's own
// action menu -- renderRefilePanel shows the candidate-target list for
// it. Only ever one at a time, matching pendingLogNote's own pattern.
let pendingRefile = null;
// Set to { heading } when Archive is tapped on a non-archived heading
// -- always shown now (org-archive-confirm was removed, the person
// wants confirmation to always happen, not something toggleable).
// renderArchiveConfirmPanel shows the Refile/Cancel/OK choice for it,
// reusing refilePanel's own DOM element (the two flows are mutually
// exclusive, never both active at once, so sharing the element avoids
// a whole extra panel just for this one three-button prompt).
let pendingArchiveConfirm = null;
// Set to { heading } when Clock out is tapped on a heading with a
// running clock -- always shown, offering Cancel (org-clock-cancel,
// discard the session entirely) / Stop (org-clock-out, the normal
// completion) / OK (back out, keep the clock running). Reuses
// refilePanel's own DOM element, same pattern as pendingArchiveConfirm.
let pendingClockStop = null;

/**
 * Every call site in this app that changes a heading's TODO state
 * (cycling, toggling) must go through this rather than calling
 * cycleHeadingTodo/toggleHeadingTodo directly -- progress logging needs
 * to see EVERY transition applied consistently, not just the ones some
 * call site happened to remember to wire up. `performChange` is a
 * thunk that actually performs the state change (e.g. `() =>
 * cycleHeadingTodo(state.doc, heading, GLOBAL_TODO_DEFAULT)`); this
 * wrapper captures the state immediately before and after it runs to
 * decide what logging actions apply.
 *
 * Two genuinely separate decisions get applied here, matching
 * progress-logging.js's own separation: the CLOSED planning line
 * (org-log-done's 'time value specifically) and a :LOGBOOK: "- State
 * ..." entry (the general per-keyword mechanism, which also subsumes
 * org-log-done's 'note value as a synthesized fallback spec -- see
 * effectiveLogSpec's own docs for why that isn't a separate code path).
 * Both can fire independently for the same transition.
 *
 * Parses #+STARTUP: fresh from state.doc on every call rather than
 * trusting state.startupConfig to already be current -- that cached
 * value isn't guaranteed refreshed at every point a heading's TODO
 * state could change (e.g. immediately after a plain-text-editor
 * round-trip), and this check is cheap enough that re-parsing beats
 * risking a stale read.
 */
function applyTodoTransition(heading, performChange) {
  const fromTodo = heading.todo;
  performChange();
  const toTodo = heading.todo;

  const sequence = resolveTodoSequence(state.doc, GLOBAL_TODO_DEFAULT);
  const fileLocalVarsOnly = parseLocalVariables(serializeOrg(state.doc));
  const logDoneSetting = getEffectiveLogDoneSetting(fileLocalVarsOnly, parseStartupConfig(state.doc), globalVariables);
  const keepWhenNoTodo = getClosedKeepWhenNoTodo(state.localVariables);
  const now = new Date();
  const timestamp = formatOrgTimestamp({ date: now, time: now.toTimeString().slice(0, 5), active: false });

  const closedDecision = decideProgressLogging(fromTodo, toTodo, sequence, logDoneSetting, keepWhenNoTodo);
  if (closedDecision.insertClosed) {
    heading.planning.closed = timestamp;
  } else if (closedDecision.removeClosed) {
    heading.planning.closed = null;
  }

  const logbookDecision = decideLogbookEntry(fromTodo, toTodo, sequence, logDoneSetting);
  if (logbookDecision.shouldLog) {
    if (logbookDecision.needsNote) {
      pendingLogNote = { heading, fromTodo, toTodo, timestamp };
    } else {
      heading.logbookLines.splice(0, 0, ...formatStateLogLine(toTodo, fromTodo, timestamp));
    }
  }

  // Real org's own repeater-shift-on-DONE: completing a heading with
  // a repeating SCHEDULED/DEADLINE doesn't actually finish it -- the
  // date shifts forward and the state bounces straight back to TODO.
  // Only applies when THIS transition is what just entered a
  // done-type keyword (not e.g. cycling from one done-type keyword to
  // another) -- matches real org's own "on marking DONE" trigger.
  if (sequence.doneKeywords.includes(toTodo) && !sequence.doneKeywords.includes(fromTodo)) {
    if (applyRepeaterShiftOnDone(heading, sequence, now)) {
      // The bounce-back is an automatic side effect of the repeater,
      // not a real user-initiated transition -- real org's own actual
      // behavior logs only the original DONE entry above, not a
      // second one for this. The CLOSED timestamp just inserted DOES
      // still need to come back off, though, since the heading isn't
      // actually staying done.
      const bounceBackDecision = decideProgressLogging(toTodo, heading.todo, sequence, logDoneSetting, keepWhenNoTodo);
      if (bounceBackDecision.removeClosed) {
        heading.planning.closed = null;
      }
    }
  }
}

/** Shows a small dedicated panel for taking (or skipping) the log note
 *  when a transition's effective logging spec requires one (either an
 *  explicit "@" on the keyword being entered, or org-log-done's 'note
 *  value acting as a same-shaped fallback for a done-type keyword with
 *  no spec of its own) -- the TODO badge already flipped immediately
 *  when tapped (applyTodoTransition doesn't wait for this), so
 *  declining to add a note here never reverts or blocks that state
 *  change; it only decides whether a :LOGBOOK: entry gets added
 *  alongside it. Skipping adds no entry at all -- not even a
 *  timestamp-only fallback -- matching real org's own behavior for a
 *  declined note prompt, and this app's own established convention
 *  from before this was generalized beyond just DONE. */
function renderLogNotePrompt() {
  doneNotePanel.innerHTML = '';
  if (!pendingLogNote) {
    doneNotePanel.style.display = 'none';
    return;
  }
  doneNotePanel.style.display = 'block';

  const { heading, fromTodo, toTodo, timestamp } = pendingLogNote;

  const label = document.createElement('div');
  label.style.fontSize = '12px';
  label.style.opacity = '0.7';
  label.style.marginBottom = '6px';
  label.textContent = `Note for marking "${heading.title || '(untitled)'}" as ${toTodo}:`;
  doneNotePanel.appendChild(label);

  const textarea = document.createElement('textarea');
  textarea.id = 'done-note-input';
  textarea.rows = 3;
  textarea.style.width = '100%';
  textarea.style.boxSizing = 'border-box';
  textarea.style.font = 'inherit';
  doneNotePanel.appendChild(textarea);
  autoGrowTextarea(textarea);

  const row = document.createElement('div');
  row.className = 'panel-row';
  row.style.marginTop = '6px';
  row.appendChild(
    menuButton('Save note', () => {
      const text = textarea.value.trim();
      pendingLogNote = null;
      if (text) {
        heading.logbookLines.splice(0, 0, ...formatStateLogLine(toTodo, fromTodo, timestamp, text));
      }
      commitAndRender(text ? 'Added log note' : 'Skipped log note');
    })
  );
  row.appendChild(
    menuButton('Skip', () => {
      pendingLogNote = null;
      renderLogNotePrompt();
    })
  );
  doneNotePanel.appendChild(row);

  requestAnimationFrame(() => textarea.focus());
}

const kv = createIndexedDbAdapter();
const filesystemAdapter = createFileSystemAccessAdapter(kv);
const inputFileAdapter = createInputFileAdapter(kv);
// A live cache of GitHub settings, refreshed whenever Settings saves new
// ones — createGithubAdapter takes a getter function rather than a
// static config object specifically so this stays current without
// needing to reconstruct the adapter every time settings change.
let githubConfig = { token: '', owner: '', repo: '', branch: 'main' };
const githubAdapter = createGithubAdapter(() => githubConfig);
let webdavConfig = { baseUrl: '', username: '', password: '' };
const webdavAdapter = createWebdavAdapter(() => webdavConfig);

// org-agenda-files equivalent: additional GitHub/WebDAV files the
// Agenda/TODO views scan across, beyond whichever file is currently
// open. agendaFilesConfig is the raw configured list (loaded at
// bootstrap, refreshed whenever Settings saves a new one, same pattern
// as githubConfig/webdavConfig above). agendaFilesCache holds the
// actual fetched-and-parsed result per entry -- populated
// asynchronously (see ensureAgendaFilesLoaded), since buildAgendaItems
// itself and the Agenda/TODO views that call it are synchronous; the
// view renders with whatever's cached so far and re-renders again once
// each fetch resolves, the same "render now, swap in what arrives"
// pattern already used for inline images.
let agendaFilesConfig = [];
let globalVariablesText = '';
let globalVariables = {}; // parsed from globalVariablesText -- kept in sync by setGlobalVariablesAndReparse below
const agendaFilesCache = new Map(); // "scheme:path" -> { doc, documentId } | { error } | { loading: true }
let agendaFilesCacheLoadedFor = null; // JSON of the config this cache reflects, so a settings change invalidates stale entries

/** Kicks off a fetch for every configured agenda file not already
 *  cached (or currently loading), triggering a re-render each time one
 *  resolves. Safe to call on every agenda/TODO render -- already-
 *  cached or in-flight entries are skipped, so this is cheap once
 *  everything's loaded. A config change (different agendaFilesConfig
 *  than the cache currently reflects) clears the whole cache first, so
 *  a removed entry doesn't linger and a changed path gets refetched. */
function ensureAgendaFilesLoaded() {
  const configKey = JSON.stringify(agendaFilesConfig);
  if (agendaFilesCacheLoadedFor !== configKey) {
    agendaFilesCache.clear();
    agendaFilesCacheLoadedFor = configKey;
  }

  for (const key of agendaFilesConfig) {
    if (agendaFilesCache.has(key)) continue; // already loaded, errored, or currently loading

    agendaFilesCache.set(key, { loading: true }); // set BEFORE the async call, so a concurrent call to this function can't kick off a duplicate fetch for the same key

    const colonIndex = key.indexOf(':');
    const scheme = colonIndex === -1 ? key : key.slice(0, colonIndex);
    const path = colonIndex === -1 ? '' : key.slice(colonIndex + 1);
    const adapter = scheme === 'github' ? githubAdapter : scheme === 'webdav' ? webdavAdapter : null;
    if (!adapter) {
      agendaFilesCache.set(key, { error: `Unsupported scheme "${scheme}" \u2014 only github/webdav are supported for agenda files.` });
      continue;
    }

    adapter
      .read(path)
      .then((result) => {
        agendaFilesCache.set(
          key,
          result ? { doc: parseOrg(result.content), documentId: path } : { error: `"${path}" not found.` }
        );
        if (currentView === 'agenda' || currentView === 'tasklist') render();
      })
      .catch((err) => {
        agendaFilesCache.set(key, { error: err.message });
        if (currentView === 'agenda' || currentView === 'tasklist') render();
      });
  }
}

/** Forces a fresh fetch of every configured agenda file, discarding
 *  whatever's currently cached (including any past errors) -- the
 *  explicit "Refresh" action, for when a file's contents have actually
 *  changed since it was last loaded this session. */
function refreshAgendaFiles() {
  agendaFilesCache.clear();
  agendaFilesCacheLoadedFor = null;
  ensureAgendaFilesLoaded();
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
function waitForAgendaFilesLoaded() {
  ensureAgendaFilesLoaded();
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      const allSettled = agendaFilesConfig.every((key) => {
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
function aggregateAgendaDocs() {
  const docs = [{ documentId: state.documentId, doc: state.doc }];
  const seen = new Set([state.documentId]);
  for (const entry of agendaFilesCache.values()) {
    if (entry.doc && !seen.has(entry.documentId)) {
      docs.push({ documentId: entry.documentId, doc: entry.doc });
      seen.add(entry.documentId);
    }
  }
  return docs;
}

/** Which adapter Save/Save-As-in-place should use — whatever storage kind
 *  the currently open document actually came from. This is the crux of
 *  "Save uses whatever mechanism was used to open the file". */
/** CRITICAL DATA-LOSS FIX (defense in depth): every cross-file write
 *  that bypasses saveAndSync (capture-to-a-different-file, archive-to-
 *  a-different-file, refile, unarchive/restore-to-a-different-file)
 *  writes straight to disk via adapter.write, with no corresponding
 *  syncMeta update -- meaning this app's own record of "the last known
 *  hash of that file" would otherwise go stale the instant any of those
 *  ran, regardless of whether that target file was also the currently-
 *  open document. Later opening/editing/saving that same file could
 *  then miss a REAL external change entirely, since the conflict
 *  check's baseline no longer reflected reality. Call this right after
 *  every one of those direct writes succeeds, so syncMeta always
 *  tracks the true last-known-on-disk state no matter which code path
 *  performed the write -- the same bookkeeping saveAndSync's own
 *  syncDocument already keeps for the single-document save path, now
 *  kept consistently everywhere a write can happen. */
/** Re-reads the currently open document fresh from disk/GitHub/WebDAV
 *  and replaces state.doc with it, discarding whatever was in memory.
 *  Used both by saveCurrent's own "keep disk" conflict resolution and
 *  the external-change banner's Reload button -- the same "start over
 *  from what's actually there right now" operation either way. Caller
 *  is responsible for confirming with the person first if there's
 *  anything of theirs that would be lost by doing this. */
async function reloadCurrentDocumentFromDisk() {
  const reopened = await openDocument({
    documentId: state.documentId,
    kvAdapter: kv,
    diskAdapter: activeDiskAdapter(),
  });
  state.doc = reopened.doc;
  const rawLocalVars = parseLocalVariables(serializeOrg(state.doc));
  state.startupConfig = resolveEffectiveStartupConfig(state.doc, rawLocalVars, globalVariables);
  state.localVariables = mergeGlobalAndLocalVariables(globalVariables, rawLocalVars);
  navigationBackStack = [];
  currentContextHeading = null;
  syncNavBackButtonVisibility();
  const archiveVisibility = getCycleOpenArchivedTrees(state.localVariables) ? 'noarchived' : 'archived';
  applyStartupVisibility(state.doc, state.startupConfig, archiveVisibility);
  isDirty = false;
  lastSavedText = serializeOrg(state.doc);
  hideExternalChangeBanner();
  render();
}

/**
 * Shared "read another file safely, mutate it, write it back" sequence
 * for every cross-file operation (capture, archive, refile, restore).
 * Centralizing this here means the sync-baseline bookkeeping
 * (recordSyncedWrite) every one of these needs can never again be
 * silently forgotten by a future feature needing the same shape --
 * exactly the class of bug that caused a real data-loss issue before
 * this existed, when four separate hand-rolled copies of this
 * sequence meant remembering the same step four separate times.
 *
 * `label` -- used in every generated status/error message, lowercase,
 * describing the action a person would recognize ("archive", "refile",
 * "restore", "capture").
 * `allowMissing` -- if true, a target file that doesn't exist yet
 * starts from an empty document rather than being treated as an error
 * (capture/archive: a fresh target file is a completely normal thing
 * to create; refile/restore: the target is expected to already exist,
 * so its absence is a genuine error, not something to paper over).
 * `mutate(doc)` -- feature-specific mutation of the freshly-read
 * target document. Return `undefined`/`null` to abort (after calling
 * setStatus itself with a feature-specific message -- this helper
 * doesn't know enough about the specific failure to word that itself);
 * anything else is passed through as this function's own return value
 * on success.
 *
 * Returns `{ ok: true, result }` on success (after the write AND the
 * sync-baseline update have both succeeded), or `{ ok: false }` after
 * already calling setStatus with a clear, label-specific error --
 * callers just check `.ok` and bail out if false, no separate error
 * text of their own to construct for any of these shared failure modes.
 */
async function writeToOtherFile(fileId, { label, allowMissing, mutate }) {
  // Same trap capture's own version of this check already described:
  // writing straight to the backing store while an unrelated pending
  // (unsynced) local edit for this SAME file is still sitting in the
  // outbox would leave that edit's own "resume" flow completely
  // unaware this write ever happened -- resuming it later and saving
  // would silently overwrite whatever this write just did, since
  // nothing would have told the outbox its assumption about "the last
  // synced version" had changed out from under it. Refuse up front.
  if (await hasPendingChange(kv, fileId)) {
    setStatus(
      `Can't ${label} to "${fileId}" right now \u2014 it has unsaved local changes from an earlier session that haven't been synced yet. Open "${fileId}" directly first and either save or discard those changes, then retry.`
    );
    return { ok: false };
  }

  const adapter = activeDiskAdapter();
  if ((state.storageKind === 'filesystem' || state.storageKind === 'input') && !(await adapter.exists(fileId))) {
    setStatus(
      `Can't ${label} to "${fileId}" automatically \u2014 local files need that file picked/created once first (browser security requires a file picker per file, not something this can do on its own). Try File \u2192 Open or Save As on "${fileId}" first, or use GitHub/WebDAV for automatic cross-file ${label}ing.`
    );
    return { ok: false };
  }

  let doc;
  try {
    const existing = await adapter.read(fileId);
    if (!existing) {
      if (!allowMissing) {
        setStatus(`Could not ${label}: "${fileId}" no longer exists.`);
        return { ok: false };
      }
      doc = parseOrg('');
    } else {
      doc = parseOrg(existing.content);
    }
  } catch (err) {
    setStatus(`Could not ${label}: reading "${fileId}" failed \u2014 ${err.message}`);
    return { ok: false };
  }

  const result = mutate(doc);
  if (result === undefined || result === null) return { ok: false };

  try {
    const content = serializeOrg(doc);
    const written = await adapter.write(fileId, content);
    await recordSyncedWrite(fileId, written.hash);
  } catch (err) {
    setStatus(`Could not ${label}: writing "${fileId}" failed \u2014 ${err.message}. Nothing was changed.`);
    return { ok: false };
  }

  return { ok: true, result };
}

function recordSyncedWrite(fileId, hash) {
  return setSyncMeta(kv, fileId, { lastSyncedHash: hash });
}

let externalChangeCheckInFlight = false;

// The specific disk hash a Dismiss applied to, so a genuinely NEWER
// external change (a different hash) still gets surfaced rather than
// being silently suppressed by an earlier, unrelated dismissal --
// null both before anything's ever been dismissed and after switching
// documents (see afterDocumentLoaded, which resets this).
let externalChangeDismissedHash = null;

/** Best-effort, proactive check: does the currently open document's
 *  actual state on disk/GitHub/WebDAV right now still match what this
 *  app last recorded seeing (openDocument's own baseline, or the most
 *  recent successful write)? If not, surfaces a dismissable notice
 *  rather than waiting for an eventual Save to be the first moment
 *  this ever comes up. Never throws and never blocks anything -- a
 *  failed check (offline, a network hiccup, the file briefly
 *  unreadable) is simply skipped; Save's own conflict check is the
 *  actual, required safety net this is only trying to surface earlier,
 *  not replace. */
async function checkForExternalChange() {
  if (!state.documentId || externalChangeCheckInFlight) return;
  if ((state.storageKind === 'github' || state.storageKind === 'webdav') && !navigator.onLine) return;
  externalChangeCheckInFlight = true;
  try {
    const meta = await getSyncMeta(kv, state.documentId);
    if (!meta) return; // no baseline recorded yet -- nothing to compare against
    const fresh = await activeDiskAdapter().read(state.documentId);
    if (!fresh) return;
    if (fresh.hash !== meta.lastSyncedHash && fresh.hash !== externalChangeDismissedHash) {
      showExternalChangeBanner(fresh.hash);
    }
  } catch {
    // Best-effort -- see the doc comment above.
  } finally {
    externalChangeCheckInFlight = false;
  }
}

let externalChangeShownForHash = null;

function showExternalChangeBanner(hash) {
  externalChangeShownForHash = hash;
  externalChangeText.textContent = `"${state.documentId}" changed elsewhere since you opened it here.`;
  externalChangeBanner.style.display = 'flex';
}

function hideExternalChangeBanner() {
  externalChangeBanner.style.display = 'none';
}

function activeDiskAdapter() {
  if (state.storageKind === 'github') return githubAdapter;
  if (state.storageKind === 'webdav') return webdavAdapter;
  if (state.storageKind === 'input') return inputFileAdapter;
  return filesystemAdapter;
}

/**
 * Performs a full org-archive-subtree move (real org's `C-c C-x C-s` /
 * `C-c $`): computes the effective org-archive-location for `heading`
 * (its own `ARCHIVE` property, then the file's `#+ARCHIVE:` keyword,
 * then the documented default `"%s_archive::"`), and moves the subtree
 * there -- either within the current document (an empty file part) or
 * to a separate file, read/parsed/inserted/written via whichever
 * storage backend the current document itself already came from
 * (reused directly; there's no separate "where does the archive file
 * live" configuration to set up).
 *
 * Write-before-remove for the cross-file case: buildArchivedClone is
 * deliberately non-mutating (see archive-model.js), so the target
 * file's write is attempted FIRST, and the heading is only removed
 * from the current document once that write has actually succeeded --
 * a network failure, a WebDAV conflict, or a local-file permission
 * problem can then never silently lose the heading; it simply stays
 * exactly where it was, with a clear error shown instead.
 *
 * A local (File System Access) or iOS-import backend can't write to a
 * file it doesn't already have a granted handle for -- the browser's
 * own security model requires an explicit user gesture (a file picker)
 * per file, which can't be done silently mid-archive. Rather than
 * failing with a confusing low-level permission error, this is
 * detected up front and reported as an actionable message.
 */
/** Loads every document a resolved refile-targets spec could need,
 *  beyond what aggregateAgendaDocs() already covers (the current file
 *  and every configured Agenda File) -- an explicitly-named target
 *  file spec that isn't already one of those gets read fresh via the
 *  active disk adapter. A file that fails to load is silently omitted
 *  (getRefileCandidates already treats a missing docsById entry as
 *  "no candidates from this entry", not an error) rather than blocking
 *  the whole picker on one bad/inaccessible target. */
async function loadRefileTargetDocs(targetsSpec) {
  const docsById = {};
  for (const { documentId, doc } of aggregateAgendaDocs()) {
    docsById[documentId] = doc;
  }
  const adapter = activeDiskAdapter();
  for (const entry of targetsSpec) {
    if (entry.fileSpec === 'current' || entry.fileSpec === 'agenda-files') continue;
    for (const documentId of resolveEntryFileIds(entry, state.documentId, agendaFilesConfig)) {
      if (docsById[documentId]) continue;
      try {
        const existing = await adapter.read(documentId);
        if (existing) docsById[documentId] = parseOrg(existing.content);
      } catch {
        // Omitted, not an error -- see doc comment above.
      }
    }
  }
  return docsById;
}

async function openRefilePicker(heading) {
  pendingRefile = { heading, loading: true, candidates: [] };
  renderRefilePanel();
  const targetsSpec = parseRefileTargets(getRefileTargets(state.localVariables));
  const docsById = await loadRefileTargetDocs(targetsSpec);
  if (!pendingRefile || pendingRefile.heading !== heading) return; // dismissed while loading
  const candidates = getRefileCandidates(targetsSpec, docsById, state.documentId, agendaFilesConfig, heading);
  pendingRefile = { heading, loading: false, candidates };
  renderRefilePanel();
}

function renderRefilePanel() {
  refilePanel.innerHTML = '';
  if (!pendingRefile) {
    refilePanel.style.display = 'none';
    return;
  }
  refilePanel.style.display = 'block';

  const label = document.createElement('div');
  label.style.fontSize = '12px';
  label.style.opacity = '0.7';
  label.style.marginBottom = '6px';
  label.textContent = `Refile "${pendingRefile.heading.title || '(untitled)'}" to:`;
  refilePanel.appendChild(label);

  if (pendingRefile.loading) {
    const loading = document.createElement('div');
    loading.style.fontSize = '13px';
    loading.style.opacity = '0.6';
    loading.style.padding = '8px 0';
    loading.textContent = 'Loading targets\u2026';
    refilePanel.appendChild(loading);
    return;
  }

  const list = document.createElement('div');
  list.style.maxHeight = '260px';
  list.style.overflowY = 'auto';
  if (pendingRefile.candidates.length === 0) {
    const empty = document.createElement('div');
    empty.style.fontSize = '13px';
    empty.style.opacity = '0.6';
    empty.style.padding = '8px 0';
    empty.textContent =
      'No refile targets found -- check org-refile-targets (Global/Local Variables) and that any configured target files are reachable.';
    list.appendChild(empty);
  }
  for (const candidate of pendingRefile.candidates) {
    const row = document.createElement('div');
    row.className = 'panel-row';
    row.style.cursor = 'pointer';
    row.style.fontSize = '14px';
    row.style.flexDirection = 'column';
    row.style.alignItems = 'flex-start';
    const pathEl = document.createElement('div');
    pathEl.textContent = candidate.outlinePath.join(' / ');
    row.appendChild(pathEl);
    if (candidate.documentId !== state.documentId) {
      const fileEl = document.createElement('div');
      fileEl.style.fontSize = '11px';
      fileEl.style.opacity = '0.6';
      fileEl.textContent = candidate.documentId;
      row.appendChild(fileEl);
    }
    row.onclick = () => performRefile(pendingRefile.heading, candidate.documentId, candidate.outlinePath);
    list.appendChild(row);
  }
  refilePanel.appendChild(list);

  const backRow = document.createElement('div');
  backRow.className = 'panel-row';
  backRow.style.marginTop = '6px';
  backRow.appendChild(
    menuButton('\u2039 Cancel', () => {
      pendingRefile = null;
      renderRefilePanel();
    })
  );
  refilePanel.appendChild(backRow);
}

/**
 * Moves `heading` (and its whole subtree) to become the LAST child of
 * the target identified by `targetDocumentId` + `targetOutlinePath` --
 * real org's own default refile insertion point. Same-file is a
 * simple splice-out/push-in plus a level-shift, mirroring
 * demoteHeading's own already-established pattern exactly. Cross-file
 * re-resolves the target against a FRESH read of that file (never the
 * possibly-stale docsById snapshot the picker itself was built from)
 * and uses the same write-target-before-remove-from-source transaction
 * safety archiveHeadingToLocation already established -- a failed
 * write to the target file leaves the source completely untouched.
 */
async function performRefile(heading, targetDocumentId, targetOutlinePath) {
  pendingRefile = null;
  renderRefilePanel();

  if (targetDocumentId === state.documentId) {
    const target = findHeadingByOutlinePath(state.doc, targetOutlinePath);
    if (!target) {
      setStatus('Could not refile: that target heading no longer exists (the outline may have changed).');
      return;
    }
    removeHeading(state.doc, heading);
    target.children.push(heading);
    target.collapsed = false;
    shiftLevels(heading, target.level + 1);
    commitAndRender('Refiled heading');
    setStatus(`Refiled to "${target.title}".`);
    return;
  }

  setStatus(`Refiling to ${targetDocumentId}\u2026`);
  const { ok, result: targetTitle } = await writeToOtherFile(targetDocumentId, {
    label: 'refile',
    allowMissing: false,
    mutate: (doc) => {
      const target = findHeadingByOutlinePath(doc, targetOutlinePath);
      if (!target) {
        setStatus(
          `Could not refile: that target heading no longer exists in "${targetDocumentId}" (it may have changed since this picker opened).`
        );
        return null;
      }
      target.children.push(heading);
      target.collapsed = false;
      shiftLevels(heading, target.level + 1);
      return target.title;
    },
  });
  if (!ok) return;

  // The write succeeded -- now, and only now, remove the original.
  removeHeading(state.doc, heading);
  commitAndRender('Refiled heading');
  setStatus(`Refiled to "${targetTitle}" in "${targetDocumentId}".`);
}

/** The human-readable "where this would go" label for confirming an
 *  archive. */
/** org-clock-in: starts the clock on `heading`, using the same "now"
 *  timestamp convention every other progress-logging entry in this app
 *  already uses. A no-op (with a status message, not silent) if a
 *  clock is already running on this heading -- clockIn itself already
 *  refuses this, this just surfaces it to the person instead of
 *  quietly doing nothing. */
/** org-clock-in: starts the clock on `heading`. If a DIFFERENT
 *  heading already has a clock running, it's auto-clocked-out first
 *  (at the exact same moment the new one starts, no gap) -- real
 *  org's own actual org-clock-in behavior, confirmed directly from
 *  its own docstring ("If necessary, clock-out of the currently
 *  active clock"), not a silent second, simultaneous clock left
 *  running elsewhere. A no-op (with a status message, not silent) if
 *  a clock is already running on THIS SAME heading -- real org
 *  doesn't let you double-start the same clock either, it just
 *  continues the existing session. */
function clockInHeading(heading) {
  const now = new Date();
  const timestamp = formatOrgTimestamp({ date: now, time: now.toTimeString().slice(0, 5), active: false });
  const { started, switchedFrom } = clockInSwitchingTasks(state.doc, heading, timestamp, now);
  if (!started) {
    setStatus('A clock is already running on this heading.');
    render();
    return;
  }
  commitAndRender(switchedFrom ? `Clocked in (stopped the clock on "${switchedFrom.title}")` : 'Clocked in');
}

/** org-clock-out: stops whatever clock is currently running on
 *  `heading`. A no-op (with a status message) if nothing is running --
 *  matches clockInHeading's own "surface it, don't silently do
 *  nothing" treatment of the equivalent already-in-that-state case. */
function clockOutHeading(heading) {
  const end = new Date();
  const timestamp = formatOrgTimestamp({ date: end, time: end.toTimeString().slice(0, 5), active: false });
  if (!clockOut(heading, timestamp, end)) {
    setStatus('No clock is currently running on this heading.');
    render();
    return;
  }
  commitAndRender('Clocked out');
}

/** org-clock-cancel: stops whatever clock is currently running on
 *  `heading` and discards its accumulated time entirely -- no
 *  duration ever gets recorded, unlike clockOutHeading. A no-op (with
 *  a status message) if nothing is running, matching clockOutHeading's
 *  own treatment of the equivalent already-in-that-state case. */
function clockCancelHeading(heading) {
  if (!clockCancel(heading)) {
    setStatus('No clock is currently running on this heading.');
    render();
    return;
  }
  commitAndRender('Clock cancelled \u2014 time discarded');
}

/** The action menu's own entry point for Clock out on a heading with a
 *  running clock -- always prompts rather than stopping directly,
 *  offering org-clock-cancel (discard the session entirely) as a
 *  genuine alternative to the normal completion, since accidentally
 *  starting the wrong clock or switching tasks without wanting the
 *  elapsed time logged is common enough to deserve its own one-tap
 *  option right there, not a separate hunt through the action menu. */
function openClockStopPrompt(heading) {
  pendingClockStop = { heading };
  renderClockStopPanel();
}

function renderClockStopPanel() {
  refilePanel.innerHTML = '';
  if (!pendingClockStop) {
    refilePanel.style.display = 'none';
    return;
  }
  refilePanel.style.display = 'block';

  const label = document.createElement('div');
  label.style.fontSize = '13px';
  label.style.marginBottom = '8px';
  label.textContent = `Stop the clock on "${pendingClockStop.heading.title || '(untitled)'}"?`;
  refilePanel.appendChild(label);

  const row = document.createElement('div');
  row.className = 'panel-row';
  row.appendChild(
    menuButton('Cancel', () => {
      const heading = pendingClockStop.heading;
      pendingClockStop = null;
      renderClockStopPanel();
      clockCancelHeading(heading);
    })
  );
  row.appendChild(
    menuButton('Stop', () => {
      const heading = pendingClockStop.heading;
      pendingClockStop = null;
      renderClockStopPanel();
      clockOutHeading(heading);
    })
  );
  row.appendChild(
    menuButton('OK', () => {
      pendingClockStop = null;
      renderClockStopPanel();
    })
  );
  refilePanel.appendChild(row);
}

function getArchiveDestinationLabel(heading) {
  const location = getArchiveLocation(state.doc, heading);
  const { filePart, headlinePart } = parseArchiveLocation(location);
  const targetFileId = resolveArchiveFileId(filePart, state.documentId);
  return targetFileId === null || targetFileId === state.documentId
    ? headlinePart.trim()
      ? `this file, under "${headlinePart.trim().replace(/^\*+\s*/, '')}"`
      : 'this file (top level)'
    : headlinePart.trim()
      ? `"${targetFileId}", under "${headlinePart.trim().replace(/^\*+\s*/, '')}"`
      : `"${targetFileId}" (top level)`;
}

/** The action menu's own entry point for Archive on a non-archived
 *  heading -- always shows the Refile/Cancel/OK prompt (unconditional
 *  now that org-archive-confirm has been removed), offering Refile as
 *  a genuine alternative right there rather than a plain OK/Cancel,
 *  since often the actual intent behind reaching for Archive is "get
 *  this out of my active outline," which Refile serves just as well
 *  for a destination that isn't the archive file specifically. */
function openArchiveConfirmPrompt(heading) {
  pendingArchiveConfirm = { heading };
  renderArchiveConfirmPanel();
}

function renderArchiveConfirmPanel() {
  refilePanel.innerHTML = '';
  if (!pendingArchiveConfirm) {
    refilePanel.style.display = 'none';
    return;
  }
  refilePanel.style.display = 'block';

  const label = document.createElement('div');
  label.style.fontSize = '13px';
  label.style.marginBottom = '8px';
  label.textContent = `Archive "${pendingArchiveConfirm.heading.title || '(untitled)'}" to ${getArchiveDestinationLabel(pendingArchiveConfirm.heading)}?`;
  refilePanel.appendChild(label);

  const row = document.createElement('div');
  row.className = 'panel-row';
  row.appendChild(
    menuButton('Refile\u2026', async () => {
      const heading = pendingArchiveConfirm.heading;
      pendingArchiveConfirm = null;
      renderArchiveConfirmPanel();
      await openRefilePicker(heading);
    })
  );
  row.appendChild(
    menuButton('Cancel', () => {
      pendingArchiveConfirm = null;
      renderArchiveConfirmPanel();
    })
  );
  row.appendChild(
    menuButton('OK', async () => {
      const heading = pendingArchiveConfirm.heading;
      pendingArchiveConfirm = null;
      renderArchiveConfirmPanel();
      await archiveHeadingToLocation(heading);
    })
  );
  refilePanel.appendChild(row);
}

async function archiveHeadingToLocation(heading) {
  const location = getArchiveLocation(state.doc, heading);
  const { filePart, headlinePart } = parseArchiveLocation(location);
  const targetFileId = resolveArchiveFileId(filePart, state.documentId);

  if (targetFileId === null || targetFileId === state.documentId) {
    // Same file: build the stamped copy, remove the original, insert
    // the copy at the target location, save -- one atomic in-memory
    // edit, no cross-file I/O risk to worry about.
    const clone = buildArchivedClone(state.doc, heading, state.documentId);
    removeHeading(state.doc, heading);
    insertAtArchiveLocation(state.doc, clone, headlinePart);
    commitAndRender('Archived heading');
    setStatus('--- Archive complete.');
    return;
  }

  setStatus(`Archiving to ${targetFileId}\u2026`);
  const clone = buildArchivedClone(state.doc, heading, state.documentId);
  const { ok } = await writeToOtherFile(targetFileId, {
    label: 'archive',
    allowMissing: true,
    mutate: (doc) => {
      insertAtArchiveLocation(doc, clone, headlinePart);
      return true;
    },
  });
  if (!ok) return;

  // The write succeeded -- now, and only now, remove the original.
  removeHeading(state.doc, heading);
  commitAndRender('Archived heading');
  setStatus(`--- Archive complete. (${targetFileId})`);
}

/**
 * Performs a full restore/unarchive: reads the archived heading's own
 * `ARCHIVE_FILE`/`ARCHIVE_OLPATH` properties to determine where it
 * originally came from, moves it back there, and strips the `:ARCHIVE:`
 * tag and all four `ARCHIVE_*` properties (via buildRestoredClone).
 *
 * Same write-before-remove transaction safety as archiveHeadingToLocation:
 * the destination is written FIRST (when it's a different file than the
 * one currently open), and the archived heading is only removed from
 * THIS file once that write has actually succeeded -- a network
 * failure or permission problem leaves the archived heading exactly
 * where it was, with a clear error, never silently lost.
 *
 * A heading with no recorded `ARCHIVE_FILE` (tagged `:ARCHIVE:` by
 * hand, or via the tag-toggle mechanism from an earlier version of
 * this app, rather than through org-archive-subtree) has nowhere
 * on record to be restored TO -- the honest behavior is to just strip
 * the tag/properties in place, at the top level of the file it's
 * already in, rather than guessing.
 */
async function unarchiveHeadingToOriginalLocation(heading) {
  const archiveFile = heading.properties.ARCHIVE_FILE || null;
  const archiveOlpath = heading.properties.ARCHIVE_OLPATH || '';
  const olpSegments = archiveOlpath ? archiveOlpath.split('/') : [];

  const destinationLabel = !archiveFile
    ? 'this file (no original location recorded \u2014 the archive tag will just be removed)'
    : archiveFile === state.documentId
      ? olpSegments.length > 0
        ? `this file, under "${olpSegments.join(' / ')}"`
        : 'this file (top level)'
      : olpSegments.length > 0
        ? `"${archiveFile}", under "${olpSegments.join(' / ')}"`
        : `"${archiveFile}" (top level)`;
  if (!window.confirm(`Restore "${heading.title}" to ${destinationLabel}?`)) {
    return;
  }

  if (!archiveFile || archiveFile === state.documentId) {
    // No recorded location, or the recorded location IS the currently
    // open file -- either way, this is a same-file, in-memory-only
    // operation with no cross-file I/O risk.
    const clone = buildRestoredClone(heading);
    removeHeading(state.doc, heading);
    if (olpSegments.length > 0) {
      const target = resolveOlpTarget(state.doc, olpSegments);
      target.children.push(clone);
      target.collapsed = false; // otherwise the just-restored item vanishes from view immediately
    } else {
      state.doc.children.push(clone);
    }
    commitAndRender('Restored (unarchived) heading');
    setStatus('--- Restore complete.');
    return;
  }

  setStatus(`Restoring to ${archiveFile}\u2026`);
  const clone = buildRestoredClone(heading);
  const { ok } = await writeToOtherFile(archiveFile, {
    label: 'restore',
    allowMissing: false,
    mutate: (doc) => {
      if (olpSegments.length > 0) {
        const target = resolveOlpTarget(doc, olpSegments);
        target.children.push(clone);
        target.collapsed = false;
      } else {
        doc.children.push(clone);
      }
      return true;
    },
  });
  if (!ok) return;

  // The write succeeded -- now, and only now, remove the archived
  // heading from THIS (the currently open, archive) file.
  removeHeading(state.doc, heading);
  commitAndRender('Restored (unarchived) heading');
  setStatus(`--- Restore complete. (${archiveFile})`);
}

const outlineEl = document.getElementById('outline');
const sidePanelEl = document.getElementById('sidePanel');

// Matches index.html's own @media (min-width: 900px) breakpoint exactly
// -- kept as a single named constant rather than two separately-typed
// "900px" literals in two different files, so a future change to one
// can't silently drift out of sync with the other.
const WIDE_LAYOUT_QUERY = '(min-width: 900px)';
function isWideLayout() {
  return window.matchMedia(WIDE_LAYOUT_QUERY).matches;
}

/** The element that's ACTUALLY scrollable right now -- #outline only
 *  gets its own overflow-y:auto inside the wide-layout (>=900px)
 *  media query; on the default, narrow/mobile layout it has no scroll
 *  behavior of its own at all, and #contentArea (the whole page's own
 *  scroll pane there) is what actually scrolls instead. Reading or
 *  writing outlineEl.scrollTop unconditionally is silently a no-op on
 *  mobile specifically -- the default, most common case, not an edge
 *  case -- since that element genuinely never scrolls there. */
function scrollContainer() {
  return isWideLayout() ? outlineEl : contentAreaEl;
}

// Which element Settings/Docs is CURRENTLY rendering into -- updated by
// renderSettingsView/renderDocsView themselves whenever called with an
// explicit target (see those functions below), so an internal
// re-render from deep inside settings (e.g. a theme button's own
// onclick calling renderSettingsView() with no argument, to reflect
// the just-changed value) automatically continues targeting wherever
// THIS open session actually put it -- #outline on a narrow layout,
// #sidePanel on a wide one -- rather than defaulting back to #outline
// unconditionally and silently rendering into the wrong place.
let settingsRenderTarget = outlineEl;
let docsRenderTarget = outlineEl;
const filenameEl = document.getElementById('filename');
const statusEl = document.getElementById('status');
const topBarEl = document.getElementById('topBar');
const contentAreaEl = document.getElementById('contentArea');
const addBtn = document.getElementById('addBtn');
const navBackBtn = document.getElementById('navBackBtn');
const extraMenuBtn = document.getElementById('extraMenuBtn');
const extraMenuPanel = document.getElementById('extraMenuPanel');
const viewMenuBtn = document.getElementById('viewMenuBtn');
const viewMenuPanel = document.getElementById('viewMenuPanel');
const fileMenuBtn = document.getElementById('fileMenuBtn');
const fileMenuPanel = document.getElementById('fileMenuPanel');
const settingsBtn = document.getElementById('settingsBtn');
const searchBtn = document.getElementById('searchBtn');
const searchPanel = document.getElementById('searchPanel');
const captureBtn = document.getElementById('captureBtn');
const capturePanel = document.getElementById('capturePanel');
const historyPanel = document.getElementById('historyPanel');
const doneNotePanel = document.getElementById('doneNotePanel');
const refilePanel = document.getElementById('refilePanel');
const externalChangeBanner = document.getElementById('externalChangeBanner');
const externalChangeText = document.getElementById('externalChangeText');
const externalChangeReloadBtn = document.getElementById('externalChangeReloadBtn');
const externalChangeDismissBtn = document.getElementById('externalChangeDismissBtn');
const moreBtn = document.getElementById('moreBtn');
const morePanel = document.getElementById('morePanel');

/**
 * Keeps the content area's top offset in sync with the fixed top bar's
 * actual rendered height. #topBar is `position: fixed` (real app-chrome
 * behavior — it must never scroll away, per explicit direction), which
 * takes it out of document flow entirely; without this, content behind
 * it would just be hidden underneath. The bar's height genuinely varies
 * (a File/View/Search panel opening or closing changes it, search
 * results growing/shrinking changes it), so a static CSS padding value
 * can't track it — this re-measures and re-applies on every call.
 * Cheap enough to call after every render/panel-toggle rather than try
 * to guess exactly when the height could have changed.
 */
// dvh tracks the ACTUAL visible viewport (correctly shrinking when an
// on-screen keyboard appears); vh stays pinned to the full keyboard-less
// screen height on most mobile browsers, which is what caused content to
// overflow past the visible area whenever, e.g., the search input got
// focused. Used wherever a JS-set inline style needs viewport-height
// units (CSS text can use the "declare twice, later one wins if
// understood" fallback trick directly; inline styles set via JS can't,
// so this checks support once instead).
const VH_UNIT = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('height', '1dvh') ? 'dvh' : 'vh';

function syncContentOffset() {
  const barHeight = topBarEl.offsetHeight;
  contentAreaEl.style.marginTop = barHeight + 'px';
  contentAreaEl.style.height = `calc(100% - ${barHeight}px)`;
}
window.addEventListener('resize', syncContentOffset);
// Crossing the wide-layout breakpoint (e.g. resizing a browser window,
// or rotating a tablet) while Settings/Docs is open needs a re-render
// to switch between "replace #outline" (narrow) and "side panel"
// (wide) modes -- a plain resize could fire many times without ever
// crossing the breakpoint, so this listens specifically for the
// breakpoint itself rather than re-rendering on every pixel of resize.
window.matchMedia(WIDE_LAYOUT_QUERY).addEventListener('change', () => render());

/** Every heading currently visible in the outline, in on-screen order --
 *  the pool keyboard-focus navigation (j/k, arrow keys) moves through.
 *  Respects current fold state via flattenVisibleRows, the same
 *  function the outline's own rendering uses, so keyboard nav never
 *  lands on a heading that isn't actually shown. */
function visibleHeadingsInOrder() {
  if (!state.doc) return [];
  return flattenVisibleRows(state.doc)
    .filter((row) => row.rowType === 'heading')
    .map((row) => row.node);
}

/** Moves keyboard focus by `delta` (+1/-1) among currently visible
 *  headings. No wraparound at either end -- staying put at a boundary
 *  is more predictable than silently jumping to the opposite end of a
 *  potentially long document. Scrolls the newly-focused heading into
 *  view, since it may not currently be on screen. */
function moveKeyboardFocus(delta) {
  const headings = visibleHeadingsInOrder();
  if (headings.length === 0) return;
  const currentIndex = keyboardFocusedHeading ? headings.indexOf(keyboardFocusedHeading) : -1;
  let nextIndex;
  if (currentIndex === -1) {
    nextIndex = delta > 0 ? 0 : headings.length - 1;
  } else {
    nextIndex = Math.max(0, Math.min(headings.length - 1, currentIndex + delta));
  }
  keyboardFocusedHeading = headings[nextIndex];
  render();
  requestAnimationFrame(() => {
    const el = document.getElementById('keyboard-focused-row');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  });
}

/**
 * Keyboard shortcuts, primarily aimed at non-touch devices where a
 * pointer-driven tap/swipe UI is a worse fit than it is on a phone.
 * Mostly real org-mode's own bindings, but NOT a faithful reproduction
 * of them: org leans heavily on the `C-c` prefix (`C-c C-t`, `C-c C-s`,
 * etc.), and `C-c`/`C-v`/`C-a`/`C-f` and friends are universally
 * reserved by every browser for copy/paste/select-all/find and cannot
 * be reliably intercepted from a web page — building on that prefix
 * would mean silently breaking copy-paste, not a reasonable tradeoff.
 * Real org's `M-\u2190`/`M-\u2192` (promote/demote) collide with the browser's
 * own back/forward navigation the same way. Where the direct org key is
 * actually safe to use (`Tab` for org-cycle, `M-\u2191`/`M-\u2193` for moving a
 * subtree) it's used as-is; everywhere else this substitutes a
 * different, safe key rather than pretending the conflict doesn't
 * exist. See the README's Keybindings section for the full table and
 * this same reasoning stated for a reader, not just a future editor of
 * this code.
 *
 * All of this is inert on a touch device in practice -- there's no
 * keyboard to press these on -- except a Bluetooth keyboard paired to a
 * tablet, a real if uncommon case these bindings work correctly for
 * too, same code path either way.
 */
document.addEventListener('keydown', (e) => {
  const activeTag = document.activeElement && document.activeElement.tagName;
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return; // never hijack actual typing; each field's own keydown handler (Escape to cancel, etc.) already owns this

  if (e.metaKey || e.ctrlKey) return; // Cmd/Ctrl combinations are the browser's own territory (new tab, save, find, ...) -- never treated as one of these shortcuts, avoiding a silent double-action

  if (e.key === '/') {
    e.preventDefault();
    if (!searchOpen) {
      searchOpen = true;
      renderSearchPanel();
    }
    const input = document.getElementById('search-query-input');
    if (input) input.focus();
    return;
  }

  if (e.key === 'Escape') {
    if (keyboardFocusedHeading) {
      e.preventDefault();
      keyboardFocusedHeading = null;
      render();
    }
    return;
  }

  if (currentView !== 'org' || !state.doc) return; // everything below acts on the outline specifically

  if (e.key === 'ArrowDown' || e.key === 'j') {
    e.preventDefault();
    moveKeyboardFocus(1);
    return;
  }
  if (e.key === 'ArrowUp' || e.key === 'k') {
    e.preventDefault();
    moveKeyboardFocus(-1);
    return;
  }
  if (e.key === 'n') {
    e.preventDefault();
    addBtn.click();
    return;
  }

  if (!keyboardFocusedHeading) return; // everything remaining needs a specific heading to act on

  if (e.key === 'Tab') {
    e.preventDefault();
    const archiveVisibility = getCycleOpenArchivedTrees(state.localVariables) ? 'noarchived' : 'archived';
    cycleFoldLevel(keyboardFocusedHeading, { archiveVisibility });
    render();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    toggleActionMenu(keyboardFocusedHeading);
  } else if (e.key === 't') {
    e.preventDefault();
    applyTodoTransition(keyboardFocusedHeading, () => toggleHeadingTodo(state.doc, keyboardFocusedHeading, GLOBAL_TODO_DEFAULT));
    commitAndRender('Toggled TODO');
  } else if (e.altKey && e.key === 'ArrowUp') {
    e.preventDefault();
    if (moveHeadingUp(state.doc, keyboardFocusedHeading)) commitAndRender('Moved heading up');
  } else if (e.altKey && e.key === 'ArrowDown') {
    e.preventDefault();
    if (moveHeadingDown(state.doc, keyboardFocusedHeading)) commitAndRender('Moved heading down');
  } else if (e.key === '[') {
    e.preventDefault();
    if (promoteHeading(state.doc, keyboardFocusedHeading)) commitAndRender('Promoted heading');
  } else if (e.key === ']') {
    e.preventDefault();
    if (demoteHeading(state.doc, keyboardFocusedHeading)) commitAndRender('Demoted heading');
  }
});
// Reacts to ANY change to topBar's rendered content (a panel opening/
// closing, its content changing, search results growing/shrinking) —
// deliberately not a list of "call this after every place that could
// change topBar," which would be one missed call site away from drifting
// out of sync again.
new MutationObserver(syncContentOffset).observe(topBarEl, { childList: true, subtree: true, attributes: true });

let state = { documentId: null, doc: null, startupConfig: null, storageKind: null, localVariables: null };
// File menu: whether the panel is open, and if so, which action's
// backend-choice sub-step is showing (null = the main New/Open/Save/Save
// As/Export list; otherwise 'open' | 'new' | 'saveas' | 'export').
let fileMenuOpen = false;
let fileMenuStep = null;
// Export sub-flow: which format was picked (null | 'markdown' | 'html'),
// tracked separately since the export flow has its own two steps
// (format, then scope) that don't fit the open/new/saveas
// backend-choice pattern the rest of the file menu already uses.
let exportFormat = null;
let exportPickingHeading = false;

// File-browser state: browseBackend non-null means the "open" step is
// currently showing a navigable folder/file listing (see startBrowsing
// below) instead of the plain New/Open/Save/Save As button row.
// browsePath is '' at the configured root, or a path within it (e.g.
// 'journal') when navigated into a subdirectory. browseEntries is null
// while loading, an array once loaded (possibly empty), or unchanged
// (stale, from before the error) if the load fails -- browseError is
// what actually signals the failure state, checked separately so a
// failed reload doesn't wipe out the previously-successful listing the
// user might still want to navigate via Back.
let browseBackend = null;
let browsePath = '';
let browseEntries = null;
let browseError = null;
let settingsOpen = false;
let docsOpen = false;
let searchOpen = false;
let captureOpen = false;
let extraMenuOpen = false;
// The template currently showing its prompt-answer form, or null when
// the capture panel is just showing the template list. Replaces
// window.prompt() for %^{Prompt} placeholders -- window.prompt is a
// native OS-level dialog with known reliability/layout problems in a
// PWA running in standalone display mode on mobile (which is exactly
// what surfaced as "capture has no usable UI" and scroll/visibility
// glitches); an in-app form sidesteps that entirely, being just an
// ordinary part of this app's own layout.
let capturePromptTemplate = null;
// True while a capture triggered by the extras (☰) menu is in progress
// -- that flow already knows exactly which template to use, so once
// it completes (success or cancel) the capture panel should close
// entirely rather than looping back to the "pick a template" picker
// grid the normal Capture button's own multi-capture flow shows,
// which the person never asked to see via the extras menu at all.
let captureOpenedFromExtraMenu = false;
let capturePromptValues = [];
let moreOpen = false;
let searchQuery = '';
let searchUseRegex = false; // deliberately NOT reset when the search panel closes, unlike searchQuery -- this is a mode preference, not a one-off query value
let viewMenuOpen = false;
// Agenda view state: which grouping is active, and the anchor date that
// grouping is centered/started on — prev/next navigation moves this
// anchor by one unit of whichever view is active (a day, a week, or a
// month), matching "scrolling by the view amount".
let agendaViewType = 'week'; // 'day' | 'week' | 'month'
let agendaAnchorDate = new Date();
let agendaLogMode = false; // whether LOGBOOK entries (state-change/note timestamps) show alongside SCHEDULED/DEADLINE/etc. -- off by default, matching real org's own org-agenda-log-mode convention exactly (a toggle, not always-on, so daily task-scanning doesn't get cluttered by default)
let showClockDisplay = false; // org-clock-display: whether each TODO-view item shows its own total clocked time (including its subtree) -- off by default, matching real org's own org-clock-display being an on-demand COMMAND (M-x org-clock-display), not something always shown
let showClocktable = false; // org-clock-report: whether the TODO view's own clocktable configuration section is expanded -- off by default, same reasoning as showClockDisplay above
let clocktableStart = '';
let clocktableEnd = '';
let clocktableMaxlevel = 2;
// Which heading (by object reference) currently has its title in edit
// mode, and whether it was just created (so an empty commit removes it
// instead of leaving a titleless heading behind).
let editingHeading = null;
let editingIsNew = false;
// { heading, table, rowIndex, colIndex } for the one table cell currently
// being edited, or null. `table` must always be a reference read fresh
// from the current render (see body-edit.js's module docstring).
let editingCell = null;
// { heading, paragraph } for the one paragraph currently being edited, or null.
let editingParagraph = null;
// { heading, item } for the one list item currently being text-edited, or null.
let editingListItem = null;
// The single heading whose combined multi-paragraph body text (per
// body-edit.js's getHeadingText/setHeadingText) is currently being edited
// as one block, or null. Distinct from editingParagraph, which still
// handles editing one specific paragraph row directly (e.g. a paragraph
// that comes after a list, outside this combined block's scope).
let editingHeadingText = null;
// The single heading whose general editor (SCHEDULED/DEADLINE, plain
// timestamp, tags, priority, properties -- all six committed together
// on Save, discarded together on Cancel) is currently open, or null.
let editingGeneral = null;
// The single heading or list-item node whose contextual action row is
// currently revealed (tap-to-reveal, per the interaction redesign — only
// one open at a time). Not the same as editingHeading/editingListItem:
// tapping the revealed pencil icon is what transitions into those.
let actionMenuFor = null;
// The heading currently focused via keyboard navigation (see the
// keydown listener near the bottom of this file) -- distinct from
// actionMenuFor, which is about a tap-revealed action row. null until
// the person actually uses a keyboard-navigation key (arrow/j/k),
// which is also the gate that gates the rest of the keyboard shortcuts
// -- Tab/Enter/etc. only act once a heading is actually focused, so
// a stray Tab press before ever engaging keyboard nav doesn't hijack
// normal browser focus-cycling for a keyboard/screen-reader user who
// never asked for org-style keyboard nav in the first place.
let keyboardFocusedHeading = null;
// The heading most recently navigated to via navigateToHeading (a
// search result, an internal link, an agenda item) -- tracked
// specifically so switching into the plain-text editor can land near
// that same content instead of always resetting to the top of the
// file. Not updated by manual scrolling/tapping within the outline
// itself; deliberately scoped to explicit "jump to X" navigation only.
let currentContextHeading = null;
// A stack of previously-visited headings, pushed by navigateToHeading
// itself before each jump -- lets a tapped link/footnote/search
// result/agenda item be followed on a mobile device (where there's no
// reliable, always-present browser Back the way desktop has) and then
// returned from via the floating back button, without needing to
// manually scroll back to wherever the tap originated. Capped so an
// unbroken chain of link-following doesn't grow this without limit.
let navigationBackStack = [];
const NAVIGATION_BACK_STACK_LIMIT = 20;
// Which of the three top-level views is showing: 'org' (the default
// outline), 'text' (the whole-document plain-text editor), or 'agenda'.
// While 'text', render() shows only a textarea; while 'agenda', render()
// shows the agenda list instead of the outline. Either way, none of the
// outline's tap-to-edit/reveal-menu state applies (and gets cleared when
// switching away from 'org').
let currentView = 'org';
// Whether the currently open document has edits that haven't been
// written to disk/GitHub/WebDAV yet — set true the moment any edit is
// committed, and cleared only after a successful Save/Save As, or when a
// document is freshly opened/created. Purely in-memory and synchronous
// (not read from the outbox asynchronously) so the indicator can update
// immediately, matching the app's existing optimistic-render approach.
let isDirty = false;
// The serialized content as of the most recent moment state.doc is
// known to exactly match what's confirmed saved to disk/remote --
// either just-opened-fresh (not a resumed, still-unsynced cache
// version), or a just-completed successful Save. null means no such
// moment has happened yet this session (nothing to compare against).
// Updated at every one of those moments; read by restoreFromHistory
// to correctly detect "this undo/redo/jump landed back on already-
// saved content" against an up-to-date baseline, rather than either
// always assuming dirty regardless of actual content, or comparing
// against a stale baseline from whenever the document was first
// opened, which would be wrong if a Save happened mid-session.
let lastSavedText = null;

// Undo/redo history for the CURRENTLY open document's editing session
// only -- reset every time a document is freshly opened (not persisted,
// not carried across a reopen, by explicit design choice: simpler and
// lower-risk than trying to make sense of undo history against a file
// that may have changed on disk since it was last open). See
// src/undo-history.js for the actual history model this wraps.
let history = createHistory('');
let historyOpen = false;
// Which theme's ('light' or 'dark') color-customization section is
// currently expanded in Settings -- null means both collapsed, the
// default, so the Appearance section stays as uncluttered as it
// currently is unless someone actually taps in to customize.
let expandedThemeColorSection = null;
// The active service-worker registration, once available -- stored
// here (not just closed over inside the registration callback) so
// Settings' own manual "Check for updates" button can call
// registration.update() on demand, not only the automatic checks.
let swRegistration = null;
let updateCheckStatus = null; // null | 'checking' | 'up-to-date' | 'found' | 'error'
let historyDiffExpandedIndex = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function startEditingTitle(heading, isNew) {
  editingHeading = heading;
  editingIsNew = isNew;
  render();
}

function commitTitleEdit(rawValue) {
  const heading = editingHeading;
  const isNew = editingIsNew;
  editingHeading = null;
  editingIsNew = false;

  const sanitized = String(rawValue).replace(/[\r\n]+/g, ' ').trim();
  if (sanitized === '' && isNew) {
    // User backed out of creating a heading without typing a title —
    // discard it rather than leave an empty heading behind.
    removeHeading(state.doc, heading);
    commitAndRender('Discarded empty new heading');
    return;
  }
  renameHeading(heading, sanitized);
  commitAndRender(isNew ? 'Added heading' : 'Edited heading title');
}

function cancelTitleEdit() {
  const heading = editingHeading;
  const isNew = editingIsNew;
  editingHeading = null;
  editingIsNew = false;
  if (isNew) {
    removeHeading(state.doc, heading);
    commitAndRender('Discarded empty new heading');
  } else {
    render();
  }
}

async function persist() {
  await saveDocument({ documentId: state.documentId, doc: state.doc, kvAdapter: kv });
}

// The fix for "every tap feels laggy": document-store.js's whole design is
// "writes apply to the kv cache instantly, offline-safe" — but the UI was
// awaiting that write (a full serialize + two sequential IndexedDB
// transactions: doc cache + outbox) before rendering anything at all,
// which defeats the point. render() reflects the already-mutated in-memory
// doc immediately; the storage write happens after, in the background.
// Errors still surface (via status text) rather than vanishing silently.
function persistInBackground() {
  isDirty = true;
  persist().catch((err) => setStatus('Save failed: ' + err.message));
}

function commitAndRender(label = 'Edited') {
  history = pushSnapshot(history, serializeOrg(state.doc), label);
  render();
  renderLogNotePrompt();
  persistInBackground();
}

/**
 * Restores state.doc from whichever history entry `history.index`
 * currently points at, after `history` has already been moved there
 * (by undo/redo/jumpTo) -- re-parses fresh and reapplies
 * startupConfig/localVariables, the same pattern
 * commitTextModeIfActive's own "reparse the whole doc" path already
 * uses. isDirty reflects the LANDED-ON content's actual state, not
 * just "an undo/redo/jump happened": if it exactly matches
 * lastSavedText (the most recent moment this document is known to
 * match what's confirmed saved), isDirty correctly clears, the same
 * as it would if the person had manually edited their way back to
 * identical content by hand. Undoing past every edit back to the
 * exact version already on disk genuinely doesn't need saving again --
 * claiming otherwise would be misleading, and would risk a real,
 * pointless write (or, worse, an unnecessary "resume unsaved edits?"
 * prompt on next open for content that turns out to be identical to
 * what's already there).
 *
 * Deliberately does NOT try to preserve fold state across the jump --
 * reapplying the document's own #+STARTUP visibility on every
 * undo/redo step is a stated simplification, not an oversight: the
 * alternative (matching which headings correspond to which across two
 * potentially very different trees, to carry fold state over) is real
 * complexity for a benefit that's mostly invisible day to day, and
 * "fold state resets" already matches how this app treats reopening a
 * file or switching documents elsewhere.
 */
function restoreFromHistory() {
  const entry = currentEntry(history);
  const newDoc = parseOrg(entry.text);
  const rawLocalVars = parseLocalVariables(entry.text);
  const startupConfig = resolveEffectiveStartupConfig(newDoc, rawLocalVars, globalVariables);
  const localVariables = mergeGlobalAndLocalVariables(globalVariables, rawLocalVars);
  const archiveVisibility = getCycleOpenArchivedTrees(localVariables) ? 'noarchived' : 'archived';
  applyStartupVisibility(newDoc, startupConfig, archiveVisibility);
  state.doc = newDoc;
  state.startupConfig = startupConfig;
  state.localVariables = localVariables;
  // Every heading object reference held anywhere (the navigation
  // back-stack in particular) is now stale -- a fresh parseOrg call
  // always produces brand new heading instances, even when re-parsing
  // what is nominally "the same" file (e.g. after an external change),
  // so this reset applies unconditionally, not just when switching to
  // a genuinely different document.
  navigationBackStack = [];
  currentContextHeading = null;
  syncNavBackButtonVisibility();
  isDirty = lastSavedText === null || entry.text !== lastSavedText;
  if (currentView === 'text') currentView = 'org'; // avoid showing now-stale textarea content after a jump
  render();
  persistInBackground();
}

function performUndo() {
  if (!canUndo(history)) {
    setStatus('Nothing to undo.');
    return;
  }
  const undoneLabel = currentEntry(history).label; // the step we're about to leave
  history = undo(history);
  restoreFromHistory();
  setStatus(`Undid: ${undoneLabel}`);
}

function performRedo() {
  if (!canRedo(history)) {
    setStatus('Nothing to redo.');
    return;
  }
  history = redo(history);
  restoreFromHistory();
  setStatus(`Redid: ${currentEntry(history).label}`);
}

/** Renders a diffHunks() result as colored added/removed/same lines,
 *  with a visual gap between non-adjacent hunks -- the actual "show
 *  what changed" view for a single history entry, diffed against the
 *  entry immediately before it (what that one edit actually did, not
 *  a diff against the file's current live state). */
function renderDiffView(oldText, newText) {
  const wrap = document.createElement('div');
  wrap.style.fontFamily = 'ui-monospace, monospace';
  wrap.style.fontSize = '12px';
  wrap.style.background = 'var(--surface, #f6f6f6)';
  wrap.style.borderRadius = '6px';
  wrap.style.padding = '6px 8px';
  wrap.style.margin = '4px 0 8px';
  wrap.style.overflowX = 'auto';
  wrap.style.whiteSpace = 'pre';

  const hunks = diffHunks(oldText, newText, 1);
  if (hunks.length === 0) {
    wrap.textContent = '(no textual difference)';
    wrap.style.fontStyle = 'italic';
    wrap.style.opacity = '0.6';
    return wrap;
  }

  hunks.forEach((hunk, hunkIndex) => {
    if (hunkIndex > 0) {
      const gap = document.createElement('div');
      gap.textContent = '\u22ee';
      gap.style.opacity = '0.4';
      wrap.appendChild(gap);
    }
    for (const op of hunk.lines) {
      const lineEl = document.createElement('div');
      const prefix = op.type === 'added' ? '+ ' : op.type === 'removed' ? '\u2212 ' : '  ';
      lineEl.textContent = prefix + op.line;
      if (op.type === 'added') {
        lineEl.style.color = '#227a1e';
        lineEl.style.background = '#dcf0d8';
      } else if (op.type === 'removed') {
        lineEl.style.color = '#a02020';
        lineEl.style.background = '#fde3e3';
      } else {
        lineEl.style.opacity = '0.6';
      }
      wrap.appendChild(lineEl);
    }
  });
  return wrap;
}

function renderHistoryPanel() {
  historyPanel.innerHTML = '';
  if (!historyOpen) {
    historyPanel.style.display = 'none';
    return;
  }
  historyPanel.style.display = 'block';

  const title = document.createElement('div');
  title.className = 'panel-section-title';
  title.textContent = 'History';
  historyPanel.appendChild(title);

  const stepRow = document.createElement('div');
  stepRow.className = 'panel-row';
  stepRow.appendChild(
    menuButton('\u2039 Undo', () => {
      performUndo();
      renderHistoryPanel();
    }, !canUndo(history))
  );
  stepRow.appendChild(
    menuButton('Redo \u203a', () => {
      performRedo();
      renderHistoryPanel();
    }, !canRedo(history))
  );
  historyPanel.appendChild(stepRow);

  const hint = document.createElement('div');
  hint.style.fontSize = '11px';
  hint.style.opacity = '0.6';
  hint.style.margin = '4px 0';
  hint.textContent = 'Tap an entry to jump there. Tap "diff" to see what that step actually changed.';
  historyPanel.appendChild(hint);

  const list = document.createElement('div');
  list.style.maxHeight = '340px';
  list.style.overflowY = 'auto';

  history.entries.forEach((entry, idx) => {
    const row = document.createElement('div');
    row.style.padding = '6px 4px';
    row.style.borderBottom = '1px solid var(--border)';
    row.style.cursor = 'pointer';
    row.style.opacity = idx > history.index ? '0.55' : '1'; // "future" (redo-available) entries shown dimmer

    const line = document.createElement('div');
    line.style.display = 'flex';
    line.style.alignItems = 'center';
    line.style.gap = '6px';

    const marker = document.createElement('span');
    marker.textContent = idx === history.index ? '\u25cf' : '\u25cb';
    marker.style.fontSize = '10px';
    marker.style.color = idx === history.index ? 'var(--accent)' : 'var(--text-muted, #888)';
    line.appendChild(marker);

    const label = document.createElement('span');
    label.textContent = entry.label;
    label.style.flex = '1';
    label.style.fontWeight = idx === history.index ? '600' : '400';
    line.appendChild(label);

    const time = document.createElement('span');
    time.textContent = entry.timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    time.style.fontSize = '11px';
    time.style.opacity = '0.6';
    line.appendChild(time);

    if (idx > 0) {
      const diffBtn = document.createElement('span');
      diffBtn.textContent = 'diff';
      diffBtn.style.fontSize = '11px';
      diffBtn.style.opacity = '0.7';
      diffBtn.style.textDecoration = 'underline';
      diffBtn.style.marginLeft = '4px';
      diffBtn.onclick = (e) => {
        e.stopPropagation();
        historyDiffExpandedIndex = historyDiffExpandedIndex === idx ? null : idx;
        renderHistoryPanel();
      };
      line.appendChild(diffBtn);
    }

    row.appendChild(line);
    row.onclick = () => {
      history = jumpTo(history, idx);
      restoreFromHistory();
      setStatus(`Jumped to: ${entry.label}`);
      renderHistoryPanel();
    };

    if (historyDiffExpandedIndex === idx && idx > 0) {
      row.appendChild(renderDiffView(history.entries[idx - 1].text, entry.text));
    }

    list.appendChild(row);
  });

  historyPanel.appendChild(list);
}

/**
 * If the plain-text editor is currently showing, commits its current
 * content into state.doc — reparsing fresh, exactly like exiting text
 * mode normally does — and returns to outline view. Returns true if it
 * actually did something.
 *
 * This is the fix for a real, major bug: state.doc only ever got updated
 * with the textarea's content when the user explicitly clicked the
 * Text/Outline toggle button to exit text mode. Every save/open/new
 * operation read state.doc directly — so hitting Save (or Save As, or
 * opening a different file) while still in text mode read the STALE
 * pre-edit document, silently discarding whatever was typed in the
 * textarea, while still reporting success. Calling this at the start of
 * every such operation ensures state.doc always reflects what's actually
 * on screen before anything reads it.
 */
function commitTextModeIfActive() {
  if (currentView !== 'text') return false;
  const textarea = document.getElementById('document-text-edit-input');
  const newText = textarea ? textarea.value : serializeOrg(state.doc);
  const newDoc = parseOrg(newText);
  const rawLocalVars = parseLocalVariables(newText);
  const startupConfig = resolveEffectiveStartupConfig(newDoc, rawLocalVars, globalVariables);
  const localVariables = mergeGlobalAndLocalVariables(globalVariables, rawLocalVars);
  const archiveVisibility = getCycleOpenArchivedTrees(localVariables) ? 'noarchived' : 'archived';
  applyStartupVisibility(newDoc, startupConfig, archiveVisibility);
  state.doc = newDoc;
  state.startupConfig = startupConfig;
  state.localVariables = localVariables;
  // Every heading object reference held anywhere (the navigation
  // back-stack in particular) is now stale -- a fresh parseOrg call
  // always produces brand new heading instances, even when re-parsing
  // what is nominally "the same" file (e.g. after an external change),
  // so this reset applies unconditionally, not just when switching to
  // a genuinely different document.
  navigationBackStack = [];
  currentContextHeading = null;
  syncNavBackButtonVisibility();
  currentView = 'org';
  history = pushSnapshot(history, newText, 'Edited in text mode');
  return true;
}

// Marks every link/image-produced DOM element so container click handlers
// (checkbox-cycle on a list-item row, edit-on-click on a paragraph) can
// detect "this click landed on a link, don't also trigger my own handler"
// via a single e.target.closest('[data-inline-link]') check, rather than
// each link type needing its own stopPropagation wiring.
const INLINE_LINK_ATTR = 'data-inline-link';

// Cache of resolved image data: URLs, keyed by backend+path -- avoids
// re-fetching the same image on every re-render (this app re-renders
// the whole outline on any state change) and avoids a
// placeholder-then-image flash on every subsequent render once an
// image has already loaded once this session. Cleared implicitly by a
// page reload; not persisted, since a stale cached image across a
// full app restart isn't worth the complexity of invalidation logic
// for what's ultimately just avoiding a redundant network request.
const imageDataUrlCache = new Map();

function imagePlaceholder(target, reason) {
  const span = document.createElement('span');
  span.textContent = reason ? `[image: ${target} \u2014 ${reason}]` : `[image: ${target}]`;
  span.style.color = 'var(--text-muted, #888)';
  span.style.fontStyle = 'italic';
  return span;
}

function renderImageNode(node) {
  const inlineImagesOn = state.startupConfig && state.startupConfig.imageVisibility === 'inlineimages';

  if (inlineImagesOn && /^https?:\/\//i.test(node.target)) {
    const img = document.createElement('img');
    img.src = node.target;
    img.alt = '';
    img.style.maxWidth = '100%';
    img.style.display = 'block';
    img.style.margin = '4px 0';
    img.style.borderRadius = '4px';
    return img;
  }

  // A local/relative image, or an explicit file:/github:/webdav:
  // scheme -- only resolvable to real pixels when the CURRENT
  // document's own backend can read an arbitrary path without a fresh
  // picker gesture (GitHub, WebDAV). Local filesystem/iOS import hit
  // the same File System Access permission wall already documented for
  // archiving and capture-to-file, so those keep the honest placeholder
  // below rather than attempting (and failing) a read.
  const canReadArbitraryPaths = state.storageKind === 'github' || state.storageKind === 'webdav';
  if (inlineImagesOn && canReadArbitraryPaths && !isExternalUrl(node.target)) {
    const resolvedPath = resolveImagePath(node.target, state.documentId);
    const cacheKey = state.storageKind + ':' + resolvedPath;

    const img = document.createElement('img');
    img.alt = node.target;
    img.style.maxWidth = '100%';
    img.style.display = 'block';
    img.style.margin = '4px 0';
    img.style.borderRadius = '4px';

    if (imageDataUrlCache.has(cacheKey)) {
      img.src = imageDataUrlCache.get(cacheKey);
      return img;
    }

    // Not loaded yet -- show a placeholder box immediately (avoiding a
    // zero-height flash), then swap in the real image once the async
    // read resolves.
    img.style.minHeight = '24px';
    img.style.background = 'var(--surface)';

    const adapter = activeDiskAdapter();
    adapter
      .readBinary(resolvedPath)
      .then((result) => {
        if (!result) {
          img.replaceWith(imagePlaceholder(node.target, 'not found'));
          return;
        }
        const dataUrl = `data:${guessImageMimeType(resolvedPath)};base64,${result.base64}`;
        imageDataUrlCache.set(cacheKey, dataUrl);
        img.src = dataUrl;
        img.style.background = '';
        img.style.minHeight = '';
      })
      .catch((err) => {
        img.replaceWith(imagePlaceholder(node.target, err.message));
      });

    return img;
  }

  // Either inline images are off (#+STARTUP: noinlineimages, the
  // default) or this is a local/relative path on a backend that can't
  // read an arbitrary path without a fresh picker gesture.
  return imagePlaceholder(node.target);
}

function renderLinkNode(node, linkContext = null) {
  const label = node.description || node.target;
  const targetDoc = linkContext ? linkContext.doc : state.doc;
  const resolution = resolveLinkTarget(targetDoc, node.target);

  if (resolution.type === 'external') {
    const a = document.createElement('a');
    a.href = resolution.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    a.style.color = 'var(--accent)';
    a.setAttribute(INLINE_LINK_ATTR, '1');
    return a;
  }

  if (resolution.type === 'heading') {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = label;
    a.style.color = 'var(--accent)';
    a.setAttribute(INLINE_LINK_ATTR, '1');
    a.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (linkContext) {
        linkContext.onHeadingLinkClick(resolution.heading);
      } else {
        navigateToHeading(resolution.heading);
      }
    };
    return a;
  }

  if (resolution.type === 'file' && !linkContext) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = label;
    a.style.color = 'var(--accent)';
    a.setAttribute(INLINE_LINK_ATTR, '1');
    a.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFileLink(resolution);
    };
    return a;
  }

  // Unresolved: e.g. a *Heading or #custom-id link with no matching
  // heading (renamed heading, typo, or a link meant for a different
  // file) -- or a file:/github:/webdav: link encountered while a
  // linkContext is active (a read-only overlay like Docs deliberately
  // never switches the active document). Shown distinctly rather than
  // silently rendered as plain text, since "this link is broken" is
  // useful information.
  const span = document.createElement('span');
  span.textContent = label;
  span.style.color = 'var(--text-muted, #888)';
  span.style.textDecoration = 'underline wavy';
  span.title = 'Unresolved link: ' + node.target;
  span.setAttribute(INLINE_LINK_ATTR, '1');
  return span;
}

/** A bare [fn:label] footnote reference: tappable, jumping to (and
 *  highlighting) wherever the actual definition lives in the document
 *  -- reusing findFootnoteDefinition the same way renderLinkNode reuses
 *  resolveLinkTarget. In the main app, jumps with navigateToHeading's
 *  own targetNode precision (the exact paragraph/list-item, not just
 *  the right heading); in a linkContext (the read-only Docs view),
 *  falls back to the heading-level onHeadingLinkClick unless a more
 *  precise onFootnoteRefClick was explicitly provided -- Docs' own
 *  content doesn't currently use footnotes, so this is a deliberately
 *  simpler fallback rather than building full paragraph-level jump
 *  precision for a case that isn't actually exercised there yet.
 *  Unresolved (no definition found anywhere) renders inert, matching
 *  renderLinkNode's own "no dead-end click target" convention. */
function renderFootnoteRefNode(node, linkContext = null) {
  const targetDoc = linkContext ? linkContext.doc : state.doc;
  const result = findFootnoteDefinition(targetDoc, node.label);
  const sup = document.createElement('sup');
  sup.textContent = '[' + node.label + ']';
  sup.setAttribute(INLINE_LINK_ATTR, '1');
  if (!result) {
    sup.style.color = 'var(--text-muted, #888)';
    sup.title = 'No definition found for footnote "' + node.label + '"';
    return sup;
  }
  sup.style.color = 'var(--accent)';
  sup.style.cursor = 'pointer';
  sup.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (linkContext) {
      if (linkContext.onFootnoteRefClick) linkContext.onFootnoteRefClick(result);
      else linkContext.onHeadingLinkClick(result.heading);
    } else {
      navigateToHeading(result.heading, { revealOwnBody: true, targetNode: result.node });
    }
  };
  return sup;
}

/** An inline [fn:label:definition] (or anonymous [fn::definition]):
 *  shows the actual definition text right there, styled distinctly
 *  (smaller, italic, a superscript label) rather than making it
 *  something to tap and jump to -- it already IS the definition, not a
 *  reference to one elsewhere. */
function renderFootnoteDefNode(node, linkContext = null) {
  const wrap = document.createElement('span');
  const labelEl = document.createElement('sup');
  labelEl.textContent = node.label ? '[' + node.label + ']' : '[*]';
  labelEl.style.color = 'var(--text-muted, #888)';
  wrap.appendChild(labelEl);
  const content = document.createElement('span');
  content.style.fontSize = '0.9em';
  content.style.fontStyle = 'italic';
  content.style.opacity = '0.85';
  renderInlineNodes(node.children, content, linkContext);
  wrap.appendChild(content);
  return wrap;
}

/** Inline-parsing options reflecting the current document's Local
 *  Variables -- currently just subSuperscriptMode, but centralized here
 *  so a future option doesn't need updating at every parseInline call
 *  site individually. */
function currentInlineOpts() {
  return { subSuperscriptMode: getUseSubSuperscripts(state.localVariables) };
}

/** Renders a parseInline() node array into `container`. Recurses into
 *  emphasis spans' children; code/verbatim/comment/image/link are leaves. */
function renderInlineNodes(nodes, container, linkContext = null) {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        container.appendChild(document.createTextNode(node.value));
        break;
      case 'bold': {
        const el = document.createElement('b');
        renderInlineNodes(node.children, el, linkContext);
        container.appendChild(el);
        break;
      }
      case 'italic': {
        const el = document.createElement('i');
        renderInlineNodes(node.children, el, linkContext);
        container.appendChild(el);
        break;
      }
      case 'underline': {
        const el = document.createElement('u');
        renderInlineNodes(node.children, el, linkContext);
        container.appendChild(el);
        break;
      }
      case 'strikethrough': {
        const el = document.createElement('s');
        renderInlineNodes(node.children, el, linkContext);
        container.appendChild(el);
        break;
      }
      case 'code':
      case 'verbatim': {
        const el = document.createElement('code');
        el.textContent = node.value;
        el.style.background = 'rgba(128,128,128,0.15)';
        el.style.padding = '1px 4px';
        el.style.borderRadius = '3px';
        el.style.fontSize = '0.9em';
        container.appendChild(el);
        break;
      }
      case 'subscript': {
        const el = document.createElement('sub');
        el.textContent = node.value;
        container.appendChild(el);
        break;
      }
      case 'superscript': {
        const el = document.createElement('sup');
        el.textContent = node.value;
        container.appendChild(el);
        break;
      }
      case 'image':
        container.appendChild(renderImageNode(node));
        break;
      case 'link':
        container.appendChild(renderLinkNode(node, linkContext));
        break;
      case 'footnote-ref':
        container.appendChild(renderFootnoteRefNode(node, linkContext));
        break;
      case 'footnote-def':
        container.appendChild(renderFootnoteDefNode(node, linkContext));
        break;
      case 'comment':
        // Org excludes comments from rendered/exported output; skipped here too.
        break;
      default:
        container.appendChild(document.createTextNode(node.value || ''));
    }
  }
}

/** Expands every ancestor of `heading` (so it isn't hidden inside a
 *  collapsed parent), re-renders, then scrolls the now-visible row into
 *  view with a brief highlight. */
/** Expands every ancestor of `heading` (so it isn't hidden inside a
 *  collapsed parent), re-renders, then scrolls the now-visible row into
 *  view with a brief highlight.
 *
 *  `revealOwnBody` also clears `heading`'s own `collapsed`/`bodyHidden` —
 *  needed when the thing being navigated to is inside the heading's own
 *  body content (a search match in a paragraph/list item/table), not
 *  just the heading itself. Without this, navigating to a body-content
 *  match under `#+STARTUP: content` could "succeed" (scroll to the right
 *  heading) while the actual matched content stayed invisible, since
 *  expanding ancestors alone doesn't touch the target heading's own
 *  bodyHidden flag.
 *
 *  `targetNode` (defaults to `heading`) is which specific row to scroll
 *  to and highlight — pass the actual paragraph/list-item/table node for
 *  a body-content search result, to land precisely on the match rather
 *  than just its heading. */
/**
 * Toggles the action menu for `node` (a heading, list item, table, or
 * paragraph — whichever matches what flattenVisibleRows produces for
 * it), and — only when actually opening, not closing — scrolls the
 * newly-revealed row+menu combination fully into view.
 *
 * This matters specifically for a row near the bottom of the viewport:
 * the action menu renders BELOW the row it belongs to, so without an
 * explicit scroll, tapping a row near the bottom could open a menu that
 * ends up partially or entirely below the visible area, with nothing
 * about the tap itself bringing it into view.
 *
 * Reuses the same row-index-into-outlineEl.children mapping
 * navigateToHeading relies on elsewhere, since withActionMenu wraps a
 * row and its menu together into one element — scrolling that ONE
 * element into view covers both the row and whatever menu is now
 * showing beneath it, not just the row itself.
 */
function toggleActionMenu(node) {
  const opening = actionMenuFor !== node;
  actionMenuFor = opening ? node : null;
  render();

  if (!opening) return;
  requestAnimationFrame(() => {
    const rows = flattenVisibleRows(state.doc);
    const idx = rows.findIndex((r) => (r.rowType === 'list-item' ? r.item === node : r.node === node));
    if (idx === -1 || !outlineEl.children[idx]) return;
    outlineEl.children[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

/** Shows/hides the floating back button based on whether there's
 *  actually anywhere to go back to -- called after every navigation
 *  (both a forward jump, which may have just pushed a new entry, and
 *  a back-navigation itself, which may have just emptied the stack). */
function syncNavBackButtonVisibility() {
  navBackBtn.style.display = navigationBackStack.length > 0 ? 'flex' : 'none';
}

function navigateToHeading(heading, { revealOwnBody = false, targetNode = heading } = {}) {
  navigationBackStack.push({ view: currentView, docsOpen, scrollTop: scrollContainer().scrollTop });
  if (navigationBackStack.length > NAVIGATION_BACK_STACK_LIMIT) navigationBackStack.shift();
  currentContextHeading = heading;
  syncNavBackButtonVisibility();
  // Always land in the outline — a caller (search, an internal link,
  // agenda) shouldn't each need to remember this. Safe to call even when
  // already in 'org': switchToView no-ops in that case rather than
  // re-rendering redundantly, and the render() below always runs anyway
  // to reflect the collapsed-state changes just made.
  if (currentView !== 'org') switchToView('org');

  for (const ancestor of findAncestorPath(state.doc, heading) || []) {
    ancestor.collapsed = false;
  }
  if (revealOwnBody) {
    heading.collapsed = false;
    heading.bodyHidden = false;
    heading.drawersHidden = false;
  }
  render();

  requestAnimationFrame(() => {
    const rows = flattenVisibleRows(state.doc);
    const idx = rows.findIndex((r) => (r.rowType === 'list-item' ? r.item === targetNode : r.node === targetNode));
    if (idx === -1 || !outlineEl.children[idx]) return;
    const el = outlineEl.children[idx];
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const original = el.style.backgroundColor;
    el.style.transition = 'background-color 1.2s';
    el.style.backgroundColor = 'rgba(24,95,165,0.15)';
    setTimeout(() => {
      el.style.backgroundColor = original;
    }, 2400);
  });
}

/** Pops the most recent entry off the navigation back-stack and
 *  restores that view and scroll position -- unlike navigateToHeading,
 *  this doesn't target a specific heading at all, since the point
 *  navigated away from often wasn't one (organic scrolling, or a link
 *  tapped from a non-'org' view like Docs). A no-op if the stack is
 *  empty (the floating back button isn't shown in that case anyway,
 *  but this stays safe to call regardless). */
async function navigateBack() {
  const target = navigationBackStack.pop();
  if (!target) return;

  if (target.settingsOpen && !settingsOpen) {
    // The jump away (a Quick Settings help link, or the Capture
    // Templates reference link) came FROM Settings -- return there,
    // closing Docs in the process, rather than falling through to the
    // docsOpen/view restoration below (which has no notion of
    // Settings at all).
    docsOpen = false;
    settingsOpen = true;
    if (isWideLayout()) {
      sidePanelEl.style.display = 'block';
      await renderSettingsView(sidePanelEl);
      render();
    } else {
      await renderSettingsView(outlineEl);
    }
  } else if (target.docsOpen && !docsOpen) {
    // The jump away closed Docs (navigateToHeading's own switchToView
    // forces 'org' and closes it) -- reopen and re-render it before
    // restoring scroll, the same sequence the "?" button itself uses.
    docsOpen = true;
    if (isWideLayout()) {
      sidePanelEl.style.display = 'block';
      await renderDocsView(sidePanelEl);
      render();
    } else {
      await renderDocsView(outlineEl);
    }
  } else if (target.view !== currentView) {
    switchToView(target.view);
  }

  requestAnimationFrame(() => {
    scrollContainer().scrollTop = target.scrollTop;
  });
  syncNavBackButtonVisibility();
}

// Slide-left gesture: cycles a heading through the three fold levels
// (collapsed -> one level -> fully expanded -> collapsed). Uses Pointer
// Events rather than separate touch/mouse handlers — one code path for
// touch, mouse, and pen, and Chromium (already required for File System
// Access) supports it fully. Never calls preventDefault, so normal
// vertical scrolling of the outline is completely unaffected; the
// direction/distance check is what tells a swipe apart from a scroll,
// not blocking the browser's own gesture handling.
const SWIPE_THRESHOLD_PX = 40;

function attachSlideLeftToFold(el, heading, opts = {}) {
  const onFolded = opts.onFolded || render;
  const archiveVisibility =
    opts.archiveVisibility || (getCycleOpenArchivedTrees(state.localVariables) ? 'noarchived' : 'archived');
  let startX = null;
  let startY = null;
  let active = false;

  el.addEventListener('pointerdown', (e) => {
    // Don't hijack taps meant for an actual control (fold button, TODO
    // badge, title, add/delete buttons, links) — only bare row space and
    // plain text starts a swipe candidate.
    if (e.target.closest('button, a, input, textarea, [data-inline-link]')) return;
    startX = e.clientX;
    startY = e.clientY;
    active = true;
  });

  const finish = (e) => {
    if (!active) return;
    active = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const isLeftSwipe = dx < -SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.5;
    if (!isLeftSwipe) return;
    cycleFoldLevel(heading, { archiveVisibility });
    onFolded();
  };

  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', () => {
    active = false;
  });
}

function smallButton(label, ariaLabel, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.setAttribute('aria-label', ariaLabel);
  btn.style.fontSize = '11px';
  btn.style.padding = '2px 6px';
  btn.onclick = onClick;
  return btn;
}

// "Has content" for the delete-confirmation decision: sub-headings and/or
// any body content (notes, lists, tables, blocks). An empty heading — the
// common case right after creating one and backing out, or a placeholder
// that was never filled in — deletes immediately with no prompt; anything
// with real content underneath it gets one.
function headingHasContent(heading) {
  return (
    (heading.children && heading.children.length > 0) ||
    (heading.body && heading.body.length > 0) ||
    heading.todo !== null ||
    heading.priority !== null ||
    (heading.tags && heading.tags.length > 0) ||
    (heading.propertyOrder && heading.propertyOrder.length > 0) ||
    (heading.logbookLines && heading.logbookLines.length > 0) ||
    Boolean(heading.planning && (heading.planning.scheduled || heading.planning.deadline))
  );
}

function confirmHeadingDelete(heading) {
  if (!headingHasContent(heading)) return true;
  const parts = [];
  if (heading.children.length) {
    parts.push(`${heading.children.length} sub-heading${heading.children.length === 1 ? '' : 's'}`);
  }
  if (heading.body.length) parts.push('notes/lists/tables');
  if (heading.todo !== null) parts.push(`its "${heading.todo}" state`);
  if (heading.priority !== null) parts.push('a priority');
  if (heading.tags && heading.tags.length) parts.push(`tags (${heading.tags.join(', ')})`);
  if (heading.propertyOrder && heading.propertyOrder.length) parts.push('properties');
  if (heading.logbookLines && heading.logbookLines.length) parts.push('a state-change/note history');
  if (heading.planning && (heading.planning.scheduled || heading.planning.deadline)) parts.push('a scheduled/deadline date');
  const title = heading.title || '(untitled)';
  return window.confirm(
    `Delete "${title}"? It has ${parts.join(', ')}, which will be lost.`
  );
}

// Contextual action row shown below a heading/list-item when its text has
// been tapped. `actions` is [{ icon, label, onClick }]. Icons are the only
// differentiator between actions — deliberately no color coding (e.g. no
// "delete is red"), since the request was specifically for icon-based
// distinction, not color-based.
const TIME_UNIT_OPTIONS = [
  ['h', 'Hour(s)'],
  ['d', 'Day(s)'],
  ['w', 'Week(s)'],
  ['m', 'Month(s)'],
  ['y', 'Year(s)'],
];
const REPEATER_MARK_OPTIONS = [
  ['', 'No repeat'],
  ['+', 'Every'],
  ['++', 'Every (catch-up)'],
  ['.+', 'Every (from completion)'],
];

function textInputStyle(el) {
  el.style.width = '100%';
  el.style.maxWidth = '100%';
  el.style.minWidth = '0';
  el.style.minHeight = '40px';
  el.style.fontSize = '16px';
  el.style.padding = '6px 8px';
  el.style.boxSizing = 'border-box';
  el.style.border = '1px solid var(--border-strong)';
  el.style.borderRadius = '6px';
  el.style.background = 'var(--bg)';
  el.style.color = 'var(--fg)';
  el.style.font = 'inherit';
}

function fieldRow(labelText, inputEl) {
  const row = document.createElement('div');
  row.style.marginBottom = '8px';
  row.style.boxSizing = 'border-box';
  row.style.width = '100%';
  row.style.maxWidth = '100%';
  const l = document.createElement('label');
  l.textContent = labelText;
  l.style.fontSize = '12px';
  l.style.opacity = '0.75';
  l.style.display = 'block';
  l.style.marginBottom = '2px';
  row.appendChild(l);
  row.appendChild(inputEl);
  return row;
}

/**
 * A structured SCHEDULED/DEADLINE editor: real date/time pickers, a
 * repeater (mark + amount + unit), and a delay/warning period — instead
 * of a plain text box the user has to know org's raw timestamp syntax
 * to use correctly. Shared by both SCHEDULED and DEADLINE editing (see
 * the heading action menu's Timestamp action), since they're
 * structurally identical fields with only the label differing.
 *
 * Returns { container, getRawValue() } — getRawValue() returns null if
 * the group's checkbox is unchecked or its date is empty (meaning "clear
 * this timestamp"), otherwise a valid org timestamp string built via
 * formatOrgTimestamp from whatever the fields currently hold.
 */
function buildTimestampFieldGroup(label, currentRaw) {
  const parsed = currentRaw ? parseOrgTimestamp(currentRaw) : null;
  const repeaterParsed = parsed && parsed.repeater ? parseRepeater(parsed.repeater) : null;
  const repeaterMarkParsed = parsed && parsed.repeater ? parsed.repeater.match(/^[.+]+/)[0] : '';
  const delayParsed = parsed && parsed.delay ? parseDelay(parsed.delay) : null;

  const wrap = document.createElement('div');
  wrap.style.border = '0.5px solid var(--border-strong)';
  wrap.style.borderRadius = '8px';
  wrap.style.padding = '10px';
  wrap.style.marginBottom = '10px';
  wrap.style.boxSizing = 'border-box';
  wrap.style.width = '100%';
  wrap.style.maxWidth = '100%';

  const headerRow = document.createElement('div');
  headerRow.style.display = 'flex';
  headerRow.style.alignItems = 'center';
  headerRow.style.justifyContent = 'space-between';
  headerRow.style.gap = '8px';

  const checkboxLabel = document.createElement('label');
  checkboxLabel.style.display = 'flex';
  checkboxLabel.style.alignItems = 'center';
  checkboxLabel.style.gap = '8px';
  checkboxLabel.style.fontWeight = '600';
  checkboxLabel.style.fontSize = '14px';
  checkboxLabel.style.cursor = 'pointer';
  const enabledCheckbox = document.createElement('input');
  enabledCheckbox.type = 'checkbox';
  enabledCheckbox.checked = !!parsed;
  enabledCheckbox.style.width = '20px';
  enabledCheckbox.style.height = '20px';
  checkboxLabel.appendChild(enabledCheckbox);
  checkboxLabel.appendChild(document.createTextNode(label));
  headerRow.appendChild(checkboxLabel);

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.style.fontSize = '13px';
  clearBtn.style.padding = '6px 10px';
  clearBtn.style.flexShrink = '0';
  headerRow.appendChild(clearBtn);

  wrap.appendChild(headerRow);

  const fields = document.createElement('div');
  fields.style.marginTop = '10px';
  fields.style.display = enabledCheckbox.checked ? 'block' : 'none';
  fields.style.boxSizing = 'border-box';
  fields.style.width = '100%';
  fields.style.maxWidth = '100%';

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  textInputStyle(dateInput);
  // iOS Safari specifically: the native date-picker control has its own
  // internal rendering that doesn't fully respect max-width/box-sizing
  // the way Chrome's does, which is why this overflowed on iOS but not
  // Chrome despite already being constrained at every container level.
  // -webkit-appearance: none is the standard, documented fix — it drops
  // iOS's native chrome for the inline (non-active) display, forcing it
  // to actually honor normal CSS box sizing; tapping still opens the
  // native date-wheel picker as usual.
  dateInput.style.webkitAppearance = 'none';
  dateInput.style.appearance = 'none';
  if (parsed) {
    const y = parsed.date.getFullYear();
    const m = String(parsed.date.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.date.getDate()).padStart(2, '0');
    dateInput.value = `${y}-${m}-${d}`;
  }
  fields.appendChild(fieldRow('Date', dateInput));

  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  textInputStyle(timeInput);
  timeInput.style.webkitAppearance = 'none'; // same iOS fix as dateInput above
  timeInput.style.appearance = 'none';
  if (parsed && parsed.hasTime) {
    const h = String(parsed.date.getHours()).padStart(2, '0');
    const min = String(parsed.date.getMinutes()).padStart(2, '0');
    timeInput.value = `${h}:${min}`;
  }
  fields.appendChild(fieldRow('Start time (optional)', timeInput));

  const repeaterRow = document.createElement('div');
  repeaterRow.style.display = 'flex';
  repeaterRow.style.gap = '6px';
  const repeaterMarkSelect = document.createElement('select');
  textInputStyle(repeaterMarkSelect);
  repeaterMarkSelect.style.flex = '1 1 auto';
  for (const [val, text] of REPEATER_MARK_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    repeaterMarkSelect.appendChild(opt);
  }
  repeaterMarkSelect.value = repeaterMarkParsed;
  const repeaterAmountInput = document.createElement('input');
  repeaterAmountInput.type = 'number';
  repeaterAmountInput.min = '1';
  textInputStyle(repeaterAmountInput);
  repeaterAmountInput.style.width = '60px';
  repeaterAmountInput.style.flex = '0 0 60px';
  if (repeaterParsed) repeaterAmountInput.value = String(repeaterParsed.amount);
  const repeaterUnitSelect = document.createElement('select');
  textInputStyle(repeaterUnitSelect);
  repeaterUnitSelect.style.flex = '1 1 auto';
  for (const [val, text] of TIME_UNIT_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    repeaterUnitSelect.appendChild(opt);
  }
  if (repeaterParsed) repeaterUnitSelect.value = repeaterParsed.unit;
  repeaterRow.appendChild(repeaterMarkSelect);
  repeaterRow.appendChild(repeaterAmountInput);
  repeaterRow.appendChild(repeaterUnitSelect);
  fields.appendChild(fieldRow('Repeat', repeaterRow));

  const delayRow = document.createElement('div');
  delayRow.style.display = 'flex';
  delayRow.style.gap = '6px';
  const delayAmountInput = document.createElement('input');
  delayAmountInput.type = 'number';
  delayAmountInput.min = '1';
  textInputStyle(delayAmountInput);
  delayAmountInput.style.width = '60px';
  delayAmountInput.style.flex = '0 0 60px';
  if (delayParsed) delayAmountInput.value = String(delayParsed.amount);
  const delayUnitSelect = document.createElement('select');
  textInputStyle(delayUnitSelect);
  delayUnitSelect.style.flex = '1 1 auto';
  const blankUnitOpt = document.createElement('option');
  blankUnitOpt.value = '';
  blankUnitOpt.textContent = '\u2014';
  delayUnitSelect.appendChild(blankUnitOpt);
  for (const [val, text] of TIME_UNIT_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    delayUnitSelect.appendChild(opt);
  }
  if (delayParsed) delayUnitSelect.value = delayParsed.unit;
  delayRow.appendChild(delayAmountInput);
  delayRow.appendChild(delayUnitSelect);
  fields.appendChild(fieldRow('Warn ahead by (optional \u2014 e.g. see a deadline coming a few days early)', delayRow));

  wrap.appendChild(fields);

  enabledCheckbox.addEventListener('change', () => {
    fields.style.display = enabledCheckbox.checked ? 'block' : 'none';
  });

  clearBtn.onclick = () => {
    enabledCheckbox.checked = false;
    fields.style.display = 'none';
    dateInput.value = '';
    timeInput.value = '';
    repeaterMarkSelect.value = '';
    repeaterAmountInput.value = '';
    repeaterUnitSelect.value = 'd';
    delayAmountInput.value = '';
    delayUnitSelect.value = '';
  };

  function getRawValue() {
    if (!enabledCheckbox.checked || !dateInput.value) return null;
    const [y, m, d] = dateInput.value.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const time = timeInput.value || null;
    const repeaterMark = repeaterMarkSelect.value || null;
    const repeaterValue =
      repeaterMark && repeaterAmountInput.value ? `${repeaterAmountInput.value}${repeaterUnitSelect.value}` : null;
    const delayValue = delayUnitSelect.value && delayAmountInput.value ? `${delayAmountInput.value}${delayUnitSelect.value}` : null;
    return formatOrgTimestamp({ date, time, repeaterMark, repeaterValue, delayValue });
  }

  return { container: wrap, getRawValue };
}

/** Structured tag editor: existing tags shown as removable chips, plus
 *  an input+button to add a new one. Working state is local to this
 *  group (not committed to `heading` until the general editor's own
 *  Save button reads getTags()) -- same uncommitted-until-Save pattern
 *  buildTimestampFieldGroup already uses, so Cancel genuinely discards
 *  everything, tags included, not just the timestamp fields. */
function buildTagsFieldGroup(heading) {
  const wrap = document.createElement('div');
  wrap.style.border = '0.5px solid var(--border-strong)';
  wrap.style.borderRadius = '8px';
  wrap.style.padding = '10px';
  wrap.style.marginBottom = '10px';
  wrap.style.boxSizing = 'border-box';
  wrap.style.width = '100%';
  wrap.style.maxWidth = '100%';

  const header = document.createElement('div');
  header.textContent = 'Tags';
  header.style.fontWeight = '600';
  header.style.fontSize = '14px';
  header.style.marginBottom = '10px';
  wrap.appendChild(header);

  let currentTags = [...heading.tags];

  const chipsRow = document.createElement('div');
  chipsRow.style.display = 'flex';
  chipsRow.style.flexWrap = 'wrap';
  chipsRow.style.gap = '6px';
  chipsRow.style.marginBottom = currentTags.length ? '10px' : '0';
  wrap.appendChild(chipsRow);

  const addRow = document.createElement('div');
  addRow.style.display = 'flex';
  addRow.style.gap = '6px';
  const addInput = document.createElement('input');
  addInput.type = 'text';
  textInputStyle(addInput);
  addInput.placeholder = 'New tag';
  const addBtn = wizardButton('Add', () => {
    const val = addInput.value.trim().replace(/:/g, '');
    if (val && !currentTags.includes(val)) {
      currentTags.push(val);
      addInput.value = '';
      renderChips();
    }
  });
  addBtn.style.flex = '0 0 auto';
  addRow.appendChild(addInput);
  addRow.appendChild(addBtn);
  wrap.appendChild(addRow);

  function renderChips() {
    chipsRow.innerHTML = '';
    chipsRow.style.marginBottom = currentTags.length ? '10px' : '0';
    for (const tag of currentTags) {
      const chip = document.createElement('button');
      chip.textContent = tag + ' \u2715';
      chip.setAttribute('aria-label', 'Remove tag ' + tag);
      chip.style.fontSize = '13px';
      chip.style.padding = '5px 10px';
      chip.style.borderRadius = '12px';
      chip.style.border = '1px solid var(--border-strong)';
      chip.style.background = 'var(--surface)';
      chip.style.color = 'var(--fg)';
      chip.onclick = () => {
        currentTags = currentTags.filter((t) => t !== tag);
        renderChips();
      };
      chipsRow.appendChild(chip);
    }
  }
  renderChips();

  return { container: wrap, getTags: () => currentTags };
}

/** Structured priority editor: a row of buttons (A/B/C/None), the
 *  active one highlighted. A/B/C are real org's own conventional
 *  default range (org-priority-highest/-lowest, both configurable in
 *  Emacs but A-C out of the box) -- covers the common case directly
 *  with one tap; anything outside that range isn't reachable from this
 *  UI, a stated scope limit rather than trying to build a full A-Z
 *  picker for a rarely-used case. */
const PRIORITY_LEVELS = ['A', 'B', 'C'];

function buildPriorityFieldGroup(heading) {
  const wrap = document.createElement('div');
  wrap.style.border = '0.5px solid var(--border-strong)';
  wrap.style.borderRadius = '8px';
  wrap.style.padding = '10px';
  wrap.style.marginBottom = '10px';
  wrap.style.boxSizing = 'border-box';
  wrap.style.width = '100%';
  wrap.style.maxWidth = '100%';

  const header = document.createElement('div');
  header.textContent = 'Priority';
  header.style.fontWeight = '600';
  header.style.fontSize = '14px';
  header.style.marginBottom = '10px';
  wrap.appendChild(header);

  let currentPriority = heading.priority;

  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '6px';
  wrap.appendChild(btnRow);

  function renderButtons() {
    btnRow.innerHTML = '';
    for (const level of [...PRIORITY_LEVELS, 'None']) {
      const btn = wizardButton(level, () => {
        currentPriority = level === 'None' ? null : level;
        renderButtons();
      });
      const isActive = level === 'None' ? !currentPriority : level === currentPriority;
      btn.style.background = isActive ? 'var(--accent)' : 'transparent';
      btn.style.color = isActive ? '#fff' : 'var(--fg)';
      btn.style.border = '1px solid var(--border-strong)';
      btnRow.appendChild(btn);
    }
  }
  renderButtons();

  return { container: wrap, getPriority: () => currentPriority };
}

/** Structured properties editor: each existing property as its own
 *  key/value row (both directly editable, not a raw ":KEY: value" text
 *  block to parse), a per-row remove button, and an "Add property" row
 *  to append a new, initially-blank one. Blank-key rows are silently
 *  dropped on save (getProperties() below) rather than erroring, since
 *  "I tapped Add then changed my mind" is a normal, expected path, not
 *  a mistake to flag. Duplicate keys: the LAST row with a given key
 *  wins (matching a plain object's own last-write-wins semantics),
 *  since this UI doesn't have anywhere to show a "duplicate key"
 *  warning inline the way the raw-text editor's onChange validation
 *  could -- a stated simplification versus that discarded approach. */
function buildPropertiesFieldGroup(heading) {
  const wrap = document.createElement('div');
  wrap.style.border = '0.5px solid var(--border-strong)';
  wrap.style.borderRadius = '8px';
  wrap.style.padding = '10px';
  wrap.style.marginBottom = '10px';
  wrap.style.boxSizing = 'border-box';
  wrap.style.width = '100%';
  wrap.style.maxWidth = '100%';

  const header = document.createElement('div');
  header.textContent = 'Properties';
  header.style.fontWeight = '600';
  header.style.fontSize = '14px';
  header.style.marginBottom = '10px';
  wrap.appendChild(header);

  const currentProps = heading.propertyOrder.map((key) => ({ key, value: heading.properties[key] ?? '' }));

  const rowsContainer = document.createElement('div');
  wrap.appendChild(rowsContainer);

  function renderRows() {
    rowsContainer.innerHTML = '';
    currentProps.forEach((prop, idx) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '6px';
      row.style.marginBottom = '6px';

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      textInputStyle(keyInput);
      keyInput.style.flex = '1 1 40%';
      keyInput.placeholder = 'Key';
      keyInput.value = prop.key;
      keyInput.oninput = () => {
        prop.key = keyInput.value;
      };

      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      textInputStyle(valueInput);
      valueInput.style.flex = '2 1 60%';
      valueInput.placeholder = 'Value';
      valueInput.value = prop.value;
      valueInput.oninput = () => {
        prop.value = valueInput.value;
      };

      const removeBtn = document.createElement('button');
      removeBtn.textContent = '\u2715';
      removeBtn.setAttribute('aria-label', 'Remove property');
      removeBtn.style.flexShrink = '0';
      removeBtn.style.minWidth = '40px';
      removeBtn.style.minHeight = '40px';
      removeBtn.onclick = () => {
        currentProps.splice(idx, 1);
        renderRows();
      };

      row.appendChild(keyInput);
      row.appendChild(valueInput);
      row.appendChild(removeBtn);
      rowsContainer.appendChild(row);
    });
  }
  renderRows();

  const addBtn = wizardButton('+ Add property', () => {
    currentProps.push({ key: '', value: '' });
    renderRows();
  });
  addBtn.style.marginTop = '4px';
  wrap.appendChild(addBtn);

  return {
    container: wrap,
    getProperties: () => {
      const properties = {};
      const propertyOrder = [];
      for (const { key, value } of currentProps) {
        const trimmedKey = key.trim();
        if (!trimmedKey) continue; // an incomplete "Add property" row the user never filled in -- dropped silently, not an error
        if (!(trimmedKey in properties)) propertyOrder.push(trimmedKey);
        properties[trimmedKey] = value;
      }
      return { properties, propertyOrder };
    },
  };
}

function renderActionMenu(actions, columns = 5) {
  const menu = document.createElement('div');
  menu.style.display = 'grid';
  menu.style.gridTemplateColumns = `repeat(${columns}, 44px)`; // fixed count per row, regardless of container width -- flex-wrap would vary the count by available space instead
  menu.style.justifyContent = 'center'; // centers the (fixed-width) button grid within the row's available width -- responsive to any container width and any column count, unlike a fixed left-margin value that would only look centered at one specific width
  menu.style.gap = '8px';
  menu.style.padding = '8px 8px 10px 8px';
  menu.style.borderBottom = '0.5px solid #8882';
  menu.style.overflowX = 'auto'; // safety net: a wide row (especially at 6 columns) can get tight on narrow phones, more so once a nested heading's own depth indentation eats into available width -- keeps buttons reachable via local scroll rather than clipped if it doesn't fit
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.textContent = action.icon;
    btn.setAttribute('aria-label', action.label);
    btn.className = 'icon-btn';
    btn.style.fontSize = '22px'; // matches the top-bar icons exactly
    btn.onclick = action.onClick;
    menu.appendChild(btn);
  }
  menu.onclick = (e) => {
    // Only when the tap landed on the menu's own background, not a
    // button -- e.target is the actual element tapped, so this only
    // fires in genuinely empty grid space (e.g. to the right of the
    // last button on a row that doesn't perfectly fill the width).
    if (e.target === menu) {
      actionMenuFor = null;
      render();
    }
  };
  return menu;
}

// Wraps a row element and any number of optional extra elements (action
// menu, the combined heading-text editor, etc.) stacked below it in a
// plain block container — this is what lets a single renderRow() call
// produce "several stacked pieces" without changing render()'s
// one-element-per-row assumption.
function withActionMenu(rowEl, ...extras) {
  const present = extras.filter(Boolean);
  if (present.length === 0) return rowEl;
  const wrap = document.createElement('div');
  wrap.appendChild(rowEl);
  for (const el of present) wrap.appendChild(el);
  return wrap;
}

function tableHasContent(table) {
  return table.rows.some((r) => r.type === 'row' && r.cells.some((c) => c.trim() !== ''));
}

function confirmTableDelete(table) {
  if (!tableHasContent(table)) return true;
  return window.confirm("Delete this table and all its data?");
}

function paragraphHasContent(paragraph) {
  return paragraph.lines.some((l) => l.trim() !== '');
}

function confirmParagraphDelete(paragraph) {
  if (!paragraphHasContent(paragraph)) return true;
  return window.confirm("Delete this note?");
}

// Counts every item nested under `item`, at any depth — used by
// confirmListItemDelete to decide whether deleting it needs confirming
// (nested children present, or the item itself has real content), and
// to say how much would go with it. A genuinely empty item — no text,
// no nested children — skips confirmation, same "nothing lost, nothing
// to ask about" rule as confirmParagraphDelete/confirmTableDelete. This
// used to skip confirmation for ANY item with no nested children,
// regardless of the item's own content — meaning a plain, undoable
// checkbox task like "Buy milk" never got a confirmation at all, since
// it has no children of its own. That was the actual bug, not a
// deliberate friction/safety tradeoff.
function listItemDescendantCount(item) {
  let count = 0;
  for (const nestedList of item.children || []) {
    count += nestedList.items.length;
    for (const child of nestedList.items) count += listItemDescendantCount(child);
  }
  return count;
}

function confirmListItemDelete(item) {
  const count = listItemDescendantCount(item);
  const hasOwnContent = (item.text && item.text.trim() !== '') || (item.tag && item.tag.trim() !== '');
  if (count === 0 && !hasOwnContent) return true; // genuinely empty item, nothing lost either way
  if (count > 0) {
    return window.confirm(
      `Delete this item? It has ${count} nested sub-item${count === 1 ? '' : 's'} that will be deleted too.`
    );
  }
  return window.confirm("Delete this item?");
}

function renderRow(row, todoSequence) {
  if (row.rowType === 'heading') {
    const el = document.createElement('div');
    el.className = 'row';
    el.style.paddingLeft = 8 + row.depth * 16 + 'px';
    el.style.alignItems = 'flex-start';
    el.style.touchAction = 'pan-y';
    if (row.node === keyboardFocusedHeading) {
      el.id = 'keyboard-focused-row';
      el.style.outline = '2px solid var(--accent)';
      el.style.outlineOffset = '-2px';
      el.style.borderRadius = '4px';
    }
    attachSlideLeftToFold(el, row.node);

    const fold = document.createElement('button');
    fold.className = 'fold-btn';
    fold.textContent = row.hasChildren ? (row.node.collapsed ? '\u25b8' : '\u25be') : ' ';
    fold.setAttribute('aria-label', 'Toggle fold');
    fold.onclick = () => {
      toggleFold(row.node);
      render();
    };
    el.appendChild(fold);

    if (row.node.todo) {
      const badge = document.createElement('span');
      badge.className = 'todo-badge ' + (todoSequence.doneKeywords.includes(row.node.todo) ? 'done' : 'todo');
      badge.textContent = row.node.todo;
      badge.onclick = () => {
        applyTodoTransition(row.node, () => cycleHeadingTodo(state.doc, row.node, GLOBAL_TODO_DEFAULT));
        commitAndRender('Cycled TODO state');
      };
      el.appendChild(badge);
    }

    let menuEl = null;

    if (state.doc && editingHeading === row.node) {
      const input = document.createElement('textarea');
      input.className = 'title-input';
      input.id = 'title-edit-input';
      input.rows = 1;
      input.value = row.node.title;
      input.placeholder = 'Heading title';
      input.style.overflowWrap = 'anywhere';
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          // A heading title is one logical line — Enter commits rather
          // than inserting a newline, same reasoning as a table cell.
          e.preventDefault();
          input.blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelTitleEdit();
        }
      });
      input.addEventListener('blur', () => commitTitleEdit(input.value.replace(/\n/g, ' ')));
      autoGrowTextarea(input);
      el.appendChild(input);
    } else {
      const title = document.createElement('span');
      title.className = 'heading-title';
      if (row.node.title) {
        renderInlineNodes(parseInline(row.node.title, currentInlineOpts()), title);
      } else {
        title.textContent = '(untitled)';
        title.style.opacity = '0.5';
      }
      title.onclick = (e) => {
        if (e.target.closest('[data-inline-link]')) return;
        toggleActionMenu(row.node);
      };
      el.appendChild(title);

      for (const tag of row.node.tags) {
        const t = document.createElement('span');
        t.className = 'tag';
        t.textContent = tag;
        el.appendChild(t);
      }

      if (actionMenuFor === row.node) {
        menuEl = renderActionMenu(
          [
            {
              icon: '\u270f\ufe0f',
              label: 'Edit title',
              onClick: () => {
                actionMenuFor = null;
                startEditingTitle(row.node, false);
              },
            },
            {
              icon: '\ud83d\udcdd',
              label: 'Edit text',
              onClick: () => {
                actionMenuFor = null;
                editingHeadingText = row.node;
                render();
              },
            },
            {
              icon: '\ud83d\udccb',
              label: 'Edit details (scheduled/deadline, tags, priority, properties)',
              onClick: () => {
                actionMenuFor = null;
                editingGeneral = row.node;
                render();
              },
            },
            {
              icon: '+',
              label: 'Add sub-heading',
              onClick: () => {
                actionMenuFor = null;
                const child = insertChildHeading(row.node, {});
                startEditingTitle(child, true);
              },
            },
            {
              icon: '\u2191',
              label: 'Move up',
              onClick: () => {
                if (moveHeadingUp(state.doc, row.node)) {
                  commitAndRender('Moved heading up');
                } else {
                  setStatus('Already first among its siblings.');
                  render();
                }
              },
            },
            {
              icon: '\u2193',
              label: 'Move down',
              onClick: () => {
                if (moveHeadingDown(state.doc, row.node)) {
                  commitAndRender('Moved heading down');
                } else {
                  setStatus('Already last among its siblings.');
                  render();
                }
              },
            },
            {
              icon: '\u2610',
              label: row.node.todo ? 'Remove TODO/DONE state' : 'Mark as TODO',
              onClick: () => {
                actionMenuFor = null;
                const hadTodo = !!row.node.todo;
                applyTodoTransition(row.node, () => toggleHeadingTodo(state.doc, row.node, GLOBAL_TODO_DEFAULT));
                commitAndRender(hadTodo ? 'Removed TODO/DONE state' : 'Marked as TODO');
              },
            },
            {
              icon: isClockRunning(row.node) ? '\u23f9\ufe0f' : '\u25b6\ufe0f',
              label: isClockRunning(row.node) ? 'Clock out' : 'Clock in',
              onClick: () => {
                actionMenuFor = null;
                if (isClockRunning(row.node)) {
                  openClockStopPrompt(row.node);
                } else {
                  clockInHeading(row.node);
                }
              },
            },
            {
              icon: isArchivedInPlace(row.node) ? '\ud83d\udce4' : '\ud83d\uddc4\ufe0f',
              label: isArchivedInPlace(row.node) ? 'Unarchive (restore)' : 'Archive',
              onClick: async () => {
                actionMenuFor = null;
                render();
                if (isArchivedInPlace(row.node)) {
                  await unarchiveHeadingToOriginalLocation(row.node);
                } else {
                  openArchiveConfirmPrompt(row.node);
                }
              },
            },
            {
              icon: '\u2715',
              label: 'Delete heading',
              onClick: () => {
                if (!confirmHeadingDelete(row.node)) return;
                actionMenuFor = null;
                editingHeading = null;
                editingIsNew = false;
                editingCell = null;
                editingParagraph = null;
                editingListItem = null;
                editingHeadingText = null;
                editingGeneral = null;
                removeHeading(state.doc, row.node);
                commitAndRender('Deleted heading');
              },
            },
            {
              icon: '\u2190',
              label: 'Promote (outdent)',
              onClick: () => {
                if (promoteHeading(state.doc, row.node)) {
                  commitAndRender('Promoted heading');
                } else {
                  setStatus("Already top-level \u2014 can't promote further.");
                  render();
                }
              },
            },
            {
              icon: '\u2192',
              label: 'Demote (indent)',
              onClick: () => {
                if (demoteHeading(state.doc, row.node)) {
                  commitAndRender('Demoted heading');
                } else {
                  setStatus("No preceding sibling to demote under.");
                  render();
                }
              },
            },
          ],
          6
        );
      }
    }

    let textEditorEl = null;
    if (editingHeadingText === row.node) {
      textEditorEl = document.createElement('div');
      textEditorEl.style.padding = '4px 10px 10px 40px';
      const textarea = document.createElement('textarea');
      textarea.id = 'heading-text-edit-input';
      textarea.value = getHeadingText(row.node);
      textarea.rows = Math.max(3, textarea.value.split('\n').length);
      textarea.placeholder = 'All content for this heading — lists, notes, etc. — as org text';
      textarea.style.width = '100%';
      textarea.style.boxSizing = 'border-box';
      textarea.style.font = 'inherit';
      textarea.style.fontSize = '14px';
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          editingHeadingText = null;
          render();
        }
      });
      textarea.addEventListener('blur', () => {
        const heading = editingHeadingText;
        editingHeadingText = null;
        setHeadingText(heading, textarea.value);
        commitAndRender('Edited heading body text');
      });
      autoGrowTextarea(textarea);
      textEditorEl.appendChild(textarea);
    }

    let generalEditorEl = null;
    if (editingGeneral === row.node) {
      generalEditorEl = document.createElement('div');
      generalEditorEl.style.padding = '8px 10px 10px 40px';
      generalEditorEl.style.boxSizing = 'border-box';
      generalEditorEl.style.width = '100%';
      generalEditorEl.style.maxWidth = '100%';

      const scheduledGroup = buildTimestampFieldGroup('SCHEDULED', row.node.planning.scheduled);
      const deadlineGroup = buildTimestampFieldGroup('DEADLINE', row.node.planning.deadline);
      const plainGroup = buildTimestampFieldGroup(
        'Plain timestamp (not scheduled/deadline)',
        getPlainTimestampInTitle(row.node)
      );
      const tagsGroup = buildTagsFieldGroup(row.node);
      const priorityGroup = buildPriorityFieldGroup(row.node);
      const propsGroup = buildPropertiesFieldGroup(row.node);
      generalEditorEl.appendChild(scheduledGroup.container);
      generalEditorEl.appendChild(deadlineGroup.container);
      generalEditorEl.appendChild(plainGroup.container);
      generalEditorEl.appendChild(tagsGroup.container);
      generalEditorEl.appendChild(priorityGroup.container);
      generalEditorEl.appendChild(propsGroup.container);

      const addTableRow = document.createElement('div');
      addTableRow.style.display = 'flex';
      addTableRow.style.gap = '8px';
      addTableRow.style.marginBottom = '10px';
      const existingTable = lastTableInBody(row.node);
      addTableRow.appendChild(
        tableActionButton('\u25a6 Add table', () => {
          const heading = editingGeneral;
          editingGeneral = null;
          insertTable(heading, {});
          commitAndRender('Added table');
        })
      );
      addTableRow.appendChild(
        tableActionButton(
          '\ud83d\uddd1\ufe0f Delete table',
          () => {
            const heading = editingGeneral;
            const table = lastTableInBody(heading);
            if (!table) return; // shouldn't happen -- disabled when there's nothing to delete -- but never act on nothing
            if (!window.confirm('Delete this table? This can\u2019t be undone.')) return;
            editingGeneral = null;
            deleteTable(heading, table);
            commitAndRender('Deleted table');
          },
          !existingTable
        )
      );
      generalEditorEl.appendChild(addTableRow);

      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex';
      btnRow.style.gap = '10px';
      btnRow.appendChild(
        wizardButton('Save', () => {
          const heading = editingGeneral;
          editingGeneral = null;
          heading.planning = {
            scheduled: scheduledGroup.getRawValue(),
            deadline: deadlineGroup.getRawValue(),
            closed: heading.planning.closed,
          };
          setPlainTimestampInTitle(heading, plainGroup.getRawValue());
          setHeadingTags(heading, tagsGroup.getTags());
          setPriority(heading, priorityGroup.getPriority());
          const { properties, propertyOrder } = propsGroup.getProperties();
          heading.properties = properties;
          heading.propertyOrder = propertyOrder;
          commitAndRender('Edited heading details');
        })
      );
      btnRow.appendChild(
        wizardButton('Cancel', () => {
          editingGeneral = null;
          render();
        })
      );
      generalEditorEl.appendChild(btnRow);
    }

    let propertiesDisplayEl = null;
    if (!row.node.drawersHidden && row.node.propertyOrder.length > 0 && editingGeneral !== row.node) {
      propertiesDisplayEl = document.createElement('div');
      propertiesDisplayEl.style.padding = '2px 10px 6px 40px';
      propertiesDisplayEl.style.fontSize = '12px';
      propertiesDisplayEl.style.fontFamily = 'monospace';
      propertiesDisplayEl.style.opacity = '0.65';
      propertiesDisplayEl.style.whiteSpace = 'pre-wrap';
      propertiesDisplayEl.style.overflowWrap = 'anywhere';
      propertiesDisplayEl.style.cursor = 'pointer';
      propertiesDisplayEl.textContent = getPropertiesText(row.node);
      propertiesDisplayEl.onclick = () => toggleActionMenu(row.node);
    }

    let logbookDisplayEl = null;
    if (!row.node.drawersHidden && row.node.logbookLines.length > 0 && editingGeneral !== row.node) {
      logbookDisplayEl = document.createElement('div');
      logbookDisplayEl.style.padding = '2px 10px 6px 40px';
      logbookDisplayEl.style.fontSize = '12px';
      logbookDisplayEl.style.opacity = '0.65';
      logbookDisplayEl.style.cursor = 'pointer';
      logbookDisplayEl.onclick = () => toggleActionMenu(row.node);
      for (const entry of parseLogbookEntries(row.node.logbookLines)) {
        const line = document.createElement('div');
        line.style.whiteSpace = 'pre-wrap';
        line.style.overflowWrap = 'anywhere';
        if (entry.type === 'clock') {
          line.textContent = entry.end
            ? `Clock: ${entry.start}\u2013${entry.end} \u21d2 ${entry.duration}`
            : `Clock: ${entry.start} (running)`;
        } else if (entry.type === 'state') {
          const transition = entry.oldState ? `${entry.oldState} \u2192 ${entry.newState}` : entry.newState;
          line.textContent = `${transition}   ${entry.timestamp}`;
        } else {
          line.textContent = `Note   ${entry.timestamp}`;
        }
        logbookDisplayEl.appendChild(line);
        if (entry.note) {
          const noteLine = document.createElement('div');
          noteLine.style.whiteSpace = 'pre-wrap';
          noteLine.style.overflowWrap = 'anywhere';
          noteLine.style.paddingLeft = '12px';
          noteLine.style.fontStyle = 'italic';
          noteLine.textContent = entry.note;
          logbookDisplayEl.appendChild(noteLine);
        }
      }
    }

    return withActionMenu(el, menuEl, textEditorEl, generalEditorEl, propertiesDisplayEl, logbookDisplayEl);
  }

  if (row.rowType === 'list-item') {
    const el = document.createElement('div');
    el.className = 'row';
    el.style.paddingLeft = 8 + row.depth * 16 + 'px';
    el.style.alignItems = 'flex-start';
    if (row.item.checkbox !== null) {
      el.classList.add('checkbox-row');
      el.onclick = (e) => {
        if (e.target.closest('[data-inline-link]')) return;
        cycleItemCheckbox(row.heading, row.item);
        updateCheckboxCookiesUpward(state.doc, row.heading);
        commitAndRender('Toggled checkbox');
      };
      const box = document.createElement('span');
      box.textContent = row.item.checkbox === 'X' ? '\u2611' : row.item.checkbox === '-' ? '\u25aa' : '\u2610';
      el.appendChild(box);
    } else {
      const marker = document.createElement('span');
      marker.style.flexShrink = '0';
      marker.style.color = 'var(--text-muted, #888)';
      marker.style.fontSize = '13px';
      marker.style.textAlign = 'right';
      marker.style.minWidth = row.item.ordered ? '22px' : '12px';
      marker.textContent = row.item.ordered ? row.displayNumber + '.' : '\u2022';
      el.appendChild(marker);
    }

    const isEditingText = editingListItem && editingListItem.item === row.item;
    let menuEl = null;

    if (isEditingText) {
      const input = document.createElement('textarea');
      input.id = 'listitem-edit-input';
      input.rows = 1;
      input.value = row.item.text;
      input.style.flex = '1 1 auto';
      input.style.minWidth = '0';
      input.style.font = 'inherit';
      input.style.overflowWrap = 'anywhere';
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          // A list item's text is one logical line — Enter commits
          // rather than inserting a newline, same as a heading title.
          e.preventDefault();
          input.blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          editingListItem = null;
          render();
        }
      });
      input.addEventListener('blur', () => {
        const { heading, item } = editingListItem;
        editingListItem = null;
        editListItemText(heading, item, input.value.replace(/\n/g, ' '));
        commitAndRender('Edited list item text');
      });
      autoGrowTextarea(input);
      el.appendChild(input);
    } else {
      const text = document.createElement('span');
      const hasContent = row.item.text.trim() !== '' || (row.item.tag && row.item.tag.trim() !== '');
      if (hasContent) {
        if (row.item.tag) {
          text.appendChild(document.createTextNode(row.item.tag + ' :: '));
        }
        renderInlineNodes(parseInline(row.item.text, currentInlineOpts()), text);
      } else {
        // An empty item (e.g. a fresh checkbox with nothing typed yet)
        // otherwise renders zero visible content here — which means zero
        // tappable area, since this span is the only thing with the
        // reveal-menu handler. That made an empty item's edit/add/delete
        // actions completely unreachable: nothing to tap to reveal them.
        // Same placeholder pattern already used for an empty paragraph.
        text.textContent = '(empty \u2014 tap for options)';
        text.style.opacity = '0.5';
      }
      text.style.flex = '1 1 auto';
      text.style.minWidth = '0';
      text.style.whiteSpace = 'normal';
      text.style.overflowWrap = 'anywhere';
      text.style.cursor = 'text';
      // Tapping the text reveals the contextual menu (edit/add/delete)
      // rather than jumping straight into editing — even on a checkbox
      // row where tapping elsewhere toggles the checkbox; stopPropagation
      // is what keeps those two gestures from colliding.
      text.onclick = (e) => {
        if (e.target.closest('[data-inline-link]')) return;
        e.stopPropagation();
        toggleActionMenu(row.item);
      };
      el.appendChild(text);

      if (actionMenuFor === row.item) {
        menuEl = renderActionMenu(
          [
          {
            icon: '\u270f\ufe0f',
            label: 'Edit text',
            onClick: (e) => {
              e.stopPropagation();
              actionMenuFor = null;
              editingListItem = { heading: row.heading, item: row.item };
              render();
            },
          },
          {
            icon: '+',
            label: 'Add item below',
            onClick: (e) => {
              e.stopPropagation();
              actionMenuFor = null;
              const newItem = insertListItem(row.heading, row.item, '');
              updateCheckboxCookiesUpward(state.doc, row.heading);
              editingListItem = { heading: row.heading, item: newItem };
              commitAndRender('Added list item');
            },
          },
          {
            icon: '\u2715',
            label: 'Delete item',
            onClick: (e) => {
              e.stopPropagation();
              if (!confirmListItemDelete(row.item)) return;
              actionMenuFor = null;
              if (editingListItem && editingListItem.item === row.item) editingListItem = null;
              deleteListItem(row.heading, row.item);
              updateCheckboxCookiesUpward(state.doc, row.heading);
              commitAndRender('Deleted list item');
            },
          },
          ],
          3
        );
      }
    }

    return withActionMenu(el, menuEl);
  }

  if (row.rowType === 'table') return renderTableRow(row);
  if (row.rowType === 'paragraph') return renderParagraphRow(row);
  if (row.rowType === 'block') return renderBlockRow(row);
  if (row.rowType === 'hr') return renderHrRow(row);

  const el = document.createElement('div');
  el.className = 'row';
  el.style.paddingLeft = 8 + row.depth * 16 + 'px';
  el.style.opacity = '0.6';
  el.style.fontStyle = 'italic';
  el.textContent = '[' + row.rowType + ']';
  return el;
}

function renderTableRow(row) {
  const wrap = document.createElement('div');
  wrap.style.paddingLeft = 8 + row.depth * 16 + 'px';
  wrap.style.margin = '4px 0';

  // A table has no single "tap the text" affordance the way a paragraph
  // or list item does — you interact with individual cells, and its
  // structural controls (+row/+col etc.) are a real toolbar, not a
  // per-item options menu, so they stay always-visible below the grid.
  // This label is the tap target for the one thing that *does* belong in
  // a reveal-on-tap menu: deleting the whole table.
  const label = document.createElement('div');
  label.textContent = '\u25a6 Table';
  label.style.fontSize = '11px';
  label.style.color = 'var(--text-muted, #888)';
  label.style.cursor = 'pointer';
  label.style.padding = '2px 0 4px';
  label.onclick = () => {
    toggleActionMenu(row.node);
  };
  wrap.appendChild(label);

  let menuEl = null;
  if (actionMenuFor === row.node) {
    menuEl = renderActionMenu(
      [
        {
          icon: '\u2715',
          label: 'Delete table',
          onClick: () => {
            if (!confirmTableDelete(row.node)) return;
            actionMenuFor = null;
            deleteTable(row.heading, row.node);
            commitAndRender('Deleted table');
          },
        },
      ],
      1
    );
  }

  const tableEl = document.createElement('table');
  tableEl.style.borderCollapse = 'collapse';
  tableEl.style.fontSize = 'var(--app-font-size-tables)';

  row.node.rows.forEach((tr, rowIndex) => {
    if (tr.type === 'rule') return; // shown implicitly via the header row's styling, not as its own grid row
    const trEl = document.createElement('tr');
    tr.cells.forEach((cellText, colIndex) => {
      const tdEl = document.createElement('td');
      tdEl.style.border = '1px solid #8886';
      tdEl.style.padding = '3px 6px';
      tdEl.style.cursor = 'text';
      if (isTableHeaderRow(row.node, rowIndex)) tdEl.style.fontWeight = '600';

      const isEditing =
        editingCell &&
        editingCell.table === row.node &&
        editingCell.rowIndex === rowIndex &&
        editingCell.colIndex === colIndex;

      if (isEditing) {
        const input = document.createElement('textarea');
        input.id = 'cell-edit-input';
        input.value = cellText;
        input.rows = 1;
        input.style.font = 'inherit';
        input.style.width = '100%';
        input.style.minWidth = Math.min(50, cellText.length * 8 || 50) + 'px';
        input.style.maxWidth = '220px';
        input.style.boxSizing = 'border-box';
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            // A literal newline would break the table's one-row-per-line
            // syntax on save — Enter commits instead, same as before.
            e.preventDefault();
            input.blur();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            editingCell = null;
            render();
          }
        });
        input.addEventListener('blur', () => {
          const { heading, table, rowIndex: ri, colIndex: ci } = editingCell;
          editingCell = null;
          setTableCell(heading, table, ri, ci, input.value.replace(/\n/g, ' '));
          commitAndRender('Edited table cell');
        });
        autoGrowTextarea(input);
        tdEl.appendChild(input);
      } else {
        if (cellText) {
          renderInlineNodes(parseInline(cellText, currentInlineOpts()), tdEl);
        } else {
          tdEl.textContent = '\u00a0';
        }
        tdEl.onclick = () => {
          editingCell = { heading: row.heading, table: row.node, rowIndex, colIndex };
          render();
        };
      }
      trEl.appendChild(tdEl);
    });
    tableEl.appendChild(trEl);
  });
  const tableScroll = document.createElement('div');
  tableScroll.style.overflowX = 'auto';
  tableScroll.style.maxWidth = '100%';
  tableScroll.style.webkitOverflowScrolling = 'touch';
  tableScroll.appendChild(tableEl);
  wrap.appendChild(tableScroll);

  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '4px';
  controls.style.marginTop = '4px';

  const dataRowCount = () => row.node.rows.filter((r) => r.type === 'row').length;
  const colCount = () => {
    const dr = row.node.rows.find((r) => r.type === 'row');
    return dr ? dr.cells.length : 1;
  };

  function lastDataRowHasContent() {
    const dataRows = row.node.rows.filter((r) => r.type === 'row');
    const last = dataRows[dataRows.length - 1];
    return last ? last.cells.some((c) => c.trim() !== '') : false;
  }
  function lastColumnHasContent() {
    const dataRows = row.node.rows.filter((r) => r.type === 'row');
    const lastColIndex = colCount() - 1;
    return dataRows.some((r) => (r.cells[lastColIndex] || '').trim() !== '');
  }

  controls.appendChild(
    smallButton('+ row', 'Add row', () => {
      insertTableRow(row.heading, row.node, row.node.rows.length - 1);
      commitAndRender('Added table row');
    })
  );
  controls.appendChild(
    smallButton('\u2212 row', 'Delete last row', () => {
      if (dataRowCount() <= 1) {
        setStatus("Can't delete the last row.");
        return;
      }
      if (lastDataRowHasContent() && !window.confirm('Delete the last row? It has data in it.')) {
        return;
      }
      deleteTableRow(row.heading, row.node, row.node.rows.length - 1);
      commitAndRender('Deleted table row');
    })
  );
  controls.appendChild(
    smallButton('+ col', 'Add column', () => {
      insertTableColumn(row.heading, row.node, colCount() - 1);
      commitAndRender('Added table column');
    })
  );
  controls.appendChild(
    smallButton('\u2212 col', 'Delete last column', () => {
      if (colCount() <= 1) {
        setStatus("Can't delete the last column.");
        return;
      }
      if (lastColumnHasContent() && !window.confirm('Delete the last column? It has data in it.')) {
        return;
      }
      deleteTableColumn(row.heading, row.node, colCount() - 1);
      commitAndRender('Deleted table column');
    })
  );
  wrap.appendChild(controls);

  return withActionMenu(wrap, menuEl);
}

/** A horizontal rule (5+ dashes on their own line) -- purely visual, no
 *  action menu, since there's nothing meaningful to edit on it beyond
 *  what the plain-text editor or the heading's own "Edit text" action
 *  already cover for arbitrary raw content. */
function renderHrRow(row) {
  const wrap = document.createElement('div');
  wrap.style.paddingLeft = 8 + row.depth * 16 + 'px';
  wrap.style.paddingRight = '8px';
  wrap.style.margin = '4px 0';
  const hr = document.createElement('hr');
  hr.style.border = 'none';
  hr.style.borderTop = '1px solid var(--border-strong)';
  hr.style.margin = '8px 0';
  wrap.appendChild(hr);
  return wrap;
}

function renderParagraphRow(row) {
  const wrap = document.createElement('div');
  wrap.style.paddingLeft = 8 + row.depth * 16 + 'px';
  wrap.style.margin = '4px 0';

  const isEditing = editingParagraph && editingParagraph.paragraph === row.node;

  if (isEditing) {
    const textarea = document.createElement('textarea');
    textarea.id = 'paragraph-edit-input';
    textarea.value = row.node.lines.join('\n');
    textarea.rows = Math.max(2, row.node.lines.length);
    textarea.style.width = '100%';
    textarea.style.font = 'inherit';
    textarea.style.boxSizing = 'border-box';
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        editingParagraph = null;
        render();
      }
      // Enter deliberately inserts a newline rather than committing —
      // paragraph text is multi-line, unlike a heading title.
    });
    textarea.addEventListener('blur', () => {
      const { heading, paragraph } = editingParagraph;
      editingParagraph = null;
      editParagraphText(heading, paragraph, textarea.value);
      commitAndRender('Edited paragraph text');
    });
    autoGrowTextarea(textarea);
    wrap.appendChild(textarea);
    return wrap;
  }

  const p = document.createElement('div');
  p.style.cursor = 'text';
  p.style.whiteSpace = 'pre-wrap';
  p.style.overflowWrap = 'anywhere';
  if (row.node.footnoteLabel !== null) {
    p.style.fontSize = '0.92em';
    p.style.opacity = '0.85';
    const labelEl = document.createElement('sup');
    labelEl.textContent = '[' + row.node.footnoteLabel + '] ';
    labelEl.style.opacity = '0.7';
    p.appendChild(labelEl);
  }
  const hasContent = row.node.lines.some((l) => l.trim() !== '');
  if (hasContent) {
    row.node.lines.forEach((line, i) => {
      if (i > 0) p.appendChild(document.createElement('br'));
      const text =
        i === 0 && row.node.footnoteLabel !== null
          ? line.replace(new RegExp('^\\[fn:' + row.node.footnoteLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\s?'), '')
          : line;
      renderInlineNodes(parseInline(stripLineBreakMarker(text), currentInlineOpts()), p);
    });
  } else {
    p.textContent = '(empty note \u2014 tap to edit)';
    p.style.opacity = '0.5';
  }
  // Tapping the text reveals the contextual menu (edit/add/delete),
  // matching list items and headings, instead of jumping straight into
  // editing and showing a standalone always-visible delete button.
  p.onclick = (e) => {
    if (e.target.closest('[data-inline-link]')) return;
    toggleActionMenu(row.node);
  };
  wrap.appendChild(p);

  let menuEl = null;
  if (actionMenuFor === row.node) {
    menuEl = renderActionMenu(
      [
        {
          icon: '\u270f\ufe0f',
          label: 'Edit text',
          onClick: () => {
            actionMenuFor = null;
            editingParagraph = { heading: row.heading, paragraph: row.node };
            render();
          },
        },
        {
          icon: '+',
          label: 'Add paragraph below',
          onClick: () => {
            actionMenuFor = null;
            const newParagraph = insertParagraphAfter(row.heading, row.node, '');
            editingParagraph = { heading: row.heading, paragraph: newParagraph };
            commitAndRender('Added paragraph');
          },
        },
        {
          icon: '\u2715',
          label: 'Delete note',
          onClick: () => {
            if (!confirmParagraphDelete(row.node)) return;
            actionMenuFor = null;
            deleteParagraph(row.heading, row.node);
            commitAndRender('Deleted paragraph');
          },
        },
      ],
      3
    );
  }

  return withActionMenu(wrap, menuEl);
}

/** Read-only block content (#+BEGIN_SRC/QUOTE/EXAMPLE/etc.), gated by
 *  the owning heading's drawersHidden flag (see fold-state.js -- shared
 *  with property-drawer visibility, since real org-mode's showall/
 *  showeverything distinction treats drawers and blocks as one group).
 *  Shows an honest "collapsed block" placeholder when hidden, actual
 *  content when not. No editing support here (there's no body-edit.js
 *  function for it yet) -- this is visibility only, matching what was
 *  actually asked for. Tapping toggles drawersHidden for the whole
 *  heading (its actual granularity -- one flag covers every block AND
 *  every property under a heading, not each individually), landing on
 *  the header label specifically when expanded so selecting/copying the
 *  code itself doesn't
 *  accidentally re-collapse it. */
/**
 * Renders a block's own content appropriately for its name, appending
 * to `container`. QUOTE, VERSE, and CENTER all interpret inline
 * markup within them, matching real org's own actual behavior for
 * these three specifically -- they're meant to hold normal prose,
 * just displayed differently, not literal/verbatim content the way
 * SRC and EXAMPLE are. Everything else (SRC, EXAMPLE, or any other/
 * custom block name) falls through to the original, unchanged
 * literal <pre><code> treatment -- no markup interpretation, content
 * shown byte-for-byte.
 */
function renderBlockContent(block, container, linkContext) {
  const name = block.name;

  if (name === 'VERSE') {
    // One source line is always one visual line -- never reflowed or
    // merged with an adjacent line the way ordinary paragraph text
    // is, matching real org's own defining characteristic of a verse
    // block. Each line gets its own block-level element, which
    // preserves the break naturally without needing white-space: pre
    // at all (unlike the literal SRC/EXAMPLE case, this can still
    // word-wrap a too-long single line, since only the *line breaks
    // between* source lines need preserving here, not the wrapping
    // within one). The hard-line-break marker is stripped but has no
    // extra effect here -- every line already breaks regardless.
    const verse = document.createElement('div');
    verse.style.padding = '4px 12px';
    verse.style.fontStyle = 'italic';
    for (const line of block.lines) {
      const lineEl = document.createElement('div');
      const stripped = stripLineBreakMarker(line);
      if (stripped.trim() === '') {
        lineEl.innerHTML = '&nbsp;'; // a blank verse line is still a real, visible line break, not nothing
      } else {
        renderInlineNodes(parseInline(stripped, currentInlineOpts()), lineEl, linkContext);
      }
      verse.appendChild(lineEl);
    }
    container.appendChild(verse);
    return;
  }

  if (name === 'QUOTE' || name === 'CENTER') {
    const wrap = document.createElement('div');
    if (name === 'QUOTE') {
      // Indented on BOTH the left and right margins, plus a left
      // border -- a conventional blockquote treatment, and the
      // specific thing real org's own manual describes ("indented on
      // both the left and the right margin").
      wrap.style.padding = '4px 16px';
      wrap.style.margin = '4px 0';
      wrap.style.borderLeft = '3px solid var(--border)';
      wrap.style.fontStyle = 'italic';
    } else {
      wrap.style.padding = '4px 12px';
      wrap.style.textAlign = 'center';
    }
    // Blank-line-separated paragraphs, each one reflowing its own
    // lines together normally (matching ordinary prose -- the actual
    // distinction from VERSE above) UNLESS a line ends with the
    // hard-line-break marker, which forces a real break at that point
    // instead of just joining into the next line with a space. This
    // is the one place in this app where the marker does something a
    // plain per-line join wouldn't already do on its own.
    let currentParagraphLines = [];
    const flushParagraph = () => {
      if (currentParagraphLines.length === 0) return;
      const p = document.createElement('p');
      p.style.margin = '4px 0';
      currentParagraphLines.forEach((line, i) => {
        if (i > 0) {
          const prevLine = currentParagraphLines[i - 1];
          const prevForcedBreak = stripLineBreakMarker(prevLine) !== prevLine;
          p.appendChild(prevForcedBreak ? document.createElement('br') : document.createTextNode(' '));
        }
        renderInlineNodes(parseInline(stripLineBreakMarker(line), currentInlineOpts()), p, linkContext);
      });
      wrap.appendChild(p);
      currentParagraphLines = [];
    };
    for (const line of block.lines) {
      if (line.trim() === '') {
        flushParagraph();
      } else {
        currentParagraphLines.push(line.trim());
      }
    }
    flushParagraph();
    container.appendChild(wrap);
    return;
  }

  // SRC, EXAMPLE, or any other/custom name -- literal, verbatim, no
  // markup interpretation, unchanged from before.
  const pre = document.createElement('pre');
  pre.style.margin = '2px 0';
  pre.style.padding = '8px';
  pre.style.background = 'var(--surface)';
  pre.style.borderRadius = '6px';
  pre.style.overflowX = 'auto';
  pre.style.fontSize = '13px';
  pre.style.whiteSpace = 'pre-wrap';
  const code = document.createElement('code');
  code.style.fontFamily = 'monospace';
  code.textContent = block.lines.join('\n');
  pre.appendChild(code);
  container.appendChild(pre);
}

function renderBlockRow(row) {
  const wrap = document.createElement('div');
  wrap.style.paddingLeft = 8 + row.depth * 16 + 'px';
  wrap.style.margin = '4px 0';

  const label = row.node.name + (row.node.params ? ' ' + row.node.params : '');

  if (row.heading.drawersHidden) {
    const placeholder = document.createElement('div');
    placeholder.style.cursor = 'pointer';
    placeholder.style.opacity = '0.6';
    placeholder.style.fontStyle = 'italic';
    placeholder.style.fontSize = '13px';
    placeholder.textContent = '\u25b8 ' + label + ' (collapsed block \u2014 tap to reveal)';
    placeholder.onclick = () => {
      row.heading.drawersHidden = false;
      render();
    };
    wrap.appendChild(placeholder);
    return wrap;
  }

  const header = document.createElement('div');
  header.style.fontSize = '11px';
  header.style.opacity = '0.6';
  header.style.fontFamily = 'monospace';
  header.style.cursor = 'pointer';
  header.textContent = '\u25be ' + label;
  header.onclick = () => {
    row.heading.drawersHidden = true;
    render();
  };
  wrap.appendChild(header);

  renderBlockContent(row.node, wrap, null);

  return wrap;
}

/** On a wide layout, Settings/Docs render into #sidePanel instead of
 *  replacing #outline outright — called at the very start of render()
 *  so every existing caller gets this "for free" without individually
 *  needing to know about it. On a narrow layout, this is a complete
 *  no-op: #sidePanel stays hidden, and render()'s own guards below
 *  still fully own #outline exactly as before this feature existed. */
function syncSidePanel() {
  const wide = isWideLayout();
  if (wide && settingsOpen) {
    sidePanelEl.style.display = 'block';
    renderSettingsView(sidePanelEl);
  } else if (wide && docsOpen) {
    sidePanelEl.style.display = 'block';
    renderDocsView(sidePanelEl);
  } else {
    sidePanelEl.style.display = 'none';
    sidePanelEl.innerHTML = '';
  }
}

function render() {
  updateFilenameDisplay();
  syncSidePanel();
  syncExtraMenuButtonVisibility();

  const wide = isWideLayout();
  // renderSettingsView()/renderDocsView() own #outline while showing —
  // but only on a narrow layout; on a wide one, syncSidePanel above
  // already routed them to #sidePanel instead, so #outline should keep
  // rendering normally below rather than being replaced too.
  if (settingsOpen && !wide) return;
  if (docsOpen && !wide) return;

  if (!state.doc) {
    outlineEl.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Open an .org file to get started.';
    outlineEl.appendChild(empty);
    return;
  }

  if (currentView === 'text') {
    outlineEl.innerHTML = '';
    const textarea = document.createElement('textarea');
    textarea.id = 'document-text-edit-input';
    const fullText = serializeOrg(state.doc);
    textarea.value = fullText;
    textarea.style.width = '100%';
    textarea.style.boxSizing = 'border-box';
    textarea.style.height = VH_UNIT === 'dvh' ? 'calc(100dvh - 160px)' : 'calc(100vh - 160px)';
    textarea.style.font = 'ui-monospace, monospace';
    textarea.style.fontSize = '13px';
    textarea.style.padding = '10px';
    textarea.style.border = 'none';
    textarea.spellcheck = false;
    outlineEl.appendChild(textarea);

    // Land near wherever the person last explicitly navigated to
    // (a search result, an internal link) rather than always resetting
    // to the top of the file -- losing that context on every switch
    // into the plain-text editor was the actual complaint this fixes.
    // findHeadingLineNumber returns -1 for a stale reference (the
    // heading was deleted, or nothing was ever navigated to this
    // session), which falls through to the original top-of-file
    // behavior below.
    const lines = fullText.split('\n');
    const targetLine = currentContextHeading ? findHeadingLineNumber(state.doc, currentContextHeading) : -1;

    if (targetLine >= 0) {
      let charOffset = 0;
      for (let i = 0; i < targetLine; i++) charOffset += lines[i].length + 1; // +1 for the newline each line consumed
      textarea.setSelectionRange(charOffset, charOffset);
      // Scroll proportionally to the target line's fraction of the
      // total line count -- an approximation, not an exact per-line
      // pixel position (which would need the textarea's actual
      // rendered line height, itself variable once a long line wraps).
      // "Near the same line" is the actual goal here, not pixel-exact
      // positioning.
      requestAnimationFrame(() => {
        textarea.focus();
        const fraction = targetLine / Math.max(1, lines.length - 1);
        textarea.scrollTop = fraction * (textarea.scrollHeight - textarea.clientHeight);
      });
      return;
    }

    // Setting .value moves the caret to the end of the text by default in
    // most browsers, and focus() scrolls to keep the caret in view — that
    // combination is exactly why text mode used to open scrolled all the
    // way to the bottom of the file instead of the top. Explicitly
    // resetting both the selection and the scroll position fixes it.
    textarea.scrollTop = 0;
    textarea.setSelectionRange(0, 0);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.scrollTop = 0; // re-assert: some browsers scroll-to-caret again on focus
    });
    return;
  }

  if (currentView === 'agenda') {
    renderAgendaView();
    return;
  }

  if (currentView === 'tasklist') {
    renderTaskListView();
    return;
  }

  const rows = flattenVisibleRows(state.doc);
  if (rows.length === 0) {
    outlineEl.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Empty file \u2014 no headings yet.';
    outlineEl.appendChild(empty);
    return;
  }

  // While a heading's combined body text is being edited as one block
  // (editingHeadingText), ALL of its body content — list items,
  // paragraphs, tables, blocks, everything — is covered by that one
  // editor, not just paragraphs. Every body-content row carries a
  // `.heading` reference to its owning heading, so this hides exactly the
  // rows that belong to the heading being edited, without touching a
  // sub-heading's own content (which has its own `.heading` reference).
  const visibleRows = editingHeadingText
    ? rows.filter((r) => r.rowType === 'heading' || r.heading !== editingHeadingText)
    : rows;

  const todoSequence = resolveTodoSequence(state.doc, GLOBAL_TODO_DEFAULT);

  // Build the new row elements off-DOM (a DocumentFragment has no layout
  // box, so appending into it triggers no reflow), then swap the whole
  // thing into the live container in one operation, instead of clearing
  // outlineEl and appendChild-ing each row directly onto an already
  // on-screen, already-laid-out element.
  const fragment = document.createDocumentFragment();
  for (const row of visibleRows) fragment.appendChild(renderRow(row, todoSequence));
  outlineEl.innerHTML = '';
  outlineEl.appendChild(fragment);

  if (
    editingHeading ||
    editingCell ||
    editingParagraph ||
    editingListItem ||
    editingHeadingText ||
    editingGeneral
  ) {
    requestAnimationFrame(() => {
      const input =
        document.getElementById('title-edit-input') ||
        document.getElementById('cell-edit-input') ||
        document.getElementById('listitem-edit-input') ||
        document.getElementById('heading-text-edit-input') ||
        document.getElementById('paragraph-edit-input');
      if (input) {
        input.focus();
        // Cursor at the end, not select-all: selecting the whole value
        // by default means the very next keystroke silently replaces
        // everything the user typed before — an easy, real way to lose
        // a heading or task's text by accident. Positioning at the end
        // instead lets typing append naturally; tapping anywhere in the
        // field (or selecting manually) still works exactly as normal.
        if (typeof input.setSelectionRange === 'function') {
          const end = input.value.length;
          input.setSelectionRange(end, end);
        }
      }
    });
  }
}

function storageKindLabel(kind) {
  if (kind === 'github') return 'GitHub';
  if (kind === 'webdav') return 'WebDAV';
  if (kind === 'input') return 'Imported';
  return 'Local';
}

/** Single source of truth for the filename display, including the
 *  "modified" indicator — called from render() itself (so it's always
 *  current on every render, without needing every call site that changes
 *  state.documentId/storageKind/isDirty to separately remember to update
 *  it) rather than being set ad hoc in half a dozen different places. */
function updateFilenameDisplay() {
  if (!state.documentId) {
    filenameEl.textContent = 'No file open';
    filenameEl.style.color = '';
    filenameEl.style.opacity = '';
    return;
  }
  filenameEl.textContent = state.documentId + ' (' + storageKindLabel(state.storageKind) + ')';
  filenameEl.style.color = isDirty ? '#c0392b' : '';
  filenameEl.style.opacity = isDirty ? '1' : ''; // full opacity when modified so the red actually stands out, not dimmed by the element's own default 0.7
}

/** Common finish-up after any successful open/create, regardless of which
 *  backend it came from. */
async function afterDocumentLoaded(documentId, doc, storageKind, resumedFromCache = false) {
  externalChangeDismissedHash = null;
  hideExternalChangeBanner();
  const rawLocalVars = parseLocalVariables(serializeOrg(doc));
  const startupConfig = resolveEffectiveStartupConfig(doc, rawLocalVars, globalVariables);
  const localVariables = mergeGlobalAndLocalVariables(globalVariables, rawLocalVars);
  const archiveVisibility = getCycleOpenArchivedTrees(localVariables) ? 'noarchived' : 'archived';
  applyStartupVisibility(doc, startupConfig, archiveVisibility);
  state = { documentId, doc, startupConfig, storageKind, localVariables };
  const openedText = serializeOrg(doc);
  history = createHistory(openedText, resumedFromCache ? 'Opened (resumed unsaved local version)' : 'Opened');
  historyOpen = false;
  lastSavedText = resumedFromCache ? null : openedText;
  // A resumed local version is, by definition, different from whatever's
  // actually on disk/GitHub/WebDAV right now -- that's the whole reason it
  // was worth resuming instead of just discarding. isDirty reflects that
  // correctly here rather than starting false and getting corrected
  // separately by every caller after the fact, which is exactly what let
  // this go silently unexplained before: the filename would show modified
  // with nothing in the history log to say why, since the label above is
  // the only place that actually says what happened.
  isDirty = resumedFromCache;
  await setLastActiveDocument(kv, documentId, storageKind);
  currentView = 'org';
  agendaAnchorDate = new Date();
  addBtn.disabled = false;
  viewMenuBtn.disabled = false;
  searchBtn.disabled = false;
  captureBtn.disabled = false;
  moreBtn.disabled = false;
  searchOpen = false;
  searchQuery = '';
  renderSearchPanel();
  viewMenuOpen = false;
  renderViewMenu();
  settingsOpen = false;
  closeFileMenu();
  render();
}

// ---- Open --------------------------------------------------------------

/**
 * Checks for a pending, unsynced local edit before opening `documentId`
 * fresh from disk/GitHub/WebDAV/import. Returns `{ preferCache: boolean }`.
 *
 * Both choices actually open the file — that's the fix. A previous
 * version's "Cancel" choice here just aborted with a status message
 * ("unsaved local changes were kept") and no way back to them: the edit
 * sat untouched in IndexedDB, but there was no UI path to ever see it
 * again. "Kept" should mean "shown", not "kept invisible somewhere".
 */
async function resolvePendingChangeChoice(documentId) {
  const pending = await getPendingChange(kv, documentId);
  if (!pending) return { preferCache: false };
  const when = formatPendingChangeTimestamp(pending.queuedAt);
  const resumeLocal = window.confirm(
    `"${documentId}" has local changes from ${when} that were never saved.\n\n` +
      'OK = resume those unsaved changes\n' +
      'Cancel = discard them and load the current version'
  );
  if (!resumeLocal) await clearPendingChange(kv, documentId);
  return { preferCache: resumeLocal };
}

/** A short, readable rendering of an outbox entry's queuedAt timestamp
 *  for the discard/resume prompt -- "from an earlier session" was too
 *  vague to judge whether a pending edit was worth resuming or safely
 *  ignorable; showing exactly when it happened lets the person decide
 *  for themselves. Falls back to the generic wording if the timestamp
 *  is missing or unparseable, rather than showing "Invalid Date". */
function formatPendingChangeTimestamp(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return 'an earlier session';
  return d.toLocaleString();
}

async function openFromFilesystem() {
  if (commitTextModeIfActive()) render();
  if (!isFileSystemAccessSupported()) {
    setStatus('This browser lacks File System Access support.');
    return;
  }
  try {
    const documentId = await pickAndRegisterFile(kv);
    const { preferCache } = await resolvePendingChangeChoice(documentId);
    await markDocumentOpen(kv, documentId);
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

async function openFromImport() {
  if (commitTextModeIfActive()) render();
  try {
    const { fileId } = await pickAndImportFile(kv);
    const { preferCache } = await resolvePendingChangeChoice(fileId);
    await markDocumentOpen(kv, fileId);
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
async function openRemotePath(path, kind, diskAdapter, label) {
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
async function openFileLink(resolution) {
  let adapter, kind, label;
  if (resolution.scheme === 'github') {
    adapter = githubAdapter;
    kind = 'github';
    label = 'GitHub';
  } else if (resolution.scheme === 'webdav') {
    adapter = webdavAdapter;
    kind = 'webdav';
    label = 'WebDAV';
  } else {
    // 'file' scheme, no explicit backend named — use whichever backend
    // the CURRENT document itself came from.
    if (state.storageKind !== 'github' && state.storageKind !== 'webdav') {
      setStatus(
        `Can't open "${resolution.path}" automatically \u2014 local files need a file picker per file (browser security), which can't happen from a link tap. Use a github:/webdav: link explicitly, or open it via File \u2192 Open.`
      );
      return;
    }
    adapter = activeDiskAdapter();
    kind = state.storageKind;
    label = state.storageKind === 'github' ? 'GitHub' : 'WebDAV';
  }

  const resolvedPath = resolveImagePath(resolution.path, state.documentId);
  await openRemotePath(resolvedPath, kind, adapter, label);

  // openRemotePath catches and reports its own errors via setStatus
  // rather than throwing — the only reliable way to tell whether it
  // actually succeeded is checking that state now points at the
  // target document, before attempting to navigate within it.
  if (!resolution.inFileTarget || !state.doc || state.documentId !== resolvedPath) return;

  const target = resolution.inFileTarget;
  if (target.startsWith('*')) {
    const headingTitle = target.slice(1).trim();
    const heading = findHeadingByTitle(state.doc, headingTitle);
    if (heading) {
      navigateToHeading(heading);
    } else {
      setStatus(`Opened ${resolvedPath}, but couldn't find the heading "${headingTitle}".`);
    }
    return;
  }

  const results = searchDocument(state.doc, target, {
    useTagInheritance: getUseTagInheritance(state.localVariables),
    usePropertyInheritance: getUsePropertyInheritance(state.localVariables),
  });
  if (results.length > 0) {
    navigateToHeading(results[0].heading, { revealOwnBody: results[0].type !== 'heading', targetNode: results[0].node });
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
function startBrowsing(backend) {
  browseBackend = backend;
  browsePath = '';
  browseEntries = null;
  browseError = null;
  renderFileMenu();
  loadBrowseEntries();
}

/** Fetches the listing for the current browsePath from whichever
 *  adapter browseBackend points at, updating browseEntries/browseError
 *  and re-rendering when done. Split out from startBrowsing so
 *  navigating into a folder (which doesn't reset browsePath to root)
 *  can call just this part again. */
async function loadBrowseEntries() {
  const adapter = browseBackend === 'github' ? githubAdapter : webdavAdapter;
  const requestedPath = browsePath; // captured now -- if the user navigates again before this resolves, a stale response must not overwrite the newer one
  browseEntries = null;
  browseError = null;
  renderFileMenu();
  try {
    const entries = await adapter.list(requestedPath);
    if (requestedPath !== browsePath || !browseBackend) return; // superseded by a newer navigation, or the browser was closed while this was in flight
    browseEntries = entries;
  } catch (err) {
    if (requestedPath !== browsePath || !browseBackend) return;
    browseError = err.message;
  }
  renderFileMenu();
}

async function openGithubByPrompt() {
  if (commitTextModeIfActive()) render();
  const config = await getGithubConfig(kv);
  githubConfig = config;
  const path = window.prompt(`Path of the file in ${config.owner}/${config.repo} (e.g. notes.org):`);
  if (!path) return;
  await openRemotePath(path, 'github', githubAdapter, 'GitHub');
}

async function openFromGithub() {
  if (commitTextModeIfActive()) render();
  const config = await getGithubConfig(kv);
  githubConfig = config;
  if (!isGithubConfigured(config)) {
    setStatus('GitHub is not set up yet \u2014 open Settings first.');
    closeFileMenu();
    return;
  }
  startBrowsing('github');
}

async function openWebdavByPrompt() {
  if (commitTextModeIfActive()) render();
  const config = await getWebdavConfig(kv);
  webdavConfig = config;
  const path = window.prompt('Path of the file on the WebDAV server (e.g. notes.org):');
  if (!path) return;
  await openRemotePath(path, 'webdav', webdavAdapter, 'WebDAV');
}

async function openFromWebdav() {
  if (commitTextModeIfActive()) render();
  const config = await getWebdavConfig(kv);
  webdavConfig = config;
  if (!isWebdavConfigured(config)) {
    setStatus('WebDAV is not set up yet \u2014 open Settings first.');
    closeFileMenu();
    return;
  }
  startBrowsing('webdav');
}

// ---- New ---------------------------------------------------------------

async function newOnFilesystem() {
  if (commitTextModeIfActive()) render();
  if (!isFileSystemAccessSupported()) {
    setStatus('This browser lacks File System Access support.');
    return;
  }
  try {
    const documentId = await pickAndRegisterNewFile(kv);
    await markDocumentOpen(kv, documentId);
    const doc = parseOrg('');
    await afterDocumentLoaded(documentId, doc, 'filesystem');
    // Establish real (empty) content on disk right away, rather than
    // leaving the picked file however the browser happened to create it.
    await saveAndSync({
      documentId,
      doc,
      kvAdapter: kv,
      diskAdapter: filesystemAdapter,
      resolveConflict: ALWAYS_KEEP_MINE,
    });
    setStatus('Created.');
  } catch (err) {
    if (err.name !== 'AbortError') setStatus('Could not create file: ' + err.message);
  }
}

async function newOnGithub() {
  if (commitTextModeIfActive()) render();
  const config = await getGithubConfig(kv);
  githubConfig = config;
  if (!isGithubConfigured(config)) {
    setStatus('GitHub is not set up yet \u2014 open Settings first.');
    closeFileMenu();
    return;
  }
  const path = window.prompt(`Path for the new file in ${config.owner}/${config.repo} (e.g. notes.org):`);
  if (!path) return;
  try {
    if (await githubAdapter.exists(path)) {
      setStatus(`"${path}" already exists on GitHub \u2014 use Open instead.`);
      return;
    }
    await markDocumentOpen(kv, path);
    const doc = parseOrg('');
    await afterDocumentLoaded(path, doc, 'github');
    await saveAndSync({ documentId: path, doc, kvAdapter: kv, diskAdapter: githubAdapter });
    setStatus('Created on GitHub.');
  } catch (err) {
    setStatus('Could not create file on GitHub: ' + err.message);
  }
}

async function newOnWebdav() {
  if (commitTextModeIfActive()) render();
  const config = await getWebdavConfig(kv);
  webdavConfig = config;
  if (!isWebdavConfigured(config)) {
    setStatus('WebDAV is not set up yet \u2014 open Settings first.');
    closeFileMenu();
    return;
  }
  const path = window.prompt('Path for the new file on the WebDAV server (e.g. notes.org):');
  if (!path) return;
  try {
    if (await webdavAdapter.exists(path)) {
      setStatus(`"${path}" already exists on the server \u2014 use Open instead.`);
      return;
    }
    await markDocumentOpen(kv, path);
    const doc = parseOrg('');
    await afterDocumentLoaded(path, doc, 'webdav');
    await saveAndSync({ documentId: path, doc, kvAdapter: kv, diskAdapter: webdavAdapter });
    setStatus('Created on WebDAV.');
  } catch (err) {
    setStatus('Could not create file on WebDAV: ' + err.message);
  }
}

async function newViaImport() {
  if (commitTextModeIfActive()) render();
  const name = window.prompt('File name (e.g. notes.org):', 'untitled.org');
  if (!name) return;
  const doc = parseOrg('');
  await markDocumentOpen(kv, name);
  await afterDocumentLoaded(name, doc, 'input');
  setStatus('Created \u2014 use Save to download it, then keep it in Files.');
}

// ---- Save / Save As --------------------------------------------------

async function saveCurrent() {
  if (!state.documentId) return;
  if (commitTextModeIfActive()) render();
  setStatus('Saving\u2026');
  try {
    const result = await saveAndSync({
      documentId: state.documentId,
      doc: state.doc,
      kvAdapter: kv,
      diskAdapter: activeDiskAdapter(),
      resolveConflict: async () => {
        // v1 conflict UI: a plain confirm dialog, per the "simple, no
        // diff/merge view" storage decision. A real UI would replace only
        // this callback \u2014 everything else stays the same.
        const keepMine = window.confirm(
          'This file changed since this app last synced it.\n\nOK = keep your version (overwrite)\nCancel = keep the other version (discard your local edit)'
        );
        return keepMine ? 'mine' : 'disk';
      },
    });
    if (result.status === 'conflict' && result.resolution === 'disk') {
      await reloadCurrentDocumentFromDisk();
    }
    isDirty = false;
    lastSavedText = serializeOrg(state.doc);
    render();
    setStatus('Saved (' + result.status + ').');
  } catch (err) {
    setStatus('Save failed: ' + err.message);
  }
  closeFileMenu();
}

// New (on filesystem) and Save As all keep "mine" on conflict — there's
// no ambiguity to negotiate here the way there is for a background Save:
// the user just explicitly chose this destination (via the native save
// picker) and explicitly wants their current content written there.
// syncDocument's conflict detection treats "no prior sync history for
// this documentId" the same as "disk changed since we last knew about
// it" — which is true of every single New/Save As to any path, since
// showSaveFilePicker creates the file (even if empty) the moment the
// picker resolves, before this code ever calls write(). Without this
// callback, every New or Save As throws instead of saving; this is the
// fix for that, and it always resolves in favor of the content actually
// on screen, which is what both actions mean.
const ALWAYS_KEEP_MINE = async () => 'mine';

async function saveAsFilesystem() {
  if (!state.doc) return;
  if (commitTextModeIfActive()) render();
  if (!isFileSystemAccessSupported()) {
    setStatus('This browser lacks File System Access support.');
    return;
  }
  try {
    const documentId = await pickAndRegisterNewFile(kv, state.documentId || 'untitled.org');
    state.documentId = documentId;
    state.storageKind = 'filesystem';
    await markDocumentOpen(kv, documentId);
    await saveAndSync({
      documentId,
      doc: state.doc,
      kvAdapter: kv,
      diskAdapter: filesystemAdapter,
      resolveConflict: ALWAYS_KEEP_MINE,
    });
    isDirty = false;
    lastSavedText = serializeOrg(state.doc);
    setStatus('Saved as ' + documentId + '.');
    closeFileMenu();
    render();
  } catch (err) {
    if (err.name !== 'AbortError') setStatus('Save As failed: ' + err.message);
  }
}

async function saveAsGithub() {
  if (!state.doc) return;
  if (commitTextModeIfActive()) render();
  const config = await getGithubConfig(kv);
  githubConfig = config;
  if (!isGithubConfigured(config)) {
    setStatus('GitHub is not set up yet \u2014 open Settings first.');
    closeFileMenu();
    return;
  }
  const path = window.prompt(
    `Save to which path in ${config.owner}/${config.repo}?`,
    state.documentId || 'notes.org'
  );
  if (!path) return;
  try {
    state.documentId = path;
    state.storageKind = 'github';
    await markDocumentOpen(kv, path);
    await saveAndSync({
      documentId: path,
      doc: state.doc,
      kvAdapter: kv,
      diskAdapter: githubAdapter,
      resolveConflict: ALWAYS_KEEP_MINE,
    });
    isDirty = false;
    lastSavedText = serializeOrg(state.doc);
    setStatus('Saved to GitHub as ' + path + '.');
    closeFileMenu();
    render();
  } catch (err) {
    setStatus('Save As failed: ' + err.message);
  }
}

async function saveAsWebdav() {
  if (!state.doc) return;
  if (commitTextModeIfActive()) render();
  const config = await getWebdavConfig(kv);
  webdavConfig = config;
  if (!isWebdavConfigured(config)) {
    setStatus('WebDAV is not set up yet \u2014 open Settings first.');
    closeFileMenu();
    return;
  }
  const path = window.prompt('Save to which path on the WebDAV server?', state.documentId || 'notes.org');
  if (!path) return;
  try {
    state.documentId = path;
    state.storageKind = 'webdav';
    await markDocumentOpen(kv, path);
    await saveAndSync({
      documentId: path,
      doc: state.doc,
      kvAdapter: kv,
      diskAdapter: webdavAdapter,
      resolveConflict: ALWAYS_KEEP_MINE,
    });
    isDirty = false;
    lastSavedText = serializeOrg(state.doc);
    setStatus('Saved to WebDAV as ' + path + '.');
    closeFileMenu();
    render();
  } catch (err) {
    setStatus('Save As failed: ' + err.message);
  }
}

async function saveAsImport() {
  if (!state.doc) return;
  if (commitTextModeIfActive()) render();
  const name = window.prompt('File name to save as:', state.documentId || 'untitled.org');
  if (!name) return;
  state.documentId = name;
  state.storageKind = 'input';
  try {
    await markDocumentOpen(kv, name);
    await saveAndSync({
      documentId: name,
      doc: state.doc,
      kvAdapter: kv,
      diskAdapter: inputFileAdapter,
      resolveConflict: ALWAYS_KEEP_MINE,
    });
    isDirty = false;
    lastSavedText = serializeOrg(state.doc);
    setStatus('Downloaded as ' + name + '.');
    closeFileMenu();
    render();
  } catch (err) {
    setStatus('Save As failed: ' + err.message);
  }
}

// ---- File menu UI -------------------------------------------------------

/**
 * Makes a textarea grow to fit its content instead of scrolling
 * internally — appropriate for a focused edit (a heading's text, its
 * properties, a single paragraph), where the amount of content is
 * modest and scrolling inside a small box just to see what you're
 * editing is more friction than it's worth. Deliberately NOT used for
 * the whole-document plain-text editor (View → Text), which stays
 * bounded with its own internal scroll — that one really can hold an
 * entire file's worth of text, where growing the whole page to fit it
 * would defeat the fixed-app-shell layout instead of serving it.
 */
function autoGrowTextarea(textarea) {
  textarea.style.resize = 'none';
  textarea.style.overflow = 'hidden';
  const resize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  };
  textarea.addEventListener('input', resize);
  // Called once immediately, after the caller has set the textarea's
  // initial value — sizes it correctly from the start rather than only
  // growing in response to the user's own typing.
  requestAnimationFrame(resize);
}

function menuButton(label, onClick, disabled) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.disabled = !!disabled;
  btn.onclick = onClick;
  return btn;
}

/** Wraps menuButton() with alias-lookup support for the four menu-
 *  alias variables (org-xx-file-menu/org-xx-more-menu/org-xx-export-menu/
 *  org-xx-view-menu -- see src/menu-alias.js's own docs for the full
 *  "Label;alias" syntax and semantics). `aliasMap` is that variable's
 *  own already-parsed lookup table; `label` is this specific button's
 *  real, built-in name (what a caller would look it up by, and what
 *  displays if nothing overrides it).
 *
 *  Returns null if this button has been explicitly omitted (an empty
 *  alias, "Label;" with nothing after the semicolon) -- callers should
 *  only append the return value to their row if it's non-null, e.g.
 *  `const btn = aliasedMenuButton(aliases, 'New', onClick); if (btn)
 *  row.appendChild(btn);`.
 *
 *  Every returned button gets flex:1, so a menu row always fills its
 *  available horizontal width evenly across however many buttons
 *  actually end up visible -- omitting some doesn't leave a gap where
 *  they used to be, the remaining ones simply grow to fill it. */
function aliasedMenuButton(aliasMap, label, onClick, disabled) {
  const alias = aliasMap ? aliasMap[label] : undefined;
  if (alias === '') return null; // explicitly omitted
  const btn = menuButton(alias || label, onClick, disabled);
  btn.style.flex = '1';
  if (alias) btn.setAttribute('aria-label', label); // preserve the real meaning for accessibility once the visible text is just an icon/short alias
  return btn;
}

/** Same idea as menuButton, but with explicit comfortable sizing
 *  (matching the .panel button convention) for use outside a
 *  .panel-classed container — e.g. the timestamp wizard's Save/Cancel,
 *  which otherwise fell back to bare, unstyled, visually cramped
 *  buttons since nothing in their ancestor chain provided sizing. */
function wizardButton(label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.onclick = onClick;
  btn.style.flex = '1';
  btn.style.fontSize = '15px';
  btn.style.padding = '10px 14px';
  btn.style.minHeight = '44px';
  return btn;
}

/** Same explicit sizing as wizardButton (needed outside a .panel-
 *  classed container, where the app's normal button styling doesn't
 *  reach) but WITHOUT flex:1 -- for a button meant to sit alongside a
 *  sibling in the same row, sized to its own content, rather than
 *  stretching alone to fill the whole row the way a lone wizardButton
 *  is meant to. */
function tableActionButton(label, onClick, disabled) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.disabled = !!disabled;
  btn.onclick = onClick;
  btn.style.flex = '1';
  btn.style.fontSize = '15px';
  btn.style.padding = '10px 14px';
  btn.style.minHeight = '44px';
  return btn;
}

function closeFileMenu() {
  fileMenuOpen = false;
  fileMenuStep = null;
  exportFormat = null;
  exportPickingHeading = false;
  stopBrowsing();
  renderFileMenu();
}

function renderFileMenu() {
  fileMenuPanel.innerHTML = '';
  if (!fileMenuOpen) {
    fileMenuPanel.style.display = 'none';
    return;
  }
  fileMenuPanel.style.display = 'block';

  if (fileMenuStep === null) {
    const row = document.createElement('div');
    row.className = 'panel-row';
    const fileMenuAliases = parseMenuAliases(getFileMenuAliases(state.localVariables));
    const newBtn = aliasedMenuButton(fileMenuAliases, 'New', () => {
      fileMenuStep = 'new';
      renderFileMenu();
    });
    if (newBtn) row.appendChild(newBtn);
    const openBtn = aliasedMenuButton(fileMenuAliases, 'Open', () => {
      fileMenuStep = 'open';
      renderFileMenu();
    });
    if (openBtn) row.appendChild(openBtn);
    const saveBtn = aliasedMenuButton(fileMenuAliases, 'Save', () => saveCurrent(), !state.documentId);
    if (saveBtn) row.appendChild(saveBtn);
    const saveAsBtn = aliasedMenuButton(
      fileMenuAliases,
      'Save As',
      () => {
        fileMenuStep = 'saveas';
        renderFileMenu();
      },
      !state.doc
    );
    if (saveAsBtn) row.appendChild(saveAsBtn);
    const exportBtn = aliasedMenuButton(
      fileMenuAliases,
      'Export',
      () => {
        fileMenuStep = 'export';
        exportFormat = null;
        renderFileMenu();
      },
      !state.doc
    );
    if (exportBtn) row.appendChild(exportBtn);
    fileMenuPanel.appendChild(row);
    return;
  }

  if (fileMenuStep === 'export') {
    renderExportFlow();
    return;
  }

  if (browseBackend) {
    renderFileBrowser();
    return;
  }

  const label = document.createElement('div');
  label.style.fontSize = '12px';
  label.style.opacity = '0.7';
  label.style.marginBottom = '4px';
  label.textContent =
    fileMenuStep === 'open' ? 'Open from:' : fileMenuStep === 'new' ? 'New file on:' : 'Save a copy to:';
  fileMenuPanel.appendChild(label);

  const btnRow = document.createElement('div');
  btnRow.className = 'panel-row';

  if (!isFileSystemAccessUnsupported()) {
    btnRow.appendChild(
      menuButton('Local file', () => {
        if (fileMenuStep === 'open') openFromFilesystem();
        else if (fileMenuStep === 'new') newOnFilesystem();
        else saveAsFilesystem();
      })
    );
  } else {
    // This platform has no File System Access API at all (every browser
    // on iOS) — offer the read-once/download-based fallback instead.
    btnRow.appendChild(
      menuButton(fileMenuStep === 'open' ? 'Import file\u2026' : 'Local (download)', () => {
        if (fileMenuStep === 'open') openFromImport();
        else if (fileMenuStep === 'new') newViaImport();
        else saveAsImport();
      })
    );
  }

  btnRow.appendChild(
    menuButton('GitHub', () => {
      if (fileMenuStep === 'open') openFromGithub();
      else if (fileMenuStep === 'new') newOnGithub();
      else saveAsGithub();
    })
  );

  btnRow.appendChild(
    menuButton('WebDAV', () => {
      if (fileMenuStep === 'open') openFromWebdav();
      else if (fileMenuStep === 'new') newOnWebdav();
      else saveAsWebdav();
    })
  );

  fileMenuPanel.appendChild(btnRow);
}

/** Closes the file browser, returning to the "which backend" button
 *  row -- used by both Cancel and after successfully opening a file
 *  (since the file menu itself also closes right after, but leaving
 *  stale browse state around would show it again if File \u2192 Open got
 *  reopened without going through startBrowsing first). */
/** Collects every heading in `doc`, in document order, regardless of
 *  fold state -- a heading buried under several collapsed ancestors
 *  must still be pickable as an export scope, unlike keyboard
 *  navigation (which only moves between currently-visible rows). */
function allHeadingsInOrder(doc) {
  const out = [];
  function walk(nodes, depth) {
    for (const node of nodes) {
      if (node.type !== 'heading') continue;
      out.push({ heading: node, depth });
      walk(node.children || [], depth + 1);
    }
  }
  walk(doc.children || [], 0);
  return out;
}

/** Generates the export text for `format`/`scope` and triggers a
 *  download -- the actual terminal step of the export flow, closing
 *  the file menu and resetting its state back to the top level once
 *  done. */
function performExport(format, scope) {
  const rawName = scope && typeof scope === 'object' ? scope.title : (state.documentId || 'export').replace(/\.[a-zA-Z0-9]+$/, '');
  const baseName = rawName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'export';
  if (format === 'ascii') {
    downloadFile(baseName + '.txt', exportToAscii(state.doc, scope, getAsciiTextWidth(state.localVariables)), 'text/plain');
  } else if (format === 'markdown') {
    downloadFile(baseName + '.md', exportToMarkdown(state.doc, scope), 'text/markdown');
  } else if (format === 'html') {
    downloadFile(baseName + '.html', exportToHtml(state.doc, scope), 'text/html');
  } else if (format === 'odt') {
    downloadFile(baseName + '.odt', exportToOdt(state.doc, scope), 'application/vnd.oasis.opendocument.text');
  } else {
    const docs = scope === 'agenda-files' ? aggregateAgendaDocs() : [{ documentId: state.documentId, doc: state.doc }];
    const icsScope = scope && typeof scope === 'object' ? scope : null;
    downloadFile(baseName + '.ics', exportToIcalendar(docs, { scope: icsScope }), 'text/calendar');
  }
  fileMenuOpen = false;
  fileMenuStep = null;
  exportFormat = null;
  exportPickingHeading = false;
  setStatus(
    `Exported to ${format === 'ascii' ? 'ASCII' : format === 'markdown' ? 'Markdown' : format === 'html' ? 'HTML' : format === 'odt' ? 'ODT' : 'Calendar (.ics)'}.`
  );
  renderFileMenu();
  render();
}

function renderExportFlow() {
  if (exportFormat === null) {
    const label = document.createElement('div');
    label.style.fontSize = '12px';
    label.style.opacity = '0.7';
    label.style.marginBottom = '4px';
    label.textContent = 'Export as:';
    fileMenuPanel.appendChild(label);

    const row = document.createElement('div');
    row.className = 'panel-row';
    const exportMenuAliases = parseMenuAliases(getExportMenuAliases(state.localVariables));
    const asciiBtn = aliasedMenuButton(exportMenuAliases, 'ASCII', () => {
      exportFormat = 'ascii';
      renderFileMenu();
    });
    if (asciiBtn) row.appendChild(asciiBtn);
    const icsBtn = aliasedMenuButton(exportMenuAliases, 'Calendar (.ics)', () => {
      exportFormat = 'icalendar';
      renderFileMenu();
    });
    if (icsBtn) row.appendChild(icsBtn);
    const htmlBtn = aliasedMenuButton(exportMenuAliases, 'HTML', () => {
      exportFormat = 'html';
      renderFileMenu();
    });
    if (htmlBtn) row.appendChild(htmlBtn);
    const mdBtn = aliasedMenuButton(exportMenuAliases, 'Markdown', () => {
      exportFormat = 'markdown';
      renderFileMenu();
    });
    if (mdBtn) row.appendChild(mdBtn);
    const odtBtn = aliasedMenuButton(exportMenuAliases, 'ODT', () => {
      exportFormat = 'odt';
      renderFileMenu();
    });
    if (odtBtn) row.appendChild(odtBtn);
    fileMenuPanel.appendChild(row);
    return;
  }

  if (exportFormat === 'icalendar' && !exportPickingHeading) {
    const label = document.createElement('div');
    label.style.fontSize = '12px';
    label.style.opacity = '0.7';
    label.style.marginBottom = '4px';
    label.textContent = 'Export Calendar (.ics) for:';
    fileMenuPanel.appendChild(label);

    const row = document.createElement('div');
    row.className = 'panel-row';
    row.appendChild(menuButton('This file', () => performExport('icalendar', null)));
    if (agendaFilesConfig.length > 0) {
      row.appendChild(
        menuButton('This file + Agenda Files', async () => {
          setStatus('Loading agenda files\u2026');
          await waitForAgendaFilesLoaded();
          performExport('icalendar', 'agenda-files');
        })
      );
    }
    row.appendChild(
      menuButton('Choose a heading\u2026', () => {
        exportPickingHeading = true;
        renderFileMenu();
      })
    );
    row.appendChild(
      menuButton('\u2039 Back', () => {
        exportFormat = null;
        renderFileMenu();
      })
    );
    fileMenuPanel.appendChild(row);
    return;
  }

  if (exportPickingHeading) {
    const label = document.createElement('div');
    label.style.fontSize = '12px';
    label.style.opacity = '0.7';
    label.style.marginBottom = '4px';
    label.textContent = 'Choose a heading:';
    fileMenuPanel.appendChild(label);

    const list = document.createElement('div');
    list.style.maxHeight = '260px';
    list.style.overflowY = 'auto';
    const headings = allHeadingsInOrder(state.doc);
    if (headings.length === 0) {
      const empty = document.createElement('div');
      empty.style.fontSize = '13px';
      empty.style.opacity = '0.6';
      empty.style.padding = '8px 0';
      empty.textContent = 'This file has no headings yet.';
      list.appendChild(empty);
    }
    for (const { heading, depth } of headings) {
      const row = document.createElement('div');
      row.className = 'panel-row';
      row.style.paddingLeft = 8 + depth * 16 + 'px';
      row.style.cursor = 'pointer';
      row.style.fontSize = '14px';
      row.textContent = heading.title || '(untitled)';
      row.onclick = () => performExport(exportFormat, heading);
      list.appendChild(row);
    }
    fileMenuPanel.appendChild(list);

    const backRow = document.createElement('div');
    backRow.className = 'panel-row';
    backRow.style.marginTop = '6px';
    backRow.appendChild(
      menuButton('\u2039 Back', () => {
        exportPickingHeading = false;
        renderFileMenu();
      })
    );
    fileMenuPanel.appendChild(backRow);
    return;
  }

  const label = document.createElement('div');
  label.style.fontSize = '12px';
  label.style.opacity = '0.7';
  label.style.marginBottom = '4px';
  label.textContent = `Export ${exportFormat === 'ascii' ? 'ASCII' : exportFormat === 'markdown' ? 'Markdown' : exportFormat === 'html' ? 'HTML' : exportFormat === 'odt' ? 'ODT' : 'Calendar (.ics)'} for:`;
  fileMenuPanel.appendChild(label);

  const row = document.createElement('div');
  row.className = 'panel-row';
  row.appendChild(menuButton('This file', () => performExport(exportFormat, null)));
  row.appendChild(
    menuButton('Choose a heading\u2026', () => {
      exportPickingHeading = true;
      renderFileMenu();
    })
  );
  row.appendChild(
    menuButton('\u2039 Back', () => {
      exportFormat = null;
      renderFileMenu();
    })
  );
  fileMenuPanel.appendChild(row);
}

function stopBrowsing() {
  browseBackend = null;
  browsePath = '';
  browseEntries = null;
  browseError = null;
}

/** Renders the navigable file/folder listing for whichever backend
 *  startBrowsing set up -- the actual UI this whole feature is about.
 *  Folders are tappable to navigate into; only .org files are shown
 *  (and tappable to open) among files, since anything else isn't
 *  something this app can do anything useful with anyway and would
 *  just be clutter in the list. */
function renderFileBrowser() {
  const backendLabel = browseBackend === 'github' ? 'GitHub' : 'WebDAV';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.gap = '8px';
  header.style.marginBottom = '6px';

  if (browsePath) {
    header.appendChild(
      menuButton('\u2191 Up', () => {
        const parts = browsePath.split('/');
        parts.pop();
        browsePath = parts.join('/');
        loadBrowseEntries();
      })
    );
  }

  const pathLabel = document.createElement('div');
  pathLabel.style.fontSize = '12px';
  pathLabel.style.opacity = '0.7';
  pathLabel.style.overflow = 'hidden';
  pathLabel.style.textOverflow = 'ellipsis';
  pathLabel.style.whiteSpace = 'nowrap';
  pathLabel.textContent = `${backendLabel}: /${browsePath}`;
  header.appendChild(pathLabel);
  fileMenuPanel.appendChild(header);

  const listEl = document.createElement('div');
  listEl.style.maxHeight = `40${VH_UNIT}`;
  listEl.style.overflowY = 'auto';
  fileMenuPanel.appendChild(listEl);

  if (browseEntries === null && !browseError) {
    const loading = document.createElement('div');
    loading.style.fontSize = '13px';
    loading.style.opacity = '0.6';
    loading.style.padding = '10px 2px';
    loading.textContent = 'Loading\u2026';
    listEl.appendChild(loading);
  } else if (browseError) {
    const errorEl = document.createElement('div');
    errorEl.style.fontSize = '13px';
    errorEl.style.color = '#c0392b';
    errorEl.style.padding = '6px 2px';
    errorEl.textContent = browseError;
    listEl.appendChild(errorEl);
  } else {
    const orgEntries = browseEntries.filter(
      (e) => e.type === 'dir' || e.name.toLowerCase().endsWith('.org') || e.name.toLowerCase().endsWith('_archive')
    );
    if (orgEntries.length === 0) {
      const empty = document.createElement('div');
      empty.style.fontSize = '13px';
      empty.style.opacity = '0.6';
      empty.style.padding = '10px 2px';
      empty.textContent = 'No .org files or folders here.';
      listEl.appendChild(empty);
    }
    for (const entry of orgEntries) {
      const row = document.createElement('button');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.width = '100%';
      row.style.textAlign = 'left';
      row.style.padding = '8px 4px';
      row.style.border = 'none';
      row.style.borderBottom = '1px solid var(--border)';
      row.style.background = 'transparent';
      row.style.color = 'var(--fg)';
      row.style.font = 'inherit';
      row.style.fontSize = '14px';

      const icon = document.createElement('span');
      icon.textContent = entry.type === 'dir' ? '\ud83d\udcc1' : entry.name.toLowerCase().endsWith('_archive') ? '\ud83d\uddc4\ufe0f' : '\ud83d\udcc4';
      icon.style.flexShrink = '0';
      row.appendChild(icon);

      const name = document.createElement('span');
      name.textContent = entry.name;
      name.style.overflow = 'hidden';
      name.style.textOverflow = 'ellipsis';
      name.style.whiteSpace = 'nowrap';
      row.appendChild(name);

      row.onclick = () => {
        if (entry.type === 'dir') {
          browsePath = entry.path;
          loadBrowseEntries();
        } else {
          const diskAdapter = browseBackend === 'github' ? githubAdapter : webdavAdapter;
          const path = entry.path;
          const kind = browseBackend;
          stopBrowsing();
          closeFileMenu();
          openRemotePath(path, kind, diskAdapter, backendLabel);
        }
      };
      listEl.appendChild(row);
    }
  }

  const footerRow = document.createElement('div');
  footerRow.className = 'panel-row';
  footerRow.style.marginTop = '6px';
  footerRow.appendChild(
    menuButton('Type a path instead\u2026', () => {
      const kind = browseBackend;
      stopBrowsing();
      renderFileMenu();
      if (kind === 'github') openGithubByPrompt();
      else openWebdavByPrompt();
    })
  );
  footerRow.appendChild(
    menuButton('Cancel', () => {
      stopBrowsing();
      renderFileMenu();
    })
  );
  fileMenuPanel.appendChild(footerRow);
}

fileMenuBtn.addEventListener('click', () => {
  fileMenuOpen = !fileMenuOpen;
  fileMenuStep = null;
  exportFormat = null;
  exportPickingHeading = false;
  stopBrowsing();
  if (fileMenuOpen && settingsOpen) {
    settingsOpen = false;
    render(); // restores the normal outline content in place of settings
  }
  if (fileMenuOpen && searchOpen) {
    searchOpen = false;
    renderSearchPanel();
  }
  if (fileMenuOpen && viewMenuOpen) {
    viewMenuOpen = false;
    renderViewMenu();
  }
  if (fileMenuOpen && captureOpen) {
    captureOpen = false;
    renderCapturePanel();
  }
  if (fileMenuOpen && moreOpen) {
    moreOpen = false;
    renderMoreMenu();
  }
  if (fileMenuOpen && docsOpen) {
    closeDocsView();
    render(); // restores the normal outline content in place of docs
  }
  if (fileMenuOpen && historyOpen) {
    historyOpen = false;
    renderHistoryPanel();
  }
  renderFileMenu();
});

addBtn.addEventListener('click', () => {
  if (!state.doc) return;
  settingsOpen = false;
  closeDocsView();
  if (moreOpen) {
    moreOpen = false;
    renderMoreMenu();
  }
  const heading = insertTopLevelHeading(state.doc, {});
  startEditingTitle(heading, true);
});

navBackBtn.addEventListener('click', async () => {
  await navigateBack();
});

/** Switches between the three top-level views, handling the
 *  enter/exit bookkeeping each transition needs: leaving 'text' commits
 *  its content into state.doc first (the fix from a previous bug — never
 *  read a stale doc); leaving 'org' clears outline edit state, since
 *  nothing should be mid-edit while the outline isn't even shown. */
function switchToView(view) {
  if (docsOpen) {
    closeDocsView();
    render();
  }
  if (view === currentView) {
    viewMenuOpen = false;
    renderViewMenu();
    return;
  }

  if (currentView === 'text') {
    commitTextModeIfActive();
  } else if (currentView === 'org') {
    editingHeading = null;
    editingIsNew = false;
    editingCell = null;
    editingParagraph = null;
    editingListItem = null;
    editingHeadingText = null;
    editingGeneral = null;
    actionMenuFor = null;
  }

  if (view === 'text' && searchOpen) {
    // Entering text mode means the document could be reparsed (new
    // object identities) the next time it's left — any search result
    // currently held would reference objects that no longer exist by
    // the time it's tapped. Closing search here removes that
    // possibility rather than leaving stale results sitting around.
    searchOpen = false;
    searchQuery = '';
    renderSearchPanel();
  }

  currentView = view;
  viewMenuOpen = false;
  renderViewMenu();
  render();
}

function renderViewMenu() {
  viewMenuPanel.innerHTML = '';
  if (!viewMenuOpen) {
    viewMenuPanel.style.display = 'none';
    return;
  }
  viewMenuPanel.style.display = 'block';

  const row = document.createElement('div');
  row.className = 'panel-row';
  const viewMenuAliases = parseMenuAliases(getViewMenuAliases(state.localVariables));
  for (const [key, label] of [
    ['org', 'Org'],
    ['text', 'Text'],
    ['agenda', 'Agenda'],
    ['tasklist', 'TODO'],
  ]) {
    const btn = aliasedMenuButton(viewMenuAliases, label, () => switchToView(key));
    if (!btn) continue;
    if (key === currentView) btn.style.fontWeight = '700';
    row.appendChild(btn);
  }
  viewMenuPanel.appendChild(row);
}

// ---- Agenda view ---------------------------------------------------------

function agendaRangeFor(viewType, anchorDate) {
  if (viewType === 'day') {
    return { start: startOfDay(anchorDate), end: endOfDay(anchorDate) };
  }
  if (viewType === 'week') {
    const startOnWeekday = getAgendaStartOnWeekday(state.localVariables);
    const start = startOfWeek(anchorDate, startOnWeekday);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start, end: endOfDay(end) };
  }
  // month
  const start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const end = endOfDay(new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0));
  return { start, end };
}

/** Moves `anchorDate` by one unit of `viewType` in `direction` (-1 or 1)
 *  — this is "scrolling by the view amount": a day, a week, or a month. */
function agendaStepAnchor(viewType, anchorDate, direction) {
  const next = new Date(anchorDate);
  if (viewType === 'day') next.setDate(next.getDate() + direction);
  else if (viewType === 'week') next.setDate(next.getDate() + direction * 7);
  else next.setMonth(next.getMonth() + direction);
  return next;
}

function formatDayHeader(dateKeyStr) {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const isToday = date.toDateString() === new Date().toDateString();
  const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return isToday ? label + ' \u2014 Today' : label;
}

function formatAgendaRangeLabel(viewType, start, end) {
  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (viewType === 'day') return fmt(start);
  if (viewType === 'month') return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return fmt(start) + ' \u2013 ' + fmt(end);
}

function renderAgendaView() {
  ensureAgendaFilesLoaded();
  outlineEl.innerHTML = '';
  const container = document.createElement('div');
  container.style.padding = '8px 12px';

  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '6px';
  controls.style.alignItems = 'center';
  controls.style.marginBottom = '10px';
  controls.style.flexWrap = 'wrap';

  function agendaControlBtn(label, onClick, isActive, ariaLabel) {
    const btn = document.createElement('button');
    btn.textContent = label;
    if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
    btn.style.fontSize = '15px';
    btn.style.padding = '10px 14px';
    btn.style.minHeight = '44px';
    btn.style.fontWeight = isActive ? '700' : '400';
    btn.onclick = onClick;
    return btn;
  }

  for (const [key, label] of [
    ['day', 'Day'],
    ['week', 'Week'],
    ['month', 'Month'],
  ]) {
    controls.appendChild(
      agendaControlBtn(label, () => {
        agendaViewType = key;
        render();
      }, key === agendaViewType)
    );
  }

  controls.appendChild(
    agendaControlBtn(
      '\u2039',
      () => {
        agendaAnchorDate = agendaStepAnchor(agendaViewType, agendaAnchorDate, -1);
        render();
      },
      false,
      'Previous ' + agendaViewType
    )
  );

  controls.appendChild(
    agendaControlBtn('Today', () => {
      agendaAnchorDate = new Date();
      render();
    })
  );

  controls.appendChild(
    agendaControlBtn(
      '\u203a',
      () => {
        agendaAnchorDate = agendaStepAnchor(agendaViewType, agendaAnchorDate, 1);
        render();
      },
      false,
      'Next ' + agendaViewType
    )
  );

  if (agendaFilesConfig.length > 0) {
    controls.appendChild(
      agendaControlBtn(
        '\u21bb',
        () => refreshAgendaFiles(),
        false,
        'Refresh agenda files (re-fetch every configured file from its own source)'
      )
    );
  }

  container.appendChild(controls);

  const { start, end } = agendaRangeFor(agendaViewType, agendaAnchorDate);
  const rangeRow = document.createElement('div');
  rangeRow.style.display = 'flex';
  rangeRow.style.alignItems = 'center';
  rangeRow.style.justifyContent = 'space-between';
  rangeRow.style.gap = '8px';
  rangeRow.style.marginBottom = '8px';

  const rangeLabel = document.createElement('div');
  rangeLabel.style.fontSize = '12px';
  rangeLabel.style.opacity = '0.65';
  rangeLabel.textContent = formatAgendaRangeLabel(agendaViewType, start, end);
  rangeRow.appendChild(rangeLabel);

  const logToggle = document.createElement('label');
  logToggle.style.display = 'flex';
  logToggle.style.alignItems = 'center';
  logToggle.style.gap = '4px';
  logToggle.style.fontSize = '12px';
  logToggle.style.opacity = '0.8';
  logToggle.style.cursor = 'pointer';
  logToggle.style.flexShrink = '0';
  const logCheckbox = document.createElement('input');
  logCheckbox.type = 'checkbox';
  logCheckbox.checked = agendaLogMode;
  logCheckbox.onchange = () => {
    agendaLogMode = logCheckbox.checked;
    render();
  };
  logToggle.appendChild(logCheckbox);
  logToggle.appendChild(document.createTextNode('Log'));
  rangeRow.appendChild(logToggle);

  container.appendChild(rangeRow);

  if (agendaFilesConfig.length > 0) {
    const entries = agendaFilesConfig.map((f) => agendaFilesCache.get(f));
    const loadingCount = entries.filter((e) => e && e.loading).length;
    const errored = agendaFilesConfig
      .map((f, i) => ({ f, entry: entries[i] }))
      .filter(({ entry }) => entry && entry.error);
    if (loadingCount > 0 || errored.length > 0) {
      const agendaFilesStatus = document.createElement('div');
      agendaFilesStatus.style.fontSize = '11px';
      agendaFilesStatus.style.marginBottom = '8px';
      const parts = [];
      if (loadingCount > 0) parts.push(`Loading ${loadingCount} agenda file${loadingCount === 1 ? '' : 's'}\u2026`);
      if (errored.length > 0) {
        agendaFilesStatus.style.color = '#c0392b';
        parts.push(errored.map(({ f, entry }) => `"${f}": ${entry.error}`).join('; '));
      }
      agendaFilesStatus.textContent = parts.join(' ');
      container.appendChild(agendaFilesStatus);
    }
  }

  // Completed items excluded, using this file's own #+TODO: sequence
  // (not a hardcoded "DONE" check) — and the range is passed through so
  // any repeating SCHEDULED/DEADLINE timestamp expands into every
  // occurrence that actually falls within what's being displayed.
  const todoSequence = resolveTodoSequence(state.doc, GLOBAL_TODO_DEFAULT);
  const items = buildAgendaItems(aggregateAgendaDocs(), {
    includeLogbook: agendaLogMode,
    todoFilter: (todo) => !todoSequence.doneKeywords.includes(todo),
    // Real org's default is to skip both commented headings (title
    // starts with "# ") and archived ones (:ARCHIVE: tag) in agenda
    // views — org-agenda-skip-comment-trees / org-agenda-skip-archived-
    // trees, both t by default. Overridable per-file via a Local
    // Variables block (set either to nil to include them after all).
    includeCommented: !getAgendaSkipCommentTrees(state.localVariables),
    includeArchived: !getAgendaSkipArchivedTrees(state.localVariables),
    rangeStart: start,
    rangeEnd: end,
    // Carry-forward: an incomplete SCHEDULED/DEADLINE keeps appearing on
    // every day from its date through today, matching real org-mode's
    // actual behavior (a plain title timestamp never does this, by
    // design — see agenda.js). `today` is the real current date, not
    // agendaAnchorDate, which is just whatever date the user is
    // currently navigating to look at.
    isDone: (todo) => todoSequence.doneKeywords.includes(todo),
    today: new Date(),
    birthdayProperty: getContactsBirthdayProperty(state.localVariables),
    deadlineWarningDays: getDeadlineWarningDays(state.localVariables),
    calendarLatitude: getCalendarLatitude(state.localVariables),
    calendarLongitude: getCalendarLongitude(state.localVariables),
  });

  const grouped =
    agendaViewType === 'day'
      ? dayView(items, agendaAnchorDate)
      : agendaViewType === 'week'
        ? weekView(items, agendaAnchorDate, getAgendaStartOnWeekday(state.localVariables))
        : monthView(items, agendaAnchorDate);

  if (grouped.length === 0) {
    const empty = document.createElement('div');
    empty.style.opacity = '0.6';
    empty.style.fontSize = '14px';
    empty.style.padding = '20px 0';
    empty.textContent = 'Nothing scheduled in this range.';
    container.appendChild(empty);
  }

  for (const day of grouped) {
    const dayHeader = document.createElement('div');
    dayHeader.style.fontSize = '12px';
    dayHeader.style.fontWeight = '700';
    dayHeader.style.opacity = '0.7';
    dayHeader.style.margin = '10px 0 4px';
    dayHeader.textContent = formatDayHeader(day.date);
    container.appendChild(dayHeader);

    for (const item of day.items) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '6px';
      row.style.alignItems = 'baseline';
      row.style.padding = '6px 2px';
      row.style.borderBottom = '1px solid var(--border)';
      row.style.cursor = 'pointer';

      const kindIcon = document.createElement('span');
      kindIcon.textContent =
        item.kind === 'deadline'
          ? '\u26a0'
          : item.kind === 'timestamp'
            ? '\ud83d\udcc5'
            : item.kind === 'anniversary'
              ? '\ud83c\udf82'
              : item.kind === 'logbook'
                ? '\ud83d\udcdd'
                : item.kind === 'diary-sexp'
                  ? '\ud83d\udd01'
                  : item.kind === 'sunrise-sunset'
                    ? '\u2600\ufe0f'
                    : '\u23f0';
      kindIcon.style.flexShrink = '0';
      kindIcon.style.opacity = '0.6';
      row.appendChild(kindIcon);

      const text = document.createElement('div');
      text.style.flex = '1 1 auto';
      text.style.minWidth = '0';
      if (item.todo && item.kind !== 'logbook') {
        const badge = document.createElement('span');
        badge.textContent = item.todo + ' ';
        badge.style.fontWeight = '700';
        badge.style.fontSize = '12px';
        text.appendChild(badge);
      }
      text.appendChild(document.createTextNode(item.title));
      if (item.logNote) {
        const noteLine = document.createElement('div');
        noteLine.style.fontSize = '12px';
        noteLine.style.opacity = '0.65';
        noteLine.style.fontStyle = 'italic';
        noteLine.textContent = item.logNote;
        text.appendChild(noteLine);
      }
      if (item.repeater) {
        const rep = document.createElement('span');
        rep.textContent = ' \u21bb';
        rep.style.opacity = '0.5';
        rep.style.fontSize = '12px';
        text.appendChild(rep);
      }
      if (item.daysOverdue) {
        const overdue = document.createElement('span');
        overdue.style.fontSize = '12px';
        overdue.style.marginLeft = '6px';
        if (item.daysOverdue > 0) {
          overdue.style.color = '#c0392b';
          overdue.textContent = item.daysOverdue === 1 ? '1 day overdue' : item.daysOverdue + ' days overdue';
        } else {
          overdue.style.opacity = '0.6';
          const daysUntil = -item.daysOverdue;
          overdue.textContent = daysUntil === 1 ? 'due tomorrow' : 'due in ' + daysUntil + ' days';
        }
        text.appendChild(overdue);
      }
      row.appendChild(text);

      if (item.hasTime) {
        const time = document.createElement('span');
        time.style.fontSize = '12px';
        time.style.opacity = '0.6';
        time.style.flexShrink = '0';
        time.textContent = item.date.toTimeString().slice(0, 5);
        row.appendChild(time);
      }

      row.onclick = () => {
        switchToView('org');
        navigateToHeading(item.heading);
      };
      container.appendChild(row);
    }
  }

  outlineEl.appendChild(container);
}

/** "YYYY-MM-DD" for a date-picker's own value attribute, local time
 *  (not UTC -- toISOString would shift the date near a timezone
 *  boundary, exactly the kind of off-by-one a date range picker can't
 *  afford). */
function dateInputValue(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function buildClocktableSection() {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = '10px';

  const hr = document.createElement('hr');
  hr.style.border = 'none';
  hr.style.borderTop = '0.5px solid var(--border-strong)';
  hr.style.margin = '2px 0 8px';
  wrap.appendChild(hr);

  const checkboxRow = document.createElement('div');
  checkboxRow.style.display = 'flex';
  checkboxRow.style.alignItems = 'center';
  checkboxRow.style.gap = '14px';

  const clockToggle = document.createElement('label');
  clockToggle.style.display = 'flex';
  clockToggle.style.alignItems = 'center';
  clockToggle.style.gap = '4px';
  clockToggle.style.fontSize = '13px';
  clockToggle.style.cursor = 'pointer';
  const clockCheckbox = document.createElement('input');
  clockCheckbox.type = 'checkbox';
  clockCheckbox.checked = showClockDisplay;
  clockCheckbox.onchange = () => {
    showClockDisplay = clockCheckbox.checked;
    render();
  };
  clockToggle.appendChild(clockCheckbox);
  clockToggle.appendChild(document.createTextNode('Clock'));
  checkboxRow.appendChild(clockToggle);

  const reportToggle = document.createElement('label');
  reportToggle.style.display = 'flex';
  reportToggle.style.alignItems = 'center';
  reportToggle.style.gap = '6px';
  reportToggle.style.fontSize = '13px';
  reportToggle.style.cursor = 'pointer';
  const reportCheckbox = document.createElement('input');
  reportCheckbox.type = 'checkbox';
  reportCheckbox.checked = showClocktable;
  reportCheckbox.onchange = () => {
    showClocktable = reportCheckbox.checked;
    // Default to the last 7 days (including today) the FIRST time this
    // is checked with nothing picked yet -- shows something useful
    // immediately rather than an empty picker needing two taps before
    // any report appears at all. Once set, whatever's actually picked
    // is remembered rather than reset on every toggle.
    if (showClocktable && !clocktableStart && !clocktableEnd) {
      const now = new Date();
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 6);
      clocktableStart = dateInputValue(weekAgo);
      clocktableEnd = dateInputValue(now);
    }
    render();
  };
  reportToggle.appendChild(reportCheckbox);
  reportToggle.appendChild(document.createTextNode('Clock report'));
  checkboxRow.appendChild(reportToggle);

  let rendered = null;
  if (showClocktable) {
    const result = computeClocktable(state.doc, clocktableStart, clocktableEnd, clocktableMaxlevel);
    rendered = renderClocktable(result, clocktableStart, clocktableEnd, new Date(), clocktableMaxlevel);

    const copyBtn = menuButton('\ud83d\udccb Copy', async () => {
      try {
        await navigator.clipboard.writeText(rendered);
        setStatus('Clocktable copied to clipboard.');
      } catch {
        setStatus("Couldn't copy \u2014 your browser may not allow clipboard access here.");
      }
      render();
    });
    copyBtn.style.marginLeft = 'auto';
    checkboxRow.appendChild(copyBtn);
  }

  wrap.appendChild(checkboxRow);

  if (!showClocktable) return wrap;

  const rangeRow = document.createElement('div');
  rangeRow.style.display = 'flex';
  rangeRow.style.gap = '8px';
  rangeRow.style.alignItems = 'center';
  rangeRow.style.marginTop = '6px';
  rangeRow.style.flexWrap = 'wrap';

  const startInput = document.createElement('input');
  startInput.type = 'date';
  textInputStyle(startInput);
  startInput.style.width = 'auto';
  startInput.style.webkitAppearance = 'none';
  startInput.style.appearance = 'none';
  startInput.value = clocktableStart;
  startInput.onchange = () => {
    clocktableStart = startInput.value;
    render();
  };
  rangeRow.appendChild(startInput);

  const toLabel = document.createElement('span');
  toLabel.textContent = '\u2013';
  toLabel.style.opacity = '0.6';
  rangeRow.appendChild(toLabel);

  const endInput = document.createElement('input');
  endInput.type = 'date';
  textInputStyle(endInput);
  endInput.style.width = 'auto';
  endInput.style.webkitAppearance = 'none';
  endInput.style.appearance = 'none';
  endInput.value = clocktableEnd;
  endInput.onchange = () => {
    clocktableEnd = endInput.value;
    render();
  };
  rangeRow.appendChild(endInput);

  // No visible text label -- just the bare select, so it fits on the
  // same line as the date pickers without extra width; still
  // identifiable via aria-label for accessibility.
  const maxlevelSelect = document.createElement('select');
  textInputStyle(maxlevelSelect);
  maxlevelSelect.style.width = 'auto';
  maxlevelSelect.style.marginLeft = '6px';
  maxlevelSelect.setAttribute('aria-label', 'maxlevel');
  for (let n = 1; n <= 10; n++) {
    const option = document.createElement('option');
    option.value = String(n);
    option.textContent = String(n);
    if (n === clocktableMaxlevel) option.selected = true;
    maxlevelSelect.appendChild(option);
  }
  maxlevelSelect.onchange = () => {
    clocktableMaxlevel = Number(maxlevelSelect.value);
    render();
  };
  rangeRow.appendChild(maxlevelSelect);

  wrap.appendChild(rangeRow);

  const pre = document.createElement('pre');
  pre.style.marginTop = '8px';
  pre.style.padding = '10px';
  pre.style.border = '0.5px solid var(--border-strong)';
  pre.style.borderRadius = '8px';
  pre.style.fontSize = '12px';
  pre.style.fontFamily = 'monospace';
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.wordBreak = 'break-word';
  pre.style.userSelect = 'text';
  pre.style.overflowX = 'auto';
  pre.textContent = rendered;
  wrap.appendChild(pre);

  return wrap;
}

function renderTaskListView() {
  ensureAgendaFilesLoaded();
  outlineEl.innerHTML = '';
  const container = document.createElement('div');
  container.style.padding = '8px 12px';

  const headingRow = document.createElement('div');
  headingRow.style.display = 'flex';
  headingRow.style.justifyContent = 'space-between';
  headingRow.style.alignItems = 'center';
  headingRow.style.gap = '8px';
  headingRow.style.marginBottom = '10px';

  const heading = document.createElement('div');
  heading.style.fontSize = '12px';
  heading.style.opacity = '0.65';
  heading.textContent = 'Every active TODO in this file, regardless of date — matching real org\u2019s own global TODO list.';
  headingRow.appendChild(heading);

  container.appendChild(headingRow);
  container.appendChild(buildClocktableSection());

  // Same exclusion rules as Agenda (completed items, archived, commented
  // headings), using this file's own #+TODO: sequence — deliberately
  // consistent with Agenda rather than a separate, different notion of
  // "done" or "should this show up at all".
  const todoSequence = resolveTodoSequence(state.doc, GLOBAL_TODO_DEFAULT);
  const items = buildTaskList(aggregateAgendaDocs(), {
    isDone: (todo) => todoSequence.doneKeywords.includes(todo),
    includeCommented: !getAgendaSkipCommentTrees(state.localVariables),
    includeArchived: !getAgendaSkipArchivedTrees(state.localVariables),
  });

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.style.opacity = '0.6';
    empty.style.fontSize = '14px';
    empty.style.padding = '20px 0';
    empty.textContent = 'Nothing active \u2014 every TODO is either done or there are none yet.';
    container.appendChild(empty);
    outlineEl.appendChild(container);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '6px';
    row.style.alignItems = 'baseline';
    row.style.padding = '8px 2px';
    row.style.borderBottom = '1px solid var(--border)';
    row.style.cursor = 'pointer';

    const badge = document.createElement('span');
    badge.textContent = item.todo;
    badge.style.fontWeight = '700';
    badge.style.fontSize = '12px';
    badge.style.flexShrink = '0';
    row.appendChild(badge);

    const text = document.createElement('div');
    text.style.flex = '1 1 auto';
    text.style.minWidth = '0';
    text.style.overflowWrap = 'anywhere';
    text.textContent = item.title;
    row.appendChild(text);

    if (showClockDisplay) {
      const minutes = totalClockedMinutes(item.heading);
      if (minutes > 0) {
        const clockLabel = document.createElement('span');
        clockLabel.style.fontSize = '12px';
        clockLabel.style.opacity = '0.65';
        clockLabel.style.flexShrink = '0';
        clockLabel.textContent = formatClockDuration(minutes);
        row.appendChild(clockLabel);
      }
    }

    row.onclick = () => {
      switchToView('org');
      navigateToHeading(item.heading);
    };
    container.appendChild(row);
  }

  outlineEl.appendChild(container);
}

viewMenuBtn.addEventListener('click', () => {
  if (!state.doc) return;
  viewMenuOpen = !viewMenuOpen;
  if (viewMenuOpen && fileMenuOpen) {
    fileMenuOpen = false;
    fileMenuStep = null;
    exportFormat = null;
    exportPickingHeading = false;
    stopBrowsing();
    renderFileMenu();
  }
  if (viewMenuOpen && settingsOpen) {
    settingsOpen = false;
    render(); // restores the normal outline content in place of settings
  }
  if (viewMenuOpen && searchOpen) {
    searchOpen = false;
    renderSearchPanel();
  }
  if (viewMenuOpen && captureOpen) {
    captureOpen = false;
    renderCapturePanel();
  }
  if (viewMenuOpen && moreOpen) {
    moreOpen = false;
    renderMoreMenu();
  }
  if (viewMenuOpen && docsOpen) {
    closeDocsView();
    render();
  }
  renderViewMenu();
});

// ---- Settings UI --------------------------------------------------------

function labeledInput(labelText, type, value, placeholder) {
  const wrap = document.createElement('div');
  wrap.className = 'panel-field';
  const labelEl = document.createElement('label');
  labelEl.textContent = labelText;
  wrap.appendChild(labelEl);

  if (type === 'password') {
    // Stays a real <input type="password"> — masking requires it, and
    // there's no password-type textarea. A justified, narrow exception
    // to the "always wraps, never scrolls horizontally" rule elsewhere:
    // masked content isn't something wrapping would help read anyway.
    const input = document.createElement('input');
    input.type = 'password';
    input.value = value || '';
    if (placeholder) input.placeholder = placeholder;
    wrap.appendChild(input);
    return { wrap, input };
  }

  const input = document.createElement('textarea');
  input.rows = 1;
  input.value = value || '';
  if (placeholder) input.placeholder = placeholder;
  input.style.overflowWrap = 'anywhere';
  input.style.font = 'inherit';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault(); // one logical line — a repo/branch/URL/username, not multi-line content
  });
  autoGrowTextarea(input);
  wrap.appendChild(input);
  return { wrap, input };
}

/** Every CSS custom property a theme actually defines -- the complete
 *  set both applyTheme's own override logic and the Settings UI's
 *  color-customization controls need to know about. Kept as one
 *  shared list so neither can drift out of sync with what
 *  index.html's own :root/[data-theme] rules actually declare. */
const THEME_CSS_VARS = [
  '--bg',
  '--fg',
  '--border',
  '--border-strong',
  '--surface',
  '--muted',
  '--accent',
  '--todo-bg',
  '--todo-fg',
  '--done-bg',
  '--done-fg',
];

// Loaded once at bootstrap, updated whenever the person changes a
// custom color -- { light: { "--bg": "#...", ... }, dark: { ... } },
// only ever containing whichever variables have actually been
// overridden (see setCustomThemeColors's own docs). {} means nobody's
// customized anything, the common case, and applyTheme below behaves
// completely unchanged from before this feature existed.
let customThemeColors = {};

/** Which theme ('light' or 'dark') is actually in effect right now,
 *  resolving 'system' against the LIVE OS preference. Needed because
 *  custom-color overrides are applied as JS-set inline styles, which
 *  -- unlike index.html's own static `@media (prefers-color-scheme:
 *  dark)` CSS rule -- don't automatically re-evaluate when the OS
 *  preference changes; something has to actually re-check and
 *  re-apply (see the matchMedia listener below). */
function resolvedThemeName(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
    // Keep native form-control rendering (unstyled <input>s, date/time
    // pickers, etc.) in sync with the EXPLICIT choice. Without this,
    // color-scheme stays at its static 'light dark' declaration, which
    // means the browser picks native widget colors from the OS's own
    // dark/light preference — independent of what theme the user
    // actually picked in this app. If those disagree (OS in dark mode,
    // user explicitly chose Light here), an unstyled input gets a
    // browser-native DARK background while this app's CSS forces
    // light-theme (dark) text onto it: dark text on a dark background,
    // unreadable. This was the actual cause of "editing a link in light
    // mode, can't see the content" — the input containing the text being
    // edited, not the link's own rendered color.
    document.documentElement.style.colorScheme = theme;
  } else {
    document.documentElement.removeAttribute('data-theme'); // 'system' — let prefers-color-scheme decide
    document.documentElement.style.colorScheme = 'light dark';
  }

  // Clear any previously-applied custom-color overrides first, so
  // switching themes (or updating a color) never leaves a stale
  // override from a different theme/prior state lingering underneath
  // the new one.
  for (const varName of THEME_CSS_VARS) {
    document.documentElement.style.removeProperty(varName);
  }
  const overrides = customThemeColors[resolvedThemeName(theme)];
  if (overrides) {
    for (const [varName, value] of Object.entries(overrides)) {
      document.documentElement.style.setProperty(varName, value);
    }
  }
}

/** The actual, current default value for each theme's own 11
 *  customizable CSS variables -- matching index.html's own
 *  html[data-theme="light"]/html[data-theme="dark"] rules exactly.
 *  This is what "Reset" restores a color to, and what a
 *  never-customized color picker shows to start with. Kept here (not
 *  read from the live CSS) since a person could be viewing/editing
 *  the LIGHT theme's colors while DARK is actually active on screen
 *  right now (or vice versa) -- the picker needs to show that other
 *  theme's own values regardless of which one is currently rendered. */
const THEME_DEFAULTS = {
  light: {
    '--bg': '#ffffff',
    '--fg': '#1a1a1a',
    '--border': '#00000022',
    '--border-strong': '#0000003a',
    '--surface': '#00000009',
    '--muted': '#666666',
    '--accent': '#185fa5',
    '--todo-bg': '#f0997b55',
    '--todo-fg': '#99341d',
    '--done-bg': '#97c45955',
    '--done-fg': '#27500a',
  },
  dark: {
    '--bg': '#16181c',
    '--fg': '#e8e8e8',
    '--border': '#ffffff22',
    '--border-strong': '#ffffff3a',
    '--surface': '#ffffff14',
    '--muted': '#9aa0a6',
    '--accent': '#6fb2ff',
    '--todo-bg': '#ff8f5c40',
    '--todo-fg': '#ffb28c',
    '--done-bg': '#6fcf5740',
    '--done-fg': '#a3e693',
  },
};

const THEME_VAR_LABELS = {
  '--bg': 'Background',
  '--fg': 'Text',
  '--border': 'Border',
  '--border-strong': 'Border (Strong)',
  '--surface': 'Surface',
  '--muted': 'Muted Text',
  '--accent': 'Accent',
  '--todo-bg': 'TODO Badge Background',
  '--todo-fg': 'TODO Badge Text',
  '--done-bg': 'DONE Badge Background',
  '--done-fg': 'DONE Badge Text',
};

/** Persists customThemeColors as it currently stands, re-applies the
 *  theme live (so a change is visible immediately, not after a
 *  reload), and re-renders Settings (so a Reset button's own
 *  enabled/disabled state -- there's nothing left to reset once a
 *  variable's override is gone -- reflects the change). Shared by
 *  every color-change and reset handler below rather than repeating
 *  this three-step sequence at each one. */
async function persistAndReapplyThemeColors() {
  await setCustomThemeColors(kv, customThemeColors);
  applyTheme(await getTheme(kv));
  renderSettingsView();
}

/** One theme's ("light" or "dark") full color-customization section:
 *  a collapsed-by-default toggle (so Appearance stays exactly as
 *  uncluttered as it currently is unless someone actually wants to
 *  customize), expanding to one row per customizable CSS variable --
 *  a color swatch, an opacity slider (needed since several of these
 *  variables use an alpha channel a plain color input can't represent
 *  on its own), and a per-variable Reset -- plus a Reset all for the
 *  whole theme. */
function buildThemeColorCustomizationSection(themeName) {
  const wrap = document.createElement('div');

  const toggleBtn = menuButton(
    (expandedThemeColorSection === themeName ? '\u25be ' : '\u25b8 ') +
      'Customize ' +
      themeName[0].toUpperCase() +
      themeName.slice(1) +
      ' colors',
    () => {
      expandedThemeColorSection = expandedThemeColorSection === themeName ? null : themeName;
      renderSettingsView();
    }
  );
  toggleBtn.style.width = '100%';
  toggleBtn.style.textAlign = 'left';
  toggleBtn.style.marginTop = '6px';
  wrap.appendChild(toggleBtn);

  if (expandedThemeColorSection !== themeName) return wrap;

  const list = document.createElement('div');
  list.style.marginTop = '6px';
  list.style.marginBottom = '6px';

  const themeOverrides = customThemeColors[themeName] || {};

  for (const varName of THEME_CSS_VARS) {
    const currentValue = themeOverrides[varName] || THEME_DEFAULTS[themeName][varName];
    const { rgb, alpha } = splitHexAlpha(currentValue);
    const isCustomized = varName in themeOverrides;

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '6px 0';
    row.style.borderBottom = '1px solid var(--border)';

    const label = document.createElement('div');
    label.textContent = THEME_VAR_LABELS[varName];
    label.style.flex = '1';
    label.style.fontSize = '13px';
    label.style.fontWeight = isCustomized ? '600' : '400';
    row.appendChild(label);

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = rgb;
    colorInput.style.width = '36px';
    colorInput.style.height = '32px';
    colorInput.style.padding = '0';
    colorInput.style.border = '1px solid var(--border-strong)';
    colorInput.style.borderRadius = '4px';
    row.appendChild(colorInput);

    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = '0';
    opacityInput.max = '255';
    opacityInput.value = String(alpha);
    opacityInput.style.width = '70px';
    opacityInput.setAttribute('aria-label', THEME_VAR_LABELS[varName] + ' opacity');
    row.appendChild(opacityInput);

    const applyChange = async () => {
      const newValue = combineHexAlpha(colorInput.value, Number(opacityInput.value));
      if (!customThemeColors[themeName]) customThemeColors[themeName] = {};
      customThemeColors[themeName][varName] = newValue;
      await persistAndReapplyThemeColors();
    };
    colorInput.addEventListener('input', applyChange);
    opacityInput.addEventListener('input', applyChange);

    const resetBtn = menuButton(
      'Reset',
      async () => {
        if (customThemeColors[themeName]) delete customThemeColors[themeName][varName];
        if (customThemeColors[themeName] && Object.keys(customThemeColors[themeName]).length === 0) {
          delete customThemeColors[themeName];
        }
        await persistAndReapplyThemeColors();
      },
      !isCustomized
    );
    resetBtn.style.fontSize = '11px';
    resetBtn.style.padding = '4px 8px';
    resetBtn.style.minHeight = 'auto';
    row.appendChild(resetBtn);

    list.appendChild(row);
  }
  wrap.appendChild(list);

  const resetAllBtn = menuButton(
    'Reset all ' + themeName[0].toUpperCase() + themeName.slice(1) + ' colors',
    async () => {
      delete customThemeColors[themeName];
      await persistAndReapplyThemeColors();
    },
    !customThemeColors[themeName]
  );
  resetAllBtn.style.width = '100%';
  resetAllBtn.style.marginBottom = '10px';
  wrap.appendChild(resetAllBtn);

  return wrap;
}

const FONT_FAMILY_STACKS = {
  system: 'system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  monospace: 'ui-monospace, "SF Mono", Menlo, monospace',
};

function applyFontFamily(fontFamily) {
  document.documentElement.style.setProperty(
    '--app-font-family',
    FONT_FAMILY_STACKS[fontFamily] || FONT_FAMILY_STACKS.system
  );
}

function applyFontSize(size) {
  document.documentElement.style.setProperty('--app-font-size', size + 'px');
}

function applyTablesFontSize(size) {
  document.documentElement.style.setProperty('--app-font-size-tables', size + 'px');
}

/** Opens the native file picker and resolves with the picked file's raw
 *  text content. A minimal, standalone helper for settings import --
 *  deliberately not reusing pickAndImportFile, which is built for .org
 *  document import specifically and also caches the picked content
 *  into kv under an unrelated key for later re-reading; a one-off
 *  settings JSON file has no business being cached there. */
function pickTextFile(accept) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (input.parentNode) input.parentNode.removeChild(input);
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      try {
        resolve(await file.text());
      } catch (err) {
        reject(err);
      }
    });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Quick Settings: one entry per Global/Local Variable this app knows
 * about, each with a proper, type-appropriate control (toggle,
 * number stepper, weekday picker, ...) instead of a bare "name: value"
 * line in a shared textarea -- the same underlying storage
 * (globalVariablesText / globalVariables) as the existing raw-text
 * "Global Variables" section below it, just with a friendlier front
 * end for the common case. The raw textarea stays too, unchanged, as
 * the power-user/advanced path for anything not covered here (or for
 * editing several fields at once via paste).
 *
 * `type` drives which control renderQuickSettingField builds:
 *   - 'boolean': a checkbox, Lisp t/nil underneath.
 *   - 'number': a number input, with min/max/step as given.
 *   - 'text': a single-line text input.
 *   - 'longtext': a small textarea, for a value that can itself be
 *     long/multi-entry (org-refile-targets, the org-xx-*-menu family)
 *     -- still just this one variable's own raw syntax, not a
 *     structured list-editor for it; that's a bigger feature of its
 *     own, out of scope here.
 *   - 'weekday': a 0-6 select, real day names shown instead of digits.
 *   - 'logdone': org-log-done's own three-state Off/Timestamp/Note,
 *     with real Lisp quoted-symbol syntax ('time / 'note) underneath.
 *   - 'subsuper': org-use-sub-superscripts' own three-state value
 *     space (t / nil / {}), not a plain boolean.
 */
const QUICK_SETTINGS_FIELDS = [
  { key: 'org-log-done', label: 'Log completing a TODO', section: 'Progress logging', type: 'logdone', helpAnchor: '#progress-logging' },
  {
    key: 'org-closed-keep-when-no-todo',
    label: 'Keep CLOSED when cycled to no TODO keyword',
    section: 'Progress logging',
    type: 'boolean',
    default: false,
    helpAnchor: '#progress-logging',
  },
  {
    key: 'org-agenda-skip-archived-trees',
    label: 'Skip archived headings in Agenda',
    section: 'Agenda',
    type: 'boolean',
    default: true,
    helpAnchor: '#agenda-behavior',
  },
  {
    key: 'org-agenda-skip-comment-trees',
    label: 'Skip commented headings in Agenda',
    section: 'Agenda',
    type: 'boolean',
    default: true,
    helpAnchor: '#agenda-behavior',
  },
  { key: 'org-agenda-start-on-weekday', label: 'Week starts on', section: 'Agenda', type: 'weekday', default: 1, helpAnchor: '#agenda-behavior' },
  {
    key: 'org-deadline-warning-days',
    label: 'Deadline advance warning (days)',
    section: 'Agenda',
    type: 'number',
    default: 14,
    min: 0,
    max: 365,
    step: 1,
    helpAnchor: '#agenda-dated-entries',
  },
  {
    key: 'org-cycle-open-archived-trees',
    label: 'Allow expanding archived headings',
    section: 'Agenda',
    type: 'boolean',
    default: false,
    helpAnchor: '#archiving',
  },
  {
    key: 'org-contacts-birthday-property',
    label: 'Birthday property name',
    section: 'Contacts & Calendar',
    type: 'text',
    default: 'BIRTHDAY',
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'calendar-latitude',
    label: 'Latitude',
    section: 'Contacts & Calendar',
    type: 'number',
    default: 35.994,
    min: -90,
    max: 90,
    step: 0.0001,
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'calendar-longitude',
    label: 'Longitude',
    section: 'Contacts & Calendar',
    type: 'number',
    default: -78.8986,
    min: -180,
    max: 180,
    step: 0.0001,
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'calendar-location-name',
    label: 'Location name',
    section: 'Contacts & Calendar',
    type: 'text',
    default: 'Durham, NC',
    helpAnchor: '#agenda-diary-sexp',
  },
  {
    key: 'org-use-tag-inheritance',
    label: 'Tag search matches inherited tags',
    section: 'Search & tags',
    type: 'boolean',
    default: true,
    helpAnchor: '#searching',
  },
  {
    key: 'org-use-property-inheritance',
    label: 'Property search matches inherited values',
    section: 'Search & tags',
    type: 'boolean',
    default: false,
    helpAnchor: '#searching',
  },
  { key: 'org-use-sub-superscripts', label: 'Interpret _ / ^ as sub/superscript', section: 'Editing', type: 'subsuper', helpAnchor: '#inline-text-markup' },
  {
    key: 'org-ascii-text-width',
    label: 'ASCII export line width',
    section: 'Export',
    type: 'number',
    default: 72,
    min: 20,
    max: 200,
    step: 1,
    helpAnchor: '#export',
  },
  { key: 'org-refile-targets', label: 'Refile targets', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#refile' },
  { key: 'org-agenda-files', label: 'Agenda files', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#agenda-files' },
  { key: 'org-xx-extra-menu', label: 'Extras menu (\u2630)', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#extras-menu' },
  { key: 'org-xx-file-menu', label: 'File menu labels', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#menu-customization' },
  { key: 'org-xx-more-menu', label: 'More menu labels', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#menu-customization' },
  { key: 'org-xx-export-menu', label: 'Export menu labels', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#menu-customization' },
  { key: 'org-xx-view-menu', label: 'View menu labels', section: 'Advanced (raw syntax)', type: 'longtext', helpAnchor: '#menu-customization' },
];

/** Writes `key: rawValue` into the app-wide Global Variables baseline
 *  (or removes `key` entirely when `rawValue` is null) -- the exact
 *  same globalVariablesText/globalVariables module-level state the
 *  existing raw textarea reads and writes, kept persisted and
 *  re-merged into the currently open document immediately, the same
 *  "applies right away, no reload needed" convention every other
 *  Settings control here already follows. */
async function commitGlobalVariableChange(key, rawValue) {
  const vars = parseGlobalVariables(globalVariablesText);
  if (rawValue === null) {
    delete vars[key];
  } else {
    vars[key] = rawValue;
  }
  globalVariablesText = serializeGlobalVariables(vars);
  globalVariables = vars;
  await setGlobalVariables(kv, globalVariablesText);
  agendaFilesConfig = parseAgendaFilesVar(globalVariables['org-agenda-files'] || '');
  if (state.doc) {
    state.localVariables = mergeGlobalAndLocalVariables(globalVariables, parseLocalVariables(serializeOrg(state.doc)));
  }
}

/** Builds one Quick Settings field's own label + control row. */
function renderQuickSettingField(field) {
  const row = document.createElement('div');
  row.style.marginBottom = '10px';

  const headerRow = document.createElement('div');
  headerRow.style.display = 'flex';
  headerRow.style.alignItems = 'center';
  headerRow.style.justifyContent = 'space-between';
  headerRow.style.gap = '8px';

  const label = document.createElement('label');
  label.style.display = 'flex';
  label.style.flexDirection = field.type === 'boolean' ? 'row' : 'column';
  label.style.alignItems = field.type === 'boolean' ? 'center' : 'stretch';
  label.style.gap = field.type === 'boolean' ? '8px' : '4px';
  label.style.fontSize = '13px';
  label.style.cursor = field.type === 'boolean' ? 'pointer' : 'default';
  label.style.flex = '1 1 auto';
  label.style.minWidth = '0';

  const labelText = document.createElement('span');
  labelText.textContent = field.label;
  if (field.type === 'boolean') label.appendChild(document.createElement('span')); // placeholder swapped below, keeps checkbox-then-label DOM order consistent with other checkboxes in this app
  else label.appendChild(labelText);

  const rawValue = globalVariables[field.key];

  if (field.type === 'boolean') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = parseLispBoolean(rawValue, field.default);
    checkbox.onchange = async () => {
      await commitGlobalVariableChange(field.key, checkbox.checked ? 't' : 'nil');
      setStatus(`${field.label}: ${checkbox.checked ? 'on' : 'off'}.`);
      renderSettingsView();
      render();
    };
    label.replaceChild(checkbox, label.firstChild);
    label.appendChild(labelText);
  } else if (field.type === 'number') {
    const input = document.createElement('input');
    input.type = 'number';
    textInputStyle(input);
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    if (field.step !== undefined) input.step = String(field.step);
    input.value = String(parseLispNumber(rawValue, field.default));
    input.onchange = async () => {
      const n = Number(input.value);
      if (!Number.isFinite(n)) {
        setStatus(`${field.label}: not a valid number, ignored.`);
        render();
        return;
      }
      await commitGlobalVariableChange(field.key, String(n));
      setStatus(`${field.label} updated.`);
      renderSettingsView();
      render();
    };
    label.appendChild(input);
  } else if (field.type === 'text') {
    const input = document.createElement('input');
    input.type = 'text';
    textInputStyle(input);
    input.value = rawValue !== undefined ? rawValue : field.default;
    input.onchange = async () => {
      const trimmed = input.value.trim();
      await commitGlobalVariableChange(field.key, trimmed === field.default || trimmed === '' ? null : trimmed);
      setStatus(`${field.label} updated.`);
      renderSettingsView();
      render();
    };
    label.appendChild(input);
  } else if (field.type === 'longtext') {
    const textarea = document.createElement('textarea');
    textarea.rows = 2;
    textarea.style.fontFamily = 'monospace';
    textarea.style.fontSize = '12px';
    textarea.style.width = '100%';
    textarea.style.maxWidth = '100%';
    textarea.style.boxSizing = 'border-box';
    textarea.style.resize = 'vertical';
    textarea.value = rawValue !== undefined ? rawValue : '';
    textarea.onchange = async () => {
      const trimmed = textarea.value.trim();
      await commitGlobalVariableChange(field.key, trimmed === '' ? null : trimmed);
      setStatus(`${field.label} updated.`);
      renderSettingsView();
      render();
    };
    label.appendChild(textarea);
  } else if (field.type === 'weekday') {
    const select = document.createElement('select');
    textInputStyle(select);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const current = getAgendaStartOnWeekday(globalVariables);
    for (let i = 0; i < 7; i++) {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = dayNames[i];
      if (i === current) option.selected = true;
      select.appendChild(option);
    }
    select.onchange = async () => {
      await commitGlobalVariableChange(field.key, select.value);
      setStatus(`${field.label}: ${dayNames[Number(select.value)]}.`);
      renderSettingsView();
      render();
    };
    label.appendChild(select);
  } else if (field.type === 'logdone') {
    const select = document.createElement('select');
    textInputStyle(select);
    const current = parseLogDoneLispValue(rawValue); // 'time' | 'note' | null
    const options = [
      { value: '', text: 'Off (no logging)' },
      { value: 'time', text: 'Timestamp (CLOSED:)' },
      { value: 'note', text: 'Note (prompted in LOGBOOK)' },
    ];
    for (const opt of options) {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.text;
      if ((current || '') === opt.value) optionEl.selected = true;
      select.appendChild(optionEl);
    }
    select.onchange = async () => {
      const v = select.value;
      await commitGlobalVariableChange(field.key, v ? `'${v}` : null);
      setStatus('org-log-done updated.');
      renderSettingsView();
      render();
    };
    label.appendChild(select);
  } else if (field.type === 'subsuper') {
    const select = document.createElement('select');
    textInputStyle(select);
    const current = getUseSubSuperscripts(globalVariables);
    const options = [
      { value: 't', text: 'Always (a_b \u2192 subscript)' },
      { value: '{}', text: 'Only with {braces} (a_{b})' },
      { value: 'nil', text: 'Never' },
    ];
    for (const opt of options) {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.text;
      if (current === opt.value) optionEl.selected = true;
      select.appendChild(optionEl);
    }
    select.onchange = async () => {
      await commitGlobalVariableChange(field.key, select.value);
      setStatus('org-use-sub-superscripts updated.');
      renderSettingsView();
      render();
    };
    label.appendChild(select);
  }

  headerRow.appendChild(label);
  if (field.helpAnchor) {
    const helpLink = document.createElement('span');
    helpLink.textContent = '?';
    helpLink.title = 'Open the help doc for this setting';
    helpLink.style.flexShrink = '0';
    helpLink.style.opacity = '0.6';
    helpLink.style.fontSize = '13px';
    helpLink.style.cursor = 'pointer';
    helpLink.style.padding = '0 4px';
    helpLink.onclick = () => openDocsAtHeading(field.helpAnchor);
    headerRow.appendChild(helpLink);
  }
  row.appendChild(headerRow);
  return row;
}

/** Groups QUICK_SETTINGS_FIELDS by their own `section`, in first-
 *  appearance order (not alphabetical -- "Progress logging" and
 *  "Agenda" first, "Advanced" last, matches how someone would
 *  actually want to scan this, not dictionary order). */
function renderQuickSettingsSection() {
  const wrap = document.createElement('div');
  wrap.className = 'settings-section';

  const title = document.createElement('div');
  title.className = 'panel-section-title';
  title.textContent = 'Quick Settings';
  wrap.appendChild(title);

  const hint = document.createElement('div');
  hint.style.fontSize = '11px';
  hint.style.opacity = '0.6';
  hint.style.margin = '2px 0 10px';
  hint.textContent =
    'Friendlier controls for the same app-wide Global Variables baseline the raw text box below also edits \u2014 changing one here updates that text too, and vice versa. Applies immediately, no reload needed.';
  wrap.appendChild(hint);

  const sections = [];
  for (const field of QUICK_SETTINGS_FIELDS) {
    let group = sections.find((s) => s.name === field.section);
    if (!group) {
      group = { name: field.section, fields: [] };
      sections.push(group);
    }
    group.fields.push(field);
  }

  for (const group of sections) {
    const groupTitle = document.createElement('div');
    groupTitle.style.fontSize = '12px';
    groupTitle.style.fontWeight = '600';
    groupTitle.style.opacity = '0.7';
    groupTitle.style.margin = '10px 0 6px';
    groupTitle.textContent = group.name;
    wrap.appendChild(groupTitle);

    for (const field of group.fields) {
      wrap.appendChild(renderQuickSettingField(field));
    }
  }

  return wrap;
}

async function renderSettingsView(target = settingsRenderTarget) {
  settingsRenderTarget = target;
  target.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'panel';
  container.style.minHeight = '100%';
  target.appendChild(container);

  const config = await getGithubConfig(kv);
  const webdavConfigStored = await getWebdavConfig(kv);
  const theme = await getTheme(kv);
  const fontFamily = await getFontFamily(kv);
  const fontSize = await getFontSize(kv);

  const appearanceSection = document.createElement('div');
  appearanceSection.className = 'settings-section';
  container.appendChild(appearanceSection);

  const themeTitle = document.createElement('div');
  themeTitle.className = 'panel-section-title';
  themeTitle.textContent = 'Appearance';
  appearanceSection.appendChild(themeTitle);

  const themeRow = document.createElement('div');
  themeRow.className = 'panel-row';
  for (const opt of ['system', 'light', 'dark']) {
    const btn = menuButton(opt[0].toUpperCase() + opt.slice(1), async () => {
      await setTheme(kv, opt);
      applyTheme(opt);
      renderSettingsView();
    });
    btn.style.flex = '1'; // equal width per button, instead of sizing to each option's own text length
    if (opt === theme) btn.style.fontWeight = '700';
    themeRow.appendChild(btn);
  }
  appearanceSection.appendChild(themeRow);

  for (const themeName of ['light', 'dark']) {
    appearanceSection.appendChild(buildThemeColorCustomizationSection(themeName));
  }

  const fontTitle = document.createElement('div');
  fontTitle.className = 'panel-section-title';
  fontTitle.textContent = 'Font';
  appearanceSection.appendChild(fontTitle);

  const fontRow = document.createElement('div');
  fontRow.className = 'panel-row';
  for (const opt of ['system', 'serif', 'monospace']) {
    const btn = menuButton(opt[0].toUpperCase() + opt.slice(1), async () => {
      await setFontFamily(kv, opt);
      applyFontFamily(opt);
      renderSettingsView();
    });
    btn.style.flex = '1'; // equal width per button, same reasoning as the theme row above
    if (opt === fontFamily) btn.style.fontWeight = '700';
    fontRow.appendChild(btn);
  }
  appearanceSection.appendChild(fontRow);

  const sizeTitle = document.createElement('div');
  sizeTitle.className = 'panel-section-title';
  sizeTitle.textContent = 'Font Size';
  appearanceSection.appendChild(sizeTitle);

  const tablesFontSize = await getTablesFontSize(kv);

  const sizeRow = document.createElement('div');
  sizeRow.className = 'panel-row';
  sizeRow.style.alignItems = 'center'; // overrides .panel-row's flex-start default -- correct for label-above-field pairs elsewhere, wrong here (no label, just a number between two taller buttons)
  sizeRow.style.flexWrap = 'wrap'; // lets the "Other" group drop to its own line on a narrow phone rather than clipping or forcing horizontal scroll
  sizeRow.appendChild(
    menuButton('\u2212', async () => {
      const next = Math.max(12, fontSize - 1);
      await setFontSize(kv, next);
      applyFontSize(next);
      renderSettingsView();
    })
  );
  const sizeLabel = document.createElement('span');
  sizeLabel.textContent = fontSize + 'px';
  sizeLabel.style.fontSize = '14px';
  sizeLabel.style.minWidth = '40px';
  sizeLabel.style.textAlign = 'center';
  sizeRow.appendChild(sizeLabel);
  sizeRow.appendChild(
    menuButton('+', async () => {
      const next = Math.min(28, fontSize + 1);
      await setFontSize(kv, next);
      applyFontSize(next);
      renderSettingsView();
    })
  );

  const otherDivider = document.createElement('span');
  otherDivider.textContent = '\u2502'; // visual separator between the main and "other" groups on the same row
  otherDivider.style.opacity = '0.3';
  otherDivider.style.margin = '0 4px';
  sizeRow.appendChild(otherDivider);

  const tablesLabel = document.createElement('span');
  tablesLabel.textContent = 'Tables:';
  tablesLabel.style.fontSize = '13px';
  tablesLabel.style.opacity = '0.7';
  sizeRow.appendChild(tablesLabel);

  sizeRow.appendChild(
    menuButton('\u2212', async () => {
      const next = Math.max(10, tablesFontSize - 1);
      await setTablesFontSize(kv, next);
      applyTablesFontSize(next);
      renderSettingsView();
    })
  );
  const tablesSizeLabel = document.createElement('span');
  tablesSizeLabel.textContent = tablesFontSize + 'px';
  tablesSizeLabel.style.fontSize = '14px';
  tablesSizeLabel.style.minWidth = '40px';
  tablesSizeLabel.style.textAlign = 'center';
  sizeRow.appendChild(tablesSizeLabel);
  sizeRow.appendChild(
    menuButton('+', async () => {
      const next = Math.min(24, tablesFontSize + 1);
      await setTablesFontSize(kv, next);
      applyTablesFontSize(next);
      renderSettingsView();
    })
  );

  appearanceSection.appendChild(sizeRow);

  const otherFontHint = document.createElement('div');
  otherFontHint.textContent = 'Applies to tables and other secondary UI text, independent of the main font size above.';
  otherFontHint.style.fontSize = '11px';
  otherFontHint.style.opacity = '0.6';
  otherFontHint.style.margin = '4px 0 8px';
  appearanceSection.appendChild(otherFontHint);

  const captureSection = document.createElement('div');
  captureSection.className = 'settings-section';
  container.appendChild(captureSection);

  const captureTitle = document.createElement('div');
  captureTitle.className = 'panel-section-title';
  captureTitle.textContent = 'Capture Templates';
  captureSection.appendChild(captureTitle);

  const captureHint = document.createElement('div');
  captureHint.style.fontSize = '12px';
  captureHint.style.opacity = '0.75';
  captureHint.style.margin = '2px 0 6px';
  captureHint.textContent = 'Edited as JSON \u2014 an array of template objects. Full schema, every field, and examples are in the help doc:';
  captureSection.appendChild(captureHint);

  const captureHintLinkRow = document.createElement('div');
  captureHintLinkRow.style.marginBottom = '8px';
  captureHintLinkRow.appendChild(
    menuButton('Capture Templates reference \u2192', () => {
      openDocsAtHeading('#capture-templates');
    })
  );
  captureSection.appendChild(captureHintLinkRow);

  const currentTemplates = await getCaptureTemplates(kv);
  const captureTextarea = document.createElement('textarea');
  captureTextarea.value = JSON.stringify(currentTemplates, null, 2);
  captureTextarea.rows = 12;
  captureTextarea.style.fontFamily = 'monospace';
  captureTextarea.style.fontSize = '13px';
  captureTextarea.style.width = '100%';
  captureTextarea.style.maxWidth = '100%';
  captureTextarea.style.boxSizing = 'border-box';
  captureTextarea.style.resize = 'vertical';
  captureSection.appendChild(captureTextarea);

  const captureBtnRow = document.createElement('div');
  captureBtnRow.className = 'panel-row';
  captureBtnRow.style.marginTop = '8px';
  captureBtnRow.appendChild(
    menuButton('Save templates', async () => {
      let parsed;
      try {
        parsed = JSON.parse(captureTextarea.value);
      } catch (err) {
        setStatus('Capture templates: invalid JSON \u2014 ' + err.message);
        return;
      }
      const problem = validateCaptureTemplates(parsed);
      if (problem) {
        setStatus('Capture templates: ' + problem);
        return;
      }
      await setCaptureTemplates(kv, parsed);
      setStatus('Capture templates saved.');
    })
  );
  captureBtnRow.appendChild(
    menuButton('Reset to defaults', async () => {
      await setCaptureTemplates(kv, DEFAULT_CAPTURE_TEMPLATES);
      setStatus('Capture templates reset to defaults.');
      renderSettingsView();
    })
  );
  captureSection.appendChild(captureBtnRow);

  container.appendChild(renderQuickSettingsSection());

  const globalVarsSection = document.createElement('div');
  globalVarsSection.className = 'settings-section';
  container.appendChild(globalVarsSection);

  const globalVarsTitle = document.createElement('div');
  globalVarsTitle.className = 'panel-section-title';
  globalVarsTitle.textContent = 'Global Variables';
  globalVarsSection.appendChild(globalVarsTitle);

  const globalVarsHint = document.createElement('div');
  globalVarsHint.style.fontSize = '11px';
  globalVarsHint.style.opacity = '0.6';
  globalVarsHint.style.margin = '2px 0 6px';
  globalVarsHint.textContent =
    'The same kind of variable a file\u2019s own "# Local Variables:" block or #+STARTUP: line can set, but as the app-wide baseline default across every file \u2014 one per line, same "name: value" format. A file-specific #+STARTUP:/Local Variables setting still overrides this; see Configuration in the README for the full precedence order. Example: org-log-done: \'time';
  globalVarsSection.appendChild(globalVarsHint);

  const globalVarsTextarea = document.createElement('textarea');
  globalVarsTextarea.value = globalVariablesText;
  globalVarsTextarea.rows = 5;
  globalVarsTextarea.style.fontFamily = 'monospace';
  globalVarsTextarea.style.fontSize = '13px';
  globalVarsTextarea.style.width = '100%';
  globalVarsTextarea.style.maxWidth = '100%';
  globalVarsTextarea.style.boxSizing = 'border-box';
  globalVarsTextarea.style.resize = 'vertical';
  globalVarsSection.appendChild(globalVarsTextarea);

  const globalVarsBtnRow = document.createElement('div');
  globalVarsBtnRow.className = 'panel-row';
  globalVarsBtnRow.style.marginTop = '8px';
  globalVarsBtnRow.appendChild(
    menuButton('Save global variables', async () => {
      await setGlobalVariables(kv, globalVarsTextarea.value);
      globalVariablesText = globalVarsTextarea.value;
      globalVariables = parseGlobalVariables(globalVariablesText);
      agendaFilesConfig = parseAgendaFilesVar(globalVariables['org-agenda-files'] || '');
      // Re-merge immediately so the currently open document (if any)
      // reflects the change right away -- no reload needed, matching
      // how the theme/font settings already apply on save.
      if (state.doc) {
        state.localVariables = mergeGlobalAndLocalVariables(globalVariables, parseLocalVariables(serializeOrg(state.doc)));
      }
      setStatus('Global variables saved.');
      renderSettingsView();
      render();
    })
  );
  globalVarsBtnRow.appendChild(
    menuButton('Clear', async () => {
      await setGlobalVariables(kv, DEFAULT_GLOBAL_VARIABLES);
      globalVariablesText = DEFAULT_GLOBAL_VARIABLES;
      globalVariables = {};
      agendaFilesConfig = [];
      if (state.doc) {
        state.localVariables = mergeGlobalAndLocalVariables(globalVariables, parseLocalVariables(serializeOrg(state.doc)));
      }
      setStatus('Global variables cleared.');
      renderSettingsView();
      render();
    })
  );
  globalVarsSection.appendChild(globalVarsBtnRow);

  const pendingSection = document.createElement('div');
  pendingSection.className = 'settings-section';
  container.appendChild(pendingSection);

  const pendingTitle = document.createElement('div');
  pendingTitle.className = 'panel-section-title';
  pendingTitle.textContent = 'Pending Local Changes';
  pendingSection.appendChild(pendingTitle);

  const pendingHint = document.createElement('div');
  pendingHint.style.fontSize = '11px';
  pendingHint.style.opacity = '0.6';
  pendingHint.style.margin = '2px 0 6px';
  pendingHint.textContent =
    'Edits made while offline (or before a save fully synced) that haven\u2019t been written back to disk/GitHub/WebDAV yet -- opening one of these files again prompts to resume or discard them, but they\u2019re also listed here directly so it\u2019s always clear which files, if any, actually have something pending.';
  pendingSection.appendChild(pendingHint);

  const pendingListEl = document.createElement('div');
  pendingSection.appendChild(pendingListEl);

  async function renderPendingList() {
    pendingListEl.innerHTML = '';
    const { keys } = await kv.list('outbox:');
    if (keys.length === 0) {
      const none = document.createElement('div');
      none.style.fontSize = '12px';
      none.style.opacity = '0.6';
      none.style.padding = '4px 0';
      none.textContent = 'No pending local changes.';
      pendingListEl.appendChild(none);
      return;
    }
    for (const key of keys) {
      const documentId = key.slice('outbox:'.length);
      const entry = await getPendingChange(kv, documentId);
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.padding = '4px 0';
      row.style.borderBottom = '1px solid var(--border)';

      const label = document.createElement('div');
      label.style.flex = '1 1 auto';
      label.style.minWidth = '0';
      label.style.fontSize = '13px';
      label.style.overflowWrap = 'anywhere';
      const nameEl = document.createElement('div');
      nameEl.textContent = documentId;
      label.appendChild(nameEl);
      const whenEl = document.createElement('div');
      whenEl.style.fontSize = '11px';
      whenEl.style.opacity = '0.6';
      whenEl.textContent = entry ? formatPendingChangeTimestamp(entry.queuedAt) : '';
      label.appendChild(whenEl);
      row.appendChild(label);

      row.appendChild(
        menuButton('Discard', async () => {
          await clearPendingChange(kv, documentId);
          await renderPendingList();
          setStatus(`Discarded pending changes for "${documentId}".`);
        })
      );
      pendingListEl.appendChild(row);
    }

    if (keys.length > 1) {
      const discardAllRow = document.createElement('div');
      discardAllRow.className = 'panel-row';
      discardAllRow.style.marginTop = '6px';
      discardAllRow.appendChild(
        menuButton('Discard all', async () => {
          for (const key of keys) {
            await clearPendingChange(kv, key.slice('outbox:'.length));
          }
          await renderPendingList();
          setStatus('Discarded all pending local changes.');
        })
      );
      pendingListEl.appendChild(discardAllRow);
    }
  }

  await renderPendingList();

  const githubSection = document.createElement('div');
  githubSection.className = 'settings-section';
  container.appendChild(githubSection);

  const ghTitle = document.createElement('div');
  ghTitle.className = 'panel-section-title';
  ghTitle.textContent = 'GitHub';
  githubSection.appendChild(ghTitle);

  const tokenField = labeledInput('Personal access token', 'password', config.token);
  const ownerField = labeledInput('Owner', 'text', config.owner, 'e.g. octocat');
  const repoField = labeledInput('Repo', 'text', config.repo, 'e.g. my-notes');
  const branchField = labeledInput('Branch', 'text', config.branch, 'main');

  for (const field of [tokenField, ownerField, repoField, branchField]) {
    const row = document.createElement('div');
    row.className = 'panel-row';
    row.appendChild(field.wrap);
    githubSection.appendChild(row);
  }

  const ghHint = document.createElement('div');
  ghHint.style.fontSize = '11px';
  ghHint.style.opacity = '0.6';
  ghHint.style.margin = '2px 0 6px';
  ghHint.textContent =
    'Use a fine-grained token scoped to just this repo, with Contents read/write access only.';
  githubSection.appendChild(ghHint);

  const ghSaveRow = document.createElement('div');
  ghSaveRow.className = 'panel-row';
  ghSaveRow.appendChild(
    menuButton('Save GitHub settings', async () => {
      githubConfig = await setGithubConfig(kv, {
        token: tokenField.input.value.trim(),
        owner: ownerField.input.value.trim(),
        repo: repoField.input.value.trim(),
        branch: branchField.input.value.trim() || 'main',
      });
      setStatus('GitHub settings saved.');
    })
  );
  githubSection.appendChild(ghSaveRow);

  const webdavSection = document.createElement('div');
  webdavSection.className = 'settings-section';
  container.appendChild(webdavSection);

  const webdavTitle = document.createElement('div');
  webdavTitle.className = 'panel-section-title';
  webdavTitle.textContent = 'WebDAV';
  webdavSection.appendChild(webdavTitle);

  const webdavUrlField = labeledInput(
    'Server URL',
    'text',
    webdavConfigStored.baseUrl,
    'e.g. https://dav.example.com/remote.php/dav/files/me'
  );
  const webdavUserField = labeledInput('Username', 'text', webdavConfigStored.username);
  const webdavPassField = labeledInput('Password', 'password', webdavConfigStored.password);

  for (const field of [webdavUrlField, webdavUserField, webdavPassField]) {
    const row = document.createElement('div');
    row.className = 'panel-row';
    row.appendChild(field.wrap);
    webdavSection.appendChild(row);
  }

  const webdavHint = document.createElement('div');
  webdavHint.style.fontSize = '11px';
  webdavHint.style.opacity = '0.6';
  webdavHint.style.margin = '2px 0 6px';
  webdavHint.textContent =
    'Use an app-specific password if your server supports one, not your main account password. ' +
    'Most WebDAV servers need CORS explicitly enabled to accept requests from this app \u2014 ' +
    'if Open/Save fails with a network error, that\u2019s the first thing to check on the server side.';
  webdavSection.appendChild(webdavHint);

  const webdavSaveRow = document.createElement('div');
  webdavSaveRow.className = 'panel-row';
  webdavSaveRow.appendChild(
    menuButton('Save WebDAV settings', async () => {
      webdavConfig = await setWebdavConfig(kv, {
        baseUrl: webdavUrlField.input.value.trim(),
        username: webdavUserField.input.value.trim(),
        password: webdavPassField.input.value,
      });
      setStatus('WebDAV settings saved.');
    })
  );
  webdavSection.appendChild(webdavSaveRow);

  const backupSection = document.createElement('div');
  backupSection.className = 'settings-section';
  container.appendChild(backupSection);

  const backupTitle = document.createElement('div');
  backupTitle.className = 'panel-section-title';
  backupTitle.textContent = 'Backup';
  backupSection.appendChild(backupTitle);

  const backupRow = document.createElement('div');
  backupRow.className = 'panel-row';
  backupRow.appendChild(
    menuButton('Export Settings', async () => {
      const bundle = await exportAllSettings(kv);
      const hasCredentials = !!(bundle.settings.github && bundle.settings.github.token) || !!(bundle.settings.webdav && bundle.settings.webdav.password);
      if (
        hasCredentials &&
        !window.confirm(
          'This file will include your GitHub token and/or WebDAV password in plain text. Keep it private, and only share it with something you trust. Continue?'
        )
      ) {
        return;
      }
      downloadFile('org-pwa-settings.json', JSON.stringify(bundle, null, 2));
      setStatus('Settings exported \u2014 check your downloads.');
    })
  );
  backupRow.appendChild(
    menuButton('Import Settings\u2026', async () => {
      let content;
      try {
        content = await pickTextFile('.json,application/json');
      } catch {
        return; // picker cancelled -- not an error, nothing to report
      }
      let bundle;
      try {
        bundle = JSON.parse(content);
      } catch (err) {
        setStatus('Could not import settings: the file is not valid JSON.');
        return;
      }
      const imported = await importAllSettings(kv, bundle);
      if (imported.length === 0) {
        setStatus('No recognizable settings found in that file.');
        return;
      }
      // Re-apply anything with an immediate visual effect right away,
      // rather than requiring a reload to see the imported theme/fonts
      // take effect.
      if (imported.includes('theme')) applyTheme(await getTheme(kv));
      if (imported.includes('customThemeColors')) {
        customThemeColors = await getCustomThemeColors(kv);
        applyTheme(await getTheme(kv));
      }
      if (imported.includes('fontFamily')) applyFontFamily(await getFontFamily(kv));
      if (imported.includes('fontSize')) applyFontSize(await getFontSize(kv));
      if (imported.includes('tablesFontSize')) applyTablesFontSize(await getTablesFontSize(kv));
      if (imported.includes('github')) githubConfig = await getGithubConfig(kv);
      if (imported.includes('webdav')) webdavConfig = await getWebdavConfig(kv);
      setStatus('Imported: ' + imported.join(', ') + '.');
      renderSettingsView();
    })
  );
  backupSection.appendChild(backupRow);

  const backupHint = document.createElement('div');
  backupHint.style.fontSize = '11px';
  backupHint.style.opacity = '0.6';
  backupHint.style.margin = '2px 0 6px';
  backupHint.textContent =
    'Export bundles every setting on this page \u2014 appearance, capture templates, GitHub, and WebDAV \u2014 into one file, useful for moving settings to another device. Import merges the file\u2019s settings into what\u2019s already configured here; anything the file doesn\u2019t mention is left untouched.';
  backupSection.appendChild(backupHint);

  const updatesSection = document.createElement('div');
  updatesSection.className = 'settings-section';
  container.appendChild(updatesSection);

  const updatesTitle = document.createElement('div');
  updatesTitle.className = 'panel-section-title';
  updatesTitle.textContent = 'Updates';
  updatesSection.appendChild(updatesTitle);

  const updatesRow = document.createElement('div');
  updatesRow.className = 'panel-row';
  updatesRow.appendChild(
    menuButton(
      'Check for updates',
      async () => {
        if (!swRegistration) {
          updateCheckStatus = 'error';
          renderSettingsView();
          return;
        }
        updateCheckStatus = 'checking';
        renderSettingsView();
        try {
          await swRegistration.update();
          // A successful update() that actually found something newer
          // fires 'updatefound' asynchronously, which showUpdateBanner
          // (see the registration setup above) already handles on its
          // own -- including flipping updateCheckStatus to 'found' and
          // re-rendering Settings again once that lands. Give that a
          // brief moment to actually happen before concluding nothing
          // was found -- 'updatefound' isn't guaranteed to have already
          // fired by the time update()'s own promise resolves.
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (updateCheckStatus === 'checking') {
            updateCheckStatus = 'up-to-date';
            renderSettingsView();
          }
        } catch {
          updateCheckStatus = 'error';
          renderSettingsView();
        }
      },
      !('serviceWorker' in navigator)
    )
  );
  updatesSection.appendChild(updatesRow);

  const updatesStatus = document.createElement('div');
  updatesStatus.style.fontSize = '12px';
  updatesStatus.style.marginTop = '6px';
  updatesStatus.textContent =
    updateCheckStatus === 'checking'
      ? 'Checking\u2026'
      : updateCheckStatus === 'up-to-date'
        ? 'You\u2019re on the latest version.'
        : updateCheckStatus === 'found'
          ? 'An update was found \u2014 use the Reload banner at the top to apply it.'
          : updateCheckStatus === 'error'
            ? 'Couldn\u2019t check for updates right now.'
            : '';
  updatesSection.appendChild(updatesStatus);
}

// ---- Docs (README, rendered in-app) --------------------------------------

let cachedDocsDoc = null; // parsed once per session from README.org, not re-fetched/re-parsed on every "Docs" tap

/** Every "/"-joined title path (e.g. "Export/ODT") for a heading that's
 *  currently collapsed within `doc` -- the minority, worth-persisting
 *  case, since README.org's own default startup visibility is fully
 *  expanded (see startup-config.js's own DEFAULT_STARTUP_CONFIG). Used
 *  to save Docs' own fold state when leaving it. */
function collectCollapsedPaths(headings, prefix = '') {
  let paths = [];
  for (const h of headings) {
    const path = prefix ? prefix + '/' + h.title : h.title;
    if (h.collapsed) paths.push(path);
    paths = paths.concat(collectCollapsedPaths(h.children, path));
  }
  return paths;
}

/** The inverse of collectCollapsedPaths: given a previously-saved list
 *  of collapsed title-paths, folds exactly those headings within a
 *  freshly re-parsed `doc` -- everything else is left at whatever
 *  applyStartupVisibility already set it to (expanded, by default). A
 *  path that no longer matches anything (the docs changed since it was
 *  saved) is silently ignored rather than erroring — stale saved state
 *  should degrade gracefully, not break the view. */
function applyCollapsedPaths(headings, collapsedPaths, prefix = '') {
  for (const h of headings) {
    const path = prefix ? prefix + '/' + h.title : h.title;
    if (collapsedPaths.includes(path)) h.collapsed = true;
    applyCollapsedPaths(h.children, collapsedPaths, path);
  }
}

/** Persists Docs' own current fold state and scroll position, so
 *  returning later -- even after a full app restart, not just within
 *  this same session -- can restore roughly where the person left
 *  off. Fire-and-forget (doesn't block whatever's actually closing
 *  Docs) and a no-op if Docs was never actually opened this session
 *  (cachedDocsDoc still null -- nothing to save). */
function saveDocsViewState() {
  if (!cachedDocsDoc) return;
  setDocsViewState(kv, {
    scrollTop: scrollContainer().scrollTop,
    collapsedPaths: collectCollapsedPaths(cachedDocsDoc.children),
  }).catch(() => {});
}

/** The shared "leaving Docs" path -- every one of the several places
 *  Docs can be closed from (opening a different menu, switching
 *  views, navigating away) goes through this rather than setting
 *  docsOpen = false directly, so saving state on the way out can never
 *  be forgotten at any individual call site. */
function closeDocsView() {
  saveDocsViewState();
  docsOpen = false;
}

/**
 * Renders `doc` (a fully separate, parsed org document -- currently only
 * used for README.org in the Docs view) read-only into `container`:
 * headings with working fold/unfold, TODO badges, tags, and body content
 * (paragraphs, lists, tables, blocks), but nothing editable at all -- no
 * tap-to-edit, no action menus, no swipe gestures, no commitAndRender.
 * Deliberately a separate, much simpler rendering path from renderRow
 * rather than a reuse of it: that function is deeply wired for editing
 * throughout (mutation calls, action menus, swipe-to-fold), and threading
 * readOnly conditionals through an already-large core function would risk
 * the main app's actual editing path for the sake of a docs-only feature.
 *
 * Fold state lives directly on `doc`'s own heading objects (the same
 * `collapsed` field the main app's headings already have) -- toggling it
 * only ever mutates this separate, local document, never state.doc, and
 * only ever triggers `rerender()` (a full re-render of this container),
 * never the main app's own render().
 */
let docsScrollTarget = null; // set right before a docs-internal link scrolls to a heading; read once by the next render pass, then left alone (not cleared) so subsequent re-renders from folding elsewhere don't lose the anchor

function renderReadOnlyOutline(doc, container, rerender) {
  container.innerHTML = '';
  const todoSequence = resolveTodoSequence(doc, GLOBAL_TODO_DEFAULT);
  const linkContext = {
    doc,
    onHeadingLinkClick(heading) {
      navigationBackStack.push({ view: currentView, docsOpen, scrollTop: scrollContainer().scrollTop });
      if (navigationBackStack.length > NAVIGATION_BACK_STACK_LIMIT) navigationBackStack.shift();
      syncNavBackButtonVisibility();
      // Expand every ancestor of the link's target (mirroring
      // navigateToHeading's own ancestor-expansion, but against this
      // local doc, never state.doc) so the target is actually visible
      // once scrolled to, then scroll it into view.
      const stack = [];
      function findPath(headings, target, path) {
        for (const h of headings) {
          const next = [...path, h];
          if (h === target) {
            stack.push(...next);
            return true;
          }
          if (findPath(h.children, target, next)) return true;
        }
        return false;
      }
      findPath(doc.children, heading, []);
      for (const ancestor of stack) ancestor.collapsed = false;
      docsScrollTarget = heading;
      rerender();
      requestAnimationFrame(() => {
        const el = document.getElementById('docs-heading-target');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
  };
  for (const heading of doc.children) {
    renderReadOnlyHeading(heading, 0, container, todoSequence, linkContext, rerender);
  }
}

function renderReadOnlyHeading(heading, depth, container, todoSequence, linkContext, rerender) {
  const wrap = document.createElement('div');
  wrap.style.paddingLeft = 8 + depth * 16 + 'px';
  wrap.style.padding = `4px 4px 4px ${8 + depth * 16}px`;
  if (docsScrollTarget === heading) wrap.id = 'docs-heading-target';
  attachSlideLeftToFold(wrap, heading, { onFolded: rerender, archiveVisibility: 'archived' });

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.alignItems = 'flex-start';
  row.style.gap = '4px';

  const hasChildren = heading.children.length > 0;
  const hasFoldableContent = hasChildren || heading.body.length > 0;
  const fold = document.createElement('span');
  fold.textContent = hasFoldableContent ? (heading.collapsed ? '\u25b8' : '\u25be') : ' ';
  fold.style.cursor = hasFoldableContent ? 'pointer' : 'default';
  fold.style.width = '16px';
  fold.style.flexShrink = '0';
  fold.style.userSelect = 'none';
  if (hasFoldableContent) {
    fold.onclick = () => {
      toggleFold(heading);
      rerender();
    };
  }
  row.appendChild(fold);

  const titleWrap = document.createElement('div');
  titleWrap.style.flex = '1';

  if (heading.todo) {
    const badge = document.createElement('span');
    badge.className = 'todo-badge ' + (todoSequence.doneKeywords.includes(heading.todo) ? 'done' : 'todo');
    badge.textContent = heading.todo;
    badge.style.marginRight = '4px';
    titleWrap.appendChild(badge);
  }

  const title = document.createElement('span');
  title.style.fontWeight = depth === 0 ? '700' : '600';
  title.style.fontSize = depth === 0 ? '17px' : depth === 1 ? '15px' : '14px';
  renderInlineNodes(parseInline(heading.title, currentInlineOpts()), title, linkContext);
  titleWrap.appendChild(title);

  for (const tag of heading.tags) {
    const t = document.createElement('span');
    t.className = 'tag';
    t.style.marginLeft = '4px';
    t.textContent = tag;
    titleWrap.appendChild(t);
  }

  row.appendChild(titleWrap);
  wrap.appendChild(row);
  container.appendChild(wrap);

  if (!heading.collapsed) {
    if (!heading.bodyHidden) {
      for (const node of heading.body) {
        renderReadOnlyBodyNode(node, depth, container, linkContext, heading.drawersHidden);
      }
    }
    for (const child of heading.children) {
      renderReadOnlyHeading(child, depth + 1, container, todoSequence, linkContext, rerender);
    }
  }
}

function renderReadOnlyBodyNode(node, depth, container, linkContext, drawersHidden) {
  const indent = 8 + depth * 16 + 16;
  if (node.type === 'paragraph') {
    const p = document.createElement('div');
    p.style.paddingLeft = indent + 'px';
    p.style.margin = '4px 0';
    p.style.lineHeight = '1.4';
    if (node.footnoteLabel !== null) {
      p.style.fontSize = '0.92em';
      p.style.opacity = '0.85';
      const labelEl = document.createElement('sup');
      labelEl.textContent = '[' + node.footnoteLabel + '] ';
      labelEl.style.opacity = '0.7';
      p.appendChild(labelEl);
    }
    node.inlineLines.forEach((inline, i) => {
      if (i > 0) p.appendChild(document.createElement('br'));
      renderInlineNodes(inline, p, linkContext);
    });
    container.appendChild(p);
  } else if (node.type === 'hr') {
    const hr = document.createElement('hr');
    hr.style.marginLeft = indent + 'px';
    hr.style.border = 'none';
    hr.style.borderTop = '1px solid var(--border)';
    container.appendChild(hr);
  } else if (node.type === 'list') {
    renderReadOnlyList(node, depth, container, linkContext);
  } else if (node.type === 'table') {
    renderReadOnlyTable(node, depth, container);
  } else if (node.type === 'block') {
    renderReadOnlyBlock(node, depth, container, drawersHidden, linkContext);
  }
}

function renderReadOnlyList(list, depth, container, linkContext, listDepth = 0) {
  let orderedCounter = 0;
  for (const item of list.items) {
    const row = document.createElement('div');
    row.style.paddingLeft = 8 + depth * 16 + 16 + listDepth * 16 + 'px';
    row.style.margin = '2px 0';
    row.style.display = 'flex';
    row.style.gap = '6px';

    const marker = document.createElement('span');
    marker.style.flexShrink = '0';
    marker.style.opacity = '0.6';
    if (item.checkbox) {
      marker.textContent = item.checkbox === 'X' || item.checkbox === 'x' ? '\u2611' : item.checkbox === '-' ? '\u2612' : '\u2610';
    } else if (item.ordered) {
      orderedCounter = item.startValue != null ? item.startValue : orderedCounter + 1;
      marker.textContent = orderedCounter + '.';
    } else {
      marker.textContent = '\u2022';
    }
    row.appendChild(marker);

    const text = document.createElement('span');
    if (item.tag) {
      const tagEl = document.createElement('b');
      tagEl.textContent = item.tag;
      text.appendChild(tagEl);
      text.appendChild(document.createTextNode(' \u2014 '));
    }
    renderInlineNodes(item.inline, text, linkContext);
    row.appendChild(text);

    container.appendChild(row);

    for (const nested of item.children) {
      renderReadOnlyList(nested, depth, container, linkContext, listDepth + 1);
    }
  }
}

function renderReadOnlyTable(table, depth, container) {
  const el = document.createElement('table');
  el.style.marginLeft = 8 + depth * 16 + 16 + 'px';
  el.style.borderCollapse = 'collapse';
  el.style.fontSize = '13px';
  table.rows.forEach((row, rowIndex) => {
    if (row.type === 'rule') return; // a rule row is a visual-only separator, nothing to render as content
    const tr = document.createElement('tr');
    const isHeader = isTableHeaderRow(table, rowIndex);
    for (const cellInline of row.cellsInline) {
      const td = document.createElement('td');
      td.style.border = '1px solid var(--border)';
      td.style.padding = '4px 8px';
      if (isHeader) td.style.fontWeight = '600';
      renderInlineNodes(cellInline, td, null);
      tr.appendChild(td);
    }
    el.appendChild(tr);
  });
  container.appendChild(el);
}

/** A block starts collapsed to a single label, matching the same
 *  "collapsed block" convention the main app already uses for
 *  #+BEGIN_SRC/#+BEGIN_QUOTE/etc. -- tap to reveal, tap again to
 *  re-fold. Local, closure-captured state (not stored on the node
 *  itself), since a block's own expand/collapse state doesn't need to
 *  survive a full docs re-render the way heading fold state does. */
function renderReadOnlyBlock(block, depth, container, drawersHidden, linkContext) {
  let expanded = !drawersHidden;
  const wrap = document.createElement('div');
  wrap.style.marginLeft = 8 + depth * 16 + 16 + 'px';
  wrap.style.margin = '4px 0';

  const label = document.createElement('div');
  label.style.fontSize = '11px';
  label.style.opacity = '0.6';
  label.style.cursor = 'pointer';
  label.textContent = `[${block.name}]`;
  wrap.appendChild(label);

  const content = document.createElement('div');
  content.style.display = expanded ? 'block' : 'none';
  renderBlockContent(block, content, linkContext);
  wrap.appendChild(content);

  label.onclick = () => {
    expanded = !expanded;
    content.style.display = expanded ? 'block' : 'none';
  };

  container.appendChild(wrap);
}

async function renderDocsView(target = docsRenderTarget) {
  docsRenderTarget = target;
  target.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'panel';
  container.style.minHeight = '100%';
  target.appendChild(container);

  let restoreScrollTop = null;

  if (cachedDocsDoc === null) {
    try {
      const response = await fetch('./README.org');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const text = await response.text();
      cachedDocsDoc = parseOrg(text);

      const savedState = await getDocsViewState(kv);
      if (savedState) {
        // A returning visit: start fully expanded, then re-apply exactly
        // the previously-saved fold state on top -- restoring where
        // things were left, not a fresh reset.
        applyStartupVisibility(cachedDocsDoc, { visibility: 'showeverything', imageVisibility: 'noinlineimages', logDone: null }, 'archived');
        applyCollapsedPaths(cachedDocsDoc.children, savedState.collapsedPaths || []);
        restoreScrollTop = savedState.scrollTop;
      } else {
        // A genuine first-ever visit (this device has never left Docs
        // with anything to remember) -- top-level headers only, a
        // Docs-specific override independent of whatever README.org's
        // own #+STARTUP line says (there isn't one), so opening
        // README.org as a regular file elsewhere is completely
        // unaffected by this choice.
        applyStartupVisibility(cachedDocsDoc, { visibility: 'overview', imageVisibility: 'noinlineimages', logDone: null }, 'archived');
      }

      docsScrollTarget = null; // a genuinely fresh load -- no stale scroll target from a previous session
    } catch (err) {
      const errorEl = document.createElement('div');
      errorEl.style.padding = '20px';
      errorEl.style.opacity = '0.7';
      errorEl.textContent = "Couldn't load the documentation (" + err.message + '). Try again once you\u2019re back online.';
      container.appendChild(errorEl);
      return;
    }
  }

  if (!docsOpen) return; // closed again while the fetch above was in flight

  renderReadOnlyOutline(cachedDocsDoc, container, () => renderDocsView(docsRenderTarget));

  if (restoreScrollTop !== null) {
    requestAnimationFrame(() => {
      scrollContainer().scrollTop = restoreScrollTop;
    });
  }
}

/** Opens Docs and scrolls directly to a specific section, identified
 *  by its CUSTOM_ID anchor (e.g. "#capture-templates") -- the same
 *  resolution resolveLinkTarget already uses for [[#id][...]]-style
 *  links, and the same ancestor-expansion + docsScrollTarget mechanism
 *  onHeadingLinkClick (Docs' own internal link handling) already
 *  established, just triggered from outside Docs itself rather than
 *  from a tap on a link within it. Used by Settings' own hotlinks to
 *  the corresponding help section, so a streamlined settings hint can
 *  point at the full documentation instead of duplicating it inline. */
async function openDocsAtHeading(anchorId) {
  navigationBackStack.push({ view: currentView, docsOpen, settingsOpen, scrollTop: scrollContainer().scrollTop });
  if (navigationBackStack.length > NAVIGATION_BACK_STACK_LIMIT) navigationBackStack.shift();
  syncNavBackButtonVisibility();
  moreOpen = false;
  settingsOpen = false;
  docsOpen = true;
  await renderDocsView(outlineEl); // ensures cachedDocsDoc is loaded, regardless of layout
  if (!cachedDocsDoc) return; // load failed -- renderDocsView already showed its own error message

  const resolution = resolveLinkTarget(cachedDocsDoc, anchorId);
  if (resolution.type !== 'heading') return; // an unresolvable anchor is a documentation bug, not something to surface as a runtime error

  const stack = [];
  function findPath(headings, target, path) {
    for (const h of headings) {
      const next = [...path, h];
      if (h === target) {
        stack.push(...next);
        return true;
      }
      if (findPath(h.children, target, next)) return true;
    }
    return false;
  }
  findPath(cachedDocsDoc.children, resolution.heading, []);
  for (const ancestor of stack) ancestor.collapsed = false;
  docsScrollTarget = resolution.heading;

  if (isWideLayout()) {
    render();
  } else {
    await renderDocsView(outlineEl);
  }
  requestAnimationFrame(() => {
    const el = document.getElementById('docs-heading-target');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

settingsBtn.addEventListener('click', async () => {
  settingsOpen = !settingsOpen;
  if (settingsOpen && fileMenuOpen) {
    fileMenuOpen = false;
    fileMenuStep = null;
    exportFormat = null;
    exportPickingHeading = false;
    stopBrowsing();
    renderFileMenu();
  }
  if (settingsOpen && searchOpen) {
    searchOpen = false;
    renderSearchPanel();
  }
  if (settingsOpen && viewMenuOpen) {
    viewMenuOpen = false;
    renderViewMenu();
  }
  if (settingsOpen && captureOpen) {
    captureOpen = false;
    renderCapturePanel();
  }
  if (settingsOpen && moreOpen) {
    moreOpen = false;
    renderMoreMenu();
  }
  if (settingsOpen && docsOpen) {
    closeDocsView();
  }
  if (settingsOpen && historyOpen) {
    historyOpen = false;
    renderHistoryPanel();
  }
  if (settingsOpen) {
    if (isWideLayout()) {
      render(); // syncSidePanel (called by render) populates and shows #sidePanel; #outline renders normally alongside it
    } else {
      await renderSettingsView(outlineEl); // narrow: replaces #outline directly, exactly as before this feature existed
    }
  } else {
    render(); // restores whatever currentView was showing before settings opened
  }
});

// ---- Search UI -----------------------------------------------------------

const SEARCH_TYPE_ICON = {
  heading: '\u25c9',
  paragraph: '\u00b6',
  'list-item': '\u2022',
  table: '\u25a6',
  block: '\u2318',
  property: '\ud83c\udff7\ufe0f',
  planning: '\ud83d\udcc5',
};

function renderSearchPanel() {
  searchPanel.innerHTML = '';
  if (!searchOpen) {
    searchPanel.style.display = 'none';
    return;
  }
  searchPanel.style.display = 'block';

  const input = document.createElement('textarea');
  input.id = 'search-query-input';
  input.rows = 1;
  input.placeholder = 'Search, or +tag  -tag  key:value\u2026';
  input.value = searchQuery;
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  input.style.font = 'inherit';
  input.style.fontSize = '16px';
  input.style.padding = '6px 8px';
  input.style.border = '1px solid var(--border-strong)';
  input.style.borderRadius = '4px';
  input.style.background = 'var(--bg)';
  input.style.color = 'var(--fg)';
  input.style.overflowWrap = 'anywhere';
  input.addEventListener('input', () => {
    searchQuery = input.value;
    renderSearchResults();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault(); // a search query is one line; results already update live
    if (e.key === 'Escape') {
      e.preventDefault();
      searchOpen = false;
      searchQuery = '';
      renderSearchPanel();
    }
  });
  autoGrowTextarea(input);
  searchPanel.appendChild(input);

  const regexRow = document.createElement('div');
  regexRow.style.display = 'flex';
  regexRow.style.alignItems = 'center';
  regexRow.style.gap = '8px';
  regexRow.style.marginTop = '6px';
  regexRow.style.flexWrap = 'wrap';

  const regexToggle = document.createElement('button');
  regexToggle.textContent = 'Regex';
  regexToggle.setAttribute('aria-label', searchUseRegex ? 'Regex search on' : 'Regex search off');
  regexToggle.style.fontFamily = 'monospace';
  regexToggle.style.fontSize = '13px';
  regexToggle.style.fontWeight = '700';
  regexToggle.style.padding = '3px 9px';
  regexToggle.style.borderRadius = '12px';
  regexToggle.style.border = '1px solid var(--border-strong)';
  regexToggle.style.background = searchUseRegex ? 'var(--accent)' : 'transparent';
  regexToggle.style.color = searchUseRegex ? '#fff' : 'var(--fg)';
  regexToggle.style.flexShrink = '0';
  regexToggle.onclick = () => {
    searchUseRegex = !searchUseRegex;
    renderSearchPanel();
  };
  regexRow.appendChild(regexToggle);

  const filterHint = document.createElement('span');
  filterHint.style.flex = '1';
  filterHint.style.fontFamily = 'monospace';
  filterHint.style.fontSize = '11px';
  filterHint.style.opacity = '0.55';
  filterHint.style.textAlign = 'right';
  filterHint.style.overflowWrap = 'anywhere';
  filterHint.textContent = 'Hints: +tag  -tag  todo:X  priority:A  key:value';
  regexRow.appendChild(filterHint);

  searchPanel.appendChild(regexRow);

  const resultsEl = document.createElement('div');
  resultsEl.id = 'search-results';
  resultsEl.style.marginTop = '6px';
  resultsEl.style.maxHeight = `50${VH_UNIT}`;
  resultsEl.style.overflowY = 'auto';
  searchPanel.appendChild(resultsEl);

  renderSearchResults();
  requestAnimationFrame(() => input.focus());
}

function renderSearchResults() {
  const resultsEl = document.getElementById('search-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = '';

  if (!searchQuery.trim()) return;
  if (!state.doc) return;

  let results;
  try {
    results = searchDocument(state.doc, searchQuery, {
      useRegex: searchUseRegex,
      useTagInheritance: getUseTagInheritance(state.localVariables),
      usePropertyInheritance: getUsePropertyInheritance(state.localVariables),
    });
  } catch (err) {
    const errorEl = document.createElement('div');
    errorEl.style.fontSize = '13px';
    errorEl.style.color = '#c0392b';
    errorEl.style.padding = '6px 2px';
    errorEl.textContent = err.message;
    resultsEl.appendChild(errorEl);
    return;
  }
  if (results.length === 0) {
    const empty = document.createElement('div');
    empty.style.fontSize = '13px';
    empty.style.opacity = '0.6';
    empty.style.padding = '6px 2px';
    empty.textContent = 'No matches.';
    resultsEl.appendChild(empty);
    return;
  }

  for (const result of results) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '6px';
    row.style.alignItems = 'baseline';
    row.style.padding = '6px 2px';
    row.style.borderBottom = '1px solid var(--border)';
    row.style.cursor = 'pointer';

    const icon = document.createElement('span');
    icon.textContent = SEARCH_TYPE_ICON[result.type] || '\u2022';
    icon.style.flexShrink = '0';
    icon.style.opacity = '0.6';
    row.appendChild(icon);

    const text = document.createElement('div');
    text.style.minWidth = '0';
    text.style.flex = '1 1 auto';
    const headingLine = document.createElement('div');
    headingLine.style.fontSize = '11px';
    headingLine.style.opacity = '0.6';
    headingLine.textContent = result.heading.title || '(untitled)';
    const snippetLine = document.createElement('div');
    snippetLine.style.fontSize = '14px';
    snippetLine.style.overflow = 'hidden';
    snippetLine.style.textOverflow = 'ellipsis';
    snippetLine.style.whiteSpace = 'nowrap';
    snippetLine.textContent = result.snippet;
    text.appendChild(headingLine);
    if (result.type !== 'heading') text.appendChild(snippetLine);
    row.appendChild(text);

    row.onclick = () => {
      searchOpen = false;
      renderSearchPanel();
      navigateToHeading(result.heading, {
        revealOwnBody: result.type !== 'heading',
        targetNode: result.node,
      });
    };
    resultsEl.appendChild(row);
  }
}

searchBtn.addEventListener('click', () => {
  searchOpen = !searchOpen;
  if (searchOpen && currentView === 'text') {
    // Leaving text mode reparses the document into new objects — do this
    // now, before any search results are computed, not later when a
    // result is tapped. Otherwise a result computed against the old
    // document would already be stale by the time it's tapped.
    switchToView('org');
  }
  if (searchOpen && fileMenuOpen) {
    fileMenuOpen = false;
    fileMenuStep = null;
    exportFormat = null;
    exportPickingHeading = false;
    stopBrowsing();
    renderFileMenu();
  }
  if (searchOpen && settingsOpen) {
    settingsOpen = false;
    render(); // restores the normal outline content in place of settings
  }
  if (searchOpen && viewMenuOpen) {
    viewMenuOpen = false;
    renderViewMenu();
  }
  if (searchOpen && moreOpen) {
    moreOpen = false;
    renderMoreMenu();
  }
  if (searchOpen && docsOpen) {
    closeDocsView();
    render();
  }
  if (searchOpen && historyOpen) {
    historyOpen = false;
    renderHistoryPanel();
  }
  if (!searchOpen) searchQuery = '';
  renderSearchPanel();
});

// ---- Capture ---------------------------------------------------------

// ---- Capture ---------------------------------------------------------

const CAPTURE_TYPES = ['item', 'checkitem', 'plain', 'table-line'];

/** Returns a human-readable problem description, or null if `parsed` is
 *  a valid capture-templates array. Checked before saving from Settings
 *  so a malformed edit gets a clear message immediately, rather than
 *  either silently corrupting the stored config or failing confusingly
 *  later when a capture is actually run against it. */
function validateCaptureTemplates(parsed) {
  if (!Array.isArray(parsed)) return 'must be a JSON array';
  for (let i = 0; i < parsed.length; i++) {
    const t = parsed[i];
    const label = `template #${i + 1}`;
    if (!t || typeof t !== 'object') return `${label} must be an object`;
    if (typeof t.key !== 'string' || t.key.length === 0) return `${label}: "key" must be a non-empty string`;
    if (typeof t.description !== 'string') return `${label}: "description" must be a string`;
    if (!CAPTURE_TYPES.includes(t.type)) return `${label}: "type" must be one of ${CAPTURE_TYPES.join(', ')}`;
    if (!Array.isArray(t.olp) || t.olp.length === 0 || !t.olp.every((s) => typeof s === 'string')) {
      return `${label}: "olp" must be a non-empty array of strings`;
    }
    if (typeof t.template !== 'string') return `${label}: "template" must be a string`;
    if ('file' in t && typeof t.file !== 'string') return `${label}: "file" must be a string if present`;
    if ('prepend' in t && typeof t.prepend !== 'boolean') return `${label}: "prepend" must be true or false if present`;
    if ('prependHeading' in t && typeof t.prependHeading !== 'boolean') return `${label}: "prependHeading" must be true or false if present`;
  }
  const keys = parsed.map((t) => t.key);
  const duplicate = keys.find((k, i) => keys.indexOf(k) !== i);
  if (duplicate !== undefined) return `duplicate key "${duplicate}" \u2014 each template needs a unique key`;
  return null;
}

/** Converts org-agenda-files' own raw string value (semicolon-
 *  separated "scheme:path" entries, the same separator convention
 *  org-refile-targets already uses) into the array-of-strings shape
 *  the storage layer expects. A malformed entry -- not "scheme:path"
 *  at all, or an unrecognized scheme -- is silently skipped rather
 *  than guessed at or blocking the whole value, the same "malformed
 *  entry -- skipped, not guessed at" precedent org-refile-targets'
 *  own parser already sets (see src/refile.js), now that this is a
 *  generic Quick Settings longtext field with no separate blocking-
 *  validation step of its own. Splits only on the FIRST colon within
 *  each entry, so a path that itself contains one isn't mistaken for
 *  a second scheme separator. */
function parseAgendaFilesVar(text) {
  const entries = (text || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.filter((entry) => {
    const colonIndex = entry.indexOf(':');
    if (colonIndex === -1) return false;
    const scheme = entry.slice(0, colonIndex);
    const path = entry.slice(colonIndex + 1);
    return (scheme === 'github' || scheme === 'webdav') && path.length > 0;
  });
}

async function renderCapturePanel() {
  capturePanel.innerHTML = '';
  if (!captureOpen) {
    capturePanel.style.display = 'none';
    capturePromptTemplate = null;
    return;
  }
  capturePanel.style.display = 'block';

  if (capturePromptTemplate) {
    renderCapturePromptForm();
    return;
  }

  const heading = document.createElement('div');
  heading.style.fontSize = '12px';
  heading.style.opacity = '0.65';
  heading.style.marginBottom = '8px';
  heading.textContent = 'Capture \u2014 pick a template';
  capturePanel.appendChild(heading);

  const templates = await getCaptureTemplates(kv);
  if (!captureOpen) return; // panel was closed again before this resolved

  if (templates.length === 0) {
    const empty = document.createElement('div');
    empty.style.opacity = '0.6';
    empty.style.fontSize = '13px';
    empty.textContent = 'No capture templates configured yet — add some in Settings.';
    capturePanel.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '1fr 1fr';
  grid.style.gap = '6px';

  for (const template of templates) {
    const btn = document.createElement('button');
    btn.style.textAlign = 'left';
    btn.style.padding = '10px 12px';
    btn.style.border = '1px solid var(--border-strong)';
    btn.style.borderRadius = '8px';
    btn.style.background = 'var(--bg)';
    btn.style.color = 'var(--fg)';
    btn.style.fontSize = '14px';
    btn.style.minHeight = '44px';
    btn.textContent = template.description;
    btn.onclick = () => openCapturePrompt(template);
    grid.appendChild(btn);
  }
  capturePanel.appendChild(grid);
}

/** Opens the given template: straight to capturing it if it has no
 *  %^{Prompt} placeholders to fill in, otherwise shows the in-app
 *  prompt form first. */
function openCapturePrompt(template) {
  const prompts = scanPrompts(template.template);
  if (prompts.length === 0) {
    runCaptureWithAnswers(template, []);
    return;
  }
  capturePromptTemplate = template;
  capturePromptValues = prompts.map((p) => p.default || '');
  renderCapturePanel();
}

/** Renders the in-app form for answering a template's %^{Prompt}
 *  placeholders -- one labeled input per prompt (completions, if any,
 *  shown as a hint under the field, matching what window.prompt's own
 *  message text used to fold in), Capture/Cancel at the bottom. */
function renderCapturePromptForm() {
  const template = capturePromptTemplate;
  const prompts = scanPrompts(template.template);
  const previewNow = new Date(); // captured once, not per-keystroke, so the displayed time doesn't visibly tick while typing

  const heading = document.createElement('div');
  heading.style.fontSize = '12px';
  heading.style.opacity = '0.65';
  heading.style.marginBottom = '8px';
  heading.textContent = template.key + ' \u2014 ' + template.description;
  capturePanel.appendChild(heading);

  const previewLabel = document.createElement('div');
  previewLabel.style.fontSize = '11px';
  previewLabel.style.opacity = '0.6';
  previewLabel.style.marginBottom = '2px';
  previewLabel.textContent = 'Preview:';
  capturePanel.appendChild(previewLabel);

  const preview = document.createElement('div');
  preview.style.fontFamily = 'ui-monospace, monospace';
  preview.style.fontSize = '13px';
  preview.style.whiteSpace = 'pre-wrap';
  preview.style.wordBreak = 'break-word';
  preview.style.background = 'var(--surface, #f6f6f6)';
  preview.style.border = '1px solid var(--border-strong)';
  preview.style.borderRadius = '6px';
  preview.style.padding = '8px 10px';
  preview.style.marginBottom = '12px';
  capturePanel.appendChild(preview);

  function updatePreview() {
    const { text } = expandTemplate(template.template, { now: previewNow, promptAnswers: capturePromptValues });
    preview.textContent = text;
  }
  updatePreview();

  prompts.forEach((p, i) => {
    const field = document.createElement('div');
    field.style.marginBottom = '10px';

    const label = document.createElement('div');
    label.style.fontSize = '13px';
    label.style.marginBottom = '3px';
    label.textContent = p.prompt;
    field.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = capturePromptValues[i];
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    input.style.fontSize = '15px';
    input.style.padding = '8px 10px';
    input.style.border = '1px solid var(--border-strong)';
    input.style.borderRadius = '6px';
    input.style.background = 'var(--bg)';
    input.style.color = 'var(--fg)';
    input.addEventListener('input', () => {
      capturePromptValues[i] = input.value;
      updatePreview();
    });
    field.appendChild(input);

    if (p.completions.length > 0) {
      const hint = document.createElement('div');
      hint.style.fontSize = '11px';
      hint.style.opacity = '0.6';
      hint.style.marginTop = '2px';
      hint.textContent = 'Options: ' + p.completions.join(', ');
      field.appendChild(hint);
    }

    capturePanel.appendChild(field);
    if (i === 0) requestAnimationFrame(() => input.focus());
  });

  const row = document.createElement('div');
  row.className = 'panel-row';
  row.appendChild(
    menuButton('Capture', () => {
      const answers = capturePromptValues.slice();
      runCaptureWithAnswers(template, answers);
    })
  );
  row.appendChild(
    menuButton('Cancel', () => {
      capturePromptTemplate = null;
      if (captureOpenedFromExtraMenu) {
        captureOpenedFromExtraMenu = false;
        captureOpen = false;
      }
      setStatus('Capture cancelled.');
      renderCapturePanel();
    })
  );
  capturePanel.appendChild(row);
}

/**
 * Runs one capture template end to end, given `answers` already
 * gathered for its %^{...} AND %? prompts (by the in-app prompt form,
 * or an empty array if the template has none): resolves its
 * (file+olp ...) target (creating any missing heading along the way),
 * computes @# if this is a table-line capture, expands the template
 * (with every prompt's answer, %? included, already substituted
 * directly into the text — see scanPrompts/expandTemplate), inserts
 * it, and navigates to the target heading.
 *
 * Afterward: a template with at least one prompt loops back to a
 * FRESH copy of its own form rather than the template list — the
 * "multiple entries" feature, for templates that are naturally
 * captured several times in a row (a journal line, a tracking row).
 * A template with no prompts at all returns to the template list,
 * since there's nothing left to fill in for a repeat.
 */
/** Which value controls where an auto-created OLP heading lands among
 *  its own siblings, for a given template -- table-line has its own
 *  dedicated prependHeading field, since row placement (prepend) and
 *  heading placement are genuinely independent decisions for it
 *  (newest section first, but chronological rows within it is a
 *  common, sensible combination); item/checkitem/plain reuse the same
 *  prepend value for both, since for those three "where does the
 *  container heading go" and "where does the content go" are the same
 *  decision applied at two tree levels, not two independent ones. */
function getOlpPrepend(template) {
  return template.type === 'table-line' ? !!template.prependHeading : !!template.prepend;
}

async function runCaptureWithAnswers(template, answers) {
  if (currentView === 'text') {
    // Same reasoning as search's own text-mode guard above: leaving text
    // mode reparses the document into new objects, so do it now, before
    // resolveOlpTarget below touches state.doc, not after.
    switchToView('org');
  }

  const now = new Date();

  const rawFile = String(template.file || '').trim();
  if (rawFile) {
    const { scheme } = getCaptureFileScheme(rawFile);
    if (scheme && !CAPTURE_FILE_SCHEMES.has(scheme)) {
      setStatus(`Can't capture: "${template.file}" starts with an unrecognized scheme ("${scheme}:") \u2014 only "github:" and "webdav:" are understood. Remove the prefix for a plain path, or fix the scheme name.`);
      renderCapturePanel();
      return;
    }
    if (scheme && scheme !== state.storageKind) {
      setStatus(
        `Can't capture: "${template.file}" targets ${scheme}, but the currently open document is on ${state.storageKind === 'github' ? 'GitHub' : state.storageKind === 'webdav' ? 'WebDAV' : state.storageKind} \u2014 capture can't switch backends. Remove the "${scheme}:" prefix to capture into a sibling file on the same backend as whatever's currently open instead.`
      );
      renderCapturePanel();
      return;
    }
  }

  const targetFileId = resolveCaptureFileId(template.file, state.documentId);

  if (targetFileId !== state.documentId) {
    // Cross-file capture: read/insert/write the OTHER file directly via
    // whichever backend the current document itself came from, without
    // touching state.doc or switching the active view at all -- matching
    // real org-capture's own behavior of not switching your current
    // buffer just because a template's target is elsewhere.
    setStatus(`Capturing to ${targetFileId}\u2026`);
    const { ok } = await writeToOtherFile(targetFileId, {
      label: 'capture',
      allowMissing: true,
      mutate: (doc) => {
        const target = resolveOlpTarget(doc, template.olp, { now, prepend: getOlpPrepend(template) });
        let tableRowNumber = null;
        if (template.type === 'table-line') {
          const existingTable = [...target.body].reverse().find((n) => n.type === 'table');
          const dataRowCount = existingTable ? existingTable.rows.filter((r) => r.type === 'row').length : 0;
          // @# reflects the row's ACTUAL final position -- 1 (the new first
          // data row) when prepending to an existing table, dataRowCount + 1
          // (the next row after every existing one) when appending, the
          // table's own default.
          tableRowNumber = template.prepend && existingTable ? 1 : dataRowCount + 1;
        }
        const { text } = expandTemplate(template.template, { now, promptAnswers: answers, tableRowNumber });
        insertCapture(target, template.type, text, template.prepend);
        return true;
      },
    });
    if (!ok) {
      renderCapturePanel();
      return;
    }

    setStatus(`Captured to ${targetFileId}.`);
    afterSuccessfulCapture();
    return;
  }

  const target = resolveOlpTarget(state.doc, template.olp, { now, prepend: getOlpPrepend(template) });

  let tableRowNumber = null;
  if (template.type === 'table-line') {
    const existingTable = [...target.body].reverse().find((n) => n.type === 'table');
    const dataRowCount = existingTable ? existingTable.rows.filter((r) => r.type === 'row').length : 0;
    // @# reflects the row's ACTUAL final position -- 1 (the new first
    // data row) when prepending to an existing table, dataRowCount + 1
    // (the next row after every existing one) when appending, the
    // table's own default.
    tableRowNumber = template.prepend && existingTable ? 1 : dataRowCount + 1;
  }

  const { text } = expandTemplate(template.template, {
    now,
    promptAnswers: answers,
    tableRowNumber,
  });

  insertCapture(target, template.type, text, template.prepend);
  commitAndRender(`Captured: ${template.description}`);

  switchToView('org');
  navigateToHeading(target, { revealOwnBody: true });
  setStatus('Captured.');
  afterSuccessfulCapture();
}

/** After a successful capture, the form always closes, returning to
 *  the template list -- captureOpen itself is untouched here, so the
 *  panel stays open on that list, which is how rapid multi-template
 *  capture actually works: tap the next template straight from the
 *  list, not a reopened copy of the same form. */
function afterSuccessfulCapture() {
  capturePromptTemplate = null;
  if (captureOpenedFromExtraMenu) {
    captureOpenedFromExtraMenu = false;
    captureOpen = false;
  }
  renderCapturePanel();
}

/** Shows/hides the floating extras (☰) button based on whether
 *  org-xx-extra-menu (Global/Local Variables, see src/extra-menu.js's own
 *  docs) currently resolves to at least one SELECTABLE entry --
 *  showing an always-visible button that opens an empty or
 *  separator-only menu would be confusing, not useful. */
function syncExtraMenuButtonVisibility() {
  if (!state.localVariables) {
    extraMenuBtn.style.display = 'none';
    return;
  }
  const entries = parseExtraMenu(getExtraMenu(state.localVariables));
  const hasSelectable = entries.some((e) => e.type !== 'separator');
  extraMenuBtn.style.display = hasSelectable ? 'flex' : 'none';
}

/** Renders the extras popup's own content -- a vertical list of
 *  tappable rows (one per menu entry) plus visual dividers for
 *  separator entries, matching the org-xx-extra-menu spec's own
 *  five-hyphen convention. */
function renderExtraMenu() {
  extraMenuPanel.innerHTML = '';
  if (!extraMenuOpen) {
    extraMenuPanel.style.display = 'none';
    return;
  }
  const entries = state.localVariables ? parseExtraMenu(getExtraMenu(state.localVariables)) : [];
  if (entries.length === 0) {
    // The menu emptied out from under an already-open popup (e.g. the
    // document changed) -- close it rather than showing a blank panel.
    extraMenuOpen = false;
    extraMenuPanel.style.display = 'none';
    return;
  }
  extraMenuPanel.style.display = 'block';
  for (const entry of entries) {
    if (entry.type === 'separator') {
      const hr = document.createElement('div');
      hr.style.borderTop = '1px solid var(--border)';
      hr.style.margin = '4px 2px';
      extraMenuPanel.appendChild(hr);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'panel-row';
    row.style.cursor = 'pointer';
    row.style.padding = '9px 8px';
    row.style.fontSize = '14px';
    row.textContent = entry.label;
    row.onclick = () => runExtraMenuEntry(entry);
    extraMenuPanel.appendChild(row);
  }
}

/** Executes a selected extras-menu entry, dispatched by type:
 *  - capture: runs the matching capture template by key, exactly as
 *    if it had been picked from the regular Capture menu itself.
 *  - olp: resolves (and creates, if needed -- the same
 *    resolveOlpTarget capture templates themselves already use,
 *    including its own %<FORMAT> expansion) the target heading, then
 *    navigates to it.
 *  - function: runs a built-in function by name. Only org-clock-out
 *    is recognized today; more may be added later.
 */
async function runExtraMenuEntry(entry) {
  extraMenuOpen = false;
  renderExtraMenu();

  if (entry.type === 'capture') {
    const templates = await getCaptureTemplates(kv);
    const template = templates.find((t) => t.key === entry.key);
    if (!template) {
      setStatus(`No capture template with key "${entry.key}" found.`);
      render();
      return;
    }
    captureOpenedFromExtraMenu = true;
    captureOpen = true;
    openCapturePrompt(template);
    return;
  }

  if (entry.type === 'olp') {
    if (!state.doc) return;
    const target = resolveOlpTarget(state.doc, entry.headers, { now: new Date(), allowCreate: false });
    if (!target) {
      setStatus(`"${entry.headers.join(' / ')}" doesn't exist yet \u2014 nothing was created.`);
      render();
      return;
    }
    switchToView('org');
    navigateToHeading(target);
    return;
  }

  if (entry.type === 'function') {
    if (entry.name === 'org-clock-out' || entry.name === 'org-clock-cancel') {
      const running = state.doc ? findHeadingWithRunningClock(state.doc) : null;
      if (!running) {
        setStatus('No clock is currently running.');
        render();
        return;
      }
      if (entry.name === 'org-clock-out') {
        clockOutHeading(running);
      } else {
        clockCancelHeading(running);
      }
    } else if (entry.name === 'export-markdown') {
      if (!state.doc) return;
      performExport('markdown', null);
    }
    return;
  }
}

extraMenuBtn.addEventListener('click', () => {
  extraMenuOpen = !extraMenuOpen;
  renderExtraMenu();
});

captureBtn.addEventListener('click', () => {
  captureOpen = !captureOpen;
  captureOpenedFromExtraMenu = false;
  if (captureOpen && fileMenuOpen) {
    fileMenuOpen = false;
    fileMenuStep = null;
    exportFormat = null;
    exportPickingHeading = false;
    stopBrowsing();
    renderFileMenu();
  }
  if (captureOpen && settingsOpen) {
    settingsOpen = false;
    render();
  }
  if (captureOpen && viewMenuOpen) {
    viewMenuOpen = false;
    renderViewMenu();
  }
  if (captureOpen && searchOpen) {
    searchOpen = false;
    searchQuery = '';
    renderSearchPanel();
  }
  if (captureOpen && moreOpen) {
    moreOpen = false;
    renderMoreMenu();
  }
  if (captureOpen && docsOpen) {
    closeDocsView();
    render();
  }
  if (captureOpen && historyOpen) {
    historyOpen = false;
    renderHistoryPanel();
  }
  renderCapturePanel();
});

// ---- More menu (Search / Capture / Add heading) ---------------------

/** Search, Capture, and Add heading live behind this one button instead
 *  of each having their own place in the top bar — frees up room for
 *  the filename, which otherwise competes for space with up to six
 *  separate icon buttons. Each option here just calls .click() on the
 *  original (still-present-but-hidden) button rather than reimplementing
 *  any of its logic, so nothing about how search/capture/add actually
 *  work changes at all — only how they're reached. */
function renderMoreMenu() {
  morePanel.innerHTML = '';
  if (!moreOpen) {
    morePanel.style.display = 'none';
    return;
  }
  morePanel.style.display = 'block';

  const row = document.createElement('div');
  row.className = 'panel-row';
  const moreMenuAliases = parseMenuAliases(getMoreMenuAliases(state.localVariables));

  const searchBtnOption = aliasedMenuButton(moreMenuAliases, 'Search', () => {
    moreOpen = false;
    renderMoreMenu();
    searchBtn.click();
  });
  if (searchBtnOption) row.appendChild(searchBtnOption);

  const captureBtnOption = aliasedMenuButton(moreMenuAliases, 'Capture', () => {
    moreOpen = false;
    renderMoreMenu();
    captureBtn.click();
  });
  if (captureBtnOption) row.appendChild(captureBtnOption);

  const historyBtnOption = aliasedMenuButton(
    moreMenuAliases,
    'History',
    () => {
      moreOpen = false;
      renderMoreMenu();
      historyOpen = true;
      renderHistoryPanel();
    },
    !state.doc
  );
  if (historyBtnOption) {
    historyBtnOption.setAttribute('aria-label', 'Undo history');
    row.appendChild(historyBtnOption);
  }

  const addBtnOption = aliasedMenuButton(moreMenuAliases, '+', () => {
    moreOpen = false;
    renderMoreMenu();
    addBtn.click();
  });
  if (addBtnOption) {
    addBtnOption.setAttribute('aria-label', 'Add heading');
    row.appendChild(addBtnOption);
  }

  const docsBtnOption = aliasedMenuButton(moreMenuAliases, '?', () => {
    moreOpen = false;
    renderMoreMenu();
    docsOpen = true;
    if (isWideLayout()) {
      render(); // syncSidePanel (called by render) populates and shows #sidePanel; #outline renders normally alongside it
    } else {
      renderDocsView(outlineEl); // narrow: replaces #outline directly, exactly as before this feature existed
    }
  });
  if (docsBtnOption) {
    docsBtnOption.setAttribute('aria-label', 'Help / Docs');
    row.appendChild(docsBtnOption);
  }

  morePanel.appendChild(row);
}

moreBtn.addEventListener('click', () => {
  moreOpen = !moreOpen;
  if (moreOpen && fileMenuOpen) {
    fileMenuOpen = false;
    fileMenuStep = null;
    exportFormat = null;
    exportPickingHeading = false;
    stopBrowsing();
    renderFileMenu();
  }
  if (moreOpen && settingsOpen) {
    settingsOpen = false;
    render();
  }
  if (moreOpen && viewMenuOpen) {
    viewMenuOpen = false;
    renderViewMenu();
  }
  if (moreOpen && captureOpen) {
    captureOpen = false;
    renderCapturePanel();
  }
  if (moreOpen && docsOpen) {
    closeDocsView();
    render();
  }
  if (moreOpen && historyOpen) {
    historyOpen = false;
    renderHistoryPanel();
  }
  renderMoreMenu();
});

if ('serviceWorker' in navigator) {
  const updateBanner = document.getElementById('updateBanner');
  const updateReloadBtn = document.getElementById('updateReloadBtn');
  let reloadedForUpdate = false;

  function showUpdateBanner(waitingWorker) {
    updateBanner.style.display = 'flex';
    updateReloadBtn.onclick = () => {
      waitingWorker.postMessage('SKIP_WAITING');
    };
    updateCheckStatus = 'found';
    if (settingsOpen) renderSettingsView();
  }

  navigator.serviceWorker
    .register('sw.js')
    .then((registration) => {
      swRegistration = registration;

      // A worker may already be sitting in 'waiting' if it finished
      // installing before this particular page load noticed (e.g. another
      // tab triggered the update check first).
      if (registration.waiting) {
        showUpdateBanner(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          // 'installed' with an existing controller means this is a real
          // update (not the very first install, which has no controller
          // yet and activates on its own with nothing to prompt about).
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(newWorker);
          }
        });
      });

      // One check right here, right after registration itself succeeds --
      // app startup -- and otherwise only the manual "Check for updates"
      // button in Settings' own Updates section. No periodic polling and
      // no visibility-triggered recheck: startup and an explicit,
      // deliberate tap are the only two triggers.
      registration.update().catch(() => {});
    })
    .catch(() => {});

  // Fires once the new worker actually takes over (after the user clicks
  // Reload and the new worker calls skipWaiting + clients.claim). Reload
  // exactly once — controllerchange can in principle fire more than once.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    window.location.reload();
  });
}

async function bootstrap() {
  githubConfig = await getGithubConfig(kv);
  webdavConfig = await getWebdavConfig(kv);
  const legacyAgendaFiles = await getAgendaFiles(kv);
  globalVariablesText = await getGlobalVariables(kv);
  globalVariables = parseGlobalVariables(globalVariablesText);
  if (!globalVariables['org-agenda-files'] && legacyAgendaFiles.length > 0) {
    globalVariables['org-agenda-files'] = legacyAgendaFiles.join(';');
    globalVariablesText = serializeGlobalVariables(globalVariables);
    await setGlobalVariables(kv, globalVariablesText);
  }
  agendaFilesConfig = parseAgendaFilesVar(globalVariables['org-agenda-files'] || '');
  customThemeColors = await getCustomThemeColors(kv);
  applyTheme(await getTheme(kv));
  applyFontFamily(await getFontFamily(kv));
  applyFontSize(await getFontSize(kv));
  applyTablesFontSize(await getTablesFontSize(kv));
  syncContentOffset();

  const last = await getLastActiveDocument(kv);
  if (last && last.documentId) {
    try {
      const cached = await kv.get('doc:' + last.documentId);
      if (cached && typeof cached.value === 'string') {
        const doc = parseOrg(cached.value);
        const pending = await hasPendingChange(kv, last.documentId);
        await afterDocumentLoaded(last.documentId, doc, last.storageKind, pending);
        updateFilenameDisplay();
        render();
        checkForExternalChange();
        return;
      }
    } catch {
      // Resume is a convenience, never a blocker -- fall through to the
      // normal "no file open" state below rather than getting stuck.
    }
  }

  render();
}

externalChangeReloadBtn.addEventListener('click', async () => {
  const documentId = state.documentId;
  if (isDirty) {
    const proceed = window.confirm(
      `Reloading "${documentId}" will discard your unsaved local changes here and replace them with the current version from disk. Continue?`
    );
    if (!proceed) return;
  }
  setStatus('Reloading\u2026');
  try {
    await reloadCurrentDocumentFromDisk();
    setStatus('Reloaded.');
  } catch (err) {
    setStatus('Reload failed: ' + err.message);
  }
});

externalChangeDismissBtn.addEventListener('click', () => {
  externalChangeDismissedHash = externalChangeShownForHash;
  hideExternalChangeBanner();
});

// The proactive half of external-change detection: re-check whenever the
// tab regains focus, since that's exactly when a change made elsewhere
// while this tab sat in the background would otherwise go unnoticed for
// however much longer the person keeps working here. Best-effort (see
// checkForExternalChange's own doc comment) -- never blocks anything.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkForExternalChange();
});

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
    if ((await getTheme(kv)) === 'system') applyTheme('system');
  });
}

bootstrap();
