// @ts-check
// Inherited tags on screen: the ones a heading gets from its ancestors (org-use-tag-inheritance and
// org-tags-exclude-from-inheritance), shown dimmed after its own, and counted by the Agenda and TODO tag filters.
import { getShowInheritedTagsAgenda, getShowInheritedTagsOutline, getUseTagInheritance } from '../src/local-variables.js';
import { buildAncestorIndex, inheritedOnly } from '../src/tag-inheritance.js';
import { S } from './app-state.js';
import { aggregateAgendaDocs } from './agenda-files.js';

/** The ancestors of every heading in the open document and the loaded Agenda Files, worked out once per render. */
function ancestorIndex() {
  if (!S.ancestorIndexCache) {
    const docs = [S.state.doc, ...aggregateAgendaDocs().map((d) => d.doc)].filter(Boolean);
    S.ancestorIndexCache = buildAncestorIndex(docs);
  }
  return S.ancestorIndexCache;
}

/** The tags the heading inherits (none when inheritance is off).
 * @param {import('../src/types.js').Heading} heading
 * @returns {string[]} */
export function inheritedTagsOf(heading) {
  const ancestors = ancestorIndex().get(heading);
  return ancestors ? inheritedOnly(heading, ancestors, getUseTagInheritance(S.state.localVariables)) : [];
}

/** Its own tags followed by the inherited ones: what a tag filter sees.
 * @param {import('../src/types.js').Heading} heading
 * @returns {string[]} */
export function effectiveTagsOfHeading(heading) {
  return [...(heading.tags || []), ...inheritedTagsOf(heading)];
}

/** Adds the tag chips for a heading: its own, then (when shown) the inherited ones, dimmed.
 * @param {HTMLElement} parent
 * @param {import('../src/types.js').Heading} heading
 * @param {'outline' | 'agenda'} where */
export function appendTagChips(parent, heading, where) {
  const show = where === 'outline' ? getShowInheritedTagsOutline(S.state.localVariables) : getShowInheritedTagsAgenda(S.state.localVariables);
  const own = where === 'outline' ? [] : heading.tags || []; // the outline row draws its own tags itself
  const inherited = show ? inheritedTagsOf(heading) : [];
  for (const tag of own) parent.appendChild(chip(tag, false));
  for (const tag of inherited) parent.appendChild(chip(tag, true));
}

/** @param {string} tag @param {boolean} inherited */
function chip(tag, inherited) {
  const t = document.createElement('span');
  t.className = inherited ? 'tag tag-inherited' : 'tag';
  t.textContent = tag;
  if (inherited) t.title = 'Inherited tag';
  return t;
}

/** Sets `filterTags` (own plus inherited) on each item that has a heading, for the tag filter.
 * @param {any[]} items */
export function addFilterTags(items) {
  for (const item of items) if (item.heading) item.filterTags = effectiveTagsOfHeading(item.heading);
}
