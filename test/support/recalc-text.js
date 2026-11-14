// Recalculates every table of an org text the way Emacs's org-table-recalculate-buffer-tables does, for the tests that hold the formula engine to Emacs.
import { recalculateTable, parseTableConstants, parseNamedTables } from '../../src/table-formula.js';
import { parseOrg } from '../../src/org-parser.js';
import { inheritedProperty } from '../../src/babel-args.js';

const cellsOf = (/** @type {string} */ line) => line.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim());

/** The cells of the tables in `text`, a hline as '---' and the cells of a row joined with '|'. @param {string} text */
export const gridOf = (text) => text.split('\n').filter((l) => /^\s*\|/.test(l)).map((l) => (/^\s*\|-/.test(l) ? '---' : cellsOf(l).join('|')));

/** Every heading of the document in reading order, each with the headings above it (outermost first).
 * @param {any} doc @returns {any[][]} */
function headingChains(doc) {
  /** @type {any[][]} */ const out = [];
  const walk = (/** @type {any[]} */ nodes, /** @type {any[]} */ chain) => {
    for (const node of nodes || []) {
      if (node.type !== 'heading') continue;
      out.push([...chain, node]);
      walk(node.children, [...chain, node]);
    }
  };
  walk(doc.children, []);
  return out;
}

/** The text after every table recalculated with its first #+TBLFM line (the one at index `pick` when a table has several); the result as grid rows, or throws as the engine does.
 * @param {string} org @param {{ pick?: number, createColumns?: boolean | 'warn' | 'prompt', confirm?: (question: string) => boolean, warn?: (message: string) => void }} [options] @returns {string[]} */
export function recalcGrid(org, { pick = 0, createColumns = false, confirm, warn } = {}) {
  const lines = org.split('\n');
  const doc = parseOrg(org);
  const constants = parseTableConstants(doc);
  const tables = parseNamedTables(doc);
  const chains = headingChains(doc);
  /** @type {string[]} */ const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^\s*\|/.test(lines[i])) { i++; continue; }
    const start = i;
    while (i < lines.length && /^\s*\|/.test(lines[i])) i++;
    const rows = lines.slice(start, i).map((l) => (/^\s*\|-/.test(l) ? { type: 'rule' } : { type: 'row', cells: cellsOf(l) }));
    let t = i;
    while (t < lines.length && lines[t].trim() === '') t++; // Emacs finds the formulas after blank lines too
    let m = /^\s*#\+TBLFM:(.*)$/i.exec(lines[t] || '');
    if (m) {
      let end = t;
      while (end < lines.length && /^\s*#\+TBLFM:/i.test(lines[end])) end++;
      if (pick > 0 && t + pick < end) m = /^\s*#\+TBLFM:(.*)$/i.exec(lines[t + pick]);
      i = end;
    }
    if (!m) { out.push(...rows.map((r) => (r.type === 'rule' ? '---' : /** @type {any} */ (r).cells.join('|')))); continue; }
    const headings = lines.slice(0, start).filter((l) => /^\*+ /.test(l)).length;
    const chain = headings > 0 ? chains[headings - 1] : [];
    const properties = (/** @type {string} */ name) => inheritedProperty(doc, chain, name);
    const res = recalculateTable(/** @type {any} */ ({ tblfm: m[1].trim(), rows }), { constants, tables, properties, createColumns, confirm, warn });
    out.push(...(res || rows).map((r) => (r.type === 'rule' ? '---' : /** @type {any} */ (r).cells.join('|').split('|').map((/** @type {string} */ c) => c.trim()).join('|'))));
  }
  return out;
}
