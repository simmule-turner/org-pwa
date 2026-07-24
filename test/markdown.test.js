import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, slugify } from '../src/markdown.js';

// ---- slugify ---------------------------------------------------------

test('slugify lowercases and hyphenates', () => {
  assert.equal(slugify('Capture Templates'), 'capture-templates');
});

test('slugify strips punctuation that is not a word char/space/hyphen', () => {
  assert.equal(slugify('TODO view'), 'todo-view');
  assert.equal(slugify('What\u2019s new?'), 'whats-new');
});

test('slugify replaces each space with its own hyphen, not collapsing consecutive spaces -- matching GitHub\u2019s real behavior', () => {
  assert.equal(slugify('a   b'), 'a---b');
  // The real case this matters for: a heading containing a slash, like
  // "Known limitations / not built yet" -- stripping the slash leaves
  // two adjacent spaces, which GitHub's own renderer turns into a
  // double hyphen, matching this project's own README TOC link exactly.
  assert.equal(slugify('Known limitations / not built yet'), 'known-limitations--not-built-yet');
});

// ---- parseInline -------------------------------------------------------

test('parseInline handles plain text with no formatting', () => {
  assert.deepEqual(parseInline('just plain text'), [{ type: 'text', value: 'just plain text' }]);
});

test('parseInline handles bold', () => {
  const tokens = parseInline('some **bold** text');
  assert.deepEqual(tokens, [
    { type: 'text', value: 'some ' },
    { type: 'bold', value: 'bold' },
    { type: 'text', value: ' text' },
  ]);
});

test('parseInline handles italic without confusing it with bold', () => {
  const tokens = parseInline('some *italic* text');
  assert.deepEqual(tokens, [
    { type: 'text', value: 'some ' },
    { type: 'italic', value: 'italic' },
    { type: 'text', value: ' text' },
  ]);
});

test('parseInline handles inline code', () => {
  const tokens = parseInline('run `npm test` now');
  assert.deepEqual(tokens, [
    { type: 'text', value: 'run ' },
    { type: 'code', value: 'npm test' },
    { type: 'text', value: ' now' },
  ]);
});

test('parseInline handles a link', () => {
  const tokens = parseInline('see [Agenda](#agenda) for more');
  assert.deepEqual(tokens, [
    { type: 'text', value: 'see ' },
    { type: 'link', value: 'Agenda', href: '#agenda' },
    { type: 'text', value: ' for more' },
  ]);
});

test('parseInline handles multiple different formats in one line', () => {
  const tokens = parseInline('**bold** and `code` and [a link](url) and *italic*');
  assert.deepEqual(tokens.map((t) => t.type), ['bold', 'text', 'code', 'text', 'link', 'text', 'italic']);
});

test('parseInline does not infinite-loop on an unmatched special character', () => {
  const tokens = parseInline('unmatched * asterisk here');
  assert.ok(tokens.length > 0);
  assert.equal(tokens.map((t) => t.value).join(''), 'unmatched * asterisk here');
});

test('parseInline does not infinite-loop on an unclosed bold/code/link', () => {
  assert.doesNotThrow(() => parseInline('**never closed'));
  assert.doesNotThrow(() => parseInline('`never closed'));
  assert.doesNotThrow(() => parseInline('[never closed'));
});

// ---- parseMarkdown: headings --------------------------------------------

test('parseMarkdown parses headings at every level with correct text and id', () => {
  const blocks = parseMarkdown('# Title\n## Subtitle\n### Sub-subtitle');
  assert.deepEqual(
    blocks.map((b) => [b.level, b.text, b.id]),
    [
      [1, 'Title', 'title'],
      [2, 'Subtitle', 'subtitle'],
      [3, 'Sub-subtitle', 'sub-subtitle'],
    ]
  );
});

test('parseMarkdown de-duplicates repeated heading text into unique ids', () => {
  const blocks = parseMarkdown('## Overview\n\nSome text.\n\n## Overview');
  const headings = blocks.filter((b) => b.type === 'heading');
  assert.equal(headings[0].id, 'overview');
  assert.equal(headings[1].id, 'overview-1');
});

// ---- parseMarkdown: paragraphs -------------------------------------------

test('parseMarkdown joins consecutive non-blank lines into one paragraph', () => {
  const blocks = parseMarkdown('line one\nline two\nline three');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(blocks[0].text, 'line one line two line three');
});

test('parseMarkdown separates paragraphs on a blank line', () => {
  const blocks = parseMarkdown('first paragraph\n\nsecond paragraph');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text, 'first paragraph');
  assert.equal(blocks[1].text, 'second paragraph');
});

// ---- parseMarkdown: lists -------------------------------------------------

test('parseMarkdown parses a bullet list', () => {
  const blocks = parseMarkdown('- item one\n- item two\n- item three');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'list');
  assert.equal(blocks[0].ordered, false);
  assert.deepEqual(
    blocks[0].items.map((i) => i.text),
    ['item one', 'item two', 'item three']
  );
});

test('parseMarkdown parses a numbered list', () => {
  const blocks = parseMarkdown('1. first\n2. second\n3. third');
  assert.equal(blocks[0].type, 'list');
  assert.equal(blocks[0].ordered, true);
  assert.deepEqual(
    blocks[0].items.map((i) => i.text),
    ['first', 'second', 'third']
  );
});

test('parseMarkdown handles a list with inline formatting inside items', () => {
  const blocks = parseMarkdown('- **bold** item\n- plain item');
  assert.equal(blocks[0].items[0].inline[0].type, 'bold');
});

// ---- parseMarkdown: code blocks -------------------------------------------

test('parseMarkdown parses a fenced code block, keeping its content raw (not inline-parsed)', () => {
  const blocks = parseMarkdown('```\nsome *code* with **symbols**\n```');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'code-block');
  assert.equal(blocks[0].text, 'some *code* with **symbols**');
  assert.equal(blocks[0].inline, undefined); // never inline-parsed -- code stays literal
});

test('parseMarkdown handles a multi-line code block', () => {
  const blocks = parseMarkdown('```json\n{\n  "key": "value"\n}\n```');
  assert.equal(blocks[0].text, '{\n  "key": "value"\n}');
});

// ---- parseMarkdown: horizontal rules ---------------------------------------

test('parseMarkdown parses a horizontal rule', () => {
  const blocks = parseMarkdown('above\n\n---\n\nbelow');
  assert.equal(blocks[1].type, 'hr');
});

// ---- parseMarkdown: real README content ------------------------------------

test('REAL CONTENT: a TOC-style bullet list of links parses correctly', () => {
  const blocks = parseMarkdown('- [Agenda](#agenda)\n- [TODO view](#todo-view)\n- [Capture Templates](#capture-templates)');
  assert.equal(blocks[0].type, 'list');
  assert.equal(blocks[0].items.length, 3);
  assert.equal(blocks[0].items[0].inline[0].type, 'link');
  assert.equal(blocks[0].items[0].inline[0].href, '#agenda');
});

test('REAL CONTENT: a heading matching a TOC link produces the id that link expects', () => {
  const blocks = parseMarkdown('## Capture Templates');
  assert.equal(blocks[0].id, 'capture-templates'); // matches "#capture-templates" from the TOC
});

test('REAL CONTENT: a JSON code block from the Capture Templates section parses cleanly', () => {
  const md = '```json\n{\n  "key": "b",\n  "type": "item"\n}\n```';
  const blocks = parseMarkdown(md);
  assert.equal(blocks[0].type, 'code-block');
  assert.match(blocks[0].text, /"key": "b"/);
});

test('REAL CONTENT: a bold-label bullet item (the common README style) parses correctly', () => {
  const blocks = parseMarkdown('- **`key`** \u2014 must be unique; shown next to the description in the picker.');
  const item = blocks[0].items[0];
  assert.equal(item.inline[0].type, 'bold');
});
