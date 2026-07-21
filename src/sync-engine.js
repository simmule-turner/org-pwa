
/**
 * Sync engine: reconciles the local outbox (instant, offline-safe writes
 * already applied to the kv store) against a disk-like target, per the
 * storage requirements decision: conflict resolution is kept simple for
 * v1 — hash comparison, then a straightforward keep-mine/keep-disk choice.
 * No diff/merge UI here; that's an explicit v2 candidate, not something
 * this module pretends to do.
 *
 * `diskAdapter` is an abstraction over "the durable, external copy of the
 * file" — concretely, the File System Access API in-browser. Shape:
 *   { read(fileId) -> { content, hash } | null,
 *     write(fileId, content) -> { hash },
 *     exists(fileId) -> boolean }
 * A File System Access API wrapper just needs to implement these three
 * methods; nothing else in this module cares how "disk" is actually
 * reached, which is what makes it testable without a browser.
 *
 * Sync metadata (the hash disk had at last successful sync) lives in the
 * kv store alongside the outbox, keyed per document, so conflict detection
 * survives app restarts.
 */

import { getPendingChange, clearPendingChange } from './outbox.js';

function syncMetaKey(documentId) {
  return 'syncmeta:' + documentId;
}

async function getSyncMeta(kvAdapter, documentId) {
  try {
    const result = await kvAdapter.get(syncMetaKey(documentId));
    if (!result) return null;
    const raw = result && typeof result === 'object' && 'value' in result ? result.value : result;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

async function setSyncMeta(kvAdapter, documentId, meta) {
  await kvAdapter.set(syncMetaKey(documentId), JSON.stringify(meta));
}

/**
 * A minimal, dependency-free hash for conflict detection — this only needs
 * to detect "did the content change since we last synced", not resist
 * tampering, so a fast non-cryptographic hash is the right tool.
 */
function contentHash(content) {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const SYNC_RESULT = {
  UP_TO_DATE: 'up-to-date', // nothing pending, nothing to do
  SYNCED: 'synced', // pending change written to disk cleanly
  CONFLICT: 'conflict', // disk changed since last sync AND a local change is pending
};

/**
 * Attempts to sync `documentId`'s pending outbox entry to `diskAdapter`.
 *
 * Conflict definition: disk's current hash differs from the hash recorded
 * at last sync, AND there's a local pending change. (If disk changed but
 * there's no local pending change, that's not a conflict — nothing local
 * would be lost by picking up disk's version; callers can just re-read.)
 *
 * `resolveConflict(ctx)` — required only when a conflict is detected —
 * receives { mine: string, disk: string } and must return 'mine' or
 * 'disk'. Keeping this as an injected callback (rather than a hardcoded
 * policy) is what makes "keep mine / keep disk" an actual user choice in
 * the UI rather than a decision baked into this module.
 */
async function syncDocument({ documentId, kvAdapter, diskAdapter, resolveConflict }) {
  const pending = await getPendingChange(kvAdapter, documentId);
  const diskEntry = await diskAdapter.read(documentId);
  const meta = await getSyncMeta(kvAdapter, documentId);

  if (!pending) {
    return { status: SYNC_RESULT.UP_TO_DATE };
  }

  const diskChangedSinceSync =
    diskEntry !== null && (!meta || meta.lastSyncedHash !== diskEntry.hash);

  if (diskChangedSinceSync) {
    if (!resolveConflict) {
      throw new Error(
        `syncDocument: conflict on "${documentId}" but no resolveConflict callback was provided`
      );
    }
    const choice = await resolveConflict({ mine: pending.content, disk: diskEntry.content });
    if (choice === 'disk') {
      await clearPendingChange(kvAdapter, documentId);
      await setSyncMeta(kvAdapter, documentId, { lastSyncedHash: diskEntry.hash });
      return { status: SYNC_RESULT.CONFLICT, resolution: 'disk', content: diskEntry.content };
    }
    // choice === 'mine': fall through and overwrite disk with the local version.
  }

  const written = await diskAdapter.write(documentId, pending.content);
  await clearPendingChange(kvAdapter, documentId);
  await setSyncMeta(kvAdapter, documentId, { lastSyncedHash: written.hash });

  return {
    status: diskChangedSinceSync ? SYNC_RESULT.CONFLICT : SYNC_RESULT.SYNCED,
    resolution: diskChangedSinceSync ? 'mine' : undefined,
    content: pending.content,
  };
}

// ---- test/dev disk adapter ---------------------------------------------

/** In-memory stand-in for a File System Access API target. Tests can call
 *  `._simulateExternalEdit(fileId, content)` to mimic the file changing on
 *  disk outside the app (e.g. edited directly in Emacs), which is exactly
 *  the scenario conflict detection exists to catch. */
function createInMemoryDiskAdapter() {
  const files = new Map();
  return {
    async read(fileId) {
      return files.has(fileId) ? { ...files.get(fileId) } : null;
    },
    async write(fileId, content) {
      const hash = contentHash(content);
      files.set(fileId, { content, hash });
      return { hash };
    },
    async exists(fileId) {
      return files.has(fileId);
    },
    _simulateExternalEdit(fileId, content) {
      files.set(fileId, { content, hash: contentHash(content) });
    },
  };
}

export {
  SYNC_RESULT,
  contentHash,
  syncDocument,
  getSyncMeta,
  setSyncMeta,
  createInMemoryDiskAdapter,
};
