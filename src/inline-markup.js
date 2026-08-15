
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
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|bmp|heic|heif)$/i;

// LaTeX math fragment delimiters -- confirmed directly against the Org
// Manual (see src/math-render.js for the full rendering architecture
// and its own citations). Real org also allows $...$ / \[...\] /
// $$...$$ / environments to span up to two line breaks -- since this
// module parses one line at a time (paragraphs render line-by-line,
// see renderParagraphRow in app.js), fragment detection here is scoped
// to a fragment that fits entirely on a single line; a fragment
// genuinely spanning multiple lines is a known, deliberate limitation
// of this pass, not silently broken -- see math-render.js's own docs
// for the full account.
const DISPLAY_DOLLAR_RE = /^\$\$([\s\S]+?)\$\$/;
const INLINE_PAREN_RE = /^\\\(([\s\S]*?)\\\)/;
const DISPLAY_BRACKET_RE = /^\\\[([\s\S]*?)\\\]/;
const BEGIN_ENV_RE = /^\\begin\{([A-Za-z*]+)\}([\s\S]+?)\\end\{\1\}/;
const DOLLAR_INLINE_RE = /^\$([^ \t\n,;.$][^$\n\r]*?(?:\n[^$\n\r]*?){0,2}[^ \t\n,.$])\$/;
const DOLLAR_VALID_FOLLOW_RE = /[\s.,;:!?([{)\]}'"]/;

/** Matches a real org LaTeX math fragment at `text[pos]` -- tries the
 *  display forms first ($$...$$, \[...\], \begin{env}...\end{env})
 *  before the single-$ inline form, since a naive single-$ scan would
 *  otherwise incorrectly consume half of a $$...$$ pair. Returns
 *  { content, displayMode, length } or null.
 *
 *  $...$'s own restrictions are confirmed directly against real org's
 *  own actual source -- org-latex-regexps in org.el -- not just the
 *  Org Manual's own prose description of them:
 *    - the opening '$' must be preceded by any character that isn't
 *      '$' itself, or the start of the line (org's own source:
 *      "\([^$]\|^\)" -- notably NOT restricted to "no digit before
 *      it," an earlier, reasoned-but-incorrect guess this app made
 *      before the actual source was available)
 *    - content's first character excludes space/tab/newline/comma/
 *      semicolon/period
 *    - content's last character (immediately before the closing '$')
 *      excludes space/tab/newline/comma/period specifically --
 *      semicolon is allowed there, an asymmetry confirmed directly in
 *      the source, not a simplification of it
 *    - the closing '$' must be followed by whitespace, an opening or
 *      closing bracket/paren/brace, a quote character, an apostrophe,
 *      common punctuation, or end of line -- real org's own source
 *      expresses this via Emacs syntax-class checks (\s. \s- \s( \s)
 *      \s"), which this app can't replicate exactly without Emacs's
 *      own syntax table, but produces the same observable result for;
 *      a literal dash is excluded not because org's regex explicitly
 *      excludes it, but because Emacs's own standard syntax table
 *      classifies '-' as "symbol" syntax, which falls outside every
 *      class the regex actually checks -- this app excludes it
 *      explicitly instead, to get the same observable behavior
 *      without needing Emacs's own syntax table to fall back on */
function matchLatexFragmentAt(text, pos) {
  const remaining = text.slice(pos);

  if (remaining.startsWith('\\begin{')) {
    const beforeOnLine = text.slice(0, pos);
    const linePrefix = beforeOnLine.slice(beforeOnLine.lastIndexOf('\n') + 1);
    if (/^\s*$/.test(linePrefix)) {
      const m = BEGIN_ENV_RE.exec(remaining);
      if (m) return { content: m[0], displayMode: true, length: m[0].length };
    }
  }

  const dd = DISPLAY_DOLLAR_RE.exec(remaining);
  if (dd) return { content: dd[1], displayMode: true, length: dd[0].length };

  const ip = INLINE_PAREN_RE.exec(remaining);
  if (ip) return { content: ip[1], displayMode: false, length: ip[0].length };

  const db = DISPLAY_BRACKET_RE.exec(remaining);
  if (db) return { content: db[1], displayMode: true, length: db[0].length };

  if (text[pos] === '$' && text[pos + 1] !== '$' && (pos === 0 || text[pos - 1] !== '$')) {
    const m = DOLLAR_INLINE_RE.exec(remaining);
    if (m) {
      const after = text[pos + m[0].length];
      if (after !== '-' && (after === undefined || DOLLAR_VALID_FOLLOW_RE.test(after))) {
        return { content: m[1], displayMode: false, length: m[0].length };
      }
    }
  }

  return null;
}

// Sentinel delimiters for a LaTeX-fragment placeholder -- Unicode
// Private Use Area characters, specifically because real org text a
// person would actually type can never contain them at all, so
// there's no ambiguity between a genuine placeholder and coincidental
// user text. See extractLatexFragments/LATEX_PLACEHOLDER_RE below.
const LATEX_PLACEHOLDER_START = '\uE000';
const LATEX_PLACEHOLDER_END = '\uE001';
const LATEX_PLACEHOLDER_RE = /^\uE000(\d+)\uE001/;

function makeLatexPlaceholder(index) {
  return LATEX_PLACEHOLDER_START + index + LATEX_PLACEHOLDER_END;
}

/** Paragraph-level pre-pass: extracts every LaTeX fragment from the
 *  FULL, joined, multi-line text of a paragraph's own lines -- before
 *  the existing per-line rendering pipeline (renderParagraphRow,
 *  parseInline) ever sees any of it. This is what actually makes a
 *  multi-line fragment work: matchLatexFragmentAt's own regexes
 *  already allow \(...\) / \[...\] / $$...$$ / \begin{}...\end{} to
 *  span an unlimited number of lines (and $...$ up to two line
 *  breaks -- see matchLatexFragmentAt's own docs for why that one
 *  delimiter is different), but paragraph text is otherwise rendered
 *  one line at a time -- an existing, load-bearing part of this
 *  app's own rendering architecture (the forced-line-break-vs-
 *  flowing-paragraph distinction depends on knowing where each
 *  original line ended), not something built for math specifically.
 *  Detection has to happen before that per-line split, or a fragment
 *  spanning more than one line is never actually given more than one
 *  line to match against.
 *
 *  Each found fragment, however many lines it spans, collapses to a
 *  single-line placeholder token at the point it started -- which
 *  naturally shortens the returned line array when a fragment
 *  consumed more than one of the original lines, since those extra
 *  lines' own content is now folded into the fragment's own single
 *  placeholder line instead of remaining separate lines in their own
 *  right. A forced-line-break marker (a trailing "\\") is checked
 *  against these POST-extraction line boundaries, not the original
 *  ones -- a real simplification for the rare case of a marker
 *  sitting exactly at a fragment's own edge (e.g. immediately after
 *  "\begin{equation}"), which isn't realistic org usage in the first
 *  place, in exchange for not needing to track a full original-to-
 *  collapsed line correspondence for every other, ordinary case.
 *
 *  Returns { lines, fragments }: `lines` is a new array (the
 *  placeholder-substituted text, re-split on '\n'); `fragments` is
 *  the ordered list of { source, displayMode } that parseInline's own
 *  placeholder recognition looks up by index when rendering each
 *  line (pass it through via opts.latexFragments). */
function extractLatexFragments(lines) {
  const fullText = lines.join('\n');
  const fragments = [];
  let result = '';
  let pos = 0;
  while (pos < fullText.length) {
    const ch = fullText[pos];
    if (ch === '$' || ch === '\\') {
      const m = matchLatexFragmentAt(fullText, pos);
      if (m) {
        fragments.push({ source: m.content, displayMode: m.displayMode });
        result += makeLatexPlaceholder(fragments.length - 1);
        pos += m.length;
        continue;
      }
    }
    result += ch;
    pos += 1;
  }
  return { lines: result.split('\n'), fragments };
}

// Footnotes: [fn:label] is a bare reference to a definition given
// elsewhere (either inline, via [fn:label:...] somewhere else in the
// document, or as its own definition line/paragraph -- see
// body-parser.js's own FOOTNOTE_DEF_LINE_RE). [fn:label:definition] is
// an inline definition (also referenceable again elsewhere via plain
// [fn:label]); [fn::definition] (empty label) is real org's own
// anonymous-footnote form -- never referenced again, renumbered
// positionally on export. A manual bracket-depth scan (not a simple
// regex) finds the definition's closing ']', since footnote text
// commonly contains its own [[link]] -- a naive non-greedy match would
// stop at the first ']' it finds, which could easily belong to a
// nested link instead of actually closing the footnote.
const FOOTNOTE_START_RE = /^\[fn:([A-Za-z0-9_-]*)/;

function matchFootnoteAt(text, pos) {
  const m = FOOTNOTE_START_RE.exec(text.slice(pos));
  if (!m) return null;
  const label = m[1] || null;
  let i = pos + m[0].length;

  if (text[i] === ']') {
    if (!label) return null; // "[fn:]" alone (empty label, no colon) isn't valid org syntax either way
    return { type: 'footnote-ref', label, length: i - pos + 1 };
  }

  if (text[i] === ':') {
    i++;
    const contentStart = i;
    let depth = 0;
    while (i < text.length) {
      if (text[i] === '[') {
        depth++;
      } else if (text[i] === ']') {
        if (depth === 0) {
          return { type: 'footnote-def', label, content: text.slice(contentStart, i), length: i - pos + 1 };
        }
        depth--;
      }
      i++;
    }
    return null; // unterminated -- no matching ']' found, left as literal text
  }

  return null;
}

// Real org auto-links a BARE URI (no [[...]] brackets at all) for "a
// well-defined set of schemes" (confirmed directly against org's own
// manual/compact guide) -- not any arbitrary "word:word" text, which
// would misfire on things like a time ("10:30") or a citation-style
// abbreviation. These are the schemes this app actually resolves (see
// link-resolve.js) -- http/https/ftp/mailto for ordinary external
// links, doi for academic citations (resolved to doi.org), and
// file/github/webdav for the file-linking schemes this app supports.
const AUTOLINK_SCHEMES = ['https', 'http', 'ftp', 'mailto', 'doi', 'file', 'github', 'webdav'];
const BARE_URL_RE = new RegExp('^(?:' + AUTOLINK_SCHEMES.join('|') + '):[^\\s<>]+', 'i');
// Trailing sentence punctuation almost never belongs to the URL itself
// ("see https://example.com/page." -- the period ends the sentence,
// not the link) -- stripped one character at a time from the end of a
// bare-URL match, the same heuristic common URL auto-linkers use
// (e.g. Rust's own rustdoc bare-URL lint). A URL that genuinely ends
// in one of these characters is the rare case traded off here, same
// as elsewhere in this parser (see matchScriptAt's own documented
// tradeoffs) -- wrapping it in [[...]] or <...> sidesteps this
// entirely if it ever matters.
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]}'"]+$/;
// <https://example.com> -- real org's other recognized plain-URI form,
// explicitly called out in org's own manual as equivalent to the bare
// form above, just with angle brackets marking the boundary instead of
// relying on trailing-punctuation heuristics.
const ANGLE_URL_RE = /^<((?:https?|ftp|mailto|doi|file|github|webdav):[^\s<>]+)>/i;

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

    const angleMatch = ANGLE_URL_RE.exec(remaining);
    if (angleMatch && angleMatch.index === 0) {
      flush();
      const target = angleMatch[1];
      if (IMAGE_EXT_RE.test(target)) {
        nodes.push({ type: 'image', target });
      } else {
        nodes.push({ type: 'link', target, description: null });
      }
      pos += angleMatch[0].length;
      continue;
    }

    const bareMatch = BARE_URL_RE.exec(remaining);
    if (bareMatch && bareMatch.index === 0) {
      flush();
      const target = bareMatch[0].replace(TRAILING_PUNCTUATION_RE, '');
      if (IMAGE_EXT_RE.test(target)) {
        nodes.push({ type: 'image', target });
      } else {
        nodes.push({ type: 'link', target, description: null });
      }
      pos += target.length;
      continue;
    }

    const commentMatch = COMMENT_RE.exec(remaining);
    if (commentMatch && commentMatch.index === 0) {
      flush();
      nodes.push({ type: 'comment', value: commentMatch[1] });
      pos += commentMatch[0].length;
      continue;
    }

    if (text[pos] === '[' && text[pos + 1] === 'f' && text[pos + 2] === 'n' && text[pos + 3] === ':') {
      const fn = matchFootnoteAt(text, pos);
      if (fn) {
        flush();
        if (fn.type === 'footnote-ref') {
          nodes.push({ type: 'footnote-ref', label: fn.label });
        } else {
          nodes.push({ type: 'footnote-def', label: fn.label, children: parseInline(fn.content, opts) });
        }
        pos += fn.length;
        continue;
      }
    }

    if (text[pos] === LATEX_PLACEHOLDER_START) {
      const ph = LATEX_PLACEHOLDER_RE.exec(text.slice(pos));
      const frag = ph && opts.latexFragments && opts.latexFragments[Number(ph[1])];
      if (frag) {
        flush();
        nodes.push({ type: 'latex', source: frag.source, displayMode: frag.displayMode });
        pos += ph[0].length;
        continue;
      }
    }

    if (text[pos] === '$' || text[pos] === '\\') {
      const latex = matchLatexFragmentAt(text, pos);
      if (latex) {
        flush();
        nodes.push({ type: 'latex', source: latex.content, displayMode: latex.displayMode });
        pos += latex.length;
        continue;
      }
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

/** Real org's own hard-line-break marker: a paragraph line ending in
 *  two literal backslashes, optionally followed by trailing
 *  whitespace. This app already shows every source line as its own
 *  visual line regardless of this marker (paragraphs never reflow
 *  adjacent lines together the way real org's own default does) --
 *  so its only practical effect here is display cleanup: without
 *  stripping it before parsing, the two backslash characters would
 *  show up as literal, visible text at the end of the line. Kept
 *  separate from parseInline itself since this is specifically a
 *  paragraph-line concept, not something that should also apply to a
 *  heading title, list item, or table cell. */
const LINE_BREAK_MARKER_RE = /\\\\\s*$/;

function stripLineBreakMarker(line) {
  return line.replace(LINE_BREAK_MARKER_RE, '');
}

export {
  parseInline,
  stripLineBreakMarker,
  IMAGE_EXT_RE,
  matchLatexFragmentAt,
  extractLatexFragments,
};
