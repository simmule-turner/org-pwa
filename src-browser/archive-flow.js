// Extracted from app.js: archive flow.
import { buildArchivedClone, buildRestoredClone, getArchiveLocation, getProperty, insertAtArchiveLocation, parseArchiveLocation, resolveArchiveFileId } from '../src/archive-model.js';
import { resolveOlpTarget } from '../src/capture-template.js';
import { removeHeading } from '../src/heading-edit.js';
import { S } from './app-state.js';
import { openButtonChoiceModal } from './dialogs.js';
import { commitAndRender, setStatus } from './editing.js';
import { writeToOtherFile } from './external-sync.js';
import { openRefilePicker } from './refile-flow.js';

export function getArchiveDestinationLabel(heading) {
  const location = getArchiveLocation(S.state.doc, heading);
  const { filePart, headlinePart } = parseArchiveLocation(location);
  const targetFileId = resolveArchiveFileId(filePart, S.state.documentId);
  return targetFileId === null || targetFileId === S.state.documentId
    ? headlinePart.trim()
      ? `this file, under "${headlinePart.trim().replace(/^\*+\s*/, '')}"`
      : 'this file (top level)'
    : headlinePart.trim()
      ? `"${targetFileId}", under "${headlinePart.trim().replace(/^\*+\s*/, '')}"`
      : `"${targetFileId}" (top level)`;
}

/** The action menu's own entry point for Archive on a non-archived
 *  heading -- always shows the Refile/Cancel/OK prompt (unconditional
 *  now that org-archive-confirm has been removed), offering Refile as
 *  a genuine alternative right there rather than a plain OK/Cancel,
 *  since often the actual intent behind reaching for Archive is "get
 *  this out of my active outline," which Refile serves just as well
 *  for a destination that isn't the archive file specifically. */
export function openArchiveConfirmPrompt(heading) {
  openButtonChoiceModal({
    label: `Archive "${heading.title || '(untitled)'}" to ${getArchiveDestinationLabel(heading)}?`,
    buttons: [
      { text: 'Refile\u2026', onClick: () => openRefilePicker(heading) },
      { text: 'Cancel', onClick: () => {} },
      { text: 'OK', onClick: () => archiveHeadingToLocation(heading) },
    ],
  });
}

export async function archiveHeadingToLocation(heading) {
  const location = getArchiveLocation(S.state.doc, heading);
  const { filePart, headlinePart } = parseArchiveLocation(location);
  const targetFileId = resolveArchiveFileId(filePart, S.state.documentId);

  if (targetFileId === null || targetFileId === S.state.documentId) {
    // Same file: build the stamped copy, remove the original, insert
    // the copy at the target location, save -- one atomic in-memory
    // edit, no cross-file I/O risk to worry about.
    const clone = buildArchivedClone(S.state.doc, heading, S.state.documentId);
    removeHeading(S.state.doc, heading);
    insertAtArchiveLocation(S.state.doc, clone, headlinePart);
    commitAndRender('Archived heading');
    setStatus('--- Archive complete.');
    return;
  }

  setStatus(`Archiving to ${targetFileId}\u2026`);
  const clone = buildArchivedClone(S.state.doc, heading, S.state.documentId);
  const { ok } = await writeToOtherFile(targetFileId, {
    label: 'archive',
    allowMissing: true,
    mutate: (doc) => {
      insertAtArchiveLocation(doc, clone, headlinePart);
      return true;
    },
  });
  if (!ok) return;

  // The write succeeded -- now, and only now, remove the original.
  removeHeading(S.state.doc, heading);
  commitAndRender('Archived heading');
  setStatus(`--- Archive complete. (${targetFileId})`);
}

/**
 * Performs a full restore/unarchive: reads the archived heading's own
 * `ARCHIVE_FILE`/`ARCHIVE_OLPATH` properties to determine where it
 * originally came from, moves it back there, and strips the `:ARCHIVE:`
 * tag and all four `ARCHIVE_*` properties (via buildRestoredClone).
 *
 * Same write-before-remove transaction safety as archiveHeadingToLocation:
 * the destination is written FIRST (when it's a different file than the
 * one currently open), and the archived heading is only removed from
 * THIS file once that write has actually succeeded -- a network
 * failure or permission problem leaves the archived heading exactly
 * where it was, with a clear error, never silently lost.
 *
 * A heading with no recorded `ARCHIVE_FILE` (tagged `:ARCHIVE:` by
 * hand, or via the tag-toggle mechanism from an earlier version of
 * this app, rather than through org-archive-subtree) has nowhere
 * on record to be restored TO -- the honest behavior is to just strip
 * the tag/properties in place, at the top level of the file it's
 * already in, rather than guessing.
 */
export async function unarchiveHeadingToOriginalLocation(heading) {
  const archiveFile = getProperty(heading, 'ARCHIVE_FILE') || null;
  const archiveOlpath = getProperty(heading, 'ARCHIVE_OLPATH') || '';
  const olpSegments = archiveOlpath ? archiveOlpath.split('/') : [];

  const destinationLabel = !archiveFile
    ? 'this file (no original location recorded \u2014 the archive tag will just be removed)'
    : archiveFile === S.state.documentId
      ? olpSegments.length > 0
        ? `this file, under "${olpSegments.join(' / ')}"`
        : 'this file (top level)'
      : olpSegments.length > 0
        ? `"${archiveFile}", under "${olpSegments.join(' / ')}"`
        : `"${archiveFile}" (top level)`;
  if (!window.confirm(`Restore "${heading.title}" to ${destinationLabel}?`)) {
    return;
  }

  if (!archiveFile || archiveFile === S.state.documentId) {
    // No recorded location, or the recorded location IS the currently
    // open file -- either way, this is a same-file, in-memory-only
    // operation with no cross-file I/O risk.
    const clone = buildRestoredClone(heading);
    removeHeading(S.state.doc, heading);
    if (olpSegments.length > 0) {
      const target = resolveOlpTarget(S.state.doc, olpSegments);
      target.children.push(clone);
      target.collapsed = false; // otherwise the just-restored item vanishes from view immediately
    } else {
      S.state.doc.children.push(clone);
    }
    commitAndRender('Restored (unarchived) heading');
    setStatus('--- Restore complete.');
    return;
  }

  setStatus(`Restoring to ${archiveFile}\u2026`);
  const clone = buildRestoredClone(heading);
  const { ok } = await writeToOtherFile(archiveFile, {
    label: 'restore',
    allowMissing: false,
    mutate: (doc) => {
      if (olpSegments.length > 0) {
        const target = resolveOlpTarget(doc, olpSegments);
        target.children.push(clone);
        target.collapsed = false;
      } else {
        doc.children.push(clone);
      }
      return true;
    },
  });
  if (!ok) return;

  // The write succeeded -- now, and only now, remove the archived
  // heading from THIS (the currently open, archive) file.
  removeHeading(S.state.doc, heading);
  commitAndRender('Restored (unarchived) heading');
  setStatus(`--- Restore complete. (${archiveFile})`);
}
