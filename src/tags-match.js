// @ts-check
/**
 * The match language of tag and property searches (C-c / m, the Agenda's Match view): `org-make-tags-matcher`, ported from
 * org.el and held to Emacs's own answers by test/tags-match.test.js (tools/gen-tags-match-oracle.mjs writes them).
 *
 *   work+urgent-home|family     tags: `+` and `-` add or exclude one, juxtaposition is `and`, `|` is `or`
 *   {^w}  +{^w}-home            a tag matched by a regular expression
 *   LEVEL>1                     the level of the heading
 *   TODO="NEXT"  CATEGORY="x"   the keyword, the category
 *   Effort<"1:00"  SIZE>3       a property: text in quotes is compared as text, a number as a number,
 *   NAME={^x}                   {regexp} as a match; `<>` is "does not match"
 *   DEADLINE<"<today>"          a quoted timestamp (or <now>, <today>, <+2d> …) is compared as a time
 *   work/TODO|NEXT              after the last `/`: the keywords the heading must have
 *   work/!                      `/!` means TODO items that are not done
 *
 * Text that does not fit the language is left unread, as Emacs leaves it: `work+!!` is `work`.
 */

import { emacsRegexToJs } from './emacs-regex.js';

/**
 * What the matcher asks of a heading.
 * @typedef {{
 *   todo: string | null, tags: string[], level: number, category: string,
 *   property: (name: string) => string | null
 * }} MatchEntry
 */

const TAG = '[\\p{L}\\p{N}_@#%]+';
const TERM_RE = new RegExp(
  '^&?([-+:])?(\\{[^}]+\\}|LEVEL([<=>]{1,2})([0-9]+)|((?:[\\p{L}\\p{N}_]+(?:\\\\-)*)+)([<>=]{1,2})(\\{[^}]+\\}|"[^"]*"|-?[.0-9]+(?:[eE][-+]?[0-9]+)?)|' + TAG + ')',
  'u'
);

/** Emacs's `string-to-number`. @param {string} s */
function toNumber(s) {
  const m = /^[ \t]*([-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?)/.exec(s);
  return m ? Number(m[1]) : 0;
}

/** `string<` and `string>`: by character code, as Emacs compares text. @param {string} a @param {string} b */
function compareText(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = /** @type {number} */ (x[i].codePointAt(0)) - /** @type {number} */ (y[i].codePointAt(0));
    if (d) return d;
  }
  return x.length - y.length;
}

/** @param {string} op @returns {'<' | '>' | '<=' | '>=' | '=' | '<>'} */
function normalizeOp(op) {
  if (op === '=<') return '<=';
  if (op === '=>') return '>=';
  if (op === '==') return '=';
  if (op === '!=') return '<>';
  return /** @type {'<' | '>' | '='} */ (op);
}

/** @param {string} op @param {number} cmp */
function holds(op, cmp) {
  return op === '<' ? cmp < 0 : op === '>' ? cmp > 0 : op === '<=' ? cmp <= 0 : op === '>=' ? cmp >= 0 : op === '=' ? cmp === 0 : cmp !== 0;
}

/** `org-2ft`: a timestamp string in seconds, or 0. @param {string | number | null} s */
function seconds(s) {
  if (typeof s === 'number') return s;
  if (typeof s !== 'string') return 0;
  const m = /[<[](\d{4})-(\d{2})-(\d{2})(?:[^\]>\d]*?(\d{1,2}):(\d{2}))?/.exec(s);
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, 0).getTime() / 1000;
}

/** `org-matcher-time`. @param {string} s @param {Date} now */
function matcherTime(s, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  if (s === '<now>') return now.getTime() / 1000;
  if (s === '<today>') return today;
  if (s === '<tomorrow>') return today + 86400;
  if (s === '<yesterday>') return today - 86400;
  const rel = /^<([-+][0-9]+)([hdwmy])>$/.exec(s);
  if (rel) {
    const unit = /** @type {Record<string, number>} */ ({ h: 3600, d: 86400, w: 604800, m: 2678400, y: 31557600 })[rel[2]];
    return (rel[2] === 'h' ? now.getTime() / 1000 : today) + toNumber(rel[1]) * unit;
  }
  return /[<[]\d{4}-\d{2}-\d{2}/.test(s) ? seconds(s) : 0;
}

/**
 * @typedef {{ test: (entry: MatchEntry) => boolean, todoOnly: boolean }} TagsMatcher
 */

/**
 * `org-make-tags-matcher`.
 * @param {string} match
 * @param {{ doneKeywords?: Iterable<string>, now?: Date, tagGroups?: Map<string, string[]> }} [options]
 * @returns {TagsMatcher}
 */
export function makeTagsMatcher(match, options = {}) {
  const done = new Set(options.doneKeywords || ['DONE']);
  const now = options.now || new Date();
  let todoOnly = false;
  let text = expandGroups(match, options.tagGroups);

  // the part after the last slash (and no quote after it) selects TODO keywords
  let start = 0;
  for (const run of text.matchAll(/\/+/g)) start = /** @type {number} */ (run.index);
  const slash = /\/+/y;
  slash.lastIndex = start;
  /** @type {string} */ let tagsMatch;
  /** @type {string | null} */ let todoMatch = null;
  const run = slash.exec(text);
  if (run && !text.slice(start).includes('"')) {
    tagsMatch = text.slice(0, start);
    todoMatch = text.slice(start + run[0].length);
    if (todoMatch.startsWith('!')) {
      todoOnly = true;
      todoMatch = todoMatch.slice(1);
    }
    if (/^\s*$/.test(todoMatch)) todoMatch = null;
  } else tagsMatch = text;

  /** @type {((entry: MatchEntry) => boolean) | null} */ let tagsTest = null;
  if (/\S/.test(tagsMatch)) {
    /** @type {((entry: MatchEntry) => boolean)[][]} */ const ors = [];
    const terms = tagsMatch.split('|');
    while (terms.length) {
      let term = String(terms.shift());
      while (term.endsWith('\\') && terms.length) term += '|' + terms.shift();
      /** @type {((entry: MatchEntry) => boolean)[]} */ const ands = [];
      for (let m = TERM_RE.exec(term); m; m = TERM_RE.exec(term)) {
        const minus = m[1] === '-';
        const test = condition(m, now);
        ands.push(minus ? (e) => !test(e) : test);
        term = term.slice(m[0].length);
      }
      if (ands.length) ors.push(ands); // an empty alternative (`work|`) adds nothing, as in Emacs
    }
    if (ors.length) tagsTest = (e) => ors.some((ands) => ands.every((t) => t(e)));
    else if (tagsMatch.includes('|')) tagsTest = () => false; // only empty alternatives (`|`) select nothing; a lone `&` or `+` reads as no condition
  }

  /** @type {((entry: MatchEntry) => boolean) | null} */ let todoTest = null;
  if (todoMatch !== null) {
    /** @type {((entry: MatchEntry) => boolean)[][]} */ const ors = [];
    for (let term of todoMatch.split('|')) {
      /** @type {((entry: MatchEntry) => boolean)[]} */ const ands = [];
      for (let m = TERM_RE.exec(term); m; m = TERM_RE.exec(term)) {
        const minus = m[1] === '-';
        const kwd = m[2];
        /** @type {(e: MatchEntry) => boolean} */
        let test;
        if (kwd.startsWith('{')) {
          const re = safeRegex(kwd.slice(1, -1));
          test = (e) => !!re && e.todo !== null && re.test(e.todo);
        } else test = (e) => e.todo === kwd;
        ands.push(minus ? (e) => !test(e) : test);
        term = term.slice(m[0].length);
      }
      if (ands.length) ors.push(ands); // an alternative without a keyword (`TODO|`) adds nothing
    }
    todoTest = ors.length ? (e) => ors.some((ands) => ands.every((t) => t(e))) : () => false;
  }

  /** @type {(e: MatchEntry) => boolean} */
  let test = tagsTest && todoTest ? (e) => /** @type {Function} */ (tagsTest)(e) && /** @type {Function} */ (todoTest)(e) : tagsTest || todoTest || (() => true);
  if (todoOnly) {
    const inner = test;
    test = (e) => e.todo !== null && !done.has(e.todo) && inner(e);
  }
  return { test, todoOnly };
}

/** @param {string} pattern @returns {RegExp | null} */
function safeRegex(pattern) {
  try {
    return emacsRegexToJs(pattern, 'i');
  } catch {
    return null;
  }
}

/** One condition of a tag match. @param {RegExpExecArray} m @param {Date} now @returns {(e: MatchEntry) => boolean} */
function condition(m, now) {
  const tag = m[2].replace(/\\-/g, '-');
  if (tag.startsWith('{')) {
    const re = safeRegex(tag.slice(1, -1));
    return (e) => !!re && e.tags.some((t) => re.test(t));
  }
  if (m[4] !== undefined) {
    const op = normalizeOp(m[3]);
    const n = Number(m[4]);
    return (e) => holds(op, e.level - n);
  }
  if (m[5] === undefined) return (e) => e.tags.includes(tag);

  const name = m[5].toUpperCase();
  const raw = m[7];
  const isRegexp = raw.startsWith('{');
  const isString = raw.startsWith('"');
  const isTime = /^"[[<](?:[0-9]+|now|today|tomorrow|[+-][0-9]+[dmwy]).*[\]>]"$/.test(raw);
  const op = normalizeOp(m[6]);
  /** @type {(e: MatchEntry) => string | null} */
  const value = (e) => (name === 'CATEGORY' ? e.category : name === 'TODO' ? e.todo : e.property(name));
  const operand = isRegexp || isString ? raw.slice(1, -1) : raw;
  if (isRegexp) {
    const re = safeRegex(operand);
    return op === '<>' ? (e) => !(re && re.test(value(e) ?? '')) : (e) => !!re && re.test(value(e) ?? '');
  }
  if (isString && isTime) {
    const when = matcherTime(operand, now);
    const timeOp = op === '<>' ? '=' : op; // Emacs reads `<>` between times as `=`
    return (e) => {
      const a = seconds(value(e));
      return a > 0 && when > 0 && holds(timeOp, a - when);
    };
  }
  if (isString) return (e) => holds(op, op === '=' || op === '<>' ? ((value(e) ?? '') === operand ? 0 : 1) : compareText(value(e) ?? '', operand));
  const n = toNumber(operand);
  return (e) => holds(op, toNumber(value(e) ?? '') - n);
}

/** `org-tags-expand`: a group tag stands for itself and the tags of its group, a `{regexp}` member for the tags it matches.
 * @param {string} match @param {Map<string, string[]> | undefined} groups */
function expandGroups(match, groups) {
  if (!groups || !groups.size) return match;
  /** @param {string} tag @param {Set<string>} seen @returns {string[]} */
  const members = (tag, seen) => {
    if (seen.has(tag)) return [];
    seen.add(tag);
    const own = groups.get(tag);
    return own ? [tag, ...own.flatMap((t) => (t.startsWith('{') ? [t] : members(t, seen)))] : [tag];
  };
  const quote = (/** @type {string} */ t) => t.replace(/[\\^$.*+?[\]]/g, '\\$&');
  return match.replace(/([-+:]?)(\{[^}]+\}|"[^"]*"|[\p{L}\p{N}_@#%]+)(?![<>=\p{L}\p{N}_@#%])/gu, (all, sign, tag) => {
    if (tag.startsWith('{') || tag.startsWith('"')) return all;
    if (!groups.has(tag)) return [...groups.keys()].some((g) => g.toLowerCase() === tag.toLowerCase()) ? `${sign || ''}{^${quote(tag)}$}` : all; // a group named in other case stands for its own tag only
    const list = members(tag, new Set());
    const plain = list.filter((t) => !t.startsWith('{')).map(quote);
    const regexps = list.filter((t) => t.startsWith('{')).map((t) => t.slice(1, -1));
    const alternatives = [...(plain.length ? [`^\\(${plain.join('\\|')}\\)$`] : []), ...regexps];
    return `${sign || ''}{${alternatives.join('\\|')}}`;
  });
}

/** The tag groups of the files' `#+TAGS:` lines (`[ Group : a b ]`, `{ Exclusive : a b }`, `[ G : {regexp} ]`), group tag to members; the Agenda merges those of its files.
 * @param {{ keywords?: { key: string, value: string }[] }[]} docs @returns {Map<string, string[]>} */
export function parseTagGroups(docs) {
  /** @type {Map<string, string[]>} */ const groups = new Map();
  for (const doc of docs) {
    for (const k of doc.keywords || []) {
      if (k.key.toUpperCase() !== 'TAGS') continue;
      const tokens = k.value.trim().split(/[ \t]+/).filter(Boolean);
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] !== '[' && tokens[i] !== '{') continue;
        const close = tokens[i] === '[' ? ']' : '}';
        const end = tokens.indexOf(close, i + 1);
        if (end === -1) break;
        const inner = tokens.slice(i + 1, end).map((t) => t.replace(/\(.\)$/, ''));
        i = end;
        const colon = inner.indexOf(':');
        if (colon !== 1) continue; // a group names exactly one tag before the colon
        const list = groups.get(inner[0]) || [];
        for (const m of inner.slice(2)) if (!list.includes(m)) list.push(m);
        groups.set(inner[0], list);
      }
    }
  }
  return groups;
}
