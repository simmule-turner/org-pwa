// @ts-check
// The templates Capture offers: those (setq org-capture-templates ...) defines in the Lisp init text.
import { captureTemplatesFromLisp } from '../src/capture-lisp.js';
import { lispStringValue } from '../src/export-defaults.js';
import { S } from './app-state.js';
import { initText } from './lisp-init-text.js';

/** What the last call left out or ignored, for the status line. @type {string[]} */
export let captureLispNotes = [];

/** The Lisp init's capture templates; an empty list when it defines none.
 * @returns {Promise<import('../src/types.js').CaptureTemplate[]>} */
export async function getAllCaptureTemplates() {
  const raw = (S.globalVariables || {})['org-xx-lisp-init'];
  const own = lispStringValue(raw) || (typeof raw === 'string' ? raw : '');
  // the init with its (load ...) files in, as last read on this device; the setting's own text when that has not been made from this one yet
  if (initText.raw === own) await initText.ready;
  const text = initText.raw === own ? initText.text : own;
  if (!/org-capture-templates/.test(text)) {
    captureLispNotes = [];
    return [];
  }
  const { templates, notes } = captureTemplatesFromLisp(text);
  captureLispNotes = notes;
  return templates;
}
