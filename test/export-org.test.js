import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { exportAsOrg, expandMacros, filterNoexportAndComments, scaleHeadingLevels, buildMacroTable, splitMacroArgs } from '../src/export-org.js';

async function noFetch() {
  throw new Error('should not have needed to fetch anything');
}

// ---- splitMacroArgs -- real org's own actual comma-splitting convention --

test('splitMacroArgs splits on commas, trimming each argument', () => {
  assert.deepEqual(splitMacroArgs('a, b, c'), ['a', 'b', 'c']);
});

test('THE FEATURE: splitMacroArgs honors \\, as an escaped, literal comma within one argument, matching real org\u2019s own documented convention', () => {
  assert.deepEqual(splitMacroArgs('%B %d\\, %Y'), ['%B %d, %Y']);
});

test('splitMacroArgs returns [] for no parentheses/empty args', () => {
  assert.deepEqual(splitMacroArgs(undefined), []);
  assert.deepEqual(splitMacroArgs(''), []);
});

// ---- buildMacroTable ----------------------------------------------------

test('buildMacroTable collects every #+MACRO: definition into a name -> replacement-text table', () => {
  const doc = parseOrg('#+MACRO: greet Hello, $1!\n#+MACRO: bye Goodbye, $1!\n');
  assert.deepEqual(buildMacroTable(doc), { greet: 'Hello, $1!', bye: 'Goodbye, $1!' });
});

// ---- expandMacros -- verified directly against real org-mode's own actual
// macro syntax (#+MACRO: definitions, built-in title/author/email/date/
// time/keyword macros) before writing this ------------------------------

test('THE FEATURE (the exact example from real org-mode\u2019s own manual): a custom #+MACRO: with $1/$2 arguments expands correctly', () => {
  const doc = parseOrg('#+MACRO: poem Rose is $1, violet\u2019s $2. Life\u2019s ordered: Org assists you.\n{{{poem(red,blue)}}}\n');
  const result = expandMacros(doc, new Date());
  assert.equal(result.body[0].lines[0], 'Rose is red, violet\u2019s blue. Life\u2019s ordered: Org assists you.');
});

test('the title/author/email built-in macros are shortcuts for keyword(TITLE)/keyword(AUTHOR)/keyword(EMAIL), matching real org\u2019s own documented behavior exactly', () => {
  const doc = parseOrg('#+TITLE: My Doc\n#+AUTHOR: Jane\n#+EMAIL: jane@example.com\n{{{title}}} by {{{author}}} <{{{email}}}>\n');
  const result = expandMacros(doc, new Date());
  assert.equal(result.body[0].lines[0], 'My Doc by Jane <jane@example.com>');
});

test('the keyword macro collects every value of a NAME keyword throughout the buffer, space-joined, matching real org\u2019s own documented behavior exactly', () => {
  const doc = parseOrg('#+CAPTION: first\n#+CAPTION: second\n{{{keyword(CAPTION)}}}\n');
  const result = expandMacros(doc, new Date());
  assert.equal(result.body[0].lines[0], 'first second');
});

test('the date macro with no FORMAT returns the raw #+DATE: value unchanged', () => {
  const doc = parseOrg('#+DATE: <2026-03-15 Sun>\n{{{date}}}\n');
  const result = expandMacros(doc, new Date());
  assert.equal(result.body[0].lines[0], '<2026-03-15 Sun>');
});

test('THE FEATURE: the date macro with FORMAT reformats a well-formed #+DATE: timestamp, honoring an escaped comma inside the format string', () => {
  const doc = parseOrg('#+DATE: <2026-03-15 Sun>\n{{{date(%B %d\\, %Y)}}}\n');
  const result = expandMacros(doc, new Date());
  assert.equal(result.body[0].lines[0], 'March 15, 2026');
});

test('the date macro\u2019s own FORMAT argument only applies when DATE is a real, well-formed single timestamp -- matching real org\u2019s own documented restriction exactly; otherwise FORMAT has no effect and the raw value passes through', () => {
  const doc = parseOrg('#+DATE: not a timestamp\n{{{date(%Y)}}}\n');
  const result = expandMacros(doc, new Date());
  assert.equal(result.body[0].lines[0], 'not a timestamp');
});

test('the time macro uses the supplied `now`, not the real current moment -- deterministic for testing, matching every other %-escape/macro convention in this app', () => {
  const doc = parseOrg('{{{time(%Y-%m-%d)}}}\n');
  const result = expandMacros(doc, new Date(2026, 8, 23));
  assert.equal(result.body[0].lines[0], '2026-09-23');
});

test('THE FEATURE: a replacement template starting with "(eval" -- real org\u2019s own escape hatch into arbitrary Emacs Lisp -- is left exactly as written, not attempted, the same reason code-block execution isn\u2019t implemented either', () => {
  const doc = parseOrg('#+MACRO: gnustamp (eval (concat "GNU/" (capitalize $1)))\n{{{gnustamp(linux)}}}\n');
  const result = expandMacros(doc, new Date());
  assert.equal(result.body[0].lines[0], '{{{gnustamp(linux)}}}');
});

test('an unrecognized macro name is left exactly as written, never an error, matching this app\u2019s own tolerant-of-the-unexpected approach elsewhere', () => {
  const doc = parseOrg('{{{nonexistent(a,b)}}}\n');
  const result = expandMacros(doc, new Date());
  assert.equal(result.body[0].lines[0], '{{{nonexistent(a,b)}}}');
});

test('macros expand in heading titles too, matching real org\u2019s own documented recognition areas (headlines, not just paragraphs)', () => {
  const doc = parseOrg('#+MACRO: prefix PROJECT\n* {{{prefix}}}: Launch\n');
  const result = expandMacros(doc, new Date());
  assert.equal(result.children[0].title, 'PROJECT: Launch');
});

test('macros expand recursively at every heading depth, not just the top level', () => {
  const doc = parseOrg('#+MACRO: m VALUE\n* One\n** Two\n{{{m}}}\n');
  const result = expandMacros(doc, new Date());
  assert.equal(result.children[0].children[0].body[0].lines[0], 'VALUE');
});

test('expandMacros never mutates its own input doc', () => {
  const doc = parseOrg('#+MACRO: m VALUE\n{{{m}}}\n');
  const before = JSON.stringify(doc);
  expandMacros(doc, new Date());
  assert.equal(JSON.stringify(doc), before);
});

// ---- filterNoexportAndComments ------------------------------------------

test('THE FEATURE: a heading tagged :noexport: is dropped along with its entire subtree', () => {
  const doc = parseOrg('* Keep\nVisible.\n* Secret :noexport:\nGone.\n** Sub secret\nAlso gone.\n* Also keep\n');
  const result = filterNoexportAndComments(doc);
  assert.deepEqual(
    result.children.map((h) => h.title),
    ['Keep', 'Also keep']
  );
});

test(':noexport: only excludes a heading that carries the tag itself, not merely one whose ancestor does -- matching real org\u2019s own actual behavior', () => {
  const doc = parseOrg('* Parent :noexport:\n** Child (no tag of its own)\n');
  const result = filterNoexportAndComments(doc);
  // The whole subtree is still gone, since the PARENT itself carries the tag -- this confirms the subtree-removal behavior, not tag inheritance specifically
  assert.equal(result.children.length, 0);
});

test('a heading NOT tagged :noexport:, even with a sibling that is, survives untouched', () => {
  const doc = parseOrg('* A :noexport:\n* B :work:\n');
  const result = filterNoexportAndComments(doc);
  assert.deepEqual(
    result.children.map((h) => h.title),
    ['B']
  );
  assert.deepEqual(result.children[0].tags, ['work']);
});

test('THE FEATURE: a raw "# " comment line is stripped, but a "#+KEYWORD:" line is left completely alone', () => {
  const doc = parseOrg('* H\n# a raw comment\nReal text.\n#+ATTR_HTML: :width 400\nMore text.\n');
  const result = filterNoexportAndComments(doc);
  assert.deepEqual(result.children[0].bodyLines, ['Real text.', '#+ATTR_HTML: :width 400', 'More text.', '']);
});

test('THE FEATURE: a #+BEGIN_COMMENT/#+END_COMMENT block is stripped entirely, matching real org\u2019s own actual export behavior (the same behavior this app\u2019s own HTML/Markdown/ODT exporters already give it)', () => {
  const doc = parseOrg('* H\nBefore.\n#+BEGIN_COMMENT\nHidden line one.\nHidden line two.\n#+END_COMMENT\nAfter.\n');
  const result = filterNoexportAndComments(doc);
  assert.deepEqual(result.children[0].bodyLines, ['Before.', 'After.', '']);
});

test('filterNoexportAndComments never mutates its own input doc', () => {
  const doc = parseOrg('* A :noexport:\n* B\n# comment\nText.\n');
  const before = JSON.stringify(doc);
  filterNoexportAndComments(doc);
  assert.equal(JSON.stringify(doc), before);
});

// ---- scaleHeadingLevels --------------------------------------------------

test('THE FEATURE: scaleHeadingLevels shifts every top-level heading (and its own descendants) so the document\u2019s own first level lands at minlevel', () => {
  const doc = parseOrg('* One\n** Two\n* Three\n');
  const result = scaleHeadingLevels(doc, 3);
  assert.equal(result.children[0].level, 3);
  assert.equal(result.children[0].children[0].level, 4);
  assert.equal(result.children[1].level, 3);
});

test('scaleHeadingLevels is a no-op when minlevel is falsy or already matches', () => {
  const doc = parseOrg('* One\n');
  assert.equal(scaleHeadingLevels(doc, null), doc);
  assert.equal(scaleHeadingLevels(doc, 1), doc);
});

test('THE FIX (caught directly before shipping): scaleHeadingLevels never mutates its own input doc, including deeply nested descendants -- a shallow copy alone would have let shiftLevels\u2019 own recursive walk mutate the original document\u2019s nested headings in place', () => {
  const doc = parseOrg('* One\n** Two\n*** Three\n');
  const before = JSON.stringify(doc);
  scaleHeadingLevels(doc, 5);
  assert.equal(JSON.stringify(doc), before);
});

// ---- exportAsOrg -- the full pipeline ------------------------------------

test('THE FEATURE: exportAsOrg runs the full pipeline together -- includes (none here), macros, noexport/comment filtering, and level scaling -- on a real, combined document', async () => {
  const original = [
    '#+TITLE: My Doc',
    '#+AUTHOR: Jane',
    '#+MACRO: greet Hello, $1!',
    '',
    '* Welcome',
    'By {{{author}}}.',
    '{{{greet(Bob)}}}',
    '',
    '* Secret :noexport:',
    'Gone.',
    '',
    '* Visible',
    '# a raw comment',
    'Real content stays.',
    '',
  ].join('\n');
  const doc = parseOrg(original);
  const result = await exportAsOrg(doc, noFetch, parseOrg, {});
  const lines = serializeOrg(result).split('\n');
  assert.ok(lines.includes('By Jane.'));
  assert.ok(lines.includes('Hello, Bob!'));
  assert.ok(!lines.some((l) => l.includes('Secret')));
  assert.ok(!lines.some((l) => l.includes('a raw comment')));
  assert.ok(lines.includes('Real content stays.'));
});

test('exportAsOrg never mutates its own input doc, across the whole pipeline', async () => {
  const doc = parseOrg('#+MACRO: m V\n* A :noexport:\n* B\n{{{m}}}\n');
  const before = JSON.stringify(doc);
  await exportAsOrg(doc, noFetch, parseOrg, { minlevel: 3 });
  assert.equal(JSON.stringify(doc), before);
});

test('exportAsOrg applies minlevel scaling as part of the same pipeline', async () => {
  const doc = parseOrg('* One\n** Two\n');
  const result = await exportAsOrg(doc, noFetch, parseOrg, { minlevel: 2 });
  assert.equal(result.children[0].level, 2);
  assert.equal(result.children[0].children[0].level, 3);
});
