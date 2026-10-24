// @ts-check
// The focused row of the Agenda, TODO, Match and Keyword search screens, as point is on a line of an Emacs agenda buffer. Find moves it
// to the row of the current match; n, p, j, k and the arrow keys move it; then t changes its state, RET goes to its heading, a comma
// sets its priority and Space opens the row's action sheet. It lasts until the screen is left.
import { S, isAgendaFamilyView } from './app-state.js';
import { canChangeItem, choosePriority, chooseState, openRowActions } from './agenda-actions.js';
import { outlineEl } from './dom.js';
import { setStatus } from './editing.js';

/** @typedef {import('../src/agenda.js').AgendaItem} AgendaItem */
const ROW = '[data-agenda-row]';
const FOCUSED = 'agenda-row-focused';

/** The row that has focus, by what it stands for: its heading (or, for a row without one, the item). Kept as an object so no `let` is needed. */
const focus = { key: /** @type {object | null} */ (null), scheduled: false };

/** Which item each row element stands for. @type {WeakMap<Element, AgendaItem>} */
const rowItems = new WeakMap();

/** Marks `row` as the row of `item`; called where a row is made. @param {HTMLElement} row @param {AgendaItem} item */
export function registerAgendaRow(row, item) {
  row.setAttribute('data-agenda-row', '');
  rowItems.set(row, item);
}

/** @param {AgendaItem} item @returns {object} */
const keyOf = (item) => item.heading || item;

/** @returns {HTMLElement[]} */
function rows() {
  return /** @type {HTMLElement[]} */ ([...outlineEl.querySelectorAll(ROW)]);
}

/** Outlines the focused row and nothing else. */
export function paintAgendaRowFocus() {
  if (!isAgendaFamilyView(S.currentView)) focus.key = null;
  for (const row of rows()) {
    const on = focus.key !== null && keyOf(/** @type {AgendaItem} */ (rowItems.get(row) || {})) === focus.key;
    row.classList.toggle(FOCUSED, on);
  }
}

/** @param {HTMLElement | null} row */
export function focusAgendaRow(row) {
  if (!row) return;
  focus.key = keyOf(/** @type {AgendaItem} */ (rowItems.get(row) || {}));
  paintAgendaRowFocus();
  row.scrollIntoView({ block: 'nearest' });
}

/** Focus goes to the row a Find match is in. @param {Element | null} mark */
export function focusRowOfMark(mark) {
  focusAgendaRow(/** @type {HTMLElement | null} */ (mark ? mark.closest(ROW) : null));
}

/** @returns {HTMLElement | null} */
function focusedRow() {
  return rows().find((row) => row.classList.contains(FOCUSED)) || null;
}

/** @param {number} delta */
function moveFocus(delta) {
  const all = rows();
  if (all.length === 0) return;
  const at = all.findIndex((row) => row.classList.contains(FOCUSED));
  focusAgendaRow(all[at < 0 ? (delta > 0 ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, at + delta))]);
}

/**
 * The keys of a focused row. Returns whether the key was used.
 * @param {KeyboardEvent} e
 */
export function handleAgendaRowKey(e) {
  if (!isAgendaFamilyView(S.currentView) || e.altKey || e.metaKey || e.ctrlKey) return false;
  const step = { j: 1, n: 1, ArrowDown: 1, k: -1, p: -1, ArrowUp: -1 }[/** @type {'j'} */ (e.key)];
  if (step && !e.shiftKey) {
    if (rows().length === 0) return false;
    e.preventDefault();
    moveFocus(step);
    return true;
  }
  const row = focusedRow();
  const item = row && rowItems.get(row);
  if (!row || !item) return false;
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    row.click();
    return true;
  }
  if (e.key === ' ') {
    e.preventDefault();
    openRowActions(item);
    return true;
  }
  if (e.key === 't' || e.key === ',') {
    e.preventDefault();
    if (!item.heading || !canChangeItem(item)) {
      setStatus(S.isBufferReadOnly ? 'This buffer is read-only.' : 'Open this file to change it.');
    } else if (e.key === 't') chooseState(item);
    else choosePriority(item);
    return true;
  }
  return false;
}

// a screen that is drawn again keeps its focused row
new MutationObserver(() => {
  if (focus.key === null || focus.scheduled) return;
  focus.scheduled = true;
  queueMicrotask(() => {
    focus.scheduled = false;
    paintAgendaRowFocus();
  });
}).observe(outlineEl, { childList: true, subtree: true });
