/**
 * Line numbers and code references for source and example blocks on export, ported from Org's ox.el
 * (`org-export-unravel-code`, `org-export-get-loc`, `org-export-format-code-default`,
 * `org-export-resolve-coderef`) and org-element's switch parsing.
 */

/**
 * @typedef {{ numberLines: { kind: 'new' | 'continued', n: number } | null, preserveIndent: boolean, retainLabels: boolean, useLabels: boolean, labelFormat: string }} CodeSwitches
 * @typedef {{ lines: string[], refs: Map<number, string>, switches: CodeSwitches }} CodeBlock
 */

/** The label format when no -l switch is given. */
export const DEFAULT_LABEL_FORMAT = '(ref:%s)';

/**
 * @param {string} s
 */
function regexpQuote(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse the switches of a block header (everything after the language for source blocks).
 * @param {string} text
 * @returns {CodeSwitches}
 */
export function parseCodeSwitches(text) {
  const t = text || '';
  const num = /(?:^|\s)([-+])n(?: *([0-9]+))?(?![A-Za-z0-9_])/.exec(t);
  /** @type {CodeSwitches['numberLines']} */
  const numberLines = num ? { kind: num[1] === '-' ? 'new' : 'continued', n: num[2] ? Number(num[2]) - 1 : 0 } : null;
  const hasSwitches = /(?:^|\s)[-+][a-z]/i.test(t);
  const r = /(?:^|\s)-r(?![A-Za-z0-9_])/.test(t);
  const k = /(?:^|\s)-k(?![A-Za-z0-9_])/.test(t);
  const retainLabels = !hasSwitches || !r || (numberLines !== null && k);
  const useLabels = !hasSwitches || (retainLabels && !k);
  const fmt = /(?:^|\s)-l +"([^"\n]+)"/.exec(t);
  return {
    numberLines,
    preserveIndent: /(?:^|\s)-i(?![A-Za-z0-9_])/.test(t),
    retainLabels,
    useLabels,
    labelFormat: fmt ? fmt[1] : DEFAULT_LABEL_FORMAT,
  };
}

/**
 * Regexp matching a line that ends with a reference (group 1 is the whole removable part, group 3 the label).
 * @param {string} format
 */
export function codeRefRegexp(format) {
  const parts = format.split('%s').map(regexpQuote);
  return new RegExp(`([ \\t]*(${parts.join('([-a-zA-Z0-9_][-a-zA-Z0-9_ ]*)')})[ \\t]*)$`);
}

/**
 * @param {string[]} lines
 */
function removeIndent(lines) {
  let min = Infinity;
  for (const l of lines) {
    if (!l.trim()) continue;
    min = Math.min(min, (/^[ \t]*/.exec(l) || [''])[0].length);
  }
  return min === Infinity || min === 0 ? lines : lines.map((l) => l.slice(Math.min(min, (/^[ \t]*/.exec(l) || [''])[0].length)));
}

/**
 * Org's `org-export-unravel-code`: remove common indentation, then cut the reference off each line.
 * @param {string[]} rawLines
 * @param {string} switchText
 * @returns {CodeBlock}
 */
export function unravelCode(rawLines, switchText) {
  const switches = parseCodeSwitches(switchText);
  const lines = switches.preserveIndent ? rawLines.slice() : removeIndent(rawLines);
  while (lines.length && lines[lines.length - 1] === '' && lines.length > 1) lines.pop();
  const re = codeRefRegexp(switches.labelFormat);
  /** @type {Map<number, string>} */
  const refs = new Map();
  const out = lines.map((l, i) => {
    const m = re.exec(l);
    if (!m) return l;
    refs.set(i + 1, m[3]);
    return l.slice(0, m.index) + l.slice(m.index + m[1].length);
  });
  return { lines: out, refs, switches };
}

/**
 * Per-export numbering state: lines accumulated over earlier numbered blocks (Org's `org-export-get-loc`).
 * @returns {{ loc: number }}
 */
export function newCodeCounter() {
  return { loc: 0 };
}

/**
 * Number of lines before the first line of this block, or null when it is not numbered. Advances the counter.
 * @param {{ loc: number }} counter
 * @param {CodeSwitches} switches
 * @param {number} lineCount  lines of the raw block value
 * @returns {number | null}
 */
export function codeStart(counter, switches, lineCount) {
  const nl = switches.numberLines;
  if (!nl) return null;
  const start = nl.kind === 'new' ? nl.n : counter.loc + nl.n;
  counter.loc = nl.kind === 'new' ? nl.n + lineCount : counter.loc + nl.n + lineCount;
  return start;
}

/**
 * The number or label a reference stands for.
 * @param {{ lines: string[], switches: CodeSwitches, refs: Map<number, string>, start: number | null }[]} blocks
 * @param {string} label
 * @returns {string | null}
 */
export function resolveCodeRef(blocks, label) {
  for (const b of blocks) {
    for (const [line, name] of b.refs) {
      if (name !== label) continue;
      return b.switches.useLabels ? label : String((b.start || 0) + line);
    }
  }
  return null;
}

/**
 * Link text for a reference (`org-export-get-coderef-format`): the number or label; a description containing
 * "(label)" has that part replaced by it, any other description stands as it is.
 * @param {string} label
 * @param {string} resolved
 * @param {string | null} description
 */
export function coderefText(label, resolved, description) {
  if (!description) return resolved;
  const mark = `(${label})`;
  return description.includes(mark) ? description.replace(mark, () => resolved) : description;
}

/**
 * The switches part of a block header: after the language for a source block, all of it for an example block.
 * @param {string} name  block name, "src" or "example"
 * @param {string} params
 */
export function blockSwitchText(name, params) {
  const p = params.trim();
  return name === 'src' && !/^[-+]/.test(p) ? p.replace(/^\S+\s*/, '') : p;
}

/**
 * Plain-text rendering of a block (ASCII, Markdown, ...): numbers on the left, references flush right.
 * @param {CodeBlock} block
 * @param {number | null} start
 * @returns {string[]}
 */
export function formatCodePlain(block, start) {
  const { lines, switches, refs } = block;
  const width = start === null ? 0 : String(lines.length + start).length;
  const numLen = start === null ? 0 : width + 2;
  const maxW = Math.max(...lines.map((l) => l.length)) + numLen;
  return lines.map((loc, i) => {
    const num = start === null ? '' : String(start + i + 1).padStart(width) + '  ';
    const ref = switches.retainLabels ? refs.get(i + 1) : undefined;
    return num + loc + (ref === undefined ? '' : ' '.repeat(6 + maxW - (loc.length + num.length)) + `(${ref})`);
  });
}
