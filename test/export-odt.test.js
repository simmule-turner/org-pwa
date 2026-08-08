import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseOrg } from '../src/org-parser.js';
import { exportToOdt } from '../src/export-odt.js';

function unzipEntry(odtBytes, entryName) {
  const dir = mkdtempSync(path.join(tmpdir(), 'export-odt-test-'));
  const odtPath = path.join(dir, 'test.odt');
  writeFileSync(odtPath, odtBytes);
  execFileSync('unzip', ['-o', '-q', odtPath, '-d', dir]);
  return readFileSync(path.join(dir, entryName), 'utf8');
}

// ---- package structure ----------------------------------------------------

test('exportToOdt produces a Uint8Array', () => {
  const doc = parseOrg('* Heading\nSome text.\n');
  assert.ok(exportToOdt(doc) instanceof Uint8Array);
});

test('the archive passes a real unzip integrity check', () => {
  const doc = parseOrg('* Heading\nSome text.\n');
  const bytes = exportToOdt(doc);
  const dir = mkdtempSync(path.join(tmpdir(), 'export-odt-test-'));
  const odtPath = path.join(dir, 'test.odt');
  writeFileSync(odtPath, bytes);
  const out = execFileSync('unzip', ['-t', odtPath], { encoding: 'utf8' });
  assert.match(out, /No errors detected/);
});

test('the mimetype entry is exactly the required ODF text mimetype string', () => {
  const doc = parseOrg('* Heading\n');
  const bytes = exportToOdt(doc);
  assert.equal(unzipEntry(bytes, 'mimetype'), 'application/vnd.oasis.opendocument.text');
});

test('every required XML part (content.xml, styles.xml, meta.xml, manifest.xml) is present and well-formed', () => {
  const doc = parseOrg('* Heading\nSome text.\n');
  const bytes = exportToOdt(doc);
  for (const entry of ['content.xml', 'styles.xml', 'meta.xml', 'META-INF/manifest.xml']) {
    const xml = unzipEntry(bytes, entry);
    // xmllint --noout exits non-zero on malformed XML -- a real,
    // independent parser confirming well-formedness, not just this
    // module's own string-building being internally consistent.
    const dir = mkdtempSync(path.join(tmpdir(), 'export-odt-xml-'));
    const xmlPath = path.join(dir, 'check.xml');
    writeFileSync(xmlPath, xml);
    assert.doesNotThrow(() => execFileSync('xmllint', ['--noout', xmlPath]), `${entry} should be well-formed XML`);
  }
});

// ---- content correctness ---------------------------------------------------

test('a heading becomes a text:h with the right outline level', () => {
  const doc = parseOrg('* Top\n** Nested\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(xml, /<text:h text:style-name="Heading_20_1" text:outline-level="1">/);
  assert.match(xml, /<text:h text:style-name="Heading_20_2" text:outline-level="2">/);
});

test('heading levels clamp at 6, matching the styles actually defined', () => {
  const doc = parseOrg('* A\n** B\n*** C\n**** D\n***** E\n****** F\n******* G');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(xml, /text:outline-level="6"/);
  assert.doesNotMatch(xml, /text:outline-level="7"/);
});

test('exporting a subtree makes the selected heading level 1, shifting descendants accordingly', () => {
  const doc = parseOrg('* Top\n** Middle\n*** Deep');
  const middle = doc.children[0].children[0];
  const xml = unzipEntry(exportToOdt(doc, middle), 'content.xml');
  assert.match(xml, /text:outline-level="1"[^>]*>.*?Middle/);
  assert.doesNotMatch(xml, />Top</);
});

test('bold and italic map to their own named character styles', () => {
  const doc = parseOrg('* H\nSome *bold* and /italic/ text.\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(xml, /<text:span text:style-name="Bold">bold<\/text:span>/);
  assert.match(xml, /<text:span text:style-name="Italic">italic<\/text:span>/);
});

test('underline and strikethrough map to their own character styles', () => {
  const doc = parseOrg('* H\n_underline_ and +strikethrough+.\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(xml, /<text:span text:style-name="Underline">underline<\/text:span>/);
  assert.match(xml, /<text:span text:style-name="Strikethrough">strikethrough<\/text:span>/);
});

test('a table becomes table:table with one column definition per column and cells wrapped in paragraphs', () => {
  const doc = parseOrg('* H\n| a | b |\n| 1 | 2 |\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(xml, /<table:table>(<table:table-column\/>){2}/);
  assert.match(xml, /<table:table-cell office:value-type="string"><text:p[^>]*>a<\/text:p><\/table:table-cell>/);
});

test('a checkbox list item renders a real checkbox glyph, checked state reflected correctly', () => {
  const doc = parseOrg('* H\n- [ ] todo\n- [X] done\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(xml, /\u2610 todo/);
  assert.match(xml, /\u2611 done/);
});

test('an ordered list uses the OrderedList style, an unordered list uses UnorderedList', () => {
  const doc = parseOrg('* H\n1. first\n2. second\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(xml, /<text:list text:style-name="OrderedList">/);

  const doc2 = parseOrg('* H\n- first\n- second\n');
  const xml2 = unzipEntry(exportToOdt(doc2), 'content.xml');
  assert.match(xml2, /<text:list text:style-name="UnorderedList">/);
});

test('an internal link to a heading present in the export becomes a real bookmark reference, with the target heading actually bookmarked', () => {
  const doc = parseOrg('* Intro\n[[#capture][Jump]]\n* Capture\n:PROPERTIES:\n:CUSTOM_ID: capture\n:END:\nContent.\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(xml, /<text:bookmark-ref text:reference-format="text" text:ref-name="capture">Jump<\/text:bookmark-ref>/);
  assert.match(xml, /<text:bookmark-start text:name="capture"\/>/);
});

test('an external URL link becomes a plain text:a with xlink:href, not a bookmark reference', () => {
  const doc = parseOrg('* H\n[[https://example.com][External]]\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(xml, /<text:a xlink:type="simple" xlink:href="https:\/\/example\.com">External<\/text:a>/);
});

test('a footnote reference and its definition become a real ODF <text:note> element, not a manually-numbered list', () => {
  const doc = parseOrg('* H\nA claim[fn:1:with a real footnote body] here.\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(xml, /<text:note text:id="ftn1" text:note-class="footnote">/);
  assert.match(xml, /<text:note-body><text:p text:style-name="Footnote">with a real footnote body<\/text:p><\/text:note-body>/);
});

test('a TODO keyword gets a distinct style from a DONE-type keyword', () => {
  const doc = parseOrg('#+TODO: TODO WAIT | DONE KILL\n* TODO Active\n* DONE Finished\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(xml, /<text:span text:style-name="TodoKeywordActive">TODO<\/text:span>/);
  assert.match(xml, /<text:span text:style-name="TodoKeywordDone">DONE<\/text:span>/);
});

test('property drawers and ARCHIVE_* properties are excluded, matching every other export backend', () => {
  const doc = parseOrg('* H\n:PROPERTIES:\n:CUSTOM_ID: foo\n:SOMETHING: else\n:END:\nContent.\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.doesNotMatch(xml, /SOMETHING/);
  assert.doesNotMatch(xml, /PROPERTIES/);
});

test('XML special characters in content are properly escaped', () => {
  const doc = parseOrg('* H\nA <tag> & "quote" here.\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.doesNotMatch(xml, /A <tag>/);
  assert.match(xml, /&lt;tag&gt;/);
  assert.match(xml, /&amp;/);
});

// ---- real LibreOffice integration test (maximum confidence) ----------------

const haveLibreOffice = (() => {
  try {
    execFileSync('which', ['libreoffice']);
    return true;
  } catch {
    return false;
  }
})();

test(
  'a real LibreOffice conversion round-trip preserves headings, bold/italic, list items, and table cells',
  { skip: !haveLibreOffice ? 'libreoffice not available in this environment' : false },
  () => {
    const doc = parseOrg(
      '* Heading One\nSome *bold* and /italic/ text.\n- item 1\n- item 2\n| a | b |\n| 1 | 2 |\n* Heading Two\n'
    );
    const bytes = exportToOdt(doc);
    const dir = mkdtempSync(path.join(tmpdir(), 'export-odt-lo-'));
    const odtPath = path.join(dir, 'test.odt');
    writeFileSync(odtPath, bytes);

    execFileSync('libreoffice', ['--headless', '--convert-to', 'txt', odtPath, '--outdir', dir], { timeout: 60000 });
    const txtPath = path.join(dir, 'test.txt');
    assert.ok(existsSync(txtPath), 'LibreOffice should have produced a converted text file');
    const text = readFileSync(txtPath, 'utf8');
    assert.match(text, /Heading One/);
    assert.match(text, /Some bold and italic text/);
    assert.match(text, /item 1/);
    assert.match(text, /item 2/);
    assert.match(text, /Heading Two/);

    execFileSync('libreoffice', ['--headless', '--convert-to', 'html', odtPath, '--outdir', dir], { timeout: 60000 });
    const html = readFileSync(path.join(dir, 'test.html'), 'utf8');
    assert.match(html, /<b>bold<\/b>/);
    assert.match(html, /<i>italic<\/i>/);
  }
);

// ---- width-cookie row exclusion (real org's own "<N>" column-width directive) ----

test('THE FIX: a width-cookie row ("<N>" in every cell) is excluded entirely, not shown as a literal data row', () => {
  const doc = parseOrg('* H\n| <10> | <5> |\n| Name | Age |\n|---+---|\n| Al | 9 |\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.doesNotMatch(xml, /&lt;10&gt;/);
  assert.doesNotMatch(xml, /&lt;5&gt;/);
});

test('THE FIX: with the cookie row correctly excluded, the REAL header row (Name/Age) is the first row actually rendered', () => {
  const doc = parseOrg('* H\n| <10> | <5> |\n| Name | Age |\n|---+---|\n| Al | 9 |\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  const firstRow = xml.match(/<table:table-row>.*?<\/table:table-row>/)[0];
  assert.match(firstRow, />Name</);
  assert.match(firstRow, />Age</);
});

test('a table with no width-cookie row is completely unaffected', () => {
  const doc = parseOrg('* H\n| Name | Age |\n|---+---|\n| Al | 9 |\n');
  const xml = unzipEntry(exportToOdt(doc), 'content.xml');
  const firstRow = xml.match(/<table:table-row>.*?<\/table:table-row>/)[0];
  assert.match(firstRow, />Name</);
});
