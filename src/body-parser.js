
import { parseInline, stripLineBreakMarker } from './inline-markup.js';

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

const BLOCK_START_RE = /^\s*#\+begin_(\w+)(?:\s+(.*))?$/i;
const BLOCK_END_RE = /^\s*#\+end_(\w+)\s*$/i;
const TABLE_LINE_RE = /^\s*\|.*\|?\s*$/;
const TABLE_RULE_RE = /^\s*\|[-+]*\|?\s*$/;
const TBLFM_RE = /^\s*#\+TBLFM:\s*(.*)$/i;
const LIST_ITEM_RE = /^(\s*)([-+]|\*|\d+[.)]|[A-Za-z][.)])\s+(?:\[([ xX-])\]\s+)?(.*)$/;
// Real org: "a line consisting of only dashes, and at least 5 of them,
// is exported as a horizontal line." Whitespace around the dashes is
// tolerated (indentation, trailing spaces), matching how org itself is
// lenient about surrounding whitespace on this line.
const HR_LINE_RE = /^\s*-{5,}\s*$/;

function leadingWhitespace(line) {
  const m = /^(\s*)/.exec(line);
  return m[1];
}

function isListItemLine(line) {
  return LIST_ITEM_RE.test(line);
}

function indentOf(line) {
  return leadingWhitespace(line).length;
}

// ---- blocks -------------------------------------------------------------

function parseBlock(lines, i) {
  const startMatch = BLOCK_START_RE.exec(lines[i]);
  const name = startMatch[1].toUpperCase();
  const params = startMatch[2] ? startMatch[2].trim() : '';
  const content = [];
  i++;
  while (i < lines.length) {
    const endMatch = BLOCK_END_RE.exec(lines[i]);
    if (endMatch && endMatch[1].toUpperCase() === name) {
      i++;
      break;
    }
    content.push(lines[i]);
    i++;
  }
  return [{ type: 'block', name, params, lines: content }, i];
}

// ---- tables ---------------------------------------------------------------

function parseTableRow(line) {
  if (TABLE_RULE_RE.test(line)) {
    return { type: 'rule' };
  }
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = trimmed.split('|').map((c) => c.trim());
  return { type: 'row', cells, cellsInline: cells.map(parseInline) };
}

function parseTable(lines, i) {
  const startIndex = i;
  const rows = [];
  while (i < lines.length && TABLE_LINE_RE.test(lines[i]) && lines[i].trim() !== '') {
    rows.push(parseTableRow(lines[i]));
    i++;
  }
  let tblfm = null;
  if (i < lines.length) {
    const m = TBLFM_RE.exec(lines[i]);
    if (m) {
      tblfm = m[1];
      i++;
    }
  }
  return [{ type: 'table', rows, tblfm, lineIndex: startIndex, lineCount: i - startIndex }, i];
}

// ---- lists ------------------------------------------------------------

function isOrderedMarker(marker) {
  return /^\d+[.)]$/.test(marker) || /^[A-Za-z][.)]$/.test(marker);
}

/** Whether position `pos` in `text` falls inside an active ~...~ or
 *  =...= span -- an odd count of the corresponding delimiter having
 *  appeared before this point means we're "inside" one of those spans
 *  right now. A lightweight approximation (not a full reimplementation
 *  of the inline parser's own border rules), but sufficient for this
 *  specific purpose: deciding whether a "::" match is real tag-separator
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

function parseListItemLine(line) {
  const m = LIST_ITEM_RE.exec(line);
  const [, indent, marker, checkbox, rest] = m;
  let text = rest;

  let startValue = null;
  const startValueMatch = /^\[@(\d+)\]\s*/.exec(text);
  if (startValueMatch) {
    startValue = Number(startValueMatch[1]);
    text = text.slice(startValueMatch[0].length);
  }

  let tag = null;
  const TAG_SEP_RE = /\s+::\s+/g;
  let tagMatch;
  while ((tagMatch = TAG_SEP_RE.exec(text))) {
    if (isInsideLiteralSpan(text, tagMatch.index)) continue; // e.g. a "~term :: description~" example within the item's own text, not a real tag separator
    tag = text.slice(0, tagMatch.index);
    text = text.slice(tagMatch.index + tagMatch[0].length);
    break;
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
    children: [],
  };
}

/**
 * Parses a run of list items at a given indent level, recursing into
 * more-indented runs as nested lists attached to the preceding item.
 * Each item's `lineIndex` records its position in the `lines` array it
 * was parsed from (a heading's `bodyLines`), so callers can write edits
 * (e.g. a checkbox toggle) back to the actual serialization source rather
 * than only mutating the derived `body` tree. Returns [listNode, nextIndex].
 */
function parseList(lines, i, baseIndent) {
  const items = [];

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && isListItemLine(lines[j]) && indentOf(lines[j]) >= baseIndent) {
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
    item.lineIndex = i;
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
    if (lookahead < lines.length && isListItemLine(lines[lookahead]) && indentOf(lines[lookahead]) > indent) {
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

function parseParagraph(lines, i) {
  const startIndex = i;
  const paraLines = [];
  while (
    i < lines.length &&
    lines[i].trim() !== '' &&
    !BLOCK_START_RE.test(lines[i]) &&
    !TABLE_LINE_RE.test(lines[i]) &&
    !isListItemLine(lines[i]) &&
    !HR_LINE_RE.test(lines[i])
  ) {
    paraLines.push(lines[i]);
    i++;
  }

  const footnoteMatch = paraLines.length > 0 ? FOOTNOTE_DEF_LINE_RE.exec(paraLines[0]) : null;
  const footnoteLabel = footnoteMatch ? footnoteMatch[1] : null;
  const inlineLines = footnoteMatch
    ? [parseInline(stripLineBreakMarker(footnoteMatch[2])), ...paraLines.slice(1).map((l) => parseInline(stripLineBreakMarker(l)))]
    : paraLines.map((l) => parseInline(stripLineBreakMarker(l)));

  return [
    {
      type: 'paragraph',
      lines: paraLines,
      inlineLines,
      footnoteLabel,
      lineIndex: startIndex,
      lineCount: i - startIndex,
    },
    i,
  ];
}

// ---- main -----------------------------------------------------------------

function parseBody(lines) {
  const nodes = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }
    if (BLOCK_START_RE.test(line)) {
      const [node, next] = parseBlock(lines, i);
      nodes.push(node);
      i = next;
      continue;
    }
    if (TABLE_LINE_RE.test(line)) {
      const [node, next] = parseTable(lines, i);
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
    const [node, next] = parseParagraph(lines, i);
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
