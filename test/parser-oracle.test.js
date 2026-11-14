// Holds the app's two parsers of a text's elements to Org's own (Emacs 29.3 org-element): parseElements (src/org-elements.js, read by the
// exporters) in detail, parseBody (src/body-parser.js, what the editor shows) on the kinds of node. test/fixtures/parser-oracle.json was
// made by tools/gen-parser-oracle.mjs; test/support/parser-skeleton.js builds the outlines and lists, with the reason, the texts where the
// editor model still differs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseElements } from '../src/org-elements.js';
import { parseBody } from '../src/body-parser.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import * as inlineModule from '../src/inline-markup.js';
import { elementsOutline, bodyOutline, emacsSignature, KNOWN } from './support/parser-skeleton.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/parser-oracle.json', import.meta.url), 'utf8'));
const AFFILIATED = /^\s*#\+(NAME|CAPTION|HEADERS?|RESULTS|PLOT|TBLNAME|ATTR_\w+)(\[[^\]]*\])?:/i;

test(`the elements of ${oracle.cases.length} texts are the ones Org finds (parseElements)`, () => {
  const wrong = [];
  for (const c of oracle.cases) {
    if (KNOWN.elements.some((k) => k.match(c.text))) continue;
    for (const s of c.sections) {
      const got = emacsSignature(elementsOutline(parseElements(s.text.split('\n'))), true);
      if (JSON.stringify(got) !== JSON.stringify(s.elements)) wrong.push({ text: c.text, want: JSON.stringify(s.elements), got: JSON.stringify(got) });
    }
  }
  assert.equal(wrong.length, 0, `${wrong.length} differ, first: ${JSON.stringify(wrong[0], null, 1)}`);
});

test(`the nodes of ${oracle.cases.length} texts are the ones Org's elements make (parseBody, by kind)`, () => {
  const wrong = [];
  for (const c of oracle.cases) {
    if (KNOWN.body.some((k) => k.match(c.text))) continue;
    for (const s of c.sections) {
      // Org keeps #+NAME:, #+CAPTION: and the like with the element after them; the editor shows them as lines of text before it
      const lines = s.text.split('\n').filter((l) => !AFFILIATED.test(l));
      if (lines.every((l) => l.trim() === '')) continue; // nothing follows them
      const got = bodyOutline(parseBody(lines));
      if (JSON.stringify(got) !== JSON.stringify(s.body)) wrong.push({ text: c.text, want: JSON.stringify(s.body), got: JSON.stringify(got) });
    }
  }
  assert.equal(wrong.length, 0, `${wrong.length} differ, first: ${JSON.stringify(wrong[0], null, 1)}`);
});

test('a #+KEY: line before the first heading is written back as it was read', () => {
  for (const text of ['#+KEY:\n* h\n', '#+KEY:\tv\n* h\n', '#+KEY:  v \n* h\n', '#+END:\n* h\n', '#+TBLFM:\n* h\n', '#+RESULTS:\n: a\n* h\n', '#+CALL: f()\n* h\n', '#+TITLE:   x\n* h\n']) {
    assert.equal(serializeOrg(parseOrg(text)), text);
  }
  const doc = parseOrg('#+TITLE: a\n* h\n');
  doc.keywords[0].value = 'b';
  assert.equal(serializeOrg(doc), '#+TITLE: b\n* h\n');
});

// ---- objects ------------------------------------------------------------------------------------------------------------------

const KIND = { bold: 'bold', italic: 'italic', underline: 'underline', strikethrough: 'strike-through' };

/** The objects of a node list as Emacs's dump gives them (text left out). @param {any[]} nodes @returns {any[]} */
function objectsOf(nodes) {
  /** @type {any[]} */ const out = [];
  for (const n of nodes) {
    if (n.type in KIND) out.push({ t: KIND[n.type], ch: objectsOf(n.children) });
    else if (n.type === 'code' || n.type === 'verbatim') out.push({ t: n.type, v: n.value });
    else if (n.type === 'link') out.push({ t: 'link', raw: n.target, ch: n.descriptionNodes ? objectsOf(n.descriptionNodes) : null });
    else if (n.type === 'image') out.push({ t: 'link', raw: n.target, ch: null });
    else if (n.type === 'latex') out.push({ t: 'latex', v: n.raw });
    else if (n.type === 'footnote-ref') out.push({ t: 'fn', label: n.label, kind: 'standard', ch: [] });
    else if (n.type === 'footnote-def') out.push({ t: 'fn', label: n.label, kind: 'inline', ch: objectsOf(n.children) });
    else if (n.type === 'subscript' || n.type === 'superscript') out.push({ t: n.type, v: n.value });
  }
  return out;
}

test(`the objects in ${oracle.objects.length} paragraphs are the ones Org finds (emphasis over a line break, links, their text and address)`, () => {
  const wrong = [];
  for (const c of oracle.objects) {
    const paragraphs = c.text.split(/\n[ \t]*\n/).slice(0, 1); // Emacs's dump has the first paragraph
    const got = paragraphs.map((p) => {
      const { extractLatexFragments } = inlineModule;
      const { lines, fragments } = extractLatexFragments(p.split('\n'));
      return objectsOf(inlineModule.parseInline(lines.join('\n'), { latexFragments: fragments }));
    });
    // Org writes a footnote reference whose text is a line break as one; the objects of the text only count here
    if (JSON.stringify(got) !== JSON.stringify(c.emacs)) wrong.push({ text: c.text, want: JSON.stringify(c.emacs), got: JSON.stringify(got) });
  }
  assert.equal(wrong.length, 0, `${wrong.length} differ, first: ${JSON.stringify(wrong[0], null, 1)}`);
});

test('a paragraph is cut into the nodes of its lines where a span crosses a line break', () => {
  const lines = (/** @type {string} */ text) => inlineModule.parseInlineLines(text.split('\n')).map((row) => objectsOf(row));
  assert.deepEqual(lines('*a\nb* c'), [[{ t: 'bold', ch: [] }], [{ t: 'bold', ch: [] }]]);
  assert.deepEqual(lines('=a\nb= c\nd'), [[{ t: 'verbatim', v: 'a' }], [{ t: 'verbatim', v: 'b' }], []]);
  // a link whose address has a break stays whole in the line where it begins; the text after it is in the next line without the blank
  const rows = inlineModule.parseInlineLines('x [[a\nb]] now\nz'.split('\n'));
  assert.equal(rows.length, 3);
  assert.equal(rows[0][1].target, 'a b');
  assert.equal(rows[1][0].value, 'now');
  assert.equal(inlineModule.parseInlineLines(['call_x(a', 'b)']).every((row) => row.every((n) => n.type === 'text')), true);
});
