/**
 * A lightweight, dependency-free markdown parser — not a general-purpose
 * markdown implementation, just enough to correctly render this project's
 * own README.md for the in-app Docs view (More → Docs). Handles the
 * constructs the README actually uses: headers (with GitHub-style anchor
 * slugs, so the README's own table-of-contents links work), bold, italic,
 * inline code, fenced code blocks, bullet and numbered lists, links,
 * horizontal rules, GFM pipe tables (with left/center/right alignment),
 * and paragraphs.
 *
 * Split into a pure parse step (markdown text -> a plain, JSON-serializable
 * block list) and a separate DOM-rendering step that lives in app.js —
 * this file has no DOM dependency at all, so it's unit-testable the same
 * way the org-mode engine modules are, unlike the rest of the UI layer.
 */

/** GitHub-style anchor slug: lowercase, strip anything that's not a word
 *  character/whitespace/hyphen, collapse whitespace to single hyphens.
 *  Matches what README.md's own [text](#anchor) links assume. */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/ /g, '-');
}

/**
 * Parses inline formatting within a single block of text into an ordered
 * token list: {type: 'text'|'bold'|'italic'|'code'|'link', value, href?}.
 * A single left-to-right scan rather than nested regex replacement, so a
 * bold span containing a link (or any other combination) doesn't get
 * mangled by one pattern's replacement interfering with another's.
 */
function parseInline(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        tokens.push({ type: 'bold', value: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        tokens.push({ type: 'code', value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (text[i] === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          tokens.push({
            type: 'link',
            value: text.slice(i + 1, closeBracket),
            href: text.slice(closeBracket + 2, closeParen),
          });
          i = closeParen + 1;
          continue;
        }
      }
    }
    if (text[i] === '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1);
      if (end !== -1 && end !== i + 1) {
        tokens.push({ type: 'italic', value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Plain text: accumulate until the next character that could start a
    // special token, so runs of ordinary text become one token, not one
    // per character.
    let j = i;
    while (j < text.length && !'*`['.includes(text[j])) j++;
    if (j === i) j = i + 1; // avoid an infinite loop on an unmatched special character
    tokens.push({ type: 'text', value: text.slice(i, j) });
    i = j;
  }
  return tokens;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^(\s*)```/;
const HR_RE = /^-{3,}\s*$/;
const BULLET_RE = /^(\s*)[-*]\s+(.*)$/;
const NUMBERED_RE = /^(\s*)\d+\.\s+(.*)$/;
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/;

/** Splits a GFM table row line into trimmed cell strings, dropping the
 *  empty leading/trailing fragments the outer pipes produce. Doesn't
 *  handle an escaped `\|` inside a cell -- not a construct this
 *  README's own tables happen to need, and adding it "just in case"
 *  would be speculative generality for a parser whose whole point is
 *  covering exactly what's actually used, no more. */
function splitTableRow(line) {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((cell) => cell.trim());
}

/** Parses a GFM alignment separator row (`|---|:---|---:|`) into
 *  'left' | 'center' | 'right' per column, based on which side(s) of
 *  each cell's dashes carry a colon -- standard GFM convention. A cell
 *  with no colon on either side defaults to 'left' (browsers' own
 *  default text alignment), same as GFM itself. */
function parseTableAlignment(separatorLine) {
  return splitTableRow(separatorLine).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

/**
 * Parses `markdown` into a flat block list: headings (level, text, id,
 * inline), paragraphs (text, inline), lists (ordered, items[{indent,
 * text, inline}]), code-blocks (text, raw — not inline-parsed, since code
 * shouldn't have ** or [ ] treated as formatting), tables (header, align,
 * rows — each cell inline-parsed, same as a paragraph's text), and
 * horizontal rules. Heading ids are de-duplicated (a second "Overview"
 * becomes "overview-1"), matching how GitHub's own renderer handles
 * repeated heading text.
 */
function parseMarkdown(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  const usedSlugs = new Set();
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const indent = fenceMatch[1];
      const codeLines = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        // Strip exactly the opening fence's own indentation, if present
        // -- a shorter/blank line is left as-is rather than over-
        // stripped or throwing, since a blank line within the block is
        // valid and simply has nothing to strip.
        const codeLine = lines[i].startsWith(indent) ? lines[i].slice(indent.length) : lines[i];
        codeLines.push(codeLine);
        i++;
      }
      i++; // skip the closing fence
      blocks.push({ type: 'code-block', text: codeLines.join('\n') });
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const baseSlug = slugify(text);
      let id = baseSlug;
      let n = 1;
      while (usedSlugs.has(id)) {
        id = `${baseSlug}-${n}`;
        n++;
      }
      usedSlugs.add(id);
      blocks.push({ type: 'heading', level, text, id, inline: parseInline(text) });
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // GFM pipe table: a row line immediately followed by a valid
    // alignment-separator line. Checked before the bullet/numbered-list
    // branches below, since a separator row like `|---|---|` could
    // otherwise never be reached (it doesn't match BULLET_RE/
    // NUMBERED_RE itself, but checking table-ness only by looking one
    // line ahead means the ORDER of these checks doesn't actually
    // matter for correctness here -- this is placed first simply to
    // keep the table's header and separator lines visually paired in
    // the code, matching how they're paired in the source markdown).
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1])) {
      const header = splitTableRow(line).map((cell) => ({ text: cell, inline: parseInline(cell) }));
      const align = parseTableAlignment(lines[i + 1]);
      i += 2;
      const rows = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        rows.push(splitTableRow(lines[i]).map((cell) => ({ text: cell, inline: parseInline(cell) })));
        i++;
      }
      blocks.push({ type: 'table', header, align, rows });
      continue;
    }

    if (BULLET_RE.test(line)) {
      const items = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        const m = BULLET_RE.exec(lines[i]);
        items.push({ indent: m[1].length, text: m[2], inline: parseInline(m[2]) });
        i++;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    if (NUMBERED_RE.test(line)) {
      const items = [];
      while (i < lines.length && NUMBERED_RE.test(lines[i])) {
        const m = NUMBERED_RE.exec(lines[i]);
        items.push({ indent: m[1].length, text: m[2], inline: parseInline(m[2]) });
        i++;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // Paragraph: consecutive lines until a blank line or the start of
    // some other block type.
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !HEADING_RE.test(lines[i]) &&
      !FENCE_RE.test(lines[i]) &&
      !HR_RE.test(lines[i]) &&
      !BULLET_RE.test(lines[i]) &&
      !NUMBERED_RE.test(lines[i]) &&
      !(TABLE_ROW_RE.test(lines[i]) && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1]))
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    const text = paraLines.join(' ');
    blocks.push({ type: 'paragraph', text, inline: parseInline(text) });
  }

  return blocks;
}

export { parseMarkdown, parseInline, slugify, splitTableRow, parseTableAlignment };
