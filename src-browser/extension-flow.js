// The init script: load it, answer its diary functions, report how it is doing.
import { deleteProperty, setProperty } from '../src/archive-model.js';
import { commitLines } from '../src/body-edit.js';
import { agendaOccurrences, normalizeAgendaItems, normalizeLine } from '../src/extensions.js';
import { checkLinkOpenUrl, normalizeExport, usableLinkPrefix } from '../src/extension-net.js';
import { recalculateTable, setUserTableFunctions, isBuiltinFormulaName, parseTableConstants } from '../src/table-formula.js';
import { getOrgTableDurationHourZeroPadding } from '../src/local-variables.js';
import { links } from './extension-links.js';
import { saveOut } from './save-out.js';
import { applyEdits, snapshotDocument, snapshotStillMatches, validateEdits } from '../src/extension-edit.js';
import { onExtensionEvent } from './extension-events.js';
import { EDIT_EVENTS, extensionsOn, hashScript, userSexpKey, userSexpResult, visibleVariableMap, usableSexpName } from '../src/extensions.js';
import { getCalendarLatitude, getCalendarLongitude } from '../src/local-variables.js';
import { setUserSexps } from '../src/sexp-eval.js';
import { S } from './app-state.js';
import { createServices, scriptOwner } from './extension-services.js';
import { startExtension } from './extension-run.js';
import { commitAndRender, setStatus } from './editing.js';
import { render } from './render.js';
import { kv } from './singletons.js';
import { applyTodoTransition } from './todo-workflow.js';
import { getExtensionApproval, getExtensionFile, getExtensionScript, setExtensionApproval, setExtensionFile, setExtensionScript } from './settings.js';
import { readScriptFromFile } from './extension-file.js';

const MAX_SCRIPT_CHARS = 64 * 1024;
const MAX_CACHED = 5000;
const MAX_LOG = 40;

/** What Settings shows. `state` is one of: off, empty, unapproved, running, failed. */
const info = { state: 'off', message: '', sexps: [], commands: [], events: [], tableFunctions: [], linkTypes: [], exporters: [], agendaSources: [], uiLines: [], log: [], script: '', hash: '', file: '', fileError: '' };

const cache = new Map();
const agendaCache = new Map(); // `${source}|${from}|${to}` -> { items, at }
const agendaPending = new Set();
const lineCache = new Map(); // id -> { text, at }
const linePending = new Set();
const SOURCE_TTL_MS = 10 * 60 * 1000;
const LINE_TTL_MS = 5 * 60 * 1000;
const tableCache = new Map(); // JSON [name, args] -> { v } for the table functions answered during one recalculation
/** The running script and its queue. Private to this module; the app-wide state stays on S. */
const run = { pending: new Map(), flushTimer: null, handle: null, commandBusy: false, applying: false, chain: Promise.resolve() };

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
  info.events = [];
  info.tableFunctions = [];
  info.linkTypes = [];
  info.exporters = [];
  info.agendaSources = [];
  info.uiLines = [];
  agendaCache.clear();
  agendaPending.clear();
  lineCache.clear();
  linePending.clear();
  tableCache.clear();
  links.prefixes = new Set();
  links.open = null;
  setUserTableFunctions();
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
  info.file = await getExtensionFile(kv);
  info.fileError = '';
  info.script = await getExtensionScript(kv);
  if (info.file && extensionsOn(S.globalVariables)) {
    // The script is the tangled text of a document the person named; nothing else is ever read.
    try {
      info.script = await readScriptFromFile(info.file);
    } catch (err) {
      info.script = '';
      info.fileError = err.message;
    }
  }
  info.hash = info.script ? await hashScript(info.script) : '';
  info.message = '';
  if (!extensionsOn(S.globalVariables)) {
    info.state = 'off';
    return;
  }
  if (info.fileError) {
    info.state = 'failed';
    info.message = info.fileError;
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
  const started = await startExtension({ code: info.script, onRpc: createServices({ owner: scriptOwner(info.hash) }), variables: visibleVariableMap(S.globalVariables, S.state && S.state.localVariables) });
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
  info.events = started.events || [];
  setUserSexps(names, answer);
  info.tableFunctions = (started.tableFunctions || []).filter((n) => usableSexpName(n) && !isBuiltinFormulaName(n));
  for (const refused of (started.tableFunctions || []).filter((n) => !info.tableFunctions.includes(n))) note(`org.tableFunction("${refused}") ignored: use letters, digits and dashes, and not the name of a standard function`);
  setUserTableFunctions(info.tableFunctions);
  info.linkTypes = (started.linkTypes || []).filter(usableLinkPrefix);
  for (const refused of (started.linkTypes || []).filter((n) => !info.linkTypes.includes(n))) note(`org.linkType("${refused}") ignored: use 2 to 20 lowercase letters, digits and dashes, and not a standard link type`);
  links.prefixes = new Set(info.linkTypes);
  links.open = openCustomLink;
  info.exporters = started.exporters || [];
  info.agendaSources = started.agendaSources || [];
  info.uiLines = started.uiLines || [];
  render();
}

/** A click on [[prefix:path]]: the script's link function answers with an address, which is checked and opened. */
async function openCustomLink(prefix, path, target, description) {
  const active = run.handle;
  if (!active) return;
  try {
    const reply = await active.resolveLink(prefix, path, target, description);
    for (const line of reply.logs || []) note(line);
    if (reply.error) throw new Error(reply.error);
    if (!reply.url) {
      setStatus(`${prefix}: the script gave no address for ${path}.`);
      return;
    }
    window.open(checkLinkOpenUrl(reply.url), '_blank', 'noopener,noreferrer');
  } catch (err) {
    note(`${prefix}: ${err.message}`);
    setStatus(`Link failed: ${err.message}`);
    if (run.handle === active && /took longer/.test(err.message)) {
      info.state = 'failed';
      info.message = err.message;
      stop();
      render();
    }
  }
}

export const tableFunctionsActive = () => !!run.handle && info.tableFunctions.length > 0;

/** The answer to a table function during a recalculation: what the script already gave, or an error. */
export function tableUserCall(name, args) {
  const hit = tableCache.get(JSON.stringify([name, args]));
  if (!hit || hit.v === null) throw new Error(`${name} gave no answer`);
  return hit.v;
}

/** Before tables are recalculated: finds the script-function calls their formulas make and gets the answers
 *  from the script, so the (synchronous) recalculation can use them. Nested calls take another round. */
export async function warmTableFunctions(tables) {
  const active = run.handle;
  if (!active || !info.tableFunctions.length) return;
  tableCache.clear();
  const mine = tables.filter((t) => t.tblfm && info.tableFunctions.some((n) => t.tblfm.includes(n + '(')));
  const options = { hourZeroPad: getOrgTableDurationHourZeroPadding(S.state.localVariables), constants: parseTableConstants(S.state.doc) };
  let total = 0;
  for (let pass = 0; pass < 3 && mine.length; pass++) {
    const misses = new Map();
    const userCall = (name, args) => {
      const key = JSON.stringify([name, args]);
      if (tableCache.has(key)) return tableCache.get(key).v ?? Number.NaN;
      misses.set(key, { name, args });
      return 0;
    };
    for (const table of mine) {
      try {
        recalculateTable(table, { ...options, userCall });
      } catch (e) {
        /* reported when the real recalculation runs */
      }
    }
    if (!misses.size) break;
    const byName = new Map();
    for (const [key, item] of misses) {
      if (!byName.has(item.name)) byName.set(item.name, []);
      byName.get(item.name).push({ key, args: item.args });
    }
    for (const [name, items] of byName) {
      total += items.length;
      if (total > 500) throw new Error('A table calls script functions more than 500 times');
      try {
        const reply = await active.callTable(name, items.map((i) => i.args));
        if (run.handle !== active) return;
        items.forEach((item, i) => tableCache.set(item.key, { v: reply.results[i] ?? null }));
        if (reply.error) note(`${name}: ${reply.error}`);
        for (const line of reply.logs || []) note(line);
      } catch (err) {
        note(err.message);
        if (run.handle === active) {
          info.state = 'failed';
          info.message = err.message;
          stop();
          render();
        }
        return;
      }
    }
  }
}

/** Runs one of the script's export backends on the open file and saves what it returns. */
export async function runExtensionExport(id, target) {
  const backend = info.exporters.find((x) => x.id === id);
  const active = run.handle;
  if (!backend || !active || !S.state.doc) {
    setStatus('That export is not available.');
    return;
  }
  const documentName = String((S.state.documentId || '').split('/').pop() || '');
  const snapshot = snapshotDocument(S.state.doc, { name: documentName, focusedHeading: target || S.keyboardFocusedHeading || null });
  setStatus(`Exporting with ${backend.label}\u2026`);
  try {
    const reply = await active.runExport(id, snapshot);
    for (const line of reply.logs || []) note(line);
    if (reply.error) throw new Error(reply.error);
    const out = normalizeExport(reply.output, (documentName.replace(/\.[^.]*$/, '') || 'export') + '.txt');
    saveOut(out.filename, out.text, out.mime);
    setStatus(`Exported ${out.filename}.`);
  } catch (err) {
    note(`${backend.label}: ${err.message}`);
    setStatus(`Export failed: ${err.message}`);
    if (run.handle === active && /took longer/.test(err.message)) {
      info.state = 'failed';
      info.message = err.message;
      stop();
      render();
    }
  }
}

/** Saves the script text. It must be approved again before it runs. */
export async function saveExtensionScript(text) {
  if (text.length > MAX_SCRIPT_CHARS) throw new Error(`The script is longer than ${MAX_SCRIPT_CHARS / 1024} KB`);
  await setExtensionScript(kv, text);
  await setExtensionApproval(kv, '');
  await loadExtensions();
}

/** Names the saved document the script is tangled from ('' goes back to the text typed in Settings). It must be approved again. */
export async function saveExtensionFile(text) {
  await setExtensionFile(kv, String(text || '').trim());
  await setExtensionApproval(kv, '');
  await loadExtensions();
}

/** The user approves the script exactly as it is now, and it starts. */
export async function approveExtensionScript() {
  // What the person saw in Settings is what is approved; if the file changed since, the next load asks again.
  const script = info.file ? info.script : await getExtensionScript(kv);
  await setExtensionApproval(kv, await hashScript(script));
  await loadExtensions();
}

/** The script's commands as palette entries. */
export function extensionPaletteEntries() {
  const exports = info.exporters.map((x) => ({
    id: 'ext-export-' + x.id,
    label: 'Export: ' + x.label,
    group: 'Extensions',
    keywords: ['script', 'extension', 'export'],
    needs: ['doc'],
    run: (target) => runExtensionExport(x.id, target),
  }));
  return exports.concat(info.commands.map((c) => ({
    id: 'ext-' + c.id,
    label: c.label,
    group: 'Extensions',
    keywords: ['script', 'extension'],
    needs: ['doc'],
    run: (target) => runExtensionCommand(c.id, target),
  })));
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
  finishReply(command.label, snapshot, reply, true);
}

/** Handles a script's answer to a command or an event: logs, then checks and applies its edits as one undo step. */
function finishReply(label, snapshot, reply, allowEdits) {
  for (const line of reply.logs || []) note(line);
  if (reply.error) {
    note(`${label}: ${reply.error}`);
    setStatus(`${label} failed: ${reply.error}`);
    return;
  }
  const edits = reply.edits || [];
  if (edits.length && !allowEdits) {
    note(`${label}: its edits were ignored (this event cannot change the file)`);
  } else if (edits.length) {
    const problem = validateEdits(edits, snapshot.headings.length);
    if (problem) {
      setStatus(`${label}: ${problem}. Nothing was changed.`);
      return;
    }
    if (S.isBufferReadOnly) {
      setStatus(`${label}: the buffer is read-only, so nothing was changed.`);
      return;
    }
    if (!snapshotStillMatches(S.state.doc, snapshot)) {
      setStatus(`${label}: the document changed while it ran, so nothing was changed.`);
      return;
    }
    run.applying = true; // the changes a script makes do not set off its own hooks again
    try {
      applyEdits(S.state.doc, edits, {
        setTodo: (heading, todo) => applyTodoTransition(heading, () => { heading.todo = todo; }),
        setProperty,
        deleteProperty,
        appendBody,
      });
      commitAndRender(`Script: ${label}`);
    } finally {
      run.applying = false;
    }
  }
  const applied = edits.length && allowEdits ? edits.length : 0;
  setStatus(reply.message || (reply.notices || []).join(' \u00b7 ') || (applied ? `${label}: ${applied} ${applied === 1 ? 'change' : 'changes'}.` : `${label}: done.`));
}

/** Delivers an event to the script's hooks, one at a time and after the app has finished handling it. */
async function deliverEvent(name, payload, doc) {
  const active = run.handle;
  if (!active || S.state.doc !== doc) return;
  await new Promise((resolve) => setTimeout(resolve, 30)); // let the change that caused the event finish drawing
  if (run.handle !== active || S.state.doc !== doc) return;
  const snapshot = snapshotDocument(doc, { name: String((S.state.documentId || '').split('/').pop() || ''), focusedHeading: payload.heading || null });
  const plain = {};
  for (const [k, v] of Object.entries(payload)) if (k !== 'heading' && (v === null || ['string', 'number', 'boolean'].includes(typeof v))) plain[k] = v;
  let reply;
  try {
    reply = await active.runEvent(name, snapshot, plain);
  } catch (err) {
    if (run.handle === active) {
      info.state = 'failed';
      info.message = err.message;
      note(err.message);
      stop();
      setStatus(err.message);
      render();
    }
    return;
  }
  if (run.handle !== active || S.state.doc !== doc) return;
  if (reply.error || (reply.edits || []).length || (reply.notices || []).length) finishReply(`Script hook ${name}`, snapshot, reply, EDIT_EVENTS.has(name));
  else for (const line of reply.logs || []) note(line);
}

onExtensionEvent((name, payload) => {
  if (!run.handle || run.applying || !info.events.includes(name)) return;
  const doc = S.state.doc;
  run.chain = run.chain.then(() => deliverEvent(name, payload, doc)).catch((err) => note(err.message));
});

// ---- agenda sources and header lines ----------------------------------------------------------------------

async function refreshAgendaSource(name, from, to, key) {
  const active = run.handle;
  agendaPending.add(key);
  const before = agendaCache.get(key);
  let items = before ? before.items : [];
  try {
    const reply = await active.fetchAgenda(name, from, to);
    if (run.handle !== active) return;
    for (const line of reply.logs || []) note(line);
    if (reply.error) note(`${name}: ${reply.error}`);
    else items = normalizeAgendaItems(reply.items);
  } catch (err) {
    note(err.message);
    if (run.handle === active) {
      info.state = 'failed';
      info.message = err.message;
      stop();
      render();
    }
    return;
  }
  agendaPending.delete(key);
  agendaCache.set(key, { items, at: Date.now() });
  if (!before || JSON.stringify(before.items) !== JSON.stringify(items)) render();
}

const AGENDA_HEADING = { title: '', level: 1, todo: null, priority: null, tags: [], bodyLines: [], children: [] };

/** Agenda items from the script's sources for the days being shown. What is already known is returned at once; a source
 *  that is missing or older than ten minutes is asked again, and the agenda is drawn again if its answer differs. */
export function extensionAgendaItems(rangeStart, rangeEnd) {
  if (!run.handle || !info.agendaSources.length) return [];
  const from = dayKey(rangeStart);
  const to = dayKey(rangeEnd);
  const out = [];
  for (const name of info.agendaSources) {
    const key = `${name}|${from}|${to}`;
    const entry = agendaCache.get(key);
    if ((!entry || Date.now() - entry.at > SOURCE_TTL_MS) && !agendaPending.has(key)) refreshAgendaSource(name, from, to, key);
    if (!entry) continue;
    for (const item of entry.items) {
      for (const day of agendaOccurrences(item, from, to)) {
        const [y, m, d] = day.split('-').map(Number);
        const [h, mi] = item.time ? item.time.split(':').map(Number) : [0, 0];
        const endParts = item.endTime ? item.endTime.split(':').map(Number) : null;
        out.push({
          documentId: '',
          heading: { ...AGENDA_HEADING, title: item.title },
          kind: 'timestamp',
          hasTime: !!item.time,
          repeater: null,
          todo: null,
          priority: null,
          tags: [],
          title: item.title,
          date: new Date(y, m - 1, d, h, mi),
          endDate: endParts ? new Date(y, m - 1, d, endParts[0], endParts[1]) : undefined,
          daysOverdue: 0,
          category: name,
          external: true,
        });
      }
    }
  }
  return out;
}

async function refreshLine(id) {
  const active = run.handle;
  linePending.add(id);
  const before = lineCache.get(id);
  let text = before ? before.text : null;
  try {
    const reply = await active.fetchLine(id);
    if (run.handle !== active) return;
    for (const line of reply.logs || []) note(line);
    if (reply.error) note(`${id}: ${reply.error}`);
    else text = normalizeLine(reply.text);
  } catch (err) {
    note(err.message);
    if (run.handle === active) {
      info.state = 'failed';
      info.message = err.message;
      stop();
      render();
    }
    return;
  }
  linePending.delete(id);
  lineCache.set(id, { text, at: Date.now() });
  if (!before || before.text !== text) render();
}

/** The script's header lines for the agenda (plain text), asked again when older than five minutes. */
export function extensionAgendaLines() {
  if (!run.handle || !info.uiLines.length) return [];
  const out = [];
  for (const id of info.uiLines) {
    const entry = lineCache.get(id);
    if ((!entry || Date.now() - entry.at > LINE_TTL_MS) && !linePending.has(id)) refreshLine(id);
    if (entry && entry.text) out.push(entry.text);
  }
  return out;
}
