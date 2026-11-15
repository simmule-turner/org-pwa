// @ts-check
/**
 * The Org Babel variables that more than one module reads, as one settings object: `org-babel-min-lines-for-block-output`,
 * `org-babel-inline-result-wrap`, `org-babel-results-keyword`, `org-babel-uppercase-example-markers`, `org-src-preserve-indentation`,
 * `org-coderef-label-format` and `org-confirm-babel-evaluate`. `setBabelOptions(vars)` reads them from the effective variables
 * (see src/local-variables.js); the app calls it before it runs, tangles or exports blocks, a test calls it with the values it wants.
 */
import { babelOptionsFrom } from './local-variables.js';

/** @typedef {{ minLines: number, inlineWrap: string, resultsKeyword: string, uppercaseMarkers: boolean, preserveIndentation: boolean, coderefFormat: string, confirm: boolean }} BabelOptions */

/** Emacs 29.3's defaults. @returns {BabelOptions} */
export const defaultBabelOptions = () => ({ minLines: 10, inlineWrap: '=%s=', resultsKeyword: 'RESULTS', uppercaseMarkers: false, preserveIndentation: false, coderefFormat: '(ref:%s)', confirm: true });

/** The settings in force. */
export const babelOptions = defaultBabelOptions();

/** Reads the settings from variables (`{ name: text }`); a variable that is not set has Emacs's default. @param {Record<string, any> | null | undefined} vars */
export function setBabelOptions(vars) {
  Object.assign(babelOptions, defaultBabelOptions(), babelOptionsFrom(vars || {}));
}
