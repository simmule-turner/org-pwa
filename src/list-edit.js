// @ts-check
/**
 * Plain-list structure on raw lines, the way Org reads it (`org-list-struct`): an item runs from its bullet to the next item
 * at its indentation or less, a more indented line belongs to it, and a list ends at a line indented less than its first item,
 * at a non-item line at that indentation, or at two blank lines.  The edits keep the list in order the way
 * `org-list-struct-fix-bul` and `org-list-struct-fix-box` do: ordered bullets are numbered again (a `[@N]` counter restarts the
 * count), and a checkbox with checkbox sub-items shows what they add up to.
 */

/** The blocks whose lines Org keeps as plain text; a list can stand inside the others (quote, center, special). */
const RAW_BEGIN_RE = /^[ \t]*#\+begin_(?:src|example|export|comment|verse)\b/i;
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
 * The parent of the item with indentation `ind` that follows `items`, as `org-list-parents-alist` finds it: a deeper item
 * belongs to the item before it; one that is less indented returns to the level it matches, or else to the nearest level
 * less indented (an ill-formed list), which may be the top.
 * @param {ListItemInfo[]} items @param {{ ind: number, origin: number }[]} stack @param {number} ind
 */
function parentOf(items, stack, ind) {
  if (items.length === 0) return -1;
  const prevInd = stack[0].ind;
  if (prevInd > ind) {
    let at = stack.findIndex((e) => e.ind === ind);
    if (at < 0) at = stack.findIndex((e) => e.ind < ind);
    if (at >= 0) stack.splice(0, at);
    else stack.splice(0, stack.length, { ind, origin: -1 });
    return stack[0].origin;
  }
  if (prevInd < ind) {
    stack.unshift({ ind, origin: items.length - 1 });
    return items.length - 1;
  }
  return stack[0].origin;
}

/**
 * Every list in `lines`, as the items of each with their parents and ends.
 * @param {string[]} lines
 * @param {boolean} [inBlocks] read the lines inside `#+begin_` blocks as list lines too, as `org-list-struct` does
 * @returns {{ items: ListItemInfo[], start: number, end: number }[]}
 */
export function findLists(lines, inBlocks = false) {
  /** @type {{ items: ListItemInfo[], start: number, end: number }[]} */
  const lists = [];
  let i = 0;
  let block = false;
  while (i < lines.length) {
    const line = lines[i];
    if (RAW_BEGIN_RE.test(line)) block = true;
    else if (/^[ \t]*#\+end_/i.test(line)) block = false;
    if ((block && !inBlocks) || !isItemLine(line)) {
      i += 1;
      continue;
    }
    const top = indentWidth(line);
    /** @type {ListItemInfo[]} */
    const items = [];
    /** @type {{ ind: number, origin: number }[]} Org's `ind-to-ori`: the indentations open so far, innermost first */
    const stack = [{ ind: top, origin: -1 }];
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
        items.push({ line: j, indent: ind, bullet: m[2], parent: parentOf(items, stack, ind), end: -1 });
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
  for (const inBlocks of [false, true]) {
    for (const list of findLists(lines, inBlocks)) {
      const index = list.items.findIndex((it) => it.line === line);
      if (index >= 0) return { list, index };
    }
  }
  return null;
}

/** Whether `line` lies inside a block whose lines Org keeps as plain text (src, example, export, comment, verse).
 * @param {string[]} lines @param {number} line */
export function inBlockAt(lines, line) {
  let open = false;
  for (let i = 0; i < line && i < lines.length; i++) {
    if (RAW_BEGIN_RE.test(lines[i])) open = true;
    else if (/^[ \t]*#\+end_/i.test(lines[i])) open = false;
  }
  return open;
}

/** `org-list-repair` on the item at `line`: bullets, indentation and boxes put in order; an error where Org finds no list (a
 * line inside a block).
 * @param {string[]} lines @param {number} line */
export function repairList(lines, line) {
  if (inBlockAt(lines, line)) throw new Error('This is not a list');
  return fixBoxes(renumber(lines, line), line);
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
 * Put the list that has an item on `line` in order the way `org-list-write-struct` does: each bullet follows the one before
 * it (the first item's type decides, a `[@N]` counter restarts the count), one space follows every bullet, sub-items sit
 * under their parent's text, and the text of an item moves with it.  Returns the new lines.
 * @param {string[]} lines @param {number} line
 * @param {number} [keep] a line whose text after its bullet is left exactly as written (a new item's " :: ")
 */
export function renumber(lines, line, keep = -1) {
  const found = listAt(lines, line);
  if (!found) return lines;
  const out = [...lines];
  const { items } = found.list;
  const itemLines = new Set(items.map((it) => it.line));
  const topIndent = items[0].indent;
  /** @type {string[]} */ const bullets = [];
  /** @type {number[]} */ const indents = [];
  const rewritten = items.map((it, k) => {
    const m = (it.line === keep ? /^([ \t]*)([-+*]|\d+[.)])(?: |$)/ : /^([ \t]*)([-+*]|\d+[.)])(?:[ \t]+|$)/).exec(lines[it.line]);
    if (!m) return null;
    const rest = lines[it.line].slice(m[0].length);
    const counter = /^\[@(\d+)\]/.exec(rest);
    let prev = -1;
    for (let p = k - 1; p >= 0; p--) {
      if (items[p].indent < it.indent) break;
      if (items[p].parent === it.parent && items[p].indent === it.indent) { prev = p; break; }
    }
    const own = m[2];
    let bullet = own;
    if (prev >= 0) {
      const pb = bullets[prev];
      if (counter && isOrdered(pb)) bullet = counter[1] + pb.slice(/^\d+/.exec(pb)?.[0].length ?? 0);
      else if (isOrdered(pb)) bullet = `${Number(/^\d+/.exec(pb)?.[0]) + 1}${pb.slice(-1)}`;
      else bullet = pb;
    } else if (counter && isOrdered(own)) bullet = counter[1] + own.slice(/^\d+/.exec(own)?.[0].length ?? 0);
    else if (isOrdered(own)) bullet = `1${own.slice(-1)}`;
    bullets[k] = bullet;
    indents[k] = it.parent >= 0 ? indents[it.parent] + bullets[it.parent].length + 1 : topIndent;
    return { rest, oldIndent: indentWidth(lines[it.line]), oldBullet: m[0].replace(/^[ \t]*/, '').length };
  });
  items.forEach((it, k) => {
    const r = rewritten[k];
    if (!r) return;
    out[it.line] = ' '.repeat(indents[k]) + bullets[k] + ' ' + r.rest;
    const shift = indents[k] + bullets[k].length + 1 - (r.oldIndent + r.oldBullet);
    if (shift === 0) return;
    for (let l = it.line + 1; l < it.end && !itemLines.has(l); l++) {
      if (out[l].trim() === '') continue;
      out[l] = shift > 0 ? ' '.repeat(shift) + out[l] : out[l].slice(Math.min(-shift, /^[ ]*/.exec(out[l])?.[0].length ?? 0));
    }
  });
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

/**
 * What kind of list the item on `line` is in, by the first item of its own level as `org-list-get-list-type` does: a number or
 * letter bullet makes it ordered, else a term before ` ::` makes it descriptive.
 * @param {string[]} lines @param {number} line @returns {'ordered' | 'descriptive' | 'unordered'}
 */
export function listKind(lines, line) {
  const found = listAt(lines, line);
  if (!found) return 'unordered';
  const { items } = found.list;
  const me = items[found.index];
  let first = found.index;
  for (let k = found.index - 1; k >= 0; k--) {
    if (items[k].indent < me.indent) break;
    if (items[k].parent === me.parent && items[k].indent === me.indent) first = k;
  }
  if (isOrdered(items[first].bullet)) return 'ordered';
  const text = lines[items[first].line].replace(/^[ \t]*[-+*][ \t]*/, '').replace(/^\[@\d+\][ \t]*/, '').replace(/^\[[ xX-]\][ \t]*/, '');
  const cut = /[ \t]::(?:[ \t]|$)/.exec(' ' + text);
  return cut && /\S/.test((' ' + text).slice(0, cut.index)) ? 'descriptive' : 'unordered';
}

/**
 * How many blank lines Org puts between the items around a new one (`org-list-separating-blank-lines-number` with
 * `org-blank-before-new-entry` on `auto`): the blank lines above the next item of the same level, else above this item when
 * it has a previous one, else none.
 * @param {string[]} lines @param {number} line
 */
export function separatingBlankLines(lines, line) {
  const found = listAt(lines, line);
  if (!found) return 0;
  const { items } = found.list;
  const me = items[found.index];
  const above = (/** @type {number} */ at) => {
    let n = 0;
    while (at - 1 - n >= 0 && lines[at - 1 - n].trim() === '') n += 1;
    return n;
  };
  const same = (/** @type {ListItemInfo} */ it) => it.parent === me.parent && it.indent === me.indent;
  let next = -1;
  for (let k = found.index + 1; k < items.length; k++) {
    if (items[k].indent < me.indent) break;
    if (same(items[k])) { next = k; break; }
  }
  if (next >= 0) return above(items[next].line);
  for (let k = found.index - 1; k >= 0; k--) {
    if (items[k].indent < me.indent) break;
    if (same(items[k])) return above(me.line);
  }
  return 0;
}
