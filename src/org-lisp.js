// @ts-check
/**
 * The Org functions an agenda setting may call (`org-entry-get`, `org-get-heading`, `org-get-tags`, ...), as built-ins of the Lisp
 * interpreter. Emacs runs such a setting with the cursor on a heading; here `withHeading` says which heading that is.
 */
import { Cons, NIL, Sym, intern, list, print, signal, wrongType } from './elisp-data.js';
import { defun } from './elisp-core.js';
import { inheritedProperty } from './babel-args.js';
import { parsePropertyInheritance, parseTagInheritance, propertyInherits, tagInherits } from './tag-inheritance.js';
import { cookieOf, readPriorityRange } from './priorities.js';
import { headingPreambleLines } from './org-parser.js';
import { fileCategory } from './file-category.js';
import { entryBlockedP } from './todo-blocking.js';
import './export-convert.js'; // orgtbl-to-*, org-list-to-*, org-table-to-lisp

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
 * @property {string | null} [file]  the file name FILE answers (none: nil)
 * @property {import('./todo-blocking.js').BlockingContext} [blocking]  what BLOCKED asks org-entry-blocked-p with (none: not blocked)
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
  return fileCategory(c.doc, c.category ?? '???'); // '???' is Emacs's answer for a buffer without a file
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

const SPECIAL_PROPERTIES = ['ALLTAGS', 'BLOCKED', 'CLOCKSUM', 'CLOCKSUM_T', 'CLOSED', 'DEADLINE', 'FILE', 'ITEM', 'PRIORITY', 'SCHEDULED', 'TAGS', 'TIMESTAMP', 'TIMESTAMP_IA', 'TODO'];
const TS_INNER = String.raw`\d{4}-\d\d-\d\d(?: .*?)?`;

/** The timestamps `org-entry-properties` finds in one text: the first active and the first inactive, a range as a whole.
 * @param {string} text @returns {{ active: string | null, inactive: string | null }} */
function firstTimestamps(text) {
  /** @type {{ active: string | null, inactive: string | null }} */
  const found = { active: null, inactive: null };
  const both = new RegExp(`[[<](${TS_INNER})[\\]>]`, 'g');
  let m;
  while ((m = both.exec(text)) && !(found.active && found.inactive)) {
    const whole = /^[[<]/.test(m[0]) && m[0][0] === '<' ? 'active' : 'inactive';
    let raw = m[0];
    const range = new RegExp(`^--?-?[[<]${TS_INNER}[\\]>]`).exec(text.slice(m.index + raw.length));
    if (range) raw += range[0];
    if (found[whole] === null) found[whole] = raw;
  }
  return found;
}

/** The lines of the entry that hold timestamps `org-entry-properties` looks at after the heading line: everything but the planning line and
 * the contents of blocks, comments and keywords. @param {Heading} h */
function sectionTextForTimestamps(h) {
  const lines = [...headingPreambleLines(h).slice(1), ...h.bodyLines];
  let from = 0;
  if (lines.length && /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/.test(lines[0])) from = 1;
  /** @type {string[]} */
  const keep = [];
  let block = null;
  for (const line of lines.slice(from)) {
    if (block) {
      if (new RegExp(`^[ \\t]*#\\+end_${block}\\b`, 'i').test(line)) block = null;
      continue;
    }
    const b = /^[ \t]*#\+begin_(\S+)/i.exec(line);
    if (b && /^(src|example|export|comment)$/i.test(b[1])) {
      block = b[1];
      continue;
    }
    if (/^[ \t]*#(?: |$)/.test(line) || /^[ \t]*#\+/.test(line) || /^[ \t]*CLOCK:/.test(line)) continue;
    keep.push(line);
  }
  return keep.join('\n');
}

/** The property lines of the entry's first property drawer, as `[key, value]`. @param {Heading} h @returns {[string, string | null][]} */
function drawerProperties(h) {
  const lines = headingPreambleLines(h).slice(1);
  let i = lines.findIndex((l, k) => (k === 0 || (k === 1 && /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/.test(lines[0]))) && /^[ \t]*:PROPERTIES:[ \t]*$/i.test(l));
  if (i < 0 && /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/.test(lines[0] || '')) i = lines.findIndex((l, k) => k === 1 && /^[ \t]*:PROPERTIES:[ \t]*$/i.test(l));
  if (i < 0) return [];
  /** @type {[string, string | null][]} */
  const out = [];
  for (let k = i + 1; k < lines.length && !/^[ \t]*:END:[ \t]*$/i.test(lines[k]); k++) {
    const m = /^[ \t]*:(\S+):(?:[ \t]*(\S.*?))?[ \t]*$/.exec(lines[k]);
    if (m) out.push([m[1], m[2] ?? '']);
  }
  return out;
}

/** org-entry-properties. @param {LObj | undefined} which @returns {LObj} */
function entryProperties(which) {
  const c = here();
  const h = c.heading;
  const specific = typeof which === 'string' ? which.toUpperCase() : null;
  const kind = specific === null ? (which === NIL ? null : which instanceof Sym ? which.name : 'other') : SPECIAL_PROPERTIES.includes(specific) ? 'special' : 'standard';
  /** @type {[string, string | null][]} */
  let props = []; // the front of the list first, as Emacs's `push` builds it
  const push = (/** @type {string} */ key, /** @type {string | null} */ value) => props.unshift([key, value]);
  const result = () => list(props.map(([k, v]) => new Cons(k, v === null ? NIL : v)));
  const wants = (/** @type {string} */ name) => specific === null || specific === name;
  if (kind === null || kind === 'all' || kind === 'special') {
    if (wants('ITEM')) push('ITEM', headingText(c, true, true, true, false).replace(/^\s+$/, ''));
    if (specific === 'ITEM') return result();
    if (wants('TODO') && h.todo) push('TODO', h.todo);
    if (specific === 'TODO') return result();
    if (wants('PRIORITY')) push('PRIORITY', h.priority || cookieOf(readPriorityRange({}).default));
    if (specific === 'PRIORITY') return result();
    if (wants('FILE')) push('FILE', c.file ?? null);
    if (specific === 'FILE') return result();
    if (wants('TAGS') && h.tags && h.tags.length) push('TAGS', `:${h.tags.join(':')}:`);
    if (specific === 'TAGS') return result();
    if (wants('ALLTAGS')) {
      const all = tagsOf(c, false);
      if (all.length) push('ALLTAGS', `:${all.join(':')}:`);
    }
    if (specific === 'ALLTAGS') return result();
    if (wants('BLOCKED')) push('BLOCKED', c.blocking && entryBlockedP(c.doc, h, c.blocking) ? 't' : '');
    if (specific === 'BLOCKED') return result();
    if (specific === null || specific === 'CLOSED' || specific === 'DEADLINE' || specific === 'SCHEDULED') {
      const planning = headingPreambleLines(h)[1];
      if (planning !== undefined && /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/.test(planning)) {
        for (const [key, value] of /** @type {[string, string | null | undefined][]} */ ([['CLOSED', h.planning.closed], ['DEADLINE', h.planning.deadline], ['SCHEDULED', h.planning.scheduled]])) {
          if ((specific === null || specific === key) && value) push(key, value);
        }
      }
    }
    if (specific === 'CLOSED' || specific === 'DEADLINE' || specific === 'SCHEDULED') return result();
    if (specific === null || specific === 'TIMESTAMP' || specific === 'TIMESTAMP_IA') {
      const head = firstTimestamps(h.title);
      const body = firstTimestamps(sectionTextForTimestamps(h));
      const active = head.active ?? body.active;
      const inactive = head.inactive ?? body.inactive;
      /** @type {[string, string][]} */
      const ts = [];
      if (specific !== 'TIMESTAMP_IA' && active) ts.push(['TIMESTAMP', active]);
      if (specific !== 'TIMESTAMP' && inactive) ts.push(['TIMESTAMP_IA', inactive]);
      if (specific !== null && ts.length) {
        props = ts.map(([k, v]) => /** @type {[string, string | null]} */ ([k, v]));
        return result();
      }
      if (specific !== null) return list([new Cons('CATEGORY', categoryOf(c))]); // nothing found: only the category is left
      // found in the order of the text, each pushed in front of the others
      const order = ts.map(([k, v]) => ({ k, v, at: k === 'TIMESTAMP' ? textPosition(h, active) : textPosition(h, inactive) })).sort((a, b) => a.at - b.at);
      props = [...order.map((x) => /** @type {[string, string | null]} */ ([x.k, x.v])).reverse(), ...props];
    }
  }
  if (kind === null || kind === 'all' || kind === 'standard') {
    if (specific !== null && specific !== 'CATEGORY') {
      const value = entryGet(specific, false, true);
      return value === NIL ? NIL : list([new Cons(specific, value)]);
    }
    /** @type {string[]} */
    const seenBase = [];
    for (const [key0, value] of drawerProperties(h)) {
      const key = key0.toUpperCase();
      const extend = key.endsWith('+');
      const base = extend ? key.slice(0, -1) : key;
      if (SPECIAL_PROPERTIES.includes(base)) continue;
      const old = props.find(([k]) => k.toUpperCase() === base);
      if (extend) {
        if (old) old[1] = (old[1] ?? '') + ' ' + (value ?? '');
        else push(base, value);
      } else if (!seenBase.includes(key)) {
        seenBase.push(key);
        const p = props.find(([k]) => k.toUpperCase() === key);
        if (p) p[1] = (value ?? '') + ' ' + (p[1] ?? '');
        else push(key, value);
      }
    }
  }
  if (!props.some(([k]) => k === 'CATEGORY')) push('CATEGORY', categoryOf(c));
  return result();
}

/** Where `raw` first occurs in the entry's text (to order what was found), the heading line counting first. @param {Heading} h @param {string | null} raw */
function textPosition(h, raw) {
  if (!raw) return Infinity;
  const text = [h.title, sectionTextForTimestamps(h)].join('\n');
  const at = text.indexOf(raw);
  return at < 0 ? Infinity : at;
}

/** @param {LObj | undefined} x */
const optional = (x) => (x === undefined ? NIL : x);

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

defun('org-entry-properties', 0, 2, ([, which]) => entryProperties(optional(which)));
