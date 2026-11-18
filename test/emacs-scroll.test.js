// Holds src/emacs-scroll.js to Emacs: test/fixtures/emacs-scroll.json was recorded by tools/gen-emacs-scroll.el run in a
// 80x24 terminal Emacs 29.3 (window of 21 text lines), which pressed C-v / M-v and logged point and window start.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scrollWindow } from '../src/emacs-scroll.js';

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-scroll.json', import.meta.url), 'utf8'));
const HEIGHT = 21;

test('C-v and M-v move the window start and the cursor as Emacs does', () => {
  for (const c of cases) {
    const text = Array.from({ length: c.n }, (_, k) => String.fromCharCode(97 + ((k + 1) % 26)).repeat(((k + 1) * 7) % 23)).join('\n');
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    const lineOf = (/** @type {number} */ p) => starts.filter((x) => x <= p).length - 1;
    let point = c.point - 1;
    let start = c.start - 1;
    let tok = 0;
    for (const key of c.keys) {
      const m = /^C-u (-?\d+) /.exec(key);
      const r = scrollWindow({ lines: c.n, start, point: lineOf(point), height: HEIGHT, count: m ? Number(m[1]) : null, forward: key.endsWith('C-v') });
      const wantError = c.after[tok].startsWith('E:');
      if (wantError) tok++;
      const [ep, ew] = c.after[tok++].split(',').map(Number);
      assert.equal(r.error !== null, wantError, JSON.stringify(c));
      start = r.start;
      if (r.bol) point = starts[r.point];
      assert.equal(point, ep - 1, JSON.stringify(c));
      assert.equal(start, lineOf(ew - 1), JSON.stringify(c));
    }
  }
});
