import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgendaItems } from '../src/agenda.js';
import { generateUid } from '../src/export-icalendar.js';
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
  assert.deepEqual(summaries(m), ['Due', 'Meet', 'Sched'], 'the time is the event\u2019s start, so it is not repeated in the title');
  const due = [...m.values()].find((r) => lines(r).includes('SUMMARY:Due'));
  assert.ok(lines(due).includes('BEGIN:VALARM') && lines(due).includes('TRIGGER:-P3D'));
});

test('completed items are not in the calendar, because they are not on the agenda', () => {
  assert.equal(build('* DONE Call dentist\nSCHEDULED: <2026-10-01 Thu>\n').size, 0);
  assert.equal(build('* DONE Review <2026-10-01 Thu>\n').size, 0);
  assert.deepEqual(summaries(build('* TODO Open\nSCHEDULED: <2026-10-06 Tue>\n* DONE Closed\nSCHEDULED: <2026-10-06 Tue>\n')), ['Open']);
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

test('a birthday is one event for each year in the window, with that year\u2019s age, as the agenda shows it', () => {
  const m = build('* Contacts\n%%(org-contacts-anniversaries)\n** Alex\n:PROPERTIES:\n:BIRTHDAY: 1990-10-08\n:END:\n');
  const r = only(m);
  assert.ok(lines(r).includes('SUMMARY:Birthday: Alex (36th)'), lines(r).join(' | '));
  assert.ok(lines(r).includes('DTSTART;VALUE=DATE:20261008'));
  assert.equal(lines(r).some((l) => l.startsWith('RRULE:')), false, 'no repeat rule: next year\u2019s event is made when its day is in the window, with its own age');
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

// ---- the calendar is what View > Agenda shows -------------------------------------------------------------------

const field = (resource, name) => lines(resource).find((l) => l.startsWith(name + ':') || l.startsWith(name + ';'));
const WINDOW = { start: new Date(2026, 8, 2), end: new Date(2027, 2, 31, 23, 59, 59) };
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

test('PARITY: every dated, non-repeating item the agenda shows in the window is a calendar event with the same day and title, and nothing else is', () => {
  const text = ['* TODO Pay rent', 'DEADLINE: <2026-10-31 Sat>', '* Dentist <2026-10-20 Tue 09:00-10:00>', '* TODO Call', 'SCHEDULED: <2026-10-09 Fri 16:00>', '* Plain note', 'no dates here',
    '* Cal', "%%(org-anniversary 1990 10 14) Mom's birthday (%d)", '%%(org-contacts-anniversaries)', '%%(org-contacts-anniversaries "ANNIVERSARY")',
    '* Jane Doe', ':PROPERTIES:', ':BIRTHDAY: 1990-10-08', ':ANNIVERSARY: 1998-10-14', ':SPOUSE: John Doe', ':END:', '* DONE Finished', 'SCHEDULED: <2026-10-05 Mon>', ''].join('\n');
  const docs = [{ documentId: 'a.org', doc: parseOrg(text) }];
  const done = ['DONE'];
  const items = buildAgendaItems(docs, { today: TODAY, rangeStart: WINDOW.start, rangeEnd: WINDOW.end, deadlineWarningDays: 0, todoFilter: (t) => !done.includes(t), isDone: (t) => done.includes(t) })
    .filter((i) => ['scheduled', 'deadline', 'timestamp', 'diary-sexp', 'sexp-timestamp', 'anniversary'].includes(i.kind) && !i.daysOverdue);
  const shown = items.map((i) => `${ymd(i.date)} ${i.kind === 'timestamp' ? i.heading.title.replace(/\s*<[^>]*>/, '') : i.title}`).sort();
  const sent = [...build(text).values()].map((r) => `${field(r, 'DTSTART').split(':')[1].slice(0, 8)} ${field(r, 'SUMMARY').slice(8)}`).sort();
  assert.deepEqual(sent, shown);
  assert.ok(shown.length >= 6, 'the sample is rich enough to mean something: ' + shown.length);
});

test('an overdue item is ONE event on its own date, not one for every day since (those are the agenda\u2019s carry-forward, not data)', () => {
  const r = only(build('* TODO Overdue\nSCHEDULED: <2026-09-20 Sun>\n'));
  assert.ok(lines(r).includes('DTSTART;VALUE=DATE:20260920'));
});

test('a deadline with a warning period is ONE event on the deadline, with the warning as an alarm, not an event for each warning day', () => {
  const r = only(build('* TODO Pay rent\nDEADLINE: <2026-10-31 Sat -5d>\n'));
  assert.ok(lines(r).includes('DTSTART;VALUE=DATE:20261031') && lines(r).includes('TRIGGER:-P5D'));
});

test('a daily repeating habit is ONE event with a repeat rule starting at its own timestamp, however many days of it the agenda shows', () => {
  const r = only(build('* TODO Habit\nSCHEDULED: <2026-09-01 Tue 07:00 +1d>\n'));
  assert.ok(lines(r).includes('RRULE:FREQ=DAILY;INTERVAL=1'));
  assert.ok(lines(r).includes('DTSTART:20260901T070000'), 'it starts where the timestamp says, so the id and the start do not move as the window does');
});

test('only dated things are events: sunrise and weather lines in the agenda are not', () => {
  assert.equal(build('* Sun\n%%(diary-sunrise)\n').size, 0);
});

test('a time range has its end, and the details the agenda row shows are there: tags as categories, the location, the start of the body', () => {
  const r = only(build('* TODO Dentist :health:dental:\nSCHEDULED: <2026-10-09 Fri 09:30-10:15>\n:PROPERTIES:\n:LOCATION: Main St, Suite 2\n:END:\nBring the forms\nand the insurance card.\n'));
  assert.ok(lines(r).includes('DTSTART:20261009T093000') && lines(r).includes('DTEND:20261009T101500'));
  assert.ok(lines(r).includes('CATEGORIES:health,dental'));
  assert.ok(lines(r).includes('LOCATION:Main St\\, Suite 2'));
  assert.ok(lines(r).join('').includes('DESCRIPTION:Scheduled\\nBring the forms\\nand the insurance card.'), lines(r).join(' | '));
});

test('the body is cut at 400 characters with an ellipsis, and a heading with no body has none', () => {
  const long = 'word '.repeat(100);
  const r = only(build(`* Long\nSCHEDULED: <2026-10-09 Fri>\n${long}\n`));
  const unfolded = r.ics.replace(/\r\n /g, ''); // long lines are folded on the wire
  const description = unfolded.split('\r\n').find((l) => l.startsWith('DESCRIPTION:')).slice(12).replace(/\\n/g, '\n');
  const body = description.replace(/^Scheduled\n/, '');
  assert.ok(body.length <= 400 && body.endsWith('\u2026'), `${body.length}: ${body.slice(-12)}`);
  assert.ok(lines(only(build('* Short\nSCHEDULED: <2026-10-09 Fri>\n'))).includes('DESCRIPTION:Scheduled'));
});

test('a diary-sexp line in a heading\u2019s body is not part of its description', () => {
  const r = only(build('* Cal\nSCHEDULED: <2026-10-09 Fri>\nreal text\n%%(diary-sunrise)\n'));
  const joined = r.ics.replace(/\r\n /g, '');
  assert.ok(joined.includes('real text') && !joined.includes('diary-sunrise'));
});

test('the title of an event written as a timestamp in the heading has no timestamp text in it', () => {
  assert.deepEqual(summaries(build('* Dentist <2026-10-20 Tue 09:00-10:00>\n')), ['Dentist']);
  assert.deepEqual(summaries(build('* <2026-10-20 Tue>\n')), ['<2026-10-20 Tue>'], 'a title that is only a timestamp keeps it, rather than being empty');
});

test('ids are the exporter\u2019s, so an event a server already holds is updated in place, not replaced', () => {
  const text = '* TODO Ship\nSCHEDULED: <2026-10-06 Tue>\n* Meet <2026-10-07 Wed 14:00>\n';
  const [ship, meet] = parseOrg(text).children;
  const uids = [...build(text).values()].map((r) => r.uid).sort();
  assert.deepEqual(uids, [generateUid('a.org', ship, 'scheduled', 0, new Date(2026, 9, 6)), generateUid('a.org', meet, 'timestamp', 0, new Date(2026, 9, 7, 14, 0))].sort());
});

test('contacts: a birthday line and an "ANNIVERSARY" line give both, the spouse is in the anniversary, and the contacts are those of org-contacts-files', () => {
  const agenda = [{ documentId: 'agenda.org', doc: parseOrg('* B\n%%(org-contacts-anniversaries)\n%%(org-contacts-anniversaries "ANNIVERSARY")\n') }];
  const contacts = [{ documentId: 'contacts.org', doc: parseOrg('* Jane Doe\n:PROPERTIES:\n:BIRTHDAY: 1990-10-08\n:ANNIVERSARY: 1998-10-14\n:SPOUSE: John Doe\n:END:\n') }];
  const m = buildCalendarResources(agenda, { today: TODAY, contactsDocs: contacts });
  assert.deepEqual(summaries(m), ['Anniversary: Jane Doe & John Doe (28th)', 'Birthday: Jane Doe (36th)']);
});

test('a contact that is also in the agenda files is sent once', () => {
  const both = [{ documentId: 'contacts.org', doc: parseOrg('* B\n%%(org-contacts-anniversaries)\n* Jane Doe\n:PROPERTIES:\n:BIRTHDAY: 1990-10-08\n:END:\n') }];
  assert.deepEqual(summaries(buildCalendarResources(both, { today: TODAY, contactsDocs: both })), ['Birthday: Jane Doe (36th)']);
});

test('what was sent for the same item before has the same name on the server, so a later sync updates it in place', () => {
  const first = build('* TODO Ship\nSCHEDULED: <2026-10-06 Tue 09:00>\n');
  const later = build('* TODO Ship\nSCHEDULED: <2026-10-06 Tue 09:00-10:00>\n:PROPERTIES:\n:LOCATION: Office\n:END:\n');
  assert.deepEqual([...later.keys()], [...first.keys()]);
  assert.notEqual([...later.values()][0].hash, [...first.values()][0].hash, 'it changed, so it is sent again');
});

test('a birthday and an anniversary on the SAME day are two events with two different ids (the field is part of the id)', () => {
  const agenda = [{ documentId: 'agenda.org', doc: parseOrg('* B\n%%(org-contacts-anniversaries)\n%%(org-contacts-anniversaries "ANNIVERSARY")\n') }];
  const contacts = [{ documentId: 'contacts.org', doc: parseOrg('* Jane Doe\n:PROPERTIES:\n:BIRTHDAY: 1990-10-08\n:ANNIVERSARY: 2010-10-08\n:SPOUSE: John Doe\n:END:\n') }];
  const m = buildCalendarResources(agenda, { today: TODAY, contactsDocs: contacts });
  assert.equal(m.size, 2);
  assert.equal(new Set([...m.values()].map((r) => r.uid)).size, 2, 'distinct ids, so a server keeps both');
  assert.deepEqual(summaries(m), ['Anniversary: Jane Doe & John Doe (16th)', 'Birthday: Jane Doe (36th)']);
});
