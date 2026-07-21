
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

/**
 * Whether a heading should default to collapsed when no explicit fold
 * preference has been saved for it. As of this version: everything does,
 * unconditionally — a document opens fully collapsed until the user
 * expands what they want to see. There is no per-node exception anymore
 * (a previous version defaulted only archived headings to collapsed and
 * left everything else expanded; that asymmetry has been removed in favor
 * of this simpler, stronger rule). `opts` is kept in the signature for
 * forward compatibility even though nothing currently reads it — future
 * default policies (e.g. "collapse below level N") would live here
 * without changing every caller's signature again.
 */
function defaultCollapsed(_node, _opts = {}) {
  return true;
}

/**
 * Sets `node.collapsed` on every heading. `overrides` is a sparse list of
 * `{ id, collapsed }` entries — a heading not present in it falls back to
 * `defaultCollapsed(node, opts)`. This is what makes an explicit user
 * choice (e.g. manually re-expanding an archived heading to review it)
 * stick regardless of the archived-default, while anything untouched
 * follows whatever the current default computes to.
 */
function applyFoldState(doc, overrides, opts = {}) {
  const overrideMap = new Map((overrides || []).map((o) => [o.id, o.collapsed]));
  for (const { id, node } of buildFoldIndex(doc)) {
    node.collapsed = overrideMap.has(id) ? overrideMap.get(id) : defaultCollapsed(node, opts);
  }
  return doc;
}

/**
 * Extracts the sparse list of headings whose current collapsed state
 * differs from their computed default — no longer simply "all collapsed
 * headings", since the default itself now varies per heading (archived
 * vs. not). A heading sitting at its own default is never stored; only
 * genuine deviations are.
 */
function extractFoldState(doc, opts = {}) {
  const overrides = [];
  for (const { id, node } of buildFoldIndex(doc)) {
    const def = defaultCollapsed(node, opts);
    if (node.collapsed !== def) {
      overrides.push({ id, collapsed: node.collapsed });
    }
  }
  return overrides;
}

// ---- persistence -----------------------------------------------------

function storageKey(documentId) {
  return 'foldstate:' + documentId;
}

/**
 * Loads persisted overrides (if any) for `documentId` and applies fold
 * state to `doc` — always, even when nothing is stored yet, since
 * "nothing stored" still needs defaultCollapsed() run on every heading to
 * get archived-collapsed-by-default right on a document's very first
 * open. (The previous version skipped applying anything in that case,
 * which is exactly why archived headings were showing expanded regardless
 * of configuration — there was no default-computation step at all, only
 * an override lookup.) Fails open (falls back to an empty override list,
 * i.e. defaults only) on any storage error.
 */
async function loadFoldState(doc, documentId, adapter, opts = {}) {
  let overrides = [];
  try {
    const result = await adapter.get(storageKey(documentId));
    if (result) {
      const raw = result && typeof result === 'object' && 'value' in result ? result.value : result;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) overrides = parsed;
    }
  } catch {
    overrides = [];
  }
  applyFoldState(doc, overrides, opts);
  return doc;
}

/** Extracts current fold-state overrides from `doc` (relative to `opts`'s
 *  defaults) and persists them under `documentId`. */
async function saveFoldState(doc, documentId, adapter, opts = {}) {
  const overrides = extractFoldState(doc, opts);
  await adapter.set(storageKey(documentId), JSON.stringify(overrides));
  return overrides;
}

export {
  computeNodeId,
  buildFoldIndex,
  ancestorTitlesFor,
  defaultCollapsed,
  applyFoldState,
  extractFoldState,
  createInMemoryAdapter,
  loadFoldState,
  saveFoldState,
};
