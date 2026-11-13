// The README is full of example time stamps written as ~code~. None of them is a reminder: Emacs's agenda skips them, and so does a
// calendar kept in step with the agenda, which once filled a phone calendar with the README's examples.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { buildAgendaItems } from '../src/agenda.js';

test('README.org gives the agenda nothing: its example time stamps are in code markup', () => {
  const doc = parseOrg(fs.readFileSync(new URL('../README.org', import.meta.url), 'utf8'));
  const items = buildAgendaItems([{ documentId: 'README.org', doc }]);
  assert.deepEqual(items.map((i) => i.heading.title), []);
});
