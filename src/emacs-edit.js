// @ts-check
/**
 * Emacs mode, the editing core: the commands of Emacs's default keymap that change the text or move the caret, on the text of a buffer.
 * A state is `{ text, pos, mark, kill, last, goal }`: the caret and the mark as 0-based offsets (`mark` is null when unset), the kill
 * ring (newest first), the kind of the previous command (`last`, for kill appending) and the goal column of vertical movement.
 */
import { EMACS_ALNUM_RE } from './emacs-chars.js';
import { orgYank } from './org-yank.js';
import { orgBackwardSentence, orgForwardSentence } from './emacs-sentence.js';
import { boundary, newUndo, recordDelete, recordInsert, redo, undo } from './emacs-undo.js';

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
 * @property {Edit[]} [applied] what the last command did to the text, one edit after the other, for whatever follows the text (folds)
 * @property {{ orig: number, ws: string, n: string | number | null, last: string | null }} [cycle] `cycle-spacing--context`, kept while the command repeats
 * @property {string} [error] set when the command signaled an error: the state is then what Emacs leaves
 */

/** @typedef {{ from: number, removed: string, inserted: number, pt?: number, mark?: number | null, markers?: boolean, wrap?: boolean, insertFirst?: boolean }} Edit `wrap`: part of a change Emacs records as one wrapped entry (an adjusted subtree paste) */

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
  'beginning-of-buffer': (s) => bufferEnd(s, false, null, false),
  'end-of-buffer': (s) => bufferEnd(s, true, null, false),
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
  'mark-whole-buffer': (s) => next(s, { pos: 0, mark: s.text.length }),
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
    const piece = s.kill[s.yankAt ?? 0];
    const done = orgYank(s.text, s.pos, piece, s.yank ?? { adjusted: false, folded: true });
    // a plain paste is an insertion at the caret; telling it from the text alone could put it a character off when the text repeats
    const plain = done.text === s.text.slice(0, s.pos) + piece + s.text.slice(s.pos);
    const edits = plain ? [{ from: s.pos, removed: '', inserted: piece.length }] : diffEdit(s.text, done.text);
    return next(s, { text: done.text, pos: done.pos, mark: done.mark, edits: done.wrapped ? edits.map((e) => ({ ...e, wrap: true })) : edits });
  },
  'self-insert-command': (s) => {
    const ch = s.arg ?? '';
    return next(s, { text: s.text.slice(0, s.pos) + ch + s.text.slice(s.pos), pos: s.pos + ch.length, mark: markerAfter(s.mark, s.pos, s.pos, ch.length), edits: [{ from: s.pos, removed: '', inserted: ch.length }] });
  },
  'org-open-line': (s) => next(s, { text: s.text.slice(0, s.pos) + '\n' + s.text.slice(s.pos), mark: markerAfter(s.mark, s.pos, s.pos, 1), edits: [{ from: s.pos, removed: '', inserted: 1 }] }),
  'transpose-chars': (s) => transposeChars(s, null),
  'org-transpose-words': transposeWords,
  'upcase-word': (s) => casify(s, (x) => x.toUpperCase()),
  'downcase-word': (s) => casify(s, (x) => x.toLowerCase()),
  'capitalize-word': (s) => casify(s, capitalize),
  'delete-horizontal-space': (s) => deleteSpace(s, false),
  'just-one-space': (s) => justOneSpace(s, 1),
  'delete-blank-lines': deleteBlankLines,
  'cycle-spacing': (s) => cycleSpacing(s, undefined),
  'yank-pop': (s) => yankPop(s, 1),
  'org-forward-sentence': (s) => sentence(s, true, 1),
  'org-backward-sentence': (s) => sentence(s, false, 1),
  'back-to-indentation': (s) => {
    const start = lineStart(s.text, s.pos);
    return next(s, { pos: start + (/^[ \t]*/.exec(s.text.slice(start, lineEnd(s.text, s.pos)))?.[0].length ?? 0) });
  },
};

/** `beginning-of-buffer` and `end-of-buffer`: the mark is left where the caret was unless the region is active or the prefix is `C-u`; a number goes N tenths of the way, to the start of a line.
 * @param {EditState} s @param {boolean} end @param {number | null} n @param {boolean} universal */
function bufferEnd(s, end, n, universal) {
  const size = s.text.length;
  const mark = universal || s.active ? s.mark : s.pos;
  if (n === null || universal) return next(s, { pos: end ? size : 0, mark });
  const part = Math.trunc((size * n) / 10);
  const at = Math.max(0, Math.min(size, end ? size - part : 1 + part));
  return next(s, { pos: forwardLine(s.text, at, 1), mark });
}

/** `transpose-chars`: with no argument at the end of a line the two characters before the caret change places; with one, the character before the caret is dragged `n` characters on (back when negative), and 0 trades the characters at the caret and the mark.
 * @param {EditState} s @param {number | null} n */
function transposeChars(s, n) {
  const len = s.text.length;
  let p = s.pos;
  if (n === null && (p === len || s.text[p] === '\n') && p > 0) p -= 1;
  const k = n ?? 1;
  if (k > 0) {
    if (p === 0) return fail(s, 'Beginning of buffer', { pos: 0 });
    if (p + k > len) return fail(s, 'End of buffer', { pos: len });
    return { ...swap(s, p - 1, p, p, p + k), pos: p + k };
  }
  if (k < 0) {
    if (p === 0) return fail(s, 'Beginning of buffer', { pos: 0 });
    if (p - 1 + k < 0) return fail(s, 'Beginning of buffer', { pos: 0 });
    return { ...swap(s, p - 1 + k, p - 1, p - 1, p), pos: p + k };
  }
  if (p === len) return fail(s, 'End of buffer', { pos: len });
  if (s.mark === null) return fail(s, 'No mark set in this buffer');
  if (s.mark === len) return fail(s, 'End of buffer', { pos: p });
  if (s.mark === p) return fail(s, "Don't have two things to transpose", { pos: p });
  const [a, b] = p < s.mark ? [p, s.mark] : [s.mark, p];
  if (a + 1 > b) return fail(s, "Don't have two things to transpose", { pos: p });
  const done = swap(s, a, a + 1, b, b + 1);
  return { ...done, pos: s.mark, mark: p };
}

/** `delete-horizontal-space`: the spaces and tabs around the caret, or only before it with `backward-only`. @param {EditState} s @param {boolean} backwardOnly */
function deleteSpace(s, backwardOnly) {
  let from = s.pos;
  let to = s.pos;
  while (from > 0 && /[ \t]/.test(s.text[from - 1])) from -= 1;
  if (!backwardOnly) while (to < s.text.length && /[ \t]/.test(s.text[to])) to += 1;
  return next(s, { text: s.text.slice(0, from) + s.text.slice(to), pos: from, mark: markerAfter(s.mark, from, to, 0), edits: [{ from, removed: s.text.slice(from, to), inserted: 0, pt: from }] });
}

/** `just-one-space` with `n`: the spaces and tabs around the caret (and the newlines when `n` is negative) become `|n|` spaces, reusing the spaces right after the caret's run.
 * @param {EditState} s @param {number} n */
function justOneSpace(s, n) {
  const skip = n < 0 ? /[ \t\n\r]/ : /[ \t]/;
  const t = s.text;
  let from = s.pos;
  while (from > 0 && skip.test(t[from - 1])) from -= 1;
  let kept = 0;
  while (kept < Math.abs(n) && t[from + kept] === ' ') kept += 1;
  const mid = from + kept;
  let to = mid;
  while (to < t.length && skip.test(t[to])) to += 1;
  const added = Math.abs(n) - kept;
  const text = t.slice(0, mid) + ' '.repeat(added) + t.slice(to);
  return next(s, { text, pos: mid + added, mark: markerAfter(s.mark, mid, to, added), edits: mid === to && added === 0 ? [] : [{ from: mid, removed: t.slice(mid, to), inserted: added }] });
}

/** `delete-blank-lines`: on a blank line the blank lines around it go, leaving one (none when it is the only one); on other lines the blank lines after it go.
 * @param {EditState} s */
function deleteBlankLines(s) {
  let t = s.text;
  let pt = s.pos;
  let mark = s.mark;
  const blank = (/** @type {number} */ at) => /^[ \t]*$/.test(t.slice(at, lineEnd(t, at)));
  /** @param {number} from @param {number} to */
  const cut = (from, to) => {
    if (to <= from) return;
    t = t.slice(0, from) + t.slice(to);
    mark = markerAfter(mark, from, to, 0);
    pt = pt >= to ? pt - (to - from) : pt > from ? from : pt;
  };
  const here = lineStart(t, pt);
  const thisBlank = blank(here);
  const nextEnd = lineEnd(t, here);
  const singleBlank = thisBlank && !(nextEnd < t.length && blank(nextEnd + 1)) && (here === 0 || !blank(lineStart(t, here - 1)));
  const original = s.text;
  /** @type {Edit[]} */ const edits = [];
  /** @param {number} from @param {number} to */
  const record = (from, to) => {
    if (to > from) edits.push({ from, removed: t.slice(from, to), inserted: 0, pt });
    cut(from, to);
  };
  if (thisBlank) {
    const at = singleBlank ? forwardLine(t, here, 1) : here;
    let i = at - 1;
    while (i >= 0 && /[ \t\n]/.test(t[i])) i -= 1;
    const from = i >= 0 ? forwardLine(t, i, 1) : 0;
    pt = at;
    record(from, at);
  }
  if (!(thisBlank && singleBlank)) {
    const at = forwardLine(t, lineEnd(t, pt), 1);
    const m = /[^ \t\n]/.exec(t.slice(at));
    const to = m ? lineStart(t, at + m.index) : t.length;
    record(at, to);
  }
  if (lineStart(t, pt) === pt && /^[ \t]*\n$/.test(t.slice(pt))) record(pt, t.length);
  return next(s, { text: t, pos: pt, mark, edits: t === original ? [] : edits });
}

/** `cycle-spacing` (`M-SPC`): the actions of `cycle-spacing-actions` in turn on the whitespace around the caret, then the whitespace as it was. `raw` is the prefix argument.
 * @param {EditState} s @param {{ n: number, universal: boolean } | undefined} raw */
function cycleSpacing(s, raw) {
  const key = raw ? (raw.universal ? 'u' : raw.n) : null;
  const t = s.text;
  let ctx = s.cycle;
  if (s.last !== 'cycle-spacing' || !ctx || (key !== null && key !== ctx.n)) {
    let a = s.pos;
    let b = s.pos;
    while (a > 0 && /[ \t\n\r]/.test(t[a - 1])) a -= 1;
    while (b < t.length && /[ \t\n\r]/.test(t[b])) b += 1;
    ctx = { orig: s.pos, ws: t.slice(a, b), n: key, last: null };
  }
  const actions = ['just-one-space', 'delete-all-space', 'restore'];
  const action = ctx.last === null ? actions[0] : actions[(actions.indexOf(ctx.last) + 1) % actions.length];
  // restore: the whitespace around the caret goes back to what it was
  let a = s.pos;
  let b = s.pos;
  while (a > 0 && /[ \t\n\r]/.test(t[a - 1])) a -= 1;
  while (b < t.length && /[ \t\n\r]/.test(t[b])) b += 1;
  /** @type {EditState} */
  let cur = { ...s, text: t.slice(0, a) + ctx.ws + t.slice(b), pos: ctx.orig, mark: ctx.ws === t.slice(a, b) ? s.mark : markerAfter(s.mark, a, b, ctx.ws.length), edits: undefined };
  if (action !== 'restore') {
    const numeric = ctx.n === null ? 1 : ctx.n === 'u' ? 4 : ctx.n;
    const newlines = typeof numeric === 'number' && numeric < 0;
    if (action === 'just-one-space') cur = justOneSpace(cur, numeric);
    else if (newlines) {
      let from = cur.pos;
      let to = cur.pos;
      while (from > 0 && /[ \t\n\r]/.test(cur.text[from - 1])) from -= 1;
      while (to < cur.text.length && /[ \t\n\r]/.test(cur.text[to])) to += 1;
      cur = { ...cur, text: cur.text.slice(0, from) + cur.text.slice(to), pos: from, mark: markerAfter(cur.mark, from, to, 0) };
    } else cur = deleteSpace(cur, false);
  }
  // Emacs replaces the whitespace around the caret even when what goes back is the same, so the change is recorded for undo either way
  const inserted = cur.text.length - (t.length - (b - a));
  // the whitespace is deleted whole and the new one inserted, so a mark inside or at the end of it goes to its start
  if (action === 'just-one-space' && s.mark !== null && s.mark !== undefined) cur = { ...cur, mark: s.mark >= a && s.mark <= b ? a : s.mark > b ? s.mark + inserted - (b - a) : s.mark };
  const edits = ctx.last === null && cur.edits?.length && !(b === s.pos && /\n/.test(t.slice(a, b))) ? cur.edits : a === b && inserted === 0 ? [] : [{ from: a, removed: t.slice(a, b), inserted }];
  return next(s, { text: cur.text, pos: cur.pos, mark: cur.mark, edits, cycle: { ...ctx, last: action } });
}

/**
 * The edits that turn `a` into `b` when `b` has the same lines with some replaced, the way Org's table alignment makes them: for each row
 * that differs, the new row is inserted and the old one deleted. A different number of lines is one edit from the first difference to the last.
 * @param {string} a @param {string} b @param {number | null} mark @returns {{ edits: Edit[], mark: number | null }}
 */
function replacedRows(a, b, mark) {
  const la = a.split('\n');
  const lb = b.split('\n');
  if (lb.length === la.length + 1) {
    // a row added after the table was aligned (the next field past the last one): the aligned rows, then the new row
    const squash = (/** @type {string} */ l) => l.replace(/\s+/g, '').replace(/-+/g, '-');
    for (let k = lb.length - 1; k >= 0; k -= 1) {
      const rest = lb.filter((_, i) => i !== k);
      if (/^[ \t]*\|[ |+-]*$/.test(lb[k]) && rest.every((l, i) => squash(l) === squash(la[i]) || (la[i] === l))) {
        const aligned = replacedRows(a, rest.join('\n'), mark);
        const from = lb.slice(0, k).reduce((n, l) => n + l.length + 1, 0);
        return { edits: [...aligned.edits, { from, removed: '', inserted: lb[k].length + 1 }], mark: aligned.mark === null ? null : markerAfter(aligned.mark, from, from, lb[k].length + 1) };
      }
    }
  }
  if (la.length !== lb.length) {
    const edits = diffEdit(a, b);
    return { edits, mark: mark === null ? null : markerAfter(mark, edits[0].from, edits[0].from + edits[0].removed.length, edits[0].inserted) };
  }
  /** @type {Edit[]} */ const edits = [];
  let m = mark;
  let start = 0;
  for (let i = 0; i < la.length; i += 1) {
    if (la[i] !== lb[i]) {
      const oldLen = la[i].length + 1;
      const newLen = lb[i].length + 1;
      edits.push({ from: start, removed: la[i] + '\n', inserted: newLen, insertFirst: true });
      if (m !== null && m > start) m = m >= start + oldLen ? m + newLen - oldLen : start + newLen;
    }
    start += lb[i].length + 1;
  }
  return { edits, mark: m };
}

/** `org-forward-sentence` and `org-backward-sentence` by `n` sentences: the caret moves, and an error leaves it where the command was. @param {EditState} s @param {boolean} forward @param {number} n */
function sentence(s, forward, n) {
  const done = forward ? orgForwardSentence(s.text, s.pos, n) : orgBackwardSentence(s.text, s.pos, n);
  const changed = done.text !== undefined && done.text !== s.text;
  if (changed) {
    // a table is aligned on the way to another field: Org replaces each row that changed, inserting the new row and then deleting the old
    const { edits, mark } = replacedRows(s.text, done.text ?? s.text, s.mark);
    const at = { text: done.text, pos: done.pos, mark, edits };
    return done.error ? fail(s, done.error, at) : next(s, at);
  }
  return done.error ? fail(s, done.error, { pos: done.pos }) : next(s, { pos: done.pos });
}

/** `yank-pop` (`M-y`) right after a yank: the yanked text becomes the `n`th next kill. @param {EditState} s @param {number} n */
function yankPop(s, n) {
  if (s.last !== 'yank') return fail(s, 'Previous command was not a yank');
  if (s.mark === null) return fail(s, 'Wrong type argument: number-or-marker-p, nil');
  const len = s.kill.length;
  const at = (((s.yankAt ?? 0) + n) % len + len) % len;
  const before = s.pos < s.mark;
  const from = Math.min(s.pos, s.mark);
  const to = Math.max(s.pos, s.mark);
  const piece = s.kill[at];
  const text = s.text.slice(0, from) + piece + s.text.slice(to);
  /** @type {Edit[]} */
  const edits = [];
  if (to > from) edits.push({ from, removed: s.text.slice(from, to), inserted: 0, pt: s.pos });
  if (piece) edits.push({ from, removed: '', inserted: piece.length });
  return next(s, { text, pos: before ? from : from + piece.length, mark: before ? from + piece.length : from, yankAt: at, edits });
}

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
  'beginning-of-buffer': (s, n, u) => bufferEnd(s, false, n, u),
  'end-of-buffer': (s, n, u) => bufferEnd(s, true, n, u),
  'transpose-chars': (s, n) => transposeChars(s, n),
  'org-transpose-words': (s, n) => transposeWords(s, n),
  'exchange-point-and-mark': (s) => COMMANDS['exchange-point-and-mark'](s),
  'delete-horizontal-space': (s) => deleteSpace(s, true),
  'just-one-space': (s, n) => justOneSpace(s, n),
  'back-to-indentation': (s) => COMMANDS['back-to-indentation'](s),
  'delete-blank-lines': (s) => deleteBlankLines(s),
  'cycle-spacing': (s, n, u) => cycleSpacing(s, { n, universal: u }),
  'yank-pop': (s, n) => yankPop(s, n),
  'org-forward-sentence': (s, n) => sentence(s, true, n),
  'org-backward-sentence': (s, n) => sentence(s, false, n),
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

/** `org-transpose-words`: the word before the caret trades places with the word after it; `n` drags it over that many words (back when negative), and 0 trades the words at the caret and the mark.
 * @param {EditState} s @param {number} [n] */
function transposeWords(s, n = 1) {
  const t = s.text;
  const fwd = (/** @type {number} */ at, /** @type {number} */ k) => wordsFromWith(t, at, k);
  const s1 = fwd(s.pos, -1);
  const e1 = fwd(s1, 1);
  if (n > 0) {
    const e2 = fwd(e1, n);
    const s2 = fwd(e2, -n);
    if (e1 > s2) return fail(s, "Don't have two things to transpose", { pos: s2 });
    return { ...swap(s, s1, e1, s2, e2), pos: e2 };
  }
  if (n < 0) {
    const b = fwd(s1, n);
    const e = fwd(b, -n);
    if (e1 > b && b < e1 && e > s1) return fail(s, "Don't have two things to transpose", { pos: e });
    return { ...swap(s, b, e, s1, e1), pos: b + (e1 - s1) };
  }
  if (s.mark === null) return fail(s, 'No mark set in this buffer');
  const e1b = fwd(s.pos, 1);
  const s1b = fwd(e1b, -1);
  const e2 = fwd(s.mark, 1);
  const s2 = fwd(e2, -1);
  const [a, b, c, d] = s1b <= s2 ? [s1b, e1b, s2, e2] : [s2, e2, s1b, e1b];
  if (b > c) return fail(s, "Don't have two things to transpose", { pos: s.pos });
  return { ...swap(s, a, b, c, d), pos: s.mark, mark: s.pos };
}

/** Moves over `n` words by the syntax of `org-transpose-words`. @param {string} text @param {number} pos @param {number} n */
function wordsFromWith(text, pos, n) {
  let at = pos;
  for (let i = 0; i < Math.abs(n); i += 1) at = n > 0 ? forwardWord(text, at, isTransposeWord) : backwardWord(text, at, isTransposeWord);
  return at;
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
  if (name === 'mark-whole-buffer') return true;
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
  if (name === 'undo' || name === 'undo-redo') {
    const buf = { text: state.text, pos: state.pos, mark: state.mark, changed: false };
    const count = prefix && !prefix.universal ? Math.max(1, prefix.n) : 1;
    // with the region active (or a C-u prefix and a mark), undo changes only what is inside it
    const region = name === 'undo' && state.mark !== null && state.mark !== undefined && (state.active || prefix?.universal) ? { start: Math.min(state.pos, state.mark), end: Math.max(state.pos, state.mark) } : null;
    const noMark = name === 'undo' && prefix?.universal && !(state.mark !== null && state.mark !== undefined);
    if (noMark) return { ...state, goal: null, error: 'The mark is not set now, so there is no region', last: 'undo-start' };
    const { error } = name === 'undo' ? undo(u, buf, state.last, count, region) : redo(u, buf, count);
    boundary(u, buf.pos);
    u.amalgamated = null;
    return { ...state, text: buf.text, pos: buf.pos, mark: buf.mark, active: buf.changed ? false : state.active, edits: undefined, applied: buf.text === state.text ? [] : diffEdit(state.text, buf.text), goal: null, undo: u, last: error ? (name === 'undo' ? 'undo-start' : 'undo-redo') : 'undo', error };
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
    if (e.insertFirst) {
      recordInsert(u, e.from, e.inserted);
      recordDelete(u, e.from + e.inserted, e.removed, e.from + e.inserted, state.mark, true);
      continue;
    }
    if (e.removed) recordDelete(u, e.from, e.removed, e.pt ?? state.pos, e.mark === undefined ? state.mark : e.mark, e.markers !== false, e.wrap);
    if (e.inserted) recordInsert(u, e.from, e.inserted, e.wrap);
  }
  boundary(u, done.pos);
  u.amalgamated = AMALGAMATING.has(name) ? (u.amalgamated === null ? 0 : u.amalgamated + 1) : null;
  const active = name === 'exchange-point-and-mark' && prefix && !done.error ? false : regionActive(state, done, name, edits.length > 0);
  const verticalMove = name === 'next-line' || name === 'previous-line';
  return { ...done, active, edits: undefined, applied: edits, arg: undefined, undo: u, goal: verticalMove ? done.goal : null, last: KILLS.has(name) ? 'kill-region' : name === 'org-yank' || name === 'yank-pop' ? 'yank' : name };
}
