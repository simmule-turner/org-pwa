// @ts-check
// Where an `elisp:(customize-variable ...)` link wants Settings to go: to a setting's field (key), or to Global Variables with a
// `(setq ...)` line ready to add (line). Read by the Settings screen when it draws, and cleared once used.

export const settingsFocus = { key: /** @type {string | null} */ (null), card: /** @type {string | null} */ (null), line: /** @type {string | null} */ (null) };

/** The line to add to Global Variables, once. @returns {string | null} */
export function takePrefill() {
  const line = settingsFocus.line;
  settingsFocus.line = null;
  return line;
}
