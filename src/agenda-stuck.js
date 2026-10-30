// @ts-check
// Stuck projects (org-agenda-list-stuck-projects, org-stuck-projects; org-agenda.el): the entries a matcher names as projects, except those
// whose subtree holds a next action -- a heading with one of some TODO keywords or tags, or text a regexp finds. Emacs runs a tags view
// with a skip function that passes over every project in which the search finds one of those; the same is done here.
import { datum, listItems, readLisp, stringValue, symbolName } from './lisp-read.js';
import { emacsRegexToJs } from './emacs-regex.js';
import { matchViewItems } from './agenda-queries.js';
import { subtreeLines } from './agenda-skip.js';

/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {{ matcher: string, todo: string[], tags: string[], regexp: string }} StuckSettings */

/** Emacs's default: level-2 headings that are not done, not stuck when they hold TODO, NEXT or NEXTACTION. @type {StuckSettings} */
export const DEFAULT_STUCK = { matcher: '+LEVEL=2/-DONE', todo: ['TODO', 'NEXT', 'NEXTACTION'], tags: [], regexp: '' };

/**
 * `org-stuck-projects` from the variable's text (four items: the matcher, the TODO keywords, the tags and a regexp); the default when unset.
 * @param {string | null | undefined} raw
 * @returns {StuckSettings}
 */
export function readStuckSettings(raw) {
  if (raw === undefined || raw === null || !String(raw).trim()) return DEFAULT_STUCK;
  const form = readLisp(String(raw))[0];
  const parts = form ? listItems(datum(form) || form) : null;
  if (!parts) return DEFAULT_STUCK;
  /** @param {import('./lisp-read.js').Lisp | undefined} x @returns {string[]} */
  const words = (x) => (x ? (listItems(x) || []).map((w) => stringValue(w) ?? symbolName(w) ?? '').filter((w) => w !== '') : []);
  return { matcher: stringValue(parts[0]) ?? '', todo: words(parts[1]), tags: words(parts[2]), regexp: stringValue(parts[3]) ?? '' };
}

/**
 * The projects that are stuck.
 * @param {{ documentId: string, doc: import('./types.js').Doc }[]} docs
 * @param {StuckSettings} settings
 * @param {import('./agenda-queries.js').QueryOptions} [options]
 */
export function stuckProjectItems(docs, settings, options = {}) {
  if (!settings.todo.length && !settings.tags.length && !settings.regexp) throw new Error('Missing information to identify unstuck projects');
  const done = new Set(options.doneKeywords || ['DONE']);
  const all = [...(options.todoKeywords || ['TODO']), ...(options.doneKeywords || ['DONE'])];
  const keywords = settings.todo.includes('*') ? all.filter((k) => !done.has(k)) : settings.todo;
  const escape = (/** @type {string} */ w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const todoRe = settings.todo.length ? new RegExp(`^\\*+[ \\t]+(${keywords.map(escape).join('|')})(?![\\w])`, 'm') : null;
  const tagsRe = !settings.tags.length
    ? null
    : settings.tags.includes('*')
      ? /^\*+ (?:.*[ \t])?(:[\p{L}\p{N}_@#%:]+:)[ \t]*$/mu
      : new RegExp(`^\\*+ .*?[ \\t]:(?:[\\p{L}\\p{N}_@#%]+:)*(${settings.tags.map(escape).join('|')}):(?:[\\p{L}\\p{N}_@#%]+:)*[ \\t]*$`, 'mu');
  const generalRe = settings.regexp ? emacsRegexToJs(settings.regexp, 'm') : null;
  const stuck = (/** @type {string} */ _kind, /** @type {string} */ _documentId, /** @type {Heading} */ heading) => {
    const text = subtreeLines(heading).join('\n');
    return !!((todoRe && todoRe.test(text)) || (tagsRe && tagsRe.test(text)) || (generalRe && generalRe.test(text)));
  };
  return matchViewItems(docs, settings.matcher, { ...options, skipEntry: stuck });
}
