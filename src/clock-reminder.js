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

/** org-clock-sound: 'none' for nil / unset, 'beep' for t, and 'file' for a file name (the app can only beep, as Emacs does when the file is missing).
 * @param {string | undefined} raw
 * @returns {'none' | 'beep' | 'file'} */
export function soundKind(raw) {
  const text = String(raw == null ? '' : raw).trim().replace(/^"|"$/g, '');
  if (text === '' || text === 'nil') return 'none';
  return text === 't' ? 'beep' : 'file';
}

/** The sentence over the idle question, in Org's words. @param {number} idleMinutes */
export function idlePrompt(idleMinutes) {
  return `Clocked in & idle for ${(Math.round(idleMinutes * 10) / 10).toFixed(1)} mins`;
}
