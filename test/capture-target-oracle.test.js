// Holds where a template with a (file+regexp), (id) or (clock) target files its text: test/fixtures/capture-target-oracle.json was made
// by tools/gen-capture-target-oracle.mjs, which captures each template with org-capture in Emacs 29.3.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { captureTemplatesFromLisp } from '../src/capture-lisp.js';
import { captureInto } from '../src/capture-run.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/capture-target-oracle.json', import.meta.url), 'utf8'));
const q = (/** @type {string} */ s) => JSON.stringify(s);
const squeeze = (/** @type {string} */ s) => s.replace(/ +\|/g, '|').replace(/\| +/g, '|');

/** @param {any} c */
function file(c) {
  if (c.kind === 'prop') {
    const { templates } = captureTemplatesFromLisp(`(setq org-capture-templates '(("t" "T" ${c.type} (file+headline "f.org" "A") ${q(c.template)})))`);
    const doc = parseOrg(c.init);
    const r = captureInto(doc, templates[0], { now: new Date(2026, 10, 13, 18, 30), answers: c.answers, context: {}, place: () => ({ recalculate: () => null }) });
    return r.ok ? serializeOrg(doc) : 'ERROR ' + r.message;
  }
  if (c.kind === 'here') {
    const spec = JSON.parse(c.arg);
    const point = c.init.indexOf(spec.search) + spec.search.length + spec.offset;
    const before = c.init.slice(0, point);
    const { templates } = captureTemplatesFromLisp(`(setq org-capture-templates '(("t" "T" ${c.type} (file "f.org") ${q(c.template)} ${c.extra ?? ''})))`);
    const doc = parseOrg(c.init);
    const r = captureInto(doc, templates[0], { now: new Date(2026, 10, 13, 18, 30), answers: [], context: {}, place: () => ({ recalculate: () => null }), here: { line: before.split('\n').length - 1, column: before.length - before.lastIndexOf('\n') - 1 } });
    return r.ok ? serializeOrg(doc) : 'ERROR ' + r.message;
  }
  const target = c.kind === 'regexp' ? `(file+regexp "f.org" ${q(c.arg)})` : c.kind === 'id' ? `(id ${q(c.arg)})` : '(clock)';
  const { templates, notes } = captureTemplatesFromLisp(`(setq org-capture-templates '(("t" "T" ${c.type} ${target} ${q(c.template)}${c.prepend ? ' :prepend t' : ''})))`);
  assert.deepEqual(notes, []);
  const doc = parseOrg(c.init);
  const r = captureInto(doc, templates[0], { now: new Date(2026, 10, 13, 18, 30), answers: [], context: {}, place: () => ({ recalculate: () => null }) });
  return r.ok ? serializeOrg(doc) : 'ERROR ' + r.message;
}

test('a capture to a regexp, an ID or the running clock is filed where Emacs puts it', () => {
  const wrong = [];
  for (const c of oracle.cases) {
    if (c.kind === 'id' && c.arg === 'nope') continue; // Emacs's error depends on org-id-track-globally
    const got = file(c);
    const ok = c.emacs.startsWith('ERROR') ? got.startsWith('ERROR') : squeeze(got) === squeeze(c.emacs);
    if (!ok) wrong.push({ kind: c.kind, arg: c.arg, type: c.type, prepend: c.prepend, got, want: c.emacs });
  }
  assert.equal(wrong.length, 0, `${wrong.length} differ: ` + JSON.stringify(wrong.slice(0, 3), null, 1));
});
