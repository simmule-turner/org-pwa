
/**
 * Sync engine: reconciles the local outbox (instant, offline-safe writes
 * already applied to the kv store) against a disk-like target, per the
 * storage requirements decision: a hash comparison detects that disk
 * changed underneath a pending local edit, and an injected callback
 * decides what to do about it. This module stays policy-free: it hands
 * the callback the local text, the disk text, and the text as of the
 * last sync (the common ancestor a three-way merge needs -- see
 * merge3.js), and acts on whatever comes back.
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
 * Sync metadata (the hash disk had at last successful sync, and -- when
 * known -- that version's full text, `baseContent`) lives in the kv store
 * alongside the outbox, keyed per document, so conflict detection
 * survives app restarts. Metadata written before `baseContent` existed
 * simply has none; the callback is then told `base: null`.
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
 * receives { mine: string, disk: string, base: string | null } and
 * returns one of:
 *   'mine'            overwrite disk with the local version
 *   'disk'            discard the local edit, keep disk's version
 *   { merged: text }  write this merged text (see merge3.js) instead
 *   'cancel'          do nothing at all: nothing is written, and the
 *                     local edit stays pending for a later attempt
 * Keeping this as an injected callback (rather than a hardcoded policy)
 * is what makes the resolution an actual user choice in the UI rather
 * than a decision baked into this module.
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
    const base = meta && typeof meta.baseContent === 'string' ? meta.baseContent : null;
    const choice = await resolveConflict({ mine: pending.content, disk: diskEntry.content, base });
    if (choice === 'cancel') {
      return { status: SYNC_RESULT.CONFLICT, resolution: 'cancelled' };
    }
    if (choice === 'disk') {
      await clearPendingChange(kvAdapter, documentId);
      await setSyncMeta(kvAdapter, documentId, { lastSyncedHash: diskEntry.hash, baseContent: diskEntry.content });
      return { status: SYNC_RESULT.CONFLICT, resolution: 'disk', content: diskEntry.content };
    }
    if (choice && typeof choice === 'object' && typeof choice.merged === 'string') {
      const mergedWrite = await diskAdapter.write(documentId, choice.merged);
      await clearPendingChange(kvAdapter, documentId);
      await setSyncMeta(kvAdapter, documentId, { lastSyncedHash: mergedWrite.hash, baseContent: choice.merged });
      return { status: SYNC_RESULT.CONFLICT, resolution: 'merged', content: choice.merged };
    }
    // choice === 'mine': fall through and overwrite disk with the local version.
  }

  const written = await diskAdapter.write(documentId, pending.content);
  await clearPendingChange(kvAdapter, documentId);
  await setSyncMeta(kvAdapter, documentId, { lastSyncedHash: written.hash, baseContent: pending.content });

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
