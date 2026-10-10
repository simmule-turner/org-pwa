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

// ---- agenda sources and header lines ---------------------------------------------------------------------

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/;

/** What a script's agenda source returned -> [{ title, date, time, endTime, repeat }] with plain, checked fields.
 *  An item is { title, start } (or { summary, start }, as org.ics.parse gives), start being "YYYY-MM-DD" or
 *  "YYYY-MM-DD HH:MM"; optional end (same shape, only its time is used) and repeat ("+1d", "+2w", "+1m", "+1y"). */
export function normalizeAgendaItems(list, max = 500) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    if (out.length >= max) break;
    if (!raw || typeof raw !== 'object' || raw.cancelled === true) continue;
    const start = DAY_RE.exec(String(raw.start || raw.date || '').trim());
    const title = String(raw.title || raw.summary || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!start || !title) continue;
    const month = Number(start[2]);
    const day = Number(start[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const end = DAY_RE.exec(String(raw.end || '').trim());
    const repeat = /^\+(\d{1,3})([dwmy])$/.exec(String(raw.repeat || ''));
    out.push({
      title,
      date: `${start[1]}-${start[2]}-${start[3]}`,
      time: start[4] ? `${start[4]}:${start[5]}` : null,
      endTime: start[4] && end && end[4] ? `${end[4]}:${end[5]}` : null,
      repeat: repeat ? { n: Number(repeat[1]), unit: repeat[2] } : null,
    });
  }
  return out;
}

const keyOf = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

/** The days ("YYYY-MM-DD") from `fromKey` to `toKey` on which a normalized item falls (a repeat is expanded). */
export function agendaOccurrences(item, fromKey, toKey) {
  const [y, m, d] = item.date.split('-').map(Number);
  if (!item.repeat) return item.date >= fromKey && item.date <= toKey ? [item.date] : [];
  const days = [];
  for (let i = 0; i < 2000; i++) {
    const { n, unit } = item.repeat;
    let at;
    if (unit === 'd' || unit === 'w') at = new Date(Date.UTC(y, m - 1, d + i * n * (unit === 'w' ? 7 : 1)));
    else {
      const months = i * n * (unit === 'y' ? 12 : 1);
      const first = new Date(Date.UTC(y, m - 1 + months, 1));
      const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      at = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)));
    }
    const key = keyOf(at);
    if (key > toKey) break;
    if (key >= fromKey) days.push(key);
  }
  return days;
}

/** A header line from a script: one line of plain text, or null. */
export function normalizeLine(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim().slice(0, 200);
  return text || null;
}
