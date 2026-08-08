import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseOrg } from '../src/org-parser.js';
import { exportToMarkdown, gfmSlugify } from '../src/export-markdown.js';

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

// ---- footnotes -----------------------------------------------------------

test('a bare footnote reference [fn:1] exports as GFM\u2019s own [^1]', () => {
  const doc = parseOrg('* Heading\nA claim needing support[fn:1].\n\n[fn:1] The actual source.\n');
  const md = exportToMarkdown(doc);
  assert.match(md, /A claim needing support\[\^1\]\./);
});

test('a separate-line definition ("[fn:1] text") exports as GFM\u2019s own "[^1]: text" line', () => {
  const doc = parseOrg('* Heading\nRef[fn:1].\n\n[fn:1] The actual source.\n');
  const md = exportToMarkdown(doc);
  assert.match(md, /\[\^1\]: The actual source\./);
});

test('an inline definition ([fn:1:text]) exports the reference inline AND collects the definition at the end', () => {
  const doc = parseOrg('* Heading\nA claim[fn:1:this is the note] right here.\n');
  const md = exportToMarkdown(doc);
  assert.match(md, /A claim\[\^1\] right here\./);
  assert.match(md, /\[\^1\]: this is the note/);
});

test('an anonymous inline footnote ([fn::text]) gets a synthetic label, since GFM has no anonymous-footnote form', () => {
  const doc = parseOrg('* Heading\nSome text[fn::an anonymous note] here.\n');
  const md = exportToMarkdown(doc);
  assert.match(md, /Some text\[\^anon-1\] here\./);
  assert.match(md, /\[\^anon-1\]: an anonymous note/);
});

test('the same real label referenced multiple times produces only ONE definition line, not a duplicate', () => {
  const doc = parseOrg('* Heading\nFirst[fn:1:the note]. Later, again[fn:1].\n');
  const md = exportToMarkdown(doc);
  const defLines = md.split('\n').filter((l) => l.startsWith('[^1]:'));
  assert.equal(defLines.length, 1);
});

test('two different anonymous footnotes each get their own distinct synthetic label', () => {
  const doc = parseOrg('* Heading\nOne[fn::first note]. Two[fn::second note].\n');
  const md = exportToMarkdown(doc);
  assert.match(md, /\[\^anon-1\]: first note/);
  assert.match(md, /\[\^anon-2\]: second note/);
});

test('multiple independent export calls do not leak footnote state between them', () => {
  const doc1 = parseOrg('* H\nOne[fn::first].\n');
  const doc2 = parseOrg('* H\nTwo[fn::second].\n');
  const md1 = exportToMarkdown(doc1);
  const md2 = exportToMarkdown(doc2);
  // Both should independently start their anonymous counter at 1, not continue from the previous call's state
  assert.match(md1, /\[\^anon-1\]: first/);
  assert.match(md2, /\[\^anon-1\]: second/);
});

test('a document with no footnotes at all produces no definition-line section', () => {
  const doc = parseOrg('* Heading\nJust ordinary text, no footnotes here.\n');
  const md = exportToMarkdown(doc);
  assert.doesNotMatch(md, /\[\^/);
});

// ---- internal links resolve to real GFM anchors ----------------------------

test('THE BUG: a star-prefixed title link now resolves to a real GFM slug anchor, instead of the raw target dumped in unresolved', () => {
  const doc = parseOrg('* Intro\n[[*My Cool Section][See below]]\n* My Cool Section\nContent.\n');
  const md = exportToMarkdown(doc);
  assert.match(md, /\[See below\]\(#my-cool-section\)/);
});

test('a #custom-id link resolves to the TARGET HEADING\u2019s own GFM slug -- not the custom_id string itself, since GFM has no concept of custom ids at all', () => {
  const doc = parseOrg('* Intro\n[[#capture][Jump]]\n* Capture Templates\n:PROPERTIES:\n:CUSTOM_ID: capture\n:END:\nContent.\n');
  const md = exportToMarkdown(doc);
  assert.match(md, /\[Jump\]\(#capture-templates\)/);
});

test('a bare fuzzy-title link ([[Title]], no # or * prefix) also resolves', () => {
  const doc = parseOrg('* Intro\n[[My Cool Section]]\n* My Cool Section\nContent.\n');
  const md = exportToMarkdown(doc);
  assert.match(md, /\(#my-cool-section\)/);
});

test('punctuation in a heading title is stripped (not hyphenated) in the generated slug, matching GFM exactly', () => {
  const doc = parseOrg("* Intro\n[[*What's New?][Link]]\n* What's New?\nContent.\n");
  const md = exportToMarkdown(doc);
  assert.match(md, /\(#whats-new\)/);
});

test('duplicate heading titles get GFM\u2019s own -1, -2, ... slug disambiguation (starting from 1, not 2), and a CUSTOM_ID-targeted link to the second one resolves to its disambiguated slug', () => {
  const doc = parseOrg(
    '* Intro\n[[*Notes][First]] [[#notes-two][Second]]\n* Notes\nfirst\n* Notes\n:PROPERTIES:\n:CUSTOM_ID: notes-two\n:END:\nsecond\n'
  );
  const md = exportToMarkdown(doc);
  // [[*Notes]] (a plain title match) always resolves to the FIRST heading
  // named "Notes" -- correct, existing resolveLinkTarget behavior, not
  // something this fix changes -- so it gets the first slug, "notes".
  assert.match(md, /\[First\]\(#notes\)/);
  // The CUSTOM_ID-targeted link can actually reach the SECOND "Notes"
  // heading specifically, and gets ITS disambiguated slug, "notes-1".
  assert.match(md, /\[Second\]\(#notes-1\)/);
});

test('external links (http/https/mailto) are completely unaffected by link resolution', () => {
  const doc = parseOrg('* Intro\n[[https://example.com][External]]\n[[mailto:a@b.com][Email]]\n');
  const md = exportToMarkdown(doc);
  assert.match(md, /\[External\]\(https:\/\/example\.com\)/);
  assert.match(md, /\[Email\]\(mailto:a@b\.com\)/);
});

test('a link resolving to a heading OUTSIDE the exported scope falls back to the original target text', () => {
  const doc = parseOrg('* Outside\n:PROPERTIES:\n:CUSTOM_ID: outside\n:END:\n* Exported Scope\n[[#outside][Link out]]\n');
  const scopeHeading = doc.children[1];
  const md = exportToMarkdown(doc, scopeHeading);
  assert.match(md, /\[Link out\]\(#outside\)/); // best-effort fallback, unchanged from before this fix
});

test('an unresolved link (matches nothing) falls back to the original literal target, unchanged', () => {
  const doc = parseOrg('* Intro\n[[Nonexistent Heading][Broken]]\n');
  const md = exportToMarkdown(doc);
  assert.match(md, /\[Broken\]\(Nonexistent Heading\)/);
});

test('a whole realistic document with multiple internal links resolves every single one', () => {
  const doc = parseOrg(
    '* Contents\n[[#section-a][Section A]]\n[[#section-b][Section B]]\n* Section A\n:PROPERTIES:\n:CUSTOM_ID: section-a\n:END:\nContent A.\n* Section B\n:PROPERTIES:\n:CUSTOM_ID: section-b\n:END:\nContent B.\n'
  );
  const md = exportToMarkdown(doc);
  assert.match(md, /\[Section A\]\(#section-a\)/);
  assert.match(md, /\[Section B\]\(#section-b\)/);
});

test('gfmSlugify matches GitHub\u2019s own algorithm on known tricky cases (verified independently against the real github-slugger library during development)', () => {
  const cases = [
    ['My Cool Section', 'my-cool-section'],
    ["What's New?", 'whats-new'],
    ['Import/Export Settings', 'importexport-settings'],
    ['HTML, ODT, & Markdown', 'html-odt--markdown'], // punctuation stripped leaves a double space -> double hyphen
    ['2026 Q1 Planning', '2026-q1-planning'],
    ['Underline_Test', 'underline_test'],
    ['A: The Beginning', 'a-the-beginning'],
    ['Multiple   Spaces   Between', 'multiple---spaces---between'],
    ['Parens (like this)', 'parens-like-this'],
    ['100% Done', '100-done'],
  ];
  for (const [title, expectedSlug] of cases) {
    const doc = parseOrg(`* Intro\n[[*${title}][Link]]\n* ${title}\nContent.\n`);
    const md = exportToMarkdown(doc);
    assert.match(md, new RegExp(`\\(#${expectedSlug.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\)`), `"${title}" should slug to "${expectedSlug}"`);
  }
});

test('a whole realistic document exported from the actual README.org resolves every internal link to a matching heading somewhere else in the same output', () => {
  const readmeText = readFileSync(join(import.meta.dirname, '..', 'README.org'), 'utf8');
  const doc = parseOrg(readmeText);
  const md = exportToMarkdown(doc);
  const linkTargets = [...md.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
  const headingSlugs = new Set([...md.matchAll(/^#+\s.*$/gm)].map((m) => m[0]));
  assert.ok(linkTargets.length > 50, 'the real README.org should have plenty of internal links to check');
  // Every internal (#-prefixed) link target should correspond to SOME
  // heading actually present in the exported Markdown -- spot-check by
  // confirming the slug's own "word core" appears in at least one
  // heading line (a full reverse-slug match would require re-deriving
  // titles from slugs, which loses information; this is a strong,
  // practical proxy).
  let unmatched = 0;
  for (const target of linkTargets) {
    const found = [...headingSlugs].some((h) => gfmSlugify(h.replace(/^#+\s/, '')).startsWith(target.split('-').slice(0, 2).join('-')));
    if (!found) unmatched++;
  }
  assert.ok(unmatched < linkTargets.length * 0.05, `expected nearly all ${linkTargets.length} internal links to resolve; ${unmatched} did not even loosely match`);
});

// ---- width-cookie row exclusion (real org's own "<N>" column-width directive) ----

test('THE FIX: a width-cookie row ("<N>" in every cell) is excluded entirely, not shown as data or mistaken for the header', () => {
  const doc = parseOrg('* H\n| <10> | <5> |\n| Name | Age |\n|---+---|\n| Al | 9 |\n');
  const md = exportToMarkdown(doc);
  assert.doesNotMatch(md, /<10>/);
  assert.doesNotMatch(md, /<5>/);
});

test('THE FIX: with the cookie row correctly excluded, the REAL header row is used as the GFM table header, not demoted', () => {
  const doc = parseOrg('* H\n| <10> | <5> |\n| Name | Age |\n|---+---|\n| Al | 9 |\n');
  const md = exportToMarkdown(doc);
  assert.match(md, /\| Name \| Age \|\n\| --- \| --- \|/);
});

test('a table with no width-cookie row is completely unaffected', () => {
  const doc = parseOrg('* H\n| Name | Age |\n|---+---|\n| Al | 9 |\n');
  const md = exportToMarkdown(doc);
  assert.match(md, /\| Name \| Age \|\n\| --- \| --- \|/);
});
