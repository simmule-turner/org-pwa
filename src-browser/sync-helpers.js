// Extracted from app.js: sync helpers. These have no dependency on the app's shared mutable state,
// so they moved verbatim (see tools/ notes in CHANGELOG v412).
import { UNSAVED_DOCUMENT_ID } from '../src/agenda.js';
import { clearPendingChange, getPendingChange } from '../src/outbox.js';
import { pushRecentRefileTarget } from '../src/refile.js';
import { setSyncMeta } from '../src/sync-engine.js';
import { HELP_DOCUMENT_ID, PALETTE_RECENT_KEY, REFILE_RECENT_KEY } from './constants.js';
import { kv } from './singletons.js';

export function recordSyncedWrite(fileId, hash, content) {
  // `content` is kept as the new common ancestor for a later three-way
  // merge (see merge3.js); omitted only by callers that don't have it.
  return setSyncMeta(kv, fileId, typeof content === 'string' ? { lastSyncedHash: hash, baseContent: content } : { lastSyncedHash: hash });
}

/** The remembered refile destinations, newest first ([] if none or unreadable). */
export async function loadRefileRecent() {
  try {
    const result = await kv.get(REFILE_RECENT_KEY);
    const raw = result && typeof result === 'object' && 'value' in result ? result.value : result;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed)
      ? parsed.filter((r) => r && typeof r.documentId === 'string' && Array.isArray(r.outlinePath))
      : [];
  } catch {
    return [];
  }
}

/** Remembers a successful refile's destination for the picker's Recent list. */
export async function rememberRefileTarget(documentId, outlinePath) {
  try {
    const recent = pushRecentRefileTarget(await loadRefileRecent(), { documentId, outlinePath });
    await kv.set(REFILE_RECENT_KEY, JSON.stringify(recent));
  } catch {
    // a failure to remember must never get in the way of the refile itself
  }
}

/** Renders the Emacs-style modeline -- buffer state, name, position,
 *  date/time, and clocking info -- into #modeline. Called from
 *  render() itself, always kept in sync, never a separate call site
 *  that could drift; also on a 30s timer (see its own call site) so
 *  the clock/time segments stay live even with no other state
 *  changes happening. */
/** The display label for a document, whether saved or not -- shared by
 *  the modeline and tab bar so they always agree on what to call the
 *  same document. A saved document's own docId (its filename) is
 *  already a sensible label. An unsaved one has no filename at all;
 *  its own internal ID is a randomly-suffixed sentinel never meant to
 *  be user-visible, so it falls back to the first heading's own title
 *  once one exists, and finally to '*scratch*' -- matching real
 *  Emacs's own convention for a fresh, as-yet-unnamed buffer. */
export function documentDisplayLabel(docId, doc) {
  if (docId === HELP_DOCUMENT_ID) return 'Help';
  const isUnsaved = !docId || docId.startsWith(UNSAVED_DOCUMENT_ID);
  if (!isUnsaved) return docId;
  const firstHeadingTitle = doc && doc.children && doc.children[0] ? doc.children[0].title : null;
  return firstHeadingTitle || '*scratch*';
}

export async function loadPaletteRecent() {
  try {
    const result = await kv.get(PALETTE_RECENT_KEY);
    const raw = result && typeof result === 'object' && 'value' in result ? result.value : result;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function storageKindLabel(kind) {
  if (kind === 'github') return 'GitHub';
  if (kind === 'webdav') return 'WebDAV';
  if (kind === 'input') return 'Imported';
  if (kind === 'help') return 'Help';
  return 'Local';
}

/**
 * Checks for a pending, unsynced local edit before opening `documentId`
 * fresh from disk/GitHub/WebDAV/import. Returns `{ preferCache: boolean }`.
 *
 * Both choices actually open the file — that's the fix. A previous
 * version's "Cancel" choice here just aborted with a status message
 * ("unsaved local changes were kept") and no way back to them: the edit
 * sat untouched in IndexedDB, but there was no UI path to ever see it
 * again. "Kept" should mean "shown", not "kept invisible somewhere".
 */
export async function resolvePendingChangeChoice(documentId) {
  const pending = await getPendingChange(kv, documentId);
  if (!pending) return { preferCache: false };
  const when = formatPendingChangeTimestamp(pending.queuedAt);
  const resumeLocal = window.confirm(
    `"${documentId}" has local changes from ${when} that were never saved.\n\n` +
      'OK = resume those unsaved changes\n' +
      'Cancel = discard them and load the current version'
  );
  if (!resumeLocal) await clearPendingChange(kv, documentId);
  return { preferCache: resumeLocal };
}

/** A short, readable rendering of an outbox entry's queuedAt timestamp
 *  for the discard/resume prompt -- "from an earlier session" was too
 *  vague to judge whether a pending edit was worth resuming or safely
 *  ignorable; showing exactly when it happened lets the person decide
 *  for themselves. Falls back to the generic wording if the timestamp
 *  is missing or unparseable, rather than showing "Invalid Date". */
export function formatPendingChangeTimestamp(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return 'an earlier session';
  return d.toLocaleString();
}

// New (on filesystem) and Save As all keep "mine" on conflict — there's
// no ambiguity to negotiate here the way there is for a background Save:
// the user just explicitly chose this destination (via the native save
// picker) and explicitly wants their current content written there.
// syncDocument's conflict detection treats "no prior sync history for
// this documentId" the same as "disk changed since we last knew about
// it" — which is true of every single New/Save As to any path, since
// showSaveFilePicker creates the file (even if empty) the moment the
// picker resolves, before this code ever calls write(). Without this
// callback, every New or Save As throws instead of saving; this is the
// fix for that, and it always resolves in favor of the content actually
// on screen, which is what both actions mean.
export const ALWAYS_KEEP_MINE = async () => 'mine';
