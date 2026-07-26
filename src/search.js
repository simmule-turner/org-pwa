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
 * On top of that, the query can contain filter tokens — see
 * parseFilterQuery below — that restrict which HEADINGS are searched at
 * all, before any text matching happens: `+tag`, `-tag`, `todo:KEYWORD`,
 * `priority:X`, and `key:value` for an arbitrary property. Filters
 * combine with each other and with any leftover free text as an
 * implicit AND — `+work todo:WAITING budget` means "tagged work, AND in
 * WAITING state, AND containing 'budget' somewhere." This is NOT org's
 * own match-syntax (no OR, no parentheses, no exact-match `=`) — a
 * deliberately smaller, single-box design; see parseFilterQuery's own
 * docs for the reasoning and the specific ambiguities this trades off.
 *
 * Returns a flat array of match records in document order, each carrying
 * enough to render a result row and navigate to it:
 *   { type, heading, node, snippet }
 * `heading` is always the owning heading (for a heading-level match —
 * title, tags, TODO, priority — that's the same as `node`; for a
 * property or planning match, `node` is also the heading itself, since
 * neither has its own separate body node the way a paragraph or list
 * item does).
 */

const SNIPPET_RADIUS = 40;

/** Builds a matcher for `query`: plain mode does a case-insensitive
 *  substring test; regex mode compiles `query` as a case-insensitive
 *  RegExp. Throws a plain Error with a clear message on an invalid
 *  regex pattern, rather than silently matching nothing — an unparsable
 *  pattern and "no results" are different situations a caller should be
 *  able to tell apart and surface differently. */
function buildMatcher(query, useRegex) {
  if (!useRegex) {
    const q = query.toLowerCase();
    return (text) => text.toLowerCase().includes(q);
  }
  let re;
  try {
    re = new RegExp(query, 'i');
  } catch (err) {
    throw new Error('Invalid regex: ' + err.message);
  }
  return (text) => re.test(text);
}

/** Same idea as buildMatcher, but returns the position of the match (for
 *  snippet centering) instead of just whether one exists. -1 when there
 *  is no match, matching String.indexOf's own convention. */
function findMatchIndex(text, query, useRegex) {
  if (!useRegex) return text.toLowerCase().indexOf(query.toLowerCase());
  let re;
  try {
    re = new RegExp(query, 'i');
  } catch {
    return -1; // buildMatcher already threw earlier for an invalid pattern; this is just snippet-building, never reached with a truly invalid one
  }
  const m = re.exec(text);
  return m ? m.index : -1;
}

function makeSnippet(text, query, useRegex) {
  const idx = findMatchIndex(text, query, useRegex);
  if (idx === -1) return text.length > 80 ? text.slice(0, 80) + '\u2026' : text;
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS);
  return (start > 0 ? '\u2026' : '') + text.slice(start, end) + (end < text.length ? '\u2026' : '');
}

const TAG_TOKEN_RE = /^[+-][\w@#%-]+$/; // org's own tag character set, roughly -- word chars plus a few punctuation marks org itself allows in tags
const KV_TOKEN_RE = /^([A-Za-z_][\w-]*):(.+)$/; // key must start with a letter/underscore, not a digit -- rules out "10:30" (a time) being misread as key "10"

/**
 * Splits `query` into structured filter tokens and leftover free text.
 * Recognized tokens, each a single space-delimited word with no
 * internal spaces:
 *   +tag        heading must have this tag
 *   -tag        heading must NOT have this tag
 *   todo:WORD   heading's TODO keyword must equal WORD exactly (case-insensitive)
 *   priority:X  heading's priority must equal X exactly (case-insensitive)
 *   key:value   heading must have a property named `key` whose value
 *               contains `value` (substring, case-insensitive) --
 *               anything not reserved as todo:/priority: falls here
 * Anything that doesn't match one of these becomes ordinary free text,
 * joined back together and matched exactly as it already was before
 * filters existed (title/tags/todo/priority/properties/planning/body,
 * via `useRegex` same as any other query).
 *
 * This is deliberately NOT a faithful subset of real org-mode's own
 * match-syntax (`org-search-view`'s `+tag-tag/TODO`, or the fuller
 * boolean query language with `&`/`|` and `PRIORITY="A"`-style exact
 * matches) -- a single unified box that also does free text, with
 * simpler AND-only combining and `key:value` rather than quoted `=`,
 * on the reasoning that quotes and `=` cost more to type on a phone
 * keyboard than they add in clarity here. See the module docstring for
 * the fuller design reasoning.
 *
 * Known, accepted ambiguity, not fully avoidable in a single free-text
 * box: a word that happens to start with `+`/`-` (a negative number, a
 * hyphenated word) or contains a `letters:something` pattern (a
 * mailto: link) can get misread as a filter token rather than literal
 * text. `scheme://` URLs (http://, https://) are specifically excluded
 * from the key:value pattern below, since they're the single most
 * likely false positive; rarer cases are a stated tradeoff, not a bug.
 */
function parseFilterQuery(query) {
  const tokens = query.split(/\s+/).filter(Boolean);
  const filters = [];
  const freeWords = [];

  for (const token of tokens) {
    if (TAG_TOKEN_RE.test(token) && token.length > 1) {
      filters.push({ type: 'tag', mode: token[0] === '+' ? 'include' : 'exclude', value: token.slice(1) });
      continue;
    }
    const kv = KV_TOKEN_RE.exec(token);
    if (kv) {
      const [, key, value] = kv;
      if (value.startsWith('//')) {
        // scheme://host -- almost certainly a URL (http://, https://,
        // etc.), not someone naming a property literally called
        // "http". Falls through to free text.
      } else if (key.toLowerCase() === 'todo') {
        filters.push({ type: 'todo', value });
        continue;
      } else if (key.toLowerCase() === 'priority') {
        filters.push({ type: 'priority', value });
        continue;
      } else {
        filters.push({ type: 'property', key, value });
        continue;
      }
    }
    freeWords.push(token);
  }

  return { filters, freeText: freeWords.join(' ') };
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
function headingPassesFilters(heading, filters) {
  for (const filter of filters) {
    if (filter.type === 'tag') {
      const hasTag = (heading.tags || []).some((t) => t.toLowerCase() === filter.value.toLowerCase());
      if (filter.mode === 'include' && !hasTag) return false;
      if (filter.mode === 'exclude' && hasTag) return false;
    } else if (filter.type === 'todo') {
      if (!heading.todo || heading.todo.toLowerCase() !== filter.value.toLowerCase()) return false;
    } else if (filter.type === 'priority') {
      if (!heading.priority || heading.priority.toLowerCase() !== filter.value.toLowerCase()) return false;
    } else if (filter.type === 'property') {
      const foundKey = (heading.propertyOrder || []).find((k) => k.toLowerCase() === filter.key.toLowerCase());
      if (!foundKey) return false;
      const value = heading.properties[foundKey] || '';
      if (!value.toLowerCase().includes(filter.value.toLowerCase())) return false;
    }
  }
  return true;
}

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

/** Runs the free-text search (title/tags/todo/priority, properties,
 *  planning, body content) against a single heading that has already
 *  passed the filter gate, pushing onto `results`. Split out from
 *  searchDocument's own walk so it can be skipped entirely for a
 *  filters-only query (see below) without duplicating the traversal. */
function searchTextWithinHeading(results, node, q, matches, useRegex) {
  const titleMatch = matches(node.title);
  const tagMatch = (node.tags || []).some((t) => matches(t));
  const todoMatch = !!node.todo && matches(node.todo);
  const priorityMatch = !!node.priority && matches(node.priority);
  if (titleMatch || tagMatch || todoMatch || priorityMatch) {
    results.push({ type: 'heading', heading: node, node, snippet: node.title });
  }

  // Properties: a heading's structured key/value data, distinct from
  // its prose body — matching either the key or the value (searching
  // "spouse" should find a heading with a :spouse: property just as
  // readily as searching the value it holds).
  for (const key of node.propertyOrder || []) {
    const value = node.properties[key] ?? '';
    if (matches(key) || matches(value)) {
      results.push({ type: 'property', heading: node, node, snippet: `${key}: ${value}` });
    }
  }

  // SCHEDULED/DEADLINE planning timestamps — raw stored text (e.g.
  // "<2026-05-15 Fri +1y>"), not the same thing as the plain
  // title-timestamp convention findTimestamps elsewhere deals with;
  // this is specifically the two dedicated planning-line fields.
  if (node.planning) {
    if (node.planning.scheduled && matches(node.planning.scheduled)) {
      results.push({ type: 'planning', heading: node, node, snippet: 'SCHEDULED: ' + node.planning.scheduled });
    }
    if (node.planning.deadline && matches(node.planning.deadline)) {
      results.push({ type: 'planning', heading: node, node, snippet: 'DEADLINE: ' + node.planning.deadline });
    }
  }

  walkBodyForMatches(results, node, node.body, q, matches, useRegex);
}

export function searchDocument(doc, query, opts = {}) {
  const { useRegex = false } = opts;
  const trimmed = String(query).trim();
  if (!trimmed) return [];

  const { filters, freeText } = parseFilterQuery(trimmed);
  // A pure filter query with no leftover text (e.g. "+work todo:WAITING")
  // has nothing to run a text search for -- every heading that passes
  // the filter gate IS the result, in its own right, rather than one of
  // its fields having matched some text.
  const matches = freeText ? buildMatcher(freeText, useRegex) : null; // throws here on an invalid regex, before any results are built

  const results = [];

  function walk(nodes) {
    for (const node of nodes) {
      if (node.type !== 'heading') continue;

      if (headingPassesFilters(node, filters)) {
        if (matches) {
          searchTextWithinHeading(results, node, freeText, matches, useRegex);
        } else {
          results.push({ type: 'heading', heading: node, node, snippet: node.title });
        }
      }

      walk(node.children || []); // always recurse regardless of whether THIS heading passed -- filters are per-heading, not inherited by children (see headingPassesFilters' own docs)
    }
  }

  walk(doc.children);
  return results;
}

export { parseFilterQuery };
