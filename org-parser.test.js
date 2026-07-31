
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg, findHeadingLineNumber, parseTodoKeywordToken, parseTodoSpecValue } from '../src/org-parser.js';

test('parses a basic heading with TODO, priority, and tags', () => {
  const doc = parseOrg('*** TODO [#A] Write report :work:urgent:');
  const h = doc.children[0];
  assert.equal(h.level, 3);
  assert.equal(h.todo, 'TODO');
  assert.equal(h.priority, 'A');
  assert.equal(h.title, 'Write report');
  assert.deepEqual(h.tags, ['work', 'urgent']);
});

test('parses nested headings into a tree', () => {
  const text = [
    '* Top',
    '** Child A',
    '** Child B',
    '*** Grandchild',
  ].join('\n');
  const doc = parseOrg(text);
  assert.equal(doc.children.length, 1);
  const top = doc.children[0];
  assert.equal(top.children.length, 2);
  assert.equal(top.children[1].children[0].title, 'Grandchild');
});

test('parses planning line and property drawer', () => {
  const text = [
    '* TODO Ship it',
    'SCHEDULED: <2026-07-21 Tue>',
    ':PROPERTIES:',
    ':ID: abc-123',
    ':EFFORT: 2h',
    ':END:',
    'Some body text.',
  ].join('\n');
  const doc = parseOrg(text);
  const h = doc.children[0];
  assert.equal(h.planning.scheduled, '<2026-07-21 Tue>');
  assert.equal(h.properties.ID, 'abc-123');
  assert.equal(h.properties.EFFORT, '2h');
  assert.deepEqual(h.propertyOrder, ['ID', 'EFFORT']);
  assert.deepEqual(h.bodyLines, ['Some body text.']);
});

test('honors a #+TODO: line for custom keyword sequences', () => {
  const text = [
    '#+TODO: NEXT WAITING | DONE CANCELLED',
    '* WAITING On review',
    '* CANCELLED Nope',
  ].join('\n');
  const doc = parseOrg(text);
  assert.equal(doc.children[0].todo, 'WAITING');
  assert.equal(doc.children[1].todo, 'CANCELLED');
});

test('document keywords are captured', () => {
  const text = ['#+title: The glories of Org', '#+author: A. Org Writer', '* Heading'].join('\n');
  const doc = parseOrg(text);
  assert.deepEqual(doc.keywords, [
    { key: 'title', value: 'The glories of Org' },
    { key: 'author', value: 'A. Org Writer' },
  ]);
});

test('round-trips structure through parse -> serialize -> parse', () => {
  const text = [
    '#+title: Test doc',
    '* TODO [#A] Write report :work:urgent:',
    'SCHEDULED: <2026-07-21 Tue>',
    ':PROPERTIES:',
    ':ID: abc-123',
    ':END:',
    'Body paragraph one.',
    '** DONE Sub item :done:',
    'CLOSED: <2026-07-19 Sun>',
    'Some notes here.',
  ].join('\n');

  const doc1 = parseOrg(text);
  const text2 = serializeOrg(doc1);
  const doc2 = parseOrg(text2);

  assert.deepEqual(doc1, doc2);
});

test('attaches parsed body content (list) under a heading', () => {
  const text = ['* Shopping', '- Milk', '- Eggs'].join('\n');
  const doc = parseOrg(text);
  const heading = doc.children[0];
  assert.equal(heading.body.length, 1);
  assert.equal(heading.body[0].type, 'list');
  assert.equal(heading.body[0].items[0].text, 'Milk');
});

test('body content before the first heading attaches to the document node', () => {
  const text = ['#+title: Doc', '', 'Intro paragraph.', '', '* First heading'].join('\n');
  const doc = parseOrg(text);
  assert.equal(doc.body.length, 1);
  assert.equal(doc.body[0].type, 'paragraph');
  assert.deepEqual(doc.body[0].lines, ['Intro paragraph.']);
});

test('round-trip still holds with list/table/block content in the body', () => {
  const text = [
    '* Notes',
    '- one',
    '- two',
    '',
    '| a | b |',
    '|---+---|',
    '| 1 | 2 |',
    '',
    '#+begin_src js',
    'console.log(1)',
    '#+end_src',
  ].join('\n');
  const doc1 = parseOrg(text);
  const doc2 = parseOrg(serializeOrg(doc1));
  assert.deepEqual(doc1, doc2);
});

test('regression: content before the first heading round-trips (was silently dropped on serialize)', () => {
  const text = ['#+title: Doc', '', 'Some preamble text.', '', '* First heading'].join('\n');
  const doc1 = parseOrg(text);
  const text2 = serializeOrg(doc1);
  assert.match(text2, /Some preamble text\./);
  const doc2 = parseOrg(text2);
  assert.deepEqual(doc1, doc2);
});

test('parses the example doc from the org-mode primer without throwing', () => {
  const text = [
    '#+title: The glories of Org',
    '#+author: A. Org Writer',
    '* Welcome to Org-mode',
    '** Sub-heading',
    'Each extra ~*~ increases the depth by one level.',
    '* TODO Promulgate Org to the world',
    '** TODO Create a quickstart guide',
  ].join('\n');
  const doc = parseOrg(text);
  assert.equal(doc.children.length, 2);
  assert.equal(doc.children[0].children[0].title, 'Sub-heading');
  assert.equal(doc.children[1].todo, 'TODO');
});

// ---- findHeadingLineNumber -------------------------------------------

/** Verifies findHeadingLineNumber against the actual serializeOrg
 *  output directly -- the line at the returned index must genuinely be
 *  that heading's own title line, rather than trusting a hand-counted
 *  expected number that could itself be wrong. */
function assertLineIsHeading(doc, heading, expectedTitleFragment) {
  const lineNum = findHeadingLineNumber(doc, heading);
  const lines = serializeOrg(doc).split('\n');
  assert.ok(lineNum >= 0 && lineNum < lines.length, `line number ${lineNum} out of range`);
  assert.match(lines[lineNum], new RegExp('^\\*+ .*' + expectedTitleFragment));
  return lineNum;
}

test('findHeadingLineNumber finds a top-level heading with no preceding content', () => {
  const doc = parseOrg('* First\n* Second\n* Third');
  assertLineIsHeading(doc, doc.children[0], 'First');
  assertLineIsHeading(doc, doc.children[1], 'Second');
  assertLineIsHeading(doc, doc.children[2], 'Third');
});

test('findHeadingLineNumber accounts for document-level keywords and body lines before the first heading', () => {
  const doc = parseOrg('#+TITLE: My File\n#+TODO: TODO | DONE\nSome preamble text.\n\n* First heading');
  assertLineIsHeading(doc, doc.children[0], 'First heading');
});

test('findHeadingLineNumber accounts for a heading\'s own body lines before its children', () => {
  const doc = parseOrg('* Parent\nSome body text.\nMore body text.\n** Child');
  assertLineIsHeading(doc, doc.children[0], 'Parent');
  assertLineIsHeading(doc, doc.children[0].children[0], 'Child');
});

test('findHeadingLineNumber accounts for SCHEDULED/DEADLINE planning lines', () => {
  const doc = parseOrg('* A\nSCHEDULED: <2026-01-01 Thu>\n* B');
  assertLineIsHeading(doc, doc.children[1], 'B');
});

test('findHeadingLineNumber accounts for a properties drawer', () => {
  const doc = parseOrg('* A\n:PROPERTIES:\n:ID: abc123\n:CUSTOM: value\n:END:\n* B');
  assertLineIsHeading(doc, doc.children[1], 'B');
});

test('findHeadingLineNumber handles a deeply nested heading correctly', () => {
  const doc = parseOrg('* A\n** B\nsome text\n*** C\nmore text\n**** D');
  const target = doc.children[0].children[0].children[0].children[0];
  assertLineIsHeading(doc, target, 'D');
});

test('findHeadingLineNumber returns -1 for a heading not present in the document', () => {
  const doc1 = parseOrg('* A');
  const doc2 = parseOrg('* B');
  assert.equal(findHeadingLineNumber(doc1, doc2.children[0]), -1);
});

test('findHeadingLineNumber works correctly across multiple siblings with varied content', () => {
  const doc = parseOrg(
    [
      '* A',
      'body of A',
      ':PROPERTIES:',
      ':ID: 1',
      ':END:',
      '* B',
      'SCHEDULED: <2026-01-01 Thu>',
      '** B1',
      '** B2',
      '* C',
    ].join('\n')
  );
  assertLineIsHeading(doc, doc.children[0], 'A');
  assertLineIsHeading(doc, doc.children[1], 'B');
  assertLineIsHeading(doc, doc.children[1].children[0], 'B1');
  assertLineIsHeading(doc, doc.children[1].children[1], 'B2');
  assertLineIsHeading(doc, doc.children[2], 'C');
});

// ---- a real bug this coverage caught: a '*'-prefixed line inside a
// #+BEGIN_.../#+END_... block was being incorrectly split off as a real
// heading, with zero awareness of block context -----------------------

test('a line starting with "*" inside a #+BEGIN_SRC block is NOT treated as a heading', () => {
  const doc = parseOrg('* Real heading\n#+BEGIN_SRC org\n* Example heading shown as literal text\n#+END_SRC\n');
  assert.equal(doc.children.length, 1, 'only the one real heading should exist');
  assert.equal(doc.children[0].title, 'Real heading');
  assert.ok(doc.children[0].bodyLines.some((l) => l === '* Example heading shown as literal text'));
});

test('multiple "*"-prefixed lines inside a block all stay literal, not split into several fake headings', () => {
  const doc = parseOrg('* Real heading\n#+BEGIN_EXAMPLE\n* one\n** two\n*** three\n#+END_EXAMPLE\n');
  assert.equal(doc.children.length, 1);
  assert.equal(doc.children[0].bodyLines.filter((l) => l.trim().length > 0).length, 5); // BEGIN + 3 stars lines + END
});

test('heading detection resumes correctly for a real heading right after a block closes', () => {
  const doc = parseOrg('* First\n#+BEGIN_SRC text\n* not a heading\n#+END_SRC\n* Second\n');
  assert.equal(doc.children.length, 2);
  assert.equal(doc.children[0].title, 'First');
  assert.equal(doc.children[1].title, 'Second');
});

test('an unclosed block (missing #+END_) does not leak inBlock state and swallow the rest of the document as literal text forever -- still round-trips safely even if imperfectly', () => {
  const text = '* Heading\n#+BEGIN_SRC\n* unclosed block, no matching END\n';
  const doc = parseOrg(text);
  // Documented, acceptable behavior for malformed input: everything after
  // an unclosed BEGIN becomes part of that heading's body verbatim, rather
  // than crashing or losing content -- round-trip safety is preserved.
  assert.equal(serializeOrg(doc), text);
});

test('round-trip: a block containing "*" lines survives parse -> serialize -> parse unchanged', () => {
  const text = '* Heading\nSome text.\n#+BEGIN_SRC org\n* Example\n  :PROPERTIES:\n  :FOO: bar\n  :END:\n#+END_SRC\n';
  const doc = parseOrg(text);
  const doc2 = parseOrg(serializeOrg(doc));
  assert.deepEqual(doc, doc2);
});

test('a block nested inside a list item still correctly suppresses heading detection within it', () => {
  const doc = parseOrg('* Heading\n- item one\n  #+BEGIN_SRC org\n  * looks like a heading but is not\n  #+END_SRC\n- item two\n');
  assert.equal(doc.children.length, 1, 'the indented "* looks like a heading" line must not create a second top-level heading');
});

// ---- #+TODO: parenthetical fast-key / logging-spec parsing --------------

test('parseTodoKeywordToken: a bare keyword with no parens at all', () => {
  assert.deepEqual(parseTodoKeywordToken('TODO'), { keyword: 'TODO', key: null, logSpec: null });
});

test('parseTodoKeywordToken: fast-key only, e.g. "TODO(t)"', () => {
  assert.deepEqual(parseTodoKeywordToken('TODO(t)'), { keyword: 'TODO', key: 't', logSpec: null });
});

test('parseTodoKeywordToken: logging-only, entering-timestamp, e.g. "DONE(!)"', () => {
  assert.deepEqual(parseTodoKeywordToken('DONE(!)'), { keyword: 'DONE', key: null, logSpec: '!' });
});

test('parseTodoKeywordToken: logging-only, entering-note, e.g. "KILL(@)"', () => {
  assert.deepEqual(parseTodoKeywordToken('KILL(@)'), { keyword: 'KILL', key: null, logSpec: '@' });
});

test('parseTodoKeywordToken: fast-key + entering-timestamp together, e.g. "DONE(d!)"', () => {
  assert.deepEqual(parseTodoKeywordToken('DONE(d!)'), { keyword: 'DONE', key: 'd', logSpec: '!' });
});

test('parseTodoKeywordToken: fast-key + entering-note, e.g. "KILL(k@)"', () => {
  assert.deepEqual(parseTodoKeywordToken('KILL(k@)'), { keyword: 'KILL', key: 'k', logSpec: '@' });
});

test('parseTodoKeywordToken: the full "note on entering + timestamp on leaving" form, e.g. "WAIT(w@/!)"', () => {
  assert.deepEqual(parseTodoKeywordToken('WAIT(w@/!)'), { keyword: 'WAIT', key: 'w', logSpec: '@/!' });
});

test('parseTodoKeywordToken: leaving-only, no key, e.g. "WAIT(/!)"', () => {
  assert.deepEqual(parseTodoKeywordToken('WAIT(/!)'), { keyword: 'WAIT', key: null, logSpec: '/!' });
});

test('parseTodoKeywordToken: leaving-only WITH a fast-key, e.g. "WAIT(w/!)"', () => {
  assert.deepEqual(parseTodoKeywordToken('WAIT(w/!)'), { keyword: 'WAIT', key: 'w', logSpec: '/!' });
});

test('parseTodoKeywordToken: empty parens produce no key and no logSpec', () => {
  assert.deepEqual(parseTodoKeywordToken('TODO()'), { keyword: 'TODO', key: null, logSpec: null });
});

test('parseTodoSpecValue: the full example from the org manual, all four keywords with different specs', () => {
  const spec = parseTodoSpecValue('TODO(t) WAIT(w@/!) | DONE(d!) KILL(k@)');
  assert.deepEqual(spec.todoKeywords, ['TODO', 'WAIT']);
  assert.deepEqual(spec.doneKeywords, ['DONE', 'KILL']);
  assert.deepEqual(spec.keySpecs, { TODO: 't', WAIT: 'w', DONE: 'd', KILL: 'k' });
  assert.deepEqual(spec.logSpecs, { WAIT: '@/!', DONE: '!', KILL: '@' });
});

test('parseTodoSpecValue: a plain #+TODO: line with no parens anywhere produces empty keySpecs/logSpecs', () => {
  const spec = parseTodoSpecValue('TODO | DONE');
  assert.deepEqual(spec.todoKeywords, ['TODO']);
  assert.deepEqual(spec.doneKeywords, ['DONE']);
  assert.deepEqual(spec.keySpecs, {});
  assert.deepEqual(spec.logSpecs, {});
});

test('parseTodoSpecValue: mixed -- only some keywords have a parenthetical suffix', () => {
  const spec = parseTodoSpecValue('TODO(t) NEXT | DONE(d)');
  assert.deepEqual(spec.todoKeywords, ['TODO', 'NEXT']);
  assert.deepEqual(spec.keySpecs, { TODO: 't', DONE: 'd' });
  assert.ok(!('NEXT' in spec.keySpecs));
});

// ---- heading.todo matching is fixed for the buggy real-world case -------

test('a heading using a keyword with a fast-key/logging suffix in #+TODO: is now correctly recognized (the original bug)', () => {
  const doc = parseOrg('#+TODO: TODO(t) WAIT(w@/!) | DONE(d!) KILL(k@)\n* WAIT Something\n* DONE Other thing\n* KILL A third thing\n');
  assert.equal(doc.children[0].todo, 'WAIT');
  assert.equal(doc.children[1].todo, 'DONE');
  assert.equal(doc.children[2].todo, 'KILL');
});

test('a plain #+TODO: line using ONLY fast-keys, no logging spec at all, is also fixed (this was broken too, not just the logging case)', () => {
  const doc = parseOrg('#+TODO: TODO(t) | DONE(d)\n* TODO Buy milk\n* DONE Already done\n');
  assert.equal(doc.children[0].todo, 'TODO');
  assert.equal(doc.children[1].todo, 'DONE');
});

test('round-trip: the #+TODO: line itself is preserved completely verbatim, parens and all, regardless of how it\u2019s parsed for matching', () => {
  const original = '#+TODO: TODO(t) WAIT(w@/!) | DONE(d!) KILL(k@)\n* WAIT Something\n';
  const doc = parseOrg(original);
  assert.equal(serializeOrg(doc), original);
});
