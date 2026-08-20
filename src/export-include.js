/**
 * #+INCLUDE: "path" [block-type] [language] [:lines "N-M"] [:minlevel N]
 *
 * Splices another document's own content into this one during export.
 * Scope: document-level only (an #+INCLUDE: line before the first
 * heading, the same place #+TITLE/#+AUTHOR/#+DATE/#+OPTIONS already
 * live) -- real org itself also allows #+INCLUDE within a heading's
 * own body, but recognizing a keyword line there would need a real
 * parser extension this app doesn't have (its own KEYWORD_RE only
 * matches at the document root); a reasonable, honest scope boundary
 * given #+INCLUDE's own most common real-world use (composing several
 * files together at the top of one "master" document) already lives
 * at the document level anyway.
 *
 * The included file's own #+TITLE/#+AUTHOR/#+DATE/#+OPTIONS/etc. are
 * never merged into the including document's own metadata -- only
 * its actual content (headings, or raw text for a block-type
 * include). Real org's own actual behavior here is a genuinely
 * surprising edge case (confirmed directly against real Emacs org-
 * mode: a naive default-format #+INCLUDE literally concatenates the
 * two files' own #+TITLE values together in ox-ascii's own output),
 * not something worth reproducing; this also means real org's own
 * :only-contents switch (whose whole job is suppressing exactly that
 * merge) is effectively this module's own unconditional default,
 * so it's accepted but has no further effect of its own.
 */

import { shiftLevels } from './archive-model.js';
import { parseBody } from './body-parser.js';

/** Parses one #+INCLUDE: keyword's own value (everything after
 *  "#+INCLUDE:") into `{ path, blockType, language, lines, minlevel }`
 *  -- or null if `value` doesn't even have a valid quoted path, the
 *  one truly required part. `blockType` is one of 'src'/'example'/
 *  'quote'/'export', or null for the default (native org) case;
 *  `language` is only ever set alongside blockType 'src'; `lines` is
 *  the raw "N-M"/"−M"/"N-" string (see applyLineRange below for how
 *  it's actually interpreted), or null; `minlevel` is a positive
 *  integer, or null. */
function parseIncludeDirective(value) {
  const pathMatch = /^"([^"]*)"/.exec(value.trim());
  if (!pathMatch) return null;
  const path = pathMatch[1];
  const tokens = value
    .slice(pathMatch[0].length)
    .trim()
    .match(/"[^"]*"|\S+/g) || [];

  let blockType = null;
  let language = null;
  let i = 0;
  if (i < tokens.length && /^(src|example|quote|export)$/.test(tokens[i])) {
    blockType = tokens[i];
    i++;
    if (blockType === 'src' && i < tokens.length && !tokens[i].startsWith(':')) {
      language = tokens[i];
      i++;
    }
  }

  let lines = null;
  let minlevel = null;
  for (; i < tokens.length; i++) {
    if (tokens[i] === ':lines' && tokens[i + 1]) {
      lines = tokens[i + 1].replace(/^"|"$/g, '');
      i++;
    } else if (tokens[i] === ':minlevel' && tokens[i + 1]) {
      minlevel = Number(tokens[i + 1]);
      i++;
    }
    // :only-contents (and any other real #+INCLUDE switch) is
    // recognized syntactically -- the loop simply skips past an
    // unrecognized ":key value" pair -- but has no further effect;
    // see this module's own top-level docs for why.
  }

  return { path, blockType, language, lines, minlevel };
}

/** Applies a real org ":lines" range spec to an array of raw text
 *  lines (0-indexed JS array, but the spec itself is real org's own
 *  1-indexed convention). Confirmed directly against real Emacs org-
 *  mode's own actual export output -- notably, the manual's own
 *  wording ("lines 5-10" meaning "lines 5 through 10") is genuinely
 *  misleading: the range is inclusive of its own start but EXCLUSIVE
 *  of its own end ("5-10" is lines 5..9, not 5..10). "-M" means from
 *  the very start up to (exclusive) line M; "N-" means from line N to
 *  the file's own actual end (inclusive, since there's no upper bound
 *  to exclude there). `spec` of null/'' returns every line
 *  unchanged. */
function applyLineRange(lines, spec) {
  if (!spec) return lines;
  const m = /^(\d*)-(\d*)$/.exec(spec.trim());
  if (!m) return lines;
  const start = m[1] ? Number(m[1]) : 1;
  const end = m[2] ? Number(m[2]) : lines.length + 1;
  return lines.slice(start - 1, end - 1);
}

export { parseIncludeDirective, applyLineRange };

const INCLUDE_LINE_RE = /^\s*#\+INCLUDE:\s?(.*)$/i;

/** Resolves ONE already-parsed #+INCLUDE directive -- fetches its own
 *  target, applies :lines, and returns either `{ headings }` (default
 *  org format -- already level-shifted to `defaultMinlevel` when the
 *  directive itself gave no explicit :minlevel) or `{ bodyLines }`
 *  (a block-type include's own wrapped raw text), or null if the
 *  fetch failed/was unreachable (the caller treats that as "skip this
 *  one include," not a reason to fail the whole export). Shared by
 *  both the document-level and heading-level expansion below, so the
 *  two can never quietly drift apart on what a directive actually
 *  does. */
async function resolveOneInclude(directive, fetchPath, parseOrgFn, defaultMinlevel) {
  let result;
  try {
    result = await fetchPath(directive.path);
  } catch {
    return null;
  }
  if (!result || typeof result.content !== 'string') return null;

  const rawLines = applyLineRange(result.content.split('\n'), directive.lines);

  if (directive.blockType) {
    const langSuffix = directive.blockType === 'src' && directive.language ? ' ' + directive.language : '';
    return {
      bodyLines: [`#+BEGIN_${directive.blockType.toUpperCase()}${langSuffix}`, ...rawLines, `#+END_${directive.blockType.toUpperCase()}`],
    };
  }
  const subDoc = parseOrgFn(rawLines.join('\n'));
  const headings = subDoc.children || [];
  const minlevel = directive.minlevel || defaultMinlevel;
  if (minlevel) {
    for (const heading of headings) shiftLevels(heading, minlevel);
  }
  return { headings };
}

/** Expands every #+INCLUDE: found within `heading`'s own body text
 *  (real org allows this, confirmed directly against real Emacs org-
 *  mode: the included content nests as CHILDREN of the containing
 *  heading) and, recursively, within every one of its own
 *  descendants. Not mutating -- returns a new heading object. With no
 *  explicit :minlevel, defaults to one level deeper than the
 *  containing heading itself (confirmed directly against real Emacs
 *  org-mode -- genuinely different from the document-level default,
 *  which keeps the sub-document's own original levels unchanged).
 *  Any body text before/after the #+INCLUDE: line, within the same
 *  heading, stays exactly where it was -- this app doesn't reproduce
 *  real org's own further quirk of merging trailing body text into
 *  whatever the last included element happened to be, a well-defined,
 *  predictable placement being preferable to replicating an
 *  incidental artifact of real org's own internal merging. */
async function expandHeadingIncludes(heading, fetchPath, parseOrgFn) {
  const newBodyLines = [];
  const prependedChildren = [];
  for (const line of heading.bodyLines || []) {
    const m = INCLUDE_LINE_RE.exec(line);
    if (!m) {
      newBodyLines.push(line);
      continue;
    }
    const directive = parseIncludeDirective(m[1]);
    if (!directive) {
      newBodyLines.push(line); // doesn't even look like a valid directive -- leave the line as plain text rather than silently eating it
      continue;
    }
    const resolved = await resolveOneInclude(directive, fetchPath, parseOrgFn, heading.level + 1);
    if (!resolved) continue; // unreachable/failed -- the #+INCLUDE line itself is still dropped, matching the document-level case's own "skip silently" behavior
    if (resolved.headings) prependedChildren.push(...resolved.headings);
    else newBodyLines.push(...resolved.bodyLines);
  }

  const expandedChildren = [];
  for (const child of heading.children || []) {
    expandedChildren.push(await expandHeadingIncludes(child, fetchPath, parseOrgFn));
  }

  return {
    ...heading,
    bodyLines: newBodyLines,
    body: parseBody(newBodyLines),
    children: [...prependedChildren, ...expandedChildren],
  };
}

/** Expands every document-level #+INCLUDE: keyword in `doc` into a
 *  NEW, expanded document object -- `doc` itself is never mutated.
 *  Included content is prepended before `doc`'s own existing top-
 *  level headings, in #+INCLUDE order (multiple #+INCLUDE lines are
 *  all document-level, before the first heading, so this matches
 *  actual source order).
 *
 *  `fetchPath(path)` is an async function the caller supplies --
 *  given a raw #+INCLUDE path string, resolves it to `{ content:
 *  string }`, or returns/throws anything else to signal "not found,"
 *  which this function treats as "skip this one #+INCLUDE, keep
 *  going" rather than failing the whole export. `parseOrgFn` is the
 *  caller's own parseOrg (from org-parser.js) -- injected the same
 *  way, so this module has no import of its own on org-parser.js,
 *  avoiding a circular dependency (org-parser.js has no reason to
 *  know about includes at all).
 *
 *  Default (no block-type): the included file is parsed as a full
 *  org document; its own top-level headings are spliced in (each
 *  level-shifted to `:minlevel` if given, preserving its own
 *  internal relative depth), but its own #+TITLE/#+AUTHOR/#+DATE/
 *  #+OPTIONS/preamble body are never merged in -- see this module's
 *  own top-level docs for why.
 *
 *  block-type (src/example/quote/export): the (line-range-filtered)
 *  raw text is wrapped in the corresponding #+BEGIN_.../#+END_...
 *  block and appended to the document's own bodyLines (the
 *  document-level preamble, now rendered by every export format)
 *  rather than becoming a heading, matching real org's own actual
 *  placement. */
/** True if `doc` has a #+INCLUDE: anywhere at all -- the document
 *  root's own keywords, or any heading's own body text, at any depth.
 *  expandIncludes' own cheap-no-op fast path for the overwhelmingly
 *  common case (a document with no includes at all shouldn't pay for
 *  rebuilding every single heading object just to find that out). */
function hasAnyInclude(doc) {
  if ((doc.keywords || []).some((k) => k.key.toUpperCase() === 'INCLUDE')) return true;
  return (function walk(headings) {
    for (const heading of headings || []) {
      if ((heading.bodyLines || []).some((line) => INCLUDE_LINE_RE.test(line))) return true;
      if (walk(heading.children)) return true;
    }
    return false;
  })(doc.children);
}

async function expandIncludes(doc, fetchPath, parseOrgFn) {
  if (!hasAnyInclude(doc)) return doc;

  const includeKeywords = (doc.keywords || []).filter((k) => k.key.toUpperCase() === 'INCLUDE');

  const prependedHeadings = [];
  const appendedBodyLines = [];

  for (const kw of includeKeywords) {
    const directive = parseIncludeDirective(kw.value);
    if (!directive) continue;
    const resolved = await resolveOneInclude(directive, fetchPath, parseOrgFn, null);
    if (!resolved) continue;
    if (resolved.headings) prependedHeadings.push(...resolved.headings);
    else appendedBodyLines.push(...resolved.bodyLines);
  }

  const expandedChildren = [];
  for (const child of doc.children || []) {
    expandedChildren.push(await expandHeadingIncludes(child, fetchPath, parseOrgFn));
  }

  const newBodyLines = [...(doc.bodyLines || []), ...appendedBodyLines];
  return {
    ...doc,
    children: [...prependedHeadings, ...expandedChildren],
    bodyLines: newBodyLines,
    body: parseBody(newBodyLines),
  };
}

export { expandIncludes };
