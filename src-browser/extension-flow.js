// The init script: load it, answer its diary functions, report how it is doing.
import { deleteProperty, setProperty } from '../src/archive-model.js';
import { commitLines } from '../src/body-edit.js';
import { applyEdits, snapshotDocument, snapshotStillMatches, validateEdits } from '../src/extension-edit.js';
import { extensionsOn, hashScript, userSexpKey, userSexpResult, visibleVariableMap, usableSexpName } from '../src/extensions.js';
import { getCalendarLatitude, getCalendarLongitude } from '../src/local-variables.js';
import { setUserSexps } from '../src/sexp-eval.js';
import { S } from './app-state.js';
import { startExtension } from './extension-run.js';
import { commitAndRender, setStatus } from './editing.js';
import { render } from './render.js';
import { kv } from './singletons.js';
import { applyTodoTransition } from './todo-workflow.js';
import { getExtensionApproval, getExtensionScript, setExtensionApproval, setExtensionScript } from './settings.js';

const MAX_SCRIPT_CHARS = 64 * 1024;
const MAX_CACHED = 5000;
const MAX_LOG = 40;

/** What Settings shows. `state` is one of: off, empty, unapproved, running, failed. */
const info = { state: 'off', message: '', sexps: [], commands: [], log: [], script: '', hash: '' };

const cache = new Map();
/** The running script and its queue. Private to this module; the app-wide state stays on S. */
const run = { pending: new Map(), flushTimer: null, handle: null, commandBusy: false };

export function extensionInfo() {
  return { ...info, sexps: info.sexps.slice(), commands: info.commands.map((c) => ({ ...c })), log: info.log.slice() };
}

function note(line) {
  info.log.push(String(line).slice(0, 300));
  if (info.log.length > MAX_LOG) info.log.splice(0, info.log.length - MAX_LOG);
}

function stop() {
  clearTimeout(run.flushTimer);
  run.flushTimer = null;
  run.pending = new Map();
  cache.clear();
  if (run.handle) run.handle.close();
  run.handle = null;
  info.sexps = [];
  info.commands = [];
  run.commandBusy = false;
  setUserSexps();
}

const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function context() {
  const vars = S.state && S.state.localVariables ? S.state.localVariables : S.globalVariables;
  const lat = getCalendarLatitude(vars);
  const lon = getCalendarLongitude(vars);
  return { today: dayKey(new Date()), calendarLatitude: Number.isFinite(lat) ? lat : null, calendarLongitude: Number.isFinite(lon) ? lon : null };
}

/** Answers the agenda for one function and day from the cache. A miss is "no entry" for now: it is queued,
 *  fetched in one batch, and the page is drawn again when the answers arrive. */
function answer(name, args, date) {
  const key = userSexpKey(name, args, dayKey(date));
  if (cache.has(key)) return cache.get(key);
  run.pending.set(key, { name, args, day: dayKey(date) });
  if (!run.flushTimer) run.flushTimer = setTimeout(flush, 30);
  return false;
}

async function flush() {
  run.flushTimer = null;
  const batch = run.pending;
  run.pending = new Map();
  const active = run.handle;
  if (!active || batch.size === 0) return;
  const groups = new Map();
  for (const item of batch.values()) {
    const g = JSON.stringify([item.name, item.args]);
    if (!groups.has(g)) groups.set(g, { name: item.name, args: item.args, days: [] });
    groups.get(g).days.push(item.day);
  }
  for (const group of groups.values()) {
    try {
      const reply = await active.call(group.name, context(), group.args, group.days);
      if (run.handle !== active) return; // stopped or reloaded while waiting
      if (cache.size > MAX_CACHED) cache.clear();
      group.days.forEach((day, i) => cache.set(userSexpKey(group.name, group.args, day), userSexpResult(reply.results[i])));
      if (reply.error) note(`${group.name}: ${reply.error}`);
      for (const line of reply.logs || []) note(line);
      render(); // each function's days appear as soon as they are known
    } catch (err) {
      if (run.handle !== active) return; // another batch already stopped the script; its message is the one that names the cause
      group.days.forEach((day) => cache.set(userSexpKey(group.name, group.args, day), false));
      note(err.message);
      info.state = 'failed';
      info.message = err.message;
      stop();
      break;
    }
  }
  render();
}

/** Starts the script if extensions are on and this exact text was approved here. Safe to call again. */
export async function loadExtensions() {
  stop();
  info.script = await getExtensionScript(kv);
  info.hash = info.script ? await hashScript(info.script) : '';
  info.message = '';
  if (!extensionsOn(S.globalVariables)) {
    info.state = 'off';
    return;
  }
  if (!info.script.trim()) {
    info.state = 'empty';
    return;
  }
  if ((await getExtensionApproval(kv)) !== info.hash) {
    info.state = 'unapproved';
    return;
  }
  const started = await startExtension({ code: info.script, variables: visibleVariableMap(S.globalVariables, S.state && S.state.localVariables) });
  for (const line of started.logs || []) note(line);
  if (!started.ok) {
    info.state = 'failed';
    info.message = started.message;
    note(started.message);
    return;
  }
  const names = started.sexps.filter(usableSexpName);
  for (const refused of started.sexps.filter((n) => !usableSexpName(n))) note(`org.sexp("${refused}") ignored: use letters, digits and dashes, and not the name of a standard form`);
  run.handle = started;
  info.state = 'running';
  info.sexps = names;
  info.commands = started.commands || [];
  setUserSexps(names, answer);
  render();
}

/** Saves the script text. It must be approved again before it runs. */
export async function saveExtensionScript(text) {
  if (text.length > MAX_SCRIPT_CHARS) throw new Error(`The script is longer than ${MAX_SCRIPT_CHARS / 1024} KB`);
  await setExtensionScript(kv, text);
  await setExtensionApproval(kv, '');
  await loadExtensions();
}

/** The user approves the script exactly as it is now, and it starts. */
export async function approveExtensionScript() {
  const script = await getExtensionScript(kv);
  await setExtensionApproval(kv, await hashScript(script));
  await loadExtensions();
}

/** The script's commands as palette entries. */
export function extensionPaletteEntries() {
  return info.commands.map((c) => ({
    id: 'ext-' + c.id,
    label: c.label,
    group: 'Extensions',
    keywords: ['script', 'extension'],
    needs: ['doc'],
    run: (target) => runExtensionCommand(c.id, target),
  }));
}

const appendBody = (heading, lines) => commitLines(heading, (heading.bodyLines || []).length, 0, lines);

/** Runs one of the script's commands on the open file. The command sees a read-only snapshot and answers with
 *  edits; they are checked, then applied together as a single undo step. */
export async function runExtensionCommand(id, target) {
  const command = info.commands.find((c) => c.id === id);
  const active = run.handle;
  if (!command || !active || !S.state.doc) {
    setStatus('That script command is not available.');
    return;
  }
  if (run.commandBusy) {
    setStatus('Another script command is still running.');
    return;
  }
  const documentName = String((S.state.documentId || '').split('/').pop() || '');
  const snapshot = snapshotDocument(S.state.doc, { name: documentName, focusedHeading: target || S.keyboardFocusedHeading || null });
  run.commandBusy = true;
  setStatus(`Running ${command.label}\u2026`);
  let reply;
  try {
    reply = await active.runCommand(id, snapshot);
  } catch (err) {
    if (run.handle === active) {
      info.state = 'failed';
      info.message = err.message;
      note(err.message);
      stop();
    }
    setStatus(err.message);
    render();
    return;
  } finally {
    if (run.handle === active) run.commandBusy = false;
  }
  for (const line of reply.logs || []) note(line);
  if (reply.error) {
    note(`${command.label}: ${reply.error}`);
    setStatus(`${command.label} failed: ${reply.error}`);
    return;
  }
  const edits = reply.edits || [];
  if (edits.length) {
    const problem = validateEdits(edits, snapshot.headings.length);
    if (problem) {
      setStatus(`${command.label}: ${problem}. Nothing was changed.`);
      return;
    }
    if (S.isBufferReadOnly) {
      setStatus(`${command.label}: the buffer is read-only, so nothing was changed.`);
      return;
    }
    if (!snapshotStillMatches(S.state.doc, snapshot)) {
      setStatus(`${command.label}: the document changed while it ran, so nothing was changed.`);
      return;
    }
    applyEdits(S.state.doc, edits, {
      setTodo: (heading, todo) => applyTodoTransition(heading, () => { heading.todo = todo; }),
      setProperty,
      deleteProperty,
      appendBody,
    });
    commitAndRender(`Script: ${command.label}`);
  }
  const say = reply.message || (reply.notices || []).join(' \u00b7 ') || (edits.length ? `${command.label}: ${edits.length} ${edits.length === 1 ? 'change' : 'changes'}.` : `${command.label}: done.`);
  setStatus(say);
}
