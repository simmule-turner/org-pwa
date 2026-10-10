/**
 * User-defined diary functions: the pure part. A user script registers a function with
 * `org.sexp('my-name', fn)`; an agenda line `%%(my-name arg ...)` then calls it once per day.
 * This module holds what needs no browser: the list of names a script may not take, how sexp
 * arguments become plain values, how a script's answer becomes a diary result, and the
 * fingerprint an approval is tied to.
 */

/** Every function the app already evaluates itself. A script cannot register one of these:
 *  the standard forms must mean the same here as in Emacs. */
export const BUILTIN_SEXP_NAMES = new Set([
  'when', 'today-p', 'and', 'or', 'not', 'org-block', 'org-date', 'org-class', 'org-cyclic', 'org-anniversary',
  'diary-float', 'diary-sunrise', 'diary-sunset', 'diary-civil-dawn', 'diary-civil-dusk', 'diary-nautical-dawn',
  'diary-nautical-dusk', 'diary-astronomical-dawn', 'diary-astronomical-dusk', 'diary-day-length', 'org-weather',
  'format', 'diary-anniversary', 'diary-date', 'diary-cyclic', 'diary-block', 'diary-remind', 'diary-phases-of-moon',
]);

/** The events a script can hook with org.on. Only `todo-change` and `capture` may answer with edits: changing the
 *  file in reply to a save or an open would mark it modified the moment it was saved or opened. */
export const EVENT_NAMES = ['open', 'save', 'todo-change', 'capture'];
export const EDIT_EVENTS = new Set(['todo-change', 'capture']);

const NAME_RE = /^[A-Za-z][A-Za-z0-9-]*$/;

/** A name a script may register: letters, digits and dashes, not a built-in. */
export function usableSexpName(name) {
  return typeof name === 'string' && NAME_RE.test(name) && !BUILTIN_SEXP_NAMES.has(name);
}

/** One parsed sexp argument as a plain value: numbers and strings as they are, `t` as true, `nil` as
 *  null, any other symbol as its name, a list as an array. Arguments are not evaluated. */
export function sexpArgToValue(node) {
  if (Array.isArray(node)) return node.map(sexpArgToValue);
  if (!node) return null;
  if (node.type === 'number' || node.type === 'string') return node.value;
  if (node.type === 'symbol') return node.value === 't' ? true : node.value === 'nil' ? null : node.value;
  return null;
}

/** A script's answer as a diary result: nothing (false), an entry with the line's own text (true),
 *  or an entry with this text (a string). Anything else is no entry. */
export function userSexpResult(value) {
  if (value === true) return true;
  if (typeof value === 'string') return value === '' ? true : value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return false;
}

/** The cache key for one function, argument list and day. */
export function userSexpKey(name, args, dayKey) {
  return JSON.stringify([name, args, dayKey]);
}

/** The effective settings as strings, leaving out anything named like a credential. */
export function visibleVariableMap(...sources) {
  const out = {};
  for (const source of sources) {
    for (const [name, value] of Object.entries(source || {})) {
      if (typeof value === 'string' && !/token|password|secret|credential|auth|key/i.test(name)) out[name] = value;
    }
  }
  return out;
}

/** SHA-256 of a script's text, in hex. An approval holds only while this matches. */
export async function hashScript(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether extension scripts may run: the Global Variables switch `org-xx-extensions`, never a file's own. */
export function extensionsOn(globalVars) {
  const raw = (globalVars || {})['org-xx-extensions'];
  return /^(on|yes|t|true)$/i.test(raw ? String(raw).trim() : '');
}
