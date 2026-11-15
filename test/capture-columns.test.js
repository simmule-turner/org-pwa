// A capture that adds a row to a table recalculates it as Emacs 29.3 does, with org-table-formula-create-columns as set:
// test/fixtures/capture-columns-oracle.json was made by tools/gen-capture-columns-oracle.mjs. `prompt` is treated as nil (test/support/capture-known.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { fileCapture, resolveOlpTarget } from '../src/capture-template.js';
import { captureRecalculator } from '../src/capture-run.js';
import { parseGlobalVariables } from '../src/global-variables.js';
import { CAPTURE_KNOWN } from './support/capture-known.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/capture-columns-oracle.json', import.meta.url), 'utf8'));
const squeeze = (/** @type {string} */ s) => s.replace(/ +\|/g, '|').replace(/\| +/g, '|');

/** @param {string} init @param {string} value @param {string} template */
function file(init, value, template) {
  const doc = parseOrg(init);
  /** @type {string[]} */
  const warnings = [];
  const vars = value === 'nil' ? {} : parseGlobalVariables(`(setq org-table-formula-create-columns ${value === 't' ? 't' : `'${value}`})`);
  const target = resolveOlpTarget(doc, ['Tr'], { allowCreate: false });
  fileCapture(doc, target, 'table-line', template, false, { recalculate: captureRecalculator(doc, vars, (m) => warnings.push(m)) });
  return { text: serializeOrg(doc), warnings };
}

test('a captured row is calculated with the columns the setting allows, as in Emacs', () => {
  const wrong = [];
  for (const c of oracle.cases) {
    if (c.emacs.startsWith('ERROR')) {
      assert.ok(CAPTURE_KNOWN.columns.some((k) => k.create === c.create), `${c.create} error is a known deviation`);
      continue;
    }
    const got = file(c.init, c.create, c.template);
    if (squeeze(got.text) !== squeeze(c.emacs)) wrong.push({ init: c.init, create: c.create, got: got.text, want: c.emacs });
    const warned = c.messages.some((m) => /Out-of-bounds formula added columns/.test(m));
    if (warned !== (got.warnings.length > 0)) wrong.push({ init: c.init, create: c.create, warnings: got.warnings, want: c.messages });
  }
  assert.equal(wrong.length, 0, JSON.stringify(wrong, null, 1));
});

test('prompt in a capture counts as nil', () => {
  const init = '* Tr\n| a |\n|---|\n| 1 |\n#+TBLFM: @2$3=7\n';
  const asked = file(init, 'prompt', '| 5 |');
  const refused = file(init, 'nil', '| 5 |');
  assert.equal(asked.text, refused.text);
  assert.deepEqual(asked.warnings, []);
});
