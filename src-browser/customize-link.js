// @ts-check
// Following `[[elisp:(customize-variable 'NAME)]]` (customize-variable): Settings opens at the setting's field, highlighted; a variable
// with no control opens Global Variables with a `(setq NAME VALUE)` line ready to add.
import { parseElispLink } from '../src/elisp-link.js';
import { S } from './app-state.js';
import { variableEntries } from './variable-entries.js';
import { settingsBtn } from './dom.js';
import { setStatus } from './editing.js';
import { settingsFocus } from './settings-focus.js';
import { renderSettingsView } from './settings-view.js';

/** The value of a `(setq ...)` line for a printed value: itself when it reads as Lisp, a quoted symbol or list, else nil.
 * @param {string} value */
export function setqValue(value) {
  if (/^(t|nil|-?\d+(\.\d+)?|"[^"]*")$/.test(value)) return value;
  if (/^[a-z][\w-]*$/i.test(value)) return `'${value}`;
  if (value.startsWith('(') && !value.includes('...')) return `'${value}`;
  return 'nil';
}

/** @param {string} target  the link target, `elisp:(...)` */
export async function followElispLink(target) {
  const entries = variableEntries();
  const parsed = parseElispLink(target, (name) => entries.some((e) => e.name === name));
  if (!parsed.ok) {
    setStatus(parsed.message);
    return;
  }
  const entry = /** @type {import('../src/variable-index.js').VariableEntry} */ (entries.find((e) => e.name === parsed.name));
  settingsFocus.key = entry.control === 'field' ? entry.name : null;
  settingsFocus.line = entry.control === 'field' ? null : `(setq ${entry.name} ${setqValue(entry.value)})`;
  if (S.settingsOpen) await renderSettingsView();
  else settingsBtn.click();
}
