// @ts-check
/**
 * `org-table-beginning-of-field` and `org-table-end-of-field` (what `M-a` and `M-e` call inside a table): the caret goes to the start or
 * end of the field, and from the edge of one to the next or previous field. Moving to another field aligns the table first
 * (`org-table-next-field`, `org-table-previous-field`), and the next field past the last row adds a row. Positions are 0-based.
 */
import { tableTab } from './table-tab.js';

/** @typedef {{ text: string, pos: number, error?: string }} Moved */

/** `line-end-position`. @param {string} t @param {number} p */
const eol = (t, p) => {
  const i = t.indexOf('\n', p);
  return i === -1 ? t.length : i;
};
/** `line-beginning-position`. @param {string} t @param {number} p */
const bol = (t, p) => t.lastIndexOf('\n', p - 1) + 1;

/** The last bar that ends at or before `before`, or -1 (`lastIndexOf` would read a negative index as 0). @param {string} t @param {number} before */
const lastBar = (t, before) => (before <= 0 ? -1 : t.lastIndexOf('|', before - 1));

/** The first line of the table the caret is in (`org-table-begin`). @param {string} t @param {number} p */
function tableBegin(t, p) {
  let b = bol(t, p);
  while (b > 0 && /^[ \t]*\|/.test(t.slice(bol(t, b - 1), eol(t, b - 1)))) b = bol(t, b - 1);
  return b;
}

/** `search-backward` of "|" with a bound: where the `count`th bar before `from` is, or -1. @param {string} t @param {number} from @param {number} bound @param {number} count */
function barBack(t, from, bound, count) {
  let at = from;
  for (let i = 0; i < count; i += 1) {
    at = lastBar(t, at);
    if (at === -1 || at < bound) return -1;
  }
  return at;
}

/** `org-table-previous-field`. @param {Moved} m @returns {Moved} */
function previousField(m) {
  const aligned = tableTab(m.text, m.pos, true);
  let { text: t, pos: p } = aligned ?? m;
  if (/^[ \t]*\|-/.test(t.slice(bol(t, p), eol(t, p)))) p = eol(t, p);
  const start = tableBegin(t, p);
  const origin = p;
  let at = barBack(t, p, start, 2);
  while (at !== -1 && /^\|(?:-|[ \t]*(?:\n|$))/.test(t.slice(at))) at = barBack(t, at, start, 1);
  if (at === -1) return { text: t, pos: origin, error: 'Cannot move to previous table field' };
  p = at;
  if (t[p] === '|') p += t[p + 1] === ' ' ? 2 : 1;
  return { text: t, pos: p };
}

/** @param {Moved} m @param {number} n @returns {Moved} */
export function tableBeginningOfField(m, n) {
  const pos = m.pos;
  let cur = m;
  for (let k = n; k > 1; k -= 1) {
    cur = previousField(cur);
    if (cur.error) return cur;
  }
  const t = cur.text;
  const bound = bol(t, Math.max(0, bol(t, cur.pos) - 1));
  const at = lastBar(t, cur.pos);
  if (at === -1 || at < bound) return { text: t, pos: cur.pos, error: 'No more table fields before the current' };
  let p = at + 1;
  if (t[p] === ' ') p += 1;
  if (p >= pos) return tableBeginningOfField({ text: t, pos: p }, 2);
  return { text: t, pos: p };
}

/** @param {Moved} m @param {number} n @returns {Moved} */
export function tableEndOfField(m, n) {
  const pos = m.pos;
  let { text: t, pos: p } = m;
  for (let k = n; k > 1; k -= 1) {
    const moved = tableTab(t, p);
    if (moved) ({ text: t, pos: p } = moved);
  }
  const end = eol(t, p);
  const bar = t.indexOf('|', p);
  if (bar !== -1 && bar < end) {
    p = bar;
    while (p > 0 && t[p - 1] === ' ') p -= 1;
    if (t[p - 1] === '|' && t[p] === ' ') p += 1;
  }
  if (p <= pos) return tableEndOfField({ text: t, pos: p }, 2);
  return { text: t, pos: p };
}
