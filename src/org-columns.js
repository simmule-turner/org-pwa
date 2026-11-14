// @ts-check
/**
 * Column view (Emacs's org-colview.el): the format language (`%25ITEM(Task) %Effort{:}`), the value of each cell, the hierarchical
 * summaries (`{+}`, `{:}`, `{X/}`, `{est+}` ...) that are also written back into the properties of the parents, and the table the
 * `#+BEGIN: columnview` dynamic block writes. Compared with `org-update-dblock` in Emacs 29.3 (test/columns-oracle.test.js).
 */
import { run } from './elisp.js';
import { durationFromMinutes, durationHmmOnly, parseOrgDuration } from './org-duration.js';
import { layoutTable } from './org-table-layout.js';
import { recalculateTable } from './table-formula.js';
import { buildMatchEntry, entryPriority, entryPropertyValue, filePropertyEntries, firstTimestamp } from './search.js';
import { makeTagsMatcher } from './tags-match.js';
import { setProperty } from './archive-model.js';
import { bufferKeywordValues } from './file-keywords.js';
import { commitLines } from './body-edit.js';
import { parseOrg, serializeOrg } from './org-parser.js';
import { clockSum } from './clock-report.js';
import { isNil, listItems, NIL, readLisp } from './lisp-read.js';

/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {{ prop: string, title: string, width: number | null, op: string | null, printf: string | null }} ColumnSpec */
/**
 * What a column view needs from the app besides the document.
 * @typedef {object} ColumnsContext
 * @property {string} [category]  the category of a file that names none (the file name)
 * @property {string} [file]  the file's path, for the FILE column
 * @property {Date} [now]
 * @property {import('./tag-inheritance.js').TagInheritance} [tagInheritance]  org-use-tag-inheritance (default: all tags inherited)
 * @property {import('./tag-inheritance.js').PropertyInheritance} [propertyInheritance]  org-use-property-inheritance (default: none)
 * @property {string[]} [doneKeywords]
 * @property {string} [defaultFormat]  org-columns-default-format
 * @property {Map<string, string[]>} [tagGroups]
 * @property {string} [ellipses]  org-columns-ellipses
 * @property {(name: string, value: string) => string | null} [modifyValue]  org-columns-modify-value-for-display-function
 * @property {(id: string) => { doc: Doc, heading: Heading, file?: string, category?: string } | null} [findId]  where an ID lives, in any file
 * @property {(path: string) => { doc: Doc, file?: string, category?: string } | null} [findFile]  a file by its path
 */

export const DEFAULT_COLUMNS_FORMAT = '%25ITEM %TODO %3PRIORITY %TAGS';

/** Properties Org computes itself: an operator on them is ignored (org-special-properties). */
const SPECIAL = new Set(['ALLTAGS', 'BLOCKED', 'CLOCKSUM', 'CLOCKSUM_T', 'CLOSED', 'DEADLINE', 'FILE', 'ITEM', 'PRIORITY', 'SCHEDULED', 'TAGS', 'TIMESTAMP', 'TIMESTAMP_IA', 'TODO']);
const SPEC_RE = /%([0-9]+)?([\p{L}\p{N}_-]+)(?:\(([^)]+)\))?(?:\{([^}]+)\})?\s*/gu;

/** org-columns-compile-format. @param {string} fmt @returns {ColumnSpec[]} */
export function compileColumnsFormat(fmt) {
  /** @type {ColumnSpec[]} */
  const specs = [];
  for (const m of fmt.matchAll(SPEC_RE)) {
    let op = m[4] ?? null;
    let printf = null;
    if (op !== null) {
      const semi = op.indexOf(';');
      if (semi >= 0) {
        printf = op.slice(semi + 1);
        op = op.slice(0, semi);
      }
    }
    specs.push({ prop: m[2].toUpperCase(), title: m[3] ?? m[2], width: m[1] === undefined ? null : Number(m[1]), op, printf });
  }
  return specs;
}

/** org-columns-uncompile-format. @param {ColumnSpec[]} specs */
export function uncompileColumnsFormat(specs) {
  return specs
    .map((s) => `%${s.width ?? ''}${s.prop}${s.title !== s.prop ? `(${s.title})` : ''}${s.op === null ? '' : s.printf !== null ? `{${s.op};${s.printf}}` : `{${s.op}}`}`)
    .join(' ');
}

/** A Lisp string literal. @param {string} s */
const lstr = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Evaluates Lisp text that yields a string. @param {string} source @returns {string} */
function lisp(source) {
  const r = run(source);
  if (!r.ok) throw new Error(r.error);
  return /** @type {string} */ (r.value);
}

/** `(format printf (string-to-number value))`. @param {string} printf @param {string} value */
const formatNumber = (printf, value) => lisp(`(format ${lstr(printf)} (string-to-number ${lstr(value)}))`);
/** @param {string[]} values */
const numbers = (values) => `(mapcar #'string-to-number (list ${values.map(lstr).join(' ')}))`;

/** `string-to-number` in the way a Lisp number prints: the checkbox and estimate summaries read the leading number. @param {string} s */
const toNumber = (s) => Number(/^[ \t]*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(s)?.[1] ?? 0);

/** @param {string[]} times */
const applyTimes = (/** @type {(...n: number[]) => number} */ fun, times) => {
  const minutes = times.map((t) => {
    const m = parseOrgDuration(t);
    if (m === null) throw new Error(`Invalid duration: ${JSON.stringify(t)}`);
    return m;
  });
  return durationFromMinutes(fun(...minutes), durationHmmOnly(times));
};

/** org-columns--age-to-minutes. @param {string} s @param {number} now */
function ageToMinutes(s, now) {
  const ts = /[<[](\d{4})-(\d\d)-(\d\d)(?: [^\d\s>\]]+)?(?: (\d\d?):(\d\d))?[^>\]]*[>\]]/.exec(s);
  if (ts) return (now - new Date(Number(ts[1]), Number(ts[2]) - 1, Number(ts[3]), Number(ts[4] || 0), Number(ts[5] || 0)).getTime()) / 60000;
  const minutes = parseOrgDuration(s);
  if (minutes === null) throw new Error(`Invalid age: ${JSON.stringify(s)}`);
  return minutes;
}

/** org-columns--format-age: days, hours and minutes, each only when it is not zero. @param {number} minutes */
function formatAge(minutes) {
  const parts = [];
  let rest = minutes;
  for (const [unit, size] of /** @type {[string, number][]} */ ([['d', 1440], ['h', 60], ['min', 1]])) {
    if (size <= rest) {
      const value = Math.floor(rest / size);
      rest -= value * size;
      parts.push(`${value}${unit}`);
    }
  }
  return parts.length ? parts.join(' ') : '0min';
}

/** The summary functions of org-columns-summary-types-default: operator -> (values, printf, now) -> string. @type {Record<string, (values: string[], printf: string | null, now: number) => string>} */
const SUMMARIES = {
  '+': (v, p) => lisp(`(format ${lstr(p ?? '%s')} (apply #'+ ${numbers(v)}))`),
  $: (v) => lisp(`(format "%.2f" (apply #'+ ${numbers(v)}))`),
  X: (v) => {
    const done = v.filter((b) => b === '[X]').length;
    return done === v.length ? '[X]' : done > 0 ? '[-]' : '[ ]';
  },
  'X/': (v) => `[${v.filter((b) => b === '[X]' || /\[([1-9])\/\1\]/.test(b)).length}/${v.length}]`,
  'X%': (v) => lisp(`(format "[%d%%]" (round (* 100.0 ${v.filter((b) => b === '[X]' || b === '[100%]').length}) ${v.length}))`),
  max: (v, p) => lisp(`(format ${lstr(p ?? '%s')} (apply #'max ${numbers(v)}))`),
  mean: (v, p) => lisp(`(format ${lstr(p ?? '%s')} (/ (apply #'+ ${numbers(v)}) (float ${v.length})))`),
  min: (v, p) => lisp(`(format ${lstr(p ?? '%s')} (apply #'min ${numbers(v)}))`),
  ':': (v) => applyTimes((...n) => n.reduce((a, b) => a + b, 0), v),
  ':max': (v) => applyTimes(Math.max, v),
  ':mean': (v) => applyTimes((...n) => n.reduce((a, b) => a + b, 0) / n.length, v),
  ':min': (v) => applyTimes(Math.min, v),
  '@max': (v, _p, now) => formatAge(Math.max(...v.map((a) => ageToMinutes(a, now)))),
  '@mean': (v, _p, now) => formatAge(v.map((a) => ageToMinutes(a, now)).reduce((a, b) => a + b, 0) / v.length),
  '@min': (v, _p, now) => formatAge(Math.min(...v.map((a) => ageToMinutes(a, now)))),
  'est+': (v) => {
    let mean = 0;
    let variance = 0;
    for (const e of v) {
      const parts = e.split('-').map(toNumber);
      if (parts.length === 2) {
        const [low, high] = parts;
        const m = (low + high) / 2;
        mean += m;
        variance += (low * low + high * high) / 2 - m * m;
      } else if (parts.length === 1) mean += parts[0];
    }
    const sd = Math.sqrt(variance);
    return `${lisp(`(format "%.0f" ${mean - sd})`)}-${lisp(`(format "%.0f" ${mean + sd})`)}`;
  },
};

/** One heading of the file as the column view sees it. @typedef {{ heading: Heading, ancestors: Heading[], level: number, index: number, end: number, summaries: Map<string, string> }} Entry */

/** Every heading in document order, with the index where its subtree ends (exclusive). @param {Doc} doc @returns {Entry[]} */
function entriesOf(doc) {
  /** @type {Entry[]} */
  const out = [];
  /** @param {Heading[]} nodes @param {Heading[]} chain */
  const walk = (nodes, chain) => {
    for (const heading of nodes || []) {
      if (heading.type !== 'heading') continue;
      const entry = { heading, ancestors: chain, level: heading.level, index: out.length, end: 0, summaries: new Map() };
      out.push(entry);
      walk(heading.children, [...chain, heading]);
      entry.end = out.length;
    }
  };
  walk(doc.children, []);
  return out;
}

/** @param {Heading} h @param {string} name @returns {string | null} */
function ownProperty(h, name) {
  const key = Object.keys(h.properties || {}).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? null : h.properties[key];
}

const specKey = (/** @type {ColumnSpec} */ s) => JSON.stringify([s.prop, s.title, s.width, s.op, s.printf]);

/** A property of the file's own property drawer (the one before the first heading). @param {Doc} doc @param {string} name @returns {string | null} */
function documentProperty(doc, name) {
  const lines = doc.bodyLines || [];
  let i = lines.findIndex((l) => /\S/.test(l));
  if (i < 0 || !/^\s*:PROPERTIES:\s*$/i.test(lines[i])) return null;
  for (i++; i < lines.length && !/^\s*:END:\s*$/i.test(lines[i]); i++) {
    const m = /^\s*:([^\s:]+):(?:\s+(.*?))?\s*$/.exec(lines[i]);
    if (m && m[1].toUpperCase() === name.toUpperCase()) return m[2] ?? '';
  }
  return null;
}

/** The ITEM value: the headline without keyword, priority, tags and COMMENT. @param {Heading} h */
const itemText = (h) => String(h.title || '').replace(/^COMMENT(?:\s+|$)/, '');

/** The heading as it is now: the lines it was read from describe the properties it had when it was parsed, not after edits. @param {Heading} h @returns {Heading} */
const live = (h) => Object.create(h, { raw: { value: undefined } });

/** A computed column view of one document. */
export class ColumnView {
  /**
   * @param {Doc} doc
   * @param {ColumnsContext} [context]
   */
  constructor(doc, context = {}) {
    this.doc = doc;
    this.context = context;
    this.entries = entriesOf(doc);
    this.fileProps = filePropertyEntries(doc);
    this.fileTags = (doc.keywords || []).filter((k) => String(k.key).toUpperCase() === 'FILETAGS').flatMap((k) => String(k.value).split(/[:\s]+/).filter(Boolean));
    const cat = (doc.keywords || []).find((k) => String(k.key).toUpperCase() === 'CATEGORY');
    this.fileCategory = cat && String(cat.value).trim() ? String(cat.value).trim() : context.category ?? '';
    /** @type {ColumnSpec[]} */
    this.specs = [];
    this.top = /** @type {Entry | null} */ (null);
    this.now = (context.now || new Date()).getTime();
    this.updated = 0;
    this.clock = new Map();
  }

  /** @param {Heading} heading */
  entryOf(heading) {
    return /** @type {Entry} */ (this.entries.find((e) => e.heading === heading));
  }

  /** org-entry-get with inheritance for COLUMNS: the nearest heading with the property, then the file's property drawer. @param {Entry | null} entry @returns {{ value: string, from: Entry | null } | null} */
  columnsProperty(entry) {
    if (entry) {
      for (const h of [entry.heading, ...[...entry.ancestors].reverse()]) {
        const v = ownProperty(h, 'COLUMNS');
        if (v !== null) return { value: v, from: this.entryOf(h) };
      }
    }
    const v = documentProperty(this.doc, 'COLUMNS');
    return v === null ? null : { value: v, from: null };
  }

  /**
   * org-columns: settles the format and the top-level entry for point at `at` (null: before the first heading), then computes
   * every summary (writing them back when `update`).
   * @param {{ at: Entry | null, global: boolean, format?: string | null, update?: boolean }} options
   */
  prepare({ at, global, format = null, update = true }) {
    const pointEntry = global ? (this.hasPreamble() ? null : this.entries[0] || null) : at;
    const inherited = this.columnsProperty(pointEntry);
    this.top = pointEntry === null ? null : inherited ? inherited.from : pointEntry;
    const keywordFormat = bufferKeywordValues(this.doc, 'COLUMNS').find((v) => /\S/.test(v));
    const formatText = format ?? (this.top ? this.columnsProperty(this.top)?.value : this.columnsProperty(null)?.value) ?? (keywordFormat !== undefined ? keywordFormat.trim() : null) ?? this.context.defaultFormat ?? DEFAULT_COLUMNS_FORMAT;
    this.formatText = formatText;
    this.specs = compileColumnsFormat(formatText);
    this.local = !global;
    const seen = new Set();
    for (const spec of this.specs) {
      this.computeSpec(spec, update && !seen.has(spec.prop));
      seen.add(spec.prop);
    }
  }

  hasPreamble() {
    return (this.doc.bodyLines || []).length > 0 || (this.doc.keywords || []).some((k) => !k.virtual);
  }

  /** org-columns--compute-spec. @param {ColumnSpec} spec @param {boolean} update */
  computeSpec(spec, update) {
    const op = SPECIAL.has(spec.prop) ? null : spec.op;
    if (op === null) return;
    const summarize = SUMMARIES[op];
    if (!summarize) throw new Error(`Unknown "${op}" operator`);
    const first = this.top ? this.top.index : 0;
    const last = this.top ? this.top.end : this.entries.length;
    const lmax = 29;
    /** @type {string[][]} */
    const lvals = Array.from({ length: lmax + 1 }, () => []);
    let level = 0;
    const inminlevel = lmax;
    let lastLevel = lmax;
    const key = specKey(spec);
    for (let i = last - 1; i >= first; i--) {
      const entry = this.entries[i];
      if (!(level === 0 || level === inminlevel)) lastLevel = level;
      level = entry.level;
      const value = ownProperty(entry.heading, spec.prop);
      const valueSet = value !== null && /\S/.test(value);
      if (level < lastLevel) {
        const values = [...(lastLevel !== inminlevel ? lvals[lastLevel] : []), ...lvals[inminlevel]];
        const summary = values.length ? summarize(values, spec.printf, this.now) : null;
        if (summary !== null) {
          entry.summaries.set(key, summary);
          const trimmed = summary.trim();
          if (update && value !== null && value !== trimmed) {
            setProperty(entry.heading, spec.prop, trimmed);
            this.updated++;
          }
        }
        if (summary !== null || valueSet) lvals[level].unshift(summary ?? /** @type {string} */ (value));
        for (let l = level + 1; l <= lmax; l++) lvals[l] = [];
      } else if (valueSet) lvals[level].unshift(/** @type {string} */ (value));
    }
  }

  /** The minutes clocked on an entry and everything below it (org-clock-sum): finished clocks only, from the start of today for `today`. @param {Entry} entry @param {boolean} today */
  clockMinutes(entry, today) {
    const key = today ? 'today' : 'all';
    if (!this.clock.has(key)) {
      const now = new Date(this.now);
      this.clock.set(key, clockSum(this.doc.children, today ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() : null, null, null).time);
    }
    return this.clock.get(key).get(entry.heading) || 0;
  }

  /** The value `org-entry-get` gives for the property (inherited as org-use-property-inheritance says), or null. @param {Entry} entry @param {string} name */
  entryValue(entry, name) {
    const h = entry.heading;
    switch (name) {
      case 'ITEM': return itemText(h);
      case 'TODO': return h.todo || null;
      case 'PRIORITY': return entryPriority(h);
      case 'TAGS': return h.tags && h.tags.length ? `:${h.tags.join(':')}:` : null;
      case 'ALLTAGS': {
        const all = this.matchEntry(entry).tags;
        const tags = [...new Set([...this.fileTags, ...entry.ancestors.flatMap((a) => a.tags || []), ...(h.tags || [])])].filter((t) => all.includes(t));
        return tags.length ? `:${tags.join(':')}:` : null;
      }
      case 'CATEGORY': return this.matchEntry(entry).category;
      case 'FILE': return this.context.file || null;
      case 'DEADLINE': return h.planning?.deadline || null;
      case 'SCHEDULED': return h.planning?.scheduled || null;
      case 'CLOSED': return h.planning?.closed || null;
      case 'TIMESTAMP': return firstTimestamp(h, true);
      case 'TIMESTAMP_IA': return firstTimestamp(h, false);
      case 'BLOCKED': return null;
      case 'CLOCKSUM':
      case 'CLOCKSUM_T': {
        const minutes = this.clockMinutes(entry, name === 'CLOCKSUM_T');
        return minutes > 0 ? durationFromMinutes(minutes, 'h:mm') : null;
      }
      default: {
        return entryPropertyValue(live(h), entry.ancestors.map(live), name, this.context.propertyInheritance ?? false, this.fileProps);
      }
    }
  }

  /** @param {Entry} entry */
  matchEntry(entry) {
    return buildMatchEntry(live(entry.heading), entry.ancestors.map(live), this.context.tagInheritance ?? true, this.context.propertyInheritance ?? false, this.fileCategory, this.fileTags, this.fileProps, this.context.file || '');
  }

  /**
   * org-columns--collect-values and org-columns--displayed-value: [value, displayed] for each column of an entry.
   * @param {Entry} entry @returns {{ spec: ColumnSpec, value: string, displayed: string }[]}
   */
  cells(entry) {
    return this.specs.map((spec) => {
      const value = entry.summaries.get(specKey(spec)) ?? this.entryValue(entry, spec.prop) ?? '';
      let displayed;
      const modified = this.context.modifyValue ? this.context.modifyValue(spec.title, value) : null;
      if (modified !== null && modified !== undefined) displayed = modified;
      else if (spec.prop === 'ITEM') displayed = value;
      else if (spec.prop === 'DEADLINE' || spec.prop === 'SCHEDULED' || spec.prop === 'TIMESTAMP') displayed = value.replace(/[<[](\d{4}-\d\d-\d\d[^>\]\n]*)[>\]]/g, '[$1]');
      else if (spec.printf === null) displayed = value;
      else displayed = formatNumber(spec.printf, value);
      return { spec, value, displayed };
    });
  }

  /** The entries of the view, in order. */
  viewEntries() {
    const first = this.local && this.top ? this.top.index : 0;
    const last = this.local && this.top ? this.top.end : this.entries.length;
    return this.entries.slice(first, last);
  }
}

const REMOVED_OBJECT = /\[fn:[^\]\n]*\]|<<<[^<>\n]+>>>|<<[^<>\n]+>>|\[\d*(?:%|\/\d*)\]|(?:src|call)_[^\s{[(]+(?:\[[^\]\n]*\])?(?:\{[^\n}]*\}|\([^\n)]*\))/g;

/**
 * org-columns--clean-item: footnote references, targets, statistics cookies and inline code leave a heading cell, each with the
 * blanks after it. An object that begins the text stays (Org's walk over the parsed text skips its first node).
 * @param {string} item
 */
function cleanItem(item) {
  return item.replace(REMOVED_OBJECT, (match, offset) => (offset === 0 ? match : '\u0000')).replace(/\u0000[ \t]*/g, '');
}

/** `#+BEGIN: columnview` parameters, as a plist. @param {string} text @returns {Map<string, import('./lisp-read.js').Lisp>} */
export function readColumnviewParams(text) {
  /** @type {Map<string, import('./lisp-read.js').Lisp>} */
  const params = new Map();
  const forms = readLisp(`(${text})`);
  const items = forms.length ? listItems(forms[0]) : [];
  if (!items) throw new Error('Invalid columnview parameters');
  for (let i = 0; i < items.length; i += 2) {
    const key = items[i];
    if (!key || key.k !== 'sym' || !key.v.startsWith(':')) throw new Error(`Invalid columnview parameter ${key && 'v' in key ? key.v : ''}`);
    params.set(key.v.slice(1), items[i + 1] ?? NIL);
  }
  return params;
}

/**
 * org-dblock-write:columnview: the rows of the table (null for a rule), and the format they were made from.
 * @param {Doc} doc the document holding the block
 * @param {Heading | null} blockHeading the heading the block is under (null before the first one)
 * @param {Map<string, import('./lisp-read.js').Lisp>} params
 * @param {ColumnsContext} [context]
 * @returns {{ rows: (string[] | null)[] }}
 */
export function columnviewRows(doc, blockHeading, params, context = {}) {
  const get = (/** @type {string} */ name) => params.get(name);
  const truthy = (/** @type {import('./lisp-read.js').Lisp | undefined} */ v) => v !== undefined && !isNil(v);
  const text = (/** @type {import('./lisp-read.js').Lisp | undefined} */ v) => (v && v.k === 'str' ? v.v : v && v.k === 'sym' ? v.v : null);
  const number = (/** @type {import('./lisp-read.js').Lisp | undefined} */ v) => (v && v.k === 'num' ? v.v : null);

  const idForm = get('id');
  const id = idForm ? text(idForm) : null;
  /** @type {{ doc: Doc, context: ColumnsContext, at: Heading | null, global: boolean }} */
  let target = { doc, context, at: blockHeading, global: false };
  if (id === 'global') target = { doc, context, at: null, global: true };
  else if (id !== null && id !== 'local') {
    const file = /^file:(.*)$/.exec(id);
    if (file) {
      const found = context.findFile && context.findFile(file[1]);
      if (!found) throw new Error(`A column view of another file cannot be written here: ${JSON.stringify(id)}`);
      target = { doc: found.doc, context: { ...context, file: found.file, category: found.category }, at: null, global: false };
    } else {
      const own = findIdIn(doc, id);
      const found = own ? { doc, heading: own, file: context.file, category: context.category } : context.findId && context.findId(id);
      if (!found) throw new Error(`Cannot find entry with :ID: ${id}`);
      target = { doc: found.doc, context: { ...context, file: found.file, category: found.category }, at: found.heading, global: false };
    }
  }
  const view = new ColumnView(target.doc, target.context);
  const at = target.at ? view.entryOf(target.at) : null;
  view.prepare({ at, global: target.global, format: text(get('format')) });
  if (view.local && view.top === null) throw new Error('Before first headline');

  const maxlevel = number(get('maxlevel'));
  const match = text(get('match'));
  const skipEmpty = truthy(get('skip-empty-rows'));
  const excludeTags = (() => {
    const v = get('exclude-tags');
    return v && v.k === 'list' ? (listItems(v) || []).map(text).filter((t) => t !== null) : [];
  })();
  const matchText = match ? match + (maxlevel !== null ? `+LEVEL<=${maxlevel}` : '') : maxlevel !== null ? `LEVEL<=${maxlevel}` : null;
  const doneKeywords = context.doneKeywords || ['DONE'];
  const matcher = matchText ? makeTagsMatcher(matchText, { doneKeywords, tagGroups: context.tagGroups }) : null;

  const hasItem = view.specs.some((s) => s.prop === 'ITEM');
  /** @type {{ level: number, row: string[] }[]} */
  const table = [];
  let skipUntil = -1;
  for (const entry of view.viewEntries()) {
    if (entry.index < skipUntil) continue;
    const h = entry.heading;
    if ((h.tags || []).includes('ARCHIVE') || /^COMMENT(?:\s|$)/.test(String(h.title || ''))) {
      skipUntil = entry.end;
      continue;
    }
    if (matcher) {
      const m = view.matchEntry(entry);
      if (!matcher.test(m) || (matcher.todoOnly && !(h.todo && !doneKeywords.includes(h.todo)))) continue;
    }
    const cells = view.cells(entry);
    const row = cells.map((c) => (c.spec.prop === 'ITEM' ? c.value : c.displayed).replace(/\|/g, '\\vert'));
    if (skipEmpty) {
      const r = [...new Set(row.filter((v) => v !== ''))];
      if (r.length === 0 || (hasItem && r.length === 1)) continue;
    }
    if (excludeTags.length) {
      const tags = view.matchEntry(entry).tags;
      if (excludeTags.some((t) => tags.includes(/** @type {string} */ (t)))) continue;
    }
    table.push({ level: entry.level, row });
  }

  const hlines = get('hlines');
  const indent = truthy(get('indent'));
  const itemIndex = view.specs.findIndex((s) => s.prop === 'ITEM');
  /** @type {(string[] | null)[]} */
  let rows = [view.specs.map((s) => s.title), null];
  for (const { level, row } of table) {
    if (rows[rows.length - 1] !== null && hlines && (hlines.k === 'sym' ? hlines.v === 't' : hlines.k === 'num' && level <= hlines.v)) rows.push(null);
    if (itemIndex >= 0) {
      const item = cleanItem(row[itemIndex]);
      row[itemIndex] = indent && level > 1 ? `\\_${' '.repeat(2 * (level - 1))}${item}` : item;
    }
    rows.push(row);
  }
  if (truthy(get('vlines'))) rows = [...rows.map((r) => (r === null ? r : ['', ...r])), ['/', ...view.specs.map(() => '<>')]];
  return { rows };
}

/** @param {Doc} doc @param {string} id @returns {Heading | null} */
function findIdIn(doc, id) {
  /** @param {Heading[]} nodes @returns {Heading | null} */
  const walk = (nodes) => {
    for (const h of nodes || []) {
      if (h.type !== 'heading') continue;
      if (ownProperty(h, 'ID') === id) return h;
      const f = walk(h.children);
      if (f) return f;
    }
    return null;
  };
  return walk(doc.children);
}

/** The lines of the table as `org-table-align` leaves them. @param {(string[] | null)[]} rows */
export function columnviewTableLines(rows) {
  return layoutTable(rows.map((r) => (r ? r.map((c) => c.trim()) : r)));
}

const BEGIN_RE = /^([ \t]*)#\+BEGIN:[ \t]+columnview\b[ \t]*(.*)$/i;
const END_RE = /^[ \t]*#\+END:?[ \t]*$/i;

/**
 * org-update-dblock for the `columnview` block that begins on line `lineIndex` of `lines`: the new lines of the block (its
 * `#+BEGIN:` line, the table, its `#+END:` line) and how many lines it had.
 * @param {string[]} lines @param {number} lineIndex @param {Doc} doc @param {Heading | null} heading @param {ColumnsContext} [context]
 * @returns {{ count: number, lines: string[] }}
 */
export function updateColumnviewBlock(lines, lineIndex, doc, heading, context = {}) {
  const begin = BEGIN_RE.exec(lines[lineIndex]);
  if (!begin) throw new Error('Not at a columnview block');
  let end = lineIndex + 1;
  while (end < lines.length && !END_RE.test(lines[end])) end++;
  if (end >= lines.length) throw new Error('Dynamic block not terminated');
  const indent = begin[1];
  const old = lines.slice(lineIndex + 1, end);
  const params = readColumnviewParams(begin[2]);
  const { rows } = columnviewRows(doc, heading, params, context);
  /** @type {string[]} */
  const out = [];
  let k = 0;
  while (k < old.length && /^[ \t]*#\+/.test(old[k])) out.push(old[k++]);
  const tblfm = old.slice(k).filter((line) => /^[ \t]*#\+TBLFM:/i.test(line));
  let cells = rows;
  if (tblfm.length) {
    // `org-table-recalculate 'all` runs the first formula line
    const formula = tblfm[0].replace(/^[ \t]*#\+TBLFM:[ \t]*/i, '');
    /** @type {import('./types.js').TableRow[]} */
    const tableRows = rows.map((r) => (r ? { type: /** @type {const} */ ('row'), cells: r.map((c) => c.trim()) } : { type: /** @type {const} */ ('rule') }));
    const done = recalculateTable({ type: 'table', rows: tableRows, tblfm: formula, lineIndex: 0, lineCount: tableRows.length });
    if (done) cells = done.map((r) => (r.type === 'rule' ? null : r.cells));
  }
  out.push(...columnviewTableLines(cells), ...tblfm);
  return { count: end - lineIndex + 1, lines: [lines[lineIndex], ...out.map((l) => (l ? indent + l : l)), lines[end]] };
}

/**
 * org-columns-store-format: the format is kept in the COLUMNS property of the heading that starts the view when that heading has
 * one of its own, otherwise in the first `#+COLUMNS:` line of the file, which is added before the first heading when there is none.
 * @param {Doc} doc @param {Heading | null} top @param {string} format
 */
export function storeColumnsFormat(doc, top, format) {
  if (top && ownProperty(top, 'COLUMNS') !== null) {
    setProperty(top, 'COLUMNS', format);
    return;
  }
  const keyword = (doc.keywords || []).find((k) => String(k.key).toUpperCase() === 'COLUMNS' && !k.virtual);
  if (keyword) {
    keyword.value = format;
    return;
  }
  /** @type {Heading[]} */
  const stack = [...(doc.children || [])];
  while (stack.length) {
    const h = /** @type {Heading} */ (stack.shift());
    const at = (h.bodyLines || []).findIndex((l) => /^[ \t]*#\+COLUMNS:/i.test(l));
    if (at >= 0) {
      commitLines(h, at, 1, [h.bodyLines[at].replace(/(#\+COLUMNS:).*/i, `$1 ${format}`)]);
      return;
    }
    stack.unshift(...(h.children || []));
  }
  doc.keywords.push({ key: 'COLUMNS', value: format, bodyLineIndex: (doc.bodyLines || []).length });
}

/**
 * Updates every `columnview` block in the lines of `node` (a heading's body): org-update-all-dblocks for that stretch of text.
 * @param {Doc} doc @param {Heading} node @param {ColumnsContext} [context] @returns {number} how many blocks were written
 */
export function updateColumnviewBlocksUnder(doc, node, context = {}) {
  let count = 0;
  for (let i = 0; i < node.bodyLines.length; i++) {
    if (!BEGIN_RE.test(node.bodyLines[i])) continue;
    const r = updateColumnviewBlock(node.bodyLines, i, doc, node, context);
    commitLines(node, i, r.count, r.lines);
    i += r.lines.length - 1;
    count++;
  }
  return count;
}

/** The blocks above the first heading, where `#+BEGIN:` reads as a keyword of the file: the text is written out, updated and read again. @param {Doc} doc @param {ColumnsContext} [context] */
function updateBlocksInPreamble(doc, context = {}) {
  const lines = serializeOrg(doc).split('\n');
  const first = lines.findIndex((l) => /^\*+[ \t]/.test(l));
  const preamble = first < 0 ? lines : lines.slice(0, first);
  let count = 0;
  for (let i = 0; i < preamble.length; i++) {
    if (!BEGIN_RE.test(preamble[i])) continue;
    const r = updateColumnviewBlock(preamble, i, doc, null, context);
    preamble.splice(i, r.count, ...r.lines);
    i += r.lines.length - 1;
    count++;
  }
  if (count) {
    const read = parseOrg(preamble.join('\n'));
    doc.keywords = [...read.keywords, ...(doc.keywords || []).filter((k) => k.virtual)];
    doc.bodyLines = read.bodyLines;
  }
  return count;
}

/** Updates every `columnview` block of the file, in file order. @param {Doc} doc @param {ColumnsContext} [context] */
export function updateAllColumnviewBlocks(doc, context = {}) {
  let count = updateBlocksInPreamble(doc, context);
  for (const entry of entriesOf(doc)) count += updateColumnviewBlocksUnder(doc, entry.heading, context);
  return count;
}
