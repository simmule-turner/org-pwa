// @ts-check
// The rows of the Agenda's Match view (org-tags-view, `m` and `M`) and Search view (org-search-view, `s`): the entries a query finds in
// the agenda files, as agenda items ordered by the `tags` or `search` entry of org-agenda-sorting-strategy.
import { getCategoryForDocument } from './agenda.js';
import { agendaLisp } from './agenda-lisp.js';
import { sortAgendaItems, strategyFor } from './agenda-sort.js';
import { planSearch, searchEntries } from './agenda-search.js';
import { isArchived } from './archive-model.js';
import { isCommentedHeading } from './comment-model.js';
import { effectivePropertyValue, searchDocumentsByMatchQuery } from './search.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {{ skipArchived?: boolean, skipCommented?: boolean, doneKeywords?: string[], todoKeywords?: string[], todoOnly?: boolean,
 *   tagInheritance?: import('./tag-inheritance.js').TagInheritance, propertyInheritance?: boolean, tagGroups?: Map<string, string[]>, now?: Date,
 *   sortingStrategy?: string | null, localVariables?: Record<string, string>, documentOrder?: string[],
 *   alwaysBoolean?: boolean, forceFullWords?: boolean, maxLevel?: number }} QueryOptions */

/** @param {Heading} heading @param {QueryOptions} options */
const skipped = (heading, options) => (options.skipArchived !== false && isArchived(heading)) || (options.skipCommented !== false && isCommentedHeading(heading));

/**
 * @param {{ documentId: string, doc: Doc, heading: Heading, category?: string | null }} hit
 * @param {boolean} ofSearch
 * @returns {import('./agenda.js').AgendaItem}
 */
function itemFor(hit, ofSearch) {
  const { heading, doc, documentId } = hit;
  return /** @type {import('./agenda.js').AgendaItem} */ (/** @type {unknown} */ ({
    documentId,
    heading,
    todo: heading.todo,
    priority: heading.priority,
    // a Search row ranks the same whatever its cookie says (org-search-view gives every row 1000)
    samePriority: ofSearch || undefined,
    tags: heading.tags,
    title: heading.title,
    category: hit.category || getCategoryForDocument(doc, documentId),
  }));
}

/**
 * @param {import('./agenda.js').AgendaItem[]} items
 * @param {'tags' | 'search'} view
 * @param {QueryOptions} options
 * @param {{ documentId: string, doc: Doc }[]} docs */
function order(items, view, options, docs) {
  const keys = strategyFor(options.sortingStrategy, view);
  if (!keys || !keys.length) return items;
  return sortAgendaItems(items, keys, {
    localVariables: options.localVariables,
    todoKeywords: [...(options.todoKeywords || []), ...(options.doneKeywords || [])],
    doneKeywords: options.doneKeywords || [],
    documentOrder: options.documentOrder,
    lisp: agendaLisp(options.localVariables, docs, { todoKeywords: options.todoKeywords, doneKeywords: options.doneKeywords }),
  });
}

/**
 * Match view: the headings that satisfy a tags/property/TODO match. `todoOnly` (the `M` command) keeps the unfinished TODO entries.
 * @param {{ documentId: string, doc: Doc }[]} docs
 * @param {string} query
 * @param {QueryOptions} [options]
 */
export function matchViewItems(docs, query, options = {}) {
  const done = new Set(options.doneKeywords || ['DONE']);
  const hits = searchDocumentsByMatchQuery(docs, query, {
    useTagInheritance: options.tagInheritance ?? true,
    usePropertyInheritance: !!options.propertyInheritance,
    doneKeywords: done,
    tagGroups: options.tagGroups,
    now: options.now,
  });
  const kept = hits.filter((hit) => {
    if (options.todoOnly && !(hit.heading.todo && !done.has(hit.heading.todo))) return false;
    return ![hit.heading, ...(hit.ancestors || [])].some((h) => skipped(h, options));
  });
  // the category the Agenda and TODO views show: a CATEGORY property, else the file's own (the matcher's file name is not that)
  const docOf = new Map(docs.map((d) => [d.documentId, d.doc]));
  return order(kept.map((hit) => itemFor({ ...hit, doc: /** @type {Doc} */ (docOf.get(hit.documentId)), category: effectivePropertyValue(hit.heading, hit.ancestors || [], 'CATEGORY', true) }, false)), 'tags', options, docs);
}

/**
 * Search view: the entries that contain a phrase or satisfy a Boolean list of words.
 * @param {{ documentId: string, doc: Doc }[]} docs
 * @param {string} query
 * @param {QueryOptions} [options]  throws EmacsRegexError for a bad {regexp}
 */
export function searchViewItems(docs, query, options = {}) {
  if (!/\S/.test(query)) return [];
  const done = new Set(options.doneKeywords || ['DONE']);
  const plan = planSearch(query, { todoOnly: options.todoOnly, alwaysBoolean: options.alwaysBoolean, forceFullWords: options.forceFullWords });
  const hits = searchEntries(docs, plan, { skip: (heading) => skipped(heading, options), isNotDone: (todo) => !done.has(todo), maxLevel: options.maxLevel });
  return order(
    hits.map((hit) => itemFor({ ...hit, category: effectivePropertyValue(hit.heading, hit.ancestors, 'CATEGORY', true) }, true)),
    'search',
    options,
    docs,
  );
}
