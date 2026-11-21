// @ts-check
// The list and heading commands of the palette and god-mode (M-right, M-left, M-up, M-down, C-c C-x C-b, C-c C-t, C-c - ...) when the Text view is
// showing: they act at the caret, by the same functions Emacs mode's keys use (src/emacs-org.js), where the outline would act on its focused item.
import { indentItemTree, outdentItemTree, cycleListBullet, repairListAt } from '../src/list-struct.js';
import { indentItemAt, moveItemDownAt, moveItemUpAt, outdentItemAt, itemCommandAt, onItemLine, toggleCheckboxAt, shiftHeading, moveSubtree, cycleTodo, headingStarts } from '../src/emacs-org.js';
import { S } from './app-state.js';
import { setStatus, commitTextModeIfActive } from './editing.js';
import { findHeadingAtLine } from '../src/org-parser.js';
import { applyTextEdit, selectLines } from './text-view.js';
import { lineNumberAt } from '../src/text-edit.js';

/** @type {Record<string, (text: string, pos: number) => { text: string, pos: number, error?: string }>} */
const AT_CARET = {
  'indent-item': indentItemAt,
  'outdent-item': outdentItemAt,
  'move-item-up': moveItemUpAt,
  'move-item-down': moveItemDownAt,
  'toggle-checkbox': toggleCheckboxAt,
  'indent-item-tree': (t, p) => itemCommandAt(t, p, (l, n) => indentItemTree(l, n)),
  'outdent-item-tree': (t, p) => itemCommandAt(t, p, (l, n) => outdentItemTree(l, n)),
  'cycle-list-bullet': (t, p) => itemCommandAt(t, p, (l, n) => cycleListBullet(l, n)),
  'list-repair': (t, p) => itemCommandAt(t, p, (l, n) => repairListAt(l, n)),
};

/** The heading commands at the caret: they act on the heading the caret is in or under, as the outline's act on its focused heading.
 *  @type {Record<string, (text: string, pos: number) => { text: string, pos: number, error?: string, unsupported?: boolean }>} */
const HEADING_AT_CARET = {
  'promote-heading': (t, p) => shiftHeading(t, p, true),
  'demote-heading': (t, p) => shiftHeading(t, p, false),
  'move-up': (t, p) => moveSubtree(t, p, true),
  'move-down': (t, p) => moveSubtree(t, p, false),
  todo: cycleTodo,
};

/** The palette commands that need no focused heading while the Text view shows: those above, and Toggle heading, which works on the lines. */
export const TEXT_VIEW_HEADING_COMMANDS = new Set([...Object.keys(HEADING_AT_CARET), 'toggle-heading']);

/** Puts what a command at the caret made into the field, as one edit. @param {HTMLTextAreaElement} ta @param {{ text: string, pos: number }} done */
function applyAtCaret(ta, done) {
  const value = ta.value;
  let head = 0;
  while (head < value.length && head < done.text.length && value[head] === done.text[head]) head++;
  let tail = 0;
  while (tail < value.length - head && tail < done.text.length - head && value[value.length - 1 - tail] === done.text[done.text.length - 1 - tail]) tail++;
  if (done.text !== value) applyTextEdit(ta, { from: head, to: value.length - tail, insert: done.text.slice(head, done.text.length - tail), selStart: done.pos, selEnd: done.pos });
  else {
    const line = lineNumberAt(value, done.pos);
    selectLines(ta, line, line);
    ta.setSelectionRange(done.pos, done.pos);
  }
}

/**
 * Runs the list command `id` at the caret of the Text view.
 * @param {string} id @returns {boolean} whether the Text view was showing with the caret on a list item (or, for the checkbox, anywhere it applies)
 */
export function listCommandInText(id) {
  if (S.currentView !== 'text') return false;
  const ta = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('document-text-edit-input'));
  const run = AT_CARET[id];
  if (!ta || !run) return false;
  const { value, selectionStart: at } = ta;
  if (id !== 'toggle-checkbox' && !onItemLine(value, at)) return false;
  const done = run(value, at);
  if (done.error) {
    setStatus(done.error);
    return true;
  }
  applyAtCaret(ta, done);
  return true;
}

/**
 * Runs the heading command `id` (Cycle TODO state, Promote heading, Move subtree up ...) on the heading the caret of the Text view is in.
 * @param {string} id @returns {boolean} whether the Text view was showing and the command is one of these
 */
export function headingCommandInText(id) {
  if (S.currentView !== 'text') return false;
  const ta = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('document-text-edit-input'));
  const run = HEADING_AT_CARET[id];
  if (!ta || !run) return false;
  const { value, selectionStart: at } = ta;
  const lineStart = value.lastIndexOf('\n', at - 1) + 1;
  if (!headingStarts(value).some((start) => start <= lineStart)) {
    setStatus('Before first heading');
    return true;
  }
  const done = run(value, at);
  if (done.unsupported) setStatus('A repeating timestamp is not handled in the Text view yet: use the outline.');
  else if (done.error) setStatus(done.error);
  else applyAtCaret(ta, done);
  return true;
}

/**
 * The heading the caret of the Text view is in or under, as the document model has it: the text is committed first (the document is re-read from it),
 * so a palette command acts on the heading exactly as it does from the outline. Says "Before first heading" and gives null when there is none
 * (quietly, with `allowNone`, for a command that works before the first heading too).
 * @param {{ allowNone?: boolean }} [options]
 * @returns {import('../src/types.js').Heading | null}
 */
export function headingAtCaretInText({ allowNone = false } = {}) {
  const ta = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('document-text-edit-input'));
  if (S.currentView !== 'text' || !ta) return null;
  const { value, selectionStart: at } = ta;
  const lineStart = value.lastIndexOf('\n', at - 1) + 1;
  const start = headingStarts(value).filter((p) => p <= lineStart).pop();
  if (start === undefined) {
    if (allowNone) commitTextModeIfActive();
    else setStatus('Before first heading');
    S.currentContextHeading = null;
    return null;
  }
  const local = value.slice(0, start).split('\n').length - 1;
  commitTextModeIfActive();
  const heading = S.state.doc ? findHeadingAtLine(S.state.doc, local + (S.narrowedTextModeRange?.startLine ?? 0)) : null;
  if (!heading) setStatus('Could not find the heading at the caret');
  S.currentContextHeading = heading; // the Text view, shown again after the command, lands on this heading
  return heading;
}
