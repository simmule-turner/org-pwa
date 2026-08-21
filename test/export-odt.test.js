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

// ---- THE FIX: paragraph reflow -- flow unless "\\" forces a real break ----

test('THE FIX: adjacent source lines within one paragraph flow together with a plain space, not a forced <text:line-break/>', () => {
  const doc = parseOrg('* H\nLine one\nline two continues\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(content, /Line one line two continues/);
  assert.doesNotMatch(content, /<text:line-break\/>/);
});

test('THE FIX: an explicit "\\\\" marker still forces a real line break, exactly where it appears -- not everywhere', () => {
  const doc = parseOrg('* H\nLine one\\\\\nline two forced\nline three flows\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  const breakCount = (content.match(/<text:line-break\/>/g) || []).length;
  assert.equal(breakCount, 1);
  assert.match(content, /Line one<text:line-break\/>line two forced line three flows/);
});

test('the "\\\\" marker itself is stripped, never leaking into the ODT output as literal backslashes', () => {
  const doc = parseOrg('* H\nSome text\\\\\nmore text\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.doesNotMatch(content, /\\\\/);
});

// ---- THE FIX: #+TITLE / #+AUTHOR / #+DATE / #+OPTIONS -------------------------

test('THE EXACT REQUEST: #+TITLE renders as a visible "Title"-styled paragraph in the body', () => {
  const doc = parseOrg('#+TITLE: My Test Document\n* Heading\nText.\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(content, /<text:p text:style-name="Title">My Test Document<\/text:p>/);
});

test('#+AUTHOR / #+DATE render as "Subtitle"-styled paragraphs right after the title', () => {
  const doc = parseOrg('#+TITLE: T\n#+AUTHOR: Jane Doe\n#+DATE: 2026-01-15\n* Heading\nText.\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(content, /<text:p text:style-name="Subtitle">Jane Doe<\/text:p>/);
  assert.match(content, /<text:p text:style-name="Subtitle">2026-01-15<\/text:p>/);
});

test('THE FIX: author:nil / date:nil each independently suppress their own field, from BOTH the visible body block and the ODF meta.xml metadata', () => {
  const doc = parseOrg('#+TITLE: T\n#+AUTHOR: Jane Doe\n#+DATE: 2026-01-15\n#+OPTIONS: author:nil\n* Heading\nText.\n');
  const bytes = exportToOdt(doc);
  const content = unzipEntry(bytes, 'content.xml');
  const meta = unzipEntry(bytes, 'meta.xml');
  assert.ok(!content.includes('Jane Doe'));
  assert.ok(!meta.includes('Jane Doe'));
  assert.ok(content.includes('2026-01-15'));
  assert.ok(meta.includes('2026-01-15'));
});

test('#+AUTHOR / #+DATE also populate the ODF metadata (dc:creator / dc:date), not just the visible body', () => {
  const doc = parseOrg('#+TITLE: T\n#+AUTHOR: Jane Doe\n#+DATE: 2026-01-15\n* Heading\nText.\n');
  const meta = unzipEntry(exportToOdt(doc), 'meta.xml');
  assert.match(meta, /<dc:creator>Jane Doe<\/dc:creator>/);
  assert.match(meta, /<dc:date>2026-01-15<\/dc:date>/);
});

test('THE EXACT REQUEST: section numbers render as a literal text prefix on each heading', () => {
  const doc = parseOrg('* A\n** B\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(content, /1\. A<text:bookmark-end/);
  assert.match(content, /1\.1\. B<text:bookmark-end/);
});

test('#+OPTIONS: num:nil removes section numbers entirely', () => {
  const doc = parseOrg('#+OPTIONS: num:nil\n* A\n** B\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.ok(!content.includes('1. A'));
  assert.ok(!content.includes('1.1. B'));
});

test('THE EXACT REQUEST: a document with 2+ headings gets an auto-generated Table of Contents, linking to each heading\u2019s own bookmark', () => {
  const doc = parseOrg('* First\n* Second\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(content, /Table of Contents/);
  assert.match(content, /<text:a xlink:type="simple" xlink:href="#first">1\. First<\/text:a>/);
  assert.match(content, /<text:a xlink:type="simple" xlink:href="#second">2\. Second<\/text:a>/);
});

test('a document with only one heading gets no Table of Contents', () => {
  const doc = parseOrg('* Only\nText.\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.ok(!content.includes('Table of Contents'));
});

test('toc:nil disables the Table of Contents entirely, independent of num:', () => {
  const doc = parseOrg('#+OPTIONS: toc:nil\n* First\n* Second\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.ok(!content.includes('Table of Contents'));
  assert.ok(content.includes('1. First'), 'numbering is untouched by toc:nil');
});

test('THE EXACT REQUEST: toc:1 limits the ToC listing to headers 1 only, while section numbering throughout the body still goes to full depth', () => {
  const doc = parseOrg('#+OPTIONS: toc:1\n* A\n** B\n*** C\n* D\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  const tocSection = content.split('</text:list>')[0];
  assert.ok(tocSection.includes('>1. A<'));
  assert.ok(tocSection.includes('>2. D<'));
  assert.ok(!tocSection.includes('B'));
  assert.ok(content.includes('1.1.1. C'), 'still fully numbered in the body');
});

test('THE EXACT REQUEST: creator:nil is the default -- no "Generated by" notice unless explicitly enabled', () => {
  const doc = parseOrg('#+TITLE: T\n* Heading\nText.\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.ok(!content.includes('Generated by'));
});

test('creator:t adds a "Generated by org-pwa" notice', () => {
  const doc = parseOrg('#+TITLE: T\n#+OPTIONS: creator:t\n* Heading\nText.\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(content, /<text:p text:style-name="Creator">Generated by org-pwa<\/text:p>/);
});

test('exporting a scoped subtree shows no title/author/date/ToC/creator block, but section numbering (independent of scope) still applies', () => {
  const doc = parseOrg('#+TITLE: Whole Doc\n#+OPTIONS: creator:t\n* Target\n** Child\n* Other\n');
  const target = doc.children[0];
  const content = unzipEntry(exportToOdt(doc, target), 'content.xml');
  assert.ok(!content.includes('text:style-name="Title"'));
  assert.ok(!content.includes('Table of Contents'));
  assert.ok(!content.includes('Generated by'));
  assert.ok(content.includes('1. Target') || content.includes('1.'), 'numbering still applies even for a scoped export');
});

// ---- THE FIX: document-level preamble body rendering (doc.body) ---------------

test('THE FIX: a document-level preamble body now renders in ODT export -- previously never rendered at all, needed for #+INCLUDE\u2019s own block-type variant', () => {
  const doc = parseOrg('#+TITLE: T\nSome preamble text.\n\n* Heading\nHeading text.\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.ok(content.includes('Some preamble text.'));
  assert.ok(content.indexOf('Some preamble text.') < content.indexOf('text:outline-level="1"'));
});

test('a scoped subtree export shows no document-level preamble', () => {
  const doc = parseOrg('Preamble text.\n\n* Target\nText.\n* Other\nText.\n');
  const target = doc.children[0];
  const content = unzipEntry(exportToOdt(doc, target), 'content.xml');
  assert.ok(!content.includes('Preamble text.'));
});

test('THE FIX: a lowercase #+title: sets the ODF dc:title too, matching real Emacs org-mode\u2019s own confirmed case-insensitive keyword parsing', () => {
  const doc = parseOrg('#+title: org-pwa README.org\n* Heading\nText.\n');
  const meta = unzipEntry(exportToOdt(doc), 'meta.xml');
  assert.match(meta, /<dc:title>org-pwa README\.org<\/dc:title>/);
});

// ---- THE FEATURE: #+BEGIN_EXPORT odt -------------------------------------------

test('THE EXACT REQUEST: #+BEGIN_EXPORT odt ... #+END_EXPORT is rendered raw/verbatim into content.xml, no escaping, matching real org\u2019s own confirmed ox-odt.el behavior (org-odt-export-block)', () => {
  const doc = parseOrg('#+BEGIN_EXPORT odt\n<text:p text:style-name="Text_20_body">Raw ODT content</text:p>\n#+END_EXPORT\n\n* Heading\nText.\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(content, /<text:p text:style-name="Text_20_body">Raw ODT content<\/text:p>/);
});

test('THE FIX: an #+BEGIN_EXPORT block for a DIFFERENT backend (html) is omitted entirely from ODT export', () => {
  const doc = parseOrg('#+BEGIN_EXPORT html\n<div>HTML-only content</div>\n#+END_EXPORT\n\n* Heading\nText.\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.doesNotMatch(content, /HTML-only content/);
});

test('#+BEGIN_EXPORT odt matches case-insensitively too', () => {
  const doc = parseOrg('#+BEGIN_EXPORT ODT\n<text:p>x</text:p>\n#+END_EXPORT\n\n* H\nText.\n');
  assert.match(unzipEntry(exportToOdt(doc), 'content.xml'), /<text:p>x<\/text:p>/);
});

// ---- THE FEATURE: #+BEGIN_EXPORT odt --------------------------------------

test('THE EXACT REQUEST: #+BEGIN_EXPORT odt ... #+END_EXPORT is rendered raw/verbatim into content.xml, no escaping', () => {
  const doc = parseOrg('#+BEGIN_EXPORT odt\n<text:p text:style-name="Text_20_body">Raw ODT content</text:p>\n#+END_EXPORT\n\n* Heading\nText.\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.match(content, /<text:p text:style-name="Text_20_body">Raw ODT content<\/text:p>/);
});

test('THE FIX: an #+BEGIN_EXPORT block for a DIFFERENT backend (html) is omitted entirely from ODT export', () => {
  const doc = parseOrg('#+BEGIN_EXPORT html\n<div>HTML-only content</div>\n#+END_EXPORT\n\n* Heading\nText.\n');
  const content = unzipEntry(exportToOdt(doc), 'content.xml');
  assert.doesNotMatch(content, /HTML-only content/);
});

test('#+BEGIN_EXPORT odt matches case-insensitively too', () => {
  for (const tag of ['ODT', 'Odt', 'odt']) {
    const doc = parseOrg(`#+BEGIN_EXPORT ${tag}\n<text:p>x</text:p>\n#+END_EXPORT\n\n* H\nText.\n`);
    const content = unzipEntry(exportToOdt(doc), 'content.xml');
    assert.match(content, /<text:p>x<\/text:p>/, `tag "${tag}" should match`);
  }
});

test('an #+BEGIN_EXPORT odt block still produces a valid, well-formed ODT archive', () => {
  const doc = parseOrg('#+BEGIN_EXPORT odt\n<text:p>Raw content</text:p>\n#+END_EXPORT\n\n* Heading\nText.\n');
  const bytes = exportToOdt(doc);
  assert.ok(bytes instanceof Uint8Array);
  const content = unzipEntry(bytes, 'content.xml');
  assert.match(content, /Raw content/);
});
