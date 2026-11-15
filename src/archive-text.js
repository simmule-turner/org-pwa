// @ts-check
/**
 * Archiving as Emacs does it, on the text: `org-archive-subtree` (any location: the heading of a file, an `::datetree/` tree, a heading
 * that is made when it is missing, reversed order), `org-archive-to-archive-sibling` and the date tree functions they use
 * (`org-datetree-find-date-create`, `org-datetree-find-month-create`, `org-datetree-add-timestamp`). Org moves a subtree by copying its text,
 * pasting it at the place it found and cutting the original, with the blank lines that come with it, so the work is done on the text of
 * the files, with a point, a narrowing and markers as the Emacs buffer has them. The functions return the new text of the files.
 */
import { parseOrg, serializeOrg, serializeHeadingLine, findHeadingLineNumber, findHeadingAtLine } from './org-parser.js';
import { updateCookiesAfterArchive, updateTodoCookiesUpward } from './checkbox-cookie.js';
import { createHeading } from './heading-edit.js';
import { buildArchivedClone, cloneHeading, findAncestorPath, parseArchiveLocation, setProperty, getArchiveLocation } from './archive-model.js';
import { readArchiveSettings } from './archive-settings.js';
import { formatTimeString } from './format-time.js';
import { blankBeforeNew } from './blank-before-entry.js';

/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./archive-settings.js').ArchiveSettings} ArchiveSettings */

/** An Emacs buffer in the small: its text, point, narrowing and markers. */
class Buf {
  /** @param {string} text */
  constructor(text) {
    this.t = text;
    this.pt = 0;
    this.min = 0;
    this.max = text.length;
    /** @type {{ pos: number, advance: boolean }[]} */
    this.markers = [];
  }

  /** @param {number} pos @param {boolean} [advance] insertion type: whether text inserted at the marker moves it on */
  marker(pos, advance = false) {
    const m = { pos, advance };
    this.markers.push(m);
    return m;
  }

  get bolp() { return this.pt === this.min || this.t[this.pt - 1] === '\n'; }
  get eobp() { return this.pt >= this.max; }
  get size() { return this.t.length; }

  /** @param {string} s */
  insert(s) {
    if (!s) return;
    const at = this.pt;
    this.t = this.t.slice(0, at) + s + this.t.slice(at);
    for (const m of this.markers) if (m.pos > at || (m.pos === at && m.advance)) m.pos += s.length;
    this.max += s.length;
    this.pt = at + s.length;
  }

  /** @param {number} from @param {number} to */
  delete(from, to) {
    if (to <= from) return;
    const len = to - from;
    this.t = this.t.slice(0, from) + this.t.slice(to);
    const adj = (/** @type {number} */ p) => (p >= to ? p - len : p > from ? from : p);
    for (const m of this.markers) m.pos = adj(m.pos);
    this.pt = adj(this.pt);
    this.max -= len;
  }

  /** The next match of `re` (not global) from point, within the narrowing; point goes to its end. @param {RegExp} re @param {number} [bound] */
  searchForward(re, bound = this.max) {
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const g = new RegExp(re.source, (flags.includes('m') ? flags : flags + 'm') + (flags.includes('d') ? '' : 'd'));
    const s = this.t.slice(this.min, bound);
    g.lastIndex = this.pt - this.min;
    const m = g.exec(s);
    if (!m) return null;
    this.pt = this.min + m.index + m[0].length;
    const g1 = m.indices && m.indices[1] ? this.min + m.indices[1][0] : this.min + m.index;
    return { start: this.min + m.index, end: this.pt, m, group1: g1 };
  }

  /** @param {number} [p] */
  lineStart(p = this.pt) {
    const i = this.t.lastIndexOf('\n', p - 1);
    return Math.max(this.min, i + 1);
  }

  /** @param {number} [p] */
  lineEnd(p = this.pt) {
    const i = this.t.indexOf('\n', p);
    return i < 0 || i > this.max ? this.max : i;
  }

  /** The text of the line starting at p. @param {number} p */
  lineAt(p) {
    return this.t.slice(p, this.lineEnd(p));
  }

  /** @param {number} p */
  atHeadingAt(p) {
    return (p === this.min || this.t[p - 1] === '\n') && /^\*+ /.test(this.t.slice(p, p + 200));
  }

  get atHeading() { return this.atHeadingAt(this.pt); }

  /** outline-next-heading: the start of the next heading line, or the end of the text. */
  outlineNextHeading() {
    if (this.bolp && !this.eobp) this.pt++;
    const r = this.searchForward(/^\*+ /m);
    this.pt = r ? r.start : this.max;
  }

  /** org-back-to-heading (invisible-ok): the start of the heading at or above point. */
  backToHeading() {
    let p = this.lineStart();
    for (;;) {
      if (this.atHeadingAt(p)) {
        this.pt = p;
        return;
      }
      if (p <= this.min) throw new Error('Before first headline at position ' + this.pt);
      p = this.lineStart(p - 1);
    }
  }

  /** The level of the heading at point. */
  get level() {
    const m = /^\*+/.exec(this.t.slice(this.pt, this.pt + 200));
    return m ? m[0].length : 0;
  }

  /** org-end-of-subtree. @param {boolean} toHeading */
  endOfSubtree(toHeading) {
    this.backToHeading();
    const level = this.level;
    this.pt++;
    const re = new RegExp(`^\\*{1,${level}} `, 'm');
    const r = this.searchForward(re);
    this.pt = r ? r.start : this.max;
    if (!toHeading && this.t[this.pt - 1] === '\n') {
      this.pt--;
      if (this.t[this.pt - 1] === '\n') this.pt--;
    }
  }

  /** The subtree of the heading at `p`: its end, the start of the next heading of its level or above, or the end of the text. @param {number} p */
  subtreeEnd(p) {
    const keep = this.pt;
    this.pt = p;
    this.endOfSubtree(true);
    const end = this.pt;
    this.pt = keep;
    return end;
  }

  /** org-narrow-to-subtree, from the heading at point. */
  narrowToSubtree() {
    this.backToHeading();
    const start = this.pt;
    this.endOfSubtree(true);
    if (this.atHeading && !this.eobp) this.pt--;
    this.min = start;
    this.max = this.pt;
    this.pt = start;
  }

  widen() {
    this.min = 0;
    this.max = this.t.length;
  }

  /** skip-chars-backward " \t\n". */
  skipBlanksBackward() {
    while (this.pt > this.min && /[ \t\n\r]/.test(this.t[this.pt - 1])) this.pt--;
  }

  /** org-previous-line-empty-p. */
  previousLineEmpty() {
    const ls = this.lineStart();
    if (ls <= this.min) return false;
    const prev = this.lineStart(ls - 1);
    return /^[ \t]*$/.test(this.t.slice(prev, ls - 1));
  }

  /** org--blank-before-heading-p with org-blank-before-new-entry at its default (auto); throws where Org signals an error. */
  blankBeforeHeading() {
    return blankBeforeNew('heading', () => this.blankBeforeHeadingAuto());
  }

  /** The `auto` case of blankBeforeHeading. */
  blankBeforeHeadingAuto() {
    const keep = this.pt;
    try {
      const before = (() => {
        const ls = this.lineStart();
        const le = this.lineEnd();
        const upTo = this.t.slice(this.min, le);
        return /^\*+ /m.test(upTo) && ls >= 0;
      })();
      if (!before) {
        // before the first heading: nothing to look back to unless a heading follows
        const save = this.pt;
        this.outlineNextHeading();
        const has = !this.eobp;
        this.pt = save;
        if (!has) return false;
      }
      this.backToHeading();
      if (this.pt !== this.min) return this.previousLineEmpty();
      this.outlineNextHeading();
      if (!this.eobp) return this.previousLineEmpty();
      // no heading follows: the end of the text, trailing blanks on its last line ignored
      this.pt = this.max;
      while (this.pt > this.min && /[ \t]/.test(this.t[this.pt - 1])) this.pt--;
      if (this.bolp) return this.previousLineEmpty();
      return false;
    } finally {
      this.pt = keep;
    }
  }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');

/**
 * org-datetree--find-create-group: finds or creates the entry for `date` ([year, month, day]) in the buffer, widening it first. Point is
 * left at the start of the day (or month) heading.
 * @param {Buf} b @param {number[]} date @param {'day' | 'month' | 'week'} grouping
 * @param {{ addTimestamp?: 'active' | 'inactive' | null }} [opts]
 */
function datetreeFindCreate(b, date, grouping, opts = {}) {
  const [year, month, day] = date;
  b.widen();
  let baseLevel = 1;
  // the old way of placing the tree: a DATE_TREE (WEEK_TREE for the week) property
  const prop = grouping === 'week' ? 'WEEK_TREE' : 'DATE_TREE';
  const found = findProperty(b, prop);
  if (found !== null) {
    b.pt = found;
    baseLevel = b.level + 1;
    b.narrowToSubtree();
  }
  b.pt = b.min;
  /**
   * @param {RegExp} re group 1 is the number to compare
   * @param {number} target @param {boolean} narrow @param {() => string} text
   * @param {number} depth how many levels below the base the new heading goes
   */
  const findCreate = (re, target, narrow, text, depth) => {
    if (narrow) b.narrowToSubtree();
    b.pt = b.min;
    let match;
    for (;;) {
      match = b.searchForward(re);
      if (!match) break;
      b.pt = match.group1;
      if (!(Number(match.m[1]) < target)) break;
    }
    if (!match) {
      b.pt = b.max;
      if (!b.bolp) b.insert('\n');
      insertLine(b, baseLevel + depth, text(), grouping, date, depth === 2, opts.addTimestamp ?? null);
    } else if (Number(match.m[1]) === target) {
      b.pt = b.lineStart(match.start);
    } else {
      b.pt = b.lineStart(match.start);
      insertLine(b, baseLevel + depth, text(), grouping, date, depth === 2, opts.addTimestamp ?? null);
    }
  };
  const dateOf = new Date(year, month - 1, day, 12);
  const yearRe = /^\*+[ \t]+([12][0-9]{3})(\s*?([ \t]:[\p{L}\p{N}:_@#%]+:)?\s*$)/mu;
  if (grouping === 'week') {
    const isoYear = Number(formatTimeString(dateOf, '%G'));
    const isoWeek = Number(formatTimeString(dateOf, '%V'));
    findCreate(yearRe, isoYear, false, () => formatTimeString(dateOf, '%G'), 0);
    findCreate(new RegExp(`^\\*+[ \\t]+${isoYear}-W([0-5][0-9])$`, 'mu'), isoWeek, true, () => formatTimeString(dateOf, '%G-W%V'), 1);
    findCreate(new RegExp(`^\\*+[ \\t]+${year}-${pad2(month)}-([0123][0-9]) [\\p{L}\\p{N}_]+$`, 'mu'), day, true, () => `${year}-${pad2(month)}-${pad2(day)} ${WEEKDAYS[dateOf.getDay()]}`, 2);
    return;
  }
  findCreate(yearRe, year, false, () => String(year), 0);
  findCreate(new RegExp(`^\\*+[ \\t]+${year}-([01][0-9]) [\\p{L}\\p{N}_]+$`, 'mu'), month, true, () => `${year}${formatTimeString(dateOf, '-%m %B')}`, 1);
  if (grouping === 'day') findCreate(new RegExp(`^\\*+[ \\t]+${year}-${pad2(month)}-([0123][0-9]) [\\p{L}\\p{N}_]+$`, 'mu'), day, true, () => `${year}-${pad2(month)}-${pad2(day)} ${WEEKDAYS[dateOf.getDay()]}`, 2);
}

/** org-find-property: the start of the first entry that sets `name` (to a value that is not nil). @param {Buf} b @param {string} name */
function findProperty(b, name) {
  const re = new RegExp(`^[ \\t]*:${name}:`, 'im');
  const keep = b.pt;
  b.pt = b.min;
  const r = b.searchForward(re);
  b.pt = keep;
  if (!r) return null;
  let p = b.lineStart(r.start);
  while (p > b.min && !b.atHeadingAt(p)) p = b.lineStart(p - 1);
  return b.atHeadingAt(p) ? p : b.min;
}

/**
 * org-datetree-insert-line: a new heading at point.
 * @param {Buf} b @param {number} level @param {string} title @param {string} grouping @param {number[]} date @param {boolean} isDay
 * @param {'active' | 'inactive' | null} stamp
 */
function insertLine(b, level, title, grouping, date, isDay, stamp) {
  const from = (() => {
    const keep = b.pt;
    b.skipBlanksBackward();
    const p = b.pt;
    b.pt = keep;
    return p;
  })();
  b.delete(from, b.pt);
  if (b.blankBeforeHeading()) b.insert('\n');
  b.insert('\n' + '*'.repeat(level) + ' ' + title);
  if (isDay && stamp) {
    const [year, month, day] = date;
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(year, month - 1, day, 12).getDay()];
    const ts = `${year}-${pad2(month)}-${pad2(day)} ${wd}`;
    b.insert('\n' + (stamp === 'inactive' ? `[${ts}]` : `<${ts}>`));
  }
  b.insert('\n');
  b.pt = b.lineStart(b.pt - 1);
  // the heading line has been made at the line before the end of the new text; point goes to its start
  while (!b.atHeadingAt(b.pt)) b.pt = b.lineStart(b.pt - 1);
}

/**
 * org-paste-subtree with the level forced: `text` (a subtree) goes in at point, as Emacs puts it, its headings shifted so the first is at `level`.
 * Returns the start of what was pasted.
 * @param {Buf} b @param {string} text @param {number} level
 */
function paste(b, text, level) {
  if (!(b.bolp && b.atHeading)) {
    // org-next-visible-heading: from the end of the line to the next heading, or the end of the text
    b.pt = b.lineEnd();
    const r = b.searchForward(/^\*+ /m);
    b.pt = r ? r.start : b.max;
    if (!b.bolp) b.insert('\n');
  }
  const start = b.pt;
  const old = /^\*+/.exec(text);
  const shift = old ? level - old[0].length : 0;
  let shifted = text;
  if (shift !== 0) {
    shifted = text.replace(/^(\*+)( )/gm, (_m, stars, sp) => '*'.repeat(Math.max(1, stars.length + shift)) + sp);
  }
  b.insert(shifted);
  if (!shifted.endsWith('\n')) b.insert('\n');
  return start;
}

/** The text of a subtree as it is written to a file: what Emacs pastes once the properties are in.
 * @param {Heading} heading */
export function subtreeText(heading) {
  const mini = parseOrg('');
  mini.children = [heading];
  mini.keywords = [];
  mini.bodyLines = [];
  return serializeOrg(mini);
}

/**
 * org-archive-subtree.
 * @param {{
 *   srcText: string, srcStart: number, text: string, srcPath: string,
 *   location: string, infile: boolean, tgtText: string | null, newFile?: boolean, tgtIsOrg?: boolean,
 *   settings: ArchiveSettings, date: number[] | null,
 * }} p  `text`: the stamped copy of the subtree (levels as in the source, see subtreeText); `location`: the part after the "::" of the location;
 *   `tgtText`: the other file (null when the subtree stays in its file); `date`: [year, month, day] of the CLOSED time or of now
 * @returns {{ srcText: string, tgtText: string | null, cutAt: number }} `cutAt`: where the subtree was cut from `srcText`
 */
export function archiveSubtreeText(p) {
  const { settings } = p;
  let heading = p.location.replace(/%s/g, p.srcPath.split('/').pop() || '');
  let datetreeDate = null;
  let subheading = false;
  const dt = /^datetree\/(\**)/.exec(heading);
  if (dt) {
    const nsub = dt[1].length;
    heading = '*'.repeat(3 + nsub) + heading.slice(dt[0].length); // "datetree/" is three levels of headings
    subheading = nsub > 0;
    datetreeDate = p.date;
  }
  const stars = /^\*+/.exec(heading);
  /** @type {string | null} */ const headingText = heading.length > 0 && stars ? heading : null;
  const level = headingText && stars ? stars[0].length : 0;
  const pasteLevel = headingText ? level + 1 : 1;
  const run = (/** @type {Buf} */ b, /** @type {number | null} */ cutFrom) => {
    if (p.tgtText !== null && b.t === '' && !p.tgtIsOrg) b.insert('#    -*- mode: org -*-\n\n'); // Org makes an empty file that is not an .org one an Org file
    if (p.newFile && settings.fileHeaderFormat) {
      b.pt = b.max;
      b.insert(settings.fileHeaderFormat.replace(/%s/g, p.srcPath));
    }
    if (datetreeDate) {
      datetreeFindCreate(b, datetreeDate, 'day', { addTimestamp: settings.datetreeTimestamp });
      b.narrowToSubtree();
    }
    b.pt = b.min;
    if (headingText && !(datetreeDate && !subheading)) {
      const re = new RegExp('^' + headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([ \\t]+:([\\p{L}\\p{N}_@#%]+:)+)?[ \\t]*$', 'mu');
      const r = b.searchForward(re);
      if (r) b.pt = r.end;
      else {
        b.pt = b.max;
        if (!b.bolp) b.insert('\n');
        b.insert((datetreeDate ? '' : '\n') + headingText + '\n');
        b.pt = b.lineEnd(b.lineStart(b.pt - 1));
      }
      if (settings.reversedOrder) {
        b.backToHeading();
        b.outlineNextHeading();
      } else b.endOfSubtree(false);
      b.skipBlanksBackward();
      let e = b.pt;
      while (e < b.max && /[ \t\r\n]/.test(b.t[e])) e++;
      b.delete(b.pt, e);
      b.insert(datetreeDate ? '\n' : '\n\n');
    } else if (settings.reversedOrder) {
      b.pt = b.min;
      if (!b.atHeading) b.outlineNextHeading();
    } else {
      b.pt = b.max;
      if (!(datetreeDate && b.bolp)) b.insert('\n');
    }
    const at = paste(b, p.text, pasteLevel);
    b.widen();
    void cutFrom;
    return at;
  };
  if (!p.infile) {
    const b = new Buf(/** @type {string} */ (p.tgtText));
    run(b, null);
    const src = new Buf(p.srcText);
    src.delete(p.srcStart, src.subtreeEnd(p.srcStart));
    return { srcText: src.t, tgtText: b.t, cutAt: p.srcStart };
  }
  const b = new Buf(p.srcText);
  const mark = b.marker(p.srcStart);
  const end = b.subtreeEnd(p.srcStart);
  const at = run(b, mark.pos);
  const cutStart = mark.pos;
  const cutEnd = b.subtreeEnd(cutStart);
  if (at >= cutStart && at < cutEnd) {
    // the place found is inside the subtree itself: Emacs loses the entry; here the subtree goes first and the entry is then put in
    const b2 = new Buf(p.srcText);
    b2.delete(p.srcStart, end);
    run(b2, null);
    return { srcText: b2.t, tgtText: null, cutAt: p.srcStart };
  }
  b.delete(cutStart, cutEnd);
  return { srcText: b.t, tgtText: null, cutAt: cutStart };
}

/**
 * org-archive-to-archive-sibling.
 * @param {{ srcText: string, srcStart: number, text: string, settings: ArchiveSettings, tagLine: (leader: string, title: string, tag: string) => string }} p
 *   `text`: the subtree with ARCHIVE_TIME put in; `tagLine`: the heading `leader` + `title` with `tag` set (aligned as Org aligns tags)
 * @returns {{ text: string, pastedAt: number }}
 */
export function archiveSiblingText(p) {
  const { settings } = p;
  const b = new Buf(p.srcText);
  b.pt = p.srcStart;
  const leaderMatch = /^\*+ /.exec(b.t.slice(p.srcStart, p.srcStart + 200));
  if (!leaderMatch) throw new Error('Before first headline');
  const leader = leaderMatch[0];
  const level = leader.length - 1;
  const pos = b.marker(p.srcStart, true);
  // outline-up-heading 1 t: the heading above, or the start of the file
  let lo = p.srcStart;
  let parent = null;
  while (lo > 0) {
    lo = b.lineStart(lo - 1);
    const m = /^(\*+) /.exec(b.t.slice(lo, lo + 200));
    if (m && m[1].length < level) {
      parent = lo;
      break;
    }
  }
  let from;
  let to;
  if (parent === null) {
    to = b.t.length;
    from = 0;
  } else {
    from = parent;
    to = b.subtreeEnd(parent);
  }
  b.pt = from;
  const re = new RegExp('^' + leader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*' + settings.siblingHeading + '[ \\t]*:' + settings.archiveTag + ':', 'im');
  const found = b.searchForward(re, to);
  if (!found) {
    b.pt = to;
    if (!b.bolp) b.insert('\n');
    const at = b.pt;
    b.insert(p.tagLine(leader, settings.siblingHeading, settings.archiveTag) + '\n');
    b.pt = at;
  }
  b.pt = b.lineStart();
  if (settings.reversedOrder) b.outlineNextHeading();
  else b.endOfSubtree(true);
  const dest = b.marker(b.pt, false);
  // cut the subtree, then paste where point was
  const cutFrom = pos.pos;
  const cutTo = b.subtreeEnd(cutFrom);
  b.delete(cutFrom, cutTo);
  b.pt = dest.pos;
  const at = paste(b, p.text, level + 1);
  return { text: b.t, pastedAt: at };
}

/** A subtree's own text read as the file reads it: with the keywords of the file's #+TODO lines. @param {Doc} doc @param {string} text @returns {Heading} */
function parseSubtree(doc, text) {
  const lines = (doc.keywords || []).filter((k) => /^(SEQ_|TYP_)?TODO$/i.test(k.key)).map((k) => `#+${k.key}: ${k.value}\n`).join('');
  return /** @type {Heading} */ (parseOrg(lines + text).children[0]);
}

/** The offset of `heading` in the text serializeOrg gives for `doc`. @param {Doc} doc @param {Heading} heading @param {string} text */
function headingOffset(doc, heading, text) {
  const line = findHeadingLineNumber(doc, heading);
  if (line < 0) throw new Error('heading not found in the document');
  let off = 0;
  for (let i = 0; i < line; i++) off = text.indexOf('\n', off) + 1;
  return off;
}

/**
 * Archives `heading` of `srcDoc` as org-archive-subtree does, and returns the texts the files end up with.
 * @param {Doc} srcDoc @param {Heading} heading
 * @param {{ srcPath: string, infile?: boolean, vars?: Record<string, string>, now: Date, doneKeywords?: string[], tgtDoc?: Doc | null, newFile?: boolean, tgtName?: string, location?: string }} ctx
 *   `tgtDoc`: the document of the other file (when the location names one); `location` overrides the one the heading and file give
 * @returns {{ srcText: string, tgtText: string | null, cutAt: number }}
 */
export function archiveSubtree(srcDoc, heading, ctx) {
  const settings = readArchiveSettings(ctx.vars);
  const location = ctx.location ?? getArchiveLocation(srcDoc, heading, ctx.vars);
  const { filePart, headlinePart } = parseArchiveLocation(location);
  const infile = ctx.infile ?? !filePart;
  const text0 = serializeOrg(srcDoc);
  const from = parseSubtree(srcDoc, text0.slice(headingOffset(srcDoc, heading, text0), new Buf(text0).subtreeEnd(headingOffset(srcDoc, heading, text0))));
  const clone = buildArchivedClone(srcDoc, heading, ctx.srcPath, { from, now: ctx.now, infile, markDone: settings.markDone, doneKeywords: ctx.doneKeywords || ['DONE'], addInheritedTags: settings.addInheritedTags, contextInfo: settings.saveContextInfo });
  const srcText = serializeOrg(srcDoc);
  const closed = /(\d{4})-(\d{2})-(\d{2})/.exec(heading.planning?.closed || '');
  const date = closed ? [Number(closed[1]), Number(closed[2]), Number(closed[3])] : [ctx.now.getFullYear(), ctx.now.getMonth() + 1, ctx.now.getDate()];
  return archiveSubtreeText({
    srcText,
    srcStart: headingOffset(srcDoc, heading, srcText),
    text: subtreeText(clone),
    srcPath: ctx.srcPath,
    location: headlinePart,
    infile,
    tgtText: infile ? null : ctx.tgtDoc ? serializeOrg(ctx.tgtDoc) : '',
    newFile: !!ctx.newFile,
    tgtIsOrg: /\.org$/.test(ctx.tgtName || ''),
    settings,
    date,
  });
}

/**
 * Archives `heading` under its archive sibling as org-archive-to-archive-sibling does; returns the new text of the file.
 * @param {Doc} doc @param {Heading} heading @param {{ vars?: Record<string, string>, now: Date, doneKeywords?: string[] }} ctx
 */
export function archiveToSibling(doc, heading, ctx) {
  const settings = readArchiveSettings(ctx.vars);
  const text0 = serializeOrg(doc);
  const start0 = headingOffset(doc, heading, text0);
  const clone = cloneHeading(parseSubtree(doc, text0.slice(start0, new Buf(text0).subtreeEnd(start0))));
  setProperty(clone, 'ARCHIVE_TIME', formatTimeString(ctx.now, '%Y-%m-%d %a %H:%M'));
  const text = serializeOrg(doc);
  const done = archiveSiblingText({
    srcText: text,
    srcStart: headingOffset(doc, heading, text),
    text: subtreeText(clone),
    settings,
    tagLine: (leader, title, tag) => serializeHeadingLine(createHeading({ level: leader.length - 1, title, tags: [tag] })),
  });
  replaceDocText(doc, done.text);
  // org-update-parent-todo-statistics: the cookies above the archive sibling count its new child
  const pasted = findHeadingAtLine(doc, done.text.slice(0, done.pastedAt).split('\n').length - 1);
  const sibling = pasted && (findAncestorPath(doc, pasted) || []).slice(-1)[0];
  if (sibling) updateTodoCookiesUpward(doc, sibling, ctx.doneKeywords || ['DONE']);
  return serializeOrg(doc);
}

/**
 * Makes `doc` the document `text` holds, in place, keeping which headings are folded.
 * @param {Doc} doc @param {string} text
 */
export function replaceDocText(doc, text) {
  /** @param {{ children: Heading[] }} root @returns {Heading[]} */
  const walk = (root) => root.children.flatMap((h) => [h, ...walk(h)]);
  const keyOf = (/** @type {Heading} */ h, /** @type {Map<string, number>} */ seen) => {
    const k = serializeHeadingLine(h, 0);
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    return k + '\u0000' + n;
  };
  const folds = new Map();
  const seenOld = new Map();
  for (const h of walk(doc)) folds.set(keyOf(h, seenOld), { collapsed: h.collapsed, bodyHidden: h.bodyHidden, drawersHidden: h.drawersHidden });
  const fresh = parseOrg(text);
  const seenNew = new Map();
  for (const h of walk(fresh)) {
    const f = folds.get(keyOf(h, seenNew));
    if (f) Object.assign(h, f);
  }
  Object.assign(doc, fresh);
}

/**
 * Puts the text `archiveSubtree` left for the source into `srcDoc` and updates the statistics cookie where the cut was made, as
 * org-archive-subtree does.
 * @param {Doc} srcDoc @param {{ srcText: string, cutAt: number }} result @param {string[]} doneKeywords
 */
export function applyArchiveToSource(srcDoc, result, doneKeywords) {
  replaceDocText(srcDoc, result.srcText);
  const before = result.srcText.slice(0, result.cutAt);
  const atLineStart = result.cutAt === 0 || before.endsWith('\n');
  const next = atLineStart && result.cutAt < result.srcText.length ? findHeadingAtLine(srcDoc, before.split('\n').length - 1) : null;
  updateCookiesAfterArchive(srcDoc, next && next.type === 'heading' ? next : null, doneKeywords);
}
