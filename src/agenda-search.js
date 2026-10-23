// @ts-check
// The Agenda's Search view: org-search-view of org-agenda.el. A search string is either one phrase (each space standing for any run of
// whitespace) or, when it starts with + - or {, a Boolean list of words, "quoted phrases" and {regexps}; a leading * searches headlines
// only, then ! limits it to TODO entries, then : makes the words match whole words. An entry is the heading, its planning line, drawers
// and text up to the next heading of any level; entries come back in file order.
import { emacsRegexToJs } from './emacs-regex.js';
import { headingPreambleLines } from './org-parser.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {{ boolean: boolean, headlineOnly: boolean, todoOnly: boolean, positives: RegExp[], negatives: RegExp[] }} SearchPlan */

/** @param {string} text */
const quote = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// org-search-syntax-table makes < > and ' count as word letters, so \< and \> sit outside them too.
const WORD = "[\\p{L}\\p{N}<>']";

/**
 * Splits `words` the way org-search-view does: on whitespace, rejoining a word that ends in a backslash with the next one and a
 * {regexp} that was cut at a space.
 * @param {string} text
 * @returns {string[]}
 */
function splitWords(text) {
  const raw = text.split(/[ \f\t\n\r\v]+/).filter(Boolean);
  /** @type {string[]} */ const joined = [];
  while (raw.length) {
    let w = /** @type {string} */ (raw.shift());
    while (/\\$/.test(w) && raw.length) w = w.slice(0, -1) + ' ' + raw.shift();
    joined.push(w);
  }
  /** @type {string[]} */ const out = [];
  while (joined.length) {
    let w = /** @type {string} */ (joined.shift());
    if (/^[-+]?{/.test(w) && !/}$/.test(w)) {
      while (joined.length && !/}$/.test(joined[0])) w += ' ' + joined.shift();
      w += ' ' + (joined.shift() ?? '');
    }
    out.push(w);
  }
  return out;
}

/**
 * What a search string asks for.
 * @param {string} string
 * @param {{ todoOnly?: boolean, alwaysBoolean?: boolean, forceFullWords?: boolean }} [options]
 * @returns {SearchPlan}  throws EmacsRegexError for a bad {regexp}
 */
export function planSearch(string, options = {}) {
  let todoOnly = !!options.todoOnly;
  let fullWords = !!options.forceFullWords;
  let words = string;
  let headlineOnly = false;
  if (words.startsWith('*')) {
    headlineOnly = true;
    words = words.slice(1);
  }
  if (words.startsWith('!')) {
    todoOnly = true;
    words = words.slice(1);
  }
  if (words.startsWith(':')) {
    fullWords = true;
    words = words.slice(1);
  }
  const boolean = !!options.alwaysBoolean || /^[-+{]/.test(words);
  let list = splitWords(words);
  if (boolean) {
    /** @type {string[]} */ const out = [];
    while (list.length) {
      let w = /** @type {string} */ (list.shift());
      if (w.startsWith('"') || (w.length > 1 && /^[-+]/.test(w) && w[1] === '"')) {
        while (list.length && !w.endsWith('"')) w += ' ' + list.shift();
      }
      w = w.replace(/^([-+]?)"/, '$1');
      if (w.endsWith('"')) w = w.slice(0, -1);
      out.push(w);
    }
    list = out;
  }
  /** @type {RegExp[]} */ const positives = [];
  /** @type {RegExp[]} */ const negatives = [];
  if (boolean) {
    for (let w of list) {
      let negative = false;
      if (w.startsWith('-')) {
        negative = true;
        w = w.slice(1);
      } else if (w.startsWith('+')) w = w.slice(1);
      /** @type {RegExp} */ let re;
      if (/^{.*}$/s.test(w)) re = emacsRegexToJs(w.slice(1, -1), 'i');
      else if (fullWords) re = new RegExp(`(?<!${WORD})${quote(w)}(?!${WORD})`, 'iu');
      else re = new RegExp(quote(w), 'i');
      (negative ? negatives : positives).push(re);
    }
  } else {
    positives.push(new RegExp(list.map(quote).join('\\s+'), 'i'));
  }
  // the longest pattern is the one Emacs scans for; the others are checked on each entry: all of them must match either way
  return { boolean, headlineOnly, todoOnly, positives, negatives };
}

/**
 * The text of one entry as the search reads it: the heading line, planning, drawers and body, not its sub-headings.
 * @param {Heading} heading
 */
export function entrySearchText(heading) {
  return [...headingPreambleLines(heading), ...(heading.bodyLines || [])].join('\n');
}

/**
 * The headings of `docs` that satisfy the plan, in file order.
 * @param {{ documentId: string, doc: Doc }[]} docs
 * @param {SearchPlan} plan
 * @param {{ skip?: (heading: Heading, ancestors: Heading[], doc: Doc) => boolean, isNotDone?: (todo: string) => boolean }} [options]
 * @returns {{ documentId: string, doc: Doc, heading: Heading, ancestors: Heading[] }[]}
 */
export function searchEntries(docs, plan, options = {}) {
  /** @type {{ documentId: string, doc: Doc, heading: Heading, ancestors: Heading[] }[]} */ const found = [];
  for (const { documentId, doc } of docs) {
    /** @param {Heading[]} nodes @param {Heading[]} ancestors @param {boolean} skipped */
    const walk = (nodes, ancestors, skipped) => {
      for (const node of nodes) {
        if (node.type !== 'heading') continue;
        const skipHere = skipped || (options.skip ? options.skip(node, ancestors, doc) : false);
        if (!skipHere && matches(node, plan, options)) found.push({ documentId, doc, heading: node, ancestors });
        walk(node.children || [], [...ancestors, node], skipHere);
      }
    };
    walk(doc.children, [], false);
  }
  return found;
}

/** @param {Heading} heading @param {SearchPlan} plan @param {{ isNotDone?: (todo: string) => boolean }} options */
function matches(heading, plan, options) {
  if (plan.todoOnly && !(heading.todo && (options.isNotDone ? options.isNotDone(heading.todo) : true))) return false;
  const text = plan.headlineOnly ? /** @type {string} */ (headingPreambleLines(heading)[0]) : entrySearchText(heading);
  if (plan.negatives.some((re) => re.test(text))) return false;
  return plan.positives.every((re) => re.test(text));
}
