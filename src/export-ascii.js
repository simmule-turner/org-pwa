/**
 * ASCII export -- real org-mode's ox-ascii backend, for the core,
 * commonly-used cases. Deliberately doesn't attempt org-ascii's fuller
 * feature set (section numbering, a table of contents, footnote
 * reference styles, Latin-1/UTF-8-specific character substitutions) --
 * a plain, readable text rendering of the outline, wrapped to a
 * configurable width, matching this app's own "useful subset"
 * philosophy elsewhere.
 *
 * org-ascii-text-width: the maximum line width (in characters) for
 * wrapping paragraph text during export. Real org's own default is 72;
 * matched here exactly. See src/local-variables.js's own
 * getAsciiTextWidth for where this is actually read from (Global/Local
 * Variables, same precedence every other such setting already has).
 *
 * Inline markup is left as-is rather than converted -- org's own
 * ~*bold*~, ~code~, etc. syntax is already valid, readable plain ASCII
 * text exactly as written in the source, so there's nothing productive
 * to transform it into. The one exception is links: `[[target][desc]]`
 * becomes `desc (target)` (or just `target` with no description),
 * since the raw bracket syntax reads far less like natural prose than
 * everything else here already does.
 */

const LINK_RE = /\[\[([^\]]+)\](?:\[([^\]]+)\])?\]/g;

/** Strips org's own link bracket syntax down to readable plain text --
 *  the one piece of inline syntax that doesn't already read naturally
 *  as prose the way emphasis markers do. */
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

function renderHeadingLineAscii(heading, level) {
  const parts = [];
  if (heading.todo) parts.push(heading.todo);
  if (heading.priority) parts.push(`[#${heading.priority}]`);
  parts.push(heading.title || '(untitled)');
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
  const joined = stripLinksForAscii(node.lines.join(' '));
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
    let text = item.text || '';
    if (item.tag) text = `${item.tag}: ${text}`;
    const available = Math.max(10, width - prefix.length);
    const wrapped = wrapText(stripLinksForAscii(text), available);
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

function renderTableAscii(table, indent) {
  // Org's own pipe-table syntax is already a plain-text table -- shown
  // as-is (indented to match surrounding content) rather than
  // recomputed into a different ASCII-art grid style.
  const out = [];
  let columnCount = 1;
  for (const row of table.rows) {
    if (row.type === 'rule') {
      out.push(indent + '|' + Array(columnCount).fill('---').join('+') + '|');
      continue;
    }
    columnCount = row.cells.length;
    out.push(indent + '| ' + row.cells.join(' | ') + ' |');
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

/**
 * Exports `doc` (or, if `scope` is given, just that heading and its
 * descendants) to a plain ASCII text string, wrapped to `textWidth`
 * characters (org-ascii-text-width; real org's own default is 72).
 * `scope` must be a heading node that's actually part of `doc` --
 * passed by reference, the same convention every other
 * heading-targeting function in this codebase already uses.
 */
export function exportToAscii(doc, scope = null, textWidth = 72) {
  const roots = scope ? [scope] : doc.children || [];
  const levelOffset = scope ? scope.level - 1 : 0;
  const out = [];
  for (const heading of roots) {
    if (out.length) out.push('');
    renderHeadingAscii(heading, levelOffset, textWidth, out);
  }
  const joined = out.join('\n');
  return joined.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export { wrapText };
