// @ts-check
// org-lint (Org 9.6.15's org-lint.el): checks a buffer for syntax mistakes and lists the reports as line, trust and warning.
// Each checker below is the Lisp function of the same name, run on the parse tree of org-lint-parse.js. Reports are sorted by
// position (a stable sort over the checkers, last declared first, as Emacs does), then given their line number.
//
// What the checks need from outside the text goes through `options`: `fileExists(path)`, `idExists(id)`,
// `attachmentFile(path)`, `readFile(path)` (the text of an included file, or null), `loadedLanguages`, `citeProcessors`,
// `hasFile`, `footnoteSection`.
import { Buffer, extractMacroArguments, linkState, mapTree, nonBlank, orgTrim, parseBuffer, scanPair, elementAt } from './org-lint-parse.js';
import { commonHeaderArgs, headerArgNames, languageHeaderArgs, options as optionNames, specialProperties } from './org-lint-data.js';
import { parseOrgDuration } from './org-duration.js';

/** @typedef {import('./org-lint-parse.js').Loose} Loose */
/** @typedef {{ line: number, trust: 'nil' | 'low', message: string, checker: string, pos: number }} Report */
/**
 * @typedef {{
 *   fileExists?: (path: string) => boolean,
 *   idExists?: (id: string) => boolean,
 *   attachmentFile?: (path: string) => string,
 *   readFile?: (path: string) => string | null,
 *   loadedLanguages?: string[],
 *   citeProcessors?: string[],
 *   hasFile?: boolean,
 *   footnoteSection?: string | null,
 * }} LintOptions
 */

const ALL_ELEMENTS = new Set(['babel-call', 'center-block', 'clock', 'comment', 'comment-block', 'diary-sexp', 'drawer', 'dynamic-block', 'example-block', 'export-block', 'fixed-width', 'footnote-definition', 'headline', 'horizontal-rule', 'inlinetask', 'item', 'keyword', 'latex-environment', 'node-property', 'paragraph', 'plain-list', 'planning', 'property-drawer', 'quote-block', 'section', 'special-block', 'src-block', 'table', 'table-row', 'verse-block']);
/** @param {...string} x */
const set = (...x) => new Set(x);

/** Lisp's `%S` of a string. @param {string} s */
const lispQuote = (s) => '"' + s.replace(/[\\"]/g, '\\$&') + '"';
/** @param {string} s */
const reQuote = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EXPORT_BACKENDS = ['ASCII', 'BEAMER', 'HTML', 'LATEX', 'MAN', 'MARKDOWN', 'MD', 'ODT', 'ORG', 'TEXINFO'];

/** Whether a file name is a TRAMP remote one (`file-remote-p`). @param {string} f */
const isRemote = (f) => /^\/[-A-Za-z0-9_]+:[^/]*:/.test(f);
/** org-url-p (ffap-url-regexp): a name with a URL scheme. @param {string} f */
const isUrl = (f) => /^(?:news(?:post)?:|mailto:|file:|(?:ftp|https?|telnet|gopher|www|wais):\/\/)./i.test(f);

// ---------------------------------------------------------------- Babel header arguments

/**
 * org-babel-balanced-split with alternatives `((32 9) . 58)`, or a lone character code.
 * @param {string} str @param {number | [number[], number]} alts
 * @returns {string[]}
 */
function balancedSplit(str, alts) {
  /** @type {string[]} */ const result = [];
  /** @type {string[]} */ let partial = [];
  const splitp = (/** @type {string | undefined} */ past, /** @type {string} */ next) => {
    if (Array.isArray(alts)) return past !== undefined && alts[0].includes(past.charCodeAt(0)) && next.charCodeAt(0) === alts[1];
    return next.charCodeAt(0) === alts;
  };
  let i = 0;
  while (i < str.length) {
    const c = str[i];
    if (splitp(i > 0 ? str[i - 1] : undefined, c)) {
      if (Array.isArray(alts)) partial.pop();
      if (partial.length) {
        result.push(partial.join(''));
        partial = [];
      }
      i++;
    } else if (c === '(' || c === '[') {
      const origin = i;
      const openings = [c];
      i++;
      while (openings.length) {
        const m = /[\]()[]/.exec(str.slice(i));
        if (!m) {
          i = str.length;
          break;
        }
        i += m.index + 1;
        const ch = m[0];
        if (ch === '[' || ch === '(') openings.push(ch);
        else if (ch === ']') {
          if (openings[openings.length - 1] === '[') openings.pop();
        } else if (openings[openings.length - 1] === '(') openings.pop();
      }
      if (!openings.length) partial.push(...str.slice(origin, i));
      else {
        partial.push(c);
        i = origin + 1;
      }
    } else if (c === '"' && !(i > 0 && str[i - 1] === '\\')) {
      const origin = i;
      const m = /[^\\]"/.exec(str.slice(i + 1));
      if (m) {
        i = i + 1 + m.index + 2;
        partial.push(...str.slice(origin, i));
      } else {
        partial.push('"');
        i++;
      }
    } else {
      partial.push(c);
      i++;
    }
  }
  if (partial.length) result.push(partial.join(''));
  return result;
}

/** org-babel-read for a header value, without evaluating Lisp. @param {string} cell @returns {string | number | { lisp: string }} */
function babelRead(cell) {
  if (!nonBlank(cell)) return cell;
  const trimmed = orgTrim(cell);
  if (!/\s/.test(trimmed) && /^[0-9e.+ -]+$/.test(cell) && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return Number(trimmed);
  if ('(\'`['.includes(cell[0]) || cell === '*this*') return { lisp: cell };
  const q = /^[ \t\n\r\f\v]*"(.*)"[ \t\n\r\f\v]*$/s.exec(cell);
  if (q && !/[^\\]"/.test(q[1])) return q[1].replace(/\\(.)/g, '$1');
  return cell;
}

/** org-babel-parse-header-arguments: [name, value] pairs, `:var` split per variable. @param {string | null} string @returns {[string, any][]} */
export function parseHeaderArguments(string) {
  if (!nonBlank(string)) return [];
  const raw = balancedSplit(/** @type {string} */ (string), [[32, 9], 58]);
  const args = [raw[0], ...raw.slice(1).map((r) => ':' + r)];
  /** @type {[string, any][]} */
  const pairs = args.map((arg) => {
    const m = /([^ \f\t\n\r\v]+)[ \f\t\n\r\v]+([^ \f\t\n\r\v]+.*)/s.exec(arg);
    if (m) return [m[1], babelRead(m[2].replace(/[ \f\t\n\r\v]+$/, ''))];
    return [arg.replace(/[ \f\t\n\r\v]+$/, ''), null];
  });
  /** @type {[string, any][]} */
  const out = [];
  for (const pair of pairs) {
    if (pair[0] === ':var') {
      const parts = balancedSplit(String(pair[1]), 32);
      /** @type {string[]} */ const joined = [];
      for (const el of parts) {
        const head = joined[joined.length - 1];
        if (head !== undefined && (head.endsWith('=') || el.startsWith('='))) joined[joined.length - 1] = head + el;
        else joined.push(el);
      }
      for (const v of joined) out.push([':var', orgTrim(v)]);
    } else out.push(pair);
  }
  return out;
}

// ---------------------------------------------------------------- the checkers

/**
 * @typedef {{ b: Buffer, tree: any, opts: Required<Pick<LintOptions, 'loadedLanguages' | 'citeProcessors'>> & LintOptions, text: string, todo: string[], keywordsInOrder: () => any[] }} Ctx
 * @typedef {[number, string]} Found
 */

/**
 * org-lint--collect-duplicates. `reports` is built the way Emacs conses it: the last pushed first.
 * @param {import('./org-lint-parse.js').Node} tree @param {Set<string>} types @param {(d: any) => any} key @param {(d: any, k: any) => number} position @param {(k: any) => string} message
 * @returns {Found[]}
 */
function collectDuplicates(tree, types, key, position, message) {
  /** @type {{ key: any, id: string, pos: number }[]} */ const keys = [];
  /** @type {{ key: any, id: string, pos: number }[]} */ const originals = [];
  /** @type {Found[]} */ let reports = [];
  const report = (/** @type {number} */ pos, /** @type {Loose} */ value) => {
    reports = [[pos, message(value)], ...reports];
  };
  mapTree(tree, types, (d) => {
    const k = key(d);
    if (k == null) return null;
    const id = JSON.stringify(k);
    const seen = keys.find((e) => e.id === id);
    if (seen) {
      if (!originals.includes(seen)) originals.unshift(seen);
      report(position(d, k), k);
    } else keys.push({ key: k, id, pos: position(d, k) });
    return null;
  }, { objects: types.has('target') });
  for (const e of originals) report(e.pos, e.key);
  return reports;
}

/** The first line at or after an element's begin matching `re` (a failed search is an error in Emacs). @param {Ctx} c @param {Loose} el @param {RegExp} re */
function searchFrom(c, el, re) {
  for (let i = c.b.lineOf(el.begin); i < c.b.n; i++) if (re.test(c.b.lines[i])) return c.b.pos(i);
  throw new Error('Search failed: ' + re.source);
}

/** @type {Record<string, (c: Ctx) => Found[]>} */
const CHECK = {
  'duplicate-custom-id': (c) => collectDuplicates(c.tree, set('node-property'), (p) => (p.key.toUpperCase() === 'CUSTOM_ID' ? p.value : null), (p) => p.begin, (k) => `Duplicate CUSTOM_ID property "${k}"`),

  'duplicate-name': (c) => collectDuplicates(c.tree, ALL_ELEMENTS, (d) => d.name ?? null, (d, name) => searchFrom(c, d, new RegExp(`^[ \\t]*#\\+[A-Za-z]+:[ \\t]*${reQuote(name)}[ \\t]*$`, 'i')), (k) => `Duplicate NAME "${k}"`),

  'duplicate-target': (c) => collectDuplicates(c.tree, set('target'), (t) => t.value.split(/[ \f\t\n\r\v]+/).filter(Boolean), (t) => t.begin, (k) => `Duplicate target <<${k.join(' ')}>>`),

  'duplicate-footnote-definition': (c) => collectDuplicates(c.tree, set('footnote-definition'), (d) => d.label, (d) => d.post, (k) => `Duplicate footnote definition "${k}"`),

  'orphaned-affiliated-keywords': (c) => {
    const keywords = ['CAPTION', 'DATA', 'HEADER', 'HEADERS', 'LABEL', 'NAME', 'PLOT', 'RESNAME', 'SOURCE', 'SRCNAME', 'TBLNAME'];
    return mapTree(c.tree, set('keyword'), (k) => (/^ATTR_[-_A-Za-z0-9]+$/i.test(k.key) || keywords.includes(k.key) ? [k.post, `Orphaned affiliated keyword: "${k.key}"`] : null));
  },

  'obsolete-affiliated-keywords': (c) => {
    /** @type {Found[]} */ let reports = [];
    const affiliatedLines = new Set();
    mapTree(c.tree, ALL_ELEMENTS, (e) => {
      for (const k of e.affiliated || []) affiliatedLines.add(k.line);
      return null;
    });
    const re = /^[ \t]*#\+(DATA|LABEL|RESNAME|SOURCE|SRCNAME|TBLNAME|RESULT|HEADERS):/i;
    for (let i = 0; i < c.b.n; i++) {
      const m = re.exec(c.b.lines[i]);
      if (!m || !affiliatedLines.has(i)) continue;
      const key = m[1].toUpperCase();
      reports = [[c.b.pos(i), `Obsolete affiliated keyword: "${key}".  Use "${key === 'HEADERS' ? 'HEADER' : key === 'RESULT' ? 'RESULTS' : 'NAME'}" instead`], ...reports];
    }
    return reports;
  },

  'deprecated-export-blocks': (c) => mapTree(c.tree, set('special-block'), (b) => (EXPORT_BACKENDS.includes(b.btype.toUpperCase()) ? [b.post, `Deprecated syntax for export block.  Use "BEGIN_EXPORT ${b.btype}" instead`] : null)),

  'deprecated-header-syntax': (c) => {
    const names = commonHeaderArgs.map((h) => h.name).filter((n) => n !== 'dir');
    const re = new RegExp(`^(${names.map(reQuote).join('|')})[ \\t]`, 'i');
    return mapTree(c.tree, set('keyword', 'node-property'), (d) => {
      if (d.type === 'keyword') {
        const m = d.key === 'PROPERTY' ? re.exec(d.value) : null;
        return m ? [d.begin, `Deprecated syntax for "${m[1]}".  Use header-args instead`] : null;
      }
      return names.some((n) => n.toLowerCase() === d.key.toLowerCase()) ? [d.begin, `Deprecated syntax for "${d.key}".  Use :header-args: instead`] : null;
    });
  },

  'missing-language-in-src-block': (c) => mapTree(c.tree, set('src-block'), (b) => (b.language ? null : [b.post, 'Missing language in source block'])),

  'missing-backend-in-export-block': (c) => mapTree(c.tree, set('export-block'), (b) => (b.btype ? null : [b.post, 'Missing back-end in export block'])),

  'invalid-babel-call-block': (c) =>
    mapTree(c.tree, set('babel-call'), (b) => {
      if (!b.call) return [b.post, 'Invalid syntax in babel call block'];
      if (b.endHeader && /^\[.*\]$/s.test(b.endHeader)) return [b.post, "Babel call's end header must not be wrapped within brackets"];
      return null;
    }),

  'colon-in-name': (c) =>
    mapTree(c.tree, ALL_ELEMENTS, (e) => {
      if (e.name == null || !e.name.includes(':')) return null;
      const pos = searchFrom(c, e, new RegExp(`^[ \\t]*#\\+\\w+: +${reQuote(e.name)} *$`, 'i'));
      return [pos, `Name "${e.name}" contains a colon; Babel cannot use it as input`];
    }),

  'wrong-header-argument': (c) => {
    /** @type {Found[]} */ let reports = [];
    /** @type {(d: any, language: string | null, headers: [string, any][]) => void} */
    const verify = (d, language, headers) => {
      const allowed = new Set(headerArgNames);
      for (const l of language ? [language] : c.opts.loadedLanguages) for (const h of /** @type {Loose} */ (languageHeaderArgs)[l] || []) allowed.add(h.name);
      for (const [h] of headers) {
        const p = d.post ?? d.begin;
        if (!h.startsWith(':')) reports = [[p, `Missing colon in header argument "${h}"`], ...reports];
        else if (!allowed.has(h.slice(1))) reports = [[p, `Unknown header argument "${h}"`], ...reports];
      }
    };
    mapTree(c.tree, set('babel-call', 'inline-babel-call', 'inline-src-block', 'keyword', 'node-property', 'src-block'), (d) => {
      switch (d.type) {
        case 'babel-call': case 'inline-babel-call':
          verify(d, null, [...parseHeaderArguments(d.insideHeader), ...parseHeaderArguments(d.endHeader)]);
          break;
        case 'inline-src-block':
          verify(d, d.language, parseHeaderArguments(d.parameters));
          break;
        case 'keyword':
          if (d.key === 'PROPERTY') {
            const m = /^header-args(?::(\S+))?\+ */i.exec(d.value) || /^header-args(?::(\S+))? */i.exec(d.value);
            if (m) verify(d, m[1] ?? null, parseHeaderArguments(d.value.slice(m[0].length)));
          }
          break;
        case 'node-property': {
          const m = /^HEADER-ARGS(?::(\S+))?\+/i.exec(d.key) || /^HEADER-ARGS(?::(\S+))?/i.exec(d.key);
          if (m) verify(d, m[1] ?? null, parseHeaderArguments(d.value));
          break;
        }
        default:
          verify(d, d.language, [d.parameters, ...(d.header || [])].flatMap((p) => parseHeaderArguments(p)));
      }
      return null;
    }, { objects: true });
    return reports;
  },

  'wrong-header-value': (c) => {
    /** @type {Found[]} */ let reports = [];
    mapTree(c.tree, set('babel-call', 'inline-babel-call', 'inline-src-block', 'src-block'), (d) => {
      const language = d.type === 'babel-call' || d.type === 'inline-babel-call' ? null : d.language;
      const lang = language && c.opts.loadedLanguages.includes(language) ? /** @type {Loose} */ (languageHeaderArgs)[language] || [] : [];
      const allowedList = [...lang, ...commonHeaderArgs];
      let headerText;
      if (d.type === 'src-block') headerText = [d.parameters, ...(d.header || [])].map((x) => x ?? '').join(' ');
      else if (d.type === 'inline-src-block') headerText = d.parameters ?? '';
      else headerText = `${d.insideHeader ?? ''} ${d.endHeader ?? ''}`;
      const where = d.post ?? d.begin;
      for (const [name, value] of parseHeaderArguments(orgTrim(headerText))) {
        const entry = allowedList.find((h) => h.name === name.slice(1));
        const allowed = entry ? entry.allowed : null;
        if (allowed === ':any' || allowed == null || !allowed.length) continue;
        if (typeof value === 'object' && value && 'lisp' in value) continue;
        /** @type {[any[], any][]} */ const groupsAlist = [];
        for (const v of typeof value === 'string' ? value.split(/[ \f\t\n\r\v]+/).filter(Boolean) : [value]) {
          let valid = false;
          for (const group of /** @type {string[][]} */ (allowed)) {
            const found = typeof v === 'string' && group.some((g) => typeof g === 'string' && g === v);
            if (!found) {
              if (group.includes(':any')) {
                valid = true;
                groupsAlist.unshift([group, v]);
              }
            } else if (groupsAlist.some((g) => g[0] === group)) {
              const prev = /** @type {[any[], any]} */ (groupsAlist.find((g) => g[0] === group));
              reports = [[where, `Forbidden combination in header "${name}": ${prev[1]}, ${v}`], ...reports];
              valid = true; // the throw leaves the catch: no "Unknown value" report follows
              break;
            } else {
              groupsAlist.unshift([group, v]);
              valid = true;
            }
          }
          if (!valid) reports = [[where, `Unknown value "${v === null ? 'nil' : v}" for header "${name}"`], ...reports];
        }
      }
      return null;
    }, { objects: true });
    return reports;
  },

  'deprecated-category-setup': (c) => {
    let flag = false;
    return mapTree(c.tree, set('keyword'), (k) => {
      if (k.key !== 'CATEGORY') return null;
      if (flag) return [k.post, 'Spurious CATEGORY keyword.  Set :CATEGORY: property instead'];
      flag = true;
      return null;
    });
  },

  'invalid-coderef-link': (c) => {
    const blocks = mapTree(c.tree, set('example-block', 'src-block'), (e) => e);
    return mapTree(c.tree, set('link'), (l) => {
      if (l.ltype !== 'coderef') return null;
      const ok = blocks.some((el) => {
        const value = orgTrim(c.b.lines.slice(el.valueFrom, el.valueTo).join('\n'));
        const fmt = el.labelFmt || '(ref:%s)';
        const re = new RegExp(`([ \\t]*(${reQuote(fmt).replace('%s', () => reQuote(l.path))})[ \\t]*)$`, 'm');
        return re.test(value);
      });
      return ok ? null : [l.begin, `Unknown coderef "${l.path}"`];
    }, { objects: true });
  },

  'invalid-custom-id-link': (c) => {
    const ids = headlineIds(c);
    return mapTree(c.tree, set('link'), (l) => (l.ltype === 'custom-id' && !ids.has(l.path) ? [l.begin, `Unknown custom ID "${l.path}"`] : null), { objects: true });
  },

  'invalid-fuzzy-link': (c) => {
    const cells = searchCells(c);
    return mapTree(c.tree, set('link'), (l) => {
      if (l.ltype !== 'fuzzy') return null;
      const cs = stringToSearchCell(l.path);
      const ok = cs.some((cell) => cells.has(JSON.stringify(cell)));
      return ok ? null : [l.begin, `Unknown fuzzy location "${l.path.startsWith('*') ? l.path.slice(1) : l.path}"`];
    }, { objects: true });
  },

  'invalid-id-link': (c) =>
    mapTree(c.tree, set('link'), (l) => (l.ltype === 'id' && !(c.opts.idExists || (() => false))(l.path) ? [l.begin, `Unknown ID "${l.path}"`] : null), { objects: true }),

  'link-to-local-file': (c) =>
    mapTree(c.tree, set('link'), (l) => {
      if (l.ltype !== 'attachment' && l.ltype !== 'file') return null;
      const file = l.ltype === 'file' ? l.path : (c.opts.attachmentFile || ((p) => p))(l.path);
      if (isRemote(file) || (c.opts.fileExists || (() => false))(file)) return null;
      return [l.begin, `Link to non-existent local file ${lispQuote(file)}`];
    }, { objects: true }),

  'non-existent-setupfile-parameter': (c) =>
    mapTree(c.tree, set('keyword'), (k) => {
      if (k.key !== 'SETUPFILE') return null;
      const file = k.value.length >= 2 && k.value.startsWith('"') && k.value.endsWith('"') ? k.value.slice(1, -1) : k.value;
      if (isUrl(file) || isRemote(file) || (c.opts.fileExists || (() => false))(file)) return null;
      return [k.begin, `Non-existent setup file ${lispQuote(file)}`];
    }),

  'wrong-include-link-parameter': (c) =>
    mapTree(c.tree, set('keyword'), (k) => {
      if (k.key !== 'INCLUDE') return null;
      const m = /^(".+?"|\S+)[ \t]*/.exec(k.value);
      const path = m ? (m[1].length >= 2 && m[1].startsWith('"') && m[1].endsWith('"') ? m[1].slice(1, -1) : m[1]) : null;
      if (path == null) return [k.post, 'Missing location argument in INCLUDE keyword'];
      if (path.startsWith('::')) throw new Error('Wrong type argument: stringp, nil'); // org-url-p of an empty file name
      const sm = /::(.*)$/.exec(path);
      const file = nonBlank(sm ? path.slice(0, sm.index) : path);
      const search = file !== path ? nonBlank(sm ? sm[1] : null) : null;
      if (file && isUrl(file)) return null;
      const exists = c.opts.fileExists || (() => false);
      if (file && !isRemote(file) && !exists(file)) return [k.post, 'Non-existent file argument in INCLUDE keyword'];
      if (!search) return null;
      const text = file ? (c.opts.readFile || (() => null))(file) : c.text;
      if (text == null) return null;
      return searchLinkFound(text, search) ? null : [k.post, `Invalid search part "${search}" in INCLUDE keyword`];
    }),

  'obsolete-include-markup': (c) => {
    const re = new RegExp(`^(?:".+"|\\S+)[ \\t]+(${EXPORT_BACKENDS.join('|')})`, 'i');
    return mapTree(c.tree, set('keyword'), (k) => {
      if (k.key !== 'INCLUDE') return null;
      const m = re.exec(k.value);
      return m ? [k.post, `Obsolete markup "${m[1]}" in INCLUDE keyword.  Use "export ${m[1]}" instead`] : null;
    });
  },

  'unknown-options-item': (c) => {
    /** @type {Found[]} */ let reports = [];
    mapTree(c.tree, set('keyword'), (k) => {
      if (k.key !== 'OPTIONS') return null;
      let start = 0;
      for (;;) {
        // string-match searches ahead of `start`
        const m = /(.+?):(\(.*?\)|\S+)?[ \t]*/g;
        m.lastIndex = start;
        const r = m.exec(k.value);
        if (!r) break;
        start = r.index + r[0].length;
        const item = r[1];
        if (!optionNames.includes(item)) reports = [[k.post, `Unknown OPTIONS item "${item}"`], ...reports];
        if (r[2] == null) reports = [[k.post, `Missing value for option item ${lispQuote(item)}`], ...reports];
      }
      return null;
    });
    return reports;
  },

  'invalid-macro-argument-and-template': (c) => {
    /** @type {Found[]} */ let reports = [];
    const push = (/** @type {Found} */ r) => {
      reports = [r, ...reports];
    };
    const placeholders = (/** @type {string} */ template) => [...new Set([...template.matchAll(/\$([1-9][0-9]*)/g)].map((m) => Number(m[1])))].sort((x, y) => x - y);
    const checkArity = (/** @type {[number, number]} */ arity, /** @type {Loose} */ macro) => {
      const name = macro.key;
      const args = macro.args || [];
      const l = args.length;
      if (l < arity[0] - 1) push([macro.begin, `Missing arguments in macro ${lispQuote(name)}`]);
      else if (l < arity[0]) push([macro.begin, `Missing argument in macro ${lispQuote(name)}`]);
      else if (l > arity[1] + 1) push([macro.begin, `Spurious arguments in macro ${lispQuote(name)}: ${args.slice(arity[1]).map(orgTrim).join(', ')}`]);
      else if (l > arity[1]) push([macro.begin, `Spurious argument in macro ${lispQuote(name)}: ${args[args.length - 1]}`]);
    };
    /** @type {{ name: string, template: string }[]} */
    const defined = [];
    mapTree(c.tree, set('keyword'), (k) => {
      if (k.key !== 'MACRO') return null;
      const m = /^\S+/.exec(k.value);
      const name = m ? m[0] : null;
      const template = name ? orgTrim(k.value.slice(m ? m[0].length : 0)) : null;
      if (!name) push([k.post, 'Missing name in MACRO keyword']);
      else if (!nonBlank(template)) push([k.post, 'Missing template in macro "%s"']);
      else {
        const args = placeholders(/** @type {string} */ (template));
        const last = args.length ? args[args.length - 1] : 0;
        if (JSON.stringify(Array.from({ length: last }, (_, i) => i + 1)) !== JSON.stringify(args)) push([k.post, `Unused placeholders in macro "${name}"`]);
      }
      return null;
    });
    for (const k of c.keywordsInOrder()) {
      const m = /^(\S+)[ \t]*/.exec(k.value);
      if (m) defined.push({ name: m[1], template: k.value.slice(m[0].length) });
    }
    const builtin = ['author', 'date', 'email', 'title', 'results'].map((name) => ({ name, template: '$1' }));
    const generic = ['keyword', 'n', 'property', 'time', ...(c.opts.hasFile ? ['input-file', 'modification-time'] : [])].map((name) => ({ name, template: '(eval)' }));
    const templates = [...builtin, ...defined, ...['author', 'email', 'title', 'date'].map((name) => ({ name, template: '' })), ...generic];
    mapTree(c.tree, set('macro'), (macro) => {
      const entry = templates.find((t) => t.name.toLowerCase() === macro.key);
      if (!entry) push([macro.begin, `Undefined macro ${lispQuote(macro.key)}`]);
      else if (macro.key === 'keyword') checkArity([1, 1], macro);
      else if (macro.key === 'modification-time') checkArity([1, 2], macro);
      else if (macro.key === 'n') checkArity([0, 2], macro);
      else if (macro.key === 'property') checkArity([1, 2], macro);
      else if (macro.key === 'time') checkArity([1, 1], macro);
      else if (/^\(eval\b/.test(entry.template.trimStart())) return null;
      else {
        const nums = placeholders(entry.template);
        const mx = nums.length ? Math.max(...nums) : 0;
        checkArity(nums.length ? [mx, mx] : [0, 0], macro);
      }
      return null;
    }, { objects: true });
    return reports;
  },

  'special-property-in-properties-drawer': (c) =>
    mapTree(c.tree, set('node-property'), (p) => (specialProperties.some((s) => s.toLowerCase() === p.key.toLowerCase()) ? [p.begin, `Special property "${p.key}" found in a properties drawer`] : null)),

  'obsolete-properties-drawer': (c) =>
    mapTree(c.tree, set('drawer'), (d) => (d.dname === 'PROPERTIES' ? [d.post, 'Incorrect contents for PROPERTIES drawer'] : null)),

  'invalid-effort-property': (c) =>
    mapTree(c.tree, set('node-property'), (p) => {
      if (p.key !== 'EFFORT') return null;
      return nonBlank(p.value) && !isDuration(p.value) ? [p.begin, `Invalid effort duration format: ${lispQuote(p.value)}`] : null;
    }),

  'undefined-footnote-reference': (c) => {
    const definitions = mapTree(c.tree, set('footnote-definition', 'footnote-reference'), (f) => (f.type === 'footnote-definition' || f.ftype === 'inline' ? f.label : null), { objects: true });
    return mapTree(c.tree, set('footnote-reference'), (f) => (f.ftype === 'standard' && !definitions.includes(f.label) ? [f.begin, `Missing definition for footnote [${f.label}]`] : null), { objects: true });
  },

  'unreferenced-footnote-definition': (c) => {
    const references = mapTree(c.tree, set('footnote-reference'), (f) => f.label ?? null, { objects: true });
    return mapTree(c.tree, set('footnote-definition'), (f) => (f.label != null && !references.includes(f.label) ? [f.post, `No reference for footnote definition [${f.label}]`] : null));
  },

  'extraneous-element-in-footnote-section': (c) =>
    mapTree(c.tree, set('headline'), (h) => {
      if (!h.footnoteSection) return null;
      const types = new Set([...ALL_ELEMENTS].filter((t) => !['comment', 'comment-block', 'footnote-definition', 'property-drawer', 'section'].includes(t)));
      const hit = [];
      for (const ch of h.children) hit.push(...mapTree(ch, types, (e) => (e.type === 'headline' && e.commented ? null : e), { firstMatch: true, noRecursion: set('footnote-definition', 'property-drawer') }));
      return hit.length ? [h.begin, 'Extraneous elements in footnote section are not exported'] : null;
    }),

  'invalid-keyword-syntax': (c) => {
    /** @type {Found[]} */ let reports = [];
    for (let i = 0; i < c.b.n; i++) {
      const m = /^[ \t]*#\+([^\s:]*)(?: |$)/i.exec(c.b.lines[i]);
      if (!m) continue;
      const name = m[1];
      if (/^begin/i.test(name) || /^end/i.test(name) || /^[ \t]*#\+(?:CAPTION|RESULTS)(?:\[.*\])?:(?: |$)/i.test(c.b.lines[i])) continue;
      reports = [[c.b.pos(i), `Possible missing colon in keyword "${name}"`], ...reports];
    }
    return reports;
  },

  'invalid-block': (c) => {
    /** @type {Found[]} */ let reports = [];
    const okTypes = set('center-block', 'comment-block', 'dynamic-block', 'example-block', 'export-block', 'quote-block', 'special-block', 'src-block', 'verse-block');
    for (let i = 0; i < c.b.n; i++) {
      const m = /^[ \t]*#\+(BEGIN|END)(?::|_[^\s]*)?[ \t]*/i.exec(c.b.lines[i]);
      if (!m) continue;
      const name = orgTrim(c.b.lines[i]);
      const matchEnd = c.b.pos(i) + m[0].length;
      if (/^end/i.test(m[1]) && matchEnd !== c.b.eol(i)) reports = [[c.b.pos(i), `Invalid block closing line "${name}"`], ...reports];
      else if (!okTypes.has(elementAt(c.tree, matchEnd).type)) reports = [[c.b.pos(i), `Possible incomplete block ${lispQuote(name)}`], ...reports];
    }
    return reports;
  },

  'misplaced-planning-info': (c) => {
    /** @type {Found[]} */ let reports = [];
    const okTypes = set('comment-block', 'example-block', 'export-block', 'planning', 'src-block', 'verse-block');
    for (let i = 0; i < c.b.n; i++) {
      const m = /^[ \t]*((?:CLOSED|DEADLINE|SCHEDULED):)/i.exec(c.b.lines[i]);
      if (!m) continue;
      if (!okTypes.has(elementAt(c.tree, c.b.pos(i) + m[0].length).type)) reports = [[c.b.pos(i), 'Misplaced planning info line'], ...reports];
    }
    return reports;
  },

  'incomplete-drawer': (c) => {
    /** @type {Found[]} */ let reports = [];
    const re = /^[ \t]*:((?:[\p{L}\p{N}_]|[-_])+):[ \t]*$/u;
    const blocks = set('comment-block', 'example-block', 'export-block', 'src-block', 'verse-block');
    let i = 0;
    while (i < c.b.n) {
      if (!re.test(c.b.lines[i])) {
        i++;
        continue;
      }
      const name = orgTrim(c.b.lines[i]);
      const el = elementAt(c.tree, c.b.eol(i));
      if (el.type === 'drawer') {
        if (el.contentsEnd != null) {
          for (let j = i + 1; j < c.b.n && c.b.pos(j) < el.contentsEnd; j++) {
            if (re.test(c.b.lines[j]) && c.b.eol(j) <= el.contentsEnd) reports = [[c.b.pos(j), `Possible misleading drawer entry ${lispQuote(orgTrim(c.b.lines[j]))}`], ...reports];
          }
        }
        i = Math.max(el.endLine, i + 1);
        continue;
      }
      if (el.type === 'property-drawer') {
        i = Math.max(el.endLine, i + 1);
        continue;
      }
      if (!blocks.has(el.type)) reports = [[c.b.pos(i), `Possible incomplete drawer ${lispQuote(name)}`], ...reports];
      i++;
    }
    return reports;
  },

  'indented-diary-sexp': (c) => {
    /** @type {Found[]} */ let reports = [];
    const okTypes = set('comment-block', 'diary-sexp', 'example-block', 'export-block', 'src-block', 'verse-block');
    for (let i = 0; i < c.b.n; i++) {
      const m = /^[ \t]+%%\(/.exec(c.b.lines[i]);
      if (m && !okTypes.has(elementAt(c.tree, c.b.pos(i) + m[0].length).type)) reports = [[c.b.pos(i), 'Possible indented diary-sexp'], ...reports];
    }
    return reports;
  },

  'quote-section': (c) => mapTree(c.tree, set('headline'), (h) => (h.raw.startsWith('QUOTE ') || h.raw.startsWith('COMMENT QUOTE ') ? [h.begin, 'Deprecated QUOTE section'] : null)),

  'file-application': (c) => mapTree(c.tree, set('link'), (l) => (l.application ? [l.begin, `Deprecated "file+${l.application}" link type`] : null), { objects: true }),

  'percent-encoding-link-escape': (c) =>
    mapTree(c.tree, set('link'), (l) => {
      if (l.format !== 'bracket') return null;
      const uri = l.path;
      const re = /%(..)?/gs;
      let m;
      let obsolete;
      for (;;) {
        m = re.exec(uri);
        if (!m) {
          obsolete = uri.includes('%');
          break;
        }
        if (m[0].length === 0) re.lastIndex++;
        if (!['25', '5B', '5D', '20'].includes(m[1])) {
          obsolete = false;
          break;
        }
      }
      return obsolete ? [l.begin, 'Link escaped with obsolete percent-encoding syntax'] : null;
    }, { objects: true }),

  'spurious-colons': (c) => mapTree(c.tree, set('headline'), (h) => (h.tags.includes('') ? [h.begin, 'Tags contain a spurious colon'] : null)),

  'non-existent-bibliography': (c) =>
    mapTree(c.tree, set('keyword'), (k) => {
      if (k.key !== 'BIBLIOGRAPHY') return null;
      const file = k.value.length >= 2 && k.value.startsWith('"') && k.value.endsWith('"') ? k.value.slice(1, -1) : k.value;
      return isRemote(file) || (c.opts.fileExists || (() => false))(file) ? null : [k.begin, `Non-existent bibliography ${lispQuote(file)}`];
    }),

  'missing-print-bibliography': (c) => {
    const cited = mapTree(c.tree, set('citation'), (x) => x, { firstMatch: true, objects: true }).length > 0;
    const printed = mapTree(c.tree, set('keyword'), (k) => k.key === 'PRINT_BIBLIOGRAPHY', { firstMatch: true }).length > 0;
    return cited && !printed ? [[c.text.length, 'Possibly missing "PRINT_BIBLIOGRAPHY" keyword']] : [];
  },

  'invalid-cite-export-declaration': (c) =>
    mapTree(c.tree, set('keyword'), (k) => {
      if (k.key !== 'CITE_EXPORT') return null;
      if (k.value === '') return [k.begin, 'Missing export processor name'];
      const decl = readProcessorDeclaration(k.value);
      if (!decl) return [k.begin, 'Invalid cite export processor declaration'];
      return c.opts.citeProcessors.includes(decl.name) ? null : [k.begin, 'Unknown cite export processor %S'];
    }),

  'incomplete-citation': (c) =>
    mapTree(c.tree, set('plain-text'), (t) => (/\[cite(?:\/[/_\-\p{L}\p{N}]+)?:[\t\n ]*/u.test(t.text) ? [parentContentsBegin(t.parent), 'Possibly incomplete citation markup'] : null), { objects: true }),
};

/** @param {Loose} p */
function parentContentsBegin(p) {
  if (p.type === 'citation-reference') throw new Error('Wrong type argument: number-or-marker-p, nil');
  if (p.type === 'headline' || p.type === 'item') {
    if (p.contentsBegin == null) throw new Error('Wrong type argument: integer-or-marker-p, nil');
    return p.contentsBegin;
  }
  return p.cbPos ?? p.begin;
}

/** org-duration-p. @param {string} s */
function isDuration(s) {
  if (/^[ \t]*[0-9]+(?::[0-9]{2}){1,2}[ \t]*$/.test(s)) return true;
  if (/^\d+(?:\.\d*)?$/.test(s)) return false;
  return parseOrgDuration(s) !== null;
}

/** org-cite-read-processor-declaration, as {name} or null for an error or an invalid shape. @param {string} s */
function readProcessorDeclaration(s) {
  let i = 0;
  const skip = () => {
    while (s[i] === ' ' || s[i] === '\t' || s[i] === '\n') i++;
  };
  skip();
  if (i >= s.length) return null;
  if ('("[\'`,#?;'.includes(s[i])) return null;
  const m = /^[^\s()[\]";'`,]+/.exec(s.slice(i));
  if (!m) return null;
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(m[0])) return null;
  i += m[0].length;
  const name = m[0];
  for (let k = 0; k < 2; k++) {
    while (s[i] === ' ' || s[i] === '\t') i++;
    if (i >= s.length) break;
    if (s[i] === '"') {
      const q = /^"(?:[^"\\]|\\[\s\S])*"/.exec(s.slice(i));
      if (!q) return null;
      i += q[0].length;
    } else {
      while (i < s.length && s[i] !== ' ' && s[i] !== '\t') i++;
    }
  }
  while (s[i] === ' ' || s[i] === '\t') i++;
  return i < s.length ? null : { name };
}

/** The ID and CUSTOM_ID values of headlines (org-export-resolve-id-link). @param {Ctx} c */
function headlineIds(c) {
  const ids = new Set();
  mapTree(c.tree, set('headline'), (h) => {
    if (h.properties.ID != null) ids.add(h.properties.ID);
    if (h.properties.CUSTOM_ID != null) ids.add(h.properties.CUSTOM_ID);
    return null;
  });
  return ids;
}

/** The search cells of every target, named element and headline (org-export-search-cells). @param {Ctx} c */
function searchCells(c) {
  const cells = new Set();
  const split = (/** @type {string} */ s) => s.split(/[ \f\t\n\r\v]+/).filter(Boolean);
  mapTree(c.tree, new Set([...ALL_ELEMENTS, 'target']), (d) => {
    if (d.type === 'headline') {
      const title = split(d.raw.replace(/\[[0-9]*(?:%|\/[0-9]*)\]/g, ' '));
      cells.add(JSON.stringify(['headline', title]));
      cells.add(JSON.stringify(['other', title]));
    } else if (d.type === 'target') cells.add(JSON.stringify(['target', split(d.value)]));
    else {
      const name = d.name ?? (d.results ? d.results[0] : null);
      if (name != null && name !== '') cells.add(JSON.stringify(['other', split(name)]));
      else if (name === '') cells.add(JSON.stringify(['other', []]));
    }
    return null;
  }, { objects: true });
  return cells;
}

/** org-export-string-to-search-cell. @param {string} s */
function stringToSearchCell(s) {
  const split = (/** @type {string} */ x) => x.split(/[ \f\t\n\r\v]+/).filter(Boolean);
  if (s[0] === '*') return [['headline', split(s.slice(1))]];
  if (s[0] === '#') return [['custom-id', s.slice(1)]];
  return [['target', split(s)], ['other', split(s)]];
}

/**
 * Whether `org-link-search` (exact headlines only) finds `search` in a file's text: `*headline`, `#custom-id`, `(ref)`,
 * `/regexp/` or a target, a name or a headline.
 * @param {string} text @param {string} search
 */
function searchLinkFound(text, search) {
  const b = new Buffer(text);
  const tree = parseBuffer(b, { todo: ['TODO', 'DONE'], footnoteSection: null });
  const ctx = /** @type {Ctx} */ ({ b, tree, opts: { loadedLanguages: [], citeProcessors: [] }, text, todo: [], keywordsInOrder: () => [] });
  const normalized = search.replace(/\n[ \t]*/g, ' ');
  const words = (/** @type {string} */ x) => x.split(/[ \f\t\n\r\v]+/).filter(Boolean);
  if (search[0] === '#') return headlineIds(ctx).has(normalized.slice(1));
  const coderef = /^\((.*)\)$/.exec(normalized);
  if (coderef) {
    return mapTree(tree, set('example-block', 'src-block'), (el) => {
      const fmt = el.labelFmt || '(ref:%s)';
      const re = new RegExp(`[ \\t]*(${reQuote(fmt).replace('%s', () => reQuote(coderef[1]))})[ \\t]*$`, 'i');
      return b.lines.slice(el.valueFrom, el.valueTo).some((l) => re.test(l)) ? el : null;
    }, { firstMatch: true }).length > 0;
  }
  if (/^\/(.*)\/$/.test(normalized)) return false; // org-occur leaves no match type, so Org takes the search as failed
  const starred = normalized[0] === '*';
  const w = JSON.stringify(words(starred ? search.slice(1) : search));
  const headline = mapTree(tree, set('headline'), (h) => (JSON.stringify(words(h.raw.replace(/\[[0-9]*(?:%|\/[0-9]*)\]/g, ' '))) === w ? h : null), { firstMatch: true }).length > 0;
  if (starred) return headline;
  const target = mapTree(tree, set('target'), (t) => (JSON.stringify(words(t.value)) === w ? t : null), { firstMatch: true, objects: true }).length > 0;
  if (target) return true;
  const named = mapTree(tree, ALL_ELEMENTS, (el) => ((el.affiliated || []).some((/** @type {Loose} */ k) => k.raw === 'NAME' && JSON.stringify(words(el.name)) === w) ? el : null), { firstMatch: true }).length > 0;
  return named || headline;
}

// ---------------------------------------------------------------- running

/** @typedef {{ name: string, summary: string, trust: 'nil' | 'low', categories: string[] }} CheckerInfo */

/** The checkers in declaration order. @type {CheckerInfo[]} */
export const CHECKERS = [
  ['duplicate-custom-id', 'Report duplicates CUSTOM_ID properties', 'nil', ['link']],
  ['duplicate-name', 'Report duplicate NAME values', 'nil', ['babel', 'link']],
  ['duplicate-target', 'Report duplicate targets', 'nil', ['link']],
  ['duplicate-footnote-definition', 'Report duplicate footnote definitions', 'nil', ['footnote']],
  ['orphaned-affiliated-keywords', 'Report orphaned affiliated keywords', 'low', []],
  ['obsolete-affiliated-keywords', 'Report obsolete affiliated keywords', 'nil', ['obsolete']],
  ['deprecated-export-blocks', 'Report deprecated export block syntax', 'low', ['obsolete', 'export']],
  ['deprecated-header-syntax', 'Report deprecated Babel header syntax', 'low', ['obsolete', 'babel']],
  ['missing-language-in-src-block', 'Report missing language in source blocks', 'nil', ['babel']],
  ['missing-backend-in-export-block', 'Report missing back-end in export blocks', 'nil', ['export']],
  ['invalid-babel-call-block', 'Report invalid Babel call blocks', 'nil', ['babel']],
  ['colon-in-name', 'Report NAME values with a colon', 'nil', ['babel']],
  ['wrong-header-argument', 'Report wrong Babel headers', 'nil', ['babel']],
  ['wrong-header-value', 'Report invalid value in Babel headers', 'low', ['babel']],
  ['deprecated-category-setup', 'Report misuse of CATEGORY keyword', 'nil', ['obsolete']],
  ['invalid-coderef-link', 'Report "coderef" links with unknown destination', 'nil', ['link']],
  ['invalid-custom-id-link', 'Report "custom-id" links with unknown destination', 'nil', ['link']],
  ['invalid-fuzzy-link', 'Report "fuzzy" links with unknown destination', 'nil', ['link']],
  ['invalid-id-link', 'Report "id" links with unknown destination', 'nil', ['link']],
  ['link-to-local-file', 'Report links to non-existent local files', 'low', ['link']],
  ['non-existent-setupfile-parameter', 'Report SETUPFILE keywords with non-existent file parameter', 'low', []],
  ['wrong-include-link-parameter', 'Report INCLUDE keywords with misleading link parameter', 'low', ['export']],
  ['obsolete-include-markup', 'Report obsolete markup in INCLUDE keyword', 'low', ['obsolete', 'export']],
  ['unknown-options-item', 'Report unknown items in OPTIONS keyword', 'low', ['export']],
  ['invalid-macro-argument-and-template', 'Report spurious macro arguments or invalid macro templates', 'low', ['export']],
  ['special-property-in-properties-drawer', 'Report special properties in properties drawers', 'nil', ['properties']],
  ['obsolete-properties-drawer', 'Report obsolete syntax for properties drawers', 'nil', ['obsolete', 'properties']],
  ['invalid-effort-property', 'Report invalid duration in EFFORT property', 'nil', ['properties']],
  ['undefined-footnote-reference', 'Report missing definition for footnote references', 'nil', ['footnote']],
  ['unreferenced-footnote-definition', 'Report missing reference for footnote definitions', 'nil', ['footnote']],
  ['extraneous-element-in-footnote-section', 'Report non-footnote definitions in footnote section', 'nil', ['footnote']],
  ['invalid-keyword-syntax', 'Report probable invalid keywords', 'low', []],
  ['invalid-block', 'Report invalid blocks', 'low', []],
  ['misplaced-planning-info', 'Report misplaced planning info line', 'low', []],
  ['incomplete-drawer', 'Report probable incomplete drawers', 'low', []],
  ['indented-diary-sexp', 'Report probable indented diary-sexps', 'low', []],
  ['quote-section', 'Report obsolete QUOTE section', 'low', ['obsolete']],
  ['file-application', 'Report obsolete "file+application" link', 'nil', ['link', 'obsolete']],
  ['percent-encoding-link-escape', 'Report obsolete escape syntax in links', 'low', ['link', 'obsolete']],
  ['spurious-colons', 'Report spurious colons in tags', 'nil', ['tags']],
  ['non-existent-bibliography', 'Report invalid bibliography file', 'nil', ['cite']],
  ['missing-print-bibliography', 'Report missing "print_bibliography" keyword', 'nil', ['cite']],
  ['invalid-cite-export-declaration', 'Report invalid value for "cite_export" keyword', 'nil', ['cite']],
  ['incomplete-citation', 'Report incomplete citation object', 'low', ['cite']],
].map(([name, summary, trust, categories]) => ({ name: /** @type {string} */ (name), summary: /** @type {string} */ (summary), trust: /** @type {'nil' | 'low'} */ (trust), categories: /** @type {string[]} */ (categories) }));

/** TODO keywords of a text: the default `TODO | DONE` unless `#+TODO:` lines say otherwise. @param {string} text */
function todoKeywords(text) {
  const found = [...text.matchAll(/^[ \t]*#\+(?:SEQ_TODO|TYP_TODO|TODO):[ \t]*(.*?)[ \t]*$/gim)];
  if (!found.length) return ['TODO', 'DONE'];
  const words = found.flatMap((m) => m[1].split(/[ \t]+/).filter((w) => w && w !== '|').map((w) => w.replace(/\(.*$/, '')));
  return [...new Set(words)];
}

/** `#+LINK:` abbreviations. @param {string} text */
function linkAbbrevs(text) {
  /** @type {Map<string, string>} */ const map = new Map();
  for (const m of text.matchAll(/^[ \t]*#\+LINK:[ \t]*(\S+)[ \t]+(\S.*?)[ \t]*$/gim)) if (!map.has(m[1])) map.set(m[1], m[2]);
  return map;
}

/**
 * org-lint: the reports of the named checkers (all of them when `names` is null), sorted by position, with line numbers.
 * @param {string} text the buffer
 * @param {string[] | null} [names] checker names to run
 * @param {LintOptions} [options]
 * @returns {Report[]}
 */
export function orgLint(text, names = null, options = {}) {
  const b = new Buffer(text);
  const todo = todoKeywords(text);
  linkState.abbrevs = linkAbbrevs(text);
  const tree = parseBuffer(b, { todo, footnoteSection: options.footnoteSection === undefined ? 'Footnotes' : options.footnoteSection });
  /** @type {Ctx} */
  const ctx = /** @type {Ctx} */ ({
    b,
    tree,
    text,
    todo,
    opts: { loadedLanguages: ['emacs-lisp'], citeProcessors: ['basic', 'bibtex', 'biblatex', 'csl', 'natbib'], ...options },
    keywordsInOrder: () => mapTree(tree, set('keyword'), (k) => (k.key === 'MACRO' ? k : null)),
  });
  const wanted = CHECKERS.filter((c) => !names || names.includes(c.name));
  /** @type {{ pos: number, trust: 'nil' | 'low', message: string, checker: string }[]} */
  const all = [];
  // org-lint--checkers lists the last declared first
  for (const c of [...wanted].reverse()) for (const [pos, message] of CHECK[c.name](ctx)) all.push({ pos, trust: c.trust, message, checker: c.name });
  all.sort((x, y) => x.pos - y.pos);
  return all.map((r) => ({ ...r, line: b.lineOf(r.pos) + 1 }));
}

/**
 * The text of the *Org Lint* buffer: the tabulated list with its Line, Trust and Warning columns.
 * @param {Report[]} reports
 */
export function formatReports(reports) {
  const head = `${'Line'.padStart(6)} Trust Warning\n${'----'.padStart(6)} ----- -------\n`;
  return head + reports.map((r) => `${String(r.line).padStart(6)} ${r.trust.padEnd(5)} ${r.message}`).join('\n') + (reports.length ? '\n' : '');
}

export { scanPair, extractMacroArguments };
