// Holds a file+olp+datetree capture to Emacs: test/fixtures/capture-datetree-oracle.json was made by
// tools/gen-capture-datetree-oracle.mjs, which files each template with org-capture in Emacs 29.3.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { fileCapture, resolveOlpTarget } from '../src/capture-template.js';
import { recalculateTable } from '../src/table-formula.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/capture-datetree-oracle.json', import.meta.url), 'utf8'));
const squeeze = (/** @type {string} */ s) => s.replace(/ +\|/g, '|').replace(/\| +/g, '|'); // table padding is checked in capture-place-oracle

// Emacs adds the final newline to a file that lacked one; the app leaves the file's ending as it was (as it does for every capture).
const sameEnd = (/** @type {{ init: string }} */ c, /** @type {string} */ s) => (c.init !== '' && !c.init.endsWith('\n') ? s.replace(/\n$/, '') : s);
// Emacs files a prepended item (or check item) under the heading that FOLLOWS a day heading that has nothing in it; the app files it in the day.
const EMACS_DEFECT = (/** @type {{ type: string, opts: { prepend?: boolean } }} */ c, /** @type {string} */ want) => (c.type === 'item' || c.type === 'checkitem') && !!c.opts.prepend && /\d{4}-\d\d-\d\d \w+\n\n?\*+ /.test(want.replace(/\n[-+] [^\n]*(\n\n)?/, ''));

function file(c) {
  const doc = parseOrg(c.init);
  const [y, m, d] = c.ymd;
  const target = resolveOlpTarget(doc, c.olp, { now: new Date(y, m - 1, d, 12), datetree: true, treeType: c.opts.treeType });
  fileCapture(doc, target, c.type, c.template, !!c.opts.prepend, { ...c.opts, recalculate: (t) => recalculateTable(t, {}) });
  return serializeOrg(doc);
}

test('a capture under a date tree is filed where Emacs files it, headings and blank lines included', () => {
  const wrong = [];
  for (const c of oracle.cases) {
    let got;
    try {
      got = file(c);
    } catch (e) {
      got = 'ERROR ' + e.message;
    }
    if (EMACS_DEFECT(c, c.emacs)) continue;
    const ok = c.emacs.startsWith('ERROR') ? got.startsWith('ERROR') : squeeze(sameEnd(c, got)) === squeeze(sameEnd(c, c.emacs));
    if (!ok) wrong.push({ init: c.init, olp: c.olp, ymd: c.ymd, type: c.type, opts: c.opts, got, want: c.emacs });
  }
  assert.equal(wrong.length, 0, `${wrong.length} of ${oracle.cases.length}: ` + JSON.stringify(wrong.slice(0, 4), null, 1));
});

test('a date tree is not created when only looking', () => {
  const doc = parseOrg('* Journal\n');
  assert.equal(resolveOlpTarget(doc, ['Journal'], { now: new Date(2026, 10, 7, 12), datetree: true, allowCreate: false }), null);
  assert.equal(serializeOrg(doc), '* Journal\n');
});
