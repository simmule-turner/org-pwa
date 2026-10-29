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
        only = new RegExp(raw.slice(1, -1).replace(/\\\\/g, '\\'), 'i'); // a regexp matches without regard to case, as in Emacs
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
  if (policy.only instanceof Set) return policy.only.has(tag); // a list of tags to inherit wins over the tags excluded from inheritance, as in Emacs
  if (policy.exclude.has(tag)) return false;
  return policy.only === null ? true : policy.only.test(tag);
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

/** Every heading in these documents, with its ancestors (root first), for working out inherited tags.
 * @param {{ children: any[] }[]} docs
 * @returns {WeakMap<Heading, Heading[]>} */
export function buildAncestorIndex(docs) {
  /** @type {WeakMap<Heading, Heading[]>} */ const index = new WeakMap();
  /** @param {any[]} nodes @param {Heading[]} chain */
  const walk = (nodes, chain) => {
    for (const node of nodes || []) {
      if (node.type !== 'heading') continue;
      index.set(node, chain);
      walk(node.children, [...chain, node]);
    }
  };
  for (const doc of docs) if (doc) walk(doc.children, []);
  return index;
}

/** The `#+FILETAGS:` tags of each document, keyed by its top-level headings (which every heading below has in its ancestors).
 * @param {(import('./types.js').Doc | null | undefined)[]} docs
 * @returns {WeakMap<Heading, string[]>} */
export function buildFileTagsIndex(docs) {
  /** @type {WeakMap<Heading, string[]>} */ const index = new WeakMap();
  for (const doc of docs) {
    if (!doc) continue;
    const tags = (doc.keywords || []).filter((k) => String(k.key).toUpperCase() === 'FILETAGS').flatMap((k) => String(k.value).split(/[:\s]+/).filter(Boolean));
    if (tags.length) for (const node of doc.children || []) if (node.type === 'heading') index.set(node, tags);
  }
  return index;
}

/** The tags a heading gets from its ancestors and from the file's `#+FILETAGS:`, not counting ones it carries itself, each once.
 * @param {Heading} heading
 * @param {Heading[]} ancestors
 * @param {TagInheritance} policy
 * @param {string[]} [fileTags]
 * @returns {string[]} */
export function inheritedOnly(heading, ancestors, policy, fileTags = []) {
  if (policy === false) return [];
  const own = new Set(heading.tags || []);
  /** @type {string[]} */ const out = [];
  for (const ancestor of ancestors) {
    for (const tag of ancestor.tags || []) if (tagInherits(policy, tag) && !own.has(tag) && !out.includes(tag)) out.push(tag);
  }
  for (const tag of fileTags) if (tagInherits(policy, tag) && !own.has(tag) && !out.includes(tag)) out.push(tag);
  return out;
}

/** @typedef {'agenda' | 'todo' | 'search'} AgendaViewType */
/** @typedef {{ kind: 't' | 'nil' | 'always' | 'list', views: Set<string> }} ShowInheritedTags */

const VIEW_TYPES = ['agenda', 'todo', 'search'];

/** org-agenda-show-inherited-tags: t (the default), nil, always, or a list of view types. Anything else reads as t.
 * @param {string | boolean | null | undefined} raw
 * @returns {ShowInheritedTags} */
export function parseShowInheritedTags(raw) {
  if (raw === false) return { kind: 'nil', views: new Set() };
  if (raw === undefined || raw === null || raw === true) return { kind: 't', views: new Set() };
  const text = String(raw).trim().replace(/^'/, '').toLowerCase();
  if (text === '' || text === 't') return { kind: 't', views: new Set() };
  if (text === 'nil' || text === '()') return { kind: 'nil', views: new Set() };
  if (text === 'always') return { kind: 'always', views: new Set() };
  const list = parseLispTagList(text);
  if (list && !text.includes('.')) return { kind: 'list', views: new Set(list.filter((w) => VIEW_TYPES.includes(w))) };
  return { kind: 't', views: new Set() };
}

/** org-agenda-use-tag-inheritance: t, nil or a list of view types; the default is all three.
 * @param {string | boolean | null | undefined} raw
 * @returns {{ all: boolean, views: Set<string> }} */
export function parseAgendaUseTagInheritance(raw) {
  const every = { all: false, views: new Set(VIEW_TYPES) };
  if (raw === undefined || raw === null) return every;
  if (raw === true) return { all: true, views: new Set() };
  if (raw === false) return { all: false, views: new Set() };
  const text = String(raw).trim().replace(/^'/, '').toLowerCase();
  if (text === '') return every;
  if (text === 't') return { all: true, views: new Set() };
  if (text === 'nil' || text === '()') return { all: false, views: new Set() };
  const list = parseLispTagList(text);
  if (list && !text.includes('.')) return { all: false, views: new Set(list.filter((w) => VIEW_TYPES.includes(w))) };
  return every;
}

/** Whether an agenda line of this view type shows the tags it inherits (org-agenda.el's test at each row builder).
 * @param {AgendaViewType} view
 * @param {ShowInheritedTags} show
 * @param {{ all: boolean, views: Set<string> }} use */
export function showsInheritedTags(view, show, use) {
  if (show.kind === 'always') return true;
  if (show.kind === 'list') return show.views.has(view);
  if (show.kind === 't') return use.all || use.views.has(view);
  return false;
}

/** Whether the view's tag filter sees inherited tags: always, or when org-agenda-use-tag-inheritance covers the view.
 * @param {AgendaViewType} view
 * @param {ShowInheritedTags} show
 * @param {{ all: boolean, views: Set<string> }} use */
export function knowsInheritedTags(view, show, use) {
  if (show.kind === 'always') return true;
  return use.all || use.views.has(view);
}

/** org-use-property-inheritance: `true` / `false` for t / nil, or the properties that inherit (a list of names, or a regexp).
 * @typedef {boolean | { only: Set<string> | RegExp }} PropertyInheritance */

/** @param {string | null | undefined} raw  the value of org-use-property-inheritance @returns {PropertyInheritance | null} null when the text is none of those forms */
export function parsePropertyInheritance(raw) {
  const text = String(raw ?? '').trim();
  if (text === '' || text.toLowerCase() === 'nil') return false;
  if (text.toLowerCase() === 't') return true;
  const list = parseLispTagList(text);
  if (list) return { only: new Set(list.map((n) => n.toLowerCase())) };
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      return { only: new RegExp(text.slice(1, -1).replace(/\\\\/g, '\\'), 'i') };
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether the property `key` is inherited under `policy`. @param {PropertyInheritance} policy @param {string} key */
export function propertyInherits(policy, key) {
  if (typeof policy === 'boolean') return policy;
  return policy.only instanceof RegExp ? policy.only.test(key) : policy.only.has(key.toLowerCase()); // names compare without regard to case, as the property drawer does
}
