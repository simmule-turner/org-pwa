// @ts-check
/**
 * Emacs mode, Org's commands at the caret, on the text of a buffer: heading motion (`C-c C-n` and friends). Each takes the text and the
 * caret (0-based) and returns where the caret goes, or an error that leaves it where Emacs leaves it. Held to Emacs 29.3 by
 * test/emacs-org-oracle.test.js.
 */

/** @param {string} text @param {number} pos */
const lineStartAt = (text, pos) => (pos <= 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1);

/** The offsets where headings start. @param {string} text @returns {number[]} */
export function headingStarts(text) {
  /** @type {number[]} */ const out = [];
  const re = /^(\*+) /gm;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m.index);
  return out;
}

/** @param {string} text @param {number} at @returns {number} the level of the heading starting at `at` */
const levelAt = (text, at) => /^\*+/.exec(text.slice(at))?.[0].length ?? 0;

/**
 * @typedef {{ pos: number, error?: string }} Motion
 */

/** `org-next-visible-heading` (`C-c C-n`), `n` times. @param {string} text @param {number} pos @param {number} n @param {(p: number) => boolean} [visible] */
export function nextHeading(text, pos, n, visible = () => true) {
  const starts = headingStarts(text).filter(visible);
  let at = pos;
  for (let i = 0; i < n; i++) {
    const next = starts.find((s) => s > at);
    if (next === undefined) return { pos: text.length };
    at = next;
  }
  return { pos: at };
}

/** `org-previous-visible-heading` (`C-c C-p`). @param {string} text @param {number} pos @param {number} n @param {(p: number) => boolean} [visible] */
export function previousHeading(text, pos, n, visible = () => true) {
  const starts = headingStarts(text).filter(visible);
  let at = lineStartAt(text, pos); // it first goes to the start of the line
  for (let i = 0; i < n; i++) {
    const prev = [...starts].reverse().find((s) => s < at);
    if (prev === undefined) return { pos: 0 };
    at = prev;
  }
  return { pos: at };
}

/** The start of the heading the caret is in or after, or -1 before the first heading. @param {string} text @param {number} pos */
export function headingBefore(text, pos) {
  const starts = headingStarts(text);
  let best = -1;
  for (const s of starts) if (s <= pos) best = s;
  return best;
}

/**
 * `org-forward-heading-same-level` (`C-c C-f`) and `org-backward-heading-same-level` (`C-c C-b`), `n` times: to the next heading of the
 * level of the current one, staying where it is when a shallower heading or the end comes first.
 * @param {string} text @param {number} pos @param {number} n @param {boolean} forward
 * @returns {Motion}
 */
export function sameLevelHeading(text, pos, n, forward) {
  const starts = headingStarts(text);
  let at = pos;
  for (let i = 0; i < n; i++) {
    const here = headingBefore(text, at);
    if (here < 0) {
      if (!forward) return { pos: 0 };
      at = starts.find((s) => s > at) ?? text.length;
      continue;
    }
    const level = levelAt(text, here);
    const others = forward ? starts.filter((s) => s > here) : starts.filter((s) => s < here).reverse();
    const hit = others.find((s) => levelAt(text, s) <= level);
    at = hit !== undefined && levelAt(text, hit) === level ? hit : here;
  }
  return { pos: at };
}

/** `outline-up-heading` (`C-c C-u`), `n` times: to the parent heading. @param {string} text @param {number} pos @param {number} n @returns {Motion} */
export function upHeading(text, pos, n) {
  const starts = headingStarts(text);
  const here = headingBefore(text, pos);
  if (here < 0) return { pos: lineStartAt(text, pos), error: 'Before first heading' };
  let at = here;
  let level = levelAt(text, here);
  if (level <= 1) return { pos: here, error: 'Already at top level of the outline' };
  for (let i = 0; i < n && level > 1 && at > 0; i++) {
    const parent = [...starts].reverse().find((st) => st < at && levelAt(text, st) < level);
    if (parent === undefined) {
      at = 0; // no heading above is higher: the search stops at the start of the buffer
      break;
    }
    at = parent;
    level = levelAt(text, parent);
  }
  return { pos: at };
}

// ---- commands on list items, by the engine of src/list-struct.js
import { getTagsColumn, withTags } from './tags-column.js';
import { atItem, moveItemDown, moveItemUp, indentItem, outdentItem, toggleCheckbox, cycleListBullet, indentItemTree, outdentItemTree } from './list-struct.js';
import { tableEdit } from './emacs-table.js';
import { displayColumn, offsetAtColumn } from './emacs-edit.js';
import { timestampAt as stampAtPos, timestampChange } from './timestamp-edit.js';
import { isItemLine, itemEnd } from './list-edit.js';

/** @param {string} text @param {number} pos @returns {{ line: number, col: number }} */
function lineCol(text, pos) {
  let line = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < pos; i = text.indexOf('\n', i + 1)) line += 1;
  return { line, col: pos - lineStartAt(text, pos) };
}

/** @param {string[]} lines @param {number} line @param {number} col */
function offsetOf(lines, line, col) {
  let at = 0;
  for (let i = 0; i < line; i++) at += lines[i].length + 1;
  return at + Math.min(col, lines[line]?.length ?? 0);
}

/**
 * @typedef {{ text: string, pos: number, error?: string }} Change
 */

const BOX = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[@\d+\][ \t]+)?(\[[ xX-]\])/;

/**
 * Runs a list command of src/list-struct.js on the item at the caret. `where` says what becomes of the caret: `box` (it stays, but
 * inside a box that was rewritten it goes to the box's start), `indent` (the line's indentation changed), `move` (it goes with the item).
 * @param {string} text @param {number} pos @param {(lines: string[], line: number) => string[]} command @param {'box' | 'indent' | 'move'} where
 * @param {(lines: string[], line: number) => number} [newLine] the line the item ends up on, for `move`
 * @returns {Change}
 */
function onItem(text, pos, command, where, newLine) {
  const { line, col } = lineCol(text, pos);
  const lines = text.split('\n');
  try {
    const out = command(lines, line);
    if (where === 'move') return { text: out.join('\n'), pos: offsetOf(out, (newLine ?? (() => line))(lines, line), col) };
    const before = lines[line];
    const after = out[line];
    if (where === 'indent') {
      const lead = (/** @type {string} */ l) => /^[ \t]*/.exec(l)?.[0].length ?? 0;
      const bulletOf = (/** @type {string} */ l) => /^([ \t]*)((?:[-+*]|\d+[.)]|[A-Za-z][.)]))([ \t]*)/.exec(l);
      const d = lead(after) - lead(before);
      let c = d >= 0 ? (col <= lead(before) ? 0 : col + d) : col >= -d ? col + d : 0;
      const bOld = bulletOf(before);
      const bNew = bulletOf(after);
      let text2 = out;
      if (bOld && bNew && bOld[2] !== bNew[2]) {
        // the bullet was rewritten: the caret in it goes to where the text starts, and a caret right after the bullet leaves an extra space
        const startOld = bOld[1].length;
        const contentOld = startOld + bOld[2].length + bOld[3].length;
        const contentNew = bNew[1].length + bNew[2].length + bNew[3].length;
        if (col >= startOld) {
          if (col === startOld + bOld[2].length) {
            text2 = [...out];
            text2[line] = after.slice(0, contentNew) + ' ' + after.slice(contentNew);
            return { text: text2.join('\n'), pos: offsetOf(text2, line, contentNew) };
          }
          c = col <= contentOld ? contentNew : col + (contentNew - contentOld);
        }
      }
      const box = BOX.exec(after);
      const old = BOX.exec(before);
      if (box && old && d < 0 && old[1] === '[X]') {
        const at = after.indexOf(box[1], box[0].length - 3);
        if (c > at && c < at + 3) c = at;
      }
      return { text: text2.join('\n'), pos: offsetOf(text2, line, c) };
    }
    let c = col;
    const box = BOX.exec(after);
    const old = BOX.exec(before);
    if (box && old && box[1] !== old[1]) {
      const at = box[0].length - 3;
      if (c > at && c < at + 3) c = at;
    }
    return { text: out.join('\n'), pos: offsetOf(out, line, c) };
  } catch (e) {
    return { text, pos, error: /** @type {Error} */ (e).message };
  }
}

/** Whether the caret is on the line of a list item. @param {string} text @param {number} pos */
export const onItemLine = (text, pos) => atItem(text, lineStartAt(text, pos));

/** `org-move-item-up` (`M-up`). @param {string} text @param {number} pos */
export const moveItemUpAt = (text, pos) => onItem(text, pos, (l, n) => moveItemUp(l, n), 'move', (l, n) => {
  const indent = /^[ \t]*/.exec(l[n])?.[0].length ?? 0;
  for (let k = n - 1; k >= 0; k--) if (isItemLine(l[k]) && (/^[ \t]*/.exec(l[k])?.[0].length ?? 0) === indent && itemEnd(l, k) === n) return k;
  return n;
});
/** `org-move-item-down` (`M-down`). @param {string} text @param {number} pos */
export const moveItemDownAt = (text, pos) => onItem(text, pos, (l, n) => moveItemDown(l, n), 'move', (l, n) => {
  const next = itemEnd(l, n);
  return n + itemEnd(l, next) - next;
});
/** `org-indent-item` (`M-right`). @param {string} text @param {number} pos */
export const indentItemAt = (text, pos) => onItem(text, pos, (l, n) => indentItem(l, n), 'indent');
/** `org-outdent-item` (`M-left`). @param {string} text @param {number} pos */
export const outdentItemAt = (text, pos) => onItem(text, pos, (l, n) => outdentItem(l, n), 'indent');
/** `org-toggle-checkbox` on one item. @param {string} text @param {number} pos */
export const toggleBoxAt = (text, pos) => onItem(text, pos, (l, n) => toggleCheckbox(l, n), 'box');

// ---- commands on headings

/** The end of the subtree that starts at `start`: the next heading of its level or a shallower one, or the end. @param {string} text @param {number} start */
function subtreeEnd(text, start) {
  const level = levelAt(text, start);
  return headingStarts(text).find((s) => s > start && levelAt(text, s) <= level) ?? text.length;
}

/** `org-promote` / `org-demote` of the heading alone (`M-left`, `M-right`): one star less or more; the caret in the stars goes to the start.
 * @param {string} text @param {number} pos @param {boolean} promote @returns {Change} */
export function shiftHeading(text, pos, promote) {
  const start = headingBefore(text, lineStartAt(text, pos));
  const level = levelAt(text, start);
  if (promote && level <= 1) return { text, pos, error: 'Cannot promote to level 0.  UNDO to recover if necessary' };
  const lineEndAt = text.indexOf('\n', start) === -1 ? text.length : text.indexOf('\n', start);
  const line = text.slice(start, lineEndAt);
  const col = pos - start;
  const newLine = promote ? line.slice(1) : `*${line}`;
  const tagged = /^(.*?)[ \t]+(:(?:[\p{L}\p{N}_@#%]+:)+)[ \t]*$/u.exec(newLine);
  let fixed = newLine;
  let c = col <= level ? 0 : col + (promote ? -1 : 1);
  if (tagged) {
    const head = tagged[1];
    fixed = withTags(head, tagged[2], getTagsColumn());
    const oldTagAt = line.length - (line.length - line.lastIndexOf(tagged[2]));
    const newTagAt = fixed.lastIndexOf(tagged[2]);
    if (col > oldTagAt) c = newTagAt + (col - oldTagAt);
    else if (c > head.length) c = Math.min(c, head.length);
    if (col === oldTagAt) c = col;
  }
  const word = /^\*+ (\S+)(?=[ \t]|$)/.exec(line)?.[1];
  const keyword = word && todoSequences(text).flat().includes(word) ? [word, word] : null;
  if (keyword && col === level + 1 + keyword[1].length) c += 1; // a caret right after the keyword ends up one further
  return { text: text.slice(0, start) + fixed + text.slice(lineEndAt), pos: start + c };
}

/** `org-move-subtree-up` / `-down` (`M-up`, `M-down` on a heading): the subtree trades places with the one before or after it of its
 * level; the caret goes along. @param {string} text @param {number} pos @param {boolean} up @returns {Change} */
export function moveSubtree(text, pos, up) {
  const start = headingBefore(text, lineStartAt(text, pos));
  const level = levelAt(text, start);
  const end = subtreeEnd(text, start);
  const fail = { text, pos: start, error: 'Cannot move past superior level or buffer limit' };
  /** @param {string} s */
  const ensureNewline = (s) => (s.endsWith('\n') ? s : `${s}\n`);
  if (up) {
    const before = headingStarts(text).filter((s) => s < start).reverse().find((s) => levelAt(text, s) <= level);
    if (before === undefined || levelAt(text, before) !== level) return fail;
    const moved = text.slice(start, end);
    const other = text.slice(before, start);
    const joined = end === text.length && !moved.endsWith('\n') ? `${moved}\n${other.replace(/\n$/, '')}` : moved + other;
    return { text: text.slice(0, before) + joined + text.slice(end), pos: before + (pos - start) };
  }
  if (end >= text.length || levelAt(text, end) !== level) return fail;
  const nextEnd = subtreeEnd(text, end);
  const moved = text.slice(start, end);
  const other = text.slice(end, nextEnd);
  const otherFixed = ensureNewline(other);
  const joined = otherFixed + (nextEnd === text.length && !other.endsWith('\n') ? moved.replace(/\n$/, '') : moved);
  return { text: text.slice(0, start) + joined + text.slice(nextEnd), pos: start + otherFixed.length + (pos - start) };
}

/** Whether the caret is on a heading line. @param {string} text @param {number} pos */
export const onHeadingLine = (text, pos) => /^\*+ /.test(text.slice(lineStartAt(text, pos)).split('\n')[0]); // outline-regexp: stars and a space

/** The TODO keywords of a buffer: the `#+TODO:`, `#+SEQ_TODO:` and `#+TYP_TODO:` lines, or Emacs's TODO and DONE. A sequence is its
 * active words, then those after the `|`. @param {string} text @returns {string[][]} */
export function todoSequences(text) {
  /** @type {string[][]} */ const out = [];
  for (const m of text.matchAll(/^[ \t]*#\+(?:TODO|SEQ_TODO|TYP_TODO):[ \t]*(.*)$/gim)) {
    const words = m[1].trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/\(.*\)$/, ''));
    if (words.length) out.push(words.filter((w) => w !== '|'));
  }
  return out.length ? out : [['TODO', 'DONE']];
}

/**
 * `org-todo` (`C-c C-t`) on the heading at the caret without a prefix: the next keyword of the sequence, and none after the last. A
 * heading whose timestamps repeat is left to the outline.
 * With `dir` (`S-left`, `S-right`: `org-todo` with `left` or `right`) it goes to the previous or next keyword of all the keywords in the file, from none to the
 * last or the first, and off the end to none.
 * @param {string} text @param {number} pos @param {'left' | 'right' | null} [dir] @returns {Change & { unsupported?: boolean }}
 */
export function cycleTodo(text, pos, dir = null) {
  const start = headingBefore(text, pos);
  if (start < 0) return { text, pos, error: `Before first headline at position ${lineStartAt(text, pos) + 1} in buffer` };
  const lineEndAt = text.indexOf('\n', start) === -1 ? text.length : text.indexOf('\n', start);
  const line = text.slice(start, lineEndAt);
  const sequences = todoSequences(text);
  if (/^[ \t]*(?:SCHEDULED|DEADLINE):.*[ \t](?:\+\+|\.\+|\+)\d+[hdwmy]/m.test(text.slice(lineEndAt + 1, text.indexOf('\n', lineEndAt + 1) === -1 ? text.length : text.indexOf('\n', lineEndAt + 1)))) return { text, pos, unsupported: true };
  const all = sequences.flat();
  const m = /^(\*+[ \t]+)(?:(\S+)(?=[ \t]|$)[ \t]*)?/.exec(line);
  const stars = m ? m[1] : '';
  const current = m && m[2] && all.includes(m[2]) ? m[2] : null;
  const seq = sequences.find((s) => current && s.includes(current)) ?? sequences[0];
  const at = current === null ? -1 : all.indexOf(current);
  const next = dir === 'right' ? (all[at + 1] ?? null)
    : dir === 'left' ? (current === null ? all[all.length - 1] : (all[at - 1] ?? null))
      : current === null ? seq[0] : seq.indexOf(current) + 1 < seq.length ? seq[seq.indexOf(current) + 1] : null;
  const body = current === null ? line.slice(stars.length) : line.slice(stars.length + (m?.[0].length ?? 0) - stars.length);
  const rest = current === null ? body : line.slice(m?.[0].length ?? 0);
  const word = next === null ? '' : `${next} `;
  const outStars = stars.replace(/ +$/, ' '); // the blanks after the stars become one space
  let newLine = `${outStars}${word}${rest.replace(/^[ \t]+/, '')}`;
  const tagged = /^(.*?)[ \t]+(:(?:[\p{L}\p{N}_@#%]+:)+)[ \t]*$/u.exec(newLine);
  if (tagged) newLine = withTags(tagged[1], tagged[2], getTagsColumn());
  const col = pos - start;
  const starCount = stars.trimEnd().length;
  const matchEnd = stars.length + (current === null ? 0 : (m?.[0].length ?? 0) - stars.length);
  let c;
  if (col < starCount) c = col;
  else if (col <= matchEnd) c = outStars.length + word.length;
  else c = col - matchEnd + outStars.length + word.length;
  if (tagged) {
    const oldAt = line.lastIndexOf(tagged[2]);
    const newAt = newLine.lastIndexOf(tagged[2]);
    if (col > oldAt) c = newAt + (col - oldAt);
    else if (col === oldAt) c = tagged[1].length;
  }
  return { text: text.slice(0, start) + newLine + text.slice(lineEndAt), pos: start + c };
}

// ---- S-arrows and M-S-arrows

const SHIFT_SELECT_ERROR = "To use shift-selection with Org mode, customize `org-support-shift-select'";

/** The line the caret is on: its start, end and text. @param {string} text @param {number} pos */
function lineOf(text, pos) {
  const start = lineStartAt(text, pos);
  const end = text.indexOf('\n', start) === -1 ? text.length : text.indexOf('\n', start);
  return { start, end, line: text.slice(start, end) };
}

/** Where a marker at `pos` goes when the bullets of a list change (each line of `before` becomes the line of `after`): a marker up to the end of its old bullet
 *  stays where it was, one after it moves along with the change of the line, and every line before it moves it by its own change. @param {string} before @param {string} after @param {number} pos */
function markerThroughBullets(before, after, pos) {
  const old = before.split('\n');
  const now = after.split('\n');
  if (old.length !== now.length) return pos;
  let shift = 0;
  let at = 0;
  for (let i = 0; i < old.length; i++) {
    const delta = now[i].length - old[i].length;
    if (pos >= at && pos < at + old[i].length + 1) {
      const bulletEnd = /^[ \t]*(?:[-+*]|\d+[.)]|[A-Za-z][.)])/.exec(old[i])?.[0].length ?? 0;
      return pos + shift + (pos - at <= bulletEnd ? 0 : delta);
    }
    shift += delta;
    at += old[i].length + 1;
  }
  return pos + shift;
}

/** Where a marker at `pos` goes when the lines of a list are indented or outdented (each line of `before` becomes the line of `after`): the caret at the start of its line stays, one after it moves
 *  with the line (to the start of what is left of the line when it was inside the indentation taken away), and every line before it moves it by its own change.
 *  @param {string} before @param {string} after @param {number} pos */
function markerThroughIndent(before, after, pos) {
  const old = before.split('\n');
  const now = after.split('\n');
  if (old.length !== now.length) return pos;
  let shift = 0;
  let at = 0;
  for (let i = 0; i < old.length; i++) {
    const delta = now[i].length - old[i].length;
    if (pos >= at && pos < at + old[i].length + 1) {
      const col = pos - at;
      if (delta > 0 && col <= (/^[ \t]*/.exec(old[i]) ?? [''])[0].length) return at + shift; // the indentation is replaced as a whole: a marker in it or at its end falls to the line start
      return pos + shift + (col === 0 ? 0 : Math.max(delta, -col));
    }
    shift += delta;
    at += old[i].length + 1;
  }
  return pos + shift;
}

/**
 * `org-previous-item` and `org-next-item` (`S-up`, `S-down` on a list item): the caret goes to the start of the previous or next item of the same list; on the first
 * or the last it goes to the start of its own item, and it is an error.
 * @param {string} text @param {number} pos @param {boolean} up @returns {Change}
 */
function shiftItemMove(text, pos, up) {
  const lines = text.split('\n');
  const offset = (/** @type {number} */ k) => lines.slice(0, k).reduce((n, l) => n + l.length + 1, 0);
  let n = text.slice(0, lineStartAt(text, pos)).split('\n').length - 1;
  const indent = (/** @type {string} */ l) => /^[ \t]*/.exec(l)?.[0].length ?? 0;
  /** @type {number | null} */ let target = null;
  if (up) {
    for (let k = n - 1; k >= 0; k--) if (isItemLine(lines[k]) && indent(lines[k]) === indent(lines[n]) && itemEnd(lines, k) === n) { target = k; break; }
  } else {
    const after = itemEnd(lines, n);
    if (after < lines.length && isItemLine(lines[after]) && indent(lines[after]) === indent(lines[n])) target = after;
  }
  if (target === null) return { text, pos: offset(n), error: up ? 'On first item' : 'On last item' };
  n = target;
  return { text, pos: offset(n) };
}

/**
 * `org-priority` with `up` or `down` on the heading at the caret (`S-up`, `S-down`): the next priority, and none beyond the highest or lowest; with none
 * the default (B), and from none again right after the same command the lowest (up) or the highest (down).
 * @param {string} text @param {number} pos @param {'up' | 'down'} dir @param {boolean} again whether the last command was this one @returns {Change}
 */
function shiftPriority(text, pos, dir, again) {
  const { start, end, line } = lineOf(text, pos);
  const m = /^(.*?)(\[#([A-Z0-9]+)\] ?)/.exec(line);
  const highest = 65;
  const lowest = 67;
  const dflt = 66;
  let value = m ? m[3].charCodeAt(0) : null;
  let nextValue;
  if (value !== null) nextValue = dir === 'up' ? value - 1 : value + 1;
  else nextValue = again ? (dir === 'up' ? lowest : highest) : dflt;
  let remove = false;
  if (nextValue < highest || nextValue > lowest) {
    if (value === null && !again) return { text, pos, error: 'The default can not be set, see `org-priority-default\' why' };
    remove = true;
  }
  let newLine;
  /** @type {number} */ let at;
  let removed = 0;
  let inserted = 0;
  if (m) {
    const from = m[1].length;
    if (remove) {
      newLine = line.slice(0, from) + line.slice(from + m[2].length);
      at = from;
      removed = m[2].length;
    } else {
      newLine = line.slice(0, from + 2) + String.fromCharCode(nextValue) + line.slice(from + 2 + m[3].length);
      at = from + 2;
      removed = m[3].length;
      inserted = 1;
    }
  } else {
    if (remove) return { text, pos, error: 'No priority cookie found in line' };
    const t = /^(\*+[ \t]+)(?:(\S+)(?=[ \t]|$)[ \t]*)?/.exec(line);
    const todo = t && t[2] && todoSequences(text).flat().includes(t[2]) ? t[2] : null;
    const cookie = `[#${String.fromCharCode(nextValue)}]`;
    if (t && todo) {
      const at2 = t[1].length + todo.length;
      newLine = `${line.slice(0, at2)} ${cookie}${line.slice(at2)}`;
      at = at2;
      inserted = cookie.length + 1;
    } else {
      const at2 = t ? t[1].length : 0;
      newLine = `${line.slice(0, at2)}${cookie} ${line.slice(at2)}`;
      at = at2;
      inserted = cookie.length + 1;
    }
  }
  const col = pos - start;
  let c = col <= at ? col : col >= at + removed ? col + inserted - removed : at; // a marker: before the edit it stays, after it it moves, inside it goes to its start
  const tagged = /^(.*?)[ \t]+(:(?:[\p{L}\p{N}_@#%]+:)+)[ \t]*$/u.exec(newLine);
  if (tagged) {
    const oldAt = line.lastIndexOf(tagged[2]);
    newLine = withTags(tagged[1], tagged[2], getTagsColumn());
    const newAt = newLine.lastIndexOf(tagged[2]);
    if (col > oldAt) c = newAt + (col - oldAt);
    else if (col === oldAt) c = tagged[1].length;
  }
  return { text: text.slice(0, start) + newLine + text.slice(end), pos: start + c };
}

/**
 * `org-shiftup`, `org-shiftdown`, `org-shiftleft` and `org-shiftright` (`S-up` and the others) by where the caret is: a time stamp changes, a heading's
 * priority (up, down) or TODO keyword (left, right) changes, a list item's list moves to the previous or next item or bullet type. A table
 * cell, a property line and a clock table are not done yet (`unsupported`); anywhere else it is an error, as in Emacs with `org-support-shift-select` nil.
 * @param {string} text @param {number} pos @param {'up' | 'down' | 'left' | 'right'} dir @param {boolean} again whether the last command was this one
 * @returns {Change & { unsupported?: boolean }}
 */
export function shiftArrow(text, pos, dir, again = false) {
  if (stampAtPos(text, pos)) {
    try {
      const change = dir === 'up' || dir === 'down' ? timestampChange(text, pos, dir === 'up' ? 1 : -1, { updown: true }) : timestampChange(text, pos, dir === 'right' ? 1 : -1, { what: 'day' });
      return { text: change.text, pos: change.pos };
    } catch (e) {
      return { text, pos, error: /** @type {Error} */ (e).message };
    }
  }
  if (onHeadingLine(text, pos)) return dir === 'up' || dir === 'down' ? shiftPriority(text, pos, dir, again) : cycleTodo(text, pos, dir);
  if (onItemLine(text, pos)) {
    if (dir === 'left' || dir === 'right') {
      const done = itemCommandAt(text, pos, (l, n) => cycleListBullet(l, n, dir === 'left' ? 'previous' : null));
      return done.error ? done : { text: done.text, pos: markerThroughBullets(text, done.text, pos) };
    }
    return shiftItemMove(text, pos, dir === 'up');
  }
  const { line } = lineOf(text, pos);
  const cell = tableEdit(text, pos, /** @type {const} */ (`cell-${dir}`));
  if (cell) return cell;
  if (/^[ \t]*:[^\s:]+:/.test(line)) return { text, pos, unsupported: true };
  return { text, pos, error: SHIFT_SELECT_ERROR };
}

/** `org-promote-subtree` and `org-demote-subtree` (`M-S-left`, `M-S-right` on a heading line): the heading and all the headings under it move one level.
 * @param {string} text @param {number} pos @param {boolean} promote @returns {Change} */
function shiftSubtree(text, pos, promote) {
  const start = headingBefore(text, lineStartAt(text, pos));
  const end = subtreeEnd(text, start);
  const starts = headingStarts(text).filter((h) => h >= start && h < end);
  if (promote && levelAt(text, start) <= 1) return { text, pos, error: 'Cannot promote to level 0.  UNDO to recover if necessary' };
  let out = text;
  for (const h of [...starts].reverse().filter((x) => x !== start)) out = shiftHeading(out, h, promote).text; // the deeper ones first: the offsets before them stay where they are
  return shiftHeading(out, pos, promote);
}

/** `org-drag-line-forward` and `-backward` (`M-S-down`, `M-S-up` outside a table): the line at the caret trades places with the one below or above, and the caret stays in it.
 * @param {string} text @param {number} pos @param {boolean} up @returns {Change} */
function dragLine(text, pos, up) {
  if (text === '') return { text: '\n\n\n', pos: up ? 1 : 2 };
  const lines = text.split('\n');
  const last = lines.length - 1;
  const n = text.slice(0, lineStartAt(text, pos)).split('\n').length - 1;
  const col = displayColumn(text, pos); // the caret keeps its screen column (a tab is up to 8, a wide character 2)
  // Emacs goes to the start of the next line (or the end of the buffer) and transposes the lines around that place: on the last line it is the one above that trades places
  // with it, on the only line a new empty one is put above it; up on the first line trades it with the one below
  let a = up ? n - 1 : n;
  if (up && n === 0) a = 0;
  if (!up && n === last) a = n - 1;
  if (last === 0) return { text: `\n${text}\n`, pos: up ? 0 : 1 + offsetAtColumn(text, col) }; // the only line: an empty one is put above it, and the caret goes with it (down) or stays at the top (up)
  const b = a + 1;
  const involvesLast = b >= lines.length - 1;
  [lines[a], lines[b]] = [lines[b], lines[a]];
  const caretLine = up ? (n === 0 ? 0 : n - 1) : (n === last ? (last === 0 ? 1 : n) : n + 1);
  const at = lines.slice(0, caretLine).reduce((k, l) => k + l.length + 1, 0);
  const moved = lines[caretLine];
  return { text: lines.join('\n') + (involvesLast ? '\n' : ''), pos: at + offsetAtColumn(moved, col) };
}

/**
 * `org-shiftmetaleft`, `org-shiftmetaright`, `org-shiftmetaup` and `org-shiftmetadown` (`M-S-left` and the others): on a heading the subtree changes level, on a list item the
 * item and its sub-items, in a table a row is inserted (down); up and down elsewhere drag the line. Table columns and rows to delete are not done yet (`unsupported`).
 * @param {string} text @param {number} pos @param {'up' | 'down' | 'left' | 'right'} dir @returns {Change & { unsupported?: boolean }}
 */
export function shiftMetaArrow(text, pos, dir) {
  const { line } = lineOf(text, pos);
  const inTable = /^[ \t]*\|/.test(line);
  if (dir === 'up' || dir === 'down') {
    if (inTable) return dir === 'down' ? (tableEdit(text, pos, 'insert-row') ?? { text, pos, unsupported: true }) : { text, pos, unsupported: true };
    return dragLine(text, pos, dir === 'up');
  }
  if (inTable) return { text, pos, unsupported: true };
  if (onHeadingLine(text, pos)) return shiftSubtree(text, pos, dir === 'left');
  if (onItemLine(text, pos)) {
    const done = itemCommandAt(text, pos, (l, n) => (dir === 'left' ? outdentItemTree(l, n) : indentItemTree(l, n)));
    return done.error ? done : { text: done.text, pos: markerThroughIndent(text, done.text, pos) };
  }
  return { text, pos, error: 'This command is active in special context like tables, headlines or items' };
}

// ---- C-c C-c

import { fixBoxes } from './list-edit.js';
import { tableTab } from './table-tab.js';

/**
 * `org-ctrl-c-ctrl-c` (`C-c C-c`) where the caret is: on a list item its boxes are put right (a box is toggled), in a table the table
 * is aligned, elsewhere it can do nothing. A heading or a property needs the minibuffer (tags, a property to edit) and is `unsupported`.
 * @param {string} text @param {number} pos @returns {Change & { unsupported?: boolean }}
 */
export function ctrlCCtrlC(text, pos) {
  const lineBeg = lineStartAt(text, pos);
  const line = text.slice(lineBeg).split('\n')[0];
  if (/^\*+ /.test(line) || /^[ \t]*:[^\s:]+:[ \t]*(.*)$/.test(line) && !/^[ \t]*\|/.test(line)) return { text, pos, unsupported: true };
  if (onItemLine(text, pos)) {
    if (BOX.test(line)) return toggleBoxAt(text, pos);
    const lines = text.split('\n');
    return { text: fixBoxes(lines, lineCol(text, pos).line).join('\n'), pos };
  }
  if (/^[ \t]*\|/.test(line)) {
    const prevLine = lineBeg === 0 ? '' : text.slice(0, lineBeg - 1).split('\n').pop() ?? '';
    if (pos === lineBeg && !/^[ \t]*\|/.test(prevLine)) return { text, pos }; // the first position of a table is the table itself
    const done = tableTab(text, pos, true);
    if (!done) return { text, pos };
    const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0;
    const col = pos - lineBeg;
    if (/^[ \t]*\|-/.test(line) && col > indent && col < line.trimEnd().length) {
      // on a rule the column counts the bars alone, which puts the caret in the first field
      const newBeg = offsetOf(done.text.split('\n'), lineCol(text, pos).line, 0);
      return { text: done.text, pos: newBeg + indent + 1 };
    }
    return { text: done.text, pos: done.pos };
  }
  const stamp = timestampAt(line, pos - lineBeg);
  if (stamp) return /[ \t][-+.]?\+\d+[hdwmy]/.test(stamp[0]) ? { text, pos, unsupported: true } : { text, pos };
  return { text, pos, error: "`C-c C-c' can do nothing useful here" };
}

/** The `<...>` or `[...]` timestamp the column is in or touching, or null. @param {string} line @param {number} col */
function timestampAt(line, col) {
  for (const m of line.matchAll(/<\d{4}-\d\d-\d\d[^>\n]*>|\[\d{4}-\d\d-\d\d[^\]\n]*\]/g)) {
    if (col >= m.index && col <= m.index + m[0].length) return m;
  }
  return null;
}

/**
 * `org-toggle-checkbox` (`C-c C-x C-b`): the box of the item the caret is in, or on a heading the boxes of the first list below it.
 * @param {string} text @param {number} pos @returns {Change}
 */
export function toggleCheckboxAt(text, pos) {
  const lines = text.split('\n');
  const { line } = lineCol(text, pos);
  if (onItemLine(text, pos)) return toggleBoxAt(text, pos);
  if (/^\*+ /.test(lines[line])) {
    let end = line + 1;
    while (end < lines.length && !/^\*+ /.test(lines[end])) end += 1;
    const first = lines.slice(line + 1, end).findIndex((l, k) => atItem(text, offsetOf(lines, line + 1 + k, 0)) && isItemLine(l));
    if (first < 0) return { text, pos, error: 'No item in subtree' };
    try {
      const out = toggleCheckbox(lines, line + 1 + first, { all: true });
      return { text: out.join('\n'), pos };
    } catch (e) {
      return { text, pos, error: /** @type {Error} */ (e).message };
    }
  }
  return { text, pos, error: 'Not at an item or heading, and no active region' };
}

/** A list command of src/list-struct.js not checked against Emacs for the caret (the tree forms, bullets, repair): the caret keeps its line and column.
 * @param {string} text @param {number} pos @param {(lines: string[], line: number) => string[]} command @returns {Change} */
export const itemCommandAt = (text, pos, command) => onItem(text, pos, command, 'box');
