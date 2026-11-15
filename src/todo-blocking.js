// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * Blocking a change of TODO state: `org-enforce-todo-dependencies` and `org-enforce-todo-checkbox-dependencies` with the two functions Org
 * puts on `org-blocker-hook` for them (`org-block-todo-from-children-or-siblings-or-parent`, `org-block-todo-from-checkboxes`),
 * the ORDERED property, the NOBLOCKING property and `org-entry-blocked-p`.
 */
import { findLists } from './list-edit.js';
import { headingPreambleLines } from './org-parser.js';

/** @typedef {{ enforceDependencies: boolean, enforceCheckboxes: boolean, todoKeywords: string[], doneKeywords: string[] }} BlockingContext */

/** A box left to check, as org-block-todo-from-checkboxes looks for one: `[ ]` or `[-]` after a bullet and an optional `[@n]`. */
const OPEN_BOX_RE = /^[ \t]*(?:[-+*]|(?:\d+|[A-Za-z])[.)])(?:[ \t]+|$)(?:\[@(?:start:)?(?:\d+|[A-Za-z])\][ \t]*)?\[[- ]\]/;

/** Every heading below `root` in file order, with its depth first.
 * @param {Heading | Doc} root @returns {Heading[]} */
function descendants(root) {
  /** @type {Heading[]} */ const out = [];
  /** @param {Heading} h */
  const visit = (h) => {
    out.push(h);
    for (const c of h.children) visit(c);
  };
  for (const c of root.children) visit(c);
  return out;
}

/** The headings above `heading`, outermost first, and the siblings list each sits in.
 * @param {Doc} doc @param {Heading} heading @returns {Heading[] | null} */
function pathTo(doc, heading) {
  /** @param {Heading[]} list @param {Heading[]} acc @returns {Heading[] | null} */
  const find = (list, acc) => {
    for (const h of list) {
      if (h === heading) return acc;
      const inner = find(h.children, [...acc, h]);
      if (inner) return inner;
    }
    return null;
  };
  return find(doc.children, []);
}

/** The text org-get-heading gives for a heading: the line without its stars (keyword, priority, title and tags as written).
 * @param {Heading} h */
function headingText(h) {
  const cookie = h.priority ? `[#${h.priority}] ` : '';
  const tags = h.tags && h.tags.length ? ` :${h.tags.join(':')}:` : '';
  return `${h.todo ? h.todo + ' ' : ''}${cookie}${h.title}${tags}`;
}

/** What org-not-done-heading-regexp matches in org-block-todo-from-children-or-siblings-or-parent: the whole heading line.
 * @param {Heading} h */
function notDoneMatch(h) {
  return headingPreambleLines(h)[0];
}

/**
 * Why a change of the state of `heading` from `from` to `to` is blocked, or null when it is not. Follows
 * org-block-todo-from-children-or-siblings-or-parent, then org-block-todo-from-checkboxes, as org-todo runs them
 * (the entry's own NOBLOCKING property switches both off).
 * @param {Doc} doc @param {Heading} heading @param {string | null} from @param {string | null} to @param {BlockingContext} ctx
 * @returns {{ reason: string, byCheckboxes: boolean } | null}
 */
export function blockedBy(doc, heading, from, to, ctx) {
  if (!ctx.enforceDependencies && !ctx.enforceCheckboxes) return null;
  if (Object.keys(heading.properties || {}).some((k) => k.toUpperCase() === 'NOBLOCKING' && heading.properties[k] !== 'nil')) return null;
  const notDone = (/** @type {string | null} */ k) => k !== null && ctx.todoKeywords.includes(k) && !ctx.doneKeywords.includes(k);
  if ((from !== null && (from === 'done' || ctx.doneKeywords.includes(from))) || to === null || to === 'todo' || ctx.todoKeywords.filter((k) => !ctx.doneKeywords.includes(k)).includes(to)) return null;
  if (ctx.enforceDependencies) {
    // an open task anywhere below it
    for (const d of descendants(heading)) if (notDone(d.todo)) return { reason: headingText(d), byCheckboxes: false };
    // an earlier open task under a parent that is ORDERED, then the same for each parent that is a task itself
    const above = pathTo(doc, heading);
    if (above && above.length > 0) {
      const ordered = (/** @type {Heading} */ h) => Object.entries(h.properties || {}).some(([k, v]) => k.toUpperCase() === 'ORDERED' && v !== 'nil');
      /** @param {Heading} parent @param {Heading} before */
      const earlierOpen = (parent, before) => {
        for (const d of descendants(parent)) {
          if (d === before) return null;
          if (notDone(d.todo)) return d;
        }
        return null;
      };
      let node = heading;
      for (let i = above.length - 1; i >= 0; i--) {
        const parent = above[i];
        if (i < above.length - 1 && !notDone(node.todo)) break; // the parent is not a task: do not block
        if (ordered(parent)) {
          const hit = earlierOpen(parent, node);
          if (hit) return { reason: node === heading ? notDoneMatch(hit) : headingText(hit), byCheckboxes: false };
        }
        node = parent;
      }
    }
  }
  if (ctx.enforceCheckboxes) {
    for (const lines of [heading.logbookLines, heading.preLogLines, heading.bodyLines]) {
      if (!Array.isArray(lines)) continue;
      for (const list of findLists(lines)) for (const it of list.items) if (OPEN_BOX_RE.test(lines[it.line])) return { reason: 'contained checkboxes', byCheckboxes: true };
    }
  }
  return null;
}

/**
 * org-entry-blocked-p: whether `heading` (a task that is not done) could not go to done now.
 * @param {Doc} doc @param {Heading} heading @param {BlockingContext} ctx */
export function entryBlockedP(doc, heading, ctx) {
  if (Object.keys(heading.properties || {}).some((k) => k.toUpperCase() === 'NOBLOCKING' && heading.properties[k] !== 'nil')) return false;
  if (heading.todo === null || !ctx.todoKeywords.includes(heading.todo) || ctx.doneKeywords.includes(heading.todo)) return false;
  return blockedBy(doc, heading, 'todo', 'done', ctx) !== null;
}

/** The message org-todo gives when it refuses a change.
 * @param {string | null} from @param {string | null} to @param {{ reason: string, byCheckboxes: boolean }} block */
export function blockedMessage(from, to, block) {
  return `TODO state change from ${from ?? 'nil'} to ${to ?? 'nil'} blocked (by ${block.byCheckboxes ? block.reason : `"${block.reason}"`})`;
}
