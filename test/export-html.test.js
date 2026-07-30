import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { exportToHtml } from '../src/export-html.js';

// ---- document shell -------------------------------------------------------

test('produces a complete standalone HTML document', () => {
  const doc = parseOrg('* Hello');
  const out = exportToHtml(doc);
  assert.ok(out.startsWith('<!DOCTYPE html>'));
  assert.ok(out.includes('<meta charset="utf-8">'));
  assert.ok(out.includes('<style>'));
  assert.ok(out.trim().endsWith('</html>'));
});

test('title comes from #+TITLE: if present, "Untitled" otherwise', () => {
  const withTitle = parseOrg('#+TITLE: My Doc\n* A');
  assert.ok(exportToHtml(withTitle).includes('<title>My Doc</title>'));
  const withoutTitle = parseOrg('* A');
  assert.ok(exportToHtml(withoutTitle).includes('<title>Untitled</title>'));
});

test('exporting a subtree titles the document after the selected heading', () => {
  const doc = parseOrg('* Top\n** Middle');
  const middle = doc.children[0].children[0];
  assert.ok(exportToHtml(doc, middle).includes('<title>Middle</title>'));
});

// ---- headings and structure -------------------------------------------

test('heading levels map to h1-h6, clamped at h6 for anything deeper', () => {
  const doc = parseOrg('* A\n** B\n*** C\n**** D\n***** E\n****** F\n******* G');
  const out = exportToHtml(doc);
  assert.ok(out.includes('<h1>'));
  assert.ok(out.includes('<h6>'));
  assert.ok(!out.includes('<h7>'));
});

test('exporting a subtree makes the selected heading an h1, shifting descendants accordingly', () => {
  const doc = parseOrg('* Top\n** Middle\n*** Deep');
  const middle = doc.children[0].children[0];
  const out = exportToHtml(doc, middle);
  assert.ok(out.includes('<h1>Middle</h1>'));
  assert.ok(out.includes('<h2>Deep</h2>'));
  assert.ok(!out.includes('Top'));
});

test('TODO keyword gets a styled span, with a distinct "done" class for a done-state keyword', () => {
  const doc = parseOrg('#+TODO: TODO WAIT | DONE KILL\n* TODO Active\n* DONE Finished');
  const out = exportToHtml(doc);
  assert.ok(out.includes('<span class="todo-keyword">TODO</span>'));
  assert.ok(out.includes('<span class="todo-keyword done">DONE</span>'));
});

test('a custom done-keyword (e.g. KILL) is correctly styled as done, matching the file\u2019s own #+TODO: sequence', () => {
  const doc = parseOrg('#+TODO: TODO WAIT | DONE KILL\n* KILL Cancelled task');
  assert.ok(exportToHtml(doc).includes('<span class="todo-keyword done">KILL</span>'));
});

test('priority gets a styled span', () => {
  const doc = parseOrg('* [#A] Important');
  assert.ok(exportToHtml(doc).includes('<span class="priority">[#A]</span>'));
});

test('tags render as small inline code elements', () => {
  const doc = parseOrg('* A heading :work:urgent:');
  const out = exportToHtml(doc);
  assert.ok(out.includes('<code>work</code>'));
  assert.ok(out.includes('<code>urgent</code>'));
});

test('SCHEDULED/DEADLINE render as an italicized paragraph', () => {
  const doc = parseOrg('* A\nSCHEDULED: <2026-08-01>');
  assert.ok(exportToHtml(doc).includes('<p class="planning">Scheduled: &lt;2026-08-01&gt;</p>'));
});

// ---- inline formatting --------------------------------------------------

test('bold/italic/underline/strikethrough/code map to their real HTML tags', () => {
  const doc = parseOrg('* A\n*bold* /italic/ _underline_ +strike+ ~code~');
  const out = exportToHtml(doc);
  assert.ok(out.includes('<strong>bold</strong>'));
  assert.ok(out.includes('<em>italic</em>'));
  assert.ok(out.includes('<u>underline</u>'));
  assert.ok(out.includes('<del>strike</del>'));
  assert.ok(out.includes('<code>code</code>'));
});

test('a link with a description renders as a real anchor with that text', () => {
  const doc = parseOrg('* A\n[[https://example.com][My Link]]');
  assert.ok(exportToHtml(doc).includes('<a href="https://example.com">My Link</a>'));
});

test('an image renders as a real <img> tag', () => {
  const doc = parseOrg('* A\n[[https://example.com/x.png]]');
  assert.ok(exportToHtml(doc).includes('<img src="https://example.com/x.png" alt="">'));
});

test('an export-comment is dropped entirely from the output', () => {
  const doc = parseOrg('* A\nBefore @@comment:secret note@@ after.');
  const out = exportToHtml(doc);
  assert.ok(!out.includes('secret note'));
});

// ---- HTML escaping (critical: prevents broken markup / XSS from org content) --

test('angle brackets and ampersands in plain text are escaped', () => {
  const doc = parseOrg('* A\n5 < 10 & 10 > 5');
  const out = exportToHtml(doc);
  assert.ok(out.includes('5 &lt; 10 &amp; 10 &gt; 5'));
});

test('a literal <script> tag in org content is neutralized, not passed through as real markup', () => {
  const doc = parseOrg('* A\n<script>alert(1)</script>');
  const out = exportToHtml(doc);
  assert.ok(!out.includes('<script>alert'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('quotes in text are escaped for safe attribute contexts', () => {
  const doc = parseOrg('* A\nHe said "hello" and \'hi\'');
  const out = exportToHtml(doc);
  assert.ok(out.includes('&quot;hello&quot;'));
  assert.ok(out.includes('&#39;hi&#39;'));
});

test('a link target with special characters is escaped inside the href attribute', () => {
  const doc = parseOrg('* A\n[[https://example.com?a=1&b=2][Link]]');
  const out = exportToHtml(doc);
  assert.ok(out.includes('href="https://example.com?a=1&amp;b=2"'));
});

// ---- lists ----------------------------------------------------------------

test('unordered list becomes a <ul>, ordered becomes an <ol> with correct start value', () => {
  const doc = parseOrg('* A\n- one\n- two');
  assert.ok(exportToHtml(doc).includes('<ul><li>one</li><li>two</li></ul>'));

  const doc2 = parseOrg('* A\n1. [@5] five\n2. six');
  const out2 = exportToHtml(doc2);
  assert.ok(out2.includes('<ol start="5">'));
});

test('checkbox items render as real disabled <input> checkboxes, checked state preserved', () => {
  const doc = parseOrg('* A\n- [ ] todo\n- [X] done');
  const out = exportToHtml(doc);
  assert.ok(out.includes('<input type="checkbox" disabled> todo'));
  assert.ok(out.includes('<input type="checkbox" disabled checked> done'));
});

test('nested list items produce a nested <ul>/<ol> inside the parent <li>', () => {
  const doc = parseOrg('* A\n- parent\n  - child');
  const out = exportToHtml(doc);
  assert.ok(/<li>parent<ul><li>child<\/li><\/ul><\/li>/.test(out));
});

// ---- tables ---------------------------------------------------------------

test('a table becomes a real <table> with <thead>/<tbody>', () => {
  const doc = parseOrg('* A\n| Name | Age |\n| Alice | 30 |');
  const out = exportToHtml(doc);
  assert.ok(out.includes('<thead><tr><th>Name</th><th>Age</th></tr></thead>'));
  assert.ok(out.includes('<tbody><tr><td>Alice</td><td>30</td></tr></tbody>'));
});

test('a table rule/separator row in the org source does not produce an empty row', () => {
  const doc = parseOrg('* A\n| Name | Age |\n|------+-----|\n| Alice | 30 |');
  const out = exportToHtml(doc);
  const trCount = (out.match(/<tr>/g) || []).length;
  assert.equal(trCount, 2); // header + one data row, no third empty row from the rule line
});

// ---- blocks -----------------------------------------------------------

test('a QUOTE block becomes a <blockquote>', () => {
  const doc = parseOrg('* A\n#+BEGIN_QUOTE\nWise words.\n#+END_QUOTE');
  assert.ok(exportToHtml(doc).includes('<blockquote>Wise words.</blockquote>'));
});

test('a SRC block becomes <pre><code> with a language class', () => {
  const doc = parseOrg('* A\n#+BEGIN_SRC python\nprint(1)\n#+END_SRC');
  const out = exportToHtml(doc);
  assert.ok(out.includes('<pre><code class="language-python">print(1)</code></pre>'));
});

test('a COMMENT block is dropped entirely', () => {
  const doc = parseOrg('* A\nVisible.\n#+BEGIN_COMMENT\nhidden\n#+END_COMMENT');
  const out = exportToHtml(doc);
  assert.ok(!out.includes('hidden'));
  assert.ok(out.includes('Visible.'));
});

// ---- horizontal rule -----------------------------------------------------

test('an org horizontal rule becomes a real <hr>', () => {
  const doc = parseOrg('* A\nBefore\n\n-----\n\nAfter');
  assert.ok(exportToHtml(doc).includes('<hr>'));
});

// ---- properties are dropped -----------------------------------------------

test('property drawers (including ARCHIVE_* properties) never appear in the output', () => {
  const doc = parseOrg('* A\n:PROPERTIES:\n:CUSTOM_ID: my-id\n:ARCHIVE_TIME: [2026-01-01]\n:END:\nBody text.');
  const out = exportToHtml(doc);
  assert.ok(!out.includes('CUSTOM_ID'));
  assert.ok(!out.includes('ARCHIVE_TIME'));
  assert.ok(out.includes('Body text.'));
});

// ---- print CSS presence ---------------------------------------------------

test('includes @media print rules to avoid bad page/table breaks', () => {
  const doc = parseOrg('* A');
  const out = exportToHtml(doc);
  assert.ok(out.includes('@media print'));
  assert.ok(out.includes('break-inside: avoid'));
});
