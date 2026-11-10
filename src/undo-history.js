// @ts-check
/**
 * Pure undo/redo history management for a single document's editing
 * session. No DOM, no app.js state beyond what's explicitly passed in
 * -- app.js owns the actual history object and calls these as pure
 * transformations (each returns a NEW history object rather than
 * mutating its input), matching this codebase's established pattern of
 * engine logic living here and DOM/state wiring living in app.js.
 *
 * Design, and why it's built this way rather than a command/undo-stack
 * of individual reversible operations: this app's edit operations are
 * spread across many different modules (heading-edit.js,
 * archive-model.js, body-edit.js, and others), each mutating the parsed
 * AST directly in its own shape. Giving every one of those a correct,
 * individually-tested undo AND redo would mean touching dozens of call
 * sites, each a new place to get subtly wrong. A snapshot-based history
 * -- storing the whole document's serialized text at each completed
 * edit, swapping between snapshots to move through history -- doesn't
 * need to understand what any given edit MEANT, only when one finished.
 * That makes it comprehensive by construction: every edit type gets
 * undo for free, not implemented one type at a time. The real
 * trade-off is coarser granularity (one step per completed edit
 * action -- toggling a TODO, finishing typing in a title and blurring
 * it, archiving a heading -- not per keystroke) and memory (a full text
 * copy per step, kept for as long as the document stays open, by
 * explicit design choice rather than a capped ring buffer).
 *
 * The history is a tree. An edit made after an undo starts a new branch from the step it was made on, and the steps that were undone
 * stay reachable: Undo goes to a step's parent, Redo to the child last visited (the newest, when none was), and jumpTo to any step.
 * `entries` stays one list in the order the steps were made, so an index names a step for good; each step says which step it follows
 * (`parent`, null for the first) and which of its children was visited last (`last`). A history saved before branches existed has no
 * `parent`, and then each step follows the one before it.
 *
 * History is scoped to one document's current editing session --
 * createHistory() is meant to be called fresh each time a document is
 * opened, not persisted or carried across a reopen.
 */

/**
 * @typedef {{ text: string, label: string, timestamp: Date, parent?: number | null, last?: number }} HistoryEntry
 * @typedef {{ entries: HistoryEntry[], index: number }} UndoHistory
 */

/** Starts a fresh history with a single snapshot representing the
 * @param {string} initialText
 *  document as it was just opened. */
export function createHistory(initialText, initialLabel = 'Opened', now = new Date()) {
  return { entries: [{ text: initialText, label: initialLabel, timestamp: now, parent: null }], index: 0 };
}

/** The step `i` follows, or null for the first step.
 * @param {UndoHistory} history @param {number} i @returns {number | null} */
export function parentOf(history, i) {
  const p = history.entries[i].parent;
  if (p === null) return null;
  return p !== undefined && p >= 0 && p < i ? p : i > 0 ? i - 1 : null;
}

/** The steps that follow step `i`, oldest first.
 * @param {UndoHistory} history @param {number} i */
export function childrenOf(history, i) {
  /** @type {number[]} */ const out = [];
  for (let j = i + 1; j < history.entries.length; j++) if (parentOf(history, j) === i) out.push(j);
  return out;
}

/** The child Redo goes to from step `i`: the one visited last, else the newest; null when there is none.
 * @param {UndoHistory} history @param {number} i @returns {number | null} */
function redoChild(history, i) {
  const kids = childrenOf(history, i);
  if (kids.length === 0) return null;
  const last = history.entries[i].last;
  return last !== undefined && kids.includes(last) ? last : kids[kids.length - 1];
}

/** A copy of the entries where every step on the way from the first to `target` remembers the child that leads there.
 * @param {UndoHistory} history @param {number} target */
function entriesLeadingTo(history, target) {
  const entries = history.entries.slice();
  let child = target;
  for (let p = parentOf(history, child); p !== null; p = parentOf(history, child)) {
    if (entries[p].last !== child) entries[p] = { ...entries[p], last: child };
    child = p;
  }
  return entries;
}

/**
 * Returns a NEW history with a snapshot of `text` pushed as the latest
 * step, labeled `label`, following the current step. What was undone
 * past this point stays as another branch (`keepBranches` false drops
 * it instead, for a history that is only ever a line). If `text` is
 * identical to what's already at the current position, returns the
 * SAME history unchanged instead of pushing a no-op entry -- an edit
 * that turns out not to have actually changed anything (toggling
 * something and toggling it back, e.g.) shouldn't clutter the list.
 * @param {UndoHistory} history
 * @param {string} text
 * @param {string} label
 * @param {Date} [now]
 * @param {boolean} [keepBranches]
 */
export function pushSnapshot(history, text, label, now = new Date(), keepBranches = true) {
  const current = history.entries[history.index];
  if (current && current.text === text) {
    return history;
  }
  const entries = keepBranches ? history.entries.slice() : history.entries.slice(0, history.index + 1);
  const at = entries.length;
  if (entries[history.index]) entries[history.index] = { ...entries[history.index], last: at };
  entries.push({ text, label, timestamp: now, parent: entries.length ? history.index : null });
  return { entries, index: at };
}

/** @param {UndoHistory} history */
export function canUndo(history) {
  return parentOf(history, history.index) !== null;
}

/** @param {UndoHistory} history */
export function canRedo(history) {
  return redoChild(history, history.index) !== null;
}

/** Returns a NEW history with the index moved back to the step the
 * @param {UndoHistory} history
 *  current one follows, or the SAME history if there's nothing to undo. */
export function undo(history) {
  const p = parentOf(history, history.index);
  if (p === null) return history;
  const entries = history.entries.slice();
  entries[p] = { ...entries[p], last: history.index }; // Redo comes back to the branch just left
  return { entries, index: p };
}

/** Returns a NEW history with the index moved forward to the child last
 * @param {UndoHistory} history
 *  visited, or the SAME history if there's nothing to redo. */
export function redo(history) {
  const c = redoChild(history, history.index);
  return c === null ? history : { entries: history.entries, index: c };
}

/**
 * Returns a NEW history with the index moved directly to
 * `targetIndex` -- browsing to a specific entry in a history list is
 * navigation, not a new edit, so unlike pushSnapshot this never
 * discards anything. Redo from the steps before it then leads back to
 * it. Returns the SAME history unchanged if targetIndex is out of range.
 * @param {UndoHistory} history
 * @param {number} targetIndex
 */
export function jumpTo(history, targetIndex) {
  if (targetIndex < 0 || targetIndex >= history.entries.length) return history;
  return { entries: entriesLeadingTo(history, targetIndex), index: targetIndex };
}

/** The entry the history's index currently points at -- the one whose
 * @param {UndoHistory} history
 *  text should match the document's current live state. */
export function currentEntry(history) {
  return history.entries[history.index];
}

/** How many branches the current step has to go forward on, and which one Redo takes (1-based), for "branch 2 of 3".
 * @param {UndoHistory} history */
export function redoBranches(history) {
  const kids = childrenOf(history, history.index);
  const c = redoChild(history, history.index);
  return { count: kids.length, which: c === null ? 0 : kids.indexOf(c) + 1 };
}

/**
 * The steps in the order a tree reads, each with its depth and where it stands from the current step: `now` is the current step,
 * `before` a step on the way to it from the first, `after` a step Redo reaches (following the branches visited last), `aside` any
 * other. A step with several children puts each one a level deeper; a single child continues at the same level.
 * @param {UndoHistory} history
 * @returns {{ index: number, depth: number, kind: 'now' | 'before' | 'after' | 'aside' }[]}
 */
export function treeRows(history) {
  const before = new Set();
  for (let p = parentOf(history, history.index); p !== null; p = parentOf(history, p)) before.add(p);
  const after = new Set();
  for (let c = redoChild(history, history.index); c !== null; c = redoChild(history, c)) after.add(c);
  /** @type {Map<number, number[]>} */ const kids = new Map();
  /** @type {number[]} */ const roots = [];
  for (let i = 0; i < history.entries.length; i++) {
    const p = parentOf(history, i);
    if (p === null) roots.push(i);
    else kids.set(p, [...(kids.get(p) || []), i]);
  }
  /** @type {{ index: number, depth: number, kind: 'now' | 'before' | 'after' | 'aside' }[]} */ const rows = [];
  /** @param {number} i @param {number} depth */
  const walk = (i, depth) => {
    rows.push({ index: i, depth, kind: i === history.index ? 'now' : before.has(i) ? 'before' : after.has(i) ? 'after' : 'aside' });
    const list = kids.get(i) || [];
    for (const k of list) walk(k, list.length > 1 ? depth + 1 : depth);
  };
  for (const r of roots) walk(r, 0);
  return rows;
}

/**
 * A history of at most `limit` steps. The steps that go first are the oldest ones with nothing after them that are not on the way to
 * the current step, so branches that were left die before the line being worked on; when only that line is left its oldest step goes.
 * Indexes shift to match, and a step whose predecessor went becomes a first step.
 * @param {UndoHistory} history @param {number} limit
 * @returns {UndoHistory}
 */
export function trimHistory(history, limit) {
  if (history.entries.length <= limit) return history;
  const n = history.entries.length;
  const gone = new Set();
  const parents = history.entries.map((_, i) => parentOf(history, i));
  const hasKids = new Array(n).fill(0);
  for (const p of parents) if (p !== null) hasKids[p]++;
  const onPath = new Set([history.index]);
  for (let p = parents[history.index]; p !== null; p = parents[p]) onPath.add(p);
  while (n - gone.size > limit) {
    let victim = -1;
    for (let i = 0; i < n && victim < 0; i++) if (!gone.has(i) && hasKids[i] === 0 && !onPath.has(i)) victim = i;
    for (let i = 0; i < n && victim < 0; i++) if (!gone.has(i) && parents[i] === null) victim = i; // only the line is left: its first step
    for (let i = 0; i < n && victim < 0; i++) if (!gone.has(i) && i !== history.index) victim = i;
    if (victim < 0) break;
    gone.add(victim);
    if (parents[victim] !== null) hasKids[/** @type {number} */ (parents[victim])]--;
    for (let j = 0; j < n; j++) if (parents[j] === victim) parents[j] = null;
  }
  /** @type {number[]} */ const newIndex = [];
  let next = 0;
  for (let i = 0; i < n; i++) newIndex.push(gone.has(i) ? -1 : next++);
  const entries = history.entries
    .map((e, i) => ({ e, i }))
    .filter(({ i }) => !gone.has(i))
    .map(({ e, i }) => {
      const p = parents[i];
      const out = { ...e, parent: p === null ? null : newIndex[p] };
      if (out.last !== undefined) { if (newIndex[out.last] >= 0) out.last = newIndex[out.last]; else delete out.last; }
      return out;
    });
  return { entries, index: newIndex[history.index] };
}
