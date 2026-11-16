// @ts-check
// Commands of Org that act on a position in the text and the Text view is where one is: C-a and C-e as org-special-ctrl-a/e has them, mark
// subtree, toggle heading, next link, and the mark ring (C-c % and C-c &), which also works from the outline.
import { headingLineIndex } from '../src/org-parser.js';
import { lineNumberAt } from '../src/text-edit.js';
import { metaReturn } from '../src/meta-return.js';
import { markSubtree, nextLink, orgBeginningOfLine, orgEndOfLine, readSpecialCtrlAE, toggleHeading } from '../src/text-commands.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';
import { GLOBAL_TODO_DEFAULT } from './constants.js';
import { S } from './app-state.js';
import { setStatus } from './editing.js';
import { navigateToHeading, navigateToHeadingByPath, outlinePathForHeadingInDocument } from './navigation.js';
import { applyTextEdit, selectLines } from './text-view.js';

/** @typedef {import('../src/types.js').Heading} Heading */

/** What the commands remember between presses: the last one, as Emacs's last-command is, whether the last link search failed, the ring. */
const MEMORY = {
  last: '',
  linkFailed: false,
  /** @type {{ documentId: string, line: number, col: number, outlinePath: string[] | null }[]} */
  ring: [],
  ringAt: 0,
};
const RING_LENGTH = 4; // org-mark-ring-length

/** The text editor showing, if any. */
const textEditor = () => (S.currentView === 'text' ? /** @type {HTMLTextAreaElement | null} */ (document.getElementById('document-text-edit-input')) : null);

/** @param {string} command  what a repeated press must be to count as a repeat @returns {boolean} */
function repeated(command) {
  const same = MEMORY.last === command;
  MEMORY.last = command;
  return same;
}

/** @returns {string[]} */
const keywords = () => {
  const seq = resolveTodoSequence(S.state.doc, GLOBAL_TODO_DEFAULT);
  return [...seq.todoKeywords, ...seq.doneKeywords];
};

/** Puts the caret at `pos` and shows it. @param {HTMLTextAreaElement} ta @param {number} pos */
function moveCaret(ta, pos) {
  const line = lineNumberAt(ta.value, pos);
  selectLines(ta, line, line);
  ta.setSelectionRange(pos, pos);
}

/** Says a command needs the Text view. @param {string} what */
function needsTextView(what) {
  setStatus(`${what} needs the Text view (More > Text)`);
}

/** org-beginning-of-line. */
export function beginningOfLineCommand() {
  const ta = textEditor();
  if (!ta) return needsTextView('Beginning of line');
  const again = repeated('bol');
  moveCaret(ta, orgBeginningOfLine(ta.value, ta.selectionStart, readSpecialCtrlAE(S.state.localVariables['org-special-ctrl-a/e']).a, again, keywords()));
}

/** org-end-of-line. */
export function endOfLineCommand() {
  const ta = textEditor();
  if (!ta) return needsTextView('End of line');
  const again = repeated('eol');
  moveCaret(ta, orgEndOfLine(ta.value, ta.selectionStart, readSpecialCtrlAE(S.state.localVariables['org-special-ctrl-a/e']).e, again, keywords()));
}

/** org-mark-subtree (C-c @): selects the subtree, with the caret at its start. */
export function markSubtreeCommand() {
  const ta = textEditor();
  if (!ta) return needsTextView('Mark subtree');
  repeated('mark');
  const region = markSubtree(ta.value, ta.selectionStart);
  if (!region) return setStatus('Not in a subtree');
  selectLines(ta, lineNumberAt(ta.value, region.start), lineNumberAt(ta.value, Math.max(region.start, region.end - 1)));
  ta.setSelectionRange(region.start, region.end, 'backward');
}

/** org-toggle-heading (C-c *) on the selected lines, or the caret's line, of the Text view. */
export function toggleHeadingInText() {
  const ta = textEditor();
  if (!ta) return;
  repeated('toggle');
  const { selectionStart: a, selectionEnd: b, value } = ta;
  const from = lineNumberAt(value, a) - 1;
  const to = b > a ? lineNumberAt(value, b - (value[b - 1] === '\n' ? 1 : 0)) - 1 : from;
  const next = toggleHeading(value, from, to);
  if (next === null) return setStatus('Cannot toggle heading from here');
  let head = 0;
  while (head < value.length && head < next.length && value[head] === next[head]) head++;
  let tail = 0;
  while (tail < value.length - head && tail < next.length - head && value[value.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  const caret = Math.max(head, Math.min(next.length, a + (head <= a ? next.length - value.length : 0)));
  applyTextEdit(ta, { from: head, to: value.length - tail, insert: next.slice(head, next.length - tail), selStart: caret, selEnd: caret });
}

/** org-next-link (C-c C-x C-n): the caret goes to the next link. */
export function nextLinkCommand() {
  const ta = textEditor();
  if (!ta) return needsTextView('Next link');
  const wrap = MEMORY.linkFailed && repeated('link');
  if (!wrap) repeated('link');
  const result = nextLink(ta.value, ta.selectionStart, wrap);
  MEMORY.linkFailed = result.failed;
  moveCaret(ta, result.pos);
  if (result.message) setStatus(result.message);
}

/** The heading a line of the file belongs to. @param {import('../src/types.js').Doc} doc @param {number} line @returns {Heading | null} */
export function headingAtLine(doc, line) {
  /** @type {Heading | null} */
  let best = null;
  let bestLine = -1;
  for (const [heading, at] of headingLineIndex(doc).lines) {
    if (at.line <= line && at.line > bestLine) {
      best = heading;
      bestLine = at.line;
    }
  }
  return best;
}

/** org-mark-ring-push (C-c %): remembers where the caret is, or the focused heading. */
export function markRingPush() {
  const doc = S.state.doc;
  if (!doc) return;
  const ta = textEditor();
  const at = ta ? ta.selectionStart : 0;
  const line = ta ? lineNumberAt(ta.value, at) - 1 : (S.keyboardFocusedHeading ? headingLineIndex(doc).lines.get(S.keyboardFocusedHeading)?.line : undefined) ?? 0;
  const col = ta ? at - (ta.value.lastIndexOf('\n', at - 1) + 1) : 0;
  const heading = headingAtLine(doc, line);
  MEMORY.ring.unshift({ documentId: S.state.documentId, line, col, outlinePath: heading ? outlinePathForHeadingInDocument(S.state.documentId, heading) : null });
  MEMORY.ring.length = Math.min(MEMORY.ring.length, RING_LENGTH);
  MEMORY.ringAt = 0;
  repeated('ring-push');
  setStatus("Position saved to mark ring, go back with `C-c &'.");
}

/** org-mark-ring-goto (C-c &): back to the last saved position; pressed again, to the one before. */
export async function markRingGoto() {
  if (MEMORY.ring.length === 0) return setStatus('The mark ring is empty');
  MEMORY.ringAt = repeated('ring-goto') ? (MEMORY.ringAt + 1) % MEMORY.ring.length : 0;
  const entry = MEMORY.ring[MEMORY.ringAt];
  const ta = textEditor();
  if (ta && entry.documentId === S.state.documentId) {
    const lines = ta.value.split('\n');
    const line = Math.min(entry.line, lines.length - 1);
    moveCaret(ta, lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + Math.min(entry.col, lines[line].length));
    return;
  }
  if (entry.outlinePath) return navigateToHeadingByPath(entry.documentId, entry.outlinePath);
  const doc = S.state.doc;
  const heading = doc && entry.documentId === S.state.documentId ? headingAtLine(doc, entry.line) : null;
  if (heading) navigateToHeading(heading);
}

/** M-RET in the Text view: a new heading or list item, splitting the line at the caret as org-M-RET-may-split-line says. @returns {boolean} whether the Text view took it */
export function metaReturnInText() {
  const ta = textEditor();
  if (!ta) return false;
  repeated('meta-return');
  const result = metaReturn(ta.value, ta.selectionStart, S.state.localVariables['org-M-RET-may-split-line'], keywords());
  if ('error' in result) {
    setStatus(result.error);
    return true;
  }
  const { value } = ta;
  let head = 0;
  while (head < value.length && head < result.text.length && value[head] === result.text[head]) head++;
  let tail = 0;
  while (tail < value.length - head && tail < result.text.length - head && value[value.length - 1 - tail] === result.text[result.text.length - 1 - tail]) tail++;
  applyTextEdit(ta, { from: head, to: value.length - tail, insert: result.text.slice(head, result.text.length - tail), selStart: result.pos, selEnd: result.pos });
  return true;
}
