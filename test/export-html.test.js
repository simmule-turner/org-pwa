import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { exportToHtml } from '../src/export-html.js';

// ---- document shell -------------------------------------------------------

test('produces a complete standalone HTML document', () => {
  const doc = parseOrg('* Hello');
  const out = exportToHtml(doc);
  // Emacs's default doctype is xhtml-strict
  assert.ok(out.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"'));
  assert.ok(out.includes('<meta http-equiv="Content-Type" content="text/html;charset=utf-8" />'));
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

test('exporting a subtree makes the selected heading an h1, shifting descendants accordingly', () => {
  const doc = parseOrg('* Top\n** Middle\n*** Deep');
  const middle = doc.children[0].children[0];
  const out = exportToHtml(doc, middle);
  assert.match(out, /<h1[^>]*>.*Middle<\/h1>/);
  assert.match(out, /<h2[^>]*>.*Deep<\/h2>/);
  assert.ok(!out.includes('Top'));
});

// ---- inline formatting --------------------------------------------------

test('a link with a description renders as a real anchor with that text', () => {
  const doc = parseOrg('* A\n[[https://example.com][My Link]]');
  assert.ok(exportToHtml(doc).includes('<a href="https://example.com">My Link</a>'));
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

test('a link target with special characters is escaped inside the href attribute', () => {
  const doc = parseOrg('* A\n[[https://example.com?a=1&b=2][Link]]');
  const out = exportToHtml(doc);
  assert.ok(out.includes('href="https://example.com?a=1&amp;b=2"'));
});

// ---- lists ----------------------------------------------------------------

test('checkbox items are written as text, as org-html-checkbox-type ascii does; unicode and html are the other choices', () => {
  const doc = parseOrg('* A\n- [ ] todo\n- [X] done\n- [-] some');
  const out = exportToHtml(doc);
  assert.ok(out.includes('<code>[&#xa0;]</code> todo'));
  assert.ok(out.includes('<code>[X]</code> done'));
  assert.ok(out.includes('<code>[-]</code> some'));
  const unicode = exportToHtml(doc, null, { defaults: { checkbox: 'unicode' } });
  assert.ok(unicode.includes('&#x2610; todo') && unicode.includes('&#x2611; done') && unicode.includes('&#x2610; some'));
  const inputs = exportToHtml(doc, null, { defaults: { checkbox: 'html' } });
  assert.ok(inputs.includes("<input type='checkbox' /> todo") && inputs.includes("<input type='checkbox' checked='checked' /> done"));
});

// ---- tables ---------------------------------------------------------------

test('a table rule/separator row in the org source does not produce an empty row', () => {
  const doc = parseOrg('* A\n| Name | Age |\n|------+-----|\n| Alice | 30 |');
  const out = exportToHtml(doc);
  const trCount = (out.match(/<tr>/g) || []).length;
  assert.equal(trCount, 2); // header + one data row, no third empty row from the rule line
});

// ---- blocks -----------------------------------------------------------

test('a COMMENT block is dropped entirely', () => {
  const doc = parseOrg('* A\nVisible.\n#+BEGIN_COMMENT\nhidden\n#+END_COMMENT');
  const out = exportToHtml(doc);
  assert.ok(!out.includes('hidden'));
  assert.ok(out.includes('Visible.'));
});

// ---- horizontal rule -----------------------------------------------------

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

test('a document with no footnotes produces no Footnotes section at all', () => {
  const doc = parseOrg('* Heading\nJust ordinary text.\n');
  const html = exportToHtml(doc);
  assert.doesNotMatch(html, /class="footnotes"/);
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
  assert.match(html, /<h2 id="capture">/);
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

test('a link resolving to a heading OUTSIDE the exported scope falls back to the original target text -- nowhere real to anchor to within this specific export', () => {
  const doc = parseOrg('* Outside\n:PROPERTIES:\n:CUSTOM_ID: outside\n:END:\n* Exported Scope\n[[#outside][Link out]]\n');
  const scopeHeading = doc.children[1];
  const html = exportToHtml(doc, scopeHeading);
  assert.match(html, /href="#outside"/); // best-effort fallback, unchanged from before this fix
  assert.doesNotMatch(html, /id="outside"/); // the out-of-scope heading correctly isn't included/anchored at all
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

// ---- THE FIX: paragraph reflow -- flow unless "\\" forces a real break ----

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

test('#+AUTHOR / #+DATE appear in the postamble', () => {
  const doc = parseOrg('#+TITLE: T\n#+AUTHOR: Jane Doe\n#+DATE: 2026-01-15\n* Heading\nText.\n');
  const html = exportToHtml(doc);
  assert.match(html, /<p class="author">Author: Jane Doe<\/p>/);
  assert.match(html, /<p class="date">Date: 2026-01-15<\/p>/);
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

test('#+OPTIONS: num:nil removes section numbers entirely', () => {
  const doc = parseOrg('#+OPTIONS: num:nil\n* A\n** B\n');
  const html = exportToHtml(doc);
  assert.ok(!html.includes('section-number'));
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

// ---- comma-escape stripping in block content ------------------------------

test('THE FIX: a comma-escaped line inside a #+BEGIN_SRC block (real org syntax protecting the outer parser from a literal "#+..." line) has its leading comma stripped for display, per direct report of it showing up as a stray character in HTML export', () => {
  const doc = parseOrg('#+BEGIN_SRC org\n,#+CATEGORY: Projects\n#+END_SRC\n');
  const html = exportToHtml(doc, null);
  assert.match(html, /#\+CATEGORY: Projects/);
  assert.doesNotMatch(html, /,#\+CATEGORY/);
});

test('the comma-escape strip also works when the escaped line is indented (nested under a heading), not just at column 0', () => {
  const doc = parseOrg('* Heading\n#+BEGIN_SRC org\n  ,#+CATEGORY: Projects\n#+END_SRC\n');
  const html = exportToHtml(doc, null);
  assert.match(html, /#\+CATEGORY: Projects/);
  assert.doesNotMatch(html, /,#\+CATEGORY/);
});

test('a comma NOT part of the escape convention (not followed by * or #+) is left untouched', () => {
  const doc = parseOrg('#+BEGIN_SRC text\n,just a regular line starting with a comma\n#+END_SRC\n');
  const html = exportToHtml(doc, null);
  assert.match(html, /,just a regular line/);
});

test('the comma-escape strip also applies inside a #+BEGIN_QUOTE block', () => {
  const doc = parseOrg('#+BEGIN_QUOTE\n,* not a real heading\n#+END_QUOTE\n');
  const html = exportToHtml(doc, null);
  assert.match(html, /\* not a real heading/);
  assert.doesNotMatch(html, />,\*/);
});

// ---- ox-html structure: headings, inline markup, lists, tables, blocks, footnotes, links, options --------------------

const body = (org) => exportToHtml(parseOrg(org));

test('top-level headings are h2 under an h1 title, in outline containers, and deeper headings than H become list items', () => {
  const out = body('#+TITLE: T\n* A\n** B\n*** C\n**** D\n***** E\n');
  assert.match(out, /<h1 class="title">T<\/h1>/);
  assert.match(out, /<div id="outline-container-a" class="outline-2">\s*<h2 id="a">/);
  assert.match(out, /<h4 id="c">/);
  assert.doesNotMatch(out, /<h5/);
  assert.match(out, /<ol class="org-ol">\s*<li><a id="d"><\/a>D<br \/>/);
});

test('#+OPTIONS: H: sets how many levels are headings', () => {
  const out = body('#+OPTIONS: H:5\n* A\n** B\n*** C\n**** D\n***** E\n');
  assert.match(out, /<h6 id="e">/);
});

test('TODO keywords get todo/done classes from the file\u2019s own #+TODO: sequence', () => {
  const out = body('#+TODO: TODO WAIT | DONE KILL\n* TODO Active\n* DONE Finished\n* KILL Cancelled');
  assert.match(out, /<span class="todo TODO">TODO<\/span> Active/);
  assert.match(out, /<span class="done DONE">DONE<\/span> Finished/);
  assert.match(out, /<span class="done KILL">KILL<\/span>/);
});

test('priority shows only with pri:t, and todo:nil hides keywords', () => {
  assert.ok(!body('* [#A] Important').includes('class="priority"'));
  assert.ok(body('#+OPTIONS: pri:t\n* [#A] Important').includes('<span class="priority">[A]</span>'));
  assert.ok(!body('#+OPTIONS: todo:nil\n* TODO Task').includes('<span class="todo'));
});

test('tags render as ox-html tag spans, and tags:nil hides them', () => {
  const out = body('* A heading :work:urgent:');
  assert.ok(out.includes('<span class="tag"><span class="work">work</span>&#xa0;<span class="urgent">urgent</span></span>'));
  assert.ok(!body('#+OPTIONS: tags:nil\n* A :work:').includes('class="tag"'));
});

test('planning is hidden by default and shown with p:t', () => {
  assert.ok(!body('* A\nSCHEDULED: <2026-08-01>').includes('SCHEDULED'));
  assert.match(body('#+OPTIONS: p:t\n* A\nSCHEDULED: <2026-08-01>'), /<span class="timestamp-kwd">SCHEDULED:<\/span> <span class="timestamp">&lt;2026-08-01&gt;<\/span>/);
});

test('emphasis maps to ox-html tags, and *:nil keeps the markers', () => {
  const out = body('* A\n*bold* /italic/ _underline_ +strike+ ~code~ =verb=');
  assert.ok(out.includes('<b>bold</b>'));
  assert.ok(out.includes('<i>italic</i>'));
  assert.ok(out.includes('<span class="underline">underline</span>'));
  assert.ok(out.includes('<del>strike</del>'));
  assert.ok(out.includes('<code>code</code>'));
  assert.ok(out.includes('*bold*') === false);
  assert.ok(body('#+OPTIONS: *:nil\n* A\n*bold*').includes('*bold*'));
});

test('image links become <img>, with a file name alt; a link wrapping an image keeps the link', () => {
  assert.ok(body('* A\n[[https://example.com/pic.png]]').includes('<img src="https://example.com/pic.png" alt="pic.png" />'));
  assert.ok(body('* A\nSee [[file:a.png][file:thumb.png]] here').includes('<a href="a.png"><img src="thumb.png" alt="thumb.png" /></a>'));
});

test('a standalone image with a caption is a figure', () => {
  const out = body('* A\n#+CAPTION: Sunset\n#+ATTR_HTML: :width 100 :alt hi\n[[file:s.png]]\n');
  assert.match(out, /<div id="figure" class="figure">\s*<p><img src="s.png" alt="hi" width="100" \/>/);
  assert.match(out, /<span class="figure-number">Figure 1: <\/span>Sunset/);
});

test('text is escaped, and entities and special strings follow ox-html', () => {
  const out = body('* A\nR&D <b> \\alpha \\rarr x -- y --- z ... \\nbsp.');
  assert.ok(out.includes('R&amp;D &lt;b&gt; &alpha; &rarr; x &#x2013; y &#x2014; z &#x2026; &nbsp;.'));
  assert.ok(body('#+OPTIONS: e:nil -:nil\n* A\n\\alpha --').includes('\\alpha --'));
});

test('lists: org-ul / org-ol with value, descriptive lists as dl, checkboxes with state classes', () => {
  assert.ok(body('* A\n- one\n- two').includes('<ul class="org-ul">\n<li>one</li>\n<li>two</li>\n</ul>'));
  assert.ok(body('* A\n1. [@5] five\n2. six').includes('<li value="5">five</li>'));
  assert.ok(body('* A\n- term :: description').includes('<dl class="org-dl">\n<dt>term</dt><dd>description</dd>\n</dl>'));
  const boxes = body('* A\n- [ ] a\n- [X] b\n- [-] c');
  assert.ok(boxes.includes('<li class="off"><code>[&#xa0;]</code> a</li>'));
  assert.ok(boxes.includes('<li class="on"><code>[X]</code> b</li>'));
  assert.ok(boxes.includes('<li class="trans">'));
});

test('a list item keeps its continuation paragraphs, sub-lists and blocks', () => {
  const out = body('* A\n1. one\n2. two\n   more\n\n   second para\n   - sub\n3. three\n   #+begin_example\n   code\n   #+end_example\n');
  assert.match(out, /<li><p>\ntwo\nmore\n<\/p>\n<p>\nsecond para\n<\/p>\n<ul class="org-ul">\n<li>sub<\/li>\n<\/ul><\/li>/);
  assert.match(out, /<li><p>\nthree\n<\/p>\n<pre class="example" id="[^"]+">\ncode\n<\/pre><\/li>/);
  assert.equal((out.match(/<ol class="org-ol">/g) || []).length, 1, 'one list, not three');
});

test('nested list items produce a nested list inside the parent <li>', () => {
  assert.ok(body('* A\n- parent\n  - child').includes('<li>parent\n<ul class="org-ul">\n<li>child</li>\n</ul></li>'));
});

test('tables: header group from a rule, alignment from the numbers, colgroup, caption, ATTR_HTML', () => {
  const out = body('* A\n#+CAPTION: Ages\n| Name | Age |\n|------+-----|\n| Alice | 30 |\n| Bob | 4 |\n');
  assert.match(out, /<caption class="t-above"><span class="table-number">Table 1:<\/span> Ages<\/caption>/);
  assert.match(out, /<col  class="org-left" \/>\s*<col  class="org-right" \/>/);
  assert.match(out, /<thead>\s*<tr>\s*<th scope="col" class="org-left">Name<\/th>\s*<th scope="col" class="org-right">Age<\/th>/);
  assert.match(out, /<td class="org-right">30<\/td>/);
  assert.ok(!body('* A\n| a | b |\n| c | d |').includes('<thead>'), 'no rule, no header');
  assert.ok(body('* A\n#+ATTR_HTML: :border 0 :rules all\n| a |').includes('border="0" cellspacing="0" cellpadding="6" rules="all"'));
});

test('alignment and width cookie rows are directives, not data', () => {
  const out = body('* A\n| <r> | <l10> |\n| a | b |\n|---+---|\n| 1 | 2 |\n');
  assert.ok(!out.includes('&lt;r&gt;'));
  assert.match(out, /<col  class="org-right" \/>\s*<col  class="org-left" \/>/);
});

test('blocks: quote, center, verse, example, fixed-width, src with caption and line numbers', () => {
  assert.ok(body('* A\n#+BEGIN_QUOTE\nWise words.\n#+END_QUOTE').includes('<blockquote>\n<p>\nWise words.\n</p>\n</blockquote>'));
  assert.ok(body('* A\n#+begin_center\nMid\n#+end_center').includes('<div class="org-center">\n<p>\nMid\n</p>\n</div>'));
  assert.ok(body('* A\n#+begin_verse\nRoses\n  Violets\n#+end_verse').includes('<p class="verse">\nRoses<br />\n&#xa0;&#xa0;Violets<br />\n</p>'));
  assert.ok(body('* A\n#+begin_example\n<x>\n#+end_example').includes('\n&lt;x&gt;\n</pre>') && /<pre class="example" id="[^"]+">/.test(body('* A\n#+begin_example\n<x>\n#+end_example')));
  assert.ok(body('* A\n: fixed\n:   more').includes('<pre class="example">\nfixed\n  more\n</pre>'));
  const src = body('* A\n#+CAPTION: Hello\n#+begin_src python -n\nprint(1)\n#+end_src');
  assert.match(src, /<div class="org-src-container">\s*<label class="org-src-name"><span class="listing-number">Listing 1: <\/span>Hello<\/label><pre class="src src-python"><span class="linenr">1: <\/span><span class="org-builtin">print<\/span>\(<span class="org-constant">1<\/span>\)/);
});

test('special blocks become divs of that class; COMMENT blocks, comments and unknown keywords vanish; HTML export passes through', () => {
  const out = body('* A\n#+begin_note\nwatch *out*\n#+end_note\n# comment\n#+begin_comment\nhidden\n#+end_comment\n#+HTML: <hr class="x">\n#+begin_export html\n<i>raw</i>\n#+end_export\n#+begin_export latex\n\\x\n#+end_export');
  assert.match(out, /<div class="note" id="[^"]+">\s*<p>\nwatch <b>out<\/b>\n<\/p>\s*<\/div>/);
  const page = out.slice(out.indexOf('<div id="content"'));
  assert.ok(!page.includes('hidden') && !page.includes('comment') && !page.includes('\\x'));
  assert.ok(out.includes('<hr class="x">') && out.includes('<i>raw</i>'));
});

test('drawers show their text except LOGBOOK (d: controls it); COMMENT, noexport and archived headings are not exported', () => {
  const out = body('* A\n:MYDRAWER:\nin drawer\n:END:\n* COMMENT Gone\nx1\n* Secret :noexport:\nx2\n* Old :ARCHIVE:\nx3\n');
  assert.ok(out.includes('in drawer'));
  assert.ok(!out.includes('Gone') && !out.includes('x1') && !out.includes('x2'));
  assert.ok(out.includes('Old') && !out.includes('x3'), 'an archived heading keeps its title only');
  assert.ok(!body('#+OPTIONS: d:nil\n* A\n:MYDRAWER:\nin drawer\n:END:').includes('in drawer'));
});

test('#+SELECT_TAGS: and #+EXCLUDE_TAGS: pick headings; tasks:nil drops TODO headings', () => {
  const sel = body('#+SELECT_TAGS: keep\n* One :keep:\n** In\n* Two\ntwo text');
  assert.ok(sel.includes('One') && sel.includes('In') && !sel.includes('two text'));
  assert.ok(!body('#+EXCLUDE_TAGS: skip\n* A :skip:\nx\n* B\ny').includes('>A<'));
  assert.ok(!body('#+OPTIONS: tasks:nil\n* TODO t\n* plain').includes('>t<'));
});

test('timestamps, inline src, macros and export snippets', () => {
  const out = body('#+MACRO: hi Hello $1\n* A\n<2026-10-11 Sun 10:00> [2026-10-11 Sun] {{{hi(you)}}} src_js{1+1} @@html:<b>x</b>@@');
  assert.ok(out.includes('<span class="timestamp-wrapper"><span class="timestamp">&lt;2026-10-11 Sun 10:00&gt; </span></span>'));
  assert.ok(out.includes('Hello you'));
  assert.ok(out.includes('<code class="src src-js">1+1</code>'));
  assert.ok(out.includes('<b>x</b>'));
});

test('\\n:t turns every line break into <br />, and a trailing \\\\ always does', () => {
  assert.ok(body('* H\nLine one\nline two\n').includes('Line one\nline two'));
  assert.ok(body('#+OPTIONS: \\n:t\n* H\nLine one\nline two').includes('Line one<br />\nline two<br />'));
  assert.ok(body('* H\nLine one\\\\\nline two').includes('Line one<br />\nline two'));
});

test('footnotes are numbered in order of reference, repeat references get distinct ids, and the section is ox-html\u2019s', () => {
  const out = body('* H\nA[fn:b] B[fn:a] again[fn:b] inline[fn::the note].\n\n[fn:a] Alpha.\n\n[fn:b] Beta.\n');
  assert.match(out, /<sup><a id="fnr.1" class="footref" href="#fn.1" role="doc-backlink">1<\/a><\/sup>/);
  assert.match(out, /<a id="fnr.1.100" class="footref" href="#fn.1"/);
  assert.match(out, /<a id="fnr.2" class="footref" href="#fn.2"/);
  assert.match(out, /<h2 class="footnotes">Footnotes: <\/h2>/);
  assert.match(out, /<sup><a id="fn.1" class="footnum" href="#fnr.1" role="doc-backlink">1<\/a><\/sup> <div class="footpara" role="doc-footnote"><p class="footpara">\s*Beta\./);
  assert.match(out, /<p class="footpara">the note<\/p>/);
  assert.equal((out.match(/id="fn\.1"/g) || []).length, 1);
});

test('export calls do not share footnote numbering', () => {
  assert.match(body('* H\nOne[fn::first].'), /id="fnr\.1"/);
  assert.match(body('* H\nTwo[fn::second].'), /id="fnr\.1"/);
});

test('links: #custom-id, *heading, fuzzy and radio targets resolve to ids; file links; unresolved ones keep a usable href', () => {
  const doc = '* Intro\n[[*My Cool Section][below]] [[#cid][c]] [[My Cool Section][fuzzy]] [[target][t]] <<target>>\n* My Cool Section\n* Other\n:PROPERTIES:\n:CUSTOM_ID: cid\n:END:\n';
  const out = body(doc);
  assert.match(out, /<a href="#my-cool-section">below<\/a>/);
  assert.match(out, /<a href="#cid">c<\/a>/);
  assert.match(out, /<a href="#my-cool-section">fuzzy<\/a>/);
  assert.match(out, /<a href="#org-target-target">t<\/a>/);
  assert.ok(body('* A\n[[file:other.org][f]] [[file:/abs/x.pdf][p]] [[mailto:a@b.c][m]]').includes('<a href="other.html">f</a> <a href="file:///abs/x.pdf">p</a> <a href="mailto:a@b.c">m</a>'));
});

test('heading ids: two headings with one title are disambiguated, an empty slug becomes "section", CUSTOM_ID wins', () => {
  const same = body('* Notes\nfirst\n* Notes\nsecond\n');
  assert.match(same, /<h2 id="notes">/);
  assert.match(same, /<h2 id="notes-2">/);
  assert.match(body('* \u2014\u2014\u2014\nx\n'), /<h2 id="section">/);
  const custom = body('* My Title\n:PROPERTIES:\n:CUSTOM_ID: my-real-id\n:END:\nx\n');
  assert.match(custom, /<h2 id="my-real-id">/);
  assert.doesNotMatch(custom, /id="my-title"/);
});

test('section numbers and a table of contents follow ox-html', () => {
  const doc = '#+OPTIONS: toc:2\n* A\n** B\n*** C\n* D\n';
  const html = body(doc);
  assert.match(html, /<span class="section-number-2">1\.<\/span> A/);
  assert.match(html, /<span class="section-number-3">1\.1\.<\/span> B/);
  const toc = html.match(/<div id="table-of-contents" role="doc-toc">.*?<\/div>\s*<\/div>/s)[0];
  assert.match(toc, /<li><a href="#a">1\. A<\/a>\s*<ul>\s*<li><a href="#b">1\.1\. B<\/a><\/li>\s*<\/ul>\s*<\/li>/);
  assert.ok(!toc.includes('>C<'), 'toc:2 stops at level 2');
  assert.ok(!body('#+OPTIONS: toc:nil\n* A\n* B').includes('id="table-of-contents"'));
  assert.ok(!body('#+OPTIONS: num:nil\n* A').includes('section-number'));
});

test('#+TOC: places a table of contents, with tables and listings lists', () => {
  const out = body('#+OPTIONS: toc:nil\n* A\n#+TOC: headlines 1\n** B\n#+CAPTION: T one\n| x |\n#+CAPTION: L one\n#+begin_src sh\nls\n#+end_src\n#+TOC: tables\n#+TOC: listings\n');
  assert.match(out, /<h2>Table of Contents<\/h2>/);
  assert.match(out, /<h2>List of Tables<\/h2>[\s\S]*<span class="table-number">Table 1:<\/span> T one/);
  assert.match(out, /<h2>List of Listings<\/h2>[\s\S]*<span class="listing-number">Listing 1:<\/span> L one/);
});

test('a subtree export is titled after its heading and numbers its children from 1', () => {
  const doc = parseOrg('#+TITLE: Whole Doc\n#+OPTIONS: toc:nil\n* Target\nintro\n** Child\n* Other\n');
  const html = exportToHtml(doc, doc.children[0]);
  assert.match(html, /<h1 class="title">Target<\/h1>/);
  assert.match(html, /<span class="section-number-2">1\.<\/span> Child/);
  assert.ok(html.includes('intro') && !html.includes('Whole Doc') && !html.includes('Other'));
});

test('postamble shows the date, author and email when present; the page declares its language and meta', () => {
  const out = body('#+TITLE: T\n#+AUTHOR: Me\n#+EMAIL: me@x.org\n#+DATE: 2026-10-11\n#+DESCRIPTION: D\n#+LANGUAGE: de\n#+OPTIONS: email:t\n* A');
  assert.match(out, /<div id="postamble" class="status">\s*<p class="date">Date: 2026-10-11<\/p>\s*<p class="author">Author: Me<\/p>\s*<p class="email">Email: <a href="mailto:me@x.org">me@x.org<\/a><\/p>/);
  assert.match(out, /<html xmlns="http:\/\/www.w3.org\/1999\/xhtml" lang="de" xml:lang="de">/);
  assert.match(out, /<meta name="description" content="D" \/>/);
  assert.ok(!body('#+AUTHOR: Me\n#+OPTIONS: author:nil\n* A').includes('Author: Me'));
});

test('printing: preformatted text wraps and tables and figures avoid page breaks', () => {
  const out = body('* A');
  assert.match(out, /@media print[\s\S]*pre \{[^}]*white-space: pre-wrap/);
  assert.match(out, /break-inside: avoid/);
});

test('source blocks are coloured with htmlize\u2019s class names; unknown languages are left plain', () => {
  const out = body('* A\n#+begin_src js\n// c\nconst s = "x"; if (a < 1) {}\n#+end_src\n#+begin_src klingon\nconst <x>\n#+end_src');
  assert.ok(out.includes('<span class="org-comment">// c</span>'));
  assert.ok(out.includes('<span class="org-keyword">const</span>'));
  assert.ok(out.includes('<span class="org-string">"x"</span>'));
  assert.ok(out.includes('a &lt; <span class="org-constant">1</span>'));
  assert.ok(out.includes('<pre class="src src-klingon">const &lt;x&gt;'));
});

test('a multi-line comment or string is coloured line by line, so line numbers stay intact', () => {
  const out = body('* A\n#+begin_src js -n\n/* a\nb */\nx\n#+end_src');
  assert.ok(out.includes('<span class="linenr">1: </span><span class="org-comment">/* a</span>\n<span class="linenr">2: </span><span class="org-comment">b */</span>'));
});

test('pictures that the app could read are embedded; others keep their link', () => {
  const doc = parseOrg('* A\n[[file:a.png]] and [[file:b.png][label]]');
  const out = exportToHtml(doc, null, { images: new Map([['file:a.png', 'data:image/png;base64,AAAA']]) });
  assert.ok(out.includes('<img src="data:image/png;base64,AAAA" alt="a.png" />'));
  assert.ok(out.includes('<a href="b.png">label</a>'));
});

test('radio targets link every other mention, but not inside links', () => {
  const out = body('* A\n<<<Dragon>>> here, a dragon there, [[https://x.org][dragon]] linked.');
  assert.match(out, /<a id="org-target-dragon">Dragon<\/a> here, a <a href="#org-target-dragon">dragon<\/a> there, <a href="https:\/\/x.org">dragon<\/a>/);
});

test('targets written inside =verbatim=, ~code~ or a source block are not targets, so nothing links to them', () => {
  const out = body('#+OPTIONS: broken-links:t\n* A\nSay =<<<pear>>>= and ~<<spot>>~ and a pear, then [[spot]].\n#+BEGIN_SRC org\n<<<apple>>>\n#+END_SRC\nAn apple.');
  assert.ok(!/org-target-pear|org-target-apple|org-target-spot/.test(out), out);
  assert.match(out, /<code>&lt;&lt;&lt;pear&gt;&gt;&gt;<\/code>/);
});

test('a link with no description shows what ox-html shows: the section number, "No description for this link" for a target when sections are not numbered, the table number', () => {
  const doc = '* One\n** Sub\nText <<spot>>.\n#+CAPTION: Data\n#+NAME: data\n| a |\n* Two\nSee [[*Sub]] and [[spot]] and [[data]].';
  assert.match(body(doc), /See <a href="#[^"]+">1\.1<\/a> and <a href="#[^"]+">1\.1<\/a> and <a href="#[^"]+">1<\/a>\./);
  assert.match(body('#+OPTIONS: num:nil\n' + doc), /See <a href="#[^"]+">Sub<\/a> and <a href="#[^"]+">No description for this link<\/a> and/);
});

test('the README exports to well-formed HTML: balanced containers, no leftover placeholders, every link target present', async () => {
  const fs = await import('node:fs');
  const html = exportToHtml(parseOrg(fs.readFileSync(new URL('../README.org', import.meta.url), 'utf8')));
  const count = (re) => (html.match(re) || []).length;
  assert.equal(count(/<div[\s>]/g), count(/<\/div>/g), 'div balance');
  assert.equal(count(/<ul[\s>]/g), count(/<\/ul>/g), 'ul balance');
  assert.equal(count(/<table[\s>]/g), count(/<\/table>/g), 'table balance');
  assert.ok(!/[-]/.test(html), 'no placeholder characters');
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  const missing = [...html.matchAll(/ href="#([^"]+)"/g)].map((m) => m[1]).filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], 'every #link has an element with that id');
  assert.ok(count(/<h3 id=/g) > 20 && count(/<table/g) > 10);
});
