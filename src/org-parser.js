
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
 * Known round-trip limitation: tag columns are not re-aligned to their
 * original character position on serialize (a single space is used before
 * the tag string instead of Emacs's right-aligned column). Structure and
 * content survive round-trip; exact visual alignment of the tag column
 * does not yet. Flagging this rather than papering over it.
 */

import { parseBody } from './body-parser.js';

const DEFAULT_TODO_KEYWORDS = ['TODO'];
const DEFAULT_DONE_KEYWORDS = ['DONE'];

// ---- tokenizing helpers -------------------------------------------------

const HEADING_RE = /^(\*+)\s+(.*)$/;
const KEYWORD_RE = /^#\+([A-Za-z][A-Za-z_]*):\s?(.*)$/;
const PROPERTY_DRAWER_START_RE = /^\s*:PROPERTIES:\s*$/i;
const PROPERTY_DRAWER_END_RE = /^\s*:END:\s*$/i;
const LOGBOOK_DRAWER_START_RE = /^\s*:LOGBOOK:\s*$/i;
const LOGBOOK_DRAWER_END_RE = /^\s*:END:\s*$/i;
const PROPERTY_LINE_RE = /^\s*:([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/;
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
    if (m && m[1].toUpperCase() === 'TODO') {
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

      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack[stack.length - 1].node.children.push(heading);
      stack.push({ node: heading, level });

      i++;

      if (i < lines.length && isPlanningLine(lines[i])) {
        const planning = parsePlanningLine(lines[i]);
        if (planning) heading.planning = planning;
        i++;
      }

      let sawDrawer = true;
      while (sawDrawer && i < lines.length) {
        sawDrawer = false;
        if (PROPERTY_DRAWER_START_RE.test(lines[i])) {
          sawDrawer = true;
          i++;
          while (i < lines.length && !PROPERTY_DRAWER_END_RE.test(lines[i])) {
            const pm = PROPERTY_LINE_RE.exec(lines[i]);
            if (pm) {
              const [, key, value] = pm;
              if (!(key in heading.properties)) heading.propertyOrder.push(key);
              heading.properties[key] = value;
            }
            i++;
          }
          i++; // consume :END:
        } else if (LOGBOOK_DRAWER_START_RE.test(lines[i])) {
          sawDrawer = true;
          i++;
          while (i < lines.length && !LOGBOOK_DRAWER_END_RE.test(lines[i])) {
            heading.logbookLines.push(lines[i]);
            i++;
          }
          i++; // consume :END:
        }
      }

      continue;
    }

    // Non-heading line: keyword line at document root, or body content
    // belonging to whatever node is currently on top of the stack.
    const current = stack[stack.length - 1].node;
    if (current.type === 'document') {
      const km = KEYWORD_RE.exec(line);
      if (km) {
        doc.keywords.push({ key: km[1], value: km[2] });
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

function serializeNode(node, out) {
  if (node.type === 'heading') {
    out.push(serializeHeadingLine(node));

    const planningLine = serializePlanningLine(node.planning);
    if (planningLine) out.push(planningLine);

    if (node.propertyOrder && node.propertyOrder.length) {
      out.push(':PROPERTIES:');
      for (const key of node.propertyOrder) {
        out.push(`:${key}: ${node.properties[key]}`);
      }
      out.push(':END:');
    }

    if (node.logbookLines && node.logbookLines.length) {
      out.push(':LOGBOOK:');
      for (const l of node.logbookLines) out.push(l);
      out.push(':END:');
    }

    for (const l of node.bodyLines || []) out.push(l);
    for (const child of node.children || []) serializeNode(child, out);
    return;
  }
  throw new Error(`serializeNode: unsupported node type ${node.type}`);
}

function serializeOrg(doc) {
  const out = [];
  for (const kw of doc.keywords) {
    out.push(`#+${kw.key}: ${kw.value}`);
  }
  for (const l of doc.bodyLines || []) out.push(l);
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
    count += 1; // the heading's own "* Title" line
    if (serializePlanningLine(node.planning)) count += 1;
    if (node.propertyOrder && node.propertyOrder.length) {
      count += 2 + node.propertyOrder.length; // :PROPERTIES: + one line per property + :END:
    }
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

export {
  parseOrg,
  serializeOrg,
  serializeHeadingSubtree,
  findHeadingLineNumber,
  DEFAULT_TODO_KEYWORDS,
  DEFAULT_DONE_KEYWORDS,
  parseTodoKeywordToken,
  parseTodoSpecValue,
};
