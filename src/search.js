/**
 * Whole-document search — walks the full tree regardless of current fold
 * state (a folded heading's content is still searchable, it just isn't
 * currently rendered), matching heading titles/tags/TODO keyword/priority,
 * every kind of body content (paragraphs, list items, table cells, block
 * content), and a heading's structured data: properties (key or value)
 * and SCHEDULED/DEADLINE planning timestamps.
 *
 * Supports two modes: plain substring (the default, case-insensitive,
 * and the only mode that treats regex special characters as literal
 * text) and regex (`opts.useRegex: true`), for anyone who actually wants
 * pattern matching rather than a literal phrase. Plain mode is the
 * default deliberately — most searches are "find this word," and a
 * query containing `.` or `(` shouldn't need escaping to work as
 * expected.
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

export function searchDocument(doc, query, opts = {}) {
  const { useRegex = false } = opts;
  const q = String(query).trim();
  if (!q) return [];
  const matches = buildMatcher(q, useRegex); // throws here on an invalid regex, before any results are built
  const results = [];

  function walk(nodes) {
    for (const node of nodes) {
      if (node.type !== 'heading') continue;

      const titleMatch = matches(node.title);
      const tagMatch = (node.tags || []).some((t) => matches(t));
      const todoMatch = !!node.todo && matches(node.todo);
      const priorityMatch = !!node.priority && matches(node.priority);
      if (titleMatch || tagMatch || todoMatch || priorityMatch) {
        results.push({ type: 'heading', heading: node, node, snippet: node.title });
      }

      // Properties: a heading's structured key/value data, distinct
      // from its prose body — matching either the key or the value
      // (searching "spouse" should find a heading with a :spouse:
      // property just as readily as searching the value it holds).
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
          results.push({
            type: 'planning',
            heading: node,
            node,
            snippet: 'SCHEDULED: ' + node.planning.scheduled,
          });
        }
        if (node.planning.deadline && matches(node.planning.deadline)) {
          results.push({
            type: 'planning',
            heading: node,
            node,
            snippet: 'DEADLINE: ' + node.planning.deadline,
          });
        }
      }

      walkBodyForMatches(results, node, node.body, q, matches, useRegex);
      walk(node.children || []);
    }
  }

  walk(doc.children);
  return results;
}
