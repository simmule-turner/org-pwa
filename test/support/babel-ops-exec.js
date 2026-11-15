// What the app does where Emacs's Babel commands run: the pipeline of src/babel-ops.js on a text with the point marked by U+2038, as
// tools/oracle-babel-ops.el does. Shared by test/oracle-babel-ops.test.js.
import { parseOrg, serializeOrg } from '../../src/org-parser.js';
import { collectDocumentBlocks } from '../../src/babel-blocks.js';
import { babelLibrary, lobIngest } from '../../src/babel-lob.js';
import { setBabelOptions } from '../../src/babel-options.js';
import { elementAt, executableElements, executeElement, moveToSrcBlock, removeResult, resultsPlace } from '../../src/babel-ops.js';
import { flatBodyNodes, parseBody } from '../../src/body-parser.js';
import { parseNamedTables, parseTableConstants, recalculateTable, setSbeHandler } from '../../src/table-formula.js';
import { sbeEvaluate } from '../../src/babel-sbe.js';
import { serializeTable } from '../../src/body-edit.js';

const MARK = '‸';

/** @param {any} doc @returns {Generator<any>} */
function* headings(doc) {
  for (const h of doc.children || []) yield* walk(h);
}
/** @param {any} h @returns {Generator<any>} */
function* walk(h) {
  yield h;
  for (const c of h.children || []) yield* walk(c);
}

/** @param {any} doc @param {any} target @returns {any[]} */
function ancestorsOf(doc, target) {
  /** @type {any[]} */ let found = [];
  /** @param {any} h @param {any[]} path */
  const visit = (h, path) => {
    if (h === target) found = [...path, h];
    for (const c of h.children || []) visit(c, [...path, h]);
  };
  for (const h of doc.children || []) visit(h, []);
  return found;
}

/**
 * The text after `op` at the marked point (a Lisp error of Emacs is an Error here).
 * @param {{ op: string, text: string, vars?: Record<string, string>, lob?: string[], arg?: number | null }} c
 */
export async function babelOp(c) {
  const optionVars = Object.fromEntries(Object.entries(c.vars || {}));
  setBabelOptions(optionVars);
  babelLibrary.clear();
  for (const t of c.lob || []) lobIngest(parseOrg(t));
  const doc = /** @type {any} */ (parseOrg(c.text));
  let heading = null;
  /** @type {{ line: number, col: number }} */ let point = { line: 0, col: 0 };
  for (const h of headings(doc)) {
    const at = h.bodyLines.findIndex((/** @type {string} */ l) => l.includes(MARK));
    if (at === -1) continue;
    heading = h;
    point = { line: at, col: h.bodyLines[at].indexOf(MARK) };
    h.bodyLines[at] = h.bodyLines[at].replace(MARK, '');
    h.body = parseBody(h.bodyLines);
  }
  if (c.op === 'sbe') {
    setSbeHandler((args) => sbeEvaluate(doc, args));
    for (const h of headings(doc)) {
      for (const table of flatBodyNodes(h.body || []).filter((n) => n.type === 'table' && n.tblfm)) {
        const rows = recalculateTable(table, { constants: parseTableConstants(doc), tables: parseNamedTables(doc) });
        if (!rows) continue;
        table.rows = rows;
        h.bodyLines.splice(table.lineIndex, table.lineCount, ...serializeTable(table));
        h.body = parseBody(h.bodyLines);
      }
    }
    return serializeOrg(doc) + '';
  }
  if (!heading && c.op !== 'buffer') throw new Error('the point is in no section');
  const env = () => ({ doc, all: collectDocumentBlocks(doc), ancestors: ancestorsOf(doc, heading), lines: heading.bodyLines });
  const put = (/** @type {{ start: number, removeCount: number, insert: string[] }} */ edit) => {
    heading.bodyLines.splice(edit.start, edit.removeCount, ...edit.insert);
    if (point.line >= edit.start + edit.removeCount && edit.removeCount !== edit.insert.length && !(edit.removeCount > 0)) point = { ...point, line: point.line + edit.insert.length - edit.removeCount };
    heading.body = parseBody(heading.bodyLines);
  };
  if (c.op === 'maybe' || c.op === 'src') {
    const element = elementAt(heading.bodyLines, point);
    if (!element) throw new Error('not on anything executable');
    const edit = await executeElement(env(), element);
    if (edit) put(edit);
  } else if (c.op === 'where' || c.op === 'remove') {
    const element = elementAt(heading.bodyLines, point);
    if (!element) {
      if (c.op === 'where') throw new Error('no result');
      return c.text;
    }
    const name = element.type === 'src-block' ? element.scan.name : null;
    if (c.op === 'where') {
      const at = resultsPlace(heading.bodyLines, element, name);
      if (!at) throw new Error('no result');
      point = at;
    } else {
      const edit = removeResult(heading.bodyLines, element, name);
      if (edit) put(edit);
    }
  } else if (c.op === 'buffer' || c.op === 'subtree') {
    const scope = c.op === 'subtree' ? [...walk(heading)] : [...headings(doc)];
    const unmarked = !heading;
    for (const h of scope) {
      for (let k = 0; ; k++) {
        const found = executableElements(h.bodyLines);
        if (k >= found.length) break;
        const hEnv = { doc, all: collectDocumentBlocks(doc), ancestors: ancestorsOf(doc, h), lines: h.bodyLines };
        const edit = await executeElement(hEnv, found[k].element);
        if (edit) {
          h.bodyLines.splice(edit.start, edit.removeCount, ...edit.insert);
          h.body = parseBody(h.bodyLines);
        }
      }
    }
    if (unmarked) return MARK + serializeOrg(doc);
  } else if (c.op === 'next' || c.op === 'previous') {
    const to = moveToSrcBlock(doc, { heading, line: point.line }, c.arg ?? 1, c.op === 'previous');
    heading = to.heading;
    point = { line: to.line, col: 0 };
  } else throw new Error('unknown op ' + c.op);
  const lines = serializeOrg(doc).split('\n');
  // the point goes back where it was: counted in lines of the section
  const base = lines.findIndex((l, i) => i >= 0 && heading.bodyLines.length > 0 && lines.slice(i, i + heading.bodyLines.length).join('\n') === heading.bodyLines.join('\n'));
  const at = base + point.line;
  lines[at] = lines[at].slice(0, point.col) + MARK + lines[at].slice(point.col);
  return lines.join('\n');
}
