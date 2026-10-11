// @ts-check
/**
 * HTML export, following Org's own `ox-html`: the same document structure (outline containers, `h2` for top-level
 * headings under an `h1` title, `org-ul` / `org-ol` / `org-dl` lists, tables with a `colgroup` and a `thead`, figures,
 * verse, center and special blocks, a numbered Footnotes section, timestamps, entities) and the same `#+OPTIONS:`
 * switches, so that Org's own CSS and Emacs's output are interchangeable with this. The page carries print-aware CSS,
 * which is how an export becomes a PDF: the browser's Print > Save as PDF.
 *
 * Differences from Emacs are deliberate: no `htmlize` syntax colouring, MathJax is replaced by KaTeX, `#+INCLUDE:`
 * and `#+SETUPFILE:` need files this page cannot read, element ids are readable slugs instead of hashes, and
 * checkboxes are real (disabled) `<input>` elements.
 */

import { parseInline, extractLatexFragments } from './inline-markup.js';
import { parseElements, parseAttributes } from './org-elements.js';
import { ENTITIES } from './entities.js';
import { resolveTodoSequence } from './todo-cycle.js';
import { resolveLinkTarget } from './link-resolve.js';
import { renderMathHtml } from './math-render.js';
import { KATEX_EXPORT_CSS } from './katex-export-css.js';
import { getHtmlHead } from './export-options.js';
import { getProperty } from './archive-model.js';
import { highlightToHtml } from './syntax-highlight.js';

// ---- options ------------------------------------------------------------------

/** What `#+OPTIONS:` can switch, with Org's defaults. */
export function parseHtmlOptions(doc) {
  /** @type {Record<string, any>} */
  const o = {
    toc: true,
    num: true,
    H: 3,
    tags: true,
    todo: true,
    pri: false,
    brk: false,
    sup: 't',
    special: true,
    emph: true,
    entities: true,
    footnotes: true,
    stat: true,
    tasks: true,
    planning: false,
    author: true,
    date: true,
    email: false,
    creator: false,
    title: true,
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
      case 'pri': o.pri = v === 't'; break;
      case '\\n': o.brk = v === 't'; break;
      case '^': o.sup = v === 'nil' || v === '{}' ? v : 't'; break;
      case '-': o.special = !isNil(v); break;
      case '*': o.emph = !isNil(v); break;
      case 'e': o.entities = !isNil(v); break;
      case 'f': o.footnotes = !isNil(v); break;
      case 'stat': o.stat = !isNil(v); break;
      case 'tasks': o.tasks = isNil(v) ? false : v === 'todo' || v === 'done' ? v : true; break;
      case 'p': o.planning = v === 't'; break;
      case 'author': o.author = !isNil(v); break;
      case 'date': o.date = !isNil(v); break;
      case 'email': o.email = v === 't'; break;
      case 'creator': o.creator = v === 't'; break;
      case 'title': o.title = !isNil(v); break;
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

const keywordValue = (doc, key) => {
  const kw = (doc.keywords || []).filter((k) => k.key.toUpperCase() === key).pop();
  return kw ? kw.value.trim() : null;
};
const keywordValues = (doc, key) => (doc.keywords || []).filter((k) => k.key.toUpperCase() === key).map((k) => k.value);

// ---- escaping and small helpers ------------------------------------------------

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (text) => escapeHtml(text).replace(/"/g, '&quot;');
const NBSP = '&#xa0;';

/** `,*` and `,#+` at the start of a line are Org's escape for a line that would otherwise look like markup. */
const unescapeLine = (line) => line.replace(/^(\s*),(?=\*|#\+)/, '$1');

function removeIndentation(lines) {
  let min = Infinity;
  for (const l of lines) if (l.trim()) min = Math.min(min, /^[ \t]*/.exec(l)[0].length);
  if (!Number.isFinite(min) || min === 0) return lines.slice();
  return lines.map((l) => (l.trim() ? l.slice(min) : ''));
}

const slugify = (title) => String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';

/** Attributes from `#+ATTR_HTML:`, as an HTML attribute string (`:width 100 :class big` -> ` width="100" class="big"`). */
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

function createState(doc, scope) {
  const options = parseHtmlOptions(doc);
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
    math: false,
    tokens: [],
    tokenSources: [],
    doneKeywords: resolveTodoSequence(doc).doneKeywords,
    todoKeywords: null,
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

function addToken(state, html, source = '') {
  state.tokens.push(html);
  state.tokenSources.push(source);
  return TOKEN_START + (state.tokens.length - 1) + TOKEN_END;
}

const TIMESTAMP_RE = /<(\d{4}-\d{2}-\d{2}(?: [^\s>\]\d-][^\s>\]]*)?(?: \d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?)?(?: [+.]?[+-]\d+[hdwmy])*)>(?:--<(\d{4}-\d{2}-\d{2}(?: [^\s>\]\d-][^\s>\]]*)?(?: \d{1,2}:\d{2})?(?: [+.]?[+-]\d+[hdwmy])*)>)?|\[(\d{4}-\d{2}-\d{2}(?: [^\s>\]\d-][^\s>\]]*)?(?: \d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?)?(?: [+.]?[+-]\d+[hdwmy])*)\](?:--\[(\d{4}-\d{2}-\d{2}(?: [^\s>\]\d-][^\s>\]]*)?(?: \d{1,2}:\d{2})?(?: [+.]?[+-]\d+[hdwmy])*)\])?/g;

function timestampHtml(state, match) {
  const [whole] = match;
  if (!state.options.stamps) return '';
  const text = escapeHtml(whole).replace(/--/g, '&#x2013;');
  return addToken(state, `<span class="timestamp-wrapper"><span class="timestamp">${text}</span></span>`, whole);
}

function expandMacros(state, text) {
  if (!text.includes('{{{')) return text;
  // verbatim and code spans show their text as written
  return text
    .split(/((?<![\w])[~=][^~=\n]+[~=](?![\w]))/)
    .map((part, i) => (i % 2 ? part : expandMacrosIn(state, part)))
    .join('');
}

function expandMacrosIn(state, text) {
  return text.replace(/\{\{\{(\w[\w-]*)(?:\(([\s\S]*?)\))?\}\}\}/g, (whole, name, argText) => {
    const args = argText === undefined ? [] : argText.split(/(?<!\\),/).map((a) => a.replace(/\\,/g, ',').trim());
    const key = name.toLowerCase();
    if (state.macros.has(name)) return state.macros.get(name).replace(/\$(\d)/g, (w, n) => args[Number(n) - 1] ?? '');
    const kw = (k) => keywordValue(state.doc, k) || '';
    if (key === 'title') return kw('TITLE');
    if (key === 'author') return kw('AUTHOR');
    if (key === 'email') return kw('EMAIL');
    if (key === 'date') return kw('DATE');
    if (key === 'keyword') return kw(String(args[0] || '').toUpperCase());
    return whole;
  });
}

/** Org text -> HTML for inline content. `text` may span several lines (joined by "\n"). */
function renderInline(state, rawText) {
  let text = expandMacros(state, rawText);
  // forced line breaks: a line ending in two backslashes
  text = text.replace(/\\\\[ \t]*(?:\n|$)/g, (m) => addToken(state, '<br />', '\\\\') + (m.endsWith('\n') ? '\n' : ''));
  // export snippets
  text = text.replace(/@@([A-Za-z0-9-]+):([\s\S]*?)@@/g, (whole, backend, value) => (backend.toLowerCase() === 'html' ? addToken(state, value, whole) : backend.toLowerCase() === 'comment' ? '' : ''));
  // inline source code
  text = text.replace(/\bsrc_([A-Za-z0-9_-]+)(?:\[[^\]\n]*\])?\{([^}\n]*)\}/g, (whole, lang, code) => addToken(state, `<code class="src src-${escapeAttr(lang)}">${escapeHtml(code)}</code>`, whole));
  // radio targets and targets
  text = text.replace(/<<<([^<>\n]+)>>>/g, (whole, name) => addToken(state, `<a id="${targetId(state, name)}"></a>${escapeHtml(name)}`, whole));
  text = text.replace(/<<([^<>\n]+)>>/g, (whole, name) => addToken(state, `<a id="${targetId(state, name)}"></a>`, whole));
  // timestamps
  text = text.replace(TIMESTAMP_RE, (...m) => timestampHtml(state, m));

  const { lines, fragments } = extractLatexFragments(text.split('\n'));
  const nodes = parseInline(lines.join('\n'), { latexFragments: fragments, subSuperscriptMode: state.options.sup });
  return renderNodes(state, nodes);
}

function targetId(state, name) {
  const key = name.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!state.targets.has(key)) state.targets.set(key, uniqueId(state, 'org-target-' + slugify(name)));
  return state.targets.get(key);
}

function uniqueId(state, base) {
  let id = base;
  for (let n = 2; state.usedIds.has(id); n++) id = base + '-' + n;
  state.usedIds.add(id);
  return id;
}

const ENTITY_RE = /\\(_ +|(?:there4|sup[123]|frac[13][24]|[a-zA-Z]+)(?:\{\}|(?![A-Za-z])))/g;
const COOKIE_RE = /\[(\d*\/\d*|\d*%)\]/g;

/** Plain text -> HTML: escaping, entities, special strings, statistics cookies, and the placeholders set aside earlier. */
function renderText(state, value) {
  const { options } = state;
  let out = '';
  let last = 0;
  const plain = (segment) => {
    let h = escapeHtml(segment);
    if (options.special) {
      h = h.replace(/\\-/g, '&shy;').replace(/(^|[^-])---(?=[^-]|$)/g, '$1&#x2014;').replace(/(^|[^-])--(?=[^-]|$)/g, '$1&#x2013;').replace(/\.\.\./g, '&#x2026;');
    }
    h = h.replace(COOKIE_RE, options.stat ? '<code>[$1]</code>' : '');
    if (state.radioRe && !state.noRadio) h = h.replace(state.radioRe, (m) => `<a href="#${state.targets.get(m.trim().replace(/\s+/g, ' ').toLowerCase())}">${m}</a>`);
    if (options.brk) h = h.replace(/\n/g, '<br />\n');
    return h.replace(TOKEN_RE, (w, n) => state.tokens[Number(n)]);
  };
  if (options.entities) {
    let m;
    ENTITY_RE.lastIndex = 0;
    while ((m = ENTITY_RE.exec(value))) {
      const entry = m[1][0] === '_' ? ['', '', '', '&ensp;'.repeat(m[1].length - 1)] : ENTITIES[m[1].replace(/\{\}$/, '')];
      if (!entry) continue;
      out += plain(value.slice(last, m.index)) + entry[3];
      last = m.index + m[0].length;
    }
  }
  return out + plain(value.slice(last));
}

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|bmp|tiff?|xbm|xpm|pbm|pgm|ppm|avif)$/i;

/** Is this link target one Org shows as an inline picture? */
function isImageTarget(target) {
  const t = target.trim();
  if (/^(file:|attachment:)?[^:]*$/.test(t) || /^(file|attachment):/i.test(t) || /^https?:\/\//i.test(t)) return IMAGE_RE.test(t.replace(/::.*$/, ''));
  return false;
}

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

let activeImages = new Map();

function imageSrc(target) {
  if (activeImages.has(target)) return activeImages.get(target);
  return target.replace(/^(file|attachment):/i, '').replace(/::.*$/, '').replace(/^\/\//, '').replace(/^(\/)/, 'file://$1');
}

function linkHref(state, target) {
  const t = target.trim();
  if (/^(https?|ftp|mailto|news|irc|doi):/i.test(t)) return /^doi:/i.test(t) ? 'https://doi.org/' + t.replace(/^doi:/i, '') : t;
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

function findByProperty(headings, name, value) {
  for (const h of headings) {
    if (String(getProperty(h, name) || '').trim() === value) return h;
    const r = findByProperty(h.children || [], name, value);
    if (r) return r;
  }
  return null;
}

/** Verbatim text with the source of any construct that was set aside as a placeholder put back. */
function literal(state, value) {
  return escapeHtml(value.replace(TOKEN_RE, (m, n) => state.tokenSources[Number(n)]));
}

function renderNodes(state, nodes) {
  return nodes.map((n) => renderNode(state, n)).join('');
}

/** Emphasis as a tag, or with its markers kept as plain text when `#+OPTIONS: *:nil`. */
function emphasis(state, node, marker, open, close = open) {
  const inner = renderNodes(state, node.children);
  return state.options.emph ? `<${open}>${inner}</${close}>` : marker + inner + marker;
}

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
      return footnoteRef(state, node.label);
    case 'footnote-def': {
      const label = node.label === null || node.label === '' ? 'anon-' + (state.fnOrder.length + 1) : node.label;
      return footnoteRef(state, label, `<p class="footpara">${renderNodes(state, node.children)}</p>`);
    }
    case 'comment':
      return '';
    default:
      return '';
  }
}

function imageHtml(target, alt, attrs = '') {
  const src = imageSrc(target);
  const plain = target.replace(/^(file|attachment):/i, '').replace(/::.*$/, '');
  const name = /^https?:/i.test(plain) ? plain.replace(/^.*\//, '') : plain;
  return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt ?? name)}"${attrs} />`;
}

function linkHtml(state, node) {
  const target = node.target;
  const desc = node.description;
  if (desc === null || desc === undefined || desc === '') {
    if (isImageTarget(target)) return imageHtml(target);
    const label = escapeHtml(/^(file:)/i.test(target) ? target.replace(/^file:/i, '') : target);
    const display = /^(https?|ftp|mailto):/i.test(target) || /^file:/i.test(target) ? label : escapeHtml(target);
    return `<a href="${escapeAttr(linkHref(state, target))}">${display}</a>`;
  }
  // a description that is itself an image link shows the picture inside the link
  const inner = /^\[\[[^\]]+\]\]$/.test(desc.trim()) ? null : isImageTarget(desc.trim()) ? imageHtml(desc.trim()) : null;
  state.noRadio = true;
  const label = inner !== null ? inner : renderInline(state, desc);
  state.noRadio = false;
  return `<a href="${escapeAttr(linkHref(state, target))}">${label}</a>`;
}

function mathHtml(state, source, displayMode) {
  const { html, ok } = renderMathHtml(source, displayMode);
  if (ok) {
    state.math = true;
    return html;
  }
  return escapeHtml(displayMode ? `\\[${source}\\]` : `\\(${source}\\)`);
}

// ---- elements -----------------------------------------------------------------

function captionHtml(state, aff) {
  const c = aff && aff.caption.length ? aff.caption[aff.caption.length - 1] : null;
  return c ? renderInline(state, c.text) : null;
}

function paragraphHtml(state, el, ctx) {
  const text = el.lines.join('\n');
  const image = standaloneImage(el);
  if (image && ctx.parent !== 'item-first') return figureHtml(state, el, image);
  const body = renderInline(state, state.options.brk ? text + '\n' : text);
  if (ctx.bare) return body;
  const cls = ctx.footnote ? ' class="footpara"' : '';
  return `<p${cls}>\n${body}\n</p>`;
}

function standaloneImage(el) {
  const text = el.lines.join(' ').trim();
  const m = /^\[\[([^\]]+)\](?:\[([^\]]*)\])?\]$/.exec(text);
  if (!m) return null;
  if (m[2] && !isImageTarget(m[2])) return null;
  return isImageTarget(m[1]) ? { target: m[1], link: m[2] ? m[1] : null, thumb: m[2] || null } : null;
}

function figureHtml(state, el, image) {
  const aff = el.aff;
  const attrs = parseAttributes(aff && aff.attr.html);
  const alt = attrs.alt !== undefined ? attrs.alt : undefined;
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

function listHtml(state, el, ctx) {
  const tag = el.listType === 'ordered' ? 'ol' : el.listType === 'descriptive' ? 'dl' : 'ul';
  const attrs = htmlAttributes(el.aff);
  const rows = el.items.map((item) => itemHtml(state, item, el.listType));
  return `<${tag} class="org-${tag}"${attrs}>\n${rows.join('\n')}\n</${tag}>`;
}

function itemHtml(state, item, listType) {
  const children = item.children;
  const first = children[0];
  const lead = first && first.type === 'paragraph' && (children.length === 1 || (children.length === 2 && children[1].type === 'list'));
  const parts = children.map((c, i) => elementHtml(state, c, { parent: 'item', bare: i === 0 && lead, first: i === 0 }));
  let inner = parts.filter((p) => p !== '').join('\n');
  if (item.checkbox && listType !== 'descriptive') {
    const box = `<input type="checkbox" disabled${item.checkbox === 'on' ? ' checked' : ''}>`;
    inner = `${box} ${inner}`.replace(/\s+$/, '');
  }
  if (listType === 'descriptive') {
    const tag = item.tag === null ? '(no term)' : renderInline(state, item.tag);
    const box = item.checkbox ? `<input type="checkbox" disabled${item.checkbox === 'on' ? ' checked' : ''}> ` : '';
    const cls = item.checkbox ? ` class="${item.checkbox}"` : '';
    return `<dt${cls}>${box}${tag}</dt><dd>${inner.replace(/\n$/, '')}</dd>`;
  }
  const cls = item.checkbox ? ` class="${item.checkbox}"` : '';
  const value = item.counter !== null ? ` value="${item.counter}"` : '';
  return `<li${cls}${value}>${inner.replace(/\n$/, '')}</li>`;
}

const NUMBER_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$|^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?$/;

function tableHtml(state, el) {
  const aff = el.aff;
  // alignment/width cookie rows (`<l>`, `<r10>`, `<c>`, `<12>`) and the `/` marker column are table directives
  let rows = el.rows;
  const cookieAlign = [];
  rows = rows.filter((row) => {
    if (row.rule) return true;
    if (row.cells.length && row.cells.every((c) => c === '' || /^<[lrc]?\d*>$/.test(c)) && row.cells.some((c) => c)) {
      row.cells.forEach((c, i) => {
        const m = /^<([lrc])?\d*>$/.exec(c);
        if (m && m[1]) cookieAlign[i] = m[1];
      });
      return false;
    }
    return true;
  });
  const data = rows.filter((r) => !r.rule);
  if (!data.length) return '';
  const columns = Math.max(...data.map((r) => r.cells.length));
  const align = [];
  for (let c = 0; c < columns; c++) {
    if (cookieAlign[c]) {
      align.push(cookieAlign[c] === 'r' ? 'right' : cookieAlign[c] === 'c' ? 'center' : 'left');
      continue;
    }
    const cells = data.map((r) => (r.cells[c] || '').trim()).filter(Boolean);
    const numbers = cells.filter((x) => NUMBER_RE.test(x)).length;
    align.push(cells.length && numbers / cells.length >= 0.5 ? 'right' : 'left');
  }
  // groups of rows separated by rules; the first group is a header when a rule follows it and more rows come after
  const groups = [[]];
  for (const row of rows) {
    if (row.rule) {
      if (groups[groups.length - 1].length) groups.push([]);
    } else groups[groups.length - 1].push(row);
  }
  if (!groups[groups.length - 1].length) groups.pop();
  const hasHeader = groups.length > 1 && rows.some((r) => r.rule) && !rows[0].rule;
  const attrs = parseAttributes(aff && aff.attr.html);
  const base = { border: '2', cellspacing: '0', cellpadding: '6', rules: 'groups', frame: 'hsides' };
  let tableAttrs = '';
  for (const [k, v] of Object.entries({ ...base, ...attrs })) tableAttrs += v === '' ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`;
  const caption = captionHtml(state, aff);
  const idAttr = el.__id ? ` id="${escapeAttr(el.__id)}"` : '';
  let out = `<table${idAttr}${tableAttrs}>\n`;
  if (caption !== null) out += `<caption class="t-above"><span class="table-number">Table ${++state.counters.table}:</span> ${caption}</caption>\n`;
  out += '\n<colgroup>\n' + align.map((a) => `<col  class="org-${a}" />`).join('\n\n') + '\n</colgroup>\n';
  const cell = (c, tag, a) => `<${tag}${tag === 'th' ? ' scope="col"' : ''} class="org-${a}">${renderInline(state, c.trim()) || NBSP}</${tag}>`;
  const rowHtml = (row, tag) => '<tr>\n' + Array.from({ length: columns }, (_, c) => cell(row.cells[c] || '', tag, align[c])).join('\n') + '\n</tr>';
  groups.forEach((group, gi) => {
    const head = hasHeader && gi === 0;
    out += head ? '<thead>\n' : '<tbody>\n';
    out += group.map((r) => rowHtml(r, head ? 'th' : 'td')).join('\n\n') + '\n';
    out += head ? '</thead>\n' : '</tbody>\n';
  });
  return out + '</table>';
}

function srcBlockHtml(state, el) {
  const params = el.params.trim();
  const lang = params.split(/\s+/)[0] || '';
  const lines = removeIndentation(el.lines.map(unescapeLine));
  const numbered = /(^|\s)[-+]n(\s|$)/.test(params);
  const start = numbered && /[-+]n\s+(\d+)/.exec(params) ? Number(/[-+]n\s+(\d+)/.exec(params)[1]) : 1;
  const colored = highlightToHtml(lines.join('\n'), lang).split('\n');
  const code = colored.map((l, i) => (numbered ? `<span class="linenr">${start + i}: </span>` : '') + l).join('\n');
  const caption = captionHtml(state, el.aff);
  const cls = lang ? `src src-${escapeAttr(lang)}` : 'src';
  const label = caption !== null ? `<label class="org-src-name"><span class="listing-number">Listing ${++state.counters.listing}: </span>${caption}</label>` : '';
  const id = el.__id ? ` id="${escapeAttr(el.__id)}"` : '';
  return `<div class="org-src-container">\n${label}<pre class="${cls}"${id}>${code}\n</pre>\n</div>`;
}

function blockHtml(state, el, ctx) {
  const { name } = el;
  const inner = (lines, sub) => elementsHtml(state, parseElements(lines.map(unescapeLine)), { ...ctx, ...sub, first: undefined, bare: false });
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
      return `<pre class="example"${el.aff && el.aff.name ? ` id="${escapeAttr(el.aff.name)}"` : ''}>\n${escapeHtml(removeIndentation(el.lines.map(unescapeLine)).join('\n'))}\n</pre>`;
    case 'quote':
      return `<blockquote${htmlAttributes(el.aff)}>\n${inner(el.lines)}\n</blockquote>`;
    case 'center':
      return `<div class="org-center">\n${inner(el.lines)}\n</div>`;
    case 'verse': {
      const lines = removeIndentation(el.lines.map(unescapeLine));
      const html = lines
        .map((l) => {
          const lead = /^ */.exec(l)[0].length;
          return (NBSP.repeat(lead) + renderInline(state, l.slice(lead))).replace(/^$/, '') + '<br />';
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

function drawerHtml(state, el, ctx) {
  const d = state.options.drawers;
  const name = el.name.toUpperCase();
  const allowed = d.all || (d.include ? d.include.some((x) => x.toUpperCase() === name) : !(d.exclude || []).some((x) => x.toUpperCase() === name));
  if (!allowed || name === 'PROPERTIES') return '';
  return elementsHtml(state, parseElements(el.lines), ctx);
}

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
      return '<hr />';
    case 'latex-env': {
      const source = el.lines.join('\n');
      const r = renderMathHtml(source, true);
      if (r.ok) {
        state.math = true;
        return r.html;
      }
      return escapeHtml(source);
    }
    case 'html-line':
      return el.value;
    case 'toc':
      return tocKeywordHtml(state, el);
    case 'footnote-def':
      return '';
    default:
      return '';
  }
}

function elementsHtml(state, elements, ctx = {}) {
  const parts = [];
  elements.forEach((el, i) => {
    const html = elementHtml(state, el, { ...ctx, first: i === 0 });
    if (html !== '') parts.push(html);
  });
  return parts.join('\n');
}

// ---- headings -----------------------------------------------------------------

function isCommented(h) {
  return /^COMMENT(\s|$)/.test(h.title || '');
}
const hasTag = (h, tag) => (h.tags || []).some((t) => String(t).toLowerCase() === tag.toLowerCase());

function titleOf(h) {
  return h.title.replace(/^COMMENT\s+/, '');
}

/** Which headings are exported: not COMMENT, not excluded by tag, only selected ones when `#+SELECT_TAGS:` is used. */
function buildFilter(state) {
  const { doc, options } = state;
  const exclude = new Set((keywordValues(doc, 'EXCLUDE_TAGS').join(' ') || 'noexport').split(/\s+/).filter(Boolean).map((t) => t.toLowerCase()));
  if (!keywordValues(doc, 'EXCLUDE_TAGS').length) exclude.add('noexport');
  const select = new Set(keywordValues(doc, 'SELECT_TAGS').join(' ').split(/\s+/).filter(Boolean).map((t) => t.toLowerCase()));
  const selected = new Set();
  const mark = (headings, inherited) => {
    for (const h of headings) {
      const own = select.size && (h.tags || []).some((t) => select.has(String(t).toLowerCase()));
      if (own || inherited) selected.add(h);
      mark(h.children || [], own || inherited);
    }
  };
  if (select.size) mark(doc.children || [], false);
  const keepAncestor = new Set();
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
  return (h) => {
    if (!options.comments && isCommented(h)) return false;
    if ((h.tags || []).some((t) => exclude.has(String(t).toLowerCase()))) return false;
    if (select.size && !keepAncestor.has(h)) return false;
    if (options.tasks !== true && h.todo) {
      if (options.tasks === false) return false;
      if (options.tasks === 'todo' && done.has(h.todo)) return false;
      if (options.tasks === 'done' && !done.has(h.todo)) return false;
    }
    return true;
  };
}

function isArchived(h) {
  return hasTag(h, 'ARCHIVE');
}

/** The exported headings as a tree of { heading, children, number: [..] , level (relative) }. */
function buildOutline(state, headings, levelOffset, filter, numbers) {
  const out = [];
  let n = 0;
  for (const heading of headings) {
    if (!filter(heading)) continue;
    n++;
    const number = [...numbers, n];
    const archived = isArchived(heading) && state.options.arch !== true;
    if (archived && state.options.arch === false) {
      n--;
      continue;
    }
    const node = { heading, level: heading.level - levelOffset, number, archived, children: [] };
    node.children = archived ? [] : buildOutline(state, heading.children || [], levelOffset, filter, number);
    out.push(node);
  }
  return out;
}

function headingTitleHtml(state, node, { inToc = false } = {}) {
  const { heading } = node;
  const { options } = state;
  const parts = [];
  if (heading.todo && options.todo) {
    const done = state.doneKeywords.includes(heading.todo);
    parts.push(`<span class="${done ? 'done' : 'todo'} ${escapeHtml(heading.todo)}">${escapeHtml(heading.todo)}</span>`);
  }
  if (heading.priority && options.pri) parts.push(`<span class="priority">[#${escapeHtml(heading.priority)}]</span>`);
  parts.push(renderInline(state, titleOf(heading)) || '(untitled)');
  let html = parts.join(' ');
  if (options.tags && !(inToc && options.tags === 'not-in-toc') && heading.tags && heading.tags.length) {
    html += `${NBSP}${NBSP}${NBSP}<span class="tag">${heading.tags.map((t) => `<span class="${escapeAttr(String(t).replace(/[@#%]/g, '_'))}">${escapeHtml(t)}</span>`).join(NBSP)}</span>`;
  }
  return html;
}

function numberLabel(state, node) {
  const { num } = state.options;
  if (!num) return '';
  if (typeof num === 'number' && node.level > num) return '';
  return `<span class="section-number-${node.level + 1}">${node.number.join('.')}.</span> `;
}

function planningHtml(state, heading) {
  if (!state.options.planning || !heading.planning) return '';
  const { closed, deadline, scheduled } = heading.planning;
  const stamp = (kw, v) => (v ? `<span class="timestamp-kwd">${kw}:</span> <span class="timestamp">${escapeHtml(v).replace(/^&lt;/, '&lt;')}</span>` : '');
  const parts = [stamp('CLOSED', closed), stamp('DEADLINE', deadline), stamp('SCHEDULED', scheduled)].filter(Boolean);
  return parts.length ? `<p><span class="timestamp-wrapper">${parts.join(' ')}</span></p>` : '';
}

function bodyHtml(state, heading, node = null) {
  const elements = state.parsed.get(heading) || parseElements((heading.bodyLines || []).slice());
  state.currentNode = node;
  return elementsHtml(state, elements);
}

function sectionHtml(state, node, ids) {
  const { heading } = node;
  const limit = state.options.H;
  const isStructural = node.level <= limit;
  const textPath = node.number.join('-');
  const id = state.headingIds.get(heading);
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

/** Headings deeper than `#+OPTIONS: H:` become list items. */
function deepListHtml(state, nodes) {
  const num = state.options.num;
  const ordered = !!num && (num === true || nodes[0].level <= num);
  const tag = ordered ? 'ol' : 'ul';
  const items = nodes.map((node) => {
    const id = state.headingIds.get(node.heading);
    let li = `<li><a id="${escapeAttr(id)}"></a>${headingTitleHtml(state, node)}<br />\n`;
    const body = node.archived ? '' : bodyHtml(state, node.heading, node);
    if (body) li += `<div class="outline-text-${node.level + 1}" id="text-${escapeAttr(node.number.join('-'))}">\n${body}\n</div>\n`;
    if (node.children.length) li += deepListHtml(state, node.children) + '\n';
    return li + '</li>';
  });
  return `<${tag} class="org-${tag}">\n${items.join('\n')}\n</${tag}>`;
}

// ---- table of contents -----------------------------------------------------------

function tocListHtml(state, nodes, maxDepth, depth = 1) {
  const visible = nodes.filter((n) => n.level <= Math.min(state.options.H, maxDepth));
  if (!visible.length) return '';
  const items = visible.map((node) => {
    const id = state.headingIds.get(node.heading);
    const label = (state.options.num && !(typeof state.options.num === 'number' && node.level > state.options.num) ? node.number.join('.') + '. ' : '') + headingTitleHtml(state, node, { inToc: true }).replace(/<a [^>]*>([\s\S]*?)<\/a>/g, '$1');
    const sub = tocListHtml(state, node.children, maxDepth, depth + 1);
    return `<li><a href="#${escapeAttr(id)}">${label}</a>${sub ? '\n' + sub + '\n' : ''}</li>`;
  });
  return `<ul>\n${items.join('\n')}\n</ul>`;
}

function tocHtml(state, depth, nodes = state.outline) {
  const list = tocListHtml(state, nodes, depth === true ? Infinity : depth);
  if (!list) return '';
  return `<div id="table-of-contents" role="doc-toc">\n<h2>Table of Contents</h2>\n<div id="text-table-of-contents" role="doc-toc">\n${list}\n</div>\n</div>`;
}

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
 * A subtree export is titled after its heading; the heading's own text comes first, then its children as sections.
 */
export function exportToHtml(doc, scope = null, { images = null } = {}) {
  activeImages = images instanceof Map ? images : new Map();
  const state = createState(doc, scope);
  state.namedElements = new Map();
  state.fnDefsCollect = (elements) => {
    for (const el of elements) if (el.type === 'footnote-def') state.fnDefs.set(el.label, el.children);
  };
  const { options } = state;
  const filter = buildFilter(state);

  const roots = scope ? scope.children || [] : doc.children || [];
  const levelOffset = scope ? scope.level : 0;
  state.outline = buildOutline(state, roots, levelOffset, filter, []);

  // ids: CUSTOM_ID, else a slug of the title
  const assign = (nodes) => {
    for (const node of nodes) {
      const custom = getProperty(node.heading, 'CUSTOM_ID');
      const base = custom && custom.trim() ? custom.trim() : slugify(titleOf(node.heading));
      let id = base;
      for (let n = 2; state.usedIds.has(id); n++) id = base + '-' + n;
      state.usedIds.add(id);
      state.headingIds.set(node.heading, id);
      assign(node.children);
    }
  };
  assign(state.outline);

  // footnote definitions and radio/inline targets are found before anything is rendered
  const preamble = scope ? scope.bodyLines || [] : preambleBody(doc);
  const preElements = parseElements(preamble);
  state.fnDefsCollect(preElements);
  state.parsed = new Map();
  state.captioned = [];
  let tableN = 0;
  let listingN = 0;
  const scan = (elements) => {
    for (const el of elements) {
      const cap = el.aff && el.aff.caption.length ? el.aff.caption[el.aff.caption.length - 1].text : null;
      if (el.type === 'table' && (cap !== null || (el.aff && el.aff.name))) {
        el.__id = (el.aff && el.aff.name) || uniqueId(state, 'table-' + (tableN + 1));
        if (cap !== null) state.captioned.push({ kind: 'table', n: ++tableN, id: el.__id, html: renderInline(state, cap) });
      } else if (el.type === 'block' && el.name === 'src' && (cap !== null || (el.aff && el.aff.name))) {
        el.__id = (el.aff && el.aff.name) || uniqueId(state, 'listing-' + (listingN + 1));
        if (cap !== null) state.captioned.push({ kind: 'listing', n: ++listingN, id: el.__id, html: renderInline(state, cap) });
      } else if (el.type === 'list') for (const item of el.items) scan(item.children);
      else if (el.type === 'drawer') scan(parseElements(el.lines));
      else if (el.type === 'block' && ['quote', 'center'].includes(el.name)) scan(parseElements(el.lines));
    }
  };
  scan(preElements);
  const collect = (nodes) => {
    for (const node of nodes) {
      const els = parseElements(node.heading.bodyLines || []);
      state.parsed.set(node.heading, els);
      scan(els);
      state.fnDefsCollect(els);
      for (const line of node.heading.bodyLines || []) {
        for (const m of line.matchAll(/<<<?([^<>\n]+?)>>>?/g)) targetId(state, m[1]);
      }
      collect(node.children);
    }
  };
  collect(state.outline);
  for (const line of preamble) for (const m of line.matchAll(/<<<?([^<>\n]+?)>>>?/g)) targetId(state, m[1]);

  const radio = new Set();
  const scanRadio = (lines) => {
    for (const line of lines) for (const m of line.matchAll(/<<<([^<>\n]+)>>>/g)) radio.add(m[1].trim());
  };
  scanRadio(preamble);
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

  const out = [];
  const title = scope ? titleOf(scope) : keywordValue(doc, 'TITLE');
  if (title && options.title) out.push(`<h1 class="title">${renderInline(state, title)}</h1>`);
  const subtitle = !scope && options.title ? keywordValue(doc, 'SUBTITLE') : null;
  if (subtitle) out.push(`<p class="subtitle">${renderInline(state, subtitle)}</p>`);
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
  const postamble = post.length ? `<div id="postamble" class="status">\n${post.join('\n')}\n</div>\n` : '';

  const docTitle = escapeHtml(scope ? titleOf(scope) : title ? stripMarkup(title) : 'Untitled');
  const lang = (keywordValue(doc, 'LANGUAGE') || 'en').replace(/[^A-Za-z-]/g, '') || 'en';
  const meta = [];
  const author = keywordValue(doc, 'AUTHOR');
  if (author && options.author) meta.push(`<meta name="author" content="${escapeAttr(author)}">`);
  const description = keywordValue(doc, 'DESCRIPTION');
  if (description) meta.push(`<meta name="description" content="${escapeAttr(description)}">`);
  const keywords = keywordValue(doc, 'KEYWORDS');
  if (keywords) meta.push(`<meta name="keywords" content="${escapeAttr(keywords)}">`);
  const head = [getHtmlHead(doc), ...keywordValues(doc, 'HTML_HEAD_EXTRA')].filter(Boolean).join('\n');
  return (
    '<!DOCTYPE html>\n' +
    `<html lang="${lang}">\n` +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<title>${docTitle}</title>\n` +
    meta.map((m) => m + '\n').join('') +
    '<meta name="generator" content="org-pwa">\n' +
    `<style>${PAGE_CSS}</style>\n` +
    (state.math ? `<style>${KATEX_EXPORT_CSS}</style>\n` : '') +
    (head ? head + '\n' : '') +
    '</head>\n' +
    '<body>\n' +
    '<div id="content" class="content">\n' +
    out.join('\n') +
    '\n</div>\n' +
    postamble +
    '</body>\n' +
    '</html>\n'
  );
}

const stripMarkup = (text) => text.replace(/[*/_+=~]([^*/_+=~\s][^*/_+=~]*)[*/_+=~]/g, '$1');

/** The lines before the first heading, with the `#+KEY:` lines the parser pulled out put back where they were
 *  (all of them but the file-level settings), so `#+CAPTION:`, `#+HTML:` and `#+TOC:` there still count. */
function preambleBody(doc) {
  const lines = (doc.bodyLines || []).slice();
  const FILE_LEVEL = /^(TITLE|AUTHOR|DATE|EMAIL|OPTIONS|LANGUAGE|DESCRIPTION|KEYWORDS|EXCLUDE_TAGS|SELECT_TAGS|TODO|SEQ_TODO|TYP_TODO|TAGS|STARTUP|PROPERTY|ARCHIVE|CATEGORY|COLUMNS|PRIORITIES|MACRO|HTML_HEAD|HTML_HEAD_EXTRA|SETUPFILE|LATEX_\w*|ODT_\w*|HTML_\w*|FILETAGS|CONSTANTS|LINK|SUBTITLE|CREATOR)$/i;
  const keywords = (doc.keywords || []).filter((k) => !FILE_LEVEL.test(k.key));
  for (const k of keywords.slice().reverse()) lines.splice(Math.min(k.bodyLineIndex || 0, lines.length), 0, `#+${k.key}: ${k.value}`);
  return lines;
}
