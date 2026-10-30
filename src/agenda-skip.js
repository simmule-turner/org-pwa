// @ts-check
// `org-agenda-skip-function` and `org-agenda-skip-function-global` (org-agenda-skip, org-agenda.el): a function called with the cursor on an
// entry that the agenda is about to list; a non-nil value skips the entry, and a number says up to where (the end of the entry, or of its
// subtree) the search goes on from. The helpers Emacs ships for it, `org-agenda-skip-entry-if`, `org-agenda-skip-subtree-if` and
// `org-agenda-skip-if`, are built in. The numbers they give are positions in the order of the file's headings: the entry's own number plus
// one for its end, plus the size of its subtree for the end of the subtree.
import { NIL, Cons, Sym, signal, toArray } from './elisp-data.js';
import { defun } from './elisp-core.js';
import { currentHeading } from './org-lisp.js';
import { callSkipSetting, skipSetting } from './agenda-lisp.js';
import { emacsRegexToJs } from './emacs-regex.js';
import { entryLines } from './agenda-log.js';

/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./elisp-data.js').LObj} LObj */

/** The headings of a document in file order. @param {Doc} doc @returns {Heading[]} */
function preorder(doc) {
  /** @type {Heading[]} */ const out = [];
  /** @param {Heading[]} nodes */
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n.type !== 'heading') continue;
      out.push(n);
      walk(n.children);
    }
  };
  walk(doc.children);
  return out;
}

/** The lines of a heading's subtree (its own entry, then its children's). @param {Heading} heading @returns {string[]} */
export function subtreeLines(heading) {
  const lines = entryLines(heading);
  for (const child of heading.children || []) if (child.type === 'heading') lines.push(...subtreeLines(child));
  return lines;
}

/** How many headings a subtree holds, itself included. @param {Heading} heading @returns {number} */
function subtreeSize(heading) {
  let n = 1;
  for (const child of heading.children || []) if (child.type === 'heading') n += subtreeSize(child);
  return n;
}

/** @param {LObj} x @returns {string | null} */
const symbolName = (x) => (x instanceof Sym ? x.name : null);

const TS = /<\d{4}-\d{2}-\d{2} ?[^\r\n>]*?>/;
const SCHEDULED = /\bSCHEDULED: *<[^>]+>/;
const DEADLINE = /\bDEADLINE: *<[^>]+>/;

/** The position (in headings) the helpers return for an entry or its subtree, found from the heading under the cursor. @param {boolean} subtree */
function endPosition(subtree) {
  const c = currentHeading();
  const all = preorder(c.doc);
  const at = all.indexOf(c.heading);
  return at + (subtree ? subtreeSize(c.heading) : 1);
}

/**
 * org-agenda-skip-if: the end position when any condition holds, else nil.
 * @param {boolean} subtree @param {LObj[]} conditions
 * @returns {LObj}
 */
function skipIf(subtree, conditions) {
  const c = currentHeading();
  // the entry is the text up to the next heading, the subtree the text up to the end of the last descendant; the scheduled and deadline
  // conditions look only at the heading line and the line after it (for an entry), the planning line
  const lines = subtree ? subtreeLines(c.heading) : entryLines(c.heading);
  const text = lines.join('\n');
  const planning = (subtree ? lines : lines.slice(0, 2)).join('\n');
  const names = conditions.map(symbolName);
  const after = (/** @type {string} */ n) => {
    const i = names.indexOf(n);
    return i < 0 ? null : conditions.slice(i);
  };
  /** @param {RegExp} re @param {string} within */
  const found = (re, within) => re.test(within);
  let hit = false;
  if (names.includes('scheduled') && found(SCHEDULED, planning)) hit = true;
  else if (names.includes('notscheduled') && !found(SCHEDULED, planning)) hit = true;
  else if (names.includes('deadline') && found(DEADLINE, planning)) hit = true;
  else if (names.includes('notdeadline') && !found(DEADLINE, planning)) hit = true;
  else if (names.includes('timestamp') && found(TS, text)) hit = true;
  else if (names.includes('nottimestamp') && !found(TS, text)) hit = true;
  else {
    const re = after('regexp');
    const nre = after('notregexp');
    if (re && typeof re[1] === 'string' && emacsRegexToJs(re[1], 'm').test(text)) hit = true;
    else if (nre && typeof nre[1] === 'string' && !emacsRegexToJs(nre[1], 'm').test(text)) hit = true;
    else {
      const m = after('nottodo') || after('todo-unblocked') || after('nottodo-unblocked') || after('todo');
      if (m) hit = skipIfTodo(m, text, c);
    }
  }
  return hit ? endPosition(subtree) : NIL;
}

/**
 * org-agenda-skip-if-todo. The class or keyword list is read as Emacs reads it: a tail of exactly two elements is (type spec); any more
 * conditions after it leave the keyword list empty, which matches no keyword.
 * @param {LObj[]} args @param {string} text @param {import('./org-lisp.js').HeadingContext} c
 */
function skipIfTodo(args, text, c) {
  const type = symbolName(args[0]);
  const todoKeywords = c.todoKeywords || ['TODO'];
  const doneKeywords = c.doneKeywords || ['DONE'];
  const all = [...todoKeywords, ...doneKeywords];
  /** @type {string[]} */ let words = [];
  if (args.length === 2) {
    const spec = args[1];
    const name = symbolName(spec);
    if (name === 'todo') words = todoKeywords;
    else if (name === 'done') words = doneKeywords;
    else if (name === 'any') words = all;
    else if (!(spec instanceof Cons) && spec !== NIL) throw signal('error', [`Invalid TODO class or type: ${name ?? spec}`]);
    else {
      const list = toArray(spec).filter((x) => typeof x === 'string');
      words = list.includes('*') ? all : list;
    }
  }
  const re = words.length ? new RegExp(`^\\*+[ \\t]+(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w])`, 'm') : null;
  const found = !!re && re.test(text);
  if (type === 'todo') return found;
  if (type === 'nottodo') return !found;
  if (type === 'todo-unblocked') return found; // nothing blocks an entry here
  if (type === 'nottodo-unblocked') return !found;
  throw signal('error', [`Unknown TODO skip type: ${type}`]);
}

defun('org-agenda-skip-entry-if', 0, -1, (conditions) => skipIf(false, conditions));
defun('org-agenda-skip-subtree-if', 0, -1, (conditions) => skipIf(true, conditions));
defun('org-agenda-skip-if', 2, 2, ([subtree, conditions]) => skipIf(subtree !== NIL, toArray(conditions)));

/**
 * The skip check of the agenda settings: `test(kind, documentId, heading)` says whether the entry is skipped when the agenda scans for
 * `kind` (the scans of Emacs go through the file one after the other, so what a function skips is kept for each kind). null when no
 * function is set.
 * @param {Record<string, string> | undefined} vars
 * @param {{ documentId: string, doc: Doc }[]} docs
 * @param {{ todoKeywords?: string[], doneKeywords?: string[] }} [keywords]
 * @returns {((kind: string, documentId: string, heading: Heading) => boolean) | null}
 */
export function agendaSkipper(vars, docs, keywords = {}) {
  const fns = ['org-agenda-skip-function-global', 'org-agenda-skip-function'].map((n) => skipSetting(n, vars?.[n])).filter((f) => f !== null);
  if (!fns.length) return null;
  const docOf = new Map(docs.map((d) => [d.documentId, d.doc]));
  /** @type {Map<Doc, Map<Heading, number>>} */ const order = new Map();
  /** @type {Map<string, { until: number, memo: Map<Heading, boolean> }>} */ const states = new Map();
  return (kind, documentId, heading) => {
    const doc = docOf.get(documentId);
    if (!doc) return false;
    let positions = order.get(doc);
    if (!positions) {
      positions = new Map(preorder(doc).map((h, i) => [h, i]));
      order.set(doc, positions);
    }
    const key = `${kind}\u0000${documentId}`;
    let state = states.get(key);
    if (!state) {
      state = { until: -1, memo: new Map() };
      states.set(key, state);
    }
    const known = state.memo.get(heading);
    if (known !== undefined) return known;
    const at = positions.get(heading) ?? 0;
    if (at < state.until) {
      state.memo.set(heading, true);
      return true;
    }
    /** @type {LObj} */ let to = NIL;
    for (const fn of fns) {
      const r = callSkipSetting(fn, { doc, heading, ...keywords });
      if (r.ok && r.value !== NIL) {
        to = r.value;
        break;
      }
    }
    const skipped = to !== NIL;
    // the scans that map over the element cache (deadlines, scheduled, tags) only skip the entry the function was called on; the others
    // go on from the position it returns
    if (skipped && !['tags'].includes(kind)) state.until = typeof to === 'number' ? Math.max(to, at + 1) : at + 1;
    state.memo.set(heading, skipped);
    return skipped;
  };
}
