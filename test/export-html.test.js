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
  assert.match(out, /<h1[^>]*>.*Middle<\/h1>/);
  assert.match(out, /<h2[^>]*>.*Deep<\/h2>/);
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
    '#+OPTIONS: toc:nil\n* Contents\n[[#section-a][Section A]]\n[[#section-b][Section B]]\n* Section A\n:PROPERTIES:\n:CUSTOM_ID: section-a\n:END:\nContent A.\n* Section B\n:PROPERTIES:\n:CUSTOM_ID: section-b\n:END:\nContent B.\n'
  );
  const html = exportToHtml(doc);
  const hrefs = [...html.matchAll(/href="(#[^"]+)"/g)].map((m) => m[1]);
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  assert.equal(hrefs.length, 2);
  for (const href of hrefs) assert.ok(ids.has(href.slice(1)), `${href} should resolve to a real id`);
});

// ---- width-cookie row exclusion (real org's own "<N>" column-width directive) ----

test('THE FIX: a width-cookie row ("<N>" in every cell) is excluded entirely, not shown as data or mistaken for the header', () => {
  const doc = parseOrg('* H\n| <10> | <5> |\n| Name | Age |\n|---+---|\n| Al | 9 |\n');
  const html = exportToHtml(doc);
  assert.doesNotMatch(html, /&lt;10&gt;/);
  assert.doesNotMatch(html, /&lt;5&gt;/);
});

test('THE FIX: with the cookie row correctly excluded, the REAL header row is the one actually promoted to <th>, not demoted into the body', () => {
  const doc = parseOrg('* H\n| <10> | <5> |\n| Name | Age |\n|---+---|\n| Al | 9 |\n');
  const html = exportToHtml(doc);
  assert.match(html, /<thead><tr><th>Name<\/th><th>Age<\/th><\/tr><\/thead>/);
});

test('a table with no width-cookie row is completely unaffected', () => {
  const doc = parseOrg('* H\n| Name | Age |\n|---+---|\n| Al | 9 |\n');
  const html = exportToHtml(doc);
  assert.match(html, /<thead><tr><th>Name<\/th><th>Age<\/th><\/tr><\/thead>/);
});

// ---- THE FIX: paragraph reflow -- flow unless "\\" forces a real break ----

test('THE FIX: adjacent source lines within one paragraph flow together with a plain space, not a forced <br> -- matching real org\u2019s own actual default export behavior (org-export-preserve-breaks defaults to nil)', () => {
  const doc = parseOrg('* H\nLine one\nline two continues\n');
  const out = exportToHtml(doc);
  assert.match(out, /Line one line two continues/);
  assert.doesNotMatch(out, /Line one<br>/);
});

test('THE FIX: an explicit "\\\\" marker still forces a real <br>, exactly where it appears -- not everywhere', () => {
  const doc = parseOrg('* H\nLine one\\\\\nline two forced\nline three flows\n');
  const out = exportToHtml(doc);
  const breakCount = (out.match(/<br>/g) || []).length;
  assert.equal(breakCount, 1, 'exactly one forced break, after "Line one" specifically');
  assert.match(out, /Line one<br>line two forced line three flows/);
});

test('the "\\\\" marker itself is stripped, never leaking into the HTML output as literal backslashes', () => {
  const doc = parseOrg('* H\nSome text\\\\\nmore text\n');
  const out = exportToHtml(doc);
  assert.doesNotMatch(out, /\\\\/);
});

// ---- LaTeX math fragments ---------------------------------------------------

function withMockKatex(fn) {
  const prevWindow = globalThis.window;
  globalThis.window = { katex: { renderToString: (source, opts) => `<span class="katex" data-mode="${opts.displayMode}">${source}</span>` } };
  try {
    return fn();
  } finally {
    globalThis.window = prevWindow;
  }
}

test('THE FIX: a math fragment renders through the engine when available, into the exported HTML', () => {
  withMockKatex(() => {
    const doc = parseOrg('* H\nSome text $a^2=b$ here.\n');
    const out = exportToHtml(doc);
    assert.ok(out.includes('<span class="katex" data-mode="false">a^2=b</span>'));
  });
});

test('THE FIX: KaTeX\u2019s own CSS is included in the exported document\u2019s <head> ONLY when the document actually contains a successfully-rendered math fragment', () => {
  withMockKatex(() => {
    const withMath = exportToHtml(parseOrg('* H\nSome text $a^2=b$ here.\n'));
    assert.ok(withMath.includes('.katex{'), 'a math-containing document must include the CSS');
  });
  const withoutMath = exportToHtml(parseOrg('* H\nJust plain text, no math at all.\n'));
  assert.ok(!withoutMath.includes('.katex{'), 'a document with no math at all must not carry ~20KB of unused CSS');
});

test('THE FIX: the engine being entirely unavailable (no window.katex, e.g. this exact test environment by default) falls back to a visibly-distinct raw-source span, not a crash or silently-dropped content', () => {
  const prevWindow = globalThis.window;
  delete globalThis.window;
  try {
    const doc = parseOrg('* H\nSome text $a^2=b$ here.\n');
    const out = exportToHtml(doc);
    assert.ok(out.includes('a^2=b'), 'the raw source text must still be present, not silently dropped');
    assert.ok(out.includes('dashed'), 'a visibly-distinct fallback treatment, not rendered as if it were ordinary text');
  } finally {
    globalThis.window = prevWindow;
  }
});

test('a malformed LaTeX fragment (the engine rejects it) also falls back to the raw-source span, and does not include the CSS on its own (no OTHER math on the page succeeded)', () => {
  const prevWindow = globalThis.window;
  globalThis.window = { katex: { renderToString: () => { throw new Error('bad'); } } };
  try {
    const doc = parseOrg('* H\nSome text $bad^\\varnothing$ here.\n');
    const out = exportToHtml(doc);
    assert.ok(out.includes('bad^\\varnothing'));
    assert.ok(!out.includes('.katex{'));
  } finally {
    globalThis.window = prevWindow;
  }
});

test('THE FIX: a multi-line LaTeX fragment (the user\u2019s own reported "align" example, with a blank line in its middle) renders as ONE fragment in HTML export, not broken apart at the blank line', () => {
  withMockKatex(() => {
    const doc = parseOrg([
      '* H',
      '',
      '\\begin{align}',
      '  f(x) &= (x + 3)^2 \\\\',
      '  ',
      '       &= x^2 + 6x + 9',
      '\\end{align}',
    ].join('\n'));
    const out = exportToHtml(doc);
    const katexSpanCount = (out.match(/class="katex"/g) || []).length;
    assert.equal(katexSpanCount, 1, 'the whole environment renders as exactly one KaTeX span, not split into several');
    assert.ok(out.includes('f(x)') && out.includes('x^2 + 6x + 9'), 'content from both sides of the blank line is present');
  });
});

test('THE FIX: a #+BEGIN_QUOTE block also correctly handles a multi-line LaTeX fragment', () => {
  withMockKatex(() => {
    const doc = parseOrg(['* H', '#+BEGIN_QUOTE', '\\begin{equation}', 'x=y', '\\end{equation}', '#+END_QUOTE'].join('\n'));
    const out = exportToHtml(doc);
    assert.ok(out.includes('<blockquote>'));
    assert.ok(out.includes('class="katex"'));
  });
});

// ---- THE FIX: #+TITLE / #+AUTHOR / #+DATE / #+OPTIONS -------------------------

test('THE EXACT REQUEST: #+TITLE renders as a visible <h1 class="title"> in the body, not just the <title> tag', () => {
  const doc = parseOrg('#+TITLE: My Test Document\n* Heading\nText.\n');
  const html = exportToHtml(doc);
  assert.match(html, /<h1 class="title">My Test Document<\/h1>/);
});

test('#+AUTHOR / #+DATE render right after the title', () => {
  const doc = parseOrg('#+TITLE: T\n#+AUTHOR: Jane Doe\n#+DATE: 2026-01-15\n* Heading\nText.\n');
  const html = exportToHtml(doc);
  assert.match(html, /<p class="author">Jane Doe<\/p>/);
  assert.match(html, /<p class="date">2026-01-15<\/p>/);
});

test('THE FIX: author:nil / date:nil each independently suppress their own field', () => {
  const doc = parseOrg('#+TITLE: T\n#+AUTHOR: Jane Doe\n#+DATE: 2026-01-15\n#+OPTIONS: author:nil\n* Heading\nText.\n');
  const html = exportToHtml(doc);
  assert.ok(!html.includes('Jane Doe'));
  assert.ok(html.includes('2026-01-15'));
});

test('a document with no #+TITLE shows no title/author/date block at all', () => {
  const doc = parseOrg('* Heading\nText.\n');
  const html = exportToHtml(doc);
  assert.ok(!html.includes('class="title"'));
});

test('THE EXACT REQUEST: section numbers render as real org\u2019s own confirmed <span class="section-number-N"> convention', () => {
  const doc = parseOrg('* A\n** B\n');
  const html = exportToHtml(doc);
  assert.match(html, /<span class="section-number-1">1\.<\/span> A/);
  assert.match(html, /<span class="section-number-2">1\.1\.<\/span> B/);
});

test('#+OPTIONS: num:nil removes section numbers entirely', () => {
  const doc = parseOrg('#+OPTIONS: num:nil\n* A\n** B\n');
  const html = exportToHtml(doc);
  assert.ok(!html.includes('section-number'));
});

test('THE EXACT REQUEST: a document with 2+ headings gets an auto-generated Table of Contents, matching real Emacs org-mode\u2019s own confirmed <div id="table-of-contents"> structure', () => {
  const doc = parseOrg('* First\n* Second\n');
  const html = exportToHtml(doc);
  assert.match(html, /<div id="table-of-contents"><h2>Table of Contents<\/h2>/);
  assert.match(html, /<a href="#first">1\. First<\/a>/);
  assert.match(html, /<a href="#second">2\. Second<\/a>/);
});

test('a document with only one heading gets no Table of Contents -- nothing worth listing', () => {
  const doc = parseOrg('* Only\nText.\n');
  const html = exportToHtml(doc);
  assert.ok(!html.includes('table-of-contents'));
});

test('toc:nil disables the Table of Contents entirely, independent of num:', () => {
  const doc = parseOrg('#+OPTIONS: toc:nil\n* First\n* Second\n');
  const html = exportToHtml(doc);
  assert.ok(!html.includes('table-of-contents'));
  assert.ok(html.includes('section-number'), 'numbering is untouched by toc:nil');
});

test('THE EXACT REQUEST: toc:1 limits the ToC listing to headers 1 only, while section numbering throughout the body still goes to full depth', () => {
  const doc = parseOrg('#+OPTIONS: toc:1\n* A\n** B\n*** C\n* D\n');
  const html = exportToHtml(doc);
  const tocBlock = html.match(/<div id="table-of-contents">.*?<\/div>/s)[0];
  assert.ok(tocBlock.includes('>1. A<'));
  assert.ok(tocBlock.includes('>2. D<'));
  assert.ok(!tocBlock.includes('B'));
  assert.ok(html.includes('1.1.1.'), 'still fully numbered in the body');
});

test('the Table of Contents is properly nested (a <ul> inside the parent <li> for a child heading)', () => {
  const doc = parseOrg('* A\n** B\n* C\n');
  const html = exportToHtml(doc);
  const tocBlock = html.match(/<div id="table-of-contents">.*?<\/div>/s)[0];
  assert.match(tocBlock, /<li><a href="#a">1\. A<\/a><ul><li><a href="#b">1\.1\. B<\/a><\/li><\/ul><\/li>/);
});

test('THE EXACT REQUEST: creator:nil is the default -- no "Generated by" notice unless explicitly enabled', () => {
  const doc = parseOrg('#+TITLE: T\n* Heading\nText.\n');
  const html = exportToHtml(doc);
  assert.ok(!html.includes('Generated by'));
});

test('creator:t adds a "Generated by org-pwa" notice', () => {
  const doc = parseOrg('#+TITLE: T\n#+OPTIONS: creator:t\n* Heading\nText.\n');
  const html = exportToHtml(doc);
  assert.match(html, /<p class="creator">Generated by org-pwa<\/p>/);
});

test('exporting a scoped subtree shows no title/author/date/ToC/creator block, but section numbering (independent of scope) still applies', () => {
  const doc = parseOrg('#+TITLE: Whole Doc\n#+OPTIONS: creator:t\n* Target\n** Child\n* Other\n');
  const target = doc.children[0];
  const html = exportToHtml(doc, target);
  assert.ok(!html.includes('class="title"'));
  assert.ok(!html.includes('table-of-contents'));
  assert.ok(!html.includes('Generated by'));
  assert.ok(html.includes('section-number'), 'numbering still applies even for a scoped export');
});

// ---- THE FIX: document-level preamble body rendering (doc.body) ---------------

test('THE FIX: a document-level preamble body (doc.body, text before the first heading) now renders in HTML export -- previously never rendered at all, needed for #+INCLUDE\u2019s own block-type variant', () => {
  const doc = parseOrg('#+TITLE: T\nSome preamble text.\n\n* Heading\nHeading text.\n');
  const html = exportToHtml(doc);
  assert.ok(html.includes('Some preamble text.'));
  assert.ok(html.indexOf('Some preamble text.') < html.indexOf('id="heading"'), 'preamble renders before the actual heading (not the title, which is also an <h1>)');
});

test('a scoped subtree export shows no document-level preamble', () => {
  const doc = parseOrg('Preamble text.\n\n* Target\nText.\n* Other\nText.\n');
  const target = doc.children[0];
  const html = exportToHtml(doc, target);
  assert.ok(!html.includes('Preamble text.'));
});

test('THE FIX: a lowercase #+title: sets the <title> tag too, matching real Emacs org-mode\u2019s own confirmed case-insensitive keyword parsing', () => {
  const doc = parseOrg('#+title: org-pwa README.org\n* Heading\nText.\n');
  const html = exportToHtml(doc);
  assert.match(html, /<title>org-pwa README\.org<\/title>/);
});

// ---- THE FEATURE: #+HTML_HEAD: and #+BEGIN_EXPORT html ------------------------

test('THE EXACT REQUEST: #+HTML_HEAD: content is inserted verbatim into <head>, right before </head>', () => {
  const doc = parseOrg('#+HTML_HEAD: <style>body{color:red}</style>\n\n* Heading\nText.\n');
  const html = exportToHtml(doc);
  assert.match(html, /<style>body\{color:red\}<\/style>\n<\/head>/);
});

test('THE EXACT REQUEST: multiple #+HTML_HEAD: lines (a multi-line <style> block) all appear, in order', () => {
  const orgText = [
    '#+HTML_HEAD: <style>',
    '#+HTML_HEAD: @media print {',
    '#+HTML_HEAD:   header { position: fixed; top: 0; }',
    '#+HTML_HEAD: }',
    '#+HTML_HEAD: </style>',
    '',
    '* Heading',
    'Text.',
  ].join('\n');
  const html = exportToHtml(parseOrg(orgText));
  assert.match(html, /<style>\n@media print \{\n  header \{ position: fixed; top: 0; \}\n\}\n<\/style>/);
});

test('no #+HTML_HEAD: at all -- nothing extra is inserted, no stray blank block', () => {
  const html = exportToHtml(parseOrg('* Heading\nText.\n'));
  assert.doesNotMatch(html, /<style><\/style>/);
});

test('#+HTML_HEAD: still applies during a subtree-only export, matching real Emacs org-mode\u2019s own confirmed behavior', () => {
  const doc = parseOrg('#+HTML_HEAD: <style>body{color:blue}</style>\n\n* Subtree\nText.\n');
  const html = exportToHtml(doc, doc.children[0]);
  assert.match(html, /body\{color:blue\}/);
});

test('THE EXACT REQUEST: #+BEGIN_EXPORT html ... #+END_EXPORT is rendered raw/verbatim, no escaping, no wrapping tag', () => {
  const doc = parseOrg('#+BEGIN_EXPORT html\n<header><h1>My Document Header</h1></header>\n#+END_EXPORT\n\n* Heading\nText.\n');
  const html = exportToHtml(doc);
  assert.match(html, /<header><h1>My Document Header<\/h1><\/header>/);
});

test('THE FIX: an #+BEGIN_EXPORT block for a DIFFERENT backend (ascii) is omitted entirely from HTML export, matching real Emacs org-mode\u2019s own confirmed backend-scoping', () => {
  const doc = parseOrg('#+BEGIN_EXPORT ascii\nASCII-only content\n#+END_EXPORT\n\n* Heading\nText.\n');
  const html = exportToHtml(doc);
  assert.doesNotMatch(html, /ASCII-only content/);
});

test('#+BEGIN_EXPORT html matches case-insensitively too ("HTML", "Html")', () => {
  for (const tag of ['HTML', 'Html', 'html']) {
    const doc = parseOrg(`#+BEGIN_EXPORT ${tag}\n<p>x</p>\n#+END_EXPORT\n\n* H\nText.\n`);
    assert.match(exportToHtml(doc), /<p>x<\/p>/, `tag "${tag}" should match`);
  }
});

test('an #+BEGIN_EXPORT html block inside a heading\u2019s own body renders in that heading\u2019s own content, not the document preamble', () => {
  const doc = parseOrg('* Second\nMore content here.\n\n#+BEGIN_EXPORT html\n<footer><p>footer text</p></footer>\n#+END_EXPORT\n');
  const html = exportToHtml(doc);
  assert.match(html, /More content here\.[\s\S]*<footer><p>footer text<\/p><\/footer>/);
});
