import test from 'node:test';
import assert from 'node:assert/strict';
import { countExportItemsOn, decodeExportText, encodeExportText, htmlExportDefaults } from '../src/export-defaults.js';
import { exportToHtml } from '../src/export-html.js';
import { parseOrg } from '../src/org-parser.js';

const doc = (text) => parseOrg(text);

test('nothing is applied until it is switched on, and the text offered is the default', () => {
  assert.deepEqual(htmlExportDefaults({}), {});
  assert.deepEqual(htmlExportDefaults({ 'org-xx-html-preamble-on': 't' }), { preamble: '%t : %s' });
  assert.equal(countExportItemsOn({ 'org-xx-page-footer-on': 't' }, ['pageHeader', 'pageFooter']), 1);
});

test('text with new lines survives a one-line Global Variable', () => {
  const t = '<style>\n  a { b: c }\n</style>\\n';
  assert.equal(decodeExportText(encodeExportText(t)), t);
});

test('the defaults reach the page, and the file wins', () => {
  const defaults = { preamble: 'PRE %t', postamble: 'POST %a', head: '<style>/*mine*/</style>', pageFooter: 'F %p' };
  const plain = exportToHtml(doc('#+TITLE: T\n#+AUTHOR: Ann\n* A\n'), null, { defaults });
  assert.match(plain, /PRE T/);
  assert.match(plain, /POST Ann/);
  assert.match(plain, /\/\*mine\*\//);
  assert.match(plain, /counter\(page\)/);
  const own = exportToHtml(doc('#+TITLE: T\n#+AUTHOR: Ann\n#+OPTIONS: html-preamble:"FILE %t" html-postamble:nil\n* A\n'), null, { defaults });
  assert.match(own, /FILE T/);
  assert.doesNotMatch(own, /PRE T/);
  assert.doesNotMatch(own, /POST Ann/);
  assert.doesNotMatch(exportToHtml(doc('* A\n'), null), /PRE|counter\(page\)/);
});

test("Org's own org-html-head, org-html-preamble and org-html-postamble variables set the defaults; an item switched on wins", () => {
  assert.deepEqual(htmlExportDefaults({ 'org-html-head': '"<style>p{}</style>"', 'org-html-preamble': '"%t by %a"', 'org-html-postamble': '"Made %d"' }), { head: '<style>p{}</style>', preamble: '%t by %a', postamble: 'Made %d' });
  assert.deepEqual(htmlExportDefaults({ 'org-html-postamble': 'nil' }), { postamble: false });
  assert.deepEqual(htmlExportDefaults({ 'org-html-postamble': 'auto', 'org-html-preamble': 't', 'org-html-head': 'nil' }), {});
  assert.deepEqual(htmlExportDefaults({ 'org-html-preamble': '"mine"', 'org-xx-html-preamble': 'ours', 'org-xx-html-preamble-on': 't' }), { preamble: 'ours' });
  assert.ok(!exportToHtml(doc('* A\nbody\n'), null, { defaults: htmlExportDefaults({ 'org-html-postamble': 'nil' }) }).includes('class="postamble"'));
  assert.ok(exportToHtml(doc('* A\nbody\n'), null, { defaults: htmlExportDefaults({ 'org-html-postamble': '"Made by me"' }) }).includes('Made by me'));
});
