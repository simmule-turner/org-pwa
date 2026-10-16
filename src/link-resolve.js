// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {{ type: 'external', url: string } | { type: 'heading', heading: Heading } | { type: 'id', id: string } | { type: 'attachment', target: string } | { type: 'file', scheme: string, path: string, inFileTarget: string | null, byId?: string } | { type: 'unresolved', target: string }} LinkResolution */
/**
 * Resolves what an org link target actually points to, given a document.
 * Pure and DOM-free — the UI layer decides what to *do* with a resolution
 * (navigate, open a new tab, show "can't open that yet"); this module only
 * classifies and looks up.
 *
 * Supported target forms, matching the org-mode conventions requested:
 *   - http(s)/mailto/ftp URLs            -> { type: 'external', url }
 *   - "doi:10.xxxx/..."                   -> { type: 'external', url }
 *     (rewritten to the standard doi.org resolver — a bare "doi:..." is
 *     not itself a fetchable/openable URL, unlike http(s))
 *   - "*Heading text"                    -> heading lookup by exact title
 *   - "#custom-id"                       -> heading lookup by :CUSTOM_ID:
 *   - "id:UUID"                          -> heading lookup by :ID: here; { type: 'id', id } when this
 *                                           document has none (the UI looks in other files)
 *   - "file:...", "./...", "../...",
 *     "~/...", "/...", "github:...",
 *     "webdav:..."                       -> { type: 'file', scheme, path }
 *   - anything else (bare text)          -> org does a fuzzy in-buffer
 *                                           search for this; approximated
 *                                           here as an exact heading-title
 *                                           match, falling back to
 *                                           unresolved if nothing matches
 *
 * Heading lookups are exact-match, case-sensitive, first-match-wins in
 * document order. Real org's search is closer to a fuzzy/regex text
 * search across the whole buffer (not just headline text) — this is a
 * deliberately simpler approximation, not a full reimplementation of
 * org's search semantics. Good enough for "link to a heading by its
 * title" and "link to a heading by a custom id", which is what was asked
 * for; a link that depends on org's fuzzier matching behavior may resolve
 * differently here.
 */

import { findAncestorPath, getProperty } from './archive-model.js';
import { ownAttachmentDirectory } from './attach.js';

const EXTERNAL_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const MAILTO_RE = /^mailto:/i;
const DOI_RE = /^doi:/i;
const FILE_LIKE_RE = /^(file:|github:|webdav:|local:|\.{1,2}\/|~\/|\/)/i;

/** @param {string} target */
export function isExternalUrl(target) {
  return EXTERNAL_URL_RE.test(target) || MAILTO_RE.test(target);
}

/** @param {string} target */
export function isDoi(target) {
  return DOI_RE.test(target);
}

/** A doi: target rewritten to the standard doi.org resolver URL —
 *  https://doi.org/10.1145/1327452.1327492 for "doi:10.1145/1327452.1327492"
 *  — the actual, fetchable/openable form a DOI needs to become to work
 *  as a real link, since "doi:..." on its own isn't a URL scheme any
 * @param {string} target
 *  browser knows how to open directly. */
export function doiToUrl(target) {
  return 'https://doi.org/' + target.replace(DOI_RE, '');
}

/** @param {string} target */
export function isFileLink(target) {
  return FILE_LIKE_RE.test(target);
}

/** Which explicit scheme a file-like target uses, or 'file' as the
 *  default for a path-only target with no scheme prefix at all (a
 *  bare "./notes.org", "~/notes.org", "/notes.org", or "file:..." are
 *  all treated as the same 'file' scheme — only "github:"/"webdav:"/"local:"
 *  are their own distinct schemes, since those specifically mean "a
 *  path within whichever GitHub repo / WebDAV server is configured" or
 *  "a file on this device (in the org-pwa folder, or opened earlier)",
 * @param {string} target
 *  not a path relative to the current document). */
export function fileLinkScheme(target) {
  if (/^github:/i.test(target)) return 'github';
  if (/^webdav:/i.test(target)) return 'webdav';
  if (/^local:/i.test(target)) return 'local';
  return 'file';
}

/**
 * Resolves an image link's target to an actual path within the current
 * backend, for reading via a storage adapter's readBinary(). Strips a
 * file:/github:/webdav: scheme prefix if present — all three
 * ultimately resolve against the SAME currently-configured backend,
 * since this app only has one GitHub repo / WebDAV server configured
 * at a time; an explicit scheme in the org source is about
 * disambiguating intent, not selecting a different actual backend. A
 * leading "./" is stripped (redundant with "same directory as the
 * current document," already the default for a bare filename). A path
 * starting with "/" is treated as root-relative within the backend. A
 * path already containing "/" (after the above stripping) is used
 * as-is; a bare filename is placed alongside the current document (a
 * sibling file) — the same convention resolveCaptureFileId and
 * archive-model.js's resolveArchiveFileId both already use for exactly
 * this "no explicit directory given" case.
 * @param {string} target
 * @param {string | string[]} currentDocumentId
 */
export function resolveImagePath(target, currentDocumentId) {
  let path = target.replace(/^(file:|github:|webdav:|local:)/i, '');
  path = path.replace(/^\.\//, '');
  if (path.startsWith('/')) return path.slice(1);
  if (path.includes('/') || !currentDocumentId) return path;
  const lastSlash = currentDocumentId.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : currentDocumentId.slice(0, lastSlash + 1);
  return dir + path;
}

/**
 * Resolves an "attachment:filename" link target to its own actual
 * storage path -- data/<id-prefix>/<id-rest>/filename, itself always
 * derived purely from whichever heading's own :ID: property owns the
 * attachment directory, matching real org-attach's own actual
 * resolution behavior. That whole "data/..." tree, though, lives
 * relative to the CURRENT DOCUMENT's own directory (`documentId`,
 * when given) -- a document at "org-pwa/foo.org" gets its own
 * attachments under "org-pwa/data/...", not a bare, always-repo-root
 * "data/..." (a real, confirmed gap this had until now: every
 * attachment for every document in a repo/server used to collide
 * into the very same top-level "data/" tree regardless of which
 * subfolder its own document actually lived in) -- the same
 * document-relative resolution resolveImagePath just above already
 * uses for a plain file: link. Walks `heading` itself first, then
 * outward through its own ancestor chain (found via
 * findAncestorPath), returning the FIRST :ID: found -- matching real
 * org-attach's own inheritance: a heading with no :ID: of its own can
 * still resolve an attachment: link against an ancestor's attach
 * directory. Returns null if no heading in the whole chain (this one,
 * or any ancestor) has an :ID: at all -- nothing to resolve against.
 *
 * `attachmentTarget` is the link's own full target text, including
 * the "attachment:" prefix (e.g. "attachment:photo.jpg") -- stripped
 * here, not by the caller, matching resolveImagePath's own convention
 * of taking the raw target text as-is.
 * @param {Doc} doc
 * @param {Heading | null} heading
 * @param {any} attachmentTarget
 * @param {string} documentId
 */
export function resolveAttachmentTarget(doc, heading, attachmentTarget, documentId) {
  const filename = attachmentTarget.replace(/^attachment:/i, '');
  const dir = resolveAttachmentDirectory(doc, heading, documentId);
  return dir ? `${dir}/${filename}` : null;
}

/** The attachment folder for `heading`: the one its own DIR or :ID: names, else the nearest ancestor's; null with neither in that
 * @param {Doc} doc
 * @param {Heading | null} heading
 * @param {string} documentId
 *  chain. */
export function resolveAttachmentDirectory(doc, heading, documentId) {
  const ancestors = findAncestorPath(doc, heading) || [];
  const chain = [heading, ...ancestors.slice().reverse()];
  for (const candidate of chain) {
    const dir = ownAttachmentDirectory(candidate, documentId);
    if (dir) return dir;
  }
  return null;
}

const IMAGE_MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
};

/** Guesses an image's MIME type from its file extension, for building a
 *  data: URL — falls back to a generic binary type for an unrecognized
 *  extension, which most browsers still render correctly for the image
 *  formats this app actually recognizes (see IMAGE_EXT_RE in
 * @param {string} path
 *  inline-markup.js, the same extension list this mirrors). */
export function guessImageMimeType(path) {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  const ext = match ? match[1].toLowerCase() : '';
  return /** @type {any} */ (IMAGE_MIME_TYPES)[ext] || 'application/octet-stream';
}

const AUDIO_MIME_TYPES = {
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  weba: 'audio/webm',
  aac: 'audio/aac',
  flac: 'audio/flac',
};

/** Same idea as guessImageMimeType, for the audio-attachment playback
 *  feature's own data: URL construction -- an unrecognized extension
 *  falls back to a generic binary MIME type, matching
 *  guessImageMimeType's own fallback exactly (the browser's own
 *  <audio> element will simply fail to play an unplayable file either
 *  way; this isn't attempting format detection beyond the extension
 *  itself, the same honest limitation guessImageMimeType already
 * @param {string} path
 *  has). */
export function guessAudioMimeType(path) {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  const ext = match ? match[1].toLowerCase() : '';
  return /** @type {any} */ (AUDIO_MIME_TYPES)[ext] || 'application/octet-stream';
}

// Every recognized image format EXCEPT svg -- svg is deliberately left
// out here for the same reason html is: opening it via direct
// navigation (what Open actually does, unlike this app's own existing,
// safe <img>-based inline display) would execute any script embedded in
// the file. An ordinary raster format has no such capability at all.
// Destructuring off "svg" here (rather than a second, separately-typed
// copy of the same extension list) means this can't silently drift out
// of sync with IMAGE_MIME_TYPES if a new image format is ever added to
// one but not the other.
const { svg: _svgExcludedFromViewable, ...VIEWABLE_IMAGE_MIME_TYPES } = IMAGE_MIME_TYPES;

// "mp4" excluded here, unlike the rest of AUDIO_MIME_TYPES below:
// extensionForRecordedMimeType (attach.js) always names an audio/mp4
// recording ".m4a" specifically, precisely to avoid this exact
// ambiguity, so a literal ".mp4" attachment is essentially always a
// video file in practice -- VIEWABLE_MIME_TYPES's own video/mp4 entry
// should win, not get silently overridden by this spread the way
// webm's own collision (below) is deliberately meant to go the other
// direction.
const { mp4: _mp4ExcludedFromAudioOverride, ...VIEWABLE_AUDIO_MIME_TYPES } = AUDIO_MIME_TYPES;

const VIEWABLE_MIME_TYPES = {
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  txt: 'text/plain',
  md: 'text/plain',
  org: 'text/plain',
  csv: 'text/plain',
  log: 'text/plain',
  json: 'text/plain',
  xml: 'text/plain',
  yaml: 'text/plain',
  yml: 'text/plain',
  ...VIEWABLE_IMAGE_MIME_TYPES,
  // Spread last, deliberately: .webm is a genuinely ambiguous
  // extension -- a legitimate container for both audio-only and
  // audio+video content -- and this app's own in-browser recording
  // feature specifically produces audio-only .webm files as its
  // actual output on most browsers (see attach.js's own
  // extensionForRecordedMimeType). A recorded .webm attachment is by
  // far the more likely real case for THIS app specifically, compared
  // to an externally-sourced .webm video file someone attached by
  // hand -- so audio/webm intentionally overrides the video/webm
  // entry above for this one extension, not the other way around.
  ...VIEWABLE_AUDIO_MIME_TYPES,
};

/** Returns a MIME type for anything this app's own Open action can
 *  reasonably expect a browser to display natively when opened
 *  directly (a new tab, via a blob: URL) -- a PDF's own built-in
 *  viewer, native video playback, or plain text rendered as-is. Null
 *  for anything without a real, likely-native viewer (an unrecognized
 *  extension, or one deliberately excluded here despite technically
 *  being "text" -- .html and .svg both stay out of this table on
 *  purpose: opening either via direct navigation, unlike this app's
 *  own existing, safe <img>-based inline SVG display or a sandboxed
 *  PDF/video viewer, would actually execute any script embedded in
 *  the file, a real and meaningfully different risk this table is
 *  careful not to introduce for an "open this attachment" action).
 *  Deliberately returns null rather than a fallback type (unlike
 *  guessImageMimeType/guessAudioMimeType) -- callers need to
 *  distinguish "no viewer, fall back to downloading it instead" from
 *  "here's what to view it as", not get handed a generic
 * @param {string} path
 *  application/octet-stream that would look viewable when it isn't. */
export function guessViewableMimeType(path) {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  const ext = match ? match[1].toLowerCase() : '';
  return /** @type {any} */ (VIEWABLE_MIME_TYPES)[ext] || null;
}

/**
 * @param {Doc} doc
 * @param {(heading: Heading) => void} visit
 */
function walkHeadings(doc, visit) {
  /** @param {Heading[]} nodes */
  function walk(nodes) {
    for (const node of nodes) {
      if (node.type !== 'heading') continue;
      visit(node);
      walk(node.children);
    }
  }
  walk(doc.children);
}

/**
 * First heading (in document order) whose title exactly matches `title`, or null.
 * @param {Doc} doc
 * @param {string} title
 * @returns {Heading | null}
 */
export function findHeadingByTitle(doc, title) {
  /** @type {Heading | null} */ let found = null;
  walkHeadings(doc, (node) => {
    if (!found && node.title === title) found = node;
  });
  return found;
}

/**
 * First heading (in document order) whose :CUSTOM_ID: property exactly matches, or null.
 * @param {Doc} doc
 * @param {string} customId
 * @returns {Heading | null}
 */
export function findHeadingByCustomId(doc, customId) {
  /** @type {Heading | null} */ let found = null;
  walkHeadings(doc, (node) => {
    if (!found && getProperty(node, 'CUSTOM_ID') === customId) found = node;
  });
  return found;
}

/**
 * Every heading (in document order) whose own :ID: property is `id`, for an `[[id:...]]` link. Only the heading's own property
 * counts, not an inherited one, as in org-id. Org compares IDs as written; case is ignored here because one tool writes a UUID
 * in lower case and another in upper, and they are still the same ID.
 * @param {Doc} doc
 * @param {string} id
 * @returns {Heading[]}
 */
export function findHeadingsById(doc, id) {
  const wanted = id.trim().toLowerCase();
  /** @type {Heading[]} */ const found = [];
  if (!wanted) return found;
  walkHeadings(doc, (node) => {
    const own = getProperty(node, 'ID');
    if (typeof own === 'string' && own.trim().toLowerCase() === wanted) found.push(node);
  });
  return found;
}

/**
 * The first heading with this :ID:, or null.
 * @param {Doc} doc
 * @param {string} id
 * @returns {Heading | null}
 */
export function findHeadingById(doc, id) {
  return findHeadingsById(doc, id)[0] || null;
}

/** Does `nodes` (a parsed inline-node array) contain a footnote-def node
 *  with this exact label, anywhere (including nested inside emphasis
 * @param {any} nodes
 * @param {string} label
 *  spans, since footnote-def content is itself recursively parsed)? */
function inlineContainsFootnoteDef(nodes, label) {
  for (const node of nodes) {
    if (node.type === 'footnote-def' && node.label === label) return true;
    if (node.children && inlineContainsFootnoteDef(node.children, label)) return true;
  }
  return false;
}

/**
 * Finds the definition of footnote `label` (in document order): either a
 * paragraph explicitly marked as that footnote's own definition (the
 * "[fn:label] text" separate-line convention body-parser.js detects), or
 * any paragraph/list-item/table-cell containing an inline
 * [fn:label:definition] node with a matching label -- an inline
 * definition can be referenced again elsewhere via a bare [fn:label],
 * same as real org allows.
 *
 * Returns { heading, kind } (kind is 'paragraph-definition' or
 * 'inline-definition', for a caller that wants to highlight differently
 * depending on which), or null if no definition exists anywhere in the
 * document for this label.
 * @param {Doc} doc
 * @param {string} label
 */
export function findFootnoteDefinition(doc, label) {
  /** @type {{ heading: any; kind: string; node: any; } | null} */
  let found = null;

  /**
   * @param {any} node
   * @param {Heading} heading
   */
  function checkParagraph(node, heading) {
    if (found) return;
    if (node.footnoteLabel === label) {
      found = { heading, kind: 'paragraph-definition', node };
      return;
    }
    for (const inline of node.inlineLines) {
      if (inlineContainsFootnoteDef(inline, label)) {
        found = { heading, kind: 'inline-definition', node };
        return;
      }
    }
  }

  /**
   * @param {any} items
   * @param {Heading} heading
   */
  function checkListItems(items, heading) {
    for (const item of items) {
      if (found) return;
      if (inlineContainsFootnoteDef(item.inline, label)) {
        found = { heading, kind: 'inline-definition', node: item };
        return;
      }
      for (const nestedList of item.children) {
        if (found) return;
        checkListItems(nestedList.items, heading);
      }
    }
  }

  walkHeadings(doc, (/** @type {any} */ heading) => {
    if (found) return;
    for (const node of heading.body) {
      if (found) return;
      if (node.type === 'paragraph') checkParagraph(node, heading);
      else if (node.type === 'list') checkListItems(node.items, heading);
      else if (node.type === 'table') {
        for (const row of node.rows) {
          if (found) return;
          if (row.type !== 'row') continue;
          for (const cellInline of row.cellsInline) {
            if (inlineContainsFootnoteDef(cellInline, label)) {
              found = { heading, kind: 'inline-definition', node };
              break;
            }
          }
        }
      }
    }
  });

  return found;
}

/**
 * Splits a "file:...::target" style link into the file path and an
 * optional in-file target (a headline search or plain text search),
 * matching real org's own "::" separator convention for jumping
 * straight to a location within the linked file:
 *   [[file:~/notes.org::*Project Alpha]]  -- headline search
 *   [[file:~/notes.org::exact phrase]]    -- plain text search
 * An in-file target starting with "*" is a headline search (the "*" is
 * stripped); anything else after "::" is a plain text search. Returns
 * { path, inFileTarget } where inFileTarget is null if there's no
 * "::" at all.
 * @param {string} pathAndTarget
 */
export function splitFileLinkTarget(pathAndTarget) {
  const idx = pathAndTarget.indexOf('::');
  if (idx === -1) return { path: pathAndTarget, inFileTarget: null };
  return { path: pathAndTarget.slice(0, idx), inFileTarget: pathAndTarget.slice(idx + 2) };
}

/**
 * Resolves `rawTarget` against `doc`. Returns one of:
 *   { type: 'external', url }
 *   { type: 'heading', heading }
 *   { type: 'id', id }
 *   { type: 'file', scheme, path, inFileTarget }
 *   { type: 'unresolved', target }
 * @param {Doc} doc
 * @param {unknown} rawTarget
 * @returns {LinkResolution}
 */
export function resolveLinkTarget(doc, rawTarget) {
  const target = String(rawTarget).trim();

  if (isDoi(target)) {
    return { type: 'external', url: doiToUrl(target) };
  }

  if (isExternalUrl(target)) {
    return { type: 'external', url: target };
  }

  if (target.startsWith('#')) {
    const heading = findHeadingByCustomId(doc, target.slice(1));
    return heading ? { type: 'heading', heading } : { type: 'unresolved', target };
  }

  if (target.startsWith('*')) {
    const heading = findHeadingByTitle(doc, target.slice(1).trim());
    return heading ? { type: 'heading', heading } : { type: 'unresolved', target };
  }

  if (/^attachment:/i.test(target)) {
    return { type: 'attachment', target };
  }

  if (/^id:/i.test(target)) {
    // [[id:UUID]]: the heading in this document with that :ID:, else it may be in another file (see id-links.js)
    const id = target.slice(3).replace(/::.*$/, '').trim();
    const heading = findHeadingById(doc, id);
    return heading ? { type: 'heading', heading } : { type: 'id', id };
  }

  if (isFileLink(target)) {
    const scheme = fileLinkScheme(target);
    const withoutScheme = target.replace(/^(file:|github:|webdav:|local:)/i, '');
    const { path, inFileTarget } = splitFileLinkTarget(withoutScheme);
    return { type: 'file', scheme, path, inFileTarget };
  }

  const heading = findHeadingByTitle(doc, target);
  return heading ? { type: 'heading', heading } : { type: 'unresolved', target };
}
