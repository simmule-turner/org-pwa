/**
 * Completion for tags and property keys -- the suggestions the general editor
 * offers while you type, in the spirit of Org's own completion for
 * org-set-tags-command and org-set-property. Pure: it looks at documents and
 * a query, and never at the page.
 *
 * Tags come from three places, all in the documents the app already has open
 * or has loaded for the agenda:
 *   - the tags on any heading (counted, so the ones you use most come first);
 *   - a `#+FILETAGS:` line;
 *   - tags DECLARED on a `#+TAGS:` line, which is how Org expects you to list
 *     the tags you mean to use -- including ones no heading carries yet.
 * A tag already on the heading being edited is never suggested again. Tags
 * are case-sensitive, as in Org: `Work` and `work` are different tags.
 *
 * Property keys come from the keys on any heading, plus the few this app
 * itself writes or reads.
 */

const TAG_CHARS = /^[\p{L}\p{N}_@#%]+$/u;

/** Every heading in `doc`, depth first. */
function* headingsOf(doc) {
  const stack = [...(doc && doc.children ? doc.children : [])].reverse();
  while (stack.length) {
    const heading = stack.pop();
    yield heading;
    for (let i = (heading.children || []).length - 1; i >= 0; i--) stack.push(heading.children[i]);
  }
}

/** The tags in a `:a:b:` list (a #+FILETAGS: value). */
function tagsInColonList(text) {
  return String(text == null ? '' : text)
    .split(':')
    .map((t) => t.trim())
    .filter((t) => t && TAG_CHARS.test(t));
}

/**
 * The tags a #+TAGS: line declares. Handles the fast-selection key
 * (`home(h)`), groups (`{ Ctx : @a @b }`, `[ GTD : x y ]`) -- the group name
 * and its members are all tags -- and skips the syntax words (`:startgroup`,
 * `:newline`, `:`).
 */
function declaredTagsOf(doc) {
  const names = [];
  for (const keyword of (doc && doc.keywords) || []) {
    if (String(keyword.key).toUpperCase() !== 'TAGS') continue;
    for (const raw of String(keyword.value == null ? '' : keyword.value).split(/[\s{}[\]]+/)) {
      const token = raw.replace(/\([^)]*\)$/, ''); // fast-selection key
      if (!token || token.startsWith(':') || !TAG_CHARS.test(token)) continue;
      names.push(token);
    }
  }
  return names;
}

/** Tag -> how many headings carry it (a #+FILETAGS: tag counts once). */
function collectTagUsage(docs) {
  const usage = new Map();
  const bump = (tag) => usage.set(tag, (usage.get(tag) || 0) + 1);
  for (const doc of docs) {
    if (!doc) continue;
    for (const keyword of doc.keywords || []) {
      if (String(keyword.key).toUpperCase() === 'FILETAGS') tagsInColonList(keyword.value).forEach(bump);
    }
    for (const heading of headingsOf(doc)) for (const tag of heading.tags || []) bump(tag);
  }
  return usage;
}

/**
 * Suggestions for the tag being typed. `query` is what's in the box (may be
 * empty); `applied` the heading's current tags. Best first: a tag that
 * STARTS with the query, then one that merely contains it; within each, the
 * most used first, then alphabetical. Empty query: the most used tags.
 */
function suggestTags({ docs, applied = [], query = '', limit = 10 }) {
  const usage = collectTagUsage(docs);
  const candidates = new Set(usage.keys());
  for (const doc of docs) for (const tag of declaredTagsOf(doc)) candidates.add(tag);
  for (const tag of applied) candidates.delete(tag);

  const q = String(query).trim().replace(/:/g, '').toLowerCase();
  const scored = [];
  for (const tag of candidates) {
    const lower = tag.toLowerCase();
    let rank;
    if (q === '') rank = 0;
    else if (lower.startsWith(q)) rank = 0;
    else if (lower.includes(q)) rank = 1;
    else continue;
    scored.push({ tag, rank, count: usage.get(tag) || 0 });
  }
  scored.sort((a, b) => a.rank - b.rank || b.count - a.count || a.tag.localeCompare(b.tag));
  return scored.slice(0, limit).map((s) => s.tag);
}

/** Property keys this app itself writes or reads, offered even if no heading has them yet. */
const KNOWN_PROPERTY_KEYS = ['CUSTOM_ID', 'EFFORT', 'Effort_ALL', 'ID', 'ARCHIVE_TIME', 'ARCHIVE_FILE', 'ARCHIVE_CATEGORY', 'ARCHIVE_TODO', 'ARCHIVE_ITAGS', 'ARCHIVE_OLPATH'];

/** Property keys to offer: those on any heading (most used first), then the known ones. */
function suggestPropertyKeys({ docs, applied = [] }) {
  const usage = new Map();
  for (const doc of docs) {
    if (!doc) continue;
    for (const heading of headingsOf(doc)) for (const key of heading.propertyOrder || []) usage.set(key, (usage.get(key) || 0) + 1);
  }
  const appliedLower = new Set(applied.map((k) => String(k).toLowerCase()));
  const used = [...usage].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  const result = [];
  const seen = new Set();
  for (const key of [...used, ...KNOWN_PROPERTY_KEYS]) {
    const lower = key.toLowerCase();
    if (seen.has(lower) || appliedLower.has(lower)) continue;
    seen.add(lower);
    result.push(key);
  }
  return result;
}

export { collectTagUsage, declaredTagsOf, suggestTags, suggestPropertyKeys, KNOWN_PROPERTY_KEYS };
