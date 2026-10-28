import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { print } from '../src/elisp-data.js';
import { Reader } from '../src/elisp-read.js';
import { evalForm, resetRun } from '../src/elisp-core.js';
import { describeFailure } from '../src/elisp.js';
import { withHeading } from '../src/org-lisp.js';
import { DOC } from '../tools/org-lisp-cases.mjs';

// Emacs 29.3 (tools/gen-org-lisp-oracle.mjs): the Org functions, with the cursor on each heading of tools/org-lisp-cases.mjs's document.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/org-lisp.json', import.meta.url), 'utf8'));
const doc = parseOrg(DOC);
/** @type {any[]} */ const headings = [];
const walk = (/** @type {any[]} */ nodes) => nodes.forEach((h) => { headings.push(h); walk(h.children); });
walk(doc.children);

test('the Org functions give Emacs\'s answer on every heading', () => {
  const bad = [];
  for (const c of oracle) {
    resetRun({ budget: 100000 });
    let got;
    try {
      got = print(withHeading({ doc, heading: headings[c.heading] }, () => evalForm(new Reader(c.form).read(), null)));
    } catch (e) {
      got = describeFailure(e).message;
    }
    if (got !== c.value) bad.push({ heading: c.heading, form: c.form, got, want: c.value });
  }
  assert.deepEqual(bad.slice(0, 10), []);
});
