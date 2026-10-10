/**
 * Org Babel for JavaScript blocks: the pure part. Header arguments, `:var`
 * values, turning a result into `#+RESULTS:` lines, and finding where those
 * lines go. Nothing here runs code or touches the page; see
 * src-browser/babel-run.js for the sandbox and src-browser/babel-flow.js for
 * the commands.
 *
 * Result formats follow Org's own ob-js (checked against Emacs): a string or
 * number is a `: ` line, a list of lists is a table, a flat list is a
 * one-row table, `:results list` gives `- item` lines, and `:results output`
 * collects console.log lines.
 */

const JS_LANGUAGES = new Set(['js', 'javascript']);

/** The language word of a block's parameters (`js :results table` -> `js`). */
export function blockLanguage(params) {
  const m = /^\s*(\S+)/.exec(params || '');
  return m ? m[1].toLowerCase() : '';
}

/** True for a `#+BEGIN_SRC js` / `javascript` block. */
export function isJsBlock(block) {
  return !!block && block.name === 'SRC' && JS_LANGUAGES.has(blockLanguage(block.params));
}

/** `:name value` pairs after the language. A later pair replaces an earlier
 *  one, except `:var`, which accumulates. Values stay strings. */
export function parseHeaderArgs(params) {
  const text = (params || '').replace(/^\s*\S+/, '');
  const args = { var: [] };
  const re = /(?:^|\s):([A-Za-z][\w-]*)(?=\s|$)/g;
  const marks = [];
  let m;
  while ((m = re.exec(text)) !== null) marks.push({ name: m[1].toLowerCase(), end: re.lastIndex, start: m.index });
  marks.forEach((mark, n) => {
    const stop = n + 1 < marks.length ? marks[n + 1].start : text.length;
    const value = text.slice(mark.end, stop).trim();
    if (mark.name === 'var') args.var.push(value);
    else args[mark.name] = value;
  });
  return args;
}

const RESULTS_WORDS = new Set(['value', 'output', 'table', 'vector', 'list', 'scalar', 'verbatim', 'raw', 'silent', 'none', 'replace']);

/** `:results` words -> { collect, format, silent, unsupported }. */
export function parseResultsSpec(value) {
  const spec = { collect: 'value', format: null, silent: false, unsupported: null };
  for (const word of String(value || '').trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    if (!RESULTS_WORDS.has(word)) {
      spec.unsupported = spec.unsupported || word;
    } else if (word === 'output' || word === 'value') {
      spec.collect = word;
    } else if (word === 'table' || word === 'vector') {
      spec.format = 'table';
    } else if (word === 'list') {
      spec.format = 'list';
    } else if (word === 'raw') {
      spec.format = 'raw';
    } else if (word === 'scalar' || word === 'verbatim') {
      spec.format = 'scalar';
    } else if (word === 'silent' || word === 'none') {
      spec.silent = true;
    }
  }
  return spec;
}

/** `:timeout` seconds -> milliseconds, default 5 s, never above 60 s. */
export function timeoutMs(args) {
  const seconds = Number.parseFloat(args && args.timeout);
  if (!Number.isFinite(seconds) || seconds <= 0) return 5000;
  return Math.min(seconds, 60) * 1000;
}

// ---- :var -------------------------------------------------------------------

const VAR_ASSIGN_RE = /([A-Za-z_$][\w$]*)=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,]+)/g;

/** A table cell as a value: numbers become numbers, everything else stays text. */
function cellValue(text) {
  const t = text.trim();
  return t !== '' && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : t;
}

/** The rows of the table named by a `#+NAME:` line in `lines`, or null. Rule
 *  rows are left out. */
export function findNamedTable(lines, name) {
  const nameRe = new RegExp('^\\s*#\\+NAME:\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
  for (let i = 0; i < lines.length; i++) {
    if (!nameRe.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && /^\s*#\+(CAPTION|ATTR_\w+|HEADERS?)(\[[^\]]*\])?:/i.test(lines[j])) j++;
    const rows = [];
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      if (/^\s*\|[-+]*\|?\s*$/.test(lines[j])) continue;
      rows.push(lines[j].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cellValue));
    }
    if (rows.length) return rows;
  }
  return null;
}

/** `:var` header values -> { name: value }. A value is a number, a quoted string,
 *  true / false / nil, or the name of a table. `lookupTable(name)` returns a table's
 *  rows or null. Throws on an unknown value, so a typo is an error and not a
 *  silent undefined. */
export function resolveVars(varSpecs, lookupTable) {
  const vars = {};
  for (const spec of varSpecs || []) {
    const text = String(spec);
    let matched = 0;
    VAR_ASSIGN_RE.lastIndex = 0;
    let m;
    while ((m = VAR_ASSIGN_RE.exec(text)) !== null) {
      matched++;
      const [, name, raw] = m;
      if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(raw)) vars[name] = Number(raw);
      else if (/^"[\s\S]*"$/.test(raw)) vars[name] = JSON.parse(raw);
      else if (/^'[\s\S]*'$/.test(raw)) vars[name] = raw.slice(1, -1);
      else if (raw === 'true' || raw === 't') vars[name] = true;
      else if (raw === 'false') vars[name] = false;
      else if (raw === 'nil' || raw === 'null') vars[name] = null;
      else {
        const rows = lookupTable ? lookupTable(raw) : null;
        if (!rows) throw new Error(`:var ${name}=${raw}: no table named "${raw}"`);
        vars[name] = rows;
      }
    }
    if (!matched && text.trim()) throw new Error(`:var ${text.trim()}: expected name=value`);
  }
  return vars;
}

// ---- results ----------------------------------------------------------------

function cellText(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\vert{}');
}

const tableLine = (cells) => '| ' + cells.map(cellText).join(' | ') + ' |';
const fixedWidth = (text) => String(text).split(/\r?\n/).map((l) => (l === '' ? ':' : ': ' + l));

/** The lines to put under `#+RESULTS:` for a value (or for collected console
 *  output when `spec.collect` is `output`). `wrap` is a `:wrap` value such as `quote`
 *  or `SRC json`. */
export function formatResult(value, spec = parseResultsSpec(''), { wrap = '' } = {}) {
  const format = spec.format;
  let lines;
  if (spec.collect === 'output') {
    const text = String(value || '');
    lines = format === 'raw' || wrap ? (text === '' ? [] : text.split(/\r?\n/)) : text === '' ? [] : fixedWidth(text);
  } else if (Array.isArray(value) && format !== 'raw') {
    if (format === 'list') {
      lines = value.map((v) => '- ' + (Array.isArray(v) ? v.map(cellText).join(', ') : cellText(v)));
    } else if (value.length === 0) {
      lines = [': []'];
    } else if (value.every(Array.isArray)) {
      lines = value.map(tableLine);
    } else {
      lines = [tableLine(value)];
    }
  } else if (value !== null && typeof value === 'object') {
    lines = format === 'raw' ? [JSON.stringify(value)] : fixedWidth(JSON.stringify(value));
  } else if (format === 'table') {
    lines = [tableLine([value])];
  } else if (format === 'list') {
    lines = ['- ' + cellText(value)];
  } else if (typeof value === 'string' && (format === 'raw' || wrap)) {
    lines = value === '' ? [] : value.split(/\r?\n/);
  } else {
    lines = fixedWidth(value === undefined ? 'undefined' : String(value));
  }
  const w = String(wrap || '').trim();
  if (w) {
    const name = w.split(/\s+/)[0];
    lines = ['#+begin_' + w.replace(/^\S+/, name.toLowerCase()), ...lines, '#+end_' + name.toLowerCase()];
  }
  return lines;
}

/** An error as `#+RESULTS:` lines. */
export function formatError(message, line = null) {
  return fixedWidth('Error: ' + message + (line ? ` (line ${line})` : ''));
}

const RESULTS_LINE_RE = /^\s*#\+RESULTS(\[[^\]]*\])?:/i;

/** Where the existing results body ends (exclusive), for a `#+RESULTS:` line at `at`. */
function resultsEnd(lines, at) {
  let k = at + 1;
  const first = lines[k];
  if (first === undefined || first.trim() === '') return k;
  const begin = /^\s*#\+begin_(\w+)/i.exec(first);
  if (begin) {
    for (k = k + 1; k < lines.length; k++) if (new RegExp('^\\s*#\\+end_' + begin[1] + '\\s*$', 'i').test(lines[k])) return k + 1;
    return lines.length;
  }
  const kind = /^\s*:( |$)/.test(first) ? /^\s*:( |$)/ : /^\s*\|/.test(first) ? /^\s*\|/ : /^\s*[-+]\s/.test(first) ? /^(\s*[-+]\s|\s+\S)/ : /^\s*\S/;
  while (k < lines.length && lines[k].trim() !== '' && kind.test(lines[k])) k++;
  return k;
}

/** The edit that puts `resultLines` under a block: `{ start, removeCount, insert }`
 *  for splicing into the heading's body lines. An existing `#+RESULTS:` after the
 *  block (blank lines allowed between) is replaced; otherwise a new one is added
 *  below the block, with a blank line either side as Org does. */
export function placeResults(bodyLines, block, resultLines) {
  const indent = (/^(\s*)/.exec(bodyLines[block.lineIndex]) || ['', ''])[1];
  const pad = (l) => (l === '' ? l : indent + l);
  const blockEnd = block.lineIndex + block.lineCount;
  let j = blockEnd;
  while (j < bodyLines.length && bodyLines[j].trim() === '') j++;
  if (j < bodyLines.length && RESULTS_LINE_RE.test(bodyLines[j])) {
    const end = resultsEnd(bodyLines, j);
    return { start: j, removeCount: end - j, insert: [bodyLines[j], ...resultLines.map(pad)] };
  }
  const insert = ['', pad('#+RESULTS:'), ...resultLines.map(pad)];
  if (blockEnd < bodyLines.length && bodyLines[blockEnd].trim() !== '') insert.push('');
  return { start: blockEnd, removeCount: 0, insert };
}
