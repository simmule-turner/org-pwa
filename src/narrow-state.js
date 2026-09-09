
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

export { saveNarrowState, loadNarrowState };
