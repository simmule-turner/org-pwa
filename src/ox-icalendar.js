// @ts-check
/**
 * Calendar (.ics) export as Emacs does it (`org-icalendar-export-to-ics`, ox-icalendar.el), held to Emacs's own output by
 * test/ox-icalendar.test.js (tools/gen-icalendar-oracle.mjs writes the expected files from Emacs 29.3).
 *
 * Per headline, in this order: an event for its DEADLINE and one for its SCHEDULED (when `org-icalendar-use-deadline` /
 * `-use-scheduled` say so for its TODO state), one event for each timestamp in its title and text, a task (VTODO) when
 * `org-icalendar-include-todo` asks for one; the events of its sub-headings follow.  The summary is the title, the description
 * the text below it (both as the ASCII back end writes them), the categories its tags and the file's category.
 *
 * Not the same as Emacs: the UID of a heading without an :ID: is derived from its file, title and place instead of being random,
 * so exporting twice gives the same events; lines end in CRLF throughout; diary sexps are not converted.
 */

import { exportAsciiObjects, exportToAscii } from './export-ascii.js';
import { buildFilter } from './export-html.js';
import { parseElements } from './org-elements.js';
import { serializeOrg } from './org-parser.js';
import { resolveTodoSequences } from './todo-cycle.js';
import { getProperty } from './archive-model.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */

/**
 * @typedef {{
 *   includeTodo: 'nil' | 't' | 'unblocked' | 'all',
 *   useDeadline: string[], useScheduled: string[], categories: string[],
 *   withTimestamps: 'active' | 'inactive' | 't' | 'nil',
 *   includeBody: number | boolean, alarmTime: number, forceAlarm: boolean,
 *   scheduledPrefix: string, deadlinePrefix: string, dateTimeFormat: string,
 *   timezone: string, appointmentDuration: number | null, excludeTags: string[],
 *   combinedName: string, combinedDescription: string, userFullName: string
 * }} IcalendarSettings
 */

/** @type {IcalendarSettings} */
export const ICALENDAR_DEFAULTS = {
  includeTodo: 'nil',
  useDeadline: ['event-if-not-todo', 'todo-due'],
  useScheduled: ['todo-start'],
  categories: ['local-tags', 'category'],
  withTimestamps: 'active',
  includeBody: true,
  alarmTime: 0,
  forceAlarm: false,
  scheduledPrefix: 'S: ',
  deadlinePrefix: 'DL: ',
  dateTimeFormat: ':%Y%m%dT%H%M%S',
  timezone: '',
  appointmentDuration: null,
  excludeTags: [],
  combinedName: 'OrgMode',
  combinedDescription: '',
  userFullName: '',
};

// ---- strings ----------------------------------------------------------------

/** `org-icalendar-cleanup-string`: `\`, `,` and `;` protected, line ends written as `\n`. @param {string | null | undefined} s */
function cleanup(s) {
  if (s === null || s === undefined) return '';
  return s.replace(/[\\,;]/g, '\\$&').replace(/[ \t]*\n/g, '\\n');
}

/** `org-icalendar-fold-string`: lines of at most 75 characters, continued with a leading blank. @param {string} line */
function fold(line) {
  const chars = [...line];
  if (chars.length <= 75) return line;
  let out = chars.slice(0, 75).join('');
  for (let i = 75; i < chars.length; i += 74) out += '\r\n ' + chars.slice(i, i + 74).join('');
  return out;
}

const pad = (/** @type {number} */ n, width = 2) => String(n).padStart(width, '0');

// ---- timestamps ---------------------------------------------------------------

/**
 * @typedef {{
 *   active: boolean, y1: number, mo1: number, d1: number, h1: number | null, mi1: number | null,
 *   y2: number, mo2: number, d2: number, h2: number | null, mi2: number | null,
 *   repeater: { value: number, unit: string } | null
 * }} Stamp
 */

const STAMP_RE = /([<[])(\d{4})-(\d{1,2})-(\d{1,2})(?:[ \t]+[^\s\d>\]+-][^\s>\]]*)?(?:[ \t]+(\d{1,2}):(\d{2})(?:-(\d{1,2}):(\d{2}))?)?((?:[ \t]+(?:[.+]\+?|-{1,2})\d+[hdwmy](?:\/\d+[hdwmy])?)*)[ \t]*([>\]])/y;

/**
 * One timestamp at `pos` of `text` (or a `<a>--<b>` range), as `[stamp, end]`.
 * @param {string} text @param {number} pos @returns {[Stamp, number] | null}
 */
function stampAt(text, pos) {
  STAMP_RE.lastIndex = pos;
  const m = STAMP_RE.exec(text);
  if (!m || (m[1] === '<') !== (m[10] === '>')) return null;
  const [, open, y, mo, d, h1, mi1, h2, mi2, marks] = m;
  const rep = /(?:[.+]\+?)(\d+)([hdwmy])/.exec(marks || '');
  const units = /** @type {Record<string, string>} */ ({ h: 'hour', d: 'day', w: 'week', m: 'month', y: 'year' });
  /** @type {Stamp} */
  const stamp = {
    active: open === '<',
    y1: +y, mo1: +mo, d1: +d, h1: h1 === undefined ? null : +h1, mi1: mi1 === undefined ? null : +mi1,
    y2: +y, mo2: +mo, d2: +d, h2: h2 === undefined ? (h1 === undefined ? null : +h1) : +h2, mi2: mi2 === undefined ? (mi1 === undefined ? null : +mi1) : +mi2,
    repeater: rep ? { value: +rep[1], unit: units[rep[2]] } : null,
  };
  let end = pos + m[0].length;
  if (text.startsWith('--', end)) {
    const second = stampAt(text, end + 2);
    if (second && second[0].active === stamp.active) {
      const s = second[0];
      Object.assign(stamp, { y2: s.y1, mo2: s.mo1, d2: s.d1, h2: s.h1, mi2: s.mi1 });
      end = second[1];
    }
  }
  return [stamp, end];
}

/** Every timestamp in `text`, with code and verbatim text left out. @param {string} text @returns {Stamp[]} */
function stampsIn(text) {
  // code, verbatim text and links (a timestamp in a link's description is not an event) are left out
  const masked = text.replace(/(^|[\s({'"])([=~])(?=\S)([^\n]*?\S)\2(?=$|[\s\-.,:;!?')}"\\[])/g, (m) => ' '.repeat(m.length)).replace(/\[\[[^\]\n]*\]\[[^\n]*?\]\]/g, (m) => ' '.repeat(m.length));
  /** @type {Stamp[]} */ const found = [];
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== '<' && masked[i] !== '[') continue;
    const hit = stampAt(masked, i);
    if (!hit) continue;
    found.push(hit[0]);
    i = hit[1] - 1;
  }
  return found;
}

/** Every timestamp in the elements of a section. @param {import('./org-elements.js').OrgElement[]} elements @returns {Stamp[]} */
function stampsInElements(elements) {
  /** @type {Stamp[]} */ const out = [];
  /** @param {import('./org-elements.js').OrgElement[]} list */
  const visit = (list) => {
    for (const el of list) {
      if (el.type === 'paragraph') out.push(...stampsIn(el.lines.join('\n')));
      else if (el.type === 'list') {
        for (const item of el.items) {
          if (item.tag) out.push(...stampsIn(item.tag));
          visit(item.children);
        }
      } else if (el.type === 'table') {
        for (const row of el.rows) if (!row.rule && row.cells) out.push(...stampsIn(row.cells.join(' ')));
      } else if (el.type === 'block') {
        if (['quote', 'center', 'verse'].includes(el.name) || !['src', 'example', 'export', 'comment'].includes(el.name)) out.push(...stampsIn(el.lines.join('\n')));
      } else if (el.type === 'drawer') {
        if (el.name.toUpperCase() !== 'PROPERTIES') out.push(...stampsIn(el.lines.join('\n')));
      } else if (el.type === 'footnote-def') visit(el.children);
    }
  };
  visit(elements);
  return out;
}

/**
 * `org-icalendar-convert-timestamp`.
 * @param {Stamp} t @param {string} keyword @param {boolean} end @param {string} tz  the TIMEZONE property
 * @param {IcalendarSettings} s
 */
function convertStamp(t, keyword, end, tz, s) {
  const withTime = t.mi1 !== null;
  const equalBounds = t.y1 === t.y2 && t.mo1 === t.mo2 && t.d1 === t.d2 && t.h1 === t.h2 && t.mi1 === t.mi2;
  const dur = s.appointmentDuration;
  const mi = !withTime ? 0 : !end ? /** @type {number} */ (t.mi1) : dur && equalBounds ? /** @type {number} */ (t.mi2) + dur : /** @type {number} */ (t.mi2);
  const h = !withTime ? 0 : !end ? /** @type {number} */ (t.h1) : !equalBounds || dur ? /** @type {number} */ (t.h2) : /** @type {number} */ (t.h2) + 2;
  const d = !end ? t.d1 : !withTime ? t.d2 + 1 : t.d2;
  const m = end ? t.mo2 : t.mo1;
  const y = end ? t.y2 : t.y1;
  const at = new Date(y, m - 1, d, h, mi, 0);
  const wantsUtc = tz === 'UTC' || (!tz && withTime && /Z$/.test(s.dateTimeFormat));
  const f = wantsUtc
    ? `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`
    : `${pad(at.getFullYear(), 4)}${pad(at.getMonth() + 1)}${pad(at.getDate())}T${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  const day = f.slice(0, 8);
  if (tz === 'UTC') return `${keyword}:${f}Z`;
  if (!withTime) return `${keyword};VALUE=DATE:${day}`;
  if (tz) return `${keyword};TZID=${tz}:${f}`;
  const format = s.dateTimeFormat.replace(/%Z/g, s.timezone);
  return keyword + format.replace(/%Y%m%dT%H%M%SZ?/, f + (/Z$/.test(s.dateTimeFormat) ? 'Z' : ''));
}

// ---- entries ----------------------------------------------------------------

/**
 * @typedef {{
 *   doc: Doc, name: string, documentId: string, settings: IcalendarSettings, stamp: Date, category: string,
 *   done: Set<string>, uids: Set<string>, keep: (h: Heading) => boolean, priorityLowest: number, priorityHighest: number, stripped: Doc
 * }} Context
 */

const stampText = (/** @type {Date} */ d) =>
  `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/** The text below a headline (property drawer, logbook, body), without the planning line. @param {Heading} h */
function sectionLines(h) {
  const lone = { ...h, children: [] };
  const text = serializeOrg(/** @type {Doc} */ ({ type: 'document', keywords: [], bodyLines: [], children: [lone] }));
  const lines = text.replace(/\n$/, '').split('\n').slice(1);
  if (lines.length && /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/.test(lines[0])) lines.shift();
  if (lines.length && /^[ \t]*:PROPERTIES:[ \t]*$/i.test(lines[0])) {
    const end = lines.findIndex((l) => /^[ \t]*:END:[ \t]*$/i.test(l));
    if (end >= 0) lines.splice(0, end + 1); // the property drawer is not part of the text
  }
  return lines;
}

/** @param {Heading} h @param {Context} c */
function todoType(h, c) {
  if (!h.todo) return null;
  return c.done.has(h.todo) ? 'done' : 'todo';
}

/**
 * `org-icalendar-blocked-headline-p`.
 * @param {Heading} h @param {Heading[]} ancestors @param {Context} c
 */
function isBlocked(h, ancestors, c) {
  /** @param {Heading} x @returns {boolean} */
  const anyOpenBelow = (x) => (x.children || []).some((k) => todoType(k, c) === 'todo' || anyOpenBelow(k));
  if (anyOpenBelow(h)) return true;
  let current = h;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const parent = ancestors[i];
    if (!parent.todo) return false;
    const ordered = getProperty(parent, 'ORDERED');
    if (ordered !== undefined && !/^(nil|)$/i.test(String(ordered).trim())) {
      for (const sibling of parent.children) {
        if (sibling === current) break;
        if (todoType(sibling, c) === 'todo') return true;
      }
    }
    current = parent;
  }
  return false;
}

/** The nearest CATEGORY property, else the file's category. @param {Heading[]} chain @param {Context} c */
function categoryOf(chain, c) {
  for (let i = chain.length - 1; i >= 0; i--) {
    const v = getProperty(chain[i], 'CATEGORY');
    if (v !== undefined && v !== '') return v;
  }
  return c.category;
}

/** `org-icalendar--valarm`. @param {Heading} h @param {Stamp} t @param {string} summary @param {IcalendarSettings} s */
function alarm(h, t, summary, s) {
  const warn = getProperty(h, 'APPT_WARNTIME');
  const alarmTime = warn !== undefined ? Number.parseInt(String(warn), 10) || 0 : null;
  if (!((alarmTime !== null && alarmTime > 0) || s.alarmTime > 0 || s.forceAlarm)) return [];
  if (t.h1 === null) return [];
  const minutes = alarmTime !== null && s.forceAlarm ? alarmTime : alarmTime !== null && alarmTime !== 0 ? alarmTime : s.alarmTime;
  return ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${summary}`, `TRIGGER:-P0DT0H${minutes}M0S`, 'END:VALARM'];
}

/**
 * @typedef {{ summary: string, location: string, klass: string, description: string, categories: string, tz: string }} Facts
 */

/** `org-icalendar--vevent`. @param {Heading} h @param {Stamp} t @param {string} uid @param {string} summary @param {Facts} f @param {Context} c */
function vevent(h, t, uid, summary, f, c) {
  const s = c.settings;
  const lines = [
    'BEGIN:VEVENT',
    `DTSTAMP:${stampText(c.stamp)}`,
    `UID:${uid}`,
    convertStamp(t, 'DTSTART', false, f.tz, s),
    convertStamp(t, 'DTEND', true, f.tz, s),
  ];
  if (t.repeater) lines.push(`RRULE:FREQ=${{ hour: 'HOURLY', day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[t.repeater.unit]};INTERVAL=${t.repeater.value}`);
  lines.push(`SUMMARY:${summary}`);
  if (f.location.trim()) lines.push(`LOCATION:${f.location}`);
  if (f.klass.trim()) lines.push(`CLASS:${f.klass}`);
  if (f.description.trim()) lines.push(`DESCRIPTION:${f.description}`);
  lines.push(`CATEGORIES:${f.categories}`);
  lines.push(...alarm(h, t, summary, s));
  lines.push('END:VEVENT');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** `org-icalendar--vtodo`. @param {Heading} h @param {string} uid @param {Facts} f @param {Context} c */
function vtodo(h, uid, f, c) {
  const s = c.settings;
  const scheduled = s.useScheduled.includes('todo-start') && h.planning && h.planning.scheduled ? stampsIn(h.planning.scheduled)[0] : null;
  const now = c.stamp;
  /** @type {Stamp} */
  const start = scheduled || {
    active: true, y1: now.getFullYear(), mo1: now.getMonth() + 1, d1: now.getDate(), h1: now.getHours(), mi1: now.getMinutes(),
    y2: now.getFullYear(), mo2: now.getMonth() + 1, d2: now.getDate(), h2: now.getHours(), mi2: now.getMinutes(), repeater: null,
  };
  const lines = ['BEGIN:VTODO', `UID:TODO-${uid}`, `DTSTAMP:${stampText(c.stamp)}`, convertStamp(start, 'DTSTART', false, f.tz, s)];
  if (s.useDeadline.includes('todo-due') && h.planning && h.planning.deadline) {
    const due = stampsIn(h.planning.deadline)[0];
    if (due) lines.push(convertStamp(due, 'DUE', false, f.tz, s));
  }
  lines.push(`SUMMARY:${f.summary}`);
  if (f.location.trim()) lines.push(`LOCATION:${f.location}`);
  if (f.klass.trim()) lines.push(`CLASS:${f.klass}`);
  if (f.description.trim()) lines.push(`DESCRIPTION:${f.description}`);
  lines.push(`CATEGORIES:${f.categories}`, 'SEQUENCE:1');
  const priority = (h.priority || 'B').toUpperCase().charCodeAt(0);
  lines.push(`PRIORITY:${Math.floor(9 - 8 * ((c.priorityLowest - priority) / (c.priorityLowest - c.priorityHighest)))}`);
  lines.push(`STATUS:${todoType(h, c) === 'todo' ? 'NEEDS-ACTION' : 'COMPLETED'}`, 'END:VTODO');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/**
 * The events of `h` and of everything below it.
 * @param {Heading} h @param {Heading[]} ancestors @param {Context} c
 * @returns {string}
 */
function entry(h, ancestors, c) {
  if (!c.keep(h)) return '';
  const s = c.settings;
  const archived = (h.tags || []).some((t) => String(t).toLowerCase() === 'archive');
  const type = todoType(h, c);
  const chain = [...ancestors, h];
  const idProp = getProperty(h, 'ID');
  const base = idProp ? String(idProp) : `${c.documentId || 'doc'}-${chain.map((x) => x.title).join('-')}-${h.level}`.replace(/[^A-Za-z0-9._-]/g, '-');
  let uidBase = base;
  for (let n = 2; c.uids.has(uidBase); n++) uidBase = `${base}-${n}`;
  c.uids.add(uidBase);

  const title = h.title.replace(/^COMMENT\s+/, '');
  const summary = cleanup(getProperty(h, 'SUMMARY') ?? exportAsciiObjects(c.stripped, title));
  // org-use-property-inheritance is nil in Emacs: these are the heading's own
  const prop = (/** @type {string} */ name) => getProperty(h, name) ?? '';
  const location = cleanup(prop('LOCATION'));
  const klass = cleanup(prop('CLASS'));
  const tz = prop('TIMEZONE').trim();
  const lines = archived ? [] : sectionLines(h);
  const elements = parseElements(lines);

  let description = '';
  const descProp = getProperty(h, 'DESCRIPTION');
  if (descProp !== undefined) description = cleanup(descProp);
  else if (lines.some((l) => l.trim())) {
    const fake = { ...c.stripped, bodyLines: lines, body: undefined, children: [] };
    let text = exportToAscii(/** @type {Doc} */ (fake), null, 70, { charset: 'utf-8', linksToNotes: false, bodyOnly: true }).trim();
    if (text) {
      if (typeof s.includeBody === 'number') text = text.slice(0, Math.min(text.length, s.includeBody));
      else if (!s.includeBody) text = '';
      description = cleanup(text);
    }
  }

  const categories = [];
  for (const kind of s.categories) {
    if (kind === 'category') categories.push(categoryOf(chain, c));
    else if (kind === 'todo-state') {
      if (h.todo) categories.push(h.todo);
    } else if (kind === 'local-tags') categories.push(...(h.tags || []));
    else if (kind === 'all-tags') {
      categories.push(...ancestors.flatMap((a) => a.tags || []), ...(h.tags || []));
    }
  }
  const facts = { summary, location, klass, description, categories: [...new Set(categories)].join(','), tz };

  let out = '';
  const deadline = h.planning && h.planning.deadline ? stampsIn(h.planning.deadline)[0] : null;
  if (deadline) {
    const use = s.useDeadline;
    const ok = type === 'todo' ? use.includes('event-if-todo-not-done') || use.includes('event-if-todo') : type === 'done' ? use.includes('event-if-todo') : use.includes('event-if-not-todo');
    if (ok) out += vevent(h, deadline, `DL-${uidBase}`, cleanup(s.deadlinePrefix) + summary, facts, c);
  }
  const scheduled = h.planning && h.planning.scheduled ? stampsIn(h.planning.scheduled)[0] : null;
  if (scheduled) {
    const use = s.useScheduled;
    const ok = type === 'todo' ? use.includes('event-if-todo-not-done') || use.includes('event-if-todo') : type === 'done' ? use.includes('event-if-todo') : use.includes('event-if-not-todo');
    if (ok) out += vevent(h, scheduled, `SC-${uidBase}`, cleanup(s.scheduledPrefix) + summary, facts, c);
  }
  let counter = 0;
  for (const t of [...stampsIn(title), ...stampsInElements(elements)]) {
    const wanted = s.withTimestamps === 't' ? true : s.withTimestamps === 'active' ? t.active : s.withTimestamps === 'inactive' ? !t.active : false;
    if (wanted) out += vevent(h, t, `TS${++counter}-${uidBase}`, summary, facts, c);
  }
  if (type && (s.includeTodo === 'all' || (s.includeTodo === 'unblocked' && !isBlocked(h, ancestors, c)) || (s.includeTodo === 't' && type === 'todo'))) {
    out += vtodo(h, uidBase, facts, c);
  }
  if (!archived) for (const child of h.children || []) out += entry(child, chain, c);
  return out;
}

// ---- files ----------------------------------------------------------------

/**
 * A calendar for the documents (one file: its own name, title and author; several: the combined agenda calendar).
 * @param {{ documentId: string, doc: Doc, name?: string }[]} docs
 * @param {{ settings?: Partial<IcalendarSettings>, stamp?: Date, scope?: Heading | null, extra?: string, priorityHighest?: number, priorityLowest?: number }} [options]
 * @returns {string}
 */
export function exportOrgIcalendar(docs, options = {}) {
  const settings = { ...ICALENDAR_DEFAULTS, ...(options.settings || {}) };
  const stamp = options.stamp || new Date();
  let body = '';
  for (const { documentId, doc, name } of docs) {
    const nameOf = (name || documentId || 'org').split(/[\\/:]/).pop() || 'org';
    const kw = (/** @type {string} */ key) => (doc.keywords || []).filter((k) => k.key.toUpperCase() === key).map((k) => k.value.trim());
    // the keywords that would put a title block into the text of an entry
    const dropped = new Set(['TITLE', 'AUTHOR', 'DATE', 'EMAIL', 'SUBTITLE']);
    const stripped = /** @type {Doc} */ ({ ...doc, keywords: (doc.keywords || []).filter((k) => !dropped.has(k.key.toUpperCase())), children: [] });
    // the tags left out: #+ICALENDAR_EXCLUDE_TAGS:, else #+EXCLUDE_TAGS:, else org-icalendar-exclude-tags ("noexport" is not one by default)
    const filterDoc = /** @type {Doc} */ ({
      ...doc,
      keywords: [...(doc.keywords || []).filter((k) => k.key.toUpperCase() !== 'EXCLUDE_TAGS'), { key: 'EXCLUDE_TAGS', value: kw('ICALENDAR_EXCLUDE_TAGS').join(' ') || kw('EXCLUDE_TAGS').join(' ') || settings.excludeTags.join(' ') || '-', bodyLineIndex: 0 }],
    });
    const sequences = resolveTodoSequences(doc);
    const done = new Set(sequences.flatMap((q) => q.doneKeywords));
    const keep = buildFilter(/** @type {Parameters<typeof buildFilter>[0]} */ (/** @type {unknown} */ ({ doc: filterDoc, options: { comments: false, tasks: true }, doneKeywords: [...done] })));
    const category = [...serializeOrg(doc).matchAll(/^[ \t]*#\+CATEGORY:[ \t]*(.*)$/gim)].map((m) => m[1].trim()).at(-1) || nameOf.replace(/\.[^./]*$/, '');
    const ctx = {
      doc, name: nameOf, documentId, settings, stamp, category, done, uids: new Set(), keep, stripped,
      priorityHighest: options.priorityHighest ?? 65, priorityLowest: options.priorityLowest ?? 67,
    };
    const roots = options.scope ? options.scope.children || [] : doc.children || [];
    const ancestors = options.scope ? [options.scope] : [];
    if (options.scope) {
      const own = options.scope;
      // the text of the subtree's own heading is the body of the calendar; its timestamps are not events
      void own;
    }
    for (const h of roots) body += entry(h, options.scope ? ancestors : [], ctx);
  }
  const single = docs.length === 1 ? docs[0] : null;
  const first = single ? single.doc : null;
  const kwOf = (/** @type {Doc} */ d, /** @type {string} */ key) => (d.keywords || []).filter((k) => k.key.toUpperCase() === key).map((k) => k.value.trim());
  const name = single ? ((single.name || single.documentId || 'org').split(/[\\/:]/).pop() || 'org').replace(/\.[^./]*$/, '') : settings.combinedName;
  const owner = single ? kwOf(/** @type {Doc} */ (first), 'AUTHOR').join(' ') || settings.userFullName : settings.userFullName;
  const description = single ? (options.scope ? options.scope.title : kwOf(/** @type {Doc} */ (first), 'TITLE').join(' ')) : settings.combinedDescription;
  const head = ['BEGIN:VCALENDAR', 'VERSION:2.0', `X-WR-CALNAME:${cleanup(name)}`, `PRODID:-//${cleanup(owner)}//Emacs with Org mode//EN`, `X-WR-TIMEZONE:${cleanup(settings.timezone)}`, `X-WR-CALDESC:${cleanup(description)}`, 'CALSCALE:GREGORIAN'];
  return head.join('\r\n') + '\r\n' + body + (options.extra || '') + 'END:VCALENDAR\r\n';
}
