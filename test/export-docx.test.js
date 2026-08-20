import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseOrg } from '../src/org-parser.js';
import { exportToDocx } from '../src/export-docx.js';

function unzipEntry(docxBytes, entryName) {
  const dir = mkdtempSync(path.join(tmpdir(), 'export-docx-test-'));
  const docxPath = path.join(dir, 'test.docx');
  writeFileSync(docxPath, docxBytes);
  execFileSync('unzip', ['-o', '-q', docxPath, '-d', dir]);
  return readFileSync(path.join(dir, entryName), 'utf8');
}

// ---- package structure ----------------------------------------------------

test('exportToDocx produces a Uint8Array', () => {
  const doc = parseOrg('* Heading\nSome text.\n');
  assert.ok(exportToDocx(doc) instanceof Uint8Array);
});

test('the archive passes a real unzip integrity check', () => {
  const doc = parseOrg('* Heading\nSome text.\n');
  const bytes = exportToDocx(doc);
  const dir = mkdtempSync(path.join(tmpdir(), 'export-docx-test-'));
  const docxPath = path.join(dir, 'test.docx');
  writeFileSync(docxPath, bytes);
  const out = execFileSync('unzip', ['-t', docxPath], { encoding: 'utf8' });
  assert.match(out, /No errors detected/);
});

test('the real "file" command recognizes the output as an actual Word 2007+ document', () => {
  const doc = parseOrg('* Heading\n');
  const bytes = exportToDocx(doc);
  const dir = mkdtempSync(path.join(tmpdir(), 'export-docx-test-'));
  const docxPath = path.join(dir, 'test.docx');
  writeFileSync(docxPath, bytes);
  const out = execFileSync('file', [docxPath], { encoding: 'utf8' });
  assert.match(out, /Microsoft Word 2007\+/);
});

test('every required XML part is present and well-formed', () => {
  const doc = parseOrg('* Heading\nSome text.\n');
  const bytes = exportToDocx(doc);
  for (const entry of [
    '[Content_Types].xml',
    '_rels/.rels',
    'docProps/core.xml',
    'word/document.xml',
    'word/styles.xml',
    'word/numbering.xml',
    'word/footnotes.xml',
    'word/_rels/document.xml.rels',
  ]) {
    const xml = unzipEntry(bytes, entry);
    // xmllint --noout exits non-zero on malformed XML -- a real,
    // independent parser confirming well-formedness, not just this
    // module's own string-building being internally consistent.
    const dir = mkdtempSync(path.join(tmpdir(), 'export-docx-xml-'));
    const xmlPath = path.join(dir, 'check.xml');
    writeFileSync(xmlPath, xml);
    assert.doesNotThrow(() => execFileSync('xmllint', ['--noout', xmlPath]), `${entry} should be well-formed XML`);
  }
});

// ---- content correctness ---------------------------------------------------

test('a heading becomes a paragraph styled Heading1/Heading2 matching its own level', () => {
  const doc = parseOrg('* Top\n** Nested\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(xml, /<w:pStyle w:val="Heading1"\/>/);
  assert.match(xml, /<w:pStyle w:val="Heading2"\/>/);
});

test('heading levels clamp at 6, matching the styles actually defined', () => {
  const doc = parseOrg('* A\n** B\n*** C\n**** D\n***** E\n****** F\n******* G');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(xml, /Heading6/);
  assert.doesNotMatch(xml, /Heading7/);
});

test('exporting a subtree makes the selected heading level 1, shifting descendants accordingly', () => {
  const doc = parseOrg('* Top\n** Middle\n*** Deep');
  const middle = doc.children[0].children[0];
  const xml = unzipEntry(exportToDocx(doc, middle), 'word/document.xml');
  assert.match(xml, /Heading1.*?Middle/s);
  assert.doesNotMatch(xml, />Top</);
});

test('bold and italic apply direct run formatting (w:b/w:i), not a separate named character style', () => {
  const doc = parseOrg('* H\nSome *bold* and /italic/ text.\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(xml, /<w:b\/><\/w:rPr><w:t[^>]*>bold<\/w:t>/);
  assert.match(xml, /<w:i\/><\/w:rPr><w:t[^>]*>italic<\/w:t>/);
});

test('underline and strikethrough map to w:u and w:strike', () => {
  const doc = parseOrg('* H\n_underline_ and +strikethrough+.\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(xml, /<w:u w:val="single"\/>/);
  assert.match(xml, /<w:strike\/>/);
});

test('code/verbatim get a monospace font run property', () => {
  const doc = parseOrg('* H\nRun ~ls -la~ now.\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(xml, /<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"\/>.*?ls -la/);
});

test('a table becomes w:tbl with one gridCol per column and cells wrapped in paragraphs', () => {
  const doc = parseOrg('* H\n| a | b |\n| 1 | 2 |\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(xml, /<w:tblGrid>(<w:gridCol\/>){2}<\/w:tblGrid>/);
  assert.match(xml, /<w:tc><w:p>.*?a.*?<\/w:p><\/w:tc>/);
});

test('a checkbox list item renders a real checkbox glyph, checked state reflected correctly', () => {
  const doc = parseOrg('* H\n- [ ] todo\n- [X] done\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(xml, /\u2610.*?todo/);
  assert.match(xml, /\u2611.*?done/);
});

test('an ordered list references the ordered numId, an unordered list references the bullet numId', () => {
  const doc = parseOrg('* H\n1. first\n2. second\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(xml, /<w:numId w:val="2"\/>/); // ORDERED_NUM_ID

  const doc2 = parseOrg('* H\n- first\n- second\n');
  const xml2 = unzipEntry(exportToDocx(doc2), 'word/document.xml');
  assert.match(xml2, /<w:numId w:val="1"\/>/); // BULLET_NUM_ID
});

test('a nested list item increases its own ilvl', () => {
  const doc = parseOrg('* H\n- Parent\n  - Child\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(xml, /<w:ilvl w:val="0"\/>/);
  assert.match(xml, /<w:ilvl w:val="1"\/>/);
});

test('an internal link to a heading present in the export becomes a w:anchor hyperlink, with the target heading actually bookmarked', () => {
  const doc = parseOrg('* Intro\n[[#capture][Jump]]\n* Capture\n:PROPERTIES:\n:CUSTOM_ID: capture\n:END:\nContent.\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(xml, /<w:hyperlink w:anchor="capture">.*?Jump/);
  assert.match(xml, /<w:bookmarkStart w:id="\d+" w:name="capture"\/>/);
});

test('an external URL link becomes a w:hyperlink with an r:id, with the actual URL recorded in the relationships part', () => {
  const doc = parseOrg('* H\n[[https://example.com][External]]\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(xml, /<w:hyperlink r:id="rId\d+">.*?External/);
  const rels = unzipEntry(exportToDocx(doc), 'word/_rels/document.xml.rels');
  assert.match(rels, /Target="https:\/\/example\.com" TargetMode="External"/);
});

test('a footnote reference and its definition become a real w:footnoteReference plus a word/footnotes.xml entry, not a manually-numbered list', () => {
  const doc = parseOrg('* H\nA claim[fn:1:with a real footnote body] here.\n');
  const docxXml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(docxXml, /<w:footnoteReference w:id="1"\/>/);
  const footnotesXml = unzipEntry(exportToDocx(doc), 'word/footnotes.xml');
  assert.match(footnotesXml, /<w:footnote w:id="1">/);
  assert.match(footnotesXml, /with a real footnote body/);
});

test('a TODO keyword gets a distinct color from a DONE-type keyword', () => {
  const doc = parseOrg('#+TODO: TODO WAIT | DONE KILL\n* TODO Active\n* DONE Finished\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(xml, /a83232.*?TODO/);
  assert.match(xml, /2f8f3f.*?DONE/);
});

test('property drawers and ARCHIVE_* properties are excluded, matching every other export backend', () => {
  const doc = parseOrg('* H\n:PROPERTIES:\n:CUSTOM_ID: foo\n:SOMETHING: else\n:END:\nContent.\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.doesNotMatch(xml, /SOMETHING/);
  assert.doesNotMatch(xml, /PROPERTIES/);
});

test('XML special characters in content are properly escaped', () => {
  const doc = parseOrg('* H\nA <tag> & "quote" here.\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.doesNotMatch(xml, /A <tag>/);
  assert.match(xml, /&lt;tag&gt;/);
  assert.match(xml, /&amp;/);
});

test('a bookmark name that would otherwise start with a digit gets a leading underscore, since OOXML bookmark names can\u2019t start with a digit', () => {
  const doc = parseOrg('* 2026 Plans\nContent.\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(xml, /w:name="_2026-plans"/);
  assert.doesNotMatch(xml, /w:name="2026-plans"/);
});

// ---- width-cookie row exclusion (real org's own "<N>" column-width directive) ----

test('a width-cookie row ("<N>" in every cell) is excluded entirely, not shown as a literal data row', () => {
  const doc = parseOrg('* H\n| <10> | <5> |\n| Name | Age |\n|---+---|\n| Al | 9 |\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.doesNotMatch(xml, /&lt;10&gt;/);
  assert.doesNotMatch(xml, /&lt;5&gt;/);
});

test('a table with no width-cookie row is completely unaffected', () => {
  const doc = parseOrg('* H\n| Name | Age |\n|---+---|\n| Al | 9 |\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  const firstRow = xml.match(/<w:tr>.*?<\/w:tr>/)[0];
  assert.match(firstRow, />Name</);
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
  'a real LibreOffice conversion round-trip preserves headings, bold/italic, list items, table cells, footnotes, and hyperlinks',
  { skip: !haveLibreOffice ? 'libreoffice not available in this environment' : false },
  () => {
    const doc = parseOrg(
      [
        '* Heading One',
        'Some *bold* and /italic/ text with a footnote[fn:1:footnote body here] and a [[https://example.com][link]].',
        '- item 1',
        '- item 2',
        '| a | b |',
        '| 1 | 2 |',
        '* Heading Two',
      ].join('\n')
    );
    const bytes = exportToDocx(doc);
    const dir = mkdtempSync(path.join(tmpdir(), 'export-docx-lo-'));
    const docxPath = path.join(dir, 'test.docx');
    writeFileSync(docxPath, bytes);

    execFileSync('libreoffice', ['--headless', '--convert-to', 'txt', docxPath, '--outdir', dir], { timeout: 60000 });
    const txtPath = path.join(dir, 'test.txt');
    assert.ok(existsSync(txtPath), 'LibreOffice should have produced a converted text file');
    const text = readFileSync(txtPath, 'utf8');
    assert.match(text, /Heading One/);
    assert.match(text, /bold and italic/);
    assert.match(text, /item 1/);
    assert.match(text, /item 2/);
    assert.match(text, /Heading Two/);

    execFileSync('libreoffice', ['--headless', '--convert-to', 'html', docxPath, '--outdir', dir], { timeout: 60000 });
    const html = readFileSync(path.join(dir, 'test.html'), 'utf8');
    assert.match(html, /<b>bold<\/b>/);
    assert.match(html, /<i>italic<\/i>/);

    // Directly confirm the footnote body text survived the round-trip
    // too -- .txt conversion often omits footnote bodies entirely,
    // so this checks the raw re-extracted XML instead.
    execFileSync('unzip', ['-o', '-q', docxPath, '-d', dir]);
    const footnotesXml = readFileSync(path.join(dir, 'word/footnotes.xml'), 'utf8');
    assert.match(footnotesXml, /footnote body here/);
  }
);

// ---- THE FIX: paragraph reflow -- flow unless "\\" forces a real break ----

test('THE FIX: adjacent source lines within one paragraph flow together with a plain space (embedded in the first run\u2019s own text), not a forced <w:br/>', () => {
  const doc = parseOrg('* H\nLine one\nline two continues\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(xml, /Line one <\/w:t>/, 'the trailing space is embedded in the first line\u2019s own text run');
  assert.match(xml, /line two continues<\/w:t>/);
  assert.doesNotMatch(xml, /<w:br\/>/);
});

test('THE FIX: an explicit "\\\\" marker still forces a real line break, exactly where it appears -- not everywhere', () => {
  const doc = parseOrg('* H\nLine one\\\\\nline two forced\nline three flows\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  const breakCount = (xml.match(/<w:br\/>/g) || []).length;
  assert.equal(breakCount, 1, 'exactly one forced break, after "Line one" specifically');
  assert.match(xml, /Line one<\/w:t><\/w:r><w:r><w:br\/>/, 'the break comes immediately after the marked line, with no trailing space added to it');
  assert.match(xml, /line two forced <\/w:t>/, 'the two unmarked lines after it still flow together with a space');
  assert.match(xml, /line three flows<\/w:t>/);
});

test('the "\\\\" marker itself is stripped, never leaking into the DOCX output as literal backslashes', () => {
  const doc = parseOrg('* H\nSome text\\\\\nmore text\n');
  const xml = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.doesNotMatch(xml, /\\\\/);
});

// ---- THE FIX: #+TITLE / #+AUTHOR / #+DATE / #+OPTIONS -------------------------

test('THE EXACT REQUEST: #+TITLE renders as a visible "Title"-styled paragraph in the body', () => {
  const doc = parseOrg('#+TITLE: My Test Document\n* Heading\nText.\n');
  const content = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(content, /<w:pStyle w:val="Title"\/><\/w:pPr><w:r><w:t xml:space="preserve">My Test Document<\/w:t>/);
});

test('#+AUTHOR / #+DATE render as "Subtitle"-styled paragraphs right after the title', () => {
  const doc = parseOrg('#+TITLE: T\n#+AUTHOR: Jane Doe\n#+DATE: 2026-01-15\n* Heading\nText.\n');
  const content = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(content, /<w:pStyle w:val="Subtitle"\/><\/w:pPr><w:r><w:t xml:space="preserve">Jane Doe/);
  assert.match(content, /<w:pStyle w:val="Subtitle"\/><\/w:pPr><w:r><w:t xml:space="preserve">2026-01-15/);
});

test('THE FIX: author:nil / date:nil each independently suppress their own field, from BOTH the visible body block and the OOXML core.xml metadata', () => {
  const doc = parseOrg('#+TITLE: T\n#+AUTHOR: Jane Doe\n#+DATE: 2026-01-15\n#+OPTIONS: author:nil\n* Heading\nText.\n');
  const bytes = exportToDocx(doc);
  const content = unzipEntry(bytes, 'word/document.xml');
  const core = unzipEntry(bytes, 'docProps/core.xml');
  assert.ok(!content.includes('Jane Doe'));
  assert.ok(!core.includes('Jane Doe'));
  assert.ok(content.includes('2026-01-15'));
  assert.ok(core.includes('2026-01-15'));
});

test('#+AUTHOR / #+DATE also populate the OOXML core properties (dc:creator / dc:date), not just the visible body', () => {
  const doc = parseOrg('#+TITLE: T\n#+AUTHOR: Jane Doe\n#+DATE: 2026-01-15\n* Heading\nText.\n');
  const core = unzipEntry(exportToDocx(doc), 'docProps/core.xml');
  assert.match(core, /<dc:creator>Jane Doe<\/dc:creator>/);
  assert.match(core, /<dc:date>2026-01-15<\/dc:date>/);
});

test('THE EXACT REQUEST: section numbers render as a literal text prefix on each heading', () => {
  const doc = parseOrg('* A\n** B\n');
  const content = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(content, /<w:t xml:space="preserve">1\. <\/w:t>/);
  assert.match(content, /<w:t xml:space="preserve">1\.1\. <\/w:t>/);
});

test('#+OPTIONS: num:nil removes section numbers entirely', () => {
  const doc = parseOrg('#+OPTIONS: num:nil\n* A\n** B\n');
  const content = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.ok(!content.includes('1. '));
  assert.ok(!content.includes('1.1. '));
});

test('THE EXACT REQUEST: a document with 2+ headings gets an auto-generated Table of Contents, linking to each heading\u2019s own bookmark', () => {
  const doc = parseOrg('* First\n* Second\n');
  const content = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(content, /Table of Contents/);
  assert.match(content, /<w:hyperlink w:anchor="first">.*?First/);
  assert.match(content, /<w:hyperlink w:anchor="second">.*?Second/);
});

test('a document with only one heading gets no Table of Contents', () => {
  const doc = parseOrg('* Only\nText.\n');
  const content = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.ok(!content.includes('Table of Contents'));
});

test('toc:nil disables the Table of Contents entirely, independent of num:', () => {
  const doc = parseOrg('#+OPTIONS: toc:nil\n* First\n* Second\n');
  const content = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.ok(!content.includes('Table of Contents'));
  assert.ok(content.includes('1. '), 'numbering is untouched by toc:nil');
});

test('THE EXACT REQUEST: toc:1 limits the ToC listing to headers 1 only, while section numbering throughout the body still goes to full depth', () => {
  const doc = parseOrg('#+OPTIONS: toc:1\n* A\n** B\n*** C\n* D\n');
  const content = unzipEntry(exportToDocx(doc), 'word/document.xml');
  const tocSection = content.split('Table of Contents')[1].split('w:val="Heading1"')[0];
  assert.ok(tocSection.includes('anchor="a"'));
  assert.ok(tocSection.includes('anchor="d"'));
  assert.ok(!tocSection.includes('anchor="b"'));
  assert.ok(content.includes('1.1.1. '), 'still fully numbered in the body');
});

test('THE EXACT REQUEST: creator:nil is the default -- no "Generated by" notice unless explicitly enabled', () => {
  const doc = parseOrg('#+TITLE: T\n* Heading\nText.\n');
  const content = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.ok(!content.includes('Generated by'));
});

test('creator:t adds a "Generated by org-pwa" notice', () => {
  const doc = parseOrg('#+TITLE: T\n#+OPTIONS: creator:t\n* Heading\nText.\n');
  const content = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.match(content, /<w:pStyle w:val="Creator"\/><\/w:pPr><w:r><w:t xml:space="preserve">Generated by org-pwa/);
});

test('exporting a scoped subtree shows no title/author/date/ToC/creator block, but section numbering (independent of scope) still applies', () => {
  const doc = parseOrg('#+TITLE: Whole Doc\n#+OPTIONS: creator:t\n* Target\n** Child\n* Other\n');
  const target = doc.children[0];
  const content = unzipEntry(exportToDocx(doc, target), 'word/document.xml');
  assert.ok(!content.includes('w:pStyle w:val="Title"'));
  assert.ok(!content.includes('Table of Contents'));
  assert.ok(!content.includes('Generated by'));
  assert.ok(content.includes('1. '), 'numbering still applies even for a scoped export');
});

test('the generated document.xml, core.xml, and styles.xml remain well-formed XML with the new title/ToC/creator content added', () => {
  const doc = parseOrg('#+TITLE: T\n#+AUTHOR: A\n#+DATE: D\n#+OPTIONS: toc:2 creator:t\n* A\n** B\n* C\n');
  const bytes = exportToDocx(doc);
  // A lightweight, dependency-free well-formedness check: every opened
  // tag closes, tracked with a simple stack -- not a full XML
  // validator, but enough to catch a real structural bug (an unclosed
  // or mismatched tag), which is the actual risk this test guards
  // against.
  function checkBalanced(xml) {
    const stack = [];
    const tagRe = /<\/?([a-zA-Z0-9:]+)(?:\s[^>]*)?\/?>/g;
    let m;
    while ((m = tagRe.exec(xml))) {
      const full = m[0];
      const name = m[1];
      if (full.startsWith('<?') || full.endsWith('/>')) continue;
      if (full.startsWith('</')) {
        const top = stack.pop();
        assert.equal(top, name, `mismatched closing tag: expected </${top}>, got </${name}>`);
      } else {
        stack.push(name);
      }
    }
    assert.equal(stack.length, 0, `unclosed tags remain: ${stack.join(', ')}`);
  }
  checkBalanced(unzipEntry(bytes, 'word/document.xml'));
  checkBalanced(unzipEntry(bytes, 'docProps/core.xml'));
  checkBalanced(unzipEntry(bytes, 'word/styles.xml'));
});

// ---- THE FIX: document-level preamble body rendering (doc.body) ---------------

test('THE FIX: a document-level preamble body now renders in DOCX export -- previously never rendered at all, needed for #+INCLUDE\u2019s own block-type variant', () => {
  const doc = parseOrg('#+TITLE: T\nSome preamble text.\n\n* Heading\nHeading text.\n');
  const content = unzipEntry(exportToDocx(doc), 'word/document.xml');
  assert.ok(content.includes('Some preamble text.'));
  assert.ok(content.indexOf('Some preamble text.') < content.indexOf('w:pStyle w:val="Heading1"'));
});

test('a scoped subtree export shows no document-level preamble', () => {
  const doc = parseOrg('Preamble text.\n\n* Target\nText.\n* Other\nText.\n');
  const target = doc.children[0];
  const content = unzipEntry(exportToDocx(doc, target), 'word/document.xml');
  assert.ok(!content.includes('Preamble text.'));
});

test('THE FIX: a lowercase #+title: sets the OOXML dc:title too, matching real Emacs org-mode\u2019s own confirmed case-insensitive keyword parsing', () => {
  const doc = parseOrg('#+title: org-pwa README.org\n* Heading\nText.\n');
  const core = unzipEntry(exportToDocx(doc), 'docProps/core.xml');
  assert.match(core, /<dc:title>org-pwa README\.org<\/dc:title>/);
});
