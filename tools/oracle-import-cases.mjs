// @ts-check
/**
 * Inputs of test/fixtures/oracle-import.json: iCalendar text for Emacs's `icalendar-import-buffer` (the one import Emacs 29.3 batch
 * has that the app also has; contacts have no Emacs equivalent: org-vcard is a separate package, and org-table-import /
 * org-table-convert-region have no counterpart in the app). Times are UTC or floating, so the answers do not depend on the machine.
 */
/** @param {string[]} lines @returns {string} */
const cal = (...lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...lines, 'END:VCALENDAR', ''].join('\r\n');
/** @param {...string} lines */
const ev = (...lines) => ['BEGIN:VEVENT', 'UID:u@x', 'DTSTAMP:20261001T000000Z', ...lines, 'END:VEVENT'].join('\r\n');

/** @type {string[]} */
export const CASES = [];
/** Each argument is the body of one calendar. @param {...string} xs */
const add = (...xs) => { for (const x of xs) CASES.push(cal(x)); };
// single events
for (const [s, e] of [['20261005T090000Z', '20261005T103000Z'], ['20261005T090000', '20261005T103000'], ['20261005T000000Z', '20261005T235900Z'], ['20261005T230000Z', '20261006T010000Z'], ['20261231T233000Z', '20270101T003000Z'], ['20240229T120000Z', '20240229T130000Z'], ['20261005T090000Z', ''], ['20261005T090000', '']]) {
  add(ev(`DTSTART:${s}`, ...(e ? [`DTEND:${e}`] : []), 'SUMMARY:Meeting'));
}
add(ev('DTSTART:20261005T090000Z', 'DURATION:PT1H30M', 'SUMMARY:Dur'), ev('DTSTART:20261005T090000Z', 'DURATION:PT45M', 'SUMMARY:Dur45'), ev('DTSTART:20261005T090000Z', 'DURATION:P1D', 'SUMMARY:DurDay'), ev('DTSTART;VALUE=DATE:20261005', 'DURATION:P3D', 'SUMMARY:DurDays'));
// all-day and multi-day
add(ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:Holiday'), ev('DTSTART;VALUE=DATE:20261005', 'DTEND;VALUE=DATE:20261006', 'SUMMARY:Holiday1'), ev('DTSTART;VALUE=DATE:20261010', 'DTEND;VALUE=DATE:20261013', 'SUMMARY:Trip'), ev('DTSTART;VALUE=DATE:20261231', 'DTEND;VALUE=DATE:20270103', 'SUMMARY:NewYear'), ev('DTSTART;VALUE=DATE:20240228', 'DTEND;VALUE=DATE:20240302', 'SUMMARY:Leap'), ev('DTSTART:20261005T090000Z', 'DTEND:20261007T170000Z', 'SUMMARY:Conference'));
// text
for (const sm of ['Dentist\\, Dr. Who', 'Semi\\;colon', 'Back\\\\slash', 'Line\\nbreak', 'Tab\tchar', 'Ünïcode ✓', '  spaced  ', '', 'a%b', 'x\\Ny', '*star*', 'with [brackets]', 'Q: "quoted"', 'apostrophe\'s']) add(ev('DTSTART;VALUE=DATE:20261005', `SUMMARY:${sm}`));
add(ev('DTSTART;VALUE=DATE:20261005'));
add(ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:Folded summary that is long enough to be folded by a producer of the calendar text because', ' it goes past seventy-five octets'));
add(ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:One', 'DESCRIPTION:Line one\\nLine two'), ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:One', 'DESCRIPTION:Single'), ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:One', 'DESCRIPTION:Comma\\, semicolon\\; colon: back\\\\'), ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:One', 'DESCRIPTION:'), ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:One', 'DESCRIPTION:Folded description text that is long', '  and continues here'));
add(ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:Loc', 'LOCATION:Main St 1'), ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:Loc', 'LOCATION:Room\\, 5'), ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:Url', 'URL:http://example.org/a?b=c'), ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:St', 'STATUS:CANCELLED'), ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:St', 'STATUS:TENTATIVE'), ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:Cls', 'CLASS:PRIVATE'), ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:Org', 'ORGANIZER;CN=Bob:mailto:bob@x.org'), ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:Cat', 'CATEGORIES:A,B'), ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:Att', 'ATTENDEE;CN=Al:mailto:al@x.org'));
// recurrence
for (const rule of ['FREQ=DAILY', 'FREQ=DAILY;INTERVAL=3', 'FREQ=WEEKLY', 'FREQ=WEEKLY;INTERVAL=2', 'FREQ=MONTHLY', 'FREQ=MONTHLY;INTERVAL=2', 'FREQ=YEARLY', 'FREQ=YEARLY;INTERVAL=2', 'FREQ=WEEKLY;COUNT=4', 'FREQ=DAILY;UNTIL=20261231T000000Z', 'FREQ=WEEKLY;BYDAY=MO,WE', 'FREQ=MONTHLY;BYDAY=2TU', 'FREQ=MONTHLY;BYMONTHDAY=5', 'FREQ=YEARLY;BYMONTH=10', 'FREQ=WEEKLY;BYDAY=MO', 'FREQ=HOURLY', 'FREQ=DAILY;COUNT=1']) {
  add(ev('DTSTART;VALUE=DATE:20261005', `RRULE:${rule}`, 'SUMMARY:Rep'), ev('DTSTART:20261005T090000Z', 'DTEND:20261005T100000Z', `RRULE:${rule}`, 'SUMMARY:RepT'));
}
add(ev('DTSTART;VALUE=DATE:20261005', 'RRULE:FREQ=WEEKLY', 'EXDATE;VALUE=DATE:20261012', 'SUMMARY:Ex'));
// several events, odd input
add(ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:A') + '\r\n' + ev('DTSTART;VALUE=DATE:20261006', 'SUMMARY:B'));
add(ev('SUMMARY:NoStart'), ev('DTSTART:garbage', 'SUMMARY:BadStart'), ev('DTSTART;VALUE=DATE:20261305', 'SUMMARY:BadMonth'), ev('DTSTART;VALUE=DATE:20261005', 'DTEND;VALUE=DATE:20261001', 'SUMMARY:EndBefore'));
add(['BEGIN:VTODO', 'UID:t@x', 'SUMMARY:Task', 'DUE:20261010T000000Z', 'END:VTODO'].join('\r\n'));
add(['BEGIN:VJOURNAL', 'UID:j@x', 'DTSTART;VALUE=DATE:20261010', 'SUMMARY:Journal', 'END:VJOURNAL'].join('\r\n'));
add('');
add(ev('DTSTART;VALUE=DATE:20261005', 'SUMMARY:LF only').replace(/\r\n/g, '\n'));
add(ev('DTSTART;VALUE=DATE:20261005', 'summary:lower'), ev('dtstart;value=date:20261005', 'SUMMARY:lowerprop'));
add(ev('DTSTART;TZID=UTC:20261005T090000', 'SUMMARY:TzidUtc'), ev('DTSTART;TZID=Etc/UTC:20261005T090000', 'SUMMARY:TzidEtc'));
