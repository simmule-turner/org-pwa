
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
 *     bodyHidden: boolean,        // body-content visibility, independent of collapsed — see fold-state.js
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

/** Finds the ACTUAL key in `properties` that case-insensitively matches
 *  `key` (org-mode property names are case-insensitive, confirmed
 *  directly against real Emacs org-mode -- org-entry-get/org-entry-put
 *  both match "CUSTOM_ID" against an existing "custom_id" the same
 *  way), or null if none exists. Every property read/write in this
 *  app goes through this (or getProperty below) rather than a direct
 *  `properties[key]` lookup, so a differently-cased existing property
 *  is never silently missed or duplicated. */
function findPropertyKey(properties, key) {
  if (key in properties) return key; // fast path: exact match, the overwhelmingly common case
  const lower = key.toLowerCase();
  for (const existing in properties) {
    if (existing.toLowerCase() === lower) return existing;
  }
  return null;
}

/** Case-insensitive property read -- `heading.properties.CUSTOM_ID`
 *  and `heading.properties.custom_id` are the same property as far as
 *  real org is concerned; this returns undefined if neither is set,
 *  matching a direct property-object lookup's own undefined-for-
 *  missing convention. */
function getProperty(heading, key) {
  if (!heading.properties) return undefined;
  const foundKey = findPropertyKey(heading.properties, key);
  return foundKey === null ? undefined : heading.properties[foundKey];
}

function setProperty(heading, key, value) {
  const existingKey = findPropertyKey(heading.properties, key);
  if (existingKey === null) {
    heading.propertyOrder.push(key);
    heading.properties[key] = value;
    return;
  }
  if (existingKey === key) {
    heading.properties[key] = value;
    return;
  }
  // An existing property with different-case key: replace it in place
  // (own position preserved, own key text updated to the caller's
  // case) rather than appending a new, duplicate entry -- matching
  // real org's own confirmed org-entry-put behavior exactly.
  delete heading.properties[existingKey];
  heading.properties[key] = value;
  heading.propertyOrder = heading.propertyOrder.map((k) => (k === existingKey ? key : k));
}

function deleteProperty(heading, key) {
  const existingKey = findPropertyKey(heading.properties, key);
  if (existingKey !== null) {
    delete heading.properties[existingKey];
    heading.propertyOrder = heading.propertyOrder.filter((k) => k !== existingKey);
  }
}

/** All of `heading`'s properties as `key: value` lines, one per property,
 *  in their original drawer order — for showing in a single editable text
 *  block (the same pattern already used for a heading's combined body
 *  text), rather than a bespoke per-row add/edit/delete property UI. */
function getPropertiesText(heading) {
  return heading.propertyOrder.map((key) => `${key}: ${heading.properties[key]}`).join('\n');
}

/**
 * Replaces `heading`'s entire property set from `text` (the same
 * `key: value` per line format getPropertiesText produces) — this is a
 * full replace, not a merge: a property missing from `text` is deleted,
 * matching what "edit this text block and save it" should mean. Lines
 * with no `:` are silently skipped rather than throwing, since a
 * half-finished edit (still typing a new property's key) shouldn't crash
 * the save. A key containing whitespace has the whitespace collapsed to
 * underscores, since org property-drawer keys can't contain spaces.
 */
function setPropertiesFromText(heading, text) {
  const properties = {};
  const propertyOrder = [];
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim().replace(/\s+/g, '_');
    const value = line.slice(colonIndex + 1).trim();
    if (!key) continue;
    if (!(key in properties)) propertyOrder.push(key);
    properties[key] = value;
  }
  heading.properties = properties;
  heading.propertyOrder = propertyOrder;
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

/** Org's own ARCHIVE_TIME format: a BARE date/day-name/time string,
 *  deliberately NOT wrapped in brackets at all -- confirmed directly
 *  against real, observed org-archive output (independent real-world
 *  examples: ":ARCHIVE_TIME: 2020-09-12 Sat 11:52" /
 *  ":ARCHIVE_TIME: 2017-01-02 Mon 19:41") and against the actual
 *  mechanism in real org's own org-archive.el source
 *  (org-set-property "ARCHIVE_TIME" using the ACTIVE
 *  org-time-stamp-formats entry with its own enclosing angle brackets
 *  explicitly stripped via (substring ... 1 -1) before use) -- the
 *  result is genuinely neither an active nor an inactive org
 *  timestamp, just plain text that happens to look like one. */
function formatOrgTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const dow = days[date.getDay()];
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d} ${dow} ${hh}:${mm}`;
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
 * Builds the stamped, ready-to-insert clone of `heading` for archiving
 * -- everything extractForArchive does EXCEPT removing the original
 * from sourceDoc. Deliberately non-mutating: safe to call before
 * knowing whether the actual archive destination write will succeed,
 * so a cross-file archive (see app.js) can attempt that write FIRST
 * and only remove the original afterward, once the write has actually
 * succeeded -- a network failure or permission problem can then never
 * silently lose the heading.
 */
function buildArchivedClone(sourceDoc, heading, sourceFilePath, opts = {}) {
  const { now = new Date(), markDone = false, doneKeyword = 'DONE' } = opts;

  const ancestors = findAncestorPath(sourceDoc, heading);
  if (ancestors === null) {
    throw new Error('buildArchivedClone: heading not found in sourceDoc');
  }
  const olpath = ancestors.map((h) => h.title).join('/');
  const category = ancestors.length > 0 ? ancestors[0].title : heading.title || null;

  const clone = cloneHeading(heading);

  if (!clone.tags.includes(ARCHIVE_TAG)) {
    clone.tags = [...clone.tags, ARCHIVE_TAG];
  }
  setProperty(clone, 'ARCHIVE_TIME', formatOrgTimestamp(now));
  setProperty(clone, 'ARCHIVE_FILE', sourceFilePath);
  setProperty(clone, 'ARCHIVE_OLPATH', olpath);
  setProperty(clone, 'ARCHIVE_CATEGORY', category);

  // Real org's own default org-archive-save-context-info is
  // '(time file olpath category todo itags) -- ARCHIVE_TODO records
  // the PRE-ARCHIVE state whenever the heading actually has one,
  // independent of markDone (a separate, additional org-archive-
  // mark-done concern: whether archiving ALSO forces the heading to
  // DONE). The two were previously conflated into a single
  // condition, meaning ARCHIVE_TODO never got recorded at all
  // wherever markDone wasn't explicitly requested.
  if (clone.todo) {
    setProperty(clone, 'ARCHIVE_TODO', clone.todo);
  }
  if (markDone && clone.todo) {
    clone.todo = doneKeyword;
  }

  // ARCHIVE_ITAGS: the tags the subtree INHERITS from further up the
  // hierarchy -- ancestors' own tags, not the heading's own local
  // ones (those are already preserved as-is on the clone itself, tags
  // aren't stripped when archiving). Colon-delimited, matching real
  // org's own tag-storage convention everywhere else (":tag1:tag2:").
  // Omitted entirely when there's nothing to record, rather than
  // stamping an empty, meaningless value.
  const inheritedTags = [...new Set(ancestors.flatMap((h) => h.tags || []))];
  if (inheritedTags.length > 0) {
    setProperty(clone, 'ARCHIVE_ITAGS', ':' + inheritedTags.join(':') + ':');
  }

  return clone;
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
 *
 * Built on buildArchivedClone (clone+stamp) followed by the actual
 * removal -- kept as this one combined convenience function for
 * existing callers that don't need buildArchivedClone's own
 * non-mutating write-before-remove safety separately.
 */
function extractForArchive(sourceDoc, heading, sourceFilePath, opts = {}) {
  const clone = buildArchivedClone(sourceDoc, heading, sourceFilePath, opts);

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
/**
 * Builds the restored, un-stamped clone of an archived `heading` --
 * everything restoreFromArchive does EXCEPT removing the original from
 * archiveDoc. Deliberately non-mutating, same reasoning as
 * buildArchivedClone: safe to call before knowing whether the actual
 * restore destination write will succeed, so a cross-file restore can
 * attempt that write FIRST and only remove the archived original
 * afterward, once it has actually succeeded.
 *
 * Restores the original TODO state from ARCHIVE_TODO if present, strips
 * every ARCHIVE_* property this app ever stamps, and removes the
 * ARCHIVE tag -- a restored heading must not stay tagged archived once
 * it's back in a live document.
 */
function buildRestoredClone(heading) {
  const clone = cloneHeading(heading);
  const archiveTodo = getProperty(clone, 'ARCHIVE_TODO');
  if (archiveTodo !== undefined) {
    clone.todo = archiveTodo;
  }
  for (const key of ['ARCHIVE_TIME', 'ARCHIVE_FILE', 'ARCHIVE_OLPATH', 'ARCHIVE_CATEGORY', 'ARCHIVE_TODO', 'ARCHIVE_ITAGS']) {
    deleteProperty(clone, key);
  }
  unarchiveInPlace(clone);
  return clone;
}

/** Removes `heading` from `archiveDoc` and returns its restored clone
 *  (built via buildRestoredClone) -- the combined convenience wrapper,
 *  same relationship buildArchivedClone/extractForArchive already
 *  have to each other. */
function restoreFromArchive(archiveDoc, heading) {
  const clone = buildRestoredClone(heading);
  const located = findContainer(archiveDoc, heading);
  if (!located) {
    throw new Error('restoreFromArchive: heading not found in archiveDoc');
  }
  located.container.splice(located.index, 1);
  return clone;
}

/** Real org's own documented default for org-archive-location: a
 *  sibling file named after the current one with "_archive" appended
 *  (e.g. "notes.org" -> "notes.org_archive"), archived as top-level
 *  entries within it. */
const DEFAULT_ARCHIVE_LOCATION = '%s_archive::';

/**
 * Splits an org-archive-location string ("%s_archive::", "::* Archived
 * Tasks", "~/org/archive.org::* %s", etc.) into { filePart,
 * headlinePart } on the first "::" -- real org's own two-part
 * convention exactly. Either half can be empty: an empty filePart
 * means "archive within the current file," an empty headlinePart means
 * "archive at that file's top level." A location with no "::" at all
 * is treated as filePart-only with an empty headlinePart, rather than
 * throwing on malformed input.
 */
function parseArchiveLocation(location) {
  const idx = String(location).indexOf('::');
  if (idx === -1) return { filePart: String(location), headlinePart: '' };
  return { filePart: location.slice(0, idx), headlinePart: location.slice(idx + 2) };
}

/**
 * Resolves a location's filePart to an actual target file id, given the
 * CURRENT file's own id -- used both for the %s substitution itself
 * and for placing a %s-substituted sibling file in the same directory
 * as the current one. Returns null for "archive within the current
 * file" (an empty filePart).
 *
 * %s becomes the current file's own basename WITH its extension (e.g.
 * "notes.org" -- the default "%s_archive::" therefore produces
 * "notes.org_archive", matching real org's well-known convention of an
 * archive file ending in ".org_archive", not ".org").
 *
 * A filePart that doesn't contain %s and already looks like a path
 * (contains "/") is used as a literal file id on the same backend as
 * the current file; this app has no notion of an Emacs-style `~/` home
 * directory to expand, so a location like "~/org/archive.org" is
 * passed through as-is and needs to already be a valid id/path for
 * whichever storage backend (local/GitHub/WebDAV) is actually active.
 */
function resolveArchiveFileId(filePart, currentFileId) {
  if (!filePart) return null;
  const lastSlash = currentFileId ? currentFileId.lastIndexOf('/') : -1;
  const dir = lastSlash === -1 ? '' : currentFileId.slice(0, lastSlash + 1);
  const basename = !currentFileId ? 'untitled' : lastSlash === -1 ? currentFileId : currentFileId.slice(lastSlash + 1);
  if (filePart.includes('%s')) {
    const substituted = filePart.split('%s').join(basename);
    return substituted.includes('/') ? substituted : dir + substituted;
  }
  return filePart;
}

/**
 * Determines the effective org-archive-location for `heading`, in real
 * org's own priority order: the heading's own `ARCHIVE` property (a
 * per-subtree override) first, then the file's `#+ARCHIVE:` keyword,
 * then DEFAULT_ARCHIVE_LOCATION. Real org has a further fallback below
 * the file keyword to a global Emacs variable of the same name -- not
 * meaningful here, since this app has no persistent Emacs-style global
 * configuration that would exist outside any particular file.
 */
function getArchiveLocation(doc, heading) {
  const ownArchive = getProperty(heading, 'ARCHIVE');
  if (ownArchive) return ownArchive;
  const kw = (doc.keywords || []).find((k) => k.key.toUpperCase() === 'ARCHIVE');
  if (kw) return kw.value;
  return DEFAULT_ARCHIVE_LOCATION;
}

/** A blank heading shape matching the AST documented at the top of this
 *  file exactly -- hand-rolled here rather than imported from
 *  heading-edit.js's own createHeading, since heading-edit.js already
 *  imports FROM this file (findContainer/findAncestorPath/shiftLevels),
 *  and importing back would create a circular dependency between the
 *  two modules. */
function blankArchiveTargetHeading(title, level) {
  return {
    type: 'heading',
    level,
    todo: null,
    priority: null,
    title,
    tags: [],
    planning: { scheduled: null, deadline: null, closed: null },
    properties: {},
    propertyOrder: [],
    bodyLines: [],
    body: [],
    collapsed: false,
    bodyHidden: false,
    drawersHidden: true,
    children: [],
  };
}

/**
 * Inserts `extractedHeading` into `targetDoc` per `headlinePart` (the
 * second half of a parsed archive location). A blank headlinePart
 * appends as a new top-level entry (appendToArchive's own existing,
 * simpler behavior). Otherwise headlinePart names a target heading --
 * its own leading asterisk COUNT is the target's own intended level,
 * matching real org's own actual documented behavior exactly (its
 * own example: "basement::** Finished Tasks" archives "as level 3
 * trees below the level 2 heading" -- the two asterisks specifically
 * mean level 2, not merely "some heading called Finished Tasks"):
 * an existing heading anywhere in `targetDoc` (not just top-level --
 * a level-2 target could itself be nested under some other level-1
 * heading already) at that exact level with that exact title gets the
 * extracted subtree appended as its last child; if none exists yet,
 * one is created fresh at that same level and appended to the
 * document's own top level (org's own outline model has no strict
 * requirement that a heading's own level match its literal nesting
 * depth -- a level-2 heading can legally exist with no level-1
 * parent immediately before it, the same flexibility this mirrors).
 * A multi-segment "A/B"-style outline path is NOT a real
 * org-archive-location feature at all (the only documented "/" usage
 * is the special, unrelated "datetree/" prefix, a wholly different
 * date-tree mechanism); this only ever targets a single named
 * heading, at whatever single level its own asterisks specify.
 */
function insertAtArchiveLocation(targetDoc, extractedHeading, headlinePart) {
  const trimmedPath = String(headlinePart || '').trim();
  if (!trimmedPath) {
    return appendToArchive(targetDoc, extractedHeading);
  }
  const starMatch = /^(\*+)\s*/.exec(trimmedPath);
  const targetLevel = starMatch ? starMatch[1].length : 1;
  const targetTitle = trimmedPath.replace(/^\*+\s*/, '');
  let target = findHeadingAtLevel(targetDoc, targetLevel, targetTitle);
  if (!target) {
    target = blankArchiveTargetHeading(targetTitle, targetLevel);
    targetDoc.children.push(target);
  }
  shiftLevels(extractedHeading, target.level + 1);
  target.children.push(extractedHeading);
  target.collapsed = false; // otherwise the just-archived item vanishes from view immediately -- same reasoning demoteHeading itself already applies
  return targetDoc;
}

/** Recursively searches `doc`'s own entire heading tree (not just its
 *  own top level) for the first heading at exactly `level` with
 *  exactly `title` -- insertAtArchiveLocation's own helper, since a
 *  level-2+ archive target could itself be nested anywhere, not
 *  necessarily at the document's own top level. */
function findHeadingAtLevel(doc, level, title) {
  function walk(nodes) {
    for (const node of nodes) {
      if (node.level === level && node.title === title) return node;
      const found = walk(node.children || []);
      if (found) return found;
    }
    return null;
  }
  return walk(doc.children || []);
}

export {
  ARCHIVE_TAG,
  findPropertyKey,
  getProperty,
  setProperty,
  deleteProperty,
  getPropertiesText,
  setPropertiesFromText,
  cloneHeading,
  findAncestorPath,
  findContainer,
  shiftLevels,
  formatOrgTimestamp,
  isArchivedInPlace,
  isArchived,
  archiveInPlace,
  unarchiveInPlace,
  buildArchivedClone,
  extractForArchive,
  appendToArchive,
  archiveToSiblingFile,
  buildRestoredClone,
  restoreFromArchive,
  DEFAULT_ARCHIVE_LOCATION,
  parseArchiveLocation,
  resolveArchiveFileId,
  getArchiveLocation,
  insertAtArchiveLocation,
};
