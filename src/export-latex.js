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
 * Beamer export (`exportToBeamer`, ox-beamer) is this exporter with `beamer` set: frames, blocks and columns from the headings' `BEAMER_*`
 * properties, the theme keywords, overlays, and `\alert` for bold text; export-beamer.js holds its parts that need no export state.
 *
 * Not yet: line numbers and references in source blocks, custom language environments, `engraved`.
 */

import { foldInlineTasks, inlineTaskInfo, INLINE_TASK_BLOCK } from './inline-tasks.js';
import { newCodeCounter, codeStart, unravelCode, resolveCodeRef, coderefText, blockSwitchText, formatCodePlain } from './code-lines.js';
import { parseElements, parseAttributes } from './org-elements.js';
import { parseInline } from './inline-markup.js';
import { parseExportOptions, rawExportOptions, getDocTitle, getDocAuthor, getDocDate } from './export-options.js';
import { brokenPathOf, brokenLinkText, finishDropped } from './broken-links.js';
import { quoteStatuses, smartQuotes } from './smart-quotes.js';
import { linkAbbreviations, expandAbbreviation } from './link-abbrev.js';
import { preambleBody, parseHtmlOptions, buildFilter } from './export-html.js';
import { resolveTodoSequence } from './todo-cycle.js';
import { expandMacrosForExport } from './export-org.js';
import { LATEX_ENTITIES } from './entities-latex.js';
import { latexTable } from './latex-table.js';
import { natbibCitation, biblatexCitation } from './latex-cite.js';
import { bibliographyFiles, citeDefaults, citeExportFor, citeExportSetting } from './cite.js';
import { radioTargetRegExp } from './targets.js';
import { latexConfig } from './latex-config.js';
import * as bm from './export-beamer.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').InlineNode} InlineNode */
/** @typedef {import('./org-elements.js').OrgElement} OrgElement */
/** @typedef {{ label: string, title: string, heading?: Heading }} HeadingRef */
/** @typedef {import('./cite.js').CitationNode} CitationNode */
/**
 * @typedef {{
 *   sup: string,
 *   broken: import('./broken-links.js').BrokenLinks,
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
 *   beamer: boolean,
 *   withToc: number | boolean | undefined,
 *   snippets: { backend: string, value: string, lead: boolean }[],
 *   abbreviations: Map<string, string>,
 *   inHeadline: boolean,
 *   language: string,
 *   enumDepth: number,
 *   fnCount: number, fnDepth: number, inTable: number, delayed: string[],
 *   opts: ReturnType<typeof parseHtmlOptions>, raw: Record<string, string>, unnumbered: Set<Heading>,
 * }} LatexState
 */

/** Marks a forced line break (`\\` at the end of a line) through the inline parser. */
const BREAK = '\uE000';
/** Stand for an `@@backend:value@@` snippet while the text goes through the inline parser; `S.snippets` holds what they stand for. */
const SNIPPET_OPEN = String.fromCharCode(0xe001);
const SNIPPET_CLOSE = String.fromCharCode(0xe002);
/** A snippet, or a code or verbatim span (whose text is left alone, snippets in it included). */
const SNIPPET_OR_CODE_RE = /(?<![\w])([~=])\S(?:[^\n]*?\S)?\1(?![\w])|@@([A-Za-z0-9-]+):((?:[^@]|@(?!@))*)@@|\bsrc_([A-Za-z0-9_-]+)(?:\[([^\]\n]*)\])?\{([^}\n]*)\}/g;
const LINE_BREAK_RE = /\\\\[ \t]*$/;
/** A LaTeX command written in the text (`\textbf{x}`, `\alpha`, `\-`) goes through as written, like Org does. */
const COMMAND_RE = /\\(?:[A-Za-z]+\*?(?:\{[^{}\n]*\}|\[[^\][{}\n]*\])*|-)|\\_ +/g;
/** An entity is `\\name`, with an empty `{}` allowed after it: `\\alpha{}beta`. */
const ENTITY_RE = /\\(there4|sup[123]|frac[13][24]|[A-Za-z]+)(\{\})?/y;
const TIMESTAMP_RE = /([<[])(\d{4}-\d{2}-\d{2})(?: ([^\s\d>\]+-]+))?(?: (\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?)?((?: [.+]?\+\d+[hdwmy](?:\/\d+[hdwmy])?| -\d+[hdwmy])*)([>\]])(?:--([<[])(\d{4}-\d{2}-\d{2})(?: ([^\s\d>\]+-]+))?(?: (\d{1,2}:\d{2}))?([>\]]))?|(<%%\([^\n]*?\)>)/g;

/** @type {LatexState} */
let S = newState();

/** @returns {LatexState} */
function newState() {
  return { sup: 't', broken: 'nil', footnotes: new Map(), footnoteLabels: new Map(), footnoteRefs: new Map(), targets: new Map(), labels: new Map(), radioRe: null, processor: 'basic', cite: null, images: new Map(), imageTargets: [], current: null, base: 0, localToc: new Set(), anon: 0, inLink: false, parsed: new Map(), codeCounter: newCodeCounter(), codeBlocks: [], cfg: latexConfig(undefined), beamer: false, withToc: undefined, snippets: [], enumDepth: 0, fnCount: 0, fnDepth: 0, inTable: 0, delayed: [], opts: parseHtmlOptions(/** @type {import('./types.js').Doc} */ (/** @type {unknown} */ ({ keywords: [], children: [] }))), raw: {}, unnumbered: new Set(), abbreviations: new Map(), inHeadline: false, language: 'en' };
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

/** A path inside `\\url{}` or `\\href{}`: each LaTeX special character gets a backslash. @param {string} s */
const protectUrl = (s) => s.replace(/[\\{}$%&_#~^]/g, (c) => '\\' + c);

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
    if (entity && !S.opts.entities) {
      out += plainPiece(m[0]); // e:nil: an entity is text, other commands still pass
      last = start + m[0].length;
    } else if (entity) {
      out += entity.text;
      last = entity.end;
    } else if (S.raw.tex === 'nil') {
      last = start + m[0].length + (/^[ \t]*/.exec(s.slice(start + m[0].length)) || [''])[0].length; // tex:nil leaves the command out, with the blanks after it
    } else if (S.raw.tex === 'verbatim') {
      out += plainPiece(m[0]);
      last = start + m[0].length;
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
    const [whole, open, date, day, from, to, repeat, close, open2, date2, day2, time2, close2, sexp] = m;
    const start = m.index || 0;
    out += plain(s.slice(last, start));
    const at = (/** @type {string} */ o, /** @type {string} */ d, /** @type {string | undefined} */ dy, /** @type {string | undefined} */ t, /** @type {string} */ c, /** @type {string} */ rep) => o + d + (dy ? ' ' + dy : '') + (t ? ' ' + t : '') + rep + c;
    let body;
    if (sexp) body = sexp;
    else if (to) body = at(open, date, day, from, close, repeat) + '--' + at(open, date, day, to, close, repeat);
    else if (date2) body = at(open, date, day, from, close, repeat) + '--' + at(open2, date2, day2, time2, close2, '');
    else body = whole;
    const end = start + whole.length;
    const format = open === '<' || sexp ? S.cfg.vars.activeTimestamp : S.cfg.vars.inactiveTimestamp;
    out += format.replace(/%s/g, () => protect(body) + (/^[ \t]*/.exec(s.slice(end)) || [''])[0]); // the blanks after it are in the box and in the text, as Org writes them
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
  const marked = text
    .split('\n')
    .map((l) => (LINE_BREAK_RE.test(l) ? l.replace(LINE_BREAK_RE, BREAK) : l))
    .join('\n')
    .replace(SNIPPET_OR_CODE_RE, (whole, _delim, backend, value, srcLang, srcHeader, srcCode, at, all) => {
      if (srcLang !== undefined) {
        // inline source code: the code in `\texttt` when `:exports` says `code` or `both`; the default for it is `results`, which shows nothing without a run
        const shown = /(?:^|\s):exports\s+(code|both)(?:\s|$)/.test(srcHeader || '');
        return SNIPPET_OPEN + (S.snippets.push({ backend: 'src', value: shown ? '\\texttt{' + protectTexttt(srcCode) + '}' : '', lead: false }) - 1) + SNIPPET_CLOSE;
      }
      if (backend === undefined) return whole;
      // an overlay specification that opens its text, or an emphasis or link in it, belongs to the element and is not written itself
      const opens = at === 0 || (all[at - 1] === '[' && all[at - 2] === ']') || (/[*/_+=~]/.test(all[at - 1]) && (at === 1 || /[\s(['"{-]/.test(all[at - 2])));
      return SNIPPET_OPEN + (S.snippets.push({ backend: backend.toLowerCase(), value, lead: opens && /^<.*>$/s.test(value) }) - 1) + SNIPPET_CLOSE;
    });
  return adaptImages(parseInline(marked, { subSuperscriptMode: S.sup, radioTargets: S.radioRe }));
}

const LATEX_DROPPED = String.fromCharCode(0xe004);

/** @param {InlineNode[]} list */
function nodes(list) {
  const quotes = S.raw["'"] === 't' ? quoteStatuses(list) : null; // #+OPTIONS: ':t
  const out = list.map((n) => {
    const written = node(n);
    const status = quotes && quotes.get(n);
    return status && (written.match(/['"]/g) || []).length === status.length ? smartQuotes(written, status, S.language) : written;
  });
  // a fragment left out (tex:nil) takes the blanks after it with it
  return out.map((t, i) => (i > 0 && out[i - 1] === LATEX_DROPPED ? t.replace(/^[ \t]+/, '') : t)).join('').split(LATEX_DROPPED).join('');
}

/** @param {string} url */
const isExternal = (url) => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url) && !/^(file|id|help|elisp|shell|attachment|news|irc|file\+sys|file\+emacs):/i.test(url);

/** Text in one of Org's markups, as `org-latex-text-markup-alist` writes it: a format with `%s`, `verb` (`\verb` between a character the text lacks),
 * `protectedtexttt`, or the bare text when the markup has no entry. Code and verbatim text is the value as written, not escaped. @param {string} kind @param {string} text */
function markup(kind, text) {
  const fmt = S.cfg.vars.textMarkup.get(kind);
  if (kind === 'underline' && S.inHeadline && fmt !== undefined) return '\\underline{' + text + '}';
  if (fmt === undefined) return text;
  if (fmt === 'protectedtexttt') return '\\texttt{' + protectTexttt(text) + '}';
  if (fmt === 'verb') {
    const sep = [...'~,./?;\':|!@#%^&-_=+'].find((c) => !text.includes(c));
    return sep ? '\\verb' + sep + text + sep : '\\texttt{' + protectTexttt(text) + '}';
  }
  return fmt.replace(/%s/g, () => text);
}

/** @param {InlineNode} n @returns {string} */
function node(n) {
  switch (n.type) {
    case 'text':
      return textWithTimestamps(n.value);
    case 'bold': {
      if (!S.opts.emph) return '*' + nodes(n.children) + '*';
      if (!S.beamer) return markup('bold', nodes(n.children));
      const lead = snippetOverlay(n.children[0]);
      return '\\alert' + (lead ? lead.overlay : '') + '{' + nodes(lead ? [lead.node, ...n.children.slice(1)] : n.children) + '}';
    }
    case 'italic':
      return S.opts.emph ? markup('italic', nodes(n.children)) : '/' + nodes(n.children) + '/';
    case 'underline':
      return S.opts.emph ? markup('underline', nodes(n.children)) : '\\_' + nodes(n.children) + '\\_';
    case 'strikethrough':
      return S.opts.emph ? markup('strike-through', nodes(n.children)) : '+' + nodes(n.children) + '+';
    case 'code':
    case 'verbatim':
      return markup(n.type, n.value);
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
      return S.beamer ? '\\hypertarget{' + targetLabel(n.name, true) + '}{' + plain(n.name) + '}' : '\\label{' + targetLabel(n.name, true) + '}' + plain(n.name);
    case 'image':
      return '\\begin{center}\n' + includeGraphics(n.target, {}) + '\n\\end{center}';
    case 'citation':
      return citation(n);
    default:
      return '';
  }
}

/** What an `@@backend:value@@` snippet writes: its value for `latex` (and `beamer` in a Beamer export), nothing for the others. @param {{ backend: string, value: string, lead: boolean }} snippet */
function snippetText(snippet) {
  if (snippet.backend === 'src') return snippet.value;
  if (snippet.lead && snippet.backend === 'beamer') return '';
  return snippet.backend === 'latex' || (S.beamer && snippet.backend === 'beamer') ? snippet.value : '';
}

/** A text node that starts with `@@beamer:<spec>@@`: the overlay specification and the node without it, or null. @param {InlineNode | undefined} first */
function snippetOverlay(first) {
  if (!first || first.type !== 'text') return null;
  const m = new RegExp('^' + SNIPPET_OPEN + '(\\d+)' + SNIPPET_CLOSE).exec(first.value);
  const snippet = m && S.snippets[Number(m[1])];
  if (!m || !snippet || snippet.backend !== 'beamer' || !snippet.lead) return null;
  return { overlay: snippet.value, node: /** @type {InlineNode} */ ({ ...first, value: first.value.slice(m[0].length) }) };
}

/** Text that starts with a hidden `@@beamer:<spec>@@`: its overlay specification, or null. @param {string} text */
function leadingPlaceholder(text) {
  const m = new RegExp('^' + SNIPPET_OPEN + '(\\d+)' + SNIPPET_CLOSE).exec(text);
  const snippet = m && S.snippets[Number(m[1])];
  return snippet && snippet.backend === 'beamer' && snippet.lead ? snippet.value : null;
}

/** A name compared without case or runs of blanks, as targets are. @param {string} name */
const norm = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** @param {string} name */
const targetLabel = (name, radio = false) => (S.cfg.vars.preferUserLabels && !radio ? name : 'org' + hash7('target:' + norm(name)));

/** A label for a named element: the name itself with `org-latex-prefer-user-labels`, else `prefix` and `org` and a hash of it. @param {string} name @param {string} [prefix] */
const nameLabel = (name, prefix = '') => (S.cfg.vars.preferUserLabels ? name : prefix + 'org' + hash7('name:' + name));

/** Math is passed through as written; `$x$` becomes `\(x\)`. @param {Extract<InlineNode, { type: 'latex' }>} n */
function latexFragment(n) {
  if (S.raw.tex === 'nil') return LATEX_DROPPED;
  if (S.raw.tex === 'verbatim') return plain(n.raw || (n.displayMode ? '\\[' + n.source + '\\]' : '\\(' + n.source + '\\)'));
  if (n.raw && !/^\$[^$]/.test(n.raw)) return n.raw;
  return n.displayMode ? '\\[' + n.source + '\\]' : '\\(' + n.source + '\\)';
}

/** `\ref` for a link with no description, `\hyperref` for one with (`\hyperlink` in Beamer, with the overlay if it has one). @param {string} label @param {string | null} description @param {string} [overlay] */
const reference = (label, description, overlay = '') => (description === null ? '\\ref{' + label + '}' : S.beamer ? '\\hyperlink' + overlay + '{' + label + '}{' + description + '}' : '\\hyperref[' + label + ']{' + description + '}');

/** The thing an internal link points to, or null: a custom id, an id, a headline (`*Title`), or what a bare name matches
 * (a target, a named element, a headline title, in that order). @param {string} target @returns {HeadingRef | null} */
function resolveInternal(target) {
  if (target.startsWith('#') || /^id:/i.test(target)) return S.targets.get(target.replace(/^ID:/i, 'id:')) || null;
  if (target.startsWith('*')) return S.targets.get('head:' + target.slice(1).trim()) || null;
  const bare = target.replace(/^file:/i, '');
  return S.targets.get('target:' + norm(bare)) || S.targets.get('name:' + bare) || S.targets.get('head:' + bare) || null;
}

/** @param {Extract<InlineNode, { type: 'link' }>} n */
function link(n) {
  const target = expandAbbreviation(n.target, S.abbreviations);
  if (S.inLink) return protect(n.description === null ? target : n.description);
  if (n.radio) {
    const ref = S.targets.get('target:' + norm(target));
    return ref ? reference(ref.label, protect(n.description || target)) : protect(n.description || target);
  }
  const coderef = /^\((.*)\)$/.exec(target);
  if (coderef) {
    const found = resolveCodeRef(S.codeBlocks, coderef[1]);
    if (found === null) return protect(brokenLinkText(S.broken, coderef[1]));
    return inline(coderefText(coderef[1], found, n.description || null));
  }
  const lead = S.beamer && n.description !== null ? leadingPlaceholder(n.description) : null;
  S.inLink = true;
  const description = n.description === null ? null : inline(n.description);
  S.inLink = false;
  if (/^file(\+sys|\+emacs)?:/i.test(target) || (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) && /^(\.{0,2}\/|~\/)/.test(target))) {
    let path = target.replace(/^file(?:\+sys|\+emacs)?:(\/\/)?/i, '').replace(/::.*$/, '');
    if (path.startsWith('/')) path = 'file://' + path;
    return description === null ? '\\url{' + protectUrl(path) + '}' : '\\href{' + protectUrl(path) + '}{' + description + '}';
  }
  if (/^(elisp|shell|news|help|irc):/i.test(target)) {
    const rest = target.replace(/^[a-z+]+:/i, '');
    return description === null ? '\\url{' + protectUrl(rest) + '}' : '\\href{' + protectUrl(rest) + '}{' + description + '}';
  }
  if (isExternal(target)) return description === null ? '\\url{' + protectUrl(target) + '}' : '\\href{' + protectUrl(target) + '}{' + description + '}';
  const ref = resolveInternal(target);
  if (ref) return reference(ref.label, description, lead || '');
  const path = brokenPathOf(target);
  if (path !== null) return protect(brokenLinkText(S.broken, path));
  return description === null ? protect(target) : description;
}

// ---- pictures -------------------------------------------------------------

/** Is this link target a picture LaTeX can take (`org-latex-inline-image-rules`: pdf, jpeg, jpg, png, ps, eps, tikz, pgf, svg), as a file or an https address? @param {string} target */
const latexImageTarget = (target) => /^(file:|attachment:|https:\/\/|\.{0,2}\/|~\/)/i.test(target) && /\.(pdf|jpe?g|png|ps|eps|tikz|pgf|svg)$/i.test(target.replace(/::.*$/, ''));

/** Pictures by LaTeX's list, not the parser's: other picture types become plain links, and a link to a pdf, eps, tikz or pgf file a picture. @param {InlineNode[]} list @returns {InlineNode[]} */
function adaptImages(list) {
  return list.map((n) => {
    if (n.type === 'image' && !latexImageTarget(n.target)) return /** @type {InlineNode} */ ({ type: 'link', target: n.target, description: null });
    if (n.type === 'link' && n.description === null && !n.radio && latexImageTarget(n.target)) return /** @type {InlineNode} */ ({ type: 'image', target: n.target });
    return n;
  });
}

/**
 * The picture itself, as `org-latex--inline-image` writes it: `\includegraphics` (`\includesvg` for svg, `\resizebox` or `\scalebox` around
 * `\input` for tikz and pgf), with the options, then `:scale` or `:width` and `:height`, or the default width; a pdf takes `page=N` from `::N`.
 * @param {string} target @param {Record<string, string>} attrs @param {boolean} [wrap]
 */
function includeGraphics(target, attrs, wrap = false) {
  let path = target.replace(/^file:(\/\/)?/i, '');
  if (!S.imageTargets.includes(target)) S.imageTargets.push(target);
  path = S.images.get(target) || path;
  const search = /::(.*)$/.exec(path);
  path = path.replace(/::.*$/, '');
  const ext = ((/\.([A-Za-z0-9]+)$/.exec(path) || [])[1] || '').toLowerCase();
  const own = (attrs.options || '').replace(/^\[(.*)\]$/, '$1');
  const fit = [];
  if (attrs.scale) fit.push('scale=' + attrs.scale);
  else {
    if (attrs.width) fit.push('width=' + attrs.width);
    if (attrs.height) fit.push('height=' + attrs.height);
    if (!fit.length) fit.push(wrap ? 'width=0.48\\textwidth' : 'width=.9\\linewidth');
  }
  if (ext === 'tikz' || ext === 'pgf') {
    const inner = own ? '\\begin{tikzpicture}[' + own + ']\n\\input{' + path + '}\n\\end{tikzpicture}' : '\\input{' + path + '}';
    if (attrs.scale) return '\\scalebox{' + attrs.scale + '}{' + inner + '}';
    const w = attrs.width || (attrs.height ? '!' : wrap ? '0.48\\textwidth' : '.9\\linewidth');
    return '\\resizebox{' + w + '}{' + (attrs.height || '!') + '}{' + inner + '}';
  }
  const page = ext === 'pdf' && search && /^\d+$/.test(search[1]) ? ['page=' + search[1]] : [];
  const options = [...(own ? [own] : []), ...fit, ...page].join(',');
  if (ext === 'svg') return '\\includesvg[' + options + ']{' + path.replace(/\.svg$/i, '') + '}';
  return '\\includegraphics[' + options + ']{' + path + '}';
}

/** A picture that is a paragraph of its own: a figure when it has a caption, else centred; `#+ATTR_LATEX` sets the float.
 * @param {string} target @param {import('./org-elements.js').Affiliated | null | undefined} aff */
function pictureBlock(target, aff) {
  const attrs = parseAttributes(aff && aff.attr.latex);
  const caption = aff && aff.caption.length ? aff.caption[aff.caption.length - 1] : null;
  const name = aff && aff.name ? aff.name : null;
  const center = attrs.center === undefined ? S.cfg.vars.imagesCentered : attrs.center !== 'nil';
  const above = S.cfg.vars.captionAbove.has('image'); // org-latex-caption-above
  const floatAttr = attrs.float;
  const wrap = floatAttr === 'wrap';
  const floated = floatAttr === undefined ? !!caption : floatAttr !== 'nil';
  const label = name ? nameLabel(name, caption ? 'fig:' : '') : '';
  const picture = includeGraphics(target, attrs, wrap);
  const captionText = caption ? inline(caption.text) : '';
  const labelText = label ? '\\label{' + label + '}' : '';
  if (!floated) {
    const captionOf = caption ? '\\captionof{figure}{' + labelText + captionText + '}' : labelText;
    if (!center) return caption ? (above ? captionOf + '\n' + picture + captionOf : picture) + '\n' : picture + (label ? '\n' + labelText : '') + '\n'; // as Emacs writes it
    return '\\begin{center}\n' + (above && captionOf ? captionOf + '\n' : '') + picture + (above || !captionOf ? '' : '\n' + captionOf) + '\n\\end{center}\n';
  }
  const env = wrap ? 'wrapfigure' : floatAttr === 'sideways' ? 'sidewaysfigure' : floatAttr === 'multicolumn' ? 'figure*' : 'figure';
  const placement = attrs.placement || (wrap ? '{l}{0.5\\textwidth}' : env === 'sidewaysfigure' || env === 'figure*' ? '' : '[' + S.cfg.vars.figurePosition + ']');
  const written = caption ? '\\caption' + (caption.short ? '[' + inline(caption.short) + ']' : '') + '{' + labelText + captionText + '}' : labelText;
  const lines = ['\\begin{' + env + '}' + placement];
  if (written && above) lines.push(written);
  lines.push(center ? '\\centering' : '');
  lines.push(picture);
  if (written && !above) lines.push(written);
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

/**
 * A footnote's text where it is referenced: `\footnote{text}`; inside a table cell or another footnote LaTeX cannot take that, so there it is
 * `\footnotemark` and the text follows as `\footnotetext[number]{..}` after the table or the footnote (ox-latex's delayed footnotes).
 * @param {string} id @param {() => string} produce @param {boolean} label  whether a `\label` goes in a plain footnote
 */
function footnoteText(id, produce, label) {
  const number = ++S.fnCount;
  const nested = S.inTable > 0 || S.fnDepth > 0;
  const outer = S.delayed;
  S.delayed = [];
  S.fnDepth++;
  const text = produce();
  S.fnDepth--;
  const inner = S.delayed;
  S.delayed = outer;
  if (nested) {
    S.delayed.push('\\footnotetext[' + number + ']{\\label{' + id + '}' + text + '}', ...inner);
    return '\\footnotemark';
  }
  return '\\footnote{' + text + (label ? '\\label{' + id + '}' : '') + '}' + inner.join('');
}

/** @param {string | null} label @param {InlineNode[] | null} inlineDef */
function footnoteRef(label, inlineDef) {
  if (!S.opts.footnotes) return '';
  if (inlineDef) return footnoteText('org' + hash7('fn:inline' + (S.fnCount + 1)), () => nodes(inlineDef), false);
  if (label === null) return '';
  const known = S.footnoteLabels.get(label);
  if (known) return '\\textsuperscript{\\ref{' + known + '}}';
  const def = S.footnotes.get(label);
  if (!def) return '';
  const id = 'org' + hash7('fn:' + label);
  S.footnoteLabels.set(label, id);
  return footnoteText(id, () => elements(def).replace(/\n+$/, ''), (S.footnoteRefs.get(label) || 0) > 1); // a label only when a later reference needs it
}

// ---- elements -------------------------------------------------------------

/** @param {string[]} lines */
function parsedLines(lines, text = lines) {
  let parsed = S.parsed.get(lines);
  if (!parsed) {
    parsed = parseElements(text);
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

/** `\\n:t`: every line of a paragraph ends in a forced break, `\\\\[0pt]`. @param {string} text */
const preserveBreaks = (text) => (S.opts.brk ? text.replace(/[ \t]*\n/g, (m, at, all) => (all.slice(0, at).endsWith('\\\\[0pt]') ? m.replace(/^[ \t]+/, '') : '\\\\[0pt]\n')) : text);

/** @param {string} s */
const trimEnd = (s) => s.replace(/\n+$/, '') + '\n';

/** @param {OrgElement} el @returns {string} */
function element(el) {
  switch (el.type) {
    case 'paragraph': {
      const parsed = parseText([el.lines[0].trimStart(), ...el.lines.slice(1)].join('\n'));
      const content = parsed.filter((x) => !(x.type === 'text' && !x.value.trim()));
      if (content.length === 1 && content[0].type === 'image') return pictureBlock(content[0].target, el.aff);
      return preserveBreaks(nodes(parsed) + '\n');
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
      if (S.beamer && /\bheadlines\b/.test(el.value)) {
        if (/\blocal\b/.test(el.value) && S.current) S.localToc.add(S.current); // the section it is in ends with \stopcontents, as ox-latex has it
        return bm.tocLines(el.value, S.withToc);
      }
      return tocKeyword(el.value);
    case 'beamer-line':
      return S.beamer ? el.value + '\n' : '';
    case 'print-bibliography':
      return bibliography();
    case 'hr':
      return '\\noindent\\rule{\\textwidth}{0.5pt}\n';
    case 'latex-env':
      return S.raw.tex === 'nil' ? '' : S.raw.tex === 'verbatim' ? plain(el.lines.join('\n')) + '\n' : latexEnvironment(el);
    case 'latex-line':
      return el.value + '\n';
    case 'index':
      return '\\index{' + el.value.trim() + '}\n';
    case 'drawer': {
      const d = S.opts.drawers;
      const name = el.name.toUpperCase();
      const shown = d.all || (d.include ? d.include.some((/** @type {string} */ x) => x.toUpperCase() === name) : !(d.exclude || []).some((/** @type {string} */ x) => x.toUpperCase() === name));
      return !shown || name === 'PROPERTIES' ? '' : elements(parsedLines(el.lines));
    }
    default:
      return '';
  }
}

/** @param {string[]} lines */
function verbatim(lines) {
  return '\\begin{verbatim}\n' + lines.join('\n') + (lines.length ? '\n' : '') + '\\end{verbatim}\n';
}

/** Is this `\begin{..}` line one of the math environments whose label is `eq:..`? @param {string} line */
const isMathEnv = (line) => /^\s*\\begin\{(?:equation|align|alignat|gather|multline|flalign|eqnarray|displaymath|math|subequations)\*?\}/i.test(line);

/** A `\begin{env}` block as written; a named one gets its label inside: after the first line for math environments (`eq:`), before the last for others. @param {Extract<OrgElement, { type: 'latex-env' }>} el */
function latexEnvironment(el) {
  const lines = el.lines.slice();
  const name = el.aff && el.aff.name;
  if (name && lines.length > 1) {
    if (isMathEnv(lines[0])) lines.splice(1, 0, '\\label{' + nameLabel(name, 'eq:') + '}');
    else lines.splice(lines.length - 1, 0, '\\label{' + nameLabel(name) + '}');
  }
  return lines.join('\n') + '\n';
}

/** The label Org puts before a named block that is not a table or a picture. @param {OrgElement} el */
function namedLabel(el) {
  return el.aff && el.aff.name ? '\\phantomsection\n\\label{' + nameLabel(el.aff.name) + '}\n' : '';
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

/** The lines of a block with the indentation they share removed. @param {string[]} lines */
function unindented(lines) {
  const lead = Math.min(Infinity, ...lines.filter((l) => l.trim()).map((l) => (/^[ \t]*/.exec(l) || [''])[0].length));
  return lines.map((l) => l.slice(Number.isFinite(lead) ? Math.min(lead, (/^[ \t]*/.exec(l) || [''])[0].length) : 0));
}

/** The elements inside a quote, center or special block, parsed once so the scan for code references and the export see the same objects. @param {string[]} lines */
function bodyElements(lines) {
  return parsedLines(lines, unindented(lines));
}

/** @param {Extract<OrgElement, { type: 'block' }>} el */
function block(el) {
  const lines = unindented(el.lines);
  const attrs = parseAttributes(el.aff && el.aff.attr.latex);
  const wrapIn = (/** @type {string} */ env, /** @type {string} */ options) => {
    const standard = el.name === 'quote' || el.name === 'center'; // the label of these goes in front, that of a special block inside it
    const label = el.aff && el.aff.name ? '\\label{' + nameLabel(el.aff.name) + '}\n' : '';
    return (standard ? namedLabel(el) : '') + '\\begin{' + env + '}' + options + '\n' + trimEnd(elements(bodyElements(el.lines))) + (standard ? '' : label) + '\\end{' + env + '}\n';
  };
  switch (el.name) {
    case 'src':
    case 'example': {
      const code = prepareCode(el);
      const raw = formatCodePlain(code, code.start);
      if (!raw.some((l) => l.trim())) return ''; // a block with nothing in it writes nothing
      if (attrs.environment) return namedLabel(el) + '\\begin{' + attrs.environment + '}\n' + raw.join('\n') + '\n\\end{' + attrs.environment + '}\n';
      const coded = el.name === 'src' ? codeBlock(el, code, attrs) : null;
      if (coded !== null) return coded;
      const caption = el.name === 'src' && el.aff && el.aff.caption.length ? el.aff.caption[el.aff.caption.length - 1] : null;
      const captionOf = caption ? '\\captionof{figure}{' + inline(caption.text) + '}\n' : '';
      const captionAbove = S.cfg.vars.captionAbove.has('src-block');
      return (el.name === 'example' ? namedLabel(el) : '') + (captionAbove ? captionOf : '') + verbatim(raw) + (captionAbove ? '' : captionOf);
    }
    case 'comment':
      return '';
    case 'export':
      return /^latex\b/i.test(el.params) ? lines.join('\n') + '\n' : '';
    case INLINE_TASK_BLOCK:
      return inlineTask(el);
    case 'verse':
      return namedLabel(el) + '\\begin{verse}\n' + lines.map(verseLine).join('') + '\\end{verse}\n';
    default:
      if (el.name === 'quote') return wrapIn(attrs.environment || 'quote', attrs.options || '');
      if (el.name === 'center') return wrapIn('center', '');
      return wrapIn(el.rawName || el.name, attrs.options || ''); // a special block keeps the case it was written in
  }
}

/** An inline task as `org-latex-inlinetask` sets it: a framed minipage, the title over a rule over the contents. @param {Extract<OrgElement, { type: 'block' }>} el */
function inlineTask(el) {
  const info = inlineTaskInfo(el.params);
  const contents = trimEnd(elements(bodyElements(el.lines)));
  const title = (info.todo ? '\\textbf{\\textsf{\\textsc{' + protect(info.todo) + '}}} ' : '') + inline(info.title) + (info.tags.length ? '\\hfill{}\\textsc{:' + info.tags.map(protect).join(':') + ':}' : '');
  const inner = contents.trim() ? title + '\n\n\\rule[.8em]{\\linewidth}{2pt}\n\n' + contents : title + '\n\n';
  return '\\begin{center}\n\\fbox{\n\\begin{minipage}[c]{.6\\linewidth}\n' + inner + '\\end{minipage}\n}\n\\end{center}\n';
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
  const label = name ? nameLabel(name, 'lst:') : '';
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
  const attrs = S.beamer ? { ...parseAttributes(el.aff && el.aff.attr.latex), ...parseAttributes(el.aff && el.aff.attr.beamer) } : parseAttributes(el.aff && el.aff.attr.latex);
  const env = attrs.environment || (el.listType === 'ordered' ? 'enumerate' : el.listType === 'descriptive' ? 'description' : 'itemize');
  if (el.listType === 'ordered') S.enumDepth++; // the counter is the one for the nesting of numbered lists, whatever lies between them
  const counter = ['enumi', 'enumii', 'enumiii', 'enumiv'][Math.max(1, Math.min(S.enumDepth, 4)) - 1];
  let out = '\\begin{' + env + '}' + (S.beamer ? bm.listOverlay(attrs.overlay) : '') + (attrs.options || '') + '\n';
  for (const item of el.items) {
    if (item.counter !== null) out += '\\setcounter{' + counter + '}{' + (item.counter - 1) + '}\n';
    const box = item.checkbox === null ? '' : ({ off: '$\\square$', on: '$\\boxtimes$', trans: '$\\boxminus$' }[item.checkbox] || '');
    let head = '\\item';
    let children = item.children;
    const first = children[0];
    const lead = S.beamer && first && first.type === 'paragraph' ? bm.leadingOverlay(first.lines[0].trimStart()) : null;
    if (lead && first && first.type === 'paragraph') {
      head += lead.overlay; // `- @@beamer:<2>@@ text` is `\item<2> text`
      children = [{ ...first, lines: [lead.rest.trimStart(), ...first.lines.slice(1)] }, ...children.slice(1)];
    }
    const plainHead = head;
    if (el.listType === 'descriptive' || item.tag) {
      const tag = inline(item.tag || '');
      if (tag || box) head += '[{' + (box && tag ? box + ' ' + tag : box || tag) + '}]';
    }
    else if (box) head += '[{' + box + '}]';
    const body = itemBody(children, depth, item === el.items[el.items.length - 1]) + '\n'.repeat(item.postBlank || 0);
    if (head === plainHead && body.startsWith('[')) head += '\\relax'; // text that starts with a bracket is not read as the item's option
    out += head + (body.startsWith('\\begin{') ? '\n' : ' ') + body;
  }
  if (el.listType === 'ordered') S.enumDepth--;
  return namedLabel(el) + out + '\\end{' + env + '}\n';
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
  const label = el.aff && el.aff.name ? '\\label{' + nameLabel(el.aff.name, 'tab:') + '}' : '';
  S.inTable++;
  const outer = S.delayed;
  S.delayed = [];
  const written = latexTable(el, { cell: inline, caption: caption ? { short: caption.short ? inline(caption.short) : null, text: inline(caption.text) } : null, label, vars: S.cfg.vars });
  S.inTable--;
  const footnotes = S.delayed.join('');
  S.delayed = outer;
  return footnotes ? written.replace(/\n$/, footnotes + '\n') : written; // the footnote texts of the cells follow the table
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
  const keep = buildFilter(/** @type {import("./export-html.js").ExportState} */ (/** @type {unknown} */ ({ doc, options: S.opts, doneKeywords: resolveTodoSequence(doc).doneKeywords }))); // COMMENT, #+EXCLUDE_TAGS:, #+SELECT_TAGS:, tasks:
  return (/** @type {Heading} */ h) => !keep(h) || (S.opts.arch === false && h.tags.includes('ARCHIVE')) || (footnoteSection && h.title.trim() === 'Footnotes'); // Org keeps its footnote section out of the export
}

/** @param {Heading} h */
function headingTitle(h) {
  const todo = h.todo && S.opts.todo ? '{\\bfseries\\sffamily ' + protect(h.todo) + '} ' : '';
  const priority = S.opts.pri && h.priority ? '\\framebox{\\#' + protect(h.priority) + '} ' : '';
  const tags = h.tags.length && S.opts.tags !== false ? '\\hfill{}\\textsc{' + h.tags.map(protect).join(':') + '}' : '';
  S.inHeadline = true; // underlined text in a headline is \underline, which a section title can hold
  const title = inline(S.opts.stat ? h.title : h.title.replace(/\[(?:\d*%|\d*\/\d*)\]/g, ''));
  S.inHeadline = false;
  return todo + priority + title + tags; // stat:nil drops the [1/3] cookie
}

/**
 * @typedef {{ doc: Doc, cls: import('./latex-config.js').LatexClass, depth: number, numbered: boolean, numDepth: number | null, skip: (h: Heading) => boolean, path: number[], parents: Heading[] }} HeadingCtx
 */

/** @param {Heading[]} children @param {HeadingCtx} ctx @param {number} base */
function headings(children, ctx, base) {
  if (S.beamer) return beamerHeadings(children, ctx, base);
  const shown = children.filter((h) => !ctx.skip(h));
  let out = '';
  /** @type {Heading[]} */
  let run = [];
  const flush = () => {
    if (run.length) out += lowLevelList(run, ctx, base);
    run = [];
  };
  shown.forEach((h) => {
    if (h.level - base > ctx.depth || !sectionFormat(ctx, h.level - base, isNumbered(h, ctx, base))) {
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
  const fmt = /** @type {string} */ (sectionFormat(ctx, h.level - base, isNumbered(h, ctx, base)));
  const label = '\\label{' + labelFor(h, ctx) + '}\n';
  return formatSection(fmt, headingTitle(h), label + headingBody(h, ctx, base));
}

/** The class's way to write a heading of this relative level: a format with two `%s`, or null when the class has none (the heading becomes a list item). @param {HeadingCtx} ctx @param {number} level */
function sectionFormat(ctx, level, numbered = ctx.numbered) {
  const sec = ctx.cls.sections[level - 1];
  return sec ? (numbered ? sec.numbered : sec.unnumbered) : null;
}

/** Does the heading get a section number? Not with `num:nil`, below the `num:N` depth, or under an `:UNNUMBERED:` property. @param {Heading} h @param {HeadingCtx} ctx @param {number} base */
const isNumbered = (h, ctx, base) => ctx.numbered && !S.unnumbered.has(h) && (ctx.numDepth === null || h.level - base <= ctx.numDepth);

/** Lisp's `format` with a format that has two `%s` (and `%%`), given the title and what follows it. @param {string} fmt @param {string} title @param {string} rest */
function formatSection(fmt, title, rest) {
  let n = 0;
  const out = fmt.replace(/%([s%])/g, (_m, c) => (c === '%' ? '%' : n++ === 0 ? title : rest));
  return out.endsWith('\n') ? out : out + '\n'; // an element always ends with a line break
}

/** @param {Heading} h @param {HeadingCtx} ctx @param {number} base @param {boolean} [section]  false for what a Beamer frame, block or note holds (no `\stopcontents`, blank lines passed on) */
function headingBody(h, ctx, base, section = true) {
  if (S.opts.arch === 'headline' && h.tags.includes('ARCHIVE')) return ''; // an archived tree is just its headline
  const lines = h.bodyLines || [];
  let lead = 0;
  while (lead < lines.length && !lines[lead].trim()) lead++;
  if ((h.propertyOrder || []).length || Object.values(h.planning || {}).some(Boolean)) lead = 0; // Org drops the blank line after a property drawer or planning line
  S.current = h;
  const text = headingPreface(h) + elements(parsedLines(lines));
  // a Beamer frame or block with nothing but blank lines still passes them on, after its end
  const body = text ? '\n'.repeat(lead) + text : S.beamer && lead > 0 && lead === lines.length ? '\n'.repeat(section ? lead : lead + 1) : '';
  const children = headings(h.children || [], S.beamer ? { ...ctx, parents: [...ctx.parents, h] } : ctx, base);
  const stop = section && S.localToc.has(h) ? '\\stopcontents[level-' + (h.level - base) + ']\n' : '';
  return body + children + stop;
}

/** `p:t` writes a headline's planning line, `prop:t` its properties (as verbatim text), before its text. @param {Heading} h */
function headingPreface(h) {
  let out = '';
  const pl = h.planning;
  if (S.opts.planning && pl && (pl.closed || pl.deadline || pl.scheduled)) {
    const raw = (h.raw && h.raw.planning) || '';
    const part = (/** @type {string} */ kw, /** @type {string | null} */ ts) => {
      if (!ts) return '';
      const at = raw.indexOf(ts);
      const blanks = at >= 0 ? (/^[ \t]*/.exec(raw.slice(at + ts.length)) || [''])[0] : '';
      return '\\textbf{' + kw + ':} ' + textWithTimestamps(ts).replace(/\}$/, blanks + '}');
    };
    out += '\\noindent' + [part('CLOSED', pl.closed), part('DEADLINE', pl.deadline), part('SCHEDULED', pl.scheduled)].filter(Boolean).join(' ') + '\\\\[0pt]\n';
  }
  const want = S.raw.prop;
  if (want && want !== 'nil' && (h.propertyOrder || []).length) {
    const listed = want.startsWith('(') ? [...want.matchAll(/"([^"]*)"/g)].map((m) => m[1].toUpperCase()) : null;
    const keys = (h.propertyOrder || []).filter((k) => !listed || listed.includes(k.toUpperCase()));
    if (keys.length) out += verbatim(keys.map((k) => k + ': ' + (h.properties || {})[k]));
  }
  const d = S.opts.drawers;
  const logbookShown = d.all || (d.include ? d.include.some((/** @type {string} */ x) => x.toUpperCase() === 'LOGBOOK') : !(d.exclude || []).some((/** @type {string} */ x) => x.toUpperCase() === 'LOGBOOK'));
  if (logbookShown) for (const drawer of (h.raw && h.raw.drawers) || []) if (drawer.type === 'logbook') out += elements(parsedLines(drawer.lines.slice(1, -1))); // the parser keeps the LOGBOOK apart from the text
  return out;
}

/** A run of headings deeper than `H:` becomes one list; each item is the heading's title, its label and its text. @param {Heading[]} run @param {HeadingCtx} ctx @param {number} base */
function lowLevelList(run, ctx, base) {
  const env = isNumbered(run[0], ctx, base) ? 'enumerate' : 'itemize';
  let out = '\\begin{' + env + '}\n';
  for (const h of run) out += '\\item ' + headingTitle(h) + '\n\\label{' + labelFor(h, ctx) + '}\n' + headingBody(h, ctx, base);
  return out + '\\end{' + env + '}\n';
}

// ---- Beamer headings ------------------------------------------------------

const FRAME_ENVS = ['frame', 'fullframe'];

/** The first headline below `h` that is a frame by its environment, in document order. @param {Heading} h @param {(h: Heading) => boolean} skip @returns {Heading | null} */
function frameBelow(h, skip) {
  for (const c of h.children || []) {
    if (skip(c)) continue;
    if (FRAME_ENVS.includes(bm.envOf(c))) return c;
    const deeper = frameBelow(c, skip);
    if (deeper) return deeper;
  }
  return null;
}

/** The relative level at which headlines become frames in the tree around `h` (`org-beamer--frame-level`). @param {Heading} h @param {HeadingCtx} ctx @param {number} base */
function frameLevel(h, ctx, base) {
  for (const x of [h, ...[...ctx.parents].reverse()]) if (FRAME_ENVS.includes(bm.envOf(x))) return x.level - base;
  const below = frameBelow(h, ctx.skip);
  return below ? below.level - base : ctx.depth;
}

/** Does the text hold inline code or verbatim text? @param {string} text */
function textHasVerbatim(text) {
  /** @param {InlineNode[]} list @returns {boolean} */
  const walk = (list) => list.some((n) => n.type === 'code' || n.type === 'verbatim' || ('children' in n && Array.isArray(n.children) && walk(n.children)));
  return walk(parseInline(text, { subSuperscriptMode: S.sup, radioTargets: S.radioRe }));
}

/** Does the text of these lines hold what makes a frame fragile: code or example blocks, fixed-width text, inline code or verbatim text? @param {OrgElement[]} list @returns {boolean} */
function elementsHaveVerbatim(list) {
  return list.some((el) => {
    switch (el.type) {
      case 'fixed':
        return true;
      case 'block':
        return el.name === 'src' || el.name === 'example' || (el.name !== 'comment' && el.name !== 'export' && elementsHaveVerbatim(bodyElements(el.lines)));
      case 'paragraph':
        return textHasVerbatim(el.lines.join('\n'));
      case 'table':
        return el.rows.some((r) => !('rule' in r && r.rule) && 'cells' in r && r.cells.some(textHasVerbatim));
      case 'list':
        return el.items.some((it) => (it.tag ? textHasVerbatim(it.tag) : false) || elementsHaveVerbatim(it.children));
      case 'drawer':
        return !/^(PROPERTIES|LOGBOOK|CLOCK)$/i.test(el.name) && elementsHaveVerbatim(parsedLines(el.lines));
      default:
        return false;
    }
  });
}

/** Is there verbatim text in the headline, its text or anything below it? @param {Heading} h @param {(h: Heading) => boolean} skip @returns {boolean} */
function headingHasVerbatim(h, skip) {
  return textHasVerbatim(h.title) || elementsHaveVerbatim(parsedLines(h.bodyLines || [])) || (h.children || []).some((c) => !skip(c) && headingHasVerbatim(c, skip));
}

/** The label a frame is known by: the one its options give, or the generated one. @param {Heading} h @param {string} generated */
function frameLabel(h, generated) {
  const m = /(?:^|[[,])\s*label=(\{[^}]*\}|[^,\]]*)/.exec(bm.prop(h, 'BEAMER_OPT'));
  return m ? m[1].replace(/^\{|\}$/g, '').trim() : generated;
}

/** @param {string} s */
const trimBoth = (s) => s.replace(/^\s+|\s+$/g, '');

/** How ox-beamer wraps a headline's text: the text without its blank lines at either end, and the blank lines that followed it after the end line. @param {string} begin @param {string} contents @param {string} end @param {boolean} [space]  a space before the text (a fragile frame's) */
function wrapped(begin, contents, end, space = false) {
  const core = trimBoth(contents);
  const blanks = Math.max(0, (/\n*$/.exec(contents) || [''])[0].length - 1);
  return begin + '\n' + (core ? (space ? ' ' : '') + core + '\n' : '') + end + '\n' + '\n'.repeat(blanks);
}

/** The children of a headline (or the top level) as sections, frames and the environments inside frames. @param {Heading[]} children @param {HeadingCtx} ctx @param {number} base */
function beamerHeadings(children, ctx, base) {
  const shown = children.filter((h) => !ctx.skip(h));
  const parentEnv = ctx.parents.length ? bm.envOf(ctx.parents[ctx.parents.length - 1]).toLowerCase() : '';
  let out = '';
  /** @type {Heading[]} */
  let run = [];
  const flush = () => {
    if (run.length) out += lowLevelList(run, ctx, base);
    run = [];
  };
  shown.forEach((h, i) => {
    const rel = h.level - base;
    const env = bm.envOf(h).toLowerCase();
    const special = ['note', 'notenh', 'ignoreheading', 'appendix', 'againframe'].includes(env);
    const fl = frameLevel(h, ctx, base);
    if (!special && rel < fl) {
      if (rel > ctx.depth || !sectionFormat(ctx, rel)) {
        run.push(h);
        return;
      }
      flush();
      out += section(h, ctx, base);
      return;
    }
    flush();
    if (special) out += beamerSpecial(h, env, ctx, base);
    else if (rel === fl) out += beamerFrame(h, ctx, base);
    else out += beamerEnvironment(h, ctx, base, shown[i - 1], shown[i + 1], parentEnv);
  });
  flush();
  return out;
}

/** Notes, headlines that only pass their text on, the appendix mark and `againframe`, whatever their level. @param {Heading} h @param {string} env @param {HeadingCtx} ctx @param {number} base */
function beamerSpecial(h, env, ctx, base) {
  const contents = headingBody(h, ctx, base, false);
  const act = bm.actionOf(bm.prop(h, 'BEAMER_ACT'));
  const after = '\n'.repeat(Math.max(0, (/\n*$/.exec(contents) || [''])[0].length - 1));
  switch (env) {
    case 'note':
      return '\\note' + act.angle + '{' + inline(h.title) + '\n' + trimBoth(contents) + '}\n' + after;
    case 'notenh':
      return '\\note' + act.angle + '{' + trimBoth(contents) + '}\n' + after;
    case 'appendix':
      return '\\appendix\n' + contents;
    case 'againframe': {
      const raw = bm.prop(h, 'BEAMER_REF');
      const ref = raw ? resolveInternal(raw) : null;
      const label = ref ? (ref.heading ? frameLabel(ref.heading, ref.label) : ref.label) : raw.replace(/^[*#]/, '');
      return '\\againframe' + act.angle + bm.bracketed(bm.prop(h, 'BEAMER_OPT')) + '{' + label + '}\n';
    }
    default:
      return contents; // ignoreheading
  }
}

/** A frame: `\begin{frame}` with its overlay specification, options and title around the headline's text and what is below it. @param {Heading} h @param {HeadingCtx} ctx @param {number} base */
function beamerFrame(h, ctx, base) {
  const full = bm.envOf(h) === 'fullframe';
  const fragile = headingHasVerbatim(h, ctx.skip);
  const opts = bm.frameOptions({ label: labelFor(h, ctx), fragile, defaults: S.cfg.beamer.frameOptions, own: bm.prop(h, 'BEAMER_OPT') });
  return wrapped('\\begin{frame}' + bm.prop(h, 'BEAMER_ACT') + (opts ? '[' + opts + ']' : '') + '{' + (full ? '' : inline(h.title)) + '}', headingBody(h, ctx, base, false), '\\end{frame}', fragile);
}

/** A headline inside a frame: its environment (a block when it names none), in a column when it has a width. @param {Heading} h @param {HeadingCtx} ctx @param {number} base @param {Heading | undefined} prev @param {Heading | undefined} next @param {string} parentEnv */
function beamerEnvironment(h, ctx, base, prev, next, parentEnv) {
  const env = bm.envOf(h);
  const opt = bm.prop(h, 'BEAMER_OPT');
  const column = bm.isColumn(h);
  const contents = headingBody(h, ctx, base, false);
  let inside;
  if (column && (env === '' || env === 'column')) inside = contents;
  else if (env === 'columns') inside = wrapped('\\begin{columns}' + bm.bracketed(opt), contents, '\\end{columns}');
  else {
    const e = bm.environmentFor(env === '' ? 'block' : env, S.cfg.beamer.environments) || /** @type {{ begin: string, end: string }} */ (bm.environmentFor('block', S.cfg.beamer.environments));
    inside = wrapped(bm.fillTemplate(e.begin, bm.environmentValues(h, inline(h.title))), contents, e.end);
  }
  if (!column) return inside;
  inside = wrapped('\\begin{column}' + (env === '' || env === 'column' ? bm.bracketed(opt) : '') + '{' + bm.prop(h, 'BEAMER_COL') + '\\columnwidth}', inside, '\\end{column}');
  if (parentEnv === 'columns') return inside;
  if (!(prev && bm.isColumn(prev))) inside = '\\begin{columns}\n' + inside;
  if (!(next && bm.isColumn(next))) {
    const blanks = (/\n*$/.exec(inside) || [''])[0].length - 1;
    inside = inside.replace(/\n+$/, '\n') + '\\end{columns}\n' + '\n'.repeat(Math.max(0, blanks));
  }
  return inside;
}

/** Numbers every exported heading's position into the label table, so links can find it before it is written. @param {Heading[]} children @param {HeadingCtx} ctx */
function indexHeadings(children, ctx, unnumbered = false) {
  let n = 0;
  for (const h of children) {
    if (ctx.skip(h)) continue;
    n++;
    const own = h.properties && Object.keys(h.properties).find((k) => k.toUpperCase() === 'UNNUMBERED');
    const unn = own ? h.properties[own].trim().toLowerCase() !== 'nil' : unnumbered; // `t` and `notoc` (and anything but `nil`) turn numbers off, for the subtree too
    if (unn) S.unnumbered.add(h);
    const path = [...ctx.path, n];
    const customId = h.properties && h.properties.CUSTOM_ID && h.properties.CUSTOM_ID.trim();
    const label = S.cfg.vars.preferUserLabels && customId ? customId : 'sec:org' + hash7(path.join('.') + '|' + h.title);
    const ref = { label, title: h.title, heading: h };
    S.labels.set(h, label);
    S.targets.set('head:' + h.title.trim(), ref);
    const custom = h.properties && h.properties.CUSTOM_ID;
    if (custom) S.targets.set('#' + custom.trim(), ref);
    const id = h.properties && h.properties.ID;
    if (id) S.targets.set('id:' + id.trim(), ref);
    indexHeadings(h.children || [], { ...ctx, path }, unn);
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
      let prefix = '';
      if (el.type === 'table') prefix = 'tab:';
      else if (el.type === 'paragraph' && caption) prefix = 'fig:';
      else if (el.type === 'block' && el.name === 'src') prefix = 'lst:';
      else if (el.type === 'latex-env' && isMathEnv(el.lines[0])) prefix = 'eq:';
      const label = nameLabel(name, prefix);
      S.targets.set('name:' + name, { label, title: name });
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
    else if (el.type === 'block' && !['src', 'example', 'comment', 'export', 'verse'].includes(el.name)) indexNames(bodyElements(el.lines));
    else if (el.type === 'footnote-def') indexNames(el.children);
    for (const m of texts.join('\n').matchAll(/<<<([^<>\n]+)>>>|<<([^<>\n]+)>>/g)) {
      const name = m[1] || m[2];
      S.targets.set('target:' + norm(name), { label: targetLabel(name, !!m[1]), title: name });
    }
  }
}

// ---- document -------------------------------------------------------------

const LANGUAGES = /** @type {Record<string, string>} */ ({ en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', nl: 'Dutch', pt: 'Portuguese', sv: 'Swedish', da: 'Danish', nb: 'Norwegian', fi: 'Finnish', pl: 'Polish', ru: 'Russian', cs: 'Czech', ja: 'Japanese', zh: 'Chinese' });

/** Option text such as `H:2 toc:nil` -> its `H` value, or the default of 3 (the frame level in Beamer). @param {Doc} doc @param {number} [fallback] */
function headlineLevels(doc, fallback = 3) {
  let depth = fallback;
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

/** The inside of `\\author{..}`: the name, with the address in `\\thanks` when `email:t` and there is one. @param {string} author @param {string} email */
const authorLine = (author, email) => (author && email ? author + '\\thanks{' + email + '}' : author || email);

/** @param {string} s */
const firstLine = (s) => s.replace(/\s*\n\s*/g, ' ').trim();

/**
 * The document as LaTeX. `scope` exports one heading's subtree instead of the whole file.
 * @param {Doc} doc
 * @param {Heading | null} [scope]
 */
export function exportToLatex(doc, scope = null, { beamer = false, images = /** @type {Map<string, string> | null} */ (null), defaults = /** @type {{ cls?: string, compiler?: string, sup?: string, brokenLinks?: import('./broken-links.js').BrokenLinks, header?: string, init?: string }} */ ({}) } = {}) {
  ({ doc, scope } = expandMacrosForExport(doc, scope, new Date())); // {{{macros}}} are expanded before anything is read
  ({ doc, scope } = foldInlineTasks(doc, scope));
  if (beamer) ({ doc, scope } = withoutFinalNewline(doc, scope));
  S = newState();
  S.beamer = beamer;
  activeDoc = doc;
  if (images) S.images = images;
  const options = parseExportOptions(doc, defaults.sup, defaults.brokenLinks);
  S.opts = parseHtmlOptions(doc);
  S.raw = rawExportOptions(doc);
  S.abbreviations = linkAbbreviations(doc);
  S.language = (keywordList(doc, 'LANGUAGE')[0] || 'en').trim();
  S.withToc = options.toc;
  S.sup = options.sup;
  S.broken = options.broken;
  S.radioRe = radioTargetRegExp(doc);
  S.processor = citeExportSetting(doc).processor;
  S.base = scope ? scope.level : 0;
  const first = (/** @type {string} */ key) => keywordList(doc, key)[0];

  S.cfg = latexConfig(defaults.init);
  const declared = (first('LATEX_CLASS') || (beamer ? 'beamer' : defaults.cls) || 'article').trim();
  const article = /** @type {import('./latex-config.js').LatexClass} */ (S.cfg.classes.find((c) => c.name === 'article'));
  // a class that is not defined is written as the document class of that name, with the article's sections
  const cls = S.cfg.classes.find((c) => c.name === declared) || { ...article, header: article.header.replace(/\{article\}/, '{' + declared + '}') };
  const compiler = (first('LATEX_COMPILER') || defaults.compiler || 'pdflatex').trim();
  const givenOptions = first('LATEX_CLASS_OPTIONS');
  const classOptions = givenOptions === undefined ? undefined : givenOptions.replace(/^\s*\[?/, '[').replace(/\]?\s*$/, ']');

  const skip = exclusion(doc);
  const ctx = { doc, cls, depth: headlineLevels(doc, beamer ? S.cfg.beamer.frameLevel : 3), numbered: options.num !== false, numDepth: typeof S.opts.num === 'number' ? S.opts.num : null, skip, path: /** @type {number[]} */ ([]), parents: /** @type {Heading[]} */ ([]) };
  const roots = scope ? scope.children || [] : doc.children || [];
  const base = scope ? scope.level : 0;
  indexHeadings(roots, ctx);

  const selectTags = keywordList(doc, 'SELECT_TAGS').join(' ').split(/\s+/).filter(Boolean);
  /** @param {Heading[]} list @returns {boolean} */
  const anySelected = (list) => list.some((h) => h.tags.some((t) => selectTags.includes(t)) || anySelected(h.children || []));
  const preamble = scope ? scope.bodyLines || [] : selectTags.length && anySelected(doc.children || []) ? [] : preambleBody(doc); // with selected trees, the text before the first headline is left out
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
  const subtitle = first('SUBTITLE');

  const head = [
    '% Intended LaTeX compiler: ' + compiler,
    ...spliceHeader(cls.header, classOptions, compiler, [...(defaults.header ? defaults.header.split('\n').filter((l) => l.trim() !== '') : []), ...keywordList(doc, 'LATEX_HEADER'), ...keywordList(doc, 'LATEX_HEADER_EXTRA')]),
    ...(beamer ? bm.themeLines(doc, S.cfg.beamer.theme) : []),
    ...(typeof S.opts.num === 'number' && !beamer ? ['\\setcounter{secnumdepth}{' + S.opts.num + '}'] : []),
    '\\author{' + authorLine(options.author && author ? plain(author) : '', S.opts.email ? plain(keywordList(doc, 'EMAIL')[0] || '') : '') + '}',
    '\\date{' + (options.date === false ? '' : date ? plain(date) : '\\today') + '}',
    '\\title{' + (title ? inline(title) : '') + (subtitle && !beamer ? '\\\\\\medskip\n\\large ' + inline(subtitle) : '') + '}',
    ...(beamer ? [...(subtitle ? [S.cfg.beamer.subtitleFormat.replace('%s', () => inline(subtitle))] : []), ...bm.headerLines(doc)] : []),
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
  if (title && S.opts.title) head.push(S.cfg.vars.titleCommand.replace(/%s/g, () => (subtitle ? inline(subtitle) : '')).replace(/\n$/, '')); // org-latex-title-command, %s being the subtitle
  if (options.toc && beamer) {
    head.push(...bm.outlineFrame({ title: S.cfg.beamer.outlineTitle, options: S.cfg.beamer.outlineOptions }, options.toc).replace(/\n$/, '').split('\n'), '');
  } else if (options.toc) {
    if (typeof options.toc === 'number') head.push('\\setcounter{tocdepth}{' + options.toc + '}');
    head.push(...S.cfg.vars.tocCommand.replace(/\n$/, '').split('\n')); // org-latex-toc-command
  }

  // a section with nothing to write still keeps the blank lines that followed its keywords (Org counts them as the elements' post-blank)
  const zeroth = elements(parsedLines(preamble));
  const finalNewline = !scope && !roots.length && preamble.length > 0 && preamble[preamble.length - 1] === '' ? 1 : 0; // the file's last newline is not an empty line
  const body = (zeroth === '' ? '\n'.repeat(preamble.filter((l) => !l.trim()).length - finalNewline) : zeroth) + headings(roots, ctx, base);
  const creator = S.opts.creator ? (keywordList(doc, 'CREATOR')[0] || 'Org Mode PWA') + '\n' : ''; // creator:t ends the text with who made it
  const text = head.join('\n') + '\n' + (body ? trimEnd(body) : '') + creator + '\\end{document}\n';
  return finishDropped(text.replace(new RegExp(SNIPPET_OPEN + '(\\d+)' + SNIPPET_CLOSE + '([ \\t]*)', 'g'), (_m, i, blanks) => { const sn = S.snippets[Number(i)]; const t = snippetText(sn); return t + (sn.backend === 'src' && t === '' ? '' : blanks); }));
}

/** The document without the empty line the file's last newline leaves at the end of its last headline's text (Org does not count it as a blank line). @param {Doc} doc @param {Heading | null} scope @returns {{ doc: Doc, scope: Heading | null }} */
function withoutFinalNewline(doc, scope) {
  /** @param {Heading[]} list @returns {Heading[]} */
  const trimLast = (list) => {
    const last = list[list.length - 1];
    if (!last) return list;
    const kids = last.children || [];
    const lines = kids.length || !(last.bodyLines || []).length || (last.bodyLines || [])[(last.bodyLines || []).length - 1] !== '' ? last.bodyLines : (last.bodyLines || []).slice(0, -1);
    const copy = { ...last, children: trimLast(kids), bodyLines: lines };
    if (lines !== last.bodyLines) copy.body = last.body;
    return [...list.slice(0, -1), copy];
  };
  const children = trimLast(doc.children || []);
  const next = { ...doc, children };
  /** @param {Heading[]} from @param {Heading[]} to @returns {Heading | null} */
  const find = (from, to) => {
    for (let i = 0; i < from.length; i++) {
      if (scope && from[i] === scope) return to[i];
      const hit = find(from[i].children || [], to[i] ? to[i].children || [] : []);
      if (hit) return hit;
    }
    return null;
  };
  return { doc: next, scope: scope ? find(doc.children || [], children) || scope : null };
}

/**
 * The document as a Beamer presentation (`org-beamer-export-to-latex`): LaTeX with frames, blocks, columns, themes and overlays.
 * @param {Doc} doc
 * @param {Heading | null} [scope]
 * @param {Parameters<typeof exportToLatex>[2]} [options]
 */
export function exportToBeamer(doc, scope = null, options = {}) {
  return exportToLatex(doc, scope, { ...options, beamer: true });
}

/** The exported headings as a tree of copies, for the citation scan. @param {Heading[]} roots @param {(h: Heading) => boolean} skip @returns {Heading[]} */
function exportedTree(roots, skip) {
  return roots.filter((h) => !skip(h)).map((h) => ({ ...h, children: exportedTree(h.children || [], skip) }));
}

/** Is there a citation anywhere in what is exported? @param {string[]} preamble @param {Heading[]} roots @param {(h: Heading) => boolean} skip */
function hasCitations(preamble, roots, skip) {
  return [preamble, ...collectBodies(roots, skip)].some((lines) => lines.some((l) => /\[cite(?:\/[^:\]]*)?:/.test(l)));
}

/** The pictures the last export linked, as written in the links, for bundling them with the .tex file. @param {Doc} doc @param {Heading | null} [scope] @param {Parameters<typeof exportToLatex>[2]} [options] */
export function latexImageTargets(doc, scope = null, options = {}) {
  exportToLatex(doc, scope, options);
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
