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
  assert.match(out, /<h1[ >]/);
  assert.match(out, /<h6[ >]/);
  assert.doesNotMatch(out, /<h7[ >]/);
});

test('exporting a subtree makes the selected heading an h1, shifting descendants accordingly', () => {
  const doc = parseOrg('* Top\n** Middle\n*** Deep');
  const middle = doc.children[0].children[0];
  const out = exportToHtml(doc, middle);
  assert.match(out, /<h1[^>]*>Middle<\/h1>/);
  assert.match(out, /<h2[^>]*>Deep<\/h2>/);
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

// ---- footnotes -----------------------------------------------------------

test('a bare footnote reference [fn:1] exports as a jump-link superscript', () => {
  const doc = parseOrg('* Heading\nA claim needing support[fn:1].\n\n[fn:1] The actual source.\n');
  const html = exportToHtml(doc);
  assert.match(html, /<sup id="fnref-1"><a href="#fn-1">1<\/a><\/sup>/);
});

test('a separate-line definition ("[fn:1] text") appears in the Footnotes section with a back-link', () => {
  const doc = parseOrg('* Heading\nRef[fn:1].\n\n[fn:1] The actual source.\n');
  const html = exportToHtml(doc);
  assert.match(html, /<div class="footnotes">/);
  assert.match(html, /<li id="fn-1">The actual source\. <a class="footnote-back" href="#fnref-1">/);
});

test('an inline definition ([fn:1:text]) renders the jump-link inline AND appears in the Footnotes section', () => {
  const doc = parseOrg('* Heading\nA claim[fn:1:this is the note] right here.\n');
  const html = exportToHtml(doc);
  assert.match(html, /<sup id="fnref-1">/);
  assert.match(html, /<li id="fn-1">this is the note/);
});

test('an anonymous inline footnote ([fn::text]) gets a synthetic label', () => {
  const doc = parseOrg('* Heading\nSome text[fn::an anonymous note] here.\n');
  const html = exportToHtml(doc);
  assert.match(html, /<sup id="fnref-anon-1">/);
  assert.match(html, /<li id="fn-anon-1">an anonymous note/);
});

test('the same real label referenced multiple times produces only ONE Footnotes list item', () => {
  const doc = parseOrg('* Heading\nFirst[fn:1:the note]. Later, again[fn:1].\n');
  const html = exportToHtml(doc);
  const matches = html.match(/<li id="fn-1">/g) || [];
  assert.equal(matches.length, 1);
});

test('a document with no footnotes produces no Footnotes section at all', () => {
  const doc = parseOrg('* Heading\nJust ordinary text.\n');
  const html = exportToHtml(doc);
  assert.doesNotMatch(html, /class="footnotes"/);
});

test('multiple independent export calls do not leak footnote state between them', () => {
  const doc1 = parseOrg('* H\nOne[fn::first].\n');
  const doc2 = parseOrg('* H\nTwo[fn::second].\n');
  const html1 = exportToHtml(doc1);
  const html2 = exportToHtml(doc2);
  assert.match(html1, /anon-1/);
  assert.match(html2, /anon-1/);
});

test('footnote label and content are HTML-escaped, not passed through raw', () => {
  const doc = parseOrg('* Heading\nA claim[fn:1:contains a <script> tag] here.\n');
  const html = exportToHtml(doc);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

// ---- internal links resolve to real anchors (THE DATA-LOSS-ADJACENT BUG) ----

test('THE BUG: a #custom-id link now resolves to a real, matching heading id, instead of the raw target string being dumped as the href unresolved', () => {
  const doc = parseOrg('* Intro\n[[#capture][Jump to Capture]]\n* Capture\n:PROPERTIES:\n:CUSTOM_ID: capture\n:END:\nSome content.\n');
  const html = exportToHtml(doc);
  assert.match(html, /href="#capture"/);
  assert.match(html, /<h1 id="capture">/);
});

test('a star-prefixed title link ([[*Title][...]]) resolves via a generated, slugified id', () => {
  const doc = parseOrg('* Intro\n[[*My Cool Section][See below]]\n* My Cool Section\nContent.\n');
  const html = exportToHtml(doc);
  assert.match(html, /href="#my-cool-section"/);
  assert.match(html, /<h1 id="my-cool-section">/);
});

test('a bare fuzzy-title link ([[Title]], no # or * prefix) also resolves', () => {
  const doc = parseOrg('* Intro\n[[My Cool Section]]\n* My Cool Section\nContent.\n');
  const html = exportToHtml(doc);
  assert.match(html, /href="#my-cool-section"/);
});

test('external links (http/https/mailto) are completely unaffected by link resolution', () => {
  const doc = parseOrg('* Intro\n[[https://example.com][External]]\n[[mailto:a@b.com][Email]]\n');
  const html = exportToHtml(doc);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /href="mailto:a@b\.com"/);
});

test('two headings sharing the same title get disambiguated ids, so both are individually linkable', () => {
  const doc = parseOrg('* Notes\nfirst\n* Notes\nsecond\n');
  const html = exportToHtml(doc);
  assert.match(html, /<h1 id="notes">/);
  assert.match(html, /<h1 id="notes-2">/);
});

test('a heading with no alphanumeric characters at all in its title still gets a usable id, not an empty one', () => {
  const doc = parseOrg('* \u2014\u2014\u2014\nContent.\n');
  const html = exportToHtml(doc);
  assert.match(html, /<h1 id="section">/);
});

test('a link resolving to a heading OUTSIDE the exported scope falls back to the original target text -- nowhere real to anchor to within this specific export', () => {
  const doc = parseOrg('* Outside\n:PROPERTIES:\n:CUSTOM_ID: outside\n:END:\n* Exported Scope\n[[#outside][Link out]]\n');
  const scopeHeading = doc.children[1];
  const html = exportToHtml(doc, scopeHeading);
  assert.match(html, /href="#outside"/); // best-effort fallback, unchanged from before this fix
  assert.doesNotMatch(html, /id="outside"/); // the out-of-scope heading correctly isn't included/anchored at all
});

test('an unresolved link (matches nothing at all) falls back to the original literal target, unchanged', () => {
  const doc = parseOrg('* Intro\n[[Nonexistent Heading][Broken]]\n');
  const html = exportToHtml(doc);
  assert.match(html, /href="Nonexistent Heading"/);
});

test('a file-scheme link is left completely unresolved/unchanged -- it cannot meaningfully point anywhere within a standalone HTML export', () => {
  const doc = parseOrg('* Intro\n[[file:other.org][Other file]]\n');
  const html = exportToHtml(doc);
  assert.match(html, /href="file:other\.org"/);
});

test('CUSTOM_ID always wins over a title-based slug for the SAME heading, matching what a #custom-id link would actually resolve against', () => {
  const doc = parseOrg('* My Title\n:PROPERTIES:\n:CUSTOM_ID: my-real-id\n:END:\nContent.\n');
  const html = exportToHtml(doc);
  assert.match(html, /<h1 id="my-real-id">/);
  assert.doesNotMatch(html, /id="my-title"/);
});

test('a whole realistic document with multiple internal links (a Contents/TOC-style section) resolves every single one', () => {
  const doc = parseOrg(
    '* Contents\n[[#section-a][Section A]]\n[[#section-b][Section B]]\n* Section A\n:PROPERTIES:\n:CUSTOM_ID: section-a\n:END:\nContent A.\n* Section B\n:PROPERTIES:\n:CUSTOM_ID: section-b\n:END:\nContent B.\n'
  );
  const html = exportToHtml(doc);
  const hrefs = [...html.matchAll(/href="(#[^"]+)"/g)].map((m) => m[1]);
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  assert.equal(hrefs.length, 2);
  for (const href of hrefs) assert.ok(ids.has(href.slice(1)), `${href} should resolve to a real id`);
});
