// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
// Which of a heading's ancestors' tags it inherits: org-use-tag-inheritance (t, nil, a list of tags, or a regexp) and
// org-tags-exclude-from-inheritance (a list of tags that never inherit).

/** `true` / `false` for t / nil with nothing excluded; otherwise a policy object.
 * @typedef {boolean | { only: Set<string> | RegExp | null, exclude: Set<string> }} TagInheritance */

/** The words of a Lisp list of tags: `("a" "b")`, `'("a" "b")` or `(a b)`. Null when the text is not a list.
 * @param {string} text
 * @returns {string[] | null} */
export function parseLispTagList(text) {
  const t = text.trim().replace(/^'/, '');
  if (!t.startsWith('(') || !t.endsWith(')')) return null;
  const inner = t.slice(1, -1);
  const words = [];
  const re = /"((?:[^"\\]|\\.)*)"|([^\s"()]+)/g;
  let m;
  while ((m = re.exec(inner))) words.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]);
  return words;
}

/**
 * @param {string | null | undefined} inheritanceRaw  the value of org-use-tag-inheritance
 * @param {string | null | undefined} excludeRaw  the value of org-tags-exclude-from-inheritance
 * @returns {TagInheritance}
 */
export function parseTagInheritance(inheritanceRaw, excludeRaw) {
  const raw = inheritanceRaw === undefined || inheritanceRaw === null ? 't' : String(inheritanceRaw).trim();
  const excludeText = String(excludeRaw ?? '').trim();
  // a Lisp list as Emacs writes it, or just the tags with spaces or commas between (what someone types into a settings box)
  const excludeWords = parseLispTagList(excludeText) || (excludeText.toLowerCase() === 'nil' ? [] : excludeText.split(/[\s,]+/).filter(Boolean));
  const exclude = new Set(excludeWords);
  /** @type {Set<string> | RegExp | null} */ let only = null;
  if (raw.toLowerCase() === 'nil') return false;
  if (raw.toLowerCase() !== 't') {
    const list = parseLispTagList(raw);
    if (list) only = new Set(list);
    else if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
      try {
        only = new RegExp(raw.slice(1, -1).replace(/\\\\/g, '\\'));
      } catch {
        return true; // not a usable regexp: behave as the default
      }
    } else return true;
  }
  return only === null && exclude.size === 0 ? true : { only, exclude };
}

/** Whether a tag on an ancestor is inherited.
 * @param {TagInheritance} policy
 * @param {string} tag */
export function tagInherits(policy, tag) {
  if (typeof policy === 'boolean') return policy;
  if (policy.exclude.has(tag)) return false;
  if (policy.only === null) return true;
  return policy.only instanceof RegExp ? policy.only.test(tag) : policy.only.has(tag);
}

/** The heading's own tags, then the ones it inherits from its ancestors (root first).
 * @param {Heading} heading
 * @param {Heading[]} ancestors
 * @param {TagInheritance} policy */
export function effectiveTagsOf(heading, ancestors, policy) {
  const all = [...(heading.tags || [])];
  if (policy === false) return all;
  for (const ancestor of ancestors) {
    for (const tag of ancestor.tags || []) if (tagInherits(policy, tag)) all.push(tag);
  }
  return all;
}
