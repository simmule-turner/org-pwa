// @ts-check

import { parseCitationAt } from './cite.js';
import { unescapeLink } from './link-string.js';
import { EMACS_SPACE_RE, EMACS_ALNUM_RE, DOLLAR_FOLLOW_RE } from './emacs-chars.js';
import { ENTITIES } from './entities.js';

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

// [[path]] and [[path][description]], as org-link-bracket-re reads them: a backslash before a bracket escapes it (a run of backslashes
// counts in pairs), the description may hold single brackets and runs to the first `]]`, and it cannot be empty.
const LINK_RE = /^\[\[((?:[^[\]\\]|\\(?:\\\\)*[[\]]|\\+[^[\]])+)\](?:\[([\s\S]+?)\])?\]/;
const COMMENT_RE = /^@@comment:(.*?)@@/;
// <<<radio target>>> and <<dedicated target>>: no space just inside the brackets, and no angle bracket or line break within
const RADIO_TARGET_RE = /^<<<([^<>\n \t]|[^<>\n \t][^<>\n]*[^<>\n \t])>>>/;
const TARGET_RE = /^<<([^<>\n \t]|[^<>\n \t][^<>\n]*[^<>\n \t])>>/;
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
const DISPLAY_DOLLAR_RE = /^\$\$([\s\S]*?)\$\$/;
const INLINE_PAREN_RE = /^\\\(([\s\S]*?)\\\)/;
const DISPLAY_BRACKET_RE = /^\\\[([\s\S]*?)\\\]/;
// \begin{name} ... \end{name} as org-element-latex-environment-parser reads it: the name is letters, digits and *, case does not matter, and
// nothing but blanks follows the \end{name} on its line
const BEGIN_ENV_RE = /^\\begin\{([A-Za-z0-9*]+)\}([\s\S]*?)\\end\{\1\}(?=[ \t]*(?:\n|$))/i;
// `$...$` as org-element-latex-fragment-parser reads it: the text after the opening `$` does not start with a blank, comma, period or semicolon,
// the closing `$` is the next one and is not preceded by a blank, comma or period, and what follows it is a blank, the end of the line or one of
// a character of the punctuation, whitespace, parenthesis or quote classes of Emacs's syntax table (emacs-chars.js). One character is enough (`$x$`); the text may run over lines but not over a blank line.
const DOLLAR_INLINE_RE = /^\$([^ \t\n,;.$](?:[^$]*[^ \t\n,.$])?)\$/;

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
 * @param {string} text
 * @param {number} pos
 *      without needing Emacs's own syntax table to fall back on */
function matchLatexFragmentAt(text, pos) {
  const remaining = text.slice(pos);

  if (/^\\begin\{/i.test(remaining)) {
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
    if (m && !/\n[ \t]*\n/.test(m[1])) {
      const after = text[pos + m[0].length];
      if (after === undefined || after === '\n' || DOLLAR_FOLLOW_RE.test(after)) {
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

/** @param {number} index */
function makeLatexPlaceholder(index) {
  return LATEX_PLACEHOLDER_START + index + LATEX_PLACEHOLDER_END;
}

/** A LaTeX fragment node. `raw` is the fragment as typed, delimiters included (a text export writes it out as it is); it is not
 * an enumerable field.
 * @param {string} source @param {boolean} displayMode @param {string | undefined} raw */
function latexNode(source, displayMode, raw) {
  const node = { type: 'latex', source, displayMode };
  Object.defineProperty(node, 'raw', { value: raw });
  return node;
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
 * @param {string[]} lines
 *  line (pass it through via opts.latexFragments). */
function extractLatexFragments(lines) {
  const fullText = lines.join('\n');
  const fragments = [];
  let result = '';
  let pos = 0;
  while (pos < fullText.length) {
    const ch = fullText[pos];
    // A code (~...~) or verbatim (=...=) span's own content is always
    // literal per org's own actual rule -- never further parsed, math
    // included -- so it has to be skipped over here wholesale, exactly
    // as written, rather than scanned for a LaTeX delimiter that
    // happens to appear inside example text like "~\(x\)~" (showing
    // the delimiter syntax itself, not real math to render). *bold*/
    // _underline_/etc. are deliberately left unskipped: those CAN
    // legitimately contain real math per org's own nesting rules, so
    // only the two genuinely-literal markers are special-cased here.
    if (ch === '~' || ch === '=') {
      const span = matchEmphasisAt(fullText, pos);
      if (span) {
        result += fullText.slice(pos, pos + span.length);
        pos += span.length;
        continue;
      }
    }
    if (ch === '[' && fullText[pos + 1] === '[') {
      // the address of a bracket link is never math (`\[` and `\]` in it escape the brackets)
      const link = LINK_RE.exec(fullText.slice(pos));
      if (link) {
        result += '[[' + link[1] + ']';
        pos += 3 + link[1].length;
        continue;
      }
    }
    if (ch === '$' || ch === '\\') {
      const m = matchLatexFragmentAt(fullText, pos);
      if (m) {
        fragments.push({ source: m.content, displayMode: m.displayMode, raw: fullText.slice(pos, pos + m.length) });
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
const FOOTNOTE_START_RE = new RegExp(`^\\[fn:([-_${EMACS_ALNUM_RE.source.slice(1, -1)}]*)`, 'u');

/**
 * @param {string} text
 * @param {number} pos
 */
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
const AUTOLINK_SCHEMES = [
  // the link types Org knows (org-link-types), plus the file schemes of this app
  'file+emacs', 'file+sys', 'attachment', 'docview', 'bibtex', 'mailto', 'github', 'webdav', 'elisp', 'shell', 'https', 'local', 'bbdb', 'gnus', 'info', 'help', 'http', 'rmail', 'news', 'file', 'eww', 'ftp', 'irc', 'mhe', 'w3m', 'doi', 'id',
];
const TYPES_RE = AUTOLINK_SCHEMES.join('|');
// A plain link as org-link-plain-re reads it: the path is non-blank, non-bracket, non-angle characters (and balanced parentheses),
// and ends in something that is not punctuation, a slash, or a parenthesized group.
const PLAIN_CHARS = '[^\\][ \\t\\n()<>]';
const PLAIN_PAREN = `\\((?:${PLAIN_CHARS}|\\(${PLAIN_CHARS}*\\))*\\)`;
const BARE_URL_RE = new RegExp(`^(?:${TYPES_RE}):(?:(?:${PLAIN_CHARS}|${PLAIN_PAREN})+)(?:[^!-/:-@\\[-\`{-~\\p{P} \\t\\n]|/|${PLAIN_PAREN})`, 'iu');
// <https://example.com> -- real org's other recognized plain-URI form,
// explicitly called out in org's own manual as equivalent to the bare
// form above, just with angle brackets marking the boundary instead of
// relying on trailing-punctuation heuristics.
const ANGLE_URL_RE = new RegExp(`^<((?:${TYPES_RE}):[^>\\n]*)>`, 'i');

// Emphasis borders as org-element--parse-generic-emphasis has them: an opening marker follows the start of the text, whitespace or one of
// -('"{ and is not followed by whitespace; the closing one is not preceded by whitespace and is followed by whitespace, the end or one of
// -.,;:!?'")}\[ . Whitespace is Emacs's [[:space:]] (emacs-chars.js), which includes the zero-width space and no-break space.
const OPEN_PRE_CHARS = "-('\"{";
const CLOSE_POST_CHARS = "-.,;:!?'\")}\\[";
/** @param {string | undefined} ch */
const isSpace = (ch) => ch !== undefined && EMACS_SPACE_RE.test(ch);

// The text of a sub/superscript as org-match-substring-regexp reads it: braces or parentheses nested up to three deep, `*`, or an optional
// sign and letters, digits, `.`, `,` and `\` that end in a letter or digit (`a_b.c`, `a_1.5`, `x_\alpha`; `a_b,` is `b` and a comma).
/** @param {string} o @param {string} c */
const pairs = (o, c) => {
  const n = `[^\\${o}\\${c}]*?`;
  return `\\${o}(?:${n}|(?:${n}\\${o}${n}\\${c})+${n}|(?:${n}\\${o}(?:${n}\\${o}${n}\\${c})+${n}\\${c})+${n})\\${c}`;
};
const ALNUM = EMACS_ALNUM_RE.source.slice(1, -1);
const SCRIPT_BODY_RE = new RegExp(`^(?:${pairs('{', '}')}|${pairs('(', ')')}|\\*|[+-]?[${ALNUM}.,\\\\]*[${ALNUM}])`, 'u');

/**
 * A `_{...}`/`^{...}` or bare `_word`/`^word` sub/superscript whose marker is at `pos`, as Org reads it: the character before the marker
 * (in the text parsed) is not whitespace. Returns { kind, length, braces } or null. Whether org-use-sub-superscripts lets it count is up to
 * the caller, as in Org, where the parser finds it either way.
 * @param {string} text
 * @param {number} pos
 */
function matchScriptAt(text, pos) {
  const marker = text[pos];
  if (marker !== '_' && marker !== '^') return null;
  if (pos === 0 || isSpace(text[pos - 1])) return null;
  // Org only looks at a ^ that is followed by one of these (an _ is looked at whatever follows, as the start of underline)
  if (marker === '^' && !'-{(*+.,'.includes(text[pos + 1] ?? ' ') && !EMACS_ALNUM_RE.test(text[pos + 1] ?? '')) return null;
  const m = SCRIPT_BODY_RE.exec(text.slice(pos + 1));
  if (!m) return null;
  return { kind: marker === '_' ? 'subscript' : 'superscript', length: 1 + m[0].length, braces: text[pos + 1] === '{' };
}

// `\name` is an entity when the name is one of org-entities and a letter does not follow (`\alpha`, `\alpha{}beta`, `\there4`); the empty
// braces belong to it. Anything else that looks like a LaTeX command, with its `[..]` and `{..}` arguments, is a LaTeX fragment in Org.
const ENTITY_RE = /^\\(there4|sup[123]|frac[13][24]|[a-zA-Z]+)(?:$|\{\}|[^\p{L}])/mu;
const MACRO_RE = /^\{\{\{[a-zA-Z][-a-zA-Z0-9_]*(?:\([\s\S]*?\))?\}\}\}/;
const LATEX_MACRO_RE = /^\\[a-zA-Z]+\*?(?:\[[^[\]\n{}]*\]|\{[^{}\n]*\})*/;
/** The length of the entity at `pos`, or 0. @param {string} text @param {number} pos */
function matchEntityAt(text, pos) {
  const m = ENTITY_RE.exec(text.slice(pos, pos + 40));
  if (!m || !Object.prototype.hasOwnProperty.call(ENTITIES, m[1])) return 0;
  return 1 + m[1].length + (text.startsWith('{}', pos + 1 + m[1].length) ? 2 : 0);
}

/** The text between the bracket at `pos` and its partner, the bracket counted in pairs; -1 when unbalanced. @param {string} text @param {number} pos */
function closingPair(text, pos) {
  const open = text[pos];
  const close = { '[': ']', '{': '}', '(': ')' }[/** @type {'[' | '{' | '('} */ (open)];
  let depth = 0;
  for (let i = pos; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return i;
  }
  return -1;
}

/**
 * An inline source block `src_lang[opts]{code}` or inline call `call_name[opts](args)[opts]` at `pos`, as org-element reads it: the length,
 * or 0. Both are objects whose text no markup is read in.
 * @param {string} text @param {number} pos
 */
function matchInlineCodeAt(text, pos) {
  const head = /^(src_([^ \t\n[{]+)[{[]|call_([^ \t\n[(]+)[([])/.exec(text.slice(pos, pos + 200));
  if (!head) return 0;
  const isSrc = head[0].startsWith('src_');
  let at = pos + head[0].length - 1;
  if (text[at] === '[') {
    const end = closingPair(text, at);
    if (end === -1) return 0;
    at = end + 1;
  }
  const bodyOpen = isSrc ? '{' : '(';
  if (text[at] !== bodyOpen) return 0;
  const end = closingPair(text, at);
  if (end === -1) return 0;
  at = end + 1;
  if (!isSrc && text[at] === '[') {
    const e2 = closingPair(text, at);
    if (e2 !== -1) at = e2 + 1;
  }
  return at - pos;
}

/** @param {string} ch */
function isEmphasisMarker(ch) {
  return Object.prototype.hasOwnProperty.call(EMPHASIS_KIND, ch);
}

/**
 * Attempts to match a complete emphasis span (open marker ... close marker)
 * starting exactly at `pos`. Returns { marker, content, length } or null.
 * @param {string} text
 * @param {number} pos
 */
function matchEmphasisAt(text, pos) {
  const marker = text[pos];
  if (!isEmphasisMarker(marker)) return null;

  const prev = pos > 0 ? text[pos - 1] : null;
  if (prev !== null && prev !== '\n' && !isSpace(prev) && !OPEN_PRE_CHARS.includes(prev)) return null;

  const afterOpen = text[pos + 1];
  if (afterOpen === undefined || isSpace(afterOpen)) return null;

  // The first closing marker that follows a non-blank character and a blank, the end or one of the closing punctuation characters
  for (let j = pos + 2; j < text.length; j++) {
    if (text[j] !== marker) continue;
    if (isSpace(text[j - 1])) continue;
    const afterClose = text[j + 1];
    if (afterClose !== undefined && !isSpace(afterClose) && !CLOSE_POST_CHARS.includes(afterClose)) continue;
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
 * `_` is both the underline marker and the subscript marker. As in Org, a subscript is tried first (it needs a non-blank character before
 * the `_`), then underline. A script that org-use-sub-superscripts does not interpret stays text, and its text is not read for markup.
 * @param {string} text
 */
/** @returns {any} */ function parseInline(/** @type {any} */ text, opts = {}) {
  const subSuperscriptMode = /** @type {any} */ (opts).subSuperscriptMode || 't';
  const nodes = [];
  let buffer = '';
  let pos = 0;

  const radioRe = /** @type {any} */ (opts).radioTargets || null; // plain occurrences of a radio target become links to it
  const flush = () => {
    if (!buffer) return;
    if (radioRe) {
      let last = 0;
      for (const m of buffer.matchAll(radioRe)) {
        if (m.index > last) nodes.push({ type: 'text', value: buffer.slice(last, m.index) });
        nodes.push({ type: 'link', target: m[0].trim().replace(/\s+/g, ' '), description: m[0], radio: true });
        last = m.index + m[0].length;
      }
      if (last < buffer.length) nodes.push({ type: 'text', value: buffer.slice(last) });
    } else {
      nodes.push({ type: 'text', value: buffer });
    }
    buffer = '';
  };

  /** Adds the script at `at` unless org-use-sub-superscripts leaves it as text (then false). @param {number} at @param {{ kind: string, length: number, braces: boolean }} sc */
  const pushScript = (at, sc) => {
    if (subSuperscriptMode === 'nil' || (subSuperscriptMode === '{}' && !sc.braces)) return false;
    flush();
    const script = { type: sc.kind, value: sc.braces ? text.slice(at + 2, at + sc.length - 1) : text.slice(at + 1, at + sc.length) };
    Object.defineProperty(script, 'raw', { value: text.slice(at, at + sc.length) }); // as typed (a_{bc}); not an enumerable field
    nodes.push(script);
    pos = at + sc.length;
    return true;
  };

  while (pos < text.length) {
    const remaining = text.slice(pos);

    const linkMatch = LINK_RE.exec(remaining);
    if (linkMatch && linkMatch.index === 0) {
      flush();
      const target = unescapeLink(linkMatch[1]);
      const description = linkMatch[2] !== undefined ? linkMatch[2] : null;
      if (description === null && IMAGE_EXT_RE.test(target)) {
        nodes.push({ type: 'image', target });
      } else {
        nodes.push({ type: 'link', target, description });
      }
      pos += linkMatch[0].length;
      continue;
    }

    if (text[pos] === '<' && text[pos + 1] === '<') {
      const radio = RADIO_TARGET_RE.exec(remaining);
      const dedicated = radio ? null : TARGET_RE.exec(remaining);
      const hit = radio || dedicated;
      if (hit) {
        flush();
        nodes.push({ type: radio ? 'radio-target' : 'target', name: hit[1], value: hit[0] });
        pos += hit[0].length;
        continue;
      }
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

    const bareMatch = pos === 0 || !/[\p{L}\p{N}]/u.test(text[pos - 1]) ? BARE_URL_RE.exec(remaining) : null;
    if (bareMatch && bareMatch.index === 0) {
      flush();
      const target = bareMatch[0];
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

    if (text[pos] === '[' && text[pos + 1] === 'c' && text.startsWith('[cite', pos)) {
      const cite = parseCitationAt(text, pos);
      if (cite) {
        flush();
        nodes.push(cite.node);
        pos += cite.length;
        continue;
      }
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
      const frag = ph && /** @type {any} */ (opts).latexFragments && /** @type {any} */ (opts).latexFragments[Number(ph[1])];
      if (frag) {
        flush();
        nodes.push(latexNode(frag.source, frag.displayMode, frag.raw));
        pos += ph[0].length;
        continue;
      }
    }

    if (text[pos] === '\\') {
      const entity = matchEntityAt(text, pos);
      if (entity) {
        buffer += text.slice(pos, pos + entity);
        pos += entity;
        continue;
      }
    }

    if (text[pos] === '{' && text[pos + 1] === '{') {
      const macro = MACRO_RE.exec(remaining);
      if (macro) { // {{{name(args)}}}: expanded elsewhere; its arguments are not read for markup
        buffer += macro[0];
        pos += macro[0].length;
        continue;
      }
    }

    if (text[pos] === '$' || text[pos] === '\\') {
      const latex = matchLatexFragmentAt(text, pos);
      if (latex) {
        flush();
        nodes.push(latexNode(latex.content, latex.displayMode, text.slice(pos, pos + latex.length)));
        pos += latex.length;
        continue;
      }
      const macro = text[pos] === '\\' ? LATEX_MACRO_RE.exec(remaining) : null;
      if (macro) { // \name[opt]{arg}: a LaTeX command is a fragment in Org; here it stays text, whose arguments are not read for markup
        buffer += macro[0];
        pos += macro[0].length;
        continue;
      }
    }

    if ((text[pos] === 's' || text[pos] === 'S' || text[pos] === 'c' || text[pos] === 'C') && (pos === 0 || !EMACS_ALNUM_RE.test(text[pos - 1]))) {
      const inline = matchInlineCodeAt(text, pos);
      if (inline) { // src_lang{code} and call_name(args): their text is not read for markup
        buffer += text.slice(pos, pos + inline);
        pos += inline;
        continue;
      }
    }

    // A script is looked for before underline. At the start of a line Org's parser looks one character back from the marker, which is
    // then this one (`__a` is `_` followed by the subscript `_a`).
    if (text[pos] === '_' && (pos === 0 || text[pos - 1] === '\n') && (text[pos + 1] === '_' || text[pos + 1] === '^')) {
      const s2 = matchScriptAt(text, pos + 1);
      if (s2) {
        s2.kind = 'subscript'; // the subscript parser is the one that runs, whichever marker it then finds
        buffer += text[pos];
        pos++;
        if (!pushScript(pos, s2)) { buffer += text.slice(pos, pos + s2.length); pos += s2.length; }
        continue;
      }
    }
    if (text[pos] === '_' || text[pos] === '^') {
      const s2 = matchScriptAt(text, pos);
      if (s2) {
        if (!pushScript(pos, s2)) { buffer += text.slice(pos, pos + s2.length); pos += s2.length; }
        continue;
      }
    }

    if (isEmphasisMarker(text[pos])) {
      const m = matchEmphasisAt(text, pos);
      if (m) {
        flush();
        const kind = /** @type {any} */ (EMPHASIS_KIND)[m.marker];
        if (LITERAL_KINDS.has(kind)) {
          nodes.push({ type: kind, value: m.content });
        } else {
          nodes.push({ type: kind, children: parseInline(m.content, opts) });
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

/** @param {string} line */
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
