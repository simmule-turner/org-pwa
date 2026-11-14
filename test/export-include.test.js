import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIncludeValue, applyLineRange, expandIncludes } from '../src/export-include.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

// What Emacs does with each of these is held by test/oracle-export-include.test.js; these are the unit tests of the pieces.

// ---- parseIncludeValue ------------------------------------------------------

test('a bare quoted path has nothing else', () => {
  assert.deepEqual(parseIncludeValue('"sub.org"'), { path: 'sub.org', location: null, onlyContents: false, lines: null, literal: false, args: null, minlevel: undefined, block: null });
});

test('an unquoted path is read to the next blank', () => {
  assert.equal(parseIncludeValue('sub.org :minlevel 2').path, 'sub.org');
  assert.equal(parseIncludeValue('').path, null);
});

test('src, example and export are literal; the rest of the line after src or export is the arguments', () => {
  assert.deepEqual(parseIncludeValue('"a.py" src python -n'), { path: 'a.py', location: null, onlyContents: false, lines: null, literal: true, args: 'python -n', minlevel: undefined, block: 'src' });
  assert.equal(parseIncludeValue('"a" example').literal, true);
  assert.equal(parseIncludeValue('"a" export html').args, 'html');
  assert.equal(parseIncludeValue('"a" EXAMPLE').block, 'EXAMPLE', 'the block keeps the case it was written in');
});

test('any other word makes a block of that name, and an Org include has none', () => {
  assert.equal(parseIncludeValue('"a" quote').block, 'quote');
  assert.equal(parseIncludeValue('"a" quote').literal, false);
  assert.equal(parseIncludeValue('"a.org" :minlevel 3').block, null);
});

test(':lines, :minlevel and :only-contents (which wants a value) are read in any order', () => {
  const d = parseIncludeValue('"a.org::*Heading" :only-contents t :lines "2-4" :minlevel 3');
  assert.equal(d.location, '*Heading');
  assert.equal(d.onlyContents, true);
  assert.equal(d.lines, '2-4');
  assert.equal(d.minlevel, 3);
  assert.equal(parseIncludeValue('"a.org" :only-contents').onlyContents, false);
  assert.equal(parseIncludeValue('"a.org" :only-contents nil').onlyContents, false);
});

test('a :minlevel with a block type is not read', () => {
  assert.equal(parseIncludeValue('"a" src c :minlevel 3').minlevel, undefined);
});

// ---- applyLineRange ----------------------------------------------------------

test('"N-M" is lines N up to, not counting, M; "-M" from the start; "N-" to the end; "-" all', () => {
  const l = ['1', '2', '3', '4', '5'];
  assert.deepEqual(applyLineRange(l, '2-4'), ['2', '3']);
  assert.deepEqual(applyLineRange(l, '-3'), ['1', '2']);
  assert.deepEqual(applyLineRange(l, '4-'), ['4', '5']);
  assert.deepEqual(applyLineRange(l, '-'), l);
  assert.deepEqual(applyLineRange(l, null), l);
  assert.deepEqual(applyLineRange(l, '3-4'), ['3']);
  assert.deepEqual(applyLineRange(l, '4-99'), ['4', '5']);
});

// ---- expandIncludes ---------------------------------------------------------

function mkFetcher(files) {
  return async (path) => (files[path] !== undefined ? { content: files[path] } : null);
}
const expandText = async (text, files, options) => serializeOrg(await expandIncludes(parseOrg(text), mkFetcher(files), parseOrg, options));

test('the included Org text goes where the keyword was, with its own keywords and its text before the first heading', async () => {
  const out = await expandText('#+TITLE: Main\n#+INCLUDE: "sub.org"\n\n* Main Heading\nMain text.\n', { 'sub.org': '#+TITLE: Sub\n#+MACRO: m v\nIntro.\n* Sub One\nText.\n** Deep\n' });
  assert.equal(out, '#+TITLE: Main\n#+TITLE: Sub\n#+MACRO: m v\nIntro.\n* Sub One\nText.\n** Deep\n\n* Main Heading\nMain text.\n');
});

test('the result is a parsed document whose headings and keywords are those of the expanded text', async () => {
  const doc = await expandIncludes(parseOrg('#+INCLUDE: "sub.org"\n\n* Main\n'), mkFetcher({ 'sub.org': '#+MACRO: m v\n* A\n** B\n' }), parseOrg);
  assert.deepEqual(doc.children.map((h) => h.title), ['A', 'Main']);
  assert.equal(doc.children[0].children[0].title, 'B');
  assert.ok(doc.keywords.some((k) => k.key === 'MACRO'));
});

test(':minlevel moves the headings so that the shallowest has that level', async () => {
  assert.equal(await expandText('#+INCLUDE: "sub.org" :minlevel 3\n', { 'sub.org': '* One\nText.\n** Two\n' }), '*** One\nText.\n**** Two\n');
  assert.equal(await expandText('#+INCLUDE: "sub.org" :minlevel 1\n', { 'sub.org': '*** One\n**** Two\n' }), '* One\n** Two\n');
});

test('without :minlevel the shallowest heading is one deeper than the heading the keyword is under (1 before the first)', async () => {
  assert.equal(await expandText('#+INCLUDE: "sub.org"\n', { 'sub.org': '** One\n*** Two\n' }), '* One\n** Two\n');
  assert.equal(await expandText('* A\n** B\n#+INCLUDE: "sub.org"\n', { 'sub.org': '* One\n** Two\n' }), '* A\n** B\n*** One\n**** Two\n');
});

test('the text after an include in a heading follows the included text', async () => {
  assert.equal(await expandText('* Main\nBefore.\n#+INCLUDE: "sub.org"\nAfter.\n', { 'sub.org': '* Sub\nSub text.\n' }), '* Main\nBefore.\n** Sub\nSub text.\nAfter.\n');
});

test(':lines keeps the lines before it is parsed', async () => {
  assert.equal(await expandText('#+INCLUDE: "sub.org" :lines "1-3"\n', { 'sub.org': '* First\nText1\n* Second\nText2\n' }), '* First\nText1\n');
});

test('a block include puts the text in a block named as written, escaping lines Org would read', async () => {
  const files = { 'code.py': 'print("hi")\n* star\n#+x\n' };
  assert.equal(await expandText('#+INCLUDE: "code.py" src python\n', files), '#+BEGIN_src python\nprint("hi")\n,* star\n,#+x\n#+END_src\n');
  assert.equal(await expandText('#+INCLUDE: "code.py" EXAMPLE\n', files), '#+BEGIN_EXAMPLE\nprint("hi")\n,* star\n,#+x\n#+END_EXAMPLE\n');
  assert.equal(await expandText('  #+INCLUDE: "code.py" quote\n', { 'code.py': 'q\n' }), '  #+BEGIN_quote\nq\n  #+END_quote\n');
});

test('::*Heading, ::#custom-id, ::name and ::/regexp/ include that part of the file, and :only-contents t what is inside it', async () => {
  const file = '* One\nfirst\n* Two\n:PROPERTIES:\n:CUSTOM_ID: two\n:END:\n2a\n2b\n** Sub\n* Three\n#+NAME: tbl\n| 1 |\n\nafter\n';
  assert.equal(await expandText('#+INCLUDE: "f.org::*Two"\n', { 'f.org': file }), '* Two\n:PROPERTIES:\n:CUSTOM_ID: two\n:END:\n2a\n2b\n** Sub\n');
  assert.equal(await expandText('#+INCLUDE: "f.org::#two" :only-contents t\n', { 'f.org': file }), '2a\n2b\n* Sub\n');
  assert.equal(await expandText('#+INCLUDE: "f.org::tbl" :only-contents t\n', { 'f.org': file }), '| 1 |\n');
  assert.equal(await expandText('#+INCLUDE: "f.org::/first/"\n', { 'f.org': file }), 'first\n');
});

test('a path in an included file is relative to that file', async () => {
  assert.equal(await expandText('#+INCLUDE: "dir/a.org"\n', { 'dir/a.org': '#+INCLUDE: "b.org"\n', 'dir/b.org': 'in b\n' }), 'in b\n');
});

test('an include that includes itself, a commented heading and a block of code are left alone', async () => {
  assert.equal(await expandText('#+INCLUDE: "a.org"\n', { 'a.org': 'x\n#+INCLUDE: "a.org"\n' }), 'x\n');
  assert.equal(await expandText('* COMMENT c\n#+INCLUDE: "a.org"\n', { 'a.org': 'x\n' }), '* COMMENT c\n#+INCLUDE: "a.org"\n');
  assert.equal(await expandText('#+BEGIN_SRC org\n#+INCLUDE: "a.org"\n#+END_SRC\n', { 'a.org': 'x\n' }), '#+BEGIN_SRC org\n#+INCLUDE: "a.org"\n#+END_SRC\n');
});

test('multiple #+INCLUDE lines all expand, in their own source order', async () => {
  const doc = await expandIncludes(parseOrg('#+INCLUDE: "a.org"\n#+INCLUDE: "b.org"\n\n* Main\nMain text.\n'), mkFetcher({ 'a.org': '* A\nText A.\n', 'b.org': '* B\nText B.\n' }), parseOrg);
  assert.deepEqual(doc.children.map((h) => h.title), ['A', 'B', 'Main']);
});

test('a missing file, a failing search and a fetcher that throws are skipped, and the rest is exported', async () => {
  assert.equal(await expandText('#+INCLUDE: "none.org"\n\n* Main\n', {}), '\n* Main\n');
  assert.equal(await expandText('#+INCLUDE: "a.org::*nothing"\n* Main\n', { 'a.org': '* A\n' }), '* Main\n');
  const throwing = async () => {
    throw new Error('network error');
  };
  const doc = await expandIncludes(parseOrg('#+INCLUDE: "broken.org"\n\n* Main\nText.\n'), throwing, parseOrg);
  assert.deepEqual(doc.children.map((h) => h.title), ['Main']);
});

test('a document with no #+INCLUDE returns the same object, and one with includes is never changed', async () => {
  const plain = parseOrg('* A\n** B\n*** C\nText.\n');
  assert.equal(await expandIncludes(plain, mkFetcher({}), parseOrg), plain);
  const doc = parseOrg('#+INCLUDE: "sub.org"\n\n* Main\nText.\n');
  const before = serializeOrg(doc);
  await expandIncludes(doc, mkFetcher({ 'sub.org': '* Sub\n' }), parseOrg);
  assert.equal(serializeOrg(doc), before);
});

// ---- the total of all included files --------------------------------------------

test('many includes past the total limit are left out, and the first skip is reported once', async () => {
  const doc = parseOrg('#+INCLUDE: "a.org"\n#+INCLUDE: "a.org"\n#+INCLUDE: "a.org"\n\n* Mine\n');
  const notes = [];
  const fetchPath = async () => ({ content: '* Part\n' + 'x'.repeat(100) + '\n' });
  const out = await expandIncludes(doc, fetchPath, parseOrg, { maxTotalBytes: 250, onSkip: (m) => notes.push(m) });
  assert.equal(out.children.filter((h) => h.title === 'Part').length, 2, 'two fit in 250 bytes, the third does not');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /past 250 bytes in all/);
});

test('a total limit of 0 means no limit', async () => {
  const doc = parseOrg('#+INCLUDE: "a.org"\n#+INCLUDE: "a.org"\n\n* Mine\n');
  const fetchPath = async () => ({ content: '* Part\n' + 'x'.repeat(100) + '\n' });
  const out = await expandIncludes(doc, fetchPath, parseOrg, { maxTotalBytes: 0 });
  assert.equal(out.children.filter((h) => h.title === 'Part').length, 2);
});

test('by default the total is the Org file limit, so a few small includes are unaffected', async () => {
  const doc = parseOrg('#+INCLUDE: "a.org"\n\n* Mine\n');
  const out = await expandIncludes(doc, async () => ({ content: '* Part\nsmall\n' }), parseOrg);
  assert.equal(out.children.filter((h) => h.title === 'Part').length, 1);
});
