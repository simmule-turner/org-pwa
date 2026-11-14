// The outline of what a text holds, as Org's parser (org-element, Emacs 29.3) sees it and as the app's two parsers do, so the two can be
// compared: tools/gen-parser-oracle.mjs makes test/fixtures/parser-oracle.json from Emacs, and test/parser-oracle.test.js holds
// parseElements (src/org-elements.js, what the exporters read) and parseBody (src/body-parser.js, what the editor shows) to it.
//
// An element is { k: kind, lines, rows, items: [{ b: bullet, cb: checkbox, cn: counter, tag, ch: elements }], ch: elements }.

const KEYWORD_KINDS = { html: 'html-line', latex: 'latex-line', beamer: 'beamer-line', ascii: 'ascii-line', odt: 'odt-line', toc: 'toc', index: 'index', include: 'include', print_bibliography: 'print-bibliography' };
const BLOCK_KINDS = { 'src-block': 'src', 'example-block': 'example', 'export-block': 'export', 'quote-block': 'quote', 'center-block': 'center', 'verse-block': 'verse', 'comment-block': 'comment' };
const lineCount = (/** @type {string} */ text) => text.replace(/\s+$/, '').split('\n').length;

/**
 * Emacs's tree (the nodes tools/gen-parser-oracle.mjs dumps: { type, pa, e, pb, bullet, checkbox, counter, tag, tableType, blockType, ch }) as
 * an outline. `mode` is 'elements' (keywords stay what they are) or 'body' (a keyword, comment or call is text, as the editor shows it).
 * @param {any[]} nodes @param {string} src @param {'elements' | 'body'} mode
 * @returns {any[]}
 */
export function emacsOutline(nodes, src, mode) {
  /** @type {any[]} */ const out = [];
  for (const n of nodes) {
    const span = lineCount(src.slice(n.pa ?? n.b, n.e));
    /** @type {any} */ let item;
    switch (n.type) {
      case 'paragraph':
      case 'clock':
      case 'diary-sexp':
        item = { k: 'paragraph', lines: span };
        break;
      case 'plain-list':
        item = { k: 'list', items: n.ch.map((/** @type {any} */ it) => ({ b: (it.bullet || '').trim(), cb: it.checkbox ? /** @type {any} */ (CHECKBOX)[it.checkbox] : null, cn: it.counter || null, tag: it.tag ? 'T' : null, ch: emacsOutline(it.ch, src, mode) })) };
        break;
      case 'table':
        item = { k: 'table', rows: n.ch.length, tableType: n.tableType };
        break;
      case 'special-block':
        item = { k: 'block:' + (n.blockType || '').toLowerCase(), lines: span };
        break;
      case 'dynamic-block':
        item = { k: 'dynamic-block', lines: span };
        break;
      case 'drawer':
        item = { k: 'drawer', lines: span };
        break;
      case 'horizontal-rule':
        item = { k: 'hr' };
        break;
      case 'fixed-width':
        item = { k: 'fixed', lines: span };
        break;
      case 'latex-environment':
        item = { k: 'latex-env', lines: span };
        break;
      case 'footnote-definition':
        item = { k: 'footnote-def', ch: emacsOutline(n.ch, src, mode) };
        break;
      case 'keyword':
        item = mode === 'body' ? { k: 'paragraph', lines: span } : KEYWORD_KINDS[(n.key || '').toLowerCase()] ? { k: KEYWORD_KINDS[(n.key || '').toLowerCase()] } : null;
        break;
      case 'comment':
      case 'babel-call':
        item = mode === 'body' ? { k: 'paragraph', lines: span } : null;
        break;
      case 'planning':
      case 'property-drawer':
        item = null;
        break;
      default:
        if (BLOCK_KINDS[n.type]) item = { k: 'block:' + BLOCK_KINDS[n.type], lines: span };
        else item = { k: '?' + n.type };
    }
    if (item) out.push({ ...item, b: n.pa ?? n.b, e: n.e, pb: n.pb });
  }
  // text that Org cut into paragraphs where a comment or keyword stood is one paragraph in what the editor shows
  /** @type {any[]} */ const merged = [];
  for (const x of out) {
    const p = merged[merged.length - 1];
    if (p && p.k === 'paragraph' && x.k === 'paragraph' && p.pb === 0 && p.e === x.b && mode === 'body') {
      p.e = x.e;
      p.pb = x.pb;
    } else merged.push(x);
  }
  return merged;
}

/** The part of an outline the two parsers are compared on. @param {any[]} outline @param {boolean} detail */
export function emacsSignature(outline, detail) {
  return outline.map((x) => {
    /** @type {any} */ const o = { k: x.k };
    if (detail) {
      if (x.lines !== undefined && x.k !== 'paragraph') o.lines = x.lines;
      if (x.rows !== undefined) o.rows = x.rows;
    }
    if (x.items) o.items = x.items.map((/** @type {any} */ i) => ({ b: i.b, cb: i.cb, cn: i.cn, tag: i.tag, ch: emacsSignature(i.ch, detail) }));
    if (x.ch) o.ch = emacsSignature(x.ch, detail);
    return o;
  });
}

const CHECKBOX = { off: ' ', on: 'X', trans: '-' };

/** parseElements' output as an outline. @param {any[]} elements @returns {any[]} */
export function elementsOutline(elements) {
  return elements.map((e) => {
    /** @type {any} */ const o = { k: e.type };
    if (e.type === 'paragraph') o.lines = e.lines.length;
    else if (e.type === 'block') {
      o.k = 'block:' + e.name;
      o.lines = e.lines.length + 2;
    } else if (e.type === 'drawer') o.lines = e.lines.length + 2;
    else if (e.type === 'dynamic-block') o.lines = e.lines.length + 2;
    else if (e.type === 'fixed' || e.type === 'latex-env') o.lines = e.lines.length;
    else if (e.type === 'table') o.rows = e.rows.length;
    else if (e.type === 'list') o.items = e.items.map((/** @type {any} */ it) => ({ b: it.bullet.trim(), cb: it.checkbox ? /** @type {any} */ (CHECKBOX)[it.checkbox] : null, cn: it.counter, tag: it.tag ? 'T' : null, ch: elementsOutline(it.children) }));
    else if (e.type === 'footnote-def') o.ch = elementsOutline(e.children);
    return o;
  });
}

/** parseBody's output as a coarse outline: the kinds of its nodes, a table.el table being one paragraph. @param {any[]} nodes @returns {any[]} */
export function bodyOutline(nodes) {
  /** @type {any[]} */ const out = [];
  for (const n of nodes) {
    const kind = n.type === 'block' ? 'block:' + String(n.name).toLowerCase() : n.type;
    if (kind === 'paragraph' && out[out.length - 1]?.k === 'paragraph') continue;
    out.push({ k: kind });
  }
  return out;
}

/** The outline of Emacs's elements, coarse: only what the editor tells apart. @param {any[]} outline @returns {any[]} */
export function emacsCoarse(outline) {
  /** @type {any[]} */ const out = [];
  for (const x of outline) {
    const k = x.k === 'table' && x.tableType === 'table.el' ? 'paragraph' : x.k === 'list' || x.k === 'table' || x.k === 'hr' || x.k.startsWith('block:') ? x.k : 'paragraph';
    if (k === 'paragraph' && out[out.length - 1]?.k === 'paragraph') continue;
    out.push({ k });
  }
  return out;
}

/** The cases where an app parser still differs from Emacs on purpose or for want of a model, with the reason. Each entry: a test on the text. */
const ITEM_LINE = /^([ \t]*)(?:[-+*]|\d+[.)])(?:[ \t]|$)/;
const hasContinuation = (/** @type {string} */ text) => {
  const lines = text.split('\n');
  return lines.some((line, i) => {
    const item = ITEM_LINE.exec(line);
    if (!item) return false;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    return j < lines.length && /^[ \t]+\S/.test(lines[j]) && lines[j].match(/^[ \t]*/)[0].length > item[1].length;
  });
};
const hasClosedDrawer = (/** @type {string} */ text) => /(^|\n)[ \t]*:[\p{L}\p{N}_-]+:[ \t]*\n[\s\S]*\n[ \t]*:END:[ \t]*(\n|$)/iu.test(text);

/** The cases where an app parser still differs from Emacs on purpose or for want of a model, with the reason. Each entry: a test on the text. */
export const KNOWN = {
  /** @type {{ reason: string, match: (text: string) => boolean }[]} */
  elements: [
    { reason: 'a lone tab line is a paragraph to Emacs only when no line break follows it (a quirk of the end of the buffer)', match: (t) => /(^|\n)\t$/.test(t) },
    { reason: 'a line of blanks only is a paragraph to Emacs only when no line break follows it (a quirk of the end of the buffer)', match: (t) => /(^|\n)[ \t]+$/.test(t) },
    { reason: 'not built: a diary sexp (`%%(...)` at the start of a line) and a CLOCK line are elements of their own in Org, which end a paragraph; the app keeps them in the paragraph', match: (t) => /(^|\n)(?:%%\(|CLOCK:)/.test(t) },
    { reason: 'chosen: a `::` inside =verbatim= or ~code~ text is never a list tag here (a deliberate rule of the app, see org-elements.js); Org takes the last ` ::` of the line whatever is around it', match: (t) => /[=~][^\n]* :: [^\n]*[=~]/.test(t) },
  ],
  /** @type {{ reason: string, match: (text: string) => boolean }[]} */
  body: [
    { reason: 'a lone tab line is a paragraph to Emacs only when no line break follows it (a quirk of the end of the buffer)', match: (t) => /(^|\n)\t$/.test(t) },
    { reason: 'a line of blanks only is a paragraph to Emacs only when no line break follows it (a quirk of the end of the buffer)', match: (t) => /(^|\n)[ \t]+$/.test(t) },
    { reason: 'not built: the editor model keeps what continues a list item (a paragraph, comment, table, rule or block, or a sub-list after a blank line) as nodes after the list, not inside the item, so a list with such a continuation is two nodes to it and one to Org', match: (t) => hasContinuation(t) || /(^|\n)- a\n c/.test(t) || /(^|\n)-\n[ \t]+\S/.test(t) },
    { reason: 'not built: the editor shows what a footnote definition holds after its first line (a list, table, rule or block) as nodes of their own, where Org has them in the definition', match: (t) => /(^|\n)\[fn:[^\]]+\]/i.test(t) && /\n[ \t]*(?:\||-----|[-+] |\d+[.)] |#\+begin_|:[\w-]+:|\\begin)/i.test(t) },
    { reason: 'not built: the editor shows what a drawer or a dynamic block holds (a list, table or block) as nodes of their own, where Org has them inside it', match: (t) => hasClosedDrawer(t) || /(^|\n)#\+BEGIN: /i.test(t) },
    { reason: 'not built: the editor reads one #+TBLFM: line per table; a second one (or one after a blank line) stays a paragraph, where Org reads every following line as the formulas', match: (t) => /#\+TBLFM: .*\n#\+TBLFM:/i.test(t) || /\|[^\n]*\n\n#\+TBLFM: /i.test(t) },
    { reason: 'chosen: a `* heading` inside a #+begin_ block does not end the block in the editor (deliberate, see org-parser.js)', match: (t) => /#\+begin_[\s\S]*\n\* /i.test(t) },
  ],
};
