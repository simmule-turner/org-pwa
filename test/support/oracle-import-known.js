/**
 * Where the app's iCalendar import and Emacs 29.3's `icalendar-import-buffer` give different events (tools/oracle-import-cases.mjs),
 * each with its reason. `chosen` is true where the app deliberately differs: an Emacs quirk, or something an Org heading can say
 * and a diary line cannot.
 * @type {{ chosen: boolean, reason: string, match: RegExp }[]}
 */
export const KNOWN = [
  { chosen: true, reason: 'An event that crosses midnight or lasts days with times: Emacs writes a whole-day diary block and loses the times; the heading keeps the timed range.', match: /DTEND:20261006T010000Z|DTEND:20270101T003000Z|DURATION:P1D|DTEND:20261007T170000Z/ },
  { chosen: true, reason: 'Emacs keeps a doubled backslash (`\\\\`) as written; RFC 5545 makes it one backslash and so does the app.', match: /Back\\\\slash|back\\\\\r\n/ },
  { chosen: true, reason: 'A heading cannot start or end with blanks or be empty: the title is trimmed and an event with no SUMMARY is "(no title)".', match: /SUMMARY:  spaced|SUMMARY:\r\n|DTSTART;VALUE=DATE:20261005\r\nEND:VEVENT/ },
  { chosen: true, reason: '`\\N` is a line break in RFC 5545 (as `\\n`); Emacs leaves it as written.', match: /SUMMARY:x\\Ny/ },
  { chosen: true, reason: 'Emacs ignores INTERVAL of a monthly or yearly rule (every month, every year); the app keeps it (+2m, +2y).', match: /FREQ=(MONTHLY|YEARLY);INTERVAL=2/ },
  { chosen: true, reason: 'Emacs drops an hourly rule; the app keeps the rule in an :RRULE: property.', match: /FREQ=HOURLY/ },
  { chosen: true, reason: 'EXDATE (an exception) is written by Emacs as a diary exclusion; the app does not carry exceptions over and says so.', match: /EXDATE/ },
  { chosen: true, reason: 'An event with no DTSTART: Emacs writes an entry with no date; the app has nothing to date it and skips it.', match: /SUMMARY:NoStart/ },
  { chosen: true, reason: 'An end before the start: Emacs writes a block that ends before it begins; the app keeps the start only.', match: /SUMMARY:EndBefore/ },
  { chosen: true, reason: 'A VTODO: Emacs skips tasks; the app makes a TODO heading (README: Import).', match: /BEGIN:VTODO/ },
  { chosen: true, reason: 'Lower-case property names are the same properties in RFC 5545 (the app reads them); Emacs does not recognise them.', match: /summary:lower|dtstart;value=date/ },
];
