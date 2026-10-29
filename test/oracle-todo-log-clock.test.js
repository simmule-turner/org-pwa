// Holds the app to Emacs 29.3 for TODO cycling, logging on a change of state, priorities, clocking, durations, scheduling and
// clock tables. test/fixtures/oracle-todo-log-clock.json was made by tools/gen-oracle-todo-log-clock.mjs (cases in
// tools/oracle-tlc-cases.mjs). A case listed in KNOWN_DEVIATIONS differs from Emacs for the reason given; the test fails when such a
// case starts to match, so the list only ever shrinks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { getClosedKeepWhenNoTodo, parseLocalVariables } from '../src/local-variables.js';
import { readLogSettings } from '../src/log-settings.js';
import { resolveTodoSequence, resolveTodoSequences, findSequenceForHeading, cycleTodoState, setTodoState } from '../src/todo-cycle.js';
import { applyTransitionEffects, writePendingNote } from '../src/todo-transition.js';
import { findAncestorPath } from '../src/archive-model.js';
import { nextPriority, readPriorityRange, prioritiesKeyword, priorityInRange } from '../src/priorities.js';
import { clockIn, clockOut, clockCancel, clockInSwitchingTasks } from '../src/clock.js';
import { readClockSettings, clockOutSwitchState } from '../src/clock-settings.js';
import { formatOrgTimestamp } from '../src/org-timestamp.js';
import { parseOrgDuration } from '../src/org-duration.js';
import { rescheduleTimestamp, setPlanningField } from '../src/reschedule.js';
import { buildClockReport, ClockReportError } from '../src/clock-report.js';
import { formatClockDuration } from '../src/clock.js';
import { KNOWN_DEVIATIONS } from './support/oracle-tlc-known.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-todo-log-clock.json', import.meta.url), 'utf8'));
/** @typedef {{ kind: string, name: string, org: string, emacs: string, [k: string]: any }} Case */

const GLOBAL = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };
// Emacs re-aligns a heading's tags to org-tags-column when it rewrites the line; the app keeps their spacing
const squeezeTags = (/** @type {string} */ t) => t.trimEnd().replace(/^(\*+ .*?\S)[ \t]{2,}(:[^\s:]+(?::[^\s:]+)*:)[ \t]*$/gm, '$1 $2');
const norm = (/** @type {string} */ t) => squeezeTags(String(t).replace(/[‘’]/g, "'"));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const stamp = (/** @type {Date} */ d, withDay = true) => formatOrgTimestamp({ date: d, time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, active: false, withDay });
const at = (/** @type {string} */ s, plus = 0) => {
  const [d, t] = s.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(y, mo - 1, da, h, mi + plus);
};

/** @param {import('../src/types.js').Heading[]} nodes @param {string} title @returns {import('../src/types.js').Heading | undefined} */
function findHeading(nodes, title) {
  for (const n of nodes) {
    if (n.title === title) return n;
    const f = findHeading(n.children, title);
    if (f) return f;
  }
  return undefined;
}

/** @param {Case} c */
function runCycle(c) {
  const doc = parseOrg(c.org);
  const heading = doc.children[0];
  const sequences = resolveTodoSequences(doc, GLOBAL);
  for (let i = 0; i < c.times; i++) cycleTodoState(heading, findSequenceForHeading(sequences, heading), { direction: c.dir === 'left' ? 'backward' : 'forward' });
  return serializeOrg(doc).split('\n').find((l) => /^\*+ /.test(l)) || '';
}

/** @param {Case} c */
function runLog(c) {
  const doc = parseOrg(c.org);
  const heading = /** @type {import('../src/types.js').Heading} */ (c.find ? findHeading(doc.children, c.find) : doc.children[0]);
  const sequence = resolveTodoSequence(doc, GLOBAL);
  const from = heading.todo;
  if (c.to === '') heading.todo = null;
  else setTodoState(heading, c.to, sequence);
  const path = [...(findAncestorPath(doc, heading) || []), heading];
  const settings = readLogSettings(doc, parseLocalVariables(serializeOrg(doc)), c.vars || {}, path);
  const pending = applyTransitionEffects(heading, from, sequence, { settings, keepWhenNoTodo: getClosedKeepWhenNoTodo({}), now: at(oracle.now.replace(' ', 'T').slice(0, 16).replace('T', ' ')) });
  if (pending && c.note !== null) writePendingNote(pending, c.note, settings);
  return serializeOrg(doc);
}

/** @param {Case} c */
function runPriority(c) {
  const doc = parseOrg(c.org);
  const heading = doc.children[0];
  const range = readPriorityRange(prioritiesKeyword(c.org));
  if (c.op === 'set') {
    const cookie = String(c.char);
    if (!priorityInRange(cookie, range)) return 'ERROR';
    heading.priority = cookie.toUpperCase();
  } else if (c.op === 'remove') heading.priority = null;
  else for (let i = 0; i < c.times; i++) heading.priority = nextPriority(heading.priority, range, c.op, c.startDefault);
  return serializeOrg(doc);
}

/** @param {Case} c */
function runClock(c) {
  const doc = parseOrg(c.org);
  const heading = /** @type {import('../src/types.js').Heading} */ (findHeading(doc.children, 'Task') || doc.children[0]);
  const path = [...(findAncestorPath(doc, heading) || []), heading];
  const vars = {
    ...(c.drawer !== undefined ? { 'org-clock-into-drawer': c.drawer } : {}),
    ...(c.logDrawer !== undefined ? { 'org-log-into-drawer': String(c.logDrawer) === 'true' ? 't' : String(c.logDrawer) } : {}),
    ...(c.removeZero ? { 'org-clock-out-remove-zero-time-clocks': 't' } : {}),
    ...(c.switchTo !== undefined ? { 'org-clock-out-switch-to-state': c.switchTo } : {}),
  };
  const settings = readClockSettings(doc, parseLocalVariables(serializeOrg(doc)), vars, path);
  const start = at(c.start);
  clockIn(heading, stamp(start), settings);
  if (c.cancel) clockCancel(heading);
  else if (c.span !== null) {
    const end = at(c.start, c.span);
    clockOut(heading, stamp(end), end, settings);
    const sequence = resolveTodoSequence(doc, GLOBAL);
    const target = clockOutSwitchState(heading, settings.switchTo);
    if (target) {
      const from = heading.todo;
      setTodoState(heading, target, sequence);
      const logSettings = readLogSettings(doc, parseLocalVariables(serializeOrg(doc)), {}, path);
      applyTransitionEffects(heading, from, sequence, { settings: logSettings, keepWhenNoTodo: getClosedKeepWhenNoTodo({}), now: at('2026-10-11 16:30'), inhibitLogging: true });
    }
  }
  return serializeOrg(doc);
}

/** @param {Case} c */
function runClockSwitch(c) {
  const doc = parseOrg(c.org);
  const start = at(c.start);
  clockInSwitchingTasks(doc, doc.children[0], stamp(start), start);
  const next = at('2026-10-11 16:30'); // the new clock starts "now", and the old one stops then
  clockInSwitchingTasks(doc, doc.children[1], stamp(next), next);
  return serializeOrg(doc);
}

/** @param {Case} c */
function runPlanning(c) {
  const doc = parseOrg(c.org);
  const heading = doc.children[0];
  const field = c.which === 'SCHEDULED' ? 'scheduled' : 'deadline';
  const [d, t] = c.pick.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const dt = new Date(y, mo - 1, da);
  const picked = `<${d} ${DAYS[dt.getDay()]}${t ? ' ' + t : ''}>`;
  setPlanningField(heading, field, rescheduleTimestamp(heading.planning[field], picked));
  return serializeOrg(doc);
}

/** @param {Case} c */
function runClocktable(c) {
  const doc = parseOrg(c.ctOrg);
  /** @param {import('../src/types.js').Heading[]} nodes @returns {import('../src/types.js').Heading | null} */
  const last = (nodes) => (nodes.length ? last(nodes[nodes.length - 1].children || []) || nodes[nodes.length - 1] : null); // the block sits in the last heading
  const files = [{ name: 'ct.org', path: '/tmp/ct/ct.org', doc }];
  if (c.ctOrg2 !== undefined) files.push({ name: 'other.org', path: '/tmp/ct/other.org', doc: parseOrg(c.ctOrg2) });
  try {
    return buildClockReport({ files, params: c.params, now: at('2026-10-11 16:30'), origin: last(doc.children) }).trimEnd();
  } catch (e) {
    if (!(e instanceof ClockReportError)) throw e;
    return `#+BEGIN: clocktable ${c.params}\n${e.blankLine ? '\n' : ''}#+END:`; // Org reports the problem and leaves the block empty
  }
}

/** @param {Case} c */
function runDurationToMinutes(c) {
  const v = parseOrgDuration(c.text);
  return v === null || Number.isNaN(v) ? 'ERROR' : String(v);
}

/** @param {string} emacs */
const emacsNumber = (emacs) => (emacs.startsWith('ERROR') ? 'ERROR' : String(Number(emacs)));

/** @type {Record<string, (c: Case) => string>} */
const RUNNERS = {
  cycle: runCycle,
  log: runLog,
  priority: runPriority,
  clock: runClock,
  clockswitch: runClockSwitch,
  planning: runPlanning,
  clocktable: runClocktable,
  'duration-to-minutes': runDurationToMinutes,
  'duration-from-minutes': (c) => formatClockDuration(c.minutes),
};

/** @param {Case} c @param {string} got */
function expected(c, got) {
  switch (c.kind) {
    case 'cycle': return [norm(got), norm(c.emacs.split('\n').find((l) => /^\*+ /.test(l)) || '')];
    case 'priority': return [got === 'ERROR' ? got : norm(got), c.emacs.startsWith('ERROR') ? 'ERROR' : norm(c.emacs)];
    case 'duration-to-minutes': return [got, emacsNumber(c.emacs)];
    case 'clocktable': {
      // the #+BEGIN line is the author's own parameters, which the app does not echo; the table below it is the result
      const body = (/** @type {string} */ t) => t.replace(/Clock summary at \[[^\]]*\]/, 'Clock summary at [X]').replace(/^#\+BEGIN:.*\n/, '').replace(/file:[^:\]]*::/g, 'file:F::');
      return [norm(body(got)), norm(body(c.emacs))];
    }
    default: return c.emacs.startsWith('ERROR') ? [got.startsWith('ERROR') ? 'ERROR' : norm(got), 'ERROR'] : [norm(got), norm(c.emacs)];
  }
}

test(`the app does what Emacs does: ${oracle.cases.length} cases`, () => {
  const saved = process.env.TZ;
  process.env.TZ = oracle.tz;
  try {
    /** @type {Record<string, { total: number, bad: string[] }>} */
    const summary = {};
    const unexpected = [];
    /** @type {Record<string, { total: number, differ: number }>} */
    const tally = {};
    for (const c of /** @type {Case[]} */ (oracle.cases)) {
      const run = RUNNERS[c.kind];
      if (!run) continue;
      let got;
      try {
        got = run(c);
      } catch (e) {
        got = 'ERROR ' + (/** @type {Error} */ (e).message);
      }
      const [a, b] = expected(c, got);
      const known = KNOWN_DEVIATIONS.find((d) => d.matches(c));
      (summary[c.kind] ||= { total: 0, bad: [] }).total++;
      if (known) {
        const t = (tally[known.id] ||= { total: 0, differ: 0 });
        t.total++;
        if (a !== b) t.differ++;
      }
      if (a === b) continue;
      if (known) summary[c.kind].bad.push(c.name);
      else unexpected.push(`${c.name}\n--- Emacs\n${b}\n--- app\n${a}`);
    }
    if (process.env.TLC_REPORT) {
      for (const [k, s] of Object.entries(summary)) console.log(k, s.total, 'cases;', s.bad.length, 'known deviations');
      console.log(unexpected.length, 'unexpected');
    }
    const stale = KNOWN_DEVIATIONS.filter((d) => !tally[d.id] || tally[d.id].differ === 0).map((d) => d.id);
    assert.deepEqual(stale, [], 'deviations that no longer differ from Emacs: drop them from test/support/oracle-tlc-known.js');
    assert.equal(unexpected.length, 0, `${unexpected.length} differ from Emacs; first:\n${unexpected.slice(0, 3).join('\n=====\n')}`);
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

if (process.env.TLC_DUMP) {
  // node test/oracle-todo-log-clock.test.js with TLC_DUMP=1 writes every difference to scratch/tlc-diffs.json for triage
  const saved = process.env.TZ;
  process.env.TZ = oracle.tz;
  const diffs = [];
  for (const c of /** @type {Case[]} */ (oracle.cases)) {
    const run = RUNNERS[c.kind];
    if (!run) continue;
    let got;
    try { got = run(c); } catch (e) { got = 'ERROR ' + (/** @type {Error} */ (e).message); }
    const [a, b] = expected(c, got);
    if (a !== b) diffs.push({ kind: c.kind, name: c.name, org: c.org, emacs: b, app: a });
  }
  fs.writeFileSync(process.env.TLC_DUMP, JSON.stringify(diffs, null, 1));
  process.env.TZ = saved;
}
