/**
 * Checkbox statistics cookies: `[3/8]` or `[40%]` in a heading's title,
 * kept in sync with the actual checkbox state in that heading's subtree —
 * matching real org-mode's default (hierarchical/recursive) behavior:
 * counts every checkbox in the heading's own body AND every descendant
 * heading's body, not just its own direct list.
 *
 * A cookie can appear with blank numbers (`[/]`, `[/11]`) before it's
 * ever been computed — both forms are valid org syntax and are matched
 * here the same way real org would fill them in once counted.
 */

import { findAncestorPath } from './archive-model.js';

const COOKIE_RE = /\[(\d*)\/(\d*)\]|\[(\d*)%\]/;

function walkListForCheckboxes(items) {
  let total = 0;
  let checked = 0;
  for (const item of items) {
    if (item.checkbox !== null) {
      total++;
      if (item.checkbox === 'X') checked++;
    }
    for (const nested of item.children || []) {
      const sub = walkListForCheckboxes(nested.items);
      total += sub.total;
      checked += sub.checked;
    }
  }
  return { total, checked };
}

/** Counts every checkbox in `heading`'s own body content and recursively
 *  through every descendant heading's body content. */
export function countCheckboxes(heading) {
  let total = 0;
  let checked = 0;
  for (const node of heading.body || []) {
    if (node.type !== 'list') continue;
    const sub = walkListForCheckboxes(node.items);
    total += sub.total;
    checked += sub.checked;
  }
  for (const child of heading.children || []) {
    const sub = countCheckboxes(child);
    total += sub.total;
    checked += sub.checked;
  }
  return { total, checked };
}

/**
 * If `heading`'s title contains a checkbox cookie, recomputes it from the
 * heading's current subtree checkbox state and updates the title in
 * place. Returns true if the title actually changed (false if there was
 * no cookie to update, or the numbers were already correct).
 */
export function updateHeadingCheckboxCookie(heading) {
  const match = heading.title.match(COOKIE_RE);
  if (!match) return false;

  const { total, checked } = countCheckboxes(heading);
  const isPercent = match[0].includes('%');
  const newCookie = isPercent
    ? `[${total === 0 ? 0 : Math.round((checked / total) * 100)}%]`
    : `[${checked}/${total}]`;

  if (newCookie === match[0]) return false;
  heading.title = heading.title.slice(0, match.index) + newCookie + heading.title.slice(match.index + match[0].length);
  return true;
}

/**
 * Call this after any checkbox add/remove/toggle: updates the cookie on
 * `owningHeading` itself (a heading's cookie commonly counts its own
 * direct checklist) and on every ancestor above it (whose cookies, if
 * present, count recursively and so are also affected). Each heading's
 * cookie is independent of the others, so update order doesn't matter.
 * Returns true if anything actually changed.
 */
export function updateCheckboxCookiesUpward(doc, owningHeading) {
  const ancestors = findAncestorPath(doc, owningHeading) || [];
  let changed = false;
  for (const heading of [...ancestors, owningHeading]) {
    if (updateHeadingCheckboxCookie(heading)) changed = true;
  }
  return changed;
}
