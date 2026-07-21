import { openDocument, saveDocument, saveAndSync, markDocumentOpen } from './src/document-store.js';
import { flattenVisibleRows, toggleFold, cycleHeadingTodo, cycleItemCheckbox } from './src/outline-view-model.js';
import { loadFoldState, saveFoldState } from './src/fold-state.js';
import { resolveTodoSequence } from './src/todo-cycle.js';
import { renameHeading, insertTopLevelHeading, insertChildHeading, removeHeading } from './src/heading-edit.js';
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
    persistAndRender();
    return;
  }
  renameHeading(heading, sanitized);
  persistAndRender();
}

function cancelTitleEdit() {
  const heading = editingHeading;
  const isNew = editingIsNew;
  editingHeading = null;
  editingIsNew = false;
  if (isNew) {
    removeHeading(state.doc, heading);
    persistAndRender();
  } else {
    render();
  }
}

async function persistAndRender() {
  await saveDocument({ documentId: state.documentId, doc: state.doc, kvAdapter: kv });
  render();
}

function renderRow(row) {
  if (row.rowType === 'heading') {
    const el = document.createElement('div');
    el.className = 'row';
    el.style.paddingLeft = 8 + row.depth * 16 + 'px';

    const fold = document.createElement('button');
    fold.className = 'fold-btn';
    fold.textContent = row.hasChildren ? (row.node.collapsed ? '\u25b8' : '\u25be') : ' ';
    fold.setAttribute('aria-label', 'Toggle fold');
    fold.onclick = async () => {
      toggleFold(row.node);
      await saveFoldState(state.doc, state.documentId, kv);
      render();
    };
    el.appendChild(fold);

    if (row.node.todo) {
      const seq = resolveTodoSequence(state.doc, GLOBAL_TODO_DEFAULT);
      const badge = document.createElement('span');
      badge.className = 'todo-badge ' + (seq.doneKeywords.includes(row.node.todo) ? 'done' : 'todo');
      badge.textContent = row.node.todo;
      badge.onclick = async () => {
        cycleHeadingTodo(state.doc, row.node, GLOBAL_TODO_DEFAULT);
        await persistAndRender();
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
    }

    return el;
  }

  if (row.rowType === 'list-item') {
    const el = document.createElement('div');
    el.className = 'row';
    el.style.paddingLeft = 8 + row.depth * 16 + 'px';
    if (row.item.checkbox !== null) {
      el.classList.add('checkbox-row');
      el.onclick = async () => {
        const headingNode = findOwningHeadingForItem(row);
        cycleItemCheckbox(headingNode, row.item);
        await persistAndRender();
      };
      const box = document.createElement('span');
      box.textContent = row.item.checkbox === 'X' ? '\u2611' : row.item.checkbox === '-' ? '\u25aa' : '\u2610';
      el.appendChild(box);
    }
    const text = document.createElement('span');
    text.textContent = (row.item.tag ? row.item.tag + ' :: ' : '') + row.item.text;
    el.appendChild(text);
    return el;
  }

  const el = document.createElement('div');
  el.className = 'row';
  el.style.paddingLeft = 8 + row.depth * 16 + 'px';
  el.style.opacity = '0.6';
  el.style.fontStyle = 'italic';
  el.textContent = '[' + row.rowType + ']';
  return el;
}

// Rows don't carry a back-reference to their owning heading (only headings
// and list-items are row types), so checkbox edits look it up by re-walking
// the flattened list. Fine for a v1 shell; a real renderer would thread the
// owning heading through row construction instead of re-deriving it.
function findOwningHeadingForItem(row) {
  const rows = flattenVisibleRows(state.doc);
  const idx = rows.indexOf(row);
  for (let i = idx; i >= 0; i--) {
    if (rows[i].rowType === 'heading') return rows[i].node;
  }
  throw new Error('could not find owning heading for list item');
}

function render() {
  outlineEl.innerHTML = '';
  if (!state.doc) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Open an .org file to get started.';
    outlineEl.appendChild(empty);
    return;
  }
  const rows = flattenVisibleRows(state.doc);
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Empty file \u2014 no headings yet.';
    outlineEl.appendChild(empty);
    return;
  }
  for (const row of rows) outlineEl.appendChild(renderRow(row));

  if (editingHeading) {
    requestAnimationFrame(() => {
      const input = document.getElementById('title-edit-input');
      if (input) {
        input.focus();
        input.select();
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
