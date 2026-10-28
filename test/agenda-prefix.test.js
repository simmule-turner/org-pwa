import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatAgendaPrefix, agendaPrefixFormat, agendaClockText } from '../src/agenda-prefix.js';

// Emacs 29.3's org-agenda-format-item built each prefix (tools/gen-prefix-oracle.mjs).
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/prefix/cases.json', import.meta.url), 'utf8'));
const { expected } = JSON.parse(fs.readFileSync(new URL('./fixtures/prefix/expected.json', import.meta.url), 'utf8'));

cases.forEach((/** @type {any[]} */ [format, category, time, scheduling, effort, parents], i) => {
  test(`matches Emacs: ${format}`, () => {
    const got = formatAgendaPrefix(format, { category, time: time ? time.padStart(5, '0') + '......' : '', scheduling: scheduling || '', effort: effort || '', level: ' '.repeat((parents || []).length + 1), breadcrumbs: parents && parents.length ? parents.join('->') + '->' : '' });
    assert.equal(got, expected[i]);
  });
});

test('the format may be a string or an alist by view', () => {
  assert.equal(agendaPrefixFormat('"  %-12:c"', 'agenda'), '  %-12:c');
  assert.equal(agendaPrefixFormat('((agenda . "  %-12:c%?-12t% s") (todo . " %i %-12:c"))', 'todo'), ' %i %-12:c');
  assert.equal(agendaPrefixFormat('((agenda . "%c"))', 'todo'), null);
  assert.equal(agendaPrefixFormat('', 'agenda'), null);
});

test('a plain string is read as a Lisp string, and the hour is padded with a space as in Emacs', () => {
  assert.equal(agendaPrefixFormat('"%c \\"q\\" \\\\ %t"', 'agenda'), '%c "q" \\ %t');
  assert.equal(agendaPrefixFormat('((agenda . "a\\"b"))', 'agenda'), 'a"b');
  assert.equal(agendaClockText(new Date(2027, 2, 15, 9, 5)), ' 9:05......');
  assert.equal(agendaClockText(new Date(2027, 2, 15, 8, 0), new Date(2027, 2, 15, 9, 30)), ' 8:00-9:30');
  assert.equal(agendaClockText(new Date(2027, 2, 15, 13, 0)), '13:00......');
});
