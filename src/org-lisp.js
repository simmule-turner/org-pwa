// @ts-check
/**
 * The Org functions an agenda setting may call (`org-entry-get`, `org-get-heading`, `org-get-tags`, ...), as built-ins of the Lisp
 * interpreter. Emacs runs such a setting with the cursor on a heading; here `withHeading` says which heading that is.
 */
import { NIL, Sym, intern, list, print, signal, wrongType } from './elisp-data.js';
import { defun } from './elisp-core.js';
import { inheritedProperty, topPropertyPairs } from './babel-args.js';
import { parsePropertyInheritance, parseTagInheritance, propertyInherits, tagInherits } from './tag-inheritance.js';
import { cookieOf, readPriorityRange } from './priorities.js';

/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./elisp-data.js').LObj} LObj */
/**
 * @typedef {object} HeadingContext  the heading the cursor is on
 * @property {Doc} doc
 * @property {Heading} heading
 * @property {Heading[]} [ancestors]  outermost first; found in `doc` when left out
 * @property {string} [category]  the category when no CATEGORY property or keyword names one (the file name in Emacs)
 * @property {string[]} [todoKeywords]  the unfinished keywords (default TODO)
 * @property {string[]} [doneKeywords]  the finished ones (default DONE)
 */

/** @type {HeadingContext | null} */
let current = null;

/** Runs `fn` with the cursor on a heading. @template T @param {HeadingContext} context @param {() => T} fn @returns {T} */
export function withHeading(context, fn) {
  const outer = current;
  current = context;
  try {
    return fn();
  } finally {
    current = outer;
  }
}

/** @returns {HeadingContext & { ancestors: Heading[] }} */
function here() {
  if (!current) throw signal('error', ['Not on an Org heading']);
  if (!current.ancestors) current = { ...current, ancestors: ancestorsOf(current.doc, current.heading) };
  return /** @type {HeadingContext & { ancestors: Heading[] }} */ (current);
}

/** The heading the cursor is on (an error outside `withHeading`). */
export function currentHeading() {
  return here();
}

/** The headings above `heading`, outermost first. @param {Doc} doc @param {Heading} heading @returns {Heading[]} */
export function ancestorsOf(doc, heading) {
  /** @param {Heading[]} nodes @param {Heading[]} chain @returns {Heading[] | null} */
  const walk = (nodes, chain) => {
    for (const node of nodes || []) {
      if (node.type !== 'heading') continue;
      if (node === heading) return chain;
      const found = walk(node.children, [...chain, node]);
      if (found) return found;
    }
    return null;
  };
  return walk(doc.children, []) || [];
}

/** @param {Doc} doc @param {string} key @returns {string | null} */
function keyword(doc, key) {
  const k = (doc.keywords || []).find((x) => String(x.key).toUpperCase() === key);
  return k ? String(k.value).trim() : null;
}

/** The printed value of a Lisp variable (set, or bound by a `let`), or undefined while it is void. @param {string} name @returns {string | undefined} */
function variableText(name) {
  const value = intern(name).value;
  return value === undefined ? undefined : print(value);
}

/** The tags of the heading as `org-get-tags` lists them: the file's and its ancestors' first, as far as `org-use-tag-inheritance` and
 * `org-tags-exclude-from-inheritance` let them in, then its own; a tag that comes twice stays where it is most local.
 * @param {HeadingContext & { ancestors: Heading[] }} c @param {boolean} local */
function tagsOf(c, local) {
  const own = c.heading.tags || [];
  if (local) return [...own];
  const policy = parseTagInheritance(variableText('org-use-tag-inheritance'), variableText('org-tags-exclude-from-inheritance'));
  if (policy === false) return [...own];
  const file = (keyword(c.doc, 'FILETAGS') || '').split(/[:\s]+/).filter(Boolean);
  const all = [...file, ...c.ancestors.flatMap((a) => a.tags || [])].filter((t) => tagInherits(policy, t)).concat(own);
  return all.filter((t, i) => all.lastIndexOf(t) === i);
}

/** @param {HeadingContext & { ancestors: Heading[] }} c @returns {string} */
function categoryOf(c) {
  for (const h of [c.heading, ...[...c.ancestors].reverse()]) {
    const entry = Object.entries(h.properties || {}).find(([k]) => k.toUpperCase() === 'CATEGORY');
    if (entry) return String(entry[1]);
  }
  const top = topPropertyPairs(c.doc).find(([k]) => k.toUpperCase() === 'CATEGORY'); // the drawer at the top of the file
  if (top) return top[1];
  return keyword(c.doc, 'CATEGORY') ?? c.category ?? '';
}

/** @param {HeadingContext & { ancestors: Heading[] }} c @param {boolean} noTags @param {boolean} noTodo @param {boolean} noPriority @param {boolean} noComment */
function headingText(c, noTags, noTodo, noPriority, noComment) {
  const h = c.heading;
  const parts = [];
  if (h.todo && !noTodo) parts.push(h.todo);
  if (h.priority && !noPriority) parts.push(`[#${h.priority}]`);
  const title = noComment ? String(h.title || '').replace(/^COMMENT\s*/, '') : String(h.title || '');
  if (title) parts.push(title);
  if (h.tags && h.tags.length && !noTags) parts.push(`:${h.tags.join(':')}:`);
  return parts.join(' ');
}

/** @param {LObj} x @returns {string} */
function stringArg(x) {
  if (typeof x === 'string') return x;
  throw wrongType('stringp', x);
}

/** org-entry-get. @param {LObj} property @param {boolean | 'selective'} inherit @param {boolean} literalNil @returns {LObj} */
function entryGet(property, inherit, literalNil) {
  const c = here();
  const name = stringArg(property);
  const h = c.heading;
  /** @type {string | null | undefined} */
  let value;
  switch (name.toUpperCase()) {
    case 'ITEM': value = headingText(c, true, true, true, false); break;
    case 'TODO': value = h.todo; break;
    case 'PRIORITY': value = h.priority || cookieOf(readPriorityRange({}).default); break;
    case 'TAGS': value = h.tags && h.tags.length ? `:${h.tags.join(':')}:` : null; break;
    case 'ALLTAGS': {
      const all = tagsOf(c, false);
      value = all.length ? `:${all.join(':')}:` : null;
      break;
    }
    case 'CATEGORY': value = categoryOf(c); break;
    case 'SCHEDULED': value = h.planning && h.planning.scheduled; break;
    case 'DEADLINE': value = h.planning && h.planning.deadline; break;
    case 'CLOSED': value = h.planning && h.planning.closed; break;
    default: {
      let inherits = inherit === true;
      if (inherit === 'selective') {
        // inheritance only for the properties org-use-property-inheritance names (org-property-inherit-p)
        const policy = parsePropertyInheritance(variableText('org-use-property-inheritance'));
        if (policy === null) throw signal('error', ["Invalid setting of `org-use-property-inheritance'"]);
        inherits = propertyInherits(policy, name);
      }
      // the values of NAME+ lines add to NAME's, in one entry as in the ones above it
      value = inherits ? inheritedProperty(c.doc, [...c.ancestors, h], name) : inheritedProperty(null, [h], name);
    }
  }
  if (value === null || value === undefined) return NIL;
  return !literalNil && value === 'nil' ? NIL : value;
}

/** @param {LObj | undefined} x */
const truthy = (x) => x !== undefined && x !== NIL;

defun('org-entry-get', 2, 4, ([, property, inherit, literalNil]) => entryGet(property, inherit instanceof Sym && inherit.name === 'selective' ? 'selective' : truthy(inherit), truthy(literalNil)));
defun('org-entry-get-with-inheritance', 1, 2, ([property, literalNil]) => entryGet(property, true, truthy(literalNil)));
defun('org-get-heading', 0, 4, ([noTags, noTodo, noPriority, noComment]) => headingText(here(), truthy(noTags), truthy(noTodo), truthy(noPriority), truthy(noComment)));
defun('org-get-todo-state', 0, 0, () => here().heading.todo || NIL);
defun('org-get-tags', 0, 2, ([, local]) => list(tagsOf(here(), truthy(local))));
defun('org-get-category', 0, 2, () => categoryOf(here()));
defun('org-outline-level', 0, 0, () => here().heading.level);
defun('org-entry-is-todo-p', 0, 0, () => {
  const c = here();
  const keywords = c.todoKeywords || ['TODO'];
  const i = c.heading.todo ? keywords.indexOf(c.heading.todo) : -1;
  return i < 0 ? NIL : list(keywords.slice(i));
});
defun('org-entry-is-done-p', 0, 0, () => {
  const c = here();
  const keywords = c.doneKeywords || ['DONE'];
  const i = c.heading.todo ? keywords.indexOf(c.heading.todo) : -1;
  return i < 0 ? NIL : list(keywords.slice(i));
});

