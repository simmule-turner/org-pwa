// @ts-check
/**
 * ox-odt: Org's OpenDocument Text export, ported function by function from ox-odt.el (Org 9.6).  It builds on the element tree
 * export-ascii.js makes (the same tree org-element makes in Emacs), numbers headlines and footnotes the same way, and writes
 * content.xml, styles.xml, meta.xml and the manifest the way the Emacs back end does, using Org's own OrgOdtStyles.xml and
 * OrgOdtContentTemplate.xml (odt-assets.js).
 *
 * Where it differs from Emacs, on purpose: verse blocks keep their line breaks (Emacs 9.6 joins the lines), width cookies do not
 * widen cells, LaTeX fragments become formula objects through KaTeX (Emacs needs an external converter), and source blocks are
 * colored with this app's highlighter.  See the Differences section of README.org.
 */

import { buildExportTree, objects, isNumbered, lowLevel, resolveLink, ordinalOf, walk, lineage, parentHeadline } from './export-ascii.js';
import { ENTITIES } from './entities.js';
import { tableModel } from './table-model.js';
import { createZip } from './zip-writer.js';
import { ODT_STYLES_XML, ODT_CONTENT_TEMPLATE } from './odt-assets.js';
import { getDocTitle, getDocAuthor, getDocDate } from './export-options.js';
import { parseAttributes } from './org-elements.js';
import { BrokenLinkSignal, brokenLinkText } from './broken-links.js';
import { resolveTodoSequence } from './todo-cycle.js';
import { resolveCodeRef, coderefText } from './code-lines.js';
import { removeIndentation } from './babel-blocks.js';
import { HARD } from './ascii-fill.js';
import { highlightToHtml, knowsLanguage } from './syntax-highlight.js';
import { runInit, listItems, stringValue, symbolName, isNil } from './lisp-read.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./export-ascii.js').Node} Node */
/** @typedef {import('./export-ascii.js').Item} Item */
/** @typedef {import('./export-ascii.js').Info} Info */

// ---- text ---------------------------------------------------------------------------

/** `org-odt--encode-plain-text` without the whitespace filling: &, < and >. @param {string} text */
export const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** An attribute value: also quotes. @param {string} text */
const escapeAttr = (text) => escapeXml(text).replace(/"/g, '&quot;');

/** `org-odt--encode-tabs-and-spaces`. @param {string} line */
const encodeTabsAndSpaces = (line) => line.replace(/\t| {2,}/g, (s) => (s === '\t' ? '<text:tab/>' : ` <text:s text:c="${s.length - 1}"/>`));

/** `org-odt--encode-plain-text`, whitespace filling included. @param {string} text */
const encodePlain = (text) => encodeTabsAndSpaces(escapeXml(text));

/** `org-odt-special-string-regexps`. @param {string} s */
function specialStrings(s) {
  return s
    .replace(/\\-/g, '&#x00ad;')
    .replace(/---([^-])/g, '&#x2014;$1')
    .replace(/--([^-])/g, '&#x2013;$1')
    .replace(/\.\.\./g, '&#x2026;');
}

/**
 * What `fill-region` with an endless fill column does to a run of text: blanks inside are squeezed to one space, but a sentence end
 * (a period, question or exclamation mark, then a line end, a tab or two spaces) keeps two; blanks at the ends stay.
 * @param {string} s
 */
export function unfill(s) {
  if (!/\S/.test(s)) return s;
  const lead = /^[ \t]*/.exec(s)?.[0] || '';
  let rest = s.slice(lead.length);
  const trail = /[ \t]*$/.exec(rest)?.[0] || '';
  rest = rest.slice(0, rest.length - trail.length);
  const pre = /^\n*/.exec(rest)?.[0] || '';
  rest = rest.slice(pre.length);
  const post = /\n*$/.exec(rest)?.[0] || '';
  rest = rest.slice(0, rest.length - post.length);
  if (post) rest = rest.replace(/[ \t]+$/, '');
  rest = rest.replace(/([.?!][\]"')}]*)?([ \t\n]+)/g, (_m, punct, ws) => (punct || '') + (punct && (/[\n\t]/.test(ws) || ws.length >= 2) ? '  ' : ' '));
  return lead + pre + rest + post + trail;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STAMP = /([<[])(\d{4})-(\d{1,2})-(\d{1,2})(?: +[^\s\d>\]+-][^\s>\]]*)?(?: +(\d{1,2}):(\d{2})(?:-(\d{1,2}):(\d{2}))?)?((?: +(?:[.+]\+?|-{1,2})\d+[hdwmy](?:\/\d+[hdwmy])?)*) *([>\]])/y;
const COOKIE = /\[(?:\d*%|\d*\/\d*)\]/y;
const ENTITY = /\\(there4|sup[123]|frac[13][24]|[A-Za-z]+)(\{\}|(?![A-Za-z]))/y;
const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');

/**
 * One timestamp (or a range written `A--B`) as `org-timestamp-translate` reads it, ready for XML: the date with its day name, a time
 * range as two timestamps, the repeater without its habit part.
 * @param {RegExpExecArray} m @param {RegExpExecArray | null} end
 */
function translateStamp(m, end) {
  const [, open, y, mo, d, h1, m1, h2, m2, marks, close] = m;
  if ((open === '<') !== (close === '>')) return m[0];
  const date = (/** @type {string} */ yy, /** @type {string} */ mm, /** @type {string} */ dd) => {
    const t = new Date(Date.UTC(Number(yy), Number(mm) - 1, Number(dd)));
    return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())} ${DAYS[t.getUTCDay()]}`;
  };
  const tail = marks.replace(/\/\d+[hdwmy]/g, '');
  const stamp = (/** @type {string} */ day, /** @type {string | undefined} */ hh, /** @type {string | undefined} */ mm2) => `${open}${day}${hh === undefined ? '' : ` ${pad2(Number(hh))}:${mm2}`}${tail}${close}`;
  const first = date(y, mo, d);
  if (end) return `${stamp(first, h1, m1)}--${stamp(date(end[2], end[3], end[4]), end[5] === undefined ? h1 : end[5], end[5] === undefined ? m1 : end[6])}`;
  return h2 === undefined ? stamp(first, h1, m1) : `${stamp(first, h1, m1)}--${stamp(first, h2, m2)}`;
}

/** @param {string} text a timestamp as the span writes it @param {boolean} active */
const stampSpan = (text, active) => `<text:span text:style-name="${active ? 'OrgActiveTimestamp' : 'OrgInactiveTimestamp'}">${text}</text:span>`;

/**
 * `org-odt-plain-text` for a run of text from the tree: entities as UTF-8, timestamps and statistics cookies as the spans Org uses,
 * `\-`, dashes and the ellipsis as special strings, line breaks, and the unfilling of the paragraph's lines.
 * @param {string} text @param {Info} I
 */
function plainText(text, I) {
  /** @type {string[]} */
  const out = [];
  let buffer = '';
  const flush = () => {
    if (buffer) out.push(plainRun(buffer, I));
    buffer = '';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && I.entities) {
      ENTITY.lastIndex = i;
      const m = ENTITY.exec(text);
      const entry = m && /** @type {Record<string, string[]>} */ (ENTITIES)[m[1]];
      if (m && entry) {
        flush();
        out.push(escapeXml(entry[I.cs.column]));
        i += m[0].length;
        continue;
      }
    }
    if (ch === '[') {
      COOKIE.lastIndex = i;
      const m = COOKIE.exec(text);
      if (m) {
        flush();
        out.push(`<text:span text:style-name="OrgCode">${escapeXml(m[0])}</text:span>`);
        i += m[0].length;
        continue;
      }
    }
    if (ch === '<' || ch === '[') {
      STAMP.lastIndex = i;
      const m = STAMP.exec(text);
      if (m) {
        let end = null;
        let stop = i + m[0].length;
        if (text.startsWith('--', stop)) {
          STAMP.lastIndex = stop + 2;
          const e = STAMP.exec(text);
          if (e && e[1] === m[1]) {
            end = e;
            stop += 2 + e[0].length;
          }
        }
        const blanks = /^[ \t]*/.exec(text.slice(stop))?.[0] || '';
        flush();
        out.push(stampSpan(specialStrings(escapeXml(translateStamp(m, end))) + blanks, m[1] === '<'));
        i = stop;
        continue;
      }
    }
    buffer += ch;
    i++;
  }
  flush();
  return out.join('');
}

/** @param {string} text @param {Info} I */
function plainRun(text, I) {
  let s = escapeXml(text);
  if (I.specialStrings) s = specialStrings(s);
  if (I.verse) return s.split(HARD).join('<text:line-break/>');
  if (I.preserveBreaks) return s.split(new RegExp(`${HARD}\\n?`)).map((piece) => piece.replace(/[ \t]*\n/g, '<text:line-break/>')).join('<text:line-break/>');
  return s
    .split(new RegExp(`${HARD}\\n?`))
    .map(unfill)
    .join('<text:line-break/>');
}

// ---- the conversion context -----------------------------------------------------------

/**
 * @typedef {{
 *   I: Info,
 *   root: Node,
 *   refs: Map<Node, string>,
 *   nextRef: number,
 *   counters: Record<string, number>,
 *   tableStyles: { name: string, relWidth: string }[],
 *   tableStyleSpecs: Map<string, [string, Record<string, boolean>]>,
 *   seenNotes: Set<number>,
 *   inNote: number,
 *   prev: WeakMap<object, Item | null>,
 *   toc: boolean,
 *   done: Set<string>,
 *   files: { name: string, content: string | Uint8Array }[],
 *   manifest: { type: string, path: string, version?: string }[],
 *   images: number,
 *   formulas: number,
 *   pictures: Map<string, string> | null,
 *   formula: ((tex: string, display: boolean) => string | null) | null,
 *   highlight: boolean,
 *   faces: Set<string>,
 *   highlighted: boolean,
 *   userFullName: string,
 *   equations: number,
 * }} Ctx
 */

/** `org-export-get-reference`: a stable name for a node in this export. @param {Node} n @param {Ctx} C */
function ref(n, C) {
  let r = C.refs.get(n);
  if (!r) {
    r = 'org' + (0x1000000 + C.nextRef++).toString(16).padStart(7, '0');
    C.refs.set(n, r);
  }
  return r;
}

/** `org-odt-add-automatic-style`: the next name for an object type. @param {Ctx} C @param {string} type */
function nextName(C, type) {
  C.counters[type] = (C.counters[type] || 0) + 1;
  return `${type}${C.counters[type]}`;
}

/** `org-odt--target`. @param {string} text @param {string | null} id */
const target = (text, id) => (id ? `\n<text:bookmark-start text:name="OrgXref.${id}"/>\n<text:bookmark text:name="${id}"/>${text}\n<text:bookmark-end text:name="OrgXref.${id}"/>` : text);

/** `org-odt--frame`. */
function frame(/** @type {Ctx} */ C, /** @type {string} */ text, /** @type {number | null} */ width, /** @type {number | null} */ height, /** @type {string} */ style, extra = '', anchor = 'paragraph', title = '', desc = '') {
  const attrs = `${width ? ` svg:width="${width.toFixed(2)}cm"` : ''}${height ? ` svg:height="${height.toFixed(2)}cm"` : ''}${extra} text:anchor-type="${anchor}" draw:name="${nextName(C, 'Frame')}"`;
  return `\n<draw:frame draw:style-name="${style}"${attrs}>\n${text}${title ? `<svg:title>${escapeXml(title)}</svg:title>` : ''}${desc ? `<svg:desc>${escapeXml(desc)}</svg:desc>` : ''}\n</draw:frame>`;
}

/** `org-odt--textbox`. */
function textbox(/** @type {Ctx} */ C, /** @type {string} */ text, /** @type {number | null} */ width, /** @type {number | null} */ height, /** @type {string} */ style, extra = '', anchor = 'paragraph') {
  const box = `\n<draw:text-box ${` fo:min-height="${(height || 0.2).toFixed(2)}cm"${width ? '' : ` fo:min-width="${(width || 0.2).toFixed(2)}cm"`}`}>${text}\n</draw:text-box>`;
  return frame(C, box, width, null, style, extra, anchor);
}

// ---- the tree, walked ---------------------------------------------------------------------

/**
 * `org-export-data`.
 * @param {Item} item @param {Ctx} C
 * @returns {string}
 */
function data(item, C) {
  if (typeof item === 'string') return item;
  const transcode = TRANSCODERS[item.type];
  if (!transcode) return '';
  /** @type {string} */
  let contents;
  if (item.type === 'link') contents = (item.desc || []).map((c) => data(c, C)).join('');
  else contents = exportList(item.contents, C);
  /** @type {string | null | undefined} */
  let out;
  try {
    out = transcode(item, contents, C);
  } catch (err) {
    if (!(err instanceof BrokenLinkSignal)) throw err;
    if (C.I.broken === 'nil') throw err;
    out = C.I.broken === 'mark' ? escapeXml(brokenLinkText('mark', err.path)) : null;
  }
  return out === null || out === undefined ? '' : out;
}

/** @param {Item[]} items @param {Ctx} C */
function exportList(items, C) {
  let out = '';
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (typeof it !== 'string') C.prev.set(it, i ? items[i - 1] : null);
    out += data(it, C);
  }
  return out;
}

/** The siblings before `n`, nearest last (`org-export-get-previous-element` with all siblings). @param {Node} n */
function siblingsBefore(n) {
  const list = n.parent ? n.parent.contents : [];
  const at = list.indexOf(n);
  return at < 0 ? [] : list.slice(0, at);
}

/** `org-export-get-parent-element`: the paragraph (or other element) around an object. @param {Node} n */
function parentElement(n) {
  return n.parent;
}

/** @param {Node} n */
const attr = (n) => parseAttributes(n.attrs?.odt || []);

// ---- labels ---------------------------------------------------------------------------------

const CATEGORY_MAP = /** @type {const} */ ({
  __Table__: ['Table', 'value', 'Table'],
  __Figure__: ['Illustration', 'value', 'Figure'],
  __MathFormula__: ['Text', 'math-formula', 'Equation'],
  __DvipngImage__: ['Equation', 'value', 'Equation'],
  __Listing__: ['Listing', 'value', 'Listing'],
});
const LABEL_STYLES = {
  'math-formula': ['%c', 'text', '(%n)'],
  'math-label': ['(%n)', 'text', '(%n)'],
  'category-and-value': ['%e %n: %c', 'category-and-value', '%e %n'],
  value: ['%e %n: %c', 'value', '%n'],
};
const IMAGE_RE = /\.(jpeg|jpg|png|gif|svg)$/i;

/** @param {Node} link */
const isImageLink = (link) => link.type === 'link' && link.linkType === 'file' && IMAGE_RE.test(linkPath(link));

/** The path of a link without its `type:` prefix and search option. @param {Node} n */
function linkPath(n) {
  const type = n.linkType || '';
  let path = n.raw || n.path || '';
  if (type === 'fuzzy' || type === 'custom-id' || type === 'id' || type === 'radio' || type === 'coderef') return n.path || '';
  if (path.toLowerCase().startsWith(type + ':')) path = path.slice(type.length + 1);
  return path.replace(/::.*$/, '');
}

/**
 * `org-odt--standalone-link-p`: a paragraph holding nothing but one qualifying link (and blanks).
 * @param {Node} element a paragraph or a link
 * @param {(p: Node) => boolean} [paragraphOk] @param {(l: Node) => boolean} [linkOk]
 */
function standaloneLink(element, paragraphOk, linkOk) {
  const p = element.type === 'paragraph' ? element : element.type === 'link' && (!linkOk || linkOk(element)) ? element.parent : null;
  if (!p || p.type !== 'paragraph') return false;
  if (paragraphOk && !paragraphOk(p)) return false;
  let links = 0;
  for (const x of p.contents) {
    if (typeof x === 'string') {
      if (/\S/.test(x)) return false;
    } else if (x.type === 'link') {
      if (linkOk && !linkOk(x)) return false;
      if (++links !== 1) return false;
    } else return false;
  }
  return true;
}

/** @param {Node} p */
const hasCaptionOrName = (p) => !!(p.caption || p.nameKey);
/** @param {Node} el */
const enumerableImage = (el) => standaloneLink(el, hasCaptionOrName, isImageLink);
/** @param {Node} el */
const enumerableFormula = (el) => standaloneLink(el, hasCaptionOrName, (l) => l.type === 'link' && l.linkType === 'file' && /\.(mathml|mml|odf)$/i.test(linkPath(l)));
/** @param {Node} el */
const enumerable = (el) => hasCaptionOrName(el);

/** The sequence number of `el` as `org-odt--enumerate` gives it: "S.n" within a numbered section of level <= 2, else "n". @param {Node} el @param {Ctx} C @param {(e: Node) => boolean} pred */
function enumerate(el, C, pred) {
  const scope = lineage(el).find((x) => x.type === 'headline' && /** @type {number} */ (x.level) <= 2 && isNumbered(x, C.I)) || C.root;
  let counter = 0;
  let found = 0;
  walk(scope, (n) => {
    if (found) return true;
    if (n.type === el.type && pred(n)) {
      counter++;
      if (n === el) found = counter;
    }
    return false;
  });
  const prefix = scope.type === 'headline' && scope.number ? scope.number.join('.') + '.' : '';
  return prefix + found;
}

/**
 * `org-odt-format-label`: the caption of a table, listing or figure with its sequence number (op `definition`, returns { caption }),
 * or a cross-reference to it (op `reference`, returns a string); null when there is neither a caption nor a name.
 * @param {Node} el a link, table, src-block or paragraph @param {Ctx} C @param {'definition' | 'reference'} op
 * @returns {{ caption: string } | string | null}
 */
function formatLabel(el, C, op) {
  const holder = el.type === 'link' ? parentElement(el) || el : el;
  const hasName = !!(el.nameKey || holder.nameKey);
  const caption = holder.caption ? data(mkSecondary(holder.caption), C) : null;
  if (!hasName && caption === null) return null;
  const label = ref(holder, C);
  /** @type {keyof typeof CATEGORY_MAP} */
  let key;
  /** @type {(e: Node) => boolean} */
  let pred;
  if (el.type === 'table') [key, pred] = ['__Table__', enumerable];
  else if (el.type === 'src-block') [key, pred] = ['__Listing__', enumerable];
  else if (enumerableImage(el)) [key, pred] = ['__Figure__', enumerableImage];
  else if (enumerableFormula(el)) [key, pred] = ['__MathFormula__', enumerableFormula];
  else return null;
  const [counter, style, category] = CATEGORY_MAP[key];
  const seq = enumerate(el, C, pred);
  const spec = LABEL_STYLES[/** @type {keyof typeof LABEL_STYLES} */ (style)];
  if (op === 'definition') {
    const n = `<text:sequence text:ref-name="${label}" text:name="${counter}" text:formula="ooow:${counter}+1" style:num-format="1">${seq}</text:sequence>`;
    return { caption: `\n<text:bookmark text:name="${label}"/>` + spec[0].replace('%e', category).replace('%n', n).replace('%c', caption || '') };
  }
  return `<text:sequence-ref text:reference-format="${spec[1]}" text:ref-name="${label}">${spec[2].replace('%e', category).replace('%n', seq)}</text:sequence-ref>`;
}

/** A pseudo node holding a secondary string, so `data` can export it. @param {Item[]} items @returns {Node} */
function mkSecondary(items) {
  return { type: 'secondary-string', parent: null, contents: items, postBlank: 0 };
}

// ---- objects -----------------------------------------------------------------------------------

const span = (/** @type {string} */ style, /** @type {string} */ text) => `<text:span text:style-name="${style}">${text}</text:span>`;

/**
 * The number of a footnote reference, and whether this is the first reference to it.
 * @param {Node} n @param {Ctx} C
 */
function footnoteReference(n, C) {
  const number = n.fnNumber || 0;
  const noteRef = (/** @type {number} */ k) => span('OrgSuperscript', `<text:note-ref text:note-class="footnote" text:reference-format="text" text:ref-name="fn${k}">${k}</text:note-ref>`);
  const before = C.prev.get(n);
  const separator = before && typeof before !== 'string' && before.type === 'footnote-reference' ? span('OrgSuperscript', ',') : '';
  if (C.seenNotes.has(number)) return separator + noteRef(number);
  C.seenNotes.add(number);
  const entry = C.I.fnList[number - 1];
  let body = '';
  C.inNote++;
  try {
    if (entry && entry.def && entry.def.contents.length) {
      body = exportList(entry.def.contents, C).trim();
      const first = entry.def.contents[0];
      if (typeof first === 'string') body = `\n<text:p text:style-name="Footnote">${body}</text:p>`;
    } else if (entry && entry.inline) {
      body = `\n<text:p text:style-name="Footnote">${exportList(entry.inline, C).trim()}</text:p>`;
    }
  } finally {
    C.inNote--;
  }
  return separator + `<text:note text:id="fn${number}" text:note-class="footnote"><text:note-citation>${number}</text:note-citation><text:note-body>${body}</text:note-body></text:note>`;
}

/** `org-odt-link`. @param {Node} n @param {string} descText @param {Ctx} C */
function linkXml(n, descText, C) {
  const type = n.linkType || '';
  const desc = descText === '' ? null : descText;
  const rawPath = linkPath(n);
  let path;
  if (['http', 'https', 'ftp', 'mailto'].includes(type)) path = `${type}:${rawPath}`;
  else if (type === 'doi') path = `https://doi.org/${rawPath}`;
  else if (type === 'file') path = rawPath.startsWith('//') ? `file:${rawPath}` : rawPath.startsWith('/') ? `file://${rawPath}` : `../${rawPath}`;
  else path = rawPath;
  // Emacs gives a doi link no markup in ODT: the resolved URL is printed as plain text, whatever the description
  if (type === 'doi') return escapeXml(path);
  path = path.replace(/&/g, '&amp;');
  const anchor = (/** @type {string} */ href, /** @type {string} */ text) => `<text:a xlink:type="simple" xlink:href="${href}">${text}</text:a>`;
  if (!desc && type === 'file' && IMAGE_RE.test(rawPath) && C.pictures) {
    const image = inlineImage(n, C);
    if (image !== null) return image;
  }
  if (!desc && type === 'file' && /\.(mathml|mml|odf)$/i.test(rawPath)) return '';
  if (type === 'radio') {
    const dest = C.I.targets.get((n.path || '').trim().replace(/\s+/g, ' ').toLowerCase());
    return dest ? `<text:bookmark-ref text:reference-format="text" text:ref-name="OrgXref.${ref(dest, C)}">${desc || ''}</text:bookmark-ref>` : desc || '';
  }
  if (type === 'custom-id' || type === 'fuzzy' || type === 'id') {
    const dest = resolveLink(n, C.I);
    if (!dest) throw new BrokenLinkSignal(type === 'fuzzy' ? n.raw || '' : n.path || '');
    if (dest.type === 'headline') {
      if (!desc) return inferDescription(dest, C);
      const label = (type === 'custom-id' && dest.properties?.CUSTOM_ID) || ref(dest, C);
      return anchor(`#${label}`, desc);
    }
    if (dest.type === 'target' || dest.type === 'radio-target') {
      const number = ordinalFor(dest, C);
      return anchor(`#${ref(dest, C)}`, desc || (number === null ? escapeXml(dest.name || '') : Array.isArray(number) ? `(${number.join(' ')})` : String(number)));
    }
    const reference = formatLabel(dest, C, 'reference');
    if (typeof reference !== 'string') return inferDescription(dest, C);
    return desc ? anchor(`#${ref(dest, C)}`, desc) : reference;
  }
  if (type === 'coderef') {
    const found = resolveCodeRef(C.I.codeBlocks, n.path || '');
    if (found === null) throw new BrokenLinkSignal(n.path || '');
    const inner = `<text:bookmark-ref text:reference-format="number" text:ref-name="OrgXref.coderef-${n.path}">${escapeXml(found)}</text:bookmark-ref>`;
    return coderefText(n.path || '', inner, desc);
  }
  if (path && desc) {
    return anchor(path, desc);
  }
  if (path) return anchor(path, path);
  return span('Emphasis', desc || '');
}

/**
 * `org-export-get-ordinal` for a target: the number of the closest table, item or headline holding it (a list of numbers for an
 * item or a headline), or the footnote number.
 * @param {Node} dest @param {Ctx} C
 * @returns {number | number[] | null}
 */
function ordinalFor(dest, C) {
  const holder = lineage(dest).find((e) => ['footnote-definition', 'footnote-reference', 'headline', 'item', 'table'].includes(e.type));
  if (!holder) return null;
  if (holder.type === 'item') {
    /** @type {number[]} */
    const numbers = [];
    for (let e = /** @type {Node | null} */ (holder); e; e = e.parent) {
      if (e.type === 'item') numbers.unshift(siblingsBefore(e).filter((x) => typeof x !== 'string' && x.type === 'item').length + 1);
    }
    return numbers;
  }
  return ordinalOf(dest, C.I);
}

/** `org-odt-link--infer-description`: a cross-reference to a headline or target that names it as well as Org can. @param {Node} dest @param {Ctx} C */
function inferDescription(dest, C) {
  const label = ref(dest, C);
  const chain = lineage(dest);
  // the numbers of the enclosing ordered list items, when every level is numbered
  const top = [...chain].reverse().findIndex((x) => x.type === 'plain-list');
  if (top >= 0) {
    const rev = [...chain].reverse().slice(top);
    /** @type {(number | null)[]} */
    const numbers = [];
    for (let k = 0; k + 1 < rev.length; k += 2) {
      const list = rev[k];
      const item = rev[k + 1];
      if (list.type !== 'plain-list' || item.type !== 'item') break;
      numbers.push(list.listType === 'ordered' ? siblingsBefore(item).length + 1 : null);
    }
    if (numbers.length && !numbers.includes(null)) return `<text:bookmark-ref text:reference-format="number-all-superior" text:ref-name="${label}">${numbers.map((x) => `${x}.`).join('')}</text:bookmark-ref>`;
  }
  if (dest.type === 'headline' && isNumbered(dest, C.I)) {
    const headline = chain.find((x) => x.type === 'headline' && !lowLevel(x, C.I) && isNumbered(x, C.I));
    if (headline) return `<text:bookmark-ref text:reference-format="chapter" text:ref-name="OrgXref.${label}">${(headline.number || []).join('.')}</text:bookmark-ref>`;
  }
  const headline = chain.find((x) => x.type === 'headline' && !lowLevel(x, C.I));
  if (headline) return `<text:bookmark-ref text:reference-format="text" text:ref-name="OrgXref.${label}">${(headline.title || []).map((t) => data(t, C)).join('')}</text:bookmark-ref>`;
  // Emacs stops here too ("FIXME: Unable to resolve ..."), after printing the whole element; this names it instead
  throw new Error(`FIXME: Unable to resolve the ${dest.type}${dest.nameKey ? ` named "${dest.nameKey}"` : ''}: give the link a description or put it under a heading`);
}

/** A data URL's bytes and media type, or null. @param {string} url */
function decodeDataUrl(url) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  if (m[2]) {
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { type: m[1], bytes };
  }
  return { type: m[1], bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
}

/** The pixel size of a PNG, GIF, JPEG or SVG picture, or null. @param {Uint8Array} b @param {string} type */
export function imagePixels(b, type) {
  const be32 = (/** @type {number} */ i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: be32(16), h: be32(20) };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return null;
  }
  if (type.includes('svg')) {
    const text = new TextDecoder().decode(b.slice(0, 2000));
    const tag = /<svg\b[^>]*>/.exec(text)?.[0] || '';
    const num = (/** @type {string} */ k) => {
      const m = new RegExp(`\\b${k}="([\\d.]+)(?:px)?"`).exec(tag);
      return m ? Number(m[1]) : null;
    };
    const w = num('width');
    const h = num('height');
    if (w && h) return { w, h };
    const vb = /viewBox="[\d.\s-]*?([\d.]+)[\s,]+([\d.]+)"/.exec(tag);
    if (vb) return { w: Number(vb[1]), h: Number(vb[2]) };
  }
  return null;
}

/** `org-odt--image-size`: centimeters, from the pixels at 96 dpi or the user's width and height, fitted to the page. @param {{ w: number, h: number } | null} px @param {Record<string, string>} a */
function imageSize(px, a) {
  const cm = (/** @type {number} */ n) => (n / 96) * 2.54;
  const num = (/** @type {string | undefined} */ v) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  const scale = num(a.scale);
  let w = px ? cm(px.w) : 5;
  let h = px ? cm(px.h) : 5;
  const uw = scale === null ? num(a.width) : null;
  const uh = scale === null ? num(a.length ?? a.height) : null;
  if (scale !== null) [w, h] = [w * scale, h * scale];
  else if (uw !== null && uh !== null) [w, h] = [uw, uh];
  else if (uh !== null) [w, h] = [(uh * w) / h, uh];
  else if (uw !== null) [w, h] = [uw, (uw * h) / w];
  if (w > 17 || h > 20) {
    const k = Math.min(17 / w, 20 / h);
    [w, h] = [w * k, h * k];
  }
  return { w, h };
}

/** `org-odt-link--inline-image`: the picture is embedded when the caller could read it, else null. @param {Node} n @param {Ctx} C */
function inlineImage(n, C) {
  const url = C.pictures ? C.pictures.get(n.raw || '') : undefined;
  const decoded = url ? decodeDataUrl(url) : null;
  if (!decoded) return null;
  const ext = ((/\.([A-Za-z0-9]+)$/.exec(linkPath(n)) || [])[1] || 'png').toLowerCase();
  C.images++;
  const name = `Images/${String(C.images).padStart(4, '0')}.${ext}`;
  if (C.images === 1) C.manifest.push({ type: '', path: 'Images/' });
  C.manifest.push({ type: `image/${ext}`, path: name });
  C.files.push({ name, content: decoded.bytes });
  const standalone = standaloneLink(n) && !!n.parent && n.parent.contents.includes(n);
  const holder = parentElement(n) || n;
  const user = attr(holder);
  const size = imageSize(imagePixels(decoded.bytes, decoded.type || `image/${ext}`), user);
  const href = `\n<draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>`;
  const label = formatLabel(n, C, 'definition');
  const caption = label && typeof label !== 'string' ? label.caption : null;
  const anchor = ['as-char', 'paragraph', 'page'].find((a) => a === (user.anchor || '').toLowerCase()) || null;
  const style = anchor ? user.style : '';
  const extra = anchor ? user.attributes || '' : '';
  if (!caption) {
    const [inner, innerAnchor] = standalone ? ['OrgDisplayImage', 'paragraph'] : ['OrgInlineImage', 'as-char'];
    return frame(C, href, size.w, size.h, style || inner, extra, anchor || innerAnchor);
  }
  const picture = frame(C, href, size.w, size.h, 'OrgCaptionedImage', ' style:rel-width="100%" style:rel-height="scale"', 'paragraph');
  const outerStyle = standalone ? 'OrgImageCaptionFrame' : 'OrgInlineImage';
  return textbox(C, `\n<text:p text:style-name="Illustration">${picture}${caption}</text:p>`, size.w, size.h, style || outerStyle, extra, anchor || (standalone ? 'paragraph' : 'as-char'));
}

/** MathML for a LaTeX fragment through KaTeX, or null when KaTeX is not loaded or rejects it. @param {string} tex @param {boolean} display */
function katexMathMl(tex, display) {
  const k = /** @type {any} */ (globalThis).katex;
  if (!k) return null;
  try {
    const html = k.renderToString(tex, { output: 'mathml', displayMode: display, throwOnError: true, strict: 'ignore' });
    const math = /<math[\s\S]*<\/math>/.exec(html)?.[0] || null;
    // LibreOffice Math shows a bare slash identifier as an error glyph
    return math ? math.replace(/<mi mathvariant="normal">\/<\/mi>/g, '<mo>/</mo>') : null;
  } catch {
    return null;
  }
}

/** The LaTeX inside its delimiters, and whether it is display math. @param {string} raw */
function stripDelimiters(raw) {
  const t = raw.trim();
  let m = /^\$\$([\s\S]*)\$\$$/.exec(t);
  if (m) return { tex: m[1], display: true };
  m = /^\\\[([\s\S]*)\\\]$/.exec(t);
  if (m) return { tex: m[1], display: true };
  m = /^\\\(([\s\S]*)\\\)$/.exec(t);
  if (m) return { tex: m[1], display: false };
  m = /^\$([\s\S]*)\$$/.exec(t);
  if (m) return { tex: m[1], display: false };
  return { tex: t, display: /^\\begin\{/.test(t) };
}

/** An embedded formula object in a frame (`org-odt-link--inline-formula`), or null when the fragment cannot be converted. @param {string} raw @param {Ctx} C @param {'inline' | 'display'} mode */
function formulaFrame(raw, C, mode) {
  const { tex } = stripDelimiters(raw);
  const mathml = (C.formula || katexMathMl)(tex, mode === 'display');
  if (!mathml) return null;
  C.formulas++;
  const dir = `Formula-${String(C.formulas).padStart(4, '0')}/`;
  C.manifest.push({ type: 'application/vnd.oasis.opendocument.formula', path: dir, version: '1.2' });
  C.manifest.push({ type: 'text/xml', path: `${dir}content.xml` });
  C.files.push({ name: `${dir}content.xml`, content: `${XML_HEAD}${mathml}` });
  const object = `\n<draw:object  xlink:show="embed" xlink:actuate="onLoad" xlink:href="${dir}" xlink:type="simple"/>`;
  return frame(C, object, null, null, mode === 'inline' ? 'OrgInlineFormula' : 'OrgCaptionedFormula', '', mode === 'inline' ? 'as-char' : 'paragraph', 'Latex-fragment', raw);
}

/** A display equation's number: `org-odt-format-label` with the `math-label` style. @param {Ctx} C */
function equationLabel(C) {
  C.equations++;
  return `<text:sequence text:ref-name="${'eq' + C.equations}" text:name="Text" text:formula="ooow:Text+1" style:num-format="1">${C.equations}</text:sequence>`.replace(/^/, '(').replace(/$/, ')');
}

/** Source code colored with this app's lexer, one list of XML pieces per line, or null for a language it does not know. @param {string[]} lines @param {string} language @param {Ctx} C */
function highlightLines(lines, language, C) {
  if (!C.highlight || !knowsLanguage(language)) return null;
  C.highlighted = true;
  return highlightToHtml(lines.join('\n'), language)
    .split('\n')
    .map((/** @type {string} */ html) => {
      let out = '';
      const re = /<span class="org-([a-z-]+)">([\s\S]*?)<\/span>|([^<]+)/g;
      for (const m of html.matchAll(re)) {
        const decode = (/** @type {string} */ t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        if (m[3] !== undefined) out += encodePlain(decode(m[3]));
        else {
          const face = 'OrgSrcFontLock' + m[1].split("-").map((/** @type {string} */ w) => w[0].toUpperCase() + w.slice(1)).join('') + 'Face';
          C.faces.add(m[1]);
          out += span(face, encodePlain(decode(m[2])));
        }
      }
      return out;
    });
}

/** Colors Emacs's default theme gives the faces the lexer names. */
const FACE_COLORS = /** @type {Record<string, string>} */ ({
  keyword: '#a020f0',
  string: '#8b2252',
  comment: '#b22222',
  constant: '#5f9ea0',
  builtin: '#483d8b',
  type: '#228b22',
  'function-name': '#0000ff',
  'variable-name': '#b8860b',
  preprocessor: '#483d8b',
});

// ---- elements --------------------------------------------------------------------------------------

/** `org-odt--paragraph-style`. @param {Node} p */
function paragraphKind(p) {
  for (let up = p.parent; up; up = up.parent) {
    if (up.type === 'center-block') return 'centered';
    if (up.type === 'quote-block') return 'quoted';
    if (up.type === 'section') return null;
  }
  return null;
}

/** `org-odt--checkbox`. @param {Node} item */
const checkbox = (item) => (item.checkbox ? span('OrgCode', item.checkbox === 'on' || item.checkbox === 'X' ? '[&#x2713;] ' : item.checkbox === 'trans' || item.checkbox === '-' ? '[-] ' : '[ ] ') : '');

/** `org-odt--format-paragraph`. @param {Node} p @param {string} contents @param {string} dflt @param {string} center @param {string} quote */
function formatParagraph(p, contents, dflt, center, quote) {
  const kind = paragraphKind(p);
  const style = kind === 'quoted' ? quote : kind === 'centered' ? center : dflt;
  const parent = p.parent;
  const lead = parent && parent.type === 'item' && siblingsBefore(p).length === 0 ? checkbox(parent) : '';
  return `\n<text:p text:style-name="${style}">${lead}${contents}</text:p>`;
}

/** The text of a node's affiliated attribute `:key`. @param {Node} n @param {string} key */
const attrOf = (n, key) => attr(n)[key];

/** `org-odt-do-format-code`. @param {string[]} lines @param {Ctx} C @param {{ refs?: Map<number, string>, retain?: boolean, start?: number | null, tokens?: string[] | null, total?: number }} [o] */
function formatCode(lines, C, o = {}) {
  const refs = o.refs || new Map();
  const total = o.total || lines.length;
  let out = '';
  // Emacs keeps adding to one style name, so a line after the last one counted keeps the LastLine style
  let style = o.tokens ? 'OrgSrcBlock' : 'OrgFixedWidthBlock';
  lines.forEach((line, k) => {
    if (k + 1 === total) style += 'LastLine';
    const label = refs.get(k + 1);
    let loc = o.tokens && o.tokens[k] ? o.tokens[k] : encodePlain(line + (label !== undefined && o.retain ? ` (${label})` : ''));
    if (o.tokens && label !== undefined && o.retain) loc += encodePlain(` (${label})`);
    if (label !== undefined) loc = target(loc, `coderef-${label}`);
    const p = `\n<text:p text:style-name="${style}">${loc}</text:p>`;
    out += o.start === null || o.start === undefined ? p : `\n<text:list-item>${p}\n</text:list-item>`;
  });
  if (o.start === null || o.start === undefined) return out;
  return `\n<text:list text:style-name="OrgSrcBlockNumberedLine" text:continue-numbering="${o.start === 0 ? 'false' : 'true'}">${out}</text:list>`;
}

/** @param {Node} n @param {Ctx} C */
function codeBlock(n, C) {
  const code = n.code;
  if (!code) return '';
  const language = n.type === 'src-block' ? (/^\s*(\S+)/.exec(n.params || '') || [])[1] || '' : '';
  const tokens = language ? highlightLines(code.lines, language, C) : null;
  return formatCode(code.lines, C, { refs: code.refs, retain: code.switches.retainLabels, start: code.start, tokens });
}

/** `org-odt-item` and the table-in-list bookkeeping use this: does the item hold a table anywhere? @param {Node} n */
function hasTable(n) {
  let found = false;
  walk(n, (x) => {
    if (x.type === 'table') found = true;
    return found;
  });
  return found;
}

const LIST_STYLE = { ordered: 'OrgNumberedList', unordered: 'OrgBulletedList', 'descriptive-1': 'OrgDescriptionList', 'descriptive-2': 'OrgDescriptionList', descriptive: 'OrgDescriptionList' };

/** `org-odt-headline` wrapper text: `org-odt-format-headline-default-function`. @param {Node} h @param {Ctx} C @param {boolean} toc */
function headlineText(h, C, toc) {
  const I = C.I;
  const saved = C.toc;
  C.toc = toc;
  try {
    const title = (h.title || []).map((t) => data(t, C)).join('');
    const todo = I.withTodo && h.todo ? span(C.done.has(h.todo) ? 'OrgDone' : 'OrgTodo', escapeXml(h.todo)) + ' ' : '';
    const priority = I.withPriority && h.priority ? span(`OrgPriority-${h.priority}`, `[#${h.priority}]`) + ' ' : '';
    const tags = I.withTags && h.tags && h.tags.length ? tagsXml(h.tags, toc) : '';
    return { todo, priority, title, tags };
  } finally {
    C.toc = saved;
  }
}

/** @param {string[]} tags @param {boolean} toc */
const tagsXml = (tags, toc) => (toc ? ' ' : '<text:tab/>') + span('OrgTags', `[${tags.map((t) => span('OrgTag', escapeXml(t))).join(' : ')}]`);

/** @param {Node} h */
const planningOf = (h) => h.heading?.planning || null;

/** The planning paragraph of a headline (shown only with `p:t`). @param {Node} h @param {Ctx} C */
function planningXml(h, C) {
  const plan = planningOf(h);
  if (!plan || !C.I.withPlanning) return '';
  const order = plan.order || [];
  const part = (/** @type {string | null} */ raw, /** @type {string} */ style, /** @type {string} */ word, /** @type {string} */ key) => {
    if (!raw) return '';
    // a timestamp keeps the blank that follows it on the planning line
    const at = order.indexOf(key);
    return span(style, word) + plainText(raw.trim() + (at >= 0 && at < order.length - 1 ? ' ' : ''), C.I);
  };
  const body = part(plan.closed, 'OrgClosedKeyword', 'CLOSED:', 'closed') + part(plan.deadline, 'OrgDeadlineKeyword', 'DEADLINE:', 'deadline') + part(plan.scheduled, 'OrgScheduledKeyword', 'SCHEDULED:', 'scheduled');
  return body ? `\n<text:p text:style-name="OrgPlanning">${body}</text:p>` : '';
}

/** The headlines a table of contents lists. @param {Ctx} C @param {number} depth @param {Node | null} scope */
function tocHeadlines(C, depth, scope) {
  const base = scope && scope.type === 'headline' ? /** @type {number} */ (scope.level) : 0;
  return C.I.headlines.filter((h) => {
    const level = /** @type {number} */ (h.level);
    if (scope) {
      if (!lineage(h).includes(scope) || h === scope) return false;
      return level <= base + depth;
    }
    return level <= depth && !(h.properties && /notoc/.test(h.properties.UNNUMBERED || ''));
  });
}

/** `org-odt-toc`. @param {number} depth @param {Ctx} C @param {Node | null} [scope] */
function tocXml(depth, C, scope = null) {
  const headlines = tocHeadlines(C, Math.min(depth, 1000), scope && scope.type === 'headline' ? scope : null);
  if (!headlines.length) return '';
  const entries = headlines
    .map((h) => {
      const t = headlineText(h, C, true);
      const number = isNumbered(h, C.I) && h.number ? `${h.number.join('.')}. ` : '';
      return `\n<text:p text:style-name="Contents_20_${h.level}"><text:a xlink:type="simple" xlink:href="#${ref(h, C)}">${number}${t.todo}${t.priority}${t.title}${t.tags}</text:a></text:p>`;
    })
    .join('\n');
  const title = scope ? null : 'Table of Contents';
  const templates = Array.from({ length: 10 }, (_, k) => k + 1)
    .map(
      (level) => `
      <text:table-of-content-entry-template text:outline-level="${level}" text:style-name="Contents_20_${level}">
       <text:index-entry-link-start text:style-name="Internet_20_link"/>
       <text:index-entry-chapter/>
       <text:index-entry-text/>
       <text:index-entry-link-end/>
      </text:table-of-content-entry-template>\n`,
    )
    .join('');
  return (
    '\n<text:table-of-content text:style-name="OrgIndexSection" text:protected="true" text:name="Table of Contents">\n' +
    `  <text:table-of-content-source text:outline-level="${depth}">` +
    (title ? `\n    <text:index-title-template text:style-name="Contents_20_Heading">${title}</text:index-title-template>\n` : '') +
    templates +
    '\n  </text:table-of-content-source>\n  <text:index-body>' +
    (title ? `\n    <text:index-title text:style-name="Sect1" text:name="Table of Contents1_Head">\n      <text:p text:style-name="Contents_20_Heading">${title}</text:p>\n    </text:index-title>\n` : '') +
    entries +
    '\n  </text:index-body>\n</text:table-of-content>'
  );
}

/** First sibling among headlines (`org-export-first-sibling-p`). @param {Node} h */
const firstSibling = (h) => {
  const before = siblingsBefore(h);
  const last = before[before.length - 1];
  return !last || typeof last === 'string' || last.type !== 'headline';
};
/** @param {Node} h */
const lastSibling = (h) => {
  const list = h.parent ? h.parent.contents : [];
  const next = list[list.indexOf(h) + 1];
  return !next || typeof next === 'string' || next.type !== 'headline';
};

// ---- tables -------------------------------------------------------------------------------------------

/** `org-odt-table-styles` as Org ships it: a table style, the template it comes from and the cell selectors it turns on. */
const DEFAULT_TABLE_STYLES = `(setq org-odt-table-styles
  '(("OrgEquation" "OrgEquation" ((use-first-column-styles . t) (use-last-column-styles . t)))
    ("TableWithHeaderRowAndColumn" "Custom" ((use-first-row-styles . t) (use-first-column-styles . t)))
    ("TableWithFirstRowandLastRow" "Custom" ((use-first-row-styles . t) (use-last-row-styles . t)))
    ("GriddedTable" "Custom" nil)))`;

/**
 * The table styles `:style` can name: Org's own, with what a Lisp init text sets `org-odt-table-styles` to on top (`assoc` takes the first
 * entry of a name, so one added in front wins).
 * @param {string | undefined} init
 * @returns {Map<string, [string, Record<string, boolean>]>}
 */
export function tableStyleSpecs(init) {
  const defaults = runInit(DEFAULT_TABLE_STYLES);
  const vars = init && init.trim() ? runInit(init, defaults) : defaults;
  /** @type {Map<string, [string, Record<string, boolean>]>} */
  const out = new Map();
  for (const entry of listItems(vars.get('org-odt-table-styles')) || []) {
    const items = listItems(entry);
    const name = items && stringValue(items[0]);
    const template = items && stringValue(items[1]);
    if (!name || template === null || template === undefined || out.has(name)) continue;
    /** @type {Record<string, boolean>} */ const selectors = {};
    for (const pair of listItems(items && items[2]) || []) {
      const key = pair.k === 'list' ? symbolName(pair.items[0]) : null;
      if (key && pair.k === 'list') selectors[key] = !isNil(pair.tail || pair.items[1]);
    }
    out.set(name, [template, selectors]);
  }
  return out;
}

/** `org-odt-table` / `org-odt--table`. @param {Node} table @param {Ctx} C */
function tableXml(table, C) {
  const I = C.I;
  const rows = /** @type {Node[]} */ (table.contents.filter((r) => typeof r !== 'string' && r.type === 'table-row'));
  const m = tableModel(rows.map((r) => ({ rule: r.rowType === 'rule', cells: (r.cells || []).map((c) => c.raw || '') })));
  const attrs = attr(table);
  /** @type {[string, Record<string, boolean>] | null} */
  const styleSpec = attrs.style ? C.tableStyleSpecs.get(attrs.style) || null : null;
  // Emacs looks the style up from the table's parent table, which a table does not have: only cells get the template
  const custom = null;
  // a table made from a list gets the style attribute but, in Emacs, its cells do not see it
  const template = styleSpec && table.kind !== 'list-table' ? styleSpec[0] : null;
  const labelOut = formatLabel(table, C, 'definition');
  const caption = labelOut && typeof labelOut !== 'string' ? labelOut.caption : null;
  const objectName = nextName(C, 'Table');
  /** @type {string} */
  let tableStyle = custom || 'OrgTable';
  if (Object.keys(attrs).length && !custom) {
    tableStyle = `Org${objectName}`;
    C.tableStyles.push({ name: tableStyle, relWidth: String(attrs['rel-width'] || '96') });
  }
  const headerCols = (() => {
    const v = attrs['header-columns'];
    if (v === undefined) return -1;
    if (/^\d+$/.test(v)) return Number(v) - 1;
    return v ? 0 : -1;
  })();
  // borders of a data row (org-export-table-cell-borders, top/above/bottom/below)
  /** @param {number} i */
  const rowBorders = (i) => {
    let top = false;
    let above = false;
    let rule = false;
    let exit = false;
    for (let k = i - 1; k >= 0 && !exit; k--) {
      if (m.rows[k].rule) rule = true;
      else if (!m.specials[k]) {
        if (rule) above = true;
        exit = true;
      }
    }
    if (!exit) {
      if (rule) above = true;
      top = true;
    }
    let bottom = false;
    let below = false;
    rule = false;
    exit = false;
    for (let k = i + 1; k < m.rows.length && !exit; k++) {
      if (m.rows[k].rule) rule = true;
      else if (!m.specials[k]) {
        if (rule) below = true;
        exit = true;
      }
    }
    if (!exit) {
      if (rule) below = true;
      bottom = true;
    }
    return { start: top || above, end: bottom || below };
  };
  const firstRow = m.firstIndex >= 0 ? rows[m.firstIndex] : null;
  const columns = firstRow ? (firstRow.cells || []).slice(m.offset) : [];
  const colStyle = `${custom || 'OrgTable'}Column`;
  let out = '';
  if (caption) out += `\n<text:p text:style-name="Table">${caption}</text:p>`;
  out += `\n<table:table table:style-name="${tableStyle}">`;
  // `org-export-table-cell-width`: the first width cookie (<N>, <lN>, <rN>, <cN>) in a special row, found per column
  /** @param {number} raw */
  const cellWidth = (raw) => {
    for (let k = 0; k < rows.length; k++) {
      if (!m.specials[k] || m.rows[k].rule) continue;
      const found = /^<[lrc]?(\d+)>$/.exec(m.rows[k].cells[raw] ?? '');
      if (found) return Number(found[1]);
    }
    return 0;
  };
  out += columns.map((_, c) => `\n<table:table-column table:style-name="${colStyle}"/>`.repeat(cellWidth(c + m.offset) + 1)).join('\n');
  out += '\n';
  let r = -1;
  rows.forEach((row, i) => {
    if (m.rows[i].rule || m.specials[i]) return;
    r++;
    const inHeader = m.hasHeader && m.groupOf[i] === 1;
    const { start, end } = rowBorders(i);
    const tags = inHeader ? ['\n<table:table-header-rows>', '\n</table:table-header-rows>'] : ['\n<table:table-rows>', '\n</table:table-rows>'];
    const cells = (row.cells || []).slice(m.offset);
    const cellXml = cells
      .map((cell, c) => {
        const raw = c + m.offset;
        let paragraph;
        let cellStyle;
        if (template) {
          const sel = styleSpec ? styleSpec[1] : {};
          const dims = { rows: rows.filter((_, k) => !m.rows[k].rule && !m.specials[k]).length, cols: columns.length };
          const type = sel['use-first-column-styles'] && c === 0 ? 'FirstColumn' : sel['use-last-column-styles'] && c + 1 === dims.cols ? 'LastColumn' : sel['use-first-row-styles'] && r === 0 ? 'FirstRow' : sel['use-last-row-styles'] && r + 1 === dims.rows ? 'LastRow' : sel['use-banding-rows-styles'] ? (r % 2 === 1 ? 'EvenRow' : 'OddRow') : sel['use-banding-columns-styles'] ? (c % 2 === 1 ? 'EvenColumn' : 'OddColumn') : '';
          paragraph = `${template}${type}TableParagraph`;
          cellStyle = `${template}${type}TableCell`;
        } else {
          const heading = inHeader || c <= headerCols;
          paragraph = (heading ? 'OrgTableHeading' : 'OrgTableContents') + m.alignment(raw).replace(/^./, (x) => x.toUpperCase());
          const startsCol = c === 0 || m.leftBorder(raw);
          cellStyle = 'OrgTblCell' + (start || r === 0 ? 'T' : '') + (end ? 'B' : '') + (startsCol && c !== 0 ? 'L' : '');
        }
        const first = cell.contents[0];
        const elementContents = first !== undefined && typeof first !== 'string' && ['paragraph', 'plain-list', 'table', 'src-block', 'example-block', 'quote-block', 'center-block', 'special-block', 'fixed-width', 'verse-block', 'horizontal-rule', 'export-block', 'drawer', 'latex-environment', 'keyword'].includes(first.type);
        const body = exportList(cell.contents, C);
        const span = cellWidth(raw);
        return `\n<table:table-cell table:style-name="${cellStyle}"${span > 0 ? ` table:number-columns-spanned="${span + 1}"` : ''}>\n${elementContents ? body : `\n<text:p text:style-name="${paragraph}">${body}</text:p>`}\n</table:table-cell>${'\n<table:covered-table-cell/>'.repeat(span)}\n`;
      })
      .join('');
    out += (start ? tags[0] : '') + `\n<table:table-row>\n${cellXml}\n</table:table-row>` + (end ? tags[1] : '');
  });
  out += '</table:table>';
  void I;
  return out;
}

/** The first headline among the children of `parent`, which Emacs's list-continuation code stands in for the headline list. @param {Node | null} parent */
const firstHeadlineChild = (parent) => /** @type {Node | undefined} */ (parent ? parent.contents.find((x) => typeof x !== 'string' && x.type === 'headline') : undefined);

/**
 * The lists, list items and listified (low-level) headlines a table sits in, as the closing and opening tags `org-odt-table` needs
 * to continue them after the table (OpenDocument does not allow a table inside a list item).
 * @param {Node} tbl @param {Info} I
 */
function tableListTags(tbl, I) {
  const chain = lineage(tbl).slice(1);
  /** @type {{ close: string, open: string }[]} */
  const tags = [];
  /** @type {Node | null} */
  let parentList = null;
  const precededByTable = (/** @type {Node} */ el) => siblingsBefore(el).some((s) => typeof s !== 'string' && s.type === 'table');
  const listOpen = (/** @type {string} */ style) => `\n<text:list text:style-name="${style}" text:continue-numbering="true">`;
  if (chain[0] && chain[0].type === 'item') {
    for (const el of chain) {
      if (el.type === 'plain-list') {
        parentList = el;
        tags.push({ close: '</text:list>', open: listOpen(LIST_STYLE[/** @type {keyof typeof LIST_STYLE} */ (el.listType || 'unordered')]) });
      } else if (el.type === 'item') {
        if (!parentList) tags.push(precededByTable(tbl) ? { close: '</text:list-header>', open: '<text:list-header>' } : { close: '</text:list-item>', open: '<text:list-header>' });
        else if (precededByTable(parentList)) tags.push({ close: '</text:list-header>', open: '<text:list-header>' });
        else tags.push({ close: '</text:list-item>', open: '<text:list-item>' });
      }
    }
  }
  // low-level headlines are lists too: a headline stands for an item, the first headline beside it for the list
  /** @type {Node[]} */
  const llh = [];
  for (const el of chain) if (el.type === 'headline' && lowLevel(el, I)) llh.push(el, /** @type {Node} */ (firstHeadlineChild(el.parent) || el));
  let step = 'item';
  for (const el of llh) {
    if (step === 'plain-list') {
      step = 'item';
      parentList = el;
      tags.push({ close: '</text:list>', open: listOpen(isNumbered(el, I) ? 'OrgNumberedList' : 'OrgBulletedList') });
    } else {
      step = 'plain-list';
      if (!parentList) tags.push(precededByTable(tbl) ? { close: '</text:list-header>', open: '<text:list-header>' } : { close: '</text:list-item>', open: '<text:list-header>' });
      else {
        const before = siblingsBefore(parentList);
        const section = before[before.length - 1];
        if (section && typeof section !== 'string' && section.type === 'section' && section.contents.some((x) => typeof x !== 'string' && x.type === 'table')) tags.push({ close: '</text:list-header>', open: '<text:list-header>' });
        else tags.push({ close: '</text:list-item>', open: '<text:list-item>' });
      }
    }
  }
  return tags;
}

/** `org-odt-format-section`. @param {Ctx} C @param {string} text @param {string} style */
const section = (C, text, style) => `\n<text:section text:style-name="${style}" text:name="${nextName(C, 'Section')}">\n${text}\n</text:section>`;

// ---- transcoders ----------------------------------------------------------------------------------------------

/** @type {Record<string, (n: Node, contents: string, C: Ctx) => string | null | undefined>} */
const TRANSCODERS = {
  bold: (_n, c) => span('Bold', c),
  italic: (_n, c) => span('Emphasis', c),
  underline: (_n, c) => span('Underline', c),
  strikethrough: (_n, c) => span('Strikethrough', c),
  verbatim: (n) => span('OrgCode', encodePlain(n.value || '')),
  'latex-fragment': (n, _c, C) => {
    const raw = n.value || '';
    const display = stripDelimiters(raw).display;
    const f = formulaFrame(raw, C, display ? 'display' : 'inline');
    if (!f) return span('OrgCode', escapeXml(raw));
    return display ? `${f}${'<text:tab/>'}${equationLabel(C)}` : f;
  },
  subscript: (_n, c) => span('OrgSubscript', c),
  superscript: (_n, c) => span('OrgSuperscript', c),
  'radio-target': (n, c, C) => target(c, ref(n, C)),
  target: (n, _c, C) => target('', ref(n, C)),
  'footnote-reference': (n, _c, C) => (C.toc || C.I.noFootnotes ? '' : footnoteReference(n, C)),
  citation: () => '',
  link: (n, c, C) => (C.toc ? c || escapeXml(linkPath(n)) : linkXml(n, c, C)),
  paragraph: (n, c, C) => {
    const style = C.inNote ? ['Footnote', 'OrgFootnoteCenter', 'OrgFootnoteQuotations'] : [attrOf(n, 'style') || n.kind || 'Text_20_body', 'OrgCenter', 'Quotations'];
    return formatParagraph(n, c, style[0], style[1], style[2]);
  },
  'plain-list': (n, c) => {
    const parent = n.parent;
    return `\n<text:list text:style-name="${LIST_STYLE[/** @type {keyof typeof LIST_STYLE} */ (n.listType || 'unordered')]}" text:continue-numbering="${parent && parent.type === 'item' ? 'true' : 'false'}">\n${c}</text:list>`;
  },
  item: (n, c) => `\n<text:list-item${n.counter !== null && n.counter !== undefined ? ` text:start-value="${n.counter}"` : ''}>\n${c}\n${hasTable(n) ? '</text:list-header>' : '</text:list-item>'}`,
  table: (n, _c, C) => {
    if (!C.I.tables) return null;
    const tags = tableListTags(n, C.I);
    const level = tags.length;
    const body = tableXml(n, C);
    return '\n' + tags.map((t) => t.close).join('\n') + section(C, body, `OrgIndentedSection-Level-${Math.floor(level / 2)}`) + tags.reverse().map((t) => t.open).join('\n');
  },
  'src-block': (n, _c, C) => {
    const label = formatLabel(n, C, 'definition');
    const caption = label && typeof label !== 'string' ? label.caption : null;
    const code = codeBlock(n, C);
    return (caption ? `\n<text:p text:style-name="Listing">${caption}</text:p>` : '') + (attrOf(n, 'textbox') ? `\n<text:p text:style-name="Text_20_body">${textbox(C, code, null, null, '')}</text:p>` : code);
  },
  'example-block': (n, _c, C) => codeBlock(n, C),
  'fixed-width': (n, _c, C) => (C.I.fixedWidth ? formatCode(removeIndentation(n.lines || []), C) : null),
  'latex-environment': (n, _c, C) => {
    if (!C.I.tex) return null;
    const raw = (n.lines || []).join('\n');
    const f = formulaFrame(raw, C, 'display');
    if (f) return `\n<text:p text:style-name="OrgFormula">${f}<text:tab/>${equationLabel(C)}</text:p>`;
    return formatCode([...removeIndentation(n.lines || []), ''], C, { total: (n.lines || []).length });
  },
  'quote-block': (_n, c) => c,
  'center-block': (_n, c) => c,
  'verse-block': (_n, c) => `\n<text:p text:style-name="OrgVerse">${c.replace(/\n$/, '').replace(/^[ \t]+/gm, encodeTabsAndSpaces).replace(/[ \t]*$/gm, '<text:line-break/>')}\n</text:p>`,
  'special-block': (n, c, C) => {
    const type = n.name || '';
    const a = attr(n);
    if (n.name === 'annotation') {
      const author = a.author || (C.I.withAuthor ? getDocAuthor(C.I.doc) : '');
      return `\n<text:p><office:annotation>\n${author ? `<dc:creator>${escapeXml(author)}</dc:creator>` : ''}${a.date ? `<dc:date>${escapeXml(a.date)}</dc:date>` : ''}${c}\n</office:annotation></text:p>`;
    }
    if (type === 'textbox') return `\n<text:p text:style-name="Text_20_body">${textbox(C, c, a.width ? Number(a.width) : null, a.height ? Number(a.height) : null, a.style || '', a.extra || '', a.anchor || 'paragraph')}</text:p>`;
    return c;
  },
  'export-block': (n) => (n.name === 'ODT' ? removeIndentation(n.lines || []).join('\n') + '\n' : null),
  'horizontal-rule': () => '\n<text:p text:style-name="Horizontal_20_Line"></text:p>',
  drawer: (n, c, C) => {
    const d = C.I.drawers;
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
  keyword: (n, _c, C) => {
    const value = n.value || '';
    if (n.key === 'ODT') return value;
    if (n.key === 'TOC' && /\bheadlines\b/i.test(value)) {
      const depth = /\b\d+\b/.exec(value);
      const local = /\blocal\b/i.test(value);
      return tocXml(depth ? Number(depth[0]) : C.I.headlineLevels, C, local ? parentHeadline(n) || null : null);
    }
    return null;
  },
  section: (_n, c) => c,
  headline: (h, c, C) => {
    const I = C.I;
    const rank = lowLevel(h, I);
    const level = /** @type {number} */ (h.level);
    const numbered = isNumbered(h, I);
    const id = ref(h, C);
    const t = headlineText(h, C, false);
    const full = t.todo + t.priority + t.title + t.tags;
    const customId = h.properties?.ID ? target('', `ID-${h.properties.ID}`) : '';
    const anchored = target(full, id);
    const plan = planningXml(h, C);
    if (rank) {
      const numberedList = numbered;
      const parent = parentHeadline(h);
      const hasTableInSection = (() => {
        const sec = h.contents.find((x) => typeof x !== 'string' && x.type === 'section');
        return !!sec && typeof sec !== 'string' && sec.contents.some((x) => typeof x !== 'string' && x.type === 'table');
      })();
      return (
        (firstSibling(h) ? `\n<text:list text:style-name="${numberedList ? 'OrgNumberedList' : 'OrgBulletedList'}" text:continue-numbering="${parent && lowLevel(parent, I) ? 'true' : 'false'}">` : '') +
        `\n<text:list-item>\n\n<text:p text:style-name="Text_20_body">${customId}${anchored}</text:p>${plan}${c}\n${hasTableInSection ? '</text:list-header>' : '</text:list-item>'}` +
        (lastSibling(h) ? '</text:list>' : '')
      );
    }
    return `\n<text:h text:style-name="Heading_20_${level}${numbered ? '' : '_unnumbered'}" text:outline-level="${level}" text:is-list-header="${numbered ? 'false' : 'true'}">${customId}${anchored}</text:h>${plan}${c}`;
  },
  inlinetask: (n, c, C) => {
    const I = C.I;
    const title = (n.title || []).map((t) => data(t, C)).join('');
    const todo = I.withTodo && n.todo ? span(C.done.has(n.todo) ? 'OrgDone' : 'OrgTodo', escapeXml(n.todo)) + ' ' : '';
    const priority = I.withPriority && n.priority ? span(`OrgPriority-${n.priority}`, `[#${n.priority}]`) + ' ' : '';
    const tags = I.withTags && n.tags && n.tags.length ? tagsXml(n.tags, false) : '';
    const heading = `\n<text:p text:style-name="OrgInlineTaskHeading">${todo}${priority}${title}${tags}</text:p>`;
    return `\n<text:p text:style-name="Text_20_body">${textbox(C, heading + c, null, null, 'OrgInlineTaskFrame', ' style:rel-width="100%"')}</text:p>`;
  },
  'org-data': (_n, c) => c,
  'secondary-string': (_n, c) => c,
  'footnote-definition': () => null,
};

// ---- rewriting the tree the way ox-odt's filters do ---------------------------------------------------------------

/**
 * `org-odt--translate-description-lists` and `org-odt--translate-list-tables`: OpenDocument has no description lists, so each term
 * becomes a bold paragraph above a nested list holding the description; a list marked `:list-table` becomes a table.
 * @param {Node} root @param {Info} I
 */
function translateLists(root, I) {
  /** @param {Node} node */
  const visit = (node) => {
    node.contents = node.contents.map((c) => {
      if (typeof c === 'string') return c;
      visit(c);
      if (c.type === 'plain-list' && attr(c)['list-table']) return listToTable(c, I);
      if (c.type === 'plain-list' && c.listType === 'descriptive') {
        c.listType = 'descriptive-1';
        c.contents = c.contents.map((it) => {
          if (typeof it === 'string') return it;
          const term = { type: 'paragraph', parent: it, contents: it.tag && it.tag.length ? it.tag : ['(no term)'], postBlank: 0, kind: 'Text_20_body_20_bold' };
          const inner = { type: 'plain-list', parent: it, listType: 'descriptive-2', contents: /** @type {Item[]} */ ([]), postBlank: 0 };
          const body = { type: 'item', parent: inner, contents: it.contents, postBlank: 0, checkbox: null, counter: null };
          for (const x of it.contents) if (typeof x !== 'string') x.parent = body;
          inner.contents.push(body);
          it.contents = [term, inner];
          it.tag = null;
          return it;
        });
      }
      return c;
    });
  };
  visit(root);
}

/** @param {Node} list @param {Info} I @returns {Node} */
function listToTable(list, I) {
  void I;
  /** @type {Node} */
  const table = { type: 'table', parent: list.parent, contents: [], postBlank: list.postBlank, nameKey: list.nameKey, caption: list.caption, attrs: { odt: [':style "GriddedTable"'] }, kind: 'list-table' };
  for (const it of list.contents) {
    if (typeof it === 'string') continue;
    const at = it.contents.findIndex((x) => typeof x !== 'string' && x.type === 'plain-list');
    const lead = at < 0 ? it.contents : it.contents.slice(0, at);
    const inner = at < 0 ? null : it.contents[at];
    /** @type {Node & { cells: Node[] }} */
    const row = { type: 'table-row', parent: table, contents: [], postBlank: 0, rowType: 'standard', cells: [] };
    const cell = (/** @type {Item[]} */ items) => {
      /** @type {Node} */
      const node = { type: 'table-cell', parent: row, contents: items, postBlank: 0, raw: '' };
      for (const x of items) if (typeof x !== 'string') x.parent = node;
      row.cells.push(node);
      row.contents.push(node);
    };
    cell(lead);
    if (inner && typeof inner !== 'string') for (const sub of inner.contents) if (typeof sub !== 'string') cell(sub.contents);
    row.cells.forEach((cl) => (cl.raw = 'x'));
    table.contents.push(row);
  }
  return /** @type {Node} */ (table);
}

// ---- the document ----------------------------------------------------------------------------------------------------------

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** Org's styles.xml, with outline numbering kept only up to the `num:` level. @param {Info} I */
function stylesXml(/** @type {any} */ I, /** @type {Ctx} */ C) {
  const numbering = I.numbering;
  const faces = [...C.faces].sort().map((f) => `<style:style style:name="OrgSrcFontLock${f.split("-").map((/** @type {string} */ w) => w[0].toUpperCase() + w.slice(1)).join('')}Face" style:family="text">\n <style:text-properties fo:color="${FACE_COLORS[f] || '#000000'}"/>\n</style:style>`).join('\n');
  const extra = C.faces.size || C.highlighted ? `\n<!-- Org Htmlfontify Styles -->\n<style:style style:name="OrgSrcBlock" style:family="paragraph" style:parent-style-name="Preformatted_20_Text">\n <style:paragraph-properties fo:background-color="#f5f5f5" fo:padding="0.049cm" fo:border="0.51pt solid #000000" style:shadow="none">\n  <style:background-image/>\n </style:paragraph-properties>\n <style:text-properties fo:color="#000000"/>\n</style:style>\n${faces}\n` : '';
  return ODT_STYLES_XML.replace('</office:styles>', () => extra + '</office:styles>').replace(/<text:outline-level-style([^>]*)text:level="([^"]*)"([^>]*)>/g, (whole, a, level) => {
    const keep = typeof numbering === 'number' ? Number(level) <= numbering : numbering;
    return keep ? whole : `<text:outline-level-style${a}text:level="${level}" style:num-format="">`;
  });
}

/** @param {string} text */
const iso = (text) => {
  const m = /(\d{4})-(\d{1,2})-(\d{1,2})(?: +[^\s\d>\]+-][^\s>\]]*)?(?: +(\d{1,2}):(\d{2}))?/.exec(text);
  return m ? `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}${m[4] === undefined ? '' : `T${pad2(Number(m[4]))}:${m[5]}:00`}` : '';
};

/** `org-odt-template` for meta.xml. @param {Ctx} C @param {{ title: string, subtitle: string, author: string }} t */
function metaXml(C, t) {
  const I = C.I;
  const doc = I.doc;
  const kw = (/** @type {string} */ key) => {
    const found = (doc.keywords || []).filter((k) => k.key.toUpperCase() === key).map((k) => k.value.trim());
    return found.join(' ');
  };
  const dateRaw = getDocDate(doc) || '';
  const date = I.withDate && /^[<[][^<>[\]]*[>\]]$/.test(dateRaw.trim()) ? iso(dateRaw) : '';
  return (
    XML_HEAD +
    `<office:document-meta
         xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
         xmlns:xlink="http://www.w3.org/1999/xlink"
         xmlns:dc="http://purl.org/dc/elements/1.1/"
         xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"
         xmlns:ooo="http://openoffice.org/2004/office"
         office:version="1.2">
       <office:meta>
<dc:creator>${t.author}</dc:creator>
<meta:initial-creator>${t.author}</meta:initial-creator>
${date ? `<dc:date>${date}</dc:date>\n<meta:creation-date>${date}</meta:creation-date>\n` : ''}<meta:generator>org-pwa</meta:generator>
<meta:keyword>${escapeXml(kw('KEYWORDS'))}</meta:keyword>
<dc:subject>${escapeXml(kw('DESCRIPTION'))}</dc:subject>
<dc:title>${t.title}</dc:title>
${t.subtitle.trim() ? `<meta:user-defined meta:name="subtitle">${t.subtitle}</meta:user-defined>\n` : ''}
  </office:meta>
</office:document-meta>`
  );
}

/** The manifest, as `org-odt-write-manifest-file` writes it. @param {Ctx} C */
function manifestXml(C) {
  const entry = (/** @type {{ type: string, path: string, version?: string }} */ e) => `\n<manifest:file-entry manifest:media-type="${e.type}" manifest:full-path="${e.path}"${e.version ? ` manifest:version="${e.version}"` : ''}/>`;
  const all = [{ type: 'application/vnd.oasis.opendocument.text', path: '/', version: '1.2' }, { type: 'text/xml', path: 'content.xml' }, { type: 'text/xml', path: 'meta.xml' }, { type: 'text/xml', path: 'styles.xml' }, ...C.manifest];
  return `${XML_HEAD}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">${all.map(entry).join('')}\n</manifest:manifest>`;
}

/** The title block: `org-odt-template`'s preamble. @param {Ctx} C @param {{ title: string, subtitle: string, author: string, email: string }} t */
function preamble(C, t) {
  const I = C.I;
  const doc = I.doc;
  const title = I.withTitle ? t.title : '';
  let out = '';
  if (title.trim()) {
    out += `\n<text:p text:style-name="OrgTitle">\n<text:title>${title}</text:title></text:p>\n\n<text:p text:style-name="OrgTitle"/>\n`;
    if (t.subtitle.trim()) out += `<text:p text:style-name="OrgSubtitle">\n<text:user-defined style:data-style-name="N0" text:name="subtitle">\n${t.subtitle}</text:user-defined>\n\n</text:p>\n<text:p text:style-name="OrgSubtitle"/>\n`;
  }
  const author = I.withAuthor ? t.author || '' : '';
  const email = I.withEmail ? t.email : '';
  if (author && !email) out += `\n<text:p text:style-name="OrgSubtitle"><text:initial-creator>${author}</text:initial-creator></text:p>\n<text:p text:style-name="OrgSubtitle"/>`;
  else if (author && email) out += `\n<text:p text:style-name="OrgSubtitle"><text:a xlink:type="simple" xlink:href="mailto:${escapeAttr(email)}"><text:initial-creator>${author}</text:initial-creator></text:a></text:p>\n<text:p text:style-name="OrgSubtitle"/>`;
  if (I.withDate) {
    const dateRaw = getDocDate(doc);
    if (dateRaw) out += `\n<text:p text:style-name="OrgSubtitle">${data(mkSecondary(objects(dateRaw, null, I)), C)}</text:p><text:p text:style-name="OrgSubtitle"/>`;
  }
  return out;
}

/**
 * Exports `doc` (or, with `scope`, one headline and what is under it) as an OpenDocument Text file: the bytes of the .odt.
 * @param {Doc} doc
 * @param {Heading | null} [scope]
 * @param {{ sup?: string, brokenLinks?: import('./broken-links.js').BrokenLinks, images?: Map<string, string>, formula?: Ctx['formula'], highlight?: boolean, userFullName?: string, init?: string }} [options]
 */
export function exportToOdtPort(doc, scope = null, options = {}) {
  const { I, root } = buildExportTree(doc, scope, { sup: options.sup, brokenLinks: options.brokenLinks, odt: { plain: plainText, snippet: 'odt' } });
  const exported = I.doc;
  /** @type {Ctx} */
  const C = {
    I,
    root,
    refs: new Map(),
    nextRef: 0,
    counters: {},
    tableStyles: [],
    tableStyleSpecs: tableStyleSpecs(options.init),
    seenNotes: new Set(),
    inNote: 0,
    prev: new WeakMap(),
    toc: false,
    done: new Set(resolveTodoSequence(exported).doneKeywords),
    files: [],
    manifest: [],
    images: 0,
    formulas: 0,
    pictures: options.images || null,
    formula: options.formula || null,
    highlight: options.highlight !== false,
    faces: new Set(),
    highlighted: false,
    userFullName: options.userFullName || '',
    equations: 0,
  };
  translateLists(root, I);
  const body = data(root, C);
  const kw = (/** @type {string} */ key) => {
    const found = (exported.keywords || []).find((k) => k.key.toUpperCase() === key);
    return found ? found.value.trim() : '';
  };
  const text = (/** @type {string} */ raw) => (raw ? data(mkSecondary(objects(raw, null, I)), C) : '');
  const info = {
    title: text(I.scope ? I.scope.title : getDocTitle(exported) || ''),
    subtitle: I.scope ? '' : text(kw('SUBTITLE')),
    author: text(getDocAuthor(exported) || C.userFullName),
    email: text(kw('EMAIL')),
  };
  // content.xml from Org's template
  let content = ODT_CONTENT_TEMPLATE;
  const marker = '  </office:automatic-styles>';
  const styles = C.tableStyles.map((s) => `\n<style:style style:name="${s.name}" style:family="table">\n  <style:table-properties style:rel-width="${s.relWidth}%" fo:margin-top="0cm" fo:margin-bottom="0.20cm" table:align="center"/>\n</style:style>\n`).join('');
  content = content.replace(marker, () => styles + marker);
  const decls = ['Table', 'Illustration', 'Text', 'Equation', 'Listing'].map((n) => `<text:sequence-decl text:display-outline-level="2" text:name="${n}"/>`).join('\n');
  content = content.replace(/<text:sequence-decls[\s\S]*?<\/text:sequence-decls>/, () => `\n<text:sequence-decls>\n${decls}\n</text:sequence-decls>`);
  const toc = I.toc ? tocXml(typeof I.toc === 'number' ? I.toc : I.headlineLevels, C) : '';
  content = content.replace('</office:text>', () => `${preamble(C, info)}${toc}${body}</office:text>`);
  const zip = createZip([
    { name: 'mimetype', content: 'application/vnd.oasis.opendocument.text' },
    ...C.files,
    { name: 'META-INF/manifest.xml', content: manifestXml(C) },
    { name: 'content.xml', content },
    { name: 'styles.xml', content: stylesXml(I, C) },
    { name: 'meta.xml', content: metaXml(C, info) },
  ]);
  return { zip, content };
}

/** For tests: the content.xml an export produces. @param {Doc} doc @param {Heading | null} [scope] @param {Parameters<typeof exportToOdtPort>[2]} [options] */
export function odtContentXml(doc, scope = null, options = {}) {
  return exportToOdtPort(doc, scope, options).content;
}
