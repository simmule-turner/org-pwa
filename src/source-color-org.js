// @ts-check
/**
 * Source coloring of Org text as Emacs 29.3's org-mode font-lock gives it (the faces of `org-font-lock-keywords`: headline levels, TODO keywords,
 * priorities, tags, planning keywords and timestamps, drawers and properties, keywords, blocks, comments, tables, lists, links, citations,
 * macros, footnotes, targets, inline source, and emphasis). test/source-color.test.js holds the result to the faces Emacs gave
 * test/fixtures/source-color/*.org.txt. Each character gets the first face Emacs names for it (a headline's TODO keyword is `org-todo`, not
 * `org-level-1`). What is not colored: LaTeX fragments, entities, sub- and superscripts, and objects that run over more than one line.
 *
 * orgRuns(code, colorBlock) -> [[text, face | null], ...]; `colorBlock(code, language)` colors the body of a source block in its own language.
 */

import { Paint } from './source-paint.js';

/** @typedef {string | null} Face */
/** @typedef {(a: number, b: number, face: Face) => void} Set */
/** @typedef {(code: string, language: string) => [string, Face][] | null} ColorBlock */

const TAGS = '(:[\\p{L}\\p{N}_@#%:]+:)';
const escapeRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The TODO and DONE keywords of the text's own `#+TODO:`, `#+SEQ_TODO:` and `#+TYP_TODO:` lines, or Org's default. @param {string} code */
function todoKeywords(code) {
  /** @type {string[]} */
  const todo = [];
  /** @type {string[]} */
  const done = [];
  const names = (/** @type {string} */ s) => s.split(/[ \t]+/).filter(Boolean).map((k) => k.replace(/\(.*$/, ''));
  for (const m of code.matchAll(/^#\+(?:SEQ_|TYP_)?TODO:[ \t]*(.*)$/gim)) {
    const bar = m[1].indexOf('|');
    if (bar >= 0) {
      todo.push(...names(m[1].slice(0, bar)));
      done.push(...names(m[1].slice(bar + 1)));
    } else {
      const all = names(m[1]);
      done.push(...all.slice(-1));
      todo.push(...all.slice(0, -1));
    }
  }
  return todo.length || done.length ? { todo, done } : { todo: ['TODO'], done: ['DONE'] };
}

/** The face `org-level-N` of a headline with `stars` stars: the eight faces repeat (org-cycle-level-faces). @param {number} stars */
const levelFace = (stars) => `org-level-${((stars - 1) % 8) + 1}`;

const TIMESTAMP_RE = /[<[]\d{4}-\d\d-\d\d(?: +[^\s\d>\]+-][^\s>\]]*)?(?: +\d{1,2}:\d\d(?:-\d{1,2}:\d\d)?)?(?: +[-+.]{1,2}\d+[hdwmy](?:\/\d+[hdwmy])?)*[>\]](?:--[<[][^>\]]*[>\]])?/g;
const LINK_RE = /\[\[(?:[^\]\\]|\\.)+\](?:\[(?:[^\]\\]|\\.)*\])?\]/g;
const PLAIN_LINK_RE = /\b(?:https?|ftp|file|mailto|info|help|id|doi):[^\s<>()[\]{}"']*[^\s<>()[\]{}"'.,;:!?]/g;
const ANGLE_LINK_RE = /<(?:https?|ftp|file|mailto):[^>\s]+>/g;
const MACRO_RE = /\{\{\{[A-Za-z][-\w]*(?:\((?:[^)]|\\\))*\))?\}\}\}/g;
const FOOTNOTE_RE = /\[fn:[^\s\]:]*(?::[^\]]*)?\]/g;
const TARGET_RE = /<<<?[^<>\n]+>>>?/g;
const CITE_RE = /\[cite(?:\/[^:\]]*)?:[^\]]*\]/g;
const CITE_KEY_RE = /@[\p{L}\p{N}_][\p{L}\p{N}_:.#$%&+?<>~/-]*/gu;
const STATS_RE = /\[(?:\d*%|\d*\/\d*)\]/g;
const INLINE_SRC_RE = /\bsrc_([^\s[{]+)(\[[^\]\n]*\])?\{([^\n}]*)\}/g;

/** @type {Record<string, string>} */
const EMPHASIS = { '*': 'bold', '/': 'italic', _: 'underline', '=': 'org-verbatim', '~': 'org-code', '+': 'strike-through' };
// A marker after a line start or one of `-(' "{` and a space, then text that neither starts nor ends with a space, `,`, `"` or `'` (it may hold
// the marker itself), then the marker and one of `-.,:!?;'")}[`, a space or the line end: org-emphasis-regexp-components.
const EMPHASIS_RE = /(?<=^|[-\s('"{])([*/_=~+])([^\s,"'](?:.*?[^\s,"'])?)\1(?=$|[-\s.,:!?;'")}[])/uy;

/**
 * Emphasis as Org reads it on one line; what is inside bold, italic, underlined or struck text is read again (the inner face wins).
 * @param {string} line @param {number} from @param {number} to @param {Set} set @param {boolean[]} taken
 */
function emphasis(line, from, to, set, taken) {
  for (let i = from; i < to; i++) {
    if (taken[i]) continue;
    EMPHASIS_RE.lastIndex = i;
    const m = EMPHASIS_RE.exec(line);
    if (!m || i + m[0].length > to) continue;
    set(i, i + m[0].length, EMPHASIS[m[1]]);
    if (m[1] !== '=' && m[1] !== '~') emphasis(line, i + 1, i + m[0].length - 1, set, taken);
    i += m[0].length - 1;
  }
}

/**
 * The objects inside one line, in the order Org's rules paint them: links, citations, plain and angle links, timestamps, macros, targets,
 * footnotes, statistics cookies, inline source, radio targets, emphasis.
 * @param {string} line @param {number} from @param {number} to @param {Set} set @param {string[]} radios @param {ColorBlock} colorBlock
 */
function inline(line, from, to, set, radios, colorBlock) {
  const text = line.slice(0, to);
  /** @type {boolean[]} */
  const taken = new Array(line.length).fill(false);
  /** @param {number} a @param {number} b @param {Face} face */
  const take = (a, b, face) => {
    set(a, b, face);
    for (let i = a; i < b; i++) taken[i] = true;
  };
  /** @param {RegExp} re @param {Face} face */
  const all = (re, face) => {
    for (const m of text.matchAll(re)) if (m.index >= from && !taken[m.index]) take(m.index, m.index + m[0].length, face);
  };
  all(LINK_RE, 'org-link');
  for (const m of text.matchAll(CITE_RE)) {
    if (m.index < from || taken[m.index]) continue;
    take(m.index, m.index + m[0].length, 'org-cite');
    for (const k of m[0].matchAll(CITE_KEY_RE)) take(m.index + k.index, m.index + k.index + k[0].length, 'error');
  }
  all(ANGLE_LINK_RE, 'org-link');
  all(PLAIN_LINK_RE, 'org-link');
  all(TIMESTAMP_RE, 'org-date');
  all(MACRO_RE, 'org-macro');
  all(TARGET_RE, 'org-target');
  all(FOOTNOTE_RE, 'org-footnote');
  for (const m of text.matchAll(STATS_RE)) {
    if (m.index < from || taken[m.index]) continue;
    const inner = m[0].slice(1, -1);
    const [a, b] = inner.split('/');
    const complete = inner.endsWith('%') ? inner === '100%' : a !== '' && a === b;
    take(m.index, m.index + m[0].length, complete ? 'org-checkbox-statistics-done' : 'org-checkbox-statistics-todo');
  }
  for (const m of text.matchAll(INLINE_SRC_RE)) {
    if (m.index < from || taken[m.index]) continue;
    const start = m.index;
    take(start, start + 4, 'shadow');
    take(start + 4, start + 4 + m[1].length, 'org-meta-line');
    const open = start + 4 + m[1].length + (m[2] ? m[2].length : 0);
    take(open, open + 1, 'org-inline-src-block');
    const code = m[3];
    let p = open + 1;
    for (const [t, f] of colorBlock(code, m[1]) ?? [[code, null]]) {
      take(p, p + t.length, f ?? 'org-block');
      p += t.length;
    }
    take(p, p + 1, 'org-inline-src-block');
  }
  for (const radio of radios) {
    for (const m of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(radio)}(?![\\p{L}\\p{N}])`, 'giu'))) if (m.index >= from && !taken[m.index]) take(m.index, m.index + m[0].length, 'org-link');
  }
  emphasis(text, from, to, set, taken);
}

/**
 * A headline's faces: the level over the whole line, then keyword, priority, title (of a DONE headline) and tags.
 * @param {string} line @param {RegExpExecArray} headline @param {Set} set @param {{ done: string[], keywordRe: RegExp }} kw
 * @returns {number} where the tags start
 */
function paintHeadline(line, headline, set, kw) {
  const stars = headline[1].length;
  let from = stars + headline[2].length;
  const tags = new RegExp(`[ \\t]+${TAGS}[ \\t]*$`, 'u').exec(line);
  const tagStart = tags ? tags.index + tags[0].indexOf(':') : line.length;
  const archived = tags ? tags[1].split(':').includes('ARCHIVE') : false;
  set(0, line.length, levelFace(stars));
  if (archived) set(from, line.length, 'org-archived');
  const key = kw.keywordRe.exec(line.slice(from));
  let isDone = false;
  if (key) {
    isDone = kw.done.includes(key[1]);
    if (!archived) set(from, from + key[1].length, isDone ? 'org-done' : 'org-todo');
    from += key[1].length;
  }
  const prio = /^( *)(\[#.\])(?=[ \t]|$)/.exec(line.slice(from));
  if (prio && !archived) set(from + prio[1].length, from + prio[1].length + prio[2].length, 'org-priority');
  if (isDone && !archived) {
    const titleFrom = prio ? from + prio[1].length + prio[2].length : from + (/^ */.exec(line.slice(from)) || [''])[0].length;
    if (line.length > titleFrom) set(titleFrom, line.length, 'org-headline-done');
  } else if (tags && !archived) set(tagStart, line.lastIndexOf(':') + 1, 'org-tag');
  return tagStart;
}

/** Blocks whose lines are not text: Emacs gives them the block face as they are. */
const RAW_BLOCKS = new Set(['src', 'example', 'export']);

/**
 * @param {string} code
 * @param {ColorBlock} colorBlock
 * @returns {[string, Face][]}
 */
export function orgRuns(code, colorBlock) {
  const paint = new Paint(code.length);
  const { done, todo } = todoKeywords(code);
  const kw = { done, keywordRe: new RegExp(`^(${[...todo, ...done].map(escapeRe).join('|')})(?=[ \\t]|$)`) };
  const radios = [...code.matchAll(/<<<([^<>\n]+)>>>/g)].map((m) => m[1]);
  const lines = code.split('\n');
  let at = 0;
  /** @type {string | null} the kind of block the line is in */
  let block = null;
  let blockLanguage = '';
  let bodyStart = 0;
  let broken = false;
  /** @type {string | null} */
  let drawer = null;
  for (const line of lines) {
    const start = at;
    at += line.length + 1;
    /** @type {Set} */
    const set = (a, b, face) => paint.set(start + a, start + b, face);
    const begin = /^[ \t]*#\+begin_(\S+)(?:[ \t]+(\S+))?/i.exec(line);
    if (block === null && begin) {
      block = begin[1].toLowerCase();
      blockLanguage = block === 'src' || block === 'export' ? begin[2] || '' : '';
      set(0, line.length, 'org-block-begin-line');
      bodyStart = at;
      broken = false;
      continue;
    }
    if (block !== null) {
      if (new RegExp(`^[ \\t]*#\\+end_${escapeRe(block)}[ \\t]*$`, 'i').test(line)) {
        if (RAW_BLOCKS.has(block) && !broken && start - 1 > bodyStart) {
          const text = code.slice(bodyStart, start - 1);
          const runs = blockLanguage ? colorBlock(text, blockLanguage) : null;
          if (runs) {
            let p = bodyStart;
            for (const [t, f] of runs) {
              paint.set(p, p + t.length, f ?? 'org-block');
              p += t.length;
            }
          } else paint.set(bodyStart, bodyStart + text.length, 'org-block');
        }
        set(0, line.length, broken ? 'org-meta-line' : 'org-block-end-line');
        block = null;
        continue;
      }
      if (RAW_BLOCKS.has(block)) {
        const h = /^(\*+)( +)(.*)$/.exec(line);
        if (h) {
          broken = true;
          paintHeadline(line, h, set, kw);
        }
        continue;
      }
    }
    const headline = /^(\*+)( +)(.*)$/.exec(line);
    if (headline) {
      const tagStart = paintHeadline(line, headline, set, kw);
      inline(line, headline[1].length + headline[2].length, tagStart, set, radios, colorBlock);
      continue;
    }
    // drawers and properties
    const drawerLine = /^[ \t]*:(PROPERTIES|END|[\w-]+):[ \t]*$/.exec(line);
    if (drawerLine && (drawerLine[1] === 'END' ? drawer !== null : true)) {
      set(line.indexOf(':'), line.trimEnd().length, 'org-drawer');
      drawer = drawerLine[1] === 'END' ? null : drawerLine[1];
      continue;
    }
    if (drawer === 'PROPERTIES') {
      const prop = /^([ \t]*)(:[^\s:]+\+?:)([ \t]*)(.*)$/.exec(line);
      if (prop) {
        const a = prop[1].length;
        set(a, a + prop[2].length, 'org-special-keyword');
        if (prop[4]) {
          const v = a + prop[2].length + prop[3].length;
          set(v, line.length, 'org-property-value');
          inline(line, v, line.length, set, radios, colorBlock);
        }
        continue;
      }
    }
    // keywords, comments, fixed-width lines, sexp dates, clock and planning lines
    const keyword = /^([ \t]*)(#\+)([^\s:]+):([ \t]*)(.*)$/.exec(line);
    if (keyword) {
      const name = keyword[3].toUpperCase();
      const a = keyword[1].length;
      const keyEnd = a + 2 + keyword[3].length + 1;
      const value = keyword[5] ? [line.length - keyword[5].length, line.length] : null;
      if (name === 'TITLE') {
        set(a, keyEnd, 'org-document-info-keyword');
        if (value) set(value[0], value[1], 'org-document-title');
      } else if (/^(AUTHOR|DATE|EMAIL|SUBTITLE)$/.test(name)) {
        set(a, keyEnd, 'org-document-info-keyword');
        if (value) set(value[0], value[1], 'org-document-info');
      } else if (name === 'CAPTION') {
        set(a, keyEnd, 'org-meta-line');
        if (value) set(value[0], value[1], 'org-block');
      } else set(a, line.length, 'org-meta-line');
      continue;
    }
    if (/^[ \t]*#(?:[ \t]|$)/.test(line)) {
      set(line.indexOf('#'), line.length, 'comment');
      continue;
    }
    if (/^[ \t]*:(?:[ \t]|$)/.test(line)) {
      set(line.indexOf(':'), line.length, 'org-code');
      continue;
    }
    if (line.startsWith('%%(')) {
      set(0, line.length, 'org-sexp-date');
      continue;
    }
    if (/^[ \t]*CLOCK:/.test(line)) {
      const a = line.indexOf('CLOCK:');
      set(a, a + 6, 'org-special-keyword');
      for (const m of line.matchAll(TIMESTAMP_RE)) set(m.index, m.index + m[0].length, 'org-date');
      for (const m of line.matchAll(/\]--\[[^\]]*\]/g)) set(m.index + 1, m.index + m[0].length, 'org-date');
      continue;
    }
    if (/^[ \t]*(?:(?:SCHEDULED|DEADLINE|CLOSED):[ \t]*[<[][^\]>]*[>\]][ \t]*)+$/.test(line)) {
      for (const m of line.matchAll(/(SCHEDULED|DEADLINE|CLOSED):/g)) set(m.index, m.index + m[0].length, 'org-special-keyword');
      for (const m of line.matchAll(TIMESTAMP_RE)) set(m.index, m.index + m[0].length, 'org-date');
      continue;
    }
    if (/^[ \t]*\|/.test(line)) {
      set(line.indexOf('|'), line.length, 'org-table');
      if (!/^[ \t]*\|[-+]*\|?[ \t]*$/.test(line)) inline(line, 0, line.length, set, radios, colorBlock);
      continue;
    }
    // list items
    const item = /^([ \t]*)([-+*]|\d+[.)])([ \t]+)(\[[ X-]\][ \t]+)?(.*)$/.exec(line);
    if (item) {
      const afterBullet = item[1].length + item[2].length;
      if (item[4]) set(afterBullet + item[3].length, afterBullet + item[3].length + 3, 'org-checkbox');
      const termFrom = item[4] ? afterBullet + item[3].length + item[4].length : afterBullet + 1;
      const dt = /^(.*?[ \t]+::)(?=[ \t]|$)/.exec(line.slice(termFrom));
      if (dt && /^[-+*]/.test(item[2])) set(termFrom, termFrom + dt[1].length, 'org-list-dt');
    }
    inline(line, 0, line.length, set, radios, colorBlock);
  }
  return paint.runs(code);
}
