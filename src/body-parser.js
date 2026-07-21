
import { parseInline } from './inline-markup.js';

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
 * Known limitation: list continuation across blank lines uses a simple
 * lookahead heuristic (a blank line is swallowed only if the next non-blank
 * line is itself a list item at or above the current indent). Real org
 * mode's rules around loose lists / paragraph continuation inside list
 * items are richer than this; this is a v1 approximation.
 */

const BLOCK_START_RE = /^\s*#\+begin_(\w+)(?:\s+(.*))?$/i;
const BLOCK_END_RE = /^\s*#\+end_(\w+)\s*$/i;
const TABLE_LINE_RE = /^\s*\|.*\|?\s*$/;
const TABLE_RULE_RE = /^\s*\|[-+]*\|?\s*$/;
const TBLFM_RE = /^\s*#\+TBLFM:\s*(.*)$/i;
const LIST_ITEM_RE = /^(\s*)([-+]|\*|\d+[.)]|[A-Za-z][.)])\s+(?:\[([ xX-])\]\s+)?(.*)$/;

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
  return [{ type: 'table', rows, tblfm }, i];
}

// ---- lists ------------------------------------------------------------

function isOrderedMarker(marker) {
  return /^\d+[.)]$/.test(marker) || /^[A-Za-z][.)]$/.test(marker);
}

function parseListItemLine(line) {
  const m = LIST_ITEM_RE.exec(line);
  const [, , marker, checkbox, rest] = m;
  let text = rest;
  let tag = null;
  const tagSplit = text.split(/\s+::\s+/);
  if (tagSplit.length >= 2) {
    tag = tagSplit[0];
    text = tagSplit.slice(1).join(' :: ');
  }
  return {
    type: 'list-item',
    marker,
    ordered: isOrderedMarker(marker),
    checkbox: checkbox || null,
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

    if (i < lines.length && isListItemLine(lines[i]) && indentOf(lines[i]) > indent) {
      const [nested, nextI] = parseList(lines, i, indentOf(lines[i]));
      item.children.push(nested);
      i = nextI;
    }

    items.push(item);
  }

  return [{ type: 'list', items }, i];
}

// ---- paragraphs ---------------------------------------------------------

function parseParagraph(lines, i) {
  const paraLines = [];
  while (
    i < lines.length &&
    lines[i].trim() !== '' &&
    !BLOCK_START_RE.test(lines[i]) &&
    !TABLE_LINE_RE.test(lines[i]) &&
    !isListItemLine(lines[i])
  ) {
    paraLines.push(lines[i]);
    i++;
  }
  return [{ type: 'paragraph', lines: paraLines, inlineLines: paraLines.map(parseInline) }, i];
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
