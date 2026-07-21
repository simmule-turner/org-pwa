/**
 * Resolves what an org link target actually points to, given a document.
 * Pure and DOM-free — the UI layer decides what to *do* with a resolution
 * (navigate, open a new tab, show "can't open that yet"); this module only
 * classifies and looks up.
 *
 * Supported target forms, matching the org-mode conventions requested:
 *   - http(s)/mailto URLs                -> { type: 'external', url }
 *   - "*Heading text"                    -> heading lookup by exact title
 *   - "#custom-id"                       -> heading lookup by :CUSTOM_ID:
 *   - "file:...", "./...", "../...",
 *     "~/...", "/..."                    -> { type: 'file', path }
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
const FILE_LIKE_RE = /^(file:|\.{1,2}\/|~\/|\/)/i;

export function isExternalUrl(target) {
  return EXTERNAL_URL_RE.test(target) || MAILTO_RE.test(target);
}

export function isFileLink(target) {
  return FILE_LIKE_RE.test(target);
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
 * Resolves `rawTarget` against `doc`. Returns one of:
 *   { type: 'external', url }
 *   { type: 'heading', heading }
 *   { type: 'file', path }
 *   { type: 'unresolved', target }
 */
export function resolveLinkTarget(doc, rawTarget) {
  const target = String(rawTarget).trim();

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
    return { type: 'file', path: target.replace(/^file:/i, '') };
  }

  const heading = findHeadingByTitle(doc, target);
  return heading ? { type: 'heading', heading } : { type: 'unresolved', target };
}
