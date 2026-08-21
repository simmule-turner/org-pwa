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

import { parseInline, stripLineBreakMarker, extractLatexFragments } from './inline-markup.js';
import { resolveTodoSequence } from './todo-cycle.js';
import { resolveLinkTarget } from './link-resolve.js';
import { isWidthCookieRow } from './table-cookies.js';
import { renderMathHtml } from './math-render.js';
import { KATEX_EXPORT_CSS } from './katex-export-css.js';
import { parseExportOptions, getDocTitle, getDocAuthor, getDocDate, getHtmlHead } from './export-options.js';
import { getProperty } from './archive-model.js';

// Footnote definitions accumulated during a single exportToHtml() call
// (module-level, reset at the start of each call) -- collected the same
// way export-markdown.js collects them, since neither this convention
// nor GFM supports an inline definition; every one (inline or the
// separate "[fn:label] text" line convention) is emitted together in a
// Footnotes section at the end, each back-linking to its own reference.
let footnoteDefinitionsHtml = [];
// True once at least one 'latex' node has actually been rendered
// during THIS export -- lets the final <head> include KaTeX's own
// CSS (see katex-export-css.js) only for documents that actually
// have math in them, rather than bloating every single HTML export
// with ~20KB of unused CSS.
let mathUsedHtml = false;
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

// Section numbering state -- reset at the start of each exportToHtml()
// call, same convention as export-ascii.js's own sectionNumbersAscii/
// numberingEnabledAscii (see that file's own docs). num: and toc: are
// genuinely INDEPENDENT (confirmed directly against real Emacs org-
// mode) -- this only governs whether headings get numbered at all;
// the Table of Contents' own depth is a separate concern entirely,
// handled by buildTocHtml below.
let sectionNumbersHtml = [];
let numberingEnabledHtml = true;

function nextSectionNumberHtml(level) {
  const newNumbers = sectionNumbersHtml.slice(0, level);
  for (let i = 0; i < level - 1; i++) {
    if (newNumbers[i] === undefined) newNumbers[i] = 1;
  }
  newNumbers[level - 1] = (newNumbers[level - 1] || 0) + 1;
  sectionNumbersHtml = newNumbers;
  return sectionNumbersHtml.join('.');
}

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
    const customId = getProperty(heading, 'CUSTOM_ID');
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
    case 'latex': {
      const { html, ok } = renderMathHtml(node.source, node.displayMode);
      if (ok) {
        mathUsedHtml = true;
        return html;
      }
      return `<span style="border:1px dashed #f88;border-radius:3px;padding:0 3px;font-family:monospace;font-size:0.9em" title="This LaTeX fragment could not be rendered.">${escapeHtml(node.source)}</span>`;
    }
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

function joinParagraphLinesHtml(lines) {
  const { lines: extractedLines, fragments } = extractLatexFragments(lines);
  return extractedLines
    .map((line, i) => {
      const forcedBreak = stripLineBreakMarker(line) !== line;
      const rendered = renderInlineListHtml(parseInline(stripLineBreakMarker(line), { latexFragments: fragments }));
      if (i === extractedLines.length - 1) return rendered;
      return rendered + (forcedBreak ? '<br>' : ' ');
    })
    .join('');
}

function renderParagraphHtml(node) {
  if (node.footnoteLabel !== null) {
    const strippedFirstLine = node.lines[0].replace(
      new RegExp('^\\[fn:' + node.footnoteLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\s?'),
      ''
    );
    const html = joinParagraphLinesHtml([strippedFirstLine, ...node.lines.slice(1)]);
    footnoteDefinitionsHtml.push({ label: node.footnoteLabel, html });
    return ''; // emitted in the Footnotes section at the end instead
  }
  return '<p>' + joinParagraphLinesHtml(node.lines) + '</p>';
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
  if (name === 'EXPORT') {
    return (block.params || '').trim().toLowerCase() === 'html' ? block.lines.join('\n') : '';
  }
  if (name === 'QUOTE') {
    const { lines: extractedLines, fragments } = extractLatexFragments(block.lines);
    return '<blockquote>' + extractedLines.map((l) => renderInlineListHtml(parseInline(l, { latexFragments: fragments }))).join('<br>') + '</blockquote>';
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
  if (numberingEnabledHtml) {
    parts.push(`<span class="section-number-${level}">${nextSectionNumberHtml(level)}.</span>`);
  }
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

/** Builds one level of the ToC's own nested `<ul>` -- recurses
 *  directly over the heading tree (rather than a flat list with
 *  manual depth-tracking, which is fragile to get right), stopping
 *  once `level` exceeds `maxDepth`. `numbers` is a single shared
 *  array threaded through the whole recursion, the same convention
 *  export-ascii.js's own collectHeadingsForToc uses. */
function buildTocListHtml(headings, level, maxDepth, numberingEnabled, numbers) {
  if (level > maxDepth || headings.length === 0) return '';
  const items = [];
  for (const heading of headings) {
    numbers.length = level;
    numbers[level - 1] = (numbers[level - 1] || 0) + 1;
    const number = numbers.slice(0, level).join('.');
    const id = headingIdMapHtml.get(heading);
    const href = id ? `#${escapeHtml(id)}` : '#';
    const label = numberingEnabled ? `${number}. ${renderTextHtml(heading.title) || '(untitled)'}` : renderTextHtml(heading.title) || '(untitled)';
    const childList = buildTocListHtml(heading.children || [], level + 1, maxDepth, numberingEnabled, numbers);
    items.push(`<li><a href="${href}">${label}</a>${childList}</li>`);
  }
  return `<ul>${items.join('')}</ul>`;
}

/** Builds the full Table of Contents block, or '' when `toc` is
 *  false, or fewer than two headings are actually visible at `toc`'s
 *  own depth limit (nothing worth a table of contents for) -- matches
 *  export-ascii.js's own renderToc, adapted for HTML's own nested-
 *  list structure (real org's own actual ToC shape) instead of a
 *  flat, dot-leader-indented text listing. */
function buildTocHtml(roots, toc, numberingEnabled) {
  if (!toc) return '';
  const maxDepth = typeof toc === 'number' ? toc : Infinity;
  let visibleCount = 0;
  (function countVisible(headings, level) {
    if (level > maxDepth) return;
    for (const heading of headings) {
      visibleCount++;
      countVisible(heading.children || [], level + 1);
    }
  })(roots, 1);
  if (visibleCount < 2) return '';
  const list = buildTocListHtml(roots, 1, maxDepth, numberingEnabled, []);
  return `<div id="table-of-contents"><h2>Table of Contents</h2>${list}</div>`;
}

/**
 * Exports `doc` (or, if `scope` is given, just that heading and its
 * descendants) to a complete standalone HTML document string. `scope`
 * must be a heading node that's actually part of `doc`, same
 * by-reference convention as exportToMarkdown.
 */
export function exportToHtml(doc, scope = null) {
  footnoteDefinitionsHtml = [];
  mathUsedHtml = false;
  anonymousFootnoteCounterHtml = 0;
  docForLinkResolutionHtml = doc;
  headingIdMapHtml = new Map();
  sectionNumbersHtml = [];
  const options = parseExportOptions(doc);
  numberingEnabledHtml = options.num;

  const roots = scope ? [scope] : doc.children || [];
  assignHeadingIdsHtml(roots, new Set());
  const levelOffset = scope ? scope.level - 1 : 0;
  const { doneKeywords } = resolveTodoSequence(doc);
  const out = [];

  if (!scope) {
    const docTitle = getDocTitle(doc);
    if (docTitle) {
      out.push(`<h1 class="title">${escapeHtml(docTitle)}</h1>`);
      const author = options.author ? getDocAuthor(doc) : null;
      const date = options.date ? getDocDate(doc) : null;
      if (author) out.push(`<p class="author">${escapeHtml(author)}</p>`);
      if (date) out.push(`<p class="date">${escapeHtml(date)}</p>`);
    }
    const toc = buildTocHtml(roots, options.toc, options.num);
    if (toc) out.push(toc);
    for (const node of doc.body || []) {
      const rendered = renderBodyNodeHtml(node);
      if (rendered) out.push(rendered);
    }
  }

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

  if (!scope && options.creator) {
    out.push('<p class="creator">Generated by org-pwa</p>');
  }

  const titleSource = scope ? scope.title : (doc.keywords || []).find((k) => k.key.toUpperCase() === 'TITLE');
  const title = escapeHtml(scope ? scope.title : titleSource ? titleSource.value : 'Untitled');
  const htmlHead = getHtmlHead(doc);
  return (
    '<!DOCTYPE html>\n' +
    '<html>\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<title>${title}</title>\n` +
    `<style>${PRINT_CSS}</style>\n` +
    (mathUsedHtml ? `<style>${KATEX_EXPORT_CSS}</style>\n` : '') +
    (htmlHead ? htmlHead + '\n' : '') +
    '</head>\n' +
    '<body>\n' +
    out.join('\n') +
    '\n</body>\n' +
    '</html>\n'
  );
}
