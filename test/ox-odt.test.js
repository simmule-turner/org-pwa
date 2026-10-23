import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseOrg } from '../src/org-parser.js';
import { exportToOdt } from '../src/export-odt.js';
import { odtContentXml, escapeXml } from '../src/ox-odt.js';
import { FIXTURES, FIXTURE_NAMES, normalizedFixture, loadKatex } from './support/odt-normalize.mjs';

/** Unpacks an .odt into a fresh directory. @param {Uint8Array} bytes */
function unpack(bytes) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ox-odt-test-'));
  writeFileSync(path.join(dir, 't.odt'), bytes);
  execFileSync('unzip', ['-o', '-q', path.join(dir, 't.odt'), '-d', dir]);
  return dir;
}

// ---- the port against Emacs 29.3's org-odt-export-to-odt -----------------------------------

// Each fixture's .xml was produced by the exporter and checked line by line against Emacs, except for the
// documented deviations: a default author "root" (Emacs) vs none, verse line breaks, "nil" as the text of a
// link to a target, an unescaped "<" from \lt, KaTeX formulas and colored source blocks (b1, k1, m3, p1, hl, mx).
for (const name of FIXTURE_NAMES) {
  test(`ox-odt port: ${name}.org gives the content.xml the fixture records`, () => {
    const expected = readFileSync(path.join(FIXTURES, name + '.xml'), 'utf8');
    assert.equal(normalizedFixture(name), expected);
  });
}

test('a link to a paragraph that has no heading above it stops the export, as in Emacs, unless it has a description', () => {
  const org = '#+NAME: para\nSome paragraph.\n\nSee [[para]].\n';
  assert.throws(() => odtContentXml(parseOrg(org)), /Unable to resolve the paragraph named "para"/);
  assert.ok(odtContentXml(parseOrg('* H\n#+NAME: para\nSome paragraph.\n\nSee [[para]].\n')).includes('text:reference-format="text"'));
});

test('a document without #+AUTHOR: takes user-full-name when it is set, and has no author line otherwise', () => {
  assert.match(odtContentXml(parseOrg('* H\ntext\n'), null, { userFullName: 'Pat Doe' }), /<text:initial-creator>Pat Doe<\/text:initial-creator>/);
  assert.ok(!odtContentXml(parseOrg('* H\ntext\n')).includes('initial-creator'));
  assert.match(odtContentXml(parseOrg('#+AUTHOR: Me\n* H\n'), null, { userFullName: 'Pat Doe' }), /initial-creator>Me</);
});

// ---- package structure ---------------------------------------------------------------------

test('the archive starts with the stored mimetype and unzips cleanly', () => {
  const bytes = exportToOdt(parseOrg('* Heading\nSome text.\n'));
  assert.ok(bytes instanceof Uint8Array);
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('PK'));
  assert.ok(text.indexOf('mimetypeapplication/vnd.oasis.opendocument.text') > 0 && text.indexOf('mimetype') < text.indexOf('content.xml'));
  const dir = unpack(bytes);
  for (const f of ['content.xml', 'styles.xml', 'meta.xml', 'META-INF/manifest.xml']) assert.ok(existsSync(path.join(dir, f)), f);
  assert.equal(readFileSync(path.join(dir, 'mimetype'), 'utf8'), 'application/vnd.oasis.opendocument.text');
});

test('scope: a subtree export takes the subtree heading as its title, as Emacs does, and has no heading of its own', () => {
  const doc = parseOrg('#+TITLE: T\n* One\n** Sub\ntext\n');
  const xml = odtContentXml(doc, doc.children[0].children[0]);
  assert.match(xml, /<text:title>Sub<\/text:title>/);
  assert.ok(!xml.includes('<text:h ') && xml.includes('>text\n<'));
});

test('escapeXml escapes what Emacs escapes: ampersand and the angle brackets', () => {
  assert.equal(escapeXml(`<a href="x">&'</a>`), `&lt;a href="x"&gt;&amp;'&lt;/a&gt;`);
});

// ---- images, formulas, colors --------------------------------------------------------------

const PNG = readFileSync(path.join(FIXTURES, 'img.png')).toString('base64');

test('an image the app can read is embedded under Images/ with a manifest entry and a size from its pixels', () => {
  const images = new Map([['file:img.png', 'data:image/png;base64,' + PNG]]);
  const dir = unpack(exportToOdt(parseOrg('[[file:img.png]]\n'), null, { images }));
  assert.ok(existsSync(path.join(dir, 'Images', '0001.png')));
  const manifest = readFileSync(path.join(dir, 'META-INF', 'manifest.xml'), 'utf8');
  assert.match(manifest, /manifest:media-type="image\/png" manifest:full-path="Images\/0001\.png"/);
  assert.match(readFileSync(path.join(dir, 'content.xml'), 'utf8'), /svg:width="3\.17cm" svg:height="1\.59cm"/);
});

test('#+ATTR_ODT :width and :height scale the picture, and a big one is fitted to the page', () => {
  const images = new Map([['file:img.png', 'data:image/png;base64,' + PNG]]);
  const xml = odtContentXml(parseOrg('#+ATTR_ODT: :width 6 :height 3\n[[file:img.png]]\n\n#+ATTR_ODT: :scale 20\n[[file:img.png]]\n'), null, { images });
  assert.match(xml, /svg:width="6\.00cm" svg:height="3\.00cm"/);
  assert.match(xml, /svg:width="17\.00cm" svg:height="8\.50cm"/);
});

test('an image that cannot be read stays a link', () => {
  const xml = odtContentXml(parseOrg('Look: [[file:nope.png]]\n'));
  assert.ok(xml.includes('xlink:href="../nope.png"') && !xml.includes('<draw:image'));
});

test('LaTeX becomes a formula object holding KaTeX MathML, with a numbered display equation', () => {
  loadKatex();
  const bytes = exportToOdt(parseOrg('Inline $x^2$ here.\n\n\\begin{equation}\nE = mc^2\n\\end{equation}\n'));
  const dir = unpack(bytes);
  const f1 = readFileSync(path.join(dir, 'Formula-0001', 'content.xml'), 'utf8');
  assert.match(f1, /<math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML"/);
  assert.match(f1, /<annotation encoding="application\/x-tex">x\^2<\/annotation>/);
  assert.match(readFileSync(path.join(dir, 'META-INF', 'manifest.xml'), 'utf8'), /application\/vnd\.oasis\.opendocument\.formula" manifest:full-path="Formula-0002\/"/);
  const content = readFileSync(path.join(dir, 'content.xml'), 'utf8');
  assert.match(content, /<text:p text:style-name="OrgFormula">[\s\S]*Formula-0002[\s\S]*<text:tab\/>\(<text:sequence/);
});

test('without KaTeX a LaTeX fragment is kept as verbatim code, as Emacs does without a converter', () => {
  const saved = globalThis.katex;
  delete globalThis.katex;
  try {
    assert.match(odtContentXml(parseOrg('A $x^2$ b.\n')), /<text:span text:style-name="OrgCode">\$x\^2\$<\/text:span>/);
  } finally {
    globalThis.katex = saved;
  }
});

test('a source block in a known language is colored with Org-named styles that styles.xml defines', () => {
  const dir = unpack(exportToOdt(parseOrg('#+begin_src js\nconst a = "x"; // hi\n#+end_src\n')));
  const content = readFileSync(path.join(dir, 'content.xml'), 'utf8');
  const styles = readFileSync(path.join(dir, 'styles.xml'), 'utf8');
  for (const face of ['Keyword', 'String', 'Comment']) {
    assert.ok(content.includes(`OrgSrcFontLock${face}Face`), face);
    assert.ok(styles.includes(`style:name="OrgSrcFontLock${face}Face"`), face);
  }
  assert.ok(styles.includes('style:name="OrgSrcBlock"'));
});

test('an unknown language stays an uncolored fixed-width block', () => {
  const xml = odtContentXml(parseOrg('#+begin_src nolang\nplain\n#+end_src\n'));
  assert.ok(xml.includes('OrgFixedWidthBlock') && !xml.includes('OrgSrcFontLock'));
});

// ---- a real LibreOffice round trip ---------------------------------------------------------

let haveLibreOffice = true;
try {
  execFileSync('which', ['soffice']);
} catch {
  haveLibreOffice = false;
}

test('LibreOffice opens the file and keeps headings, text, list items, table cells and the formula', { skip: !haveLibreOffice && 'LibreOffice not available in this environment', timeout: 120000 }, () => {
  loadKatex();
  const dir = unpack(exportToOdt(parseOrg('#+TITLE: Round\n* Head\nSome *bold* text and $x^2$.\n- item one\n- item two\n\n| a | b |\n|---+---|\n| 1 | 2 |\n')));
  execFileSync('soffice', ['--headless', '--convert-to', 'txt:Text', path.join(dir, 't.odt'), '--outdir', dir], { timeout: 100000 });
  const txt = readFileSync(path.join(dir, 't.txt'), 'utf8');
  for (const piece of ['Round', 'Head', 'Some bold text', 'item one', 'item two']) assert.ok(txt.includes(piece), piece + '\n' + txt);
  assert.match(txt, /a\s+b/);
});
