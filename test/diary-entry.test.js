import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgendaItems } from '../src/agenda.js';
import { checkDiaryLine } from '../src/agenda-diary.js';
import { datedEntries } from '../src/diary-file.js';
import { appendDiaryEntry, entryLine } from '../src/diary-entry.js';

// The strings Emacs 29.3 writes for 25 Dec 2026 (diary-insert-*-entry), by calendar-date-style, and for a block to 3 Jan 2027.
const emacs = {
  american: { date: 'Dec 25, 2026', monthly: '* 25', yearly: 'Dec 25', anniversary: '%%(diary-anniversary 12 25 2026)', block: '%%(diary-block 12 25 2026 1 3 2027)' },
  european: { date: '25 Dec 2026', monthly: '25 * ', yearly: '25 Dec', anniversary: '%%(diary-anniversary 25 12 2026)', block: '%%(diary-block 25 12 2026 3 1 2027)' },
  iso: { date: '2026-12-25', monthly: '*-*-25', yearly: '*-12-25', anniversary: '%%(diary-anniversary 2026 12 25)', block: '%%(diary-block 2026 12 25 2027 1 3)' },
};

test('entry lines are what Emacs writes', () => {
  const date = new Date(2026, 11, 25);
  const endDate = new Date(2027, 0, 3);
  for (const [style, want] of Object.entries(emacs)) {
    const options = { dateStyle: style };
    for (const kind of /** @type {const} */ (['date', 'monthly', 'yearly', 'anniversary', 'block'])) {
      assert.equal(entryLine(kind, { date, endDate, text: 'X' }, options), `${want[kind]} X`, `${style} ${kind}`);
    }
    assert.equal(entryLine('weekly', { date, text: 'X' }, options), 'Friday X');
  }
  assert.equal(entryLine('cyclic', { date, interval: 7, text: 'X' }, { dateStyle: 'american' }), '%%(diary-cyclic 7 12 25 2026) X');
  assert.equal(entryLine('date', { date, text: 'Brunch', time: '10:00am', nonmarking: true }), '&Dec 25, 2026 10:00am Brunch');
});

test('the line written for a day is found on that day, and on no other', () => {
  const date = new Date(2026, 11, 25);
  for (const style of ['american', 'european', 'iso']) {
    const options = { dateStyle: style };
    const lines = {
      date: entryLine('date', { date, text: 'X' }, options),
      weekly: entryLine('weekly', { date, text: 'X' }, options),
      monthly: entryLine('monthly', { date, text: 'X' }, options),
      yearly: entryLine('yearly', { date, text: 'X' }, options),
    };
    const hits = (/** @type {string} */ line, /** @type {Date} */ d) => datedEntries(line, d, options).length;
    assert.equal(hits(lines.date, date), 1, `${style} date`);
    assert.equal(hits(lines.date, new Date(2026, 11, 24)), 0, `${style} date other day`);
    assert.equal(hits(lines.weekly, new Date(2027, 0, 1)), 1, `${style} weekly`);
    assert.equal(hits(lines.weekly, new Date(2027, 0, 2)), 0);
    assert.equal(hits(lines.monthly, new Date(2027, 2, 25)), 1, `${style} monthly`);
    assert.equal(hits(lines.monthly, new Date(2027, 2, 26)), 0);
    assert.equal(hits(lines.yearly, new Date(2028, 11, 25)), 1, `${style} yearly`);
    assert.equal(hits(lines.yearly, new Date(2028, 10, 25)), 0);
  }
});

test('an entry is added at the end, above Local Variables', () => {
  assert.deepEqual(appendDiaryEntry('', 'x'), { text: 'x\n', line: 1 });
  assert.deepEqual(appendDiaryEntry('a\n', 'x'), { text: 'a\nx\n', line: 2 });
  assert.deepEqual(appendDiaryEntry('a', 'x'), { text: 'a\nx\n', line: 2 });
  assert.deepEqual(appendDiaryEntry('a\n\nLocal Variables:\n x\n', 'y'), { text: 'a\n\ny\nLocal Variables:\n x\n', line: 3 });
});

test('Check this line', () => {
  const options = { dateStyle: 'american' };
  const from = new Date(2026, 9, 18);
  const agenda = { today: from };
  const monthly = checkDiaryLine('*/25 Monthly cycle finishes', options, from, agenda, buildAgendaItems);
  assert.equal(monthly.kind, 'dated');
  assert.equal(monthly.form, 'month/day');
  assert.equal(monthly.text, 'Monthly cycle finishes');
  assert.deepEqual(monthly.dates.map((d) => `${d.getMonth() + 1}/${d.getDate()}`), ['10/25', '11/25', '12/25', '1/25', '2/25']);

  const sexp = checkDiaryLine('%%(diary-float 11 4 4) Thanksgiving', options, from, agenda, buildAgendaItems);
  assert.equal(sexp.kind, 'sexp');
  assert.deepEqual(sexp.dates.map((d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`).slice(0, 2), ['2026-11-26', '2027-11-25']);

  assert.equal(checkDiaryLine('Notes like this', options, from, agenda, buildAgendaItems).kind, 'none');
  assert.equal(checkDiaryLine('12/25', options, from, agenda, buildAgendaItems).kind, 'none', 'a date alone is not an entry');
  const iso = checkDiaryLine('2026-12-25 Party', { dateStyle: 'iso' }, from, agenda, buildAgendaItems);
  assert.equal(iso.form, 'year-month-day');
});

import { locateDiaryEntry } from '../src/diary-entry.js';
import { diaryRowsLocated } from '../src/diary-file.js';
import { insertionBetween } from '../src/text-edit.js';
import { isPlainTextFile, documentName } from '../src/plain-file.js';

test('a row knows its lines in the file, and the entry is found again after the file changed', () => {
  const text = ['intro', '12/25  10:00am Brunch', '   at Mom\'s', '12/25 Second', '%%(diary-float 12 5 4) Float'].join('\n');
  const rows = diaryRowsLocated({ text }, new Date(2026, 11, 25), { dateStyle: 'american', showHolidays: false }, () => null);
  assert.deepEqual(rows.map((r) => [r.text, r.startLine, r.endLine]), [['10:00am Brunch; at Mom\'s', 2, 3], ['Second', 4, 4]]);
  const row = /** @type {any} */ (rows[0]);
  assert.deepEqual(locateDiaryEntry(text, row), { startLine: 2, endLine: 3 });
  const moved = `new line\nanother\n${text}`;
  assert.deepEqual(locateDiaryEntry(moved, row), { startLine: 4, endLine: 5 });
  assert.equal(locateDiaryEntry('nothing like it', row), null);
});

test('one insertion turns the old text into the new', () => {
  assert.deepEqual(insertionBetween('a\nb', 'a\nb\nx\n'), { from: 3, to: 3, insert: '\nx\n', selStart: 3, selEnd: 6 });
  assert.deepEqual(insertionBetween('a\n\nLocal Variables:', 'a\n\ny\nLocal Variables:'), { from: 3, to: 3, insert: 'y\n', selStart: 3, selEnd: 5 });
  assert.equal(insertionBetween('abc', 'xyz'), null);
});

test('plain text files', () => {
  assert.equal(isPlainTextFile('diary', 'github'), true);
  assert.equal(isPlainTextFile('notes/packing.txt', 'webdav'), true);
  assert.equal(isPlainTextFile('notes.org', 'github'), false);
  assert.equal(isPlainTextFile('notes.org_archive', 'filesystem'), false);
  assert.equal(isPlainTextFile('x', null), false);
  assert.equal(isPlainTextFile('x', 'help'), false);
  assert.equal(documentName('\u0000unsaved:1|*scratch*'), '*scratch*');
});

import { dateOrderHint, formatEntryDate, parseEntryDate } from '../src/diary-entry.js';

test('dates are typed in the order of the style', () => {
  const d = new Date(2026, 11, 25);
  assert.deepEqual(parseEntryDate('12/25/2026', 'american'), d);
  assert.deepEqual(parseEntryDate('25/12/2026', 'european'), d);
  assert.deepEqual(parseEntryDate('2026-12-25', 'american'), d, 'a year first is the year in any style');
  assert.deepEqual(parseEntryDate('12/25/26'), d);
  assert.equal(parseEntryDate('13/45/2026'), null);
  assert.equal(parseEntryDate('2/30/2026'), null);
  assert.equal(parseEntryDate('soon'), null);
  assert.equal(formatEntryDate(d, 'european'), '25/12/2026');
  assert.equal(formatEntryDate(d, 'iso'), '2026-12-25');
  assert.equal(dateOrderHint('american'), 'month/day/year');
});
