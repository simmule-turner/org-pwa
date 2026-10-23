// @ts-check
/** @typedef {import('./tag-inheritance.js').TagInheritance} TagInheritance */
/**
 * @typedef {{ type: 'tag' | 'todo' | 'priority', mode: string, values: string[] } | { type: 'property', mode: string, key: string, values: string[] } | { type: 'keyword', mode: string, value: string }} SearchFilter
 * @typedef {(text: string) => boolean} Matcher
 * @typedef {{ useRegex?: boolean, useTagInheritance?: TagInheritance, usePropertyInheritance?: boolean, doneKeywords?: Iterable<string>, tagGroups?: Map<string, string[]>, now?: Date }} SearchOptions
 * @typedef {{ text: string, highlightStart: number, highlightLength: number }} Snippet
 * @typedef {{ type: string, heading: Heading, node: any, snippet: Snippet, documentId?: string }} SearchResult
 */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
import { effectiveTagsOf } from './tag-inheritance.js';
/**
 * Whole-document search — walks the full tree regardless of current fold
 * state (a folded heading's content is still searchable, it just isn't
 * currently rendered), matching heading titles/tags/TODO keyword/priority,
 * every kind of body content (paragraphs, list items, table cells, block
 * content), and a heading's structured data: properties (key or value)
 * and SCHEDULED/DEADLINE planning timestamps.
 *
 * Supports two text-matching modes: plain substring (the default,
 * case-insensitive, and the only mode that treats regex special
 * characters as literal text) and regex (`opts.useRegex: true`), for
 * anyone who actually wants pattern matching rather than a literal
 * phrase. Plain mode is the default deliberately — most searches are
 * "find this word," and a query containing `.` or `(` shouldn't need
 * escaping to work as expected.
 *
 * The query can also contain filter tokens — see parseFilterQuery below
 * for the full syntax — that restrict which HEADINGS are searched at
 * all: `tag:X`/`todo:X`/`priority:X`/`key:value` (structured field
 * filters, each with -/| support), and keyword terms — `+word`, `-word`,
 * or a bare `word` with no sign at all — matching real org-mode's own
 * `org-search-view` boolean search exactly: a bare word and an explicit
 * `+word` both mean "the entry must contain this somewhere" (title,
 * tags, TODO, priority, properties, planning, body — the same breadth
 * this module has always searched), `-word` means "must NOT contain
 * this," and every term combines as an implicit AND — `+computer +wifi
 * -ethernet` (or equivalently `computer wifi -ethernet`) means
 * "contains computer, AND contains wifi, AND does not contain
 * ethernet." There's no separate "free text" concept anymore — every
 * non-structured-filter token in the query is a keyword term.
 *
 * Returns a flat array of match records in document order, each carrying
 * enough to render a result row and navigate to it:
 *   { type, heading, node, snippet }
 * `heading` is always the owning heading (for a heading-level match —
 * title, tags, TODO, priority — that's the same as `node`; for a
 * property or planning match, `node` is also the heading itself, since
 * neither has its own separate body node the way a paragraph or list
 * item does). `snippet` is `{ text, highlightStart, highlightLength }`
 * — text is what to display, highlightStart/highlightLength describe
 * where the actual match sits within THAT text (already accounting for
 * any leading ellipsis), for a caller to wrap in a <mark> or similar;
 * highlightStart is -1 when there's nothing to highlight (a heading
 * that passed purely via structured filters, with no keyword term at
 * all driving this particular result).
 */

import { emacsRegexToJs } from './emacs-regex.js';
import { makeTagsMatcher } from './tags-match.js';

const SNIPPET_RADIUS = 40;

/** Builds a matcher for `query`: plain mode does a case-insensitive
 *  substring test; regex mode compiles `query` as a case-insensitive
 *  RegExp. Throws a plain Error with a clear message on an invalid
 *  regex pattern, rather than silently matching nothing — an unparsable
 *  pattern and "no results" are different situations a caller should be
 * @param {string} query
 * @param {boolean} useRegex
 *  able to tell apart and surface differently. */
function buildMatcher(query, useRegex) {
  if (!useRegex) {
    const q = query.toLowerCase();
    return (/** @type {string} */ text) => text.toLowerCase().includes(q);
  }
  let re;
  try {
    re = emacsRegexToJs(query, 'i');
  } catch (err) {
    throw new Error('Invalid regex: ' + err.message);
  }
  return (/** @type {string} */ text) => re.test(text);
}

/** Same idea as buildMatcher, but returns the position of the match (for
 *  snippet centering) instead of just whether one exists. -1 when there
 *  is no match, matching String.indexOf's own convention. */
/** Same idea as buildMatcher, but returns where a match starts (and how
 *  long it actually is) instead of just whether one exists -- used for
 *  snippet centering and highlight-range computation. length is always
 *  query.length in plain mode (the matched text IS the query), but in
 *  regex mode the actual matched text can be a different length than
 *  the pattern string itself (e.g. `\d+` matching "12345" is 5
 *  characters even though the pattern string is 3) -- returning the
 *  real matched length here, not assumed from the query string, is
 *  what makes the highlight range in makeSnippet below actually
 *  correct in regex mode. {index: -1, length: 0} when there's no
 *  match, matching String.indexOf's own -1 convention for the index
 *  half.
 * @param {string} text
 * @param {string} query
 * @param {boolean} useRegex
 */
function findMatchIndex(text, query, useRegex) {
  if (!useRegex) {
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    return { index, length: index === -1 ? 0 : query.length };
  }
  let re;
  try {
    re = emacsRegexToJs(query, 'i');
  } catch {
    return { index: -1, length: 0 }; // buildMatcher already threw earlier for an invalid pattern; this is just snippet-building, never reached with a truly invalid one
  }
  const m = re.exec(text);
  return m ? { index: m.index, length: m[0].length } : { index: -1, length: 0 };
}

/** Builds a short excerpt of `text` centered on wherever `query` first
 *  matches within it, for display in a search result row. Returns
 *  {text, highlightStart, highlightLength} rather than a plain string:
 *  highlightStart/highlightLength describe where the actual match sits
 *  WITHIN THE RETURNED text (already accounting for the leading
 *  ellipsis, if any), in a form a caller can wrap in a <mark> without
 *  having to re-run the search itself. highlightStart is -1 when there
 *  was no match at all (query is empty, or this snippet is for a
 *  heading that passed purely via a structured filter with nothing
 *  left over to highlight) -- callers should treat that as "render
 *  plain, no highlight" rather than trying to highlight a zero-length
 *  span at position -1.
 * @param {string} text
 * @param {string} query
 * @param {boolean} useRegex
 */
function makeSnippet(text, query, useRegex) {
  if (!query) return { text: text.length > 80 ? text.slice(0, 80) + '\u2026' : text, highlightStart: -1, highlightLength: 0 };
  const { index: idx, length: matchLength } = findMatchIndex(text, query, useRegex);
  if (idx === -1) return { text: text.length > 80 ? text.slice(0, 80) + '\u2026' : text, highlightStart: -1, highlightLength: 0 };
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + matchLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? '\u2026' : '';
  const suffix = end < text.length ? '\u2026' : '';
  const snippetText = prefix + text.slice(start, end) + suffix;
  return { text: snippetText, highlightStart: prefix.length + (idx - start), highlightLength: matchLength };
}

const KV_TOKEN_RE = /^([+-]?)([A-Za-z_][\w-]*):(.+)$/; // optional leading sign (bare/+ = must match, - = must not); key must start with a letter/underscore, not a digit -- rules out "10:30" (a time) being misread as key "10"

/**
 * Splits `query` into structured filter tokens. Recognized tokens,
 * each a single space-delimited word with no internal spaces:
 *   tag:urgent       heading must have this tag (via effectiveTags,
 *                     honoring tag inheritance the same as everywhere
 *                     else) -- also accepts | for "any of these":
 *   tag:urgent|blocked      has urgent OR blocked
 *   -tag:urgent|blocked     has NEITHER urgent NOR blocked
 *   todo:WORD        heading's TODO keyword must equal WORD exactly
 *                     (case-insensitive); todo:A|B for "either state"
 *   -todo:WORD       heading's TODO keyword must NOT equal WORD
 *   priority:X       heading's priority must equal X exactly; same
 *                     -/| support as todo above
 *   key:value        heading must have a property named `key` whose
 *                     value contains `value` (substring,
 *                     case-insensitive) -- anything not reserved as
 *                     tag:/todo:/priority: falls here; same -/| support
 *   +word / word     the entry (title, tags, TODO, priority,
 *                     properties, planning, AND body text -- the same
 *                     breadth searchTextWithinHeading always covered)
 *                     must contain this keyword somewhere. A bare word
 *                     with no sign at all means EXACTLY the same thing
 *                     as an explicit "+word" -- there's no toggle to
 *                     turn this on, every plain word in the query is
 *                     always a required keyword. "+" exists purely so
 *                     someone CAN write it explicitly if they want to;
 *                     it never changes what a word means.
 *   -word            the entry must NOT contain this keyword anywhere,
 *                     regardless of whether any "+"/bare word also
 *                     appears in the same query -- "-" always excludes
 *                     on its own, with no dependency on any other term.
 *
 * A bare key:value or +key:value both mean "must match" (+ is purely
 * for symmetry with -, not a distinct mode of its own). Multiple
 * keyword terms combine as an implicit AND, same as every other filter
 * here: `+computer +wifi -ethernet` means "contains computer, AND
 * contains wifi, AND does not contain ethernet" -- exactly matching
 * real org-mode's own org-search-view semantics for this same syntax
 * (Org Agenda Search, `C-c a s`).
 *
 * This is deliberately NOT a faithful subset of real org-mode's own
 * FULLER match-syntax beyond that (the tag/TODO-specific `+tag-tag/
 * TODO` form, or the fuller boolean query language with `&`/`|` and
 * `PRIORITY="A"`-style exact matches) -- `|` only ever combines
 * alternatives *within* one filter's own value (never across separate
 * filters, which stay implicit AND with no grouping/parentheses at
 * all) and `key:value` rather than quoted `=`, on the reasoning that
 * quotes and `=` cost more to type on a phone keyboard than they add
 * in clarity here, and cross-filter OR/parentheses cost a lot more
 * surface area to learn and use correctly than they'd earn back for
 * how rarely they're actually needed. See the module docstring for the
 * fuller design reasoning.
 *
 * Known, accepted ambiguity, not fully avoidable in a single free-text
 * box: a word that happens to start with `+`/`-` (a negative number, a
 * hyphenated word) or contains a `letters:something` pattern (a
 * mailto: link) can get misread as a filter token rather than literal
 * text -- there's no way to search for the literal text "-5" as a
 * keyword, for instance, short of regex mode. `scheme://` URLs (http://,
 * https://) are specifically excluded from the key:value pattern below,
 * since they're the single most likely false positive there; rarer
 * cases are a stated tradeoff, not a bug. `tag` is a reserved key the
 * same way `todo`/`priority` are -- a real property literally named
 * "tag" (an unusual choice; org itself expresses tags via a heading's
 * own `:tag1:tag2:` suffix, never a drawer property) isn't reachable
 * via `tag:value`, the one non-additive edge of this design.
 * @param {string} query
 * @returns {{ filters: SearchFilter[] }}
 */
function parseFilterQuery(query) {
  const tokens = query.split(/\s+/).filter(Boolean);
  /** @type {SearchFilter[]} */ const filters = [];

  for (const token of tokens) {
    const kv = KV_TOKEN_RE.exec(token);
    if (kv) {
      const [, sign, key, rawValue] = kv;
      if (rawValue.startsWith('//')) {
        // scheme://host -- almost certainly a URL (http://, https://,
        // etc.), not someone naming a property literally called
        // "http". Falls through to keyword treatment below.
      } else {
        const mode = sign === '-' ? 'exclude' : 'include';
        const values = rawValue.split('|').filter(Boolean);
        if (values.length === 0) {
          // e.g. a bare "key:|" with nothing meaningful either side of
          // the pipe -- falls through to keyword treatment below
          // rather than create a filter that could never match
          // anything.
        } else if (key.toLowerCase() === 'tag') {
          filters.push({ type: 'tag', mode, values });
          continue;
        } else if (key.toLowerCase() === 'todo') {
          filters.push({ type: 'todo', mode, values });
          continue;
        } else if (key.toLowerCase() === 'priority') {
          filters.push({ type: 'priority', mode, values });
          continue;
        } else {
          filters.push({ type: 'property', mode, key, values });
          continue;
        }
      }
    }

    // Not a structured key:value filter -- a keyword term. "-" always
    // excludes; a bare word and an explicit "+" both always include --
    // no toggle, no ordering dependency on any other term in the query.
    if (token.length > 1 && token[0] === '-') {
      filters.push({ type: 'keyword', mode: 'exclude', value: token.slice(1) });
    } else if (token.length > 1 && token[0] === '+') {
      filters.push({ type: 'keyword', mode: 'include', value: token.slice(1) });
    } else {
      filters.push({ type: 'keyword', mode: 'include', value: token });
    }
  }

  return { filters };
}

/** Whether `heading` satisfies every filter in `filters` (AND, not OR).
 *  An empty filter list always passes -- a query that's pure free text
 *  should search every heading, same as before filters existed. Tags
 *  and property KEYS match case-insensitively for lookup, since that's
 *  already how the rest of this app treats them elsewhere; property
 *  VALUES, TODO, and priority all match case-insensitively too, for
 *  consistency with the plain-text search mode's own default. No tag
 *  inheritance from ancestor headings -- a heading's OWN tags/properties
 *  only, a stated simplification versus real org's default inheritance
 *  behavior. */
/** Computes the effective tag set for `heading`, given its `ancestors`
 *  (root-to-parent order) -- the heading's own tags, plus (if
 *  `useInheritance`) every ancestor's own tags too, matching real
 *  org's own tag-inheritance model exactly: "if a heading has a
 *  certain tag, all subheadings inherit the tag as well." Without
 * @param {Heading} heading
 * @param {Heading[]} ancestors
 * @param {TagInheritance} useInheritance
 *  inheritance, this is just `heading.tags` itself. */
function effectiveTags(heading, ancestors, useInheritance) {
  return effectiveTagsOf(heading, ancestors, useInheritance || false);
}

/** Computes the effective value of property `key` for `heading`, given
 *  its `ancestors` (root-to-parent order) -- the heading's own value if
 *  it has one, otherwise (if `useInheritance`) the NEAREST ancestor's
 *  own value, matching real org's own property-inheritance model: a
 *  heading's own value always wins; inheritance only fills in when the
 *  heading doesn't define the property itself at all. Returns null if
 *  nothing in the chain defines it. Key lookup is case-insensitive,
 *  matching how property filters elsewhere in this app already work.
 * @param {Heading} heading
 * @param {Heading[]} ancestors
 * @param {string} key
 * @param {boolean} useInheritance
 */
function effectivePropertyValue(heading, ancestors, key, useInheritance) {
  const ownKey = (heading.propertyOrder || []).find((k) => k.toLowerCase() === key.toLowerCase());
  if (ownKey) return heading.properties[ownKey];
  if (!useInheritance) return null;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    // nearest ancestor first
    const ancestor = ancestors[i];
    const ancestorKey = (ancestor.propertyOrder || []).find((k) => k.toLowerCase() === key.toLowerCase());
    if (ancestorKey) return ancestor.properties[ancestorKey];
  }
  return null;
}

/**
 * @param {Heading} heading
 * @param {SearchFilter[]} filters
 * @param {Heading[]} ancestors
 * @param {TagInheritance} useTagInheritance
 * @param {boolean} usePropertyInheritance
 * @param {Map<string, Matcher>} keywordMatchers
 */
function headingPassesFilters(heading, filters, ancestors, useTagInheritance, usePropertyInheritance, keywordMatchers) {
  for (const filter of filters) {
    let matched;
    if (filter.type === 'tag') {
      const tags = effectiveTags(heading, ancestors, useTagInheritance);
      matched = filter.values.some((v) => tags.some((t) => t.toLowerCase() === v.toLowerCase()));
    } else if (filter.type === 'todo') {
      matched = !!heading.todo && filter.values.some((v) => /** @type {string} */ (heading.todo).toLowerCase() === v.toLowerCase());
    } else if (filter.type === 'priority') {
      matched = !!heading.priority && filter.values.some((v) => /** @type {string} */ (heading.priority).toLowerCase() === v.toLowerCase());
    } else if (filter.type === 'property') {
      const propValue = effectivePropertyValue(heading, ancestors, filter.key, usePropertyInheritance);
      matched = propValue !== null && filter.values.some((v) => propValue.toLowerCase().includes(v.toLowerCase()));
    } else if (filter.type === 'keyword') {
      matched = headingContainsKeyword(heading, /** @type {Matcher} */ (keywordMatchers.get(filter.value)));
    } else {
      continue;
    }
    if (filter.mode === 'include' && !matched) return false;
    if (filter.mode === 'exclude' && matched) return false;
  }
  return true;
}

/**
 * @param {import('./types.js').ListItem[]} items
 * @param {Matcher} matches
 */
function listContainsKeyword(items, matches) {
  for (const item of items) {
    if (matches(item.text)) return true;
    for (const nested of item.children || []) {
      if (listContainsKeyword(nested.items, matches)) return true;
    }
  }
  return false;
}

/**
 * @param {import('./types.js').BodyNode[]} bodyNodes
 * @param {Matcher} matches
 */
function bodyContainsKeyword(bodyNodes, matches) {
  for (const node of bodyNodes || []) {
    if (node.type === 'paragraph') {
      if (matches(node.lines.join(' '))) return true;
    } else if (node.type === 'list') {
      if (listContainsKeyword(node.items, matches)) return true;
    } else if (node.type === 'table') {
      for (const row of node.rows) {
        if (row.type !== 'row') continue;
        for (const cell of row.cells) {
          if (matches(cell)) return true;
        }
      }
    } else if (node.type === 'block') {
      if (matches((node.lines || []).join(' '))) return true;
    }
  }
  return false;
}

/** Boolean-only check: does `heading`'s entry (title, tags, TODO,
 *  priority, properties, planning, and body content) contain a match
 *  for `matches` anywhere? A deliberate, lightweight parallel to
 *  searchTextWithinHeading/walkBodyForMatches/walkListForMatches below
 *  (same breadth, same "what counts as searchable" set), not a reuse
 *  of those -- this only needs a yes/no answer for the keyword filter
 *  gate, so building full result objects with snippets just to check
 *  .length>0 would be pure waste. The real cost of the duplication:
 *  if what counts as "searchable" content ever changes, both this and
 * @param {Heading} heading
 * @param {Matcher} matches
 *  searchTextWithinHeading's own walk need updating together. */
function headingContainsKeyword(heading, matches) {
  if (matches(heading.title)) return true;
  if ((heading.tags || []).some((t) => matches(t))) return true;
  if (heading.todo && matches(heading.todo)) return true;
  if (heading.priority && matches(heading.priority)) return true;
  for (const key of heading.propertyOrder || []) {
    if (matches(key) || matches(heading.properties[key] ?? '')) return true;
  }
  if (heading.planning) {
    if (heading.planning.scheduled && matches(heading.planning.scheduled)) return true;
    if (heading.planning.deadline && matches(heading.planning.deadline)) return true;
  }
  return bodyContainsKeyword(heading.body, matches);
}

/**
 * @param {SearchResult[]} results
 * @param {Heading} heading
 * @param {import('./types.js').ListItem[]} items
 * @param {string} query
 * @param {Matcher} matches
 * @param {boolean} useRegex
 */
function walkListForMatches(results, heading, items, query, matches, useRegex) {
  for (const item of items) {
    if (matches(item.text)) {
      results.push({ type: 'list-item', heading, node: item, snippet: makeSnippet(item.text, query, useRegex) });
    }
    for (const nested of item.children || []) {
      walkListForMatches(results, heading, nested.items, query, matches, useRegex);
    }
  }
}

/**
 * @param {SearchResult[]} results
 * @param {Heading} heading
 * @param {import('./types.js').BodyNode[]} bodyNodes
 * @param {string} query
 * @param {Matcher} matches
 * @param {boolean} useRegex
 */
function walkBodyForMatches(results, heading, bodyNodes, query, matches, useRegex) {
  for (const node of bodyNodes || []) {
    if (node.type === 'paragraph') {
      const text = node.lines.join(' ');
      if (matches(text)) {
        results.push({ type: 'paragraph', heading, node, snippet: makeSnippet(text, query, useRegex) });
      }
    } else if (node.type === 'list') {
      walkListForMatches(results, heading, node.items, query, matches, useRegex);
    } else if (node.type === 'table') {
      for (const row of node.rows) {
        if (row.type !== 'row') continue;
        for (const cell of row.cells) {
          if (matches(cell)) {
            results.push({ type: 'table', heading, node, snippet: makeSnippet(cell, query, useRegex) });
            break; // one hit per table is enough to surface it as a result
          }
        }
      }
    } else if (node.type === 'block') {
      const text = (node.lines || []).join(' ');
      if (matches(text)) {
        results.push({ type: 'block', heading, node, snippet: makeSnippet(text, query, useRegex) });
      }
    }
  }
}

/** Runs a single keyword's own text search (title/tags/todo/priority,
 *  properties, planning, body content) against a heading that has
 *  already passed the filter gate, pushing onto `results` -- one call
 *  per include-type keyword filter (see searchOneDocument below), so a
 *  heading matching several required keywords in different fields
 *  correctly produces one separately-highlighted row per match rather
 * @param {SearchResult[]} results
 * @param {Heading} node
 * @param {string} q
 * @param {Matcher} matches
 * @param {boolean} useRegex
 *  than a single row that can only highlight one of them. */
function searchTextWithinHeading(results, node, q, matches, useRegex) {
  const titleMatch = matches(node.title);
  const tagMatch = (node.tags || []).some((t) => matches(t));
  const todoMatch = !!node.todo && matches(node.todo);
  const priorityMatch = !!node.priority && matches(node.priority);
  if (titleMatch || tagMatch || todoMatch || priorityMatch) {
    results.push({ type: 'heading', heading: node, node, snippet: makeSnippet(node.title, q, useRegex) });
  }

  // Properties: a heading's structured key/value data, distinct from
  // its prose body — matching either the key or the value (searching
  // "spouse" should find a heading with a :spouse: property just as
  // readily as searching the value it holds).
  for (const key of node.propertyOrder || []) {
    const value = node.properties[key] ?? '';
    if (matches(key) || matches(value)) {
      results.push({ type: 'property', heading: node, node, snippet: makeSnippet(`${key}: ${value}`, q, useRegex) });
    }
  }

  // SCHEDULED/DEADLINE planning timestamps — raw stored text (e.g.
  // "<2026-05-15 Fri +1y>"), not the same thing as the plain
  // title-timestamp convention findTimestamps elsewhere deals with;
  // this is specifically the two dedicated planning-line fields.
  if (node.planning) {
    if (node.planning.scheduled && matches(node.planning.scheduled)) {
      results.push({ type: 'planning', heading: node, node, snippet: makeSnippet('SCHEDULED: ' + node.planning.scheduled, q, useRegex) });
    }
    if (node.planning.deadline && matches(node.planning.deadline)) {
      results.push({ type: 'planning', heading: node, node, snippet: makeSnippet('DEADLINE: ' + node.planning.deadline, q, useRegex) });
    }
  }

  walkBodyForMatches(results, node, node.body, q, matches, useRegex);
}

/** The actual per-document heading walk, shared between searchDocument
 *  (a single document) and searchDocuments (many at once) below --
 *  everything about parsing the query and building matchers stays
 *  common to both; only this walk itself needs to repeat per file.
 *  keywordMatchers is a value -> matcher Map built ONCE by the caller
 *  (not once per heading), so a query with many keyword terms doesn't
 *  recompile a regex (or rebuild a closure) on every single heading in
 * @param {Doc} doc
 * @param {SearchFilter[]} filters
 * @param {Map<string, Matcher>} keywordMatchers
 * @param {boolean} useRegex
 * @param {TagInheritance} useTagInheritance
 * @param {boolean} usePropertyInheritance
 *  the document. */
function searchOneDocument(doc, filters, keywordMatchers, useRegex, useTagInheritance, usePropertyInheritance) {
  /** @type {any[]} */ const results = [];
  const includeKeywords = filters.filter(/** @param {SearchFilter} f @returns {f is { type: 'keyword', mode: string, value: string }} */ (f) => f.type === 'keyword' && f.mode === 'include');

  /**
   * @param {Heading[]} nodes
   * @param {Heading[]} ancestors
   */
  function walk(nodes, ancestors) {
    for (const node of nodes) {
      if (node.type !== 'heading') continue;

      if (headingPassesFilters(node, filters, ancestors, useTagInheritance, usePropertyInheritance, keywordMatchers)) {
        if (includeKeywords.length > 0) {
          // One pass per required keyword -- see searchTextWithinHeading's
          // own doc comment for why this isn't collapsed into a single
          // combined pass.
          for (const kw of includeKeywords) {
            searchTextWithinHeading(results, node, kw.value, /** @type {Matcher} */ (keywordMatchers.get(kw.value)), useRegex);
          }
        } else {
          // Passed purely via structured filters (tag:/todo:/priority:/
          // key:value) with no keyword terms at all -- nothing to
          // highlight, the heading itself IS the result.
          results.push({ type: 'heading', heading: node, node, snippet: { text: node.title, highlightStart: -1, highlightLength: 0 } });
        }
      }

      walk(node.children || [], [...ancestors, node]); // always recurse regardless of whether THIS heading passed -- filters are per-heading (with inheritance now folded into that per-heading check itself), not a separate pass-down-to-children step
    }
  }

  walk(doc.children, []);
  return results;
}

/** Builds a value -> matcher Map for every keyword filter in `filters`,
 *  once, up front -- shared by searchDocument/searchDocuments below so
 *  neither the gate check (headingPassesFilters) nor the per-heading
 *  snippet search (searchTextWithinHeading) ever recompiles the same
 *  pattern per heading. Building every matcher here, before any
 *  results are computed, is also what makes an invalid regex throw
 *  once with a clear error rather than failing deep inside the walk on
 * @param {SearchFilter[]} filters
 * @param {boolean} useRegex
 *  whichever heading happens to trigger it first. */
function buildKeywordMatchers(filters, useRegex) {
  const map = new Map();
  for (const f of filters) {
    if (f.type === 'keyword' && !map.has(f.value)) map.set(f.value, buildMatcher(f.value, useRegex));
  }
  return map;
}

/**
 * @param {Doc} doc
 * @param {string} query
 */
export function searchDocument(doc, query, opts = /** @type {SearchOptions} */ ({})) {
  const { useRegex = false, useTagInheritance = true, usePropertyInheritance = false } = opts;
  const trimmed = String(query).trim();
  if (!trimmed) return [];

  const { filters } = parseFilterQuery(trimmed);
  const keywordMatchers = buildKeywordMatchers(filters, useRegex); // throws here on an invalid regex, before any results are built

  return searchOneDocument(doc, filters, keywordMatchers, useRegex, useTagInheritance, usePropertyInheritance);
}

/**
 * @param {{ documentId: string, doc: Doc }[]} docs
 * @param {string} query
 */
export function searchDocuments(docs, query, opts = /** @type {SearchOptions} */ ({})) {
  const { useRegex = false, useTagInheritance = true, usePropertyInheritance = false } = opts;
  const trimmed = String(query).trim();
  if (!trimmed) return [];

  const { filters } = parseFilterQuery(trimmed);
  const keywordMatchers = buildKeywordMatchers(filters, useRegex); // built ONCE, not once per document -- an invalid regex throws a single clear error, not one per file

  const results = [];
  for (const { documentId, doc } of docs) {
    for (const result of searchOneDocument(doc, filters, keywordMatchers, useRegex, useTagInheritance, usePropertyInheritance)) {
      results.push({ ...result, documentId });
    }
  }
  return results;
}

/** What the matcher reads of a heading: its keyword, tags, level, category, and any property (special ones like PRIORITY and DEADLINE
 *  included, as `org-entry-get` answers them).
 * @param {Heading} heading
 * @param {Heading[]} ancestors
 * @param {TagInheritance} useTagInheritance
 * @param {boolean} usePropertyInheritance
 * @param {string} fileCategory
 * @returns {import('./tags-match.js').MatchEntry}
 */
function buildMatchEntry(heading, ancestors, useTagInheritance, usePropertyInheritance, fileCategory) {
  const all = effectiveTags(heading, ancestors, useTagInheritance);
  return {
    tags: all,
    todo: heading.todo || null,
    level: heading.level,
    category: effectivePropertyValue(heading, ancestors, 'CATEGORY', true) || fileCategory,
    property(name) {
      switch (name) {
        case 'PRIORITY':
          return heading.priority || 'B';
        case 'DEADLINE':
          return heading.planning?.deadline || null;
        case 'SCHEDULED':
          return heading.planning?.scheduled || null;
        case 'CLOSED':
          return heading.planning?.closed || null;
        case 'ITEM':
          return heading.title;
        case 'TAGS':
          return heading.tags && heading.tags.length ? `:${heading.tags.join(':')}:` : null;
        case 'ALLTAGS':
          return all.length ? `:${all.join(':')}:` : null;
        default:
          return effectivePropertyValue(heading, ancestors, name, usePropertyInheritance);
      }
    },
  };
}

/** Searches `docs` with the match language of `org-make-tags-matcher` (see tags-match.js), as Emacs's `C-c / m` does.
 *  Text the language does not read is left unread, as Emacs leaves it, so no query throws.
 * @param {{ documentId: string, doc: Doc }[]} docs
 * @param {string} query
 */
export function searchDocumentsByMatchQuery(docs, query, opts = /** @type {SearchOptions} */ ({})) {
  const { useTagInheritance = true, usePropertyInheritance = false } = opts;
  const trimmed = String(query).trim();
  if (!trimmed) return [];

  const matcher = makeTagsMatcher(trimmed, { doneKeywords: opts.doneKeywords, tagGroups: opts.tagGroups, now: opts.now });

  /** @type {any[]} */ const results = [];
  for (const { documentId, doc } of docs) {
    const kw = (doc.keywords || []).find((k) => k.key.toUpperCase() === 'CATEGORY');
    const fileCategory = kw && kw.value.trim() ? kw.value.trim() : (String(documentId).split('/').pop() || '').replace(/\.org$/i, '');
    /**
     * @param {Heading[]} nodes
     * @param {Heading[]} ancestors
     */
    function walk(nodes, ancestors) {
      for (const node of nodes) {
        if (node.type !== 'heading') continue;
        if (matcher.test(buildMatchEntry(node, ancestors, useTagInheritance, usePropertyInheritance, fileCategory))) {
          results.push({ type: 'heading', heading: node, node, documentId, snippet: { text: node.title, highlightStart: -1, highlightLength: 0 } });
        }
        walk(node.children || [], [...ancestors, node]);
      }
    }
    walk(doc.children, []);
  }
  return results;
}

export { parseFilterQuery, effectiveTags, effectivePropertyValue };
