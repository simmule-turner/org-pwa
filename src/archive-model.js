// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
import { oddLevelsOnly, validLevel } from './levels.js';
import { DEFAULT_CONTEXT_INFO } from './archive-settings.js';
import { fileCategory } from './file-category.js';

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
 * @param {Record<string, string>} properties
 * @param {string} key
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
 * @param {Heading} heading
 * @param {string} key
 *  missing convention. */
function getProperty(heading, key) {
  if (!heading.properties) return undefined;
  const foundKey = findPropertyKey(heading.properties, key);
  return foundKey === null ? undefined : heading.properties[foundKey];
}

/**
 * org-entry-put: a property name is not empty and has no whitespace (Emacs: a user error).
 * @param {Heading} heading
 * @param {string} key
 * @param {string} value
 */
function setProperty(heading, key, value) {
  if (key === '' || /\s/.test(key)) throw new Error(`Invalid property name: "${key}"`); // org--valid-property-p
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

/**
 * @param {Heading} heading
 * @param {string} key
 */
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
 * @param {Heading} heading
 *  text), rather than a bespoke per-row add/edit/delete property UI. */
function getPropertiesText(heading) {
  return heading.propertyOrder.map((/** @type {string} */ key) => `${key}: ${heading.properties[key]}`).join('\n');
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
 * @param {Heading} heading
 * @param {string} text
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
    /** @type {any} */ (properties)[key] = value;
  }
  heading.properties = properties;
  heading.propertyOrder = propertyOrder;
}

/** @param {Heading} heading */
function cloneHeading(heading) {
  // structuredClone is fine here: the AST is plain data, no functions/cycles.
  return structuredClone(heading);
}

/**
 * Depth-first search for `target` (by reference) inside `doc`/`root`.
 * Returns the path of ancestor headings from outermost to innermost,
 * NOT including `target` itself. Returns null if not found.
 * @param {Doc | Heading} root
 * @param {Heading} target
 * @param {Heading[]} [path]
 * @returns {Heading[] | null}
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
 * @param {Doc | Heading} root
 * @param {Heading} target
 * @returns {{ container: Heading[], index: number } | null}
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

/**
 * Shifts a subtree's level (and all descendants') by newLevel - node.level.
 * @param {Heading} node
 * @param {number} newLevel
 */
function shiftLevels(node, newLevel) {
  const delta = newLevel - node.level;
  /** @param {Heading} n */
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
  /** @param {number} n */
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

/** @param {Heading} heading */
function isArchivedInPlace(heading) {
  return heading.tags.includes(ARCHIVE_TAG);
}

/** True for a heading Org counts as archived: the ARCHIVE tag, which is all the Agenda and folding look at.
 * @param {Heading} heading */
function isArchived(heading) {
  return isArchivedInPlace(heading);
}

/** True where the app's Unarchive applies: a tagged heading, or one that landed in an archive file (it carries ARCHIVE_* stamps).
 * @param {Heading} heading */
function isRestorable(heading) {
  return isArchivedInPlace(heading) || 'ARCHIVE_TIME' in heading.properties;
}

/**
 * Archive-in-place: tag the heading :ARCHIVE: (org-toggle-archive-tag adds the tag and nothing else).
 * The subtree stays where it is; view layer is responsible for hiding
 * archived subtrees from agenda/TODO views by default (see requirements §7/§10).
 * @param {Heading} heading
 * @param {{ now?: Date }} [_options]
 */
function archiveInPlace(heading, _options = {}) {
  if (!isArchivedInPlace(heading)) {
    heading.tags = [...heading.tags, ARCHIVE_TAG];
  }
  return heading;
}

/** Reverses archiveInPlace. Leaves ARCHIVE_TIME in place as a history
 *  breadcrumb rather than deleting it — deleting it silently would erase
 * @param {Heading} heading
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
 * @param {any} sourceDoc
 * @param {Heading} heading
 * @param {any} [sourceFilePath]
 */
function buildArchivedClone(sourceDoc, heading, sourceFilePath, opts = /** @type {any} */ ({})) {
  const { now = new Date(), markDone = false, doneKeywords = ['DONE'], infile = false, addInheritedTags = 'infile', contextInfo = DEFAULT_CONTEXT_INFO } = opts;

  const ancestors = findAncestorPath(sourceDoc, heading);
  if (ancestors === null) {
    throw new Error('buildArchivedClone: heading not found in sourceDoc');
  }
  const olpath = ancestors.map((h) => h.title).join('/');
  const category = archiveCategory(sourceDoc, [...ancestors, heading], sourceFilePath);
  // the tags the subtree inherits, as Emacs lists them: #+FILETAGS: first, then each level from the outermost down, a tag
  // the subtree has itself left out, and a tag given at several levels kept at the last of them
  const fileTags = (/** @type {Doc} */ (sourceDoc).keywords || []).filter((k) => k.key.toUpperCase() === 'FILETAGS').flatMap((k) => k.value.split(/[:\s]+/).filter(Boolean));
  const above = [...fileTags, ...ancestors.flatMap((h) => h.tags || [])].filter((t) => !heading.tags.includes(t));
  const inheritedTags = above.filter((t, i, all) => all.lastIndexOf(t) === i);

  const clone = cloneHeading(opts.from || heading); // `from`: the same subtree as the text of its file gives it (blank lines at its end included)
  /** @type {Record<string, string>} */
  const context = { category: category || '', file: String(sourceFilePath ?? ''), itags: inheritedTags.join(' '), ltags: heading.tags.join(' '), olpath, time: formatOrgTimestamp(now), todo: heading.todo || '' };

  // Like org-archive-subtree: the inherited tags first (per org-archive-subtree-add-inherited-tags), the state marked done
  // (org-archive-mark-done), then each part of org-archive-save-context-info that is not empty as an ARCHIVE_* property.
  if (inheritedTags.length > 0 && ((addInheritedTags === 'infile' && infile) || addInheritedTags === true)) {
    clone.tags = [...inheritedTags, ...clone.tags];
  }
  if (markDone && (!clone.todo || !doneKeywords.includes(clone.todo))) {
    clone.todo = typeof markDone === 'string' && doneKeywords.includes(markDone) ? markDone : doneKeywords[0];
  }
  for (const item of contextInfo) {
    if (Object.prototype.hasOwnProperty.call(context, item) && context[item].trim() !== '') setProperty(clone, 'ARCHIVE_' + item.toUpperCase(), context[item]);
  }

  return clone;
}

/** What org-get-category gives: the nearest CATEGORY property, else the file's #+CATEGORY:, else the file name without its extension.
 * @param {Doc} doc @param {Heading[]} chain the headings from the outermost down to the one archived @param {string} [fileId] */
function archiveCategory(doc, chain, fileId) {
  for (let i = chain.length - 1; i >= 0; i--) {
    const v = getProperty(chain[i], 'CATEGORY');
    if (v !== undefined) return v;
  }
  const base = String(fileId || '').split('/').pop() || '';
  return fileCategory(doc, base.replace(/\.[^.]*$/, '') || base);
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
 * @param {any} sourceDoc
 * @param {Heading} heading
 * @param {any} [sourceFilePath]
 */
function extractForArchive(sourceDoc, heading, sourceFilePath, opts = ({})) {
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
 * @param {any} archiveDoc
 * @param {Heading} extractedHeading
 */
function appendToArchive(archiveDoc, extractedHeading) {
  shiftLevels(extractedHeading, 1);
  archiveDoc.children.push(extractedHeading);
  return archiveDoc;
}

/**
 * Convenience wrapper: archive `heading` out of `sourceDoc` and into
 * `archiveDoc` in one call.
 * @param {any} sourceDoc
 * @param {any} archiveDoc
 * @param {Heading} heading
 * @param {any} [sourceFilePath]
 */
function archiveToSiblingFile(sourceDoc, archiveDoc, heading, sourceFilePath, opts = ({})) {
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
 * @param {Heading} heading
 */
function buildRestoredClone(heading) {
  const clone = cloneHeading(heading);
  const archiveTodo = getProperty(clone, 'ARCHIVE_TODO');
  if (archiveTodo !== undefined) {
    clone.todo = archiveTodo;
  }
  // a subtree archived inside its file took its inherited tags along
  const inherited = new Set((getProperty(clone, 'ARCHIVE_ITAGS') || '').split(/\s+/).filter(Boolean));
  if (inherited.size > 0) clone.tags = clone.tags.filter((t) => !inherited.has(t));
  for (const key of ['ARCHIVE_TIME', 'ARCHIVE_FILE', 'ARCHIVE_OLPATH', 'ARCHIVE_CATEGORY', 'ARCHIVE_TODO', 'ARCHIVE_ITAGS']) {
    deleteProperty(clone, key);
  }
  unarchiveInPlace(clone);
  return clone;
}

/** Removes `heading` from `archiveDoc` and returns its restored clone
 *  (built via buildRestoredClone) -- the combined convenience wrapper,
 *  same relationship buildArchivedClone/extractForArchive already
 * @param {any} archiveDoc
 * @param {Heading} heading
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
 * @param {string} location
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
 * @param {string} filePart
 * @param {any} [currentFileId]
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
 * @param {Doc} doc
 * @param {Heading} heading
 * @param {Record<string, string>} [vars] the variables: org-archive-location is the last place to look
 */
function getArchiveLocation(doc, heading, vars = {}) {
  // the nearest heading that has an ARCHIVE property decides, as org-entry-get with inheritance finds it
  const chain = [...(findAncestorPath(doc, heading) || []).reverse()];
  for (const h of [heading, ...chain]) {
    const own = getProperty(h, 'ARCHIVE');
    if (own) return own;
  }
  /** @param {any} [k] */
  const kw = (doc.keywords || []).find((k) => k.key.toUpperCase() === 'ARCHIVE');
  if (kw) return kw.value;
  const configured = /^"((?:[^"\\]|\\.)*)"$/.exec(String(vars['org-archive-location'] ?? '').trim());
  return configured ? configured[1].replace(/\\(.)/g, '$1') : DEFAULT_ARCHIVE_LOCATION;
}

/** Whether the subtree of `heading` ends the file. @param {Doc} doc @param {Heading} heading */
function endsDocument(doc, heading) {
  return lastOwner(heading) === lastOwner(doc);
}

/**
 * Makes `heading` the last child of `destination` in `doc`, as a refile does. When the destination ends the file, the newline that
 * ends the file moves to the end of the subtree, so no blank line appears before it.
 * @param {Doc} doc @param {Heading} destination @param {Heading} heading
 */
function appendRefiled(doc, destination, heading) {
  const end = lastOwner(doc);
  if (lastOwner(destination) === end && end.bodyLines[end.bodyLines.length - 1] === '') {
    end.bodyLines.pop();
    const tail = lastOwner(heading);
    if (tail.bodyLines[tail.bodyLines.length - 1] !== '') tail.bodyLines.push('');
  }
  shiftLevels(heading, validLevel(destination.level, 1, oddLevelsOnly(doc)));
  destination.children.push(heading);
}

/** The last element of the document, in file order: the deepest last heading, or the document itself when it has none.
 * @param {Doc | Heading} node @returns {Doc | Heading} */
function lastOwner(node) {
  let n = node;
  while (n.children.length > 0) n = n.children[n.children.length - 1];
  if (!n.bodyLines) n.bodyLines = [];
  return n;
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
  isRestorable,
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
  endsDocument,
  appendRefiled,
};
