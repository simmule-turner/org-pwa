// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * Statistics cookies (`[2/5]`, `[40%]`) in a heading's title, kept in sync the way Org 9.6 does it
 * (`org-update-checkbox-count`, `org-update-parent-todo-statistics`):
 *
 * - Toggling a checkbox updates the cookie of the heading whose section holds the list.  It counts that section's own
 *   lists, top-level items only; `:COOKIE_DATA: recursive` also counts nested items.  Child headings are not
 *   included.  A heading with `todo` in :COOKIE_DATA: is left alone.
 * - Changing a TODO state updates the cookie of the parent heading: it counts the child headings that have a TODO
 *   keyword, done ones as done.  Only direct children count, unless :COOKIE_DATA: (own or inherited) says
 *   `recursive`, which also climbs to the ancestors up to the heading that sets it.  A heading with `checkbox` in
 *   its :COOKIE_DATA: is left alone.
 * - `updateAllStatisticsCookies` does both for the whole document (`org-update-statistics-cookies` with a prefix
 *   argument): a heading with child headings ends up with its TODO count unless it says `checkbox`.
 * - A cookie in a list item (`- [ ] Steps [/]`) counts that item's sub-list, nested items too with `recursive`.
 * - Percentages round down; blank numbers (`[/]`, `[%]`) are filled in; every cookie in the title is updated.
 */

import { findAncestorPath, getProperty } from './archive-model.js';
import { inheritedProperty } from './babel-args.js';
import { parseInline } from './inline-markup.js';
import { findLists } from './list-edit.js';

const BOX_LINE_RE = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[@\d+\][ \t]*)?\[([ xX-])\](?:[ \t]|$)/;
const COOKIE_RE = /\[\d*\/\d*\]|\[\d*%\]/g;

/**
 * @param {any[]} items
 * @param {boolean} recursive
 */
function walkListForCheckboxes(items, recursive) {
  let total = 0;
  let checked = 0;
  for (const item of items) {
    if (item.checkbox !== null) {
      total++;
      if (item.checkbox === 'X') checked++;
    }
    if (!recursive) continue;
    for (const nested of item.children || []) {
      const sub = walkListForCheckboxes(nested.items, true);
      total += sub.total;
      checked += sub.checked;
    }
  }
  return { total, checked };
}

/** The checkboxes of `heading`'s own section (not its child headings): top-level items of every list, plus the
 * nested ones when `recursive`.
 * @param {Heading} heading
 * @param {boolean} [recursive]
 */
export function countCheckboxes(heading, recursive = false) {
  let total = 0;
  let checked = 0;
  // Org counts the boxes of every list in the section by its lines, text under an item and drawers included
  for (const lines of [heading.logbookLines, heading.preLogLines, heading.bodyLines]) {
    if (!Array.isArray(lines)) continue;
    for (const list of findLists(lines)) {
      for (const it of list.items) {
        if (!recursive && it.parent !== -1) continue;
        const box = BOX_LINE_RE.exec(lines[it.line]);
        if (!box) continue;
        total++;
        if (box[1] === 'X') checked++;
      }
    }
  }
  return { total, checked };
}

/** @param {Heading} heading @returns {string} */
function ownCookieData(heading) {
  return String(getProperty(heading, 'COOKIE_DATA') || '').toLowerCase();
}

/** @param {string} data @param {string} word */
const hasWord = (data, word) => new RegExp(`\\b${word}\\b`).test(data);

/** Rewrites every cookie in the title; true when the title changed.
 * @param {Heading} heading
 * @param {number} checked
 * @param {number} total
 */
function writeCookies(heading, checked, total) {
  const before = heading.title;
  heading.title = before.replace(COOKIE_RE, (cookie) => formatCookie(cookie, checked, total));
  return heading.title !== before;
}

/** @param {number} checked @param {number} total @param {string} cookie */
const formatCookie = (cookie, checked, total) =>
  cookie.includes('%') ? `[${Math.floor((100 * checked) / Math.max(1, total))}%]` : `[${checked}/${total}]`;

/**
 * Cookies in list items: each counts its own sub-list.
 * @param {Heading} heading
 * @param {any[]} items
 * @param {boolean} recursive
 */
function updateItemCookies(heading, items, recursive) {
  let changed = false;
  for (const item of items) {
    for (const list of item.children || []) updateItemCookies(heading, list.items, recursive) && (changed = true);
    if (!new RegExp(COOKIE_RE.source).test(item.text)) continue;
    let total = 0;
    let checked = 0;
    for (const list of item.children || []) {
      const sub = walkListForCheckboxes(list.items, recursive);
      total += sub.total;
      checked += sub.checked;
    }
    const text = item.text.replace(COOKIE_RE, (/** @type {string} */ c) => formatCookie(c, checked, total));
    if (text === item.text) continue;
    item.text = text;
    item.inline = parseInline(text);
    const line = heading.bodyLines && heading.bodyLines[item.lineIndex];
    if (typeof line === 'string') heading.bodyLines[item.lineIndex] = line.replace(COOKIE_RE, (c) => formatCookie(c, checked, total));
    changed = true;
  }
  return changed;
}

/**
 * After a checkbox change under `heading`: refreshes the cookies in its own title and in its list items.
 * @param {Heading} heading
 * @returns {boolean} whether anything changed
 */
export function updateCheckboxCookie(heading) {
  const data = ownCookieData(heading);
  if (hasWord(data, 'todo')) return false;
  const recursive = hasWord(data, 'recursive');
  const { total, checked } = countCheckboxes(heading, recursive);
  let changed = writeCookies(heading, checked, total);
  for (const node of heading.body || []) {
    if (node.type === 'list' && updateItemCookies(heading, node.items, recursive)) changed = true;
  }
  return changed;
}

/**
 * @param {Heading} parent
 * @param {boolean} recursive
 * @param {Set<string> | string[]} doneKeywords
 * @param {number} [depth]
 */
function countTodoChildren(parent, recursive, doneKeywords, depth = 0) {
  const done = new Set(doneKeywords);
  let total = 0;
  let checked = 0;
  for (const child of parent.children || []) {
    if (child.todo) {
      total++;
      if (done.has(child.todo)) checked++;
    }
    if (recursive) {
      const sub = countTodoChildren(child, true, doneKeywords, depth + 1);
      total += sub.total;
      checked += sub.checked;
    }
  }
  return { total, checked };
}

/**
 * After a TODO-state change on `heading`: refreshes the cookie of its parent heading (and, with
 * :COOKIE_DATA: recursive, of the ancestors above it).
 * @param {Doc} doc
 * @param {Heading} heading
 * @param {Set<string> | string[]} [doneKeywords]
 * @returns {boolean} whether any title changed
 */
export function updateTodoCookiesUpward(doc, heading, doneKeywords = []) {
  const ancestors = findAncestorPath(doc, heading) || [];
  if (!ancestors.length) return false;
  const inherited = String(inheritedProperty(doc, ancestors, 'COOKIE_DATA') || '').toLowerCase();
  const recursive = hasWord(inherited, 'recursive');
  // the heading that sets the inherited value bounds the climb
  let limit = 0;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (getProperty(ancestors[i], 'COOKIE_DATA') !== undefined) {
      limit = i;
      break;
    }
  }
  let changed = false;
  for (let i = ancestors.length - 1; i >= limit; i--) {
    if (hasWord(ownCookieData(ancestors[i]), 'checkbox')) break;
    const { total, checked } = countTodoChildren(ancestors[i], recursive, doneKeywords);
    if (writeCookies(ancestors[i], checked, total)) changed = true;
    if (!recursive) break;
  }
  return changed;
}

/**
 * Every cookie in the document, the way `org-update-statistics-cookies` does it with a prefix argument.
 * @param {Doc} doc
 * @param {Set<string> | string[]} [doneKeywords]
 * @returns {boolean} whether any title changed
 */
export function updateAllStatisticsCookies(doc, doneKeywords = []) {
  let changed = false;
  /** @type {Heading[]} */
  const all = [];
  /** @param {{ children?: Heading[] }} node */
  const walk = (node) => {
    for (const child of node.children || []) {
      all.push(child);
      walk(child);
    }
  };
  walk(doc);
  for (const heading of all) if (updateCheckboxCookie(heading)) changed = true;
  for (const heading of all) if (updateTodoCookiesUpward(doc, heading, doneKeywords)) changed = true;
  return changed;
}
