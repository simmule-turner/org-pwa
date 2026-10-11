// @ts-check
/**
 * Detects a commented heading the way Emacs does: COMMENT as the first word of the title, after the stars, the TODO
 * keyword and the priority (`** TODO COMMENT draft`), or first in a heading with no keyword (org-element reads
 * `** COMMENT TODO x` as a commented heading titled "TODO x"). Only the agenda-style listings and exports act on it:
 * a commented heading is an ordinary, fully visible heading in the outline.
 *
 * Distinct from archiving (see archive-model.js). The settings that read it are org-agenda-skip-comment-trees and
 * the exporters' own handling (see local-variables.js).
 */

const COMMENT_TITLE_RE = /^COMMENT(\s|$)/;

function isCommentedHeading(heading) {
  return COMMENT_TITLE_RE.test(heading.title || '');
}

export { isCommentedHeading };
