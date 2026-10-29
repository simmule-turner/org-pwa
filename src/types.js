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
 *   titleTail?: string,
 *   tagsTail?: string,
 *   tags: string[],
 *   planning: { scheduled: string | null, deadline: string | null, closed: string | null, order?: string[] },
 *   properties: Record<string, string>,
 *   propertyOrder: string[],
 *   logbookLines: string[],
 *   preLogLines?: string[],
 *   bodyLines: string[],
 *   collapsed: boolean,
 *   bodyHidden: boolean,
 *   children: Heading[],
 *   body: BodyNode[],
 *   raw?: HeadingRaw,
 *   drawersHidden?: boolean | null,
 *   plotVisible?: Set<number> | null,
 * }} Heading
 */

/** The original lines above a heading's body, kept so an unedited heading is written back exactly as it was read.
 * @typedef {{ header: string, headerSig: string, planning: string | null, planningSig: string | null, drawers: { type: 'properties' | 'logbook' | 'prelog', lines: string[] }[], propertyLines: Record<string, { line: string, value: string }>, propsSig: string, logSig: string }} HeadingRaw */

/** @typedef {{ key: string, value: string, [k: string]: any }} Keyword */

/**
 * A parsed document: the keywords and body lines before the first heading, then the top-level headings.
 * @typedef {{ type: string, keywords: Keyword[], bodyLines: string[], body?: BodyNode[], children: Heading[], [key: string]: any }} Doc
 */

/** The key-value store behind the document cache and settings: one value per string key. */
/** @typedef {{ get(key: string): Promise<any>, set(key: string, value: any): Promise<any>, delete(key: string): Promise<any> }} KvAdapter */

/** The file-local variables of a document (`# -*- ... -*-` and `Local Variables:`), by name. */
/** @typedef {Record<string, any>} LocalVars */

/**
 * One node of parsed inline markup (see inline-markup.js).
 * @typedef {{ type: 'text' | 'comment' | 'code' | 'verbatim', value: string }} TextNode
 * @typedef {{ type: 'bold' | 'italic' | 'underline' | 'strikethrough', children: InlineNode[] }} EmphasisNode
 * @typedef {{ type: 'subscript' | 'superscript', value: string, raw?: string }} ScriptNode
 * @typedef {{ type: 'link', target: string, description: string | null, radio?: boolean }} LinkNode
 * @typedef {{ type: 'image', target: string }} ImageNode
 * @typedef {{ type: 'target' | 'radio-target', name: string, value: string }} TargetNode
 * @typedef {{ type: 'footnote-ref', label: string }} FootnoteRefNode
 * @typedef {{ type: 'footnote-def', label: string | null, children: InlineNode[] }} FootnoteDefNode
 * @typedef {{ type: 'latex', source: string, displayMode: boolean, raw?: string }} LatexNode
 * @typedef {TextNode | EmphasisNode | ScriptNode | LinkNode | ImageNode | TargetNode | FootnoteRefNode | FootnoteDefNode | LatexNode | import('./cite.js').CitationNode} InlineNode
 */

/** The agenda-notification settings (appt.js normalizes them). @typedef {ReturnType<typeof import('./appt.js').normalizeApptSettings>} ApptSettings */

/** One entry of the command palette. @typedef {{ id: string, label: string, orgName?: string, keys?: string, group?: string, keywords?: string[], needs?: string[], run: (target?: object | null) => any, [k: string]: any }} PaletteCommand */

/** A capture template (org-capture-templates entry). @typedef {{ key?: string, description?: string, type: string, olp?: string[], template: string, emptyLines?: number, emptyLinesBefore?: number, emptyLinesAfter?: number, tableLinePos?: string, tableHeader?: boolean, prepend?: boolean, omitEmptyEntries?: boolean, preText?: string, postText?: string, [k: string]: any }} CaptureTemplate */

/**
 * One line of a table: a data row, or a horizontal rule (`type: 'rule'`, which has no cells).
 * @typedef {{ type: 'row', cells: string[], cellsInline?: InlineNode[][] }} DataRow
 * @typedef {{ type: 'rule' }} RuleRow
 * @typedef {DataRow | RuleRow} TableRow
 */

/**
 * The body of a heading, as body-parser.js reads it. Each node says where it starts (`lineIndex`) and how many lines it spans
 * (`lineCount`) in the heading's `bodyLines`, which is what edits are written back to.
 * @typedef {{ type: 'paragraph', lines: string[], extractedLines: string[], inlineLines: InlineNode[][], footnoteLabel: string | null, lineIndex: number, lineCount: number }} Paragraph
 * @typedef {{ type: 'list-item', indent: number, marker: string, ordered: boolean, checkbox: string | null, startValue: number | null, tag: string | null, text: string, inline: InlineNode[], children: List[], lineIndex: number }} ListItem
 * @typedef {{ type: 'list', items: ListItem[] }} List
 * @typedef {{ type: 'table', rows: TableRow[], tblfm: string | null, lineIndex: number, lineCount: number, plot?: string, blankBeforeTblfm?: number, name?: string }} Table
 * @typedef {{ type: 'block', name: string, params: string, lines: string[], lineIndex: number, lineCount: number }} Block
 * @typedef {{ type: 'hr', lineIndex?: number, lineCount?: number }} Hr
 * @typedef {Paragraph | List | Table | Block | Hr} BodyNode
 */

/**
 * One row of the outline as outline-view-model.js flattens it: a heading, or one piece of a heading's body.
 * @typedef {{ rowType: 'heading', key: string, node: Heading, depth: number, hasChildren: boolean }} HeadingRow
 * @typedef {{ rowType: 'list-item', key: string, item: ListItem, depth: number, heading: Heading, displayNumber: number | null }} ListItemRow
 * @typedef {{ rowType: 'paragraph', key: string, node: Paragraph, depth: number, heading: Heading }} ParagraphRow
 * @typedef {{ rowType: 'table', key: string, node: Table, depth: number, heading: Heading }} TableBodyRow
 * @typedef {{ rowType: 'block', key: string, node: Block, depth: number, heading: Heading }} BlockRow
 * @typedef {{ rowType: 'hr', key: string, node: Hr, depth: number, heading: Heading }} HrRow
 * @typedef {ListItemRow | ParagraphRow | TableBodyRow | BlockRow | HrRow} BodyRow
 * @typedef {HeadingRow | BodyRow} OutlineRow
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

/** @typedef {{ heading: Heading, fromTodo: string | null, toTodo: string | null, timestamp: string, kind: 'state' | 'done' }} PendingLogNote */
/** @typedef {{ heading: Heading, mode: string, loading: boolean, candidates: any[], errors: any[], recent: any[], selected: any, query: string }} PendingRefile */
/** @typedef {{ heading: Heading, table: Table, rowIndex: number, colIndex: number }} EditingCell */
/** @typedef {{ heading: Heading, paragraph: Paragraph }} EditingParagraph */
/** @typedef {{ heading: Heading, item: ListItem }} EditingListItem */
/** @typedef {{ startLine: number, lineCount: number }} NarrowedTextRange */
/** @typedef {{ matched: Set<Heading>, visible: Set<Heading> }} SparseNarrowScope */
/** @typedef {{ chord: string, label: string }} GodLastCommand */
/** @typedef {{ view: string, documentId: string, storageKind: string | null, scrollTop: number, [key: string]: any }} BackStackEntry */

/**
 * The app's shared mutable state (`S` in app-state.js). Every property is listed here, so a misspelt or wrongly typed
 * use is a compile error. Properties a tab keeps for itself are also in TabSession (tabs.js's snapshot).
 * @typedef {{
 *   state: DocState, documentSessions: TabSession[], activeTabId: number | null, nextTabId: number,
 *   isDirty: boolean, isBufferReadOnly: boolean, lastSavedText: string | null, history: import('./undo-history.js').UndoHistory, historyOpen: boolean,
 *   historyDiffExpandedIndex: number | null, historyRenderTarget: HTMLElement, settingsRenderTarget: HTMLElement,
 *   currentView: string, navigationBackStack: BackStackEntry[], lastGlobalFoldState: string,
 *   editingHeading: Heading | null, editingIsNew: boolean, editingCell: EditingCell | null,
 *   editingParagraph: EditingParagraph | null, editingListItem: EditingListItem | null,
 *   editingHeadingText: Heading | null, editingGeneral: Heading | null, actionMenuFor: object | null,
 *   keyboardFocusedHeading: Heading | null, keyboardFocusedBodyRow: BodyRow | null, keyboardFocusedCellPos: { rowIndex: number, colIndex: number } | null,
 *   pendingCursorPosition: string | number | null, currentContextHeading: Heading | null,
 *   narrowedHeading: Heading | null, narrowedTextModeRange: NarrowedTextRange | null, sparseNarrowScope: SparseNarrowScope | null,
 *   narrowStateRestoreAttemptedFor: string | null, sparseNarrowRestoreAttemptedFor: string | null,
 *   godModeActive: boolean, godModeState: GodState, godModeRedoArmed: boolean, godModeLastCommand: GodLastCommand | null,
 *   godModeHintsEl: HTMLElement | null, godModeChordIndex: { complete: Set<string>, under: Map<string, number> } | null, godModeInputFedLength: number, godModeRecentKeydown: { key: string, at: number } | null,
 *   floatingKeyboardOpen: boolean, floatingKeyboardShiftArmed: boolean, floatingKeyboardMinimized: boolean, textKeyboardHidden: boolean, textGMode: string,
 *   floatingKeyboardPos: { left: number | null, bottom: number } | null, floatingKeyboardSettleTimer: number | null,
 *   pendingLogNote: PendingLogNote | null, pendingRefile: PendingRefile | null,
 *   pendingAttachFileList: { heading: Heading, filenames: string[], action: string } | null,
 *   pendingTodoWorkflowChoice: { heading: Heading, viaGodMode: boolean } | null,
 *   pendingAudioRecording: { heading: Heading } | null, mediaRecorder: MediaRecorder | null, recordedChunks: Blob[],
 *   recordingStartedAt: number | null, recordedBlobUrl: string | null,
 *   calendarOpen: boolean, calendarViewYear: number, calendarViewMonth: number,
 *   githubConfig: GithubConfig, webdavConfig: WebdavConfig, caldavConfig: CaldavConfig,
 *   calendarSyncRunning: boolean, calendarSyncQueued: boolean, calendarSyncPaused: boolean, calendarSyncTimer: number | null, calendarSyncLastError: string | null,
 *   contactsSyncRunning: boolean, contactsSyncQueued: boolean, contactsSyncPaused: boolean, contactsSyncTimer: number | null, contactsSyncLastError: string | null,
 *   apptSettings: ApptSettings | null, apptModeLine: string | null, viewportBaseline: { width: number, height: number } | null,
 *   captureShortcutsResult: { ok: true, sent: number, reply: string | null } | { ok: false, error: string } | null, attachmentsFolder: string | null,
 *   agendaFilesConfig: string[], globalVariablesText: string, globalVariables: Record<string, any>, agendaFilesCacheLoadedFor: string | null,
 *   contactsFilesConfig: string[], searchExtraFilesConfig: string[], searchExtraFilesCacheLoadedFor: string | null, contactsFilesCacheLoadedFor: string | null,
 *   externalChangeCheckInFlight: boolean, externalChangeDismissedHash: string | null, externalChangeShownForHash: string | null,
 *   paletteRecentIds: string[] | null,
 *   fileMenuOpen: boolean, moreMenuStep: string | null, fileScreen: any, settingsOpen: boolean, searchOpen: boolean,
 *   confirmDialogOpen: boolean, captureOpen: boolean, extraMenuOpen: boolean, moreOpen: boolean, viewMenuOpen: boolean,
 *   timestampPickerOpen: boolean, textFieldPopupOpen: boolean, buttonChoiceModalOpen: boolean,
 *   exportFormat: string | null, exportPickingHeading: boolean, vcardStyle: string, exportVcardToNewBuffer: boolean,
 *   exportIcsAsFile: boolean, exportIcsToNewBuffer: boolean,
 *   importStyle: string, importFormat: string | null, importIcalendarToNewBuffer: boolean, importVcardToNewBuffer: boolean,
 *   importPickingHeading: boolean, importCleanMode: boolean,
 *   capturePromptTemplate: CaptureTemplate | null, capturePromptSkipPrePost: boolean, captureOpenedFromExtraMenu: boolean, captureOpenedViaGodMode: boolean,
 *   currentCaptureTemplates: CaptureTemplate[], capturePromptValues: string[], captureShared: any, captureClipboard: string,
 *   textLanding: { startLine: number, endLine: number, lineText: string, source: string } | null,
 *   searchQuery: string, searchUseRegex: boolean, searchUseMatch: boolean, searchOptionsMenuOpen: boolean, activeQueryReplace: any,
 *   agendaViewType: string, agendaAnchorDate: Date, agendaLogMode: boolean, agendaHabitsHidden: boolean, agendaEffortPanelOpen: boolean,
 *   agendaEffortSort: string | null, agendaEffortFilter: { op: string, minutes: number | null, text: string } | null, agendaEffortMax: { minutes: number | null, text: string } | null,
 *   viewFilter: import('./agenda-filter.js').ViewFilter, agendaSeedSignature?: string, undoToastTimer: number, taskSort: string, taskKeywords?: string | null, queryView?: { kind: 'tags' | 'search', query: string, todoOnly: boolean, sortingStrategy: string | null, title: string, focusInput?: boolean },
 *   agendaShowAllDatesOverride: boolean | null, showClockDisplay: boolean, showClocktable: boolean,
 *   clocktableStart: string, clocktableEnd: string, clocktableMaxlevel: number, clocktableParams: string,
 *   weatherData: Record<string, any> | null, weatherLastRefreshed: string | null,
 *   expandedThemeColorSection: string | null, customThemeColors: Record<string, Record<string, string>>,
 *   radioTargetsCache: { doc: Doc, re: RegExp | null } | null, ancestorIndexCache: WeakMap<Heading, Heading[]> | null, fileTagsIndexCache?: WeakMap<Heading, string[]> | null,
 *   swRegistration: ServiceWorkerRegistration | null, updateCheckStatus: string | null, currentAppVersion: string | null, appVersionCheckState: string
 * }} AppState */
