// M-q, `org-fill-paragraph`: the paragraph at the caret is filled to `fill-column` (70). A list item is filled as its own paragraph, a comment keeps its `# `,
// and a heading, a table, a keyword line or a blank line is left alone.

import { width } from './org-table-layout.js';

const FILL_COLUMN = 70;
const BULLET = /^([ \t]*)([-+]|\d+[.)])([ \t]+|$)/;
const HEADING = /^\*+([ \t]|$)/;
const OTHER_ELEMENT = /^[ \t]*(\||#\+|:[\w-]+:|\[fn:)/i;
const COMMENT = /^([ \t]*#)( +|$)/;
const SENTENCE_END = /[.?!…‽][\]"'”’)}»›]*$/u;

/** The columns of a string as Emacs counts them: a tab goes to the next multiple of 8. @param {string} s */
function columns(s) {
  let c = 0;
  for (const ch of s) c = ch === '\t' ? c + 8 - (c % 8) : c + width(ch);
  return c;
}

/** The first and last row of the paragraph the row belongs to; null when the row is not in one. @param {string[]} lines @param {number} row */
function paragraphAt(lines, row) {
  const text = lines[row];
  if (text.trim() === '' || HEADING.test(text) || OTHER_ELEMENT.test(text)) return null;
  const comment = COMMENT.test(text);
  const same = (/** @type {string} */ l) => l.trim() !== '' && !HEADING.test(l) && !OTHER_ELEMENT.test(l) && COMMENT.test(l) === comment;
  const indent = (/** @type {string} */ l) => /^[ \t]*/.exec(l)?.[0].length ?? 0;
  let first = row;
  while (first > 0 && !BULLET.test(lines[first]) && same(lines[first - 1])) {
    const above = BULLET.exec(lines[first - 1]);
    if (above && indent(lines[first]) <= above[1].length) break; // not in that item: it is not indented under the bullet
    first--;
  }
  let last = row;
  const bullet = BULLET.exec(lines[first]);
  while (last + 1 < lines.length && same(lines[last + 1]) && !BULLET.test(lines[last + 1]) && (!bullet || indent(lines[last + 1]) > bullet[1].length)) last++;
  return { first, last, comment };
}

/**
 * `org-fill-paragraph` on the paragraph at `pos`: the new text and where the caret goes; null when the caret is not in a paragraph.
 * @param {string} text @param {number} pos @returns {{ text: string, pos: number, from: number, to: number, newTo: number } | null}
 */
export function fillParagraphAt(text, pos) {
  const lines = text.split('\n');
  const starts = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  let row = starts.findIndex((s, i) => pos >= s && pos <= s + lines[i].length);
  if (row >= 0 && lines[row].trim() === '') { // on a blank line: the paragraph after it, or the one before it at the end of the buffer
    const after = lines.findIndex((l, i) => i > row && l.trim() !== '');
    const before = lines.map((l, i) => (i < row && l.trim() !== '' ? i : -1)).filter((i) => i >= 0).pop();
    row = after >= 0 ? after : before ?? -1;
  }
  const para = row < 0 ? null : paragraphAt(lines, row);
  if (!para) return null;
  const { first, last, comment } = para;
  const firstLine = lines[first];
  const item = comment ? null : BULLET.exec(firstLine);
  const commentHead = comment ? /** @type {RegExpExecArray} */ (COMMENT.exec(firstLine)) : null;
  const lead = (/** @type {string} */ l) => (comment ? (COMMENT.exec(l) ?? commentHead)?.[0].length ?? 0 : /^[ \t]*/.exec(l)?.[0].length ?? 0);
  const headLength = item ? item[0].length : comment ? /** @type {RegExpExecArray} */ (commentHead)[0].length : lead(firstLine);
  const head = firstLine.slice(0, headLength);
  let prefix;
  if (item) prefix = ' '.repeat(columns(item[0]));
  else if (comment) prefix = lines[last > first ? first + 1 : first].slice(0, lead(lines[last > first ? first + 1 : first]));
  else prefix = lines[last > first ? first + 1 : first].slice(0, lead(lines[last > first ? first + 1 : first]));

  /** @type {{ word: string, from: number, to: number, gapAfter: string }[]} */
  const words = [];
  for (let r = first; r <= last; r++) {
    const l = lines[r];
    let i = r === first ? headLength : lead(l);
    const end = l.trimEnd().length;
    while (i < end) {
      let j = i;
      while (j < end && l[j] !== ' ' && l[j] !== '\t') j++;
      words.push({ word: l.slice(i, j), from: starts[r] + i, to: starts[r] + j, gapAfter: '' });
      while (j < end && (l[j] === ' ' || l[j] === '\t')) j++;
      i = j;
    }
  }
  if (words.length === 0) return null;
  const from = starts[first];
  const to = starts[last] + lines[last].length;
  for (let k = 0; k < words.length - 1; k++) words[k].gapAfter = text.slice(words[k].to, words[k + 1].from);

  // the new gaps: one space, two after the end of a sentence (one that ended a line, or had two spaces or a tab after it)
  const gap = (/** @type {number} */ k) => {
    const w = words[k];
    const run = w.gapAfter;
    return SENTENCE_END.test(w.word) && (/[\n]/.test(run) || /\t|  /.test(run)) ? '  ' : ' ';
  };
  // where each word goes: a line breaks at the last place that is allowed (not after a period with one space after it, which would look like the end of a sentence) before the width is passed
  const allowed = (/** @type {number} */ k) => !(words[k - 1].word.endsWith('.') && gap(k - 1) === ' ') && !(/^([-+*]|\d+[.)])$/.test(words[k].word)); // nor before a word that would start a list item
  /** @type {boolean[]} */ const broke = words.map(() => false);
  const headColumns = columns(head);
  const prefixColumns = columns(prefix);
  const widthTo = (/** @type {number} */ from, /** @type {number} */ to, /** @type {number} */ base) => {
    let c = base;
    for (let k = from; k <= to; k++) c += (k > from ? gap(k - 1).length : 0) + columns(words[k].word);
    return c;
  };
  let lineStart = 0;
  for (let k = 1; k < words.length; k++) {
    const base = lineStart === 0 ? headColumns : prefixColumns;
    if (widthTo(lineStart, k, base) <= FILL_COLUMN) continue;
    let at = k;
    while (at > lineStart + 1 && !allowed(at)) at--;
    if (at === lineStart + 1 && !allowed(at)) { // nowhere to break before: go on to the next place that is allowed
      at = k + 1;
      while (at < words.length && !allowed(at)) at++;
      if (at >= words.length) break;
    }
    broke[at] = true;
    lineStart = at;
    k = at; // the words from the break on are measured again on the new line
  }
  let out = head;
  /** @type {number[]} */ const newStart = [];
  for (let k = 0; k < words.length; k++) {
    if (k > 0) out += broke[k] ? '\n' + prefix : gap(k - 1);
    newStart.push(out.length);
    out += words[k].word;
  }
  /** @param {number} p */
  const map = (p) => {
    if (p <= words[0].from) return Math.min(p - from, head.length);
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      if (p <= w.to) {
        if (p >= w.from) return newStart[k] + (p - w.from);
        const prev = words[k - 1];
        const d = p - prev.to;
        const kept = broke[k] ? 1 : prev.gapAfter.includes('\n') ? (d >= 1 ? gap(k - 1).length : 0) : Math.min(gap(k - 1).length, d); // a caret after a line break goes to the end of the new gap
        return newStart[k - 1] + prev.word.length + (broke[k] ? Math.min(d, 1) : kept);
      }
    }
    return newStart[words.length - 1] + words[words.length - 1].word.length;
  };
  const moved = pos < from ? pos : pos > to ? pos + out.length - (to - from) : from + map(pos);
  return { text: text.slice(0, from) + out + text.slice(to), pos: moved, from, to, newTo: from + out.length };
}

/**
 * `fill-region`: every paragraph the region touches is filled, the last first so that the places before it hold; the caret and the mark go with the text.
 * @param {string} text @param {number} pos @param {number} mark
 * @returns {{ text: string, pos: number, mark: number }}
 */
export function fillRegion(text, pos, mark) {
  const lines = text.split('\n');
  const starts = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  const rowOf = (/** @type {number} */ p) => Math.max(0, starts.findIndex((s, i) => p >= s && p <= s + lines[i].length));
  /** @type {number[]} */ const firsts = [];
  for (let r = rowOf(Math.min(pos, mark)); r <= rowOf(Math.max(pos, mark)); r++) {
    const para = lines[r].trim() === '' ? null : paragraphAt(lines, r);
    if (para && !firsts.includes(para.first)) firsts.push(para.first);
  }
  let out = text;
  let p = pos;
  let m = mark;
  for (const first of firsts.reverse()) {
    const done = fillParagraphAt(out, starts[first]);
    if (!done) continue;
    const delta = done.newTo - done.to;
    const move = (/** @type {number} */ q) => (q > done.to ? q + delta : q >= done.from ? (fillParagraphAt(out, q)?.pos ?? q) : q);
    p = move(p);
    m = move(m);
    out = done.text;
  }
  return { text: out, pos: p, mark: m };
}
