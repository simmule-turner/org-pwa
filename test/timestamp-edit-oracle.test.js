// src/timestamp-edit.js against Emacs 29.3: test/fixtures/timestamp-edit-oracle.json, from tools/gen-timestamp-edit-oracle.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clockTimestampsChange, cloneSubtreeAt, insertTimeStampCommand, timestampChange } from '../src/timestamp-edit.js';

const rows = JSON.parse(fs.readFileSync(new URL('./fixtures/timestamp-edit-oracle.json', import.meta.url), 'utf8'));
const local = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)), Number(s.slice(11, 13)), Number(s.slice(14, 16)), 0);
const normalize = (s) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<ID>');
const withPoint = (text) => {
  const at = text.indexOf('<point>');
  return at === -1 ? { text, pos: 0 } : { text: text.slice(0, at) + text.slice(at + 7), pos: at };
};

function run(r) {
  const { text, pos } = withPoint(r.text);
  switch (r.kind) {
    case 'change': return timestampChange(text, pos, r.n, { what: r.what, updown: r.updown, prefix: r.prefix === true });
    case 'clock': return clockTimestampsChange(text, pos, r.updown, r.n);
    case 'stamp': return insertTimeStampCommand(text, pos, { typed: r.typed, arg: r.arg, inactive: r.inactive, afterTimeStamp: r.after, now: local(r.now) });
    default: {
      return cloneSubtreeAt(text, pos, r.n, r.shift, { deleteId: r.deleteId, newId: () => '<ID>' });
    }
  }
}

test('timestamp changes, time stamp insertion and cloning match Emacs', () => {
  const bad = [];
  for (const r of rows) {
    const key = `${r.kind}|${r.text}|${r.n ?? ''}|${r.what ?? ''}|${r.updown ?? ''}|${r.prefix ?? ''}|${r.typed ?? ''}|${r.arg ?? ''}|${r.inactive ?? ''}|${r.after ?? ''}|${r.now ?? ''}|${r.shift ?? ''}|${r.deleteId ?? ''}`;
    let got;
    try {
      got = run(r);
    } catch (err) {
      got = { error: err.message };
    }
    if (r.err) {
      if (!got.error) bad.push({ key, want: r.err, got });
      continue;
    }
    const want = { text: r.res, pos: r.pt };
    const have = { text: normalize(got.text ?? ''), pos: got.pos };
    if (got.error || JSON.stringify(want) !== JSON.stringify(have)) bad.push({ key, want, have, error: got.error });
  }
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} of ${rows.length} differ`);
});
