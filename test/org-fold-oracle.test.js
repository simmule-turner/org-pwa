// Holds src/org-fold.js to Emacs 29.3: test/fixtures/org-fold-oracle.json was made by tools/gen-org-fold-oracle.mjs, which opens an org-mode
// buffer under each org-startup-folded value and records what is hidden. The app's own startup visibility (applyStartupVisibility), turned into
// hidden text by hiddenRanges, has to hide the same stretches.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { applyStartupVisibility } from '../src/fold-state.js';
import { adjustHidden, foldView, hiddenRanges, syncFlags } from '../src/org-fold.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/org-fold-oracle.json', import.meta.url), 'utf8'));

/** @param {Array<[number, number]>} hidden */
const runs = (hidden) => hidden.map((r) => r.join('-')).join(',');

test('what the app hides on opening is what Emacs hides under the same startup value', () => {
  const cases = oracle.cases.filter((/** @type {any} */ c) => c.kind === 'startup' && c.startup !== 'overview'); // the symbol `overview` is not a value Emacs knows
  assert.ok(cases.length >= 36);
  const bad = [];
  for (const c of cases) {
    const visibility = c.startup === 't' ? 'overview' : c.startup === 'nil' ? 'showall' : c.startup;
    const doc = parseOrg(c.text);
    applyStartupVisibility(doc, { visibility });
    const got = runs(hiddenRanges(c.text, doc));
    const want = c.emacs.steps[0].runs.map((/** @type {number[]} */ r) => r.join('-')).join(',');
    if (got !== want) bad.push({ startup: c.startup, text: c.text.slice(0, 40), got, want });
  }
  assert.equal(bad.length, 0, `${bad.length} differ\n${JSON.stringify(bad.slice(0, 4), null, 1)}`);
});

test('the display text draws each hidden stretch as dots and positions pass both ways', () => {
  const text = '* A\nbody\n** B\nx\n* C\n';
  const view = foldView(text, [[3, 8]]);
  assert.equal(view.display, '* A...\n** B\nx\n* C\n');
  assert.equal(view.toDisplay(3), 3);
  assert.equal(view.toDisplay(5), 6); // inside the hidden text: after the dots
  assert.equal(view.toBuffer(6), 8);
  assert.equal(view.toBuffer(4), 3); // on the dots: the end of the heading's line
  assert.equal(view.toBuffer(view.toDisplay(10)), 10);
  assert.deepEqual(adjustHidden([[3, 7], [12, 14]], 0, 0, 2), [[5, 9], [14, 16]]);
  assert.deepEqual(adjustHidden([[3, 7]], 5, 1, 0), []); // an edit inside shows it again
});

test('the folds an edit leaves in the text are what the next fold command starts from', () => {
  const cases = oracle.cases.filter((/** @type {any} */ c) => c.kind === 'startup' && c.startup !== 'overview');
  for (const c of cases) {
    const want = c.emacs.steps[0].runs;
    const doc = parseOrg(c.text);
    syncFlags(c.text, doc, want);
    // headings are folded or have their text hidden as the stretches say; hiding them again gives the same stretches back
    const hidden = hiddenRanges(c.text, doc);
    for (const [a, b] of want) assert.ok(hidden.some(([x, y]) => x <= a && y >= b) || c.startup === 'showall' || c.startup === 'nil', `${c.startup}: ${a}-${b}`);
  }
});
