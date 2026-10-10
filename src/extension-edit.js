/**
 * What a script command sees and may change: the pure part. A command gets a read-only snapshot of the
 * open file as plain data, and answers with a list of declarative edits. Nothing here touches the page;
 * src-browser/extension-flow.js applies the edits as one undo step.
 */

const MAX_HEADINGS = 5000;
const MAX_BODY_CHARS = 20000;
const MAX_TOTAL_CHARS = 2_000_000;
export const MAX_EDITS = 500;

/** The headings of `doc` in outline order. */
export function headingsInOrder(doc) {
  const out = [];
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node.type !== 'heading') continue;
      out.push(node);
      walk(node.children);
    }
  };
  walk(doc.children);
  return out;
}

/** A read-only copy of the file for a script: `{ name, headings, focused, truncated }`. `focused` is the index of
 *  the heading the command was run on, or null. */
export function snapshotDocument(doc, { name = '', focusedHeading = null } = {}) {
  const all = headingsInOrder(doc);
  const stack = [];
  let total = 0;
  let truncated = false;
  const headings = [];
  for (let index = 0; index < all.length; index++) {
    const h = all[index];
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    const path = stack.map((s) => s.title);
    stack.push({ level: h.level, title: h.title });
    const body = (h.bodyLines || []).join('\n');
    total += body.length + (h.title || '').length;
    if (index >= MAX_HEADINGS || total > MAX_TOTAL_CHARS) {
      truncated = true;
      break;
    }
    headings.push({
      index,
      level: h.level,
      title: h.title || '',
      todo: h.todo || null,
      priority: h.priority || null,
      tags: (h.tags || []).slice(),
      properties: { ...(h.properties || {}) },
      scheduled: (h.planning && h.planning.scheduled) || null,
      deadline: (h.planning && h.planning.deadline) || null,
      closed: (h.planning && h.planning.closed) || null,
      body: body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body,
      bodyTruncated: body.length > MAX_BODY_CHARS,
      path,
    });
  }
  const focused = focusedHeading ? all.indexOf(focusedHeading) : -1;
  return { name, headings, focused: focused >= 0 && focused < headings.length ? focused : null, truncated };
}

const TODO_RE = /^[A-Z][A-Z0-9_-]*$/;
const TAG_RE = /^[\w@#%]+$/;
const PROP_RE = /^[A-Za-z0-9_-]+$/;

/** Checks a list of edits against the snapshot's heading count. Returns an error message, or null when every
 *  edit is well formed. The kinds are: set-title, set-todo, set-tags, set-property, delete-property, append-body. */
export function validateEdits(edits, headingCount) {
  if (!Array.isArray(edits)) return 'edits must be a list';
  if (edits.length > MAX_EDITS) return `too many edits (more than ${MAX_EDITS})`;
  for (const e of edits) {
    if (!e || typeof e !== 'object') return 'an edit is not an object';
    if (!Number.isInteger(e.heading) || e.heading < 0 || e.heading >= headingCount) return `no heading number ${e.heading}`;
    switch (e.op) {
      case 'set-title':
        if (typeof e.title !== 'string' || /[\r\n]/.test(e.title) || e.title.trim() === '') return 'a title must be one non-empty line';
        break;
      case 'set-todo':
        if (e.todo !== null && !(typeof e.todo === 'string' && TODO_RE.test(e.todo))) return `"${e.todo}" is not a TODO keyword`;
        break;
      case 'set-tags':
        if (!Array.isArray(e.tags) || !e.tags.every((t) => typeof t === 'string' && TAG_RE.test(t))) return 'tags must be words of letters, digits, _ @ # %';
        break;
      case 'set-property':
        if (typeof e.name !== 'string' || !PROP_RE.test(e.name) || typeof e.value !== 'string' || /[\r\n]/.test(e.value)) return 'a property needs a simple name and a one-line value';
        break;
      case 'delete-property':
        if (typeof e.name !== 'string' || !PROP_RE.test(e.name)) return 'a property needs a simple name';
        break;
      case 'append-body':
        if (typeof e.text !== 'string') return 'append-body needs text';
        break;
      default:
        return `unknown edit "${e.op}"`;
    }
  }
  return null;
}

/** Whether the first `headings.length` headings of `doc` still have the titles and levels the snapshot recorded, so
 *  edits made against the snapshot would land on the same headings. */
export function snapshotStillMatches(doc, snapshot) {
  const all = headingsInOrder(doc);
  return snapshot.headings.every((s, i) => all[i] && all[i].level === s.level && (all[i].title || '') === s.title);
}

/** Applies validated edits to the live headings. `deps` supplies what depends on the app: `setTodo(heading, todo)`,
 *  `setProperty(heading, name, value)`, `deleteProperty(heading, name)` and `appendBody(heading, lines)`. */
export function applyEdits(doc, edits, deps) {
  const all = headingsInOrder(doc);
  for (const e of edits) {
    const h = all[e.heading];
    if (e.op === 'set-title') h.title = e.title.trim();
    else if (e.op === 'set-todo') deps.setTodo(h, e.todo);
    else if (e.op === 'set-tags') h.tags = e.tags.slice();
    else if (e.op === 'set-property') deps.setProperty(h, e.name, e.value);
    else if (e.op === 'delete-property') deps.deleteProperty(h, e.name);
    else if (e.op === 'append-body') deps.appendBody(h, e.text.split(/\r?\n/));
  }
}
