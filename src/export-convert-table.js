// @ts-check
/**
 * `orgtbl-to-generic` and the converters built on it (`orgtbl-to-csv`, `-tsv`, `-latex`, `-html`, `-orgtbl`, `-unicode`), after
 * org-table.el: the table is written back as Org syntax and read again (so a cell holding "|" or a line break splits as it does
 * in Emacs), its first `:skip` rows and `:skipcols` columns are dropped, and every row and cell is transcoded by the parameters
 * (`:lstart`, `:fmt`, `:sep`, ...) and, where none applies, by the back end named in `:backend` (org when none).
 */
import { Cons, NIL, T, bool, intern, list, print, signal, toArray, unbox, isStr, wrongType } from './elisp-data.js';
import { tableModel } from './table-model.js';
import { layoutTable } from './org-table-layout.js';
import { NUMBER_RE } from './table-number.js';
import { parseOrg } from './org-parser.js';
import { exportHtmlObjects } from './export-html.js';
import { exportLatexObjects } from './export-latex.js';
import { exportToAscii, normalizeAsciiCharset } from './export-ascii.js';
import { applyParameter, backendName, checkParameter, normalizeString, nonBlank, pget, pmember, text, trim, userError, isFunction } from './export-convert-lisp.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */
/** @typedef {{ rule: boolean, cells: string[] }} Row */

const EXPONENT = /^([-+]?[0-9][0-9.]*)[eE]([-+]?[0-9]+)$/; // orgtbl-exp-regexp

/**
 * `org-table-to-lisp` on a text: a list whose items are the symbol `hline` or the list of a row's fields.
 * @param {string} source
 * @returns {LObj}
 */
export function tableTextToLisp(source) {
  const lines = source.split('\n');
  /** @type {LObj[]} */
  const out = [];
  for (const line of lines) {
    const m = /^[ \t]*\|/.exec(line);
    if (!m) break;
    const rest = line.slice(m[0].length);
    if (rest.startsWith('-')) {
      out.push(intern('hline'));
      continue;
    }
    /** @type {LObj[]} */
    const cells = [];
    let at = 0;
    while (true) {
      while (rest[at] === ' ' || rest[at] === '\t') at++;
      if (at >= rest.length) break;
      const end = /[ \t]*(\||$)/.exec(rest.slice(at));
      const stop = at + /** @type {RegExpExecArray} */ (end).index;
      cells.push(rest.slice(at, stop));
      at = stop + /** @type {RegExpExecArray} */ (end)[0].length;
    }
    out.push(list(cells));
  }
  return list(out);
}

/** `org-table-collapse-header`. @param {LObj} table @param {LObj} separator @param {LObj} maxHeaderLines @returns {LObj} */
export function collapseHeader(table, separator, maxHeaderLines) {
  const hline = intern('hline');
  const items = toArray(table);
  while (items.length && items[0] === hline) items.shift();
  const sep = separator === NIL ? ' ' : text(separator);
  const max = maxHeaderLines === NIL ? 4 : Number(maxHeaderLines);
  const at = items.indexOf(hline);
  const headerLines = at < 0 ? items : items.slice(0, at);
  const trailer = at < 0 ? [] : items.slice(at);
  if (trailer.length && headerLines.length <= max) {
    const rows = headerLines.map((r) => toArray(r));
    const width = Math.min(...rows.map((r) => r.length));
    const merged = [];
    for (let i = 0; i < (rows.length ? width : 0); i++) merged.push(trim(rows.map((r) => text(r[i])).join(sep)));
    return list([list(merged), ...trailer]);
  }
  return list(items);
}

/** The rows of the first table in a text, as Org's parser reads them. @param {string} source @returns {Row[] | null} */
function parseRows(source) {
  const lines = source.split('\n');
  const first = lines.findIndex((l) => /^[ \t]*\|/.test(l));
  if (first < 0) return null;
  /** @type {Row[]} */
  const rows = [];
  for (let i = first; i < lines.length && /^[ \t]*\|/.test(lines[i]); i++) {
    const body = lines[i].replace(/^[ \t]*\|/, '');
    if (body.startsWith('-')) rows.push({ rule: true, cells: [] });
    else rows.push({ rule: false, cells: (body.endsWith('|') ? body.slice(0, -1) : body).split('|').map((c) => c.trim()) });
  }
  return rows;
}

/** Aligns the table a text starts with, as `org-table-align` does in a buffer where point is at the start. @param {string} source */
function alignTable(source) {
  const lines = source.split('\n');
  let end = 0;
  while (end < lines.length && /^[ \t]*\|/.test(lines[end])) end++;
  if (!end) return source;
  const rows = lines.slice(0, end).map((l) => {
    const body = l.replace(/^[ \t]*\|/, '');
    return body.startsWith('-') ? null : (body.endsWith('|') ? body.slice(0, -1) : body).split('|').map((c) => c.trim());
  });
  return [...layoutTable(rows), ...lines.slice(end)].join('\n');
}

const EMPTY_DOC = () => parseOrg('');

/**
 * The elements of a table seen the way a transcoder sees them: the rows left after the special ones are set aside, their groups,
 * header and borders.
 * @param {Row[]} rows @param {(text: string) => string} objects  how the back end writes a cell's text (a column's alignment is read from it)
 */
function structure(rows, objects) {
  const model = tableModel(rows);
  const shown = rows.map((_, i) => !model.specials[i]);
  const visible = rows.map((_, i) => i).filter((i) => shown[i]);
  const offset = model.specialColumn ? 1 : 0;
  /** @type {Map<number, number>} */
  const groupOf = new Map();
  let group = 0;
  let flag = false;
  for (const i of visible) {
    if (rows[i].rule) flag = false;
    else {
      if (!flag) { group++; flag = true; }
      groupOf.set(i, group);
    }
  }
  // org-export-table-has-header-p
  let hasHeader = false;
  {
    let rowgroup = 1;
    let seen = false;
    for (const i of visible) {
      if (rowgroup > 1) { hasHeader = true; break; }
      if (seen && rows[i].rule) { rowgroup++; seen = false; } else if (!seen && !rows[i].rule) seen = true;
    }
  }
  /** @param {number} i */
  const inHeader = (i) => hasHeader && groupOf.get(i) === 1;
  /** A rule between this row and the nearest standard row on that side, or no such row. @param {number} i @param {number} dir */
  const edge = (i, dir) => {
    let rule = false;
    for (let j = visible.indexOf(i) + dir; j >= 0 && j < visible.length; j += dir) {
      if (rows[visible[j]].rule) rule = true;
      else return rule;
    }
    return true;
  };
  /** @type {Map<number, 'left' | 'right' | 'center'>} */
  const aligned = new Map();
  /** org-export-table-cell-alignment: the last cookie of a special row, else the share of numbers among the cells as the back end writes them. @param {number} column */
  const align = (column) => {
    const known = aligned.get(column);
    if (known) return known;
    let numbers = 0;
    let total = 0;
    /** @type {string | undefined} */
    let cookie;
    let previousNumber = false;
    rows.forEach((r, i) => {
      if (model.specials[i]) {
        const m = /^<([lrc])?(\d+)?>$/.exec(r.cells[column] || '');
        if (m && m[1]) cookie = m[1];
      } else if (!r.rule && !cookie) {
        const v = objects(r.cells[column] || '');
        total++;
        if (NUMBER_RE.test(v) || (v === '' && previousNumber)) { previousNumber = true; numbers++; } else previousNumber = false;
      }
    });
    const result = cookie === 'l' ? 'left' : cookie === 'r' ? 'right' : cookie === 'c' ? 'center' : total && numbers / total >= 0.5 ? 'right' : 'left';
    aligned.set(column, result);
    return result;
  };
  return {
    model, align, shown, visible, offset, hasHeader, inHeader,
    group: (/** @type {number} */ i) => groupOf.get(i) ?? null,
    startsGroup: (/** @type {number} */ i) => !rows[i].rule && edge(i, -1),
    endsGroup: (/** @type {number} */ i) => !rows[i].rule && edge(i, 1),
    hasNext: (/** @type {number} */ i) => visible.indexOf(i) < visible.length - 1,
    hasPrevious: (/** @type {number} */ i) => visible.indexOf(i) > 0,
    columns: Math.max(0, ...visible.filter((i) => !rows[i].rule).map((i) => rows[i].cells.length - offset)),
  };
}

/** @typedef {ReturnType<typeof structure>} Structure */

/**
 * @typedef {object} Backend  how a back end writes the pieces of a table that no parameter writes
 * @property {(text: string) => string} objects  a cell's text as the back end writes objects
 * @property {(row: number, column: number, contents: string | null, next: boolean) => string} cell
 * @property {(row: number, contents: string) => string | null} row  a standard row
 * @property {(row: number) => string | null} rule
 * @property {(contents: string | null) => string} table
 */

/** @param {LObj} params @param {Row[]} rows @param {Structure} st @returns {Backend} */
function orgBackend(params, rows, st) {
  void params; void st;
  return {
    objects: (t) => t,
    cell: (_i, _k, contents) => ' ' + (contents ?? '') + ' |',
    row: (_i, contents) => '|' + contents,
    rule: () => '|-',
    table: (contents) => {
      if (contents === null) throw wrongType('char-or-string-p', NIL);
      if (contents === '') throw signal('search-failed', ['|']);
      return alignTable(contents);
    },
  };
}

/** @param {string} s */
const encodeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** @param {LObj} params @param {Row[]} rows @param {Structure} st @param {boolean} attributesParameter @returns {Backend} */
function htmlBackend(params, rows, st, attributesParameter) {
  const doc = EMPTY_DOC();
  const { model } = st;
  return {
    objects: (t) => exportHtmlObjects(doc, t),
    cell: (i, k, contents) => {
      const body = contents === null || trim(contents) === '' ? '&#xa0;' : contents;
      const attrs = ` class="org-${st.align(st.offset + k)}"`;
      return st.hasHeader && st.group(i) === 1 ? `\n<th scope="col"${attrs}>${body}</th>` : `\n<td${attrs}>${body}</td>`;
    },
    row: (i, contents) => {
      const tags = st.group(i) !== 1 ? ['<tbody>', '\n</tbody>'] : st.hasHeader ? ['<thead>', '\n</thead>'] : ['<tbody>', '\n</tbody>'];
      return (st.startsGroup(i) ? tags[0] : '') + '\n<tr>' + contents + '\n</tr>' + (st.endsGroup(i) ? tags[1] : '');
    },
    rule: () => null,
    table: (contents) => {
      /** @type {[string, string][]} */
      let attributes = [['id', ''], ['border', '2'], ['cellspacing', '0'], ['cellpadding', '6'], ['rules', 'groups'], ['frame', 'hsides']];
      if (attributesParameter || pmember(params, ':html-table-attributes')) {
        const given = pget(params, attributesParameter ? ':attributes' : ':html-table-attributes');
        attributes = [['id', '']];
        const items = toArray(given);
        for (let p = 0; p + 1 < items.length; p += 2) {
          const key = String(/** @type {{ name: string }} */ (items[p]).name).replace(/^:/, '');
          const at = attributes.findIndex(([a]) => a === key);
          const value = items[p + 1] === NIL ? '' : text(items[p + 1]);
          if (at >= 0) attributes[at] = [key, value];
          else attributes.push([key, value]);
        }
      }
      const attrText = attributes.filter(([, v]) => v !== '').map(([k, v]) => `${k}="${encodeHtml(v).replace(/"/g, '&quot;')}"`).join(' ');
      const first = st.visible.find((i) => !rows[i].rule);
      const specs = first === undefined ? [] : rows[first].cells.slice(st.offset).map((_, k) => {
        const c = st.offset + k;
        const starts = k === 0 || model.leftBorder(c);
        const ends = k === rows[first].cells.length - st.offset - 1 || model.rightBorder(c);
        return (starts ? '\n<colgroup>' : '') + `\n<col  class="org-${st.align(c)}" />` + (ends ? '\n</colgroup>' : '');
      });
      return `<table${attrText ? ' ' + attrText : ''}>\n\n${specs.join('\n')}\n${contents ?? 'nil'}</table>`;
    },
  };
}

/** @param {LObj} params @param {Row[]} rows @param {Structure} st @returns {Backend} */
function latexBackend(params, rows, st) {
  const doc = EMPTY_DOC();
  const { model } = st;
  const envValue = pget(params, ':latex-default-table-environment');
  const environment = envValue === NIL ? 'tabular' : text(envValue);
  const booktabs = pget(params, ':latex-tables-booktabs') !== NIL;
  const centered = pmember(params, ':latex-tables-centered') ? pget(params, ':latex-tables-centered') !== NIL : true;
  const scientific = pget(params, ':latex-table-scientific-notation');
  const mode = pget(params, ':latex-default-table-mode');
  if (mode !== NIL && !(typeof mode === 'object' && 'name' in mode && mode.name === 'table')) throw userError('Only the table mode of LaTeX tables is available to the converters of this app');
  const longtable = environment === 'longtable' || environment === 'longtabu';
  const lineBreak = '\\\\[0pt]';
  return {
    objects: (t) => exportLatexObjects(doc, t),
    cell: (_i, _k, contents, next) => {
      const m = contents !== null && scientific !== NIL ? EXPONENT.exec(contents) : null;
      const body = m ? text(applyParameter(scientific, ':latex-table-scientific-notation', false, [m[1], m[2]])) : contents ?? '';
      return body + (next ? ' & ' : '');
    },
    row: (i, contents) => {
      const endsHeader = st.inHeader(i) && st.endsGroup(i);
      const top = booktabs && !st.hasPrevious(i) ? '\\toprule\n' : '';
      let tail = '';
      if (longtable && endsHeader) tail = headerFooter(contents, st, booktabs, st.inHeader(i) && st.startsGroup(i));
      else if (booktabs && !st.hasNext(i)) tail = '\\bottomrule';
      return top + contents + lineBreak + '\n' + tail;
    },
    rule: (i) => {
      if (!booktabs) return '\\hline';
      if (!st.hasPrevious(i)) return '\\toprule';
      if (!st.hasNext(i)) return '\\bottomrule';
      const previous = st.visible[st.visible.indexOf(i) - 1];
      if (longtable && st.inHeader(previous) && st.endsGroup(previous)) return '';
      return '\\midrule';
    },
    table: (contents) => {
      const first = st.visible.find((i) => !rows[i].rule);
      let align = '';
      if (first !== undefined) {
        rows[first].cells.slice(st.offset).forEach((_, k) => {
          const c = st.offset + k;
          if (k === 0 && model.leftBorder(c)) align += '|';
          align += { left: 'l', right: 'r', center: 'c' }[st.align(c)];
          if (model.rightBorder(c)) align += '|';
        });
      }
      if (longtable) return `\\begin{${environment}}{${align}}\n${contents ?? 'nil'}\\end{${environment}}`;
      const output = `\\begin{${environment}}{${align}}\n${contents ?? 'nil'}\\end{${environment}}`;
      return centered ? `\\begin{center}\n${output}\n\\end{center}` : output;
    },
  };
}

/** The lines a LaTeX long table writes after its header: what repeats on each page. @param {string} contents @param {Structure} st @param {boolean} booktabs @param {boolean} startsHeader */
function headerFooter(contents, st, booktabs, startsHeader) {
  const rule = booktabs ? '\\midrule' : '\\hline';
  const start = startsHeader ? (booktabs ? '\\toprule\n' : '\\hline\n') : '';
  return `${rule}\n\\endfirsthead\n\\multicolumn{${st.columns}}{l}{Continued from previous page} \\\\[0pt]\n${start}\n${contents} \\\\[0pt]\n\n${rule}\n\\endhead\n${rule}\\multicolumn{${st.columns}}{r}{Continued on next page} \\\\\n\\endfoot\n\\endlastfoot`;
}

/**
 * `orgtbl-to-generic`.
 * @param {LObj} table  the rows: the symbol `hline` or a list of fields
 * @param {LObj} params  a property list
 * @returns {string}
 */
export function tableToGeneric(table, params) {
  const P = (/** @type {string} */ k) => pget(params, k);
  const backend = P(':backend');
  const splice = P(':splice') !== NIL;
  const tstart = P(':tstart');
  const tend = P(':tend');
  const raw = P(':raw') !== NIL;
  const [hllfmt, hlfmt, llfmt, lfmt, hllstart, hllend, hlstart, hlend, llstart, llend, lstart, lend] = [':hllfmt', ':hlfmt', ':llfmt', ':lfmt', ':hllstart', ':hllend', ':hlstart', ':hlend', ':llstart', ':llend', ':lstart', ':lend'].map(P);
  const [efmt, fmt, hfmt, sep, hsep] = [':efmt', ':fmt', ':hfmt', ':sep', ':hsep'].map(P);
  // Org checks the parameters while it builds the transcoders
  if (tstart !== NIL && !splice) checkParameter(tstart, ':tstart');
  if (!splice) checkParameter(tend, ':tend');
  if (pmember(params, ':hline')) checkParameter(P(':hline'), ':hline');
  for (const [v, n] of /** @type {[LObj, string][]} */ ([[hllfmt, ':hllfmt'], [hlfmt, ':hlfmt'], [llfmt, ':llfmt'], [lfmt, ':lfmt']])) checkParameter(v, n);
  if (lfmt === NIL) {
    if (hllstart !== NIL || hllend !== NIL) { checkParameter(hllstart, ':hllstart'); checkParameter(hllend, ':hllend'); }
    if (hlstart !== NIL || hlend !== NIL) { checkParameter(hlstart, ':hlstart'); checkParameter(hlend, ':hlend'); }
    if (llstart !== NIL || llend !== NIL) { checkParameter(llstart, ':llstart'); checkParameter(llend, ':llend'); }
    if (lstart !== NIL || lend !== NIL) { checkParameter(lstart, ':lstart'); checkParameter(lend, ':lend'); }
  }
  for (const [v, n] of /** @type {[LObj, string][]} */ ([[efmt, ':efmt'], [hfmt, ':hfmt'], [fmt, ':fmt']])) checkParameter(v, n, true);
  const name = backendName(backend);

  // the table, written as Org syntax and read again
  let source = '';
  for (const e of toArray(table)) {
    if (e === intern('hline')) source += '|--\n';
    else if (e instanceof Cons) source += '| ' + toArray(e).map((c) => (isStr(c) ? String(unbox(c)) : print(c, false)) + ' |').join('') + '\n';
  }
  let rows = parseRows(source);
  const skip = P(':skip');
  if (skip !== NIL) {
    if (typeof skip !== 'number' || skip < 0) throw userError('Wrong :skip value');
    if (rows) rows = rows.slice(skip);
  }
  const skipcols = P(':skipcols');
  if (skipcols !== NIL) {
    if (!(skipcols instanceof Cons)) throw userError('Wrong :skipcols value');
    if (rows) {
      const offset = tableModel(rows).specialColumn ? 1 : 0;
      const dropped = toArray(skipcols);
      rows = rows.map((r) => (r.rule ? r : { rule: false, cells: r.cells.filter((_, k) => k < offset || !dropped.includes(k - offset + 1)) }));
    }
  }
  if (!rows) return '';
  if (name === 'ascii') return asciiTable(rows, params, [tstart, tend, lstart, lend, llstart, llend, hlstart, hlend, hllstart, hllend, lfmt, llfmt, hlfmt, hllfmt, fmt, efmt, hfmt, sep, hsep], splice, P(':hline'), pmember(params, ':hline'));
  const objectsOf = name === 'html' ? (/** @type {string} */ t) => exportHtmlObjects(EMPTY_DOC(), t) : name === 'latex' ? (/** @type {string} */ t) => exportLatexObjects(EMPTY_DOC(), t) : (/** @type {string} */ t) => t;
  const st = structure(rows, objectsOf);
  const B = name === 'html' ? htmlBackend(params, rows, st, pmember(params, ':attributes')) : name === 'latex' ? latexBackend(params, rows, st) : orgBackend(params, rows, st);

  /** The contents of a cell as the back end gives them; null when the cell is empty. @param {string} cellText */
  const contentsOf = (cellText) => (name && raw ? cellText.replace(/\n/g, ' ') : cellText === '' ? null : B.objects(cellText));

  /** @param {number} i @param {number} k @param {boolean} ignoreSep @returns {string | null} */
  const cellOut = (i, k, ignoreSep) => {
    const cellText = rows[i].cells[st.offset + k];
    let contents = contentsOf(cellText);
    const headerp = (hfmt !== NIL || hsep !== NIL) && st.inHeader(i);
    const column = k + 1;
    if (contents !== null) {
      const m = efmt !== NIL ? EXPONENT.exec(contents) : null;
      if (m) contents = nullable(applyParameter(efmt, ':efmt', true, [m[1], m[2]], column, contents));
      if (contents !== null) {
        if (hfmt !== NIL && headerp) contents = nullable(applyParameter(hfmt, ':hfmt', true, [contents], column, contents));
        else if (fmt !== NIL) contents = nullable(applyParameter(fmt, ':fmt', true, [contents], column, contents));
      }
    }
    const next = k < rows[i].cells.length - st.offset - 1;
    if (sep !== NIL || hsep !== NIL) {
      if ((sep === NIL && !headerp) || ignoreSep || !next) return name ? B.cell(i, k, contents, next) : contents;
      return (contents ?? '') + text(sep !== NIL && hsep !== NIL ? (headerp ? hsep : sep) : hsep !== NIL ? hsep : sep);
    }
    return name ? B.cell(i, k, contents, next) : contents;
  };

  /** @param {number} i @returns {string | null} */
  const rowOut = (i) => {
    const r = rows[i];
    if (r.rule) {
      if (pmember(params, ':hline')) return nullable(applyParameter(P(':hline'), ':hline', false, []));
      return name ? B.rule(i) : null;
    }
    if (r.cells.length === 0) return null; // a row with no cell left (after :skipcols) has no contents
    const count = r.cells.length - st.offset;
    const cellsOut = (/** @type {boolean} */ ignoreSep) => Array.from({ length: count }, (_, k) => cellOut(i, k, ignoreSep));
    const contents = cellsOut(false).map((c) => c ?? '').join('');
    const headerp = (hlfmt !== NIL || hlstart !== NIL || hlend !== NIL) && st.inHeader(i);
    const lastHeader = (hllfmt !== NIL || hllstart !== NIL || hllend !== NIL) && st.inHeader(i) && st.endsGroup(i);
    const lastp = !st.hasNext(i);
    const cells = () => list(cellsOut(true).map((c) => c ?? ''));
    /** @param {LObj} f @param {string} n */
    const formatted = (f, n) => nullable(applyParameter(f, n, false, [cells()], 0, NIL, true));
    if (lastHeader && hllfmt !== NIL) return formatted(hllfmt, ':hllfmt');
    if (headerp && hlfmt !== NIL) return formatted(hlfmt, ':hlfmt');
    if (lastp && llfmt !== NIL) return formatted(llfmt, ':llfmt');
    if (lfmt !== NIL) return formatted(lfmt, ':lfmt');
    /** @param {LObj} a @param {string} an @param {LObj} b @param {string} bn */
    const wrapped = (a, an, b, bn) => text(applyParameter(a, an, false, [])) + contents + text(applyParameter(b, bn, false, []));
    if (lastHeader && (hllstart !== NIL || hllend !== NIL)) return wrapped(hllstart, ':hllstart', hllend, ':hllend');
    if (headerp && (hlstart !== NIL || hlend !== NIL)) return wrapped(hlstart, ':hlstart', hlend, ':hlend');
    if (lastp && (llstart !== NIL || llend !== NIL)) return wrapped(llstart, ':llstart', llend, ':llend');
    if (lstart !== NIL || lend !== NIL) return wrapped(lstart, ':lstart', lend, ':lend');
    return name ? B.row(i, contents) : contents;
  };

  let body = '';
  for (const i of st.visible) body += normalizeString(rowOut(i) ?? '');
  const empty = rows.length === 0;
  const contents = empty ? null : normalizeString(body);
  let output;
  if (name && !(tstart !== NIL || tend !== NIL || splice)) output = B.table(contents);
  else output = (tstart !== NIL && !splice ? text(applyParameter(tstart, ':tstart', false, [])) + '\n' : '') + (contents ?? '') + (splice ? '' : text(applyParameter(tend, ':tend', false, [])));
  output = normalizeString(output);
  return nonBlank(output) ? output.slice(0, -1) : '';
}

/** @param {LObj} x @returns {string | null} */
function nullable(x) {
  return x === NIL ? null : text(x);
}

/**
 * A table written by the ASCII back end: the whole table, as `org-ascii-table` writes it. Parameters that would write a row or a
 * cell differently are refused (the back end's own row and cell writers are not available one by one).
 * @param {Row[]} rows @param {LObj} params @param {LObj[]} overriding @param {boolean} splice @param {LObj} hline @param {boolean} hasHline
 */
function asciiTable(rows, params, overriding, splice, hline, hasHline) {
  if (splice || hasHline || overriding.some((v) => v !== NIL)) throw userError('The ascii back end writes a whole table: row, cell and table parameters cannot be combined with it');
  const charset = pget(params, ':ascii-charset');
  const widen = pmember(params, ':ascii-table-widen-columns') ? pget(params, ':ascii-table-widen-columns') !== NIL : true;
  const kept = rows.filter((r) => r.rule || r.cells.length);
  if (!kept.some((r) => !r.rule)) return '';
  const source = kept.map((r) => (r.rule ? '|-' : '| ' + r.cells.join(' | ') + ' |')).join('\n') + '\n';
  const body = exportToAscii(parseOrg(source), null, 72, { charset: charset === NIL ? 'ascii' : normalizeAsciiCharset(String(/** @type {{ name: string }} */ (charset).name)), bodyOnly: true, widenColumns: widen, sectionNotes: false });
  const output = normalizeString(body);
  return nonBlank(output) ? output.slice(0, -1) : '';
}

export { T, bool, isFunction };
