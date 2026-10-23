// @ts-check
/**
 * ASCII export (`org-ascii-export-to-ascii`): the document as plain text, laid out the way Org's ox-ascii lays it out.
 * This is ox-ascii.el and the parts of ox.el it leans on, ported function by function and held to Emacs's own output
 * by test/export-ascii-emacs.test.js (tools/gen-ascii-oracle.mjs writes those files from Emacs 29.3):
 *
 *   - every element and object is turned into a string by its own function, and elements are joined the way
 *     `org-export-data` joins them (one newline at the end of each, then the blank lines it had in the source);
 *   - headlines are numbered ("1.2 Title") and underlined by level; the ones deeper than `H:` become bullets;
 *   - paragraphs are filled with `fill-region`'s rules (see ascii-fill.js); quote, verse and center blocks, lists,
 *     tables, footnotes and the title block are set as ox-ascii sets them;
 *   - links become `[description]` with the target listed after the section (`org-ascii-links-to-notes`);
 *   - emphasis keeps its markers (`*bold*`, `/italic/`), code and verbatim text read `like this'.
 *
 * Not yet: line numbers and references in source blocks, the `org-ascii-*` variables
 * other than the text width and the character set (the exporter reads them from one place, `makeInfo`).
 */

import { parseElements, parseAttributes } from './org-elements.js';
import { parseInline } from './inline-markup.js';
import { citeExportFor, dropSilentCitations } from './cite.js';
import { removeIndentation } from './babel-blocks.js';
import { ENTITIES } from './entities.js';
import { getDocTitle, getDocAuthor, getDocDate } from './export-options.js';
import { preambleBody } from './export-html.js';
import { expandMacrosForExport } from './export-org.js';
import { radioTargetRegExp } from './targets.js';
import { BrokenLinkSignal, brokenLinkText, parseBrokenLinks } from './broken-links.js';
import { HARD, stringWidth, normalizeString, indentString, fillString, justifyLines, justifyBlock } from './ascii-fill.js';
import { INLINE_TASK_BLOCK, inlineTaskInfo, foldInlineTasks } from './inline-tasks.js';
import { newCodeCounter, codeStart, unravelCode, resolveCodeRef, coderefText, blockSwitchText, formatCodePlain } from './code-lines.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./org-elements.js').OrgElement} OrgElement */
/** @typedef {'left' | 'center' | 'right' | 'full'} Justify */

/**
 * One element or object of the tree Org builds. Only the fields a type uses are set.
 * @typedef {{
 *   type: string,
 *   parent: Node | null,
 *   contents: Item[],
 *   postBlank: number,
 *   value?: string,
 *   code?: { lines: string[], switches: import("./code-lines.js").CodeSwitches, refs: Map<number, string>, start: number | null },
 *   lines?: string[],
 *   level?: number,
 *   title?: Item[],
 *   rawTitle?: string,
 *   todo?: string | null,
 *   priority?: string | null,
 *   tags?: string[],
 *   properties?: Record<string, string>,
 *   number?: number[],
 *   heading?: Heading,
 *   listType?: string,
 *   bullet?: string,
 *   checkbox?: string | null,
 *   counter?: number | null,
 *   tag?: Item[] | null,
 *   itemNumber?: number,
 *   rowType?: string,
 *   cells?: Node[],
 *   key?: string,
 *   name?: string,
 *   params?: string,
 *   caption?: Item[] | null,
 *   shortCaption?: Item[] | null,
 *   nameKey?: string | null,
 *   attrAscii?: string[],
 *   label?: string | null,
 *   inline?: Item[] | null,
 *   fnNumber?: number,
 *   raw?: string,
 *   linkType?: string,
 *   path?: string,
 *   desc?: Item[] | null,
 *   descRaw?: string,
 *   exported?: string,
 *   ignored?: boolean,
 *   kind?: string,
 * }} Node
 * @typedef {string | Node} Item
 */

// ---- character sets and options (org-ascii-*) -----------------------------------

/** What ox-ascii draws with, per `org-ascii-charset`. `column` is the spelling used for entities. */
const CHARSETS = {
  ascii: { column: 0, utf8: false, underline: ['=', '~', '-'], bullets: ['*', '+', '-'], checkbox: { on: '[X] ', off: '[ ] ', trans: '[-] ' }, rule: '-', box: [',----', '| ', '`----'] },
  latin1: { column: 1, utf8: false, underline: ['=', '~', '-'], bullets: ['§', '¶'], checkbox: { on: '[X] ', off: '[ ] ', trans: '[-] ' }, rule: '-', box: [',----', '| ', '`----'] },
  'utf-8': {
    column: 2,
    utf8: true,
    underline: ['═', '─', '╌', '┄', '┈'],
    bullets: ['◊'],
    checkbox: { on: '☑ ', off: '☐ ', trans: '☒ ' },
    rule: '―',
    box: ['┌────', '│ ', '└────'],
  },
};

/**
 * `ascii`, `latin1` or `utf-8` (also `utf8`, `iso-8859-1`; case and a leading quote ignored); anything else is ASCII.
 * @param {string} value
 * @returns {'ascii' | 'latin1' | 'utf-8'}
 */
export function normalizeAsciiCharset(value) {
  const v = String(value == null ? '' : value).trim().replace(/^'/, '').toLowerCase();
  if (v === 'utf-8' || v === 'utf8') return 'utf-8';
  if (v === 'latin1' || v === 'latin-1' || v === 'iso-8859-1') return 'latin1';
  return 'ascii';
}

/**
 * @typedef {{
 *   width: number, charsetName: 'ascii' | 'latin1' | 'utf-8', cs: typeof CHARSETS['ascii'],
 *   globalMargin: number, innerMargin: number, quoteMargin: number, listMargin: number,
 *   headlineLevels: number, numbering: boolean | number, toc: boolean | number,
 *   withTitle: boolean, withAuthor: boolean, withEmail: boolean, withDate: boolean, withCreator: boolean,
 *   withTags: boolean | 'not-in-toc', withTodo: boolean, withPriority: boolean,
 *   preserveBreaks: boolean, specialStrings: boolean, entities: boolean, footnotes: boolean, drawers: boolean | string[],
 *   fixedWidth: boolean, tex: boolean,
 *   linksToNotes: boolean, sup: string, widen: boolean, broken: import('./broken-links.js').BrokenLinks,
 *   verbatimFormat: string,
 *   doc: Doc, scope: Heading | null, radioRe: RegExp | null,
 *   headlines: Node[], defs: Map<string, Node>, fnLabels: Map<string, number>, fnList: { number: number, label: string | null, inline: Item[] | null, def: Node | null }[],
 *   codeCounter: { loc: number }, codeBlocks: { lines: string[], switches: import("./code-lines.js").CodeSwitches, refs: Map<number, string>, start: number | null }[],
 *   named: Map<string, Node>, targets: Map<string, Node>, ordinals: Map<Node, number>,
 *   cite: ReturnType<typeof citeExportFor> | null,
 *   tableCache: Map<Node, TableInfo>,
 * }} Info
 */

/** Option text such as `H:2 toc:nil` as a map of the last value given for each key. @param {Doc} doc */
function optionTable(doc) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const kw of doc.keywords || []) {
    if (kw.key.toUpperCase() !== 'OPTIONS') continue;
    for (const token of kw.value.trim().split(/\s+/)) {
      const m = /^(\\n|\^|-|:|<|\||[A-Za-z][A-Za-z-]*):(.*)$/.exec(token);
      if (m) map.set(m[1], m[2]);
    }
  }
  return map;
}

/** An option value as a boolean the way Org reads it (`nil` is off, anything else on). @param {string | undefined} v @param {boolean} dflt */
const flag = (v, dflt) => (v === undefined ? dflt : v !== 'nil');

/**
 * @param {Doc} doc @param {Heading | null} scope @param {number} textWidth @param {'ascii' | 'latin1' | 'utf-8'} charset @param {string} sup @param {import('./broken-links.js').BrokenLinks} broken
 * @returns {Info}
 */
function makeInfo(doc, scope, textWidth, charset, sup, broken) {
  const o = optionTable(doc);
  const numValue = o.get('num');
  const tocValue = o.get('toc');
  const tags = o.get('tags');
  const drawers = o.get('d');
  const levels = Number(o.get('H'));
  return {
    width: textWidth,
    charsetName: charset,
    cs: CHARSETS[charset],
    globalMargin: 0,
    innerMargin: 2,
    quoteMargin: 6,
    listMargin: 0,
    headlineLevels: Number.isFinite(levels) && o.has('H') ? levels : 3,
    numbering: numValue === undefined ? true : /^\d+$/.test(numValue) ? Number(numValue) : numValue !== 'nil',
    toc: tocValue === undefined ? true : /^\d+$/.test(tocValue) ? Number(tocValue) : tocValue !== 'nil',
    withTitle: flag(o.get('title'), true),
    withAuthor: flag(o.get('author'), true),
    withEmail: flag(o.get('email'), false),
    withDate: flag(o.get('date'), true),
    withCreator: o.get('creator') === 't',
    withTags: tags === 'not-in-toc' ? 'not-in-toc' : flag(tags, true),
    withTodo: flag(o.get('todo'), true),
    withPriority: flag(o.get('pri'), false),
    preserveBreaks: flag(o.get('\\n'), false),
    specialStrings: flag(o.get('-'), true),
    entities: flag(o.get('e'), true),
    footnotes: flag(o.get('f'), true),
    drawers: drawers === undefined ? ['!LOGBOOK'] : drawers === 'nil' ? false : drawers === 't' ? true : drawers.replace(/[()"]/g, '').split(/\s+/).filter(Boolean),
    fixedWidth: flag(o.get(':'), true),
    tex: flag(o.get('tex'), true),
    linksToNotes: true,
    sup: o.has('^') ? (o.get('^') === 'nil' || o.get('^') === '{}' ? /** @type {string} */ (o.get('^')) : 't') : sup,
    widen: true,
    broken: /** @type {import('./broken-links.js').BrokenLinks} */ (parseBrokenLinks(o.get('broken-links'), broken)),
    verbatimFormat: "`%s'",
    doc,
    scope,
    radioRe: radioTargetRegExp(doc),
    headlines: [],
    defs: new Map(),
    fnLabels: new Map(),
    fnList: [],
    named: new Map(),
    codeCounter: newCodeCounter(),
    codeBlocks: [],
    targets: new Map(),
    ordinals: new Map(),
    cite: null,
    tableCache: new Map(),
  };
}

// ---- building the tree ----------------------------------------------------------

/**
 * @param {string} type @param {Node | null} parent @param {Partial<Node>} [props]
 * @returns {Node}
 */
function mk(type, parent, props = {}) {
  return { type, parent, contents: [], postBlank: 0, ...props };
}

/** The nodes among some items (the rest are plain strings). @param {Item[]} items @returns {Node[]} */
const nodesOf = (items) => /** @type {Node[]} */ (items.filter((x) => typeof x !== 'string'));

const LINE_BREAK_RE = /\\\\[ \t]*$/;
const ENTITY_RE = /\\(there4|sup[123]|frac[13][24]|[A-Za-z]+)(\{\}|(?![A-Za-z]))/g;
const SNIPPET_RE = /@@([-A-Za-z0-9]+):(.*?)@@/g;
const UNICODE_SPECIAL = [
  [/---/g, '—'],
  [/--/g, '–'],
  [/\.\.\./g, '…'],
];

const TIMESTAMP_RE = /([<[])(\d{4})-(\d{1,2})-(\d{1,2})(?: +[^\s\d>\]+-][^\s>\]]*)?(?: +(\d{1,2}):(\d{2})(?:-(\d{1,2}):(\d{2}))?)?((?: +(?:[.+]\+?|-{1,2})\d+[hdwmy](?:\/\d+[hdwmy])?)*) *([>\]])/g;
const DAY_ABBREVIATIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Timestamps as ox-ascii writes them: the date with its day name (a day past the end of a month rolls over, as encode-time does),
 * a time range as two timestamps, and a repeater without its habit part.
 * @param {string} text
 */
function translateTimestamps(text) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return text.replace(TIMESTAMP_RE, (whole, open, y, mo, d, h1, m1, h2, m2, marks, close) => {
    if (open === '<' !== (close === '>')) return whole;
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${DAY_ABBREVIATIONS[date.getUTCDay()]}`;
    const tail = marks.replace(/\/\d+[hdwmy]/g, '');
    const stamp = (/** @type {string | undefined} */ hh, /** @type {string | undefined} */ mm) => `${open}${day}${hh === undefined ? '' : ` ${pad(Number(hh))}:${mm}`}${tail}${close}`;
    return h2 === undefined ? stamp(h1, m1) : `${stamp(h1, m1)}--${stamp(h2, m2)}`;
  });
}

/**
 * A run of plain text as ox-ascii writes it: entities in the character set's own spelling, `\-` dropped, and in UTF-8 the dashes and ellipsis.
 * @param {string} text @param {Info} I
 * @returns {string}
 */
function plainText(text, I) {
  const pieces = [];
  let last = 0;
  if (I.entities) {
    for (const m of text.matchAll(ENTITY_RE)) {
      const entry = /** @type {Record<string, string[]>} */ (ENTITIES)[m[1]];
      if (!entry) continue;
      const at = m.index || 0;
      pieces.push({ text: text.slice(last, at), entity: false }, { text: entry[I.cs.column], entity: true });
      last = at + m[0].length;
    }
  }
  pieces.push({ text: text.slice(last), entity: false });
  return pieces
    .map((p) => {
      if (p.entity) return p.text;
      let t = translateTimestamps(p.text);
      if (I.specialStrings) {
        t = t.replace(/\\-/g, '');
        if (I.cs.utf8) for (const [re, to] of UNICODE_SPECIAL) t = t.replace(/** @type {RegExp} */ (re), /** @type {string} */ (to));
      }
      return t;
    })
    .join('');
}

const INLINE_SRC_OR_CALL_RE = /\bsrc_([A-Za-z0-9_-]+)(?:\[[^\]\n]*\])?\{([^}\n]*)\}|\bcall_[A-Za-z0-9_-]+(?:\[[^\]\n]*\])?\([^)\n]*\)(?:\[[^\]\n]*\])?/g;
/** Inline source code and calls found by `objects`, standing in the text as placeholders while it is parsed. @type {(string | null)[]} */
let inlineCode = [];

/**
 * Org text as objects. `parent` is the element that holds it (a target needs it to say which section it is in).
 * @param {string} text @param {Node | null} parent @param {Info} I @param {boolean} [radio]
 * @returns {Item[]}
 */
function objects(text, parent, I, radio = true) {
  const marked = text.split('\n').map((l) => (LINE_BREAK_RE.test(l) ? l.replace(LINE_BREAK_RE, HARD) : l)).join('\n');
  const outer = inlineCode;
  inlineCode = [];
  const held = inlineCode;
  const prepared = marked.replace(INLINE_SRC_OR_CALL_RE, (_whole, _lang, code) => `\uE000${held.push(code === undefined ? null : code) - 1}\uE001`);
  let nodes = parseInline(prepared, { subSuperscriptMode: I.sup, radioTargets: radio ? I.radioRe : null });
  if (I.cite) {
    const cite = I.cite;
    nodes = dropSilentCitations(nodes, (c) => cite.formatCitation(c) === null);
  }
  try {
    return convertInline(nodes, parent, I);
  } finally {
    inlineCode = outer;
  }
}

/** @param {import('./types.js').InlineNode[]} nodes @param {Node | null} parent @param {Info} I @returns {Item[]} */
function convertInline(nodes, parent, I) {
  /** @type {Item[]} */
  const out = [];
  for (const n of nodes) {
    switch (n.type) {
      case 'text': {
        let last = 0;
        const text = n.value;
        /** @param {string} piece the plain text between snippets: inline source code prints as verbatim text, an inline call prints nothing */
        const pushPlain = (piece) => {
          let from = 0;
          for (const m of piece.matchAll(/\uE000(\d+)\uE001/g)) {
            const at = m.index || 0;
            out.push(plainText(piece.slice(from, at), I));
            const code = inlineCode[Number(m[1])];
            if (code !== null && code !== undefined) out.push(mk('verbatim', parent, { value: code }));
            from = at + m[0].length;
          }
          out.push(plainText(piece.slice(from), I));
        };
        for (const m of text.matchAll(SNIPPET_RE)) {
          const at = m.index || 0;
          pushPlain(text.slice(last, at));
          if (m[1].toLowerCase() === 'ascii') out.push(m[2]);
          last = at + m[0].length;
        }
        pushPlain(text.slice(last));
        break;
      }
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strikethrough':
        out.push(mk(n.type, parent, { contents: convertInline(n.children, parent, I) }));
        break;
      case 'code':
      case 'verbatim':
        out.push(mk('verbatim', parent, { value: n.value }));
        break;
      case 'subscript':
      case 'superscript': {
        const brackets = n.raw !== undefined && /^[_^]\{/.test(n.raw);
        out.push(mk(n.type, parent, { kind: brackets ? 'brackets' : 'plain', contents: objects(n.value, parent, I) }));
        break;
      }
      case 'link':
        out.push(linkNode(n.target, n.description, !!n.radio, parent, I));
        break;
      case 'image':
        out.push(linkNode(n.target, null, false, parent, I));
        break;
      case 'latex':
        out.push(I.tex ? (n.raw !== undefined ? n.raw : n.displayMode ? `\\[${n.source}\\]` : `\\(${n.source}\\)`) : '');
        break;
      case 'footnote-ref':
        out.push(mk('footnote-reference', parent, { label: n.label, inline: null }));
        break;
      case 'footnote-def':
        out.push(mk('footnote-reference', parent, { label: n.label, inline: convertInline(n.children, parent, I) }));
        break;
      case 'target':
        out.push(mk('target', parent, { name: n.name }));
        break;
      case 'radio-target':
        out.push(mk('radio-target', parent, { name: n.name, contents: [plainText(n.name, I)] }));
        break;
      case 'citation':
        out.push(mk('citation', parent, { raw: n.raw, value: JSON.stringify(n.refs), kind: String(n.blanks) }));
        citations.set(/** @type {Node} */ (out[out.length - 1]), n);
        break;
      default:
        break;
    }
  }
  return out;
}

/** The citations by node, for the transcoder (kept apart so a node stays plain data). */
const citations = new WeakMap();

/**
 * A link as Org classifies it: the type, the path, and the raw link the way it was typed.
 * @param {string} raw @param {string | null} description @param {boolean} radio @param {Node | null} parent @param {Info} I
 */
function linkNode(raw, description, radio, parent, I) {
  /** @type {string} */
  let linkType;
  if (radio) linkType = 'radio';
  else if (/^\(.*\)$/.test(raw)) linkType = 'coderef';
  else if (raw.startsWith('*')) linkType = 'fuzzy';
  else if (raw.startsWith('#')) linkType = 'custom-id';
  else if (/^id:/i.test(raw)) linkType = 'id';
  else if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) linkType = raw.slice(0, raw.indexOf(':')).toLowerCase();
  else if (/^(\.{0,2}\/|~\/)/.test(raw)) linkType = 'file';
  else linkType = 'fuzzy';
  return mk('link', parent, {
    linkType,
    raw,
    path: linkType === 'coderef' ? raw.slice(1, -1) : linkType === 'fuzzy' || linkType === 'custom-id' || linkType === 'id' ? raw.replace(/^(?:id:|#|\*)/i, '') : raw,
    desc: description === null ? null : objects(description, parent, I, false),
    descRaw: description === null ? '' : description.replace(/\s+/g, ' ').trim(),
    kind: raw.startsWith('*') ? 'headline' : '',
  });
}

/** @param {{ short: string | null, text: string }[]} captions @param {Node} parent @param {Info} I */
function captionItems(captions, parent, I) {
  const last = captions[captions.length - 1];
  return last ? { caption: objects(last.text, parent, I), shortCaption: last.short ? objects(last.short, parent, I) : null } : { caption: null, shortCaption: null };
}

/**
 * Elements from the parser, as nodes.
 * @param {OrgElement[]} list @param {Node} parent @param {Info} I
 * @returns {Node[]}
 */
function buildElements(list, parent, I) {
  /** @type {Node[]} */
  const out = [];
  for (const el of list) {
    const node = buildElement(el, parent, I);
    if (!node) continue;
    node.postBlank = el.postBlank || 0;
    if (el.aff) {
      node.nameKey = el.aff.name;
      if (el.aff.attr && el.aff.attr.ascii) node.attrAscii = el.aff.attr.ascii;
      Object.assign(node, captionItems(el.aff.caption, node, I));
      if (el.aff.name) I.named.set(el.aff.name, node);
    }
    out.push(node);
  }
  return out;
}

/** @param {string[]} lines */
function unescapeCode(lines) {
  return removeIndentation(lines).map((l) => l.replace(/^([ \t]*),(?=\*|#\+)/, '$1'));
}

/**
 * @param {OrgElement} el @param {Node} parent @param {Info} I
 * @returns {Node | null}
 */
function buildElement(el, parent, I) {
  switch (el.type) {
    case 'paragraph': {
      const lines = el.lines.slice();
      // clock lines are elements of their own, and not exported
      while (lines.length && /^[ \t]*CLOCK:[ \t]*\[/.test(lines[0])) lines.shift();
      if (lines.length === 0) return null;
      const node = mk('paragraph', parent);
      node.contents = objects([lines[0].trimStart(), ...lines.slice(1)].join('\n') + '\n', node, I);
      return node;
    }
    case 'list': {
      const node = mk('plain-list', parent, { listType: el.listType });
      let counter = 0;
      for (const it of el.items) {
        const item = mk('item', node, { bullet: it.bullet, checkbox: it.checkbox, counter: it.counter, postBlank: it.postBlank || 0 });
        if (el.listType === 'ordered') {
          counter = it.counter !== null ? it.counter : counter + 1;
          item.itemNumber = counter;
        }
        if (it.tag !== null) item.tag = objects(it.tag, item, I);
        item.contents = buildElements(it.children, item, I);
        node.contents.push(item);
      }
      return node;
    }
    case 'table': {
      const node = mk('table', parent);
      for (const row of el.rows) {
        const cellTexts = 'cells' in row && row.cells ? row.cells : null;
        const r = mk('table-row', node, { rowType: cellTexts ? 'standard' : 'rule' });
        if (cellTexts) {
          const cells = cellTexts.map((/** @type {string} */ c) => mk('table-cell', r, { raw: c, contents: objects(c, r, I) }));
          r.cells = cells;
          r.contents = cells;
        }
        node.contents.push(r);
      }
      return node;
    }
    case 'block':
      return buildBlock(el, parent, I);
    case 'fixed':
      return mk('fixed-width', parent, { lines: el.lines });
    case 'hr':
      return mk('horizontal-rule', parent);
    case 'latex-env':
      return mk('latex-environment', parent, { lines: el.lines });
    case 'drawer': {
      const node = mk('drawer', parent, { name: el.name });
      node.contents = buildElements(parseElements(el.lines), node, I);
      return node;
    }
    case 'footnote-def': {
      const node = mk('footnote-definition', parent, { label: el.label });
      node.contents = buildElements(el.children, node, I);
      return node;
    }
    case 'toc':
      return mk('keyword', parent, { key: 'TOC', value: el.value });
    case 'ascii-line':
      return mk('keyword', parent, { key: 'ASCII', value: el.value });
    case 'print-bibliography':
      return mk('keyword', parent, { key: 'PRINT_BIBLIOGRAPHY', value: el.value });
    default:
      return null;
  }
}

/**
 * Unravels the code of a source or example block and numbers it, in document order (`org-export-unravel-code`, `org-export-get-loc`).
 * @param {Node} node @param {string} name @param {string} params @param {Info} I
 */
function codeNode(node, name, params, I) {
  const lines = node.lines || [];
  const block = unravelCode(lines, blockSwitchText(name, params));
  node.code = { ...block, start: codeStart(I.codeCounter, block.switches, lines.length) };
  I.codeBlocks.push(node.code);
  return node;
}

/** @param {Extract<OrgElement, { type: 'block' }>} el @param {Node} parent @param {Info} I @returns {Node | null} */
function buildBlock(el, parent, I) {
  const name = el.name.toLowerCase();
  switch (name) {
    case 'src':
      return codeNode(mk('src-block', parent, { lines: unescapeCode(el.lines), params: el.params }), name, el.params, I);
    case 'example':
      return codeNode(mk('example-block', parent, { lines: unescapeCode(el.lines) }), name, el.params, I);
    case 'comment':
      return null;
    case INLINE_TASK_BLOCK: {
      const info = inlineTaskInfo(el.params);
      const node = mk('inlinetask', parent, { todo: info.todo, priority: info.priority, tags: info.tags, rawTitle: info.title });
      node.title = objects(info.title, node, I);
      node.contents = buildElements(parseElements(el.lines), node, I);
      return node;
    }
    case 'export':
      return mk('export-block', parent, { name: (el.params.split(/\s+/)[0] || '').toUpperCase(), lines: el.lines });
    case 'verse': {
      const node = mk('verse-block', parent);
      node.contents = objects(removeIndentation(el.lines).join('\n') + '\n', node, I);
      return node;
    }
    default: {
      const type = name === 'quote' ? 'quote-block' : name === 'center' ? 'center-block' : 'special-block';
      const node = mk(type, parent, { name: el.rawName || el.name });
      node.contents = buildElements(parseElements(removeIndentation(el.lines).map((l) => l.replace(/^([ \t]*),(?=\*|#\+)/, '$1'))), node, I);
      return node;
    }
  }
}

/** @param {Heading} h */
const isFootnoteSection = (h) => h.title.trim() === 'Footnotes';

/** Which headings are left out: COMMENT, tagged for exclusion (`#+EXCLUDE_TAGS:`, `noexport` by default), the Footnotes section. @param {Doc} doc */
function exclusion(doc) {
  const tags = (doc.keywords || []).filter((k) => k.key.toUpperCase() === 'EXCLUDE_TAGS').map((k) => k.value).join(' ').split(/\s+/).filter(Boolean);
  const exclude = new Set(tags.length ? tags : ['noexport']);
  return (/** @type {Heading} */ h) => /^COMMENT(\s|$)/.test(h.title) || h.tags.some((t) => exclude.has(t)) || isFootnoteSection(h);
}

/**
 * The headline nodes for `children`, with their sections.
 * @param {Heading[]} children @param {Node} parent @param {Info} I @param {number} offset @param {(h: Heading) => boolean} skip
 */
function buildHeadlines(children, parent, I, offset, skip) {
  for (const h of children) {
    if (skip(h)) continue;
    const node = mk('headline', parent, { level: h.level + offset, heading: h, rawTitle: h.title, todo: h.todo, priority: h.priority, tags: h.tags, properties: h.properties });
    node.title = objects(h.title, node, I);
    I.headlines.push(node);
    const lines = h.bodyLines || [];
    const elements = parseElements(lines);
    if (elements.length) {
      const section = mk('section', node);
      section.contents = buildElements(elements, section, I);
      node.contents.push(section);
    }
    buildHeadlines(h.children || [], node, I, offset, skip);
    for (const c of node.contents) if (c !== undefined) continue;
    parent.contents.push(node);
  }
}

/**
 * The whole tree for the export.
 * @param {Info} I
 * @returns {Node}
 */
function buildTree(I) {
  const root = mk('org-data', null);
  const scope = I.scope;
  const skip = exclusion(I.doc);
  const lines = scope ? scope.bodyLines || [] : preambleBody(I.doc);
  const elements = parseElements(lines);
  if (elements.length) {
    const section = mk('section', root);
    section.contents = buildElements(elements, section, I);
    root.contents.push(section);
  }
  buildHeadlines(scope ? scope.children || [] : I.doc.children || [], root, I, scope ? -scope.level : 0, skip);
  return root;
}

// ---- walking the tree -----------------------------------------------------------

/** @param {Item} item @returns {Item[]} */
function childrenOf(item) {
  if (typeof item === 'string') return [];
  const out = [...item.contents];
  if (item.title) out.unshift(...item.title);
  if (item.tag) out.unshift(...item.tag);
  return out;
}

/**
 * Applies `fn` to every node under `item` in document order (secondary strings included).
 * @param {Item} item @param {(n: Node) => boolean | void} fn  returns true to skip what is inside
 */
function walk(item, fn) {
  if (typeof item === 'string') return;
  if (fn(item) === true) return;
  for (const child of childrenOf(item)) walk(child, fn);
}

// ---- ordinals, footnote numbers, headline numbers --------------------------------

/**
 * Org's headline numbers: one number per level, counted over the exported headlines.
 * @param {Info} I
 */
function numberHeadlines(I) {
  const counters = /** @type {number[]} */ ([]);
  for (const h of I.headlines) {
    const rel = /** @type {number} */ (h.level);
    while (counters.length < rel) counters.push(0);
    counters[rel - 1] = (counters[rel - 1] || 0) + 1;
    for (let i = rel; i < counters.length; i++) counters[i] = 0;
    h.number = counters.slice(0, rel);
  }
}

/** @param {Node} h @param {Info} I */
function isNumbered(h, I) {
  const unnumbered = h.properties && h.properties.UNNUMBERED;
  if (unnumbered && unnumbered.toLowerCase() !== 'nil') return false;
  return typeof I.numbering === 'number' ? /** @type {number} */ (h.level) <= I.numbering : I.numbering;
}

/** 0 when the headline is a normal one, else how many levels past `H:` it is. @param {Node} h @param {Info} I */
function lowLevel(h, I) {
  const level = /** @type {number} */ (h.level);
  return level > I.headlineLevels ? level - I.headlineLevels : 0;
}

/**
 * Numbers the footnotes in the order they are first referenced; a definition is searched as soon as its first reference is found.
 * @param {Node} root @param {Info} I
 */
function numberFootnotes(root, I) {
  walk(root, (n) => {
    if (n.type === 'footnote-definition') {
      if (n.label) I.defs.set(n.label, n);
      return false;
    }
    return false;
  });
  /** @param {Item} item */
  const visit = (item) =>
    walk(item, (n) => {
      if (n.type === 'footnote-definition') return true;
      if (n.type !== 'footnote-reference') return false;
      const label = n.label || null;
      if (label && I.fnLabels.has(label)) {
        n.fnNumber = I.fnLabels.get(label);
        return true;
      }
      const number = I.fnList.length + 1;
      n.fnNumber = number;
      const def = label && !n.inline ? I.defs.get(label) || null : null;
      I.fnList.push({ number, label, inline: n.inline || null, def });
      if (label) I.fnLabels.set(label, number);
      if (n.inline) for (const c of n.inline) visit(c);
      else if (def) visit(def);
      return true;
    });
  if (I.footnotes) visit(root);
}

/** Numbers tables, source blocks and figures with captions, as `org-export-get-ordinal` does, and notes targets. @param {Node} root @param {Info} I */
function collectOrdinals(root, I) {
  /** @type {Record<string, number>} */
  const counts = {};
  walk(root, (n) => {
    if (n.type === 'target' && n.name) I.targets.set(n.name.trim().replace(/\s+/g, ' ').toLowerCase(), n);
    if (n.type === 'radio-target' && n.name) I.targets.set(n.name.trim().replace(/\s+/g, ' ').toLowerCase(), n);
    if ((n.type === 'table' || n.type === 'src-block' || n.type === 'paragraph') && n.caption) {
      counts[n.type] = (counts[n.type] || 0) + 1;
      I.ordinals.set(n, counts[n.type]);
    }
    return false;
  });
}

// ---- helpers on the tree -----------------------------------------------------------

/** The nearest headline above `n` (not `n` itself). @param {Node} n */
function parentHeadline(n) {
  for (let p = n.parent; p; p = p.parent) if (p.type === 'headline') return p;
  return null;
}

/** The ancestors of `n` from `n` itself up. @param {Node} n */
function lineage(n) {
  /** @type {Node[]} */
  const out = [];
  for (let p = /** @type {Node | null} */ (n); p; p = p.parent) out.push(p);
  return out;
}

/** The widest line a bullet and its checkbox take (the source bullet counts, as in Emacs). @param {Node} item @param {Info} I */
function itemIndent(item, I) {
  const list = item.parent;
  if (list && list.listType === 'descriptive') return I.quoteMargin;
  return stringWidth(itemCheckbox(item, I) || '') + stringWidth(sourceBullet(item));
}

/** @param {Node} item */
function sourceBullet(item) {
  const b = item.bullet || '-';
  return /^\d/.test(b) ? b + ' ' : b + ' ';
}

/** @param {Node} item @param {Info} I */
function itemCheckbox(item, I) {
  return item.checkbox ? I.cs.checkbox[/** @type {'on' | 'off' | 'trans'} */ (item.checkbox)] : null;
}

const INLINE_TASK_WIDTH = 30;

/** `org-ascii--current-text-width`. @param {Node} n @param {Info} I */
function currentTextWidth(n, I) {
  if (n.type === 'headline') {
    const rank = lowLevel(n, I);
    return I.width - (rank ? rank * 2 : I.globalMargin);
  }
  if (n.type === 'inlinetask') return INLINE_TASK_WIDTH; // org-ascii-inlinetask-width
  const genealogy = lineage(n);
  const parent = parentHeadline(n);
  let total = I.width - I.globalMargin;
  if (genealogy.some((e) => e.type === 'inlinetask')) total = INLINE_TASK_WIDTH;
  else if (parent) {
    const rank = lowLevel(parent, I);
    total -= rank ? rank * 2 : I.innerMargin;
  }
  const quotes = genealogy.filter((e) => e.type === 'quote-block' || e.type === 'verse-block').length;
  let indentation = 0;
  for (const e of genealogy) if (e.type === 'item') indentation += itemIndent(e, I);
  const lists = genealogy.filter((e) => e.type === 'plain-list' && !(e.parent && e.parent.type === 'item')).length;
  return total - (quotes * 2 * I.quoteMargin + lists * I.listMargin + indentation);
}

/** `org-ascii--current-justification`. @param {Node} n @returns {Justify} */
function currentJustification(n) {
  for (let p = n.parent; p; p = p.parent) {
    if (p.type === 'center-block') return 'center';
    if (p.type === 'special-block') {
      if (p.name === 'JUSTIFYRIGHT') return 'right';
      if (p.name === 'JUSTIFYLEFT') return 'left';
    }
  }
  return 'left';
}

/** `org-ascii--justify-element`. @param {string} contents @param {Node} n @param {Info} I */
function justifyElement(contents, n, I) {
  if (!/\S/.test(contents)) return contents;
  const width = currentTextWidth(n, I);
  const how = currentJustification(n);
  if (n.type === 'paragraph') return fillString(contents, width, how, I.preserveBreaks);
  return justifyBlock(contents, width, how);
}

/** `org-ascii--box-string`. @param {string} s @param {Info} I */
function boxString(s, I) {
  const [top, side, bottom] = I.cs.box;
  const body = s.replace(/\n[ \t]*$/, '').replace(/^/gm, side);
  return `${top}\n${body}\n${bottom}`;
}

/** The text of a code or example block. @param {Node} n */
function codeOf(n) {
  const lines = n.lines || [];
  const code = n.code;
  return lines.length && code ? formatCodePlain(code, code.start).join('\n') + '\n' : '';
}

// ---- export ------------------------------------------------------------------------

/** The greater elements: their contents are normalized before they are handed on. */
const GREATER = new Set(['org-data', 'headline', 'inlinetask', 'section', 'plain-list', 'item', 'quote-block', 'center-block', 'special-block', 'drawer', 'footnote-definition', 'table']);
const ELEMENTS = new Set([...GREATER, 'paragraph', 'src-block', 'example-block', 'verse-block', 'export-block', 'fixed-width', 'horizontal-rule', 'keyword', 'latex-environment', 'table-row', 'table-cell']);

/**
 * `org-export-data`: an element or object as text.
 * @param {Item} item @param {Info} I
 * @returns {string}
 */
function exportData(item, I) {
  if (typeof item === 'string') return item;
  const transcode = TRANSCODERS[item.type];
  if (!transcode) return '';
  if (item.type === 'footnote-definition') return '';
  if (item.type === 'table') tableInfo(item, I);
  if (item.type === 'headline') exportItems(item.title || [], I); // marks the links of the title as exported
  const contents = item.contents.map((c) => exportData(c, I)).join('');
  const greater = GREATER.has(item.type);
  /** @type {string | null | undefined} */
  let results;
  try {
    results = transcode(item, greater ? normalizeString(contents) : contents, I);
  } catch (err) {
    // a broken link found while describing links is handled by the element around it (ox.el's `broken-link-handler`)
    if (!(err instanceof BrokenLinkSignal)) throw err;
    if (I.broken === 'nil') throw err;
    results = I.broken === 'mark' ? brokenLinkText('mark', err.path) : null;
  }
  if (results === null || results === undefined) return '';
  let out;
  if (ELEMENTS.has(item.type) && item.type !== 'table-cell') out = normalizeString(results) + '\n'.repeat(item.postBlank);
  else out = results;
  if (item.type === 'fixed-width' && out !== '') out += '\n'; // Org's quirk: a fixed-width element leaves one more blank line
  if (item.type === 'headline' || item.type === 'section') out = headlineSpacing(out);
  item.exported = out;
  return out;
}

/** `org-ascii-filter-headline-blank-lines`: two blank lines after a headline's contents. @param {string} s */
function headlineSpacing(s) {
  return s.replace(/\n(?:\n[ \t]*)*$/, '\n\n\n');
}

/** @param {Item[]} items @param {Info} I */
const exportItems = (items, I) => items.map((i) => exportData(i, I)).join('');

/** @param {Info} I @param {boolean} notes */
function withNotes(I, notes) {
  const saved = I.linksToNotes;
  I.linksToNotes = notes;
  return saved;
}

/**
 * One transcoder per type: (node, contents, info) -> string | null.
 * @type {Record<string, (n: Node, contents: string, I: Info) => string | null>}
 */
const TRANSCODERS = {
  bold: (_n, c) => `*${c}*`,
  italic: (_n, c) => `/${c}/`,
  underline: (_n, c) => `_${c}_`,
  strikethrough: (_n, c) => `+${c}+`,
  verbatim: (n, _c, I) => I.verbatimFormat.replace('%s', () => n.value || ''),
  subscript: (n, c) => (n.kind === 'brackets' ? `_{${c}}` : `_${c}`),
  superscript: (n, c) => (n.kind === 'brackets' ? `^{${c}}` : `^${c}`),
  'radio-target': (_n, c) => c,
  target: () => '',
  'footnote-reference': (n) => `[${n.fnNumber}]`,
  citation: (n, _c, I) => {
    const cite = citations.get(n);
    const segments = I.cite && cite ? I.cite.formatCitation(cite) : null;
    return (segments ? citeSegments(segments, I).trim() : '') + ' '.repeat(Number(n.kind) || 0);
  },
  link: (n, _c, I) => linkText(n, I),
  paragraph: (n, c, I) => justifyElement(c.replace(/^[ \t]+/, ''), n, I),
  'plain-list': (_n, c, I) => (I.listMargin < 1 ? c : indentString(c, I.listMargin)),
  item: (n, c, I) => itemText(n, c, I),
  table: (n, c, I) => tableText(n, c, I),
  'table-row': (n, c, I) => tableRowText(n, c, I),
  'table-cell': (n, c, I) => tableCellText(n, c, I),
  'src-block': (n, _c, I) => {
    const code = codeOf(n);
    if (code === '') return '';
    const caption = buildCaption(n, I);
    return justifyElement(boxString(code, I) + (caption ? '\n' + caption : ''), n, I);
  },
  'example-block': (n, _c, I) => justifyElement(boxString(codeOf(n), I), n, I),
  'fixed-width': (n, _c, I) => (I.fixedWidth ? justifyElement(boxString(removeIndentation(n.lines || []).join('\n') + '\n', I), n, I) : null),
  'quote-block': (_n, c, I) => indentString(c, I.quoteMargin),
  'verse-block': (n, c, I) => indentString(justifyElement(c, n, I), I.quoteMargin),
  'center-block': (_n, c) => c,
  'special-block': (_n, c) => c,
  'export-block': (n, _c, I) => (n.name === 'ASCII' ? justifyElement((n.lines || []).join('\n') + '\n', n, I) : null),
  'horizontal-rule': (n, _c, I) => {
    const width = currentTextWidth(n, I);
    // #+ATTR_ASCII: :width N draws the rule N characters long (digits only, else the text width), centered
    const wanted = parseAttributes(n.attrAscii || []).width;
    return justifyLines(I.cs.rule.repeat(wanted !== undefined && /^[0-9]+$/.test(wanted) ? Number(wanted) : width), width, 'center');
  },
  'latex-environment': (n, _c, I) => (I.tex ? justifyElement(removeIndentation(n.lines || []).join('\n') + '\n', n, I) : null),
  drawer: (n, c, I) => {
    const d = I.drawers;
    if (d === false) return null;
    if (Array.isArray(d)) {
      const name = (n.name || '').toUpperCase();
      const excluded = d.filter((x) => x.startsWith('!')).map((x) => x.slice(1).toUpperCase());
      const included = d.filter((x) => !x.startsWith('!')).map((x) => x.toUpperCase());
      if (excluded.includes(name)) return null;
      if (included.length && !included.includes(name)) return null;
    }
    return c;
  },
  keyword: (n, _c, I) => keywordText(n, I),
  section: (n, c, I) => {
    const headline = parentHeadline(n);
    const text = indentString(c, !headline || lowLevel(headline, I) ? 0 : I.innerMargin);
    const links = I.linksToNotes && !headline ? describeLinks(uniqueLinks([n]), currentTextWidth(n, I), I) : '';
    return links.trim() ? headlineSpacing(normalizeString(text)) + links : text;
  },
  headline: (n, c, I) => headlineText(n, c, I),
  inlinetask: (n, c, I) => inlineTaskText(n, c, I),
  'org-data': (_n, c) => c,
  'footnote-definition': () => null,
};

// ---- links ---------------------------------------------------------------------------

/** @param {string} name */
const normName = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * What a fuzzy, custom-id or id link points at: a headline, a named element or a target, or null.
 * @param {Node} link @param {Info} I
 * @returns {Node | null}
 */
function resolveLink(link, I) {
  const path = link.path || '';
  if (link.linkType === 'custom-id') return I.headlines.find((h) => h.properties && h.properties.CUSTOM_ID === path) || I.named.get(path) || null;
  if (link.linkType === 'id') return I.headlines.find((h) => h.properties && h.properties.ID === path) || null;
  if (link.kind === 'headline') return I.headlines.find((h) => normName(h.rawTitle || '') === normName(path)) || null;
  return I.targets.get(normName(path)) || I.named.get(path) || I.headlines.find((h) => normName(h.rawTitle || '') === normName(path)) || null;
}

/** The ordinal of a destination (a number, or the headline's number list), or null. @param {Node} dest @param {Info} I @returns {number | number[] | null} */
function ordinalOf(dest, I) {
  let el = dest;
  if (dest.type === 'target' || dest.type === 'radio-target') {
    const found = lineage(dest).find((e) => ['footnote-definition', 'footnote-reference', 'headline', 'item', 'table'].includes(e.type));
    if (!found) return null;
    el = found;
  }
  if (el.type === 'headline') return isNumbered(el, I) ? el.number || null : null;
  if (el.type === 'footnote-definition' || el.type === 'footnote-reference') return el.fnNumber || null;
  return I.ordinals.get(el) || null;
}

/** Lisp's `%s` of a number or a list of numbers. @param {number | number[]} n */
const lispString = (n) => (Array.isArray(n) ? `(${n.join(' ')})` : String(n));

/** `org-ascii--describe-datum`. @param {Node} dest @param {Info} I */
function describeDatum(dest, I) {
  if (dest.type === 'headline') return `See section ${isNumbered(dest, I) ? (dest.number || []).join('.') : titleText(dest, I)}`;
  const number = ordinalOf(dest, I);
  const enumerable = lineage(dest).find((e) => ['headline', 'paragraph', 'src-block', 'table'].includes(e.type));
  if (enumerable && enumerable.type === 'headline') return `See section ${isNumbered(enumerable, I) ? (enumerable.number || []).join('.') : titleText(enumerable, I)}`;
  if (number === null) return 'Unknown reference';
  if (!enumerable) return 'Unknown reference';
  if (enumerable.type === 'paragraph') return `See figure ${lispString(number)}`;
  if (enumerable.type === 'src-block') return `See listing ${lispString(number)}`;
  return `See table ${lispString(number)}`;
}

/** A headline's title as text. @param {Node} h @param {Info} I */
function titleText(h, I) {
  return exportItems(h.title || [], I).trim();
}

/** `org-ascii-link`. @param {Node} n @param {Info} I */
function linkText(n, I) {
  const desc = n.desc ? exportItems(n.desc, I) : null;
  if (n.linkType === 'radio') return desc || '';
  if (n.linkType === 'coderef') {
    const found = resolveCodeRef(I.codeBlocks, n.path || '');
    return found === null ? brokenLinkText(I.broken, n.path || '', false) : coderefText(n.path || '', found, desc);
  }
  if (n.linkType === 'custom-id' || n.linkType === 'fuzzy' || n.linkType === 'id') {
    const dest = resolveLink(n, I);
    if (dest) {
      if (desc !== null && desc !== '') return I.linksToNotes ? `[${desc}]` : `${desc} (${describeDatum(dest, I)})`;
      if (dest.type === 'headline') return isNumbered(dest, I) ? (dest.number || []).join('.') : titleText(dest, I);
      const number = ordinalOf(dest, I);
      if (number !== null) return Array.isArray(number) ? number.join('.') : String(number);
      return '???';
    }
    return brokenLinkText(I.broken, n.linkType === 'fuzzy' ? n.raw || '' : n.path || '', false);
  }
  const raw = n.raw || '';
  if (desc === null || desc === '') return `<${raw}>`;
  return `[${desc}]` + (I.linksToNotes ? '' : ` (<${raw}>)`);
}

/**
 * The links of a headline's title and first section, or of a section, listed once each (`org-ascii--unique-links`).
 * @param {Node[]} roots
 * @returns {Node[]}
 */
function uniqueLinks(roots) {
  /** @type {Node[]} */
  const found = [];
  const seen = new Set();
  /** @param {Item} item */
  const visit = (item) =>
    walk(item, (n) => {
      if (n.type === 'headline') return true;
      if (n.caption) for (const c of n.caption) visit(c);
      if (n.type !== 'link') return false;
      if (!n.exported || !n.exported.trim()) return false;
      const key = `${n.raw}\u0000${n.descRaw}`;
      if (seen.has(key)) return false;
      seen.add(key);
      found.push(n);
      return false;
    });
  for (const r of roots) visit(r);
  return found;
}

/**
 * `org-ascii--describe-links`.
 * @param {Node[]} links @param {number} width @param {Info} I
 */
function describeLinks(links, width, I) {
  return links
    .map((link) => {
      const type = link.linkType;
      const description = link.desc && link.desc.length ? link.desc : null;
      const anchor = exportItems(description || [link.raw || ''], I);
      if (type === 'coderef' || type === 'radio') return '';
      if (type === 'custom-id' || type === 'fuzzy' || type === 'id') {
        const dest = resolveLink(link, I);
        if (dest) {
          if (!description) return '';
          return fillString(`[${anchor}] ${describeDatum(dest, I)}`, width, 'left', I.preserveBreaks) + '\n\n';
        }
        if (type === 'fuzzy' && description) throw new BrokenLinkSignal(link.raw || '');
        if (type !== 'fuzzy') return '';
      }
      if (!description) return '';
      return fillString(`[${anchor}] <${link.raw}>`, width, 'left', I.preserveBreaks) + '\n\n';
    })
    .join('');
}

// ---- headlines, lists, tables ---------------------------------------------------------

/**
 * `org-ascii--build-title`.
 * @param {Node} h @param {Info} I @param {number} textWidth @param {boolean} underline @param {boolean} noTags @param {boolean} toc
 */
function buildTitle(h, I, textWidth, underline, noTags, toc) {
  const numbers = h.type === 'headline' && isNumbered(h, I) && h.number ? (toc ? `${h.number[h.number.length - 1]}. ` : `${h.number.join('.')} `) : '';
  const alt = toc && h.properties && h.properties.ALT_TITLE ? h.properties.ALT_TITLE : null;
  const text = (alt !== null ? exportItems(objects(alt, h, I), I) : exportItems(h.title || [], I)).trim();
  const todo = I.withTodo && h.todo ? `${h.todo} ` : '';
  const tags = !noTags && I.withTags && h.tags && h.tags.length ? `:${h.tags.join(':')}:` : '';
  const priority = I.withPriority && h.priority ? `(#${h.priority}) ` : '';
  const first = numbers + todo + priority + text;
  let out = first;
  if (tags) out += ' ' + tags.padStart(Math.max(textWidth - (1 + stringWidth(first)), stringWidth(tags)));
  if (underline) {
    const ch = I.cs.underline[/** @type {number} */ (h.level) - 1];
    if (ch) out += '\n' + ch.repeat(Math.floor(stringWidth(first) / stringWidth(ch)));
  }
  return out;
}

/** `org-ascii-headline`. @param {Node} h @param {string} contents @param {Info} I */
function headlineText(h, contents, I) {
  const rank = lowLevel(h, I);
  const width = currentTextWidth(h, I);
  const title = buildTitle(h, I, width, !rank, false, false);
  let body = contents;
  const parts = nodesOf(h.contents);
  const first = parts[0];
  if (I.linksToNotes && first && first.type === 'section') {
    const links = describeLinks(uniqueLinks([...nodesOf(h.title || []), first]), width, I);
    if (links.trim()) body = (first.exported || '') + links + parts.slice(1).map((c) => c.exported || '').join('');
  }
  if (rank) {
    const bullets = I.cs.bullets;
    const bullet = `${bullets[(rank - 1) % bullets.length]} `;
    return `${bullet}${title}\n\n${indentString(body, bullet.length)}`;
  }
  return `${title}\n\n${body}`;
}

/** `org-ascii-inlinetask` with `org-ascii-format-inlinetask-default`: a box 30 characters wide, flush right. @param {Node} n @param {string} contents @param {Info} I */
function inlineTaskText(n, contents, I) {
  const width = INLINE_TASK_WIDTH;
  const utf8 = I.cs.utf8;
  const line = (/** @type {string} */ ch) => ch.repeat(width);
  const title = buildTitle(n, I, width, false, false, false);
  const fitted = stringWidth(title) <= width ? title : fillString(title, width);
  const inner =
    line(utf8 ? '━' : '_') + '\n' + (utf8 ? '' : ' '.repeat(width) + '\n') + fitted + '\n' + (/\S/.test(contents) ? line(utf8 ? '─' : '-') + '\n' + contents : '') + line(utf8 ? '━' : '_');
  const parent = parentHeadline(n);
  return indentString(inner, I.width - I.globalMargin - (parent ? I.innerMargin : 0) - width);
}

/** `org-ascii-item`. @param {Node} item @param {string} contents @param {Info} I */
function itemText(item, contents, I) {
  const list = item.parent;
  const type = list ? list.listType : 'unordered';
  const checkbox = itemCheckbox(item, I) || '';
  let bullet;
  if (type === 'descriptive') bullet = checkbox + exportItems(item.tag || [], I);
  else if (type === 'ordered' && /^\d/.test(item.bullet || '1')) bullet = `${item.itemNumber || 1}${(item.bullet || '').replace(/^\d+/, '')} `;
  else {
    bullet = sourceBulletString(item);
    if (I.cs.utf8) bullet = bullet.replace(/-/g, '•').replace(/\+/g, '⁃').replace(/\*/g, '‣');
  }
  const indentation = type === 'descriptive' ? I.quoteMargin : stringWidth(bullet);
  const body = indentString(contents, indentation);
  const firstShown = nodesOf(item.contents).find((e) => (e.exported || '').trim() !== '');
  if (type !== 'descriptive' && /\S/.test(body) && firstShown && firstShown.type === 'paragraph') return bullet + checkbox + body.trim();
  return bullet + checkbox + '\n' + body;
}

/** The unordered bullet with one space after it (`org-list-bullet-string`). @param {Node} item */
function sourceBulletString(item) {
  return (item.bullet || '-') + ' ';
}

/**
 * @typedef {{
 *   rows: Node[], special: Set<Node>, widths: number[], aligns: string[], groups: (string | null)[] | null, lastCol: number
 * }} TableInfo
 */

const NUMBER_RE = /^([<>]?[-+^.0-9]*[0-9][-+^.0-9eEdDx()%:]*|0[xX][0-9a-fA-F]+|nan|[-+u]?inf)$/;

/** What the table's special rows and columns say, and the width and alignment of each column. @param {Node} table @param {Info} I @returns {TableInfo} */
function tableInfo(table, I) {
  const cached = I.tableCache.get(table);
  if (cached) return cached;
  const rows = nodesOf(table.contents).filter((r) => r.type === 'table-row');
  const standard = rows.filter((r) => r.rowType === 'standard');
  const cellRaw = (/** @type {Node} */ cell) => (cell.raw || '').trim();
  // a special column: the first column holds only /#!$*_^ marks or nothing, and at least one mark
  let specialColumn = false;
  {
    let state = 'empty';
    for (const r of standard) {
      const v = cellRaw((r.cells || [])[0] || mk('table-cell', r, { raw: '' }));
      if (['/', '#', '!', '$', '*', '_', '^'].includes(v)) state = 'special';
      else if (v !== '') {
        state = 'none';
        break;
      }
    }
    specialColumn = state === 'special';
  }
  /** @param {Node} row */
  const isSpecialRow = (row) => {
    if (row.rowType !== 'standard') return false;
    const cells = row.cells || [];
    const first = cells[0] ? cellRaw(cells[0]) : '';
    if (first === '/') return true;
    if (specialColumn && ['^', '_', '$', '!'].includes(first)) return true;
    let cookie = false;
    for (const c of cells) {
      const v = cellRaw(c);
      if (v === '') continue;
      if (/^<[lrc]?([0-9]+)?>$/.test(v)) cookie = true;
      else return false;
    }
    return cookie;
  };
  /** @type {Set<Node>} */
  const special = new Set(standard.filter(isSpecialRow));
  // column groups from the `/` row
  /** @type {(string | null)[] | null} */
  let groups = null;
  for (const r of [...standard].reverse()) {
    const cells = r.cells || [];
    if (cells[0] && cellRaw(cells[0]) === '/') {
      groups = cells.map((c) => (['<', '<>', '>'].includes(cellRaw(c)) ? cellRaw(c) : null));
      if (specialColumn) groups = groups.slice(1);
      break;
    }
  }
  if (specialColumn) for (const r of rows) if (r.cells) r.contents = r.cells = r.cells.slice(1);
  const visibleRows = rows.filter((r) => !special.has(r));
  const columns = Math.max(0, ...standard.map((r) => (r.cells || []).length));
  /** @type {number[]} */
  const widths = [];
  /** @type {string[]} */
  const aligns = [];
  for (let col = 0; col < columns; col++) {
    let cookieWidth = null;
    let cookieAlign = null;
    let contentWidth = 0;
    let numbers = 0;
    let total = 0;
    let previousNumber = false;
    for (const r of rows) {
      if (r.rowType !== 'standard') continue;
      const cell = (r.cells || [])[col];
      if (special.has(r)) {
        const v = cell ? cellRaw(cell) : '';
        const m = /^<([lrc])?([0-9]+)?>$/.exec(v);
        if (m) {
          if (m[2] !== undefined) cookieWidth = Number(m[2]);
          if (m[1]) cookieAlign = m[1];
        }
        continue;
      }
      const text = cell ? exportItems(cell.contents, I) : '';
      contentWidth = Math.max(contentWidth, stringWidth(text));
      if (!cookieAlign) {
        total++;
        if (NUMBER_RE.test(text) || (text === '' && previousNumber)) {
          previousNumber = true;
          numbers++;
        } else previousNumber = false;
      }
    }
    widths.push(cookieWidth === null ? contentWidth : I.widen ? Math.max(cookieWidth, contentWidth) : cookieWidth);
    aligns.push(cookieAlign === 'l' ? 'left' : cookieAlign === 'r' ? 'right' : cookieAlign === 'c' ? 'center' : total && numbers / total >= 0.5 ? 'right' : 'left');
  }
  const info = { rows: visibleRows, special, widths, aligns, groups, lastCol: columns - 1 };
  I.tableCache.set(table, info);
  return info;
}

/** The borders of a row's first cell, as `org-export-table-cell-borders` finds them. @param {Node} row @param {TableInfo} T */
function rowBorders(row, T) {
  const at = T.rows.indexOf(row);
  /** @type {string[]} */
  const borders = [];
  let rule = false;
  let found = false;
  for (let i = at - 1; i >= 0; i--) {
    if (T.rows[i].rowType === 'rule') rule = true;
    else {
      if (rule) borders.push('above');
      found = true;
      break;
    }
  }
  if (!found) {
    if (rule) borders.push('above');
    borders.push('top');
  }
  rule = false;
  found = false;
  for (let i = at + 1; i < T.rows.length; i++) {
    if (T.rows[i].rowType === 'rule') rule = true;
    else {
      if (rule) borders.push('below');
      found = true;
      break;
    }
  }
  if (!found) {
    if (rule) borders.push('below');
    borders.push('bottom');
  }
  return borders;
}

/** Left and right borders of column `col` from the column groups. @param {TableInfo} T @param {number} col */
function sideBorders(T, col) {
  /** @type {string[]} */
  const out = [];
  const g = T.groups;
  if (!g) return out;
  if ((col > 0 && (g[col - 1] === '>' || g[col - 1] === '<>')) || g[col] === '<' || g[col] === '<>') out.push('left');
  if ((col + 1 < g.length && (g[col + 1] === '<' || g[col + 1] === '<>')) || g[col] === '>' || g[col] === '<>') out.push('right');
  return out;
}

/** @param {Node} table @param {string} contents @param {Info} I */
function tableText(table, contents, I) {
  tableInfo(table, I);
  const caption = buildCaption(table, I);
  return justifyElement(contents + (caption || ''), table, I);
}

/** @param {Node} row @param {string} contents @param {Info} I */
function tableRowText(row, contents, I) {
  const table = /** @type {Node} */ (row.parent);
  const T = tableInfo(table, I);
  if (row.rowType !== 'standard' || T.special.has(row)) return null;
  const cells = row.cells || [];
  const borders = rowBorders(row, T);
  const utf8 = I.cs.utf8;
  /** @param {string} l @param {string} horiz @param {string} vert @param {string} r */
  const hline = (l, horiz, vert, r) => {
    let out = '';
    cells.forEach((_c, i) => {
      const side = sideBorders(T, i);
      if (side.includes('left') && i === 0) out += l;
      out += horiz.repeat(T.widths[i] + 2);
      if (!side.includes('right')) return;
      out += i === cells.length - 1 ? r : vert;
    });
    return out + '\n';
  };
  let out = '';
  if (borders.includes('top') && (utf8 || borders.includes('above'))) out += utf8 ? hline('┍', '━', '┯', '┑') : hline('+', '-', '+', '+');
  else if (borders.includes('above')) out += utf8 ? hline('├', '─', '┼', '┤') : hline('+', '-', '+', '+');
  if (sideBorders(T, 0).includes('left')) out += utf8 ? '│' : '|';
  out += contents + '\n';
  if (borders.includes('bottom') && (utf8 || borders.includes('below'))) out += utf8 ? hline('┕', '━', '┷', '┙') : hline('+', '-', '+', '+');
  return out;
}

/** @param {Node} cell @param {string} contents @param {Info} I */
function tableCellText(cell, contents, I) {
  const row = /** @type {Node} */ (cell.parent);
  const table = /** @type {Node} */ (row.parent);
  const T = tableInfo(table, I);
  const col = (row.cells || []).indexOf(cell);
  const width = T.widths[col] || 0;
  const data = justifyLines(contents, width, /** @type {'left' | 'center' | 'right'} */ (T.aligns[col] || 'left'));
  const padded = data + ' '.repeat(Math.max(0, width - stringWidth(data)));
  return ` ${padded} ` + (sideBorders(T, col).includes('right') ? (I.cs.utf8 ? '│' : '|') : '');
}

/** `org-ascii--build-caption`. @param {Node} n @param {Info} I */
function buildCaption(n, I) {
  if (!n.caption) return null;
  const number = I.ordinals.get(n);
  const fmt = n.type === 'table' ? 'Table' : 'Listing';
  return fillString(`${fmt} ${number}: ${exportItems(n.caption, I)}`, currentTextWidth(n, I), 'left', I.preserveBreaks);
}

// ---- keywords, table of contents ------------------------------------------------------

/** @param {Node} n @param {Info} I */
function keywordText(n, I) {
  const value = n.value || '';
  if (n.key === 'ASCII') return justifyElement(value, n, I);
  if (n.key === 'PRINT_BIBLIOGRAPHY') return bibliographyText(n, I);
  if (n.key !== 'TOC') return null;
  let text;
  if (/\bheadlines\b/i.test(value)) {
    const depth = /\b\d+\b/.exec(value);
    const local = /\blocal\b/i.test(value);
    text = buildToc(I, depth ? Number(depth[0]) : null, n, local ? parentHeadline(n) || false : null);
  } else if (/\btables\b/i.test(value)) text = listOf('table', n, I);
  else if (/\blistings\b/i.test(value)) text = listOf('src-block', n, I);
  else return null;
  return justifyElement(text, n, I);
}

/** @param {Node} n @param {Info} I */
function bibliographyText(n, I) {
  if (!I.cite) return null;
  const width = currentTextWidth(n, I);
  return I.cite
    .bibliography()
    .map((/** @type {import('./cite.js').Segment[]} */ entry) => fillString(citeSegments(entry, I), width, 'left', I.preserveBreaks))
    .join('\n\n');
}

/** A citation processor's output as plain text. @param {import('./cite.js').Segment[]} segments @param {Info} I @returns {string} */
function citeSegments(segments, I) {
  return segments
    .map((s) => (typeof s === 'string' ? plainText(s, I) : 'org' in s ? exportItems(objects(s.org, null, I), I) : '/' + citeSegments(s.italic, I) + '/'))
    .join('');
}

/** The underline of a heading such as "Table of Contents". @param {string} title @param {Info} I */
const underlineFor = (title, I) => '\n' + (I.cs.utf8 ? '─' : '_').repeat(stringWidth(title)) + '\n\n';

/**
 * `org-ascii--build-toc`. `scope` is false for the whole document, or the headline a local table lists.
 * @param {Info} I @param {number | null} n @param {Node | null} keyword @param {Node | false | null} scope
 */
function buildToc(I, n, keyword, scope) {
  const limit = I.headlineLevels;
  const local = scope && scope.type === 'headline' ? scope : null;
  const base = local ? /** @type {number} */ (local.level) : 0;
  const depth = n !== null ? Math.min(n, limit) : limit;
  const headlines = I.headlines.filter((h) => {
    const level = /** @type {number} */ (h.level);
    if (local) {
      if (!lineage(h).includes(local) || h === local) return false;
      return level <= base + (n !== null ? n : limit - base);
    }
    return level <= depth && !(h.properties && /notoc/.test(h.properties.UNNUMBERED || ''));
  });
  const textWidth = keyword ? currentTextWidth(keyword, I) : I.width - I.globalMargin;
  const lines = headlines.map((h) => {
    const level = /** @type {number} */ (h.level);
    const indent = (level - 1) * 3;
    return (indent ? '.'.repeat(indent - 1) + ' ' : '') + buildTitle(h, I, textWidth - indent, false, !I.withTags || I.withTags === 'not-in-toc', true);
  });
  const title = 'Table of Contents';
  return (scope === null || scope === undefined ? title + underlineFor(title, I).replace(/^\n/, '\n') : '') + lines.join('\n');
}

/** "List of Tables" and "List of Listings". @param {'table' | 'src-block'} type @param {Node} keyword @param {Info} I */
function listOf(type, keyword, I) {
  const title = type === 'table' ? 'List of Tables' : 'List of Listings';
  const width = currentTextWidth(keyword, I);
  const items = [...I.ordinals.keys()].filter((e) => e.type === type);
  let count = 0;
  const lines = items.map((e) => {
    const initial = `${type === 'table' ? 'Table' : 'Listing'} ${++count}:`;
    const caption = exportItems(e.shortCaption || e.caption || [], I);
    const filled = indentString(fillString(caption, width - stringWidth(initial), 'left', I.preserveBreaks), stringWidth(initial));
    return `${initial} ${filled.trim()}`;
  });
  return title + underlineFor(title, I) + lines.join('\n');
}

// ---- the document ---------------------------------------------------------------------

/** `org-ascii-template--document-title`. @param {Info} I */
function documentTitle(I) {
  const doc = I.doc;
  const saved = withNotes(I, false);
  const textWidth = I.width;
  const kw = (/** @type {string} */ key) => {
    const found = (doc.keywords || []).find((k) => k.key.toUpperCase() === key);
    return found ? found.value.trim() : '';
  };
  const titleRaw = I.scope ? I.scope.title : getDocTitle(doc) || '';
  const subtitleRaw = I.scope ? '' : kw('SUBTITLE');
  const text = (/** @type {string} */ raw) => exportItems(objects(raw, null, I), I);
  const title = I.withTitle && titleRaw ? text(titleRaw) : '';
  const subtitle = I.withTitle && subtitleRaw ? text(subtitleRaw) : '';
  const authorRaw = getDocAuthor(doc);
  const author = I.withAuthor && authorRaw ? text(authorRaw) : '';
  const email = I.withEmail && kw('EMAIL') ? text(kw('EMAIL')) : '';
  const dateRaw = getDocDate(doc);
  const date = I.withDate && dateRaw ? text(dateRaw) : '';
  I.linksToNotes = saved;
  const nw = (/** @type {string} */ s) => /\S/.test(s);
  if (title === '') {
    if (nw(date) && nw(author)) return author + ' '.repeat(textWidth - stringWidth(date) - stringWidth(author)) + date + (nw(email) ? '\n' + email : '') + '\n\n\n';
    if (nw(date) && nw(email)) return email + ' '.repeat(textWidth - stringWidth(date) - stringWidth(email)) + date + '\n\n\n';
    if (nw(date)) return justifyLines(date, textWidth, 'right') + '\n\n\n';
    if (nw(author) && nw(email)) return `${author}\n${email}\n\n\n`;
    if (nw(author)) return `${author}\n\n\n`;
    if (nw(email)) return `${email}\n\n\n`;
    return '';
  }
  const utf8 = I.cs.utf8;
  const longest = Math.max(...`${title}\n${subtitle}`.split('\n').map(stringWidth));
  const titleLen = Math.min(longest, Math.floor((2 * textWidth) / 3));
  const formattedTitle = fillString(title, titleLen, 'left', I.preserveBreaks);
  const formattedSubtitle = nw(subtitle) ? fillString(subtitle, titleLen, 'left', I.preserveBreaks) : '';
  const line = (utf8 ? '━' : '_').repeat(Math.min(Math.max(titleLen, stringWidth(author), stringWidth(email)) + 2, textWidth));
  return justifyLines(
    line +
      '\n' +
      (utf8 ? '' : '\n') +
      formattedTitle.toUpperCase() +
      (formattedSubtitle ? '\n' + formattedSubtitle : '') +
      (nw(author) && nw(email) ? `\n\n${author}\n${email}` : nw(author) ? `\n\n${author}` : nw(email) ? `\n\n${email}` : '') +
      '\n' +
      line +
      (nw(date) ? `\n\n\n${date}` : '') +
      '\n\n\n',
    textWidth,
    'center',
  );
}

/** The footnotes, as `org-ascii-inner-template` lists them. @param {Info} I */
function footnoteSection(I) {
  if (!I.fnList.length) return '';
  const saved = withNotes(I, false);
  const width = I.width - I.globalMargin;
  const title = 'Footnotes';
  const entries = I.fnList.map((f) => {
    const id = `[${f.number}] `;
    let text;
    if (f.def && f.def.contents.length) {
      const first = f.def.contents[0];
      if (typeof first !== 'string' && first.type === 'paragraph') {
        first.contents.unshift(id);
        text = exportItems(f.def.contents, I);
        first.contents.shift();
      } else text = id + '\n' + exportItems(f.def.contents, I);
    } else {
      const inline = f.inline || [];
      text = fillString(id + exportItems(inline, I), width, 'left', I.preserveBreaks);
    }
    return text.trim();
  });
  I.linksToNotes = saved;
  return '\n\n\n' + title + '\n' + (I.cs.utf8 ? '─' : '_').repeat(stringWidth(title)) + '\n\n' + entries.join('\n\n');
}

/**
 * Exports `doc` (or, if `scope` is given, just that heading and its descendants) as plain text, wrapped to `textWidth`
 * characters (`org-ascii-text-width`, 72 in Org). `scope` must be a heading of `doc`. A subtree export takes the heading's
 * text as the title, as Org does.
 * @param {Doc} doc
 * @param {Heading | null} [scope]
 * @param {number} [textWidth]
 * @param {{ charset?: string, sup?: string, brokenLinks?: import('./broken-links.js').BrokenLinks }} [options]
 */
export function exportToAscii(doc, scope = /** @type {Heading | null | undefined} */ (null), textWidth = 72, { charset = 'ascii', sup = 't', brokenLinks = 'nil' } = {}) {
  ({ doc, scope } = foldInlineTasks(doc, scope));
  ({ doc, scope } = expandMacrosForExport(doc, scope, new Date()));
  const I = makeInfo(doc, scope || null, textWidth, normalizeAsciiCharset(charset), sup, brokenLinks);
  const skip = exclusion(doc);
  const roots = scope ? scope.children || [] : doc.children || [];
  I.cite = citeExportFor(doc, roots.filter((h) => !skip(h)), parseInline, !scope);
  const root = buildTree(I);
  numberHeadlines(I);
  numberFootnotes(root, I);
  collectOrdinals(root, I);
  const body = exportData(root, I);
  const inner = normalizeString(indentString(body + footnoteSection(I), I.globalMargin));
  let out = indentString(documentTitle(I) + (I.toc ? buildToc(I, typeof I.toc === 'number' ? I.toc : null, null, null) + '\n\n\n' : ''), I.globalMargin) + inner;
  if (I.withCreator) out += indentString('\n\n\n' + fillString('Generated by org-pwa', I.width - I.globalMargin, 'right', I.preserveBreaks), I.globalMargin);
  return out;
}

/**
 * Wraps `text` to `width` characters the way Emacs fills a paragraph (see ascii-fill.js); returns the lines.
 * @param {string} text @param {number} width
 */
export function wrapText(text, width) {
  const filled = fillString(text, width, 'left');
  return filled === '' ? [] : filled.split('\n');
}

/** Org's link brackets down to plain text: `[[target][description]]` reads `description (target)`. @param {string} text */
export function stripLinksForAscii(text) {
  return text.replace(/\[\[([^\]]+)\](?:\[([^\]]+)\])?\]/g, (_, target, description) => (description ? `${description} (${target})` : target));
}
