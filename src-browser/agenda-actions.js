// @ts-check
/** @typedef {import('../src/types.js').Heading} Heading */
/** @typedef {import('../src/types.js').Doc} Doc */
// Acting on a row of the Agenda or the TODO view without leaving it: press and hold a row for the action sheet (Done, Set state,
// Reschedule, Priority, Refile, Open heading), or swipe it to the right to mark it done, with an Undo that stays for a few
// seconds. These change only a heading in the open file, as Refile does: a row from another agenda file offers Open heading alone.
// They go through the same code as the outline's own buttons, so logging, CLOSED stamps and repeaters behave the same.
import { setPriority } from '../src/heading-edit.js';
import { priorityCookies } from '../src/priorities.js';
import { getPriorityRange } from '../src/local-variables.js';
import { parseOrgTimestamp } from '../src/org-timestamp.js';
import { hasRepeater, rescheduleTimestamp, setPlanningField } from '../src/reschedule.js';
import { findSequenceForHeading, resolveTodoSequences, setTodoState } from '../src/todo-cycle.js';
import { currentEntry } from '../src/undo-history.js';
import { S } from './app-state.js';
import { openActionSheet } from './bottom-sheet.js';
import { GLOBAL_TODO_DEFAULT } from './constants.js';
import { openTimestampPickerPopup } from './dialogs.js';
import { commitAndRender, performUndo, setStatus } from './editing.js';
import { openDiaryRowActions } from './diary-flow.js';
import { navigateToHeadingByPath, outlinePathForHeadingInDocument } from './navigation.js';
import { openArchiveRefilePanel } from './archive-refile-panel.js';
import { render } from './render.js';
import { applyTodoTransition, renderTodoWorkflowPanel } from './todo-workflow.js';
import { registerAgendaRow } from './agenda-row-focus.js';
import { attachLongPress } from './ui-widgets.js';

/** The kinds of agenda row that stand for a heading you can act on; the others (sunrise, anniversaries, log lines) do not. */
const ACTIONABLE_KINDS = new Set(['scheduled', 'deadline', 'timestamp', 'sexp-timestamp', undefined]);
const SWIPE_DONE_PX = 96;

/** Whether the row's heading is in the open file and can be changed. */
export function canChangeItem(/** @type {any} */ item) {
  return !!item.heading && ACTIONABLE_KINDS.has(item.kind) && item.documentId === S.state.documentId && !S.isBufferReadOnly;
}

/** @param {Heading} heading */
function sequenceOf(heading) {
  return findSequenceForHeading(resolveTodoSequences(S.state.doc, GLOBAL_TODO_DEFAULT), heading);
}

/** Whether Mark done applies: the heading has a TODO state that is not already a done one. */
export function canMarkDone(/** @type {any} */ item) {
  const heading = item.heading;
  return canChangeItem(item) && !!heading.todo && !sequenceOf(heading).doneKeywords.includes(heading.todo);
}

/** @param {Heading} heading */
function plainTitle(heading) {
  return heading.title || '(untitled)';
}

// ---- the Undo toast ------------------------------------------------------------------------------------------------------------

/**
 * A short message over the bottom of the page with an Undo. Undo undoes the edit it was shown for, and only while that is still
 * the latest one; it never undoes something done since.
 * @param {string} message
 * @param {string} [detail]
 */
export function showUndoToast(message, detail) {
  hideUndoToast();
  const entry = currentEntry(S.history);
  const el = document.createElement('div');
  el.id = 'undoToast';
  el.setAttribute('role', 'status');
  el.style.cssText =
    'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(64px + env(safe-area-inset-bottom, 0px));width:min(92vw,520px);box-sizing:border-box;z-index:10001;' +
    'display:flex;align-items:center;gap:8px;padding:6px 6px 6px 16px;border-radius:12px;background:#1d2125;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.4);';
  const text = document.createElement('div');
  text.style.cssText = 'flex:1 1 auto;min-width:0;font-size:14px;line-height:1.3;overflow-wrap:anywhere;';
  text.textContent = message;
  if (detail) {
    const d = document.createElement('div');
    d.textContent = detail;
    d.style.cssText = 'font-size:12px;opacity:0.75;';
    text.appendChild(d);
  }
  const undo = document.createElement('button');
  undo.textContent = 'Undo';
  undo.style.cssText = 'min-height:44px;min-width:64px;border:0;background:none;color:#8ab4ff;font-size:15px;font-weight:700;';
  undo.onclick = () => {
    hideUndoToast();
    if (currentEntry(S.history) !== entry) {
      setStatus('Not undone: something else was changed since.');
      return;
    }
    performUndo();
  };
  el.append(text, undo);
  document.body.appendChild(el);
  S.undoToastTimer = window.setTimeout(hideUndoToast, 7000);
}

export function hideUndoToast() {
  window.clearTimeout(S.undoToastTimer);
  const el = document.getElementById('undoToast');
  if (el) el.remove();
}

// ---- the actions ---------------------------------------------------------------------------------------------------------------

/** The next date a repeating heading moved to, for the toast: "Next: Sun, Oct 25". */
function nextDateText(/** @type {any} */ heading) {
  const raw = [heading.planning.scheduled, heading.planning.deadline].find((r) => hasRepeater(r));
  const parsed = raw ? parseOrgTimestamp(raw) : null;
  return parsed ? 'Next: ' + parsed.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : undefined;
}

/** Marks the row's heading done, as tapping its TODO badge through to a done state does (a repeating one moves on instead). */
export function markItemDone(/** @type {any} */ item) {
  if (!canMarkDone(item)) return;
  const heading = item.heading;
  const seq = sequenceOf(heading);
  const done = seq.doneKeywords[0];
  const title = plainTitle(heading);
  applyTodoTransition(heading, () => setTodoState(heading, done, seq));
  const moved = heading.todo !== done;
  commitAndRender(moved ? `Marked "${title}" ${done} (repeats)` : `Marked "${title}" ${done}`);
  showUndoToast(moved ? `Done: ${title}` : `${done}: ${title}`, moved ? nextDateText(heading) : undefined);
}

/** Opens the state picker (all states of all the file's sequences) for the row's heading. */
export function chooseState(/** @type {any} */ item) {
  S.pendingTodoWorkflowChoice = { heading: item.heading, viaGodMode: false };
  render();
  renderTodoWorkflowPanel();
}

/** Which planning field a row's Reschedule moves: the one the row came from, else the heading's own SCHEDULED, else its DEADLINE. */
function planningFieldFor(/** @type {any} */ item) {
  if (item.kind === 'scheduled' || item.kind === 'deadline') return item.kind;
  return !item.heading.planning.scheduled && item.heading.planning.deadline ? 'deadline' : 'scheduled';
}

async function rescheduleItem(/** @type {any} */ item) {
  const heading = item.heading;
  const field = planningFieldFor(item);
  const picked = await openTimestampPickerPopup({ active: true, hasTime: false });
  if (!picked) return;
  setPlanningField(heading, field, rescheduleTimestamp(heading.planning[field], picked));
  commitAndRender(`${field === 'deadline' ? 'Deadline' : 'Scheduled'} moved: ${plainTitle(heading)}`);
}

export function choosePriority(/** @type {any} */ item) {
  const heading = item.heading;
  openActionSheet({
    title: 'Priority',
    subtitle: plainTitle(heading),
    actions: [
      ...priorityCookies(getPriorityRange(S.state.localVariables)).map((p) => ({
        label: `[#${p}]` + (heading.priority === p ? '  (now)' : ''),
        onClick: () => {
          setPriority(heading, p);
          commitAndRender(`Priority ${p}: ${plainTitle(heading)}`);
        },
      })),
      {
        label: 'No priority' + (heading.priority ? '' : '  (now)'),
        onClick: () => {
          setPriority(heading, null);
          commitAndRender(`Priority cleared: ${plainTitle(heading)}`);
        },
      },
    ],
  });
}

function openItemHeading(/** @type {any} */ item) {
  const outlinePath = outlinePathForHeadingInDocument(item.documentId, item.heading);
  if (outlinePath) navigateToHeadingByPath(item.documentId, outlinePath);
}

/** The action sheet for one row. */
export function openRowActions(/** @type {any} */ item) {
  if (item.documentId === 'diary-file') {
    if (item.diaryAt) openDiaryRowActions(item); // a row from the diary file has its own sheet
    return;
  }
  const heading = item.heading;
  if (!heading) return;
  const changeable = canChangeItem(item);
  const why = S.isBufferReadOnly ? 'This buffer is read-only.' : item.documentId !== S.state.documentId ? 'Open this file to change it.' : '';
  const repeats = hasRepeater(heading.planning.scheduled) || hasRepeater(heading.planning.deadline);
  const hasDate = !!(heading.planning.scheduled || heading.planning.deadline);
  const dateChange = item.kind === 'timestamp' || item.kind === 'sexp-timestamp'; // a date written in the title or body is edited there
  openActionSheet({
    title: plainTitle(heading),
    subtitle: [item.category, heading.todo, why].filter(Boolean).join(' · '),
    actions: [
      {
        label: 'Mark done',
        hint: !heading.todo ? 'Has no TODO state' : repeats ? 'Moves to its next date' : undefined,
        disabled: !canMarkDone(item),
        onClick: () => markItemDone(item),
      },
      { label: 'Set state…', disabled: !changeable, onClick: () => chooseState(item) },
      {
        label: hasDate ? 'Reschedule…' : 'Schedule…',
        hint: dateChange ? 'Edit the date in the heading' : undefined,
        disabled: !changeable || dateChange,
        onClick: () => rescheduleItem(item),
      },
      { label: 'Priority…', disabled: !changeable, onClick: () => choosePriority(item) },
      { label: 'Refile…', disabled: !changeable, onClick: () => openArchiveRefilePanel(heading) },
      { label: 'Open heading', onClick: () => openItemHeading(item) },
    ],
  });
}

// ---- gestures ------------------------------------------------------------------------------------------------------------------

/**
 * Wraps a row so a long press (or right-click) opens its action sheet and, when it can be marked done, a swipe to the right marks
 * it. Returns the element to put in the page in the row's place. A swipe to the left is left alone, so it still changes the day.
 * @param {HTMLElement} row
 * @param {any} item
 * @returns {HTMLElement}
 */
export function withRowActions(row, item) {
  registerAgendaRow(row, item);
  if (!item.heading || !ACTIONABLE_KINDS.has(item.kind)) return row;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;overflow:hidden;';
  const swipeable = canMarkDone(item);
  /** @type {HTMLElement | null} */ let underlay = null;
  if (swipeable) {
    wrap.setAttribute('data-swipe-row', '');
    underlay = document.createElement('div');
    underlay.setAttribute('aria-hidden', 'true');
    underlay.textContent = '✓ Done';
    underlay.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;padding-left:16px;background:#2f7d4f;color:#fff;font-weight:700;font-size:15px;';
    wrap.appendChild(underlay);
  }
  row.style.position = 'relative';
  row.style.touchAction = 'pan-y';
  row.style.setProperty('-webkit-touch-callout', 'none');
  wrap.appendChild(row);

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    row.dataset.longPressFired = '1';
    openRowActions(item);
  });
  row.addEventListener('pointerdown', () => {
    delete row.dataset.longPressFired; // a mark left by an earlier press whose click never came
    delete row.dataset.swiped;
  });
  attachLongPress(row, () => openRowActions(item), 500);

  if (swipeable && underlay) {
    const under = underlay;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let tracking = false;
    let swiping = false;
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (/** @type {Element} */ (e.target).closest('button, a, input, textarea, [data-inline-link]')) return;
      startX = e.clientX;
      startY = e.clientY;
      dx = 0;
      tracking = true;
      swiping = false;
    });
    row.addEventListener('pointermove', (e) => {
      if (!tracking) return;
      dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!swiping) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) tracking = false; // a scroll, not a swipe
        else if (dx > 12 && dx > Math.abs(dy) * 1.5) {
          swiping = true;
          row.setPointerCapture(e.pointerId);
        }
      }
      if (swiping) {
        const shown = Math.max(0, dx);
        under.style.display = 'flex';
        row.style.transition = 'none';
        row.style.transform = `translateX(${shown}px)`;
        under.style.opacity = shown >= SWIPE_DONE_PX ? '1' : '0.7';
      }
    });
    const end = () => {
      if (!tracking) return;
      tracking = false;
      if (!swiping) return;
      row.dataset.swiped = '1';
      window.setTimeout(() => delete row.dataset.swiped, 150); // the click that follows the release comes first, or not at all
      swiping = false;
      row.style.transition = 'transform 0.15s';
      if (dx >= SWIPE_DONE_PX) {
        markItemDone(item);
      } else {
        row.style.transform = '';
        window.setTimeout(() => {
          under.style.display = 'none';
        }, 160);
      }
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', () => {
      tracking = false;
      if (swiping) {
        swiping = false;
        row.style.transform = '';
        under.style.display = 'none';
      }
    });
  }
  return wrap;
}

/** Whether a click on `row` is really the end of a long press or a swipe, which must not also open the heading. Clears the mark. */
export function clickIsGestureEnd(/** @type {HTMLElement} */ row) {
  const was = row.dataset.longPressFired === '1' || row.dataset.swiped === '1';
  delete row.dataset.longPressFired;
  delete row.dataset.swiped;
  return was;
}
