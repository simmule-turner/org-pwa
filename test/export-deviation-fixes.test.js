// Each expectation was read from Emacs 29.3 (ox-ascii, ox-html, org-element) for the same Org text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { exportToAscii } from '../src/export-ascii.js';
import { exportToHtml } from '../src/export-html.js';

const ascii = (text) => exportToAscii(parseOrg(`#+OPTIONS: toc:nil\n${text}\n`)).replace(/\s+$/, '');
const html = (text) => exportToHtml(parseOrg(`#+OPTIONS: toc:nil\n${text}\n`));

test('headings need a space after the stars, and a keyword needs a space after it', () => {
  assert.equal(parseOrg('*\ttab heading\n').children.length, 0);
  const [bare] = parseOrg('* TODO\n').children;
  assert.deepEqual([bare.todo, bare.title], [null, 'TODO']);
  const [spaced] = parseOrg('* TODO \n').children;
  assert.deepEqual([spaced.todo, spaced.title], ['TODO', '']);
});

test('ASCII: inline source code prints as verbatim text and an inline call prints nothing', () => {
  assert.equal(ascii('src_js{1+1} and call_x()'), "`1+1' and");
});

test('ASCII: a table with several rules draws one rule across; any row starting with |- is a rule', () => {
  assert.equal(ascii('| a | b |\n|---|---|\n| 1 | 2 |\n|---|---|\n| 3 | 4 |'), ' a  b \n------\n 1  2 \n------\n 3  4');
});

test('ASCII: only numbered bullets are counted in an ordered list', () => {
  assert.equal(ascii('1. num\n- dash\n+ plus'), '1. num\n- dash\n+ plus');
});

test('HTML: a time range is two timestamps, spaces in a URL are encoded, an inline call prints nothing', () => {
  assert.match(html('<2026-03-04 Wed 10:00-11:00>'), /&lt;2026-03-04 Wed 10:00&gt;&#x2013;&lt;2026-03-04 Wed 11:00&gt;/);
  assert.match(html('[[https://a.com/a b][space]]'), /href="https:\/\/a\.com\/a%20b"/);
  assert.match(html('src_js{1+1} and call_x()'), /<code class="src src-js">1\+1<\/code> and\s*<\/p>/);
});

test("HTML: #+OPTIONS: ':t makes smart quotes", () => {
  assert.match(html('#+OPTIONS: \':t\n"quoted" and it\'s'), /&ldquo;quoted&rdquo; and it&rsquo;s/);
});
