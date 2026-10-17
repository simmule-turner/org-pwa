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
 * Not yet: images, `#+ATTR_LATEX` beyond `:align`, entities, citations, `#+INCLUDE`, `#+TOC`, babel `:exports`, other
 * link types (file, id, custom targets), the `listings` backend.
 */

import { parseElements } from './org-elements.js';
import { parseInline } from './inline-markup.js';
import { parseExportOptions, getDocTitle, getDocAuthor, getDocDate } from './export-options.js';
import { preambleBody } from './export-html.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').InlineNode} InlineNode */
/** @typedef {import('./org-elements.js').OrgElement} OrgElement */
/** @typedef {{ label: string, title: string }} HeadingRef */
/**
 * @typedef {{
 *   sup: string,
 *   footnotes: Map<string, OrgElement[]>,
 *   footnoteLabels: Map<string, string>,
 *   targets: Map<string, HeadingRef>,
 *   labels: Map<Heading, string>,
 *   anon: number,
 *   inLink: boolean,
 *   parsed: Map<string[], OrgElement[]>,
 * }} LatexState
 */

/** Marks a forced line break (`\\` at the end of a line) through the inline parser. */
const BREAK = '\uE000';
const LINE_BREAK_RE = /\\\\[ \t]*$/;
/** A LaTeX command written in the text (`\textbf{x}`, `\alpha`, `\-`) goes through as written, like Org does. */
const COMMAND_RE = /\\(?:[A-Za-z]+\*?(?:\{[^{}\n]*\}|\[[^\][{}\n]*\])*|-)/g;
const TIMESTAMP_RE = /([<[])(\d{4}-\d{2}-\d{2})(?: ([^\s\d>\]+-]+))?(?: (\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?)?((?: [.+]?\+\d+[hdwmy](?:\/\d+[hdwmy])?| -\d+[hdwmy])*)([>\]])(?:--([<[])(\d{4}-\d{2}-\d{2})(?: ([^\s\d>\]+-]+))?(?: (\d{1,2}:\d{2}))?([>\]]))?/g;
const NUMBER_RE = /^([<>]?[-+^.0-9]*[0-9][-+^.0-9eEdDx()%:]*|0[xX][0-9a-fA-F]+|nan|[-+u]?inf)$/;
const COOKIE_RE = /^<[lrc]?\d*>$/;
const COOKIE_ONLY_RE = /^<[lrc]\d*>$|^<\d+>$/;

/** @type {LatexState} */
let S = newState();

/** @returns {LatexState} */
function newState() {
  return { sup: 't', footnotes: new Map(), footnoteLabels: new Map(), targets: new Map(), labels: new Map(), anon: 0, inLink: false, parsed: new Map() };
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

/** Plain text: commands kept, special characters escaped, `...` as `\ldots{}`, forced breaks as `\\[0pt]`. @param {string} s */
function plain(s) {
  let out = '';
  let last = 0;
  for (const m of s.matchAll(COMMAND_RE)) {
    out += plainPiece(s.slice(last, m.index)) + m[0];
    last = (m.index || 0) + m[0].length;
  }
  return out + plainPiece(s.slice(last));
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
  const marked = text.split('\n').map((l) => (LINE_BREAK_RE.test(l) ? l.replace(LINE_BREAK_RE, BREAK) : l)).join('\n');
  return nodes(parseInline(marked, { subSuperscriptMode: S.sup }));
}

/** @param {InlineNode[]} list */
function nodes(list) {
  return list.map(node).join('');
}

/** @param {string} url */
const isExternal = (url) => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url) && !/^(file|id|help|elisp|shell|attachment):/.test(url);

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
      return footnoteRef(n.label, n.children);
    case 'target':
    case 'radio-target':
      return protect(n.value || '');
    default:
      return '';
  }
}

/** Math is passed through as written; `$x$` becomes `\(x\)`. @param {Extract<InlineNode, { type: 'latex' }>} n */
function latexFragment(n) {
  if (n.raw && !/^\$[^$]/.test(n.raw)) return n.raw;
  return n.displayMode ? '\\[' + n.source + '\\]' : '\\(' + n.source + '\\)';
}

/** @param {Extract<InlineNode, { type: 'link' }>} n */
function link(n) {
  const target = n.target;
  if (S.inLink) return protect(n.description === null ? target : n.description);
  S.inLink = true;
  const description = n.description === null ? null : inline(n.description);
  S.inLink = false;
  if (isExternal(target)) return description === null ? '\\url{' + target + '}' : '\\href{' + protect(target) + '}{' + description + '}';
  const key = target.startsWith('*') ? target.slice(1) : target.startsWith('#') ? target : null;
  const ref = key === null ? null : S.targets.get(key);
  if (ref) return '\\hyperref[' + ref.label + ']{' + (description === null ? protect(ref.title) : description) + '}';
  return description === null ? protect(target) : description;
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
  return '\\footnote{' + elements(def).replace(/\n+$/, '') + '\\label{' + id + '}}';
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
  for (const el of list) {
    const text = element(el);
    if (!text) continue;
    if (el.type === 'hr' && out && !out.endsWith('\n\n')) out += '\n';
    out += text + '\n'.repeat(el.postBlank || 0);
  }
  return out;
}

/** @param {string} s */
const trimEnd = (s) => s.replace(/\n+$/, '') + '\n';

/** @param {OrgElement} el @returns {string} */
function element(el) {
  switch (el.type) {
    case 'paragraph':
      return inline([el.lines[0].trimStart(), ...el.lines.slice(1)].join('\n')) + '\n';
    case 'list':
      return list(el, 1);
    case 'table':
      return table(el);
    case 'block':
      return block(el);
    case 'fixed':
      return verbatim(el.lines) + '\n';
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

/** @param {Extract<OrgElement, { type: 'block' }>} el */
function block(el) {
  const lead = Math.min(Infinity, ...el.lines.filter((l) => l.trim()).map((l) => (/^[ \t]*/.exec(l) || [''])[0].length));
  const lines = el.lines.map((l) => l.slice(Number.isFinite(lead) ? Math.min(lead, (/^[ \t]*/.exec(l) || [''])[0].length) : 0));
  switch (el.name) {
    case 'src':
    case 'example':
      return verbatim(lines.map((l) => l.replace(/^(\s*),(\*|#\+)/, '$1$2')));
    case 'comment':
      return '';
    case 'export':
      return /^latex\b/i.test(el.params) ? lines.join('\n') + '\n' : '';
    case 'quote':
    case 'center':
      return '\\begin{' + el.name + '}\n' + trimEnd(elements(parsedLines(lines))) + '\\end{' + el.name + '}\n';
    case 'verse':
      return '\\begin{verse}\n' + lines.map(verseLine).join('') + '\\end{verse}\n';
    default:
      return '\\begin{' + el.name + '}\n' + trimEnd(elements(parsedLines(lines))) + '\\end{' + el.name + '}\n';
  }
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
  const env = el.listType === 'ordered' ? 'enumerate' : el.listType === 'descriptive' ? 'description' : 'itemize';
  const counter = ['enumi', 'enumii', 'enumiii', 'enumiv'][Math.min(depth, 4) - 1];
  let out = '\\begin{' + env + '}\n';
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
  const rows = el.rows.map((r) => ('rule' in r && r.rule ? null : (r.cells || []).map((c) => c.trim())));
  const cookieRow = (/** @type {string[] | null} */ cells) => !!cells && cells.some((c) => COOKIE_RE.test(c) && c !== '<>') && cells.every((c) => c === '' || COOKIE_RE.test(c));
  /** @type {string[]} */
  const cookies = [];
  const kept = rows.filter((cells) => {
    if (!cookieRow(cells)) return true;
    /** @type {string[]} */ (cells).forEach((c, i) => {
      if (COOKIE_ONLY_RE.test(c) && /[lrc]/.test(c)) cookies[i] = c.replace(/[^lrc]/g, '');
    });
    return false;
  });
  const standard = kept.filter((r) => r !== null);
  const width = Math.max(0, ...standard.map((r) => /** @type {string[]} */ (r).length));
  const attr = (el.aff && el.aff.attr.latex ? el.aff.attr.latex.join(' ') : '');
  const alignMatch = /:align\s+(\S+)/.exec(attr);
  let spec = '';
  if (alignMatch) spec = alignMatch[1];
  else {
    for (let c = 0; c < width; c++) {
      if (cookies[c]) {
        spec += cookies[c];
        continue;
      }
      const numeric = standard.filter((r) => NUMBER_RE.test(/** @type {string[]} */ (r)[c] || '')).length;
      spec += standard.length && numeric / standard.length >= 0.5 ? 'r' : 'l';
    }
  }
  const body = kept.map((cells) => (cells === null ? '\\hline\n' : cells.map(inline).join(' & ') + '\\\\[0pt]\n')).join('');
  const tabular = '\\begin{tabular}{' + spec + '}\n' + body + '\\end{tabular}\n';
  const caption = el.aff && el.aff.caption.length ? el.aff.caption[el.aff.caption.length - 1] : null;
  if (!caption) return '\\begin{center}\n' + tabular + '\\end{center}\n';
  const label = el.aff && el.aff.name ? '\\label{tab:org' + hash7('tab:' + el.aff.name) + '}' : '';
  const short = caption.short ? '[' + inline(caption.short) + ']' : '';
  return '\\begin{table}[htbp]\n\\caption' + short + '{' + label + inline(caption.text) + '}\n\\centering\n' + tabular + '\\end{table}\n';
}

// ---- headings -------------------------------------------------------------

const SECTIONS = {
  article: ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'],
  report: ['part', 'chapter', 'section', 'subsection', 'subsubsection'],
  book: ['part', 'chapter', 'section', 'subsection', 'subsubsection'],
};

const keywordList = (/** @type {Doc} */ doc, /** @type {string} */ key) => (doc.keywords || []).filter((k) => k.key.toUpperCase() === key).map((k) => k.value.trim());

/** Which headings are exported: not COMMENT, not tagged for exclusion (`#+EXCLUDE_TAGS:`, `noexport` by default). @param {Doc} doc */
function exclusion(doc) {
  const tags = keywordList(doc, 'EXCLUDE_TAGS').join(' ').split(/\s+/).filter(Boolean);
  const exclude = new Set(tags.length ? tags : ['noexport']);
  return (/** @type {Heading} */ h) => /^COMMENT(\s|$)/.test(h.title) || h.tags.some((t) => exclude.has(t));
}

/** @param {Heading} h */
function headingTitle(h) {
  const todo = h.todo ? '{\\bfseries\\sffamily ' + protect(h.todo) + '} ' : '';
  const tags = h.tags.length ? '\\hfill{}\\textsc{' + h.tags.map(protect).join(':') + '}' : '';
  return todo + inline(h.title) + tags;
}

/**
 * @typedef {{ doc: Doc, kind: 'article' | 'report' | 'book', depth: number, numbered: boolean, skip: (h: Heading) => boolean, path: number[] }} HeadingCtx
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
    if (h.level - base > ctx.depth) {
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
  const name = SECTIONS[ctx.kind][Math.min(h.level - base, 5) - 1];
  const out = '\\' + name + (ctx.numbered ? '' : '*') + '{' + headingTitle(h) + '}\n\\label{' + labelFor(h, ctx) + '}\n';
  return out + headingBody(h, ctx, base);
}

/** @param {Heading} h @param {HeadingCtx} ctx @param {number} base */
function headingBody(h, ctx, base) {
  const lines = h.bodyLines || [];
  let lead = 0;
  while (lead < lines.length && !lines[lead].trim()) lead++;
  if ((h.propertyOrder || []).length || Object.values(h.planning || {}).some(Boolean)) lead = 0; // Org drops the blank line after a property drawer or planning line
  const text = elements(parsedLines(lines));
  const body = text ? '\n'.repeat(lead) + text : '';
  return body + headings(h.children || [], ctx, base);
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
    S.targets.set(h.title, ref);
    const custom = h.properties && h.properties.CUSTOM_ID;
    if (custom) S.targets.set('#' + custom.trim(), ref);
    indexHeadings(h.children || [], { ...ctx, path });
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

/** @param {string} s */
const firstLine = (s) => s.replace(/\s*\n\s*/g, ' ').trim();

/**
 * The document as LaTeX. `scope` exports one heading's subtree instead of the whole file.
 * @param {Doc} doc
 * @param {Heading | null} [scope]
 */
export function exportToLatex(doc, scope = null) {
  S = newState();
  const options = parseExportOptions(doc);
  S.sup = options.sup;
  const first = (/** @type {string} */ key) => keywordList(doc, key)[0];

  const declared = (first('LATEX_CLASS') || 'article').trim();
  const kind = /** @type {'article' | 'report' | 'book'} */ (declared in SECTIONS ? declared : 'article');
  const compiler = (first('LATEX_COMPILER') || 'pdflatex').trim();
  const classOptions = (first('LATEX_CLASS_OPTIONS') || '[11pt]').replace(/^\s*\[?/, '[').replace(/\]?\s*$/, ']');
  const unicodeCompiler = compiler !== 'pdflatex';

  const skip = exclusion(doc);
  const ctx = { doc, kind, depth: headlineLevels(doc), numbered: options.num !== false, skip, path: /** @type {number[]} */ ([]) };
  const roots = scope ? scope.children || [] : doc.children || [];
  const base = scope ? scope.level : 0;
  indexHeadings(roots, ctx);

  const preamble = scope ? scope.bodyLines || [] : preambleBody(doc);
  for (const lines of [preamble, ...collectBodies(roots, skip)]) {
    for (const el of parsedLines(lines)) if (el.type === 'footnote-def') S.footnotes.set(el.label, el.children);
  }

  const title = scope ? getDocTitle(doc) || scope.title : getDocTitle(doc);
  const author = getDocAuthor(doc);
  const date = getDocDate(doc);
  const lang = (first('LANGUAGE') || 'en').trim().split(/[-_]/)[0];

  const head = [
    '% Intended LaTeX compiler: ' + compiler,
    '\\documentclass' + classOptions + '{' + declared + '}',
    ...(unicodeCompiler ? [] : ['\\usepackage[utf8]{inputenc}', '\\usepackage[T1]{fontenc}']),
    '\\usepackage{graphicx}',
    '\\usepackage{longtable}',
    '\\usepackage{wrapfig}',
    '\\usepackage{rotating}',
    '\\usepackage[normalem]{ulem}',
    '\\usepackage{amsmath}',
    '\\usepackage{amssymb}',
    '\\usepackage{capt-of}',
    '\\usepackage{hyperref}',
    ...keywordList(doc, 'LATEX_HEADER'),
    ...keywordList(doc, 'LATEX_HEADER_EXTRA'),
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
    '\\begin{document}',
    '',
  ];
  if (title) head.push('\\maketitle');
  if (options.toc) {
    if (typeof options.toc === 'number') head.push('\\setcounter{tocdepth}{' + options.toc + '}');
    head.push('\\tableofcontents', '');
  }

  const body = elements(parsedLines(preamble)) + headings(roots, ctx, base);
  return head.join('\n') + '\n' + (body ? trimEnd(body) : '') + '\\end{document}\n';
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
