import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { exportToIcalendar } from '../src/export-icalendar.js';

const TODAY = new Date(2026, 6, 31, 12, 0, 0);

function docs(text, documentId = 'test.org') {
  return [{ documentId, doc: parseOrg(text) }];
}

// ---- structure --------------------------------------------------------

test('produces a well-formed VCALENDAR wrapper with required top-level fields', () => {
  const ics = exportToIcalendar(docs('* Just a heading, nothing dated\n'), { today: TODAY });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /VERSION:2\.0\r\n/);
  assert.match(ics, /PRODID:.+\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test('every line uses CRLF line endings, per RFC 5545', () => {
  const ics = exportToIcalendar(docs('* Task\nSCHEDULED: <2026-08-01 Sat>\n'), { today: TODAY });
  assert.ok(ics.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics)); // no bare \n not preceded by \r
});

test('a document with nothing dated produces zero VEVENTs but still a valid, empty calendar', () => {
  const ics = exportToIcalendar(docs('* Nothing dated here\nJust prose.\n'), { today: TODAY });
  assert.ok(!ics.includes('BEGIN:VEVENT'));
  assert.match(ics, /BEGIN:VCALENDAR[\s\S]*END:VCALENDAR/);
});

test('BEGIN:VEVENT and END:VEVENT counts always match (no unbalanced components)', () => {
  const ics = exportToIcalendar(
    docs(
      '* A\nSCHEDULED: <2026-08-01 Sat>\n* B\nDEADLINE: <2026-08-02 Sun -3d>\n* C\n:PROPERTIES:\n:BIRTHDAY: 1990-01-01 Birthday\n:END:\n* Trigger\n%%(org-contacts-anniversaries)\n'
    ),
    { today: TODAY }
  );
  const begins = (ics.match(/BEGIN:VEVENT/g) || []).length;
  const ends = (ics.match(/END:VEVENT/g) || []).length;
  assert.equal(begins, ends);
  assert.ok(begins >= 3);
});

// ---- SCHEDULED / DEADLINE -----------------------------------------------

test('a SCHEDULED timestamp becomes an all-day VEVENT with VALUE=DATE', () => {
  const ics = exportToIcalendar(docs('* Buy groceries\nSCHEDULED: <2026-08-05 Wed>\n'), { today: TODAY });
  assert.match(ics, /SUMMARY:Buy groceries/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260805/);
  assert.match(ics, /DESCRIPTION:Scheduled/);
});

test('a DEADLINE timestamp becomes a VEVENT labeled Deadline', () => {
  const ics = exportToIcalendar(docs('* Submit report\nDEADLINE: <2026-08-10 Mon>\n'), { today: TODAY });
  assert.match(ics, /SUMMARY:Submit report/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260810/);
  assert.match(ics, /DESCRIPTION:Deadline/);
});

test('a heading with BOTH SCHEDULED and DEADLINE produces two separate VEVENTs', () => {
  const ics = exportToIcalendar(docs('* Task\nSCHEDULED: <2026-08-01 Sat> DEADLINE: <2026-08-05 Wed>\n'), { today: TODAY });
  const count = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(count, 2);
});

test('a timestamp with a time component becomes a timed DTSTART, not an all-day VALUE=DATE one', () => {
  const ics = exportToIcalendar(docs('* Meeting\nSCHEDULED: <2026-08-05 Wed 14:30>\n'), { today: TODAY });
  assert.match(ics, /DTSTART:20260805T1430/);
  assert.doesNotMatch(ics, /DTSTART;VALUE=DATE/);
});

// ---- repeaters -> RRULE -------------------------------------------------

test('a weekly repeater (+1w) becomes RRULE:FREQ=WEEKLY;INTERVAL=1', () => {
  const ics = exportToIcalendar(docs('* Task\nSCHEDULED: <2026-08-01 Sat +1w>\n'), { today: TODAY });
  assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=1/);
});

test('a monthly repeater with an interval (+2m) becomes RRULE:FREQ=MONTHLY;INTERVAL=2', () => {
  const ics = exportToIcalendar(docs('* Task\nSCHEDULED: <2026-08-01 Sat +2m>\n'), { today: TODAY });
  assert.match(ics, /RRULE:FREQ=MONTHLY;INTERVAL=2/);
});

test('all three repeater marks (+, ++, .+) produce the same RRULE, matching this app\u2019s own agenda semantics', () => {
  const plus = exportToIcalendar(docs('* A\nSCHEDULED: <2026-08-01 Sat +1w>\n'), { today: TODAY });
  const doublePlus = exportToIcalendar(docs('* A\nSCHEDULED: <2026-08-01 Sat ++1w>\n'), { today: TODAY });
  const dotPlus = exportToIcalendar(docs('* A\nSCHEDULED: <2026-08-01 Sat .+1w>\n'), { today: TODAY });
  const extractRrule = (s) => s.match(/RRULE:[^\r]+/)[0];
  assert.equal(extractRrule(plus), extractRrule(doublePlus));
  assert.equal(extractRrule(plus), extractRrule(dotPlus));
});

test('no repeater means no RRULE line at all', () => {
  const ics = exportToIcalendar(docs('* Task\nSCHEDULED: <2026-08-01 Sat>\n'), { today: TODAY });
  assert.doesNotMatch(ics, /RRULE:/);
});

// ---- deadline delay -> VALARM --------------------------------------------

test('a DEADLINE with a delay/warning-period suffix becomes a VALARM with the correct TRIGGER', () => {
  const ics = exportToIcalendar(docs('* Task\nDEADLINE: <2026-08-10 Mon -3d>\n'), { today: TODAY });
  assert.match(ics, /BEGIN:VALARM/);
  assert.match(ics, /ACTION:DISPLAY/);
  assert.match(ics, /TRIGGER:-P3D/);
  assert.match(ics, /END:VALARM/);
});

test('a SCHEDULED delay (real org syntax also allows it there) does NOT produce a VALARM -- only DEADLINE\u2019s delay is treated as a reminder here', () => {
  const ics = exportToIcalendar(docs('* Task\nSCHEDULED: <2026-08-01 Sat -3d>\n'), { today: TODAY });
  assert.doesNotMatch(ics, /VALARM/);
});

test('a DEADLINE with no delay produces no VALARM at all', () => {
  const ics = exportToIcalendar(docs('* Task\nDEADLINE: <2026-08-10 Mon>\n'), { today: TODAY });
  assert.doesNotMatch(ics, /VALARM/);
});

// ---- plain title timestamp -----------------------------------------------

test('a plain active timestamp in a heading title becomes a VEVENT', () => {
  const ics = exportToIcalendar(docs('* Jane Doe <2000-01-01 Sat +1y>\n'), { today: TODAY });
  assert.match(ics, /SUMMARY:Jane Doe/);
  assert.match(ics, /DTSTART;VALUE=DATE:20000101/);
  assert.match(ics, /RRULE:FREQ=YEARLY;INTERVAL=1/);
});

test('an inactive [timestamp] in a heading title is excluded, matching real org\u2019s own agenda rule', () => {
  const ics = exportToIcalendar(docs('* Jane Doe [2000-01-01 Sat]\n'), { today: TODAY });
  assert.doesNotMatch(ics, /BEGIN:VEVENT/);
});

test('a title timestamp is skipped when the heading already has its own SCHEDULED/DEADLINE (no double entry)', () => {
  const ics = exportToIcalendar(docs('* Jane Doe <2000-01-01 Sat>\nSCHEDULED: <2026-08-01 Sat>\n'), { today: TODAY });
  const count = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(count, 1); // only the SCHEDULED one, not also the title timestamp
});

// ---- org-contacts-anniversaries ------------------------------------------

test('org-contacts-anniversaries produces a yearly-recurring VEVENT when the trigger is present', () => {
  const ics = exportToIcalendar(
    docs('* Jane Doe\n:PROPERTIES:\n:BIRTHDAY: 1989-11-02 Birthday\n:END:\n* Trigger\n%%(org-contacts-anniversaries)\n'),
    { today: TODAY }
  );
  assert.match(ics, /SUMMARY:Jane Doe: Birthday/);
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
  assert.match(ics, /SUMMARY:Jane Doe: Wedding/);
});

// ---- exclusions (matching the agenda view's own defaults) ---------------

test('a DONE heading\u2019s SCHEDULED/DEADLINE is excluded, matching the agenda view\u2019s default completed-item exclusion', () => {
  const ics = exportToIcalendar(docs('* DONE Task\nSCHEDULED: <2026-08-01 Sat>\n'), { today: TODAY });
  assert.doesNotMatch(ics, /BEGIN:VEVENT/);
});

test('an archived heading is excluded', () => {
  const ics = exportToIcalendar(docs('* Task :ARCHIVE:\nSCHEDULED: <2026-08-01 Sat>\n'), { today: TODAY });
  assert.doesNotMatch(ics, /BEGIN:VEVENT/);
});

test('a commented heading (title starting with "# ") is excluded, matching real org\u2019s own comment-line convention', () => {
  const ics = exportToIcalendar(docs('* # draft, not ready\nSCHEDULED: <2026-08-01 Sat>\n'), { today: TODAY });
  assert.doesNotMatch(ics, /BEGIN:VEVENT/);
});

// ---- multi-file aggregation ----------------------------------------------

test('aggregates dated items across multiple documents, same as buildAgendaItems\u2019 own multi-file input shape', () => {
  const doc1 = [{ documentId: 'a.org', doc: parseOrg('* Task A\nSCHEDULED: <2026-08-01 Sat>\n') }];
  const doc2 = [{ documentId: 'b.org', doc: parseOrg('* Task B\nSCHEDULED: <2026-08-02 Sun>\n') }];
  const ics = exportToIcalendar([...doc1, ...doc2], { today: TODAY });
  assert.match(ics, /SUMMARY:Task A/);
  assert.match(ics, /SUMMARY:Task B/);
});

// ---- UID stability and escaping ------------------------------------------

test('the same file exported twice produces IDENTICAL UIDs for the same items (deterministic, not random)', () => {
  const source = docs('* Task\nSCHEDULED: <2026-08-01 Sat>\n');
  const ics1 = exportToIcalendar(source, { today: TODAY });
  const ics2 = exportToIcalendar(source, { today: TODAY });
  const uid1 = ics1.match(/UID:[^\r]+/)[0];
  const uid2 = ics2.match(/UID:[^\r]+/)[0];
  assert.equal(uid1, uid2);
});

test('a heading with its own :ID: property uses that as the UID basis, matching real org\u2019s own ox-icalendar.el preference', () => {
  const ics = exportToIcalendar(
    docs('* Task\nSCHEDULED: <2026-08-01 Sat>\n:PROPERTIES:\n:ID: my-stable-id-123\n:END:\n'),
    { today: TODAY }
  );
  assert.match(ics, /UID:my-stable-id-123@org-pwa/);
});

test('two different headings with the same title in the same file get distinguishable UIDs (never silently collide)', () => {
  const ics = exportToIcalendar(
    docs('* Task\nSCHEDULED: <2026-08-01 Sat>\n* Task\nSCHEDULED: <2026-08-02 Sun>\n'),
    { today: TODAY }
  );
  const uids = [...ics.matchAll(/UID:([^\r]+)/g)].map((m) => m[1]);
  assert.equal(new Set(uids).size, uids.length); // every UID actually distinct
});

test('special characters in a heading title (commas, semicolons, backslashes) are correctly escaped per RFC 5545', () => {
  const ics = exportToIcalendar(docs('* Buy milk, eggs; and bread\\ home\nSCHEDULED: <2026-08-01 Sat>\n'), { today: TODAY });
  assert.match(ics, /SUMMARY:Buy milk\\, eggs\\; and bread\\\\ home/);
});

test('a very long summary line gets folded at 75 octets per RFC 5545, continuation lines starting with a space', () => {
  const longTitle = 'A'.repeat(120);
  const ics = exportToIcalendar(docs(`* ${longTitle}\nSCHEDULED: <2026-08-01 Sat>\n`), { today: TODAY });
  const summaryLineStart = ics.indexOf('SUMMARY:');
  const nextCrlf = ics.indexOf('\r\n', summaryLineStart);
  const firstPhysicalLine = ics.slice(summaryLineStart, nextCrlf);
  assert.ok(firstPhysicalLine.length <= 75);
  // the continuation line right after should start with a single space
  const afterFirstLine = ics.slice(nextCrlf + 2);
  assert.equal(afterFirstLine[0], ' ');
});

// ---- DTSTAMP -------------------------------------------------------------

test('DTSTAMP is emitted in real UTC form with a trailing Z, not floating local time', () => {
  const utcNoon = new Date(Date.UTC(2026, 6, 31, 12, 0, 0));
  const ics = exportToIcalendar(docs('* Task\nSCHEDULED: <2026-08-01 Sat>\n'), { today: utcNoon });
  assert.match(ics, /DTSTAMP:20260731T120000Z/);
});
