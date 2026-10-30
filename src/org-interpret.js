// @ts-check
/**
 * The text Emacs's Org export back end (ox-org) writes: the document read as Org elements and written out again in
 * Org's canonical form. Headlines have their tags placed at `org-tags-column` and lose a priority cookie, SCHEDULED/DEADLINE lines, property drawers and
 * LOGBOOK drawers unless #+OPTIONS: asks for them; keywords and block markers are lower case; source and example blocks
 * are indented by two; tables are re-aligned; ordered lists are renumbered; export snippets and blocks for other back ends are dropped.
 * Compared with Emacs 29.3 / Org 9.6.15.
 */

/**
 * @typedef {{
 *   todoKeywords: Set<string>, todo: boolean, priority: boolean, tags: boolean, planning: boolean, properties: boolean,
 *   drawer: (name: string) => boolean, footnotes: boolean, tables?: boolean, stat?: boolean, clocks?: boolean, creator?: string, abbreviations?: Map<string, string>, title: boolean, author: boolean, date: boolean, email: boolean,
 *   selective?: boolean, nested?: boolean,
 *   cite?: { text: (c: any) => string, bibliography: string[] },
 * }} InterpretOptions
 */

import { parseCitationAt } from './cite.js';
import { layoutTable } from './org-table-layout.js';
import { getTagsColumn, withTags } from './tags-column.js';
import { expandAbbreviation } from './link-abbrev.js';

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
  out = out.replace(/\[\[((?:\\.|[^\][\\])+)(\]\[[^\]]*)?\]\]/g, (whole, raw, desc) => {
    const target = expandAbbreviation(raw.replace(/\\([[\]])/g, '$1'), opts.abbreviations ?? new Map());
    if (target.startsWith('doi:')) return 'https://doi.org/' + target.slice(4); // a DOI is written as its address, with no description
    if (target.startsWith('bbdb:') && desc) return desc.slice(2); // a BBDB link is its description
    if (/^(?:\.{1,2}\/|\/|~\/)/.test(target)) return `[[file:${target}${desc || ''}]]`;
    return `[[${target}${desc || ''}]]`;
  });
  out = out.replace(TIMESTAMP_RE, (_whole, a, b, spaces) => splitTimeRange(a) + (b ? '--' + splitTimeRange(b) : '') + (spaces ? spaces + spaces : ''));
  if (opts.stat === false) out = out.replace(STAT_RE, '');
  if (!opts.footnotes) out = out.replace(/\[fn:[^\]\s]*(?::[^\]]*)?\][ \t]*/g, ''); // the blanks after a dropped reference go with it
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
  if (!data.length) return rows.map(() => '|---|'); // a table of rules only has one empty column
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
    // clock lines are left out unless c:t, and then written in one form
    const clock = CLOCK_RE.exec(line);
    if (clock) {
      i++;
      if (opts.clocks) out.push(`CLOCK: ${clock[1]}${clock[2] ? '--' + clock[2] : ''}${clock[3] ? ' =>  ' + clock[3] : ''}`);
      else while (i < lines.length && isBlank(lines[i])) i++;
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
          while (rows.length && isBlank(rows[rows.length - 1])) rows.pop(); // the code ends with its last line
          const widths = rows.filter((l) => !isBlank(l)).map(indentOf);
          const min = widths.length ? Math.min(...widths) : 0;
          const keep = /(?:^|\s)-i(?:\s|$)/.test(params); // -i keeps the code as it is
          out.push(`#+begin_${lower}${params ? ' ' + params : ''}`, ...(keep ? content.slice(0, rows.length) : rows.map((l) => (isBlank(l) ? '' : '  ' + l.slice(min)))), `#+end_${lower}`);
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
      // an affiliated keyword goes with the export block (for another back end) it belongs to, which is not written
      const next = i < lines.length ? BLOCK_BEGIN_RE.exec(lines[i]) : null;
      if (/^(?:RESULTS|NAME|CAPTION|HEADERS?)(?:\[.*\])?$/i.test(key) && next && next[1].toLowerCase() === 'export' && (next[2] || '').split(/\s+/)[0].toLowerCase() !== 'org') continue;
      if (key.toUpperCase() === 'TBLFM' && afterTable) {
        out.push(`#+TBLFM: ${keyword[2]}`);
        continue;
      }
      afterTable = false;
      if (key.toUpperCase() === 'PRINT_BIBLIOGRAPHY' && opts.cite?.bibliography.length) {
        out.push(...opts.cite.bibliography.flatMap((entry, n) => (n ? ['', entry] : [entry])));
        continue;
      }
      out.push(`#+${key.replace(/^[^[]*/, (k) => k.toLowerCase())}: ${keyword[2]}`);
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
      if (opts.tables !== false) out.push(...table(run, opts));
      else while (i < lines.length && isBlank(lines[i])) i++; // a dropped table takes its blank lines along
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
    // a paragraph
    const start = i;
    i++;
    while (i < lines.length && !interrupts(lines[i], opts.nested)) i++;
    const text = lines.slice(start, i);
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
    if (rendered.length) out[out.length - 1] = out[out.length - 1].trimEnd(); // an item's contents lose their trailing blanks
    i = j;
    let k = i;
    while (k < lines.length && isBlank(lines[k])) k++;
    const next = k < lines.length ? itemMatch(lines[k], opts.nested) : null;
    if (next && indentOf(lines[k]) === base && k - i < 2) {
      if (text === '' && rendered.length === 0) out.push(''); // an item with nothing in it is followed by a blank line
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

const CLOCK_RE = /^\s*CLOCK:\s*(\[[^\]]*\])(?:--(\[[^\]]*\]))?(?:\s*=>\s*(\S+))?\s*$/;
const STAT_RE = /\[(?:\d*%|\d*\/\d*)\]/g;
const NOTE_RE = /^\[fn:([^\]\s:]+)\]/;
const BLOCK_OPEN_RE = /^[ \t]*#\+begin_(\S+)/i;

/**
 * Footnote definitions taken out of a run of lines: a definition runs to the next definition, the next headline (not in these
 * lines) or two blank lines in a row, and leaves nothing behind (ox-org writes it after the section of its first reference).
 * @param {string[]} lines
 * @returns {{ rest: string[], notes: { label: string, lines: string[] }[] }}
 */
function takeNotes(lines) {
  /** @type {string[]} */
  const rest = [];
  /** @type {{ label: string, lines: string[] }[]} */
  const notes = [];
  let i = 0;
  while (i < lines.length) {
    const open = BLOCK_OPEN_RE.exec(lines[i]);
    if (open) {
      const close = new RegExp(`^[ \\t]*#\\+end_${escapeRe(open[1])}\\s*$`, 'i');
      let k = i + 1;
      while (k < lines.length && !close.test(lines[k])) k++;
      const end = Math.min(k + 1, lines.length);
      rest.push(...lines.slice(i, end));
      i = end;
      continue;
    }
    const note = NOTE_RE.exec(lines[i]);
    if (!note) {
      rest.push(lines[i++]);
      continue;
    }
    const start = i;
    i++;
    let blanks = 0;
    while (i < lines.length && blanks < 2 && !NOTE_RE.test(lines[i])) blanks = isBlank(lines[i++]) ? blanks + 1 : 0;
    const block = lines.slice(start, i);
    block[0] = block[0].slice(note[0].length).replace(/^\s+/, '');
    while (block.length && isBlank(block[block.length - 1])) block.pop();
    notes.push({ label: note[1], lines: block });
  }
  return { rest, notes };
}

/** The labels of the footnote references in a run of lines, in order, those of named inline definitions with a colon in front (literal blocks, fixed-width lines and comments hold none). @param {string[]} lines */
function noteRefs(lines) {
  /** @type {string[]} */
  const labels = [];
  let block = '';
  for (const line of lines) {
    if (block) {
      if (new RegExp(`^[ \\t]*#\\+end_${escapeRe(block)}\\s*$`, 'i').test(line)) block = '';
      continue;
    }
    const open = BLOCK_OPEN_RE.exec(line);
    if (open) {
      block = open[1];
      continue;
    }
    if (/^[ \t]*(?::(?: |$)|#(?: |$))/.test(line)) continue;
    for (const m of line.matchAll(/\[fn:([^\]\s:]+)(\]|:)/g)) labels.push(m[2] === ':' ? ':' + m[1] : m[1]);
  }
  return labels;
}

/** @param {string} line @param {InterpretOptions} opts */
function headline(line, opts) {
  const m = /^(\*+)(?: (.*))?$/.exec(line);
  if (!m) return line;
  let rest = (m[2] ?? '').trim();
  const tagMatch = /^(.*?)\s+(:[^\s:]+(?::[^\s:]+)*:)\s*$/.exec(rest);
  let tags = '';
  if (tagMatch) {
    rest = tagMatch[1];
    tags = tagMatch[2];
  }
  if (opts.stat === false) rest = rest.replace(STAT_RE, '');
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
  return withTags(left, shown, getTagsColumn());
}

/**
 * The text ox-org writes for `text`, a whole document in Org syntax.
 * @param {string} text
 * @param {InterpretOptions} opts
 */
export function interpretOrg(text, opts) {
  const lines = text.split('\n');
  // #+LINK: abbreviations count wherever they stand in the file
  /** @type {Map<string, string>} */
  const abbreviations = new Map();
  for (const line of lines) {
    const link = /^#\+LINK:[ \t]+(\S+)[ \t]+(\S.*?)\s*$/i.exec(line);
    if (link && !abbreviations.has(link[1])) abbreviations.set(link[1], link[2]);
  }
  opts = { ...opts, abbreviations };
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
  // footnote definitions leave their place; each is written after the section where its label is first used
  const trailing = sections.map((b) => {
    let k = b.length;
    while (k > 0 && isBlank(b[k - 1])) k--;
    return b.length - k;
  });
  /** @type {Map<string, string[]>} */
  const defined = new Map();
  /** @type {string[][]} */
  const wanted = sections.map(() => []);
  /** @type {Set<string>} */
  const seen = new Set();
  sections.forEach((b, n) => {
    const { rest, notes } = takeNotes(b);
    for (const note of notes) if (!defined.has(note.label)) defined.set(note.label, note.lines);
    sections[n] = rest;
    for (const ref of noteRefs([heads[n], ...rest])) {
      const label = ref.replace(/^:/, '');
      if (!seen.has(label) && ref === label) wanted[n].push(label);
      seen.add(label);
    }
  });
  /** @type {string[]} */
  const out = [];
  // the file's own keywords: OPTIONS first, then title, date, author and email
  /** @type {string[]} */
  const options = [];
  /** @type {Record<string, string[]>} */
  const info = { TITLE: [], DATE: [], AUTHOR: [], EMAIL: [] };
  sections.forEach((b, n) => {
    /** @type {string[]} */
    const kept = [];
    let block = '';
    for (let i = 0; i < b.length; i++) {
      const l = b[i];
      if (block) {
        if (new RegExp(`^[ \\t]*#\\+end_${escapeRe(block)}\\s*$`, 'i').test(l)) block = '';
        kept.push(l);
        continue;
      }
      const open = BLOCK_OPEN_RE.exec(l);
      if (open) block = open[1];
      const m = !open && /^#\+(TITLE|AUTHOR|DATE|EMAIL|OPTIONS|CREATOR):[ \t]*(.*?)\s*$/i.exec(l);
      if (!m) {
        kept.push(l);
        continue;
      }
      // the keyword goes with the blank lines after it
      while (i + 1 < b.length && isBlank(b[i + 1])) i++;
      if (m[1].toUpperCase() === 'OPTIONS') options.push(m[2]);
      else if (m[1].toUpperCase() !== 'CREATOR') info[m[1].toUpperCase()].push(m[2]);
    }
    sections[n] = kept;
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
  if (opts.creator) out.push(`#+creator: ${opts.creator}`);
  let skipLevel = 0; // inside a headline titled "Footnotes", which Org leaves out with everything under it
  sections.forEach((body, n) => {
    if (n > 0) {
      const level = /^\*+/.exec(heads[n])?.[0].length ?? 1;
      if (skipLevel && level > skipLevel) return;
      skipLevel = 0;
      const title = heads[n].replace(/^\*+\s*/, '').replace(/\s+:[^\s:]+(?::[^\s:]+)*:\s*$/, '').replace(/^\S+\s+/, (w) => (opts.todoKeywords.has(w.trim()) ? '' : w));
      if (title.trim() === 'Footnotes') {
        skipLevel = level;
        return;
      }
      out.push(headline(heads[n], opts));
    }
    const { rest, written } = prologue(body, opts, n === 0);
    const lines = [...written, ...render(rest, opts)];
    if (!opts.footnotes || !wanted[n].length) {
      out.push(...lines);
      return;
    }
    let lead = 0;
    while (lead < lines.length && lines[lead] === '') lead++;
    let end = lines.length;
    while (end > lead && lines[end - 1] === '') end--;
    out.push(...lines.slice(0, end));
    for (const label of wanted[n].filter((l) => defined.has(l))) { // a reference with no definition stays as it is (Emacs stops with an error)
      out.push('');
      out.push(...`[fn:${label}] ${render(/** @type {string[]} */ (defined.get(label)), opts).join('\n')}`.split('\n'));
    }
    out.push(...Array(trailing[n]).fill(''));
  });
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.length ? out.join('\n') + '\n' : '';
}
