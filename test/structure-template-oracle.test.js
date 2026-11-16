// org-insert-structure-template and org-insert-drawer, held to Emacs 29.3 (Org 9.6.15): test/fixtures/structure-template-oracle.json was made by
// tools/gen-structure-template-oracle.mjs. The command runs on the last heading of a text, on a range of its lines or at the end of its text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { insertDrawer, insertStructureTemplate, DEFAULT_STRUCTURE_TEMPLATES } from '../src/structure-template.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/structure-template-oracle.json', import.meta.url), 'utf8'));

/** The lines of the last heading's text, and where they start in the whole text. @param {string} text */
function lastSection(text) {
  const all = text.replace(/\n$/, '').split('\n');
  let h = all.length - 1;
  while (h >= 0 && !/^\*+ /.test(all[h])) h--;
  return { head: all.slice(0, h + 1), lines: all.slice(h + 1), start: h + 1, level: /^\*+/.exec(all[h])?.[0].length ?? 1 };
}

/** Whether the range is a run of text a focused element could be: inside the section, not starting or ending on a blank line. */
function usable(/** @type {{ lines: string[], start: number }} */ s, /** @type {number | null} */ from, /** @type {number | null} */ to) {
  if (from === null || to === null) return true;
  const a = from - s.start;
  const b = to - s.start;
  return a >= 0 && b < s.lines.length && !/^\s*$/.test(s.lines[a]) && !/^\s*$/.test(s.lines[b]);
}

test('wrapping lines in a structure template or adding an empty one makes the text Emacs makes', () => {
  const wrong = [];
  let compared = 0;
  for (const c of oracle.templates) {
    const s = lastSection(c.text);
    if (!usable(s, c.from, c.to)) continue;
    const type = DEFAULT_STRUCTURE_TEMPLATES.find(([k]) => k === c.key)[1];
    const range = c.from === null ? null : { from: c.from - s.start, to: c.to - s.start };
    const got = [...s.head, ...insertStructureTemplate(s.lines, type, range)].join('\n') + '\n';
    compared++;
    if (got !== c.result) wrong.push({ text: c.text, key: c.key, from: c.from, to: c.to, got, want: c.result });
  }
  assert.ok(compared >= 200, `compared ${compared}`);
  assert.deepEqual(wrong.slice(0, 3), []);
});

test('wrapping lines in a drawer or adding an empty one makes the text Emacs makes', () => {
  const wrong = [];
  let compared = 0;
  for (const c of oracle.drawers) {
    const s = lastSection(c.text);
    if (!usable(s, c.from, c.to)) continue;
    const range = c.from === null ? null : { from: c.from - s.start, to: c.to - s.start };
    const got = [...s.head, ...insertDrawer(s.lines, c.name, range, { level: s.level, adapt: c.adapt === 't' })].join('\n') + '\n';
    compared++;
    if (got !== c.result) wrong.push({ text: c.text, name: c.name, adapt: c.adapt, from: c.from, to: c.to, got, want: c.result });
  }
  assert.ok(compared >= 60, `compared ${compared}`);
  assert.deepEqual(wrong.slice(0, 3), []);
});
