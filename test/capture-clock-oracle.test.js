// :clock-in, :clock-keep and :clock-resume against Emacs 29.3 (test/fixtures/capture-clock-oracle.json, made by tools/gen-capture-clock-oracle.mjs).
// The test runs at another time than Emacs did, so timestamps and durations are compared as placeholders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { captureTemplatesFromLisp } from '../src/capture-lisp.js';
import { captureInto } from '../src/capture-run.js';
import { clockCaptured } from '../src/capture-clock.js';
import { clockIn } from '../src/clock.js';

const oracle = JSON.parse(readFileSync(new URL('./fixtures/capture-clock-oracle.json', import.meta.url), 'utf8'));
const normal = (/** @type {string} */ text) => text.replace(/\[\d{4}-\d\d-\d\d [A-Za-z]{3} \d\d:\d\d\]/g, '[TS]').replace(/=> +\d+:\d\d/g, '=> D');
const NOW = new Date(2026, 10, 8, 21, 22);
const STAMP = '[2026-11-08 Sun 21:22]';

/** @param {any} c */
function run(c) {
  const lisp = `(setq org-capture-templates '(("x" "x" ${c.type} (file+headline "f.org" "Inbox") ${JSON.stringify(c.text)} ${c.flags})))`;
  const { templates } = captureTemplatesFromLisp(lisp);
  const doc = parseOrg(c.init);
  const find = (/** @type {string} */ title) => /** @type {any} */ (doc.children.find((h) => h.title === title));
  const prior = c.previous ? find(typeof c.previous === 'string' ? c.previous : 'Work') : null;
  if (prior) clockIn(prior, '[2026-11-08 Sun 20:00]', {});
  const r = captureInto(doc, templates[0], { now: NOW, answers: [], context: {}, place: () => ({}) });
  assert.ok(r.ok, JSON.stringify(r));
  const t = templates[0];
  if (t.clockIn && r.ok) {
    const heading = r.placed && 'level' in r.placed ? r.placed : r.target;
    clockCaptured(/** @type {any} */ (heading), prior, { keep: !!t.clockKeep, resume: !!t.clockResume }, STAMP, NOW, () => ({}));
  }
  return serializeOrg(doc);
}

test('a capture clocks in as Emacs does: the entry or the heading it went under, with or without a clock running, with :clock-keep and :clock-resume', () => {
  const wrong = [];
  for (const c of oracle.cases) {
    const got = normal(run(c));
    if (got !== normal(c.emacs)) wrong.push({ type: c.type, previous: c.previous, flags: c.flags, got, want: normal(c.emacs) });
  }
  assert.equal(wrong.length, 0, JSON.stringify(wrong.slice(0, 3), null, 1));
  assert.ok(oracle.cases.length > 50);
});
