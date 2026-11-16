// @ts-check
/**
 * The variables that decide how a subtree is archived, as Emacs has them (Org 9.6): `org-archive-reversed-order`, `org-archive-mark-done`,
 * `org-archive-save-context-info`, `org-archive-subtree-add-inherited-tags`, `org-archive-file-header-format`, `org-archive-sibling-heading`,
 * `org-archive-tag`, `org-archive-default-command` and `org-datetree-add-timestamp`. Each is read from the variables as Lisp text; the defaults are Emacs's.
 */
import { parseLispTagList } from './tag-inheritance.js';

/**
 * @typedef {{
 *   reversedOrder: boolean,
 *   markDone: boolean | string,
 *   saveContextInfo: string[],
 *   addInheritedTags: boolean | 'infile',
 *   fileHeaderFormat: string | null,
 *   siblingHeading: string,
 *   archiveTag: string,
 *   datetreeTimestamp: 'active' | 'inactive' | null,
 *   defaultCommand: string,
 * }} ArchiveSettings
 */

export const DEFAULT_CONTEXT_INFO = ['time', 'file', 'olpath', 'category', 'todo', 'itags'];

/** @param {string | undefined} raw @returns {string | null | undefined} the string a Lisp string literal holds; null for nil; undefined when unset or not a string */
function lispString(raw) {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  if (t === 'nil') return null;
  const m = /^"((?:[^"\\]|\\.)*)"$/s.exec(t);
  return m ? m[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\(.)/g, '$1') : undefined;
}

/** @param {Record<string, string> | undefined} vars @returns {ArchiveSettings} */
export function readArchiveSettings(vars = {}) {
  const symbol = (/** @type {string} */ name) => (vars[name] === undefined ? undefined : vars[name].trim().replace(/^'/, ''));
  const markDoneRaw = vars['org-archive-mark-done'];
  const markDoneText = markDoneRaw === undefined ? undefined : lispString(markDoneRaw);
  const context = vars['org-archive-save-context-info'] === undefined ? null : parseLispTagList(vars['org-archive-save-context-info']);
  const inherited = symbol('org-archive-subtree-add-inherited-tags');
  const stamp = symbol('org-datetree-add-timestamp');
  const header = vars['org-archive-file-header-format'] === undefined ? undefined : lispString(vars['org-archive-file-header-format']);
  const sibling = lispString(vars['org-archive-sibling-heading']);
  const tag = lispString(vars['org-archive-tag']);
  return {
    reversedOrder: symbol('org-archive-reversed-order') !== undefined && symbol('org-archive-reversed-order') !== 'nil',
    markDone: typeof markDoneText === 'string' ? markDoneText : markDoneRaw !== undefined && markDoneRaw.trim() !== 'nil',
    saveContextInfo: vars['org-archive-save-context-info'] === undefined ? DEFAULT_CONTEXT_INFO : context ?? [],
    addInheritedTags: inherited === undefined ? 'infile' : inherited === 'nil' ? false : inherited === 'infile' ? 'infile' : true,
    fileHeaderFormat: header === undefined ? '\nArchived entries from file %s\n\n' : header,
    siblingHeading: typeof sibling === 'string' ? sibling : 'Archive',
    archiveTag: typeof tag === 'string' ? tag : 'ARCHIVE',
    defaultCommand: symbol('org-archive-default-command') ?? 'org-archive-subtree',
    datetreeTimestamp: stamp === 'inactive' ? 'inactive' : stamp === undefined || stamp === 'nil' ? null : 'active',
  };
}
