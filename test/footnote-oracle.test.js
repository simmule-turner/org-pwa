// Holds the footnote commands to Emacs: test/fixtures/footnote-oracle.json was made by tools/gen-footnote-oracle.mjs, which runs
// org-footnote-new, -normalize, -renumber-fn:N, -sort and -delete in Emacs 29.3 on a set of texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deleteFootnote, insertFootnote, normalizeFootnotes, renumberFootnotes, sortFootnotes } from '../src/footnotes.js';

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/footnote-oracle.json', import.meta.url), 'utf8'));

function run(c) {
  switch (c.op) {
    case 'normalize': return normalizeFootnotes(c.text, { section: c.section });
    case 'renumber': return renumberFootnotes(c.text).text;
    case 'sort': return sortFootnotes(c.text, { section: c.section });
    case 'delete': return deleteFootnote(c.text, c.label, { autoAdjust: c.autoAdjust }).text;
    default: {
      const r = insertFootnote(c.text, c.pos, c.label === '' ? null : c.label, { section: c.section, defineInline: c.defineInline, autoAdjust: c.autoAdjust });
      return r ? r.text : 'ERROR';
    }
  }
}

test('footnote commands leave the text Emacs leaves', () => {
  const wrong = [];
  for (const c of cases) {
    let got;
    try {
      got = run(c);
    } catch (e) {
      got = 'ERROR ' + e.message;
    }
    const ok = c.emacs.startsWith('ERROR') ? got.startsWith('ERROR') : got === c.emacs;
    if (!ok) wrong.push({ op: c.op, text: c.text, label: c.label, pos: c.pos, got, want: c.emacs });
  }
  assert.equal(wrong.length, 0, JSON.stringify(wrong.slice(0, 3), null, 1));
});
