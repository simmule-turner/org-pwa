
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

// Bare (unbraced) sub/superscript content: an optional leading sign,
// then one or more alphanumerics -- covers both a_b (one character) and
// a_bc (several, still valid without braces per the org spec: braces
// improve readability, they aren't required for a multi-character
// script). Deliberately narrower than org's own full regexp-components
// table (which also allows a handful of extra punctuation inside a bare
// script); this covers the common case, not every edge case.
const BARE_SCRIPT_RE = /^[+-]?[A-Za-z0-9]+/;

/**
 * Attempts to match a `_{...}`/`^{...}` or bare `_word`/`^word`
 * sub/superscript starting exactly at `pos`. `mode` matches
 * org-use-sub-superscripts: 'nil' disables this entirely (never
 * matches), '{}' only matches the braced form (a bare `a_b` is left as
 * literal text), and 't' (the default) matches both forms. Requires a
 * non-whitespace character immediately before `pos` -- `_`/`^` at the
 * very start of a line, or after whitespace, is always literal, in
 * every mode, matching how `a_b` needs the `a` immediately before it.
 * Returns { kind, content, length } or null.
 */
function matchScriptAt(text, pos, mode) {
  if (mode === 'nil') return null;
  const marker = text[pos];
  if (marker !== '_' && marker !== '^') return null;
  if (pos === 0 || /\s/.test(text[pos - 1])) return null;

  const kind = marker === '_' ? 'subscript' : 'superscript';

  if (text[pos + 1] === '{') {
    const close = text.indexOf('}', pos + 2);
    if (close === -1) return null;
    return { kind, content: text.slice(pos + 2, close), length: close - pos + 1 };
  }

  if (mode === '{}') return null; // braces required in this mode; a bare a_b is left as literal underscore + text

  const bareMatch = BARE_SCRIPT_RE.exec(text.slice(pos + 1));
  if (!bareMatch) return null;
  return { kind, content: bareMatch[0], length: 1 + bareMatch[0].length };
}

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
 * works), but never recurses into code/verbatim/subscript/superscript
 * content, which is kept as a literal string.
 *
 * `opts.subSuperscriptMode` matches org-use-sub-superscripts: `'t'`
 * (default, real org's own default) interprets both `_word`/`^word` and
 * `_{word}`/`^{word}`; `'{}'` only interprets the braced form, leaving a
 * bare `a_b` as literal text; `'nil'` disables sub/superscript
 * interpretation entirely, so `_`/`^` are always literal characters.
 *
 * `_` doubles as both the underline marker and the subscript marker --
 * real org's own overload, disambiguated the same way here: underline
 * requires the character before it to be whitespace/start-of-line/
 * certain punctuation (matchEmphasisAt's own border rule), while
 * subscript requires the opposite, a non-whitespace character
 * immediately before it. These two conditions are mutually exclusive
 * for the overwhelming majority of real text; emphasis is checked
 * first below as the tiebreak for the rare remaining overlap (a
 * hyphen/paren/quote sitting immediately before the underscore, which
 * satisfies both rules at once).
 */
function parseInline(text, opts = {}) {
  const subSuperscriptMode = opts.subSuperscriptMode || 't';
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
          nodes.push({ type: kind, children: parseInline(m.content, opts) });
        }
        pos += m.length;
        continue;
      }
    }

    if (text[pos] === '_' || text[pos] === '^') {
      const s = matchScriptAt(text, pos, subSuperscriptMode);
      if (s) {
        flush();
        nodes.push({ type: s.kind, value: s.content });
        pos += s.length;
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
