// @ts-check
// Settings set from the Lisp init: `(setq org-agenda-files '("github:home.org"))` in org-xx-lisp-init gives the setting that value,
// as in Emacs, where init.el overrides what was customized. Each value is turned into the text the setting's own box holds.
import { readLisp } from '../src/lisp-read.js';
import { runInit } from '../src/lisp-init.js';
import { QUICK_SETTINGS_FIELDS } from './settings-fields.js';

/** @typedef {import('../src/lisp-read.js').Lisp} Lisp */

/** Settings the init cannot set: the init itself, and the switch that lets scripts run (that stays the person's own decision). */
const NOT_FROM_LISP = new Set(['org-xx-lisp-init', 'org-xx-extensions']);
/** Settings whose box holds file names separated by semicolons. */
const SEMICOLON_LISTS = new Set(['org-agenda-files', 'org-contacts-files', 'org-agenda-text-search-extra-files']);

/** @param {Lisp} f @returns {string} Emacs's `prin1` of the value */
function printed(f) {
  if (f.k === 'str') return JSON.stringify(f.v);
  if (f.k === 'num') return String(f.v);
  if (f.k === 'sym') return f.v;
  return '(' + f.items.map(printed).join(' ') + (f.tail ? ' . ' + printed(f.tail) : '') + ')';
}

/** @param {Lisp} f  the value as the plain text of a `text` box */
function plain(f) {
  return f.k === 'str' ? f.v : printed(f);
}

/** @param {Lisp} f */
const isNilValue = (f) => (f.k === 'sym' && f.v === 'nil') || (f.k === 'list' && f.items.length === 0 && !f.tail);

/**
 * The text a setting's box holds for the Lisp value `f`, or null when the value does not fit the setting.
 * @param {import('./settings-fields.js').QuickSettingField} field
 * @param {Lisp} f
 * @returns {string | null}
 */
export function boxText(field, f) {
  const nil = isNilValue(f);
  switch (field.type) {
    case 'boolean':
      return nil ? 'nil' : 't';
    case 'onezero':
      if (f.k === 'num') return String(f.v);
      return nil ? '0' : '1';
    case 'number':
    case 'weekday':
      return f.k === 'num' ? String(f.v) : null;
    case 'logdone':
      return f.k === 'sym' && (f.v === 'time' || f.v === 'note') ? `'${f.v}` : nil ? 'nil' : null;
    case 'subsuper':
      return f.k === 'sym' ? f.v : nil ? 'nil' : null;
    case 'hours24':
      return f.k === 'list' ? printed(f) : null;
    case 'select':
    case 'text':
      if (f.k === 'num' && /^org-priority-(highest|lowest|default)$/.test(field.key)) return String.fromCharCode(f.v); // ?A is 65
      return f.k === 'str' ? f.v : f.k === 'sym' ? f.v : printed(f);
    case 'longtext': {
      if (SEMICOLON_LISTS.has(field.key)) {
        if (f.k === 'str') return f.v;
        if (nil) return '';
        return f.k === 'list' && f.items.every((x) => x.k === 'str') ? f.items.map((x) => /** @type {{ v: string }} */ (x).v).join(';') : null;
      }
      if (field.entryTokenizer) {
        if (f.k === 'str') return f.v;
        return f.k === 'list' && f.items.every((x) => x.k === 'str') ? f.items.map(printed).join(' ') : null;
      }
      return f.k === 'str' ? f.v : printed(f);
    }
    default:
      return plain(f);
  }
}

/**
 * What the init sees for a setting that has a stored value, so `(add-to-list 'org-modules 'org-habit)` or
 * `(setq org-priority-lowest ...)` starts from what is saved.
 * @param {import('./settings-fields.js').QuickSettingField} field
 * @param {string} raw
 * @returns {Lisp}
 */
function startingValue(field, raw) {
  const text = raw.trim();
  if (SEMICOLON_LISTS.has(field.key)) return { k: 'list', items: text.split(';').map((s) => s.trim()).filter(Boolean).map((v) => ({ k: 'str', v })) };
  if (field.type === 'boolean') return { k: 'sym', v: text === 'nil' ? 'nil' : 't' };
  if (field.type === 'number' || field.type === 'weekday') return { k: 'num', v: Number(text) };
  if (field.type === 'text' || field.type === 'select') return { k: 'str', v: raw };
  return readLisp(text)[0] || { k: 'str', v: raw };
}

/**
 * Runs the Lisp init `text` and returns the settings it sets, as the text of each setting's box, and the errors it hit.
 * @param {string} text
 * @param {Record<string, string>} stored  the settings as saved
 * @returns {{ values: Record<string, string>, errors: string[] }}
 */
export function settingsFromInit(text, stored) {
  /** @type {Record<string, string>} */
  const values = {};
  if (!text.trim()) return { values, errors: [] };
  const fields = QUICK_SETTINGS_FIELDS.filter((f) => !NOT_FROM_LISP.has(f.key));
  /** @type {Map<string, Lisp>} */
  const initial = new Map();
  for (const f of fields) if (stored[f.key] !== undefined && stored[f.key] !== '') initial.set(f.key, startingValue(f, stored[f.key]));
  const result = runInit(text, initial);
  for (const f of fields) {
    const value = result.get(f.key);
    if (!value || JSON.stringify(value) === JSON.stringify(initial.get(f.key))) continue;
    const box = boxText(f, value);
    if (box !== null) values[f.key] = box;
    else result.errors.push(`${f.key}: the value ${printed(value)} does not fit this setting`);
  }
  return { values, errors: result.errors };
}
