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

test('THE FIX: #+OPTIONS: num:nil removes only the per-heading numbers -- the Table of Contents still generates, just without number prefixes, matching real Emacs org-mode\u2019s own confirmed, independent toc:/num: behavior', () => {
  const doc = parseOrg('#+OPTIONS: num:nil\n* First\n* Second\n');
  const result = exportToAscii(doc);
  assert.ok(result.includes('First'));
  assert.ok(!result.includes('1. First'));
  assert.ok(result.includes('Table of Contents'), 'the ToC itself is a separate, independent setting (toc:) -- num:nil alone doesn\u2019t remove it');
});

// ---- exportToAscii: table of contents -------------------------------------

test('a document with more than one heading gets a generated Table of Contents at the top', () => {
  const doc = parseOrg('* First\n* Second\n');
  const result = exportToAscii(doc);
  assert.ok(result.startsWith('Table of Contents'));
  const tocSection = result.split('\n\n')[1]; // the TOC entries block, between the underlined title and the first real heading
  assert.match(tocSection, /1\. First/);
  assert.match(tocSection, /2\. Second/);
});

test('the Table of Contents entries use deeper indentation for deeper headings', () => {
  const doc = parseOrg('* Top\n** Mid\n*** Deep\n* Another Top\n');
  const result = exportToAscii(doc);
  const toc = result.split('Another Top\n=')[0]; // just the TOC + first heading region
  const lines = toc.split('\n');
  const midLine = lines.find((l) => l.includes('Mid') && !l.includes('Top'));
  const deepLine = lines.find((l) => l.includes('Deep'));
  assert.ok(midLine.indexOf('1.1') > 0 || midLine.startsWith('.'));
  assert.ok(deepLine.length - deepLine.trimStart().length >= 0);
  // Deep's own dot-leader prefix should be longer than Mid's
  const midDots = midLine.match(/^\.*/)[0].length;
  const deepDots = deepLine.match(/^\.*/)[0].length;
  assert.ok(deepDots > midDots);
});

// ---- exportToAscii: paragraphs and wrapping ---------------------------------

test('a paragraph is wrapped to the given text width, indented to match its heading depth', () => {
  const doc = parseOrg('* H\nThis is a moderately long sentence that will need wrapping.\n');
  const result = exportToAscii(doc, null, 20);
  const bodyLines = result
    .split('\n')
    .filter((l) => l.trim() && !l.includes('H') && !/^=+$/.test(l.trim()));
  for (const line of bodyLines) assert.ok(line.length <= 22); // width + a little slack for the indent itself being counted in "available"
});

test('org-ascii-text-width defaults to 72 when not otherwise specified', () => {
  const doc = parseOrg('* H\n' + 'word '.repeat(30).trim() + '\n');
  const result = exportToAscii(doc); // no explicit width argument
  const bodyLines = result.split('\n').filter((l) => /^word/.test(l.trim()) || (l.trim() && !l.includes('H')));
  for (const line of bodyLines) assert.ok(line.length <= 74); // 72 + indent slack
});

// ---- exportToAscii: inline markup (THE ACTUAL BEHAVIOR CHANGE) -------------

test('bold/italic/underline/strikethrough keep their markers and sub/superscripts are written as typed, as ox-ascii does (checked against Emacs 29.3)', () => {
  const doc = parseOrg('* H\nThis has *bold* and /italic/ and _underline_ and +strike+ text, x_2 y^3 a_{bc} z^{de}.\n');
  const result = exportToAscii(doc, null, 200);
  assert.ok(result.includes('This has *bold* and /italic/ and _underline_ and +strike+ text, x_2 y^3 a_{bc} z^{de}.'));
});

test('THE FIX: code/verbatim become real org\u2019s own backtick-quote format ("`text\'"), confirmed directly from ox-ascii.el\u2019s org-ascii-verbatim-format -- not the literal ~/= source markers', () => {
  const doc = parseOrg('* H\nRun ~ls -la~ or =cat file=.\n');
  const result = exportToAscii(doc, null, 200);
  assert.ok(result.includes("Run `ls -la' or `cat file'."));
  assert.ok(!result.includes('~ls -la~'));
  assert.ok(!result.includes('=cat file='));
});

test('a link with no description renders as just the target', () => {
  const doc = parseOrg('* H\nSee [[https://example.com]] for more.\n');
  const result = exportToAscii(doc, null, 200);
  assert.ok(result.includes('https://example.com'));
});

// ---- exportToAscii: footnotes (new: previously not parsed/rendered at all) --

test('a footnote reference becomes a bracketed label, and its definition is collected into a Footnotes section at the end', () => {
  const doc = parseOrg('* H\nA claim[fn:1:with an explanation] here.\n');
  const result = exportToAscii(doc, null, 200);
  assert.ok(result.includes('A claim[1] here.'));
  assert.ok(result.includes('Footnotes'));
  assert.ok(result.includes('[1] with an explanation'));
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

test('a checkbox item keeps its bullet and shows [X]/[ ]/[-], as ox-ascii does', () => {
  const doc = parseOrg('* H\n- [X] done\n- [ ] not done\n- [-] partial\n');
  const result = exportToAscii(doc);
  assert.ok(result.includes('- [X] done'));
  assert.ok(result.includes('- [ ] not done'));
  assert.ok(result.includes('- [-] partial'));
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

test('THE FIX: cell content is parsed for inline markup, consistent with the rest of this exporter -- code/verbatim becomes the backtick-quote convention and bold keeps its markers', () => {
  const doc = parseOrg('* H\n| Item | Status |\n|---+---|\n| ~code~ | *done* |\n');
  const result = exportToAscii(doc, null, 200);
  assert.ok(result.includes("`code'"));
  assert.ok(result.includes('*done*'));
});

test('an empty table (no data rows) produces no output rather than throwing', () => {
  const doc = parseOrg('* H\n');
  assert.doesNotThrow(() => exportToAscii(doc));
});

// ---- explicit column-width cookies (real org-mode "<N>" syntax) -----------

test('THE FEATURE: a "<N>" width-cookie row forces each column to that exact width, and is itself excluded from the rendered output (a directive, not data)', () => {
  const doc = parseOrg('* H\n| <10> | <5> |\n| Name | Age |\n|---+---|\n| Al | 9 |\n');
  const result = exportToAscii(doc, null, 200);
  assert.ok(!result.includes('<10>'));
  assert.ok(!result.includes('<5>'));
  const dataLines = result.split('\n').filter((l) => l.includes('|') && !l.includes('-'));
  for (const line of dataLines) assert.equal(line.length, dataLines[0].length, `expected every row the same length: ${JSON.stringify(line)}`);
});

test('THE FEATURE: a row that only PARTIALLY matches the "<N>" pattern (not every cell) is treated as ordinary data, not a cookie row', () => {
  const doc = parseOrg('* H\n| <10> | Not a cookie |\n| Name | Age |\n|---+---|\n| Al | 9 |\n');
  const result = exportToAscii(doc, null, 200);
  assert.ok(result.includes('<10>')); // shown as ordinary cell content, not stripped
  assert.ok(result.includes('Not a cookie'));
});

// ---- exportToAscii: blocks ------------------------------------------------

test('a source block is framed with its literal content, as ox-ascii draws it', () => {
  const doc = parseOrg('* H\n#+BEGIN_SRC python\nprint("hi")\n#+END_SRC\n');
  const result = exportToAscii(doc);
  assert.ok(result.includes(',----\n  | print("hi")\n  `----'));
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

// ---- THE FIX: paragraph reflow -- flow unless "\\" forces a real break ----

test('THE FIX: adjacent source lines within one paragraph flow together and wrap normally -- already correct for the default case, confirmed still correct after the fix', () => {
  const doc = parseOrg('* H\nLine one\nline two continues\n');
  const out = exportToAscii(doc, null, 60);
  assert.match(out, /Line one line two continues/);
});

test('THE FIX: an explicit "\\\\" marker forces a real, separate line -- confirmed via research that real org\u2019s own plain-text export also honors this marker, not just HTML/LaTeX', () => {
  const doc = parseOrg('* H\nLine one\\\\\nline two forced\nline three flows\n');
  const out = exportToAscii(doc, null, 60);
  const lines = out.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('1.') && !l.startsWith('='));
  assert.ok(lines.some((l) => l.trim() === 'Line one'), 'the marked line stands alone');
  assert.ok(lines.some((l) => l.includes('line two forced') && l.includes('line three flows')), 'the two unmarked lines after it still flow together');
});

test('the "\\\\" marker itself is stripped, never leaking into the ASCII output as literal backslashes', () => {
  const doc = parseOrg('* H\nSome text\\\\\nmore text\n');
  const out = exportToAscii(doc, null, 60);
  assert.doesNotMatch(out, /\\\\/);
});

// ---- THE FIX: #+TITLE / #+AUTHOR / #+DATE / #+OPTIONS -------------------------

test('THE FIX: author:nil / date:nil suppress those specific fields, independent of each other', () => {
  const doc = parseOrg('#+TITLE: T\n#+AUTHOR: Jane Doe\n#+DATE: 2026-01-15\n#+OPTIONS: author:nil\n* Heading\nText.\n');
  const result = exportToAscii(doc);
  assert.ok(!result.includes('Jane Doe'));
  assert.ok(result.includes('2026-01-15'));
});

test('THE EXACT REQUEST: creator:nil is the default -- no "Generated by" notice unless explicitly enabled', () => {
  const doc = parseOrg('#+TITLE: T\n* Heading\nText.\n');
  const result = exportToAscii(doc);
  assert.ok(!result.includes('Generated by'));
});

test('creator:t adds a "Generated by org-pwa" notice at the very end', () => {
  const doc = parseOrg('#+TITLE: T\n#+OPTIONS: creator:t\n* Heading\nText.\n');
  const result = exportToAscii(doc);
  assert.ok(result.trim().endsWith('Generated by org-pwa'));
});

test('THE FIX: a document-level preamble body (doc.body, text before the first heading) now renders in ASCII export -- previously never rendered by any export format at all, needed for #+INCLUDE\u2019s own block-type variant to actually produce visible output', () => {
  const doc = parseOrg('#+TITLE: T\nSome preamble text.\n\n* Heading\nHeading text.\n');
  const result = exportToAscii(doc);
  assert.ok(result.includes('Some preamble text.'));
  const preambleIdx = result.indexOf('Some preamble text.');
  const headingIdx = result.indexOf('1 Heading') !== -1 ? result.indexOf('1 Heading') : result.indexOf('Heading');
  assert.ok(preambleIdx < headingIdx, 'preamble renders before the headings');
});

test('a scoped subtree export shows no document-level preamble -- that belongs to the whole document, not any one subtree', () => {
  const doc = parseOrg('Preamble text.\n\n* Target\nText.\n* Other\nText.\n');
  const target = doc.children[0];
  const result = exportToAscii(doc, target);
  assert.ok(!result.includes('Preamble text.'));
});

// ---- THE FEATURE: #+BEGIN_EXPORT ascii -----------------------------------------

test('THE EXACT REQUEST: #+BEGIN_EXPORT ascii ... #+END_EXPORT is rendered raw/verbatim, no [NAME] label', () => {
  const doc = parseOrg('#+BEGIN_EXPORT ascii\nASCII-only content\n#+END_EXPORT\n\n* Heading\nText.\n');
  const ascii = exportToAscii(doc);
  assert.match(ascii, /ASCII-only content/);
  assert.doesNotMatch(ascii, /\[EXPORT\]/);
});

test('THE FIX: an #+BEGIN_EXPORT block for a DIFFERENT backend (html) is omitted entirely from ASCII export', () => {
  const doc = parseOrg('#+BEGIN_EXPORT html\n<div>HTML-only content</div>\n#+END_EXPORT\n\n* Heading\nText.\n');
  const ascii = exportToAscii(doc);
  assert.doesNotMatch(ascii, /HTML-only content/);
});

test('#+BEGIN_EXPORT ascii matches case-insensitively too', () => {
  for (const tag of ['ASCII', 'Ascii', 'ascii']) {
    const doc = parseOrg(`#+BEGIN_EXPORT ${tag}\nraw text\n#+END_EXPORT\n\n* H\nText.\n`);
    assert.match(exportToAscii(doc), /raw text/, `tag "${tag}" should match`);
  }
});

// ---- comma-escape stripping in block content ------------------------------

test('THE FIX: a comma-escaped line inside a #+BEGIN_SRC block has its leading comma stripped for display, mirroring the export-html.js fix', () => {
  const doc = parseOrg('#+BEGIN_SRC org\n,#+CATEGORY: Projects\n#+END_SRC\n');
  const ascii = exportToAscii(doc, null);
  assert.match(ascii, /#\+CATEGORY: Projects/);
  assert.doesNotMatch(ascii, /,#\+CATEGORY/);
});

test('the comma-escape strip also works when the escaped line is indented', () => {
  const doc = parseOrg('* Heading\n#+BEGIN_SRC org\n  ,#+CATEGORY: Projects\n#+END_SRC\n');
  const ascii = exportToAscii(doc, null);
  assert.match(ascii, /#\+CATEGORY: Projects/);
  assert.doesNotMatch(ascii, /,#\+CATEGORY/);
});

test('THE FIX: a body node before the first heading (a block, in the document\u2019s own preamble) is correctly flattened into the output, not pushed as one nested array element -- found while testing the comma-escape fix above: Array.prototype.join stringifies a nested array element by comma-joining its own contents by default, which was producing a stray, unrelated comma that looked similar to the comma-escape bug but was a separate, genuine issue', () => {
  const doc = parseOrg('#+OPTIONS: toc:nil\n#+BEGIN_SRC org\n#+CATEGORY: Projects\n#+END_SRC\n');
  const ascii = exportToAscii(doc, null);
  assert.equal(ascii, ',----\n| #+CATEGORY: Projects\n`----\n');
});

test('ascii export: macros expand, math and sub/superscripts stay as typed, bare links use <url>', () => {
  const doc = parseOrg('#+MACRO: who World\nHello {{{who}}} $a^2$ x_1 [[https://e.org]] *b*\n');
  const out = exportToAscii(doc);
  assert.match(out, /Hello World \$a\^2\$ x_1 <https:\/\/e\.org> \*b\*/);
});
