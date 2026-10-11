import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { exportToAscii, normalizeAsciiCharset } from '../src/export-ascii.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/ascii/${name}`, import.meta.url), 'utf8');

/** Emacs pads centred lines with tabs, separates sections with two blank lines and trims nothing; none of that is content. */
const expandTabs = (line) => {
  let out = '';
  for (const ch of line) out += ch === '\t' ? ' '.repeat(8 - (out.length % 8)) : ch;
  return out;
};
const normalize = (text) => text.split('\n').map((l) => expandTabs(l).trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();

// blocks.*.txt were produced by Emacs 29.3: (org-export-as 'ascii nil nil nil '(:ascii-charset CHARSET)) on blocks.org.
for (const charset of ['ascii', 'latin1', 'utf-8']) {
  test(`ASCII export of blocks, entities and lists matches ox-ascii (${charset})`, () => {
    const ours = exportToAscii(parseOrg(fixture('blocks.org')), null, 72, { charset });
    assert.equal(normalize(ours), normalize(fixture(`blocks.${charset}.txt`)));
  });
}

test('normalizeAsciiCharset accepts the spellings Emacs and people use', () => {
  assert.equal(normalizeAsciiCharset("'utf-8"), 'utf-8');
  assert.equal(normalizeAsciiCharset('UTF8'), 'utf-8');
  assert.equal(normalizeAsciiCharset('iso-8859-1'), 'latin1');
  assert.equal(normalizeAsciiCharset('klingon'), 'ascii');
  assert.equal(normalizeAsciiCharset(undefined), 'ascii');
});

test('a no-break space is not a place to wrap and verbatim text is not substituted', () => {
  const out = exportToAscii(parseOrg('* H\nA\\nbsp\\nbsp\\nbsp B =\\alpha=\n'), null, 72, { charset: 'latin1' });
  assert.ok(out.includes('A\u00a0\u00a0\u00a0 B') || out.includes('A\u00a0\u00a0\u00a0 B'.replace(' B', ' B')));
  assert.ok(out.includes("`\\alpha'"));
});
