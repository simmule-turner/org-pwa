// Holds the agenda to real Emacs: test/fixtures/agenda/a1.expected.json was made by tools/gen-agenda-oracle.mjs, which asks Emacs 29.3
// (org-agenda-get-day-entries) what each day from "today" holds for test/fixtures/agenda/a1.org, with org-agenda-skip-*-if-done.
// New York time, today 2026-10-11 16:30. Each entry is the heading, scheduled / deadline / time stamp, and the days overdue
// (negative: due in N days), which Emacs gives only on today.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { buildAgendaItems, itemsForDate } from '../src/agenda.js';

const read = (name) => fs.readFileSync(new URL(`./fixtures/agenda/${name}`, import.meta.url), 'utf8');
const STAMPS = /\s*[<[][^>\]]*[>\]](--[<[][^>\]]*[>\]])?/g;

// a1: repeaters, overdue and warnings. b1: where in a heading's entry a time stamp counts (title, body, drawers, blocks).
// The app leaves completed headings out of the agenda (its default), so Emacs's DONE entries are not compared.
for (const name of ['a1', 'b1', 'f1']) test(`${name}: every day lists the same headings, as scheduled, deadline or time stamp, and as overdue or upcoming on today, as Emacs does`, () => {
  const oracle = JSON.parse(read(`${name}.expected.json`));
  const savedTz = process.env.TZ;
  process.env.TZ = oracle.tz;
  try {
    const doc = parseOrg(read(`${name}.org`));
    const today = new Date(oracle.now.replace(' ', 'T'));
    const dates = Object.keys(oracle.days);
    const first = new Date(`${dates[0]}T00:00:00`);
    const last = new Date(`${dates[dates.length - 1]}T23:59:59`);
    const items = buildAgendaItems([{ documentId: `${name}.org`, doc }], {
      today,
      rangeStart: first,
      rangeEnd: last,
      isDone: (todo) => todo === 'DONE',
      todoFilter: (todo) => todo !== 'DONE', // the agenda's own default; Emacs ran with org-agenda-skip-*-if-done
    });
    const differ = [];
    for (const date of dates) {
      // An hour repeat has several occurrences a day; only the headings matter here.
      const got = [...new Set(itemsForDate(items, new Date(`${date}T12:00:00`)).map(
        (i) => `${i.todo ? i.todo + ' ' : ''}${i.title.replace(STAMPS, '').trim()}|${i.kind === 'scheduled' || i.kind === 'deadline' ? i.kind : 'timestamp'}|${i.daysOverdue}`
      ))].sort();
      const want = [...new Set(oracle.days[date].filter((w) => !w.startsWith('DONE ')))].sort();
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        differ.push(`${date}: only ours ${JSON.stringify(got.filter((g) => !want.includes(g)))}; only Emacs ${JSON.stringify(want.filter((w) => !got.includes(w)))}`);
      }
    }
    assert.deepEqual(differ.slice(0, 8), [], `${differ.length} of ${dates.length} days differ`);
  } finally {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  }
});
