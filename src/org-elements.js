// @ts-check
/**
 * A parser for what an exporter needs to see, closer to Org's own element model than the editing parser in
 * body-parser.js: list items own their continuation paragraphs, sub-lists and blocks; affiliated keywords
 * (`#+CAPTION:`, `#+NAME:`, `#+ATTR_HTML:`) are attached to the element after them; drawers, fixed-width lines,
 * LaTeX environments, footnote definitions and export lines are elements of their own.
 *
 * parseElements(lines) -> element[]. Every element has `type`, and `aff` (affiliated keywords, or null):
 *   paragraph        { lines }
 *   list             { listType: 'unordered'|'ordered'|'descriptive', items: [{ bullet, checkbox, counter, tag, children }] }
 *   table            { rows: [{ rule: true } | { cells: [string] }] }
 *   block            { name (lower case), params, lines }   -- example, src, export, quote, verse, center, comment, special ...
 *   drawer           { name, lines }
 *   fixed            { lines }
 *   hr
 *   latex-env        { lines }
 *   footnote-def     { label, children }
 *   html-line        { value }     (`#+HTML:`)
 *   latex-line       { value }     (`#+LATEX:`)
 *   toc              { value }     (`#+TOC:`)
 *   include          { value }     (`#+INCLUDE:`)
 *   print-bibliography { value }   (`#+PRINT_BIBLIOGRAPHY:`)
 */

/**
 * @typedef {{ caption: { short: string | null, text: string }[], name: string | null, attr: Record<string, string[]>, header: string[], results: boolean }} Affiliated
 * @typedef {{ bullet: string, checkbox: string | null, counter: number | null, tag: string | null, children: OrgElement[], postBlank?: number }} ElementListItem
 * @typedef {{ rule: true } | { cells: string[], rule?: undefined }} ElementTableRow
 * @typedef {{ aff?: Affiliated | null, __id?: string, postBlank?: number }} AffField
 * @typedef {AffField & (
 *   { type: 'paragraph', lines: string[] } |
 *   { type: 'list', listType: 'unordered' | 'ordered' | 'descriptive', items: ElementListItem[] } |
 *   { type: 'table', rows: ElementTableRow[] } |
 *   { type: 'block', name: string, params: string, lines: string[], indent: number } |
 *   { type: 'drawer', name: string, lines: string[] } |
 *   { type: 'fixed', lines: string[] } |
 *   { type: 'hr' } |
 *   { type: 'latex-env', lines: string[] } |
 *   { type: 'footnote-def', label: string, children: OrgElement[] } |
 *   { type: 'html-line', value: string } |
 *   { type: 'latex-line', value: string } |
 *   { type: 'toc', value: string } |
 *   { type: 'include', value: string } |
 *   { type: 'print-bibliography', value: string }
 * )} OrgElement
 */

const AFFILIATED_RE = /^[ \t]*#\+(CAPTION|NAME|HEADERS?|RESULTS|PLOT|TBLNAME|ATTR_[A-Za-z0-9_-]+)(?:\[([^\]]*)\])?:[ \t]*(.*?)[ \t]*$/i;
const BLOCK_BEGIN_RE = /^[ \t]*#\+begin_(\S+)(?:[ \t]+(.*?))?[ \t]*$/i;
const KEYWORD_RE = /^[ \t]*#\+([A-Za-z0-9_-]+):[ \t]*(.*?)[ \t]*$/;
const COMMENT_RE = /^[ \t]*#(?: |$)/;
const DRAWER_RE = /^[ \t]*:([A-Za-z0-9_-]+):[ \t]*$/;
const FIXED_RE = /^[ \t]*:(?: |$)/;
const HR_RE = /^[ \t]*-{5,}[ \t]*$/;
const TABLE_RE = /^[ \t]*\|/;
const LATEX_ENV_RE = /^[ \t]*\\begin\{([A-Za-z0-9*]+)\}/;
const FOOTNOTE_DEF_RE = /^\[fn:([A-Za-z0-9_-]+)\][ \t]?(.*)$/;
const ITEM_RE = /^([ \t]*)([-+*]|\d+[.)])(?:[ \t]+|$)/;
const HEADLINE_LIKE_RE = /^\*+ /;

/** @param {string} line */
const indentOf = (line) => (/^[ \t]*/.exec(line) || [''])[0].replace(/\t/g, '        ').length;
/** @param {string} line */
const isBlank = (line) => line.trim() === '';

/**
 * Is this line the start of a list item? (A `*` bullet needs indentation, or it would be a headline.)
 * @param {string} line
 */
function itemMatch(line) {
  const m = ITEM_RE.exec(line);
  if (!m) return null;
  if (m[2] === '*' && m[1].length === 0) return null;
  return m;
}

/** The affiliated keywords gathered before an element: { caption: [{short, text}], name, attr: {html: [value]}, ... }. */
/** @returns {Affiliated} */
function emptyAff() {
  return { caption: [], name: null, attr: {}, header: [], results: false };
}

/**
 * @param {Affiliated} aff
 * @param {RegExpExecArray} match
 */
function addAffiliated(aff, match) {
  const key = match[1].toUpperCase();
  const value = match[3];
  if (key === 'CAPTION') aff.caption.push({ short: match[2] || null, text: value });
  else if (key === 'NAME' || key === 'TBLNAME') aff.name = value;
  else if (key.startsWith('ATTR_')) (aff.attr[key.slice(5).toLowerCase()] ||= []).push(value);
  else if (key === 'HEADER' || key === 'HEADERS') aff.header.push(value);
  else if (key === 'RESULTS') aff.results = true;
}

/**
 * `:key value :key2 "quoted value" :flag` -> { key: 'value', key2: 'quoted value', flag: '' }.
 * @param {string[] | null | undefined} values
 */
export function parseAttributes(values) {
  /** @type {Record<string, string>} */ const out = {};
  for (const text of values || []) {
    const re = /(?:^|\s)(:[^\s]+)(?:\s+("(?:[^"\\]|\\.)*"|(?!:\S)\S+(?:\s+(?!:\S)\S+)*))?/g;
    let m;
    while ((m = re.exec(text))) {
      const key = m[1].slice(1);
      let value = m[2] === undefined ? '' : m[2].trim();
      if (/^".*"$/.test(value)) value = value.slice(1, -1).replace(/\\(["\\])/g, '$1');
      out[key] = value;
    }
  }
  return out;
}

/** @param {string} line */
function splitRow(line) {
  let body = line.trim();
  body = body.replace(/^\|/, '');
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split('|').map((c) => c.trim());
}

/**
 * @param {string[]} lines
 * @param {number} i
 * @returns {[OrgElement, number]}
 */
function parseTable(lines, i) {
  /** @type {ElementTableRow[]} */ const rows = [];
  while (i < lines.length && TABLE_RE.test(lines[i])) {
    const line = lines[i];
    if (/^[ \t]*\|[-+]*[ \t]*\|?[ \t]*$/.test(line) && /^[ \t]*\|-/.test(line)) rows.push({ rule: true });
    else rows.push({ cells: splitRow(line) });
    i++;
  }
  while (i < lines.length && /^[ \t]*#\+TBLFM:/i.test(lines[i])) i++;
  return [/** @type {OrgElement} */ ({ type: 'table', rows }), i];
}

/**
 * Removes up to `n` columns of leading whitespace.
 * @param {string} line
 * @param {number} n
 */
function dedent(line, n) {
  let k = 0;
  let col = 0;
  while (k < line.length && col < n && (line[k] === ' ' || line[k] === '\t')) {
    col += line[k] === '\t' ? 8 : 1;
    k++;
  }
  return line.slice(k);
}

/**
 * @param {string[]} lines
 * @param {number} start
 * @returns {[OrgElement, number]}
 */
function parseList(lines, start) {
  const first = /** @type {RegExpExecArray} */ (itemMatch(lines[start]));
  const baseIndent = indentOf(lines[start]);
  /** @type {ElementListItem[]} */ const items = [];
  let i = start;
  while (i < lines.length) {
    const m = itemMatch(lines[i]);
    if (!m || indentOf(lines[i]) !== baseIndent) break;
    // the item: its first line, then every following line indented deeper (blank lines only when something deeper follows)
    const bulletEnd = m[0].length;
    const contentIndent = m[0].replace(/\t/g, '        ').length;
    let rest = lines[i].slice(bulletEnd);
    const bodyLines = [];
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j];
      if (isBlank(line)) {
        let k = j;
        while (k < lines.length && isBlank(lines[k])) k++;
        if (k - j >= 2 || k >= lines.length) break;
        if (indentOf(lines[k]) > baseIndent) {
          for (let b = j; b < k; b++) bodyLines.push('');
          j = k;
          continue;
        }
        break;
      }
      if (indentOf(line) <= baseIndent) break;
      bodyLines.push(line);
      j++;
    }
    const item = /** @type {ElementListItem} */ ({ bullet: m[2], checkbox: null, counter: null, tag: null });
    const cookie = /^\[@(\d+)\][ \t]*/.exec(rest);
    if (cookie) {
      item.counter = Number(cookie[1]);
      rest = rest.slice(cookie[0].length);
    }
    const box = /^\[([ xX-])\](?:[ \t]+|$)/.exec(rest);
    if (box) {
      item.checkbox = box[1] === ' ' ? 'off' : box[1] === '-' ? 'trans' : 'on';
      rest = rest.slice(box[0].length);
    }
    const tagMatch = /^(.*?)[ \t]+::(?:[ \t]+(.*))?$/.exec(rest);
    if (tagMatch && !isInsideCode(rest, tagMatch[1].length)) {
      item.tag = tagMatch[1];
      rest = tagMatch[2] || '';
    }
    const contentLines = [];
    if (rest.trim() !== '') contentLines.push(rest);
    const strip = Math.min(...bodyLines.filter((l) => !isBlank(l)).map(indentOf), contentIndent);
    for (const l of bodyLines) contentLines.push(isBlank(l) ? '' : dedent(l, strip));
    item.children = parseElements(contentLines);
    items.push(item);
    i = j;
    // a blank line (or two) between items is fine; the next item continues the list
    let k = i;
    while (k < lines.length && isBlank(lines[k])) k++;
    if (k - i < 2 && k < lines.length && itemMatch(lines[k]) && indentOf(lines[k]) === baseIndent) {
      if (k > i) item.postBlank = k - i;
      i = k;
    }
  }
  const listType = items[0].tag !== null ? 'descriptive' : /^\d/.test(first[2]) ? 'ordered' : 'unordered';
  return [/** @type {OrgElement} */ ({ type: 'list', listType, items }), i];
}

/**
 * True when index `at` in `text` is inside a `=verbatim=` or `~code~` span, where `::` is not a tag separator.
 * @param {string} text
 * @param {number} at
 */
function isInsideCode(text, at) {
  if (at < 0) return false;
  for (const delim of ['=', '~']) {
    let count = 0;
    for (let k = 0; k < at; k++) if (text[k] === delim) count++;
    if (count % 2 === 1) return true;
  }
  return false;
}

/**
 * @param {string[]} lines
 * @param {number} i
 * @param {string} name
 */
function findBlockEnd(lines, i, name) {
  const end = new RegExp('^[ \\t]*#\\+end_' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*$', 'i');
  for (let j = i + 1; j < lines.length; j++) if (end.test(lines[j])) return j;
  return -1;
}

/**
 * Does this line start something that ends a paragraph?
 * @param {string} line
 */
function interruptsParagraph(line) {
  return (
    isBlank(line) ||
    BLOCK_BEGIN_RE.test(line) ||
    AFFILIATED_RE.test(line) ||
    /^[ \t]*#\+(HTML|TOC|INCLUDE|PRINT_BIBLIOGRAPHY):/i.test(line) ||
    TABLE_RE.test(line) ||
    HR_RE.test(line) ||
    FIXED_RE.test(line) ||
    LATEX_ENV_RE.test(line) ||
    (DRAWER_RE.test(line) && !/^[ \t]*:END:/i.test(line)) ||
    !!itemMatch(line) ||
    (FOOTNOTE_DEF_RE.test(line) && indentOf(line) === 0)
  );
}

/** @param {string[]} lines @returns {OrgElement[]} */
export function parseElements(lines) {
  /** @type {OrgElement[]} */ const out = [];
  /** @type {Affiliated | null} */
  let aff = null;
  /** @param {OrgElement} el */
  const push = (el) => {
    if (aff) el.aff = aff;
    else el.aff = null;
    aff = null;
    out.push(el);
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      const last = out[out.length - 1];
      if (last && !aff) last.postBlank = (last.postBlank || 0) + 1;
      i++;
      continue;
    }
    const a = AFFILIATED_RE.exec(line);
    if (a) {
      aff ||= emptyAff();
      addAffiliated(aff, a);
      i++;
      continue;
    }
    const b = BLOCK_BEGIN_RE.exec(line);
    if (b) {
      const name = b[1];
      const end = findBlockEnd(lines, i, name);
      if (end > 0) {
        push({ type: 'block', name: name.toLowerCase(), params: b[2] || '', lines: lines.slice(i + 1, end), indent: indentOf(line) });
        i = end + 1;
        continue;
      }
    }
    const kw = KEYWORD_RE.exec(line);
    if (kw && !/^begin_|^end_/i.test(kw[1])) {
      const key = kw[1].toUpperCase();
      if (key === 'HTML') push({ type: 'html-line', value: kw[2] });
      else if (key === 'LATEX') push({ type: 'latex-line', value: kw[2] });
      else if (key === 'TOC') push({ type: 'toc', value: kw[2] });
      else if (key === 'INCLUDE') push({ type: 'include', value: kw[2] });
      else if (key === 'PRINT_BIBLIOGRAPHY') push({ type: 'print-bibliography', value: kw[2] });
      // other keywords (TITLE, OPTIONS, MACRO ...) are not content
      i++;
      continue;
    }
    if (COMMENT_RE.test(line)) {
      i++;
      continue;
    }
    const d = DRAWER_RE.exec(line);
    if (d && d[1].toUpperCase() !== 'END') {
      let j = i + 1;
      while (j < lines.length && !/^[ \t]*:END:[ \t]*$/i.test(lines[j])) j++;
      if (j < lines.length) {
        push({ type: 'drawer', name: d[1], lines: lines.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    if (FIXED_RE.test(line)) {
      const fixed = [];
      while (i < lines.length && FIXED_RE.test(lines[i])) fixed.push(lines[i++].replace(/^[ \t]*: ?/, ''));
      push({ type: 'fixed', lines: fixed });
      continue;
    }
    if (HR_RE.test(line)) {
      push({ type: 'hr' });
      i++;
      continue;
    }
    if (TABLE_RE.test(line)) {
      const [t, next] = parseTable(lines, i);
      push(t);
      i = next;
      continue;
    }
    const env = LATEX_ENV_RE.exec(line);
    if (env) {
      const endRe = new RegExp('^[ \\t]*\\\\end\\{' + env[1].replace(/\*/g, '\\*') + '\\}');
      let j = i;
      while (j < lines.length && !endRe.test(lines[j])) j++;
      if (j < lines.length) {
        push({ type: 'latex-env', lines: lines.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
    }
    const fn = FOOTNOTE_DEF_RE.exec(line);
    if (fn && indentOf(line) === 0) {
      const body = [fn[2]];
      let j = i + 1;
      while (j < lines.length) {
        if (FOOTNOTE_DEF_RE.test(lines[j]) || HEADLINE_LIKE_RE.test(lines[j])) break;
        if (isBlank(lines[j]) && j + 1 < lines.length && isBlank(lines[j + 1])) break;
        body.push(lines[j]);
        j++;
      }
      push({ type: 'footnote-def', label: fn[1], children: parseElements(body) });
      i = j;
      continue;
    }
    if (itemMatch(line)) {
      const [list, next] = parseList(lines, i);
      push(list);
      let tail = next;
      while (tail > i && isBlank(lines[tail - 1])) tail--;
      if (next > tail) list.postBlank = next - tail;
      i = next;
      continue;
    }
    // paragraph
    const para = [line];
    i++;
    while (i < lines.length && !interruptsParagraph(lines[i])) para.push(lines[i++]);
    push({ type: 'paragraph', lines: para });
  }
  return out;
}
