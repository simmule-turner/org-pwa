// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
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
import { parseOrg, serializeHeadingSubtree } from './org-parser.js';

/** Builds a heading object with every field the AST shape requires — the
 *  single source of truth for "what does an empty heading look like",
 *  so callers never hand-construct one and risk a missing field.
 * @param {{ level?: number, title?: string, todo?: string | null, priority?: string | null, tags?: string[] }} [fields]
 */
export function createHeading({ level, title = '', todo = null, priority = null, tags = [] } = {}) {
  if (level === undefined || !Number.isInteger(level) || level < 1) {
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
    logbookLines: [],
    preLogLines: [],
    bodyLines: [],
    body: [],
    collapsed: false,
    bodyHidden: false,
    drawersHidden: false,
    children: [],
  };
}

/** Sets a heading's title, stripping newlines (a heading is one line) and
 * @param {Heading} heading
 * @param {string} newTitle
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
 * @param {any} [input]
 *  on the next save). */
export function parseTagsInput(input) {
  return String(input)
    .split(/[\s:]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Replaces `heading`'s tags outright with `tags` (already-clean array —
 * @param {Heading} heading
 * @param {string[]} tags
 *  see parseTagsInput for turning free-form user input into one). */
export function setHeadingTags(heading, tags) {
  const cleaned = tags.map((t) => String(t).trim().replace(/:/g, '')).filter(Boolean);
  heading.tags = cleaned;
  return cleaned;
}

/** Sets `heading`'s priority cookie ([#A]/[#B]/[#C]/etc. in the title).
 *  `priority` is either a single letter (any case; normalized to
 *  uppercase, matching how the parser itself stores it) or a falsy
 *  value (null/undefined/'') to clear it entirely. Anything else --
 *  more than one character, a non-letter -- is rejected (returns false,
 *  heading unchanged) rather than silently storing something the
 *  parser/serializer wouldn't round-trip correctly; real org's own
 * @param {Heading} heading
 * @param {string | null} priority
 *  priority cookie is always exactly one character. */
export function setPriority(heading, priority) {
  if (!priority) {
    heading.priority = null;
    return true;
  }
  const normalized = String(priority).trim().toUpperCase();
  if (!/^([A-Z]|\d{1,2})$/.test(normalized)) return false;
  heading.priority = normalized;
  return true;
}

/** `heading`'s SCHEDULED/DEADLINE as editable lines, one per line
 *  (omitting CLOSED — that's auto-managed by marking a task done, not
 *  something this simple editor exposes for hand-editing). A minimal
 *  timestamp editor, not the fuller SCHEDULED/DEADLINE CRUD (repeaters,
 *  a date picker, etc.) that's still to come — this covers "add/edit/
 * @param {Heading} heading
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
 * @param {Heading} heading
 * @param {string} text
 */
export function setPlanningFromText(heading, text) {
  /** @type {string | null} */
  let scheduled = null;
  /** @type {string | null} */
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
 * @param {Heading} heading
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
 * @param {Heading} heading
 * @param {string} raw
 */
export function setPlainTimestampInTitle(heading, raw) {
  const existing = findTimestamps(heading.title).find((t) => t.active);
  if (existing) {
    heading.title = heading.title.replace(existing.raw, raw || '').replace(/\s+/g, ' ').trim();
  } else if (raw) {
    heading.title = (heading.title + ' ' + raw).trim();
  }
}

/** The last heading in document order. @param {Doc} doc @returns {Heading | null} */
function lastHeading(doc) {
  /** @type {Doc | Heading} */
  let node = doc;
  while (node.children.length) node = node.children[node.children.length - 1];
  return node === doc ? null : /** @type {Heading} */ (node);
}

/**
 * The file's final newline is held as an empty last line of the last heading's text, so it has to stay with the end of the
 * file when a heading moves, goes or is added: `edit` runs with it taken off and it goes back on whichever heading is last.
 * @template {(doc: Doc, ...rest: never[]) => unknown} F
 * @param {F} edit
 * @returns {F}
 */
function keepFinalNewline(edit, addMissing = true) {
  return /** @type {F} */ (
    (/** @type {Doc} */ doc, /** @type {unknown[]} */ ...rest) => {
      const before = lastHeading(doc);
      const had = !!before && before.bodyLines.length > 0 && before.bodyLines[before.bodyLines.length - 1] === '';
      if (had && before) before.bodyLines.pop();
      const result = /** @type {(...a: unknown[]) => unknown} */ (edit)(doc, ...rest);
      const after = lastHeading(doc);
      // Emacs ends the file with a newline once a different heading has become the last one
      const adds = !had && addMissing && !!result && after !== before;
      if ((had || adds) && after) after.bodyLines.push('');
      if (adds && after) /** @type {Heading & { eofNewlineAdded?: boolean }} */ (after).eofNewlineAdded = true; // so that taking the heading out again leaves the file as it was
      return result;
    }
  );
}

/**
 * Appends a new top-level (level 1) heading at the end of the document.
 * @param {Doc} doc
 */
export function insertTopLevelHeading(doc, opts = {}, prepend = false) {
  const heading = createHeading({ level: 1, ...opts });
  if (prepend) {
    doc.children.unshift(heading);
  } else {
    doc.children.push(heading);
  }
  return heading;
}

/** Appends (or, if `prepend` is true, prepends) a new child heading
 *  under `parent`, one level deeper, and un-collapses `parent` so the
 *  new child is immediately visible rather than disappearing into a
 * @param {any} [parent]
 *  folded subtree the moment it's created. */
export function insertChildHeading(parent, opts = {}, prepend = false) {
  const heading = createHeading({ level: parent.level + 1, ...opts });
  if (prepend) {
    parent.children.unshift(heading);
  } else {
    parent.children.push(heading);
  }
  parent.collapsed = false;
  return heading;
}

/**
 * Inserts a new sibling heading immediately after `heading`, at the
 * SAME level -- real org's own org-insert-heading (M-RET), which
 * inserts relative to point, not always at the document root the
 * way the "+" toolbar button's own insertTopLevelHeading does. No-op
 * (returns null) if `heading` can't be located in `doc` at all.
 * @param {Doc} doc
 * @param {Heading} heading
 */
function insertHeadingAfterRaw(doc, heading, opts = {}) {
  const located = findContainer(doc, heading);
  if (!located) return null;
  const sibling = createHeading({ level: heading.level, ...opts });
  located.container.splice(located.index + 1, 0, sibling);
  return sibling;
}

/** Removes `heading` from wherever it lives in `doc`. Used by the UI to
 *  discard a just-created heading if the user backs out without typing a
 * @param {Doc} doc
 * @param {Heading} heading
 *  title, rather than leaving an empty, unnamed heading behind. */
function removeHeadingRaw(doc, heading) {
  const located = findContainer(doc, heading);
  if (!located) return false;
  located.container.splice(located.index, 1);
  return true;
}

/**
 * The headings of `doc` in text order. Org's structure commands work on the text, where a subtree is a heading and the lines
 * after it that are deeper, so the edits below work on this list and then rebuild the tree.
 * @param {Doc} doc
 * @returns {Heading[]}
 */
function flatHeadings(doc) {
  /** @type {Heading[]} */
  const out = [];
  /** @param {Heading[]} nodes */
  const walk = (nodes) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(doc.children);
  return out;
}

/** Puts `list` back into `doc` as a tree, nesting by level as the parser does.
 * @param {Doc} doc @param {Heading[]} list */
function rebuildTree(doc, list) {
  doc.children = [];
  for (const h of list) h.children = [];
  /** @type {Heading[]} */
  const stack = [];
  for (const h of list) {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    (stack.length ? stack[stack.length - 1].children : doc.children).push(h);
    stack.push(h);
  }
}

/** One past the last heading of the subtree that starts at `list[i]`. @param {Heading[]} list @param {number} i */
function subtreeEnd(list, i) {
  let j = i + 1;
  while (j < list.length && list[j].level > list[i].level) j++;
  return j;
}

/**
 * Swaps the subtree with the one before it at the same level (org-move-subtree-up). Refuses, returning false, when no heading
 * of that level comes before it under the same parent.
 * @param {Doc} doc
 * @param {Heading} heading
 */
function moveHeadingUpRaw(doc, heading) {
  const list = flatHeadings(doc);
  const i = list.indexOf(heading);
  if (i < 0) return false;
  let p = i - 1;
  while (p >= 0 && list[p].level > heading.level) p--;
  // outline-mode's search for the previous sibling stops at the first heading of a file that starts with one, whatever its level
  const quirk = p < 0 && i > 0 && !doc.keywords.some((k) => !k.virtual) && !(doc.bodyLines || []).length;
  if (quirk) p = 0;
  else if (p < 0 || list[p].level !== heading.level) return false;
  const end = subtreeEnd(list, i);
  rebuildTree(doc, [...list.slice(0, p), ...list.slice(i, end), ...list.slice(p, i), ...list.slice(end)]);
  return true;
}

/**
 * Swaps the subtree with the one after it at the same level (org-move-subtree-down). Refuses, returning false, when none follows
 * under the same parent.
 * @param {Doc} doc
 * @param {Heading} heading
 */
function moveHeadingDownRaw(doc, heading) {
  const list = flatHeadings(doc);
  const i = list.indexOf(heading);
  if (i < 0) return false;
  const end = subtreeEnd(list, i);
  if (end >= list.length || list[end].level !== heading.level) return false;
  const end2 = subtreeEnd(list, end);
  rebuildTree(doc, [...list.slice(0, i), ...list.slice(end, end2), ...list.slice(i, end), ...list.slice(end2)]);
  return true;
}

/**
 * True if `node` is `heading` or lies anywhere inside its subtree.
 * @param {Heading} heading
 * @param {any} [node]
 * @returns {boolean}
 */
function inSubtree(heading, node) {
  if (heading === node) return true;
  return (heading.children || []).some((child) => inSubtree(child, node));
}

/** How many ancestors of `target` a drop "after target" may climb past: one for each level at which target (then that
 * @param {Doc} doc
 * @param {any} [target]
 * @param {Heading | null} [ignore]
 *  ancestor) is the last child, since landing after an ancestor is only the natural reading when nothing follows. */
export function dropClimbLimit(doc, target, ignore = null) {
  let climbs = 0;
  let current = target;
  for (;;) {
    const located = findContainer(doc, current);
    if (!located) break;
    const following = located.container.slice(located.index + 1).filter((/** @type {any} */ node) => node !== ignore); // the heading being moved will not be there
    if (following.length) break;
    const path = findAncestorPath(doc, current);
    if (!path || path.length === 0) break;
    current = path[path.length - 1];
    climbs += 1;
  }
  return climbs;
}

/**
 * Drag and drop: moves `heading` (with its whole subtree) next to or into `target`. `position` is 'before' or 'after'
 * (a sibling of target, at its level), 'firstChild' or 'lastChild' (inside it). For 'after', `climb` steps up that many
 * ancestors first (see dropClimbLimit), landing after the ancestor instead. Returns false and changes nothing when the drop
 * is into the heading's own subtree, names a heading not in the document, or would leave it exactly where it is.
 * @param {Doc} doc
 * @param {Heading} heading
 * @param {any} target
 * @param {string} position
 */
function moveHeadingToRaw(doc, heading, target, position, climb = 0) {
  if (!heading || !target || inSubtree(heading, target)) return false;
  const origin = findContainer(doc, heading);
  if (!origin || !findContainer(doc, target)) return false;
  let anchor = target;
  if (position === 'after') {
    if (climb > dropClimbLimit(doc, target, heading)) return false;
    for (let i = 0; i < climb; i += 1) {
      const path = /** @type {Heading[]} */ (findAncestorPath(doc, anchor));
      anchor = path[path.length - 1];
    }
    if (inSubtree(heading, anchor)) return false;
  }
  const originParent = /** @type {Heading[]} */ (findAncestorPath(doc, heading)).slice(-1)[0] || null;
  const originIndex = origin.index;
  origin.container.splice(origin.index, 1);
  const place = /** @type {{ container: Heading[], index: number }} */ (findContainer(doc, anchor));
  if (position === 'firstChild' || position === 'lastChild') {
    if (position === 'firstChild') anchor.children.unshift(heading);
    else anchor.children.push(heading);
    anchor.collapsed = false; // otherwise the moved heading vanishes from view the instant it lands
    shiftLevels(heading, anchor.level + 1);
  } else {
    place.container.splice(position === 'after' ? place.index + 1 : place.index, 0, heading);
    shiftLevels(heading, anchor.level);
  }
  const now = /** @type {{ container: Heading[], index: number }} */ (findContainer(doc, heading));
  const nowParent = /** @type {Heading[]} */ (findAncestorPath(doc, heading)).slice(-1)[0] || null;
  if (nowParent === originParent && now.index === originIndex) return false; // dropped where it already was
  return true;
}

/**
 * Promotes heading (and its whole subtree) up one level, as Org's `org-promote-subtree` does: the stars lose one and the heading
 * stays where it is in the text. The headings after it that are deeper than it now become its children. Refuses, returning
 * false, at level 1.
 * @param {Doc} doc
 * @param {Heading} heading
 */
function promoteHeadingRaw(doc, heading) {
  const list = flatHeadings(doc);
  const i = list.indexOf(heading);
  if (i < 0 || heading.level <= 1) return false;
  const end = subtreeEnd(list, i);
  for (let j = i; j < end; j++) list[j].level -= 1;
  rebuildTree(doc, list);
  return true;
}

/**
 * Demotes heading (and its whole subtree) down one level, as Org's `org-demote-subtree` does: the stars gain one and the
 * heading stays where it is in the text.  After a sibling it becomes that sibling's last child; as a first child it stays
 * under its parent, a level deeper.
 * @param {Doc} doc
 * @param {Heading} heading
 */
function demoteHeadingRaw(doc, heading) {
  const list = flatHeadings(doc);
  const i = list.indexOf(heading);
  if (i < 0) return false;
  const end = subtreeEnd(list, i);
  for (let j = i; j < end; j++) list[j].level += 1;
  rebuildTree(doc, list);
  const parent = list.slice(0, i).reverse().find((h) => h.level < heading.level);
  if (parent) parent.collapsed = false; // otherwise the demoted heading vanishes from view the instant it moves
  return true;
}

export const insertHeadingAfter = keepFinalNewline(insertHeadingAfterRaw);

const removeHeadingKeepingNewline = keepFinalNewline(removeHeadingRaw);

/** Removes `heading`; a heading that only gave the file its final newline takes it away again. @param {Doc} doc @param {Heading} heading */
export function removeHeading(doc, heading) {
  const wasLast = lastHeading(doc) === heading;
  const hadNewline = wasLast && heading.bodyLines.length > 0 && heading.bodyLines[heading.bodyLines.length - 1] === '';
  const fresh = /** @type {Heading & { eofNewlineAdded?: boolean }} */ (heading).eofNewlineAdded || (!heading.raw && !hadNewline); // made here, not read from the file
  const ok = removeHeadingKeepingNewline(doc, heading);
  const last = lastHeading(doc);
  if (ok && wasLast && fresh && last && last.bodyLines[last.bodyLines.length - 1] === '') last.bodyLines.pop();
  return ok;
}

export const moveHeadingUp = keepFinalNewline(moveHeadingUpRaw);

export const moveHeadingDown = keepFinalNewline(moveHeadingDownRaw);

export const moveHeadingTo = keepFinalNewline(moveHeadingToRaw);

export const promoteHeading = keepFinalNewline(promoteHeadingRaw);

export const demoteHeading = keepFinalNewline(demoteHeadingRaw);

/**
 * org-paste-subtree on `heading`: the subtrees in `text` go in after it, at its level. Returns the pasted headings, or null when
 * `text` holds no heading or `heading` is not in `doc`.
 * @param {Doc} doc
 * @param {Heading} heading
 * @param {string} text
 * @returns {Heading[] | null}
 */
function pasteSubtreeAfterRaw(doc, heading, text) {
  const parsed = parseOrg(text.replace(/\r?\n$/, ''));
  if (!parsed.children || parsed.children.length === 0) return null;
  const located = findContainer(doc, heading);
  if (!located) return null;
  for (const node of parsed.children) shiftLevels(node, heading.level);
  located.container.splice(located.index + 1, 0, ...parsed.children);
  return parsed.children;
}

/**
 * The text org-copy-subtree puts on the clipboard: the heading and its subtree, every line ended with a newline.
 * @param {Doc} doc
 * @param {Heading} heading
 */
export function subtreeText(doc, heading) {
  const text = serializeHeadingSubtree(heading);
  const last = lastHeading(doc);
  return last && inSubtree(heading, last) && text.endsWith('\n') ? text : text + '\n'; // the last heading's own text already ends the file
}

export const pasteSubtreeAfter = keepFinalNewline(pasteSubtreeAfterRaw, false);
