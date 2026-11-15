// @ts-check
/**
 * The two column-view settings that name Lisp functions, run on the interpreter as org-colview.el runs them:
 * `org-columns-summary-types` (an alist from the label used in `{...}` of a column to `SUMMARIZE` or `(SUMMARIZE COLLECT)`) and
 * `org-columns-modify-value-for-display-function`. A setting is taken from the Lisp init when that sets the variable, else from the
 * setting's text.
 */
import { Cons, NIL, T, intern, list, print, toArray } from './elisp-data.js';
import { Reader } from './elisp-read.js';
import { evalPlain, funcallPlain } from './elisp-core.js';
import { describeFailure } from './elisp.js';
import { withContext } from './diary-lisp.js';
import { initValue } from './holidays.js';
import { settingFunction } from './agenda-lisp.js';
import { withHeading } from './org-lisp.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */
/** @typedef {{ summarize: (values: string[], printf: string | null) => string, collect: ((property: string, heading: import('./org-lisp.js').HeadingContext) => string) | null }} SummaryType */

/** Calls `fn`, on a heading when one is given; a failure becomes the error Emacs would show. @param {LObj} fn @param {LObj[]} args @param {import('./org-lisp.js').HeadingContext} [heading] @returns {LObj} */
function call(fn, args, heading) {
  try {
    return withContext({}, () => (heading ? withHeading(heading, () => funcallPlain(fn, args)) : funcallPlain(fn, args)));
  } catch (raw) {
    throw new Error(describeFailure(raw).message);
  }
}

/** Is `x` a function (`functionp`)? @param {LObj} x */
const isFunction = (x) => funcallPlain(intern('functionp'), [x]) === T;

/** @param {string} what @param {LObj} v @returns {string} */
function asString(what, v) {
  if (typeof v !== 'string') throw new Error(`Wrong type argument: sequencep, ${print(v)}`);
  return v;
}

/**
 * The value of `org-columns-summary-types`, as an alist of Lisp objects; null when it is unset.
 * @param {string | null | undefined} text  the setting's text
 * @returns {LObj[] | null}
 */
function summaryAlist(text) {
  const fromInit = initValue('org-columns-summary-types');
  if (fromInit !== undefined) return fromInit === NIL ? null : toArray(fromInit);
  const source = String(text ?? '').trim();
  if (!source || source === 'nil') return null;
  try {
    const value = withContext({}, () => evalPlain(new Reader(source).read(), null));
    return value === NIL ? null : toArray(value);
  } catch {
    return null;
  }
}

/**
 * `org-columns--summarize` and `org-columns--collect` for the operators the setting defines; the function it returns is null for an
 * operator the setting does not define (the built-in types then apply). A definition that is neither `(LABEL . FUNCTION)` nor
 * `(LABEL SUMMARIZE COLLECT)` is an error, `Invalid definition for operator "x"`.
 * @param {string | null | undefined} text
 * @returns {((operator: string) => SummaryType | null) | null}
 */
export function summaryTypes(text) {
  const alist = summaryAlist(text);
  if (!alist) return null;
  return (operator) => {
    const entry = alist.find((e) => e instanceof Cons && e.car === operator);
    if (!(entry instanceof Cons)) return null;
    const invalid = () => new Error(`Invalid definition for operator ${JSON.stringify(operator)}`);
    /** @type {LObj} */
    let summarize;
    /** @type {LObj | null} */
    let collect = null;
    if (isFunction(entry.cdr)) summarize = entry.cdr;
    else {
      let items;
      try {
        items = toArray(entry.cdr);
      } catch {
        throw invalid();
      }
      if (items.length !== 2) throw invalid();
      [summarize, collect] = items;
    }
    const collector = collect;
    return {
      summarize: (values, printf) => asString('summary', call(summarize, [list(values), printf ?? NIL])),
      collect: collector ? (property, heading) => {
        const v = call(collector, [property], heading);
        return v === NIL ? '' : asString('collected value', v);
      } : null,
    };
  };
}

/**
 * `org-columns-modify-value-for-display-function`: called with the column's title and the value, it gives the text to show, or nil to
 * show the value as it is.
 * @param {string | null | undefined} text
 * @returns {((title: string, value: string) => string | null) | null}
 */
export function modifyValueFunction(text) {
  const fn = settingFunction('org-columns-modify-value-for-display-function', text);
  if (!fn) return null;
  return (title, value) => {
    const v = call(fn, [title, value]);
    return v === NIL ? null : asString('displayed value', v);
  };
}
