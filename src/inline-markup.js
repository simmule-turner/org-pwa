
/**
 * Inline markup parser. Turns a single line of text into a sequence of
 * inline nodes: text runs, emphasis spans (bold/italic/underline/
 * strikethrough), code/verbatim spans (literal, not recursively parsed —
 * they must be the innermost markers per the org-mode spec), links,
 * bare-image links, and inline comments.
 *
 * This is additive, same pattern as body-parser.js: callers keep the raw
 * string around (paragraph.lines, list-item.text, table cell strings) for
 * serialization, and this module derives a parallel structure for
 * rendering. Nothing here can cause a round-trip regression because
 * nothing here is consulted by the serializer.
 *
 * Emphasis border rule (simplified from org's actual regexp-components):
 * an opening marker must be preceded by start-of-string/whitespace/one of
 * `-({'"`, and not immediately followed by whitespace. A closing marker
 * must not be immediately preceded by whitespace, and must be followed by
 * end-of-string/whitespace/closing punctuation. This covers the common
 * cases from the org-mode primer; it does not implement every edge case of
 * org's real border-character tables.
 */

const EMPHASIS_KIND = {
  '*': 'bold',
  '/': 'italic',
  _: 'underline',
  '+': 'strikethrough',
  '~': 'code',
  '=': 'verbatim',
};
const LITERAL_KINDS = new Set(['code', 'verbatim']);

const LINK_RE = /^\[\[([^\]]+?)\](?:\[([^\]]+?)\])?\]/;
const COMMENT_RE = /^@@comment:(.*?)@@/;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;

const OPEN_PRE_RE = /[\s\-({'"]/;
const CLOSE_POST_RE = /[\s.,;:!?)\]}'"-]/;

function isEmphasisMarker(ch) {
  return Object.prototype.hasOwnProperty.call(EMPHASIS_KIND, ch);
}

/**
 * Attempts to match a complete emphasis span (open marker ... close marker)
 * starting exactly at `pos`. Returns { marker, content, length } or null.
 */
function matchEmphasisAt(text, pos) {
  const marker = text[pos];
  if (!isEmphasisMarker(marker)) return null;

  const prev = pos > 0 ? text[pos - 1] : null;
  if (prev !== null && !OPEN_PRE_RE.test(prev)) return null;

  const afterOpen = text[pos + 1];
  if (!afterOpen || /\s/.test(afterOpen)) return null;

  for (let j = pos + 2; j < text.length; j++) {
    if (text[j] !== marker) continue;
    const beforeClose = text[j - 1];
    if (/\s/.test(beforeClose)) continue;
    const afterClose = j + 1 < text.length ? text[j + 1] : null;
    if (afterClose !== null && !CLOSE_POST_RE.test(afterClose)) continue;
    return { marker, content: text.slice(pos + 1, j), length: j - pos + 1 };
  }
  return null;
}

/**
 * Parses a single line/string into an array of inline nodes. Recurses into
 * emphasis span content (so nesting like underline-around-italic-around-bold
 * works), but never
 * recurses into code/verbatim content, which is kept as a literal string.
 */
function parseInline(text) {
  const nodes = [];
  let buffer = '';
  let pos = 0;

  const flush = () => {
    if (buffer) {
      nodes.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };

  while (pos < text.length) {
    const remaining = text.slice(pos);

    const linkMatch = LINK_RE.exec(remaining);
    if (linkMatch && linkMatch.index === 0) {
      flush();
      const target = linkMatch[1];
      const description = linkMatch[2] !== undefined ? linkMatch[2] : null;
      if (description === null && IMAGE_EXT_RE.test(target)) {
        nodes.push({ type: 'image', target });
      } else {
        nodes.push({ type: 'link', target, description });
      }
      pos += linkMatch[0].length;
      continue;
    }

    const commentMatch = COMMENT_RE.exec(remaining);
    if (commentMatch && commentMatch.index === 0) {
      flush();
      nodes.push({ type: 'comment', value: commentMatch[1] });
      pos += commentMatch[0].length;
      continue;
    }

    if (isEmphasisMarker(text[pos])) {
      const m = matchEmphasisAt(text, pos);
      if (m) {
        flush();
        const kind = EMPHASIS_KIND[m.marker];
        if (LITERAL_KINDS.has(kind)) {
          nodes.push({ type: kind, value: m.content });
        } else {
          nodes.push({ type: kind, children: parseInline(m.content) });
        }
        pos += m.length;
        continue;
      }
    }

    buffer += text[pos];
    pos++;
  }

  flush();
  return nodes;
}

export {
  parseInline,
};
