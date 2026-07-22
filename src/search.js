/**
 * Whole-document search — walks the full tree regardless of current fold
 * state (a folded heading's content is still searchable, it just isn't
 * currently rendered), matching heading titles, tags, and every kind of
 * body content: paragraphs, list items, table cells, and block content.
 *
 * Returns a flat array of match records in document order, each carrying
 * enough to render a result row and navigate to it:
 *   { type, heading, node, snippet }
 * `heading` is always the owning heading (for a heading-title match,
 * that's the same as `node`). `snippet` is a short excerpt with the
 * match roughly centered, for display in a results list.
 */

const SNIPPET_RADIUS = 40;

function makeSnippet(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return text.length > 80 ? text.slice(0, 80) + '\u2026' : text;
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS);
  return (start > 0 ? '\u2026' : '') + text.slice(start, end) + (end < text.length ? '\u2026' : '');
}

function walkListForMatches(results, heading, items, query) {
  for (const item of items) {
    if (item.text.toLowerCase().includes(query)) {
      results.push({ type: 'list-item', heading, node: item, snippet: makeSnippet(item.text, query) });
    }
    for (const nested of item.children || []) {
      walkListForMatches(results, heading, nested.items, query);
    }
  }
}

function walkBodyForMatches(results, heading, bodyNodes, query) {
  for (const node of bodyNodes || []) {
    if (node.type === 'paragraph') {
      const text = node.lines.join(' ');
      if (text.toLowerCase().includes(query)) {
        results.push({ type: 'paragraph', heading, node, snippet: makeSnippet(text, query) });
      }
    } else if (node.type === 'list') {
      walkListForMatches(results, heading, node.items, query);
    } else if (node.type === 'table') {
      for (const row of node.rows) {
        if (row.type !== 'row') continue;
        for (const cell of row.cells) {
          if (cell.toLowerCase().includes(query)) {
            results.push({ type: 'table', heading, node, snippet: makeSnippet(cell, query) });
            break; // one hit per table is enough to surface it as a result
          }
        }
      }
    } else if (node.type === 'block') {
      const text = (node.lines || []).join(' ');
      if (text.toLowerCase().includes(query)) {
        results.push({ type: 'block', heading, node, snippet: makeSnippet(text, query) });
      }
    }
  }
}

export function searchDocument(doc, query) {
  const q = String(query).trim().toLowerCase();
  if (!q) return [];
  const results = [];

  function walk(nodes) {
    for (const node of nodes) {
      if (node.type !== 'heading') continue;
      const titleMatch = node.title.toLowerCase().includes(q);
      const tagMatch = (node.tags || []).some((t) => t.toLowerCase().includes(q));
      if (titleMatch || tagMatch) {
        results.push({ type: 'heading', heading: node, node, snippet: node.title });
      }
      walkBodyForMatches(results, node, node.body, q);
      walk(node.children || []);
    }
  }

  walk(doc.children);
  return results;
}
