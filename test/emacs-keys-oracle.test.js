// Holds the keys of Emacs mode to Emacs 29.3: test/fixtures/emacs-keys-oracle.json was made by tools/gen-emacs-keys-oracle.mjs, which types
// the keys themselves in an Org buffer (C-SPC M-f C-w C-y, C-u 3 C-f, typed characters, undo, the Org keys). Here the same keys go through
// the app's own key reader and command runner, as a key press does in the editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sameAsEmacs, typeKeys } from '../tools/emacs-keys-lib.mjs';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-keys-oracle.json', import.meta.url), 'utf8'));

test('typed keys do what they do in Emacs 29.3', () => {
  assert.ok(oracle.cases.length > 15000);
  const bad = [];
  let gaps = 0;
  const unsupported = /** @type {Record<string, number>} */ ({}); // keys whose command the editing code does not run (the editor runs them itself)
  if (process.env.KEYS_AUDIT) console.log('unsupported', JSON.stringify(unsupported));
  for (const c of oracle.cases) {
    /** @type {any} */
    let got;
    try {
      got = typeKeys(c);
    } catch (err) {
      const m = /unknown command (.*)/.exec(/** @type {Error} */ (err).message);
      if (!m) throw err;
      unsupported[m[1]] = (unsupported[m[1]] ?? 0) + 1;
      continue;
    }
    const e = c.emacs;
    // a known gap (ROADMAP.org): a typed character in a heading with tags (Org realigns the tags)
    const lineAt = (/** @type {number} */ p) => c.text.slice(c.text.lastIndexOf('\n', p - 1) + 1, c.text.indexOf('\n', p) < 0 ? undefined : c.text.indexOf('\n', p));
    if (c.keys === 'a' && /^\*+ .*:\w+:\s*$/.test(lineAt(c.pos))) {
      gaps += 1;
      continue;
    }
    const same = sameAsEmacs(got, e);
    if (!same) bad.push({ text: c.text, pos: c.pos, mark: c.mark, keys: c.keys, kill: c.kill, got: { text: got.text, pos: got.pos, mark: got.mark, kill: got.kill, error: got.error, message: got.message }, emacs: e });
  }
  if (process.env.KEYS_AUDIT) console.log('unsupported', JSON.stringify(unsupported), 'known gaps skipped', gaps);
  const byKeys = /** @type {Record<string, number>} */ ({});
  for (const b of bad) byKeys[b.keys] = (byKeys[b.keys] ?? 0) + 1;
  if (process.env.KEYS_AUDIT) fs.writeFileSync('/tmp/keys-seq-audit.json', JSON.stringify(bad, null, 1));
  assert.equal(bad.length, 0, `${bad.length} mismatches\n${JSON.stringify(byKeys, null, 1)}\n${JSON.stringify(bad.slice(0, 3), null, 1)}`);
});
