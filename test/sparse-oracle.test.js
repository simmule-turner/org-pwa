// @ts-check
// The sparse trees of C-c / find the lines Emacs 29.3 (Org 9.6.15) finds; the fixture is made by tools/gen-sparse-oracle.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dateQuery, deadlineQuery, occur, regexpQuery, stampTime, todoQuery } from '../src/sparse-tree.js';

const { text, cases } = JSON.parse(fs.readFileSync(new URL('./fixtures/sparse-oracle.json', import.meta.url), 'utf8'));
const lines = text.replace(/\n$/, '').split('\n');
const TODO = ['TODO', 'WAIT', 'NEXT'];
const NOW = new Date(2026, 10, 15);
/** The query of a case. */
const queryOf = (/** @type {any} */ c) => {
  if (c.kind === 'regexp') return regexpQuery(c.regexp, c.fold);
  if (c.kind === 'todo') return todoQuery(TODO, c.kwd);
  if (c.kind === 'deadline') {
    const doneAt = (/** @type {number} */ line) => {
      for (let i = line; i >= 0; i--) if (/^\*+ /.test(lines[i])) return /^\*+ DONE\b/.test(lines[i]);
      return false;
    };
    return deadlineQuery(c.warn, NOW, doneAt);
  }
  return dateQuery(c.kind, c.type, stampTime(c.a), stampTime(c.b || c.a));
};

test('every sparse tree matches the lines Emacs matches', () => {
  assert.ok(cases.length >= 50);
  let withMatches = 0;
  for (const c of cases) {
    const q = queryOf(c);
    const got = [...new Set(occur(lines, q.regexp, q).map((m) => m.line + 1))];
    const want = [...new Set(c.lines)];
    // Emacs counts a line once per match; the lines are what a tree shows
    assert.deepEqual(got, want, JSON.stringify(c));
    if (want.length) withMatches++;
  }
  assert.ok(withMatches >= 40);
});
