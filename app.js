import { openDocument, saveDocument, saveAndSync, markDocumentOpen } from './src/document-store.js';
import { setSyncMeta, getSyncMeta } from './src/sync-engine.js';
import { hasPendingChange, getPendingChange, clearPendingChange } from './src/outbox.js';
import { savePersistedHistory, loadPersistedHistory, clearPersistedHistory } from './src/history-store.js';
import { parseOrg, serializeOrg, serializeHeadingSubtree, findHeadingLineNumber, findHeadingAtLine } from './src/org-parser.js';
import { parseBody } from './src/body-parser.js';
import { detectWebmHasVideoTrack } from './src/webm-track-detect.js';
import { findScrollingAncestor } from './src/scroll-util.js';
import {
  generateAttachmentId,
  attachmentPath,
  formatAttachmentLink,
  sanitizeAttachmentFilename,
  listAttachments,
  removeAttachmentLink,
  disambiguateAttachmentFilename,
  isAudioFilename,
  generateRecordingFilename,
} from './src/attach.js';
import {
  findAncestorPath,
  findContainer,
  getPropertiesText,
  buildArchivedClone,
  getArchiveLocation,
  parseArchiveLocation,
  resolveArchiveFileId,
  insertAtArchiveLocation,
  buildRestoredClone,
  isArchivedInPlace,
  shiftLevels,
  setProperty,
  getProperty,
  deleteProperty,
} from './src/archive-model.js';
import {
  resolveLinkTarget,
  resolveImagePath,
  resolveAttachmentTarget,
  guessImageMimeType,
  guessAudioMimeType,
  guessViewableMimeType,
  isExternalUrl,
  findHeadingByTitle,
  findFootnoteDefinition,
} from './src/link-resolve.js';
import { parseInline, stripLineBreakMarker, IMAGE_EXT_RE, extractLatexFragments } from './src/inline-markup.js';
import { flattenVisibleRows, toggleFold, cycleHeadingTodo, toggleHeadingTodo, cycleItemCheckbox } from './src/outline-view-model.js';
import { updateCheckboxCookiesUpward } from './src/checkbox-cookie.js';
import { searchDocument, searchDocuments, searchDocumentsByMatchQuery } from './src/search.js';
import { createQueryReplace, createTextQueryReplace, countBlockOnlyMatches } from './src/query-replace.js';
import { emacsRegexToJs, EmacsRegexError } from './src/emacs-regex.js';
import { applyStartupVisibility, cycleFoldLevel } from './src/fold-state.js';
import { parseStartupConfig, resolveEffectiveStartupConfig, VISIBILITY_KEYWORDS } from './src/startup-config.js';
import {
  parseLocalVariables,
  parseLispBoolean,
  parseLispNumber,
  getAgendaStartOnWeekday,
  getAgendaShowAllDates,
  getDeadlineWarningDays,
  getScheduledDelayDays,
  getCalendarLatitude,
  getCalendarLongitude,
  getSolarAmpm,
  getSolarHideLabel,
  getOrgWeatherFormat,
  getOrgWeatherSpeedUnit,
  getOrgWeatherTemperatureUnit,
  getWeatherRefreshInterval,
  getOrgTableDurationHourZeroPadding,
  getCycleOpenArchivedTrees,
  getAgendaSkipCommentTrees,
  getAgendaSkipArchivedTrees,
  getContactsBirthdayProperty,
  getUseSubSuperscripts,
  getUseTagInheritance,
  getUsePropertyInheritance,
  getBufferReadOnly,
  getClosedKeepWhenNoTodo,
  getRefileTargets,
  getGlobalProperties,
  getAsciiTextWidth,
  getExtraMenu,
  getMenuAliases,
  getDisplayTimeMode,
  getDisplayTimeFormat,
  getAgendaFilesVar,
  getContactsFilesVar,
  parseAgendaFilesVar,
} from './src/local-variables.js';
import { parseRefileTargetsWithErrors, getRefileCandidates, resolveEntryFileIds, findHeadingByOutlinePath, collectSubtreeHeadings, pushRecentRefileTarget, recentRefileCandidates } from './src/refile.js';
import { saveNarrowState, loadNarrowState } from './src/narrow-state.js';
import { clockIn, clockInSwitchingTasks, clockOut, clockCancel, totalClockedMinutes, currentClockSessionMinutes, formatClockDuration, findHeadingWithRunningClock, findMostRecentlyClockedHeading } from './src/clock.js';
import { parseOrgDuration } from './src/org-duration.js';
import { computeClocktable, renderClocktable } from './src/clocktable.js';
import { parseExtraMenu, tokenize as tokenizeExtraMenuValue } from './src/extra-menu.js';
import { parseMenuAliases, resolveMenuOrder, tokenizeMenuAliasValue } from './src/menu-alias.js';
import { multiEntryValueToDisplayText, multiEntryDisplayTextToValue } from './src/multi-entry-format.js';
import { normalizeSmartQuotes } from './src/text-normalize.js';
import { buildMonthGrid, stepMonth, stepYear, MONTH_NAMES, buildDayMarkers } from './src/calendar-grid.js';
import { splitHexAlpha, combineHexAlpha } from './src/hex-alpha.js';
import { resolveTodoSequence, resolveTodoSequences, setTodoState, isDoneKeyword } from './src/todo-cycle.js';
import { renderMathHtml } from './src/math-render.js';
import { applyRepeaterShiftOnDone } from './src/repeater-shift.js';
import { decideProgressLogging, decideLogbookEntry, getEffectiveLogDoneSetting, parseLogDoneLispValue } from './src/progress-logging.js';
import { parseGlobalVariables, serializeGlobalVariables, mergeGlobalAndLocalVariables } from './src/global-variables.js';
import { formatStateLogLine, parseLogbookEntries } from './src/logbook.js';
import {
  UNSAVED_DOCUMENT_ID,
  buildAgendaItems,
  buildTaskList,
  dayView,
  weekView,
  monthView,
  startOfDay,
  endOfDay,
  startOfWeek,
  parseRepeater,
  itemsInRange,
  itemEffortText,
  summarizeDayEffort,
  applyAgendaEffortView,
} from './src/agenda.js';
import { scanPrompts, expandTemplate, expandCaptureText, resolveOlpTarget, insertCapture, resolveCaptureFileId, getCaptureFileScheme, CAPTURE_FILE_SCHEMES, computeNonCollidingKeys, formatTime } from './src/capture-template.js';
import { exportToMarkdown } from './src/export-markdown.js';
import { exportToOdt } from './src/export-odt.js';
import { exportToAscii } from './src/export-ascii.js';
import { expandIncludes } from './src/export-include.js';
import { exportAsOrg } from './src/export-org.js';
import { exportToHtml } from './src/export-html.js';
import { exportToIcalendar } from './src/export-icalendar.js';
import { exportToVcard } from './src/export-vcard.js';
import { importVcardsAsOrgText } from './src/import-vcard.js';
import { createHistory, pushSnapshot, canUndo, canRedo, undo, redo, jumpTo, currentEntry } from './src/undo-history.js';
import { diffHunks } from './src/text-diff.js';
import { planConflict, resolveSegments } from './src/merge3.js';
import { getAllowedEffortValues, DEFAULT_EFFORT_FILTER_VALUES } from './src/effort-values.js';
import { searchCommands, pushRecent } from './src/command-palette.js';
import { parseOrgTimestamp, formatOrgTimestamp, parseDelay, dateKey } from './src/org-timestamp.js';
import {
  renameHeading,
  setHeadingTags,
  setPriority,
  getPlainTimestampInTitle,
  setPlainTimestampInTitle,
  insertChildHeading,
  insertHeadingAfter,
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
  allTablesInBody,
  commitLines,
  serializeTable,
  deleteParagraph,
  editListItemText,
  insertListItem,
  getHeadingText,
  setHeadingText,
} from './src/body-edit.js';
import { recalculateTable, parseTableConstants } from './src/table-formula.js';
import { parsePlotOptions, renderPlotSvg } from './src/org-plot.js';
import { isOrgWeatherLine, formatWeatherLine, buildWeatherApiUrl, DEFAULT_ORG_WEATHER_FORMAT } from './src/org-weather.js';
import { initialState as godModeInitialState } from './src/god-mode.js';
import { documentUsesOrgWeather } from './src/sexp-eval.js';
import { createIndexedDbAdapter } from './src-browser/indexeddb-adapter.js';
import {
  createFileSystemAccessAdapter,
  pickAndRegisterFile,
  pickAndRegisterNewFile,
  isFileSystemAccessSupported,
} from './src-browser/filesystem-adapter.js';
import { createGithubAdapter, isGithubConfigured } from './src-browser/github-adapter.js';
import { createWebdavAdapter, isWebdavConfigured, base64ToArrayBuffer } from './src-browser/webdav-adapter.js';
import {
  createInputFileAdapter,
  pickAndImportFile,
  isFileSystemAccessUnsupported,
  downloadFile,
} from './src-browser/input-file-adapter.js';
import {
  getGithubConfig,
  setGithubConfig,
  getCaldavConfig,
  getWebdavConfig,
  setWebdavConfig,
  getTheme,
  setTheme,
  getCustomThemeColors,
  setCustomThemeColors,
  getFontFamily,
  setFontFamily,
  getMenuSize,
  setMenuSize,
  getParagraphSpacing,
  getFloatingKeyboardPos,
  getTablesSpacing,
  getFontSize,
  setFontSize,
  getReadingWidth,
  setReadingWidth,
  getSidePanelWidth,
  setSidePanelWidth,
  getTablesFontSize,
  setTablesFontSize,
  exportAllSettings,
  importAllSettings,
  getLastActiveDocument,
  setLastActiveDocument,
  getOpenTabs,
  setOpenTabs,
  getRecentFiles,
  recordRecentFile,
  clearRecentFiles,
  getCaptureTemplates,
  setCaptureTemplates,
  DEFAULT_CAPTURE_TEMPLATES,
  getGlobalVariables,
  setGlobalVariables,
  DEFAULT_GLOBAL_VARIABLES,
} from './src-browser/settings.js';
import { agendaItemKindLabel, agendaStepAnchor, buildDayHeaderRow, formatAgendaItemTimeText, formatAgendaRangeLabel } from './src-browser/agenda-format.js';
import { THEME_CSS_VARS, THEME_DEFAULTS, THEME_VAR_LABELS, applyFontFamily, applyFontSize, applyMenuSize, applyParagraphSpacing, applyTablesSpacing, applyReadingWidth, applyTablesFontSize, resolvedThemeName } from './src-browser/appearance.js';
import { CONFLICT_PREVIEW_LINES, GLOBAL_TODO_DEFAULT, HELP_DOCUMENT_ID, INLINE_LINK_ATTR, NAVIGATION_BACK_STACK_LIMIT, PALETTE_RECENT_KEY, RECENT_FILES_DISPLAY_LIMIT, SEARCH_TYPE_ICON, SIDE_PANEL_MIN_WIDTH, WEATHER_CACHE_KEY } from './src-browser/constants.js';
import { allHeadingsInOrder, buildQueryReplacePattern, contactPhotoValueForHeading, expandScopeWithAncestors, findListItemByLineIndex, firstDataRowIndex, getOlpPrepend, hasBodyContent, headingsInSubtree, listItemDescendantCount, paragraphHasContent, stripCommaEscapeApp, tableHasContent, validateCaptureTemplates, vcardBodyHeadingsIn } from './src-browser/doc-helpers.js';
import { buildPriorityFieldGroup, buildTimestampFieldGroup, dateInputValue } from './src-browser/field-groups.js';
import { fetchWeatherData, getOrRenderPlotSvg, getServiceWorkerVersion, guessAnyAttachmentMimeType, imagePlaceholder, renderDiffView, renderLatexNode, scrollFocusedHeadingIntoView } from './src-browser/render-helpers.js';
import { QUICK_SETTINGS_FIELDS } from './src-browser/settings-fields.js';
import { agendaFilesCache, contactsFilesCache, imageDataUrlCache, kv, textModeLastCommittedValue } from './src-browser/singletons.js';
import { ALWAYS_KEEP_MINE, documentDisplayLabel, formatPendingChangeTimestamp, loadPaletteRecent, loadRefileRecent, recordSyncedWrite, rememberRefileTarget, resolvePendingChangeChoice, storageKindLabel } from './src-browser/sync-helpers.js';
import { SWIPE_THRESHOLD_PX, VH_UNIT, WIDE_LAYOUT_QUERY, aliasedMenuDivItem, appendMenuButtonsInOrder, appendSnippetWithHighlight, attachLongPress, autoGrowTextarea, entryFieldButtonStyle, fieldRow, hideModalOverlay, isWideLayout, keepOverlayInVisibleViewport, labeledInput, menuButton, menuDivItem, modalFieldRow, modalOverlayCleanups, pickTextFile, populateSelectOptions, positionPopupNearButton, requiredMenuDivItem, smallButton, tableActionButton, textInputStyle, withActionMenu, wizardButton } from './src-browser/ui-widgets.js';
import { S } from './src-browser/app-state.js';
import { godModeBtn, godModeKeyboardInput, captureBtn, capturePanel, capturePanelBox, contentAreaEl, doneNotePanel, doneNotePanelBox, externalChangeBanner, externalChangeDismissBtn, externalChangeMergeBtn, externalChangeReloadBtn, externalChangeText, extraMenuBtn, extraMenuPanel, fileMenuBtn, fileMenuPanel, minibufferEl, minibufferSearchEl, modelineBarEl, modelineEl, moreBtn, morePanel, nativeCreateElement, navBackBtn, outlineEl, refilePanel, refilePanelBox, saveBtnEl, searchBtn, searchPanel, settingsBtn, sidePanelDividerEl, sidePanelEl, splitRowEl, statusEl, tabBarEl, topBarEl, viewMenuBtn, viewMenuPanel } from './src-browser/dom.js';
import { syncAgendaFilesConfig, syncContactsFilesConfig } from './src-browser/agenda-files.js';
import { renderCapturePanel } from './src-browser/capture-ui.js';
import { anyOverlayPanelOpen, closeAllOverlayPanels, renderModeline, syncContentOffset } from './src-browser/chrome.js';
import { confirmDialog } from './src-browser/dialogs.js';
import { afterDocumentLoaded, saveCurrent } from './src-browser/documents-io.js';
import { commitAndRender, setStatus, startEditingTitle } from './src-browser/editing.js';
import { checkForExternalChange, hideExternalChangeBanner, mergeExternalChange, reloadCurrentDocumentFromDisk } from './src-browser/external-sync.js';
import { renderFileMenu, stopBrowsing } from './src-browser/file-menu.js';
import { closeFloatingKeyboard, noteKeydownDelivered, renderFloatingKeyboard, syncKeyboardToggle, withArmedShift } from './src-browser/floating-keyboard.js';
import { dispatchGodModeKeystroke, enterGodMode, tryDispatchPanelHotkey } from './src-browser/god-mode-palette.js';
import { scheduleCalendarSync } from './src-browser/calendar-sync.js';
import { syncCaptureShortcuts } from './src-browser/capture-shortcuts.js';
import { platform } from './src-browser/platform.js';
import { acceptNativeLaunches, handleLaunchParams } from './src-browser/launch-params.js';
import { clearStaleKeyboardFocusIfClickedElsewhere, enterInsertModeAtCurrentLine, moveKeyboardFocus, moveLineFocus, moveTableCellFocus, resyncKeyboardFocusToBodyRow, setKeyboardFocusToHeading } from './src-browser/keyboard-focus.js';
import { renderExtraMenu, renderMoreMenu } from './src-browser/menus.js';
import { navigateBack, toggleActionMenu } from './src-browser/navigation.js';
import { render, updateSaveButtonState } from './src-browser/render.js';
import { setupSidePanelResize } from './src-browser/row-render.js';
import { advanceToNextFileOrFinish, finishQueryReplace, renderSearchPanel } from './src-browser/search-ui.js';
import { applySidePanelWidth, applyTheme, renderSettingsView } from './src-browser/settings-view.js';
import { switchToTab } from './src-browser/tabs.js';
import { renderViewMenu } from './src-browser/views.js';
import { checkWeatherAutoRefresh, loadCachedWeatherData } from './src-browser/weather-flow.js';

document.createElement = function (tagName, options) {
  const el = nativeCreateElement(tagName, options);
  const tag = String(tagName).toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('autocorrect', 'off');
  }
  return el;
};

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
S.pendingLogNote = null;
// Set to { heading } when "Refile..." is tapped from a heading's own
// action menu -- renderRefilePanel shows the candidate-target list for
// it. Only ever one at a time, matching pendingLogNote's own pattern.
S.pendingRefile = null;
// Set to { heading, filenames, action } when Open or Delete is tapped
// on a heading with MORE than one attachment -- org-attach's own
// actual behavior ("if there's more than one, prompt for a file name
// first"), rather than guessing which one was meant. `action` is
// 'open' or 'delete', so renderAttachFileListPanel's own tap handler
// knows which of the two to actually do once a filename is picked.
// Skipped entirely (goes straight to the action) when there's exactly
// one attachment -- nothing to disambiguate. Reuses refilePanel's own
// DOM element, same pattern as pendingRefile above (this is a deeper
// sub-flow reached only after the Attach modal's own Open/Delete
// choice, not the modal itself).
S.pendingAttachFileList = null;
// Set when the file has more than one parallel #+TODO: workflow and the
// person has tapped the TODO action (either a blank heading or an
// already-in-progress one) -- holds { heading } while the full
// state-picker panel is showing, reusing refilePanel's own DOM element,
// same pattern as every other picker above. Real org's own actual
// multi-workflow model means a file with just one #+TODO: sequence (the
// overwhelming common case) never touches this at all -- the TODO
// action keeps behaving exactly as it always has.
S.pendingTodoWorkflowChoice = null;
// Set to true when the Calendar command (the palette's, or an Extras
// entry naming 'calendar) is run -- a single-month calendar overview,
// reusing refilePanel's own DOM element, same pattern as every other
// pendingXxx flow above. calendarViewYear/Month track which month is
// currently displayed -- null until first opened (initialized to
// today's own year/month at that point), then remembered across
// re-opens for the rest of this session (not persisted to storage,
// matching agendaAnchorDate's own same in-memory-only behavior),
// so navigating away and reopening the calendar doesn't lose your
// place.
S.calendarOpen = false;
S.calendarViewYear = null;
S.calendarViewMonth = null;
// Set to { heading } when "Record audio" is tapped -- reuses
// refilePanel's own DOM element, same pattern as every other pendingXxx
// flow above. mediaRecorder/recordedChunks/recordingStartedAt track the
// actual in-progress MediaRecorder session itself (null/[]/null when
// nothing is currently recording) -- kept as separate module-level
// state rather than nested inside pendingAudioRecording, since the
// recording panel's own render function needs to read/react to them on
// every tick of the elapsed-time display without re-deriving them from
// a single object each time.
S.pendingAudioRecording = null;
S.mediaRecorder = null;
S.recordedChunks = [];
S.recordingStartedAt = null;
S.recordedBlobUrl = null; // set once recording stops, for the review-before-save playback

// A live cache of GitHub settings, refreshed whenever Settings saves new
// ones — createGithubAdapter takes a getter function rather than a
// static config object specifically so this stays current without
// needing to reconstruct the adapter every time settings change.
S.githubConfig = { token: '', owner: '', repo: '', branch: 'main' };

S.webdavConfig = { baseUrl: '', username: '', password: '' };
// The calendar the agenda is mirrored to (src-browser/calendar-sync.js): its settings, and the state of the sync.
S.caldavConfig = { url: '', username: '', password: '' };
S.calendarSyncRunning = false;
S.calendarSyncQueued = false;
S.calendarSyncPaused = false; // after a login or address failure, until the person changes the settings or syncs by hand
S.calendarSyncTimer = null;
S.calendarSyncLastError = null;
// The tallest the window has been at its current width, to tell a keyboard that resizes the window from one that does not.
S.viewportBaseline = null;


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
S.agendaFilesConfig = [];

S.globalVariablesText = '';
S.globalVariables = {};  // "scheme:path" -> { doc, documentId } | { error } | { loading: true }
S.agendaFilesCacheLoadedFor = null; // JSON of the config this cache reflects, so a settings change invalidates stale entries

// org-contacts-files equivalent: additional GitHub/WebDAV files the
// vCard export scans across, beyond whichever file is currently open
// -- an independent, parallel mechanism to agenda-files above (same
// shape throughout), not folded into it, since a person may well want
// a different set of files for contacts than for agenda aggregation.
S.contactsFilesConfig = [];

 // "scheme:path" -> { doc, documentId } | { error } | { loading: true }
S.contactsFilesCacheLoadedFor = null;

S.externalChangeCheckInFlight = false;

// The specific disk hash a Dismiss applied to, so a genuinely NEWER
// external change (a different hash) still gets surfaced rather than
// being silently suppressed by an earlier, unrelated dismissal --
// null both before anything's ever been dismissed and after switching
// documents (see afterDocumentLoaded, which resets this).
S.externalChangeDismissedHash = null;

S.externalChangeShownForHash = null;

// Which element Settings is CURRENTLY rendering into -- updated by
// renderSettingsView itself whenever called with an
// explicit target (see that function below), so an internal
// re-render from deep inside settings (e.g. a theme button's own
// onclick calling renderSettingsView() with no argument, to reflect
// the just-changed value) automatically continues targeting wherever
// THIS open session actually put it -- #outline on a narrow layout,
// #sidePanel on a wide one -- rather than defaulting back to #outline
// unconditionally and silently rendering into the wrong place.
S.settingsRenderTarget = outlineEl;
S.historyRenderTarget = outlineEl;

window.addEventListener('resize', syncContentOffset);

setInterval(() => {
  if (S.state.doc) renderModeline();
  checkWeatherAutoRefresh();
}, 30000);

// Keeps #topBar visually pinned to the top of the actually-visible area
// even while an on-screen keyboard is open -- see this function's own
// surrounding comment for the full "why" (a real, researched, cross-
// platform fix, not a guess). visualViewport.offsetTop is exactly how
// far the visual viewport's own top edge currently sits below the
// layout viewport's own top edge (0 whenever no keyboard-driven auto-
// scroll has happened, e.g. no field is focused at all) -- nudging
// #topBar down by that same amount keeps it aligned with whatever's
// actually visible, compensating for the offset a plain
// position: fixed element has no way to react to on its own.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const repositionTopBarForKeyboard = () => {
    topBarEl.style.transform = `translateY(${vv.offsetTop}px)`;
  };
  vv.addEventListener('resize', () => {
    repositionTopBarForKeyboard();
    syncContentOffset();
  });
  vv.addEventListener('scroll', () => {
    repositionTopBarForKeyboard();
    syncContentOffset();
  });
  // A plain, layout-viewport-level scroll/resize is a second, independent
  // trigger for the exact same re-check -- catches whatever a given
  // browser/platform's own visualViewport events don't promptly fire for
  // on their own (e.g. the browser's default "scroll the newly-focused
  // field into view" behavior is a layout-viewport-level scroll, not
  // necessarily a visualViewport-level one).
  window.addEventListener('scroll', () => {
    repositionTopBarForKeyboard();
    syncContentOffset();
  });
  window.addEventListener('resize', () => {
    repositionTopBarForKeyboard();
    syncContentOffset();
  });
  // A third, deterministic trigger, independent of either of the above:
  // any editable field gaining or losing focus anywhere on the page.
  // focusin/focusout both bubble (unlike focus/blur), so one delegated
  // listener on document catches every heading-title/body/paragraph/
  // list-item/cell editor this app creates, without needing to attach a
  // fresh listener to each one individually as it's dynamically created
  // and destroyed. Fires on both focus IN (the keyboard is about to
  // open) and focus OUT (about to close) with a short delay either way,
  // giving the platform's own keyboard-open/dismiss animation and
  // viewport-resize a moment to actually finish before re-checking --
  // this specifically also catches the confirmed, currently-active iOS
  // 26 WebKit bug where visualViewport.offsetTop can fail to reset to 0
  // after the keyboard is dismissed (the resize/scroll events above may
  // already have fired with the still-wrong value by that point; this
  // re-checks again slightly later instead of trusting they got it right
  // the first time). Also re-syncs the bottom bar (syncContentOffset),
  // since editing body text specifically -- the case that motivated this
  // whole 3-trigger setup being extended to the bottom bar in the first
  // place -- is exactly a focusin/focusout on one of those same fields.
  document.addEventListener('focusin', () => setTimeout(() => { repositionTopBarForKeyboard(); syncContentOffset(); }, 350));
  document.addEventListener('focusout', () => setTimeout(() => { repositionTopBarForKeyboard(); syncContentOffset(); }, 350));
}
// Crossing the wide-layout breakpoint (e.g. resizing a browser window,
// or rotating a tablet) while Settings/Docs is open needs a re-render
// to switch between "replace #outline" (narrow) and "side panel"
// (wide) modes -- a plain resize could fire many times without ever
// crossing the breakpoint, so this listens specifically for the
// breakpoint itself rather than re-rendering on every pixel of resize.
window.matchMedia(WIDE_LAYOUT_QUERY).addEventListener('change', () => render());

/** Cycles the WHOLE document's own fold state between 'overview'
 *  (only top-level headings shown) and 'showeverything' (everything
 *  expanded) -- god-mode's own S-TAB, a simplified two-state
 *  version of real org's own three-state org-global-cycle (overview
 *  / contents / show-all), matching this app's own existing per-
 *  heading cycleFoldLevel's simpler convention. */
S.lastGlobalFoldState = 'showeverything';


// ---- Command palette --------------------------------------------------
//
// A searchable list of everything the app can do -- the touch-friendly
// counterpart of Emacs's M-x. Each command is filed under its plain name
// and, where there is one, the real Org/Emacs command it corresponds to
// (org-todo, org-clock-in, ...), so typing either finds it. Ranking lives
// in src/command-palette.js; this is the registry of what each command
// actually does, and the dialog.
//
// Heading commands act on the heading whose action menu is open, else
// the keyboard-focused one (extraMenuTargetHeading, the same target the
// Clocking menu uses). A command that can't run right now is still
// listed, dimmed, with the reason -- so it's never mysteriously absent.

S.paletteRecentIds = null; // loaded on first use, then kept in memory

/** Standard popup-menu "light dismiss": closes File/View/More/Extras
 *  when a pointer press lands outside both that menu's own panel and
 *  its own trigger button. pointerdown rather than click -- it fires
 *  first, so the dismiss is already complete before whatever else was
 *  actually pressed gets its own click handled, exactly matching how
 *  a native OS/browser popup menu behaves. Each trigger button is
 *  excluded from its own "outside" check since it already owns
 *  toggling its own menu via its existing click handler. */
document.addEventListener('pointerdown', (e) => {
  if (statusEl.textContent) setStatus('');

  const popupMenus = [
    { open: () => S.fileMenuOpen, panel: fileMenuPanel, btn: fileMenuBtn, close: () => { S.fileMenuOpen = false; renderFileMenu(); } },
    { open: () => S.viewMenuOpen, panel: viewMenuPanel, btn: viewMenuBtn, close: () => { S.viewMenuOpen = false; renderViewMenu(); } },
    { open: () => S.moreOpen, panel: morePanel, btn: moreBtn, close: () => { S.moreOpen = false; renderMoreMenu(); } },
    { open: () => S.extraMenuOpen, panel: extraMenuPanel, btn: extraMenuBtn, close: () => { S.extraMenuOpen = false; renderExtraMenu(); } },
  ];
  for (const menu of popupMenus) {
    if (menu.open() && !menu.panel.contains(e.target) && !menu.btn.contains(e.target)) {
      menu.close();
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (S.confirmDialogOpen || S.timestampPickerOpen || S.textFieldPopupOpen || S.buttonChoiceModalOpen) return;
  if (S.activeQueryReplace) {
    const { controller, inTextMode } = S.activeQueryReplace;
    if (e.key === 'y' || e.key === ' ') {
      e.preventDefault();
      controller.replace();
      renderSearchPanel();
    } else if (e.key === 'n' || e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      controller.skip();
      renderSearchPanel();
    } else if (e.key === '.') {
      e.preventDefault();
      controller.replace();
      finishQueryReplace();
    } else if (e.key === '!') {
      e.preventDefault();
      controller.replaceAll();
      if (inTextMode) finishQueryReplace();
      else advanceToNextFileOrFinish();
    } else if (e.key === 'q' || e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      controller.quit();
      finishQueryReplace();
    }
    return;
  }

  const activeTag = document.activeElement && document.activeElement.tagName;
  // never hijack actual typing; each field's own keydown handler (Escape to cancel, etc.) already owns this --
  // except the floating keyboard's hidden input, which exists ONLY to bring up the device keyboard so its
  // keystrokes reach god-mode; it holds no text of its own to protect
  if ((activeTag === 'INPUT' || activeTag === 'TEXTAREA') && document.activeElement !== godModeKeyboardInput) return;

  if (e.metaKey || e.ctrlKey) return; // Cmd/Ctrl combinations are the browser's own territory (new tab, save, find, ...) -- never treated as one of these shortcuts, avoiding a silent double-action

  if (statusEl.textContent) setStatus('');

  if (anyOverlayPanelOpen()) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAllOverlayPanels();
      render();
      return;
    }
    if (!e.altKey && tryDispatchPanelHotkey(e.key)) {
      e.preventDefault();
      return;
    }
    return; // every other key is ignored while a panel has the user's actual attention -- see anyOverlayPanelOpen's own docs for why
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    const godModeMidSequence = S.godModeState.chordString !== '' || S.godModeState.pendingModifier !== null;
    if (S.godModeActive && godModeMidSequence) {
      S.godModeState = godModeInitialState();
      setStatus('God-mode: sequence cancelled.');
      render();
    } else if (S.godModeActive) {
      S.godModeActive = false;
      render();
    } else if (S.keyboardFocusedHeading) {
      setKeyboardFocusToHeading(null);
      render();
    } else {
      enterGodMode();
      render();
      scrollFocusedHeadingIntoView();
    }
    return;
  }

  if (S.godModeActive) {
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return; // a bare modifier key press isn't a god-mode keystroke of its own
    // Most Android keyboards report every keystroke as key "Unidentified"
    // (keyCode 229, mid-composition) and deliver the letter only as an input
    // event -- handled by floating-keyboard.js from the hidden input's own
    // beforeinput/input. Treating that keydown as a keystroke would feed
    // god-mode the meaningless key name "Unidentified", so it is left alone.
    if (e.key === 'Unidentified' || e.keyCode === 229 || e.isComposing) return;
    e.preventDefault();
    if (e.target === godModeKeyboardInput) {
      if (e.key.length === 1) noteKeydownDelivered(e.key);
      // a key typed on the device keyboard gets the floating S if it is armed
      const { rawKey, shiftKey } = withArmedShift(e.key, e.shiftKey);
      dispatchGodModeKeystroke(rawKey, shiftKey);
      return;
    }
    dispatchGodModeKeystroke(e.key, e.shiftKey);
    return;
  }

  if (e.key === '/') {
    e.preventDefault();
    if (!S.searchOpen) {
      S.searchOpen = true;
      renderSearchPanel();
    }
    const input = document.getElementById('search-query-input');
    if (input) input.focus();
    return;
  }

  if (S.currentView !== 'org' || !S.state.doc) return; // everything below acts on the outline specifically

  if (!e.altKey && e.key === 'j') {
    e.preventDefault();
    moveKeyboardFocus(1);
    return;
  }
  if (!e.altKey && e.key === 'k') {
    e.preventDefault();
    moveKeyboardFocus(-1);
    return;
  }
  if (!e.altKey && !e.shiftKey && e.key === 'ArrowDown') {
    e.preventDefault();
    moveLineFocus(1);
    return;
  }
  if (!e.altKey && !e.shiftKey && e.key === 'ArrowUp') {
    e.preventDefault();
    moveLineFocus(-1);
    return;
  }
  if (!e.altKey && e.shiftKey && S.keyboardFocusedBodyRow && S.keyboardFocusedBodyRow.rowType === 'table' && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    if (e.key === 'ArrowUp') moveTableCellFocus(-1, 0);
    else if (e.key === 'ArrowDown') moveTableCellFocus(1, 0);
    else if (e.key === 'ArrowLeft') moveTableCellFocus(0, -1);
    else moveTableCellFocus(0, 1);
    return;
  }
  if (!S.keyboardFocusedHeading) return; // everything remaining needs a specific heading to act on

  if (e.key === 'i') {
    e.preventDefault();
    enterInsertModeAtCurrentLine();
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    const archiveVisibility = getCycleOpenArchivedTrees(S.state.localVariables) ? 'noarchived' : 'archived';
    cycleFoldLevel(S.keyboardFocusedHeading, { archiveVisibility });
    render();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    toggleActionMenu(S.keyboardFocusedHeading);
  }
});
// Reacts to ANY change to topBar's rendered content (a panel opening/
// closing, its content changing, search results growing/shrinking) —
// deliberately not a list of "call this after every place that could
// change topBar," which would be one missed call site away from drifting
// out of sync again.
new MutationObserver(syncContentOffset).observe(topBarEl, { childList: true, subtree: true, attributes: true });

// ---- multi-document tabs --------------------------------------------------
//
// Every field snapshotCurrentSessionValues()/applySessionSnapshotValues()
// (below) name is "this one open document's own state" -- swapped out to
// documentSessions and back in again on every tab switch. That pair of
// functions is the single, authoritative list of what counts as
// per-document state versus app-global (settings, theme, god-mode,
// capture-in-progress, and similar stay as plain globals, untouched by
// tab switching) -- getting this wrong either way is a real bug: leaving
// something out means it silently leaks between tabs; including
// something actually app-global means switching tabs would spuriously
// reset it.

S.documentSessions = []; // [{ tabId, scrollTop, ...snapshotCurrentSessionValues()'s own fields... }]
S.activeTabId = null;
S.nextTabId = 1;

S.state = { documentId: null, doc: null, startupConfig: null, storageKind: null, localVariables: null };
// File menu: whether the panel is open, and if so, which action's
// backend-choice sub-step is showing (null = the main New/Open/Save/Save
// As/Export list; otherwise 'open' | 'saveas' | 'export'). New no longer
// has a sub-step at all -- it creates an in-memory-only document
// directly, no backend/destination choice up front.
S.fileMenuOpen = false;
S.fileMenuStep = null;
S.moreMenuStep = null; // null | 'export' -- see renderMoreMenuContent
// Export sub-flow: which format was picked (null | 'markdown' | 'html'),
// tracked separately since the export flow has its own two steps
// (format, then scope) that don't fit the open/new/saveas
// backend-choice pattern the rest of the file menu already uses.
S.exportFormat = null;
S.exportPickingHeading = false;
S.vcardStyle = 'tree'; // 'flat' (real org-contacts.el's own convention) or 'tree' (real org-vcard's own alternative, the default) -- see export-vcard.js's own doc comment for the full structure of each. Defaults to 'tree' to match importStyle just below, for the same reason: flat has a real ceiling (only the first of each repeated field survives), where tree keeps every one.
S.exportVcardToNewBuffer = false; // Export > Contacts (.vcf)'s own "To: *new buffer*" checkbox -- routes the exported vCard text into a new, unsaved document (a heading titled "vCard(s)" with the raw text as its own body) instead of a file download
S.importStyle = 'tree'; // same two options, for org-vcard-import (More > Import) -- independent of vcardStyle above, since someone might export in one style but want to import a vCard from elsewhere into the other. Defaults to 'tree', not 'flat': flat has a real ceiling (only the first of each repeated field -- email, phone, address -- survives), where tree keeps every one, matching import-vcard.js's own library-level default.
S.importVcardToNewBuffer = false; // Import's own "To: *new buffer*" checkbox -- routes the imported contacts into a new, unsaved document instead of appending to the currently open one
S.importPickingHeading = false; // true while Import's own "Choose a heading..." heading list is shown, mirroring exportPickingHeading
S.importCleanMode = true; // Google's and Apple's own real, non-standard vCard export quirks (an 8th ADR component read as a human-readable label; "\:" unescaped to ":"; Apple's own X-ABLabel placeholder forms interpreted rather than shown verbatim) -- on by default, since most real-world vCard imports into this app are likely to come from one of these two sources

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
S.browseBackend = null;
S.browsePath = '';
S.browseEntries = null;
S.browseError = null;
S.settingsOpen = false;
S.searchOpen = false;
S.confirmDialogOpen = false; // true only while confirmDialog()'s own overlay is showing -- lets the global keydown handler cleanly step aside rather than racing this dialog's own key handling
S.captureOpen = false;
S.extraMenuOpen = false;
// The template currently showing its prompt-answer form, or null when
// the capture panel is just showing the template list. Replaces
// window.prompt() for %^{Prompt} placeholders -- window.prompt is a
// native OS-level dialog with known reliability/layout problems in a
// PWA running in standalone display mode on mobile (which is exactly
// what surfaced as "capture has no usable UI" and scroll/visibility
// glitches); an in-app form sidesteps that entirely, being just an
// ordinary part of this app's own layout.
S.capturePromptTemplate = null;
// Whether this capture's own preText/postText prompts were left off the
// currently-open form -- set once when the form opens (see
// peekTableAlreadyExists/openCapturePrompt below) and reused unchanged at
// commit time, never re-derived: the peek is a best-effort hint for the
// form's own shape only, and doing it twice risks the two disagreeing
// (e.g. if the underlying cache changed in between), which would corrupt
// which answer maps to which prompt token. The actual table-exists-or-not
// STRUCTURAL decision (does insertCapture create a new table or just add a
// row) is always separately, freshly determined at insertion time from the
// real, just-loaded document -- this flag only ever affects which prompts
// were asked and how the combined text was built for expansion, never
// whether preText/postText actually get inserted.
S.capturePromptSkipPrePost = false;
// True while a capture triggered by the extras (☰) menu is in progress
// -- that flow already knows exactly which template to use, so once
// it completes (success or cancel) the capture panel should close
// entirely rather than looping back to the "pick a template" picker
// grid the normal Capture button's own multi-capture flow shows,
// which the person never asked to see via the extras menu at all.
S.captureOpenedFromExtraMenu = false;
S.captureOpenedViaGodMode = false;
S.currentCaptureTemplates = [];
S.capturePromptValues = [];
S.moreOpen = false;
S.searchQuery = '';
S.searchUseRegex = false; // deliberately NOT reset when the search panel closes, unlike searchQuery -- this is a mode preference, not a one-off query value
S.searchUseMatch = false; // Match Query mode (C-c / m's own grammar) -- mutually exclusive with searchUseRegex, per direct decision: selecting Match replaces the whole query's own interpretation rather than layering on top of regex
S.searchOptionsMenuOpen = false; // the overflow popover (Regex/Match/Replace) replacing the old three-button row -- reset (not persisted) whenever search itself closes, same lifetime as searchUseRegex/searchUseMatch's own containing UI
S.activeQueryReplace = null; // { controller, replacementText, findPattern } while a replace walk is in progress, else null
S.viewMenuOpen = false;
// Agenda view state: which grouping is active, and the anchor date that
// grouping is centered/started on — prev/next navigation moves this
// anchor by one unit of whichever view is active (a day, a week, or a
// month), matching "scrolling by the view amount".
S.agendaViewType = 'week'; // 'day' | 'week' | 'month'
S.agendaAnchorDate = new Date();
S.agendaLogMode = false; // whether LOGBOOK entries (state-change/note timestamps) show alongside SCHEDULED/DEADLINE/etc. -- off by default, matching real org's own org-agenda-log-mode convention exactly (a toggle, not always-on, so daily task-scanning doesn't get cluttered by default)

// Effort sorting / filtering / per-day limit for the Agenda -- session state,
// like the Log toggle (see the panel built by buildAgendaEffortPanel).
S.agendaEffortPanelOpen = false;
S.agendaEffortSort = null; // null | 'up' | 'down'
S.agendaEffortFilter = null; // null | { op: '<' | '>' | '=', minutes, text }
S.agendaEffortMax = null; // null | { minutes, text }
S.agendaShowAllDatesOverride = null; // null = use the file's own org-agenda-show-all-dates default; true/false once the "g" button has been pressed this session
S.showClockDisplay = false; // org-clock-display: whether each TODO-view item shows its own total clocked time (including its subtree) -- off by default, matching real org's own org-clock-display being an on-demand COMMAND (M-x org-clock-display), not something always shown
S.showClocktable = false; // org-clock-report: whether the TODO view's own clocktable configuration section is expanded -- off by default, same reasoning as showClockDisplay above
S.clocktableStart = '';
S.clocktableEnd = '';
S.clocktableMaxlevel = 2;
// Which heading (by object reference) currently has its title in edit
// mode, and whether it was just created (so an empty commit removes it
// instead of leaving a titleless heading behind).
S.editingHeading = null;
S.editingIsNew = false;
// { heading, table, rowIndex, colIndex } for the one table cell currently
// being edited, or null. `table` must always be a reference read fresh
// from the current render (see body-edit.js's module docstring).
S.editingCell = null;
// { heading, paragraph } for the one paragraph currently being edited, or null.
S.editingParagraph = null;
// %%(org-weather)'s own last-fetched snapshot -- app-level state, not
// part of the per-document `state` object above, since weather data
// has nothing to do with which document happens to be open and
// should persist across switching between them. null until the first
// successful refresh (or before the cached value has finished
// loading from IndexedDB on startup -- see loadCachedWeatherData).
S.weatherData = null;
S.weatherLastRefreshed = null; // the API's own current.time (local, timezone-naive), or null
// { heading, item } for the one list item currently being text-edited, or null.
S.editingListItem = null;
// The single heading whose combined multi-paragraph body text (per
// body-edit.js's getHeadingText/setHeadingText) is currently being edited
// as one block via openHeadingTextEditor's own modal, or null. Set the
// moment the modal opens (before openHeadingTextEditor itself is called),
// so this same render() pass hides that heading's own body-content rows
// underneath (see the visibleRows filter in the main render loop) --
// cleared again on Cancel/OK, restoring them. Distinct from
// editingParagraph, which still handles editing one specific paragraph
// row directly (e.g. a paragraph that comes after a list, outside this
// combined block's scope).
S.editingHeadingText = null;
// The single heading whose general editor (SCHEDULED/DEADLINE, plain
// timestamp, tags, priority, properties -- all six committed together
// on Save, discarded together on Cancel) is currently open, or null.
S.editingGeneral = null;
// The single heading or list-item node whose contextual action row is
// currently revealed (tap-to-reveal, per the interaction redesign — only
// one open at a time). Not the same as editingHeading/editingListItem:
// tapping the revealed pencil icon is what transitions into those.
S.actionMenuFor = null;

// The heading currently focused via keyboard navigation (see the
// keydown listener near the bottom of this file) -- distinct from
// actionMenuFor, which is about a tap-revealed action row. null until
// the person actually uses a keyboard-navigation key (arrow/j/k),
// which is also the gate that gates the rest of the keyboard shortcuts
// -- Tab/Enter/etc. only act once a heading is actually focused, so
// a stray Tab press before ever engaging keyboard nav doesn't hijack
// normal browser focus-cycling for a keyboard/screen-reader user who
// never asked for org-style keyboard nav in the first place.
S.keyboardFocusedHeading = null;
S.keyboardFocusedBodyRow = null;
S.keyboardFocusedCellPos = null;
S.pendingCursorPosition = null;
// god-mode: whether it's currently active (toggled by Escape -- see
// the keydown listener below), and the in-progress key-sequence
// state (src/god-mode.js's own state shape) accumulated so far.
// Reset to a fresh state after every dispatched action, cancelled
// sequence, or dead end -- godModeActive itself stays on across
// dispatches, matching real god-mode's own "stays engaged until
// explicitly toggled off" behavior, not a one-shot mode.
S.godModeActive = false;
S.godModeState = godModeInitialState();
// Armed by C-f, consumed by C-/ -- see that chord's own comment
// (src-browser/god-mode-palette.js) for the real-Emacs-derived redo
// technique this implements.
S.godModeRedoArmed = false;
// { chord, label } for the chord god-mode has just run, shown in the minibuffer
// until the next keystroke (label is the palette's name for it, or null).
S.godModeLastCommand = null;
// The floating keyboard (src-browser/floating-keyboard.js): true only while
// god-mode was entered via the [g] toolbar button, which also brings up
// the device's own keyboard through a hidden input. Deliberately NOT
// simply "godModeActive" -- a desktop user entering god-mode with a real
// Escape key has no use for an on-screen keyboard, and shouldn't get one.
S.floatingKeyboardOpen = false;
// One-shot Shift for the floating keyboard's own buttons: armed by tapping
// S, consumed by the next button tapped.
S.floatingKeyboardShiftArmed = false;
// Tapping the panel's move area shrinks it to just that handle, to see what
// is behind it; tapping again restores it.
S.floatingKeyboardMinimized = false;
// Where the floating keyboard was last left: { left } in px (null = its default
// right-hand corner) and { bottom } in px up from the bottom of the screen.
// It is set by dragging, and by the device keyboard pushing the panel up (which
// then STAYS pushed up when the keyboard goes away). null = its default spot
// just above the floating buttons. Always kept above the mode line and the
// floating buttons when applied. Session-only, not persisted.
S.floatingKeyboardPos = null;
S.floatingKeyboardSettleTimer = null; // pending "keep this push" timer, see floating-keyboard.js
S.godModeInputFedLength = 0; // see floating-keyboard.js's input handling
S.godModeRecentKeydown = null;
// The heading most recently navigated to via navigateToHeading (a
// search result, an internal link, an agenda item) -- tracked
// specifically so switching into the plain-text editor can land near
// that same content instead of always resetting to the top of the
// file. Not updated by manual scrolling/tapping within the outline
// itself; deliberately scoped to explicit "jump to X" navigation only.
S.currentContextHeading = null;
// The single heading the outline is currently restricted to (More menu
// "Narrow"/"Widen", or the god-mode C-x n s / C-x n w chords), or null
// when not narrowed -- a display-only restriction on which rows
// visibleRows includes, never on state.doc itself, so Save/Export/
// Agenda/Search all keep operating on the whole document regardless
// (see the visibleRows filter in the main render loop). Held as a
// direct object reference and re-walked fresh via collectSubtreeHeadings
// on every render, not a fixed snapshot computed once -- if the
// narrowed heading itself moves, gets promoted/demoted, or is deleted
// entirely, the narrowed view follows it (or, if deleted, this gets
// reset to null and the view auto-widens) rather than showing something
// stale. Persists within-session (part of snapshotCurrentSessionValues
// below) and across an actual reload too (see saveNarrowStateForDocument/
// restoreNarrowStateForDocument, using the exact same outline-path
// durability scheme outlinePathForHeadingInDocument/
// findHeadingByOutlinePath already established for search-result
// navigation surviving a fresh re-parse).
S.narrowedHeading = null;
// The current Search-driven narrow scope: null (widened, the default) or
// { matched: Set, visible: Set } -- `matched` is exactly the current
// document's own search results (for an accurate count in the banner
// below); `visible` additionally includes their own ancestors (for
// row-filtering, so a match stays visible in its real position with
// enough context to make sense of where it sits, matching this app's
// own swipe-to-fold and real org sparse trees alike). An independent,
// additional row filter alongside narrowedHeading above, not a
// replacement for it or mutually exclusive with it -- narrowing to a
// subtree and then narrowing further to search matches within it works
// without any special-casing, since each filter just further restricts
// whatever rows survived the one before it. Deliberately session-only:
// unlike narrowedHeading, this does NOT persist across an actual
// reload -- widens automatically instead. A real gap worth closing
// later if this proves worth using regularly, not an oversight;
// persisting a whole SET of headings durably across a fresh re-parse is
// a meaningfully bigger piece of work than narrowedHeading's own single-
// heading outline-path scheme, and this first version doesn't take it
// on.
S.sparseNarrowScope = null;
// Which documentId maybeRestoreNarrowState() has already attempted a
// reload-surviving restore for -- so the kv lookup only ever fires
// once per document, not on every single render() call, and so a
// slow, in-flight lookup for a document that's since been navigated
// away from can't come back and clobber whatever's true now.
S.narrowStateRestoreAttemptedFor = null;
// Same, for Search's Narrow (maybeRestoreSparseNarrow()).
S.sparseNarrowRestoreAttemptedFor = null;
// The god-mode hint card (src-browser/god-mode-hints.js): its element, and the index of bound chords it searches.
S.godModeHintsEl = null;
// Content for the Capture in progress that came from outside: shared from another app (%i, %a), and the clipboard (%x).
S.captureShared = null;
S.captureClipboard = '';
S.godModeChordIndex = null;
// { startLine, lineCount } within serializeOrg(state.doc)'s own full
// text, or null -- see this feature's own doc comment on the render()
// text-view block above for the full reasoning on why this is fixed
// once, before editing, rather than re-derived from the edited
// fragment later.
S.narrowedTextModeRange = null;
// A stack of previously-visited headings, pushed by navigateToHeading
// itself before each jump -- lets a tapped link/footnote/search
// result/agenda item be followed on a mobile device (where there's no
// reliable, always-present browser Back the way desktop has) and then
// returned from via the floating back button, without needing to
// manually scroll back to wherever the tap originated. Capped so an
// unbroken chain of link-following doesn't grow this without limit.
S.navigationBackStack = [];

// Which of the three top-level views is showing: 'org' (the default
// outline), 'text' (the whole-document plain-text editor), or 'agenda'.
// While 'text', render() shows only a textarea; while 'agenda', render()
// shows the agenda list instead of the outline. Either way, none of the
// outline's tap-to-edit/reveal-menu state applies (and gets cleared when
// switching away from 'org').
S.currentView = 'org';
// Whether the currently open document has edits that haven't been
// written to disk/GitHub/WebDAV yet — set true the moment any edit is
// committed, and cleared only after a successful Save/Save As, or when a
// document is freshly opened/created. Purely in-memory and synchronous
// (not read from the outbox asynchronously) so the indicator can update
// immediately, matching the app's existing optimistic-render approach.
S.isDirty = false;
// buffer-read-only: real Emacs's own actual variable -- whether this
// document is currently protected from editing. Set from the document's
// own Local/Global Variables on load (see getBufferReadOnly), and toggled
// at runtime by god-mode's own C-x C-q, matching real Emacs exactly. The
// modeline's own four-state display (--/**/ %% /%*) combines this with
// isDirty directly rather than tracking a separate "modified while
// read-only" flag -- isDirty already means "unsaved changes exist"
// regardless of how they got there, which is exactly what %* needs.
S.isBufferReadOnly = false;
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
S.lastSavedText = null;

// Undo/redo history for the CURRENTLY open document's editing session
// only -- reset every time a document is freshly opened (not persisted,
// not carried across a reopen, by explicit design choice: simpler and
// lower-risk than trying to make sense of undo history against a file
// that may have changed on disk since it was last open). See
// src/undo-history.js for the actual history model this wraps.
S.history = createHistory('');
S.historyOpen = false;
// Which theme's ('light' or 'dark') color-customization section is
// currently expanded in Settings -- null means both collapsed, the
// default, so the Appearance section stays as uncluttered as it
// currently is unless someone actually taps in to customize.
S.expandedThemeColorSection = null;
// The active service-worker registration, once available -- stored
// here (not just closed over inside the registration callback) so
// Settings' own manual "Check for updates" button can call
// registration.update() on demand, not only the automatic checks.
S.swRegistration = null;
S.updateCheckStatus = null; // null | 'checking' | 'up-to-date' | 'found' | 'error'
S.currentAppVersion = null; // the active service worker's own CACHE_NAME (e.g. "org-pwa-shell-v225"), once resolved
S.appVersionCheckState = 'pending'; // 'pending' (never started) | 'checking' (in flight) | 'done' (resolved, currentAppVersion may still be null e.g. no controller was available)
S.historyDiffExpandedIndex = null;

 

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


 // px -- also the matching floor left for #outline, so neither side can swallow the other

setupSidePanelResize();

// Commits a currently-editing table cell before anything else on the
// page reacts to this same tap -- capture phase, so it runs ahead of
// whatever the tap actually landed on. Without this, that target's own
// click handling races the cell's own blur-triggered commit-and-
// rerender, and loses on the first tap the same way switching directly
// between two cells used to (see the per-cell mousedown handler above
// for the fuller explanation this mirrors). Excludes both the cell's
// own textarea AND its adjacent ⎌ discard button -- a tap on either is
// still part of this same editing session, not a tap "elsewhere" that
// should commit; the discard button's own handler (mousedown, same
// ordering reasoning as this one) is what actually decides what a tap
// on it means.
document.addEventListener(
  'mousedown',
  (e) => {
    if (!S.editingCell) return;
    if (e.target.closest('#cell-edit-input')) return; // still inside the cell's own textarea -- this tap isn't leaving it, nothing to commit
    if (e.target.closest('.cell-cancel-btn')) return; // the discard button itself -- its own handler decides, not this one
    e.preventDefault();
    const prevInput = document.getElementById('cell-edit-input');
    const { heading, table, rowIndex: ri, colIndex: ci } = S.editingCell;
    S.editingCell = null;
    if (prevInput) setTableCell(heading, table, ri, ci, prevInput.value.replace(/\n/g, ' '));
    resyncKeyboardFocusToBodyRow(heading, 'table', table.lineIndex);
    commitAndRender('Edited table cell');
  },
  true
);

document.addEventListener('click', clearStaleKeyboardFocusIfClickedElsewhere);

// ---- Open --------------------------------------------------------------

// ---- New ---------------------------------------------------------------

// ---- Save / Save As --------------------------------------------------

// ---- File menu UI -------------------------------------------------------

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    if (S.fileMenuOpen) positionPopupNearButton(fileMenuPanel, fileMenuBtn);
    if (S.viewMenuOpen) positionPopupNearButton(viewMenuPanel, viewMenuBtn);
    if (S.moreOpen) positionPopupNearButton(morePanel, moreBtn);
    if (S.extraMenuOpen) positionPopupNearButton(extraMenuPanel, extraMenuBtn);
  });
}

S.timestampPickerOpen = false; // true only while openTimestampPickerPopup's own overlay is showing -- mirrors confirmDialogOpen's own role for the global keydown handler
S.textFieldPopupOpen = false; // true only while openTextFieldPopup's own overlay is showing -- same role, for the heading-title/effort/general-editor text prompts
S.buttonChoiceModalOpen = false; // true only while openButtonChoiceModal's own overlay is showing -- same role, for the archive/attach/general-editor choice prompts

fileMenuBtn.addEventListener('click', () => {
  const opening = !S.fileMenuOpen;
  closeAllOverlayPanels();
  S.fileMenuOpen = opening;
  S.fileMenuStep = null;
  stopBrowsing();
  render();
  renderFileMenu();
});

saveBtnEl.addEventListener('click', () => {
  saveCurrent();
});

navBackBtn.addEventListener('click', async () => {
  await navigateBack();
});

// ---- Agenda view ---------------------------------------------------------

viewMenuBtn.addEventListener('click', () => {
  if (!S.state.doc) return;
  const opening = !S.viewMenuOpen;
  closeAllOverlayPanels();
  S.viewMenuOpen = opening;
  render();
  renderViewMenu();
});

// ---- Settings UI --------------------------------------------------------

// Loaded once at bootstrap, updated whenever the person changes a
// custom color -- { light: { "--bg": "#...", ... }, dark: { ... } },
// only ever containing whichever variables have actually been
// overridden (see setCustomThemeColors's own docs). {} means nobody's
// customized anything, the common case, and applyTheme below behaves
// completely unchanged from before this feature existed.
S.customThemeColors = {};

// ---- Help (README.org, opened as a real document) -------------------

settingsBtn.addEventListener('click', async () => {
  const opening = !S.settingsOpen;
  closeAllOverlayPanels();
  S.settingsOpen = opening;
  if (S.settingsOpen) {
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

// [g]: god-mode without an Escape key. Tapping it enters god-mode, shows the
// floating keyboard, and focuses a hidden input so the device's own keyboard
// comes up too; tapping it again -- or the device keyboard being dismissed
// any other way (the input's blur, below) -- undoes all three together.
// pointerdown is prevented so tapping [g] itself never blurs the input and
// looks like a dismissal: the click handler alone decides.
godModeBtn.addEventListener('pointerdown', (e) => e.preventDefault());
godModeBtn.addEventListener('click', () => {
  if (S.floatingKeyboardOpen) {
    S.godModeActive = false;
    S.godModeState = godModeInitialState();
    closeFloatingKeyboard();
    setStatus(''); // the indicator is only rewritten while god-mode is on
    render();
    return;
  }
  closeAllOverlayPanels();
  enterGodMode();
  S.floatingKeyboardOpen = true;
  S.floatingKeyboardShiftArmed = false;
  S.floatingKeyboardMinimized = false;
  godModeKeyboardInput.value = '';
  render();
  godModeKeyboardInput.focus({ preventScroll: true });
  scrollFocusedHeadingIntoView();
});
// The device keyboard going away (a tap elsewhere, the OS's own gesture, a popup
// taking focus) does NOT end god-mode or hide the floating keyboard: they end
// through [g], Escape, or another panel opening. It only changes whether the
// panel's own keyboard key is lit.
godModeKeyboardInput.addEventListener('blur', syncKeyboardToggle);
godModeKeyboardInput.addEventListener('focus', syncKeyboardToggle);

searchBtn.addEventListener('click', () => {
  const opening = !S.searchOpen;
  closeAllOverlayPanels();
  S.searchOpen = opening;
  render();
  renderSearchPanel();
});

// ---- Capture ---------------------------------------------------------

// ---- Capture ---------------------------------------------------------

extraMenuBtn.addEventListener('click', () => {
  const opening = !S.extraMenuOpen;
  closeAllOverlayPanels();
  S.extraMenuOpen = opening;
  render();
  renderExtraMenu();
});

captureBtn.addEventListener('click', () => {
  const opening = !S.captureOpen;
  closeAllOverlayPanels();
  S.captureOpen = opening;
  S.captureOpenedFromExtraMenu = false;
  S.captureOpenedViaGodMode = false;
  render();
  renderCapturePanel();
});

// ---- More menu (Search / Capture / Add heading) ---------------------

moreBtn.addEventListener('click', () => {
  const opening = !S.moreOpen;
  closeAllOverlayPanels();
  S.moreOpen = opening;
  if (opening) S.moreMenuStep = null; // always start at the top-level list, never wherever a previous visit left off (Import/Export, say)
  render();
  renderMoreMenu();
});

if ('serviceWorker' in navigator && platform.usesServiceWorker) {
  const updateBanner = document.getElementById('updateBanner');
  const updateReloadBtn = document.getElementById('updateReloadBtn');
  let reloadedForUpdate = false;

  function showUpdateBanner(waitingWorker) {
    updateBanner.style.display = 'flex';
    syncContentOffset();
    updateReloadBtn.onclick = () => {
      waitingWorker.postMessage('SKIP_WAITING');
    };
    S.updateCheckStatus = 'found';
    if (S.settingsOpen) renderSettingsView();
  }

  navigator.serviceWorker
    .register('sw.js')
    .then((registration) => {
      S.swRegistration = registration;
      S.appVersionCheckState = 'checking';
      getServiceWorkerVersion().then((version) => {
        S.currentAppVersion = version;
        S.appVersionCheckState = 'done';
        if (S.settingsOpen) renderSettingsView();
      });

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
  // Ready before the palette is first opened, so it can open instantly.
  loadPaletteRecent().then((ids) => {
    if (S.paletteRecentIds === null) S.paletteRecentIds = ids;
  });
  S.githubConfig = await getGithubConfig(kv);
  S.webdavConfig = await getWebdavConfig(kv);
  S.caldavConfig = await getCaldavConfig(kv);
  await loadCachedWeatherData();
  S.globalVariablesText = await getGlobalVariables(kv);
  S.globalVariables = parseGlobalVariables(S.globalVariablesText);
  syncAgendaFilesConfig();
  syncContactsFilesConfig();
  renderFloatingKeyboard(); // a disabled [g] button should not flash on before the first full render

  S.customThemeColors = await getCustomThemeColors(kv);
  applyTheme(await getTheme(kv));
  applyFontFamily(await getFontFamily(kv));
  applyMenuSize(await getMenuSize(kv));
  applyParagraphSpacing(await getParagraphSpacing(kv));
  applyTablesSpacing(await getTablesSpacing(kv));
  S.floatingKeyboardPos = await getFloatingKeyboardPos(kv); // where the floating keyboard was last dragged to, if ever
  applyFontSize(await getFontSize(kv));
  applyTablesFontSize(await getTablesFontSize(kv));
  applyReadingWidth(await getReadingWidth(kv));
  applySidePanelWidth(await getSidePanelWidth(kv));
  syncContentOffset();

  const openTabsData = await getOpenTabs(kv);
  if (openTabsData && Array.isArray(openTabsData.tabs) && openTabsData.tabs.length > 0) {
    let anyOpened = false;
    for (const tab of openTabsData.tabs) {
      if (!tab.documentId) continue;
      try {
        const cached = await kv.get('doc:' + tab.documentId);
        if (cached && typeof cached.value === 'string') {
          const doc = parseOrg(cached.value);
          const pending = await hasPendingChange(kv, tab.documentId);
          await afterDocumentLoaded(tab.documentId, doc, tab.storageKind, pending);
          anyOpened = true;
        }
      } catch {
        // One tab failing to restore shouldn't block the rest -- move on to the next.
      }
    }
    if (anyOpened) {
      const activeTabData = openTabsData.tabs[openTabsData.activeIndex];
      if (activeTabData) {
        const matchingSession = S.documentSessions.find((s) => s.state.documentId === activeTabData.documentId && s.state.storageKind === activeTabData.storageKind);
        if (matchingSession) switchToTab(matchingSession.tabId);
      }
      updateSaveButtonState();
      render();
      checkForExternalChange();
      checkWeatherAutoRefresh();
      return;
    }
  }

  const last = await getLastActiveDocument(kv);
  if (last && last.documentId) {
    try {
      const cached = await kv.get('doc:' + last.documentId);
      if (cached && typeof cached.value === 'string') {
        const doc = parseOrg(cached.value);
        const pending = await hasPendingChange(kv, last.documentId);
        await afterDocumentLoaded(last.documentId, doc, last.storageKind, pending);
        updateSaveButtonState();
        render();
        checkForExternalChange();
        checkWeatherAutoRefresh();
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
  const documentId = S.state.documentId;
  if (S.isDirty) {
    const proceed = await confirmDialog(
      `Reloading "${documentId}" will discard your unsaved local changes here and replace them with the current version from disk. (Merge keeps both.) Continue?`,
      { confirmLabel: 'Reload', danger: true }
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

externalChangeMergeBtn.addEventListener('click', mergeExternalChange);

externalChangeDismissBtn.addEventListener('click', () => {
  S.externalChangeDismissedHash = S.externalChangeShownForHash;
  hideExternalChangeBanner();
});

// The proactive half of external-change detection: re-check whenever the
// tab regains focus, since that's exactly when a change made elsewhere
// while this tab sat in the background would otherwise go unnoticed for
// however much longer the person keeps working here. Best-effort (see
// checkForExternalChange's own doc comment) -- never blocks anything.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    checkForExternalChange();
    scheduleCalendarSync(); // coming back to the app: the files may have changed while it was away
  }
});

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
    if ((await getTheme(kv)) === 'system') applyTheme('system');
  });
}

// bootstrap() has several ways out (a restored set of tabs, a resumed document, a fresh start), so a share or an icon
// shortcut that asked for Capture is acted on here, once whichever of them finished (see launch-params.js).
bootstrap().then(() => {
  handleLaunchParams().catch(() => {});
  acceptNativeLaunches(); // a native shell's shares that arrived while the app was starting
  syncCaptureShortcuts(); // the launcher's long-press list follows the capture templates
  scheduleCalendarSync();
});
