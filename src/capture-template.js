// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
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

import { placeInsertedText, sharedAnnotation } from './capture-shared.js';
import { makeLinkString } from './link-string.js';
import { formatOrgTimestamp } from './org-timestamp.js';
import { formatTimeString } from './format-time.js';
import { parseOrg } from './org-parser.js';
import { insertTopLevelHeading, insertChildHeading } from './heading-edit.js';
import { commitLines, fixTableFormulas, serializeTable } from './body-edit.js';
import { findLists, listAt, renumber } from './list-edit.js';
import { parseBody } from './body-parser.js';

// ---- %<FORMAT> (format-time-string) ---------------------------------------

/** @param {Date} date @param {string} format */
function formatTime(date, format) {
  return formatTimeString(date, format);
}

// ---- template expansion ---------------------------------------------
//
// The expansion follows org-capture-fill-template: a first pass for the
// non-interactive escapes (%t %a %n %<...> %:key ...), a second for the
// interactive ones (%^{Prompt}, %^g, %^C, %^t ...), a third for %\N, and
// a cleanup of the result. A run of backslashes before a % escapes it
// (org-capture-escaped-%): n backslashes lose (n+1)/2 of them, and the %
// stays literal when n is odd.

/** The four timestamp-prompt letters: active or inactive, date only or with a time. */
const TIMESTAMP_PROMPT_KINDS = {
  t: { active: true, hasTime: false, label: 'Date' },
  T: { active: true, hasTime: true, label: 'Date & time' },
  u: { active: false, hasTime: false, label: 'Date' },
  U: { active: false, hasTime: true, label: 'Date & time' },
};

const PLAIN_ESCAPE_RE = /%(:[-A-Za-z]+|<([^>\n]+)>|[aAcfFikKlLntTuUx])|@#(?:\s*([+-])\s*(\d+))?/g;
const PROMPT_ESCAPE_RE = /%\^(?:\{([^}]*)\})?([CgGLptTuU])?|%\?/g;
const BACKREF_RE = /%\\([1-9][0-9]*)/g;
const LINK_RE = /\[\[(.*?)\](\[.*?\])?\]/;
const TAGS_COLUMN = 77;

/** @typedef {{ buf: string, pos: number }} Cursor */

/** Inserts `text` at the cursor and moves past it. @param {Cursor} st @param {string} text */
function insertAt(st, text) {
  st.buf = st.buf.slice(0, st.pos) + text + st.buf.slice(st.pos);
  st.pos += text.length;
}

/**
 * Finds each match of `re` at or after the cursor, applies the backslash rule, and for an unescaped one removes the
 * match and calls `handle` with the cursor where it stood. `handle` inserts the replacement.
 * @param {Cursor} st @param {RegExp} re @param {(m: RegExpExecArray, st: Cursor) => void} handle
 * @param {boolean} [escapable] false for a token that backslashes do not escape
 */
function sweep(st, re, handle, escapable = true) {
  for (;;) {
    re.lastIndex = st.pos;
    const m = re.exec(st.buf);
    if (!m) return;
    let start = m.index;
    let end = start + m[0].length;
    if (escapable && !m[0].startsWith('@#')) {
      let n = 0;
      while (n < start && st.buf[start - 1 - n] === '\\') n++;
      const cut = Math.floor((n + 1) / 2);
      st.buf = st.buf.slice(0, start - n) + st.buf.slice(start - n + cut);
      start -= cut;
      end -= cut;
      if (n % 2 === 1) {
        st.pos = end;
        continue;
      }
    }
    st.buf = st.buf.slice(0, start) + st.buf.slice(end);
    st.pos = start;
    handle(m, st);
  }
}

/** Right-aligns the tags at the end of a heading line the way org-align-tags does. @param {string} line */
function alignHeadingTags(line) {
  const m = /^(\*+\s+)(.*?)\s*(:[\w@#%]+(?::[\w@#%]+)*:)\s*$/.exec(line);
  if (!m) return line;
  const head = (m[1] + m[2]).replace(/\s+$/, '');
  const pad = Math.max(1, TAGS_COLUMN - head.length - m[3].length);
  return head + ' '.repeat(pad) + m[3];
}

/** Replaces each tab with spaces up to the next multiple of eight columns. @param {string} text */
function untabify(text) {
  return text
    .split('\n')
    .map((line) => {
      let out = '';
      for (const ch of line) out += ch === '\t' ? ' '.repeat(8 - (out.length % 8)) : ch;
      return out;
    })
    .join('\n');
}

/**
 * The tidy-up that ends org-capture-fill-template: no blank lines before the text, one newline at the end (or an
 * empty string), tabs expanded.
 * @param {string} text
 */
function cleanupExpanded(text) {
  const first = text.search(/[^ \t\n]/);
  if (first === -1) return '';
  const lineStart = text.lastIndexOf('\n', first - 1) + 1;
  const body = text.slice(lineStart).replace(/[ \t\n]+$/, '');
  return untabify(body) + '\n';
}

/** @param {string | null | undefined} value @param {boolean} active @param {boolean} hasTime @param {Date} now */
function promptedTimestamp(value, active, hasTime, now) {
  const text = (value || '').trim();
  if (/^[<[]/.test(text)) return text;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d\d))?$/.exec(text);
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(now.getTime());
  let time = null;
  if (m && m[4] !== undefined) time = String(m[4]).padStart(2, '0') + ':' + m[5];
  else if (hasTime) time = formatTime(now, '%H:%M');
  return formatOrgTimestamp(time ? { date, active, time } : { date, active });
}

/**
 * What the template sees besides the clock. Content shared into the app supplies `initial` and the annotation
 * unless they are given directly.
 * @param {any} context
 */
function templateValues(context) {
  const now = context.now instanceof Date ? context.now : new Date();
  const shared = context.shared || null;
  const clipboard = typeof context.clipboard === 'string' && context.clipboard !== '' ? context.clipboard : null;
  const killRing = typeof context.killRing === 'string' ? context.killRing : clipboard;
  const initial = typeof context.initial === 'string' ? context.initial : (shared && shared.text) || '';
  let annotation = typeof context.annotation === 'string' ? context.annotation : shared ? sharedAnnotation(shared) : '';
  if (annotation === '[[]]') annotation = '';
  const linkMatch = LINK_RE.exec(annotation);
  const clock = context.clock || null;
  const originalFile = context.originalFile || '';
  /** @type {Record<string, string>} */
  const props = { ':annotation': annotation, ':initial': initial };
  if (shared && shared.url) {
    props[':link'] = shared.url;
    if (shared.title) props[':description'] = shared.title;
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(shared.url);
    if (scheme) props[':type'] = scheme[1].toLowerCase();
  }
  Object.assign(props, context.linkProps || {});
  const stamp = (/** @type {boolean} */ active, /** @type {boolean} */ withTime) =>
    formatOrgTimestamp(withTime ? { date: now, active, time: formatTime(now, '%H:%M') } : { date: now, active });
  return {
    now,
    t: stamp(true, false),
    T: stamp(true, true),
    u: stamp(false, false),
    U: stamp(false, true),
    c: killRing || '',
    x: clipboard || '',
    i: initial,
    a: annotation,
    A: linkMatch ? annotation.replace(LINK_RE, '[[$1][%^{Link description}]]') : annotation,
    l: linkMatch ? annotation.replace(LINK_RE, '[[$1]]') : annotation,
    L: linkMatch ? annotation.replace(LINK_RE, '$1') : annotation,
    n: typeof context.userFullName === 'string' ? context.userFullName : '',
    k: clock ? clock.heading : '',
    K: clock ? makeLinkString(`${clock.file}::*${clock.heading}`, clock.heading) : '',
    f: originalFile ? originalFile.slice(originalFile.lastIndexOf('/') + 1) : '',
    F: originalFile,
    props,
    /** what %^C and %^L choose from: the initial content, then the clipboards */
    clipboards: [initial, ...(clipboard !== null ? [clipboard] : []), ...(typeof context.killRing === 'string' ? [context.killRing] : [])],
    tableRowNumber: context.tableRowNumber,
  };
}

/**
 * Runs the three expansion passes. `answers` are matched to the interactive placeholders in the order they appear in
 * the pass-one result; a missing answer is the placeholder's default. Returns the text (before the final cleanup)
 * and the placeholders found, which is what a caller asks the person about.
 * @param {string} template @param {any} context @param {string[]} answers
 */
function runExpansion(template, context, answers) {
  const v = templateValues(context);
  /** @type {Cursor} */
  const st = { buf: template, pos: 0 };

  sweep(st, PLAIN_ESCAPE_RE, (m, cur) => {
    if (m[0].startsWith('@#')) {
      if (v.tableRowNumber === undefined || v.tableRowNumber === null) return;
      insertAt(cur, String(v.tableRowNumber + (m[3] && m[4] ? Number(m[3] + m[4]) : 0)));
      return;
    }
    const key = m[1][0];
    if (key === '<') insertAt(cur, formatTime(v.now, m[2]));
    else if (key === ':') insertAt(cur, v.props[m[1]] || '');
    else if (key === 'i') {
      const lead = cur.buf.slice(cur.buf.lastIndexOf('\n', cur.pos - 1) + 1, cur.pos);
      insertAt(cur, placeInsertedText(v.i, lead));
    } else if (key === 'x' || key === 'c') {
      const lead = cur.buf.slice(cur.buf.lastIndexOf('\n', cur.pos - 1) + 1, cur.pos);
      insertAt(cur, placeInsertedText(key === 'x' ? v.x : v.c, lead));
    } else insertAt(cur, /** @type {any} */ (v)[key]);
  });

  st.pos = 0;
  /** @type {any[]} */ const prompts = [];
  /** @type {string[]} */ const strings = [];
  const answerFor = (/** @type {string} */ fallback) => {
    const given = answers[prompts.length - 1];
    return given === undefined || given === null || given === '' ? fallback : String(given);
  };
  sweep(st, PROMPT_ESCAPE_RE, (m, cur) => {
    if (m[0] === '%?') {
      prompts.push({ kind: 'text', prompt: 'Text', default: '', completions: [] });
      const given = answers[prompts.length - 1];
      insertAt(cur, given === undefined || given === null ? '' : String(given));
      return;
    }
    const items = m[1] !== undefined ? m[1].split('|') : [];
    const label = items[0];
    const dflt = items[1];
    const completions = items.slice(2);
    const key = m[2];
    if (key === 'p') {
      insertAt(cur, m[0]); // property prompts are not supported; the text stays as written
      return;
    }
    if (key === 'C' || key === 'L') {
      if (v.clipboards.length === 1) {
        insertAt(cur, key === 'C' ? v.clipboards[0] : v.clipboards[0].trim() ? makeLinkString(v.clipboards[0]) : '');
        return;
      }
      prompts.push({ kind: 'clipboard', prompt: 'Clipboard/kill value', default: v.clipboards[0], completions: [] });
      const value = answerFor(v.clipboards[0]);
      insertAt(cur, key === 'C' || !value.trim() ? value : makeLinkString(value));
      return;
    }
    if (key === 'g' || key === 'G') {
      prompts.push({ kind: 'tags', prompt: label ? label : 'Tags', default: '', completions: [] });
      const given = answers[prompts.length - 1];
      const ins = String(given ?? '').split(/[ \t]*:[ \t]*/).join(':');
      if (ins.trim() === '') return;
      if (cur.buf[cur.pos - 1] !== ':') insertAt(cur, ':');
      insertAt(cur, ins);
      if (cur.buf[cur.pos] !== ':') insertAt(cur, ':');
      const lineStart = cur.buf.lastIndexOf('\n', cur.pos - 1) + 1;
      let lineEnd = cur.buf.indexOf('\n', cur.pos);
      if (lineEnd === -1) lineEnd = cur.buf.length;
      const line = cur.buf.slice(lineStart, lineEnd);
      if (/^\*+ /.test(line)) {
        const aligned = alignHeadingTags(line);
        const rest = line.slice(cur.pos - lineStart);
        cur.buf = cur.buf.slice(0, lineStart) + aligned + cur.buf.slice(lineEnd);
        cur.pos = lineStart + aligned.length - (aligned.endsWith(rest) ? rest.length : 0);
      }
      return;
    }
    if (key) {
      const kind = /** @type {any} */ (TIMESTAMP_PROMPT_KINDS)[key];
      prompts.push({
        kind: 'timestamp',
        prompt: label !== undefined && label !== '' ? label : kind.label,
        default: '',
        completions: [],
        timestamp: { active: kind.active, hasTime: kind.hasTime },
      });
      insertAt(cur, promptedTimestamp(answers[prompts.length - 1], kind.active, key === 'T' || key === 'U' || kind.hasTime, v.now));
      return;
    }
    prompts.push({ kind: 'string', prompt: label !== undefined ? label : 'Enter string', default: dflt || '', completions });
    const value = answerFor(dflt || '');
    strings.push(value);
    insertAt(cur, value);
  });

  st.pos = 0;
  sweep(st, BACKREF_RE, (m, cur) => {
    const n = Number(m[1]);
    if (n > strings.length) throw new Error(`The template refers to %\\${n}, but it has ${strings.length} %^{...} prompt${strings.length === 1 ? '' : 's'}.`);
    insertAt(cur, strings[n - 1]);
  });
  return { text: st.buf, prompts };
}

/**
 * The placeholders in `template` that need an answer, in the order they are asked: every %^{Prompt}, %^g, %^C,
 * %^t (and the other timestamp letters), and %? (which this app asks for like any other prompt). Each is
 * `{ kind, prompt, default, completions, timestamp? }`; `kind` is 'string', 'tags', 'clipboard', 'timestamp' or 'text'.
 * `context` is the one expandTemplate takes, because %A and %^C add or drop prompts depending on what was shared.
 * @param {string} template
 */
function scanPrompts(template, context = {}) {
  return runExpansion(template, context, []).prompts;
}

/**
 * Expands `template` the way org-capture-fill-template does. `context`:
 *   now             -- the Date for %t %T %u %U and %<FORMAT> (default: now)
 *   promptAnswers   -- strings, one per placeholder scanPrompts returns, in that order; a missing or empty answer
 *                       to a %^{Prompt|default} is its default
 *   tableRowNumber  -- @# (and @# + 3, @# - 2), or '' when not given
 *   shared          -- { title, text, url } shared into the app; supplies %i, %a and %:link
 *   clipboard       -- %x, and the clipboard choice for %^C and %^L
 *   initial, annotation, killRing, userFullName, originalFile,
 *   clock: { heading, file }, linkProps -- %i, %a, %c, %n, %f %F, %k %K, %:key
 *
 * Returns { text }: no blank lines before the text and a single newline at the end, or '' when nothing is left.
 * Throws when %\N names a prompt the template does not have.
 * @param {string} template
 */
function expandTemplate(template, context = {}) {
  const { text } = runExpansion(template, context, /** @type {any} */ (context).promptAnswers || []);
  return { text: cleanupExpanded(text) };
}

/** Expands a capture template's own preText/template/postText fields
 *  together, as if they were one continuous template string, so
 *  %^{...} prompts and %\N backreferences are numbered/resolved
 *  consistently across all three pieces. The combined string is
 *  expanded once, then split back into its pieces on a sentinel that
 *  never reaches the document. The main text gets the same cleanup
 *  expandTemplate applies; preText and postText only have their tabs
 *  expanded.
 *
 *  Returns { preText, text, postText }.
 * @param {any} preText
 * @param {string} template
 * @param {any} [postText]
 */
function expandCaptureText(preText, template, postText, context = {}) {
  const SENTINEL = '\x01\x02CAPTURE_SPLIT\x02\x01';
  const combined = (preText || '') + SENTINEL + template + SENTINEL + (postText || '');
  const { text } = runExpansion(combined, context, /** @type {any} */ (context).promptAnswers || []);
  const [pre, main, post] = text.split(SENTINEL);
  return { preText: untabify(pre), text: cleanupExpanded(main), postText: untabify(post) };
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
 *
 * `allowCreate` (default true): when false, a missing segment is
 * NEVER created -- resolution stops immediately and returns null,
 * leaving `doc` completely untouched. Every existing caller (capture
 * templates, archive, refile, restore) relies on the default,
 * unchanged, always-create behavior; this exists specifically for
 * org-xx-extra-menu's own OLP navigation entries, which should never
 * silently create headings just from browsing a quick-access menu --
 * see runExtraMenuEntry in app.js.
 * `unique` (default false): when true, two sibling headings of one title are an error ("Heading not unique on level N: TITLE"), as in
 * Emacs's file+olp; false takes the first.
 * @param {Doc} doc @param {any} olpPath @param {{ now?: Date, prepend?: boolean, allowCreate?: boolean, unique?: boolean }} [options]
 */
function resolveOlpTarget(doc, olpPath, { now, prepend = false, allowCreate = true, unique = false } = {}) {
  const at = now instanceof Date ? now : new Date();
  let siblings = doc.children;
  let parent = null;
  /** @type {any} */
  let found = null;

  let depth = 0;
  for (const rawSegment of olpPath) {
    depth++;
    const wrapped = /^%<(.*)>$/.exec(rawSegment);
    const title = wrapped ? formatTime(at, wrapped[1]) : rawSegment;
    if (unique && siblings.filter((h) => h.title === title).length > 1) throw new Error(`Heading not unique on level ${depth}: ${title}`);
    found = siblings.find((h) => h.title === title);
    if (!found) {
      if (!allowCreate) return null;
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
 * @param {any} [target]
 * @param {any} [fragment]
 */
function mergeFragmentInto(target, fragment, prepend = false) {
  if (fragment.children.length > 0) {
    const offset = target.level || 0; // a file's top level has none
    /** @param {Heading[]} headings */
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

/** Splits a table row line ("| a | b | c |") into trimmed cells, the same
 *  way body-parser.js's own (module-private) parseTableRow does — not
 *  imported from there since it isn't exported, but simple enough to
 * @param {string} line
 *  not need its own module either. */
function splitTableRowLine(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

/** A vCard-style (or any KEY:value-shaped) plain body line whose own
 *  value is empty -- everything after the colon is nothing but
 *  whitespace and/or semicolons. Semicolons specifically, not just
 *  whitespace, because vCard's own multi-field properties (N, ADR)
 *  keep their own structural separators in the template regardless of
 *  which individual %^{...} fields were filled in -- "ADR;TYPE=home:
 *  ;;;;;;" with every field left blank is still, semantically, an
 *  entirely empty entry, even though literal semicolons remain. */
const EMPTY_BODY_LINE_RE = /^[A-Za-z][A-Za-z0-9_-]*(;[^:\n]*)?:[;\s]*$/;

/** A trailing, entirely empty tag list on a heading's own title --
 *  "Title ::" specifically, not "Title :tag:". Real org's own tag
 *  syntax requires at least one real tag between the colons, so an
 *  empty one (every %^{...} tag prompt left blank) is never
 *  recognized as a tag list at all by the parser -- it falls back to
 *  being kept as plain, literal title text instead, which is exactly
 *  what this strips back out. A tag list with at least one real tag
 *  mixed among empty ones needs no help here: the parser already
 *  collapses "Title :Work::Home:" to tags ["Work", "Home"] on its
 *  own, with the title cleaned up correctly, before this ever runs. */
const EMPTY_TRAILING_TAG_RE = /\s+:{2,}$/;

/** Removes every property from `heading` (and, recursively, every
 *  descendant heading) whose own value is empty or whitespace-only,
 *  every plain body line whose own value is empty in the same sense
 *  (see EMPTY_BODY_LINE_RE), and an empty trailing tag from the
 *  heading's own title (see EMPTY_TRAILING_TAG_RE) -- together, the
 *  omitEmptyEntries capture-template option's own full
 *  implementation, covering both ways a template can represent its
 *  own fields (a real :PROPERTIES: drawer, or plain body text lines
 *  -- e.g. raw vCard content, matching the same shape this app's own
 *  vCard export already produces for its own "new buffer"
 *  destination). Mutates heading.properties/propertyOrder (the same
 *  two structures a property removal always needs to keep in sync,
 *  see src/archive-model.js's own deleteProperty for the same
 *  pattern, reimplemented locally here rather than imported, since
 *  this module's own template-expansion half is deliberately
 *  self-contained and dependency-free), heading.bodyLines/body (the
 *  same two structures every other body edit in this app keeps in
 * @param {Heading} heading
 *  sync with each other), and heading.title. */
function stripEmptyProperties(heading) {
  for (const key of [...heading.propertyOrder]) {
    if (!String(heading.properties[key] ?? '').trim()) {
      delete heading.properties[key];
      heading.propertyOrder = heading.propertyOrder.filter((k) => k !== key);
    }
  }
  const keptLines = heading.bodyLines.filter((/** @type {string} */ line) => !EMPTY_BODY_LINE_RE.test(line));
  if (keptLines.length !== heading.bodyLines.length) {
    heading.bodyLines = keptLines;
    heading.body = parseBody(heading.bodyLines);
  }
  heading.title = heading.title.replace(EMPTY_TRAILING_TAG_RE, '');
  for (const child of heading.children || []) stripEmptyProperties(child);
}

/** @typedef {import('./types.js').Heading | import('./types.js').Doc} Host a heading, or a file's top level */
/** @typedef {import('./types.js').Table} Table */
/** The blank lines around filed text, the table row to use, whether a new table gets a header, and `recalculate`, which works out a table's #+TBLFM after a row is added.
 *  @typedef {{ emptyLines?: number, emptyLinesBefore?: number, emptyLinesAfter?: number, tableLinePos?: string, tableHeader?: boolean, recalculate?: (table: Table) => import('./types.js').TableRow[] | null }} PlaceOptions */
const BLANK = (/** @type {string} */ l) => l.trim() === '';
const ITEM_START_RE = /^[ \t]*(?:[-+]|\d+[.)])(?:[ \t]|$)/;

/** The last node whose own lines come before whatever follows `node`'s subtree.
 * @param {Host} node @returns {Host} */
function lastNodeOf(node) {
  let n = node;
  while (n.children && n.children.length) n = n.children[n.children.length - 1];
  return n;
}

/** The nodes a capture looks in: the heading's own text, or for a file's top level every node in file order.
 * @param {Host} target @returns {Host[]} */
function hostNodes(target) {
  if (target.level) return [target];
  /** @type {Host[]} */ const out = [];
  const walk = (/** @type {Host} */ n) => {
    out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(target);
  return out;
}

/** `org-capture-empty-lines-before`: the blank lines that end at `at` become `n`; returns where the text goes.
 * @param {string[]} lines @param {number} at @param {number} n */
function blanksBefore(lines, at, n) {
  let a = at;
  while (a > 0 && BLANK(lines[a - 1])) a--;
  lines.splice(a, at - a, ...Array(n).fill(''));
  return a + n;
}

/** `org-capture-empty-lines-after`: the blank lines around `at`, just past the inserted text, become `n`.
 * @param {string[]} lines @param {number} at @param {number} n */
function blanksAfter(lines, at, n) {
  let a = at;
  while (a > 0 && BLANK(lines[a - 1])) a--;
  let z = at;
  while (z < lines.length && BLANK(lines[z])) z++;
  lines.splice(a, z - a, ...Array(n).fill(''));
}

/** The node's text ends in exactly `n` blank lines.
 * @param {Host} node @param {number} n */
function endWithBlanks(node, n) {
  const lines = node.bodyLines;
  let a = lines.length;
  while (a > 0 && BLANK(lines[a - 1])) a--;
  lines.splice(a, lines.length - a, ...Array(n).fill(''));
  node.body = parseBody(lines);
}

/** `org-end-of-meta-data` with FULL t: past blank lines, clock lines and drawers at the start of an entry's text (the
 *  planning line and the properties drawer are not among its lines).
 * @param {string[]} lines */
function afterMetaData(lines) {
  let i = 0;
  while (i < lines.length) {
    if (BLANK(lines[i]) || /^[ \t]*CLOCK:/.test(lines[i])) i++;
    else if (/^[ \t]*:[^\s:]+:[ \t]*$/.test(lines[i]) && !/^[ \t]*:END:[ \t]*$/i.test(lines[i])) {
      const end = lines.findIndex((l, k) => k > i && /^[ \t]*:END:[ \t]*$/i.test(l));
      if (end < 0) break;
      i = end + 1;
    } else break;
  }
  return i;
}

/** The blank lines to leave before and after what is filed (`:empty-lines-before`/`-after`, else `:empty-lines`, else 0).
 * @param {PlaceOptions} opts @returns {[number, number]} */
function emptyLinesOf(opts) {
  const num = (/** @type {unknown} */ v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined && v !== '' ? Math.max(0, Math.floor(Number(v))) : undefined);
  const both = num(opts.emptyLines);
  return [num(opts.emptyLinesBefore) ?? both ?? 0, num(opts.emptyLinesAfter) ?? both ?? 0];
}

/** Files heading text (`org-capture-place-entry`): a child of the target, first or last.
 * @param {Host} target @param {Heading[]} headings @param {boolean} prepend @param {number} before @param {number} after */
function placeHeadings(target, headings, prepend, before, after) {
  endWithBlanks(prepend ? target : lastNodeOf(target), before);
  if (prepend) target.children.unshift(...headings);
  else target.children.push(...headings);
  target.collapsed = false;
  endWithBlanks(lastNodeOf(headings[headings.length - 1]), after);
}

/** Files text that holds no heading (`org-capture-place-plain-text`): the end of the entry's own text, or its start past
 *  the meta data; for a file, its end or start.
 * @param {Host} target @param {string[]} text @param {boolean} prepend @param {number} before @param {number} after */
function placePlainText(target, text, prepend, before, after) {
  const top = !target.level;
  const host = !prepend && top ? lastNodeOf(target) : target;
  const lines = host.bodyLines;
  let at = prepend ? (top ? 0 : afterMetaData(lines)) : lines.length;
  at = blanksBefore(lines, at, before);
  lines.splice(at, 0, ...text);
  blanksAfter(lines, at + text.length, after);
  host.body = parseBody(lines);
}

/** @param {string} line */
function indentOf(line) {
  return /^[ \t]*/.exec(line)?.[0].replace(/\t/g, '        ').length ?? 0;
}

/** Files a list item (`org-capture-place-item`): into the first list of the entry's text (the file's text for a top
 *  level), else as a new list.
 * @param {Host} target @param {string} lead @param {string} text @param {boolean} prepend @param {number} before @param {number} after */
function placeItem(target, lead, text, prepend, before, after) {
  const body = text.replace(/^\s+|\s+$/g, '');
  const itemLines = (ITEM_START_RE.test(body) ? body : lead + body.split('\n').join('\n  ')).split('\n');
  /** @type {{ host: Host, list: ReturnType<typeof findLists>[number] } | null} */
  let found = null;
  for (const host of hostNodes(target)) {
    const lists = findLists(host.bodyLines);
    if (lists.length) {
      found = { host, list: lists[0] };
      break;
    }
  }
  if (!found) {
    // a file that starts with a heading has the new list in that heading's text; Emacs looks from the file's start
    const top = !target.level;
    const host = top ? (prepend ? (target.bodyLines.length === 0 && target.children.length ? target.children[0] : target) : lastNodeOf(target)) : target;
    const lines = host.bodyLines;
    let at = prepend ? 0 : lines.length;
    at = blanksBefore(lines, at, before);
    lines.splice(at, 0, ...itemLines);
    blanksAfter(lines, at + itemLines.length, after);
    host.body = parseBody(lines);
    return { host, line: at };
  }
  const { host, list } = found;
  const lines = host.bodyLines;
  const first = list.items[0];
  // Emacs indents a new last item like the list; one put first is not indented
  const indent = prepend ? 0 : indentOf(lines[first.line]);
  const placed = itemLines.map((l) => (indentOf(l) < indent ? ' '.repeat(indent - indentOf(l)) + l : l));
  let at = prepend ? list.start : list.end;
  if (!prepend) at = blanksBefore(lines, at, Math.min(1, before));
  lines.splice(at, 0, ...placed);
  if (prepend) blanksAfter(lines, at + placed.length, Math.min(1, after));
  host.bodyLines = repairList(lines, at, prepend && /^\d/.test(first.bullet) === /^[-+*]/.test(itemLines[0].trim()));
  host.body = parseBody(host.bodyLines);
  return { host, line: at };
}

/**
 * `org-list-repair` after an item is added at `line`: the items of its level take the first item's kind of bullet, and ordered
 * bullets are numbered again. `cycle` first turns a first item that is the other kind from its list into the list's kind.
 * @param {string[]} lines @param {number} line @param {boolean} cycle
 */
function repairList(lines, line, cycle) {
  let out = [...lines];
  const found = listAt(out, line);
  if (!found) return out;
  const items = found.list.items;
  const top = items.filter((it) => it.indent === items[found.index].indent && it.parent === items[found.index].parent);
  if (cycle && top.length > 1) {
    const ordered = /^\d/.test(top[1].bullet);
    out[line] = out[line].replace(/^([ \t]*)([-+*]|\d+[.)])/, (_m, sp) => sp + (ordered ? '1.' : '-'));
    top[0] = { ...top[0], bullet: ordered ? '1.' : '-' };
  }
  const lead = top[0].bullet;
  for (const it of top.slice(1)) {
    const bullet = /^\d/.test(lead) ? '1' + lead.slice(-1) : lead;
    out[it.line] = out[it.line].replace(/^([ \t]*)([-+*]|\d+[.)])/, (_m, sp) => sp + bullet);
  }
  if (/^\d/.test(lead)) out = renumber(out, line);
  return out;
}

/** @param {Host} host @returns {Table[]} */
function tablesOf(host) {
  return /** @type {Table[]} */ ((host.body || []).filter((n) => n.type === 'table'));
}

/** `commitLines` takes a heading; a file's top level has the same lines and body.
 * @param {Host} host @param {number} at @param {number} count @param {string[]} lines */
function commit(host, at, count, lines) {
  commitLines(/** @type {Heading} */ (host), at, count, lines);
}

/** @param {Host} target @returns {{ host: Host, table: Table } | null} */
function firstTableInFile(target) {
  for (const host of hostNodes(target)) {
    const table = tablesOf(host)[0];
    if (table) return { host, table };
  }
  return null;
}

/** Where a row goes in an existing table (`:table-line-pos`, else after the header rule when prepending, else the end).
 * @param {Table} table @param {boolean} prepend @param {string} [pos] */
function tableRowIndex(table, prepend, pos) {
  const rows = table.rows;
  const spec = pos ? /(I+)([-+][0-9]+)/.exec(pos) : null;
  if (spec) {
    const rules = rows.map((r, i) => (r.type === 'rule' ? i : -1)).filter((/** @type {number} */ i) => i >= 0);
    const count = spec[1].length;
    if (count > rules.length) throw new Error(`Invalid table line specification "${pos}"`);
    const delta = Number(spec[2]);
    // two forward-line moves from the table's start, each stopping at an end of the table
    return Math.min(rows.length, Math.max(0, rules[count - 1] + delta + (delta < 0 ? 0 : -1)) + 1);
  }
  if (prepend) {
    const rule = rows.findIndex((r) => r.type === 'rule');
    if (rule < 0) return 0;
    const next = rows.findIndex((r, i) => i > rule && r.type === 'row');
    return next >= 0 ? next : rows.length;
  }
  return rows.length;
}

/**
 * The number the captured row will have among the table's lines (what `@#` in a template stands for), rules not counted.
 * @param {Host} target @param {boolean} [prepend] @param {PlaceOptions} [opts]
 */
function plannedTableRow(target, prepend = false, opts = {}) {
  const found = firstTableInFile(target);
  if (!found) return opts.tableHeader === false ? 1 : 2;
  try {
    const k = tableRowIndex(found.table, prepend, opts.tableLinePos);
    return found.table.rows.slice(0, k).filter((r) => r.type === 'row').length + 1;
  } catch {
    return 1;
  }
}

/** Files a table row (`org-capture-place-table-line`): into the first table, or into a new one at the end of the text.
 * @param {Host} target @param {string} text @param {boolean} prepend @param {string} pre @param {string} post @param {PlaceOptions} opts */
function placeTableLine(target, text, prepend, pre, post, opts) {
  const cells = splitTableRowLine(text);
  const found = firstTableInFile(target);
  if (found) {
    const { host, table } = found;
    const at = tableRowIndex(table, prepend, opts.tableLinePos);
    table.rows.splice(at, 0, { type: 'row', cells });
    // the formulas follow the rows (org-table-fix-formulas), then the table is worked out again
    if (table.tblfm !== null) table.tblfm = fixTableFormulas(table.tblfm, '@', {}, table.rows.slice(0, at + 1).filter((r) => r.type === 'row').length - 1, 1);
    commit(host, table.lineIndex, table.lineCount, serializeTable(table, true));
    const now = tablesOf(host).find((t) => t.lineIndex === table.lineIndex) || null;
    if (now && now.tblfm && opts.recalculate) {
      const rows = opts.recalculate(now);
      if (rows) {
        now.rows = rows;
        commit(host, now.lineIndex, now.lineCount, serializeTable(now, true));
      }
    }
    return tablesOf(host).find((t) => t.lineIndex === table.lineIndex) || null;
  }
  const host = !target.level ? lastNodeOf(target) : target;
  /** @type {import('./types.js').TableRow[]} */
  const rows = opts.tableHeader === false ? [{ type: 'row', cells }] : [{ type: 'row', cells: cells.map(() => '') }, { type: 'rule' }, { type: 'row', cells }];
  const tableLines = serializeTable({ type: 'table', rows, tblfm: null, lineIndex: 0, lineCount: 0 }, true);
  const start = host.bodyLines.length;
  commit(host, start, 0, tableLines);
  const end = start + tableLines.length;
  // preText and postText (this app's own) go directly beside the new table, once
  if (post) {
    const postLines = post.split('\n');
    const needsSeparatorAfter = host.bodyLines.length > end && host.bodyLines[end].trim() !== '';
    commit(host, end, 0, needsSeparatorAfter ? [...postLines, ''] : postLines);
  }
  if (pre) {
    const preLines = pre.split('\n');
    const needsSeparatorBefore = start > 0 && host.bodyLines[start - 1].trim() !== '';
    commit(host, start, 0, needsSeparatorBefore ? ['', ...preLines] : preLines);
  }
  return tablesOf(host)[0] || null;
}

/**
 * Files already-expanded capture text the way `org-capture` does.
 * @param {Host} target a heading, or a file's top level
 * @param {string} type entry, plain, item, checkitem or table-line
 * @param {string} expandedText
 * @param {boolean} [prepend]
 * @param {boolean} [omitEmptyEntries]
 * @param {string} [expandedPreText]
 * @param {string} [expandedPostText]
 * @param {PlaceOptions} [opts]
 */
function insertCapture(target, type, expandedText, prepend = false, omitEmptyEntries = false, expandedPreText = '', expandedPostText = '', opts = {}) {
  const [before, after] = emptyLinesOf(opts);
  if (type === 'item' || type === 'checkitem') {
    const placed = placeItem(target, '- ', expandedPreText + expandedText + expandedPostText, prepend, before, after);
    for (const node of placed.host.body || []) {
      if (node.type === 'list') for (const it of node.items) if (it.lineIndex === placed.line) return it;
    }
    return null;
  }
  if (type === 'table-line') return placeTableLine(target, expandedText, prepend, expandedPreText, expandedPostText, opts);

  // 'entry' and 'plain' (and the fallback for anything unrecognized -- filing the text as written is safer than discarding it)
  const text = expandedPreText + expandedText + expandedPostText;
  const fragment = parseOrg(text);
  if (omitEmptyEntries) for (const heading of fragment.children) stripEmptyProperties(heading);
  if (fragment.children.length > 0) {
    const offset = target.level || 0; // a file's top level has none
    const shift = (/** @type {Heading[]} */ headings) => {
      for (const h of headings) {
        h.level += offset;
        shift(h.children);
      }
    };
    shift(fragment.children);
    placeHeadings(target, fragment.children, prepend, before, after);
    return prepend ? target.children[0] : target.children[target.children.length - 1];
  }
  placePlainText(target, text.split('\n'), prepend, before, after);
  return null;
}

/**
 * `insertCapture` for a whole file: the newline that ends the file is not a line of its own, so it stays at the end.
 * @param {Host} doc the file
 * @param {Host} target a heading of it, or the file itself
 * @param {string} type @param {string} expandedText @param {boolean} [prepend] @param {boolean} [omitEmptyEntries]
 * @param {string} [expandedPreText] @param {string} [expandedPostText] @param {Parameters<typeof insertCapture>[7]} [opts]
 */
function fileCapture(doc, target, type, expandedText, prepend, omitEmptyEntries, expandedPreText, expandedPostText, opts) {
  const ends = (/** @type {Host} */ node) => node.bodyLines.length > 0 && node.bodyLines[node.bodyLines.length - 1] === '';
  const newline = ends(lastNodeOf(doc));
  if (newline) {
    const last = lastNodeOf(doc);
    last.bodyLines.pop();
    last.body = parseBody(last.bodyLines);
  }
  try {
    return insertCapture(target, type, expandedText, prepend, omitEmptyEntries, expandedPreText, expandedPostText, opts);
  } finally {
    if (newline) {
      const last = lastNodeOf(doc);
      last.bodyLines.push('');
      last.body = parseBody(last.bodyLines);
    }
  }
}

/**
 * Resolves a capture template's `file` field to an actual target file
 * id, given the current document's own id. Recognizes and strips a
 * "scheme:" prefix first -- "github:foo" / "webdav:foo" (case-
 * insensitive), matching the SAME "scheme:path" convention Agenda
 * Files already uses elsewhere in this app (see local-variables.js's
 * getAgendaFiles) -- so a template author who reasonably expects that
 * same syntax to work here gets a correct resolution rather than the
 * whole string silently being treated as one literal filename. See
 * getCaptureFileScheme's own docs for why the scheme itself still
 * needs a SEPARATE validation step by the caller.
 *
 * Once any scheme prefix is stripped, a path containing "/" is used
 * as-is (already a fully-qualified path for whatever backend is
 * active); a bare filename with no "/" is placed in the same directory
 * as the current document (a sibling file) -- the closest equivalent
 * this app's simpler, backend-agnostic file-id space has to real org's
 * own org-directory-relative resolution for a capture template's file
 * target. A blank/unset `file` resolves to the current document
 * itself, matching a template with no file target at all (real org's
 * `(file+olp ...)` with no file argument capturing into the buffer
 * you're currently in).
 * @param {any} file
 * @param {string} currentFileId
 */
function resolveCaptureFileId(file, currentFileId) {
  const trimmed = String(file || '').trim();
  if (!trimmed) return currentFileId;
  const { scheme, path } = getCaptureFileScheme(trimmed);
  const resolved = CAPTURE_FILE_SCHEMES.has(/** @type {string} */ (scheme)) ? /** @type {string} */ (path) : trimmed;
  if (resolved.includes('/') || !currentFileId) return resolved;
  const lastSlash = currentFileId.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : currentFileId.slice(0, lastSlash + 1);
  return dir + resolved;
}

const CAPTURE_FILE_SCHEMES = new Set(['github', 'webdav', 'local']);

/** The storage kind (S.state.storageKind) a scheme names. They differ for exactly one: `local:` is the device's own storage,
 * @param {string} scheme
 *  which the app calls 'filesystem'. The caller compares this with the open document's kind (see getCaptureFileScheme). */
function storageKindForScheme(scheme) {
  return scheme === 'local' ? 'filesystem' : scheme;
}

/**
 * Splits a capture template's raw `file` value into `{ scheme, path }`
 * -- `scheme` is null if there's no "word:" prefix at all (an ordinary
 * bare filename or path, ":" not being a normal character in one);
 * a recognized backend name ("github"/"webdav"/"local", always lowercased,
 * matching however it was actually cased in the template) if the
 * prefix matches one of those; or the VERBATIM, unrecognized prefix
 * text itself (original casing preserved) for anything else that
 * merely looks like an attempted scheme but isn't one this app
 * understands.
 *
 * This module is deliberately backend-agnostic -- it has no notion of
 * "which backend is currently active" (that's app.js's own state, not
 * something a capture template's file-resolution logic should need to
 * know about to do basic path math). Because of that, this function
 * only SPLITS the string; it doesn't and can't judge whether a
 * recognized scheme actually matches whatever backend is currently
 * open. The caller (app.js's runCaptureWithAnswers, which does know
 * the active backend) is expected to check that itself before treating
 * a capture as safe to run -- silently proceeding on a scheme mismatch
 * (e.g. "github:foo" while a WebDAV file is open) would attempt to
 * write to the wrong backend for the currently-open document, an even
 * more confusing failure mode than the original bug this exists to fix.
 * @param {string} file
 */
function getCaptureFileScheme(file) {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/.exec(file);
  if (!match) return { scheme: null, path: file };
  const rawScheme = match[1];
  const lowered = rawScheme.toLowerCase();
  return { scheme: CAPTURE_FILE_SCHEMES.has(lowered) ? lowered : rawScheme, path: match[2] };
}

/**
 * Returns a Map from item -> key, including only items whose own key
 * doesn't collide with another item's key in the same list -- a key
 * claimed by more than one item is entirely excluded from the result
 * (neither item gets a hotkey), rather than picking a "first one
 * wins" winner. Shared between the capture-template picker and the
 * TODO-workflow picker, both of which need this same "only show/
 * accept a hotkey when it's genuinely unambiguous" rule for their own
 * god-mode-triggered fast-key selection.
 * @param {any} [items]
 * @param {any} [keyFn]
 */
function computeNonCollidingKeys(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const result = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key && counts.get(key) === 1) result.set(item, key);
  }
  return result;
}

export {
  formatTime,
  scanPrompts,
  expandTemplate,
  expandCaptureText,
  resolveOlpTarget,
  mergeFragmentInto,
  insertCapture,
  fileCapture,
  plannedTableRow,
  resolveCaptureFileId,
  getCaptureFileScheme,
  CAPTURE_FILE_SCHEMES,
  storageKindForScheme,
  computeNonCollidingKeys,
};
