/**
 * org-refile-targets, translated into this app's own plain-text
 * Global/Local Variables format (a single line can't hold real org's
 * actual Lisp list-of-cons-cells syntax). One line, semicolon-separated
 * entries, each `<file-spec> <criterion> [<criterion> ...]`:
 *
 *   org-refile-targets: current maxlevel=3; notes.org tag=work level=2; agenda-files todo=NEXT
 *
 * File spec is one of:
 *   - `current`      -- this file only (org's own `nil`)
 *   - `agenda-files` -- every file in this app's own configured Agenda
 *                       Files (org's own `org-agenda-files` symbol)
 *   - anything else  -- a specific file, resolved with EXACTLY the same
 *                       sibling-file convention capture-template.js's
 *                       own resolveCaptureFileId already established
 *                       (a name with no "/" resolves relative to the
 *                       current file; a name containing "/" is used
 *                       as-is) -- not a second, parallel convention.
 *
 * Criteria (real org's own :level / :maxlevel / :tag / :todo /
 * :regexp target specs). An entry may list several; a heading must
 * satisfy ALL of them -- one deliberate extension: real org takes one
 * criterion per entry and needs a Lisp verify function to combine them.
 *
 *   level=N      exactly level N
 *   maxlevel=N   level N or shallower
 *   tag=NAME     NAME is one of the headline's OWN tags (no
 *                inheritance, as in org; case-sensitive)
 *   todo=KEYWORD the headline's TODO keyword is exactly KEYWORD
 *                (case-sensitive; a DONE keyword works too)
 *   regexp=PATTERN an Emacs regexp matched against the headline line as
 *                written in the file (`** TODO [#A] Title :tag:`),
 *                case-sensitively. Takes the REST of the entry, spaces
 *                included, so it must be the last criterion. A literal
 *                ";" inside it is written "\;".
 *
 * At least one criterion is required on every entry. An entry that
 * can't be understood is skipped AND reported (see
 * parseRefileTargetsWithErrors), never guessed at.
 *
 * Default when org-refile-targets is entirely unset (matches real
 * org's own actual, documented nil-default exactly): current file
 * only, level 1 headings only.
 */

import { resolveCaptureFileId } from './capture-template.js';
import { emacsRegexToJs, EmacsRegexError } from './emacs-regex.js';
import { serializeHeadingLine } from './org-parser.js';

const CRITERION_KEYS = ['level', 'maxlevel', 'tag', 'todo', 'regexp'];

/** Splits on ";" separators, treating a backslash as escaping the next
 *  character (so "\;" stays inside its entry, and "\\;" is an escaped
 *  backslash followed by a real separator). Escapes are kept as written. */
function splitEntries(text) {
  const entries = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      current += ch + text[i + 1];
      i++;
    } else if (ch === ';') {
      entries.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  entries.push(current);
  return entries;
}

/** Parses one entry; returns { entry } or { error }. */
function parseOneEntry(entryText) {
  const firstSpace = entryText.search(/\s/);
  const fileSpec = firstSpace === -1 ? entryText : entryText.slice(0, firstSpace);
  if (fileSpec.includes('=')) {
    return { error: `starts with "${fileSpec}" -- expected a file first (current, agenda-files, or a filename), then criteria` };
  }
  let rest = firstSpace === -1 ? '' : entryText.slice(firstSpace).trim();
  if (!rest) {
    return { error: 'needs at least one criterion (level=, maxlevel=, tag=, todo=, or regexp=)' };
  }

  const criteria = [];
  while (rest) {
    const eq = rest.indexOf('=');
    const space = rest.search(/\s/);
    if (eq === -1 || (space !== -1 && space < eq)) {
      const token = space === -1 ? rest : rest.slice(0, space);
      return { error: `"${token}" isn't a criterion (expected key=value, e.g. level=2 or tag=work)` };
    }
    const key = rest.slice(0, eq);
    if (!CRITERION_KEYS.includes(key)) {
      return { error: `unknown criterion "${key}" (expected level, maxlevel, tag, todo, or regexp)` };
    }
    let value;
    if (key === 'regexp') {
      value = rest.slice(eq + 1); // the rest of the entry, spaces and all
      rest = '';
    } else {
      const afterEq = rest.slice(eq + 1);
      const valueEnd = afterEq.search(/\s/);
      value = valueEnd === -1 ? afterEq : afterEq.slice(0, valueEnd);
      rest = valueEnd === -1 ? '' : afterEq.slice(valueEnd).trim();
    }
    if (value === '') return { error: `${key}= needs a value` };

    if (key === 'level' || key === 'maxlevel') {
      if (!/^\d+$/.test(value)) return { error: `${key}= needs a whole number, not "${value}"` };
      criteria.push({ kind: key, n: Number(value) });
    } else if (key === 'tag') {
      criteria.push({ kind: 'tag', name: value });
    } else if (key === 'todo') {
      criteria.push({ kind: 'todo', keyword: value });
    } else {
      try {
        criteria.push({ kind: 'regexp', source: value, regex: emacsRegexToJs(value) });
      } catch (err) {
        if (!(err instanceof EmacsRegexError)) throw err;
        return { error: `regexp "${value}" isn't valid: ${err.message}` };
      }
    }
  }
  return { entry: { fileSpec, criteria } };
}

/** Parses org-refile-targets text into `{ entries, errors }`. `errors`
 *  lists every entry that was skipped and why, so the caller can show
 *  it rather than have a target quietly disappear. */
function parseRefileTargetsWithErrors(text) {
  if (!text || !text.trim()) {
    return { entries: [{ fileSpec: 'current', criteria: [{ kind: 'level', n: 1 }] }], errors: [] };
  }
  const entries = [];
  const errors = [];
  for (const rawEntry of splitEntries(text)) {
    const entryText = rawEntry.trim();
    if (!entryText) continue;
    const result = parseOneEntry(entryText);
    if (result.entry) entries.push(result.entry);
    else errors.push({ entry: entryText, message: result.error });
  }
  return { entries, errors };
}

function parseRefileTargets(text) {
  return parseRefileTargetsWithErrors(text).entries;
}

/** Whether `heading` satisfies every criterion of one entry. */
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
 *  specifically to pick which adapter (github vs webdav) fetches it. */
function stripScheme(key) {
  const colonIndex = key.indexOf(':');
  return colonIndex === -1 ? key : key.slice(colonIndex + 1);
}

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
 */
function getRefileCandidates(targetsSpec, docsById, currentFileId, agendaFilesConfig, excludeHeading = null) {
  const excludeSet = excludeHeading ? collectSubtreeHeadings(excludeHeading) : null;
  const candidates = [];
  const seen = new Set(); // documentId + heading identity, since the same file can appear via more than one entry

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

function walkForCandidates(headings, outlinePath, entry, documentId, excludeSet, candidates, seen) {
  for (const heading of headings) {
    const matches = headingMatchesCriteria(heading, entry.criteria);
    const path = [...outlinePath, heading.title];
    if (matches && !(excludeSet && excludeSet.has(heading))) {
      const key = documentId + '\u0000' + path.join('\u0000');
      if (!seen.has(key)) {
        seen.add(key);
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
 *  candidate list. */
function collectSubtreeHeadings(heading) {
  const set = new Set([heading]);
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
 *  Returns null if the path no longer matches anything. */
function findHeadingByOutlinePath(doc, outlinePath) {
  let level = doc.children;
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

const refileTargetKey = (target) => target.documentId + '\u0000' + target.outlinePath.join('\u0001');

/** `recent` with `target` moved to the front, de-duplicated and capped.
 *  Stores only what is needed to find the target again. */
function pushRecentRefileTarget(recent, target, max = 8) {
  const entry = { documentId: target.documentId, outlinePath: [...target.outlinePath] };
  const key = refileTargetKey(entry);
  return [entry, ...recent.filter((r) => refileTargetKey(r) !== key)].slice(0, max);
}

/** The current candidates that appear in `recent`, in recent-first order,
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
