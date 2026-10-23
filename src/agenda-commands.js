// @ts-check
// org-agenda-custom-commands: named queries that open in the Agenda by one key. Read here: `tags` (a Match view), `tags-todo` (a
// Match view of the unfinished TODO entries) and `search` (a Search view), each with the setting org-agenda-sorting-strategy, and
// `agenda` and `alltodo`, which open the built-in views. Other command types are left out of the list.
import { datum, listItems, readLisp, stringValue, symbolName } from './lisp-read.js';
import { matchViewItems, searchViewItems } from './agenda-queries.js';

/** @typedef {import('./lisp-read.js').Lisp} Lisp */
/** @typedef {{ key: string, description: string, type: 'tags' | 'tags-todo' | 'search' | 'agenda' | 'alltodo', query: string, sortingStrategy: string | null }} CustomCommand */

const TYPES = /** @type {const} */ (['tags', 'tags-todo', 'search', 'agenda', 'alltodo']);

/** The text of a Lisp value, for passing a setting on as variable text.
 * @param {Lisp} f @returns {string} */
export function lispText(f) {
  if (f.k === 'str') return JSON.stringify(f.v);
  if (f.k === 'num') return String(f.v);
  if (f.k === 'sym') return f.v;
  return '(' + f.items.map(lispText).join(' ') + (f.tail ? ' . ' + lispText(f.tail) : '') + ')';
}

/**
 * The commands of the variable's text, which may be quoted (`'(...)`). A command of a type that is not read, or without a key, is dropped.
 * @param {string | null | undefined} raw
 * @returns {CustomCommand[]}
 */
export function parseCustomCommands(raw) {
  if (!raw || !String(raw).trim()) return [];
  const form = readLisp(String(raw))[0];
  if (!form) return [];
  const list = listItems(datum(form) || form) || [];
  /** @type {CustomCommand[]} */ const out = [];
  for (const entry of list) {
    const parts = listItems(entry);
    if (!parts || parts.length < 3) continue;
    const key = stringValue(parts[0]);
    const description = stringValue(parts[1]) ?? '';
    const type = symbolName(parts[2]);
    if (!key || !type || !(/** @type {readonly string[]} */ (TYPES).includes(type))) continue;
    const needsQuery = type === 'tags' || type === 'tags-todo' || type === 'search';
    const query = stringValue(parts[3]);
    if (needsQuery && query === null) continue;
    /** @type {string | null} */ let sortingStrategy = null;
    for (const setting of listItems(parts[needsQuery ? 4 : 3]) || []) {
      const pair = listItems(setting);
      if (pair && pair.length === 2 && symbolName(pair[0]) === 'org-agenda-sorting-strategy') {
        const value = datum(pair[1]);
        if (value) sortingStrategy = lispText(value);
      }
    }
    out.push({ key, description, type: /** @type {CustomCommand['type']} */ (type), query: query ?? '', sortingStrategy });
  }
  return out;
}

/** @param {CustomCommand} c */
function commandText(c) {
  const settings = c.sortingStrategy ? ` ((org-agenda-sorting-strategy '${c.sortingStrategy}))` : '';
  const needsQuery = c.type === 'tags' || c.type === 'tags-todo' || c.type === 'search';
  return `(${JSON.stringify(c.key)} ${JSON.stringify(c.description)} ${c.type}${needsQuery ? ' ' + JSON.stringify(c.query) : ''}${settings})`;
}

/**
 * The variable's text with `command` added, or replacing the command that has its key. Commands of types that are not read are kept
 * as they were written.
 * @param {string | null | undefined} raw
 * @param {CustomCommand} command
 * @returns {string}
 */
export function withCustomCommand(raw, command) {
  const form = raw && String(raw).trim() ? readLisp(String(raw))[0] : null;
  const list = (form && listItems(datum(form) || form)) || [];
  /** @type {string[]} */ const texts = [];
  let replaced = false;
  for (const entry of list) {
    const parts = listItems(entry);
    if (parts && stringValue(parts[0]) === command.key) {
      if (!replaced) texts.push(commandText(command));
      replaced = true;
    } else texts.push(lispText(entry));
  }
  if (!replaced) texts.push(commandText(command));
  return `'(${texts.join(' ')})`;
}

/**
 * The rows a `tags`, `tags-todo` or `search` command lists.
 * @param {CustomCommand} command
 * @param {{ documentId: string, doc: import('./types.js').Doc }[]} docs  the agenda files
 * @param {{ documentId: string, doc: import('./types.js').Doc }[]} searchDocs  the agenda files and the extra search files
 * @param {import('./agenda-queries.js').QueryOptions} options
 */
export function commandItems(command, docs, searchDocs, options) {
  const merged = { ...options, sortingStrategy: command.sortingStrategy ?? options.sortingStrategy };
  if (command.type === 'search') return searchViewItems(searchDocs, command.query, merged);
  return matchViewItems(docs, command.query, { ...merged, todoOnly: command.type === 'tags-todo' });
}
