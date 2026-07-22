
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
const PROPERTY_LINE_RE = /^\s*:([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/;
const TAGS_RE = /\s+(:[A-Za-z0-9_@#%:]+:)\s*$/;
const PRIORITY_RE = /^\[#([A-Za-z0-9])\]\s*/;

const PLANNING_KEYWORD_RE = /(SCHEDULED|DEADLINE|CLOSED):\s*([<\[][^>\]]+[>\]])/g;

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
  // headings are parsed (matches how Emacs treats file-local #+TODO: lines).
  for (const line of lines) {
    const m = KEYWORD_RE.exec(line);
    if (m && m[1].toUpperCase() === 'TODO') {
      const [todoPart, donePart = ''] = m[2].split('|').map((s) => s.trim());
      const todos = todoPart.split(/\s+/).filter(Boolean);
      const dones = donePart.split(/\s+/).filter(Boolean);
      if (todos.length) todoKeywords = todos;
      if (dones.length) doneKeywords = dones;
    }
  }
  const allTodoLike = [...todoKeywords, ...doneKeywords];

  const stack = [{ node: doc, level: 0 }];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
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

      if (i < lines.length && PROPERTY_DRAWER_START_RE.test(lines[i])) {
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

export {
  parseOrg,
  serializeOrg,
  DEFAULT_TODO_KEYWORDS,
  DEFAULT_DONE_KEYWORDS,
};
