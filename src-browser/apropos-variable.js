// @ts-check
// apropos-variable: asks for a word, a list of words or a regexp in the minibuffer and lists the matching variables in a buffer named
// *Apropos*. The variables are the ones with a place in Settings and the ones set in the Global Variables or in this file's Local
// Variables, each with its description and its value now.
import { aproposVariable, printedValue } from '../src/apropos-variable.js';
import { createNewUnsavedDocument } from './documents-io.js';
import { setStatus } from './editing.js';
import { readFromMinibuffer } from './minibuffer-prompt.js';
import { QUICK_SETTINGS_FIELDS } from './settings-fields.js';
import { S } from './app-state.js';
import { switchToView } from './views.js';

/** @returns {import('../src/apropos-variable.js').VariableEntry[]} */
function variableEntries() {
  const set = { ...(S.globalVariables || {}), ...(S.state.localVariables || {}) };
  /** @type {Map<string, import('../src/apropos-variable.js').VariableEntry>} */
  const byName = new Map();
  for (const f of QUICK_SETTINGS_FIELDS) {
    const value = set[f.key] !== undefined ? printedValue(String(set[f.key])) : f.default === undefined ? 'nil' : String(f.default);
    byName.set(f.key, { name: f.key, doc: f.label, value });
  }
  for (const [name, raw] of Object.entries(set)) if (!byName.has(name)) byName.set(name, { name, doc: '', value: printedValue(String(raw)) });
  return [...byName.values()];
}

export async function aproposVariableCommand() {
  const pattern = await readFromMinibuffer('Apropos variable (word list or regexp): ', '');
  if (pattern === null) return setStatus('Quit');
  if (!pattern.trim()) return setStatus('No apropos matches for `\'');
  const result = aproposVariable(pattern, variableEntries());
  if (!result.ok) return setStatus(result.message);
  await createNewUnsavedDocument(result.text, 'Matching variables in *Apropos*.', '*Apropos*');
  switchToView('text'); // a list of lines, not an outline
}
