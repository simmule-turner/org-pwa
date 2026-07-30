import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { exportToMarkdown } from '../src/export-markdown.js';

// ---- headings and structure -------------------------------------------

test('a single top-level heading becomes an H1', () => {
  const doc = parseOrg('* Hello world');
  assert.equal(exportToMarkdown(doc), '# Hello world\n');
});

test('heading levels map directly to # count when exporting the whole document', () => {
  const doc = parseOrg('* A\n** B\n*** C');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('# A'));
  assert.ok(out.includes('## B'));
  assert.ok(out.includes('### C'));
});

test('TODO keyword and priority are kept as plain text prefixes on the heading line', () => {
  const doc = parseOrg('* TODO [#A] Buy milk');
  assert.equal(exportToMarkdown(doc).trim(), '# TODO [#A] Buy milk');
});

test('tags are rendered as inline code after the title', () => {
  const doc = parseOrg('* A heading :work:urgent:');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('`:work:urgent:`'));
});

test('SCHEDULED/DEADLINE render as an italicized line under the heading', () => {
  const doc = parseOrg('* A\nSCHEDULED: <2026-08-01> DEADLINE: <2026-08-05>');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('*Scheduled: <2026-08-01> \u2014 Deadline: <2026-08-05>*'));
});

test('an untitled heading exports with a placeholder rather than an empty heading line', () => {
  const doc = parseOrg('* \n');
  assert.ok(exportToMarkdown(doc).includes('(untitled)'));
});

// ---- subtree scope and level normalization -----------------------------

test('exporting a subtree makes the selected heading the new top level (H1)', () => {
  const doc = parseOrg('* Top\n** Middle\n*** Deep');
  const middle = doc.children[0].children[0];
  const out = exportToMarkdown(doc, middle);
  assert.ok(out.startsWith('# Middle'));
  assert.ok(out.includes('## Deep'));
  assert.ok(!out.includes('Top'));
});

test('exporting the whole document (no scope) includes every top-level heading', () => {
  const doc = parseOrg('* First\n* Second');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('# First'));
  assert.ok(out.includes('# Second'));
});

// ---- inline formatting --------------------------------------------------

test('bold/italic/strikethrough/code map to their Markdown equivalents', () => {
  const doc = parseOrg('* A\n*bold* /italic/ +strike+ ~code~');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('**bold**'));
  assert.ok(out.includes('*italic*'));
  assert.ok(out.includes('~~strike~~'));
  assert.ok(out.includes('`code`'));
});

test('underline and sub/superscript fall back to HTML passthrough (no native Markdown syntax)', () => {
  const doc = parseOrg('* A\n_underline_ x_{sub} x^{sup}');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('<u>underline</u>'));
  assert.ok(out.includes('<sub>sub</sub>'));
  assert.ok(out.includes('<sup>sup</sup>'));
});

test('a link with a description becomes [description](target)', () => {
  const doc = parseOrg('* A\n[[https://example.com][My Link]]');
  assert.ok(exportToMarkdown(doc).includes('[My Link](https://example.com)'));
});

test('a link with no description uses the target as its own label', () => {
  const doc = parseOrg('* A\n[[https://example.com]]');
  assert.ok(exportToMarkdown(doc).includes('[https://example.com](https://example.com)'));
});

test('an image becomes ![](target)', () => {
  const doc = parseOrg('* A\n[[https://example.com/x.png]]');
  assert.ok(exportToMarkdown(doc).includes('![](https://example.com/x.png)'));
});

test('an internal link keeps the raw org target verbatim rather than guessing an anchor', () => {
  const doc = parseOrg('* A\n[[*Some Heading]]');
  assert.ok(exportToMarkdown(doc).includes('(*Some Heading)'));
});

test('an export-comment is dropped entirely from the output', () => {
  const doc = parseOrg('* A\nBefore @@comment:secret note@@ after.');
  const out = exportToMarkdown(doc);
  assert.ok(!out.includes('secret note'));
  assert.ok(out.includes('Before'));
  assert.ok(out.includes('after'));
});

// ---- plain-text escaping -------------------------------------------------

test('literal Markdown-special characters in plain text are escaped', () => {
  const doc = parseOrg('* A\n5 * 3 and [not a link] and <html-looking');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('\\*'));
  assert.ok(out.includes('\\[not a link\\]'));
  assert.ok(out.includes('\\<html-looking'));
});

test('ordinary punctuation that is NOT ambiguous in Markdown is left unescaped', () => {
  const doc = parseOrg('* A\nCost: $5.00 (on sale!) - a deal.');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('Cost: $5.00 (on sale!) - a deal.'), 'periods, parens, dollar signs, and hyphens should not be escaped mid-prose');
});

test('a literal pipe in text is escaped so it cannot be mistaken for a table delimiter', () => {
  const doc = parseOrg('* A\nUse the a|b operator.');
  assert.ok(exportToMarkdown(doc).includes('a\\|b'));
});

// ---- lists ----------------------------------------------------------------

test('unordered list items use "- " markers', () => {
  const doc = parseOrg('* A\n- one\n- two');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('- one'));
  assert.ok(out.includes('- two'));
});

test('ordered list items use "N. " markers, respecting a [@N] start value', () => {
  const doc = parseOrg('* A\n1. [@5] five\n2. six');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('5. five'));
  assert.ok(out.includes('6. six'));
});

test('checkbox items use GFM task-list syntax, checked state preserved', () => {
  const doc = parseOrg('* A\n- [ ] todo\n- [X] done');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('- [ ] todo'));
  assert.ok(out.includes('- [x] done'));
});

test('nested list items are indented under their parent', () => {
  const doc = parseOrg('* A\n- parent\n  - child');
  const out = exportToMarkdown(doc);
  const lines = out.split('\n');
  const childLine = lines.find((l) => l.includes('child'));
  assert.ok(childLine.startsWith('  -'));
});

test('a description-list tag is rendered as a bold label prefix', () => {
  const doc = parseOrg('* A\n- term :: definition text');
  assert.ok(exportToMarkdown(doc).includes('**term:** definition text'));
});

// ---- tables ---------------------------------------------------------------

test('a table becomes a GFM pipe table with a separator row', () => {
  const doc = parseOrg('* A\n| Name | Age |\n| Alice | 30 |\n| Bob | 25 |');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('| Name | Age |'));
  assert.ok(out.includes('| --- | --- |'));
  assert.ok(out.includes('| Alice | 30 |'));
  assert.ok(out.includes('| Bob | 25 |'));
});

test('a table rule/separator row in the org source does not produce a duplicate output row', () => {
  const doc = parseOrg('* A\n| Name | Age |\n|------+-----|\n| Alice | 30 |');
  const out = exportToMarkdown(doc);
  const separatorCount = (out.match(/\| --- \| --- \|/g) || []).length;
  assert.equal(separatorCount, 1);
});

// ---- blocks -----------------------------------------------------------

test('a QUOTE block becomes a Markdown blockquote', () => {
  const doc = parseOrg('* A\n#+BEGIN_QUOTE\nWise words.\n#+END_QUOTE');
  assert.ok(exportToMarkdown(doc).includes('> Wise words.'));
});

test('a SRC block becomes a fenced code block with the language hint preserved', () => {
  const doc = parseOrg('* A\n#+BEGIN_SRC python\nprint(1)\n#+END_SRC');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('```python'));
  assert.ok(out.includes('print(1)'));
});

test('an EXAMPLE block becomes a fenced code block with no language hint', () => {
  const doc = parseOrg('* A\n#+BEGIN_EXAMPLE\nraw text\n#+END_EXAMPLE');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('```\nraw text\n```'));
});

test('a COMMENT block is dropped entirely, matching real org\u2019s own export behavior', () => {
  const doc = parseOrg('* A\nVisible text.\n#+BEGIN_COMMENT\nhidden note\n#+END_COMMENT');
  const out = exportToMarkdown(doc);
  assert.ok(!out.includes('hidden note'));
  assert.ok(out.includes('Visible text.'));
});

// ---- horizontal rule -----------------------------------------------------

test('an org horizontal rule becomes a Markdown ---', () => {
  const doc = parseOrg('* A\nBefore\n\n-----\n\nAfter');
  const out = exportToMarkdown(doc);
  assert.ok(out.includes('\n---\n'));
});

// ---- properties are dropped -----------------------------------------------

test('property drawers (including ARCHIVE_* properties) are never included in the output', () => {
  const doc = parseOrg('* A\n:PROPERTIES:\n:CUSTOM_ID: my-id\n:ARCHIVE_TIME: [2026-01-01]\n:END:\nBody text.');
  const out = exportToMarkdown(doc);
  assert.ok(!out.includes('CUSTOM_ID'));
  assert.ok(!out.includes('ARCHIVE_TIME'));
  assert.ok(!out.includes('my-id'));
  assert.ok(out.includes('Body text.'));
});
