// Holds the agenda to real Emacs: test/fixtures/agenda/a1.expected.json was made by tools/gen-agenda-oracle.mjs, which asks Emacs 29.3
// (org-agenda-get-day-entries) what each day after "today" holds for test/fixtures/agenda/a1.org. New York time, today 2026-10-11 16:30.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { buildAgendaItems, itemsForDate } from '../src/agenda.js';

const read = (name) => fs.readFileSync(new URL(`./fixtures/agenda/${name}`, import.meta.url), 'utf8');
const oracle = JSON.parse(read('a1.expected.json'));

test('the days after today list the same headings, as scheduled, deadline or time stamp, as Emacs', () => {
  const savedTz = process.env.TZ;
  process.env.TZ = oracle.tz;
  try {
    const doc = parseOrg(read('a1.org'));
    const today = new Date(oracle.now.replace(' ', 'T'));
    const dates = Object.keys(oracle.days);
    const first = new Date(`${dates[0]}T00:00:00`);
    const last = new Date(`${dates[dates.length - 1]}T23:59:59`);
    const items = buildAgendaItems([{ documentId: 'a1.org', doc }], { today, rangeStart: first, rangeEnd: last });
    // What the app shows on purpose and Emacs's agenda does not (the oracle ran with org-agenda-skip-*-if-done and no carry-forward):
    // a DONE heading stays listed until a filter hides it; a SCHEDULED delay and a DEADLINE warning are applied by the views, not
    // by the item's own date; and Emacs lists a repeating deadline that falls inside today's warning window only as "In N d." on today.
    const warningEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14);
    const onPurpose = (key, date) =>
      key.startsWith('DONE ') || key.includes('delay') || (key.endsWith('|deadline') && key.startsWith('TODO dead ') && new Date(`${date}T12:00:00`) <= warningEnd);
    const differ = [];
    for (const date of dates) {
      const got = itemsForDate(items, new Date(`${date}T12:00:00`))
        .map((i) => `${i.todo ? i.todo + ' ' : ''}${i.title.replace(/\s*[<[][^>\]]*[>\]](--[<[][^>\]]*[>\]])?/g, '').trim()}|${i.kind === 'scheduled' || i.kind === 'deadline' ? i.kind : 'timestamp'}`)
        .filter((k) => !onPurpose(k, date));
      const want = oracle.days[date].filter((k) => !onPurpose(k, date));
      got.splice(0, got.length, ...[...new Set(got)].sort()); // an hour repeat has several occurrences a day; only the headings matter here
      want.splice(0, want.length, ...[...new Set(want)].sort());
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
