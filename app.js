import { openDocument, saveDocument, saveAndSync, markDocumentOpen } from './src/document-store.js';
import { hasPendingChange } from './src/outbox.js';
import { parseOrg, serializeOrg } from './src/org-parser.js';
import { setProperty, deleteProperty, findAncestorPath } from './src/archive-model.js';
import { resolveLinkTarget } from './src/link-resolve.js';
import { parseInline } from './src/inline-markup.js';
import { flattenVisibleRows, toggleFold, cycleHeadingTodo, cycleItemCheckbox } from './src/outline-view-model.js';
import { applyStartupVisibility, cycleFoldLevel } from './src/fold-state.js';
import { parseStartupConfig } from './src/startup-config.js';
import { resolveTodoSequence } from './src/todo-cycle.js';
import { renameHeading, insertTopLevelHeading, insertChildHeading, removeHeading } from './src/heading-edit.js';
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
import { createInputFileAdapter, pickAndImportFile, isFileSystemAccessUnsupported } from './src-browser/input-file-adapter.js';
import {
  getGithubConfig,
  setGithubConfig,
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

/** Which adapter Save/Save-As-in-place should use — whatever storage kind
 *  the currently open document actually came from. This is the crux of
 *  "Save uses whatever mechanism was used to open the file". */
function activeDiskAdapter() {
  if (state.storageKind === 'github') return githubAdapter;
  if (state.storageKind === 'input') return inputFileAdapter;
  return filesystemAdapter;
}

const outlineEl = document.getElementById('outline');
const filenameEl = document.getElementById('filename');
const statusEl = document.getElementById('status');
const addBtn = document.getElementById('addBtn');
const textModeBtn = document.getElementById('textModeBtn');
const fileMenuBtn = document.getElementById('fileMenuBtn');
const fileMenuPanel = document.getElementById('fileMenuPanel');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');

let state = { documentId: null, doc: null, startupConfig: null, storageKind: null };
// File menu: whether the panel is open, and if so, which action's
// backend-choice sub-step is showing (null = the main New/Open/Save/Save
// As list; otherwise 'open' | 'new' | 'saveas').
let fileMenuOpen = false;
let fileMenuStep = null;
let settingsOpen = false;
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
// The single heading or list-item node whose contextual action row is
// currently revealed (tap-to-reveal, per the interaction redesign — only
// one open at a time). Not the same as editingHeading/editingListItem:
// tapping the revealed pencil icon is what transitions into those.
let actionMenuFor = null;
// Whether the whole-document plain-text editor (the "Text" toggle) is
// currently showing instead of the outline. While true, render() shows
// only a textarea; none of the outline's tap-to-edit/reveal-menu state
// applies (and gets cleared when entering/leaving this mode).
let textEditMode = false;

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
  persist().catch((err) => setStatus('Save failed: ' + err.message));
}

function commitAndRender() {
  render();
  persistInBackground();
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
    a.style.color = '#185fa5';
    a.setAttribute(INLINE_LINK_ATTR, '1');
    return a;
  }

  if (resolution.type === 'heading') {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = label;
    a.style.color = '#185fa5';
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
function navigateToHeading(heading) {
  for (const ancestor of findAncestorPath(state.doc, heading) || []) {
    ancestor.collapsed = false;
  }
  render();

  requestAnimationFrame(() => {
    const rows = flattenVisibleRows(state.doc);
    const idx = rows.findIndex((r) => r.rowType === 'heading' && r.node === heading);
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
    const archiveVisibility = state.startupConfig ? state.startupConfig.archiveVisibility : 'archived';
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
function renderActionMenu(actions) {
  const menu = document.createElement('div');
  menu.style.display = 'flex';
  menu.style.flexWrap = 'wrap';
  menu.style.gap = '6px';
  menu.style.padding = '6px 8px 8px 40px';
  menu.style.borderBottom = '0.5px solid #8882';
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.textContent = action.icon;
    btn.setAttribute('aria-label', action.label);
    btn.style.fontSize = '15px';
    btn.style.lineHeight = '1';
    btn.style.padding = '6px 12px';
    btn.style.border = '0.5px solid #8884';
    btn.style.borderRadius = '6px';
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

// Counts every item nested under `item`, at any depth — used to decide
// whether deleting it needs confirming, and to say how much would go with
// it. Mirrors headingHasContent's "empty deletes instantly, content
// prompts" rule rather than confirming on every single-line item deletion,
// which would add friction to the common case (cleaning up a checkbox
// list) for no real safety benefit.
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
  if (count === 0) return true;
  return window.confirm(
    `Delete this item? It has ${count} nested sub-item${count === 1 ? '' : 's'} that will be deleted too. This can't be undone.`
  );
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
      textEditorEl.appendChild(textarea);
    }

    return withActionMenu(el, menuEl, textEditorEl);
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
      if (row.item.tag) {
        text.appendChild(document.createTextNode(row.item.tag + ' :: '));
      }
      renderInlineNodes(row.item.inline, text);
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
        const input = document.createElement('input');
        input.id = 'cell-edit-input';
        input.value = cellText;
        input.style.font = 'inherit';
        input.style.width = Math.max(50, cellText.length * 8) + 'px';
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') {
            e.preventDefault();
            editingCell = null;
            render();
          }
        });
        input.addEventListener('blur', () => {
          const { heading, table, rowIndex: ri, colIndex: ci } = editingCell;
          editingCell = null;
          setTableCell(heading, table, ri, ci, input.value);
          commitAndRender();
        });
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
  wrap.appendChild(tableEl);

  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '4px';
  controls.style.marginTop = '4px';

  const dataRowCount = () => row.node.rows.filter((r) => r.type === 'row').length;
  const colCount = () => {
    const dr = row.node.rows.find((r) => r.type === 'row');
    return dr ? dr.cells.length : 1;
  };

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
    wrap.appendChild(textarea);
    return wrap;
  }

  const p = document.createElement('div');
  p.style.cursor = 'text';
  p.style.whiteSpace = 'pre-wrap';
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
  if (!state.doc) {
    outlineEl.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Open an .org file to get started.';
    outlineEl.appendChild(empty);
    return;
  }

  if (textEditMode) {
    outlineEl.innerHTML = '';
    const textarea = document.createElement('textarea');
    textarea.id = 'document-text-edit-input';
    textarea.value = serializeOrg(state.doc);
    textarea.style.width = '100%';
    textarea.style.boxSizing = 'border-box';
    textarea.style.height = 'calc(100vh - 160px)';
    textarea.style.font = 'ui-monospace, monospace';
    textarea.style.fontSize = '13px';
    textarea.style.padding = '10px';
    textarea.style.border = 'none';
    textarea.spellcheck = false;
    outlineEl.appendChild(textarea);
    requestAnimationFrame(() => textarea.focus());
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

  if (editingHeading || editingCell || editingParagraph || editingListItem || editingHeadingText) {
    requestAnimationFrame(() => {
      const input =
        document.getElementById('title-edit-input') ||
        document.getElementById('cell-edit-input') ||
        document.getElementById('listitem-edit-input') ||
        document.getElementById('heading-text-edit-input') ||
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
  if (kind === 'input') return 'Imported';
  return 'Local';
}

/** Common finish-up after any successful open/create, regardless of which
 *  backend it came from. */
async function afterDocumentLoaded(documentId, doc, storageKind) {
  const startupConfig = parseStartupConfig(doc);
  applyStartupVisibility(doc, startupConfig);
  state = { documentId, doc, startupConfig, storageKind };
  filenameEl.textContent = documentId + ' (' + storageKindLabel(storageKind) + ')';
  textEditMode = false;
  textModeBtn.textContent = 'Text';
  addBtn.disabled = false;
  textModeBtn.disabled = false;
  closeFileMenu();
  render();
}

// ---- Open --------------------------------------------------------------

async function openFromFilesystem() {
  if (!isFileSystemAccessSupported()) {
    setStatus('This browser lacks File System Access support.');
    return;
  }
  try {
    const documentId = await pickAndRegisterFile(kv);
    // openDocument prefers disk over the cache — but that would also
    // silently discard any local edit that was made and never synced.
    // That's a real, separate risk worth a deliberate check.
    if (await hasPendingChange(kv, documentId)) {
      const proceed = window.confirm(
        `"${documentId}" has local changes that were never saved. ` +
          'Opening it now will load the current file and discard those unsaved changes. Continue?'
      );
      if (!proceed) {
        setStatus('Open cancelled \u2014 unsaved local changes were kept.');
        return;
      }
    }
    await markDocumentOpen(kv, documentId);
    const { doc } = await openDocument({ documentId, kvAdapter: kv, diskAdapter: filesystemAdapter });
    await afterDocumentLoaded(documentId, doc, 'filesystem');
    setStatus('Opened.');
  } catch (err) {
    if (err.name !== 'AbortError') setStatus('Could not open file: ' + err.message);
  }
}

async function openFromImport() {
  try {
    const { fileId } = await pickAndImportFile(kv);
    await markDocumentOpen(kv, fileId);
    const { doc } = await openDocument({ documentId: fileId, kvAdapter: kv, diskAdapter: inputFileAdapter });
    await afterDocumentLoaded(fileId, doc, 'input');
    setStatus('Imported. Use Save to download your changes \u2014 there\u2019s no live link back to the original file on this platform.');
  } catch (err) {
    setStatus('Could not import file: ' + err.message);
  }
}

async function openFromGithub() {
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
    setStatus('Loading from GitHub\u2026');
    await markDocumentOpen(kv, path);
    const { doc, source } = await openDocument({ documentId: path, kvAdapter: kv, diskAdapter: githubAdapter });
    await afterDocumentLoaded(path, doc, 'github');
    setStatus(
      source === 'new'
        ? `"${path}" doesn't exist in the repo yet \u2014 opened as a new empty file.`
        : 'Opened from GitHub.'
    );
  } catch (err) {
    setStatus('Could not open from GitHub: ' + err.message);
  }
}

// ---- New ---------------------------------------------------------------

async function newOnFilesystem() {
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
    await saveAndSync({ documentId, doc, kvAdapter: kv, diskAdapter: filesystemAdapter });
    setStatus('Created.');
  } catch (err) {
    if (err.name !== 'AbortError') setStatus('Could not create file: ' + err.message);
  }
}

async function newOnGithub() {
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

async function newViaImport() {
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
      applyStartupVisibility(state.doc, state.startupConfig);
      render();
    }
    setStatus('Saved (' + result.status + ').');
  } catch (err) {
    setStatus('Save failed: ' + err.message);
  }
  closeFileMenu();
}

async function saveAsFilesystem() {
  if (!state.doc) return;
  if (!isFileSystemAccessSupported()) {
    setStatus('This browser lacks File System Access support.');
    return;
  }
  try {
    const documentId = await pickAndRegisterNewFile(kv, state.documentId || 'untitled.org');
    state.documentId = documentId;
    state.storageKind = 'filesystem';
    await markDocumentOpen(kv, documentId);
    filenameEl.textContent = documentId + ' (Local)';
    await saveAndSync({ documentId, doc: state.doc, kvAdapter: kv, diskAdapter: filesystemAdapter });
    setStatus('Saved as ' + documentId + '.');
    closeFileMenu();
    render();
  } catch (err) {
    if (err.name !== 'AbortError') setStatus('Save As failed: ' + err.message);
  }
}

async function saveAsGithub() {
  if (!state.doc) return;
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
    filenameEl.textContent = path + ' (GitHub)';
    await saveAndSync({ documentId: path, doc: state.doc, kvAdapter: kv, diskAdapter: githubAdapter });
    setStatus('Saved to GitHub as ' + path + '.');
    closeFileMenu();
    render();
  } catch (err) {
    setStatus('Save As failed: ' + err.message);
  }
}

async function saveAsImport() {
  if (!state.doc) return;
  const name = window.prompt('File name to save as:', state.documentId || 'untitled.org');
  if (!name) return;
  state.documentId = name;
  state.storageKind = 'input';
  try {
    await markDocumentOpen(kv, name);
    filenameEl.textContent = name + ' (Imported)';
    await saveAndSync({ documentId: name, doc: state.doc, kvAdapter: kv, diskAdapter: inputFileAdapter });
    setStatus('Downloaded as ' + name + '.');
    closeFileMenu();
    render();
  } catch (err) {
    setStatus('Save As failed: ' + err.message);
  }
}

// ---- File menu UI -------------------------------------------------------

function menuButton(label, onClick, disabled) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.disabled = !!disabled;
  btn.onclick = onClick;
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
    renderSettingsPanel();
  }
  renderFileMenu();
});

addBtn.addEventListener('click', () => {
  if (!state.doc) return;
  const heading = insertTopLevelHeading(state.doc, {});
  startEditingTitle(heading, true);
});

textModeBtn.addEventListener('click', () => {
  if (!state.doc) return;

  if (!textEditMode) {
    // Entering text mode: nothing should be mid-edit in the outline while
    // it's not even shown.
    editingHeading = null;
    editingIsNew = false;
    editingCell = null;
    editingParagraph = null;
    editingListItem = null;
    editingHeadingText = null;
    actionMenuFor = null;
    textEditMode = true;
    textModeBtn.textContent = 'Outline';
    render();
    return;
  }

  // Exiting text mode: the textarea's current text is the new source of
  // truth for the whole document — reparse it fresh, exactly the way
  // opening a file does, so #+STARTUP/#+TODO changes (and any structural
  // edits made by hand) actually take effect rather than being merged
  // against the old in-memory doc.
  const textarea = document.getElementById('document-text-edit-input');
  const newText = textarea ? textarea.value : serializeOrg(state.doc);
  const newDoc = parseOrg(newText);
  const startupConfig = parseStartupConfig(newDoc);
  applyStartupVisibility(newDoc, startupConfig);

  state.doc = newDoc;
  state.startupConfig = startupConfig;
  textEditMode = false;
  textModeBtn.textContent = 'Text';
  commitAndRender();
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
  } else {
    document.documentElement.removeAttribute('data-theme'); // 'system' — let prefers-color-scheme decide
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

async function renderSettingsPanel() {
  settingsPanel.innerHTML = '';
  if (!settingsOpen) {
    settingsPanel.style.display = 'none';
    return;
  }
  settingsPanel.style.display = 'block';

  const config = await getGithubConfig(kv);
  const theme = await getTheme(kv);
  const fontFamily = await getFontFamily(kv);
  const fontSize = await getFontSize(kv);

  const ghTitle = document.createElement('div');
  ghTitle.className = 'panel-section-title';
  ghTitle.textContent = 'GitHub';
  settingsPanel.appendChild(ghTitle);

  const tokenField = labeledInput('Personal access token', 'password', config.token);
  const ownerField = labeledInput('Owner', 'text', config.owner);
  const repoField = labeledInput('Repo', 'text', config.repo);
  const branchField = labeledInput('Branch', 'text', config.branch);

  const ghRow1 = document.createElement('div');
  ghRow1.className = 'panel-row';
  ghRow1.appendChild(tokenField.wrap);
  settingsPanel.appendChild(ghRow1);

  const ghRow2 = document.createElement('div');
  ghRow2.className = 'panel-row';
  ghRow2.appendChild(ownerField.wrap);
  ghRow2.appendChild(repoField.wrap);
  ghRow2.appendChild(branchField.wrap);
  settingsPanel.appendChild(ghRow2);

  const ghHint = document.createElement('div');
  ghHint.style.fontSize = '11px';
  ghHint.style.opacity = '0.6';
  ghHint.style.margin = '2px 0 6px';
  ghHint.textContent =
    'Use a fine-grained token scoped to just this repo, with Contents read/write access only.';
  settingsPanel.appendChild(ghHint);

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
  settingsPanel.appendChild(ghSaveRow);

  const themeTitle = document.createElement('div');
  themeTitle.className = 'panel-section-title';
  themeTitle.textContent = 'Appearance';
  settingsPanel.appendChild(themeTitle);

  const themeRow = document.createElement('div');
  themeRow.className = 'panel-row';
  for (const opt of ['system', 'light', 'dark']) {
    const btn = menuButton(opt[0].toUpperCase() + opt.slice(1), async () => {
      await setTheme(kv, opt);
      applyTheme(opt);
      renderSettingsPanel();
    });
    if (opt === theme) btn.style.fontWeight = '700';
    themeRow.appendChild(btn);
  }
  settingsPanel.appendChild(themeRow);

  const fontTitle = document.createElement('div');
  fontTitle.className = 'panel-section-title';
  fontTitle.textContent = 'Font';
  settingsPanel.appendChild(fontTitle);

  const fontRow = document.createElement('div');
  fontRow.className = 'panel-row';
  for (const opt of ['system', 'serif', 'monospace']) {
    const btn = menuButton(opt[0].toUpperCase() + opt.slice(1), async () => {
      await setFontFamily(kv, opt);
      applyFontFamily(opt);
      renderSettingsPanel();
    });
    if (opt === fontFamily) btn.style.fontWeight = '700';
    fontRow.appendChild(btn);
  }
  settingsPanel.appendChild(fontRow);

  const sizeRow = document.createElement('div');
  sizeRow.className = 'panel-row';
  sizeRow.appendChild(
    menuButton('\u2212', async () => {
      const next = Math.max(12, fontSize - 1);
      await setFontSize(kv, next);
      applyFontSize(next);
      renderSettingsPanel();
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
      renderSettingsPanel();
    })
  );
  settingsPanel.appendChild(sizeRow);
}

settingsBtn.addEventListener('click', async () => {
  settingsOpen = !settingsOpen;
  if (settingsOpen && fileMenuOpen) {
    fileMenuOpen = false;
    fileMenuStep = null;
    renderFileMenu();
  }
  await renderSettingsPanel();
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
  applyTheme(await getTheme(kv));
  applyFontFamily(await getFontFamily(kv));
  applyFontSize(await getFontSize(kv));
  render();
}

bootstrap();
