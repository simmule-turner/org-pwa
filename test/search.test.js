import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { searchDocument } from '../src/search.js';

function sampleDoc() {
  return parseOrg(
    [
      '* Projects',
      '** NRP :urgent:',
      'A paragraph about thumbnail caching.',
      '- [ ] fix the caching bug',
      '- [X] add tests',
      '|Date|Value|',
      '|2025-01-01|caching worked|',
      '** RPN calculator',
      'Nothing relevant here.',
      '* Reading list',
      'Book about caching strategies.',
    ].join('\n')
  );
}

test('finds a match in a heading title', () => {
  const results = searchDocument(sampleDoc(), 'RPN');
  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'heading');
  assert.equal(results[0].heading.title, 'RPN calculator');
});

test('finds a match in a tag', () => {
  const results = searchDocument(sampleDoc(), 'urgent');
  assert.equal(results.length, 1);
  assert.equal(results[0].heading.title, 'NRP');
});

test('finds matches in paragraph text, list items, and table cells, all belonging to the right heading', () => {
  const results = searchDocument(sampleDoc(), 'caching');
  const types = results.map((r) => r.type).sort();
  assert.deepEqual(types, ['list-item', 'paragraph', 'paragraph', 'table']);
  assert.ok(results.every((r) => r.heading.title === 'NRP' || r.heading.title === 'Reading list'));
});

test('search is case-insensitive', () => {
  const results = searchDocument(sampleDoc(), 'CACHING');
  assert.ok(results.length > 0);
});

test('THE POINT OF THIS FEATURE: finds matches inside a folded/collapsed heading, since search must not depend on current fold state', () => {
  const doc = sampleDoc();
  doc.children[0].collapsed = true; // "Projects" fully folded — NRP and its content are hidden from the outline
  const results = searchDocument(doc, 'thumbnail');
  assert.equal(results.length, 1);
  assert.equal(results[0].heading.title, 'NRP');
});

test('finds matches inside a heading whose body is hidden via bodyHidden (content mode)', () => {
  const doc = sampleDoc();
  doc.children[0].children[0].bodyHidden = true; // NRP's body text hidden
  const results = searchDocument(doc, 'thumbnail');
  assert.equal(results.length, 1);
});

test('empty or whitespace-only query returns no results rather than matching everything', () => {
  assert.deepEqual(searchDocument(sampleDoc(), ''), []);
  assert.deepEqual(searchDocument(sampleDoc(), '   '), []);
});

test('no matches returns an empty array, not null/undefined', () => {
  const results = searchDocument(sampleDoc(), 'nonexistentxyz');
  assert.deepEqual(results, []);
});

test('snippet centers roughly on the match rather than always showing the start of the text', () => {
  const doc = parseOrg(
    ['* Notes', 'A very long line of text padding padding padding padding TARGETWORD more padding after it too'].join(
      '\n'
    )
  );
  const results = searchDocument(doc, 'TARGETWORD');
  assert.match(results[0].snippet, /TARGETWORD/);
  assert.ok(results[0].snippet.length < 100); // actually trimmed, not the whole line
});

test('results are in document order', () => {
  const doc = parseOrg(['* First match', '* Second match', '* Third match'].join('\n'));
  const results = searchDocument(doc, 'match');
  assert.deepEqual(
    results.map((r) => r.heading.title),
    ['First match', 'Second match', 'Third match']
  );
});
