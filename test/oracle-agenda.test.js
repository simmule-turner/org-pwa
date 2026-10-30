// Holds the agenda to Emacs 29.3 over a wide corpus: test/fixtures/oracle-agenda.json was made by tools/gen-oracle-agenda.mjs from
// tools/oracle-agenda-cases.mjs. Each scenario is a day, week or month of the agenda over a document of about 370 headings (planning
// lines, times, ranges, repeaters, warnings, delays, states, priorities, archived and commented trees) under some settings; Emacs
// gives the rows it shows for every day, in order. Today is 2026-10-11 16:30, New York time.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { buildAgendaItems, buildTaskList, itemsForDate } from '../src/agenda.js';
import { sortAgendaItems, strategyFor } from '../src/agenda-sort.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';
import { DOCS } from '../tools/oracle-agenda-cases.mjs';
import { getHabitOptions } from '../src/local-variables.js';
import { readTodoListSettings } from '../src/agenda-todo-list.js';
import { readDaySettings } from '../src/agenda-emacs-days.js';
import { parseSpan, readAgendaStartDay, spanRange } from '../src/agenda-span.js';
import { clockIssues, readClockChecks, readLogSettings } from '../src/agenda-log.js';
import { matchViewItems } from '../src/agenda-queries.js';
import { readStuckSettings, stuckProjectItems } from '../src/agenda-stuck.js';
import { commandSections, parseCustomCommands } from '../src/agenda-commands.js';
import { agendaSkipper } from '../src/agenda-skip.js';
import { agendaKnown } from './support/oracle-agenda-known.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-agenda.json', import.meta.url), 'utf8'));
const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
const isoOf = (/** @type {Date} */ d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** What a row of Emacs's agenda is, in the words of the app: scheduled / deadline / time stamp, the days overdue (negative: due in N days), and a range's (day/days). @param {any[]} r */
function emacsRow(r) {
  const [date, type, extra, time, token] = r;
  if (type === 'clockissue') return `${date}|${token}|clockissue|0|-1|${extra}`;
  const kind = /^(closed|state|clock)$/.test(type) ? type : /^todo/.test(type) || date === '' ? 'todo' : /scheduled/.test(type) ? 'scheduled' : /deadline/.test(type) ? 'deadline' : 'timestamp';
  let n = 0;
  if (type === 'past-scheduled') n = Number(/(\d+)x/.exec(extra)?.[1] ?? 0);
  else if (type === 'upcoming-deadline') n = -Number(/In\s+(\d+)/.exec(extra)?.[1] ?? 0);
  else if (type === 'deadline' && /ago/.test(extra)) n = Number(/(\d+) d\. ago/.exec(extra)?.[1] ?? 0);
  const range = kind === 'timestamp' ? (/^\((\d+\/\d+)\)/.exec(extra)?.[1] ?? '') : '';
  return `${date}|${token}|${kind}|${n}|${kind === 'todo' ? -1 : time}|${range}`; // a TODO-list row takes a time of day from its title for the time sort key only; it shows none
}

/** @param {import('../src/agenda.js').AgendaItem} i */
function appRow(i) {
  const kind = i.logType ?? (!i.date ? 'todo' : i.kind === 'scheduled' || i.kind === 'deadline' ? i.kind : 'timestamp');
  if (kind === 'todo') return `|${/[ETKH]\d+/.exec(i.title)?.[0] ?? i.title}|todo|0|-1|`;
  const time = i.timeOfDay ?? (i.hasTime ? i.date.getHours() * 100 + i.date.getMinutes() : -1);
  const token = /[ETKH]\d+/.exec(i.title)?.[0] ?? i.title;
  const range = kind === 'timestamp' && i.rangeDays ? `${i.rangeDay}/${i.rangeDays}` : '';
  return `${isoOf(i.date)}|${token}|${kind}|${i.daysOverdue ?? 0}|${time}|${range}`;
}

/** The rows and day headers the app gives for a scenario. @param {any} s */
function ours(s) {
  const doc = parseOrg(DOCS[s.doc]);
  const docs = [{ documentId: 'dated.org', doc }];
  const sequence = resolveTodoSequence(doc, ['TODO', 'DONE']);
  if (s.view === 'todo') {
    const vars = s.vars || {};
    const items = buildTaskList(docs, {
      today: new Date(2026, 9, 11, 16, 30),
      isDone: (/** @type {string} */ todo) => sequence.doneKeywords.includes(todo),
      keywords: s.query,
      todoListSettings: readTodoListSettings(vars),
      skipEntry: agendaSkipper(vars, docs, { todoKeywords: sequence.todoKeywords, doneKeywords: sequence.doneKeywords }),
      ...(vars['org-deadline-warning-days'] !== undefined ? { deadlineWarningDays: Number(vars['org-deadline-warning-days']) } : {}),
    });
    const keys = strategyFor(s.sorting, 'todo') ?? [];
    const sorted = sortAgendaItems(items, keys, { documentOrder: ['dated.org'], todoKeywords: sequence.todoKeywords, doneKeywords: sequence.doneKeywords });
    return { rows: sorted.map(appRow), days: [] };
  }
  if (s.view === 'match') {
    const vars = s.vars || {};
    const items = matchViewItems(docs, s.query, { doneKeywords: sequence.doneKeywords, todoKeywords: sequence.todoKeywords, now: new Date(2026, 9, 11, 16, 30), sortingStrategy: s.sorting, skipEntry: agendaSkipper(vars, docs, { todoKeywords: sequence.todoKeywords, doneKeywords: sequence.doneKeywords }) });
    return { rows: items.map(appRow), days: [] };
  }
  if (s.view === 'command') {
    const vars = s.vars || {};
    const command = parseCustomCommands(vars['org-agenda-custom-commands']).find((c) => c.key === s.key);
    if (!command) return { rows: [], days: [] };
    const options = { doneKeywords: sequence.doneKeywords, todoKeywords: sequence.todoKeywords, now: new Date(2026, 9, 11, 16, 30), localVariables: vars };
    const rows = commandSections(command, docs, docs, options).flatMap((section) => section.items.map(appRow));
    return { rows, days: [] };
  }
  if (s.view === 'stuck') {
    const items = stuckProjectItems(docs, readStuckSettings((s.vars || {})['org-stuck-projects']), { doneKeywords: sequence.doneKeywords, todoKeywords: sequence.todoKeywords, now: new Date(2026, 9, 11, 16, 30), sortingStrategy: s.sorting });
    return { rows: items.map(appRow), days: [] };
  }
  const vars = s.vars || {};
  const today = new Date(2026, 9, 11, 16, 30);
  const startDay = s.date ? (([y, m, d]) => new Date(y, m - 1, d))(s.date.split('-').map(Number)) : (readAgendaStartDay(vars, today) ?? today);
  const weekday = s.weekday === undefined ? 1 : s.weekday === 'nil' ? null : s.weekday;
  const range = spanRange(parseSpan(s.span) ?? 'day', startDay, weekday);
  const start = range.start;
  const days = range.ndays;
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days - 1, 23, 59);
  const logSettings = readLogSettings(vars);
  const items = buildAgendaItems(docs, {
    habits: { enabled: vars['org-habit-show-habits'] !== 'nil', ...getHabitOptions(vars) },
    today: new Date(2026, 9, 11, 16, 30),
    rangeStart: new Date(start.getFullYear(), start.getMonth(), start.getDate()),
    rangeEnd: end,
    isDone: (/** @type {string} */ todo) => sequence.doneKeywords.includes(todo),
    daySettings: readDaySettings(vars),
    skipEntry: agendaSkipper(vars, docs, { todoKeywords: sequence.todoKeywords, doneKeywords: sequence.doneKeywords }),
    logSettings,
    ...(vars['org-deadline-warning-days'] !== undefined ? { deadlineWarningDays: Number(vars['org-deadline-warning-days']) } : {}),
    ...(vars['org-scheduled-delay-days'] !== undefined ? { scheduledDelayDays: Number(vars['org-scheduled-delay-days']) } : {}),
  });
  const keys = strategyFor(s.sorting, 'agenda') ?? [];
  const keywords = { todoKeywords: sequence.todoKeywords, doneKeywords: sequence.doneKeywords };
  /** @type {string[]} */ const rows = [];
  /** @type {string[]} */ const dayList = [];
  /** @type {import('../src/agenda.js').AgendaItem[]} */ const shown = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    dayList.push(isoOf(day));
    const sorted = sortAgendaItems(itemsForDate(items, day), keys, { documentOrder: ['dated.org'], ...keywords });
    for (const item of sorted) shown.push(item);
  }
  const issues = logSettings.mode === 'clockcheck' ? clockIssues(shown.map((i) => (i.logType === 'clock' ? i : { clockStart: null, clockEnd: null })), readClockChecks(vars), today) : [];
  shown.forEach((item, n) => {
    if (issues[n]) rows.push(`${isoOf(item.date)}|${/[ETKH]\d+/.exec(item.title)?.[0] ?? item.title}|clockissue|0|-1|${issues[n]}`);
    rows.push(appRow(item));
  });
  return { rows, days: dayList };
}

test('the agenda shows the rows, in the order, Emacs shows for every day of a day, week or month under the settings', () => {
  const savedTz = process.env.TZ;
  process.env.TZ = oracle.tz;
  try {
    /** @type {string[]} */ const bad = [];
    let checked = 0;
    for (const s of oracle.scenarios) {
      if (s.emacs.error) continue;
      checked++;
      const want = s.emacs.rows.map(emacsRow);
      const got = ours(s);
      if (process.env.ORACLE_ID && s.id === process.env.ORACLE_ID) {
        const n = Math.max(want.length, got.rows.length);
        let shown = 0;
        for (let i = 0; i < n && shown < 14; i++) if (want[i] !== got.rows[i]) { console.log(`#${i} emacs ${want[i]}\n   ours  ${got.rows[i]}`); shown++; }
      }
      const known = agendaKnown(s, want, got.rows);
      if (known) continue;
      if (JSON.stringify(got.days) !== JSON.stringify(s.emacs.days) || JSON.stringify(got.rows) !== JSON.stringify(want)) {
        const onlyOurs = got.rows.filter((r) => !want.includes(r));
        const onlyEmacs = want.filter((r) => !got.rows.includes(r));
        bad.push(`${s.id}: days ${JSON.stringify(got.days) === JSON.stringify(s.emacs.days) ? 'same' : 'differ'}; only ours ${JSON.stringify(onlyOurs.slice(0, 4))}; only Emacs ${JSON.stringify(onlyEmacs.slice(0, 4))}${onlyOurs.length + onlyEmacs.length ? '' : '; same rows, other order'}`);
      }
    }
    if (process.env.ORACLE_DEBUG) console.log(`${bad.length} of ${checked} differ\n` + bad.join('\n'));
    assert.deepEqual(bad.slice(0, 6), [], `${bad.length} of ${checked} scenarios differ`);
  } finally {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  }
});
