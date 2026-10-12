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
 *   toc              { value }     (`#+TOC:`)
 *   include          { value }     (`#+INCLUDE:`)
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

/** @param {any} [line] */
const indentOf = (line) => (/^[ \t]*/.exec(line) || [''])[0].replace(/\t/g, '        ').length;
/** @param {any} [line] */
const isBlank = (line) => line.trim() === '';

/**
 * Is this line the start of a list item? (A `*` bullet needs indentation, or it would be a headline.)
 * @param {any} [line]
 */
function itemMatch(line) {
  const m = ITEM_RE.exec(line);
  if (!m) return null;
  if (m[2] === '*' && m[1].length === 0) return null;
  return m;
}

/** The affiliated keywords gathered before an element: { caption: [{short, text}], name, attr: {html: [value]}, ... }. */
function emptyAff() {
  return { caption: [], name: null, attr: {}, header: [], results: false };
}

/**
 * @param {any} [aff]
 * @param {any} [match]
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
 * @param {any} [values]
 */
export function parseAttributes(values) {
  const out = {};
  for (const text of values || []) {
    const re = /(?:^|\s)(:[^\s]+)(?:\s+("(?:[^"\\]|\\.)*"|(?!:\S)\S+(?:\s+(?!:\S)\S+)*))?/g;
    let m;
    while ((m = re.exec(text))) {
      const key = m[1].slice(1);
      let value = m[2] === undefined ? '' : m[2].trim();
      if (/^".*"$/.test(value)) value = value.slice(1, -1).replace(/\\(["\\])/g, '$1');
      /** @type {any} */ (out)[key] = value;
    }
  }
  return out;
}

/** @param {any} [line] */
function splitRow(line) {
  let body = line.trim();
  body = body.replace(/^\|/, '');
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split('|').map((/** @type {any} */ c) => c.trim());
}

/**
 * @param {any} [lines]
 * @param {any} [i]
 */
function parseTable(lines, i) {
  const rows = [];
  while (i < lines.length && TABLE_RE.test(lines[i])) {
    const line = lines[i];
    if (/^[ \t]*\|[-+]*[ \t]*\|?[ \t]*$/.test(line) && /^[ \t]*\|-/.test(line)) rows.push({ rule: true });
    else rows.push({ cells: splitRow(line) });
    i++;
  }
  while (i < lines.length && /^[ \t]*#\+TBLFM:/i.test(lines[i])) i++;
  return [{ type: 'table', rows }, i];
}

/**
 * Removes up to `n` columns of leading whitespace.
 * @param {any} [line]
 * @param {any} [n]
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
 * @param {any} [lines]
 * @param {any} [start]
 */
function parseList(lines, start) {
  const first = /** @type {RegExpExecArray} */ (itemMatch(lines[start]));
  const baseIndent = indentOf(lines[start]);
  const items = [];
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
    const item = { bullet: m[2], checkbox: /** @type {string | null} */ (null), counter: /** @type {number | null} */ (null), tag: /** @type {string | null} */ (null) };
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
    /** @type {any} */ (item).children = parseElements(contentLines);
    items.push(item);
    i = j;
    // a blank line (or two) between items is fine; the next item continues the list
    let k = i;
    while (k < lines.length && isBlank(lines[k])) k++;
    if (k - i < 2 && k < lines.length && itemMatch(lines[k]) && indentOf(lines[k]) === baseIndent) i = k;
  }
  const listType = items[0].tag !== null ? 'descriptive' : /^\d/.test(first[2]) ? 'ordered' : 'unordered';
  return [{ type: 'list', listType, items }, i];
}

/**
 * True when index `at` in `text` is inside a `=verbatim=` or `~code~` span, where `::` is not a tag separator.
 * @param {any} [text]
 * @param {any} [at]
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
 * @param {any} [lines]
 * @param {any} [i]
 * @param {any} [name]
 */
function findBlockEnd(lines, i, name) {
  const end = new RegExp('^[ \\t]*#\\+end_' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*$', 'i');
  for (let j = i + 1; j < lines.length; j++) if (end.test(lines[j])) return j;
  return -1;
}

/**
 * Does this line start something that ends a paragraph?
 * @param {any} [line]
 */
function interruptsParagraph(line) {
  return (
    isBlank(line) ||
    BLOCK_BEGIN_RE.test(line) ||
    AFFILIATED_RE.test(line) ||
    /^[ \t]*#\+(HTML|TOC|INCLUDE):/i.test(line) ||
    TABLE_RE.test(line) ||
    HR_RE.test(line) ||
    FIXED_RE.test(line) ||
    LATEX_ENV_RE.test(line) ||
    (DRAWER_RE.test(line) && !/^[ \t]*:END:/i.test(line)) ||
    !!itemMatch(line) ||
    (FOOTNOTE_DEF_RE.test(line) && indentOf(line) === 0)
  );
}

/** @param {any} [lines] */
export function parseElements(lines) {
  /** @type {any[]} */ const out = [];
  /** @type {any} */
  let aff = null;
  /** @param {any} [el] */
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
      else if (key === 'TOC') push({ type: 'toc', value: kw[2] });
      else if (key === 'INCLUDE') push({ type: 'include', value: kw[2] });
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
