import { openDocument, saveDocument, saveAndSync, markDocumentOpen } from './src/document-store.js';
import { hasPendingChange } from './src/outbox.js';
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
} from './src/archive-model.js';
import {
  resolveLinkTarget,
  resolveImagePath,
  guessImageMimeType,
  isExternalUrl,
  findHeadingByTitle,
} from './src/link-resolve.js';
import { parseInline } from './src/inline-markup.js';
import { flattenVisibleRows, toggleFold, cycleHeadingTodo, toggleHeadingTodo, cycleItemCheckbox } from './src/outline-view-model.js';
import { updateCheckboxCookiesUpward } from './src/checkbox-cookie.js';
import { searchDocument } from './src/search.js';
import { applyStartupVisibility, cycleFoldLevel } from './src/fold-state.js';
import { parseStartupConfig } from './src/startup-config.js';
import {
  parseLocalVariables,
  getAgendaStartOnWeekday,
  getCycleOpenArchivedTrees,
  getAgendaSkipCommentTrees,
  getAgendaSkipArchivedTrees,
  getContactsBirthdayProperty,
  getUseSubSuperscripts,
  getArchiveConfirm,
  getUseTagInheritance,
  getUsePropertyInheritance,
} from './src/local-variables.js';
import { resolveTodoSequence } from './src/todo-cycle.js';
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
import { scanPrompts, expandTemplate, resolveOlpTarget, insertCapture, resolveCaptureFileId } from './src/capture-template.js';
import { exportToMarkdown } from './src/export-markdown.js';
import { exportToHtml } from './src/export-html.js';
import { createHistory, pushSnapshot, canUndo, canRedo, undo, redo, jumpTo, currentEntry } from './src/undo-history.js';
import { diffHunks } from './src/text-diff.js';
import { parseMarkdown } from './src/markdown.js';
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
  insertTableRow,
  deleteTableRow,
  insertTableColumn,
  deleteTableColumn,
  insertTable,
  editParagraphText,
  insertParagraphAfter,
  deleteListItem,
  deleteTable,
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
  setAgendaFiles,
  DEFAULT_AGENDA_FILES,
} from './src-browser/settings.js';

// Disable auto-capitalization app-wide, on every text input/textarea
// this app ever creates -- Chrome and Safari on mobile default
// autocapitalize to "sentences," which fights against this app's own
// conventions (tags, properties, list markers, and most everyday
// capture text are almost always lowercase) with no per-field way to
// opt out short of setting the attribute directly. Wrapping
// createElement here, once, covers every input/textarea this app ever
// creates without needing the same attribute repeated at dozens of
// individual call sites. A manual capital is still one tap away on
// the keyboard's own shift key -- this only removes the automatic,
// unrequested kind, never the ability to type one deliberately.
const nativeCreateElement = document.createElement.bind(document);
document.createElement = function (tagName, options) {
  const el = nativeCreateElement(tagName, options);
  const tag = String(tagName).toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    el.setAttribute('autocapitalize', 'off');
  }
  return el;
};

const GLOBAL_TODO_DEFAULT = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };

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

  for (const entry of agendaFilesConfig) {
    const key = entry.scheme + ':' + entry.path;
    if (agendaFilesCache.has(key)) continue; // already loaded, errored, or currently loading

    agendaFilesCache.set(key, { loading: true }); // set BEFORE the async call, so a concurrent call to this function can't kick off a duplicate fetch for the same key

    const adapter = entry.scheme === 'github' ? githubAdapter : entry.scheme === 'webdav' ? webdavAdapter : null;
    if (!adapter) {
      agendaFilesCache.set(key, { error: `Unsupported scheme "${entry.scheme}" \u2014 only github/webdav are supported for agenda files.` });
      continue;
    }

    adapter
      .read(entry.path)
      .then((result) => {
        agendaFilesCache.set(
          key,
          result ? { doc: parseOrg(result.content), documentId: entry.path } : { error: `"${entry.path}" not found.` }
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
async function archiveHeadingToLocation(heading) {
  const location = getArchiveLocation(state.doc, heading);
  const { filePart, headlinePart } = parseArchiveLocation(location);
  const targetFileId = resolveArchiveFileId(filePart, state.documentId);

  if (getArchiveConfirm(state.localVariables)) {
    const destinationLabel =
      targetFileId === null || targetFileId === state.documentId
        ? headlinePart.trim()
          ? `this file, under "${headlinePart.trim().replace(/^\*+\s*/, '')}"`
          : 'this file (top level)'
        : headlinePart.trim()
          ? `"${targetFileId}", under "${headlinePart.trim().replace(/^\*+\s*/, '')}"`
          : `"${targetFileId}" (top level)`;
    if (!window.confirm(`Archive "${heading.title}" to ${destinationLabel}?`)) {
      return;
    }
  }

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

  const adapter = activeDiskAdapter();
  if ((state.storageKind === 'filesystem' || state.storageKind === 'input') && !(await adapter.exists(targetFileId))) {
    setStatus(
      `Can't archive to "${targetFileId}" automatically \u2014 local files need that file picked/created once first (browser security requires a file picker per file, not something this can do on its own mid-archive). Try File \u2192 Open or Save As on "${targetFileId}" first, or use GitHub/WebDAV for automatic cross-file archiving, or set #+ARCHIVE: to archive within this file instead (e.g. "::* Archived Tasks").`
    );
    return;
  }

  setStatus(`Archiving to ${targetFileId}\u2026`);
  const clone = buildArchivedClone(state.doc, heading, state.documentId);

  let archiveDoc;
  try {
    const existing = await adapter.read(targetFileId);
    archiveDoc = existing ? parseOrg(existing.content) : parseOrg('');
  } catch (err) {
    setStatus(`Could not archive: reading "${targetFileId}" failed \u2014 ${err.message}`);
    return;
  }

  insertAtArchiveLocation(archiveDoc, clone, headlinePart);

  try {
    await adapter.write(targetFileId, serializeOrg(archiveDoc));
  } catch (err) {
    setStatus(`Could not archive: writing "${targetFileId}" failed \u2014 ${err.message}. Nothing was removed from this file.`);
    return;
  }

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

  if (getArchiveConfirm(state.localVariables)) {
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

  const adapter = activeDiskAdapter();
  if ((state.storageKind === 'filesystem' || state.storageKind === 'input') && !(await adapter.exists(archiveFile))) {
    setStatus(
      `Can't restore to "${archiveFile}" automatically \u2014 local files need that file picked/created once first (browser security requires a file picker per file, not something this can do on its own mid-restore). Try File \u2192 Open or Save As on "${archiveFile}" first, or use GitHub/WebDAV for automatic cross-file restoring.`
    );
    return;
  }

  setStatus(`Restoring to ${archiveFile}\u2026`);
  const clone = buildRestoredClone(heading);

  let targetDoc;
  try {
    const existing = await adapter.read(archiveFile);
    if (!existing) {
      setStatus(`Could not restore: "${archiveFile}" no longer exists.`);
      return;
    }
    targetDoc = parseOrg(existing.content);
  } catch (err) {
    setStatus(`Could not restore: reading "${archiveFile}" failed \u2014 ${err.message}`);
    return;
  }

  if (olpSegments.length > 0) {
    const target = resolveOlpTarget(targetDoc, olpSegments);
    target.children.push(clone);
    target.collapsed = false;
  } else {
    targetDoc.children.push(clone);
  }

  try {
    await adapter.write(archiveFile, serializeOrg(targetDoc));
  } catch (err) {
    setStatus(`Could not restore: writing "${archiveFile}" failed \u2014 ${err.message}. Nothing was removed from this file.`);
    return;
  }

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
    toggleHeadingTodo(state.doc, keyboardFocusedHeading, GLOBAL_TODO_DEFAULT);
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
// The template currently showing its prompt-answer form, or null when
// the capture panel is just showing the template list. Replaces
// window.prompt() for %^{Prompt} placeholders -- window.prompt is a
// native OS-level dialog with known reliability/layout problems in a
// PWA running in standalone display mode on mobile (which is exactly
// what surfaced as "capture has no usable UI" and scroll/visibility
// glitches); an in-app form sidesteps that entirely, being just an
// ordinary part of this app's own layout.
let capturePromptTemplate = null;
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

// Undo/redo history for the CURRENTLY open document's editing session
// only -- reset every time a document is freshly opened (not persisted,
// not carried across a reopen, by explicit design choice: simpler and
// lower-risk than trying to make sense of undo history against a file
// that may have changed on disk since it was last open). See
// src/undo-history.js for the actual history model this wraps.
let history = createHistory('');
let historyOpen = false;
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
  persistInBackground();
}

/**
 * Restores state.doc from whichever history entry `history.index`
 * currently points at, after `history` has already been moved there
 * (by undo/redo/jumpTo) -- re-parses fresh and reapplies
 * startupConfig/localVariables, the same pattern
 * commitTextModeIfActive's own "reparse the whole doc" path already
 * uses. Counts as an unsaved change (isDirty = true) -- undoing or
 * redoing changes what's on screen just as much as any other edit
 * does, and needs saving to actually stick.
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
  const startupConfig = parseStartupConfig(newDoc);
  const localVariables = parseLocalVariables(entry.text);
  const archiveVisibility = getCycleOpenArchivedTrees(localVariables) ? 'noarchived' : 'archived';
  applyStartupVisibility(newDoc, startupConfig, archiveVisibility);
  state.doc = newDoc;
  state.startupConfig = startupConfig;
  state.localVariables = localVariables;
  isDirty = true;
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
  const startupConfig = parseStartupConfig(newDoc);
  const localVariables = parseLocalVariables(newText);
  const archiveVisibility = getCycleOpenArchivedTrees(localVariables) ? 'noarchived' : 'archived';
  applyStartupVisibility(newDoc, startupConfig, archiveVisibility);
  state.doc = newDoc;
  state.startupConfig = startupConfig;
  state.localVariables = localVariables;
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

function renderLinkNode(node) {
  const label = node.description || node.target;
  const resolution = resolveLinkTarget(state.doc, node.target);

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
      navigateToHeading(resolution.heading);
    };
    return a;
  }

  if (resolution.type === 'file') {
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
  // file). Shown distinctly rather than silently rendered as plain text,
  // since "this link is broken" is useful information.
  const span = document.createElement('span');
  span.textContent = label;
  span.style.color = 'var(--text-muted, #888)';
  span.style.textDecoration = 'underline wavy';
  span.title = 'Unresolved link: ' + node.target;
  span.setAttribute(INLINE_LINK_ATTR, '1');
  return span;
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
function renderInlineNodes(nodes, container) {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        container.appendChild(document.createTextNode(node.value));
        break;
      case 'bold': {
        const el = document.createElement('b');
        renderInlineNodes(node.children, el);
        container.appendChild(el);
        break;
      }
      case 'italic': {
        const el = document.createElement('i');
        renderInlineNodes(node.children, el);
        container.appendChild(el);
        break;
      }
      case 'underline': {
        const el = document.createElement('u');
        renderInlineNodes(node.children, el);
        container.appendChild(el);
        break;
      }
      case 'strikethrough': {
        const el = document.createElement('s');
        renderInlineNodes(node.children, el);
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
        container.appendChild(renderLinkNode(node));
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

function navigateToHeading(heading, { revealOwnBody = false, targetNode = heading } = {}) {
  currentContextHeading = heading;
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

// Slide-left gesture: cycles a heading through the three fold levels
// (collapsed -> one level -> fully expanded -> collapsed). Uses Pointer
// Events rather than separate touch/mouse handlers — one code path for
// touch, mouse, and pen, and Chromium (already required for File System
// Access) supports it fully. Never calls preventDefault, so normal
// vertical scrolling of the outline is completely unaffected; the
// direction/distance check is what tells a swipe apart from a scroll,
// not blocking the browser's own gesture handling.
const SWIPE_THRESHOLD_PX = 40;

function attachSlideLeftToFold(el, heading) {
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
    const archiveVisibility = getCycleOpenArchivedTrees(state.localVariables) ? 'noarchived' : 'archived';
    cycleFoldLevel(heading, { archiveVisibility });
    render();
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
        cycleHeadingTodo(state.doc, row.node, GLOBAL_TODO_DEFAULT);
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
                toggleHeadingTodo(state.doc, row.node, GLOBAL_TODO_DEFAULT);
                commitAndRender(hadTodo ? 'Removed TODO/DONE state' : 'Marked as TODO');
              },
            },
            {
              icon: '\u25a6',
              label: 'Add table',
              onClick: () => {
                actionMenuFor = null;
                insertTable(row.node, {});
                commitAndRender('Added table');
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
                  await archiveHeadingToLocation(row.node);
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

    return withActionMenu(el, menuEl, textEditorEl, generalEditorEl, propertiesDisplayEl);
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
      if (rowIndex === 0) tdEl.style.fontWeight = '600';

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
        tdEl.textContent = cellText || '\u00a0';
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
  const hasContent = row.node.lines.some((l) => l.trim() !== '');
  if (hasContent) {
    row.node.lines.forEach((line, i) => {
      if (i > 0) p.appendChild(document.createElement('br'));
      renderInlineNodes(parseInline(line, currentInlineOpts()), p);
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

  const pre = document.createElement('pre');
  pre.style.margin = '2px 0';
  pre.style.padding = '8px';
  pre.style.background = 'var(--surface)';
  pre.style.borderRadius = '6px';
  pre.style.overflowX = 'auto';
  pre.style.fontSize = '13px';
  const code = document.createElement('code');
  code.style.fontFamily = 'monospace';
  code.textContent = row.node.lines.join('\n');
  pre.appendChild(code);
  wrap.appendChild(pre);

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
async function afterDocumentLoaded(documentId, doc, storageKind) {
  const startupConfig = parseStartupConfig(doc);
  const localVariables = parseLocalVariables(serializeOrg(doc));
  const archiveVisibility = getCycleOpenArchivedTrees(localVariables) ? 'noarchived' : 'archived';
  applyStartupVisibility(doc, startupConfig, archiveVisibility);
  state = { documentId, doc, startupConfig, storageKind, localVariables };
  history = createHistory(serializeOrg(doc));
  historyOpen = false;
  isDirty = false; // freshly loaded — matches whatever was just read, nothing unsaved yet
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
  if (!(await hasPendingChange(kv, documentId))) return { preferCache: false };
  const resumeLocal = window.confirm(
    `"${documentId}" has local changes that were never saved (from an earlier session).\n\n` +
      'OK = resume those unsaved changes\n' +
      'Cancel = discard them and load the current version'
  );
  return { preferCache: resumeLocal };
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
    await afterDocumentLoaded(documentId, doc, 'filesystem');
    if (preferCache) {
      isDirty = true; // resumed content differs from the last synced version
      render();
    }
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
    await afterDocumentLoaded(fileId, doc, 'input');
    if (preferCache) {
      isDirty = true;
      render();
    }
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
    await afterDocumentLoaded(path, doc, kind);
    if (preferCache) {
      isDirty = true;
      render();
    }
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
      const reopened = await openDocument({
        documentId: state.documentId,
        kvAdapter: kv,
        diskAdapter: activeDiskAdapter(),
      });
      state.doc = reopened.doc;
      state.startupConfig = parseStartupConfig(state.doc);
      state.localVariables = parseLocalVariables(serializeOrg(state.doc));
      const archiveVisibility = getCycleOpenArchivedTrees(state.localVariables) ? 'noarchived' : 'archived';
      applyStartupVisibility(state.doc, state.startupConfig, archiveVisibility);
      render();
    }
    isDirty = false;
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
    row.appendChild(
      menuButton('New', () => {
        fileMenuStep = 'new';
        renderFileMenu();
      })
    );
    row.appendChild(
      menuButton('Open', () => {
        fileMenuStep = 'open';
        renderFileMenu();
      })
    );
    row.appendChild(menuButton('Save', () => saveCurrent(), !state.documentId));
    row.appendChild(
      menuButton(
        'Save As',
        () => {
          fileMenuStep = 'saveas';
          renderFileMenu();
        },
        !state.doc
      )
    );
    row.appendChild(
      menuButton(
        'Export',
        () => {
          fileMenuStep = 'export';
          exportFormat = null;
          renderFileMenu();
        },
        !state.doc
      )
    );
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
  const rawName = scope ? scope.title : (state.documentId || 'export').replace(/\.[a-zA-Z0-9]+$/, '');
  const baseName = rawName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'export';
  if (format === 'markdown') {
    downloadFile(baseName + '.md', exportToMarkdown(state.doc, scope), 'text/markdown');
  } else {
    downloadFile(baseName + '.html', exportToHtml(state.doc, scope), 'text/html');
  }
  fileMenuOpen = false;
  fileMenuStep = null;
  exportFormat = null;
  exportPickingHeading = false;
  setStatus(`Exported to ${format === 'markdown' ? 'Markdown' : 'HTML'}.`);
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
    row.appendChild(
      menuButton('Markdown', () => {
        exportFormat = 'markdown';
        renderFileMenu();
      })
    );
    row.appendChild(
      menuButton('HTML', () => {
        exportFormat = 'html';
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
  label.textContent = `Export ${exportFormat === 'markdown' ? 'Markdown' : 'HTML'} for:`;
  fileMenuPanel.appendChild(label);

  const row = document.createElement('div');
  row.className = 'panel-row';
  row.appendChild(menuButton('Whole file', () => performExport(exportFormat, null)));
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
    docsOpen = false;
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
  docsOpen = false;
  if (moreOpen) {
    moreOpen = false;
    renderMoreMenu();
  }
  const heading = insertTopLevelHeading(state.doc, {});
  startEditingTitle(heading, true);
});

/** Switches between the three top-level views, handling the
 *  enter/exit bookkeeping each transition needs: leaving 'text' commits
 *  its content into state.doc first (the fix from a previous bug — never
 *  read a stale doc); leaving 'org' clears outline edit state, since
 *  nothing should be mid-edit while the outline isn't even shown. */
function switchToView(view) {
  if (docsOpen) {
    docsOpen = false;
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
  for (const [key, label] of [
    ['org', 'Org'],
    ['text', 'Text'],
    ['agenda', 'Agenda'],
    ['tasklist', 'TODO'],
  ]) {
    const btn = menuButton(label, () => switchToView(key));
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
  const rangeLabel = document.createElement('div');
  rangeLabel.style.fontSize = '12px';
  rangeLabel.style.opacity = '0.65';
  rangeLabel.style.marginBottom = '8px';
  rangeLabel.textContent = formatAgendaRangeLabel(agendaViewType, start, end);
  container.appendChild(rangeLabel);

  if (agendaFilesConfig.length > 0) {
    const entries = agendaFilesConfig.map((f) => agendaFilesCache.get(f.scheme + ':' + f.path));
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
        parts.push(errored.map(({ f, entry }) => `"${f.path}": ${entry.error}`).join('; '));
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
              : '\u23f0';
      kindIcon.style.flexShrink = '0';
      kindIcon.style.opacity = '0.6';
      row.appendChild(kindIcon);

      const text = document.createElement('div');
      text.style.flex = '1 1 auto';
      text.style.minWidth = '0';
      if (item.todo) {
        const badge = document.createElement('span');
        badge.textContent = item.todo + ' ';
        badge.style.fontWeight = '700';
        badge.style.fontSize = '12px';
        text.appendChild(badge);
      }
      text.appendChild(document.createTextNode(item.title));
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

function renderTaskListView() {
  ensureAgendaFilesLoaded();
  outlineEl.innerHTML = '';
  const container = document.createElement('div');
  container.style.padding = '8px 12px';

  const heading = document.createElement('div');
  heading.style.fontSize = '12px';
  heading.style.opacity = '0.65';
  heading.style.marginBottom = '10px';
  heading.textContent = 'Every active TODO in this file, regardless of date — matching real org\u2019s own global TODO list.';
  container.appendChild(heading);

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
    docsOpen = false;
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
  captureHint.style.fontSize = '11px';
  captureHint.style.opacity = '0.6';
  captureHint.style.margin = '2px 0 8px';
  captureHint.textContent =
    'Edited as JSON — an array of {key, description, type, olp, template, file}. ' +
    'type is one of "item", "checkitem", "plain", "table-line". ' +
    'olp is the outline path to insert into, e.g. ["Inbox", "Tasks"]. ' +
    'file is optional — a filename (e.g. "journal.org", captured as a sibling of whatever file is currently open) or a full path, for a template that captures into a DIFFERENT file without switching what you\u2019re looking at. Omit it to capture into the currently open file, as before. ' +
    'template supports %<FORMAT>, %t/%T/%u/%U, %^{Prompt|default|choices}, %N, and %? — see the README.';
  captureSection.appendChild(captureHint);

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

  const agendaFilesSection = document.createElement('div');
  agendaFilesSection.className = 'settings-section';
  container.appendChild(agendaFilesSection);

  const agendaFilesTitle = document.createElement('div');
  agendaFilesTitle.className = 'panel-section-title';
  agendaFilesTitle.textContent = 'Agenda Files';
  agendaFilesSection.appendChild(agendaFilesTitle);

  const agendaFilesHint = document.createElement('div');
  agendaFilesHint.style.fontSize = '11px';
  agendaFilesHint.style.opacity = '0.6';
  agendaFilesHint.style.margin = '2px 0 6px';
  agendaFilesHint.textContent =
    'Real org\u2019s org-agenda-files idea \u2014 additional files the Agenda and TODO views scan across, beyond whichever file is currently open. ' +
    'Edited as JSON \u2014 an array of {scheme, path}, where scheme is "github" or "webdav" (the only backends that can read a file without a picker prompt) and path is that file\u2019s location on the currently configured GitHub repo or WebDAV server. Example: [{"scheme": "github", "path": "journal/2026.org"}]';
  agendaFilesSection.appendChild(agendaFilesHint);

  const currentAgendaFiles = await getAgendaFiles(kv);
  const agendaFilesTextarea = document.createElement('textarea');
  agendaFilesTextarea.value = JSON.stringify(currentAgendaFiles, null, 2);
  agendaFilesTextarea.rows = 6;
  agendaFilesTextarea.style.fontFamily = 'monospace';
  agendaFilesTextarea.style.fontSize = '13px';
  agendaFilesTextarea.style.width = '100%';
  agendaFilesTextarea.style.maxWidth = '100%';
  agendaFilesTextarea.style.boxSizing = 'border-box';
  agendaFilesTextarea.style.resize = 'vertical';
  agendaFilesSection.appendChild(agendaFilesTextarea);

  const agendaFilesBtnRow = document.createElement('div');
  agendaFilesBtnRow.className = 'panel-row';
  agendaFilesBtnRow.style.marginTop = '8px';
  agendaFilesBtnRow.appendChild(
    menuButton('Save agenda files', async () => {
      let parsed;
      try {
        parsed = JSON.parse(agendaFilesTextarea.value);
      } catch (err) {
        setStatus('Agenda files: invalid JSON \u2014 ' + err.message);
        return;
      }
      const problem = validateAgendaFiles(parsed);
      if (problem) {
        setStatus('Agenda files: ' + problem);
        return;
      }
      await setAgendaFiles(kv, parsed);
      agendaFilesConfig = parsed;
      setStatus('Agenda files saved.');
    })
  );
  agendaFilesBtnRow.appendChild(
    menuButton('Clear', async () => {
      await setAgendaFiles(kv, DEFAULT_AGENDA_FILES);
      agendaFilesConfig = DEFAULT_AGENDA_FILES;
      setStatus('Agenda files cleared \u2014 Agenda/TODO scan only the currently open file again.');
      renderSettingsView();
    })
  );
  agendaFilesSection.appendChild(agendaFilesBtnRow);

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
}

// ---- Docs (README, rendered in-app) --------------------------------------

let cachedDocsMarkdown = null; // fetched once per session, not re-fetched on every "Docs" tap

/** Appends parseInline's token list as actual inline DOM (bold/italic/
 *  code/link/text) into `container`. Internal #anchor links scroll to the
 *  matching heading within the docs view rather than navigating (there's
 *  no routing in this single-page app); external links open in a real
 *  new tab via a normal <a>, letting the browser handle it natively
 *  rather than a JS-driven window.open. */
function renderInlineTokens(tokens, container) {
  for (const tok of tokens) {
    if (tok.type === 'text') {
      container.appendChild(document.createTextNode(tok.value));
    } else if (tok.type === 'bold') {
      const b = document.createElement('strong');
      b.textContent = tok.value;
      container.appendChild(b);
    } else if (tok.type === 'italic') {
      const em = document.createElement('em');
      em.textContent = tok.value;
      container.appendChild(em);
    } else if (tok.type === 'code') {
      const code = document.createElement('code');
      code.textContent = tok.value;
      code.style.fontFamily = 'monospace';
      code.style.fontSize = '0.9em';
      code.style.background = 'var(--surface)';
      code.style.padding = '1px 4px';
      code.style.borderRadius = '4px';
      container.appendChild(code);
    } else if (tok.type === 'link') {
      const a = document.createElement('a');
      a.textContent = tok.value;
      a.href = tok.href;
      a.style.color = 'var(--accent)';
      if (tok.href.startsWith('#')) {
        a.onclick = (e) => {
          e.preventDefault();
          const target = document.getElementById('docs-heading-' + tok.href.slice(1));
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
      } else {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      container.appendChild(a);
    }
  }
}

/** Converts one parsed markdown block into a DOM element. Headings get a
 *  predictable id (docs-heading-<slug>) so renderInlineTokens' internal
 *  link handler above can find and scroll to them. */
function renderMarkdownBlock(block) {
  if (block.type === 'heading') {
    const h = document.createElement(`h${Math.min(block.level, 6)}`);
    h.id = 'docs-heading-' + block.id;
    h.style.marginTop = block.level <= 2 ? '20px' : '14px';
    h.style.marginBottom = '8px';
    h.style.fontSize = ['22px', '19px', '16px', '15px', '14px', '13px'][block.level - 1];
    renderInlineTokens(block.inline, h);
    return h;
  }

  if (block.type === 'paragraph') {
    const p = document.createElement('p');
    p.style.margin = '8px 0';
    p.style.lineHeight = '1.5';
    p.style.overflowWrap = 'anywhere';
    renderInlineTokens(block.inline, p);
    return p;
  }

  if (block.type === 'list') {
    const list = document.createElement(block.ordered ? 'ol' : 'ul');
    list.style.margin = '8px 0';
    list.style.paddingLeft = '24px';
    for (const item of block.items) {
      const li = document.createElement('li');
      li.style.margin = '4px 0';
      li.style.lineHeight = '1.5';
      li.style.overflowWrap = 'anywhere';
      renderInlineTokens(item.inline, li);
      list.appendChild(li);
    }
    return list;
  }

  if (block.type === 'code-block') {
    const pre = document.createElement('pre');
    pre.style.background = 'var(--surface)';
    pre.style.padding = '10px';
    pre.style.borderRadius = '6px';
    pre.style.overflowX = 'auto';
    pre.style.fontSize = '13px';
    pre.style.margin = '8px 0';
    const code = document.createElement('code');
    code.style.fontFamily = 'monospace';
    code.textContent = block.text;
    pre.appendChild(code);
    return pre;
  }

  if (block.type === 'hr') {
    const hr = document.createElement('hr');
    hr.style.border = 'none';
    hr.style.borderTop = '1px solid var(--border)';
    hr.style.margin = '16px 0';
    return hr;
  }

  if (block.type === 'table') {
    const wrap = document.createElement('div');
    wrap.style.overflowX = 'auto'; // a several-column table can easily be wider than a phone screen -- scroll within the table rather than letting it force the whole page wider
    wrap.style.margin = '10px 0';

    const table = document.createElement('table');
    table.style.borderCollapse = 'collapse';
    table.style.width = '100%';
    table.style.fontSize = '13px';

    function styleCell(cell, align, isHeader) {
      cell.style.border = '1px solid var(--border)';
      cell.style.padding = '6px 10px';
      cell.style.textAlign = align;
      cell.style.verticalAlign = 'top';
      cell.style.overflowWrap = 'anywhere';
      if (isHeader) {
        cell.style.background = 'var(--surface)';
        cell.style.fontWeight = '600';
        cell.style.whiteSpace = 'nowrap'; // header labels are short and meant to stay put as a fixed reference row while long body cells wrap
      }
    }

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    block.header.forEach((cell, idx) => {
      const th = document.createElement('th');
      styleCell(th, block.align[idx] || 'left', true);
      renderInlineTokens(cell.inline, th);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of block.rows) {
      const tr = document.createElement('tr');
      row.forEach((cell, idx) => {
        const td = document.createElement('td');
        styleCell(td, block.align[idx] || 'left', false);
        renderInlineTokens(cell.inline, td);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    wrap.appendChild(table);
    return wrap;
  }

  return document.createElement('div'); // unreachable given parseMarkdown's own block types, but never leave a tap-triggered render with nothing to show
}

async function renderDocsView(target = docsRenderTarget) {
  docsRenderTarget = target;
  target.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'panel';
  container.style.minHeight = '100%';
  target.appendChild(container);

  if (cachedDocsMarkdown === null) {
    try {
      const response = await fetch('./README.md');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      cachedDocsMarkdown = await response.text();
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

  const blocks = parseMarkdown(cachedDocsMarkdown);
  for (const block of blocks) {
    container.appendChild(renderMarkdownBlock(block));
  }
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
    docsOpen = false;
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
    docsOpen = false;
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
  }
  const keys = parsed.map((t) => t.key);
  const duplicate = keys.find((k, i) => keys.indexOf(k) !== i);
  if (duplicate !== undefined) return `duplicate key "${duplicate}" \u2014 each template needs a unique key`;
  return null;
}

function validateAgendaFiles(parsed) {
  if (!Array.isArray(parsed)) return 'must be a JSON array';
  for (let i = 0; i < parsed.length; i++) {
    const f = parsed[i];
    const label = `entry #${i + 1}`;
    if (!f || typeof f !== 'object') return `${label} must be an object`;
    if (f.scheme !== 'github' && f.scheme !== 'webdav') return `${label}: "scheme" must be "github" or "webdav"`;
    if (typeof f.path !== 'string' || f.path.length === 0) return `${label}: "path" must be a non-empty string`;
  }
  return null;
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

  const heading = document.createElement('div');
  heading.style.fontSize = '12px';
  heading.style.opacity = '0.65';
  heading.style.marginBottom = '8px';
  heading.textContent = template.key + ' \u2014 ' + template.description;
  capturePanel.appendChild(heading);

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
      capturePromptTemplate = null;
      runCaptureWithAnswers(template, answers);
    })
  );
  row.appendChild(
    menuButton('Cancel', () => {
      capturePromptTemplate = null;
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
 * computes %N if this is a table-line capture, expands the template
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
async function runCaptureWithAnswers(template, answers) {
  if (currentView === 'text') {
    // Same reasoning as search's own text-mode guard above: leaving text
    // mode reparses the document into new objects, so do it now, before
    // resolveOlpTarget below touches state.doc, not after.
    switchToView('org');
  }

  const now = new Date();

  const targetFileId = resolveCaptureFileId(template.file, state.documentId);

  if (targetFileId !== state.documentId) {
    // Cross-file capture: read/insert/write the OTHER file directly via
    // whichever backend the current document itself came from, without
    // touching state.doc or switching the active view at all -- matching
    // real org-capture's own behavior of not switching your current
    // buffer just because a template's target is elsewhere.
    const adapter = activeDiskAdapter();
    if ((state.storageKind === 'filesystem' || state.storageKind === 'input') && !(await adapter.exists(targetFileId))) {
      setStatus(
        `Can't capture to "${targetFileId}" automatically \u2014 local files need that file picked/created once first (browser security requires a file picker per file). Try File \u2192 Open or Save As on "${targetFileId}" first, or use GitHub/WebDAV, or remove "file" from this template to capture into the currently open file instead.`
      );
      renderCapturePanel();
      return;
    }

    setStatus(`Capturing to ${targetFileId}\u2026`);
    let targetDoc;
    try {
      const existing = await adapter.read(targetFileId);
      targetDoc = existing ? parseOrg(existing.content) : parseOrg('');
    } catch (err) {
      setStatus(`Could not capture: reading "${targetFileId}" failed \u2014 ${err.message}`);
      renderCapturePanel();
      return;
    }

    const target = resolveOlpTarget(targetDoc, template.olp, { now });
    let tableRowNumber = null;
    if (template.type === 'table-line') {
      const existingTable = [...target.body].reverse().find((n) => n.type === 'table');
      const dataRowCount = existingTable ? existingTable.rows.filter((r) => r.type === 'row').length : 0;
      tableRowNumber = dataRowCount + 1;
    }
    const { text } = expandTemplate(template.template, { now, promptAnswers: answers, tableRowNumber });
    insertCapture(target, template.type, text);

    try {
      await adapter.write(targetFileId, serializeOrg(targetDoc));
    } catch (err) {
      setStatus(`Could not capture: writing "${targetFileId}" failed \u2014 ${err.message}. Nothing was changed.`);
      renderCapturePanel();
      return;
    }

    setStatus(`Captured to ${targetFileId}.`);
    afterSuccessfulCapture(template);
    return;
  }

  const target = resolveOlpTarget(state.doc, template.olp, { now });

  let tableRowNumber = null;
  if (template.type === 'table-line') {
    const existingTable = [...target.body].reverse().find((n) => n.type === 'table');
    const dataRowCount = existingTable ? existingTable.rows.filter((r) => r.type === 'row').length : 0;
    tableRowNumber = dataRowCount + 1;
  }

  const { text } = expandTemplate(template.template, {
    now,
    promptAnswers: answers,
    tableRowNumber,
  });

  insertCapture(target, template.type, text);
  commitAndRender(`Captured: ${template.description}`);

  switchToView('org');
  navigateToHeading(target, { revealOwnBody: true });
  setStatus('Captured.');
  afterSuccessfulCapture(template);
}

/** After a successful capture: a template with at least one prompt
 *  loops back to a FRESH copy of its own form (the "multiple entries"
 *  feature); a template with no prompts returns to the template list,
 *  since there's nothing left to fill in for a repeat. */
function afterSuccessfulCapture(template) {
  const prompts = scanPrompts(template.template);
  if (prompts.length > 0) {
    capturePromptTemplate = template;
    capturePromptValues = prompts.map((p) => p.default || '');
  } else {
    capturePromptTemplate = null;
  }
  renderCapturePanel();
}

captureBtn.addEventListener('click', () => {
  captureOpen = !captureOpen;
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
    docsOpen = false;
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

  const searchBtnOption = menuButton('Search', () => {
    moreOpen = false;
    renderMoreMenu();
    searchBtn.click();
  });
  searchBtnOption.style.flex = '1';
  row.appendChild(searchBtnOption);

  const captureBtnOption = menuButton('Capture', () => {
    moreOpen = false;
    renderMoreMenu();
    captureBtn.click();
  });
  captureBtnOption.style.flex = '1';
  row.appendChild(captureBtnOption);

  const addBtnOption = menuButton('+', () => {
    moreOpen = false;
    renderMoreMenu();
    addBtn.click();
  });
  addBtnOption.style.flex = '1';
  addBtnOption.setAttribute('aria-label', 'Add heading');
  row.appendChild(addBtnOption);

  const docsBtnOption = menuButton('?', () => {
    moreOpen = false;
    renderMoreMenu();
    docsOpen = true;
    if (isWideLayout()) {
      render(); // syncSidePanel (called by render) populates and shows #sidePanel; #outline renders normally alongside it
    } else {
      renderDocsView(outlineEl); // narrow: replaces #outline directly, exactly as before this feature existed
    }
  });
  docsBtnOption.style.flex = '1';
  docsBtnOption.setAttribute('aria-label', 'Help / Docs');
  row.appendChild(docsBtnOption);

  const historyBtnOption = menuButton('History', () => {
    moreOpen = false;
    renderMoreMenu();
    historyOpen = true;
    renderHistoryPanel();
  });
  historyBtnOption.style.flex = '1';
  historyBtnOption.disabled = !state.doc;
  historyBtnOption.setAttribute('aria-label', 'Undo history');
  row.appendChild(historyBtnOption);

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
    docsOpen = false;
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
  }

  navigator.serviceWorker
    .register('sw.js')
    .then((registration) => {
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

      // The browser only checks for a new service worker on navigation by
      // default, which barely happens in an app meant to stay open — that
      // was a real part of why updates were hard to see while testing.
      // Checking again whenever the tab regains focus closes that gap.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) registration.update().catch(() => {});
      });
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
  agendaFilesConfig = await getAgendaFiles(kv);
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
        await afterDocumentLoaded(last.documentId, doc, last.storageKind);
        isDirty = pending; // afterDocumentLoaded always sets this false; restore it if there was actually an unsynced edit waiting
        updateFilenameDisplay();
        render();
        return;
      }
    } catch {
      // Resume is a convenience, never a blocker -- fall through to the
      // normal "no file open" state below rather than getting stuck.
    }
  }

  render();
}

bootstrap();
