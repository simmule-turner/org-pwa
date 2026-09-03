/**
 * Persists undo/redo history across reopens. Same adapter shape and
 * per-document key pattern as outbox.js ({ get(key), set(key, value),
 * delete(key) }), and the same "one entry per document, no attempt at
 * a global list" scoping -- outbox.js's own docstring anticipated
 * exactly this: "If per-edit history/undo is wanted later, that's a
 * different data structure built on top of this one, not a change to
 * this one." This is that data structure.
 *
 * Capped at HISTORY_STORE_LIMIT most-recent entries per document. The
 * in-memory, single-session history this replaces was deliberately
 * uncapped (see undo-history.js's own docstring) because a session's
 * own natural end -- closing the tab, reloading -- already bounded its
 * growth. Persisting removes that natural bound: a document kept in
 * regular long-term use (a daily journal edited for months) would
 * otherwise accumulate full-text snapshots indefinitely. Full-text
 * snapshots make this a real, current storage cost, not a
 * theoretical one -- trimming here is what keeps persisted undo
 * history from becoming an unbounded liability the in-memory version
 * never had to worry about.
 */

const HISTORY_STORE_LIMIT = 200;

function historyKey(documentId) {
  return 'history:' + documentId;
}

/** Unwraps an adapter.get() result -- some adapters (this app's own kv
 *  wrapper included) return { key, value, shared } rather than the
 *  raw stored string directly; this accepts either shape, matching
 *  outbox.js's own identical unwrapping. */
function unwrapAdapterValue(result) {
  return result && typeof result === 'object' && 'value' in result ? result.value : result;
}

/**
 * Saves `history` for `documentId`, trimming to the most recent
 * HISTORY_STORE_LIMIT entries first if it's grown past that. Trimming
 * from the front (oldest entries) rather than the back preserves the
 * most valuable, most recently relevant undo steps; `index` is
 * shifted by the same amount trimmed so it still points at the same
 * logical entry afterward.
 */
async function savePersistedHistory(adapter, documentId, history) {
  const overflow = history.entries.length - HISTORY_STORE_LIMIT;
  const entries = overflow > 0 ? history.entries.slice(overflow) : history.entries;
  const index = overflow > 0 ? Math.max(0, history.index - overflow) : history.index;
  await adapter.set(historyKey(documentId), JSON.stringify({ entries, index }));
}

/**
 * Loads the persisted history for `documentId`, or null if there is
 * none (nothing ever saved, corrupt/unparseable data, or an adapter
 * error) -- callers should treat null exactly like "no persisted
 * history exists" and fall back to starting a fresh one, the same
 * graceful-degradation convention getPendingChange already uses.
 * Timestamps round-trip through JSON as strings, not Date objects --
 * restored here so the returned shape exactly matches what
 * createHistory/pushSnapshot themselves produce.
 */
async function loadPersistedHistory(adapter, documentId) {
  try {
    const result = await adapter.get(historyKey(documentId));
    if (!result) return null;
    const raw = unwrapAdapterValue(result);
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || !Array.isArray(parsed.entries) || parsed.entries.length === 0) return null;
    if (typeof parsed.index !== 'number' || parsed.index < 0 || parsed.index >= parsed.entries.length) return null;
    const entries = parsed.entries.map((e) => ({ ...e, timestamp: new Date(e.timestamp) }));
    return { entries, index: parsed.index };
  } catch {
    return null;
  }
}

/** Clears the persisted history for `documentId` -- called when a
 *  freshly opened document's text doesn't match what the persisted
 *  history's own latest entry says it should be (edited elsewhere
 *  since last saved here, most likely), so a stale, no-longer-
 *  applicable history doesn't linger forever unused. */
async function clearPersistedHistory(adapter, documentId) {
  await adapter.delete(historyKey(documentId));
}

export { savePersistedHistory, loadPersistedHistory, clearPersistedHistory, HISTORY_STORE_LIMIT };
