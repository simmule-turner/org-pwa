// Holds src/emacs-fold.js to Emacs 29.3: motion and editing keys in an org-mode buffer with headings folded
// (test/fixtures/emacs-fold-motion-oracle.json, made by tools/gen-emacs-fold-motion-oracle.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { foldedExecute } from '../src/emacs-fold.js';
import { adjustHidden, settleHidden } from '../src/org-fold.js';
import { feedKey, newKeyInput } from '../src/emacs-keymap.js';
import { newUndo } from '../src/emacs-undo.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-fold-motion-oracle.json', import.meta.url), 'utf8'));

/** @param {any} c */
function play(c) {
  /** @type {import('../src/emacs-edit.js').EditState} */
  let st = { text: c.text, pos: c.pos, mark: null, kill: [], active: false, undo: newUndo(), yank: { adjusted: true, folded: true } };
  let input = newKeyInput();
  let hidden = c.emacs.hidden;
  let error = '';
  let joined = false;
  for (const key of c.keys.split(' ')) {
    const fed = feedKey(input, key);
    input = fed.input;
    if (fed.result.type !== 'run') continue;
    const old = st.text;
    st = foldedExecute(st, hidden, fed.result.command, fed.result.char, fed.result.prefix);
    if (st.text !== old) {
      // the stretches follow each edit, as in the editor
      for (const e of st.applied ?? []) {
        hidden = adjustHidden(hidden, e.from, e.removed.length, e.inserted);
        if (hidden.some(([, b]) => b === st.pos && hidden.some(([x]) => x === st.pos))) joined = true;
      }
      hidden = settleHidden(st.text, hidden);
    }
    if (st.error) {
      error = st.error;
      break;
    }
  }
  // `joined`: two stretches met at point after a kill, and Emacs merges them and moves point (ROADMAP)
  return { pt: st.pos, text: st.text, kill: st.kill[0] ?? null, error, joined };
}

test('motion and editing in folded text go where Emacs goes', () => {
  assert.ok(oracle.cases.length > 2000);
  const bad = [];
  let skipped = 0;
  for (const c of oracle.cases) {
    const got = play(c);
    if (got.joined) {
      skipped++;
      continue;
    }
    const want = c.emacs;
    if (got.pt !== want.pt || got.text !== want.text || (got.kill ?? null) !== (want.kill ?? null)) bad.push({ keys: c.keys, fold: c.fold, pos: c.pos, text: c.text.slice(0, 24), hidden: JSON.stringify(c.emacs.hidden), got: { pt: got.pt, kill: got.kill, error: got.error, changed: got.text !== c.text }, want: { pt: want.pt, kill: want.kill, error: want.error, changed: want.text !== c.text } });
  }
  assert.ok(skipped <= 4, `${skipped} cases skipped`);
  /** @type {Record<string, number>} */ const by = {};
  for (const b of bad) by[b.keys] = (by[b.keys] ?? 0) + 1;
  assert.equal(bad.length, 0, `${bad.length} differ\n${JSON.stringify(by)}\n${JSON.stringify(bad.slice(0, Number(process.env.SHOW ?? 4)).map((b) => [b.keys, b.fold, b.pos, JSON.stringify(b.text), b.hidden, JSON.stringify(b.got), JSON.stringify(b.want)].join(' | ')), null, 1)}`);
});
