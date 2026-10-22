// @ts-check
// The clock's two nudges, as Org's org-clock.el words them: the reminder when the clocked time reaches the effort
// (org-clock-notify-once-if-expired) and the question after the person has been away (org-clock-idle-time).

/** Has the clocked time reached the effort? An effort of 0 or none never does, as in Emacs.
 * @param {number} effortMinutes @param {number} clockedMinutes */
export function effortReached(effortMinutes, clockedMinutes) {
  return effortMinutes > 0 && clockedMinutes >= effortMinutes;
}

/** Org's own message. @param {string} title @param {string} effort the EFFORT value as written */
export function reminderText(title, effort) {
  return `Task ‘${title}’ should be finished by now. (${effort})`;
}

/** org-clock-idle-time: a whole number of minutes, or null for nil / unset / anything else.
 * @param {string | undefined} raw */
export function idleLimitMinutes(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n > 0 ? n : null;
}

/** org-clock-sound: 'none' for nil / unset, 'beep' for t, and 'file' for a file name (played where the app has the org-pwa folder, a beep elsewhere, as Emacs beeps when the file is missing).
 * @param {string | undefined} raw
 * @returns {'none' | 'beep' | 'file'} */
export function soundKind(raw) {
  const text = String(raw == null ? '' : raw).trim().replace(/^"|"$/g, '');
  if (text === '' || text === 'nil') return 'none';
  return text === 't' ? 'beep' : 'file';
}

/**
 * The file an org-clock-sound value names, as a path in the org-pwa folder: the quotes and any folder part (`~/sounds/`, `/usr/share/`) are
 * dropped, since a path on another machine means nothing here.
 * @param {string | undefined} raw
 * @returns {string | null}  null unless the value names a file
 */
export function soundFileName(raw) {
  if (soundKind(raw) !== 'file') return null;
  const name = String(raw).trim().replace(/^"|"$/g, '').split('/').pop() || '';
  return name === '' ? null : name;
}

/** The sentence over the idle question, in Org's words. @param {number} idleMinutes */
export function idlePrompt(idleMinutes) {
  return `Clocked in & idle for ${(Math.round(idleMinutes * 10) / 10).toFixed(1)} mins`;
}

/** The keys of Org's clock resolution prompt, in its order (`org-clock-resolve`): ignore, keep, time, got back, subtract, cancel, jump. An upper-case key ends up clocked out. */
export const RESOLVE_KEYS = ['i', 'k', 'K', 't', 'T', 'g', 'G', 's', 'S', 'C', 'j', 'J'];

/**
 * What a key of the idle question does, worked out as `org-clock-resolve` and `org-clock-resolve-clock` do. Times are milliseconds.
 * @param {{ key: string, idleStart: number, now: number, clockStart: number, keepMinutes?: number | null, gotBackMinutes?: number | null }} input
 *   `keepMinutes` is what `k`/`K`/`t`/`T` keep of the idle time (default: all of it); `gotBackMinutes` is for `g`/`G`
 * @returns {{ type: 'none' } | { type: 'jump', clockOutNow: boolean } | { type: 'cancel', clockInNow: boolean } | { type: 'now', clockOut: boolean } | { type: 'at', clockOutAt: number, clockInAt: number | null }}
 *   `clockInAt: null` means clocked out and left that way (an upper-case key); `clockInAt` equal to `now` means clock in now
 */
export function resolveIdleClock({ key, idleStart, now, clockStart, keepMinutes = null, gotBackMinutes = null }) {
  if (!RESOLVE_KEYS.includes(key) || key === 'i') return { type: 'none' };
  if (key === 'j' || key === 'J') return { type: 'jump', clockOutNow: key === 'J' };
  const closed = 'KGST'.includes(key); // `close` in Org: C cancels, it does not close
  const defaultMinutes = Math.floor((now - idleStart) / 60000);
  const subtract = key === 's' || key === 'S';
  const startOver = subtract && idleStart - clockStart < 45000; // barely started: Org throws the clock away
  const keep = key === 'k' || key === 'K' || key === 't' || key === 'T' ? (keepMinutes ?? defaultMinutes) : null;
  const gotBack = key === 'g' || key === 'G' ? (gotBackMinutes ?? defaultMinutes) : null;
  if (key === 'C' || startOver) return { type: 'cancel', clockInNow: startOver && !'KGSC'.includes(key) };
  /** @type {number | 'now'} */
  let resolveTo;
  if (subtract || gotBack === 0) resolveTo = idleStart;
  else if (keep === defaultMinutes || gotBack === defaultMinutes) resolveTo = 'now';
  else if (keep !== null) resolveTo = idleStart + keep * 60000;
  else resolveTo = now - /** @type {number} */ (gotBack) * 60000;
  if (resolveTo === 'now') return { type: 'now', clockOut: closed };
  const clockOutAt = gotBack !== null ? idleStart : resolveTo;
  return { type: 'at', clockOutAt, clockInAt: closed ? null : gotBack !== null ? resolveTo : now };
}
