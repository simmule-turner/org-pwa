// @ts-check
/**
 * Slides (HTML): a presentation as a web page that prints to PDF, one page per frame and per overlay step. Emacs has no such export
 * (`ox-beamer` writes LaTeX), so this is its own entry; the decisions on what is a section, a frame, a block or a column are Beamer's
 * (`export-beamer.js`), and what a slide holds is written as the HTML export writes it.
 *
 *   - A headline below the frame level is a section (no page of its own), at it a frame, below it a block or a column.
 *   - `BEAMER_ACT` on a block or column shows it on the steps its `<spec>` names (`<2->`, `<1,3>`, `<-2>`, `<+->`); on a frame, the steps
 *     that frame has. A list with `#+ATTR_BEAMER: :overlay <+->` shows an item at a time, and `- @@beamer:<2>@@ item` puts one item on a step.
 *     A hidden list item keeps its place, a hidden block or column does not.
 *   - `note`, `notenh` are left out, `ignoreheading` passes its text on, `againframe` shows its frame again for the steps it names.
 */
import { createSlideRenderer } from './export-html.js';
import { latexConfig } from './latex-config.js';
import * as bm from './export-beamer.js';

/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {[number, number][] | null} Spec  the steps a spec names as [from, to] ranges; null for every step */
/**
 * @typedef {{ kind: 'html', html: string, spec: Spec }
 *   | { kind: 'list', html: string, tag: string, items: Spec[] }
 *   | { kind: 'box', env: string, title: string, children: Node[], spec: Spec }
 *   | { kind: 'columns', align: string, children: Node[], spec: Spec }
 *   | { kind: 'column', width: string, children: Node[], spec: Spec }} Node
 */

/**
 * @typedef {{ kind: 'title', title: string, subtitle: string, author: string, date: string }
 *   | { kind: 'toc', title: string, items: { title: string, level: number }[] }
 *   | { kind: 'frame', heading: Heading, title: string, nodes: Node[], steps: Spec, full: boolean, section: string }} Slide
 */

const FRAME_ENVS = ['frame', 'fullframe'];
const SPECIAL = ['note', 'notenh', 'ignoreheading', 'appendix', 'againframe'];

/** Theme names that get a colored title bar; the others a plain page. Themes cannot be reproduced, only told apart this far. */
const BAR_THEMES = ['madrid', 'warsaw', 'boadilla', 'frankfurt', 'berlin', 'copenhagen', 'luebeck', 'singapore', 'darmstadt', 'hannover', 'ilmenau', 'malmoe', 'montpellier', 'dresden', 'antibes', 'bergen', 'berkeley', 'cambridgeus', 'goettingen', 'juanlespins', 'marburg', 'paloalto', 'szeged'];

/** @param {string} text */
const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** @param {string} html */
const plainText = (html) => html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/**
 * The steps an overlay specification names, as Beamer reads it: `<2>`, `<2->`, `<-3>`, `<2-4>`, a comma list of those, and `+` for the
 * running counter (`<+->` from the counter on, which then moves up one). Anything after `|` or in front of `@` is left out. Null when
 * the text is not a specification.
 * @param {string} raw
 * @param {{ n: number }} counter  the running counter, starting at 1
 * @returns {Spec}
 */
export function parseSpec(raw, counter) {
  const m = /^<(.*)>$/s.exec(raw.trim());
  if (!m) return null;
  /** @type {[number, number][]} */
  const ranges = [];
  let advanced = false;
  for (const part of m[1].split('|')[0].split(',')) {
    const text = part.includes('@') ? part.slice(part.indexOf('@') + 1) : part;
    const r = /^\s*(\+|\d+)?\s*(-)?\s*(\+|\d+)?\s*$/.exec(text);
    if (!r || (!r[1] && !r[3])) continue;
    /** @param {string | undefined} v @param {number} fallback */
    const value = (v, fallback) => {
      if (v === undefined) return fallback;
      if (v === '+') {
        advanced = true;
        return counter.n;
      }
      return Number(v);
    };
    const from = r[1] ? value(r[1], 1) : 1;
    const to = r[2] ? (r[3] ? value(r[3], Infinity) : Infinity) : from;
    ranges.push([from, to]);
  }
  if (advanced) counter.n++;
  return ranges.length ? ranges : null;
}

/** Is `step` among the steps? @param {Spec} spec @param {number} step */
const shownAt = (spec, step) => !spec || spec.some(([a, b]) => step >= a && step <= b);

/** The last step a spec names (an open end counts as its start). @param {Spec} spec */
const lastStep = (spec) => (spec ? Math.max(0, ...spec.map(([a, b]) => (b === Infinity ? a : b))) : 0);

/** @param {Node[]} nodes @returns {number} */
function stepsOf(nodes) {
  let most = 0;
  for (const n of nodes) {
    if (n.kind === 'list') most = Math.max(most, ...n.items.map(lastStep));
    else most = Math.max(most, lastStep(n.spec));
    if ('children' in n) most = Math.max(most, stepsOf(n.children));
  }
  return most;
}

/**
 * The list's HTML for one step: the items that are not yet shown keep their place and cannot be seen.
 * @param {string} html @param {Spec[]} specs @param {number} step
 */
function listAtStep(html, specs, step) {
  let depth = 0;
  let index = -1;
  return html.replace(/<li\b([^>]*)>|<\/li>/g, (tag, attrs) => {
    if (tag === '</li>') {
      depth--;
      return tag;
    }
    const top = depth === 0;
    depth++;
    if (!top) return tag;
    index++;
    if (shownAt(specs[index] ?? null, step)) return tag;
    return /\bclass="/.test(attrs) ? tag.replace(/class="/, 'class="cover ') : `<li class="cover"${attrs}>`;
  });
}

/** @param {Node[]} nodes @param {number} step @returns {string} */
function renderNodes(nodes, step) {
  let out = '';
  for (const n of nodes) {
    if (n.kind === 'html') {
      if (shownAt(n.spec, step)) out += n.html + '\n';
    } else if (n.kind === 'list') {
      out += (n.items.some((s) => s) ? listAtStep(n.html, n.items, step) : n.html) + '\n';
    } else if (!shownAt(n.spec, step)) {
      continue;
    } else if (n.kind === 'column') {
      out += `<div class="column" style="width:${n.width}">\n${renderNodes(n.children, step)}</div>\n`;
    } else if (n.kind === 'columns') {
      out += `<div class="columns" style="align-items:${n.align}">\n${renderNodes(n.children, step)}</div>\n`;
    } else {
      const quote = ['quote', 'quotation', 'verse'].includes(n.env);
      const title = n.title ? `<div class="block-title">${n.title}</div>\n` : '';
      out += quote ? `<blockquote class="${n.env}">\n${renderNodes(n.children, step)}</blockquote>\n` : `<div class="block${n.env === 'block' ? '' : ' ' + n.env}">\n${title}<div class="block-body">\n${renderNodes(n.children, step)}</div>\n</div>\n`;
    }
  }
  return out;
}

/** A column width as CSS: 0.5 is half, `0.48\textwidth` is 48%, `5cm` stays. @param {string} raw */
function columnWidth(raw) {
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(\\[a-z]+)?\s*$/i.exec(raw);
  if (m) return Number(m[1]) <= 1 ? `${Number(m[1]) * 100}%` : `${m[1]}px`;
  return /^\s*[0-9.]+\s*(cm|mm|in|pt|em|px|%)\s*$/.test(raw) ? raw.trim() : 'auto';
}

/** `[t]`, `T`, `[c]` or `b` as the alignment of a row of columns. @param {string} opt */
const alignment = (opt) => {
  const c = opt.replace(/[[\]\s]/g, '').split(',')[0];
  return c === 'c' ? 'center' : c === 'b' ? 'flex-end' : 'flex-start';
};

/**
 * @param {Doc} doc
 * @param {Heading | null} [scope]
 * @param {{ images?: Map<string, string> | null, defaults?: import('./export-defaults.js').HtmlExportDefaults & { init?: string } }} [options]
 * @returns {string} a complete page
 */
export function exportToSlides(doc, scope = null, options = {}) {
  const defaults = options.defaults || {};
  const cfg = latexConfig(defaults.init).beamer;
  // the renderer may work on a copy of the document (inline tasks folded), so the scope is found there by its place
  const place = scope ? pathOf(doc, scope) : null;
  const html = createSlideRenderer(doc, { images: options.images, defaults });
  const root = place ? at(html.doc, place) : null;
  const source = root ? root.children || [] : html.doc.children || [];
  const base = root ? root.level : 0;
  const keyword = (/** @type {string} */ key) => {
    const found = (html.doc.keywords || []).filter((k) => k.key.toUpperCase() === key).pop();
    return found ? found.value.trim() : '';
  };

  // the frame level: `H:` in #+OPTIONS:, else org-beamer-frame-level
  let depth = cfg.frameLevel;
  for (const kw of html.doc.keywords || []) {
    const m = kw.key.toUpperCase() === 'OPTIONS' ? /(?:^|\s)H:(\d+)(?=\s|$)/.exec(kw.value) : null;
    if (m) depth = Number(m[1]);
  }

  /** @param {Heading} h @returns {Heading | null} */
  const frameBelow = (h) => {
    for (const c of h.children || []) {
      if (!html.included(c)) continue;
      if (FRAME_ENVS.includes(bm.envOf(c))) return c;
      const deeper = frameBelow(c);
      if (deeper) return deeper;
    }
    return null;
  };
  /** @param {Heading} h @param {Heading[]} parents */
  const frameLevel = (h, parents) => {
    for (const x of [h, ...[...parents].reverse()]) if (FRAME_ENVS.includes(bm.envOf(x))) return x.level - base;
    const below = frameBelow(h);
    return below ? below.level - base : depth;
  };

  /** Finds the frame an `againframe` shows: by `*title`, `#custom-id`, `id:...` or the title as written. @param {string} ref */
  const findFrame = (ref) => {
    const key = ref.trim().replace(/^[*#]|^id:/, '');
    /** @param {Heading[]} list @returns {Heading | null} */
    const search = (list) => {
      for (const h of list) {
        const props = h.properties || {};
        if (h.title.trim() === key || String(props.CUSTOM_ID || '').trim() === key || String(props.ID || '').trim() === key) return h;
        const deeper = search(h.children || []);
        if (deeper) return deeper;
      }
      return null;
    };
    return search(source);
  };

  /** @type {Extract<Slide, { kind: 'frame' }>[]} */
  const slides = [];
  /** @type {{ title: string, level: number }[]} */
  const outline = [];
  let section = '';

  /** The nodes inside a frame, block or column: the heading's own text, then what is below it. @param {Heading} h @param {Heading[]} parents @returns {Node[]} */
  const contents = (h, parents) => {
    const counter = { n: 1 };
    /** @type {Node[]} */
    const out = [];
    for (const part of html.parts(h)) {
      if (!part.html.trim()) continue;
      if (part.list && part.list.tag !== 'dl') {
        const specText = (/^\[?(<.*>)\]?$/s.exec(part.list.overlay.trim()) || [])[1] || '';
        /** @type {Spec[]} */
        const items = part.list.items.map((lead) => (lead ? parseSpec(lead, counter) : specText ? parseSpec(specText, counter) : null));
        out.push({ kind: 'list', html: part.html, tag: part.list.tag, items });
      } else out.push({ kind: 'html', html: part.html, spec: null });
    }
    out.push(...below(h.children || [], [...parents, h], counter));
    return out;
  };

  /** The headlines below one, as blocks and columns. @param {Heading[]} children @param {Heading[]} parents @param {{ n: number }} counter @returns {Node[]} */
  const below = (children, parents, counter) => {
    const shown = children.filter((c) => html.included(c));
    /** @type {Node[]} */
    const out = [];
    /** @type {Node[]} */
    let run = [];
    let runAlign = 'flex-start';
    const flush = () => {
      if (run.length) out.push({ kind: 'columns', align: runAlign, children: run, spec: null });
      run = [];
    };
    for (const c of shown) {
      const env = bm.envOf(c).toLowerCase();
      if (env === 'note' || env === 'notenh') {
        flush();
        continue;
      }
      if (env === 'ignoreheading') {
        flush();
        out.push(...contents(c, parents));
        continue;
      }
      if (env === 'appendix' || env === 'againframe') {
        flush();
        continue;
      }
      const spec = parseSpec(bm.prop(c, 'BEAMER_ACT'), counter);
      const column = bm.isColumn(c);
      const inner = contents(c, parents);
      if (column && (env === '' || env === 'column')) {
        if (!run.length) runAlign = alignment(bm.prop(c, 'BEAMER_OPT'));
        run.push({ kind: 'column', width: columnWidth(bm.prop(c, 'BEAMER_COL')), children: inner, spec });
        continue;
      }
      flush();
      if (env === 'columns') {
        out.push({ kind: 'columns', align: alignment(bm.prop(c, 'BEAMER_OPT')), children: inner, spec });
        continue;
      }
      const name = env === '' ? 'block' : env;
      const title = html.inline(c.title);
      const label = { theorem: 'Theorem', definition: 'Definition', example: 'Example', proof: 'Proof' }[/** @type {'theorem'} */ (name)];
      const shownTitle = label ? `${label}${title ? ` (${title})` : ''}.` : name === 'verse' || name === 'quote' || name === 'quotation' || name === 'structureenv' || name === 'beamercolorbox' ? '' : title;
      const known = bm.environmentFor(name, cfg.environments) ? name : 'block';
      const box = { kind: /** @type {'box'} */ ('box'), env: known, title: shownTitle, children: inner, spec };
      if (column) out.push({ kind: 'column', width: columnWidth(bm.prop(c, 'BEAMER_COL')), children: [box], spec: null });
      else out.push(box);
    }
    flush();
    // a column that sits alone in a column row is wrapped by the loop above; columns of a `columns` block are taken as they are
    return out;
  };

  /** @param {Heading[]} children @param {Heading[]} parents */
  const walk = (children, parents) => {
    const shown = children.filter((c) => html.included(c));
    for (const h of shown) {
      const rel = h.level - base;
      const env = bm.envOf(h).toLowerCase();
      const special = SPECIAL.includes(env);
      const fl = frameLevel(h, parents);
      if (!special && rel < fl) {
        section = html.inline(h.title);
        outline.push({ title: section, level: rel });
        walk(h.children || [], [...parents, h]);
      } else if (env === 'againframe') {
        const target = findFrame(bm.prop(h, 'BEAMER_REF'));
        const found = slides.find((s) => s.kind === 'frame' && s.heading === target);
        if (found) slides.push({ ...found, steps: parseSpec(bm.prop(h, 'BEAMER_ACT'), { n: 1 }) });
      } else if (!special && rel === fl) {
        const counter = { n: 1 };
        const own = parseSpec(bm.prop(h, 'BEAMER_ACT'), counter);
        slides.push({ kind: 'frame', heading: h, title: env === 'fullframe' ? '' : html.inline(h.title), nodes: contents(h, parents), steps: own, full: env === 'fullframe', section });
      } else if (env === 'ignoreheading' || special) {
        walk(h.children || [], [...parents, h]);
      } else walk(h.children || [], [...parents, h]);
    }
  };
  walk(source, []);

  // the title page and the outline come first
  const title = keyword('TITLE');
  /** @type {Slide[]} */
  const head = [];
  if (title && html.options.title) {
    const sub = keyword('SUBTITLE');
    head.push({ kind: 'title', title: html.inline(title), subtitle: sub ? html.inline(sub) : '', author: keyword('AUTHOR') ? html.inline(keyword('AUTHOR')) : '', date: keyword('DATE') ? html.inline(keyword('DATE')) : '' });
  }
  if (html.options.toc && outline.length) {
    const limit = typeof html.options.toc === 'number' ? html.options.toc : Infinity;
    head.push({ kind: 'toc', title: escapeHtml(cfg.outlineTitle), items: outline.filter((o) => o.level < limit) });
  }

  /** @type {string[]} */
  const pages = [];
  const page = (/** @type {string} */ cls, /** @type {string} */ inner, /** @type {string} */ where) => {
    pages.push(`<section class="slide ${cls}">\n${inner}<footer><span>${where}</span><span class="n">${pages.length + 1}</span></footer>\n</section>`);
  };
  for (const s of /** @type {Slide[]} */ ([...head, ...slides])) {
    if (s.kind === 'title') {
      page('title-slide', `<div class="title-block">\n<h1>${s.title}</h1>\n${s.subtitle ? `<p class="subtitle">${s.subtitle}</p>\n` : ''}${s.author ? `<p class="author">${s.author}</p>\n` : ''}${s.date ? `<p class="date">${s.date}</p>\n` : ''}</div>\n`, '');
    } else if (s.kind === 'toc') {
      page('toc-slide', `<header><h2>${s.title}</h2></header>\n<div class="frame-body">\n<ol class="toc">\n${s.items.map((/** @type {{ title: string }} */ o) => `<li>${o.title}</li>`).join('\n')}\n</ol>\n</div>\n`, '');
    } else {
      const total = Math.max(1, stepsOf(s.nodes));
      for (let step = 1; step <= total; step++) {
        if (!shownAt(s.steps, step)) continue;
        page(s.full ? 'frame fullframe' : 'frame', `${s.full ? '' : `<header><h2>${s.title}</h2></header>\n`}<div class="frame-body">\n${renderNodes(s.nodes, step)}</div>\n`, s.section);
      }
    }
  }
  const foot = html.footnotes();
  if (foot) page('frame', `<header><h2>Footnotes</h2></header>\n<div class="frame-body">\n${foot}\n</div>\n`, '');

  const themeName = keyword('BEAMER_THEME').replace(/\[.*\]/, '').trim().toLowerCase() || cfg.theme.toLowerCase();
  const look = BAR_THEMES.includes(themeName) ? 'bar' : 'plain';
  const docTitle = escapeHtml(plainText(title ? html.inline(title) : 'Slides'));
  const lang = (keyword('LANGUAGE') || 'en').replace(/[^A-Za-z-]/g, '') || 'en';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${docTitle}</title>
<meta name="generator" content="org-pwa" />
<style>${SLIDE_CSS}${html.mathCss()}</style>
</head>
<body class="${look}">
<main class="deck">
${pages.join('\n')}
</main>
${html.script() ? `<script>\n${html.script()}</script>\n` : ''}</body>
</html>
`;
}

/** The indices from the top to a heading. @param {Doc} doc @param {Heading} target @returns {number[] | null} */
function pathOf(doc, target) {
  /** @param {Heading[]} list @returns {number[] | null} */
  const walk = (list) => {
    for (let i = 0; i < list.length; i++) {
      if (list[i] === target) return [i];
      const deeper = walk(list[i].children || []);
      if (deeper) return [i, ...deeper];
    }
    return null;
  };
  return walk(doc.children || []);
}

/** @param {Doc} doc @param {number[]} path @returns {Heading | null} */
function at(doc, path) {
  /** @type {Heading | null} */
  let h = null;
  let list = doc.children || [];
  for (const i of path) {
    h = list[i] || null;
    if (!h) return null;
    list = h.children || [];
  }
  return h;
}

const SLIDE_CSS = `
  :root { color-scheme: light; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; background: #d8dbe0; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; }
  .deck { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px; }
  .slide { box-sizing: border-box; position: relative; width: 100%; max-width: 10in; aspect-ratio: 16 / 9; container-type: size; overflow: hidden; background: #fff; box-shadow: 0 1px 6px rgba(0, 0, 0, .3); display: flex; flex-direction: column; font-size: 3.2cqw; line-height: 1.3; }
  .slide header { padding: 3cqh 4cqw 1cqh; }
  .slide h1, .slide h2 { margin: 0; font-weight: 600; color: #333399; }
  .slide h2 { font-size: 4.6cqw; }
  .bar .slide header { background: #333399; padding: 2.5cqh 4cqw; }
  .bar .slide h2 { color: #fff; }
  .frame-body { flex: 1; padding: 1cqh 4cqw; overflow: hidden; }
  .fullframe .frame-body { padding: 0; }
  .slide footer { display: flex; justify-content: space-between; padding: 1cqh 4cqw; font-size: 2cqw; color: #666; }
  .title-slide { justify-content: center; text-align: center; }
  .title-slide h1 { font-size: 6cqw; }
  .title-slide p { margin: 1.5cqh 0 0; }
  .title-slide .subtitle { font-size: 4cqw; color: #333399; }
  .bar .title-slide .title-block { background: #333399; color: #fff; padding: 6cqh 4cqw; }
  .bar .title-slide h1, .bar .title-slide .subtitle { color: #fff; }
  .columns { display: flex; gap: 2cqw; }
  .column { box-sizing: border-box; }
  .block { margin: 1cqh 0; border-radius: .6cqw; background: #eef; overflow: hidden; }
  .block-title { padding: .8cqh 1.5cqw; background: #333399; color: #fff; font-weight: 600; }
  .block-body { padding: .8cqh 1.5cqw; }
  .alertblock .block-title { background: #a02020; }
  .alertblock { background: #fee; }
  .exampleblock .block-title, .example .block-title { background: #2a7a3a; }
  .exampleblock, .example { background: #efe; }
  .theorem, .definition, .proof { background: #f4f4fa; }
  .theorem .block-title, .definition .block-title, .proof .block-title { background: none; color: #333399; padding-bottom: 0; }
  .cover { visibility: hidden; }
  .frame-body pre { font-size: 2.4cqw; white-space: pre-wrap; background: #f6f6f6; padding: .8cqh 1cqw; }
  .frame-body img { max-width: 100%; max-height: 70cqh; }
  .frame-body table { border-collapse: collapse; }
  .frame-body td, .frame-body th { padding: .3cqh 1cqw; border-bottom: 1px solid #bbb; }
  .frame-body p { margin: .6cqh 0; }
  .frame-body ul, .frame-body ol { margin: .6cqh 0; padding-left: 4cqw; }
  .frame-body a { color: #333399; }
  .frame-body b, .frame-body strong { color: #b00020; }
  @media print {
    @page { size: 10in 5.625in; margin: 0; }
    body { background: none; }
    .deck { display: block; padding: 0; }
    .slide { width: 10in; max-width: none; height: 5.625in; box-shadow: none; break-after: page; page-break-after: always; }
  }
`;
