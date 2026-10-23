// @ts-check
// Writing org links, as ol.el does: the backslash escaping of a link target (org-link-escape) and the bracket link built
// from a target and a description (org-link-make-string).

const ZERO_WIDTH_SPACE = '​';

/**
 * Backslash-escapes the square brackets in a link target, and doubles backslashes in front of them or at the end,
 * so that reading the link back (unescapeLink) gives the target again.
 * @param {string} link
 */
export function escapeLink(link) {
  return link.replace(/(\\*)($|[[\]])/g, (_m, slashes, bracket) => slashes + slashes + (bracket ? '\\' : '') + bracket);
}

/**
 * The inverse of escapeLink: halves each run of backslashes that stands before a square bracket or the end.
 * @param {string} link
 */
export function unescapeLink(link) {
  return link.replace(/(\\+)($|[[\]])/g, (_m, slashes, bracket) => '\\'.repeat(Math.floor(slashes.length / 2)) + bracket);
}

/**
 * `[[link][description]]`, or `[[link]]` when the description is empty. A description cannot hold two closing brackets
 * in a row or end with one, so a zero-width space goes between them or after the last one.
 * @param {string} link
 * @param {string | null | undefined} [description]
 */
export function makeLinkString(link, description) {
  const text = description && description.trim() !== '' ? description.trim().replace(/\]$/, ']' + ZERO_WIDTH_SPACE).replace(/\](?=\])/g, ']' + ZERO_WIDTH_SPACE) : '';
  if (!link || link.trim() === '') {
    if (text) return text;
    throw new Error('Empty link');
  }
  return `[[${escapeLink(link)}]${text ? `[${text}]` : ''}]`;
}
