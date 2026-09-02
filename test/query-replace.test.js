import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { emacsRegexToJs } from '../src/emacs-regex.js';
import { createQueryReplace, collectReplaceTargets } from '../src/query-replace.js';

function doc(lines) {
  return parseOrg(lines.join('\n'));
}

// ---- collectReplaceTargets --------------------------------------------

test('collects heading titles, paragraphs, list items, and table cells', () => {
  const d = doc([
    '* Old title',
    'A paragraph about caching.',
    '- a list item about caching',
    '|caching|value|',
  ]);
  const targets = collectReplaceTargets(d);
  const types = targets.map((t) => t.type);
  assert.ok(types.includes('heading'));
  assert.ok(types.includes('paragraph'));
  assert.ok(types.includes('list-item'));
  assert.ok(types.includes('table'));
});

test('THE FEATURE: block content is deliberately excluded -- no dedicated safe setter exists', () => {
  const d = doc(['* A', '#+begin_src js', 'const caching = 1;', '#+end_src']);
  const targets = collectReplaceTargets(d);
  assert.ok(!targets.some((t) => t.type === 'block'));
});

test('nested sub-headings are all included, in document order', () => {
  const d = doc(['* Parent', '** Child one', '** Child two']);
  const targets = collectReplaceTargets(d);
  const titles = targets.filter((t) => t.type === 'heading').map((t) => t.getText());
  assert.deepEqual(titles, ['Parent', 'Child one', 'Child two']);
});

// ---- basic replace/skip/quit walk --------------------------------------

test('replace() substitutes the current match and advances to the next', () => {
  const d = doc(['* A', 'foo bar foo']);
  const re = emacsRegexToJs('foo', 'gi');
  const qr = createQueryReplace(d, re, 'baz');
  qr.replace();
  qr.replace();
  assert.equal(qr.current(), null); // one more call is what actually discovers there's nothing left
  assert.equal(qr.isDone(), true);
  assert.equal(qr.replacedCount(), 2);
  const target = collectReplaceTargets(d).find((t) => t.type === 'paragraph');
  assert.equal(target.getText(), 'baz bar baz');
});

test('skip() leaves a match untouched and advances', () => {
  const d = doc(['* A', 'foo bar foo']);
  const re = emacsRegexToJs('foo', 'gi');
  const qr = createQueryReplace(d, re, 'baz');
  qr.skip();
  qr.replace();
  assert.equal(qr.replacedCount(), 1);
  const target = collectReplaceTargets(d).find((t) => t.type === 'paragraph');
  assert.equal(target.getText(), 'foo bar baz');
});

test('quit() stops the walk, leaving remaining matches (including the current one) untouched', () => {
  const d = doc(['* A', 'foo bar foo']);
  const re = emacsRegexToJs('foo', 'gi');
  const qr = createQueryReplace(d, re, 'baz');
  qr.quit();
  assert.equal(qr.isDone(), true);
  assert.equal(qr.replacedCount(), 0);
  const target = collectReplaceTargets(d).find((t) => t.type === 'paragraph');
  assert.equal(target.getText(), 'foo bar foo');
});

test('replaceAll() replaces every remaining match with no further prompting', () => {
  const d = doc(['* A', 'foo bar foo baz foo']);
  const re = emacsRegexToJs('foo', 'gi');
  const qr = createQueryReplace(d, re, 'X');
  qr.replaceAll();
  assert.equal(qr.isDone(), true);
  assert.equal(qr.replacedCount(), 3);
  const target = collectReplaceTargets(d).find((t) => t.type === 'paragraph');
  assert.equal(target.getText(), 'X bar X baz X');
});

test('current() returns null once the walk is finished', () => {
  const d = doc(['* A', 'no match here']);
  const re = emacsRegexToJs('zzz', 'gi');
  const qr = createQueryReplace(d, re, 'x');
  assert.equal(qr.current(), null);
  assert.equal(qr.isDone(), true);
});

// ---- across multiple target types --------------------------------------

test('walks across headings, paragraphs, list items, and table cells in one pass', () => {
  const d = doc([
    '* caching notes',
    'a paragraph about caching',
    '- a caching list item',
    '|caching|value|',
  ]);
  const re = emacsRegexToJs('caching', 'gi');
  const qr = createQueryReplace(d, re, 'CACHE');
  qr.replaceAll();
  assert.equal(qr.replacedCount(), 4);
  const targets = collectReplaceTargets(d);
  assert.equal(targets.find((t) => t.type === 'heading').getText(), 'CACHE notes');
  assert.equal(targets.find((t) => t.type === 'paragraph').getText(), 'a paragraph about CACHE');
  assert.equal(targets.find((t) => t.type === 'list-item').getText(), 'a CACHE list item');
  assert.equal(targets.find((t) => t.type === 'table').getText(), 'CACHE');
});

// ---- capture groups ------------------------------------------------------

test('THE FEATURE: $1-$9 in the replacement text refer to capture groups, matching real Emacs/JS convention', () => {
  const d = doc(['* A', 'call Bob at 555-1234']);
  const re = emacsRegexToJs('\\(555\\)-\\([0-9]+\\)', 'g');
  const qr = createQueryReplace(d, re, '$2-$1');
  qr.replaceAll();
  const target = collectReplaceTargets(d).find((t) => t.type === 'paragraph');
  assert.equal(target.getText(), 'call Bob at 1234-555');
});

// ---- correctness of underlying document (round-trips through the real parser) --

test('a heading-title replacement survives a real parseOrg/serializeOrg round-trip', () => {
  const d = doc(['* Old title', 'body text']);
  const re = emacsRegexToJs('Old', 'g');
  createQueryReplace(d, re, 'New').replaceAll();
  const reparsed = parseOrg(serializeOrg(d));
  assert.equal(reparsed.children[0].title, 'New title');
});

test('a table-cell replacement preserves the table\u2019s own structure and other cells', () => {
  const d = doc(['* A', '|foo|bar|', '|foo|baz|']);
  const re = emacsRegexToJs('foo', 'g');
  createQueryReplace(d, re, 'QUX').replaceAll();
  const reparsed = parseOrg(serializeOrg(d));
  const table = reparsed.children[0].body.find((n) => n.type === 'table');
  assert.deepEqual(
    table.rows.filter((r) => r.type === 'row').map((r) => r.cells),
    [
      ['QUX', 'bar'],
      ['QUX', 'baz'],
    ]
  );
});

test('a list-item replacement preserves the item\u2019s own checkbox/marker', () => {
  const d = doc(['* A', '- [ ] fix the caching bug']);
  const re = emacsRegexToJs('caching', 'g');
  createQueryReplace(d, re, 'CACHE').replaceAll();
  const reparsed = parseOrg(serializeOrg(d));
  const item = reparsed.children[0].body.find((n) => n.type === 'list').items[0];
  assert.equal(item.checkbox, ' ');
  assert.equal(item.text, 'fix the CACHE bug');
});

// ---- multiple matches within the SAME node --------------------------------

test('multiple matches within the same paragraph are all found and each replaced independently', () => {
  const d = doc(['* A', 'cat sat on the cat mat near another cat']);
  const re = emacsRegexToJs('cat', 'gi');
  const qr = createQueryReplace(d, re, 'dog');
  const results = [];
  let c = qr.current();
  while (c) {
    results.push(c.match[0]);
    qr.replace();
    c = qr.current();
  }
  assert.equal(results.length, 3);
  const target = collectReplaceTargets(d).find((t) => t.type === 'paragraph');
  assert.equal(target.getText(), 'dog sat on the dog mat near another dog');
});

test('a zero-length-capable pattern does not get stuck at the same position when skipped', () => {
  const d = doc(['* A', 'abc']);
  const re = emacsRegexToJs('x*', 'g'); // matches "zero or more x" -- an empty match at every position
  const qr = createQueryReplace(d, re, 'Y');
  const positions = [];
  let c = qr.current();
  while (c && positions.length < 20) {
    positions.push(c.match.index);
    qr.skip();
    c = qr.current();
  }
  assert.ok(positions.length < 20, 'should terminate well before the safety limit');
  // The heading title "A" itself is also a searchable target and matches
  // first (positions 0,1 within "A"), before the paragraph's own matches.
  assert.deepEqual(positions, [0, 1, 0, 1, 2, 3]);
});

// ---- no matches at all -----------------------------------------------------

test('a query with no matches anywhere finishes immediately with zero replacements', () => {
  const d = doc(['* A', 'nothing relevant here']);
  const re = emacsRegexToJs('zzz-not-present', 'gi');
  const qr = createQueryReplace(d, re, 'x');
  assert.equal(qr.current(), null);
  assert.equal(qr.replacedCount(), 0);
});
