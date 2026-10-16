// @ts-check
/** @typedef {import('./types.js').Doc} Doc */
// The ID -> file table behind `[[id:…]]` links, as org-id-locations does it in Emacs: remembers which file each :ID: was last
// seen in, so a link can open that file even when it is neither an open tab nor an Agenda File. Pure; the browser side keeps it
// in the key-value store (src-browser/id-locations.js).

/** @typedef {{ scheme: string, documentId: string }} IdLocation
 * @typedef {Record<string, IdLocation>} IdTable  keyed by the ID in lower case, as links compare them */

/** Every :ID: in the document, as written, in document order.
 * @param {Doc} doc
 * @returns {string[]} */
export function collectIds(doc) {
  /** @type {string[]} */ const ids = [];
  /** @param {any[]} nodes */
  function walk(nodes) {
    for (const node of nodes) {
      if (node.type !== 'heading') continue;
      const id = node.properties && typeof node.properties.ID === 'string' ? node.properties.ID.trim() : '';
      if (id) ids.push(id);
      walk(node.children);
    }
  }
  walk(doc.children);
  return ids;
}

/**
 * Records where a file's IDs are, and drops entries that still name this file but whose heading is gone from it.
 * @param {IdTable} table  changed in place
 * @param {Doc} doc
 * @param {string} scheme
 * @param {string} documentId
 * @returns {boolean} whether the table changed
 */
export function recordIds(table, doc, scheme, documentId) {
  let changed = false;
  const here = new Set(collectIds(doc).map((id) => id.toLowerCase()));
  for (const key of here) {
    const known = table[key];
    if (!known || known.scheme !== scheme || known.documentId !== documentId) {
      table[key] = { scheme, documentId };
      changed = true;
    }
  }
  for (const [key, loc] of Object.entries(table)) {
    if (loc.scheme === scheme && loc.documentId === documentId && !here.has(key)) {
      delete table[key];
      changed = true;
    }
  }
  return changed;
}
