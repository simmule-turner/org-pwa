import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, findHeadingLineNumber } from '../src/org-parser.js';
import { matchViewItems, searchViewItems } from '../src/agenda-queries.js';
import { commandItems, parseCustomCommands } from '../src/agenda-commands.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';

// Emacs 29.3 listed these entries, in this order, in the Agenda's Search view (org-search-view) and Match view (org-tags-view)
// for the files in test/fixtures/agenda-search (tools/gen-search-view-oracle.mjs).
const dir = new URL('./fixtures/agenda-search/', import.meta.url);
const expected = JSON.parse(fs.readFileSync(new URL('expected.json', dir), 'utf8'));
const cases = JSON.parse(fs.readFileSync(new URL('../tools/search-view-cases.json', import.meta.url), 'utf8'));
const docs = new Map(['work.org', 'home.org'].map((f) => [f, parseOrg(fs.readFileSync(new URL(f, dir), 'utf8'))]));

for (const c of cases) {
  test(`${c.kind === 'search' ? 'Search' : c.kind === 'command' ? 'Command' : 'Match'} view "${c.name}" lists what Emacs lists`, () => {
    const want = expected.cases.find((/** @type {any} */ x) => x.name === c.name);
    const files = c.files || ['work.org', 'home.org'];
    const list = files.map((f) => ({ documentId: f, doc: /** @type {any} */ (docs.get(f)) }));
    const vars = c.vars || {};
    const sequence = resolveTodoSequence(list[0].doc, ['TODO', 'DONE']);
    const options = {
      todoOnly: c.todoOnly === true,
      doneKeywords: sequence.doneKeywords,
      todoKeywords: sequence.todoKeywords,
      sortingStrategy: c.strategy || null,
      documentOrder: files,
      alwaysBoolean: 'org-agenda-search-view-always-boolean' in vars,
      forceFullWords: 'org-agenda-search-view-force-full-words' in vars,
      tagInheritance: 'org-use-tag-inheritance' in vars ? false : true,
    };
    const command = c.kind === 'command' ? parseCustomCommands(c.commands).find((x) => x.key === c.key) : null;
    const items = command ? commandItems(command, list, list, options) : c.kind === 'search' ? searchViewItems(list, c.query, options) : matchViewItems(list, c.query, options);
    const got = items.map((i) => [i.documentId, findHeadingLineNumber(/** @type {any} */ (docs.get(i.documentId)), /** @type {any} */ (i.heading)) + 1]);
    assert.deepEqual(got, want.rows);
  });
}

import { planSearch, entrySearchText } from '../src/agenda-search.js';
import { withCustomCommand } from '../src/agenda-commands.js';

test('a search string reads as a phrase unless it starts with + - or {', () => {
  assert.equal(planSearch('Q4   plan').boolean, false);
  assert.equal(planSearch('Q4 plan').positives.length, 1);
  assert.equal(planSearch('+budget -draft').boolean, true);
  assert.deepEqual([planSearch('+a -b -c').positives.length, planSearch('+a -b -c').negatives.length], [1, 2]);
  const flags = planSearch('*!:+word');
  assert.deepEqual([flags.headlineOnly, flags.todoOnly], [true, true]);
  assert.equal(planSearch('budget plan', { alwaysBoolean: true }).positives.length, 2);
});

test('a {regexp} that is not valid is an error, not an empty result', () => {
  assert.throws(() => planSearch('{\\(bad}'), /Invalid pattern|Unmatched/i);
});

test('an entry is its heading, planning, drawers and text, not its sub-headings', () => {
  const doc = parseOrg('* TODO A\nSCHEDULED: <2026-10-24 Sat>\nbody\n** B\nchild text\n');
  const text = entrySearchText(/** @type {any} */ (doc.children[0]));
  assert.ok(text.includes('SCHEDULED') && text.includes('body') && !text.includes('child text'));
});

test('saved commands: read, add and replace by key', () => {
  const one = withCustomCommand(null, { key: 'w', description: 'Urgent work', type: 'tags', query: 'work+urgent', sortingStrategy: null });
  assert.equal(one, `'(("w" "Urgent work" tags "work+urgent"))`);
  assert.deepEqual(parseCustomCommands(one).map((c) => [c.key, c.type, c.query]), [['w', 'tags', 'work+urgent']]);
  const two = withCustomCommand(one, { key: 'b', description: 'Budget', type: 'search', query: '+budget "Q4 plan"', sortingStrategy: '((search alpha-up))' });
  assert.deepEqual(parseCustomCommands(two).map((c) => [c.key, c.type, c.sortingStrategy]), [['w', 'tags', null], ['b', 'search', '((search alpha-up))']]);
  const replaced = withCustomCommand(two, { key: 'w', description: 'Urgent', type: 'tags-todo', query: 'urgent', sortingStrategy: null });
  assert.deepEqual(parseCustomCommands(replaced).map((c) => [c.key, c.type, c.query]), [['w', 'tags-todo', 'urgent'], ['b', 'search', '+budget "Q4 plan"']]);
  assert.equal(parseCustomCommands('(("z" "Stuck" stuck "") ("a" "Agenda" agenda ""))').map((c) => c.key).join(), 'a');
  assert.deepEqual(parseCustomCommands(''), []);
});

test('a Match row and a Search row name the same category: the CATEGORY property, else the file\u2019s own as the Agenda names it', () => {
  const doc = parseOrg('* TODO One :a:\n* TODO Two :a:\n:PROPERTIES:\n:CATEGORY: Chores\n:END:\n');
  const list = [{ documentId: '\u0000unsaved-new-document', doc }];
  const match = matchViewItems(list, 'a').map((i) => i.category);
  const search = searchViewItems(list, 'Two').map((i) => i.category);
  assert.equal(match[1], 'Chores');
  assert.equal(search[0], 'Chores');
  assert.equal(match[0], searchViewItems(list, 'One')[0].category);
  assert.ok(!String(match[0]).includes('unsaved-new-document'), String(match[0]));
});
