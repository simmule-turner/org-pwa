// @ts-check
/**
 * LaTeX export (`org-latex-export-to-latex`): the document as a .tex file, laid out the way Org's ox-latex lays it out.
 * Built on org-elements.js (the same element model the HTML exporter reads) and the shared inline parser.
 *
 * What it writes, checked against Emacs's own output in test/fixtures/latex (tools/gen-latex-oracle.mjs makes those):
 * the preamble and `\hypersetup`, `\maketitle` / `\tableofcontents`, sections (headings deeper than `H:` become nested
 * lists), TODO keywords and tags, inline markup, lists with checkboxes and counters, tables, and the quote / verse /
 * center / example / src / export blocks. Labels are `sec:org` plus seven hex digits, as Org's are, but derived from
 * the heading's position so the same file always gives the same .tex.
 *
 * Also: entities (spelled as org-entities does), links (file, id, headings, custom ids, targets, radio targets and named
 * elements), pictures with their float options, `#+ATTR_LATEX` on tables, pictures, blocks and lists, `#+TOC`, and
 * citations for the natbib and biblatex processors (any other processor prints text, as in the other exporters).
 * `#+INCLUDE` and babel `:exports` are settled before the document gets here (expandIncludes, prepareBabelExport).
 *
 * Classes, packages and source blocks follow the ox-latex variables an init text sets (latex-config.js): `org-latex-classes` (any
 * `#+LATEX_CLASS:`, with its header placeholders and sectioning), `org-latex-packages-alist`, and `org-latex-src-block-backend`
 * (`verbatim`, `listings` or `minted`, with their options and language tables).
 *
 * Not yet: Beamer, line numbers and references in source blocks, custom language environments, `engraved`.
 */

import { newCodeCounter, codeStart, unravelCode, resolveCodeRef, coderefText, blockSwitchText, formatCodePlain } from './code-lines.js';
import { parseElements, parseAttributes } from './org-elements.js';
import { parseInline } from './inline-markup.js';
import { parseExportOptions, getDocTitle, getDocAuthor, getDocDate } from './export-options.js';
import { preambleBody } from './export-html.js';
import { expandMacrosForExport } from './export-org.js';
import { LATEX_ENTITIES } from './entities-latex.js';
import { latexTable } from './latex-table.js';
import { natbibCitation, biblatexCitation } from './latex-cite.js';
import { bibliographyFiles, citeDefaults, citeExportFor, citeExportSetting } from './cite.js';
import { radioTargetRegExp } from './targets.js';
import { latexConfig } from './latex-config.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').InlineNode} InlineNode */
/** @typedef {import('./org-elements.js').OrgElement} OrgElement */
/** @typedef {{ label: string, title: string }} HeadingRef */
/** @typedef {import('./cite.js').CitationNode} CitationNode */
/**
 * @typedef {{
 *   sup: string,
 *   footnotes: Map<string, OrgElement[]>,
 *   footnoteLabels: Map<string, string>,
 *   footnoteRefs: Map<string, number>,
 *   targets: Map<string, HeadingRef>,
 *   labels: Map<Heading, string>,
 *   radioRe: RegExp | null,
 *   processor: string,
 *   cite: ReturnType<typeof citeExportFor> | null,
 *   images: Map<string, string>,
 *   imageTargets: string[],
 *   current: Heading | null,
 *   base: number,
 *   localToc: Set<Heading>,
 *   anon: number,
 *   inLink: boolean,
 *   parsed: Map<string[], OrgElement[]>,
 *   codeCounter: { loc: number },
 *   codeBlocks: { lines: string[], switches: import('./code-lines.js').CodeSwitches, refs: Map<number, string>, start: number | null }[],
 *   cfg: import('./latex-config.js').LatexConfig,
 * }} LatexState
 */

/** Marks a forced line break (`\\` at the end of a line) through the inline parser. */
const BREAK = '\uE000';
const LINE_BREAK_RE = /\\\\[ \t]*$/;
/** A LaTeX command written in the text (`\textbf{x}`, `\alpha`, `\-`) goes through as written, like Org does. */
const COMMAND_RE = /\\(?:[A-Za-z]+\*?(?:\{[^{}\n]*\}|\[[^\][{}\n]*\])*|-)|\\_ +/g;
/** An entity is `\\name`, with an empty `{}` allowed after it: `\\alpha{}beta`. */
const ENTITY_RE = /\\(there4|sup[123]|frac[13][24]|[A-Za-z]+)(\{\})?/y;
const TIMESTAMP_RE = /([<[])(\d{4}-\d{2}-\d{2})(?: ([^\s\d>\]+-]+))?(?: (\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?)?((?: [.+]?\+\d+[hdwmy](?:\/\d+[hdwmy])?| -\d+[hdwmy])*)([>\]])(?:--([<[])(\d{4}-\d{2}-\d{2})(?: ([^\s\d>\]+-]+))?(?: (\d{1,2}:\d{2}))?([>\]]))?/g;

/** @type {LatexState} */
let S = newState();

/** @returns {LatexState} */
function newState() {
  return { sup: 't', footnotes: new Map(), footnoteLabels: new Map(), footnoteRefs: new Map(), targets: new Map(), labels: new Map(), radioRe: null, processor: 'basic', cite: null, images: new Map(), imageTargets: [], current: null, base: 0, localToc: new Set(), anon: 0, inLink: false, parsed: new Map(), codeCounter: newCodeCounter(), codeBlocks: [], cfg: latexConfig(undefined) };
}

/** Seven hex digits from a string, the way Org's `org1a2b3c4` labels look; stable for the same input. @param {string} s */
function hash7(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 7);
}

// ---- text -----------------------------------------------------------------

/** Escapes the characters LaTeX reads as syntax (Org's `org-latex--protect-text`). @param {string} s */
function protect(s) {
  return s.replace(/[\\{}$%&#_~^]/g, (c) => {
    if (c === '\\') return '$\\backslash$';
    if (c === '~') return '\\textasciitilde{}';
    if (c === '^') return '\\^{}';
    return '\\' + c;
  });
}

/** Code and verbatim text: like protect(), but `\`, `^` and `~` have printable forms and `--` runs stay apart. @param {string} s */
function protectTexttt(s) {
  return s.replace(/--|<<|>>|[\\{}$%&#_~^]/g, (c) => {
    if (c === '\\') return '\\textbackslash{}';
    if (c === '~') return '\\textasciitilde{}';
    if (c === '^') return '\\textasciicircum{}';
    if (c.length === 2) return c[0] + '{}' + c[1] + '{}';
    return '\\' + c;
  });
}

/** Plain text: entities spelled out, other commands kept, special characters escaped, `...` as `\ldots{}`, forced breaks as `\\[0pt]`. @param {string} s */
function plain(s) {
  let out = '';
  let last = 0;
  for (const m of s.matchAll(COMMAND_RE)) {
    const start = m.index || 0;
    if (start < last) continue;
    out += plainPiece(s.slice(last, start));
    const entity = entityAt(s, start);
    if (entity) {
      out += entity.text;
      last = entity.end;
    } else {
      out += m[0];
      last = start + m[0].length;
    }
  }
  return out + plainPiece(s.slice(last));
}

/** The entity written at `at` (`\alpha`, `\nbsp{}`, `\_ `), as LaTeX, and where it ends; null when it is not an entity. @param {string} s @param {number} at */
function entityAt(s, at) {
  const spaces = /^\\_( +)/.exec(s.slice(at));
  /** @type {string | undefined} */
  let key;
  let length = 0;
  if (spaces) {
    key = '_' + spaces[1];
    length = spaces[0].length;
  } else {
    ENTITY_RE.lastIndex = at;
    const m = ENTITY_RE.exec(s);
    if (m) {
      key = m[1];
      length = m[0].length;
    }
  }
  const entry = key === undefined ? undefined : LATEX_ENTITIES[key];
  if (!entry) return null;
  return { text: entry[1] ? '\\(' + entry[0] + '\\)' : entry[0], end: at + length };
}

/** @param {string} s */
function plainPiece(s) {
  return s
    .split('...')
    .map((part) => protect(part).split(BREAK).join('\\\\[0pt]'))
    .join('\\ldots{}')
    .replace(/\bLaTeX\b/g, '\\LaTeX{}')
    .replace(/\bTeX\b/g, '\\TeX{}');
}

/** A timestamp in running text is italic, and keeps the space that follows it. @param {string} s */
function textWithTimestamps(s) {
  let out = '';
  let last = 0;
  for (const m of s.matchAll(TIMESTAMP_RE)) {
    const [whole, open, date, day, from, to, repeat, close, open2, date2, day2, time2, close2] = m;
    const start = m.index || 0;
    out += plain(s.slice(last, start));
    const at = (/** @type {string} */ o, /** @type {string} */ d, /** @type {string | undefined} */ dy, /** @type {string | undefined} */ t, /** @type {string} */ c, /** @type {string} */ rep) => o + d + (dy ? ' ' + dy : '') + (t ? ' ' + t : '') + rep + c;
    let body;
    if (to) body = at(open, date, day, from, close, '') + '--' + at(open, date, day, to, close, '');
    else if (date2) body = at(open, date, day, from, close, repeat) + '--' + at(open2, date2, day2, time2, close2, '');
    else body = whole;
    const end = start + whole.length;
    const spaced = !to && !repeat && s[end] === ' ';
    out += '\\textit{' + protect(body) + (spaced ? ' ' : '') + '}';
    last = end;
  }
  return out + plain(s.slice(last));
}

/** Inline markup of a run of text (lines joined with newlines). @param {string} text */
function inline(text) {
  return nodes(parseText(text));
}

/** @param {string} text @returns {InlineNode[]} */
function parseText(text) {
  const marked = text.split('\n').map((l) => (LINE_BREAK_RE.test(l) ? l.replace(LINE_BREAK_RE, BREAK) : l)).join('\n');
  return parseInline(marked, { subSuperscriptMode: S.sup, radioTargets: S.radioRe });
}

/** @param {InlineNode[]} list */
function nodes(list) {
  return list.map(node).join('');
}

/** @param {string} url */
const isExternal = (url) => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url) && !/^(file|id|help|elisp|shell|attachment):/i.test(url);

/** @param {InlineNode} n @returns {string} */
function node(n) {
  switch (n.type) {
    case 'text':
      return textWithTimestamps(n.value);
    case 'bold':
      return '\\textbf{' + nodes(n.children) + '}';
    case 'italic':
      return '\\emph{' + nodes(n.children) + '}';
    case 'underline':
      return '\\uline{' + nodes(n.children) + '}';
    case 'strikethrough':
      return '\\sout{' + nodes(n.children) + '}';
    case 'code':
    case 'verbatim':
      return '\\texttt{' + protectTexttt(n.value) + '}';
    case 'subscript':
      return '\\textsubscript{' + inline(n.value) + '}';
    case 'superscript':
      return '\\textsuperscript{' + inline(n.value) + '}';
    case 'latex':
      return latexFragment(n);
    case 'link':
      return link(n);
    case 'footnote-ref':
      return footnoteRef(n.label, null);
    case 'footnote-def':
      return footnoteRef(n.label, n.label && S.footnotes.has(n.label) ? null : n.children);
    case 'target':
      return '\\label{' + targetLabel(n.name) + '}';
    case 'radio-target':
      return '\\label{' + targetLabel(n.name) + '}' + plain(n.name);
    case 'image':
      return '\\begin{center}\n' + includeGraphics(n.target, {}) + '\n\\end{center}';
    case 'citation':
      return citation(n);
    default:
      return '';
  }
}

/** A name compared without case or runs of blanks, as targets are. @param {string} name */
const norm = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** @param {string} name */
const targetLabel = (name) => 'org' + hash7('target:' + norm(name));

/** Math is passed through as written; `$x$` becomes `\(x\)`. @param {Extract<InlineNode, { type: 'latex' }>} n */
function latexFragment(n) {
  if (n.raw && !/^\$[^$]/.test(n.raw)) return n.raw;
  return n.displayMode ? '\\[' + n.source + '\\]' : '\\(' + n.source + '\\)';
}

/** `\ref` for a link with no description, `\hyperref` for one with. @param {string} label @param {string | null} description */
const reference = (label, description) => (description === null ? '\\ref{' + label + '}' : '\\hyperref[' + label + ']{' + description + '}');

/** The thing an internal link points to, or null: a custom id, an id, a headline (`*Title`), or what a bare name matches
 * (a target, a named element, a headline title, in that order). @param {string} target @returns {{ label: string } | null} */
function resolveInternal(target) {
  if (target.startsWith('#') || /^id:/i.test(target)) return S.targets.get(target.replace(/^ID:/i, 'id:')) || null;
  if (target.startsWith('*')) return S.targets.get('head:' + target.slice(1).trim()) || null;
  const bare = target.replace(/^file:/i, '');
  return S.targets.get('target:' + norm(bare)) || S.targets.get('name:' + bare) || S.targets.get('head:' + bare) || null;
}

/** @param {Extract<InlineNode, { type: 'link' }>} n */
function link(n) {
  const target = n.target;
  if (S.inLink) return protect(n.description === null ? target : n.description);
  if (n.radio) {
    const ref = S.targets.get('target:' + norm(target));
    return ref ? reference(ref.label, protect(n.description || target)) : protect(n.description || target);
  }
  const coderef = /^\((.*)\)$/.exec(target);
  if (coderef) {
    const found = resolveCodeRef(S.codeBlocks, coderef[1]);
    if (found === null) return protect(target);
    return inline(coderefText(coderef[1], found, n.description || null));
  }
  S.inLink = true;
  const description = n.description === null ? null : inline(n.description);
  S.inLink = false;
  if (/^file:/i.test(target) || (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) && /^(\.{0,2}\/|~\/)/.test(target))) {
    let path = target.replace(/^file:(\/\/)?/i, '').replace(/::.*$/, '');
    if (path.startsWith('/')) path = 'file://' + path;
    return description === null ? '\\url{' + path + '}' : '\\href{' + protect(path) + '}{' + description + '}';
  }
  if (/^(elisp|shell):/i.test(target)) {
    const rest = target.replace(/^[a-z]+:/i, '');
    return description === null ? '\\url{' + rest + '}' : '\\href{' + protect(rest) + '}{' + description + '}';
  }
  if (isExternal(target)) return description === null ? '\\url{' + target + '}' : '\\href{' + protect(target) + '}{' + description + '}';
  const ref = resolveInternal(target);
  if (ref) return reference(ref.label, description);
  return description === null ? protect(target) : description;
}

// ---- pictures -------------------------------------------------------------

/** `\includegraphics` for a picture link, with `:width`, `:height` and `:options`; the width defaults to .9\linewidth
 * (0.48\textwidth in a wrapfigure). @param {string} target @param {Record<string, string>} attrs @param {boolean} [wrap] */
function includeGraphics(target, attrs, wrap = false) {
  let path = target.replace(/^file:(\/\/)?/i, '');
  if (!S.imageTargets.includes(target)) S.imageTargets.push(target);
  path = S.images.get(target) || path;
  const options = [];
  if (attrs.options) options.push(attrs.options);
  if (attrs.width) options.push('width=' + attrs.width);
  if (attrs.height) options.push('height=' + attrs.height);
  if (!attrs.width && !attrs.height) options.push(wrap ? 'width=0.48\\textwidth' : 'width=.9\\linewidth');
  return '\\includegraphics[' + options.join(',') + ']{' + path + '}';
}

/** A picture that is a paragraph of its own: a figure when it has a caption, else centred; `#+ATTR_LATEX` sets the float.
 * @param {string} target @param {import('./org-elements.js').Affiliated | null | undefined} aff */
function pictureBlock(target, aff) {
  const attrs = parseAttributes(aff && aff.attr.latex);
  const caption = aff && aff.caption.length ? aff.caption[aff.caption.length - 1] : null;
  const name = aff && aff.name ? aff.name : null;
  const center = attrs.center !== 'nil';
  const floatAttr = attrs.float;
  const wrap = floatAttr === 'wrap';
  const floated = floatAttr === undefined ? !!caption : floatAttr !== 'nil';
  const label = name ? (caption ? 'fig:org' : 'org') + hash7('name:' + name) : '';
  const picture = includeGraphics(target, attrs, wrap);
  const captionText = caption ? inline(caption.text) : '';
  if (!floated) {
    const lines = [picture];
    if (caption) lines.push('\\captionof{figure}{' + (label ? '\\label{' + label + '}' : '') + captionText + '}');
    else if (label) lines.push('\\label{' + label + '}');
    return center ? '\\begin{center}\n' + lines.join('\n') + '\n\\end{center}\n' : lines.join('\n') + '\n';
  }
  const env = wrap ? 'wrapfigure' : floatAttr === 'sideways' ? 'sidewaysfigure' : floatAttr === 'multicolumn' ? 'figure*' : 'figure';
  const placement = attrs.placement || (wrap ? '{r}{0.5\\textwidth}' : env === 'sidewaysfigure' || env === 'figure*' ? '' : '[htbp]');
  const lines = ['\\begin{' + env + '}' + placement];
  if (center) lines.push('\\centering');
  lines.push(picture);
  if (caption) lines.push('\\caption' + (caption.short ? '[' + inline(caption.short) + ']' : '') + '{' + (label ? '\\label{' + label + '}' : '') + captionText + '}');
  else if (label) lines.push('\\label{' + label + '}');
  lines.push('\\end{' + env + '}');
  return lines.join('\n') + '\n';
}

// ---- citations ------------------------------------------------------------

/** A citation: a natbib or biblatex command, or the text the basic processor makes. @param {CitationNode} n */
function citation(n) {
  const blanks = ' '.repeat(n.blanks || 0);
  const affix = (/** @type {string} */ text) => inline(text).trim();
  if (S.processor === 'natbib') return natbibCitation(n, affix) + blanks;
  if (S.processor === 'biblatex') return biblatexCitation(n, affix) + blanks;
  const segments = S.cite ? S.cite.formatCitation(n) : null;
  return (segments ? citeSegments(segments).trim() : '') + blanks;
}

/** A citation processor's text as LaTeX: plain text escaped, affixes as Org text, emphasis as \emph. @param {import('./cite.js').Segment[]} segments @returns {string} */
function citeSegments(segments) {
  return segments.map((x) => (typeof x === 'string' ? plain(x) : 'org' in x ? inline(x.org) : '\\emph{' + citeSegments(x.italic) + '}')).join('');
}

/** @param {string | null} label @param {InlineNode[] | null} inlineDef */
function footnoteRef(label, inlineDef) {
  if (inlineDef) return '\\footnote{' + nodes(inlineDef) + '}';
  if (label === null) return '';
  const known = S.footnoteLabels.get(label);
  if (known) return '\\textsuperscript{\\ref{' + known + '}}';
  const def = S.footnotes.get(label);
  if (!def) return '';
  const id = 'org' + hash7('fn:' + label);
  S.footnoteLabels.set(label, id);
  return '\\footnote{' + elements(def).replace(/\n+$/, '') + ((S.footnoteRefs.get(label) || 0) > 1 ? '\\label{' + id + '}' : '') + '}'; // a label only when a later reference needs it
}

// ---- elements -------------------------------------------------------------

/** @param {string[]} lines */
function parsedLines(lines) {
  let parsed = S.parsed.get(lines);
  if (!parsed) {
    parsed = parseElements(lines);
    S.parsed.set(lines, parsed);
  }
  return parsed;
}

/** Elements joined, each followed by the blank lines it had in the source. @param {OrgElement[]} list */
function elements(list) {
  let out = '';
  let lastShown = -1;
  list.forEach((el, i) => {
    const text = element(el);
    if (!text) return;
    if (el.type === 'hr' && out && !out.endsWith('\n\n')) out += '\n';
    out += text + '\n'.repeat(el.postBlank || 0);
    lastShown = i;
  });
  return lastShown >= 0 && lastShown < list.length - 1 ? trimEnd(out) : out; // elements that print nothing (footnote definitions ...) after the last one swallow its blank lines
}

/** @param {string} s */
const trimEnd = (s) => s.replace(/\n+$/, '') + '\n';

/** @param {OrgElement} el @returns {string} */
function element(el) {
  switch (el.type) {
    case 'paragraph': {
      const parsed = parseText([el.lines[0].trimStart(), ...el.lines.slice(1)].join('\n'));
      const content = parsed.filter((x) => !(x.type === 'text' && !x.value.trim()));
      if (content.length === 1 && content[0].type === 'image') return pictureBlock(content[0].target, el.aff);
      return nodes(parsed) + '\n';
    }
    case 'list':
      return list(el, 1);
    case 'table':
      return table(el);
    case 'block':
      return block(el);
    case 'fixed':
      return namedLabel(el) + verbatim(el.lines) + '\n';
    case 'toc':
      return tocKeyword(el.value);
    case 'print-bibliography':
      return bibliography();
    case 'hr':
      return '\\noindent\\rule{\\textwidth}{0.5pt}\n';
    case 'latex-env':
      return el.lines.join('\n') + '\n';
    case 'latex-line':
      return el.value + '\n';
    case 'drawer':
      return /^(PROPERTIES|LOGBOOK|CLOCK)$/i.test(el.name) ? '' : elements(parsedLines(el.lines));
    default:
      return '';
  }
}

/** @param {string[]} lines */
function verbatim(lines) {
  return '\\begin{verbatim}\n' + lines.join('\n') + (lines.length ? '\n' : '') + '\\end{verbatim}\n';
}

/** The label Org puts before a named block that is not a table or a picture. @param {OrgElement} el */
function namedLabel(el) {
  return el.aff && el.aff.name ? '\\phantomsection\n\\label{org' + hash7('name:' + el.aff.name) + '}\n' : '';
}

/**
 * The code of a source or example block without indentation and references, numbered in document order (`org-export-unravel-code`, `org-export-get-loc`).
 * @param {Extract<OrgElement, { type: 'block' }> & { __code?: import('./code-lines.js').CodeBlock & { start: number | null } }} el
 * @returns {import('./code-lines.js').CodeBlock & { start: number | null }}
 */
function prepareCode(el) {
  if (el.__code) return el.__code;
  const lines = el.lines.map((/** @type {string} */ l) => l.replace(/^(\s*),(\*|#\+)/, '$1$2'));
  const block = unravelCode(lines, blockSwitchText(el.name, el.params));
  el.__code = { ...block, start: codeStart(S.codeCounter, block.switches, lines.length) };
  S.codeBlocks.push(el.__code);
  return el.__code;
}

/** @param {Extract<OrgElement, { type: 'block' }>} el */
function block(el) {
  const lead = Math.min(Infinity, ...el.lines.filter((l) => l.trim()).map((l) => (/^[ \t]*/.exec(l) || [''])[0].length));
  const lines = el.lines.map((l) => l.slice(Number.isFinite(lead) ? Math.min(lead, (/^[ \t]*/.exec(l) || [''])[0].length) : 0));
  const attrs = parseAttributes(el.aff && el.aff.attr.latex);
  const wrapIn = (/** @type {string} */ env, /** @type {string} */ options) => '\\begin{' + env + '}' + options + '\n' + trimEnd(elements(parsedLines(lines))) + '\\end{' + env + '}\n';
  switch (el.name) {
    case 'src':
    case 'example': {
      const code = prepareCode(el);
      const raw = formatCodePlain(code, code.start);
      if (attrs.environment) return namedLabel(el) + '\\begin{' + attrs.environment + '}\n' + raw.join('\n') + '\n\\end{' + attrs.environment + '}\n';
      const coded = el.name === 'src' ? codeBlock(el, code, attrs) : null;
      if (coded !== null) return coded;
      const caption = el.name === 'src' && el.aff && el.aff.caption.length ? el.aff.caption[el.aff.caption.length - 1] : null;
      return (el.name === 'example' ? namedLabel(el) : '') + verbatim(raw) + (caption ? '\\captionof{figure}{' + inline(caption.text) + '}\n' : '');
    }
    case 'comment':
      return '';
    case 'export':
      return /^latex\b/i.test(el.params) ? lines.join('\n') + '\n' : '';
    case 'verse':
      return '\\begin{verse}\n' + lines.map(verseLine).join('') + '\\end{verse}\n';
    default:
      return wrapIn(el.name, attrs.options || '');
  }
}

/** `key=value,...` as `org-latex--make-option-string` writes it; a value with square brackets goes in braces. @param {[string, string | null][]} options */
function optionString(options) {
  return options.map(([key, value]) => key + (value === null ? '' : '=' + (/[[\]]/.test(value) ? '{' + value + '}' : value))).join(',');
}

/**
 * A source block through the listings or minted package, as `org-latex-src-block--listings` and `--minted` write it; null when the
 * block is written as verbatim text (the backend says so, the block has no language, or it is empty).
 * @param {Extract<OrgElement, { type: 'block' }>} el @param {import('./code-lines.js').CodeBlock & { start: number | null }} unravelled @param {Record<string, string>} attrs
 */
function codeBlock(el, unravelled, attrs) {
  const raw = formatCodePlain(unravelled, null);
  const backend = S.cfg.backend;
  const lang = el.params.trim().split(/\s+/)[0];
  if ((backend !== 'listings' && backend !== 'minted') || !lang || !raw.some((l) => l.trim())) return null;
  const cap = el.aff && el.aff.caption.length ? el.aff.caption[el.aff.caption.length - 1] : null;
  const name = el.aff && el.aff.name;
  const label = name ? 'lst:org' + hash7('name:' + name) : '';
  const code = raw.join('\n') + '\n';
  const local = attrs.options ? ',' + attrs.options : '';
  const position = (attrs.placement || '').replace(/^\[(.*)\]$/, '$1') || 'htbp';
  if (backend === 'listings') {
    const options = S.cfg.listingsOptions;
    const has = (/** @type {string} */ key) => options.some(([k]) => k === key);
    /** @type {[string, string | null][]} */
    const all = [...options];
    if (attrs.float === 'multicolumn') all.push(['float', '*']);
    else if (attrs.float !== undefined && attrs.float !== '' && !has('float')) all.push(['float', 'htbp']);
    all.push(['language', S.cfg.listingsLangs.get(lang) || lang]);
    all.push(['label', label || ' ']);
    all.push(['caption', cap ? (cap.short ? '{[' + inline(cap.short) + ']' + inline(cap.text) + '}' : '{' + inline(cap.text) + '}') : ' ']);
    all.push(['captionpos', 'b']);
    if (!has('numbers')) {
      if (unravelled.start === null) all.push(['numbers', 'none']);
      else all.push(['firstnumber', String(unravelled.start + 1)], ['numbers', 'left']);
    }
    return '\\begin{lstlisting}[' + optionString(all) + local + ']\n' + code + '\\end{lstlisting}\n';
  }
  const multicolumn = attrs.float === 'multicolumn';
  const captionText = cap ? '\\caption' + (cap.short ? '[' + inline(cap.short) + ']' : '') + '{' + (label ? '\\label{' + label + '}' : '') + inline(cap.text) + '}\n' : label ? '\\label{' + label + '}\n' : '';
  /** @type {[string, string | null][]} */
  const mintedOptions = [...S.cfg.mintedOptions];
  if (unravelled.start !== null && !mintedOptions.some(([k]) => k === 'linenos')) mintedOptions.unshift(['linenos', null], ['firstnumber', String(unravelled.start + 1)]);
  const body = '\\begin{minted}[' + optionString(mintedOptions) + local + ']{' + (S.cfg.mintedLangs.get(lang) || lang.toLowerCase()) + '}\n' + code + '\\end{minted}';
  if (cap || multicolumn) return '\\begin{listing' + (multicolumn ? '*' : '') + '}[' + position + ']\n' + body + '\n' + captionText + '\\end{listing' + (multicolumn ? '*' : '') + '}\n';
  if (attrs.float === 't') return '\\begin{listing}[' + position + ']\n' + body + '\n\\end{listing}\n';
  return body + '\n';
}

/** @param {string} line */
function verseLine(line) {
  if (!line.trim()) return '\\vspace*{1em}\n';
  const lead = (/^[ \t]*/.exec(line) || [''])[0].length;
  return (lead ? '\\hspace*{' + lead + 'em}' : '') + inline(line.trim()) + '\\\\[0pt]\n';
}

// ---- lists ----------------------------------------------------------------

/** @param {Extract<OrgElement, { type: 'list' }>} el @param {number} depth */
function list(el, depth) {
  const attrs = parseAttributes(el.aff && el.aff.attr.latex);
  const env = attrs.environment || (el.listType === 'ordered' ? 'enumerate' : el.listType === 'descriptive' ? 'description' : 'itemize');
  const counter = ['enumi', 'enumii', 'enumiii', 'enumiv'][Math.min(depth, 4) - 1];
  let out = '\\begin{' + env + '}' + (attrs.options || '') + '\n';
  for (const item of el.items) {
    if (item.counter !== null && el.listType === 'ordered') out += '\\setcounter{' + counter + '}{' + (item.counter - 1) + '}\n';
    const box = item.checkbox === null ? '' : ({ off: '$\\square$', on: '$\\boxtimes$', trans: '$\\boxminus$' }[item.checkbox] || '');
    let head = '\\item';
    if (el.listType === 'descriptive') head += '[{' + inline(item.tag || '') + '}]';
    else if (box) head += '[{' + box + '}]';
    const body = itemBody(item.children, depth, item === el.items[el.items.length - 1]) + '\n'.repeat(item.postBlank || 0);
    out += head + (body.startsWith('\\begin{') ? '\n' : ' ') + body;
  }
  return out + '\\end{' + env + '}\n';
}

/** @param {OrgElement[]} children @param {number} depth @param {boolean} last */
function itemBody(children, depth, last) {
  let out = '';
  for (const el of children) {
    const text = el.type === 'list' ? list(el, depth + 1) : element(el);
    if (text) out += text + '\n'.repeat(el.postBlank || 0);
  }
  return last ? trimEnd(out) : out.endsWith('\n') ? out : out + '\n';
}

// ---- tables ---------------------------------------------------------------

/** @param {Extract<OrgElement, { type: 'table' }>} el */
function table(el) {
  const caption = el.aff && el.aff.caption.length ? el.aff.caption[el.aff.caption.length - 1] : null;
  const label = el.aff && el.aff.name ? '\\label{tab:org' + hash7('name:' + el.aff.name) + '}' : '';
  return latexTable(el, { cell: inline, caption: caption ? { short: caption.short ? inline(caption.short) : null, text: inline(caption.text) } : null, label });
}

// ---- #+TOC and bibliography -------------------------------------------------

/** `#+TOC: headlines N [local]`, `tables` or `listings`. @param {string} value */
function tocKeyword(value) {
  if (/\btables\b/.test(value)) return '\\listoftables\n';
  if (/\blistings\b/.test(value)) return S.cfg.backend === 'minted' || S.cfg.backend === 'engraved' ? '\\listoflistings\n' : '\\lstlistoflistings\n';
  if (!/\bheadlines\b/.test(value)) return '';
  const local = /\blocal\b/.test(value) && S.current !== null;
  const level = local && S.current ? S.current.level - S.base : 0;
  const given = /\b\d+\b/.exec(value);
  const depth = given ? Number(given[0]) + (local ? level : 0) : null;
  if (!local) return (depth === null ? '' : '\\setcounter{tocdepth}{' + depth + '}\n') + '\\tableofcontents\n';
  if (S.current) S.localToc.add(S.current);
  return '\\startcontents[level-' + level + ']\n\\printcontents[level-' + level + ']{}{0}{' + (depth === null ? '' : '\\setcounter{tocdepth}{' + depth + '}') + '}\n';
}

/** @type {Doc | null} */
let activeDoc = null;

/** `#+PRINT_BIBLIOGRAPHY:` as natbib's or biblatex's command, or the references the basic processor writes. */
function bibliography() {
  const doc = activeDoc;
  if (!doc) return '';
  const setting = citeExportSetting(doc);
  const files = bibliographyFiles(doc, citeDefaults.globalFiles);
  if (S.processor === 'natbib') return (setting.bibStyle ? '\\bibliographystyle{' + setting.bibStyle + '}\n' : '') + '\\bibliography{' + files.map((f) => f.replace(/\.[^./]*$/, '')).join(',') + '}\n';
  if (S.processor === 'biblatex') return '\\printbibliography\n';
  if (!S.cite) return '';
  return S.cite.bibliography().map((/** @type {import('./cite.js').Segment[]} */ e) => citeSegments(e) + '\n').join('\n');
}

// ---- headings -------------------------------------------------------------

const keywordList = (/** @type {Doc} */ doc, /** @type {string} */ key) => (doc.keywords || []).filter((k) => k.key.toUpperCase() === key).map((k) => k.value.trim());

/** Which headings are exported: not COMMENT, not tagged for exclusion (`#+EXCLUDE_TAGS:`, `noexport` by default), not the Footnotes section. @param {Doc} doc @param {boolean} [footnoteSection] */
function exclusion(doc, footnoteSection = true) {
  const tags = keywordList(doc, 'EXCLUDE_TAGS').join(' ').split(/\s+/).filter(Boolean);
  const exclude = new Set(tags.length ? tags : ['noexport']);
  return (/** @type {Heading} */ h) => /^COMMENT(\s|$)/.test(h.title) || h.tags.some((t) => exclude.has(t)) || (footnoteSection && h.title.trim() === 'Footnotes'); // Org keeps its footnote section out of the export
}

/** @param {Heading} h */
function headingTitle(h) {
  const todo = h.todo ? '{\\bfseries\\sffamily ' + protect(h.todo) + '} ' : '';
  const tags = h.tags.length ? '\\hfill{}\\textsc{' + h.tags.map(protect).join(':') + '}' : '';
  return todo + inline(h.title) + tags;
}

/**
 * @typedef {{ doc: Doc, cls: import('./latex-config.js').LatexClass, depth: number, numbered: boolean, skip: (h: Heading) => boolean, path: number[] }} HeadingCtx
 */

/** @param {Heading[]} children @param {HeadingCtx} ctx @param {number} base */
function headings(children, ctx, base) {
  const shown = children.filter((h) => !ctx.skip(h));
  let out = '';
  /** @type {Heading[]} */
  let run = [];
  const flush = () => {
    if (run.length) out += lowLevelList(run, ctx, base);
    run = [];
  };
  shown.forEach((h) => {
    if (h.level - base > ctx.depth || !sectionFormat(ctx, h.level - base)) {
      run.push(h);
      return;
    }
    flush();
    out += section(h, ctx, base);
  });
  flush();
  return out;
}

/** @param {Heading} h @param {HeadingCtx} ctx */
function labelFor(h, ctx) {
  return S.labels.get(h) || 'sec:org' + hash7(h.title + ctx.path.length);
}

/** @param {Heading} h @param {HeadingCtx} ctx @param {number} base */
function section(h, ctx, base) {
  const fmt = /** @type {string} */ (sectionFormat(ctx, h.level - base));
  const label = '\\label{' + labelFor(h, ctx) + '}\n';
  return formatSection(fmt, headingTitle(h), label + headingBody(h, ctx, base));
}

/** The class's way to write a heading of this relative level: a format with two `%s`, or null when the class has none (the heading becomes a list item). @param {HeadingCtx} ctx @param {number} level */
function sectionFormat(ctx, level) {
  const sec = ctx.cls.sections[level - 1];
  return sec ? (ctx.numbered ? sec.numbered : sec.unnumbered) : null;
}

/** Lisp's `format` with a format that has two `%s` (and `%%`), given the title and what follows it. @param {string} fmt @param {string} title @param {string} rest */
function formatSection(fmt, title, rest) {
  let n = 0;
  const out = fmt.replace(/%([s%])/g, (_m, c) => (c === '%' ? '%' : n++ === 0 ? title : rest));
  return out.endsWith('\n') ? out : out + '\n'; // an element always ends with a line break
}

/** @param {Heading} h @param {HeadingCtx} ctx @param {number} base */
function headingBody(h, ctx, base) {
  const lines = h.bodyLines || [];
  let lead = 0;
  while (lead < lines.length && !lines[lead].trim()) lead++;
  if ((h.propertyOrder || []).length || Object.values(h.planning || {}).some(Boolean)) lead = 0; // Org drops the blank line after a property drawer or planning line
  S.current = h;
  const text = elements(parsedLines(lines));
  const body = text ? '\n'.repeat(lead) + text : '';
  const children = headings(h.children || [], ctx, base);
  const stop = S.localToc.has(h) ? '\\stopcontents[level-' + (h.level - base) + ']\n' : '';
  return body + children + stop;
}

/** A run of headings deeper than `H:` becomes one list; each item is the heading's title, its label and its text. @param {Heading[]} run @param {HeadingCtx} ctx @param {number} base */
function lowLevelList(run, ctx, base) {
  const env = ctx.numbered ? 'enumerate' : 'itemize';
  let out = '\\begin{' + env + '}\n';
  for (const h of run) out += '\\item ' + headingTitle(h) + '\n\\label{' + labelFor(h, ctx) + '}\n' + headingBody(h, ctx, base);
  return out + '\\end{' + env + '}\n';
}

/** Numbers every exported heading's position into the label table, so links can find it before it is written. @param {Heading[]} children @param {HeadingCtx} ctx */
function indexHeadings(children, ctx) {
  let n = 0;
  for (const h of children) {
    if (ctx.skip(h)) continue;
    n++;
    const path = [...ctx.path, n];
    const label = 'sec:org' + hash7(path.join('.') + '|' + h.title);
    const ref = { label, title: h.title };
    S.labels.set(h, label);
    S.targets.set('head:' + h.title.trim(), ref);
    const custom = h.properties && h.properties.CUSTOM_ID;
    if (custom) S.targets.set('#' + custom.trim(), ref);
    const id = h.properties && h.properties.ID;
    if (id) S.targets.set('id:' + id.trim(), ref);
    indexHeadings(h.children || [], { ...ctx, path });
  }
}

/** Labels for what links can point to besides headings: `<<targets>>`, `<<<radio targets>>>` and named elements.
 * @param {OrgElement[]} list */
function indexNames(list) {
  for (const el of list) {
    if (el.type === 'block' && (el.name === 'src' || el.name === 'example')) prepareCode(el);
    if (el.aff && el.aff.name) {
      const name = el.aff.name;
      const caption = el.aff.caption.length > 0;
      let label = 'org' + hash7('name:' + name);
      if (el.type === 'table') label = 'tab:' + label;
      else if (el.type === 'paragraph' && caption) label = 'fig:' + label;
      if (!(el.type === 'block' && el.name === 'src')) S.targets.set('name:' + name, { label, title: name });
    }
    /** @type {string[]} */
    let texts = [];
    if (el.type === 'paragraph') texts = el.lines;
    else if (el.type === 'table') texts = el.rows.flatMap((r) => ('rule' in r && r.rule ? [] : r.cells || []));
    else if (el.type === 'list') {
      for (const item of el.items) {
        if (item.tag) texts.push(item.tag);
        indexNames(item.children);
      }
    } else if (el.type === 'drawer') indexNames(parsedLines(el.lines));
    else if (el.type === 'block' && ['quote', 'center'].includes(el.name)) indexNames(parsedLines(el.lines));
    else if (el.type === 'footnote-def') indexNames(el.children);
    for (const m of texts.join('\n').matchAll(/<<<([^<>\n]+)>>>|<<([^<>\n]+)>>/g)) {
      const name = m[1] || m[2];
      S.targets.set('target:' + norm(name), { label: targetLabel(name), title: name });
    }
  }
}

// ---- document -------------------------------------------------------------

const LANGUAGES = /** @type {Record<string, string>} */ ({ en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', nl: 'Dutch', pt: 'Portuguese', sv: 'Swedish', da: 'Danish', nb: 'Norwegian', fi: 'Finnish', pl: 'Polish', ru: 'Russian', cs: 'Czech', ja: 'Japanese', zh: 'Chinese' });

/** Option text such as `H:2 toc:nil` -> its `H` value, or the default of 3. @param {Doc} doc */
function headlineLevels(doc) {
  let depth = 3;
  for (const kw of doc.keywords || []) {
    if (kw.key.toUpperCase() !== 'OPTIONS') continue;
    const m = /(?:^|\s)H:(\d+)(?=\s|$)/.exec(kw.value);
    if (m) depth = Number(m[1]);
  }
  return depth;
}

/** `org-latex-default-packages-alist`: [options, package, only for these compilers]. */
const DEFAULT_PACKAGES = /** @type {[string, string, string[] | null][]} */ ([
  ['utf8', 'inputenc', ['pdflatex']],
  ['T1', 'fontenc', ['pdflatex']],
  ['', 'graphicx', null],
  ['', 'longtable', null],
  ['', 'wrapfig', null],
  ['', 'rotating', null],
  ['normalem', 'ulem', null],
  ['', 'amsmath', null],
  ['', 'amssymb', null],
  ['', 'capt-of', null],
  ['', 'hyperref', null],
]);
const COMPILERS = ['pdflatex', 'xelatex', 'lualatex'];

/** The packages as `\usepackage` lines, leaving out those meant for other compilers (`org-latex--remove-packages`). @param {(string | import('./latex-config.js').LatexPackage)[]} list @param {string} compiler @returns {string} */
function packageLines(list, compiler) {
  const known = COMPILERS.includes(compiler.toLowerCase());
  return list
    .filter((p) => typeof p === 'string' || !known || !p.compilers || p.compilers.some((c) => c.toLowerCase() === compiler.toLowerCase()))
    .map((p) => (typeof p === 'string' ? p : p.options === '' ? '\\usepackage{' + p.name + '}' : '\\usepackage[' + p.options + ']{' + p.name + '}'))
    .join('\n');
}

/**
 * The class header with the packages and the extra lines put in (`org-latex-make-preamble` and `org-splice-latex-header`): the places
 * `[DEFAULT-PACKAGES]`, `[PACKAGES]` and `[EXTRA]` mark in the header, or after it when it has none; `[NO-...]` leaves the part out.
 * @param {string} header @param {string | undefined} classOptions @param {string} compiler @param {string[]} extraLines
 * @returns {string[]}
 */
function spliceHeader(header, classOptions, compiler, extraLines) {
  let tpl = classOptions === undefined ? header : header.replace(/^([ \t]*\\documentclass)(\[[^\]]*\])?/gm, (_m, lead) => lead + classOptions);
  const defaults = packageLines(DEFAULT_PACKAGES.map(([options, name, compilers]) => ({ options, name, compilers })), compiler);
  const packages = packageLines(S.cfg.packages, compiler);
  const extra = extraLines.length ? extraLines.join('\n') + '\n' : '';
  let end = '';
  let m = /^[ \t]*\[(NO-)?DEFAULT-PACKAGES\][ \t]*\n?/m.exec(tpl);
  if (m) tpl = tpl.slice(0, m.index) + (m[1] || !defaults ? '' : defaults + '\n') + tpl.slice(m.index + m[0].length);
  else if (defaults) end = defaults;
  m = /\[(NO-)?PACKAGES\][ \t]*\n?/.exec(tpl);
  if (m) tpl = tpl.slice(0, m.index) + (m[1] || !packages ? '' : packages + '\n') + tpl.slice(m.index + m[0].length);
  else if (packages) end += '\n' + packages;
  m = /\[(NO-)?EXTRA\][ \t]*\n?/.exec(tpl);
  if (m) tpl = tpl.slice(0, m.index) + (m[1] || !extra ? '' : extra + '\n') + tpl.slice(m.index + m[0].length);
  else if (/\S/.test(extra)) end += '\n' + extra;
  const text = /\S/.test(end) ? tpl + '\n' + end : tpl;
  return text.replace(/(?:\n[ \t]*)*$/, '').split('\n');
}

/** @param {string} s */
const firstLine = (s) => s.replace(/\s*\n\s*/g, ' ').trim();

/**
 * The document as LaTeX. `scope` exports one heading's subtree instead of the whole file.
 * @param {Doc} doc
 * @param {Heading | null} [scope]
 */
export function exportToLatex(doc, scope = null, { images = /** @type {Map<string, string> | null} */ (null), defaults = /** @type {{ cls?: string, compiler?: string, sup?: string, header?: string, init?: string }} */ ({}) } = {}) {
  ({ doc, scope } = expandMacrosForExport(doc, scope, new Date())); // {{{macros}}} are expanded before anything is read
  S = newState();
  activeDoc = doc;
  if (images) S.images = images;
  const options = parseExportOptions(doc, defaults.sup);
  S.sup = options.sup;
  S.radioRe = radioTargetRegExp(doc);
  S.processor = citeExportSetting(doc).processor;
  S.base = scope ? scope.level : 0;
  const first = (/** @type {string} */ key) => keywordList(doc, key)[0];

  S.cfg = latexConfig(defaults.init);
  const declared = (first('LATEX_CLASS') || defaults.cls || 'article').trim();
  const article = /** @type {import('./latex-config.js').LatexClass} */ (S.cfg.classes.find((c) => c.name === 'article'));
  // a class that is not defined is written as the document class of that name, with the article's sections
  const cls = S.cfg.classes.find((c) => c.name === declared) || { ...article, header: article.header.replace(/\{article\}/, '{' + declared + '}') };
  const compiler = (first('LATEX_COMPILER') || defaults.compiler || 'pdflatex').trim();
  const givenOptions = first('LATEX_CLASS_OPTIONS');
  const classOptions = givenOptions === undefined ? undefined : givenOptions.replace(/^\s*\[?/, '[').replace(/\]?\s*$/, ']');

  const skip = exclusion(doc);
  const ctx = { doc, cls, depth: headlineLevels(doc), numbered: options.num !== false, skip, path: /** @type {number[]} */ ([]) };
  const roots = scope ? scope.children || [] : doc.children || [];
  const base = scope ? scope.level : 0;
  indexHeadings(roots, ctx);

  const preamble = scope ? scope.bodyLines || [] : preambleBody(doc);
  for (const lines of [preamble, ...collectBodies(roots, exclusion(doc, false))]) {
    for (const el of parsedLines(lines)) if (el.type === 'footnote-def') S.footnotes.set(el.label, el.children);
  }
  for (const lines of [preamble, ...collectBodies(roots, skip)]) {
    indexNames(parsedLines(lines));
    for (const line of lines) {
      for (const m of line.matchAll(/\[fn:([A-Za-z0-9_-]+)(?=[\]:])/g)) {
        if (m.index === 0 && line[m[0].length] === ']') continue; // a definition, not a reference
        S.footnoteRefs.set(m[1], (S.footnoteRefs.get(m[1]) || 0) + 1);
      }
    }
  }
  if (S.processor !== 'natbib' && S.processor !== 'biblatex') S.cite = citeExportFor(doc, exportedTree(roots, skip), parseInline, !scope);
  const cited = S.processor === 'natbib' || S.processor === 'biblatex' ? hasCitations(preamble, roots, skip) : false;
  const bibFiles = bibliographyFiles(doc, citeDefaults.globalFiles);

  const title = scope ? getDocTitle(doc) || scope.title : getDocTitle(doc);
  const author = getDocAuthor(doc);
  const date = getDocDate(doc);
  const lang = (first('LANGUAGE') || 'en').trim().split(/[-_]/)[0];

  const head = [
    '% Intended LaTeX compiler: ' + compiler,
    ...spliceHeader(cls.header, classOptions, compiler, [...(defaults.header ? defaults.header.split('\n').filter((l) => l.trim() !== '') : []), ...keywordList(doc, 'LATEX_HEADER'), ...keywordList(doc, 'LATEX_HEADER_EXTRA')]),
    '\\author{' + (options.author && author ? plain(author) : '') + '}',
    '\\date{' + (options.date === false ? '' : date ? plain(date) : '\\today') + '}',
    '\\title{' + (title ? inline(title) : '') + '}',
    '\\hypersetup{',
    ' pdfauthor={' + (author ? plain(author) : '') + '},',
    ' pdftitle={' + (title ? inline(title) : '') + '},',
    ' pdfkeywords={' + plain(firstLine(keywordList(doc, 'KEYWORDS').join(', '))) + '},',
    ' pdfsubject={' + plain(firstLine(keywordList(doc, 'DESCRIPTION').join(' '))) + '},',
    ' pdfcreator={Org Mode PWA}, ',
    ' pdflang={' + (LANGUAGES[lang] || 'English') + '}}',
    ...(cited && S.processor === 'natbib' ? ['\\usepackage{natbib}'] : []),
    ...(cited && S.processor === 'biblatex' ? ['\\usepackage{biblatex}', ...bibFiles.map((f) => '\\addbibresource{' + f + '}')] : []),
    '\\begin{document}',
    '',
  ];
  if (title) head.push('\\maketitle');
  if (options.toc) {
    if (typeof options.toc === 'number') head.push('\\setcounter{tocdepth}{' + options.toc + '}');
    head.push('\\tableofcontents', '');
  }

  // a section with nothing to write still keeps the blank lines that followed its keywords (Org counts them as the elements' post-blank)
  const zeroth = elements(parsedLines(preamble));
  const body = (zeroth === '' ? '\n'.repeat(preamble.filter((l) => !l.trim()).length) : zeroth) + headings(roots, ctx, base);
  return head.join('\n') + '\n' + (body ? trimEnd(body) : '') + '\\end{document}\n';
}

/** The exported headings as a tree of copies, for the citation scan. @param {Heading[]} roots @param {(h: Heading) => boolean} skip @returns {Heading[]} */
function exportedTree(roots, skip) {
  return roots.filter((h) => !skip(h)).map((h) => ({ ...h, children: exportedTree(h.children || [], skip) }));
}

/** Is there a citation anywhere in what is exported? @param {string[]} preamble @param {Heading[]} roots @param {(h: Heading) => boolean} skip */
function hasCitations(preamble, roots, skip) {
  return [preamble, ...collectBodies(roots, skip)].some((lines) => lines.some((l) => /\[cite(?:\/[^:\]]*)?:/.test(l)));
}

/** The pictures the last export linked, as written in the links, for bundling them with the .tex file. @param {Doc} doc @param {Heading | null} [scope] */
export function latexImageTargets(doc, scope = null) {
  exportToLatex(doc, scope);
  return [...S.imageTargets];
}

/** @param {Heading[]} children @param {(h: Heading) => boolean} skip @returns {string[][]} */
function collectBodies(children, skip) {
  /** @type {string[][]} */
  const out = [];
  for (const h of children) {
    if (skip(h)) continue;
    out.push(h.bodyLines || []);
    out.push(...collectBodies(h.children || [], skip));
  }
  return out;
}
