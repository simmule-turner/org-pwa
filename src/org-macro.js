// @ts-check
/**
 * `{{{macro(args)}}}` as org-macro.el expands it (Emacs 29.3 / Org 9.6): which text is a macro reference, how its arguments are cut,
 * which template answers a name (the built-in title/author/email/date, then the `#+MACRO:` lines, first definition first, then
 * keyword, n, property and time), how `$1` ... are filled and how the value is expanded again.
 */
import { formatTime } from './capture-template.js';
import { parseOrgTimestamp } from './org-timestamp.js';
import { evalMacro, isEvalTemplate } from './macro-eval.js';

/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {{ doc: Doc, now: Date, heading: Heading | null, file: { name?: string, mtime?: Date } | null, counters: Map<string, number> }} MacroContext */

/** A macro reference: a name, and the argument text up to the first `)}}}`. */
export const MACRO_REFERENCE_RE = /\{\{\{([a-zA-Z][-a-zA-Z0-9_]*)(?:\(([\s\S]*?)\))?\}\}\}/g;

/**
 * org-macro-extract-arguments: the arguments in `s`, cut at the commas not escaped by a backslash.
 * @param {string} s
 * @returns {string[]}
 */
export function extractArguments(s) {
  const marked = s.replace(/(\\*),/g, (_all, slashes) => '\\'.repeat(Math.floor(slashes.length / 2)) + (slashes.length % 2 === 0 ? '\0' : ','));
  return marked.split('\0');
}

/** Every `#+NAME:` line of the document, the file's own keywords first. @param {Doc} doc @param {string} name @returns {string[]} the values, trimmed */
function keywordLines(doc, name) {
  const want = name.toUpperCase();
  /** @type {string[]} */
  const values = [];
  for (const kw of doc.keywords || []) if (kw.key.toUpperCase() === want) values.push(kw.value.trim());
  /** @param {string[]} lines */
  const scan = (lines) => {
    for (const line of lines) {
      const m = /^[ \t]*#\+([A-Za-z_]+):(?:[ \t]+(.*))?$/.exec(line);
      if (m && m[1].toUpperCase() === want) values.push((m[2] ?? '').trim());
    }
  };
  scan(doc.bodyLines || []);
  /** @param {Heading[]} hs */
  const walk = (hs) => hs.forEach((h) => { scan(h.bodyLines || []); walk(h.children || []); });
  walk(doc.children || []);
  return values;
}

/** org-macro--find-keyword-value. @param {Doc} doc @param {string} name @param {boolean} collect @returns {string | null} */
function keywordValue(doc, name, collect) {
  const values = keywordLines(doc, name);
  if (!values.length) return null;
  return collect ? values.join(' ').trim() : values[0];
}

/** @param {Doc} doc @returns {Heading[]} */
function allHeadings(doc) {
  /** @type {Heading[]} */ const out = [];
  /** @param {Heading[]} list */
  const walk = (list) => list.forEach((h) => (out.push(h), walk(h.children || [])));
  walk(doc.children || []);
  return out;
}

/** org-macro--get-property: the property of the heading holding the macro, or of the heading `location` names. @param {MacroContext} ctx @param {string} property @param {string} [location] */
function propertyValue(ctx, property, location) {
  /** @type {Heading | null | undefined} */
  let heading = ctx.heading;
  if (location !== undefined && location.trim() !== '') {
    const search = location.trim().replace(/^\*/, '').trim();
    const all = allHeadings(ctx.doc);
    heading = location.trim().startsWith('#') ? all.find((h) => h.properties?.CUSTOM_ID === search.slice(1)) : all.find((h) => h.title.trim().toLowerCase() === search.toLowerCase());
    if (!heading) throw new Error(`Macro property failed: cannot find location ${location}`);
  }
  const props = heading?.properties;
  const hit = props && Object.keys(props).find((k) => k.toUpperCase() === property.toUpperCase());
  return hit === undefined || !props ? '' : String(props[hit]);
}

/** org-macro--counter-increment. @param {Map<string, number>} counters @param {string | undefined} name @param {string | undefined} action */
function counter(counters, name, action) {
  const key = (name ?? '').trim();
  const act = action === undefined || action.trim() === '' ? null : action.trim();
  const value = act === null ? (counters.get(key) ?? 0) + 1 : act === '-' ? (counters.get(key) ?? 1) : /^[0-9]+$/.test(act) ? Number(act) : 1;
  counters.set(key, value);
  return String(value);
}

/** The `{{{date}}}` template: a single timestamp is formatted by the argument, anything else is the plain value. @param {string} raw @param {string | undefined} format */
function dateValue(raw, format) {
  if (format !== undefined && format.trim() !== '') {
    const m = /^([<[][^>\]]*[>\]])(?:--[<[][^>\]]*[>\]])?$/.exec(raw);
    const parsed = m && parseOrgTimestamp(m[1]);
    if (parsed) return formatTime(parsed.date, format);
  }
  return raw;
}

/** @param {string} template @param {string[]} args */
const fillTemplate = (template, args) => template.replace(/\$([0-9]+)/g, (_m, n) => args[Number(n) - 1 < 0 ? 0 : Number(n) - 1] ?? '');

/**
 * What the macro stands for, or null when no template answers its name.
 * @param {string} key  the name, lower case
 * @param {string[]} args
 * @param {Record<string, string>} macros  the `#+MACRO:` definitions by name, first definition kept
 * @param {MacroContext} ctx
 * @returns {string | null}
 */
function valueOf(key, args, macros, ctx) {
  const doc = ctx.doc;
  const author = keywordValue(doc, 'AUTHOR', true);
  const email = keywordValue(doc, 'EMAIL', false);
  const title = keywordValue(doc, 'TITLE', true);
  const date = keywordValue(doc, 'DATE', false);
  /** @type {[string, string][]} */
  const table = [];
  /** @param {string} name @param {string | null} value */
  const builtin = (name, value) => {
    if (name in macros) {
      if (value !== null) macros = { ...macros, [name]: value };
    } else table.push([name, value ?? '']);
  };
  builtin('date', date);
  builtin('title', title);
  builtin('email', email);
  builtin('author', author);
  for (const [name, template] of Object.entries(macros)) table.push([name, template]);
  const found = table.find(([name]) => name.toLowerCase() === key);
  if (found) {
    const [name, template] = found;
    if (name.toLowerCase() === 'date' && date !== null && template === date) return dateValue(date, args[0]);
    if (isEvalTemplate(template)) return evalMacro(name, template, args);
    return fillTemplate(template, args);
  }
  switch (key) {
    case 'keyword': {
      if (args.length === 0) throw new Error('Wrong number of arguments: (lambda (arg1 &rest _) (org-macro--find-keyword-value arg1 t)), 0');
      return keywordValue(doc, args[0], true) ?? '';
    }
    case 'n': return counter(ctx.counters, args[0], args[1]);
    case 'property': {
      if (args.length === 0) throw new Error('Wrong number of arguments: (lambda (arg1 &optional arg2 &rest _) (org-macro--get-property arg1 arg2)), 0');
      return propertyValue(ctx, args[0], args[1]);
    }
    case 'time': {
      if (args.length === 0) throw new Error('Wrong number of arguments: (lambda (arg1 &rest _) (format-time-string arg1)), 0');
      return formatTime(ctx.now, args[0]);
    }
    case 'input-file': return ctx.file?.name !== undefined ? ctx.file.name : null;
    case 'modification-time': return ctx.file?.mtime ? formatTime(ctx.file.mtime, args[0] || '%Y-%m-%d') : null;
    default: return null;
  }
}

/**
 * The `#+MACRO:` definitions of a document by name, the first definition of a name kept.
 * @param {Doc} doc
 * @returns {Record<string, string>}
 */
export function macroDefinitions(doc) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const kw of doc.keywords || []) {
    if (kw.key.toUpperCase() !== 'MACRO') continue;
    const m = /^(\S+)[ \t]*([\s\S]*)$/.exec(kw.value.trim());
    if (m && !(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}

/**
 * `text` with its macro references replaced, a value being expanded again where it stands.
 * @param {string} text
 * @param {Record<string, string>} macros  see macroDefinitions
 * @param {MacroContext} ctx
 * @param {string[]} [chain]  the references being expanded, to catch one that expands into itself
 * @returns {string}
 */
export function expandReferences(text, macros, ctx, chain = []) {
  return text.replace(MACRO_REFERENCE_RE, (whole, /** @type {string} */ name, /** @type {string | undefined} */ argText) => {
    const key = name.toLowerCase();
    const args = argText === undefined ? [] : extractArguments(argText.trim().replace(/[ \t\r\n]+/g, ' '));
    if (chain.includes(whole)) throw new Error(`Circular macro expansion: ${key}`);
    const value = valueOf(key, args, macros, ctx);
    if (value === null) {
      if (key === 'results') return whole;
      throw new Error(`Undefined Org macro: ${key}; aborting`);
    }
    return expandReferences(value, macros, ctx, [...chain, whole]);
  });
}
