// The sample habits of examples/habits.org (tools/gen-habits-example.mjs writes the file, test/example-habits.test.js holds the app to it).
// Every graph is drawn for Tuesday 13 October 2026.

export const TODAY = '2026-10-13';

const log = (/** @type {string[]} */ days) => days.map((d) => `- State "DONE"       from "TODO"       [${d}]`).join('\n');

/** @type {{ id: string, title: string, text: string, org: string }[]} */
export const HABITS = [
  {
    id: 'shave',
    title: 'Every two days, no later than every four',
    text: '=.+2d/4d= means every 2 days, and no later than every 4. The habit was done on 8 and 11 October. After each, it turns green when it can be done again and yellow on the last day to do it.',
    org: `* TODO Shave
SCHEDULED: <2026-10-13 Tue .+2d/4d>
:PROPERTIES:
:STYLE: habit
:END:
:LOGBOOK:
${log(['2026-10-11 Sun 20:14', '2026-10-08 Thu 08:00'])}
:END:`,
  },
  {
    id: 'water',
    title: 'Overdue',
    text: 'The plants were last watered on 1 October and are watered every 3 to 5 days. The strip turns red after the last day.',
    org: `* TODO Water the plants
SCHEDULED: <2026-10-04 Sun .+3d/5d>
:PROPERTIES:
:STYLE: habit
:END:
:LOGBOOK:
${log(['2026-10-01 Thu 09:00'])}
:END:`,
  },
  {
    id: 'weekly',
    title: 'Weeks, and a habit that is not due yet',
    text: 'A repeater can count weeks. This habit is done every 2 weeks and was done on 8 October, so today is still blue.',
    org: `* TODO Call home
SCHEDULED: <2026-10-22 Thu .+2w>
:PROPERTIES:
:STYLE: habit
:END:
:LOGBOOK:
${log(['2026-10-08 Thu 18:00'])}
:END:`,
  },
  {
    id: 'new',
    title: 'A habit with no history yet',
    text: 'Until the first completion there is nothing to count from. The days before the scheduled date are blue, it is green from that date, yellow on the last day (3 days after the repeat starts counting) and red after.',
    org: `* TODO Stretch
SCHEDULED: <2026-10-10 Sat .+1d/3d>
:PROPERTIES:
:STYLE: habit
:END:`,
  },
];
