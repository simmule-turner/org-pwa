import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyViewFilter, emptyViewFilter } from '../src/agenda-filter.js';
import { effortFilterPreset, maxEffortMinutes, parseFilterPreset, presetViewFilter, sortingStrategyEffort } from '../src/agenda-variables.js';
import { getAgendaHideTitleStamps } from '../src/local-variables.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/filter/${name}.json`, import.meta.url), 'utf8'));
const { rows } = read('cases');
const { expected } = read('expected');

// The rows as the app has them: keyword, title and tags make up the text Emacs's regexp filter sees.
const items = rows.map((r) => {
  const m = /^(?:(TODO|NEXT) )?(.*?)(?: :([\w:]+):)?$/.exec(r.txt);
  return { heading: { tags: r.tags }, filterTags: r.tags, category: r.cat, todo: m[1] || '', title: m[2] };
});
const lisp = (list) => `(${list.map((s) => JSON.stringify(s)).join(' ')})`;
const keepIndexes = (filter) => applyViewFilter(items, filter).map((i) => items.indexOf(i));

for (const [key, want] of Object.entries(expected)) {
  test(`the filter keeps what Emacs keeps: ${key}`, () => {
    const colon = key.indexOf(':');
    const type = key.slice(0, colon);
    const arg = JSON.parse(key.slice(colon + 1));
    const vars =
      type === 'tag' ? { 'org-agenda-tag-filter-preset': lisp(arg) }
      : type === 'category' ? { 'org-agenda-category-filter-preset': lisp(arg) }
      : type === 'regexp' ? { 'org-agenda-regexp-filter-preset': lisp(arg) }
      : { 'org-agenda-tag-filter-preset': lisp(arg.tag || []), 'org-agenda-category-filter-preset': lisp(arg.category || []), 'org-agenda-regexp-filter-preset': lisp(arg.regexp || []) };
    assert.deepEqual(keepIndexes(presetViewFilter(vars)), want);
  });
}

test('sorting strategy: only the effort keys of the asked view are read', () => {
  const raw = '((agenda habit-down effort-up) (todo priority-down effort-down) (tags category-keep))';
  assert.equal(sortingStrategyEffort(raw, 'agenda'), 'up');
  assert.equal(sortingStrategyEffort(raw, 'todo'), 'down');
  assert.equal(sortingStrategyEffort('((agenda time-up))', 'agenda'), null);
  assert.equal(sortingStrategyEffort(undefined, 'agenda'), null);
});

test('org-agenda-max-effort: nil, minutes, or minutes per view', () => {
  assert.equal(maxEffortMinutes('nil', 'agenda'), null);
  assert.equal(maxEffortMinutes('240', 'agenda'), 240);
  assert.equal(maxEffortMinutes("'((agenda . 120) (todo . 60))", 'todo'), 60);
  assert.equal(maxEffortMinutes('((agenda . 120))', 'todo'), null);
});

test('filter presets: signs, no sign, and the effort preset', () => {
  assert.deepEqual(parseFilterPreset('("+a" "-b" "c")'), { include: ['a', 'c'], exclude: ['b'] });
  assert.deepEqual(effortFilterPreset('("+<2:00")'), { op: '<', minutes: 120, text: '2:00' });
  assert.equal(effortFilterPreset('nil'), null);
  assert.equal(effortFilterPreset('("+?")'), null);
});

test('a regexp that is not valid is ignored, not an error', () => {
  const filter = { ...emptyViewFilter(), regexps: ['\\(unclosed'] };
  assert.equal(applyViewFilter(items, filter).length, items.length);
});

test('top headings keep only the items under them', () => {
  const rowsWithTop = items.map((i, n) => ({ ...i, topTitle: n < 3 ? 'Work' : 'Home' }));
  assert.equal(applyViewFilter(rowsWithTop, { ...emptyViewFilter(), tops: ['Home'] }).length, 3);
});

test('the title-stamp setting reads the Emacs variable, then defaults to t', () => {
  assert.equal(getAgendaHideTitleStamps({}), true);
  assert.equal(getAgendaHideTitleStamps({ 'org-agenda-remove-times-when-in-prefix': 'nil' }), false);
  assert.equal(getAgendaHideTitleStamps({ 'org-agenda-remove-times-when-in-prefix': 'beg' }), true);
  assert.equal(getAgendaHideTitleStamps({ 'org-xx-agenda-hide-title-stamps': 'nil' }), true, 'the old name is not read');
});
