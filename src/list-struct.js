// @ts-check
/**
 * Org's list commands on text, as org-list.el does them: the structure of a list (`org-list-struct`: for each item its position,
 * indentation, bullet, counter, checkbox, tag and end), the operations on it (`org-list-swap-items`, `org-list-send-item`,
 * `org-list-struct-indent`, `-outdent`, `-fix-bul`, `-fix-ind`, `-fix-box`, `org-list-write-struct`), and the commands built from them
 * (M-right and M-left on an item, M-S-right and M-S-left, M-up and M-down, C-c - on an item, C-c ^ on a list, C-c C-c on a checkbox, repair).
 * Positions are character offsets in `text`, as in Emacs, so each function follows its Lisp original.  A command takes the lines that hold the
 * list and the line the cursor is on, and returns the new lines.
 */
import { indentWidth } from './list-edit.js';

/** @typedef {{ pos: number, ind: number, bullet: string, counter: string | null, checkbox: string | null, tag: string | null, end: number }} Item */
/** @typedef {Item[]} Struct */
/** @typedef {{ indentOffset?: number, demoteModifyBullet?: [string, string][], twoSpaces?: RegExp | null, circular?: boolean, automaticIndent?: boolean, levelIncrement?: number, alphabetical?: boolean }} ListOptions */

const ITEM_BEGIN = /^(?:[ \t]*(?:[-+]|\d+[.)])|[ \t]+\*)(?:[ \t]+|$)/;
const ITEM_BEGIN_ALPHA = /^(?:[ \t]*(?:[-+]|(?:\d+|[A-Za-z])[.)])|[ \t]+\*)(?:[ \t]+|$)/;
/** The settings of the command being run: `org-list-allow-alphabetical`, `org-list-indent-offset`, `org-list-demote-modify-bullet`,
 *  `org-list-two-spaces-after-bullet-regexp`, `org-list-automatic-rules` (indent) and `org-level-increment`. */
/** @type {Required<ListOptions> & { alphabetical: boolean }} */
let cfg = { indentOffset: 0, demoteModifyBullet: [], twoSpaces: null, circular: false, automaticIndent: true, levelIncrement: 1, alphabetical: false };
const FULL_ITEM = /^[ \t]*((?:[-+*]|(?:\d+|[A-Za-z])[.)])(?:[ \t]+|$))(?:\[@(?:start:)?(\d+|[A-Za-z])\][ \t]*)?(?:(\[[ X-]\])(?:[ \t]+|$))?(?:(.*)[ \t]+::(?:[ \t]+|$))?/i;
const DRAWER_LINE = /^[ \t]*:[\p{L}\p{N}_-]+:[ \t]*$/u;
const END_DRAWER = /^[ \t]*:END:/i;
const BLOCK_LINE = /^[ \t]*#\+(begin|end)_/i;
const FORBIDDEN_BLOCKS = ['example', 'verse', 'src', 'export'];

// ---- the buffer: lines and positions -------------------------------------------------------------------------------------------

/** @param {string} t @param {number} p */
const lineBeg = (t, p) => (p <= 0 ? 0 : t.lastIndexOf('\n', p - 1) + 1);
/** @param {string} t @param {number} p */
const lineEnd = (t, p) => {
  const k = t.indexOf('\n', p);
  return k < 0 ? t.length : k;
};
/** The start of the line after the one at `p`, or the end of the text. @param {string} t @param {number} p */
const nextLine = (t, p) => Math.min(lineEnd(t, p) + 1, t.length);
/** @param {string} t @param {number} p */
const lineAt = (t, p) => t.slice(lineBeg(t, p), lineEnd(t, p));
/** @param {string} t @param {number} p */
const indentAt = (t, p) => indentWidth(lineAt(t, p));
/** `skip-chars-backward " \r\t\n"`. @param {string} t @param {number} p */
function skipBack(t, p) {
  let k = p;
  while (k > 0 && /[ \r\t\n]/.test(t[k - 1])) k -= 1;
  return k;
}
/** @param {string} t @param {number} p */
const isItem = (t, p) => (cfg.alphabetical ? ITEM_BEGIN_ALPHA : ITEM_BEGIN).test(lineAt(t, p));
/** @param {string} t @param {number} p */
const isBlank = (t, p) => /^[ \t]*$/.test(lineAt(t, p));
/** `org-list-end-re` at `p`: a blank line followed by another one. @param {string} t @param {number} p */
function atListEnd(t, p) {
  if (!isBlank(t, p)) return false;
  const e = lineEnd(t, p);
  return e < t.length && isBlank(t, e + 1) && lineEnd(t, e + 1) < t.length;
}
/** `indent-to` with `indent-tabs-mode` on, as it is in an Org buffer: a tab for each 8 columns. @param {number} n */
const spaces = (n) => '\t'.repeat(Math.max(0, Math.floor(n / 8))) + ' '.repeat(Math.max(0, n) % 8);

/** `org-list-bullet-string`. @param {string} bullet @param {ListOptions} [o] */
function bulletString(bullet, o = cfg) {
  const sp = o.twoSpaces && o.twoSpaces.test(bullet) ? '  ' : ' ';
  return bullet.replace(/(\S+)[ \t]*/, (_m, b) => b + sp);
}

// ---- the structure -------------------------------------------------------------------------------------------------------------

/**
 * `org-list-context`: the limits of the text a list at `pos` can stand in, and the kind of place it is.
 * @param {string} t @param {number} pos @returns {[number, number, string | null]}
 */
function listContext(t, pos) {
  const at = lineBeg(t, pos);
  let limUp = 0;
  let limDown = t.length;
  /** @type {string | null} */ let kind = null;
  const searchBack = (/** @type {(line: string) => boolean} */ test, /** @type {number} */ bound) => {
    for (let p = at === 0 ? -1 : lineBeg(t, at - 1); p >= 0 && p >= bound; p = p === 0 ? -1 : lineBeg(t, p - 1)) if (test(lineAt(t, p))) return p;
    return -1;
  };
  const searchFwd = (/** @type {(line: string) => boolean} */ test, /** @type {number} */ from, /** @type {number} */ bound) => {
    for (let p = from; p < t.length && p <= bound; p = nextLine(t, p)) {
      if (test(lineAt(t, p))) return p;
      if (nextLine(t, p) === p) break;
    }
    return -1;
  };
  const here = lineAt(t, at);
  if (!DRAWER_LINE.test(here) && !END_DRAWER.test(here)) {
    const b = searchBack((l) => DRAWER_LINE.test(l), limUp);
    if (b >= 0) {
      const beg = lineEnd(t, b) + 1;
      const e = searchFwd((l) => END_DRAWER.test(l), b, limDown); // the search goes on from the line found, as in Emacs
      const end = e >= 0 ? e - 1 : limDown;
      if (end >= at) [limUp, limDown, kind] = [beg, end, 'drawer'];
    }
  }
  if (!BLOCK_LINE.test(here)) {
    const b = searchBack((l) => BLOCK_LINE.test(l), limUp);
    const head = b >= 0 ? /^[ \t]*#\+begin_(\S+)/i.exec(lineAt(t, b)) : null;
    if (b >= 0 && head) {
      const beg = lineEnd(t, b) + 1;
      const e = searchFwd((l) => BLOCK_LINE.test(l), beg, limDown);
      const end = e >= 0 ? e - 1 : limDown;
      if (end >= at && e >= 0 && /^[ \t]*#\+end_/i.test(lineAt(t, e))) [limUp, limDown, kind] = [beg, end, FORBIDDEN_BLOCKS.includes(head[1].toLowerCase()) ? 'invalid' : 'block'];
    }
  }
  return [limUp, limDown, kind];
}

/** `org-at-item-p`: the line at `p` starts an item, and not in a block Org reads as text. @param {string} t @param {number} p */
export function atItem(t, p) {
  return isItem(t, p) && listContext(t, p)[2] !== 'invalid';
}

/** `org-in-item-p`: the start of the item `p` belongs to, or -1. @param {string} t @param {number} p */
export function itemOf(t, p) {
  let cur = lineBeg(t, p);
  const [limUp, , kind] = listContext(t, cur);
  if (kind === 'invalid') return -1;
  if (isItem(t, cur)) return cur;
  let indRef = isBlank(t, cur) ? 10000 : indentAt(t, cur);
  if (atListEnd(t, cur) || (cur > 0 && atListEnd(t, lineBeg(t, cur - 1)) && isBlank(t, cur))) cur = cur > 0 ? lineBeg(t, cur - 1) : 0;
  for (;;) {
    const ind = indentAt(t, cur);
    if (isItem(t, cur) && ind < indRef) return cur;
    if (cur <= limUp) return -1;
    if (atListEnd(t, cur)) return -1;
    if (/^[ \t]*#\+end_/i.test(lineAt(t, cur))) {
      let q = cur;
      let found = -1;
      while (q > limUp) {
        q = lineBeg(t, q - 1);
        if (/^[ \t]*#\+begin_/i.test(lineAt(t, q))) { found = q; break; }
        if (q === 0) break;
      }
      if (found >= 0) { cur = found; continue; }
    }
    if (END_DRAWER.test(lineAt(t, cur))) {
      let q = cur;
      let found = -1;
      while (q > limUp) {
        q = lineBeg(t, q - 1);
        if (DRAWER_LINE.test(lineAt(t, q))) { found = q; break; }
        if (q === 0) break;
      }
      if (found >= 0) { cur = found; continue; }
    }
    if (isBlank(t, cur)) {
      if (cur === 0) return -1;
      cur = lineBeg(t, cur - 1);
    } else if (ind === 0) return -1;
    else {
      if (ind < indRef) indRef = ind;
      if (cur === 0) return -1;
      cur = lineBeg(t, cur - 1);
    }
  }
}

/** The data of the item on the line at `pos`, as `org-list-full-item-re` reads it. @param {string} t @param {number} pos @returns {Item} */
function assocAt(t, pos) {
  const line = lineAt(t, pos);
  const m = /** @type {RegExpExecArray} */ (FULL_ITEM.exec(line));
  return { pos, ind: indentWidth(line), bullet: m[1], counter: m[2] ?? null, checkbox: m[3] ?? null, tag: /[-+*]/.test(m[1]) ? (m[4] ?? null) : null, end: -1 };
}

/**
 * `org-list-struct`: the items of the list the item at `point` belongs to.
 * @param {string} t @param {number} point
 * @returns {Struct}
 */
export function readStruct(t, point) {
  const start = lineBeg(t, point);
  const [limUp, limDown] = listContext(t, start);
  let textMinInd = 10000;
  let beg = { pos: start, ind: indentAt(t, start) };
  /** @type {Item[]} */ let itmLst = [];
  /** @type {{ ind: number, pos: number }[]} */ let endLst = [];
  const tail = () => {
    const i = itmLst.findIndex((e) => e.pos === beg.pos);
    return i >= 0 ? itmLst.slice(i) : [];
  };
  // 1. from the item up
  let cur = start;
  for (;;) {
    const ind = indentAt(t, cur);
    if (cur <= limUp) {
      if (!isItem(t, cur)) itmLst = tail();
      else {
        beg = { pos: cur, ind };
        itmLst.unshift(assocAt(t, cur));
      }
      break;
    }
    if (atListEnd(t, cur)) { itmLst = tail(); break; }
    if (isItem(t, cur)) {
      itmLst.unshift(assocAt(t, cur));
      endLst.unshift({ ind, pos: cur });
      if (ind < textMinInd) beg = { pos: cur, ind };
      cur = cur === 0 ? 0 : lineBeg(t, cur - 1);
      continue;
    }
    if (/^[ \t]*#\+end_/i.test(lineAt(t, cur))) {
      let q = cur;
      let found = -1;
      while (q > limUp) {
        q = lineBeg(t, q - 1);
        if (/^[ \t]*#\+begin_/i.test(lineAt(t, q))) { found = q; break; }
        if (q === 0) break;
      }
      if (found >= 0) { cur = found; continue; }
    }
    if (END_DRAWER.test(lineAt(t, cur))) {
      let q = cur;
      let found = -1;
      while (q > limUp) {
        q = lineBeg(t, q - 1);
        if (DRAWER_LINE.test(lineAt(t, q))) { found = q; break; }
        if (q === 0) break;
      }
      if (found >= 0) { cur = found; continue; }
    }
    if (isBlank(t, cur)) {
      cur = cur === 0 ? 0 : lineBeg(t, cur - 1);
      continue;
    }
    if (ind === 0) { itmLst = tail(); break; }
    if (ind < textMinInd) textMinInd = ind;
    endLst.unshift({ ind, pos: cur });
    cur = cur === 0 ? 0 : lineBeg(t, cur - 1);
  }
  // 2. from the item down
  /** @type {Item[]} */ const itm2 = [];
  /** @type {{ ind: number, pos: number }[]} */ const end2 = [];
  const beforeBlank = (/** @type {number} */ p) => {
    const k = skipBack(t, p);
    return Math.min(k === 0 ? lineEnd(t, 0) + 1 : lineEnd(t, k - 1) + 1, limDown);
  };
  cur = start;
  for (;;) {
    const ind = indentAt(t, cur);
    if (cur >= limDown) { end2.push({ ind: 0, pos: beforeBlank(cur) }); break; }
    if (atListEnd(t, cur)) { end2.push({ ind: 0, pos: cur }); break; }
    if (isItem(t, cur)) {
      itm2.push(assocAt(t, cur));
      end2.push({ ind, pos: cur });
      cur = nextLine(t, cur);
      continue;
    }
    if (isBlank(t, cur)) { cur = nextLine(t, cur); continue; }
    if (ind <= beg.ind) { end2.push({ ind: 0, pos: beforeBlank(cur) }); break; }
    if (ind <= itm2[itm2.length - 1].ind) end2.push({ ind, pos: cur });
    const line = lineAt(t, cur);
    if (/^[ \t]*#\+begin_/i.test(line)) {
      for (let q = nextLine(t, cur); q <= limDown && q < t.length; q = nextLine(t, q)) {
        if (/^[ \t]*#\+end_/i.test(lineAt(t, q))) { cur = q; break; }
        if (nextLine(t, q) === q) break;
      }
    } else if (DRAWER_LINE.test(line)) {
      for (let q = nextLine(t, cur); q <= limDown && q < t.length; q = nextLine(t, q)) {
        if (END_DRAWER.test(lineAt(t, q))) { cur = q; break; }
        if (nextLine(t, q) === q) break;
      }
    }
    cur = nextLine(t, cur);
  }
  const struct = [...itmLst, ...itm2.slice(1)];
  const ends = [...endLst, ...end2.slice(1)];
  assocEnd(struct, ends);
  return struct;
}

/** `org-list-struct-assoc-end`. @param {Struct} struct @param {{ ind: number, pos: number }[]} endList */
function assocEnd(struct, endList) {
  let endings = endList;
  for (const e of struct) {
    while (endings.length && endings[0].pos <= e.pos) endings = endings.slice(1);
    const hit = endings.find((c) => c.ind <= e.ind);
    e.end = hit ? hit.pos : -1;
  }
}

/** @param {Struct} struct @returns {Struct} */
const copyStruct = (struct) => struct.map((e) => ({ ...e }));
/** @param {Struct} struct @param {number} pos */
const get = (struct, pos) => struct.find((e) => e.pos === pos);
/** @param {Struct} struct @param {number} pos */
const must = (struct, pos) => /** @type {Item} */ (get(struct, pos));

/** `org-list-prevs-alist`: item -> previous item of its sub-list (or null). @param {Struct} struct @returns {Map<number, number | null>} */
function prevsOf(struct) {
  /** @type {Map<number, number | null>} */ const m = new Map();
  for (const e of struct) {
    const prev = struct.find((o) => o.end === e.pos);
    m.set(e.pos, prev ? prev.pos : null);
  }
  return m;
}

/** `org-list-parents-alist`: item -> parent (or null). @param {Struct} struct @returns {Map<number, number | null>} */
function parentsOf(struct) {
  /** @type {Map<number, number | null>} */ const m = new Map();
  m.set(struct[0].pos, null);
  /** @type {{ ind: number, origin: number | null }[]} */ let stack = [{ ind: struct[0].ind, origin: null }];
  const prevPos = [struct[0].pos];
  for (const it of struct.slice(1)) {
    const prevInd = stack[0].ind;
    prevPos.unshift(it.pos);
    if (prevInd > it.ind) {
      let i = stack.findIndex((e) => e.ind === it.ind);
      if (i < 0) i = stack.findIndex((e) => e.ind < it.ind);
      stack = i >= 0 ? stack.slice(i) : [{ ind: it.ind, origin: null }];
      m.set(it.pos, stack[0].origin);
    } else if (prevInd < it.ind) {
      const origin = prevPos[1];
      stack.unshift({ ind: it.ind, origin });
      m.set(it.pos, origin);
    } else m.set(it.pos, stack[0].origin);
  }
  return m;
}

/** @param {Struct} struct @param {number} pos */
function subtree(struct, pos) {
  const end = must(struct, pos).end;
  const out = [];
  for (const e of struct.slice(struct.findIndex((x) => x.pos === pos) + 1)) {
    if (e.pos < end) out.push(e.pos);
    else break;
  }
  return out;
}
/** @param {Struct} struct @param {number} pos */
const hasChild = (struct, pos) => {
  const i = struct.findIndex((x) => x.pos === pos);
  const next = struct[i + 1];
  return next && must(struct, pos).ind < next.ind ? next.pos : null;
};
/** @param {Map<number, number | null>} prevs @param {number} pos */
const nextItem = (prevs, pos) => {
  for (const [k, v] of prevs) if (v === pos) return k;
  return null;
};
/** @param {Struct} struct @param {Map<number, number | null>} prevs @param {number} pos */
function firstItem(struct, prevs, pos) {
  let f = pos;
  for (let p = prevs.get(f); p !== null && p !== undefined; p = prevs.get(f)) f = p;
  return f;
}
/** @param {Struct} struct @param {Map<number, number | null>} prevs @param {number} pos */
function lastItem(struct, prevs, pos) {
  let l = pos;
  for (let n = nextItem(prevs, l); n !== null; n = nextItem(prevs, l)) l = n;
  return l;
}
/** The end of the item before its blank lines, at the end of that line. @param {string} t @param {Struct} struct @param {number} pos */
function endBeforeBlankOf(t, struct, pos) {
  const k = skipBack(t, must(struct, pos).end);
  return lineEnd(t, k === 0 ? 0 : k);
}
/** @param {Struct} struct @returns {number} */
const bottomPoint = (struct) => Math.max(...struct.map((e) => e.end));

// ---- operations ----------------------------------------------------------------------------------------------------------------

/**
 * `org-list-swap-items`: the item at `begA` and the one at `begB` (both in the same sub-list, A first) trade places, blank lines at their
 * ends staying where they are.  Returns the new text and structure.
 * @param {string} t @param {number} begA @param {number} begB @param {Struct} struct
 * @returns {{ text: string, struct: Struct }}
 */
function swapItems(t, begA, begB, struct) {
  const endANoBlank = endBeforeBlankOf(t, struct, begA);
  const endBNoBlank = endBeforeBlankOf(t, struct, begB);
  const endA = must(struct, begA).end;
  const endB = must(struct, begB).end;
  const sizeA = endANoBlank - begA;
  const sizeB = endBNoBlank - begB;
  const bodyA = t.slice(begA, endANoBlank);
  const bodyB = t.slice(begB, endBNoBlank);
  const between = t.slice(endANoBlank, begB);
  const subA = [begA, ...subtree(struct, begA)];
  const subB = [begB, ...subtree(struct, begB)];
  const text = t.slice(0, begA) + bodyB + between + bodyA + t.slice(endBNoBlank);
  for (const e of struct) {
    const pos = e.pos;
    if (pos < begA) continue;
    if (subA.includes(pos)) {
      const endE = e.end;
      e.pos = pos + (endBNoBlank - endANoBlank);
      e.end = endE + (endBNoBlank - endANoBlank);
      if (endE === endA) e.end = endB;
    } else if (subB.includes(pos)) {
      const endE = e.end;
      e.pos = pos + begA - begB;
      e.end = endE + (begA - begB);
      if (endE === endB) e.end = begA + sizeB + (endA - endANoBlank);
    } else if (pos < begB) {
      const endE = e.end;
      e.pos = pos + (sizeB - sizeA);
      e.end = endE + (sizeB - sizeA);
    }
  }
  struct.sort((a, b) => a.pos - b.pos);
  return { text, struct };
}


/** `org-list-use-alpha-bul-p`. @param {number} first @param {Struct} struct @param {Map<number, number | null>} prevs */
function useAlphaBullet(first, struct, prevs) {
  if (!cfg.alphabetical) return false;
  let ascii = 64;
  for (let item = /** @type {number | null} */ (first); item !== null; item = nextItem(prevs, item)) {
    const count = must(struct, item).counter;
    ascii = count && /[a-zA-Z]/.test(count) ? count.toUpperCase().charCodeAt(0) : ascii + 1;
    if (ascii > 90) return false;
  }
  return true;
}

/** `org-list-inc-bullet-maybe`. @param {string} bullet */
function incBullet(bullet) {
  if (/\d+/.test(bullet)) return bullet.replace(/\d+/, (n) => String(Number(n) + 1));
  if (/[A-Za-z]/.test(bullet)) return bullet.replace(/[A-Za-z]/, (c) => String.fromCharCode(c.charCodeAt(0) + 1));
  return bullet;
}

/** `org-list-struct-fix-bul`: the bullet of each item follows the one before it and the first item's kind. @param {Struct} struct @param {Map<number, number | null>} prevs */
function fixBullets(struct, prevs) {
  for (const it of struct) {
    const prev = prevs.get(it.pos);
    const prevItem = prev === null || prev === undefined ? null : must(struct, prev);
    const counter = it.counter;
    const bullet = it.bullet;
    const alphap = !prevItem && useAlphaBullet(it.pos, struct, prevs);
    let b;
    if (prevItem && counter && /[a-zA-Z]/.test(counter) && /[a-zA-Z]/.test(prevItem.bullet)) {
      const real = /[a-z]/.test(prevItem.bullet) ? counter.toLowerCase() : counter.toUpperCase();
      b = prevItem.bullet.replace(/[A-Za-z]/, real);
    } else if (prevItem && counter && /\d+/.test(counter) && /\d+/.test(prevItem.bullet)) b = prevItem.bullet.replace(/\d+/, counter);
    else if (prevItem) b = incBullet(prevItem.bullet);
    else if (counter && useAlphaBullet(it.pos, struct, prevs) && /[A-Za-z]/.test(counter) && /[A-Za-z]/.test(bullet)) {
      const real = /[a-z]/.test(bullet) ? counter.toLowerCase() : counter.toUpperCase();
      b = bullet.replace(/[A-Za-z]/, real);
    } else if (counter && /\d+/.test(counter) && /\d+/.test(bullet)) b = bullet.replace(/\d+/, counter);
    else if (alphap && /[A-Z]/.test(bullet)) b = bullet.replace(/[A-Za-z]/, 'A');
    else if (alphap && /[a-z]/.test(bullet)) b = bullet.replace(/[A-Za-z]/, 'a');
    else if (/(\d+|[A-Za-z])/.test(bullet)) b = bullet.replace(/(\d+|[A-Za-z])/, '1');
    else b = bullet;
    it.bullet = bulletString(b);
  }
}

/** `org-list-struct-fix-ind`. @param {Struct} struct @param {Map<number, number | null>} parents @param {number} [bulletSize] */
function fixIndent(struct, parents, bulletSize) {
  const topInd = struct[0].ind;
  for (const it of struct.slice(1)) {
    const parent = parents.get(it.pos);
    if (parent === null || parent === undefined) it.ind = topInd;
    else {
      const p = must(struct, parent);
      it.ind = (bulletSize ?? p.bullet.length) + p.ind + cfg.indentOffset;
    }
  }
}

/**
 * `org-list-struct-fix-box`: a checkbox with checkbox sub-items shows what they add up to, innermost first; with `ordered`, no box is
 * checked after an unchecked one (the blocking item is returned).
 * @param {Struct} struct @param {Map<number, number | null>} parents @param {boolean} [ordered] @returns {number | null}
 */
function fixBoxes(struct, parents, ordered = false) {
  /** @type {number[]} */ const parentList = [];
  for (const e of struct) {
    const parent = parents.get(e.pos);
    if (parent !== null && parent !== undefined && must(struct, parent).checkbox !== null && !parentList.includes(parent)) parentList.push(parent);
  }
  parentList.sort((a, b) => must(struct, b).ind - must(struct, a).ind);
  for (const item of parentList) {
    const boxes = struct.filter((c) => parents.get(c.pos) === item).map((c) => c.checkbox);
    const has = (/** @type {string} */ b) => boxes.includes(b);
    const it = must(struct, item);
    if (has('[ ]') && has('[X]')) it.checkbox = '[-]';
    else if (has('[-]')) it.checkbox = '[-]';
    else if (has('[X]')) it.checkbox = '[X]';
    else if (has('[ ]')) it.checkbox = '[ ]';
  }
  if (ordered) {
    const all = struct.map((e) => e.checkbox);
    const afterUnchecked = all.indexOf('[ ]');
    if (afterUnchecked >= 0 && all.slice(afterUnchecked).includes('[X]')) {
      for (const e of struct.slice(afterUnchecked)) if (e.checkbox !== null) e.checkbox = '[ ]';
      fixBoxes(struct, parents, false);
      return struct[afterUnchecked].pos;
    }
  }
  return null;
}

/** `org-list-struct-fix-item-end`. @param {Struct} struct */
function fixItemEnd(struct) {
  /** @type {{ ind: number, pos: number }[]} */ const endList = [];
  /** @type {{ end: number, pos: number }[]} */ const accEnd = [];
  for (const e of struct) {
    if (!get(struct, e.end)) {
      const up = accEnd.find((a) => a.end > e.end);
      endList.unshift({ ind: up ? must(struct, up.pos).ind + 2 : 0, pos: e.end });
    }
    endList.unshift({ ind: e.ind, pos: e.pos });
    accEnd.unshift({ end: e.end, pos: e.pos });
  }
  endList.sort((a, b) => a.pos - b.pos);
  assocEnd(struct, endList);
}

/** `indent-line-to` on the line at `p`. @param {string} t @param {number} p @param {number} col @returns {string} */
function indentLineTo(t, p, col) {
  const b = lineBeg(t, p);
  const m = /^[ \t]*/.exec(lineAt(t, b));
  return t.slice(0, b) + spaces(col) + t.slice(b + (m ? m[0].length : 0));
}

/**
 * `org-list-struct-apply-struct`: what differs between `struct` and `oldStruct` is written into the text (bullets, checkboxes,
 * indentation of items and the text under them).  Returns the new text.
 * @param {string} text0 @param {Struct} struct @param {Struct} oldStruct @returns {string}
 */
function applyStruct(text0, struct, oldStruct) {
  let t = text0;
  /** @type {Map<number, number>} */ const itemShift = new Map();
  /** @type {{ end: number, up: number | null }[]} */ const endList = [];
  /** @type {{ end: number, pos: number }[]} */ let accEnd = [];
  for (const e of oldStruct) {
    const now = get(struct, e.pos);
    const indPos = now ? now.ind : e.ind;
    const bulPos = now ? now.bullet : e.bullet;
    itemShift.set(e.pos, indPos + bulPos.length - (e.ind + e.bullet.length));
    if (!get(oldStruct, e.end)) {
      const up = accEnd.find((a) => a.end > e.end);
      endList.push({ end: e.end, up: up ? up.pos : null });
    }
    accEnd.unshift({ end: e.end, pos: e.pos });
  }
  const ends = [...new Set(endList.map((x) => x.end))];
  const all = [...oldStruct.map((e) => e.pos), ...ends].sort((a, b) => a - b);
  accEnd = [...accEnd].reverse();
  /** @type {{ down: number, up: number, delta: number }[]} */ const slices = [];
  for (let k = 0; k + 1 < all.length; k++) {
    const up = all[k];
    const down = all[k + 1];
    let delta;
    if (get(struct, up)) delta = itemShift.get(up) ?? 0;
    else {
      const child = accEnd.find((a) => a.end === up);
      const ind = child ? must(struct, child.pos).ind : 0;
      let minInd = Number.MAX_SAFE_INTEGER;
      for (let p = up; p < down && p < t.length; p = nextLine(t, p)) {
        if (!isBlank(t, p)) {
          minInd = Math.min(minInd, indentAt(t, p));
          const line = lineAt(t, p);
          let skip = -1;
          const block = /^[ \t]*#\+BEGIN(:|_\S+)/i.exec(line);
          if (block) {
            const re = new RegExp('^[ \\t]*#\\+END' + block[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*$', 'i');
            for (let q = nextLine(t, p); q < down && q < t.length; q = nextLine(t, q)) if (re.test(lineAt(t, q))) { skip = q; break; }
          } else if (DRAWER_LINE.test(line)) {
            for (let q = nextLine(t, p); q < down && q < t.length; q = nextLine(t, q)) if (/^[ \t]*:END:[ \t]*$/i.test(lineAt(t, q))) { skip = q; break; }
          }
          if (skip > p) p = skip;
        }
        if (nextLine(t, p) === p) break;
      }
      delta = ind - minInd;
    }
    slices.unshift({ down, up, delta });
  }
  for (const { down, up, delta } of slices) {
    if (delta !== 0) {
      let p = lineBeg(t, skipBack(t, down) === 0 ? 0 : skipBack(t, down));
      for (;;) {
        if (!(p > up || (p === up && !isItem(t, p)))) break;
        if (/^[ \t]*\S/.test(lineAt(t, p))) t = indentLineTo(t, p, indentAt(t, p) + delta);
        if (p === 0) break;
        p = lineBeg(t, p - 1);
      }
    }
    const cell = get(struct, up);
    const was = get(oldStruct, up);
    if (cell && !(was && was.ind === cell.ind && was.bullet === cell.bullet && was.counter === cell.counter && was.checkbox === cell.checkbox && was.tag === cell.tag && was.end === cell.end)) t = modifyItem(t, up, cell, was);
  }
  return t;
}

/** Writes the bullet, box and indentation of the item at `item` as `cell` has them. @param {string} t @param {number} item @param {Item} cell @param {Item | undefined} was */
function modifyItem(t, item, cell, was) {
  const newInd = cell.ind;
  const oldInd = indentAt(t, item);
  const newBul = bulletString(cell.bullet);
  const oldBul = was ? was.bullet : cell.bullet;
  const line0 = lineAt(t, item);
  let m = /** @type {RegExpExecArray} */ (FULL_ITEM.exec(line0));
  let line = line0;
  if (oldBul !== newBul) {
    const at = line.indexOf(m[1], /^[ \t]*/.exec(line)?.[0].length ?? 0);
    line = line.slice(0, at) + newBul + line.slice(at + m[1].length);
  }
  m = /** @type {RegExpExecArray} */ (FULL_ITEM.exec(line));
  const newBox = cell.checkbox;
  if (m[3] === newBox || (m[3] === undefined && newBox === null)) {
    // nothing to do
  } else if (m[3] !== undefined && newBox !== null) {
    const at = line.indexOf(m[3], m[0].indexOf(m[1]) + m[1].length);
    line = line.slice(0, at) + newBox + line.slice(at + m[3].length);
  } else if (m[3] !== undefined) {
    line = line.replace(/^(.*?)([ \t]*\[[ X-]\])/i, '$1');
  } else {
    const counterEnd = m[2] === undefined ? -1 : line.indexOf(m[2], m[0].indexOf(m[1]) + m[1].length) + m[2].length;
    const at = counterEnd >= 0 ? counterEnd + 1 : (/^[ \t]*/.exec(line)?.[0].length ?? 0) + m[1].length;
    line = line.slice(0, at) + (newBox ?? '') + (counterEnd >= 0 ? '' : ' ') + line.slice(at);
  }
  if (newInd !== oldInd) line = spaces(newInd) + line.replace(/^[ \t]*/, '');
  return t.slice(0, item) + line + t.slice(item + line0.length);
}

/**
 * `org-list-write-struct`: bullets, boxes and indentation of the list put in order and written to the text.
 * @param {string} t @param {Struct} struct @param {Map<number, number | null>} parents @param {Struct} [oldStruct] @returns {string}
 */
function writeStruct(t, struct, parents, oldStruct) {
  const old = oldStruct ?? copyStruct(struct);
  fixIndent(struct, parents, 2);
  fixItemEnd(struct);
  const prevs = prevsOf(struct);
  fixBullets(struct, prevs);
  fixIndent(struct, parents);
  fixBoxes(struct, parents);
  return applyStruct(t, struct, old);
}

// ---- the commands ----------------------------------------------------------------------------------------------------------------

/** @param {string[]} lines */
const toText = (lines) => (lines.length ? lines.join('\n') + '\n' : '');
/** @param {string} t */
const toLines = (t) => (t === '' ? [] : t.replace(/\n$/, '').split('\n'));
/** @param {string[]} lines @param {number} line */
const posOf = (lines, line) => lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
/** @param {string} t @param {number} pos */
const lineOfPos = (t, pos) => t.slice(0, pos).split('\n').length - 1;

/**
 * Runs `fn` with the settings in `o` for the list commands.
 * @template T @param {ListOptions | undefined} o @param {() => T} fn @returns {T}
 */
function withOptions(o, fn) {
  const saved = cfg;
  cfg = { ...cfg, ...o };
  try {
    return fn();
  } finally {
    cfg = saved;
  }
}

/** `org-update-checkbox-count-maybe` after a list command: the `[n/m]` and `[n%]` cookies of items count the boxes of their sub-items. @param {string[]} lines */
function refreshItemCookies(lines) {
  const itemRe = /^([ \t]*)(?:[-+*]|\d+[.)]|[A-Za-z][.)])(?:[ \t]+|$)/;
  const cookieRe = /\[\d*\/\d*\]|\[\d*%\]/g;
  return lines.map((l, i) => {
    const m = itemRe.exec(l);
    if (!m || !cookieRe.test(l)) return l;
    cookieRe.lastIndex = 0;
    const ind = indentWidth(m[1]);
    let checked = 0;
    let total = 0;
    let childInd = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^[ \t]*$/.test(lines[j])) continue;
      const c = itemRe.exec(lines[j]);
      const w = indentWidth(/^[ \t]*/.exec(lines[j])?.[0] ?? '');
      if (w <= ind) break;
      if (!c) continue;
      if (childInd < 0) childInd = w;
      if (w !== childInd) continue;
      const box = /^[ \t]*(?:[-+*]|\d+[.)]|[A-Za-z][.)])[ \t]+(?:\[@\d+\][ \t]*)?\[([ Xx-])\](?:[ \t]|$)/.exec(lines[j]);
      if (!box) continue;
      total++;
      if (box[1] !== ' ' && box[1] !== '-') checked++;
    }
    return l.replace(cookieRe, (c) => (c.includes('%') ? `[${Math.floor((100 * checked) / Math.max(1, total))}%]` : `[${checked}/${total}]`));
  });
}

/** The item the cursor is in, or an error as `org-at-item-p` would give. @param {string} t @param {number} pos */
function itemAtPoint(t, pos) {
  if (!atItem(t, lineBeg(t, pos))) throw new Error('Not at an item');
  return lineBeg(t, pos);
}

/**
 * `org-list-indent-item-generic`: the item on `line` (or the items of the lines `region` from first to last) indented (`arg` 1) or
 * outdented (-1), with its sub-items unless `noSubtree`.
 * @param {string[]} lines @param {number} line @param {1 | -1} arg @param {boolean} noSubtree @param {[number, number] | null} region @param {ListOptions} [o]
 * @returns {string[]}
 */
function indentGeneric(lines, line, arg, noSubtree, region, o) {
  return refreshItemCookies(indentGenericRaw(lines, line, arg, noSubtree, region, o));
}
/** @param {string[]} lines @param {number} line @param {number} arg @param {boolean} noSubtree @param {[number, number] | null} region @param {ListOptions | undefined} o */
function indentGenericRaw(lines, line, arg, noSubtree, region, o) {
  return withOptions(o, () => {
    const t = toText(lines);
    const at = region ? posOf(lines, region[0]) : posOf(lines, line);
    if (!atItem(t, at)) throw new Error(region ? 'Region not starting at an item' : 'Not at an item');
    const struct = readStruct(t, at);
    const parents = parentsOf(struct);
    const prevs = prevsOf(struct);
    const top = struct[0].pos;
    const bol = lineBeg(t, posOf(lines, line));
    let specialp = false;
    if (!region && top === bol && cfg.automaticIndent) {
      if (noSubtree) throw new Error('At first item: use S-M-<left/right> to move the whole list');
      specialp = true;
    }
    const beg = region ? posOf(lines, region[0]) : bol;
    const end = region ? posOf(lines, region[1] + 1) - 1 : specialp ? bottomPoint(struct) : noSubtree ? bol + 1 : must(struct, bol).end;
    if (specialp) {
      const offset = arg < 0 ? -cfg.levelIncrement : cfg.levelIncrement;
      const old = copyStruct(struct);
      if (struct[0].ind + offset < 0) throw new Error('Cannot outdent beyond margin');
      if (struct[0].ind + offset === 0 && /\*/.test(struct[0].bullet)) struct[0].bullet = bulletString('-');
      for (const e of struct) e.ind += offset;
      fixBullets(struct, prevs);
      return toLines(applyStruct(t, struct, old));
    }
    if (arg < 0) {
      const lastItem = [...struct].reverse().find((e) => e.pos < end);
      if ((noSubtree && !region && hasChild(struct, beg)) || (lastItem && hasChild(struct, lastItem.pos))) throw new Error('Cannot outdent an item without its children');
    }
    const old = copyStruct(struct);
    const newParents = arg < 0 ? outdentStruct(beg, end, struct, parents) : indentStruct(beg, end, struct, parents, prevs);
    return toLines(writeStruct(t, struct, newParents, old));
  });
}

/** `org-list-struct-outdent`. @param {number} start @param {number} end @param {Struct} struct @param {Map<number, number | null>} parents */
function outdentStruct(start, end, struct, parents) {
  /** @type {{ a: number, b: number }[]} */ const acc = [];
  /** @type {Map<number, number | null>} */ const out = new Map();
  for (const [item, parent] of parents) {
    if (item < start) out.set(item, parent);
    else if (item >= end) {
      const conv = parent !== null ? acc.find((c) => c.a === parent) : undefined;
      out.set(item, conv ? conv.b : parent);
    } else if (parent === null) throw new Error('Cannot outdent top-level items');
    else if (parent >= start) {
      acc.unshift({ a: parent, b: item });
      out.set(item, parent);
    } else {
      const grand = parents.get(parent) ?? null;
      acc.unshift({ a: parent, b: item });
      out.set(item, grand);
    }
  }
  void struct;
  return out;
}

/** `org-list-struct-indent`. @param {number} start @param {number} end @param {Struct} struct @param {Map<number, number | null>} parents @param {Map<number, number | null>} prevs */
function indentStruct(start, end, struct, parents, prevs) {
  /** @type {{ item: number, parent: number | null }[]} */ const acc = [];
  /** @type {Map<number, number | null>} */ const out = new Map();
  for (const [item, parent] of parents) {
    if (item < start) out.set(item, parent);
    else if (item >= end) {
      const conv = acc.find((c) => c.item === parent);
      out.set(item, conv ? conv.parent : parent);
    } else {
      const prev = prevs.get(item) ?? null;
      const it = must(struct, item);
      const b = it.bullet;
      const key = /[A-Z]\./.test(b) ? 'A.' : /[A-Z]\)/.test(b) ? 'A)' : /[a-z]\./.test(b) ? 'a.' : /[a-z]\)/.test(b) ? 'a)' : /\d\./.test(b) ? '1.' : /\d\)/.test(b) ? '1)' : b.trim();
      const hit = cfg.demoteModifyBullet.find((x) => x[0] === key);
      if (hit) it.bullet = bulletString(hit[1]);
      let result;
      if (prev === null && (parent === null || parent < start)) throw new Error('Cannot indent the first item of a list');
      else if (prev === null) result = parent;
      else if (prev < start) result = prev;
      else result = acc.find((c) => c.item === prev)?.parent ?? null;
      acc.unshift({ item, parent: result });
      out.set(item, result);
    }
  }
  return out;
}

/** `org-indent-item` (M-right on an item): the item, not its sub-items. @param {string[]} lines @param {number} line @param {{ region?: [number, number], options?: ListOptions }} [a] */
export function indentItem(lines, line, a = {}) {
  return indentGeneric(lines, line, 1, true, a.region ?? null, a.options);
}
/** `org-outdent-item` (M-left). @param {string[]} lines @param {number} line @param {{ region?: [number, number], options?: ListOptions }} [a] */
export function outdentItem(lines, line, a = {}) {
  return indentGeneric(lines, line, -1, true, a.region ?? null, a.options);
}
/** `org-indent-item-tree` (M-S-right): the item and its sub-items; the first item moves the whole list. @param {string[]} lines @param {number} line @param {{ region?: [number, number], options?: ListOptions }} [a] */
export function indentItemTree(lines, line, a = {}) {
  return indentGeneric(lines, line, 1, false, a.region ?? null, a.options);
}
/** `org-outdent-item-tree` (M-S-left). @param {string[]} lines @param {number} line @param {{ region?: [number, number], options?: ListOptions }} [a] */
export function outdentItemTree(lines, line, a = {}) {
  return indentGeneric(lines, line, -1, false, a.region ?? null, a.options);
}

/** `org-move-item-down` (M-down): the item trades places with the next one of its list. @param {string[]} lines @param {number} line @param {ListOptions} [o] */
export function moveItemDown(lines, line, o) {
  return withOptions(o, () => {
    const t = toText(lines);
    const item = itemAtPoint(t, posOf(lines, line));
    const struct = readStruct(t, item);
    const next = nextItem(prevsOf(struct), item);
    if (next === null) throw new Error('Cannot move this item further down');
    const swapped = swapItems(t, item, next, struct);
    return toLines(writeStruct(swapped.text, swapped.struct, parentsOf(swapped.struct)));
  });
}
/** `org-move-item-up` (M-up). @param {string[]} lines @param {number} line @param {ListOptions} [o] */
export function moveItemUp(lines, line, o) {
  return withOptions(o, () => {
    const t = toText(lines);
    const item = itemAtPoint(t, posOf(lines, line));
    const struct = readStruct(t, item);
    const prev = prevsOf(struct).get(item) ?? null;
    if (prev === null) throw new Error('Cannot move this item further up');
    const swapped = swapItems(t, prev, item, struct);
    return toLines(writeStruct(swapped.text, swapped.struct, parentsOf(swapped.struct)));
  });
}

/** `org-list-repair`: bullets, indentation and boxes of the list put in order. @param {string[]} lines @param {number} line @param {ListOptions} [o] */
export function repairListAt(lines, line, o) {
  return withOptions(o, () => {
    const t = toText(lines);
    const at = posOf(lines, line);
    if (!atItem(t, at)) throw new Error('This is not a list');
    const struct = readStruct(t, lineBeg(t, at));
    return toLines(writeStruct(t, struct, parentsOf(struct)));
  });
}

/**
 * `org-cycle-list-bullet` (C-c -): the bullets of the list level go `-` -> `+` -> `*` -> `1.` -> `1)`; `which` is a bullet to use, a
 * number (0 is `-`), or `'previous'`.
 * @param {string[]} lines @param {number} line @param {string | number | 'previous' | null} [which] @param {ListOptions} [o]
 */
export function cycleListBullet(lines, line, which = null, o) {
  return withOptions(o, () => {
    const t = toText(lines);
    const item = itemAtPoint(t, posOf(lines, line));
    const struct = readStruct(t, item);
    const parents = parentsOf(struct);
    const prevs = prevsOf(struct);
    const first = firstItem(struct, prevs, item);
    const bullet = must(struct, first).bullet;
    const alphaP = useAlphaBullet(first, struct, prevs);
    const current = /[a-z]\./.test(bullet) ? 'a.' : /[a-z]\)/.test(bullet) ? 'a)' : /[A-Z]\./.test(bullet) ? 'A.' : /[A-Z]\)/.test(bullet) ? 'A)' : /\./.test(bullet) ? '1.' : /\)/.test(bullet) ? '1)' : bullet.trim();
    const afterBullet = lineAt(t, item).replace(/^[ \t]*(?:[-+*]|\d+[.)]|[A-Za-z][.)])[ \t]+/, '').replace(/^\[@\d+\][ \t]*/, '');
    const description = /^\S.+[ \t]+::([ \t]+|$)/.test(afterBullet);
    const list = ['-', '+'];
    if (!/\S/.test(lineAt(t, item)[0] ?? '')) list.push('*');
    if (!description) list.push('1.', '1)');
    if (alphaP && !description) list.push('a.', 'A.', 'a)', 'A)');
    const len = list.length;
    const idx = len - (list.length - list.indexOf(current));
    const itemIndex = list.indexOf(current) < 0 ? len : idx;
    const at = (/** @type {number} */ i) => list[((i % len) + len) % len];
    let next;
    if (typeof which === 'string' && which !== 'previous' && list.includes(which)) next = which;
    else if (typeof which === 'number') next = at(which);
    else if (which === 'previous') next = at(itemIndex - 1);
    else next = at(itemIndex + 1);
    const old = copyStruct(struct);
    must(struct, first).bullet = bulletString(next);
    fixBullets(struct, prevs);
    fixIndent(struct, parents);
    return toLines(applyStruct(t, struct, old));
  });
}

/**
 * `org-toggle-checkbox` on the item on `line`, on the items of `region` (lines), or on every item below a heading (`all`):
 * the first box decides (checked -> unchecked, else checked); `presence` 4 adds or removes boxes (C-u), 16 makes them `[-]` (C-u C-u).
 * @param {string[]} lines @param {number} line @param {{ presence?: 4 | 16 | null, region?: [number, number] | null, all?: boolean, ordered?: boolean, options?: ListOptions }} [a]
 */
export function toggleCheckbox(lines, line, a = {}) {
  return refreshItemCookies(toggleCheckboxRaw(lines, line, a));
}
/** @param {string[]} lines @param {number} line @param {Parameters<typeof toggleCheckbox>[2]} a */
function toggleCheckboxRaw(lines, line, a = {}) {
  return withOptions(a.options, () => {
    let t = toText(lines);
    const presence = a.presence ?? null;
    let limUp;
    let limDown;
    let singlep = false;
    if (a.region) {
      limUp = -1;
      for (let l = a.region[0]; l <= a.region[1]; l++) if (atItem(t, posOf(lines, l))) { limUp = posOf(lines, l); break; }
      if (limUp < 0) throw new Error('No item in region');
      limDown = posOf(lines, a.region[1] + 1) - 1;
    } else if (a.all) {
      limUp = -1;
      for (let l = 0; l < lines.length; l++) if (atItem(t, posOf(lines, l))) { limUp = posOf(lines, l); break; }
      if (limUp < 0) throw new Error('No item in subtree');
      limDown = t.length;
    } else if (atItem(t, posOf(lines, line))) {
      singlep = true;
      limUp = posOf(lines, line);
      limDown = lineEnd(t, limUp);
    } else throw new Error('Not at an item or heading, and no active region');
    const refBox = (() => {
      const m = /** @type {RegExpExecArray} */ (FULL_ITEM.exec(lineAt(t, limUp)));
      const cbox = m[3] !== undefined && /\[[- X]\][ \t]+|\[[- X]\]$/.test(lineAt(t, limUp)) ? m[3] : null;
      if (presence === 16) return '[-]';
      if (presence === 4) return cbox ? null : '[ ]';
      return cbox === '[X]' ? '[ ]' : '[X]';
    })();
    let at = limUp;
    while (at < limDown) {
      const item = nextItemFrom(t, at, limDown);
      if (item < 0) break;
      const struct = readStruct(t, item);
      const copy = copyStruct(struct);
      const parents = parentsOf(struct);
      const bottom = bottomPoint(struct);
      for (const e of struct) {
        if (e.pos < limUp || e.pos > limDown) continue;
        if (e.checkbox !== null || presence === 4) e.checkbox = refBox === null && presence === 4 ? null : refBox;
      }
      const block = fixBoxes(struct, parents, !!a.ordered);
      if (singlep && block !== null && limUp > block) throw new Error(`Checkbox blocked because of unchecked box at line ${lineOfPos(t, block) + 1}`);
      t = applyStruct(t, struct, copy);
      at = Math.max(bottom, nextLine(t, at));
      if (at <= item) break;
    }
    return toLines(t);
  });
}
/** The next item line at or after `from` and before `limit`. @param {string} t @param {number} from @param {number} limit */
function nextItemFrom(t, from, limit) {
  for (let p = lineBeg(t, from); p <= limit && p < t.length; p = nextLine(t, p)) {
    if (atItem(t, p)) return p;
    if (nextLine(t, p) === p) break;
  }
  return -1;
}

/** `string-to-number` of the start of `s`. @param {string} s */
function stringToNumber(s) {
  const m = /^[ \t]*([-+]?(?:\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?))/.exec(s);
  return m ? Number(m[1]) : 0;
}
/** `org-time-string-to-seconds` of the first timestamp in `s`, active ones first. @param {string} s @returns {number | null} */
function firstTimestampSeconds(s) {
  const m = /<(\d{4})-(\d{2})-(\d{2})(?: [^\r\n>0-9]*?)?(?: (\d{1,2}):(\d{2}))?[^\r\n>]*>/.exec(s) || /[<[](\d{4})-(\d{2})-(\d{2})(?: [^\r\n>\]0-9]*?)?(?: (\d{1,2}):(\d{2}))?[^\r\n>\]]*[>\]]/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)).getTime() / 1000;
}

/**
 * `org-sort-list` (C-c ^ on a list): the items of the list level the cursor is on, sorted; the blank lines between them stay where they
 * are, sub-lists move with their item.  `type` is `a` alphabetically, `n` numerically, `t` by time stamp, `x` by checked status, or `f`
 * with `getKey` (text of the item after its bullet and box -> key) and `compare`; a capital letter reverses the order.
 * @param {string[]} lines @param {number} line @param {string} type
 * @param {{ withCase?: boolean, getKey?: (text: string) => string | number, compare?: (a: any, b: any) => boolean, now?: number, options?: ListOptions }} [a]
 */
export function sortList(lines, line, type, a = {}) {
  return withOptions(a.options, () => {
    const t = toText(lines);
    const item = itemAtPoint(t, posOf(lines, line));
    const struct = readStruct(t, item);
    const prevs = prevsOf(struct);
    const first = firstItem(struct, prevs, item);
    const last = lastItem(struct, prevs, item);
    const start = first;
    const end = must(struct, last).end;
    const dcst = type.toLowerCase();
    if (!/^[nafxt]$/.test(dcst)) throw new Error(`Invalid sorting type \`${type}'`);
    if (dcst === 'f' && !a.getKey) throw new Error('Missing key extractor');
    const reverse = dcst !== type;
    const fold = a.withCase ? (/** @type {string} */ s) => s : (/** @type {string} */ s) => s.toLowerCase();
    /** @type {{ key: string | number | null, s: number, e: number }[]} */ const records = [];
    let p = start;
    while (p < end) {
      while (p < end && /[ \r\t\n]/.test(t[p])) p += 1;
      if (p >= end) break;
      p = lineBeg(t, p);
      const e = endBeforeBlankOf(t, struct, p);
      const first1 = lineAt(t, p);
      const m = /^[ \t]*[-+*0-9.)]+([ \t]+\[[- X]\])?[ \t]+/.exec(first1);
      /** @type {string | number | null} */ let key = null;
      if (m) {
        const rest = first1.slice(m[0].length);
        if (dcst === 'n') key = stringToNumber(rest);
        else if (dcst === 'a') key = fold(rest);
        else if (dcst === 't') key = firstTimestampSeconds(first1) ?? (a.now ?? Date.now()) / 1000;
        else if (dcst === 'x') key = m[1] ?? '';
        else if (a.getKey) {
          const v = a.getKey(rest);
          key = typeof v === 'string' ? fold(v) : v;
        }
      }
      records.push({ key, s: p, e });
      p = e;
    }
    const lessp = dcst === 'f' && a.compare ? a.compare : (/** @type {string | number | null} */ x, /** @type {string | number | null} */ y) => /** @type {number} */ (x) < /** @type {number} */ (y);
    // sort-subr: the records come in reverse order, are put in text order unless the sort is reversed, sorted stably, and reversed at the end
    const indexed = records.map((r, i) => ({ r, i }));
    if (reverse) indexed.reverse();
    const rank = new Map(indexed.map((x, k) => [x, k]));
    indexed.sort((x, y) => (lessp(x.r.key, y.r.key) ? -1 : lessp(y.r.key, x.r.key) ? 1 : /** @type {number} */ (rank.get(x)) - /** @type {number} */ (rank.get(y))));
    const ordered = reverse ? indexed.reverse() : indexed;
    let out = t.slice(0, start);
    records.forEach((r, k) => {
      out += t.slice(ordered[k].r.s, ordered[k].r.e);
      if (k + 1 < records.length) out += t.slice(r.e, records[k + 1].s);
    });
    out += t.slice(records.length ? records[records.length - 1].e : start);
    // org-list-repair runs with the buffer narrowed to the list level that was sorted
    const sortedEnd = end + (out.length - t.length);
    const region = toLines(out.slice(start, sortedEnd));
    const fixed = repairListAt(region, 0, a.options);
    return toLines(out.slice(0, start)).concat(fixed, toLines(out.slice(sortedEnd)));
  });
}
