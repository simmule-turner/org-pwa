// @ts-check
/** @typedef {import('./types.js').Doc} Doc */
// Org's citations (org-cite): `[cite/style:prefix;@key suffix;@key2;suffix]` in the text, `#+BIBLIOGRAPHY:` files, `#+CITE_EXPORT:`
// and `#+PRINT_BIBLIOGRAPHY:`. This is the `basic` export processor of Emacs's oc-basic.el, step for step, so the text it
// produces is what Emacs produces: author-year (the default), `text`, `author`, `noauthor`, `nocite` and `numeric` styles with
// their `bare` and `caps` variants, author-year disambiguation (a, b, ...), and a bibliography in author-year, `plain` or
// `numeric` form. Bibliographies are BibTeX/BibLaTeX (.bib, .bibtex) or CSL-JSON (.json).

/** What a processor produces, before an exporter turns it into its own markup: plain text (to be escaped), Org text such as a
 * citation prefix (to be run through the exporter's own inline markup), and emphasis.
 * @typedef {string | { org: string } | { italic: Segment[] }} Segment */

/** @typedef {{ key: string, prefix: string, suffix: string }} CiteRef */
/** @typedef {{ type: 'citation', style: string | null, prefix: string, suffix: string, refs: CiteRef[], blanks: number, raw: string }} CitationNode */
/** @typedef {Record<string, string>} BibEntry */

const KEY_CHAR = "[\\p{L}\\p{N}_\\-.:?!`'/*@+|(){}<>&^$#%~]";
const KEY_RE = new RegExp('@(' + KEY_CHAR + '+)', 'u');
const PREFIX_RE = /^\[cite(?:\/([/_\-\p{L}\p{N}]+))?:[\t\n ]*/u;

/** The end of the bracket that opens at `pos`, balancing `[` and `]`; -1 when it never closes.
 * @param {string} text @param {number} pos */
function closingBracket(text, pos) {
  let depth = 0;
  for (let i = pos; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']' && --depth === 0) return i;
  }
  return -1;
}

/**
 * The citation that starts at `pos` in `text`, as org-element reads it: an optional style, an optional common prefix
 * (before the first `;` that precedes the first key), references (prefix, `@key`, suffix, ended by `;`) and an optional common
 * suffix (after the last `;` when no key follows it). Null when it is not a citation (no key, or no closing bracket).
 * @param {string} text @param {number} pos
 * @returns {{ length: number, node: CitationNode } | null}
 */
export function parseCitationAt(text, pos) {
  if (text[pos] !== '[' || !text.startsWith('[cite', pos)) return null;
  const head = PREFIX_RE.exec(text.slice(pos, pos + 200));
  if (!head) return null;
  const closing = closingBracket(text, pos);
  if (closing < 0) return null;
  const start = pos + head[0].length;
  const inner = text.slice(start, closing);
  const firstKey = KEY_RE.exec(inner);
  if (!firstKey) return null;
  const firstKeyEnd = firstKey.index + firstKey[0].length;
  // common prefix: up to the last ';' before the end of the first key
  let contentsBegin = 0;
  let prefix = '';
  const semi = inner.lastIndexOf(';', firstKeyEnd - 1);
  if (semi >= 0 && semi < firstKey.index) {
    prefix = inner.slice(0, semi);
    contentsBegin = semi + 1;
  }
  // common suffix: after the last ';' (not before the first key) when no key follows it
  let end = inner.length;
  while (end > 0 && /[ \r\t\n]/.test(inner[end - 1])) end--;
  let contentsEnd = end;
  let suffix = '';
  const last = inner.lastIndexOf(';', end - 1);
  if (last >= firstKeyEnd && last >= 0 && !KEY_RE.test(inner.slice(last, end))) {
    suffix = inner.slice(last + 1, end);
    contentsEnd = last + 1;
  }
  /** @type {CiteRef[]} */ const refs = [];
  const body = inner.slice(contentsBegin, contentsEnd);
  let at = 0;
  while (at < body.length) {
    const key = KEY_RE.exec(body.slice(at));
    if (!key) break;
    const keyStart = at + key.index;
    const keyEnd = keyStart + key[0].length;
    const sep = body.indexOf(';', keyEnd);
    const refEnd = sep < 0 ? body.length : sep + 1;
    const suffixEnd = sep < 0 ? body.length : sep;
    refs.push({ key: key[1], prefix: body.slice(at, keyStart), suffix: body.slice(keyEnd, suffixEnd) });
    at = refEnd;
  }
  if (!refs.length) return null;
  let length = closing + 1 - pos;
  let blanks = 0;
  while (text[pos + length] === ' ' || text[pos + length] === '\t') {
    length++;
    blanks++;
  }
  return { length, node: { type: 'citation', style: head[1] || null, prefix, suffix, refs, blanks, raw: text.slice(pos, closing + 1) } };
}

// ---- bibliography files ------------------------------------------------------------

const MONTHS = { jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June', jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December' };

/** @param {string} s */
const squeeze = (s) => s.replace(/[ \t\n\r]+/g, ' ');

/**
 * BibTeX or BibLaTeX text -> entries by key. A field's outer braces or quotes are removed (inner braces stay), `@string` macros
 * and `#` concatenation are expanded and runs of white space become one space.
 * @param {string} text
 * @returns {Map<string, BibEntry>}
 */
export function parseBibtex(text) {
  /** @type {Map<string, BibEntry>} */ const entries = new Map();
  /** @type {Record<string, string>} */ const macros = { ...MONTHS };
  let i = 0;
  const n = text.length;
  const skipSpace = () => {
    while (i < n && /\s/.test(text[i])) i++;
  };
  /** The balanced `{...}` or `(...)` group at i, returned without its delimiters. */
  const group = () => {
    const open = text[i];
    const close = open === '{' ? '}' : ')';
    let depth = 0;
    const from = i + 1;
    for (; i < n; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close && --depth === 0) {
        i++;
        return text.slice(from, i - 1);
      }
    }
    return text.slice(from);
  };
  const value = () => {
    let out = '';
    for (;;) {
      skipSpace();
      if (text[i] === '{') out += group();
      else if (text[i] === '"') {
        let depth = 0;
        const from = ++i;
        for (; i < n; i++) {
          if (text[i] === '\\') i++;
          else if (text[i] === '{') depth++;
          else if (text[i] === '}') depth--;
          else if (text[i] === '"' && depth === 0) break;
        }
        out += text.slice(from, i);
        i++;
      } else {
        const m = /^[^\s,#{}()"=]+/.exec(text.slice(i));
        if (!m) break;
        out += /^\d+$/.test(m[0]) ? m[0] : (macros[m[0].toLowerCase()] ?? m[0]);
        i += m[0].length;
      }
      skipSpace();
      if (text[i] === '#') i++;
      else break;
    }
    return squeeze(out);
  };
  while (i < n) {
    const at = text.indexOf('@', i);
    if (at < 0) break;
    i = at + 1;
    const typeMatch = /^[A-Za-z]+/.exec(text.slice(i));
    if (!typeMatch) continue;
    const type = typeMatch[0].toLowerCase();
    i += typeMatch[0].length;
    skipSpace();
    if (text[i] !== '{' && text[i] !== '(') continue;
    if (type === 'comment' || type === 'preamble') {
      group();
      continue;
    }
    const bodyStart = i;
    const close = text[i] === '{' ? '}' : ')';
    i++;
    skipSpace();
    if (type === 'string') {
      const name = /^[^\s=]+/.exec(text.slice(i));
      if (name) {
        i += name[0].length;
        skipSpace();
        if (text[i] === '=') {
          i++;
          macros[name[0].toLowerCase()] = value();
        }
      }
      i = bodyStart;
      group();
      continue;
    }
    const keyMatch = /^[^\s,{}()]+/.exec(text.slice(i));
    if (!keyMatch) continue;
    i += keyMatch[0].length;
    /** @type {BibEntry} */ const entry = { id: keyMatch[0], type };
    for (;;) {
      skipSpace();
      if (text[i] === ',') i++;
      skipSpace();
      if (i >= n || text[i] === close) {
        i++;
        break;
      }
      const field = /^[^\s=,{}()]+/.exec(text.slice(i));
      if (!field) {
        i++;
        continue;
      }
      i += field[0].length;
      skipSpace();
      if (text[i] !== '=') continue;
      i++;
      entry[field[0].toLowerCase()] = value();
    }
    if (!entries.has(entry.id)) entries.set(entry.id, entry);
  }
  return entries;
}

/**
 * CSL-JSON text -> entries by id. Authors and editors become "family given and family given", and `issued` becomes `year`,
 * as oc-basic reads them.
 * @param {string} text
 * @returns {Map<string, BibEntry>}
 */
export function parseCslJson(text) {
  /** @type {Map<string, BibEntry>} */ const entries = new Map();
  let items;
  try {
    items = JSON.parse(text);
  } catch {
    return entries;
  }
  if (!Array.isArray(items)) return entries;
  for (const item of items) {
    if (!item || typeof item.id === 'undefined') continue;
    /** @type {BibEntry} */ const entry = { id: String(item.id) };
    for (const [field, value] of Object.entries(item)) {
      if ((field === 'author' || field === 'editor') && Array.isArray(value)) {
        entry[field] = value.map((p) => `${p.family ?? ''} ${p.given ?? ''}`).join(' and ');
      } else if (field === 'issued' && value && typeof value === 'object') {
        const v = (value);
        const date = v['date-parts'] ?? v.literal ?? v.raw;
        if (Array.isArray(date)) {
          const year = Array.isArray(date[0]) ? date[0][0] : date[0];
          if (year !== undefined) entry.year = String(year);
        } else if (typeof date === 'string') entry.year = date.replace(/^.*?(\d{4}).*$/s, '$1');
      } else if (typeof value === 'string' || typeof value === 'number') entry[field] = String(value);
    }
    entries.set(entry.id, entry);
  }
  return entries;
}

/** @param {string} text @param {string} path */
export function parseBibliography(text, path) {
  return /\.json$/i.test(path) ? parseCslJson(text) : parseBibtex(text);
}

/** @type {Map<string, string>} */
const bibliographyTexts = new Map();
/** @type {Map<string, { text: string, entries: Map<string, BibEntry> }>} */
const parsedCache = new Map();

/** @param {string} path @param {string} text */
export function cacheBibliography(path, text) {
  bibliographyTexts.set(path, text);
  parsedCache.delete(path);
}

/** @param {string} path */
export function hasBibliography(path) {
  return bibliographyTexts.has(path);
}

/** @param {string} path */
function entriesOf(path) {
  const text = bibliographyTexts.get(path);
  if (text === undefined) return null;
  const hit = parsedCache.get(path);
  if (hit && hit.text === text) return hit.entries;
  const entries = parseBibliography(text, path);
  parsedCache.set(path, { text, entries });
  return entries;
}

// ---- the document's citation settings ------------------------------------------------

/** @param {string} v */
const stripQuotes = (v) => v.trim().replace(/^"(.*)"$/s, '$1');

/** The bibliography files a document names with `#+BIBLIOGRAPHY:`, followed by the global ones.
 * @param {Doc} doc @param {string[]} [globalFiles] */
export function bibliographyFiles(doc, globalFiles = []) {
  const own = (doc.keywords || []).filter((k) => k.key.toUpperCase() === 'BIBLIOGRAPHY').map((k) => stripQuotes(k.value)).filter(Boolean);
  return [...new Set([...own, ...globalFiles])];
}

/** `#+CITE_EXPORT: processor bibliography-style citation-style` (the last two optional; a quoted token may hold spaces).
 * @param {Doc} doc
 * @returns {{ processor: string, bibStyle: string | null, citeStyle: string | null }} */
export function citeExportSetting(doc) {
  const kw = (doc.keywords || []).filter((k) => k.key.toUpperCase() === 'CITE_EXPORT').pop();
  if (!kw) return { processor: 'basic', bibStyle: null, citeStyle: null };
  const tokens = [...kw.value.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1] : m[2]));
  const nilToNull = (/** @type {string | undefined} */ t) => (t === undefined || t === '' || t === 'nil' ? null : t);
  return { processor: tokens[0] || 'basic', bibStyle: nilToNull(tokens[1]), citeStyle: nilToNull(tokens[2]) };
}

/** The bibliography files still to be fetched (named but not cached).
 * @param {Doc} doc @param {string[]} [globalFiles] */
export function missingBibliographyFiles(doc, globalFiles = []) {
  return bibliographyFiles(doc, globalFiles).filter((f) => !bibliographyTexts.has(f));
}

// ---- walking a document's citations ----------------------------------------------------

/** @param {any[]} nodes @param {(c: CitationNode) => void} fn */
function visitNodes(nodes, fn) {
  for (const node of nodes || []) {
    if (node.type === 'citation') fn(node);
    if (node.children) visitNodes(node.children, fn);
  }
}

/** @param {any[]} items @param {(c: CitationNode) => void} fn */
function visitItems(items, fn) {
  for (const item of items || []) {
    visitNodes(item.inline, fn);
    for (const nested of item.children || []) visitItems(nested.items, fn);
  }
}

/** Every citation in these body nodes, in order. @param {any[]} body @param {(c: CitationNode) => void} fn */
function visitBody(body, fn) {
  for (const node of body || []) {
    if (node.type === 'paragraph') for (const line of node.inlineLines || []) visitNodes(line, fn);
    else if (node.type === 'list') visitItems(node.items, fn);
    else if (node.type === 'table') for (const row of node.rows || []) for (const cell of row.cellsInline || []) visitNodes(cell, fn);
  }
}

/**
 * The citations of an export, in document order: those before the first heading (when the whole document is exported) and
 * those under `roots`.
 * @param {Doc} doc @param {any[] | undefined} roots @param {(text: string) => any[]} parseTitle @param {boolean} [withPreamble]
 * @returns {CitationNode[]}
 */
export function collectCitations(doc, roots, parseTitle, withPreamble = !roots) {
  /** @type {CitationNode[]} */ const out = [];
  const push = (/** @type {CitationNode} */ c) => out.push(c);
  if (withPreamble) visitBody(/** @type {any} */ (doc).body, push);
  /** @param {any[]} headings */
  const walk = (headings) => {
    for (const h of headings || []) {
      if (h.type !== 'heading') continue;
      visitNodes(parseTitle(h.title || ''), push);
      visitBody(h.body, push);
      walk(h.children);
    }
  };
  walk(roots || doc.children);
  return out;
}

// ---- the basic processor -------------------------------------------------------------

/** @param {number} n  the letter suffix oc-basic gives the n-th entry sharing an author and year */
function numberToSuffix(n) {
  /** @type {number[]} */ let result = [];
  for (;;) {
    result.unshift(n % 26);
    n = Math.floor(n / 26);
    if (n === 0) break;
    if (n < 27) {
      result = [n - 1, ...result];
      break;
    }
    if (n === 27) {
      result = [0, 0, ...result];
      break;
    }
  }
  return String.fromCharCode(...result.map((c) => 97 + c));
}

/** @param {string} s  Emacs `capitalize`: each word starts upper case and goes on lower case */
const capitalize = (s) => s.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

/** @typedef {{ sortingField: string | null, separator: string }} CiteOptions */

/**
 * Everything one export needs to turn citations and the bibliography into text.
 * @param {{ files: string[], processor?: string, bibStyle: string | null, citeStyle: string | null, citations: CitationNode[], options?: Partial<CiteOptions> }} input
 */
export function createCiteExport({ files, bibStyle, citeStyle, citations, options = {} }) {
  const sortingField = options.sortingField === undefined ? 'author' : options.sortingField;
  const separator = options.separator === undefined ? ', ' : options.separator;
  const tables = files.map((f) => entriesOf(f)).filter((t) => t !== null);
  /** @param {string} key @returns {BibEntry | null} */
  const entryOf = (key) => {
    for (const t of tables) {
      const e = /** @type {Map<string, BibEntry>} */ (t).get(key);
      if (e) return e;
    }
    return null;
  };
  /** Keys in order of first citation, duplicates removed. */
  const keys = [...new Set(citations.flatMap((c) => c.refs.map((r) => r.key)))];
  /** @param {string} key @param {string} field */
  const fieldOf = (key, field) => entryOf(key)?.[field];
  const lessThan = sortingField
    ? (/** @type {string} */ a, /** @type {string} */ b) => {
        // a missing field compares as the symbol nil does in Emacs: as the word "nil"
        const x = (fieldOf(a, sortingField) ?? 'nil').toLowerCase();
        const y = (fieldOf(b, sortingField) ?? 'nil').toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
      }
    : null;
  const sortedKeys = lessThan ? [...keys].sort(lessThan) : keys;
  /** @param {string} key */
  const keyNumber = (key) => sortedKeys.indexOf(key) + 1;

  /** (author . year) -> [[key, suffix]] , in the order the years were asked for, as oc-basic keeps it */
  /** @type {{ author: string | undefined, year: string | undefined, alist: [string, string][] }[]} */
  const cache = [];
  /** @param {BibEntry | null} entry */
  const authorOf = (entry) => (entry ? (entry.author ?? entry.editor) : undefined);
  /** @param {string} key @param {boolean} [noSuffix] */
  const yearOf = (key, noSuffix = false) => {
    const entry = entryOf(key);
    const author = authorOf(entry);
    let year = entry ? entry.year : undefined;
    if (year === undefined && entry && typeof entry.date === 'string') {
      const m = /^(\d{4})(?:$|\D)/.exec(entry.date);
      if (m) year = m[1];
    }
    const hit = cache.find((c) => c.author === author && c.year === year);
    if (!hit) {
      cache.push({ author, year, alist: [[key, '']] });
      return year;
    }
    // oc-basic only ever remembers the first key of an author and year; every other key of the pair gets "a" (it pushes the new
    // suffix onto a copy of the list), so that is what is reproduced here
    const found = hit.alist.find((p) => p[0] === key) ?? [key, numberToSuffix(hit.alist.length - 1)];
    return noSuffix ? year : (year ?? '') + found[1];
  };
  /** @param {string} key */
  const authorOfKey = (key) => authorOf(entryOf(key));

  /** Segments for an affix. @param {string} text @returns {Segment[]} */
  const affix = (text) => (text ? [{ org: text }] : []);
  /** @param {(string | undefined | Segment[])[]} parts @returns {Segment[]} */
  const concat = (...parts) => parts.flatMap((p) => (p === undefined || p === '' ? [] : Array.isArray(p) ? p : [p]));

  /** @param {CitationNode} citation @returns {{ name: string | null, variant: string | null }} */
  const styleOf = (citation) => {
    /** @param {string | null} s */
    const separate = (s) => {
      if (!s) return [null, null];
      const slash = s.indexOf('/');
      if (slash < 0) return [s, null];
      return [s.slice(0, slash), s.slice(slash + 1).trim() || null];
    };
    const [localName, localVariant] = separate(citation.style);
    const [globalName, globalVariant] = separate(citeStyle);
    const notNil = (/** @type {string | null} */ v) => (v === null || v.trim() === '' || v === 'nil' ? null : v);
    if (localName && localName.trim()) return { name: notNil(localName), variant: localVariant };
    return { name: notNil(globalName), variant: localVariant ?? globalVariant };
  };
  const BARE = ['bare', 'bare-caps', 'b', 'bc'];
  const CAPS = ['caps', 'bare-caps', 'c', 'bc'];

  /** @param {CitationNode} citation @param {(p: Segment[], c: Segment[], s: Segment[]) => Segment[]} formatCite
   * @param {(p: Segment[], a: string | undefined, y: string | undefined, s: Segment[]) => Segment[]} formatRef */
  const authorYear = (citation, formatCite, formatRef) => {
    /** @type {Segment[]} */ const refs = [];
    citation.refs.forEach((ref, i) => {
      if (i > 0) refs.push(separator);
      refs.push(...formatRef(affix(ref.prefix), authorOfKey(ref.key), yearOf(ref.key), affix(ref.suffix)));
    });
    return formatCite(affix(citation.prefix), refs, affix(citation.suffix));
  };

  /** @param {CitationNode} citation */
  const citationNumbers = (citation) => {
    const numbers = citation.refs.map((r) => keyNumber(r.key)).sort((a, b) => a - b);
    let last = numbers[0];
    /** @type {string[]} */ const result = [String(numbers.shift())];
    while (numbers.length) {
      const current = /** @type {number} */ (numbers.shift());
      const next = numbers[0];
      if (next !== undefined && current === last + 1 && current === next - 1) {
        if (result[result.length - 1] !== '-') result.push('-');
      } else if (result[result.length - 1] === '-') result.push(String(current));
      else result.push(', ' + current);
      last = current;
    }
    return result.join('');
  };

  /**
   * The text of a citation, or null when it prints nothing (the `nocite` style).
   * @param {CitationNode} citation
   * @returns {Segment[] | null}
   */
  function formatCitation(citation) {
    const { name, variant } = styleOf(citation);
    const bare = !!variant && BARE.includes(variant);
    const caps = !!variant && CAPS.includes(variant);
    const cap = (/** @type {string | undefined} */ a) => (a !== undefined && caps ? capitalize(a) : a);
    if (name === 'author' || name === 'a') {
      const capsA = variant === 'caps' || variant === 'c';
      return [citation.refs.map((r) => { const a = authorOfKey(r.key); return a !== undefined && capsA ? capitalize(a) : (a ?? ''); }).join(separator)];
    }
    if (name === 'noauthor' || name === 'na') {
      const years = citation.refs.map((r) => yearOf(r.key) ?? '').join(separator);
      return [bare ? years : `(${years})`];
    }
    if (name === 'nocite' || name === 'n') return null;
    if (name === 'text' || name === 'note' || name === 't' || name === 'ft') {
      return authorYear(
        citation,
        (p, c, s) => concat(p, c, s),
        (p, a, y, s) => concat(p, cap(a), bare ? ' ' : ' (', y, s, bare ? undefined : ')')
      );
    }
    if (name === 'numeric' || name === 'nb') {
      const single = citation.refs.length === 1 ? citation.refs[0] : null;
      const prefix = single ? single.prefix : citation.prefix;
      const suffix = single ? single.suffix : citation.suffix;
      return concat('(', affix(prefix), citationNumbers(citation), affix(suffix), ')');
    }
    return authorYear(
      citation,
      (p, c, s) => concat(bare ? undefined : '(', p, c, s, bare ? undefined : ')'),
      (p, a, y, s) => concat(p, cap(a), ', ', y, s)
    );
  }

  /** @param {string | undefined} names @returns {string | undefined} */
  const shortenNames = (names) => (typeof names === 'string' ? names.split(' and ').map((n) => n.split(', ')[0]).join(', ') : undefined);

  /** @param {BibEntry} entry @returns {Segment[]} */
  function printEntry(entry) {
    const author = entry.author ?? entry.editor;
    const title = entry.title;
    const from = entry.publisher ?? entry.journal ?? entry.institution ?? entry.school;
    if (bibStyle === 'plain') {
      return concat(shortenNames(author), '. ', title, from ? [', ', from] : undefined, ', ', yearOf(entry.id, true), '.');
    }
    if (bibStyle === 'numeric') {
      return concat(`[${keyNumber(entry.id)}] `, author, ', ', title === undefined ? undefined : [{ italic: [title] }], from ? [', ', from] : undefined, ', ', yearOf(entry.id, true), '.');
    }
    return concat(author, ' (', yearOf(entry.id), '). ', title === undefined ? undefined : [{ italic: [title] }], from ? [', ', from] : undefined, '.');
  }

  /** The bibliography, one segment list per entry (cited keys that have an entry, sorted as the sorting field says).
   * @returns {Segment[][]} */
  function bibliography() {
    return sortedKeys.map((k) => entryOf(k)).filter((e) => e !== null).map((e) => printEntry(/** @type {BibEntry} */ (e)));
  }

  // Org formats every citation before it prints the bibliography, so the year letters (1984, 1984a) are settled by then
  for (const c of citations) formatCitation(c);

  return { formatCitation, bibliography, hasFiles: tables.length > 0 };
}

/** The settings that are not in the document: `org-cite-global-bibliography`, `org-cite-basic-sorting-field` (nil: cited order)
 * and `org-cite-basic-author-year-separator`. Set by the app from its settings before an export.
 * @type {{ globalFiles: string[], sortingField: string | null, separator: string }} */
export const citeDefaults = { globalFiles: [], sortingField: 'author', separator: ', ' };

/**
 * The citation text maker for an export of `doc` (or of the headings `roots`), or null when the document cites nothing and
 * prints no bibliography.
 * @param {Doc} doc @param {any[] | undefined} roots @param {(text: string) => any[]} parseTitle @param {boolean} [withPreamble]
 */
export function citeExportFor(doc, roots, parseTitle, withPreamble = !roots) {
  const citations = collectCitations(doc, roots, parseTitle, withPreamble);
  const setting = citeExportSetting(doc);
  return {
    citations,
    ...createCiteExport({
      files: bibliographyFiles(doc, citeDefaults.globalFiles),
      bibStyle: setting.bibStyle,
      citeStyle: setting.citeStyle,
      citations,
      options: { sortingField: citeDefaults.sortingField, separator: citeDefaults.separator },
    }),
  };
}

/** Plain text of segments (Org text and emphasis markers dropped to their words), for the text-only parts of an export.
 * @param {Segment[]} segments @returns {string} */
export function segmentsText(segments) {
  return segments.map((s) => (typeof s === 'string' ? s : 'org' in s ? s.org : segmentsText(s.italic))).join('');
}

/**
 * Settles the blanks around citations as Org does: one that prints nothing goes, and the space before it is replaced by the
 * blanks that followed it; one right after a quotation mark gets a space before it.
 * @param {any[]} nodes  inline nodes
 * @param {(c: CitationNode) => boolean} printsNothing
 */
export function dropSilentCitations(nodes, printsNothing) {
  /** @type {any[]} */ const out = [];
  for (const node of nodes) {
    if (node.type === 'citation' && printsNothing(node)) {
      const previous = out[out.length - 1];
      if (previous && previous.type === 'text' && typeof previous.value === 'string') {
        out[out.length - 1] = { ...previous, value: previous.value.replace(/[ \t]+$/, '') + ' '.repeat(node.blanks) };
      }
      continue;
    }
    if (node.type === 'citation') {
      // a citation right after a quotation mark gets a space between them
      const previous = out[out.length - 1];
      if (previous && previous.type === 'text' && typeof previous.value === 'string' && previous.value.endsWith('"')) {
        out[out.length - 1] = { ...previous, value: previous.value + ' ' };
      }
    }
    out.push(node.children ? { ...node, children: dropSilentCitations(node.children, printsNothing) } : node);
  }
  return out;
}

const PRINT_BIBLIOGRAPHY_LINE = /^[ \t]*#\+PRINT_BIBLIOGRAPHY:/i;

/** Whether a line is `#+PRINT_BIBLIOGRAPHY:`. @param {string} line */
export const isPrintBibliography = (line) => PRINT_BIBLIOGRAPHY_LINE.test(line);

/**
 * A paragraph's lines cut at each `#+PRINT_BIBLIOGRAPHY:` line, for exporters that read paragraphs.
 * @param {string[]} lines
 * @returns {({ lines: string[] } | { bibliography: true })[]}
 */
export function splitBibliography(lines) {
  /** @type {({ lines: string[] } | { bibliography: true })[]} */ const pieces = [];
  /** @type {string[]} */ let current = [];
  for (const line of lines) {
    if (PRINT_BIBLIOGRAPHY_LINE.test(line)) {
      if (current.length) pieces.push({ lines: current });
      current = [];
      pieces.push({ bibliography: true });
    } else current.push(line);
  }
  if (current.length) pieces.push({ lines: current });
  return pieces;
}

/** `text` with each citation in it replaced by `replacement(citation)` (and the blanks after it kept).
 * @param {string} text @param {(c: CitationNode) => string} replacement */
export function replaceCitationsInText(text, replacement) {
  if (!text.includes('[cite')) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const hit = text[i] === '[' ? parseCitationAt(text, i) : null;
    if (hit) {
      out += replacement(hit.node) + ' '.repeat(hit.node.blanks);
      i += hit.length;
    } else out += text[i++];
  }
  return out;
}

/** The entry for `key` in the bibliography `files`, or null (also when none of the files is loaded yet).
 * @param {string[]} files @param {string} key @returns {BibEntry | null} */
export function citeEntry(files, key) {
  for (const f of files) {
    const e = entriesOf(f)?.get(key);
    if (e) return e;
  }
  return null;
}

/** A citation's source text cut into plain text and keys, so a display can make each key tappable.
 * @param {string} raw @returns {({ text: string } | { key: string })[]} */
export function splitCitationKeys(raw) {
  /** @type {({ text: string } | { key: string })[]} */ const parts = [];
  const re = new RegExp(KEY_RE.source, 'gu');
  let last = 0;
  for (const m of raw.matchAll(re)) {
    const at = m.index ?? 0;
    if (at < raw.indexOf(':')) continue; // never inside "[cite/style:"
    if (at > last) parts.push({ text: raw.slice(last, at) });
    parts.push({ key: m[1] });
    last = at + m[0].length;
  }
  if (last < raw.length) parts.push({ text: raw.slice(last) });
  return parts;
}
