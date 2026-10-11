// @ts-check
/**
 * Detects a "commented" heading: one whose title itself starts with a
 * comment marker. This mirrors real org-mode's own definition of a
 * comment line, from the manual: "Lines starting with zero or more
 * whitespace characters followed by one '#' and a whitespace are
 * treated as comments". Applied here to a heading's title specifically
 * (which the parser has already separated from the leading stars/TODO
 * keyword/priority cookie, so this only needs to check the start of the
 * title text itself, not scan the raw line for leading whitespace).
 *
 * Distinct from archiving (see archive-model.js) — a commented heading
 * isn't archived and isn't tagged in any special way; it's a perfectly
 * ordinary, fully visible heading in the outline. The only thing this
 * status affects is whether it's included in agenda views, mirroring
 * real org's org-agenda-skip-comment-trees (default t — skip them),
 * which agenda.js reads via a Local Variable (see local-variables.js) to
 * decide whether to act on this at all.
 */

// "# " is this app's own marker; COMMENT after the stars (and the TODO keyword) is Emacs's, and the same word first in the title
// of a heading with no keyword is a comment too (org-element reads `* COMMENT TODO x` as a commented heading titled "TODO x").
const COMMENT_TITLE_RE = /^(#|COMMENT)(\s|$)/;

function isCommentedHeading(heading) {
  return COMMENT_TITLE_RE.test(heading.title || '');
}

export { isCommentedHeading };
