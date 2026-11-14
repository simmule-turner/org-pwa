import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { buildAgendaItems } from '../src/agenda.js';
import { sexpOf } from '../tools/gen-ical-recurrence-oracle.mjs';

/** @type {{ start: string, rrule: string, ex?: string[], sexp: string, days: string[] }[]} */
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/ical-recurrence-oracle.json', import.meta.url), 'utf8'));
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

for (const c of cases) {
  test(`iCalendar recurrence ${c.rrule}${c.ex ? ' minus ' + c.ex.join(',') : ''}: the written expression matches Emacs`, () => {
    assert.equal(sexpOf(c), c.sexp);
    const doc = parseOrg(`* Event <%%${c.sexp}>\n`);
    const items = buildAgendaItems([{ documentId: 'a.org', doc }], {
      today: new Date(2026, 0, 1),
      rangeStart: new Date(2026, 0, 1),
      rangeEnd: new Date(2028, 2, 31, 23, 59),
      isDone: () => false,
    });
    const got = [...new Set(items.map((i) => key(i.date)))].sort();
    assert.deepEqual(got, c.days);
  });
}
