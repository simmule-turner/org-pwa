// @ts-check
/**
 * An Org table as LaTeX, laid out the way ox-latex does (test/fixtures/latex/tables*.org and attr.org hold Emacs's own output):
 * column alignment from the cells (a column is right-aligned when half or more of it is numbers) or `<l>` `<r>` `<c>` cookies or
 * `#+ATTR_LATEX: :align`; a float when the table has a caption or a name; and the `:environment`, `:float`, `:placement`,
 * `:center`, `:font`, `:booktabs`, `:width`, `:mode` and `:caption` attributes.
 */

import { parseAttributes } from './org-elements.js';
import { tableModel } from './table-model.js';

/** @typedef {import('./org-elements.js').OrgElement} OrgElement */
/** @typedef {Extract<OrgElement, { type: 'table' }>} TableElement */
/** @typedef {{ cell: (text: string) => string, caption: { short: string | null, text: string } | null, label: string, vars?: import('./latex-config.js').LatexVars }} TableContext */

const NO_SPEC_ENV_RE = /matrix$/;
const WIDTH_ENVS = new Set(['tabularx', 'tabulary', 'tabular*']);

/**
 * @param {TableElement} el
 * @param {TableContext} ctx
 */
export function latexTable(el, ctx) {
  const attrs = parseAttributes(el.aff && el.aff.attr.latex);
  const model = tableModel(el.rows);
  const kept = /** @type {(string[] | null)[]} */ (model.rows.flatMap((r, i) => (r.rule ? [null] : model.specials[i] ? [] : [r.cells.slice(model.offset)])));
  const firstRow = model.firstIndex >= 0 ? model.rows[model.firstIndex] : null;
  const width = firstRow ? firstRow.cells.length - model.offset : 0;
  const vars = ctx.vars;
  const mode = attrs.mode || (vars ? vars.tableMode : '') || ''; // :mode, else org-latex-default-table-mode
  const math = mode === 'math' || mode === 'inline-math';
  const env = attrs.environment || (vars ? vars.tableEnvironment : 'tabular');
  let spec = attrs.align || '';
  if (!spec) {
    // org-latex--align-string: the first row gives the columns; a left border only before the first one
    for (let c = 0; c < width; c++) {
      const column = c + model.offset;
      if (c === 0 && model.leftBorder(column)) spec += '|';
      spec += math ? 'c' : model.alignment(column)[0];
      if (model.rightBorder(column)) spec += '|';
    }
  }

  const row = (/** @type {string[]} */ cells) => (math ? ' ' + cells.map(ctx.cell).join(' & ') + ' \\\\[0pt]' : cells.map(ctx.cell).join(' & ') + '\\\\[0pt]');
  const booktabs = !math && (attrs.booktabs === undefined ? !!(vars && vars.tablesBooktabs) : attrs.booktabs === 't');
  const rule = (/** @type {number} */ index) => (booktabs ? (index === 0 ? '\\toprule' : index === kept.length - 1 ? '\\bottomrule' : '\\midrule') : '\\hline');
  if (env === 'longtable') return longtable(kept, spec, width, ctx, attrs, row, rule, booktabs);

  /** @type {string[]} */
  const body = [];
  if (booktabs && kept[0] !== null) body.push('\\toprule');
  // in a math table a rule and the row after it share a line
  kept.forEach((cells, i) => (cells === null ? body.push(rule(i)) : kept[i - 1] === null && math && body.length ? (body[body.length - 1] += row(cells)) : body.push(row(cells))));
  if (booktabs && kept[kept.length - 1] !== null) body.push('\\bottomrule');

  const widthArg = WIDTH_ENVS.has(env) && attrs.width ? '{' + attrs.width + '}' : '';
  // the column spec is left out for the matrix environments and, in a math table, for the ones that take a width
  const open = '\\begin{' + env + '}' + (math && WIDTH_ENVS.has(env) ? '' : widthArg + (NO_SPEC_ENV_RE.test(env) ? '' : '{' + spec + '}'));
  const tabular = open + '\n' + body.join('\n') + (body.length ? '\n' : '') + '\\end{' + env + '}';
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
