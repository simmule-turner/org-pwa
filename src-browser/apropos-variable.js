// @ts-check
// apropos-variable: asks for a word, a list of words or a regexp in the minibuffer and lists the matching variables in a buffer named
// *Apropos*. The variables are the ones with a place in Settings and the ones set in the Global Variables or in this file's Local
// Variables, each with its description and its value now.
import { aproposVariable } from '../src/apropos-variable.js';
import { createNewUnsavedDocument } from './documents-io.js';
import { setStatus } from './editing.js';
import { readFromMinibuffer } from './minibuffer-prompt.js';
import { variableEntries } from './variable-entries.js';

export async function aproposVariableCommand() {
  const pattern = await readFromMinibuffer('Apropos variable (word list or regexp): ', '');
  if (pattern === null) return setStatus('Quit');
  if (!pattern.trim()) return setStatus('No apropos matches for `\'');
  const result = aproposVariable(pattern, variableEntries());
  if (!result.ok) return setStatus(result.message);
  await createNewUnsavedDocument(result.text, 'Matching variables in *Apropos*.', '*Apropos*');
}
