// @ts-check
/**
 * `org-adapt-indentation` (nil, t or headline-data) and `org-auto-align-tags` (t or nil): what the structure commands, planning lines,
 * property drawers and logbook drawers do about indentation and tags. Held here, set from the merged variables (global-variables.js),
 * as the tags column is.
 */

/** @typedef {'nil' | 't' | 'headline-data'} AdaptIndentation */

const state = { adapt: /** @type {AdaptIndentation} */ ('nil'), align: true, preserve: false };

/** @param {Record<string, unknown> | null | undefined} vars @returns {AdaptIndentation} */
export function adaptIndentationOf(vars) {
  const raw = vars ? vars['org-adapt-indentation'] : undefined;
  if (raw === undefined || raw === null) return 'nil';
  const text = String(raw).trim().replace(/^'/, '');
  if (text === 't' || text === 'true') return 't';
  if (text === 'headline-data') return 'headline-data';
  return 'nil';
}

/** @param {Record<string, unknown> | null | undefined} vars */
export function autoAlignTagsOf(vars) {
  const raw = vars ? vars['org-auto-align-tags'] : undefined;
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  const text = String(raw).trim();
  return !(text === 'nil' || text === 'false');
}

/** @param {AdaptIndentation} value */
export function setAdaptIndentation(value) {
  state.adapt = value;
}

export function getAdaptIndentation() {
  return state.adapt;
}

/** @param {boolean} value */
export function setAutoAlignTags(value) {
  state.align = value;
}

export function getAutoAlignTags() {
  return state.align;
}

/** @param {Record<string, unknown> | null | undefined} vars */
export function srcPreserveIndentationOf(vars) {
  const raw = vars ? vars['org-src-preserve-indentation'] : undefined;
  return raw !== undefined && raw !== null && !['', 'nil', 'false'].includes(String(raw).trim());
}

/** @param {boolean} value */
export function setSrcPreserveIndentation(value) {
  state.preserve = value;
}

export function getSrcPreserveIndentation() {
  return state.preserve;
}
