// The time stamp commands of org.el that change text: org-time-stamp (C-c .), org-time-stamp-inactive (C-c !), org-timestamp-up and
// -down (S-up, S-down), org-clock-timestamps-up and -down, and org-clone-subtree-with-time-shift (C-c C-x c). The rules are in
// src/timestamp-edit.js. They act at the cursor of the Text view or of a text editor (the Date tool); in the outline the clone command
// acts on the focused heading.
import { headingLineIndex, serializeOrg } from '../src/org-parser.js';
import { clockTimestampsChange, cloneSubtreeAt, compactTimeOfDay, insertTimeStampCommand, subtreeHasTimestamp, timestampAt, timestampChange } from '../src/timestamp-edit.js';
import { S } from './app-state.js';
import { openActionSheet } from './bottom-sheet.js';
import { commitTextModeIfActive, replaceDocumentText, setStatus } from './editing.js';
import { readFromMinibuffer } from './minibuffer-prompt.js';

/** @returns {HTMLTextAreaElement | null} */
function textView() {
  return S.currentView === 'text' ? /** @type {HTMLTextAreaElement | null} */ (document.getElementById('document-text-edit-input')) : null;
}

/** Puts the edit in the textarea and the cursor after it. @param {HTMLTextAreaElement} area @param {{ text: string, pos: number, message?: string }} edit */
function applyToTextarea(area, edit) {
  area.value = edit.text;
  area.setSelectionRange(edit.pos, edit.pos);
  area.dispatchEvent(new Event('input', { bubbles: true }));
  area.focus();
  if (edit.message) setStatus(edit.message);
}

/** The lines of the stamp's category read as Emacs does; a failure (Emacs's user-error) shows as the status. @param {() => void} run */
function guarded(run) {
  try {
    run();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e));
  }
}

/** The textarea a command works in: the one given, or the Text view's. @param {HTMLTextAreaElement | null} [area] */
function target(area) {
  const t = area || textView();
  if (!t) setStatus('Put the cursor in the Text view or a text editor (its Date tool).');
  return t;
}

/** org-time-stamp or org-time-stamp-inactive. `arg` is the prefix: 'single' (C-u), 'double' (C-u C-u) or null.
 * @param {{ inactive?: boolean, arg?: 'single' | 'double' | null, area?: HTMLTextAreaElement | null }} [options] */
export async function insertTimeStamp({ inactive = false, arg = null, area = null } = {}) {
  const t = target(area);
  if (!t) return;
  const text = t.value;
  const pos = t.selectionStart;
  let typed = null;
  if (arg !== 'double') {
    const at = timestampAt(text, pos);
    const initial = at ? compactTimeOfDay(at.ts.m[0]) || '' : '';
    typed = await readFromMinibuffer('Date+time [now]: ', initial);
    if (typed === null) return;
  }
  guarded(() => applyToTextarea(t, insertTimeStampCommand(t.value, t.selectionStart, { typed, arg, inactive, now: new Date(), vars: { ...S.globalVariables, ...S.state.localVariables } })));
}

/** org-timestamp-up, org-timestamp-down and their -day forms. `n` is 1 or -1. @param {number} n @param {{ day?: boolean, area?: HTMLTextAreaElement | null }} [options] */
export function changeTimeStamp(n, { day = false, area = null } = {}) {
  const t = target(area);
  if (!t) return;
  guarded(() => applyToTextarea(t, timestampChange(t.value, t.selectionStart, n, day ? { what: 'day' } : { updown: true })));
}

/** S-up and S-down where the Text view's cursor is on a time stamp: org-timestamp-up or -down. False where it is not. @param {number} n */
export function changeTimeStampAtTextCursor(n) {
  const t = textView();
  if (!t || !timestampAt(t.value, t.selectionStart)) return false;
  changeTimeStamp(n, { area: t });
  return true;
}

/** org-clock-timestamps-up and -down. @param {'up' | 'down'} updown @param {HTMLTextAreaElement | null} [area] */
export function changeClockTimeStamps(updown, area = null) {
  const t = target(area);
  if (!t) return;
  guarded(() => applyToTextarea(t, clockTimestampsChange(t.value, t.selectionStart, updown)));
}

/** The Date button of the text editors: a sheet of the time stamp commands at the cursor.
 * @returns {{ text: string, title: string, id: string, onClick: (textarea: HTMLTextAreaElement) => void }} */
export function dateEditorTool() {
  return {
    text: 'Date',
    title: 'Insert or change a time stamp at the cursor',
    id: 'date',
    onClick: (area) => {
      const cursor = area.selectionStart;
      openActionSheet({
        title: 'Date',
        actions: [
          { label: 'Insert or replace time stamp', hint: 'C-c .', onClick: () => void insertTimeStamp({ area }) },
          { label: 'Insert or replace inactive time stamp', hint: 'C-c !', onClick: () => void insertTimeStamp({ inactive: true, area }) },
          { label: 'Insert now, with the time', hint: 'C-u C-u C-c .', onClick: () => void insertTimeStamp({ arg: 'double', area }) },
          { label: 'Time stamp up', hint: 'S-up', onClick: () => { area.setSelectionRange(cursor, cursor); changeTimeStamp(1, { area }); } },
          { label: 'Time stamp down', hint: 'S-down', onClick: () => { area.setSelectionRange(cursor, cursor); changeTimeStamp(-1, { area }); } },
        ],
      });
    },
  };
}

/** org-clone-subtree-with-time-shift (C-c C-x c) on the heading at the cursor of the Text view, or the focused heading. */
export async function cloneSubtreeWithTimeShiftCommand() {
  if (S.isBufferReadOnly) {
    setStatus('Buffer is read-only — change not applied.');
    return;
  }
  const area = textView();
  if (!area && !S.keyboardFocusedHeading) {
    setStatus('Before first headline');
    return;
  }
  /** @type {string} */ let text;
  /** @type {number} */ let pos;
  if (area) {
    text = area.value;
    pos = area.selectionStart;
  } else {
    commitTextModeIfActive();
    const doc = S.state.doc;
    const heading = S.keyboardFocusedHeading;
    if (!doc || !heading) return;
    text = serializeOrg(doc);
    const line = headingLineIndex(doc).lines.get(heading);
    if (!line) return;
    pos = text.split('\n').slice(0, line.line).reduce((sum, l) => sum + l.length + 1, 0);
  }
  const answer = await readFromMinibuffer('Number of clones to produce: ', '1');
  if (answer === null) return;
  const n = Number(answer);
  if (!Number.isInteger(n) || n < 0 || answer.trim() === '') {
    setStatus('Number of clones must be a non-negative integer');
    return;
  }
  let shift = '';
  if (subtreeHasTimestamp(text, pos)) {
    const typed = await readFromMinibuffer('Date shift per clone (e.g. +1w, empty to override): ', '');
    if (typed === null) return;
    shift = typed;
  }
  guarded(() => {
    const edit = cloneSubtreeAt(text, pos, n, shift, { newId: () => crypto.randomUUID() });
    if (area) applyToTextarea(area, edit);
    else replaceDocumentText(edit.text, 'Cloned subtree');
  });
}
