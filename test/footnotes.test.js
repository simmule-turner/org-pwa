import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeFootnotes, insertFootnote, canInsertFootnoteAt, uniqueFootnoteLabel, footnoteLabels } from '../src/footnotes.js';

// Expected results come from Emacs 29.3 itself (org-footnote-normalize, and org-footnote-new with the label typed).
const cases = JSON.parse(readFileSync(new URL('./fixtures/footnotes/cases.json', import.meta.url), 'utf8'));

for (const c of cases) {
  if (c.kind === 'normalize') {
    test(`footnotes: normalize ${c.name} matches Emacs`, () => {
      assert.equal(normalizeFootnotes(c.input, { section: c.section }), c.expected);
    });
  } else {
    test(`footnotes: new ${c.name} matches Emacs`, () => {
      const r = insertFootnote(c.input, c.pos, c.label);
      if (c.expected === null) assert.equal(r, null);
      else assert.equal(r && r.text, c.expected);
    });
  }
}

test('footnotes: the next unused number is proposed, counting definitions and references', () => {
  assert.equal(uniqueFootnoteLabel('a[fn:1] b[fn:2]\n\n[fn:3] c\n'), '4');
  assert.equal(uniqueFootnoteLabel('nothing'), '1');
  assert.deepEqual(footnoteLabels('a[fn:x] b[fn::anon]\n\n[fn:y] def').sort(), ['x', 'y']);
});

test('footnotes: no footnote at the start of a line, inside a source block, or inside a reference', () => {
  assert.equal(canInsertFootnoteAt('word\n', 0), false);
  assert.equal(canInsertFootnoteAt('#+begin_src sh\necho hi\n#+end_src\n', 20), false);
  assert.equal(canInsertFootnoteAt('see[fn:1] this', 6), false);
  assert.equal(canInsertFootnoteAt('see this', 4), true);
});

test('footnotes: a second reference to an existing label adds no definition', () => {
  const text = 'a[fn:1] b\n\n[fn:1] def\n';
  const r = insertFootnote(text, 9, '1');
  assert.equal(r && r.text, 'a[fn:1] b[fn:1]\n\n[fn:1] def\n');
  assert.equal(r && r.existing, true);
});

test('footnotes: an anonymous or inline footnote is written in place', () => {
  assert.equal(insertFootnote('some text', 4, null)?.text, 'some[fn::] text');
  assert.equal(insertFootnote('some text', 4, 'n', { defineInline: true })?.text, 'some[fn:n:] text');
});
