/**
 * Attachments -- this app's own extension, inspired by real org-mode's
 * own org-attach (there's no exact equivalent to match against
 * character-for-character the way other features in this app do,
 * since org-attach's own folder-splitting convention isn't
 * independently verified here beyond the well-known general shape:
 * a heading's own :ID: property, split into a short directory prefix
 * plus the rest, so attachments for many different headings don't all
 * pile into one enormous, hard-to-browse folder).
 *
 * Storage itself only works on GitHub/WebDAV -- the same "arbitrary
 * file write needs a backend that can do that without a fresh picker
 * gesture per file" reasoning this app's own Agenda Files and
 * cross-file archive/refile already established; a local
 * (File System Access) or iOS-import file has no equivalent
 * capability. That gating lives in app.js, alongside the actual
 * network I/O -- this module is pure path/link-text computation only.
 */

/** A fresh, random attachment ID -- a standard UUID v4, the same
 *  identifier space real org's own org-id-new defaults to. Uses the
 *  Web Crypto API's own crypto.randomUUID(), available in every
 *  browser this PWA already targets -- no separate UUID library
 *  needed for something the platform already provides natively. */
function generateAttachmentId() {
  return crypto.randomUUID();
}

/** Splits `id` into { prefix, rest } -- the first 2 characters as a
 *  short directory prefix, everything else as the subdirectory under
 *  it, inspired by real org-attach's own id-to-path convention:
 *  spreading attachments across many small directories (one level
 *  keyed by just the ID's own first couple of characters) rather than
 *  one single directory accumulating every attachment from every
 *  heading in the file. Throws for an `id` shorter than 3 characters
 *  -- not a realistic input in practice (a real UUID is 36 characters
 *  long), but guards against a caller passing something degenerate
 *  rather than silently producing a nonsensical empty `rest`. */
function splitAttachmentId(id) {
  const trimmed = String(id || '').trim();
  if (trimmed.length < 3) throw new Error('splitAttachmentId: id must be at least 3 characters');
  return { prefix: trimmed.slice(0, 2), rest: trimmed.slice(2) };
}

/** The full storage path for an attachment: `data/<prefix>/<rest>/
 *  <filename>`, relative to wherever the org file containing the
 *  heading itself lives (app.js resolves that base directory before
 *  handing this path to the storage adapter -- this function only
 *  computes the ID-derived portion, the same "pure path computation,
 *  no I/O" scope as splitAttachmentId above). `filename` is used
 *  as-is (already expected to be sanitized by the caller, matching
 *  how export's own baseName sanitization already works elsewhere in
 *  this app) -- not re-validated here. */
function attachmentPath(id, filename) {
  const { prefix, rest } = splitAttachmentId(id);
  return `data/${prefix}/${rest}/${filename}`;
}

/** A real org file: link referencing an attachment -- `filename`
 *  itself as the link's own description, so what shows in the
 *  outline is the human-readable name, not the full data/xx/yyy/...
 *  path. `relativePath` is whatever app.js has already resolved this
 *  attachment's path to be relative to the CURRENT document (which
 *  may differ from the org-attach-relative path above, if the heading
 *  being attached to lives in a different file than the one currently
 *  open -- refile/capture both already have this same "resolve
 *  relative to wherever this actually ends up" concern). */
function formatAttachmentLink(relativePath, filename) {
  return `[[file:${relativePath}][${filename}]]`;
}

/** A reasonably safe filename for a newly attached file -- strips
 *  path separators and other characters that would be meaningful (or
 *  simply illegal) in a storage path, the same defensive stance
 *  export's own baseName sanitization already takes for a downloaded
 *  file's own name. Falls back to "attachment" if nothing usable is
 *  left after stripping (an empty or entirely-symbolic original
 *  name), rather than producing an empty path segment. */
function sanitizeAttachmentFilename(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  return cleaned || 'attachment';
}

export { generateAttachmentId, splitAttachmentId, attachmentPath, formatAttachmentLink, sanitizeAttachmentFilename };
