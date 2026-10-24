// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * org-org-export-as-org: a considered subset of real org-mode's own
 * (org-org-export-as-org) command -- produces a fully processed COPY
 * of the current document, leaving the original completely
 * untouched, per its own real, documented steps:
 *
 *   a. Safe copy    -- the caller's job (see exportAsOrg's own doc
 *                       comment below): everything here works on a
 *                       freshly-parsed copy, never state.doc itself.
 *   b. Resolve #+INCLUDE:   -- reuses export-include.js's own
 *                       expandIncludes wholesale, the SAME module
 *                       ASCII/HTML/ODT export already share
 *                       -- not reimplemented here.
 *   c. Execute #+BEGIN_SRC code blocks -- genuinely NOT implemented:
 *       this app has no code interpreter or execution sandbox for any
 *       language at all ("no Babel-style execution of any kind" is
 *       already an explicit, documented limitation elsewhere). A code
 *       block is left exactly as it is, un-executed -- a clearly
 *       absent step, not a silently-skipped one.
 *   d. Expand {{{macro}}} references -- genuinely new (see
 *       expandMacros below), verified directly against real org's own
 *       actual macro syntax (#+MACRO: definitions, $1/$2 argument
 *       substitution, and the built-in title/author/email/date/time/
 *       keyword macros) before writing this, not derived from memory
 *       alone. A replacement template starting with "(eval" is real
 *       org's own escape hatch into evaluating arbitrary Emacs Lisp --
 *       the same thing step (c) can't safely do, so it's left exactly
 *       as written rather than attempted, for the identical reason.
 *   e. Filter :noexport:/comments -- genuinely new (see
 *       filterNoexportAndComments below): a heading tagged :noexport:
 *       is dropped along with its entire subtree; a raw "# " comment
 *       line and a #+BEGIN_COMMENT/#+END_COMMENT block are both
 *       dropped too, matching real org's own actual export behavior
 *       (the same behavior this app's own HTML/ODT exporters
 *       already give #+BEGIN_COMMENT specifically, applied here more
 *       generally since this module's own output is real org text,
 *       not one of those backends).
 *
 * Heading-level scaling ("all headings scaled") reuses shiftLevels,
 * the same primitive export-include.js's own :minlevel handling
 * already uses for an included subtree.
 */

import { expandIncludes } from './export-include.js';
import { shiftLevels } from './archive-model.js';
import { parseBody } from './body-parser.js';
import { formatTime } from './capture-template.js';
import { parseOrgTimestamp } from './org-timestamp.js';
import { serializeOrg } from './org-parser.js';
import { buildFilter, parseHtmlOptions } from './export-html.js';
import { rawExportOptions } from './export-options.js';
import { resolveTodoSequences } from './todo-cycle.js';
import { interpretOrg } from './org-interpret.js';
import { citeExportFor } from './cite.js';
import { parseInline } from './inline-markup.js';

const MACRO_USE_RE = /\{\{\{([a-zA-Z][-a-zA-Z0-9_]*)(\(([^)]*)\))?\}\}\}/g;

/** Splits a macro reference's own raw argument text on commas, the
 *  way real org itself does -- honoring `\,` as an escaped, literal
 *  comma within one argument (so an argument can itself contain a
 *  comma without being split apart), rather than naively splitting on
 *  every comma regardless of escaping. Each argument is trimmed, the
 *  same as real org's own actual behavior. An empty (or undefined,
 * @param {any} [argsStr]
 *  meaning "no parentheses at all") argument list returns []. */
function splitMacroArgs(argsStr) {
  if (argsStr === undefined || argsStr === '') return [];
  const args = [];
  let current = '';
  for (let i = 0; i < argsStr.length; i++) {
    if (argsStr[i] === '\\' && argsStr[i + 1] === ',') {
      current += ',';
      i++;
    } else if (argsStr[i] === ',') {
      args.push(current.trim());
      current = '';
    } else {
      current += argsStr[i];
    }
  }
  args.push(current.trim());
  return args;
}

/** Every #+MACRO: definition in `doc`'s own keywords, as a plain
 *  { name: replacementText } table -- doesn't evaluate anything yet,
 *  just collects the raw definitions for expandMacrosInText below to
 *  actually apply. A malformed definition (no name, or a name that
 *  isn't a real identifier) is silently skipped, the same
 *  tolerant-of-the-unexpected approach this app's own other
 * @param {Doc} doc
 *  "recognized subset" parsers already take elsewhere. */
function buildMacroTable(doc) {
  const macros = {};
  for (const kw of doc.keywords || []) {
    if (kw.key.toUpperCase() !== 'MACRO') continue;
    const m = /^\s*([a-zA-Z][-a-zA-Z0-9_]*)\s+([\s\S]*)$/.exec(kw.value);
    if (m) /** @type {any} */ (macros)[m[1]] = m[2];
  }
  return macros;
}

/** Every value of a NAME keyword in `doc`, space-joined -- the
 *  {{{keyword(NAME)}}} macro's own real, documented behavior exactly
 *  ("collects all values from NAME keywords throughout the buffer,
 *  separated with white space"). {{{title}}}/{{{author}}}/{{{email}}}
 *  are real org's own documented shortcuts for keyword(TITLE)/
 *  keyword(AUTHOR)/keyword(EMAIL) respectively -- not separately
 *  implemented, just called through this same function with those
 * @param {Doc} doc
 * @param {string} name
 *  three names. */
function keywordValues(doc, name) {
  return (doc.keywords || [])
    .filter((k) => k.key.toUpperCase() === name.toUpperCase())
    .map((k) => k.value)
    .join(' ');
}

/** The {{{n}}} counters, by name; they start over for each export. @type {Map<string, number>} */
let counters = new Map();
/** The heading whose text is being expanded (for {{{property}}}) and the file's name and modification time (for {{{input-file}}} and {{{modification-time}}}). @type {{ heading: Heading | null, file: { name?: string, mtime?: Date } | null }} */
const here = { heading: null, file: null };

/** @param {Doc} doc @returns {Heading[]} */
function allHeadings(doc) {
  /** @type {Heading[]} */ const out = [];
  /** @param {Heading[]} list */
  const walk = (list) => list.forEach((h) => (out.push(h), walk(h.children || [])));
  walk(doc.children || []);
  return out;
}

/** {{{property(NAME)}}}: the property in the heading holding the macro (its own drawer only, as Org reads it); a second argument names another heading (by its title, or #custom-id). @param {Doc} doc @param {string[]} args */
function propertyValue(doc, args) {
  /** @type {Heading | null | undefined} */ let heading = here.heading;
  if (args[1]) {
    const search = args[1].trim().replace(/^\*/, '');
    const all = allHeadings(doc);
    heading = search.startsWith('#') ? all.find((h) => h.properties?.CUSTOM_ID === search.slice(1)) : all.find((h) => h.title.trim().toLowerCase() === search.toLowerCase()) || all.find((h) => h.title.toLowerCase().includes(search.toLowerCase()));
  }
  const value = heading?.properties?.[(args[0] || '').trim()] ?? heading?.properties?.[(args[0] || '').trim().toUpperCase()];
  return value === undefined ? '' : String(value);
}

/** Expands every {{{macro}}} reference in `text` against `macros`
 *  (see buildMacroTable) and `doc`'s own keywords, using `now` for
 *  the {{{time(...)}}} macro's own current-time value. An unrecognized
 *  macro name is left exactly as written, the same
 *  tolerant-of-the-unexpected approach every other "recognized
 *  subset" parser in this app already takes -- never an error, never
 * @param {string} text
 * @param {any} macros
 * @param {Doc} doc
 * @param {Date} now
 * @param {number} [depth]
 * @returns {string}
 *  silently dropped. */
function expandMacrosInText(text, macros, doc, now, depth = 0) {
  return text.replace(MACRO_USE_RE, (whole, /** @type {string} */ name, _paren, argsStr) => {
    const args = splitMacroArgs(argsStr);
    if (name === 'title') return keywordValues(doc, 'TITLE');
    if (name === 'author') return keywordValues(doc, 'AUTHOR');
    if (name === 'email') return keywordValues(doc, 'EMAIL');
    if (name === 'date') {
      const raw = keywordValues(doc, 'DATE');
      // FORMAT only actually applies when DATE is a single real
      // timestamp -- real org's own documented restriction. A raw
      // value that doesn't parse as one (plain text, or simply
      // absent) means FORMAT has no effect; the raw value passes
      // through unformatted instead, rather than silently
      // substituting today's date for something the person never
      // asked to have replaced.
      if (args[0] && raw) {
        const parsed = parseOrgTimestamp(raw);
        if (parsed) return formatTime(parsed.date, args[0]);
      }
      return raw;
    }
    if (name === 'n') {
      // {{{n(NAME)}}} counts up from 1 for each NAME; a second argument of `-` repeats the last number and a number starts over there
      const key = args[0] || '';
      const action = args[1];
      let value = counters.get(key) || 0;
      if (action !== '-') value = action !== undefined && /^\d+$/.test(action) ? Number(action) : value + 1;
      counters.set(key, value);
      return String(value);
    }
    if (name === 'time') return formatTime(now, args[0] || '%Y-%m-%d');
    if (name === 'keyword') return keywordValues(doc, args[0] || '');
    if (name === 'property' && !(name in macros)) return propertyValue(doc, args);
    if (name === 'input-file' && here.file?.name !== undefined && !(name in macros)) return here.file.name;
    if (name === 'modification-time' && here.file?.mtime && !(name in macros)) return formatTime(here.file.mtime, args[0] || '%Y-%m-%d');
    if (name in macros) {
      const template = macros[name];
      if (/^\(eval\b/.test(template.trim())) return whole; // real org's own escape into arbitrary Emacs Lisp -- can't safely execute this, same reason step (c) can't run a code block; left exactly as written
      const filled = template.replace(/\$(\d+)/g, (/** @type {any} */ _, /** @type {any} */ n) => args[Number(n) - 1] ?? '');
      return depth < 20 ? expandMacrosInText(filled, macros, doc, now, depth + 1) : filled; // a macro may use others
    }
    return whole;
  });
}

/** `=verbatim=` and `~code~` spans: a macro written inside one is text, not a macro. */
const CODE_SPAN_RE = /(^|[\s\-({'"])([=~])([^\s=~]|[^\s=~].*?[^\s=~])\2(?=$|[\s\-.,;:!?')}\]"])/g;
/** Blocks whose lines are never searched for macros, as in Org (source, example, export and comment blocks, and `: ` lines). */
const MACRO_FREE_BLOCK_RE = /^\s*#\+(begin|end)_(src|example|export|comment)\b/i;

/**
 * Expands the macros of body lines, leaving those inside code spans, source/example/export/comment blocks and fixed-width lines alone.
 * @param {string[]} lines @param {(text: string) => string} expand
 */
function expandBodyLines(lines, expand) {
  let inBlock = false;
  return lines.map((line) => {
    const fence = MACRO_FREE_BLOCK_RE.exec(line);
    if (fence) {
      inBlock = fence[1].toLowerCase() === 'begin';
      return line;
    }
    if (inBlock || /^\s*:(\s|$)/.test(line) || !line.includes('{{{')) return line;
    let out = '';
    let last = 0;
    for (const m of line.matchAll(CODE_SPAN_RE)) {
      const start = (m.index || 0) + m[1].length;
      out += expand(line.slice(last, start)) + line.slice(start, (m.index || 0) + m[0].length);
      last = (m.index || 0) + m[0].length;
    }
    return out + expand(line.slice(last));
  });
}

/** Applies expandMacrosInText across every real text line in `doc`
 *  (the document's own preamble bodyLines, and every heading's own
 *  title plus bodyLines, recursively) -- matching real org's own
 *  documented recognition areas (paragraphs, headlines, table cells,
 *  lists; verse blocks are plain body lines here too) -- then
 *  reparses each changed body so the expanded text is reflected
 *  structurally, not just as raw strings nothing else sees. Returns a
 * @param {Doc} doc
 * @param {Date} now
 * @param {{ name?: string, mtime?: Date } | null} [file]
 *  new doc; the input is never mutated. */
function expandMacros(doc, now, file = null) {
  counters = new Map();
  here.heading = null;
  here.file = file;
  const macros = buildMacroTable(doc);
  const expand = (/** @type {string} */ text) => expandMacrosInText(text, macros, doc, now);
  const newBodyLines = expandBodyLines(doc.bodyLines || [], expand);

  /** @param {Heading} heading
   *  @returns {any} */
  function walk(heading) {
    here.heading = heading;
    const newTitle = expandMacrosInText(heading.title, macros, doc, now);
    const newLines = expandBodyLines(heading.bodyLines || [], expand);
    return {
      ...heading,
      title: newTitle,
      bodyLines: newLines,
      body: parseBody(newLines),
      children: (heading.children || []).map(walk),
    };
  }

  return {
    ...doc,
    bodyLines: newBodyLines,
    body: parseBody(newBodyLines),
    children: (doc.children || []).map(walk),
  };
}

/**
 * The document with its {{{macros}}} expanded, for the exporters that read parsed text (ASCII, ODT), and the heading
 * to export in that copy. A document that uses no macro is returned as it is.
 * @param {Doc} doc @param {any} scope  the heading being exported, or null for the whole document @param {Date} now @param {{ name?: string, mtime?: Date } | null} [file]  the file's name and modification time, for {{{input-file}}} and {{{modification-time}}}
 * @returns {{ doc: Doc, scope: any }}
 */
function expandMacrosForExport(doc, scope, now, file = null) {
  /** @param {Heading[]} headings @returns {boolean} */
  const uses = (headings) => headings.some((h) => h.title.includes('{{{') || (h.bodyLines || []).some((l) => l.includes('{{{')) || uses(h.children || []));
  if (!(doc.bodyLines || []).some((l) => l.includes('{{{')) && !uses(doc.children || [])) return { doc, scope };
  const expanded = expandMacros(doc, now, file);
  if (!scope) return { doc: expanded, scope };
  /** @param {any[]} from @param {any[]} to @returns {any} the heading in `to` at the place `scope` has in `from` */
  const counterpart = (from, to) => {
    for (let i = 0; i < from.length; i++) {
      if (from[i] === scope) return to[i];
      const inner = counterpart(from[i].children || [], to[i].children || []);
      if (inner) return inner;
    }
    return null;
  };
  return { doc: expanded, scope: counterpart(doc.children || [], expanded.children || []) || scope };
}

const RAW_COMMENT_LINE_RE = /^\s*#(?!\+)(\s|$)/; // a real org "# " comment line -- NOT a "#+KEYWORD:" line, which starts "#+" instead

/** Strips #+BEGIN_COMMENT/#+END_COMMENT blocks and raw "# " comment
 *  lines from a flat array of body lines -- matching real org's own
 *  actual export behavior (the same behavior this app's own HTML/
 *  ODT exporter already give #+BEGIN_COMMENT specifically,
 *  applied here to raw text since this module's own output is real
 * @param {string[]} lines
 *  org text, not one of those rendered backends). */
function stripCommentLines(lines) {
  const out = [];
  let inCommentBlock = false;
  for (const line of lines) {
    if (!inCommentBlock && /^\s*#\+BEGIN_COMMENT\b/i.test(line)) {
      inCommentBlock = true;
      continue;
    }
    if (inCommentBlock) {
      if (/^\s*#\+END_COMMENT\b/i.test(line)) inCommentBlock = false;
      continue;
    }
    if (RAW_COMMENT_LINE_RE.test(line)) continue;
    out.push(line);
  }
  return out;
}

/** Recursively drops every heading tagged :noexport: (its own tags
 *  array specifically -- not inherited from an ancestor, matching
 *  real org's own actual behavior: only a heading itself carrying the
 *  tag is excluded, not merely one whose parent happens to carry it),
 *  along with that heading's entire subtree, and strips comment
 *  lines/blocks (see stripCommentLines) from what's left. Returns a
 * @param {Doc} doc
 *  new doc; the input is never mutated. */
function filterNoexportAndComments(doc) {
  /** @param {Heading} heading
   *  @returns {any} */
  function walk(heading) {
    if (heading.tags.includes('noexport')) return null;
    const newLines = stripCommentLines(heading.bodyLines || []);
    return {
      ...heading,
      bodyLines: newLines,
      body: parseBody(newLines),
      children: (heading.children || []).map(walk).filter(Boolean),
    };
  }

  const newBodyLines = stripCommentLines(doc.bodyLines || []);
  return {
    ...doc,
    bodyLines: newBodyLines,
    body: parseBody(newBodyLines),
    children: (doc.children || []).map(walk).filter(Boolean),
  };
}

/** Scales every top-level heading (and, recursively, its own
 *  descendants) so the document's own first-level headings land at
 *  `minlevel` -- reuses shiftLevels, the same primitive
 *  export-include.js's own :minlevel handling already uses for an
 *  included subtree. A no-op (returns `doc` as-is) when `minlevel` is
 * @param {Doc} doc
 * @param {number | undefined} minlevel
 *  falsy or the document already starts there. */
function scaleHeadingLevels(doc, minlevel) {
  if (!minlevel || (doc.children || []).length === 0) return doc;
  const currentMin = Math.min(...doc.children.map((h) => h.level));
  if (currentMin === minlevel) return doc;
  const newChildren = doc.children.map((h) => {
    const copy = structuredClone(h); // a shallow { ...h } would leave h.children pointing at the SAME nested objects as the original doc -- shiftLevels' own recursive walk mutates in place, so this needs to be a true, independent deep copy first
    shiftLevels(copy, minlevel + (h.level - currentMin));
    return copy;
  });
  return { ...doc, children: newChildren };
}

/**
 * Produces a fully processed copy of `doc`, per this module's own
 * top-level doc comment (steps a-e) -- `fetchPath`/`parseOrgFn` are
 * expandIncludes' own required dependencies (see export-include.js),
 * threaded through unchanged; `now` is the moment to use for
 * {{{time(...)}}}, defaulting to the real current time (a caller
 * passing a fixed Date makes this deterministic for testing);
 * `minlevel`, if given, scales every top-level heading to land there
 * (see scaleHeadingLevels) -- omitted or falsy leaves levels exactly
 * as they already are.
 *
 * `doc` itself is never mutated -- every step here returns a new
 * document, so the ORIGINAL, caller-supplied doc (typically
 * state.doc) is exactly as it was before this ran, no matter what
 * this function does internally. Callers still shouldn't pass
 * state.doc directly if they'd rather not risk it going stale mid-
 * export from an unrelated concurrent edit -- see this session's own
 * "safe copy" step (a) -- but nothing in here itself touches the
 * object it's given.
 * @param {Doc} doc @param {any} fetchPath @param {any} parseOrgFn @param {{ now?: Date, minlevel?: number, keepComments?: boolean }} [options]
 */
async function exportAsOrg(doc, fetchPath, parseOrgFn, { now, minlevel, keepComments = false } = {}) {
  const resolvedNow = now instanceof Date ? now : new Date();
  let result = await expandIncludes(doc, fetchPath, parseOrgFn);
  result = expandMacros(result, resolvedNow);
  if (!keepComments) result = filterNoexportAndComments(result);
  result = scaleHeadingLevels(result, minlevel);
  return result;
}

/**
 * The headings left after COMMENT, #+EXCLUDE_TAGS:, #+SELECT_TAGS: and tasks: (a dropped heading takes its subtree with it).
 * @param {Doc} doc
 * @returns {Doc}
 */
function pruneHeadings(doc) {
  const sequences = resolveTodoSequences(doc);
  const keep = buildFilter(/** @type {import('./export-html.js').ExportState} */ (/** @type {unknown} */ ({ doc, options: parseHtmlOptions(doc), doneKeywords: sequences.flatMap((q) => q.doneKeywords) })));
  /** @param {Heading} h @returns {Heading | null} */
  const walk = (h) => (keep(h) ? { ...h, children: (h.children || []).map(walk).filter((c) => c !== null) } : null);
  return { ...doc, children: (doc.children || []).map(walk).filter((c) => c !== null) };
}

/**
 * What Emacs's `org-org-export-as-org` writes for `doc`: the document after includes, macros and the export filters, in Org's
 * canonical form (see org-interpret.js).
 * @param {Doc} doc @param {Parameters<typeof expandIncludes>[1]} fetchPath @param {Parameters<typeof expandIncludes>[2]} parseOrgFn @param {{ now?: Date, minlevel?: number }} [options]
 * @returns {Promise<string>}
 */
async function exportOrgText(doc, fetchPath, parseOrgFn, options = {}) {
  const processed = pruneHeadings(await exportAsOrg(doc, fetchPath, parseOrgFn, { ...options, keepComments: true }));
  const raw = rawExportOptions(processed);
  /** @param {string} key @param {boolean} dflt */
  const flag = (key, dflt) => (raw[key] === undefined ? dflt : raw[key] !== 'nil');
  const d = raw.d;
  /** @type {(name: string) => boolean} */
  let drawer = (name) => name !== 'LOGBOOK';
  if (d === 'nil') drawer = () => false;
  else if (d === 't') drawer = () => true;
  else if (d && /^\(not /.test(d)) drawer = (name) => ![...d.matchAll(/"([^"]*)"/g)].some((m) => m[1] === name);
  else if (d && d.startsWith('(')) drawer = (name) => [...d.matchAll(/"([^"]*)"/g)].some((m) => m[1] === name);
  const sequences = resolveTodoSequences(processed);
  const select = new Set((processed.keywords || []).filter((k) => k.key.toUpperCase() === 'SELECT_TAGS').flatMap((k) => k.value.split(/\s+/)).filter(Boolean).map((t) => t.toLowerCase()));
  /** @param {Heading[]} list @returns {boolean} */
  const anySelected = (list) => list.some((h) => (h.tags || []).some((t) => select.has(String(t).toLowerCase())) || anySelected(h.children || []));
  /** @param {import('./cite.js').Segment[]} segments @returns {string} */
  const segmentText = (segments) => segments.map((s) => (typeof s === 'string' ? s : 'org' in s ? s.org : '/' + segmentText(s.italic) + '/')).join('');
  const cite = citeExportFor(processed, undefined, parseInline, true);
  return interpretOrg(serializeOrg(processed), {
    cite: { text: (c) => { const segments = cite.formatCitation(c); return segments ? segmentText(segments) : ''; }, bibliography: cite.bibliography().map(segmentText) },
    todoKeywords: new Set(sequences.flatMap((q) => [...q.todoKeywords, ...q.doneKeywords])),
    todo: flag('todo', true),
    priority: flag('pri', false),
    tags: flag('tags', true),
    planning: flag('p', false),
    properties: flag('prop', false),
    drawer,
    footnotes: flag('f', true),
    tables: flag('|', true),
    title: flag('title', true),
    author: flag('author', true),
    date: flag('date', true),
    email: flag('email', false),
    selective: select.size > 0 && anySelected(processed.children || []),
  });
}

export { exportOrgText, exportAsOrg, expandMacros, expandMacrosForExport, filterNoexportAndComments, scaleHeadingLevels, buildMacroTable, splitMacroArgs };
