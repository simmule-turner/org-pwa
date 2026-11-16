// org-inlinetask-promote, -demote and -insert-task, held to Emacs 29.3 (Org 9.6.15): test/fixtures/inlinetask-edit-oracle.json was made by
// tools/gen-inlinetask-edit-oracle.mjs. A command runs on each heading line of a text (or at each position and region), and the text it leaves
// and, for the insertion, where point is must be Emacs's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { demoteInlineTask, insertInlineTask, promoteInlineTask } from '../src/heading-edit.js';
import { setInlineTaskLevel } from '../src/inline-tasks.js';
import { setAdaptIndentation } from '../src/indent-settings.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/inlinetask-edit-oracle.json', import.meta.url), 'utf8'));

/** @param {import('../src/types.js').Heading[]} list @param {import('../src/types.js').Heading[]} [out] */
function flat(list, out = []) {
  for (const h of list) { out.push(h); flat(h.children, out); }
  return out;
}

test('promoting and demoting an inline task changes the task and its END line as Emacs does', () => {
  setInlineTaskLevel(oracle.min);
  const wrong = [];
  for (const c of oracle.shifts) {
    setAdaptIndentation(c.adapt ? 't' : 'nil');
    c.results.forEach((/** @type {string} */ want, /** @type {number} */ line) => {
      const doc = parseOrg(c.text);
      const lines = c.text.split('\n');
      if (!/^\*+ /.test(lines[line])) return; // the command is for a heading line
      const headingNo = lines.slice(0, line + 1).filter((l) => /^\*+ /.test(l)).length - 1;
      const target = flat(doc.children)[headingNo];
      const result = /** @type {{ error: string | null }} */ ((c.fn.endsWith('promote') ? promoteInlineTask : demoteInlineTask)(doc, target));
      const got = result.error ? `ERROR ${result.error}` : serializeOrg(doc);
      const normalize = (/** @type {string} */ t) => t.replace(/\n$/, '');
      if (/^ERROR/.test(want)) {
        // Emacs words the refusals of other places too ("Not in an inline task" applies to every heading line below the minimum level)
        if (normalize(got) !== normalize(want)) wrong.push({ fn: c.fn, adapt: c.adapt, text: c.text, line, got, want });
      } else if (normalize(got) !== normalize(want)) wrong.push({ fn: c.fn, adapt: c.adapt, text: c.text, line, got, want });
    });
  }
  setInlineTaskLevel(null);
  setAdaptIndentation('nil');
  assert.deepEqual(wrong.slice(0, 4), []);
});

test('inserting an inline task after a heading makes the text Emacs makes', () => {
  setInlineTaskLevel(oracle.min);
  const normalize = (/** @type {string} */ t) => t.replace(/\n$/, '');
  const wrong = [];
  let compared = 0;
  for (const c of oracle.inserts) {
    c.results.forEach((/** @type {string} */ want, /** @type {number} */ line) => {
      const lines = c.text.split('\n');
      if (!/^\*+ /.test(lines[line])) return; // the oracle puts point after this heading's own text; the app acts on headings
      const doc = parseOrg(c.text);
      const headingNo = lines.slice(0, line + 1).filter((l) => /^\*+ /.test(l)).length - 1;
      const target = flat(doc.children)[headingNo];
      const result = /** @type {{ error: string | null }} */ (insertInlineTask(doc, target, c.noState ? null : c.state));
      const got = result.error ? `ERROR ${result.error}` : serializeOrg(doc);
      compared++;
      if (normalize(got) !== normalize(want)) wrong.push({ text: c.text, state: c.state, noState: c.noState, line, got, want });
    });
  }
  setInlineTaskLevel(null);
  assert.ok(compared >= 40, `compared ${compared}`);
  assert.deepEqual(wrong.slice(0, 4), []);
});
