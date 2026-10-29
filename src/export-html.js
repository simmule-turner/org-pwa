// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/**
 * The walk-wide bookkeeping of one HTML export.
 * @typedef {{
 *   doc: Doc, scope: any, options: Record<string, any>,
 *   headingIds: Map<Heading, string>, usedIds: Set<string>, targets: Map<string, string>, macros: Map<string, string>,
 *   fnNumbers: Map<string, number>, fnOrder: string[], fnRefCount: Map<string, number>, fnDefs: Map<string, any>, fnInline: Map<string, any>,
 *   counters: { table: number, listing: number, figure: number }, math: boolean,
 *   tokens: string[], tokenSources: string[], doneKeywords: string[], todoKeywords: string[] | null,
 *   radioRe: RegExp | null, noRadio: boolean, namedElements: Map<string, string>, currentNode: OutlineNode | null,
 *   parsed: Map<Heading, import('./org-elements.js').OrgElement[]>, fnDefsCollect?: any, outline: OutlineNode[], captioned: { kind: string, n: number, id: string, html: string }[],
 *   headingNodes: Map<Heading, OutlineNode>, targetHeadings: Map<string, OutlineNode>, cite: any,
 *   nested: Map<string[], import('./org-elements.js').OrgElement[]>, codeCounter: { loc: number }, codeBlocks: { lines: string[], switches: import("./code-lines.js").CodeSwitches, refs: Map<number, string>, start: number | null }[], usesCoderef: boolean,
 * }} ExportState
 */
/** @typedef {import('./types.js').Doc} Doc */
/** @template {import('./org-elements.js').OrgElement['type']} T @typedef {Extract<import('./org-elements.js').OrgElement, { type: T }>} OrgEl */
/** @typedef {{ parent?: string, bare?: boolean, first?: boolean, footnote?: boolean }} ElCtx */
/** @typedef {{ heading: Heading, level: number, number: number[], archived: boolean, unnumbered: string | null, children: OutlineNode[] }} OutlineNode  `unnumbered` is the :UNNUMBERED: value in force here (the heading's own, else its parent's), or null. */
/**
 * HTML export, following Org's own `ox-html`: the same document structure (outline containers, `h2` for top-level
 * headings under an `h1` title, `org-ul` / `org-ol` / `org-dl` lists, tables with a `colgroup` and a `thead`, figures,
 * verse, center and special blocks, a numbered Footnotes section, timestamps, entities) and the same `#+OPTIONS:`
 * switches, so that Org's own CSS and Emacs's output are interchangeable with this. The page carries print-aware CSS,
 * which is how an export becomes a PDF: the browser's Print > Save as PDF.
 *
 * Differences from Emacs are deliberate: no `htmlize` syntax colouring, MathJax is replaced by KaTeX, `#+INCLUDE:`
 * and `#+SETUPFILE:` need files this page cannot read, and element ids are readable slugs instead of hashes.
 */

import { quoteStatuses, smartQuotes } from './smart-quotes.js';
import { linkAbbreviations, expandAbbreviation } from './link-abbrev.js';
import { INLINE_TASK_BLOCK, inlineTaskInfo, foldInlineTasks } from './inline-tasks.js';
import { doctypeInfo, xmlDeclaration, htmlTag, charsetMeta } from './html-doctype.js';
import { parseInline, extractLatexFragments } from './inline-markup.js';
import { parseElements, parseAttributes } from './org-elements.js';
import { leadingOverlay } from './export-beamer.js';
import { evalMacro, isEvalTemplate } from './macro-eval.js';
import { tableModel } from './table-model.js';
import { citeExportFor, dropSilentCitations } from './cite.js';
import { ENTITIES } from './entities.js';
import { resolveTodoSequence } from './todo-cycle.js';
import { resolveLinkTarget } from './link-resolve.js';
import { renderMathHtml } from './math-render.js';
import { KATEX_EXPORT_CSS } from './katex-export-css.js';
import { getHtmlHead } from './export-options.js';
import { getProperty } from './archive-model.js';
import { highlightToHtml } from './syntax-highlight.js';
import { brokenLinkPath, brokenLinkText, finishDropped, parseBrokenLinks } from './broken-links.js';
import { newCodeCounter, codeStart, unravelCode, resolveCodeRef, coderefText, blockSwitchText } from './code-lines.js';

/** Org's hover script for code references (`org-html-scripts`): highlights a reference and its line together. */
const CODE_HIGHLIGHT_SCRIPT = `function CodeHighlightOn(elem, id) {
  var target = document.getElementById(id);
  if (null != target) {
    elem.classList.add("code-highlighted");
    target.classList.add("code-highlighted");
  }
}
function CodeHighlightOff(elem, id) {
  var target = document.getElementById(id);
  if (null != target) {
    elem.classList.remove("code-highlighted");
    target.classList.remove("code-highlighted");
  }
}
`;

// ---- options ------------------------------------------------------------------

/**
 * What `#+OPTIONS:` can switch, with Org's defaults.
 * @param {Doc} doc
 */
export function parseHtmlOptions(doc, defaults = /** @type {import('./export-defaults.js').HtmlExportDefaults} */ ({})) {
  /** @type {Record<string, any>} */
  const o = {
    toc: true,
    num: true,
    H: 3,
    tags: true,
    todo: true,
    pri: false,
    brk: false,
    checkbox: defaults.checkbox ?? 'ascii', // org-html-checkbox-type
    sup: defaults.sup ?? 't', // org-use-sub-superscripts, unless the file's #+OPTIONS: ^: says otherwise
    broken: parseBrokenLinks(defaults.brokenLinks), // org-export-with-broken-links, unless the file's #+OPTIONS: broken-links: says otherwise
    special: true,
    smart: false, // #+OPTIONS: ':t
    language: ((doc.keywords || []).find((/** @type {{ key: string }} */ k) => k.key.toUpperCase() === 'LANGUAGE') || { value: 'en' }).value.trim() || 'en',
    emph: true,
    entities: true,
    footnotes: true,
    tables: true,
    stat: true,
    tasks: true,
    planning: false,
    author: true,
    date: true,
    email: false,
    creator: false,
    title: true,
    preamble: defaults.preamble ?? null, // null (none) | false | a template string with Org's format codes
    postamble: defaults.postamble ?? true, // true (the author, date and email lines) | false | a template string
    stamps: true,
    arch: 'headline',
    comments: false,
    drawers: { all: false, exclude: ['LOGBOOK'], include: null },
  };
  const tokens = [];
  for (const kw of doc.keywords || []) {
    if (kw.key.toUpperCase() !== 'OPTIONS') continue;
    const text = kw.value;
    let i = 0;
    while (i < text.length) {
      while (i < text.length && /\s/.test(text[i])) i++;
      let j = i;
      let depth = 0;
      let quoted = false;
      while (j < text.length && (depth > 0 || quoted || !/\s/.test(text[j]))) {
        if (text[j] === '"') quoted = !quoted;
        else if (!quoted && text[j] === '(') depth++;
        else if (!quoted && text[j] === ')') depth--;
        j++;
      }
      if (j > i) tokens.push(text.slice(i, j));
      i = j;
    }
  }
  /** @param {string} v */
  const isNil = (v) => v === 'nil';
  for (const token of tokens) {
    const m = /^(\\n|[^:\s]+):(.*)$/.exec(token);
    if (!m) continue;
    const [, key, v] = m;
    switch (key) {
      case 'toc': o.toc = isNil(v) ? false : /^\d+$/.test(v) ? Number(v) : true; break;
      case 'num': o.num = /^\d+$/.test(v) ? Number(v) : !isNil(v); break;
      case 'H': if (/^\d+$/.test(v)) o.H = Number(v); break;
      case 'tags': o.tags = isNil(v) ? false : v === 'not-in-toc' ? 'not-in-toc' : true; break;
      case 'todo': o.todo = !isNil(v); break;
      case "'": o.smart = v === 't'; break;
      case 'pri': o.pri = v === 't'; break;
      case '\\n': o.brk = v === 't'; break;
      case '^': o.sup = v === 'nil' || v === '{}' ? v : 't'; break;
      case 'broken-links': o.broken = parseBrokenLinks(v, o.broken); break;
      case '-': o.special = !isNil(v); break;
      case '*': o.emph = !isNil(v); break;
      case 'e': o.entities = !isNil(v); break;
      case 'f': o.footnotes = !isNil(v); break;
      case '|': o.tables = !isNil(v); break;
      case 'stat': o.stat = !isNil(v); break;
      case 'tasks': o.tasks = isNil(v) ? false : v === 'todo' || v === 'done' ? v : true; break;
      case 'p': o.planning = v === 't'; break;
      case 'author': o.author = !isNil(v); break;
      case 'date': o.date = !isNil(v); break;
      case 'email': o.email = v === 't'; break;
      case 'creator': o.creator = v === 't'; break;
      case 'title': o.title = !isNil(v); break;
      case 'html-preamble': o.preamble = isNil(v) ? false : lispString(v); break;
      case 'html-postamble': o.postamble = isNil(v) ? false : lispString(v) ?? true; break;
      case '<': o.stamps = !isNil(v); break;
      case 'arch': o.arch = isNil(v) ? false : v === 't' ? true : 'headline'; break;
      case 'c': o.comments = v === 't'; break;
      case 'd':
        if (isNil(v)) o.drawers = { all: false, exclude: null, include: [] };
        else if (v === 't') o.drawers = { all: true, exclude: null, include: null };
        else if (/^\(not /.test(v)) o.drawers = { all: false, exclude: [...v.matchAll(/"([^"]*)"/g)].map((x) => x[1]), include: null };
        else if (v.startsWith('(')) o.drawers = { all: false, exclude: null, include: [...v.matchAll(/"([^"]*)"/g)].map((x) => x[1]) };
        break;
      default:
    }
  }
  return o;
}

/**
 * @param {Doc} doc
 * @param {string} key
 */
const keywordValue = (doc, key) => {
  /** @param {any} [k] */
  const kw = (doc.keywords || []).filter((k) => k.key.toUpperCase() === key).pop();
  return kw ? kw.value.trim() : null;
};
const keywordValues = (/** @type {any} */ doc, /** @type {string} */ key) => (doc.keywords || []).filter((/** @type {any} */ k) => k.key.toUpperCase() === key).map((/** @type {any} */ k) => k.value);

// ---- escaping and small helpers ------------------------------------------------

/** @param {string} text */
const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** @param {string} text */
const escapeAttr = (text) => escapeHtml(text).replace(/"/g, '&quot;');
const NBSP = '&#xa0;';

/**
 * `,*` and `,#+` at the start of a line are Org's escape for a line that would otherwise look like markup.
 * @param {string} line
 */
const unescapeLine = (line) => line.replace(/^(\s*),(?=\*|#\+)/, '$1');

/** @param {string[]} lines */
function removeIndentation(lines) {
  let min = Infinity;
  for (const l of lines) if (l.trim()) min = Math.min(min, (/^[ \t]*/.exec(l) || [''])[0].length);
  if (!Number.isFinite(min) || min === 0) return lines.slice();
  return lines.map((l) => (l.trim() ? l.slice(min) : ''));
}

/** @param {string} title */
const slugify = (title) => String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';

/**
 * Attributes from `#+ATTR_HTML:`, as an HTML attribute string (`:width 100 :class big` -> ` width="100" class="big"`).
 * @param {import('./org-elements.js').Affiliated | null | undefined} aff
 * @param {string[]} [skip]
 */
function htmlAttributes(aff, skip = []) {
  const attrs = parseAttributes(aff && aff.attr.html);
  let out = '';
  for (const [k, v] of Object.entries(attrs)) {
    if (skip.includes(k)) continue;
    out += v === '' ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`;
  }
  return out;
}

// ---- state --------------------------------------------------------------------

/**
 * @param {Doc} doc
 * @param {any} [scope]
 * @param {import('./export-defaults.js').HtmlExportDefaults} [defaults]
 */
function createState(doc, scope, defaults = {}) {
  const options = parseHtmlOptions(doc, defaults);
  /** @type {ExportState} */
  const state = {
    doc,
    scope,
    options,
    headingIds: new Map(),
    usedIds: new Set(),
    targets: new Map(),
    macros: new Map(),
    fnNumbers: new Map(),
    fnOrder: [],
    fnRefCount: new Map(),
    fnDefs: new Map(),
    fnInline: new Map(),
    counters: { table: 0, listing: 0, figure: 0 },
    nested: new Map(),
    codeCounter: newCodeCounter(),
    codeBlocks: [],
    usesCoderef: false,
    math: false,
    tokens: [],
    tokenSources: [],
    doneKeywords: resolveTodoSequence(doc).doneKeywords,
    todoKeywords: null,
    namedElements: new Map(),
    parsed: new Map(),
    radioRe: null,
    cite: null,
    noRadio: false,
    currentNode: null,
    outline: [],
    captioned: [],
    headingNodes: new Map(), // heading -> its outline node (number, level), for a link with no description
    targetHeadings: new Map(), // target key -> the outline node it is under
  };
  for (const kw of doc.keywords || []) {
    if (kw.key.toUpperCase() !== 'MACRO') continue;
    const m = /^(\S+)\s+([\s\S]*)$/.exec(kw.value.trim());
    if (m) state.macros.set(m[1], m[2]);
  }
  return state;
}

// ---- inline -------------------------------------------------------------------

const TOKEN_START = '';
const TOKEN_END = '';
const TOKEN_RE = /(\d+)/g;

/**
 * @param {ExportState} state
 * @param {string} html
 */
function addToken(state, html, source = '') {
  state.tokens.push(html);
  state.tokenSources.push(source);
  return TOKEN_START + (state.tokens.length - 1) + TOKEN_END;
}

const TIMESTAMP_RE = /<(\d{4}-\d{2}-\d{2}(?: [^\s>\]\d-][^\s>\]]*)?(?: \d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?)?(?: [+.]?[+-]\d+[hdwmy])*)>(?:--<(\d{4}-\d{2}-\d{2}(?: [^\s>\]\d-][^\s>\]]*)?(?: \d{1,2}:\d{2})?(?: [+.]?[+-]\d+[hdwmy])*)>)?|\[(\d{4}-\d{2}-\d{2}(?: [^\s>\]\d-][^\s>\]]*)?(?: \d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?)?(?: [+.]?[+-]\d+[hdwmy])*)\](?:--\[(\d{4}-\d{2}-\d{2}(?: [^\s>\]\d-][^\s>\]]*)?(?: \d{1,2}:\d{2})?(?: [+.]?[+-]\d+[hdwmy])*)\])?/g;

/**
 * @param {ExportState} state
 * @param {RegExpExecArray} match
 */
function timestampHtml(state, match) {
  const [whole] = match;
  if (!state.options.stamps) return '';
  // a time range within one day, <2026-03-04 Wed 10:00-11:00>, is written as two timestamps
  const range = /^([<[])(\d{4}-\d{2}-\d{2}(?: [^\s>\]\d-][^\s>\]]*)?) (\d{1,2}:\d{2})-(\d{1,2}:\d{2})((?: [^>\]]+)?)([>\]])$/.exec(whole);
  const spelled = range ? `${range[1]}${range[2]} ${range[3]}${range[5].replace(/\/\d+[hdwmy]/g, '')}${range[6]}--${range[1]}${range[2]} ${range[4]}${range[5].replace(/\/\d+[hdwmy]/g, '')}${range[6]}` : whole;
  const text = escapeHtml(spelled).replace(/--/g, '&#x2013;');
  return addToken(state, `<span class="timestamp-wrapper"><span class="timestamp">${text}</span></span>`, whole);
}

/**
 * @param {ExportState} state
 * @param {string} text
 */
function expandMacros(state, text) {
  if (!text.includes('{{{')) return text;
  // verbatim and code spans show their text as written
  return text
    .split(/((?<![\w])[~=][^~=\n]+[~=](?![\w]))/)
    .map((part, /** @type {number} */ i) => (i % 2 ? part : expandMacrosIn(state, part)))
    .join('');
}

/**
 * @param {ExportState} state
 * @param {string} text
 */
function expandMacrosIn(state, text) {
  return text.replace(/\{\{\{(\w[\w-]*)(?:\(([\s\S]*?)\))?\}\}\}/g, (whole, /** @type {string} */ name, argText) => {
    const args = argText === undefined ? [] : argText.split(/(?<!\\),/).map((/** @type {any} */ a) => a.replace(/\\,/g, ',').trim());
    const key = name.toLowerCase();
    if (state.macros.has(name)) {
      const template = state.macros.get(name) || '';
      return isEvalTemplate(template) ? evalMacro(name, template, args) : template.replace(/\$(\d)/g, (w, n) => args[Number(n) - 1] ?? '');
    }
    /** @param {string} k */
    const kw = (k) => keywordValue(state.doc, k) || '';
    if (key === 'title') return kw('TITLE');
    if (key === 'author') return kw('AUTHOR');
    if (key === 'email') return kw('EMAIL');
    if (key === 'date') return kw('DATE');
    if (key === 'keyword') return kw(String(args[0] || '').toUpperCase());
    return whole;
  });
}

// =verbatim= and ~code~ spans, with Org's border rules: the marker follows a space or opening punctuation and ends before a space or closing one
const VERBATIM_SPAN_RE = /(^|[\s({'"])([=~])(?=\S)([^\n]*?\S)\2(?=$|[\s\-.,;:!?)}'"\\])/g;

/** Runs `fn` on the parts of `text` that are not verbatim or code spans, and leaves the spans as they are.
 * @param {string} text
 * @param {(piece: string) => string} fn */
function outsideVerbatim(text, fn) {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(VERBATIM_SPAN_RE)) {
    const start = (m.index ?? 0) + m[1].length;
    out += fn(text.slice(last, start)) + text.slice(start, (m.index ?? 0) + m[0].length);
    last = (m.index ?? 0) + m[0].length;
  }
  return out + fn(text.slice(last));
}

/** The `<<target>>` and `<<<radio>>>` names written in these lines of text, leaving out source, example, export and comment
 * blocks, comment lines, and verbatim or code spans.
 * @param {string[]} lines
 * @returns {{ name: string, radio: boolean }[]} */
function targetsInLines(lines) {
  /** @type {{ name: string, radio: boolean }[]} */ const found = [];
  let skipUntil = '';
  for (const line of lines) {
    if (skipUntil) {
      if (line.trim().toLowerCase().startsWith(skipUntil)) skipUntil = '';
      continue;
    }
    const begin = /^\s*#\+begin_(src|example|export|comment)\b/i.exec(line);
    if (begin) {
      skipUntil = '#+end_' + begin[1].toLowerCase();
      continue;
    }
    if (/^\s*#(\s|$)/.test(line)) continue;
    outsideVerbatim(line, (piece) => {
      for (const m of piece.matchAll(/<<(<?)([^<>\n]+?)>>>?/g)) found.push({ name: m[2], radio: m[1] === '<' });
      return piece;
    });
  }
  return found;
}

/**
 * Org text -> HTML for inline content. `text` may span several lines (joined by "\n").
 * @param {ExportState} state
 * @param {string} rawText
 */
function renderInline(state, rawText) {
  let text = expandMacros(state, rawText);
  // forced line breaks: a line ending in two backslashes
  text = text.replace(/\\\\[ \t]*(?:\n|$)/g, (m) => addToken(state, `<br${closing}`, '\\\\') + (m.endsWith('\n') ? '\n' : ''));
  // export snippets
  text = text.replace(/@@([A-Za-z0-9-]+):([\s\S]*?)@@/g, (whole, backend, value) => (backend.toLowerCase() === 'html' ? addToken(state, value, whole) : backend.toLowerCase() === 'comment' ? '' : ''));
  // inline source code
  text = text.replace(/\bsrc_([A-Za-z0-9_-]+)(?:\[[^\]\n]*\])?\{([^}\n]*)\}/g, (whole, lang, code) => addToken(state, `<code class="src src-${escapeAttr(lang)}">${escapeHtml(code)}</code>`, whole));
  // inline calls to Babel blocks print nothing when nothing is run
  text = text.replace(/\bcall_[A-Za-z0-9_-]+(?:\[[^\]\n]*\])?\([^)\n]*\)(?:\[[^\]\n]*\])?/g, (whole) => addToken(state, '', whole));
  // radio targets and targets (not inside =verbatim= or ~code~, where they are just characters)
  text = outsideVerbatim(text, (/** @type {string} */ piece) =>
    piece
      .replace(/<<<([^<>\n]+)>>>/g, (whole, /** @type {string} */ name) => addToken(state, `<a id="${targetId(state, name)}">${escapeHtml(name)}</a>`, whole))
      .replace(/<<([^<>\n]+)>>/g, (whole, /** @type {string} */ name) => addToken(state, `<a id="${targetId(state, name)}"></a>`, whole))
  );
  // timestamps
  text = text.replace(TIMESTAMP_RE, (/** @type {any} */ ...m) => timestampHtml(state, m));

  const { lines, fragments } = extractLatexFragments(text.split('\n'));
  const nodes = parseInline(lines.join('\n'), { latexFragments: fragments, subSuperscriptMode: state.options.sup });
  return renderNodes(state, nodes);
}

/**
 * @param {ExportState} state
 * @param {string} name
 */
function targetId(state, name) {
  const key = name.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!state.targets.has(key)) state.targets.set(key, uniqueId(state, 'org-target-' + slugify(name)));
  return state.targets.get(key);
}

/**
 * @param {ExportState} state
 * @param {string} base
 */
function uniqueId(state, base) {
  let id = base;
  for (let n = 2; state.usedIds.has(id); n++) id = base + '-' + n;
  state.usedIds.add(id);
  return id;
}

const ENTITY_RE = /\\(_ +|(?:there4|sup[123]|frac[13][24]|[a-zA-Z]+)(?:\{\}|(?![A-Za-z])))/g;
const COOKIE_RE = /\[(\d*\/\d*|\d*%)\]/g;

/**
 * Plain text -> HTML: escaping, entities, special strings, statistics cookies, and the placeholders set aside earlier.
 * @param {ExportState} state
 * @param {string} value
 */
function renderText(state, value) {
  const { options } = state;
  let out = '';
  let last = 0;
  /** @param {any} [segment] */
  const plain = (segment) => {
    let h = escapeHtml(segment);
    if (options.special) {
      h = h.replace(/\\-/g, '&shy;').replace(/(^|[^-])---(?=[^-]|$)/g, '$1&#x2014;').replace(/(^|[^-])--(?=[^-]|$)/g, '$1&#x2013;').replace(/\.\.\./g, '&#x2026;');
    }
    h = h.replace(COOKIE_RE, options.stat ? '<code>[$1]</code>' : '');
    if (state.radioRe && !state.noRadio) h = h.replace(state.radioRe, (m) => `<a href="#${state.targets.get(m.trim().replace(/\s+/g, ' ').toLowerCase())}">${m}</a>`);
    if (options.brk) h = h.replace(/\n/g, `<br${closing}\n`);
    return h.replace(TOKEN_RE, (w, n) => state.tokens[Number(n)]);
  };
  if (options.entities) {
    let m;
    ENTITY_RE.lastIndex = 0;
    while ((m = ENTITY_RE.exec(value))) {
      const entry = m[1][0] === '_' ? ['', '', '', '&ensp;'.repeat(m[1].length - 1)] : /** @type {any} */ (ENTITIES)[m[1].replace(/\{\}$/, '')];
      if (!entry) continue;
      out += plain(value.slice(last, m.index)) + entry[3];
      last = m.index + m[0].length;
    }
  }
  return out + plain(value.slice(last));
}

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|bmp|tiff?|xbm|xpm|pbm|pgm|ppm|avif)$/i;

/**
 * Is this link target one Org shows as an inline picture?
 * @param {string} target
 */
function isImageTarget(target) {
  const t = target.trim();
  if (/^(file:|attachment:)?[^:]*$/.test(t) || /^(file|attachment):/i.test(t) || /^https?:\/\//i.test(t)) return IMAGE_RE.test(t.replace(/::.*$/, ''));
  return false;
}

/** @param {string} path */
function fileHref(path) {
  let p = path.replace(/^file:/i, '');
  let search = '';
  const at = p.indexOf('::');
  if (at >= 0) {
    search = p.slice(at + 2);
    p = p.slice(0, at);
  }
  if (/\.org$/i.test(p)) p = p.replace(/\.org$/i, '.html');
  if (p.startsWith('//')) p = p.slice(2);
  else if (p.startsWith('/')) p = 'file://' + p;
  let hash = '';
  if (search) hash = search.startsWith('#') ? search : search.startsWith('*') ? '#' + slugify(search.slice(1)) : '';
  return p + hash;
}

/** What ends a void tag in the page being written: " />" for XHTML, ">" otherwise. */
let closing = ' />';
/** Whether the page being written is HTML 5 (its tables carry no border attributes). */
let html5Page = false;
let activeImages = new Map();

/** @param {string} target */
function imageSrc(target) {
  if (activeImages.has(target)) return activeImages.get(target);
  return target.replace(/^(file|attachment):/i, '').replace(/::.*$/, '').replace(/^\/\//, '').replace(/^(\/)/, 'file://$1');
}

/**
 * @param {ExportState} state
 * @param {any} [target]
 */
function linkHref(state, target) {
  const t = target.trim();
  if (/^(https?|ftp|mailto|news|irc|doi):/i.test(t)) return (/^doi:/i.test(t) ? 'https://doi.org/' + t.replace(/^doi:/i, '') : t).replace(/ /g, '%20'); // Org encodes spaces in a link
  if (/^id:/i.test(t)) {
    const id = t.slice(3);
    const h = findByProperty(state.doc.children || [], 'ID', id);
    return h && state.headingIds.has(h) ? '#' + state.headingIds.get(h) : '#' + id;
  }
  if (/^file:/i.test(t) || /^\.{0,2}\//.test(t) || /^~\//.test(t)) return fileHref(t);
  const key = t.replace(/^#/, '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!t.startsWith('*') && !t.startsWith('#') && state.targets.has(key)) return '#' + state.targets.get(key);
  const res = resolveLinkTarget(state.doc, t);
  if (res.type === 'heading' && state.headingIds.has(res.heading)) return '#' + state.headingIds.get(res.heading);
  if (res.type === 'external') return res.url;
  if (state.namedElements.has(t)) return '#' + state.namedElements.get(t);
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t.replace(/^[a-z]+:/i, '');
  return t.startsWith('#') ? t : '#' + slugify(t);
}

/**
 * @param {Heading[]} headings
 * @param {string} name
 * @param {string} value
 */
function findByProperty(headings, name, value) {
  for (const h of headings) {
    if (String(getProperty(h, name) || '').trim() === value) return h;
    /** @type {any} */ const r = findByProperty(h.children || [], name, value);
    if (r) return r;
  }
  return null;
}

/**
 * Verbatim text with the source of any construct that was set aside as a placeholder put back.
 * @param {ExportState} state
 * @param {string} value
 */
function literal(state, value) {
  return escapeHtml(value.replace(TOKEN_RE, (m, n) => state.tokenSources[Number(n)]));
}

/**
 * @param {ExportState} state
 * @param {import('./types.js').InlineNode[]} nodes
 * @returns {string}
 */
function renderNodes(state, nodes) {
  if (state.cite) nodes = dropSilentCitations(nodes, (c) => state.cite.formatCitation(c) === null);
  if (!state.options.footnotes) {
    // a removed reference takes the blanks that follow it along (org-element-extract-element)
    nodes = nodes.map((/** @type {import('./types.js').InlineNode} */ n, i) => {
      const before = nodes[i - 1];
      return before && n.type === 'text' && (before.type === 'footnote-ref' || before.type === 'footnote-def') ? { ...n, value: n.value.replace(/^[ \t]+/, '') } : n;
    });
  }
  const quotes = state.options.smart ? quoteStatuses(nodes) : null;
  return nodes
    .map((n) => {
      const status = quotes && quotes.get(n);
      if (!status || n.type !== 'text') return renderNode(state, n);
      // each quote character becomes a placeholder for its entity, which the text rendering puts back
      const value = smartQuotes(n.value, status, state.options.language, 'html').replace(/(&[a-z]+;)+/g, (entity) => addToken(state, entity, entity));
      return renderNode(state, { ...n, value });
    })
    .join('');
}

/**
 * Emphasis as a tag, or with its markers kept as plain text when `#+OPTIONS: *:nil`.
 * @param {ExportState} state
 * @param {import('./types.js').EmphasisNode} node
 * @param {string} marker
 * @param {string} open
 * @returns {string}
 */
function emphasis(state, node, marker, open, close = open) {
  const inner = renderNodes(state, node.children);
  return state.options.emph ? `<${open}>${inner}</${close}>` : marker + inner + marker;
}

/**
 * @param {ExportState} state
 * @param {string} label
 * @param {string} [inlineHtml]
 */
function footnoteRef(state, label, inlineHtml) {
  let n = state.fnNumbers.get(label);
  if (n === undefined) {
    n = state.fnOrder.length + 1;
    state.fnNumbers.set(label, n);
    state.fnOrder.push(label);
  }
  if (inlineHtml !== undefined) state.fnInline.set(label, inlineHtml);
  const count = state.fnRefCount.get(label) || 0;
  state.fnRefCount.set(label, count + 1);
  const id = count === 0 ? `fnr.${n}` : `fnr.${n}.${count * 100}`;
  return `<sup><a id="${id}" class="footref" href="#fn.${n}" role="doc-backlink">${n}</a></sup>`;
}

/**
 * @param {ExportState} state
 * @param {import('./types.js').InlineNode} node
 * @returns {string}
 */
function renderNode(state, node) {
  switch (node.type) {
    case 'text':
      return renderText(state, node.value);
    case 'bold':
      return emphasis(state, node, '*', 'b');
    case 'italic':
      return emphasis(state, node, '/', 'i');
    case 'underline':
      return emphasis(state, node, '_', 'span class="underline"', 'span');
    case 'strikethrough':
      return emphasis(state, node, '+', 'del');
    case 'code':
    case 'verbatim':
      return `<code>${literal(state, node.value)}</code>`;
    case 'subscript':
      return `<sub>${literal(state, node.value)}</sub>`;
    case 'superscript':
      return `<sup>${literal(state, node.value)}</sup>`;
    case 'image':
      return imageHtml(node.target);
    case 'link':
      return linkHtml(state, node);
    case 'latex':
      return mathHtml(state, node.source, node.displayMode);
    case 'footnote-ref':
      return state.options.footnotes ? footnoteRef(state, node.label) : '';
    case 'footnote-def': {
      if (!state.options.footnotes) return '';
      const label = node.label === null || node.label === '' ? 'anon-' + (state.fnOrder.length + 1) : node.label;
      return footnoteRef(state, label, `<p class="footpara">${renderNodes(state, node.children)}</p>`);
    }
    case 'citation': {
      const segments = state.cite ? state.cite.formatCitation(node) : null;
      return (segments ? citeSegmentsHtml(state, segments).trim() : '') + ' '.repeat(node.blanks);
    }
    case 'radio-target':
      return escapeHtml(node.name);
    case 'target':
      return '';
    case 'comment':
      return '';
    default:
      return '';
  }
}

/** A citation processor's output as HTML: plain text escaped, affixes as Org text, emphasis as <i>.
 * @param {ExportState} state @param {import('./cite.js').Segment[]} segments
 * @returns {string} */
function citeSegmentsHtml(state, segments) {
  return segments
    .map((s) => (typeof s === 'string' ? escapeHtml(s) : 'org' in s ? renderInline(state, s.org) : `<i>${citeSegmentsHtml(state, s.italic)}</i>`))
    .join('');
}

/**
 * @param {string} target
 * @param {undefined} [alt]
 */
function imageHtml(target, alt, attrs = '') {
  const src = imageSrc(target);
  const plain = target.replace(/^(file|attachment):/i, '').replace(/::.*$/, '');
  const name = plain.replace(/^.*\//, '');
  return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt ?? name)}"${attrs}${closing}`;
}

/**
 * What Org shows for an internal link with no description: a heading's section number (its title when sections are not
 * numbered); for a `<<target>>`, the number of the section it is in ("No description for this link" when sections are not
 * numbered); a captioned table or listing's number. Null when the link is not one of those.
 * @param {ExportState} state
 * @param {string} rawTarget
 * @returns {string | null}
 */
function internalLinkLabel(state, rawTarget) {
  const t = rawTarget.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^id:/i.test(t)) return null; // a URL or file link
  /** @param {OutlineNode | undefined} node @returns {node is OutlineNode} */
  const numbered = (node) => !!node && !!state.options.num && !(typeof state.options.num === 'number' && node.level > state.options.num);
  const key = t.replace(/^#/, '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!t.startsWith('*') && !t.startsWith('#') && state.targets.has(key)) {
    const node = state.targetHeadings.get(key);
    return numbered(node) ? node.number.join('.') : 'No description for this link';
  }
  const id = !t.startsWith('*') && !t.startsWith('#') ? state.namedElements.get(t) : undefined; // a named element comes before a heading
  if (id) {
    const cap = state.captioned.find((c) => c.id === id);
    return cap ? String(cap.n) : 'No description for this link';
  }
  const res = resolveLinkTarget(state.doc, t);
  if (res.type === 'heading') {
    const node = state.headingNodes.get(res.heading);
    if (!node) return null;
    return numbered(node) ? node.number.join('.') : renderInline(state, titleOf(res.heading));
  }
  return null;
}

/**
 * @param {ExportState} state
 * @param {import('./types.js').LinkNode} node
 */
function linkHtml(state, node) {
  const target = expandAbbreviation(node.target, linkAbbreviations(state.doc)); // #+LINK: abbreviations
  const desc = node.description;
  const coderef = /^\((.+)\)$/.exec(target.trim());
  if (coderef) {
    const found = resolveCodeRef(state.codeBlocks, coderef[1]);
    if (found === null) return escapeHtml(brokenLinkText(state.options.broken, coderef[1]));
    state.usesCoderef = true;
    const id = `coderef-${escapeAttr(coderef[1])}`;
    const text = desc ? renderInline(state, coderefText(coderef[1], found, desc)) : escapeHtml(found);
    return `<a href="#${id}" class="coderef" onmouseover="CodeHighlightOn(this, '${id}');" onmouseout="CodeHighlightOff(this, '${id}');">${text}</a>`;
  }
  if (!node.radio && !isImageTarget(target)) {
    const broken = brokenLinkPath(state.doc, target, (n) => state.namedElements.has(n));
    if (broken !== null) return escapeHtml(brokenLinkText(state.options.broken, broken));
  }
  if (desc === null || desc === undefined || desc === '') {
    if (isImageTarget(target)) return imageHtml(target);
    const internal = internalLinkLabel(state, target);
    if (internal !== null) return `<a href="${escapeAttr(linkHref(state, target))}">${internal}</a>`;
    const label = escapeHtml(/^(file:)/i.test(target) ? target.replace(/^file:/i, '') : target);
    const display = /^(https?|ftp):/i.test(target) ? escapeHtml(target.replace(/ /g, '%20')) : /^(mailto):/i.test(target) || /^file:/i.test(target) ? label : escapeHtml(target); // a link without text shows its encoded address
    return `<a href="${escapeAttr(linkHref(state, target))}">${display}</a>`;
  }
  // a description that is itself an image link shows the picture inside the link
  const inner = /^\[\[[^\]]+\]\]$/.test(desc.trim()) ? null : isImageTarget(desc.trim()) ? imageHtml(desc.trim()) : null;
  state.noRadio = true;
  const label = inner !== null ? inner : renderInline(state, desc);
  state.noRadio = false;
  return `<a href="${escapeAttr(linkHref(state, target))}">${label}</a>`;
}

/**
 * @param {ExportState} state
 * @param {string} source
 * @param {boolean} displayMode
 */
function mathHtml(state, source, displayMode) {
  const { html, ok } = renderMathHtml(source, displayMode);
  if (ok) {
    state.math = true;
    return html;
  }
  return escapeHtml(displayMode ? `\\[${source}\\]` : `\\(${source}\\)`);
}

// ---- elements -----------------------------------------------------------------

/**
 * @param {ExportState} state
 * @param {import('./org-elements.js').Affiliated | null | undefined} aff
 */
function captionHtml(state, aff) {
  const c = aff && aff.caption.length ? aff.caption[aff.caption.length - 1] : null;
  return c ? renderInline(state, c.text) : null;
}

/**
 * @param {ExportState} state
 * @param {OrgEl<'paragraph'>} el
 * @param {ElCtx} ctx
 */
function paragraphHtml(state, el, ctx) {
  const text = el.lines.join('\n');
  const image = standaloneImage(el);
  if (image && ctx.parent !== 'item-first') return figureHtml(state, el, image);
  const body = renderInline(state, state.options.brk ? text + '\n' : text);
  if (ctx.bare) return body;
  const cls = ctx.footnote ? ' class="footpara"' : '';
  return `<p${cls}>\n${body}\n</p>`;
}

/** @param {OrgEl<'paragraph'>} el */
function standaloneImage(el) {
  const text = el.lines.join(' ').trim();
  const m = /^\[\[([^\]]+)\](?:\[([^\]]*)\])?\]$/.exec(text);
  if (!m) return null;
  if (m[2] && !isImageTarget(m[2])) return null;
  return isImageTarget(m[1]) ? { target: m[1], link: m[2] ? m[1] : null, thumb: m[2] || null } : null;
}

/**
 * @param {ExportState} state
 * @param {OrgEl<'paragraph'>} el
 * @param {any} [image]
 */
function figureHtml(state, el, image) {
  const aff = el.aff;
  const attrs = parseAttributes(aff && aff.attr.html);
  const alt = (attrs).alt !== undefined ? /** @type {any} */ (attrs).alt : undefined;
  const rest = htmlAttributes(aff, ['alt']);
  let img = imageHtml(image.thumb || image.target, alt, rest);
  if (image.link) img = `<a href="${escapeAttr(imageSrc(image.link))}">${img}</a>`;
  const caption = captionHtml(state, aff);
  const id = aff && aff.name ? aff.name : uniqueId(state, 'figure');
  state.namedElements.set(aff && aff.name ? aff.name : id, id);
  let out = `<div id="${escapeAttr(id)}" class="figure">\n<p>${img}\n</p>`;
  if (caption !== null) out += `\n<p><span class="figure-number">Figure ${++state.counters.figure}: </span>${caption}</p>`;
  return out + '\n</div>';
}

/**
 * @param {ExportState} state
 * @param {OrgEl<'list'>} el
 * @param {ElCtx} ctx
 * @returns {string}
 */
function listHtml(state, el, ctx) {
  const tag = el.listType === 'ordered' ? 'ol' : el.listType === 'descriptive' ? 'dl' : 'ul';
  const attrs = htmlAttributes(el.aff);
  const rows = el.items.map((item) => itemHtml(state, item, el.listType));
  return `<${tag} class="org-${tag}"${attrs}>\n${rows.join('\n')}\n</${tag}>`;
}

/**
 * @param {ExportState} state
 * @param {import('./org-elements.js').ElementListItem} item
 * @param {string} listType
 * @returns {string}
 */
function itemHtml(state, item, listType) {
  const children = item.children;
  const first = children[0];
  const lead = first && first.type === 'paragraph' && (children.length === 1 || (children.length === 2 && children[1].type === 'list'));
  const parts = children.map((c, /** @type {number} */ i) => elementHtml(state, c, { parent: 'item', bare: i === 0 && lead, first: i === 0 }));
  let inner = parts.filter((p) => p !== '').join('\n');
  if (item.checkbox && listType !== 'descriptive') inner = `${checkboxHtml(state, item.checkbox)} ${inner}`.replace(/\s+$/, '');
  if (listType === 'descriptive') {
    const tag = item.tag === null ? '(no term)' : renderInline(state, item.tag);
    const box = item.checkbox ? `${checkboxHtml(state, item.checkbox)} ` : '';
    const cls = item.checkbox ? ` class="${item.checkbox}"` : '';
    return `<dt${cls}>${box}${tag}</dt><dd>${inner.replace(/\n$/, '')}</dd>`;
  }
  const cls = item.checkbox ? ` class="${item.checkbox}"` : '';
  // a tag in a list that is not descriptive (its first item has none) becomes the value or the id, ahead of the counter
  const tag = item.tag === null || item.tag === undefined ? null : renderInline(state, item.tag);
  const attr = listType === 'ordered' ? 'value' : 'id';
  const value = tag !== null ? ` ${attr}="${tag}"` : item.counter !== null ? ` value="${item.counter}"` : '';
  return `<li${cls}${value}>${inner.replace(/\n$/, '')}</li>`;
}


/** The box before a checklist item, by org-html-checkbox-type. @param {ExportState} state @param {string} status  on | off | trans */
function checkboxHtml(state, status) {
  const type = state.options.checkbox;
  if (type === 'unicode') return status === 'on' ? '&#x2611;' : '&#x2610;';
  if (type === 'html') return status === 'on' ? "<input type='checkbox' checked='checked' />" : "<input type='checkbox' />";
  return status === 'on' ? '<code>[X]</code>' : status === 'off' ? '<code>[&#xa0;]</code>' : '<code>[-]</code>';
}

/**
 * @param {ExportState} state
 * @param {OrgEl<'table'>} el
 */
function tableHtml(state, el) {
  if (!state.options.tables) return '';
  const aff = el.aff;
  const model = tableModel(el.rows);
  const { rows: all, specials, offset, hasHeader, groupOf, alignment, leftBorder, rightBorder, firstIndex } = model;
  if (!all.some((r) => !r.rule)) return '';
  const firstRow = firstIndex >= 0 ? all[firstIndex] : all.find((r) => !r.rule);
  if (!firstRow) return '';
  const attrs = parseAttributes(aff && aff.attr.html);
  // org-html-table-default-attributes, which a page of HTML 5 does not carry
  const base = html5Page ? {} : { border: '2', cellspacing: '0', cellpadding: '6', rules: 'groups', frame: 'hsides' };
  let tableAttrs = '';
  for (const [k, v] of Object.entries({ ...base, ...attrs })) tableAttrs += v === '' ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`;
  const caption = captionHtml(state, aff);
  const idAttr = el.__id ? ` id="${escapeAttr(el.__id)}"` : '';
  let out = `<table${idAttr}${tableAttrs}>\n`;
  if (caption !== null) out += `<caption class="t-above"><span class="table-number">Table ${++state.counters.table}:</span> ${caption}</caption>\n`;
  const specs = [];
  for (let c = offset; c < firstRow.cells.length; c++) {
    const starts = c === offset || leftBorder(c);
    const ends = c === firstRow.cells.length - 1 || rightBorder(c);
    specs.push((starts ? '\n<colgroup>' : '') + `\n<col  class="org-${alignment(c)}"${closing}` + (ends ? '\n</colgroup>' : ''));
  }
  out += specs.join('\n') + '\n';
  /**
   * @param {string} text
   * @param {string} tag
   * @param {number} column
   */
  const cell = (text, tag, column) => `<${tag}${tag === 'th' ? ' scope="col"' : ''} class="org-${alignment(column)}">${renderInline(state, text.trim()) || NBSP}</${tag}>`;
  // consecutive standard rows between rules make one group of the output
  /** @type {number[][]} */ const blocks = [];
  let open = false;
  all.forEach((r, i) => {
    if (r.rule) open = false;
    else if (!specials[i]) {
      if (!open) { blocks.push([]); open = true; }
      blocks[blocks.length - 1].push(i);
    }
  });
  for (const block of blocks) {
    const head = hasHeader && groupOf[block[0]] === 1;
    out += head ? '<thead>\n' : '<tbody>\n';
    out += block
      .map((i) => '<tr>\n' + all[i].cells.slice(offset).map((t, k) => cell(t, head ? 'th' : 'td', k + offset)).join('\n') + '\n</tr>')
      .join('\n\n') + '\n';
    out += head ? '</thead>\n' : '</tbody>\n';
  }
  return out + '</table>';
}

/**
 * The elements inside a quote, special block or drawer, parsed once so that the scan and the rendering see the same objects
 * (a block's number and its place in the running line count belong to the object).
 * @param {ExportState} state
 * @param {string[]} lines
 */
function nestedElements(state, lines, unescape = true) {
  let parsed = state.nested.get(lines);
  if (!parsed) {
    parsed = parseElements(unescape ? lines.map(unescapeLine) : lines);
    state.nested.set(lines, parsed);
  }
  return parsed;
}

/**
 * The unravelled code of a source or example block with its line-number start, computed once per block.
 * @param {ExportState} state
 * @param {any} el
 * @returns {import('./code-lines.js').CodeBlock & { start: number | null }}
 */
function prepareCode(state, el) {
  if (el.__code) return el.__code;
  const lines = el.lines.map(unescapeLine);
  const block = unravelCode(lines, blockSwitchText(el.name, el.params));
  el.__code = { ...block, start: codeStart(state.codeCounter, block.switches, lines.length) };
  state.codeBlocks.push(el.__code);
  return el.__code;
}

/**
 * Lines of already escaped or highlighted code with Org's number and reference markup (`org-html-do-format-code`).
 * @param {import('./code-lines.js').CodeBlock & { start: number | null }} block
 * @param {string[]} htmlLines
 */
function formatCodeHtml(block, htmlLines) {
  const { start, refs, switches } = block;
  const width = start === null ? 0 : String(htmlLines.length + start).length;
  return htmlLines
    .map((loc, i) => {
      const ref = refs.get(i + 1);
      const text =
        (start === null ? '' : `<span class="linenr">${String(start + i + 1).padStart(width)}: </span>`) +
        loc +
        (ref !== undefined && switches.retainLabels ? ` (${escapeHtml(ref)})` : '');
      return ref === undefined ? text : `<span id="coderef-${escapeAttr(ref)}" class="coderef-off">${text}</span>`;
    })
    .join('\n');
}

/**
 * @param {ExportState} state
 * @param {OrgEl<'block'>} el
 */
function srcBlockHtml(state, el) {
  const params = el.params.trim();
  const lang = params.split(/\s+/)[0] || '';
  const block = prepareCode(state, el);
  const code = formatCodeHtml(block, highlightToHtml(block.lines.join('\n'), lang).split('\n'));
  const caption = captionHtml(state, el.aff);
  const cls = lang ? `src src-${escapeAttr(lang)}` : 'src';
  const label = caption !== null ? `<label class="org-src-name"><span class="listing-number">Listing ${++state.counters.listing}: </span>${caption}</label>` : '';
  const id = el.__id ? ` id="${escapeAttr(el.__id)}"` : '';
  return `<div class="org-src-container">\n${label}<pre class="${cls}"${id}>${code}\n</pre>\n</div>`;
}

/**
 * @param {ExportState} state
 * @param {OrgEl<'block'>} el
 * @param {ElCtx} ctx
 */
function blockHtml(state, el, ctx) {
  const { name } = el;
  /**
   * @param {string[]} lines
   * @param {any} [sub]
   */
  const inner = (lines, sub) => elementsHtml(state, nestedElements(state, lines), { ...ctx, ...sub, first: undefined, bare: false });
  switch (name) {
    case 'comment':
      return '';
    case 'export': {
      const backend = el.params.trim().split(/\s+/)[0].toLowerCase();
      return backend === 'html' ? el.lines.join('\n') : '';
    }
    case 'src':
      if (!el.params.trim().split(/\s+/)[0] || /^[-+]/.test(el.params.trim())) return blockHtml(state, { ...el, name: 'example' }, ctx);
      return srcBlockHtml(state, el);
    case 'example':
    {
      const block = prepareCode(state, el);
      return `<pre class="example"${el.aff && el.aff.name ? ` id="${escapeAttr(el.aff.name)}"` : ''}>\n${formatCodeHtml(block, block.lines.map(escapeHtml))}\n</pre>`;
    }
    case 'quote':
      return `<blockquote${htmlAttributes(el.aff)}>\n${inner(el.lines)}\n</blockquote>`;
    case 'center':
      return `<div class="org-center">\n${inner(el.lines)}\n</div>`;
    case INLINE_TASK_BLOCK: {
      // org-html-inlinetask; Emacs prints the word nil for a task with no contents, which is left out here
      const info = inlineTaskInfo(el.params);
      const title = headingTitleHtml(state, /** @type {OutlineNode} */ (/** @type {unknown} */ ({ heading: { type: 'heading', level: 0, ...info } })));
      const contents = el.lines.some((l) => l.trim()) ? inner(el.lines) + '\n' : '';
      return `<div class="inlinetask">\n<b>${title}</b><br${closing}\n${contents}</div>`;
    }
    case 'verse': {
      const lines = removeIndentation(el.lines.map(unescapeLine));
      const html = lines
        .map((l) => {
          const lead = (/^ */.exec(l) || [''])[0].length;
          return (NBSP.repeat(lead) + renderInline(state, l.slice(lead))).replace(/^$/, '') + `<br${closing}`;
        })
        .join('\n');
      return `<p class="verse">\n${html}\n</p>`;
    }
    default: {
      const id = el.aff && el.aff.name ? ` id="${escapeAttr(el.aff.name)}"` : '';
      return `<div class="${escapeAttr(name)}"${id}${htmlAttributes(el.aff)}>\n${inner(el.lines)}\n</div>`;
    }
  }
}

/**
 * @param {ExportState} state
 * @param {OrgEl<'drawer'>} el
 * @param {ElCtx} ctx
 */
function drawerHtml(state, el, ctx) {
  const d = state.options.drawers;
  const name = el.name.toUpperCase();
  const allowed = d.all || (d.include ? d.include.some((/** @type {any} */ x) => x.toUpperCase() === name) : !(d.exclude || []).some((/** @type {any} */ x) => x.toUpperCase() === name));
  if (!allowed) return '';
  return elementsHtml(state, nestedElements(state, el.lines, false), ctx);
}

/**
 * @param {ExportState} state
 * @param {import('./org-elements.js').OrgElement} el
 * @returns {string}
 */
function elementHtml(state, el, ctx = {}) {
  switch (el.type) {
    case 'paragraph':
      return paragraphHtml(state, el, ctx);
    case 'list':
      return listHtml(state, el, ctx);
    case 'table':
      return tableHtml(state, el);
    case 'block':
      return blockHtml(state, el, ctx);
    case 'drawer':
      return drawerHtml(state, el, ctx);
    case 'fixed':
      return `<pre class="example">\n${escapeHtml(el.lines.join('\n'))}\n</pre>`;
    case 'hr':
      return `<hr${closing}`;
    case 'latex-env': {
      const source = el.lines.join('\n');
      const r = renderMathHtml(source, true);
      if (r.ok) {
        state.math = true;
        return r.html;
      }
      return source; // Org writes the environment as it is, `&` and `<` included
    }
    case 'html-line':
      return el.value;
    case 'toc':
      return tocKeywordHtml(state, el);
    case 'print-bibliography':
      return state.cite ? state.cite.bibliography().map((/** @type {any} */ e) => `<p>\n${citeSegmentsHtml(state, e)}</p>`).join('\n\n') : '';
    case 'footnote-def':
      return '';
    default:
      return '';
  }
}

/**
 * @param {ExportState} state
 * @param {import('./org-elements.js').OrgElement[]} elements
 */
function elementsHtml(state, elements, ctx = {}) {
  /** @type {any[]} */ const parts = [];
  elements.forEach((el, i) => {
    const html = elementHtml(state, el, { ...ctx, first: i === 0 });
    if (html !== '') parts.push(html);
  });
  return parts.join('\n');
}

// ---- headings -----------------------------------------------------------------

/** @param {Heading} h */
function isCommented(h) {
  return /^COMMENT(\s|$)/.test(h.title || '');
}
const hasTag = (/** @type {any} */ h, /** @type {string} */ tag) => (h.tags || []).some((/** @type {any} */ t) => String(t).toLowerCase() === tag.toLowerCase());

/** @param {Heading} h */
function titleOf(h) {
  return h.title.replace(/^COMMENT\s*/, '');
}

/**
 * Which headings are exported: not COMMENT, not excluded by tag, only selected ones when `#+SELECT_TAGS:` is used.
 * @param {ExportState} state
 */
export function buildFilter(state) {
  const { doc, options } = state;
  const exclude = new Set((keywordValues(doc, 'EXCLUDE_TAGS').join(' ') || 'noexport').split(/\s+/).filter(Boolean).map((/** @type {any} */ t) => t.toLowerCase()));
  if (!keywordValues(doc, 'EXCLUDE_TAGS').length) exclude.add('noexport');
  const select = new Set(keywordValues(doc, 'SELECT_TAGS').join(' ').split(/\s+/).filter(Boolean).map((/** @type {any} */ t) => t.toLowerCase()));
  /** @param {Heading[]} list @returns {boolean} */
  const anyTagged = (list) => list.some((h) => (h.tags || []).some((t) => select.has(String(t).toLowerCase())) || anyTagged(h.children || []));
  if (select.size && !anyTagged(doc.children || [])) select.clear(); // no headline carries a select tag: everything is exported
  const selected = new Set();
  /**
   * @param {Heading[]} headings
   * @param {any} [inherited]
   */
  const mark = (headings, inherited) => {
    for (const h of headings) {
      const own = select.size && (h.tags || []).some((t) => select.has(String(t).toLowerCase()));
      if (own || inherited) selected.add(h);
      mark(h.children || [], own || inherited);
    }
  };
  if (select.size) mark(doc.children || [], false);
  const keepAncestor = new Set();
  /** @param {Heading[]} headings */
  const markAncestors = (headings) => {
    let any = false;
    for (const h of headings) {
      const sub = markAncestors(h.children || []);
      if (selected.has(h) || sub) {
        keepAncestor.add(h);
        any = true;
      }
    }
    return any;
  };
  if (select.size) markAncestors(doc.children || []);
  const done = new Set(state.doneKeywords);
  return (/** @type {any} */ h) => {
    if (!options.comments && isCommented(h)) return false;
    if ((h.tags || []).some((/** @type {any} */ t) => exclude.has(String(t).toLowerCase()))) return false;
    if (select.size && !keepAncestor.has(h)) return false;
    if (options.tasks !== true && h.todo) {
      if (options.tasks === false) return false;
      if (options.tasks === 'todo' && done.has(h.todo)) return false;
      if (options.tasks === 'done' && !done.has(h.todo)) return false;
    }
    return true;
  };
}

/** @param {Heading} h */
function isArchived(h) {
  return hasTag(h, 'ARCHIVE');
}

/**
 * The exported headings as a tree of { heading, children, number: [..] , level (relative) }.
 * @param {ExportState} state
 * @param {Heading[]} headings
 * @param {number} levelOffset
 * @param {(h: Heading) => boolean} filter
 * @param {number[]} numbers
 * @returns {OutlineNode[]}
 */
function buildOutline(state, headings, levelOffset, filter, numbers, /** @type {string | null} */ inherited = null) {
  /** @type {OutlineNode[]} */ const out = [];
  let n = 0;
  for (const heading of headings) {
    if (!filter(heading)) continue;
    const own = heading.properties && Object.keys(heading.properties).find((k) => k.toUpperCase() === 'UNNUMBERED');
    const unnumbered = own ? String(heading.properties[own]) : inherited;
    const isUnnumbered = unnumbered !== null && unnumbered.trim().toLowerCase() !== 'nil';
    if (!isUnnumbered) n++;
    const number = [...numbers, n];
    const archived = isArchived(heading) && state.options.arch !== true;
    if (archived && state.options.arch === false) {
      n--;
      continue;
    }
    const node = { heading, level: heading.level - levelOffset, number, archived, unnumbered: isUnnumbered ? unnumbered : null, children: /** @type {OutlineNode[]} */ ([]) };
    node.children = archived ? [] : buildOutline(state, heading.children || [], levelOffset, filter, number, unnumbered);
    out.push(node);
  }
  return out;
}

/**
 * @param {ExportState} state
 * @param {OutlineNode} node
 */
function headingTitleHtml(state, node, { inToc = false } = {}) {
  const { heading } = node;
  const { options } = state;
  const parts = [];
  if (heading.todo && options.todo) {
    const done = state.doneKeywords.includes(heading.todo);
    parts.push(`<span class="${done ? 'done' : 'todo'} ${escapeHtml(heading.todo)}">${escapeHtml(heading.todo)}</span>`);
  }
  if (heading.priority && options.pri) parts.push(`<span class="priority">[${escapeHtml(heading.priority)}]</span>`);
  parts.push(renderInline(state, titleOf(heading)) || '(untitled)');
  let html = parts.join(' ');
  if (options.tags && !(inToc && options.tags === 'not-in-toc') && heading.tags && heading.tags.length) {
    html += `${NBSP}${NBSP}${NBSP}<span class="tag">${heading.tags.map((t) => `<span class="${escapeAttr(String(t).replace(/[@#%]/g, '_'))}">${escapeHtml(t)}</span>`).join(NBSP)}</span>`;
  }
  return html;
}

/**
 * @param {ExportState} state
 * @param {OutlineNode} node
 */
function numberLabel(state, node) {
  const { num } = state.options;
  if (!num || node.unnumbered !== null) return '';
  if (typeof num === 'number' && node.level > num) return '';
  return `<span class="section-number-${node.level + 1}">${node.number.join('.')}.</span> `;
}

/**
 * @param {ExportState} state
 * @param {Heading} heading
 */
function planningHtml(state, heading) {
  if (!state.options.planning || !heading.planning) return '';
  const { closed, deadline, scheduled } = heading.planning;
  /**
   * @param {string} kw
   * @param {string | null} v
   */
  const stamp = (kw, v) => (v ? `<span class="timestamp-kwd">${kw}:</span> <span class="timestamp">${escapeHtml(v).replace(/^&lt;/, '&lt;')}</span>` : '');
  const parts = [stamp('CLOSED', closed), stamp('DEADLINE', deadline), stamp('SCHEDULED', scheduled)].filter(Boolean);
  return parts.length ? `<p><span class="timestamp-wrapper">${parts.join(' ')}</span></p>` : '';
}

/**
 * @param {ExportState} state
 * @param {Heading} heading
 * @param {OutlineNode | null} [node]
 */
function bodyHtml(state, heading, node = null) {
  const elements = state.parsed.get(heading) || parseElements((heading.bodyLines || []).slice());
  state.currentNode = node;
  return elementsHtml(state, elements);
}

/**
 * @param {ExportState} state
 * @param {OutlineNode} node
 * @param {Map<string, string>} [ids]
 */
function sectionHtml(state, node, ids) {
  const { heading } = node;
  const limit = state.options.H;
  const isStructural = node.level <= limit;
  const textPath = node.number.join('-');
  const id = state.headingIds.get(heading) || '';
  if (!isStructural) return '';
  const hl = Math.min(6, node.level + 1);
  let out = `<div id="outline-container-${escapeAttr(id)}" class="outline-${node.level + 1}">\n`;
  out += `<h${hl} id="${escapeAttr(id)}">${numberLabel(state, node)}${headingTitleHtml(state, node)}</h${hl}>\n`;
  const planning = planningHtml(state, heading);
  const body = node.archived ? '' : bodyHtml(state, heading, node);
  const deepChildren = node.children.filter((c) => c.level > limit);
  const content = [planning, body].filter(Boolean).join('\n');
  if (content) out += `<div class="outline-text-${node.level + 1}" id="text-${escapeAttr(textPath)}">\n${content}\n</div>\n`;
  const deep = deepChildren.length ? deepListHtml(state, deepChildren) : '';
  const structural = node.children.filter((c) => c.level <= limit);
  for (const child of structural) out += sectionHtml(state, child) + '\n';
  if (deep) out += deep + '\n';
  return out.replace(/\n+$/, '\n') + '</div>';
}

/**
 * Headings deeper than `#+OPTIONS: H:` become list items.
 * @param {ExportState} state
 * @param {OutlineNode[]} nodes
 */
function deepListHtml(state, nodes) {
  const num = state.options.num;
  const ordered = !!num && (num === true || nodes[0].level <= num);
  const tag = ordered ? 'ol' : 'ul';
  const items = nodes.map((node) => {
    const id = state.headingIds.get(node.heading) || '';
    let li = `<li><a id="${escapeAttr(id)}"></a>${headingTitleHtml(state, node)}<br${closing}\n`;
    const body = node.archived ? '' : bodyHtml(state, node.heading, node);
    if (body) li += `<div class="outline-text-${node.level + 1}" id="text-${escapeAttr(node.number.join('-'))}">\n${body}\n</div>\n`;
    if (node.children.length) li += deepListHtml(state, node.children) + '\n';
    return li + '</li>';
  });
  return `<${tag} class="org-${tag}">\n${items.join('\n')}\n</${tag}>`;
}

// ---- table of contents -----------------------------------------------------------

/**
 * @param {ExportState} state
 * @param {OutlineNode[]} nodes
 * @param {number} maxDepth
 * @returns {string}
 */
function tocListHtml(state, nodes, maxDepth, depth = 1) {
  const visible = nodes.filter((n) => n.level <= Math.min(state.options.H, maxDepth) && !/^notoc$/i.test((n.unnumbered || '').trim()));
  if (!visible.length) return '';
  const items = visible.map((node) => {
    const id = state.headingIds.get(node.heading) || '';
    const label = (state.options.num && node.unnumbered === null && !(typeof state.options.num === 'number' && node.level > state.options.num) ? node.number.join('.') + '. ' : '') + headingTitleHtml(state, node, { inToc: true }).replace(/<a [^>]*>([\s\S]*?)<\/a>/g, '$1');
    const sub = tocListHtml(state, node.children, maxDepth, depth + 1);
    return `<li><a href="#${escapeAttr(id)}">${label}</a>${sub ? '\n' + sub + '\n' : ''}</li>`;
  });
  return `<ul>\n${items.join('\n')}\n</ul>`;
}

/**
 * @param {ExportState} state
 * @param {number | true} depth
 * @param {OutlineNode[]} [nodes]
 */
function tocHtml(state, depth, nodes = state.outline) {
  const list = tocListHtml(state, nodes, depth === true ? Infinity : depth);
  if (!list) return '';
  return `<div id="table-of-contents" role="doc-toc">\n<h2>Table of Contents</h2>\n<div id="text-table-of-contents" role="doc-toc">\n${list}\n</div>\n</div>`;
}

/**
 * @param {ExportState} state
 * @param {OrgEl<'toc'>} el
 */
function tocKeywordHtml(state, el) {
  const v = el.value.trim();
  const m = /^(headlines|tables|listings)(?:\s+(\d+))?(\s+local)?/i.exec(v);
  if (!m) return '';
  const kind = m[1].toLowerCase();
  if (kind === 'headlines') {
    const depth = m[2] ? Number(m[2]) : true;
    if (m[3] && state.currentNode) return tocHtml(state, depth === true ? Infinity : state.currentNode.level + depth, state.currentNode.children);
    return tocHtml(state, depth);
  }
  const wanted = kind === 'tables' ? 'table' : 'listing';
  const entries = state.captioned.filter((c) => c.kind === wanted);
  if (!entries.length) return '';
  const title = wanted === 'table' ? 'List of Tables' : 'List of Listings';
  const label = wanted === 'table' ? 'table-number' : 'listing-number';
  const word = wanted === 'table' ? 'Table' : 'Listing';
  const slug = wanted === 'table' ? 'list-of-tables' : 'list-of-listings';
  const items = entries.map((c) => `<li><a href="#${escapeAttr(c.id)}"><span class="${label}">${word} ${c.n}:</span> ${c.html}</a></li>`);
  return `<div id="${slug}">\n<h2>${title}</h2>\n<div id="text-${slug}">\n<ul>\n${items.join('\n')}\n</ul>\n</div>\n</div>`;
}

// ---- footnotes -------------------------------------------------------------------

/** @param {ExportState} state */
function footnotesHtml(state) {
  if (!state.options.footnotes || !state.fnOrder.length) return '';
  const defs = [];
  for (let i = 0; i < state.fnOrder.length; i++) {
    const label = state.fnOrder[i];
    const n = i + 1;
    let body;
    if (state.fnInline.has(label)) body = state.fnInline.get(label);
    else if (state.fnDefs.has(label)) body = elementsHtml(state, state.fnDefs.get(label), { footnote: true });
    else body = '<p class="footpara">?</p>';
    // definitions are rendered with a leading footpara paragraph, as ox-html does
    defs.push(`<div class="footdef"><sup><a id="fn.${n}" class="footnum" href="#fnr.${n}" role="doc-backlink">${n}</a></sup> <div class="footpara" role="doc-footnote">${body}</div></div>`);
  }
  return `<div id="footnotes">\n<h2 class="footnotes">Footnotes: </h2>\n<div id="text-footnotes">\n\n${defs.join('\n\n')}\n\n</div>\n</div>`;
}

// ---- document --------------------------------------------------------------------

const PAGE_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; margin: 0; }
  #content { max-width: 60em; margin: 2rem auto; padding: 0 1rem; }
  .title { text-align: center; margin-bottom: 0.2em; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin-top: 1.6em; margin-bottom: 0.4em; break-after: avoid; page-break-after: avoid; }
  h2 { font-size: 1.6em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
  h3 { font-size: 1.3em; }
  h4 { font-size: 1.1em; }
  p { margin: 0.6em 0; }
  p.verse { margin-left: 3%; }
  .todo { font-family: monospace; color: #c00; font-weight: 700; }
  .done { font-family: monospace; color: #1a7f1a; font-weight: 700; }
  .priority { font-family: monospace; color: #c76b00; }
  .tag { background-color: #eee; font-family: monospace; padding: 2px; font-size: 80%; font-weight: normal; }
  .timestamp { color: #777; }
  .timestamp-kwd { color: #5f9ea0; }
  .org-right { margin-left: auto; margin-right: 0; text-align: right; }
  .org-left { margin-left: 0; margin-right: auto; text-align: left; }
  .org-center { margin-left: auto; margin-right: auto; text-align: center; }
  .underline { text-decoration: underline; }
  table { border-collapse: collapse; margin: 1em 0; break-inside: avoid; page-break-inside: avoid; border-top: 2px solid #444; border-bottom: 2px solid #444; }
  table[rules="all"], table[rules="rows"] { border: 1px solid #888; }
  thead { border-bottom: 1px solid #444; }
  tbody + tbody { border-top: 1px solid #444; }
  th, td { padding: 4px 10px; vertical-align: top; }
  th { font-weight: 600; }
  caption { margin-bottom: 0.4em; }
  caption.t-above { caption-side: top; }
  blockquote { border-left: 3px solid #ccc; margin: 1em 0; padding: 0.2em 1em; color: #555; }
  pre { background: #f6f6f6; border: 1px solid #e6e6e6; border-radius: 4px; padding: 0.8em; overflow: auto; font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 0.9em; margin: 1em 0; }
  pre.src { position: relative; }
  .org-src-name { display: block; font-size: 0.85em; color: #555; margin-top: 1em; }
  .linenr { font-size: smaller; color: #888; }
  .code-highlighted { background-color: #ffff00; }
  code { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 0.9em; }
  p code, li code { background: #f0f0f0; border-radius: 3px; padding: 0.1em 0.3em; }
  hr { border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }
  ul, ol { padding-left: 1.6em; }
  li { margin: 0.2em 0; }
  dt { font-weight: 600; }
  dd { margin-left: 1.6em; }
  img { max-width: 100%; }
  .figure { padding: 1em; break-inside: avoid; page-break-inside: avoid; }
  .figure p { text-align: center; }
  #table-of-contents ul { list-style: none; }
  sup a { text-decoration: none; }
  .footpara { display: inline; }
  .footdef { margin-bottom: 1em; }
  #footnotes { margin-top: 2em; font-size: 0.9em; color: #444; }
  #footnotes h2 { font-size: 1.1em; border-bottom: 1px solid #ddd; }
  .org-keyword { color: #8a2be2; font-weight: 600; }
  .org-string { color: #a31515; }
  .org-comment, .org-comment-delimiter { color: #6a737d; font-style: italic; }
  .org-constant { color: #0b6e99; }
  .org-builtin { color: #7a4e00; }
  .org-type { color: #267f99; }
  .org-function-name { color: #795e26; }
  .org-variable-name { color: #001080; }
  .org-preprocessor { color: #af00db; }
  .subtitle { text-align: center; font-weight: bold; margin-top: 0; }
  #postamble { margin-top: 3em; border-top: 1px solid #ddd; color: #666; }
  #postamble p, #preamble p { font-size: 90%; margin: 0.2em; }
  @media print {
    #content { max-width: none; margin: 0; padding: 0; }
    a { color: inherit; text-decoration: none; }
    pre { white-space: pre-wrap; word-break: break-word; overflow: visible; break-inside: avoid; page-break-inside: avoid; }
    li, tr, dt, dd { break-inside: avoid; page-break-inside: avoid; }
    img { break-inside: avoid; }
    thead { display: table-header-group; }
  }
`;

/**
 * Exports `doc` (or the subtree at `scope`) to a complete standalone HTML document.
 * @param {Doc} doc
 * @param {Heading | null} [scope]
 * @param {Parameters<typeof exportToHtmlDocument>[2]} [options]
 */
export function exportToHtml(doc, scope = null, options = {}) {
  return finishDropped(exportToHtmlDocument(doc, scope, options));
}

/**
 * Exports `doc` (or the subtree at `scope`) to a complete standalone HTML document.
 * A subtree export is titled after its heading; the heading's own text comes first, then its children as sections.
 * @param {Doc} doc
 */
function exportToHtmlDocument(doc, scope = /** @type {any} */ (null), { images = /** @type {any} */ (null), defaults = /** @type {import('./export-defaults.js').HtmlExportDefaults} */ ({}) } = {}) {
  const prepared = prepareHtmlExport(doc, scope, { images, defaults });
  ({ doc, scope } = prepared);
  const { state, preElements, preamble, doctype } = prepared;
  return finishHtmlDocument(state, doc, scope, preElements, preamble, defaults, doctype);
}

/**
 * Everything an export needs before anything is written: the state with its headings, ids, targets, footnotes, radio targets and citations worked out.
 * @param {Doc} doc
 * @param {import('./types.js').Heading | null} scope
 * @param {{ images?: Map<string, string> | null, defaults?: import('./export-defaults.js').HtmlExportDefaults }} [extra]
 */
function prepareHtmlExport(doc, scope, { images = null, defaults = {} } = {}) {
  ({ doc, scope } = foldInlineTasks(doc, scope));
  activeImages = images instanceof Map ? images : new Map();
  // #+HTML_DOCTYPE:, else org-html-doctype, else Org's own default
  const doctype = doctypeInfo(keywordValue(doc, 'HTML_DOCTYPE') || defaults.doctype);
  closing = doctype.close;
  html5Page = doctype.html5;
  const state = createState(doc, scope, defaults);
  state.namedElements = new Map();
  state.fnDefsCollect = (/** @type {any} */ elements) => {
    for (const el of elements) if (el.type === 'footnote-def') state.fnDefs.set(el.label, el.children);
  };
  const passes = buildFilter(state);
  const filter = (/** @type {any} */ h) => h.title.replace(/^COMMENT\s*/, '').trim() !== 'Footnotes' && passes(h); // Org keeps its footnote section out of the export

  const roots = scope ? scope.children || [] : doc.children || [];
  const levelOffset = scope ? scope.level : 0;
  state.outline = buildOutline(state, roots, levelOffset, filter, []);

  // ids: CUSTOM_ID, else a slug of the title
  /** @param {any} [nodes] */
  const assign = (nodes) => {
    for (const node of nodes) {
      const custom = getProperty(node.heading, 'CUSTOM_ID');
      const base = custom && custom.trim() ? custom.trim() : slugify(titleOf(node.heading));
      let id = base;
      for (let n = 2; state.usedIds.has(id); n++) id = base + '-' + n;
      state.usedIds.add(id);
      state.headingIds.set(node.heading, id);
      state.headingNodes.set(node.heading, node);
      assign(node.children);
    }
  };
  assign(state.outline);

  // citations: the exported headings (not the commented or excluded ones) decide which keys are cited, and in what order
  /** @param {any[]} nodes @returns {any[]} */
  const exported = (nodes) => nodes.map((n) => ({ ...n.heading, children: exported(n.children) }));
  state.cite = citeExportFor(doc, exported(state.outline), parseInline, !scope);

  // footnote definitions and radio/inline targets are found before anything is rendered
  const preamble = scope ? scope.bodyLines || [] : preambleBody(doc);
  const preElements = parseElements(preamble);
  state.fnDefsCollect(preElements);
  state.parsed = new Map();
  state.captioned = [];
  let tableN = 0;
  let listingN = 0;
  /** @param {any} [elements] */
  const scan = (elements) => {
    for (const el of elements) {
      if (el.type === 'block' && (el.name === 'src' || el.name === 'example')) prepareCode(state, el);
      const cap = el.aff && el.aff.caption.length ? el.aff.caption[el.aff.caption.length - 1].text : null;
      if (el.type === 'table' && (cap !== null || (el.aff && el.aff.name))) {
        el.__id = (el.aff && el.aff.name) || uniqueId(state, 'table-' + (tableN + 1));
        if (el.aff && el.aff.name) state.namedElements.set(el.aff.name, el.__id);
        if (cap !== null) state.captioned.push({ kind: 'table', n: ++tableN, id: el.__id, html: renderInline(state, cap) });
      } else if (el.type === 'block' && el.name === 'src' && (cap !== null || (el.aff && el.aff.name))) {
        el.__id = (el.aff && el.aff.name) || uniqueId(state, 'listing-' + (listingN + 1));
        if (el.aff && el.aff.name) state.namedElements.set(el.aff.name, el.__id);
        if (cap !== null) state.captioned.push({ kind: 'listing', n: ++listingN, id: el.__id, html: renderInline(state, cap) });
      } else if (el.type === 'list') for (const item of el.items) scan(item.children);
      else if (el.type === 'drawer') scan(nestedElements(state, el.lines, false));
      else if (el.type === 'block' && !['src', 'example', 'comment', 'export', 'verse'].includes(el.name)) scan(nestedElements(state, el.lines));
    }
  };
  scan(preElements);
  /** @param {any} [nodes] */
  const collect = (nodes) => {
    for (const node of nodes) {
      const els = parseElements(node.heading.bodyLines || []);
      state.parsed.set(node.heading, els);
      scan(els);
      state.fnDefsCollect(els);
      for (const t of targetsInLines(node.heading.bodyLines || [])) {
        targetId(state, t.name);
        const key = t.name.trim().replace(/\s+/g, ' ').toLowerCase();
        if (!state.targetHeadings.has(key)) state.targetHeadings.set(key, node);
      }
      collect(node.children);
    }
  };
  collect(state.outline);
  // the definitions in the Footnotes section are still found, though the section itself is not exported
  /** @param {any[]} headings */
  const sectionDefs = (headings) => {
    for (const h of headings) {
      if (h.title.replace(/^COMMENT\s*/, '').trim() === 'Footnotes') state.fnDefsCollect(parseElements(h.bodyLines || []));
      sectionDefs(h.children || []);
    }
  };
  sectionDefs(state.doc.children || []);
  for (const t of targetsInLines(preamble)) targetId(state, t.name);

  const radio = new Set();
  /** @param {string[]} lines */
  const scanRadio = (lines) => {
    for (const t of targetsInLines(lines)) if (t.radio) radio.add(t.name.trim());
  };
  scanRadio(preamble);
  /** @param {any} [nodes] */
  const radioWalk = (nodes) => {
    for (const node of nodes) {
      scanRadio(node.heading.bodyLines || []);
      radioWalk(node.children);
    }
  };
  radioWalk(state.outline);
  if (radio.size) {
    const names = [...radio].sort((a, b) => b.length - a.length).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
    state.radioRe = new RegExp('(?<![\\w])(?:' + names.join('|') + ')(?![\\w])', 'gi');
  }

  return { doc, scope, state, preElements, preamble, doctype };
}

/**
 * @param {ExportState} state @param {Doc} doc @param {import('./types.js').Heading | null} scope @param {import('./org-elements.js').OrgElement[]} preElements @param {string[]} preamble @param {import('./export-defaults.js').HtmlExportDefaults} defaults @param {ReturnType<typeof doctypeInfo>} doctype
 */
function finishHtmlDocument(state, doc, scope, preElements, preamble, defaults, doctype) {
  const { options } = state;
  const out = [];
  const title = scope ? titleOf(scope) : keywordValue(doc, 'TITLE');
  const subtitle = !scope && options.title ? keywordValue(doc, 'SUBTITLE') : null;
  if (title && options.title) {
    const sub = subtitle ? `<br>\n<span class="subtitle">${renderInline(state, subtitle)}</span>\n` : '';
    out.push(`<h1 class="title">${renderInline(state, title)}${sub}</h1>`);
  }
  const toc = options.toc && !scope ? tocHtml(state, options.toc) : options.toc && scope ? tocHtml(state, options.toc) : '';
  if (toc) out.push(toc);
  const lead = [scope ? planningHtml(state, scope) : '', elementsHtml(state, preElements)].filter(Boolean).join('\n');
  if (lead) out.push(lead);
  for (const node of state.outline) {
    if (node.level <= options.H) out.push(sectionHtml(state, node));
  }
  const deepTop = state.outline.filter((n) => n.level > options.H);
  if (deepTop.length) out.push(deepListHtml(state, deepTop));
  const footnotes = footnotesHtml(state);
  if (footnotes) out.push(footnotes);

  const post = [];
  if (!scope) {
    const date = keywordValue(doc, 'DATE');
    const author = keywordValue(doc, 'AUTHOR');
    const email = keywordValue(doc, 'EMAIL');
    if (options.date && date) post.push(`<p class="date">Date: ${escapeHtml(date)}</p>`);
    if (options.author && author) post.push(`<p class="author">Author: ${escapeHtml(author)}</p>`);
    if (options.email && email) post.push(`<p class="email">Email: <a href="mailto:${escapeAttr(email)}">${escapeHtml(email)}</a></p>`);
    if (options.creator) post.push('<p class="creator">Generated by org-pwa</p>');
  }
  const specValues = () => {
    const email = keywordValue(doc, 'EMAIL');
    const subtitle = keywordValue(doc, 'SUBTITLE');
    const stamp = metadataTimestamp(new Date());
    return {
      t: title ? renderInline(state, title) : '',
      s: subtitle ? renderInline(state, subtitle) : '',
      a: escapeHtml(keywordValue(doc, 'AUTHOR') || ''),
      d: escapeHtml(keywordValue(doc, 'DATE') || ''),
      e: email ? `<a href="mailto:${escapeAttr(email)}">${escapeHtml(email)}</a>` : '',
      c: 'Generated by org-pwa',
      C: stamp,
      T: stamp,
      v: '',
    };
  };
  const postamble = typeof options.postamble === 'string'
    ? `<div id="postamble" class="status">\n${formatSpec(options.postamble, specValues())}\n</div>\n`
    : options.postamble !== false && post.length ? `<div id="postamble" class="status">\n${post.join('\n')}\n</div>\n` : '';
  const preambleDiv = typeof options.preamble === 'string' ? `<div id="preamble" class="status">\n${formatSpec(options.preamble, specValues())}\n</div>\n` : '';
  const docTitle = escapeHtml(scope ? titleOf(scope) : title ? stripMarkup(title) : 'Untitled');
  const lang = (keywordValue(doc, 'LANGUAGE') || 'en').replace(/[^A-Za-z-]/g, '') || 'en';
  const meta = [];
  const author = keywordValue(doc, 'AUTHOR');
  if (author && options.author) meta.push(`<meta name="author" content="${escapeAttr(author)}" />`);
  const description = keywordValue(doc, 'DESCRIPTION');
  if (description) meta.push(`<meta name="description" content="${escapeAttr(description)}" />`);
  const keywords = keywordValue(doc, 'KEYWORDS');
  if (keywords) meta.push(`<meta name="keywords" content="${escapeAttr(keywords)}" />`);
  const head = [defaults.head, getHtmlHead(doc), ...keywordValues(doc, 'HTML_HEAD_EXTRA')].filter(Boolean).join('\n');
  return (
    xmlDeclaration(doctype) +
    doctype.declaration +
    '\n' +
    htmlTag(doctype, lang) +
    '\n' +
    '<head>\n' +
    charsetMeta(doctype) +
    '\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    `<title>${docTitle}</title>\n` +
    meta.map((m) => m + '\n').join('') +
    '<meta name="generator" content="org-pwa" />\n' +
    `<style>${PAGE_CSS}</style>\n` +
    (state.math ? `<style>${KATEX_EXPORT_CSS}</style>\n` : '') +
    (head ? head + '\n' : '') +
    '</head>\n' +
    '<body>\n' +
    preambleDiv +
    '<div id="content" class="content">\n' +
    out.join('\n') +
    '\n</div>\n' +
    postamble +
    (state.usesCoderef ? `<script>\n${CODE_HIGHLIGHT_SCRIPT}</script>\n` : '') +
    '</body>\n' +
    '</html>\n'
  );
}

/** The text of a quoted #+OPTIONS value ("a\nb" is two lines, \" a quote), as Emacs reads a Lisp string; null for t, auto and the like.
 * @param {string} v */
function lispString(v) {
  if (!/^".*"$/s.test(v)) return null;
  return v.slice(1, -1).replace(/\\(.)/gs, (_m, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

/** The date and time as org-html-metadata-timestamp-format writes it: 2026-03-04 Wed 05:06. */
function metadataTimestamp(/** @type {Date} */ d) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The text of org-html-preamble / org-html-postamble as a string: %t title, %s subtitle, %a author, %d date, %e email link,
 *  %c creator, %C and %T when it was exported, %% a percent sign. (%v, the validator link, is left empty.)
 * @param {string} template
 * @param {Record<string, string>} values */
function formatSpec(template, values) {
  return template.replace(/%([a-zA-Z%])/g, (m, c) => (c === '%' ? '%' : c in values ? values[c] : m));
}

/** @param {string} text */
const stripMarkup = (text) => text.replace(/[*/_+=~]([^*/_+=~\s][^*/_+=~]*)[*/_+=~]/g, '$1');

/** The lines before the first heading, with the `#+KEY:` lines the parser pulled out put back where they were
 * @param {Doc} doc
 *  (all of them but the file-level settings), so `#+CAPTION:`, `#+HTML:` and `#+TOC:` there still count. */
export function preambleBody(doc) {
  const lines = (doc.bodyLines || []).slice();
  const FILE_LEVEL = /^(TITLE|AUTHOR|DATE|EMAIL|OPTIONS|LANGUAGE|DESCRIPTION|KEYWORDS|EXCLUDE_TAGS|SELECT_TAGS|TODO|SEQ_TODO|TYP_TODO|TAGS|STARTUP|PROPERTY|ARCHIVE|CATEGORY|COLUMNS|PRIORITIES|MACRO|HTML_HEAD|HTML_HEAD_EXTRA|SETUPFILE|LATEX_\w*|ODT_\w*|HTML_\w*|FILETAGS|CONSTANTS|LINK|SUBTITLE|CREATOR)$/i;
  /** @param {any} [k] */
  const keywords = (doc.keywords || []).filter((k) => !FILE_LEVEL.test(k.key));
  for (const k of keywords.slice().reverse()) lines.splice(Math.min(k.bodyLineIndex || 0, lines.length), 0, `#+${k.key}: ${k.value}`);
  return lines;
}


/**
 * What the slide exporter (export-slides.js) takes from this one: a heading's own text and a line of inline text as HTML, set up once
 * for the whole document so links, footnotes and numbering agree across slides.
 * @param {Doc} doc
 * @param {{ images?: Map<string, string> | null, defaults?: import('./export-defaults.js').HtmlExportDefaults }} [extra]
 */
export function createSlideRenderer(doc, extra = {}) {
  const prepared = prepareHtmlExport(doc, null, extra);
  const { state } = prepared;
  /** @type {Map<Heading, OutlineNode>} */
  const nodes = new Map();
  /** @param {OutlineNode[]} list */
  const walk = (list) => list.forEach((n) => (nodes.set(n.heading, n), walk(n.children)));
  walk(state.outline);
  return {
    doc: prepared.doc,
    options: state.options,
    /** Is the heading part of the export (not commented, archived or excluded)? @param {Heading} h */
    included: (h) => nodes.has(h),
    /** The text of a heading, without what is below it. @param {Heading} h */
    body: (h) => {
      const node = nodes.get(h);
      return node && node.archived ? '' : bodyHtml(state, h, node || null);
    },
    /**
     * A heading's text one element at a time, so a list can be shown a step at a time: each list says its `:overlay` and each item's own `<spec>`.
     * @param {Heading} h
     * @returns {{ html: string, list: { overlay: string, items: (string | null)[], tag: string } | null }[]}
     */
    parts: (h) => {
      const node = nodes.get(h);
      if (!node || node.archived) return [];
      state.currentNode = node;
      const elements = state.parsed.get(h) || parseElements((h.bodyLines || []).slice());
      return elements.map((el) => ({
        html: elementsHtml(state, [el]),
        list:
          el.type === 'list'
            ? {
                overlay: parseAttributes(el.aff && el.aff.attr.beamer).overlay || '',
                tag: el.listType === 'ordered' ? 'ol' : el.listType === 'descriptive' ? 'dl' : 'ul',
                items: el.items.map((item) => {
                  const first = item.children[0];
                  const lead = first && first.type === 'paragraph' ? leadingOverlay(first.lines[0].trimStart()) : null;
                  return lead ? lead.overlay : null;
                }),
              }
            : null,
      }));
    },
    /** The text before the first heading. */
    lead: () => elementsHtml(state, prepared.preElements),
    /** @param {string} text */
    inline: (text) => renderInline(state, text),
    footnotes: () => footnotesHtml(state),
    /** The style for math, when a slide has any. */
    mathCss: () => (state.math ? KATEX_EXPORT_CSS : ''),
    /** The script for code references, when a slide has any. */
    script: () => (state.usesCoderef ? CODE_HIGHLIGHT_SCRIPT : ''),
  };
}
