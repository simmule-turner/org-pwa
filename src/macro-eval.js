// @ts-check
/**
 * `#+MACRO:` templates that start with `(eval ...)`, run on the Lisp interpreter as Org runs them: the template becomes a function of
 * `$1`, `$2`, ... (the macro's arguments as strings, `nil` for one that was not given), its form is evaluated, and whatever it gives
 * is written the way `(format "%s" value)` writes it, nothing for `nil`. An error stops the export, as it does in Emacs.
 */
import { NIL, intern, print } from './elisp-data.js';
import { Reader } from './elisp-read.js';
import { evalForm, withDynamic } from './elisp-core.js';
import { describeFailure } from './elisp.js';
import { withContext } from './diary-lisp.js';

/** Does the template run as Lisp? Org looks at its very start. @param {string} template */
export const isEvalTemplate = (template) => /^\(eval\b/.test(template);

/**
 * The text the macro stands for.
 * @param {string} name  the macro's name, for the message about a template that cannot be read
 * @param {string} template  `(eval FORM)`
 * @param {string[]} args
 * @returns {string}
 */
export function evalMacro(name, template, args) {
  /** @type {import('./elisp-data.js').LObj} */
  let body;
  try {
    const form = new Reader(template).read();
    const rest = /** @type {{ cdr: { car?: import('./elisp-data.js').LObj } }} */ (form).cdr;
    body = rest.car ?? NIL;
  } catch {
    throw new Error(`Invalid definition for macro "${name}"`);
  }
  let most = 0;
  for (const m of template.matchAll(/\$([0-9]+)/g)) most = Math.max(most, Number(m[1]));
  /** @type {[import('./elisp-data.js').Sym, import('./elisp-data.js').LObj][]} */
  const pairs = [];
  for (let i = 1; i <= most; i++) {
    const sym = intern('$' + i);
    sym.special = true;
    pairs.push([sym, args[i - 1] ?? NIL]);
  }
  try {
    const value = withContext({}, () => withDynamic(pairs, () => evalForm(body, null)));
    return value === NIL ? '' : print(value, false);
  } catch (raw) {
    throw new Error(describeFailure(raw).message);
  }
}
