// @ts-check
/**
 * `org-insert-structure-template` (C-c C-,) and `org-insert-drawer` (C-c C-x d) on the lines of one heading's text: the planning line,
 * drawers and body as they read in the file. A range of lines is wrapped; with none, an empty block or drawer goes after the last line.
 */
import { parseOrg } from './org-parser.js';

/** org-structure-template-alist, as Org 9.6 has it. @type {[string, string][]} */
export const DEFAULT_STRUCTURE_TEMPLATES = [
  ['a', 'export ascii'], ['c', 'center'], ['C', 'comment'], ['e', 'example'], ['E', 'export'],
  ['h', 'export html'], ['l', 'export latex'], ['q', 'quote'], ['s', 'src'], ['v', 'verse'],
];

/**
 * `org-structure-template-alist` read from Lisp text: `'(("a" . "export ascii") ...)`.
 * @param {string | undefined} raw @returns {[string, string][]}
 */
export function readStructureTemplates(raw) {
  if (raw === undefined) return DEFAULT_STRUCTURE_TEMPLATES;
  const pairs = [...raw.matchAll(/\(\s*"((?:[^"\\]|\\.)*)"\s*\.\s*"((?:[^"\\]|\\.)*)"\s*\)/g)];
  return pairs.map((m) => /** @type {[string, string]} */ ([m[1], m[2]]));
}

/** @param {string} line */
const indentOf = (line) => /^[ \t]*/.exec(line)?.[0].length ?? 0;
/** @param {string} line */
const isBlank = (line) => /^[ \t]*$/.test(line);

/**
 * Wraps `range` (first and last line, inclusive) of `lines` in a block, or adds an empty one at the end: Org's rules for the column,
 * the case of the keywords, the space after `src` and `export`, the commas that protect lines of code, and trailing blank lines.
 * @param {string[]} lines
 * @param {string} type  `quote`, `src`, `export ascii`...
 * @param {{ from: number, to: number } | null} range
 * @param {string} [argument]  what follows `src ` or `export `: the language
 * @returns {string[]}
 */
export function insertStructureTemplate(lines, type, range, argument = '') {
  const word = type.split(/\s+/)[0];
  const upcase = word === word.toUpperCase();
  const extended = /^(src|export)$/.test(type);
  const verbatim = /^(example|export|src|comment)/.test(type);
  const begin = `#+${upcase ? 'BEGIN' : 'begin'}_${type}${extended ? ' ' : ''}${extended ? argument : ''}`;
  const end = `#+${upcase ? 'END' : 'end'}_${word}`;
  if (!range) return [...lines, begin, end];
  const column = ' '.repeat(indentOf(lines[range.from]));
  let last = range.to;
  while (last > range.from && isBlank(lines[last])) last--;
  const inside = lines.slice(range.from, last + 1).map((line) => (verbatim ? line.replace(/^([ \t]*)(,*(?:\*|#\+))/, '$1,$2') : line));
  return [...lines.slice(0, range.from), column + begin, ...inside, column + end, ...lines.slice(last + 1)];
}

/**
 * The column Org indents a new element to at line `at`: that of the element before it, else the heading's own text column.
 * @param {string[]} lines @param {number} at @param {number} level @param {boolean} adapt
 */
function expectedIndent(lines, at, level, adapt) {
  const starts = elementStarts(lines);
  const before = starts.filter((i) => i < at);
  return before.length ? indentOf(lines[before[before.length - 1]]) : adapt ? level + 1 : 0;
}

/** The first line of each element of a heading's text. @param {string[]} lines */
function elementStarts(lines) {
  const heading = parseOrg(['* x', ...lines].join('\n')).children[0];
  const offset = lines.length - heading.bodyLines.length;
  /** @type {number[]} */
  const starts = [];
  for (let i = 0; i < offset; i++) {
    if (/^[ \t]*(SCHEDULED|DEADLINE|CLOSED):/.test(lines[i])) starts.push(i);
    else if (/^[ \t]*:[^\s:]+:[ \t]*$/.test(lines[i]) && !/^[ \t]*:END:[ \t]*$/i.test(lines[i])) starts.push(i);
  }
  for (const node of heading.body) {
    const first = node.type === 'list' ? node.items[0]?.lineIndex : node.lineIndex;
    if (first !== undefined) starts.push(offset + first);
  }
  return starts.sort((a, b) => a - b);
}

/**
 * `org-insert-drawer` with a name: wraps `range` in `:NAME:` and `:END:`, or adds an empty drawer after the last line.
 * @param {string[]} lines @param {string} name @param {{ from: number, to: number } | null} range
 * @param {{ level: number, adapt: boolean }} where  the heading's level and `org-adapt-indentation` being `t`
 * @returns {string[]}
 */
export function insertDrawer(lines, name, range, where) {
  if (!range) return [...lines, `:${name}:`, '', ':END:'];
  let last = range.to;
  while (last > range.from && isBlank(lines[last])) last--;
  const column = ' '.repeat(expectedIndent(lines, range.from, where.level, where.adapt));
  return [...lines.slice(0, range.from), `${column}:${name}:`, ...lines.slice(range.from, last + 1), `${column}:END:`, ...lines.slice(last + 1)];
}
