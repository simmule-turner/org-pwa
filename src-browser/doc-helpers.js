// Extracted from app.js: doc helpers. These have no dependency on the app's shared mutable state,
// so they moved verbatim (see tools/ notes in CHANGELOG v412).
import { emacsRegexToJs } from '../src/emacs-regex.js';
import { CAPTURE_TYPES } from './constants.js';

/** The raw table.rows array index (which, like editingCell's own
 *  existing convention, INCLUDES rule/hline entries) of the first
 *  actual data row in `table` -- the entry point keyboard table-cell
 *  navigation lands on when a table first gains keyboard focus.
 *  Returns 0 if `table` has no data rows at all (shouldn't normally
 *  happen, but a defined fallback beats an out-of-range index). */
export function firstDataRowIndex(table) {
  const idx = table.rows.findIndex((r) => r.type !== 'rule');
  return idx === -1 ? 0 : idx;
}

/** True if `heading` has any body content at all (paragraph, table,
 *  list, block) to potentially reveal via moveLineFocus's own
 *  auto-reveal-on-enter -- checked against the heading's own raw body
 *  array directly, not flattenVisibleRows' own output, since that
 *  respects the CURRENT fold state and would miss body content
 *  that's simply folded away right now (exactly the case
 *  auto-reveal needs to detect). */
export function hasBodyContent(heading) {
  return !!(heading.body && heading.body.length > 0);
}

/** Confirms (always -- see confirmHeadingDelete's own docs) and, if
 *  confirmed, deletes `heading` -- clearing any of this app's own
 *  in-progress edit state that might reference it first (editing its
 *  title, a cell/paragraph/list-item within it, etc.). Reachable via
 *  the dedicated "Delete heading" action-row button. */
/** org-cut-subtree (C-c C-x C-w): copies `heading` and its own entire
 *  subtree to the clipboard, matching real org's own actual "cut"
 *  semantics (the kill ring, not just an outright delete -- so the
 *  cut content can be yanked/pasted elsewhere), then deletes it. */
/** Recursively finds the list item at `lineIndex`, possibly nested
 *  within a sub-list -- list items aren't direct heading.body
 *  children the way a paragraph/table/block is, so finding a fresh
 *  one after a re-parse needs to walk this nested structure. */
export function findListItemByLineIndex(items, lineIndex) {
  for (const item of items) {
    if (item.lineIndex === lineIndex) return item;
    for (const child of item.children) {
      if (child.type === 'list') {
        const found = findListItemByLineIndex(child.items, lineIndex);
        if (found) return found;
      }
    }
  }
  return null;
}

/** Expands `matchedHeadings` (a Set of heading object references) to
 *  also include every one of their own current ancestors, by walking
 *  `doc` once with an ancestor stack -- matching the sparse-tree
 *  convention this app's own swipe-to-fold and org's real sparse trees
 *  both already follow: a match stays visible in its own actual
 *  position in the outline, with enough of its own ancestor chain kept
 *  visible to make sense of where it sits, rather than being shown as a
 *  flat, context-free list. */
export function expandScopeWithAncestors(doc, matchedHeadings) {
  const visible = new Set();
  function walk(nodes, ancestors) {
    for (const node of nodes) {
      if (node.type !== 'heading') continue;
      if (matchedHeadings.has(node)) {
        visible.add(node);
        for (const ancestor of ancestors) visible.add(ancestor);
      }
      walk(node.children || [], [...ancestors, node]);
    }
  }
  walk(doc.children, []);
  return visible;
}

export function tableHasContent(table) {
  return table.rows.some((r) => r.type === 'row' && r.cells.some((c) => c.trim() !== ''));
}

export function paragraphHasContent(paragraph) {
  return paragraph.lines.some((l) => l.trim() !== '');
}

// Counts every item nested under `item`, at any depth — used by
// confirmListItemDelete to decide whether deleting it needs confirming
// (nested children present, or the item itself has real content), and
// to say how much would go with it. A genuinely empty item — no text,
// no nested children — skips confirmation, same "nothing lost, nothing
// to ask about" rule as confirmParagraphDelete/confirmTableDelete. This
// used to skip confirmation for ANY item with no nested children,
// regardless of the item's own content — meaning a plain, undoable
// checkbox task like "Buy milk" never got a confirmation at all, since
// it has no children of its own. That was the actual bug, not a
// deliberate friction/safety tradeoff.
export function listItemDescendantCount(item) {
  let count = 0;
  for (const nestedList of item.children || []) {
    count += nestedList.items.length;
    for (const child of nestedList.items) count += listItemDescendantCount(child);
  }
  return count;
}

/** Resolves a heading's own contact photo value for display, covering
 *  both representations import-vcard.js's own Flat and Tree builders
 *  produce -- Flat style's own :PHOTO: property directly on the
 *  contact heading, or Tree style's own separate "Photo" sub-heading
 *  (:FIELDTYPE: photo), whose value is either a :DATA: property (a
 *  base64-embedded photo, kept out of the heading's own title since
 *  it can be tens of KB of text) or the heading's own title (a real
 *  URL, already short and readable as a title). Returns null when
 *  there's no real, renderable value either way -- a bare string
 *  that isn't a real URL or a real data:image/ URI is never treated
 *  as a displayable photo. */
export function contactPhotoValueForHeading(heading) {
  const fieldType = String((heading.properties || {}).FIELDTYPE || '').toLowerCase();
  const candidate = fieldType === 'photo' ? heading.properties.DATA || heading.title || '' : (heading.properties || {}).PHOTO || '';
  return /^https?:\/\//i.test(candidate) || /^data:image\//i.test(candidate) ? candidate : null;
}

/** Read-only block content (#+BEGIN_SRC/QUOTE/EXAMPLE/etc.), gated by
 *  the owning heading's drawersHidden flag (see fold-state.js -- shared
 *  with property-drawer visibility, since real org-mode's showall/
 *  showeverything distinction treats drawers and blocks as one group).
 *  Shows an honest "collapsed block" placeholder when hidden, actual
 *  content when not. No editing support here (there's no body-edit.js
 *  function for it yet) -- this is visibility only, matching what was
 *  actually asked for. Tapping toggles drawersHidden for the whole
 *  heading (its actual granularity -- one flag covers every block AND
 *  every property under a heading, not each individually), landing on
 *  the header label specifically when expanded so selecting/copying the
 *  code itself doesn't
 *  accidentally re-collapse it. */
/**
 * Renders a block's own content appropriately for its name, appending
 * to `container`. QUOTE, VERSE, and CENTER all interpret inline
 * markup within them, matching real org's own actual behavior for
 * these three specifically -- they're meant to hold normal prose,
 * just displayed differently, not literal/verbatim content the way
 * SRC and EXAMPLE are. Everything else (SRC, EXAMPLE, or any other/
 * custom block name) falls through to the original, unchanged
 * literal <pre><code> treatment -- no markup interpretation, content
 * shown byte-for-byte.
 */
/** Strips org's own comma-escape convention from one block content
 *  line for display -- see export-html.js's own stripCommaEscape for
 *  the full reasoning; the same fix, applied here too. */
export function stripCommaEscapeApp(line) {
  return line.replace(/^(\s*),(?=\*|#\+)/, '$1');
}

/** Closes the file browser, returning to the "which backend" button
 *  row -- used by both Cancel and after successfully opening a file
 *  (since the file menu itself also closes right after, but leaving
 *  stale browse state around would show it again if File \u2192 Open got
 *  reopened without going through startBrowsing first). */
/** Collects every heading in `doc`, in document order, regardless of
 *  fold state -- a heading buried under several collapsed ancestors
 *  must still be pickable as an export scope, unlike keyboard
 *  navigation (which only moves between currently-visible rows). */
export function vcardBodyHeadingsIn(headings) {
  const found = [];
  for (const { heading } of headings) {
    const bodyText = (heading.bodyLines || []).join('\n').trim();
    if (/^BEGIN:VCARD/i.test(bodyText)) found.push(bodyText);
  }
  return found;
}

/** All headings within `heading`'s own subtree (itself included), in
 *  the same {heading, depth} shape allHeadingsInOrder returns for the
 *  whole document -- depth here is relative to `heading` itself (0),
 *  not the document root, since this is only ever used for scanning,
 *  never for indentation display. */
export function headingsInSubtree(heading) {
  const out = [];
  function walk(node, depth) {
    out.push({ heading: node, depth });
    for (const child of node.children || []) walk(child, depth + 1);
  }
  walk(heading, 0);
  return out;
}

export function allHeadingsInOrder(doc) {
  const out = [];
  function walk(nodes, depth) {
    for (const node of nodes) {
      if (node.type !== 'heading') continue;
      out.push({ heading: node, depth });
      walk(node.children || [], depth + 1);
    }
  }
  walk(doc.children || [], 0);
  return out;
}

export function buildQueryReplacePattern(query, useRegex) {
  if (useRegex) return emacsRegexToJs(query, 'gi');
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'gi');
}

/** Returns a human-readable problem description, or null if `parsed` is
 *  a valid capture-templates array. Checked before saving from Settings
 *  so a malformed edit gets a clear message immediately, rather than
 *  either silently corrupting the stored config or failing confusingly
 *  later when a capture is actually run against it. */
export function validateCaptureTemplates(parsed) {
  if (!Array.isArray(parsed)) return 'must be a JSON array';
  for (let i = 0; i < parsed.length; i++) {
    const t = parsed[i];
    const label = `template #${i + 1}`;
    if (!t || typeof t !== 'object') return `${label} must be an object`;
    if (typeof t.key !== 'string' || t.key.length === 0) return `${label}: "key" must be a non-empty string`;
    if (typeof t.description !== 'string') return `${label}: "description" must be a string`;
    if (!CAPTURE_TYPES.includes(t.type)) return `${label}: "type" must be one of ${CAPTURE_TYPES.join(', ')}`;
    if (!Array.isArray(t.olp) || t.olp.length === 0 || !t.olp.every((s) => typeof s === 'string')) {
      return `${label}: "olp" must be a non-empty array of strings`;
    }
    if (typeof t.template !== 'string') return `${label}: "template" must be a string`;
    if ('file' in t && typeof t.file !== 'string') return `${label}: "file" must be a string if present`;
    if ('prepend' in t && typeof t.prepend !== 'boolean') return `${label}: "prepend" must be true or false if present`;
    if ('prependHeading' in t && typeof t.prependHeading !== 'boolean') return `${label}: "prependHeading" must be true or false if present`;
    if ('omitEmptyEntries' in t && typeof t.omitEmptyEntries !== 'boolean') return `${label}: "omitEmptyEntries" must be true or false if present`;
    if ('preText' in t && typeof t.preText !== 'string') return `${label}: "preText" must be a string if present`;
    if ('postText' in t && typeof t.postText !== 'string') return `${label}: "postText" must be a string if present`;
  }
  const keys = parsed.map((t) => t.key);
  const duplicate = keys.find((k, i) => keys.indexOf(k) !== i);
  if (duplicate !== undefined) return `duplicate key "${duplicate}" \u2014 each template needs a unique key`;
  return null;
}

/**
 * Runs one capture template end to end, given `answers` already
 * gathered for its %^{...} AND %? prompts (by the in-app prompt form,
 * or an empty array if the template has none): resolves its
 * (file+olp ...) target (creating any missing heading along the way),
 * computes @# if this is a table-line capture, expands the template
 * (with every prompt's answer, %? included, already substituted
 * directly into the text — see scanPrompts/expandTemplate), inserts
 * it, and navigates to the target heading.
 *
 * Afterward: a template with at least one prompt loops back to a
 * FRESH copy of its own form rather than the template list — the
 * "multiple entries" feature, for templates that are naturally
 * captured several times in a row (a journal line, a tracking row).
 * A template with no prompts at all returns to the template list,
 * since there's nothing left to fill in for a repeat.
 */
/** Which value controls where an auto-created OLP heading lands among
 *  its own siblings, for a given template -- table-line has its own
 *  dedicated prependHeading field, since row placement (prepend) and
 *  heading placement are genuinely independent decisions for it
 *  (newest section first, but chronological rows within it is a
 *  common, sensible combination); item/checkitem/plain reuse the same
 *  prepend value for both, since for those three "where does the
 *  container heading go" and "where does the content go" are the same
 *  decision applied at two tree levels, not two independent ones. */
export function getOlpPrepend(template) {
  return template.type === 'table-line' ? !!template.prependHeading : !!template.prepend;
}
