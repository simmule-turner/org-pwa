// @ts-check
/**
 * What the table and list converters (orgtbl-to-generic, org-list-to-generic and the functions built on them) share: reading a
 * property list of parameters, evaluating a parameter that is a string, a function or (for a field format) a list of column
 * numbers and formats, and the small string functions of Org they use (`org-trim`, `org-element-normalize-string`, ...).
 */
import { Cons, NIL, Sym, intern, isStr, signal, toArray, unbox, wrongType } from './elisp-data.js';
import { funcall } from './elisp-core.js';
import { format } from './elisp-lib.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */

/** `user-error`. @param {string} message */
export function userError(message) {
  return signal('user-error', [message]);
}

/** The key/value pairs of a property list, in order. @param {LObj} plist @returns {[LObj, LObj][]} */
export function pairs(plist) {
  /** @type {[LObj, LObj][]} */
  const out = [];
  for (let p = plist; p instanceof Cons; p = p.cdr instanceof Cons ? p.cdr.cdr : NIL) out.push([p.car, p.cdr instanceof Cons ? p.cdr.car : NIL]);
  return out;
}

/** `plist-get`. @param {LObj} plist @param {string} key */
export function pget(plist, key) {
  const k = intern(key);
  for (const [a, b] of pairs(plist)) if (a === k) return b;
  return NIL;
}

/** `plist-member`. @param {LObj} plist @param {string} key */
export function pmember(plist, key) {
  const k = intern(key);
  return pairs(plist).some(([a]) => a === k);
}

/** `org-combine-plists`: the properties of the first list, then those of the others set over them (a property keeps the place it first had).
 * @param {LObj[]} plists @returns {[LObj, LObj][]} */
export function combine(plists) {
  /** @type {[LObj, LObj][]} */
  const out = [];
  for (const pl of plists) {
    for (const [k, v] of pairs(pl)) {
      const at = out.findIndex(([a]) => a === k);
      if (at >= 0) out[at] = [k, v];
      else out.push([k, v]);
    }
  }
  return out;
}

/** A property list from key/value pairs. @param {[LObj, LObj][]} items */
export function plistOf(items) {
  /** @type {LObj} */
  let out = NIL;
  for (let i = items.length - 1; i >= 0; i--) out = new Cons(items[i][0], new Cons(items[i][1], out));
  return out;
}

/** `functionp`. @param {LObj} x */
export function isFunction(x) {
  return funcall(intern('functionp'), [x]) !== NIL;
}

/** The text of a Lisp string; nil is nothing; anything else is not a string (`concat` refuses it). @param {LObj | null | undefined} x @returns {string} */
export function text(x) {
  if (x === null || x === undefined || x === NIL) return '';
  if (isStr(x)) return String(unbox(x));
  throw wrongType('sequencep', x);
}

/** `org-element-normalize-string`: a string ends with one newline (the empty one stays empty). @param {string} s */
export function normalizeString(s) {
  return s === '' ? '' : s.replace(/(\n[ \t]*)*$/, '\n');
}

/** `org-trim`. @param {string} s */
export function trim(s) {
  return s.replace(/^[ \t\n\r]+/, '').replace(/[ \t\n\r]+$/, '');
}

/** `org-string-nw-p`. @param {string} s */
export const nonBlank = (s) => /[^ \r\t\n]/.test(s);

/**
 * Whether a parameter may stand where Org's `org-table--generic-apply` is given it: nothing, a function, a string, and (with a field
 * format) a list. Anything else is the user error Org signals while it builds the transcoders.
 * @param {LObj} value @param {string} name @param {boolean} [withCons]
 */
export function checkParameter(value, name, withCons = false) {
  if (value === NIL || isFunction(value) || isStr(value) || (withCons && value instanceof Cons)) return;
  throw userError(`Wrong ${name} value`);
}

/**
 * `org-table--generic-apply` at run time: a function is called with ARGS, a string is a `format` string for them (all of the first
 * argument when `spread`), and with a list of column numbers and formats the one of COLUMN is used (the field itself when none is).
 * @param {LObj} value @param {string} name @param {boolean} withCons @param {LObj[]} args @param {number} [column] @param {LObj} [contents] @param {boolean} [spread]
 * @returns {LObj}
 */
export function applyParameter(value, name, withCons, args, column = 0, contents = NIL, spread = false) {
  if (value === NIL) return NIL;
  if (isFunction(value)) return funcall(value, args);
  if (isStr(value)) {
    if (spread) return format(String(unbox(value)), toArray(args[0]));
    return args.length ? format(String(unbox(value)), args) : value;
  }
  if (withCons && value instanceof Cons) {
    /** @type {LObj} */
    let found = NIL;
    for (let p = /** @type {LObj} */ (value); p instanceof Cons; p = p.cdr) {
      if (p.car === column) {
        found = p.cdr instanceof Cons ? p.cdr.car : NIL;
        break;
      }
    }
    if (found === NIL) return contents;
    if (isStr(found)) return format(String(unbox(found)), args);
    if (isFunction(found)) return funcall(found, args);
  }
  throw userError(`Wrong ${name} value`);
}

/** Whether `x` is the symbol of that name. @param {LObj} x @param {string} name */
export const isSymbol = (x, name) => x instanceof Sym && x.name === name;

/** The back ends Org knows (`org-export-get-backend`) and the ones the converters can write. */
export const KNOWN_BACKENDS = new Set(['ascii', 'beamer', 'html', 'icalendar', 'latex', 'man', 'md', 'odt', 'org', 'texinfo', 'koma-letter']);
export const CONVERTER_BACKENDS = new Set(['org', 'html', 'latex', 'ascii']);

/** The name of the back end a `:backend` parameter gives, or null for none; an error for one Org does not know or this app does not write.
 * @param {LObj} value @returns {string | null} */
export function backendName(value) {
  if (value === NIL) return null;
  if (!(value instanceof Sym) || !KNOWN_BACKENDS.has(value.name)) throw userError('Unknown :backend value');
  if (!CONVERTER_BACKENDS.has(value.name)) throw userError(`The ${value.name} back end is not available to the converters of this app`);
  return value.name;
}
