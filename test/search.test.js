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

// ---- regex mode ----------------------------------------------------------

test('regex mode: a pattern matches text a literal query never could', () => {
  const doc = parseOrg('* A\nCall me at 555-1234 or 555-5678.');
  const plainResults = searchDocument(doc, '\\d{3}-\\d{4}');
  assert.equal(plainResults.length, 0, 'plain mode treats regex metacharacters as literal text');

  const regexResults = searchDocument(doc, '\\d{3}-\\d{4}', { useRegex: true });
  assert.equal(regexResults.length, 1);
});

test('regex mode: "." matches any character, unlike plain mode where it is literal', () => {
  const doc = parseOrg('* Heading\ncatXdog catzdog cat dog (no direct match)');
  const plain = searchDocument(doc, 'catXdog');
  assert.equal(plain.length, 1); // literal match only

  const regex = searchDocument(doc, 'cat.dog', { useRegex: true });
  assert.equal(regex.length, 1);
  assert.match(regex[0].snippet, /cat.dog/);
});

test('regex mode is case-insensitive, matching plain mode\u2019s own behavior', () => {
  const doc = parseOrg('* A\nHello WORLD');
  const results = searchDocument(doc, 'hello [wW]orld', { useRegex: true });
  assert.equal(results.length, 1);
});

test('regex mode: an invalid pattern throws a clear, catchable error rather than silently matching nothing', () => {
  const doc = parseOrg('* A\nsome text');
  assert.throws(() => searchDocument(doc, '(unclosed', { useRegex: true }), /Invalid regex/);
});

test('regex mode: an empty query still returns no results without throwing', () => {
  const doc = parseOrg('* A\nsome text');
  assert.deepEqual(searchDocument(doc, '', { useRegex: true }), []);
  assert.deepEqual(searchDocument(doc, '   ', { useRegex: true }), []);
});

test('plain mode is unaffected by the useRegex option defaulting to false when omitted entirely', () => {
  const doc = parseOrg('* A (parenthetical) heading');
  const results = searchDocument(doc, '(parenthetical)');
  assert.equal(results.length, 1, 'a literal paren in the query must match a literal paren in the text, not be treated as a regex group');
});

// ---- properties -----------------------------------------------------------

test('finds a match in a property KEY', () => {
  const doc = parseOrg('* Simmule\n:PROPERTIES:\n:spouse: Jennifer\n:END:');
  const results = searchDocument(doc, 'spouse');
  const propResult = results.find((r) => r.type === 'property');
  assert.ok(propResult);
  assert.equal(propResult.snippet, 'spouse: Jennifer');
});

test('finds a match in a property VALUE', () => {
  const doc = parseOrg('* Simmule\n:PROPERTIES:\n:spouse: Jennifer\n:END:');
  const results = searchDocument(doc, 'Jennifer');
  const propResult = results.find((r) => r.type === 'property');
  assert.ok(propResult);
  assert.equal(propResult.heading.title, 'Simmule');
});

test('only matching properties produce results, not every property on the heading', () => {
  const doc = parseOrg('* Simmule\n:PROPERTIES:\n:fname: Simmule\n:lname: Turner\n:city: Durham\n:END:');
  const results = searchDocument(doc, 'Turner');
  const propResults = results.filter((r) => r.type === 'property');
  assert.equal(propResults.length, 1);
  assert.equal(propResults[0].snippet, 'lname: Turner');
});

test('property search respects regex mode too', () => {
  const doc = parseOrg('* A\n:PROPERTIES:\n:dob: 1965-01-27\n:END:');
  const results = searchDocument(doc, '\\d{4}-\\d{2}-\\d{2}', { useRegex: true });
  const propResult = results.find((r) => r.type === 'property');
  assert.ok(propResult);
});

// ---- TODO keyword / priority -----------------------------------------------

test('finds a match on a heading\u2019s TODO keyword', () => {
  const doc = parseOrg('* TODO Buy milk\n* Just a regular heading');
  const results = searchDocument(doc, 'TODO');
  const headingResults = results.filter((r) => r.type === 'heading');
  assert.equal(headingResults.length, 1);
  assert.equal(headingResults[0].heading.title, 'Buy milk');
});

test('finds a match on a heading\u2019s priority, even when title/tags don\u2019t match', () => {
  const doc = parseOrg('* TODO [#C] Urgent work\n* TODO Regular work');
  const results = searchDocument(doc, 'C');
  const headingResults = results.filter((r) => r.type === 'heading');
  assert.equal(headingResults.length, 1, 'only the [#C] heading should match -- neither title contains a "C" of its own');
  assert.equal(headingResults[0].heading.title, 'Urgent work');
});

test('TODO/priority matches produce a "heading" type result, not a separate type', () => {
  const doc = parseOrg('* TODO [#B] Something');
  const results = searchDocument(doc, 'TODO');
  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'heading');
});

// ---- SCHEDULED/DEADLINE planning -------------------------------------------

test('finds a match in a SCHEDULED timestamp', () => {
  const doc = parseOrg('* A task\nSCHEDULED: <2026-05-15 Fri>');
  const results = searchDocument(doc, '2026-05-15');
  const planningResult = results.find((r) => r.type === 'planning');
  assert.ok(planningResult);
  assert.equal(planningResult.snippet, 'SCHEDULED: <2026-05-15 Fri>');
});

test('finds a match in a DEADLINE timestamp', () => {
  const doc = parseOrg('* A task\nDEADLINE: <2026-06-01 Mon>');
  const results = searchDocument(doc, '2026-06-01');
  const planningResult = results.find((r) => r.type === 'planning');
  assert.ok(planningResult);
  assert.equal(planningResult.snippet, 'DEADLINE: <2026-06-01 Mon>');
});

test('a heading with both SCHEDULED and DEADLINE produces two separate planning results when both match', () => {
  const doc = parseOrg('* A task\nSCHEDULED: <2026-05-15 Fri> DEADLINE: <2026-05-20 Wed>');
  const results = searchDocument(doc, '2026-05');
  const planningResults = results.filter((r) => r.type === 'planning');
  assert.equal(planningResults.length, 2);
});

test('planning search respects regex mode too', () => {
  const doc = parseOrg('* A task\nSCHEDULED: <2026-05-15 Fri +1y>');
  const results = searchDocument(doc, '\\+\\d+y', { useRegex: true });
  const planningResult = results.find((r) => r.type === 'planning');
  assert.ok(planningResult);
});
