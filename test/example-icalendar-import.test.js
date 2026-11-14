import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importIcalendarAsOrgText } from '../src/import-icalendar.js';
import { parseOrg } from '../src/org-parser.js';
import { buildAgendaItems } from '../src/agenda.js';

const ics = fs.readFileSync(new URL('../examples/icalendar-import.ics', import.meta.url), 'utf8');
const { orgText, eventCount } = importIcalendarAsOrgText(ics, { zone: 'UTC' });

test('examples/icalendar-import.ics imports as the example file describes', () => {
  assert.equal(eventCount, 4);
  assert.match(orgText, /^\* Design review <2026-10-05 Mon 14:00-15:00>$/m);
  assert.match(orgText, /^:ORGANIZER: Ann Lee <ann@example\.org>$/m);
  assert.match(orgText, /^:APPT_WARNTIME: 15$/m);
  assert.match(orgText, /^\* Pay rent <2026-11-01 Sun \+1m>$/m);
  assert.doesNotMatch(orgText, /^:RRULE:/m);
});

test('the Gym expression skips the excluded Thursday and ends on the sixth occurrence', () => {
  const items = buildAgendaItems([{ documentId: 'a.org', doc: parseOrg(orgText) }], { today: new Date(2026, 9, 1), rangeStart: new Date(2026, 9, 1), rangeEnd: new Date(2026, 11, 31, 23, 59), isDone: () => false });
  const days = items.filter((i) => /Gym/.test(i.title)).map((i) => i.date.getDate());
  assert.deepEqual(days, [5, 12, 15, 19, 22]);
});
