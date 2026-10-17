import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_DEFAULT_ITEMS, countExportItemsOn, decodeExportText, encodeExportText, encodeLispString, htmlExportDefaults, migrateRetiredVariables } from '../src/export-defaults.js';
import { exportToHtml } from '../src/export-html.js';
import { parseOrg } from '../src/org-parser.js';

const doc = (text) => parseOrg(text);

test('nothing is applied until it is switched on, and the text offered is the default', () => {
  assert.deepEqual(htmlExportDefaults({}), {});
  assert.deepEqual(htmlExportDefaults({ 'org-html-preamble': '"%t : %s"' }), { preamble: '%t : %s' });
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

test("Org's own org-html-head, org-html-preamble and org-html-postamble variables set the defaults", () => {
  assert.deepEqual(htmlExportDefaults({ 'org-html-head': '"<style>p{}</style>"', 'org-html-preamble': '"%t by %a"', 'org-html-postamble': '"Made %d"' }), { head: '<style>p{}</style>', preamble: '%t by %a', postamble: 'Made %d' });
  assert.deepEqual(htmlExportDefaults({ 'org-html-postamble': 'nil' }), { postamble: false });
  assert.deepEqual(htmlExportDefaults({ 'org-html-postamble': 'auto', 'org-html-preamble': 't', 'org-html-head': 'nil' }), {});
  assert.deepEqual(htmlExportDefaults({ 'org-xx-html-preamble': 'old', 'org-xx-html-preamble-on': 't' }), {}, 'the retired variables do nothing');
  assert.ok(!exportToHtml(doc('* A\nbody\n'), null, { defaults: htmlExportDefaults({ 'org-html-postamble': 'nil' }) }).includes('class="postamble"'));
  assert.ok(exportToHtml(doc('* A\nbody\n'), null, { defaults: htmlExportDefaults({ 'org-html-postamble': '"Made by me"' }) }).includes('Made by me'));
});

test('a text is written as the quoted Lisp string Org reads, and read back', () => {
  const text = 'a "b" \\ c\nd';
  assert.deepEqual(htmlExportDefaults({ 'org-html-preamble': encodeLispString(text) }), { preamble: text });
});

test('the retired org-xx-html-* and org-xx-babel-js variables move onto Org\'s own, once', () => {
  assert.equal(migrateRetiredVariables({ 'org-todo-keywords': 'x' }), null);
  assert.deepEqual(
    migrateRetiredVariables({ 'org-xx-html-preamble': 'Hi\\n%a', 'org-xx-html-preamble-on': 't', 'org-xx-html-postamble': 'kept but off', 'org-xx-html-head-on': 't', 'org-xx-babel-js': 'on', 'org-xx-page-footer': 'f' }),
    { 'org-html-preamble': '"Hi\\n%a"', 'org-html-head': encodeLispString(EXPORT_DEFAULT_ITEMS[2].text), 'org-babel-load-languages': '((emacs-lisp . t) (js . t))', 'org-xx-page-footer': 'f' }
  );
  assert.deepEqual(migrateRetiredVariables({ 'org-xx-html-preamble': 'old', 'org-xx-html-preamble-on': 't', 'org-html-preamble': '"mine"', 'org-xx-babel-js': 'off' }), { 'org-html-preamble': '"mine"' });
});
