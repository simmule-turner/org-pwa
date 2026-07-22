/**
 * Parses org's #+STARTUP: directive into a structured config covering the
 * three categories requested: visibility, image-visibility, and
 * archive-visibility. None, some, or all three keywords can appear on a
 * single #+STARTUP: line, and a file can have more than one such line —
 * "last one wins" applies uniformly to both cases, since this walks
 * doc.keywords (already in document order from the parser) and lets each
 * later matching token simply overwrite the earlier one in its category.
 *
 * Defaults (used when a category's keyword never appears anywhere in the
 * file) match real Emacs org-mode's actual out-of-the-box behavior, not
 * assumptions: a fresh file with no #+STARTUP line opens fully shown
 * (`showeverything`), images stay as link text rather than rendering
 * (`noinlineimages`), and archived items don't auto-expand during
 * visibility cycling (`archived`).
 */

const VISIBILITY_KEYWORDS = ['overview', 'content', 'showall', 'showeverything'];
const IMAGE_VISIBILITY_KEYWORDS = ['inlineimages', 'noinlineimages'];
const ARCHIVE_VISIBILITY_KEYWORDS = ['archived', 'noarchived'];

const DEFAULT_STARTUP_CONFIG = {
  visibility: 'showeverything',
  imageVisibility: 'noinlineimages',
  archiveVisibility: 'archived',
};

export function parseStartupConfig(doc) {
  const config = { ...DEFAULT_STARTUP_CONFIG };
  for (const kw of doc.keywords || []) {
    if (kw.key.toUpperCase() !== 'STARTUP') continue;
    const tokens = kw.value.trim().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (VISIBILITY_KEYWORDS.includes(token)) {
        config.visibility = token;
      } else if (IMAGE_VISIBILITY_KEYWORDS.includes(token)) {
        config.imageVisibility = token;
      } else if (ARCHIVE_VISIBILITY_KEYWORDS.includes(token)) {
        config.archiveVisibility = token;
      }
      // Unrecognized tokens (org has many more #+STARTUP keywords than
      // these three categories — logdone, hidestars, etc.) are silently
      // ignored rather than erroring, matching org's own tolerant parsing
      // of directives it doesn't act on.
    }
  }
  return config;
}

export { DEFAULT_STARTUP_CONFIG };
