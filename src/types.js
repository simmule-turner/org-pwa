// @ts-check
// Shapes shared across the app, for JSDoc: a file brings one in with
//   /** @typedef {import('./types.js').Heading} Heading */
// (the path is ../src/types.js from src-browser). Nothing here runs.

/**
 * One heading as org-parser.js reads it. The index signature is there because other modules hang their own fields on it.
 * @typedef {{
 *   type: string,
 *   level: number,
 *   todo: string | null,
 *   priority: string | null,
 *   title: string,
 *   tags: string[],
 *   planning: { scheduled: string | null, deadline: string | null, closed: string | null },
 *   properties: Record<string, string>,
 *   propertyOrder: string[],
 *   logbookLines: string[],
 *   bodyLines: string[],
 *   collapsed: boolean,
 *   bodyHidden: boolean,
 *   children: Heading[],
 *   [key: string]: any,
 * }} Heading
 */

/** @typedef {{ key: string, value: string, [k: string]: any }} Keyword */

/**
 * A parsed document: the keywords and body lines before the first heading, then the top-level headings.
 * @typedef {{ type: string, keywords: Keyword[], bodyLines: string[], children: Heading[], [key: string]: any }} Doc
 */

/** The key-value store behind the document cache and settings: one value per string key. */
/** @typedef {{ get(key: string): Promise<any>, set(key: string, value: any): Promise<any>, delete(key: string): Promise<any> }} KvAdapter */

/** The file-local variables of a document (`# -*- ... -*-` and `Local Variables:`), by name. */
/** @typedef {Record<string, any>} LocalVars */

/**
 * One line of a table: a data row, or a horizontal rule (`type: 'rule'`, which has no cells).
 * @typedef {{ type: string, cells: string[], cellsInline?: any[], [key: string]: any }} TableRow
 */

/**
 * A table as the body parser reads it. Other modules hang their own fields on it.
 * @typedef {{ type: string, rows: TableRow[], tblfm: string | null, lineIndex: number, lineCount: number, [key: string]: any }} Table
 */

/** The key sequence being typed in god mode: the chord so far, a pending `g`/`G` prefix, and the sticky literal and C-c flags. */
/** @typedef {{ chordString: string, pendingModifier: string | null, literalActive: boolean, inCcChain: boolean }} GodState */

/** @typedef {{ token: string, owner: string, repo: string, branch: string }} GithubConfig */
/** @typedef {{ baseUrl: string, username: string, password: string }} WebdavConfig */
/** @typedef {{ url: string, contactsUrl: string, username: string, password: string }} CaldavConfig */

/** What a tab holds of its document: the parsed text and where it came from (`storageKind` is null for a buffer with no file yet). */
/** @typedef {{ documentId: string, doc: Doc, storageKind: string | null, startupConfig?: any, localVariables: LocalVars }} DocState */

/** A tab that is not on screen, as tabs.js snapshots it. The tab on screen keeps the same fields in `S`. */
/** @typedef {{ tabId: number, scrollTop: number, state: DocState, isDirty: boolean, isBufferReadOnly: boolean, lastSavedText: string | null, history: any, [key: string]: any }} TabSession */

/** A place a document is read from and written to (GitHub, WebDAV, a local file, an imported file). `write`'s options carry
 *  `expect`, the version the caller compared against, for the adapters that can refuse to replace a newer one. */
/** @typedef {{ read(id: string, ...rest: any[]): Promise<{ content: string, hash: string | null } | null>, write(id: string, content: string, options?: { expect?: { exists: boolean, hash: string | null } }): Promise<{ hash: string | null }>, [key: string]: any }} DiskAdapter */

export {};

/** @typedef {{ heading: Heading, fromTodo: string | null, toTodo: string | null, timestamp: string }} PendingLogNote */
/** @typedef {{ heading: Heading, mode: string, loading: boolean, candidates: any[], errors: any[], recent: any[], selected: any, query: string }} PendingRefile */
/** @typedef {{ heading: Heading, table: Table, rowIndex: number, colIndex: number }} EditingCell */
/** @typedef {{ heading: Heading, paragraph: any }} EditingParagraph */
/** @typedef {{ heading: Heading, item: any }} EditingListItem */
/** @typedef {{ startLine: number, lineCount: number }} NarrowedTextRange */
/** @typedef {{ matched: Set<Heading>, visible: Set<Heading> }} SparseNarrowScope */
/** @typedef {{ chord: string, label: string }} GodLastCommand */
/** @typedef {{ view: string, documentId: string, storageKind: string | null, scrollTop: number, [key: string]: any }} BackStackEntry */

/**
 * The app's shared mutable state (`S` in app-state.js). Every property is listed here, so a misspelt or wrongly typed
 * use is a compile error. Properties a tab keeps for itself are also in TabSession (tabs.js's snapshot).
 * @typedef {{
 *   state: DocState, documentSessions: TabSession[], activeTabId: number | null, nextTabId: number,
 *   isDirty: boolean, isBufferReadOnly: boolean, lastSavedText: string | null, history: any, historyOpen: boolean,
 *   historyDiffExpandedIndex: number | null, historyRenderTarget: HTMLElement, settingsRenderTarget: HTMLElement,
 *   currentView: string, navigationBackStack: BackStackEntry[], lastGlobalFoldState: string,
 *   editingHeading: Heading | null, editingIsNew: boolean, editingCell: EditingCell | null,
 *   editingParagraph: EditingParagraph | null, editingListItem: EditingListItem | null,
 *   editingHeadingText: Heading | null, editingGeneral: Heading | null, actionMenuFor: Heading | null,
 *   keyboardFocusedHeading: Heading | null, keyboardFocusedBodyRow: any, keyboardFocusedCellPos: { rowIndex: number, colIndex: number } | null,
 *   pendingCursorPosition: string | number | null, currentContextHeading: Heading | null,
 *   narrowedHeading: Heading | null, narrowedTextModeRange: NarrowedTextRange | null, sparseNarrowScope: SparseNarrowScope | null,
 *   narrowStateRestoreAttemptedFor: string | null, sparseNarrowRestoreAttemptedFor: string | null,
 *   godModeActive: boolean, godModeState: GodState, godModeRedoArmed: boolean, godModeLastCommand: GodLastCommand | null,
 *   godModeHintsEl: HTMLElement | null, godModeChordIndex: any, godModeInputFedLength: number, godModeRecentKeydown: { key: string, at: number } | null,
 *   floatingKeyboardOpen: boolean, floatingKeyboardShiftArmed: boolean, floatingKeyboardMinimized: boolean,
 *   floatingKeyboardPos: { left: number | null, bottom: number } | null, floatingKeyboardSettleTimer: any,
 *   pendingLogNote: PendingLogNote | null, pendingRefile: PendingRefile | null,
 *   pendingAttachFileList: { heading: Heading, filenames: string[], action: string } | null,
 *   pendingTodoWorkflowChoice: { heading: Heading, viaGodMode: boolean } | null,
 *   pendingAudioRecording: { heading: Heading } | null, mediaRecorder: MediaRecorder | null, recordedChunks: Blob[],
 *   recordingStartedAt: number | null, recordedBlobUrl: string | null,
 *   calendarOpen: boolean, calendarViewYear: number, calendarViewMonth: number,
 *   githubConfig: GithubConfig, webdavConfig: WebdavConfig, caldavConfig: CaldavConfig,
 *   calendarSyncRunning: boolean, calendarSyncQueued: boolean, calendarSyncPaused: boolean, calendarSyncTimer: any, calendarSyncLastError: string | null,
 *   contactsSyncRunning: boolean, contactsSyncQueued: boolean, contactsSyncPaused: boolean, contactsSyncTimer: any, contactsSyncLastError: string | null,
 *   apptSettings: any, apptModeLine: string | null, viewportBaseline: { width: number, height: number } | null,
 *   captureShortcutsResult: any, attachmentsFolder: string | null,
 *   agendaFilesConfig: any[], globalVariablesText: string, globalVariables: Record<string, any>, agendaFilesCacheLoadedFor: string | null,
 *   contactsFilesConfig: any[], searchExtraFilesConfig: any[], searchExtraFilesCacheLoadedFor: string | null, contactsFilesCacheLoadedFor: string | null,
 *   externalChangeCheckInFlight: boolean, externalChangeDismissedHash: string | null, externalChangeShownForHash: string | null,
 *   paletteRecentIds: string[] | null,
 *   fileMenuOpen: boolean, moreMenuStep: string | null, fileScreen: any, settingsOpen: boolean, searchOpen: boolean,
 *   confirmDialogOpen: boolean, captureOpen: boolean, extraMenuOpen: boolean, moreOpen: boolean, viewMenuOpen: boolean,
 *   timestampPickerOpen: boolean, textFieldPopupOpen: boolean, buttonChoiceModalOpen: boolean,
 *   exportFormat: string | null, exportPickingHeading: boolean, vcardStyle: string, exportVcardToNewBuffer: boolean,
 *   exportIcsAsFile: boolean, exportIcsToNewBuffer: boolean,
 *   importStyle: string, importFormat: string | null, importIcalendarToNewBuffer: boolean, importVcardToNewBuffer: boolean,
 *   importPickingHeading: boolean, importCleanMode: boolean,
 *   capturePromptTemplate: any, capturePromptSkipPrePost: boolean, captureOpenedFromExtraMenu: boolean, captureOpenedViaGodMode: boolean,
 *   currentCaptureTemplates: any[], capturePromptValues: any[], captureShared: any, captureClipboard: string,
 *   searchQuery: string, searchUseRegex: boolean, searchUseMatch: boolean, searchOptionsMenuOpen: boolean, activeQueryReplace: any,
 *   agendaViewType: string, agendaAnchorDate: Date, agendaLogMode: boolean, agendaHabitsHidden: boolean, agendaEffortPanelOpen: boolean,
 *   agendaEffortSort: string | null, agendaEffortFilter: any, agendaEffortMax: any,
 *   viewFilter: { tags: string[], todos: string[], categories: string[] }, undoToastTimer: number, taskSort: string,
 *   agendaShowAllDatesOverride: boolean | null, showClockDisplay: boolean, showClocktable: boolean,
 *   clocktableStart: string, clocktableEnd: string, clocktableMaxlevel: number,
 *   weatherData: any, weatherLastRefreshed: string | null,
 *   expandedThemeColorSection: string | null, customThemeColors: Record<string, Record<string, string>>,
 *   radioTargetsCache: { doc: Doc, re: RegExp | null } | null, ancestorIndexCache: WeakMap<Heading, Heading[]> | null,
 *   swRegistration: ServiceWorkerRegistration | null, updateCheckStatus: string | null, currentAppVersion: string | null, appVersionCheckState: string
 * }} AppState */
