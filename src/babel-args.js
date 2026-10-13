// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * Header arguments of a source block, with the inheritance Org has: the defaults, then the
 * `header-args` and `header-args:LANG` properties (set for the whole file with
 * `#+PROPERTY:` or on any ancestor heading, `+` appending instead of replacing), then the block's
 * own `:name value` pairs, then its `#+HEADER:` lines. Checked against Emacs's own
 * `org-babel-get-src-block-info`.
 */

export const DEFAULT_HEADER_ARGS = [
  ['session', 'none'],
  ['results', 'replace'],
  ['exports', 'code'],
  ['cache', 'no'],
  ['noweb', 'no'],
  ['hlines', 'no'],
  ['tangle', 'no'],
];

// Words of :results and :exports that exclude each other (Org's org-babel-common-header-args-w-values).
const RESULTS_GROUPS = [
  ['file', 'list', 'vector', 'table', 'scalar', 'verbatim'],
  ['raw', 'html', 'latex', 'org', 'code', 'pp', 'drawer', 'link', 'graphics'],
  ['replace', 'silent', 'none', 'discard', 'append', 'prepend'],
  ['output', 'value'],
];
const EXPORTS_GROUPS = [['code', 'results', 'both', 'none']];

/** `:name value :name value` -> [[name, value], ...]. Splits only at a colon that follows a space or tab and is not
 * @param {string} text
 *  inside quotes or brackets, as Org does. Names are lower-case; values are trimmed, and still quoted. */
export function splitHeaderArgs(text) {
  const s = String(text || '');
  /** @type {any[]} */ const cuts = [];
  let quote = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && quote) {
      i++;
      continue;
    }
    if (c === '"') quote = !quote;
    else if (!quote && '([{'.includes(c)) depth++;
    else if (!quote && ')]}'.includes(c)) depth = Math.max(0, depth - 1);
    else if (c === ':' && !quote && depth === 0 && i > 0 && /[ \t]/.test(s[i - 1])) cuts.push(i);
    else if (c === ':' && i === 0) cuts.push(0);
  }
  /** @type {any[]} */ const pairs = [];
  cuts.forEach((at, n) => {
    const piece = s.slice(at + 1, n + 1 < cuts.length ? cuts[n + 1] : s.length).trim();
    const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(piece);
    if (m) pairs.push([m[1].toLowerCase(), (m[2] || '').trim()]);
  });
  return pairs;
}

/**
 * The value as Org reads it: a double-quoted string loses its quotes.
 * @param {string} raw
 */
export function readHeaderValue(raw) {
  const v = String(raw || '').trim();
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
    try {
      return JSON.parse(v);
    } catch (e) {
      return v.slice(1, -1);
    }
  }
  return v;
}

/**
 * One :var value ("a=1 b=2") as separate "name=value" strings.
 * @param {string} value
 */
function splitVars(value) {
  const tokens = [];
  let cur = '';
  let quote = false;
  let depth = 0;
  for (const c of String(value)) {
    if (c === '"') quote = !quote;
    else if (!quote && '([{'.includes(c)) depth++;
    else if (!quote && ')]}'.includes(c)) depth = Math.max(0, depth - 1);
    if (/\s/.test(c) && !quote && depth === 0) {
      if (cur) tokens.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur) tokens.push(cur);
  const out = [];
  for (const t of tokens) {
    if (out.length && (out[out.length - 1].endsWith('=') || t.startsWith('='))) out[out.length - 1] += t;
    else out.push(t);
  }
  return out;
}

/**
 * @param {any} current
 * @param {string[]} incoming
 * @param {string[][]} groups
 */
function mergeWords(current, incoming, groups) {
  let out = current.slice();
  for (const w of incoming) {
    for (const g of groups) if (g.includes(w)) out = out.filter((/** @type {any} */ o) => !g.includes(o));
    out.push(w);
  }
  return [...new Set(out)];
}

/** Layers of [name, value] pairs (earlier layers lose) -> { name: value, var: [...] } with Org's merge rules:
 *  :results and :exports merge word by word within their exclusive groups, :var is kept per variable name
 * @param {string[][][]} layers
 *  (a later one replaces the earlier and moves to the end), anything else is replaced. */
export function mergeHeaderArgs(layers) {
  const out = {};
  /** @type {any[]} */ let vars = [];
  let results = [];
  let exports = [];
  for (const layer of layers) {
    for (const [name, value] of layer) {
      if (name === 'var') {
        for (const v of splitVars(value)) {
          const m = /^([^=\s]+)\s*=/.exec(v);
          if (m) vars = vars.filter((x) => !x.startsWith(m[1] + '='));
          vars.push(v);
        }
      } else if (name === 'results') results = mergeWords(results, value.split(/\s+/).filter(Boolean), RESULTS_GROUPS);
      else if (name === 'exports') exports = mergeWords(exports, value.split(/\s+/).filter(Boolean), EXPORTS_GROUPS);
      else /** @type {any} */ (out)[name] = readHeaderValue(value);
    }
  }
  out.var = vars;
  out.results = results.join(' ');
  out.exports = exports.join(' ');
  return out;
}

/**
 * @param {string} a
 * @param {string} b
 */
const keyEq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** The value of property `name` for a place in the document: the file-level `#+PROPERTY:` lines first, then every
 *  heading from the top one down to the block's own. At each place `name` replaces what came before and `name+`
 * @param {Doc} doc
 * @param {any} ancestors
 * @param {string} name
 *  appends to it. */
export function inheritedProperty(doc, ancestors, name) {
  /** @type {string | null} */
  let value = null;
  /**
   * @param {string | null} plain
   * @param {string | null} plus
   */
  const apply = (plain, plus) => {
    if (plain !== null) value = plain;
    if (plus !== null) value = (value === null || value === '' ? '' : value + ' ') + plus;
  };
  for (const kw of (doc && doc.keywords) || []) {
    if (String(kw.key).toUpperCase() !== 'PROPERTY') continue;
    const m = /^(\S+)\s*([\s\S]*)$/.exec(String(kw.value).trim());
    if (!m) continue;
    if (keyEq(m[1], name)) apply(m[2], null);
    else if (keyEq(m[1], name + '+')) apply(null, m[2]);
  }
  for (const h of ancestors) {
    /** @type {string | null} */
    let plain = null;
    /** @type {string | null} */
    let plus = null;
    for (const [k, v] of Object.entries(h.properties || {})) {
      if (keyEq(k, name)) plain = String(v);
      else if (keyEq(k, name + '+')) plus = String(v);
    }
    apply(plain, plus);
  }
  return value;
}

/** The header arguments in force for a source block.
 *  @param doc        the parsed document (for its #+PROPERTY: lines)
 *  @param ancestors  headings from the outermost down to the one holding the block ([] before the first heading)
 *  @param block      an object with lang, params and headers: the block's own text after the language, and its #+HEADER: lines
 *  @returns {Record<string, any>} the arguments by name (`var` is a list; every other value is a string) */
export function effectiveHeaderArgs(/** @type {any} */ doc, /** @type {any} */ ancestors, /** @type {any} */ block) {
  const lang = String(block.lang || '').toLowerCase();
  const layers = [DEFAULT_HEADER_ARGS];
  const general = inheritedProperty(doc, ancestors, 'header-args');
  const specific = lang ? inheritedProperty(doc, ancestors, 'header-args:' + lang) : null;
  if (general) layers.push(splitHeaderArgs(general));
  if (specific) layers.push(splitHeaderArgs(specific));
  layers.push(splitHeaderArgs(block.params || ''));
  for (const h of block.headers || []) layers.push(splitHeaderArgs(h));
  return mergeHeaderArgs(layers);
}
