
/**
 * Org-mode parser: text -> AST, plus a matching serializer: AST -> text.
 *
 * Scope for this pass (foundation layer): document keywords, headings,
 * TODO keywords (default + configurable via #+TODO:), priority, tags,
 * planning lines (SCHEDULED/DEADLINE/CLOSED), property drawers, and the
 * :ARCHIVE: tag / ARCHIVE_* properties the archive model depends on.
 *
 * Section body content (paragraphs, lists, tables, blocks, links, inline
 * markup) is captured verbatim as `bodyLines` for now rather than parsed
 * into their own node types — this keeps round-trip safety guaranteed for
 * everything below a heading while the finer-grained body parser is built
 * out incrementally, per the "targeted diffs" / no-big-bang-rewrite pattern.
 * The AST is designed so that swap-in is additive: bodyLines becomes a
 * richer `body: Node[]` later without touching heading/planning/property
 * logic.
 *
 * ROUND TRIP. A file that is opened and saved without being edited must come
 * back byte for byte (the GitHub and WebDAV backends turn any difference into
 * a diff in the person's history). So each heading keeps `heading.raw`: the
 * original header line, planning line and drawer lines, plus a signature of
 * the parsed fields they were read into. The serializer writes the original
 * text for any part whose fields are unchanged, and regenerates only the parts
 * that were edited (a property that was not touched keeps its own line, with
 * its own spacing). Tag alignment, drawer indentation, padded property
 * values, planning order, empty or repeated drawers and property names with
 * a `+` or a `:` in them (`:header-args+:`, `:header-args:emacs-lisp:`) all
 * survive that way. `raw` is plain data, so structuredClone keeps it.
 *
 * Not handled here: CRLF line endings, which parseOrg reads but serializeOrg
 * writes as LF.
 */

import { parseBody } from './body-parser.js';

const DEFAULT_TODO_KEYWORDS = ['TODO'];

/** Whether a `#+KEY:` line defines a TODO sequence. `#+SEQ_TODO:` and `#+TYP_TODO:` are
 *  org's standard aliases of `#+TODO:` (a file using one would otherwise show its custom
 *  keywords as plain title text). */
function isTodoSequenceKey(key) {
  return /^(TODO|SEQ_TODO|TYP_TODO)$/i.test(key);
}
const DEFAULT_DONE_KEYWORDS = ['DONE'];

// ---- tokenizing helpers -------------------------------------------------

const HEADING_RE = /^(\*+)\s+(.*)$/;
const KEYWORD_RE = /^#\+([A-Za-z][A-Za-z_]*):\s?(.*)$/;
const PROPERTY_DRAWER_START_RE = /^\s*:PROPERTIES:\s*$/i;
const PROPERTY_DRAWER_END_RE = /^\s*:END:\s*$/i;
const LOGBOOK_DRAWER_START_RE = /^\s*:LOGBOOK:\s*$/i;
const LOGBOOK_DRAWER_END_RE = /^\s*:END:\s*$/i;
// Org's own rule (org-property-re): the name is the first token without its closing colon, however many
// colons or plus signs it contains -- :ID:, :header-args+:, :header-args:emacs-lisp:, :Effort_ALL:.
const PROPERTY_LINE_RE = /^\s*:(\S+):[ \t]*(.*?)[ \t]*$/;
const TAGS_RE = /\s+(:[A-Za-z0-9_@#%:]+:)\s*$/;
const PRIORITY_RE = /^\[#([A-Za-z0-9])\]\s*/;

const PLANNING_KEYWORD_RE = /(SCHEDULED|DEADLINE|CLOSED):\s*([<\[][^>\]]+[>\]])/g;
const BLOCK_START_RE = /^\s*#\+begin_(\w+)(?:\s+(.*))?$/i;
const BLOCK_END_RE = /^\s*#\+end_(\w+)\s*$/i;

function parsePlanningLine(line) {
  const planning = { scheduled: null, deadline: null, closed: null };
  let match;
  let found = false;
  PLANNING_KEYWORD_RE.lastIndex = 0;
  while ((match = PLANNING_KEYWORD_RE.exec(line)) !== null) {
    found = true;
    const [, kw, stamp] = match;
    if (kw === 'SCHEDULED') planning.scheduled = stamp;
    else if (kw === 'DEADLINE') planning.deadline = stamp;
    else if (kw === 'CLOSED') planning.closed = stamp;
  }
  return found ? planning : null;
}

function isPlanningLine(line) {
  return /^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(line);
}

function parseTags(rest) {
  const m = TAGS_RE.exec(rest);
  if (!m) return { rest, tags: [] };
  const tags = m[1].split(':').filter(Boolean);
  return { rest: rest.slice(0, m.index), tags };
}

function parsePriority(rest) {
  const m = PRIORITY_RE.exec(rest);
  if (!m) return { rest, priority: null };
  return { rest: rest.slice(m[0].length), priority: m[1] };
}

function parseTodoKeyword(rest, todoKeywords) {
  const spaceIdx = rest.indexOf(' ');
  const firstWord = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  if (todoKeywords.includes(firstWord)) {
    return { rest: spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1), todo: firstWord };
  }
  return { rest, todo: null };
}

/** Parses one token from a #+TODO: line's todo/done part -- "WAIT(w@/!)"
 *  -> { keyword: "WAIT", key: "w", logSpec: "@/!" }. The parenthesized
 *  suffix is entirely optional, and every combination inside it is real,
 *  valid org syntax: a bare "WAIT", fast-key-only "WAIT(w)",
 *  logging-only "WAIT(@/!)" or "WAIT(/!)", or both a key and a logging
 *  spec together. When present, a fast-key is always the first
 *  character (since @/!/ are reserved for the logging spec itself and
 *  can never themselves be a fast-key), so splitting on "the first
 *  character that isn't one of those" cleanly separates the two parts
 *  regardless of which are actually present. */
function parseTodoKeywordToken(token) {
  const m = /^([^\s(]+)(?:\(([^)]*)\))?$/.exec(token);
  if (!m) return { keyword: token, key: null, logSpec: null };
  const keyword = m[1];
  const paren = m[2] || '';
  const innerMatch = /^([^@!/])?(.*)$/.exec(paren);
  const key = innerMatch && innerMatch[1] ? innerMatch[1] : null;
  const logSpec = innerMatch && innerMatch[2] ? innerMatch[2] : null;
  return { keyword, key, logSpec };
}

/** Parses a full #+TODO: value ("TODO(t) WAIT(w@/!) | DONE(d!) KILL(k@)")
 *  into bare keyword lists (what heading-todo matching and TODO-cycling
 *  both need to agree on) plus per-keyword fast-key/logging-spec
 *  metadata, keyed by the bare keyword. `keySpecs`/`logSpecs` only ever
 *  contain entries for keywords that actually specified one -- a
 *  keyword with neither present at all, not present as null, so a
 *  caller can use straightforward `in`/property-access checks. */
function parseTodoSpecValue(value) {
  const hasBar = value.includes('|');
  const [todoPart, donePart = ''] = value.split('|').map((s) => s.trim());
  let todoTokens = todoPart.split(/\s+/).filter(Boolean).map(parseTodoKeywordToken);
  let doneTokens = donePart.split(/\s+/).filter(Boolean).map(parseTodoKeywordToken);
  if (!hasBar && todoTokens.length > 0) {
    doneTokens = [todoTokens[todoTokens.length - 1]];
    todoTokens = todoTokens.slice(0, -1);
  }
  const allTokens = [...todoTokens, ...doneTokens];
  const keySpecs = {};
  const logSpecs = {};
  for (const t of allTokens) {
    if (t.key) keySpecs[t.keyword] = t.key;
    if (t.logSpec) logSpecs[t.keyword] = t.logSpec;
  }
  return {
    todoKeywords: todoTokens.map((t) => t.keyword),
    doneKeywords: doneTokens.map((t) => t.keyword),
    keySpecs,
    logSpecs,
  };
}

// ---- main parse ----------------------------------------------------------

/**
 * @param {string} text
 * @param {{ todoKeywords?: string[], doneKeywords?: string[] }} [opts]
 */
function parseOrg(text, opts = {}) {
  const lines = text.split(/\r?\n/);
  const doc = { type: 'document', keywords: [], children: [], bodyLines: [] };

  let todoKeywords = opts.todoKeywords ? [...opts.todoKeywords] : [...DEFAULT_TODO_KEYWORDS];
  let doneKeywords = opts.doneKeywords ? [...opts.doneKeywords] : [...DEFAULT_DONE_KEYWORDS];

  // First pass: pull #+TODO: lines out so the keyword set is known before
  // headings are parsed (matches how Emacs treats file-local #+TODO:
  // lines). Real org's own actual model for multiple #+TODO: lines in
  // one file: each line defines a SEPARATE, complete, parallel sequence
  // (see todo-cycle.js's own header comment for the confirmed source),
  // not a progressive override of the previous one -- every keyword
  // across every line must be recognized here, unioned together. A
  // heading using an EARLIER line's own keyword (e.g. "WAIT" from a
  // file's first #+TODO: line, when a second, later line defines an
  // entirely different sequence) must still be recognized as a valid
  // TODO keyword at parse time -- getting this right here is more
  // fundamental than getting it right in resolveTodoSequence
  // (todo-cycle.js): everything downstream (Agenda, checkbox counting,
  // cycling) depends on heading.todo being set correctly to begin with,
  // not just on later code correctly interpreting an already-correct
  // value.
  let todoKeywordsUnion = [];
  let doneKeywordsUnion = [];
  let sawAnyTodoLine = false;
  for (const line of lines) {
    const m = KEYWORD_RE.exec(line);
    if (m && isTodoSequenceKey(m[1])) {
      sawAnyTodoLine = true;
      const spec = parseTodoSpecValue(m[2]);
      todoKeywordsUnion.push(...spec.todoKeywords);
      doneKeywordsUnion.push(...spec.doneKeywords);
    }
  }
  if (sawAnyTodoLine) {
    todoKeywords = [...new Set(todoKeywordsUnion)];
    doneKeywords = [...new Set(doneKeywordsUnion)];
  }
  const allTodoLike = [...todoKeywords, ...doneKeywords];

  const stack = [{ node: doc, level: 0 }];
  let i = 0;
  let inBlock = false; // true while between a #+BEGIN_.../#+END_... pair -- content in that range is literal, never re-parsed as a heading even if it starts with '*'

  while (i < lines.length) {
    const line = lines[i];

    if (inBlock) {
      if (BLOCK_END_RE.test(line)) inBlock = false;
      const current = stack[stack.length - 1].node;
      current.bodyLines.push(line);
      i++;
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);

    if (headingMatch) {
      const level = headingMatch[1].length;
      let rest = headingMatch[2];

      const todoParsed = parseTodoKeyword(rest, allTodoLike);
      rest = todoParsed.rest;

      const priorityParsed = parsePriority(rest);
      rest = priorityParsed.rest;

      const tagsParsed = parseTags(rest);
      const title = tagsParsed.rest.trim();

      const heading = {
        type: 'heading',
        level,
        todo: todoParsed.todo,
        priority: priorityParsed.priority,
        title,
        tags: tagsParsed.tags,
        planning: { scheduled: null, deadline: null, closed: null },
        properties: {},
        propertyOrder: [],
        logbookLines: [],
        bodyLines: [],
        collapsed: false,
        bodyHidden: false,
        children: [],
      };
      // The original text of the lines above the body, so an unedited heading is written back exactly as it was read.
      heading.raw = {
        header: line,
        headerSig: serializeHeadingLine(heading),
        planning: null,
        planningSig: null,
        drawers: [],
        propertyLines: {},
        propsSig: '',
        logSig: '',
      };

      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack[stack.length - 1].node.children.push(heading);
      stack.push({ node: heading, level });

      i++;

      if (i < lines.length && isPlanningLine(lines[i])) {
        const planning = parsePlanningLine(lines[i]);
        if (planning) heading.planning = planning;
        heading.raw.planning = lines[i];
        heading.raw.planningSig = serializePlanningLine(heading.planning);
        i++;
      }

      let sawDrawer = true;
      while (sawDrawer && i < lines.length) {
        sawDrawer = false;
        if (PROPERTY_DRAWER_START_RE.test(lines[i])) {
          sawDrawer = true;
          const segment = { type: 'properties', lines: [lines[i]] };
          i++;
          while (i < lines.length && !PROPERTY_DRAWER_END_RE.test(lines[i])) {
            segment.lines.push(lines[i]);
            const pm = PROPERTY_LINE_RE.exec(lines[i]);
            if (pm) {
              const [, key, value] = pm;
              if (!Object.prototype.hasOwnProperty.call(heading.properties, key)) heading.propertyOrder.push(key);
              heading.properties[key] = value;
              heading.raw.propertyLines[key] = { line: lines[i], value };
            }
            i++;
          }
          if (i < lines.length) segment.lines.push(lines[i]); // :END:
          i++; // consume :END:
          heading.raw.drawers.push(segment);
        } else if (LOGBOOK_DRAWER_START_RE.test(lines[i])) {
          sawDrawer = true;
          const segment = { type: 'logbook', lines: [lines[i]] };
          i++;
          while (i < lines.length && !LOGBOOK_DRAWER_END_RE.test(lines[i])) {
            heading.logbookLines.push(lines[i]);
            segment.lines.push(lines[i]);
            i++;
          }
          if (i < lines.length) segment.lines.push(lines[i]); // :END:
          i++; // consume :END:
          heading.raw.drawers.push(segment);
        }
      }
      heading.raw.propsSig = propertiesSignature(heading);
      heading.raw.logSig = JSON.stringify(heading.logbookLines);

      continue;
    }

    // Non-heading line: keyword line at document root, or body content
    // belonging to whatever node is currently on top of the stack.
    const current = stack[stack.length - 1].node;
    if (current.type === 'document') {
      const km = KEYWORD_RE.exec(line);
      if (km) {
        doc.keywords.push({ key: km[1], value: km[2], bodyLineIndex: doc.bodyLines.length });
        i++;
        continue;
      }
    }
    current.bodyLines.push(line);
    if (BLOCK_START_RE.test(line)) inBlock = true;
    i++;
  }

  attachBody(doc);
  return doc;
}

/**
 * Derives `node.body` (parsed lists/tables/blocks/paragraphs) from
 * `node.bodyLines` (raw text) for the document node and every heading.
 * Additive only — bodyLines remains the serialization source of truth, so
 * this can't introduce a round-trip regression.
 */
function attachBody(node) {
  node.body = parseBody(node.bodyLines || []);
  for (const child of node.children || []) attachBody(child);
}

// ---- serialize -------------------------------------------------------

function serializeHeadingLine(node) {
  const stars = '*'.repeat(node.level);
  const parts = [stars];
  if (node.todo) parts.push(node.todo);
  if (node.priority) parts.push(`[#${node.priority}]`);
  let line = parts.join(' ');
  line += node.title ? ` ${node.title}` : '';
  if (node.tags && node.tags.length) {
    line += ` :${node.tags.join(':')}:`;
  }
  return line;
}

function serializePlanningLine(planning) {
  if (!planning) return null;
  const parts = [];
  if (planning.scheduled) parts.push(`SCHEDULED: ${planning.scheduled}`);
  if (planning.deadline) parts.push(`DEADLINE: ${planning.deadline}`);
  if (planning.closed) parts.push(`CLOSED: ${planning.closed}`);
  return parts.length ? parts.join(' ') : null;
}

/** A fingerprint of the property fields, to tell whether they still match what was read from the file. */
function propertiesSignature(node) {
  const order = node.propertyOrder || [];
  const props = node.properties || {};
  return JSON.stringify(order.map((key) => [key, props[key]]));
}

/** A property written from scratch: `:KEY: value`, or just `:KEY:` when the value is empty (as org writes it). */
function canonicalPropertyLine(key, value, indent = '') {
  return value === '' || value == null ? `${indent}:${key}:` : `${indent}:${key}: ${value}`;
}

const leadingSpace = (line) => /^\s*/.exec(line)[0];

/** The properties drawer as lines. A property that was not touched keeps the
 *  line it was read from, spacing and all; one that is new or changed is
 *  written fresh, in the drawer's own indentation. */
function propertiesDrawerLines(node) {
  const order = node.propertyOrder || [];
  if (!order.length) return [];
  const raw = node.raw;
  const first = raw && raw.drawers.find((d) => d.type === 'properties');
  const indent = first ? leadingSpace(first.lines[0]) : '';
  const lines = [`${indent}:PROPERTIES:`];
  for (const key of order) {
    const kept = raw && raw.propertyLines && Object.prototype.hasOwnProperty.call(raw.propertyLines, key) ? raw.propertyLines[key] : null;
    lines.push(kept && kept.value === node.properties[key] ? kept.line : canonicalPropertyLine(key, node.properties[key], indent));
  }
  lines.push(`${indent}:END:`);
  return lines;
}

function logbookDrawerLines(node) {
  const log = node.logbookLines || [];
  if (!log.length) return [];
  const first = node.raw && node.raw.drawers.find((d) => d.type === 'logbook');
  const indent = first ? leadingSpace(first.lines[0]) : '';
  return [`${indent}:LOGBOOK:`, ...log, `${indent}:END:`];
}

/** Every line from a heading's own line down to (not including) its body, in
 *  file order: the heading line, the planning line, and the drawers. Each
 *  part is the original text when its fields are unchanged since the file was
 *  read, and regenerated only when they were edited. The one place that
 *  decides this, so the serializer and the line-number lookups below cannot
 *  disagree about how many lines a heading takes. */
function headingPreambleLines(node) {
  const raw = node.raw;
  const lines = [];

  const header = serializeHeadingLine(node);
  lines.push(raw && raw.headerSig === header ? raw.header : header);

  const planning = serializePlanningLine(node.planning);
  if (raw && raw.planning != null && raw.planningSig === planning) lines.push(raw.planning);
  else if (planning) lines.push(planning);

  const propsUnchanged = !!raw && raw.propsSig === propertiesSignature(node);
  const logUnchanged = !!raw && raw.logSig === JSON.stringify(node.logbookLines || []);
  if (propsUnchanged && logUnchanged) {
    for (const drawer of raw.drawers) lines.push(...drawer.lines); // exactly as read: order, indentation, repeats, empty drawers
  } else {
    const keep = (type) => raw.drawers.filter((d) => d.type === type).flatMap((d) => d.lines);
    lines.push(...(propsUnchanged ? keep('properties') : propertiesDrawerLines(node)));
    lines.push(...(logUnchanged ? keep('logbook') : logbookDrawerLines(node)));
  }
  return lines;
}

function serializeNode(node, out) {
  if (node.type === 'heading') {
    out.push(...headingPreambleLines(node));

    for (const l of node.bodyLines || []) out.push(l);
    for (const child of node.children || []) serializeNode(child, out);
    return;
  }
  throw new Error(`serializeNode: unsupported node type ${node.type}`);
}

function serializeOrg(doc) {
  const out = [];
  const bodyLines = doc.bodyLines || [];
  const orderedKeywords = doc.keywords
    .map((kw, originalIndex) => ({ kw, originalIndex }))
    .sort((a, b) => {
      const ai = a.kw.bodyLineIndex ?? 0;
      const bi = b.kw.bodyLineIndex ?? 0;
      return ai !== bi ? ai - bi : a.originalIndex - b.originalIndex;
    });
  let bodyIdx = 0;
  for (const { kw } of orderedKeywords) {
    const target = Math.min(kw.bodyLineIndex ?? 0, bodyLines.length);
    while (bodyIdx < target) {
      out.push(bodyLines[bodyIdx]);
      bodyIdx++;
    }
    out.push(`#+${kw.key}: ${kw.value}`);
  }
  for (; bodyIdx < bodyLines.length; bodyIdx++) out.push(bodyLines[bodyIdx]);
  for (const child of doc.children) serializeNode(child, out);
  return out.join('\n');
}

/** Serializes just `heading` and its own entire subtree (sub-headings,
 *  all the way down) back to org text -- unlike serializeOrg, which
 *  always serializes a WHOLE document. Needed for org-cut-subtree
 *  (C-c C-x C-w): the cut content copied to the clipboard is this
 *  heading's own text alone, not the surrounding document around it. */
function serializeHeadingSubtree(heading) {
  const out = [];
  serializeNode(heading, out);
  return out.join('\n');
}

/**
 * Returns the 0-indexed line number where `targetHeading` starts within
 * serializeOrg(doc)'s own output -- i.e., what line its own "* Title"
 * line lands on if the document were serialized to plain text right
 * now. Mirrors serializeNode's exact structure (the heading line
 * itself, then an optional planning line, then an optional properties
 * drawer, then body lines, then children) line-for-line, rather than a
 * separate, independently-maintained counting implementation that
 * could silently drift out of sync with what serializeOrg actually
 * produces. Returns -1 if targetHeading isn't reachable from doc at
 * all (e.g. a stale reference to a heading that's since been deleted).
 */
function findHeadingLineNumber(doc, targetHeading) {
  let count = doc.keywords.length + (doc.bodyLines ? doc.bodyLines.length : 0);

  function walk(node) {
    if (node === targetHeading) return true;
    count += headingPreambleLines(node).length; // heading line, planning line and drawers, exactly as serialized
    count += (node.bodyLines || []).length;
    for (const child of node.children || []) {
      if (walk(child)) return true;
    }
    return false;
  }

  for (const child of doc.children) {
    if (walk(child)) return count;
  }
  return -1;
}

/**
 * The inverse of findHeadingLineNumber: given a 0-indexed line number
 * (within serializeOrg(doc)'s own output), returns whichever heading's
 * own "* Title" line starts exactly there, or null if no heading
 * starts at that exact line. Needed specifically for narrowed
 * text-mode's own splice-back commit, where a title-based lookup
 * (findHeadingByOutlinePath) would incorrectly treat renaming or
 * re-leveling the narrowed heading itself as "it's gone" -- this
 * finds it by its own known position instead, which survives both.
 */
function findHeadingAtLine(doc, targetLine) {
  let count = doc.keywords.length + (doc.bodyLines ? doc.bodyLines.length : 0);

  function walk(node) {
    if (count === targetLine) return node;
    count += headingPreambleLines(node).length; // heading line, planning line and drawers, exactly as serialized
    count += (node.bodyLines || []).length;
    for (const child of node.children || []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  }

  for (const child of doc.children) {
    const found = walk(child);
    if (found) return found;
  }
  return null;
}

export {
  parseOrg,
  serializeOrg,
  serializeHeadingSubtree,
  serializeHeadingLine,
  findHeadingLineNumber,
  findHeadingAtLine,
  DEFAULT_TODO_KEYWORDS,
  DEFAULT_DONE_KEYWORDS,
  parseTodoKeywordToken,
  parseTodoSpecValue,
  isTodoSequenceKey,
};
