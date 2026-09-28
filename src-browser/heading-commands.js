// Extracted from app.js: heading commands.
import { deleteProperty, getProperty, setProperty } from '../src/archive-model.js';
import { getAllowedEffortValues } from '../src/effort-values.js';
import { setPriority } from '../src/heading-edit.js';
import { getGlobalProperties } from '../src/local-variables.js';
import { parseOrgDuration } from '../src/org-duration.js';
import { S } from './app-state.js';
import { openTextFieldPopup } from './dialogs.js';
import { commitAndRender, setStatus } from './editing.js';
import { render } from './render.js';

/** Cycles a heading's own priority through None -> A -> B -> C -> None
 *  -- god-mode's own "C-c ," (real org's own priority prompt,
 *  simplified to a fixed cycle matching this app's own existing
 *  general-editor priority row, which only offers A/B/C/None too). */
export function cyclePriorityFor(heading) {
  if (!heading) return;
  const order = [null, 'A', 'B', 'C'];
  const currentIndex = order.indexOf(heading.priority);
  const next = order[(Math.max(currentIndex, 0) + 1) % order.length];
  setPriority(heading, next);
  commitAndRender(next ? `Priority set to ${next}` : 'Priority cleared');
}

/** Prompts for a heading's EFFORT estimate as free text, like real
 *  org's own org-set-effort prompt; blank clears it. Any org-duration
 *  form is accepted (see src/org-duration.js) and stored exactly as
 *  typed, as Emacs does. Anything else is refused with a status message
 *  and the existing value is left untouched. */
export function openEffortEditor(heading) {
  if (!heading) return;
  if (S.isBufferReadOnly) {
    setStatus('Buffer is read-only.');
    return;
  }
  const overlay = openTextFieldPopup({
    label: 'Effort estimate (e.g. 1:30, 2h, 1d 3h; blank to clear)',
    value: getProperty(heading, 'EFFORT') || '',
    placeholder: '1:30',
    resetInPlace: true,
    // Effort_ALL, when one is defined for this heading (see src/effort-values.js)
    choices: getAllowedEffortValues({ doc: S.state.doc, heading, globalProperties: getGlobalProperties(S.state.localVariables) }),
    onSave: (raw) => {
      const value = String(raw).trim();
      if (value === '') {
        deleteProperty(heading, 'EFFORT');
        commitAndRender('Effort cleared');
      } else if (parseOrgDuration(value) !== null) {
        setProperty(heading, 'EFFORT', value);
        commitAndRender(`Effort set to ${value}`);
      } else {
        setStatus('Not a valid duration (try 1:30, 2h, or 1d 3h) -- effort not changed.');
        render();
      }
    },
  });
  const ta = overlay.querySelector('textarea');
  if (ta) ta.rows = 2;
}
