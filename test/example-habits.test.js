import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { buildHabitGraph } from '../src/habit.js';
import { HABITS } from '../tools/habit-cases.mjs';

// examples/habits.org shows the strip Emacs 29.3 drew for each habit in it (tools/gen-habits-example.mjs). The app must draw the same
// marks, colors and shades (plain or lighter) for the same file. Emacs leaves the last of the 29 slots blank, so 28 days are drawn.
const text = fs.readFileSync(new URL('../examples/habits.org', import.meta.url), 'utf8');
const doc = parseOrg(text);
const today = new Date(2026, 9, 13);

/** What the file shows under `#+NAME: id`. @param {string} id */
function shown(id) {
  const m = new RegExp(`^#\\+NAME: ${id}\\n#\\+begin_example\\n([\\s\\S]*?)\\n#\\+end_example$`, 'm').exec(text);
  assert.ok(m, `the file shows ${id}`);
  return m[1].split('\n');
}

HABITS.forEach((habit, i) => {
  test(`habits.org: ${habit.title}`, () => {
    const heading = doc.children.filter((h) => h.todo)[i];
    const graph = buildHabitGraph(heading, (k) => k === 'DONE', today);
    assert.ok(graph);
    const cells = graph.cells;
    assert.equal(cells.length, 28);
    const [marks, colors, shades] = shown(habit.id);
    assert.equal(cells.map((c) => c.mark || '.').join(''), marks);
    assert.equal(cells.map((c) => c.face).join(''), colors);
    assert.equal(cells.map((c) => (c.light ? 'l' : 'p')).join(''), shades);
  });
});
