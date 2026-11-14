// @ts-check
/**
 * What a `:var` can name, as Org's `org-babel-ref-resolve` finds it: the first `#+NAME:` (or `#+RESULTS: name`) in the document, whether
 * it stands before a table, a list, a results block or a source block. A source block is run, with the arguments of a call such as
 * `name(n=4)` or `name(5)` given to its `:var` variables. Only Emacs Lisp blocks can be run from a reference.
 */
import { HLINE, cellValue as cell, numberOf, parseResultsSpec, pickedNames, resolveVars } from './babel.js';
import { preambleLines, removeIndentation } from './babel-blocks.js';
import { findHeadingByCustomId, headingText } from './noweb.js';
import { isCommentedHeading } from './comment-model.js';
import { runElisp } from './babel-elisp.js';
import { Cons, Flt, NIL, Sym, T, print, toArray } from './elisp-data.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {ReturnType<typeof import('./babel-blocks.js').collectDocumentBlocks>[number]} Block */

const MAX_DEPTH = 20;
const KEYWORD_LINE = /^\s*#\+(CAPTION|ATTR_\w+|HEADERS?)(\[[^\]]*\])?:/i;

/** The Lisp object as a value a `:var` holds: numbers, text, arrays, null for nil; a float stays a Flt, so a Lisp block reads it back exactly. @param {import('./elisp-data.js').LObj} x @returns {unknown} */
export function lispToValue(x) {
  if (x === NIL) return null;
  if (x === T) return true;
  if (typeof x === 'number' || typeof x === 'string' || x instanceof Flt) return x;
  if (x instanceof Sym) return x; // a symbol stays one, so a Lisp block reads it back as a symbol
  if (x instanceof Cons) {
    /** @type {import("./elisp-data.js").LObj} */ let tail = x;
    while (tail instanceof Cons) tail = tail.cdr;
    return tail === NIL ? toArray(x).map(lispToValue) : print(x, false);
  }
  return print(x, false);
}

/** A script's view of a variable: floats made plain numbers. @param {unknown} v @returns {unknown} */
export function plainValue(v) {
  if (v instanceof Flt) return v.v;
  if (v instanceof Sym) return v.name;
  return Array.isArray(v) ? v.map(plainValue) : v;
}

/** The comma-separated arguments of a call, commas inside quotes and parentheses kept. @param {string} text */
function splitArguments(text) {
  /** @type {string[]} */ const out = [];
  let depth = 0;
  let quote = false;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      current += c;
      if (c === '\\') current += text[++i] ?? '';
      else if (c === '"') quote = false;
    } else if (c === '"') {
      quote = true;
      current += c;
    } else if (c === '(' || c === '[') {
      depth++;
      current += c;
    } else if (c === ')' || c === ']') {
      depth--;
      current += c;
    } else if (c === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else current += c;
  }
  if (current.trim() !== '') out.push(current.trim());
  return out;
}

/** The variables for a script: floats made plain numbers. @param {Record<string, unknown>} vars */
export function plainVariables(vars) {
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, plainValue(v)]));
}

/**
 * The lookup for `resolveVars`: `(name, callText)` gives the rows of a table, `{ value }` for anything else, or null.
 * @param {Doc} doc @param {Block[]} blocks `collectDocumentBlocks(doc)` @param {number} [depth]
 */
export function referenceLookup(doc, blocks, depth = 0) {
  /** @type {{ name: string, kind: 'table' | 'list' | 'fixed' | 'example' | 'export' | 'quote' | 'paragraph' | 'block', lines: string[], at: number, block?: Block }[]} */
  const entries = [];
  /** @param {Heading | null} heading @param {string[]} lines */
  const scan = (heading, lines) => {
    lines.forEach((line, i) => {
      const named = /^\s*#\+NAME:\s*(\S.*?)\s*$/i.exec(line);
      const resulted = named ? null : /^\s*#\+RESULTS(?:\[[^\]]*\])?:\s*(\S.*?)\s*$/i.exec(line);
      const name = named?.[1] ?? resulted?.[1];
      if (!name) return;
      let j = i + 1;
      while (j < lines.length && (KEYWORD_LINE.test(lines[j]) || (named && /^\s*#\+RESULTS/i.test(lines[j])))) j++;
      const next = lines[j] ?? '';
      const special = /^\s*#\+begin_(\w+)/i.exec(next)?.[1].toLowerCase();
      if (named && special === 'src') {
        const block = blocks.find((b) => b.heading === heading && b.beginIndex === j && !b.commented);
        if (block) entries.push({ name, kind: 'block', lines, at: j, block });
      } else if (/^\s*\|/.test(next)) entries.push({ name, kind: 'table', lines, at: j });
      else if (/^\s*(?:[-+*]|\d+[.)])\s/.test(next)) entries.push({ name, kind: 'list', lines, at: j });
      else if (/^\s*:(?:\s|$)/.test(next)) entries.push({ name, kind: 'fixed', lines, at: j });
      else if (named && special === 'example') entries.push({ name, kind: 'example', lines, at: j });
      else if (named && special === 'export') entries.push({ name, kind: 'export', lines, at: j });
      else if (named && special && special !== 'comment') entries.push({ name, kind: 'quote', lines, at: j });
      else if (named && !special && next.trim() !== '' && !/^\s*#\+/.test(next)) entries.push({ name, kind: 'paragraph', lines, at: j });
    });
  };
  /** @param {Heading} heading @param {boolean} commented */
  const walk = (heading, commented) => {
    const hidden = commented || isCommentedHeading(heading); // a commented heading hides what it holds (org-in-commented-heading-p)
    if (!hidden) scan(heading, heading.bodyLines || []);
    for (const child of heading.children || []) walk(child, hidden);
  };
  scan(null, preambleLines(doc));
  for (const h of doc.children || []) walk(h, false);

  /** The block text between the begin and end lines at `at`, indentation removed, one line per line. @param {string[]} lines @param {number} at @param {string} end */
  const inside = (lines, at, end) => {
    const body = [];
    for (let j = at + 1; j < lines.length && !new RegExp('^\\s*#\\+end_' + end + '\\s*$', 'i').test(lines[j]); j++) body.push(lines[j]);
    return body.length ? removeIndentation(body).join('\n') + '\n' : '';
  };

  return (/** @type {string} */ name, /** @type {string | undefined} */ callText, /** @type {boolean} */ contents = false) => {
    if (/^'?\(/.test(name)) {
      // a Lisp form is evaluated (org-babel-read)
      const run = runElisp({ code: name, spec: parseResultsSpec('') });
      if (!run.ok) throw new Error(run.message);
      return { value: lispToValue(run.value) };
    }
    const entry = entries.find((e) => e.name === name);
    if (!entry) {
      const heading = findHeadingByCustomId([], doc, name); // a heading named by its CUSTOM_ID is its text
      if (heading) return { value: headingText(heading) };
      return null;
    }
    const { lines, at } = entry;
    if (entry.kind === 'table') {
      const rows = [];
      for (let j = at; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
        rows.push(/^\s*\|-/.test(lines[j]) ? HLINE : lines[j].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell));
      }
      return rows;
    }
    if (entry.kind === 'list') {
      const bullet = /^(\s*)(?:[-+*]|\d+[.)])\s/;
      const base = (bullet.exec(lines[at]) || ['', ''])[1].length; // only the top-level items count (org-list-to-lisp)
      const items = [];
      for (let j = at; j < lines.length && lines[j].trim() !== '' && ((bullet.exec(lines[j]) || ['', ''])[1].length > base || (/^\s*/.exec(lines[j]) || [''])[0].length > base || bullet.test(lines[j])); j++) {
        if (bullet.test(lines[j]) && (bullet.exec(lines[j]) || ['', ''])[1].length === base) items.push(cell(lines[j].replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ X-]\]\s+)?/, '')));
      }
      return { value: items };
    }
    if (entry.kind === 'fixed') {
      const texts = [];
      for (let j = at; j < lines.length && /^\s*:(?:\s|$)/.test(lines[j]); j++) texts.push(lines[j].replace(/^\s*:\s?/, ''));
      const text = texts.join('\n').trim();
      return { value: numberOf(text) ?? text };
    }
    if (entry.kind === 'paragraph') {
      const text = [];
      for (let j = at; j < lines.length && lines[j].trim() !== ''; j++) text.push(lines[j]);
      return { value: text.join('\n') + '\n' };
    }
    if (entry.kind === 'example') return { value: inside(lines, at, 'example') };
    if (entry.kind === 'export') return { value: inside(lines, at, 'export') };
    if (entry.kind === 'quote') return { value: inside(lines, at, /^\s*#\+begin_(\w+)/i.exec(lines[at])?.[1] ?? '') };
    const block = entry.block;
    if (contents) return { value: (block.emacsBody ?? block.body) + '\n' }; // `name[]` is the text of a source block
    if (block.lang !== 'emacs-lisp' && block.lang !== 'elisp') throw new Error(`:var ${name}: only an Emacs Lisp block can be run from a reference`);
    if (depth >= MAX_DEPTH) throw new Error('References nest more than ' + MAX_DEPTH + ' levels deep');
    /** @type {string[]} */ const specs = (block.args.var || []).map(String);
    const declared = specs.map((s) => /^\s*([A-Za-z_$][\w$]*)=/.exec(s)?.[1] ?? '');
    const given = splitArguments(callText ?? '');
    /** @type {string[]} */ const calls = [];
    given.forEach((a, i) => {
      if (/^[A-Za-z_$][\w$]*=/.test(a)) calls.push(a);
      else if (declared[i]) calls.push(`${declared[i]}=${a}`);
      else throw new Error(`Variable "${a}" must be assigned a default value`);
    });
    const overridden = new Set(calls.map((c) => c.slice(0, c.indexOf('='))));
    /** @type {import('./babel.js').TableNames} */ const names = {};
    const vars = resolveVars([...specs.filter((s, i) => !overridden.has(declared[i])), ...calls], referenceLookup(doc, blocks, depth + 1), { colnames: block.args.colnames, rownames: block.args.rownames, hlines: block.args.hlines, names });
    const spec = parseResultsSpec(block.args.results);
    const run = runElisp({ code: block.emacsBody ?? block.body, vars, spec, lexical: block.args.lexical, names: pickedNames(block.args, names) });
    if (!run.ok) throw new Error(run.message);
    return { value: lispToValue(run.value) };
  };
}
