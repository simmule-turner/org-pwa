// @ts-check
// The Org Babel variables (src/babel-options.js) as the document in view has them: the app's global variables with the file's own on top,
// except org-confirm-babel-evaluate, which a file may not change for itself.
import { babelOptions, setBabelOptions } from '../src/babel-options.js';
import { babelOptionsFrom } from '../src/local-variables.js';
import { S } from './app-state.js';

/** Reads the variables in force into `babelOptions`; call before running, exporting or listing blocks. */
export function syncBabelOptions() {
  setBabelOptions({ ...(S.globalVariables || {}), ...((S.state && S.state.localVariables) || {}) });
  babelOptions.confirm = babelOptionsFrom(S.globalVariables || {}).confirm ?? true;
}
