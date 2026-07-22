/**
 * Parses org's #+STARTUP: directive into a structured config covering
 * heading visibility and inline-image visibility. None, some, or both
 * keywords can appear on a single #+STARTUP: line, and a file can have
 * more than one such line — "last one wins" applies uniformly to both
 * cases, since this walks doc.keywords (already in document order from
 * the parser) and lets each later matching token simply overwrite the
 * earlier one in its category.
 *
 * Archive-tree-cycling behavior used to live here too, as invented
 * "archived"/"noarchived" #+STARTUP: keywords — that was a mistake: real
 * org-mode doesn't have #+STARTUP: keywords for this at all. The actual
 * mechanism is the Emacs variable `org-cycle-open-archived-trees`,
 * conventionally set per-file via a "Local Variables" block, not
 * #+STARTUP:. That's now handled by local-variables.js instead — see
 * there for the corrected mechanism.
 *
 * Defaults (used when a category's keyword never appears anywhere in the
 * file) match real Emacs org-mode's actual out-of-the-box behavior, not
 * assumptions: a fresh file with no #+STARTUP line opens fully shown
 * (`showeverything`), and images stay as link text rather than rendering
 * (`noinlineimages`).
 */

const VISIBILITY_KEYWORDS = ['overview', 'content', 'showall', 'showeverything'];
const IMAGE_VISIBILITY_KEYWORDS = ['inlineimages', 'noinlineimages'];

const DEFAULT_STARTUP_CONFIG = {
  visibility: 'showeverything',
  imageVisibility: 'noinlineimages',
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
      }
      // Unrecognized tokens (org has many more #+STARTUP keywords than
      // these two categories — logdone, hidestars, etc.) are silently
      // ignored rather than erroring, matching org's own tolerant parsing
      // of directives it doesn't act on.
    }
  }
  return config;
}

export { DEFAULT_STARTUP_CONFIG };
