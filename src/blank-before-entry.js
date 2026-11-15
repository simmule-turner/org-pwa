// @ts-check
/**
 * `org-blank-before-new-entry`: an alist whose `heading` and `plain-list-item` entries say whether a new heading or list item gets an
 * empty line before it: `t` always, `nil` never, `auto` as the surrounding entries do. Held here, set from the merged variables
 * (global-variables.js), as the indentation settings are. An entry the alist leaves out is `nil`, as `(assq ...)` gives it in Org.
 */

/** @typedef {'auto' | 't' | 'nil'} BlankSetting */

const state = { heading: /** @type {BlankSetting} */ ('auto'), item: /** @type {BlankSetting} */ ('auto') };

/** @param {string} text @param {string} key @returns {BlankSetting} */
function entry(text, key) {
  const m = new RegExp(`\\(\\s*${key}\\s*\\.\\s*(auto|t|nil)\\s*\\)`).exec(text);
  return m ? /** @type {BlankSetting} */ (m[1]) : 'nil';
}

/** @param {Record<string, unknown> | null | undefined} vars @returns {{ heading: BlankSetting, item: BlankSetting }} */
export function blankBeforeNewEntryOf(vars) {
  const raw = vars ? vars['org-blank-before-new-entry'] : undefined;
  if (raw === undefined || raw === null || String(raw).trim() === '') return { heading: 'auto', item: 'auto' };
  const text = String(raw);
  return { heading: entry(text, 'heading'), item: entry(text, 'plain-list-item') };
}

/** @param {{ heading: BlankSetting, item: BlankSetting }} value */
export function setBlankBeforeNewEntry(value) {
  state.heading = value.heading;
  state.item = value.item;
}

/**
 * Whether an empty line goes before a new heading (`kind` heading) or a new list item: the setting when it is `t` or `nil`, else what `auto` decides.
 * @param {'heading' | 'item'} kind @param {() => boolean} auto
 */
export function blankBeforeNew(kind, auto) {
  const setting = state[kind];
  return setting === 'auto' ? auto() : setting === 't';
}

/** The setting itself, for a caller whose `auto` is a long computation. @param {'heading' | 'item'} kind @returns {BlankSetting} */
export function blankSetting(kind) {
  return state[kind];
}
