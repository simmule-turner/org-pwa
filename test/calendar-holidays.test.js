import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as c from '../src/calendar-conv.js';
import { holidayList, DEFAULT_LISTS, HOLIDAY_GROUPS } from '../src/calendar-holidays.js';
import { holidaysOn, setHolidayConfig, setHolidayZone, applyHolidayVariables } from '../src/holidays.js';
import { runInit, listItems } from '../src/lisp-read.js';
import { datedEntriesAt } from '../src/diary-file.js';
import { nonGregorianDateLine } from '../src/diary-nongregorian.js';
import { evaluateSexpr, parseSexpr } from '../src/sexp-eval.js';

// Emacs 29.3 gave these (test/fixtures/calendar): conversions between calendars, calendar-holiday-list for every month of 2024-2027,
// the diary-hebrew-date family, and the entries diary-list-entries finds with the nongregorian listing hook set.
const dir = new URL('./fixtures/calendar/', import.meta.url);
const read = (/** @type {string} */ f) => fs.readFileSync(new URL(f, dir), 'utf8');
const fmt = (/** @type {number[]} */ d) => `(${d.join(' ')})`;

test('calendar conversions match Emacs', () => {
  let n = 0;
  for (const line of read('conversions.txt').split('\n').filter(Boolean)) {
    const m = /^(\d+) g=(\(.*?\)) j=(\(.*?\)) h=(\(.*?\)) i=(\(.*?\)) b=(\(.*?\)) ga=(\d+)$/.exec(line);
    assert.ok(m, line);
    const a = Number(m[1]);
    assert.equal(fmt(c.gregorianFromAbsolute(a)), m[2]);
    assert.equal(fmt(c.julianFromAbsolute(a)), m[3]);
    if (a > 1373429) assert.equal(fmt(c.hebrewFromAbsolute(a)), m[4]);
    assert.equal(fmt(c.islamicFromAbsolute(a)), m[5]);
    assert.equal(fmt(c.bahaiFromAbsolute(a)), m[6]);
    n++;
  }
  assert.ok(n > 300);
});

/** @param {string} flags */
function allHolidays(flags) {
  const vars = runInit(DEFAULT_LISTS + flags, new Map(), {});
  const forms = ['general', 'christian', 'hebrew', 'islamic', 'bahai'].flatMap((g) => listItems(vars.get(`holiday-${g}-holidays`)) || []);
  const out = new Set();
  for (const year of [2024, 2025, 2026, 2027]) {
    for (let month = 1; month <= 12; month++) {
      for (const h of holidayList(forms, { month, year, vars, sexp: null })) out.add(`${h.date[2]}-${String(h.date[0]).padStart(2, '0')}-${String(h.date[1]).padStart(2, '0')} ${h.name}`);
    }
  }
  return [...out].sort().join('\n');
}

test('holidays match calendar-holiday-list, with the all-holidays flags off and on', () => {
  assert.equal(allHolidays(''), read('holidays-default.txt').trim().split('\n').sort().join('\n'));
  assert.equal(
    allHolidays('(setq calendar-christian-all-holidays-flag t calendar-hebrew-all-holidays-flag t calendar-islamic-all-holidays-flag t calendar-bahai-all-holidays-flag t)'),
    read('holidays-all.txt').trim().split('\n').sort().join('\n'),
  );
});

test('holiday groups can be replaced, added to and switched off', () => {
  const on = (/** @type {number} */ m, /** @type {number} */ d, y = 2026) => holidaysOn(new Date(y, m - 1, d));
  setHolidayConfig('');
  assert.deepEqual(on(12, 25), ['Christmas']);
  assert.deepEqual(on(9, 12), ['Rosh HaShanah 5787']);
  setHolidayConfig('(setq holiday-hebrew-holidays nil holiday-christian-holidays nil) (setq holiday-local-holidays \'((holiday-fixed 12 25 "Mine")))');
  assert.deepEqual(on(12, 25), ['Mine']);
  assert.deepEqual(on(9, 12), []);
  setHolidayConfig('(setq calendar-holidays (append holiday-general-holidays holiday-islamic-holidays))');
  assert.deepEqual(on(12, 25), []);
  assert.deepEqual(on(7, 4), ['Independence Day']);
  setHolidayConfig('(setq holiday-local-holidays \'((holiday-sexp (quote (list 3 (+ 20 7) year)) "Sexp Day")))');
  assert.deepEqual(on(3, 27), ['Sexp Day']);
  setHolidayConfig('');
  assert.deepEqual(on(3, 27), []);
  assert.ok(HOLIDAY_GROUPS.includes('holiday-bahai-holidays'));
});

const dates = [[10, 21, 2026], [3, 2, 2026], [2, 27, 2026], [2, 26, 2024], [3, 1, 2024], [3, 21, 2025], [3, 5, 2024], [2, 20, 2024], [1, 1, 500], [1, 1, 1800], [12, 31, 2027], [7, 4, 2026]];

test('diary-hebrew-date, diary-islamic-date and diary-bahai-date match Emacs', () => {
  const got = dates.map((d) => {
    const j = new Date(2000, 0, 1);
    j.setFullYear(d[2], d[0] - 1, d[1]);
    return `(${d.join(' ')})|${['hebrew', 'islamic', 'bahai'].map((k) => nonGregorianDateLine(/** @type {any} */ (k), j)).join('|')}`;
  });
  assert.deepEqual(got, read('datelines.txt').trim().split('\n'));
  const node = parseSexpr('(diary-hebrew-date)');
  assert.equal(evaluateSexpr(node, { candidateDate: new Date(2026, 9, 21), today: new Date() }), 'Hebrew date (until sunset): Heshvan 10, 5787');
});

test('H, I and B diary entries match diary-list-entries', () => {
  const text = read('nongregorian.diary');
  const want = read('nongregorian.expected').trim().split('\n');
  const got = [];
  for (const d of [[10, 21, 2026], [10, 22, 2026], [2, 27, 2026], [3, 2, 2026], [3, 20, 2025], [7, 4, 2026]]) {
    got.push(`== (${d.join(' ')})`);
    const day = new Date(d[2], d[0] - 1, d[1]);
    const found = [...datedEntriesAt(text, day, {})];
    for (const [kind, symbol] of /** @type {const} */ ([['hebrew', 'H'], ['islamic', 'I'], ['bahai', 'B']])) found.push(...datedEntriesAt(text, day, {}, { kind, symbol }));
    for (const e of found) got.push(JSON.stringify(e.lines.join('\n')));
  }
  assert.deepEqual(got, want);
});

test('holiday forms with their optional arguments match Emacs, 2023-2028', () => {
  setHolidayConfig(read('holidays-custom.el'));
  const got = new Set();
  for (let y = 2023; y <= 2028; y++) {
    for (let m = 0; m < 12; m++) {
      for (let d = 1, n = new Date(y, m + 1, 0).getDate(); d <= n; d++) {
        for (const h of holidaysOn(new Date(y, m, d))) got.add(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')} ${h}`);
      }
    }
  }
  setHolidayConfig('');
  const want = read('holidays-custom.txt').trim().split('\n').filter((l) => !/^2022|^2029/.test(l));
  assert.deepEqual([...got].sort(), want.sort());
});

for (const zone of ['America/New_York', 'Europe/Paris', 'Australia/Sydney', 'Asia/Kolkata', 'UTC']) {
  test(`sun-related holidays match Emacs in ${zone}: equinoxes, solstices and daylight saving time`, () => {
    setHolidayZone(zone);
    setHolidayConfig('(setq calendar-holidays holiday-solar-holidays)');
    const got = new Set();
    for (let y = 2024; y <= 2027; y++) {
      for (let m = 0; m < 12; m++) {
        for (let d = 1, n = new Date(y, m + 1, 0).getDate(); d <= n; d++) {
          for (const h of holidaysOn(new Date(y, m, d))) got.add(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')} ${h}`);
        }
      }
    }
    setHolidayConfig('');
    setHolidayZone('America/New_York');
    assert.deepEqual([...got].sort(), read(`solar-${zone.replace('/', '_')}.txt`).trim().split('\n').sort());
  });
}

test('a southern latitude swaps the season names, as in Emacs', () => {
  setHolidayZone('UTC');
  applyHolidayVariables({ 'calendar-latitude': '-33.9', 'org-xx-lisp-init': '(setq calendar-holidays holiday-solar-holidays)' });
  assert.match(holidaysOn(new Date(2026, 2, 20)).join(), /Autumnal Equinox/);
  applyHolidayVariables({});
  setHolidayZone('America/New_York');
  assert.match(holidaysOn(new Date(2026, 2, 20)).join(), /Vernal Equinox/);
});

test('holidays match calendar-holiday-list for every month of 2000-2060, with the all-holidays flags off and on', async () => {
  const { gunzipSync } = await import('node:zlib');
  /** @param {string} flags */
  const wide = (flags) => {
    const vars = runInit(DEFAULT_LISTS + flags, new Map(), {});
    const forms = ['general', 'christian', 'hebrew', 'islamic', 'bahai'].flatMap((g) => listItems(vars.get(`holiday-${g}-holidays`)) || []);
    const out = new Set();
    for (let year = 2000; year <= 2060; year++) {
      for (let month = 1; month <= 12; month++) {
        for (const h of holidayList(forms, { month, year, vars, sexp: null })) {
          if (h.date[2] === year && h.date[0] === month) out.add(`${year}-${String(month).padStart(2, '0')}-${String(h.date[1]).padStart(2, '0')} ${h.name}`);
        }
      }
    }
    return [...out].sort().join('\n');
  };
  const sorted = (/** @type {string} */ t) => t.trim().split('\n').sort().join('\n');
  assert.equal(wide(''), sorted(read('holidays-2000-2060.txt')));
  const flags = '(setq calendar-christian-all-holidays-flag t calendar-hebrew-all-holidays-flag t calendar-islamic-all-holidays-flag t calendar-bahai-all-holidays-flag t)';
  assert.equal(wide(flags), sorted(gunzipSync(fs.readFileSync(new URL('holidays-all-2000-2060.txt.gz', dir))).toString()));
});
