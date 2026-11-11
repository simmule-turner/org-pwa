// @ts-check
// Every variable the app knows, with its value now: the index that apropos-variable, the Settings search and the elisp: link read.
import { buildVariableIndex } from '../src/variable-index.js';
import { S } from './app-state.js';
import { SETTINGS_FIELDS } from './settings-fields.js';

/** The open file's own value of a variable wins over the Global Variables. */
export function variableEntries() {
  return buildVariableIndex(SETTINGS_FIELDS, { ...(S.globalVariables || {}), ...(S.state.localVariables || {}) });
}
