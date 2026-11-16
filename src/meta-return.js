// @ts-check
/**
 * `M-RET` (`org-meta-return`) on the text of a buffer, as the Text view has it: a new heading (`org-insert-heading`) or a new list
 * item (`org-insert-item`), splitting the line at the caret as `org-M-RET-may-split-line` says. Positions are 0-based offsets.
 */
import { blankSetting } from './blank-before-entry.js';
import { headingParts } from './text-commands.js';
import { getTagsColumn, withTags } from './tags-column.js';
import { findLists, fixBoxes, listKind, renumber, separatingBlankLines } from './list-edit.js';

/** @typedef {'headline' | 'item' | 'table' | 'default'} SplitKey */

/**
 * `org-get-alist-option` on the variable's Lisp text: `t` allows a split everywhere, `nil` nowhere, and an alist says it per key,
 * with `default` for a key it does not name.
 * @param {string | undefined} raw @param {SplitKey} key
 */
export function maySplitLine(raw, key) {
  const text = (raw ?? '((default . t))').trim().replace(/^'/, '');
  if (text === 't') return true;
  if (text === 'nil' || text === '') return false;
  /** @type {Record<string, boolean>} */ const values = {};
  for (const m of text.matchAll(/\(\s*([\w-]+)(?:\s*\.\s*(t|nil)|\s+(t)\b)?\s*\)/g)) values[m[1]] = m[2] === 't' || m[3] === 't';
  return key in values ? values[key] : values.default === true;
}

/** @param {string} text @param {number} pos */
function lineIndexAt(text, pos) {
  let line = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < pos; i = text.indexOf('\n', i + 1)) line += 1;
  return line;
}

/**
 * The item whose own text (its first line, sub-items and continuation lines up to the blank lines after it) holds `line`.
 * @param {string[]} lines @param {number} line
 */
function itemAtLine(lines, line) {
  let found = null;
  for (const list of findLists(lines)) {
    for (const [index, it] of list.items.entries()) {
      let end = it.end;
      while (end > it.line + 1 && lines[end - 1].trim() === '') end -= 1;
      if (it.line <= line && line < end && (!found || it.line >= found.it.line)) found = { list, index, it, end };
    }
  }
  return found;
}

/**
 * How far into a list item line the caret still counts as before the item's text (`org-insert-item` then puts the new item above
 * it): the end of the bullet, counter and checkbox, or, in a description item, the end of its term with the blanks after it.
 * @param {string} line
 */
function itemTextStart(line) {
  const m = /^([ \t]*(?:[-+*]|[0-9]+[.)])(?:[ \t]+|$))(?:\[@\d+\][ \t]*)?(?:\[[ X-]\](?:[ \t]+|$))?/.exec(line);
  if (!m) return line.length;
  const tag = /^(.*)[ \t]+::(?:[ \t]|$)/.exec(line.slice(m[0].length));
  if (!tag || /^[ \t]*[0-9]/.test(m[1])) return m[0].length;
  const end = m[0].length + tag[1].length;
  return end + (/^[ \t]*/.exec(line.slice(end))?.[0].length ?? 0);
}

/**
 * @param {string} text @param {number} pos
 * @param {string | undefined} raw the value of `org-M-RET-may-split-line` @param {string[]} [keywords] the TODO keywords
 * @returns {{ text: string, pos: number } | { error: string }}
 */
export function metaReturn(text, pos, raw, keywords = ['TODO', 'DONE']) {
  const lines = text.split('\n');
  const line = lineIndexAt(text, pos);
  const lineStart = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
  const col = pos - lineStart;
  const own = lines[line];
  if (/^[ \t]*\|/.test(own)) return { error: 'M-RET in a table (org-table-wrap-region) is not available' };
  const found = itemAtLine(lines, line);
  if (found) return insertItem(lines, line, col, found, maySplitLine(raw, 'item'));
  // a blank line right under a list's last line is still the list's: the caret counts as at the end of that line
  const above = own.trim() === '' && line > 0 ? itemAtLine(lines, line - 1) : null;
  if (above) return insertItem(lines, line - 1, lines[line - 1].length, above, maySplitLine(raw, 'item'));
  return insertHeading(lines, line, col, maySplitLine(raw, 'headline'), keywords);
}

/** The offset just past `n` lines. @param {string[]} lines @param {number} n */
const offsetOf = (lines, n) => lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);

/**
 * The title of a heading line, as `org-complex-heading-regexp` has it: where it starts and where it ends, before the tags.
 * @param {string} line @param {string[]} keywords
 */
function titleRange(line, keywords) {
  const parts = headingParts(line, keywords);
  if (!parts) return null;
  const from = parts.priority ?? parts.keyword ?? parts.stars;
  const start = from + (/^[ \t]*/.exec(line.slice(from))?.[0].length ?? 0);
  const end = (parts.tags ?? line.length) - (/[ \t]*$/.exec(line.slice(0, parts.tags ?? line.length))?.[0].length ?? 0);
  return { start, end: Math.max(start, end), tags: parts.tags };
}

/**
 * Whether an empty line goes before a new heading here (`org--blank-before-heading-p`): with `auto`, when the heading the caret is
 * under has one.
 * @param {string[]} lines @param {number} line
 */
function blankBeforeHeading(lines, line) {
  const setting = blankSetting('heading');
  if (setting !== 'auto') return setting === 't';
  let heading = line;
  while (heading >= 0 && !/^\*+(?:[ \t]|$)/.test(lines[heading])) heading -= 1;
  if (heading < 0) return false;
  if (heading > 0) return lines[heading - 1].trim() === '';
  // the first line of the buffer: Org looks above the next heading instead, or above the end of the buffer when there is none
  const next = lines.findIndex((l, i) => i > 0 && /^\*+(?:[ \t]|$)/.test(l));
  if (next > 0) return lines[next - 1].trim() === '';
  const last = lines.length - 1;
  return lines[last] === '' && last > 0 && lines[last - 1].trim() === '';
}

/**
 * `org-N-empty-lines-before-current`: exactly `n` empty lines above line `at`. Returns where that line is now.
 * @param {string[]} out @param {number} at @param {number} n
 */
function emptyLinesBefore(out, at, n) {
  let have = 0;
  while (at - 1 - have >= 0 && out[at - 1 - have].trim() === '') have += 1;
  if (have > n) {
    out.splice(at - (have - n), have - n);
    return at - (have - n);
  }
  out.splice(at, 0, ...Array(n - have).fill(''));
  return at + (n - have);
}

/** @param {string[]} lines @param {number} line @param {number} col @param {boolean} split @param {string[]} keywords */
function insertHeading(lines, line, col, split, keywords) {
  const own = lines[line];
  let level = 1;
  for (let i = line; i >= 0; i--) {
    const m = /^(\*+)(?:[ \t]|$)/.exec(lines[i]);
    if (m) {
      level = m[1].length;
      break;
    }
  }
  const fresh = '*'.repeat(level) + ' ';
  const blank = blankBeforeHeading(lines, line);
  const out = [...lines];
  const spacer = blank ? [''] : [];
  /** @param {number} at the new heading's line @param {number} extra */
  const placed = (at, extra) => ({ text: out.join('\n'), pos: offsetOf(out, at) + extra });
  /** The empty lines before the new heading at `at`, unless it already follows one that a blank is wanted for. */
  const spaced = (/** @type {number} */ at) => (blank && out[at - 1]?.trim() === '' ? at : emptyLinesBefore(out, at, blank ? 1 : 0));
  if (/^\*+(?:[ \t]|$)/.test(own)) {
    if (col === 0) {
      out.splice(line, 0, fresh, ...spacer);
      const at = spaced(line);
      return placed(at, fresh.length);
    }
    const title = titleRange(own, keywords);
    if (split && title && col >= title.start && col <= title.end) {
      const moved = own.slice(col, title.end);
      const rest = own.slice(title.end);
      const kept = own.slice(0, col);
      const head = rest.trim() === '' ? kept : withTags(kept.replace(/[ \t]+$/, ''), rest.trim(), getTagsColumn());
      out.splice(line, 1, head, ...spacer, fresh + (moved.trim() === '' ? '' : moved));
      return placed(line + 1 + spacer.length, out[line + 1 + spacer.length].length);
    }
    out.splice(line, 1, own, ...spacer, fresh);
    return placed(line + 1 + spacer.length, fresh.length);
  }
  if (col === 0) {
    out[line] = fresh + own;
    const at = spaced(line);
    return placed(at, fresh.length);
  }
  out.splice(line, 1, split ? own.slice(0, col) : own, fresh + (split ? own.slice(col) : ''));
  const at = spaced(line + 1);
  return placed(at, fresh.length);
}

/**
 * `org-insert-item`: a new item beside the one that holds the caret. With a split the text from the caret to the end of the item
 * (its sub-items and continuation lines too) moves to the new item; without one the new item goes after the whole item. A caret
 * before the item's text puts the new item above it.
 * @param {string[]} lines @param {number} line @param {number} col
 * @param {NonNullable<ReturnType<typeof itemAtLine>>} found @param {boolean} split
 */
function insertItem(lines, line, col, found, split) {
  const { it, end } = found;
  const first = lines[it.line];
  const bulletMatch = /^([ \t]*)([-+*]|[0-9]+[.)])/.exec(first);
  const indent = bulletMatch ? bulletMatch[1] : '';
  const bullet = bulletMatch ? bulletMatch[2] : '-';
  const desc = listKind(lines, it.line) === 'descriptive' ? ' :: ' : '';
  const blanks = Array(separatingBlankLines(lines, it.line)).fill('');
  const head = indent + bullet + ' ' + desc;
  const before = line === it.line && col <= itemTextStart(first);
  const text = lines.join('\n');
  /** @type {string[]} */ let out;
  let at;
  if (before) {
    at = it.line;
    out = [...lines.slice(0, at), head, ...blanks, ...lines.slice(at)];
  } else if (!split) {
    at = end + blanks.length;
    out = [...lines.slice(0, end), ...blanks, head, ...lines.slice(end)];
  } else {
    let cut = offsetOf(lines, line) + col;
    while (cut > 0 && /[ \r\t\n]/.test(text[cut - 1])) cut -= 1;
    const moved = text.slice(cut, Math.min(text.length, offsetOf(lines, end))).replace(/\n$/, '').split('\n');
    const kept = text.slice(0, cut).split('\n');
    at = kept.length + blanks.length;
    out = [...kept, ...blanks, head + moved[0].replace(/^[ \t]+/, ''), ...moved.slice(1), ...lines.slice(end)];
  }
  out = fixBoxes(renumber(out, at, at), at);
  const lead = /^[ \t]*(?:[-+*]|[0-9]+[.)])[ \t]/.exec(out[at])?.[0].length ?? out[at].length;
  return { text: out.join('\n'), pos: offsetOf(out, at) + lead };
}
