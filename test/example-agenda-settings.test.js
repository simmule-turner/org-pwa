import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { buildAgendaItems, itemsForDate } from '../src/agenda.js';
import { sortAgendaItems, strategyFor } from '../src/agenda-sort.js';
import { formatAgendaPrefix, agendaPrefixFormat, agendaClockText } from '../src/agenda-prefix.js';
import { PrefixFormError, agendaLisp, headlineOf, prefixEvaluator, runFunctionCommand } from '../src/agenda-lisp.js';
import { matchViewItems, searchViewItems } from '../src/agenda-queries.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';
import { SCENARIOS } from '../tools/agenda-settings-cases.mjs';

// examples/agenda-settings.org shows the rows Emacs 29.3 gave for each scenario (tools/gen-agenda-settings-example.mjs). The app, given the
// same settings, must give the same rows.
const text = fs.readFileSync(new URL('../examples/agenda-settings.org', import.meta.url), 'utf8');
const documentId = 'agenda-settings.org';
const doc = parseOrg(text);
const docs = [{ documentId, doc }];
const sequence = resolveTodoSequence(doc, ['TODO', 'DONE']);
const keywords = { todoKeywords: sequence.todoKeywords, doneKeywords: sequence.doneKeywords };

/** What the example file holds under `#+NAME: id`. @param {string} id */
function shown(id) {
  const m = new RegExp(`^#\\+NAME: ${id}\\n#\\+begin_example\\n([\\s\\S]*?)\\n#\\+end_example$`, 'm').exec(text);
  assert.ok(m, `the file shows ${id}`);
  return m[1].split('\n');
}

/** The agenda text of the headline: keyword, priority, title and tags, as a row ends. @param {import('../src/agenda.js').AgendaItem} item */
const headline = (item) => headlineOf(item).replace(/\s*<\d{4}-\d\d-\d\d[^>]*>/g, ''); // a plain timestamp is not part of the row's text
/** The Agenda lays the prefix and the heading out in separate boxes, so the rows are compared with each run of spaces as one. @param {string} row */
const flat = (row) => row.replace(/ +/g, ' ').trim();

/** The prefix org-agenda-prefix-format gives a row (the Agenda's own rowPrefix, without the page). @param {import('../src/agenda.js').AgendaItem} item @param {Record<string, string>} vars @param {'agenda' | 'tags' | 'search'} view */
function prefix(item, vars, view) {
  const format = agendaPrefixFormat(vars['org-agenda-prefix-format']?.replace(/^'/, ''), view === 'agenda' ? 'agenda' : view) ?? (view === 'agenda' ? '  %-12:c%?-12t% s' : '  %-12:c');
  const time = item.hasTime ? agendaClockText(item.date, item.endDate ?? null) : '';
  const scheduling = item.kind === 'scheduled' ? 'Scheduled:' : item.kind === 'deadline' ? 'Deadline:' : '';
  const effort = item.heading ? (item.heading.properties?.Effort ?? '') : '';
  const fields = { category: item.category ?? '', time, scheduling, effort, level: ' ', breadcrumbs: '' };
  const evaluate = format.includes('%(') ? prefixEvaluator(item, docs, { category: fields.category, time, extra: scheduling, level: fields.level, effort, tag: (item.tags || []).join(':'), breadcrumbs: '', 'category-icon': '' }, keywords) : undefined;
  return formatAgendaPrefix(format, fields, evaluate);
}

for (const c of SCENARIOS) {
  test(`agenda-settings.org: ${c.title}`, () => {
    const vars = c.vars;
    if (c.kind === 'function') {
      const r = runFunctionCommand(/** @type {string} */ (c.fn), /** @type {string} */ (c.match));
      assert.ok(r.ok);
      assert.deepEqual(r.text.replace(/\n$/, '').split('\n'), shown(c.id));
      return;
    }
    const options = { ...keywords, sortingStrategy: vars['org-agenda-sorting-strategy'] ?? null, localVariables: vars, documentOrder: [documentId] };
    if (c.kind === 'search' || c.kind === 'match') {
      const items = c.kind === 'search' ? searchViewItems(docs, /** @type {string} */ (c.query), options) : matchViewItems(docs, /** @type {string} */ (c.query), options);
      const rows = items.map((item) => prefix(item, vars, c.kind === 'search' ? 'search' : 'tags') + ' ' + headline(item));
      assert.deepEqual(rows.map(flat), shown(c.id).map(flat));
      return;
    }
    const items = buildAgendaItems(docs, {
      today: new Date(2027, 2, 15),
      rangeStart: new Date(2027, 2, 15, 0, 0),
      rangeEnd: new Date(2027, 2, 15, 23, 59),
      isDone: (/** @type {string} */ todo) => sequence.doneKeywords.includes(todo),
      todoFilter: (/** @type {string} */ todo) => !sequence.doneKeywords.includes(todo),
    });
    const keys = strategyFor(vars['org-agenda-sorting-strategy'], 'agenda') ?? [];
    const sorted = sortAgendaItems(itemsForDate(items, new Date(2027, 2, 15)), keys, { documentOrder: [documentId], ...keywords, lisp: agendaLisp(vars, docs, keywords) });
    // A failing %(form) stops the Agenda with the error, which replaces the rows (Emacs's batch quotes with ', a UTF-8 session with ’).
    /** @type {string[]} */
    let rows;
    try {
      rows = sorted.map((item) => prefix(item, vars, 'agenda') + ' ' + headline(item));
    } catch (error) {
      if (!(error instanceof PrefixFormError)) throw error;
      rows = [error.message.replace(/\u2019/g, "'")];
    }
    assert.deepEqual(rows.map(flat), shown(c.id).map(flat));
    // The prefix itself is exact, spaces included (a one-digit hour is padded with a space).
    if (!rows[0]?.startsWith('Symbol')) sorted.forEach((item, i) => assert.ok(shown(c.id)[i].startsWith(prefix(item, vars, 'agenda').trimEnd()), `${c.id} row ${i}`));
  });
}
