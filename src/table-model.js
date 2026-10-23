// @ts-check
/**
 * How ox.el reads an Org table, shared by the exporters: which rows and which column are special (`/ # ! $ * _ ^`, cookie rows), the
 * header, the row groups, the alignment of a column and the borders the column-group row (`/ < > <>`) draws. Cells are compared as
 * their raw text, which is what ox.el compares for these rules.
 */

import { NUMBER_RE } from './table-number.js';

/** @typedef {{ rule: boolean, cells: string[] }} ModelRow */

const COOKIE = /^<[lrc]?\d*>$/;

/**
 * @param {readonly { rule?: boolean, cells?: readonly string[] }[]} source the rows of a table element
 */
export function tableModel(source) {
  /** @type {ModelRow[]} */
  const rows = source.map((r) => ({ rule: !!r.rule, cells: /** @type {string[]} */ ((r.cells || []).map((c) => c.trim())) }));
  /** @param {ModelRow} r */
  const first = (r) => (r.cells.length ? r.cells[0] : '');
  // org-export-table-has-special-column-p: every first cell is empty or a marker, and one of them is a marker
  let marked = false;
  let specialColumn = true;
  for (const r of rows) {
    if (r.rule) continue;
    const v = first(r);
    if (/^[/#!$*_^]$/.test(v)) marked = true;
    else if (v !== '') { specialColumn = false; break; }
  }
  specialColumn = specialColumn && marked;
  /** org-export-table-row-is-special-p @param {ModelRow} r */
  const special = (r) => {
    if (r.rule) return false;
    const v = first(r);
    if (v === '/') return true;
    if (specialColumn && /^[\^_$!]$/.test(v)) return true;
    let cookie = false;
    for (const t of r.cells) {
      if (t === '') continue;
      if (COOKIE.test(t)) cookie = true;
      else return false;
    }
    return cookie;
  };
  const specials = rows.map(special);
  const offset = specialColumn ? 1 : 0;

  // org-export-table-has-header-p: at least two row groups
  let hasHeader = false;
  {
    let group = 1;
    let flag = false;
    for (const r of rows) {
      if (group > 1) { hasHeader = true; break; }
      if (flag && r.rule) { group++; flag = false; } else if (!flag && !r.rule) flag = true;
    }
  }
  // org-export-table-row-group
  /** @type {number[]} */ const groupOf = [];
  {
    let group = 0;
    let flag = false;
    rows.forEach((r, i) => {
      if (r.rule) flag = false;
      else {
        if (!flag) { group++; flag = true; }
        groupOf[i] = group;
      }
    });
  }

  /** @typedef {'left' | 'right' | 'center'} Align */
  /** @type {(Align | undefined)[]} */ const cache = [];
  /** org-export-table-cell-alignment: the last cookie of a special row, else the share of numbers @param {number} column @returns {"left" | "right" | "center"} */
  const alignment = (column) => {
    const cached = cache[column];
    if (cached) return cached;
    let numbers = 0;
    let total = 0;
    /** @type {string | undefined} */ let cookie;
    let previousNumber = false;
    rows.forEach((r, i) => {
      if (specials[i]) {
        const m = /^<([lrc])?(\d+)?>$/.exec(r.cells[column] || '');
        if (m && m[1]) cookie = m[1];
      } else if (!r.rule && !cookie) {
        const v = r.cells[column] || '';
        total++;
        if (NUMBER_RE.test(v) || (v === '' && previousNumber)) { previousNumber = true; numbers++; } else previousNumber = false;
      }
    });
    /** @type {Align} */
    const result = cookie === 'l' ? 'left' : cookie === 'r' ? 'right' : cookie === 'c' ? 'center' : total && numbers / total >= 0.5 ? 'right' : 'left';
    return (cache[column] = result);
  };

  // org-export-table-cell-borders, the left and right ones: the last row starting with "/" holds the column groups
  /** @type {(string | null)[] | null} */ let groups = null;
  for (let i = rows.length - 1; i >= 0 && !groups; i--) {
    if (!rows[i].rule && first(rows[i]) === '/') groups = rows[i].cells.map((c) => (['<', '<>', '>', ''].includes(c) ? c : null));
  }
  const g = (/** @type {number} */ c) => (groups && groups[c]) || '';
  /** @param {number} c */
  const leftBorder = (c) => !!groups && ((c > 0 && ['>', '<>'].includes(g(c - 1))) || ['<', '<>'].includes(g(c)));
  /** @param {number} c */
  const rightBorder = (c) => !!groups && ((c + 1 < groups.length && ['<', '<>'].includes(g(c + 1))) || ['>', '<>'].includes(g(c)));

  // the first row that is neither a rule nor special: its cells give the columns
  const firstIndex = rows.findIndex((r, i) => !r.rule && !specials[i]);
  return { rows, specials, specialColumn, offset, hasHeader, groupOf, alignment, leftBorder, rightBorder, firstIndex };
}
