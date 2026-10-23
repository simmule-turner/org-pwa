import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { exportToIcalendar } from '../src/export-icalendar.js';

const TODAY = new Date(2026, 6, 31, 12, 0, 0);

function docs(text, documentId = 'test.org') {
  return [{ documentId, doc: parseOrg(text) }];
}

// ---- structure --------------------------------------------------------

// ---- structure --------------------------------------------------------

test('a calendar is a well-formed VCALENDAR whose lines end in CRLF, with balanced components', () => {
  const ics = exportToIcalendar(docs('* Meeting <2026-08-01 Sat 10:00>\n* Other <2026-08-02 Sun>\n'), { today: TODAY });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false);
  assert.equal((ics.match(/^BEGIN:VEVENT/gm) || []).length, 2);
  assert.equal((ics.match(/^END:VEVENT/gm) || []).length, 2);
});

test('a document with nothing dated produces an empty calendar', () => {
  assert.equal((exportToIcalendar(docs('* Nothing dated here\nJust prose.\n'), { today: TODAY }).match(/BEGIN:VEVENT/g) || []).length, 0);
});

test('the same file exported twice gives identical UIDs, and an :ID: is the basis of one', () => {
  const text = '* A <2026-08-01 Sat>\n* B <2026-08-02 Sun>\n:PROPERTIES:\n:ID: abc-123\n:END:\n';
  const uids = (s) => [...s.matchAll(/^UID:(.*)$/gm)].map((m) => m[1]);
  const first = uids(exportToIcalendar(docs(text), { today: TODAY }));
  assert.deepEqual(first, uids(exportToIcalendar(docs(text), { today: TODAY })));
  assert.ok(first[1].includes('abc-123'));
  assert.notEqual(first[0], first[1]);
});

test('two headings with the same title in one file get different UIDs', () => {
  const uids = [...exportToIcalendar(docs('* Same <2026-08-01 Sat>\n* Same <2026-08-01 Sat>\n'), { today: TODAY }).matchAll(/^UID:(.*)$/gm)].map((m) => m[1]);
  assert.equal(new Set(uids).size, 2);
});

test('org-contacts-anniversaries produces a yearly-recurring VEVENT when the trigger is present', () => {
  const ics = exportToIcalendar(
    docs('* Jane Doe\n:PROPERTIES:\n:BIRTHDAY: 1989-11-02 Birthday\n:END:\n* Trigger\n%%(org-contacts-anniversaries)\n'),
    { today: TODAY }
  );
  assert.match(ics, /SUMMARY:Birthday: Jane Doe/);
  assert.match(ics, /DTSTART;VALUE=DATE:19891102/);
  assert.match(ics, /RRULE:FREQ=YEARLY/);
});

test('the BIRTHDAY property is ignored entirely without the trigger line present anywhere', () => {
  const ics = exportToIcalendar(docs('* Jane Doe\n:PROPERTIES:\n:BIRTHDAY: 1989-11-02 Birthday\n:END:\n'), { today: TODAY });
  assert.doesNotMatch(ics, /BEGIN:VEVENT/);
});

test('a nil-year birthday still exports, anchored to the current year (only month/day matter for the recurring rule)', () => {
  const ics = exportToIcalendar(
    docs('* Jane Doe\n:PROPERTIES:\n:BIRTHDAY: nil-11-02 Birthday\n:END:\n* Trigger\n%%(org-contacts-anniversaries)\n'),
    { today: TODAY }
  );
  assert.match(ics, new RegExp(`DTSTART;VALUE=DATE:${TODAY.getFullYear()}1102`));
});

test('a custom org-contacts-birthday-property key is respected, matching agenda.js\u2019s own option', () => {
  const ics = exportToIcalendar(
    docs('* Jane Doe\n:PROPERTIES:\n:ANNIVERSARY: 1989-11-02 Wedding\n:END:\n* Trigger\n%%(org-contacts-anniversaries)\n'),
    { today: TODAY, birthdayProperty: 'ANNIVERSARY' }
  );
  assert.match(ics, /SUMMARY:Wedding: Jane Doe/);
});

// ---- exclusions (matching the agenda view's own defaults) ---------------


test('scope: org-contacts-anniversaries still activates correctly when scoped, if the trigger line is within the scoped subtree', () => {
  const doc = parseOrg(
    '* Project A\n** Jane Doe\n:PROPERTIES:\n:BIRTHDAY: 1989-11-02 Birthday\n:END:\n** Trigger\n%%(org-contacts-anniversaries)\n'
  );
  const scopeHeading = doc.children[0];
  const ics = exportToIcalendar([{ documentId: 't.org', doc }], { today: TODAY, scope: scopeHeading });
  assert.match(ics, /SUMMARY:Birthday: Jane Doe/);
});

// ---- collectCalendarEvents: what the CalDAV mirror builds on ---------------------------------------------


const T = new Date(2026, 9, 2, 12, 0);
const ics = (text, opts = {}) => exportToIcalendar([{ documentId: 'a.org', doc: parseOrg(text) }], { today: T, ...opts });

test('a vCard-imported birthday (a bare date) has a title: "Birthday: Jane Doe", never "…: null"', () => {
  const out = ics('* Cal\n%%(org-contacts-anniversaries)\n* Jane Doe\n:PROPERTIES:\n:BIRTHDAY: 1990-01-08\n:END:\n');
  assert.ok(out.includes('SUMMARY:Birthday: Jane Doe\r\n'), out);
  assert.equal(out.includes('null'), false);
  assert.ok(out.includes('RRULE:FREQ=YEARLY') && out.includes('DESCRIPTION:Birthday: 1990-01-08'), 'one yearly event cannot carry an age, so the date is in the description');
});

test('a tree-style contact\u2019s birthday is exported (it was skipped)', () => {
  const out = ics('* Cal\n%%(org-contacts-anniversaries)\n* Tree Tom\n:PROPERTIES:\n:KIND: individual\n:FIELDTYPE: name\n:END:\n** 1991-10-12\n:PROPERTIES:\n:FIELDTYPE: birthday\n:END:\n');
  assert.ok(out.includes('SUMMARY:Birthday: Tree Tom\r\n'), out);
});

test('a birthday line and an "ANNIVERSARY" line give both, and the anniversary carries the spouse', () => {
  const out = ics('* Cal\n%%(org-contacts-anniversaries)\n%%(org-contacts-anniversaries "ANNIVERSARY")\n* Jane Doe\n:PROPERTIES:\n:BIRTHDAY: 1990-01-08\n:ANNIVERSARY: 1998-06-14\n:SPOUSE: John Doe\n:END:\n');
  assert.ok(out.includes('SUMMARY:Birthday: Jane Doe\r\n') && out.includes('SUMMARY:Anniversary: Jane Doe & John Doe\r\n'), out);
});

test('a FORMAT on the line is used, with its age left out (one yearly event has none)', () => {
  const out = ics('* Cal\n%%(org-contacts-anniversaries "ANNIVERSARY" "Wed: %h and %s (%Y)")\n* Jane Doe\n:PROPERTIES:\n:ANNIVERSARY: 1998-06-14\n:SPOUSE: John Doe\n:END:\n');
  assert.ok(out.includes('SUMMARY:Wed: Jane Doe and John Doe\r\n'), out);
});

test('contactsDocs (org-contacts-files) are the contacts, wherever the trigger line is', () => {
  const agenda = [{ documentId: 'agenda.org', doc: parseOrg('* Cal\n%%(org-contacts-anniversaries)\n* Not a contact here\n:PROPERTIES:\n:BIRTHDAY: 1980-03-03\n:END:\n') }];
  const contactsDocs = [{ documentId: 'contacts.org', doc: parseOrg('* Jane Doe\n:PROPERTIES:\n:BIRTHDAY: 1990-01-08\n:END:\n') }];
  const out = exportToIcalendar(agenda, { today: T, contactsDocs });
  assert.ok(out.includes('SUMMARY:Birthday: Jane Doe') && !out.includes('Not a contact here'));
});


test('the file scope writes everything Emacs does; the agenda scope keeps to its window', async () => {
  const { exportAgendaToIcalendar } = await import('../src/calendar-from-agenda.js');
  const text = '* Far away\nSCHEDULED: <2030-05-01 Wed>\n* Soon\nSCHEDULED: <2026-10-09 Fri>\n* Appointment <2030-06-01 Sat>\n';
  const docs = [{ documentId: 'a.org', doc: parseOrg(text) }];
  const file = exportToIcalendar(docs, { today: T, settings: { useScheduled: ['event-if-not-todo'] } });
  const agenda = exportAgendaToIcalendar(docs, { today: T });
  assert.ok(file.includes('SUMMARY:S: Far away') && file.includes('SUMMARY:S: Soon') && file.includes('SUMMARY:Appointment'));
  assert.ok(!agenda.includes('SUMMARY:Far away') && agenda.includes('SUMMARY:Soon'));
  assert.ok(agenda.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n') && agenda.endsWith('END:VCALENDAR\r\n'));
});

test('the agenda export is the CalDAV mirror\u2019s events: the same ones, in one file', async () => {
  const { exportAgendaToIcalendar } = await import('../src/calendar-from-agenda.js');
  const { buildCalendarResources } = await import('../src/calendar-mirror.js');
  const text = '* TODO Pay\nDEADLINE: <2026-10-31 Sat -3d>\n* Meet <2026-10-07 Wed 14:00-15:00>\n* TODO Habit\nSCHEDULED: <2026-09-01 Tue 07:00 +1d>\n* DONE Old\nSCHEDULED: <2026-10-05 Mon>\n';
  const docs = [{ documentId: 'a.org', doc: parseOrg(text) }];
  const uidsOf = (s) => [...s.matchAll(/^UID:(.*)$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(uidsOf(exportAgendaToIcalendar(docs, { today: T })), [...buildCalendarResources(docs, { today: T }).values()].map((r) => r.uid).sort());
});
