import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatAgendaPrefix, agendaPrefixFormat } from '../src/agenda-prefix.js';

// Emacs 29.3's org-agenda-format-item built each prefix (tools/gen-prefix-oracle.mjs).
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/prefix/cases.json', import.meta.url), 'utf8'));
const { expected } = JSON.parse(fs.readFileSync(new URL('./fixtures/prefix/expected.json', import.meta.url), 'utf8'));

cases.forEach((/** @type {any[]} */ [format, category, time, scheduling, effort], i) => {
  test(`matches Emacs: ${format}`, () => {
    const got = formatAgendaPrefix(format, { category, time: time ? time.padStart(5, '0') + '......' : '', scheduling: scheduling || '', effort: effort || '' });
    assert.equal(got, expected[i]);
  });
});

test('the format may be a string or an alist by view', () => {
  assert.equal(agendaPrefixFormat('"  %-12:c"', 'agenda'), '  %-12:c');
  assert.equal(agendaPrefixFormat('((agenda . "  %-12:c%?-12t% s") (todo . " %i %-12:c"))', 'todo'), ' %i %-12:c');
  assert.equal(agendaPrefixFormat('((agenda . "%c"))', 'todo'), null);
  assert.equal(agendaPrefixFormat('', 'agenda'), null);
});
