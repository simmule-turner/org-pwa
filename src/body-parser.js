// @ts-check

import { parseInline, parseInlineLines, stripLineBreakMarker, extractLatexFragments, matchLatexFragmentAt } from './inline-markup.js';

/**
 * Body-content parser: text lines -> content nodes (list, table, block,
 * paragraph). This is deliberately additive to org-parser.js rather than a
 * replacement for it: headings keep their raw `bodyLines` as the source of
 * truth for serialization (round-trip safety is non-negotiable), and this
 * module derives a parallel `body: Node[]` for rendering/editing.
 *
 * Inline markup (bold/italic/links/etc.) inside paragraph text, list-item
 * text, and table cells is parsed via inline-markup.js and attached as an
 * additive field (`inline` / `cellsInline`) alongside the raw string, which
 * stays around for serialization.
 *
 * Tables and paragraphs track `lineIndex`/`lineCount` (their span within
 * the `lines` array they were parsed from), the same way list items track
 * `lineIndex` — this is what lets body-edit.js commit an edit by splicing
 * the owning heading's `bodyLines` and reparsing, rather than only
 * mutating the derived tree (which the serializer never reads). List
 * items additionally track `indent` (their original leading whitespace),
 * needed to reconstruct a correctly-indented line when editing text.
 *
 * Known limitation: list continuation across blank lines uses a simple
 * lookahead heuristic (a blank line is swallowed only if the next non-blank
 * line is itself a list item at or above the current indent). Real org
 * mode's rules around loose lists / paragraph continuation inside list
 * items are richer than this; this is a v1 approximation.
 *
 * The org [@N] "start value" cookie (e.g. "20. [@20] item") is parsed out
 * of an ordered item's text into a separate `startValue` field rather than
 * left embedded in `text` — so the UI can use it to reset the displayed
 * numbering without also showing the literal cookie as part of the item's
 * visible content.
 */

const BLOCK_START_RE = /^\s*#\+begin_(\S+)(?:\s+(.*))?$/i; // Org: any run of non-blanks names the block
/** The line that closes the block `name` (compared without regard to case, and literally: the name may hold `*`).
 * @param {string} name */
const blockEndRe = (name) => new RegExp('^\\s*#\\+end_' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
/** Does the block that opens at line `i` close? Org reads an unclosed `#+begin_` line as text.
 * @param {string[]} lines @param {number} i */
function blockCloses(lines, i) {
  const m = BLOCK_START_RE.exec(lines[i]);
  if (!m) return false;
  const end = blockEndRe(m[1]);
  for (let k = i + 1; k < lines.length; k++) if (end.test(lines[k])) return true;
  return false;
}
const TABLE_LINE_RE = /^\s*\|.*\|?\s*$/;
const TABLE_RULE_RE = /^\s*\|-/; // as in Org, any row that starts with |- is a horizontal rule (|---|---| too)
// a table.el table: a rule `+---+---+`, then lines that begin with `|` or `+`, the last a rule (two lines at least)
const TABLE_EL_RULE_RE = /^[ \t]*\+(?:-+\+)+[ \t]*$/;
const TABLE_EL_LINE_RE = /^[ \t]*[+|]/;
/** The index after the table.el table that starts at line `i`, or -1 when none does.
 * @param {string[]} lines @param {number} i */
function tableElEnd(lines, i) {
  if (!TABLE_EL_RULE_RE.test(lines[i])) return -1;
  let j = i + 1;
  while (j < lines.length && TABLE_EL_LINE_RE.test(lines[j])) j++;
  return j - i >= 2 && TABLE_EL_RULE_RE.test(lines[j - 1]) ? j : -1;
}
const TBLFM_RE = /^\s*#\+TBLFM: (.*)$/i; // Org wants the space after the colon
const AFFILIATED_RE = /^\s*#\+(\w+)(?:\[[^\]]*\])?:\s*(.*)$/;
/** The #+NAME: of the table at line `at`: Org lets other affiliated keywords (#+CAPTION:, #+ATTR_*:, #+PLOT:) stand between.
 * @param {string[]} lines @param {number} at @returns {string | undefined} */
function nameBefore(lines, at) {
  for (let k = at - 1; k >= 0; k--) {
    const m = AFFILIATED_RE.exec(lines[k]);
    if (!m || !/^(NAME|CAPTION|HEADER|PLOT|RESULTS|ATTR_\w+)$/i.test(m[1])) return undefined;
    if (m[1].toUpperCase() === 'NAME') return m[2].trim();
  }
  return undefined;
}
const PLOT_RE = /^\s*#\+PLOT:\s*(.*)$/i;
// Org reads `a.` and `A)` as bullets only when org-list-allow-alphabetical is set. A lower-case `[x]` stays a checkbox here, as it is for
// Org's own commands (C-c C-c toggles it)
const LIST_ITEM_RE = /^(\s*)([-+]|\*|\d+[.)])(?:\s+|(?<!\*)$)(?:\[@(\d+|[A-Za-z])\][ \t]*)?(?:\[([ xX-])\](?:\s+|$))?(.*)$/;
// Real org: "a line consisting of only dashes, and at least 5 of them,
// is exported as a horizontal line." Whitespace around the dashes is
// tolerated (indentation, trailing spaces), matching how org itself is
// lenient about surrounding whitespace on this line.
const HR_LINE_RE = /^\s*-{5,}\s*$/;

/** @param {string} line */
function leadingWhitespace(line) {
  const m = /** @type {RegExpExecArray} */ (/^(\s*)/.exec(line));
  return m[1];
}

/** @param {string} line */
function isListItemLine(line) {
  return LIST_ITEM_RE.test(line);
}

/** @param {string} line */
function indentOf(line) {
  return leadingWhitespace(line).length;
}

// ---- blocks -------------------------------------------------------------

/**
 * @param {string[]} lines
 * @param {any} [i]
 */
function parseBlock(lines, i) {
  const startMatch = /** @type {RegExpExecArray} */ (BLOCK_START_RE.exec(lines[i]));
  const name = startMatch[1].toUpperCase();
  const params = startMatch[2] ? startMatch[2].trim() : '';
  const content = [];
  const startIndex = i;
  const endRe = blockEndRe(startMatch[1]);
  i++;
  while (i < lines.length) {
    if (endRe.test(lines[i])) {
      i++;
      break;
    }
    content.push(lines[i]);
    i++;
  }
  return [{ type: 'block', name, params, lines: content, lineIndex: startIndex, lineCount: i - startIndex }, i];
}

// ---- tables ---------------------------------------------------------------

/** @param {string} line */
function parseTableRow(line) {
  if (TABLE_RULE_RE.test(line)) {
    return { type: 'rule' };
  }
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = trimmed.split('|').map((c) => c.trim());
  return { type: 'row', cells, cellsInline: cells.map((c) => parseInline(c)) };
}

/**
 * @param {string[]} lines
 * @param {any} [i]
 */
function parseTable(lines, i) {
  const startIndex = i;
  const rows = [];
  while (i < lines.length && TABLE_LINE_RE.test(lines[i]) && lines[i].trim() !== '') {
    rows.push(parseTableRow(lines[i]));
    i++;
  }
  /** @type {string | null} */
  let tblfm = null;
  // Emacs finds the formulas after any blank lines below the table (org-table-get-stored-formulas)
  let at = i;
  while (at < lines.length && lines[at].trim() === '') at++;
  if (at < lines.length) {
    const m = TBLFM_RE.exec(lines[at]);
    if (m) {
      tblfm = m[1];
      i = at + 1;
    }
  }
  const gap = tblfm === null ? 0 : i - 1 - startIndex - rows.length;
  const table = /** @type {import('./types.js').Table} */ (/** @type {unknown} */ ({ type: 'table', rows, tblfm, lineIndex: startIndex, lineCount: i - startIndex }));
  if (gap > 0) table.blankBeforeTblfm = gap;
  return [table, i];
}

// ---- lists ------------------------------------------------------------

/** @param {any} [marker] */
function isOrderedMarker(marker) {
  return /^\d+[.)]$/.test(marker);
}

/** Whether position `pos` in `text` falls inside an active ~...~ or
 *  =...= span -- an odd count of the corresponding delimiter having
 *  appeared before this point means we're "inside" one of those spans
 *  right now. A lightweight approximation (not a full reimplementation
 *  of the inline parser's own border rules), but sufficient for this
 *  specific purpose: deciding whether a "::" match is real tag-separator
 * @param {string} text
 * @param {any} [pos]
 *  syntax or just literal text living inside a code/verbatim span. */
function isInsideLiteralSpan(text, pos) {
  for (const delim of ['~', '=']) {
    let count = 0;
    for (let i = 0; i < pos; i++) {
      if (text[i] === delim) count++;
    }
    if (count % 2 === 1) return true;
  }
  return false;
}

/** @param {string} line */
function parseListItemLine(line) {
  const m = /** @type {RegExpExecArray} */ (LIST_ITEM_RE.exec(line));
  const [, indent, marker, counter, checkbox, rest] = m;
  let text = rest;

  /** @type {number | null} */
  let startValue = null;
  if (counter) startValue = /^\d+$/.test(counter) ? Number(counter) : counter.toLowerCase().charCodeAt(0) - 96; // [@c] is 3

  /** @type {string | null} */
  let tag = null;
  // as Org reads it: only an unordered item has a tag, which runs to the last ` ::` that ends the text or is followed by a blank
  const TAG_SEP_RE = /[ \t]+::(?=[ \t]|$)[ \t]*/g;
  let tagMatch;
  let found = null;
  while (/^[-+*]$/.test(marker) && (tagMatch = TAG_SEP_RE.exec(text))) {
    if (isInsideLiteralSpan(text, tagMatch.index)) continue; // e.g. a "~term :: description~" example within the item's own text, not a real tag separator
    found = tagMatch;
  }
  if (found) {
    tag = text.slice(0, found.index);
    text = text.slice(found.index + found[0].length);
  }
  return {
    type: 'list-item',
    indent,
    marker,
    ordered: isOrderedMarker(marker),
    checkbox: checkbox || null,
    startValue,
    tag,
    text,
    inline: parseInline(text),
    children: /** @type {any[]} */ ([]),
  };
}

/**
 * Parses a run of list items at a given indent level, recursing into
 * more-indented runs as nested lists attached to the preceding item.
 * Each item's `lineIndex` records its position in the `lines` array it
 * was parsed from (a heading's `bodyLines`), so callers can write edits
 * (e.g. a checkbox toggle) back to the actual serialization source rather
 * than only mutating the derived `body` tree. Returns [listNode, nextIndex].
 * @param {string[]} lines
 * @param {any} [i]
 * @param {any} [baseIndent]
 */
function parseList(lines, i, baseIndent) {
  const items = [];

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j - i < 2 && j < lines.length && isListItemLine(lines[j]) && indentOf(lines[j]) >= baseIndent) { // two blank lines end a list
        i = j;
        continue;
      }
      break;
    }

    if (!isListItemLine(line)) break;
    const indent = indentOf(line);
    if (indent < baseIndent) break;
    if (indent > baseIndent) break; // handled via recursion below, not here

    const item = parseListItemLine(line);
    /** @type {any} */ (item).lineIndex = i;
    i++;

    // Look ahead for a more-indented nested sub-list, skipping over any
    // blank line(s) first -- org's own convention commonly separates a
    // list item from its nested sub-list with a blank line for
    // readability (this is not an edge case; it's how many real org
    // files, including this app's own README, are actually written),
    // and without this the sub-list was silently parsed as a separate,
    // un-nested sibling list instead -- same marker or not. i is only
    // advanced past the blank line(s) when a nested sub-list is
    // actually found there; otherwise i is left exactly as it was, so
    // the main loop's own blank-line handling for same-level
    // continuation (above) is completely unaffected.
    let lookahead = i;
    while (lookahead < lines.length && lines[lookahead].trim() === '') lookahead++;
    if (lookahead - i < 2 && lookahead < lines.length && isListItemLine(lines[lookahead]) && indentOf(lines[lookahead]) > indent) {
      const [nested, nextI] = parseList(lines, lookahead, indentOf(lines[lookahead]));
      item.children.push(nested);
      i = nextI;
    }

    items.push(item);
  }

  return [{ type: 'list', items }, i];
}

// ---- paragraphs ---------------------------------------------------------

const FOOTNOTE_DEF_LINE_RE = /^\[fn:([A-Za-z0-9_-]+)\]\s?(.*)$/;

/** Computes the set of 0-based line indices that fall INSIDE a
 *  multi-line LaTeX fragment ($$...$$ / \(...\) / \[...\] /
 *  \begin{}...\end{}) spanning more than one of `lines` -- used by
 *  parseParagraph below to avoid incorrectly treating a blank line,
 *  or a line that happens to look like a block/table/list/hr marker,
 *  as a structural boundary when it's actually just part of the
 *  fragment's own interior content. $...$ is deliberately excluded --
 *  its own real restriction caps it at 2 embedded newlines, which
 *  never reaches across an actual blank-line paragraph boundary the
 * @param {string[]} lines
 *  way the other, genuinely unlimited-multi-line forms can. */
function findLatexProtectedLineIndices(lines) {
  const fullText = lines.join('\n');
  const protectedIndices = new Set();
  let pos = 0;
  while (pos < fullText.length) {
    const ch = fullText[pos];
    if (ch === '\\' || ch === '$') {
      const m = matchLatexFragmentAt(fullText, pos);
      if (m && m.content.includes('\n')) {
        const startLine = fullText.slice(0, pos).split('\n').length - 1;
        const endLine = fullText.slice(0, pos + m.length).split('\n').length - 1;
        for (let li = startLine; li <= endLine; li++) protectedIndices.add(li);
        pos += m.length;
        continue;
      }
    }
    pos += 1;
  }
  return protectedIndices;
}

/**
 * @param {string[]} lines
 * @param {any} [i]
 */
function parseParagraph(lines, i, protectedIndices = new Set()) {
  const startIndex = i;
  const paraLines = [];
  while (
    i < lines.length &&
    (i === startIndex || // the first line is the paragraph's, whatever it looks like
      protectedIndices.has(i) ||
      (lines[i].trim() !== '' &&
        !(BLOCK_START_RE.test(lines[i]) && blockCloses(lines, i)) &&
        !TABLE_LINE_RE.test(lines[i]) &&
        !TABLE_EL_RULE_RE.test(lines[i]) &&
        !isListItemLine(lines[i]) &&
        !HR_LINE_RE.test(lines[i])))
  ) {
    paraLines.push(lines[i]);
    i++;
  }

  const footnoteMatch = paraLines.length > 0 ? FOOTNOTE_DEF_LINE_RE.exec(paraLines[0]) : null;
  const footnoteLabel = footnoteMatch ? footnoteMatch[1] : null;
  const strippedLines = footnoteMatch ? [footnoteMatch[2], ...paraLines.slice(1)] : paraLines;
  const { lines: extractedLines, fragments } = extractLatexFragments(strippedLines);
  const inlineLines = parseInlineLines(extractedLines.map(stripLineBreakMarker), { latexFragments: fragments }); // the paragraph is read as a whole, so a span may cross a line

  return [
    {
      type: 'paragraph',
      lines: paraLines,
      extractedLines,
      inlineLines,
      footnoteLabel,
      lineIndex: startIndex,
      lineCount: i - startIndex,
    },
    i,
  ];
}

// ---- main -----------------------------------------------------------------

/** @param {string[]} lines */
function parseBody(lines) {
  const nodes = [];
  let i = 0;
  const protectedIndices = findLatexProtectedLineIndices(lines);

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }
    if (BLOCK_START_RE.test(line) && blockCloses(lines, i)) {
      const [node, next] = parseBlock(lines, i);
      nodes.push(node);
      i = next;
      continue;
    }
    if (PLOT_RE.test(line)) {
      let j = i;
      const plotLines = [];
      while (j < lines.length && PLOT_RE.test(lines[j])) {
        plotLines.push((PLOT_RE.exec(lines[j]) || [])[1]);
        j++;
      }
      if (j < lines.length && TABLE_LINE_RE.test(lines[j])) {
        const [tableNode, next] = parseTable(lines, j);
        tableNode.plot = plotLines.join(' ');
        const plotName = nameBefore(lines, i);
        if (plotName) tableNode.name = plotName;
        nodes.push(tableNode);
        i = next;
        continue;
      }
      // Not actually followed by a table -- fall through to ordinary
      // paragraph parsing below, same as any other "#+" line this app
      // doesn't specifically recognize.
    }
    const tableEl = tableElEnd(lines, i);
    if (tableEl > 0) { // a table.el table is shown as it is written: one paragraph of its lines
      const [node] = parseParagraph(lines.slice(i, tableEl), 0, new Set(Array.from({ length: tableEl - i }, (_, k) => k)));
      node.lineIndex = i;
      nodes.push(node);
      i = tableEl;
      continue;
    }
    if (TABLE_LINE_RE.test(line)) {
      const [node, next] = parseTable(lines, i);
      const tableName = nameBefore(lines, i);
      if (tableName) node.name = tableName;
      nodes.push(node);
      i = next;
      continue;
    }
    if (HR_LINE_RE.test(line)) {
      nodes.push({ type: 'hr' });
      i++;
      continue;
    }
    if (isListItemLine(line)) {
      const [node, next] = parseList(lines, i, indentOf(line));
      nodes.push(node);
      i = next;
      continue;
    }
    const [node, next] = parseParagraph(lines, i, protectedIndices);
    nodes.push(node);
    i = next;
  }

  return nodes;
}

export {
  parseBody,
  parseList,
  parseTable,
  parseBlock,
  parseParagraph,
};
