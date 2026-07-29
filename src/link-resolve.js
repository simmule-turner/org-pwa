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

const EXTERNAL_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const MAILTO_RE = /^mailto:/i;
const DOI_RE = /^doi:/i;
const FILE_LIKE_RE = /^(file:|github:|webdav:|\.{1,2}\/|~\/|\/)/i;

export function isExternalUrl(target) {
  return EXTERNAL_URL_RE.test(target) || MAILTO_RE.test(target);
}

export function isDoi(target) {
  return DOI_RE.test(target);
}

/** A doi: target rewritten to the standard doi.org resolver URL —
 *  https://doi.org/10.1145/1327452.1327492 for "doi:10.1145/1327452.1327492"
 *  — the actual, fetchable/openable form a DOI needs to become to work
 *  as a real link, since "doi:..." on its own isn't a URL scheme any
 *  browser knows how to open directly. */
export function doiToUrl(target) {
  return 'https://doi.org/' + target.replace(DOI_RE, '');
}

export function isFileLink(target) {
  return FILE_LIKE_RE.test(target);
}

/** Which explicit scheme a file-like target uses, or 'file' as the
 *  default for a path-only target with no scheme prefix at all (a
 *  bare "./notes.org", "~/notes.org", "/notes.org", or "file:..." are
 *  all treated as the same 'file' scheme — only "github:"/"webdav:"
 *  are their own distinct schemes, since those specifically mean "a
 *  path within whichever GitHub repo / WebDAV server is configured,"
 *  not a path on the local filesystem). */
export function fileLinkScheme(target) {
  if (/^github:/i.test(target)) return 'github';
  if (/^webdav:/i.test(target)) return 'webdav';
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
 */
export function resolveImagePath(target, currentDocumentId) {
  let path = target.replace(/^(file:|github:|webdav:)/i, '');
  path = path.replace(/^\.\//, '');
  if (path.startsWith('/')) return path.slice(1);
  if (path.includes('/')) return path;
  const lastSlash = currentDocumentId.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : currentDocumentId.slice(0, lastSlash + 1);
  return dir + path;
}

const IMAGE_MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

/** Guesses an image's MIME type from its file extension, for building a
 *  data: URL — falls back to a generic binary type for an unrecognized
 *  extension, which most browsers still render correctly for the image
 *  formats this app actually recognizes (see IMAGE_EXT_RE in
 *  inline-markup.js, the same extension list this mirrors). */
export function guessImageMimeType(path) {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  const ext = match ? match[1].toLowerCase() : '';
  return IMAGE_MIME_TYPES[ext] || 'application/octet-stream';
}

function walkHeadings(doc, visit) {
  function walk(nodes) {
    for (const node of nodes) {
      if (node.type !== 'heading') continue;
      visit(node);
      walk(node.children);
    }
  }
  walk(doc.children);
}

/** First heading (in document order) whose title exactly matches `title`, or null. */
export function findHeadingByTitle(doc, title) {
  let found = null;
  walkHeadings(doc, (node) => {
    if (!found && node.title === title) found = node;
  });
  return found;
}

/** First heading (in document order) whose :CUSTOM_ID: property exactly matches, or null. */
export function findHeadingByCustomId(doc, customId) {
  let found = null;
  walkHeadings(doc, (node) => {
    if (!found && node.properties && node.properties.CUSTOM_ID === customId) found = node;
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
 *   { type: 'file', scheme, path, inFileTarget }
 *   { type: 'unresolved', target }
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

  if (isFileLink(target)) {
    const scheme = fileLinkScheme(target);
    const withoutScheme = target.replace(/^(file:|github:|webdav:)/i, '');
    const { path, inFileTarget } = splitFileLinkTarget(withoutScheme);
    return { type: 'file', scheme, path, inFileTarget };
  }

  const heading = findHeadingByTitle(doc, target);
  return heading ? { type: 'heading', heading } : { type: 'unresolved', target };
}
