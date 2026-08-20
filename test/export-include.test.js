import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIncludeDirective, applyLineRange, expandIncludes } from '../src/export-include.js';
import { parseOrg } from '../src/org-parser.js';

// ---- parseIncludeDirective ------------------------------------------------------

test('THE EXACT REQUEST: a bare quoted path with no block-type/language/switches', () => {
  assert.deepEqual(parseIncludeDirective('"sub.org"'), { path: 'sub.org', blockType: null, language: null, lines: null, minlevel: null });
});

test('returns null for a value with no valid quoted path at all', () => {
  assert.equal(parseIncludeDirective('not-quoted'), null);
  assert.equal(parseIncludeDirective(''), null);
});

test('THE EXACT REQUEST: src block-type with a language identifier', () => {
  const parsed = parseIncludeDirective('"code.py" src python');
  assert.equal(parsed.blockType, 'src');
  assert.equal(parsed.language, 'python');
});

test('THE EXACT REQUEST: example/quote/export block-types with no language', () => {
  assert.equal(parseIncludeDirective('"f.txt" example').blockType, 'example');
  assert.equal(parseIncludeDirective('"f.txt" quote').blockType, 'quote');
  assert.equal(parseIncludeDirective('"f.txt" export').blockType, 'export');
  assert.equal(parseIncludeDirective('"f.txt" example').language, null);
});

test('a non-src block-type never picks up a language token, even if one follows', () => {
  const parsed = parseIncludeDirective('"f.txt" example python');
  assert.equal(parsed.blockType, 'example');
  assert.equal(parsed.language, null);
});

test('THE EXACT REQUEST: :lines "N-M"', () => {
  assert.equal(parseIncludeDirective('"sub.org" :lines "5-10"').lines, '5-10');
});

test('THE EXACT REQUEST: :minlevel N', () => {
  assert.equal(parseIncludeDirective('"sub.org" :minlevel 2').minlevel, 2);
});

test(':lines and :minlevel combine, in either order', () => {
  const a = parseIncludeDirective('"sub.org" :lines "5-10" :minlevel 3');
  assert.equal(a.lines, '5-10');
  assert.equal(a.minlevel, 3);
  const b = parseIncludeDirective('"sub.org" :minlevel 3 :lines "5-10"');
  assert.equal(b.lines, '5-10');
  assert.equal(b.minlevel, 3);
});

test('block-type, language, :lines, and :minlevel all combine together', () => {
  const parsed = parseIncludeDirective('"code.py" src python :lines "1-5"');
  assert.equal(parsed.blockType, 'src');
  assert.equal(parsed.language, 'python');
  assert.equal(parsed.lines, '1-5');
});

test('THE FIX: :only-contents is accepted syntactically (doesn\u2019t break parsing) but has no separate effect -- this module never merges an included file\u2019s own metadata in the first place, confirmed directly against real Emacs org-mode that this genuinely differs from a naive default-format include (which surprisingly DOES concatenate #+TITLE values together)', () => {
  const parsed = parseIncludeDirective('"sub.org" :only-contents t');
  assert.equal(parsed.path, 'sub.org');
  assert.equal(parsed.lines, null);
  assert.equal(parsed.minlevel, null);
});

// ---- applyLineRange --------------------------------------------------------

const LINES = ['L1', 'L2', 'L3', 'L4', 'L5'];

test('THE FIX: "N-M" is inclusive of its own start but EXCLUSIVE of its own end -- confirmed directly against real Emacs org-mode\u2019s own actual export output, genuinely contradicting the Org manual\u2019s own wording ("lines 5-10" sounds inclusive but isn\u2019t)', () => {
  assert.deepEqual(applyLineRange(LINES, '2-4'), ['L2', 'L3']);
});

test('THE EXACT REQUEST: "-M" means from the start up to (exclusive) line M', () => {
  assert.deepEqual(applyLineRange(LINES, '-3'), ['L1', 'L2']);
});

test('THE EXACT REQUEST: "N-" means from line N to the file\u2019s own actual end, inclusive', () => {
  assert.deepEqual(applyLineRange(LINES, '3-'), ['L3', 'L4', 'L5']);
});

test('no :lines spec at all returns every line unchanged', () => {
  assert.deepEqual(applyLineRange(LINES, null), LINES);
  assert.deepEqual(applyLineRange(LINES, ''), LINES);
});

test('a single-line range ("3-4") includes only that one line, matching the exclusive-end rule', () => {
  assert.deepEqual(applyLineRange(LINES, '3-4'), ['L3']);
});

test('an out-of-range end clamps to the file\u2019s own actual length rather than padding with undefined', () => {
  assert.deepEqual(applyLineRange(LINES, '4-99'), ['L4', 'L5']);
});

// ---- expandIncludes ---------------------------------------------------------

function mkFetcher(files) {
  return async (path) => (files[path] !== undefined ? { content: files[path] } : null);
}

test('THE EXACT REQUEST: default org format -- the included file\u2019s own headings splice in, ORDER matching real Emacs org-mode\u2019s own confirmed output (included content before the including document\u2019s own existing headings)', async () => {
  const files = { 'sub.org': '#+TITLE: Sub Document\n* Sub Heading One\nSub text one.\n** Sub Sub Heading\nDeep text.\n* Sub Heading Two\nSub text two.\n' };
  const doc = parseOrg('#+TITLE: Main Document\n#+INCLUDE: "sub.org"\n\n* Main Heading\nMain text.\n');
  const expanded = await expandIncludes(doc, mkFetcher(files), parseOrg);
  const titles = expanded.children.map((h) => h.title);
  assert.deepEqual(titles, ['Sub Heading One', 'Sub Heading Two', 'Main Heading']);
  assert.equal(expanded.children[0].children[0].title, 'Sub Sub Heading');
});

test('THE FIX: the included file\u2019s own #+TITLE is never merged into the including document\u2019s own metadata -- confirmed directly against real Emacs org-mode that a naive default-format include DOES surprisingly concatenate the two, deliberately not reproduced here', async () => {
  const files = { 'sub.org': '#+TITLE: Sub Document\n* Heading\nText.\n' };
  const doc = parseOrg('#+TITLE: Main Document\n#+INCLUDE: "sub.org"\n');
  const expanded = await expandIncludes(doc, mkFetcher(files), parseOrg);
  const titleKeywords = expanded.keywords.filter((k) => k.key === 'TITLE');
  assert.equal(titleKeywords.length, 1);
  assert.equal(titleKeywords[0].value, 'Main Document');
});

test('THE EXACT REQUEST: :minlevel shifts the included content\u2019s own top level, preserving its own internal relative depth', async () => {
  const files = { 'sub.org': '* Sub Heading One\nText.\n** Sub Sub Heading\nDeep.\n' };
  const doc = parseOrg('#+INCLUDE: "sub.org" :minlevel 3\n');
  const expanded = await expandIncludes(doc, mkFetcher(files), parseOrg);
  assert.equal(expanded.children[0].level, 3);
  assert.equal(expanded.children[0].children[0].level, 4);
});

test('THE EXACT REQUEST: :lines filters the raw text BEFORE parsing', async () => {
  const files = { 'sub.org': '* First\nText1\n* Second\nText2\n* Third\nText3\n' };
  const doc = parseOrg('#+INCLUDE: "sub.org" :lines "1-3"\n');
  const expanded = await expandIncludes(doc, mkFetcher(files), parseOrg);
  const titles = expanded.children.map((h) => h.title);
  assert.deepEqual(titles, ['First']);
});

test('THE EXACT REQUEST: a block-type include (src/example/quote/export) wraps the raw, unparsed text in the matching block and appends it to the document\u2019s own preamble body, not as a heading', async () => {
  const files = { 'code.py': 'print("hello")\n' };
  const doc = parseOrg('#+INCLUDE: "code.py" src python\n\n* Heading\nText.\n');
  const expanded = await expandIncludes(doc, mkFetcher(files), parseOrg);
  assert.equal(expanded.children.length, 1, 'the block-type include never becomes a heading');
  assert.equal(expanded.children[0].title, 'Heading');
  assert.ok(expanded.bodyLines.includes('#+BEGIN_SRC python'));
  assert.ok(expanded.bodyLines.includes('print("hello")'));
  assert.ok(expanded.bodyLines.includes('#+END_SRC'));
});

test('THE FIX: doc.body stays consistent with the newly-expanded bodyLines (not left stale) -- doc.body is already pre-populated by parseOrg\u2019s own attachBody, so this module must recompute it after appending block-type content', async () => {
  const files = { 'code.py': 'print("hi")\n' };
  const doc = parseOrg('#+INCLUDE: "code.py" example\n');
  const expanded = await expandIncludes(doc, mkFetcher(files), parseOrg);
  assert.ok(expanded.body.some((node) => node.type === 'block'), 'the block-parsed representation reflects the newly-appended lines');
});

test('multiple #+INCLUDE lines all expand, in their own source order', async () => {
  const files = { 'a.org': '* A\nText A.\n', 'b.org': '* B\nText B.\n' };
  const doc = parseOrg('#+INCLUDE: "a.org"\n#+INCLUDE: "b.org"\n\n* Main\nMain text.\n');
  const expanded = await expandIncludes(doc, mkFetcher(files), parseOrg);
  assert.deepEqual(expanded.children.map((h) => h.title), ['A', 'B', 'Main']);
});

test('THE FIX: a missing/unresolvable #+INCLUDE is skipped silently, WITHOUT failing the rest of the export', async () => {
  const doc = parseOrg('#+INCLUDE: "does-not-exist.org"\n\n* Main\nText.\n');
  const expanded = await expandIncludes(doc, mkFetcher({}), parseOrg);
  assert.deepEqual(expanded.children.map((h) => h.title), ['Main']);
});

test('a fetcher that throws is also treated as "skip this one include," not a fatal error', async () => {
  const doc = parseOrg('#+INCLUDE: "broken.org"\n\n* Main\nText.\n');
  const throwingFetcher = async () => {
    throw new Error('network error');
  };
  const expanded = await expandIncludes(doc, throwingFetcher, parseOrg);
  assert.deepEqual(expanded.children.map((h) => h.title), ['Main']);
});

test('a document with no #+INCLUDE at all returns the SAME doc object unchanged (a cheap no-op, not a wasted copy)', async () => {
  const doc = parseOrg('* Heading\nText.\n');
  const expanded = await expandIncludes(doc, mkFetcher({}), parseOrg);
  assert.equal(expanded, doc);
});

test('the original doc passed in is never mutated', async () => {
  const files = { 'sub.org': '* Sub\nText.\n' };
  const doc = parseOrg('#+INCLUDE: "sub.org"\n\n* Main\nText.\n');
  const originalChildCount = doc.children.length;
  await expandIncludes(doc, mkFetcher(files), parseOrg);
  assert.equal(doc.children.length, originalChildCount, 'the original document object is untouched');
});

// ---- THE FIX: #+INCLUDE within a heading's own body ---------------------------

test('THE EXACT REQUEST: #+INCLUDE inside a heading\u2019s own body nests the included content as CHILDREN of that heading, matching real Emacs org-mode\u2019s own confirmed behavior', async () => {
  const files = { 'sub.org': '* Sub One\nText.\n* Sub Two\nMore.\n' };
  const doc = parseOrg('* Level 1\n** Level 2\nText.\n#+INCLUDE: "sub.org"\n* Other\n');
  const expanded = await expandIncludes(doc, mkFetcher(files), parseOrg);
  const level2 = expanded.children[0].children[0];
  assert.equal(level2.title, 'Level 2');
  assert.deepEqual(level2.children.map((c) => c.title), ['Sub One', 'Sub Two']);
  assert.equal(expanded.children[1].title, 'Other', 'a sibling heading after the containing one is unaffected');
});

test('THE FIX: with no explicit :minlevel, a mid-document include defaults to ONE LEVEL DEEPER than its own containing heading -- confirmed directly against real Emacs org-mode, genuinely different from the document-level default (which keeps the sub-document\u2019s own original levels unchanged)', async () => {
  const files = { 'sub.org': '* Sub One\nText.\n** Sub Sub\nDeep.\n' };
  const doc = parseOrg('* A\n** B\n*** C\nText.\n#+INCLUDE: "sub.org"\n');
  const expanded = await expandIncludes(doc, mkFetcher(files), parseOrg);
  const c = expanded.children[0].children[0].children[0];
  assert.equal(c.level, 3);
  assert.equal(c.children[0].level, 4, 'container.level + 1, not the document-level default of "unchanged"');
  assert.equal(c.children[0].children[0].level, 5, 'the included content\u2019s own internal relative depth (Sub Sub was one deeper than Sub One) is preserved');
});

test('an explicit :minlevel still overrides the new mid-document default', async () => {
  const files = { 'sub.org': '* Sub\nText.\n' };
  const doc = parseOrg('* Level 1\nText.\n#+INCLUDE: "sub.org" :minlevel 5\n');
  const expanded = await expandIncludes(doc, mkFetcher(files), parseOrg);
  assert.equal(expanded.children[0].children[0].level, 5);
});

test('THE FIX: body text before/after the #+INCLUDE line, within the same heading, stays with that heading\u2019s own body -- a well-defined, predictable placement rather than reproducing real org\u2019s own further, incidental quirk of merging trailing text into whatever the last included element happened to be', async () => {
  const files = { 'sub.org': '* Sub\nSub text.\n' };
  const doc = parseOrg('* Main\nBefore text.\n#+INCLUDE: "sub.org"\nAfter text.\n');
  const expanded = await expandIncludes(doc, mkFetcher(files), parseOrg);
  const main = expanded.children[0];
  assert.ok(main.bodyLines.includes('Before text.'));
  assert.ok(main.bodyLines.includes('After text.'));
  assert.equal(main.children[0].title, 'Sub');
});

test('a block-type include inside a heading\u2019s own body wraps into that SAME heading\u2019s own bodyLines, not the document-level preamble', async () => {
  const files = { 'code.py': 'print("nested")\n' };
  const doc = parseOrg('* Main\nText.\n#+INCLUDE: "code.py" src python\n');
  const expanded = await expandIncludes(doc, mkFetcher(files), parseOrg);
  const main = expanded.children[0];
  assert.ok(main.bodyLines.includes('#+BEGIN_SRC python'));
  assert.ok(main.bodyLines.includes('print("nested")'));
  assert.equal(expanded.bodyLines.length, 0, 'the document-level preamble is untouched -- this include was inside a heading, not at the document root');
});

test('#+INCLUDE works at any depth, recursively -- a grandchild heading\u2019s own include still expands', async () => {
  const files = { 'sub.org': '* Deep\nText.\n' };
  const doc = parseOrg('* A\n** B\n*** C\nText.\n#+INCLUDE: "sub.org"\n');
  const expanded = await expandIncludes(doc, mkFetcher(files), parseOrg);
  const c = expanded.children[0].children[0].children[0];
  assert.equal(c.children[0].title, 'Deep');
});

test('a document with includes ONLY inside a heading (none at the document root at all) still expands correctly', async () => {
  const files = { 'sub.org': '* Sub\nText.\n' };
  const doc = parseOrg('* Main\n#+INCLUDE: "sub.org"\n');
  const expanded = await expandIncludes(doc, mkFetcher(files), parseOrg);
  assert.equal(expanded.children[0].children[0].title, 'Sub');
});

test('THE FIX: a document with genuinely no #+INCLUDE anywhere (root OR any heading, at any depth) still returns the SAME object unchanged -- the cheap no-op fast path covers the whole tree, not just the document root', async () => {
  const doc = parseOrg('* A\n** B\n*** C\nText.\n');
  const expanded = await expandIncludes(doc, mkFetcher({}), parseOrg);
  assert.equal(expanded, doc);
});
