// @ts-check
// org-tag-alist and org-tag-persistent-alist: the tags a person lists once for every file. Each entry is a name ("home"), a name with its
// fast-selection key (("work" . ?w)), or a syntax word such as :startgroup, (:startgroup) or :newline, which names no tag.
import { readLisp } from './lisp-read.js';

/** @typedef {import('./lisp-read.js').Lisp} Lisp */

/** The tag names the text of a tag alist lists, in order, once each. @param {string | undefined | null} text @returns {string[]} */
export function tagsOfTagAlist(text) {
  const [form] = readLisp(String(text || ''));
  if (!form || form.k !== 'list') return [];
  /** @type {Lisp[]} */
  let entries = form.items;
  if (entries[0] && entries[0].k === 'sym' && entries[0].v === 'quote' && entries[1] && entries[1].k === 'list') entries = entries[1].items;
  /** @type {string[]} */
  const names = [];
  for (const entry of entries) {
    const first = entry.k === 'list' ? entry.items[0] : entry;
    if (first && first.k === 'str' && first.v && !names.includes(first.v)) names.push(first.v);
  }
  return names;
}
