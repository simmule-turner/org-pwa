import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { exportToHtml } from '../src/export-html.js';
import { doctypeInfo } from '../src/html-doctype.js';
import { htmlExportDefaults } from '../src/export-defaults.js';
import { doctypeParts, DOCTYPE_NAMES } from './support/doctype-parts.mjs';

// test/fixtures/html-doctype/emacs.json holds what Emacs 29.3 (ox-html) writes for the parts #+HTML_DOCTYPE: controls
// (tools/gen-doctype-oracle.mjs makes it); the rest of the page is the app's own.
const dir = new URL('./fixtures/html-doctype/', import.meta.url);
const sample = fs.readFileSync(new URL('sample.org', dir), 'utf8');
const emacs = JSON.parse(fs.readFileSync(new URL('emacs.json', dir), 'utf8'));

for (const name of DOCTYPE_NAMES) {
  test(`#+HTML_DOCTYPE: ${name} changes the page as it does in Emacs`, () => {
    const html = exportToHtml(parseOrg(sample.replace('DT', name)));
    assert.deepEqual(doctypeParts(html), emacs[name]);
  });
  test(`org-html-doctype ${name} is read when the file names none`, () => {
    const html = exportToHtml(parseOrg(sample.replace(/^#\+HTML_DOCTYPE:.*\n/m, '')), null, { defaults: htmlExportDefaults({ 'org-html-doctype': `"${name}"` }) });
    assert.deepEqual(doctypeParts(html), emacs[name]);
  });
}

test('with no doctype given the page is xhtml-strict, as in Emacs', () => {
  const html = exportToHtml(parseOrg(sample.replace(/^#\+HTML_DOCTYPE:.*\n/m, '')));
  assert.deepEqual(doctypeParts(html), emacs['xhtml-strict']);
});

test('a literal declaration is written as it is, and html5 is told from its lower-case form', () => {
  const info = doctypeInfo('<!DOCTYPE html>');
  assert.equal(info.declaration, '<!DOCTYPE html>');
  assert.equal(info.html5, true);
  assert.equal(info.xhtml, false);
  assert.equal(doctypeInfo('<!DOCTYPE html PUBLIC "x">').html5, false);
});
