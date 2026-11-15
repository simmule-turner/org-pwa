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
import { parseOrg, serializeOrg, serializeHeadingSubtree, serializeHeadingLine, headingPreambleLines, headingLineIndex } from './org-parser.js';
import { parseBody } from './body-parser.js';
import { fixupIndentation } from './indent-fixup.js';
import { getAdaptIndentation, getAutoAlignTags, getSrcPreserveIndentation } from './indent-settings.js';
import { blankBeforeNew } from './blank-before-entry.js';

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
 * org--blank-before-heading-p with `org-blank-before-new-entry` at its default (auto): whether the heading `heading` has an empty
 * line above it, which is whether a new heading beside it gets one too. A heading on the first line looks at the next heading instead,
 * or, with none, at the end of the file.
 * @param {Doc} doc
 * @param {Heading} heading
 * @returns {boolean}
 */
function blankBeforeNewEntry(doc, heading) {
  return blankBeforeNew('heading', () => blankBeforeAuto(doc, heading));
}

/** @param {Doc} doc @param {Heading} heading @returns {boolean} */
function blankBeforeAuto(doc, heading) {
  const text = serializeOrg(doc);
  const lines = text.split('\n');
  const at = headingLineIndex(doc).lines.get(heading);
  if (!at) return false;
  const blank = (/** @type {number} */ n) => n > 0 && /^[ \t]*$/.test(lines[n - 1]);
  if (at.line > 0) return blank(at.line);
  const after = lines.findIndex((l, j) => j > 0 && /^\*+ /.test(l));
  if (after > 0) return blank(after);
  const trimmedEnd = text.replace(/[ \t]+$/, ''); // the end of the file, when that is the start of a line: the line above it
  if (trimmedEnd.length === 0 || trimmedEnd.endsWith('\n')) {
    const end = trimmedEnd.split('\n');
    return end.length >= 2 && /^[ \t]*$/.test(end[end.length - 2]);
  }
  return false;
}

/**
 * Inserts a new sibling heading immediately after `heading`'s subtree, at the
 * SAME level -- real org's own org-insert-heading with C-u (M-RET): the empty lines before the new heading
 * are made one when the heading has one above it (org-blank-before-new-entry, auto), else none. No-op
 * (returns null) if `heading` can't be located in `doc` at all.
 * @param {Doc} doc
 * @param {Heading} heading
 * @param {Record<string, any>} [opts]
 * @param {boolean} [blank] whether an empty line goes before the new heading
 */
function insertHeadingAfterRaw(doc, heading, opts = {}, blank = false) {
  const located = findContainer(doc, heading);
  if (!located) return null;
  const sibling = createHeading({ level: heading.level, ...opts });
  /** @type {Heading} */
  let owner = heading;
  while (owner.children.length > 0) owner = owner.children[owner.children.length - 1];
  const lines = owner.bodyLines;
  const emptyAbove = lines.length > 0 && /^[ \t]*$/.test(lines[lines.length - 1]);
  if (!(blank && emptyAbove)) {
    while (lines.length > 0 && /^[ \t]*$/.test(lines[lines.length - 1])) lines.pop(); // org-N-empty-lines-before-current
    if (blank) lines.push('');
  }
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

/**
 * Makes `lines` the text under the line of `heading` (planning line, drawers and body, as they would read in a file), keeping its
 * heading line fields, so an edit made on the text can be applied to the heading in place.
 * @param {Heading} heading
 * @param {string[]} lines
 * @param {string} header  the heading line as it is written now
 */
function adoptSectionLines(heading, lines, header) {
  const parsed = parseOrg(['* x', ...lines].join('\n')).children[0];
  heading.planning = parsed.planning;
  heading.properties = parsed.properties;
  heading.propertyOrder = parsed.propertyOrder;
  heading.logbookLines = parsed.logbookLines;
  heading.preLogLines = parsed.preLogLines;
  heading.bodyLines = parsed.bodyLines;
  heading.body = parsed.body;
  const raw = /** @type {NonNullable<Heading['raw']>} */ (parsed.raw);
  raw.header = header;
  raw.headerSig = serializeHeadingLine(heading, 0);
  heading.raw = raw;
}

/**
 * org-insert-property-drawer: an empty property drawer under the heading line (under the planning line, when there is one), unless one
 * is there; indented as org-adapt-indentation says. Returns false when there already is one.
 * @param {Doc} doc
 * @param {Heading} heading
 */
function insertPropertyDrawerRaw(doc, heading) {
  const preamble = headingPreambleLines(heading);
  const rest = [...preamble.slice(1), ...heading.bodyLines];
  const at = rest.length && /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/.test(rest[0]) ? 1 : 0;
  if (at < rest.length && /^[ \t]*:PROPERTIES:[ \t]*$/i.test(rest[at])) return false;
  const indent = at ? /^[ \t]*/.exec(rest[0])?.[0] ?? '' : getAdaptIndentation() === 'nil' ? '' : ' '.repeat(heading.level + 1); // like the planning line above it, else as adapting indentation says
  const lines = [...rest.slice(0, at), `${indent}:PROPERTIES:`, `${indent}:END:`, ...rest.slice(at)];
  if (lastHeading(doc) === heading && heading.bodyLines.length === 0 && rest.length === at) lines.push(''); // the file ends with a line break now
  adoptSectionLines(heading, lines, preamble[0]);
  return true;
}

/** org-insert-property-drawer (see insertPropertyDrawerRaw). @param {Doc} doc @param {Heading} heading */
export const insertPropertyDrawer = keepFinalNewline(insertPropertyDrawerRaw, false);

/**
 * org-toggle-comment: puts COMMENT first in the title, or takes it off. Returns whether the heading is commented now.
 * @param {Heading} heading
 */
export function toggleComment(heading) {
  const was = /^COMMENT(\s|$)/.test(heading.title);
  const old = headingPreambleLines(heading)[0];
  let at = heading.level;
  const after = (/** @type {RegExp} */ re) => {
    const m = re.exec(old.slice(at));
    if (m) at += m[0].length;
  };
  if (heading.todo) after(new RegExp(`^[ \\t]+${heading.todo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[ \\t]|$)`));
  if (heading.priority) after(/^[ \t]+\[#.\]/);
  at += /^[ \t]*/.exec(old.slice(at))?.[0].length ?? 0;
  let text = old;
  if (!/[ \t]/.test(text[at - 1] ?? '')) {
    text = `${text.slice(0, at)} ${text.slice(at)}`;
    at += 1;
  }
  if (was) text = text.slice(0, at) + text.slice(at).replace(/^[^ ]* ?[ \t]*/, '');
  else text = text.slice(0, at) + 'COMMENT' + (at < text.length ? ' ' : '') + text.slice(at);
  heading.title = was ? heading.title.replace(/^COMMENT[ \t]*/, '') : heading.title ? `COMMENT ${heading.title}` : 'COMMENT';
  const raw = heading.raw || /** @type {NonNullable<Heading['raw']>} */ ({ header: '', headerSig: '', planning: null, planningSig: null, drawers: [], propertyLines: {}, propsSig: '', logSig: '' });
  raw.header = text;
  raw.headerSig = serializeHeadingLine(heading, 0);
  heading.raw = raw;
  return !was;
}

/**
 * org-promote / org-demote: only the heading line changes level, its children keep theirs (the ones now deeper than it become its
 * children, the others its siblings). The text under the heading follows as `org-adapt-indentation` says, and the tags are aligned
 * again when `org-auto-align-tags` is set. Refuses (false) to promote at level 1.
 * @param {Doc} doc
 * @param {Heading} heading
 * @param {1 | -1} delta
 */
function shiftOneHeading(doc, heading, delta) {
  const list = flatHeadings(doc);
  const i = list.indexOf(heading);
  if (i < 0 || (delta < 0 && heading.level <= 1)) return false;
  const preamble = headingPreambleLines(heading);
  const old = preamble[0];
  const rest = [...preamble.slice(1), ...heading.bodyLines];
  const was = heading.level;
  heading.level += delta;
  const adapt = getAdaptIndentation();
  const lines = adapt === 'nil' ? rest : fixupIndentation(rest, delta, heading.level, adapt, getSrcPreserveIndentation());
  if (lines.some((l, k) => l !== rest[k])) adoptSectionLines(heading, lines, old);
  else if (!heading.raw) adoptSectionLines(heading, rest, old);
  const raw = /** @type {NonNullable<Heading['raw']>} */ (heading.raw);
  if (getAutoAlignTags() && heading.tags && heading.tags.length) {
    raw.header = serializeHeadingLine(heading);
  } else {
    raw.header = '*'.repeat(heading.level) + old.slice(was);
  }
  raw.headerSig = serializeHeadingLine(heading, 0);
  rebuildTree(doc, list);
  if (delta > 0) {
    const parent = list.slice(0, i).reverse().find((h) => h.level < heading.level);
    if (parent) parent.collapsed = false; // otherwise the demoted heading vanishes from view the instant it moves
  }
  return true;
}

/** org-promote: promotes only `heading` (see shiftOneHeading). @param {Doc} doc @param {Heading} heading */
export const promoteHeadingOnly = keepFinalNewline((/** @type {Doc} */ doc, /** @type {Heading} */ heading) => shiftOneHeading(doc, heading, -1));

/** org-demote: demotes only `heading` (see shiftOneHeading). @param {Doc} doc @param {Heading} heading */
export const demoteHeadingOnly = keepFinalNewline((/** @type {Doc} */ doc, /** @type {Heading} */ heading) => shiftOneHeading(doc, heading, 1));

const insertHeadingAfterKeepingNewline = keepFinalNewline(insertHeadingAfterRaw);

/** Inserts a new sibling heading after the subtree of `heading` (see insertHeadingAfterRaw). @param {Doc} doc @param {Heading} heading @param {Record<string, any>} [opts] */
export function insertHeadingAfter(doc, heading, opts = {}) {
  return insertHeadingAfterKeepingNewline(doc, heading, opts, blankBeforeNewEntry(doc, heading));
}

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
 * org-paste-subtree with point on `heading`: the subtrees in `text` go in before the next visible heading (the first child of `heading`
 * when it is not folded), at the level of `heading` or, with a numeric prefix, at `level`. On a heading that is nothing but its stars,
 * with point after them (`atStars`) and no `level`, the stars go and the empty line stays; the heading's own text and children then
 * come before the subtrees. With point at the start of the heading line (`atBol`) they go in before the heading. The kill must be a
 * subtree (starts with a heading, no heading shallower than the first); otherwise null. Returns the pasted headings.
 * @param {Doc} doc
 * @param {Heading} heading
 * @param {string} text
 * @param {number} [level]
 * @param {boolean} [atStars] point is after the stars of `heading`, which is nothing else
 * @param {boolean} [lineBreak] whether the line of `heading` ends with a line break (the last one of a file may not)
 * @param {boolean} [atBol] point is at the start of the line of `heading`
 * @returns {Heading[] | null}
 */
function pasteSubtreeAfterRaw(doc, heading, text, level, atStars = false, lineBreak = true, atBol = false) {
  const parsed = parseOrg(text.replace(/\r?\n$/, ''));
  const trees = flatHeadings(parsed);
  if (trees.length === 0 || parsed.keywords.length || parsed.bodyLines.some((l) => !/^[ \t\r]*$/.test(l))) return null;
  const oldLevel = trees[0].level;
  if (trees.some((h) => h.level < oldLevel)) return null;
  const list = flatHeadings(doc);
  const i = list.indexOf(heading);
  if (i < 0) return null;
  const bare = atStars && !atBol && level === undefined && heading.title === '' && !heading.todo && !heading.priority && heading.tags.length === 0;
  // without a level of its own the subtree gets the larger of the levels of the previous visible heading and of this one
  /** @type {number} */
  let previousLevel;
  if (i === 0) previousLevel = doc.keywords.length || doc.bodyLines.length ? 1 : heading.level;
  else {
    let k = i - 1;
    const hidden = (/** @type {number} */ n) => list.some((a, ai) => ai < n && a.collapsed && n < subtreeEnd(list, ai));
    while (k > 0 && hidden(k)) k--;
    previousLevel = list[k].level;
  }
  const newLevel = level ?? (atBol || bare ? heading.level : Math.max(previousLevel, heading.level));
  const shift = newLevel - oldLevel;
  for (let k = 0; k < Math.abs(shift); k++) for (const h of flatHeadings(parsed)) shiftOneHeading(parsed, h, shift > 0 ? 1 : -1);
  const lead = parsed.bodyLines.length ? parsed.bodyLines : [];
  const pasted = flatHeadings(parsed);
  /** @type {number} */
  let at;
  if (atBol) at = i;
  else if (bare) {
    const lines = [...(lineBreak ? [''] : []), ...headingPreambleLines(heading).slice(1), ...heading.bodyLines];
    const before = i > 0 ? list[i - 1] : doc;
    before.bodyLines.push(...lines);
    before.body = parseBody(before.bodyLines);
    at = heading.collapsed ? subtreeEnd(list, i) : i + 1;
    list.splice(i, 1);
    at -= 1;
  } else at = heading.collapsed ? subtreeEnd(list, i) : i + 1;
  const prev = at > 0 ? list[at - 1] : doc;
  if (lead.length) {
    prev.bodyLines.push(...lead);
    prev.body = parseBody(prev.bodyLines);
  }
  list.splice(at, 0, ...pasted);
  rebuildTree(doc, list);
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

const pasteSubtreeAfterKeepingNewline = keepFinalNewline(pasteSubtreeAfterRaw, false);

/** org-paste-subtree on `heading` (see pasteSubtreeAfterRaw). @param {Doc} doc @param {Heading} heading @param {string} text @param {number} [level] @param {boolean} [atStars] @param {boolean} [atBol] */
export function pasteSubtreeAfter(doc, heading, text, level, atStars = false, atBol = false) {
  const last = lastHeading(doc);
  const lineBreak = last !== heading || (heading.bodyLines.length > 0 && heading.bodyLines[heading.bodyLines.length - 1] === ''); // the last line of a file may end without one
  return pasteSubtreeAfterKeepingNewline(doc, heading, text, level, atStars, lineBreak, atBol);
}
