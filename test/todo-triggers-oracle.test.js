// org-todo-state-tags-triggers, held to Emacs 29.3 (Org 9.6.15): test/fixtures/todo-triggers-oracle.json was made by tools/gen-todo-triggers-oracle.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyTagTriggers } from '../src/todo-triggers.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/todo-triggers-oracle.json', import.meta.url), 'utf8'));

test('a state change adds and removes the tags Emacs adds and removes', () => {
  const wrong = [];
  let changed = 0;
  for (const c of oracle) {
    const tags = applyTagTriggers(c.tags, c.to === '' ? null : c.to, c.triggers, ['DONE', 'CANCELED'], ['TODO', 'WAIT', 'NEXT']) ?? c.tags;
    const got = `* ${c.to === '' ? '' : `${c.to} `}item${tags.length ? ` :${tags.join(':')}:` : ''}`;
    if (JSON.stringify(tags) !== JSON.stringify(c.tags)) changed++;
    if (got !== c.result) wrong.push({ triggers: c.triggers, tags: c.tags, from: c.from, to: c.to, got, want: c.result });
  }
  assert.ok(changed > 50, `changed ${changed}`);
  assert.deepEqual(wrong.slice(0, 4), []);
});
