// @ts-check
/** @typedef {import('./types.js').LocalVars} LocalVars */
import { setTagsColumn, tagsColumnOf } from './tags-column.js';
import { setSizeLimits, sizeLimitsOf } from './size-limits.js';
/**
 * "Global Variables" -- an app-wide, cross-file settings mechanism
 * (configured in Settings, not embedded in any particular .org file)
 * for the same kind of Emacs Lisp variable a file's own Local
 * Variables block or #+STARTUP: line can already set, but as the
 * baseline default across every file rather than a single file's own
 * override. Written as Emacs writes an init file: one
 * `(setq NAME VALUE)` form per variable. A file's own Local Variables
 * block keeps Emacs's `name: value` lines (see local-variables.js).
 *
 * Precedence (lowest to highest, matching real Emacs org-mode's own
 * actual resolution order exactly):
 *
 *   1. Global Variables (this module)     -- the app-wide baseline
 *   2. #+STARTUP: (org's own file-level directive, where applicable --
 *      only a few variables, like org-log-done, have a #+STARTUP:
 *      shorthand at all)
 *   3. A file's own "# Local Variables:" block -- highest precedence,
 *      the most file-specific, explicit override
 *
 * Real Emacs processes file-local variables last, specifically so a
 * file can override anything set earlier -- including the user's own
 * init-file customizations, which is exactly the role Global
 * Variables plays here. See README.org's own "Configuration" section
 * for the full, worked-through explanation of why this order, not
 * just the mechanics of it.
 */

/** The top-level forms of Lisp text, each as its source; comments (`;` to the end of the line) are left out.
 * @param {string} text @returns {string[]} */
function topLevelForms(text) {
  /** @type {string[]} */ const forms = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    } else if (c === ';') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '?' && i + 1 < text.length) {
      i += text[i + 1] === '\\' ? 2 : 1; // a character literal such as ?\( or ?(
    } else if (c === '(') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === ')' && depth > 0) {
      depth--;
      if (depth === 0) forms.push(text.slice(start, i + 1));
    }
  }
  return forms;
}

/** The elements of a list form's source, each as its own source (an atom, a string, a quoted or a parenthesized form).
 * @param {string} form  `(a b c)` @returns {string[]} */
function formElements(form) {
  const body = form.slice(1, -1);
  /** @type {string[]} */ const out = [];
  let i = 0;
  while (i < body.length) {
    if (/\s/.test(body[i])) { i++; continue; }
    if (body[i] === ';') { while (i < body.length && body[i] !== '\n') i++; continue; }
    const start = i;
    while (i < body.length && /['`,#]/.test(body[i])) i++; // quote marks belong to the element they precede
    if (body[i] === '(') {
      const inner = topLevelForms(body.slice(i))[0];
      i += inner === undefined ? body.length : inner.length;
    } else if (body[i] === '"') {
      i++;
      while (i < body.length && body[i] !== '"') i += body[i] === '\\' ? 2 : 1;
      i++;
    } else {
      while (i < body.length && !/[\s()";]/.test(body[i])) i++;
    }
    out.push(body.slice(start, i));
  }
  return out;
}

/** The variables the `(setq NAME VALUE ...)` forms of a text set, each value as its source (`'time`, `"text"`, `t`); other forms are ignored.
 * @param {string} text */
export function parseGlobalVariables(text) {
  /** @type {Record<string, string>} */ const vars = {};
  if (!text) return vars;
  for (const form of topLevelForms(text)) {
    const [head, ...rest] = formElements(form);
    if (head !== 'setq') continue;
    for (let k = 0; k + 1 < rest.length; k += 2) if (/^[A-Za-z][^\s'"()]*$/.test(rest[k])) vars[rest[k]] = rest[k + 1];
  }
  return vars;
}

/** The reverse of parseGlobalVariables: one `(setq NAME VALUE)` per variable, sorted by name so the text does not depend on the order
 *  the variables were set in. A variable whose value is null, undefined or empty is left out (a setting reset to unset).
 * @param {LocalVars} vars */
export function serializeGlobalVariables(vars) {
  return Object.keys(vars)
    .filter((k) => vars[k] !== null && vars[k] !== undefined && vars[k] !== '')
    .sort()
    .map((k) => `(setq ${k} ${vars[k]})`)
    .join('\n');
}

/**
 * Merges Global Variables (`globalVars`, the lowest-precedence,
 * app-wide baseline) with a file's own Local Variables (`localVars`,
 * the highest-precedence, most file-specific override) into one
 * combined map -- a key present in both resolves in favor of the
 * file-local value. Every one of local-variables.js's own getXxx()
 * accessors already just reads from a plain `{ name: rawValue }` map,
 * so passing this merged result in their place is enough to make
 * every existing accessor Global-Variables-aware for free, with no
 * changes needed to local-variables.js itself.
 * @param {import('./types.js').LocalVars | null} [globalVars]
 * @param {import('./types.js').LocalVars | null} [localVars]
 */
export function mergeGlobalAndLocalVariables(globalVars, localVars) {
  const merged = { ...(globalVars || {}), ...(localVars || {}) };
  setTagsColumn(tagsColumnOf(merged)); // headings written again put their tags where org-tags-column says
  setSizeLimits(sizeLimitsOf(merged)); // the size a file may be before it is warned about or refused
  return merged;
}
