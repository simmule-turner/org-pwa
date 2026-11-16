// @ts-check
// Agenda keys that act on the row or the days: `j` (org-agenda-goto-date), `J` (org-agenda-clock-goto), `$` (org-agenda-archive) and
// `C-k` (org-agenda-kill).
import { serializeHeadingSubtree } from '../src/org-parser.js';
import { removeHeading } from '../src/heading-edit.js';
import { parseSpan, readStartOnWeekday, startingDayForSpan } from '../src/agenda-span.js';
import { readDate, readDateSettings } from '../src/read-date.js';
import { S } from './app-state.js';
import { canChangeItem } from './agenda-actions.js';
import { focusedAgendaItem } from './agenda-row-focus.js';
import { archiveHeadingToLocation } from './archive-flow.js';
import { clockGoto, findRunningClockAcrossSessions } from './clock-flow.js';
import { commitAndRender, setStatus } from './editing.js';
import { readFromMinibuffer, readKeyFromMinibuffer } from './minibuffer-prompt.js';
import { render } from './render.js';

/** The focused row's heading, when it can be changed; otherwise says why not. @returns {import('../src/types.js').Heading | null} */
function changeableHeading() {
  const item = focusedAgendaItem();
  if (!item || !item.heading) {
    setStatus('Command not allowed in this line');
    return null;
  }
  if (!canChangeItem(item)) {
    setStatus(S.isBufferReadOnly ? 'This buffer is read-only.' : 'Open this file to change it.');
    return null;
  }
  return item.heading;
}

/** `j` (org-agenda-goto-date): shows the days from a date, in the span the Agenda has. */
export async function agendaGotoDate() {
  const now = new Date();
  const settings = readDateSettings(S.state.localVariables);
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  S.godModeActive = false;
  const answer = await readFromMinibuffer(`Date+time [${day}]: `);
  if (answer === null) return setStatus('Quit');
  const date = readDate(answer, { now, preferFuture: settings.preferFuture, extendTodayUntil: settings.extendTodayUntil }).date;
  S.agendaAnchorDate = startingDayForSpan(date, parseSpan(S.agendaViewType) ?? 'week', readStartOnWeekday(S.state.localVariables));
  render();
}

/** `J` (org-agenda-clock-goto). */
export function agendaClockGoto() {
  if (!findRunningClockAcrossSessions()) return setStatus("No running clock, use `C-c C-x C-j' to jump to the most recent one");
  clockGoto();
}

/** `$` (org-agenda-archive): archives the entry of the row. */
export function agendaArchive() {
  const heading = changeableHeading();
  if (heading) archiveHeadingToLocation(heading);
}

/** `C-k` (org-agenda-kill): deletes the entry of the row, after a question when it has more than one line (org-agenda-confirm-kill). */
export async function agendaKill() {
  const heading = changeableHeading();
  if (!heading) return;
  const lines = serializeHeadingSubtree(heading).split('\n').filter((l) => /\S/.test(l)).length;
  if (lines > 1) {
    S.godModeActive = false;
    const name = (S.state.documentId || '').split('/').pop();
    const key = await readKeyFromMinibuffer(`Delete entry with ${lines} lines in buffer "${name}"? (y or n) `, 'ynq');
    if (key !== 'y') return setStatus('Abort');
  }
  removeHeading(S.state.doc, heading);
  commitAndRender('Agenda item and source killed');
  setStatus('Agenda item and source killed');
}
