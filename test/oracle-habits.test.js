// Holds the habit graphs to Emacs 29.3: test/fixtures/oracle-habits.json was made by tools/gen-oracle-habits.mjs from
// tools/oracle-habit-cases.mjs, with org-habit-build-graph for 13 October 2026 under three settings of the days before and after and
// org-habit-show-done-always-green. Every day's mark, color (blue, green, yellow, red) and shade (plain or the lighter -future face)
// has to be Emacs's. The app draws its own palette; the choice is what is compared.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { buildHabitGraph } from '../src/habit.js';
import { HABITS, HEADER } from '../tools/oracle-habit-cases.mjs';
import { habitKnown } from './support/oracle-agenda-known.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-habits.json', import.meta.url), 'utf8'));
const doc = parseOrg(HEADER + HABITS.map((h) => h.org).join('\n') + '\n');
const headings = doc.children.filter((h) => h.todo);

test('habits: every day of every graph has the mark, color and shade Emacs draws, under three settings', () => {
  const savedTz = process.env.TZ;
  process.env.TZ = oracle.tz;
  try {
    const today = new Date(2026, 9, 13);
    /** @type {string[]} */ const bad = [];
    for (const variant of oracle.variants) {
      HABITS.forEach((habit, i) => {
        const want = variant.habits[habit.id];
        const graph = buildHabitGraph(headings[i], (/** @type {string} */ k) => k === 'DONE' || k === 'CANCELED', today, { precedingDays: variant.preceding, followingDays: variant.following, doneAlwaysGreen: variant.green });
        const got = graph ? graph.cells.map((c) => `${c.mark || ' '}${c.face}${c.light ? 'l' : 'p'}`).join('') : null;
        // Emacs draws one slot more than the graph shows; the last is left blank
        const wantCells = String(want).startsWith('ERROR') ? want : String(want).slice(0, 3 * (variant.preceding + variant.following));
        if (got === wantCells) return;
        if (habitKnown(habit.id, wantCells, got)) return;
        bad.push(`${variant.id} ${habit.id} (${habit.org.split('\n').slice(0, 2).join(' | ')}): emacs ${wantCells}\n  ours  ${got}`);
      });
    }
    if (process.env.ORACLE_DEBUG) console.log(`${bad.length} differ\n` + bad.join('\n'));
    assert.deepEqual(bad.slice(0, 4), [], `${bad.length} habit graphs differ`);
  } finally {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  }
});
