/**
 * Capture templates: org's own org-capture-templates system — a short
 * template string, expanded with runtime context (current time, a table
 * row number, answers to inline prompts) into the text actually inserted
 * at a target location in the document.
 *
 * Split deliberately into three concerns, each independently testable:
 *   - Template expansion (this file's top half): the %-escape language
 *     itself, pure text in, text out, no knowledge of documents at all.
 *   - Target resolution (resolveOlpTarget): finds or creates the
 *     find-or-create-outline-path a capture template's (file+olp ...)
 *     target describes.
 *   - Insertion (insertCapture): given an already-expanded template and
 *     a resolved target heading, actually mutates the document —
 *     dispatching on capture type (item/checkitem/plain/table-line),
 *     reusing body-edit.js's existing primitives rather than
 *     hand-rolling AST mutation again.
 *
 * All time-based expansion uses local time, per the requirements
 * decision — not UTC, matching what a person actually sees on their
 * device's clock, which is what they'd expect a "current time" capture
 * to reflect.
 */

import { formatOrgTimestamp } from './org-timestamp.js';
import { parseOrg } from './org-parser.js';
import { insertTopLevelHeading, insertChildHeading } from './heading-edit.js';
import { insertTable, insertTableRow, setTableCell } from './body-edit.js';
import { parseBody } from './body-parser.js';

// ---- %<FORMAT> (format-time-string subset) -------------------------------

const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_NAMES_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_NAMES_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - start) / 86400000) + 1;
}

/**
 * A practical subset of Emacs's format-time-string specifiers — the ones
 * that actually show up in real capture templates (dates, times, weekday
 * and month names), not the complete, much longer C strftime table.
 * An unrecognized specifier is left untouched (e.g. an unsupported %Z
 * stays as literal "%Z" in the output) rather than silently dropped,
 * since silently eating unknown input is a worse failure mode than
 * leaving a visible, debuggable trace of what wasn't understood.
 */
function formatTime(date, format) {
  return format.replace(/%(.)/g, (whole, spec) => {
    switch (spec) {
      case 'Y':
        return String(date.getFullYear());
      case 'y':
        return pad(date.getFullYear() % 100);
      case 'm':
        return pad(date.getMonth() + 1);
      case 'd':
        return pad(date.getDate());
      case 'e':
        return String(date.getDate()).padStart(2, ' ');
      case 'H':
        return pad(date.getHours());
      case 'I': {
        const h = date.getHours() % 12 || 12;
        return pad(h);
      }
      case 'M':
        return pad(date.getMinutes());
      case 'S':
        return pad(date.getSeconds());
      case 'p':
        return date.getHours() < 12 ? 'AM' : 'PM';
      case 'A':
        return DAY_NAMES_FULL[date.getDay()];
      case 'a':
        return DAY_NAMES_ABBR[date.getDay()];
      case 'B':
        return MONTH_NAMES_FULL[date.getMonth()];
      case 'b':
        return MONTH_NAMES_ABBR[date.getMonth()];
      case 'j':
        return pad(dayOfYear(date), 3);
      case 'F':
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      case 'R':
        return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
      case 'T':
        return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
      case '%':
        return '%';
      default:
        return whole; // unrecognized -- leave as-is, don't silently drop it
    }
  });
}

// ---- %^{PROMPT} scanning --------------------------------------------------

/**
 * Finds every %^{...} prompt AND bare %? marker in `template`, in the
 * order they appear — what a caller uses to actually ask the person
 * for each answer before calling expandTemplate. Real org syntax:
 * %^{prompt}, %^{prompt|default}, or
 * %^{prompt|default|completion1|completion2|...}. A bare %? (real
 * org's own "cursor goes here" marker) is treated as a prompt too,
 * labeled "Text" — gathered up front via the same mechanism as any
 * other prompt, rather than left empty with its position recorded for
 * a caller to find-and-focus after the fact. That older approach
 * depended entirely on DOM state (the target heading needing to
 * already be expanded/visible, which a freshly-collapsed or
 * newly-created heading often isn't) and had no equivalent at all for
 * a capture landing in a different file, since there's no live DOM
 * for that file to focus anything in. Gathering the value first sidesteps
 * both problems the same way any other prompt already did.
 */
function scanPrompts(template) {
  const prompts = [];
  const re = /%\^\{([^}]*)\}|%\?/g;
  let match;
  while ((match = re.exec(template))) {
    if (match[0] === '%?') {
      prompts.push({ prompt: 'Text', default: '', completions: [] });
    } else {
      const parts = match[1].split('|');
      prompts.push({
        prompt: parts[0] || '',
        default: parts.length > 1 ? parts[1] : '',
        completions: parts.slice(2),
      });
    }
  }
  return prompts;
}

// ---- expansion -------------------------------------------------------

/**
 * Expands `template` against `context`:
 *   now             -- Date to use for %<FORMAT>/%t/%T/%u/%U (defaults to
 *                       the actual current moment; a caller passing a
 *                       fixed Date makes this deterministic for testing)
 *   promptAnswers    -- array of strings, matched to %^{...} AND bare %?
 *                       occurrences IN ORDER (the same order scanPrompts
 *                       returns them in) — not matched by prompt text,
 *                       since two prompts can legitimately share the
 *                       same wording
 *   tableRowNumber   -- substituted for @# (real org's own table-formula
 *                       row-number constant, not an invented specifier);
 *                       omitted/null becomes ''. @# also supports a
 *                       simple offset -- @# + 3 or @# - 2 (whitespace
 *                       around the operator optional either way)
 *                       evaluates to tableRowNumber plus/minus that
 *                       integer, still '' if tableRowNumber itself is
 *                       unset.
 *
 * Returns { text } — a bare %? is just another prompt answer
 * substituted directly into the text now (see scanPrompts' own docs for
 * why), so there's no separate cursor position left to report.
 */
function expandTemplate(template, context = {}) {
  const now = context.now instanceof Date ? context.now : new Date();
  const promptAnswers = context.promptAnswers || [];
  const tableRowNumber = context.tableRowNumber;

  const hhmm = pad(now.getHours()) + ':' + pad(now.getMinutes());
  const TOKEN_RE = /%%|%<([^>]*)>|%\^\{([^}]*)\}|%[tTuU?]|@#(?:\s*([+-])\s*(\d+))?/g;

  let result = '';
  let lastIndex = 0;
  let promptIndex = 0;
  let match;

  while ((match = TOKEN_RE.exec(template))) {
    result += template.slice(lastIndex, match.index);
    lastIndex = TOKEN_RE.lastIndex;
    const token = match[0];

    if (token === '%%') {
      result += '%';
    } else if (token.startsWith('%<')) {
      result += formatTime(now, match[1]);
    } else if (token.startsWith('%^{')) {
      const answer = promptAnswers[promptIndex];
      result += answer !== undefined && answer !== null ? answer : '';
      promptIndex += 1;
    } else if (token === '%t') {
      result += formatOrgTimestamp({ date: now, active: true });
    } else if (token === '%T') {
      result += formatOrgTimestamp({ date: now, active: true, time: hhmm });
    } else if (token === '%u') {
      result += formatOrgTimestamp({ date: now, active: false });
    } else if (token === '%U') {
      result += formatOrgTimestamp({ date: now, active: false, time: hhmm });
    } else if (token.startsWith('@#')) {
      if (tableRowNumber === undefined || tableRowNumber === null) {
        result += '';
      } else {
        const sign = match[3];
        const offset = match[4];
        const n = sign && offset ? Number(sign + offset) : 0;
        result += String(tableRowNumber + n);
      }
    } else if (token === '%?') {
      const answer = promptAnswers[promptIndex];
      result += answer !== undefined && answer !== null ? answer : '';
      promptIndex += 1;
    }
  }
  result += template.slice(lastIndex);

  return { text: result };
}

// ---- (file+olp "" "heading 1" "heading n") target resolution -------------

/**
 * Resolves a (file+olp file olpPath...) target within `doc`: walks the
 * outline path by heading title (exact match, case-sensitive — matching
 * real org's own behavior), creating any missing heading along the way
 * as an empty heading at the appropriate depth, and returns the final
 * (deepest) heading — the actual insertion point.
 *
 * `file` is accepted for API-shape parity with real org's (file+olp ...)
 * but otherwise unused: this app edits one open document at a time, so
 * "" (current file) is the only meaningful value here — a non-empty file
 * would mean "some other, not-currently-open document", which isn't
 * something a single-document capture flow can resolve.
 *
 * Each segment of the path is itself expanded for %<FORMAT> (and only
 * %<FORMAT> -- %^{...} prompts, @#, %t/%T/%u/%U don't have an obvious
 * meaning as part of a heading you're navigating TO rather than content
 * you're inserting, so they're deliberately not supported here), which
 * is what lets a template target a heading like the current month
 * ("2026-07") without the person needing to create it by hand first.
 *
 * `prepend`: when true, any heading actually auto-created along the way
 * (a segment that didn't already exist) becomes the FIRST child of its
 * own parent (or the first top-level heading, for the first segment)
 * instead of the last -- applied independently at each level a new
 * heading gets created. An already-existing segment is matched and
 * reused as-is regardless of this setting; there's no heading-creation
 * decision to make for something that's already there.
 */
function resolveOlpTarget(doc, olpPath, { now, prepend = false } = {}) {
  const at = now instanceof Date ? now : new Date();
  let siblings = doc.children;
  let parent = null;
  let found = null;

  for (const rawSegment of olpPath) {
    const wrapped = /^%<(.*)>$/.exec(rawSegment);
    const title = wrapped ? formatTime(at, wrapped[1]) : rawSegment;
    found = siblings.find((h) => h.title === title);
    if (!found) {
      found = parent ? insertChildHeading(parent, { title }, prepend) : insertTopLevelHeading(doc, { title }, prepend);
    }
    parent = found;
    siblings = found.children;
  }

  return found;
}

// ---- insertion, dispatched by capture type -------------------------------

/**
 * Merges a parsed fragment (from parseOrg on already-expanded template
 * text) into `target`: if the fragment produced any headings, they're
 * appended (or, if `prepend` is true, prepended -- real org's own
 * :prepend t capture-template property) as target's children with
 * their levels offset to nest correctly underneath it (a fragment
 * heading's level is relative to itself, starting at 1, same as any
 * standalone document); otherwise (a fragment with no headings at all
 * -- just paragraphs/lists/tables) its body content is appended (or
 * prepended) to target's own body directly.
 */
function mergeFragmentInto(target, fragment, prepend = false) {
  if (fragment.children.length > 0) {
    const offset = target.level;
    const applyOffset = (headings) => {
      for (const h of headings) {
        h.level += offset;
        applyOffset(h.children);
      }
    };
    applyOffset(fragment.children);
    if (prepend) {
      target.children.unshift(...fragment.children);
    } else {
      target.children.push(...fragment.children);
    }
    target.collapsed = false;
  } else {
    if (prepend) {
      target.bodyLines.unshift(...fragment.bodyLines);
    } else {
      target.bodyLines.push(...fragment.bodyLines);
    }
    target.body = parseBody(target.bodyLines);
  }
}

/**
 * Inserts already-expanded capture content into `target`, dispatched by
 * `type` (real org's own capture types):
 *   'item'       -- a plain bullet list item (the bullet itself, "- ",
 *                   is NOT part of the template string — org's item type
 *                   supplies it, matching the corrected example
 *                   templates in the request, which removed the manual
 *                   "- " prefix from the bullet-list template for this
 *                   exact reason)
 *   'checkitem'  -- a checkbox list item ("- [ ] ..."), same reasoning:
 *                   the "[ ]" is supplied by the type, not the template
 *   'plain'      -- the expanded text inserted verbatim, parsed as its
 *                   own org fragment and merged (see mergeFragmentInto)
 *                   -- this is the only type that can itself contain
 *                   heading syntax, properties drawers, TODO keywords,
 *                   etc., since it's the type real org uses for exactly
 *                   that (see the Meeting example)
 *   'table-line' -- one row appended to the nearest existing table under
 *                   target, or a brand new table created from this row
 *                   if target has none yet
 */
/** Splits a table row line ("| a | b | c |") into trimmed cells, the same
 *  way body-parser.js's own (module-private) parseTableRow does — not
 *  imported from there since it isn't exported, but simple enough to
 *  not need its own module either. */
function splitTableRowLine(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

/** Finds the last (most recently added) table in a heading's body, or
 *  null if it has none. Used to re-locate the target table by position
 *  after every mutating call, since body-edit.js's commitLines fully
 *  re-parses heading.body on each call — any table object reference
 *  held from before that call is immediately stale afterward (this is
 *  documented in body-edit.js itself: "table must be a fresh reference
 *  from the current render"), so it can't be reused across a sequence
 *  of mutations the way a naive loop might assume. */
function lastTableIn(heading) {
  for (let i = heading.body.length - 1; i >= 0; i--) {
    if (heading.body[i].type === 'table') return heading.body[i];
  }
  return null;
}

/** The first table in a heading's body -- lastTableIn's own mirror,
 *  needed because a :prepend capture puts new content at the START of
 *  target.body, so the just-inserted (or just-extended) table is now
 *  the first one there, not the last. */
function firstTableIn(heading) {
  for (const node of heading.body) {
    if (node.type === 'table') return node;
  }
  return null;
}

/** Finds the last item in the last list of a heading's body -- the
 *  list-item equivalent of lastTableIn, for the same reason: after
 *  mergeFragmentInto (which goes through no commitLines call, so no
 *  staleness risk there, but heading.body is still freshest read fresh
 *  right after the merge rather than trusting an intermediate reference). */
function lastListItemIn(heading) {
  for (let i = heading.body.length - 1; i >= 0; i--) {
    const node = heading.body[i];
    if (node.type === 'list' && node.items.length > 0) return node.items[node.items.length - 1];
  }
  return null;
}

/** The first item of the first list in a heading's body --
 *  lastListItemIn's own mirror, for the same :prepend reason
 *  firstTableIn exists: prepending puts the new item at the very
 *  start, so it's now the first item of the first list, not the last
 *  item of the last one. */
function firstListItemIn(heading) {
  for (const node of heading.body) {
    if (node.type === 'list' && node.items.length > 0) return node.items[0];
  }
  return null;
}

/**
 * Inserts already-expanded capture content into `target`, dispatched by
 * `type` (real org's own capture types):
 *   'item'       -- a plain bullet list item (the bullet itself, "- ",
 *                   is NOT part of the template string — org's item type
 *                   supplies it, matching the corrected example
 *                   templates in the request, which removed the manual
 *                   "- " prefix from the bullet-list template for this
 *                   exact reason)
 *   'checkitem'  -- a checkbox list item ("- [ ] ..."), same reasoning:
 *                   the "[ ]" is supplied by the type, not the template
 *   'plain'      -- the expanded text inserted verbatim, parsed as its
 *                   own org fragment and merged (see mergeFragmentInto)
 *                   -- this is the only type that can itself contain
 *                   heading syntax, properties drawers, TODO keywords,
 *                   etc., since it's the type real org uses for exactly
 *                   that (see the Meeting example)
 *   'table-line' -- one row appended to the nearest existing table under
 *                   target, or a brand new table created from this row
 *                   if target has none yet
 *
 * `prepend` (real org's own :prepend t capture-template property) puts
 * the new content at the START of target instead of the end, for every
 * type. For table-line specifically, prepending with an existing table
 * inserts right after any leading rule row (so the new row lands as
 * the first DATA row, not literally above the header) rather than at
 * index 0 unconditionally; a brand-new table has nothing to prepend
 * relative to, so prepend doesn't change that case.
 *
 * item/checkitem/plain all go through the same parse-a-fragment-and-merge
 * path (see mergeFragmentInto) rather than body-edit.js's insertListItem,
 * deliberately: insertListItem requires an existing list item to insert
 * after, which a capture target may well not have yet (a heading that's
 * never been captured into before has no list at all) — parsing the
 * (one-line, for these two types) fragment and merging handles "no list
 * yet" and "list already exists, extend it" the same way, uniformly,
 * without needing to detect and branch on which case applies.
 */
function insertCapture(target, type, expandedText, prepend = false) {
  if (type === 'item') {
    const fragment = parseOrg('- ' + expandedText);
    mergeFragmentInto(target, fragment, prepend);
    return prepend ? firstListItemIn(target) : lastListItemIn(target);
  }

  if (type === 'checkitem') {
    const fragment = parseOrg('- [ ] ' + expandedText);
    mergeFragmentInto(target, fragment, prepend);
    return prepend ? firstListItemIn(target) : lastListItemIn(target);
  }

  if (type === 'table-line') {
    const cells = splitTableRowLine(expandedText);
    let table = prepend ? firstTableIn(target) : lastTableIn(target);

    if (table) {
      const hasLeadingRule = table.rows[1] && table.rows[1].type === 'rule';
      const insertAfterIndex = prepend ? (hasLeadingRule ? 1 : -1) : table.rows.length - 1;
      const newRowIndex = insertAfterIndex + 1;
      insertTableRow(target, table, insertAfterIndex);
      table = prepend ? firstTableIn(target) : lastTableIn(target); // re-fetch: insertTableRow's commitLines just re-parsed target.body
      for (let i = 0; i < cells.length; i++) {
        setTableCell(target, table, newRowIndex, i, cells[i]);
        table = prepend ? firstTableIn(target) : lastTableIn(target); // re-fetch after every cell too, same reason
      }
    } else {
      let newTable = insertTable(target, { rows: 1, cols: cells.length || 1 });
      for (let i = 0; i < cells.length; i++) {
        setTableCell(target, newTable, 0, i, cells[i]);
        newTable = lastTableIn(target);
      }
    }
    return prepend ? firstTableIn(target) : lastTableIn(target);
  }

  // 'plain' (and the fallback for anything unrecognized -- inserting the
  // text verbatim is a safer default than silently discarding it)
  const fragment = parseOrg(expandedText);
  const producedHeadings = fragment.children.length > 0;
  mergeFragmentInto(target, fragment, prepend);
  if (!producedHeadings) return null;
  return prepend ? target.children[0] : target.children[target.children.length - 1];
}

/**
 * Resolves a capture template's `file` field to an actual target file
 * id, given the current document's own id. A path containing "/" is
 * used as-is (already a fully-qualified path for whatever backend is
 * active); a bare filename with no "/" is placed in the same directory
 * as the current document (a sibling file) -- the closest equivalent
 * this app's simpler, backend-agnostic file-id space has to real org's
 * own org-directory-relative resolution for a capture template's file
 * target. A blank/unset `file` resolves to the current document
 * itself, matching a template with no file target at all (real org's
 * `(file+olp ...)` with no file argument capturing into the buffer
 * you're currently in).
 */
function resolveCaptureFileId(file, currentFileId) {
  const trimmed = String(file || '').trim();
  if (!trimmed) return currentFileId;
  if (trimmed.includes('/')) return trimmed;
  const lastSlash = currentFileId.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : currentFileId.slice(0, lastSlash + 1);
  return dir + trimmed;
}

export {
  formatTime,
  scanPrompts,
  expandTemplate,
  resolveOlpTarget,
  mergeFragmentInto,
  insertCapture,
  resolveCaptureFileId,
};
