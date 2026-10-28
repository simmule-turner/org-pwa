// @ts-check
// Inline tasks (org-inlinetask): a headline of `org-inlinetask-min-level` stars or more (15), with its text up to an `END` headline of the
// same kind. Emacs treats them so only when org-inlinetask is loaded: `org-modules` does not list it by default, so a stock Emacs reads such a
// line as an ordinary headline fifteen levels down, and so does the app until the module is switched on, with
// `(add-to-list 'org-modules 'org-inlinetask)` or `(require 'org-inlinetask)` in the Lisp init, or `org-modules` in the global variables.
//
// The editing model keeps them as headings (the Agenda, capture and TODO cycling work on them, as in Emacs). The exporters see them as
// Org's parser does: `foldInlineTasks` turns each one into a block named `org_pwa_inlinetask` in the text of the section it belongs to,
// whose parameter is the task's todo keyword, priority, title and tags, and whose lines are the task's contents.
import { headingPreambleLines } from './org-parser.js';
import { parseBody } from './body-parser.js';
import { listItems, symbolName, datum } from './lisp-read.js';
import { runInit } from './lisp-init.js';
import { lispStringValue } from './export-defaults.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */

export const INLINE_TASK_BLOCK = 'org_pwa_inlinetask';
export const DEFAULT_MIN_LEVEL = 15;

/** The level from which exports read inline tasks; null while org-inlinetask is not loaded. */
const config = { level: /** @type {number | null} */ (null) };

/** @param {number | null} level */
export function setInlineTaskLevel(level) {
  config.level = level;
}

export function getInlineTaskLevel() {
  return config.level;
}

/**
 * The inline task level the variables ask for: `org-inlinetask-min-level` when org-inlinetask is in `org-modules` (the global variables or the
 * Lisp init) or required there; null otherwise.
 * @param {Record<string, string> | null | undefined} vars
 * @returns {number | null}
 */
export function readInlineTaskLevel(vars) {
  const v = vars || {};
  const raw = v['org-xx-lisp-init'];
  const text = lispStringValue(raw) || raw || '';
  const init = runInit(text);
  const modules = listItems(init.get('org-modules')) || [];
  const loaded = /\borg-inlinetask\b/.test(v['org-modules'] || '') || modules.some((m) => symbolName(m) === 'org-inlinetask') || /\(\s*require\s+'org-inlinetask\b/.test(text);
  if (!loaded) return null;
  const set = init.get('org-inlinetask-min-level');
  const fromInit = set ? datum(set) : null;
  const n = fromInit && fromInit.k === 'num' ? fromInit.v : Number(v['org-inlinetask-min-level']);
  return Number.isInteger(n) && n >= 2 ? n : DEFAULT_MIN_LEVEL;
}

/** @param {Heading} h @param {number} level */
const isTask = (h, level) => h.level >= level;
/** An `END` line closes the task before it. @param {Heading} h */
const isEnd = (h) => !h.todo && !h.priority && (!h.tags || !h.tags.length) && /^END$/i.test(String(h.title || '').trim());

/** The lines under a task's own line (planning, drawers) without its property drawer, which Org does not export.
 * @param {Heading} task @returns {string[]} */
function underLine(task) {
  const out = [];
  let inside = false;
  for (const line of headingPreambleLines(task).slice(1)) {
    if (!inside && /^\s*:PROPERTIES:\s*$/i.test(line)) inside = true;
    else if (inside) inside = !/^\s*:END:\s*$/i.test(line);
    else out.push(line);
  }
  return out;
}

/** The headings of a run of inline tasks in document order, each with the ones below it.
 * @param {Heading[]} children @param {number} level @param {Heading[]} out */
function runOf(children, level, out) {
  for (const c of children) {
    out.push(c);
    runOf(c.children || [], level, out);
  }
}

/**
 * The text lines that stand for the inline tasks among `children`, to go at the end of the section they belong to.
 * @param {Heading[]} children @param {number} level
 * @returns {string[]}
 */
function blocksFor(children, level) {
  /** @type {Heading[]} */ const run = [];
  runOf(children, level, run);
  /** @type {string[]} */ const out = [];
  for (let i = 0; i < run.length; i++) {
    const task = run[i];
    const info = JSON.stringify({ todo: task.todo || null, priority: task.priority || null, title: task.title || '', tags: task.tags || [] });
    const closing = run[i + 1] && isEnd(run[i + 1]) ? run[i + 1] : null;
    out.push(`#+begin_${INLINE_TASK_BLOCK} ${info}`);
    if (closing) out.push(...underLine(task), ...(task.bodyLines || []));
    out.push(`#+end_${INLINE_TASK_BLOCK}`);
    if (closing) {
      out.push(...(closing.bodyLines || []));
      i++;
    } else out.push(...underLine(task), ...(task.bodyLines || []));
  }
  return out;
}

/**
 * A copy of the document in which every inline task is a block in the text of the section it belongs to, and no longer a heading.
 * `scope` (a heading of the document or null) is returned as its copy.
 * @param {Doc} doc @param {Heading | null | undefined} scope @param {number | null} [level]
 * @returns {{ doc: Doc, scope: Heading | null }}
 */
export function foldInlineTasks(doc, scope, level = config.level) {
  if (level === null || level === undefined) return { doc, scope: scope || null };
  const min = level;
  let found = false;
  /** @type {Map<Heading, Heading>} */ const copies = new Map();
  /** @param {Heading[]} list @returns {{ keep: Heading[], tasks: Heading[] }} */
  const split = (list) => {
    /** @type {Heading[]} */ const keep = [];
    /** @type {Heading[]} */ const tasks = [];
    for (const c of list) (isTask(c, min) ? tasks : keep).push(c);
    return { keep, tasks };
  };
  /** @param {Heading} h @returns {Heading} */
  const copy = (h) => {
    const { keep, tasks } = split(h.children || []);
    const next = { ...h, children: keep.map(copy) };
    if (tasks.length) {
      found = true;
      next.bodyLines = [...(h.bodyLines || []), ...blocksFor(tasks, min)];
      next.body = parseBody(next.bodyLines);
    }
    copies.set(h, next);
    return next;
  };
  const top = split(doc.children || []);
  const children = top.keep.map(copy);
  if (!found && !top.tasks.length) return { doc, scope: scope || null };
  /** @type {Doc} */
  const next = { ...doc, children };
  if (top.tasks.length) next.bodyLines = [...(doc.bodyLines || []), ...blocksFor(top.tasks, min)];
  return { doc: next, scope: scope ? copies.get(scope) || scope : null };
}

/** The values of an inline task block's parameter.
 * @param {string} params
 * @returns {{ todo: string | null, priority: string | null, title: string, tags: string[] }} */
export function inlineTaskInfo(params) {
  try {
    const v = JSON.parse(params);
    return { todo: v.todo || null, priority: v.priority || null, title: String(v.title || ''), tags: Array.isArray(v.tags) ? v.tags : [] };
  } catch {
    return { todo: null, priority: null, title: params, tags: [] };
  }
}
