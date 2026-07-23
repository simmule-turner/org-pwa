import { openDocument, saveDocument, saveAndSync, markDocumentOpen } from './src/document-store.js';
import { hasPendingChange } from './src/outbox.js';
import { parseOrg, serializeOrg } from './src/org-parser.js';
import {
  setProperty,
  deleteProperty,
  findAncestorPath,
  getPropertiesText,
  setPropertiesFromText,
} from './src/archive-model.js';
import { resolveLinkTarget } from './src/link-resolve.js';
import { parseInline } from './src/inline-markup.js';
import { flattenVisibleRows, toggleFold, cycleHeadingTodo, cycleItemCheckbox } from './src/outline-view-model.js';
import { updateCheckboxCookiesUpward } from './src/checkbox-cookie.js';
import { searchDocument } from './src/search.js';
import { applyStartupVisibility, cycleFoldLevel } from './src/fold-state.js';
import { parseStartupConfig } from './src/startup-config.js';
import {
  parseLocalVariables,
  getAgendaStartOnWeekday,
  getCycleOpenArchivedTrees,
} from './src/local-variables.js';
import { resolveTodoSequence } from './src/todo-cycle.js';
import { buildAgendaItems, dayView, weekView, monthView, startOfDay, endOfDay, startOfWeek, parseRepeater } from './src/agenda.js';
import { parseOrgTimestamp, formatOrgTimestamp, parseDelay } from './src/org-timestamp.js';
import {
  renameHeading,
  parseTagsInput,
  setHeadingTags,
  getPlainTimestampInTitle,
  setPlainTimestampInTitle,
  insertTopLevelHeading,
  insertChildHeading,
  removeHeading,
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
import { createInputFileAdapter, pickAndImportFile, isFileSystemAccessUnsupported } from './src-browser/input-file-adapter.js';
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
} from './src-browser/settings.js';

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

/** Which adapter Save/Save-As-in-place should use — whatever storage kind
 *  the currently open document actually came from. This is the crux of
 *  "Save uses whatever mechanism was used to open the file". */
function activeDiskAdapter() {
  if (state.storageKind === 'github') return githubAdapter;
  if (state.storageKind === 'webdav') return webdavAdapter;
  if (state.storageKind === 'input') return inputFileAdapter;
  return filesystemAdapter;
}

const outlineEl = document.getElementById('outline');
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
// Reacts to ANY change to topBar's rendered content (a panel opening/
// closing, its content changing, search results growing/shrinking) —
// deliberately not a list of "call this after every place that could
// change topBar," which would be one missed call site away from drifting
// out of sync again.
new MutationObserver(syncContentOffset).observe(topBarEl, { childList: true, subtree: true, attributes: true });

let state = { documentId: null, doc: null, startupConfig: null, storageKind: null, localVariables: null };
// File menu: whether the panel is open, and if so, which action's
// backend-choice sub-step is showing (null = the main New/Open/Save/Save
// As list; otherwise 'open' | 'new' | 'saveas').
let fileMenuOpen = false;
let fileMenuStep = null;
let settingsOpen = false;
let searchOpen = false;
let searchQuery = '';
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
// The single heading whose property drawer is currently being edited as
// one text block (key: value per line), or null. Same pattern as
// editingHeadingText, reused rather than building a separate per-row
// property UI.
let editingProperties = null;
// The single heading whose SCHEDULED/DEADLINE is currently being edited
// as one text block, or null. Same pattern as editingProperties — a
// minimal timestamp editor (full CRUD with repeaters, a date picker,
// etc. is still to come).
let editingPlanning = null;
// The single heading or list-item node whose contextual action row is
// currently revealed (tap-to-reveal, per the interaction redesign — only
// one open at a time). Not the same as editingHeading/editingListItem:
// tapping the revealed pencil icon is what transitions into those.
let actionMenuFor = null;
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
    commitAndRender();
    return;
  }
  renameHeading(heading, sanitized);
  commitAndRender();
}

function cancelTitleEdit() {
  const heading = editingHeading;
  const isNew = editingIsNew;
  editingHeading = null;
  editingIsNew = false;
  if (isNew) {
    removeHeading(state.doc, heading);
    commitAndRender();
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

function commitAndRender() {
  render();
  persistInBackground();
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
  return true;
}

// Marks every link/image-produced DOM element so container click handlers
// (checkbox-cycle on a list-item row, edit-on-click on a paragraph) can
// detect "this click landed on a link, don't also trigger my own handler"
// via a single e.target.closest('[data-inline-link]') check, rather than
// each link type needing its own stopPropagation wiring.
const INLINE_LINK_ATTR = 'data-inline-link';

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
  // Either inline images are off (#+STARTUP: noinlineimages, the default —
  // "just the link information will be displayed") or this is a
  // local/relative path that can't be resolved to pixels here anyway
  // (would need a registered File System Access directory handle and path
  // resolution this app doesn't have). Either way: a labeled link/placeholder,
  // not a broken image icon or silently dropped content.
  const span = document.createElement('span');
  span.textContent = '[image: ' + node.target + ']';
  span.style.color = 'var(--text-muted, #888)';
  span.style.fontStyle = 'italic';
  return span;
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
    const span = document.createElement('span');
    span.textContent = label;
    span.style.color = 'var(--text-muted, #888)';
    span.style.textDecoration = 'underline dotted';
    span.style.cursor = 'pointer';
    span.setAttribute(INLINE_LINK_ATTR, '1');
    span.onclick = (e) => {
      e.stopPropagation();
      setStatus("Can't open local file links yet: " + resolution.path);
    };
    return span;
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
function navigateToHeading(heading, { revealOwnBody = false, targetNode = heading } = {}) {
  for (const ancestor of findAncestorPath(state.doc, heading) || []) {
    ancestor.collapsed = false;
  }
  if (revealOwnBody) {
    heading.collapsed = false;
    heading.bodyHidden = false;
  }
  render();

  requestAnimationFrame(() => {
    const rows = flattenVisibleRows(state.doc);
    const idx = rows.findIndex((r) => (r.rowType === 'list-item' ? r.item === targetNode : r.node === targetNode));
    if (idx === -1 || !outlineEl.children[idx]) return;
    const el = outlineEl.children[idx];
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const original = el.style.backgroundColor;
    el.style.transition = 'background-color 0.6s';
    el.style.backgroundColor = 'rgba(24,95,165,0.15)';
    setTimeout(() => {
      el.style.backgroundColor = original;
    }, 1200);
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
  return (heading.children && heading.children.length > 0) || (heading.body && heading.body.length > 0);
}

function confirmHeadingDelete(heading) {
  if (!headingHasContent(heading)) return true;
  const parts = [];
  if (heading.children.length) {
    parts.push(`${heading.children.length} sub-heading${heading.children.length === 1 ? '' : 's'}`);
  }
  if (heading.body.length) parts.push('notes/lists/tables');
  const title = heading.title || '(untitled)';
  return window.confirm(
    `Delete "${title}"? It contains ${parts.join(' and ')}, which will be deleted too. This can't be undone.`
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

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  textInputStyle(dateInput);
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

function renderActionMenu(actions) {
  const menu = document.createElement('div');
  menu.style.display = 'flex';
  menu.style.flexWrap = 'wrap';
  menu.style.gap = '8px';
  menu.style.padding = '8px 8px 10px 40px';
  menu.style.borderBottom = '0.5px solid #8882';
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.textContent = action.icon;
    btn.setAttribute('aria-label', action.label);
    btn.style.fontSize = '20px';
    btn.style.lineHeight = '1';
    btn.style.width = '44px';
    btn.style.height = '44px';
    btn.style.padding = '0';
    btn.style.border = '0.5px solid #8884';
    btn.style.borderRadius = '10px';
    btn.style.background = 'none';
    btn.onclick = action.onClick;
    menu.appendChild(btn);
  }
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
  return window.confirm("Delete this table and all its data? This can't be undone.");
}

function paragraphHasContent(paragraph) {
  return paragraph.lines.some((l) => l.trim() !== '');
}

function confirmParagraphDelete(paragraph) {
  if (!paragraphHasContent(paragraph)) return true;
  return window.confirm("Delete this note? This can't be undone.");
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
      `Delete this item? It has ${count} nested sub-item${count === 1 ? '' : 's'} that will be deleted too. This can't be undone.`
    );
  }
  return window.confirm("Delete this item? This can't be undone.");
}

function renderRow(row, todoSequence) {
  if (row.rowType === 'heading') {
    const el = document.createElement('div');
    el.className = 'row';
    el.style.paddingLeft = 8 + row.depth * 16 + 'px';
    el.style.alignItems = 'flex-start';
    el.style.touchAction = 'pan-y';
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
        commitAndRender();
      };
      el.appendChild(badge);
    }

    let menuEl = null;

    if (state.doc && editingHeading === row.node) {
      const input = document.createElement('input');
      input.className = 'title-input';
      input.id = 'title-edit-input';
      input.type = 'text';
      input.value = row.node.title;
      input.placeholder = 'Heading title';
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelTitleEdit();
        }
      });
      input.addEventListener('blur', () => commitTitleEdit(input.value));
      el.appendChild(input);
    } else {
      const title = document.createElement('span');
      title.className = 'heading-title';
      if (row.node.title) {
        renderInlineNodes(parseInline(row.node.title), title);
      } else {
        title.textContent = '(untitled)';
        title.style.opacity = '0.5';
      }
      title.onclick = (e) => {
        if (e.target.closest('[data-inline-link]')) return;
        actionMenuFor = actionMenuFor === row.node ? null : row.node;
        render();
      };
      el.appendChild(title);

      for (const tag of row.node.tags) {
        const t = document.createElement('span');
        t.className = 'tag';
        t.textContent = tag;
        el.appendChild(t);
      }

      if (actionMenuFor === row.node) {
        menuEl = renderActionMenu([
          {
            icon: '\u270e',
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
            icon: '\u229e',
            label: 'Add table',
            onClick: () => {
              actionMenuFor = null;
              insertTable(row.node, {});
              commitAndRender();
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
            icon: '#',
            label: row.node.properties.CUSTOM_ID
              ? 'Edit link ID (' + row.node.properties.CUSTOM_ID + ')'
              : 'Set link ID',
            onClick: () => {
              actionMenuFor = null;
              const current = row.node.properties.CUSTOM_ID || '';
              const next = window.prompt(
                'Custom ID for linking to this heading with [[#id]] (stays stable if you rename the heading). Leave blank to remove.',
                current
              );
              if (next === null) {
                render();
                return;
              }
              const trimmed = next.trim();
              if (trimmed === '') {
                deleteProperty(row.node, 'CUSTOM_ID');
              } else {
                setProperty(row.node, 'CUSTOM_ID', trimmed);
              }
              commitAndRender();
            },
          },
          {
            icon: '\ud83c\udff7\ufe0f',
            label: row.node.tags.length ? 'Edit tags (' + row.node.tags.join(', ') + ')' : 'Add tags',
            onClick: () => {
              actionMenuFor = null;
              const next = window.prompt(
                'Tags for this heading, separated by spaces (e.g. "urgent home01"). Leave blank to remove all.',
                row.node.tags.join(' ')
              );
              if (next === null) {
                render();
                return;
              }
              setHeadingTags(row.node, parseTagsInput(next));
              commitAndRender();
            },
          },
          {
            icon: '\u25a4',
            label: row.node.propertyOrder.length ? 'Edit properties' : 'Add properties',
            onClick: () => {
              actionMenuFor = null;
              editingProperties = row.node;
              render();
            },
          },
          {
            icon: '\ud83d\udcc5',
            label:
              row.node.planning.scheduled || row.node.planning.deadline
                ? 'Edit scheduled/deadline'
                : 'Add scheduled/deadline',
            onClick: () => {
              actionMenuFor = null;
              editingPlanning = row.node;
              render();
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
              editingProperties = null;
              editingPlanning = null;
              removeHeading(state.doc, row.node);
              commitAndRender();
            },
          },
        ]);
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
        commitAndRender();
      });
      autoGrowTextarea(textarea);
      textEditorEl.appendChild(textarea);
    }

    let propertiesEditorEl = null;
    if (editingProperties === row.node) {
      propertiesEditorEl = document.createElement('div');
      propertiesEditorEl.style.padding = '4px 10px 10px 40px';
      const textarea = document.createElement('textarea');
      textarea.id = 'properties-edit-input';
      textarea.value = getPropertiesText(row.node);
      textarea.rows = Math.max(2, textarea.value.split('\n').length);
      textarea.placeholder = 'key: value, one property per line';
      textarea.style.width = '100%';
      textarea.style.boxSizing = 'border-box';
      textarea.style.font = 'inherit';
      textarea.style.fontSize = '14px';
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          editingProperties = null;
          render();
        }
      });
      textarea.addEventListener('blur', () => {
        const heading = editingProperties;
        editingProperties = null;
        setPropertiesFromText(heading, textarea.value);
        commitAndRender();
      });
      autoGrowTextarea(textarea);
      propertiesEditorEl.appendChild(textarea);
    }

    let planningEditorEl = null;
    if (editingPlanning === row.node) {
      planningEditorEl = document.createElement('div');
      planningEditorEl.style.padding = '8px 10px 10px 40px';

      const scheduledGroup = buildTimestampFieldGroup('SCHEDULED', row.node.planning.scheduled);
      const deadlineGroup = buildTimestampFieldGroup('DEADLINE', row.node.planning.deadline);
      const plainGroup = buildTimestampFieldGroup(
        'Plain timestamp (not scheduled/deadline)',
        getPlainTimestampInTitle(row.node)
      );
      planningEditorEl.appendChild(scheduledGroup.container);
      planningEditorEl.appendChild(deadlineGroup.container);
      planningEditorEl.appendChild(plainGroup.container);

      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex';
      btnRow.style.gap = '10px';
      btnRow.appendChild(
        wizardButton('Save', () => {
          const heading = editingPlanning;
          editingPlanning = null;
          heading.planning = {
            scheduled: scheduledGroup.getRawValue(),
            deadline: deadlineGroup.getRawValue(),
            closed: heading.planning.closed,
          };
          setPlainTimestampInTitle(heading, plainGroup.getRawValue());
          commitAndRender();
        })
      );
      btnRow.appendChild(
        wizardButton('Cancel', () => {
          editingPlanning = null;
          render();
        })
      );
      planningEditorEl.appendChild(btnRow);
    }

    return withActionMenu(el, menuEl, textEditorEl, propertiesEditorEl, planningEditorEl);
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
        commitAndRender();
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
      const input = document.createElement('input');
      input.id = 'listitem-edit-input';
      input.type = 'text';
      input.value = row.item.text;
      input.style.flex = '1 1 auto';
      input.style.minWidth = '0';
      input.style.font = 'inherit';
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
          e.preventDefault();
          editingListItem = null;
          render();
        }
      });
      input.addEventListener('blur', () => {
        const { heading, item } = editingListItem;
        editingListItem = null;
        editListItemText(heading, item, input.value);
        commitAndRender();
      });
      el.appendChild(input);
    } else {
      const text = document.createElement('span');
      const hasContent = row.item.text.trim() !== '' || (row.item.tag && row.item.tag.trim() !== '');
      if (hasContent) {
        if (row.item.tag) {
          text.appendChild(document.createTextNode(row.item.tag + ' :: '));
        }
        renderInlineNodes(row.item.inline, text);
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
        actionMenuFor = actionMenuFor === row.item ? null : row.item;
        render();
      };
      el.appendChild(text);

      if (actionMenuFor === row.item) {
        menuEl = renderActionMenu([
          {
            icon: '\u270e',
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
              commitAndRender();
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
              commitAndRender();
            },
          },
        ]);
      }
    }

    return withActionMenu(el, menuEl);
  }

  if (row.rowType === 'table') return renderTableRow(row);
  if (row.rowType === 'paragraph') return renderParagraphRow(row);

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
  label.textContent = '\u229e Table';
  label.style.fontSize = '11px';
  label.style.color = 'var(--text-muted, #888)';
  label.style.cursor = 'pointer';
  label.style.padding = '2px 0 4px';
  label.onclick = () => {
    actionMenuFor = actionMenuFor === row.node ? null : row.node;
    render();
  };
  wrap.appendChild(label);

  let menuEl = null;
  if (actionMenuFor === row.node) {
    menuEl = renderActionMenu([
      {
        icon: '\u2715',
        label: 'Delete table',
        onClick: () => {
          if (!confirmTableDelete(row.node)) return;
          actionMenuFor = null;
          deleteTable(row.heading, row.node);
          commitAndRender();
        },
      },
    ]);
    menuEl.style.padding = '0 0 8px';
  }

  const tableEl = document.createElement('table');
  tableEl.style.borderCollapse = 'collapse';
  tableEl.style.fontSize = '13px';

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
          commitAndRender();
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
      commitAndRender();
    })
  );
  controls.appendChild(
    smallButton('\u2212 row', 'Delete last row', () => {
      if (dataRowCount() <= 1) {
        setStatus("Can't delete the last row.");
        return;
      }
      if (lastDataRowHasContent() && !window.confirm("Delete the last row? It has data in it. This can't be undone.")) {
        return;
      }
      deleteTableRow(row.heading, row.node, row.node.rows.length - 1);
      commitAndRender();
    })
  );
  controls.appendChild(
    smallButton('+ col', 'Add column', () => {
      insertTableColumn(row.heading, row.node, colCount() - 1);
      commitAndRender();
    })
  );
  controls.appendChild(
    smallButton('\u2212 col', 'Delete last column', () => {
      if (colCount() <= 1) {
        setStatus("Can't delete the last column.");
        return;
      }
      if (lastColumnHasContent() && !window.confirm("Delete the last column? It has data in it. This can't be undone.")) {
        return;
      }
      deleteTableColumn(row.heading, row.node, colCount() - 1);
      commitAndRender();
    })
  );
  wrap.appendChild(controls);

  return withActionMenu(wrap, menuEl);
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
      commitAndRender();
    });
    autoGrowTextarea(textarea);
    wrap.appendChild(textarea);
    return wrap;
  }

  const p = document.createElement('div');
  p.style.cursor = 'text';
  p.style.whiteSpace = 'pre-wrap';
  p.style.overflowWrap = 'anywhere';
  p.style.fontSize = '14px';
  const hasContent = row.node.lines.some((l) => l.trim() !== '');
  if (hasContent) {
    row.node.inlineLines.forEach((lineNodes, i) => {
      if (i > 0) p.appendChild(document.createElement('br'));
      renderInlineNodes(lineNodes, p);
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
    actionMenuFor = actionMenuFor === row.node ? null : row.node;
    render();
  };
  wrap.appendChild(p);

  let menuEl = null;
  if (actionMenuFor === row.node) {
    menuEl = renderActionMenu([
      {
        icon: '\u270e',
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
          commitAndRender();
        },
      },
      {
        icon: '\u2715',
        label: 'Delete note',
        onClick: () => {
          if (!confirmParagraphDelete(row.node)) return;
          actionMenuFor = null;
          deleteParagraph(row.heading, row.node);
          commitAndRender();
        },
      },
    ]);
  }

  return withActionMenu(wrap, menuEl);
}

function render() {
  updateFilenameDisplay();

  if (settingsOpen) return; // renderSettingsView() owns #outline while settings is showing

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
    textarea.value = serializeOrg(state.doc);
    textarea.style.width = '100%';
    textarea.style.boxSizing = 'border-box';
    textarea.style.height = VH_UNIT === 'dvh' ? 'calc(100dvh - 160px)' : 'calc(100vh - 160px)';
    textarea.style.font = 'ui-monospace, monospace';
    textarea.style.fontSize = '13px';
    textarea.style.padding = '10px';
    textarea.style.border = 'none';
    textarea.spellcheck = false;
    outlineEl.appendChild(textarea);
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
    editingProperties ||
    editingPlanning
  ) {
    requestAnimationFrame(() => {
      const input =
        document.getElementById('title-edit-input') ||
        document.getElementById('cell-edit-input') ||
        document.getElementById('listitem-edit-input') ||
        document.getElementById('heading-text-edit-input') ||
        document.getElementById('properties-edit-input') ||
        document.getElementById('paragraph-edit-input');
      if (input) {
        input.focus();
        if (typeof input.select === 'function') input.select();
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
    return;
  }
  filenameEl.textContent =
    state.documentId + ' (' + storageKindLabel(state.storageKind) + ')' + (isDirty ? ' \u2022 modified' : '');
}

/** Common finish-up after any successful open/create, regardless of which
 *  backend it came from. */
async function afterDocumentLoaded(documentId, doc, storageKind) {
  const startupConfig = parseStartupConfig(doc);
  const localVariables = parseLocalVariables(serializeOrg(doc));
  const archiveVisibility = getCycleOpenArchivedTrees(localVariables) ? 'noarchived' : 'archived';
  applyStartupVisibility(doc, startupConfig, archiveVisibility);
  state = { documentId, doc, startupConfig, storageKind, localVariables };
  isDirty = false; // freshly loaded — matches whatever was just read, nothing unsaved yet
  currentView = 'org';
  agendaAnchorDate = new Date();
  addBtn.disabled = false;
  viewMenuBtn.disabled = false;
  searchBtn.disabled = false;
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

async function openFromGithub() {
  if (commitTextModeIfActive()) render();
  const config = await getGithubConfig(kv);
  githubConfig = config;
  if (!isGithubConfigured(config)) {
    setStatus('GitHub is not set up yet \u2014 open Settings first.');
    closeFileMenu();
    return;
  }
  const path = window.prompt(`Path of the file in ${config.owner}/${config.repo} (e.g. notes.org):`);
  if (!path) return;
  try {
    const { preferCache } = await resolvePendingChangeChoice(path);
    setStatus('Loading from GitHub\u2026');
    await markDocumentOpen(kv, path);
    const { doc, source } = await openDocument({
      documentId: path,
      kvAdapter: kv,
      diskAdapter: githubAdapter,
      preferCache,
    });
    await afterDocumentLoaded(path, doc, 'github');
    if (preferCache) {
      isDirty = true;
      render();
    }
    setStatus(
      preferCache
        ? 'Resumed your unsaved local version \u2014 remember to Save it.'
        : source === 'new'
          ? `"${path}" doesn't exist in the repo yet \u2014 opened as a new empty file.`
          : 'Opened from GitHub.'
    );
  } catch (err) {
    setStatus('Could not open from GitHub: ' + err.message);
  }
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
  const path = window.prompt('Path of the file on the WebDAV server (e.g. notes.org):');
  if (!path) return;
  try {
    const { preferCache } = await resolvePendingChangeChoice(path);
    setStatus('Loading from WebDAV\u2026');
    await markDocumentOpen(kv, path);
    const { doc, source } = await openDocument({
      documentId: path,
      kvAdapter: kv,
      diskAdapter: webdavAdapter,
      preferCache,
    });
    await afterDocumentLoaded(path, doc, 'webdav');
    if (preferCache) {
      isDirty = true;
      render();
    }
    setStatus(
      preferCache
        ? 'Resumed your unsaved local version \u2014 remember to Save it.'
        : source === 'new'
          ? `"${path}" doesn't exist on the server yet \u2014 opened as a new empty file.`
          : 'Opened from WebDAV.'
    );
  } catch (err) {
    setStatus('Could not open from WebDAV: ' + err.message);
  }
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
        'Save As\u2026',
        () => {
          fileMenuStep = 'saveas';
          renderFileMenu();
        },
        !state.doc
      )
    );
    fileMenuPanel.appendChild(row);
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

  btnRow.appendChild(
    menuButton('Cancel', () => {
      fileMenuStep = null;
      renderFileMenu();
    })
  );

  fileMenuPanel.appendChild(btnRow);
}

fileMenuBtn.addEventListener('click', () => {
  fileMenuOpen = !fileMenuOpen;
  fileMenuStep = null;
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
  renderFileMenu();
});

addBtn.addEventListener('click', () => {
  if (!state.doc) return;
  settingsOpen = false;
  const heading = insertTopLevelHeading(state.doc, {});
  startEditingTitle(heading, true);
});

/** Switches between the three top-level views, handling the
 *  enter/exit bookkeeping each transition needs: leaving 'text' commits
 *  its content into state.doc first (the fix from a previous bug — never
 *  read a stale doc); leaving 'org' clears outline edit state, since
 *  nothing should be mid-edit while the outline isn't even shown. */
function switchToView(view) {
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
    editingProperties = null;
    editingPlanning = null;
    actionMenuFor = null;
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
  container.appendChild(controls);

  const { start, end } = agendaRangeFor(agendaViewType, agendaAnchorDate);
  const rangeLabel = document.createElement('div');
  rangeLabel.style.fontSize = '12px';
  rangeLabel.style.opacity = '0.65';
  rangeLabel.style.marginBottom = '8px';
  rangeLabel.textContent = formatAgendaRangeLabel(agendaViewType, start, end);
  container.appendChild(rangeLabel);

  // Completed items excluded, using this file's own #+TODO: sequence
  // (not a hardcoded "DONE" check) — and the range is passed through so
  // any repeating SCHEDULED/DEADLINE timestamp expands into every
  // occurrence that actually falls within what's being displayed.
  const todoSequence = resolveTodoSequence(state.doc, GLOBAL_TODO_DEFAULT);
  const items = buildAgendaItems([{ documentId: state.documentId, doc: state.doc }], {
    todoFilter: (todo) => !todoSequence.doneKeywords.includes(todo),
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
      kindIcon.textContent = item.kind === 'deadline' ? '\u26a0' : item.kind === 'timestamp' ? '\ud83d\udcc5' : '\u23f0';
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

viewMenuBtn.addEventListener('click', () => {
  if (!state.doc) return;
  viewMenuOpen = !viewMenuOpen;
  if (viewMenuOpen && fileMenuOpen) {
    fileMenuOpen = false;
    fileMenuStep = null;
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
  renderViewMenu();
});

// ---- Settings UI --------------------------------------------------------

function labeledInput(labelText, type, value) {
  const wrap = document.createElement('div');
  wrap.className = 'panel-field';
  const labelEl = document.createElement('label');
  labelEl.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.value = value || '';
  wrap.appendChild(labelEl);
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

async function renderSettingsView() {
  outlineEl.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'panel';
  container.style.minHeight = '100%';
  outlineEl.appendChild(container);

  const config = await getGithubConfig(kv);
  const webdavConfigStored = await getWebdavConfig(kv);
  const theme = await getTheme(kv);
  const fontFamily = await getFontFamily(kv);
  const fontSize = await getFontSize(kv);

  const ghTitle = document.createElement('div');
  ghTitle.className = 'panel-section-title';
  ghTitle.textContent = 'GitHub';
  container.appendChild(ghTitle);

  const tokenField = labeledInput('Personal access token', 'password', config.token);
  const ownerField = labeledInput('Owner', 'text', config.owner);
  const repoField = labeledInput('Repo', 'text', config.repo);
  const branchField = labeledInput('Branch', 'text', config.branch);

  const ghRow1 = document.createElement('div');
  ghRow1.className = 'panel-row';
  ghRow1.appendChild(tokenField.wrap);
  container.appendChild(ghRow1);

  const ghRow2 = document.createElement('div');
  ghRow2.className = 'panel-row';
  ghRow2.appendChild(ownerField.wrap);
  ghRow2.appendChild(repoField.wrap);
  ghRow2.appendChild(branchField.wrap);
  container.appendChild(ghRow2);

  const ghHint = document.createElement('div');
  ghHint.style.fontSize = '11px';
  ghHint.style.opacity = '0.6';
  ghHint.style.margin = '2px 0 6px';
  ghHint.textContent =
    'Use a fine-grained token scoped to just this repo, with Contents read/write access only.';
  container.appendChild(ghHint);

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
  container.appendChild(ghSaveRow);

  const webdavTitle = document.createElement('div');
  webdavTitle.className = 'panel-section-title';
  webdavTitle.textContent = 'WebDAV';
  container.appendChild(webdavTitle);

  const webdavUrlField = labeledInput('Server URL', 'text', webdavConfigStored.baseUrl);
  const webdavUserField = labeledInput('Username', 'text', webdavConfigStored.username);
  const webdavPassField = labeledInput('Password', 'password', webdavConfigStored.password);

  const webdavRow1 = document.createElement('div');
  webdavRow1.className = 'panel-row';
  webdavRow1.appendChild(webdavUrlField.wrap);
  container.appendChild(webdavRow1);

  const webdavRow2 = document.createElement('div');
  webdavRow2.className = 'panel-row';
  webdavRow2.appendChild(webdavUserField.wrap);
  webdavRow2.appendChild(webdavPassField.wrap);
  container.appendChild(webdavRow2);

  const webdavHint = document.createElement('div');
  webdavHint.style.fontSize = '11px';
  webdavHint.style.opacity = '0.6';
  webdavHint.style.margin = '2px 0 6px';
  webdavHint.textContent =
    'Use an app-specific password if your server supports one, not your main account password. ' +
    'Most WebDAV servers need CORS explicitly enabled to accept requests from this app \u2014 ' +
    'if Open/Save fails with a network error, that\u2019s the first thing to check on the server side.';
  container.appendChild(webdavHint);

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
  container.appendChild(webdavSaveRow);

  const themeTitle = document.createElement('div');
  themeTitle.className = 'panel-section-title';
  themeTitle.textContent = 'Appearance';
  container.appendChild(themeTitle);

  const themeRow = document.createElement('div');
  themeRow.className = 'panel-row';
  for (const opt of ['system', 'light', 'dark']) {
    const btn = menuButton(opt[0].toUpperCase() + opt.slice(1), async () => {
      await setTheme(kv, opt);
      applyTheme(opt);
      renderSettingsView();
    });
    if (opt === theme) btn.style.fontWeight = '700';
    themeRow.appendChild(btn);
  }
  container.appendChild(themeRow);

  const fontTitle = document.createElement('div');
  fontTitle.className = 'panel-section-title';
  fontTitle.textContent = 'Font';
  container.appendChild(fontTitle);

  const fontRow = document.createElement('div');
  fontRow.className = 'panel-row';
  for (const opt of ['system', 'serif', 'monospace']) {
    const btn = menuButton(opt[0].toUpperCase() + opt.slice(1), async () => {
      await setFontFamily(kv, opt);
      applyFontFamily(opt);
      renderSettingsView();
    });
    if (opt === fontFamily) btn.style.fontWeight = '700';
    fontRow.appendChild(btn);
  }
  container.appendChild(fontRow);

  const sizeRow = document.createElement('div');
  sizeRow.className = 'panel-row';
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
  sizeLabel.style.fontSize = '13px';
  sizeLabel.style.padding = '0 6px';
  sizeRow.appendChild(sizeLabel);
  sizeRow.appendChild(
    menuButton('+', async () => {
      const next = Math.min(28, fontSize + 1);
      await setFontSize(kv, next);
      applyFontSize(next);
      renderSettingsView();
    })
  );
  container.appendChild(sizeRow);
}

settingsBtn.addEventListener('click', async () => {
  settingsOpen = !settingsOpen;
  if (settingsOpen && fileMenuOpen) {
    fileMenuOpen = false;
    fileMenuStep = null;
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
  if (settingsOpen) {
    await renderSettingsView();
  } else {
    render(); // restores whatever currentView was showing before settings opened
  }
});

// ---- Search UI -----------------------------------------------------------

const SEARCH_TYPE_ICON = {
  heading: '\u25c9',
  paragraph: '\u00b6',
  'list-item': '\u2022',
  table: '\u229e',
  block: '\u2318',
};

function renderSearchPanel() {
  searchPanel.innerHTML = '';
  if (!searchOpen) {
    searchPanel.style.display = 'none';
    return;
  }
  searchPanel.style.display = 'block';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'search-query-input';
  input.placeholder = 'Search this file\u2026';
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
  input.addEventListener('input', () => {
    searchQuery = input.value;
    renderSearchResults();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      searchOpen = false;
      searchQuery = '';
      renderSearchPanel();
    }
  });
  searchPanel.appendChild(input);

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

  const results = searchDocument(state.doc, searchQuery);
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
  if (searchOpen && fileMenuOpen) {
    fileMenuOpen = false;
    fileMenuStep = null;
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
  if (!searchOpen) searchQuery = '';
  renderSearchPanel();
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
  applyTheme(await getTheme(kv));
  applyFontFamily(await getFontFamily(kv));
  applyFontSize(await getFontSize(kv));
  syncContentOffset();
  render();
}

bootstrap();
