// A capture that adds a row to a table recalculates it as Emacs 29.3 does, with org-table-formula-create-columns as set:
// test/fixtures/capture-columns-oracle.json was made by tools/gen-capture-columns-oracle.mjs. `prompt` is treated as nil (test/support/capture-known.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { fileCapture, resolveOlpTarget } from '../src/capture-template.js';
import { captureRecalculator } from '../src/capture-run.js';
import { parseGlobalVariables } from '../src/global-variables.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/capture-columns-oracle.json', import.meta.url), 'utf8'));
const squeeze = (/** @type {string} */ s) => s.replace(/ +\|/g, '|').replace(/\| +/g, '|');

/** @param {string} init @param {string} value @param {string} template */
function file(init, value, template) {
  const doc = parseOrg(init);
  /** @type {string[]} */
  const warnings = [];
  const vars = value === 'nil' ? {} : parseGlobalVariables(`(setq org-table-formula-create-columns ${value === 't' ? 't' : `'${value}`})`);
  const target = resolveOlpTarget(doc, ['Tr'], { allowCreate: false });
  /** @type {string | null} */
  let aborted = null;
  try {
    fileCapture(doc, target, 'table-line', template, false, { recalculate: captureRecalculator(doc, vars, (m) => warnings.push(m)) });
  } catch (err) {
    aborted = /** @type {Error} */ (err).message; // the capture stops after the row is filed, as in Emacs
  }
  return { text: serializeOrg(doc), warnings, aborted };
}

test('a captured row is calculated with the columns the setting allows, as in Emacs', () => {
  const wrong = [];
  for (const c of oracle.cases) {
    const got = file(c.init, c.create, c.template);
    if (c.emacs.startsWith('ERROR')) {
      if (got.aborted !== c.emacs.replace(/^ERROR /, '')) wrong.push({ init: c.init, create: c.create, aborted: got.aborted, want: c.emacs });
      continue;
    }
    if (got.aborted) wrong.push({ init: c.init, create: c.create, aborted: got.aborted, want: c.emacs });
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
  assert.equal(asked.aborted, 'Missing columns in the table.  Aborting');
  assert.deepEqual(asked.warnings, []);
});

test('captureInto reports the stop and keeps the row, as Emacs leaves its buffer', async () => {
  const { captureInto } = await import('../src/capture-run.js');
  const doc = parseOrg('* Tr\n| a |\n|---|\n| 1 |\n#+TBLFM: @2$3=7\n');
  const template = /** @type {import('../src/types.js').CaptureTemplate} */ (/** @type {unknown} */ ({ key: 't', description: 't', type: 'table-line', template: '| 5 |', olp: ['Tr'] }));
  const result = captureInto(doc, template, { now: new Date(2026, 0, 1), context: {}, place: (d) => ({ recalculate: captureRecalculator(d, {}, () => {}) }) });
  assert.equal(result.ok && result.aborted, 'Missing columns in the table.  Aborting');
  assert.match(serializeOrg(doc), /\| 5 +\|/);
});
