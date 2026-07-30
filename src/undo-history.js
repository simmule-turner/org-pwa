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
 * History is scoped to one document's current editing session --
 * createHistory() is meant to be called fresh each time a document is
 * opened, not persisted or carried across a reopen.
 */

/** Starts a fresh history with a single snapshot representing the
 *  document as it was just opened. */
export function createHistory(initialText, initialLabel = 'Opened', now = new Date()) {
  return { entries: [{ text: initialText, label: initialLabel, timestamp: now }], index: 0 };
}

/**
 * Returns a NEW history with a snapshot of `text` pushed as the latest
 * step, labeled `label`. Any redo "future" past the current position is
 * discarded first -- a genuinely new edit invalidates whatever was
 * undone past this point, the same as undo/redo works in virtually
 * every editor. If `text` is identical to what's already at the
 * current position, returns the SAME history unchanged instead of
 * pushing a no-op entry -- an edit that turns out not to have actually
 * changed anything (toggling something and toggling it back, e.g.)
 * shouldn't clutter the history list.
 */
export function pushSnapshot(history, text, label, now = new Date()) {
  const current = history.entries[history.index];
  if (current && current.text === text) {
    return history;
  }
  const entries = history.entries.slice(0, history.index + 1);
  entries.push({ text, label, timestamp: now });
  return { entries, index: entries.length - 1 };
}

export function canUndo(history) {
  return history.index > 0;
}

export function canRedo(history) {
  return history.index < history.entries.length - 1;
}

/** Returns a NEW history with the index moved back one step, or the
 *  SAME history unchanged if there's nothing to undo. */
export function undo(history) {
  if (!canUndo(history)) return history;
  return { entries: history.entries, index: history.index - 1 };
}

/** Returns a NEW history with the index moved forward one step, or the
 *  SAME history unchanged if there's nothing to redo. */
export function redo(history) {
  if (!canRedo(history)) return history;
  return { entries: history.entries, index: history.index + 1 };
}

/**
 * Returns a NEW history with the index moved directly to
 * `targetIndex` -- browsing to a specific entry in a history list is
 * navigation, not a new edit, so unlike pushSnapshot this never
 * discards anything either side of it. Returns the SAME history
 * unchanged if targetIndex is out of range.
 */
export function jumpTo(history, targetIndex) {
  if (targetIndex < 0 || targetIndex >= history.entries.length) return history;
  return { entries: history.entries, index: targetIndex };
}

/** The entry the history's index currently points at -- the one whose
 *  text should match the document's current live state. */
export function currentEntry(history) {
  return history.entries[history.index];
}
