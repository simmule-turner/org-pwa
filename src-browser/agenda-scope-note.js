// @ts-check
// The line under an agenda view's title that says what the view reads: the restriction (Emacs's `<` or its lock), or that there are no
// agenda files, as Emacs says when org-agenda-files is empty.
import { S } from './app-state.js';
import { activeAgendaRestriction, agendaRestriction, describeRestriction, restrictionHere } from './agenda-files.js';
import { render } from './render.js';
import { setStatus } from './editing.js';

/** @returns {HTMLElement | null} null when the view reads the agenda files and there are some */
export function agendaScopeNote() {
  const restriction = activeAgendaRestriction();
  if (!restriction && S.agendaFilesConfig.length > 0) return null;
  const note = document.createElement('div');
  note.setAttribute('data-agenda-scope', restriction ? 'restricted' : 'none');
  note.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;margin:0 0 10px;';
  const text = document.createElement('span');
  const button = document.createElement('button');
  button.style.cssText = 'height:34px;padding:0 14px;display:inline-flex;align-items:center;justify-content:center;';
  if (restriction) {
    text.textContent = `Restricted to ${describeRestriction(restriction)}`;
    button.textContent = 'Clear';
    button.onclick = () => {
      agendaRestriction.pending = null;
      agendaRestriction.lock = null;
      render();
    };
  } else {
    text.textContent = 'No agenda files. Set org-agenda-files, or restrict with < in Agenda commands.';
  }
  note.append(text);
  if (restriction) note.append(button);
  return note;
}

/** Emacs's `C-c C-x <`: every agenda command looks at the subtree at point (the focused heading, else the narrowed one), or at this
 *  file when there is none. Done again while locked, it lifts the lock. */
export function lockAgenda() {
  if (agendaRestriction.lock) return unlockAgenda();
  const restriction = restrictionHere(true) || restrictionHere(false);
  if (!restriction) return;
  agendaRestriction.lock = restriction;
  setStatus(`Agenda commands are locked to ${describeRestriction(restriction)}.`);
  render();
}

/** Emacs's `C-c C-x >`: lifts the lock, and what `<` chose. */
export function unlockAgenda() {
  agendaRestriction.lock = null;
  agendaRestriction.pending = null;
  setStatus('Agenda commands read the agenda files again.');
  render();
}
