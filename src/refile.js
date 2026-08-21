/**
 * org-refile-targets, translated into this app's own plain-text
 * Global/Local Variables format (a single line can't hold real org's
 * actual Lisp list-of-cons-cells syntax). One line, semicolon-separated
 * entries, each `<file-spec> <level-spec>`:
 *
 *   org-refile-targets: current maxlevel=3; notes.org maxlevel=2; agenda-files level=1
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
 * Level spec is `maxlevel=N` (this level and shallower) or `level=N`
 * (exactly this level) -- required on every entry when the variable is
 * set at all, matching real org's own stricter requirement there; an
 * entry missing one is skipped rather than guessing at a default.
 *
 * Default when org-refile-targets is entirely unset (matches real
 * org's own actual, documented nil-default exactly): current file
 * only, level 1 headings only.
 */

import { resolveCaptureFileId } from './capture-template.js';

const ENTRY_RE = /^(\S+)\s+(maxlevel|level)=(\d+)$/;

function parseRefileTargets(text) {
  if (!text || !text.trim()) {
    return [{ fileSpec: 'current', kind: 'level', n: 1 }];
  }
  const entries = [];
  for (const rawEntry of text.split(';')) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const m = ENTRY_RE.exec(entry);
    if (!m) continue; // malformed entry -- skipped, not guessed at, matching real org's own stricter requirement
    const [, fileSpec, kind, n] = m;
    entries.push({ fileSpec, kind, n: Number(n) });
  }
  return entries;
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
    const matches = entry.kind === 'level' ? heading.level === entry.n : heading.level <= entry.n;
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

export { parseRefileTargets, resolveEntryFileIds, getRefileCandidates, findHeadingByOutlinePath };
