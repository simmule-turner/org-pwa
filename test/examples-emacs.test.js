// examples/clock-tables.org and examples/cookies.org hold what Emacs 29.3 left after org-update-all-dblocks and
// org-update-statistics-cookies; the app must give the same text from the same file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { updateAllStatisticsCookies } from '../src/checkbox-cookie.js';
import { computeClocktable, renderClocktable } from '../src/clocktable.js';

const read = (name) => readFileSync(new URL('../examples/' + name, import.meta.url), 'utf8');

test('cookies.org is unchanged by updating every cookie', () => {
  const text = read('cookies.org');
  const doc = parseOrg(text);
  updateAllStatisticsCookies(doc, ['DONE', 'CANCELED']);
  assert.equal(serializeOrg(doc), text);
});

test('every clock table in clock-tables.org is what the app writes', () => {
  const text = read('clock-tables.org');
  const doc = parseOrg(text);
  const lines = text.split('\n');
  let checked = 0;
  lines.forEach((line, i) => {
    const m = /^#\+BEGIN: clocktable (.*)$/.exec(line);
    if (!m) return;
    const params = m[1];
    const maxlevel = Number(/:maxlevel (\d+)/.exec(params)?.[1] ?? 2);
    const tstart = /:tstart "([^"]*)"/.exec(params)?.[1];
    const tend = /:tend "([^"]*)"/.exec(params)?.[1];
    const end = lines.indexOf('#+END:', i);
    const emacs = lines.slice(i, end + 1).join('\n').replace(/Clock summary at \[[^\]]*\]/, 'Clock summary at [X]');
    const ours = renderClocktable(computeClocktable(doc, tstart, tend, maxlevel), tstart, tend, new Date(2000, 0, 1), maxlevel).replace(/Clock summary at \[[^\]]*\]/, 'Clock summary at [X]');
    assert.equal(ours.trimEnd(), emacs.trimEnd());
    checked++;
  });
  assert.equal(checked, 2);
});

test('icalendar.ics is what the app exports from icalendar.org', async () => {
  const { exportOrgIcalendar } = await import('../src/ox-icalendar.js');
  const normalize = (ics) => ics.replace(/\r\n /g, '').replace(/\r\n/g, '\n').replace(/^DTSTAMP:.*$/gm, 'DTSTAMP:X').replace(/^PRODID:.*$/m, 'PRODID:X');
  const ics = exportOrgIcalendar([{ documentId: 'icalendar.org', doc: parseOrg(read('icalendar.org')), name: 'icalendar.org' }], {
    stamp: new Date(Date.UTC(2026, 9, 22, 12, 0, 0)),
    settings: { timezone: 'America/New_York' },
  });
  assert.equal(normalize(ics), normalize(read('icalendar.ics')));
});

test('every query in match-queries.org finds the headings Emacs found', async () => {
  const { searchDocumentsByMatchQuery } = await import('../src/search.js');
  const text = read('match-queries.org');
  const doc = parseOrg(text);
  let checked = 0;
  for (const m of text.matchAll(/^- =(.+?)= :: (.*)$/gm)) {
    const found = searchDocumentsByMatchQuery([{ documentId: 'match-queries.org', doc }], m[1], { doneKeywords: ['DONE'], now: new Date(2026, 9, 22) }).map((r) => r.heading.title);
    assert.equal(found.join('; ') || '(none)', m[2], `query ${m[1]}`);
    checked++;
  }
  assert.ok(checked >= 25);
});

test('every before/after pair in todo-states.org is what the app writes', async () => {
  const { readLogSettings } = await import('../src/log-settings.js');
  const { getClosedKeepWhenNoTodo, parseLocalVariables } = await import('../src/local-variables.js');
  const { resolveTodoSequence, setTodoState } = await import('../src/todo-cycle.js');
  const { applyTransitionEffects } = await import('../src/todo-transition.js');
  const text = read('todo-states.org');
  const unescape = (s) => s.replace(/^,(\*|#\+)/gm, '$1');
  const pairs = [...text.matchAll(/Before:\n#\+BEGIN_SRC org\n([\s\S]*?)\n#\+END_SRC\n\nAfter setting (\w+):\n#\+BEGIN_SRC org\n([\s\S]*?)\n#\+END_SRC/g)];
  assert.ok(pairs.length >= 10);
  const saved = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    for (const [, before, state, after] of pairs) {
      const doc = parseOrg(unescape(before) + '\n');
      const heading = doc.children[0];
      const sequence = resolveTodoSequence(doc, { todoKeywords: ['TODO'], doneKeywords: ['DONE'] });
      const from = heading.todo;
      setTodoState(heading, state, sequence);
      const settings = readLogSettings(doc, parseLocalVariables(serializeOrg(doc)), {}, [heading]);
      applyTransitionEffects(heading, from, sequence, { settings, keepWhenNoTodo: getClosedKeepWhenNoTodo({}), now: new Date(2026, 9, 11, 16, 30) });
      assert.equal(serializeOrg(doc).trimEnd(), unescape(after).trimEnd(), unescape(before));
    }
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

test('every before/after pair in editing.org is what the app writes', async () => {
  const { demoteHeading, moveHeadingUp, promoteHeading } = await import('../src/heading-edit.js');
  const { deleteTableRow, insertListItem, insertTableColumn, setTableCell } = await import('../src/body-edit.js');
  const { cycleItemCheckbox } = await import('../src/outline-view-model.js');
  const { updateCheckboxCookie } = await import('../src/checkbox-cookie.js');
  const cases = JSON.parse(read('../test/fixtures/editing-cases.json'));
  const unescape = (s) => s.replace(/^,(\*|#\+)/gm, '$1');
  const afters = [...read('editing.org').matchAll(/\nAfter:\n#\+BEGIN_SRC org\n([\s\S]*?)\n#\+END_SRC/g)].map((m) => unescape(m[1]));
  assert.equal(afters.length, cases.length);
  cases.forEach((c, i) => {
    let result;
    if (['promote', 'demote', 'up'].includes(c.op)) {
      const doc = parseOrg(c.org);
      const headings = [];
      (function walk(n) {
        for (const h of n.children) {
          headings.push(h);
          walk(h);
        }
      })(doc);
      const at = c.org.split('\n').slice(0, c.line - 1).filter((l) => /^\*+ /.test(l)).length;
      ({ promote: promoteHeading, demote: demoteHeading, up: moveHeadingUp })[c.op](doc, headings[at]);
      result = serializeOrg(doc);
    } else if (c.op === 'item-below' || c.op === 'toggle') {
      const doc = parseOrg(c.org);
      const heading = doc.children[0];
      const find = (lists) => lists.flatMap((l) => l.items.flatMap((it) => [it, ...find(it.children || [])]));
      const item = find(heading.body.filter((n) => n.type === 'list')).find((it) => it.lineIndex === c.line - 2);
      if (c.op === 'item-below') insertListItem(heading, item);
      else {
        cycleItemCheckbox(heading, item);
        updateCheckboxCookie(heading);
      }
      result = serializeOrg(doc);
    } else {
      const doc = parseOrg('* h\n' + c.org);
      const heading = doc.children[0];
      const table = heading.body.find((n) => n.type === 'table');
      if (c.op === 'insert-col') insertTableColumn(heading, table, c.col - 2);
      else if (c.op === 'delete-row') deleteTableRow(heading, table, c.line - 1);
      else setTableCell(heading, table, c.line - 1, c.col - 1, c.value);
      result = serializeOrg(doc).replace(/^\* h\n/, '');
    }
    assert.equal(result.trimEnd(), afters[i].trimEnd(), c.title);
  });
});

test('examples/diary is the file the diary oracle checks against Emacs', () => {
  assert.equal(read('diary'), readFileSync(new URL('./fixtures/diary/example.diary', import.meta.url), 'utf8'));
});
