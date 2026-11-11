// @ts-check
// Global Variables as an init file has them. A setting's box holds the app's own shorthand (`overview`, `false`, `0`, `A`, `500KB`), and
// `(setq org-startup-folded overview)` would not run in Emacs; here each value goes to the file as Lisp and comes back as box text,
// by the setting's type. A variable with no control (every one in src/variable-catalog.js) is already Lisp and goes through as typed.
import { parseGlobalVariables as parseText, serializeGlobalVariables as serializeText } from '../src/global-variables.js';
import { SETTINGS_FIELDS } from './settings-fields.js';

/** @typedef {import('../src/global-variables.js').ValueCodec} ValueCodec */

const FIELDS = new Map(SETTINGS_FIELDS.map((f) => [f.key, f]));
/** Settings whose value is a string in Emacs (`nil` for none). */
const STRINGS = /^diary-file$/;
/** Settings whose value is a character (`?A`). */
const CHARS = /^org-priority-(highest|lowest)$/;
const SYMBOL_LIKE = /^[A-Za-z][A-Za-z0-9_+*/<>=!?-]*$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const isNil = (/** @type {string} */ v) => /^(nil|false|off|no|0)$/i.test(v);

/** @param {string} v */
const quote = (v) => '"' + v.replace(/[\\"]/g, '\\$&') + '"';
/** @param {string} source  `"text"` with its escapes */
const unquote = (source) => source.slice(1, -1).replace(/\\(.)/g, '$1');
/** @param {string} v */
const isLispForm = (v) => /^['"(?]/.test(v) || v === 't' || v === 'nil' || NUMBER.test(v);

/** @type {ValueCodec} */
export const globalVariablesCodec = {
  toLisp(name, box) {
    const field = FIELDS.get(name);
    if (!field) return undefined;
    const v = box.trim();
    switch (field.type) {
      case 'boolean': return isNil(v) ? 'nil' : 't';
      case 'onezero': return isNil(v) ? 'nil' : 't';
      case 'number': case 'weekday': return v;
      case 'logdone': return v === 'nil' || v.startsWith("'") ? v : `'${v}`;
      case 'subsuper': return v === 't' || v === 'nil' ? v : `'${v.replace(/^'/, '')}`;
      case 'hours24': return v.startsWith('(') ? `'${v}` : v.startsWith("'") ? v : 'nil';
      default: break;
    }
    if (CHARS.test(name) && /^[A-Za-z]$/.test(v)) return `?${v}`;
    if (STRINGS.test(name)) return v === 'nil' || v.startsWith('"') ? v : quote(v);
    if (isLispForm(v)) return v.startsWith('(') ? `'${v}` : v;
    if (field.type === 'select') return SYMBOL_LIKE.test(v) ? `'${v}` : quote(v);
    if (field.type === 'longtext') return SYMBOL_LIKE.test(v) || /\s/.test(v) ? `'(${v})` : quote(v); // a list of names
    return v.split(/\s+/).length > 1 && v.split(/\s+/).every((w) => SYMBOL_LIKE.test(w)) ? `'(${v})` : quote(v);
  },

  fromLisp(name, source) {
    const field = FIELDS.get(name);
    if (!field) return undefined;
    const s = source.trim();
    if (field.type === 'boolean' || field.type === 'onezero') {
      if (s === 't') return field.type === 'onezero' ? '1' : 't';
      if (s === 'nil') return field.type === 'onezero' ? '0' : 'nil';
      return s;
    }
    if (field.type === 'logdone') return s;
    if (CHARS.test(name) && /^\?.$/.test(s)) return s[1];
    if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return unquote(s);
    return s.startsWith("'") ? s.slice(1) : s;
  },
};

/** @param {string} text */
export const parseGlobalVariables = (text) => parseText(text, globalVariablesCodec);
/** @param {Record<string, any>} vars */
export const serializeGlobalVariables = (vars) => serializeText(vars, globalVariablesCodec);
