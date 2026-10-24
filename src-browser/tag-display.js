// @ts-check
// Inherited tags on screen: the ones a heading gets from its ancestors (org-use-tag-inheritance and
// org-tags-exclude-from-inheritance), shown dimmed after its own, and counted by the Agenda and TODO tag filters.
import { getShowInheritedTagsAgenda, getShowInheritedTagsOutline, getUseTagInheritance, getAgendaUseTagInheritance } from '../src/local-variables.js';
import { buildAncestorIndex, buildFileTagsIndex, inheritedOnly, showsInheritedTags, knowsInheritedTags } from '../src/tag-inheritance.js';
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

/** The `#+FILETAGS:` tags of the heading's file, which it inherits. @param {import('../src/types.js').Heading} heading @returns {string[]} */
function fileTagsOf(heading) {
  if (!S.fileTagsIndexCache) S.fileTagsIndexCache = buildFileTagsIndex([S.state.doc, ...aggregateAgendaDocs().map((d) => d.doc)]);
  const ancestors = ancestorIndex().get(heading);
  return S.fileTagsIndexCache.get((ancestors && ancestors[0]) || heading) || [];
}

/** The titles of the heading's ancestors, outermost first (for %b in org-agenda-prefix-format).
 * @param {import('../src/types.js').Heading} heading
 * @returns {string[]} */
export function ancestorTitles(heading) {
  return (ancestorIndex().get(heading) || []).map((h) => h.title || '');
}

/** The tags the heading inherits (none when inheritance is off).
 * @param {import('../src/types.js').Heading} heading
 * @returns {string[]} */
export function inheritedTagsOf(heading) {
  const ancestors = ancestorIndex().get(heading);
  return ancestors ? inheritedOnly(heading, ancestors, getUseTagInheritance(S.state.localVariables), fileTagsOf(heading)) : [];
}

/** Its own tags followed by the inherited ones: what a tag filter sees.
 * @param {import('../src/types.js').Heading} heading
 * @param {import('../src/tag-inheritance.js').AgendaViewType} [view]
 * @returns {string[]} */
export function effectiveTagsOfHeading(heading, view = 'agenda') {
  const known = knowsInheritedTags(view, getShowInheritedTagsAgenda(S.state.localVariables), getAgendaUseTagInheritance(S.state.localVariables));
  return [...(heading.tags || []), ...(known ? inheritedTagsOf(heading) : [])];
}

/** Adds the tag chips for a heading: its own, then (when shown) the inherited ones, dimmed.
 * @param {HTMLElement} parent
 * @param {import('../src/types.js').Heading} heading
 * @param {'outline' | 'agenda' | 'todo'} where */
export function appendTagChips(parent, heading, where) {
  const show =
    where === 'outline'
      ? getShowInheritedTagsOutline(S.state.localVariables)
      : showsInheritedTags(where, getShowInheritedTagsAgenda(S.state.localVariables), getAgendaUseTagInheritance(S.state.localVariables));
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

/** The title of the top-level heading an item sits under (its own when it is one), for the top-heading filter.
 * @param {import('../src/types.js').Heading} heading
 * @returns {string} */
function topTitleOf(heading) {
  const ancestors = ancestorIndex().get(heading);
  return ((ancestors && ancestors[0]) || heading).title || '';
}

/** Sets `filterTags` (own plus inherited) and `topTitle` on each item that has a heading, for the filter chips.
 * @param {any[]} items
 * @param {import('../src/tag-inheritance.js').AgendaViewType} [view] */
export function addFilterTags(items, view = 'agenda') {
  for (const item of items) {
    if (!item.heading) continue;
    item.filterTags = effectiveTagsOfHeading(item.heading, view);
    item.topTitle = topTitleOf(item.heading);
  }
}
