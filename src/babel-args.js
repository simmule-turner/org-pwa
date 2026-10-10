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
 *  inside quotes or brackets, as Org does. Names are lower-case; values are trimmed, and still quoted. */
export function splitHeaderArgs(text) {
  const s = String(text || '');
  const cuts = [];
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
  const pairs = [];
  cuts.forEach((at, n) => {
    const piece = s.slice(at + 1, n + 1 < cuts.length ? cuts[n + 1] : s.length).trim();
    const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(piece);
    if (m) pairs.push([m[1].toLowerCase(), (m[2] || '').trim()]);
  });
  return pairs;
}

/** The value as Org reads it: a double-quoted string loses its quotes. */
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

/** One :var value ("a=1 b=2") as separate "name=value" strings. */
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

function mergeWords(current, incoming, groups) {
  let out = current.slice();
  for (const w of incoming) {
    for (const g of groups) if (g.includes(w)) out = out.filter((o) => !g.includes(o));
    out.push(w);
  }
  return [...new Set(out)];
}

/** Layers of [name, value] pairs (earlier layers lose) -> { name: value, var: [...] } with Org's merge rules:
 *  :results and :exports merge word by word within their exclusive groups, :var is kept per variable name
 *  (a later one replaces the earlier and moves to the end), anything else is replaced. */
export function mergeHeaderArgs(layers) {
  const out = {};
  let vars = [];
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
      else out[name] = readHeaderValue(value);
    }
  }
  out.var = vars;
  out.results = results.join(' ');
  out.exports = exports.join(' ');
  return out;
}

const keyEq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** The value of property `name` for a place in the document: the file-level `#+PROPERTY:` lines first, then every
 *  heading from the top one down to the block's own. At each place `name` replaces what came before and `name+`
 *  appends to it. */
export function inheritedProperty(doc, ancestors, name) {
  let value = null;
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
    let plain = null;
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
 *  @param block      { lang, params, headers } with the block's own text after the language, and its #+HEADER: lines
 *  @returns { var: [...], results, exports, tangle, noweb, ... } with every value a string */
export function effectiveHeaderArgs(doc, ancestors, block) {
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
