
/**
 * Document store: the multi-file layer the requirements decided on — the
 * app manages a set of open files, not just one, which is what makes
 * archive files (a second file per document) and a cross-file agenda view
 * actually work. This module is the seam between the parser (org text <->
 * AST) and the storage/sync primitives (kv-adapter, outbox, sync-engine);
 * it doesn't know about UI at all.
 *
 * A "document" here is identified by `documentId` — in practice a file
 * path or handle name, but this module treats it as an opaque string key,
 * which keeps it agnostic about whether the id comes from a real
 * filesystem path (File System Access API) or something else.
 */

import { parseOrg, serializeOrg } from './org-parser.js';
import { enqueueChange } from './outbox.js';
import { syncDocument } from './sync-engine.js';

function unwrap(result) {
  return result && typeof result === 'object' && 'value' in result ? result.value : result;
}

/**
 * Opens `documentId`: reads from disk first, parses into an AST, and
 * refreshes the kv cache to match. Falls back to the cache only if disk
 * read doesn't succeed (no registered file handle yet, or some other
 * read failure) — not the other way around.
 *
 * This used to be cache-first, with disk as the fallback, on the
 * reasoning that disk "might be unreachable when offline". That reasoning
 * doesn't actually apply here: File System Access reads are local file
 * reads, not network requests — they're never blocked by connectivity.
 * Cache-first meant that once a file was opened once, every later "Open"
 * of the same file silently returned the stale cached copy forever, even
 * after editing the file outside the app — the cache was never given a
 * chance to hear about the change. Disk-first fixes that: "Open" now
 * means what it says.
 *
 * This does NOT check for locally pending, unsynced edits before
 * overwriting the cache with fresh disk content — that's a real
 * data-loss risk (edits made, never saved, then the file reopened) and
 * is deliberately handled by the caller (see app.js's use of
 * outbox.js's hasPendingChange before calling this), not silently
 * decided in here.
 */
async function openDocument({ documentId, kvAdapter, diskAdapter }) {
  const cacheKey = 'doc:' + documentId;

  const diskEntry = await diskAdapter.read(documentId);
  if (diskEntry) {
    await kvAdapter.set(cacheKey, diskEntry.content);
    return { documentId, doc: parseOrg(diskEntry.content), source: 'disk' };
  }

  const cached = await kvAdapter.get(cacheKey);
  if (cached) {
    return { documentId, doc: parseOrg(unwrap(cached)), source: 'cache' };
  }

  // Brand new, unsaved document.
  return { documentId, doc: parseOrg(''), source: 'new' };
}

/**
 * Saves `doc` for `documentId`: serializes it, writes to the kv cache
 * immediately (instant, offline-safe — this is the "edits apply to
 * IndexedDB immediately" half of the storage requirement), and enqueues
 * the same content in the outbox for a later sync to disk. Does not sync
 * to disk itself — that's a separate, explicit step (see saveAndSync).
 */
async function saveDocument({ documentId, doc, kvAdapter }) {
  const content = serializeOrg(doc);
  await kvAdapter.set('doc:' + documentId, content);
  await enqueueChange(kvAdapter, documentId, content);
  return content;
}

/**
 * Convenience wrapper: save, then immediately attempt to sync to disk.
 * Most UI actions probably want this; a purely offline edit session would
 * call saveDocument repeatedly and defer sync until connectivity/user
 * action, which is why the two are kept separate rather than fused.
 */
async function saveAndSync({ documentId, doc, kvAdapter, diskAdapter, resolveConflict }) {
  await saveDocument({ documentId, doc, kvAdapter });
  return syncDocument({ documentId, kvAdapter, diskAdapter, resolveConflict });
}

/** Registry of which documentIds are considered "open" in the app, so the
 *  agenda view and multi-file UI have something to iterate over. Kept as
 *  its own tiny piece of state rather than inferred from kv contents,
 *  since "cached" and "open" aren't the same thing (a file can be cached
 *  from a previous session without being open right now). */
function openKey() {
  return 'open-documents';
}

async function listOpenDocuments(kvAdapter) {
  const result = await kvAdapter.get(openKey());
  if (!result) return [];
  const raw = unwrap(result);
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? parsed : [];
}

async function markDocumentOpen(kvAdapter, documentId) {
  const current = await listOpenDocuments(kvAdapter);
  if (!current.includes(documentId)) {
    current.push(documentId);
    await kvAdapter.set(openKey(), JSON.stringify(current));
  }
  return current;
}

async function markDocumentClosed(kvAdapter, documentId) {
  const current = await listOpenDocuments(kvAdapter);
  const next = current.filter((id) => id !== documentId);
  await kvAdapter.set(openKey(), JSON.stringify(next));
  return next;
}

/** Opens every currently-registered document, e.g. on app launch or to
 *  build the agenda view (§10) across the open file set. */
async function openAllDocuments({ kvAdapter, diskAdapter }) {
  const ids = await listOpenDocuments(kvAdapter);
  const results = [];
  for (const documentId of ids) {
    results.push(await openDocument({ documentId, kvAdapter, diskAdapter }));
  }
  return results;
}

export {
  openDocument,
  saveDocument,
  saveAndSync,
  listOpenDocuments,
  markDocumentOpen,
  markDocumentClosed,
  openAllDocuments,
};
