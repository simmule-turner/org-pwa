// @ts-check
// The pure part of the settings history: which settings it follows, how a change is named, and what undoing to a step has to write.
// A step is the whole set of followed settings as JSON text (the same snapshot idea as the document's undo history).
import { pushSnapshot } from './undo-history.js';

export const MAX_SETTINGS_STEPS = 100;

/** Stored under these names but not part of the history: logins and their passphrase marker, what was open last, and window layout. */
export const HISTORY_EXCLUDED = Object.freeze(['github', 'webdav', 'caldav', 'connectionProtection', 'lastActiveDocument', 'openTabs', 'recentFiles', 'bufferNames', 'fileScreenType', 'floatingKeyboardPos']);

/** @type {Readonly<Record<string, string>>} */
export const SETTING_LABELS = Object.freeze({
  appt: 'Appointment reminders',
  attachLink: 'Attachment links',
  theme: 'Theme',
  customThemeColors: 'Theme colors',
  fontFamily: 'Font',
  fontSize: 'Font size',
  tablesFontSize: 'Table font size',
  menuSize: 'Menu size',
  paragraphSpacing: 'Paragraph spacing',
  tablesSpacing: 'Table spacing',
  readingWidth: 'Reading width',
  settingsOrder: 'Settings order',
  sidePanelWidth: 'Side panel width',
  captureTemplates: 'Capture templates',
  globalVariables: 'Variables',
});

/** The followed settings only, in a stable order.
 * @param {Record<string, unknown>} settings
 * @returns {Record<string, unknown>} */
export function followedSettings(settings) {
  /** @type {Record<string, unknown>} */ const out = {};
  for (const name of Object.keys(settings).sort()) if (!HISTORY_EXCLUDED.includes(name)) out[name] = settings[name];
  return out;
}

/** @param {Record<string, unknown>} settings */
export function snapshotText(settings) {
  return JSON.stringify(followedSettings(settings));
}

/** Names whose value differs between two snapshots.
 * @param {string} beforeText
 * @param {string} afterText
 * @returns {string[]} */
export function changedNames(beforeText, afterText) {
  const a = JSON.parse(beforeText);
  const b = JSON.parse(afterText);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter((n) => JSON.stringify(a[n]) !== JSON.stringify(b[n]));
}

/** A short name for a step: "Theme", or "Theme and 2 more settings".
 * @param {string[]} names */
export function labelForChange(names) {
  if (names.length === 0) return 'No change';
  const first = SETTING_LABELS[names[0]] || names[0];
  return names.length === 1 ? first : `${first} and ${names.length - 1} more setting${names.length === 2 ? '' : 's'}`;
}

/** What to write to go from the settings as they are now to a step.
 * @param {Record<string, unknown>} live
 * @param {string} targetText
 * @returns {{ set: Record<string, unknown>, remove: string[], names: string[] }} */
export function planRestore(live, targetText) {
  const names = changedNames(snapshotText(live), targetText);
  const target = JSON.parse(targetText);
  /** @type {Record<string, unknown>} */ const set = {};
  /** @type {string[]} */ const remove = [];
  for (const n of names) {
    if (n in target) set[n] = target[n];
    else remove.push(n);
  }
  return { set, remove, names };
}

/** pushSnapshot, keeping at most MAX_SETTINGS_STEPS entries (the oldest go first).
 * @param {import('./undo-history.js').UndoHistory} history
 * @param {string} text
 * @param {string} label */
export function pushCapped(history, text, label, now = new Date()) {
  const next = pushSnapshot(history, text, label, now);
  if (next === history || next.entries.length <= MAX_SETTINGS_STEPS) return next;
  const drop = next.entries.length - MAX_SETTINGS_STEPS;
  return { entries: next.entries.slice(drop), index: next.index - drop };
}
