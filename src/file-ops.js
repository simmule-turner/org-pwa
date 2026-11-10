// @ts-check
// The pure parts of the Files view's file management, after Emacs Dired: marks, Find, sorting, and the plan for
// a copy, move or delete (which names collide, what a folder holds). The adapters that do the work are in
// src-browser/file-ops-io.js.

/** @typedef {import('./file-screen-model.js').BrowseEntry} BrowseEntry */
/** @typedef {BrowseEntry & { size?: number, modified?: number }} FileEntry */
/** @typedef {'name' | 'date' | 'size'} SortKey */
import { emacsRegexToJs } from './emacs-regex.js';

/** The path without a leading slash, which is how every place names a file. @param {string} path */
export const cleanPath = (path) => path.replace(/^\/+/, '');

/** Compiles the regexp of Find (`find-lisp-find-dired`): an Emacs regexp tried against a file's name, folding case as Emacs does by default
 * (`case-fold-search`). Resolves { test } for a good regexp or { error } for one Emacs would refuse. An empty regexp matches every name.
 * @param {string} regexp @returns {{ test: (name: string) => boolean } | { error: string }} */
export function compileFind(regexp) {
  if (regexp === '') return { test: () => true };
  try {
    const re = emacsRegexToJs(regexp, 'i');
    return { test: (name) => re.test(name) };
  } catch (err) {
    return { error: err && /** @type {Error} */ (err).message ? /** @type {Error} */ (err).message : 'Invalid regexp' };
  }
}

/** The files of a Find: those of `all` (every file below the folder) whose name matches `regexp`, or null for a regexp Emacs refuses. Changing the regexp
 * (`find-lisp-find-dired-filter`) matches the same files again, as a new search would.
 * @param {FileEntry[]} all @param {string} regexp @returns {FileEntry[] | null} */
export function findMatches(all, regexp) {
  const compiled = compileFind(regexp);
  if ('error' in compiled) return null;
  return all.filter((e) => e.type === 'file' && compiled.test(e.name));
}

/** The entries to show, sorted. Folders come first whatever the key (Dired with `dired-listing-switches` "--group-directories-first").
 * 'name' is ascending; 'date' and 'size' put the newest and biggest first, as `ls -t` and `ls -S` do. An entry whose place gave no
 * date or size sorts after the others, by name.
 * @param {FileEntry[]} entries @param {SortKey} key @param {boolean} [reverse] */
export function arrange(entries, key, reverse = false) {
  const byName = (/** @type {FileEntry} */ a, /** @type {FileEntry} */ b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const value = (/** @type {FileEntry} */ e) => (key === 'date' ? e.modified : key === 'size' ? e.size : undefined);
  const rows = entries.slice();
  rows.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    let order = 0;
    if (key !== 'name') {
      const x = value(a);
      const y = value(b);
      if (x === undefined && y === undefined) order = 0;
      else if (x === undefined) return 1;
      else if (y === undefined) return -1;
      else order = y - x;
    }
    if (order === 0) order = byName(a, b);
    return reverse ? -order : order;
  });
  return rows;
}

/** Marks, in the manner of Dired: a set of paths, by `m`, `u`, `U`, `t` and `% m`.
 * @param {Set<string>} marks @param {FileEntry[]} shown the rows on screen, which marking acts on */
export const marking = {
  /** @param {Set<string>} marks @param {string} path */
  toggleOne(marks, path) {
    const next = new Set(marks);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  },
  /** `t`: every file becomes marked if it was not and the other way round; folders are marked and unmarked too, as Dired does but "." and ".." are never rows.
   * @param {Set<string>} marks @param {FileEntry[]} shown */
  invert(marks, shown) {
    const next = new Set(marks);
    for (const e of shown) {
      if (next.has(e.path)) next.delete(e.path);
      else next.add(e.path);
    }
    return next;
  },
  /** `% m REGEXP`: marks the rows whose name matches. A bad pattern is reported by returning null. Like Dired, the match is on the file name, not the path, and is case-folded as `case-fold-search` is by default.
   * @param {Set<string>} marks @param {FileEntry[]} shown @param {string} pattern */
  byRegexp(marks, shown, pattern) {
    let re;
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      return null;
    }
    const next = new Set(marks);
    for (const e of shown) if (re.test(e.name)) next.add(e.path);
    return next;
  },
  /** `U`: nothing marked. */
  clear() {
    return new Set();
  },
};

/** The marked entries still in the listing, in the order shown, or the one at `point` when nothing is marked (Dired acts on the file at point then).
 * @param {Set<string>} marks @param {FileEntry[]} shown @param {FileEntry | null} [point] */
export function targets(marks, shown, point = null) {
  const marked = shown.filter((e) => marks.has(e.path));
  return marked.length ? marked : point ? [point] : [];
}

/** Where `entry` lands in `folder`. @param {string} folder @param {BrowseEntry} entry */
export function landing(folder, entry) {
  return [cleanPath(folder), entry.name].filter(Boolean).join('/');
}

/** Whether `inner` is `outer` or lies inside it: a folder cannot be copied or moved into itself. @param {string} outer @param {string} inner */
export function isInside(outer, inner) {
  const a = cleanPath(outer).replace(/\/+$/, '');
  const b = cleanPath(inner).replace(/\/+$/, '');
  return b === a || b.startsWith(a + '/');
}

/** What a copy or move of `items` into `folder` would do: the target of each, and which of them are already there.
 * `existing` is the listing of the target folder (null when it could not be read: nothing is then assumed to collide).
 * An item that would land on itself (same place, same folder) is listed in `same` and is skipped; Dired refuses it too ("Cannot copy
 * or move over itself"); one that would land inside itself in `intoSelf`.
 * @param {FileEntry[]} items @param {string} folder @param {BrowseEntry[] | null} existing @param {{ samePlace: boolean, from?: string }} source */
export function planTransfer(items, folder, existing, source) {
  /** @type {{ item: FileEntry, to: string, clash: boolean }[]} */
  const moves = [];
  /** @type {FileEntry[]} */
  const same = [];
  /** @type {FileEntry[]} */
  const intoSelf = [];
  const names = new Map((existing || []).map((e) => [e.name, e.type]));
  for (const item of items) {
    const to = landing(folder, item);
    if (source.samePlace && cleanPath(item.path) === to) same.push(item);
    else if (source.samePlace && item.type === 'dir' && isInside(item.path, to)) intoSelf.push(item);
    else moves.push({ item, to, clash: names.has(item.name) });
  }
  return { moves, same, intoSelf };
}

/** A name that is not taken, for "Copy of" style copies in the same folder: "a.org" becomes "a (2).org".
 * @param {string} name @param {Set<string>} taken */
export function freeName(name, taken) {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Whether `name` can be the name of one file or folder: no slash, not empty, not "." or "..". @param {string} name */
export function validName(name) {
  const n = name.trim();
  return n !== '' && n !== '.' && n !== '..' && !/[/\\\u0000-\u001f\u007f]/.test(n);
}

/** Which of the paths to delete or replace are open in a tab, split by whether the tab has unsaved changes. A folder takes what is below it.
 * `open` lists the open documents: { path, dirty }. Deleting a file that is open with unsaved changes is refused; one that is open and saved is asked about.
 * @param {string[]} paths @param {{ path: string, dirty: boolean }[]} open */
export function openConflicts(paths, open) {
  const hit = (/** @type {{ path: string }} */ doc) => paths.some((p) => isInside(p, doc.path));
  return { refuse: open.filter((d) => d.dirty && hit(d)).map((d) => d.path), ask: open.filter((d) => !d.dirty && hit(d)).map((d) => d.path) };
}

/** Rewrites the path of an open file after a rename or move of `from` to `to` (which may be a folder holding it). Null when it is not affected.
 * @param {string} path @param {string} from @param {string} to */
export function movedPath(path, from, to) {
  const p = cleanPath(path);
  const f = cleanPath(from).replace(/\/+$/, '');
  if (p === f) return cleanPath(to);
  if (p.startsWith(f + '/')) return cleanPath(to).replace(/\/+$/, '') + p.slice(f.length);
  return null;
}

/** A readable size: "812 B", "4.2 KB", "1.3 MB". @param {number | undefined} n */
export function sizeLabel(n) {
  if (typeof n !== 'number') return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
