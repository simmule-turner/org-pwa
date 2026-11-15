// @ts-check
/**
 * Org Babel beyond the `#+BEGIN_SRC` block: inline source blocks `src_lang[headers]{body}`, `#+CALL:` lines and inline calls
 * `call_name[inside](args)[end]`, the commands that move between and clear results, and running everything in a buffer.
 * It works on the lines of one section (a heading's `bodyLines`) with a point `{ line, col }`, as Emacs works on a buffer, and
 * answers with the new lines; nothing here touches the page. Follows ob-core.el, ob-lob.el and org-element.el of Org 9.6.
 */
import { collectDocumentBlocks, scanSourceBlocks } from './babel-blocks.js';
import { inheritedProperty, mergeHeaderArgs, splitHeaderArgs, readHeaderValue } from './babel-args.js';
import { HLINE, evalAllowed, formatError, formatResult, parseResultsSpec, pickedNames, placeResults, resolveVars, resultsEnd } from './babel.js';
import { babelOptions } from './babel-options.js';
import { babelLibrary } from './babel-lob.js';
import { plainVariables, referenceLookup } from './babel-ref.js';
import { formatElispResult, isElispBlock, isLiteralResult, pretty, runElisp, toLisp } from './babel-elisp.js';
import { expandNoweb, nowebAllows } from './noweb.js';
import { Cons, NIL, print } from './elisp-data.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {{ line: number, col: number }} Point */
/** @typedef {{ type: 'inline-src-block' | 'inline-babel-call', begin: number, end: number, endBlank: number, lang?: string, value?: string, parameters?: string | null, call?: string, inside?: string | null, args?: string | null, endHeader?: string | null }} InlineObject */

// ---- parsing ----------------------------------------------------------------------------------------------------------------

/** The position of the bracket that closes the one at `pos` (counting only that kind of bracket), or -1. @param {string} text @param {number} pos */
function closingPair(text, pos) {
  const open = text[pos];
  const close = /** @type {Record<string, string>} */ ({ '[': ']', '{': '}', '(': ')' })[open];
  let depth = 0;
  for (let i = pos; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return i;
  }
  return -1;
}

/** Header text of an inline object: trimmed, line breaks and the indentation after them one space, null when blank. @param {string} text */
const inlineHeader = (text) => (text.trim() === '' ? null : text.trim().replace(/\n[ \t]*/g, ' '));

/**
 * The inline source block or inline call that starts at `pos` (`org-element-inline-src-block-parser`,
 * `org-element-inline-babel-call-parser`), or null. `end` includes the blanks after the object, `endBlank` does not.
 * @param {string} text @param {number} pos @returns {InlineObject | null}
 */
function parseInlineAt(text, pos) {
  const prev = text[pos - 1];
  if (prev !== undefined && /[\p{L}\p{N}]/u.test(prev)) return null;
  const rest = text.slice(pos);
  const src = /^src_([^ \t\n[{]+)[{[]/.exec(rest);
  const call = src ? null : /^call_([^ \t\n[(]+)[([]/.exec(rest);
  if (!src && !call) return null;
  let at = pos + (src ? 4 + src[1].length : 5 + /** @type {RegExpExecArray} */ (call)[1].length);
  /** @type {string | null} */ let first = null;
  if (text[at] === '[') {
    const close = closingPair(text, at);
    if (close === -1) return null;
    first = text.slice(at + 1, close);
    at = close + 1;
  }
  const bodyOpen = src ? '{' : '(';
  if (text[at] !== bodyOpen) return null;
  const bodyClose = closingPair(text, at);
  if (bodyClose === -1) return null;
  const body = text.slice(at + 1, bodyClose);
  at = bodyClose + 1;
  /** @type {string | null} */ let second = null;
  if (call && text[at] === '[') {
    const close = closingPair(text, at);
    if (close !== -1) {
      second = text.slice(at + 1, close);
      at = close + 1;
    }
  }
  const endBlank = at;
  while (text[at] === ' ' || text[at] === '\t') at++;
  if (src) return { type: 'inline-src-block', begin: pos, end: at, endBlank, lang: src[1], value: body, parameters: first === null ? null : inlineHeader(first) };
  return { type: 'inline-babel-call', begin: pos, end: at, endBlank, call: /** @type {RegExpExecArray} */ (call)[1], inside: first === null ? null : inlineHeader(first), args: body.trim() === '' ? null : body, endHeader: second === null ? null : inlineHeader(second) };
}

/** Every inline source block and inline call in `text`, in order. @param {string} text @returns {InlineObject[]} */
export function inlineObjects(text) {
  /** @type {InlineObject[]} */ const found = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== 's' && text[i] !== 'c') continue;
    const object = parseInlineAt(text, i);
    if (object) {
      found.push(object);
      i = object.endBlank - 1;
    }
  }
  return found;
}

/**
 * A `#+CALL:` line as `org-element-babel-call-parser` reads it, or null: `call`, the `[inside]` header arguments, the `(arguments)` and
 * the end header arguments (the rest of the line, with or without brackets).
 * @param {string} line @returns {{ call: string | null, inside: string | null, args: string | null, endHeader: string | null } | null}
 */
export function parseCallLine(line) {
  if (!/^[ \t]*#\+CALL:/i.test(line)) return null;
  const value = line.slice(line.indexOf(':') + 1).trim();
  const stop = value.search(/[[\]()]/);
  const call = stop === -1 ? value : value.slice(0, stop);
  let at = stop === -1 ? value.length : stop;
  /** @type {string | null} */ let inside = null;
  if (value[at] === '[') {
    const close = closingPair(value, at);
    if (close !== -1) {
      inside = value.slice(at + 1, close);
      at = close + 1;
    }
  }
  /** @type {string | null} */ let args = null;
  if (value[at] === '(') {
    const close = closingPair(value, at);
    if (close !== -1) {
      args = value.slice(at + 1, close);
      at = close + 1;
    }
  }
  if (args === null) return null;
  const tail = value.slice(at).trim();
  return { call: call.trim() === '' ? null : call, inside: inside !== null && inside.trim() !== '' ? inside : null, args: args.trim() === '' ? null : args, endHeader: tail === '' ? null : tail };
}

/** The top-level comma-separated parts of call arguments (`org-babel-ref-split-args`). @param {string} text */
export function splitCallArguments(text) {
  /** @type {string[]} */ const out = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== '\\') {
      const close = text.indexOf('"', i + 1);
      const end = close === -1 ? i : close;
      current += text.slice(i, end + 1);
      i = end;
    } else if (c === '(' || c === '[') {
      depth++;
      current += c;
    } else if (c === ')' || c === ']') {
      depth--;
      current += c;
    } else if (c === ',' && depth <= 0) {
      out.push(current.trim());
      current = '';
    } else current += c;
  }
  if (current !== '') out.push(current.trim());
  return out;
}

// ---- elements -----------------------------------------------------------------------------------------------------------------

/** The lines of the paragraph around `line`: blank lines, source blocks and keywords end it. @param {string[]} lines @param {number} line */
function paragraphAround(lines, line) {
  const inBlock = new Set();
  for (const b of scanSourceBlocks(lines)) for (let i = b.beginIndex; i <= b.endIndex; i++) inBlock.add(i);
  const plain = (/** @type {number} */ i) => i >= 0 && i < lines.length && lines[i].trim() !== '' && !inBlock.has(i) && !/^\s*#\+(begin_|end_|call:)/i.test(lines[i]);
  if (!plain(line)) return null;
  let start = line;
  while (plain(start - 1)) start--;
  let end = line;
  while (plain(end + 1)) end++;
  return { start, end: end + 1 };
}

/**
 * @typedef {{ type: 'src-block', line: number, endLine: number, scan: ReturnType<typeof scanSourceBlocks>[number] }
 *   | { type: 'babel-call', line: number, parsed: NonNullable<ReturnType<typeof parseCallLine>> }
 *   | { type: 'inline-src-block' | 'inline-babel-call', line: number, paragraph: { start: number, end: number }, object: InlineObject }} Element
 */

/** The source block, `#+CALL:` line or inline object at `point` (`org-element-context`), or null. @param {string[]} lines @param {Point} point @returns {Element | null} */
export function elementAt(lines, point) {
  // an element goes on to the blank lines after it
  const blanksAfter = (/** @type {number} */ from) => {
    let last = from;
    while (last + 1 < lines.length && lines[last + 1].trim() === '') last++;
    return last;
  };
  for (const scan of scanSourceBlocks(lines)) {
    let first = scan.beginIndex;
    while (first > 0 && /^\s*#\+(NAME|HEADERS?|CAPTION|ATTR_\w+|PLOT)\s*:/i.test(lines[first - 1])) first--;
    if (point.line >= first && point.line <= blanksAfter(scan.endIndex)) return { type: 'src-block', line: scan.beginIndex, endLine: scan.endIndex, scan };
  }
  for (let k = point.line; k >= 0 && (k === point.line || lines[k].trim() === ''); k--) {
    const parsed = parseCallLine(lines[k] ?? '');
    if (parsed) return { type: 'babel-call', line: k, parsed };
    if (lines[k].trim() !== '') break;
  }
  const paragraph = paragraphAround(lines, point.line);
  if (!paragraph) return null;
  const text = lines.slice(paragraph.start, paragraph.end).join('\n');
  let offset = point.col;
  for (let i = paragraph.start; i < point.line; i++) offset += lines[i].length + 1;
  const object = inlineObjects(text).find((o) => o.begin <= offset && offset <= o.end);
  return object ? { type: object.type, line: point.line, paragraph, object } : null;
}

/** Every executable element of the lines in order: source blocks, `#+CALL:` lines and inline objects (`org-babel-map-executables`). @param {string[]} lines @returns {{ element: Element, point: Point }[]} */
export function executableElements(lines) {
  /** @type {{ element: Element, point: Point }[]} */ const out = [];
  const blocks = scanSourceBlocks(lines);
  const covered = new Set();
  for (const b of blocks) {
    for (let i = b.beginIndex; i <= b.endIndex; i++) covered.add(i);
    out.push({ element: { type: 'src-block', line: b.beginIndex, endLine: b.endIndex, scan: b }, point: { line: b.beginIndex, col: 0 } });
  }
  lines.forEach((l, i) => {
    if (covered.has(i)) return;
    const parsed = parseCallLine(l);
    if (parsed) out.push({ element: { type: 'babel-call', line: i, parsed }, point: { line: i, col: 0 } });
  });
  let i = 0;
  while (i < lines.length) {
    const paragraph = covered.has(i) ? null : paragraphAround(lines, i);
    if (!paragraph) {
      i++;
      continue;
    }
    const text = lines.slice(paragraph.start, paragraph.end).join('\n');
    for (const object of inlineObjects(text)) {
      let line = paragraph.start;
      let col = object.begin;
      while (col > lines[line].length) col -= lines[line++].length + 1;
      out.push({ element: { type: object.type, line, paragraph, object }, point: { line, col } });
    }
    i = paragraph.end;
  }
  return out.sort((a, b) => a.point.line - b.point.line || a.point.col - b.point.col);
}

// ---- header arguments of a call or an inline block ----------------------------------------------------------------------------

/** The `[name, value]` pairs of merged arguments, `:var` one by one, as a layer for `mergeHeaderArgs`. @param {Record<string, any>} args @returns {string[][]} */
function pairsOf(args) {
  /** @type {string[][]} */ const out = [];
  for (const [name, value] of Object.entries(args)) {
    if (name === 'var') for (const v of value) out.push(['var', v]);
    else if (value !== '' || name === 'results' || name === 'exports') out.push([name, String(value)]);
    else out.push([name, '']);
  }
  return out;
}

/** What a header argument line holds as pairs, `:name value`. @param {string | null | undefined} text @returns {string[][]} */
const pairsFromText = (text) => (text ? splitHeaderArgs(text) : []);

/** `org-babel-merge-params` positions: an argument without a name goes to the variable the called block declares at that place. @param {string[]} given @param {string[]} declared @returns {string[][]} */
function callVariables(given, declared) {
  return given.map((a, i) => {
    if (/^[^=\s]+\s*=/.test(a)) return ['var', a];
    if (declared[i]) return ['var', `${declared[i]}=${a}`];
    throw new Error(`Reference \`${a}' not found in this buffer`);
  });
}

/** The source block or library entry a call names: `{ lang, langText, body, args, name, block }`, or null. @param {Doc} doc @param {ReturnType<typeof collectDocumentBlocks>} all @param {string} name */
function calledSource(doc, all, name) {
  const block = all.find((b) => b.name === name);
  if (block) return { lang: block.lang, langText: block.langText, body: block.emacsBody, args: block.args, block };
  const entry = babelLibrary.get(name);
  if (entry) return { lang: entry.lang, langText: entry.langText, body: entry.body, args: entry.args, block: null };
  return null;
}

/**
 * The information `org-babel-lob-get-info` returns for a call: the called block's code and header arguments merged with the call's own
 * (the called block's, then `:exports results`, the properties where the call stands, the `[inside]` arguments, the arguments as `:var`, the
 * end arguments), or null when nothing has that name.
 * @param {{ doc: Doc, all: any[], ancestors: Heading[] }} env
 * @param {{ call: string | null, inside: string | null, args: string | null, endHeader: string | null }} call
 * @param {string | null} name the `#+NAME:` of a call line
 */
export function callInfo(env, call, name) {
  const source = call.call === null ? null : calledSource(env.doc, env.all, call.call);
  if (!source) return null;
  const declared = (source.args.var || []).map((/** @type {string} */ v) => (/^([^=\s]+)\s*=/.exec(v) || [])[1] || '');
  const given = call.args ? splitCallArguments(call.args) : [];
  const lang = source.lang;
  const general = inheritedProperty(env.doc, env.ancestors, 'header-args');
  const specific = lang ? inheritedProperty(env.doc, env.ancestors, 'header-args:' + lang) : null;
  const layers = [pairsOf(source.args), [['exports', 'results']], pairsFromText(general), pairsFromText(specific), pairsFromText(call.inside), callVariables(given, declared), pairsFromText(call.endHeader)];
  return { lang, langText: source.langText, code: source.body, args: mergeHeaderArgs(layers), name, block: source.block };
}

/** The effective arguments of an inline source block: Org's inline defaults, the properties where it stands, then its own `[headers]`. @param {{ doc: Doc, ancestors: Heading[] }} env @param {InlineObject} object */
export function inlineSrcInfo(env, object) {
  const lang = String(object.lang || '').toLowerCase();
  const inlineDefaults = [['session', 'none'], ['results', 'replace'], ['exports', 'results'], ['hlines', 'yes']];
  const general = inheritedProperty(env.doc, env.ancestors, 'header-args');
  const specific = inheritedProperty(env.doc, env.ancestors, 'header-args:' + lang);
  const langDefaults = lang === 'emacs-lisp' || lang === 'elisp' ? [['lexical', 'no']] : [];
  const layers = [inlineDefaults, langDefaults, pairsFromText(general), pairsFromText(specific), pairsFromText(object.parameters)];
  return { lang, langText: String(object.lang), code: String(object.value), args: mergeHeaderArgs(layers), name: null, block: null };
}

// ---- running ------------------------------------------------------------------------------------------------------------------

/** A reference's value, or a result list, as a Lisp object. @param {unknown} v */
function valueToLisp(v) {
  return toLisp(Array.isArray(v) ? v.map((r) => (r === HLINE ? 'hline' : r)) : v);
}

/**
 * The file a block writes its results to (`org-babel-generate-file-param`): `:file` under `:output-dir`, or `NAME.EXT` for `:file-ext`.
 * @param {Record<string, any>} args @param {string | null | undefined} name @returns {string | null}
 */
export function resultFile(args, name) {
  const dir = args['output-dir'] ? String(args['output-dir']).replace(/\/?$/, '/') : '';
  if (args.file !== undefined) return dir + args.file;
  if (name && args['file-ext']) return dir + name + '.' + args['file-ext'];
  return null;
}

/**
 * The link text for a results file, as `org-babel-result-to-file` writes it: relative to the document, so a `:dir` below the document's
 * folder shows in the path. (The document's own folder is the one the app has no name for, so a path that leaves it is written as it is.)
 * @param {string} file @param {string | undefined} dir @param {string | null} description
 */
export function fileLink(file, dir, description) {
  let path = file;
  if (dir && !/^\.?\/?$/.test(dir) && !file.startsWith('/')) path = normalizePath(dir.replace(/\/?$/, '/') + file);
  return `[[file:${path}]${description === null ? '' : `[${description}]`}]`;
}

/** `a/./b/../c` as `a/c`; a path that climbs out keeps its `..`. @param {string} path */
function normalizePath(path) {
  const absolute = path.startsWith('/');
  /** @type {string[]} */ const out = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && out.length && out[out.length - 1] !== '..') out.pop();
    else if (part !== '..' || !absolute) out.push(part);
  }
  return (absolute ? '/' : '') + out.join('/');
}

/**
 * Evaluates what `info` describes. Returns `{ skipped: true }` when `:eval` forbids it; throws the error Emacs would stop with.
 * `deps.runJs(request)` runs a JavaScript block (without it only Emacs Lisp runs).
 * @param {{ doc: Doc, all: any[] }} env
 * @param {{ lang: string, code: string, args: Record<string, any>, name?: string | null, block?: any }} info
 * @param {{ runJs?: (request: { code: string, vars: Record<string, unknown> }) => Promise<any> }} [deps]
 * @returns {Promise<{ skipped: true } | { skipped: false, value: import('./elisp-data.js').LObj, js: null, spec: ReturnType<typeof parseResultsSpec>, args: Record<string, any> } | { skipped: false, value: null, js: any, spec: ReturnType<typeof parseResultsSpec>, args: Record<string, any> }>}
 */
export async function evaluateInfo(env, info, deps = {}) {
  const args = info.args;
  const spec = parseResultsSpec(args.results);
  if (spec.unsupported) throw new Error(`Unsupported :results option "${spec.unsupported}".`);
  if (!evalAllowed(args)) return { skipped: true };
  /** @type {import('./babel.js').TableNames} */ const names = {};
  let vars = resolveVars(args.var, referenceLookup(env.doc, env.all), { colnames: args.colnames, rownames: args.rownames, hlines: args.hlines, names });
  let code = info.code;
  if (info.block && nowebAllows(args, 'eval')) code = expandNoweb(env.doc, env.all, info.block);
  const lisp = isElispBlock({ name: 'SRC', params: info.lang });
  if (lisp) {
    const outcome = runElisp({ code, vars, spec, lexical: args.lexical, names: pickedNames(args, names) });
    if (!outcome.ok) throw new Error(outcome.message);
    return { skipped: false, value: outcome.value, js: null, spec, args };
  }
  if (!deps.runJs) throw new Error(`No org-babel-execute function for ${info.lang}!`);
  vars = plainVariables(vars);
  return { skipped: false, value: null, js: await deps.runJs({ code, vars }), spec, args };
}

/** The value of a `:post` reference, `NAME(*this*)` or `NAME`: that block (or table) run with `*this*` bound to the result. @param {{ doc: Doc, all: any[] }} env @param {string} post @param {unknown} thisValue */
function resolvePost(env, post, thisValue) {
  const parts = /^([^()[\]]+)(?:\[([\s\S]*)\])?(?:\(([\s\S]*)\))?$/.exec(post.trim());
  const name = parts ? parts[1].trim() : post.trim();
  const found = referenceLookup(env.doc, env.all, 0, thisValue)(name, parts?.[3]);
  if (!found) throw new Error(`Reference \`${name}' not found in this buffer`);
  return Array.isArray(found) ? found : found.value;
}

/**
 * The result a block gives, as lines under `#+RESULTS:` (`org-babel-insert-result`): `:file` links, `:post`, formats.
 * @param {{ doc: Doc, all: any[] }} env
 * @param {Exclude<Awaited<ReturnType<typeof evaluateInfo>>, { skipped: true }>} outcome
 * @param {{ lang: string, name?: string | null }} info
 * @returns {string[] | null} null for `:results silent`
 */
export function blockResultLines(env, outcome, info) {
  const { args } = outcome;
  let spec = outcome.spec;
  if (outcome.js) {
    const out = outcome.js;
    if (!out.ok) return formatError(String(out.message), out.line || null);
    return spec.silent ? null : formatResult(spec.collect === 'output' ? out.output : out.hasValue ? out.value : undefined, spec, { wrap: args.wrap === undefined ? null : args.wrap, lang: info.lang });
  }
  let value = /** @type {import('./elisp-data.js').LObj} */ (outcome.value);
  const file = spec.file ? resultFile(args, info.name) : null;
  const description = args['file-desc'] === undefined ? null : readHeaderValue(args['file-desc']);
  if (args.post !== undefined) {
    const linked = file !== null ? fileLink(file, args.dir, description === '' ? file : description) : null;
    const posted = resolvePost(env, String(readHeaderValue(args.post)), linked ?? value);
    value = valueToLisp(posted);
    if (file !== null) spec = parseResultsSpec(String(args.results).replace(/\bfile\b/g, ''));
  }
  if (spec.silent) return null;
  return formatElispResult(value, spec, { wrap: args.wrap === undefined ? null : args.wrap, file: spec.file && file !== null ? fileLink(file, args.dir, null).slice(7, -2) : null, fileDesc: description });
}

// ---- inline results -----------------------------------------------------------------------------------------------------------

/** `org-macro-escape-arguments` for one argument: a comma gets a backslash, and the backslashes before it are doubled. @param {string} s */
const escapeMacroArgument = (s) => s.replace(/(\\*),/g, (_m, slashes) => '\\'.repeat(1 + 2 * slashes.length) + ',');

/** `(format org-babel-inline-result-wrap text)`. @param {string} text */
const wrapInline = (text) => babelOptions.inlineWrap.replace(/%(.)/g, (_m, c) => (c === 's' ? text : c === '%' ? '%' : _m));

/**
 * The `{{{results(...)}}}` text an inline block or call leaves, or null for an empty result (`org-babel-insert-result` with an inline
 * context). Throws the "Inline error" Emacs stops with for a table or list.
 * @param {import('./elisp-data.js').LObj | string | null} value what the block gave; `null` is nil
 * @param {Record<string, any>} args @param {string} lang @param {ReturnType<typeof parseResultsSpec>} spec
 * @param {{ info: { name?: string | null } }} [context]
 */
export function inlineResultText(value, args, lang, spec, context) {
  const words = spec.words;
  /** @type {string | null} */ let result;
  /** @type {boolean} */ let isList = false;
  if (value !== null && value !== NIL && isLiteralResult(spec)) result = words.has('code') || words.has('pp') ? pretty(/** @type {import('./elisp-data.js').LObj} */ (value)) : print(/** @type {import('./elisp-data.js').LObj} */ (value), words.has('scalar') || words.has('verbatim'));
  else if (value === null || value === NIL) result = null;
  else if (typeof value === 'string') result = value;
  else if (value instanceof Cons) {
    isList = true;
    result = '';
  } else result = print(value, true);
  const resultWords = String(args.results || '').split(/\s+/);
  const target = spec.file ? resultFile(args, context && context.info.name) : null;
  if (spec.file && (target !== null || typeof value === 'string')) {
    const file = target ?? /** @type {string} */ (value);
    const description = args['file-desc'] === undefined ? null : readHeaderValue(args['file-desc']);
    result = fileLink(file, args.dir, description === '' ? file : description);
  }
  const warning = (words.has('table') && "`:results table'") || (isList && 'list result') || (result !== null && /\n./.test(result) && 'multiline result') || (resultWords.includes('list') && "`:results list'");
  if (warning) throw new Error(`Inline error: ${warning} cannot be used`);
  if (result === null) return null;
  const file = spec.file;
  const body = file ? escapeMacroArgument(result) : !words.has('raw') ? escapeMacroArgument(result.replace(/\n+$/, '')) : result;
  if (args.wrap !== undefined) {
    const full = String(args.wrap || 'results');
    const split = full.split(/\s+/);
    const type = split[0].toLowerCase();
    if (type === 'export') return `{{{results(@@${split.length > 1 ? split[1] : 'none'}:${body}@@)}}}`;
    if (type === 'example') return `{{{results(=${body}=)}}}`;
    if (type === 'src') return `{{{results(src_${split.length === 1 ? 'none' : split.length === 2 ? split[1] : `${split[1]}[${split.slice(2).join(' ')}]`}{${body}})}}}`;
    return `{{{results(${body})}}}`;
  }
  if (words.has('html')) return `{{{results(@@html:${body}@@)}}}`;
  if (words.has('latex')) return `{{{results(@@latex:${body}@@)}}}`;
  if (words.has('org')) return `{{{results(src_org{${body}})}}}`;
  if (words.has('code')) return `{{{results(src_${lang || 'none'}[${args.results_switches ? ' ' + args.results_switches : ''}]{${body}})}}}`;
  if (words.has('raw')) return body;
  if (words.has('drawer') || words.has('wrap')) return `{{{results(${body})}}}`;
  if (file) return `{{{results(${body})}}}`;
  return `{{{results(${wrapInline(body)})}}}`;
}

/** The `{{{results(...)}}}` macro that follows an inline object, within its paragraph, or null. @param {string} text @param {InlineObject} object @returns {{ begin: number, end: number } | null} */
export function inlineResultMacro(text, object) {
  let at = object.end;
  while (at < text.length && /[ \t\n]/.test(text[at])) at++;
  if (at >= text.length) return null;
  const m = /^\{\{\{results\(/.exec(text.slice(at));
  if (!m) return null;
  const close = text.indexOf(')}}}', at);
  if (close === -1) return null;
  return { begin: at, end: close + 4 };
}

/** The text with the result of an inline object replaced by `macro` (`org-babel-insert-result`): any old result goes, a space and the new one follow the object. @param {string} text @param {InlineObject} object @param {string | null} macro */
export function putInlineResult(text, object, macro) {
  let out = text;
  const old = inlineResultMacro(text, object);
  if (old) out = out.slice(0, old.begin) + out.slice(old.end + (text[old.end] === ' ' || text[old.end] === '\t' ? 1 : 0)); // the blank after it goes too
  let at = object.end;
  while (at > 0 && (out[at - 1] === ' ' || out[at - 1] === '\t')) at--;
  return out.slice(0, at) + ' ' + (macro ?? '') + out.slice(at);
}

// ---- executing an element ---------------------------------------------------------------------------------------------------

/**
 * What an element runs (`org-babel-get-src-block-info`, `org-babel-lob-get-info`): language, code, effective header arguments and name; null for a
 * call nothing answers to.
 * @param {{ doc: Doc, all: any[], ancestors: Heading[], lines: string[] }} env @param {Element} element
 */
export function elementInfo(env, element) {
  if (element.type === 'src-block') {
    const block = env.all.find((b) => b.beginIndex === element.line && b.ancestors[b.ancestors.length - 1] === env.ancestors[env.ancestors.length - 1]);
    return block ? { lang: block.lang, code: block.emacsBody, args: block.args, name: block.name, block } : null;
  }
  if (element.type === 'babel-call') return callInfo(env, element.parsed, affiliatedName(env.lines, element.line));
  const object = element.object;
  if (object.type === 'inline-src-block') return inlineSrcInfo(env, object);
  return callInfo(env, { call: object.call ?? null, inside: object.inside ?? null, args: object.args ?? null, endHeader: object.endHeader ?? null }, null);
}

/**
 * Executes the element at `point` as C-c C-c would (`org-babel-execute-maybe`): the new lines of the section, or null when the element
 * asks for nothing to be written (`:eval never`, `:results silent`). Throws when the point is on nothing executable, or the error the
 * block ends with.
 * @param {{ doc: Doc, all: any[], ancestors: Heading[], lines: string[] }} env
 * @param {Element} element
 * @param {{ runJs?: (request: { code: string, vars: Record<string, unknown> }) => Promise<any> }} [deps]
 * @returns {Promise<{ start: number, removeCount: number, insert: string[] } | null>}
 */
export async function executeElement(env, element, deps) {
  const { lines } = env;
  if (element.type === 'src-block') {
    const info = elementInfo(env, element);
    if (!info) throw new Error('Not in a source block');
    const block = info.block;
    const outcome = await evaluateInfo(env, info, deps);
    if (outcome.skipped) return null;
    const result = blockResultLines(env, outcome, info);
    if (result === null) return null;
    return placeResults(lines, { lineIndex: block.beginIndex, lineCount: block.endIndex - block.beginIndex + 1 }, result, { handling: outcome.spec.handling, name: block.name || '' });
  }
  if (element.type === 'babel-call') {
    const name = affiliatedName(lines, element.line);
    const info = elementInfo(env, element);
    if (!info) throw new Error('not on anything executable');
    const outcome = await evaluateInfo(env, info, deps);
    if (outcome.skipped) return null;
    const result = blockResultLines(env, outcome, info);
    if (result === null) return null;
    return placeResults(lines, { lineIndex: element.line, lineCount: 1 }, result, { handling: outcome.spec.handling, name: name || '' });
  }
  const { object, paragraph } = element;
  const info = elementInfo(env, element);
  if (!info) throw new Error('not on anything executable');
  const outcome = await evaluateInfo(env, info, deps);
  if (outcome.skipped) return null;
  const text = lines.slice(paragraph.start, paragraph.end).join('\n');
  let macro;
  if (outcome.js) {
    if (!outcome.js.ok) throw new Error(String(outcome.js.message));
    const v = outcome.spec.collect === 'output' ? outcome.js.output : outcome.js.value;
    macro = inlineResultText(Array.isArray(v) ? toLisp(v) : v === undefined || v === null ? null : String(v), outcome.args, info.lang, outcome.spec);
  } else {
    let value = outcome.value;
    if (outcome.args.post !== undefined) value = valueToLisp(resolvePost(env, String(readHeaderValue(outcome.args.post)), value));
    if (outcome.spec.silent) return null;
    macro = inlineResultText(value, outcome.args, info.lang, outcome.spec, { info });
  }
  if (outcome.spec.silent) return null;
  const replaced = putInlineResult(text, object, macro).split('\n');
  return { start: paragraph.start, removeCount: paragraph.end - paragraph.start, insert: replaced };
}

/** The `#+NAME:` of the element that starts at `line`, from the affiliated keywords right above it. @param {string[]} lines @param {number} line @returns {string | null} */
function affiliatedName(lines, line) {
  for (let k = line - 1; k >= 0; k--) {
    const m = /^\s*#\+(NAME|HEADERS?|CAPTION|ATTR_\w+|PLOT)\s*:\s*(.*)$/i.exec(lines[k]);
    if (!m) return null;
    if (m[1].toUpperCase() === 'NAME') return m[2].trim();
  }
  return null;
}

// ---- results: where, remove ---------------------------------------------------------------------------------------------------

/**
 * The place of the results of the element at `point` (`org-babel-where-is-src-block-result`): the `#+RESULTS:` line, or the
 * `{{{results(` of an inline object; null when it has none.
 * @param {string[]} lines @param {Element} element @param {string | null} name
 * @returns {Point | null}
 */
export function resultsPlace(lines, element, name) {
  if (element.type === 'inline-src-block' || element.type === 'inline-babel-call') {
    const text = lines.slice(element.paragraph.start, element.paragraph.end).join('\n');
    const macro = inlineResultMacro(text, element.object);
    if (!macro) return null;
    let line = element.paragraph.start;
    let col = macro.begin;
    while (col > lines[line].length) col -= lines[line++].length + 1;
    return { line, col };
  }
  const last = element.type === 'src-block' ? element.endLine : element.line;
  if (name) {
    const re = new RegExp('^\\s*#\\+' + babelOptions.resultsKeyword + '.*?:[ \\t]*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*$', 'i');
    const at = lines.findIndex((l) => re.test(l));
    return at === -1 ? null : { line: at, col: 0 };
  }
  let k = last + 1;
  while (k < lines.length && lines[k].trim() === '') k++;
  // the next element must be a `#+RESULTS:` keyword with nothing after it, directly below the block (blank lines allowed)
  if (k < lines.length && /^\s*#\+RESULTS(?:\[[^\]]*\])?:\s*$/i.test(lines[k])) return { line: k, col: 0 };
  return null;
}

/**
 * Removes the results of a source block or call (`org-babel-remove-result`): the `#+RESULTS:` line with what follows, and the blank
 * line before it.
 * @param {string[]} lines @param {Element} element @param {string | null} name
 * @returns {{ start: number, removeCount: number, insert: string[] } | null}
 */
export function removeResult(lines, element, name) {
  // (an inline result is not removed by org-babel-remove-result: its keyword line is what it looks for)
  if (element.type === 'inline-src-block' || element.type === 'inline-babel-call') return null;
  const at = resultsPlace(lines, element, name);
  if (!at) return null;
  const end = resultsEnd(lines, at.line);
  let from = at.line;
  while (from > 0 && lines[from - 1].trim() === '') from--;
  // the blank lines before the keyword go with it, but the line right after the element stays
  const startOfRemoval = from > 0 ? from : at.line;
  return { start: Math.max(startOfRemoval, (element.type === 'src-block' ? element.endLine : element.line) + 1), removeCount: end - Math.max(startOfRemoval, (element.type === 'src-block' ? element.endLine : element.line) + 1), insert: [] };
}

// ---- moving between blocks ------------------------------------------------------------------------------------------------------

/** @typedef {{ heading: Heading | null, line: number }} DocPoint a place in the document: a section (null before the first heading) and a line of its body (-1 for the heading line) */

/**
 * The place of the COUNT-th source block after (or, backward, before) `from` (`org-babel-next-src-block`, `org-babel-previous-src-block`):
 * the `#+BEGIN_SRC` line. Throws "No further code blocks" or "No previous code blocks" when there are not that many.
 * @param {Doc} doc @param {DocPoint} from @param {number} count @param {boolean} backward
 * @returns {DocPoint}
 */
export function moveToSrcBlock(doc, from, count, backward) {
  const order = new Map();
  /** @param {Heading} h */
  const number = (h) => {
    order.set(h, order.size);
    for (const c of h.children || []) number(c);
  };
  for (const h of doc.children || []) number(h);
  const key = (/** @type {Heading | null} */ h, /** @type {number} */ line) => [h ? order.get(h) : -1, line];
  const [fh, fl] = key(from.heading, from.line);
  const blocks = collectDocumentBlocks(doc).map((b) => ({ heading: b.heading, line: b.beginIndex, key: key(b.heading, b.beginIndex), endKey: key(b.heading, b.endIndex) }));
  const candidates = blocks.filter((b) => (backward ? b.endKey[0] < fh || (b.endKey[0] === fh && b.endKey[1] < fl) : b.key[0] > fh || (b.key[0] === fh && b.key[1] > fl)));
  if (backward) candidates.reverse();
  if (count === 0) throw new Error('Wrong type argument: integer-or-marker-p, nil'); // Emacs looks for the block it did not find
  if (count < 1 || candidates.length < count) throw new Error(`No ${backward ? 'previous' : 'further'} code blocks`);
  const target = candidates[count - 1];
  return { heading: target.heading, line: target.line };
}
