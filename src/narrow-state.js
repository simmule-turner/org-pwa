
/**
 * Per-document persistence for narrowedHeading, surviving an actual
 * reload/app-restart -- not just an in-session tab switch (which
 * already works for free, via a direct object reference held in
 * app.js's own documentSessions array, valid as long as the process
 * itself stays alive). A reload always re-parses from scratch,
 * producing brand-new heading object instances -- there's no object
 * reference that could survive that. Instead, this stores an outline
 * path (an array of ancestor titles, root first): the exact same
 * durable identifier outlinePathForHeadingInDocument/
 * findHeadingByOutlinePath already established for search-result
 * navigation surviving a fresh re-parse, reused here rather than
 * inventing a second scheme for the identical underlying problem.
 *
 * Adapter shape matches outbox.js's own: { get(key), set(key, value),
 * delete(key) }.
 */

function narrowStateKey(documentId) {
  return 'narrowState:' + documentId;
}

/** Saves `outlinePath` (an array of ancestor titles, root first) as
 *  `documentId`'s own currently-narrowed heading -- or, when
 *  `outlinePath` is null (widened), deletes the key entirely rather
 *  than storing an empty/null value, so a document that's never been
 *  narrowed (or was narrowed and widened again) leaves nothing behind
 *  in storage at all. */
async function saveNarrowState(adapter, documentId, outlinePath) {
  if (outlinePath === null) {
    await adapter.delete(narrowStateKey(documentId));
    return;
  }
  await adapter.set(narrowStateKey(documentId), JSON.stringify({ outlinePath }));
}

/** Returns `documentId`'s own saved outline path, or null if it was
 *  never narrowed (or was narrowed and later widened). Doesn't
 *  resolve the path against any actual document itself -- that's the
 *  caller's own job (via findHeadingByOutlinePath against the
 *  freshly-parsed doc), since this module has no notion of a
 *  document's own current parsed state at all, only what was last
 *  saved. */
async function loadNarrowState(adapter, documentId) {
  try {
    const result = await adapter.get(narrowStateKey(documentId));
    if (!result) return null;
    const raw = result && typeof result === 'object' && 'value' in result ? result.value : result;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || !Array.isArray(parsed.outlinePath)) return null;
    return parsed.outlinePath;
  } catch {
    return null;
  }
}

function sparseNarrowKey(documentId) {
  return 'sparseNarrow:' + documentId;
}

/** An identifier for a heading that survives a reload: the titles down to it (`path`) and the position taken at each
 *  level (`idx`). Titles alone are not enough: two headings can share a title under the same parent, or sit under
 *  parents that share one, and then every title path points at the first. null if `heading` is not in `doc`. */
function outlineKeyForHeading(doc, heading) {
  const trail = [];
  const walk = (children) => {
    for (let i = 0; i < children.length; i++) {
      trail.push({ title: children[i].title, i });
      if (children[i] === heading || walk(children[i].children || [])) return true;
      trail.pop();
    }
    return false;
  };
  if (!walk((doc && doc.children) || [])) return null;
  return { path: trail.map((t) => t.title), idx: trail.map((t) => t.i) };
}

/** The heading `key` (from outlineKeyForHeading) names in `doc`, or null. The recorded positions are tried first and
 *  only trusted if the title at every level still matches, so a document edited since can never land on the wrong
 *  heading by position alone; otherwise the titles are followed from the top, taking the first match at each
 *  level, which is all a key saved without positions (an older save) can do. */
function findHeadingByOutlineKey(doc, key) {
  if (!doc || !key || !Array.isArray(key.path) || key.path.length === 0) return null;
  if (Array.isArray(key.idx) && key.idx.length === key.path.length) {
    let level = doc.children || [];
    let found = null;
    let exact = true;
    for (let d = 0; d < key.path.length; d++) {
      const heading = level[key.idx[d]];
      if (!heading || heading.title !== key.path[d]) {
        exact = false;
        break;
      }
      found = heading;
      level = heading.children || [];
    }
    if (exact) return found;
  }
  let level = doc.children || [];
  let found = null;
  for (const title of key.path) {
    found = level.find((h) => h.title === title);
    if (!found) return null;
    level = found.children || [];
  }
  return found;
}

/** Saves the headings Search's Narrow is restricted to, as outline keys (see outlineKeyForHeading). null or an empty
 *  list (widened) deletes the key, so a document that is not narrowed leaves nothing behind. */
async function saveSparseNarrowState(adapter, documentId, keys) {
  if (!keys || keys.length === 0) {
    await adapter.delete(sparseNarrowKey(documentId));
    return;
  }
  await adapter.set(sparseNarrowKey(documentId), JSON.stringify({ headings: keys }));
}

/** `documentId`'s saved Search-Narrow keys, or null if there are none (or the value is unusable). Understands both
 *  the current format and the earlier one, which held bare title paths. The caller resolves them against the freshly
 *  parsed document with findHeadingByOutlineKey. */
async function loadSparseNarrowState(adapter, documentId) {
  try {
    const result = await adapter.get(sparseNarrowKey(documentId));
    if (!result) return null;
    const raw = result && typeof result === 'object' && 'value' in result ? result.value : result;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed) return null;
    const titles = (p) => Array.isArray(p) && p.length > 0 && p.every((t) => typeof t === 'string');
    const keys = [];
    for (const entry of Array.isArray(parsed.headings) ? parsed.headings : []) {
      if (!entry || !titles(entry.path)) continue;
      const key = { path: entry.path };
      if (Array.isArray(entry.idx) && entry.idx.every(Number.isInteger)) key.idx = entry.idx;
      keys.push(key);
    }
    for (const path of Array.isArray(parsed.outlinePaths) ? parsed.outlinePaths : []) {
      if (titles(path)) keys.push({ path });
    }
    return keys.length ? keys : null;
  } catch {
    return null;
  }
}

export { saveNarrowState, loadNarrowState, saveSparseNarrowState, loadSparseNarrowState, outlineKeyForHeading, findHeadingByOutlineKey };
