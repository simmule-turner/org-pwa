// @ts-check
/** @typedef {import('../src/types.js').Heading} Heading */
// How clocking writes to the document for one heading, from the settings (see src/clock-settings.js).
import { findAncestorPath } from '../src/archive-model.js';
import { readClockSettings } from '../src/clock-settings.js';
import { parseLocalVariables } from '../src/local-variables.js';
import { serializeOrg } from '../src/org-parser.js';
import { S } from './app-state.js';

/** @param {Heading} heading @param {import('../src/types.js').Doc | null} [inDoc] the document the heading is in (the open one by default) */
export function clockSettingsFor(heading, inDoc = S.state.doc) {
  const doc = inDoc;
  if (!doc) return { into: true, logDrawer: null, removeZero: false, switchTo: null };
  const path = [...(findAncestorPath(doc, heading) || []), heading];
  return readClockSettings(doc, parseLocalVariables(serializeOrg(doc)), S.globalVariables, path);
}
