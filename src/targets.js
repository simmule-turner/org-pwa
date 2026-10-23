// @ts-check
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
// Link targets, as Org has them: a dedicated target `<<name>>` is something a link `[[name]]` can jump to, and a radio target
// `<<<name>>>` is that and also makes every plain occurrence of `name` in the document a link to it.
import { parseInline } from './inline-markup.js';

/** @typedef {{ name: string, radio: boolean, heading: Heading }} TargetEntry */

/** Targets compare with runs of whitespace as one space and case ignored, as Org does.
 * @param {string} name */
export function normalizeTargetName(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** @param {any[]} nodes @param {Heading} heading @param {TargetEntry[]} out */
function visit(nodes, heading, out) {
  for (const node of nodes || []) {
    if (node.type === 'target' || node.type === 'radio-target') out.push({ name: node.name, radio: node.type === 'radio-target', heading });
    if (node.children) visit(node.children, heading, out);
  }
}

/** @param {any[]} items @param {Heading} heading @param {TargetEntry[]} out */
function visitItems(items, heading, out) {
  for (const item of items || []) {
    visit(item.inline, heading, out);
    for (const nested of item.children || []) visitItems(nested.items, heading, out);
  }
}

/**
 * Every target in the document, in document order, with the heading it is under. Code blocks are not read, so a noweb
 * reference such as `<<name>>` inside one is not a target.
 * @param {Doc} doc
 * @returns {TargetEntry[]}
 */
export function collectTargets(doc) {
  /** @type {TargetEntry[]} */ const out = [];
  /** @param {any[]} nodes */
  function walk(nodes) {
    for (const heading of nodes) {
      if (heading.type !== 'heading') continue;
      visit(parseInline(heading.title || ''), heading, out);
      for (const node of heading.body || []) {
        if (node.type === 'paragraph') for (const line of node.inlineLines || []) visit(line, heading, out);
        else if (node.type === 'list') visitItems(node.items, heading, out);
        else if (node.type === 'table') for (const row of node.rows || []) for (const cell of ('cellsInline' in row ? row.cellsInline : null) || []) visit(cell, heading, out);
      }
      walk(heading.children || []);
    }
  }
  walk(doc.children);
  return out;
}

/**
 * The heading holding the target with this name, or null.
 * @param {Doc} doc
 * @param {string} name
 * @returns {Heading | null}
 */
export function findTargetHeading(doc, name) {
  const wanted = normalizeTargetName(name);
  if (!wanted) return null;
  const hit = collectTargets(doc).find((t) => normalizeTargetName(t.name) === wanted);
  return hit ? hit.heading : null;
}

/**
 * The heading holding the dedicated (not radio) target with this name, or null.
 * @param {Doc} doc
 * @param {string} name
 * @returns {Heading | null}
 */
export function findDedicatedTargetHeading(doc, name) {
  const wanted = normalizeTargetName(name);
  if (!wanted) return null;
  const hit = collectTargets(doc).find((t) => !t.radio && normalizeTargetName(t.name) === wanted);
  return hit ? hit.heading : null;
}

/**
 * A pattern for the plain occurrences of the document's radio targets, longest first so "big apple" wins over "apple";
 * null when there are none. Case is ignored and a space in a name matches any run of whitespace.
 * @param {Doc} doc
 * @returns {RegExp | null}
 */
export function radioTargetRegExp(doc) {
  /** @type {TargetEntry[]} */ const before = [];
  const top = /** @type {Heading} */ (/** @type {unknown} */ (doc));
  for (const node of doc.body || []) {
    if (node.type === 'paragraph') for (const line of node.inlineLines || []) visit(line, top, before);
    else if (node.type === 'list') visitItems(node.items, top, before);
    else if (node.type === 'table') for (const row of node.rows || []) for (const cell of ('cellsInline' in row ? row.cellsInline : null) || []) visit(cell, top, before);
  }
  const names = new Set([...before, ...collectTargets(doc)].filter((t) => t.radio).map((t) => normalizeTargetName(t.name))); // the text before the first headline counts too
  if (names.size === 0) return null;
  const parts = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
  return new RegExp('(?<![\\p{L}\\p{N}_])(?:' + parts.join('|') + ')(?![\\p{L}\\p{N}_])', 'giu');
}
