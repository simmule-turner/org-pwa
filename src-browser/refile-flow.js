// @ts-check
// Extracted from app.js: refile flow.
import { shiftLevels } from '../src/archive-model.js';
import { removeHeading } from '../src/heading-edit.js';
import { parseOrg } from '../src/org-parser.js';
import { findHeadingByOutlinePath, resolveEntryFileIds } from '../src/refile.js';
import { aggregateAgendaDocs } from './agenda-files.js';
import { S } from './app-state.js';
import { commitAndRender, setStatus } from './editing.js';
import { activeDiskAdapter, writeToOtherFile } from './external-sync.js';
import { rememberRefileTarget } from './sync-helpers.js';

/**
 * Performs a full org-archive-subtree move (real org's `C-c C-x C-s` /
 * `C-c $`): computes the effective org-archive-location for `heading`
 * (its own `ARCHIVE` property, then the file's `#+ARCHIVE:` keyword,
 * then the documented default `"%s_archive::"`), and moves the subtree
 * there -- either within the current document (an empty file part) or
 * to a separate file, read/parsed/inserted/written via whichever
 * storage backend the current document itself already came from
 * (reused directly; there's no separate "where does the archive file
 * live" configuration to set up).
 *
 * Write-before-remove for the cross-file case: buildArchivedClone is
 * deliberately non-mutating (see archive-model.js), so the target
 * file's write is attempted FIRST, and the heading is only removed
 * from the current document once that write has actually succeeded --
 * a network failure, a WebDAV conflict, or a local-file permission
 * problem can then never silently lose the heading; it simply stays
 * exactly where it was, with a clear error shown instead.
 *
 * A local (File System Access) or iOS-import backend can't write to a
 * file it doesn't already have a granted handle for -- the browser's
 * own security model requires an explicit user gesture (a file picker)
 * per file, which can't be done silently mid-archive. Rather than
 * failing with a confusing low-level permission error, this is
 * detected up front and reported as an actionable message.
 */
/** Loads every document a resolved refile-targets spec could need,
 *  beyond what aggregateAgendaDocs() already covers (the current file
 *  and every configured Agenda File) -- an explicitly-named target
 *  file spec that isn't already one of those gets read fresh via the
 *  active disk adapter. A file that fails to load is silently omitted
 *  (getRefileCandidates already treats a missing docsById entry as
 *  "no candidates from this entry", not an error) rather than blocking
 * @param {any} [targetsSpec]
 *  the whole picker on one bad/inaccessible target. */
export async function loadRefileTargetDocs(targetsSpec) {
  const docsById = {};
  for (const { documentId, doc } of aggregateAgendaDocs({ writable: true })) { // a local agenda file is read-only, so never a destination
    /** @type {any} */ (docsById)[documentId] = doc;
  }
  const adapter = activeDiskAdapter();
  for (const entry of targetsSpec) {
    if (entry.fileSpec === 'current' || entry.fileSpec === 'agenda-files') continue;
    for (const documentId of resolveEntryFileIds(entry, S.state.documentId, S.agendaFilesConfig)) {
      if (/** @type {any} */ (docsById)[documentId]) continue;
      try {
        const existing = await adapter.read(documentId);
        if (existing) /** @type {any} */ (docsById)[documentId] = parseOrg(existing.content);
      } catch {
        // Omitted, not an error -- see doc comment above.
      }
    }
  }
  return docsById;
}

/**
 * Moves `heading` (and its whole subtree) to become the LAST child of
 * the target identified by `targetDocumentId` + `targetOutlinePath` --
 * real org's own default refile insertion point. Same-file is a
 * simple splice-out/push-in plus a level-shift, mirroring
 * demoteHeading's own already-established pattern exactly. Cross-file
 * re-resolves the target against a FRESH read of that file (never the
 * possibly-stale docsById snapshot the picker itself was built from)
 * and uses the same write-target-before-remove-from-source transaction
 * safety archiveHeadingToLocation already established -- a failed
 * write to the target file leaves the source completely untouched.
 * @param {any} [heading]
 * @param {any} [targetDocumentId]
 * @param {any} [targetOutlinePath]
 */
export async function performRefile(heading, targetDocumentId, targetOutlinePath) {
  if (targetDocumentId === S.state.documentId) {
    const target = findHeadingByOutlinePath(S.state.doc, targetOutlinePath);
    if (!target) {
      setStatus('Could not refile: that target heading no longer exists (the outline may have changed).');
      return;
    }
    removeHeading(S.state.doc, heading);
    target.children.push(heading);
    target.collapsed = false;
    shiftLevels(heading, target.level + 1);
    commitAndRender('Refiled heading');
    setStatus(`Refiled to "${target.title}".`);
    rememberRefileTarget(targetDocumentId, targetOutlinePath);
    return;
  }

  setStatus(`Refiling to ${targetDocumentId}\u2026`);
  const { ok, result: targetTitle } = await writeToOtherFile(targetDocumentId, {
    label: 'refile',
    allowMissing: false,
    mutate: (/** @type {any} */ doc) => {
      const target = findHeadingByOutlinePath(doc, targetOutlinePath);
      if (!target) {
        setStatus(
          `Could not refile: that target heading no longer exists in "${targetDocumentId}" (it may have changed since this picker opened).`
        );
        return null;
      }
      target.children.push(heading);
      target.collapsed = false;
      shiftLevels(heading, target.level + 1);
      return target.title;
    },
  });
  if (!ok) return;

  // The write succeeded -- now, and only now, remove the original.
  removeHeading(S.state.doc, heading);
  commitAndRender('Refiled heading');
  setStatus(`Refiled to "${targetTitle}" in "${targetDocumentId}".`);
  rememberRefileTarget(targetDocumentId, targetOutlinePath);
}
