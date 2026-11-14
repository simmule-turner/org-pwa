// @ts-check
/** @typedef {import('./types.js').Doc} Doc */
/**
 * #+INCLUDE: "path[::search]" [block-type [arguments]] [:lines "N-M"] [:minlevel N] [:only-contents t]
 *
 * Expands `#+INCLUDE:` as Org's export does (org-export-expand-include-keyword): the included text is put where the keyword was, before
 * anything else is read, and the whole is parsed again. That is why the keywords of an included Org file (#+MACRO:, #+TITLE: ...), its text
 * before the first heading and its macros all count in the including document.
 *
 *  - An Org file (no block type): its blank lines at both ends are dropped, its headings are moved so that the shallowest one has
 *    `:minlevel` stars (by default one more than the heading the keyword is under, or 1 before the first heading), and the indentation
 *    of the keyword is kept up to the first heading. `path::*Heading`, `path::#custom-id`, `path::name`, `path::/regexp/` (Emacs
 *    syntax) or `path::some text` include just that part, with `:only-contents t` only what is inside it.
 *  - `example`, `src [language ...]`, `export [backend]` (or any other word): the text goes in a block of that name, as it is.
 *  - `:lines "N-M"` keeps lines N up to, not counting, M (either may be left out).
 *  - Left as the app has it: a file that cannot be read, a search that finds nothing, or an include that includes itself is skipped
 *    where Emacs stops with an error; footnote labels of an included file are not renamed and relative file links in it are not
 *    rewritten.
 */

import { serializeOrg } from './org-parser.js';
import { emacsRegexToJs } from './elisp-regex.js';
import { formatSize, getSizeLimits, utf8Length } from './size-limits.js';

/** @param {string} s */
const quoteRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What the value of one #+INCLUDE: keyword says, read with the same patterns as Org's.
 * `path` is null when there is none; `minlevel` is undefined unless `:minlevel` is given.
 * @param {string} value
 * @returns {{ path: string | null, location: string | null, onlyContents: boolean, lines: string | null, literal: boolean, args: string | null, minlevel: number | undefined, block: string | null }}
 */
export function parseIncludeValue(value) {
  let rest = value.trim();
  /** @type {string | null} */
  let path = null;
  /** @type {string | null} */
  let location = null;
  const file = /^("[^"]+?"|\S+)(?:\s+|$)/.exec(rest);
  if (file) {
    let matched = file[1];
    const at = /(::(.*?))"?$/.exec(matched);
    if (at) {
      location = at[2];
      matched = matched.slice(0, at.index) + matched.slice(at.index + at[1].length);
    }
    path = matched.replace(/^"(.*)"$/, '$1');
    rest = rest.slice(file[0].length);
  }
  let onlyContents = false;
  const only = /:only-contents *([^: \r\t\n]\S*)?/.exec(rest);
  if (only) {
    onlyContents = only[1] !== undefined && only[1] !== 'nil';
    rest = rest.replace(only[0], '');
  }
  /** @type {string | null} */
  let lines = null;
  const range = /:lines +"([0-9]*-[0-9]*)"/.exec(rest);
  if (range) {
    lines = range[1];
    rest = rest.replace(range[0], '');
  }
  let literal = false;
  /** @type {string | null} */
  let args = null;
  const example = /\bexample\b/i.exec(rest);
  const exported = /\bexport(?: +(.*))?/i.exec(rest);
  const source = /\bsrc(?: +(.*))?/i.exec(rest);
  if (example) literal = true;
  else if (exported) {
    literal = true;
    args = exported[1] ?? null;
  } else if (source) {
    literal = true;
    args = source[1] ?? null;
  }
  /** @type {number | undefined} */
  let minlevel;
  if (!literal) {
    const level = /:minlevel +([0-9]+)/.exec(rest);
    if (level) {
      minlevel = Number(level[1]);
      rest = rest.replace(level[0], '');
    }
  }
  const word = /\b(\S+)\b/.exec(rest);
  return { path, location, onlyContents, lines, literal, args, minlevel, block: word ? word[1] : null };
}

/**
 * Applies a `:lines` range ("N-M", "-M", "N-"; lines count from 1, M is not included) to an array of lines.
 * @param {string[]} lines
 * @param {string | null} spec
 */
export function applyLineRange(lines, spec) {
  if (!spec) return lines;
  const m = /^(\d*)-(\d*)$/.exec(spec.trim());
  if (!m) return lines;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return lines.slice(start === 0 ? 0 : start - 1, end === 0 ? lines.length : end - 1);
}

const INCLUDE_RE = /^([ \t]*)#\+INCLUDE:(.*)$/i;
const HEADLINE_RE = /^(\*+) /;
const BEGIN_RE = /^[ \t]*#\+BEGIN_(\S+)/i;
const LITERAL_BLOCK_RE = /^(?:SRC|EXAMPLE|EXPORT|COMMENT)$/i;
const COMMENTED_RE = /^\*+ +(?:[A-Z][A-Z0-9_-]* +)?(?:\[#.\] +)?COMMENT(?: |$)/;
const AFFILIATED_RE = /^[ \t]*#\+(?:NAME|CAPTION|HEADERS?|ATTR_\w+|PLOT|RESULTS)(?:\[.*\])?:/i;

/** @param {string} line */
const isBlank = (line) => line.trim() === '';

/** The title of a headline line: no stars, TODO keyword, priority, statistics cookie or tags. @param {string} line */
function headlineTitle(line) {
  return line
    .replace(/^\*+ +/, '')
    .replace(/[ \t]+:[\w@#%:]+:[ \t]*$/, '')
    .replace(/^(?:[A-Z][A-Z0-9_-]* +)?(?:\[#.\] +)?/, '')
    .replace(/^\[[0-9/%]*\] */, '')
    .replace(/ *\[[0-9/%]*\]$/, '')
    .trim();
}

/** The index after the headline at `from` and everything beneath it. @param {string[]} lines @param {number} from */
function subtreeEnd(lines, from) {
  const level = /** @type {RegExpExecArray} */ (HEADLINE_RE.exec(lines[from]))[1].length;
  let i = from + 1;
  while (i < lines.length) {
    const m = HEADLINE_RE.exec(lines[i]);
    if (m && m[1].length <= level) break;
    i++;
  }
  return i;
}

/**
 * The element a line belongs to, as lines: where it begins, where it ends (blank lines after it included) and where its contents are.
 * @param {string[]} lines @param {number} at
 * @returns {{ begin: number, end: number, contents: [number, number] }}
 */
function elementAt(lines, at) {
  const afterBlanks = (/** @type {number} */ i) => {
    while (i < lines.length && isBlank(lines[i])) i++;
    return i;
  };
  if (HEADLINE_RE.test(lines[at])) {
    const end = subtreeEnd(lines, at);
    let first = at + 1;
    if (first < end && /^\s*(?:SCHEDULED|DEADLINE|CLOSED):/.test(lines[first])) first++;
    if (first < end && /^\s*:PROPERTIES:\s*$/i.test(lines[first])) {
      while (first < end && !/^\s*:END:\s*$/i.test(lines[first])) first++;
      first++;
    }
    return { begin: at, end, contents: [Math.min(first, end), end] };
  }
  // a block that holds the line
  for (let b = at; b >= 0 && !HEADLINE_RE.test(lines[b]); b--) {
    const open = BEGIN_RE.exec(lines[b]);
    if (!open) continue;
    const close = new RegExp(`^[ \\t]*#\\+END_${quoteRegExp(open[1])}\\s*$`, 'i');
    let k = b + 1;
    while (k < lines.length && !close.test(lines[k])) k++;
    if (k >= at) return { begin: b, end: afterBlanks(Math.min(k + 1, lines.length)), contents: [b + 1, k] };
    break;
  }
  let begin = at;
  while (begin > 0 && AFFILIATED_RE.test(lines[begin - 1])) begin--;
  let end = at + 1;
  if (AFFILIATED_RE.test(lines[at])) {
    while (end < lines.length && AFFILIATED_RE.test(lines[end])) end++;
    if (end < lines.length && BEGIN_RE.test(lines[end])) return { ...elementAt(lines, end), begin };
  }
  if (/^\s*\|/.test(lines[end - 1] ?? '')) while (end < lines.length && /^\s*\|/.test(lines[end])) end++;
  else while (end < lines.length && !isBlank(lines[end]) && !HEADLINE_RE.test(lines[end])) end++;
  let first = begin;
  while (first < end && AFFILIATED_RE.test(lines[first])) first++;
  return { begin, end: afterBlanks(end), contents: [first, end] };
}

/**
 * The lines of a file that `path::location` names (org-export--inclusion-absolute-lines), with `:lines` applied to them.
 * Null when the search finds nothing.
 * @param {string[]} lines @param {string} location @param {boolean} onlyContents @param {string | null} range
 * @returns {string[] | null}
 */
function locate(lines, location, onlyContents, range) {
  const text = location.trim();
  /** @type {number} */
  let at;
  const headings = lines.map((l, i) => (HEADLINE_RE.test(l) ? i : -1)).filter((i) => i >= 0);
  /** The line holding the end of the first match of `re` in the whole text. @param {RegExp} re */
  const find = (re) => {
    const whole = lines.join('\n');
    const hit = re.exec(whole);
    return hit ? whole.slice(0, hit.index + hit[0].length).split('\n').length - 1 : -1;
  };
  if (text.startsWith('*')) {
    const want = text.slice(1).trim();
    at = headings.find((i) => headlineTitle(lines[i]) === want) ?? headings.find((i) => headlineTitle(lines[i]).includes(want)) ?? -1;
  } else if (text.startsWith('#')) {
    const id = new RegExp(`^\\s*:CUSTOM_ID:\\s+${quoteRegExp(text.slice(1))}\\s*$`, 'i');
    at = headings.find((i) => lines.slice(i + 1, subtreeEnd(lines, i)).some((l) => id.test(l))) ?? -1;
  } else if (text.length > 1 && text.startsWith('/') && text.endsWith('/')) {
    at = find(emacsRegexToJs(text.slice(1, -1)));
  } else {
    const name = new RegExp(`^[ \\t]*#\\+NAME:[ \\t]*${quoteRegExp(text)}[ \\t]*$`, 'i');
    at = lines.findIndex((l) => name.test(l));
    if (at < 0) at = lines.findIndex((l) => l.includes(`<<${text}>>`));
    if (at < 0) at = headings.find((i) => headlineTitle(lines[i]) === text) ?? -1;
    if (at < 0) at = find(new RegExp(text.split(/\s+/).map(quoteRegExp).join('\\s+'), 'i'));
  }
  if (at < 0) return null;
  const el = elementAt(lines, at);
  const region = onlyContents ? lines.slice(el.contents[0], el.contents[1]) : lines.slice(el.begin, el.end);
  const m = range && /^(\d*)-(\d*)$/.exec(range.trim());
  if (!m) return region;
  // Org counts the last line of the range from its first line here, not from the start of the region
  const start = m[1] ? Number(m[1]) - 1 : 0;
  return region.slice(start, Number(m[2]) ? start + Number(m[2]) - 1 : region.length);
}

/**
 * An included file's lines ready to go in (org-export--prepare-file-contents): blank lines at both ends dropped, the keyword's
 * indentation up to the first heading, and the headings moved to `minlevel`.
 * @param {string[]} lines @param {number} indent @param {number | null} minlevel
 */
function prepare(lines, indent, minlevel) {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start])) start++;
  while (end > start && isBlank(lines[end - 1])) end--;
  let out = lines.slice(start, end);
  if (indent > 0) {
    let heading = false;
    out = out.map((l) => {
      if (heading || HEADLINE_RE.test(l)) {
        heading = true;
        return l;
      }
      return /^\[fn:[^\]\s]+\]/.test(l) ? l : ' '.repeat(indent) + l;
    });
  }
  if (minlevel !== null) {
    const levels = out.map((l) => HEADLINE_RE.exec(l)).filter((m) => m !== null).map((m) => /** @type {RegExpExecArray} */ (m)[1].length);
    if (levels.length) {
      const offset = minlevel - Math.min(...levels);
      if (offset !== 0) out = out.map((l) => (HEADLINE_RE.test(l) ? (offset < 0 ? l.slice(-offset) : '*'.repeat(offset) + l) : l));
    }
  }
  return out;
}

/** What org-escape-code-in-string does to the lines of a block that is not parsed. @param {string[]} lines */
const escapeCode = (lines) => lines.map((l) => l.replace(/^([ \t]*)(,*(?:\*|#\+))/, '$1,$2'));

/** The directory part of a path, with its last slash, or ''. @param {string} path */
const directoryOf = (path) => path.slice(0, path.lastIndexOf('/') + 1);

/** @param {string} dir @param {string} path */
function resolvePath(dir, path) {
  if (!dir || path.startsWith('/') || path.startsWith('~') || /^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  /** @type {string[]} */
  const out = [];
  for (const part of (dir + path).split('/')) {
    if (part === '.') continue;
    if (part === '..' && out.length && out[out.length - 1] !== '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** @typedef {{ max: number, used: number, warned: boolean, onSkip?: (message: string) => void }} IncludeBudget */
/** @typedef {{ dir: string, included: string[], fetchPath: any, budget: IncludeBudget }} IncludeContext */

/**
 * `lines` with every #+INCLUDE: keyword replaced by what it includes (recursively).
 * @param {string[]} lines
 * @param {IncludeContext} ctx
 * @returns {Promise<string[]>}
 */
async function expandLines(lines, ctx) {
  /** @type {string[]} */
  const out = [];
  let level = 0; // the level of the headline the line is under
  let commented = 0; // the level of the commented headline it is under, or 0
  let block = '';
  for (const line of lines) {
    if (block) {
      if (new RegExp(`^[ \\t]*#\\+END_${quoteRegExp(block)}\\s*$`, 'i').test(line)) block = '';
      out.push(line);
      continue;
    }
    const open = BEGIN_RE.exec(line);
    if (open && LITERAL_BLOCK_RE.test(open[1])) {
      block = open[1];
      out.push(line);
      continue;
    }
    const head = HEADLINE_RE.exec(line);
    if (head) {
      level = head[1].length;
      if (commented && level <= commented) commented = 0;
      if (!commented && COMMENTED_RE.test(line)) commented = level;
      out.push(line);
      continue;
    }
    const m = INCLUDE_RE.exec(line);
    if (!m || commented) {
      out.push(line);
      continue;
    }
    out.push(...(await includeAt(m[1].length, m[2], level + 1, ctx)));
  }
  return out;
}

/**
 * The lines one #+INCLUDE: keyword stands for.
 * @param {number} indent @param {string} value @param {number} inducedLevel
 * @param {IncludeContext} ctx
 * @returns {Promise<string[]>}
 */
async function includeAt(indent, value, inducedLevel, ctx) {
  const d = parseIncludeValue(value);
  if (d.path === null) return [];
  const file = resolvePath(ctx.dir, d.path);
  const key = `${file}\u0000${d.lines ?? ''}`;
  if (ctx.included.includes(key)) return []; // a file that includes itself
  let result;
  try {
    result = await ctx.fetchPath(file);
  } catch {
    return [];
  }
  if (!result || typeof result.content !== 'string') return [];
  // Each file has its own size limit (where it is read); this one bounds all of them together, so many #+INCLUDE lines
  // cannot add up to a document larger than the app would open.
  const { budget } = ctx;
  const bytes = utf8Length(result.content);
  if (budget.max > 0 && budget.used + bytes > budget.max) {
    if (!budget.warned) budget.onSkip?.(`Not included: "${d.path}" would take the included files past ${formatSize(budget.max)} in all. Set org-xx-size-limit-org-file in Global Variables to change the limit.`);
    budget.warned = true;
    return [];
  }
  budget.used += bytes;
  const all = result.content.replace(/\r\n/g, '\n').split('\n');
  if (all.length && all[all.length - 1] === '') all.pop();
  const pad = ' '.repeat(indent);
  if (d.literal) {
    const name = d.block ?? '';
    return [`${pad}#+BEGIN_${name}${d.args !== null ? ' ' + d.args : ''}`, ...escapeCode(prepare(applyLineRange(all, d.lines), 0, null)), `${pad}#+END_${name}`];
  }
  if (d.block !== null) return [`${pad}#+BEGIN_${d.block}`, ...prepare(applyLineRange(all, d.lines), 0, null), `${pad}#+END_${d.block}`];
  const chosen = d.location !== null ? locate(all, d.location, d.onlyContents, d.lines) : applyLineRange(all, d.lines);
  if (chosen === null) return []; // the search finds nothing
  const text = prepare(chosen, indent, d.minlevel ?? inducedLevel);
  return expandLines(text, { ...ctx, dir: directoryOf(file), included: [...ctx.included, key] });
}

/**
 * True if `doc` has a #+INCLUDE: anywhere at all, so a document without one is not rebuilt.
 * @param {Doc} doc
 */
function hasAnyInclude(doc) {
  if ((doc.keywords || []).some((k) => k.key.toUpperCase() === 'INCLUDE') || (doc.bodyLines || []).some((line) => INCLUDE_RE.test(line))) return true;
  return (function walk(headings) {
    for (const heading of headings || []) {
      if ((heading.bodyLines || []).some((/** @type {string} */ line) => INCLUDE_RE.test(line))) return true;
      if (walk(heading.children)) return true;
    }
    return false;
  })(doc.children);
}

/**
 * `doc` with its #+INCLUDE: keywords expanded: a new document, `doc` itself is never changed.
 *
 * `fetchPath(path)` is an async function the caller supplies, giving `{ content: string }` for a path as written in the keyword (a path
 * in an included file is made relative to that file); anything else it returns, or a throw, skips that include. `parseOrgFn` is
 * the caller's parseOrg, which this module is given rather than importing it.
 * `options.maxTotalBytes` is the most all the included files may add up to (default: the Org file limit; 0 for no limit); an include
 * that would go past it is left out, and `options.onSkip` is told once.
 * @param {Doc} doc
 * @param {any} [fetchPath]
 * @param {any} [parseOrgFn]
 * @param {{ maxTotalBytes?: number, onSkip?: (message: string) => void }} [options]
 * @returns {Promise<Doc>}
 */
async function expandIncludes(doc, fetchPath, parseOrgFn, options = {}) {
  if (!hasAnyInclude(doc)) return doc;
  /** @type {IncludeBudget} */
  const budget = { max: options.maxTotalBytes ?? getSizeLimits().orgFile.max, used: 0, warned: false, onSkip: options.onSkip };
  const lines = await expandLines(serializeOrg(doc).split('\n'), { dir: '', included: [], fetchPath, budget });
  const parsed = parseOrgFn(lines.join('\n'));
  return { ...doc, keywords: parsed.keywords, bodyLines: parsed.bodyLines, body: parsed.body, children: parsed.children };
}

export { expandIncludes };
