// @ts-check
// C-c / (org-sparse-tree): the menu, and the sparse trees it makes (org-occur and the checks built on it).
import { readDate, readDateSettings } from '../src/read-date.js';
import { headingLineIndex, serializeOrg } from '../src/org-parser.js';
import { getPropertyInheritance, getUseTagInheritance } from '../src/local-variables.js';
import { searchDocumentsByMatchQuery } from '../src/search.js';
import { dateQuery, deadlineQuery, occur, regexpQuery, stampTime, todoQuery } from '../src/sparse-tree.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';
import { S } from './app-state.js';
import { setStatus } from './editing.js';
import { narrowToSparseMatches } from './gestures-structure.js';
import { readFromMinibuffer, readKeyFromMinibuffer } from './minibuffer-prompt.js';
import { clearOccurHighlights } from './occur-highlights.js';
import { render } from './render.js';

/** @typedef {import('../src/types.js').Heading} Heading */

/** `org-ts-type`, which C-c / c cycles. */
const DATE_TYPES = ['', 'all', 'scheduled', 'deadline', 'active', 'inactive', 'closed'];
const DATE_TYPE_NAMES = new Map([
  ['all', 'all timestamps'],
  ['scheduled', 'only scheduled'],
  ['deadline', 'only deadline'],
  ['active', 'only active timestamps'],
  ['inactive', 'only inactive timestamps'],
  ['closed', 'with a closed time-stamp'],
]);
const MEMORY = { type: '', loaded: false };

const MENU = 'Sparse tree: [r]egexp [t]odo [T]odo-kwd [m]atch [p]roperty [d]eadlines [b]efore-date [a]fter-date [D]ates range [c]ycle through date types: ';

/** Reads the answer to a prompt; null when it is cancelled. @param {string} prompt @param {string[]} [choices] */
async function ask(prompt, choices) {
  S.godModeActive = false; // the minibuffer is about to ask a question
  return readFromMinibuffer(prompt, '', choices);
}

/** The date `org-read-date` answers, as YYYY-MM-DD. @param {string} prompt @returns {Promise<string | null>} */
async function askDate(prompt) {
  const settings = readDateSettings(S.state.localVariables);
  const now = new Date();
  const day = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const answer = await ask(`${prompt}Date+time [${day(now)}]: `);
  if (answer === null) return null;
  return day(readDate(answer, { now, preferFuture: settings.preferFuture, extendTodayUntil: settings.extendTodayUntil }).date);
}

/**
 * Makes the tree of the headings that hold matches, and tells how many there were, as Emacs does.
 * @param {import('../src/sparse-tree.js').OccurQuery} query
 * @returns {number}
 */
function occurTree(query) {
  const doc = S.state.doc;
  const lines = serializeOrg(doc).split('\n');
  const index = [...headingLineIndex(doc).lines].sort((a, b) => a[1].line - b[1].line);
  const found = occur(lines, query.regexp, query);
  clearOccurHighlights();
  const text = lines.join('\n');
  S.occurHighlights = [...new Set(found.map((f) => text.slice(f.start, f.end)).filter(Boolean))];
  narrowToSparseMatches(new Set(found.map((f) => headingAtLine(index, f.line)).filter((h) => h !== null)));
  render();
  return found.length;
}

/** @param {[Heading, { line: number }][]} index @param {number} line @returns {Heading | null} */
function headingAtLine(index, line) {
  let found = null;
  for (const [heading, at] of index) {
    if (at.line > line) break;
    found = heading;
  }
  return found;
}

const isDone = (/** @type {Heading | null} */ heading) => Boolean(heading && heading.todo && resolveTodoSequence(S.state.doc).doneKeywords.includes(heading.todo));

/** C-c / r: `org-occur`. */
async function regexpTree() {
  const regexp = await ask('Regexp: ');
  if (regexp === null) return setStatus('Quit');
  if (regexp === '') return setStatus('Regexp cannot be empty');
  setStatus(`${occurTree(regexpQuery(regexp, S.state.localVariables['org-occur-case-fold-search']))} match(es) for regexp ${regexp}`);
}

/** C-c / t and T: `org-show-todo-tree`. @param {boolean} byKeyword */
async function todoTree(byKeyword) {
  const sequence = resolveTodoSequence(S.state.doc);
  let chosen = null;
  if (byKeyword) {
    chosen = await ask('Keyword (or KWD1|KWD2|...): ', sequence.todoKeywords);
    if (chosen === null) return setStatus('Quit');
  }
  setStatus(`${occurTree(todoQuery(sequence.todoKeywords, chosen))} TODO entries found`);
}

/** C-c / m and p: `org-match-sparse-tree`. @param {string | null} match @param {boolean} todoOnly */
async function matchTree(match, todoOnly) {
  const query = match ?? (await ask('Match: '));
  if (query === null) return setStatus('Quit');
  const doc = S.state.doc;
  const results = searchDocumentsByMatchQuery([{ documentId: S.state.documentId || '', doc }], query, {
    useTagInheritance: getUseTagInheritance(S.state.localVariables),
    usePropertyInheritance: getPropertyInheritance(S.state.localVariables),
    doneKeywords: resolveTodoSequence(doc).doneKeywords,
  });
  const headings = results.map((r) => /** @type {Heading} */ (r.heading)).filter((h) => !todoOnly || (h.todo && !isDone(h)));
  clearOccurHighlights();
  narrowToSparseMatches(new Set(headings));
  render();
  if (!headings.length) setStatus('No matching entries');
}

/** C-c / p: a property and its value. */
async function propertyTree() {
  const keys = new Set();
  const values = new Map();
  /** @param {Heading[]} list */
  const walk = (list) => {
    for (const h of list) {
      for (const [key, value] of Object.entries(h.properties || {})) {
        keys.add(key);
        values.set(key, [...new Set([...(values.get(key) || []), value])]);
      }
      walk(h.children);
    }
  };
  walk(S.state.doc.children);
  const kwd = await ask('Property: ', [...keys]);
  if (kwd === null) return setStatus('Quit');
  const value = await ask('Value: ', values.get(kwd) || []);
  if (value === null) return setStatus('Quit');
  await matchTree(`${kwd}=${/^\{.*\}$/.test(value) ? value : `"${value}"`}`, false);
}

/** C-c / d: `org-check-deadlines`. @param {boolean} all */
async function deadlinesTree(all) {
  const configured = Number.parseInt(S.state.localVariables['org-deadline-warning-days'] ?? '14', 10);
  const warn = all ? 100000 : Math.abs(Number.isFinite(configured) ? configured : 14);
  const doc = S.state.doc;
  const index = [...headingLineIndex(doc).lines].sort((a, b) => a[1].line - b[1].line);
  const count = occurTree(deadlineQuery(warn, new Date(), (line) => isDone(headingAtLine(index, line))));
  setStatus(`${count} deadlines past-due or due within ${warn} days`);
}

/** C-c / b, a and D: the entries before, after or between dates. @param {'before' | 'after' | 'between'} kind */
async function datesTree(kind) {
  const first = await askDate(kind === 'between' ? 'Range starts ' : '');
  if (first === null) return setStatus('Quit');
  const second = kind === 'between' ? await askDate('Range end ') : first;
  if (second === null) return setStatus('Quit');
  const count = occurTree(dateQuery(kind, MEMORY.type, stampTime(first), stampTime(second)));
  setStatus(kind === 'before' ? `${count} entries before ${first}` : kind === 'after' ? `${count} entries after ${first}` : `${count} entries between ${first} and ${second}`);
}

/**
 * C-c / (`org-sparse-tree`): asks which sparse tree to make, then makes it. C-u asks for the keyword (t), keeps only TODO entries (m) or
 * takes every deadline (d).
 * @param {number} [prefix] 1 or 4
 */
export async function sparseTreeCommand(prefix = 1) {
  if (!S.state.doc) return;
  if (!MEMORY.loaded) {
    MEMORY.loaded = true;
    MEMORY.type = (S.state.localVariables['org-sparse-tree-default-date-type'] ?? 'nil').trim().replace(/^'/, '').replace(/^nil$/, '');
  }
  const named = DATE_TYPE_NAMES.get(MEMORY.type) ?? 'scheduled/deadline';
  S.godModeActive = false; // the minibuffer is about to ask a question
  const key = await readKeyFromMinibuffer(`${MENU}${named}`, 'rtTmpdbaDcRPR/');
  if (key === 'q') return setStatus('Quit');
  switch (key) {
    case 'c':
      MEMORY.type = DATE_TYPES[DATE_TYPES.indexOf(MEMORY.type) + 1] ?? '';
      return sparseTreeCommand(prefix);
    case 'd':
      return deadlinesTree(prefix === 4);
    case 'b':
      return datesTree('before');
    case 'a':
      return datesTree('after');
    case 'D':
      return datesTree('between');
    case 't':
      return todoTree(prefix === 4);
    case 'T':
      return todoTree(true);
    case 'm':
      return matchTree(null, prefix === 4);
    case 'p':
    case 'P':
      return propertyTree();
    case 'r':
    case 'R':
    case '/':
      return regexpTree();
    default:
      return setStatus(`No such sparse tree command "${key}"`);
  }
}
