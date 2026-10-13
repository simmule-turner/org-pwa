// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
// The words the Archive & Refile panel shows: what archiving will stamp, what restoring will undo, where a refile will land,
// and the search over refile targets. Pure functions: src-browser/archive-refile-panel.js draws them.
import { getProperty } from './archive-model.js';

/** @typedef {{ label: string, value: string, warn?: boolean }} DetailRow */
/** @typedef {{ documentId: string, heading: any, outlinePath: string[] }} RefileCandidate */

/** A file id as a person reads it: no hidden prefix character, and "this new document" for one that was never saved.
 * @param {string} documentId */
export function displayName(documentId) {
  const id = documentId.replace(/^\u0000/, '');
  return /^unsaved-new-document:/.test(id) ? 'this new document' : id;
}

/** How many headings a subtree holds, the heading itself included.
 * @param {Heading} heading */
export function subtreeSize(heading) {
  let n = 1;
  for (const child of heading.children || []) n += subtreeSize(child);
  return n;
}

/** "1 heading" / "3 headings (2 under it)".
 * @param {Heading} heading */
export function describeSubtree(heading) {
  const n = subtreeSize(heading);
  return n === 1 ? '1 heading' : `${n} headings (${n - 1} under it)`;
}

/** The targets that match every word typed, in the path or the file name, any case. An empty query keeps them all.
 * @param {RefileCandidate[]} candidates @param {string} query */
export function filterTargets(candidates, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return candidates;
  return candidates.filter((c) => {
    const hay = `${c.outlinePath.join(' / ')} ${c.documentId}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** What archiving adds to the heading, as the panel lists it.
 * @param {Heading} heading */
export function archiveStamps(heading) {
  const names = ['ARCHIVE_TIME', 'ARCHIVE_FILE', 'ARCHIVE_OLPATH', 'ARCHIVE_CATEGORY'];
  if (heading.todo) names.push('ARCHIVE_TODO');
  return names;
}

/** Where a restore sends an archived heading, from its own ARCHIVE_FILE and ARCHIVE_OLPATH.
 * @param {Heading} heading @param {string} currentDocumentId
 * @returns {{ label: string, recorded: boolean }} */
export function restoreDestination(heading, currentDocumentId) {
  const archiveFile = getProperty(heading, 'ARCHIVE_FILE') || null;
  const archiveOlpath = getProperty(heading, 'ARCHIVE_OLPATH') || '';
  const segments = archiveOlpath ? archiveOlpath.split('/') : [];
  if (!archiveFile) return { recorded: false, label: 'this file (no original location recorded — the archive tag will just be removed)' };
  const under = segments.length > 0 ? `, under "${segments.join(' / ')}"` : '';
  if (archiveFile === currentDocumentId) return { recorded: true, label: segments.length > 0 ? `this file${under}` : 'this file (top level)' };
  return { recorded: true, label: segments.length > 0 ? `"${archiveFile}"${under}` : `"${archiveFile}" (top level)` };
}

/** The rows under the refile list for the chosen target.
 * @param {Heading} heading @param {RefileCandidate} candidate @param {string} currentDocumentId
 * @returns {DetailRow[]} */
export function refileDetails(heading, candidate, currentDocumentId) {
  const sameFile = candidate.documentId === currentDocumentId;
  const newLevel = (candidate.heading.level || candidate.outlinePath.length) + 1;
  /** @type {DetailRow[]} */
  const rows = [
    { label: 'Goes to', value: `${sameFile ? 'this file' : displayName(candidate.documentId)}, under ${candidate.outlinePath.join(' / ')}, as its last child` },
    { label: 'Moves', value: describeSubtree(heading) },
    { label: 'Level', value: newLevel === heading.level ? `${newLevel} (unchanged)` : `${newLevel} (was ${heading.level})` },
    { label: 'Keeps', value: 'state, tags, timestamps and properties; nothing is stamped' },
  ];
  if (!sameFile) rows.push({ label: 'Other file', value: 'written first; this heading is removed only if that works', warn: true });
  return rows;
}
