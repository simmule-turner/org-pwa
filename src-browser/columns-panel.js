// @ts-check
// Column view (org-columns, C-c C-x C-c): a table of the headings of the file, or of the subtree the cursor is in, with a column for
// each entry of the format. Tap a cell to edit it, change the allowed value, or change the column. The engine is src/org-columns.js.
import { getCategoryForDocument } from '../src/agenda.js';
import { getAllowedValues } from '../src/effort-values.js';
import { lispStringValue } from '../src/export-defaults.js';
import { getGlobalProperties, getPropertyInheritance, getUseTagInheritance } from '../src/local-variables.js';
import { ColumnView, DEFAULT_COLUMNS_FORMAT, compileColumnsFormat, storeColumnsFormat, uncompileColumnsFormat } from '../src/org-columns.js';
import { deleteProperty, setProperty } from '../src/archive-model.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';
import { S } from './app-state.js';
import { openActionSheet } from './bottom-sheet.js';
import { GLOBAL_TODO_DEFAULT } from './constants.js';
import { openTextFieldPopup } from './dialogs.js';
import { commitAndRender, openHeadingTitleEditor, setStatus } from './editing.js';
import { findPaletteCommandByOrgName, runPaletteCommand } from './god-mode-palette.js';
import { openEffortEditor } from './heading-commands.js';
import { setKeyboardFocusToHeading } from './keyboard-focus.js';
import { render } from './render.js';

/** @typedef {import('../src/types.js').Heading} Heading */

/** @type {HTMLElement | null} */

/** The settings of the open file that column view reads. @returns {import('../src/org-columns.js').ColumnsContext} */
export function columnsContext() {
  const vars = S.state.localVariables;
  const ellipses = lispStringValue((vars || {})['org-columns-ellipses']);
  return {
    category: getCategoryForDocument(S.state.doc, S.state.documentId || ''),
    file: S.state.documentId || undefined,
    tagInheritance: getUseTagInheritance(vars),
    propertyInheritance: getPropertyInheritance(vars),
    doneKeywords: resolveTodoSequence(S.state.doc, GLOBAL_TODO_DEFAULT).doneKeywords,
    defaultFormat: lispStringValue((vars || {})['org-columns-default-format']) ?? DEFAULT_COLUMNS_FORMAT,
    ellipses: ellipses ?? '..',
  };
}

/** C-c C-x C-c: column view of the subtree the cursor is in (the file, from before its first heading); with `global` (C-u), of the whole file. @param {boolean} [global] */
export function openColumnsPanel(global = false) {
  const doc = S.state.doc;
  if (!doc) return;
  const focus = S.keyboardFocusedHeading;
  S.columnsOpen = { global, anchor: focus ? flatIndex(focus) : -1, format: null };
  renderColumnsPanel();
}

/** @param {Heading} heading */
function flatIndex(heading) {
  const view = new ColumnView(S.state.doc, {});
  return view.entries.findIndex((e) => e.heading === heading);
}

export function closeColumnsPanel() {
  S.columnsOpen = null;
  renderColumnsPanel();
}

/** Builds the view for the state kept in S.columnsOpen. */
function buildView() {
  const state = /** @type {NonNullable<typeof S.columnsOpen>} */ (S.columnsOpen);
  const view = new ColumnView(S.state.doc, columnsContext());
  const at = state.anchor >= 0 ? view.entries[state.anchor] || null : null;
  view.prepare({ at, global: state.global, format: state.format, update: !state.inhibit });
  state.inhibit = false; // only the view right after moving, widening or deleting a column writes no summary into the properties (org-columns-inhibit-recalculation)
  return view;
}

/** Cuts a value to the column's width with the ellipsis `org-columns-ellipses`, as Emacs does. @param {string} value @param {number | null} width @param {string} ellipses */
function ellipsize(value, width, ellipses) {
  if (width === null || value.length <= width) return value;
  if (width <= ellipses.length) return ellipses.slice(0, width);
  return value.slice(0, width - ellipses.length) + ellipses;
}

export function renderColumnsPanel() {
  if (S.columnsOverlay) {
    S.columnsOverlay.remove();
    S.columnsOverlay = null;
  }
  if (!S.columnsOpen) return;
  let view;
  try {
    view = buildView();
  } catch (e) {
    S.columnsOpen = null;
    setStatus(String(/** @type {Error} */ (e).message));
    render();
    return;
  }
  if (view.updated) commitAndRender('Column summaries');
  const ctx = columnsContext();
  S.columnsOverlay = document.createElement('div');
  S.columnsOverlay.className = 'ui-overlay';
  S.columnsOverlay.setAttribute('data-columns-panel', '');
  const box = document.createElement('div');
  box.className = 'panel ui-container ui-tall';
  box.style.cssText = 'padding:0;max-width:100%;';
  S.columnsOverlay.appendChild(box);

  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border);flex:0 0 auto;';
  const title = document.createElement('strong');
  title.textContent = S.columnsOpen.global || !view.top ? 'Column view: whole file' : `Column view: ${view.top.heading.title}`;
  title.style.cssText = 'flex:1 1 12em;min-width:0;overflow-wrap:anywhere;';
  bar.appendChild(title);
  for (const [label, run] of /** @type {[string, () => void][]} */ ([
    ...(S.columnsOpen.anchor >= 0 ? /** @type {[string, () => void][]} */ ([[S.columnsOpen.global ? 'This subtree' : 'Whole file', () => {
      const state = /** @type {NonNullable<typeof S.columnsOpen>} */ (S.columnsOpen);
      state.global = !state.global;
      state.format = null;
      renderColumnsPanel();
    }]]) : []),
    ['Refresh', () => renderColumnsPanel()],
    ['Format', () => editFormat(view)],
    ['Close', () => closeColumnsPanel()],
  ])) bar.appendChild(barButton(label, run));
  box.appendChild(bar);

  const scroll = document.createElement('div');
  scroll.style.cssText = 'overflow:auto;flex:1 1 auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;';
  const table = document.createElement('table');
  table.setAttribute('data-columns-table', '');
  table.style.cssText = 'border-collapse:collapse;font-size:13px;min-width:100%;';
  const head = table.createTHead().insertRow();
  view.specs.forEach((spec, i) => {
    const th = document.createElement('th');
    th.textContent = spec.title;
    th.style.cssText = 'position:sticky;top:0;background:var(--modal-bg);text-align:left;padding:6px 8px;border-bottom:2px solid var(--border-strong);white-space:nowrap;' + widthStyle(spec.width);
    th.onclick = () => columnSheet(view, i);
    head.appendChild(th);
  });
  const body = table.createTBody();
  for (const entry of view.viewEntries()) {
    const row = body.insertRow();
    row.setAttribute('data-columns-row', String(entry.index));
    view.cells(entry).forEach((cell, i) => {
      const td = row.insertCell();
      td.textContent = ellipsize(cell.spec.prop === 'ITEM' ? `${'*'.repeat(view.stars(entry))} ${cell.displayed}` : cell.displayed, view.specs[i].width, ctx.ellipses ?? '..');
      td.style.cssText = 'padding:8px;border-bottom:1px solid var(--border);vertical-align:top;white-space:pre;cursor:pointer;' + widthStyle(view.specs[i].width);
      if (cell.spec.prop === 'ITEM') td.style.fontWeight = '600';
      td.onclick = () => cellSheet(view, entry.heading, i);
    });
  }
  scroll.appendChild(table);
  box.appendChild(scroll);
  S.columnsOverlay.addEventListener('click', (e) => {
    if (e.target === S.columnsOverlay) closeColumnsPanel();
  });
  document.body.appendChild(S.columnsOverlay);
}

/** @param {number | null} width */
const widthStyle = (width) => (width === null ? '' : `min-width:${width}ch;max-width:${width}ch;overflow:hidden;`);

/** @param {string} label @param {() => void} onClick */
function barButton(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'min-height:var(--target);padding:0 14px;';
  b.onclick = onClick;
  return b;
}

/** `org-columns-store-format`, then the view again; `inhibit` leaves the summaries as they are (`org-columns-inhibit-recalculation`).
 * @param {ColumnView} view @param {import('../src/org-columns.js').ColumnSpec[]} specs @param {boolean} [inhibit] */
function storeFormat(view, specs, inhibit = false) {
  const format = uncompileColumnsFormat(specs);
  storeColumnsFormat(S.state.doc, view.top ? view.top.heading : null, format);
  const state = /** @type {NonNullable<typeof S.columnsOpen>} */ (S.columnsOpen);
  state.format = format;
  state.inhibit = inhibit;
  commitAndRender('Column format');
  renderColumnsPanel();
}

/** The format as text, to edit whole. @param {ColumnView} view */
function editFormat(view) {
  openTextFieldPopup({
    label: 'Column format (for example %25ITEM %TODO %Effort{:})',
    value: view.formatText,
    onSave: (/** @type {string} */ raw) => {
      const text = String(raw).trim();
      if (!compileColumnsFormat(text).length) {
        setStatus('A column format has at least one column, such as %ITEM.');
        return;
      }
      storeFormat(view, compileColumnsFormat(text, true));
    },
  });
}

/** The actions of a column header: its width, place and attributes. @param {ColumnView} view @param {number} i */
function columnSheet(view, i) {
  const specs = view.specs.map((s) => ({ ...s }));
  const spec = specs[i];
  const width = view.width(i);
  openActionSheet({
    title: spec.title,
    subtitle: uncompileColumnsFormat([spec]),
    actions: [
      { label: 'Wider', hint: 'org-columns-widen', onClick: () => storeFormat(view, withWidth(specs, i, width + 1), true) },
      { label: 'Narrower', hint: 'org-columns-narrow', onClick: () => storeFormat(view, withWidth(specs, i, Math.max(1, width - 1)), true) },
      { label: 'Move left', hint: 'org-columns-move-left', disabled: i === 0, onClick: () => storeFormat(view, swap(specs, i - 1), true) },
      { label: 'Move right', hint: 'org-columns-move-right', disabled: i === specs.length - 1, onClick: () => storeFormat(view, swap(specs, i), true) },
      { label: 'Add a column before this one', hint: 'org-columns-new', onClick: () => editColumn(view, specs, i, null) },
      { label: 'Edit title, width and summary', hint: 'org-columns-edit-attributes', onClick: () => editColumn(view, specs, i, spec) },
      { label: 'Delete this column', hint: 'org-columns-delete', danger: true, disabled: specs.length === 1, onClick: () => storeFormat(view, specs.filter((_, k) => k !== i), true) },
    ],
  });
}

/** @param {import('../src/org-columns.js').ColumnSpec[]} specs @param {number} i @param {number} width */
const withWidth = (specs, i, width) => specs.map((s, k) => (k === i ? { ...s, width } : s));
/** Swaps column `i` with the one after it. @param {import('../src/org-columns.js').ColumnSpec[]} specs @param {number} i */
const swap = (specs, i) => specs.map((s, k) => (k === i ? specs[i + 1] : k === i + 1 ? specs[i] : s));

/**
 * A column given as its format text (%25Effort(Est){:}): added before column `i`, or, with `spec`, replacing it.
 * @param {ColumnView} view @param {import('../src/org-columns.js').ColumnSpec[]} specs @param {number} i @param {import('../src/org-columns.js').ColumnSpec | null} spec
 */
function editColumn(view, specs, i, spec) {
  openTextFieldPopup({
    label: spec ? 'Column (width, property, title, summary: %25Effort(Est){:})' : 'New column (%25Effort(Est){:})',
    value: spec ? uncompileColumnsFormat([spec]) : '%',
    onSave: (/** @type {string} */ raw) => {
      const made = compileColumnsFormat(String(raw).trim(), true);
      if (made.length !== 1) {
        setStatus('Give one column, such as %25Effort(Est){:}.');
        return;
      }
      storeFormat(view, spec ? specs.map((s, k) => (k === i ? made[0] : s)) : [...specs.slice(0, i), made[0], ...specs.slice(i)]);
    },
  });
}

/** The actions of one cell: org-columns-edit-value and the allowed values. @param {ColumnView} view @param {Heading} heading @param {number} i */
function cellSheet(view, heading, i) {
  const spec = view.specs[i];
  const prop = spec.prop;
  const entry = view.entryOf(heading);
  const actions = [];
  actions.push({ label: 'Edit value', hint: 'org-columns-edit-value', onClick: () => editValue(view, heading, i) });
  const allowed = prop === 'ITEM' || prop === 'TODO' || prop === 'PRIORITY' || prop === 'TAGS' ? [] : allowedValues(heading, prop, spec.op);
  allowed.forEach((value, k) => {
    if (k < 9) actions.push({ label: value || '(empty)', hint: `org-columns-next-allowed-value ${k + 1}`, onClick: () => setValue(heading, prop, value) });
  });
  if (!['ITEM', 'TODO', 'PRIORITY', 'TAGS', 'DEADLINE', 'SCHEDULED', 'CLOCKSUM'].includes(prop)) actions.push({ label: 'Edit allowed values', hint: `org-columns-edit-allowed (${prop}_ALL)`, onClick: () => editAllowed(heading, prop) });
  actions.push({ label: 'Show full value', hint: 'org-columns-show-value', onClick: () => setStatus(`${spec.title}: ${view.cells(entry)[i].displayed}`) });
  actions.push({ label: 'Column…', hint: 'width, place, attributes', onClick: () => columnSheet(view, i) });
  openActionSheet({ title: heading.title, subtitle: `${spec.title}: ${view.cells(entry)[i].displayed}`, actions });
}

/** The allowed values of a property, and `[ ]` / `[X]` for a checkbox summary column. @param {Heading} heading @param {string} prop @param {string | null} op */
function allowedValues(heading, prop, op) {
  const found = getAllowedValues(prop[0] + prop.slice(1).toLowerCase(), { doc: S.state.doc, heading, globalProperties: getGlobalProperties(S.state.localVariables) });
  return found.length ? found : op === 'X' || op === 'X/' || op === 'X%' ? ['[ ]', '[X]'] : [];
}

/** @param {Heading} heading @param {string} prop @param {string} value */
function setValue(heading, prop, value) {
  if (value === '') deleteProperty(heading, prop);
  else setProperty(heading, prop, value);
  commitAndRender(`${prop} set`);
  renderColumnsPanel();
}

/** The palette command each special column hands over to (the editor of that property), by its Emacs name. */
const SPECIAL_EDITORS = /** @type {Record<string, string>} */ ({
  TODO: 'org-todo',
  PRIORITY: 'org-priority',
  TAGS: 'org-schedule', // Edit details: tags, scheduled, deadline and properties
  DEADLINE: 'org-schedule',
  SCHEDULED: 'org-schedule',
});

/**
 * org-columns-edit-value: the editor of the property's own kind where the app has one, a text field otherwise.
 * @param {ColumnView} view @param {Heading} heading @param {number} i
 */
function editValue(view, heading, i) {
  const spec = view.specs[i];
  const prop = spec.prop;
  const leave = () => {
    S.columnsOpen = null;
    renderColumnsPanel();
    setKeyboardFocusToHeading(heading);
  };
  if (prop === 'CLOCKSUM' || prop === 'CLOCKSUM_T') {
    setStatus('This special column cannot be edited');
    return;
  }
  if (prop === 'ITEM') {
    leave();
    openHeadingTitleEditor(heading);
    return;
  }
  if (prop === 'EFFORT') {
    leave();
    openEffortEditor(heading);
    return;
  }
  if (SPECIAL_EDITORS[prop]) {
    const command = findPaletteCommandByOrgName(SPECIAL_EDITORS[prop]);
    leave();
    if (command) runPaletteCommand(command, heading);
    return;
  }
  openTextFieldPopup({
    label: prop,
    value: view.cells(view.entryOf(heading))[i].value,
    choices: allowedValues(heading, prop, spec.op),
    onSave: (/** @type {string} */ raw) => setValue(heading, prop, String(raw).trim()),
  });
}

/** org-columns-edit-allowed: the `PROP_ALL` property, on the heading that has it or at the top of the view. @param {Heading} heading @param {string} prop */
function editAllowed(heading, prop) {
  const key = `${prop}_ALL`;
  openTextFieldPopup({
    label: `Allowed values of ${prop} (space separated)`,
    value: String(heading.properties[Object.keys(heading.properties).find((k) => k.toUpperCase() === key) ?? ''] ?? ''),
    onSave: (/** @type {string} */ raw) => setValue(heading, key, String(raw).trim()),
  });
}
