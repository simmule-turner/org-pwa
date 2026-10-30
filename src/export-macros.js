// @ts-check
/**
 * {{{macros}}} in an export: the `#+MACRO:` table, the built-in macros ({{{title}}}, {{{date}}}, {{{property}}}, {{{n}}} ...) and
 * their expansion over the text of a whole document before it is exported.
 */

/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */

import { parseBody } from './body-parser.js';
import { expandReferences, macroDefinitions } from './org-macro.js';

/** Splits a macro reference's own raw argument text on commas, the
 *  way real org itself does -- honoring `\,` as an escaped, literal
 *  comma within one argument (so an argument can itself contain a
 *  comma without being split apart), rather than naively splitting on
 *  every comma regardless of escaping. Each argument is trimmed, the
 *  same as real org's own actual behavior. An empty (or undefined,
 * @param {string} [argsStr]
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
  return macroDefinitions(doc);
}

/** The {{{n}}} counters, by name; they start over for each export. @type {Map<string, number>} */
let counters = new Map();
/** The heading whose text is being expanded (for {{{property}}}) and the file's name and modification time (for {{{input-file}}} and {{{modification-time}}}). @type {{ heading: Heading | null, file: { name?: string, mtime?: Date } | null }} */
const here = { heading: null, file: null };

/**
 * Expands every {{{macro}}} reference in `text` as org-macro.el does (see org-macro.js); a name nothing answers is an error.
 * @param {string} text
 * @param {Record<string, string>} macros
 * @param {Doc} doc
 * @param {Date} now
 * @returns {string}
 */
function expandMacrosInText(text, macros, doc, now) {
  return expandReferences(text, macros, { doc, now, heading: here.heading, file: here.file, counters });
}

/** `=verbatim=` and `~code~` spans: a macro written inside one is text, not a macro. */
const CODE_SPAN_RE = /(^|[\s\-({'"])([=~])([^\s=~]|[^\s=~].*?[^\s=~])\2(?=$|[\s\-.,;:!?')}\]"])/g;
/** What is skipped: a code span, or the path of a link (`[[path]`, whose description is searched). */
const PROTECTED_RE = new RegExp(`${CODE_SPAN_RE.source}|\\[\\[[^\\]]*\\]`, 'g');
/** A macro reference that opens its argument list and does not close it on the line. */
const OPEN_REFERENCE_RE = /\{\{\{[a-zA-Z][-a-zA-Z0-9_]*\((?:(?!\)\}\}\})[\s\S])*$/;
/** Blocks whose lines are never searched for macros, as in Org (source, example, export and comment blocks, and `: ` lines). */
const MACRO_FREE_BLOCK_RE = /^\s*#\+(begin|end)_(src|example|export|comment)\b/i;

/**
 * Expands the macros of body lines, leaving those inside code spans, source/example/export/comment blocks and fixed-width lines alone.
 * @param {string[]} lines @param {(text: string) => string} expand
 */
function expandBodyLines(lines, expand) {
  let inBlock = false;
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const fence = MACRO_FREE_BLOCK_RE.exec(line);
    if (fence) {
      inBlock = fence[1].toLowerCase() === 'begin';
      out.push(line);
      continue;
    }
    if (inBlock || /^\s*:(\s|$)/.test(line) || /^\s*#(\s|$)/.test(line) || !line.includes('{{{')) {
      out.push(line);
      continue;
    }
    // a reference whose arguments go on over the next lines of the paragraph is expanded as one text
    while (OPEN_REFERENCE_RE.test(line) && i + 1 < lines.length && lines[i + 1].trim() !== '' && !MACRO_FREE_BLOCK_RE.test(lines[i + 1])) {
      line += '\n' + lines[++i];
    }
    let text = '';
    let last = 0;
    for (const m of line.matchAll(PROTECTED_RE)) {
      const code = m[2] !== undefined;
      const start = (m.index || 0) + (code ? m[1].length : 0);
      text += expand(line.slice(last, start)) + line.slice(start, (m.index || 0) + m[0].length);
      last = (m.index || 0) + m[0].length;
    }
    out.push(...(text + expand(line.slice(last))).split('\n'));
  }
  return out;
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
   *  @returns {Heading} */
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
 * @param {Doc} doc @param {Heading | null} scope  the heading being exported, or null for the whole document @param {Date} now @param {{ name?: string, mtime?: Date } | null} [file]  the file's name and modification time, for {{{input-file}}} and {{{modification-time}}}
 * @returns {{ doc: Doc, scope: Heading | null }}
 */
function expandMacrosForExport(doc, scope, now, file = null) {
  /** @param {Heading[]} headings @returns {boolean} */
  const uses = (headings) => headings.some((h) => h.title.includes('{{{') || (h.bodyLines || []).some((l) => l.includes('{{{')) || uses(h.children || []));
  if (!(doc.bodyLines || []).some((l) => l.includes('{{{')) && !uses(doc.children || [])) return { doc, scope };
  const expanded = expandMacros(doc, now, file);
  if (!scope) return { doc: expanded, scope };
  /** @param {Heading[]} from @param {Heading[]} to @returns {Heading | null} the heading in `to` at the place `scope` has in `from` */
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

export { expandMacros, expandMacrosForExport, buildMacroTable, splitMacroArgs };
