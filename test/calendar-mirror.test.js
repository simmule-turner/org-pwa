import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { DEFAULT_DAYS_AFTER, DEFAULT_DAYS_BEFORE, buildCalendarResources, eventHash, isOurResource, nextSyncState, planCalendarSync, resourceNameForUid } from '../src/calendar-mirror.js';

const TODAY = new Date(2026, 9, 2, 12, 0); // Fri 2026-10-02
const build = (text, opts = {}) => buildCalendarResources([{ documentId: 'a.org', doc: parseOrg(text) }], { today: TODAY, ...opts });
const lines = (resource) => resource.ics.split('\r\n');
const summaries = (map) => [...map.values()].map((r) => lines(r).find((l) => l.startsWith('SUMMARY:')).slice(8)).sort();
const only = (map) => { assert.equal(map.size, 1, `expected one event, got ${[...map.values()].map((r) => lines(r).find((l) => l.startsWith('SUMMARY:'))).join(', ')}`); return [...map.values()][0]; };

test('each event is its own calendar object: a complete VCALENDAR holding exactly one VEVENT', () => {
  const r = only(build('* Pay rent\nDEADLINE: <2026-10-05 Mon>\n'));
  const l = lines(r);
  assert.equal(l[0], 'BEGIN:VCALENDAR');
  assert.equal(l.filter((x) => x === 'BEGIN:VEVENT').length, 1);
  assert.equal(l.filter((x) => x === 'END:VEVENT').length, 1);
  assert.ok(l.includes('END:VCALENDAR') && r.ics.endsWith('\r\n'));
});

test('scheduled, deadline and a timestamp in the title all become events, with a warning delay as an alarm', () => {
  const m = build('* Sched\nSCHEDULED: <2026-10-06 Tue>\n* Due\nDEADLINE: <2026-10-09 Fri -3d>\n* Meet <2026-10-07 Wed 14:00>\n');
  assert.deepEqual(summaries(m), ['Due', 'Meet <2026-10-07 Wed 14:00>', 'Sched']);
  const due = [...m.values()].find((r) => lines(r).includes('SUMMARY:Due'));
  assert.ok(lines(due).includes('BEGIN:VALARM') && lines(due).includes('TRIGGER:-P3D'));
});

test('completed items are kept, with their state in the description', () => {
  const r = only(build('* DONE Call dentist\nSCHEDULED: <2026-10-01 Thu>\n'));
  assert.ok(lines(r).includes('DESCRIPTION:Scheduled (DONE)'));
  const t = only(build('* DONE Review <2026-10-01 Thu>\n'));
  assert.ok(lines(t).includes('DESCRIPTION:DONE'.replace('DONE', '(DONE)')) || lines(t).some((x) => x.includes('(DONE)')));
});

test('a recurring item is ONE event with a recurrence rule, not a copy per day', () => {
  const r = only(build('* Standup\nSCHEDULED: <2026-10-06 Tue 09:30 +1d>\n'));
  assert.ok(lines(r).includes('RRULE:FREQ=DAILY;INTERVAL=1'));
});

test('a one-off item outside the window is left out; the window is a month back to six months ahead', () => {
  assert.equal(DEFAULT_DAYS_BEFORE, 30);
  assert.equal(DEFAULT_DAYS_AFTER, 180);
  const m = build('* Too old\nSCHEDULED: <2026-08-01 Sat>\n* Edge back\nSCHEDULED: <2026-09-02 Wed>\n* Edge ahead\nSCHEDULED: <2027-03-31 Wed>\n* Too far\nSCHEDULED: <2027-05-01 Sat>\n');
  assert.deepEqual(summaries(m), ['Edge ahead', 'Edge back']);
});

test('a recurring item that started long ago is kept (it still recurs), but one that has not started by the window end is not', () => {
  const m = build('* Old habit\nSCHEDULED: <2025-01-01 Wed +1w>\n* Future habit\nSCHEDULED: <2027-06-01 Tue +1w>\n');
  assert.deepEqual(summaries(m), ['Old habit']);
});

test('the window can be changed', () => {
  const text = '* Eight days out\nSCHEDULED: <2026-10-10 Sat>\n';
  assert.equal(build(text, { daysAfter: 5 }).size, 0);
  assert.equal(build(text, { daysAfter: 10 }).size, 1);
});

test('archived and commented headings stay out, as in the agenda', () => {
  const m = build('* Kept\nSCHEDULED: <2026-10-06 Tue>\n* Archived :ARCHIVE:\nSCHEDULED: <2026-10-06 Tue>\n* # Commented\nSCHEDULED: <2026-10-06 Tue>\n');
  assert.deepEqual(summaries(m), ['Kept']);
});

test('birthdays recur yearly when org-contacts-anniversaries is on', () => {
  const m = build('* Contacts\n%%(org-contacts-anniversaries)\n** Alex\n:PROPERTIES:\n:BIRTHDAY: 1990-10-08\n:END:\n');
  const rules = [...m.values()].flatMap((r) => lines(r).filter((l) => l.startsWith('RRULE:')));
  assert.deepEqual(rules, ['RRULE:FREQ=YEARLY']);
  assert.equal(m.size, 1, 'one yearly event, not a copy per occurrence');
  assert.ok(summaries(m)[0].startsWith('Alex'));
});

test('diary-style (sexp) entries are worked out per day, with the agenda\u2019s own text', () => {
  const m = build('* Anniversaries\n%%(org-anniversary 1990 10 8) Alex is %d years old\n%%(org-anniversary 2000 12 25) Someone %d\n');
  assert.deepEqual(summaries(m), ['Alex is 36 years old', 'Someone 26']);
  assert.ok([...m.values()].every((r) => lines(r).includes('DESCRIPTION:Diary')));
});

test('a heading with an :ID: and both SCHEDULED and DEADLINE gets two events, not one overwriting the other', () => {
  const m = build('* Ship it\nSCHEDULED: <2026-10-06 Tue> DEADLINE: <2026-10-09 Fri>\n:PROPERTIES:\n:ID: abc-123\n:END:\n');
  assert.equal(m.size, 2);
  const uids = [...m.values()].map((r) => r.uid);
  assert.equal(new Set(uids).size, 2);
  assert.ok(uids.includes('abc-123@org-pwa'), 'the first keeps the plain id, so earlier exports still match');
});

test('names are stable, start with orgpwa-, are safe in a URL, and differ for different events', () => {
  const a = resourceNameForUid('My heading: 100% done?-scheduled-0-20261006@org-pwa');
  assert.match(a, /^orgpwa-[A-Za-z0-9._-]+\.ics$/);
  assert.equal(a, resourceNameForUid('My heading: 100% done?-scheduled-0-20261006@org-pwa'));
  assert.notEqual(resourceNameForUid('x y@org-pwa'), resourceNameForUid('x-y@org-pwa'), 'ids that sanitize to the same text still get different names');
  assert.ok(resourceNameForUid('z'.repeat(500) + '@org-pwa').length < 140, 'a long title cannot make an enormous file name');
});

test('only names this app made count as its own, so anything else in the calendar is left alone', () => {
  assert.equal(isOurResource('orgpwa-a-1.ics'), true);
  assert.equal(isOurResource('personal-event.ics'), false);
  assert.equal(isOurResource('orgpwa-notes.txt'), false);
  assert.equal(isOurResource('xorgpwa-a.ics'), false);
});

test('the change fingerprint ignores DTSTAMP, so a run later in the day does not make every event look edited', () => {
  const a = build('* Pay\nDEADLINE: <2026-10-05 Mon>\n', { today: new Date(2026, 9, 2, 8, 0) });
  const b = build('* Pay\nDEADLINE: <2026-10-05 Mon>\n', { today: new Date(2026, 9, 2, 20, 30) });
  const [ra] = [...a.values()];
  const [rb] = [...b.values()];
  assert.notEqual(ra.ics, rb.ics, 'the DTSTAMP does differ');
  assert.equal(ra.hash, rb.hash);
  assert.equal(eventHash(ra.ics), ra.hash);
});

test('a real change to an event does change its fingerprint', () => {
  const [a] = [...build('* Pay\nDEADLINE: <2026-10-05 Mon>\n').values()];
  const [b] = [...build('* Pay\nDEADLINE: <2026-10-05 Mon 17:00>\n').values()];
  assert.notEqual(a.hash, b.hash);
});

test('every event says which file it came from, and events from an unsaved scratch document are not mirrored', () => {
  const m = buildCalendarResources([
    { documentId: 'a.org', doc: parseOrg('* In a\nSCHEDULED: <2026-10-06 Tue>\n') },
    { documentId: '\u0000unsaved-new-document:xyz', doc: parseOrg('* Scratch\nSCHEDULED: <2026-10-06 Tue>\n') },
    { documentId: 'nodoc.org', doc: null },
  ], { today: TODAY });
  assert.equal(m.size, 1);
  assert.equal([...m.values()][0].documentId, 'a.org');
});

// ---- the plan -----------------------------------------------------------------------------------

const wantedOf = (entries) => new Map(Object.entries(entries).map(([name, [hash, documentId = 'a.org']]) => [name, { uid: name, documentId, ics: '', hash }]));
const prevOf = (entries) => Object.fromEntries(Object.entries(entries).map(([name, [hash, doc = 'a.org']]) => [name, { hash, doc }]));

test('the plan sends new and changed events, skips unchanged ones, and removes ones that are gone', () => {
  const plan = planCalendarSync(wantedOf({ new: ['h1'], same: ['h2'], changed: ['h4'] }), prevOf({ same: ['h2'], changed: ['h3'], gone: ['h5'] }));
  assert.deepEqual(plan.puts.sort(), ['changed', 'new']);
  assert.deepEqual(plan.deletes, ['gone']);
  assert.equal(plan.unchanged, 1);
});

test('only what this device itself sent can be deleted: with nothing remembered, nothing is deleted', () => {
  const plan = planCalendarSync(wantedOf({ a: ['h1'] }), {});
  assert.deepEqual(plan.deletes, []);
  assert.deepEqual(plan.puts, ['a']);
});

test('an event is deleted only if its file was loaded in this run, so a file that failed to load keeps its events', () => {
  const previous = prevOf({ fromA: ['h1', 'a.org'], fromB: ['h2', 'b.org'] });
  const wanted = wantedOf({}); // neither is wanted now
  assert.deepEqual(planCalendarSync(wanted, previous, { loadedDocs: new Set(['a.org']) }).deletes, ['fromA'], 'b.org did not load');
  assert.deepEqual(planCalendarSync(wanted, previous, { loadedDocs: new Set(['a.org', 'b.org']) }).deletes.sort(), ['fromA', 'fromB']);
  assert.deepEqual(planCalendarSync(wanted, previous, { loadedDocs: new Set() }).deletes, []);
});

test('switching which file is open does not remove the other file\u2019s events', () => {
  // run 1: a.org is open and mirrored. run 2: b.org is open instead, and a.org is not loaded at all
  const run1 = wantedOf({ 'a-1': ['h1', 'a.org'], 'a-2': ['h2', 'a.org'] });
  const state1 = nextSyncState({}, run1, ok(['a-1', 'a-2']));
  const run2 = wantedOf({ 'b-1': ['h3', 'b.org'] });
  const plan2 = planCalendarSync(run2, state1, { loadedDocs: new Set(['b.org']) });
  assert.deepEqual(plan2.deletes, [], "a.org's events stay");
  const state2 = nextSyncState(state1, run2, ok(['b-1']));
  assert.deepEqual(Object.keys(state2).sort(), ['a-1', 'a-2', 'b-1']);
  // and when a.org is back, nothing needs sending
  const plan3 = planCalendarSync(wantedOf({ 'a-1': ['h1', 'a.org'], 'a-2': ['h2', 'a.org'], 'b-1': ['h3', 'b.org'] }), state2, { loadedDocs: new Set(['a.org', 'b.org']) });
  assert.deepEqual([plan3.puts, plan3.deletes], [[], []]);
});

test('an item removed from a loaded file IS deleted, while the other file\u2019s events stay', () => {
  const previous = prevOf({ 'a-1': ['h1', 'a.org'], 'a-2': ['h2', 'a.org'], 'b-1': ['h3', 'b.org'] });
  const plan = planCalendarSync(wantedOf({ 'a-1': ['h1', 'a.org'] }), previous, { loadedDocs: new Set(['a.org']) });
  assert.deepEqual(plan.deletes, ['a-2']);
});

test('a second run with nothing changed does nothing at all', () => {
  const wanted = wantedOf({ a: ['h1'], b: ['h2'] });
  const plan = planCalendarSync(wanted, prevOf({ a: ['h1'], b: ['h2'] }));
  assert.deepEqual([plan.puts, plan.deletes, plan.unchanged], [[], [], 2]);
});

// ---- what is remembered afterwards ----------------------------------------------------------------

const ok = (put = [], del = []) => ({ putOk: new Set(put), deleteOk: new Set(del) });

test('a sent event is remembered with its fingerprint and file; an unchanged one keeps its own', () => {
  const next = nextSyncState(prevOf({ same: ['h2'], changed: ['h3'] }), wantedOf({ same: ['h2'], changed: ['h4'], fresh: ['h6', 'b.org'] }), ok(['changed', 'fresh']));
  assert.deepEqual(next, { same: { hash: 'h2', doc: 'a.org' }, changed: { hash: 'h4', doc: 'a.org' }, fresh: { hash: 'h6', doc: 'b.org' } });
});

test('a failed send is NOT remembered as sent, so the next run tries it again', () => {
  const previous = prevOf({ changed: ['h3'] });
  const wanted = wantedOf({ changed: ['h4'], fresh: ['h6'] });
  const next = nextSyncState(previous, wanted, ok([]));
  assert.deepEqual(next, { changed: { hash: 'h3', doc: 'a.org' } }, 'the changed one keeps its old fingerprint; the new one is absent');
  assert.deepEqual(planCalendarSync(wanted, next).puts.sort(), ['changed', 'fresh']);
});

test('a deleted event is forgotten; a failed delete is remembered so it is retried', () => {
  const wanted = wantedOf({ keep: ['h1'] });
  const previous = prevOf({ keep: ['h1'], gone: ['h2'] });
  assert.deepEqual(nextSyncState(previous, wanted, ok([], ['gone'])), { keep: { hash: 'h1', doc: 'a.org' } });
  assert.deepEqual(nextSyncState(previous, wanted, ok([], [])), { keep: { hash: 'h1', doc: 'a.org' }, gone: { hash: 'h2', doc: 'a.org' } });
});

test('events of a file that was not loaded this run are kept in the state untouched', () => {
  const previous = prevOf({ other: ['h9', 'b.org'] });
  assert.deepEqual(nextSyncState(previous, wantedOf({ mine: ['h1'] }), ok(['mine'])), { other: { hash: 'h9', doc: 'b.org' }, mine: { hash: 'h1', doc: 'a.org' } });
});

test('after a clean run the remembered state matches the wanted set, so the next plan is empty', () => {
  const wanted = wantedOf({ a: ['h1'], b: ['h2'] });
  const next = nextSyncState(prevOf({ b: ['h0'], old: ['h9'] }), wanted, ok(['a', 'b'], ['old']));
  const plan = planCalendarSync(wanted, next);
  assert.deepEqual([plan.puts, plan.deletes], [[], []]);
});
