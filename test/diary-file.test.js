import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildAgendaItems } from '../src/agenda.js';
import { buildDiaryItems } from '../src/agenda-diary.js';
import { datedEntries, diaryEntryTime, orgTimeOfDay, includedFiles } from '../src/diary-file.js';

// Emacs 29.3 listed the entries of these diary files for every day of 2026 and 2027 (tools/gen-diary-oracle.mjs).
const dir = new URL('./fixtures/diary/', import.meta.url);
const expected = JSON.parse(fs.readFileSync(new URL('expected.json', dir), 'utf8'));
const cases = JSON.parse(fs.readFileSync(new URL('cases.json', dir), 'utf8'));
const read = (/** @type {string} */ f) => fs.readFileSync(new URL(f, dir), 'utf8');
const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const start = new Date(2026, 0, 1);
const end = new Date(2027, 11, 31);

/** @param {any} c @param {boolean} mergeRows */
function appRows(c, mergeRows) {
  const diary = {
    text: read(c.file),
    included: (c.included || []).map((/** @type {string} */ f) => ({ text: read(f) })),
    options: { dateStyle: c.style, abbreviatedYear: c.abbreviatedYear, showHolidays: c.showHolidays, hooks: c.hooks || [], mergeRows },
  };
  /** @type {Map<string, string[]>} */ const byDay = new Map();
  for (const item of buildDiaryItems(diary, start, end, { today: new Date(2026, 9, 18) }, buildAgendaItems)) {
    const k = iso(item.date);
    byDay.set(k, [...(byDay.get(k) || []), item.title]);
  }
  return byDay;
}

for (const c of cases) {
  const emacs = expected.cases.find((/** @type {any} */ x) => x.name === c.name);
  for (const mergeRows of [true, false]) {
    test(`diary "${c.name}" matches Emacs${mergeRows ? ' (rows as Org joins them)' : ' (one row per entry)'}`, () => {
      const got = appRows(c, mergeRows);
      /** @type {Map<string, string[]>} */ const want = new Map();
      for (const d of emacs.days) {
        const rows = mergeRows ? d.org.map((/** @type {string} */ s) => s.trim()) : [...d.hol, ...d.raw.map((/** @type {string} */ e) => e.split('\n').map((l) => l.trim()).filter(Boolean).join('; '))].filter(Boolean);
        if (rows.length) want.set(d.d, rows);
      }
      assert.deepEqual([...got.keys()].sort(), [...want.keys()].sort(), 'the same days');
      for (const [day, rows] of want) assert.deepEqual(got.get(day), rows, day);
    });
  }
}

test('a date alone on a line is not an entry, and an entry can start on the next line', () => {
  const text = '12/26\n   Next line entry\n12/27\n\n12/28\n';
  assert.deepEqual(datedEntries(text, new Date(2026, 11, 26)).map((e) => e.map((l) => l.trim())), [['Next line entry']]);
  assert.deepEqual(datedEntries(text, new Date(2026, 11, 27)), []);
  assert.deepEqual(datedEntries(text, new Date(2026, 11, 28)), []);
});

test('the time of an entry', () => {
  assert.equal(diaryEntryTime('10:00am Brunch'), 1000);
  assert.equal(diaryEntryTime('9pm x'), 2100);
  assert.equal(diaryEntryTime('1130 x'), 1130);
  assert.equal(diaryEntryTime('no time'), -9999);
  assert.deepEqual(orgTimeOfDay('10:00am Brunch'), { hour: 10, minute: 0 });
  assert.deepEqual(orgTimeOfDay('Lunch 12pm'), { hour: 12, minute: 0 });
  assert.deepEqual(orgTimeOfDay('9:30pm-10pm z'), { hour: 21, minute: 30 });
  assert.equal(orgTimeOfDay('1130 x'), null);
  assert.equal(orgTimeOfDay('7 x'), null);
});

test('#include lines name the files to read', () => {
  assert.deepEqual(includedFiles('1/1 x\n#include "other/diary"\n#include "b"\n'), ['other/diary', 'b']);
});
