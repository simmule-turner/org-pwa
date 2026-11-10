// @ts-check
/**
 * Structure-aware three-way merge for Org text, used when the line-based merge (merge3.js) reports a clash. Each version is read as a
 * tree of headings (a heading's own lines are its title line and the body up to the next heading), and the three trees are merged by
 * heading: a subtree that one side moved or promoted and the other side edited comes out moved and edited, where lines alone see a
 * deletion and an insertion that clash with the edit.
 *
 * It only ever merges cleanly or gives up (returns null), so a caller keeps the line merge's conflicts when this cannot be sure.
 * It gives up when headings cannot be told apart (two with the same title and no :ID:), when a heading was deleted on one side and
 * changed on the other, when both sides edited the same lines of a heading or moved it to different places, or when the pieces do
 * not fit back into one tree.
 *
 * A heading is known by its :ID: property if it has one, else by its title (without stars, TODO keyword, priority and tags), so
 * a state change or a tag on one side does not hide the heading from the other side.
 */

/** @typedef {{ key: string, rest: string, body: string[], parent: string, gap: number }} Node */
/** @typedef {{ pre: string[], nodes: Map<string, Node>, order: Map<string, string[]>, tail: string[], newline: boolean }} Tree */
/** @typedef {(base: string, mine: string, theirs: string) => ({ conflictCount: number, mergedText?: string } | null)} Merge3 */

const HEADING = /^(\*+)(?:\s(.*))?$/;
const END_OF_LINES = '\u0000';

/** @param {string} rest  a heading line without its stars */
function titleOf(rest) {
  return rest
    .replace(/^\s+/, '')
    .replace(/^[A-Z][A-Z_-]+(?=\s|$)\s*/, '') // a TODO keyword
    .replace(/^\[#[A-Z0-9]+\]\s*/, '') // a priority
    .replace(/\s+:[\w@#%:]+:\s*$/, '') // tags
    .trim();
}

/** The :ID: of a heading's own lines, or null.
 * @param {string[]} body */
function idOf(body) {
  for (const line of body) {
    const m = /^\s*:ID:\s+(\S+)\s*$/i.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** Reads `text` as a tree, or null when two headings cannot be told apart.
 * @param {string} text @returns {Tree | null} */
function readTree(text) {
  const lines = text.split('\n');
  const newline = lines.length > 1 && lines[lines.length - 1] === '';
  if (newline) lines.pop();
  let tailAt = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^#\s*Local Variables:/i.test(lines[i])) {
      if (lines.slice(i).some((l) => /^#\s*End:/i.test(l))) tailAt = i;
      break;
    }
  }
  const tail = lines.slice(tailAt);
  /** @type {Tree} */
  const tree = { pre: [], nodes: new Map(), order: new Map([['', []]]), tail, newline };
  /** @type {{ level: number, rest: string, body: string[] }[]} */
  const raw = [];
  for (let i = 0; i < tailAt; i++) {
    const m = HEADING.exec(lines[i]);
    if (!m) {
      if (raw.length) raw[raw.length - 1].body.push(lines[i]);
      else tree.pre.push(lines[i]);
      continue;
    }
    raw.push({ level: m[1].length, rest: m[2] === undefined ? '' : ' ' + m[2], body: [] });
  }
  // keys, once all bodies are known (an :ID: may sit anywhere in the drawer)
  const keyOfIndex = raw.map((r) => {
    const id = idOf(r.body);
    return id ? `id:${id}` : `h:${titleOf(r.rest)}`;
  });
  if (new Set(keyOfIndex).size !== keyOfIndex.length) return null;
  const parentIndex = [];
  /** @type {number[]} */
  const open = [];
  for (let i = 0; i < raw.length; i++) {
    while (open.length && raw[open[open.length - 1]].level >= raw[i].level) open.pop();
    parentIndex.push(open.length ? open[open.length - 1] : -1);
    open.push(i);
  }
  for (let i = 0; i < raw.length; i++) {
    const parent = parentIndex[i] < 0 ? '' : keyOfIndex[parentIndex[i]];
    const gap = raw[i].level - (parentIndex[i] < 0 ? 0 : raw[parentIndex[i]].level);
    tree.nodes.set(keyOfIndex[i], { key: keyOfIndex[i], rest: raw[i].rest, body: raw[i].body, parent, gap });
    if (!tree.order.has(parent)) tree.order.set(parent, []);
    /** @type {string[]} */ (tree.order.get(parent)).push(keyOfIndex[i]);
  }
  return tree;
}

/** @template T @param {T} base @param {T} mine @param {T} theirs @returns {{ ok: boolean, value: T }} */
function scalar(base, mine, theirs) {
  if (mine === theirs) return { ok: true, value: mine };
  if (mine === base) return { ok: true, value: theirs };
  if (theirs === base) return { ok: true, value: mine };
  return { ok: false, value: base };
}

/** Three-way merge of lists of strings (lines, or keys), or null on a clash.
 * @param {string[]} base @param {string[]} mine @param {string[]} theirs @param {Merge3} merge3 @returns {string[] | null} */
function mergeLists(base, mine, theirs, merge3) {
  const join = (/** @type {string[]} */ l) => [...l, END_OF_LINES].join('\n');
  const r = merge3(join(base), join(mine), join(theirs));
  if (!r || r.conflictCount !== 0 || r.mergedText === undefined) return null;
  const out = r.mergedText.split('\n');
  return out.pop() === END_OF_LINES ? out : null;
}

/**
 * @param {string} baseText @param {string} mineText @param {string} theirsText
 * @param {Merge3} merge3  the line merge, used for the lines of one heading and for the order of siblings
 * @returns {string | null}  the merged text, or null when this cannot merge it cleanly
 */
export function structureMerge(baseText, mineText, theirsText, merge3) {
  const base = readTree(baseText);
  const mine = readTree(mineText);
  const theirs = readTree(theirsText);
  if (!base || !mine || !theirs) return null;

  const pre = mergeLists(base.pre, mine.pre, theirs.pre, merge3);
  const tail = mergeLists(base.tail, mine.tail, theirs.tail, merge3);
  const newline = scalar(base.newline, mine.newline, theirs.newline);
  if (!pre || !tail || !newline.ok) return null;

  /** @type {Map<string, { rest: string, body: string[], parent: string, gap: number }>} */
  const merged = new Map();
  const keys = new Set([...base.nodes.keys(), ...mine.nodes.keys(), ...theirs.nodes.keys()]);
  for (const key of keys) {
    const b = base.nodes.get(key);
    const m = mine.nodes.get(key);
    const t = theirs.nodes.get(key);
    const own = (/** @type {Node | undefined} */ n) => (n ? [n.rest, ...n.body] : null);
    const same = (/** @type {Node | undefined} */ x, /** @type {Node | undefined} */ y) => !!x && !!y && x.rest === y.rest && x.body.join('\n') === y.body.join('\n');
    if (b) {
      if (!m && !t) continue;
      if (!m) { if (!same(b, t)) return null; continue; } // deleted on one side, changed on the other: a clash
      if (!t) { if (!same(b, m)) return null; continue; }
    } else if (!m || !t) {
      const only = /** @type {Node} */ (m || t);
      merged.set(key, { rest: only.rest, body: only.body, parent: only.parent, gap: only.gap });
      continue;
    } else if (!same(m, t)) {
      return null;
    }
    const ownLines = mergeLists(b ? /** @type {string[]} */ (own(b)) : /** @type {string[]} */ (own(m)), /** @type {string[]} */ (own(m)), /** @type {string[]} */ (own(t)), merge3);
    if (!ownLines) return null;
    const parent = scalar(b ? b.parent : m.parent, m.parent, t.parent);
    const gap = scalar(b ? b.gap : m.gap, m.gap, t.gap);
    if (!parent.ok || !gap.ok) return null;
    merged.set(key, { rest: ownLines[0], body: ownLines.slice(1), parent: parent.value, gap: gap.value });
  }

  // the order of the children of every heading
  /** @type {Map<string, string[]>} */
  const children = new Map();
  for (const parent of new Set([...base.order.keys(), ...mine.order.keys(), ...theirs.order.keys(), ...[...merged.values()].map((n) => n.parent)])) {
    const list = mergeLists(base.order.get(parent) || [], mine.order.get(parent) || [], theirs.order.get(parent) || [], merge3);
    if (!list) return null;
    children.set(parent, list.filter((k) => merged.has(k)));
  }

  // the pieces must make one tree: every heading once, under the parent it was given
  const out = [...pre];
  const seen = new Set();
  /** @type {boolean} */
  let ok = true;
  /** @param {string} parent @param {number} level */
  const emit = (parent, level) => {
    for (const key of children.get(parent) || []) {
      const node = /** @type {NonNullable<ReturnType<typeof merged.get>>} */ (merged.get(key));
      if (node.parent !== parent || seen.has(key) || node.gap < 1) { ok = false; return; }
      seen.add(key);
      out.push('*'.repeat(level + node.gap) + node.rest, ...node.body);
      emit(key, level + node.gap);
      if (!ok) return;
    }
  };
  emit('', 0);
  if (!ok || seen.size !== merged.size) return null;
  out.push(...tail);
  if (newline.value) out.push('');
  return out.join('\n');
}
