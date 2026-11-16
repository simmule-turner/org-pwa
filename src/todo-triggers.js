// @ts-check
/**
 * `org-todo-state-tags-triggers`: tags a state change adds or removes. The variable is a list of entries, each a state (a keyword
 * string, `""` for no state, `todo` for any not-done state, `done` for any done state) followed by `(TAG . t)` to add a tag and
 * `(TAG)` or `(TAG . nil)` to remove it.
 */

/** @param {string} source `"text"` with its escapes @returns {string} */
const unquote = (source) => source.slice(1, -1).replace(/\\(.)/g, '$1');

/**
 * @param {string | undefined} raw the variable as Lisp text
 * @returns {{ state: string, changes: { tag: string, on: boolean }[] }[]}
 */
export function readTagTriggers(raw) {
  if (raw === undefined) return [];
  const text = raw.trim().replace(/^'/, '');
  const entries = [];
  const entry = /\(\s*("(?:[^"\\]|\\.)*"|todo|done)((?:\s*\(\s*"(?:[^"\\]|\\.)*"(?:\s*\.\s*(?:t|nil))?\s*\))*)\s*\)/g;
  for (const m of text.matchAll(entry)) {
    const changes = [...m[2].matchAll(/\(\s*("(?:[^"\\]|\\.)*")(?:\s*\.\s*(t|nil))?\s*\)/g)].map((c) => ({ tag: unquote(c[1]), on: c[2] === 't' }));
    entries.push({ state: m[1].startsWith('"') ? unquote(m[1]) : m[1], changes });
  }
  return entries;
}

/**
 * org-todo-trigger-tag-changes: the tags a heading has after it was given `state` (null for none).
 * @param {string[]} tags @param {string | null} state @param {string | undefined} raw the variable
 * @param {string[]} doneKeywords @param {string[]} notDoneKeywords
 * @returns {string[] | null} the new tags, or null when nothing changes
 */
export function applyTagTriggers(tags, state, raw, doneKeywords, notDoneKeywords) {
  const current = state ?? '';
  // as Emacs looks them up: the first entry for a state, then the first for `todo` or `done`
  const first = (/** @type {string} */ key) => readTagTriggers(raw).find((e) => e.state === key)?.changes ?? [];
  const changes = [
    ...(current === '' ? first('') : first(current)),
    ...(notDoneKeywords.includes(current) ? first('todo') : []),
    ...(doneKeywords.includes(current) ? first('done') : []),
  ];
  if (changes.length === 0) return null;
  let next = [...tags];
  for (const { tag, on } of changes) next = on ? (next.includes(tag) ? next : [...next, tag]) : next.filter((t) => t !== tag);
  return next;
}
