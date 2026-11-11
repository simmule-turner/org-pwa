// @ts-check
/**
 * The `elisp:` links of Org: `[[elisp:(customize-variable 'org-tags-column)]]` runs that form. Only `customize-variable` of a variable
 * the index knows is run here; anything else is refused with a message, as the app never runs Lisp from a link.
 */

/**
 * @param {string} target  the link target, `elisp:(...)`
 * @param {(name: string) => boolean} known  whether the index has the variable
 * @returns {{ ok: true, name: string } | { ok: false, message: string }}
 */
export function parseElispLink(target, known) {
  const code = target.replace(/^elisp:/i, '').trim();
  const m = /^\(\s*customize-variable\s+(?:'|\(\s*quote\s+)([^\s()']+)\s*\)?\s*\)$/.exec(code);
  if (!m) return { ok: false, message: 'This link runs Lisp; only (customize-variable \'NAME) is allowed here.' };
  return known(m[1]) ? { ok: true, name: m[1] } : { ok: false, message: `${m[1]} is not a variable this app knows.` };
}
