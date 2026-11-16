// @ts-check
/**
 * Emacs mode, the editing core: the commands of Emacs's default keymap that change the text or move the caret, on the text of a buffer.
 * A state is `{ text, pos, mark, kill, last, goal }`: the caret and the mark as 0-based offsets (`mark` is null when unset), the kill
 * ring (newest first), the kind of the previous command (`last`, for kill appending) and the goal column of vertical movement.
 */
import { EMACS_ALNUM_RE } from './emacs-chars.js';
import { orgYank } from './org-yank.js';
import { boundary, newUndo, recordDelete, recordInsert, undo } from './emacs-undo.js';

/**
 * @typedef {object} EditState
 * @property {string} text @property {number} pos @property {number | null} mark @property {string[]} kill
 * @property {number} [yankAt] where the kill ring's yank pointer is (`kill-ring-yank-pointer`), 0 for the newest
 * @property {boolean} [active] the mark is active: the region is highlighted (`region-active-p`)
 * @property {string} [arg] the character `self-insert-command` inserts
 * @property {string} [last] the previous command's name @property {number | null} [goal]
 * @property {{ adjusted: boolean, folded: boolean }} [yank] `org-yank-adjusted-subtrees` and `org-yank-folded-subtrees` (nil and t in Emacs)
 * @property {import('./emacs-undo.js').UndoState} [undo] the undo list, shared by the states that follow one another
 * @property {Edit[]} [edits] what the command just did to the text, for the undo list
 * @property {string} [error] set when the command signaled an error: the state is then what Emacs leaves
 */

/** @typedef {{ from: number, removed: string, inserted: number, pt?: number, mark?: number | null, markers?: boolean }} Edit */

/** @param {string} ch */
const isWord = (ch) => ch !== undefined && (EMACS_ALNUM_RE.test(ch) || '$%\''.includes(ch));

/** `forward-word`: to the end of the next word, or the end of the buffer. @param {string} text @param {number} pos @param {(ch: string) => boolean} [word] */
export function forwardWord(text, pos, word = isWord) {
  let i = pos;
  while (i < text.length && !word(text[i])) i += 1;
  while (i < text.length && word(text[i])) i += 1;
  return i;
}

/** `backward-word`. @param {string} text @param {number} pos @param {(ch: string) => boolean} [word] */
export function backwardWord(text, pos, word = isWord) {
  let i = pos;
  while (i > 0 && !word(text[i - 1])) i -= 1;
  while (i > 0 && word(text[i - 1])) i -= 1;
  return i;
}

/** @param {string} text @param {number} pos */
const lineStart = (text, pos) => (pos <= 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1);
/** @param {string} text @param {number} pos */
const lineEnd = (text, pos) => {
  const i = text.indexOf('\n', pos);
  return i === -1 ? text.length : i;
};

/**
 * Where a marker goes when `from..to` is replaced by `inserted` characters: text after the change shifts, a marker inside a deleted
 * range moves to its start, and one at the start of an insertion stays before it.
 * @param {number | null} mark @param {number} from @param {number} to @param {number} inserted
 */
function markerAfter(mark, from, to, inserted) {
  if (mark === null) return null;
  if (mark >= to && (mark > from || to > from)) return mark - (to - from) + inserted;
  return mark > from ? from : mark;
}

/** @param {EditState} s @param {Partial<EditState>} change @returns {EditState} */
const next = (s, change) => ({ ...s, goal: null, ...change });

/** A kill: `from..to` goes to the kill ring (appended or prepended when the previous command was a kill too) and out of the text.
 * @param {EditState} s @param {number} from @param {number} to @param {boolean} forward */
function kill(s, from, to, forward) {
  const piece = s.text.slice(from, to);
  const appended = s.last === 'kill-region' && s.kill.length > 0;
  const ring = appended ? [forward ? s.kill[0] + piece : piece + s.kill[0], ...s.kill.slice(1)] : [piece, ...s.kill];
  return next(s, { text: s.text.slice(0, from) + s.text.slice(to), pos: from, kill: ring, yankAt: 0, mark: markerAfter(s.mark, from, to, 0), last: 'kill-region', edits: [{ from, removed: piece, inserted: 0, pt: s.pos }] });
}

/** @param {EditState} s @param {string} message @param {Partial<EditState>} [change] @returns {EditState} */
const fail = (s, message, change = {}) => ({ ...s, goal: null, ...change, error: message });

/** @param {string} text @param {number} from @param {number} to @param {(s: string) => string} fn */
const replaceRange = (text, from, to, fn) => text.slice(0, from) + fn(text.slice(from, to)) + text.slice(to);

/** @param {string} word */
const capitalize = (word) => {
  let out = '';
  let inWord = false;
  for (const ch of word) {
    /** @type {boolean} */ const w = isWord(ch) && (ch !== "'" || inWord);
    out += w ? (inWord ? ch.toLowerCase() : ch.toUpperCase()) : ch;
    inWord = w;
  }
  return out;
};

/** @type {Record<string, (s: EditState) => EditState>} */
const COMMANDS = {
  'forward-char': (s) => (s.pos >= s.text.length ? fail(s, 'End of buffer') : next(s, { pos: s.pos + 1 })),
  'backward-char': (s) => (s.pos <= 0 ? fail(s, 'Beginning of buffer') : next(s, { pos: s.pos - 1 })),
  'org-beginning-of-line': (s) => next(s, { pos: lineStart(s.text, s.pos) }),
  'org-end-of-line': (s) => next(s, { pos: lineEnd(s.text, s.pos) }),
  'forward-word': (s) => next(s, { pos: forwardWord(s.text, s.pos) }),
  'backward-word': (s) => next(s, { pos: backwardWord(s.text, s.pos) }),
  'beginning-of-buffer': (s) => next(s, { pos: 0, mark: s.pos }),
  'end-of-buffer': (s) => next(s, { pos: s.text.length, mark: s.pos }),
  'next-line': (s) => vertical(s, 1),
  'previous-line': (s) => vertical(s, -1),
  'org-delete-char': (s) => (s.pos >= s.text.length ? fail(s, 'End of buffer') : next(s, { text: s.text.slice(0, s.pos) + s.text.slice(s.pos + 1), mark: markerAfter(s.mark, s.pos, s.pos + 1, 0), edits: [{ from: s.pos, removed: s.text[s.pos], inserted: 0 }] })),
  'org-delete-backward-char': (s) =>
    s.pos <= 0 ? fail(s, 'Beginning of buffer') : next(s, { text: s.text.slice(0, s.pos - 1) + s.text.slice(s.pos), pos: s.pos - 1, mark: markerAfter(s.mark, s.pos - 1, s.pos, 0), edits: [{ from: s.pos - 1, removed: s.text[s.pos - 1], inserted: 0 }] }),
  'kill-word': (s) => kill(s, s.pos, forwardWord(s.text, s.pos), true),
  'backward-kill-word': (s) => kill(s, backwardWord(s.text, s.pos), s.pos, false),
  'org-kill-line': (s) => {
    if (s.pos >= s.text.length) return fail(s, 'End of buffer');
    const end = lineEnd(s.text, s.pos);
    const blank = /^[ \t]*$/.test(s.text.slice(s.pos, end));
    return kill(s, s.pos, blank && end < s.text.length ? end + 1 : end, true);
  },
  'set-mark-command': (s) => next(s, { mark: s.pos }),
  'exchange-point-and-mark': (s) => (s.mark === null ? fail(s, 'No mark set in this buffer') : next(s, { pos: s.mark, mark: s.pos })),
  'kill-region': (s) => (s.mark === null ? fail(s, 'The mark is not active now') : kill(s, Math.min(s.pos, s.mark), Math.max(s.pos, s.mark), s.mark > s.pos)),
  'kill-ring-save': (s) => {
    if (s.mark === null) return fail(s, 'The mark is not active now');
    const piece = s.text.slice(Math.min(s.pos, s.mark), Math.max(s.pos, s.mark));
    const appended = s.last === 'kill-region' && s.kill.length > 0;
    return next(s, { kill: appended ? [s.kill[0] + piece, ...s.kill.slice(1)] : [piece, ...s.kill], yankAt: 0, last: 'kill-region' });
  },
  'org-yank': (s) => {
    if (s.kill.length === 0) return fail(s, 'Kill ring is empty');
    const done = orgYank(s.text, s.pos, s.kill[s.yankAt ?? 0], s.yank ?? { adjusted: false, folded: true });
    return next(s, { text: done.text, pos: done.pos, mark: done.mark });
  },
  'self-insert-command': (s) => {
    const ch = s.arg ?? '';
    return next(s, { text: s.text.slice(0, s.pos) + ch + s.text.slice(s.pos), pos: s.pos + ch.length, mark: markerAfter(s.mark, s.pos, s.pos, ch.length), edits: [{ from: s.pos, removed: '', inserted: ch.length }] });
  },
  'org-open-line': (s) => next(s, { text: s.text.slice(0, s.pos) + '\n' + s.text.slice(s.pos), mark: markerAfter(s.mark, s.pos, s.pos, 1), edits: [{ from: s.pos, removed: '', inserted: 1 }] }),
  'transpose-chars': (s) => {
    let at = s.pos;
    if (at === s.text.length || s.text[at] === '\n') at = Math.max(0, at - 1);
    if (at === 0) return fail(s, 'Beginning of buffer', { pos: at });
    return { ...swap(s, at - 1, at, at, at + 1), pos: at + 1 };
  },
  'org-transpose-words': transposeWords,
  'upcase-word': (s) => casify(s, (x) => x.toUpperCase()),
  'downcase-word': (s) => casify(s, (x) => x.toLowerCase()),
  'capitalize-word': (s) => casify(s, capitalize),
  'delete-horizontal-space': (s) => {
    let from = s.pos;
    let to = s.pos;
    while (from > 0 && /[ \t]/.test(s.text[from - 1])) from -= 1;
    while (to < s.text.length && /[ \t]/.test(s.text[to])) to += 1;
    return next(s, { text: s.text.slice(0, from) + s.text.slice(to), pos: from, mark: markerAfter(s.mark, from, to, 0), edits: [{ from, removed: s.text.slice(from, to), inserted: 0, pt: from }] });
  },
  'just-one-space': (s) => {
    let from = s.pos;
    let to = s.pos;
    while (from > 0 && /[ \t]/.test(s.text[from - 1])) from -= 1;
    while (to < s.text.length && /[ \t]/.test(s.text[to])) to += 1;
    return next(s, { text: s.text.slice(0, from) + ' ' + s.text.slice(to), pos: from + 1, mark: markerAfter(s.mark, from, to, 1) });
  },
  'back-to-indentation': (s) => {
    const start = lineStart(s.text, s.pos);
    return next(s, { pos: start + (/^[ \t]*/.exec(s.text.slice(start, lineEnd(s.text, s.pos)))?.[0].length ?? 0) });
  },
};

/** Moves over `n` words, forward or back, as far as there are words. @param {string} text @param {number} pos @param {number} n */
function wordsFrom(text, pos, n) {
  let at = pos;
  for (let i = 0; i < Math.abs(n); i += 1) at = n > 0 ? forwardWord(text, at) : backwardWord(text, at);
  return at;
}

/** `forward-char` by `n`: as far as the buffer goes, then the error. @param {EditState} s @param {number} n */
function moveChars(s, n) {
  const to = s.pos + n;
  if (to > s.text.length) return fail(s, 'End of buffer', { pos: s.text.length });
  if (to < 0) return fail(s, 'Beginning of buffer', { pos: 0 });
  return next(s, { pos: to });
}

/** `next-line` by `n` lines, a line at a time. @param {EditState} s @param {number} n */
function moveLines(s, n) {
  let cur = s;
  for (let i = 0; i < Math.abs(n); i += 1) {
    cur = vertical(cur, n > 0 ? 1 : -1);
    if (cur.error) return cur;
  }
  return cur;
}

/** `delete-char` by `n`. @param {EditState} s @param {number} n */
function deleteChars(s, n) {
  if (n === 0) return next(s, {});
  const from = n > 0 ? s.pos : s.pos + n;
  const to = n > 0 ? s.pos + n : s.pos;
  if (to > s.text.length) return fail(s, 'End of buffer');
  if (from < 0) return fail(s, 'Beginning of buffer');
  return next(s, { text: s.text.slice(0, from) + s.text.slice(to), pos: from, mark: markerAfter(s.mark, from, to, 0), edits: [{ from, removed: s.text.slice(from, to), inserted: 0 }] });
}

/** Where `forward-line n` from `pos` ends: the start of the line `n` lines on, or the end of the buffer. @param {string} text @param {number} pos @param {number} n */
function forwardLine(text, pos, n) {
  let at = n > 0 ? pos : lineStart(text, pos);
  if (n > 0) {
    for (let i = 0; i < n; i += 1) {
      const e = lineEnd(text, at);
      if (e >= text.length) return text.length;
      at = e + 1;
    }
    return at;
  }
  for (let i = 0; i < -n; i += 1) {
    if (at === 0) return 0;
    at = lineStart(text, at - 1);
  }
  return at;
}

/** `kill-line` with a numeric argument. @param {EditState} s @param {number} n */
function killLines(s, n) {
  const to = n === 0 ? lineStart(s.text, s.pos) : forwardLine(s.text, s.pos, n);
  return to >= s.pos ? kill(s, s.pos, to, true) : kill(s, to, s.pos, false);
}

/** `move-beginning-of-line` and `move-end-of-line` with an argument: `n - 1` lines on, then to the line's edge.
 * @param {EditState} s @param {number} n @param {boolean} end */
function moveToLineEdge(s, n, end) {
  const lines = moveLines(s, n - 1);
  const at = lines.pos;
  return next(s, { pos: end ? lineEnd(s.text, at) : lineStart(s.text, at) });
}

/** `upcase-word` and its kin with an argument: forward words move on; negative ones change the words before and stay.
 * @param {EditState} s @param {(x: string) => string} fn @param {number} n */
function casifyWords(s, fn, n) {
  const other = wordsFrom(s.text, s.pos, n);
  const from = Math.min(s.pos, other);
  const to = Math.max(s.pos, other);
  const text = replaceRange(s.text, from, to, fn);
  return next(s, { text, pos: n > 0 ? other : s.pos, edits: from === to ? [] : [{ from, removed: s.text.slice(from, to), inserted: to - from + text.length - s.text.length, markers: false }] });
}

/** The commands that take a prefix argument: what each does with it. @type {Record<string, (s: EditState, n: number, universal: boolean) => EditState>} */
const COUNTED = {
  'forward-char': (s, n) => moveChars(s, n),
  'backward-char': (s, n) => moveChars(s, -n),
  'forward-word': (s, n) => next(s, { pos: wordsFrom(s.text, s.pos, n) }),
  'backward-word': (s, n) => next(s, { pos: wordsFrom(s.text, s.pos, -n) }),
  'next-line': (s, n) => moveLines(s, n),
  'previous-line': (s, n) => moveLines(s, -n),
  'org-delete-char': (s, n) => deleteChars(s, n),
  'org-delete-backward-char': (s, n) => deleteChars(s, -n),
  'kill-word': (s, n) => {
    const to = wordsFrom(s.text, s.pos, n);
    return to >= s.pos ? kill(s, s.pos, to, true) : kill(s, to, s.pos, false);
  },
  'backward-kill-word': (s, n) => {
    const to = wordsFrom(s.text, s.pos, -n);
    return to >= s.pos ? kill(s, s.pos, to, true) : kill(s, to, s.pos, false);
  },
  'org-kill-line': (s, n) => killLines(s, n),
  'org-beginning-of-line': (s, n) => moveToLineEdge(s, n, false),
  'org-end-of-line': (s, n) => moveToLineEdge(s, n, true),
  'upcase-word': (s, n) => casifyWords(s, (x) => x.toUpperCase(), n),
  'downcase-word': (s, n) => casifyWords(s, (x) => x.toLowerCase(), n),
  'capitalize-word': (s, n) => casifyWords(s, capitalize, n),
  'org-open-line': (s, n) => (n < 0 ? fail(s, 'Repetition argument has to be non-negative') : n === 0 ? next(s, { pos: lineEnd(s.text, s.pos) }) : next(s, { text: s.text.slice(0, s.pos) + '\n'.repeat(n) + s.text.slice(s.pos), mark: markerAfter(s.mark, s.pos, s.pos, n), edits: [{ from: s.pos, removed: '', inserted: n }] })),
  'self-insert-command': (s, n) => {
    if (n < 0) return fail(s, `Negative repetition argument ${n}`);
    const ch = (s.arg ?? '').repeat(n);
    return next(s, { text: s.text.slice(0, s.pos) + ch + s.text.slice(s.pos), pos: s.pos + ch.length, mark: markerAfter(s.mark, s.pos, s.pos, ch.length), edits: [{ from: s.pos, removed: '', inserted: ch.length }] });
  },
  'org-yank': (s, n, universal) => {
    if (s.kill.length === 0) return fail(s, 'Kill ring is empty');
    const at = universal ? (s.yankAt ?? 0) : (((s.yankAt ?? 0) + n - 1) % s.kill.length + s.kill.length) % s.kill.length;
    const piece = s.kill[at];
    const text = s.text.slice(0, s.pos) + piece + s.text.slice(s.pos);
    const edits = [{ from: s.pos, removed: '', inserted: piece.length }];
    return universal
      ? next(s, { text, pos: s.pos, mark: s.pos + piece.length, edits, yankAt: at })
      : next(s, { text, pos: s.pos + piece.length, mark: s.pos, edits, yankAt: at });
  },
};

/** `next-line` and `previous-line` on logical lines, keeping the goal column. @param {EditState} s @param {1 | -1} dir */
function vertical(s, dir) {
  const goal = s.goal ?? s.pos - lineStart(s.text, s.pos);
  const here = lineStart(s.text, s.pos);
  if (dir === 1) {
    const end = lineEnd(s.text, s.pos);
    if (end >= s.text.length) return { ...fail(s, 'End of buffer', { pos: end }), goal };
    const start = end + 1;
    return { ...s, goal, pos: Math.min(start + goal, lineEnd(s.text, start)) };
  }
  if (here === 0) return { ...fail(s, 'Beginning of buffer', { pos: 0 }), goal };
  const start = lineStart(s.text, here - 1);
  return { ...s, goal, pos: Math.min(start + goal, here - 1) };
}

/** @param {EditState} s @param {(x: string) => string} fn */
function casify(s, fn) {
  const end = forwardWord(s.text, s.pos);
  const text = replaceRange(s.text, s.pos, end, fn);
  return next(s, { text, pos: end, edits: end === s.pos ? [] : [{ from: s.pos, removed: s.text.slice(s.pos, end), inserted: text.length - s.text.length + end - s.pos, markers: false }] });
}

/** Word constituents of `org-transpose-words`: the characters of `org-emphasis-alist` count too. @param {string} ch */
const isTransposeWord = (ch) => isWord(ch) || '*/_=~+'.includes(ch);

/** `org-transpose-words`: the word before the caret trades places with the word after it. @param {EditState} s */
function transposeWords(s) {
  const t = s.text;
  const s1 = backwardWord(t, s.pos, isTransposeWord);
  const e1 = forwardWord(t, s1, isTransposeWord);
  const e2 = forwardWord(t, e1, isTransposeWord);
  const s2 = backwardWord(t, e2, isTransposeWord);
  if (e1 > s2) return fail(s, "Don't have two things to transpose", { pos: s2 });
  return { ...swap(s, s1, e1, s2, e2), pos: e2 };
}

/**
 * `transpose-subr-1`: the text `s2..e2` goes in before `s1..e1` and then out from its old place, one step at a time, so that markers
 * at the ends of the two keep their places; the steps are what the undo list records.
 * @param {EditState} s @param {number} s1 @param {number} e1 @param {number} s2 @param {number} e2 @returns {EditState}
 */
function swap(s, s1, e1, s2, e2) {
  const len1 = e1 - s1;
  const len2 = e2 - s2;
  const word = s.text.slice(s2, e2);
  /** @type {Edit[]} */ const edits = [];
  let text = s.text.slice(0, e1) + word + s.text.slice(e1);
  let mark = s.mark !== null && s.mark >= e1 ? s.mark + len2 : s.mark;
  edits.push({ from: e1, removed: '', inserted: len2, mark });
  let boundaryAt = s2 + len2;
  const first = text.slice(s1, e1);
  edits.push({ from: s1, removed: first, inserted: 0, pt: e1 + len2, mark });
  text = text.slice(0, s1) + text.slice(e1);
  mark = markerAfter(mark, s1, e1, 0);
  boundaryAt -= len1;
  text = text.slice(0, boundaryAt) + first + text.slice(boundaryAt);
  mark = markerAfter(mark, boundaryAt, boundaryAt, len1);
  edits.push({ from: boundaryAt, removed: '', inserted: len1, mark });
  const old = text.slice(boundaryAt + len1, boundaryAt + len1 + len2);
  edits.push({ from: boundaryAt + len1, removed: old, inserted: 0, pt: boundaryAt + len1, mark });
  text = text.slice(0, boundaryAt + len1) + text.slice(boundaryAt + len1 + len2);
  mark = markerAfter(mark, boundaryAt + len1, boundaryAt + len1 + len2, 0);
  return next(s, { text, mark, edits });
}

const KILLS = new Set(['kill-word', 'backward-kill-word', 'org-kill-line', 'kill-region']);

/** The commands that join the group of the one before them (`undo-auto-amalgamate`). */
const AMALGAMATING = new Set(['self-insert-command', 'org-delete-char', 'org-delete-backward-char', 'org-open-line']);

/** The one edit that turns `a` into `b`, from their common prefix and suffix. @param {string} a @param {string} b @returns {Edit[]} */
function diffEdit(a, b) {
  if (a === b) return [];
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q += 1;
  return [{ from: p, removed: a.slice(p, a.length - q), inserted: b.length - q - p }];
}

/** Whether the region is active after a command: `set-mark-command` activates it (two in a row deactivate it), `exchange-point-and-mark` activates it, and a change of the text, `kill-region` and `kill-ring-save` end it.
 * @param {EditState} before @param {EditState} after @param {string} name @param {boolean} changed */
function regionActive(before, after, name, changed) {
  if (name === 'set-mark-command') return before.last !== 'set-mark-command'; // two in a row leave the mark set and the region off
  if (name === 'exchange-point-and-mark') return after.error ? before.active : true;
  if (name === 'kill-region' || name === 'kill-ring-save' || changed) return false;
  return before.active;
}

/**
 * Takes in a change made to the text from outside the commands (a word the device keyboard composed, a paste, a toolbar button): the
 * undo list gets it as the one change that turns the old text into the new, ended by a boundary, and the region ends.
 * @param {EditState} state @param {string} text the text now @param {number} pos where the caret is now
 * @returns {EditState}
 */
export function syncExternal(state, text, pos) {
  if (text === state.text) return { ...state, pos };
  const u = state.undo ?? newUndo();
  u.ptBefore = state.pos;
  const [change] = diffEdit(state.text, text);
  if (change.removed) recordDelete(u, change.from, change.removed, state.pos, state.mark, true);
  if (change.inserted) recordInsert(u, change.from, change.inserted);
  boundary(u, pos);
  u.amalgamated = null;
  const mark = markerAfter(state.mark, change.from, change.from + change.removed.length, change.inserted);
  return { ...state, text, pos, mark, active: false, undo: u, goal: null, last: 'external' };
}

/**
 * Runs one command by its Emacs name; `arg` is the character for `self-insert-command`.
 * @param {EditState} state @param {string} name @param {string} [arg]
 * @param {{ n: number, universal: boolean }} [prefix] the prefix argument
 * @returns {EditState}
 */
export function execute(state, name, arg, prefix) {
  const u = state.undo ?? newUndo();
  u.ptBefore = state.pos;
  if (name === 'undo') {
    const buf = { text: state.text, pos: state.pos, mark: state.mark };
    const { error } = undo(u, buf, state.last);
    boundary(u, buf.pos);
    u.amalgamated = null;
    return { ...state, ...buf, active: buf.text === state.text ? state.active : false, edits: undefined, goal: null, undo: u, last: error ? 'undo-start' : 'undo', error };
  }
  const counted = prefix ? COUNTED[name] : undefined;
  if (prefix && !counted) return { ...state, goal: null, error: `${name} does not take a prefix argument yet`, last: name };
  const run = counted && prefix ? (/** @type {EditState} */ st) => counted(st, prefix.n, prefix.universal) : COMMANDS[name];
  if (!run) throw new Error(`unknown command ${name}`);
  if (AMALGAMATING.has(name) && u.amalgamated !== null) {
    if (u.amalgamated < 20 && name === state.last && u.list && u.list.e === null) u.list = u.list.next;
    else u.amalgamated = -1;
  }
  const done = run({ ...state, arg, edits: undefined, error: undefined, undo: u });
  const edits = done.edits ?? diffEdit(state.text, done.text);
  for (const e of edits) {
    if (e.removed) recordDelete(u, e.from, e.removed, e.pt ?? state.pos, e.mark === undefined ? state.mark : e.mark, e.markers !== false);
    if (e.inserted) recordInsert(u, e.from, e.inserted);
  }
  boundary(u, done.pos);
  u.amalgamated = AMALGAMATING.has(name) ? (u.amalgamated === null ? 0 : u.amalgamated + 1) : null;
  const verticalMove = name === 'next-line' || name === 'previous-line';
  return { ...done, active: regionActive(state, done, name, edits.length > 0), edits: undefined, arg: undefined, undo: u, goal: verticalMove ? done.goal : null, last: KILLS.has(name) ? 'kill-region' : name };
}
