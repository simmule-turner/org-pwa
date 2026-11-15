// @ts-check
/**
 * org-sort-entries: sorts the children of a heading (or the top-level entries of the file) by a type letter, as Org's `C-c ^` does on a
 * heading: a/A alphabetically (case ignored unless `withCase`), n/N numerically, t/T by the first timestamp, p/P by priority, o/O by TODO
 * keyword order, s/S by SCHEDULED, d/D by DEADLINE, c/C by creation (the first inactive timestamp at the start of a line), r/R by a
 * property, f/F by a function. A capital letter reverses the order. Keys are compared by character code (the C locale).
 */
import { parseInline } from './inline-markup.js';
import { resolveTodoSequences } from './todo-cycle.js';
import { callFunction } from './agenda-lisp.js';
import { sortFunctions } from './table-sort-lisp.js';

/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./elisp-data.js').LObj} LObj */

/** What `string-to-number` makes of the start of a string (0 when it has no number). @param {string} s */
export function stringToNumber(s) {
  const m = /^[ \t]*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(s);
  return m ? Number(m[1]) : 0;
}

/** @typedef {{ type: string, value?: string, raw?: string, target?: string, description?: string | null, children?: Piece[] }} Piece */

/** @param {Piece[]} nodes @returns {string} */
function plain(nodes) {
  return nodes
    .map((n) => {
      if (n.type === 'text' || n.type === 'code' || n.type === 'verbatim') return n.value ?? '';
      if (n.type === 'link') return n.description ?? n.target ?? '';
      if (n.children) return plain(n.children);
      return n.raw ?? n.value ?? '';
    })
    .join('');
}

/** org-sort-remove-invisible of the heading text: the markup of emphasis and links is left out. @param {string} text */
function withoutMarkup(text) {
  return plain(parseInline(text));
}

/** The title as `(org-get-heading t t t t)` gives it. @param {Heading} h */
const titleOf = (h) => String(h.title || '').replace(/^COMMENT(?:[ \t]+|$)/, '');

/** Seconds of an Org time string (`org-time-string-to-seconds`), in local time. @param {string} ts */
function seconds(ts) {
  const m = /(\d{4})-(\d\d)-(\d\d)(?: +[^\]\r\n>\d -]+)?(?: +(\d{1,2}):(\d\d))?/.exec(ts);
  if (!m) return 0;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)).getTime() / 1000;
}

/** @param {Heading} h */
function entryText(h) {
  const planning = [h.planning.scheduled && `SCHEDULED: ${h.planning.scheduled}`, h.planning.deadline && `DEADLINE: ${h.planning.deadline}`, h.planning.closed && `CLOSED: ${h.planning.closed}`].filter(Boolean);
  const stars = `${'*'.repeat(h.level)} ${h.todo ? h.todo + ' ' : ''}${h.priority ? `[#${h.priority}] ` : ''}${h.title}`;
  const drawers = (h.propertyOrder || []).map((k) => `:${k}: ${h.properties[k]}`);
  return [stars, ...planning, ...drawers, ...(h.preLogLines || []), ...(h.logbookLines || []), ...h.bodyLines].join('\n');
}

const TS_ACTIVE = /<(\d{4}-\d\d-\d\d(?: [^\n]*?)?)>/;
const TS_BOTH = /[[<](\d{4}-\d\d-\d\d(?: [^\n]*?)?)[\]>]/;
const SCHEDULED = /\bSCHEDULED: *<([^>]+)>/;
const DEADLINE = /\bDEADLINE: *<([^>]+)>/;
const CREATED = /^[ \t]*\[(\d{4}-\d\d-\d\d(?: *[^\]+0-9>\r\n -]+)?(?: \d{1,2}:\d\d)?)[^\]\n]*\]/m;

/**
 * @typedef {object} SortOptions
 * @property {boolean} [withCase]  sort case-sensitively
 * @property {string} [property]  the property for r/R
 * @property {LObj} [keyFn]  the key function for f/F, called with no arguments on the entry
 * @property {LObj | null} [compareFn]  the function that compares two keys for f/F (null: numbers by `<`, strings by `string<`)
 * @property {number} [now]  seconds since the epoch, the key of an entry without the timestamp
 * @property {number} [priorityDefault]  org-priority-default as a character code (66)
 * @property {(heading: Heading, name: string) => string | null} [propertyOf]  org-entry-get, for r/R
 * @property {{ todo: string[], done: string[] }[]} [sequences]
 */

/**
 * Sorts the children of `parent` (the top-level entries of `doc` when `parent` is null) by `type`. Throws what Emacs's user-error says
 * when there is nothing to sort or the children start deeper than a later one.
 * @param {Doc} doc @param {Heading | null} parent @param {string} type @param {SortOptions} [opts]
 * @returns {void}
 */
export function sortEntries(doc, parent, type, opts = {}) {
  const container = parent ? parent.children : doc.children;
  if (container.length === 0) throw new Error('Nothing to sort');
  const first = container[0].level;
  /** @param {Heading[]} nodes @returns {boolean} */
  const hasShallower = (nodes) => nodes.some((n) => n.level === first - 1 || hasShallower(n.children));
  if (first > 1 && hasShallower(container)) throw new Error('Region to sort contains a level above the first entry');
  const kind = type.toLowerCase();
  if (!'nat opdsrcf'.includes(kind) || kind === ' ' || type.length !== 1) throw new Error(`Invalid sorting type \`${type}'`);
  const reverse = type !== kind;
  const withCase = !!opts.withCase;
  const caseFunc = (/** @type {string} */ s) => (withCase ? s : s.toLowerCase());
  const sequences = (opts.sequences || resolveTodoSequences(doc).map((s) => ({ todo: s.todoKeywords, done: s.doneKeywords })));
  const allKeywords = sequences.flatMap((s) => [...s.todo, ...s.done]);
  const doneKeywords = sequences.flatMap((s) => s.done);
  const now = opts.now ?? Date.now() / 1000;
  const priorityDefault = opts.priorityDefault ?? 66;
  const fns = kind === 'f' ? sortFunctions(/** @type {LObj} */ (opts.keyFn), opts.compareFn ?? null) : null;

  /** @param {Heading} h @returns {LObj | number | string} */
  const keyOf = (h) => {
    switch (kind) {
      case 'n': return stringToNumber(withoutMarkup(titleOf(h)));
      case 'a': return caseFunc(withoutMarkup(titleOf(h)));
      case 't': {
        const text = entryText(h);
        const m = TS_ACTIVE.exec(text) || TS_BOTH.exec(text);
        return m ? seconds(m[1]) : now;
      }
      case 'c': {
        const m = CREATED.exec(entryText(h).split('\n').slice(1).join('\n'));
        return m ? seconds(m[1]) : now;
      }
      case 's': {
        const m = SCHEDULED.exec(entryText(h));
        return m ? seconds(m[1]) : now;
      }
      case 'd': {
        const m = DEADLINE.exec(entryText(h));
        return m ? seconds(m[1]) : now;
      }
      case 'p': return h.priority ? h.priority.charCodeAt(0) : priorityDefault;
      case 'r': return (opts.propertyOf ? opts.propertyOf(h, opts.property || '') : null) ?? '';
      case 'o': {
        const i = h.todo ? allKeywords.indexOf(h.todo) : -1;
        const length = i < 0 ? 0 : allKeywords.length - i;
        return 99 - (h.todo && doneKeywords.includes(h.todo) ? -length : length);
      }
      default: {
        const r = callFunction(/** @type {LObj} */ (opts.keyFn), [], { doc, heading: h });
        if (!r.ok) throw new Error(r.message);
        const v = r.value;
        return typeof v === 'string' ? caseFunc(v) : v;
      }
    }
  };
  /** @param {unknown} a @param {unknown} b */
  const less = (a, b) => {
    if (fns) return fns.less(/** @type {LObj} */ (a), /** @type {LObj} */ (b));
    if (typeof a === 'number' && typeof b === 'number') return a < b;
    return cmpCodes(String(a), String(b)) < 0;
  };

  // the end of the file: a last line without a line break gets one
  /** @param {Heading} h @returns {Heading} */
  const lastOf = (h) => (h.children.length ? lastOf(h.children[h.children.length - 1]) : h);
  /** @param {Heading[]} nodes */
  const lastInFile = (nodes) => lastOf(nodes[nodes.length - 1]);
  const regionEnd = lastInFile(container);
  const touchesEnd = lastOf(doc.children[doc.children.length - 1]) === regionEnd;
  const tail = regionEnd.bodyLines;
  if (touchesEnd && tail.length > 0 && tail[tail.length - 1] === '') tail.pop(); // put back below
  // the region ends after one empty line at most (org-back-over-empty-lines); the others stay below it
  /** @type {string[]} */ const outside = [];
  if (parent) {
    let blanks = 0;
    while (blanks < tail.length && /^[ \t]*$/.test(tail[tail.length - 1 - blanks])) blanks++;
    if (blanks > 1) outside.push(...tail.splice(tail.length - (blanks - 1), blanks - 1));
  }
  const keyed = container.map((h) => ({ h, key: keyOf(h) }));
  const ordered = reverse ? stableSort([...keyed].reverse(), less).reverse() : stableSort(keyed, less);
  container.splice(0, container.length, ...ordered.map((/** @type {{ h: Heading }} */ x) => x.h));
  const newEnd = lastInFile(container);
  if (outside.length) newEnd.bodyLines.push(...outside);
  if (touchesEnd) lastOf(doc.children[doc.children.length - 1]).bodyLines.push(''); // the file ends with a line break now
}

/** @param {string} a @param {string} b */
function cmpCodes(a, b) {
  const p = Array.from(a);
  const q = Array.from(b);
  for (let i = 0; i < Math.min(p.length, q.length); i++) {
    const d = /** @type {number} */ (p[i].codePointAt(0)) - /** @type {number} */ (q[i].codePointAt(0));
    if (d) return d;
  }
  return p.length - q.length;
}

/** @template T @param {{ h: Heading, key: T }[]} items @param {(a: unknown, b: unknown) => boolean} less @returns {{ h: Heading, key: T }[]} */
function stableSort(items, less) {
  // a merge sort, as Emacs's `sort' on a list is; `less' only says whether the first goes before the second
  if (items.length <= 1) return items;
  const mid = items.length >> 1;
  const l = stableSort(items.slice(0, mid), less);
  const r = stableSort(items.slice(mid), less);
  /** @type {typeof items} */ const out = [];
  let i = 0;
  let j = 0;
  while (i < l.length && j < r.length) out.push(less(r[j].key, l[i].key) ? r[j++] : l[i++]);
  return out.concat(l.slice(i), r.slice(j));
}
