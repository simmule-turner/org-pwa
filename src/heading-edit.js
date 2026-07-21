/**
 * Heading editing primitives: create, rename, insert. Kept separate from
 * org-parser.js (which owns text<->AST) and outline-view-model.js (which
 * owns the read-mostly view/gesture layer) — this module is specifically
 * "structural mutations a text-entry UI needs", and reuses
 * archive-model.js's findContainer rather than re-deriving it, same as
 * other modules in this codebase.
 *
 * Known limitation, stated rather than hidden: renameHeading does not
 * sanitize against org's own heading-line syntax. A title like
 * "foo :bar:" will round-trip fine in this session (title and tags are
 * separate fields in memory), but on a fresh parse of the saved file, the
 * trailing " :bar:" will be read back as a tag block, not part of the
 * title — because that's genuinely ambiguous in the underlying org syntax
 * itself, not a bug this module could silently paper over without risking
 * mangling legitimate titles that contain colons.
 */

import { findContainer } from './archive-model.js';

/** Builds a heading object with every field the AST shape requires — the
 *  single source of truth for "what does an empty heading look like",
 *  so callers never hand-construct one and risk a missing field. */
export function createHeading({ level, title = '', todo = null, priority = null, tags = [] } = {}) {
  if (!Number.isInteger(level) || level < 1) {
    throw new Error('createHeading: level must be a positive integer');
  }
  return {
    type: 'heading',
    level,
    todo,
    priority,
    title,
    tags: [...tags],
    planning: { scheduled: null, deadline: null, closed: null },
    properties: {},
    propertyOrder: [],
    bodyLines: [],
    body: [],
    collapsed: false,
    children: [],
  };
}

/** Sets a heading's title, stripping newlines (a heading is one line) and
 *  surrounding whitespace. Returns the sanitized value actually stored. */
export function renameHeading(heading, newTitle) {
  const sanitized = String(newTitle).replace(/[\r\n]+/g, ' ').trim();
  heading.title = sanitized;
  return sanitized;
}

/** Appends a new top-level (level 1) heading at the end of the document. */
export function insertTopLevelHeading(doc, opts = {}) {
  const heading = createHeading({ level: 1, ...opts });
  doc.children.push(heading);
  return heading;
}

/** Appends a new child heading under `parent`, one level deeper, and
 *  un-collapses `parent` so the new child is immediately visible rather
 *  than disappearing into a folded subtree the moment it's created. */
export function insertChildHeading(parent, opts = {}) {
  const heading = createHeading({ level: parent.level + 1, ...opts });
  parent.children.push(heading);
  parent.collapsed = false;
  return heading;
}

/** Removes `heading` from wherever it lives in `doc`. Used by the UI to
 *  discard a just-created heading if the user backs out without typing a
 *  title, rather than leaving an empty, unnamed heading behind. */
export function removeHeading(doc, heading) {
  const located = findContainer(doc, heading);
  if (!located) return false;
  located.container.splice(located.index, 1);
  return true;
}
