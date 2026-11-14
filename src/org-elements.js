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
 *   table            { rows: [{ rule: true } | { cells: [string] }] }   (a table.el table has no rows: `tableEl` holds its lines)
 *   dynamic-block    { name, params, lines, children }   (`#+BEGIN: name params` ... `#+END:`)
 *   block            { name (lower case), params, lines }   -- example, src, export, quote, verse, center, comment, special ...
 *   drawer           { name, lines }
 *   fixed            { lines }
 *   hr
 *   latex-env        { lines }
 *   footnote-def     { label, children }
 *   html-line        { value }     (`#+HTML:`)
 *   latex-line       { value }     (`#+LATEX:`)
 *   beamer-line      { value }     (`#+BEAMER:`)
 *   ascii-line       { value }     (`#+ASCII:`)
 *   odt-line         { value }     (`#+ODT:`)
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
 *   { type: 'table', rows: ElementTableRow[], tableEl?: string[] } |
 *   { type: 'index', value: string } |
 *   { type: 'block', name: string, rawName?: string, params: string, lines: string[], indent: number } |
 *   { type: 'drawer', name: string, lines: string[] } |
 *   { type: 'dynamic-block', name: string, params: string, lines: string[], children: OrgElement[] } |
 *   { type: 'fixed', lines: string[] } |
 *   { type: 'hr' } |
 *   { type: 'latex-env', lines: string[] } |
 *   { type: 'footnote-def', label: string, children: OrgElement[] } |
 *   { type: 'html-line', value: string } |
 *   { type: 'ascii-line', value: string } |
 *   { type: 'odt-line', value: string } |
 *   { type: 'latex-line', value: string } |
 *   { type: 'beamer-line', value: string } |
 *   { type: 'toc', value: string } |
 *   { type: 'include', value: string } |
 *   { type: 'print-bibliography', value: string }
 * )} OrgElement
 */

const AFFILIATED_RE = /^[ \t]*#\+(CAPTION|NAME|HEADERS?|RESULTS|PLOT|TBLNAME|ATTR_[A-Za-z0-9_-]+)(?:\[([^\]]*)\])?:[ \t]*(.*?)[ \t]*$/i;
const BLOCK_BEGIN_RE = /^[ \t]*#\+begin_(\S+)(?:[ \t]+(.*?))?[ \t]*$/i;
const KEYWORD_RE = /^[ \t]*#\+(\S+):[ \t]*(.*?)[ \t]*$/; // Org: any run of non-blanks, then a colon
// a dynamic block opens with `#+BEGIN: name args` and closes at the first `#+END:` (or `#+END`); an unclosed one is a paragraph
const DYNBLOCK_BEGIN_RE = /^[ \t]*#\+begin:[ \t]*([\p{L}\p{N}]+)(?:[ \t]+(.+))?/iu;
const DYNBLOCK_END_RE = /^[ \t]*#\+end:?[ \t]*$/i;
const COMMENT_RE = /^[ \t]*#(?: |$)/;
const DRAWER_RE = /^[ \t]*:([\p{L}\p{N}_-]+):[ \t]*$/u;
const FIXED_RE = /^[ \t]*:(?: |$)/;
const HR_RE = /^[ \t]*-{5,}[ \t]*$/;
const TABLE_RE = /^[ \t]*\|/;
const LATEX_ENV_RE = /^[ \t]*\\begin\{([A-Za-z0-9*]+)\}/i;
const FOOTNOTE_DEF_RE = /^\[fn:([\p{L}\p{N}_-]+)\][ \t]?(.*)$/iu;
// a rule of a table.el table: `+---+---+`
const TABLE_EL_RULE_RE = /^[ \t]*\+(?:-+\+)+[ \t]*$/;
// a table.el table line that is not a rule must still begin with `|` or `+` (after blanks)
const TABLE_EL_LINE_RE = /^[ \t]*[+|]/;
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
  if (key === 'CAPTION') {
    // several captions are one: the texts, and the short forms, joined by a blank
    const first = aff.caption[0];
    if (first) aff.caption[0] = { short: [first.short, match[2] || null].filter(Boolean).join(' ') || null, text: first.text + ' ' + value };
    else aff.caption.push({ short: match[2] || null, text: value });
  }
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
    if (/^[ \t]*\|-/.test(line)) rows.push({ rule: true });
    else rows.push({ cells: splitRow(line) });
    i++;
  }
  while (i < lines.length && /^[ \t]*#\+TBLFM:/i.test(lines[i])) i++;
  return [/** @type {OrgElement} */ ({ type: 'table', rows }), i];
}

/**
 * The lines of a table.el table starting at line `i`, as Org finds them: a rule, then lines that begin with `|` or `+`, the last one a rule,
 * at least two lines in all. Returns the index after the table, or -1 when the lines are no such table.
 * @param {string[]} lines
 * @param {number} i
 */
function tableElEnd(lines, i) {
  if (!TABLE_EL_RULE_RE.test(lines[i])) return -1;
  let j = i + 1;
  while (j < lines.length && TABLE_EL_LINE_RE.test(lines[j])) j++;
  return j - i >= 2 && TABLE_EL_RULE_RE.test(lines[j - 1]) ? j : -1;
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
    /** @type {Set<number>} */ const literal = new Set(); // body lines inside a block or drawer: Org skips them when it looks for the end of the item
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j];
      if (!isBlank(line) && indentOf(line) > baseIndent && !itemMatch(line)) {
        let end = -1;
        if (/^[ \t]*#\+begin_/i.test(line)) end = lines.findIndex((l, n) => n > j && /^[ \t]*#\+end_/i.test(l));
        else if (DRAWER_RE.test(line) && !/^[ \t]*:END:/i.test(line)) end = lines.findIndex((l, n) => n > j && /^[ \t]*:END:/i.test(l));
        if (end > j) {
          const open = j;
          for (; j <= end; j++) {
            if (j > open && j < end) literal.add(bodyLines.length);
            bodyLines.push(lines[j]);
          }
          continue;
        }
      }
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
    const cookie = /^\[@(\d+|[A-Za-z])\][ \t]*/.exec(rest);
    if (cookie) {
      item.counter = /^\d+$/.test(cookie[1]) ? Number(cookie[1]) : cookie[1].toLowerCase().charCodeAt(0) - 96; // [@c] is 3
      rest = rest.slice(cookie[0].length);
    }
    const box = /^\[([ xX-])\](?:[ \t]+|$)/.exec(rest);
    if (box) {
      item.checkbox = box[1] === ' ' ? 'off' : box[1] === '-' ? 'trans' : box[1] === 'X' ? 'on' : null; // a lower-case `[x]` is dropped from the text but is no checkbox, as Org reads it
      rest = rest.slice(box[0].length);
    }
    // the tag runs to the last ` ::` that ends the text or is followed by blanks; only an unordered item has one
    const tagMatch = /^[-+*]/.test(m[2]) ? /^(.*)[ \t]+::(?:[ \t]+(.*)|)$/.exec(rest) : null;
    if (tagMatch && !isInsideCode(rest, tagMatch[1].length)) {
      item.tag = tagMatch[1];
      rest = tagMatch[2] || '';
    }
    const contentLines = [];
    const firstLine = rest.trim() !== '';
    if (firstLine) contentLines.push(rest);
    const strip = Math.min(...bodyLines.filter((l, n) => !isBlank(l) && !literal.has(n)).map(indentOf), contentIndent);
    for (const l of bodyLines) contentLines.push(isBlank(l) ? '' : dedent(l, strip));
    item.children = parseElements(contentLines, { firstParagraph: firstLine, nested: true });
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

/** A keyword line: `#+KEY:`, or `#+KEY[option]:` (which ends a paragraph only for the dual keywords, CAPTION and RESULTS). */
const KEYWORD_LINE_RE = /^[ \t]*#\+\S+:/;
const DUAL_KEYWORD_LINE_RE = /^[ \t]*#\+(\S+?)\[.*\]:/;

/**
 * Does the line at `i` start something that ends a paragraph? A block, a drawer or a LaTeX environment ends it only when it is closed.
 * @param {string[]} lines
 * @param {number} i
 * @param {boolean} nested  inside a list item: a line that looks like a footnote definition is not one there
 */
function interruptsParagraph(lines, i, nested) {
  const line = lines[i];
  const closed = (/** @type {RegExp} */ re) => lines.slice(i).some((l) => re.test(l)); // Org looks from the start of the line itself
  const begin = BLOCK_BEGIN_RE.exec(line);
  const env = LATEX_ENV_RE.exec(line);
  const dual = DUAL_KEYWORD_LINE_RE.exec(line);
  return (
    isBlank(line) ||
    (!!begin && closed(blockEndRe(begin[1]))) ||
    (!dual && AFFILIATED_RE.test(line)) ||
    COMMENT_RE.test(line) ||
    (dual ? /^(?:CAPTION|RESULTS)$/i.test(dual[1]) : KEYWORD_LINE_RE.test(line)) || // any `#+KEY:` line ends a paragraph, known or not
    TABLE_RE.test(line) ||
    TABLE_EL_RULE_RE.test(line) ||
    HR_RE.test(line) ||
    FIXED_RE.test(line) ||
    (!!env && closed(latexEndRe(env[1]))) ||
    (DRAWER_RE.test(line) && closed(/^[ \t]*:END:[ \t]*$/i)) ||
    !!itemMatch(line) ||
    (!nested && FOOTNOTE_DEF_RE.test(line) && indentOf(line) === 0)
  );
}

/** @param {string} name */
const blockEndRe = (name) => new RegExp('^[ \\t]*#\\+end_' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*$', 'i');
/** @param {string} name */
const latexEndRe = (name) => new RegExp('\\\\end\\{' + name.replace(/\*/g, '\\*') + '\\}[ \\t]*$', 'i');

/**
 * @param {string[]} lines
 * @param {{ firstParagraph?: boolean, nested?: boolean }} [options]  `firstParagraph`: the first line is text that follows a list bullet or a
 *   footnote label on its own line, which Org always reads as a paragraph; `nested`: the lines are the content of a list item, where a
 *   footnote definition cannot be
 * @returns {OrgElement[]}
 */
export function parseElements(lines, options = {}) {
  /** @type {OrgElement[]} */ const out = [];
  /** @type {Affiliated | null} */
  let aff = null;
  let afterComment = false; // the blank lines after a comment belong to the comment, not to the element before it
  /** @param {OrgElement} el */
  const push = (el) => {
    afterComment = false;
    if (aff) el.aff = aff;
    else el.aff = null;
    aff = null;
    out.push(el);
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (i === 0 && options.firstParagraph) {
      const para = [line];
      i++;
      while (i < lines.length && !interruptsParagraph(lines, i, !!options.nested)) para.push(lines[i++]);
      push({ type: 'paragraph', lines: removeCommonIndentation(para) });
      continue;
    }
    if (isBlank(line)) {
      const last = out[out.length - 1];
      if (last && !aff && !afterComment) last.postBlank = (last.postBlank || 0) + 1;
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
        push({ type: 'block', name: name.toLowerCase(), rawName: name, params: b[2] || '', lines: lines.slice(i + 1, end), indent: indentOf(line) });
        i = end + 1;
        continue;
      }
    }
    const dyn = DYNBLOCK_BEGIN_RE.exec(line);
    if (dyn) {
      const end = lines.findIndex((l, n) => n > i && DYNBLOCK_END_RE.test(l));
      if (end > 0) {
        const content = lines.slice(i + 1, end);
        push({ type: 'dynamic-block', name: dyn[1], params: dyn[2] || '', lines: content, children: parseElements(content, { nested: options.nested }) });
        i = end + 1;
        continue;
      }
    }
    const kw = dyn ? null : KEYWORD_RE.exec(line); // an unclosed dynamic block is text
    if (kw && !/^begin_|^end_/i.test(kw[1])) {
      const key = kw[1].toUpperCase();
      if (key === 'HTML') push({ type: 'html-line', value: kw[2] });
      else if (key === 'LATEX') push({ type: 'latex-line', value: kw[2] });
      else if (key === 'BEAMER') push({ type: 'beamer-line', value: kw[2] });
      else if (key === 'ASCII') push({ type: 'ascii-line', value: kw[2] });
      else if (key === 'ODT') push({ type: 'odt-line', value: kw[2] });
      else if (key === 'TOC') push({ type: 'toc', value: kw[2] });
      else if (key === 'INDEX') push({ type: 'index', value: kw[2] });
      else if (key === 'INCLUDE') push({ type: 'include', value: kw[2] });
      else if (key === 'PRINT_BIBLIOGRAPHY') push({ type: 'print-bibliography', value: kw[2] });
      else afterComment = true; // other keywords (TITLE, OPTIONS, MACRO ...) are not content; the blank lines after one belong to it, not to the element before
      i++;
      continue;
    }
    if (COMMENT_RE.test(line)) {
      const last = out[out.length - 1];
      if (last && !aff && i > 0 && !isBlank(lines[i - 1])) last.postBlank = Math.max(last.postBlank || 0, 1); // Org prints a blank line where a comment cut an element short
      afterComment = true;
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
    const tableEl = tableElEnd(lines, i);
    if (tableEl > 0) {
      push({ type: 'table', rows: [], tableEl: lines.slice(i, tableEl) });
      i = tableEl;
      while (i < lines.length && /^[ \t]*#\+TBLFM:/i.test(lines[i])) i++;
      continue;
    }
    const env = LATEX_ENV_RE.exec(line);
    if (env) {
      const endRe = latexEndRe(env[1]); // the end may be on the line of the beginning
      let j = i;
      while (j < lines.length && !endRe.test(lines[j])) j++;
      if (j < lines.length) {
        push({ type: 'latex-env', lines: lines.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
    }
    const fn = FOOTNOTE_DEF_RE.exec(line);
    if (fn && indentOf(line) === 0 && !options.nested) {
      const body = [fn[2]];
      let j = i + 1;
      while (j < lines.length) {
        if (FOOTNOTE_DEF_RE.test(lines[j]) || HEADLINE_LIKE_RE.test(lines[j])) break;
        if (isBlank(lines[j]) && j + 1 < lines.length && isBlank(lines[j + 1])) break;
        body.push(lines[j]);
        j++;
      }
      push({ type: 'footnote-def', label: fn[1], children: parseElements(body, { firstParagraph: fn[2].trim() !== '' }) });
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
    while (i < lines.length && !interruptsParagraph(lines, i, !!options.nested)) para.push(lines[i++]);
    push({ type: 'paragraph', lines: removeCommonIndentation(para) });
  }
  return out;
}

/**
 * The lines of a paragraph without their common indentation (a tab counts to the next multiple of 8 columns), as Org reads a
 * paragraph: "  a" over "   b" is "a" over " b".
 * @param {string[]} lines
 */
function removeCommonIndentation(lines) {
  /** @param {string} line */
  const lead = (line) => {
    let col = 0;
    let k = 0;
    for (; k < line.length && (line[k] === ' ' || line[k] === '\t'); k++) col = line[k] === '\t' ? (Math.floor(col / 8) + 1) * 8 : col + 1;
    return { col, k };
  };
  const min = Math.min(...lines.map((l) => lead(l).col));
  if (min === 0) return lines;
  return lines.map((l) => {
    const { col, k } = lead(l);
    return ' '.repeat(col - min) + l.slice(k);
  });
}
