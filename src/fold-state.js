
/**
 * Fold/collapse state model.
 *
 * The hard problem here isn't storage, it's identity: headings don't carry
 * a stable ID by default, but "remember this heading was collapsed" needs
 * one that survives ordinary edits elsewhere in the file. Two strategies,
 * in priority order:
 *
 *   1. If the heading has a :ID: property, use it (`id:<value>`) — fully
 *      stable, survives moves/renames/reordering.
 *   2. Otherwise, derive an id from (ancestor title path, level, own title,
 *      index among same-titled siblings) and hash it (`p:<hash>`).
 *
 * Strategy 2 is a best-effort fallback, not a guarantee: renaming a heading
 * changes its id (so its fold state "forgets" and defaults back to
 * expanded), and two structurally-identical subtrees elsewhere in the file
 * can't be told apart beyond their title/position. This is a real, named
 * limitation, not an edge case being swept under the rug — assigning
 * :ID: properties is the actual fix, and the UI can offer that as an
 * explicit action for headings the user folds often.
 *
 * Persistence is behind a small adapter interface — { get(key), set(key,
 * value) } — deliberately shaped to match both a plain IndexedDB wrapper
 * and the artifact platform's window.storage API, so the same functions
 * work in either environment. An in-memory adapter is included for tests.
 */

import { findAncestorPath } from './archive-model.js';
import { createInMemoryAdapter } from './kv-adapter.js';

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function computeNodeId(heading, ancestorTitles, siblingIndex) {
  if (heading.properties && heading.properties.ID) {
    return 'id:' + heading.properties.ID;
  }
  const key = ancestorTitles.join('>') + '|' + heading.level + '|' + heading.title + '|' + siblingIndex;
  return 'p:' + fnv1a(key);
}

/** Walks the whole document, returning [{ id, node }] for every heading. */
function buildFoldIndex(doc) {
  const entries = [];

  function walk(node, ancestors) {
    const children = node.children || [];
    const titleCounts = new Map();
    for (const child of children) {
      if (child.type !== 'heading') continue;
      const seen = titleCounts.get(child.title) || 0;
      titleCounts.set(child.title, seen + 1);

      const ancestorTitles = ancestors.map((a) => a.title);
      const id = computeNodeId(child, ancestorTitles, seen);
      entries.push({ id, node: child });

      walk(child, [...ancestors, child]);
    }
  }

  walk(doc, []);
  return entries;
}

/** Sanity check helper, not required for normal use: confirms findAncestorPath
 *  agrees with the path buildFoldIndex threads through — kept small and
 *  cheap enough to call in tests without duplicating traversal logic. */
function ancestorTitlesFor(doc, heading) {
  const path = findAncestorPath(doc, heading);
  return path ? path.map((h) => h.title) : null;
}

/** Sets `node.collapsed` on every heading from a list/Set of collapsed ids.
 *  Anything not in the set defaults to expanded (false). */
function applyFoldState(doc, collapsedIds) {
  const set = collapsedIds instanceof Set ? collapsedIds : new Set(collapsedIds);
  for (const { id, node } of buildFoldIndex(doc)) {
    node.collapsed = set.has(id);
  }
  return doc;
}

/** Extracts the sparse list of collapsed heading ids (not a full map —
 *  expanded is the default, so only exceptions need storing). */
function extractFoldState(doc) {
  return buildFoldIndex(doc)
    .filter(({ node }) => node.collapsed === true)
    .map(({ id }) => id);
}

// ---- persistence -----------------------------------------------------

function storageKey(documentId) {
  return 'foldstate:' + documentId;
}

/** Loads and applies persisted fold state for `documentId` onto `doc`.
 *  Fails open (leaves everything expanded) on any storage error rather
 *  than throwing — a missing/corrupt fold-state entry should never block
 *  opening a document. */
async function loadFoldState(doc, documentId, adapter) {
  try {
    const result = await adapter.get(storageKey(documentId));
    if (!result) return doc;
    const raw = result && typeof result === 'object' && 'value' in result ? result.value : result;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) applyFoldState(doc, parsed);
    return doc;
  } catch {
    return doc;
  }
}

/** Extracts current fold state from `doc` and persists it under `documentId`. */
async function saveFoldState(doc, documentId, adapter) {
  const collapsedIds = extractFoldState(doc);
  await adapter.set(storageKey(documentId), JSON.stringify(collapsedIds));
  return collapsedIds;
}

export {
  computeNodeId,
  buildFoldIndex,
  ancestorTitlesFor,
  applyFoldState,
  extractFoldState,
  createInMemoryAdapter,
  loadFoldState,
  saveFoldState,
};
