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
 *       alone. A replacement template starting with "(eval" runs on the
 *       Lisp interpreter (macro-eval.js), as Org runs it.
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
import { serializeOrg } from './org-parser.js';
import { buildFilter, parseHtmlOptions } from './export-html.js';
import { rawExportOptions } from './export-options.js';
import { resolveTodoSequences } from './todo-cycle.js';
import { interpretOrg } from './org-interpret.js';
import { withBufferKeywords } from './export-keywords.js';
import { citeExportFor } from './cite.js';
import { expandMacros } from './export-macros.js';
import { parseInline } from './inline-markup.js';

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
  const arch = parseHtmlOptions(doc).arch;
  /** @param {Heading} h @returns {Heading | null} */
  const walk = (h) => {
    if (!keep(h)) return null;
    if (!(h.tags || []).includes('ARCHIVE') || arch === true) return { ...h, children: (h.children || []).map(walk).filter((c) => c !== null) };
    // arch:headline (the default) writes just the headline of an archived tree; arch:nil leaves it out
    return arch === false ? null : { ...h, children: [], bodyLines: [], body: [], raw: undefined, planning: { scheduled: null, deadline: null, closed: null }, properties: {} };
  };
  return { ...doc, children: (doc.children || []).map(walk).filter((c) => c !== null) };
}

/**
 * What Emacs's `org-org-export-as-org` writes for `doc`: the document after includes, macros and the export filters, in Org's
 * canonical form (see org-interpret.js).
 * @param {Doc} doc @param {Parameters<typeof expandIncludes>[1]} fetchPath @param {Parameters<typeof expandIncludes>[2]} parseOrgFn @param {{ now?: Date, minlevel?: number }} [options]
 * @returns {Promise<string>}
 */
async function exportOrgText(doc, fetchPath, parseOrgFn, options = {}) {
  doc = withBufferKeywords(doc, false);
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
    stat: flag('stat', true),
    clocks: flag('c', false),
    creator: flag('creator', false) ? (processed.keywords || []).filter((k) => k.key.toUpperCase() === 'CREATOR').map((k) => k.value.trim()).pop() || 'Org Mode PWA' : undefined,
    title: flag('title', true),
    author: flag('author', true),
    date: flag('date', true),
    email: flag('email', false),
    selective: select.size > 0 && anySelected(processed.children || []),
  });
}

export { exportOrgText, exportAsOrg, filterNoexportAndComments, scaleHeadingLevels };
