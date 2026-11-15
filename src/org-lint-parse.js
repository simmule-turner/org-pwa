// @ts-check
// The part of Org's parser (org-element.el, Org 9.6.15) that org-lint reads: headlines, sections, greater elements (blocks,
// drawers, lists, footnote definitions, tables), the plain elements and the objects org-lint looks at (links, footnote
// references, macros, targets, citations, inline Babel). It works on the text of a buffer and gives positions as character
// offsets, so a report lands on the line Emacs reports. Where Org searches with `limit`, `limit` here is a line index.
//
// Not modeled: inline tasks, radio links, timestamps, entities, LaTeX fragments, sub/superscripts, statistics cookies.
import { emacsRegexToJs } from './elisp-regex.js';
import { linkTypes } from './org-lint-data.js';

/**
 * A parsed element or object, a parse context or a list structure entry: their fields vary by type.
 * @typedef {{ [k: string]: any }} Loose
 * @typedef {{ type: string, begin: number, post: number, end: number, line: number, endLine: number, children: any[], parent: any, [k: string]: any }} Node
 */

const AFFILIATED_RE = /^[ \t]*#\+(?:(CAPTION|RESULTS)(?:\[(.*)\])?|(DATA|HEADERS?|LABEL|NAME|PLOT|RESNAME|RESULT|SOURCE|SRCNAME|TBLNAME)|(ATTR_[-_A-Za-z0-9]+)):[ \t]*/i;
const TRANSLATION = { DATA: 'NAME', LABEL: 'NAME', RESNAME: 'NAME', SOURCE: 'NAME', SRCNAME: 'NAME', TBLNAME: 'NAME', RESULT: 'RESULTS', HEADERS: 'HEADER' };
const DRAWER_RE = /^[ \t]*:([-_\p{L}\p{N}]+):[ \t]*$/u;
const PROPERTY_LINE_RE = /^[ \t]*:\S+:(?:[ \t].*)?[ \t]*$/;
const NODE_PROPERTY_RE = /^[ \t]*:(\S+):(?:$|[ \t]+(.*?))[ \t]*$/;
const CLOCK_RE = /^[ \t]*CLOCK: [[<]\d{4}-\d{2}-\d{2}(?: .*?)?[\]>](?:--[[<]\d{4}-\d{2}-\d{2}(?: .*?)?[\]>][ \t]+=>[ \t]+\d+:\d\d)?[ \t]*$/;
const PLANNING_RE = /^[ \t]*(?:CLOSED|DEADLINE|SCHEDULED):/;
const FOOTNOTE_DEF_RE = /^\[fn:([-_\p{L}\p{N}]+)\]/u;
const ITEM_RE = /^(?:[ \t]*(?:[-+]|[0-9]+[.)])|[ \t]+\*)(?:[ \t]+|$)/;
const FULL_ITEM_RE = /^[ \t]*((?:[-+*]|(?:[0-9]+|[A-Za-z])[.)])(?:[ \t]+|$))(?:\[@(?:start:)?([0-9]+|[A-Za-z])\][ \t]*)?(?:(\[[ X-]\])(?:[ \t]+|$))?(?:(.*)[ \t]+::(?:[ \t]+|$))?/;
const LATEX_BEGIN_RE = /^[ \t]*\\begin\{([A-Za-z0-9*]+)\}/i;
const DYNBLOCK_RE = /^[ \t]*#\+BEGIN:[ \t]*([\p{L}\p{N}_]+)(?:[ \t]+(.+))?/iu;
const SEPARATOR_RE = new RegExp('^(?:\\*+ |\\[fn:[-_\\p{L}\\p{N}]+\\]|%%\\(|[ \\t]*(?:$|\\||\\+(?:-+\\+)+[ \\t]*$|#(?: |$|\\+(?:BEGIN_\\S+|\\S+(?:\\[.*\\])?:[ \\t]*))|:(?: |$|[-_\\p{L}\\p{N}]+:[ \\t]*$)|-{5,}[ \\t]*$|\\\\begin\\{[A-Za-z0-9*]+\\}|CLOCK: [[<]\\d{4}-\\d{2}-\\d{2}(?: .*?)?[\\]>](?:--[[<]\\d{4}-\\d{2}-\\d{2}(?: .*?)?[\\]>][ \\t]+=>[ \\t]+\\d+:\\d\\d)?[ \\t]*$|(?:[-+*]|[0-9]+[.)])(?:[ \\t]|$)))', 'iu');
const BLANK_RE = /^[ \t]*$/;

const FULL_LINK_TYPES = linkTypes.map((t) => t.replace(/[+.]/g, '\\$&')).join('|');
const OBJECT_RE = new RegExp(
  [
    '[_^][-{(*+.,\\p{L}\\p{N}]',
    '[*~=+_/]\\S',
    `\\b(?:${FULL_LINK_TYPES}):`,
    '\\[(?:cite[:/]|fn:|(?:[0-9]|(?:%|/[0-9]*)\\])|\\[)',
    '@@',
    '\\{\\{\\{',
    `<(?:%%|<|[0-9]|(?:${FULL_LINK_TYPES}))`,
    '\\$',
    '\\\\(?:[a-zA-Z[(]|\\\\[ \\t]*$|_ +)',
    '(?:call|src)_',
  ].join('|'),
  'giu',
);
const MINIMAL = ['bold', 'code', 'entity', 'italic', 'latex-fragment', 'strike-through', 'subscript', 'superscript', 'underline', 'verbatim'];
const STANDARD = [...MINIMAL, 'citation', 'export-snippet', 'footnote-reference', 'inline-babel-call', 'inline-src-block', 'line-break', 'link', 'macro', 'radio-target', 'statistics-cookie', 'target', 'timestamp'];
const RESTRICTIONS = {
  standard: new Set(STANDARD),
  noBreak: new Set(STANDARD.filter((t) => t !== 'line-break')),
  link: new Set(['export-snippet', 'inline-babel-call', 'inline-src-block', 'macro', 'statistics-cookie', ...MINIMAL]),
  minimal: new Set(MINIMAL),
  cell: new Set(['citation', 'export-snippet', 'footnote-reference', 'link', 'macro', 'radio-target', 'target', 'timestamp', ...MINIMAL]),
};

const BRACKET_LINK_RE = emacsRegexToJs(linkBracketReSource(), 'y');
function linkBracketReSource() {
  return '\\[\\[\\(\\(?:[^][\\]\\|\\\\\\(?:\\\\\\\\\\)*[][]\\|\\\\+[^][]\\)+\\)]\\(?:\\[\\([^z-a]+?\\)]\\)?]';
}

/** The index just after the bracket group opening at `at` (square, round or curly pairs only), or -1. @param {string} s @param {number} at @param {string} open @param {string} close */
export function scanPair(s, at, open, close) {
  let depth = 0;
  for (let i = at; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close && --depth === 0) return i + 1;
  }
  return -1;
}

/** Emacs's `org-trim`. @param {string} s */
export const orgTrim = (s) => s.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '');
/** @param {string | null | undefined} s */
export const nonBlank = (s) => (s != null && /[^ \t\n\r]/.test(s) ? s : null);

/** The column of the first non-blank of a line, tabs counting up to the next multiple of 8. @param {string} line */
function textColumn(line) {
  let col = 0;
  for (const c of line) {
    if (c === ' ') col++;
    else if (c === '\t') col += 8 - (col % 8);
    else break;
  }
  return col;
}

export class Buffer {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
    this.lines = text.split('\n');
    this.n = this.lines.length;
    this.starts = [];
    let p = 0;
    for (const l of this.lines) {
      this.starts.push(p);
      p += l.length + 1;
    }
  }
  /** Offset of the start of line `i` (the end of the buffer past the last line). @param {number} i */
  pos(i) {
    return i < this.n ? this.starts[i] : this.text.length;
  }
  /** @param {number} i */
  eol(i) {
    return this.starts[i] + this.lines[i].length;
  }
  /** The line index of an offset. @param {number} pos */
  lineOf(pos) {
    let lo = 0;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  /** @param {number} i */
  blank(i) {
    return i >= this.n || BLANK_RE.test(this.lines[i]);
  }
  /** First non-blank line at or after `i`, up to `limit`. @param {number} i @param {number} limit */
  skipBlank(i, limit) {
    while (i < limit && this.blank(i)) i++;
    return i;
  }
  /** The line after the last non-blank line before `i` (`skip-chars-backward` then `line-beginning-position 2`), never before `floor`. @param {number} i @param {number} floor */
  afterLastNonBlank(i, floor) {
    let j = i;
    while (j > floor && this.blank(j - 1)) j--;
    return j;
  }
}

/** The first line in [from, limit) matching `re`, or -1. @param {Buffer} b @param {RegExp} re @param {number} from @param {number} limit */
function findLine(b, re, from, limit) {
  for (let i = from; i < limit; i++) if (re.test(b.lines[i])) return i;
  return -1;
}

/**
 * @param {Buffer} b
 * @param {{ todo: string[], footnoteSection: string | null }} ctx
 * @returns {Node}
 */
export function parseBuffer(b, ctx) {
  /** @type {Node} */
  const root = node('org-data', 0, 0, b.text.length, 0, b.n, null);
  const first = b.skipBlank(0, b.n);
  root.children = parseElements(b, ctx, first, b.n, 'first-section', null, root);
  return root;
}

/** @param {string} type @param {number} begin @param {number} post @param {number} end @param {number} line @param {number} endLine @param {Node | null} parent @returns {Node} */
function node(type, begin, post, end, line, endLine, parent) {
  return { type, begin, post, end, line, endLine, children: [], parent };
}

/**
 * org-element--parse-elements.
 * @param {Buffer} b @param {Loose} ctx @param {number} beg @param {number} limit @param {string | null} mode @param {Loose[] | null} struct @param {Node} parent
 * @returns {Node[]}
 */
function parseElements(b, ctx, beg, limit, mode, struct, parent) {
  /** @type {Node[]} */
  const out = [];
  let i = beg;
  while (i < limit) {
    const el = currentElement(b, ctx, i, limit, mode, struct, null);
    el.parent = parent;
    out.push(el);
    i = Math.max(el.endLine, i + 1);
    fillContents(b, ctx, el, struct);
    mode = nextMode(mode, el.type);
  }
  return out;
}

/** @param {string | null} mode @param {string} type */
function nextMode(mode, type) {
  if (mode === 'item') return 'item';
  if (mode === 'node-property') return 'node-property';
  if (mode === 'planning' && type === 'planning') return 'property-drawer';
  if (mode === 'top-comment' && type === 'comment') return 'property-drawer';
  return null;
}

const GREATER = new Set(['center-block', 'drawer', 'dynamic-block', 'footnote-definition', 'headline', 'item', 'plain-list', 'property-drawer', 'quote-block', 'section', 'special-block', 'table']);

/** Parses what lies inside an element: sub-elements or objects. @param {Buffer} b @param {Loose} ctx @param {Node} el @param {Loose[] | null} struct */
function fillContents(b, ctx, el, struct) {
  if (el.cbLine == null && el.cbPos == null) return;
  if (el.type === 'headline') {
    const kids = parseElements(b, ctx, el.cbLine, el.ceLine, 'section', null, el);
    el.children = kids;
  } else if (el.type === 'section') {
    const mode = el.firstSection ? 'top-comment' : 'planning';
    el.children = parseElements(b, ctx, el.cbLine, el.ceLine, mode, null, el);
  } else if (el.type === 'plain-list') {
    el.children = parseItems(b, ctx, el);
  } else if (el.type === 'item') {
    el.children = parseElementsFrom(b, ctx, el.cbPos, el.ceLine, null, el.struct, el);
  } else if (el.type === 'footnote-definition') {
    el.children = parseElementsFrom(b, ctx, el.cbPos, el.ceLine, null, null, el);
  } else if (el.type === 'property-drawer') {
    el.children = parseNodeProperties(b, el);
  } else if (el.type === 'table') {
    el.children = parseRows(b, ctx, el);
  } else if (GREATER.has(el.type)) {
    el.children = parseElements(b, ctx, el.cbLine, el.ceLine, null, null, el);
  } else if (el.type === 'paragraph' || el.type === 'verse-block') {
    el.children = parseObjects(b, el.cbPos, el.cePos, RESTRICTIONS.standard, el);
  }
}

/** Contents that begin at an offset (an item's or a footnote definition's text may start mid-line): the first element is a paragraph. @param {Buffer} b @param {Loose} ctx @param {number} cbPos @param {number} limit @param {string | null} mode @param {Loose[] | null} struct @param {Node} parent */
function parseElementsFrom(b, ctx, cbPos, limit, mode, struct, parent) {
  const line = b.lineOf(cbPos);
  /** @type {Node[]} */
  const out = [];
  let i = line;
  let first = cbPos !== b.pos(line);
  while (i < limit) {
    const el = first ? paragraphAt(b, i, limit, cbPos, null, 0) : currentElement(b, ctx, i, limit, mode, struct, null);
    first = false;
    el.parent = parent;
    out.push(el);
    i = Math.max(el.endLine, i + 1);
    fillContents(b, ctx, el, struct);
  }
  return out;
}

/** @param {Buffer} b @param {number} i @param {number} limit */
function endAfter(b, i, limit) {
  const j = b.skipBlank(i, limit);
  return j;
}

/**
 * org-element--current-element.
 * @param {Buffer} b @param {Loose} ctx @param {number} i @param {number} limit @param {string | null} mode @param {Loose[] | null} struct @param {Loose | null} unused
 * @returns {Node}
 */
function currentElement(b, ctx, i, limit, mode, struct, unused) {
  const line = b.lines[i];
  if (/^\*+ /.test(line)) return headlineAt(b, ctx, i, limit);
  if (mode === 'section' || mode === 'first-section') return sectionAt(b, i, limit, mode === 'first-section');
  if (/^[ \t]*#(?: |$)/.test(line)) return commentAt(b, i, limit);
  const prevStar = i > 0 && b.lines[i - 1][0] === '*';
  if (mode === 'planning' && prevStar && PLANNING_RE.test(line)) return planningAt(b, i, limit);
  const prevNotBlank = i === 0 || !BLANK_RE.test(b.lines[i - 1]);
  if (((mode === 'planning' && prevStar) || ((mode === 'property-drawer' || mode === 'top-comment') && prevNotBlank)) && isPropertyDrawer(b, i)) return propertyDrawerAt(b, i, limit);
  if (CLOCK_RE.test(line)) return simple(b, 'clock', i, limit, i, i + 1);
  // from here on elements can have affiliated keywords
  const aff = collectAffiliated(b, i, limit);
  let at = aff.next;
  if (aff.keywords.length && at >= limit) return keywordAt(b, i, limit, null);
  const l = b.lines[at];
  const affiliated = aff.keywords.length ? aff : null;
  /** @type {RegExpExecArray | null} */
  let m;
  if (LATEX_BEGIN_RE.test(l)) return latexEnvAt(b, at, limit, affiliated, aff.start);
  if (DRAWER_RE.test(l)) return drawerAt(b, at, limit, affiliated, aff.start);
  if (/^[ \t]*:( |$)/.test(l)) return fixedWidthAt(b, at, limit, affiliated, aff.start);
  if (/^[ \t]*#\+/i.test(l)) {
    const rest = l.replace(/^[ \t]*#\+/, '');
    if ((m = /^BEGIN_(\S+)/i.exec(rest))) return blockAt(b, ctx, at, limit, affiliated, aff.start, m[1]);
    if (/^CALL:/i.test(rest)) return babelCallAt(b, at, limit, affiliated, aff.start);
    if (DYNBLOCK_RE.test(l)) return dynamicBlockAt(b, at, limit, affiliated, aff.start);
    if (/^\S+:/.test(rest)) return keywordAt(b, at, limit, affiliated, aff.start);
    return paragraphAt(b, at, limit, b.pos(at), affiliated, aff.start);
  }
  if (FOOTNOTE_DEF_RE.test(l)) return footnoteDefAt(b, at, limit, affiliated, aff.start);
  if (/^[ \t]*-{5,}[ \t]*$/.test(l)) return finish(b, 'horizontal-rule', at, limit, affiliated, aff.start, at + 1);
  if (l.startsWith('%%(')) return finish(b, 'diary-sexp', at, limit, affiliated, aff.start, at + 1);
  if (/^[ \t]*\|/.test(l) || isTableEl(b, at, limit)) return tableAt(b, at, limit, affiliated, aff.start);
  if (ITEM_RE.test(l)) return plainListAt(b, at, limit, affiliated, aff.start, struct);
  return paragraphAt(b, at, limit, b.pos(at), affiliated, aff.start);
}

/** @param {Buffer} b @param {number} at @param {number} limit */
function isTableEl(b, at, limit) {
  const rule = /^[ \t]*\+(?:-+\+)+[ \t]*$/;
  const nonTable = /^[ \t]*(?:$|[^+| \t])/;
  if (!rule.test(b.lines[at]) || at + 1 >= limit) return false;
  let j = at + 1;
  while (j < limit && !nonTable.test(b.lines[j])) j++;
  if (j >= limit) return rule.test(b.lines[limit - 1]) && limit - 1 > at;
  if (j === at + 1) return false;
  return rule.test(b.lines[j - 1]);
}

/** org-element--collect-affiliated-keywords. @param {Buffer} b @param {number} i @param {number} limit */
function collectAffiliated(b, i, limit) {
  const keywords = [];
  let k = i;
  while (k < limit) {
    const m = AFFILIATED_RE.exec(b.lines[k]);
    if (!m) break;
    const raw = (m[1] || m[3] || m[4]).toUpperCase();
    const kwd = TRANSLATION[/** @type {keyof typeof TRANSLATION} */ (raw)] || raw;
    const value = orgTrim(b.lines[k].slice(m[0].length));
    keywords.push({ raw, kwd, value, dual: m[2] == null ? null : m[2], line: k });
    k++;
  }
  if (k >= b.n || BLANK_RE.test(b.lines[k]) ? true : false) return { keywords: [], next: i, start: b.pos(i) };
  return { keywords, next: k, start: b.pos(i) };
}

/** @param {Loose | null} aff */
function affProps(aff) {
  const props = {};
  if (!aff) return props;
  /** @type {Loose[]} */
  const header = [];
  for (const k of aff.keywords) {
    if (k.kwd === 'NAME') props.name = k.value;
    else if (k.kwd === 'HEADER') header.unshift(k.value);
    else if (k.kwd === 'RESULTS') props.results = [k.value, k.dual];
  }
  if (header.length) props.header = header;
  props.affiliated = aff.keywords;
  return props;
}

/** @param {Buffer} b @param {string} type @param {number} at @param {number} limit @param {Loose | null} aff @param {number} start @param {number} afterLine the line after the element's own text */
function finish(b, type, at, limit, aff, start, afterLine) {
  const endLine = endAfter(b, afterLine, limit);
  const el = node(type, aff ? start : b.pos(at), b.pos(at), b.pos(endLine), at, endLine, null);
  Object.assign(el, affProps(aff));
  return el;
}

/** @param {Buffer} b @param {string} type @param {number} i @param {number} limit @param {number} cb @param {number} ce */
function simple(b, type, i, limit, cb, ce) {
  return finish(b, type, i, limit, null, b.pos(i), ce);
}

/** @param {Buffer} b @param {number} i @param {number} limit */
function commentAt(b, i, limit) {
  let j = i + 1;
  while (j < limit && /^[ \t]*#( |$)/.test(b.lines[j])) j++;
  return finish(b, 'comment', i, limit, null, b.pos(i), j);
}

/** @param {Buffer} b @param {number} i @param {number} limit */
function planningAt(b, i, limit) {
  return finish(b, 'planning', i, limit, null, b.pos(i), i + 1);
}

/** @param {Buffer} b @param {number} i */
function isPropertyDrawer(b, i) {
  if (!/^[ \t]*:PROPERTIES:[ \t]*$/i.test(b.lines[i])) return false;
  for (let j = i + 1; j < b.n; j++) {
    if (/^[ \t]*:END:[ \t]*$/i.test(b.lines[j])) return true;
    if (!PROPERTY_LINE_RE.test(b.lines[j])) return false;
  }
  return false;
}

/** @param {Buffer} b @param {number} i @param {number} limit */
function propertyDrawerAt(b, i, limit) {
  const e = findLine(b, /^[ \t]*:END:[ \t]*$/i, i + 1, limit);
  const endLine = endAfter(b, e + 1, limit);
  const el = node('property-drawer', b.pos(i), b.pos(i), b.pos(endLine), i, endLine, null);
  if (e > i + 1) {
    el.cbLine = i + 1;
    el.ceLine = e;
  }
  return el;
}

/** @param {Buffer} b @param {Node} el */
function parseNodeProperties(b, el) {
  /** @type {Node[]} */
  const out = [];
  for (let i = el.cbLine; i < el.ceLine; i++) {
    const m = NODE_PROPERTY_RE.exec(b.lines[i]);
    const p = node('node-property', b.pos(i), b.pos(i), b.pos(i + 1), i, i + 1, el);
    p.key = m ? m[1] : '';
    p.value = m ? (m[2] ?? '') : '';
    out.push(p);
  }
  return out;
}

/** @param {Buffer} b @param {number} i @param {number} limit @param {boolean} first */
function sectionAt(b, i, limit, first) {
  let e = i;
  while (e < limit && !/^\*+ /.test(b.lines[e])) e++;
  const ce = b.afterLastNonBlank(e, i);
  const el = node('section', b.pos(i), b.pos(i), b.pos(e), i, e, null);
  el.cbLine = i;
  el.ceLine = Math.max(ce, i + 1);
  el.firstSection = first;
  return el;
}

/** @param {Buffer} b @param {Loose} ctx @param {number} i @param {number} limit */
function headlineAt(b, ctx, i, limit) {
  const line = b.lines[i];
  const stars = /** @type {RegExpExecArray} */ (/^\*+/.exec(line))[0].length;
  let p = stars;
  while (line[p] === ' ' || line[p] === '\t') p++;
  let rest = line.slice(p);
  let todo = null;
  const tm = new RegExp(`^(${ctx.todo.map((/** @type {string} */ t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}) `).exec(rest);
  if (ctx.todo.length && tm) {
    todo = tm[1];
    p += tm[0].length;
    while (line[p] === ' ' || line[p] === '\t') p++;
    rest = line.slice(p);
  }
  let priority = null;
  const pm = /^\[#.\][ \t]*/.exec(rest);
  if (pm) {
    priority = pm[0][2];
    p += pm[0].length;
    rest = line.slice(p);
  }
  let commented = false;
  const cm = /^COMMENT(?=[ \t]|$)/.exec(rest);
  if (cm) {
    commented = true;
    p += 7;
  }
  let titleStart = p;
  if (!todo && !priority && !commented) while (titleStart > 0 && (line[titleStart - 1] === ' ' || line[titleStart - 1] === '\t')) titleStart--;
  /** @type {string[] | null} */
  let tags = null;
  let titleEnd = line.length;
  const tg = /[ \t]+(:[\p{L}\p{N}_@#%:]+:)[ \t]*$/u.exec(line.slice(titleStart));
  if (tg) {
    titleEnd = titleStart + tg.index;
    tags = orgSplitTags(tg[1]);
  }
  const raw = orgTrim(line.slice(titleStart, titleEnd));
  let end = i + 1;
  while (end < limit && !new RegExp(`^\\*{1,${stars}} `).test(b.lines[end])) end++;
  const cbLine = b.skipBlank(i + 1, end);
  const el = node('headline', b.pos(i), b.pos(i), b.pos(end), i, end, null);
  el.level = stars;
  el.todo = todo;
  el.tags = tags || [];
  el.raw = raw;
  el.commented = commented;
  el.footnoteSection = ctx.footnoteSection != null && ctx.footnoteSection === raw;
  if (cbLine < end) {
    el.cbLine = cbLine;
    el.ceLine = b.afterLastNonBlank(end, cbLine);
    el.cbPos = b.pos(cbLine);
  } else el.cbPos = null;
  el.contentsBegin = el.cbPos;
  // the title's objects
  const tStart = b.pos(i) + (() => {
    let q = titleStart;
    while (line[q] === ' ' || line[q] === '\t') q++;
    return q;
  })();
  let tEnd = b.pos(i) + titleEnd;
  while (tEnd > tStart && (b.text[tEnd - 1] === ' ' || b.text[tEnd - 1] === '\t')) tEnd--;
  el.title = tEnd > tStart ? parseObjects(b, tStart, tEnd, RESTRICTIONS.noBreak, el) : [];
  // node properties of the headline: drawer right after the headline, after an optional planning line
  el.properties = headlineProperties(b, i);
  return el;
}

/** org-split-string on ":" of a matched tag group: `:a::b:` gives ("" "a" "" "b" ""), and Org keeps empty strings but drops the outer pair. @param {string} group */
function orgSplitTags(group) {
  const parts = group.split(':');
  return parts.slice(1, -1);
}

/** @param {Buffer} b @param {number} i */
function headlineProperties(b, i) {
  let k = i + 1;
  if (k < b.n && PLANNING_RE.test(b.lines[k])) k++;
  /** @type {Record<string, string>} */
  const props = {};
  if (k >= b.n || !isPropertyDrawer(b, k)) return props;
  for (let j = k + 1; j < b.n && !/^[ \t]*:END:[ \t]*$/i.test(b.lines[j]); j++) {
    const m = NODE_PROPERTY_RE.exec(b.lines[j]);
    if (m) props[m[1].toUpperCase()] = m[2] ?? '';
  }
  return props;
}

/** @param {Buffer} b @param {Loose} ctx @param {number} at @param {number} limit @param {Loose | null} aff @param {number} start @param {string} name */
function blockAt(b, ctx, at, limit, aff, start, name) {
  const type = name.toUpperCase();
  const endRe = new RegExp(`^[ \\t]*#\\+END_${['CENTER', 'COMMENT', 'EXAMPLE', 'EXPORT', 'QUOTE', 'SRC', 'VERSE'].includes(type) ? type : name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'i');
  const e = findLine(b, endRe, at, limit);
  if (e < 0) return paragraphAt(b, at, limit, b.pos(at), aff, start);
  const endLine = endAfter(b, e + 1, limit);
  const l = b.lines[at];
  const kind = { CENTER: 'center-block', COMMENT: 'comment-block', EXAMPLE: 'example-block', EXPORT: 'export-block', QUOTE: 'quote-block', SRC: 'src-block', VERSE: 'verse-block' }[/** @type {'CENTER'} */ (type)] || 'special-block';
  const el = node(kind, aff ? start : b.pos(at), b.pos(at), b.pos(endLine), at, endLine, null);
  Object.assign(el, affProps(aff));
  const hasContents = at + 1 < e;
  if (kind === 'center-block' || kind === 'quote-block' || kind === 'special-block') {
    if (hasContents) {
      el.cbLine = at + 1;
      el.ceLine = e;
    }
    if (kind === 'special-block') {
      const m = /^[ \t]*#\+BEGIN_(\S+)[ \t]*(.*)[ \t]*$/i.exec(l);
      el.btype = m ? m[1] : name;
    }
  } else if (kind === 'verse-block') {
    if (hasContents) {
      el.cbPos = b.pos(at + 1);
      el.cePos = b.pos(e);
    }
  } else {
    el.valueFrom = at + 1;
    el.valueTo = e;
    if (kind === 'export-block') {
      const m = /^[ \t]*#\+BEGIN_EXPORT(?:[ \t]+(\S+))?[ \t]*$/i.exec(l);
      el.btype = m && m[1] ? m[1].toUpperCase() : null;
    } else if (kind === 'src-block') {
      const m = /^[ \t]*#\+BEGIN_SRC(?: +(\S+))?((?: +(?:-(?:l ".+"|[ikr])|[-+]n(?: *[0-9]+)?))+)?(.*)[ \t]*$/i.exec(l);
      el.language = m ? m[1] || null : null;
      el.switches = m && nonBlank(m[2]) ? orgTrim(m[2]) : null;
      el.parameters = m && nonBlank(m[3]) ? orgTrim(m[3]) : null;
      el.blockSwitches = m ? m[2] || null : null;
    } else if (kind === 'example-block') {
      const m = /^[ \t]*#\+BEGIN_EXAMPLE(?: +(.*))?/i.exec(l);
      el.blockSwitches = m ? m[1] ?? null : null;
    }
    if (kind === 'src-block' || kind === 'example-block') {
      const sw = el.blockSwitches;
      const numberLines = sw != null && /([-+])n(?: *([0-9]+))?\b/.test(sw);
      const retain = sw == null || !/-r\b/.test(sw) || (numberLines && /-k\b/.test(sw));
      el.useLabels = sw == null || (retain && !/-k\b/.test(sw));
      const lm = sw != null ? /-l +"([^"\n]+)"/.exec(sw) : null;
      el.labelFmt = lm ? lm[1] : null;
    }
  }
  return el;
}

/** @param {Buffer} b @param {number} at @param {number} limit @param {Loose | null} aff @param {number} start */
function dynamicBlockAt(b, at, limit, aff, start) {
  const e = findLine(b, /^[ \t]*#\+END:?[ \t]*$/i, at, limit);
  if (e < 0) return paragraphAt(b, at, limit, b.pos(at), aff, start);
  const endLine = endAfter(b, e + 1, limit);
  const el = node('dynamic-block', aff ? start : b.pos(at), b.pos(at), b.pos(endLine), at, endLine, null);
  Object.assign(el, affProps(aff));
  if (at + 1 < e) {
    el.cbLine = at + 1;
    el.ceLine = e;
  }
  return el;
}

/** @param {Buffer} b @param {number} at @param {number} limit @param {Loose | null} aff @param {number} start */
function drawerAt(b, at, limit, aff, start) {
  const e = findLine(b, /^[ \t]*:END:[ \t]*$/i, at + 1, limit);
  if (e < 0) return paragraphAt(b, at, limit, b.pos(at), aff, start);
  const endLine = endAfter(b, e + 1, limit);
  const el = node('drawer', aff ? start : b.pos(at), b.pos(at), b.pos(endLine), at, endLine, null);
  Object.assign(el, affProps(aff));
  el.dname = /** @type {RegExpExecArray} */ (DRAWER_RE.exec(b.lines[at]))[1];
  el.contentsEnd = at + 1 < e ? b.pos(e) : null;
  if (at + 1 < e) {
    el.cbLine = at + 1;
    el.ceLine = e;
  }
  return el;
}

/** @param {Buffer} b @param {number} at @param {number} limit @param {Loose | null} aff @param {number} start */
function fixedWidthAt(b, at, limit, aff, start) {
  let j = at;
  while (j < limit && /^[ \t]*:( |$)/.test(b.lines[j])) j++;
  return finish(b, 'fixed-width', at, limit, aff, start, j);
}

/** @param {Buffer} b @param {number} at @param {number} limit @param {Loose | null} aff @param {number} start */
function latexEnvAt(b, at, limit, aff, start) {
  const name = /** @type {RegExpExecArray} */ (LATEX_BEGIN_RE.exec(b.lines[at]))[1];
  const endRe = new RegExp(`\\\\end\\{${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}[ \\t]*$`, 'i');
  const e = findLine(b, endRe, at, limit);
  if (e < 0) return paragraphAt(b, at, limit, b.pos(at), aff, start);
  return finish(b, 'latex-environment', at, limit, aff, start, e + 1);
}

/** @param {Buffer} b @param {number} at @param {number} limit @param {Loose | null} aff @param {number} start */
function keywordAt(b, at, limit, aff, start = b.pos(at)) {
  const m = /^[ \t]*#\+(\S*):/.exec(b.lines[at]);
  const el = finish(b, 'keyword', at, limit, aff, start, at + 1);
  el.key = m ? m[1].toUpperCase() : '';
  el.value = m ? orgTrim(b.lines[at].slice(m[0].length)) : '';
  return el;
}

/** Index after the closing bracket group starting at `from`, within one line's text; also used for babel calls. @param {string} s @param {number} i @param {string} open @param {string} close */
function pairedContent(s, i, open, close) {
  if (s[i] !== open) return null;
  const end = scanPair(s, i, open, close);
  return end < 0 ? null : { text: s.slice(i + 1, end - 1), end };
}

/** @param {Buffer} b @param {number} at @param {number} limit @param {Loose | null} aff @param {number} start */
function babelCallAt(b, at, limit, aff, start) {
  const t = b.text;
  const before = b.pos(at + 1);
  let p = b.pos(at) + b.lines[at].indexOf(':') + 1;
  while (t[p] === ' ' || t[p] === '\t') p++;
  // skip-chars-forward "^[]()" stops at the end of the line's newline when no bracket comes first
  let q = p;
  while (q < before && !'[]()'.includes(t[q])) q++;
  const call = nonBlank(t.slice(p, q));
  const inside = pairedContent(t, q, '[', ']');
  if (inside) q = inside.end;
  const args = pairedContent(t, q, '(', ')');
  if (args) q = args.end;
  const eol = t.indexOf('\n', q) < 0 ? t.length : t.indexOf('\n', q);
  // the parser moved point on to the following line when the line had no bracket: that line belongs to the call
  const el = finish(b, 'babel-call', at, limit, aff, start, b.lineOf(Math.min(q, t.length)) + 1);
  el.call = call;
  el.insideHeader = inside ? inside.text : null;
  el.arguments = args ? nonBlank(args.text) : null;
  el.endHeader = nonBlank(orgTrim(t.slice(q, eol)));
  return el;
}

/** @param {Buffer} b @param {number} at @param {number} limit @param {Loose | null} aff @param {number} start */
function footnoteDefAt(b, at, limit, aff, start) {
  const m = /** @type {RegExpExecArray} */ (FOOTNOTE_DEF_RE.exec(b.lines[at]));
  const postLine = at;
  let endLine = limit;
  for (let j = at + 1; j < limit + 1; j++) {
    const headline = j < limit && /^\*+ /.test(b.lines[j]);
    const fdef = j < limit && FOOTNOTE_DEF_RE.test(b.lines[j]);
    const twoBlank = j + 2 <= limit && j + 1 <= b.n - 2 && BLANK_RE.test(b.lines[j]) && BLANK_RE.test(b.lines[j + 1]) && j <= b.n - 2;
    if (headline) {
      endLine = j;
      break;
    }
    if (fdef) {
      let k = j - 1;
      while (k > postLine && AFFILIATED_RE.test(b.lines[k])) k--;
      endLine = k + 1;
      break;
    }
    if (twoBlank) {
      let k = j + 2;
      k = b.skipBlank(k, limit);
      endLine = k;
      break;
    }
  }
  const el = node('footnote-definition', aff ? start : b.pos(at), b.pos(at), b.pos(endLine), at, endLine, null);
  Object.assign(el, affProps(aff));
  el.label = m[1];
  // contents: after the closing bracket, skip blanks up to the end
  const after = b.pos(at) + m[0].length;
  let q = after;
  const endPos = b.pos(endLine);
  while (q < endPos && /[ \t\r\n]/.test(b.text[q])) q++;
  if (q < endPos) {
    el.cbPos = b.lineOf(q) === at ? q : b.pos(b.lineOf(q));
    el.cbLine = b.lineOf(el.cbPos);
    el.ceLine = b.afterLastNonBlank(endLine, el.cbLine);
  }
  return el;
}

/** @param {Buffer} b @param {number} at @param {number} limit @param {Loose | null} aff @param {number} start */
function tableAt(b, at, limit, aff, start) {
  const org = /^[ \t]*\|/.test(b.lines[at]);
  const endRe = org ? /^[ \t]*(?:$|[^| \t])/ : /^[ \t]*(?:$|[^|+ \t])/;
  let j = at;
  while (j < limit && !endRe.test(b.lines[j])) j++;
  const tableEnd = j;
  while (j < limit && /^[ \t]*#\+TBLFM: +(.*)[ \t]*$/i.test(b.lines[j])) j++;
  const endLine = endAfter(b, j, limit);
  const el = node('table', aff ? start : b.pos(at), b.pos(at), b.pos(endLine), at, endLine, null);
  Object.assign(el, affProps(aff));
  el.tableType = org ? 'org' : 'table.el';
  if (org) {
    el.cbLine = at;
    el.ceLine = tableEnd;
  }
  return el;
}

/** @param {Buffer} b @param {Loose} ctx @param {Node} el */
function parseRows(b, ctx, el) {
  /** @type {Node[]} */
  const rows = [];
  for (let i = el.cbLine; i < el.ceLine; i++) {
    const line = b.lines[i];
    const row = node('table-row', b.pos(i), b.pos(i), b.pos(i + 1), i, i + 1, el);
    if (!/^[ \t]*\|-/.test(line)) {
      const first = b.pos(i) + line.indexOf('|') + 1;
      let last = b.eol(i);
      while (last > first && (b.text[last - 1] === ' ' || b.text[last - 1] === '\t')) last--;
      row.children = parseCells(b, first, last, row);
    }
    rows.push(row);
  }
  return rows;
}

/** @param {Buffer} b @param {number} from @param {number} to @param {Node} parent */
function parseCells(b, from, to, parent) {
  /** @type {Node[]} */
  const cells = [];
  let p = from;
  while (p < to) {
    const rest = b.text.slice(p, to);
    const m = /** @type {RegExpExecArray} */ (/^[ \t]*(.*?)[ \t]*(?:\||$)/.exec(rest));
    const contentsBegin = p + /** @type {RegExpExecArray} */ (/^[ \t]*/.exec(rest))[0].length;
    const contentsEnd = contentsBegin + m[1].length;
    const cell = node('table-cell', p, p, p + m[0].length, 0, 0, parent);
    cell.cbPos = contentsBegin;
    cell.cePos = contentsEnd;
    cell.children = parseObjects(b, contentsBegin, contentsEnd, RESTRICTIONS.cell, cell);
    cells.push(cell);
    p += m[0].length;
    if (m[0].length === 0) break;
  }
  return cells;
}

/** @param {Buffer} b @param {number} at @param {number} limit @param {number} contentsBegin @param {Loose | null} aff @param {number} start */
function paragraphAt(b, at, limit, contentsBegin, aff, start) {
  const hereLine = b.lineOf(contentsBegin);
  let j = hereLine + 1;
  let endLine = limit;
  for (; j < limit; j++) {
    const l = b.lines[j];
    if (!SEPARATOR_RE.test(l)) continue;
    let ok = true;
    let m;
    if (DRAWER_RE.test(l)) ok = findLine(b, /^[ \t]*:END:[ \t]*$/i, j, limit) >= 0;
    else if ((m = /^[ \t]*#\+BEGIN_(\S+)/i.exec(l))) ok = findLine(b, new RegExp(`^[ \\t]*#\\+END_${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'i'), j, limit) >= 0;
    else if ((m = LATEX_BEGIN_RE.exec(l))) ok = findLine(b, new RegExp(`\\\\end\\{${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}[ \\t]*$`, 'i'), j, limit) >= 0;
    else if ((m = /^[ \t]*#\+(\S+)\[.*\]:/.exec(l))) ok = /^(?:CAPTION|RESULTS)$/i.test(m[1]);
    if (ok) {
      endLine = j;
      break;
    }
  }
  const ceLine = b.afterLastNonBlank(endLine, hereLine);
  const afterEnd = endAfter(b, endLine, limit);
  const el = node('paragraph', aff ? start : contentsBegin, contentsBegin, b.pos(afterEnd), at, afterEnd, null);
  Object.assign(el, affProps(aff));
  el.cbPos = contentsBegin;
  el.cePos = b.pos(Math.max(ceLine, hereLine + 1));
  if (el.cePos > b.text.length) el.cePos = b.text.length;
  // contents end before the newline that ends the last line
  if (el.cePos > el.cbPos && b.text[el.cePos - 1] === '\n') el.cePos--;
  return el;
}

// ---------------------------------------------------------------- lists

/** org-element--list-struct from the list's first line. @param {Buffer} b @param {number} start @param {number} limit */
function listStruct(b, start, limit) {
  /** @type {Loose[]} */
  const items = [];
  /** @type {Loose[]} */
  const struct = [];
  let k = start;
  const done = () => [...items, ...struct].sort((x, y) => x.line - y.line);
  for (;;) {
    if (k >= limit) {
      const end = b.afterLastNonBlank(limit, 0);
      for (const it of items) it.endLine = end;
      return done();
    }
    const line = b.lines[k];
    if (BLANK_RE.test(line) && k + 1 <= b.n - 2 && BLANK_RE.test(b.lines[k + 1]) && k <= b.n - 2) {
      for (const it of items) it.endLine = k;
      return done();
    }
    if (ITEM_RE.test(line)) {
      const ind = textColumn(line);
      while (items.length && ind <= items[items.length - 1].ind) {
        const it = /** @type {Loose} */ (items.pop());
        it.endLine = k;
        struct.push(it);
      }
      const m = /** @type {RegExpExecArray} */ (FULL_ITEM_RE.exec(line));
      items.push({ line: k, ind, bullet: m[1], counter: m[2] ?? null, box: m[3] ?? null, tag: /[-+*]/.test(m[1]) ? m[4] ?? null : null, endLine: -1, tagMatch: m });
      k++;
    } else if (BLANK_RE.test(line)) k++;
    else {
      const ind = textColumn(line);
      const end = b.afterLastNonBlank(k, 0);
      while (items.length && ind <= items[items.length - 1].ind) {
        const it = /** @type {Loose} */ (items.pop());
        it.endLine = end;
        struct.push(it);
        if (!items.length) return struct.sort((x, y) => x.line - y.line);
      }
      let m;
      if ((m = /^[ \t]*#\+BEGIN(:|_\S+)/i.exec(line))) {
        const e = findLine(b, new RegExp(`^[ \\t]*#\\+END${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'i'), k, limit);
        if (e >= 0) k = e;
      } else if (DRAWER_RE.test(line)) {
        const e = findLine(b, /^[ \t]*:END:[ \t]*$/i, k + 1, limit);
        if (e >= 0) k = e;
      }
      k++;
    }
  }
}

/** @param {Buffer} b @param {number} at @param {number} limit @param {Loose | null} aff @param {number} start @param {Loose[] | null} structure */
function plainListAt(b, at, limit, aff, start, structure) {
  const struct = structure || listStruct(b, at, limit);
  const first = /** @type {Loose} */ (struct.find((/** @type {Loose} */ s) => s.line === at));
  let endLine = first.endLine;
  let next;
  while ((next = struct.find((/** @type {Loose} */ s) => s.line === endLine)) && next.ind === first.ind) endLine = next.endLine;
  const after = b.skipBlank(endLine, limit);
  const el = node('plain-list', aff ? start : b.pos(at), b.pos(at), b.pos(after), at, after, null);
  Object.assign(el, affProps(aff));
  el.struct = struct;
  el.cbLine = at;
  el.ceLine = endLine;
  return el;
}

/** @param {Buffer} b @param {Loose} ctx @param {Node} list */
function parseItems(b, ctx, list) {
  /** @type {Node[]} */
  const out = [];
  let i = list.cbLine;
  while (i < list.ceLine) {
    const entry = list.struct.find((/** @type {Loose} */ s) => s.line === i);
    if (!entry) break;
    const end = entry.endLine;
    const item = node('item', b.pos(i), b.pos(i), b.pos(end), i, end, list);
    item.struct = list.struct;
    item.bullet = entry.bullet;
    const m = entry.tagMatch;
    const lineStart = b.pos(i);
    let q = lineStart + m[0].length;
    const endPos = b.pos(end);
    while (q < endPos && /[ \t\r\n]/.test(b.text[q])) q++;
    if (q < endPos) {
      item.cbPos = b.lineOf(q) === i ? q : b.pos(b.lineOf(q));
      item.cbLine = b.lineOf(item.cbPos);
      item.ceLine = b.afterLastNonBlank(end, item.cbLine);
    }
    item.contentsBegin = item.cbPos ?? null;
    if (entry.tag != null) {
      const tb = lineStart + m[0].indexOf(m[4], m[1].length);
      item.tag = parseObjects(b, tb, tb + m[4].length, RESTRICTIONS.noBreak, item);
    }
    out.push(item);
    fillContents(b, ctx, item, list.struct);
    i = end;
  }
  return out;
}

// ---------------------------------------------------------------- objects

/** @param {string} s @returns {boolean} */
const isSpace = (s) => /\s/.test(s);

/**
 * org-element--parse-objects over text[beg, end): the objects found, with the text between them as `plain-text` nodes.
 * @param {Buffer} b @param {number} beg @param {number} end @param {Set<string>} restriction @param {Node} parent
 * @returns {Loose[]}
 */
export function parseObjects(b, beg, end, restriction, parent) {
  const s = b.text.slice(beg, end);
  /** @type {Loose[]} */
  const out = [];
  let at = 0;
  let textFrom = 0;
  OBJECT_RE.lastIndex = 0;
  while (at < s.length) {
    OBJECT_RE.lastIndex = at;
    const m = OBJECT_RE.exec(s);
    if (!m) break;
    const found = objectAt(b, s, m.index, beg, restriction, m[0]);
    if (!found) {
      at = m.index + 1;
      continue;
    }
    if (found.rel > textFrom) out.push(plain(s.slice(textFrom, found.rel), parent, beg + textFrom));
    found.parent = parent;
    out.push(found);
    at = found.relEnd;
    textFrom = found.relEnd;
  }
  if (textFrom < s.length) out.push(plain(s.slice(textFrom), parent, beg + textFrom));
  return out;
}

/** @param {string} text @param {Loose} parent @param {number} pos */
function plain(text, parent, pos) {
  return { type: 'plain-text', text, parent, begin: pos };
}

/** @param {Buffer} b @param {string} s @param {number} i @param {number} base @param {Set<string>} r @param {string} lexed */
function objectAt(b, s, i, base, r, lexed) {
  const c = s[i];
  /** @param {Loose} o @param {number} relEnd */
  const done = (o, relEnd) => Object.assign(o, { rel: i, relEnd, begin: base + i, end: base + relEnd });
  if (/^call_/i.test(lexed)) return r.has('inline-babel-call') ? inlineCall(s, i, done) : null;
  if (/^src_/i.test(lexed)) return r.has('inline-src-block') ? inlineSrc(s, i, done) : null;
  switch (c) {
    case '*': return r.has('bold') ? emphasis(b, s, i, base, '*', 'bold', done) : null;
    case '/': return r.has('italic') ? emphasis(b, s, i, base, '/', 'italic', done) : null;
    case '~': return r.has('code') ? emphasis(b, s, i, base, '~', 'code', done) : null;
    case '=': return r.has('verbatim') ? emphasis(b, s, i, base, '=', 'verbatim', done) : null;
    case '+': return r.has('strike-through') ? emphasis(b, s, i, base, '+', 'strike-through', done) : null;
    case '_': return r.has('underline') ? emphasis(b, s, i, base, '_', 'underline', done) : null;
    case '@': return r.has('export-snippet') ? exportSnippet(s, i, done) : null;
    case '{': return r.has('macro') ? macro(s, i, done) : null;
    case '<':
      if (s[i + 1] === '<') {
        return (r.has('radio-target') && radioTarget(b, s, i, base, done)) || (r.has('target') ? target(s, i, done) : null);
      }
      return r.has('link') ? link(b, s, i, base, done) : null;
    case '[':
      if (s[i + 1] === '[') return r.has('link') ? link(b, s, i, base, done) : null;
      if (s[i + 1] === 'f') return r.has('footnote-reference') ? footnoteReference(b, s, i, base, done) : null;
      if (s[i + 1] === 'c') return r.has('citation') ? citation(b, s, i, base, done) : null;
      return null;
    case '^': case '$': case '\\': return null;
    default: return r.has('link') ? link(b, s, i, base, done) : null;
  }
}

/** @param {Buffer} b @param {string} s @param {number} i @param {number} base @param {string} mark @param {string} type @param {Function} done */
function emphasis(b, s, i, base, mark, type, done) {
  const before = i === 0 ? '\n' : s[i - 1];
  if (!(i === 0 || before === '\n' || /[\s\-('"{]/.test(before))) return null;
  if (i + 1 >= s.length || isSpace(s[i + 1])) return null;
  const closing = new RegExp(`\\S(${mark.replace(/[+*]/g, '\\$&')})(?:[\\s\\-.,;:!?'")}\\\\[]|$)`, 'gm');
  closing.lastIndex = i + 1;
  const m = closing.exec(s);
  if (!m) return null;
  const closeAt = m.index + 1;
  let relEnd = closeAt + 1;
  while (s[relEnd] === ' ' || s[relEnd] === '\t') relEnd++;
  const o = done({ type }, relEnd);
  if (type === 'code' || type === 'verbatim') return o;
  o.children = parseObjects(b, base + i + 1, base + closeAt, RESTRICTIONS.standard, o);
  o.cbPos = base + i + 1;
  return o;
}

/** @param {string} s @param {number} i @param {Function} done */
function exportSnippet(s, i, done) {
  const m = /^@@[-A-Za-z0-9]+:/.exec(s.slice(i));
  if (!m) return null;
  const close = s.indexOf('@@', i + m[0].length);
  if (close < 0) return null;
  return done({ type: 'export-snippet' }, close + 2);
}

/** @param {string} s @param {number} i @param {Function} done */
function macro(s, i, done) {
  const m = /^\{\{\{([a-zA-Z][-a-zA-Z0-9_]*)(\(([\s\S]*?)\))?\}\}\}/.exec(s.slice(i));
  if (!m) return null;
  const args = m[3] == null ? null : extractMacroArguments(m[3].replace(/[ \t\r\n]+/g, ' ').replace(/^ | $/g, ''));
  let relEnd = i + m[0].length;
  while (s[relEnd] === ' ' || s[relEnd] === '\t') relEnd++;
  return done({ type: 'macro', key: m[1].toLowerCase(), args }, relEnd);
}

/** org-macro-extract-arguments. @param {string} str */
export function extractMacroArguments(str) {
  return str
    .replace(/(\\*),/g, (_, bs) => '\\'.repeat(Math.floor(bs.length / 2)) + (bs.length % 2 === 0 ? '\u0000' : ','))
    .split('\u0000');
}

/** @param {string} s @param {number} i @param {Function} done */
function target(s, i, done) {
  const m = /^<<([^<>\n \t]|[^<>\n \t][^<>\n]*[^<>\n \t])>>/.exec(s.slice(i));
  if (!m) return null;
  let relEnd = i + m[0].length;
  while (s[relEnd] === ' ' || s[relEnd] === '\t') relEnd++;
  return done({ type: 'target', value: m[1] }, relEnd);
}

/** @param {Buffer} b @param {string} s @param {number} i @param {number} base @param {Function} done */
function radioTarget(b, s, i, base, done) {
  const m = /^<<<([^<>\n \t]|[^<>\n \t][^<>\n]*[^<>\n \t])>>>/.exec(s.slice(i));
  if (!m) return null;
  let relEnd = i + m[0].length;
  while (s[relEnd] === ' ' || s[relEnd] === '\t') relEnd++;
  const o = done({ type: 'radio-target', value: m[1] }, relEnd);
  o.children = parseObjects(b, base + i + 3, base + i + 3 + m[1].length, RESTRICTIONS.minimal, o);
  return o;
}

/** @param {Buffer} b @param {string} s @param {number} i @param {number} base @param {Function} done */
function footnoteReference(b, s, i, base, done) {
  const m = /^\[fn:(?:([-_\p{L}\p{N}]+)?(:)|([-_\p{L}\p{N}]+)\])/u.exec(s.slice(i));
  if (!m) return null;
  const closing = scanPair(s, i, '[', ']');
  if (closing < 0) return null;
  const label = m[1] ?? m[3] ?? null;
  const inline = m[2] != null;
  let relEnd = closing;
  while (s[relEnd] === ' ' || s[relEnd] === '\t') relEnd++;
  const o = done({ type: 'footnote-reference', label, ftype: inline ? 'inline' : 'standard' }, relEnd);
  if (inline) {
    o.cbPos = base + i + m[0].length;
    o.children = parseObjects(b, base + i + m[0].length, base + closing - 1, RESTRICTIONS.standard, o);
  }
  return o;
}

const CITATION_KEY_RE = /@([\p{L}\p{N}_\-.:?!`'/*@+|(){}<>&^$#%~]+)/u;

/** org-element-citation-parser, with the prefix, suffix and references that hold plain text. @param {Buffer} b @param {string} s @param {number} i @param {number} base @param {Function} done */
function citation(b, s, i, base, done) {
  const m = /^\[cite(?:\/([/_\-\p{L}\p{N}]+))?:[\t\n ]*/u.exec(s.slice(i));
  if (!m) return null;
  const closing = scanPair(s, i, '[', ']');
  if (closing < 0) return null;
  const start = i + m[0].length;
  const keyAt = CITATION_KEY_RE.exec(s.slice(i, closing - 0));
  if (!keyAt) return null;
  const firstKeyEnd = i + keyAt.index + keyAt[0].length;
  let relEnd = closing;
  while (s[relEnd] === ' ' || s[relEnd] === '\t') relEnd++;
  const o = done({ type: 'citation', prefix: [], suffix: [], children: [] }, relEnd);
  const semi = s.lastIndexOf(';', firstKeyEnd - 1);
  let contentsBegin = start;
  if (semi >= start) {
    if (start < semi) o.prefix = parseObjects(b, base + start, base + semi, RESTRICTIONS.minimal, o);
    contentsBegin = semi + 1;
  }
  let end = closing - 1;
  while (end > 0 && /[ \r\t\n]/.test(s[end - 1])) end--;
  const lastSemi = s.lastIndexOf(';', end - 1);
  let contentsEnd = end;
  if (lastSemi >= firstKeyEnd && !CITATION_KEY_RE.test(s.slice(lastSemi + 1, end))) {
    if (lastSemi + 1 < end) o.suffix = parseObjects(b, base + lastSemi + 1, base + end, RESTRICTIONS.minimal, o);
    contentsEnd = lastSemi + 1;
  }
  o.cbPos = base + contentsBegin;
  // references
  let p = contentsBegin;
  while (p < contentsEnd) {
    const sub = s.slice(p, contentsEnd);
    const k = CITATION_KEY_RE.exec(sub);
    if (!k) break;
    const keyStart = p + k.index;
    const keyEnd = keyStart + k[0].length;
    const sep = s.slice(keyEnd, contentsEnd).indexOf(';');
    const refEnd = sep < 0 ? contentsEnd : keyEnd + sep + 1;
    const suffixEnd = sep < 0 ? refEnd : refEnd - 1;
    /** @type {Loose} */ const ref = { type: 'citation-reference', parent: o, begin: base + p, end: base + refEnd, prefix: [], suffix: [], children: [] };
    if (p < keyStart) ref.prefix = parseObjects(b, base + p, base + keyStart, RESTRICTIONS.minimal, /** @type {Node} */ (ref));
    if (keyEnd < suffixEnd) ref.suffix = parseObjects(b, base + keyEnd, base + suffixEnd, RESTRICTIONS.minimal, /** @type {Node} */ (ref));
    o.children.push(ref);
    p = refEnd;
  }
  if (p < contentsEnd) o.children.push(plain(s.slice(p, contentsEnd), o, base + p));
  return o;
}

/** @param {string} s @param {number} i @param {Function} done */
function inlineSrc(s, i, done) {
  const m = /^src_([^ \t\n[{]+)[{[]/.exec(s.slice(i));
  if (!m || (i > 0 && /[\p{L}\p{N}_]/u.test(s[i - 1]))) return null;
  let p = i + 4 + m[1].length;
  const params = pairedContent(s, p, '[', ']');
  if (params) p = params.end;
  const value = pairedContent(s, p, '{', '}');
  if (!value) return null;
  p = value.end;
  while (s[p] === ' ' || s[p] === '\t') p++;
  return done({ type: 'inline-src-block', language: m[1], parameters: params ? nonBlank(orgTrim(params.text).replace(/\n[ \t]*/g, ' ')) : null }, p);
}

/** @param {string} s @param {number} i @param {Function} done */
function inlineCall(s, i, done) {
  const m = /^call_([^ \t\n[(]+)[([]/.exec(s.slice(i));
  if (!m || (i > 0 && /[\p{L}\p{N}_]/u.test(s[i - 1]))) return null;
  let p = i + 5 + m[1].length;
  const inside = pairedContent(s, p, '[', ']');
  if (inside) p = inside.end;
  const args = pairedContent(s, p, '(', ')');
  if (!args) return null;
  p = args.end;
  const endHeader = pairedContent(s, p, '[', ']');
  if (endHeader) p = endHeader.end;
  while (s[p] === ' ' || s[p] === '\t') p++;
  /** @param {{ text: string } | null} x */
  const hdr = (x) => (x && nonBlank(x.text) ? orgTrim(x.text).replace(/\n[ \t]*/g, ' ') : null);
  return done({ type: 'inline-babel-call', call: m[1], insideHeader: hdr(inside), endHeader: hdr(endHeader), arguments: nonBlank(args.text) }, p);
}

const LINK_BRACKET = BRACKET_LINK_RE;
const LINK_PLAIN = emacsRegexToJs(plainSource(), 'y');
const LINK_ANGLE = emacsRegexToJs(angleSource(), 'y');
const LINK_TYPES = emacsRegexToJs(typesSource(), 'y');
/** The link-type regexps come from Emacs through org-lint-data.js. */
function plainSource() {
  return plainRe;
}
function angleSource() {
  return angleRe;
}
function typesSource() {
  return typesRe;
}
import { linkPlainRe as plainRe, linkAngleRe as angleRe, linkTypesRe as typesRe } from './org-lint-data.js';

/** Link abbreviations, set by the caller before parsing (`#+LINK:`). @type {{ abbrevs: Map<string, string> }} */
export const linkState = { abbrevs: new Map() };

/** org-link-expand-abbrev. @param {string} link */
function expandAbbrev(link) {
  const m = /^([^:]*)(::?(.*))?$/m.exec(link);
  if (!m) return link;
  const rpl = linkState.abbrevs.get(m[1]);
  if (rpl === undefined) return link;
  const tag = m[2] != null ? m[3] : null;
  if (/%\([^)]+\)/.test(rpl)) return link;
  if (rpl.includes('%s')) return rpl.replace('%s', () => tag ?? '');
  if (rpl.includes('%h')) return rpl.replace('%h', () => encodeURIComponent(tag ?? ''));
  return rpl + (tag ?? '');
}

/** @param {string} s */
const linkUnescape = (s) => s.replace(/(\\+)(?=$|[[\]])/g, (_, bs) => '\\'.repeat(Math.floor(bs.length / 2)));

/** @param {Buffer} b @param {string} s @param {number} i @param {number} base @param {Function} done */
function link(b, s, i, base, done) {
  /** @type {string} */ let type;
  /** @type {string} */ let path;
  let fmt;
  let linkEnd;
  let contents = null;
  let rawLink;
  LINK_BRACKET.lastIndex = i;
  const mb = LINK_BRACKET.exec(s);
  if (mb) {
    fmt = 'bracket';
    linkEnd = i + mb[0].length;
    contents = mb[2] != null ? { from: i + mb[0].indexOf(mb[2], mb[1].length + 2), len: mb[2].length } : null;
    rawLink = expandAbbrev(linkUnescape(mb[1].replace(/[ \t]*\n[ \t]*/g, ' ')));
    let t;
    if (rawLink.startsWith('/') || /^\.\.?\//.test(rawLink)) {
      type = 'file';
      path = rawLink;
    } else if (((LINK_TYPES.lastIndex = 0), (t = LINK_TYPES.exec(rawLink)))) {
      type = t[1];
      path = rawLink.slice(t[0].length);
    } else if (/^\(/.test(rawLink) && /\)$/.test(rawLink)) {
      type = 'coderef';
      path = rawLink.slice(1, -1);
    } else if (rawLink[0] === '#') {
      type = 'custom-id';
      path = rawLink.slice(1);
    } else {
      type = 'fuzzy';
      path = rawLink;
    }
  } else {
    LINK_PLAIN.lastIndex = i;
    const mp = LINK_PLAIN.exec(s);
    if (mp) {
      fmt = 'plain';
      type = mp[1];
      linkEnd = i + mp[0].length;
      path = mp[2];
    } else {
      LINK_ANGLE.lastIndex = i;
      const ma = LINK_ANGLE.exec(s);
      if (!ma) return null;
      fmt = 'angle';
      type = ma[1];
      linkEnd = i + ma[0].length;
      path = ma[2].replace(/[ \t]*\n[ \t]*/g, '');
    }
  }
  let application = null;
  let search = null;
  const fm = /^file(?:\+(.+))?$/.exec(type);
  if (fm) {
    application = fm[1] ?? null;
    type = 'file';
    const sm = /::(.*)$/.exec(path);
    if (sm) {
      search = sm[1];
      path = path.slice(0, sm.index);
    }
    path = path.replace(/^\/\/\/*(.:)?\//, '$1/');
  }
  let relEnd = linkEnd;
  while (s[relEnd] === ' ' || s[relEnd] === '\t') relEnd++;
  const o = done({ type: 'link', ltype: type, path, format: fmt, application, search }, relEnd);
  if (contents) {
    o.cbPos = base + contents.from;
    o.children = parseObjects(b, base + contents.from, base + contents.from + contents.len, RESTRICTIONS.link, o);
  }
  return o;
}

// ---------------------------------------------------------------- walking

/**
 * org-element-map: nodes of the given types in document order. Objects (and the secondary strings of headlines and
 * item tags) are entered only when an object type is asked for.
 * @template T
 * @param {Node} tree @param {Set<string>} types @param {(n: Loose) => T} fn @param {{ firstMatch?: boolean, noRecursion?: Set<string>, objects?: boolean }} [opts]
 * @returns {NonNullable<T>[]}
 */
export function mapTree(tree, types, fn, opts = {}) {
  /** @type {NonNullable<T>[]} */ const out = [];
  const objects = opts.objects ?? false;
  /** @param {Loose} n @returns {boolean} true to stop */
  const walk = (n) => {
    if (!n) return false;
    if (n.type !== 'org-data' && types.has(n.type)) {
      const r = fn(n);
      if (r) {
        out.push(r);
        if (opts.firstMatch) return true;
      }
    }
    if (opts.noRecursion && opts.noRecursion.has(n.type)) return false;
    if (objects) for (const sec of [n.title, n.tag, n.prefix, n.suffix]) if (sec) for (const o of sec) if (walk(o)) return true;
    for (const c of n.children || []) {
      if (!objects && isObject(c)) continue;
      if (walk(c)) return true;
    }
    return false;
  };
  walk(tree);
  return out;
}

const OBJECT_TYPES = new Set(['plain-text', 'citation-reference', 'link', 'footnote-reference', 'macro', 'target', 'radio-target', 'citation', 'inline-src-block', 'inline-babel-call', 'export-snippet', 'bold', 'italic', 'underline', 'strike-through', 'code', 'verbatim', 'table-cell']);
/** @param {Loose} n */
export const isObject = (n) => OBJECT_TYPES.has(n.type) && n.type !== 'table-cell';

/** The deepest element containing an offset (org-element-at-point). @param {Node} tree @param {number} pos */
export function elementAt(tree, pos) {
  let cur = tree;
  for (;;) {
    const next = (cur.children || []).find((/** @type {Loose} */ c) => !isObject(c) && c.type !== 'table-cell' && c.begin <= pos && (pos < c.end || (c.end === tree.end && pos <= c.end)));
    if (!next) return cur;
    cur = next;
  }
}
