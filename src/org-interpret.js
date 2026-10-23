// @ts-check
/**
 * The text Emacs's Org export back end (ox-org) writes: the document read as Org elements and written out again in
 * Org's canonical form. Headlines have their tags aligned and lose a priority cookie, SCHEDULED/DEADLINE lines, property drawers and
 * LOGBOOK drawers unless #+OPTIONS: asks for them; keywords and block markers are lower case; source and example blocks
 * are indented by two; tables are re-aligned; ordered lists are renumbered; export snippets and blocks for other back ends are dropped.
 * Compared with Emacs 29.3 / Org 9.6.15.
 */

/**
 * @typedef {{
 *   todoKeywords: Set<string>, todo: boolean, priority: boolean, tags: boolean, planning: boolean, properties: boolean,
 *   drawer: (name: string) => boolean, footnotes: boolean, title: boolean, author: boolean, date: boolean, email: boolean,
 *   selective?: boolean, nested?: boolean, referenced?: Set<string>,
 *   cite?: { text: (c: any) => string, bibliography: string[] },
 * }} InterpretOptions
 */

import { parseCitationAt } from './cite.js';
import { layoutTable, width } from './org-table-layout.js';

const TAGS_COLUMN = 77;

/** @param {string} s */
const isBlank = (s) => s.trim() === '';
/** @param {string} s */
const untab = (s) => s.replace(/^[ \t]*/, (m) => m.replace(/\t/g, '        '));
/** @param {string} s */
const indentOf = (s) => (/^ */.exec(untab(s)) || [''])[0].length;
/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The lines with their common indentation removed (tabs count as eight columns); blank lines become empty.
 * @param {string[]} lines
 */
function dedent(lines) {
  const rows = lines.map(untab);
  const widths = rows.filter((l) => !isBlank(l)).map(indentOf);
  const min = widths.length ? Math.min(...widths) : 0;
  return rows.map((l) => (isBlank(l) ? '' : l.slice(min)));
}

/** @param {string[]} lines @param {number} n */
const indentLines = (lines, n) => lines.map((l) => (l === '' ? '' : ' '.repeat(n) + l));

// ---- objects -----------------------------------------------------------------------------------------------------

const TIMESTAMP = String.raw`[<\[]\d{4}-\d\d-\d\d[^>\]\n]*[>\]]`;
const TIMESTAMP_RE = new RegExp(`(${TIMESTAMP})(?:--(${TIMESTAMP}))?( +)?`, 'g');
const VERBATIM_RE = /(^|[\s({'"])([=~])(?=\S)(.*?\S|\S)\2(?=$|[\s.,;:!?)}'"-])/g;

/** `<2026-03-04 Wed 10:00-11:00>` is a range from 10:00 to 11:00. @param {string} stamp */
function splitTimeRange(stamp) {
  const m = /^([<[])(\d{4}-\d\d-\d\d(?: [^\s\d>\]-]+)?) (\d{1,2}:\d\d)-(\d{1,2}:\d\d)((?: [^\s>\]]+)*)([>\]])$/.exec(stamp);
  return m ? `${m[1]}${m[2]} ${m[3]}${m[5]}${m[6]}--${m[1]}${m[2]} ${m[4]}${m[5]}${m[6]}` : stamp;
}

/**
 * The inline objects of one line of text, as Org writes them back: export snippets are dropped, a time range becomes two
 * timestamps, spaces after a timestamp are doubled, and a relative file link gets its `file:`.
 * @param {string} text
 * @param {InterpretOptions} opts
 */
function inline(text, opts) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(VERBATIM_RE)) {
    const start = /** @type {number} */ (m.index) + m[1].length;
    parts.push(objects(text.slice(last, start), opts), text.slice(start, /** @type {number} */ (m.index) + m[0].length));
    last = /** @type {number} */ (m.index) + m[0].length;
  }
  parts.push(objects(text.slice(last), opts));
  return parts.join('');
}

/**
 * `text` with each citation written out; one that prints nothing goes, and the space before it is replaced by the blanks after it.
 * @param {string} text @param {(c: any) => string} write
 */
function citations(text, write) {
  if (!text.includes('[cite')) return text;
  let out = '';
  for (let i = 0; i < text.length; ) {
    const hit = text[i] === '[' ? parseCitationAt(text, i) : null;
    if (!hit) {
      out += text[i++];
      continue;
    }
    const written = write(hit.node);
    out = written === '' ? out.replace(/[ \t]+$/, '') + ' '.repeat(hit.node.blanks) : out + written + ' '.repeat(hit.node.blanks);
    i += hit.length;
  }
  return out;
}

/** @param {string} text @param {InterpretOptions} opts */
function objects(text, opts) {
  let out = opts.cite ? citations(text, opts.cite.text) : text;
  out = out.replace(/@@[A-Za-z0-9-]+:[\s\S]*?@@/g, '');
  out = out.replace(/\[\[([^\][]+)(\]\[[^\]]*)?\]\]/g, (whole, target, desc) => (/^(?:\.{1,2}\/|\/|~\/)/.test(target) ? `[[file:${target}${desc || ''}]]` : whole));
  out = out.replace(TIMESTAMP_RE, (_whole, a, b, spaces) => splitTimeRange(a) + (b ? '--' + splitTimeRange(b) : '') + (spaces ? spaces + spaces : ''));
  if (!opts.footnotes) out = out.replace(/\[fn:[^\]\s]*(?::[^\]]*)?\]/g, '');
  return out;
}

// ---- tables -------------------------------------------------------------------------------------------------------

const COOKIE_RE = /^<(?:[lrc])?\d*>$/;
const SPECIAL_MARKS = new Set(['', '#', '!', '$', '*', '_', '/', '^']);
const SPECIAL_ROWS = new Set(['!', '^', '$', '_', '/']);

/** @param {string[]} lines @param {InterpretOptions} opts @returns {string[]} */
function table(lines, opts) {
  /** @type {(string[] | null)[]} */
  let rows = lines.map((l) => {
    const t = l.trim();
    if (/^\|-/.test(t)) return null;
    const body = t.slice(1).replace(/\|$/, '');
    return body.split(/(?<!\\)\|/).map((c) => c.trim());
  });
  if (rows.every((r) => !r || SPECIAL_MARKS.has(r[0]))) {
    rows = rows.filter((r) => !r || !SPECIAL_ROWS.has(r[0])).map((r) => (r ? r.slice(1) : r));
  }
  rows = rows.filter((r) => !r || !(r.some((c) => c !== '') && r.every((c) => c === '' || COOKIE_RE.test(c))));
  const data = /** @type {string[][]} */ (rows.filter(Boolean));
  if (!data.length) return [];
  return layoutTable(rows.map((r) => (r ? r.map((c) => inline(c, opts)) : null)));
}

// ---- elements ---------------------------------------------------------------------------------------------------------

const ITEM_RE = /^([ \t]*)([-+*]|\d+[.)])(?:[ \t]+(.*)|[ \t]*)$/;
const BLOCK_BEGIN_RE = /^\s*#\+begin_(\S+)(?:\s+(.*?))?\s*$/i;
const KEYWORD_RE = /^\s*#\+([^\s:]+):\s*(.*?)\s*$/;
const DRAWER_RE = /^\s*:([A-Za-z0-9_-]+):\s*$/;
const FIXED_RE = /^\s*:(?: .*)?$/;
const COMMENT_RE = /^\s*#(?: |$)/;
const HR_RE = /^\s*-{5,}\s*$/;
const LATEX_BEGIN_RE = /^\s*\\begin\{([A-Za-z0-9*]+)\}/;
const DYNAMIC_BEGIN_RE = /^\s*#\+begin:\s*(.*?)\s*$/i;

/** @param {string} line @param {boolean} [nested]  inside an item, where a star at the margin is a bullet */
function itemMatch(line, nested = false) {
  const m = ITEM_RE.exec(untab(line));
  if (!m) return null;
  if (m[2] === '*' && m[1].length === 0 && !nested) return null;
  return m;
}

/** Does this line begin an element that can interrupt a paragraph? @param {string} line @param {boolean} [nested] */
function interrupts(line, nested = false) {
  return isBlank(line) || /^\*+(?: |$)/.test(line) || /^\s*#\+/.test(line) || COMMENT_RE.test(line) || DRAWER_RE.test(line) || FIXED_RE.test(line) || /^\s*\|/.test(line) || HR_RE.test(line) || !!itemMatch(line, nested) || LATEX_BEGIN_RE.test(line);
}

/**
 * @param {string[]} lines
 * @param {number} from
 * @param {RegExp} end
 */
function findEnd(lines, from, end) {
  for (let k = from; k < lines.length; k++) if (end.test(lines[k])) return k;
  return -1;
}

/**
 * The lines of a run of elements, written the way Org does.
 * @param {string[]} lines
 * @param {InterpretOptions} opts
 * @returns {string[]}
 */
function render(lines, opts) {
  /** @type {string[]} */
  const out = [];
  let afterTable = false;
  let i = 0;
  /** Drop the blank lines before and after a comment: the comment itself is one blank line. */
  const comment = () => {
    while (out.length && out[out.length - 1] === '') out.pop();
    while (i < lines.length && isBlank(lines[i])) i++;
    if (out.length) out.push('');
  };
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      out.push('');
      i++;
      afterTable = false;
      continue;
    }
    // comments
    if (COMMENT_RE.test(line)) {
      while (i < lines.length && COMMENT_RE.test(lines[i])) i++;
      comment();
      afterTable = false;
      continue;
    }
    // blocks
    const block = BLOCK_BEGIN_RE.exec(line);
    if (block) {
      const name = block[1];
      const lower = name.toLowerCase();
      const k = findEnd(lines, i + 1, new RegExp(`^\\s*#\\+end_${escapeRe(name)}\\s*$`, 'i'));
      if (k >= 0) {
        const content = lines.slice(i + 1, k);
        const params = block[2] || '';
        afterTable = false;
        i = k + 1;
        if (lower === 'comment') {
          comment();
        } else if (lower === 'export') {
          if (params.split(/\s+/)[0].toLowerCase() === 'org') out.push(...render(dedent(content), opts));
        } else if (lower === 'src' || lower === 'example') {
          const rows = content.map(untab);
          const widths = rows.filter((l) => !isBlank(l)).map(indentOf);
          const min = widths.length ? Math.min(...widths) : 0;
          out.push(`#+begin_${lower}${params ? ' ' + params : ''}`, ...rows.map((l) => (isBlank(l) ? '' : '  ' + l.slice(min))), `#+end_${lower}`);
        } else if (lower === 'verse') {
          out.push('#+begin_verse', ...dedent(content).map((l) => inline(l, opts)), '#+end_verse');
        } else {
          const shown = ['quote', 'center'].includes(lower) ? lower : name;
          out.push(`#+begin_${shown}${params ? ' ' + params : ''}`, ...render(dedent(content), opts), `#+end_${shown}`);
        }
        continue;
      }
    }
    const dynamic = DYNAMIC_BEGIN_RE.exec(line);
    if (dynamic) {
      const k = findEnd(lines, i + 1, /^\s*#\+end:\s*$/i);
      if (k >= 0) {
        out.push(`#+begin: ${dynamic[1]}`.trimEnd(), ...dedent(lines.slice(i + 1, k)), '#+end:');
        i = k + 1;
        afterTable = false;
        continue;
      }
    }
    // keywords
    const keyword = KEYWORD_RE.exec(line);
    if (keyword) {
      const key = keyword[1];
      i++;
      if (/^ATTR_/i.test(key)) continue;
      if (key.toUpperCase() === 'TBLFM' && afterTable) {
        out.push(`#+TBLFM: ${keyword[2]}`);
        continue;
      }
      afterTable = false;
      if (key.toUpperCase() === 'PRINT_BIBLIOGRAPHY' && opts.cite?.bibliography.length) {
        out.push(...opts.cite.bibliography.flatMap((entry, n) => (n ? ['', entry] : [entry])));
        continue;
      }
      out.push(`#+${key.toLowerCase()}: ${keyword[2]}`);
      continue;
    }
    // drawers
    const drawer = DRAWER_RE.exec(line);
    if (drawer && drawer[1].toUpperCase() !== 'END') {
      const k = findEnd(lines, i + 1, /^\s*:END:\s*$/i);
      if (k >= 0) {
        const content = lines.slice(i + 1, k);
        i = k + 1;
        afterTable = false;
        if (!opts.drawer(drawer[1])) {
          while (i < lines.length && isBlank(lines[i])) i++;
          continue;
        }
        out.push(`:${drawer[1]}:`, ...render(dedent(content), opts), ':END:');
        continue;
      }
    }
    // fixed-width areas
    if (FIXED_RE.test(line)) {
      while (i < lines.length && FIXED_RE.test(lines[i])) {
        out.push(lines[i].trim() === ':' ? ':' : ': ' + lines[i].replace(/^\s*: ?/, ''));
        i++;
      }
      out.push('');
      afterTable = false;
      continue;
    }
    // tables
    if (/^\s*\|/.test(line)) {
      const run = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) run.push(lines[i++]);
      out.push(...table(run, opts));
      afterTable = true;
      continue;
    }
    afterTable = false;
    if (HR_RE.test(line)) {
      out.push('-----');
      i++;
      continue;
    }
    const env = LATEX_BEGIN_RE.exec(line);
    if (env) {
      const k = findEnd(lines, i + 1, new RegExp(`^\\s*\\\\end\\{${escapeRe(env[1])}\\}\\s*$`));
      if (k >= 0) {
        out.push(...dedent(lines.slice(i, k + 1)));
        i = k + 1;
        continue;
      }
    }
    if (itemMatch(line, opts.nested)) {
      i = list(lines, i, opts, out);
      continue;
    }
    // a footnote definition nothing refers to is dropped, with the text that runs on after it
    const note = /^\[fn:([^\]\s]+)\]/.exec(line);
    if (note && opts.referenced && !opts.referenced.has(note[1])) {
      i++;
      let blanks = 0;
      while (i < lines.length && blanks < 2 && !/^\[fn:[^\]\s]+\]/.test(lines[i])) blanks = isBlank(lines[i++]) ? blanks + 1 : 0;
      continue;
    }
    // a paragraph
    const start = i;
    i++;
    while (i < lines.length && !interrupts(lines[i], opts.nested)) i++;
    const text = lines.slice(start, i);
    if (!opts.footnotes && /^\[fn:[^\]\s]+\]/.test(text[0])) continue;
    const written = dedent(text).map((l) => inline(l, opts));
    if (opts.cite && /^\[cite/.test(text[0].trimStart())) written[0] = written[0].trimStart(); // a paragraph does not begin with a blank
    out.push(...written);
  }
  return out;
}

/**
 * One list, from the item at `lines[i]`; returns the index after it.
 * @param {string[]} lines @param {number} i @param {InterpretOptions} opts @param {string[]} out
 */
function list(lines, i, opts, out) {
  const base = indentOf(lines[i]);
  const ordered = /\d/.test(/** @type {RegExpExecArray} */ (itemMatch(lines[i], opts.nested))[2]); // the first item decides the kind of the whole list
  let number = 1;
  while (i < lines.length) {
    const m = itemMatch(lines[i], opts.nested);
    if (!m || indentOf(lines[i]) !== base) break;
    let text = m[3] ?? '';
    let j = i + 1;
    /** @type {string[]} */
    const body = [];
    while (j < lines.length) {
      if (isBlank(lines[j])) {
        let k = j;
        while (k < lines.length && isBlank(lines[k])) k++;
        if (k - j >= 2 || k >= lines.length || indentOf(lines[k]) <= base) break;
        for (; j < k; j++) body.push('');
        continue;
      }
      if (indentOf(lines[j]) <= base) break;
      body.push(lines[j++]);
    }
    const counter = /^\[@(\d+)\](?: +|$)/.exec(text);
    if (counter) {
      number = Number(counter[1]);
      text = text.slice(counter[0].length);
    }
    const box = /^\[([ Xx-])\](?: +|$)/.exec(text); // a lower-case x is read as a box but not written back
    if (box) text = text.slice(box[0].length);
    const tag = /^(.*?) ::(?: +(.*)|)$/.exec(text);
    if (tag) text = tag[2] ?? '';
    const bullet = ordered ? `${number}.` : '-';
    const contentIndent = bullet.length + 1 + (tag ? 3 : 0);
    if (ordered) number++;
    const rendered = render(text === '' ? dedent(body) : [text, ...dedent(body)], { ...opts, nested: true });
    let mark = box && box[1] !== 'x' ? box[1] : '';
    if (mark) {
      // a box with boxes beneath it shows what they show: all done, none done, or some
      const own = /^(?:-|\d+\.) \[([ X-])\]/;
      const states = rendered.slice(text === '' ? 0 : 1).map((l) => own.exec(l)?.[1]).filter((c) => c !== undefined);
      if (states.length) mark = states.every((c) => c === 'X') ? 'X' : states.every((c) => c === ' ') ? ' ' : '-';
    }
    const prefix = `${bullet} ${counter ? `[@${counter[1]}] ` : ''}${mark ? `[${mark}] ` : ''}${tag ? `${inline(tag[1], opts)} :: ` : ''}`;
    if (text === '') {
      out.push(prefix, ...indentLines(rendered, contentIndent));
    } else {
      out.push(prefix + (rendered[0] ?? ''), ...indentLines(rendered.slice(1), contentIndent));
    }
    i = j;
    let k = i;
    while (k < lines.length && isBlank(lines[k])) k++;
    const next = k < lines.length ? itemMatch(lines[k], opts.nested) : null;
    if (next && indentOf(lines[k]) === base && k - i < 2) {
      for (; i < k; i++) out.push('');
    } else {
      break;
    }
  }
  return i;
}

// ---- headlines ----------------------------------------------------------------------------------------------------

const PLANNING_RE = /^\s*(?:(?:SCHEDULED|DEADLINE|CLOSED):\s*[<[][^>\]]*[>\]]\s*)+$/;

/** The planning line and property drawer that open a section; returns the lines left and the lines to write. @param {string[]} body @param {InterpretOptions} opts @param {boolean} zeroth */
function prologue(body, opts, zeroth) {
  /** @type {string[]} */
  const written = [];
  let k = 0;
  const skipBlanks = () => {
    while (k < body.length && isBlank(body[k])) k++;
  };
  if (k < body.length && PLANNING_RE.test(body[k])) {
    if (opts.planning) {
      const found = new Map([...body[k].matchAll(/(SCHEDULED|DEADLINE|CLOSED):\s*([<[][^>\]]*[>\]])/g)].map((m) => [m[1], m[2]]));
      written.push(['DEADLINE', 'SCHEDULED', 'CLOSED'].filter((x) => found.has(x)).map((x) => `${x}: ${found.get(x)}`).join(' '));
      k++;
    } else {
      k++;
      skipBlanks();
    }
  }
  if (k < body.length && /^\s*:PROPERTIES:\s*$/i.test(body[k])) {
    const end = findEnd(body, k + 1, /^\s*:END:\s*$/i);
    if (end >= 0) {
      if (opts.properties) {
        written.push(':PROPERTIES:');
        for (const l of body.slice(k + 1, end)) {
          const p = /^\s*:([^\s:]+):\s*(.*?)\s*$/.exec(l);
          if (p) written.push(zeroth ? `:${p[1]}: ${p[2]}`.trimEnd() : `${(':' + p[1] + ':').padEnd(10)} ${p[2]}`.trimEnd());
        }
        written.push(':END:');
        k = end + 1;
      } else {
        k = end + 1;
        skipBlanks();
      }
    }
  }
  return { rest: body.slice(k), written };
}

/** @param {string} line @param {InterpretOptions} opts */
function headline(line, opts) {
  const m = /^(\*+)(?: (.*))?$/.exec(line);
  if (!m) return line;
  let rest = m[2] ?? '';
  const tagMatch = /^(.*?)\s+(:[^\s:]+(?::[^\s:]+)*:)\s*$/.exec(rest);
  let tags = '';
  if (tagMatch) {
    rest = tagMatch[1];
    tags = tagMatch[2];
  }
  let todo = '';
  const word = /^(\S+)(?: |$)/.exec(rest);
  if (word && opts.todoKeywords.has(word[1]) && rest.length > word[1].length) {
    todo = word[1];
    rest = rest.slice(word[1].length + 1);
  }
  let priority = '';
  const cookie = /^(\[#[A-Z0-9]+\])(?: |$)/.exec(rest);
  if (cookie) {
    priority = cookie[1];
    rest = rest.slice(cookie[0].length);
  }
  const left = [m[1], [opts.todo ? todo : '', opts.priority ? priority : '', rest].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  const shown = opts.tags ? tags : '';
  if (!shown) return left + (left === m[1] ? ' ' : '');
  return left + ' '.repeat(Math.max(1, TAGS_COLUMN - width(left) - width(shown))) + shown;
}

/**
 * The text ox-org writes for `text`, a whole document in Org syntax.
 * @param {string} text
 * @param {InterpretOptions} opts
 */
export function interpretOrg(text, opts) {
  const lines = text.split('\n');
  /** @type {string[][]} */
  const sections = [[]];
  /** @type {string[]} */
  const heads = [''];
  for (const line of lines) {
    if (/^\*+(?: |$)/.test(line)) {
      heads.push(line);
      sections.push([]);
    } else {
      sections[sections.length - 1].push(line);
    }
  }
  const referenced = new Set();
  for (const line of lines) for (const m of line.matchAll(/\[fn:([^\]\s:]+)/g)) if (m.index !== 0 || !/^\[fn:[^\]\s]+\]/.test(line)) referenced.add(m[1]);
  opts = { ...opts, referenced };
  /** @type {string[]} */
  const out = [];
  // the file's own keywords: OPTIONS first, then title, date, author and email
  /** @type {string[]} */
  const options = [];
  /** @type {Record<string, string[]>} */
  const info = { TITLE: [], DATE: [], AUTHOR: [], EMAIL: [] };
  sections[0] = sections[0].filter((l) => {
    const m = /^#\+(TITLE|AUTHOR|DATE|EMAIL|OPTIONS):[ \t]*(.*?)\s*$/i.exec(l);
    if (!m) return true;
    if (m[1].toUpperCase() === 'OPTIONS') options.push(m[2]);
    else info[m[1].toUpperCase()].push(m[2]);
    return false;
  });
  if (opts.selective) {
    sections[0] = []; // with selected trees, the text before the first headline is left out
    options.length = 0;
  }
  for (const v of options) out.push(`#+options: ${v}`.trimEnd());
  if (opts.title && info.TITLE.length) out.push(`#+title: ${info.TITLE.join(' ')}`);
  if (opts.date && info.DATE.length) out.push(`#+date: ${info.DATE.join(' ')}`);
  if (opts.author && info.AUTHOR.length) out.push(`#+author: ${info.AUTHOR.join(' ')}`);
  if (opts.email && info.EMAIL.length) out.push(`#+email: ${info.EMAIL.join(' ')}`);
  sections.forEach((body, n) => {
    if (n > 0) out.push(headline(heads[n], opts));
    const { rest, written } = prologue(body, opts, n === 0);
    out.push(...written, ...render(rest, opts));
  });
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.length ? out.join('\n') + '\n' : '';
}
