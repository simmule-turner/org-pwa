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
 *                       ASCII/Markdown/HTML/ODT export already share
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
 *       (the same behavior this app's own HTML/Markdown/ODT exporters
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

const MACRO_USE_RE = /\{\{\{([a-zA-Z][-a-zA-Z0-9_]*)(\(([^)]*)\))?\}\}\}/g;

/** Splits a macro reference's own raw argument text on commas, the
 *  way real org itself does -- honoring `\,` as an escaped, literal
 *  comma within one argument (so an argument can itself contain a
 *  comma without being split apart), rather than naively splitting on
 *  every comma regardless of escaping. Each argument is trimmed, the
 *  same as real org's own actual behavior. An empty (or undefined,
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
 *  "recognized subset" parsers already take elsewhere. */
function buildMacroTable(doc) {
  const macros = {};
  for (const kw of doc.keywords || []) {
    if (kw.key.toUpperCase() !== 'MACRO') continue;
    const m = /^\s*([a-zA-Z][-a-zA-Z0-9_]*)\s+([\s\S]*)$/.exec(kw.value);
    if (m) macros[m[1]] = m[2];
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
 *  three names. */
function keywordValues(doc, name) {
  return (doc.keywords || [])
    .filter((k) => k.key.toUpperCase() === name.toUpperCase())
    .map((k) => k.value)
    .join(' ');
}

/** Expands every {{{macro}}} reference in `text` against `macros`
 *  (see buildMacroTable) and `doc`'s own keywords, using `now` for
 *  the {{{time(...)}}} macro's own current-time value. An unrecognized
 *  macro name is left exactly as written, the same
 *  tolerant-of-the-unexpected approach every other "recognized
 *  subset" parser in this app already takes -- never an error, never
 *  silently dropped. */
function expandMacrosInText(text, macros, doc, now) {
  return text.replace(MACRO_USE_RE, (whole, name, _paren, argsStr) => {
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
    if (name === 'time') return formatTime(now, args[0] || '%Y-%m-%d');
    if (name === 'keyword') return keywordValues(doc, args[0] || '');
    if (name in macros) {
      const template = macros[name];
      if (/^\(eval\b/.test(template.trim())) return whole; // real org's own escape into arbitrary Emacs Lisp -- can't safely execute this, same reason step (c) can't run a code block; left exactly as written
      return template.replace(/\$(\d+)/g, (_, n) => args[Number(n) - 1] ?? '');
    }
    return whole;
  });
}

/** Applies expandMacrosInText across every real text line in `doc`
 *  (the document's own preamble bodyLines, and every heading's own
 *  title plus bodyLines, recursively) -- matching real org's own
 *  documented recognition areas (paragraphs, headlines, table cells,
 *  lists; verse blocks are plain body lines here too) -- then
 *  reparses each changed body so the expanded text is reflected
 *  structurally, not just as raw strings nothing else sees. Returns a
 *  new doc; the input is never mutated. */
function expandMacros(doc, now) {
  const macros = buildMacroTable(doc);
  const newBodyLines = (doc.bodyLines || []).map((line) => expandMacrosInText(line, macros, doc, now));

  function walk(heading) {
    const newTitle = expandMacrosInText(heading.title, macros, doc, now);
    const newLines = (heading.bodyLines || []).map((line) => expandMacrosInText(line, macros, doc, now));
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

const RAW_COMMENT_LINE_RE = /^\s*#(?!\+)(\s|$)/; // a real org "# " comment line -- NOT a "#+KEYWORD:" line, which starts "#+" instead

/** Strips #+BEGIN_COMMENT/#+END_COMMENT blocks and raw "# " comment
 *  lines from a flat array of body lines -- matching real org's own
 *  actual export behavior (the same behavior this app's own HTML/
 *  Markdown/ODT exporters already give #+BEGIN_COMMENT specifically,
 *  applied here to raw text since this module's own output is real
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
 *  new doc; the input is never mutated. */
function filterNoexportAndComments(doc) {
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
 */
async function exportAsOrg(doc, fetchPath, parseOrgFn, { now, minlevel } = {}) {
  const resolvedNow = now instanceof Date ? now : new Date();
  let result = await expandIncludes(doc, fetchPath, parseOrgFn);
  result = expandMacros(result, resolvedNow);
  result = filterNoexportAndComments(result);
  result = scaleHeadingLevels(result, minlevel);
  return result;
}

export { exportAsOrg, expandMacros, filterNoexportAndComments, scaleHeadingLevels, buildMacroTable, splitMacroArgs };
