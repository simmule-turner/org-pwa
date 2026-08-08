/**
 * ASCII export -- real org-mode's ox-ascii backend, for the core,
 * commonly-used cases.
 *
 * org-ascii-text-width: the maximum line width (in characters) for
 * wrapping paragraph text during export. Real org's own default is 72;
 * matched here exactly. See src/local-variables.js's own
 * getAsciiTextWidth for where this is actually read from (Global/Local
 * Variables, same precedence every other such setting already has).
 *
 * Inline markup is parsed (via the same parseInline every other
 * exporter here already uses), not left as raw source text -- matching
 * a real, confirmed detail of org's own ox-ascii backend: bold,
 * italic, underline, and strikethrough markers are stripped entirely
 * (ASCII has no way to represent any of them visually, and org's own
 * export framework already separates markup from content before a
 * backend's own transcoder ever sees it -- there's nothing for an
 * ASCII backend to re-add). Code/verbatim become real org's own
 * `text' backtick-quote convention (org-ascii-verbatim-format,
 * confirmed directly from ox-ascii.el's own source) rather than
 * keeping the literal ~/= markers, which read as stray, meaningless
 * punctuation once nothing renders them as a visual distinction. A
 * link becomes `desc (target)` (or just `target` with no
 * description), since the raw bracket syntax reads far less like
 * natural prose than everything else here does.
 *
 * Section numbering and a generated Table of Contents are both real
 * ox-ascii features, matched here: headings are numbered "1", "1.1",
 * "2", ... by default (real org's own default too -- #+OPTIONS: num:nil
 * turns numbering off, mirrored here as an opt-out), and a TOC listing
 * every heading with its own number, dot-leader indentation matching
 * depth, is generated at the very top when the document has more than
 * one heading (a single-heading document has nothing worth a table of
 * contents for).
 */

import { parseInline } from './inline-markup.js';
import { parseWidthCookieRow } from './table-cookies.js';

const LINK_RE = /\[\[([^\]]+)\](?:\[([^\]]+)\])?\]/g;

/** Strips org's own link bracket syntax down to readable plain text --
 *  used for content NOT run through parseInline (kept exported for
 *  backwards compatibility / direct testing). */
function stripLinksForAscii(text) {
  return text.replace(LINK_RE, (_, target, description) => (description ? `${description} (${target})` : target));
}

/** Wraps `text` to `width` characters, breaking only at whitespace --
 *  a single word longer than `width` is kept whole on its own line
 *  rather than split mid-word, the standard text-wrapping convention.
 *  Existing internal whitespace runs collapse to single spaces (this
 *  is meant for a paragraph's already-joined prose, not for content
 *  that depends on preserving original spacing). Returns an array of
 *  wrapped lines; an empty/whitespace-only input returns an empty
 *  array, not a single blank-line entry. */
function wrapText(text, width) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ---- inline markup ---------------------------------------------------

let footnoteDefinitionsAscii = [];
let anonymousFootnoteCounterAscii = 0;

function footnoteLabelAscii(label) {
  if (label !== null) return label;
  anonymousFootnoteCounterAscii++;
  return 'fn' + anonymousFootnoteCounterAscii;
}

function renderInlineListAscii(nodes) {
  return nodes.map(renderInlineNodeAscii).join('');
}

function renderInlineNodeAscii(node) {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'bold':
    case 'italic':
    case 'underline':
    case 'strikethrough':
      // Real org's own ox-ascii: these markers are simply not
      // re-added -- ASCII has no way to represent any of them
      // visually, and the parser has already separated the markup
      // from its own content by this point.
      return renderInlineListAscii(node.children);
    case 'code':
    case 'verbatim':
      // Real org's own org-ascii-verbatim-format ("`%s'") -- confirmed
      // directly from ox-ascii.el's source -- not the literal ~/=
      // source markers, which read as meaningless stray punctuation
      // once nothing renders them as a visual distinction.
      return '`' + node.value + "'";
    case 'subscript':
    case 'superscript':
      // Same reasoning as bold/italic/underline: no ASCII-plain way
      // to represent either, so the marker is dropped and the plain
      // text stands on its own.
      return node.value;
    case 'link': {
      const label = node.description ? renderTextAscii(node.description) : node.target;
      return label === node.target ? node.target : `${label} (${node.target})`;
    }
    case 'image':
      return `[image: ${node.target}]`;
    case 'footnote-ref':
    case 'footnote-def': {
      const children = node.type === 'footnote-def' ? node.children : [];
      const label = footnoteLabelAscii(node.label);
      if (node.type === 'footnote-def' || children.length > 0) {
        footnoteDefinitionsAscii.push({ label, text: renderInlineListAscii(children) });
      }
      return `[${label}]`;
    }
    case 'comment':
      return ''; // matches every other export backend -- comments never appear in exported output
    default:
      return '';
  }
}

function renderTextAscii(text) {
  return renderInlineListAscii(parseInline(text));
}

// ---- headings and body content -----------------------------------------

/** Section numbers, one entry per level (1-indexed by array position)
 *  -- e.g. [2, 3] means "currently on the 2nd level-1 heading, its 3rd
 *  child so far". Reset at the start of every exportToAscii() call.
 *  Real org's own default numbering behavior -- headings are numbered
 *  "1", "1.1", "2", ... unless explicitly turned off. */
let sectionNumbersAscii = [];
let numberingEnabledAscii = true;

function nextSectionNumber(level) {
  sectionNumbersAscii = sectionNumbersAscii.slice(0, level);
  sectionNumbersAscii[level - 1] = (sectionNumbersAscii[level - 1] || 0) + 1;
  return sectionNumbersAscii.slice(0, level).join('.');
}

function renderHeadingLineAscii(heading, level) {
  const parts = [];
  if (numberingEnabledAscii) parts.push(nextSectionNumber(level) + '.');
  if (heading.todo) parts.push(heading.todo);
  if (heading.priority) parts.push(`[#${heading.priority}]`);
  parts.push(renderTextAscii(heading.title) || '(untitled)');
  if (heading.tags && heading.tags.length) parts.push(`:${heading.tags.join(':')}:`);
  const indent = '  '.repeat(Math.max(0, level - 1));
  const line = indent + parts.join(' ');
  if (level === 1) {
    // Real org-ascii's own default "underline" heading style, at least
    // for the top level -- a row of "=" matching the title's own
    // width makes a level-1 heading genuinely stand out in a format
    // with no other way to indicate emphasis of structure itself.
    return [line, '='.repeat(line.length)];
  }
  return [line];
}

function renderPlanningAscii(planning, indent) {
  const parts = [];
  if (planning && planning.scheduled) parts.push(`Scheduled: ${planning.scheduled}`);
  if (planning && planning.deadline) parts.push(`Deadline: ${planning.deadline}`);
  if (parts.length === 0) return [];
  return [indent + parts.join('  ')];
}

function renderParagraphAscii(node, indent, width) {
  const joined = renderTextAscii(node.lines.join(' '));
  const available = Math.max(10, width - indent.length); // a pathologically narrow width still leaves SOME room, rather than producing zero-or-negative-width wrapping
  return wrapText(joined, available).map((line) => indent + line);
}

function renderListAscii(list, indent, width) {
  const out = [];
  let counter = 0;
  for (const item of list.items) {
    let marker;
    if (item.checkbox !== null) {
      marker = item.checkbox === 'X' ? '[x] ' : item.checkbox === '-' ? '[-] ' : '[ ] ';
    } else if (item.ordered) {
      counter = item.startValue != null ? item.startValue : counter + 1;
      marker = `${counter}. `;
    } else {
      marker = '- ';
    }
    const prefix = indent + marker;
    let text = renderTextAscii(item.text || '');
    if (item.tag) text = `${renderTextAscii(item.tag)}: ${text}`;
    const available = Math.max(10, width - prefix.length);
    const wrapped = wrapText(text, available);
    if (wrapped.length === 0) {
      out.push(prefix.trimEnd());
    } else {
      out.push(prefix + wrapped[0]);
      const continuationIndent = ' '.repeat(prefix.length);
      for (const line of wrapped.slice(1)) out.push(continuationIndent + line);
    }
    for (const nested of item.children || []) {
      out.push(...renderListAscii(nested, indent + '  ', width));
    }
  }
  return out;
}

/** Whether a cell's content looks like a number -- real org's own
 *  heuristic for per-column alignment (see the Org manual's own
 *  "Column Width and Alignment": alignment is auto-detected from the
 *  fraction of number-like versus non-number fields in the column).
 *  Matches an optional sign, digits, and an optional decimal part --
 *  deliberately simple rather than a full numeric-literal grammar,
 *  since this only has to be good enough to bias a column's own
 *  alignment one way or the other, not validate the value itself. */
function looksNumeric(text) {
  return /^[+-]?\d+(\.\d+)?$/.test(text.trim());
}

/** Pads `text` to `width` characters, left- or right-aligned --
 *  matching real org's own org-ascii--justify-string. A value already
 *  at or beyond `width` (a cell content computed the width FROM in
 *  the first place, so this is normally exact, never truncated) is
 *  returned unchanged rather than clipped. */
function justify(text, width, alignRight) {
  const padding = ' '.repeat(Math.max(0, width - text.length));
  return alignRight ? padding + text : text + padding;
}

/** Like wrapText, but ALSO breaks at hyphens when a single unbroken
 *  "word" (no whitespace at all) is itself wider than `width` --
 *  common in this app's own content: long, hyphenated identifiers
 *  like org-mode variable names easily exceed a narrow, explicitly-
 *  set table column width on their own. The hyphen itself stays at
 *  the end of the broken segment ("org-agenda-skip-archived-" /
 *  "trees"), matching how hyphenated words are conventionally broken
 *  in running text. Regular paragraph/list wrapping (wrapText itself)
 *  doesn't need this -- it's specific to the tighter, fixed-width
 *  constraint an explicit table column width actually creates. */
function wrapTableCellAscii(text, width) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const pieces = [];
  for (const word of words) {
    if (word.length <= width) {
      pieces.push(word);
      continue;
    }
    let remaining = word;
    while (remaining.length > width) {
      // Break at the last hyphen that still fits within width, if
      // there is one -- keeps the hyphen itself on the earlier
      // segment, matching conventional hyphenated-word line breaks.
      const breakAt = remaining.lastIndexOf('-', width - 1);
      if (breakAt > 0) {
        pieces.push(remaining.slice(0, breakAt + 1));
        remaining = remaining.slice(breakAt + 1);
      } else {
        // No hyphen to break at within reach -- fall back to a hard
        // break at the width boundary rather than overflowing it.
        pieces.push(remaining.slice(0, width));
        remaining = remaining.slice(width);
      }
    }
    pieces.push(remaining);
  }
  if (pieces.length === 0) return [];

  const lines = [];
  let current = '';
  for (const piece of pieces) {
    const candidate = current ? `${current} ${piece}` : piece;
    if (candidate.length <= width || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = piece;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function renderTableAscii(table, indent) {
  // Real org's own table editor keeps every column a single, fixed
  // width (the widest cell in it) and auto-aligns each column left or
  // right depending on whether it's mostly numeric -- confirmed
  // directly from the Org manual's own "Column Width and Alignment"
  // section and ox-ascii.el's own org-ascii--justify-string. Ragged,
  // unaligned columns (this app's own earlier behavior, just joining
  // raw cell text with " | ") is NOT what real org actually produces,
  // even though it happens to be valid, parseable pipe-table syntax
  // on its own -- looking like unformatted Markdown rather than a
  // properly typeset org table was the actual bug.
  //
  // An explicit column-width cookie row (see parseWidthCookieRow),
  // when present, overrides the auto-computed width for those
  // columns -- real org's own way of forcing a table to a specific
  // total width. Content that doesn't fit an explicit width word-
  // wraps across multiple output lines within the same logical row,
  // rather than being left to overflow unbounded.
  let explicitWidths = null;
  const contentRows = [];
  for (const row of table.rows) {
    if (row.type === 'row') {
      const cookie = parseWidthCookieRow(row);
      if (cookie) {
        explicitWidths = cookie;
        continue; // a directive, not a data row -- excluded from the rendered output entirely
      }
    }
    contentRows.push(row);
  }

  const dataRows = contentRows.filter((r) => r.type === 'row');
  if (dataRows.length === 0) return [];

  const renderedRows = dataRows.map((row) => row.cells.map((cell) => renderTextAscii(cell)));
  const columnCount = Math.max(...renderedRows.map((cells) => cells.length));

  const columnWidths = [];
  const columnAlignRight = [];
  for (let col = 0; col < columnCount; col++) {
    const columnCells = renderedRows.map((cells) => cells[col] || '');
    const explicit = explicitWidths && explicitWidths[col];
    columnWidths.push(explicit || Math.max(1, ...columnCells.map((c) => c.length)));
    const numericCount = columnCells.filter((c) => c && looksNumeric(c)).length;
    const nonEmptyCount = columnCells.filter((c) => c).length;
    columnAlignRight.push(nonEmptyCount > 0 && numericCount / nonEmptyCount > 0.5);
  }

  const ruleLine = indent + '|' + columnWidths.map((w) => '-'.repeat(w + 2)).join('+') + '|';

  const out = [];
  let dataRowIndex = -1;
  for (const row of contentRows) {
    if (row.type === 'rule') {
      out.push(ruleLine);
      continue;
    }
    dataRowIndex++;
    const cells = renderedRows[dataRowIndex];
    // Word-wrap each cell to its own column's width -- a cell that
    // fits on one line produces a single-entry array, same as before;
    // one that doesn't gets split across as many lines as it needs.
    const wrappedCells = columnWidths.map((width, col) => {
      const wrapped = wrapTableCellAscii(cells[col] || '', width);
      return wrapped.length ? wrapped : [''];
    });
    const lineCount = Math.max(...wrappedCells.map((lines) => lines.length));
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
      const rendered = columnWidths
        .map((width, col) => justify(wrappedCells[col][lineIndex] || '', width, columnAlignRight[col]))
        .join(' | ');
      out.push(`${indent}| ${rendered} |`);
    }
  }
  return out;
}

function renderBlockAscii(block, indent) {
  const out = [`${indent}[${block.name}]`];
  for (const line of block.lines) out.push(indent + line);
  return out;
}

function renderBodyNodeAscii(node, indent, width) {
  if (node.type === 'paragraph') return renderParagraphAscii(node, indent, width);
  if (node.type === 'list') return renderListAscii(node, indent, width);
  if (node.type === 'table') return renderTableAscii(node, indent);
  if (node.type === 'block') return renderBlockAscii(node, indent);
  if (node.type === 'hr') return [indent + '-'.repeat(Math.max(1, width - indent.length))];
  return [];
}

function renderHeadingAscii(heading, levelOffset, width, out) {
  const level = heading.level - levelOffset;
  out.push(...renderHeadingLineAscii(heading, level));
  const bodyIndent = '  '.repeat(Math.max(0, level));
  out.push(...renderPlanningAscii(heading.planning, bodyIndent));
  for (const node of heading.body || []) {
    const rendered = renderBodyNodeAscii(node, bodyIndent, width);
    if (rendered.length) out.push('', ...rendered);
  }
  for (const child of heading.children || []) {
    out.push('');
    renderHeadingAscii(child, levelOffset, width, out);
  }
}

// ---- table of contents ---------------------------------------------------

/** Every heading in document order, alongside the section-number
 *  string it will actually get (computed the same way
 *  renderHeadingLineAscii's own nextSectionNumber does, but run
 *  ahead of time, before the real render pass, specifically so the
 *  TOC -- which has to appear BEFORE the headings themselves in the
 *  output -- can reference numbers that end up matching exactly). */
function collectHeadingsForToc(headings, level, numbers, out) {
  for (const heading of headings) {
    numbers.length = level;
    numbers[level - 1] = (numbers[level - 1] || 0) + 1;
    out.push({ heading, level, number: numbers.slice(0, level).join('.') });
    collectHeadingsForToc(heading.children || [], level + 1, numbers, out);
  }
}

/** Real org's own org-ascii--build-toc: a "Table of Contents" header
 *  (underlined, matching the same style a level-1 heading gets),
 *  followed by one line per heading -- dot-leader indentation
 *  matching depth (real org's own "make-string (1- indent) '.'"
 *  convention, here approximated as literal repeated dots), each
 *  prefixed with its own section number when numbering is on. */
function renderToc(headings, numberingEnabled) {
  if (!numberingEnabled) return []; // TOC generation is gated on numbering here -- keeping this as one combined toggle rather than two independent ones, matching the simplicity goal for this app's own subset of ox-ascii's fuller feature set
  const entries = [];
  collectHeadingsForToc(headings, 1, [], entries);
  if (entries.length < 2) return []; // a single heading has nothing worth a table of contents for

  const title = 'Table of Contents';
  const out = [title, '='.repeat(title.length), ''];
  for (const { heading, level, number } of entries) {
    const dots = level > 1 ? '.'.repeat((level - 1) * 3 - 1) + ' ' : '';
    const numberPart = numberingEnabled ? number + '. ' : '';
    out.push(dots + numberPart + (renderTextAscii(heading.title) || '(untitled)'));
  }
  return out;
}

/**
 * Exports `doc` (or, if `scope` is given, just that heading and its
 * descendants) to a plain ASCII text string, wrapped to `textWidth`
 * characters (org-ascii-text-width; real org's own default is 72).
 * `scope` must be a heading node that's actually part of `doc` --
 * passed by reference, the same convention every other
 * heading-targeting function in this codebase already uses.
 *
 * `numbered` (default true, matching real org's own default): whether
 * headings get section numbers and a Table of Contents is generated
 * at all -- real org's own #+OPTIONS: num:nil turns this off.
 */
export function exportToAscii(doc, scope = null, textWidth = 72, numbered = true) {
  footnoteDefinitionsAscii = [];
  anonymousFootnoteCounterAscii = 0;
  sectionNumbersAscii = [];
  numberingEnabledAscii = numbered;

  const roots = scope ? [scope] : doc.children || [];
  const levelOffset = scope ? scope.level - 1 : 0;
  const out = [];

  const tocLines = renderToc(roots, numbered);
  if (tocLines.length) out.push(...tocLines, '');

  for (const heading of roots) {
    if (out.length) out.push('');
    renderHeadingAscii(heading, levelOffset, textWidth, out);
  }

  if (footnoteDefinitionsAscii.length > 0) {
    const seenLabels = new Set();
    out.push('', 'Footnotes', '='.repeat('Footnotes'.length), '');
    for (const { label, text } of footnoteDefinitionsAscii) {
      if (seenLabels.has(label)) continue; // the same real label can legitimately be referenced more than once, but only needs one definition line
      seenLabels.add(label);
      out.push(`[${label}] ${text}`);
    }
  }

  const joined = out.join('\n');
  return joined.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export { wrapText, stripLinksForAscii };
