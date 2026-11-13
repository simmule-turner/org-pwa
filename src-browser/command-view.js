// @ts-check
// A custom command (org-agenda-custom-commands) as a screen of the Agenda: each block of a composite command, a stuck-projects command, or
// an `agenda` command with settings, one under the other, with its heading and live rows (change a state, set a priority, jump to the
// heading, as in the Agenda). What each block shows comes from src/agenda-buffer.js, which is held to Emacs's *Org Agenda* text; an
// `agenda` block is the Agenda's own days, drawn with the command's settings as Emacs lets them over the variables for that block.
import { readAgendaSpan, readAgendaStartDay, spanKey } from '../src/agenda-span.js';
import { blockPlan } from '../src/agenda-buffer.js';
import { agendaScopeDocs, agendaSearchDocs, commandFilesDocs, commandScope, ensureAgendaFilesLoaded, loadCommandFiles } from './agenda-files.js';
import { renderAgendaView, buildHeadingRow, prefixFailure, prefixFailureNote } from './agenda-view.js';
import { seedAgendaDefaults } from './agenda-seed.js';
import { S } from './app-state.js';
import { outlineEl } from './dom.js';
import { setStatus } from './editing.js';
import { queryOptions } from './query-options.js';
import { render } from './render.js';
import { switchToView } from './views.js';

/** @typedef {import('../src/agenda-commands.js').CustomCommand} CustomCommand */

/** The blocks of a command: its own for a composite command, else the command itself. @param {CustomCommand} c */
export const blocksOf = (c) => (c.type === 'block' ? c.blocks || [] : [c]);

/** Whether the screen shows days of the Agenda (an `agenda` block), which is what the log keys and the span buttons act on. */
export function commandViewHasAgenda() {
  const c = S.commandView && S.commandView.command;
  return !!c && blocksOf(c).some((b) => b.type === 'agenda');
}

/**
 * Opens a command: the files it names are read first, and the Agenda's own span and day are set aside for the screen (and given back
 * when it is left, see leaveCommandView).
 * @param {CustomCommand} c
 */
export async function openCommandView(c) {
  const named = [c, ...(c.blocks || [])].map((x) => (x.settings || {})['org-agenda-files']).filter((v) => v !== undefined);
  const problems = await loadCommandFiles(named);
  if (problems.length) setStatus(problems.join(' '));
  const saved = S.commandView ? S.commandView.saved : { viewType: S.agendaViewType, anchor: S.agendaAnchorDate, applied: S.agendaInitialSpanApplied };
  // org-agenda-span and org-agenda-start-day of the command (or its agenda block) start the days it shows
  const own = { ...(S.state.localVariables || {}), ...(c.type === 'block' ? c.settings || {} : {}), ...((blocksOf(c).find((b) => b.type === 'agenda') || c).settings || {}) };
  S.agendaViewType = spanKey(readAgendaSpan(own));
  S.agendaAnchorDate = readAgendaStartDay(own, new Date()) ?? new Date();
  S.agendaInitialSpanApplied = true;
  S.commandView = { command: c, saved };
  if (S.currentView === 'command') render();
  else switchToView('command');
}

/**
 * The days of an `agenda` block, drawn with the settings the block runs under and the files it names.
 * @param {HTMLElement} host @param {import('../src/agenda-buffer.js').AgendaPlan} plan
 */
function drawAgendaBlock(host, plan) {
  const saved = S.state.localVariables;
  S.state.localVariables = plan.vars;
  commandScope.docs = plan.docs;
  try {
    renderAgendaView(host);
  } finally {
    S.state.localVariables = saved;
    commandScope.docs = null;
  }
}

/** Draws the screen of the open command. */
export function renderCommandView() {
  seedAgendaDefaults();
  ensureAgendaFilesLoaded();
  const command = S.commandView && S.commandView.command;
  outlineEl.innerHTML = '';
  const container = document.createElement('div');
  container.style.padding = '8px 12px';
  outlineEl.appendChild(container);
  if (!command) {
    switchToView('agenda');
    return;
  }
  const title = document.createElement('h2');
  title.textContent = command.description || command.key;
  title.setAttribute('data-command-title', '');
  title.style.cssText = 'margin:4px 0 10px;font-size:20px;font-weight:700;';
  container.appendChild(title);
  const ctx = { docs: agendaScopeDocs(), searchDocs: agendaSearchDocs(), options: { ...queryOptions(), now: new Date() }, filesDocs: commandFilesDocs };
  const inherited = command.type === 'block' ? command.settings || {} : {};
  const today = new Date();
  blocksOf(command).forEach((block, i) => {
    if (i > 0) {
      const rule = document.createElement('hr');
      rule.style.cssText = 'margin:16px 0;border:0;border-top:2px solid var(--border-strong);';
      container.appendChild(rule);
    }
    const host = document.createElement('div');
    host.setAttribute('data-command-block', block.type);
    container.appendChild(host);
    const plan = blockPlan(block, inherited, command.type !== 'block', ctx);
    if (plan.agenda) return drawAgendaBlock(host, plan);
    /** @param {string} text @param {string} css */
    const line = (text, css) => {
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText = css;
      host.appendChild(el);
    };
    if (plan.heading !== '') line(plan.heading, 'font-weight:700;margin:6px 0;');
    if (plan.hint !== '') line(plan.hint, 'font-size:12px;opacity:0.65;margin-bottom:6px;line-height:1.4;');
    const failure = prefixFailure(plan.items, plan.view);
    if (failure) return void host.appendChild(prefixFailureNote(failure));
    if (plan.items.length === 0) return line('Nothing here.', 'font-size:13px;opacity:0.65;padding:6px 2px;');
    for (const item of plan.items) host.appendChild(buildHeadingRow(item, today, plan.view));
  });
}
