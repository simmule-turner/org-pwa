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

import { findContainer, findAncestorPath, shiftLevels } from './archive-model.js';
import { parseOrgTimestamp, findTimestamps } from './org-timestamp.js';

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
    bodyHidden: false,
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

/** Splits free-form tag input (space- or colon-separated, e.g. from a
 *  text prompt: "urgent home01" or ":urgent:home01:") into a clean tag
 *  array — trimmed, empty entries dropped, and any stray colons stripped
 *  from within a tag (colons are the org tag *delimiter*, so one leaking
 *  into an actual tag value would corrupt the `:tag1:tag2:` serialization
 *  on the next save). */
export function parseTagsInput(input) {
  return String(input)
    .split(/[\s:]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Replaces `heading`'s tags outright with `tags` (already-clean array —
 *  see parseTagsInput for turning free-form user input into one). */
export function setHeadingTags(heading, tags) {
  const cleaned = tags.map((t) => String(t).trim().replace(/:/g, '')).filter(Boolean);
  heading.tags = cleaned;
  return cleaned;
}

/** `heading`'s SCHEDULED/DEADLINE as editable lines, one per line
 *  (omitting CLOSED — that's auto-managed by marking a task done, not
 *  something this simple editor exposes for hand-editing). A minimal
 *  timestamp editor, not the fuller SCHEDULED/DEADLINE CRUD (repeaters,
 *  a date picker, etc.) that's still to come — this covers "add/edit/
 *  clear a plain SCHEDULED or DEADLINE value" only. */
export function getPlanningText(heading) {
  const lines = [];
  if (heading.planning.scheduled) lines.push(`SCHEDULED: ${heading.planning.scheduled}`);
  if (heading.planning.deadline) lines.push(`DEADLINE: ${heading.planning.deadline}`);
  return lines.join('\n');
}

/**
 * Replaces `heading`'s SCHEDULED/DEADLINE from `text` (the same format
 * getPlanningText produces: "SCHEDULED: <...>" / "DEADLINE: <...>", one
 * per line). A full replace for those two fields specifically — a line
 * omitted from the text clears that field — but `closed` is always left
 * untouched, since this editor never shows it and shouldn't silently
 * wipe it. Each value is validated with parseOrgTimestamp before being
 * accepted; a malformed value (or an unrecognized line) is just skipped
 * rather than corrupting heading.planning with something the agenda
 * engine couldn't parse back out.
 */
export function setPlanningFromText(heading, text) {
  let scheduled = null;
  let deadline = null;
  const lineRe = /^(SCHEDULED|DEADLINE)\s*:\s*(.+)$/i;
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = lineRe.exec(line);
    if (!m) continue;
    const value = m[2].trim();
    if (!parseOrgTimestamp(value)) continue; // skip anything that wouldn't parse back out cleanly
    if (m[1].toUpperCase() === 'SCHEDULED') scheduled = value;
    else deadline = value;
  }
  heading.planning = { scheduled, deadline, closed: heading.planning.closed };
}

/**
 * The first *active* plain timestamp found in `heading`'s title, if
 * any — i.e. a timestamp written directly in the title line rather than
 * on a SCHEDULED:/DEADLINE: planning line (the standard org convention
 * for a recurring date like a birthday: "Jennifer <1989-11-02 Thu
 * +1y>"). Returns the raw timestamp string (e.g. "<1989-11-02 Thu
 * +1y>"), or null if the title has none. Used to pre-fill the plain-
 * timestamp field in the structured timestamp editor from whatever's
 * already there.
 */
export function getPlainTimestampInTitle(heading) {
  const found = findTimestamps(heading.title).find((t) => t.active);
  return found ? found.raw : null;
}

/**
 * Sets (or clears, if `raw` is null) the plain timestamp embedded in a
 * heading's title. If an active timestamp already exists in the title,
 * it's replaced in place (preserving whatever text surrounds it);
 * otherwise the new one is appended to the end of the title. Passing
 * null removes the first active timestamp found, if any, leaving the
 * rest of the title untouched.
 */
export function setPlainTimestampInTitle(heading, raw) {
  const existing = findTimestamps(heading.title).find((t) => t.active);
  if (existing) {
    heading.title = heading.title.replace(existing.raw, raw || '').replace(/\s+/g, ' ').trim();
  } else if (raw) {
    heading.title = (heading.title + ' ' + raw).trim();
  }
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

/** Swaps heading with its previous sibling (same parent, same level).
 *  No-op (returns false) if heading is already first among its
 *  siblings. Matches real org's M-up: reorders among siblings without
 *  touching level or parent — the subtree (all descendants) moves as
 *  one unit automatically, since they're already part of the same
 *  object. */
export function moveHeadingUp(doc, heading) {
  const located = findContainer(doc, heading);
  if (!located || located.index === 0) return false;
  const { container, index } = located;
  [container[index - 1], container[index]] = [container[index], container[index - 1]];
  return true;
}

/** Swaps heading with its next sibling. No-op if already last. */
export function moveHeadingDown(doc, heading) {
  const located = findContainer(doc, heading);
  if (!located || located.index === located.container.length - 1) return false;
  const { container, index } = located;
  [container[index], container[index + 1]] = [container[index + 1], container[index]];
  return true;
}

/**
 * Promotes heading (and its whole subtree) up one level: it becomes a
 * sibling of its current parent, inserted immediately after it. No-op
 * if heading is already top-level — there's nothing above level 1 to
 * promote into. Matches real org's M-left/outdent, except expressed as
 * reparenting rather than just decrementing a star count: this app's
 * document model derives level from tree depth, so "one level up"
 * means "become a child of the grandparent" — every descendant's level
 * shifts by the same amount as part of the same move, since they're
 * still the same subtree, just relocated.
 */
export function promoteHeading(doc, heading) {
  const path = findAncestorPath(doc, heading);
  if (!path || path.length === 0) return false; // already top-level
  const parent = path[path.length - 1];

  const located = findContainer(doc, heading);
  const parentLocated = findContainer(doc, parent);
  if (!located || !parentLocated) return false;

  located.container.splice(located.index, 1);
  parentLocated.container.splice(parentLocated.index + 1, 0, heading);
  shiftLevels(heading, parent.level);
  return true;
}

/**
 * Demotes heading (and its whole subtree) down one level: it becomes
 * the last child of its immediately preceding sibling. No-op if
 * heading has no preceding sibling — matches real org's own
 * limitation, since there'd be nothing to become a child of (you can't
 * demote the very first item under a given parent).
 */
export function demoteHeading(doc, heading) {
  const located = findContainer(doc, heading);
  if (!located || located.index === 0) return false;
  const { container, index } = located;
  const newParent = container[index - 1];

  container.splice(index, 1);
  newParent.children.push(heading);
  newParent.collapsed = false; // otherwise the demoted heading vanishes from view the instant it moves
  shiftLevels(heading, newParent.level + 1);
  return true;
}
