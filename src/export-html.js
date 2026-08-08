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
import { resolveLinkTarget } from './link-resolve.js';
import { isWidthCookieRow } from './table-cookies.js';

// Footnote definitions accumulated during a single exportToHtml() call
// (module-level, reset at the start of each call) -- collected the same
// way export-markdown.js collects them, since neither this convention
// nor GFM supports an inline definition; every one (inline or the
// separate "[fn:label] text" line convention) is emitted together in a
// Footnotes section at the end, each back-linking to its own reference.
let footnoteDefinitionsHtml = [];
let anonymousFootnoteCounterHtml = 0;

// The document currently being exported, and a Map<heading, id> for
// every heading actually included in this export -- both reset at the
// start of each exportToHtml() call. Needed so a link can be resolved
// (via the same resolveLinkTarget the live app already uses for
// on-screen navigation) to the ACTUAL heading it points to, then
// checked against which headings are actually present in this
// specific export (a link to something outside an exported subtree
// has nowhere to anchor to, even once correctly resolved).
let docForLinkResolutionHtml = null;
let headingIdMapHtml = new Map();

/** Turns a heading title into a URL-fragment-safe id: lowercased,
 *  non-alphanumeric runs collapsed to a single hyphen, leading/
 *  trailing hyphens trimmed. Falls back to "section" for a title that
 *  has no alphanumeric characters at all (a title that's pure emoji or
 *  punctuation, however unusual), so every heading still gets SOME
 *  usable id rather than an empty string. */
function slugifyHtml(title) {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

/** Assigns every heading actually being exported a unique id: its own
 *  :CUSTOM_ID: property if set (matching exactly what a "#custom-id"
 *  link resolves against, so those links land precisely where they're
 *  supposed to), otherwise a slug generated from its title, with a
 *  numeric suffix appended if that slug is already taken by an earlier
 *  heading (two headings can share a title; ids in one HTML document
 *  can't). Recurses through the whole given subtree, not just the
 *  top level. */
function assignHeadingIdsHtml(headings, usedSlugs) {
  for (const heading of headings) {
    const customId = heading.properties && heading.properties.CUSTOM_ID;
    let id = customId ? customId.trim() : '';
    if (!id) {
      const base = slugifyHtml(heading.title);
      id = base;
      let n = 2;
      while (usedSlugs.has(id)) {
        id = base + '-' + n;
        n++;
      }
    }
    usedSlugs.add(id);
    headingIdMapHtml.set(heading, id);
    assignHeadingIdsHtml(heading.children || [], usedSlugs);
  }
}

function footnoteLabelHtml(label) {
  if (label !== null) return label;
  anonymousFootnoteCounterHtml++;
  return 'anon-' + anonymousFootnoteCounterHtml;
}

// ---- escaping ---------------------------------------------------------

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// ---- inline rendering -----------------------------------------------------

/** Resolves a link's raw target to what its href should actually be: a
 *  real "#id" anchor if it resolves to a heading that's part of THIS
 *  export, or the original target text unchanged for anything else
 *  (external URLs, file links, or a heading that resolves but lives
 *  outside this specific export's scope -- there's genuinely nowhere
 *  for that last case to anchor to within this one document, even
 *  once correctly identified). */
function resolveLinkHref(target) {
  if (!docForLinkResolutionHtml) return target;
  const resolution = resolveLinkTarget(docForLinkResolutionHtml, target);
  if (resolution.type === 'heading' && headingIdMapHtml.has(resolution.heading)) {
    return '#' + headingIdMapHtml.get(resolution.heading);
  }
  return target;
}

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
      const href = resolveLinkHref(node.target);
      return `<a href="${escapeHtml(href)}">${label}</a>`;
    }
    case 'image':
      return `<img src="${escapeHtml(node.target)}" alt="">`;
    case 'footnote-ref':
      return `<sup id="fnref-${escapeHtml(node.label)}"><a href="#fn-${escapeHtml(node.label)}">${escapeHtml(node.label)}</a></sup>`;
    case 'footnote-def': {
      const label = footnoteLabelHtml(node.label);
      footnoteDefinitionsHtml.push({ label, html: renderInlineListHtml(node.children) });
      return `<sup id="fnref-${escapeHtml(label)}"><a href="#fn-${escapeHtml(label)}">${escapeHtml(label)}</a></sup>`;
    }
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
  if (node.footnoteLabel !== null) {
    const strippedFirstLine = node.lines[0].replace(
      new RegExp('^\\[fn:' + node.footnoteLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\s?'),
      ''
    );
    const html = [strippedFirstLine, ...node.lines.slice(1)].map(renderTextHtml).join('<br>');
    footnoteDefinitionsHtml.push({ label: node.footnoteLabel, html });
    return ''; // emitted in the Footnotes section at the end instead
  }
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
  const dataRows = table.rows.filter((r) => r.type === 'row' && !isWidthCookieRow(r));
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
  const id = headingIdMapHtml.get(heading);
  const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
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
  return `<${tag}${idAttr}>${inner}</${tag}>`;
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
  sup a { text-decoration: none; }
  .footnotes { margin-top: 2em; padding-top: 1em; border-top: 1px solid #ddd; font-size: 0.9em; color: #444; }
  .footnotes li { margin: 0.3em 0; }
  .footnotes a.footnote-back { text-decoration: none; margin-left: 0.3em; }
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
  footnoteDefinitionsHtml = [];
  anonymousFootnoteCounterHtml = 0;
  docForLinkResolutionHtml = doc;
  headingIdMapHtml = new Map();

  const roots = scope ? [scope] : doc.children || [];
  assignHeadingIdsHtml(roots, new Set());
  const levelOffset = scope ? scope.level - 1 : 0;
  const { doneKeywords } = resolveTodoSequence(doc);
  const out = [];
  for (const heading of roots) {
    renderHeadingHtml(heading, levelOffset, doneKeywords, out);
  }

  if (footnoteDefinitionsHtml.length > 0) {
    const seenLabels = new Set();
    const items = [];
    for (const { label, html } of footnoteDefinitionsHtml) {
      if (seenLabels.has(label)) continue; // the same real label can legitimately be referenced more than once, but only needs one definition
      seenLabels.add(label);
      items.push(
        `<li id="fn-${escapeHtml(label)}">${html} <a class="footnote-back" href="#fnref-${escapeHtml(label)}">\u21a9</a></li>`
      );
    }
    out.push(`<div class="footnotes"><strong>Footnotes</strong><ol>${items.join('')}</ol></div>`);
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
