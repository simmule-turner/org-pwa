// @ts-check
/**
 * The export variables of Org (`org-export-with-*`, `org-export-headline-levels`, `org-export-preserve-breaks`, `org-export-time-stamp-file`,
 * `org-export-global-macros`, `org-export-snippet-translation-alist`) as the settings of one export. They stand where Org puts them: below
 * the file. A `#+OPTIONS:` line, a `#+MACRO:` line of the file wins, as in `org-export-options-alist` and `org-macro-initialize-templates`.
 *
 * The options go into the document as one virtual `#+OPTIONS:` line before its own, so every export back end, which already reads
 * `#+OPTIONS:`, sees them without a second path. The global macros become `#+MACRO:` keywords marked `global` (see macroDefinitions). A
 * snippet shortcut of the alist (`@@h:...@@` for HTML) is written out in the text, as `org-export-snippet-backend` reads it.
 */

import { Reader } from './elisp-read.js';
import { print, toArray } from './elisp-data.js';
import { run } from './elisp.js';
import { MACRO_FREE_BLOCK_RE, PROTECTED_RE } from './export-macros.js';
import { parseBody } from './body-parser.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */

/**
 * Each variable and the #+OPTIONS: key that sets it for one file (`org-export-options-alist`). `org-export-with-broken-links` is read by its own
 * path (getExportWithBrokenLinks) and not repeated here.
 */
export const EXPORT_OPTION_VARIABLES = /** @type {const} */ ([
  ['org-export-headline-levels', 'H'],
  ['org-export-preserve-breaks', '\\n'],
  ['org-export-with-section-numbers', 'num'],
  ['org-export-time-stamp-file', 'timestamp'],
  ['org-export-with-archived-trees', 'arch'],
  ['org-export-with-author', 'author'],
  ['org-export-with-clocks', 'c'],
  ['org-export-with-creator', 'creator'],
  ['org-export-with-date', 'date'],
  ['org-export-with-drawers', 'd'],
  ['org-export-with-email', 'email'],
  ['org-export-with-emphasize', '*'],
  ['org-export-with-entities', 'e'],
  ['org-export-with-fixed-width', ':'],
  ['org-export-with-footnotes', 'f'],
  ['org-export-with-inlinetasks', 'inline'],
  ['org-export-with-latex', 'tex'],
  ['org-export-with-planning', 'p'],
  ['org-export-with-priority', 'pri'],
  ['org-export-with-properties', 'prop'],
  ['org-export-with-smart-quotes', "'"],
  ['org-export-with-special-strings', '-'],
  ['org-export-with-statistics-cookies', 'stat'],
  ['org-export-with-sub-superscripts', '^'],
  ['org-export-with-toc', 'toc'],
  ['org-export-with-tables', '|'],
  ['org-export-with-tags', 'tags'],
  ['org-export-with-tasks', 'tasks'],
  ['org-export-with-timestamps', '<'],
  ['org-export-with-title', 'title'],
  ['org-export-with-todo-keywords', 'todo'],
]);

/** One Lisp object read from a variable's text (`'headline` is `headline`), printed as #+OPTIONS: writes it; null when the text is not one object. @param {unknown} raw @returns {string | null} */
function optionValue(raw) {
  const text = typeof raw === 'string' ? raw.trim().replace(/^'/, '') : '';
  if (!text) return null;
  try {
    const reader = new Reader(text);
    const value = reader.read();
    return reader.more() ? null : print(value, true);
  } catch {
    return null;
  }
}

/** The `#+OPTIONS:` text the set export variables make, or '' when none is set. The HTML back end has its own variable for `tex:` (`org-html-with-latex`)
 * and does not read `org-export-with-latex`, as in ox-html.el.
 * @param {Record<string, any> | null | undefined} vars @param {'html' | 'other'} [backend] @returns {string} */
export function optionsFromVariables(vars, backend = 'other') {
  const parts = [];
  for (const [rawName, key] of EXPORT_OPTION_VARIABLES) {
    const name = backend === 'html' && key === 'tex' ? 'org-html-with-latex' : rawName;
    const value = optionValue((vars || {})[name]);
    if (value !== null) parts.push(`${key}:${value}`);
  }
  return parts.join(' ');
}

/** An alist of strings (`'(("a" . "b"))`) as pairs; null when the variable is not set or is not such a list. @param {unknown} raw @returns {[string, string][] | null} */
function stringPairs(raw) {
  const text = typeof raw === 'string' ? raw.trim().replace(/^'/, '') : '';
  if (!text) return null;
  const result = run(`(mapcar (lambda (e) (list (car e) (cdr e))) (quote ${text}))`);
  if (!result.ok || result.value === null || typeof result.value !== 'object') return null;
  const pairs = toArray(result.value).map((entry) => toArray(entry));
  return pairs.every((p) => typeof p[0] === 'string' && typeof p[1] === 'string') ? pairs.map((p) => /** @type {[string, string]} */ ([p[0], p[1]])) : null;
}

/** `org-export-snippet-translation-alist` as a map from the name written in a snippet to the back end it stands for. @param {Record<string, any> | null | undefined} vars @returns {Map<string, string>} */
export function snippetTranslations(vars) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const [from, to] of stringPairs((vars || {})['org-export-snippet-translation-alist']) || []) if (!map.has(from)) map.set(from, to); // assoc finds the first
  return map;
}

/** @param {string} text @param {Map<string, string>} map */
function translateSnippets(text, map) {
  return text.replace(/@@([-A-Za-z0-9]+):/g, (whole, name) => (map.has(name) ? `@@${map.get(name)}:` : whole));
}

/** The lines with the snippet names written out, apart from code spans, `: ` and `#` lines and blocks of code, examples, exports and comments. @param {string[]} lines @param {Map<string, string>} map */
function translateLines(lines, map) {
  let inBlock = false;
  return lines.map((line) => {
    const fence = MACRO_FREE_BLOCK_RE.exec(line);
    if (fence) {
      inBlock = fence[1].toLowerCase() === 'begin';
      return line;
    }
    if (inBlock || !line.includes('@@') || /^\s*:(\s|$)/.test(line) || /^\s*#(\s|$)/.test(line)) return line;
    let out = '';
    let last = 0;
    for (const m of line.matchAll(PROTECTED_RE)) {
      const code = m[2] !== undefined;
      const start = (m.index || 0) + (code ? m[1].length : 0);
      out += translateSnippets(line.slice(last, start), map) + line.slice(start, (m.index || 0) + m[0].length);
      last = (m.index || 0) + m[0].length;
    }
    return out + translateSnippets(line.slice(last), map);
  });
}

/** @param {Heading} heading @param {Map<string, string>} map @returns {Heading} */
function translateHeading(heading, map) {
  const bodyLines = translateLines(heading.bodyLines || [], map);
  return { ...heading, title: translateSnippets(heading.title, map), bodyLines, body: parseBody(bodyLines), children: (heading.children || []).map((h) => translateHeading(h, map)) };
}

/**
 * The document with the settings of the export variables in it: a virtual `#+OPTIONS:` line first, the global macros as `#+MACRO:`
 * keywords that any `#+MACRO:` of the file overrides, and the snippet shortcuts written out. The document itself when none is set.
 * @param {Doc} doc @param {Heading | null} scope  the heading being exported, or null for the whole document
 * @param {Record<string, any> | null | undefined} vars  the variables in force (the Global Variables and the file's own)
 * @param {{ snippets?: boolean, backend?: 'html' | 'other' }} [options]  `snippets: false` for the Org back end, which writes a snippet as it is; `backend: 'html'` for HTML and slides
 * @returns {{ doc: Doc, scope: Heading | null }}  the heading is the one in the returned document
 */
export function withExportVariables(doc, scope, vars, options = {}) {
  const line = optionsFromVariables(vars, options.backend);
  const macros = stringPairs((vars || {})['org-export-global-macros']) || [];
  const map = options.snippets === false ? new Map() : snippetTranslations(vars);
  if (!line && !macros.length && !map.size) return { doc, scope };
  /** @type {import('./types.js').Keyword[]} */
  const added = [];
  if (line) added.push({ key: 'OPTIONS', value: line, bodyLineIndex: 0, virtual: true });
  for (const [name, template] of macros) added.push({ key: 'MACRO', value: `${name} ${template}`, bodyLineIndex: 0, virtual: true, global: true });
  const out = { ...doc, keywords: [...added, ...(doc.keywords || [])] };
  if (!map.size) return { doc: out, scope };
  const bodyLines = translateLines(doc.bodyLines || [], map);
  const translated = { ...out, bodyLines, body: parseBody(bodyLines), children: (doc.children || []).map((h) => translateHeading(h, map)) };
  /** @param {Heading[]} from @param {Heading[]} to @returns {Heading | null} the heading in `to` at the place `scope` has in `from` */
  const counterpart = (from, to) => {
    for (let i = 0; i < from.length; i++) {
      if (from[i] === scope) return to[i];
      const inner = counterpart(from[i].children || [], to[i].children || []);
      if (inner) return inner;
    }
    return null;
  };
  return { doc: translated, scope: scope ? counterpart(doc.children || [], translated.children || []) || scope : null };
}
