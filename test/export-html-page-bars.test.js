// Header and footer on every printed page (page-header: / page-footer: in #+OPTIONS), written as @page margin boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { exportToHtml } from '../src/export-html.js';

const css = (opts, head = '#+TITLE: Report *1*\n#+AUTHOR: Estes\n#+DATE: 2026-10-12') => {
  const html = exportToHtml(parseOrg(`${head}\n#+OPTIONS: ${opts}\n* H\nbody\n`), null, {});
  return (/@page \{ margin: 2cm;[^}]*(?:\}[^}]*)*?\}\s*<\/style>/.exec(html) || [''])[0] || html;
};

test('a footer of three parts puts them left, centre and right, with the page number and the page count as counters', () => {
  const out = css('page-footer:"%a | %t | Page %p of %P"');
  assert.match(out, /@bottom-left \{ content: "Estes";/);
  assert.match(out, /@bottom-center \{ content: "Report 1";/);
  assert.match(out, /@bottom-right \{ content: "Page " counter\(page\) " of " counter\(pages\);/);
});

test('one part is the centre, two are left and right, and a header goes along the top', () => {
  assert.match(css('page-footer:"%p"'), /@bottom-center \{ content: counter\(page\);/);
  const two = css('page-header:"Draft | %d"');
  assert.match(two, /@top-left \{ content: "Draft";/);
  assert.match(two, /@top-right \{ content: "2026-10-12";/);
});

test('quotes and backslashes in the text are escaped, and an empty part stays empty', () => {
  const out = css('page-footer:"say \\"hi\\" | | x"');
  assert.match(out, /@bottom-left \{ content: "say \\"hi\\"";/);
  assert.match(out, /@bottom-center \{ content: "";/);
});

test('with neither option the page gets no margin boxes', () => {
  const html = exportToHtml(parseOrg('#+TITLE: T\n* H\nbody\n'), null, {});
  assert.doesNotMatch(html, /@bottom-|@top-/);
});
