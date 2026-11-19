// @ts-check
/**
 * The editing commands in a buffer with folded text. A folded stretch is one step for the caret, as in Emacs: C-f and C-b go over it, C-n and
 * C-p skip the lines in it, C-k kills through it and C-d at the end of its heading does nothing. Held to Emacs by test/emacs-fold-motion.test.js.
 */
import { displayColumn, execute } from './emacs-edit.js';

/** @typedef {import('./org-fold.js').Range} Range */
/** @typedef {import('./emacs-edit.js').EditState} EditState */

const INVISIBLE_EDIT = 'Edit in invisible region aborted, repeat to confirm with text visible';
const LINE_COMMANDS = new Set(['org-beginning-of-line', 'org-end-of-line', 'next-line', 'previous-line']);

/**
 * Runs a command on a buffer whose hidden stretches are `hidden`.
 * @param {EditState} state @param {Range[]} hidden @param {string} command @param {string} [arg] @param {{ n: number, universal: boolean }} [prefix]
 * @returns {EditState}
 */
export function foldedExecute(state, hidden, command, arg, prefix) {
  if (!hidden.length) return execute(state, command, arg, prefix);
  const len = state.text.length;
  /** The caret after a stretch's dots is on its heading's line, unless that is the empty last line after the final newline. @param {Range} r */
  const lineEnds = ([, b]) => b < len || state.text[b - 1] !== '\n';
  const after = hidden.find((r) => r[1] === state.pos && lineEnds(r)); // a caret after the dots is still on the heading's line
  if (after && LINE_COMMANDS.has(command)) {
    const col = displayColumn(state.text, state.pos); // the column is the text line's, the line is the heading's
    return foldedExecute({ ...state, pos: after[0], goal: command === 'org-beginning-of-line' || command === 'org-end-of-line' ? state.goal : col }, hidden, command, arg, prefix);
  }
  /** Whether a caret at `p` is on a hidden line: after the dots of a folded heading, where a line motion goes on. @param {number} p */
  const onHiddenLine = (p) => hidden.some((r) => p > r[0] && (p < r[1] || (p === r[1] && lineEnds(r))));
  /** Whether `p` is strictly inside a stretch, a place the caret cannot be. @param {number} p */
  const inside = (p) => hidden.some(([a, b]) => p > a && p < b);
  const eol = state.text.indexOf('\n', state.pos) < 0 ? len : state.text.indexOf('\n', state.pos);
  const own = hidden.find(([a]) => a === eol && state.pos <= a);

  if (command === 'org-kill-line' && !prefix && own) {
    const killed = execute({ ...state, mark: own[1], active: true }, 'kill-region') // a forward kill: it adds to the end of the one before;
    return { ...killed, last: 'kill-region' };
  }
  if ((command === 'org-delete-char' || command === 'org-delete-backward-char') && !prefix && hidden.some(([a, b]) => b === state.pos || (command === 'org-delete-char' && a === state.pos))) return { ...state, error: INVISIBLE_EDIT, last: command };
  if ((command === 'next-line' || command === 'previous-line') && !prefix) {
    let at = execute(state, command, arg);
    for (let i = 0; i < len && !at.error && onHiddenLine(at.pos); i++) at = execute(at, command, arg);
    const stuck = hidden.find(([a, b]) => at.pos > a && at.pos < b);
    return at.error && stuck ? { ...at, pos: stuck[1] } : at; // the last line: point goes to the end of it, and Emacs says so
  }
  const done = { ...execute({ ...state, hidden }, command, arg, prefix), hidden: undefined };
  if (done.text === state.text && inside(done.pos)) {
    const [a, b] = /** @type {Range} */ (hidden.find(([x, y]) => done.pos > x && done.pos < y));
    if (command === 'backward-word') return { ...done, pos: b < state.pos ? b : a }; // to the far side when the near side is where it was
    return { ...done, pos: done.pos >= state.pos ? b : a };
  }
  return done;
}
