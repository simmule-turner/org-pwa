// @ts-check
// The templates Capture offers: the JSON ones from Settings → Capture Templates, plus any written as
// (setq org-capture-templates ...) in the Lisp init text. A Lisp template replaces a JSON one with the same key.
import { captureTemplatesFromLisp, mergeCaptureTemplates } from '../src/capture-lisp.js';
import { lispStringValue } from '../src/export-defaults.js';
import { S } from './app-state.js';
import { getCaptureTemplates } from './settings.js';
import { initText } from './lisp-init-text.js';

/** What the last call left out or ignored, for the status line. @type {string[]} */
export let captureLispNotes = [];

/** @param {import('../src/types.js').KvAdapter} kvAdapter */
export async function getAllCaptureTemplates(kvAdapter) {
  const json = await getCaptureTemplates(kvAdapter);
  const raw = (S.globalVariables || {})['org-xx-lisp-init'];
  const own = lispStringValue(raw) || (typeof raw === 'string' ? raw : '');
  // the init with its (load ...) files in, as last read on this device; the setting's own text when that has not been made from this one yet
  if (initText.raw === own) await initText.ready;
  const text = initText.raw === own ? initText.text : own;
  if (!/org-capture-templates/.test(text)) {
    captureLispNotes = [];
    return json;
  }
  const { templates, notes } = captureTemplatesFromLisp(text);
  captureLispNotes = notes;
  return mergeCaptureTemplates(json, templates);
}
