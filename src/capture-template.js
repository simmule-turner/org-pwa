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
import { parseOrg, serializeOrg } from './org-parser.js';
import { insertTopLevelHeading, insertChildHeading } from './heading-edit.js';
import { commitLines, fixTableFormulas, serializeTable } from './body-edit.js';
import { findLists, listAt, renumber } from './list-edit.js';
import { parseBody } from './body-parser.js';
import { endCreated, findOrCreateDatetree } from './capture-datetree.js';

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
/** Stands in the text where a blank %? ends it, until the text is cleaned up: the space before it is kept, as Emacs keeps it. */
const CURSOR_AT_END = '\uE000';
/** Where a `%^{Name}p` stood, until the property it asks for is set on the entry that holds it. */
const PROPERTY_MARK = (/** @type {number} */ n) => `\uE001${n}\uE002`;

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
 * `org-set-property` for each `%^{Name}p`, on the entry the placeholder is in: the value of the property is changed if the entry has it,
 * else it is added to the properties drawer, which is made after the planning line if there is none; before the first heading the drawer
 * is at the start of the text.
 * @param {string} text the expanded text, with the places of the placeholders marked @param {{ name: string, value: string }[]} properties
 */
function setPromptedProperties(text, properties) {
  if (!properties.length) return text;
  let lines = text.split('\n');
  properties.forEach(({ name, value }, n) => {
    const mark = PROPERTY_MARK(n);
    const at = lines.findIndex((l) => l.includes(mark));
    if (at < 0) return;
    lines[at] = lines[at].replace(mark, '');
    let heading = at;
    while (heading >= 0 && !/^\*+[ \t]/.test(lines[heading])) heading--;
    let pos = heading + 1;
    if (heading >= 0 && /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/.test(lines[pos] ?? '')) pos++;
    if (/^[ \t]*:PROPERTIES:[ \t]*$/i.test(lines[pos] ?? '')) {
      let end = pos + 1;
      while (end < lines.length && !/^[ \t]*:END:[ \t]*$/i.test(lines[end])) end++;
      const key = name.toLowerCase();
      const own = lines.slice(pos + 1, end).findIndex((l) => new RegExp(`^[ \\t]*:${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`, 'i').test(l));
      if (own >= 0 && key) lines[pos + 1 + own] = lines[pos + 1 + own].replace(/^([ \t]*:[^:\s]*:)[ \t]*.*$/, (_m, head) => (value === '' ? head : `${head.padEnd(10)} ${value}`));
      else lines.splice(end, 0, value === '' ? `:${name}:` : `${`:${name}:`.padEnd(10)} ${value}`);
    } else lines.splice(pos, 0, ':PROPERTIES:', value === '' ? `:${name}:` : `${`:${name}:`.padEnd(10)} ${value}`, ':END:');
  });
  return lines.join('\n');
}

/**
 * The tidy-up that ends org-capture-fill-template: no blank lines before the text, one newline at the end (or an
 * empty string), tabs expanded.
 * @param {string} text
 */
function cleanupExpanded(text) {
  const first = text.search(/[^ \t\n\uE000]/);
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
  /** @type {{ name: string, value: string }[]} */ const properties = [];
  const answerFor = (/** @type {string} */ fallback) => {
    const given = answers[prompts.length - 1];
    return given === undefined || given === null || given === '' ? fallback : String(given);
  };
  sweep(st, PROMPT_ESCAPE_RE, (m, cur) => {
    if (m[0] === '%?') {
      prompts.push({ kind: 'text', prompt: 'Text', default: '', completions: [] });
      const given = answers[prompts.length - 1];
      const typed = given === undefined || given === null ? '' : String(given);
      // Emacs leaves %? in the text while it trims and files it, so the space before it stays: mark where a blank one ends the text
      insertAt(cur, typed === '' && /^[ \t\n]*(?:\x01\x02CAPTURE_SPLIT\x02\x01.*)?$/s.test(cur.buf.slice(cur.pos)) ? CURSOR_AT_END : typed);
      return;
    }
    const items = m[1] !== undefined ? m[1].split('|') : [];
    const label = items[0];
    const dflt = items[1];
    const completions = items.slice(2);
    const key = m[2];
    if (key === 'p') {
      if (label === undefined) {
        insertAt(cur, m[0]); // Emacs asks for a property with no name; here the text stays as written
        return;
      }
      // `org-read-property-value`: the allowed values come from the target's tree, not from the template, so the list in the placeholder is not used
      prompts.push({ kind: 'property', prompt: label, default: dflt || '', completions: [] });
      properties.push({ name: label, value: answerFor(dflt || '') });
      insertAt(cur, PROPERTY_MARK(properties.length - 1));
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
  return { text: st.buf, prompts, properties };
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
  const { text, properties } = runExpansion(template, context, /** @type {any} */ (context).promptAnswers || []);
  return { text: setPromptedProperties(cleanupExpanded(text), properties).replace(CURSOR_AT_END, '') };
}

/** Expands a capture template: `expandTemplate`, plus whether %? asked for the cursor to end up at the end of the text.
 *  Returns { text, cursorAtEnd }.
 * @param {string} template
 * @param {any} [context]
 */
function expandCaptureText(template, context = {}) {
  const { text, properties } = runExpansion(template, context, /** @type {any} */ (context).promptAnswers || []);
  const cleaned = setPromptedProperties(cleanupExpanded(text), properties);
  return { text: cleaned.replace(CURSOR_AT_END, ''), cursorAtEnd: cleaned.includes(CURSOR_AT_END) };
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
 * `datetree` (file+olp+datetree): after the path, the day (or month, or week and day) heading for `now` is found or created under it,
 * and that heading is the target; `treeType` is Org's :tree-type, week or month. Nothing is created where `allowCreate` is false.
 * @param {Doc} doc @param {any} olpPath @param {{ now?: Date, prepend?: boolean, allowCreate?: boolean, unique?: boolean, datetree?: boolean, treeType?: string, mustExist?: boolean }} [options]
 */
function resolveOlpTarget(doc, olpPath, { now, prepend = false, allowCreate = true, unique = false, datetree = false, treeType, mustExist = false } = {}) {
  const at = now instanceof Date ? now : new Date();
  let siblings = doc.children;
  let parent = null;
  /** @type {any} */
  let found = null;

  let depth = 0;
  for (const rawSegment of olpPath) {
    depth++;
    const title = rawSegment;
    if (unique && siblings.filter((h) => h.title === title).length > 1) throw new Error(`Heading not unique on level ${depth}: ${title}`);
    found = siblings.find((h) => h.title === title);
    if (!found) {
      if (mustExist) throw new Error(`Heading not found on level ${depth}: ${title}`);
      if (!allowCreate) return null;
      const last = lastNodeOf(parent || doc);
      const atEnd = !prepend && lastNodeOf(doc) === last;
      // Emacs adds the heading after the file's last line, which ends in a newline: the line break that ended the text moves on to the new heading
      if (atEnd && last.bodyLines.length && last.bodyLines[last.bodyLines.length - 1] === '') {
        last.bodyLines.pop();
        last.body = parseBody(last.bodyLines);
      }
      found = parent ? insertChildHeading(parent, { title }, prepend) : insertTopLevelHeading(doc, { title }, prepend);
      if (atEnd) found.bodyLines = [''];
    }
    parent = found;
    siblings = found.children;
  }

  if (datetree) return allowCreate ? findOrCreateDatetree(doc, found, at, treeType) : null;
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

/** @typedef {import('./types.js').Heading | import('./types.js').Doc} Host a heading, or a file's top level */
/** @typedef {import('./types.js').Table} Table */
/** The blank lines around filed text, the table row to use, and `recalculate`, which works out a table's #+TBLFM after a row is added.
 *  @typedef {{ emptyLines?: number, emptyLinesBefore?: number, emptyLinesAfter?: number, tableLinePos?: string, blankBeforeTable?: boolean, cursorAtEnd?: boolean, exact?: { host: Host, offset: number }, recalculate?: (table: Table) => import('./types.js').TableRow[] | null, onFiled?: (where: { row?: number, host?: Host, line?: number }) => void }} PlaceOptions */
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
function endWithBlanks(node, n, keep = false) {
  const lines = node.bodyLines;
  let a = lines.length;
  while (!keep && a > 0 && BLANK(lines[a - 1])) a--;
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
function placeHeadings(target, headings, prepend, before, after, keepEnd = false) {
  endWithBlanks(prepend ? target : lastNodeOf(target), before);
  if (prepend) target.children.unshift(...headings);
  else target.children.push(...headings);
  target.collapsed = false;
  endWithBlanks(lastNodeOf(headings[headings.length - 1]), after, keepEnd);
}

/** Files text that holds no heading (`org-capture-place-plain-text`): the end of the entry's own text, or its start past
 *  the meta data; for a file, its end or start.
 * @param {Host} target @param {string[]} text @param {boolean} prepend @param {number} before @param {number} after
 * @param {PlaceOptions['onFiled']} [onFiled] told which text it went into and the line it starts on (and, for a table, the index of the new row) */
function placePlainText(target, text, prepend, before, after, onFiled) {
  const top = !target.level;
  const host = !prepend && top ? lastNodeOf(target) : target;
  const lines = host.bodyLines;
  let at = prepend ? (top ? 0 : afterMetaData(lines)) : lines.length;
  at = blanksBefore(lines, at, before);
  lines.splice(at, 0, ...text);
  blanksAfter(lines, at + text.length, after);
  host.body = parseBody(lines);
  onFiled?.({ host, line: at });
}

/** @param {string} line */
function indentOf(line) {
  return /^[ \t]*/.exec(line)?.[0].replace(/\t/g, '        ').length ?? 0;
}

/** Files a list item (`org-capture-place-item`): into the first list of the entry's text (the file's text for a top
 *  level), else as a new list.
 * @param {Host} target @param {string} lead @param {string} text @param {boolean} prepend @param {number} before @param {number} after */
function placeItem(target, lead, text, prepend, before, after, keepEnd = false, exact = /** @type {PlaceOptions['exact']} */ (undefined)) {
  const body = keepEnd ? text.replace(/^\s+/, '') : text.replace(/^\s+|\s+$/g, '');
  const itemLines = (ITEM_START_RE.test(body) ? body : lead + body.split('\n').join('\n  ')).split('\n');
  /** @type {{ host: Host, list: ReturnType<typeof findLists>[number] } | null} */
  let found = null;
  for (const host of exact ? [exact.host] : hostNodes(target)) {
    // at an exact position the lists are looked for from its line to the end of the entry's own text
    const lists = findLists(host.bodyLines).filter((l) => !exact || l.items.some((it) => it.line >= exact.offset));
    if (lists.length) {
      found = { host, list: lists[0] };
      break;
    }
  }
  if (!found) {
    // a file that starts with a heading has the new list in that heading's text; Emacs looks from the file's start
    const top = !target.level;
    if (exact) {
      const lines = exact.host.bodyLines;
      let at = prepend ? exact.offset : lines.length;
      at = blanksBefore(lines, at, before);
      lines.splice(at, 0, ...itemLines);
      blanksAfter(lines, at + itemLines.length, after);
      exact.host.body = parseBody(lines);
      return { host: exact.host, line: at };
    }
    const host = top ? (prepend ? (target.bodyLines.length === 0 && target.children.length ? target.children[0] : target) : lastNodeOf(target)) : target;
    if (prepend && host.level && /** @type {Heading} */ (host).logbookLines?.length) {
      // the start of the entry's text is before the drawer of its log: org-end-of-meta-data skips the planning line and the properties only
      const heading = /** @type {Heading} */ (host);
      heading.preLogLines = [...itemLines, ...Array(after).fill(''), ...(heading.preLogLines || [])];
      return { host, line: -1 };
    }
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

/** @param {Host} target @param {PlaceOptions['exact']} [exact] a position: the first table from its line on, in the text it is in
 * @returns {{ host: Host, table: Table } | null} */
function firstTableInFile(target, exact) {
  for (const host of exact ? [exact.host] : hostNodes(target)) {
    const table = tablesOf(host).find((t) => !exact || t.lineIndex + t.lineCount > exact.offset);
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
  const found = firstTableInFile(target, opts.exact);
  if (!found) return 2; // a new table starts with an empty header row and a rule, then the row
  try {
    const k = tableRowIndex(found.table, prepend, opts.tableLinePos);
    return found.table.rows.slice(0, k).filter((r) => r.type === 'row').length + 1;
  } catch {
    return 1;
  }
}

/** Files a table row (`org-capture-place-table-line`): into the first table, or into a new one at the end of the text.
 * @param {Host} target @param {string} text @param {boolean} prepend @param {PlaceOptions} opts */
function placeTableLine(target, text, prepend, opts) {
  const cells = splitTableRowLine(text);
  const found = firstTableInFile(target, opts.exact);
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
    const filed = tablesOf(host).find((t) => t.lineIndex === table.lineIndex) || null;
    opts.onFiled?.({ host, line: table.lineIndex, row: at });
    return filed;
  }
  const host = opts.exact ? opts.exact.host : !target.level ? lastNodeOf(target) : target;
  /** @type {import('./types.js').TableRow[]} */
  const rows = [{ type: 'row', cells: cells.map(() => '') }, { type: 'rule' }, { type: 'row', cells }];
  const tableLines = serializeTable({ type: 'table', rows, tblfm: null, lineIndex: 0, lineCount: 0 }, true);
  const lead = opts.blankBeforeTable ? [''] : []; // org's one blank line before the table of a day it has just made
  const start = host.bodyLines.length + lead.length;
  commit(host, start - lead.length, 0, [...lead, ...tableLines]);
  const made = tablesOf(host)[0] || null;
  if (made) opts.onFiled?.({ host, line: made.lineIndex, row: rows.length - 1 });
  return made;
}

/**
 * Files already-expanded capture text the way `org-capture` does.
 * @param {Host} target a heading, or a file's top level
 * @param {string} type entry, plain, item, checkitem or table-line
 * @param {string} expandedText
 * @param {boolean} [prepend]
 * @param {PlaceOptions} [opts]
 */
function insertCapture(target, type, expandedText, prepend = false, opts = {}) {
  const [before, after] = emptyLinesOf(opts);
  if (type === 'item' || type === 'checkitem') {
    const placed = placeItem(target, '- ', expandedText, prepend, before, after, !!opts.cursorAtEnd, opts.exact);
    opts.onFiled?.({ host: placed.host, line: placed.line });
    for (const node of placed.host.body || []) {
      if (node.type === 'list') for (const it of node.items) if (it.lineIndex === placed.line) return it;
    }
    return null;
  }
  if (type === 'table-line') return placeTableLine(target, expandedText, prepend, opts);

  // 'entry' and 'plain' (a type of any other name never gets here: captureInto refuses it)
  const text = expandedText;
  const fragment = parseOrg(text);
  if (fragment.children.length > 0) {
    const offset = (target.level || 0) + 1 - fragment.children[0].level; // the first heading becomes a child of the target; deeper ones keep their distance (org-paste-subtree)
    const shift = (/** @type {Heading[]} */ headings) => {
      for (const h of headings) {
        h.level += offset;
        shift(h.children);
      }
    };
    shift(fragment.children);
    placeHeadings(target, fragment.children, prepend, before, after, !!opts.cursorAtEnd);
    return prepend ? target.children[0] : target.children[target.children.length - 1];
  }
  placePlainText(target, text.split('\n'), prepend, before, after, opts.onFiled);
  return null;
}

/**
 * The lines a capture puts in at the cursor (`org-capture` with a prefix argument of 0): an entry whose first heading has `level`, an item
 * with its bullet, a row in a new table, or text as it is.
 * @param {string} type @param {string} expandedText @param {number} level
 * @returns {string[]}
 */
function linesAtPoint(type, expandedText, level) {
  const lines = (/** @type {string} */ t) => t.replace(/\n$/, '').split('\n');
  if (type === 'item' || type === 'checkitem') {
    const body = expandedText.replace(/^\s+|\s+$/g, '');
    return (ITEM_START_RE.test(body) ? body : '- ' + body.split('\n').join('\n  ')).split('\n');
  }
  if (type === 'table-line') {
    const scratch = parseOrg('');
    insertCapture(scratch, 'table-line', expandedText, false, {});
    return lines(serializeOrg(scratch)).filter((l, i, all) => l !== '' || all.slice(0, i).some((x) => x !== ''));
  }
  if (type === 'entry') {
    const fragment = parseOrg(expandedText);
    if (fragment.children.length) {
      const offset = level - fragment.children[0].level;
      const shift = (/** @type {Heading[]} */ headings) => {
        for (const h of headings) {
          h.level += offset;
          shift(h.children);
        }
      };
      shift(fragment.children);
      return lines(serializeOrg(fragment));
    }
  }
  return lines(expandedText);
}

/**
 * The date and time a template with :time-prompt is filed for, from what was typed, as org-read-date takes it: nothing is now, a date
 * (2026-12-01) is for 00:00 of that day, or the time of day of `base` if it is today, a date with a time (2026-12-01 9:05) sets it, an Org timestamp is read, and +2d, -1w, +1m, +1y or a weekday name
 * (the next one) count from `base`. Returns null for anything else.
 * @param {string} text @param {Date} base @returns {Date | null}
 */
function parseTimePrompt(text, base) {
  const date = readTimePrompt(text, base);
  // org-capture: a date other than today with no time given is filed for 00:00 (org-extend-today-until)
  if (date && text.trim() !== '' && !/\d{1,2}:\d\d/.test(text) && date.toDateString() !== base.toDateString()) date.setHours(0, 0, 0, 0);
  return date;
}

/** @param {string} text @param {Date} base @returns {Date | null} */
function readTimePrompt(text, base) {
  const typed = text.trim().replace(/^[<[]|[>\]]$/g, '').replace(/^(\d{4}-\d{1,2}-\d{1,2})( [A-Za-z]{2,}\.?)/, '$1').trim();
  if (typed === '') return new Date(base.getTime());
  const abs = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d\d))?$/.exec(typed);
  if (abs) {
    const date = new Date(Number(abs[1]), Number(abs[2]) - 1, Number(abs[3]), abs[4] === undefined ? base.getHours() : Number(abs[4]), abs[4] === undefined ? base.getMinutes() : Number(abs[5]));
    return date.getMonth() === Number(abs[2]) - 1 ? date : null;
  }
  const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(typed.slice(0, 3).toLowerCase());
  if (day >= 0 && /^[a-z]+$/i.test(typed) && ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].some((w) => w.startsWith(typed.toLowerCase()) && typed.length >= 3)) {
    const date = new Date(base.getTime()); // the next one, not today
    date.setDate(date.getDate() + (((day - base.getDay() + 6) % 7) + 1));
    return date;
  }
  const rel = /^([+-]?)(\d+)([dwmy])$/.exec(typed);
  if (!rel) return null;
  const n = (rel[1] === '-' ? -1 : 1) * Number(rel[2]);
  const date = new Date(base.getTime());
  if (rel[3] === 'd') date.setDate(date.getDate() + n);
  else if (rel[3] === 'w') date.setDate(date.getDate() + 7 * n);
  else if (rel[3] === 'm') date.setMonth(date.getMonth() + n);
  else date.setFullYear(date.getFullYear() + n);
  return date;
}

/** Whether `text` has a heading line, which a plain capture puts in as written. @param {string} text */
function holdsHeading(text) {
  return /^\*+ /m.test(text);
}

/**
 * Files plain text that has heading lines: as written, headings and all, since Emacs does not shift their levels as it does for an entry.
 * The place is the one a line of plain text gets, found with a stand-in line that is then replaced by the text.
 * @param {Host} doc the file @param {Host} target @param {string} text @param {boolean} [prepend] @param {Parameters<typeof insertCapture>[4]} [opts]
 * @returns {number} the line of the file where the text starts
 */
function filePlainText(doc, target, text, prepend, opts) {
  const standIn = '@@capture-point@@';
  fileCapture(doc, target, 'plain', standIn, prepend, opts);
  const lines = serializeOrg(/** @type {any} */ (doc)).split('\n');
  const at = lines.indexOf(standIn);
  lines.splice(at, 1, ...text.split('\n'));
  Object.assign(doc, parseOrg(lines.join('\n')));
  return at;
}

/**
 * `insertCapture` for a whole file: the newline that ends the file is not a line of its own, so it stays at the end.
 * @param {Host} doc the file
 * @param {Host} target a heading of it, or the file itself
 * @param {string} type @param {string} expandedText @param {boolean} [prepend] @param {Parameters<typeof insertCapture>[4]} [opts]
 */
function fileCapture(doc, target, type, expandedText, prepend, opts) {
  if (type === 'plain' && holdsHeading(expandedText)) {
    filePlainText(doc, target, expandedText, prepend, opts);
    return null;
  }
  // org starts the table of a new date-tree day, the last in its month with more of the file after it, one line down
  if (type === 'table-line' && endCreated.delete(target)) opts = { ...opts, blankBeforeTable: true };
  const ends = (/** @type {Host} */ node) => node.bodyLines.length > 0 && node.bodyLines[node.bodyLines.length - 1] === '';
  const newline = ends(lastNodeOf(doc));
  if (newline) {
    const last = lastNodeOf(doc);
    last.bodyLines.pop();
    last.body = parseBody(last.bodyLines);
  }
  try {
    return insertCapture(target, type, expandedText, prepend, opts);
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
  linesAtPoint,
  blanksBefore,
  blanksAfter,
  formatTime,
  filePlainText,
  parseTimePrompt,
  holdsHeading,
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
