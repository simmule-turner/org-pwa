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

import { IMAGE_EXT_RE } from './inline-markup.js';

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
function attachmentPath(id, filename, documentId) {
  const { prefix, rest } = splitAttachmentId(id);
  const lastSlash = documentId ? documentId.lastIndexOf('/') : -1;
  const dir = lastSlash === -1 ? '' : documentId.slice(0, lastSlash + 1);
  return `${dir}data/${prefix}/${rest}/${filename}`;
}

/** A real org attachment: link referencing an attached file -- real
 *  org-attach's own actual link type, resolved (at render time, via
 *  link-resolve.js's own resolveAttachmentTarget) relative to
 *  whichever heading's own :ID: actually owns the attachment
 *  directory, not embedded in the link text itself the way a file:
 *  link's own path is. Bare (no description) for an image filename --
 *  matching real org's own actual "no description = inline image"
 *  convention (see inline-markup.js's own IMAGE_EXT_RE, which this
 *  reuses directly rather than a separate, potentially-drifting
 *  duplicate) -- so it correctly renders inline; with the filename
 *  itself as the description for anything else, so a non-image
 *  attachment still shows a readable name as a regular, tappable
 *  link rather than its own raw target text. */
function formatAttachmentLink(filename) {
  if (IMAGE_EXT_RE.test(filename)) {
    return `[[attachment:${filename}]]`;
  }
  return `[[attachment:${filename}][${filename}]]`;
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

// Matches both attachment: link forms this app itself ever generates
// (see formatAttachmentLink above) -- bare (no description, for an
// image) and with a description (everything else) -- and, since a
// hand-written link is just as valid org syntax either way, matches
// either form regardless of which kind of file it actually points to.
const ATTACHMENT_LINK_RE = /\[\[attachment:([^\]]+?)\](?:\[[^\]]*\])?\]/gi;

/** Every attachment: link's own filename currently in `heading`'s
 *  own body text (`heading.bodyLines`, the raw source lines -- not
 *  the parsed AST, since this needs to work the same way whether or
 *  not the body has actually been (re)parsed yet), in first-
 *  appearance order, de-duplicated (the same file linked twice counts
 *  once) -- what the Open/Delete sub-actions both need to enumerate
 *  before either doing something directly (exactly one attachment) or
 *  prompting which one (more than one). Returns `[]` for a heading
 *  with no attachment: links in its own body at all -- not an error,
 *  just nothing to enumerate. */
function listAttachments(heading) {
  const seen = new Set();
  const filenames = [];
  for (const line of heading.bodyLines || []) {
    for (const match of line.matchAll(ATTACHMENT_LINK_RE)) {
      const filename = match[1];
      if (!seen.has(filename)) {
        seen.add(filename);
        filenames.push(filename);
      }
    }
  }
  return filenames;
}

/** Removes every attachment: link in `heading.bodyLines` whose own
 *  filename exactly matches `filename` -- the in-document half of
 *  deleting an attachment (the caller is separately responsible for
 *  actually removing the underlying file from storage; this module
 *  stays pure/no-I/O throughout, matching every other function here).
 *  A line that becomes entirely empty after removing its own link
 *  (the common case -- an attachment link is usually the only thing
 *  on its own line) is dropped from bodyLines entirely, rather than
 *  left behind as a blank line; a line with OTHER content alongside
 *  the link keeps that other content, with just the link itself
 *  excised. Mutates `heading.bodyLines` in place, matching how
 *  app.js's own attachFileToHeading already mutates it directly
 *  (re-deriving heading.body from it is the caller's own
 *  responsibility, same division as that function too). */
function removeAttachmentLink(heading, filename) {
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linkRe = new RegExp(`\\[\\[attachment:${escaped}\\](?:\\[[^\\]]*\\])?\\]`, 'i');
  heading.bodyLines = heading.bodyLines
    .map((line, i) => {
      if (!linkRe.test(line)) return line;
      return line.replace(linkRe, '').replace(/  +/g, ' ').trim();
    })
    .filter((line, i) => line !== '' || heading.bodyLines[i].trim() === '');
}

/** Confirmed as a real, necessary fix, not a theoretical one: a
 *  camera app very commonly hands back the exact same generic
 *  filename (e.g. "image.jpg") for every photo/video it captures --
 *  the default behavior of many camera apps on both iOS and Android,
 *  not a rare edge case. Since a heading's own attachment storage
 *  path is derived purely from its :ID: plus the filename, attaching
 *  a second capture with an identical name would silently overwrite
 *  the first one's actual file content at the same path (both links
 *  in the document would end up pointing at whatever was uploaded
 *  LAST), and any cached copy of the first image already held in
 *  memory would keep showing its own stale, pre-overwrite content
 *  while a fresh read of the same path shows the second capture's
 *  content instead -- exactly the confusing, inconsistent "one shows,
 *  another doesn't" symptom this was built to prevent.
 *
 * Given `filename` and `existingFilenames` (the heading's own
 * existing attachments -- see listAttachments), returns `filename`
 * unchanged if it doesn't collide with anything already there, or a
 * disambiguated version otherwise: "-1" inserted before the
 * extension, then "-2", and so on, until landing on a name that's
 * actually free ("image.jpg" -> "image-1.jpg" -> "image-2.jpg" ...).
 * A filename with no extension at all gets the suffix appended
 * directly, the same convention. Never returns `filename` itself
 * once a collision is found -- an attachment always gets ITS OWN,
 * genuinely unique storage path, so two different captures can never
 * silently overwrite each other again regardless of what the camera
 * app itself decided to call them. */
function disambiguateAttachmentFilename(filename, existingFilenames) {
  const existing = new Set(existingFilenames);
  if (!existing.has(filename)) return filename;

  const dotIndex = filename.lastIndexOf('.');
  const hasExtension = dotIndex > 0; // > 0, not >= 0 -- a leading "." (a dotfile-style name) isn't treated as an extension
  const base = hasExtension ? filename.slice(0, dotIndex) : filename;
  const ext = hasExtension ? filename.slice(dotIndex) : '';

  let n = 1;
  let candidate = `${base}-${n}${ext}`;
  while (existing.has(candidate)) {
    n++;
    candidate = `${base}-${n}${ext}`;
  }
  return candidate;
}

export {
  generateAttachmentId,
  splitAttachmentId,
  attachmentPath,
  formatAttachmentLink,
  sanitizeAttachmentFilename,
  listAttachments,
  removeAttachmentLink,
  disambiguateAttachmentFilename,
};
