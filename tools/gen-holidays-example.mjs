#!/usr/bin/env node
/**
 * Writes examples/holidays.org and test/fixtures/holidays-example.json.
 *
 * Every example is a Lisp init text. It is run in Emacs 29.3 (before the calendar loads, as an init file would) and the holidays of 2026
 * are listed with `list-holidays`; the file shows the lines the example adds to or removes from the default list, or the whole list where
 * that is the point. The fixture keeps those results; test/holidays-example.test.js holds the app to them and checks the file shows them.
 * The table of every entry is checked against what Emacs lists with all the flags on.
 *
 *   node tools/gen-holidays-example.mjs     (needs emacs on the PATH; time zone America/New_York)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ENTRIES, GROUP_FLAGS } from './holidays-entries.mjs';

const YEAR = 2026;
const ALL_FLAGS = `(setq calendar-christian-all-holidays-flag t
      calendar-hebrew-all-holidays-flag t
      calendar-islamic-all-holidays-flag t
      calendar-bahai-all-holidays-flag t
      calendar-chinese-all-holidays-flag t)`;

/** The holidays Emacs lists for `from` to `to` after `init` runs. @param {string} init @param {number} from @param {number} to @returns {string[]} */
function emacsList(init, from, to) {
  const lisp = `(progn ${init} (require 'calendar) (require 'holidays) (list-holidays ${from} ${to}) (with-current-buffer "*Holidays*" (princ (buffer-string))))`;
  const r = spawnSync('emacs', ['--batch', '-Q', '--eval', lisp], { env: { ...process.env, TZ: 'America/New_York', LC_ALL: 'C.UTF-8' }, encoding: 'utf8', maxBuffer: 1e9 });
  if (r.status !== 0) throw new Error(`${init}\n${r.stderr}`);
  return r.stdout.split('\n').filter((l) => l && !l.startsWith('Computing'));
}

/** @param {string} line */
const dateOf = (line) => new Date(line.slice(line.indexOf(',') + 2, line.indexOf(':'))).getTime();
/** The lines of `list` not in `base` marked +, the lines of `base` not in `list` marked -, by date. @param {string[]} base @param {string[]} list */
function diff(base, list) {
  const inBase = new Set(base);
  const inList = new Set(list);
  const out = [...list.filter((l) => !inBase.has(l)).map((l) => ['+', l]), ...base.filter((l) => !inList.has(l)).map((l) => ['-', l])];
  out.sort((a, b) => dateOf(a[1]) - dateOf(b[1]) || (a[0] === '-' ? -1 : 1));
  return out.map(([sign, l]) => `${sign} ${l}`);
}

/** @param {string} text */
const normalize = (text) => text.replace(/ \d{1,2}:\d{2}[ap]m \([A-Z]+\)$/, '').replace(/^(Rosh HaShanah|Islamic New Year) \d+$/, '$1').replace(/^Bahá’í New Year \(Naw-Ruz\) \d+$/, 'Bahá’í New Year (Naw-Ruz)').replace(/^Chinese New Year \(.*\)$/, 'Chinese New Year');
/** @param {string[]} lines */
const names = (lines) => lines.map((l) => normalize(l.slice(l.indexOf(': ') + 2)));

// ---- the cases: [id, heading, text before, init, mode ('diff' from the default list or 'full'), text after] ----------------------
/** @type {{ id: string, title: string, intro: string, init: string, mode: 'diff' | 'full', after?: string }[]} */
const CASES = [];
/** @param {string} id @param {string} title @param {string} intro @param {string} init @param {'diff' | 'full'} [mode] @param {string} [after] */
const add = (id, title, intro, init, mode = 'diff', after) => CASES.push({ id, title, intro, init, mode, after });

// what is on
add('default', 'What is on by default', 'With no Lisp init at all, Emacs lists these (2026, time zone America/New_York). Every ~calendar-*-all-holidays-flag~ is off.', '', 'full');
add('all', 'Everything on', 'Turn all five flags on and every holiday of every group appears: the whole of the table in [[#every-entry][Every entry]], 143 lines in 2026.', ALL_FLAGS, 'full');

// turning things off
add('off-group', 'Switch one group off', 'Set its variable to ~nil~. The sun-related group holds the equinoxes, solstices and the days daylight saving time starts and ends.', '(setq holiday-solar-holidays nil)');
add('off-groups', 'Switch several groups off', 'One ~setq~ may set any number of variables. Each group has its own variable: ~holiday-general-holidays~, ~holiday-christian-holidays~, ~holiday-hebrew-holidays~, ~holiday-islamic-holidays~, ~holiday-bahai-holidays~, ~holiday-oriental-holidays~, ~holiday-solar-holidays~.', '(setq holiday-islamic-holidays nil\n      holiday-bahai-holidays nil\n      holiday-oriental-holidays nil)');
add('off-entry', 'Remove one entry from a group', '~remove~ takes the entry, written as it stands in the group, and the group.', "(setq holiday-general-holidays\n      (remove '(holiday-fixed 2 2 \"Groundhog Day\") holiday-general-holidays))");
add('off-entries', 'Remove several entries', '~remove~ calls nest. An entry is matched as written, quotes and spaces aside, so copy it from the group (the lists are in [[https://git.savannah.gnu.org/cgit/emacs.git/tree/lisp/calendar/holidays.el][holidays.el]]).', "(setq holiday-general-holidays\n      (remove '(holiday-fixed 2 2 \"Groundhog Day\")\n              (remove '(holiday-fixed 4 1 \"April Fools' Day\")\n                      (remove '(holiday-float 10 1 2 \"Columbus Day\")\n                              holiday-general-holidays))))");
add('replace-group', 'Replace a group', 'A group is only a list. Set it to your own entries to change it to another country\'s; this one is France.', "(setq holiday-general-holidays\n      '((holiday-fixed 1 1 \"New Year's Day\")\n        (holiday-fixed 5 1 \"Labour Day\")\n        (holiday-fixed 5 8 \"Victory in Europe Day\")\n        (holiday-fixed 7 14 \"Bastille Day\")\n        (holiday-fixed 11 11 \"Armistice Day\")))", 'full');
add('only-mine', 'Keep only your own', 'Every group off, and the list is yours. ~holiday-local-holidays~ is for holidays of where you live, ~holiday-other-holidays~ for any others; both are always part of the list.', "(setq holiday-general-holidays nil\n      holiday-christian-holidays nil\n      holiday-hebrew-holidays nil\n      holiday-islamic-holidays nil\n      holiday-bahai-holidays nil\n      holiday-oriental-holidays nil\n      holiday-solar-holidays nil)\n(setq holiday-local-holidays\n      '((holiday-fixed 3 14 \"Pi Day\")\n        (holiday-easter-etc 1 \"Easter Monday\")))\n(setq holiday-other-holidays\n      '((holiday-fixed 12 26 \"Boxing Day\")))", 'full');
add('calendar-holidays', 'Name the list yourself', '~calendar-holidays~ is what Emacs uses; the groups are only how it is first put together. Setting it directly (after ~(require \'holidays)~, so the group variables exist) picks the groups you want. Here, the Christian and Islamic groups and nothing else:', "(require 'holidays)\n(setq calendar-holidays\n      (append holiday-christian-holidays\n              holiday-islamic-holidays))", 'full');

// flags
add('flag-christian', 'The longer Christian list', 'The flag adds the days around Lent, Easter and Pentecost, Epiphany, Assumption, Advent, and the Julian Christmas and Greek Orthodox Easter.', '(setq calendar-christian-all-holidays-flag t)');
add('flag-hebrew', 'The longer Hebrew list', 'The flag adds the eves of the festivals, their second and middle days, the special Sabbaths, the fasts, Purim and the days of modern Israel.', '(setq calendar-hebrew-all-holidays-flag t)');
add('flag-islamic', 'The longer Islamic list', 'The flag adds Ashura, the Prophet\'s birthday, the nights of Isra and Mi\'raj, Bara\'at and Qadr, and both Eids.', '(setq calendar-islamic-all-holidays-flag t)');
add('flag-bahai', 'The longer Bahá’í list', 'The flag adds the other nine days of Ridvan, the Day of the Covenant and the Ascension of ‘Abdu’l-Bahá.', '(setq calendar-bahai-all-holidays-flag t)');
add('flag-chinese', 'The longer Chinese list', 'The flag adds the festivals that follow the Chinese calendar. Chinese New Year is always on; the Chinese months are worked out from the new moons and the sun\'s position, as Emacs does.', '(setq calendar-chinese-all-holidays-flag t)');

// adding
add('add-fixed', 'Add a fixed date: holiday-fixed', '~(holiday-fixed MONTH DAY "NAME")~: the same date every year.', "(setq holiday-local-holidays\n      '((holiday-fixed 3 14 \"Pi Day\")\n        (holiday-fixed 6 19 \"Juneteenth\")))");
add('add-float', 'Add "the Nth weekday": holiday-float', '~(holiday-float MONTH DAYNAME N "NAME" [DAY])~. DAYNAME is 0 for Sunday to 6 for Saturday; N counts from the start of the month, or from its end when negative. A DAY makes it the Nth weekday on or after that day: the Tuesday after the first Monday of November is the first Tuesday on or after November 2.', "(setq holiday-local-holidays\n      '((holiday-float 11 2 1 \"Election Day\" 2)\n        (holiday-float 4 5 -1 \"Arbor Day\")))");
add('add-easter', 'Add a day counted from Easter: holiday-easter-etc', '~(holiday-easter-etc DAYS "NAME")~: days after Easter, or before it when negative.', "(setq holiday-local-holidays\n      '((holiday-easter-etc 1 \"Easter Monday\")\n        (holiday-easter-etc 7 \"Low Sunday\")))");
add('add-orthodox', 'Add a day counted from Orthodox Easter or Advent', '~holiday-greek-orthodox-easter~ and ~holiday-advent~ take the same days-and-name arguments.', "(setq holiday-local-holidays\n      '((holiday-greek-orthodox-easter 1 \"Orthodox Easter Monday\")\n        (holiday-advent 7 \"Second Sunday of Advent\")))");
add('add-julian', 'Add a Julian-calendar date: holiday-julian', '~(holiday-julian MONTH DAY "NAME")~: a date on the Julian calendar, which the Orthodox churches that keep it use.', "(setq holiday-local-holidays\n      '((holiday-julian 12 24 \"Orthodox Christmas Eve\")\n        (holiday-julian 1 1 \"Old New Year\")))");
add('add-hebrew', 'Add a Hebrew-calendar date: holiday-hebrew', '~(holiday-hebrew MONTH DAY "NAME")~. Months are numbered from Nisan as 1; Adar is 12 (Adar I in a leap year) and Adar II is 13.', "(setq holiday-local-holidays\n      '((holiday-hebrew 2 14 \"Pesach Sheni\")\n        (holiday-hebrew 5 15 \"Tu B'Av\")))");
add('add-islamic', 'Add an Islamic-calendar date: holiday-islamic', '~(holiday-islamic MONTH DAY "NAME")~. Months are numbered from Muharram as 1.', "(setq holiday-local-holidays\n      '((holiday-islamic 12 9 \"Day of Arafah\")\n        (holiday-islamic 9 17 \"Battle of Badr\")))");
add('add-bahai', 'Add a Bahá’í-calendar date: holiday-bahai', '~(holiday-bahai MONTH DAY "NAME")~. Months are numbered from Bahá as 1, and the first day of each month is its Feast.', "(setq holiday-local-holidays\n      '((holiday-bahai 2 1 \"Feast of Jalál\")\n        (holiday-bahai 5 1 \"Feast of Núr\")))");
add('add-chinese', 'Add a Chinese-calendar date: holiday-chinese', '~(holiday-chinese MONTH DAY "NAME")~. Months are numbered from the first month of the Chinese year.', "(setq holiday-local-holidays\n      '((holiday-chinese 12 8 \"Laba Festival\")\n        (holiday-chinese 12 23 \"Little New Year\")\n        (holiday-chinese 7 15 \"Ghost Festival\")))");
add('add-sexp', 'Add a computed date: holiday-sexp', '~(holiday-sexp EXPR "NAME")~: EXPR gives the date in the variable ~year~ as ~(MONTH DAY YEAR)~, or ~nil~ when there is no holiday that year.', "(setq holiday-local-holidays\n      '((holiday-sexp '(if (zerop (% year 4)) (list 2 29 year)) \"Leap Day\")\n        (holiday-sexp '(calendar-nth-named-day 2 6 3 year) \"Second Saturday of March\")))");

// obscure
add('single-functions', 'Obscure entries one at a time', 'The groups are built from functions you may also call yourself, without a flag: the fasts and Sabbaths around Tisha B\'Av, the miscellaneous Hebrew days, the Qingming Festival and the Chinese winter solstice.', "(setq holiday-local-holidays\n      '((holiday-hebrew-tisha-b-av)\n        (holiday-hebrew-misc)\n        (holiday-chinese-qingming)\n        (holiday-chinese-winter-solstice)))");

export { CASES };

// ---- build ----------------------------------------------------------------------------------------------------------------
const baseLines = emacsList('', YEAR, YEAR);
/** @type {{ id: string, init: string, from: number, to: number, mode: string, expected: string }[]} */
const fixture = [];
/** @type {Record<string, string[]>} */
const results = {};
for (const c of CASES) {
  const lines = emacsList(c.init, YEAR, YEAR);
  const shown = c.mode === 'full' ? lines : diff(baseLines, lines);
  results[c.id] = shown;
  fixture.push({ id: c.id, init: c.init, from: YEAR, to: YEAR, mode: c.mode, expected: shown.join('\n') + '\n' });
}
fs.writeFileSync('test/fixtures/holidays-example.json', JSON.stringify(fixture, null, 1) + '\n');

// the table of every entry, checked against what Emacs lists with everything on
const allNames = new Set(CASES.flatMap(() => []));
const everything = [];
for (let y = 1990; y <= 2060; y++) everything.push(...names(emacsList(ALL_FLAGS, y, y)), ...names(emacsList('', y, y)));
for (const n of everything) allNames.add(n);
const defaultNames = new Set(names(baseLines));
const covered = new Set();
for (const e of ENTRIES) {
  for (const n of e.names) {
    if (!allNames.has(n)) throw new Error(`Emacs lists no "${n}" (row ${e.label})`);
    if (covered.has(n)) throw new Error(`"${n}" is in two rows`);
    covered.add(n);
  }
  const on = e.names.map((n) => defaultNames.has(n));
  if (on.some((x) => x !== on[0])) throw new Error(`row ${e.label} mixes default and flagged entries`);
}
for (const n of allNames) if (!covered.has(n)) throw new Error(`No row for "${n}"`);

/** @param {{ group: string, label: string, names: string[], rule: string, wiki: string }} e */
function row(e) {
  const isDefault = defaultNames.has(e.names[0]);
  const flag = GROUP_FLAGS[/** @type {keyof typeof GROUP_FLAGS} */ (e.group)];
  const when = isDefault ? 'on' : flag ? `needs ~${flag}~` : 'off';
  const link = `[[https://en.wikipedia.org/wiki/${e.wiki}][${e.wiki.replace(/_/g, ' ').replace(/%C3%A1/g, 'á').replace(/%C3%BA/g, 'ú').replace(/%C3%AD/g, 'í').replace(/%CA%BC/g, '’').replace(/%C3%A9/g, 'é')}]]`;
  return `| ${e.label.replace(/\|/g, '/')} | ${e.rule} | ${when} | ${link} |`;
}

const GROUP_TITLES = {
  'holiday-general-holidays': ['General (United States)', 'holiday-general-holidays'],
  'holiday-christian-holidays': ['Christian', 'holiday-christian-holidays'],
  'holiday-hebrew-holidays': ['Hebrew', 'holiday-hebrew-holidays'],
  'holiday-islamic-holidays': ['Islamic', 'holiday-islamic-holidays'],
  'holiday-bahai-holidays': ['Bahá’í', 'holiday-bahai-holidays'],
  'holiday-oriental-holidays': ['Chinese', 'holiday-oriental-holidays'],
  'holiday-solar-holidays': ['Sun-related', 'holiday-solar-holidays'],
};

/** @param {string} id */
const example = (id) => {
  const c = CASES.find((x) => x.id === id);
  if (!c) throw new Error(id);
  const src = `#+begin_src emacs-lisp\n${c.init}\n#+end_src\n`;
  const shown = results[id].join('\n');
  const legend = c.mode === 'diff' ? 'Compared with the default list for 2026 (~+~ is added, ~-~ is gone):' : 'The holidays of 2026:';
  return `** ${c.title}\n${c.intro}\n\n${c.init ? src + '\n' : ''}${legend}\n\n#+begin_example\n${shown || '(no change)'}\n#+end_example\n`;
};

const tables = Object.entries(GROUP_TITLES).map(([group, [title, variable]]) => {
  const rows = ENTRIES.filter((e) => e.group === group);
  return `** ${title}: ~${variable}~\n| Entry | Date | Default | Description |\n|-\n${rows.map(row).join('\n')}\n`;
}).join('\n');

const text = `#+TITLE: Holidays
#+STARTUP: content

The holidays the Agenda, the diary and *List holidays…* show are Emacs's =calendar-holidays=, put together from groups. This file shows which are on, how to turn every one on, how to switch some off, and how to add your own; the results are what Emacs 29.3 listed for 2026 (time zone America/New_York), and a test checks the app lists the same.

* How to try an example
Copy the Lisp into Settings → Advanced → *Lisp init*, then open the palette and run *List holidays…* with 2026 as both years. The same text works in an Emacs init file: put it where it runs before the calendar loads, because Emacs builds =calendar-holidays= from the group variables once, when it loads. (Setting =calendar-holidays= itself works at any time.)

Holidays reach the Agenda through the diary: with =org-agenda-include-diary= on they are the "Diary:" rows. =diary-show-holidays-flag= set to =nil= leaves them out.

* What is on, and what is not
Seven groups come with Emacs, and two more are yours. All are on, except the extra entries each of five groups holds back behind a flag:

| Variable                      | Holds                                              | Flag for the extra entries                  |
|-------------------------------+----------------------------------------------------+---------------------------------------------|
| =holiday-general-holidays=    | United States public days and observances          |                                             |
| =holiday-christian-holidays=  | Ash Wednesday, Good Friday, Easter, Christmas      | =calendar-christian-all-holidays-flag=      |
| =holiday-hebrew-holidays=     | the festivals and Hanukkah                         | =calendar-hebrew-all-holidays-flag=         |
| =holiday-islamic-holidays=    | Islamic New Year, the start of Ramadan             | =calendar-islamic-all-holidays-flag=        |
| =holiday-bahai-holidays=      | the Bahá’í festivals and three days of Ridvan      | =calendar-bahai-all-holidays-flag=          |
| =holiday-oriental-holidays=   | Chinese New Year                                   | =calendar-chinese-all-holidays-flag=        |
| =holiday-solar-holidays=      | equinoxes, solstices, daylight saving time changes |                                             |
| =holiday-local-holidays=      | yours, for where you live (empty)                  |                                             |
| =holiday-other-holidays=      | yours, any others (empty)                          |                                             |

Every flag is =nil= until you set it. The general group is American; "Replace a group" below changes it.

${example('default')}
${example('all')}
* Switch things off
${['off-group', 'off-groups', 'off-entry', 'off-entries', 'replace-group', 'only-mine', 'calendar-holidays'].map((id) => example(id)).join('\n')}
* Turn the longer lists on
Each flag adds entries to one group. The ones you may not know are all here: every line below is one entry of [[#every-entry][Every entry]].

${['flag-christian', 'flag-hebrew', 'flag-islamic', 'flag-bahai', 'flag-chinese'].map((id) => example(id)).join('\n')}
* Add your own
The forms Emacs gives you, each in ~holiday-local-holidays~ (or ~holiday-other-holidays~). The manual describes them in [[https://www.gnu.org/software/emacs/manual/html_node/emacs/Holidays.html][Holidays]] and [[https://www.gnu.org/software/emacs/manual/html_node/emacs/Advanced-Calendar_002fDiary-Usage.html][Advanced Calendar/Diary Usage]]; the source is [[https://git.savannah.gnu.org/cgit/emacs.git/tree/lisp/calendar/holidays.el][holidays.el]].

${['add-fixed', 'add-float', 'add-easter', 'add-orthodox', 'add-julian', 'add-hebrew', 'add-islamic', 'add-bahai', 'add-chinese', 'add-sexp'].map((id) => example(id)).join('\n')}
* The obscure ones
${example('single-functions')}
The Hebrew and Islamic holidays move against the Gregorian calendar, so a holiday you add on those calendars lands on a different day each year. The Chinese holidays do too, and Emacs works out the months itself, so Chinese New Year and the rest need no table.

* Every entry
:PROPERTIES:
:CUSTOM_ID: every-entry
:END:
Every holiday Emacs can list, by group. "on" means the entry is in the default list; "needs" names the flag that adds it. Each row links to a description of the holiday.

${tables}
* Sources
- [[https://www.gnu.org/software/emacs/manual/html_node/emacs/Holidays.html][Holidays]] in the Emacs manual
- [[https://git.savannah.gnu.org/cgit/emacs.git/tree/lisp/calendar/holidays.el][holidays.el]], [[https://git.savannah.gnu.org/cgit/emacs.git/tree/lisp/calendar/cal-china.el][cal-china.el]], [[https://git.savannah.gnu.org/cgit/emacs.git/tree/lisp/calendar/cal-hebrew.el][cal-hebrew.el]], [[https://git.savannah.gnu.org/cgit/emacs.git/tree/lisp/calendar/cal-islam.el][cal-islam.el]] and [[https://git.savannah.gnu.org/cgit/emacs.git/tree/lisp/calendar/cal-bahai.el][cal-bahai.el]]: the rules for each calendar
`;
fs.writeFileSync('examples/holidays.org', text);
console.log(`${CASES.length} cases, ${ENTRIES.length} table rows, ${allNames.size} distinct holiday names`);
