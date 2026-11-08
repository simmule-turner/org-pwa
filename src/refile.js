// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * @typedef {{ kind: 'level' | 'maxlevel', n: number } | { kind: 'tag', name: string } | { kind: 'todo', keyword: string } | { kind: 'regexp', source: string, regex: RegExp }} RefileCriterion
 * @typedef {{ fileSpec: string, criteria: RefileCriterion[] }} RefileEntry
 * @typedef {{ documentId: string, heading: Heading, outlinePath: string[] }} RefileTarget
 */
/**
 * org-refile-targets, written the way Emacs takes it: a list of `(FILES :KEY . VALUE)` entries, in the Lisp init, the Settings box or a
 * `# org-refile-targets:` line. A leading quote is allowed.
 *
 *   ((nil :maxlevel . 3) ("notes.org" :tag . "work") (org-agenda-files :todo . "NEXT"))
 *
 * FILES is `nil` (this file), the variable `org-agenda-files`, a file name, or a list of file names. A bare name is a sibling of
 * the current file (the convention capture-template.js's resolveCaptureFileId already established), optionally with a `github:`,
 * `webdav:` or `local:` prefix. The key is `:level`, `:maxlevel`, `:tag`, `:todo` or `:regexp`; one per entry, as in Emacs:
 *
 *   :level N     exactly level N
 *   :maxlevel N  level N or shallower
 *   :tag "NAME"  NAME is one of the headline's OWN tags (no inheritance; case-sensitive)
 *   :todo "KW"   the headline's TODO keyword is exactly KW (a DONE keyword works too)
 *   :regexp "RE" an Emacs regexp matched against the headline line as written in the file, case-sensitively
 *
 * An entry that can't be understood (a function for FILES, an unknown key) is skipped AND reported (see
 * parseRefileTargetsWithErrors), never guessed at. Default when the variable is unset, as in Emacs: the current file only, level 1
 * headings only.
 */

import { resolveCaptureFileId } from './capture-template.js';
import { emacsRegexToJs, EmacsRegexError } from './emacs-regex.js';
import { serializeHeadingLine } from './org-parser.js';
import { readLisp, listItems, stringValue, symbolName, isNil } from './lisp-read.js';

/** @param {import('./lisp-read.js').Lisp} f  Emacs's `prin1` of the value
 * @returns {string} */
function printed(f) {
  if (f.k === 'str') return JSON.stringify(f.v);
  if (f.k === 'num') return String(f.v);
  if (f.k === 'sym') return f.v;
  return '(' + f.items.map(printed).join(' ') + (f.tail ? ' . ' + printed(f.tail) : '') + ')';
}

/**
 * Reads one `(FILES :KEY . VALUE)` entry; returns { entries } (one per file) or { error }.
 * @param {import('./lisp-read.js').Lisp} item
 * @returns {{ entries: RefileEntry[] } | { error: string }}
 */
function readOneEntry(item) {
  if (item.k !== 'list' || item.items.length !== 2 || !item.tail) return { error: 'is not of the form (FILES :KEY . VALUE), such as (nil :maxlevel . 3)' };
  const [files, keyForm] = item.items;
  const key = symbolName(keyForm);
  if (!key || !/^:(level|maxlevel|tag|todo|regexp)$/.test(key)) return { error: `the key ${printed(keyForm)} is not known (use :level, :maxlevel, :tag, :todo or :regexp)` };
  const value = item.tail;
  /** @type {RefileCriterion} */ let criterion;
  if (key === ':level' || key === ':maxlevel') {
    if (value.k !== 'num' || !Number.isInteger(value.v) || value.v < 0) return { error: `${key} needs a whole number, not ${printed(value)}` };
    if (key === ':maxlevel' && value.v < 1) return { error: `:maxlevel ${value.v} isn't valid: Emacs builds an empty heading pattern from it (Invalid content of \\{\\})` };
    criterion = { kind: key === ':level' ? 'level' : 'maxlevel', n: value.v };
  } else {
    const text = stringValue(value);
    if (text === null || text === '') return { error: `${key} needs a string, not ${printed(value)}` };
    if (key === ':tag') criterion = { kind: 'tag', name: text };
    else if (key === ':todo') criterion = { kind: 'todo', keyword: text };
    else {
      try {
        criterion = { kind: 'regexp', source: text, regex: emacsRegexToJs(text) };
      } catch (err) {
        if (!(err instanceof EmacsRegexError)) throw err;
        return { error: `regexp "${text}" isn't valid: ${err.message}` };
      }
    }
  }
  /** @type {string[]} */ let names;
  const fileList = listItems(files);
  if (isNil(files)) names = ['current'];
  else if (files.k === 'sym') {
    if (files.v !== 'org-agenda-files') return { error: `the variable ${files.v} is not known (use org-agenda-files, nil, a file name or a list of file names)` };
    names = ['agenda-files'];
  } else if (files.k === 'str') names = [files.v];
  else if (fileList && fileList.every((f) => f.k === 'str')) names = fileList.map((f) => /** @type {string} */ (stringValue(f)));
  else return { error: `the files ${printed(files)} are not nil, org-agenda-files, a file name or a list of file names` };
  return { entries: names.map((fileSpec) => ({ fileSpec, criteria: [criterion] })) };
}

/** Parses org-refile-targets text into `{ entries, errors }`. `errors`
 *  lists every entry that was skipped and why, so the caller can show
 * @param {string} text
 *  it rather than have a target quietly disappear. */
function parseRefileTargetsWithErrors(text) {
  /** @type {RefileEntry[]} */ const entries = [];
  /** @type {{ entry: string, message: string }[]} */ const errors = [];
  const fallback = () => ({ entries: /** @type {RefileEntry[]} */ ([{ fileSpec: 'current', criteria: [{ kind: 'level', n: 1 }] }]), errors });
  if (!text || !text.trim()) return fallback();
  const form = readLisp(text.trim().replace(/^'/, ''))[0];
  if (!form || isNil(form)) return fallback();
  const list = listItems(form);
  if (!list) {
    errors.push({ entry: text.trim(), message: 'org-refile-targets is a list of (FILES :KEY . VALUE) entries, such as ((nil :maxlevel . 3))' });
    return { entries, errors };
  }
  for (const item of list) {
    const result = readOneEntry(item);
    if ('entries' in result) entries.push(...result.entries);
    else errors.push({ entry: printed(item), message: result.error });
  }
  return { entries, errors };
}

/** @param {string} text */
function parseRefileTargets(text) {
  return parseRefileTargetsWithErrors(text).entries;
}

/**
 * Whether `heading` satisfies every criterion of one entry.
 * @param {Heading} heading
 * @param {RefileCriterion[]} criteria
 */
function headingMatchesCriteria(heading, criteria) {
  return criteria.every((c) => {
    switch (c.kind) {
      case 'level':
        return heading.level === c.n;
      case 'maxlevel':
        return heading.level <= c.n;
      case 'tag':
        return (heading.tags || []).includes(c.name);
      case 'todo':
        return heading.todo === c.keyword;
      case 'regexp':
        return c.regex.test(serializeHeadingLine(heading));
      default:
        return false;
    }
  });
}

/** Strips a "scheme:path" entry down to its own bare path -- every
 *  actual document lookup throughout this app (state.documentId,
 *  docsById's own keys, aggregateAgendaDocs' own output) uses the bare
 *  path only, never the "scheme:" prefix; that prefix exists purely
 *  in agendaFilesConfig's own raw configuration strings, needed there
 * @param {string} key
 *  specifically to pick which adapter (github vs webdav) fetches it. */
function stripScheme(key) {
  const colonIndex = key.indexOf(':');
  return colonIndex === -1 ? key : key.slice(colonIndex + 1);
}

/**
 * @param {RefileEntry} entry
 * @param {string} currentFileId
 * @param {string[] | null | undefined} agendaFilesConfig
 */
function resolveEntryFileIds(entry, currentFileId, agendaFilesConfig) {
  if (entry.fileSpec === 'current') return [currentFileId];
  if (entry.fileSpec === 'agenda-files') return (agendaFilesConfig || []).map(stripScheme);
  return [resolveCaptureFileId(entry.fileSpec, currentFileId)];
}

/**
 * The full list of candidate refile-target headings across every
 * resolved entry -- each candidate annotated with its own outline path
 * (an array of ancestor titles, for display, matching real org's own
 * completion-candidate convention) and which document it lives in.
 * `excludeHeading` (typically the heading actually being refiled) and
 * its own entire subtree are excluded from every entry's results --
 * refiling something into its own descendant would corrupt the tree,
 * and real org refuses this too.
 *
 * `docsById` is a `{ [documentId]: parsedDoc }` map -- callers are
 * responsible for having the relevant documents already loaded/parsed;
 * this function does no I/O of its own. A file-spec resolving to a
 * document not present in `docsById` is silently skipped (e.g. an
 * Agenda File that failed to load) rather than throwing.
 * @param {RefileEntry[]} targetsSpec
 * @param {Record<string, Doc>} docsById
 * @param {string} currentFileId
 * @param {string[] | null | undefined} agendaFilesConfig
 * @param {Heading | null} [excludeHeading]
 */
function getRefileCandidates(targetsSpec, docsById, currentFileId, agendaFilesConfig, excludeHeading = null) {
  const excludeSet = excludeHeading ? collectSubtreeHeadings(excludeHeading) : null;
  /** @type {any[]} */ const candidates = [];
  const seen = new WeakSet(); // headings already offered, since the same file can appear via more than one entry

  for (const entry of targetsSpec) {
    const fileIds = resolveEntryFileIds(entry, currentFileId, agendaFilesConfig);
    for (const documentId of fileIds) {
      const doc = docsById[documentId];
      if (!doc) continue;
      walkForCandidates(doc.children, [], entry, documentId, excludeSet, candidates, seen);
    }
  }
  return candidates;
}

/**
 * @param {Heading[]} headings
 * @param {string[]} outlinePath
 * @param {RefileEntry} entry
 * @param {string} documentId
 * @param {Set<Heading> | null} excludeSet
 * @param {RefileTarget[]} candidates
 * @param {WeakSet<object>} seen
 */
function walkForCandidates(headings, outlinePath, entry, documentId, excludeSet, candidates, seen) {
  for (const heading of headings) {
    const matches = headingMatchesCriteria(heading, entry.criteria);
    const path = [...outlinePath, heading.title];
    if (matches && !(excludeSet && excludeSet.has(heading))) {
      // the same heading reached by two entries is offered once; two headings with one name are two targets, as in Emacs
      if (!seen.has(heading)) {
        seen.add(heading);
        candidates.push({ documentId, heading, outlinePath: path });
      }
    }
    // Still recurse into a non-matching or excluded heading's children --
    // a level=2 spec should still find level-2 candidates underneath a
    // level-1 heading that itself didn't match, and an ancestor of the
    // excluded subtree isn't itself excluded, only the excluded heading
    // and ITS OWN descendants are (collectSubtreeHeadings only collects
    // downward from excludeHeading, never its ancestors).
    if (!(excludeSet && excludeSet.has(heading))) {
      walkForCandidates(heading.children || [], path, entry, documentId, excludeSet, candidates, seen);
    }
  }
}

/** Every heading in `heading`'s own subtree, itself included -- used to
 *  exclude a refiled heading and all its descendants from its own
 * @param {Heading} heading
 *  candidate list. */
function collectSubtreeHeadings(heading) {
  const set = new Set([heading]);
  /** @param {any} [h] */
  const walk = (h) => {
    for (const c of h.children || []) {
      set.add(c);
      walk(c);
    }
  };
  walk(heading);
  return set;
}

/** Finds a heading within `doc` by matching its outline path (an array
 *  of ancestor titles, root first) -- used to re-resolve a refile
 *  target against a FRESH parse at actual write-time, rather than
 *  reusing whatever heading object reference the candidate list
 *  happened to be built from, which could be stale by the time the
 *  user actually picks one (especially for a cross-file target, read
 *  once when the picker opened but possibly edited elsewhere since).
 * @param {Doc} doc
 * @param {string[]} outlinePath
 *  Returns null if the path no longer matches anything. */
function findHeadingByOutlinePath(doc, outlinePath) {
  let level = doc.children;
  /** @type {any} */
  let found = null;
  for (const title of outlinePath) {
    found = (level || []).find((h) => h.title === title);
    if (!found) return null;
    level = found.children;
  }
  return found;
}

// ---- recently used targets ----------------------------------------------------
//
// Real org keeps org-refile-history so the refile prompt can offer the
// targets you used last. Here the picker lists the most recent ones first,
// above the full list -- but only ones that are STILL valid candidates
// (the file, the heading, org-refile-targets and the refiled subtree's own
// exclusion are all re-checked), so a stale entry never shows.

/** @param {{ documentId: string, outlinePath: string[] }} target */
const refileTargetKey = (target) => target.documentId + '\u0000' + target.outlinePath.join('\u0001');

/** `recent` with `target` moved to the front, de-duplicated and capped.
 * @param {{ documentId: string, outlinePath: string[] }[]} recent
 * @param {{ documentId: string, outlinePath: string[] }} target
 *  Stores only what is needed to find the target again. */
function pushRecentRefileTarget(recent, target, max = 8) {
  const entry = { documentId: target.documentId, outlinePath: [...target.outlinePath] };
  const key = refileTargetKey(entry);
  return [entry, ...recent.filter((r) => refileTargetKey(r) !== key)].slice(0, max);
}

/** The current candidates that appear in `recent`, in recent-first order,
 * @param {RefileTarget[]} candidates
 * @param {{ documentId: string, outlinePath: string[] }[]} recent
 *  at most `limit` of them. */
function recentRefileCandidates(candidates, recent, limit = 5) {
  const byKey = new Map(candidates.map((c) => [refileTargetKey(c), c]));
  const result = [];
  for (const r of recent) {
    const candidate = byKey.get(refileTargetKey(r));
    if (candidate) result.push(candidate);
    if (result.length >= limit) break;
  }
  return result;
}

export { pushRecentRefileTarget, recentRefileCandidates, refileTargetKey, parseRefileTargets, parseRefileTargetsWithErrors, headingMatchesCriteria, resolveEntryFileIds, getRefileCandidates, findHeadingByOutlinePath, collectSubtreeHeadings };
