import { openDocument, saveDocument, saveAndSync, markDocumentOpen } from './src/document-store.js';
import { flattenVisibleRows, toggleFold, cycleHeadingTodo, cycleItemCheckbox } from './src/outline-view-model.js';
import { loadFoldState, saveFoldState } from './src/fold-state.js';
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
  insertParagraph,
  deleteListItem,
} from './src/body-edit.js';
import { createIndexedDbAdapter } from './src-browser/indexeddb-adapter.js';
import {
  createFileSystemAccessAdapter,
  pickAndRegisterFile,
  isFileSystemAccessSupported,
} from './src-browser/filesystem-adapter.js';

const GLOBAL_TODO_DEFAULT = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };

const kv = createIndexedDbAdapter();
const disk = createFileSystemAccessAdapter(kv);

const outlineEl = document.getElementById('outline');
const filenameEl = document.getElementById('filename');
const statusEl = document.getElementById('status');
const openBtn = document.getElementById('openBtn');
const saveBtn = document.getElementById('saveBtn');
const addBtn = document.getElementById('addBtn');

let state = { documentId: null, doc: null };
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

function renderRow(row, todoSequence) {
  if (row.rowType === 'heading') {
    const el = document.createElement('div');
    el.className = 'row';
    el.style.paddingLeft = 8 + row.depth * 16 + 'px';

    const fold = document.createElement('button');
    fold.className = 'fold-btn';
    fold.textContent = row.hasChildren ? (row.node.collapsed ? '\u25b8' : '\u25be') : ' ';
    fold.setAttribute('aria-label', 'Toggle fold');
    fold.onclick = () => {
      toggleFold(row.node);
      render();
      saveFoldState(state.doc, state.documentId, kv).catch((err) =>
        setStatus('Save failed: ' + err.message)
      );
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
      title.textContent = row.node.title || '(untitled)';
      title.onclick = () => startEditingTitle(row.node, false);
      el.appendChild(title);

      for (const tag of row.node.tags) {
        const t = document.createElement('span');
        t.className = 'tag';
        t.textContent = tag;
        el.appendChild(t);
      }

      const addChild = document.createElement('button');
      addChild.className = 'add-child-btn';
      addChild.textContent = '+';
      addChild.setAttribute('aria-label', 'Add sub-heading');
      addChild.onclick = () => {
        const child = insertChildHeading(row.node, {});
        startEditingTitle(child, true);
      };
      el.appendChild(addChild);

      const addTable = document.createElement('button');
      addTable.className = 'add-child-btn';
      addTable.style.marginLeft = '2px';
      addTable.textContent = '\u229e';
      addTable.setAttribute('aria-label', 'Add table');
      addTable.onclick = () => {
        insertTable(row.node, {});
        commitAndRender();
      };
      el.appendChild(addTable);

      const addNote = document.createElement('button');
      addNote.className = 'add-child-btn';
      addNote.style.marginLeft = '2px';
      addNote.textContent = '\u00b6';
      addNote.setAttribute('aria-label', 'Add note');
      addNote.onclick = () => {
        const paragraph = insertParagraph(row.node, '');
        editingParagraph = { heading: row.node, paragraph };
        render();
        persistInBackground();
      };
      el.appendChild(addNote);

      const deleteHeadingBtn = document.createElement('button');
      deleteHeadingBtn.className = 'add-child-btn';
      deleteHeadingBtn.style.marginLeft = 'auto';
      deleteHeadingBtn.style.color = '#c0392b';
      deleteHeadingBtn.textContent = '\u2715';
      deleteHeadingBtn.setAttribute('aria-label', 'Delete heading');
      deleteHeadingBtn.onclick = () => {
        if (!confirmHeadingDelete(row.node)) return;
        // Deleting a heading can remove whatever's currently mid-edit
        // inside it; clear all edit state unconditionally rather than try
        // to prove none of it pointed into the deleted subtree.
        editingHeading = null;
        editingIsNew = false;
        editingCell = null;
        editingParagraph = null;
        removeHeading(state.doc, row.node);
        commitAndRender();
      };
      el.appendChild(deleteHeadingBtn);
    }

    return el;
  }

  if (row.rowType === 'list-item') {
    const el = document.createElement('div');
    el.className = 'row';
    el.style.paddingLeft = 8 + row.depth * 16 + 'px';
    if (row.item.checkbox !== null) {
      el.classList.add('checkbox-row');
      el.onclick = () => {
        cycleItemCheckbox(row.heading, row.item);
        commitAndRender();
      };
      const box = document.createElement('span');
      box.textContent = row.item.checkbox === 'X' ? '\u2611' : row.item.checkbox === '-' ? '\u25aa' : '\u2610';
      el.appendChild(box);
    }
    const text = document.createElement('span');
    text.textContent = (row.item.tag ? row.item.tag + ' :: ' : '') + row.item.text;
    text.style.flex = '1 1 auto';
    text.style.minWidth = '0';
    text.style.overflow = 'hidden';
    text.style.textOverflow = 'ellipsis';
    text.style.whiteSpace = 'nowrap';
    el.appendChild(text);

    const deleteItemBtn = document.createElement('button');
    deleteItemBtn.style.flexShrink = '0';
    deleteItemBtn.style.marginLeft = 'auto';
    deleteItemBtn.style.opacity = '0.4';
    deleteItemBtn.style.border = 'none';
    deleteItemBtn.style.background = 'none';
    deleteItemBtn.style.fontSize = '13px';
    deleteItemBtn.style.padding = '2px 8px';
    deleteItemBtn.style.color = '#c0392b';
    deleteItemBtn.textContent = '\u2715';
    deleteItemBtn.setAttribute('aria-label', 'Delete item');
    deleteItemBtn.onclick = (e) => {
      e.stopPropagation();
      deleteListItem(row.heading, row.item);
      commitAndRender();
    };
    el.appendChild(deleteItemBtn);

    return el;
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
      commitAndRender();
    });
    wrap.appendChild(textarea);
  } else {
    const p = document.createElement('div');
    p.style.cursor = 'text';
    p.style.whiteSpace = 'pre-wrap';
    p.style.fontSize = '14px';
    p.textContent = row.node.lines.join('\n') || '(empty note \u2014 tap to edit)';
    if (!row.node.lines.join('\n')) p.style.opacity = '0.5';
    p.onclick = () => {
      editingParagraph = { heading: row.heading, paragraph: row.node };
      render();
    };
    wrap.appendChild(p);
  }

  return wrap;
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
  // computeIds: false — this render loop reads row.node/row.item/row.heading
  // object references directly, never row.id, so skip the full
  // buildFoldIndex tree-walk-plus-hash that computing ids would otherwise
  // cost on every single render (i.e. every tap).
  const rows = flattenVisibleRows(state.doc, { computeIds: false });
  if (rows.length === 0) {
    outlineEl.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Empty file \u2014 no headings yet.';
    outlineEl.appendChild(empty);
    return;
  }

  const todoSequence = resolveTodoSequence(state.doc, GLOBAL_TODO_DEFAULT);

  // Build the new row elements off-DOM (a DocumentFragment has no layout
  // box, so appending into it triggers no reflow), then swap the whole
  // thing into the live container in one operation, instead of clearing
  // outlineEl and appendChild-ing each row directly onto an already
  // on-screen, already-laid-out element.
  const fragment = document.createDocumentFragment();
  for (const row of rows) fragment.appendChild(renderRow(row, todoSequence));
  outlineEl.innerHTML = '';
  outlineEl.appendChild(fragment);

  if (editingHeading || editingCell || editingParagraph) {
    requestAnimationFrame(() => {
      const input =
        document.getElementById('title-edit-input') ||
        document.getElementById('cell-edit-input') ||
        document.getElementById('paragraph-edit-input');
      if (input) {
        input.focus();
        if (typeof input.select === 'function') input.select();
      }
    });
  }
}

openBtn.addEventListener('click', async () => {
  if (!isFileSystemAccessSupported()) {
    setStatus('This browser lacks File System Access support \u2014 Chrome/Edge required for v1.');
    return;
  }
  try {
    const documentId = await pickAndRegisterFile(kv);
    await markDocumentOpen(kv, documentId);
    const { doc } = await openDocument({ documentId, kvAdapter: kv, diskAdapter: disk });
    await loadFoldState(doc, documentId, kv);
    state = { documentId, doc };
    filenameEl.textContent = documentId;
    saveBtn.disabled = false;
    addBtn.disabled = false;
    setStatus('Opened.');
    render();
  } catch (err) {
    if (err.name !== 'AbortError') setStatus('Could not open file: ' + err.message);
  }
});

addBtn.addEventListener('click', () => {
  if (!state.doc) return;
  const heading = insertTopLevelHeading(state.doc, {});
  startEditingTitle(heading, true);
});

saveBtn.addEventListener('click', async () => {
  if (!state.documentId) return;
  setStatus('Saving\u2026');
  try {
    const result = await saveAndSync({
      documentId: state.documentId,
      doc: state.doc,
      kvAdapter: kv,
      diskAdapter: disk,
      resolveConflict: async () => {
        // v1 conflict UI: a plain confirm dialog, per the "simple, no
        // diff/merge view" storage decision. A real UI would replace only
        // this callback \u2014 everything else stays the same.
        const keepMine = window.confirm(
          'This file changed on disk since you last synced.\n\nOK = keep your version (overwrite disk)\nCancel = keep the disk version (discard your local edit)'
        );
        return keepMine ? 'mine' : 'disk';
      },
    });
    if (result.status === 'conflict' && result.resolution === 'disk') {
      const reopened = await openDocument({ documentId: state.documentId, kvAdapter: kv, diskAdapter: disk });
      state.doc = reopened.doc;
      await loadFoldState(state.doc, state.documentId, kv);
      render();
    }
    setStatus('Saved (' + result.status + ').');
  } catch (err) {
    setStatus('Save failed: ' + err.message);
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
