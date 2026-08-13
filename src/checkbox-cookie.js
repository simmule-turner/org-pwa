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
 *
 * A heading's own :COOKIE_DATA: property (real org's own documented
 * mechanism -- checked directly against the Org manual) can override
 * what actually gets counted: "checkbox" or "todo" resolve the
 * ambiguity real org itself describes when a heading has BOTH
 * checkboxes and TODO-keyword child headings below it (which one the
 * cookie should actually reflect); both words together count both
 * kinds combined into the same total. "recursive" (only meaningful
 * alongside "todo") makes TODO counting reach the whole subtree at
 * any depth, not just direct children -- the Org manual's own literal
 * wording treats direct-children-only as the baseline for TODO
 * counting before "recursive" is added, unlike checkbox counting
 * (already recursive by default, both in real org and in this app's
 * own existing behavior, with no COOKIE_DATA involved at all).
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

/** Counts TODO-keyword child headings for :COOKIE_DATA: "todo" mode --
 *  `heading`'s own direct children only when `recursive` is false (the
 *  default absent an explicit "recursive" keyword in COOKIE_DATA), or
 *  the whole subtree at any depth when true. Only a heading that
 *  actually carries a TODO keyword counts at all (an ordinary heading
 *  with none isn't part of either total) -- this is a TODO-ITEM
 *  count, not a generic child-heading count, matching real org's own
 *  actual behavior. "checked" means the child's own keyword is one of
 *  `doneKeywords`. */
function countTodoChildren(heading, doneKeywords, recursive) {
  let total = 0;
  let checked = 0;
  for (const child of heading.children || []) {
    if (child.todo !== null) {
      total++;
      if (doneKeywords.includes(child.todo)) checked++;
    }
    if (recursive) {
      const sub = countTodoChildren(child, doneKeywords, true);
      total += sub.total;
      checked += sub.checked;
    }
  }
  return { total, checked };
}

/** Parses a heading's own :COOKIE_DATA: property value into which
 *  counting mode(s) actually apply -- real org's own documented,
 *  space-separated keyword syntax ("checkbox", "todo", "recursive",
 *  e.g. "todo recursive"; see this file's own header comment for the
 *  full reasoning). Absent or empty (by far the common case): pure
 *  checkbox counting, unchanged from this app's own existing,
 *  already-shipped default -- nothing here alters that case at all. */
function parseCookieData(value) {
  const words = String(value || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const hasCheckbox = words.includes('checkbox');
  const hasTodo = words.includes('todo');
  if (!hasCheckbox && !hasTodo) {
    return { countCheckbox: true, countTodo: false, recursiveTodo: true };
  }
  return {
    countCheckbox: hasCheckbox,
    countTodo: hasTodo,
    recursiveTodo: words.includes('recursive'),
  };
}

/**
 * If `heading`'s title contains a checkbox cookie, recomputes it from the
 * heading's current subtree state (checkboxes, TODO-keyword children, or
 * both -- see :COOKIE_DATA: above) and updates the title in place.
 * Returns true if the title actually changed (false if there was no
 * cookie to update, or the numbers were already correct). `doneKeywords`
 * is only actually consulted when :COOKIE_DATA: requests TODO counting;
 * omitting it is harmless for the far more common checkbox-only case.
 */
export function updateHeadingCheckboxCookie(heading, doneKeywords = []) {
  const match = heading.title.match(COOKIE_RE);
  if (!match) return false;

  const cookieData = parseCookieData(heading.properties && heading.properties.COOKIE_DATA);
  let total = 0;
  let checked = 0;
  if (cookieData.countCheckbox) {
    const sub = countCheckboxes(heading);
    total += sub.total;
    checked += sub.checked;
  }
  if (cookieData.countTodo) {
    const sub = countTodoChildren(heading, doneKeywords, cookieData.recursiveTodo);
    total += sub.total;
    checked += sub.checked;
  }

  const isPercent = match[0].includes('%');
  const newCookie = isPercent
    ? `[${total === 0 ? 0 : Math.round((checked / total) * 100)}%]`
    : `[${checked}/${total}]`;

  if (newCookie === match[0]) return false;
  heading.title = heading.title.slice(0, match.index) + newCookie + heading.title.slice(match.index + match[0].length);
  return true;
}

/**
 * Call this after any checkbox add/remove/toggle (or TODO-state change,
 * for the :COOKIE_DATA: "todo" case): updates the cookie on
 * `owningHeading` itself (a heading's cookie commonly counts its own
 * direct checklist) and on every ancestor above it (whose cookies, if
 * present, count recursively and so are also affected). Each heading's
 * cookie is independent of the others -- including its own, individually
 * set :COOKIE_DATA: override -- so update order doesn't matter.
 * `doneKeywords` is passed straight through to updateHeadingCheckboxCookie
 * for each one. Returns true if anything actually changed.
 */
export function updateCheckboxCookiesUpward(doc, owningHeading, doneKeywords = []) {
  const ancestors = findAncestorPath(doc, owningHeading) || [];
  let changed = false;
  for (const heading of [...ancestors, owningHeading]) {
    if (updateHeadingCheckboxCookie(heading, doneKeywords)) changed = true;
  }
  return changed;
}
