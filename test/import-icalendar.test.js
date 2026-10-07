import test from 'node:test';
import assert from 'node:assert/strict';
import { importIcalendarAsOrgText, parseDuration, parseProperty, repeaterFor, unfold } from '../src/import-icalendar.js';
import { exportToIcalendar } from '../src/export-icalendar.js';
import { findTimestamps } from '../src/org-timestamp.js';
import { buildAgendaItems } from '../src/agenda.js';
import { parseOrg } from '../src/org-parser.js';

const wrap = (...components) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...components.flat(), 'END:VCALENDAR', ''].join('\r\n');
const vevent = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const vtodo = (...lines) => ['BEGIN:VTODO', ...lines, 'END:VTODO'];
const run = (ics, options = {}) => importIcalendarAsOrgText(ics, { zone: 'UTC', ...options });
const text = (ics, options) => run(ics, options).orgText;

test('an all-day event becomes a heading with a date-only timestamp (an all-day DTEND is the day after the last)', () => {
  const out = text(wrap(vevent('SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20261005', 'DTEND;VALUE=DATE:20261006')));
  assert.equal(out, '* Holiday <2026-10-05 Mon>\n');
});

test('an all-day event over several days is org\u2019s own range, ending on its LAST day', () => {
  assert.equal(text(wrap(vevent('SUMMARY:Trip', 'DTSTART;VALUE=DATE:20261005', 'DTEND;VALUE=DATE:20261008'))), '* Trip <2026-10-05 Mon>--<2026-10-07 Wed>\n');
});

test('a floating time (no Z, no TZID) is kept as written, and a start and end in one day make a time range', () => {
  assert.equal(text(wrap(vevent('SUMMARY:Standup', 'DTSTART:20261005T090000', 'DTEND:20261005T093000'))), '* Standup <2026-10-05 Mon 09:00-09:30>\n');
});

test('a time in UTC is shown in the zone it is imported into', () => {
  const ics = wrap(vevent('SUMMARY:Call', 'DTSTART:20261005T130000Z', 'DTEND:20261005T140000Z'));
  assert.equal(text(ics, { zone: 'America/New_York' }), '* Call <2026-10-05 Mon 09:00-10:00>\n');
  assert.equal(text(ics, { zone: 'Asia/Tokyo' }), '* Call <2026-10-05 Mon 22:00-23:00>\n', 'and a day can change with it');
  assert.equal(text(ics, { zone: 'Asia/Tokyo' }).includes('2026-10-05'), true);
});

test('a time in a named zone is converted with that zone\u2019s own rules, so daylight saving is right', () => {
  const summer = wrap(vevent('SUMMARY:S', 'DTSTART;TZID=Europe/Berlin:20260701T090000'));
  const winter = wrap(vevent('SUMMARY:W', 'DTSTART;TZID=Europe/Berlin:20261201T090000'));
  assert.equal(text(summer), '* S <2026-07-01 Wed 07:00>\n', 'Berlin is UTC+2 in July');
  assert.equal(text(winter), '* W <2026-12-01 Tue 08:00>\n', 'and UTC+1 in December');
});

test('the day follows the conversion: a late evening in one zone is the next morning in another', () => {
  assert.equal(text(wrap(vevent('SUMMARY:Late', 'DTSTART;TZID=America/Los_Angeles:20261005T230000')), { zone: 'Europe/Berlin' }), '* Late <2026-10-06 Tue 08:00>\n');
});

test('a zone name the runtime does not know keeps the time as written, and says which name it was', () => {
  const unknown = [];
  const out = text(wrap(vevent('SUMMARY:Out', 'DTSTART;TZID=W. Europe Standard Time:20261005T090000')), { onUnknownTimeZone: (name) => unknown.push(name) });
  assert.equal(out, '* Out <2026-10-05 Mon 09:00>\n');
  assert.deepEqual(unknown, ['W. Europe Standard Time']);
});

test('DURATION stands in for DTEND', () => {
  assert.equal(text(wrap(vevent('SUMMARY:D', 'DTSTART:20261005T090000', 'DURATION:PT1H30M'))), '* D <2026-10-05 Mon 09:00-10:30>\n');
  assert.equal(parseDuration('P1DT2H'), (24 + 2) * 3600 * 1000);
  assert.equal(parseDuration('P2W'), 14 * 86400 * 1000);
  assert.equal(parseDuration('-PT15M'), -15 * 60 * 1000);
  assert.equal(parseDuration('nonsense'), null);
});

test('a timed event that crosses midnight is two timestamps joined by --', () => {
  assert.equal(text(wrap(vevent('SUMMARY:Night', 'DTSTART:20261005T220000', 'DTEND:20261006T020000'))), '* Night <2026-10-05 Mon 22:00>--<2026-10-06 Tue 02:00>\n');
});

test('a recurrence that a repeater says exactly becomes a repeater', () => {
  const rule = (r, start = 'DTSTART:20261005T090000') => text(wrap(vevent('SUMMARY:R', start, `RRULE:${r}`)));
  assert.equal(rule('FREQ=DAILY'), '* R <2026-10-05 Mon 09:00 +1d>\n');
  assert.equal(rule('FREQ=WEEKLY;INTERVAL=2'), '* R <2026-10-05 Mon 09:00 +2w>\n');
  assert.equal(rule('FREQ=WEEKLY;BYDAY=MO'), '* R <2026-10-05 Mon 09:00 +1w>\n', 'BYDAY that only repeats the start\u2019s weekday');
  assert.equal(rule('FREQ=MONTHLY;BYMONTHDAY=5'), '* R <2026-10-05 Mon 09:00 +1m>\n');
  assert.equal(rule('FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=5'), '* R <2026-10-05 Mon 09:00 +1y>\n');
});

test('a recurrence a repeater cannot say is imported ONCE, with the rule kept, and reported (never a repeater that is wrong)', () => {
  const kept = [];
  const out = text(wrap(vevent('SUMMARY:Ends', 'DTSTART:20261005T090000', 'RRULE:FREQ=WEEKLY;COUNT=10')), { onRecurrenceKept: (s) => kept.push(s) });
  assert.equal(out, '* Ends <2026-10-05 Mon 09:00>\n:PROPERTIES:\n:RRULE: FREQ=WEEKLY;COUNT=10\n:END:\n');
  assert.deepEqual(kept, ['Ends']);
  for (const r of ['FREQ=WEEKLY;UNTIL=20270101T000000Z', 'FREQ=WEEKLY;BYDAY=MO,WE,FR', 'FREQ=MONTHLY;BYDAY=2TU', 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', 'FREQ=WEEKLY;BYDAY=TU', 'FREQ=HOURLY']) {
    const o = text(wrap(vevent('SUMMARY:X', 'DTSTART:20261005T090000', `RRULE:${r}`)));
    assert.ok(o.includes(`:RRULE: ${r}`) && !/\+\d[dwmy]/.test(o), r);
  }
});

test('repeaterFor, directly', () => {
  const monday = Date.UTC(2026, 9, 5, 9, 0);
  assert.equal(repeaterFor('FREQ=WEEKLY', monday), '+1w');
  assert.equal(repeaterFor('FREQ=WEEKLY;INTERVAL=0', monday), null);
  assert.equal(repeaterFor('FREQ=WEEKLY;WKST=MO', monday), '+1w', 'the week-start setting changes nothing about which day it falls on');
});

test('the description becomes the body, indented, with escapes undone and no line able to read as a heading', () => {
  const out = text(wrap(vevent('SUMMARY:Notes', 'DTSTART;VALUE=DATE:20261005', 'DESCRIPTION:Line one\\nLine two\\, with a comma\\n* not a heading\\n\\nAfter a blank')));
  assert.equal(out, '* Notes <2026-10-05 Mon>\n  Line one\n  Line two, with a comma\n  * not a heading\n\n  After a blank\n');
  assert.equal(parseOrg(out).children.length, 1, 'still one heading');
});

test('folded lines are joined, whatever the line ending', () => {
  const folded = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:A very long\r\n  title that was folded\r\nDTSTART;VALUE=DATE:20261005\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  assert.equal(text(folded), '* A very long title that was folded <2026-10-05 Mon>\n');
  assert.equal(text(folded.replace(/\r\n/g, '\n')), '* A very long title that was folded <2026-10-05 Mon>\n');
  assert.deepEqual(unfold('A\r\n B\r\nC'), ['AB', 'C']);
});

test('location, link, UID and a cancelled status become properties; categories become tags', () => {
  const out = text(wrap(vevent('UID:u-1@example.com', 'SUMMARY:Lunch', 'DTSTART;VALUE=DATE:20261005', 'LOCATION:Caf\u00e9\\, 5th St', 'URL:https://example.com/e', 'STATUS:CANCELLED', 'CATEGORIES:food,Big Deal', 'CATEGORIES:food,team-lunch')));
  assert.equal(out, '* Lunch <2026-10-05 Mon> :food:Big_Deal:team_lunch:\n:PROPERTIES:\n:UID: u-1@example.com\n:LOCATION: Caf\u00e9, 5th St\n:URL: https://example.com/e\n:STATUS: CANCELLED\n:END:\n');
});

test('an alarm, bookkeeping and X- properties are skipped silently; real data that is not carried over is reported', () => {
  const skipped = [];
  const out = text(wrap(vevent('SUMMARY:Meet', 'DTSTART;VALUE=DATE:20261005', 'DTSTAMP:20260101T000000Z', 'SEQUENCE:3', 'X-GOOGLE-CONFERENCE:https://meet', 'ORGANIZER:mailto:o@x.org', 'ATTENDEE:mailto:a@x.org', 'EXDATE:20261012', ['BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'END:VALARM']).flat()), { onUnmappedProperty: (n) => skipped.push(n) });
  assert.equal(out, '* Meet <2026-10-05 Mon>\n');
  assert.deepEqual(skipped.sort(), ['ATTENDEE', 'EXDATE', 'ORGANIZER']);
});

test('an event with no title is called so, and one with no start is left out', () => {
  assert.equal(text(wrap(vevent('DTSTART;VALUE=DATE:20261005'))), '* (no title) <2026-10-05 Mon>\n');
  const r = run(wrap(vevent('SUMMARY:Nowhen'), vevent('SUMMARY:Has', 'DTSTART;VALUE=DATE:20261005')));
  assert.equal(r.eventCount, 1);
  assert.equal(r.orgText, '* Has <2026-10-05 Mon>\n');
});

test('a task becomes a TODO with DEADLINE and SCHEDULED, a completed one DONE with CLOSED, and priority maps to [#A-C]', () => {
  const open = text(wrap(vtodo('SUMMARY:Pay rent', 'DUE;VALUE=DATE:20261031', 'DTSTART;VALUE=DATE:20261025', 'PRIORITY:1', 'CATEGORIES:home')));
  assert.equal(open, '* TODO [#A] Pay rent :home:\nDEADLINE: <2026-10-31 Sat> SCHEDULED: <2026-10-25 Sun>\n');
  const done = text(wrap(vtodo('SUMMARY:File taxes', 'STATUS:COMPLETED', 'COMPLETED:20261002T101500Z', 'DUE;VALUE=DATE:20261015', 'PRIORITY:5')));
  assert.equal(done, '* DONE [#B] File taxes\nCLOSED: [2026-10-02 Fri 10:15] DEADLINE: <2026-10-15 Thu>\n');
  assert.equal(text(wrap(vtodo('SUMMARY:Later', 'PRIORITY:9'))), '* TODO [#C] Later\n');
});

test('events and tasks are counted separately, and several of each come out in file order', () => {
  const r = run(wrap(vevent('SUMMARY:E1', 'DTSTART;VALUE=DATE:20261005'), vtodo('SUMMARY:T1'), vevent('SUMMARY:E2', 'DTSTART;VALUE=DATE:20261006')));
  assert.deepEqual([r.eventCount, r.todoCount], [2, 1]);
  assert.deepEqual(parseOrg(r.orgText).children.map((h) => h.title.replace(/ <.*$/, '')), ['E1', 'T1', 'E2']);
});

test('nothing to import (empty, garbage, a calendar with no events) gives empty text and zero counts, without throwing', () => {
  for (const input of ['', 'hello', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', null, undefined, 'BEGIN:VEVENT\r\nSUMMARY:no end']) {
    const r = importIcalendarAsOrgText(input, { zone: 'UTC' });
    assert.deepEqual([r.orgText, r.eventCount, r.todoCount], ['', 0, 0], String(input));
  }
});

test('property parsing: parameters, quoted parameters holding colons and semicolons, and the first colon outside quotes', () => {
  assert.deepEqual(parseProperty('DTSTART;TZID=Europe/Berlin:20261005T090000'), { name: 'DTSTART', params: { TZID: 'Europe/Berlin' }, value: '20261005T090000' });
  assert.deepEqual(parseProperty('ATTENDEE;CN="Doe; Jane: Dr":mailto:j@x.org'), { name: 'ATTENDEE', params: { CN: 'Doe; Jane: Dr' }, value: 'mailto:j@x.org' });
  assert.equal(parseProperty('no colon here'), null);
});

test('the result is org the app reads: each heading is found, and the agenda builder shows each event on its day, repeating ones included', () => {
  const out = text(wrap(vevent('SUMMARY:One', 'DTSTART:20261005T090000', 'DTEND:20261005T100000', 'RRULE:FREQ=WEEKLY'), vevent('SUMMARY:Two', 'DTSTART;VALUE=DATE:20261007')));
  const doc = parseOrg(out);
  assert.equal(doc.children.length, 2);
  const items = buildAgendaItems([{ documentId: 'a.org', doc }], { today: new Date(2026, 9, 2, 12), rangeStart: new Date(2026, 9, 1), rangeEnd: new Date(2026, 9, 31) });
  const days = (title) => items.filter((i) => i.heading.title.startsWith(title)).map((i) => i.date.getDate());
  assert.deepEqual(days('One'), [5, 12, 19, 26], 'the weekly event repeats through the month');
  assert.deepEqual(days('Two'), [7]);
});

test('round trip with this app\u2019s own Export > Calendar: what it writes imports back as the same events on the same days', () => {
  const doc = parseOrg('* Dentist <2026-10-05 Mon 09:00-10:00>\n* Pay rent\nDEADLINE: <2026-10-31 Sat>\n* Weekly review <2026-10-09 Fri 16:00 +1w>\n');
  const ics = exportToIcalendar([{ documentId: 'a.org', doc }], { today: new Date(2026, 9, 2, 12) });
  const back = parseOrg(text(ics, { zone: null })); // floating times: no conversion either way
  assert.deepEqual(back.children.map((h) => h.title.replace(/ <.*$/, '')).sort(), ['Dentist', 'Pay rent', 'Weekly review']);
  const first = (title) => findTimestamps(back.children.find((h) => h.title.startsWith(title)).title)[0];
  assert.equal(first('Dentist').date.getDate(), 5);
  assert.equal(first('Dentist').hasTime, true);
  assert.equal(first('Weekly review').repeater, '+1w');
  assert.equal(first('Weekly review').date.getDate(), 9);
  assert.equal(findTimestamps(back.children.find((h) => h.title.startsWith('Pay rent')).title).length, 1, 'a deadline comes back as a dated event too');
});
