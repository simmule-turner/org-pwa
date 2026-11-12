// @ts-check
// The Agenda's log-mode keys, as Emacs binds them in the agenda buffer: `l` toggles the log (org-agenda-log-mode), `C-u l` shows
// everything (LogAll: closed, clock and state), `C-u C-u l` shows only log entries (Only), and `v c` toggles the clock-issue check
// (ClkCk). They set the same choice as the Log select in the Agenda's header.
import { S } from './app-state.js';
import { commandViewHasAgenda } from './command-view.js';
import { setStatus } from './editing.js';
import { render } from './render.js';
import { logModeName } from '../src/agenda-log.js';

const NAMES = { off: 'Log mode off', on: 'Log', all: 'LogAll', only: 'Log only', clockcheck: 'ClkCk' };

/** @param {'off' | 'on' | 'all' | 'only' | 'clockcheck'} name */
function choose(name) {
  S.agendaLogMode = name === 'off' ? false : name === 'on' ? true : name === 'all' ? ['closed', 'clock', 'state'] : name;
  setStatus(NAMES[name]);
  render();
}

/** True while the Agenda itself (not the TODO list or a search) is showing, or a command screen with the Agenda's days. */
export const agendaShowing = () => S.currentView === 'agenda' || (S.currentView === 'command' && commandViewHasAgenda());

/** `l`, with the number of C-u presses before it: none toggles, one is LogAll, two is Only. @param {number} [universal] */
export function agendaLogKey(universal = 0) {
  if (!agendaShowing()) return false;
  if (universal >= 2) choose('only');
  else if (universal === 1) choose('all');
  else choose(logModeName(S.state.localVariables, S.agendaLogMode) === 'off' ? 'on' : 'off');
  return true;
}

/** `v c`: ClkCk on, or off when it already is on. */
export function agendaClockcheckKey() {
  if (!agendaShowing()) return false;
  choose(logModeName(S.state.localVariables, S.agendaLogMode) === 'clockcheck' ? 'off' : 'clockcheck');
  return true;
}

/** Hardware-keyboard state: the C-u presses so far, and whether `v` is waiting for its `c`. */
const typed = { universal: 0, v: false };

/**
 * The plain keys (and Ctrl+U) of a hardware keyboard while the Agenda shows. Returns whether the key was used.
 * @param {KeyboardEvent} e
 */
export function handleAgendaLogKey(e) {
  if (!agendaShowing() || e.altKey || e.metaKey) return false;
  if (e.ctrlKey) {
    if (e.key !== 'u') return false;
    e.preventDefault();
    typed.universal += 1;
    typed.v = false;
    setStatus(typed.universal > 1 ? 'C-u C-u-' : 'C-u-');
    return true;
  }
  const { universal, v } = typed;
  typed.universal = 0;
  typed.v = false;
  if (v && e.key === 'c') {
    e.preventDefault();
    return agendaClockcheckKey();
  }
  if (e.key === 'l') {
    e.preventDefault();
    return agendaLogKey(universal);
  }
  if (e.key === 'v') {
    e.preventDefault();
    typed.v = true;
    setStatus('v-');
    return true;
  }
  return false;
}
