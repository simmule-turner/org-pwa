// @ts-check
/**
 * The date tree a `file+olp+datetree` capture target files under: year, then month, then day (or year, ISO week, day with
 * `:tree-type week`, or year and month with `:tree-type month`). It finds or creates the headings the way org-datetree.el
 * does (Org 9.6): the first heading in the searched part whose number is not less than the date's is the one that is used,
 * or the new heading goes before it, and with none the new heading goes at the end. Org also tidies the blank lines
 * around a new heading (it deletes the blanks before the insertion point and adds one back when the heading before it has
 * one), so the work is done on the text of the searched part and the result is carried back to the headings.
 */

import { createHeading } from './heading-edit.js';
import { formatTimeString } from './format-time.js';
import { headingPreambleLines } from './org-parser.js';

/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */

/** Headings created at the end of the part searched with the document going on after it; org leaves a blank line before a table captured under one. */
export const endCreated = new WeakSet();

const HEADING = /^\*+ /;
const BLANK = /^[ \t]*$/;
const WORD = '[\\p{L}\\p{N}_]+';

/**
 * One node's place in the text of the searched part.
 * @typedef {{ node: Heading | Doc, start: number, pre: number, body: number }} Span
 */

/** Every heading of `root` (itself too, when it is one), in file order.
 * @param {Heading | Doc} root */
function walk(root) {
  /** @type {Heading[]} */ const out = [];
  /** @param {Heading} h */
  const visit = (h) => {
    out.push(h);
    for (const c of h.children) visit(c);
  };
  if (root.type === 'heading') visit(/** @type {Heading} */ (root));
  else for (const c of root.children) visit(c);
  return out;
}

/** The lines of a document before its first heading, as serializeOrg writes them.
 * @param {Doc} doc */
function preambleLines(doc) {
  const kws = doc.keywords.filter((k) => !k.virtual).map((kw, i) => ({ kw, i })).sort((a, b) => ((a.kw.bodyLineIndex ?? 0) - (b.kw.bodyLineIndex ?? 0)) || a.i - b.i);
  const body = doc.bodyLines || [];
  const out = [];
  let bi = 0;
  let lastKw = -1; // the place of the last keyword line, and how many body lines come before it
  let bodyBefore = 0;
  for (const { kw } of kws) {
    const upTo = Math.min(kw.bodyLineIndex ?? 0, body.length);
    while (bi < upTo) out.push(body[bi++]);
    lastKw = out.length;
    bodyBefore = bi;
    out.push(`#+${kw.key}: ${kw.value}`);
  }
  while (bi < body.length) out.push(body[bi++]);
  return { lines: out, lastKw, bodyBefore };
}

/**
 * The text of `root` as lines, with the place of each node in them.
 * @param {Heading | Doc} root
 */
function layout(root) {
  /** @type {string[]} */ const lines = [];
  /** @type {Span[]} */ const spans = [];
  if (root.type !== 'heading') {
    const pre = preambleLines(/** @type {Doc} */ (root)).lines;
    spans.push({ node: root, start: 0, pre: 0, body: pre.length });
    lines.push(...pre);
  }
  /** @param {Heading} h */
  const visit = (h) => {
    const head = headingPreambleLines(h);
    const body = h.bodyLines || [];
    spans.push({ node: h, start: lines.length, pre: head.length, body: body.length });
    lines.push(...head, ...body);
    for (const c of h.children) visit(c);
  };
  if (root.type === 'heading') visit(/** @type {Heading} */ (root));
  else for (const c of root.children) visit(c);
  return { lines, spans };
}

/**
 * Whether `root` ends the document, so that nothing follows it in the file.
 * @param {Doc} doc @param {Heading | Doc} root
 */
function endsDocument(doc, root) {
  if (root === doc) return true;
  /** @param {Heading[]} list @returns {boolean | null} */
  const search = (list) => {
    for (let i = 0; i < list.length; i++) {
      if (list[i] === root) return i === list.length - 1;
      const inner = search(list[i].children);
      if (inner !== null) return inner && i === list.length - 1;
    }
    return null;
  };
  return !!search(doc.children);
}

/**
 * org--blank-before-heading-p with `org-blank-before-new-entry` at its default (auto), on the text left once the blanks
 * before the point are deleted. Returns null where Org signals an error (there is no heading to look back to).
 * @param {string} text @param {number} point
 */
function blankBeforeHeading(text, point) {
  const lines = text.split('\n');
  let p = 0;
  let col = point;
  while (p < lines.length - 1 && col > lines[p].length) {
    col -= lines[p].length + 1;
    p++;
  }
  let before = false;
  for (let j = p; j >= 0; j--) if (HEADING.test(lines[j])) { before = true; break; }
  let next = -1;
  for (let j = col === 0 ? p : p + 1; j < lines.length; j++) if (HEADING.test(lines[j])) { next = j; break; }
  if (!before && next < 0) return false;
  if (!before) return null; // org-back-to-heading: "Before first headline"
  let h = p;
  while (!HEADING.test(lines[h])) h--;
  const prevEmpty = (/** @type {number} */ n) => n > 0 && BLANK.test(lines[n - 1]);
  if (h > 0) return prevEmpty(h);
  const after = lines.findIndex((l, j) => j > 0 && HEADING.test(l));
  if (after > 0) return prevEmpty(after);
  // no heading follows: the end of the text, if that is the start of a line, and the line above it
  const trimmedEnd = text.replace(/[ \t]+$/, '');
  if (trimmedEnd.length === 0 || trimmedEnd.endsWith('\n')) {
    const end = trimmedEnd.split('\n');
    return end.length >= 2 && BLANK.test(end[end.length - 2]);
  }
  return false;
}

/**
 * Adds the heading `label`, at `level`, to `root` where org-datetree-insert-line would put it: before `before` (a heading of
 * the searched part), or at the end of the part.
 * @param {Doc} doc @param {Heading | Doc} root @param {Heading | null} before @param {number} level @param {string} label
 * @returns {Heading}
 */
function insertHeading(doc, root, before, level, label) {
  const { lines, spans } = layout(root);
  const atEof = endsDocument(doc, root);
  let text = lines.join('\n') + (atEof ? '' : '\n');
  let k = lines.length;
  if (before) k = spans.find((s) => s.node === before)?.start ?? lines.length;
  let point = 0;
  for (let i = 0; i < k; i++) point += lines[i].length + 1;
  if (!before) {
    point = text.length;
    if (text.length && !text.endsWith('\n')) {
      text += '\n';
      point = text.length;
    }
  }
  // the owner of the last line before the point
  const ownerSpan = k > 0 ? spans.find((s) => k - 1 >= s.start && k - 1 < s.start + s.pre + s.body) : spans[0];
  // delete the blanks before the point
  let end = point;
  while (end > 0 && /[ \t\n]/.test(text[end - 1])) end--;
  const kept = text.slice(0, end);
  text = kept + text.slice(point);
  const blank = blankBeforeHeading(text, end);
  if (blank === null) throw new Error('Before first headline');
  const empties = (kept === '' ? 1 : 0) + (blank ? 1 : 0);
  const keptLines = kept === '' ? [] : kept.split('\n');
  const inserted = [...Array(empties).fill(''), '*'.repeat(level) + ' ' + label];
  const newLines = [...keptLines, ...inserted];
  const headIndex = newLines.length - 1;
  const owner = ownerSpan ? ownerSpan.node : root;

  // the owner's body: its lines, as they now are
  if (owner.type === 'heading') {
    const span = /** @type {Span} */ (ownerSpan);
    const oldHeader = lines[span.start];
    const newHeader = newLines[span.start];
    const h = /** @type {Heading} */ (owner);
    if (newHeader !== undefined && newHeader !== oldHeader && /[ \t]$/.test(oldHeader)) {
      h.titleTail = '';
      h.tagsTail = '';
    }
    h.bodyLines = newLines.slice(span.start + span.pre, headIndex);
  } else {
    const d = /** @type {Doc} */ (owner);
    const { lastKw, bodyBefore } = preambleLines(d);
    d.bodyLines = [...(d.bodyLines || []).slice(0, bodyBefore), ...newLines.slice(lastKw + 1, headIndex)];
  }

  const node = createHeading({ level, title: label });
  if (atEof && !before) /** @type {string[]} */ (node.bodyLines).push('');
  const fits = before ? before.level === level : root.type === 'heading' ? level === /** @type {Heading} */ (root).level + 1 : level === 1;
  if (fits) {
    const located = before ? locate(root, before) : null;
    if (located) located.container.splice(located.index, 0, node);
    else root.children.push(node);
  } else {
    // a heading whose level is not the one org looks for: put the new one where the text puts it, and let the levels decide who is whose child
    const flat = walk(doc);
    const at = before ? flat.indexOf(before) : root.type === 'heading' ? flat.indexOf(/** @type {Heading} */ (root)) + walk(root).length : flat.length;
    flat.splice(at, 0, node);
    renest(doc, flat);
  }
  if (!before && !atEof) endCreated.add(node);
  if (root.type === 'heading') /** @type {Heading} */ (root).collapsed = false;
  return node;
}

/** Sets the children of every heading from the order and levels in `flat`, keeping the headings themselves.
 * @param {Doc} doc @param {Heading[]} flat */
function renest(doc, flat) {
  doc.children.length = 0;
  for (const h of flat) h.children.length = 0;
  /** @type {Heading[]} */ const stack = [];
  for (const h of flat) {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    (stack.length ? stack[stack.length - 1].children : doc.children).push(h);
    stack.push(h);
  }
}

/**
 * @param {Heading | Doc} root @param {Heading} node
 * @returns {{ container: Heading[], index: number } | null}
 */
function locate(root, node) {
  /** @param {Heading[]} list @returns {{ container: Heading[], index: number } | null} */
  const find = (list) => {
    const i = list.indexOf(node);
    if (i >= 0) return { container: list, index: i };
    for (const c of list) {
      const r = find(c.children);
      if (r) return r;
    }
    return null;
  };
  return find(root.children);
}

/**
 * org-datetree--find-create: the first heading of `root` whose line matches `re` with a number (group 1) not below `value`
 * is used if the numbers are equal; otherwise the new heading goes before it, or at the end if there is none.
 * @param {Doc} doc @param {Heading | Doc} root @param {RegExp} re @param {number} value @param {number} level @param {string} label
 */
function findCreate(doc, root, re, value, level, label) {
  for (const h of walk(root)) {
    const m = re.exec(headingPreambleLines(h)[0]);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < value) continue;
    if (n === value) return h;
    return insertHeading(doc, root, h, level, label);
  }
  return insertHeading(doc, root, null, level, label);
}

const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');

/**
 * Finds or creates the date tree for `date` under `base` (a heading, or null for the whole document), and returns the
 * heading a capture files under: the day, or with `treeType` month the month.
 * @param {Doc} doc @param {Heading | null} base @param {Date} date @param {string} [treeType] 'week', 'month' or anything else for days
 * @returns {Heading}
 */
export function findOrCreateDatetree(doc, base, date, treeType) {
  const week = treeType === 'week';
  const monthOnly = treeType === 'month';
  let root = base;
  if (!root) {
    const key = week ? 'WEEK_TREE' : 'DATE_TREE';
    root = walk(doc).find((h) => Object.keys(h.properties || {}).some((k) => k.toUpperCase() === key)) || null;
  }
  const top = root || doc;
  const baseLevel = root ? root.level + 1 : 1;
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const YEAR = /^\*+[ \t]+([12][0-9]{3})(\s*?([ \t]:[\p{L}\p{N}:_@#%]+:)?\s*$)/u;

  if (week) {
    const isoYear = Number(formatTimeString(date, '%G'));
    const isoWeek = Number(formatTimeString(date, '%V'));
    const y = findCreate(doc, top, YEAR, isoYear, baseLevel, formatTimeString(date, '%G'));
    const w = findCreate(doc, y, new RegExp(`^\\*+[ \\t]+${isoYear}-W([0-5][0-9])$`, 'u'), isoWeek, baseLevel + 1, formatTimeString(date, '%G-W%V'));
    return findCreate(doc, w, new RegExp(`^\\*+[ \\t]+${year}-${pad2(month)}-([0123][0-9]) ${WORD}$`, 'u'), day, baseLevel + 2, `${year}${formatTimeString(date, '-%m-%d %A')}`);
  }
  const y = findCreate(doc, top, YEAR, year, baseLevel, String(year));
  const m = findCreate(doc, y, new RegExp(`^\\*+[ \\t]+${year}-([01][0-9]) ${WORD}$`, 'u'), month, baseLevel + 1, `${year}${formatTimeString(date, '-%m %B')}`);
  if (monthOnly) return m;
  return findCreate(doc, m, new RegExp(`^\\*+[ \\t]+${year}-${pad2(month)}-([0123][0-9]) ${WORD}$`, 'u'), day, baseLevel + 2, `${year}${formatTimeString(date, '-%m-%d %A')}`);
}
