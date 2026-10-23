// @ts-check
/** @typedef {import('./types.js').Table} Table */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * Converts an org document (or a single heading's subtree) to a real,
 * standalone .odt file -- a ZIP archive of OpenDocument XML, openable
 * directly in LibreOffice, OpenOffice, Word (with the ODF filter), and
 * Google Docs (import). Pure and DOM-free -- walks the same parsed AST
 * org-parser.js already produces, the same way export-html.js does.
 *
 * Scope mirrors export-html.js closely (same inline markup coverage,
 * same resolveLinkTarget-based internal-link resolution, same
 * property-drawer/ARCHIVE_* exclusion), adapted to ODF's own XML
 * vocabulary instead of HTML's. Two differences worth calling out:
 *   - Footnotes use ODF's own native <text:note> mechanism (a real,
 *     editable footnote a word processor understands and can
 *     renumber/reflow on its own), not the "collect and append a
 *     Footnotes section" approximation HTML export uses,
 *     since ODF actually has proper footnote support to use instead.
 *   - Images are rendered as a plain text reference to their target
 *     path, not embedded -- embedding would mean reading each image's
 *     binary and packaging it into the archive's own Pictures/
 *     folder, out of scope here, matching how ASCII export
 *     already treat images as a reference rather than embedded data.
 */

import { foldInlineTasks, inlineTaskInfo, INLINE_TASK_BLOCK } from './inline-tasks.js';
import { parseBody } from './body-parser.js';
import { parseInline, stripLineBreakMarker } from './inline-markup.js';
import { citeExportFor, dropSilentCitations, splitBibliography } from './cite.js';
import { resolveTodoSequence } from './todo-cycle.js';
import { resolveLinkTarget } from './link-resolve.js';
import { createZip } from './zip-writer.js';
import { isWidthCookieRow } from './table-cookies.js';
import { rawExportOptions, parseExportOptions, getDocTitle, getDocAuthor, getDocDate } from './export-options.js';
import { getProperty } from './archive-model.js';
import { anchorFor, buildLinkContext, internalLink } from './export-links.js';
import { expandMacrosForExport } from './export-org.js';
import { brokenLinkPath, brokenLinkText, finishDropped } from './broken-links.js';
import { newCodeCounter, codeStart, unravelCode, resolveCodeRef, coderefText, blockSwitchText } from './code-lines.js';

// ---- escaping -------------------------------------------------------------

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/** @param {string} text */
function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (c) => /** @type {any} */ (XML_ESCAPES)[c]);
}

// ---- per-export state (reset at the start of every exportToOdt() call) ----

/** @type {any} */ let docForLinkResolutionOdt = null;
/** @type {import('./export-links.js').LinkContext | null} */ let linkCtxOdt = null; // section numbers, targets and radio-target pattern for this export
let headingIdMapOdt = new Map();
let footnoteCounterOdt = 0;
/** @type {any[]} */ let sectionNumbersOdt = [];
/** org-use-sub-superscripts for the export in progress: the file's #+OPTIONS: ^: or else the setting. */
let supOdt = 't';
let numberingEnabledOdt = true;
/** `f:` and `|:` of #+OPTIONS: footnotes and tables are exported unless turned off. */
let footnotesOdt = true;
/** The text of each `[fn:label] text` definition, which a reference to it puts in its footnote. @type {Map<string, import('./types.js').InlineNode[]>} */
let footnoteDefsOdt = new Map();
let tablesOdt = true;
/** What the export does with a link that leads nowhere (org-export-with-broken-links). @type {import('./broken-links.js').BrokenLinks} */
let brokenOdt = 'nil';

/** @param {number} level */
function nextSectionNumberOdt(level) {
  const newNumbers = sectionNumbersOdt.slice(0, level);
  for (let i = 0; i < level - 1; i++) {
    if (newNumbers[i] === undefined) newNumbers[i] = 1;
  }
  newNumbers[level - 1] = (newNumbers[level - 1] || 0) + 1;
  sectionNumbersOdt = newNumbers;
  return sectionNumbersOdt.join('.');
}

/** @param {string} title */
function slugifyOdt(title) {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

/** Same approach as export-html.js's own assignHeadingIdsOdt --
 *  CUSTOM_ID if set, otherwise a slug from the title, disambiguated
 *  with a numeric suffix if two headings would otherwise collide.
 *  ODF's own bookmark mechanism (used for internal links, see
 *  resolveLinkHrefOdt) needs the same kind of stable, unique name per
 * @param {Heading[]} headings
 * @param {Set<string>} usedSlugs
 *  heading that an HTML id attribute does. */
function assignHeadingIdsOdt(headings, usedSlugs) {
  for (const heading of headings) {
    const customId = getProperty(heading, 'CUSTOM_ID');
    let id = customId ? customId.trim() : '';
    if (!id) {
      const base = slugifyOdt(heading.title);
      id = base;
      let n = 2;
      while (usedSlugs.has(id)) {
        id = base + '-' + n;
        n++;
      }
    }
    usedSlugs.add(id);
    headingIdMapOdt.set(heading, id);
    assignHeadingIdsOdt(heading.children || [], usedSlugs);
  }
}

/** Resolves a link's raw target to an ODF-internal bookmark reference
 *  (<text:bookmark-ref>) if it points to a heading actually included
 *  in this export, or leaves it as an external URL/plain text
 *  reference otherwise -- same reasoning as export-html.js's own
 *  resolveLinkHrefHtml, adapted to ODF's own linking mechanism (a
 *  bookmark name, not a URL fragment). Returns null for "not an
 *  internal heading link" so the caller renders it as a normal
 * @param {string} target
 *  xlink:href instead. */
function resolveInternalLinkOdt(target) {
  if (!docForLinkResolutionOdt) return null;
  const resolution = resolveLinkTarget(docForLinkResolutionOdt, target);
  if (resolution.type === 'heading' && headingIdMapOdt.has(resolution.heading)) {
    return headingIdMapOdt.get(resolution.heading);
  }
  return null;
}

// ---- inline rendering -----------------------------------------------------

/** @param {import('./types.js').InlineNode[]} nodes @returns {string} */
function renderInlineListOdt(nodes) {
  if (citeOdt) nodes = dropSilentCitations(nodes, (c) => citeOdt.formatCitation(c) === null);
  return nodes.map(renderInlineNodeOdt).join('');
}

/** @param {import('./types.js').InlineNode} node @returns {string} */
function renderInlineNodeOdt(node) {
  switch (node.type) {
    case 'text':
      return escapeXml(node.value);
    case 'bold':
      return `<text:span text:style-name="Bold">${renderInlineListOdt(node.children)}</text:span>`;
    case 'italic':
      return `<text:span text:style-name="Italic">${renderInlineListOdt(node.children)}</text:span>`;
    case 'underline':
      return `<text:span text:style-name="Underline">${renderInlineListOdt(node.children)}</text:span>`;
    case 'strikethrough':
      return `<text:span text:style-name="Strikethrough">${renderInlineListOdt(node.children)}</text:span>`;
    case 'code':
    case 'verbatim':
      return `<text:span text:style-name="Code">${escapeXml(node.value)}</text:span>`;
    case 'subscript':
      return `<text:span text:style-name="Subscript">${escapeXml(node.value)}</text:span>`;
    case 'superscript':
      return `<text:span text:style-name="Superscript">${escapeXml(node.value)}</text:span>`;
    case 'link': {
      const coderef = /^\((.*)\)$/.exec(node.target.trim());
      if (coderef) {
        const found = resolveCodeRef(codeBlocksOdt, coderef[1]);
        if (found === null) return escapeXml(brokenLinkText(brokenOdt, coderef[1]));
        const shown = /^\d+$/.test(found) ? `<text:bookmark-ref text:reference-format="number" text:ref-name="OrgXref.${escapeXml('coderef-' + coderef[1])}">${found}</text:bookmark-ref>` : escapeXml(found);
        return node.description ? escapeXml(coderefText(coderef[1], '\u0000', node.description)).replace('\u0000', shown) : shown;
      }
      const info = linkCtxOdt ? internalLink(linkCtxOdt, node.target) : null;
      const broken = node.radio || info ? null : brokenLinkPath(/** @type {Doc} */ (docForLinkResolutionOdt), node.target);
      if (broken !== null) return escapeXml(brokenLinkText(brokenOdt, broken));
      if (info && info.anchor) {
        const text = node.description ? renderTextOdt(node.description, false) : info.label !== null ? escapeXml(info.label) : escapeXml(node.target);
        return `<text:a xlink:type="simple" xlink:href="#${escapeXml(info.anchor)}">${text}</text:a>`;
      }
      const label = node.description ? renderTextOdt(node.description, false) : info && info.label !== null ? escapeXml(info.label) : escapeXml(node.target);
      const bookmarkName = resolveInternalLinkOdt(node.target);
      if (bookmarkName) {
        return `<text:bookmark-ref text:reference-format="text" text:ref-name="${escapeXml(bookmarkName)}">${label}</text:bookmark-ref>`;
      }
      return `<text:a xlink:type="simple" xlink:href="${escapeXml(node.target)}">${label}</text:a>`;
    }
    case 'latex':
      // not typeset: the fragment as typed, in the code style, so no formula is lost
      return `<text:span text:style-name="Code">${escapeXml(node.raw !== undefined ? node.raw : node.source)}</text:span>`;
    case 'image':
      // Not embedded -- see this file's own header comment for why.
      return `<text:span text:style-name="Code">[image: ${escapeXml(node.target)}]</text:span>`;
    case 'footnote-ref':
    case 'footnote-def': {
      if (!footnotesOdt) return '';
      // ODF's own native footnote -- a real, editable footnote, not a
      // manually-numbered reference into a hand-built list. The
      // footnote's own body is just a paragraph of inline content
      // inside <text:note-body>; org's optional explicit [fn:label]
      // becomes the note's citation text where present, otherwise ODF
      // auto-numbers it (text:note-class handles the numbering itself).
      const children = node.type === 'footnote-def' ? node.children : (node.label !== null && footnoteDefsOdt.get(node.label)) || [];
      const citation = node.label !== null ? escapeXml(node.label) : '';
      footnoteCounterOdt++;
      return (
        `<text:note text:id="ftn${footnoteCounterOdt}" text:note-class="footnote">` +
        `<text:note-citation>${citation}</text:note-citation>` +
        `<text:note-body><text:p text:style-name="Footnote">${renderInlineListOdt(children)}</text:p></text:note-body>` +
        `</text:note>`
      );
    }
    case 'citation': {
      const segments = citeOdt ? citeOdt.formatCitation(node) : null;
      return (segments ? citeSegmentsOdt(segments).trim() : '') + ' '.repeat(node.blanks);
    }
    case 'radio-target':
      return linkCtxOdt ? `<text:bookmark-start text:name="${escapeXml(anchorFor(linkCtxOdt, node.name))}"/>${escapeXml(node.name)}<text:bookmark-end text:name="${escapeXml(anchorFor(linkCtxOdt, node.name))}"/>` : escapeXml(node.name);
    case 'target':
      return linkCtxOdt ? `<text:bookmark text:name="${escapeXml(anchorFor(linkCtxOdt, node.name))}"/>` : '';
    case 'comment':
      return ''; // matches every other export backend -- comments never appear in exported output
    default:
      return '';
  }
}

/** @type {any} */ let citeOdt = null; // the citation text maker for this export (cite.js)

/** A citation processor's output as ODF text: affixes as Org text, emphasis as the Italic span.
 * @param {import('./cite.js').Segment[]} segments
 * @returns {string} */
function citeSegmentsOdt(segments) {
  return segments.map((s) => (typeof s === 'string' ? escapeXml(s) : 'org' in s ? renderTextOdt(s.org) : `<text:span text:style-name="Italic">${citeSegmentsOdt(s.italic)}</text:span>`)).join('');
}

/** @param {string} text
 * @param {boolean} [radio]  whether a radio target's plain mentions become links (not inside a link's own text) */
function renderTextOdt(text, radio = true) {
  return renderInlineListOdt(parseInline(text, radio && linkCtxOdt && linkCtxOdt.radioRe ? { radioTargets: linkCtxOdt.radioRe, subSuperscriptMode: supOdt } : { subSuperscriptMode: supOdt }));
}

// ---- body content -----------------------------------------------------

/** @param {import('./types.js').Paragraph} node @returns {string} */
function renderParagraphOdt(node) {
  // A footnote's own DEFINITION line (the "[fn:label] text" form,
  // as opposed to an inline footnote-def already rendered where it
  // was referenced) has already been captured and rendered inline via
  // the footnote-ref/footnote-def case above when its reference was
  // encountered -- the definition-line paragraph itself contributes
  // nothing further here, same as export-html.js's own treatment.
  if (node.footnoteLabel !== null) return '';
  const pieces = splitBibliography(node.lines);
  if (pieces.some((p) => 'bibliography' in p)) {
    return pieces
      .map((p) => ('bibliography' in p ? (citeOdt ? citeOdt.bibliography() : []).map((/** @type {any} */ e) => `<text:p text:style-name="Standard">${citeSegmentsOdt(e)}</text:p>`).join('') : renderParagraphOdt({ ...node, lines: p.lines })))
      .join('');
  }
  const joined = node.lines
    .map((/** @type {string} */ line, /** @type {number} */ i) => {
      const forcedBreak = stripLineBreakMarker(line) !== line;
      const rendered = renderTextOdt(stripLineBreakMarker(line));
      if (i === node.lines.length - 1) return rendered;
      return rendered + (forcedBreak ? '<text:line-break/>' : ' ');
    })
    .join('');
  return '<text:p text:style-name="Standard">' + joined + '</text:p>';
}

/**
 * @param {import('./types.js').ListItem[]} items
 * @param {string} listStyleName
 */
function renderListItemsOdt(items, listStyleName) {
  const rows = items.map((item) => {
    let inner = renderInlineListOdt(item.inline);
    if (item.checkbox !== null) {
      const box = item.checkbox === 'X' ? '\u2611' : '\u2610'; // real checkbox glyphs -- ODF has no native checkbox-list construct to match org's own
      inner = `${box} ${inner}`;
    }
    if (item.tag) {
      inner = `<text:span text:style-name="Bold">${renderTextOdt(item.tag)}:</text:span> ${inner}`;
    }
    /** @param {any} [nestedList] */
    const nested = (item.children || []).map((nestedList) => renderListOdt(nestedList)).join('');
    return `<text:list-item><text:p text:style-name="Standard">${inner}</text:p>${nested}</text:list-item>`;
  });
  return `<text:list text:style-name="${listStyleName}">${rows.join('')}</text:list>`;
}

/** @param {import('./types.js').List} list @returns {string} */
function renderListOdt(list) {
  const isCheckbox = list.items.some((it) => it.checkbox !== null);
  const isOrdered = !isCheckbox && list.items.length > 0 && list.items[0].ordered;
  return renderListItemsOdt(list.items, isOrdered ? 'OrderedList' : 'UnorderedList');
}

/** @param {Table} table */
function renderTableOdt(table) {
  if (!tablesOdt) return '';
  const dataRows = table.rows.filter((r) => r.type === 'row' && !isWidthCookieRow(r));
  if (dataRows.length === 0) return '';
  const colCount = Math.max(...dataRows.map((/** @type {any} */ r) => r.cellsInline.length));
  const columns = Array(colCount).fill('<table:table-column/>').join('');
  const rowsXml = dataRows
    .map(
      (/** @type {any} */ row) =>
        '<table:table-row>' +
        row.cellsInline
          .map(
            (/** @type {any} */ c) =>
              `<table:table-cell office:value-type="string"><text:p text:style-name="Standard">${renderInlineListOdt(c)}</text:p></table:table-cell>`
          )
          .join('') +
        '</table:table-row>'
    )
    .join('');
  return `<table:table>${columns}${rowsXml}</table:table>`;
}

/** Strips org's own comma-escape convention from one block content
 *  line for display -- see export-html.js's own stripCommaEscape for
 * @param {string} line
 *  the full reasoning; the same fix, applied here too. */
function stripCommaEscape(line) {
  return line.replace(/^(\s*),(?=\*|#\+)/, '$1');
}

// ---- source and example blocks (numbers and references) ---------------------------------------

/** @typedef {import('./code-lines.js').CodeBlock & { start: number | null }} CodeEntry */
/** @type {WeakMap<object, CodeEntry>} */
let codeOdt = new WeakMap();
/** @type {CodeEntry[]} */
let codeBlocksOdt = [];

/**
 * Reads every source and example block once, in order, so that a reference can point forward.
 * @param {Doc} doc
 * @param {Heading[]} roots
 * @param {boolean} withPreamble
 */
function scanCodeOdt(doc, roots, withPreamble) {
  codeOdt = new WeakMap();
  codeBlocksOdt = [];
  const counter = newCodeCounter();
  /** @param {import('./types.js').BodyNode[] | undefined} body */
  const scanBody = (body) => {
    for (const node of body || []) {
      if (node.type !== 'block' || (node.name !== 'SRC' && node.name !== 'EXAMPLE')) continue;
      const lines = node.lines.map(stripCommaEscape);
      const block = unravelCode(lines, blockSwitchText(node.name.toLowerCase(), node.params || ''));
      const entry = { ...block, start: codeStart(counter, block.switches, lines.length) };
      codeOdt.set(node, entry);
      codeBlocksOdt.push(entry);
    }
  };
  /** @param {Heading[]} headings */
  const scanHeadings = (headings) => {
    for (const h of headings) {
      scanBody(h.body);
      scanHeadings(h.children || []);
    }
  };
  if (withPreamble) scanBody(doc.body);
  scanHeadings(roots);
}

/**
 * The lines of a source or example block (`org-odt-do-format-code`): a numbered block is a list that continues the previous
 * one unless it starts at 0, and a line with a reference is a bookmark that references link to.
 * @param {import('./types.js').Block} block
 */
function codeBlockOdt(block) {
  const entry = codeOdt.get(block);
  if (!entry) return block.lines.map(stripCommaEscape).map((l) => `<text:p text:style-name="Code">${escapeXml(l) || '<text:s/>'}</text:p>`).join('');
  const { lines, refs, switches, start } = entry;
  const rows = lines.map((line, i) => {
    const ref = refs.get(i + 1);
    let text = escapeXml(line) || '<text:s/>';
    if (ref !== undefined && switches.retainLabels) text += escapeXml(` (${ref})`);
    if (ref !== undefined) {
      const name = escapeXml(`coderef-${ref}`);
      text = `<text:bookmark-start text:name="OrgXref.${name}"/><text:bookmark text:name="${name}"/>${text}<text:bookmark-end text:name="OrgXref.${name}"/>`;
    }
    const para = `<text:p text:style-name="Code">${text}</text:p>`;
    return start === null ? para : `<text:list-item>${para}</text:list-item>`;
  });
  return start === null ? rows.join('') : `<text:list text:style-name="OrgSrcBlockNumberedLine" text:continue-numbering="${start === 0 ? 'false' : 'true'}">${rows.join('')}</text:list>`;
}

/** An inline task as a bordered paragraph for the title over the contents (Org's own is a drawing frame of 30 characters). @param {import('./types.js').Block} block @returns {string} */
function inlineTaskOdt(block) {
  const info = inlineTaskInfo(block.params || '');
  const title = [info.todo ? `<text:span text:style-name="TodoKeywordActive">${escapeXml(info.todo)}</text:span>` : '', renderTextOdt(info.title), info.tags.length ? `<text:span text:style-name="Code">:${info.tags.map(escapeXml).join(':')}:</text:span>` : ''].filter(Boolean).join(' ');
  const contents = parseBody(block.lines).map(renderBodyNodeOdt).join('');
  return `<text:p text:style-name="InlineTaskTitle">${title}</text:p>${contents}`;
}

/** @param {import('./types.js').Block} block @returns {string} */
function renderBlockOdt(block) {
  const name = block.name;
  if (name.toLowerCase() === INLINE_TASK_BLOCK) return inlineTaskOdt(block);
  if (name === 'COMMENT') return ''; // matches every other export backend
  if (name === 'EXPORT') {
    return (block.params || '').trim().toLowerCase() === 'odt' ? block.lines.join('\n') : '';
  }
  if (name === 'QUOTE') {
    return block.lines.map(stripCommaEscape).map((l) => `<text:p text:style-name="Quote">${renderTextOdt(l)}</text:p>`).join('');
  }
  if (name === 'SRC' || name === 'EXAMPLE') return codeBlockOdt(block);
  // every other/unrecognized block type: preserve verbatim in
  // a monospaced paragraph per line, same "don't try to reinterpret
  // content this app has no specific handling for" reasoning
  // (the same as the other exporters).
  return block.lines.map(stripCommaEscape).map((l) => `<text:p text:style-name="Code">${escapeXml(l) || '<text:s/>'}</text:p>`).join('');
}

/** @param {import('./types.js').BodyNode} node @returns {string} */
function renderBodyNodeOdt(node) {
  if (node.type === 'list') return renderListOdt(node);
  if (node.type === 'paragraph') return renderParagraphOdt(node);
  if (node.type === 'table') return renderTableOdt(node);
  if (node.type === 'block') return renderBlockOdt(node);
  if (node.type === 'hr') return '<text:p text:style-name="Standard"><text:soft-page-break/></text:p>';
  return '';
}

// ---- headings -----------------------------------------------------------

/** @param {Heading['planning'] | null | undefined} planning */
function renderPlanningOdt(planning) {
  if (!planning) return '';
  const parts = [];
  if (planning.scheduled) parts.push(`Scheduled: ${escapeXml(planning.scheduled)}`);
  if (planning.deadline) parts.push(`Deadline: ${escapeXml(planning.deadline)}`);
  if (parts.length === 0) return '';
  return `<text:p text:style-name="Planning">${parts.join(' \u2014 ')}</text:p>`;
}

/** ODF's own outline-level attribute has no hard ceiling the way
 *  HTML's h1-h6 does, but this app's own Heading_20_N paragraph
 *  styles (defined in stylesXmlOdt below) only go up to 6 -- clamp
 *  the same way export-html.js does, for the same "don't reference a
 * @param {number} level
 *  style that was never defined" reason. */
function clampHeadingLevelOdt(level) {
  return Math.min(6, Math.max(1, level));
}

/**
 * @param {Heading} heading
 * @param {number} level
 * @param {string | string[]} doneKeywords
 */
function renderHeadingLineOdt(heading, level, doneKeywords) {
  const clamped = clampHeadingLevelOdt(level);
  const id = headingIdMapOdt.get(heading);
  const parts = [];
  if (numberingEnabledOdt) parts.push(`${nextSectionNumberOdt(level)}.`);
  if (heading.todo) {
    const style = doneKeywords.includes(heading.todo) ? 'TodoKeywordDone' : 'TodoKeywordActive';
    parts.push(`<text:span text:style-name="${style}">${escapeXml(heading.todo)}</text:span>`);
  }
  if (heading.priority) parts.push(`<text:span text:style-name="Bold">[#${escapeXml(heading.priority)}]</text:span>`);
  parts.push(renderTextOdt(heading.title) || '(untitled)');
  let inner = parts.join(' ');
  if (heading.tags && heading.tags.length) {
    inner += ' <text:span text:style-name="Code">:' + heading.tags.map(escapeXml).join(':') + ':</text:span>';
  }
  const bookmark = id ? `<text:bookmark-start text:name="${escapeXml(id)}"/>` : '';
  const bookmarkEnd = id ? `<text:bookmark-end text:name="${escapeXml(id)}"/>` : '';
  return `<text:h text:style-name="Heading_20_${clamped}" text:outline-level="${clamped}">${bookmark}${inner}${bookmarkEnd}</text:h>`;
}

/**
 * @param {Heading} heading
 * @param {number} levelOffset
 * @param {string[]} doneKeywords
 * @param {string[]} out
 */
function renderHeadingOdt(heading, levelOffset, doneKeywords, out) {
  out.push(renderHeadingLineOdt(heading, heading.level - levelOffset, doneKeywords));

  const planningLine = renderPlanningOdt(heading.planning);
  if (planningLine) out.push(planningLine);

  for (const node of heading.body || []) {
    const rendered = renderBodyNodeOdt(node);
    if (rendered) out.push(rendered);
  }

  for (const child of heading.children || []) {
    renderHeadingOdt(child, levelOffset, doneKeywords, out);
  }
}

// ---- static ODF package parts ----------------------------------------------

const MIMETYPE = 'application/vnd.oasis.opendocument.text';

const MANIFEST_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">\n' +
  '<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>\n' +
  '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>\n' +
  '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>\n' +
  '<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>\n' +
  '</manifest:manifest>\n';

/** Character/paragraph style definitions every renderXOdt function
 *  above references by name -- heading levels 1-6 (decreasing font
 *  size), the inline character styles (Bold/Italic/etc.), list styles,
 *  and the TODO-keyword styles. Deliberately plain and readable rather
 *  than trying to visually match this app's own on-screen theme --
 *  what matters for a word-processor document is that it opens
 *  correctly and looks like a normal, well-formatted document, not
 *  that it matches a mobile app's own color scheme. */
function stylesXml() {
  const headingSizes = { 1: '20pt', 2: '17pt', 3: '14pt', 4: '12pt', 5: '11pt', 6: '10pt' };
  const headingStyles = Object.entries(headingSizes)
    .map(
      ([level, size]) =>
        `<style:style style:name="Heading_20_${level}" style:family="paragraph" style:parent-style-name="Heading">` +
        `<style:text-properties fo:font-size="${size}" fo:font-weight="bold"/>` +
        `</style:style>`
    )
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
    'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
    'office:version="1.2">\n' +
    '<office:styles>' +
    '<style:default-style style:family="paragraph"><style:text-properties style:font-name="Liberation Sans" fo:font-size="11pt"/></style:default-style>' +
    '<style:style style:name="Standard" style:family="paragraph"/>' +
    '<style:style style:name="Heading" style:family="paragraph"><style:text-properties fo:font-weight="bold"/></style:style>' +
    '<style:style style:name="Title" style:family="paragraph"><style:text-properties fo:font-size="26pt" fo:font-weight="bold"/></style:style>' +
    '<style:style style:name="Subtitle" style:family="paragraph"><style:text-properties fo:font-size="12pt" fo:color="#666666"/></style:style>' +
    '<style:style style:name="Creator" style:family="paragraph"><style:text-properties fo:font-size="9pt" fo:color="#999999" fo:font-style="italic"/></style:style>' +
    headingStyles +
    '<style:style style:name="Quote" style:family="paragraph"><style:paragraph-properties fo:margin-left="0.5in"/><style:text-properties fo:font-style="italic"/></style:style>' +
    '<style:style style:name="Code" style:family="text"><style:text-properties style:font-name="Liberation Mono"/></style:style>' +
    '<style:style style:name="InlineTaskTitle" style:family="paragraph"><style:paragraph-properties fo:margin-left="0.5in" fo:margin-right="0.5in" fo:padding="0.05in" fo:border="0.5pt solid #000000" fo:background-color="#eeeeee"/><style:text-properties fo:font-weight="bold"/></style:style>' +
    '<style:style style:name="Planning" style:family="paragraph"><style:text-properties fo:font-style="italic" fo:color="#666666"/></style:style>' +
    '<style:style style:name="Footnote" style:family="paragraph"><style:text-properties fo:font-size="9pt"/></style:style>' +
    '<style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>' +
    '<style:style style:name="Italic" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>' +
    '<style:style style:name="Underline" style:family="text"><style:text-properties style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>' +
    '<style:style style:name="Strikethrough" style:family="text"><style:text-properties style:text-line-through-style="solid"/></style:style>' +
    '<style:style style:name="Subscript" style:family="text"><style:text-properties style:text-position="sub 58%"/></style:style>' +
    '<style:style style:name="Superscript" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>' +
    '<style:style style:name="TodoKeywordActive" style:family="text"><style:text-properties fo:font-weight="bold" fo:color="#a83232"/></style:style>' +
    '<style:style style:name="TodoKeywordDone" style:family="text"><style:text-properties fo:font-weight="bold" fo:color="#2f8f3f"/></style:style>' +
    '<text:list-style style:name="UnorderedList"><text:list-level-style-bullet text:level="1" text:bullet-char="\u2022"><style:list-level-properties text:space-before="0.25in"/></text:list-level-style-bullet></text:list-style>' +
    '<text:list-style style:name="OrgSrcBlockNumberedLine"><text:list-level-style-number text:level="1" style:num-format="1"><style:list-level-properties text:space-before="0.635cm" text:min-label-width="0.635cm" text:min-label-distance="0.101cm" fo:text-align="end"/></text:list-level-style-number></text:list-style>' +
    '<text:list-style style:name="OrderedList"><text:list-level-style-number text:level="1" style:num-format="1" style:num-suffix="."><style:list-level-properties text:space-before="0.25in"/></text:list-level-style-number></text:list-style>' +
    '</office:styles>\n' +
    '</office:document-styles>\n'
  );
}

/**
 * @param {string} title
 * @param {string | null} author
 * @param {string | null} date
 */
function metaXml(title, author, date) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.2">\n' +
    '<office:meta>' +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    (author ? `<dc:creator>${escapeXml(author)}</dc:creator>` : '') +
    (date ? `<dc:date>${escapeXml(date)}</dc:date>` : '') +
    '<meta:generator xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0">org-pwa</meta:generator>' +
    '</office:meta>\n' +
    '</office:document-meta>\n'
  );
}

/** @param {string} bodyXml */
function contentXml(bodyXml) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
    'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
    'xmlns:xlink="http://www.w3.org/1999/xlink" ' +
    'office:version="1.2">\n' +
    '<office:body><office:text>' +
    bodyXml +
    '</office:text></office:body>\n' +
    '</office:document-content>\n'
  );
}

/**
 * Exports `doc` (or, if `scope` is given, just that heading and its
 * descendants) to a real .odt file, returned as a Uint8Array ready to
 * hand to a download function. Same by-reference `scope` convention
 * as exportToHtml.
 */
/** Builds one level of the ToC's own nested list -- a real ODF
 *  <text:list>, linking each entry to the same bookmark
 * @param {Heading[]} headings
 * @param {number} level
 * @param {number} maxDepth
 * @param {boolean} numberingEnabled
 * @param {number[]} numbers
 *  renderHeadingLineOdt already creates for that heading.
 * @returns {string} */
function buildTocListOdt(headings, level, maxDepth, numberingEnabled, numbers) {
  if (level > maxDepth || headings.length === 0) return '';
  const items = headings
    .map((heading) => {
      numbers.length = level;
      numbers[level - 1] = (numbers[level - 1] || 0) + 1;
      const number = numbers.slice(0, level).join('.');
      const id = headingIdMapOdt.get(heading);
      const label = (numberingEnabled ? `${number}. ` : '') + (renderTextOdt(heading.title) || '(untitled)');
      const link = id ? `<text:a xlink:type="simple" xlink:href="#${escapeXml(id)}">${label}</text:a>` : label;
      const childList = buildTocListOdt(heading.children || [], level + 1, maxDepth, numberingEnabled, numbers);
      return `<text:list-item><text:p>${link}</text:p>${childList}</text:list-item>`;
    })
    .join('');
  return `<text:list text:style-name="UnorderedList">${items}</text:list>`;
}

/** Builds the full Table of Contents block, or '' when `toc` is
 *  false, or fewer than two headings are actually visible at `toc`'s
 * @param {Heading[]} roots
 * @param {number | boolean | null | undefined} toc
 * @param {boolean} numberingEnabled
 *  own depth limit -- matches buildTocHtml's own conditions exactly. */
function buildTocOdt(roots, toc, numberingEnabled) {
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
  const list = buildTocListOdt(roots, 1, maxDepth, numberingEnabled, []);
  return `<text:p text:style-name="Heading">Table of Contents</text:p>${list}`;
}

/** @param {Doc} doc */
export function exportToOdt(doc, scope = /** @type {any} */ (null), { sup = 't', brokenLinks = /** @type {import('./broken-links.js').BrokenLinks} */ ('nil') } = {}) {
  ({ doc, scope } = expandMacrosForExport(doc, scope, new Date())); // {{{macros}}} are expanded before anything is read
  ({ doc, scope } = foldInlineTasks(doc, scope));
  docForLinkResolutionOdt = doc;
  headingIdMapOdt = new Map();
  footnoteCounterOdt = 0;
  sectionNumbersOdt = [];
  const options = parseExportOptions(doc, sup, brokenLinks);
  supOdt = options.sup;
  brokenOdt = options.broken;
  numberingEnabledOdt = options.num;
  const raw = rawExportOptions(doc);
  footnotesOdt = raw.f !== 'nil';
  footnoteDefsOdt = new Map();
  /** @param {import('./types.js').Heading[]} headings */
  const collectDefs = (headings) => {
    for (const h of headings) {
      for (const node of parseBody(h.bodyLines || [])) {
        if (node.type === 'paragraph' && node.footnoteLabel !== null && !footnoteDefsOdt.has(node.footnoteLabel)) {
          footnoteDefsOdt.set(node.footnoteLabel, node.inlineLines.flatMap((/** @type {import('./types.js').InlineNode[]} */ line, /** @type {number} */ i) => (i ? [/** @type {import('./types.js').InlineNode} */ ({ type: 'text', value: ' ' }), ...line] : line)));
        }
      }
      collectDefs(h.children || []);
    }
  };
  collectDefs(doc.children || []);
  tablesOdt = raw['|'] !== 'nil';

  const roots = scope ? [scope] : doc.children || [];
  assignHeadingIdsOdt(roots, new Set());
  citeOdt = citeExportFor(doc, roots, parseInline, !scope);
  linkCtxOdt = buildLinkContext(doc, roots, options.num);
  scanCodeOdt(doc, roots, !scope);
  const levelOffset = scope ? scope.level - 1 : 0;
  const { doneKeywords } = resolveTodoSequence(doc);
  const out = [];

  const titleSource = scope ? scope.title : (doc.keywords || []).find((k) => k.key.toUpperCase() === 'TITLE');
  const title = scope ? scope.title : titleSource ? titleSource.value : 'Untitled';
  const author = !scope && options.author ? getDocAuthor(doc) : null;
  const date = !scope && options.date ? getDocDate(doc) : null;

  if (!scope && getDocTitle(doc)) {
    out.push(`<text:p text:style-name="Title">${escapeXml(/** @type {string} */ (getDocTitle(doc)))}</text:p>`);
    if (author) out.push(`<text:p text:style-name="Subtitle">${escapeXml(author)}</text:p>`);
    if (date) out.push(`<text:p text:style-name="Subtitle">${escapeXml(date)}</text:p>`);
  }
  if (!scope) {
    const toc = buildTocOdt(roots, options.toc, options.num);
    if (toc) out.push(toc);
    for (const node of doc.body || []) {
      const rendered = renderBodyNodeOdt(node);
      if (rendered) out.push(rendered);
    }
  }

  for (const heading of roots) {
    renderHeadingOdt(heading, levelOffset, doneKeywords, out);
  }

  if (!scope && options.creator) {
    out.push('<text:p text:style-name="Creator">Generated by org-pwa</text:p>');
  }

  const zip = createZip([
    { name: 'mimetype', content: MIMETYPE },
    { name: 'META-INF/manifest.xml', content: MANIFEST_XML },
    { name: 'content.xml', content: contentXml(finishDropped(out.join(''))) },
    { name: 'styles.xml', content: stylesXml() },
    { name: 'meta.xml', content: metaXml(title, author, date) },
  ]);

  return zip;
}
