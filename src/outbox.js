
/**
 * Outbox: a per-document queue of pending writes, so edits apply instantly
 * and offline-safe (write to the local kv store) without waiting on a sync
 * to disk. This is the same shape as the outbox NRP already uses for
 * offline state changes replayed on reconnect — deliberately reused rather
 * than reinvented.
 *
 * The outbox stores full-document snapshots, not diffs. That's a real
 * tradeoff: simpler and safer (no operational-transform machinery, no risk
 * of a corrupt diff chain), but the outbox never holds more than "the most
 * recent unsynced version" per document — enqueueing again replaces the
 * previous pending entry rather than appending to a list. If per-edit
 * history/undo is wanted later, that's a different data structure built on
 * top of this one, not a change to this one.
 *
 * Adapter shape matches fold-state.js and the artifact platform's
 * window.storage: { get(key), set(key, value), delete(key) }.
 */

function outboxKey(documentId) {
  return 'outbox:' + documentId;
}

/**
 * Replaces the pending write for `documentId` with `content` (the
 * serialized .org text) and a timestamp. Called on every local edit.
 */
async function enqueueChange(adapter, documentId, content, opts = {}) {
  const entry = {
    content,
    queuedAt: opts.now ? opts.now.toISOString() : new Date().toISOString(),
  };
  await adapter.set(outboxKey(documentId), JSON.stringify(entry));
  return entry;
}

/** Returns the pending write for `documentId`, or null if the outbox is
 *  empty (nothing unsynced) for that document. */
async function getPendingChange(adapter, documentId) {
  try {
    const result = await adapter.get(outboxKey(documentId));
    if (!result) return null;
    const raw = result && typeof result === 'object' && 'value' in result ? result.value : result;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed.content !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Clears the pending write for `documentId` — called once it's been
 *  successfully flushed to disk. */
async function clearPendingChange(adapter, documentId) {
  await adapter.delete(outboxKey(documentId));
}

async function hasPendingChange(adapter, documentId) {
  return (await getPendingChange(adapter, documentId)) !== null;
}

export {
  enqueueChange,
  getPendingChange,
  clearPendingChange,
  hasPendingChange,
};
