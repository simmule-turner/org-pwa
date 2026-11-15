// Holds blocking of TODO state changes to Emacs 29.3: test/fixtures/blocking-oracle.json was made by tools/gen-blocking-oracle.mjs, which asks org-todo
// for a state with org-enforce-todo-dependencies and org-enforce-todo-checkbox-dependencies set and records the text, the refusal message and org-entry-blocked-p.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';
import { blockedBy, blockedMessage, entryBlockedP } from '../src/todo-blocking.js';
import { getEnforceTodoCheckboxDependencies, getEnforceTodoDependencies } from '../src/local-variables.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/blocking-oracle.json', import.meta.url), 'utf8'));

/** @param {import('../src/types.js').Heading[]} nodes @param {string} title @returns {import('../src/types.js').Heading | undefined} */
function find(nodes, title) {
  for (const n of nodes) {
    if (n.title === title) return n;
    const f = find(n.children, title);
    if (f) return f;
  }
  return undefined;
}

test('blocked state changes, their messages and org-entry-blocked-p match Emacs', () => {
  const wrong = [];
  for (const c of oracle.cases) {
    if (/^ERROR/.test(c.emacs.msg)) continue; // a state the file does not have
    const doc = parseOrg(c.org);
    const h = /** @type {import('../src/types.js').Heading} */ (find(doc.children, c.find));
    if (!h) continue; // NEXT is a plain word in a file without it as a keyword
    const seq = resolveTodoSequence(doc, { todoKeywords: ['TODO'], doneKeywords: ['DONE'] });
    const vars = { 'org-enforce-todo-dependencies': c.vars.deps ? 't' : 'nil', 'org-enforce-todo-checkbox-dependencies': c.vars.boxes ? 't' : 'nil' };
    const ctx = { enforceDependencies: getEnforceTodoDependencies(vars), enforceCheckboxes: getEnforceTodoCheckboxDependencies(vars), todoKeywords: seq.todoKeywords, doneKeywords: seq.doneKeywords };
    const to = c.to === 'none' ? null : c.to;
    const block = blockedBy(doc, h, h.todo, to, ctx);
    const got = { msg: block ? blockedMessage(h.todo, to, block) : 'null', blockedp: entryBlockedP(doc, h, ctx), changed: !block };
    const want = { msg: c.emacs.msg, blockedp: c.emacs.blockedp, changed: c.emacs.msg === 'null' };
    if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push({ name: c.name, find: c.find, vars: c.vars, to: c.to, got, want });
  }
  assert.equal(wrong.length, 0, `${wrong.length} of ${oracle.cases.length} differ\n` + JSON.stringify(wrong.slice(0, 4), null, 1));
});
