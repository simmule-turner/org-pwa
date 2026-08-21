/**
 * Converts an org document (or a single heading's subtree) to
 * Markdown (GFM-flavored) text. Pure and DOM-free — walks the same
 * parsed AST org-parser.js and outline-view-model.js already produce,
 * translating org syntax to Markdown syntax node by node rather than
 * reparsing anything.
 *
 * Scope: `exportToMarkdown(doc)` exports the whole document;
 * `exportToMarkdown(doc, heading)` exports just that heading and its
 * descendants, with the selected heading becoming the new top level
 * (# rather than its original ## or deeper) — matching how "export
 * this subtree" tools conventionally behave, since a reader opening
 * the exported file has no use for a dangling ### with nothing above
 * it.
 *
 * What doesn't map onto Markdown and is deliberately dropped rather
 * than forced into some approximation: property drawers (implementation
 * detail, not reader-facing content), and the ARCHIVE_* properties
 * specifically even if present (their meaning is entirely internal to
 * this app's own archiving feature). TODO keyword, priority, and tags
 * are kept as plain text on the heading line, matching org's own
 * source convention, since Markdown has no native syntax for any of
 * the three. SCHEDULED/DEADLINE render as a small italicized line
 * under the heading. Internal links (`*Heading`, `#custom-id`) are
 * NOT resolved to Markdown anchors — the target renderer's heading-slug
 * algorithm can't be predicted from here, so the raw org target is kept
 * as the link's own href verbatim rather than guessing at an anchor
 * that might not match. `org-use-sub-superscripts` mode is not
 * threaded through here — bare (unbraced) sub/superscript export
 * treats the surrounding org source literally as ordinary text, same
 * as the 'nil' parsing mode elsewhere, since a headless export has no
 * live per-file Local Variables context to read the way the editor
 * view does.
 */

import { parseInline, stripLineBreakMarker } from './inline-markup.js';
import { resolveLinkTarget } from './link-resolve.js';
import { isWidthCookieRow } from './table-cookies.js';
import { parseExportOptions } from './export-options.js';

// Footnote definitions accumulated during a single exportToMarkdown()
// call (module-level, reset at the start of each call): GFM has no
// inline-definition syntax the way org's own [fn:label:text] does --
// every definition (inline or the separate "[fn:label] text" line
// convention) becomes a "[^label]: text" line collected here and
// emitted together at the very end of the export, GFM's own convention
// for where footnote definitions live.
let footnoteDefinitionsMd = [];
let anonymousFootnoteCounterMd = 0;

// The document currently being exported, and a Map<heading, slug> for
// every heading actually included in this export -- both reset at the
// start of each exportToMarkdown() call. Mirrors export-html.js's own
// docForLinkResolutionHtml/headingIdMapHtml, adapted to Markdown's own
// implicit (no explicit id attribute) heading-anchor convention: the
// slug is never written into the heading line itself, only used when
// resolving a link that points TO that heading.
let docForLinkResolutionMd = null;
let headingSlugMapMd = new Map();

/** GitHub's own heading-slug algorithm (github-slugger, the library
 *  GitHub itself uses to generate `#heading-anchor`-style links for
 *  every rendered Markdown heading) -- the closest thing to a de
 *  facto standard across Markdown renderers, and the specific
 *  convention this export already commits to elsewhere (GFM task
 *  lists, GFM footnotes). Lowercases, strips anything that isn't a
 *  Unicode letter/number, space, hyphen, or underscore, then replaces
 *  spaces with hyphens. Deliberately does NOT convert punctuation to
 *  hyphens (unlike the simpler slugifyHtml in export-html.js) --
 *  GitHub's own algorithm strips it outright, and matching that
 *  exactly matters here specifically because the whole point is
 *  producing a link that resolves correctly once actually rendered
 *  somewhere real. */
export function gfmSlugify(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/ /g, '-');
}

/** Assigns every heading actually being exported a GFM-style slug,
 *  disambiguating a duplicate the same way GitHub's own slugger does:
 *  the second "Notes" heading becomes "notes-1", the third "notes-2",
 *  and so on -- NOT the "-2, -3, ..." (skipping "-1") convention
 *  export-html.js's own assignHeadingIdsHtml uses for its own,
 *  unrelated id-attribute scheme; matching GFM's own specific
 *  numbering is what makes the generated link actually correct once
 *  rendered by a real GFM-compliant tool. */
function assignHeadingSlugsMd(headings, usedSlugs) {
  for (const heading of headings) {
    const base = gfmSlugify(heading.title);
    let slug = base;
    let n = 1;
    while (usedSlugs.has(slug)) {
      slug = base + '-' + n;
      n++;
    }
    usedSlugs.add(slug);
    headingSlugMapMd.set(heading, slug);
    assignHeadingSlugsMd(heading.children || [], usedSlugs);
  }
}

/** GFM requires an explicit label on every footnote, unlike org's own
 *  anonymous [fn::...] form -- assigns a synthetic one for that case,
 *  distinguishable from any real user-chosen label so it can never
 *  collide with one. */
function footnoteLabelMd(label) {
  if (label !== null) return label;
  anonymousFootnoteCounterMd++;
  return 'anon-' + anonymousFootnoteCounterMd;
}

// ---- inline rendering -----------------------------------------------------

/** Characters that carry special meaning in Markdown and need escaping
 *  when they appear as literal plain text, so they don't get
 *  misinterpreted as emphasis/lists/headings/etc. by whatever renders
 *  the exported file. Applied only to plain-text segments — text
 *  already inside a code/verbatim span is safe as-is (the backticks
 *  themselves already protect it, and escaping inside a code span
 *  would corrupt the literal content it's meant to preserve). */
function escapeMarkdownText(text) {
  return text.replace(/([\\`*_[\]<|])/g, '\\$1');
}

/** Resolves a link's raw target to what its Markdown URL should
 *  actually be: a real "#slug" anchor if it resolves to a heading
 *  that's part of THIS export, or the original target text unchanged
 *  for anything else (external URLs, file links, or a heading that
 *  resolves but lives outside this specific export's scope). Mirrors
 *  export-html.js's own resolveLinkHref exactly, adapted to GFM's
 *  implicit slug-based anchors instead of an explicit id attribute. */
function resolveLinkHrefMd(target) {
  if (!docForLinkResolutionMd) return target;
  const resolution = resolveLinkTarget(docForLinkResolutionMd, target);
  if (resolution.type === 'heading' && headingSlugMapMd.has(resolution.heading)) {
    return '#' + headingSlugMapMd.get(resolution.heading);
  }
  return target;
}

function renderInlineListMd(nodes) {
  return nodes.map(renderInlineNodeMd).join('');
}

function renderInlineNodeMd(node) {
  switch (node.type) {
    case 'text':
      return escapeMarkdownText(node.value);
    case 'bold':
      return `**${renderInlineListMd(node.children)}**`;
    case 'italic':
      return `*${renderInlineListMd(node.children)}*`;
    case 'underline':
      // No native Markdown underline -- <u> passthrough is the standard
      // convention, since both CommonMark and GFM allow raw inline HTML.
      return `<u>${renderInlineListMd(node.children)}</u>`;
    case 'strikethrough':
      return `~~${renderInlineListMd(node.children)}~~`;
    case 'code':
    case 'verbatim':
      // Org treats these two as near-identical for most export
      // purposes; both become inline code here. A backtick inside the
      // content itself would need a wider fence, which is a real but
      // rare edge case -- not handled here, matching this being a
      // stated simplification rather than a full CommonMark-compliant
      // code-span escaper.
      return '`' + node.value + '`';
    case 'subscript':
      return `<sub>${node.value}</sub>`;
    case 'superscript':
      return `<sup>${node.value}</sup>`;
    case 'link': {
      const label = node.description ? escapeMarkdownText(node.description) : node.target;
      return `[${label}](${resolveLinkHrefMd(node.target)})`;
    }
    case 'image':
      return `![](${node.target})`;
    case 'footnote-ref':
      return `[^${node.label}]`;
    case 'footnote-def': {
      const label = footnoteLabelMd(node.label);
      footnoteDefinitionsMd.push({ label, text: renderInlineListMd(node.children) });
      return `[^${label}]`;
    }
    case 'comment':
      // org's own @@comment:...@@ export-comment marker -- never
      // appears in exported output, matching real org's own behavior
      // of dropping comments entirely on export.
      return '';
    default:
      return '';
  }
}

function renderTextMd(text) {
  return renderInlineListMd(parseInline(text));
}

// ---- body content -----------------------------------------------------

function renderParagraphMd(node) {
  if (node.footnoteLabel !== null) {
    const strippedFirstLine = node.lines[0].replace(
      new RegExp('^\\[fn:' + node.footnoteLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\s?'),
      ''
    );
    const text = [strippedFirstLine, ...node.lines.slice(1)].map(renderTextMd).join(' ');
    footnoteDefinitionsMd.push({ label: node.footnoteLabel, text });
    return ''; // emitted at the end instead, alongside every other footnote definition
  }
  // Markdown's own "two trailing spaces + newline" is its actual hard
  // line break convention -- used only where the source line itself
  // had an explicit "\\" marker, matching real org's own actual
  // default export behavior (org-export-preserve-breaks defaults to
  // nil): adjacent lines within one paragraph flow together with a
  // plain space otherwise, not one that only breaks by accident of
  // the reader's own line width.
  return node.lines
    .map((line, i) => {
      const forcedBreak = stripLineBreakMarker(line) !== line;
      const rendered = renderTextMd(stripLineBreakMarker(line));
      if (i === node.lines.length - 1) return rendered;
      return rendered + (forcedBreak ? '  \n' : ' ');
    })
    .join('');
}

function renderListMd(list, indent) {
  const lines = [];
  let counter = 0;
  for (const item of list.items) {
    let marker;
    if (item.checkbox !== null) {
      marker = item.checkbox === 'X' ? '- [x] ' : '- [ ] ';
    } else if (item.ordered) {
      counter = item.startValue != null ? item.startValue : counter + 1;
      marker = `${counter}. `;
    } else {
      marker = '- ';
    }
    let text = renderInlineListMd(item.inline);
    if (item.tag) {
      // Description-list tag rendered as a bold label prefix, since
      // Markdown has no native description-list syntax to map onto.
      text = `**${renderTextMd(item.tag)}:** ${text}`;
    }
    lines.push(' '.repeat(indent) + marker + text);
    for (const nested of item.children || []) {
      lines.push(renderListMd(nested, indent + 2));
    }
  }
  return lines.join('\n');
}

function padCells(cells, count) {
  const out = cells.slice();
  while (out.length < count) out.push('');
  return out;
}

function renderTableMd(table) {
  const dataRows = table.rows.filter((r) => r.type === 'row' && !isWidthCookieRow(r));
  if (dataRows.length === 0) return '';
  const colCount = Math.max(...dataRows.map((r) => r.cells.length));
  const lines = [];
  const headerCells = padCells(
    dataRows[0].cellsInline.map((c) => renderInlineListMd(c)),
    colCount
  );
  lines.push('| ' + headerCells.join(' | ') + ' |');
  lines.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');
  for (const row of dataRows.slice(1)) {
    const cells = padCells(
      row.cellsInline.map((c) => renderInlineListMd(c)),
      colCount
    );
    lines.push('| ' + cells.join(' | ') + ' |');
  }
  return lines.join('\n');
}

function renderBlockMd(block) {
  const name = block.name;
  if (name === 'COMMENT') return ''; // matches real org's own export behavior -- comment blocks are excluded from every export backend
  if (name === 'EXPORT') {
    const backend = (block.params || '').trim().toLowerCase();
    return backend === 'md' || backend === 'markdown' ? block.lines.join('\n') : '';
  }
  if (name === 'QUOTE') {
    return block.lines.map((l) => (l.trim() === '' ? '>' : '> ' + renderTextMd(l))).join('\n');
  }
  if (name === 'SRC') {
    const lang = block.params.split(/\s+/)[0] || '';
    return '```' + lang + '\n' + block.lines.join('\n') + '\n```';
  }
  // EXAMPLE and any other/unrecognized block type: preserve verbatim as
  // a fenced block with no language hint, rather than trying to
  // reinterpret content this app doesn't have specific handling for.
  return '```\n' + block.lines.join('\n') + '\n```';
}

function renderBodyNodeMd(node) {
  if (node.type === 'list') return renderListMd(node, 0);
  if (node.type === 'paragraph') return renderParagraphMd(node);
  if (node.type === 'table') return renderTableMd(node);
  if (node.type === 'block') return renderBlockMd(node);
  if (node.type === 'hr') return '---';
  return '';
}

// ---- headings -----------------------------------------------------------

function renderPlanningMd(planning) {
  if (!planning) return '';
  const parts = [];
  if (planning.scheduled) parts.push(`Scheduled: ${planning.scheduled}`);
  if (planning.deadline) parts.push(`Deadline: ${planning.deadline}`);
  if (parts.length === 0) return '';
  return `*${parts.join(' \u2014 ')}*`;
}

function renderHeadingLineMd(heading, level) {
  const parts = ['#'.repeat(Math.max(1, level))];
  if (heading.todo) parts.push(heading.todo);
  if (heading.priority) parts.push(`[#${heading.priority}]`);
  parts.push(renderTextMd(heading.title) || '(untitled)');
  let line = parts.join(' ');
  if (heading.tags && heading.tags.length) {
    line += '  `:' + heading.tags.join(':') + ':`';
  }
  return line;
}

function renderHeadingMd(heading, levelOffset, out) {
  out.push(renderHeadingLineMd(heading, heading.level - levelOffset));

  const planningLine = renderPlanningMd(heading.planning);
  if (planningLine) out.push(planningLine);

  for (const node of heading.body || []) {
    const rendered = renderBodyNodeMd(node);
    if (rendered) out.push(rendered);
  }

  for (const child of heading.children || []) {
    renderHeadingMd(child, levelOffset, out);
  }
}

/**
 * Exports `doc` (or, if `scope` is given, just that heading and its
 * descendants) to a Markdown string. `scope` must be a heading node
 * that's actually part of `doc` — passed by reference, the same
 * convention every other heading-targeting function in this codebase
 * already uses (e.g. archiveHeadingToLocation).
 */
/** Builds one level of the ToC's own nested list -- always recurses
 *  with level+1, the actual list-building logic (see buildTocMd below
 *  for the one-time wrapper that decides whether to call this at
 *  all). */
function buildTocListMd(headings, level, maxDepth, numberingEnabled) {
  if (level > maxDepth || headings.length === 0) return '';
  const indent = '  '.repeat(level - 1);
  const marker = numberingEnabled ? (i) => `${i + 1}.` : () => '-';
  const lines = [];
  headings.forEach((heading, i) => {
    const slug = headingSlugMapMd.get(heading);
    const label = renderTextMd(heading.title) || '(untitled)';
    lines.push(`${indent}${marker(i)} [${label}](#${slug || ''})`);
    const childList = buildTocListMd(heading.children || [], level + 1, maxDepth, numberingEnabled);
    if (childList) lines.push(childList);
  });
  return lines.join('\n');
}

/** Builds the Table of Contents block for Markdown export -- a nested
 *  list of links to each heading's own existing anchor slug
 *  (headingSlugMapMd, already built by assignHeadingSlugsMd for
 *  internal-link resolution; reused directly here). Real org's own
 *  actual ox-md backend (confirmed directly against real Emacs org-
 *  mode) has NO per-heading number prefix in the body regardless of
 *  num: -- what num: actually controls for Markdown specifically is
 *  whether the ToC's own list is ordered ("1.", "2.", ...) or
 *  unordered ("-"), not whether headings are numbered at all (they
 *  never are). Returns '' when `toc` is false, or fewer than two
 *  headings are visible at `toc`'s own depth limit. */
function buildTocMd(headings, toc, numberingEnabled) {
  if (!toc) return '';
  const maxDepth = typeof toc === 'number' ? toc : Infinity;
  let visibleCount = 0;
  (function countVisible(hs, lvl) {
    if (lvl > maxDepth) return;
    for (const h of hs) {
      visibleCount++;
      countVisible(h.children || [], lvl + 1);
    }
  })(headings, 1);
  if (visibleCount < 2) return '';
  const body = buildTocListMd(headings, 1, maxDepth, numberingEnabled);
  return '# Table of Contents\n\n' + body;
}

export function exportToMarkdown(doc, scope = null) {
  footnoteDefinitionsMd = [];
  anonymousFootnoteCounterMd = 0;
  docForLinkResolutionMd = doc;
  headingSlugMapMd = new Map();

  const roots = scope ? [scope] : doc.children || [];
  assignHeadingSlugsMd(roots, new Set());
  const levelOffset = scope ? scope.level - 1 : 0;
  const out = [];

  if (!scope) {
    const options = parseExportOptions(doc);
    const toc = buildTocMd(roots, options.toc, options.num);
    if (toc) out.push(toc);
    for (const node of doc.body || []) {
      const rendered = renderBodyNodeMd(node);
      if (rendered) out.push(rendered);
    }
  }

  for (const heading of roots) {
    renderHeadingMd(heading, levelOffset, out);
  }

  if (footnoteDefinitionsMd.length > 0) {
    const seenLabels = new Set();
    const defLines = [];
    for (const { label, text } of footnoteDefinitionsMd) {
      if (seenLabels.has(label)) continue; // the same real label can legitimately be referenced more than once, but only needs one definition line
      seenLabels.add(label);
      defLines.push(`[^${label}]: ${text}`);
    }
    out.push(defLines.join('\n'));
  }

  // Blocks are joined with a blank line between them for normal
  // Markdown paragraph/block separation; collapse any accidental
  // triple-or-more blank lines (e.g. an empty paragraph node) down to
  // exactly one blank line, and ensure the file ends with exactly one
  // trailing newline.
  const joined = out.filter((s) => s !== '').join('\n\n');
  return joined.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
