import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { exportToAscii, wrapText } from '../src/export-ascii.js';

// ---- wrapText ---------------------------------------------------------------

test('wrapText: wraps at word boundaries, never mid-word', () => {
  const lines = wrapText('The quick brown fox jumps over the lazy dog', 15);
  assert.deepEqual(lines, ['The quick brown', 'fox jumps over', 'the lazy dog']);
  for (const line of lines) assert.ok(line.length <= 15);
});

test('wrapText: text shorter than the width stays on one line', () => {
  assert.deepEqual(wrapText('short text', 40), ['short text']);
});

test('wrapText: an empty or whitespace-only string returns an empty array, not a single blank-line entry', () => {
  assert.deepEqual(wrapText('', 20), []);
  assert.deepEqual(wrapText('   ', 20), []);
});

test('wrapText: a single word longer than the width is kept whole on its own line rather than split mid-word', () => {
  const lines = wrapText('supercalifragilisticexpialidocious short', 10);
  assert.equal(lines[0], 'supercalifragilisticexpialidocious');
  assert.equal(lines[1], 'short');
});

test('wrapText: multiple/irregular internal whitespace collapses to single spaces between words', () => {
  const lines = wrapText('word1    word2\tword3', 40);
  assert.deepEqual(lines, ['word1 word2 word3']);
});

// ---- exportToAscii: headings -------------------------------------------------

test('a level-1 heading is underlined with "=" matching its own line width', () => {
  const doc = parseOrg('* Project Alpha\n');
  const result = exportToAscii(doc);
  const lines = result.split('\n');
  assert.equal(lines[0], 'Project Alpha');
  assert.equal(lines[1], '='.repeat('Project Alpha'.length));
});

test('a deeper heading is indented but not underlined', () => {
  const doc = parseOrg('* Top\n** Child\n');
  const result = exportToAscii(doc);
  assert.ok(result.includes('  Child'));
  assert.ok(!result.includes('Child\n=====')); // no underline for a non-level-1 heading
});

test('TODO keyword, priority, and tags are all included on the heading line', () => {
  const doc = parseOrg('* TODO [#A] Ship the release :work:urgent:\n');
  const result = exportToAscii(doc);
  assert.ok(result.includes('TODO [#A] Ship the release :work:urgent:'));
});

test('a scoped export (a specific heading, not the whole doc) treats that heading as the new top level, matching Markdown/HTML export\u2019s own convention', () => {
  const doc = parseOrg('* Root\n** Target\n*** Grandchild\n');
  const target = doc.children[0].children[0];
  const result = exportToAscii(doc, target);
  assert.ok(result.startsWith('Target'));
  assert.ok(!result.includes('Root'));
  assert.ok(result.includes('Grandchild'));
});

// ---- exportToAscii: paragraphs and wrapping ---------------------------------

test('a paragraph is wrapped to the given text width, indented to match its heading depth', () => {
  const doc = parseOrg('* H\nThis is a moderately long sentence that will need wrapping.\n');
  const result = exportToAscii(doc, null, 20);
  const bodyLines = result.split('\n').slice(2).filter(Boolean); // skip heading + underline
  for (const line of bodyLines) assert.ok(line.length <= 22); // width + a little slack for the indent itself being counted in "available"
});

test('org-ascii-text-width defaults to 72 when not otherwise specified', () => {
  const doc = parseOrg('* H\n' + 'word '.repeat(30).trim() + '\n');
  const result = exportToAscii(doc); // no explicit width argument
  const bodyLines = result.split('\n').slice(2).filter(Boolean);
  for (const line of bodyLines) assert.ok(line.length <= 74); // 72 + indent slack
});

test('inline markup characters are left completely as-is, not converted to anything else', () => {
  const doc = parseOrg('* H\nThis has *bold* and /italic/ and ~code~ text.\n');
  const result = exportToAscii(doc, null, 200);
  assert.ok(result.includes('*bold*'));
  assert.ok(result.includes('/italic/'));
  assert.ok(result.includes('~code~'));
});

test('a link with a description renders as "description (target)"', () => {
  const doc = parseOrg('* H\nSee [[https://example.com][the docs]] for more.\n');
  const result = exportToAscii(doc, null, 200);
  assert.ok(result.includes('the docs (https://example.com)'));
});

test('a link with no description renders as just the target', () => {
  const doc = parseOrg('* H\nSee [[https://example.com]] for more.\n');
  const result = exportToAscii(doc, null, 200);
  assert.ok(result.includes('https://example.com'));
});

// ---- exportToAscii: lists -----------------------------------------------------

test('an unordered list item wraps with continuation lines aligned under the marker', () => {
  const doc = parseOrg('* H\n- ' + 'word '.repeat(20).trim() + '\n');
  const result = exportToAscii(doc, null, 20);
  const lines = result.split('\n').filter((l) => l.trim());
  const firstItemLine = lines.find((l) => l.trim().startsWith('- '));
  assert.ok(firstItemLine);
  const markerIndent = firstItemLine.indexOf('-');
  const continuationLine = lines[lines.indexOf(firstItemLine) + 1];
  assert.equal(continuationLine.length - continuationLine.trimStart().length, markerIndent + 2); // aligned under the text after "- "
});

test('a checkbox item shows [x]/[ ]/[-] instead of a plain bullet', () => {
  const doc = parseOrg('* H\n- [X] done\n- [ ] not done\n- [-] partial\n');
  const result = exportToAscii(doc);
  assert.ok(result.includes('[x] done'));
  assert.ok(result.includes('[ ] not done'));
  assert.ok(result.includes('[-] partial'));
});

test('an ordered list uses numeric markers, respecting an explicit start value', () => {
  const doc = parseOrg('* H\n1. [@3] third\n2. fourth\n');
  const result = exportToAscii(doc);
  assert.ok(result.includes('3. third'));
  assert.ok(result.includes('4. fourth'));
});

test('a nested sub-list is indented further than its parent', () => {
  const doc = parseOrg('* H\n- Parent\n  - Child\n');
  const result = exportToAscii(doc);
  const lines = result.split('\n');
  const parentLine = lines.find((l) => l.includes('Parent'));
  const childLine = lines.find((l) => l.includes('Child'));
  const parentIndent = parentLine.length - parentLine.trimStart().length;
  const childIndent = childLine.length - childLine.trimStart().length;
  assert.ok(childIndent > parentIndent);
});

// ---- exportToAscii: tables ------------------------------------------------

test('a table renders as plain pipe-delimited text with a correctly-sized rule line', () => {
  const doc = parseOrg('* H\n| a | b |\n|---+---|\n| c | d |\n');
  const result = exportToAscii(doc);
  assert.ok(result.includes('| a | b |'));
  assert.ok(result.includes('|---+---|'));
  assert.ok(result.includes('| c | d |'));
});

test('a table rule line correctly matches a wider table\u2019s actual column count, not a hardcoded 2', () => {
  const doc = parseOrg('* H\n| a | b | c |\n|---+---+---|\n| d | e | f |\n');
  const result = exportToAscii(doc);
  assert.ok(result.includes('|---+---+---|'));
});

// ---- exportToAscii: blocks ------------------------------------------------

test('a block is shown with a name label and its literal content, indented', () => {
  const doc = parseOrg('* H\n#+BEGIN_SRC python\nprint("hi")\n#+END_SRC\n');
  const result = exportToAscii(doc);
  assert.ok(result.includes('[SRC]'));
  assert.ok(result.includes('print("hi")'));
});

// ---- exportToAscii: general -----------------------------------------------

test('an empty document produces a trivially valid (empty-ish) output, not an error', () => {
  const doc = parseOrg('');
  const result = exportToAscii(doc);
  assert.equal(typeof result, 'string');
});

test('the result always ends in exactly one trailing newline', () => {
  const doc = parseOrg('* H\nSome text.\n');
  const result = exportToAscii(doc);
  assert.ok(result.endsWith('\n'));
  assert.ok(!result.endsWith('\n\n'));
});

test('multiple sibling top-level headings are each separated by a blank line, not run together', () => {
  const doc = parseOrg('* First\n* Second\n');
  const result = exportToAscii(doc);
  assert.ok(result.includes('First'));
  assert.ok(result.includes('\n\nSecond'));
});
