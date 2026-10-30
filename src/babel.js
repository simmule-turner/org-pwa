// @ts-check
import { inspect } from './js-inspect.js';
import { layoutTable } from './org-table-layout.js';

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

/**
 * The language word of a block's parameters (`js :results table` -> `js`).
 * @param {any} [params]
 */
export function blockLanguage(params) {
  const m = /^\s*(\S+)/.exec(params || '');
  return m ? m[1].toLowerCase() : '';
}

/**
 * True for a `#+BEGIN_SRC js` / `javascript` block.
 * @param {any} [block]
 */
export function isJsBlock(block) {
  return !!block && block.name === 'SRC' && JS_LANGUAGES.has(blockLanguage(block.params));
}

/** `:name value` pairs after the language. A later pair replaces an earlier
 * @param {any} [params]
 *  one, except `:var`, which accumulates. Values stay strings. */
export function parseHeaderArgs(params) {
  const text = (params || '').replace(/^\s*\S+/, '');
  const args = { var: /** @type {any[]} */ ([]) };
  const re = /(?:^|\s):([A-Za-z][\w-]*)(?=\s|$)/g;
  /** @type {any[]} */ const marks = [];
  let m;
  while ((m = re.exec(text)) !== null) marks.push({ name: m[1].toLowerCase(), end: re.lastIndex, start: m.index });
  marks.forEach((mark, n) => {
    const stop = n + 1 < marks.length ? marks[n + 1].start : text.length;
    const value = text.slice(mark.end, stop).trim();
    if (mark.name === 'var') args.var.push(value);
    else /** @type {any} */ (args)[mark.name] = value;
  });
  return args;
}

const COLLECT_WORDS = new Set(['value', 'output']);
const FORMAT_WORDS = new Set(['table', 'vector', 'list', 'scalar', 'verbatim', 'raw', 'html', 'latex', 'org', 'code', 'pp', 'drawer']);

/**
 * `:results` words -> { collect, words, handling, silent, unsupported }.  `collect` is `value` (the default) or `output`;
 * `words` holds the format words given (table, list, scalar, verbatim, raw, html, latex, org, code, pp, drawer -- Org keeps
 * them all, so `table raw` is both); `handling` is replace (the default), append or prepend; `silent` is set by `silent`
 * and `none`.  `file` (a link to the file `:file` names, or to the value) is handled by the Lisp runner only; `link` and `graphics` write a file and are not supported, and neither is a word Org does not know.
 * @param {string} value
 */
export function parseResultsSpec(value) {
  const spec = {
    collect: /** @type {'value' | 'output'} */ ('value'),
    words: /** @type {Set<string>} */ (new Set()),
    handling: /** @type {'replace' | 'append' | 'prepend'} */ ('replace'),
    silent: false,
    unsupported: /** @type {string | null} */ (null),
    file: false,
  };
  for (const word of String(value || '').trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    if (COLLECT_WORDS.has(word)) spec.collect = /** @type {'value' | 'output'} */ (word);
    else if (FORMAT_WORDS.has(word)) spec.words.add(word === 'vector' ? 'table' : word);
    else if (word === 'file') spec.file = true;
    else if (word === 'silent' || word === 'none') spec.silent = true;
    else if (word === 'append' || word === 'prepend' || word === 'replace') {
      spec.handling = word;
      spec.silent = false;
    } else spec.unsupported = spec.unsupported || word;
  }
  return spec;
}

/**
 * `:timeout` seconds -> milliseconds, default 5 s, never above 60 s.
 * @param {Record<string, string> | null} [args]
 */
export function timeoutMs(args) {
  const seconds = Number.parseFloat((args && args.timeout) || '');
  if (!Number.isFinite(seconds) || seconds <= 0) return 5000;
  return Math.min(seconds, 60) * 1000;
}

// ---- :var -------------------------------------------------------------------

const VAR_ASSIGN_RE = /([A-Za-z_$][\w$]*)=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'(?![(\w])|'\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|[^\s,[]+(?:\[[^\]]*\])?)/g;

/**
 * A `:prologue` / `:epilogue` value as Org reads it: text in double quotes is a Lisp string (`\n`, `\"` and `\\` escapes),
 * anything else is used as it is.
 * @param {any} value
 * @returns {string}
 */
export function headerText(value) {
  const t = String(value);
  return /^"[\s\S]*"$/.test(t) ? t.slice(1, -1).replace(/\\([\s\S])/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c)) : t;
}

/** A rule row in a table, as Org's `hline`. */
export const HLINE = Symbol('hline');

/**
 * A table cell as a value: numbers become numbers (`org-babel--string-to-number`), everything else stays text.
 * @param {string} text
 */
function cellValue(text) {
  const t = text.trim();
  return t !== '' && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : t;
}

/** The rows of the table named by a `#+NAME:` line in `lines`, or null.  A rule row is `HLINE`.
 * @param {string[]} lines
 * @param {string} name
 */
export function findNamedTable(lines, name) {
  const nameRe = new RegExp('^\\s*#\\+NAME:\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
  for (let i = 0; i < lines.length; i++) {
    if (!nameRe.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && /^\s*#\+(CAPTION|ATTR_\w+|HEADERS?)(\[[^\]]*\])?:/i.test(lines[j])) j++;
    const rows = [];
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      if (/^\s*\|-/.test(lines[j])) {
        rows.push(HLINE);
        continue;
      }
      rows.push(lines[j].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cellValue));
    }
    if (rows.length) return rows;
  }
  return null;
}

/**
 * `org-babel-ref-index-list`: the part of a table a reference like `name[1,2]` or `name[0:2,*]` picks.  Indices count from 0
 * and from the end when negative, rules included; `a:b` is a range, `*` or nothing is everything, and each comma goes one
 * level deeper.  A result of one element is that element.
 * @param {string} index
 * @param {any[]} list
 * @returns {any}
 */
export function indexList(index, list) {
  const m = index.length > 0 ? /^([^,]*),?/.exec(index) : null;
  if (!m) return list;
  const length = list.length;
  const portion = m[1];
  const remainder = index.slice(m[0].length);
  const wrap = (/** @type {number} */ n) => (n < 0 ? length + n : n);
  const number = (/** @type {string} */ t) => Math.trunc(Number((/^\s*[-+]?\d*\.?\d*/.exec(t) || ['0'])[0]) || 0);
  const range = portion.length > 0 ? /(([-\d]+):([-\d]+)|\*)/.exec(portion) : null;
  /** @type {any[]} */ let picked;
  if (portion.length === 0 || range) {
    const [from, to] = range && range[2] !== undefined ? [wrap(number(range[2])), wrap(number(range[3]))] : [wrap(0), wrap(-1)];
    picked = [];
    for (let n = from; n <= to; n++) picked.push(list[n]);
  } else picked = [list[wrap(number(portion))]];
  const sub = picked.map((e) => (Array.isArray(e) || e === undefined ? indexList(remainder, e === undefined ? [] : e) : e));
  return sub.length === 1 ? sub[0] : sub;
}

/**
 * A table as a `:var` receives it (`org-babel-disassemble-tables`): the first row is left out when `:colnames` is given
 * (anything but `no`), or when it is the only row before the table's one rule; the first column is left out for any
 * `:rownames` but `no`, and then every rule goes; the rules go unless `:hlines yes`.
 * @param {any[]} rows
 * @param {{ colnames?: string, rownames?: string, hlines?: string }} options
 */
export function shapeTable(rows, { colnames, rownames, hlines } = {}) {
  if (!Array.isArray(rows)) return rows;
  let out = rows;
  const header = out.length > 1 && out[1] === HLINE && !out.slice(2).includes(HLINE);
  if (colnames !== 'no' && (colnames !== undefined || header)) out = out[1] === HLINE ? out.slice(2) : out.slice(1);
  if (rownames !== undefined && rownames !== 'no') out = out.filter((r) => r !== HLINE).map((r) => (Array.isArray(r) ? r.slice(1) : r));
  if (hlines !== 'yes') out = out.filter((r) => r !== HLINE);
  return out;
}

/** What a script sees of a table value: a rule is the string `"hline"` (ob-js writes a bare `hline`, which Node cannot run). @param {unknown} v @returns {unknown} */
function scriptValue(v) {
  return v === HLINE ? 'hline' : Array.isArray(v) ? v.map(scriptValue) : v;
}

/** A quoted Lisp list literal such as `'(1 "two" (3 4))`, as arrays; throws on a word it cannot turn into a value. @param {string} text */
function readQuotedList(text) {
  const tokens = text.slice(1).match(/"(?:[^"\\]|\\.)*"|[()]|[^\s()"]+/g) || [];
  let at = 0;
  const read = () => {
    const t = /** @type {string} */ (tokens[at++]);
    if (t === '(') {
      /** @type {any[]} */ const list = [];
      while (tokens[at] !== ')' && at < tokens.length) list.push(read());
      at++;
      return list;
    }
    if (t[0] === '"') return JSON.parse(t);
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
    if (t === 'nil') return [];
    throw new Error(`:var: cannot read "${t}" in ${text}`);
  };
  return read();
}

/** `:var` header values -> { name: value }.  A value is a number, a quoted string, a quoted list such as `'(1 2 3)`, or the
 *  name of a table (`name`, or `name[1,2]` to pick part of it: see `indexList`), shaped by `:colnames`, `:rownames` and
 *  `:hlines`.  `lookupTable(name)` returns a table's rows or null.  A name nothing has is an error, so a typo is not a silent
 *  undefined (`true`, `false`, `nil` and `null` are read as those words, which Org would call missing references).
 * @param {any} [varSpecs]
 * @param {any} [lookupTable]
 * @param {{ colnames?: string, rownames?: string, hlines?: string }} [tableOptions] */
export function resolveVars(varSpecs, lookupTable, tableOptions = {}) {
  /** @type {Record<string, unknown>} */ const vars = {};
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
      else if (/^'[\s\S]*'$/.test(raw) && !raw.startsWith("'(")) vars[name] = raw.slice(1, -1);
      else if (raw.startsWith("'(")) vars[name] = readQuotedList(raw);
      else {
        // a name is looked up first, as Org resolves a reference; only a name nothing has is read as a word
        const ref = /\[(.*)\]/.exec(raw);
        const tableName = ref ? raw.slice(0, ref.index) : raw;
        const rows = lookupTable ? lookupTable(tableName) : null;
        if (rows) {
          const picked = ref ? indexList(ref[1], rows) : rows;
          vars[name] = scriptValue(shapeTable(picked, tableOptions));
        } else if (raw === 'true' || raw === 't') vars[name] = true;
        else if (raw === 'false') vars[name] = false;
        else if (raw === 'nil' || raw === 'null') vars[name] = null;
        else throw new Error(`:var ${name}=${raw}: no table named "${tableName}"`);
      }
    }
    if (!matched && text.trim()) throw new Error(`:var ${text.trim()}: expected name=value`);
  }
  return vars;
}

// ---- results ----------------------------------------------------------------

/** The text of a table cell. @param {string} text */
export const cellText = (text) => text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\vert{}').trim();

/** Emacs prints a Lisp number or symbol; -0 reads back as 0. @param {unknown} v */
function atomText(v) {
  if (typeof v === 'number') return Object.is(v, -0) ? '0' : String(v);
  if (typeof v === 'string') return v;
  if (v !== null && typeof v === 'object') return inspect(v);
  return String(v);
}

/** One element of a result list, as Lisp would hold it: text, or a list of those. @param {unknown} v @returns {Item} */
function item(v) {
  return Array.isArray(v) ? v.map(item) : atomText(v);
}

/** @typedef {string | Item[]} Item */

/** An element printed the way `princ` prints it: lists in parentheses. @param {Item} it @returns {string} */
export function princ(it) {
  return typeof it === 'string' ? it : it.length === 0 ? 'nil' : '(' + it.map(princ).join(' ') + ')';
}

const KEEP_TEXT_WORDS = ['scalar', 'verbatim', 'html', 'code', 'pp'];

/**
 * What ob-js hands to `org-babel-insert-result`: for some formats the text Node printed (`util.inspect` of the value, or
 * the console output), for the rest the value read back as Lisp -- a list for an array, text for anything else
 * (`org-babel-result-cond`).
 * @param {unknown} value
 * @param {ReturnType<typeof parseResultsSpec>} spec
 * @returns {{ text: string } | { list: Item[] }}
 */
function resultOf(value, spec) {
  const w = spec.words;
  const table = w.has('table');
  const output = spec.collect === 'output';
  const keepText = KEEP_TEXT_WORDS.some((x) => w.has(x)) || ((output || w.has('raw') || w.has('org') || w.has('drawer')) && !table);
  const text = output ? (value === undefined || value === null ? '' : String(value)) : keepText ? inspect(value) : null;
  if (text !== null) return { text };
  if (Array.isArray(value)) return { list: value.map(item) };
  if (table) return { list: [[atomText(value)]] }; // a single value becomes a one-cell table
  return { text: atomText(value) };
}

/** Lines starting with `*` or `#+` get a comma first, as `org-escape-code-in-region` does. @param {string[]} lines */
const escapeCode = (lines) => lines.map((l) => l.replace(/^([ \t]*)(,*(?:\*|#\+))/, '$1,$2'));

/** The `: ` lines of a literal result, or an example block once there are ten of them (`org-babel-examplify-region`). @param {string[]} lines */
function examplify(lines) {
  if (lines.length === 0) return lines;
  if (lines.length < 10) return lines.map((l) => ': ' + l);
  return ['#+begin_example', ...escapeCode(lines), '#+end_example'];
}

/** The lines of `:results list`: an element that is itself a list is one item with a line for each of its parts. @param {Item[]} list */
function listLines(list) {
  return list.flatMap((e) => {
    const parts = (e === null ? ['hline'] : typeof e === 'string' ? [e] : e.map(princ)).map((x) => x.trim());
    return parts.length === 0 ? ['- '] : parts.map((x, i) => (i === 0 ? '- ' : '  ') + x);
  });
}

/**
 * The lines to put under `#+RESULTS:` for a value (or for the collected console output when `spec.collect` is `output`):
 * `org-babel-insert-result`.  `wrap` is the `:wrap` value such as `quote` or `src json` (`''` for a bare `:wrap`, which
 * Org reads as `results`), and `lang` names the language for `:results code`.
 * @param {unknown} [value]
 * @param {ReturnType<typeof parseResultsSpec>} [spec]
 * @param {{ wrap?: string | null, lang?: string }} [options]
 */
export function formatResult(value, spec = parseResultsSpec(''), { wrap = null, lang = 'js' } = {}) {
  return layoutResult(resultOf(value, spec), spec, { wrap, lang });
}

/**
 * `formatResult` for a result already read as text or a list of items (a rule row is null): what a language other than JavaScript hands over.
 * `cells` turns an item's text into the cells it makes.
 * @param {{ text: string } | { list: (Item | null)[] }} result
 * @param {ReturnType<typeof parseResultsSpec>} spec
 * @param {{ wrap?: string | null, lang?: string, cells?: (text: string) => string[] }} [options]
 */
export function layoutResult(result, spec, { wrap = null, lang = 'js', cells = (/** @type {string} */ text) => [cellText(text)] } = {}) {
  const w = spec.words;
  const isList = 'list' in result;

  /** @type {string[]} */ let lines;
  if (isList && result.list.length === 0) {
    lines = []; // an empty list (nil) inserts nothing, though a wrapper still goes round it
  } else if (w.has('list')) {
    lines = isList ? listLines(/** @type {Item[]} */ (result.list)) : result.text.split('\n').filter((l) => l !== '').map((l) => '- ' + l);
    if (lines.length === 0) lines = [''];
  } else if (isList) {
    const rows = result.list.every((r) => r === null || Array.isArray(r)) ? /** @type {(Item[] | null)[]} */ (result.list) : [/** @type {Item[]} */ (result.list)];
    lines = layoutTable(rows.map((r) => (r === null ? null : r.flatMap((c) => cells(princ(c))))));
  } else {
    lines = result.text === '' ? [] : result.text.replace(/\n$/, '').split('\n');
  }

  const block = (/** @type {string} */ begin, /** @type {string} */ end, /** @type {boolean} */ escape) => [begin, ...(escape ? escapeCode(lines) : lines), end];
  if (wrap !== null && wrap !== undefined) {
    const full = wrap.trim() || 'results';
    const type = full.split(/\s+/)[0];
    return block('#+begin_' + full, '#+end_' + type, /^(export|example|src)$/i.test(type));
  }
  if (w.has('html')) return block('#+begin_export html', '#+end_export', true);
  if (w.has('latex')) return block('#+begin_export latex', '#+end_export', true);
  if (w.has('org')) return block('#+begin_src org', '#+end_src', true);
  if (w.has('code')) return block('#+begin_src ' + lang, '#+end_src', true);
  if (w.has('raw')) return lines;
  if (w.has('drawer')) return block(':results:', ':end:', false);
  return isList ? lines : examplify(lines);
}

/**
 * An error as `#+RESULTS:` lines.
 * @param {string} message
 * @param {number | null} [line]
 */
export function formatError(message, line = null) {
  return examplify(('Error: ' + message + (line ? ` (line ${line})` : '')).split('\n'));
}

export const RESULTS_LINE_RE = /^\s*#\+RESULTS(\[[^\]]*\])?:/i;

/**
 * Where the existing results body ends (exclusive), for a `#+RESULTS:` line at `at`.
 * @param {string[]} lines
 * @param {number} at
 */
export function resultsEnd(lines, at) {
  let k = at + 1;
  const first = lines[k];
  if (first === undefined || first.trim() === '') return k;
  if (/^\s*:results:\s*$/i.test(first)) {
    for (k = k + 1; k < lines.length; k++) if (/^\s*:end:\s*$/i.test(lines[k])) return k + 1;
    return lines.length;
  }
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
 * @param {string[]} bodyLines
 * @param {any} block
 * @param {string[]} resultLines
 *  below the block, with a blank line either side as Org does. `hash` goes into the results line (`#+RESULTS[hash]:`) for `:cache yes`;
 *  `name` is the block's `#+NAME:`, which Org writes after `#+RESULTS:`. */
export function placeResults(bodyLines, block, resultLines, { hash = /** @type {string | null} */ (null), handling = 'replace', name = '' } = {}) {
  const indent = (/^(\s*)/.exec(bodyLines[block.lineIndex]) || ['', ''])[1];
  /** @param {string} l */
  const pad = (l) => (l === '' ? l : indent + l);
  const blockEnd = block.lineIndex + block.lineCount;
  const label = name ? ' ' + name : '';
  // A named block owns the `#+RESULTS: name` line (here: in this section); an unnamed one the unnamed `#+RESULTS:` right after it.
  let j = -1;
  if (name) {
    for (let i = 0; i < bodyLines.length; i++) {
      const m = /^\s*#\+RESULTS(?:\[[^\]]*\])?:[ \t]*(.*?)\s*$/i.exec(bodyLines[i]);
      if (m && m[1].toLowerCase() === name.toLowerCase()) {
        j = i;
        break;
      }
    }
  } else {
    let k = blockEnd;
    while (k < bodyLines.length && bodyLines[k].trim() === '') k++;
    if (k < bodyLines.length && RESULTS_LINE_RE.test(bodyLines[k]) && /^\s*#\+RESULTS(?:\[[^\]]*\])?:\s*$/i.test(bodyLines[k])) j = k;
  }
  if (j >= 0) {
    const end = resultsEnd(bodyLines, j);
    if (handling === 'append') {
      const old = bodyLines.slice(j + 1, end);
      const isRow = (/** @type {string} */ l) => /^\s*\|/.test(l);
      if (old.length && old.every(isRow) && resultLines.length && resultLines.every(isRow)) {
        // two tables become one, realigned as Org's table code does
        const rows = [...old, ...resultLines].map((l) => (/^\s*\|-/.test(l) ? null : l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())));
        return { start: j + 1, removeCount: end - j - 1, insert: layoutTable(rows).map(pad) };
      }
      return { start: end, removeCount: 0, insert: resultLines.map(pad) };
    }
    if (handling === 'prepend') return { start: j + 1, removeCount: 0, insert: resultLines.map(pad) };
    // without :cache yes the old `[hash]` stays on the line, as in Emacs
    return { start: j, removeCount: end - j, insert: [bodyLines[j].replace(/^(\s*#\+RESULTS)(\[[^\]]*\])?:/i, hash ? `$1[${hash}]:` : '$1$2:'), ...resultLines.map(pad)] };
  }
  const insert = ['', pad((hash ? `#+RESULTS[${hash}]:` : '#+RESULTS:') + label), ...resultLines.map(pad)];
  if (blockEnd < bodyLines.length && bodyLines[blockEnd].trim() !== '') insert.push('');
  return { start: blockEnd, removeCount: 0, insert };
}

/**
 * Whether the block's `:eval` allows running it by hand: `never` and `no` do not (Org's org-babel-check-evaluate).
 * @param {Record<string, any>} args
 */
export const evalAllowed = (args) => !['never', 'no'].includes(String(args.eval || '').trim());

/**
 * The hash in the `#+RESULTS[hash]:` line that follows the block, or null.
 * @param {string[]} bodyLines
 * @param {any} [block]
 */
export function existingResultsHash(bodyLines, block) {
  let j = block.lineIndex + block.lineCount;
  while (j < bodyLines.length && bodyLines[j].trim() === '') j++;
  const m = j < bodyLines.length ? /^\s*#\+RESULTS\[([^\]]*)\]:/i.exec(bodyLines[j]) : null;
  return m ? m[1] : null;
}
