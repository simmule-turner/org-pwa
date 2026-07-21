
/**
 * Archive data model & operations.
 *
 * Built first, ahead of the parser, so the AST shape the parser produces is
 * designed around what archiving actually needs (parent-lookup, property
 * drawers with stable ordering, tag lists) rather than retrofitted later.
 *
 * AST shape assumed (see src/org-parser.js for the producer):
 *
 *   HeadingNode = {
 *     type: 'heading',
 *     level: number,
 *     todo: string|null,
 *     priority: string|null,      // 'A' | 'B' | 'C' | ...
 *     title: string,
 *     tags: string[],
 *     planning: { scheduled: string|null, deadline: string|null, closed: string|null },
 *     properties: { [key: string]: string },
 *     propertyOrder: string[],    // preserves original :PROPERTIES: drawer order
 *     bodyLines: string[],        // raw section content between heading/drawer and next heading
 *     body: Node[],               // parsed content (lists/tables/blocks/paragraphs) derived from bodyLines — see body-parser.js
 *     collapsed: boolean,         // fold/UI state — see fold-state.js
 *     children: HeadingNode[],
 *   }
 *
 *   DocumentNode = {
 *     type: 'document',
 *     keywords: [{ key: string, value: string }],
 *     bodyLines: string[],
 *     body: Node[],
 *     children: HeadingNode[],
 *   }
 */

const ARCHIVE_TAG = 'ARCHIVE';

// ---- small AST helpers -----------------------------------------------

function setProperty(heading, key, value) {
  if (!(key in heading.properties)) {
    heading.propertyOrder.push(key);
  }
  heading.properties[key] = value;
}

function deleteProperty(heading, key) {
  if (key in heading.properties) {
    delete heading.properties[key];
    heading.propertyOrder = heading.propertyOrder.filter((k) => k !== key);
  }
}

function cloneHeading(heading) {
  // structuredClone is fine here: the AST is plain data, no functions/cycles.
  return structuredClone(heading);
}

/**
 * Depth-first search for `target` (by reference) inside `doc`/`root`.
 * Returns the path of ancestor headings from outermost to innermost,
 * NOT including `target` itself. Returns null if not found.
 */
function findAncestorPath(root, target, path = []) {
  const children = root.children || [];
  for (const child of children) {
    if (child === target) return path;
    const found = findAncestorPath(child, target, [...path, child]);
    if (found) return found;
  }
  return null;
}

/**
 * Finds the array that directly contains `target` and its index within it,
 * so callers can splice it out or replace it in place.
 */
function findContainer(root, target) {
  const children = root.children || [];
  const idx = children.indexOf(target);
  if (idx !== -1) return { container: children, index: idx };
  for (const child of children) {
    const found = findContainer(child, target);
    if (found) return found;
  }
  return null;
}

/** Shifts a subtree's level (and all descendants') by newLevel - node.level. */
function shiftLevels(node, newLevel) {
  const delta = newLevel - node.level;
  const walk = (n) => {
    n.level += delta;
    for (const c of n.children || []) walk(c);
  };
  walk(node);
}

/** Org inactive timestamp, e.g. [2026-07-20 Mon 14:32] */
function formatOrgTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const dow = days[date.getDay()];
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `[${y}-${m}-${d} ${dow} ${hh}:${mm}]`;
}

// ---- archive operations -----------------------------------------------

function isArchivedInPlace(heading) {
  return heading.tags.includes(ARCHIVE_TAG);
}

/** True for anything that's been archived, either in-place or by having
 *  landed in an archive file (identified by ARCHIVE_* properties). */
function isArchived(heading) {
  return isArchivedInPlace(heading) || 'ARCHIVE_TIME' in heading.properties;
}

/**
 * Archive-in-place: tag the heading :ARCHIVE: and stamp ARCHIVE_TIME.
 * The subtree stays where it is; view layer is responsible for hiding
 * archived subtrees from agenda/TODO views by default (see requirements §7/§10).
 */
function archiveInPlace(heading, { now = new Date() } = {}) {
  if (!isArchivedInPlace(heading)) {
    heading.tags = [...heading.tags, ARCHIVE_TAG];
  }
  setProperty(heading, 'ARCHIVE_TIME', formatOrgTimestamp(now));
  return heading;
}

/** Reverses archiveInPlace. Leaves ARCHIVE_TIME in place as a history
 *  breadcrumb rather than deleting it — deleting it silently would erase
 *  the fact that this was ever archived. */
function unarchiveInPlace(heading) {
  heading.tags = heading.tags.filter((t) => t !== ARCHIVE_TAG);
  return heading;
}

/**
 * Archive-to-sibling-file: removes `heading` from `sourceDoc` and returns a
 * clone stamped with ARCHIVE_TIME / ARCHIVE_FILE / ARCHIVE_OLPATH /
 * ARCHIVE_CATEGORY (and, if markDone, ARCHIVE_TODO), ready to be appended to
 * an archive document via appendToArchive().
 *
 * This does not touch `archiveDoc` itself — callers decide when/how to
 * persist the archive file (it may not even be open yet), matching the
 * "archive file is just another file" framing from §7 of the requirements.
 */
function extractForArchive(sourceDoc, heading, sourceFilePath, opts = {}) {
  const { now = new Date(), markDone = false, doneKeyword = 'DONE' } = opts;

  const ancestors = findAncestorPath(sourceDoc, heading);
  if (ancestors === null) {
    throw new Error('extractForArchive: heading not found in sourceDoc');
  }
  const olpath = ancestors.map((h) => h.title).join('/');
  const category = ancestors.length > 0 ? ancestors[0].title : (heading.title || null);

  const clone = cloneHeading(heading);

  setProperty(clone, 'ARCHIVE_TIME', formatOrgTimestamp(now));
  setProperty(clone, 'ARCHIVE_FILE', sourceFilePath);
  setProperty(clone, 'ARCHIVE_OLPATH', olpath);
  setProperty(clone, 'ARCHIVE_CATEGORY', category);

  if (markDone && clone.todo) {
    setProperty(clone, 'ARCHIVE_TODO', clone.todo);
    clone.todo = doneKeyword;
  }

  const located = findContainer(sourceDoc, heading);
  if (!located) {
    throw new Error('extractForArchive: could not locate heading container');
  }
  located.container.splice(located.index, 1);

  return clone;
}

/**
 * Appends an extracted subtree to an archive document as a new top-level
 * entry, shifting its level (and its descendants') to level 1 so nesting
 * inside the original document doesn't leak into the archive file's own
 * heading depth.
 */
function appendToArchive(archiveDoc, extractedHeading) {
  shiftLevels(extractedHeading, 1);
  archiveDoc.children.push(extractedHeading);
  return archiveDoc;
}

/**
 * Convenience wrapper: archive `heading` out of `sourceDoc` and into
 * `archiveDoc` in one call.
 */
function archiveToSiblingFile(sourceDoc, archiveDoc, heading, sourceFilePath, opts = {}) {
  const extracted = extractForArchive(sourceDoc, heading, sourceFilePath, opts);
  appendToArchive(archiveDoc, extracted);
  return extracted;
}

/**
 * Un-archive from a sibling archive file: removes the heading from
 * archiveDoc and returns a clone with ARCHIVE_* properties stripped,
 * restoring ARCHIVE_TODO as the live todo state if present. Caller is
 * responsible for re-inserting the returned node into the target document
 * (e.g. at top level, or under a heading matching ARCHIVE_OLPATH — the
 * requirements leave "where exactly it lands" as a UI decision, not a data
 * model one).
 */
function restoreFromArchive(archiveDoc, heading) {
  const located = findContainer(archiveDoc, heading);
  if (!located) {
    throw new Error('restoreFromArchive: heading not found in archiveDoc');
  }
  located.container.splice(located.index, 1);

  const clone = cloneHeading(heading);
  if ('ARCHIVE_TODO' in clone.properties) {
    clone.todo = clone.properties.ARCHIVE_TODO;
  }
  for (const key of ['ARCHIVE_TIME', 'ARCHIVE_FILE', 'ARCHIVE_OLPATH', 'ARCHIVE_CATEGORY', 'ARCHIVE_TODO']) {
    deleteProperty(clone, key);
  }
  return clone;
}

export {
  ARCHIVE_TAG,
  setProperty,
  deleteProperty,
  cloneHeading,
  findAncestorPath,
  findContainer,
  shiftLevels,
  formatOrgTimestamp,
  isArchivedInPlace,
  isArchived,
  archiveInPlace,
  unarchiveInPlace,
  extractForArchive,
  appendToArchive,
  archiveToSiblingFile,
  restoreFromArchive,
};
