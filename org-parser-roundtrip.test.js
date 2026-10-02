import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg, serializeHeadingSubtree, findHeadingLineNumber, findHeadingAtLine } from '../src/org-parser.js';

const roundTrip = (text) => serializeOrg(parseOrg(text));

// Shapes found in real org files (the Org project's own docs and test examples, and large personal configurations),
// each of which used to come back changed after a plain open and save with no edit.
const SHAPES = {
  'an indented properties drawer': '* Heading\n  :PROPERTIES:\n  :ID:       a9cdfeda\n  :END:\nBody\n',
  'padded property values': '* Heading\n:PROPERTIES:\n:copying:  t\n:ID:       20260424T160144.440528\n:END:\n',
  'tags aligned to a column': '* Export Setup                                                          :noexport:\n',
  'planning in the order org writes it after DONE (CLOSED first)': '* DONE Task\nCLOSED: [2025-01-06 Mon 13:50] SCHEDULED: <2025-01-05 Sun>\n',
  'planning with DEADLINE before SCHEDULED': '* TODO Task\nDEADLINE: <2026-03-07 Sat> SCHEDULED: <2026-03-01 Sun>\n',
  'an empty properties drawer': '* Heading\n:PROPERTIES:\n:END:\nBody\n',
  'a property name with a plus (append) sign': '* Heading\n:PROPERTIES:\n:header-args: :var foo=1\n:header-args+: :var bar=2\n:END:\n',
  'a property name with a colon in it': '* Heading\n:PROPERTIES:\n:header-args:emacs-lisp: :noweb-ref deps\n:header-args:emacs-lisp+: :results silent\n:END:\n',
  'a drawer holding only an append property': '* Heading\n  :PROPERTIES:\n  :header-args+: :var baz=3\n  :END:\n',
  'the same property key twice': '* Heading\n:PROPERTIES:\n:Effort: 1:00\n:Effort: 2:00\n:END:\n',
  'blank and unrecognized lines inside a drawer': '* Heading\n:PROPERTIES:\n:ID: x\n\nnot a property\n:END:\n',
  'several logbook drawers': '* Heading\n:LOGBOOK:\n- Note taken\n:END:\n:LOGBOOK:\n- Another\n:END:\nBody\n',
  'a logbook drawer before the properties drawer': '* Heading\n:LOGBOOK:\n- Note\n:END:\n:PROPERTIES:\n:ID: x\n:END:\n',
  'a drawer that is never closed': '* Heading\n:PROPERTIES:\n:ID: x\n',
  'a property with an empty value, with and without a trailing space': '* Heading\n:PROPERTIES:\n:EMPTY:\n:BLANK: \n:END:\n',
  'a property value that contains colons': '* Heading\n:PROPERTIES:\n:URL: https://example.com:8080/a:b\n:END:\n',
};
for (const [name, text] of Object.entries(SHAPES)) {
  test(`round trip is byte-identical for ${name}`, () => {
    assert.equal(roundTrip(text), text);
  });
}

test('property names are read the way org reads them: everything up to the last colon of the first token', () => {
  const h = parseOrg('* H\n:PROPERTIES:\n:header-args+: :var bar=2\n:header-args:emacs-lisp: :noweb-ref deps\n:ID:       abc\n:END:\n').children[0];
  assert.deepEqual(h.propertyOrder, ['header-args+', 'header-args:emacs-lisp', 'ID']);
  assert.equal(h.properties['header-args+'], ':var bar=2');
  assert.equal(h.properties['header-args:emacs-lisp'], ':noweb-ref deps');
  assert.equal(h.properties.ID, 'abc');
});

test('editing one property rewrites only that line; the others keep their own spacing and the drawer its indentation', () => {
  const doc = parseOrg('* H\n  :PROPERTIES:\n  :ID:       abc\n  :KEEP:     padded\n  :END:\n');
  doc.children[0].properties.ID = 'xyz';
  assert.equal(serializeOrg(doc), '* H\n  :PROPERTIES:\n  :ID: xyz\n  :KEEP:     padded\n  :END:\n');
});

test('a property added to an indented drawer is written in the drawer\u2019s indentation', () => {
  const doc = parseOrg('* H\n  :PROPERTIES:\n  :ID: abc\n  :END:\n');
  const h = doc.children[0];
  h.propertyOrder.push('NEW');
  h.properties.NEW = 'v';
  assert.equal(serializeOrg(doc), '* H\n  :PROPERTIES:\n  :ID: abc\n  :NEW: v\n  :END:\n');
});

test('removing the last property removes the drawer; removing one of several keeps the rest as they were', () => {
  const only = parseOrg('* H\n:PROPERTIES:\n:A: 1\n:END:\nBody\n');
  only.children[0].propertyOrder = [];
  only.children[0].properties = {};
  assert.equal(serializeOrg(only), '* H\nBody\n');
  const two = parseOrg('* H\n:PROPERTIES:\n:A:   1\n:B:   2\n:END:\n');
  two.children[0].propertyOrder = ['B'];
  delete two.children[0].properties.A;
  assert.equal(serializeOrg(two), '* H\n:PROPERTIES:\n:B:   2\n:END:\n');
});

test('editing the title regenerates the heading line but leaves the planning line and the drawers as they were', () => {
  const doc = parseOrg('* TODO Old title                :work:\nDEADLINE: <2026-03-07 Sat> SCHEDULED: <2026-03-01 Sun>\n  :PROPERTIES:\n  :ID:     abc\n  :END:\nBody\n');
  doc.children[0].title = 'New title';
  assert.equal(serializeOrg(doc), '* TODO New title :work:\nDEADLINE: <2026-03-07 Sat> SCHEDULED: <2026-03-01 Sun>\n  :PROPERTIES:\n  :ID:     abc\n  :END:\nBody\n');
});

test('editing one heading does not disturb the original text of its neighbours', () => {
  const text = '* One                      :a:\n* Two                      :b:\n* Three                    :c:\n';
  const doc = parseOrg(text);
  doc.children[1].title = 'Changed';
  assert.equal(serializeOrg(doc), '* One                      :a:\n* Changed :b:\n* Three                    :c:\n');
});

test('changing a heading\u2019s level regenerates its own line, not its drawers', () => {
  const doc = parseOrg('* H                         :t:\n  :PROPERTIES:\n  :ID:   x\n  :END:\n');
  doc.children[0].level = 2;
  assert.equal(serializeOrg(doc), '** H :t:\n  :PROPERTIES:\n  :ID:   x\n  :END:\n');
});

test('a heading copied with structuredClone (as archive and refile do) still serializes to its original text', () => {
  const text = '* Parent\n** Child                     :x:\n   :PROPERTIES:\n   :ID:    abc\n   :END:\n   Body\n';
  const child = parseOrg(text).children[0].children[0];
  assert.equal(serializeHeadingSubtree(structuredClone(child)), '** Child                     :x:\n   :PROPERTIES:\n   :ID:    abc\n   :END:\n   Body\n');
});

test('headings written from scratch (no original text) serialize as before', () => {
  const doc = { type: 'document', keywords: [], bodyLines: [], children: [] };
  doc.children.push({
    type: 'heading', level: 1, todo: 'TODO', priority: 'A', title: 'Fresh', tags: ['x'],
    planning: { scheduled: '<2026-01-01 Thu>', deadline: null, closed: null },
    properties: { ID: 'q', EMPTY: '' }, propertyOrder: ['ID', 'EMPTY'], logbookLines: ['- note'], bodyLines: ['text'], children: [],
  });
  assert.equal(serializeOrg(doc), '* TODO [#A] Fresh :x:\nSCHEDULED: <2026-01-01 Thu>\n:PROPERTIES:\n:ID: q\n:EMPTY:\n:END:\n:LOGBOOK:\n- note\n:END:\ntext');
});

test('line-number lookups account for the logbook and unusual drawers, so they match the serialized text', () => {
  const text = '* First\n:LOGBOOK:\n- State change\n- Another\n:END:\n  :PROPERTIES:\n  :A:  1\n  :END:\nbody\n* Second\nDEADLINE: <2026-03-07 Sat>\n:PROPERTIES:\n:END:\n** Third\n';
  const doc = parseOrg(text);
  const lines = serializeOrg(doc).split('\n');
  for (const [h, title] of [[doc.children[1], '* Second'], [doc.children[1].children[0], '** Third']]) {
    const n = findHeadingLineNumber(doc, h);
    assert.equal(lines[n], title, `line ${n} should be ${title}`);
    assert.equal(findHeadingAtLine(doc, n), h);
  }
  // and still right after an edit regenerates part of the first heading
  doc.children[0].properties.A = '2';
  const edited = serializeOrg(doc).split('\n');
  const n2 = findHeadingLineNumber(doc, doc.children[1]);
  assert.equal(edited[n2], '* Second');
  assert.equal(findHeadingAtLine(doc, n2), doc.children[1]);
});
