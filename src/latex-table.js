// @ts-check
/**
 * An Org table as LaTeX, laid out the way ox-latex does (test/fixtures/latex/tables*.org and attr.org hold Emacs's own output):
 * column alignment from the cells (a column is right-aligned when half or more of it is numbers) or `<l>` `<r>` `<c>` cookies or
 * `#+ATTR_LATEX: :align`; a float when the table has a caption or a name; and the `:environment`, `:float`, `:placement`,
 * `:center`, `:font`, `:booktabs`, `:width`, `:mode` and `:caption` attributes.
 */

import { parseAttributes } from './org-elements.js';

/** @typedef {import('./org-elements.js').OrgElement} OrgElement */
/** @typedef {Extract<OrgElement, { type: 'table' }>} TableElement */
/** @typedef {{ cell: (text: string) => string, caption: { short: string | null, text: string } | null, label: string, vars?: import('./latex-config.js').LatexVars }} TableContext */

const NUMBER_RE = /^([<>]?[-+^.0-9]*[0-9][-+^.0-9eEdDx()%:]*|0[xX][0-9a-fA-F]+|nan|[-+u]?inf)$/;
const COOKIE_RE = /^<[lrc]?\d*>$/;
const ALIGN_COOKIE_RE = /^<[lrc]\d*>$/;
const NO_SPEC_ENV_RE = /matrix$/;
const WIDTH_ENVS = new Set(['tabularx', 'tabulary', 'tabular*']);

/** The row cells of a cookie row (`<l> <r>` ...), or null when the row is anything else. @param {string[] | null} cells */
function isCookieRow(cells) {
  return !!cells && cells.some((c) => COOKIE_RE.test(c) && c !== '<>') && cells.every((c) => c === '' || COOKIE_RE.test(c));
}

/**
 * @param {TableElement} el
 * @param {TableContext} ctx
 */
export function latexTable(el, ctx) {
  const attrs = parseAttributes(el.aff && el.aff.attr.latex);
  const { rows, marks } = withoutSpecialRows(el.rows.map((r) => ('rule' in r && r.rule ? null : (r.cells || []).map((c) => c.trim()))));
  /** @type {string[]} */
  const cookies = [];
  const kept = rows.filter((cells) => {
    if (!isCookieRow(cells)) return true;
    /** @type {string[]} */ (cells).forEach((c, i) => {
      if (ALIGN_COOKIE_RE.test(c)) cookies[i] = c.replace(/[^lrc]/g, '');
    });
    return false;
  });
  const standard = /** @type {string[][]} */ (kept.filter((r) => r !== null));
  const width = Math.max(0, ...standard.map((r) => r.length));
  const vars = ctx.vars;
  const mode = attrs.mode || '';
  const math = mode === 'math' || mode === 'inline-math';
  const env = attrs.environment || (vars ? vars.tableEnvironment : 'tabular');
  let spec = attrs.align || '';
  if (!spec) {
    for (let c = 0; c < width; c++) {
      const left = marks[c] === '<' || marks[c] === '<>';
      const right = (marks[c] === '>' || marks[c] === '<>') && !(marks[c + 1] === '<' || marks[c + 1] === '<>'); // a border is written once
      let align;
      if (math) align = 'c';
      else if (cookies[c]) align = cookies[c];
      else {
        const numeric = standard.filter((r) => NUMBER_RE.test(r[c] || '')).length;
        align = standard.length && numeric / standard.length >= 0.5 ? 'r' : 'l';
      }
      spec += (left ? '|' : '') + align + (right ? '|' : '');
    }
  }

  const row = (/** @type {string[]} */ cells) => (math ? ' ' + cells.map(ctx.cell).join(' & ') + ' \\\\[0pt]' : cells.map(ctx.cell).join(' & ') + '\\\\[0pt]');
  const booktabs = !math && (attrs.booktabs === undefined ? !!(vars && vars.tablesBooktabs) : attrs.booktabs === 't');
  const rule = (/** @type {number} */ index) => (booktabs ? (index === 0 ? '\\toprule' : index === kept.length - 1 ? '\\bottomrule' : '\\midrule') : '\\hline');
  if (env === 'longtable') return longtable(kept, spec, width, ctx, attrs, row, rule, booktabs);

  /** @type {string[]} */
  const body = [];
  if (booktabs && kept[0] !== null) body.push('\\toprule');
  kept.forEach((cells, i) => body.push(cells === null ? rule(i) : row(cells)));
  if (booktabs && kept[kept.length - 1] !== null) body.push('\\bottomrule');

  const widthArg = WIDTH_ENVS.has(env) && attrs.width ? '{' + attrs.width + '}' : '';
  const open = '\\begin{' + env + '}' + widthArg + (NO_SPEC_ENV_RE.test(env) ? '' : '{' + spec + '}');
  const tabular = open + '\n' + body.join('\n') + '\n\\end{' + env + '}';
  if (math) return mode === 'math' ? '\\[\n' + tabular + '\n\\]\n' : '\\(' + tabular + '\n\\)\n';

  const raw = attrs.caption || '';
  const caption = raw ? raw : ctx.caption ? '\\caption' + (ctx.caption.short ? '[' + ctx.caption.short + ']' : '') + '{' + ctx.label + ctx.caption.text + '}' : ctx.label;
  const center = attrs.center === undefined ? !vars || vars.tablesCentered : attrs.center !== 'nil';
  const above = !vars || vars.captionAbove.has('table'); // org-latex-caption-above
  const floatAttr = attrs.float;
  const floating = floatAttr === 'sideways' || floatAttr === 'multicolumn' || floatAttr === 't' || floatAttr === 'table' || (floatAttr === undefined && !!caption);
  if (!floating) {
    const lines = [];
    const captionOf = ctx.caption && !raw ? '\\captionof{table}{' + ctx.label + ctx.caption.text + '}' : '';
    if (captionOf && above) lines.push(captionOf);
    if (attrs.font) lines.push(attrs.font);
    lines.push(tabular);
    if (captionOf && !above) lines.push(captionOf, '');
    return center ? '\\begin{center}\n' + lines.join('\n') + '\n\\end{center}\n' : lines.join('\n') + '\n';
  }
  const name = floatAttr === 'sideways' ? 'sidewaystable' : floatAttr === 'multicolumn' ? 'table*' : 'table';
  const lines = ['\\begin{' + name + '}' + (attrs.placement || '[' + (vars ? vars.figurePosition : 'htbp') + ']')];
  if (caption && above) lines.push(caption);
  if (center) lines.push('\\centering');
  if (attrs.font) lines.push(attrs.font);
  lines.push(tabular);
  if (caption && !above) lines.push(caption, '');
  lines.push('\\end{' + name + '}');
  return lines.join('\n') + '\n';
}

const MARKS = new Set(['', '#', '!', '$', '*', '_', '/', '^']);

/**
 * Org's special rows and columns. When every row starts with a mark (and one has a real one) that column is a special column and is not
 * written; rows marked `!` `^` `$` `_` are not written either. A row starting with `/` holds the column group marks (`<` opens a group, `>`
 * closes it, `<>` is a group of one) and is not written; they become `|` in the column specification.
 * @param {(string[] | null)[]} rows
 * @returns {{ rows: (string[] | null)[], marks: string[] }}
 */
function withoutSpecialRows(rows) {
  const data = /** @type {string[][]} */ (rows.filter((r) => r !== null));
  const special = data.length > 0 && data.every((r) => MARKS.has(r[0] || '')) && data.some((r) => (r[0] || '') !== '');
  /** @type {string[]} */
  let marks = [];
  /** @type {(string[] | null)[]} */
  const out = [];
  for (const r of rows) {
    if (r === null) out.push(null);
    else if ((r[0] || '') === '/') marks = special ? r.slice(1) : r;
    else if (special && ['!', '^', '$', '_'].includes(r[0] || '')) continue;
    else out.push(special ? r.slice(1) : r);
  }
  return { rows: out, marks };
}

/**
 * A longtable repeats its header on every page: the rows before the first rule are written three times, as Org does.
 * @param {(string[] | null)[]} kept @param {string} spec @param {number} width @param {TableContext} ctx
 * @param {Record<string, string>} attrs @param {(cells: string[]) => string} row @param {(index: number) => string} rule @param {boolean} booktabs
 */
function longtable(kept, spec, width, ctx, attrs, row, rule, booktabs) {
  if (booktabs) return booktabsLongtable(kept, spec, width, ctx, row);
  const firstRule = kept.indexOf(null);
  const header = firstRule > 0 ? /** @type {string[][]} */ (kept.slice(0, firstRule)) : [];
  const rest = firstRule > 0 ? kept.slice(firstRule + 1) : kept;
  /** @type {string[]} */
  const lines = ['\\begin{longtable}{' + spec + '}'];
  if (ctx.caption) lines.push('\\caption' + (ctx.caption.short ? '[' + ctx.caption.short + ']' : '') + '{' + ctx.label + ctx.caption.text + '}', '\\\\[0pt]');
  else if (ctx.label) lines.push(ctx.label, '\\\\[0pt]');
  if (header.length) {
    const spaced = header.map((cells) => cells.map(ctx.cell).join(' & ') + ' \\\\[0pt]');
    lines.push(...header.map(row), rule(firstRule), '\\endfirsthead');
    lines.push('\\multicolumn{' + width + '}{l}{Continued from previous page} \\\\[0pt]', rule(firstRule), '', ...spaced, '', rule(firstRule), '\\endhead');
    lines.push('\\hline\\multicolumn{' + width + '}{r}{Continued on next page} \\\\', '\\endfoot', '\\endlastfoot', rule(firstRule));
  }
  rest.forEach((cells, i) => lines.push(cells === null ? rule(i + 1) : row(cells)));
  lines.push('\\end{longtable}');
  void attrs;
  return lines.join('\n') + '\n';
}

/**
 * A longtable with `:booktabs t`: `\toprule` above the first row (a rule row that opens the table is that rule), `\midrule` for the rules
 * between rows and `\bottomrule` below the last; the header, when a rule follows it, is repeated as in any longtable.
 * @param {(string[] | null)[]} kept @param {string} spec @param {number} width @param {TableContext} ctx @param {(cells: string[]) => string} row
 */
function booktabsLongtable(kept, spec, width, ctx, row) {
  const rows = kept.slice();
  if (rows[0] === null) rows.shift();
  if (rows[rows.length - 1] === null) rows.pop();
  const firstRule = rows.indexOf(null);
  const header = firstRule > 0 ? /** @type {string[][]} */ (rows.slice(0, firstRule)) : [];
  const rest = firstRule > 0 ? rows.slice(firstRule + 1) : rows;
  /** @type {string[]} */
  const lines = ['\\begin{longtable}{' + spec + '}'];
  if (ctx.caption) lines.push('\\caption' + (ctx.caption.short ? '[' + ctx.caption.short + ']' : '') + '{' + ctx.label + ctx.caption.text + '}', '\\\\[0pt]');
  else if (ctx.label) lines.push(ctx.label, '\\\\[0pt]');
  lines.push('\\toprule');
  if (header.length) {
    const spaced = header.map((cells) => cells.map(ctx.cell).join(' & ') + ' \\\\[0pt]');
    lines.push(...header.map(row), '\\midrule', '\\endfirsthead');
    lines.push('\\multicolumn{' + width + '}{l}{Continued from previous page} \\\\[0pt]', '\\toprule', '', ...spaced, '', '\\midrule', '\\endhead');
    lines.push('\\midrule\\multicolumn{' + width + '}{r}{Continued on next page} \\\\', '\\endfoot', '\\endlastfoot');
  }
  rest.forEach((cells) => lines.push(cells === null ? '\\midrule' : row(cells)));
  lines.push('\\bottomrule', '\\end{longtable}');
  return lines.join('\n') + '\n';
}
