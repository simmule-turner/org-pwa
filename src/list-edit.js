// @ts-check
/**
 * Plain-list structure on raw lines, the way Org reads it (`org-list-struct`): an item runs from its bullet to the next item
 * at its indentation or less, a more indented line belongs to it, and a list ends at a line indented less than its first item,
 * at a non-item line at that indentation, or at two blank lines.  The edits keep the list in order the way
 * `org-list-struct-fix-bul` and `org-list-struct-fix-box` do: ordered bullets are numbered again (a `[@N]` counter restarts the
 * count), and a checkbox with checkbox sub-items shows what they add up to.
 */

const ITEM_RE = /^([ \t]*)([-+*]|\d+[.)])(?:([ \t]+)|$)/;

/** @typedef {{ line: number, indent: number, bullet: string, parent: number, end: number }} ListItemInfo */

/** @param {string} line @returns {number} */
function indentWidth(line) {
  let w = 0;
  for (const ch of line) {
    if (ch === ' ') w += 1;
    else if (ch === '\t') w += 8 - (w % 8);
    else break;
  }
  return w;
}

/** @param {string} line */
export function isItemLine(line) {
  const m = ITEM_RE.exec(line);
  return !!m && !(m[2] === '*' && m[1] === '');
}

/**
 * Every list in `lines`, as the items of each with their parents and ends.
 * @param {string[]} lines
 * @returns {{ items: ListItemInfo[], start: number, end: number }[]}
 */
export function findLists(lines) {
  /** @type {{ items: ListItemInfo[], start: number, end: number }[]} */
  const lists = [];
  let i = 0;
  let block = false;
  while (i < lines.length) {
    const line = lines[i];
    if (/^[ \t]*#\+begin_/i.test(line)) block = true;
    else if (/^[ \t]*#\+end_/i.test(line)) block = false;
    if (block || !isItemLine(line)) {
      i += 1;
      continue;
    }
    const top = indentWidth(line);
    /** @type {ListItemInfo[]} */
    const items = [];
    let j = i;
    let blanks = 0;
    let end = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') {
        blanks += 1;
        if (blanks >= 2) break;
        continue;
      }
      const ind = indentWidth(l);
      if (ind < top || (ind === top && !isItemLine(l))) break;
      blanks = 0;
      end = j + 1;
      const m = ITEM_RE.exec(l);
      if (isItemLine(l) && m) {
        let parent = -1;
        for (let k = items.length - 1; k >= 0; k--) {
          if (items[k].indent < ind) {
            parent = k;
            break;
          }
        }
        items.push({ line: j, indent: ind, bullet: m[2], parent, end: -1 });
      }
    }
    for (let a = 0; a < items.length; a++) {
      let b = a + 1;
      while (b < items.length && items[b].indent > items[a].indent) b++;
      items[a].end = b < items.length ? items[b].line : end;
    }
    lists.push({ items, start: i, end });
    i = Math.max(end, i + 1);
  }
  return lists;
}

/** The list that has an item on `line`, and that item's index in it.
 * @param {string[]} lines @param {number} line */
export function listAt(lines, line) {
  for (const list of findLists(lines)) {
    const index = list.items.findIndex((it) => it.line === line);
    if (index >= 0) return { list, index };
  }
  return null;
}

/** The first line after the item, its sub-items and its text; blank lines are the item's own except at the end of the list.
 * @param {string[]} lines @param {number} line */
export function itemEnd(lines, line) {
  const found = listAt(lines, line);
  if (!found) return line + 1;
  const { list, index } = found;
  let end = list.items[index].end;
  if (end === list.end) while (end > line + 1 && lines[end - 1].trim() === '') end -= 1;
  return end;
}

/** @param {string} bullet */
const isOrdered = (bullet) => /^\d/.test(bullet);

/**
 * Number the ordered items of the list that has an item on `line` again, shifting the lines of an item whose bullet changed
 * width.  Returns the new lines.
 * @param {string[]} lines @param {number} line
 */
export function renumber(lines, line) {
  const found = listAt(lines, line);
  if (!found) return lines;
  const out = [...lines];
  const { items } = found.list;
  /** @type {Map<number, number>} the next number for the children of each parent */
  const next = new Map();
  /** per-line indentation changes from wider or narrower bullets: [from, to, delta] */
  /** @type {[number, number, number][]} */
  const shifts = [];
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (!isOrdered(it.bullet)) {
      next.delete(k);
      continue;
    }
    // restart the count whenever the previous sibling was not ordered or this is the first of its group
    const prevSibling = (() => {
      for (let p = k - 1; p >= 0; p--) {
        if (items[p].parent === it.parent && items[p].indent === it.indent) return p;
        if (items[p].indent < it.indent) return -1;
      }
      return -1;
    })();
    const counter = /^[ \t]*\d+[.)][ \t]+\[@(\d+)\]/.exec(lines[it.line]);
    let n = prevSibling >= 0 && isOrdered(items[prevSibling].bullet) ? (next.get(prevSibling) ?? 1) : 1;
    if (counter) n = Number(counter[1]);
    next.set(k, n + 1);
    const m = /^([ \t]*)(\d+)([.)])/.exec(out[it.line]);
    if (!m) continue;
    const bullet = `${n}${m[3]}`;
    if (bullet !== m[2] + m[3]) {
      const delta = bullet.length - (m[2] + m[3]).length;
      out[it.line] = m[1] + bullet + out[it.line].slice(m[0].length);
      if (delta !== 0) shifts.push([it.line + 1, it.end, delta]);
    }
  }
  for (const [from, to, delta] of shifts) {
    for (let l = from; l < to; l++) {
      if (out[l].trim() === '') continue;
      out[l] = delta > 0 ? ' '.repeat(delta) + out[l] : out[l].slice(Math.min(-delta, /^[ ]*/.exec(out[l])?.[0].length ?? 0));
    }
  }
  return out;
}

const BOX_RE = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[@\d+\][ \t]+)?)\[([ xX-])\]/;

/**
 * Make each checkbox that has checkbox sub-items show what they add up to, innermost first (`org-list-struct-fix-box`) in the
 * list that has an item on `line`.  Returns the new lines.
 * @param {string[]} lines @param {number} line
 * @param {number} [keep] a line whose own box is left as it is
 */
export function fixBoxes(lines, line, keep = -1) {
  const found = listAt(lines, line);
  if (!found) return lines;
  const out = [...lines];
  const { items } = found.list;
  const boxOf = (/** @type {number} */ k) => BOX_RE.exec(out[items[k].line])?.[2]?.toUpperCase() ?? null;
  const order = items.map((_, k) => k).sort((a, b) => items[b].indent - items[a].indent);
  for (const k of order) {
    if (boxOf(k) === null || items[k].line === keep) continue;
    const kids = items.map((it, c) => (it.parent === k ? c : -1)).filter((c) => c >= 0).map(boxOf);
    const has = (/** @type {string} */ b) => kids.includes(b);
    const state = has(' ') && has('X') ? '-' : has('-') ? '-' : has('X') ? 'X' : has(' ') ? ' ' : null;
    if (state === null) continue;
    out[items[k].line] = out[items[k].line].replace(BOX_RE, (_, head) => `${head}[${state}]`);
  }
  return out;
}
