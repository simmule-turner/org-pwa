/**
 * Converts an org document (or a single heading's subtree) to a
 * complete, standalone HTML document. Pure and DOM-free — walks the
 * same parsed AST org-parser.js and outline-view-model.js already
 * produce.
 *
 * Deliberately includes print CSS (`@media print`, sensible margins,
 * `break-inside`/`break-after: avoid` on headings and tables) rather
 * than treating printing as a separate concern: the browser's own
 * "Print \u2192 Save as PDF" is a mature, standards-compliant pagination
 * engine that handles page breaks and table continuation far better
 * than a hand-rolled PDF generator would, and needs no new dependency
 * to get there — so PDF export is a property of doing HTML export
 * well, not a third format to build separately.
 *
 * Scope, escaping conventions, and what's dropped on export (property
 * drawers, ARCHIVE_* properties) all match export-markdown.js's own
 * documented decisions exactly — see that file's header for the full
 * reasoning, which applies here without change.
 */

import { parseInline } from './inline-markup.js';
import { resolveTodoSequence } from './todo-cycle.js';

// ---- escaping ---------------------------------------------------------

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// ---- inline rendering -----------------------------------------------------

function renderInlineListHtml(nodes) {
  return nodes.map(renderInlineNodeHtml).join('');
}

function renderInlineNodeHtml(node) {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);
    case 'bold':
      return `<strong>${renderInlineListHtml(node.children)}</strong>`;
    case 'italic':
      return `<em>${renderInlineListHtml(node.children)}</em>`;
    case 'underline':
      return `<u>${renderInlineListHtml(node.children)}</u>`;
    case 'strikethrough':
      return `<del>${renderInlineListHtml(node.children)}</del>`;
    case 'code':
    case 'verbatim':
      return `<code>${escapeHtml(node.value)}</code>`;
    case 'subscript':
      return `<sub>${escapeHtml(node.value)}</sub>`;
    case 'superscript':
      return `<sup>${escapeHtml(node.value)}</sup>`;
    case 'link': {
      const label = node.description ? renderTextHtml(node.description) : escapeHtml(node.target);
      return `<a href="${escapeHtml(node.target)}">${label}</a>`;
    }
    case 'image':
      return `<img src="${escapeHtml(node.target)}" alt="">`;
    case 'comment':
      return ''; // matches real org's own export behavior -- comments never appear in exported output
    default:
      return '';
  }
}

function renderTextHtml(text) {
  return renderInlineListHtml(parseInline(text));
}

// ---- body content -----------------------------------------------------

function renderParagraphHtml(node) {
  return '<p>' + node.lines.map(renderTextHtml).join('<br>') + '</p>';
}

function renderListItemsHtml(items) {
  const isCheckbox = items.some((it) => it.checkbox !== null);
  const isOrdered = !isCheckbox && items.length > 0 && items[0].ordered;
  const tag = isOrdered ? 'ol' : 'ul';
  const startAttr = isOrdered && items[0].startValue != null ? ` start="${items[0].startValue}"` : '';
  const rows = items.map((item) => {
    let inner = renderInlineListHtml(item.inline);
    if (item.checkbox !== null) {
      const checked = item.checkbox === 'X' ? ' checked' : '';
      inner = `<input type="checkbox" disabled${checked}> ${inner}`;
    }
    if (item.tag) {
      inner = `<strong>${renderTextHtml(item.tag)}:</strong> ${inner}`;
    }
    const nested = (item.children || []).map((nestedList) => renderListHtml(nestedList)).join('');
    return `<li>${inner}${nested}</li>`;
  });
  return `<${tag}${startAttr}>${rows.join('')}</${tag}>`;
}

function renderListHtml(list) {
  return renderListItemsHtml(list.items);
}

function renderTableHtml(table) {
  const dataRows = table.rows.filter((r) => r.type === 'row');
  if (dataRows.length === 0) return '';
  const [headerRow, ...bodyRows] = dataRows;
  const head = '<tr>' + headerRow.cellsInline.map((c) => `<th>${renderInlineListHtml(c)}</th>`).join('') + '</tr>';
  const body = bodyRows
    .map((row) => '<tr>' + row.cellsInline.map((c) => `<td>${renderInlineListHtml(c)}</td>`).join('') + '</tr>')
    .join('');
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderBlockHtml(block) {
  const name = block.name;
  if (name === 'COMMENT') return '';
  if (name === 'QUOTE') {
    return '<blockquote>' + block.lines.map((l) => renderTextHtml(l)).join('<br>') + '</blockquote>';
  }
  if (name === 'SRC') {
    const lang = block.params.split(/\s+/)[0] || '';
    const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    return `<pre><code${langClass}>${escapeHtml(block.lines.join('\n'))}</code></pre>`;
  }
  return `<pre><code>${escapeHtml(block.lines.join('\n'))}</code></pre>`;
}

function renderBodyNodeHtml(node) {
  if (node.type === 'list') return renderListHtml(node);
  if (node.type === 'paragraph') return renderParagraphHtml(node);
  if (node.type === 'table') return renderTableHtml(node);
  if (node.type === 'block') return renderBlockHtml(node);
  if (node.type === 'hr') return '<hr>';
  return '';
}

// ---- headings -----------------------------------------------------------

function renderPlanningHtml(planning) {
  if (!planning) return '';
  const parts = [];
  if (planning.scheduled) parts.push(`Scheduled: ${escapeHtml(planning.scheduled)}`);
  if (planning.deadline) parts.push(`Deadline: ${escapeHtml(planning.deadline)}`);
  if (parts.length === 0) return '';
  return `<p class="planning">${parts.join(' &mdash; ')}</p>`;
}

/** HTML only has h1\u2013h6 -- an org heading deeper than level 6 clamps
 *  to h6 rather than producing an invalid tag, the same reasonable
 *  fallback most org HTML exporters use. */
function clampHeadingLevel(level) {
  return Math.min(6, Math.max(1, level));
}

function renderHeadingLineHtml(heading, level, doneKeywords) {
  const tag = 'h' + clampHeadingLevel(level);
  const parts = [];
  if (heading.todo) {
    const cls = doneKeywords.includes(heading.todo) ? 'todo-keyword done' : 'todo-keyword';
    parts.push(`<span class="${cls}">${escapeHtml(heading.todo)}</span>`);
  }
  if (heading.priority) parts.push(`<span class="priority">[#${escapeHtml(heading.priority)}]</span>`);
  parts.push(renderTextHtml(heading.title) || '(untitled)');
  let inner = parts.join(' ');
  if (heading.tags && heading.tags.length) {
    inner += ' <span class="tags">' + heading.tags.map((t) => `<code>${escapeHtml(t)}</code>`).join('') + '</span>';
  }
  return `<${tag}>${inner}</${tag}>`;
}

function renderHeadingHtml(heading, levelOffset, doneKeywords, out) {
  out.push(renderHeadingLineHtml(heading, heading.level - levelOffset, doneKeywords));

  const planningLine = renderPlanningHtml(heading.planning);
  if (planningLine) out.push(planningLine);

  for (const node of heading.body || []) {
    const rendered = renderBodyNodeHtml(node);
    if (rendered) out.push(rendered);
  }

  for (const child of heading.children || []) {
    renderHeadingHtml(child, levelOffset, doneKeywords, out);
  }
}

const PRINT_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 780px; margin: 2rem auto; padding: 0 1rem; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin-top: 1.6em; margin-bottom: 0.4em; break-after: avoid; page-break-after: avoid; }
  h1 { font-size: 1.8em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
  h2 { font-size: 1.4em; }
  h3 { font-size: 1.2em; }
  p { margin: 0.6em 0; }
  p.planning { font-style: italic; color: #666; font-size: 0.9em; }
  table { border-collapse: collapse; margin: 1em 0; break-inside: avoid; page-break-inside: avoid; }
  th, td { border: 1px solid #ccc; padding: 4px 10px; text-align: left; }
  th { background: #f4f4f4; }
  blockquote { border-left: 3px solid #ccc; margin: 1em 0; padding: 0.2em 1em; color: #555; }
  pre { background: #f6f6f6; border-radius: 4px; padding: 0.8em; overflow-x: auto; }
  code { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 0.9em; }
  p code, li code { background: #f0f0f0; border-radius: 3px; padding: 0.1em 0.3em; }
  hr { border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }
  ul, ol { padding-left: 1.6em; }
  li { margin: 0.2em 0; break-inside: avoid; page-break-inside: avoid; }
  img { max-width: 100%; }
  .todo-keyword { display: inline-block; font-size: 0.7em; font-weight: 700; padding: 1px 6px; border-radius: 4px; vertical-align: middle; background: #fde3e3; color: #a02020; }
  .todo-keyword.done { background: #dcf0d8; color: #227a1e; }
  .priority { color: #a06010; font-weight: 600; }
  .tags code { font-size: 0.7em; opacity: 0.7; margin-left: 2px; }
  @media print {
    body { max-width: none; margin: 0; }
    a { color: inherit; text-decoration: none; }
  }
`;

/**
 * Exports `doc` (or, if `scope` is given, just that heading and its
 * descendants) to a complete standalone HTML document string. `scope`
 * must be a heading node that's actually part of `doc`, same
 * by-reference convention as exportToMarkdown.
 */
export function exportToHtml(doc, scope = null) {
  const roots = scope ? [scope] : doc.children || [];
  const levelOffset = scope ? scope.level - 1 : 0;
  const { doneKeywords } = resolveTodoSequence(doc);
  const out = [];
  for (const heading of roots) {
    renderHeadingHtml(heading, levelOffset, doneKeywords, out);
  }
  const titleSource = scope ? scope.title : (doc.keywords || []).find((k) => k.key === 'TITLE');
  const title = escapeHtml(scope ? scope.title : titleSource ? titleSource.value : 'Untitled');
  return (
    '<!DOCTYPE html>\n' +
    '<html>\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<title>${title}</title>\n` +
    `<style>${PRINT_CSS}</style>\n` +
    '</head>\n' +
    '<body>\n' +
    out.join('\n') +
    '\n</body>\n' +
    '</html>\n'
  );
}
