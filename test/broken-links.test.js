import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { exportToAscii } from '../src/export-ascii.js';
import { exportToHtml } from '../src/export-html.js';
import { exportToLatex } from '../src/export-latex.js';
import { exportToMarkdown } from '../src/export-markdown.js';
import { exportToOdt } from '../src/export-odt.js';
import { getExportWithBrokenLinks } from '../src/local-variables.js';
import { brokenLinkPath } from '../src/broken-links.js';
import { inflateRawSync } from 'node:zlib';

// Expected texts are what Emacs 29.3 writes (org-export-with-broken-links nil, t and mark) for these two files.
const MIXED = '#+TITLE: T\n* H\n:PROPERTIES:\n:CUSTOM_ID: here\n:END:\nSee [[*Nope]] and [[Nope Fuzzy][desc]] then [[#here]].\n';
const CODEREF = '#+TITLE: T\n* H\nA [[(zz)]] b [[(zz)][see (zz)]].\n';

/** Text of content.xml from the stored or deflated entry of an .odt. @param {Uint8Array} zip */
function contentXml(zip) {
  const buf = Buffer.from(zip);
  let at = 0;
  while (at < buf.length - 30 && buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8);
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extraLen = buf.readUInt16LE(at + 28);
    const name = buf.toString('utf8', at + 30, at + 30 + nameLen);
    const data = buf.subarray(at + 30 + nameLen + extraLen, at + 30 + nameLen + extraLen + size);
    if (name === 'content.xml') return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    at += 30 + nameLen + extraLen + size;
  }
  throw new Error('no content.xml');
}

const exporters = {
  html: (doc, brokenLinks) => exportToHtml(doc, null, { defaults: { brokenLinks } }),
  ascii: (doc, brokenLinks) => exportToAscii(doc, null, 72, { brokenLinks }),
  markdown: (doc, brokenLinks) => exportToMarkdown(doc, null, { brokenLinks }),
  latex: (doc, brokenLinks) => exportToLatex(doc, null, { defaults: { brokenLinks } }),
  odt: (doc, brokenLinks) => contentXml(exportToOdt(doc, null, { brokenLinks })),
};

test('a link that leads nowhere stops every export by default, with Emacs\'s message', () => {
  const doc = parseOrg(MIXED);
  for (const [name, run] of Object.entries(exporters)) assert.throws(() => run(doc, 'nil'), { message: 'Unable to resolve link: "*Nope"' }, name);
  assert.throws(() => exporters.html(parseOrg('* H\n[[#nope]]\n'), 'nil'), { message: 'Unable to resolve link: "nope"' });
  assert.throws(() => exporters.html(parseOrg('* H\n[[id:abc-123]]\n'), 'nil'), { message: 'Unable to resolve link: "abc-123"' });
  assert.throws(() => exporters.html(parseOrg('* H\n[[(zz)]]\n'), 'nil'), { message: 'Unable to resolve link: "zz"' });
});

test('t leaves the link out, with the blanks after it', () => {
  const doc = parseOrg(MIXED);
  assert.match(exporters.html(doc, 't'), /<p>\nSee and then <a href="#here">1<\/a>\.\n<\/p>/);
  assert.match(exporters.markdown(doc, 't'), /\nSee and then \[1\]\(/);
  assert.match(exporters.latex(doc, 't'), /\nSee and then \\ref\{sec:org[0-9a-f]+\}\.\n/);
  assert.match(exporters.ascii(doc, 't'), /\n {2}See and then 1\.\n/);
  assert.match(exporters.odt(doc, 't'), /<text:p [^>]*>See and then <text:bookmark-ref /);
  const refs = parseOrg(CODEREF);
  assert.match(exporters.html(refs, 't'), /<p>\nA b \.\n<\/p>/);
  assert.match(exporters.markdown(refs, 't'), /\nA b \.\n/);
  assert.match(exporters.latex(refs, 't'), /\nA b \.\n/);
  assert.match(exporters.ascii(refs, 't'), /\n {2}A b \.\n/);
});

test('mark writes [BROKEN LINK: path] where the link was', () => {
  const doc = parseOrg(MIXED);
  assert.match(exporters.html(doc, 'mark'), /<p>\nSee \[BROKEN LINK: \*Nope\] and \[BROKEN LINK: Nope Fuzzy\] then <a href="#here">1<\/a>\.\n<\/p>/);
  assert.match(exporters.markdown(doc, 'mark'), /\nSee \[BROKEN LINK: \\\*Nope\] and \[BROKEN LINK: Nope Fuzzy\] then \[1\]\(/);
  assert.match(exporters.latex(doc, 'mark'), /\nSee \[BROKEN LINK: \*Nope\] and \[BROKEN LINK: Nope Fuzzy\] then \\ref\{/);
  assert.match(exporters.odt(doc, 'mark'), /See \[BROKEN LINK: \*Nope\] and \[BROKEN LINK: Nope Fuzzy\] then <text:bookmark-ref /);
  const refs = parseOrg(CODEREF);
  const marked = 'A [BROKEN LINK: zz] b [BROKEN LINK: zz].';
  assert.ok(exporters.html(refs, 'mark').includes('<p>\n' + marked + '\n</p>'));
  for (const name of ['markdown', 'latex']) assert.ok(exporters[name](refs, 'mark').includes('\n' + marked + '\n'), name);
  assert.ok(exporters.ascii(refs, 'mark').includes('\n  ' + marked + '\n'));
});

test('ASCII: a broken link with a description, found when the links are listed, replaces its whole headline (as in ox-ascii)', () => {
  const out = exporters.ascii(parseOrg(MIXED), 'mark');
  assert.ok(out.endsWith('1. H\n\n\n[BROKEN LINK: Nope Fuzzy]\n'), out);
  assert.ok(!out.includes('See '));
});

test('a file\'s #+OPTIONS: broken-links: wins over the variable', () => {
  const doc = parseOrg('#+OPTIONS: broken-links:mark\n* H\n[[Nowhere]]\n');
  assert.match(exporters.html(doc, 'nil'), /\[BROKEN LINK: Nowhere\]/);
  assert.match(exporters.ascii(doc, 'nil'), /\[BROKEN LINK: Nowhere\]/);
  assert.match(exporters.markdown(doc, 'nil'), /\[BROKEN LINK: Nowhere\]/);
  assert.match(exporters.latex(doc, 'nil'), /\[BROKEN LINK: Nowhere\]/);
  assert.match(exporters.odt(doc, 'nil'), /\[BROKEN LINK: Nowhere\]/);
});

test('org-export-with-broken-links reads nil, t and mark, a quote in front is fine, anything else is nil', () => {
  assert.equal(getExportWithBrokenLinks({}), 'nil');
  assert.equal(getExportWithBrokenLinks({ 'org-export-with-broken-links': 't' }), 't');
  assert.equal(getExportWithBrokenLinks({ 'org-export-with-broken-links': "'mark" }), 'mark');
  assert.equal(getExportWithBrokenLinks({ 'org-export-with-broken-links': 'whatever' }), 'nil');
});

test('links that are fine are not broken: headings, targets, custom ids, names, URLs and files', () => {
  const doc = parseOrg('* Head\n:PROPERTIES:\n:CUSTOM_ID: cid\n:END:\nA <<tgt>> here.\n');
  for (const ok of ['*Head', 'Head', '#cid', 'tgt', 'https://example.org', 'file:x.org', './x.org', 'mailto:a@b.c']) assert.equal(brokenLinkPath(doc, ok), null, ok);
  assert.equal(brokenLinkPath(doc, '*Nope'), '*Nope');
  assert.equal(brokenLinkPath(doc, '#nope'), 'nope');
  assert.equal(brokenLinkPath(doc, 'id:x-1'), 'x-1');
  assert.equal(brokenLinkPath(doc, 'Nope'), 'Nope');
  assert.equal(brokenLinkPath(doc, 'some', (n) => n === 'some'), null);
});

test('ODT: a numbered block is a list that continues numbering, and a reference is its line number (as ox-odt)', () => {
  const doc = parseOrg('* H\n#+begin_src python -n 5 -k\na = 1 (ref:one)\nb = 2\nc = 3 (ref:three)\n#+end_src\nSee [[(three)]] and [[(one)][here]].\n\n#+begin_src python +n -k\nd = 4\n#+end_src\n#+begin_example -n -r\nx (ref:ex)\ny\n#+end_example\nAlso [[(ex)]].\n');
  const xml = exporters.odt(doc, 'nil');
  assert.equal([...xml.matchAll(/<text:list text:style-name="OrgSrcBlockNumberedLine" text:continue-numbering="(\w+)">/g)].map((m) => m[1]).join(), 'true,true,false');
  assert.ok(xml.includes('<text:bookmark-start text:name="OrgXref.coderef-one"/><text:bookmark text:name="coderef-one"/>a = 1 (one)<text:bookmark-end text:name="OrgXref.coderef-one"/>'));
  assert.ok(xml.includes('See <text:bookmark-ref text:reference-format="number" text:ref-name="OrgXref.coderef-three">7</text:bookmark-ref> and here.'));
  assert.ok(xml.includes('Also <text:bookmark-ref text:reference-format="number" text:ref-name="OrgXref.coderef-ex">1</text:bookmark-ref>.'));
  assert.equal((xml.match(/<text:list-item>/g) || []).length, 6);
});
