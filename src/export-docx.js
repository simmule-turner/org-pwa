/**
 * Converts an org document (or a single heading's subtree) to a real,
 * standalone .docx file -- a ZIP archive of Office Open XML (OOXML),
 * openable directly in Microsoft Word, Google Docs (import), Pages,
 * and LibreOffice/OpenOffice. Pure and DOM-free -- walks the same
 * parsed AST org-parser.js already produces, the same way
 * export-html.js, export-markdown.js, and export-odt.js all do.
 *
 * Scope and behavior mirror export-odt.js closely (same inline markup
 * coverage, same resolveLinkTarget-based internal-link resolution,
 * same property-drawer/ARCHIVE_* exclusion) -- this exists alongside
 * ODT, not instead of it, as a second "hand this to a word processor"
 * option: ODT faithfully matches real org's own ox-odt backend, but
 * DOCX has meaningfully broader real-world compatibility (Word,
 * Google Docs, and Pages all open it natively, where ODT support
 * varies). Two differences from ODT's own approach, both forced by
 * how OOXML itself works rather than a deliberate scope choice:
 *   - An external hyperlink needs its own relationship entry in
 *     word/_rels/document.xml.rels (referenced by a run's own r:id),
 *     rather than ODF's own inline xlink:href attribute -- collected
 *     during rendering and emitted as a second archive part at the
 *     end, see collectedHyperlinksDocx below.
 *   - List bullets/numbers are defined once in word/numbering.xml
 *     (abstract definitions Word references by numId/ilvl), not
 *     declared inline the way ODF's own text:list-style is.
 * Footnotes still use Word's own real, native mechanism
 * (word/footnotes.xml + a w:footnoteReference in the run) -- a real,
 * editable, renumberable footnote, matching ODT's own use of ODF's
 * native <text:note>. Images are a plain text reference to their
 * target path, not embedded, matching every other exporter here.
 */

import { parseInline, stripLineBreakMarker } from './inline-markup.js';
import { resolveTodoSequence } from './todo-cycle.js';
import { resolveLinkTarget } from './link-resolve.js';
import { createZip } from './zip-writer.js';
import { isWidthCookieRow } from './table-cookies.js';
import { parseExportOptions, getDocTitle, getDocAuthor, getDocDate } from './export-options.js';
import { getProperty } from './archive-model.js';

// ---- escaping -------------------------------------------------------------

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

/** <w:t> needs xml:space="preserve" whenever the text has leading,
 *  trailing, or repeated internal whitespace Word might otherwise
 *  collapse -- always setting it is simpler and always safe, matching
 *  how real org-mode's own ox-docx-style tooling and most OOXML
 *  generators handle this rather than trying to detect when it's
 *  actually necessary. */
function runXml(text, rPrXml = '') {
  if (text === '') return '';
  return `<w:r>${rPrXml}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

// ---- per-export state (reset at the start of every exportToDocx() call) ---

let docForLinkResolutionDocx = null;
let headingIdMapDocx = new Map();
let footnoteCounterDocx = 0;
let footnoteEntriesDocx = [];
let collectedHyperlinksDocx = []; // [{ id, target }] -- relationship entries, assigned in encounter order
let relationshipCounterDocx = 0;
let sectionNumbersDocx = [];
let numberingEnabledDocx = true;

function nextSectionNumberDocx(level) {
  const newNumbers = sectionNumbersDocx.slice(0, level);
  for (let i = 0; i < level - 1; i++) {
    if (newNumbers[i] === undefined) newNumbers[i] = 1;
  }
  newNumbers[level - 1] = (newNumbers[level - 1] || 0) + 1;
  sectionNumbersDocx = newNumbers;
  return sectionNumbersDocx.join('.');
}

function slugifyDocx(title) {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

/** Same approach as export-odt.js's own assignHeadingIdsOdt --
 *  CUSTOM_ID if set, otherwise a slug from the title, disambiguated
 *  with a numeric suffix if two headings would otherwise collide.
 *  Word's own bookmark mechanism (used for internal links, see
 *  resolveInternalLinkDocx) needs the same kind of stable, unique
 *  name per heading an HTML id attribute does -- with one additional
 *  OOXML-specific constraint: a bookmark name can't start with a
 *  digit, so a purely-numeric CUSTOM_ID or slug gets a leading
 *  underscore rather than being rejected outright. */
function assignHeadingIdsDocx(headings, usedSlugs) {
  for (const heading of headings) {
    const customId = getProperty(heading, 'CUSTOM_ID');
    let id = customId ? customId.trim() : '';
    if (!id) id = slugifyDocx(heading.title);
    if (/^[0-9]/.test(id)) id = '_' + id;
    let unique = id;
    let n = 2;
    while (usedSlugs.has(unique)) {
      unique = id + '-' + n;
      n++;
    }
    usedSlugs.add(unique);
    headingIdMapDocx.set(heading, unique);
    assignHeadingIdsDocx(heading.children || [], usedSlugs);
  }
}

/** Resolves a link's raw target to a Word-internal bookmark anchor if
 *  it points to a heading actually included in this export, or null
 *  otherwise -- same reasoning as export-odt.js's own
 *  resolveInternalLinkOdt, adapted to Word's own w:anchor mechanism
 *  (a bookmark name, not a URL fragment or ODF ref-name). */
function resolveInternalLinkDocx(target) {
  if (!docForLinkResolutionDocx) return null;
  const resolution = resolveLinkTarget(docForLinkResolutionDocx, target);
  if (resolution.type === 'heading' && headingIdMapDocx.has(resolution.heading)) {
    return headingIdMapDocx.get(resolution.heading);
  }
  return null;
}

/** Registers `url` as an external hyperlink relationship, returning
 *  its own r:id -- Word requires every hyperlink's actual target URL
 *  to live in word/_rels/document.xml.rels, referenced from the run
 *  by id only, rather than an inline href attribute the way HTML/ODF
 *  both allow. Each call gets its own, fresh relationship entry (no
 *  de-duplication for a repeated URL) -- simpler, and Word has no
 *  issue with two relationships pointing at the same target. */
function registerHyperlinkDocx(url) {
  relationshipCounterDocx++;
  const id = `rId${100 + relationshipCounterDocx}`; // 100+ keeps these clear of the small, fixed set of static relationship ids (styles/numbering/footnotes) assigned below
  collectedHyperlinksDocx.push({ id, target: url });
  return id;
}

// ---- inline rendering -----------------------------------------------------

/** Renders a list of inline AST nodes into one or more <w:r> runs,
 *  each carrying whatever direct run-formatting (`inheritedRPr`, an
 *  already-built <w:rPr>...</w:rPr> string or '') applies -- unlike
 *  ODF's own named character styles, OOXML runs carry formatting
 *  directly, so nested bold-inside-italic etc. just concatenates the
 *  relevant <w:b/>/<w:i/> etc. elements into one shared w:rPr rather
 *  than needing a style hierarchy. */
function renderInlineListDocx(nodes, rPrParts = []) {
  return nodes.map((node) => renderInlineNodeDocx(node, rPrParts)).join('');
}

function buildRPr(parts) {
  if (parts.length === 0) return '';
  return `<w:rPr>${parts.join('')}</w:rPr>`;
}

function renderInlineNodeDocx(node, rPrParts) {
  switch (node.type) {
    case 'text':
      return runXml(node.value, buildRPr(rPrParts));
    case 'bold':
      return renderInlineListDocx(node.children, [...rPrParts, '<w:b/>']);
    case 'italic':
      return renderInlineListDocx(node.children, [...rPrParts, '<w:i/>']);
    case 'underline':
      return renderInlineListDocx(node.children, [...rPrParts, '<w:u w:val="single"/>']);
    case 'strikethrough':
      return renderInlineListDocx(node.children, [...rPrParts, '<w:strike/>']);
    case 'code':
    case 'verbatim':
      return runXml(node.value, buildRPr([...rPrParts, '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>']));
    case 'subscript':
      return runXml(node.value, buildRPr([...rPrParts, '<w:vertAlign w:val="subscript"/>']));
    case 'superscript':
      return runXml(node.value, buildRPr([...rPrParts, '<w:vertAlign w:val="superscript"/>']));
    case 'link': {
      const labelNodes = node.description ? parseInline(node.description) : [{ type: 'text', value: node.target }];
      const bookmarkName = resolveInternalLinkDocx(node.target);
      const linkRPr = [...rPrParts, '<w:rStyle w:val="Hyperlink"/>'];
      const labelXml = renderInlineListDocx(labelNodes, linkRPr);
      if (bookmarkName) {
        return `<w:hyperlink w:anchor="${escapeXml(bookmarkName)}">${labelXml}</w:hyperlink>`;
      }
      const rId = registerHyperlinkDocx(node.target);
      return `<w:hyperlink r:id="${rId}">${labelXml}</w:hyperlink>`;
    }
    case 'image':
      // Not embedded -- see this file's own header comment for why.
      return runXml(`[image: ${node.target}]`, buildRPr([...rPrParts, '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>']));
    case 'footnote-ref':
    case 'footnote-def': {
      // Word's own native footnote -- a real, editable, renumberable
      // footnote, not a manually-numbered reference into a hand-built
      // list, matching export-odt.js's own use of ODF's native
      // <text:note>. org's optional explicit [fn:label] becomes the
      // footnote body's own leading text where present (Word's own
      // footnote numbering is always automatic -- there's no
      // equivalent of ODF's separate note-citation slot to put a
      // custom label into), otherwise the body is just the referenced
      // content on its own.
      const children = node.type === 'footnote-def' ? node.children : [];
      footnoteCounterDocx++;
      const id = footnoteCounterDocx;
      const labelPrefix = node.label !== null ? `[${node.label}] ` : '';
      const bodyRuns =
        runXml(labelPrefix, buildRPr(['<w:rStyle w:val="FootnoteReference"/>'])) + renderInlineListDocx(children, []);
      footnoteEntriesDocx.push(
        `<w:footnote w:id="${id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>` +
          `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>` +
          bodyRuns +
          `</w:p></w:footnote>`
      );
      return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
    }
    case 'comment':
      return ''; // matches every other export backend -- comments never appear in exported output
    default:
      return '';
  }
}

function renderTextDocx(text) {
  return renderInlineListDocx(parseInline(text), []);
}

// ---- body content -----------------------------------------------------

function renderParagraphDocx(node) {
  // A footnote's own DEFINITION line has already been captured and
  // rendered inline via the footnote-ref/footnote-def case above when
  // its reference was encountered -- same treatment as
  // export-odt.js's own renderParagraphOdt.
  if (node.footnoteLabel !== null) return '';
  const lineRuns = node.lines.map((line, i) => {
    const stripped = stripLineBreakMarker(line);
    const needsTrailingSpace = i < node.lines.length - 1 && stripped === line; // no marker on this line -- the next one flows right after it
    return renderTextDocx(stripped + (needsTrailingSpace ? ' ' : ''));
  });
  const breaks = node.lines.map((line) => (stripLineBreakMarker(line) !== line ? '<w:r><w:br/></w:r>' : ''));
  const withBreaks = lineRuns.map((run, i) => run + (breaks[i] || '')).join('');
  return `<w:p><w:pPr><w:pStyle w:val="Standard"/></w:pPr>${withBreaks}</w:p>`;
}

const BULLET_NUM_ID = 1;
const ORDERED_NUM_ID = 2;

function renderListItemsDocx(items, numId, ilvl) {
  return items
    .map((item) => {
      let inner = renderInlineListDocx(item.inline, []);
      if (item.checkbox !== null) {
        const box = item.checkbox === 'X' ? '\u2611' : '\u2610'; // real checkbox glyphs -- Word has no native checkbox-list construct to match org's own
        inner = runXml(box + ' ') + inner;
      }
      if (item.tag) {
        inner = runXml(renderPlainTextForTag(item.tag) + ': ', buildRPr(['<w:b/>'])) + inner;
      }
      const nested = (item.children || []).map((nestedList) => renderListDocx(nestedList, ilvl + 1)).join('');
      return (
        `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${inner}</w:p>` +
        nested
      );
    })
    .join('');
}

/** A list item's own :tag: text (definition-list term) needs plain
 *  text, not a nested run structure -- item.tag is already a bare
 *  string, so this just re-parses it the same way any other inline
 *  text field here does, returning only its own concatenated text
 *  content (the bold wrapper above already supplies the formatting). */
function renderPlainTextForTag(tag) {
  return parseInline(tag)
    .map((n) => (n.type === 'text' ? n.value : n.value || ''))
    .join('');
}

function renderListDocx(list, ilvl = 0) {
  const isCheckbox = list.items.some((it) => it.checkbox !== null);
  const isOrdered = !isCheckbox && list.items.length > 0 && list.items[0].ordered;
  return renderListItemsDocx(list.items, isOrdered ? ORDERED_NUM_ID : BULLET_NUM_ID, ilvl);
}

function renderTableDocx(table) {
  const dataRows = table.rows.filter((r) => r.type === 'row' && !isWidthCookieRow(r));
  if (dataRows.length === 0) return '';
  const colCount = Math.max(...dataRows.map((r) => r.cellsInline.length));
  const gridXml = '<w:tblGrid>' + Array(colCount).fill('<w:gridCol/>').join('') + '</w:tblGrid>';
  const rowsXml = dataRows
    .map(
      (row) =>
        '<w:tr>' +
        row.cellsInline
          .map((c) => `<w:tc><w:p>${renderInlineListDocx(c, [])}</w:p></w:tc>`)
          .join('') +
        '</w:tr>'
    )
    .join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>${gridXml}${rowsXml}</w:tbl>`;
}

function renderBlockDocx(block) {
  const name = block.name;
  if (name === 'COMMENT') return ''; // matches every other export backend
  if (name === 'QUOTE') {
    return block.lines.map((l) => `<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr>${renderTextDocx(l)}</w:p>`).join('');
  }
  // SRC and every other/unrecognized block type: preserve verbatim in
  // a monospaced paragraph per line, same reasoning export-odt.js's
  // own renderBlockOdt already documents.
  return block.lines
    .map((l) => `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>${runXml(l, buildRPr(['<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>']))}</w:p>`)
    .join('');
}

function renderBodyNodeDocx(node) {
  if (node.type === 'list') return renderListDocx(node);
  if (node.type === 'paragraph') return renderParagraphDocx(node);
  if (node.type === 'table') return renderTableDocx(node);
  if (node.type === 'block') return renderBlockDocx(node);
  if (node.type === 'hr') return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>';
  return '';
}

// ---- headings -----------------------------------------------------------

function renderPlanningDocx(planning) {
  if (!planning) return '';
  const parts = [];
  if (planning.scheduled) parts.push(`Scheduled: ${planning.scheduled}`);
  if (planning.deadline) parts.push(`Deadline: ${planning.deadline}`);
  if (parts.length === 0) return '';
  const rPr = buildRPr(['<w:i/>', '<w:color w:val="666666"/>']);
  return `<w:p>${runXml(parts.join('  \u2014  '), rPr)}</w:p>`;
}

/** Word's own built-in Heading1-Heading9 styles cover more levels
 *  than ODF's own convention this app matched (1-6), but staying at 6
 *  keeps both exporters' own clamping behavior consistent with each
 *  other rather than one silently supporting deeper nesting than the
 *  other. */
function clampHeadingLevelDocx(level) {
  return Math.min(6, Math.max(1, level));
}

function renderHeadingLineDocx(heading, level, doneKeywords) {
  const clamped = clampHeadingLevelDocx(level);
  const id = headingIdMapDocx.get(heading);
  const runs = [];
  if (numberingEnabledDocx) runs.push(runXml(`${nextSectionNumberDocx(level)}. `));
  if (heading.todo) {
    const color = doneKeywords.includes(heading.todo) ? '2f8f3f' : 'a83232';
    runs.push(runXml(heading.todo + ' ', buildRPr(['<w:b/>', `<w:color w:val="${color}"/>`])));
  }
  if (heading.priority) runs.push(runXml(`[#${heading.priority}] `, buildRPr(['<w:b/>'])));
  runs.push(renderTextDocx(heading.title) || runXml('(untitled)'));
  if (heading.tags && heading.tags.length) {
    runs.push(
      runXml(' :' + heading.tags.join(':') + ':', buildRPr(['<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>']))
    );
  }
  const bookmarkId = footnoteCounterDocx + 5000; // any id unique within the document works -- offsetting from the footnote counter is a simple way to guarantee that without a second counter
  const bookmark = id
    ? `<w:bookmarkStart w:id="${bookmarkId}" w:name="${escapeXml(id)}"/><w:bookmarkEnd w:id="${bookmarkId}"/>`
    : '';
  return `<w:p><w:pPr><w:pStyle w:val="Heading${clamped}"/></w:pPr>${bookmark}${runs.join('')}</w:p>`;
}

function renderHeadingDocx(heading, levelOffset, doneKeywords, out) {
  out.push(renderHeadingLineDocx(heading, heading.level - levelOffset, doneKeywords));

  const planningLine = renderPlanningDocx(heading.planning);
  if (planningLine) out.push(planningLine);

  for (const node of heading.body || []) {
    const rendered = renderBodyNodeDocx(node);
    if (rendered) out.push(rendered);
  }

  for (const child of heading.children || []) {
    renderHeadingDocx(child, levelOffset, doneKeywords, out);
  }
}

// ---- static OOXML package parts --------------------------------------------

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
  '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '</Types>\n';

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '</Relationships>\n';

function documentRelsXml(hyperlinks) {
  const hyperlinkRels = hyperlinks
    .map(
      (h) =>
        `<Relationship Id="${h.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(h.target)}" TargetMode="External"/>`
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>' +
    hyperlinkRels +
    '</Relationships>\n'
  );
}

/** One abstract numbering definition per list kind (bullet/ordered),
 *  four ilvl levels deep each -- Word references these by numId from
 *  a paragraph's own w:numPr, not inline per-list the way ODF's own
 *  text:list-style declares alongside the content using it. */
function numberingXml() {
  const bulletChars = ['\u2022', '\u25e6', '\u25aa', '\u25aa'];
  const bulletLevels = bulletChars
    .map(
      (ch, i) =>
        `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${ch}"/>` +
        `<w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
    )
    .join('');
  const orderedFormats = ['decimal', 'lowerLetter', 'lowerRoman', 'decimal'];
  const orderedLevels = orderedFormats
    .map(
      (fmt, i) =>
        `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="%${i + 1}."/>` +
        `<w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:abstractNum w:abstractNumId="0">${bulletLevels}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1">${orderedLevels}</w:abstractNum>` +
    `<w:num w:numId="${BULLET_NUM_ID}"><w:abstractNumId w:val="0"/></w:num>` +
    `<w:num w:numId="${ORDERED_NUM_ID}"><w:abstractNumId w:val="1"/></w:num>` +
    '</w:numbering>\n'
  );
}

function footnotesXml(entries) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
    entries.join('') +
    '</w:footnotes>\n'
  );
}

/** Style definitions every renderXDocx function above references by
 *  name -- Word's own built-in Heading1-6 styles (decreasing font
 *  size, each carrying w:outlineLvl so Word's own navigation pane and
 *  table-of-contents field both recognize them automatically, a real
 *  usability win real org's own ox-odt/ox-html backends don't have an
 *  equivalent of), plus ListParagraph/Quote/Code/Hyperlink/
 *  FootnoteText/FootnoteReference. Deliberately plain rather than
 *  trying to visually match this app's own on-screen theme, the same
 *  reasoning export-odt.js's own stylesXml documents. */
function stylesXml() {
  const headingSizes = { 1: 40, 2: 34, 3: 28, 4: 24, 5: 22, 6: 20 }; // half-points (Word's own w:sz unit)
  const headingStyles = Object.entries(headingSizes)
    .map(
      ([level, size]) =>
        `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>` +
        `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>` +
        `<w:pPr><w:outlineLvl w:val="${level - 1}"/><w:spacing w:before="240" w:after="60"/></w:pPr>` +
        `<w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`
    )
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Standard"><w:name w:val="Standard"/><w:basedOn w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/>' +
    '<w:rPr><w:color w:val="666666"/><w:sz w:val="24"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Creator"><w:name w:val="Creator"/><w:basedOn w:val="Normal"/>' +
    '<w:rPr><w:i/><w:color w:val="999999"/><w:sz w:val="18"/></w:rPr></w:style>' +
    headingStyles +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>' +
    '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/>' +
    '<w:rPr><w:sz w:val="18"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/>' +
    '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>' +
    '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>' +
    '<w:tblPr><w:tblBorders>' +
    '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '</w:tblBorders></w:tblPr></w:style>' +
    '</w:styles>\n'
  );
}

function coreXml(title, author, date) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    (author ? `<dc:creator>${escapeXml(author)}</dc:creator>` : '') +
    (date ? `<dc:date>${escapeXml(date)}</dc:date>` : '') +
    '<cp:lastModifiedBy>org-pwa</cp:lastModifiedBy>' +
    '</cp:coreProperties>\n'
  );
}

function documentXml(bodyXml) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<w:body>' +
    bodyXml +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body>' +
    '</w:document>\n'
  );
}

/**
 * Exports `doc` (or, if `scope` is given, just that heading and its
 * descendants) to a real .docx file, returned as a Uint8Array ready
 * to hand to a download function. Same by-reference `scope`
 * convention as exportToOdt/exportToHtml/exportToMarkdown.
 */
/** Builds one level of the ToC's own entries -- a "ListParagraph"
 *  paragraph per heading, indented per level, linking via a real
 *  <w:hyperlink w:anchor="..."> to the same bookmark
 *  renderHeadingLineDocx already creates for that heading. */
function buildTocListDocx(headings, level, maxDepth, numberingEnabled, numbers, out) {
  if (level > maxDepth) return;
  for (const heading of headings) {
    numbers.length = level;
    numbers[level - 1] = (numbers[level - 1] || 0) + 1;
    const number = numbers.slice(0, level).join('.');
    const id = headingIdMapDocx.get(heading);
    const linkedRuns = renderTextDocx(heading.title) || runXml('(untitled)');
    const numberRun = numberingEnabled ? runXml(`${number}. `) : '';
    const inner = numberRun + linkedRuns;
    const body = id
      ? `<w:hyperlink w:anchor="${escapeXml(id)}">${inner}</w:hyperlink>`
      : inner;
    const indent = (level - 1) * 360; // twentieths of a point, ~0.25in per level
    out.push(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="${indent}"/></w:pPr>${body}</w:p>`);
    buildTocListDocx(heading.children || [], level + 1, maxDepth, numberingEnabled, numbers, out);
  }
}

/** Builds the full Table of Contents block, or '' when `toc` is
 *  false, or fewer than two headings are actually visible at `toc`'s
 *  own depth limit -- matches buildTocHtml's own conditions exactly. */
function buildTocDocx(roots, toc, numberingEnabled) {
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
  const out = [`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${runXml('Table of Contents')}</w:p>`];
  buildTocListDocx(roots, 1, maxDepth, numberingEnabled, [], out);
  return out.join('');
}

export function exportToDocx(doc, scope = null) {
  docForLinkResolutionDocx = doc;
  headingIdMapDocx = new Map();
  footnoteCounterDocx = 0;
  footnoteEntriesDocx = [];
  collectedHyperlinksDocx = [];
  relationshipCounterDocx = 0;
  sectionNumbersDocx = [];
  const options = parseExportOptions(doc);
  numberingEnabledDocx = options.num;

  const roots = scope ? [scope] : doc.children || [];
  assignHeadingIdsDocx(roots, new Set());
  const levelOffset = scope ? scope.level - 1 : 0;
  const { doneKeywords } = resolveTodoSequence(doc);
  const out = [];

  const titleSource = scope ? scope.title : (doc.keywords || []).find((k) => k.key.toUpperCase() === 'TITLE');
  const title = scope ? scope.title : titleSource ? titleSource.value : 'Untitled';
  const author = !scope && options.author ? getDocAuthor(doc) : null;
  const date = !scope && options.date ? getDocDate(doc) : null;

  if (!scope && getDocTitle(doc)) {
    out.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${runXml(getDocTitle(doc))}</w:p>`);
    if (author) out.push(`<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr>${runXml(author)}</w:p>`);
    if (date) out.push(`<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr>${runXml(date)}</w:p>`);
  }
  if (!scope) {
    const toc = buildTocDocx(roots, options.toc, options.num);
    if (toc) out.push(toc);
    for (const node of doc.body || []) {
      const rendered = renderBodyNodeDocx(node);
      if (rendered) out.push(rendered);
    }
  }

  for (const heading of roots) {
    renderHeadingDocx(heading, levelOffset, doneKeywords, out);
  }

  if (!scope && options.creator) {
    out.push(`<w:p><w:pPr><w:pStyle w:val="Creator"/></w:pPr>${runXml('Generated by org-pwa')}</w:p>`);
  }

  const zip = createZip([
    { name: '[Content_Types].xml', content: CONTENT_TYPES_XML },
    { name: '_rels/.rels', content: ROOT_RELS_XML },
    { name: 'docProps/core.xml', content: coreXml(title, author, date) },
    { name: 'word/document.xml', content: documentXml(out.join('')) },
    { name: 'word/styles.xml', content: stylesXml() },
    { name: 'word/numbering.xml', content: numberingXml() },
    { name: 'word/footnotes.xml', content: footnotesXml(footnoteEntriesDocx) },
    { name: 'word/_rels/document.xml.rels', content: documentRelsXml(collectedHyperlinksDocx) },
  ]);

  return zip;
}
